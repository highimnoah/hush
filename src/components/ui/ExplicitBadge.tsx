import ui from "../../styles/ui.module.css";

interface ExplicitBadgeProps {
  className?: string;
}

/** Small flat "E" badge shown for tracks/albums flagged as explicit. */
export function ExplicitBadge({ className = "" }: ExplicitBadgeProps) {
  return (
    <span
      className={`${ui.explicitBadge} ${className}`.trim()}
      title="Explicit"
      aria-label="Explicit"
    >
      E
    </span>
  );
}
