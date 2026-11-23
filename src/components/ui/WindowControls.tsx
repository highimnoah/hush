import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

import styles from "../../styles/layout.module.css";

/**
 * Minimize / maximize-or-restore / close buttons for the borderless main
 * window. Also used by the immersive now-playing view, which covers the
 * regular titlebar.
 */
export function WindowControls({ className }: { className?: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const sync = () => {
      appWindow
        .isMaximized()
        .then((value) => {
          if (!disposed) setMaximized(value);
        })
        .catch(() => {});
    };

    sync();
    appWindow
      .onResized(sync)
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const appWindow = getCurrentWindow();

  return (
    <div className={[styles.winControls, className].filter(Boolean).join(" ")}>
      <button
        type="button"
        className={styles.winBtn}
        onClick={() => void appWindow.minimize()}
        aria-label="Minimize window"
        title="Minimize"
      >
        <Minus size={15} />
      </button>
      <button
        type="button"
        className={styles.winBtn}
        onClick={() => void appWindow.toggleMaximize()}
        aria-label={maximized ? "Restore window" : "Maximize window"}
        title={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? <Copy size={13} /> : <Square size={12} />}
      </button>
      <button
        type="button"
        className={`${styles.winBtn} ${styles.winBtnClose}`}
        onClick={() => void appWindow.close()}
        aria-label="Close window"
        title="Close"
      >
        <X size={15} />
      </button>
    </div>
  );
}
