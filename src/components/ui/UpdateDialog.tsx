import { Download, RefreshCw, X } from "lucide-react";
import { useEffect } from "react";

import { useUpdater } from "../../store/updater";
import ui from "../../styles/ui.module.css";
import styles from "../../styles/update.module.css";

/**
 * Custom update prompt. The plugin's built-in dialog is disabled so the
 * experience stays inside hush's own visual language.
 */
export function UpdateDialog() {
  const open = useUpdater((state) => state.promptOpen);
  const status = useUpdater((state) => state.status);
  const version = useUpdater((state) => state.version);
  const currentVersion = useUpdater((state) => state.currentVersion);
  const notes = useUpdater((state) => state.notes);
  const progress = useUpdater((state) => state.progress);
  const error = useUpdater((state) => state.error);
  const download = useUpdater((state) => state.download);
  const install = useUpdater((state) => state.install);
  const skip = useUpdater((state) => state.skip);
  const dismiss = useUpdater((state) => state.dismiss);
  const openReleases = useUpdater((state) => state.openReleases);

  const downloading = status === "downloading";
  const installing = status === "installing";
  const busy = downloading || installing;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, dismiss]);

  if (!open) return null;

  const title =
    status === "ready"
      ? "Update ready"
      : status === "error"
        ? "Update failed"
        : installing
          ? "Installing update"
          : downloading
            ? "Downloading update"
            : "Update available";

  return (
    <div
      className={ui.modalOverlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) dismiss();
      }}
    >
      <div
        className={`${ui.modal} ${styles.modal}`}
        role="dialog"
        aria-modal="true"
        aria-label="Software update"
      >
        <div className={styles.header}>
          <div>
            <div className={styles.title}>{title}</div>
            <div className={styles.version}>
              {version ? `hush ${version}` : ""}
              {version && currentVersion ? " · " : ""}
              {currentVersion ? `you have ${currentVersion}` : ""}
            </div>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={dismiss}
            disabled={busy}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {status === "available" && notes ? (
          <div className={styles.notes}>{notes}</div>
        ) : null}

        {status === "available" ? (
          <p className={styles.hint}>
            The download runs in the background. Playback keeps going until you
            install the update.
          </p>
        ) : null}

        {downloading ? (
          <>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{
                  width: progress >= 0 ? `${progress}%` : "35%",
                }}
              />
            </div>
            <div className={styles.progressMeta}>
              <span>Downloading…</span>
              <span>{progress >= 0 ? `${Math.round(progress)}%` : ""}</span>
            </div>
          </>
        ) : null}

        {status === "ready" ? (
          <p className={styles.hint}>
            hush {version} has been downloaded. Installing closes hush. On
            Linux it reopens automatically; on Windows, open hush again when
            the installer finishes. Your queue and position are restored.
          </p>
        ) : null}

        {installing ? (
          <p className={styles.hint}>
            Applying the update. hush may close while the installer runs.
          </p>
        ) : null}

        {status === "error" ? (
          <>
            <p className={styles.error}>
              {error ?? "The update could not be completed."}
            </p>
            <p className={styles.hint}>
              You can also download the latest build manually from GitHub
              Releases.
            </p>
          </>
        ) : null}

        <div className={styles.actions}>
          {status === "available" ? (
            <>
              <button
                type="button"
                className={`${ui.button} ${ui.ghost}`}
                onClick={skip}
              >
                Skip this version
              </button>
              <button
                type="button"
                className={`${ui.button} ${ui.ghost}`}
                onClick={dismiss}
              >
                Later
              </button>
              <button
                type="button"
                className={`${ui.button} ${ui.primary}`}
                onClick={() => void download()}
              >
                <Download size={15} /> Download update
              </button>
            </>
          ) : null}

          {downloading ? (
            <button
              type="button"
              className={`${ui.button} ${ui.ghost}`}
              disabled
            >
              Downloading…
            </button>
          ) : null}

          {installing ? (
            <button
              type="button"
              className={`${ui.button} ${ui.ghost}`}
              disabled
            >
              Installing…
            </button>
          ) : null}

          {status === "ready" ? (
            <>
              <button
                type="button"
                className={`${ui.button} ${ui.ghost}`}
                onClick={dismiss}
              >
                Later
              </button>
              <button
                type="button"
                className={`${ui.button} ${ui.primary}`}
                onClick={() => void install()}
              >
                <RefreshCw size={15} /> Install update
              </button>
            </>
          ) : null}

          {status === "error" ? (
            <>
              <button
                type="button"
                className={`${ui.button} ${ui.ghost}`}
                onClick={() => void openReleases()}
              >
                Open releases
              </button>
              <button
                type="button"
                className={`${ui.button} ${ui.ghost}`}
                onClick={dismiss}
              >
                Close
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
