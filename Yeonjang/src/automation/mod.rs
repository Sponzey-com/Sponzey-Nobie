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
    fn type_text(&self, request: KeyboardTypeRequest) -> anyhow::Result<KeyboardTypeResult>;
}
