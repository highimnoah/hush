import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../lib/ipc";
import type { LyricLine, Lyrics } from "../../lib/types";
import { usePlayer } from "../../store/player";
import styles from "../../styles/player.module.css";

const cache = new Map<string, Lyrics>();

function normalizeLines(
  lyrics: Lyrics | null,
  duration: number,
): LyricLine[] {
  if (!lyrics?.synced?.length) return [];
  const lines = [...lyrics.synced].sort((a, b) => a.startMs - b.startMs);
  const max = lines.reduce((value, line) => Math.max(value, line.startMs), 0);
  const durationMs = duration * 1000;
  // Some servers report line starts in 10 ms ticks instead of milliseconds.
  // If the whole lyric sheet fits into a small fraction of the track, rescale.
  if (durationMs > 0 && max > 0 && max * 20 < durationMs) {
    return lines.map((line) => ({ ...line, startMs: line.startMs * 100 }));
  }
  return lines;
}

interface LyricsPanelProps {
  trackId: string;
  className?: string;
}

/** Plain or synced lyrics for the current track. */
export function LyricsPanel({ trackId, className = "" }: LyricsPanelProps) {
  const position = usePlayer((state) => state.position);
  const duration = usePlayer((state) => state.duration);
  const seek = usePlayer((state) => state.seek);

  const [lyrics, setLyrics] = useState<Lyrics | null>(
    () => cache.get(trackId) ?? null,
  );
  const [loading, setLoading] = useState(!cache.has(trackId));
  const [error, setError] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = cache.get(trackId);
    if (cached) {
      setLyrics(cached);
      setLoading(false);
      setError(null);
      return;
    }

    setLyrics(null);
    setLoading(true);
    setError(null);

    api
      .getLyrics(trackId)
      .then((value) => {
        cache.set(trackId, value);
        if (!cancelled) setLyrics(value);
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
  }, [trackId]);

  const lines = useMemo(
    () => normalizeLines(lyrics, duration),
    [lyrics, duration],
  );

  const activeIndex = useMemo(() => {
    if (!lines.length) return -1;
    const ms = position * 1000;
    let index = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].startMs <= ms) index = i;
      else break;
    }
    return index;
  }, [lines, position]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const active = activeRef.current;
    if (!scroller || !active || activeIndex < 0) return;
    const target = active.offsetTop - scroller.clientHeight * 0.38;
    scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [activeIndex]);

  if (loading) {
    return <div className={styles.lyricsEmpty}>Loading lyrics…</div>;
  }
  if (error) {
    return <div className={styles.lyricsEmpty}>{error}</div>;
  }

  if (lines.length) {
    return (
      <div className={`${styles.lyricsScroll} ${className}`} ref={scrollerRef}>
        <div className={styles.lyricsLines}>
          {lines.map((line, index) => (
            <button
              key={`${line.startMs}-${index}`}
              ref={index === activeIndex ? activeRef : undefined}
              type="button"
              className={`${styles.lyricLine} ${
                index === activeIndex ? styles.lyricLineActive : ""
              } ${index < activeIndex ? styles.lyricLinePast : ""}`}
              onClick={() => seek(line.startMs / 1000)}
            >
              {line.text || "…"}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (lyrics?.plain) {
    return (
      <div className={`${styles.lyricsScroll} ${className}`} ref={scrollerRef}>
        <div className={styles.lyricsPlain}>{lyrics.plain}</div>
      </div>
    );
  }

  return <div className={styles.lyricsEmpty}>No lyrics for this track.</div>;
}
