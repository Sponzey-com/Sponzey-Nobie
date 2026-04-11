#![cfg_attr(all(test, not(target_os = "linux")), allow(dead_code))]

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};

use crate::automation::{
    ApplicationLaunchRequest, ApplicationLaunchResult, AutomationBackend, AutomationCapabilities,
    CameraCaptureRequest, CameraCaptureResult, CameraDevice, CommandExecutionRequest,
    CommandExecutionResult, KeyboardActionKind, KeyboardActionRequest, KeyboardActionResult,
    KeyboardTypeRequest, KeyboardTypeResult, MouseActionKind, MouseActionRequest,
    MouseActionResult, MouseClickRequest, MouseClickResult, MouseMoveRequest, MouseMoveResult,
    PlatformKind, ScreenCaptureRequest, ScreenCaptureResult, SystemControlRequest,
    SystemControlResult, SystemSnapshot,
};
use crate::platform::shared;

#[derive(Debug, Default, Clone, Copy)]
pub struct PlatformBackend;

impl AutomationBackend for PlatformBackend {
    fn platform_kind(&self) -> PlatformKind {
        PlatformKind::Linux
    }

    fn capabilities(&self) -> AutomationCapabilities {
        AutomationCapabilities {
            platform: self.platform_kind(),
            camera_management: has_linux_camera_capture_tool(),
            command_execution: true,
            application_launch: true,
            screen_capture: linux_screen_capture_tool().is_some(),
            mouse_control: command_exists("xdotool"),
            keyboard_control: command_exists("xdotool"),
            system_control: linux_system_control_available(),
        }
    }

    fn system_info(&self) -> Result<SystemSnapshot> {
        Ok(shared::collect_system_info(self.platform_kind()))
    }

    fn control_system(&self, request: SystemControlRequest) -> Result<SystemControlResult> {
        let (program, args, action, message) = resolve_linux_system_control(&request)?;
        run_program(&program, &args, "Linux system control")?;
        Ok(SystemControlResult {
            accepted: true,
            action,
            target: request.target,
            message,
        })
    }

    fn execute_command(&self, request: CommandExecutionRequest) -> Result<CommandExecutionResult> {
        shared::execute_command(request)
    }

