import {
  ChevronDown,
  ListMusic,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  formatBitrate,
  formatFormat,
  formatSampleRate,
  formatTime,
  isExplicit,
} from "../lib/format";
import type {
  FullscreenBackground,
  FullscreenBlur,
  FullscreenPanel,
  FullscreenVisualizer,
  Settings,
} from "../lib/types";
import { usePlayer } from "../store/player";
import { useSettings } from "../store/settings";
import fullscreen from "../styles/fullscreen.module.css";
import ui from "../styles/ui.module.css";
import { Artwork } from "./ui/Artwork";
import { ExplicitBadge } from "./ui/ExplicitBadge";
import { LyricsPanel } from "./ui/LyricsPanel";
import { Visualizer } from "./ui/Visualizer";
import { WaveformSeek } from "./ui/WaveformSeek";
import { WindowControls } from "./ui/WindowControls";

const PANELS: { key: FullscreenPanel; label: string }[] = [
  { key: "queue", label: "Queue" },
  { key: "lyrics", label: "Lyrics" },
  { key: "info", label: "Info" },
];

const BACKGROUNDS: { key: FullscreenBackground; label: string }[] = [
  { key: "art", label: "Cover" },
  { key: "visualizer", label: "Visualizer" },
  { key: "dim", label: "Dim" },
];

const VISUALIZERS: { key: FullscreenVisualizer; label: string }[] = [
  { key: "bars", label: "Bars" },
  { key: "wave", label: "Wave" },
];

const BLURS: { key: FullscreenBlur; label: string }[] = [
  { key: "low", label: "Low" },
  { key: "medium", label: "Medium" },
  { key: "high", label: "High" },
];

