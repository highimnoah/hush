import { ListMusic, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { PlaylistCard } from "../components/library/PlaylistCard";
import { AsyncContent } from "../components/ui/AsyncContent";
import { PromptDialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { NotConfigured } from "../components/ui/NotConfigured";
import { CardSkeletonGrid } from "../components/ui/States";
import { ViewSearchBar } from "../components/ui/ViewSearchBar";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import type { Playlist } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import { usePlayer } from "../store/player";
import { useToast } from "../store/toast";
import styles from "../styles/library.module.css";
import ui from "../styles/ui.module.css";

export function PlaylistsView() {
  const configured = useConfigured();
  const navigate = useNavigate();
  const toast = useToast((state) => state.show);

  const state = useAsync<Playlist[]>(
    () => (configured ? api.getPlaylists() : Promise.resolve([])),
    [configured],
  );

  const [promptOpen, setPromptOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const term = query.trim().toLowerCase();
  const playlists = state.data ?? [];
  const filtered = useMemo(() => {
    if (!term) return playlists;
    return playlists.filter((playlist) =>
      playlist.name.toLowerCase().includes(term),
    );
  }, [playlists, term]);

  const handleCreate = async (name: string) => {
    setBusy(true);
    try {
      const created = await api.createPlaylist(name, []);
      toast(`Created “${name}”`);
      setPromptOpen(false);
      if (created.playlist?.id) {
        navigate(`/playlists/${created.playlist.id}`);
      } else {
        state.reload();
      }
    } catch (err) {
      usePlayer.getState().onError(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!configured) return <NotConfigured />;

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Playlists</h1>
          <div className={styles.pageSubtitle}>
            {state.data
              ? term
                ? `${filtered.length} of ${playlists.length} playlists`
                : `${playlists.length} ${playlists.length === 1 ? "playlist" : "playlists"}`
              : "Your playlists"}
          </div>
        </div>
        <div className={styles.headActions}>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            onClick={() => setPromptOpen(true)}
          >
            <Plus size={15} />
            New playlist
          </button>
        </div>
      </div>

      <ViewSearchBar
        value={query}
        onChange={setQuery}
        placeholder="Filter playlists"
        ariaLabel="Filter playlists"
      />

      <AsyncContent state={state} skeleton={<CardSkeletonGrid count={8} />}>
        {(loaded) =>
          loaded.length ? (
            filtered.length ? (
              <div className={`${styles.grid} ${styles.gridWide}`}>
                {filtered.map((playlist) => (
                  <PlaylistCard key={playlist.id} playlist={playlist} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<ListMusic size={22} />}
                title="No playlists match"
                text={`Nothing found for “${query.trim()}”.`}
              />
            )
          ) : (
            <EmptyState
              icon={<ListMusic size={22} />}
              title="No playlists"
              text="Create one with “New playlist”, or add songs from any track's menu."
            />
          )
        }
      </AsyncContent>

      <PromptDialog
        open={promptOpen}
        title="New playlist"
        label="Playlist name"
        placeholder="Late night"
        confirmLabel="Create"
        busy={busy}
        onConfirm={(name) => void handleCreate(name)}
        onCancel={() => setPromptOpen(false)}
      />
    </div>
  );
}
