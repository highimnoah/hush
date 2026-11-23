import { Music2 } from "lucide-react";
import { Link } from "react-router-dom";

import { AsyncContent } from "../components/ui/AsyncContent";
import { EmptyState } from "../components/ui/EmptyState";
import { NotConfigured } from "../components/ui/NotConfigured";
import { CardSkeletonGrid } from "../components/ui/States";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import type { Genre } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import styles from "../styles/library.module.css";

export function GenresView() {
  const configured = useConfigured();

  const state = useAsync<Genre[]>(
    () => (configured ? api.getGenres() : Promise.resolve([])),
    [configured],
  );

  if (!configured) return <NotConfigured />;

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Genres</h1>
          <div className={styles.pageSubtitle}>
            {state.data
              ? `${state.data.length} ${state.data.length === 1 ? "genre" : "genres"}`
              : "Browse your library by genre"}
          </div>
        </div>
      </div>

      <AsyncContent state={state} skeleton={<CardSkeletonGrid count={12} />}>
        {(genres) => {
          const sorted = [...genres].sort((a, b) =>
            a.value.localeCompare(b.value),
          );
          return sorted.length ? (
            <div className={styles.genreGrid}>
              {sorted.map((genre) => (
                <Link
                  key={genre.value}
                  to={`/genres/${encodeURIComponent(genre.value)}`}
                  className={styles.genrePill}
                >
                  <span>{genre.value}</span>
                  {genre.songCount ? (
                    <span className={styles.genreCount}>
                      {genre.songCount}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Music2 size={22} />}
              title="No genres"
              text="Your server did not return any genres."
            />
          );
        }}
      </AsyncContent>
    </div>
  );
}
