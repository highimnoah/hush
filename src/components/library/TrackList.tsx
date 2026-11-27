import { Heart, MoreHorizontal, Play } from "lucide-react";
import {
  memo,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";

import { formatTime, isExplicit } from "../../lib/format";
import type { Song } from "../../lib/types";
import { useContextMenu } from "../../store/contextMenu";
import { useLibrary } from "../../store/library";
import { usePlayer } from "../../store/player";
import styles from "../../styles/library.module.css";
import { Artwork } from "../ui/Artwork";
import { ExplicitBadge } from "../ui/ExplicitBadge";

function Equalizer({ playing }: { playing: boolean }) {
  return (
    <div
      className={`${styles.eq} ${playing ? "" : styles.eqPaused}`}
      aria-hidden="true"
    >
      <span />
      <span />
      <span />
    </div>
  );
}

interface TrackRowProps {
  song: Song;
  index: number;
  showArtwork: boolean;
  showAlbum: boolean;
  columns: string;
  draggable: boolean;
  dragOver: boolean;
  animate: boolean;
  onPlay: () => void;
  onMore: (x: number, y: number) => void;
  onDragStart: () => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

const TrackRow = memo(function TrackRow({
  song,
  index,
  showArtwork,
  showAlbum,
  columns,
  draggable,
  dragOver,
  animate,
  onPlay,
  onMore,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: TrackRowProps) {
  const active = usePlayer((state) => state.track?.id === song.id);
  const playing = usePlayer(
    (state) => state.track?.id === song.id && state.status === "playing",
  );
  const starred = useLibrary((state) =>
    state.isStarred("song", song.id, song.starred),
  );
  const toggleStar = useLibrary((state) => state.toggleStar);

  return (
    <div
      className={`${styles.row} ${columns} ${active ? styles.rowActive : ""} ${
        dragOver ? styles.rowDragOver : ""
      } ${animate ? styles.rowAnimated : ""}`}
      style={
        animate ? { animationDelay: `${Math.min(index * 18, 360)}ms` } : undefined
      }
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      onDoubleClick={onPlay}
      onContextMenu={(event: MouseEvent) => {
        event.preventDefault();
        onMore(event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        className={styles.index}
        onClick={onPlay}
        aria-label={`Play ${song.title}`}
        title="Play"
      >
        {playing ? (
          <Equalizer playing />
        ) : (
          <>
            <span className={styles.indexNumber}>{index}</span>
            <Play
              size={13}
              className={styles.indexPlay}
              fill="currentColor"
              strokeWidth={0}
            />
          </>
        )}
      </button>

      {showArtwork ? (
        <Artwork
          coverId={song.coverArt}
          size={80}
          rounded="sm"
          className={styles.rowArt}
          style={{ width: 42, height: 42, flexShrink: 0 }}
        />
      ) : null}

      <div className={styles.main}>
        <div className={styles.titleRow}>
          <span className={styles.title} title={song.title}>
            {song.title || "Unknown title"}
          </span>
          {isExplicit(song) ? <ExplicitBadge /> : null}
        </div>
        {song.artist ? (
          <div className={styles.sub} title={song.artist}>
            {song.artist}
          </div>
        ) : null}
      </div>

      {showAlbum ? (
        <div className={styles.albumCell} title={song.album ?? ""}>
          {song.album ?? "—"}
        </div>
      ) : null}

      <button
        type="button"
        className={`${styles.like} ${starred ? styles.likeActive : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          toggleStar("song", song.id, starred);
        }}
        aria-label={starred ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={starred}
        title={starred ? "Remove from favorites" : "Add to favorites"}
      >
        <Heart size={15} fill={starred ? "currentColor" : "none"} />
      </button>

      <div className={styles.duration}>{formatTime(song.duration)}</div>

      <button
        type="button"
        className={styles.more}
        aria-label="More options"
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          onMore(rect.left, rect.bottom + 4);
        }}
      >
        <MoreHorizontal size={16} />
      </button>
    </div>
  );
});

const VIRTUAL_ROW_HEIGHT = 58;
const VIRTUAL_OVERSCAN = 8;

function useVirtualRange(itemCount: number) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: itemCount - 1 });

  useEffect(() => {
    const main = document.querySelector("[data-main]");
    if (!main) return;

    const compute = () => {
      const body = bodyRef.current;
      if (!body) return;
      const mainEl = main as HTMLElement;
      const scrollTop = mainEl.scrollTop;
      const bodyTop = body.offsetTop;
      const visibleTop = scrollTop - bodyTop;
      const visibleHeight = mainEl.clientHeight;
      const start = Math.max(
        0,
        Math.floor(visibleTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN,
      );
      const end = Math.min(
        itemCount - 1,
        Math.ceil((visibleTop + visibleHeight) / VIRTUAL_ROW_HEIGHT) +
          VIRTUAL_OVERSCAN,
      );
      setRange((current) =>
        current.start === start && current.end === end
          ? current
          : { start, end },
      );
    };

    compute();
    main.addEventListener("scroll", compute, { passive: true });
    window.addEventListener("resize", compute);
    return () => {
      main.removeEventListener("scroll", compute);
      window.removeEventListener("resize", compute);
    };
  }, [itemCount]);

  return { bodyRef, range };
}

interface TrackListProps {
  songs: Song[];
  showArtwork?: boolean;
  showAlbum?: boolean;
  showHeader?: boolean;
  startNumber?: number;
  className?: string;
  /** Animate rows in with a top-to-bottom stagger. */
  animate?: boolean;
  /** Render only the visible slice of a long list. Disabled for drag/drop. */
  virtualize?: boolean;
  /** When provided, rows become draggable and reorderable. */
  onMove?: (from: number, to: number) => void;
  /** Override the context-menu handler (defaults to the global song menu). */
  onMore?: (song: Song, x: number, y: number, index: number) => void;
}

export function TrackList({
  songs,
  showArtwork = true,
  showAlbum = true,
  showHeader = true,
  startNumber = 1,
  className = "",
  animate = false,
  virtualize = false,
  onMove,
  onMore,
}: TrackListProps) {
  const playSongs = usePlayer((state) => state.playSongs);
  const openMenu = useContextMenu((state) => state.open);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const handleDrop = (target: number) => {
    if (dragIndex != null && dragIndex !== target) {
      onMove?.(dragIndex, target);
    }
    setDragIndex(null);
    setOverIndex(null);
  };

  const columns =
    !showArtwork && !showAlbum
      ? styles.columnsMinimal
      : !showArtwork
        ? styles.columnsNoArt
        : !showAlbum
          ? styles.columnsNoAlbum
          : styles.columnsFull;

  const enableVirtual = virtualize && !onMove && songs.length > 40;
  const { bodyRef, range } = useVirtualRange(
    enableVirtual ? songs.length : 0,
  );

  const renderRow = (song: Song, index: number) => {
    const absoluteIndex = startNumber + index;
    return (
      <TrackRow
        key={`${song.id}-${index}`}
        song={song}
        index={absoluteIndex}
        showArtwork={showArtwork}
        showAlbum={showAlbum}
        columns={columns}
        draggable={Boolean(onMove)}
        dragOver={overIndex === index && dragIndex !== index}
        animate={animate}
        onPlay={() => playSongs(songs, index)}
        onMore={(x, y) =>
          onMore ? onMore(song, x, y, index) : openMenu(song, x, y)
        }
        onDragStart={() => setDragIndex(index)}
        onDragOver={(event) => {
          if (!onMove) return;
          event.preventDefault();
          setOverIndex(index);
        }}
        onDrop={() => handleDrop(index)}
        onDragEnd={() => {
          setDragIndex(null);
          setOverIndex(null);
        }}
      />
    );
  };

  const header = showHeader ? (
    <div className={`${styles.trackHeader} ${columns}`}>
      <div className={styles.colIndex}>#</div>
      {showArtwork ? <div /> : null}
      <div>Title</div>
      {showAlbum ? <div>Album</div> : null}
      <div />
      <div className={styles.colDuration}>Time</div>
      <div />
    </div>
  ) : null;

  return (
    <div className={`${styles.trackList} ${className}`}>
      {header}
      {enableVirtual ? (
        <div
          ref={bodyRef}
          className={styles.virtualBody}
          style={{ height: songs.length * VIRTUAL_ROW_HEIGHT }}
        >
          <div
            className={styles.virtualInner}
            style={{ top: range.start * VIRTUAL_ROW_HEIGHT }}
          >
            {songs.slice(range.start, range.end + 1).map((song, offset) =>
              renderRow(song, range.start + offset),
            )}
          </div>
        </div>
      ) : (
        songs.map((song, index) => renderRow(song, index))
      )}
    </div>
  );
}
