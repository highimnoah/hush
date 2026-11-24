import {
  AlertCircle,
  Check,
  Disc3,
  Handshake,
  Info,
  Palette,
  Radio,
  RefreshCw,
  Server,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Slider } from "../components/ui/Slider";
import { ErrorState } from "../components/ui/ErrorState";
import { Loading } from "../components/ui/States";
import { Switch } from "../components/ui/Switch";
import { formatBytes } from "../lib/format";
import { api } from "../lib/ipc";
import type {
  ArtistImageCacheInfo,
  ArtistImageMode,
  ReplayGainMode,
  Settings,
  TransitionMode,
} from "../lib/types";
import { ACCENTS } from "../lib/types";
import { useSettings } from "../store/settings";
import { useUpdater } from "../store/updater";
import styles from "../styles/settings.module.css";
import ui from "../styles/ui.module.css";

type TestState = "idle" | "testing" | "ok" | "error";

const TOKENS = [
  "{app}",
  "{title}",
  "{artist}",
  "{album}",
  "{albumArtist}",
  "{server}",
  "{format}",
  "{bitrate}",
  "{elapsed}",
  "{duration}",
];

const REPLAYGAIN_LABELS: Record<ReplayGainMode, string> = {
  off: "Off",
  track: "Track",
  album: "Album",
};

