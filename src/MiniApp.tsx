import { ChevronUp, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Artwork } from "./components/ui/Artwork";
import { Slider } from "./components/ui/Slider";
import { formatTime } from "./lib/format";
import { api, subscribePlayerEvents } from "./lib/ipc";
import type { PlaybackStatus, TrackInfo } from "./lib/types";
import styles from "./styles/mini.module.css";

export default function MiniApp() {
  const [track, setTrack] = useState<TrackInfo | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>("stopped");
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let alive = true;

    api
      .getPlayerState()
      .then((snapshot) => {
        if (!alive) return;
        setStatus(snapshot.status);
        setPosition(snapshot.position);
        setDuration(snapshot.duration);
        if (snapshot.track) setTrack(snapshot.track);
      })
      .catch(() => {});

    api
      .getCurrentTrack()
      .then((current) => {
        if (alive && current) setTrack(current);
      })
      .catch(() => {});

    const unsubscribe = subscribePlayerEvents({
      state: (snapshot) => {
        setStatus(snapshot.status);
        setPosition(snapshot.position);
        setDuration(snapshot.duration || snapshot.track?.duration || 0);
        if (snapshot.track) setTrack(snapshot.track);
      },
      position: (event) => {
        setPosition(event.position);
        if (event.duration > 0) setDuration(event.duration);
      },
      track: (next) => {
        if (next) setTrack(next);
      },
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const playing = status === "playing";
  const total = duration || track?.duration || 0;

  const toggle = () => void api.emitUiCommand("playPause");
  const next = () => void api.emitUiCommand("next");
  const previous = () => void api.emitUiCommand("previous");
  const close = () => void api.toggleMiniPlayer(false);
  const expand = () => {
    void api.showMain();
    void api.toggleMiniPlayer(false);
  };

  return (
    <div className={styles.mini}>
      <div className={styles.top}>
        <div className={styles.dragZone} data-tauri-drag-region>
          <div className={styles.art}>
            <Artwork
              src={track?.coverUrl}
              coverId={track?.coverArt}
              size={100}
              rounded="sm"
              alt={track?.album ?? ""}
            />
          </div>
          <div className={styles.meta} data-tauri-drag-region>
            <div className={styles.title} data-tauri-drag-region>
              {track?.title ?? "Nothing playing"}
            </div>
            <div className={styles.artist} data-tauri-drag-region>
              {track?.artist ?? "hush"}
            </div>
          </div>
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.ctrl}
            onClick={previous}
            aria-label="Previous track"
          >
            <SkipBack size={15} fill="currentColor" strokeWidth={0} />
          </button>
          <button
            type="button"
            className={styles.playBtn}
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <Pause size={15} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play
                size={15}
                fill="currentColor"
                strokeWidth={0}
                style={{ marginLeft: 1 }}
              />
            )}
          </button>
          <button
            type="button"
            className={styles.ctrl}
            onClick={next}
            aria-label="Next track"
          >
            <SkipForward size={15} fill="currentColor" strokeWidth={0} />
          </button>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={expand}
            aria-label="Open full player"
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={close}
            aria-label="Close mini player"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className={styles.progressRow}>
        <span className={styles.time}>{formatTime(position)}</span>
        <Slider
          className={styles.seek}
          value={position}
          max={total}
          step={0.5}
          live={false}
          disabled={total <= 0}
          ariaLabel="Seek"
          onCommit={(value) => void api.playerSeek(value)}
        />
        <span className={styles.time}>{formatTime(total)}</span>
      </div>
    </div>
  );
}
