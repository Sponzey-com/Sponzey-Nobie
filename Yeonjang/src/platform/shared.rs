use std::env;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread::sleep;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};

use crate::automation::{
    ApplicationLaunchRequest, CameraCaptureRequest, CommandExecutionRequest,
    CommandExecutionResult, MouseClickRequest, MouseMoveRequest, PlatformKind,
    ScreenCaptureRequest, SystemSnapshot,
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
        version: option_env!("YEONJANG_GIT_DESCRIBE")
            .unwrap_or(env!("CARGO_PKG_VERSION"))
            .to_string(),
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

    if let Some(reason) = detect_command_policy_violation(&request) {
        bail!("command rejected: {reason}");
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

    if !request.env.is_empty() {
        command.envs(&request.env);
    }

    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .with_context(|| format!("failed to execute command `{}`", request.command))?;

    let output = if let Some(timeout_sec) = request.timeout_sec.filter(|value| *value > 0) {
        let timeout = Duration::from_secs(timeout_sec);
        let start = Instant::now();
        loop {
            if child.try_wait()?.is_some() {
                break child.wait_with_output().with_context(|| {
                    format!("failed to collect command output for `{}`", request.command)
                })?;
            }

            if start.elapsed() >= timeout {
                let _ = child.kill();
                let partial = child.wait_with_output().ok();
                let stdout = partial
                    .as_ref()
                    .map(|value| String::from_utf8_lossy(&value.stdout).into_owned())
                    .unwrap_or_default();
                let partial_stderr = partial
                    .as_ref()
                    .map(|value| String::from_utf8_lossy(&value.stderr).into_owned())
                    .unwrap_or_default();
                let timeout_message = format!("command timed out after {timeout_sec}s");
                let stderr = if partial_stderr.trim().is_empty() {
                    timeout_message
                } else {
                    format!("{partial_stderr}\n{timeout_message}")
                };

                return Ok(CommandExecutionResult {
                    success: false,
                    exit_code: None,
                    stdout,
                    stderr,
                });
            }

            sleep(Duration::from_millis(50));
        }
    } else {
        child.wait_with_output().with_context(|| {
            format!("failed to collect command output for `{}`", request.command)
        })?
    };

    Ok(CommandExecutionResult {
        success: output.status.success(),
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

fn detect_command_policy_violation(request: &CommandExecutionRequest) -> Option<&'static str> {
    let mut joined = request.command.to_lowercase();
    if !request.args.is_empty() {
        joined.push(' ');
        joined.push_str(&request.args.join(" ").to_lowercase());
    }

    if joined.contains("eval(") {
        return Some("Potentially obfuscated command detected (pattern: eval()");
    }
    if joined.contains("exec(") {
        return Some("Potentially obfuscated command detected (pattern: exec()");
    }
    if joined.contains("base64 -d") || joined.contains("base64 --decode") {
        return Some("Potentially obfuscated command detected (pattern: base64 -d)");
    }
    if (joined.contains("python -c")
        || joined.contains("python2 -c")
        || joined.contains("python3 -c"))
        && joined.contains("base64")
    {
        return Some("Potentially obfuscated command detected (pattern: python -c ... base64)");
    }
    if joined.contains("$(echo ") && joined.contains("|") {
        return Some("Potentially obfuscated command detected (pattern: $(echo ... | ...))");
    }

    None
}

#[allow(dead_code)]
pub fn not_implemented(feature: &str, platform: PlatformKind) -> anyhow::Error {
    anyhow!(
        "{feature} is scaffolded but not implemented yet for {:?}",
        platform
    )
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

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::detect_command_policy_violation;
    use crate::automation::CommandExecutionRequest;

    fn request(command: &str, args: &[&str], shell: bool) -> CommandExecutionRequest {
        CommandExecutionRequest {
            command: command.to_string(),
            args: args.iter().map(|value| value.to_string()).collect(),
            cwd: None,
            shell,
            env: BTreeMap::new(),
            timeout_sec: None,
        }
    }

    #[test]
    fn rejects_eval_obfuscation() {
        let violation =
            detect_command_policy_violation(&request("python -c \"eval(1)\"", &[], true));
        assert!(violation.is_some());
    }

    #[test]
    fn rejects_base64_decode_pattern() {
        let violation =
            detect_command_policy_violation(&request("sh", &["-lc", "echo x | base64 -d"], false));
        assert!(violation.is_some());
    }

    #[test]
    fn allows_simple_command() {
        let violation = detect_command_policy_violation(&request("pwd", &[], true));
        assert!(violation.is_none());
    }
}
