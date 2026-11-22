import { Heart, Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../../lib/ipc";
import type { Album } from "../../lib/types";
import { useLibrary } from "../../store/library";
import { usePlayer } from "../../store/player";
import styles from "../../styles/library.module.css";
import { Artwork } from "../ui/Artwork";

export function AlbumCard({ album }: { album: Album }) {
  const playSongs = usePlayer((state) => state.playSongs);
  const starred = useLibrary((state) =>
    state.isStarred("album", album.id, album.starred),
  );
  const toggleStar = useLibrary((state) => state.toggleStar);
  const [busy, setBusy] = useState(false);

  const handlePlay = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const detail = await api.getAlbum(album.id);
      if (detail.songs.length) playSongs(detail.songs, 0);
    } catch {
      /* errors are surfaced by the surrounding view */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardArt}>
        <Link to={`/albums/${album.id}`} aria-label={`Open ${album.name}`}>
          <Artwork coverId={album.coverArt} size={320} alt={album.name} />
        </Link>
        <button
          type="button"
          className={styles.playBtn}
          onClick={handlePlay}
          disabled={busy}
          aria-label={`Play ${album.name}`}
        >
          <Play size={18} fill="currentColor" strokeWidth={0} />
        </button>
        <button
          type="button"
          className={`${styles.favBtn} ${starred ? styles.favActive : ""}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleStar("album", album.id, starred);
          }}
          aria-label={
            starred ? "Remove album from favorites" : "Add album to favorites"
          }
          aria-pressed={starred}
        >
          <Heart size={15} fill={starred ? "currentColor" : "none"} />
        </button>
      </div>
      <Link to={`/albums/${album.id}`} className={styles.cardText}>
        <div className={styles.cardTitle} title={album.name}>
          {album.name}
        </div>
        <div className={styles.cardSub} title={album.artist ?? ""}>
          {album.artist || "Unknown artist"}
        </div>
      </Link>
    </div>
  );
}
