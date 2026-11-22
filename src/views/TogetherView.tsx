import {
  AlertCircle,
  Check,
  Copy,
  Handshake,
  LogIn,
  LogOut,
  Music2,
  Plus,
  UsersRound,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Artwork } from "../components/ui/Artwork";
import { Loading } from "../components/ui/States";
import { formatTime } from "../lib/format";
import type {
  SessionMember,
  SessionSnapshot,
  SyncStatus,
  TrackInfo,
} from "../lib/types";
import { usePlayer } from "../store/player";
import { useSession } from "../store/session";
import { useSettings } from "../store/settings";
import styles from "../styles/together.module.css";
import ui from "../styles/ui.module.css";

function syncLabel(sync: SyncStatus): string {
  switch (sync) {
    case "synced":
      return "In sync";
    case "drifting":
      return "Syncing";
    case "disconnected":
      return "Disconnected";
    default:
      return "Connecting";
  }
}

function SyncBadge({
  sync,
  driftMs,
}: {
  sync: SyncStatus;
  driftMs?: number | null;
}) {
  const tone =
    sync === "synced"
      ? styles.syncSynced
      : sync === "drifting"
        ? styles.syncDrifting
        : sync === "disconnected"
          ? styles.syncDisconnected
          : "";
  return (
    <span className={`${styles.syncBadge} ${tone}`}>
      <span className={styles.syncDot} />
      {syncLabel(sync)}
      {sync === "drifting" && driftMs != null
        ? ` · ${Math.round(Math.abs(driftMs))} ms`
        : ""}
    </span>
  );
}

function MemberRow({ member }: { member: SessionMember }) {
  const initial = member.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className={styles.member}>
      <div className={styles.avatar}>{initial}</div>
      <div className={styles.memberName}>{member.name}</div>
      {member.isHost ? <span className={styles.hostTag}>Host</span> : null}
    </div>
  );
}

function SetupPanel({
  settingsName,
  relay,
  code,
  setCode,
  onJoin,
  onCreate,
  loading,
}: {
  settingsName: string;
  relay: string;
  code: string;
  setCode: (code: string) => void;
  onJoin: () => void;
  onCreate: () => void;
  loading: boolean;
}) {
  return (
    <div className={styles.setupGrid}>
      <section className={styles.setupCard}>
        <div className={styles.cardTitle}>Start a session</div>
        <p className={styles.cardText}>
          You get a code to share. You control playback; everyone else follows.
        </p>
        <div className={styles.metaRow}>
          <span>
            Hosting as <strong>{settingsName}</strong>
          </span>
          <Link to="/settings">Change</Link>
        </div>
        <div className={styles.metaRow}>
          <span>
            Relay <strong>{relay}</strong>
          </span>
          <Link to="/settings">Change</Link>
        </div>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          onClick={onCreate}
          disabled={loading}
        >
          <Plus size={15} />
          Create session
        </button>
      </section>

      <section className={styles.setupCard}>
        <div className={styles.cardTitle}>Join a session</div>
        <p className={styles.cardText}>
          Enter the six-character code from the host.
        </p>
        <div className={styles.joinRow}>
          <input
            className={styles.codeInput}
            value={code}
            onChange={(event) =>
              setCode(
                event.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, 6),
              )
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && code.length === 6) onJoin();
            }}
            placeholder="ABC123"
            maxLength={6}
            aria-label="Session code"
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            onClick={onJoin}
            disabled={code.length !== 6 || loading}
          >
            <LogIn size={15} />
            Join
          </button>
        </div>
        <p className={styles.note}>
          Everyone must use the same Navidrome server and the same relay. The
          relay only carries playback state — no audio or credentials.
        </p>
      </section>
    </div>
  );
}

