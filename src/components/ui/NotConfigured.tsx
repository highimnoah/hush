import { Server } from "lucide-react";
import { Link } from "react-router-dom";

import styles from "../../styles/library.module.css";
import ui from "../../styles/ui.module.css";
import { EmptyState } from "./EmptyState";

export function NotConfigured() {
  return (
    <div className={styles.page}>
      <EmptyState
        icon={<Server size={22} />}
        title="No server connected"
        text="Add your Navidrome or Subsonic-compatible server in Settings to browse your library."
        action={
          <Link to="/settings" className={`${ui.button} ${ui.primary}`}>
            Open settings
          </Link>
        }
      />
    </div>
  );
}
