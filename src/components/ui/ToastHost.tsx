import { Check, X } from "lucide-react";

import { useToast } from "../../store/toast";
import styles from "../../styles/layout.module.css";

export function ToastHost() {
  const message = useToast((state) => state.message);
  const dismiss = useToast((state) => state.dismiss);

  if (!message) return null;

  return (
    <div className={`${styles.errorToast} ${styles.infoToast}`} role="status">
      <Check size={16} className={styles.infoIcon} />
      <span>{message}</span>
      <button
        type="button"
        className={styles.toastClose}
        onClick={dismiss}
        aria-label="Dismiss"
      >
        <X size={15} />
      </button>
    </div>
  );
}
