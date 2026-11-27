import { useMemo, useState } from "react";

import { ArtistCard } from "../components/library/ArtistCard";
import { AsyncContent } from "../components/ui/AsyncContent";
import { EmptyState } from "../components/ui/EmptyState";
import { NotConfigured } from "../components/ui/NotConfigured";
import { CardSkeletonGrid } from "../components/ui/States";
import { ViewSearchBar } from "../components/ui/ViewSearchBar";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import type { Artist } from "../lib/types";
import { useCachedAsync } from "../lib/useAsync";
import styles from "../styles/library.module.css";

export function ArtistsView() {
  const configured = useConfigured();
  const [query, setQuery] = useState("");

  const state = useCachedAsync<Artist[]>(
    configured ? "artists:list" : null,
    () => (configured ? api.getArtists() : Promise.resolve([])),
    [configured],
  );

  const term = query.trim().toLowerCase();
  const artists = state.data ?? [];
  const filtered = useMemo(() => {
    if (!term) return artists;
    return artists.filter((artist) =>
      artist.name.toLowerCase().includes(term),
    );
  }, [artists, term]);

  if (!configured) return <NotConfigured />;

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Artists</h1>
          <div className={styles.pageSubtitle}>
            {state.data
              ? term
                ? `${filtered.length} of ${artists.length} artists`
                : `${artists.length} artists`
              : "Your library"}
          </div>
        </div>
      </div>

      <ViewSearchBar
        value={query}
        onChange={setQuery}
        placeholder="Filter artists"
        ariaLabel="Filter artists"
      />

      <AsyncContent state={state} skeleton={<CardSkeletonGrid count={12} />}>
        {(loaded) =>
          loaded.length ? (
            filtered.length ? (
              <div className={`${styles.grid} ${styles.artistGrid}`}>
                {filtered.map((artist, index) => (
                  <div
                    key={artist.id}
                    className={styles.gridItem}
                    style={{
                      animationDelay: `${Math.min(index * 25, 420)}ms`,
                    }}
                  >
                    <ArtistCard artist={artist} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No artists match"
                text={`Nothing found for “${query.trim()}”.`}
              />
            )
          ) : (
            <EmptyState
              title="No artists"
              text="Your server did not return any artists."
            />
          )
        }
      </AsyncContent>
    </div>
  );
}