    fn launch_application(
        &self,
        request: ApplicationLaunchRequest,
    ) -> Result<ApplicationLaunchResult> {
        shared::validate_application_request(&request)?;

        let mut command = Command::new(&request.application);
        command.args(&request.args);
        if let Some(cwd) = &request.cwd {
            command.current_dir(cwd);
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let child = match command.spawn() {
            Ok(child) => child,
            Err(primary_error)
                if request.args.is_empty()
                    && request.cwd.is_none()
                    && command_exists("xdg-open") =>
            {
                Command::new("xdg-open")
                    .arg(&request.application)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .with_context(|| {
                        format!(
                            "failed to launch `{}` directly ({primary_error}) or through xdg-open",
                            request.application
                        )
                    })?
            }
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("failed to launch application `{}`", request.application)
                });
            }
        };

        Ok(ApplicationLaunchResult {
            launched: true,
            application: request.application,
            pid: Some(child.id()),
            message: if request.detached {
                "Application launch requested in detached mode.".to_string()
            } else {
                "Application launch requested.".to_string()
            },
        })
    }

    fn list_cameras(&self) -> Result<Vec<CameraDevice>> {
        let mut devices = if command_exists("v4l2-ctl") {
            match Command::new("v4l2-ctl").arg("--list-devices").output() {
                Ok(output) if output.status.success() => {
                    parse_v4l2_camera_devices(String::from_utf8_lossy(&output.stdout).as_ref())
                }
                _ => Vec::new(),
            }
        } else {
            Vec::new()
        };

        add_dev_video_devices(&mut devices)?;
        devices.sort_by(|left, right| left.id.cmp(&right.id));
        devices.dedup_by(|left, right| left.id == right.id);
        Ok(devices)
    }

    fn capture_camera(&self, request: CameraCaptureRequest) -> Result<CameraCaptureResult> {
        shared::validate_camera_request(&request)?;
        let inline_base64 = request.inline_base64;
        let output_path = resolve_camera_output_path(request.output_path.as_deref())?;
        ensure_parent_directory(&output_path)?;

        let device_id = match request.device_id.clone() {
            Some(device_id) if !device_id.trim().is_empty() => device_id,
            _ => self
                .list_cameras()?
                .into_iter()
                .next()
                .map(|device| device.id)
                .context("no Linux camera device was found; pass device_id such as /dev/video0")?,
        };

        if command_exists("ffmpeg") {
            run_program(
                "ffmpeg",
                &[
                    "-hide_banner".to_string(),
                    "-loglevel".to_string(),
                    "error".to_string(),
                    "-y".to_string(),
                    "-f".to_string(),
                    "video4linux2".to_string(),
                    "-i".to_string(),
                    device_id.clone(),
                    "-frames:v".to_string(),
                    "1".to_string(),
                    output_path.clone(),
                ],
                "Linux camera capture via ffmpeg",
            )?;
        } else if command_exists("fswebcam") {
            run_program(
                "fswebcam",
                &[
                    "-q".to_string(),
                    "-d".to_string(),
                    device_id.clone(),
                    "--no-banner".to_string(),
                    output_path.clone(),
                ],
                "Linux camera capture via fswebcam",
            )?;
        } else {
            bail!("Linux camera.capture requires ffmpeg or fswebcam in PATH");
        }

        let metadata = build_file_metadata(&output_path, inline_base64, "image/jpeg");
        let base64_data = inline_base64
            .then(|| encode_file_base64(&output_path))
            .transpose()?;
        if inline_base64 {
            let _ = fs::remove_file(&output_path);
        }

        Ok(CameraCaptureResult {
            device_id: Some(device_id),
            output_path: if inline_base64 {
                None
            } else {
                Some(output_path.clone())
            },
            file_name: metadata.file_name,
            file_extension: metadata.file_extension,
            mime_type: metadata.mime_type,
            size_bytes: metadata.size_bytes,
            transfer_encoding: metadata.transfer_encoding,
            base64_data,
            message: "Camera capture completed.".to_string(),
        })
    }

    fn capture_screen(&self, request: ScreenCaptureRequest) -> Result<ScreenCaptureResult> {
        shared::validate_screen_request(&request)?;
        if request.display.is_some() {
            bail!(
                "Linux screen.capture does not support display index selection yet; omit display to capture the current full screen"
            );
        }

        let inline_base64 = request.inline_base64;
        let output_path = resolve_screen_output_path(request.output_path.as_deref())?;
        ensure_parent_directory(&output_path)?;

        match linux_screen_capture_tool() {
            Some("grim") => run_program(
                "grim",
                std::slice::from_ref(&output_path),
                "Linux screen capture via grim",
            )?,
            Some("gnome-screenshot") => run_program(
                "gnome-screenshot",
                &["-f".to_string(), output_path.clone()],
                "Linux screen capture via gnome-screenshot",
            )?,
            Some("scrot") => run_program(
                "scrot",
                std::slice::from_ref(&output_path),
                "Linux screen capture via scrot",
            )?,
            Some("import") => run_program(
                "import",
                &[
                    "-window".to_string(),
                    "root".to_string(),
                    output_path.clone(),
                ],
                "Linux screen capture via ImageMagick import",
            )?,
            _ => bail!(
                "Linux screen.capture requires one of these commands in PATH: grim, gnome-screenshot, scrot, import"
            ),
        }

        let metadata = build_file_metadata(&output_path, inline_base64, "image/png");
        let base64_data = inline_base64
            .then(|| encode_file_base64(&output_path))
            .transpose()?;
        if inline_base64 {
            let _ = fs::remove_file(&output_path);
        }

        Ok(ScreenCaptureResult {
            display: request.display,
            output_path: if inline_base64 {
                None
            } else {
                Some(output_path.clone())
            },
            file_name: metadata.file_name,
            file_extension: metadata.file_extension,
            mime_type: metadata.mime_type,
            size_bytes: metadata.size_bytes,
            transfer_encoding: metadata.transfer_encoding,
            base64_data,
            message: "Screen capture completed.".to_string(),
        })
    }

    fn move_mouse(&self, request: MouseMoveRequest) -> Result<MouseMoveResult> {
        shared::validate_mouse_move(&request)?;
        run_xdotool(
            &[
                "mousemove".to_string(),
                request.x.to_string(),
                request.y.to_string(),
            ],
            "Linux mouse move",
        )?;

        Ok(MouseMoveResult {
            moved: true,
            x: request.x,
            y: request.y,
            message: "Mouse move completed.".to_string(),
        })
    }

    fn click_mouse(&self, request: MouseClickRequest) -> Result<MouseClickResult> {
        shared::validate_mouse_click(&request)?;
        let button = normalize_linux_mouse_button_code(&request.button)?;
        let mut args = vec![
            "mousemove".to_string(),
            request.x.to_string(),
            request.y.to_string(),
            "click".to_string(),
        ];
        if request.double {
            args.push("--repeat".to_string());
            args.push("2".to_string());
        }
        args.push(button.to_string());
        run_xdotool(&args, "Linux mouse click")?;

        Ok(MouseClickResult {
            clicked: true,
            x: request.x,
            y: request.y,
            button: linux_mouse_button_name(button).to_string(),
            double: request.double,
            message: if request.double {
                "Mouse double click completed.".to_string()
            } else {
                "Mouse click completed.".to_string()
            },
        })
    }

    fn perform_mouse_action(&self, request: MouseActionRequest) -> Result<MouseActionResult> {
        match request.action {
            MouseActionKind::Move => {
                let x = required_mouse_coordinate(request.x, "x", request.action.as_str())?;
                let y = required_mouse_coordinate(request.y, "y", request.action.as_str())?;
                let result = self.move_mouse(MouseMoveRequest { x, y })?;
                Ok(MouseActionResult {
                    accepted: result.moved,
                    action: MouseActionKind::Move,
                    x: Some(result.x),
                    y: Some(result.y),
                    button: None,
                    delta_x: None,
                    delta_y: None,
                    message: result.message,
                })
            }
            MouseActionKind::Click | MouseActionKind::DoubleClick => {
                let x = required_mouse_coordinate(request.x, "x", request.action.as_str())?;
                let y = required_mouse_coordinate(request.y, "y", request.action.as_str())?;
                let double = matches!(request.action, MouseActionKind::DoubleClick);
                let result = self.click_mouse(MouseClickRequest {
                    x,
                    y,
                    button: request.button,
                    double,
                })?;
                Ok(MouseActionResult {
                    accepted: result.clicked,
                    action: if result.double {
                        MouseActionKind::DoubleClick
                    } else {
                        MouseActionKind::Click
                    },
                    x: Some(result.x),
                    y: Some(result.y),
                    button: Some(result.button),
                    delta_x: None,
                    delta_y: None,
                    message: result.message,
                })
            }
            MouseActionKind::ButtonDown | MouseActionKind::ButtonUp => {
                let point =
                    resolve_optional_mouse_point(request.x, request.y, request.action.as_str())?;
                if let Some((x, y)) = point {
                    self.move_mouse(MouseMoveRequest { x, y })?;
                }
                let button = normalize_linux_mouse_button_code(&request.button)?;
                let xdotool_action = if matches!(request.action, MouseActionKind::ButtonDown) {
                    "mousedown"
                } else {
                    "mouseup"
                };
                run_xdotool(
                    &[xdotool_action.to_string(), button.to_string()],
                    "Linux mouse button action",
                )?;
                Ok(MouseActionResult {
                    accepted: true,
                    action: request.action,
                    x: point.map(|(x, _)| x),
                    y: point.map(|(_, y)| y),
                    button: Some(linux_mouse_button_name(button).to_string()),
                    delta_x: None,
                    delta_y: None,
                    message: format!("Mouse {} completed.", request.action.as_str()),
                })
            }
            MouseActionKind::Scroll => {
                let point =
                    resolve_optional_mouse_point(request.x, request.y, request.action.as_str())?;
                if let Some((x, y)) = point {
                    self.move_mouse(MouseMoveRequest { x, y })?;
                }
                let delta_x = request.delta_x.unwrap_or(0);
                let delta_y = request.delta_y.unwrap_or(0);
                if delta_x == 0 && delta_y == 0 {
                    bail!("mouse.action `scroll` requires non-zero `delta_x` or `delta_y`");
                }
                run_linux_scroll(delta_x, delta_y)?;
                Ok(MouseActionResult {
                    accepted: true,
                    action: MouseActionKind::Scroll,
                    x: point.map(|(x, _)| x),
                    y: point.map(|(_, y)| y),
                    button: None,
                    delta_x: Some(delta_x),
                    delta_y: Some(delta_y),
                    message: "Mouse scroll completed.".to_string(),
                })
            }
        }
    }

    fn type_text(&self, request: KeyboardTypeRequest) -> Result<KeyboardTypeResult> {
        if request.text.is_empty() {
            bail!("keyboard input text must not be empty");
        }
        run_xdotool(
            &[
                "type".to_string(),
                "--clearmodifiers".to_string(),
                "--".to_string(),
                request.text.clone(),
            ],
            "Linux keyboard text input",
        )?;
        Ok(KeyboardTypeResult {
            typed: true,
            text_len: request.text.chars().count(),
            message: "Keyboard text input completed.".to_string(),
        })
    }

    fn perform_keyboard_action(
        &self,
        request: KeyboardActionRequest,
    ) -> Result<KeyboardActionResult> {
        match request.action {
            KeyboardActionKind::TypeText => {
                let text = request.text.unwrap_or_default();
                let result = self.type_text(KeyboardTypeRequest { text })?;
                Ok(KeyboardActionResult {
                    accepted: result.typed,
                    action: KeyboardActionKind::TypeText,
                    text_len: Some(result.text_len),
                    key: None,
                    modifiers: Vec::new(),
                    message: result.message,
                })
            }
            KeyboardActionKind::Shortcut | KeyboardActionKind::KeyPress => {
                let key = require_keyboard_key(request.key, request.action.as_str())?;
                let chord = build_xdotool_key_chord(&key, &request.modifiers)?;
                run_xdotool(
                    &["key".to_string(), "--clearmodifiers".to_string(), chord],
                    "Linux keyboard key press",
                )?;
                Ok(KeyboardActionResult {
                    accepted: true,
                    action: request.action,
                    text_len: None,
                    key: Some(key),
                    modifiers: request.modifiers,
                    message: format!("Keyboard {} completed.", request.action.as_str()),
                })
            }
            KeyboardActionKind::KeyDown => {
                let key = require_keyboard_key(request.key, request.action.as_str())?;
                let modifiers = normalize_linux_modifiers(&request.modifiers)?;
                for modifier in &modifiers {
                    run_xdotool(
                        &["keydown".to_string(), modifier.clone()],
                        "Linux keyboard modifier down",
                    )?;
                }
                run_xdotool(
                    &["keydown".to_string(), resolve_linux_key_name(&key)?],
                    "Linux keyboard key down",
                )?;
                Ok(KeyboardActionResult {
                    accepted: true,
                    action: KeyboardActionKind::KeyDown,
                    text_len: None,
                    key: Some(key),
                    modifiers: request.modifiers,
                    message: "Keyboard key_down completed.".to_string(),
                })
            }
            KeyboardActionKind::KeyUp => {
                let key = require_keyboard_key(request.key, request.action.as_str())?;
                let modifiers = normalize_linux_modifiers(&request.modifiers)?;
                run_xdotool(
                    &["keyup".to_string(), resolve_linux_key_name(&key)?],
                    "Linux keyboard key up",
                )?;
                for modifier in modifiers.iter().rev() {
                    run_xdotool(
                        &["keyup".to_string(), modifier.clone()],
                        "Linux keyboard modifier up",
                    )?;
                }
                Ok(KeyboardActionResult {
                    accepted: true,
                    action: KeyboardActionKind::KeyUp,
                    text_len: None,
                    key: Some(key),
                    modifiers: request.modifiers,
                    message: "Keyboard key_up completed.".to_string(),
                })
            }
        }
    }
}

