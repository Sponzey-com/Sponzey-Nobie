use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::thread::{self, JoinHandle};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::automation::{
    AutomationBackend, AutomationCapabilities, KeyboardActionRequest, MouseActionRequest,
    PlatformKind,
};
use crate::features::{camera, keyboard, mouse, screen, system};
use crate::platform::current_backend;
use crate::protocol::{Request, Response};
use crate::settings::{PermissionSettings, load_settings};

pub fn handle_request(request: Request) -> Response {
    match dispatch(&request) {
        Ok(result) => Response::ok(request.id, result),
        Err(error) => Response::error(request.id, "request_failed", format!("{error:#}")),
    }
}

pub fn spawn_request_task(request: Request) -> JoinHandle<Response> {
    thread::spawn(move || handle_request(request))
}

pub fn capabilities_payload() -> Value {
    capabilities()
}

fn dispatch(request: &Request) -> Result<Value> {
    let permissions = current_permissions();

    match request.method.as_str() {
        "node.ping" => Ok(json!({
            "node": "nobie-yeonjang",
            "version": git_tag(),
            "gitTag": git_tag(),
            "gitCommit": git_commit(),
            "buildTarget": build_target(),
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "status": "ready",
        })),
        "node.capabilities" => Ok(capabilities()),
        "system.info" => system::system_info(),
        "system.control" => {
            ensure_permission(
                permissions.allow_system_control,
                "system.control",
                "allow_system_control",
            )?;
            let params = serde_json::from_value::<system::ControlParams>(request.params.clone())
                .context("invalid params for system.control")?;
            system::control(params)
        }
        "camera.list" => camera::list_devices(),
        "camera.capture" => {
            let params = serde_json::from_value::<camera::CaptureParams>(request.params.clone())
                .context("invalid params for camera.capture")?;
            camera::capture(params)
        }
        "system.exec" => {
            ensure_permission(
                permissions.allow_shell_exec,
                "system.exec",
                "allow_shell_exec",
            )?;
            let params = serde_json::from_value::<system::ExecParams>(request.params.clone())
                .context("invalid params for system.exec")?;
            system::exec(params)
        }
        "application.launch" => {
            ensure_permission(
                permissions.allow_application_launch,
                "application.launch",
                "allow_application_launch",
            )?;
            let params = serde_json::from_value::<system::LaunchAppParams>(request.params.clone())
                .context("invalid params for application.launch")?;
            system::launch_application(params)
        }
        "screen.capture" => {
            ensure_permission(
                permissions.allow_screen_capture,
                "screen.capture",
                "allow_screen_capture",
            )?;
            let params = serde_json::from_value::<screen::CaptureParams>(request.params.clone())
                .context("invalid params for screen.capture")?;
            screen::capture(params)
        }
        "mouse.move" => {
            ensure_permission(
                permissions.allow_mouse_control,
                "mouse.move",
                "allow_mouse_control",
            )?;
            let params = serde_json::from_value::<mouse::MoveParams>(request.params.clone())
                .context("invalid params for mouse.move")?;
            mouse::move_cursor(params)
        }
        "mouse.click" => {
            ensure_permission(
                permissions.allow_mouse_control,
                "mouse.click",
                "allow_mouse_control",
            )?;
            let params = serde_json::from_value::<mouse::ClickParams>(request.params.clone())
                .context("invalid params for mouse.click")?;
            mouse::click(params)
        }
        "mouse.action" => {
            ensure_permission(
                permissions.allow_mouse_control,
                "mouse.action",
                "allow_mouse_control",
            )?;
            let params = serde_json::from_value::<MouseActionRequest>(request.params.clone())
                .context("invalid params for mouse.action")?;
            mouse::action(params)
        }
        "keyboard.type" => {
            ensure_permission(
                permissions.allow_keyboard_control,
                "keyboard.type",
                "allow_keyboard_control",
            )?;
            let params = serde_json::from_value::<keyboard::TypeParams>(request.params.clone())
                .context("invalid params for keyboard.type")?;
            keyboard::type_text(params)
        }
        "keyboard.action" => {
            ensure_permission(
                permissions.allow_keyboard_control,
                "keyboard.action",
                "allow_keyboard_control",
            )?;
            let params = serde_json::from_value::<KeyboardActionRequest>(request.params.clone())
                .context("invalid params for keyboard.action")?;
            keyboard::action(params)
        }
        other => anyhow::bail!("unknown method: {other}"),
    }
}

