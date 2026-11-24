import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import { formatTime } from "../../lib/format";
import { usePlayer } from "../../store/player";
import { useSettings } from "../../store/settings";
import styles from "../../styles/ui.module.css";

const WAVEFORM_SLOTS = 240;
/** Flat, low bar shown for slots that have not been analysed yet. */
const PENDING_BAR = 0.08;

interface WaveformSeekProps {
  value: number;
  max: number;
  onPreview?: (value: number) => void;
  onCommit?: (value: number) => void;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  height?: number;
  /** Analyse this track instead of whatever is currently loaded. */
  trackId?: string;
}

/**
 * Waveform timeline used for seeking. Draws real peak data when available and
 * falls back to a deterministic placeholder while the analyser runs.
 */
export function WaveformSeek({
  value,
  max,
  onPreview,
  onCommit,
  disabled = false,
  ariaLabel,
  className = "",
  height = 36,
  trackId: forcedTrackId,
}: WaveformSeekProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const currentTrackId = usePlayer((state) => state.track?.id);
  const liveWaveform = usePlayer((state) => {
    const id = state.track?.id;
    return id ? state.waveforms[id] : undefined;
  });
  const storedWaveform = usePlayer((state) =>
    forcedTrackId ? state.waveforms[forcedTrackId] : undefined,
  );
  const trackId = forcedTrackId ?? currentTrackId;
  const waveform = forcedTrackId ? storedWaveform : liveWaveform;
  const accent = useSettings((state) => state.settings?.accent ?? "blue");
  const ensureWaveform = usePlayer((state) => state.ensureWaveform);

  const peaks = waveform?.peaks;
  const pending = Boolean(trackId) && !peaks?.length;
  const data = useMemo(() => {
    const slots = new Array<number>(WAVEFORM_SLOTS).fill(PENDING_BAR);
    if (peaks) {
      const count = Math.min(WAVEFORM_SLOTS, peaks.length);
      for (let index = 0; index < count; index += 1) {
        slots[index] = peaks[index];
      }
    }
    return slots;
  }, [peaks]);

  const safeMax = max > 0 ? max : 0;

  // Views that show a track other than the one playing (the lyrics editor)
  // ask for its analysis explicitly.
  useEffect(() => {
    if (!forcedTrackId || peaks?.length || safeMax <= 0) return;
    ensureWaveform(forcedTrackId, safeMax);
  }, [forcedTrackId, peaks, safeMax, ensureWaveform]);

  const shown = draft ?? value;
  const ratio =
    safeMax > 0 ? Math.min(1, Math.max(0, shown / safeMax)) : 0;
  const hoverValue = dragging ? draft : hover;
  const hoverRatio =
    hoverValue != null && safeMax > 0
      ? Math.min(1, Math.max(0, hoverValue / safeMax))
      : null;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    const draw = () => {
      const rect = wrapper.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.floor(width * dpr));
      const pixelHeight = Math.max(1, Math.floor(height * dpr));

      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const computed = getComputedStyle(document.documentElement);
      const played =
        computed.getPropertyValue("--accent").trim() || "#82aaff";
      const unplayed =
        computed.getPropertyValue("--border-strong").trim() || "#2c3d63";
      const progressX = ratio * width;
      const count = data.length;
      const slot = width / count;
      const gap = Math.min(2, Math.max(0.6, slot * 0.34));
      const barWidth = Math.max(0.7, slot - gap);
      const middle = height / 2;
      const hoverX = hoverRatio != null ? hoverRatio * width : null;
      const previewStart = hoverX != null ? Math.min(progressX, hoverX) : 0;
      const previewEnd = hoverX != null ? Math.max(progressX, hoverX) : 0;

      // The skip indication is drawn into the waveform itself: bars between
      // the playhead and the hovered/scrubbed position use a softer accent,
      // and the bar at the target is fully highlighted.
      for (let i = 0; i < count; i += 1) {
        const peak = Math.min(1, Math.max(0.03, data[i] ?? 0));
        const barHeight = Math.max(2, peak * (height - 2));
        const x = i * slot + gap / 2;
        const center = x + barWidth / 2;
        const isPlayed = center <= progressX;

        let fill = isPlayed ? played : unplayed;
        let alpha = 1;

        if (hoverX != null) {
          const insidePreview =
            Math.abs(hoverX - progressX) > 1 &&
            center >= previewStart &&
            center <= previewEnd;
          if (insidePreview) {
            fill = played;
            alpha = 0.55;
          }
          if (Math.abs(center - hoverX) <= Math.max(barWidth / 2, 1.5)) {
            fill = played;
            alpha = 1;
          }
        }

        context.globalAlpha = alpha;
        context.fillStyle = fill;
        context.fillRect(x, middle - barHeight / 2, barWidth, barHeight);
      }
      context.globalAlpha = 1;
    };

    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [data, ratio, hoverRatio, height, accent]);

  const valueFromClientX = (clientX: number) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return 0;
    const rect = wrapper.getBoundingClientRect();
    const fraction =
      rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return Math.min(safeMax, Math.max(0, fraction * safeMax));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || safeMax <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    const next = valueFromClientX(event.clientX);
    setDraft(next);
    setHover(next);
    onPreview?.(next);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || safeMax <= 0) return;
    const next = valueFromClientX(event.clientX);
    setHover(next);
    if (!dragging) return;
    setDraft(next);
    onPreview?.(next);
  };

  const handlePointerLeave = () => {
    if (!dragging) setHover(null);
  };

  const finish = () => {
    if (!dragging) return;
    setDragging(false);
    const next = draft ?? value;
    setDraft(null);
    onCommit?.(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || safeMax <= 0) return;
    const increment = safeMax / 100;
    let next = shown;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = Math.min(safeMax, shown + increment);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = Math.max(0, shown - increment);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = safeMax;
        break;
      default:
        return;
    }
    event.preventDefault();
    onCommit?.(next);
  };

  const classes = [
    styles.waveform,
    pending ? styles.waveformPending : "",
    disabled ? styles.waveformDisabled : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={wrapperRef}
      className={classes}
      style={{ height }}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(safeMax)}
      aria-valuenow={Math.round(shown)}
      aria-disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={handlePointerLeave}
      onKeyDown={handleKeyDown}
    >
      <canvas ref={canvasRef} className={styles.waveformCanvas} />
      {hoverRatio != null ? (
        <span
          className={styles.waveformHint}
          style={{ left: `${Math.min(96, Math.max(4, hoverRatio * 100))}%` }}
        >
          {formatTime(hoverValue ?? 0)}
        </span>
      ) : null}
    </div>
  );
}
