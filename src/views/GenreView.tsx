import { Play, Shuffle } from "lucide-react";
import { useParams } from "react-router-dom";

import { AlbumCard } from "../components/library/AlbumCard";
import { TrackList } from "../components/library/TrackList";
import { EmptyState } from "../components/ui/EmptyState";
import { NotConfigured } from "../components/ui/NotConfigured";
import { Loading } from "../components/ui/States";
import { formatDuration } from "../lib/format";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import type { Album, Song } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import { usePlayer } from "../store/player";
import styles from "../styles/library.module.css";
import ui from "../styles/ui.module.css";

function GenreBody({
  genre,
  songs,
  albums,
}: {
  genre: string;
  songs: Song[];
  albums: Album[];
}) {
  const playSongs = usePlayer((state) => state.playSongs);
  const playShuffled = usePlayer((state) => state.playShuffled);

  const total = songs.reduce((sum, song) => sum + (song.duration ?? 0), 0);

  return (
    <>
      <div className={styles.hero}>
        <div className={styles.heroInfo}>
          <div className={styles.heroKind}>Genre</div>
          <h1 className={styles.heroTitle}>{genre}</h1>
          <div className={styles.heroMeta}>
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

      {albums.length ? (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Albums</h2>
          </div>
          <div className={styles.grid}>
            {albums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        </section>
      ) : null}

      {songs.length ? (
        <TrackList songs={songs} showAlbum showArtwork />
      ) : (
        <EmptyState
          title="No songs"
          text="This genre has no songs on your server."
        />
      )}
    </>
  );
}

export function GenreView() {
  const { name = "" } = useParams<{ name: string }>();
  const configured = useConfigured();

  const songs = useAsync<Song[]>(
    () =>
      configured ? api.getSongsByGenre(name, 200) : Promise.resolve([]),
    [name, configured],
  );
  const albums = useAsync<Album[]>(
    () =>
      configured
        ? api.getAlbumsByGenre(name, 40).catch(() => [] as Album[])
        : Promise.resolve([]),
    [name, configured],
  );

  if (!configured) return <NotConfigured />;

  return (
    <div className={styles.page}>
      {songs.loading || albums.loading ? (
        <Loading label="Loading genre…" />
      ) : songs.error ? (
        <EmptyState title="Could not load genre" text={songs.error} />
      ) : (
        <GenreBody
          genre={name}
          songs={songs.data ?? []}
          albums={albums.data ?? []}
        />
      )}
    </div>
  );
}
