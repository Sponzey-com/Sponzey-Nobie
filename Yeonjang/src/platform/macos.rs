use std::env;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
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
        PlatformKind::Macos
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
            system_control: false,
        }
    }

    fn system_info(&self) -> Result<SystemSnapshot> {
        Ok(shared::collect_system_info(self.platform_kind()))
    }

    fn control_system(&self, request: SystemControlRequest) -> Result<SystemControlResult> {
        bail!(
            "{}",
            shared::not_implemented(
                &format!("system.control(action={})", request.action),
                self.platform_kind()
            )
        )
    }

    fn execute_command(&self, request: CommandExecutionRequest) -> Result<CommandExecutionResult> {
        shared::execute_command(request)
    }

    fn launch_application(
        &self,
        request: ApplicationLaunchRequest,
    ) -> Result<ApplicationLaunchResult> {
        shared::validate_application_request(&request)?;

        let mut command = Command::new("open");
        command.arg("-a").arg(&request.application);
        if !request.args.is_empty() {
            command.arg("--args");
            command.args(&request.args);
        }
        if let Some(cwd) = &request.cwd {
            command.current_dir(cwd);
        }

        let output = command
            .output()
            .with_context(|| format!("failed to launch application `{}`", request.application))?;

        if !output.status.success() {
            bail!(
                "application launch failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        Ok(ApplicationLaunchResult {
            launched: true,
            application: request.application,
            pid: None,
            message: if request.detached {
                "Application launch requested in detached mode.".to_string()
            } else {
                "Application launch requested.".to_string()
            },
        })
    }

    fn list_cameras(&self) -> Result<Vec<CameraDevice>> {
        let output = Command::new("system_profiler")
            .args(["SPCameraDataType", "-json"])
            .output()
            .context("failed to run system_profiler for camera discovery")?;

        if !output.status.success() {
            bail!(
                "camera discovery failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        let payload: Value = serde_json::from_slice(&output.stdout)
            .context("failed to parse system_profiler output")?;
        let items = payload
            .get("SPCameraDataType")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        let cameras = items
            .into_iter()
            .enumerate()
            .map(|(index, item)| {
                let name = item
                    .get("_name")
                    .and_then(Value::as_str)
                    .or_else(|| item.get("name").and_then(Value::as_str))
                    .unwrap_or("Camera")
                    .to_string();
                let id = item
                    .get("spcamera_unique-id")
                    .and_then(Value::as_str)
                    .or_else(|| item.get("spcamera_model-id").and_then(Value::as_str))
                    .or_else(|| item.get("id").and_then(Value::as_str))
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| format!("camera-{}-{}", index + 1, slugify(&name)));
                let position = item
                    .get("spcamera_position")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);

                CameraDevice {
                    id,
                    name,
                    position,
                    available: true,
                }
            })
            .collect();

        Ok(cameras)
    }

    fn capture_camera(&self, request: CameraCaptureRequest) -> Result<CameraCaptureResult> {
        shared::validate_camera_request(&request)?;
        let inline_base64 = true;

        let output_path = resolve_camera_output_path(request.output_path.as_deref())?;
        let script_path = write_swift_camera_script()?;
        let mut command = Command::new("xcrun");
        command.arg("swift").arg(&script_path).arg(&output_path);
        if let Some(device_id) = request.device_id.as_deref() {
            command.arg(device_id);
        }
        command.arg("--inline-base64");

        let output = command.output().with_context(|| {
            format!(
                "failed to execute camera capture helper: {}",
                script_path.display()
            )
        })?;

        let _ = fs::remove_file(&script_path);

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

        let parsed: Value = serde_json::from_slice(&output.stdout)
            .context("failed to parse camera capture helper output")?;
        let actual_device_id = parsed
            .get("deviceId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or(request.device_id.clone());
        let metadata = build_file_metadata(&output_path, inline_base64, "image/jpeg");
        let base64_data = parsed
            .get("base64Data")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .context("camera capture must include inline base64 data")?;
        let should_cleanup = true;
        if should_cleanup {
            let _ = fs::remove_file(&output_path);
        }

        Ok(CameraCaptureResult {
            device_id: actual_device_id,
            output_path: None,
            file_name: metadata.file_name,
            file_extension: metadata.file_extension,
            mime_type: parsed
                .get("mimeType")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .or(metadata.mime_type),
            size_bytes: metadata.size_bytes,
            transfer_encoding: metadata.transfer_encoding,
            base64_data: Some(base64_data),
            message: "Camera capture completed.".to_string(),
        })
    }

    fn capture_screen(&self, request: ScreenCaptureRequest) -> Result<ScreenCaptureResult> {
        shared::validate_screen_request(&request)?;
        let inline_base64 = true;
        let (output_path, _explicit_output_path) =
            resolve_screen_output_path(request.output_path.as_deref())?;
        let script_path = write_swift_screen_script()?;

        let mut command = Command::new("xcrun");
        command.arg("swift").arg(&script_path).arg(&output_path);
        if let Some(display) = request.display {
            command.arg("--display").arg(display.to_string());
        }
        command.arg("--inline-base64");

        let output = command.output().with_context(|| {
            format!(
                "failed to execute screen capture helper: {}",
                script_path.display()
            )
        })?;

        let _ = fs::remove_file(&script_path);

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            bail!(
                "screen capture failed: {}{}{}",
                stderr.trim(),
                if !stderr.trim().is_empty() && !stdout.trim().is_empty() {
                    " | "
                } else {
                    ""
                },
                stdout.trim()
            );
        }

        let parsed: Value = serde_json::from_slice(&output.stdout)
            .context("failed to parse screen capture helper output")?;

        let metadata = build_file_metadata(&output_path, inline_base64, "image/png");
        let base64_data = parsed
            .get("base64Data")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .context("screen capture must include inline base64 data")?;
        let should_cleanup = true;
        if should_cleanup {
            let _ = fs::remove_file(&output_path);
        }

        Ok(ScreenCaptureResult {
            display: request.display,
            output_path: None,
            file_name: metadata.file_name,
            file_extension: metadata.file_extension,
            mime_type: parsed
                .get("mimeType")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .or(metadata.mime_type),
            size_bytes: metadata.size_bytes,
            transfer_encoding: metadata.transfer_encoding,
            base64_data: Some(base64_data),
            message: "Screen capture completed.".to_string(),
        })
    }

    fn move_mouse(&self, request: MouseMoveRequest) -> Result<MouseMoveResult> {
        shared::validate_mouse_move(&request)?;
        move_mouse_via_core_graphics(request.x, request.y)?;
        Ok(MouseMoveResult {
            moved: true,
            x: request.x,
            y: request.y,
            message: "Mouse move completed.".to_string(),
        })
    }

    fn click_mouse(&self, request: MouseClickRequest) -> Result<MouseClickResult> {
        shared::validate_mouse_click(&request)?;
        let button = normalize_mouse_button_name(&request.button)?;
        click_mouse_via_core_graphics(request.x, request.y, button, request.double)?;
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
                let button = normalize_mouse_button_name(&request.button)?;
                run_mouse_action_helper(build_mouse_action_helper_args(
                    request.action,
                    point,
                    button,
                    None,
                    None,
                ))?;
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
                run_mouse_action_helper(build_mouse_action_helper_args(
                    request.action,
                    point,
                    "left",
                    Some(delta_x),
                    Some(delta_y),
                ))?;
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
        type_text_via_system_events(&request.text)?;
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
            KeyboardActionKind::Shortcut => {
                let key = request.key.unwrap_or_default();
                if key.trim().is_empty() {
                    bail!("keyboard.action `shortcut` requires non-empty `key`");
                }
                trigger_shortcut_via_system_events(&key, &request.modifiers)?;
                Ok(KeyboardActionResult {
                    accepted: true,
                    action: KeyboardActionKind::Shortcut,
                    text_len: None,
                    key: Some(key),
                    modifiers: request.modifiers,
                    message: "Keyboard shortcut completed.".to_string(),
                })
            }
            KeyboardActionKind::KeyPress
            | KeyboardActionKind::KeyDown
            | KeyboardActionKind::KeyUp => {
                let key = request.key.unwrap_or_default();
                if key.trim().is_empty() {
                    bail!(
                        "keyboard.action `{}` requires non-empty `key`",
                        request.action.as_str()
                    );
                }
                perform_keyboard_key_action_via_core_graphics(
                    request.action,
                    &key,
                    &request.modifiers,
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
enum MacosKeyboardTarget {
    Keystroke(String),
    KeyCode(u16),
}

fn run_osascript(script: &str) -> Result<()> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .with_context(|| "failed to execute osascript for keyboard control".to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        bail!(
            "keyboard automation failed: {}{}{}",
            stderr.trim(),
            if !stderr.trim().is_empty() && !stdout.trim().is_empty() {
                " | "
            } else {
                ""
            },
            stdout.trim()
        );
    }

    Ok(())
}

fn type_text_via_system_events(text: &str) -> Result<()> {
    let script = format!(
        "tell application \"System Events\" to keystroke {}",
        apple_script_string_literal(text)
    );
    run_osascript(&script)
}

fn trigger_shortcut_via_system_events(key: &str, modifiers: &[String]) -> Result<()> {
    let target = resolve_macos_keyboard_target(key)?;
    let using_clause = build_modifier_clause(modifiers)?;
    let key_expr = match target {
        MacosKeyboardTarget::Keystroke(text) => {
            format!("keystroke {}", apple_script_string_literal(&text))
        }
        MacosKeyboardTarget::KeyCode(code) => format!("key code {code}"),
    };
    let script = if using_clause.is_empty() {
        format!("tell application \"System Events\" to {key_expr}")
    } else {
        format!(
            "tell application \"System Events\" to {key_expr} using {{{}}}",
            using_clause.join(", ")
        )
    };
    run_osascript(&script)
}

fn move_mouse_via_core_graphics(x: i32, y: i32) -> Result<()> {
    run_mouse_action_helper(build_mouse_action_helper_args(
        MouseActionKind::Move,
        Some((x, y)),
        "left",
        None,
        None,
    ))
}

fn click_mouse_via_core_graphics(x: i32, y: i32, button: &str, double: bool) -> Result<()> {
    run_mouse_action_helper(build_mouse_action_helper_args(
        if double {
            MouseActionKind::DoubleClick
        } else {
            MouseActionKind::Click
        },
        Some((x, y)),
        button,
        None,
        None,
    ))
}

fn perform_keyboard_key_action_via_core_graphics(
    action: KeyboardActionKind,
    key: &str,
    modifiers: &[String],
) -> Result<()> {
    let key_code = resolve_macos_keyboard_key_code(key)?;
    let modifier_codes = build_modifier_key_codes(modifiers)?;
    let mut args = vec![
        action.as_str().to_string(),
        "--keycode".to_string(),
        key_code.to_string(),
    ];
    for modifier_code in modifier_codes {
        args.push("--modifier".to_string());
        args.push(modifier_code.to_string());
    }
    run_keyboard_action_helper(args)
}

fn run_mouse_action_helper(args: Vec<String>) -> Result<()> {
    let script_path = write_swift_mouse_action_script()?;
    let output = Command::new("xcrun")
        .arg("swift")
        .arg(&script_path)
        .args(&args)
        .output()
        .with_context(|| {
            format!(
                "failed to execute mouse automation helper: {}",
                script_path.display()
            )
        })?;

    let _ = fs::remove_file(&script_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        bail!(
            "mouse automation failed: {}{}{}",
            stderr.trim(),
            if !stderr.trim().is_empty() && !stdout.trim().is_empty() {
                " | "
            } else {
                ""
            },
            stdout.trim()
        );
    }

    Ok(())
}

fn run_keyboard_action_helper(args: Vec<String>) -> Result<()> {
    let script_path = write_swift_keyboard_action_script()?;
    let output = Command::new("xcrun")
        .arg("swift")
        .arg(&script_path)
        .args(&args)
        .output()
        .with_context(|| {
            format!(
                "failed to execute keyboard automation helper: {}",
                script_path.display()
            )
        })?;

    let _ = fs::remove_file(&script_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        bail!(
            "keyboard automation failed: {}{}{}",
            stderr.trim(),
            if !stderr.trim().is_empty() && !stdout.trim().is_empty() {
                " | "
            } else {
                ""
            },
            stdout.trim()
        );
    }

    Ok(())
}

fn build_mouse_action_helper_args(
    action: MouseActionKind,
    point: Option<(i32, i32)>,
    button: &str,
    delta_x: Option<i32>,
    delta_y: Option<i32>,
) -> Vec<String> {
    let mut args = vec![action.as_str().to_string()];
    if let Some((x, y)) = point {
        args.push("--x".to_string());
        args.push(x.to_string());
        args.push("--y".to_string());
        args.push(y.to_string());
    }
    if matches!(
        action,
        MouseActionKind::Click
            | MouseActionKind::DoubleClick
            | MouseActionKind::ButtonDown
            | MouseActionKind::ButtonUp
    ) {
        args.push("--button".to_string());
        args.push(button.to_string());
    }
    if let Some(delta_x) = delta_x {
        args.push("--delta-x".to_string());
        args.push(delta_x.to_string());
    }
    if let Some(delta_y) = delta_y {
        args.push("--delta-y".to_string());
        args.push(delta_y.to_string());
    }
    args
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

fn normalize_mouse_button_name(button: &str) -> Result<&'static str> {
    match button.trim().to_lowercase().as_str() {
        "" | "left" => Ok("left"),
        "right" => Ok("right"),
        "middle" | "center" => Ok("middle"),
        other => bail!("unsupported mouse button for macOS: {other}"),
    }
}

fn apple_script_string_literal(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

fn build_modifier_clause(modifiers: &[String]) -> Result<Vec<&'static str>> {
    let mut clauses: Vec<&'static str> = Vec::new();
    for modifier in modifiers {
        let normalized = modifier.trim().to_lowercase();
        let clause = match normalized.as_str() {
            "control" | "ctrl" | "leftcontrol" | "rightcontrol" | "leftctrl" | "rightctrl" => {
                "control down"
            }
            "shift" | "leftshift" | "rightshift" => "shift down",
            "alt" | "option" | "leftalt" | "rightalt" | "leftoption" | "rightoption" => {
                "option down"
            }
            "meta" | "super" | "cmd" | "command" | "leftcommand" | "rightcommand" | "leftsuper"
            | "rightsuper" | "win" | "windows" => "command down",
            other => bail!("unsupported keyboard modifier for macOS shortcut: {other}"),
        };
        if !clauses.contains(&clause) {
            clauses.push(clause);
        }
    }
    Ok(clauses)
}

fn resolve_macos_keyboard_target(key: &str) -> Result<MacosKeyboardTarget> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        bail!("keyboard shortcut key must not be empty");
    }

    if trimmed.chars().count() == 1 {
        return Ok(MacosKeyboardTarget::Keystroke(trimmed.to_string()));
    }

    let normalized = trimmed
        .to_lowercase()
        .replace('_', "")
        .replace('-', "")
        .replace(' ', "");

    let key_code = match normalized.as_str() {
        "enter" | "return" => Some(36),
        "tab" => Some(48),
        "space" | "spacebar" => Some(49),
        "delete" | "backspace" => Some(51),
        "esc" | "escape" => Some(53),
        "forwarddelete" => Some(117),
        "home" => Some(115),
        "end" => Some(119),
        "pageup" => Some(116),
        "pagedown" => Some(121),
        "left" | "leftarrow" => Some(123),
        "right" | "rightarrow" => Some(124),
        "down" | "downarrow" => Some(125),
        "up" | "uparrow" => Some(126),
        "f1" => Some(122),
        "f2" => Some(120),
        "f3" => Some(99),
        "f4" => Some(118),
        "f5" => Some(96),
        "f6" => Some(97),
        "f7" => Some(98),
        "f8" => Some(100),
        "f9" => Some(101),
        "f10" => Some(109),
        "f11" => Some(103),
        "f12" => Some(111),
        _ => None,
    };

    if let Some(code) = key_code {
        Ok(MacosKeyboardTarget::KeyCode(code))
    } else {
        bail!("unsupported keyboard shortcut key for macOS: {trimmed}")
    }
}

