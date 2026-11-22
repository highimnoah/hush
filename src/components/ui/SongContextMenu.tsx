import { Disc3, Play, Plus, SkipForward, Star, User } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { useContextMenu } from "../../store/contextMenu";
import { useLibrary } from "../../store/library";
import { usePlayer } from "../../store/player";
import ui from "../../styles/ui.module.css";

export function SongContextMenu() {
  const song = useContextMenu((state) => state.song);
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

  if (!song) return null;

  const left = Math.max(8, Math.min(x, window.innerWidth - 240));
  const top = Math.max(8, Math.min(y, window.innerHeight - 250));

  return (
    <div
      ref={ref}
      className={ui.menu}
      style={{ left, top }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
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
        onClick={() => {
          toggleStar("song", song.id, starred);
          close();
        }}
      >
        <Star size={15} fill={starred ? "currentColor" : "none"} />
        {starred ? "Remove from favorites" : "Add to favorites"}
      </button>

      {song.albumId || song.artistId ? <div className={ui.menuDivider} /> : null}

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
    </div>
  );
}
