use std::collections::BTreeMap;

use anyhow::bail;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlatformKind {
    Macos,
    Windows,
    Linux,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationCapabilities {
    pub platform: PlatformKind,
    pub camera_management: bool,
    pub command_execution: bool,
    pub application_launch: bool,
    pub screen_capture: bool,
    pub mouse_control: bool,
    pub keyboard_control: bool,
    pub system_control: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemSnapshot {
    pub node: String,
    pub version: String,
    pub platform: PlatformKind,
    pub os: String,
    pub arch: String,
    pub current_dir: String,
    pub executable: String,
    pub user: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemControlRequest {
    pub action: String,
    #[serde(default)]
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemControlResult {
    pub accepted: bool,
    pub action: String,
    #[serde(default)]
    pub target: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandExecutionRequest {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub shell: bool,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default, alias = "timeoutSec")]
    pub timeout_sec: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandExecutionResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplicationLaunchRequest {
    pub application: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub detached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplicationLaunchResult {
    pub launched: bool,
    pub application: String,
    pub pid: Option<u32>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraDevice {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub position: Option<String>,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraCaptureRequest {
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub output_path: Option<String>,
    #[serde(default)]
    pub inline_base64: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraCaptureResult {
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub output_path: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub file_extension: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    #[serde(default)]
    pub transfer_encoding: Option<String>,
    #[serde(default)]
    pub base64_data: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenCaptureRequest {
    #[serde(default)]
    pub display: Option<u32>,
    #[serde(default)]
    pub output_path: Option<String>,
    #[serde(default)]
    pub inline_base64: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenCaptureResult {
    #[serde(default)]
    pub display: Option<u32>,
    #[serde(default)]
    pub output_path: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub file_extension: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    #[serde(default)]
    pub transfer_encoding: Option<String>,
    #[serde(default)]
    pub base64_data: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MouseMoveRequest {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MouseMoveResult {
    pub moved: bool,
    pub x: i32,
    pub y: i32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MouseClickRequest {
    pub x: i32,
    pub y: i32,
    #[serde(default = "default_mouse_button")]
    pub button: String,
    #[serde(default)]
    pub double: bool,
}

fn default_mouse_button() -> String {
    "left".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MouseClickResult {
    pub clicked: bool,
    pub x: i32,
    pub y: i32,
    pub button: String,
    pub double: bool,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MouseActionKind {
    Move,
    Click,
    DoubleClick,
    ButtonDown,
    ButtonUp,
    Scroll,
}

impl MouseActionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Move => "move",
            Self::Click => "click",
            Self::DoubleClick => "double_click",
            Self::ButtonDown => "button_down",
            Self::ButtonUp => "button_up",
            Self::Scroll => "scroll",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MouseActionRequest {
    pub action: MouseActionKind,
    #[serde(default)]
    pub x: Option<i32>,
    #[serde(default)]
    pub y: Option<i32>,
    #[serde(default = "default_mouse_button")]
    pub button: String,
    #[serde(default)]
    pub delta_x: Option<i32>,
    #[serde(default)]
    pub delta_y: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MouseActionResult {
    pub accepted: bool,
    pub action: MouseActionKind,
    #[serde(default)]
    pub x: Option<i32>,
    #[serde(default)]
    pub y: Option<i32>,
    #[serde(default)]
    pub button: Option<String>,
    #[serde(default)]
    pub delta_x: Option<i32>,
    #[serde(default)]
    pub delta_y: Option<i32>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyboardTypeRequest {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyboardTypeResult {
    pub typed: bool,
    pub text_len: usize,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KeyboardActionKind {
    TypeText,
    KeyPress,
    KeyDown,
    KeyUp,
    Shortcut,
}

impl KeyboardActionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TypeText => "type_text",
            Self::KeyPress => "key_press",
            Self::KeyDown => "key_down",
            Self::KeyUp => "key_up",
            Self::Shortcut => "shortcut",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyboardActionRequest {
    pub action: KeyboardActionKind,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub modifiers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyboardActionResult {
    pub accepted: bool,
    pub action: KeyboardActionKind,
    #[serde(default)]
    pub text_len: Option<usize>,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub modifiers: Vec<String>,
    pub message: String,
}

pub trait AutomationBackend {
    fn platform_kind(&self) -> PlatformKind;
    fn capabilities(&self) -> AutomationCapabilities;
    fn system_info(&self) -> anyhow::Result<SystemSnapshot>;
    fn control_system(&self, request: SystemControlRequest) -> anyhow::Result<SystemControlResult>;
    fn execute_command(
        &self,
        request: CommandExecutionRequest,
    ) -> anyhow::Result<CommandExecutionResult>;
    fn launch_application(
        &self,
        request: ApplicationLaunchRequest,
    ) -> anyhow::Result<ApplicationLaunchResult>;
    fn list_cameras(&self) -> anyhow::Result<Vec<CameraDevice>>;
    fn capture_camera(&self, request: CameraCaptureRequest) -> anyhow::Result<CameraCaptureResult>;
    fn capture_screen(&self, request: ScreenCaptureRequest) -> anyhow::Result<ScreenCaptureResult>;
    fn move_mouse(&self, request: MouseMoveRequest) -> anyhow::Result<MouseMoveResult>;
    fn click_mouse(&self, request: MouseClickRequest) -> anyhow::Result<MouseClickResult>;
    fn perform_mouse_action(
        &self,
        request: MouseActionRequest,
    ) -> anyhow::Result<MouseActionResult> {
        match request.action {
            MouseActionKind::Move => {
                let x = required_coordinate(request.x, "x", request.action.as_str())?;
                let y = required_coordinate(request.y, "y", request.action.as_str())?;
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
                let x = required_coordinate(request.x, "x", request.action.as_str())?;
                let y = required_coordinate(request.y, "y", request.action.as_str())?;
                let button = request.button;
                let result = self.click_mouse(MouseClickRequest {
                    x,
                    y,
                    button: button.clone(),
                    double: matches!(request.action, MouseActionKind::DoubleClick),
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
            MouseActionKind::ButtonDown | MouseActionKind::ButtonUp | MouseActionKind::Scroll => {
                bail!(
                    "mouse.action `{}` is scaffolded but not implemented yet",
                    request.action.as_str()
                )
            }
        }
    }
    fn type_text(&self, request: KeyboardTypeRequest) -> anyhow::Result<KeyboardTypeResult>;
    fn perform_keyboard_action(
        &self,
        request: KeyboardActionRequest,
    ) -> anyhow::Result<KeyboardActionResult> {
        match request.action {
            KeyboardActionKind::TypeText => {
                let text = required_text(request.text, "text", request.action.as_str())?;
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
            KeyboardActionKind::KeyPress
            | KeyboardActionKind::KeyDown
            | KeyboardActionKind::KeyUp
            | KeyboardActionKind::Shortcut => {
                let key = required_text(request.key, "key", request.action.as_str())?;
                bail!(
                    "keyboard.action `{}` for key `{}` is scaffolded but not implemented yet",
                    request.action.as_str(),
                    key
                )
            }
        }
    }
}

fn required_coordinate(value: Option<i32>, field: &str, action: &str) -> anyhow::Result<i32> {
    value.ok_or_else(|| anyhow::anyhow!("mouse.action `{action}` requires `{field}`"))
}

fn required_text(value: Option<String>, field: &str, action: &str) -> anyhow::Result<String> {
    let text = value.unwrap_or_default();
    if text.trim().is_empty() {
        bail!("keyboard.action `{action}` requires non-empty `{field}`");
    }
    Ok(text)
}