fn build_modifier_key_codes(modifiers: &[String]) -> Result<Vec<u16>> {
    let mut codes = Vec::new();
    for modifier in modifiers {
        let code = resolve_macos_modifier_key_code(modifier)?;
        if !codes.contains(&code) {
            codes.push(code);
        }
    }
    Ok(codes)
}

fn resolve_macos_modifier_key_code(modifier: &str) -> Result<u16> {
    let normalized = modifier.trim().to_lowercase();
    match normalized.as_str() {
        "control" | "ctrl" | "leftcontrol" | "leftctrl" => Ok(59),
        "rightcontrol" | "rightctrl" => Ok(62),
        "shift" | "leftshift" => Ok(56),
        "rightshift" => Ok(60),
        "alt" | "option" | "leftalt" | "leftoption" => Ok(58),
        "rightalt" | "rightoption" => Ok(61),
        "meta" | "super" | "cmd" | "command" | "leftcommand" | "leftsuper" | "win" | "windows" => {
            Ok(55)
        }
        "rightcommand" | "rightsuper" => Ok(54),
        other => bail!("unsupported keyboard modifier for macOS: {other}"),
    }
}

fn resolve_macos_keyboard_key_code(key: &str) -> Result<u16> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        bail!("keyboard key must not be empty");
    }

    let normalized = trimmed
        .to_lowercase()
        .replace('_', "")
        .replace('-', "")
        .replace(' ', "");

    let code = match normalized.as_str() {
        "a" => Some(0),
        "s" => Some(1),
        "d" => Some(2),
        "f" => Some(3),
        "h" => Some(4),
        "g" => Some(5),
        "z" => Some(6),
        "x" => Some(7),
        "c" => Some(8),
        "v" => Some(9),
        "b" => Some(11),
        "q" => Some(12),
        "w" => Some(13),
        "e" => Some(14),
        "r" => Some(15),
        "y" => Some(16),
        "t" => Some(17),
        "1" => Some(18),
        "2" => Some(19),
        "3" => Some(20),
        "4" => Some(21),
        "6" => Some(22),
        "5" => Some(23),
        "=" | "equal" => Some(24),
        "9" => Some(25),
        "7" => Some(26),
        "-" | "minus" => Some(27),
        "8" => Some(28),
        "0" => Some(29),
        "]" | "rightbracket" => Some(30),
        "o" => Some(31),
        "u" => Some(32),
        "[" | "leftbracket" => Some(33),
        "i" => Some(34),
        "p" => Some(35),
        "enter" | "return" => Some(36),
        "l" => Some(37),
        "j" => Some(38),
        "'" | "quote" | "apostrophe" => Some(39),
        "k" => Some(40),
        ";" | "semicolon" => Some(41),
        "\\" | "backslash" => Some(42),
        "," | "comma" => Some(43),
        "/" | "slash" => Some(44),
        "n" => Some(45),
        "m" => Some(46),
        "." | "period" | "dot" => Some(47),
        "tab" => Some(48),
        "space" | "spacebar" => Some(49),
        "`" | "grave" | "backtick" => Some(50),
        "delete" | "backspace" => Some(51),
        "escape" | "esc" => Some(53),
        "command" | "cmd" | "leftcommand" | "meta" | "super" => Some(55),
        "shift" | "leftshift" => Some(56),
        "capslock" => Some(57),
        "option" | "alt" | "leftoption" | "leftalt" => Some(58),
        "control" | "ctrl" | "leftcontrol" | "leftctrl" => Some(59),
        "rightshift" => Some(60),
        "rightoption" | "rightalt" => Some(61),
        "rightcontrol" | "rightctrl" => Some(62),
        "function" | "fn" => Some(63),
        "f17" => Some(64),
        "volumeup" => Some(72),
        "volumedown" => Some(73),
        "mute" => Some(74),
        "f18" => Some(79),
        "f19" => Some(80),
        "f20" => Some(90),
        "f5" => Some(96),
        "f6" => Some(97),
        "f7" => Some(98),
        "f3" => Some(99),
        "f8" => Some(100),
        "f9" => Some(101),
        "f11" => Some(103),
        "f13" => Some(105),
        "f16" => Some(106),
        "f14" => Some(107),
        "f10" => Some(109),
        "f12" => Some(111),
        "f15" => Some(113),
        "help" => Some(114),
        "home" => Some(115),
        "pageup" => Some(116),
        "forwarddelete" => Some(117),
        "f4" => Some(118),
        "end" => Some(119),
        "f2" => Some(120),
        "pagedown" => Some(121),
        "f1" => Some(122),
        "left" | "leftarrow" => Some(123),
        "right" | "rightarrow" => Some(124),
        "down" | "downarrow" => Some(125),
        "up" | "uparrow" => Some(126),
        _ => None,
    };

    code.ok_or_else(|| anyhow::anyhow!("unsupported keyboard key for macOS: {trimmed}"))
}