#[derive(Debug, Clone)]
struct FileMetadata {
    file_name: Option<String>,
    file_extension: Option<String>,
    mime_type: Option<String>,
    size_bytes: Option<u64>,
    transfer_encoding: Option<String>,
}

fn run_program(program: &str, args: &[String], context: &str) -> Result<()> {
    let output = Command::new(program)
        .args(args)
        .output()
        .with_context(|| format!("failed to launch {context}: {program}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    bail!(
        "{context} failed: {}{}{}",
        stderr.trim(),
        if !stderr.trim().is_empty() && !stdout.trim().is_empty() {
            " | "
        } else {
            ""
        },
        stdout.trim()
    )
}

fn run_xdotool(args: &[String], context: &str) -> Result<()> {
    if !command_exists("xdotool") {
        bail!("{context} requires xdotool in PATH");
    }
    run_program("xdotool", args, context)
}

fn command_exists(command: &str) -> bool {
    let path = Path::new(command);
    if path.components().count() > 1 {
        return path.is_file();
    }

    env::var_os("PATH")
        .map(|paths| env::split_paths(&paths).any(|dir| dir.join(command).is_file()))
        .unwrap_or(false)
}

fn first_available_command(candidates: &[&'static str]) -> Option<&'static str> {
    candidates
        .iter()
        .copied()
        .find(|command| command_exists(command))
}

fn linux_screen_capture_tool() -> Option<&'static str> {
    first_available_command(&["grim", "gnome-screenshot", "scrot", "import"])
}

fn has_linux_camera_capture_tool() -> bool {
    command_exists("ffmpeg") || command_exists("fswebcam")
}

fn linux_system_control_available() -> bool {
    command_exists("systemctl") || command_exists("loginctl") || command_exists("shutdown")
}

fn resolve_linux_system_control(
    request: &SystemControlRequest,
) -> Result<(String, Vec<String>, String, String)> {
    let action = request.action.trim().to_lowercase();
    let target = request
        .target
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    if !target.is_empty() && target != "local" && target != "localhost" && target != "." {
        bail!(
            "system.control target `{}` is not supported on Linux yet",
            request.target.as_deref().unwrap_or_default()
        );
    }

    match action.as_str() {
        "lock" | "lock_screen" | "lock_workstation" => {
            if command_exists("loginctl") {
                Ok((
                    "loginctl".to_string(),
                    vec!["lock-session".to_string()],
                    action,
                    "Linux lock requested.".to_string(),
                ))
            } else if command_exists("xdg-screensaver") {
                Ok((
                    "xdg-screensaver".to_string(),
                    vec!["lock".to_string()],
                    action,
                    "Linux lock requested.".to_string(),
                ))
            } else {
                bail!("Linux lock requires loginctl or xdg-screensaver in PATH")
            }
        }
        "sleep" | "sleepnow" | "sleep_now" | "suspend" => {
            require_command("systemctl", "Linux sleep")?;
            Ok((
                "systemctl".to_string(),
                vec!["suspend".to_string()],
                action,
                "Linux sleep requested.".to_string(),
            ))
        }
        "hibernate" | "hibernation" => {
            require_command("systemctl", "Linux hibernate")?;
            Ok((
                "systemctl".to_string(),
                vec!["hibernate".to_string()],
                action,
                "Linux hibernate requested.".to_string(),
            ))
        }
        "logoff" | "logout" | "signout" | "sign_out" => {
            if command_exists("gnome-session-quit") {
                Ok((
                    "gnome-session-quit".to_string(),
                    vec!["--logout".to_string(), "--no-prompt".to_string()],
                    action,
                    "Linux logout requested.".to_string(),
                ))
            } else if command_exists("loginctl") {
                let user = env::var("USER").unwrap_or_default();
                if user.trim().is_empty() {
                    bail!("Linux logout through loginctl requires USER to be set")
                }
                Ok((
                    "loginctl".to_string(),
                    vec!["terminate-user".to_string(), user],
                    action,
                    "Linux logout requested.".to_string(),
                ))
            } else {
                bail!("Linux logout requires gnome-session-quit or loginctl in PATH")
            }
        }
        "restart" | "reboot" => {
            if command_exists("systemctl") {
                Ok((
                    "systemctl".to_string(),
                    vec!["reboot".to_string()],
                    action,
                    "Linux restart requested.".to_string(),
                ))
            } else {
                require_command("shutdown", "Linux restart")?;
                Ok((
                    "shutdown".to_string(),
                    vec!["-r".to_string(), "now".to_string()],
                    action,
                    "Linux restart requested.".to_string(),
                ))
            }
        }
        "shutdown" | "poweroff" | "power_off" => {
            if command_exists("systemctl") {
                Ok((
                    "systemctl".to_string(),
                    vec!["poweroff".to_string()],
                    action,
                    "Linux shutdown requested.".to_string(),
                ))
            } else {
                require_command("shutdown", "Linux shutdown")?;
                Ok((
                    "shutdown".to_string(),
                    vec!["now".to_string()],
                    action,
                    "Linux shutdown requested.".to_string(),
                ))
            }
        }
        other => bail!("system.control action `{other}` is not supported on Linux yet"),
    }
}

fn require_command(command: &str, context: &str) -> Result<()> {
    if command_exists(command) {
        Ok(())
    } else {
        bail!("{context} requires {command} in PATH")
    }
}

fn parse_v4l2_camera_devices(output: &str) -> Vec<CameraDevice> {
    let mut devices = Vec::new();
    let mut current_name: Option<String> = None;

    for line in output.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if line.chars().next().is_some_and(char::is_whitespace) {
            let path = line.trim();
            if path.starts_with("/dev/video") {
                let name = current_name
                    .clone()
                    .unwrap_or_else(|| path.to_string())
                    .trim_end_matches(':')
                    .to_string();
                devices.push(CameraDevice {
                    id: path.to_string(),
                    name: format!("{name} ({path})"),
                    position: None,
                    available: Path::new(path).exists(),
                });
            }
        } else {
            current_name = Some(line.trim().trim_end_matches(':').to_string());
        }
    }

    devices
}

fn add_dev_video_devices(devices: &mut Vec<CameraDevice>) -> Result<()> {
    let dev = Path::new("/dev");
    if !dev.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(dev).context("failed to list /dev for Linux camera discovery")? {
        let entry = entry?;
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        if !file_name.starts_with("video") {
            continue;
        }
        let path = entry.path().display().to_string();
        if devices.iter().any(|device| device.id == path) {
            continue;
        }
        devices.push(CameraDevice {
            id: path.clone(),
            name: format!("Video device {file_name} ({path})"),
            position: None,
            available: true,
        });
    }
    Ok(())
}

fn resolve_camera_output_path(output_path: Option<&str>) -> Result<String> {
    resolve_output_path(output_path, "yeonjang-camera", "jpg")
}

fn resolve_screen_output_path(output_path: Option<&str>) -> Result<String> {
    resolve_output_path(output_path, "yeonjang-screen", "png")
}

fn resolve_output_path(output_path: Option<&str>, prefix: &str, extension: &str) -> Result<String> {
    match output_path {
        Some(path) if !path.trim().is_empty() => {
            let candidate = PathBuf::from(path);
            if should_treat_as_output_directory(&candidate) {
                Ok(candidate
                    .join(build_generated_capture_name(prefix, extension))
                    .display()
                    .to_string())
            } else {
                Ok(path.to_string())
            }
        }
        _ => Ok(env::temp_dir()
            .join(build_generated_capture_name(prefix, extension))
            .display()
            .to_string()),
    }
}

fn build_generated_capture_name(prefix: &str, extension: &str) -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("{prefix}-{stamp}.{extension}")
}

