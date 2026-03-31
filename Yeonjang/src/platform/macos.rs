use std::env;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use serde_json::Value;

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
        PlatformKind::Macos
    }

    fn capabilities(&self) -> AutomationCapabilities {
        AutomationCapabilities {
            platform: self.platform_kind(),
            camera_management: true,
            command_execution: true,
            application_launch: true,
            screen_capture: true,
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

        let mut command = Command::new("open");
        command.arg("-a").arg(&request.application);
        if !request.args.is_empty() {
            command.arg("--args");
            command.args(&request.args);
        }
        if let Some(cwd) = &request.cwd {
            command.current_dir(cwd);
        }

        let output = command
            .output()
            .with_context(|| format!("failed to launch application `{}`", request.application))?;

        if !output.status.success() {
            bail!(
                "application launch failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        Ok(ApplicationLaunchResult {
            launched: true,
            application: request.application,
            pid: None,
            message: if request.detached {
                "Application launch requested in detached mode.".to_string()
            } else {
                "Application launch requested.".to_string()
            },
        })
    }

    fn list_cameras(&self) -> Result<Vec<CameraDevice>> {
        let output = Command::new("system_profiler")
            .args(["SPCameraDataType", "-json"])
            .output()
            .context("failed to run system_profiler for camera discovery")?;

        if !output.status.success() {
            bail!(
                "camera discovery failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        let payload: Value =
            serde_json::from_slice(&output.stdout).context("failed to parse system_profiler output")?;
        let items = payload
            .get("SPCameraDataType")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        let cameras = items
            .into_iter()
            .enumerate()
            .map(|(index, item)| {
                let name = item
                    .get("_name")
                    .and_then(Value::as_str)
                    .or_else(|| item.get("name").and_then(Value::as_str))
                    .unwrap_or("Camera")
                    .to_string();
                let id = item
                    .get("spcamera_unique-id")
                    .and_then(Value::as_str)
                    .or_else(|| item.get("spcamera_model-id").and_then(Value::as_str))
                    .or_else(|| item.get("id").and_then(Value::as_str))
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| format!("camera-{}-{}", index + 1, slugify(&name)));
                let position = item
                    .get("spcamera_position")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);

                CameraDevice {
                    id,
                    name,
                    position,
                    available: true,
                }
            })
            .collect();

        Ok(cameras)
    }

    fn capture_camera(&self, request: CameraCaptureRequest) -> Result<CameraCaptureResult> {
        shared::validate_camera_request(&request)?;
        let inline_base64 = true;

        let output_path = resolve_camera_output_path(request.output_path.as_deref())?;
        let script_path = write_swift_camera_script()?;
        let mut command = Command::new("xcrun");
        command.arg("swift").arg(&script_path).arg(&output_path);
        if let Some(device_id) = request.device_id.as_deref() {
            command.arg(device_id);
        }
        command.arg("--inline-base64");

        let output = command
            .output()
            .with_context(|| format!("failed to execute camera capture helper: {}", script_path.display()))?;

        let _ = fs::remove_file(&script_path);

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            bail!(
                "camera capture failed: {}{}{}",
                stderr.trim(),
                if !stderr.trim().is_empty() && !stdout.trim().is_empty() {
                    " | "
                } else {
                    ""
                },
                stdout.trim()
            );
        }

        let parsed: Value = serde_json::from_slice(&output.stdout)
            .context("failed to parse camera capture helper output")?;
        let actual_device_id = parsed
            .get("deviceId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or(request.device_id.clone());
        let metadata = build_file_metadata(&output_path, inline_base64, "image/jpeg");
        let base64_data = parsed
            .get("base64Data")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .context("camera capture must include inline base64 data")?;
        let should_cleanup = true;
        if should_cleanup {
            let _ = fs::remove_file(&output_path);
        }

        Ok(CameraCaptureResult {
            device_id: actual_device_id,
            output_path: None,
            file_name: metadata.file_name,
            file_extension: metadata.file_extension,
            mime_type: parsed
                .get("mimeType")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .or(metadata.mime_type),
            size_bytes: metadata.size_bytes,
            transfer_encoding: metadata.transfer_encoding,
            base64_data: Some(base64_data),
            message: "Camera capture completed.".to_string(),
        })
    }

    fn capture_screen(&self, request: ScreenCaptureRequest) -> Result<ScreenCaptureResult> {
        shared::validate_screen_request(&request)?;
        let inline_base64 = true;
        let (output_path, _explicit_output_path) = resolve_screen_output_path(request.output_path.as_deref())?;
        let script_path = write_swift_screen_script()?;

        let mut command = Command::new("xcrun");
        command.arg("swift").arg(&script_path).arg(&output_path);
        if let Some(display) = request.display {
            command.arg("--display").arg(display.to_string());
        }
        command.arg("--inline-base64");

        let output = command.output().with_context(|| {
            format!(
                "failed to execute screen capture helper: {}",
                script_path.display()
            )
        })?;

        let _ = fs::remove_file(&script_path);

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            bail!(
                "screen capture failed: {}{}{}",
                stderr.trim(),
                if !stderr.trim().is_empty() && !stdout.trim().is_empty() {
                    " | "
                } else {
                    ""
                },
                stdout.trim()
            );
        }

        let parsed: Value = serde_json::from_slice(&output.stdout)
            .context("failed to parse screen capture helper output")?;

        let metadata = build_file_metadata(&output_path, inline_base64, "image/png");
        let base64_data = parsed
            .get("base64Data")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .context("screen capture must include inline base64 data")?;
        let should_cleanup = true;
        if should_cleanup {
            let _ = fs::remove_file(&output_path);
        }

        Ok(ScreenCaptureResult {
            display: request.display,
            output_path: None,
            file_name: metadata.file_name,
            file_extension: metadata.file_extension,
            mime_type: parsed
                .get("mimeType")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .or(metadata.mime_type),
            size_bytes: metadata.size_bytes,
            transfer_encoding: metadata.transfer_encoding,
            base64_data: Some(base64_data),
            message: "Screen capture completed.".to_string(),
        })
    }

    fn move_mouse(&self, request: MouseMoveRequest) -> Result<MouseMoveResult> {
        shared::validate_mouse_move(&request)?;
        bail!("{}", shared::not_implemented("mouse.move", self.platform_kind()))
    }

    fn click_mouse(&self, request: MouseClickRequest) -> Result<MouseClickResult> {
        shared::validate_mouse_click(&request)?;
        bail!("{}", shared::not_implemented("mouse.click", self.platform_kind()))
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

fn resolve_camera_output_path(output_path: Option<&str>) -> Result<String> {
    match output_path {
        Some(path) if !path.trim().is_empty() => Ok(path.to_string()),
        _ => {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            let path = env::temp_dir().join(format!("yeonjang-camera-{stamp}.jpg"));
            Ok(path.display().to_string())
        }
    }
}

fn resolve_screen_output_path(output_path: Option<&str>) -> Result<(String, bool)> {
    match output_path {
        Some(path) if !path.trim().is_empty() => Ok((path.to_string(), true)),
        _ => {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            let path = env::temp_dir().join(format!("yeonjang-screen-{stamp}.png"));
            Ok((path.display().to_string(), false))
        }
    }
}

struct FileMetadata {
    file_name: Option<String>,
    file_extension: Option<String>,
    mime_type: Option<String>,
    size_bytes: Option<u64>,
    transfer_encoding: Option<String>,
}

fn build_file_metadata(
    output_path: &str,
    inline_base64: bool,
    default_mime_type: &str,
) -> FileMetadata {
    let path = Path::new(output_path);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned);
    let file_extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned);
    let size_bytes = fs::metadata(path).map(|metadata| metadata.len()).ok();

    FileMetadata {
        file_name,
        file_extension,
        mime_type: Some(default_mime_type.to_string()),
        size_bytes,
        transfer_encoding: if inline_base64 {
            Some("base64".to_string())
        } else {
            Some("file".to_string())
        },
    }
}