fn resolve_camera_output_path(output_path: Option<&str>) -> Result<String> {
    match output_path {
        Some(path) if !path.trim().is_empty() => Ok(path.to_string()),
        _ => {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            let path = env::temp_dir().join(format!("yeonjang-camera-{stamp}.jpg"));
            Ok(path.display().to_string())
        }
    }
}

fn resolve_screen_output_path(output_path: Option<&str>) -> Result<(String, bool)> {
    match output_path {
        Some(path) if !path.trim().is_empty() => Ok((path.to_string(), true)),
        _ => {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            let path = env::temp_dir().join(format!("yeonjang-screen-{stamp}.png"));
            Ok((path.display().to_string(), false))
        }
    }
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

fn write_swift_camera_script() -> Result<PathBuf> {
    let script_path = env::temp_dir().join(format!(
        "yeonjang-camera-capture-{}.swift",
        std::process::id()
    ));
    fs::write(&script_path, SWIFT_CAMERA_CAPTURE)
        .with_context(|| format!("failed to write swift helper to {}", script_path.display()))?;
    Ok(script_path)
}

fn write_swift_screen_script() -> Result<PathBuf> {
    let script_path = env::temp_dir().join(format!(
        "yeonjang-screen-capture-{}.swift",
        std::process::id()
    ));
    fs::write(&script_path, SWIFT_SCREEN_CAPTURE)
        .with_context(|| format!("failed to write swift helper to {}", script_path.display()))?;
    Ok(script_path)
}

fn write_swift_mouse_action_script() -> Result<PathBuf> {
    let script_path = env::temp_dir().join(format!(
        "yeonjang-mouse-action-{}.swift",
        std::process::id()
    ));
    fs::write(&script_path, SWIFT_MOUSE_ACTION)
        .with_context(|| format!("failed to write swift helper to {}", script_path.display()))?;
    Ok(script_path)
}

fn write_swift_keyboard_action_script() -> Result<PathBuf> {
    let script_path = env::temp_dir().join(format!(
        "yeonjang-keyboard-action-{}.swift",
        std::process::id()
    ));
    fs::write(&script_path, SWIFT_KEYBOARD_ACTION)
        .with_context(|| format!("failed to write swift helper to {}", script_path.display()))?;
    Ok(script_path)
}

fn slugify(input: &str) -> String {
    let mut result = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch.to_ascii_lowercase());
        } else if !result.ends_with('-') {
            result.push('-');
        }
    }
    let trimmed = result.trim_matches('-');
    if trimmed.is_empty() {
        "device".to_string()
    } else {
        trimmed.to_string()
    }
}

