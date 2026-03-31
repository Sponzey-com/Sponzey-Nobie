use anyhow::Result;
use serde::Deserialize;
use serde_json::Value;

use crate::automation::{AutomationBackend, CameraCaptureRequest};
use crate::platform::current_backend;

#[derive(Debug, Deserialize)]
pub struct CaptureParams {
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub output_path: Option<String>,
    #[serde(default)]
    pub inline_base64: bool,
}

pub fn list_devices() -> Result<Value> {
    Ok(serde_json::to_value(current_backend().list_cameras()?)?)
}

pub fn capture(params: CaptureParams) -> Result<Value> {
    let request = CameraCaptureRequest {
        device_id: params.device_id,
        output_path: params.output_path,
        inline_base64: true,
    };
    Ok(serde_json::to_value(current_backend().capture_camera(request)?)?)
}