fn should_treat_as_output_directory(path: &Path) -> bool {
    let raw = path.to_string_lossy();
    raw.ends_with('/') || path.is_dir() || path.extension().is_none()
}

fn ensure_parent_directory(output_path: &str) -> Result<()> {
    if let Some(parent) = Path::new(output_path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).with_context(|| {
                format!("failed to create output directory: {}", parent.display())
            })?;
        }
    }
    Ok(())
}

fn build_file_metadata(
    output_path: &str,
    inline_base64: bool,
    default_mime_type: &str,
) -> FileMetadata {
    let path = Path::new(output_path);
    FileMetadata {
        file_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .map(ToOwned::to_owned),
        file_extension: path
            .extension()
            .and_then(|value| value.to_str())
            .map(ToOwned::to_owned),
        mime_type: Some(default_mime_type.to_string()),
        size_bytes: fs::metadata(path).map(|metadata| metadata.len()).ok(),
        transfer_encoding: if inline_base64 {
            Some("base64".to_string())
        } else {
            Some("file".to_string())
        },
    }
}

fn encode_file_base64(path: &str) -> Result<String> {
    let bytes =
        fs::read(path).with_context(|| format!("failed to read file for base64: {path}"))?;
    Ok(base64_encode(&bytes))
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    let mut index = 0;
    while index < bytes.len() {
        let first = bytes[index];
        let second = bytes.get(index + 1).copied();
        let third = bytes.get(index + 2).copied();

        output.push(TABLE[(first >> 2) as usize] as char);
        output.push(
            TABLE[(((first & 0b0000_0011) << 4) | (second.unwrap_or(0) >> 4)) as usize] as char,
        );

        match second {
            Some(second) => output.push(
                TABLE[(((second & 0b0000_1111) << 2) | (third.unwrap_or(0) >> 6)) as usize] as char,
            ),
            None => output.push('='),
        }

        match third {
            Some(third) => output.push(TABLE[(third & 0b0011_1111) as usize] as char),
            None => output.push('='),
        }

        index += 3;
    }
    output
}