fn write_swift_camera_script() -> Result<PathBuf> {
    let script_path = env::temp_dir().join(format!(
        "yeonjang-camera-capture-{}.swift",
        std::process::id()
    ));
    fs::write(&script_path, SWIFT_CAMERA_CAPTURE)
        .with_context(|| format!("failed to write swift helper to {}", script_path.display()))?;
    Ok(script_path)
}

fn write_swift_screen_script() -> Result<PathBuf> {
    let script_path = env::temp_dir().join(format!(
        "yeonjang-screen-capture-{}.swift",
        std::process::id()
    ));
    fs::write(&script_path, SWIFT_SCREEN_CAPTURE)
        .with_context(|| format!("failed to write swift helper to {}", script_path.display()))?;
    Ok(script_path)
}

fn slugify(input: &str) -> String {
    let mut result = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch.to_ascii_lowercase());
        } else if !result.ends_with('-') {
            result.push('-');
        }
    }
    let trimmed = result.trim_matches('-');
    if trimmed.is_empty() {
        "device".to_string()
    } else {
        trimmed.to_string()
    }
}

const SWIFT_CAMERA_CAPTURE: &str = r#"
import Foundation
import AVFoundation

final class PhotoDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    let destination: URL
    let semaphore: DispatchSemaphore
    var captureError: Error?

    init(destination: URL, semaphore: DispatchSemaphore) {
        self.destination = destination
        self.semaphore = semaphore
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        if let error = error {
            self.captureError = error
            return
        }
        guard let data = photo.fileDataRepresentation() else {
            self.captureError = NSError(domain: "YeonjangCamera", code: 1, userInfo: [NSLocalizedDescriptionKey: "No file data representation"])
            return
        }
        do {
            try data.write(to: destination)
        } catch {
            self.captureError = error
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: Error?) {
        if let error = error {
            self.captureError = error
        }
        semaphore.signal()
    }
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    fputs("output path argument is required\n", stderr)
    exit(2)
}

