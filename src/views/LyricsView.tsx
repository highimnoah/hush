import { FileText, Pencil, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ConfirmDialog } from "../components/ui/Dialog";
import { formatTime } from "../lib/format";
import { api } from "../lib/ipc";
import {
  LYRICS_CHANGED_EVENT,
  lyricsMeta,
  notifyLyricsChanged,
} from "../lib/lyrics";
import type {
  LocalLyricsSummary,
  LyricsSource,
  Song,
} from "../lib/types";
import { useAsync, useDebounced } from "../lib/useAsync";
import { useConfigured } from "../lib/hooks";
import { usePlayer } from "../store/player";
import { useToast } from "../store/toast";
import styles from "../styles/lyrics.module.css";
import ui from "../styles/ui.module.css";

type StatusKind =
  | "loading"
  | "local"
  | "lrclib"
  | "lrclibPlain"
  | "synced"
  | "plain"
  | "none"
  | "error";

const STATUS_LABEL: Record<StatusKind, string> = {
  loading: "Checking…",
  local: "Local",
  lrclib: "Synced (LRCLIB)",
  lrclibPlain: "Plain (LRCLIB)",
  synced: "Synced (server)",
  plain: "Plain (server)",
  none: "None",
  error: "Unavailable",
};

function statusClass(kind: StatusKind): string {
  switch (kind) {
    case "local":
      return styles.statusLocal;
    case "lrclib":
    case "synced":
      return styles.statusSynced;
    case "lrclibPlain":
    case "plain":
      return styles.statusPlain;
    case "none":
    case "error":
      return styles.statusNone;
    default:
      return "";
  }
}

function formatUpdated(ms: number | null): string {
  if (!ms) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

function LyricsStatus({
  song,
  isLocal,
  version,
}: {
  song: Song;
  isLocal: boolean;
  version: number;
}) {
  const [kind, setKind] = useState<StatusKind>(isLocal ? "local" : "loading");

  useEffect(() => {
    if (isLocal) {
      setKind("local");
      return;
    }

    let cancelled = false;
    setKind("loading");
    api
      .getLyrics(song.id, lyricsMeta(song))
      .then((lyrics) => {
        if (cancelled) return;
        const source: LyricsSource = lyrics.source;
        if (source === "local") setKind("local");
        else if (source === "lrclib") {
          setKind(lyrics.synced?.length ? "lrclib" : "lrclibPlain");
        } else if (lyrics.synced?.length) setKind("synced");
        else if (lyrics.plain) setKind("plain");
        else setKind("none");
      })
      .catch(() => {
        if (!cancelled) setKind("error");
      });

    return () => {
      cancelled = true;
    };
  }, [song, isLocal, version]);

  return (
    <span className={`${styles.status} ${statusClass(kind)}`}>
      {STATUS_LABEL[kind]}
    </span>
  );
}

function LocalRow({
  entry,
  onDelete,
}: {
  entry: LocalLyricsSummary;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const title = entry.title || "Untitled track";
  const sub = [entry.artist, entry.album].filter(Boolean).join(" · ");

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.rowMain}
        onClick={() => navigate(`/lyrics/${entry.trackId}`)}
      >
        <span className={styles.rowTitle}>{title}</span>
        <span className={styles.rowSub}>
          {sub || entry.trackId}
          {entry.lineCount
            ? ` · ${entry.lineCount} ${
                entry.lineCount === 1 ? "line" : "lines"
              }`
            : ""}
        </span>
      </button>
      <span className={`${styles.status} ${styles.statusLocal}`}>
        {entry.synced ? "Synced" : "Plain"}
      </span>
      <span className={styles.rowMeta}>{formatUpdated(entry.updatedMs)}</span>
      <div className={styles.rowActions}>
        <button
          type="button"
          className={ui.iconBtn}
          onClick={() => navigate(`/lyrics/${entry.trackId}`)}
          title="Edit lyrics"
        >
          <Pencil size={15} />
        </button>
        <button
          type="button"
          className={ui.iconBtn}
          onClick={onDelete}
          title="Delete local lyrics"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

function SearchRow({
  song,
  isLocal,
  version,
}: {
  song: Song;
  isLocal: boolean;
  version: number;
}) {
  const navigate = useNavigate();
  const sub = [song.artist, song.album].filter(Boolean).join(" · ");

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.rowMain}
        onClick={() => navigate(`/lyrics/${song.id}`)}
      >
        <span className={styles.rowTitle}>{song.title || "Untitled"}</span>
        <span className={styles.rowSub}>{sub || "Unknown artist"}</span>
      </button>
      <LyricsStatus
        song={song}
        isLocal={isLocal}
        version={version}
      />
      <span className={styles.rowMeta}>{formatTime(song.duration)}</span>
      <div className={styles.rowActions}>
        <button
          type="button"
          className={`${ui.button} ${ui.ghost}`}
          onClick={() => navigate(`/lyrics/${song.id}`)}
        >
          <FileText size={14} />
          Edit
        </button>
      </div>
    </div>
  );
}