fn required_mouse_coordinate(value: Option<i32>, field: &str, action: &str) -> Result<i32> {
    value.ok_or_else(|| anyhow::anyhow!("mouse.action `{action}` requires `{field}`"))
}

fn resolve_optional_mouse_point(
    x: Option<i32>,
    y: Option<i32>,
    action: &str,
) -> Result<Option<(i32, i32)>> {
    match (x, y) {
        (Some(x), Some(y)) => Ok(Some((x, y))),
        (None, None) => Ok(None),
        _ => {
            bail!("mouse.action `{action}` requires both `x` and `y` when coordinates are provided")
        }
    }
}

fn normalize_linux_mouse_button_code(button: &str) -> Result<&'static str> {
    match button.trim().to_lowercase().as_str() {
        "" | "left" | "1" => Ok("1"),
        "middle" | "center" | "2" => Ok("2"),
        "right" | "3" => Ok("3"),
        other => bail!("unsupported mouse button for Linux: {other}"),
    }
}

fn linux_mouse_button_name(button_code: &str) -> &'static str {
    match button_code {
        "2" => "middle",
        "3" => "right",
        _ => "left",
    }
}

fn run_linux_scroll(delta_x: i32, delta_y: i32) -> Result<()> {
    if delta_y != 0 {
        let button = if delta_y > 0 { "4" } else { "5" };
        click_repeated(button, scroll_units(delta_y), "Linux vertical scroll")?;
    }
    if delta_x != 0 {
        let button = if delta_x > 0 { "6" } else { "7" };
        click_repeated(button, scroll_units(delta_x), "Linux horizontal scroll")?;
    }
    Ok(())
}

