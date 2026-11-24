import { useEffect, useState } from "react";

import { api } from "../../lib/ipc";
import { useSettings } from "../../store/settings";
import styles from "../../styles/library.module.css";

const resolvedCache = new Map<string, string | null>();

interface ArtistAvatarProps {
  artistId: string;
  name: string;
  serverUrl?: string | null;
  className?: string;
}

/**
 * Circular artist artwork. Uses the server-provided image when available and
 * otherwise resolves a cached/fetched picture; falls back to the initial
 * letter while loading or when no image can be found.
 */
export function ArtistAvatar({
  artistId,
  name,
  serverUrl,
  className,
}: ArtistAvatarProps) {
  const mode = useSettings((state) => state.settings?.artistImages ?? "auto");
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const initial = name?.trim().charAt(0).toUpperCase() || "?";

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    if (mode === "off") {
      setSrc(null);
      return;
    }
    if (serverUrl) {
      setSrc(serverUrl);
      return;
    }
    if (mode !== "auto") {
      setSrc(null);
      return;
    }

    if (resolvedCache.has(artistId)) {
      setSrc(resolvedCache.get(artistId) ?? null);
      return;
    }

    api
      .artistImage(name)
      .then((info) => {
        const url = info?.url ?? null;
        resolvedCache.set(artistId, url);
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });

    return () => {
      cancelled = true;
    };
  }, [artistId, name, serverUrl, mode]);

  const classes = [className ?? styles.artistAvatar]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} aria-hidden="true">
      {src && !failed ? (
        <img
          className={styles.artistAvatarImage}
          src={src}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}
