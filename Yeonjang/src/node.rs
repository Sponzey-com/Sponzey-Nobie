use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::thread::{self, JoinHandle};

use crate::automation::{
    AutomationBackend, AutomationCapabilities, KeyboardActionRequest, MouseActionRequest,
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
            "version": env!("CARGO_PKG_VERSION"),
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
    json!({
        "node": "nobie-yeonjang",
        "version": env!("CARGO_PKG_VERSION"),
        "transport": "stdio-jsonl",
        "platform": capability_flags.platform,
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
