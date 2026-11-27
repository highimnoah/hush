import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

import type { Artist } from "../../lib/types";
import styles from "../../styles/library.module.css";
import { ArtistAvatar } from "../ui/ArtistAvatar";

export function ArtistCard({
  artist,
  style,
}: {
  artist: Artist;
  style?: React.CSSProperties;
}) {
  return (
    <Link
      to={`/artists/${artist.id}`}
      className={`${styles.card} ${styles.artistCard}`}
      style={style}
    >
      <ArtistAvatar
        artistId={artist.id}
        name={artist.name}
        serverUrl={artist.artistImageUrl}
        className={styles.artistAvatar}
      />
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