const SWIFT_CAMERA_CAPTURE: &str = r#"
import Foundation
import AVFoundation

final class PhotoDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    let destination: URL
    let semaphore: DispatchSemaphore
    var captureError: Error?

    init(destination: URL, semaphore: DispatchSemaphore) {
        self.destination = destination
        self.semaphore = semaphore
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        if let error = error {
            self.captureError = error
            return
        }
        guard let data = photo.fileDataRepresentation() else {
            self.captureError = NSError(domain: "YeonjangCamera", code: 1, userInfo: [NSLocalizedDescriptionKey: "No file data representation"])
            return
        }
        do {
            try data.write(to: destination)
        } catch {
            self.captureError = error
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: Error?) {
        if let error = error {
            self.captureError = error
        }
        semaphore.signal()
    }
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    fputs("output path argument is required\n", stderr)
    exit(2)
}

let outputPath = args[1]
let extraArgs = Array(args.dropFirst(2))
let includeBase64 = extraArgs.contains("--inline-base64")
let requestedId = extraArgs.first(where: { $0 != "--inline-base64" })
let discovery = AVCaptureDevice.DiscoverySession(
    deviceTypes: [.builtInWideAngleCamera, .externalUnknown],
    mediaType: .video,
    position: .unspecified
)

guard !discovery.devices.isEmpty else {
    fputs("No camera devices available\n", stderr)
    exit(3)
}

