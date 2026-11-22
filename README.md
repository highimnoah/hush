# hush

**hush** is a calm, minimal desktop music player for [Navidrome](https://www.navidrome.org/) and any Subsonic-compatible server. It pairs a Tauri v2 shell with a native Rust audio pipeline (GStreamer), so playback quality and ReplayGain do not depend on the WebView.

The visual language is a flat, very dark midnight-blue theme with off-white text, restrained pastel accents, and **no gradients**. Typography is self-hosted Montserrat. The app name is always written lowercase: **hush**.

---

## Features

- Browse your library: Home, Search, Artists, Albums, Playlists, Liked.
- Full transport: play, pause, stop/clear, next, previous, seek, volume, mute.
- Queue management: play next, add to queue, remove, drag-to-reorder, clear.
- Shuffle and repeat (off / all / one).
- Native GStreamer playback: FLAC, MP3, AAC/M4A, Opus, Ogg Vorbis, WAV (ALAC with `gst-libav`).
- ReplayGain: Off / Track / Album, applied with GStreamer `rgvolume`, optional pre-amp.
- Real waveform seek bar in the player bar and Now Playing (decoded in Rust and cached).
- Now Playing view with technical track information (format, bit depth, sample rate, bitrate, channels, ReplayGain gain, server).
- Favorites for songs (heart in track lists) and albums (hero + card).
- Discord Rich Presence (Listening), hidden on pause/stop, with customizable templates, an optional album-art cover, and a progress timeline.
- **Listen together** — create a session, share a 6-character code, and keep playback in sync with friends on the same Navidrome server via the self-hosted `hush-sync` relay.
- MPRIS desktop integration (media keys + desktop media controls) on Linux.
- System tray with Play/Pause, Next, Previous, Show and Quit.
- Compact always-on-top mini player window.
- Sleep timer that pauses playback after a chosen time.
- Volume and window size restored between launches.
- Settings persisted between restarts, with a flat accent-colour picker and a comfortable UI scale.
- Loading, empty and error states throughout; keyboard-accessible controls.

---

## Architecture

```
┌──────────────────────────────  React (WebView)  ─────────────────────────────┐
│  Views: Home · Search · Artists · Albums · Playlists · Liked · Settings      │
│  Zustand: player (queue/transport) · settings · context menu                 │
│  lib/ipc.ts — typed invoke() wrappers + event subscriptions                  │
└──────────────▲───────────────────────────────┬───────────────────────────────┘
      commands (invoke)                events (player://state, position, …)
┌──────────────┴───────────────────────────────▼───────────────────────────────┐
│  Rust core                                                                   │
│  ├─ config.rs        settings persistence (atomic JSON write)                │
│  ├─ server/          MusicServer trait + SubsonicClient (reqwest + rustls)   │
│  ├─ player/engine.rs GStreamer pipeline: uridecodebin → rgvolume → volume    │
│  ├─ discord.rs       discord-rich-presence IPC (dedicated thread)            │
│  ├─ mpris.rs         MPRIS service (dedicated local tokio runtime)           │
│  ├─ session/         Listen Together: WebSocket client + clock sync          │
│  ├─ tray.rs          system tray menu                                        │
│  └─ commands.rs      thin Tauri command layer with friendly errors           │
└──────────────────────────────────────────────────────────────────────────────┘
        │ Subsonic REST                             │ authenticated stream URL
        ▼                                           ▼
   Navidrome / Subsonic                    GStreamer → PipeWire / Pulse / ALSA
```

Listen Together is optional and additive: hush instances connect to a tiny self-hosted WebSocket relay (`hush-sync/`) and exchange only playback state (track, position, play/pause, clock pings). Audio still streams directly from each listener's own Navidrome.

### Frontend / backend split

- The **Rust backend** owns credentials, the Subsonic client, audio decoding, ReplayGain, Discord, MPRIS and the Listen Together session client. Credentials never reach JavaScript.
- The **React frontend** owns the queue, shuffle/repeat ordering, views and transport intent. It drives Rust with commands and listens to events.
- Native surfaces (tray, MPRIS media keys) emit a `hush://command` event that the frontend translates into the same store actions, keeping a single source of truth for the queue.
- In a Listen Together session, the host forwards `player://state`/`player://position`; guests estimate the host clock and apply the shared state through the same player commands.

---

## Recommended libraries and why

| Area | Choice | Rationale |
| --- | --- | --- |
| Shell | **Tauri v2** | Small binaries, Rust backend, native WebView, minimal permissions. |
| UI | **React 19 + TypeScript + Vite** | Fast iteration, strong typing, small runtime. |
| State | **Zustand** | Tiny, no boilerplate, ideal for a player + queue store. |
| Styling | **CSS Modules + CSS variables** | Zero-runtime, scoped styles, design tokens drive the flat theme. |
| Font | **`@fontsource-variable/montserrat`** | Self-hosted/bundled, one variable file for every weight. |
| Icons | **`lucide-react`** | MIT, tree-shakeable, matches the minimal aesthetic. |
| Routing | **`react-router-dom` (HashRouter)** | Cheap client routing that is safe under Tauri’s custom protocol. |
| Audio | **GStreamer (`gstreamer` crate)** | Native decoding for all required formats, real ReplayGain via `rgvolume`, HTTP streaming through `souphttpsrc`. |
| HTTP | **`reqwest` (rustls)** | Async, no OpenSSL coupling, works cleanly with Navidrome HTTPS. |
| Discord | **`discord-rich-presence`** | Simple IPC client, supports the “Listening” activity type. |
| Media keys | **`mpris-server`** | Proper MPRIS service; gives media keys and desktop integration. |
| Listen Together | **`tokio-tungstenite` + `hush-sync`** | Small JSON WebSocket protocol and a self-hosted relay; keeps the feature private and free. |

---

## Project structure

```
hush-tauri/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.tsx                 # entry; chooses App or MiniApp
│   ├── App.tsx                  # shell, routing, event wiring, shortcuts
│   ├── MiniApp.tsx              # compact mini-player window
│   ├── components/
│   │   ├── Sidebar.tsx · PlayerBar.tsx · NowPlaying.tsx · QueuePanel.tsx
│   │   ├── library/             TrackList · AlbumCard · ArtistCard · PlaylistCard
│   │   └── ui/                  Artwork · Slider · WaveformSeek · Switch · states · context menu
│   ├── views/                   Home · Search · Together · Artists · Albums · Playlists · Liked · Settings
│   ├── store/                   player.ts · library.ts · session.ts · settings.ts · contextMenu.ts
│   ├── lib/                     ipc.ts · types.ts · format.ts · waveform.ts · useAsync.ts · hooks.ts
│   └── styles/                  tokens.css · global.css · *.module.css
├── hush-sync/                   # self-hosted Listen Together relay
│   ├── Cargo.toml · Dockerfile · README.md
│   ├── protocol/                # shared wire types (hush-session-protocol)
│   └── src/main.rs              # rooms, presence, host migration, message fan-out
└── src-tauri/
    ├── Cargo.toml · tauri.conf.json · capabilities/default.json · icons/
    └── src/
        ├── main.rs · lib.rs · commands.rs · config.rs · error.rs · events.rs · playback.rs
        ├── server/  mod.rs (trait) · subsonic.rs · types.rs
        ├── player/  mod.rs · engine.rs · waveform.rs
        ├── session/  mod.rs · service.rs
        ├── discord.rs · mpris.rs · tray.rs
```

---

## App icon

The icon set is generated from `hush.png` at the repository root:

```bash
npx tauri icon hush.png
```

This regenerates `src-tauri/icons/` (desktop PNG/ICO/ICNS plus mobile assets). hush also sets the window and tray icons from the embedded PNGs at runtime.

> On KDE Wayland in `tauri dev`, KWin resolves the window-decoration icon through a desktop entry. A hidden `~/.local/share/applications/hush.desktop` (`NoDisplay=true`, pointing at `src-tauri/icons/128x128.png`, `StartupWMClass=hush`) was added on this machine for that. Production bundles ship their own desktop entry and hicolor icons.

---

## Prerequisites (Linux, primary target)

- Node.js 20+ and npm
- Rust stable + Cargo
- GTK 3 and WebKitGTK 4.1 development packages
- GStreamer 1.24+ (base, good, bad, ugly). Install `gst-libav` for ALAC.
- `libappindicator`/`libayatana-appindicator` for the system tray
- PipeWire, PulseAudio or ALSA for audio output

### Arch Linux (matching the development environment)

```bash
sudo pacman -S --needed base-devel curl wget file openssl \
  gtk3 webkit2gtk-4.1 librsvg \
  libappindicator-gtk3 \
  gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-plugins-ugly gst-libav
```

### Debian / Ubuntu

```bash
sudo apt install build-essential curl file libssl-dev \
  libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev \
  libayatana-appindicator3-dev \
  gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav
```

### Fedora

```bash
sudo dnf install gcc gcc-c++ make curl file openssl-devel \
  gtk3-devel webkit2gtk4.1-devel librsvg2-devel \
  libappindicator-gtk3-devel \
  gstreamer1-plugins-base gstreamer1-plugins-good \
  gstreamer1-plugins-bad-free gstreamer1-plugins-ugly gstreamer1-libav
```

> Codec availability can be verified with `gst-inspect-1.0 flacdec`, `opusdec`, `mpg123audiodec`, `faad`, `avdec_alac`, etc.

---

## Setup and run

```bash
# 1. install frontend dependencies
npm install

# 2. run in development (starts Vite + the Tauri app)
npm run tauri dev
```

For Listen Together, run the self-hosted relay in a separate terminal:

```bash
cd hush-sync
cargo run --release
# listening on 0.0.0.0:8787
```

The app defaults to `ws://127.0.0.1:8787`; change it in **Settings → Listen together**.

### Production build

```bash
npm run tauri build
```

Bundles land in `src-tauri/target/release/bundle/` (`.deb`, `.rpm`, `.AppImage`, etc., depending on the tooling available).

The desktop identifier is `app.hush.desktop`, so the config file lives at:

```
~/.config/app.hush.desktop/settings.json
```

---

## Configuration

Everything is editable in **Settings**. A representative `settings.json`:

```json
{
  "serverUrl": "https://music.example.com",
  "username": "you",
  "password": "",
  "token": "REPLACE_WITH_TOKEN",
  "salt": "REPLACE_WITH_SALT",
  "serverName": "Home",
  "replaygain": "album",
  "replaygainPreamp": 0,
  "volume": 0.8,
  "muted": false,
  "discordEnabled": true,
  "discordClientId": "1573866319844212849",
  "discordDetails": "{title}",
  "discordState": "by {artist}",
  "discordLargeImage": "hush",
  "discordTimestamps": true,
  "discordUseCover": true,
  "accent": "blue",
  "sessionName": "noah",
  "sessionRelayUrl": "ws://127.0.0.1:8787",
  "windowWidth": 1280,
  "windowHeight": 840,
  "windowMaximized": false
}
```

### Authentication

- **API token (preferred):** paste the token and salt generated by Navidrome. hush sends Subsonic `t` + `s` parameters.
- **Password:** if no token is set, hush sends the Subsonic `p` parameter.

Credentials are stored locally in plaintext JSON. Prefer a token, and treat the config file as sensitive.

### Accents

`blue` (default), `mint`, `rose`, `amber`, `lavender`.

---

## Discord Rich Presence

1. Create an application at <https://discord.com/developers/applications>.
2. Copy its **Application ID** (client ID) into Settings (the default is already `1573866319844212849`).
3. Under **Rich Presence → Art Assets**, upload a square image and name the asset `hush` (matches the default large-image key).
4. Enable Rich Presence in Settings.

Presence is shown only while a track is playing and is cleared on pause, stop, track end and app exit. If Discord is not running, hush retries in the background and playback is unaffected.

Templates support:

`{app}` `{title}` `{artist}` `{album}` `{albumArtist}` `{server}` `{format}` `{bitrate}` `{elapsed}` `{duration}`

Example: details `{title}`, state `on {album} • {app}`.

**Album art and timeline**

- **Use album art as the large image** (Settings → Discord) passes the current track's authenticated HTTPS cover URL to Discord. If the URL is unavailable or not HTTPS, hush falls back to the configured static asset key.
- The presence uses both a start and end timestamp, so Discord renders a live progress timeline rather than only elapsed time.
- An authenticated cover URL contains your Subsonic token in its query string; it is shared with Discord's image proxy. Disable the album-art toggle if you prefer the static asset.

---

## Listen together

Hear the same track at the same time with friends.

**How it works**

- One person hosts: hush creates a room and shows a 6-character code.
- Friends join with the code (or a `#/together?code=CODE` invite link).
- The host controls playback. Play, pause, seek and track changes are mirrored; every guest streams from their own copy of the **same Navidrome server**.
- Guests estimate the host clock with NTP-style pings and correct drift with periodic seeks.
- Presence only: participants, shared now-playing and sync status. No chat.

**Self-host the relay**

The relay is a separate, tiny Rust service:

```bash
cd hush-sync
cargo run --release
# [hush-sync] listening on 0.0.0.0:8787
```

Or Docker:

```bash
cd hush-sync
docker build -t hush-sync .
docker run --rm -p 8787:8787 hush-sync
```

Set the relay URL in **Settings → Listen together** (`ws://host:8787`). For remote friends, put it behind a TLS reverse proxy and use `wss://` — see [`hush-sync/README.md`](./hush-sync/README.md).

**Requirements and limits**

- Everyone must use the **same Navidrome server**; sync is by stable track ID.
- **Host-only control** in this version.
- Music-grade sync: the host clock is estimated continuously and playback is corrected when drift becomes noticeable. Final alignment depends on network and seek latency.
- The relay sees display names and track metadata/positions, never music credentials or audio. Treat the 6-character code as a shared secret.

---

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Space` | Play / pause |
| `Ctrl` + `→` / `←` | Next / previous |
| `Ctrl` + `↑` / `↓` | Volume up / down |
| `Ctrl` + `M` | Mute toggle |
| `Esc` | Close Now Playing / Queue |

Media keys and desktop media controls are handled via MPRIS.

---

## ReplayGain

- Modes: **Off**, **Track**, **Album**.
- Applied in the GStreamer pipeline with `rgvolume`; the album/track mode only changes one property.
- Switching between **Off** and an active mode rebuilds the pipeline at the current position (the gain stage is added/removed).
- GStreamer honours ReplayGain peak tags to reduce clipping when present. A pre-amp (dB) is available in Settings.
- If a file has no ReplayGain tags, `rgvolume` falls back to 0 dB (`fallback-gain`), i.e. no change.

---

## Audio format support

| Format | Support | Notes |
| --- | --- | --- |
| FLAC | ✅ | `flacdec` |
| MP3 | ✅ | `mpg123audiodec` (plugins-ugly) |
| AAC / M4A | ✅ | `faad` + `qtdemux` |
| Opus | ✅ | `opusdec` |
| Ogg Vorbis | ✅ | `vorbisdec` |
| WAV | ✅ | `wavparse` |
| ALAC | ⚠️ | requires `gst-libav` (`avdec_alac`) or a GStreamer build with the `alac` element |

Navidrome should serve the **original** file (transcoding off) so ReplayGain tags and full quality are preserved.

---

## Troubleshooting

### WebKitGTK / GTK

- Ensure `webkit2gtk-4.1` and `gtk3` development packages match your Tauri version (v2 uses WebKitGTK 4.1).
- A blank white window usually means the frontend failed to load. Run `npm run dev` and open <http://localhost:1420> to check for JS errors, and inspect the Tauri terminal output.

### Wayland vs X11

- hush works on both. If the window is blank or flickers under Wayland, try:

  ```bash
  WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev
  ```

- To force XWayland:

  ```bash
  GDK_BACKEND=x11 npm run tauri dev
  ```

### NVIDIA (proprietary driver)

- No CUDA is required. Rendering uses normal WebKitGTK/GTK GL paths.
- If you see compositing artefacts or a stalled window on NVIDIA + Wayland, force the software-rendered path:

  ```bash
  HUSH_SOFTWARE_RENDERING=1 npm run tauri dev
  ```

  This sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `WEBKIT_DISABLE_COMPOSITING_MODE=1`.
- As a last resort: `LIBGL_ALWAYS_SOFTWARE=1`.

### No audio

- Confirm a sink exists: `gst-inspect-1.0 autoaudiosink` and `pactl info` (PipeWire-Pulse) or `wpctl status`.
- Try `GST_DEBUG=3 npm run tauri dev` to see pipeline errors.
- If a format fails, verify its decoder with `gst-inspect-1.0 <element>`.

### System tray missing

- Install `libappindicator-gtk3` (Arch) / `libayatana-appindicator3` (Debian) / `libappindicator-gtk3` (Fedora).
- GNOME may hide legacy tray icons; install an AppIndicator extension or use KDE/other desktops. If the tray is unavailable, hush logs a warning and continues normally.

### MPRIS / media keys

- MPRIS is exposed as `org.mpris.MediaPlayer2.hush`. Check with `playerctl -l` and `playerctl status`.
- Media keys work when a D-Bus session bus exists (normal desktop sessions). Headless sessions may not provide one; hush degrades gracefully.

### Discord

- Ensure the Discord desktop client is running. hush retries every few seconds and never blocks playback.
- If presence does not appear, verify the client ID and that the `hush` asset exists under Rich Presence → Art Assets.
- Flatpak/Snap Discord sockets are supported by the underlying crate.

### Cover art

- Cover art URLs are authenticated Subsonic `getCoverArt` links loaded directly by the WebView. On a plain-HTTP Navidrome instance behind a WebView that treats its own protocol as secure, the browser may block the image as mixed content. Use HTTPS (recommended) or ensure the server is reachable over the same scheme the app expects. Missing artwork always falls back to a flat placeholder.

---

## Limitations and assumptions

- **ALAC** requires `gst-libav`; it is not available on a minimal GStreamer install.
- **Gapless playback** is not guaranteed because the frontend advances the queue on track end.
- **Discord cover art** requires a publicly reachable HTTPS cover URL. When unavailable (or disabled) hush falls back to the static `hush` asset key.
- **Credentials** are stored locally in plaintext JSON; use a token. Encrypted storage (Stronghold/keyring) is a possible future upgrade.
- **Shuffle/repeat** are session-scoped (not persisted between restarts).
- **Listen Together** requires a running `hush-sync` relay, the same Navidrome server for all participants, and host-only control (no collaborative queue yet). Sync is music-grade, not video-grade.
- **Transcoding** should be disabled on the server to keep ReplayGain metadata and quality.
- The architecture is cross-platform where reasonable, but Linux (WebKitGTK/GTK3/GStreamer/AppIndicator) is the primary target and the tested configuration.

---

## Testing checklist

- [ ] App launches; window title and branding read `hush`; Montserrat is applied.
- [ ] Theme is flat midnight blue; no gradients anywhere.
- [ ] Settings: enter server URL + token/salt; **Test connection** succeeds; **Save** persists across restart.
- [ ] Open Settings with an invalid URL / wrong credentials → clear error state.
- [ ] Home loads recently added / recently played / quick picks.
- [ ] Search returns songs, albums and artists; empty query shows an empty state.
- [ ] Album, artist and playlist detail pages render; **Play** and **Shuffle** start playback.
- [ ] Play, pause, stop, next, previous work; progress and time labels update.
- [ ] Click/drag the seek bar; volume slider and mute work.
- [ ] The waveform timeline renders real peaks and seeks correctly.
- [ ] Add/remove favorites for a song and an album; reload and confirm they persist.
- [ ] Shuffle toggles order; repeat cycles off → all → one; queue advances on track end.
- [ ] Add to queue / play next / remove / drag-reorder / clear queue.
- [ ] Play FLAC, MP3, M4A/AAC, Opus, Ogg Vorbis and WAV; confirm technical info.
- [ ] ReplayGain Off/Track/Album applies gain; pre-amp changes loudness.
- [ ] Discord presence appears while playing, hides on pause/stop; templates update; album art and the progress timeline show.
- [ ] Tray play/pause/next/previous/show/quit.
- [ ] MPRIS: `playerctl play-pause`, `playerctl next`, media keys.
- [ ] Mini player opens, stays on top, controls playback, closes.
- [ ] Sleep timer pauses playback after the chosen interval.
- [ ] Volume and window size are restored after closing and relaunching.
- [ ] Listen together: create a session, join with a second client (or `#/together?code=…`), and confirm both sides show the same now-playing and participants.
- [ ] Host play/pause/seek/skip mirrors on the guest; the sync badge settles to “In sync”.
- [ ] Host leaves → the relay promotes another member; relay down → clear error state.
- [ ] Keyboard shortcuts work; focus rings visible; contrast is comfortable.
- [ ] Launch on X11 and Wayland; verify the NVIDIA software-rendering fallback.
