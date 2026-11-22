import { Search } from "lucide-react";
import { useState } from "react";

import { AlbumCard } from "../components/library/AlbumCard";
import { ArtistCard } from "../components/library/ArtistCard";
import { TrackList } from "../components/library/TrackList";
import { AsyncContent } from "../components/ui/AsyncContent";
import { EmptyState } from "../components/ui/EmptyState";
import { NotConfigured } from "../components/ui/NotConfigured";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import type { SearchResults } from "../lib/types";
import { useAsync, useDebounced } from "../lib/useAsync";
import styles from "../styles/library.module.css";

function SearchBody({ results }: { results: SearchResults }) {
  const hasAny =
    results.songs.length || results.albums.length || results.artists.length;

  if (!hasAny) {
    return (
      <EmptyState
        icon={<Search size={22} />}
        title="No results"
        text="Try a different title, album or artist."
      />
    );
  }

  return (
    <>
      {results.songs.length ? (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Songs</h2>
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
            <h2 className={styles.sectionTitle}>Albums</h2>
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
            <h2 className={styles.sectionTitle}>Artists</h2>
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

export function SearchView() {
  const configured = useConfigured();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 320);
  const trimmed = debounced.trim();

  const state = useAsync<SearchResults | null>(
    () =>
      configured && trimmed ? api.search(trimmed) : Promise.resolve(null),
    [trimmed, configured],
  );

  if (!configured) return <NotConfigured />;

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Search</h1>
          <div className={styles.pageSubtitle}>
            Find songs, albums and artists
          </div>
        </div>
      </div>

      <div className={styles.searchWrap}>
        <Search size={18} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your library"
          aria-label="Search your library"
          spellCheck={false}
          autoFocus
        />
      </div>

      {!query.trim() ? (
        <EmptyState
          icon={<Search size={22} />}
          title="Search your library"
          text="Start typing to search across songs, albums and artists."
        />
      ) : (
        <AsyncContent state={state} loadingLabel="Searching…">
          {(results) => (results ? <SearchBody results={results} /> : null)}
        </AsyncContent>
      )}
    </div>
  );
}
