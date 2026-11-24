import { open, save } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowLeft,
  Check,
  Download,
  Info,
  Music2,
  Pause,
  Play,
  Plus,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ConfirmDialog } from "../components/ui/Dialog";
import { WaveformSeek } from "../components/ui/WaveformSeek";
import { formatTime } from "../lib/format";
import { api } from "../lib/ipc";
import {
  countUntimed,
  formatLrcTime,
  isOutOfOrder,
  lyricsMeta,
  lyricsToLrcLines,
  notifyLyricsChanged,
  orderLrcLines,
  parseLrcTime,
} from "../lib/lyrics";
import type {
  LrcLine,
  LrcMeta,
  LyricsSource,
  Song,
} from "../lib/types";
import { usePlayer } from "../store/player";
import { useToast } from "../store/toast";
import styles from "../styles/lyrics.module.css";
import ui from "../styles/ui.module.css";

type EditableLine = LrcLine & { id: string };

let lineSequence = 0;

function editableId(): string {
  lineSequence += 1;
  return `line-${lineSequence}`;
}

function toEditable(lines: LrcLine[]): EditableLine[] {
  return lines.map((line) => ({
    id: editableId(),
    startMs: line.startMs,
    text: line.text,
  }));
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "lyrics";
}

function TimeField({
  value,
  disabled,
  onCommit,
}: {
  value: number | null;
  disabled?: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? "" : formatLrcTime(value));
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value == null ? "" : formatLrcTime(value));
  }, [value, editing]);

  const reset = () => {
    setEditing(false);
    setDraft(value == null ? "" : formatLrcTime(value));
  };

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      reset();
      return;
    }
    if (!draft.trim()) {
      onCommit(null);
      setEditing(false);
      return;
    }
    const parsed = parseLrcTime(draft);
    if (parsed == null) {
      reset();
      return;
    }
    onCommit(parsed);
    setEditing(false);
    setDraft(formatLrcTime(parsed));
  };

  return (
    <input
      className={styles.timeInput}
      value={draft}
      placeholder="--:--.--"
      spellCheck={false}
      disabled={disabled}
      onFocus={(event) => {
        setEditing(true);
        event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
      aria-label="Line timestamp"
    />
  );
}

export function LyricsEditorView() {
  const { trackId = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast((state) => state.show);

  const [song, setSong] = useState<Song | null>(null);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [baseMeta, setBaseMeta] = useState<LrcMeta | null>(null);
  const [source, setSource] = useState<LyricsSource>("none");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [undoCount, setUndoCount] = useState(0);

  const undoStack = useRef<EditableLine[][]>([]);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const currentTrack = usePlayer((state) => state.track);
  const playerStatus = usePlayer((state) => state.status);
  const playerPosition = usePlayer((state) => state.position);
  const playerDuration = usePlayer((state) => state.duration);
  const playSongs = usePlayer((state) => state.playSongs);
  const toggle = usePlayer((state) => state.toggle);
  const seek = usePlayer((state) => state.seek);
  const pause = usePlayer((state) => state.pause);

  const isCurrent = currentTrack?.id === trackId;
  const duration =
    isCurrent && playerDuration > 0 ? playerDuration : song?.duration ?? 0;
  const position = isCurrent ? playerPosition : 0;
  const playing = isCurrent && playerStatus === "playing";

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setDirty(false);
      setLines([]);
      setSong((current) => (current?.id === trackId ? current : null));
      undoStack.current = [];
      setUndoCount(0);

      const [songResult, local] = await Promise.all([
        api.getSong(trackId).catch(() => null),
        api.getLocalLyrics(trackId).catch(() => null),
      ]);

      if (cancelled) return;

      if (songResult) setSong(songResult);

      if (local) {
        setLines(toEditable(local.lines));
        setBaseMeta(local.meta);
        setSource("local");
      } else {
        let serverLyrics = null;
        try {
          serverLyrics = await api.getLyrics(
            trackId,
            songResult ? lyricsMeta(songResult) : undefined,
          );
        } catch {
          serverLyrics = null;
        }
        if (cancelled) return;

        const hasContent =
          Boolean(serverLyrics?.synced?.length) || Boolean(serverLyrics?.plain);
        setLines(toEditable(lyricsToLrcLines(serverLyrics)));
        setBaseMeta({
          title: serverLyrics?.title ?? songResult?.title ?? null,
          artist: serverLyrics?.artist ?? songResult?.artist ?? null,
          album: serverLyrics?.album ?? songResult?.album ?? null,
          durationMs: songResult?.duration
            ? Math.round(songResult.duration * 1000)
            : null,
        });
        setSource(hasContent ? serverLyrics?.source ?? "server" : "none");
        if (!songResult && !hasContent) {
          setError("Could not load this track. The server may be unreachable.");
        }
      }

      setSelectedId(null);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [trackId, reloadKey]);

  const timedLines = useMemo(
    () => lines.filter((line) => line.startMs != null),
    [lines],
  );
  const untimedCount = countUntimed(lines);
  const outOfOrder = useMemo(() => isOutOfOrder(lines), [lines]);
  const duplicates = useMemo(() => {
    const seen = new Set<number>();
    let count = 0;
    for (const line of lines) {
      if (line.startMs == null) continue;
      if (seen.has(line.startMs)) count += 1;
      seen.add(line.startMs);
    }
    return count;
  }, [lines]);

  const pushUndo = useCallback(() => {
    undoStack.current.push(
      linesRef.current.map((line) => ({ ...line })),
    );
    if (undoStack.current.length > 80) undoStack.current.shift();
    setUndoCount(undoStack.current.length);
  }, []);

  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    setLines(previous);
    setUndoCount(undoStack.current.length);
    setDirty(true);
  }, []);

  const updateLine = useCallback(
    (id: string, patch: Partial<LrcLine>) => {
      setLines((current) =>
        current.map((line) => (line.id === id ? { ...line, ...patch } : line)),
      );
      setDirty(true);
    },
    [],
  );

  const setLineTime = useCallback(
    (id: string, startMs: number | null) => {
      const current = linesRef.current.find((line) => line.id === id);
      if (!current || current.startMs === startMs) return;
      pushUndo();
      updateLine(id, { startMs });
    },
    [pushUndo, updateLine],
  );

  const applyTap = useCallback(
    async (lineId: string) => {
      if (!isCurrent) {
        if (song) {
          playSongs([song], 0);
          toast("Loading the track — tap again once it plays.");
        } else {
          toast("Play this track before syncing.");
        }
        return;
      }

      const seconds = await api.playerPositionNow();
      const startMs = Math.max(0, Math.round(seconds * 1000));
      const current = linesRef.current;
      const index = current.findIndex((line) => line.id === lineId);
      pushUndo();
      setLines((value) =>
        value.map((line) =>
          line.id === lineId ? { ...line, startMs } : line,
        ),
      );
      setDirty(true);

      const next = current[index + 1];
      setSelectedId(next?.id ?? lineId);
    },
    [isCurrent, song, playSongs, toast, pushUndo],
  );

  const tapNext = useCallback(() => {
    const current = linesRef.current;
    const target =
      current.find((line) => line.id === selectedId) ??
      current.find((line) => line.startMs == null) ??
      current[0];
    if (!target) {
      toast("Add a line first.");
      return;
    }
    void applyTap(target.id);
  }, [selectedId, applyTap, toast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
      if (event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        Boolean(target?.isContentEditable)
      ) {
        return;
      }

      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        tapNext();
        return;
      }

      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const current = linesRef.current;
        if (!current.length) return;
        event.preventDefault();
        const index = current.findIndex((line) => line.id === selectedId);
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = Math.min(
          current.length - 1,
          Math.max(0, (index === -1 ? 0 : index) + delta),
        );
        setSelectedId(current[nextIndex]?.id ?? null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tapNext, undo, selectedId]);

  const addLine = useCallback(() => {
    pushUndo();
    const line: EditableLine = { id: editableId(), startMs: null, text: "" };
    setLines((current) => {
      const index = current.findIndex((item) => item.id === selectedId);
      if (index === -1) return [...current, line];
      const next = [...current];
      next.splice(index + 1, 0, line);
      return next;
    });
    setSelectedId(line.id);
    setDirty(true);
  }, [pushUndo, selectedId]);

  const deleteLine = useCallback(
    (id: string) => {
      pushUndo();
      setLines((current) => current.filter((line) => line.id !== id));
      setDirty(true);
      setSelectedId((current) => (current === id ? null : current));
    },
    [pushUndo],
  );

  const nudge = useCallback(
    (delta: number, scope: "line" | "all") => {
      if (scope === "line" && !selectedId) return;
      pushUndo();
      setLines((current) =>
        current.map((line) => {
          if (line.startMs == null) return line;
          if (scope === "line" && line.id !== selectedId) return line;
          return { ...line, startMs: Math.max(0, line.startMs + delta) };
        }),
      );
      setDirty(true);
    },
    [pushUndo, selectedId],
  );

  const distribute = useCallback(() => {
    const current = linesRef.current;
    if (current.length < 2) {
      toast("Add at least two lines to distribute timings.");
      return;
    }
    const total =
      duration > 0
        ? Math.max(1000, duration * 1000 - 800)
        : (current.length - 1) * 4000;
    pushUndo();
    setLines((value) =>
      value.map((line, index) => ({
        ...line,
        startMs: Math.round((index / (value.length - 1)) * total),
      })),
    );
    setDirty(true);
  }, [duration, pushUndo, toast]);

  const sortLines = useCallback(() => {
    const ordered = orderLrcLines(linesRef.current);
    const alreadySorted = ordered.every(
      (line, index) => line.id === linesRef.current[index]?.id,
    );
    if (alreadySorted) return;
    pushUndo();
    setLines(ordered);
    setDirty(true);
  }, [pushUndo]);

  const saveLyrics = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      const ordered = orderLrcLines(
        linesRef.current.map((line) => ({
          startMs: line.startMs,
          text: line.text,
        })),
      );
      const meta: LrcMeta = {
        title: song?.title ?? baseMeta?.title ?? null,
        artist: song?.artist ?? baseMeta?.artist ?? null,
        album: song?.album ?? baseMeta?.album ?? null,
        durationMs:
          duration > 0
            ? Math.round(duration * 1000)
            : baseMeta?.durationMs ?? null,
      };
      const saved = await api.saveLocalLyrics(trackId, ordered, meta);
      setLines(toEditable(saved.lines));
      setBaseMeta(saved.meta);
      setSource("local");
      setDirty(false);
      setSelectedId(null);
      setUndoCount(0);
      undoStack.current = [];
      notifyLyricsChanged(trackId);
      toast("Lyrics saved.");
      return true;
    } catch (err) {
      usePlayer.getState().onError(String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, [trackId, song, baseMeta, duration, toast]);

  const handleImport = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          { name: "Lyrics", extensions: ["lrc", "txt"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;
      const imported = await api.importLyricsFile(path);
      pushUndo();
      setLines(toEditable(imported.lines));
      if (imported.meta.title || imported.meta.artist) {
        setBaseMeta((current) => ({
          title: imported.meta.title ?? current?.title ?? null,
          artist: imported.meta.artist ?? current?.artist ?? null,
          album: imported.meta.album ?? current?.album ?? null,
          durationMs: imported.meta.durationMs ?? current?.durationMs ?? null,
        }));
      }
      setDirty(true);
      setSelectedId(null);
      toast(
        imported.lines.length
          ? `Imported ${imported.lines.length} lines.`
          : "Imported a file with no lyric lines.",
      );
    } catch (err) {
      usePlayer.getState().onError(String(err));
    }
  }, [pushUndo, toast]);

  const handleExport = useCallback(async () => {
    try {
      if (dirty || source !== "local") {
        const saved = await saveLyrics();
        if (!saved) return;
      }
      const baseName = sanitizeFileName(
        [song?.artist, song?.title].filter(Boolean).join(" - ") ||
          song?.title ||
          "lyrics",
      );
      const path = await save({
        defaultPath: `${baseName}.lrc`,
        filters: [{ name: "LRC lyrics", extensions: ["lrc"] }],
      });
      if (!path) return;
      const target = path.toLowerCase().endsWith(".lrc") ? path : `${path}.lrc`;
      await api.exportLyricsFile(trackId, target);
      toast("Exported .lrc file.");
    } catch (err) {
      usePlayer.getState().onError(String(err));
    }
  }, [dirty, source, saveLyrics, song, trackId, toast]);

  const handleDelete = useCallback(async () => {
    try {
      await api.deleteLocalLyrics(trackId);
      notifyLyricsChanged(trackId);
      setDeleteOpen(false);
      toast("Local lyrics deleted.");
      setReloadKey((value) => value + 1);
    } catch (err) {
      usePlayer.getState().onError(String(err));
    }
  }, [trackId, toast]);

  const handlePlay = () => {
    if (!song) return;
    if (!isCurrent) {
      playSongs([song], 0);
      return;
    }
    if (playerStatus === "playing") pause();
    else toggle();
  };

  const requestBack = () => {
    if (dirty) {
      setLeaveOpen(true);
      return;
    }
    navigate("/lyrics");
  };

  const sourceLabel =
    source === "local"
      ? "Local"
      : source === "lrclib"
        ? "LRCLIB"
        : source === "server"
          ? "Server"
          : "New";
  const subtitle = [song?.artist, song?.album].filter(Boolean).join(" · ");

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={ui.spinner} />
      </div>
    );
  }

  return (
    <div className={styles.editor}>
      <header className={styles.editorHead}>
        <button type="button" className={styles.back} onClick={requestBack}>
          <ArrowLeft size={15} />
          Lyrics
        </button>
        <div className={styles.headInfo}>
          <h1 className={styles.editorTitle}>
            {song?.title || baseMeta?.title || "Untitled track"}
          </h1>
          <div className={styles.editorSub}>
            {subtitle || baseMeta?.artist || "Local lyrics"}
          </div>
        </div>
        <div className={styles.headActions}>
          <span
            className={`${styles.status} ${
              source === "local"
                ? styles.statusLocal
                : source === "lrclib" || source === "server"
                  ? styles.statusSynced
                  : styles.statusNone
            }`}
          >
            {sourceLabel}
          </span>
          <button
            type="button"
            className={`${ui.button} ${ui.ghost}`}
            onClick={() => void handleImport()}
          >
            <Upload size={14} />
            Import
          </button>
          <button
            type="button"
            className={`${ui.button} ${ui.ghost}`}
            onClick={() => void handleExport()}
            disabled={saving || (!lines.length && source !== "local")}
          >
            <Download size={14} />
            Export
          </button>
          {source === "local" ? (
            <button
              type="button"
              className={`${ui.button} ${ui.ghost}`}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 size={14} />
              Delete
            </button>
          ) : null}
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            onClick={() => void saveLyrics()}
            disabled={!dirty || saving}
          >
            <Check size={14} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <div className={styles.transport}>
        <button
          type="button"
          className={`${styles.playBtn} ${playing ? styles.playBtnAccent : ""}`}
          onClick={handlePlay}
          aria-label={playing ? "Pause" : "Play track"}
          disabled={!song}
        >
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <div className={styles.transportTime}>
          <strong>{formatTime(position)}</strong> / {formatTime(duration)}
        </div>
        <WaveformSeek
          className={styles.transportWave}
          value={position}
          max={duration}
          onCommit={(value) => {
            if (isCurrent) seek(value);
            else if (song) {
              playSongs([song], 0);
            }
          }}
          trackId={trackId}
          ariaLabel="Track position"
          height={42}
        />
        <span className={styles.rowMeta}>
          {isCurrent ? "" : "Load the track to sync"}
        </span>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.toolGroup}>
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => setSelectedId(null)}
            disabled={!selectedId}
          >
            <Music2 size={13} />
            Clear selection
          </button>
        </div>
        <div className={styles.toolGroup}>
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => nudge(-100, "line")}
            disabled={!selectedId}
          >
            −100 ms
          </button>
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => nudge(100, "line")}
            disabled={!selectedId}
          >
            +100 ms
          </button>
        </div>
        <div className={styles.toolGroup}>
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => nudge(-100, "all")}
          >
            Shift all −0.1s
          </button>
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => nudge(100, "all")}
          >
            Shift all +0.1s
          </button>
        </div>
        <div className={styles.toolGroup}>
          <button
            type="button"
            className={styles.toolButton}
            onClick={distribute}
          >
            <ArrowDownUp size={12} />
            Distribute
          </button>
          <button
            type="button"
            className={styles.toolButton}
            onClick={sortLines}
            disabled={!outOfOrder}
          >
            Sort by time
          </button>
          <button
            type="button"
            className={styles.toolButton}
            onClick={undo}
            disabled={undoCount === 0}
          >
            <Undo2 size={12} />
            Undo
          </button>
        </div>

        <button
          type="button"
          className={styles.tapButton}
          onClick={tapNext}
          disabled={!lines.length}
          title="Stamp the selected (or next untimed) line with the current playback position"
        >
          Tap
          <kbd>T</kbd>
        </button>
      </div>

      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`}>
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      ) : null}

      {source === "lrclib" || source === "server" ? (
        <div className={styles.banner}>
          <Info size={15} />
          <span>
            {source === "lrclib"
              ? "These lyrics come from LRCLIB. Saving stores a local copy that overrides the provider inside hush."
              : "These lyrics come from the server. Saving stores a local copy that overrides the server version inside hush."}
          </span>
        </div>
      ) : null}

      {!isCurrent ? (
        <div className={styles.banner}>
          <Info size={15} />
          <span>
            Press play (or Tap) to load this track. Playback position is used
            to stamp lines while you tap along.
          </span>
        </div>
      ) : null}

      {untimedCount > 0 ? (
        <div className={`${styles.banner} ${styles.bannerWarning}`}>
          <AlertTriangle size={15} />
          <span>
            {untimedCount === 1
              ? "1 line has no timestamp yet."
              : `${untimedCount} lines have no timestamp yet.`}{" "}
            Select a line, play the track and tap T in time with the music.
          </span>
        </div>
      ) : null}

      {duplicates > 0 ? (
        <div className={`${styles.banner} ${styles.bannerWarning}`}>
          <AlertTriangle size={15} />
          <span>
            {duplicates === 1
              ? "Two lines share the same timestamp."
              : `${duplicates} timestamps are used more than once.`}
          </span>
        </div>
      ) : null}

      {lines.length ? (
        <div className={styles.linesHead}>
          <span />
          <span>Time</span>
          <span>Line</span>
          <span />
          <span />
        </div>
      ) : null}

      <div className={styles.lines}>
        {lines.map((line, index) => {
          const isSelected = line.id === selectedId;
          const near =
            isCurrent &&
            line.startMs != null &&
            position * 1000 >= line.startMs &&
            (lines[index + 1]?.startMs ?? Number.POSITIVE_INFINITY) >
              position * 1000;
          return (
            <div
              key={line.id}
              className={`${styles.line} ${
                isSelected ? styles.lineSelected : ""
              } ${near ? styles.lineActive : ""}`}
              onMouseDown={() => setSelectedId(line.id)}
            >
              <span className={styles.lineIndex}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <TimeField
                value={line.startMs}
                onCommit={(value) => setLineTime(line.id, value)}
              />
              <input
                className={styles.textInput}
                value={line.text}
                placeholder="Lyric line"
                spellCheck={false}
                onFocus={() => {
                  setSelectedId(line.id);
                  pushUndo();
                }}
                onChange={(event) =>
                  updateLine(line.id, { text: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addLine();
                  }
                }}
              />
              <button
                type="button"
                className={styles.lineTap}
                onClick={() => {
                  setSelectedId(line.id);
                  void applyTap(line.id);
                }}
                title="Stamp this line at the current position"
              >
                Tap
              </button>
              <button
                type="button"
                className={styles.lineDelete}
                onClick={() => deleteLine(line.id)}
                aria-label={`Delete line ${index + 1}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}

        {lines.length ? (
          <button type="button" className={styles.addLine} onClick={addLine}>
            <Plus size={14} />
            Add line
          </button>
        ) : null}
      </div>

      {!lines.length && !error ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>No lyrics yet</div>
          Add lines to sync them with the track, import an .lrc file, or paste
          lyrics line by line.
          <button type="button" className={styles.addLine} onClick={addLine}>
            <Plus size={14} />
            Add first line
          </button>
        </div>
      ) : null}

      {timedLines.length === 0 && lines.length > 0 ? (
        <div className={`${styles.banner} ${styles.bannerWarning}`}>
          <AlertTriangle size={15} />
          <span>
            Nothing is timed yet. Use <strong>Distribute</strong> for a rough
            starting point, then tap along to refine each line.
          </span>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete local lyrics?"
        message="This removes hush's saved lyrics for this track. Server lyrics (if any) will be shown again."
        confirmLabel="Delete"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteOpen(false)}
      />

      <ConfirmDialog
        open={leaveOpen}
        title="Discard unsaved changes?"
        message="Your edits to these lyrics have not been saved."
        confirmLabel="Discard"
        danger
        onConfirm={() => navigate("/lyrics")}
        onCancel={() => setLeaveOpen(false)}
      />
    </div>
  );
}
