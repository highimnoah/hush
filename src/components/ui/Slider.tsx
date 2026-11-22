import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import styles from "../../styles/ui.module.css";

interface SliderProps {
  value: number;
  max: number;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
  onPreview?: (value: number) => void;
  step?: number;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  live?: boolean;
}

/**
 * Flat, gesture-friendly slider (no gradients). When `live` is false the value
 * only commits on pointer release / key press, which keeps seeking cheap.
 */
export function Slider({
  value,
  max,
  onChange,
  onCommit,
  onPreview,
  step = 0,
  disabled = false,
  ariaLabel,
  className = "",
  live = true,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);

  const safeMax = max > 0 ? max : 0;
  const shown = draft ?? value;
  const ratio = safeMax > 0 ? Math.min(1, Math.max(0, shown / safeMax)) : 0;

  const snap = (raw: number) => {
    const clamped = Math.min(safeMax, Math.max(0, raw));
    if (step > 0) return Math.round(clamped / step) * step;
    return clamped;
  };

  const fromClientX = (clientX: number) => {
    const element = trackRef.current;
    if (!element) return 0;
    const rect = element.getBoundingClientRect();
    const ratioFromPointer =
      rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return snap(ratioFromPointer * safeMax);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || safeMax <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    const next = fromClientX(event.clientX);
    setDraft(next);
    onPreview?.(next);
    if (live) onChange?.(next);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging || disabled) return;
    const next = fromClientX(event.clientX);
    setDraft(next);
    onPreview?.(next);
    if (live) onChange?.(next);
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
    const increment = step > 0 ? step : safeMax / 50;
    let next = shown;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = snap(shown + increment);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = snap(shown - increment);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = safeMax;
        break;
      case "PageUp":
        next = snap(shown + safeMax / 10);
        break;
      case "PageDown":
        next = snap(shown - safeMax / 10);
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange?.(next);
    onCommit?.(next);
  };

  const classes = [
    styles.slider,
    dragging ? styles.sliderDragging : "",
    disabled ? styles.sliderDisabled : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={trackRef}
      className={classes}
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
      <div className={styles.sliderTrack}>
        <div
          className={styles.sliderFill}
          style={{ width: `${ratio * 100}%` }}
        />
        <div
          className={styles.sliderThumb}
          style={{ left: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
