use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use serde_json::Value;

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
        PlatformKind::Windows
    }

    fn capabilities(&self) -> AutomationCapabilities {
        AutomationCapabilities {
            platform: self.platform_kind(),
            camera_management: true,
            command_execution: true,
            application_launch: true,
            screen_capture: true,
            mouse_control: true,
            keyboard_control: true,
            system_control: true,
        }
    }

    fn system_info(&self) -> Result<SystemSnapshot> {
        Ok(shared::collect_system_info(self.platform_kind()))
    }

    fn control_system(&self, request: SystemControlRequest) -> Result<SystemControlResult> {
        let (command, args, action, message) = resolve_windows_system_control(&request)?;
        let result = shared::execute_command(CommandExecutionRequest {
            command,
            args,
            cwd: None,
            shell: false,
            env: Default::default(),
            timeout_sec: Some(15),
        })?;

        if !result.success {
            bail!(
                "system control failed: {}{}{}",
                result.stderr.trim(),
                if !result.stderr.trim().is_empty() && !result.stdout.trim().is_empty() {
                    " | "
                } else {
                    ""
                },
                result.stdout.trim()
            );
        }

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

        let output = run_powershell_json(
            WINDOWS_APPLICATION_LAUNCH_SCRIPT,
            &[
                request.application.clone(),
                serde_json::to_string(&request.args).context("failed to encode launch args")?,
                request.cwd.clone().unwrap_or_default(),
                request.detached.to_string(),
            ],
            "application launch",
        )?;

        Ok(ApplicationLaunchResult {
            launched: true,
            application: request.application,
            pid: output
                .get("pid")
                .and_then(Value::as_u64)
                .and_then(|value| u32::try_from(value).ok()),
            message: if request.detached {
                "Application launch requested in detached mode.".to_string()
            } else {
                "Application launch requested.".to_string()
            },
        })
    }

    fn list_cameras(&self) -> Result<Vec<CameraDevice>> {
        let output = run_powershell_json(
            WINDOWS_CAMERA_LIST_SCRIPT,
            &[],
            "camera discovery",
        )?;
        parse_windows_camera_devices(&output)
    }

    fn capture_camera(&self, request: CameraCaptureRequest) -> Result<CameraCaptureResult> {
        shared::validate_camera_request(&request)?;
        let inline_base64 = request.inline_base64;
        let output_path = resolve_camera_output_path(request.output_path.as_deref());
        let executable_path = env::current_exe()?;
        let mut command = Command::new(&executable_path);
        command.arg("--camera-capture-helper").arg(&output_path);
        if let Some(device_id) = request.device_id.as_deref() {
            command.arg("--device-id").arg(device_id);
        }
        if inline_base64 {
            command.arg("--inline-base64");
        }

        let output = command.output().with_context(|| {
            format!(
                "failed to execute Yeonjang camera capture command: {}",
                executable_path.display()
            )
        })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            bail!(
                "camera capture failed: {}{}{}",
                stderr.trim(),
                if !stderr.trim().is_empty() && !stdout.trim().is_empty() {
                    " | "
                } else {
                    ""
                },
                stdout.trim()
            );
        }

        let output: Value = serde_json::from_slice(&output.stdout)
            .context("failed to parse camera capture helper output")?;

        let metadata = build_file_metadata(&output_path, inline_base64, "image/jpeg");
        let base64_data = if inline_base64 {
            Some(
                output
                    .get("base64Data")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .context("camera capture must include inline base64 data")?,
            )
        } else {
            None
        };
        if inline_base64 {
            let _ = fs::remove_file(&output_path);
        }

        Ok(CameraCaptureResult {
            device_id: output
                .get("deviceId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .or(request.device_id),
            output_path: if inline_base64 {
                None
            } else {
                Some(output_path.clone())
            },
            file_name: metadata.file_name,
            file_extension: metadata.file_extension,
            mime_type: output
                .get("mimeType")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .or(metadata.mime_type),
            size_bytes: metadata.size_bytes,
            transfer_encoding: metadata.transfer_encoding,
            base64_data,
            message: "Camera capture completed through the Windows camera UI.".to_string(),
        })
    }

    fn capture_screen(&self, request: ScreenCaptureRequest) -> Result<ScreenCaptureResult> {
        shared::validate_screen_request(&request)?;
        let inline_base64 = request.inline_base64;
        let output_path = resolve_screen_output_path(request.output_path.as_deref());
        let output = run_powershell_json(
            WINDOWS_SCREEN_CAPTURE_SCRIPT,
            &[
                output_path.clone(),
                request
                    .display
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
            ],
            "screen capture",
        )?;

        let metadata = build_file_metadata(&output_path, inline_base64, "image/png");
        let base64_data = if inline_base64 {
            Some(
                output
                    .get("base64Data")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .context("screen capture must include inline base64 data")?,
            )
        } else {
            None
        };
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
            mime_type: output
                .get("mimeType")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .or(metadata.mime_type),
            size_bytes: metadata.size_bytes,
            transfer_encoding: metadata.transfer_encoding,
            base64_data,
            message: "Screen capture completed.".to_string(),
        })
    }

    fn move_mouse(&self, request: MouseMoveRequest) -> Result<MouseMoveResult> {
        shared::validate_mouse_move(&request)?;
        run_powershell_script(
            WINDOWS_MOUSE_ACTION_SCRIPT,
            &[
                MouseActionKind::Move.as_str().to_string(),
                request.x.to_string(),
                request.y.to_string(),
                "left".to_string(),
                String::new(),
                String::new(),
            ],
            "mouse move",
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
        let button = normalize_windows_mouse_button_name(&request.button)?;
        run_powershell_script(
            WINDOWS_MOUSE_ACTION_SCRIPT,
            &[
                if request.double {
                    MouseActionKind::DoubleClick.as_str().to_string()
                } else {
                    MouseActionKind::Click.as_str().to_string()
                },
                request.x.to_string(),
                request.y.to_string(),
                button.to_string(),
                String::new(),
                String::new(),
            ],
            "mouse click",
        )?;

        Ok(MouseClickResult {
            clicked: true,
            x: request.x,
            y: request.y,
            button: button.to_string(),
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
                let x = request
                    .x
                    .ok_or_else(|| anyhow::anyhow!("mouse.action `move` requires `x`"))?;
                let y = request
                    .y
                    .ok_or_else(|| anyhow::anyhow!("mouse.action `move` requires `y`"))?;
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
                let x = request.x.ok_or_else(|| {
                    anyhow::anyhow!("mouse.action `{}` requires `x`", request.action.as_str())
                })?;
                let y = request.y.ok_or_else(|| {
                    anyhow::anyhow!("mouse.action `{}` requires `y`", request.action.as_str())
                })?;
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
                let button = normalize_windows_mouse_button_name(&request.button)?;
                run_powershell_script(
                    WINDOWS_MOUSE_ACTION_SCRIPT,
                    &[
                        request.action.as_str().to_string(),
                        point.map(|(x, _)| x.to_string()).unwrap_or_default(),
                        point.map(|(_, y)| y.to_string()).unwrap_or_default(),
                        button.to_string(),
                        String::new(),
                        String::new(),
                    ],
                    "mouse action",
                )?;
                Ok(MouseActionResult {
                    accepted: true,
                    action: request.action,
                    x: point.map(|(x, _)| x),
                    y: point.map(|(_, y)| y),
                    button: Some(button.to_string()),
                    delta_x: None,
                    delta_y: None,
                    message: format!("Mouse {} completed.", request.action.as_str()),
                })
            }
            MouseActionKind::Scroll => {
                let point =
                    resolve_optional_mouse_point(request.x, request.y, request.action.as_str())?;
                let delta_x = request.delta_x.unwrap_or(0);
                let delta_y = request.delta_y.unwrap_or(0);
                if delta_x == 0 && delta_y == 0 {
                    bail!("mouse.action `scroll` requires non-zero `delta_x` or `delta_y`");
                }
                run_powershell_script(
                    WINDOWS_MOUSE_ACTION_SCRIPT,
                    &[
                        MouseActionKind::Scroll.as_str().to_string(),
                        point.map(|(x, _)| x.to_string()).unwrap_or_default(),
                        point.map(|(_, y)| y.to_string()).unwrap_or_default(),
                        "left".to_string(),
                        delta_x.to_string(),
                        delta_y.to_string(),
                    ],
                    "mouse scroll",
                )?;
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
        run_powershell_script(
            WINDOWS_KEYBOARD_TYPE_SCRIPT,
            &[request.text.clone()],
            "keyboard text input",
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
            KeyboardActionKind::Shortcut
            | KeyboardActionKind::KeyPress
            | KeyboardActionKind::KeyDown
            | KeyboardActionKind::KeyUp => {
                let key = request.key.unwrap_or_default();
                if key.trim().is_empty() {
                    bail!(
                        "keyboard.action `{}` requires non-empty `key`",
                        request.action.as_str()
                    );
                }
                let key_code = resolve_windows_virtual_key_code(&key)?;
                let modifier_codes = build_windows_modifier_key_codes(&request.modifiers)?;
                run_powershell_script(
                    WINDOWS_KEYBOARD_ACTION_SCRIPT,
                    &[
                        request.action.as_str().to_string(),
                        key_code.to_string(),
                        serde_json::to_string(&modifier_codes)
                            .context("failed to encode keyboard modifiers")?,
                    ],
                    "keyboard action",
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
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WindowsCameraCaptureHelperRequest {
    output_path: String,
    device_id: Option<String>,
    inline_base64: bool,
}

pub(crate) fn run_camera_capture_helper(args: Vec<String>) -> Result<()> {
    let request = parse_windows_camera_capture_helper_request(args)?;
    let output = if let Some(device_id) = request.device_id.as_deref() {
        run_powershell_script(
            WINDOWS_CAMERA_CAPTURE_DEVICE_SCRIPT,
            &[request.output_path.clone(), device_id.to_string()],
            "camera capture",
        )?
    } else {
        run_powershell_script(
            WINDOWS_CAMERA_CAPTURE_SCRIPT,
            &[request.output_path.clone()],
            "camera capture",
        )?
    };

    let mut parsed: Value = serde_json::from_str(output.trim())
        .context("failed to parse Windows camera capture helper output")?;
    if !request.inline_base64 {
        if let Some(object) = parsed.as_object_mut() {
            object.remove("base64Data");
        }
    }

    serde_json::to_writer(io::stdout().lock(), &parsed)?;
    io::stdout().lock().write_all(b"\n")?;
    Ok(())
}

fn parse_windows_camera_capture_helper_request(
    args: Vec<String>,
) -> Result<WindowsCameraCaptureHelperRequest> {
    let Some(output_path) = args.first().cloned() else {
        bail!("output path argument is required");
    };

    let mut inline_base64 = false;
    let mut device_id: Option<String> = None;
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--inline-base64" => {
                inline_base64 = true;
                index += 1;
            }
            "--device-id" => {
                let value = args
                    .get(index + 1)
                    .cloned()
                    .filter(|candidate| !candidate.trim().is_empty())
                    .context("device id value is required")?;
                device_id = Some(value);
                index += 2;
            }
            other => {
                if device_id.is_none() && !other.trim().is_empty() {
                    device_id = Some(other.to_string());
                    index += 1;
                } else {
                    bail!("unknown argument: {other}");
                }
            }
        }
    }

    Ok(WindowsCameraCaptureHelperRequest {
        output_path,
        device_id,
        inline_base64,
    })
}

fn resolve_windows_system_control(
    request: &SystemControlRequest,
) -> Result<(String, Vec<String>, String, String)> {
    let action = request.action.trim().to_lowercase();
    let target = request.target.as_deref().unwrap_or_default().trim().to_lowercase();
    if !target.is_empty() && target != "local" && target != "localhost" && target != "." {
        bail!("system.control target `{}` is not supported on Windows yet", request.target.as_deref().unwrap_or_default());
    }

    match action.as_str() {
        "lock" | "lock_workstation" => Ok((
            "rundll32.exe".to_string(),
            vec!["user32.dll,LockWorkStation".to_string()],
            action,
            "Windows lock requested.".to_string(),
        )),
        "logoff" | "logout" | "signout" | "sign_out" => Ok((
            "shutdown".to_string(),
            vec!["/l".to_string()],
            action,
            "Windows sign-out requested.".to_string(),
        )),
        "shutdown" | "poweroff" | "power_off" => Ok((
            "shutdown".to_string(),
            vec!["/s".to_string(), "/t".to_string(), "0".to_string()],
            action,
            "Windows shutdown requested.".to_string(),
        )),
        "restart" | "reboot" => Ok((
            "shutdown".to_string(),
            vec!["/r".to_string(), "/t".to_string(), "0".to_string()],
            action,
            "Windows restart requested.".to_string(),
        )),
        other => bail!("system.control action `{other}` is not supported on Windows yet"),
    }
}

fn run_powershell_json(script: &str, args: &[String], context: &str) -> Result<Value> {
    let stdout = run_powershell_script(script, args, context)?;
    serde_json::from_str::<Value>(stdout.trim())
        .with_context(|| format!("failed to parse PowerShell JSON output for {context}"))
}

fn run_powershell_script(script: &str, args: &[String], context: &str) -> Result<String> {
    let output = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-STA")
        .arg("-Command")
        .arg(script)
        .args(args)
        .output()
        .with_context(|| format!("failed to launch PowerShell for {context}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        bail!(
            "{} failed: {}{}{}",
            context,
            stderr.trim(),
            if !stderr.trim().is_empty() && !stdout.trim().is_empty() {
                " | "
            } else {
                ""
            },
            stdout.trim()
        );
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn normalize_windows_mouse_button_name(button: &str) -> Result<&'static str> {
    match button.trim().to_lowercase().as_str() {
        "" | "left" => Ok("left"),
        "right" => Ok("right"),
        "middle" | "center" => Ok("middle"),
        other => bail!("unsupported mouse button for Windows: {other}"),
    }
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

fn build_windows_modifier_key_codes(modifiers: &[String]) -> Result<Vec<u16>> {
    let mut codes = Vec::new();
    for modifier in modifiers {
        let code = resolve_windows_modifier_key_code(modifier)?;
        if !codes.contains(&code) {
            codes.push(code);
        }
    }
    Ok(codes)
}

fn resolve_windows_modifier_key_code(modifier: &str) -> Result<u16> {
    let normalized = modifier.trim().to_lowercase();
    match normalized.as_str() {
        "control" | "ctrl" | "leftcontrol" | "leftctrl" => Ok(0xA2),
        "rightcontrol" | "rightctrl" => Ok(0xA3),
        "shift" | "leftshift" => Ok(0xA0),
        "rightshift" => Ok(0xA1),
        "alt" | "option" | "leftalt" | "leftoption" => Ok(0xA4),
        "rightalt" | "rightoption" => Ok(0xA5),
        "meta" | "super" | "cmd" | "command" | "leftcommand" | "leftsuper" | "win" | "windows" => {
            Ok(0x5B)
        }
        "rightcommand" | "rightsuper" => Ok(0x5C),
        other => bail!("unsupported keyboard modifier for Windows: {other}"),
    }
}

fn resolve_windows_virtual_key_code(key: &str) -> Result<u16> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        bail!("keyboard key must not be empty");
    }

    if trimmed.chars().count() == 1 {
        let ch = trimmed.chars().next().expect("single-char key");
        if ch.is_ascii_alphabetic() {
            return Ok(ch.to_ascii_uppercase() as u16);
        }
        if ch.is_ascii_digit() {
            return Ok(ch as u16);
        }
    }

    let normalized = trimmed
        .to_lowercase()
        .replace('_', "")
        .replace('-', "")
        .replace(' ', "");

    let code = match normalized.as_str() {
        "backspace" | "deletebackward" => Some(0x08),
        "tab" => Some(0x09),
        "enter" | "return" => Some(0x0D),
        "pause" => Some(0x13),
        "capslock" => Some(0x14),
        "escape" | "esc" => Some(0x1B),
        "space" | "spacebar" => Some(0x20),
        "pageup" => Some(0x21),
        "pagedown" => Some(0x22),
        "end" => Some(0x23),
        "home" => Some(0x24),
        "left" | "leftarrow" => Some(0x25),
        "up" | "uparrow" => Some(0x26),
        "right" | "rightarrow" => Some(0x27),
        "down" | "downarrow" => Some(0x28),
        "insert" => Some(0x2D),
        "delete" | "forwarddelete" => Some(0x2E),
        "f1" => Some(0x70),
        "f2" => Some(0x71),
        "f3" => Some(0x72),
        "f4" => Some(0x73),
        "f5" => Some(0x74),
        "f6" => Some(0x75),
        "f7" => Some(0x76),
        "f8" => Some(0x77),
        "f9" => Some(0x78),
        "f10" => Some(0x79),
        "f11" => Some(0x7A),
        "f12" => Some(0x7B),
        "f13" => Some(0x7C),
        "f14" => Some(0x7D),
        "f15" => Some(0x7E),
        "f16" => Some(0x7F),
        "f17" => Some(0x80),
        "f18" => Some(0x81),
        "f19" => Some(0x82),
        "f20" => Some(0x83),
        "f21" => Some(0x84),
        "f22" => Some(0x85),
        "f23" => Some(0x86),
        "f24" => Some(0x87),
        "numlock" => Some(0x90),
        "scrolllock" => Some(0x91),
        "leftshift" => Some(0xA0),
        "rightshift" => Some(0xA1),
        "leftcontrol" | "leftctrl" => Some(0xA2),
        "rightcontrol" | "rightctrl" => Some(0xA3),
        "leftalt" | "leftoption" => Some(0xA4),
        "rightalt" | "rightoption" => Some(0xA5),
        "leftwin" | "leftwindows" | "leftcommand" | "leftsuper" => Some(0x5B),
        "rightwin" | "rightwindows" | "rightcommand" | "rightsuper" => Some(0x5C),
        other => {
            if let Some(stripped) = other.strip_prefix("numpad") {
                match stripped {
                    "0" => Some(0x60),
                    "1" => Some(0x61),
                    "2" => Some(0x62),
                    "3" => Some(0x63),
                    "4" => Some(0x64),
                    "5" => Some(0x65),
                    "6" => Some(0x66),
                    "7" => Some(0x67),
                    "8" => Some(0x68),
                    "9" => Some(0x69),
                    "multiply" => Some(0x6A),
                    "add" => Some(0x6B),
                    "separator" => Some(0x6C),
                    "subtract" => Some(0x6D),
                    "decimal" => Some(0x6E),
                    "divide" => Some(0x6F),
                    _ => None,
                }
            } else {
                None
            }
        }
    };

    code.ok_or_else(|| anyhow::anyhow!("unsupported keyboard key for Windows: {trimmed}"))
}

fn resolve_screen_output_path(output_path: Option<&str>) -> String {
    match output_path {
        Some(path) if !path.trim().is_empty() => {
            let candidate = Path::new(path);
            if should_treat_as_output_directory(candidate) {
                candidate
                    .join(build_generated_capture_name("yeonjang-screen", "png"))
                    .display()
                    .to_string()
            } else {
                path.to_string()
            }
        }
        _ => {
            env::temp_dir()
                .join(build_generated_capture_name("yeonjang-screen", "png"))
                .display()
                .to_string()
        }
    }
}

fn resolve_camera_output_path(output_path: Option<&str>) -> String {
    match output_path {
        Some(path) if !path.trim().is_empty() => {
            let candidate = Path::new(path);
            if should_treat_as_output_directory(candidate) {
                candidate
                    .join(build_generated_capture_name("yeonjang-camera", "jpg"))
                    .display()
                    .to_string()
            } else {
                path.to_string()
            }
        }
        _ => {
            env::temp_dir()
                .join(build_generated_capture_name("yeonjang-camera", "jpg"))
                .display()
                .to_string()
        }
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
    raw.ends_with('\\') || raw.ends_with('/') || path.is_dir() || path.extension().is_none()
}

struct FileMetadata {
    file_name: Option<String>,
    file_extension: Option<String>,
    mime_type: Option<String>,
    size_bytes: Option<u64>,
    transfer_encoding: Option<String>,
}

fn build_file_metadata(
    output_path: &str,
    inline_base64: bool,
    default_mime_type: &str,
) -> FileMetadata {
    let path = Path::new(output_path);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned);
    let file_extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned);
    let size_bytes = fs::metadata(path).map(|metadata| metadata.len()).ok();

    FileMetadata {
        file_name,
        file_extension,
        mime_type: Some(default_mime_type.to_string()),
        size_bytes,
        transfer_encoding: if inline_base64 {
            Some("base64".to_string())
        } else {
            Some("file".to_string())
        },
    }
}

fn parse_windows_camera_devices(value: &Value) -> Result<Vec<CameraDevice>> {
    let items = match value {
        Value::Array(items) => items.clone(),
        Value::Null => Vec::new(),
        other => vec![other.clone()],
    };

    let mut cameras = Vec::new();
    for item in items {
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        let name = item
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);

        let (id, name) = match (id, name) {
            (Some(id), Some(name)) => (id, name),
            _ => continue,
        };

        let position = item
            .get("position")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        let available = item
            .get("available")
            .and_then(Value::as_bool)
            .unwrap_or(true);

        cameras.push(CameraDevice {
            id,
            name,
            position,
            available,
        });
    }

    Ok(cameras)
}

const WINDOWS_APPLICATION_LAUNCH_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$application = $args[0]
$argumentsJson = if ($args.Count -gt 1) { $args[1] } else { '[]' }
$workingDirectory = if ($args.Count -gt 2) { $args[2] } else { '' }
$argumentList = @()
if (-not [string]::IsNullOrWhiteSpace($argumentsJson)) {
  $parsed = ConvertFrom-Json -InputObject $argumentsJson
  if ($null -ne $parsed) {
    if ($parsed -is [System.Array]) {
      $argumentList = [string[]]$parsed
    } else {
      $argumentList = @([string]$parsed)
    }
  }
}
$startArgs = @{
  FilePath = $application
  PassThru = $true
}
if ($argumentList.Count -gt 0) {
  $startArgs['ArgumentList'] = $argumentList
}
if (-not [string]::IsNullOrWhiteSpace($workingDirectory)) {
  $startArgs['WorkingDirectory'] = $workingDirectory
}
$process = Start-Process @startArgs
[pscustomobject]@{
  pid = if ($null -ne $process) { $process.Id } else { $null }
} | ConvertTo-Json -Compress
"#;

const WINDOWS_CAMERA_LIST_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType=WindowsRuntime]
$null = [Windows.Devices.Enumeration.DeviceClass, Windows.Devices.Enumeration, ContentType=WindowsRuntime]
$items = New-Object System.Collections.ArrayList
$seen = @{}
function Add-Camera([string]$id, [string]$name, [string]$position = $null) {
  if ([string]::IsNullOrWhiteSpace($id) -or [string]::IsNullOrWhiteSpace($name)) {
    return
  }
  if ($seen.ContainsKey($id)) {
    return
  }
  $seen[$id] = $true
  [void]$items.Add([pscustomobject]@{
    id = $id
    name = $name
    position = if ([string]::IsNullOrWhiteSpace($position)) { $null } else { $position }
    available = $true
  })
}
try {
  $findAsync = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Enumeration.DeviceClass]::VideoCapture)
  $devices = [System.WindowsRuntimeSystemExtensions]::AsTask($findAsync).GetAwaiter().GetResult()
  foreach ($device in $devices) {
    $position = $null
    try {
      if ($null -ne $device.EnclosureLocation) {
        $panel = $device.EnclosureLocation.Panel.ToString()
        switch ($panel) {
          'Front' { $position = 'front' }
          'Back' { $position = 'back' }
          default { $position = $panel.ToLowerInvariant() }
        }
      }
    } catch {
    }
    Add-Camera $device.Id $device.Name $position
  }
} catch {
}
if ($items.Count -eq 0) {
  try {
  foreach ($device in (Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object { $_.Class -in @('Camera', 'Image') })) {
    $id = if (-not [string]::IsNullOrWhiteSpace($device.InstanceId)) { $device.InstanceId } else { $device.DeviceID }
    $name = if (-not [string]::IsNullOrWhiteSpace($device.FriendlyName)) { $device.FriendlyName } else { $device.Name }
    Add-Camera $id $name $null
  }
  } catch {
  }
}
if ($items.Count -eq 0) {
  try {
    foreach ($device in (Get-CimInstance Win32_PnPEntity -ErrorAction Stop | Where-Object { $_.PNPClass -in @('Camera', 'Image') -or $_.Service -eq 'usbvideo' })) {
      $id = if (-not [string]::IsNullOrWhiteSpace($device.DeviceID)) { $device.DeviceID } else { $device.PNPDeviceID }
      $name = if (-not [string]::IsNullOrWhiteSpace($device.Name)) { $device.Name } else { $device.Caption }
      Add-Camera $id $name $null
    }
  } catch {
  }
}
$items | ConvertTo-Json -Compress
"#;

