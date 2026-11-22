import { Play, Shuffle } from "lucide-react";
import { useParams } from "react-router-dom";

import { TrackList } from "../components/library/TrackList";
import { AsyncContent } from "../components/ui/AsyncContent";
import { Artwork } from "../components/ui/Artwork";
import { NotConfigured } from "../components/ui/NotConfigured";
import { formatDuration } from "../lib/format";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import type { PlaylistDetail } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import { usePlayer } from "../store/player";
import styles from "../styles/library.module.css";
import ui from "../styles/ui.module.css";

function PlaylistBody({ detail }: { detail: PlaylistDetail }) {
  const { playlist, songs } = detail;
  const playSongs = usePlayer((state) => state.playSongs);
  const playShuffled = usePlayer((state) => state.playShuffled);

  const total =
    playlist.duration ??
    songs.reduce((sum, song) => sum + (song.duration ?? 0), 0);

  return (
    <>
      <div className={styles.hero}>
        <div className={styles.heroArt}>
          <Artwork
            coverId={playlist.coverArt}
            size={600}
            alt={playlist.name}
          />
        </div>
        <div className={styles.heroInfo}>
          <div className={styles.heroKind}>Playlist</div>
          <h1 className={styles.heroTitle}>{playlist.name}</h1>
          <div className={styles.heroMeta}>
            {playlist.owner ? <span>{playlist.owner}</span> : null}
            <span className={styles.dot} />
            <span>
              {songs.length} {songs.length === 1 ? "song" : "songs"}
            </span>
            {total ? (
              <>
                <span className={styles.dot} />
                <span>{formatDuration(total)}</span>
              </>
            ) : null}
          </div>
          {playlist.comment ? (
            <p className={styles.pageSubtitle}>{playlist.comment}</p>
          ) : null}
          <div className={styles.heroActions}>
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
      </div>

      {songs.length ? (
        <TrackList songs={songs} showAlbum showArtwork />
      ) : (
        <div className={styles.inlineLoading}>This playlist is empty.</div>
      )}
    </>
  );
}

export function PlaylistView() {
  const { id } = useParams<{ id: string }>();
  const configured = useConfigured();

  const state = useAsync<PlaylistDetail | null>(
    () => (configured && id ? api.getPlaylist(id) : Promise.resolve(null)),
    [id, configured],
  );

  if (!configured) return <NotConfigured />;

  return (
    <div className={styles.page}>
      <AsyncContent state={state} loadingLabel="Loading playlist…">
        {(detail) => (detail ? <PlaylistBody detail={detail} /> : null)}
      </AsyncContent>
    </div>
  );
}
