import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import ui from "../../styles/ui.module.css";
import styles from "../../styles/settings.module.css";

interface SettingsModalProps {
  open: boolean;
  title: string;
  icon: ReactNode;
  children: ReactNode;
  onClose: () => void;
  onSave: () => void;
  saveLabel?: string;
  saving?: boolean;
}

export function SettingsModal({
  open,
  title,
  icon,
  children,
  onClose,
  onSave,
  saveLabel = "Save",
  saving = false,
}: SettingsModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={ui.modalOverlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`${ui.modal} ${styles.settingsModal}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.modalHead}>
          <div className={styles.cardIcon}>{icon}</div>
          <div className={styles.modalTitle}>{title}</div>
          <button
            type="button"
            className={styles.modalClose}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className={styles.modalBody}>{children}</div>

        <div className={styles.modalFooter}>
          <button
            type="button"
            className={`${ui.button} ${ui.ghost}`}
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving…" : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
