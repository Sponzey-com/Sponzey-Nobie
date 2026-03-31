use std::env;
use std::path::PathBuf;
use std::process::Command;

use anyhow::{Context, Result, anyhow, bail};

use crate::automation::{
    ApplicationLaunchRequest, CameraCaptureRequest, CommandExecutionRequest, CommandExecutionResult,
    MouseClickRequest, MouseMoveRequest, PlatformKind, ScreenCaptureRequest, SystemSnapshot,
};

pub fn collect_system_info(platform: PlatformKind) -> SystemSnapshot {
    let current_dir = env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .display()
        .to_string();
    let executable = env::current_exe()
        .unwrap_or_else(|_| PathBuf::from("nobie-yeonjang"))
        .display()
        .to_string();

    SystemSnapshot {
        node: "nobie-yeonjang".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform,
        os: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        current_dir,
        executable,
        user: env::var("USER").ok().or_else(|| env::var("USERNAME").ok()),
    }
}

pub fn execute_command(request: CommandExecutionRequest) -> Result<CommandExecutionResult> {
    if request.command.trim().is_empty() {
        bail!("command must not be empty");
    }

    if request.shell && !request.args.is_empty() {
        bail!("shell execution does not support a separate args array");
    }

    let mut command = if request.shell {
        if cfg!(target_os = "windows") {
            let mut cmd = Command::new("cmd");
            cmd.arg("/C").arg(&request.command);
            cmd
        } else {
            let mut cmd = Command::new("sh");
            cmd.arg("-lc").arg(&request.command);
            cmd
        }
    } else {
        let mut cmd = Command::new(&request.command);
        cmd.args(&request.args);
        cmd
    };

    if let Some(cwd) = request.cwd {
        command.current_dir(cwd);
    }

    let output = command
        .output()
        .with_context(|| format!("failed to execute command `{}`", request.command))?;

    Ok(CommandExecutionResult {
        success: output.status.success(),
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

pub fn not_implemented(feature: &str, platform: PlatformKind) -> anyhow::Error {
    anyhow!("{feature} is scaffolded but not implemented yet for {:?}", platform)
}

pub fn validate_mouse_move(request: &MouseMoveRequest) -> Result<()> {
    if request.x < 0 || request.y < 0 {
        bail!("mouse coordinates must be zero or greater");
    }
    Ok(())
}

pub fn validate_mouse_click(request: &MouseClickRequest) -> Result<()> {
    if request.x < 0 || request.y < 0 {
        bail!("mouse coordinates must be zero or greater");
    }
    Ok(())
}

pub fn validate_camera_request(request: &CameraCaptureRequest) -> Result<()> {
    if let Some(path) = &request.output_path {
        if path.trim().is_empty() {
            bail!("output_path must not be empty");
        }
    }
    Ok(())
}

pub fn validate_screen_request(request: &ScreenCaptureRequest) -> Result<()> {
    if let Some(path) = &request.output_path {
        if path.trim().is_empty() {
            bail!("output_path must not be empty");
        }
    }
    Ok(())
}

pub fn validate_application_request(request: &ApplicationLaunchRequest) -> Result<()> {
    if request.application.trim().is_empty() {
        bail!("application must not be empty");
    }
    Ok(())
}