fn scroll_units(delta: i32) -> u32 {
    let absolute = delta.unsigned_abs();
    if absolute <= 1 {
        1
    } else {
        absolute.div_ceil(120).max(1)
    }
}

fn click_repeated(button: &str, repeat: u32, context: &str) -> Result<()> {
    run_xdotool(
        &[
            "click".to_string(),
            "--repeat".to_string(),
            repeat.to_string(),
            button.to_string(),
        ],
        context,
    )
}

fn require_keyboard_key(key: Option<String>, action: &str) -> Result<String> {
    let key = key.unwrap_or_default();
    if key.trim().is_empty() {
        bail!("keyboard.action `{action}` requires non-empty `key`");
    }
    Ok(key)
}

fn build_xdotool_key_chord(key: &str, modifiers: &[String]) -> Result<String> {
    let mut parts = normalize_linux_modifiers(modifiers)?;
    parts.push(resolve_linux_key_name(key)?);
    Ok(parts.join("+"))
}

fn normalize_linux_modifiers(modifiers: &[String]) -> Result<Vec<String>> {
    let mut normalized = Vec::new();
    for modifier in modifiers {
        let value = match modifier
            .trim()
            .to_lowercase()
            .replace('_', "")
            .replace('-', "")
            .as_str()
        {
            "control" | "ctrl" | "leftcontrol" | "leftctrl" | "rightcontrol" | "rightctrl" => {
                "ctrl"
            }
            "shift" | "leftshift" | "rightshift" => "shift",
            "alt" | "option" | "leftalt" | "rightalt" | "leftoption" | "rightoption" => "alt",
            "meta" | "super" | "cmd" | "command" | "win" | "windows" | "leftsuper"
            | "rightsuper" | "leftcommand" | "rightcommand" => "super",
            other => bail!("unsupported keyboard modifier for Linux: {other}"),
        };
        if !normalized.iter().any(|item| item == value) {
            normalized.push(value.to_string());
        }
    }
    Ok(normalized)
}

