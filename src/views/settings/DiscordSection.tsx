import { Radio } from "lucide-react";

import { Switch } from "../../components/ui/Switch";
import type { Settings } from "../../lib/types";
import ui from "../../styles/ui.module.css";
import styles from "../../styles/settings.module.css";

const TOKENS = [
  "{app}",
  "{title}",
  "{artist}",
  "{album}",
  "{albumArtist}",
  "{server}",
  "{format}",
  "{bitrate}",
  "{elapsed}",
  "{duration}",
];

interface DiscordSectionProps {
  form: Settings;
  update: (patch: Partial<Settings>) => void;
}

export function DiscordSection({ form, update }: DiscordSectionProps) {
  return (
    <div className={styles.stack}>
      <div className={styles.rowBetween}>
        <div>
          <div className={styles.rowLabel}>Enable Rich Presence</div>
          <div className={styles.rowHint}>
            Presence hides automatically when paused or stopped.
          </div>
        </div>
        <Switch
          checked={form.discordEnabled}
          onChange={(value) => update({ discordEnabled: value })}
          label="Enable Discord Rich Presence"
        />
      </div>

      <div className={styles.grid2}>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="discord-client">
            Application client ID
          </label>
          <input
            id="discord-client"
            className={ui.input}
            value={form.discordClientId}
            onChange={(event) =>
              update({ discordClientId: event.target.value })
            }
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="discord-image">
            Large image asset key
          </label>
          <input
            id="discord-image"
            className={ui.input}
            value={form.discordLargeImage}
            onChange={(event) =>
              update({ discordLargeImage: event.target.value })
            }
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </div>

      <div className={styles.grid2}>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="discord-details">
            Details template
          </label>
          <input
            id="discord-details"
            className={ui.input}
            value={form.discordDetails}
            onChange={(event) =>
              update({ discordDetails: event.target.value })
            }
            spellCheck={false}
          />
        </div>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="discord-state">
            State template
          </label>
          <input
            id="discord-state"
            className={ui.input}
            value={form.discordState}
            onChange={(event) => update({ discordState: event.target.value })}
            spellCheck={false}
          />
        </div>
      </div>

      <div className={styles.rowBetween}>
        <div>
          <div className={styles.rowLabel}>Show progress timeline</div>
          <div className={styles.rowHint}>
            Adds a live elapsed/remaining timeline to your presence.
          </div>
        </div>
        <Switch
          checked={form.discordTimestamps}
          onChange={(value) => update({ discordTimestamps: value })}
          label="Show progress timeline in Discord"
        />
      </div>

      <div className={styles.rowBetween}>
        <div>
          <div className={styles.rowLabel}>Use album art as the large image</div>
          <div className={styles.rowHint}>
            Fetches the track's cover from your HTTPS server. Falls back to
            the asset key when unavailable.
          </div>
        </div>
        <Switch
          checked={form.discordUseCover}
          onChange={(value) => update({ discordUseCover: value })}
          label="Use album art in Discord"
        />
      </div>

      <div className={styles.help}>
        Available template fields:
        <div className={styles.tokens}>
          {TOKENS.map((token) => (
            <span key={token} className={styles.token}>
              {token}
            </span>
          ))}
        </div>
        <p style={{ marginTop: 8 }}>
          With album art enabled, hush passes the track's HTTPS cover URL to
          Discord. Otherwise it uses the static asset key. To set up the
          static asset, create a Discord application, upload an image under
          Rich Presence → Art Assets, and paste the client ID above.
        </p>
      </div>
    </div>
  );
}

export function DiscordIcon() {
  return <Radio size={18} />;
}
