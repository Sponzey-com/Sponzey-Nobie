use anyhow::{Result, anyhow};
use serde::Deserialize;
use serde_json::Value;

use crate::automation::{
    ApplicationLaunchRequest, AutomationBackend, CommandExecutionRequest, SystemControlRequest,
};
use crate::platform::current_backend;

#[derive(Debug, Deserialize)]
pub struct ExecParams {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub shell: bool,
}

#[derive(Debug, Deserialize)]
pub struct ControlParams {
    pub action: String,
    #[serde(default)]
    pub target: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LaunchAppParams {
    pub application: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub detached: bool,
}

pub fn system_info() -> Result<Value> {
    Ok(serde_json::to_value(current_backend().system_info()?)?)
}

pub fn control(params: ControlParams) -> Result<Value> {
    if params.action.trim().is_empty() {
        return Err(anyhow!("action must not be empty"));
    }

    let request = SystemControlRequest {
        action: params.action,
        target: params.target,
    };
    Ok(serde_json::to_value(current_backend().control_system(request)?)?)
}

pub fn exec(params: ExecParams) -> Result<Value> {
    let request = CommandExecutionRequest {
        command: params.command,
        args: params.args,
        cwd: params.cwd,
        shell: params.shell,
    };
    Ok(serde_json::to_value(current_backend().execute_command(request)?)?)
}

pub fn launch_application(params: LaunchAppParams) -> Result<Value> {
    let request = ApplicationLaunchRequest {
        application: params.application,
        args: params.args,
        cwd: params.cwd,
        detached: params.detached,
    };
    Ok(serde_json::to_value(
        current_backend().launch_application(request)?,
    )?)
}
