import { Play, Shuffle } from "lucide-react";
import { useEffect, useState } from "react";

import { TrackList } from "../components/library/TrackList";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Loading } from "../components/ui/States";
import { NotConfigured } from "../components/ui/NotConfigured";
import { ViewSearchBar } from "../components/ui/ViewSearchBar";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import type { Song } from "../lib/types";
import { useDebounced } from "../lib/useAsync";
import { usePlayer } from "../store/player";
import styles from "../styles/library.module.css";
import ui from "../styles/ui.module.css";

const PAGE_SIZE = 200;

export function SongsView() {
  const configured = useConfigured();
  const playSongs = usePlayer((state) => state.playSongs);
  const playShuffled = usePlayer((state) => state.playShuffled);

  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 300);
  const term = debounced.trim();

  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!configured) {
      setSongs([]);
      setDone(true);
      return;
    }

    setLoading(true);
    setError(null);
    setSongs([]);
    setDone(false);

    api
      .getSongsPage(term, PAGE_SIZE, 0)
      .then((page) => {
        if (cancelled) return;
        setSongs(page);
        setDone(page.length < PAGE_SIZE);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [term, configured, reloadKey]);

  const loadMore = async () => {
    if (loading || loadingMore || done) return;
    setLoadingMore(true);
    try {
      const page = await api.getSongsPage(term, PAGE_SIZE, songs.length);
      setSongs((current) => [...current, ...page]);
      setDone(page.length < PAGE_SIZE);
    } catch (err) {
      usePlayer.getState().onError(String(err));
    } finally {
      setLoadingMore(false);
    }
  };

  if (!configured) return <NotConfigured />;

  const subtitle = loading
    ? "Loading songs…"
    : `${songs.length}${done ? "" : "+"} ${songs.length === 1 ? "song" : "songs"}`;

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Songs</h1>
          <div className={styles.pageSubtitle}>{subtitle}</div>
        </div>
        <div className={styles.headActions}>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            onClick={() => playSongs(songs, 0)}
            disabled={!songs.length}
          >
            <Play size={15} fill="currentColor" strokeWidth={0} />
            Play
          </button>
          <button
            type="button"
            className={`${ui.button} ${ui.ghost}`}
            onClick={() => playShuffled(songs, 0)}
            disabled={!songs.length}
          >
            <Shuffle size={15} />
            Shuffle
          </button>
        </div>
      </div>

      <ViewSearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search songs, artists or albums"
        ariaLabel="Search songs"
      />

      {error ? (
        <ErrorState
          message={error}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      ) : loading ? (
        <Loading label="Loading songs…" />
      ) : songs.length ? (
        <>
          <TrackList songs={songs} showAlbum showArtwork />
          {!done ? (
            <div className={styles.loadMore}>
              <button
                type="button"
                className={`${ui.button} ${ui.ghost}`}
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more songs"}
              </button>
            </div>
          ) : null}
        </>
      ) : term ? (
        <EmptyState
          title="No songs match"
          text={`Nothing found for “${term}”. Try a different title, artist or album.`}
        />
      ) : (
        <EmptyState
          title="No songs"
          text="Your server did not return any songs. Some older servers require a search term."
        />
      )}
    </div>
  );
}
