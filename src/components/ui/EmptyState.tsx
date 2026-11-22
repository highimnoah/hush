import type { ReactNode } from "react";
import { Music2 } from "lucide-react";

import styles from "../../styles/ui.module.css";

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  text?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, text, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>{icon ?? <Music2 size={22} />}</div>
      {title ? <div className={styles.emptyTitle}>{title}</div> : null}
      {text ? <p className={styles.emptyText}>{text}</p> : null}
      {action}
    </div>
  );
}