export function LyricsView() {
  const configured = useConfigured();
  const toast = useToast((state) => state.show);

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 340);
  const [version, setVersion] = useState(0);
  const [deleteTarget, setDeleteTarget] =
    useState<LocalLyricsSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const local = useAsync<LocalLyricsSummary[]>(
    () => api.listLocalLyrics(),
    [version],
  );

  const search = useAsync<Song[] | null>(
    () =>
      configured && debouncedQuery.trim()
        ? api.search(debouncedQuery.trim()).then((result) => result.songs)
        : Promise.resolve(null),
    [configured, debouncedQuery],
  );

  useEffect(() => {
    const onChange = () => setVersion((value) => value + 1);
    window.addEventListener(LYRICS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(LYRICS_CHANGED_EVENT, onChange);
  }, []);

  const localIds = useMemo(
    () => new Set((local.data ?? []).map((entry) => entry.trackId)),
    [local.data],
  );

  const localCount = local.data?.length ?? 0;
  const songs = search.data ?? null;
  // Lyrics status is checked per track, so keep the visible result set small.
  const visibleSongs = songs?.slice(0, 20) ?? null;

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.deleteLocalLyrics(deleteTarget.trackId);
      notifyLyricsChanged(deleteTarget.trackId);
      toast("Local lyrics deleted.");
      setDeleteTarget(null);
      setVersion((value) => value + 1);
    } catch (err) {
      usePlayer.getState().onError(String(err));
    } finally {
      setBusy(false);
    }
  }, [deleteTarget, toast]);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Lyrics</h1>
          <div className={styles.subtitle}>
            {localCount
              ? `${localCount} ${
                  localCount === 1 ? "track" : "tracks"
                } with local lyrics`
              : "Create and sync lyrics for your library"}
          </div>
        </div>
      </div>

      <div className={styles.searchRow}>
        <Search size={15} />
        <input
          className={styles.searchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            configured
              ? "Search the library to edit or create lyrics"
              : "Connect a server to search the library"
          }
          spellCheck={false}
          disabled={!configured}
          aria-label="Search songs for lyrics editing"
        />
      </div>

      {debouncedQuery.trim() ? (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Search results</span>
            {search.loading ? (
              <span className={styles.sectionCount}>Searching…</span>
            ) : songs ? (
              <span className={styles.sectionCount}>
                {songs.length > 20
                  ? `First 20 of ${songs.length} songs`
                  : `${songs.length} ${songs.length === 1 ? "song" : "songs"}`}
              </span>
            ) : null}
          </div>

          {search.error ? (
            <div className={styles.empty}>{search.error}</div>
          ) : visibleSongs && visibleSongs.length ? (
            <div className={styles.list}>
              {visibleSongs.map((song) => (
                <SearchRow
                  key={song.id}
                  song={song}
                  isLocal={localIds.has(song.id)}
                  version={version}
                />
              ))}
            </div>
          ) : !search.loading ? (
            <div className={styles.empty}>
              <div className={styles.emptyTitle}>No songs found</div>
              Try a different search term.
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Local lyrics</span>
          {local.data ? (
            <span className={styles.sectionCount}>
              {localCount} {localCount === 1 ? "track" : "tracks"}
            </span>
          ) : null}
        </div>

        {local.loading ? (
          <div className={styles.empty}>Loading local lyrics…</div>
        ) : local.error ? (
          <div className={styles.empty}>{local.error}</div>
        ) : local.data && local.data.length ? (
          <div className={styles.list}>
            {local.data.map((entry) => (
              <LocalRow
                key={entry.trackId}
                entry={entry}
                onDelete={() => setDeleteTarget(entry)}
              />
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>No local lyrics yet</div>
            Search for a song above, then open the editor to write or import
            lyrics. hush stores them locally and can export standard .lrc files.
          </div>
        )}
      </section>

      <ConfirmDialog
        open={deleteTarget != null}
        title="Delete local lyrics?"
        message={
          deleteTarget
            ? `Remove the saved lyrics for “${
                deleteTarget.title || deleteTarget.trackId
              }”? Server lyrics will be shown again if available.`
            : ""
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