const WINDOWS_CAMERA_CAPTURE_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Capture.CameraCaptureUI, Windows.Media.Capture, ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Storage.FileIO, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType=WindowsRuntime]
$outputPath = [System.IO.Path]::GetFullPath($args[0])
$directory = [System.IO.Path]::GetDirectoryName($outputPath)
if (-not [string]::IsNullOrWhiteSpace($directory)) {
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
}
$ui = New-Object Windows.Media.Capture.CameraCaptureUI
$ui.PhotoSettings.AllowCropping = $false
$ui.PhotoSettings.Format = [Windows.Media.Capture.CameraCaptureUIPhotoFormat]::Jpeg
$captureAsync = $ui.CaptureFileAsync([Windows.Media.Capture.CameraCaptureUIMode]::Photo)
$file = [System.WindowsRuntimeSystemExtensions]::AsTask($captureAsync).GetAwaiter().GetResult()
if ($null -eq $file) {
  throw 'Camera capture was cancelled or failed.'
}
$bufferAsync = [Windows.Storage.FileIO]::ReadBufferAsync($file)
$buffer = [System.WindowsRuntimeSystemExtensions]::AsTask($bufferAsync).GetAwaiter().GetResult()
$reader = [Windows.Storage.Streams.DataReader]::FromBuffer($buffer)
$bytes = New-Object byte[] ([int]$buffer.Length)
$reader.ReadBytes($bytes)
[System.IO.File]::WriteAllBytes($outputPath, $bytes)
[pscustomobject]@{
  deviceId = $null
  mimeType = 'image/jpeg'
  base64Data = [Convert]::ToBase64String($bytes)
} | ConvertTo-Json -Compress
"#;