fn resolve_linux_key_name(key: &str) -> Result<String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        bail!("keyboard key must not be empty");
    }
    if trimmed.chars().count() == 1 {
        return Ok(trimmed.to_string());
    }

    let normalized = trimmed
        .to_lowercase()
        .replace('_', "")
        .replace('-', "")
        .replace(' ', "");
    let key_name = match normalized.as_str() {
        "enter" | "return" => "Return",
        "tab" => "Tab",
        "space" | "spacebar" => "space",
        "backspace" | "deletebackward" => "BackSpace",
        "delete" | "forwarddelete" => "Delete",
        "escape" | "esc" => "Escape",
        "home" => "Home",
        "end" => "End",
        "pageup" => "Page_Up",
        "pagedown" => "Page_Down",
        "left" | "leftarrow" => "Left",
        "right" | "rightarrow" => "Right",
        "up" | "uparrow" => "Up",
        "down" | "downarrow" => "Down",
        "insert" => "Insert",
        "capslock" => "Caps_Lock",
        "printscreen" | "printscr" | "prtsc" => "Print",
        "minus" => "minus",
        "equal" => "equal",
        "comma" => "comma",
        "period" | "dot" => "period",
        "slash" => "slash",
        "backslash" => "backslash",
        "semicolon" => "semicolon",
        "quote" | "apostrophe" => "apostrophe",
        "grave" | "backtick" => "grave",
        "leftbracket" => "bracketleft",
        "rightbracket" => "bracketright",
        f_key if is_function_key(f_key) => return Ok(f_key.to_ascii_uppercase()),
        other => bail!("unsupported keyboard key for Linux: {other}"),
    };
    Ok(key_name.to_string())
}

