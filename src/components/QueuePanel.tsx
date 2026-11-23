import { ListPlus, Pause, Play, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { DragEvent } from "react";

import { isExplicit } from "../lib/format";
import { api } from "../lib/ipc";
import { usePlayer } from "../store/player";
import { useToast } from "../store/toast";
import styles from "../styles/player.module.css";
import ui from "../styles/ui.module.css";
import { Artwork } from "./ui/Artwork";
import { PromptDialog } from "./ui/Dialog";
import { ExplicitBadge } from "./ui/ExplicitBadge";

export function QueuePanel() {
  const open = usePlayer((state) => state.queueOpen);
  const setOpen = usePlayer((state) => state.setQueueOpen);
  const queue = usePlayer((state) => state.queue);
  const currentIndex = usePlayer((state) => state.currentIndex);
  const track = usePlayer((state) => state.track);
  const status = usePlayer((state) => state.status);
  const playIndex = usePlayer((state) => state.playIndex);
  const removeFromQueue = usePlayer((state) => state.removeFromQueue);
  const moveInQueue = usePlayer((state) => state.moveInQueue);
  const clearQueue = usePlayer((state) => state.clearQueue);
  const toggle = usePlayer((state) => state.toggle);

  const toast = useToast((state) => state.show);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saveOpen) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, saveOpen, setOpen]);

  if (!open) return null;

  const playing = status === "playing";

  const handleDrop = (target: number) => {
    if (dragIndex != null && dragIndex !== target) {
      moveInQueue(dragIndex, target);
    }
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleSaveQueue = async (name: string) => {
    setSaving(true);
    try {
      await api.createPlaylist(
        name,
        queue.map((song) => song.id),
      );
      toast(`Saved “${name}”`);
      setSaveOpen(false);
    } catch (err) {
      usePlayer.getState().onError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <aside className={styles.queuePanel} aria-label="Play queue">
      <div className={styles.queueHead}>
        <div>
          <div className={styles.queueTitle}>Queue</div>
          <div className={styles.queueSub}>
            {queue.length} {queue.length === 1 ? "track" : "tracks"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            className={ui.iconBtn}
            onClick={() => setSaveOpen(true)}
            disabled={!queue.length}
            aria-label="Save queue as playlist"
            title="Save queue as playlist"
          >
            <ListPlus size={16} />
          </button>
          <button
            type="button"
            className={ui.iconBtn}
            onClick={() => clearQueue()}
            disabled={!queue.length}
            aria-label="Clear queue"
            title="Clear queue"
          >
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            className={ui.iconBtn}
            onClick={() => setOpen(false)}
            aria-label="Close queue"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {track ? (
        <div className={styles.queueNowPlaying}>
          <Artwork
            src={track.coverUrl}
            coverId={track.coverArt}
            size={120}
            rounded="sm"
            className={styles.queueNowArt}
          />
          <div className={styles.queueNowMain}>
            <div className={styles.queueTitleRow}>
              <span className={styles.queueItemTitle}>{track.title}</span>
              {isExplicit(track) ? <ExplicitBadge /> : null}
            </div>
            <div className={styles.queueItemArtist}>{track.artist ?? ""}</div>
          </div>
          <button
            type="button"
            className={ui.iconBtn}
            onClick={() => toggle()}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <Pause size={16} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={16} fill="currentColor" strokeWidth={0} />
            )}
          </button>
        </div>
      ) : null}

      <div className={styles.queueList}>
        {queue.length === 0 ? (
          <div className={styles.queueEmpty}>
            Your queue is empty.
            <br />
            Use “Play next” or “Add to queue” from any track.
          </div>
        ) : (
          queue.map((song, index) => {
            const active = index === currentIndex;
            return (
              <div
                key={`${song.id}-${index}`}
                className={[
                  styles.queueItem,
                  active ? styles.queueItemActive : "",
                  overIndex === index ? styles.queueItemDragOver : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                draggable
                onDragStart={(event: DragEvent<HTMLDivElement>) => {
                  event.dataTransfer.effectAllowed = "move";
                  setDragIndex(index);
                }}
                onDragOver={(event: DragEvent<HTMLDivElement>) => {
                  event.preventDefault();
                  setOverIndex(index);
                }}
                onDragLeave={() => setOverIndex(null)}
                onDrop={(event: DragEvent<HTMLDivElement>) => {
                  event.preventDefault();
                  handleDrop(index);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onClick={() => playIndex(index)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    playIndex(index);
                  }
                }}
              >
                <span className={styles.queueIndex}>
                  {active && playing ? "▶" : index + 1}
                </span>
                <Artwork
                  coverId={song.coverArt}
                  size={80}
                  rounded="sm"
                  className={styles.queueArt}
                  style={{ width: 38, height: 38, flexShrink: 0 }}
                />
                <span className={styles.queueMain}>
                  <span className={styles.queueTitleRow}>
                    <span className={styles.queueItemTitle}>{song.title}</span>
                    {isExplicit(song) ? <ExplicitBadge /> : null}
                  </span>
                  <span className={styles.queueItemArtist}>
                    {song.artist ?? ""}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.queueRemove}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeFromQueue(index);
                  }}
                  aria-label={`Remove ${song.title} from queue`}
                >
                  <X size={15} />
                </button>
              </div>
            );
          })
        )}
      </div>

      <PromptDialog
        open={saveOpen}
        title="Save queue as playlist"
        label="Playlist name"
        placeholder="Tonight's queue"
        confirmLabel="Save"
        busy={saving}
        onConfirm={(name) => void handleSaveQueue(name)}
        onCancel={() => setSaveOpen(false)}
      />
    </aside>
    </>
  );
}
