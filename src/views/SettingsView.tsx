import {
  ChevronRight,
  Disc3,
  Handshake,
  Radio,
  RefreshCw,
  Server,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ErrorState } from "../components/ui/ErrorState";
import { Loading } from "../components/ui/States";
import { dataCache } from "../lib/cache";
import { formatBytes } from "../lib/format";
import { api } from "../lib/ipc";
import { notifyLyricsChanged } from "../lib/lyrics";
import type {
  ArtistImageCacheInfo,
  Settings,
} from "../lib/types";
import { useSettings } from "../store/settings";
import { useToast } from "../store/toast";
import { useUpdater } from "../store/updater";
import styles from "../styles/settings.module.css";
import ui from "../styles/ui.module.css";
import {
  ArtistImagesSection,
} from "./settings/ArtistImagesSection";
import { DiscordSection } from "./settings/DiscordSection";
import { PlaybackSection } from "./settings/PlaybackSection";
import { ServerSection } from "./settings/ServerSection";
import { SettingsModal } from "./settings/SettingsModal";
import { TogetherSection } from "./settings/TogetherSection";
import { UpdatesSection } from "./settings/UpdatesSection";

type SectionKey =
  | "server"
  | "playback"
  | "discord"
  | "together"
  | "artistImages"
  | "updates";

