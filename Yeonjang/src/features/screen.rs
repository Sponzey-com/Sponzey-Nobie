use anyhow::Result;
use serde::Deserialize;
use serde_json::Value;

use crate::automation::{AutomationBackend, ScreenCaptureRequest};
use crate::platform::current_backend;

#[derive(Debug, Deserialize)]
pub struct CaptureParams {
    #[serde(default)]
    pub display: Option<u32>,
    #[serde(default)]
    pub output_path: Option<String>,
    #[serde(default)]
    pub inline_base64: bool,
}

pub fn capture(params: CaptureParams) -> Result<Value> {
    let request = ScreenCaptureRequest {
        display: params.display,
        output_path: params.output_path,
        inline_base64: true,
    };
    Ok(serde_json::to_value(current_backend().capture_screen(request)?)?)
}
