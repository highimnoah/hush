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
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  formatBitrate,
  formatFormat,
  formatSampleRate,
  formatTime,
} from "../lib/format";
import { usePlayer } from "../store/player";
import styles from "../styles/player.module.css";
import { Artwork } from "./ui/Artwork";
import { WaveformSeek } from "./ui/WaveformSeek";

export function NowPlaying() {
  const open = usePlayer((state) => state.nowPlayingOpen);
  const setOpen = usePlayer((state) => state.setNowPlayingOpen);
  const queueOpen = usePlayer((state) => state.queueOpen);
  const setQueueOpen = usePlayer((state) => state.setQueueOpen);
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

  const [preview, setPreview] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

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
  const upNext = queue.slice(currentIndex + 1, currentIndex + 7);

  return (
    <section className={styles.npOverlay} aria-label="Now playing">
      <div className={styles.npTop}>
        <div className={styles.npTopLabel}>
          <span>Now Playing</span>
        </div>
        <div className={styles.npTopActions}>
          <button
            type="button"
            className={`${styles.ctrlBtn} ${queueOpen ? styles.queueActive : ""}`}
            onClick={() => setQueueOpen(!queueOpen)}
            aria-label="Queue"
          >
            <ListMusic size={17} />
          </button>
          <button
            type="button"
            className={styles.ctrlBtn}
            onClick={() => void toggleMini()}
            aria-label="Mini player"
          >
            <PictureInPicture2 size={16} />
          </button>
          <button
            type="button"
            className={styles.ctrlBtn}
            onClick={() => setOpen(false)}
            aria-label="Close now playing"
          >
            <ChevronDown size={20} />
          </button>
        </div>
      </div>

      <div className={styles.npBody}>
        <div className={styles.npLeft}>
          <div className={styles.npArt}>
            <Artwork
              src={track?.coverUrl}
              coverId={track?.coverArt}
              size={700}
              alt={track?.album ?? "Album art"}
              eager
            />
          </div>

          <div className={styles.npMeta}>
            <div className={styles.npTitle}>{track?.title ?? "Nothing playing"}</div>
            <div className={styles.npArtist}>{track?.artist ?? "—"}</div>
            <div className={styles.npAlbum}>
              {[track?.album, track?.albumArtist].filter(Boolean).join(" · ")}
            </div>
          </div>

          <div className={styles.npControls}>
            <div className={styles.npControlRow}>
              <button
                type="button"
                className={`${styles.ctrlBtn} ${shuffle ? styles.ctrlActive : ""}`}
                onClick={() => setShuffle(!shuffle)}
                aria-label="Shuffle"
                aria-pressed={shuffle}
              >
                <Shuffle size={17} />
              </button>
              <button
                type="button"
                className={styles.ctrlBtn}
                onClick={() => prev()}
                aria-label="Previous track"
                disabled={!hasTrack}
              >
                <SkipBack size={22} fill="currentColor" strokeWidth={0} />
              </button>
              <button
                type="button"
                className={styles.playBtn}
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
                className={styles.ctrlBtn}
                onClick={() => next()}
                aria-label="Next track"
                disabled={!hasTrack}
              >
                <SkipForward size={22} fill="currentColor" strokeWidth={0} />
              </button>
              <button
                type="button"
                className={`${styles.ctrlBtn} ${repeat !== "off" ? styles.ctrlActive : ""}`}
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

            <div className={styles.progressRow}>
              <span className={styles.time}>{formatTime(elapsed)}</span>
              <WaveformSeek
                className={styles.seek}
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
              <span className={styles.time}>{formatTime(total)}</span>
            </div>
          </div>
        </div>

        <div className={styles.npRight}>
          <div className={styles.npSection}>
            <div className={styles.npSectionHead}>
              <span className={styles.npSectionTitle}>Track information</span>
            </div>
            <div className={styles.infoGrid}>
              {info.map((row) => (
                <div key={row.label} className={styles.infoItem}>
                  <div className={styles.infoLabel}>{row.label}</div>
                  <div className={styles.infoValue}>{row.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.npSection}>
            <div className={styles.npSectionHead}>
              <span className={styles.npSectionTitle}>Up next</span>
              <button
                type="button"
                className={styles.ctrlBtn}
                onClick={() => setQueueOpen(true)}
                aria-label="Open full queue"
              >
                <ListMusic size={16} />
              </button>
            </div>
            {upNext.length ? (
              <div className={styles.upNextList}>
                {upNext.map((song, offset) => {
                  const index = currentIndex + 1 + offset;
                  return (
                    <button
                      type="button"
                      key={`${song.id}-${index}`}
                      className={styles.upNextRow}
                      onClick={() => playIndex(index)}
                    >
                      <Artwork
                        coverId={song.coverArt}
                        size={80}
                        rounded="sm"
                        className={styles.upNextArt}
                        style={{ width: 34, height: 34, flexShrink: 0 }}
                      />
                      <span className={styles.upNextMain}>
                        <span className={styles.upNextTitle}>{song.title}</span>
                        <span className={styles.upNextArtist}>
                          {song.artist ?? ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className={styles.upNextEmpty}>Nothing queued after this.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
