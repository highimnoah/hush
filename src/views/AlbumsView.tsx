import { useState } from "react";

import { AlbumCard } from "../components/library/AlbumCard";
import { AsyncContent } from "../components/ui/AsyncContent";
import { EmptyState } from "../components/ui/EmptyState";
import { CardSkeletonGrid } from "../components/ui/States";
import { ViewSearchBar } from "../components/ui/ViewSearchBar";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import type { Album } from "../lib/types";
import { useCachedAsync, useDebounced } from "../lib/useAsync";
import styles from "../styles/library.module.css";
import ui from "../styles/ui.module.css";
import { NotConfigured } from "../components/ui/NotConfigured";

const SORTS = [
  { value: "newest", label: "Recently added" },
  { value: "recent", label: "Recently played" },
  { value: "frequent", label: "Most played" },
  { value: "alphabetical", label: "A → Z" },
  { value: "random", label: "Random" },
  { value: "starred", label: "Starred" },
];

export function AlbumsView() {
  const configured = useConfigured();
  const [sort, setSort] = useState("newest");
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 300);
  const term = debounced.trim();

  const cacheKey = configured
    ? term
      ? `albums:search:${term}`
      : `albums:list:${sort}`
    : null;

  const state = useCachedAsync<Album[]>(
    cacheKey,
    () => {
      if (!configured) return Promise.resolve([]);
      if (term) return api.searchAlbums(term, 120);
      return api.getAlbums(sort, 120);
    },
    [sort, term, configured],
  );

  if (!configured) return <NotConfigured />;

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Albums</h1>
          <div className={styles.pageSubtitle}>
            {term ? `Results for “${term}”` : "Browse your collection"}
          </div>
        </div>
        {term ? null : (
          <div className={styles.headActions}>
            <select
              className={ui.select}
              style={{ width: 186 }}
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              aria-label="Sort albums"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <ViewSearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search albums"
        ariaLabel="Search albums"
      />

      <AsyncContent state={state} skeleton={<CardSkeletonGrid count={12} />}>
        {(albums) =>
          albums.length ? (
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
          ) : term ? (
            <EmptyState
              title="No albums match"
              text={`Nothing found for “${term}”.`}
            />
          ) : (
            <EmptyState
              title="No albums"
              text="Your server did not return any albums for this view."
            />
          )
        }
      </AsyncContent>
    </div>
  );
}