let outputPath = args[1]
let extraArgs = Array(args.dropFirst(2))
let includeBase64 = extraArgs.contains("--inline-base64")
let requestedId = extraArgs.first(where: { $0 != "--inline-base64" })
let discovery = AVCaptureDevice.DiscoverySession(
    deviceTypes: [.builtInWideAngleCamera, .externalUnknown],
    mediaType: .video,
    position: .unspecified
)

guard !discovery.devices.isEmpty else {
    fputs("No camera devices available\n", stderr)
    exit(3)
}

let device: AVCaptureDevice
if let requestedId {
    guard let matched = discovery.devices.first(where: { $0.uniqueID == requestedId || $0.localizedName == requestedId }) else {
        fputs("Requested camera device was not found\n", stderr)
        exit(4)
    }
    device = matched
} else {
    device = discovery.devices[0]
}

let session = AVCaptureSession()
session.beginConfiguration()
session.sessionPreset = .photo

let input: AVCaptureDeviceInput
do {
    input = try AVCaptureDeviceInput(device: device)
} catch {
    fputs("Failed to create camera input: \(error)\n", stderr)
    exit(5)
}

guard session.canAddInput(input) else {
    fputs("Camera input cannot be added to the session\n", stderr)
    exit(6)
}
session.addInput(input)

let photoOutput = AVCapturePhotoOutput()
guard session.canAddOutput(photoOutput) else {
    fputs("Camera output cannot be added to the session\n", stderr)
    exit(7)
}
session.addOutput(photoOutput)
session.commitConfiguration()
session.startRunning()
Thread.sleep(forTimeInterval: 0.5)

let semaphore = DispatchSemaphore(value: 0)
let delegate = PhotoDelegate(destination: URL(fileURLWithPath: outputPath), semaphore: semaphore)
photoOutput.capturePhoto(with: AVCapturePhotoSettings(), delegate: delegate)

if semaphore.wait(timeout: .now() + 15) == .timedOut {
    session.stopRunning()
    fputs("Timed out while waiting for camera capture\n", stderr)
    exit(8)
}

session.stopRunning()

if let error = delegate.captureError {
    fputs("Camera capture failed: \(error)\n", stderr)
    exit(9)
}

var payload: [String: Any] = [
    "deviceId": device.uniqueID,
    "deviceName": device.localizedName,
    "outputPath": outputPath,
    "mimeType": "image/jpeg"
]
if includeBase64 {
    payload["base64Data"] = try Data(contentsOf: URL(fileURLWithPath: outputPath)).base64EncodedString()
}
let data = try JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(data)
"#;

const SWIFT_SCREEN_CAPTURE: &str = r#"
import Foundation
import CoreGraphics

let args = Array(CommandLine.arguments.dropFirst())
guard !args.isEmpty else {
    fputs("output path argument is required\n", stderr)
    exit(2)
}

let outputPath = args[0]
var displayId: String?
var includeBase64 = false
var index = 1
while index < args.count {
    let value = args[index]
    if value == "--inline-base64" {
        includeBase64 = true
        index += 1
        continue
    }
    if value == "--display", index + 1 < args.count {
        displayId = args[index + 1]
        index += 2
        continue
    }
    index += 1
}

if !CGPreflightScreenCaptureAccess() {
    guard CGRequestScreenCaptureAccess() else {
        fputs("Screen Recording permission was not granted\n", stderr)
        exit(10)
    }
}

let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
var captureArgs = ["-x"]
if let displayId, !displayId.isEmpty {
    captureArgs.append(contentsOf: ["-D", displayId])
}
captureArgs.append(outputPath)
task.arguments = captureArgs

let stderrPipe = Pipe()
task.standardError = stderrPipe

do {
    try task.run()
    task.waitUntilExit()
} catch {
    fputs("Failed to launch screencapture: \(error)\n", stderr)
    exit(11)
}

if task.terminationStatus != 0 {
    let errorOutput = String(data: stderrPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    fputs("screencapture failed: \(errorOutput)\n", stderr)
    exit(12)
}

var payload: [String: Any] = [
    "outputPath": outputPath,
    "mimeType": "image/png"
]
if includeBase64 {
    payload["base64Data"] = try Data(contentsOf: URL(fileURLWithPath: outputPath)).base64EncodedString()
}
let data = try JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(data)
"#;