const WINDOWS_CAMERA_CAPTURE_DEVICE_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Capture.MediaCapture, Windows.Media.Capture, ContentType=WindowsRuntime]
$null = [Windows.Media.Capture.MediaCaptureInitializationSettings, Windows.Media.Capture, ContentType=WindowsRuntime]
$null = [Windows.Media.Capture.StreamingCaptureMode, Windows.Media.Capture, ContentType=WindowsRuntime]
$null = [Windows.Media.MediaProperties.ImageEncodingProperties, Windows.Media.MediaProperties, ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFolder, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Storage.CreationCollisionOption, Windows.Storage, ContentType=WindowsRuntime]
$outputPath = [System.IO.Path]::GetFullPath($args[0])
$deviceId = $args[1]
if ([string]::IsNullOrWhiteSpace($deviceId)) {
  throw 'A non-empty device_id is required for explicit Windows camera capture.'
}
$directory = [System.IO.Path]::GetDirectoryName($outputPath)
if (-not [string]::IsNullOrWhiteSpace($directory)) {
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
}
$fileName = [System.IO.Path]::GetFileName($outputPath)
$settings = New-Object Windows.Media.Capture.MediaCaptureInitializationSettings
$settings.StreamingCaptureMode = [Windows.Media.Capture.StreamingCaptureMode]::Video
$settings.VideoDeviceId = $deviceId
$mediaCapture = New-Object Windows.Media.Capture.MediaCapture
try {
  $initializeAsync = $mediaCapture.InitializeAsync($settings)
  [System.WindowsRuntimeSystemExtensions]::AsTask($initializeAsync).GetAwaiter().GetResult() | Out-Null
  $folderAsync = [Windows.Storage.StorageFolder]::GetFolderFromPathAsync($directory)
  $folder = [System.WindowsRuntimeSystemExtensions]::AsTask($folderAsync).GetAwaiter().GetResult()
  $fileAsync = $folder.CreateFileAsync($fileName, [Windows.Storage.CreationCollisionOption]::ReplaceExisting)
  $file = [System.WindowsRuntimeSystemExtensions]::AsTask($fileAsync).GetAwaiter().GetResult()
  $encoding = [Windows.Media.MediaProperties.ImageEncodingProperties]::CreateJpeg()
  $captureAsync = $mediaCapture.CapturePhotoToStorageFileAsync($encoding, $file)
  [System.WindowsRuntimeSystemExtensions]::AsTask($captureAsync).GetAwaiter().GetResult() | Out-Null
} finally {
  if ($null -ne $mediaCapture) {
    $mediaCapture.Dispose()
  }
}
$bytes = [System.IO.File]::ReadAllBytes($outputPath)
[pscustomobject]@{
  deviceId = $deviceId
  mimeType = 'image/jpeg'
  base64Data = [Convert]::ToBase64String($bytes)
} | ConvertTo-Json -Compress
"#;