export function SettingsView() {
  const settings = useSettings((state) => state.settings);
  const loaded = useSettings((state) => state.loaded);
  const loadError = useSettings((state) => state.loadError);
  const saveSettings = useSettings((state) => state.save);
  const testConnection = useSettings((state) => state.test);

  const updaterStatus = useUpdater((state) => state.status);
  const updaterSupported = useUpdater((state) => state.supported);
  const updaterVersion = useUpdater((state) => state.version);
  const currentVersion = useUpdater((state) => state.currentVersion);
  const checkUpdates = useUpdater((state) => state.check);
  const openUpdatePrompt = useUpdater((state) => state.openPrompt);
  const openReleases = useUpdater((state) => state.openReleases);
  const loadVersion = useUpdater((state) => state.loadVersion);

  const [form, setForm] = useState<Settings | null>(null);
  const [authMode, setAuthMode] = useState<"token" | "password">("token");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testState, setTestState] = useState<TestState>("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [artistCache, setArtistCache] = useState<ArtistImageCacheInfo | null>(
    null,
  );
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);

  useEffect(() => {
    if (settings && form === null) {
      setForm({ ...settings });
      setAuthMode(
        settings.token.trim() && settings.salt.trim()
          ? "token"
          : settings.password
            ? "password"
            : "token",
      );
    }
  }, [settings, form]);

  useEffect(() => {
    if (form?.accent) {
      document.documentElement.dataset.accent = form.accent;
    }
  }, [form?.accent]);

  useEffect(() => {
    return () => {
      const saved = useSettings.getState().settings?.accent ?? "blue";
      document.documentElement.dataset.accent = saved;
    };
  }, []);

  useEffect(() => {
    void loadVersion();
  }, [loadVersion]);

  useEffect(() => {
    void api
      .artistImageCacheInfo()
      .then(setArtistCache)
      .catch(() => {});
  }, []);

  if (!loaded) {
    return (
      <div className={styles.wrap}>
        <Loading label="Loading settings…" />
      </div>
    );
  }

  if (!form) {
    return (
      <div className={styles.wrap}>
        <ErrorState
          title="Settings unavailable"
          message={loadError ?? "Could not load settings."}
        />
      </div>
    );
  }

  const update = (patch: Partial<Settings>) =>
    setForm((current) => (current ? { ...current, ...patch } : current));

  const normalized = (): Settings => {
    const base = { ...form };
    if (authMode === "token") {
      base.password = "";
    } else {
      base.token = "";
      base.salt = "";
    }
    return base;
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const saved = await saveSettings(normalized());
      setForm({ ...saved });
      setSaveMessage("Saved");
      window.setTimeout(() => setSaveMessage(null), 2500);
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTestState("testing");
    setTestMessage(null);
    try {
      const info = await testConnection(normalized());
      setTestState("ok");
      const details = [info.kind, info.version].filter(Boolean).join(" · ");
      setTestMessage(
        details ? `Connected to ${details}` : "Connected successfully",
      );
    } catch (err) {
      setTestState("error");
      setTestMessage(String(err));
    }
  };

  const handleClearArtistCache = async () => {
    setClearingCache(true);
    setCacheMessage(null);
    try {
      const cleared = await api.clearArtistImageCache();
      setArtistCache(await api.artistImageCacheInfo());
      const size = formatBytes(cleared.bytes) ?? "0 B";
      setCacheMessage(
        `Cleared ${cleared.count} ${cleared.count === 1 ? "image" : "images"} (${size}).`,
      );
    } catch (err) {
      setCacheMessage(String(err));
    } finally {
      setClearingCache(false);
    }
  };

  const updateNote =
    updaterStatus === "checking"
      ? "Checking for updates…"
      : updaterStatus === "up-to-date"
        ? "You're up to date."
        : updaterStatus === "available"
          ? `hush ${updaterVersion ?? ""} is available.`
          : updaterStatus === "downloading"
            ? "Downloading update…"
            : updaterStatus === "ready"
              ? "Downloaded — install from the update prompt."
              : updaterStatus === "installing"
                ? "Installing update…"
                : updaterStatus === "error"
                  ? "Could not check for updates."
                  : "";

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Settings</h1>
          <div className={styles.subtitle}>
            Connect your server, tune playback, and make hush yours.
          </div>
        </div>
        <div className={styles.headActions}>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <div className={styles.saveRow}>
            {saveError ? (
              <span className={`${styles.status} ${styles.statusError}`}>
                <AlertCircle size={14} />
                {saveError}
              </span>
            ) : saveMessage ? (
              <span className={`${styles.status} ${styles.statusOk}`}>
                <Check size={14} />
                {saveMessage}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Server */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.cardIcon}>
            <Server size={18} />
          </div>
          <div>
            <div className={styles.cardTitle}>Music server</div>
            <div className={styles.cardDesc}>
              Navidrome or any Subsonic-compatible server.
            </div>
          </div>
        </div>

        <div className={styles.stack}>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="server-url">
              Server URL
            </label>
            <input
              id="server-url"
              className={ui.input}
              value={form.serverUrl}
              onChange={(event) => update({ serverUrl: event.target.value })}
              placeholder="https://music.example.com"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div className={styles.grid2}>
            <div className={ui.field}>
              <label className={ui.label} htmlFor="username">
                Username
              </label>
              <input
                id="username"
                className={ui.input}
                value={form.username}
                onChange={(event) => update({ username: event.target.value })}
                autoComplete="username"
                spellCheck={false}
              />
            </div>
            <div className={ui.field}>
              <label className={ui.label} htmlFor="server-name">
                Server name (optional)
              </label>
              <input
                id="server-name"
                className={ui.input}
                value={form.serverName}
                onChange={(event) => update({ serverName: event.target.value })}
                placeholder="Shown in Discord presence"
                spellCheck={false}
              />
            </div>
          </div>

          <div className={ui.field}>
            <span className={ui.label}>Authentication</span>
            <div className={ui.segmented} style={{ width: "fit-content" }}>
              <button
                type="button"
                className={`${ui.segment} ${authMode === "token" ? ui.segmentActive : ""}`}
                onClick={() => setAuthMode("token")}
              >
                API token
              </button>
              <button
                type="button"
                className={`${ui.segment} ${authMode === "password" ? ui.segmentActive : ""}`}
                onClick={() => setAuthMode("password")}
              >
                Password
              </button>
            </div>
            <span className={ui.hint}>
              {authMode === "token"
                ? "Generate an API token in Navidrome, then paste the token and its salt."
                : "Your password is stored locally on this machine."}
            </span>
          </div>

          {authMode === "token" ? (
            <div className={styles.grid2}>
              <div className={ui.field}>
                <label className={ui.label} htmlFor="token">
                  Token
                </label>
                <input
                  id="token"
                  className={ui.input}
                  value={form.token}
                  onChange={(event) => update({ token: event.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <div className={ui.field}>
                <label className={ui.label} htmlFor="salt">
                  Salt
                </label>
                <input
                  id="salt"
                  className={ui.input}
                  value={form.salt}
                  onChange={(event) => update({ salt: event.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
            </div>
          ) : (
            <div className={ui.field}>
              <label className={ui.label} htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className={ui.input}
                value={form.password}
                onChange={(event) => update({ password: event.target.value })}
                autoComplete="current-password"
              />
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={`${ui.button} ${ui.ghost}`}
              onClick={handleTest}
              disabled={testState === "testing"}
            >
              {testState === "testing" ? "Testing…" : "Test connection"}
            </button>
            {testState === "ok" ? (
              <span className={`${styles.status} ${styles.statusOk}`}>
                <Check size={14} />
                {testMessage}
              </span>
            ) : null}
            {testState === "error" ? (
              <span className={`${styles.status} ${styles.statusError}`}>
                <AlertCircle size={14} />
                {testMessage}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {/* Playback */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.cardIcon}>
            <Disc3 size={18} />
          </div>
          <div>
            <div className={styles.cardTitle}>Playback</div>
            <div className={styles.cardDesc}>
              ReplayGain keeps loudness consistent. Changing between Off and an
              active mode reloads the current track.
            </div>
          </div>
        </div>

        <div className={styles.stack}>
          <div className={styles.replaygainRow}>
            <div>
              <div className={styles.rowLabel}>ReplayGain</div>
              <div className={styles.rowHint}>
                Off, per-track gain, or per-album gain.
              </div>
            </div>
            <div className={ui.segmented}>
              {(["off", "track", "album"] as ReplayGainMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`${ui.segment} ${form.replaygain === mode ? ui.segmentActive : ""}`}
                  onClick={() => update({ replaygain: mode })}
                >
                  {REPLAYGAIN_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className={styles.rowBetween}>
              <div>
                <div className={styles.rowLabel}>ReplayGain pre-amp</div>
                <div className={styles.rowHint}>
                  Extra headroom or gain applied on top of ReplayGain.
                </div>
              </div>
              <span className={styles.preampValue}>
                {form.replaygainPreamp > 0 ? "+" : ""}
                {form.replaygainPreamp.toFixed(0)} dB
              </span>
            </div>
            <Slider
              value={form.replaygainPreamp + 12}
              max={24}
              step={1}
              ariaLabel="ReplayGain pre-amp"
              onChange={(value) =>
                update({ replaygainPreamp: Math.round(value - 12) })
              }
            />
          </div>

          <div className={styles.rowBetween}>
            <div>
              <div className={styles.rowLabel}>Track transitions</div>
              <div className={styles.rowHint}>
                Gapless for album listening, or a short fade at each boundary.
              </div>
            </div>
            <div className={ui.segmented}>
              {(["gapless", "fade"] as TransitionMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`${ui.segment} ${form.transitionMode === mode ? ui.segmentActive : ""}`}
                  onClick={() => update({ transitionMode: mode })}
                >
                  {mode === "gapless" ? "Gapless" : "Fade"}
                </button>
              ))}
            </div>
          </div>

          {form.transitionMode === "fade" ? (
            <div>
              <div className={styles.rowBetween}>
                <div>
                  <div className={styles.rowLabel}>Fade length</div>
                  <div className={styles.rowHint}>
                    How long the volume ramp lasts at each track boundary.
                  </div>
                </div>
                <span className={styles.preampValue}>
                  {form.fadeSeconds}s
                </span>
              </div>
              <Slider
                value={Math.max(0, form.fadeSeconds - 1)}
                max={7}
                step={1}
                ariaLabel="Fade length"
                onChange={(value) =>
                  update({ fadeSeconds: Math.round(value) + 1 })
                }
              />
            </div>
          ) : null}

          <div className={styles.rowBetween}>
            <div>
              <div className={styles.rowLabel}>Resume on launch</div>
              <div className={styles.rowHint}>
                Restore the last queue, track and position, and start playing
                automatically.
              </div>
            </div>
            <Switch
              checked={form.resumePlayback}
              onChange={(value) => update({ resumePlayback: value })}
              label="Resume playback on launch"
            />
          </div>
        </div>
      </section>

      {/* Discord */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.cardIcon}>
            <Radio size={18} />
          </div>
          <div>
            <div className={styles.cardTitle}>Discord Rich Presence</div>
            <div className={styles.cardDesc}>
              Show what you are listening to while a track is playing.
            </div>
          </div>
        </div>

        <div className={styles.stack}>
          <div className={styles.rowBetween}>
            <div>
              <div className={styles.rowLabel}>Enable Rich Presence</div>
              <div className={styles.rowHint}>
                Presence hides automatically when paused or stopped.
              </div>
            </div>
            <Switch
              checked={form.discordEnabled}
              onChange={(value) => update({ discordEnabled: value })}
              label="Enable Discord Rich Presence"
            />
          </div>

          <div className={styles.grid2}>
            <div className={ui.field}>
              <label className={ui.label} htmlFor="discord-client">
                Application client ID
              </label>
              <input
                id="discord-client"
                className={ui.input}
                value={form.discordClientId}
                onChange={(event) =>
                  update({ discordClientId: event.target.value })
                }
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <div className={ui.field}>
              <label className={ui.label} htmlFor="discord-image">
                Large image asset key
              </label>
              <input
                id="discord-image"
                className={ui.input}
                value={form.discordLargeImage}
                onChange={(event) =>
                  update({ discordLargeImage: event.target.value })
                }
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </div>

          <div className={styles.grid2}>
            <div className={ui.field}>
              <label className={ui.label} htmlFor="discord-details">
                Details template
              </label>
              <input
                id="discord-details"
                className={ui.input}
                value={form.discordDetails}
                onChange={(event) =>
                  update({ discordDetails: event.target.value })
                }
                spellCheck={false}
              />
            </div>
            <div className={ui.field}>
              <label className={ui.label} htmlFor="discord-state">
                State template
              </label>
              <input
                id="discord-state"
                className={ui.input}
                value={form.discordState}
                onChange={(event) =>
                  update({ discordState: event.target.value })
                }
                spellCheck={false}
              />
            </div>
          </div>

          <div className={styles.rowBetween}>
            <div>
              <div className={styles.rowLabel}>Show progress timeline</div>
              <div className={styles.rowHint}>
                Adds a live elapsed/remaining timeline to your presence.
              </div>
            </div>
            <Switch
              checked={form.discordTimestamps}
              onChange={(value) => update({ discordTimestamps: value })}
              label="Show progress timeline in Discord"
            />
          </div>

          <div className={styles.rowBetween}>
            <div>
              <div className={styles.rowLabel}>
                Use album art as the large image
              </div>
              <div className={styles.rowHint}>
                Fetches the track's cover from your HTTPS server. Falls back to
                the asset key when unavailable.
              </div>
            </div>
            <Switch
              checked={form.discordUseCover}
              onChange={(value) => update({ discordUseCover: value })}
              label="Use album art in Discord"
            />
          </div>

          <div className={styles.help}>
            Available template fields:
            <div className={styles.tokens}>
              {TOKENS.map((token) => (
                <span key={token} className={styles.token}>
                  {token}
                </span>
              ))}
            </div>
            <p style={{ marginTop: 8 }}>
              With album art enabled, hush passes the track's HTTPS cover URL to
              Discord. Otherwise it uses the static asset key. To set up the
              static asset, create a Discord application, upload an image under
              Rich Presence → Art Assets, and paste the client ID above.
            </p>
          </div>
        </div>
      </section>

      {/* Listen together */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.cardIcon}>
            <Handshake size={18} />
          </div>
          <div>
            <div className={styles.cardTitle}>Listen together</div>
            <div className={styles.cardDesc}>
              Self-host the hush-sync relay; everyone must use the same
              Navidrome server.
            </div>
          </div>
        </div>

        <div className={styles.grid2}>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="session-name">
              Display name
            </label>
            <input
              id="session-name"
              className={ui.input}
              value={form.sessionName}
              onChange={(event) => update({ sessionName: event.target.value })}
              placeholder={form.username || "Listener"}
              spellCheck={false}
            />
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="session-relay">
              Relay URL
            </label>
            <input
              id="session-relay"
              className={ui.input}
              value={form.sessionRelayUrl}
              onChange={(event) =>
                update({ sessionRelayUrl: event.target.value })
              }
              placeholder="ws://127.0.0.1:8787"
              spellCheck={false}
            />
          </div>
        </div>

        <p className={styles.help} style={{ marginTop: 14 }}>
          Run <code>hush-sync</code> (see <code>hush-sync/README.md</code>) and
          use <code>wss://</code> behind TLS for remote friends.
        </p>
      </section>

      {/* Appearance */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.cardIcon}>
            <Palette size={18} />
          </div>
          <div>
            <div className={styles.cardTitle}>Appearance</div>
            <div className={styles.cardDesc}>
              A flat accent colour drawn from the midnight palette.
            </div>
          </div>
        </div>
        <div className={styles.accentGrid}>
          {Object.entries(ACCENTS).map(([key, accent]) => (
            <button
              key={key}
              type="button"
              className={`${styles.accent} ${form.accent === key ? styles.accentActive : ""}`}
              onClick={() => update({ accent: key })}
              aria-pressed={form.accent === key}
            >
              <span
                className={styles.accentDot}
                style={{ background: accent.color }}
              />
              {accent.label}
            </button>
          ))}
        </div>
      </section>

      {/* Artist images */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.cardIcon}>
            <Users size={18} />
          </div>
          <div>
            <div className={styles.cardTitle}>Artist images</div>
            <div className={styles.cardDesc}>
              Show artist pictures in the library. Missing images are fetched
              from Deezer, with iTunes as a fallback.
            </div>
          </div>
        </div>

        <div className={styles.stack}>
          <div className={styles.rowBetween}>
            <div>
              <div className={styles.rowLabel}>Artwork source</div>
              <div className={styles.rowHint}>
                Off hides artist pictures, Server uses only images from your
                music server, Automatic also downloads missing ones.
              </div>
            </div>
            <div className={ui.segmented}>
              {(["off", "server", "auto"] as ArtistImageMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`${ui.segment} ${form.artistImages === mode ? ui.segmentActive : ""}`}
                  onClick={() => update({ artistImages: mode })}
                >
                  {mode === "off"
                    ? "Off"
                    : mode === "server"
                      ? "Server"
                      : "Automatic"}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.rowBetween}>
            <div>
              <div className={styles.rowLabel}>Cached images</div>
              <div className={styles.rowHint}>
                {artistCache
                  ? `${artistCache.count} ${
                      artistCache.count === 1 ? "image" : "images"
                    } · ${formatBytes(artistCache.bytes) ?? "0 B"}`
                  : "Checking cache…"}
              </div>
            </div>
            <button
              type="button"
              className={`${ui.button} ${ui.ghost}`}
              onClick={() => void handleClearArtistCache()}
              disabled={clearingCache || !artistCache?.count}
            >
              {clearingCache ? "Clearing…" : "Clear cache"}
            </button>
          </div>

          {cacheMessage ? (
            <div className={styles.help}>{cacheMessage}</div>
          ) : null}

          <p className={styles.help} style={{ marginTop: 2 }}>
            Automatic lookups send only the artist name to Deezer/iTunes.
            Downloaded pictures are cached locally and served to the app from
            the cache.
          </p>
        </div>
      </section>

      {/* Updates */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.cardIcon}>
            <RefreshCw size={18} />
          </div>
          <div>
            <div className={styles.cardTitle}>Updates</div>
            <div className={styles.cardDesc}>Keep hush up to date.</div>
          </div>
        </div>

        {updaterSupported ? (
          <div className={styles.rowBetween}>
            <div>
              <div className={styles.rowLabel}>Check automatically</div>
              <div className={styles.rowHint}>
                Look for a new release a few seconds after launch.
              </div>
            </div>
            <Switch
              checked={form.autoUpdate}
              onChange={(value) => update({ autoUpdate: value })}
              label="Check for updates automatically"
            />
          </div>
        ) : null}

        <div className={styles.rowBetween}>
          <div>
            <div className={styles.rowLabel}>
              Version {currentVersion ? currentVersion : "unknown"}
            </div>
            <div className={styles.rowHint}>
              {updaterSupported
                ? updateNote ||
                  "Automatic updates work with the Windows installer and the Linux AppImage."
                : "This build is updated manually from GitHub Releases."}
            </div>
          </div>
          <div className={styles.actions}>
            {updaterSupported && updaterStatus === "available" ? (
              <button
                type="button"
                className={`${ui.button} ${ui.primary}`}
                onClick={openUpdatePrompt}
              >
                View update
              </button>
            ) : null}
            {updaterSupported ? (
              <button
                type="button"
                className={`${ui.button} ${ui.ghost}`}
                onClick={() => void checkUpdates(true)}
                disabled={
                  updaterStatus === "checking" ||
                  updaterStatus === "downloading" ||
                  updaterStatus === "installing"
                }
              >
                {updaterStatus === "checking"
                  ? "Checking…"
                  : "Check for updates"}
              </button>
            ) : (
              <button
                type="button"
                className={`${ui.button} ${ui.ghost}`}
                onClick={() => void openReleases()}
              >
                Open releases
              </button>
            )}
          </div>
        </div>

        <p className={styles.help}>
          The Windows installer and the Linux AppImage update themselves. The{" "}
          <code>.deb</code> and portable <code>.zip</code> update manually from{" "}
          <button
            type="button"
            className={styles.inlineLink}
            onClick={() => void openReleases()}
          >
            GitHub Releases
          </button>
          .
        </p>
      </section>

      {/* About */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.cardIcon}>
            <Info size={18} />
          </div>
          <div>
            <div className={styles.cardTitle}>About hush</div>
            <div className={styles.cardDesc}>A calm, minimal music player.</div>
          </div>
        </div>
        <div className={styles.aboutList}>
          <p>
            Audio is decoded natively through GStreamer, so playback quality
            does not depend on the WebView. Supported formats: FLAC, MP3,
            AAC/M4A, Opus, Ogg Vorbis and WAV. ALAC is supported when the
            <code>gst-libav</code> package is installed.
          </p>
          <p>
            Server credentials are stored locally in hush's configuration
            directory. An API token is preferred over a password.
          </p>
          <p>
            On NVIDIA + Wayland systems where the window misbehaves, launch with
            <code>HUSH_SOFTWARE_RENDERING=1</code> to force WebKitGTK into a
            software-rendered path.
          </p>
          <p>
            Media keys and desktop controls are provided through MPRIS on Linux
            and System Media Transport Controls on Windows; the system tray
            offers quick playback controls everywhere.
          </p>
        </div>
      </section>
    </div>
  );
}
