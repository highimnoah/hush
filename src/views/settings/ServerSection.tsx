import { AlertCircle, Check, Server } from "lucide-react";
import { useState } from "react";

import { api } from "../../lib/ipc";
import type { Settings } from "../../lib/types";
import ui from "../../styles/ui.module.css";
import styles from "../../styles/settings.module.css";

type TestState = "idle" | "testing" | "ok" | "error";

interface ServerSectionProps {
  form: Settings;
  update: (patch: Partial<Settings>) => void;
  authMode: "token" | "password";
  setAuthMode: (mode: "token" | "password") => void;
}

export function ServerSection({
  form,
  update,
  authMode,
  setAuthMode,
}: ServerSectionProps) {
  const [testState, setTestState] = useState<TestState>("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const normalized = (): Settings => {
    const base = { ...form };
    if (authMode === "token") {
      base.password = "";
    } else {
      base.token = "";
      base.salt = "";
    }
    return base;
  };

  const handleTest = async () => {
    setTestState("testing");
    setTestMessage(null);
    try {
      const info = await api.testConnection(normalized());
      setTestState("ok");
      const details = [info.kind, info.version].filter(Boolean).join(" · ");
      setTestMessage(
        details ? `Connected to ${details}` : "Connected successfully",
      );
    } catch (err) {
      setTestState("error");
      setTestMessage(String(err));
    }
  };

  return (
    <div className={styles.stack}>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="server-url">
          Server URL
        </label>
        <input
          id="server-url"
          className={ui.input}
          value={form.serverUrl}
          onChange={(event) => update({ serverUrl: event.target.value })}
          placeholder="https://music.example.com"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className={styles.grid2}>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className={ui.input}
            value={form.username}
            onChange={(event) => update({ username: event.target.value })}
            autoComplete="username"
            spellCheck={false}
          />
        </div>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="server-name">
            Server name (optional)
          </label>
          <input
            id="server-name"
            className={ui.input}
            value={form.serverName}
            onChange={(event) => update({ serverName: event.target.value })}
            placeholder="Shown in Discord presence"
            spellCheck={false}
          />
        </div>
      </div>

      <div className={ui.field}>
        <span className={ui.label}>Authentication</span>
        <div className={ui.segmented} style={{ width: "fit-content" }}>
          <button
            type="button"
            className={`${ui.segment} ${authMode === "token" ? ui.segmentActive : ""}`}
            onClick={() => setAuthMode("token")}
          >
            API token
          </button>
          <button
            type="button"
            className={`${ui.segment} ${authMode === "password" ? ui.segmentActive : ""}`}
            onClick={() => setAuthMode("password")}
          >
            Password
          </button>
        </div>
        <span className={ui.hint}>
          {authMode === "token"
            ? "Generate an API token in Navidrome, then paste the token and its salt."
            : "Your password is stored locally on this machine."}
        </span>
      </div>

      {authMode === "token" ? (
        <div className={styles.grid2}>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="token">
              Token
            </label>
            <input
              id="token"
              className={ui.input}
              value={form.token}
              onChange={(event) => update({ token: event.target.value })}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="salt">
              Salt
            </label>
            <input
              id="salt"
              className={ui.input}
              value={form.salt}
              onChange={(event) => update({ salt: event.target.value })}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </div>
      ) : (
        <div className={ui.field}>
          <label className={ui.label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className={ui.input}
            value={form.password}
            onChange={(event) => update({ password: event.target.value })}
            autoComplete="current-password"
          />
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={`${ui.button} ${ui.ghost}`}
          onClick={() => void handleTest()}
          disabled={testState === "testing"}
        >
          {testState === "testing" ? "Testing…" : "Test connection"}
        </button>
        {testState === "ok" ? (
          <span className={`${styles.status} ${styles.statusOk}`}>
            <Check size={14} />
            {testMessage}
          </span>
        ) : null}
        {testState === "error" ? (
          <span className={`${styles.status} ${styles.statusError}`}>
            <AlertCircle size={14} />
            {testMessage}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function ServerIcon() {
  return <Server size={18} />;
}
