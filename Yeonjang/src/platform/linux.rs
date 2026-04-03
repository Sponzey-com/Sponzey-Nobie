use anyhow::{Result, bail};

use crate::automation::{
    ApplicationLaunchRequest, ApplicationLaunchResult, AutomationBackend, AutomationCapabilities,
    CameraCaptureRequest, CameraCaptureResult, CameraDevice, CommandExecutionRequest,
    CommandExecutionResult, KeyboardTypeRequest, KeyboardTypeResult, MouseClickRequest,
    MouseClickResult, MouseMoveRequest, MouseMoveResult, PlatformKind, ScreenCaptureRequest,
    ScreenCaptureResult, SystemControlRequest, SystemControlResult, SystemSnapshot,
};
use crate::platform::shared;

#[derive(Debug, Default, Clone, Copy)]
pub struct PlatformBackend;

impl AutomationBackend for PlatformBackend {
    fn platform_kind(&self) -> PlatformKind {
        PlatformKind::Linux
    }

    fn capabilities(&self) -> AutomationCapabilities {
        AutomationCapabilities {
            platform: self.platform_kind(),
            camera_management: false,
            command_execution: true,
            application_launch: false,
            screen_capture: false,
            mouse_control: false,
            keyboard_control: false,
            system_control: false,
        }
    }

    fn system_info(&self) -> Result<SystemSnapshot> {
        Ok(shared::collect_system_info(self.platform_kind()))
    }

    fn control_system(&self, request: SystemControlRequest) -> Result<SystemControlResult> {
        bail!(
            "{}",
            shared::not_implemented(
                &format!("system.control(action={})", request.action),
                self.platform_kind()
            )
        )
    }

    fn execute_command(&self, request: CommandExecutionRequest) -> Result<CommandExecutionResult> {
        shared::execute_command(request)
    }

    fn launch_application(
        &self,
        request: ApplicationLaunchRequest,
    ) -> Result<ApplicationLaunchResult> {
        shared::validate_application_request(&request)?;
        bail!(
            "{}",
            shared::not_implemented("application.launch", self.platform_kind())
        )
    }

    fn list_cameras(&self) -> Result<Vec<CameraDevice>> {
        bail!(
            "{}",
            shared::not_implemented("camera.list", self.platform_kind())
        )
    }

    fn capture_camera(&self, request: CameraCaptureRequest) -> Result<CameraCaptureResult> {
        shared::validate_camera_request(&request)?;
        bail!(
            "{}",
            shared::not_implemented("camera.capture", self.platform_kind())
        )
    }

    fn capture_screen(&self, request: ScreenCaptureRequest) -> Result<ScreenCaptureResult> {
        shared::validate_screen_request(&request)?;
        bail!(
            "{}",
            shared::not_implemented("screen.capture", self.platform_kind())
        )
    }

    fn move_mouse(&self, request: MouseMoveRequest) -> Result<MouseMoveResult> {
        shared::validate_mouse_move(&request)?;
        bail!(
            "{}",
            shared::not_implemented("mouse.move", self.platform_kind())
        )
    }

    fn click_mouse(&self, request: MouseClickRequest) -> Result<MouseClickResult> {
        shared::validate_mouse_click(&request)?;
        bail!(
            "{}",
            shared::not_implemented("mouse.click", self.platform_kind())
        )
    }

    fn type_text(&self, request: KeyboardTypeRequest) -> Result<KeyboardTypeResult> {
        if request.text.is_empty() {
            bail!("keyboard input text must not be empty");
        }
        bail!(
            "{}",
            shared::not_implemented("keyboard.type", self.platform_kind())
        )
    }
}
