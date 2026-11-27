import { Users } from "lucide-react";

import { formatBytes } from "../../lib/format";
import type { ArtistImageCacheInfo, ArtistImageMode, Settings } from "../../lib/types";
import ui from "../../styles/ui.module.css";
import styles from "../../styles/settings.module.css";

interface ArtistImagesSectionProps {
  form: Settings;
  update: (patch: Partial<Settings>) => void;
  artistCache: ArtistImageCacheInfo | null;
  clearingCache: boolean;
  onClearCache: () => void;
}

export function ArtistImagesSection({
  form,
  update,
  artistCache,
  clearingCache,
  onClearCache,
}: ArtistImagesSectionProps) {
  return (
    <div className={styles.stack}>
      <div className={styles.rowBetween}>
        <div>
          <div className={styles.rowLabel}>Artwork source</div>
          <div className={styles.rowHint}>
            Off hides artist pictures, Server uses only images from your
            music server, Automatic also downloads missing ones.
          </div>
        </div>
        <div className={ui.segmented}>
          {(["off", "server", "auto"] as ArtistImageMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`${ui.segment} ${form.artistImages === mode ? ui.segmentActive : ""}`}
              onClick={() => update({ artistImages: mode })}
            >
              {mode === "off"
                ? "Off"
                : mode === "server"
                  ? "Server"
                  : "Automatic"}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.rowBetween}>
        <div>
          <div className={styles.rowLabel}>Cached images</div>
          <div className={styles.rowHint}>
            {artistCache
              ? `${artistCache.count} ${
                  artistCache.count === 1 ? "image" : "images"
                } · ${formatBytes(artistCache.bytes) ?? "0 B"}`
              : "Checking cache…"}
          </div>
        </div>
        <button
          type="button"
          className={`${ui.button} ${ui.ghost}`}
          onClick={() => void onClearCache()}
          disabled={clearingCache || !artistCache?.count}
        >
          {clearingCache ? "Clearing…" : "Clear cache"}
        </button>
      </div>

      <p className={styles.help} style={{ marginTop: 2 }}>
        Automatic lookups send only the artist name to Deezer/iTunes.
        Downloaded pictures are cached locally and served to the app from
        the cache.
      </p>
    </div>
  );
}

export function ArtistImagesIcon() {
  return <Users size={18} />;
}