function ActiveSession({
  session,
  playerTrack,
  position,
  duration,
  copied,
  onCopy,
  onLeave,
}: {
  session: SessionSnapshot;
  playerTrack: TrackInfo | null;
  position: number;
  duration: number;
  copied: boolean;
  onCopy: () => void;
  onLeave: () => void;
}) {
  const isHost = session.role === "host";
  const host = session.members.find((member) => member.id === session.hostId);
  const hostName = host?.name ?? (isHost ? session.name : "the host");
  const now = session.nowPlaying ?? null;
  const matches = Boolean(now && playerTrack?.id === now.id);
  const progress =
    matches && duration > 0
      ? Math.min(1, Math.max(0, position / duration))
      : 0;

  return (
    <>
      <section className={styles.heroCard}>
        <div className={styles.heroLeft}>
          <div className={styles.kind}>
            {isHost ? "Hosting" : "Listening with"}
          </div>
          <div className={styles.heroTitle}>
            {isHost ? "Your session" : hostName}
          </div>
          {isHost ? (
            <>
              <div className={styles.codeRow}>
                <span className={styles.code}>{session.code}</span>
                <button
                  type="button"
                  className={ui.iconBtn}
                  onClick={onCopy}
                  aria-label="Copy session code"
                  title="Copy code"
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <div className={styles.codeHint}>
                Share this code with friends on the same server.
              </div>
            </>
          ) : (
            <div className={styles.codeHint}>
              Session <strong>{session.code}</strong> · playback follows{" "}
              {hostName}.
            </div>
          )}
        </div>
        <div className={styles.heroActions}>
          <button
            type="button"
            className={`${ui.button} ${ui.ghost}`}
            onClick={onLeave}
          >
            <LogOut size={15} />
            Leave
          </button>
        </div>
      </section>

      <div className={styles.columns}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <UsersRound size={16} />
            <span>In this session</span>
            <span className={styles.count}>{session.members.length}</span>
          </div>
          <div className={styles.members}>
            {session.members.map((member) => (
              <MemberRow key={member.id} member={member} />
            ))}
          </div>
          <div className={styles.note}>
            Everyone streams from their own copy of the same Navidrome library.
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <Music2 size={16} />
            <span>Now playing</span>
          </div>
          {now ? (
            <div className={styles.now}>
              <Artwork
                coverId={now.coverArt}
                size={240}
                alt={now.album}
                style={{ width: 96, height: 96, flexShrink: 0 }}
              />
              <div className={styles.nowBody}>
                <div className={styles.nowTitle}>{now.title}</div>
                <div className={styles.nowArtist}>
                  {now.artist || "Unknown artist"}
                </div>
                <div className={styles.nowAlbum}>{now.album}</div>
                <div className={styles.progress}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
                <div className={styles.nowFooter}>
                  <span
                    className={`${styles.stateBadge} ${session.playing ? styles.statePlaying : ""}`}
                  >
                    {session.playing ? "Playing" : "Paused"}
                  </span>
                  <span>
                    {formatTime(matches ? position : 0)} /{" "}
                    {formatTime(now.duration)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.waiting}>
              <WifiOff size={18} />
              <div>
                <div className={styles.waitingTitle}>
                  {isHost ? "Nothing playing" : `Waiting for ${hostName}`}
                </div>
                <div className={styles.waitingText}>
                  Play a track in hush and it will appear here.
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export function TogetherView() {
  const settings = useSettings((state) => state.settings);
  const session = useSession((state) => state.snapshot);
  const loading = useSession((state) => state.loading);
  const storeError = useSession((state) => state.error);
  const create = useSession((state) => state.create);
  const join = useSession((state) => state.join);
  const leave = useSession((state) => state.leave);

  const playerTrack = usePlayer((state) => state.track);
  const position = usePlayer((state) => state.position);
  const duration = usePlayer((state) => state.duration);

  const [searchParams] = useSearchParams();
  const invite = (searchParams.get("code") ?? "").trim().toUpperCase();
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const autoJoined = useRef(false);

  useEffect(() => {
    if (invite.length === 6) setCode(invite);
  }, [invite]);

  useEffect(() => {
    if (autoJoined.current) return;
    if (!settings || !session || session.role !== "none") return;
    if (invite.length !== 6 || loading) return;
    autoJoined.current = true;
    void join(invite);
  }, [settings, session, invite, loading, join]);

  if (!settings || !session) {
    return (
      <div className={styles.page}>
        <Loading label="Loading session…" />
      </div>
    );
  }

  const role = session.role;
  const error = session.error ?? storeError;
  const displayName =
    settings.sessionName || settings.username || "Listener";
  const relay = settings.sessionRelayUrl || "ws://127.0.0.1:8787";

  const copyCode = async () => {
    if (!session.code) return;
    try {
      await navigator.clipboard.writeText(session.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Listen together</h1>
          <div className={styles.subtitle}>
            Share a session and keep playback in sync with friends.
          </div>
        </div>
        {role !== "none" ? (
          <SyncBadge sync={session.sync} driftMs={session.driftMs} />
        ) : null}
      </div>

      {error ? (
        <div className={styles.error}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {role === "none" ? (
        loading ? (
          <div className={styles.connecting}>
            <Loading label="Connecting to the relay…" />
          </div>
        ) : (
          <SetupPanel
            settingsName={displayName}
            relay={relay}
            code={code}
            setCode={setCode}
            onJoin={() => void join(code)}
            onCreate={() => void create()}
            loading={loading}
          />
        )
      ) : (
        <ActiveSession
          session={session}
          playerTrack={playerTrack}
          position={position}
          duration={duration}
          copied={copied}
          onCopy={() => void copyCode()}
          onLeave={() => void leave()}
        />
      )}

      {role === "none" ? (
        <div className={styles.footnote}>
          <Handshake size={15} />
          <span>
            Self-host the tiny relay from <code>hush-sync/</code> and set it in
            Settings → Listen together.
          </span>
        </div>
      ) : null}
    </div>
  );
}
