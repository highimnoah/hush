import { ArrowRight, Play, Server } from "lucide-react";
import { Link } from "react-router-dom";

import type { Album, SearchResults } from "../lib/types";
import { formatTime } from "../lib/format";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import { useAsync, type AsyncState } from "../lib/useAsync";
import { usePlayer } from "../store/player";
import { AlbumCard } from "../components/library/AlbumCard";
import { TrackList } from "../components/library/TrackList";
import { Artwork } from "../components/ui/Artwork";
import { AsyncContent } from "../components/ui/AsyncContent";
import { ErrorState } from "../components/ui/ErrorState";
import { CardSkeletonGrid } from "../components/ui/States";
import styles from "../styles/library.module.css";
import ui from "../styles/ui.module.css";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function AlbumShelf({
  title,
  state,
  allLink,
}: {
  title: string;
  state: AsyncState<Album[]>;
  allLink?: string;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {allLink ? (
          <Link to={allLink} className={styles.sectionLink}>
            See all
          </Link>
        ) : null}
      </div>
      {state.loading ? (
        <CardSkeletonGrid count={6} />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : state.data && state.data.length ? (
        <div className={styles.grid}>
          {state.data.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </div>
      ) : (
        <div className={styles.inlineLoading}>Nothing here yet.</div>
      )}
    </section>
  );
}

function ResumeCard() {
  const track = usePlayer((state) => state.track);
  const restoredPosition = usePlayer((state) => state.restoredPosition);
  const position = usePlayer((state) => state.position);
  const duration = usePlayer((state) => state.duration);
  const resume = usePlayer((state) => state.resumeRestored);

  if (!track || restoredPosition == null) return null;

  const total = duration || track.duration || 0;
  const subtitle = [track.artist, track.album].filter(Boolean).join(" · ");

  return (
    <section className={styles.resumeCard}>
      <div className={styles.resumeArt}>
        <Artwork
          src={track.coverUrl}
          coverId={track.coverArt}
          size={160}
          alt={track.album ?? ""}
        />
      </div>
      <div className={styles.resumeMain}>
        <div className={styles.resumeLabel}>Continue listening</div>
        <div className={styles.resumeTitle}>{track.title}</div>
        <div className={styles.resumeMeta}>
          {subtitle ? `${subtitle} · ` : ""}
          {formatTime(position)} / {formatTime(total)}
        </div>
      </div>
      <button
        type="button"
        className={`${ui.button} ${ui.primary}`}
        onClick={() => resume()}
      >
        <Play size={15} fill="currentColor" strokeWidth={0} />
        Resume
      </button>
    </section>
  );
}

function ConnectPrompt() {
  return (
    <div className={styles.connectWrap}>
      <div className={styles.connectCard}>
        <div className={styles.connectIcon}>
          <Server size={26} />
        </div>
        <div className={styles.connectTitle}>Connect your music</div>
        <p className={styles.connectText}>
          hush plays from Navidrome or any Subsonic-compatible server. Add your
          server details to get started.
        </p>
        <Link to="/settings" className={`${ui.button} ${ui.primary}`}>
          Open settings <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}

export function Home() {
  const configured = useConfigured();

  const newest = useAsync<Album[]>(
    () => (configured ? api.getAlbums("newest", 12) : Promise.resolve([])),
    [configured],
  );
  const recent = useAsync<Album[]>(
    () => (configured ? api.getAlbums("recent", 12) : Promise.resolve([])),
    [configured],
  );
  const picks = useAsync(
    () => (configured ? api.getRandomSongs(10) : Promise.resolve([])),
    [configured],
  );
  const mostPlayed = useAsync<Album[]>(
    () => (configured ? api.getAlbums("frequent", 12) : Promise.resolve([])),
    [configured],
  );
  const starred = useAsync<SearchResults | null>(
    () => (configured ? api.getStarred() : Promise.resolve(null)),
    [configured],
  );

  if (!configured) return <ConnectPrompt />;

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>{greeting()}</h1>
          <div className={styles.pageSubtitle}>A quiet place for your music.</div>
        </div>
      </div>

      <ResumeCard />

      <AlbumShelf title="Recently added" state={newest} allLink="/albums" />
      <AlbumShelf title="Recently played" state={recent} allLink="/albums" />
      <AlbumShelf title="Most played" state={mostPlayed} />
      {starred.loading || (starred.data?.albums.length ?? 0) > 0 ? (
        <AlbumShelf
          title="Starred albums"
          state={{
            data: starred.data?.albums ?? null,
            loading: starred.loading,
            error: starred.error,
            reload: starred.reload,
          }}
        />
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Quick picks</h2>
        </div>
        <AsyncContent state={picks} loadingLabel="Loading picks…">
          {(songs) =>
            songs.length ? (
              <TrackList
                songs={songs}
                showAlbum={false}
                showArtwork
                showHeader={false}
              />
            ) : (
              <div className={styles.inlineLoading}>No picks yet.</div>
            )
          }
        </AsyncContent>
      </section>
    </div>
  );
}
