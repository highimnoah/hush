import { Disc3 } from "lucide-react";

import { Slider } from "../../components/ui/Slider";
import { Switch } from "../../components/ui/Switch";
import type { ReplayGainMode, Settings, TransitionMode } from "../../lib/types";
import ui from "../../styles/ui.module.css";
import styles from "../../styles/settings.module.css";

const REPLAYGAIN_LABELS: Record<ReplayGainMode, string> = {
  off: "Off",
  track: "Track",
  album: "Album",
};

interface PlaybackSectionProps {
  form: Settings;
  update: (patch: Partial<Settings>) => void;
}

export function PlaybackSection({ form, update }: PlaybackSectionProps) {
  return (
    <div className={styles.stack}>
      <div className={styles.replaygainRow}>
        <div>
          <div className={styles.rowLabel}>ReplayGain</div>
          <div className={styles.rowHint}>
            Off, per-track gain, or per-album gain.
          </div>
        </div>
        <div className={ui.segmented}>
          {(["off", "track", "album"] as ReplayGainMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`${ui.segment} ${form.replaygain === mode ? ui.segmentActive : ""}`}
              onClick={() => update({ replaygain: mode })}
            >
              {REPLAYGAIN_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className={styles.rowBetween}>
          <div>
            <div className={styles.rowLabel}>ReplayGain pre-amp</div>
            <div className={styles.rowHint}>
              Extra headroom or gain applied on top of ReplayGain.
            </div>
          </div>
          <span className={styles.preampValue}>
            {form.replaygainPreamp > 0 ? "+" : ""}
            {form.replaygainPreamp.toFixed(0)} dB
          </span>
        </div>
        <Slider
          value={form.replaygainPreamp + 12}
          max={24}
          step={1}
          ariaLabel="ReplayGain pre-amp"
          onChange={(value) =>
            update({ replaygainPreamp: Math.round(value - 12) })
          }
        />
      </div>

      <div>
        <div className={styles.rowBetween}>
          <div>
            <div className={styles.rowLabel}>Visualizer high boost</div>
            <div className={styles.rowHint}>
              Extra high-frequency emphasis for the playing-track spectrum bars.
            </div>
          </div>
          <span className={styles.preampValue}>
            {form.spectrumBoost > 0 ? "+" : ""}
            {form.spectrumBoost.toFixed(0)} dB
          </span>
        </div>
        <Slider
          value={form.spectrumBoost}
          max={36}
          step={1}
          ariaLabel="Visualizer high boost"
          onChange={(value) => update({ spectrumBoost: Math.round(value) })}
        />
      </div>

      <div className={styles.rowBetween}>
        <div>
          <div className={styles.rowLabel}>Track transitions</div>
          <div className={styles.rowHint}>
            Gapless for album listening, or a short fade at each boundary.
          </div>
        </div>
        <div className={ui.segmented}>
          {(["gapless", "fade"] as TransitionMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`${ui.segment} ${form.transitionMode === mode ? ui.segmentActive : ""}`}
              onClick={() => update({ transitionMode: mode })}
            >
              {mode === "gapless" ? "Gapless" : "Fade"}
            </button>
          ))}
        </div>
      </div>

      {form.transitionMode === "fade" ? (
        <div>
          <div className={styles.rowBetween}>
            <div>
              <div className={styles.rowLabel}>Fade length</div>
              <div className={styles.rowHint}>
                How long the volume ramp lasts at each track boundary.
              </div>
            </div>
            <span className={styles.preampValue}>{form.fadeSeconds}s</span>
          </div>
          <Slider
            value={Math.max(0, form.fadeSeconds - 1)}
            max={7}
            step={1}
            ariaLabel="Fade length"
            onChange={(value) =>
              update({ fadeSeconds: Math.round(value) + 1 })
            }
          />
        </div>
      ) : null}

      <div className={styles.rowBetween}>
        <div>
          <div className={styles.rowLabel}>Resume on launch</div>
          <div className={styles.rowHint}>
            Restore the last queue, track and position, and start playing
            automatically.
          </div>
        </div>
        <Switch
          checked={form.resumePlayback}
          onChange={(value) => update({ resumePlayback: value })}
          label="Resume playback on launch"
        />
      </div>

      <div className={styles.rowBetween}>
        <div>
          <div className={styles.rowLabel}>LRCLIB lyrics</div>
          <div className={styles.rowHint}>
            Look up synced lyrics on lrclib.net before asking the server.
            Lyrics you save locally always take priority.
          </div>
        </div>
        <Switch
          checked={form.lrclibLyrics}
          onChange={(value) => update({ lrclibLyrics: value })}
          label="Use LRCLIB for lyrics"
        />
      </div>
    </div>
  );
}

export function PlaybackIcon() {
  return <Disc3 size={18} />;
}
