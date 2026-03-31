use anyhow::Result;
use serde::Deserialize;
use serde_json::Value;

use crate::automation::{
    AutomationBackend, MouseActionRequest, MouseClickRequest, MouseMoveRequest,
};
use crate::platform::current_backend;

#[derive(Debug, Deserialize)]
pub struct MoveParams {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Deserialize)]
pub struct ClickParams {
    pub x: i32,
    pub y: i32,
    #[serde(default = "default_button")]
    pub button: String,
    #[serde(default)]
    pub double: bool,
}

fn default_button() -> String {
    "left".to_string()
}

pub fn move_cursor(params: MoveParams) -> Result<Value> {
    let request = MouseMoveRequest {
        x: params.x,
        y: params.y,
    };
    Ok(serde_json::to_value(current_backend().move_mouse(request)?)?)
}

pub fn click(params: ClickParams) -> Result<Value> {
    let request = MouseClickRequest {
        x: params.x,
        y: params.y,
        button: params.button,
        double: params.double,
    };
    Ok(serde_json::to_value(current_backend().click_mouse(request)?)?)
}

pub fn action(params: MouseActionRequest) -> Result<Value> {
    Ok(serde_json::to_value(
        current_backend().perform_mouse_action(params)?,
    )?)
}