const WINDOWS_SCREEN_CAPTURE_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$outputPath = $args[0]
$displayArg = if ($args.Count -gt 1) { $args[1] } else { '' }
$directory = [System.IO.Path]::GetDirectoryName($outputPath)
if (-not [string]::IsNullOrWhiteSpace($directory)) {
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
}
$screens = [System.Windows.Forms.Screen]::AllScreens
if ($screens.Length -eq 0) {
  throw 'No screens are available for capture.'
}
if (-not [string]::IsNullOrWhiteSpace($displayArg)) {
  $index = [int]$displayArg
  if ($index -lt 0 -or $index -ge $screens.Length) {
    throw "Display index out of range: $index"
  }
  $bounds = $screens[$index].Bounds
} else {
  $minX = ($screens | ForEach-Object { $_.Bounds.X } | Measure-Object -Minimum).Minimum
  $minY = ($screens | ForEach-Object { $_.Bounds.Y } | Measure-Object -Minimum).Minimum
  $maxRight = ($screens | ForEach-Object { $_.Bounds.Right } | Measure-Object -Maximum).Maximum
  $maxBottom = ($screens | ForEach-Object { $_.Bounds.Bottom } | Measure-Object -Maximum).Maximum
  $bounds = New-Object System.Drawing.Rectangle($minX, $minY, ($maxRight - $minX), ($maxBottom - $minY))
}
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bitmap.Size)
  $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
