import {
  ListMusic,
  Maximize2,
  Moon,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  formatBitrate,
  formatFormat,
  formatSampleRate,
  formatTime,
} from "../lib/format";
import type { TrackInfo } from "../lib/types";
import { usePlayer } from "../store/player";
import styles from "../styles/player.module.css";
import ui from "../styles/ui.module.css";
import { Artwork } from "./ui/Artwork";
import { VolumeControl } from "./ui/VolumeControl";
import { WaveformSeek } from "./ui/WaveformSeek";

const SLEEP_MINUTES = [15, 30, 45, 60, 90];

export function PlayerBar() {
  const track = usePlayer((state) => state.track);
  const status = usePlayer((state) => state.status);
  const shuffle = usePlayer((state) => state.shuffle);
  const repeat = usePlayer((state) => state.repeat);
  const replaygain = usePlayer((state) => state.replaygain);
  const gainApplied = usePlayer((state) => state.gainApplied);
  const toggle = usePlayer((state) => state.toggle);
  const next = usePlayer((state) => state.next);
  const prev = usePlayer((state) => state.prev);
  const setShuffle = usePlayer((state) => state.setShuffle);
  const cycleRepeat = usePlayer((state) => state.cycleRepeat);
  const nowPlayingOpen = usePlayer((state) => state.nowPlayingOpen);
  const setNowPlayingOpen = usePlayer((state) => state.setNowPlayingOpen);
  const queueOpen = usePlayer((state) => state.queueOpen);
  const setQueueOpen = usePlayer((state) => state.setQueueOpen);
  const miniOpen = usePlayer((state) => state.miniOpen);
  const toggleMini = usePlayer((state) => state.toggleMini);
  const sleepTimerEndsAt = usePlayer((state) => state.sleepTimerEndsAt);
  const sleepTimerMinutes = usePlayer((state) => state.sleepTimerMinutes);
  const sleepMode = usePlayer((state) => state.sleepMode);
  const setSleepTimer = usePlayer((state) => state.setSleepTimer);
  const setSleepMode = usePlayer((state) => state.setSleepMode);

  const [sleepOpen, setSleepOpen] = useState(false);
  const sleepRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sleepOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (sleepRef.current && !sleepRef.current.contains(event.target as Node)) {
        setSleepOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown, true);
    return () => window.removeEventListener("mousedown", onPointerDown, true);
  }, [sleepOpen]);

  const sleepActive = sleepMode != null;
  const sleepRemaining =
    sleepTimerEndsAt != null
      ? Math.max(0, Math.ceil((sleepTimerEndsAt - Date.now()) / 60000))
      : 0;
  const sleepTitle =
    sleepMode === "endOfTrack"
      ? "Sleep timer: end of this track"
      : sleepMode === "endOfQueue"
        ? "Sleep timer: end of queue"
        : sleepActive
          ? `Sleep timer: ${sleepRemaining} min left`
          : "Sleep timer";

  const quality = useMemo(() => {
    if (!track) return null;
    const parts = [
      formatFormat(track.format),
      track.bitDepth ? `${track.bitDepth}-bit` : null,
      formatSampleRate(track.samplingRate),
      formatBitrate(track.bitRate),
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }, [track]);

  const playing = status === "playing";
  const hasTrack = Boolean(track);

  const rgLabel =
    replaygain === "off"
      ? null
      : gainApplied != null && Number.isFinite(gainApplied)
        ? `RG ${replaygain} · ${gainApplied > 0 ? "+" : ""}${gainApplied.toFixed(1)} dB`
        : `RG ${replaygain}`;

  return (
    <footer className={styles.bar}>
      <div className={styles.left}>
        <button
          type="button"
          className={styles.artWrap}
          onClick={() => hasTrack && setNowPlayingOpen(true)}
          aria-label="Open now playing"
          disabled={!hasTrack}
        >
          <Artwork
            src={track?.coverUrl}
            coverId={track?.coverArt}
            size={120}
            alt={track?.album ?? ""}
          />
        </button>
        <div className={styles.meta}>
          {track?.albumId ? (
            <Link
              to={`/albums/${track.albumId}`}
              className={`${styles.title} ${styles.metaLink}`}
              title={track.title}
              onClick={() => queueOpen && setQueueOpen(false)}
            >
              {track.title}
            </Link>
          ) : (
            <span className={styles.title}>
              {track?.title ?? "Nothing playing"}
            </span>
          )}
          {track?.artistId && track.artist ? (
            <Link
              to={`/artists/${track.artistId}`}
              className={`${styles.artist} ${styles.metaLink}`}
              title={track.artist}
              onClick={() => queueOpen && setQueueOpen(false)}
            >
              {track.artist}
            </Link>
          ) : (
            <span className={styles.artist}>
              {track?.artist ?? "Pick something from your library"}
            </span>
          )}
          {(quality || rgLabel) && (
            <span className={styles.metaBadges}>
              {quality ? (
                <span className={ui.badge}>{quality}</span>
              ) : null}
              {rgLabel ? (
                <span className={`${ui.badge} ${ui.badgeAccent}`}>{rgLabel}</span>
              ) : null}
            </span>
          )}
        </div>
      </div>

      <div className={styles.center}>
        <div className={styles.controls}>
          <button
            type="button"
            className={`${styles.ctrlBtn} ${shuffle ? styles.ctrlActive : ""}`}
            onClick={() => setShuffle(!shuffle)}
            aria-label="Shuffle"
            aria-pressed={shuffle}
          >
            <Shuffle size={16} />
          </button>
          <button
            type="button"
            className={styles.ctrlBtn}
            onClick={() => prev()}
            aria-label="Previous track"
            disabled={!hasTrack}
          >
            <SkipBack size={18} fill="currentColor" strokeWidth={0} />
          </button>
          <button
            type="button"
            className={styles.playBtn}
            onClick={() => toggle()}
            aria-label={playing ? "Pause" : "Play"}
            disabled={!hasTrack}
          >
            {playing ? (
              <Pause size={18} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play
                size={18}
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
            <SkipForward size={18} fill="currentColor" strokeWidth={0} />
          </button>
          <button
            type="button"
            className={`${styles.ctrlBtn} ${repeat !== "off" ? styles.ctrlActive : ""}`}
            onClick={() => cycleRepeat()}
            aria-label={
              repeat === "one"
                ? "Repeat one"
                : repeat === "all"
                  ? "Repeat all"
                  : "Repeat off"
            }
            aria-pressed={repeat !== "off"}
          >
            {repeat === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
          </button>
        </div>

        <PlayerProgress track={track} hasTrack={hasTrack} />
      </div>

      <div className={styles.right}>
        <div className={styles.popoverWrap} ref={sleepRef}>
          <button
            type="button"
            className={`${styles.ctrlBtn} ${sleepActive ? styles.sleepActive : ""}`}
            onClick={() => setSleepOpen((open) => !open)}
            aria-label="Sleep timer"
            aria-haspopup="menu"
            aria-expanded={sleepOpen}
            title={sleepTitle}
          >
            <Moon size={16} />
          </button>
          {sleepOpen ? (
            <div className={styles.popover} role="menu">
              <div className={styles.popoverLabel}>Sleep timer</div>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={sleepMode == null}
                className={`${styles.popoverItem} ${sleepMode == null ? styles.popoverItemActive : ""}`}
                onClick={() => {
                  setSleepMode(null);
                  setSleepOpen(false);
                }}
              >
                <span>Off</span>
              </button>
              {SLEEP_MINUTES.map((minutes) => {
                const selected =
                  sleepMode === "minutes" && sleepTimerMinutes === minutes;
                return (
                  <button
                    key={minutes}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={`${styles.popoverItem} ${selected ? styles.popoverItemActive : ""}`}
                    onClick={() => {
                      setSleepTimer(minutes);
                      setSleepOpen(false);
                    }}
                  >
                    <span>{minutes} minutes</span>
                    {selected ? (
                      <span className={styles.popoverHint}>
                        {sleepRemaining} min
                      </span>
                    ) : null}
                  </button>
                );
              })}
              <div className={styles.popoverLabel}>Or at the end</div>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={sleepMode === "endOfTrack"}
                className={`${styles.popoverItem} ${sleepMode === "endOfTrack" ? styles.popoverItemActive : ""}`}
                onClick={() => {
                  setSleepMode("endOfTrack");
                  setSleepOpen(false);
                }}
              >
                <span>End of this track</span>
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={sleepMode === "endOfQueue"}
                className={`${styles.popoverItem} ${sleepMode === "endOfQueue" ? styles.popoverItemActive : ""}`}
                onClick={() => {
                  setSleepMode("endOfQueue");
                  setSleepOpen(false);
                }}
              >
                <span>End of queue</span>
              </button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className={`${styles.ctrlBtn} ${queueOpen ? styles.queueActive : ""}`}
          onClick={() => setQueueOpen(!queueOpen)}
          aria-label="Queue"
          aria-pressed={queueOpen}
        >
          <ListMusic size={17} />
        </button>

        <VolumeControl
          className={styles.volumeWrap}
          sliderClassName={styles.volumeSlider}
          buttonClassName={styles.ctrlBtn}
        />

        <button
          type="button"
          className={`${styles.ctrlBtn} ${nowPlayingOpen ? styles.queueActive : ""}`}
          onClick={() => setNowPlayingOpen(!nowPlayingOpen)}
          aria-label="Now playing"
          aria-pressed={nowPlayingOpen}
        >
          <Maximize2 size={16} />
        </button>

        <button
          type="button"
          className={`${styles.ctrlBtn} ${miniOpen ? styles.queueActive : ""}`}
          onClick={() => void toggleMini()}
          aria-label="Mini player"
          aria-pressed={miniOpen}
        >
          <PictureInPicture2 size={16} />
        </button>
      </div>
    </footer>
  );
}

/** Progress row isolated from the rest of the player bar so position/duration
 * ticks only re-render this small subtree (~5×/s), not the whole bar. */
function PlayerProgress({
  track,
  hasTrack,
}: {
  track: TrackInfo | null;
  hasTrack: boolean;
}) {
  const position = usePlayer((state) => state.position);
  const duration = usePlayer((state) => state.duration);
  const seek = usePlayer((state) => state.seek);
  const [preview, setPreview] = useState<number | null>(null);

  const elapsed = preview ?? position;
  const total = duration || track?.duration || 0;

  return (
    <div className={styles.progressRow}>
      <span className={styles.time}>{formatTime(elapsed)}</span>
      <WaveformSeek
        className={styles.seek}
        value={elapsed}
        max={total}
        height={36}
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
  );
}
