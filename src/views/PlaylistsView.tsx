import { ListMusic } from "lucide-react";

import { PlaylistCard } from "../components/library/PlaylistCard";
import { AsyncContent } from "../components/ui/AsyncContent";
import { EmptyState } from "../components/ui/EmptyState";
import { NotConfigured } from "../components/ui/NotConfigured";
import { CardSkeletonGrid } from "../components/ui/States";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import type { Playlist } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import styles from "../styles/library.module.css";

export function PlaylistsView() {
  const configured = useConfigured();

  const state = useAsync<Playlist[]>(
    () => (configured ? api.getPlaylists() : Promise.resolve([])),
    [configured],
  );

  if (!configured) return <NotConfigured />;

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Playlists</h1>
          <div className={styles.pageSubtitle}>
            {state.data
              ? `${state.data.length} ${state.data.length === 1 ? "playlist" : "playlists"}`
              : "Your playlists"}
          </div>
        </div>
      </div>

      <AsyncContent state={state} skeleton={<CardSkeletonGrid count={8} />}>
        {(playlists) =>
          playlists.length ? (
            <div className={`${styles.grid} ${styles.gridWide}`}>
              {playlists.map((playlist) => (
                <PlaylistCard key={playlist.id} playlist={playlist} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<ListMusic size={22} />}
              title="No playlists"
              text="Create playlists in Navidrome and they will appear here."
            />
          )
        }
      </AsyncContent>
    </div>
  );
}
