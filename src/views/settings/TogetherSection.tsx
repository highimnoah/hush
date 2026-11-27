import { Handshake } from "lucide-react";

import type { Settings } from "../../lib/types";
import ui from "../../styles/ui.module.css";
import styles from "../../styles/settings.module.css";

interface TogetherSectionProps {
  form: Settings;
  update: (patch: Partial<Settings>) => void;
}

export function TogetherSection({ form, update }: TogetherSectionProps) {
  return (
    <div className={styles.stack}>
      <div className={styles.grid2}>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="session-name">
            Display name
          </label>
          <input
            id="session-name"
            className={ui.input}
            value={form.sessionName}
            onChange={(event) => update({ sessionName: event.target.value })}
            placeholder={form.username || "Listener"}
            spellCheck={false}
          />
        </div>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="session-relay">
            Relay URL
          </label>
          <input
            id="session-relay"
            className={ui.input}
            value={form.sessionRelayUrl}
            onChange={(event) =>
              update({ sessionRelayUrl: event.target.value })
            }
            placeholder="ws://127.0.0.1:8787"
            spellCheck={false}
          />
        </div>
      </div>

      <p className={styles.help} style={{ marginTop: 14 }}>
        Run <code>hush-sync</code> (see <code>hush-sync/README.md</code>) and
        use <code>wss://</code> behind TLS for remote friends.
      </p>
    </div>
  );
}

export function TogetherIcon() {
  return <Handshake size={18} />;
}
