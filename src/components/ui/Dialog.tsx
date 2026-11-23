import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import ui from "../../styles/ui.module.css";

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className={ui.modalOverlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={ui.modal} role="dialog" aria-modal="true" aria-label={title}>
        <div className={ui.modalTitle}>{title}</div>
        {children}
      </div>
    </div>
  );
}

export function PromptDialog({
  open,
  title,
  label,
  initialValue = "",
  placeholder,
  confirmLabel = "Save",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  if (!open) return null;

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onConfirm(trimmed);
  };

  return (
    <Dialog title={title} onClose={onCancel}>
      <label className={ui.label} htmlFor="hush-dialog-input">
        {label}
      </label>
      <input
        id="hush-dialog-input"
        className={ui.input}
        value={value}
        placeholder={placeholder}
        autoFocus
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className={ui.modalActions}>
        <button
          type="button"
          className={`${ui.button} ${ui.ghost}`}
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          onClick={submit}
          disabled={busy || !value.trim()}
        >
          {busy ? "Saving…" : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <Dialog title={title} onClose={onCancel}>
      <p className={ui.modalMessage}>{message}</p>
      <div className={ui.modalActions}>
        <button
          type="button"
          className={`${ui.button} ${ui.ghost}`}
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${ui.button} ${danger ? ui.danger : ui.primary}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
