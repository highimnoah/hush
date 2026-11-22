import { Heart } from "lucide-react";

import { AlbumCard } from "../components/library/AlbumCard";
import { ArtistCard } from "../components/library/ArtistCard";
import { TrackList } from "../components/library/TrackList";
import { AsyncContent } from "../components/ui/AsyncContent";
import { EmptyState } from "../components/ui/EmptyState";
import { NotConfigured } from "../components/ui/NotConfigured";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import type { SearchResults } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import styles from "../styles/library.module.css";

function LikedBody({ results }: { results: SearchResults }) {
  const empty =
    !results.songs.length && !results.albums.length && !results.artists.length;

  if (empty) {
    return (
      <EmptyState
        icon={<Heart size={22} />}
        title="Nothing liked yet"
        text="Star tracks, albums and artists in Navidrome and they will show up here."
      />
    );
  }

  return (
    <>
      {results.songs.length ? (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Liked songs</h2>
          </div>
          <TrackList
            songs={results.songs}
            showAlbum
            showArtwork
            showHeader={false}
          />
        </section>
      ) : null}

      {results.albums.length ? (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Liked albums</h2>
          </div>
          <div className={`${styles.grid} ${styles.gridWide}`}>
            {results.albums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        </section>
      ) : null}

      {results.artists.length ? (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Liked artists</h2>
          </div>
          <div className={`${styles.grid} ${styles.artistGrid}`}>
            {results.artists.map((artist) => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

export function LikedView() {
  const configured = useConfigured();

  const state = useAsync<SearchResults | null>(
    () => (configured ? api.getStarred() : Promise.resolve(null)),
    [configured],
  );

  if (!configured) return <NotConfigured />;

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Liked</h1>
          <div className={styles.pageSubtitle}>Your starred music</div>
        </div>
      </div>

      <AsyncContent state={state} loadingLabel="Loading liked music…">
        {(results) => (results ? <LikedBody results={results} /> : null)}
      </AsyncContent>
    </div>
  );
}
