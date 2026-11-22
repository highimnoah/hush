import { Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../../lib/ipc";
import type { Playlist } from "../../lib/types";
import { usePlayer } from "../../store/player";
import styles from "../../styles/library.module.css";
import { Artwork } from "../ui/Artwork";

export function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const playSongs = usePlayer((state) => state.playSongs);
  const [busy, setBusy] = useState(false);

  const handlePlay = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const detail = await api.getPlaylist(playlist.id);
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
        <Link
          to={`/playlists/${playlist.id}`}
          aria-label={`Open ${playlist.name}`}
        >
          <Artwork coverId={playlist.coverArt} size={320} alt={playlist.name} />
        </Link>
        <button
          type="button"
          className={styles.playBtn}
          onClick={handlePlay}
          disabled={busy}
          aria-label={`Play ${playlist.name}`}
        >
          <Play size={18} fill="currentColor" strokeWidth={0} />
        </button>
      </div>
      <Link to={`/playlists/${playlist.id}`} className={styles.cardText}>
        <div className={styles.cardTitle} title={playlist.name}>
          {playlist.name}
        </div>
        <div className={styles.cardSub}>
          {playlist.songCount ?? 0}{" "}
          {playlist.songCount === 1 ? "song" : "songs"}
        </div>
      </Link>
    </div>
  );
}
