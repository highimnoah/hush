import { useParams } from "react-router-dom";

import { AlbumCard } from "../components/library/AlbumCard";
import { ArtistAvatar } from "../components/ui/ArtistAvatar";
import { AsyncContent } from "../components/ui/AsyncContent";
import { BackButton } from "../components/ui/BackButton";
import { EmptyState } from "../components/ui/EmptyState";
import { NotConfigured } from "../components/ui/NotConfigured";
import { CardSkeletonGrid } from "../components/ui/States";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import type { ArtistDetail } from "../lib/types";
import { useCachedAsync } from "../lib/useAsync";
import styles from "../styles/library.module.css";

function ArtistBody({ detail }: { detail: ArtistDetail }) {
  const { artist, albums } = detail;

  return (
    <>
      <div className={styles.hero}>
        <ArtistAvatar
          artistId={artist.id}
          name={artist.name}
          serverUrl={artist.artistImageUrl}
          className={styles.heroArtistAvatar}
        />
        <div className={styles.heroInfo}>
          <div className={styles.heroKind}>Artist</div>
          <h1 className={styles.heroTitle}>{artist.name}</h1>
          <div className={styles.heroMeta}>
            <span>
              {albums.length} {albums.length === 1 ? "album" : "albums"}
            </span>
          </div>
        </div>
      </div>

      {albums.length ? (
        <div className={`${styles.grid} ${styles.gridWide}`}>
          {albums.map((album, index) => (
            <div
              key={album.id}
              className={styles.gridItem}
              style={{
                animationDelay: `${Math.min(index * 25, 420)}ms`,
              }}
            >
              <AlbumCard album={album} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No albums" text="No albums were found." />
      )}
    </>
  );
}

export function ArtistView() {
  const { id } = useParams<{ id: string }>();
  const configured = useConfigured();

  const state = useCachedAsync<ArtistDetail | null>(
    configured && id ? `artist:detail:${id}` : null,
    () =>
      configured && id ? api.getArtist(id) : Promise.resolve(null),
    [id, configured],
  );

  if (!configured) return <NotConfigured />;

  return (
    <div className={styles.page}>
      <BackButton to="/artists" label="Artists" />
      <AsyncContent
        state={state}
        skeleton={<CardSkeletonGrid count={8} />}
        loadingLabel="Loading artist…"
      >
        {(detail) => (detail ? <ArtistBody detail={detail} /> : null)}
      </AsyncContent>
    </div>
  );
}
