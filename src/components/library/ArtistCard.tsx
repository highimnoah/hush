import { Link } from "react-router-dom";

import type { Artist } from "../../lib/types";
import styles from "../../styles/library.module.css";

export function ArtistCard({ artist }: { artist: Artist }) {
  const initial = artist.name?.trim().charAt(0).toUpperCase() || "?";

  return (
    <Link
      to={`/artists/${artist.id}`}
      className={`${styles.card} ${styles.artistCard}`}
    >
      <div className={styles.artistAvatar} aria-hidden="true">
        {initial}
      </div>
      <div>
        <div className={styles.cardTitle} title={artist.name}>
          {artist.name}
        </div>
        <div className={styles.cardSub}>
          {artist.albumCount
            ? `${artist.albumCount} ${artist.albumCount === 1 ? "album" : "albums"}`
            : "Artist"}
        </div>
      </div>
    </Link>
  );
}