$bytes = [System.IO.File]::ReadAllBytes($outputPath)
[pscustomobject]@{
  mimeType = 'image/png'
  base64Data = [Convert]::ToBase64String($bytes)
} | ConvertTo-Json -Compress
"#;

const WINDOWS_MOUSE_ACTION_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$action = $args[0]
$xArg = if ($args.Count -gt 1) { $args[1] } else { '' }
$yArg = if ($args.Count -gt 2) { $args[2] } else { '' }
$button = if ($args.Count -gt 3 -and -not [string]::IsNullOrWhiteSpace($args[3])) { $args[3] } else { 'left' }
$deltaXArg = if ($args.Count -gt 4) { $args[4] } else { '' }
$deltaYArg = if ($args.Count -gt 5) { $args[5] } else { '' }
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class YeonjangMouseNative {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
"@
$LEFTDOWN = 0x0002
$LEFTUP = 0x0004
$RIGHTDOWN = 0x0008
$RIGHTUP = 0x0010
$MIDDLEDOWN = 0x0020
$MIDDLEUP = 0x0040
$WHEEL = 0x0800
$HWHEEL = 0x01000
function Move-Cursor([string]$xValue, [string]$yValue) {
  if ([string]::IsNullOrWhiteSpace($xValue) -or [string]::IsNullOrWhiteSpace($yValue)) {
    throw 'mouse action requires both x and y coordinates.'
  }
  [YeonjangMouseNative]::SetCursorPos([int]$xValue, [int]$yValue) | Out-Null
  Start-Sleep -Milliseconds 10
}
function Get-Flags([string]$buttonName) {
  switch ($buttonName.ToLowerInvariant()) {
    'right' { return @($RIGHTDOWN, $RIGHTUP) }
    'middle' { return @($MIDDLEDOWN, $MIDDLEUP) }
    default { return @($LEFTDOWN, $LEFTUP) }
  }
}
switch ($action) {
  'move' {
    Move-Cursor $xArg $yArg
  }
  'click' {
    Move-Cursor $xArg $yArg
    $flags = Get-Flags $button
    [YeonjangMouseNative]::mouse_event([uint32]$flags[0], 0, 0, 0, [UIntPtr]::Zero)
    [YeonjangMouseNative]::mouse_event([uint32]$flags[1], 0, 0, 0, [UIntPtr]::Zero)
  }
  'double_click' {
    Move-Cursor $xArg $yArg
    $flags = Get-Flags $button
    1..2 | ForEach-Object {
      [YeonjangMouseNative]::mouse_event([uint32]$flags[0], 0, 0, 0, [UIntPtr]::Zero)
      [YeonjangMouseNative]::mouse_event([uint32]$flags[1], 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 30
    }
  }
  'button_down' {
    if (-not [string]::IsNullOrWhiteSpace($xArg) -and -not [string]::IsNullOrWhiteSpace($yArg)) {
      Move-Cursor $xArg $yArg
    }
    $flags = Get-Flags $button
    [YeonjangMouseNative]::mouse_event([uint32]$flags[0], 0, 0, 0, [UIntPtr]::Zero)
  }
  'button_up' {
    if (-not [string]::IsNullOrWhiteSpace($xArg) -and -not [string]::IsNullOrWhiteSpace($yArg)) {
      Move-Cursor $xArg $yArg
    }
    $flags = Get-Flags $button
    [YeonjangMouseNative]::mouse_event([uint32]$flags[1], 0, 0, 0, [UIntPtr]::Zero)
  }
  'scroll' {
    if (-not [string]::IsNullOrWhiteSpace($xArg) -and -not [string]::IsNullOrWhiteSpace($yArg)) {
      Move-Cursor $xArg $yArg
    }
    if (-not [string]::IsNullOrWhiteSpace($deltaYArg)) {
      [YeonjangMouseNative]::mouse_event([uint32]$WHEEL, 0, 0, [uint32][int32]$deltaYArg, [UIntPtr]::Zero)
    }
    if (-not [string]::IsNullOrWhiteSpace($deltaXArg)) {
      [YeonjangMouseNative]::mouse_event([uint32]$HWHEEL, 0, 0, [uint32][int32]$deltaXArg, [UIntPtr]::Zero)
    }
  }
  default {
    throw "Unsupported mouse action: $action"
  }
}
"#;

const WINDOWS_KEYBOARD_TYPE_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$text = $args[0]
function Escape-SendKeysText([string]$value) {
  $builder = New-Object System.Text.StringBuilder
  foreach ($char in $value.ToCharArray()) {
    switch ($char) {
      '+' { [void]$builder.Append('{+}') }
      '^' { [void]$builder.Append('{^}') }
      '%' { [void]$builder.Append('{%}') }
      '~' { [void]$builder.Append('{~}') }
      '(' { [void]$builder.Append('{(}') }
      ')' { [void]$builder.Append('{)}') }
      '{' { [void]$builder.Append('{{}') }
      '}' { [void]$builder.Append('{}}') }
      default { [void]$builder.Append($char) }
    }
  }
  return $builder.ToString()
}
[System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeysText $text))
"#;

const WINDOWS_KEYBOARD_ACTION_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$action = $args[0]
$keyCode = [byte]$args[1]
$modifierCodes = @()
if ($args.Count -gt 2 -and -not [string]::IsNullOrWhiteSpace($args[2])) {
  $parsed = ConvertFrom-Json -InputObject $args[2]
  if ($parsed -is [System.Array]) {
    $modifierCodes = [byte[]]$parsed
  } elseif ($null -ne $parsed) {
    $modifierCodes = @([byte]$parsed)
  }
}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class YeonjangKeyboardNative {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
}
"@
$KEYEVENTF_KEYUP = 0x0002
function Press-Key([byte]$code) {
  [YeonjangKeyboardNative]::keybd_event($code, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 8
}
function Release-Key([byte]$code) {
  [YeonjangKeyboardNative]::keybd_event($code, 0, [uint32]$KEYEVENTF_KEYUP, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 8
}
function Press-Modifiers([byte[]]$codes) {
  foreach ($code in $codes) {
    Press-Key $code
  }
}
function Release-Modifiers([byte[]]$codes) {
  for ($index = $codes.Length - 1; $index -ge 0; $index--) {
    Release-Key $codes[$index]
  }
}
switch ($action) {
  'shortcut' {
    Press-Modifiers $modifierCodes
    Press-Key $keyCode
    Release-Key $keyCode
    Release-Modifiers $modifierCodes
  }
  'key_press' {
    Press-Modifiers $modifierCodes
    Press-Key $keyCode
    Release-Key $keyCode
    Release-Modifiers $modifierCodes
  }
  'key_down' {
    Press-Modifiers $modifierCodes
    Press-Key $keyCode
  }
  'key_up' {
    Release-Key $keyCode
    Release-Modifiers $modifierCodes
  }
  default {
    throw "Unsupported keyboard action: $action"
  }
}
"#;

#[cfg(test)]
mod tests {
    use super::{
        PlatformBackend, WindowsCameraCaptureHelperRequest, build_windows_modifier_key_codes,
        normalize_windows_mouse_button_name, parse_windows_camera_devices,
        parse_windows_camera_capture_helper_request, resolve_optional_mouse_point,
        resolve_windows_modifier_key_code, resolve_windows_virtual_key_code,
    };
    use crate::automation::AutomationBackend;
    use serde_json::json;

    #[test]
    fn resolves_letter_key_to_virtual_code() {
        let result = resolve_windows_virtual_key_code("c").expect("letter key should resolve");
        assert_eq!(result, 0x43);
    }

    #[test]
    fn resolves_named_key_to_virtual_code() {
        let result =
            resolve_windows_virtual_key_code("RightArrow").expect("arrow key should resolve");
        assert_eq!(result, 0x27);
    }

    #[test]
    fn resolves_modifier_key_code() {
        let result = resolve_windows_modifier_key_code("Command").expect("command modifier");
        assert_eq!(result, 0x5B);
    }

    #[test]
    fn builds_deduplicated_modifier_key_codes() {
        let codes = build_windows_modifier_key_codes(&[
            "Command".to_string(),
            "LeftControl".to_string(),
            "cmd".to_string(),
        ])
        .expect("modifier key codes should resolve");

        assert_eq!(codes, vec![0x5B, 0xA2]);
    }

    #[test]
    fn normalizes_mouse_button_aliases() {
        assert_eq!(
            normalize_windows_mouse_button_name("center").expect("center button"),
            "middle"
        );
        assert_eq!(
            normalize_windows_mouse_button_name("left").expect("left button"),
            "left"
        );
    }

    #[test]
    fn optional_mouse_point_requires_both_coordinates() {
        let error = resolve_optional_mouse_point(Some(10), None, "button_down")
            .expect_err("partial point should fail");
        assert!(
            error
                .to_string()
                .contains("requires both `x` and `y` when coordinates are provided")
        );
    }

    #[test]
    fn parses_camera_device_array() {
        let result = parse_windows_camera_devices(&json!([
            { "id": "cam-1", "name": "Integrated Camera", "available": true },
            { "id": "cam-2", "name": "USB Camera", "position": "external", "available": true }
        ]))
        .expect("camera list should parse");

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].id, "cam-1");
        assert_eq!(result[1].position.as_deref(), Some("external"));
    }

    #[test]
    fn ignores_invalid_camera_entries() {
        let result = parse_windows_camera_devices(&json!([
            { "id": "", "name": "Invalid Camera" },
            { "id": "cam-1", "name": "" },
            { "id": "cam-2", "name": "USB Camera" }
        ]))
        .expect("camera list should parse");

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "cam-2");
    }

    #[test]
    fn windows_capabilities_report_camera_management() {
        let capabilities = PlatformBackend.capabilities();
        assert!(capabilities.camera_management);
    }

    #[test]
    fn parses_camera_capture_helper_args_with_device_id() {
        let parsed = parse_windows_camera_capture_helper_request(vec![
            "capture.jpg".to_string(),
            "--device-id".to_string(),
            "camera-1".to_string(),
            "--inline-base64".to_string(),
        ])
        .expect("camera helper args should parse");

        assert_eq!(
            parsed,
            WindowsCameraCaptureHelperRequest {
                output_path: "capture.jpg".to_string(),
                device_id: Some("camera-1".to_string()),
                inline_base64: true,
            }
        );
    }
}
