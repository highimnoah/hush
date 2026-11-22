import { ArtistCard } from "../components/library/ArtistCard";
import { AsyncContent } from "../components/ui/AsyncContent";
import { EmptyState } from "../components/ui/EmptyState";
import { NotConfigured } from "../components/ui/NotConfigured";
import { CardSkeletonGrid } from "../components/ui/States";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import type { Artist } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import styles from "../styles/library.module.css";

export function ArtistsView() {
  const configured = useConfigured();

  const state = useAsync<Artist[]>(
    () => (configured ? api.getArtists() : Promise.resolve([])),
    [configured],
  );

  if (!configured) return <NotConfigured />;

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Artists</h1>
          <div className={styles.pageSubtitle}>
            {state.data ? `${state.data.length} artists` : "Your library"}
          </div>
        </div>
      </div>

      <AsyncContent state={state} skeleton={<CardSkeletonGrid count={12} />}>
        {(artists) =>
          artists.length ? (
            <div className={`${styles.grid} ${styles.artistGrid}`}>
              {artists.map((artist) => (
                <ArtistCard key={artist.id} artist={artist} />
              ))}
            </div>
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
