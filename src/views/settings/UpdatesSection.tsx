import { RefreshCw } from "lucide-react";

import { Switch } from "../../components/ui/Switch";
import type { Settings } from "../../lib/types";
import ui from "../../styles/ui.module.css";
import styles from "../../styles/settings.module.css";

interface UpdatesSectionProps {
  form: Settings;
  update: (patch: Partial<Settings>) => void;
  updaterSupported: boolean;
  updaterStatus: string;
  updaterVersion: string | null;
  currentVersion: string | null;
  updateNote: string;
  onCheck: () => void;
  onOpenPrompt: () => void;
  onOpenReleases: () => void;
}

export function UpdatesSection({
  form,
  update,
  updaterSupported,
  updaterStatus,
  updaterVersion,
  currentVersion,
  updateNote,
  onCheck,
  onOpenPrompt,
  onOpenReleases,
}: UpdatesSectionProps) {
  return (
    <div className={styles.stack}>
      {updaterSupported ? (
        <div className={styles.rowBetween}>
          <div>
            <div className={styles.rowLabel}>Check automatically</div>
            <div className={styles.rowHint}>
              Look for a new release a few seconds after launch.
            </div>
          </div>
          <Switch
            checked={form.autoUpdate}
            onChange={(value) => update({ autoUpdate: value })}
            label="Check for updates automatically"
          />
        </div>
      ) : null}

      <div className={styles.rowBetween}>
        <div>
          <div className={styles.rowLabel}>
            Version {currentVersion ? currentVersion : "unknown"}
          </div>
          <div className={styles.rowHint}>
            {updaterSupported
              ? updateNote ||
                "Automatic updates work with the Windows installer and the Linux AppImage."
              : "This build is updated manually from GitHub Releases."}
          </div>
        </div>
        <div className={styles.actions}>
          {updaterSupported && updaterStatus === "available" ? (
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              onClick={onOpenPrompt}
            >
              View update
            </button>
          ) : null}
          {updaterSupported ? (
            <button
              type="button"
              className={`${ui.button} ${ui.ghost}`}
              onClick={() => void onCheck()}
              disabled={
                updaterStatus === "checking" ||
                updaterStatus === "downloading" ||
                updaterStatus === "installing"
              }
            >
              {updaterStatus === "checking"
                ? "Checking…"
                : updaterStatus === "downloading"
                  ? "Downloading…"
                  : updaterStatus === "installing"
                    ? "Installing…"
                    : "Check now"}
            </button>
          ) : null}
          <button
            type="button"
            className={`${ui.button} ${ui.ghost}`}
            onClick={onOpenReleases}
          >
            Releases
          </button>
        </div>
      </div>
    </div>
  );
}

export function UpdatesIcon() {
  return <RefreshCw size={18} />;
}