fn is_function_key(value: &str) -> bool {
    let Some(number) = value.strip_prefix('f') else {
        return false;
    };
    number
        .parse::<u8>()
        .map(|number| (1..=24).contains(&number))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::{
        base64_encode, build_xdotool_key_chord, linux_mouse_button_name, normalize_linux_modifiers,
        normalize_linux_mouse_button_code, parse_v4l2_camera_devices, resolve_linux_key_name,
        resolve_optional_mouse_point, scroll_units,
    };

    #[test]
    fn parses_v4l2_camera_devices() {
        let devices = parse_v4l2_camera_devices(
            "Integrated Camera: Integrated C:\n\t/dev/video0\n\t/dev/video1\nUSB Camera:\n    /dev/video2\n",
        );

        assert_eq!(devices.len(), 3);
        assert_eq!(devices[0].id, "/dev/video0");
        assert!(devices[0].name.contains("Integrated Camera"));
        assert_eq!(devices[2].id, "/dev/video2");
    }

    #[test]
    fn normalizes_mouse_button_aliases() {
        assert_eq!(normalize_linux_mouse_button_code("left").unwrap(), "1");
        assert_eq!(normalize_linux_mouse_button_code("center").unwrap(), "2");
        assert_eq!(linux_mouse_button_name("3"), "right");
    }

    #[test]
    fn optional_mouse_point_requires_both_coordinates() {
        let error = resolve_optional_mouse_point(Some(10), None, "scroll")
            .expect_err("partial point should fail");
        assert!(
            error
                .to_string()
                .contains("requires both `x` and `y` when coordinates are provided")
        );
    }

    #[test]
    fn converts_scroll_delta_to_units() {
        assert_eq!(scroll_units(1), 1);
        assert_eq!(scroll_units(120), 1);
        assert_eq!(scroll_units(240), 2);
    }

    #[test]
    fn builds_xdotool_key_chord() {
        let chord = build_xdotool_key_chord(
            "Return",
            &["Command".to_string(), "LeftControl".to_string()],
        )
        .expect("chord should build");

        assert_eq!(chord, "super+ctrl+Return");
    }

    #[test]
    fn normalizes_linux_key_names() {
        assert_eq!(resolve_linux_key_name("PageDown").unwrap(), "Page_Down");
        assert_eq!(resolve_linux_key_name("f12").unwrap(), "F12");
    }

    #[test]
    fn deduplicates_modifiers() {
        let modifiers = normalize_linux_modifiers(&[
            "Command".to_string(),
            "super".to_string(),
            "Ctrl".to_string(),
        ])
        .expect("modifiers should normalize");

        assert_eq!(modifiers, vec!["super", "ctrl"]);
    }

    #[test]
    fn encodes_base64() {
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
    }
}
