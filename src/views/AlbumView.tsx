import { Heart, Play, Shuffle } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { AlbumCard } from "../components/library/AlbumCard";
import { AsyncContent } from "../components/ui/AsyncContent";
import { Artwork } from "../components/ui/Artwork";
import { BackButton } from "../components/ui/BackButton";
import { ExplicitBadge } from "../components/ui/ExplicitBadge";
import { NotConfigured } from "../components/ui/NotConfigured";
import { TrackList } from "../components/library/TrackList";
import { formatDuration, isExplicit } from "../lib/format";
import { useConfigured } from "../lib/hooks";
import { api } from "../lib/ipc";
import type { Album, AlbumDetail, Song } from "../lib/types";
import { useCachedAsync } from "../lib/useAsync";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import styles from "../styles/library.module.css";
import ui from "../styles/ui.module.css";

function AlbumBody({ detail }: { detail: AlbumDetail }) {
  const { album, songs } = detail;
  const [searchParams] = useSearchParams();
  const trackParam = searchParams.get("track");
  const scrolledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!trackParam) return;
    if (scrolledRef.current === trackParam) return;

    const scrollToTrack = (attempt: number) => {
      const row = document.querySelector(
        `[data-song-id="${trackParam}"]`,
      ) as HTMLElement | null;

      if (row) {
        scrolledRef.current = trackParam;
        // Use instant scroll: smooth scrolling over hundreds of rows in a
        // content-visibility list often stops short of the target.
        row.scrollIntoView({ block: "center", behavior: "auto" });
        return;
      }

      if (attempt < 10) {
        setTimeout(() => scrollToTrack(attempt + 1), 50);
      }
    };

    // Defer past AppShell's pathname-change scroll-to-top effect and any
    // entrance animations, then try to scroll the row into view.
    requestAnimationFrame(() => {
      setTimeout(() => scrollToTrack(0), 0);
    });
  }, [trackParam, detail]);

  const playSongs = usePlayer((state) => state.playSongs);
  const playShuffled = usePlayer((state) => state.playShuffled);
  const starred = useLibrary((state) =>
    state.isStarred("album", album.id, album.starred),
  );
  const toggleStar = useLibrary((state) => state.toggleStar);

  const groups = useMemo(() => {
    const map = new Map<number, Song[]>();
    for (const song of songs) {
      const disc = song.discNumber && song.discNumber > 0 ? song.discNumber : 1;
      const list = map.get(disc);
      if (list) list.push(song);
      else map.set(disc, [song]);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [songs]);

  const total =
    album.duration ?? songs.reduce((sum, song) => sum + (song.duration ?? 0), 0);
  const multiDisc = groups.length > 1;
  const explicit =
    isExplicit({ explicitStatus: album.explicitStatus }) ||
    songs.some((song) => isExplicit(song));

  const artistId = album.artistId;
  const genre =
    album.genre?.trim() ||
    songs.find((song) => song.genre?.trim())?.genre?.trim() ||
    "";

  const artistAlbums = useCachedAsync<Album[]>(
    artistId ? `album:${album.id}:artistShelf` : null,
    () =>
      artistId
        ? api
            .getArtist(artistId)
            .then((detail) =>
              detail.albums
                .filter((item) => item.id !== album.id)
                .slice(0, 8),
            )
        : Promise.resolve([]),
    [artistId, album.id],
  );
  const genreAlbums = useCachedAsync<Album[]>(
    genre ? `album:${album.id}:genreShelf:${genre}` : null,
    () =>
      genre
        ? api.getAlbumsByGenre(genre, 12).catch(() => [] as Album[])
        : Promise.resolve([]),
    [genre],
  );

  const artistShelf = artistAlbums.data ?? [];
  const shownArtistIds = new Set(artistShelf.map((item) => item.id));
  const genreShelf = (genreAlbums.data ?? [])
    .filter((item) => item.id !== album.id && !shownArtistIds.has(item.id))
    .slice(0, 8);

  return (
    <>
      <div className={styles.hero}>
        <div className={styles.heroArt}>
          <Artwork
            coverId={album.coverArt}
            size={600}
            alt={album.name}
            eager
          />
        </div>
        <div className={styles.heroInfo}>
          <div className={styles.heroKind}>Album</div>
          <div className={styles.heroTitleRow}>
            <h1 className={styles.heroTitle}>{album.name}</h1>
            {explicit ? <ExplicitBadge /> : null}
          </div>
          <div className={styles.heroMeta}>
            {album.artist ? (
              album.artistId ? (
                <Link to={`/artists/${album.artistId}`}>{album.artist}</Link>
              ) : (
                <span>{album.artist}</span>
              )
            ) : null}
            {album.year ? (
              <>
                <span className={styles.dot} />
                <span>{album.year}</span>
              </>
            ) : null}
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
            {album.genre ? (
              <>
                <span className={styles.dot} />
                <span>{album.genre}</span>
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
            <button
              type="button"
              className={`${ui.button} ${ui.ghost}`}
              onClick={() => toggleStar("album", album.id, starred)}
              aria-pressed={starred}
            >
              <Heart size={15} fill={starred ? "currentColor" : "none"} />
              {starred ? "Favorited" : "Favorite"}
            </button>
          </div>
        </div>
      </div>

      {multiDisc ? (
        groups.map(([disc, list]) => (
          <div key={disc}>
            <div className={styles.discHead}>Disc {disc}</div>
            <TrackList songs={list} showAlbum={false} showArtwork={false} />
          </div>
        ))
      ) : (
        <TrackList songs={songs} showAlbum={false} showArtwork={false} />
      )}

      {artistShelf.length || genreShelf.length ? (
        <div className={styles.recs}>
          {artistShelf.length ? (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>
                  More by {album.artist ?? "this artist"}
                </h2>
                {artistId ? (
                  <Link
                    to={`/artists/${artistId}`}
                    className={styles.sectionLink}
                  >
                    See all
                  </Link>
                ) : null}
              </div>
              <div className={`${styles.grid} ${styles.gridWide}`}>
                {artistShelf.map((item, index) => (
                  <div
                    key={item.id}
                    className={styles.gridItem}
                    style={{
                      animationDelay: `${Math.min(index * 25, 420)}ms`,
                    }}
                  >
                    <AlbumCard album={item} />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {genreShelf.length ? (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>More {genre} albums</h2>
                <Link
                  to={`/genres/${encodeURIComponent(genre)}`}
                  className={styles.sectionLink}
                >
                  See all
                </Link>
              </div>
              <div className={`${styles.grid} ${styles.gridWide}`}>
                {genreShelf.map((item, index) => (
                  <div
                    key={item.id}
                    className={styles.gridItem}
                    style={{
                      animationDelay: `${Math.min(index * 25, 420)}ms`,
                    }}
                  >
                    <AlbumCard album={item} />
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function AlbumView() {
  const { id } = useParams<{ id: string }>();
  const configured = useConfigured();

  const state = useCachedAsync<AlbumDetail | null>(
    configured && id ? `album:detail:${id}` : null,
    () =>
      configured && id
        ? api.getAlbum(id)
        : Promise.resolve(null),
    [id, configured],
  );

  if (!configured) return <NotConfigured />;

  return (
    <div className={styles.page}>
      <BackButton to="/albums" label="Albums" />
      <AsyncContent state={state} loadingLabel="Loading album…">
        {(detail) => (detail ? <AlbumBody detail={detail} /> : null)}
      </AsyncContent>
    </div>
  );
}
