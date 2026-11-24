import { Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { usePlayer } from "../../store/player";
import ui from "../../styles/ui.module.css";
import { Slider } from "./Slider";

interface VolumeControlProps {
  className?: string;
  sliderClassName?: string;
  buttonClassName?: string;
  sliderWrapClassName?: string;
}

const HIDE_DELAY_MS = 900;
const WHEEL_STEP = 0.05;

/**
 * Volume slider used by the player bar and the fullscreen view: scrolling over
 * the slider steps the volume and a transient percentage chip appears whenever
 * the volume changes (pointer, wheel or keyboard).
 */
export function VolumeControl({
  className = "",
  sliderClassName = "",
  buttonClassName = "",
  sliderWrapClassName = "",
}: VolumeControlProps) {
  const volume = usePlayer((state) => state.volume);
  const muted = usePlayer((state) => state.muted);
  const setVolume = usePlayer((state) => state.setVolume);
  const toggleMute = usePlayer((state) => state.toggleMute);

  const wrapRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const firstRender = useRef(true);
  const [showPercent, setShowPercent] = useState(false);

  const flash = () => {
    setShowPercent(true);
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      setShowPercent(false);
    }, HIDE_DELAY_MS);
  };

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    flash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume]);

  useEffect(() => {
    return () => {
      if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;

    // React's onWheel is passive; a native listener is needed to stop the
    // surrounding page from scrolling while the volume changes.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      const state = usePlayer.getState();
      state.setVolume(
        Math.min(1, Math.max(0, state.volume + direction * WHEEL_STEP)),
      );
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const percent = Math.round(volume * 100);
  const icon =
    muted || volume === 0 ? (
      <VolumeX size={17} />
    ) : volume < 0.5 ? (
      <Volume1 size={17} />
    ) : (
      <Volume2 size={17} />
    );

  const rootClasses = [ui.volumeControl, className].filter(Boolean).join(" ");
  const wrapClasses = [ui.volumeSliderWrap, sliderWrapClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClasses}>
      <button
        type="button"
        className={buttonClassName}
        onClick={() => toggleMute()}
        aria-label={muted ? "Unmute" : "Mute"}
        title={`${percent}% — ${muted ? "unmute" : "mute"}`}
      >
        {icon}
      </button>
      <div className={wrapClasses} ref={wrapRef}>
        <Slider
          className={sliderClassName}
          value={volume}
          max={1}
          step={0.01}
          ariaLabel={`Volume ${percent}%`}
          onChange={(value) => setVolume(value)}
        />
        {showPercent ? (
          <span className={ui.volumePercent}>{percent}%</span>
        ) : null}
      </div>
    </div>
  );
}