let device: AVCaptureDevice
if let requestedId {
    guard let matched = discovery.devices.first(where: { $0.uniqueID == requestedId || $0.localizedName == requestedId }) else {
        fputs("Requested camera device was not found\n", stderr)
        exit(4)
    }
    device = matched
} else {
    device = discovery.devices[0]
}

let session = AVCaptureSession()
session.beginConfiguration()
session.sessionPreset = .photo

let input: AVCaptureDeviceInput
do {
    input = try AVCaptureDeviceInput(device: device)
} catch {
    fputs("Failed to create camera input: \(error)\n", stderr)
    exit(5)
}

guard session.canAddInput(input) else {
    fputs("Camera input cannot be added to the session\n", stderr)
    exit(6)
}
session.addInput(input)

let photoOutput = AVCapturePhotoOutput()
guard session.canAddOutput(photoOutput) else {
    fputs("Camera output cannot be added to the session\n", stderr)
    exit(7)
}
session.addOutput(photoOutput)
session.commitConfiguration()
session.startRunning()
Thread.sleep(forTimeInterval: 0.5)

let semaphore = DispatchSemaphore(value: 0)
let delegate = PhotoDelegate(destination: URL(fileURLWithPath: outputPath), semaphore: semaphore)
photoOutput.capturePhoto(with: AVCapturePhotoSettings(), delegate: delegate)

