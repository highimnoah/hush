//! Desktop media controls.
//!
//! MPRIS is a Linux/D-Bus specification; Windows uses System Media Transport
//! Controls via `souvlaki`. On other platforms this module exposes the same API
//! backed by a no-op handle so the rest of the player stays platform-agnostic.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
mod stub;
#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub use stub::*;
