import {
  Disc3,
  Handshake,
  Heart,
  Home,
  ListMusic,
  Music2,
  Search,
  Settings,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";
import { NavLink } from "react-router-dom";

import { isConfigured, useSettings } from "../store/settings";
import styles from "../styles/layout.module.css";

interface NavEntry {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  end?: boolean;
}

const listenItems: NavEntry[] = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/search", label: "Search", icon: Search },
  { to: "/together", label: "Listen together", icon: Handshake },
];

const libraryItems: NavEntry[] = [
  { to: "/artists", label: "Artists", icon: Users },
  { to: "/albums", label: "Albums", icon: Disc3 },
  { to: "/genres", label: "Genres", icon: Music2 },
  { to: "/playlists", label: "Playlists", icon: ListMusic },
  { to: "/liked", label: "Liked", icon: Heart },
];

function navClass({ isActive }: { isActive: boolean }): string {
  return [styles.navItem, isActive ? styles.navActive : ""]
    .filter(Boolean)
    .join(" ");
}

function NavItem({ to, label, icon: Icon, end }: NavEntry) {
  return (
    <NavLink to={to} end={end} className={navClass}>
      <Icon size={17} className={styles.navIcon} />
      <span>{label}</span>
    </NavLink>
  );
}

export function Sidebar() {
  const settings = useSettings((state) => state.settings);
  const connection = useSettings((state) => state.connection);
  const serverName = useSettings((state) => state.serverName);
  const connectionError = useSettings((state) => state.connectionError);

  let dotClass = "";
  let label = "Connect a server";

  if (!isConfigured(settings)) {
    label = "Connect a server";
  } else if (connection === "checking") {
    dotClass = styles.dotChecking;
    label = "Connecting…";
  } else if (connection === "ok") {
    dotClass = styles.dotOk;
    label = serverName;
  } else if (connection === "error") {
    dotClass = styles.dotError;
    label = "Server unreachable";
  } else {
    label = serverName;
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.brandMark} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className={styles.brandName}>hush</span>
      </div>

      <nav className={styles.nav} aria-label="Primary">
        {listenItems.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}

        <div className={styles.navSection}>Library</div>
        {libraryItems.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      <div className={styles.sidebarFooter}>
        <div
          className={styles.connection}
          title={connectionError ?? label}
          role="status"
        >
          <span className={`${styles.dot} ${dotClass}`} />
          <span className={styles.connectionText}>{label}</span>
        </div>
        <NavLink to="/settings" className={navClass}>
          <Settings size={17} className={styles.navIcon} />
          <span>Settings</span>
        </NavLink>
      </div>
    </aside>
  );
}
