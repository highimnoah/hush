import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import { fallbackPeaks } from "../../lib/waveform";
import { usePlayer } from "../../store/player";
import { useSettings } from "../../store/settings";
import styles from "../../styles/ui.module.css";

interface WaveformSeekProps {
  value: number;
  max: number;
  onPreview?: (value: number) => void;
  onCommit?: (value: number) => void;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  height?: number;
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
}: WaveformSeekProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);

  const trackId = usePlayer((state) => state.track?.id);
  const waveform = usePlayer((state) => {
    const id = state.track?.id;
    return id ? state.waveforms[id] : undefined;
  });
  const accent = useSettings((state) => state.settings?.accent ?? "blue");

  const data = useMemo(() => {
    if (waveform && waveform.length) return waveform;
    if (trackId) return fallbackPeaks(trackId, 160);
    return new Array(120).fill(0.08);
  }, [waveform, trackId]);

  const safeMax = max > 0 ? max : 0;
  const shown = draft ?? value;
  const ratio =
    safeMax > 0 ? Math.min(1, Math.max(0, shown / safeMax)) : 0;

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

      for (let i = 0; i < count; i += 1) {
        const peak = Math.min(1, Math.max(0.03, data[i] ?? 0));
        const barHeight = Math.max(2, peak * (height - 2));
        const x = i * slot + gap / 2;
        const isPlayed = x + barWidth / 2 <= progressX;
        context.fillStyle = isPlayed ? played : unplayed;
        context.fillRect(x, middle - barHeight / 2, barWidth, barHeight);
      }
    };

    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [data, ratio, height, accent]);

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
    onPreview?.(next);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging || disabled) return;
    const next = valueFromClientX(event.clientX);
    setDraft(next);
    onPreview?.(next);
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
      onKeyDown={handleKeyDown}
    >
      <canvas ref={canvasRef} className={styles.waveformCanvas} />
    </div>
  );
}