export function NowPlaying() {
  const open = usePlayer((state) => state.nowPlayingOpen);
  const setOpen = usePlayer((state) => state.setNowPlayingOpen);
  const toggleMini = usePlayer((state) => state.toggleMini);

  const track = usePlayer((state) => state.track);
  const status = usePlayer((state) => state.status);
  const position = usePlayer((state) => state.position);
  const duration = usePlayer((state) => state.duration);
  const shuffle = usePlayer((state) => state.shuffle);
  const repeat = usePlayer((state) => state.repeat);
  const replaygain = usePlayer((state) => state.replaygain);
  const gainApplied = usePlayer((state) => state.gainApplied);
  const queue = usePlayer((state) => state.queue);
  const currentIndex = usePlayer((state) => state.currentIndex);

  const toggle = usePlayer((state) => state.toggle);
  const next = usePlayer((state) => state.next);
  const prev = usePlayer((state) => state.prev);
  const seek = usePlayer((state) => state.seek);
  const setShuffle = usePlayer((state) => state.setShuffle);
  const cycleRepeat = usePlayer((state) => state.cycleRepeat);
  const playIndex = usePlayer((state) => state.playIndex);

  const settings = useSettings((state) => state.settings);
  const patchSettings = useSettings((state) => state.patch);

  const [preview, setPreview] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const background = settings?.fullscreenBackground ?? "art";
  const visualizer = settings?.fullscreenVisualizer ?? "bars";
  const blur = settings?.fullscreenBlur ?? "medium";
  const sidebarOpen = settings?.fullscreenSidebarOpen ?? true;
  const panel = settings?.fullscreenSidebarPanel ?? "queue";

  const update = (patch: Partial<Settings>) => {
    void patchSettings(patch).catch((err: unknown) =>
      usePlayer.getState().onError(String(err)),
    );
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      const current = useSettings.getState().settings;
      if (current?.fullscreenSidebarOpen) {
        update({ fullscreenSidebarOpen: false });
        return;
      }
      setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settingsOpen, setOpen]);

  const info = useMemo(() => {
    if (!track) return [] as { label: string; value: string }[];
    const rows: { label: string; value: string }[] = [
      { label: "Title", value: track.title || "—" },
    ];
    if (track.artist) rows.push({ label: "Artist", value: track.artist });
    if (track.album) rows.push({ label: "Album", value: track.album });
    if (track.albumArtist)
      rows.push({ label: "Album artist", value: track.albumArtist });
    if (track.format)
      rows.push({
        label: "Format",
        value: formatFormat(track.format) ?? track.format,
      });
    if (track.bitDepth)
      rows.push({ label: "Bit depth", value: `${track.bitDepth}-bit` });
    if (track.samplingRate)
      rows.push({
        label: "Sample rate",
        value: formatSampleRate(track.samplingRate) ?? "",
      });
    if (track.bitRate)
      rows.push({
        label: "Bitrate",
        value: formatBitrate(track.bitRate) ?? "",
      });
    if (track.channelCount)
      rows.push({
        label: "Channels",
        value:
          track.channelCount === 1
            ? "Mono"
            : track.channelCount === 2
              ? "Stereo"
              : `${track.channelCount} channels`,
      });
    rows.push({
      label: "ReplayGain",
      value:
        replaygain === "off"
          ? "Off"
          : gainApplied != null && Number.isFinite(gainApplied)
            ? `${replaygain === "album" ? "Album" : "Track"} · ${gainApplied > 0 ? "+" : ""}${gainApplied.toFixed(1)} dB`
            : replaygain === "album"
              ? "Album"
              : "Track",
    });
    if (track.server) rows.push({ label: "Server", value: track.server });
    if (track.duration)
      rows.push({ label: "Duration", value: formatTime(track.duration) });
    return rows;
  }, [track, replaygain, gainApplied]);

  if (!open) return null;

  const playing = status === "playing";
  const hasTrack = Boolean(track);
  const elapsed = preview ?? position;
  const total = duration || track?.duration || 0;
  const blurClass =
    blur === "low"
      ? fullscreen.blurLow
      : blur === "high"
        ? fullscreen.blurHigh
        : fullscreen.blurMedium;

  return (
    <section className={fullscreen.overlay} aria-label="Now playing">
      {background === "art" ? (
        <div className={fullscreen.backdrop} aria-hidden="true">
          <div className={`${fullscreen.backdropImage} ${blurClass}`}>
            <Artwork
              src={track?.coverUrl}
              coverId={track?.coverArt}
              size={1200}
              alt=""
            />
          </div>
          <div className={fullscreen.backdropScrim} />
        </div>
      ) : null}
      {background === "visualizer" ? (
        <div className={fullscreen.backdrop} aria-hidden="true">
          <Visualizer
            variant={visualizer}
            className={fullscreen.backdropVisualizer}
          />
          <div className={fullscreen.backdropScrim} />
        </div>
      ) : null}

      <div className={fullscreen.top} data-tauri-drag-region>
        <div className={fullscreen.topLabel} data-tauri-drag-region>
          Now Playing
        </div>
        <div className={fullscreen.topActions}>
          <button
            type="button"
            className={`${fullscreen.ctrlBtn} ${sidebarOpen ? fullscreen.ctrlActive : ""}`}
            onClick={() => update({ fullscreenSidebarOpen: !sidebarOpen })}
            aria-label="Toggle sidebar"
            aria-pressed={sidebarOpen}
          >
            <ListMusic size={17} />
          </button>

          <div className={fullscreen.popoverWrap}>
            <button
              type="button"
              className={`${fullscreen.ctrlBtn} ${settingsOpen ? fullscreen.ctrlActive : ""}`}
              onClick={() => setSettingsOpen((value) => !value)}
              aria-label="Fullscreen settings"
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
            >
              <SlidersHorizontal size={16} />
            </button>
            {settingsOpen ? (
              <div
                className={fullscreen.popover}
                role="dialog"
                aria-label="Fullscreen settings"
              >
                <div className={fullscreen.popoverRow}>
                  <div className={fullscreen.popoverLabel}>Background</div>
                  <div className={ui.segmented}>
                    {BACKGROUNDS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={`${ui.segment} ${background === item.key ? ui.segmentActive : ""}`}
                        onClick={() =>
                          update({ fullscreenBackground: item.key })
                        }
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {background === "visualizer" ? (
                  <div className={fullscreen.popoverRow}>
                    <div className={fullscreen.popoverLabel}>Visualizer</div>
                    <div className={ui.segmented}>
                      {VISUALIZERS.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          className={`${ui.segment} ${visualizer === item.key ? ui.segmentActive : ""}`}
                          onClick={() =>
                            update({ fullscreenVisualizer: item.key })
                          }
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {background === "art" ? (
                  <div className={fullscreen.popoverRow}>
                    <div className={fullscreen.popoverLabel}>Cover blur</div>
                    <div className={ui.segmented}>
                      {BLURS.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          className={`${ui.segment} ${blur === item.key ? ui.segmentActive : ""}`}
                          onClick={() => update({ fullscreenBlur: item.key })}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className={fullscreen.popoverRow}>
                  <div className={fullscreen.popoverLabel}>Sidebar</div>
                  <div className={ui.segmented}>
                    <button
                      type="button"
                      className={`${ui.segment} ${sidebarOpen ? ui.segmentActive : ""}`}
                      onClick={() => update({ fullscreenSidebarOpen: true })}
                    >
                      Shown
                    </button>
                    <button
                      type="button"
                      className={`${ui.segment} ${!sidebarOpen ? ui.segmentActive : ""}`}
                      onClick={() => update({ fullscreenSidebarOpen: false })}
                    >
                      Hidden
                    </button>
                  </div>
                </div>

                <div className={fullscreen.popoverHint}>
                  Escape closes the sidebar first, then this view.
                </div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className={fullscreen.ctrlBtn}
            onClick={() => void toggleMini()}
            aria-label="Mini player"
          >
            <PictureInPicture2 size={16} />
          </button>
          <button
            type="button"
            className={fullscreen.ctrlBtn}
            onClick={() => setOpen(false)}
            aria-label="Close now playing"
          >
            <ChevronDown size={20} />
          </button>
          <div className={fullscreen.winDivider} aria-hidden="true" />
          <WindowControls className={fullscreen.winControls} />
        </div>
      </div>

      <div className={fullscreen.body}>
        <div className={fullscreen.stage}>
          <div className={fullscreen.artWrap}>
            <Artwork
              src={track?.coverUrl}
              coverId={track?.coverArt}
              size={700}
              alt={track?.album ?? "Album art"}
              eager
            />
          </div>

          <div className={fullscreen.meta}>
            <div className={fullscreen.titleRow}>
              <span className={fullscreen.title}>
                {track?.title ?? "Nothing playing"}
              </span>
              {isExplicit(track) ? <ExplicitBadge /> : null}
            </div>
            <div className={fullscreen.artist}>{track?.artist ?? "—"}</div>
            <div className={fullscreen.album}>
              {[track?.album, track?.albumArtist].filter(Boolean).join(" · ")}
            </div>
          </div>

          <div className={fullscreen.controls}>
            <div className={fullscreen.controlRow}>
              <button
                type="button"
                className={`${fullscreen.ctrlBtn} ${shuffle ? fullscreen.ctrlActive : ""}`}
                onClick={() => setShuffle(!shuffle)}
                aria-label="Shuffle"
                aria-pressed={shuffle}
              >
                <Shuffle size={17} />
              </button>
              <button
                type="button"
                className={fullscreen.ctrlBtn}
                onClick={() => prev()}
                aria-label="Previous track"
                disabled={!hasTrack}
              >
                <SkipBack size={22} fill="currentColor" strokeWidth={0} />
              </button>
              <button
                type="button"
                className={fullscreen.playBtn}
                onClick={() => toggle()}
                aria-label={playing ? "Pause" : "Play"}
                disabled={!hasTrack}
              >
                {playing ? (
                  <Pause size={20} fill="currentColor" strokeWidth={0} />
                ) : (
                  <Play
                    size={20}
                    fill="currentColor"
                    strokeWidth={0}
                    style={{ marginLeft: 2 }}
                  />
                )}
              </button>
              <button
                type="button"
                className={fullscreen.ctrlBtn}
                onClick={() => next()}
                aria-label="Next track"
                disabled={!hasTrack}
              >
                <SkipForward size={22} fill="currentColor" strokeWidth={0} />
              </button>
              <button
                type="button"
                className={`${fullscreen.ctrlBtn} ${repeat !== "off" ? fullscreen.ctrlActive : ""}`}
                onClick={() => cycleRepeat()}
                aria-label="Repeat"
                aria-pressed={repeat !== "off"}
              >
                {repeat === "one" ? (
                  <Repeat1 size={17} />
                ) : (
                  <Repeat size={17} />
                )}
              </button>
            </div>

            <div className={fullscreen.progressRow}>
              <span className={fullscreen.time}>{formatTime(elapsed)}</span>
              <WaveformSeek
                className={fullscreen.seek}
                value={elapsed}
                max={total}
                height={52}
                disabled={!hasTrack || total <= 0}
                ariaLabel="Seek"
                onPreview={(value) => setPreview(value)}
                onCommit={(value) => {
                  setPreview(null);
                  seek(value);
                }}
              />
              <span className={fullscreen.time}>{formatTime(total)}</span>
            </div>
          </div>
        </div>

        {sidebarOpen ? (
          <aside className={fullscreen.sidebar} aria-label="Now playing details">
            <div className={fullscreen.sidebarHead}>
              <div className={fullscreen.tabs} role="tablist">
                {PANELS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={panel === item.key}
                    className={`${fullscreen.tab} ${panel === item.key ? fullscreen.tabActive : ""}`}
                    onClick={() =>
                      update({ fullscreenSidebarPanel: item.key })
                    }
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={fullscreen.ctrlBtn}
                onClick={() => update({ fullscreenSidebarOpen: false })}
                aria-label="Hide sidebar"
              >
                <X size={16} />
              </button>
            </div>

            {panel === "lyrics" ? (
              track ? (
                <div
                  className={`${fullscreen.sidebarBody} ${fullscreen.sidebarBodyLyrics}`}
                >
                  <LyricsPanel trackId={track.id} />
                </div>
              ) : (
                <div className={fullscreen.sidebarBody}>
                  <div className={fullscreen.queueEmpty}>
                    Nothing playing.
                  </div>
                </div>
              )
            ) : panel === "info" ? (
              <div className={fullscreen.sidebarBody}>
                {info.length ? (
                  <div className={fullscreen.infoGrid}>
                    {info.map((row) => (
                      <div key={row.label} className={fullscreen.infoItem}>
                        <div className={fullscreen.infoLabel}>{row.label}</div>
                        <div className={fullscreen.infoValue}>{row.value}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={fullscreen.queueEmpty}>
                    Nothing playing.
                  </div>
                )}
              </div>
            ) : (
              <div className={fullscreen.sidebarBody}>
                {queue.length ? (
                  <div className={fullscreen.queueList}>
                    {queue.map((song, index) => {
                      const active = index === currentIndex;
                      return (
                        <button
                          key={`${song.id}-${index}`}
                          type="button"
                          className={`${fullscreen.queueItem} ${
                            active ? fullscreen.queueItemActive : ""
                          }`}
                          onClick={() => playIndex(index)}
                        >
                          <span className={fullscreen.queueIndex}>
                            {index + 1}
                          </span>
                          <span className={fullscreen.queueArt}>
                            <Artwork
                              coverId={song.coverArt}
                              size={80}
                              rounded="sm"
                              style={{ width: 36, height: 36 }}
                            />
                          </span>
                          <span className={fullscreen.queueMain}>
                            <span className={fullscreen.queueTitleRow}>
                              <span className={fullscreen.queueTitleText}>
                                {song.title}
                              </span>
                              {isExplicit(song) ? <ExplicitBadge /> : null}
                            </span>
                            <span className={fullscreen.queueArtistText}>
                              {song.artist ?? ""}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className={fullscreen.queueEmpty}>
                    Your queue is empty.
                    <br />
                    Use “Play next” or “Add to queue” from any track.
                  </div>
                )}
              </div>
            )}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
