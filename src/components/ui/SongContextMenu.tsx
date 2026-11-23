import {
  ChevronLeft,
  Disc3,
  ListPlus,
  Play,
  Plus,
  SkipForward,
  Star,
  Trash2,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../../lib/ipc";
import type { Playlist } from "../../lib/types";
import { useContextMenu } from "../../store/contextMenu";
import { useLibrary } from "../../store/library";
import { usePlayer } from "../../store/player";
import { useToast } from "../../store/toast";
import ui from "../../styles/ui.module.css";
import { PromptDialog } from "./Dialog";

export function SongContextMenu() {
  const song = useContextMenu((state) => state.song);
  const playlist = useContextMenu((state) => state.playlist);
  const x = useContextMenu((state) => state.x);
  const y = useContextMenu((state) => state.y);
  const close = useContextMenu((state) => state.close);
  const playSongs = usePlayer((state) => state.playSongs);
  const playNext = usePlayer((state) => state.playNext);
  const addToQueue = usePlayer((state) => state.addToQueue);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const starred = useLibrary((state) =>
    song ? state.isStarred("song", song.id, song.starred) : false,
  );
  const toggleStar = useLibrary((state) => state.toggleStar);

  const [view, setView] = useState<"main" | "playlists">("main");
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setView("main");
    setPlaylists(null);
    setPromptOpen(false);
    setBusy(false);
  }, [song?.id]);

  useEffect(() => {
    if (!song) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", close);
    };
  }, [song, close]);

  const openPlaylists = () => {
    setView("playlists");
    if (playlists === null && !loadingPlaylists) {
      setLoadingPlaylists(true);
      api
        .getPlaylists()
        .then((list) => setPlaylists(list))
        .catch(() => setPlaylists([]))
        .finally(() => setLoadingPlaylists(false));
    }
  };

  const addToPlaylist = async (target: Playlist) => {
    if (!song || busy) return;
    setBusy(true);
    try {
      await api.updatePlaylist(target.id, { songIdsToAdd: [song.id] });
      useToast.getState().show(`Added to ${target.name || "playlist"}`);
      close();
    } catch (err) {
      usePlayer.getState().onError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async (name: string) => {
    if (!song || busy) return;
    setBusy(true);
    try {
      await api.createPlaylist(name, [song.id]);
      useToast.getState().show(`Created “${name}”`);
      setPromptOpen(false);
      close();
    } catch (err) {
      usePlayer.getState().onError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const removeFromPlaylist = async () => {
    if (!playlist || busy) return;
    setBusy(true);
    try {
      await api.updatePlaylist(playlist.playlistId, {
        songIndexesToRemove: [playlist.index],
      });
      useToast.getState().show("Removed from playlist");
      playlist.onChanged?.();
      close();
    } catch (err) {
      usePlayer.getState().onError(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!song) return null;

  const left = Math.max(8, Math.min(x, window.innerWidth - 250));
  const top = Math.max(8, Math.min(y, window.innerHeight - 430));

  return (
    <>
      <div
        ref={ref}
        className={ui.menu}
        style={{ left, top }}
        role="menu"
        onContextMenu={(event) => event.preventDefault()}
      >
        {view === "main" ? (
          <>
            <div className={ui.menuHeader}>{song.title || "Track"}</div>

            <button
              type="button"
              className={ui.menuItem}
              onClick={() => {
                playSongs([song], 0);
                close();
              }}
            >
              <Play size={15} />
              Play
            </button>
            <button
              type="button"
              className={ui.menuItem}
              onClick={() => {
                playNext(song);
                close();
              }}
            >
              <SkipForward size={15} />
              Play next
            </button>
            <button
              type="button"
              className={ui.menuItem}
              onClick={() => {
                addToQueue(song);
                close();
              }}
            >
              <Plus size={15} />
              Add to queue
            </button>
            <button
              type="button"
              className={ui.menuItem}
              onClick={openPlaylists}
            >
              <ListPlus size={15} />
              Add to playlist
            </button>
            <button
              type="button"
              className={ui.menuItem}
              onClick={() => {
                toggleStar("song", song.id, starred);
                close();
              }}
            >
              <Star size={15} fill={starred ? "currentColor" : "none"} />
              {starred ? "Remove from favorites" : "Add to favorites"}
            </button>

            {playlist ? (
              <button
                type="button"
                className={`${ui.menuItem} ${ui.menuDanger}`}
                onClick={() => void removeFromPlaylist()}
                disabled={busy}
              >
                <Trash2 size={15} />
                Remove from this playlist
              </button>
            ) : null}

            {song.albumId || song.artistId ? (
              <div className={ui.menuDivider} />
            ) : null}

            {song.albumId ? (
              <button
                type="button"
                className={ui.menuItem}
                onClick={() => {
                  navigate(`/albums/${song.albumId}`);
                  close();
                }}
              >
                <Disc3 size={15} />
                Go to album
              </button>
            ) : null}
            {song.artistId ? (
              <button
                type="button"
                className={ui.menuItem}
                onClick={() => {
                  navigate(`/artists/${song.artistId}`);
                  close();
                }}
              >
                <User size={15} />
                Go to artist
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button
              type="button"
              className={ui.menuItem}
              onClick={() => setView("main")}
            >
              <ChevronLeft size={15} />
              Back
            </button>
            <div className={ui.menuHeader}>Add to playlist</div>
            {loadingPlaylists ? (
              <div className={ui.menuNote}>Loading…</div>
            ) : null}
            {playlists?.map((item) => (
              <button
                key={item.id}
                type="button"
                className={ui.menuItem}
                disabled={busy}
                onClick={() => void addToPlaylist(item)}
              >
                <ListPlus size={15} />
                {item.name || "Playlist"}
              </button>
            ))}
            {playlists && !playlists.length ? (
              <div className={ui.menuNote}>No playlists yet.</div>
            ) : null}
            <div className={ui.menuDivider} />
            <button
              type="button"
              className={ui.menuItem}
              onClick={() => setPromptOpen(true)}
            >
              <Plus size={15} />
              New playlist…
            </button>
          </>
        )}
      </div>

      <PromptDialog
        open={promptOpen}
        title="New playlist"
        label="Playlist name"
        placeholder="My playlist"
        confirmLabel="Create"
        busy={busy}
        onConfirm={(name) => void createAndAdd(name)}
        onCancel={() => setPromptOpen(false)}
      />
    </>
  );
}