fn capabilities() -> Value {
    let capability_flags = effective_capabilities();
    let last_checked_at = now_unix_millis();
    json!({
        "node": "nobie-yeonjang",
        "version": git_tag(),
        "gitTag": git_tag(),
        "gitCommit": git_commit(),
        "buildTarget": build_target(),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "transport": ["stdio-jsonl", "mqtt-json"],
        "platform": capability_flags.platform,
        "capabilityHash": capability_hash(&capability_flags),
        "capabilityMatrix": capability_matrix(&capability_flags, last_checked_at),
        "abstractions": {
            "cameraManagement": capability_flags.camera_management,
            "commandExecution": capability_flags.command_execution,
            "applicationLaunch": capability_flags.application_launch,
            "screenCapture": capability_flags.screen_capture,
            "mouseControl": capability_flags.mouse_control,
            "keyboardControl": capability_flags.keyboard_control,
            "systemControl": capability_flags.system_control,
        },
        "methods": [
            {
                "name": "node.ping",
                "implemented": true,
                "category": "node",
                "summary": "Basic liveness probe.",
            },
            {
                "name": "node.capabilities",
                "implemented": true,
                "category": "node",
                "summary": "Lists supported methods and implementation state.",
            },
            {
                "name": "system.info",
                "implemented": true,
                "category": "system",
                "summary": "Returns runtime and host environment info through the abstraction layer.",
            },
            {
                "name": "camera.list",
                "implemented": capability_flags.camera_management,
                "category": "camera",
                "summary": "Lists available camera devices.",
            },
            {
                "name": "camera.capture",
                "implemented": capability_flags.camera_management,
                "category": "camera",
                "summary": "Captures a still image from the selected camera device.",
            },
            {
                "name": "system.control",
                "implemented": capability_flags.system_control,
                "category": "system",
                "summary": "Abstract system control entry point for power/session actions.",
            },
            {
                "name": "system.exec",
                "implemented": capability_flags.command_execution,
                "category": "system",
                "summary": "Executes a local command or shell string through the backend abstraction.",
            },
            {
                "name": "application.launch",
                "implemented": capability_flags.application_launch,
                "category": "application",
                "summary": "Abstract application launch entry point.",
            },
            {
                "name": "screen.capture",
                "implemented": capability_flags.screen_capture,
                "category": "screen",
                "summary": "Abstract screen capture entry point.",
            },
            {
                "name": "mouse.action",
                "implemented": capability_flags.mouse_control,
                "category": "mouse",
                "summary": "Accepts action-based mouse requests such as move and click.",
            },
            {
                "name": "mouse.move",
                "implemented": capability_flags.mouse_control,
                "category": "mouse",
                "summary": "Abstract mouse move entry point.",
            },
            {
                "name": "mouse.click",
                "implemented": capability_flags.mouse_control,
                "category": "mouse",
                "summary": "Abstract mouse click entry point.",
            },
            {
                "name": "keyboard.action",
                "implemented": capability_flags.keyboard_control,
                "category": "keyboard",
                "summary": "Accepts action-based keyboard requests such as text input.",
            },
            {
                "name": "keyboard.type",
                "implemented": capability_flags.keyboard_control,
                "category": "keyboard",
                "summary": "Abstract keyboard typing entry point.",
            }
        ]
    })
}

pub fn git_tag() -> &'static str {
    option_env!("YEONJANG_GIT_DESCRIBE").unwrap_or(env!("CARGO_PKG_VERSION"))
}

pub fn git_commit() -> &'static str {
    option_env!("YEONJANG_GIT_COMMIT").unwrap_or("unknown")
}

pub fn build_target() -> &'static str {
    option_env!("YEONJANG_BUILD_TARGET").unwrap_or("unknown")
}

fn now_unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or_default()
}

fn capability_hash(flags: &AutomationCapabilities) -> String {
    format!(
        "{}:{}:{:?}:camera={}:exec={}:app={}:screen={}:mouse={}:keyboard={}:system={}",
        env!("CARGO_PKG_VERSION"),
        git_commit(),
        flags.platform,
        flags.camera_management,
        flags.command_execution,
        flags.application_launch,
        flags.screen_capture,
        flags.mouse_control,
        flags.keyboard_control,
        flags.system_control,
    )
}

