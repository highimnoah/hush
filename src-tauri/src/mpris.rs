//! Desktop media controls.
//!
//! MPRIS is a Linux/D-Bus specification. On other platforms this module
//! exposes the same API backed by a no-op handle so the rest of the player
//! stays platform-agnostic.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(not(target_os = "linux"))]
mod stub;
#[cfg(not(target_os = "linux"))]
pub use stub::*;
