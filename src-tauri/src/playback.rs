use crate::config::Settings;
use crate::error::{HushError, Result};
use crate::player::{Command, PlayerHandle, TrackInfo};
use crate::server;

/// Resolve a track to an authenticated stream URL and hand it to the player.
/// Shared by the `player_load` command and the Listen Together guest path.
pub fn load_track(
    player: &PlayerHandle,
    settings: &Settings,
    http: &reqwest::Client,
    mut track: TrackInfo,
) -> Result<()> {
    let client = server::build(settings, http.clone())?;
    let url = client.stream_url(&track.id);
    if url.is_empty() {
        return Err(HushError::Playback(
            "Could not build a stream URL for this track.".into(),
        ));
    }

    if let Some(cover) = track.cover_art.clone() {
        track.cover_url = Some(client.cover_url(&cover, 600));
    }
    track.server = Some(settings.display_server_name());

    player.send(Command::Load { url, track });
    Ok(())
}