fn capability_matrix(flags: &AutomationCapabilities, last_checked_at: u64) -> Value {
    json!({
        "node.ping": capability_entry(true, false, None, vec![], vec!["json"], last_checked_at),
        "node.capabilities": capability_entry(true, false, None, vec![], vec!["json"], last_checked_at),
        "system.info": capability_entry(true, false, None, vec![], vec!["json"], last_checked_at),
        "camera.list": capability_entry(
            flags.camera_management,
            false,
            None,
            camera_limitations(flags.platform),
            vec!["json"],
            last_checked_at,
        ),
        "camera.capture": capability_entry(
            flags.camera_management,
            true,
            None,
            camera_limitations(flags.platform),
            vec!["base64", "file"],
            last_checked_at,
        ),
        "system.control": capability_entry(
            flags.system_control,
            true,
            Some("allow_system_control"),
            system_limitations(flags.platform),
            vec!["json"],
            last_checked_at,
        ),
        "system.exec": capability_entry(
            flags.command_execution,
            true,
            Some("allow_shell_exec"),
            vec![],
            vec!["stdout", "stderr", "exit_code"],
            last_checked_at,
        ),
        "application.launch": capability_entry(
            flags.application_launch,
            true,
            Some("allow_application_launch"),
            vec![],
            vec!["json"],
            last_checked_at,
        ),
        "screen.capture": capability_entry(
            flags.screen_capture,
            false,
            Some("allow_screen_capture"),
            screen_limitations(flags.platform),
            vec!["base64", "file"],
            last_checked_at,
        ),
        "mouse.action": capability_entry(
            flags.mouse_control,
            true,
            Some("allow_mouse_control"),
            mouse_limitations(flags.platform),
            vec!["json"],
            last_checked_at,
        ),
        "mouse.move": capability_entry(
            flags.mouse_control,
            true,
            Some("allow_mouse_control"),
            mouse_limitations(flags.platform),
            vec!["json"],
            last_checked_at,
        ),
        "mouse.click": capability_entry(
            flags.mouse_control,
            true,
            Some("allow_mouse_control"),
            mouse_limitations(flags.platform),
            vec!["json"],
            last_checked_at,
        ),
        "keyboard.action": capability_entry(
            flags.keyboard_control,
            true,
            Some("allow_keyboard_control"),
            keyboard_limitations(flags.platform),
            vec!["json"],
            last_checked_at,
        ),
        "keyboard.type": capability_entry(
            flags.keyboard_control,
            true,
            Some("allow_keyboard_control"),
            keyboard_limitations(flags.platform),
            vec!["json"],
            last_checked_at,
        ),
    })
}

fn capability_entry(
    supported: bool,
    requires_approval: bool,
    permission_setting: Option<&'static str>,
    known_limitations: Vec<&'static str>,
    output_modes: Vec<&'static str>,
    last_checked_at: u64,
) -> Value {
    json!({
        "supported": supported,
        "requiresApproval": requires_approval,
        "requiresPermission": permission_setting.is_some(),
        "permissionSetting": permission_setting,
        "knownLimitations": known_limitations,
        "outputModes": output_modes,
        "lastCheckedAt": last_checked_at,
    })
}

fn camera_limitations(platform: PlatformKind) -> Vec<&'static str> {
    match platform {
        PlatformKind::Macos => {
            vec!["iPhone Continuity Camera front/rear lens selection is not exposed to Yeonjang."]
        }
        PlatformKind::Linux => vec![
            "Linux camera capture depends on v4l2 devices and ffmpeg or fswebcam availability.",
        ],
        _ => vec![],
    }
}

fn screen_limitations(platform: PlatformKind) -> Vec<&'static str> {
    match platform {
        PlatformKind::Macos => vec![
            "Gateway display indexes are zero-based; Yeonjang translates them to macOS screencapture one-based indexes.",
        ],
        PlatformKind::Linux => vec![
            "Linux screen.capture currently captures the current full screen only; display index selection is unsupported.",
        ],
        _ => vec!["Display indexes are zero-based."],
    }
}

fn mouse_limitations(platform: PlatformKind) -> Vec<&'static str> {
    match platform {
        PlatformKind::Linux => vec!["Linux mouse control requires xdotool in PATH."],
        _ => vec![],
    }
}

fn keyboard_limitations(platform: PlatformKind) -> Vec<&'static str> {
    match platform {
        PlatformKind::Linux => vec!["Linux keyboard control requires xdotool in PATH."],
        _ => vec![],
    }
}

fn system_limitations(platform: PlatformKind) -> Vec<&'static str> {
    match platform {
        PlatformKind::Linux => vec![
            "Linux system control depends on systemctl/loginctl availability and session permissions.",
        ],
        _ => vec![],
    }
}

fn current_permissions() -> PermissionSettings {
    load_settings()
        .map(|settings| settings.permissions)
        .unwrap_or_default()
}

fn effective_capabilities() -> AutomationCapabilities {
    let mut capability_flags = current_backend().capabilities();
    let permissions = current_permissions();
    capability_flags.system_control &= permissions.allow_system_control;
    capability_flags.command_execution &= permissions.allow_shell_exec;
    capability_flags.application_launch &= permissions.allow_application_launch;
    capability_flags.screen_capture &= permissions.allow_screen_capture;
    capability_flags.keyboard_control &= permissions.allow_keyboard_control;
    capability_flags.mouse_control &= permissions.allow_mouse_control;
    capability_flags
}

fn ensure_permission(allowed: bool, method: &str, setting: &str) -> Result<()> {
    if allowed {
        Ok(())
    } else {
        anyhow::bail!(
            "permission denied: `{method}` is disabled in Yeonjang permissions ({setting})"
        )
    }
}
