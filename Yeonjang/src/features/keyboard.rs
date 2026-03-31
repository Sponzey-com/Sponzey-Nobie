use anyhow::{Result, anyhow};
use serde::Deserialize;
use serde_json::Value;

use crate::automation::{AutomationBackend, KeyboardTypeRequest};
use crate::platform::current_backend;

#[derive(Debug, Deserialize)]
pub struct TypeParams {
    pub text: String,
}

pub fn type_text(params: TypeParams) -> Result<Value> {
    if params.text.is_empty() {
        return Err(anyhow!("keyboard input text must not be empty"));
    }

    let request = KeyboardTypeRequest { text: params.text };
    Ok(serde_json::to_value(current_backend().type_text(request)?)?)
}
