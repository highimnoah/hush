import styles from "../../styles/ui.module.css";

export function Spinner() {
  return <div className={styles.spinner} aria-hidden="true" />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className={styles.loadingWrap} role="status" aria-live="polite">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({
  height,
  width,
  radius,
  className = "",
}: {
  height?: number | string;
  width?: number | string;
  radius?: number | string;
  className?: string;
}) {
  return (
    <div
      className={`${styles.skeleton} ${className}`}
      style={{ height, width, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function CardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className={styles.skeletonGrid} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index}>
          <div className={`${styles.skeleton} ${styles.skeletonSquare}`} />
          <div className={`${styles.skeleton} ${styles.skeletonLine}`} />
          <div className={`${styles.skeleton} ${styles.skeletonLineShort}`} />
        </div>
      ))}
    </div>
  );
}
