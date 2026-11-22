import { AlertCircle } from "lucide-react";

import styles from "../../styles/ui.module.css";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className={styles.errorBox}>
      <AlertCircle className={styles.errorIcon} size={20} />
      <div>
        <div className={styles.errorTitle}>{title}</div>
        <div className={styles.errorText}>{message}</div>
        {onRetry ? (
          <div className={styles.errorActions}>
            <button
              type="button"
              className={`${styles.button} ${styles.ghost}`}
              onClick={onRetry}
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
