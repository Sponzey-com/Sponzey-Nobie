pub mod shared;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod unsupported;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
pub use linux::PlatformBackend as CurrentBackend;
#[cfg(target_os = "macos")]
pub use macos::PlatformBackend as CurrentBackend;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub use unsupported::PlatformBackend as CurrentBackend;
#[cfg(target_os = "windows")]
pub use windows::PlatformBackend as CurrentBackend;

pub fn current_backend() -> CurrentBackend {
    CurrentBackend
}
