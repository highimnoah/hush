import { Pencil, Play, Shuffle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { TrackList } from "../components/library/TrackList";
import { AsyncContent } from "../components/ui/AsyncContent";
import { Artwork } from "../components/ui/Artwork";
import { BackButton } from "../components/ui/BackButton";
import { ConfirmDialog, PromptDialog } from "../components/ui/Dialog";
import { NotConfigured } from "../components/ui/NotConfigured";
import { formatDuration } from "../lib/format";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import type { PlaylistDetail, Song } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import { useContextMenu } from "../store/contextMenu";
import { usePlayer } from "../store/player";
import { useSettings } from "../store/settings";
import { useToast } from "../store/toast";
import styles from "../styles/library.module.css";
import ui from "../styles/ui.module.css";

function PlaylistBody({
  detail,
  onReload,
}: {
  detail: PlaylistDetail;
  onReload: () => void;
}) {
  const { playlist } = detail;
  const navigate = useNavigate();
  const toast = useToast((state) => state.show);
  const openMenu = useContextMenu((state) => state.open);
  const username = useSettings((state) => state.settings?.username ?? "");
  const playSongs = usePlayer((state) => state.playSongs);
  const playShuffled = usePlayer((state) => state.playShuffled);

  const [songs, setSongs] = useState<Song[]>(detail.songs);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSongs(detail.songs);
  }, [detail]);

  const editable = !playlist.owner || !username || playlist.owner === username;

  const total =
    playlist.duration ?? songs.reduce((sum, song) => sum + (song.duration ?? 0), 0);

  const handleMove = async (from: number, to: number) => {
    if (!editable || busy) return;
    const previous = songs;
    const next = [...songs];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setSongs(next);
    try {
      await api.replacePlaylist(playlist.id, next.map((song) => song.id));
      toast("Playlist reordered");
    } catch (err) {
      setSongs(previous);
      usePlayer.getState().onError(String(err));
    }
  };

  const handleRename = async (name: string) => {
    setBusy(true);
    try {
      await api.updatePlaylist(playlist.id, { name });
      toast("Playlist renamed");
      setRenameOpen(false);
      onReload();
    } catch (err) {
      usePlayer.getState().onError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await api.deletePlaylist(playlist.id);
      toast("Playlist deleted");
      navigate("/playlists");
    } catch (err) {
      usePlayer.getState().onError(String(err));
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.hero}>
        <div className={styles.heroArt}>
          <Artwork
            coverId={playlist.coverArt}
            size={600}
            alt={playlist.name}
          />
        </div>
        <div className={styles.heroInfo}>
          <div className={styles.heroKind}>Playlist</div>
          <h1 className={styles.heroTitle}>{playlist.name}</h1>
          <div className={styles.heroMeta}>
            {playlist.owner ? <span>{playlist.owner}</span> : null}
            <span className={styles.dot} />
            <span>
              {songs.length} {songs.length === 1 ? "song" : "songs"}
            </span>
            {total ? (
              <>
                <span className={styles.dot} />
                <span>{formatDuration(total)}</span>
              </>
            ) : null}
          </div>
          {playlist.comment ? (
            <p className={styles.pageSubtitle}>{playlist.comment}</p>
          ) : null}
          <div className={styles.heroActions}>
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              onClick={() => playSongs(songs, 0)}
              disabled={!songs.length}
            >
              <Play size={15} fill="currentColor" strokeWidth={0} />
              Play
            </button>
            <button
              type="button"
              className={`${ui.button} ${ui.ghost}`}
              onClick={() => playShuffled(songs, 0)}
              disabled={!songs.length}
            >
              <Shuffle size={15} />
              Shuffle
            </button>
            {editable ? (
              <>
                <button
                  type="button"
                  className={ui.iconBtn}
                  onClick={() => setRenameOpen(true)}
                  aria-label="Rename playlist"
                  title="Rename playlist"
                >
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  className={ui.iconBtn}
                  onClick={() => setDeleteOpen(true)}
                  aria-label="Delete playlist"
                  title="Delete playlist"
                >
                  <Trash2 size={16} />
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {songs.length ? (
        <TrackList
          songs={songs}
          showAlbum
          showArtwork
          onMove={editable ? (from, to) => void handleMove(from, to) : undefined}
          onMore={(song, x, y, index) =>
            openMenu(song, x, y, {
              playlistId: playlist.id,
              index,
              onChanged: onReload,
            })
          }
        />
      ) : (
        <div className={styles.inlineLoading}>
          This playlist is empty. Add songs from any track's menu.
        </div>
      )}

      <PromptDialog
        open={renameOpen}
        title="Rename playlist"
        label="Playlist name"
        initialValue={playlist.name}
        confirmLabel="Save"
        busy={busy}
        onConfirm={(name) => void handleRename(name)}
        onCancel={() => setRenameOpen(false)}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete playlist"
        message={`Delete “${playlist.name}”? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  );
}

export function PlaylistView() {
  const { id } = useParams<{ id: string }>();
  const configured = useConfigured();

  const state = useAsync<PlaylistDetail | null>(
    () => (configured && id ? api.getPlaylist(id) : Promise.resolve(null)),
    [id, configured],
  );

  if (!configured) return <NotConfigured />;

  return (
    <div className={styles.page}>
      <BackButton to="/playlists" label="Playlists" />
      <AsyncContent state={state} loadingLabel="Loading playlist…">
        {(detail) =>
          detail ? (
            <PlaylistBody detail={detail} onReload={state.reload} />
          ) : null
        }
      </AsyncContent>
    </div>
  );
}
