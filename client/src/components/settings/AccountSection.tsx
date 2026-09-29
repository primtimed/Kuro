import { useState } from "react";
import { Check, LogOut } from "lucide-react";

import { useAccount } from "../../context/AccountContext";
import { api } from "../../lib/api";
import { SettingsSection, settingsButton, settingsInput } from "./SettingsSection";

export function AccountSection() {
  const { me, refresh, signOut } = useAccount();
  const ownProfile = me?.profiles.find((p) => p.isOwner);
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  if (!me || !ownProfile) return null;

  function savePin(next: string | null) {
    setMessage(null);
    api.auth.setPin(next)
      .then(() => {
        setPin("");
        setMessage({ text: next ? "PIN saved" : "PIN removed", isError: false });
        return refresh();
      })
      .catch((err: Error) => setMessage({ text: err.message, isError: true }));
  }

  return (
    <SettingsSection
      label="Your account"
      description={`Signed in as ${me.owner.name} on ${me.device.name}. Signing in with Google proves it's you, so a forgotten PIN can simply be replaced here.`}
    >
      <form
        onSubmit={(e) => { e.preventDefault(); savePin(pin); }}
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--muted)" }}>
          {ownProfile.hasPin ? `${me.owner.name}'s PIN is set · new PIN` : `Protect ${me.owner.name} with a PIN`}
          <input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            pattern="\d{4}"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="4 digits"
            aria-label="New 4-digit PIN"
            style={{ ...settingsInput, width: 110, letterSpacing: 4 }}
          />
        </label>
        <button type="submit" disabled={pin.length !== 4} style={{ ...settingsButton, opacity: pin.length === 4 ? 1 : 0.5 }}>
          {ownProfile.hasPin ? "Change PIN" : "Set PIN"}
        </button>
        {ownProfile.hasPin && (
          <button type="button" onClick={() => savePin(null)} style={settingsButton}>Remove PIN</button>
        )}
      </form>
      {message && (
        <p role={message.isError ? "alert" : "status"} style={{
          display: "flex", alignItems: "center", gap: 6, margin: "10px 0 0", fontSize: 13,
          color: message.isError ? "var(--danger-text)" : "var(--seen-text)",
        }}>
          {!message.isError && <Check size={14} aria-hidden="true" />} {message.text}
        </p>
      )}

      <button onClick={() => void signOut()} style={{ ...settingsButton, marginTop: 18 }}>
        <LogOut size={14} aria-hidden="true" /> Sign out of this device
      </button>
    </SettingsSection>
  );
}
