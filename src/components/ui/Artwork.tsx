import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Music2 } from "lucide-react";

import { api } from "../../lib/ipc";
import styles from "./Artwork.module.css";

interface ArtworkProps {
  coverId?: string | null;
  src?: string | null;
  alt?: string;
  size?: number;
  className?: string;
  rounded?: "sm" | "md" | "lg" | "full";
  eager?: boolean;
  style?: CSSProperties;
}

export function Artwork({
  coverId,
  src,
  alt = "",
  size = 300,
  className = "",
  rounded = "md",
  eager = false,
  style,
}: ArtworkProps) {
  const [resolved, setResolved] = useState<string | null>(src ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    if (src) {
      setResolved(src);
      return;
    }
    if (!coverId) {
      setResolved(null);
      return;
    }

    api
      .getCoverArtUrl(coverId, size)
      .then((url) => {
        if (!cancelled) setResolved(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [coverId, src, size]);

  const classes = [styles.artwork, styles[rounded], className]
    .filter(Boolean)
    .join(" ");

  if (!resolved || failed) {
    return (
      <div
        className={`${classes} ${styles.placeholder}`}
        style={style}
        aria-hidden="true"
      >
        <Music2 size={Math.max(16, Math.min(40, Math.round(size / 8)))} />
      </div>
    );
  }

  return (
    <img
      className={classes}
      style={style}
      src={resolved}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}
