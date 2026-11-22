import { useState } from "react";

import { AlbumCard } from "../components/library/AlbumCard";
import { AsyncContent } from "../components/ui/AsyncContent";
import { EmptyState } from "../components/ui/EmptyState";
import { CardSkeletonGrid } from "../components/ui/States";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import type { Album } from "../lib/types";
import { useAsync } from "../lib/useAsync";
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

  const state = useAsync<Album[]>(
    () => (configured ? api.getAlbums(sort, 120) : Promise.resolve([])),
    [sort, configured],
  );

  if (!configured) return <NotConfigured />;

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Albums</h1>
          <div className={styles.pageSubtitle}>Browse your collection</div>
        </div>
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
      </div>

      <AsyncContent state={state} skeleton={<CardSkeletonGrid count={12} />}>
        {(albums) =>
          albums.length ? (
            <div className={`${styles.grid} ${styles.gridWide}`}>
              {albums.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
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
