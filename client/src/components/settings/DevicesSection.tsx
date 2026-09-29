import { useEffect, useState } from "react";
import { Monitor, Tv } from "lucide-react";

import { useAccount } from "../../context/AccountContext";
import { api } from "../../lib/api";
import { SettingsSection, formatLastUsed, settingsButton, settingsInput } from "./SettingsSection";

import type { SignedInDevice } from "../../lib/types";

export function DevicesSection() {
  const { isAdmin } = useAccount();
  const [devices, setDevices] = useState<SignedInDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  function load() {
    api.auth.devices().then(setDevices).catch((err: Error) => setError(err.message));
  }
  useEffect(load, []);

  function remove(device: SignedInDevice) {
    const question = device.isCurrent ? "Sign out of this device?" : `Sign out "${device.name}"?`;
    if (!window.confirm(question)) return;
    api.auth.removeDevice(device.id)
      .then(() => (device.isCurrent ? window.location.replace("/") : load()))
      .catch((err: Error) => setError(err.message));
  }

  function saveName(device: SignedInDevice) {
    api.auth.renameDevice(device.id, newName)
      .then(() => { setRenamingId(null); load(); })
      .catch((err: Error) => setError(err.message));
  }

  return (
    <SettingsSection
      label="Devices"
      description={isAdmin
        ? "Everyone's signed-in phones, computers and TVs. Signing a device out takes effect immediately."
        : "Your signed-in phones, computers and TVs. Lost a device? Sign it out here."}
    >
      {error && <p role="alert" style={{ fontSize: 13, color: "var(--danger-text)" }}>{error}</p>}
      {!devices && !error && <p style={{ fontSize: 13, color: "var(--dim)" }}>Loading devices…</p>}
      {devices && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {devices.map((device) => (
            <li key={device.id} style={{
              display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "10px 12px",
              borderRadius: 8, background: "var(--surf)", border: "1px solid var(--line)",
            }}>
              {device.kind === "tv"
                ? <Tv size={18} aria-label="TV" style={{ color: "var(--muted)" }} />
                : <Monitor size={18} aria-label="Browser" style={{ color: "var(--muted)" }} />}
              <div style={{ flex: 1, minWidth: 160 }}>
                {renamingId === device.id ? (
                  <form onSubmit={(e) => { e.preventDefault(); saveName(device); }} style={{ display: "flex", gap: 6 }}>
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} aria-label="Device name" autoFocus style={{ ...settingsInput, flex: 1 }} />
                    <button type="submit" style={settingsButton}>Save</button>
                  </form>
                ) : (
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                    {device.name}
                    {device.isCurrent && <span className="mono" style={{ marginLeft: 8, fontSize: 9, letterSpacing: 1, color: "var(--seen-text)" }}>THIS DEVICE</span>}
                  </p>
                )}
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--dim)" }}>
                  {isAdmin ? `${device.ownerName} · ` : ""}last used {formatLastUsed(device.lastUsedAt)}
                </p>
              </div>
              {renamingId !== device.id && (
                <button onClick={() => { setRenamingId(device.id); setNewName(device.name); }} style={settingsButton}>Rename</button>
              )}
              <button onClick={() => remove(device)} style={settingsButton}>{device.isCurrent ? "Sign out" : "Remove"}</button>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