interface SectionMeta {
  key: SectionKey;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const SECTIONS: SectionMeta[] = [
  {
    key: "server",
    title: "Music server",
    description: "Navidrome or any Subsonic-compatible server.",
    icon: <Server size={18} />,
  },
  {
    key: "playback",
    title: "Playback",
    description: "ReplayGain, transitions, resume and lyrics source.",
    icon: <Disc3 size={18} />,
  },
  {
    key: "discord",
    title: "Discord Rich Presence",
    description: "Show what you're listening to while a track is playing.",
    icon: <Radio size={18} />,
  },
  {
    key: "together",
    title: "Listen together",
    description: "Self-host the hush-sync relay and listen with friends.",
    icon: <Handshake size={18} />,
  },
  {
    key: "artistImages",
    title: "Artist images",
    description: "Server, automatic or off; manage the local cache.",
    icon: <Users size={18} />,
  },
  {
    key: "updates",
    title: "Updates",
    description: "Keep hush up to date.",
    icon: <RefreshCw size={18} />,
  },
];

function normalizedServer(
  form: Settings,
  authMode: "token" | "password",
): Settings {
  const base = { ...form };
  if (authMode === "token") {
    base.password = "";
  } else {
    base.token = "";
    base.salt = "";
  }
  return base;
}

function sectionPatch(key: SectionKey, form: Settings): Partial<Settings> {
  switch (key) {
    case "playback":
      return {
        replaygain: form.replaygain,
        replaygainPreamp: form.replaygainPreamp,
        transitionMode: form.transitionMode,
        fadeSeconds: form.fadeSeconds,
        spectrumBoost: form.spectrumBoost,
        resumePlayback: form.resumePlayback,
        lrclibLyrics: form.lrclibLyrics,
      };
    case "discord":
      return {
        discordEnabled: form.discordEnabled,
        discordClientId: form.discordClientId,
        discordLargeImage: form.discordLargeImage,
        discordDetails: form.discordDetails,
        discordState: form.discordState,
        discordTimestamps: form.discordTimestamps,
        discordUseCover: form.discordUseCover,
      };
    case "together":
      return {
        sessionName: form.sessionName,
        sessionRelayUrl: form.sessionRelayUrl,
      };
    case "artistImages":
      return { artistImages: form.artistImages };
    case "updates":
      return { autoUpdate: form.autoUpdate };
    default:
      return {};
  }
}

export function SettingsView() {
  const settings = useSettings((state) => state.settings);
  const loaded = useSettings((state) => state.loaded);
  const loadError = useSettings((state) => state.loadError);
  const saveSettings = useSettings((state) => state.save);
  const patchSettings = useSettings((state) => state.patch);

  const updaterStatus = useUpdater((state) => state.status);
  const updaterSupported = useUpdater((state) => state.supported);
  const updaterVersion = useUpdater((state) => state.version);
  const currentVersion = useUpdater((state) => state.currentVersion);
  const checkUpdates = useUpdater((state) => state.check);
  const openUpdatePrompt = useUpdater((state) => state.openPrompt);
  const openReleases = useUpdater((state) => state.openReleases);
  const loadVersion = useUpdater((state) => state.loadVersion);

  const [form, setForm] = useState<Settings | null>(null);
  const [authMode, setAuthMode] = useState<"token" | "password">("token");

  const [activeSection, setActiveSection] = useState<SectionKey | null>(null);
  const [draftForm, setDraftForm] = useState<Settings | null>(null);
  const [draftAuthMode, setDraftAuthMode] = useState<"token" | "password">(
    "token",
  );
  const [savingSection, setSavingSection] = useState<SectionKey | null>(null);

  const [artistCache, setArtistCache] = useState<ArtistImageCacheInfo | null>(
    null,
  );
  const [clearingCache, setClearingCache] = useState(false);

  useEffect(() => {
    if (settings && form === null) {
      setForm({ ...settings });
      setAuthMode(
        settings.token.trim() && settings.salt.trim()
          ? "token"
          : settings.password
            ? "password"
            : "token",
      );
    }
  }, [settings, form]);

  useEffect(() => {
    void loadVersion();
  }, [loadVersion]);

  useEffect(() => {
    void api
      .artistImageCacheInfo()
      .then(setArtistCache)
      .catch(() => {});
  }, []);

  const update = (patch: Partial<Settings>) =>
    setDraftForm((current) => (current ? { ...current, ...patch } : current));

  const openSection = (key: SectionKey) => {
    if (!form) return;
    setDraftForm({ ...form });
    setDraftAuthMode(authMode);
    setActiveSection(key);
  };

  const closeSection = () => {
    setActiveSection(null);
    setDraftForm(null);
  };

  const handleSave = async (key: SectionKey) => {
    if (!draftForm || !settings) return;
    setSavingSection(key);
    try {
      let saved: Settings;
      if (key === "server") {
        saved = await saveSettings(normalizedServer(draftForm, draftAuthMode));
      } else {
        saved = await patchSettings(sectionPatch(key, draftForm));
      }

      setForm({ ...saved });
      if (key === "server") {
        setAuthMode(draftAuthMode);
        const serverChanged =
          saved.serverUrl.trim() !== settings.serverUrl.trim() ||
          saved.username.trim() !== settings.username.trim() ||
          saved.token !== settings.token ||
          saved.salt !== settings.salt ||
          saved.password !== settings.password;
        if (serverChanged) dataCache.clear();
      }
      if (
        key === "playback" &&
        saved.lrclibLyrics !== settings.lrclibLyrics
      ) {
        notifyLyricsChanged();
      }

      useToast.getState().show("Saved");
      closeSection();
    } catch (err) {
      useToast.getState().show(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSection(null);
    }
  };

  const handleClearArtistCache = async () => {
    setClearingCache(true);
    try {
      const cleared = await api.clearArtistImageCache();
      setArtistCache(await api.artistImageCacheInfo());
      useToast.getState().show(
        `Cleared ${cleared.count} ${
          cleared.count === 1 ? "image" : "images"
        } (${formatBytes(cleared.bytes) ?? "0 B"}).`,
      );
    } catch (err) {
      useToast.getState().show(err instanceof Error ? err.message : String(err));
    } finally {
      setClearingCache(false);
    }
  };

  const updateNote = useMemo(() => {
    switch (updaterStatus) {
      case "checking":
        return "Checking for updates…";
      case "up-to-date":
        return "You're up to date.";
      case "available":
        return `hush ${updaterVersion ?? ""} is available.`;
      case "downloading":
        return "Downloading update…";
      case "ready":
        return "Downloaded — install from the update prompt.";
      case "installing":
        return "Installing update…";
      case "error":
        return "Could not check for updates.";
      default:
        return "";
    }
  }, [updaterStatus, updaterVersion]);

  if (!loaded) {
    return (
      <div className={styles.wrap}>
        <Loading label="Loading settings…" />
      </div>
    );
  }

  if (!form) {
    return (
      <div className={styles.wrap}>
        <ErrorState
          title="Settings unavailable"
          message={loadError ?? "Could not load settings."}
        />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Settings</h1>
          <div className={styles.subtitle}>
            Connect your server, tune playback, and make hush yours.
          </div>
        </div>
      </div>

      <div className={styles.cardGrid}>
        {SECTIONS.map((section, index) => (
          <button
            key={section.key}
            type="button"
            className={styles.settingCard}
            style={{ animationDelay: `${Math.min(index * 35, 250)}ms` }}
            onClick={() => openSection(section.key)}
          >
            <div className={styles.settingCardHead}>
              <div className={styles.cardIcon}>{section.icon}</div>
              <ChevronRight size={18} className={styles.settingCardArrow} />
            </div>
            <div className={styles.cardTitle}>{section.title}</div>
            <div className={styles.cardDesc}>{section.description}</div>
          </button>
        ))}
      </div>

      <SettingsModal
        open={activeSection === "server"}
        title="Music server"
        icon={<Server size={18} />}
        onClose={closeSection}
        onSave={() => void handleSave("server")}
        saving={savingSection === "server"}
      >
        {draftForm && (
          <ServerSection
            form={draftForm}
            update={update}
            authMode={draftAuthMode}
            setAuthMode={setDraftAuthMode}
          />
        )}
      </SettingsModal>

      <SettingsModal
        open={activeSection === "playback"}
        title="Playback"
        icon={<Disc3 size={18} />}
        onClose={closeSection}
        onSave={() => void handleSave("playback")}
        saving={savingSection === "playback"}
      >
        {draftForm && (
          <PlaybackSection form={draftForm} update={update} />
        )}
      </SettingsModal>

      <SettingsModal
        open={activeSection === "discord"}
        title="Discord Rich Presence"
        icon={<Radio size={18} />}
        onClose={closeSection}
        onSave={() => void handleSave("discord")}
        saving={savingSection === "discord"}
      >
        {draftForm && <DiscordSection form={draftForm} update={update} />}
      </SettingsModal>

      <SettingsModal
        open={activeSection === "together"}
        title="Listen together"
        icon={<Handshake size={18} />}
        onClose={closeSection}
        onSave={() => void handleSave("together")}
        saving={savingSection === "together"}
      >
        {draftForm && <TogetherSection form={draftForm} update={update} />}
      </SettingsModal>

      <SettingsModal
        open={activeSection === "artistImages"}
        title="Artist images"
        icon={<Users size={18} />}
        onClose={closeSection}
        onSave={() => void handleSave("artistImages")}
        saving={savingSection === "artistImages"}
      >
        {draftForm && (
          <ArtistImagesSection
            form={draftForm}
            update={update}
            artistCache={artistCache}
            clearingCache={clearingCache}
            onClearCache={handleClearArtistCache}
          />
        )}
      </SettingsModal>

      <SettingsModal
        open={activeSection === "updates"}
        title="Updates"
        icon={<RefreshCw size={18} />}
        onClose={closeSection}
        onSave={() => void handleSave("updates")}
        saving={savingSection === "updates"}
      >
        {draftForm && (
          <UpdatesSection
            form={draftForm}
            update={update}
            updaterSupported={updaterSupported}
            updaterStatus={updaterStatus}
            updaterVersion={updaterVersion}
            currentVersion={currentVersion}
            updateNote={updateNote}
            onCheck={() => void checkUpdates(true)}
            onOpenPrompt={openUpdatePrompt}
            onOpenReleases={openReleases}
          />
        )}
      </SettingsModal>
    </div>
  );
}