if semaphore.wait(timeout: .now() + 15) == .timedOut {
    session.stopRunning()
    fputs("Timed out while waiting for camera capture\n", stderr)
    exit(8)
}

session.stopRunning()

if let error = delegate.captureError {
    fputs("Camera capture failed: \(error)\n", stderr)
    exit(9)
}

var payload: [String: Any] = [
    "deviceId": device.uniqueID,
    "deviceName": device.localizedName,
    "outputPath": outputPath,
    "mimeType": "image/jpeg"
]
if includeBase64 {
    payload["base64Data"] = try Data(contentsOf: URL(fileURLWithPath: outputPath)).base64EncodedString()
}
let data = try JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(data)
"#;

const SWIFT_SCREEN_CAPTURE: &str = r#"
import Foundation
import CoreGraphics

let args = Array(CommandLine.arguments.dropFirst())
guard !args.isEmpty else {
    fputs("output path argument is required\n", stderr)
    exit(2)
}

let outputPath = args[0]
var displayId: String?
var includeBase64 = false
var index = 1
while index < args.count {
    let value = args[index]
    if value == "--inline-base64" {
        includeBase64 = true
        index += 1
        continue
    }
    if value == "--display", index + 1 < args.count {
        displayId = args[index + 1]
        index += 2
        continue
    }
    index += 1
}

if !CGPreflightScreenCaptureAccess() {
    guard CGRequestScreenCaptureAccess() else {
        fputs("Screen Recording permission was not granted\n", stderr)
        exit(10)
    }
}

let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
var captureArgs = ["-x"]
if let displayId, !displayId.isEmpty {
    captureArgs.append(contentsOf: ["-D", displayId])
}
captureArgs.append(outputPath)
task.arguments = captureArgs

let stderrPipe = Pipe()
task.standardError = stderrPipe

do {
    try task.run()
    task.waitUntilExit()
} catch {
    fputs("Failed to launch screencapture: \(error)\n", stderr)
    exit(11)
}

if task.terminationStatus != 0 {
    let errorOutput = String(data: stderrPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    fputs("screencapture failed: \(errorOutput)\n", stderr)
    exit(12)
}

var payload: [String: Any] = [
    "outputPath": outputPath,
    "mimeType": "image/png"
]
if includeBase64 {
    payload["base64Data"] = try Data(contentsOf: URL(fileURLWithPath: outputPath)).base64EncodedString()
}
let data = try JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(data)
"#;

const SWIFT_MOUSE_ACTION: &str = r#"
import Foundation
import ApplicationServices

enum MouseAction: String {
    case move
    case click
    case doubleClick = "double_click"
    case buttonDown = "button_down"
    case buttonUp = "button_up"
    case scroll
}

guard AXIsProcessTrusted() else {
    fputs("Accessibility permission was not granted\n", stderr)
    exit(20)
}

let args = Array(CommandLine.arguments.dropFirst())
guard let actionArg = args.first, let action = MouseAction(rawValue: actionArg) else {
    fputs("mouse action argument is required\n", stderr)
    exit(21)
}

var x: Double?
var y: Double?
var buttonName = "left"
var deltaX: Int32 = 0
var deltaY: Int32 = 0

var index = 1
while index < args.count {
    switch args[index] {
    case "--x":
        guard index + 1 < args.count, let value = Double(args[index + 1]) else {
            fputs("invalid --x argument\n", stderr)
            exit(22)
        }
        x = value
        index += 2
    case "--y":
        guard index + 1 < args.count, let value = Double(args[index + 1]) else {
            fputs("invalid --y argument\n", stderr)
            exit(23)
        }
        y = value
        index += 2
    case "--button":
        guard index + 1 < args.count else {
            fputs("invalid --button argument\n", stderr)
            exit(24)
        }
        buttonName = args[index + 1]
        index += 2
    case "--delta-x":
        guard index + 1 < args.count, let value = Int32(args[index + 1]) else {
            fputs("invalid --delta-x argument\n", stderr)
            exit(25)
        }
        deltaX = value
        index += 2
    case "--delta-y":
        guard index + 1 < args.count, let value = Int32(args[index + 1]) else {
            fputs("invalid --delta-y argument\n", stderr)
            exit(26)
        }
        deltaY = value
        index += 2
    default:
        fputs("unknown mouse action argument: \(args[index])\n", stderr)
        exit(27)
    }
}

func resolvePoint(required: Bool) -> CGPoint? {
    if let x, let y {
        return CGPoint(x: x, y: y)
    }
    if required {
        fputs("mouse action requires both x and y\n", stderr)
        exit(28)
    }
    return nil
}

func resolveButton(_ name: String) -> CGMouseButton {
    switch name.lowercased() {
    case "right":
        return .right
    case "middle", "center":
        return .center
    default:
        return .left
    }
}

func mouseDownType(_ button: CGMouseButton) -> CGEventType {
    switch button {
    case .right:
        return .rightMouseDown
    case .center:
        return .otherMouseDown
    default:
        return .leftMouseDown
    }
}

func mouseUpType(_ button: CGMouseButton) -> CGEventType {
    switch button {
    case .right:
        return .rightMouseUp
    case .center:
        return .otherMouseUp
    default:
        return .leftMouseUp
    }
}

func moveType(_ button: CGMouseButton) -> CGEventType {
    switch button {
    case .right:
        return .rightMouseDragged
    case .center:
        return .otherMouseDragged
    default:
        return .leftMouseDragged
    }
}

func moveCursor(to point: CGPoint) throws {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) else {
        throw NSError(domain: "YeonjangMouse", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to build mouse move event"])
    }
    event.post(tap: .cghidEventTap)
    usleep(10_000)
}

func postMouseEvent(_ type: CGEventType, at point: CGPoint, button: CGMouseButton, clickState: Int64? = nil) throws {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button) else {
        throw NSError(domain: "YeonjangMouse", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to build mouse event"])
    }
    if let clickState {
        event.setIntegerValueField(.mouseEventClickState, value: clickState)
    }
    event.post(tap: .cghidEventTap)
    usleep(10_000)
}

let button = resolveButton(buttonName)

do {
    switch action {
    case .move:
        guard let point = resolvePoint(required: true) else {
            exit(28)
        }
        try moveCursor(to: point)
    case .click, .doubleClick:
        guard let point = resolvePoint(required: true) else {
            exit(28)
        }
        try moveCursor(to: point)
        let repetitions = action == .doubleClick ? 2 : 1
        for clickIndex in 0..<repetitions {
            let state = Int64(clickIndex + 1)
            try postMouseEvent(mouseDownType(button), at: point, button: button, clickState: state)
            try postMouseEvent(mouseUpType(button), at: point, button: button, clickState: state)
        }
    case .buttonDown:
        let point = resolvePoint(required: false) ?? CGEvent(source: nil)?.location ?? CGPoint.zero
        if x != nil || y != nil {
            try moveCursor(to: point)
        }
        try postMouseEvent(mouseDownType(button), at: point, button: button)
    case .buttonUp:
        let point = resolvePoint(required: false) ?? CGEvent(source: nil)?.location ?? CGPoint.zero
        if x != nil || y != nil {
            try moveCursor(to: point)
        }
        try postMouseEvent(mouseUpType(button), at: point, button: button)
    case .scroll:
        if let point = resolvePoint(required: false) {
            try moveCursor(to: point)
        }
        guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: deltaY, wheel2: deltaX, wheel3: 0) else {
            throw NSError(domain: "YeonjangMouse", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to build scroll event"])
        }
        event.post(tap: .cghidEventTap)
    }
} catch {
    fputs("mouse action failed: \(error)\n", stderr)
    exit(29)
}
"#;

const SWIFT_KEYBOARD_ACTION: &str = r#"
import Foundation
import ApplicationServices

enum KeyboardAction: String {
    case keyPress = "key_press"
    case keyDown = "key_down"
    case keyUp = "key_up"
}

guard AXIsProcessTrusted() else {
    fputs("Accessibility permission was not granted\n", stderr)
    exit(40)
}

let args = Array(CommandLine.arguments.dropFirst())
guard let actionArg = args.first, let action = KeyboardAction(rawValue: actionArg) else {
    fputs("keyboard action argument is required\n", stderr)
    exit(41)
}

var keyCode: CGKeyCode?
var modifierCodes: [CGKeyCode] = []

var index = 1
while index < args.count {
    switch args[index] {
    case "--keycode":
        guard index + 1 < args.count, let value = UInt16(args[index + 1]) else {
            fputs("invalid --keycode argument\n", stderr)
            exit(42)
        }
        keyCode = CGKeyCode(value)
        index += 2
    case "--modifier":
        guard index + 1 < args.count, let value = UInt16(args[index + 1]) else {
            fputs("invalid --modifier argument\n", stderr)
            exit(43)
        }
        modifierCodes.append(CGKeyCode(value))
        index += 2
    default:
        fputs("unknown keyboard action argument: \(args[index])\n", stderr)
        exit(44)
    }
}

guard let keyCode else {
    fputs("keyboard action requires --keycode\n", stderr)
    exit(45)
}

func postKey(_ code: CGKeyCode, down: Bool) throws {
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) else {
        throw NSError(domain: "YeonjangKeyboard", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to build keyboard event"])
    }
    event.post(tap: .cghidEventTap)
    usleep(8_000)
}

func postModifierSequence(_ codes: [CGKeyCode], down: Bool) throws {
    let ordered = down ? codes : codes.reversed()
    for code in ordered {
        try postKey(code, down: down)
    }
}

do {
    switch action {
    case .keyPress:
        try postModifierSequence(modifierCodes, down: true)
        try postKey(keyCode, down: true)
        try postKey(keyCode, down: false)
        try postModifierSequence(modifierCodes, down: false)
    case .keyDown:
        try postModifierSequence(modifierCodes, down: true)
        try postKey(keyCode, down: true)
    case .keyUp:
        try postKey(keyCode, down: false)
        try postModifierSequence(modifierCodes, down: false)
    }
} catch {
    fputs("keyboard action failed: \(error)\n", stderr)
    exit(46)
}
"#;

#[cfg(test)]
mod tests {
    use super::{
        MacosKeyboardTarget, build_modifier_clause, build_modifier_key_codes,
        normalize_mouse_button_name, resolve_macos_keyboard_key_code,
        resolve_macos_keyboard_target, resolve_optional_mouse_point,
    };

    #[test]
    fn resolves_letter_shortcut_to_keystroke() {
        let result = resolve_macos_keyboard_target("c").expect("letter key should resolve");
        assert_eq!(result, MacosKeyboardTarget::Keystroke("c".to_string()));
    }

    #[test]
    fn resolves_named_shortcut_to_keycode() {
        let result = resolve_macos_keyboard_target("Space").expect("space key should resolve");
        assert_eq!(result, MacosKeyboardTarget::KeyCode(49));
    }

    #[test]
    fn builds_deduplicated_modifier_clause() {
        let clause = build_modifier_clause(&[
            "Command".to_string(),
            "LeftControl".to_string(),
            "cmd".to_string(),
        ])
        .expect("modifier clause should resolve");

        assert_eq!(clause, vec!["command down", "control down"]);
    }

    #[test]
    fn resolves_letter_key_to_keycode() {
        let result = resolve_macos_keyboard_key_code("c").expect("letter key should resolve");
        assert_eq!(result, 8);
    }

    #[test]
    fn resolves_named_key_to_keycode() {
        let result =
            resolve_macos_keyboard_key_code("RightArrow").expect("arrow key should resolve");
        assert_eq!(result, 124);
    }

    #[test]
    fn builds_deduplicated_modifier_key_codes() {
        let codes = build_modifier_key_codes(&[
            "Command".to_string(),
            "LeftControl".to_string(),
            "cmd".to_string(),
        ])
        .expect("modifier key codes should resolve");

        assert_eq!(codes, vec![55, 59]);
    }

    #[test]
    fn normalizes_mouse_button_aliases() {
        assert_eq!(
            normalize_mouse_button_name("center").expect("center button"),
            "middle"
        );
        assert_eq!(
            normalize_mouse_button_name("left").expect("left button"),
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
}
