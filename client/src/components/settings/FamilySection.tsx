import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { api } from "../../lib/api";
import { SettingsSection, formatLastUsed, settingsButton, settingsInput } from "./SettingsSection";

import type { FamilyProfile } from "../../lib/types";

interface CreatedInvite {
  profileId: string;
  url: string;
  expiresAt: number;
  qrDataUrl: string | null;
}

// Admin only: who is in the household, and the invite links that let them join.
export function FamilySection() {
  const [profiles, setProfiles] = useState<FamilyProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<CreatedInvite | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function load() {
    api.family.list().then(setProfiles).catch((err: Error) => setError(err.message));
  }
  useEffect(load, []);

  function run(action: Promise<unknown>) {
    setError(null);
    action.then(load).catch((err: Error) => setError(err.message));
  }

  function createInvite(profile: FamilyProfile) {
    setError(null);
    setIsCopied(false);
    api.family.createInvite(profile.id)
      .then(async ({ url, expiresAt }) => {
        const qrDataUrl = await import("qrcode").then((qr) => qr.toDataURL(url, { margin: 1, width: 180 })).catch(() => null);
        setInvite({ profileId: profile.id, url, expiresAt, qrDataUrl });
        load();
      })
      .catch((err: Error) => setError(err.message));
  }

  function copyInvite(url: string) {
    navigator.clipboard.writeText(url)
      .then(() => setIsCopied(true))
      .catch(() => setError("Couldn't copy automatically; select the link and copy it"));
  }

  function confirmThen(question: string, action: () => Promise<unknown>) {
    if (window.confirm(question)) run(action());
  }

  return (
    <SettingsSection
      label="Family"
      description="Only you see this. Send someone an invite link to connect their Google account to their profile. Links work once and expire after 7 days; if one expires, make a new one."
    >
      {error && <p role="alert" style={{ fontSize: 13, color: "var(--danger-text)" }}>{error}</p>}
      {!profiles && !error && <p style={{ fontSize: 13, color: "var(--dim)" }}>Loading family…</p>}

      {profiles && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {profiles.map((p) => (
            <li key={p.id} style={{ padding: "12px 14px", borderRadius: 8, background: "var(--surf)", border: "1px solid var(--line)" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                <div aria-hidden="true" style={{
                  width: 36, height: 36, borderRadius: 7, fontSize: 13, fontWeight: 800, color: "var(--text)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: `linear-gradient(135deg, ${p.color}, ${p.color}88)`,
                }}>
                  {p.initial}
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  {renamingId === p.id ? (
                    <form onSubmit={(e) => { e.preventDefault(); setRenamingId(null); run(api.family.renameProfile(p.id, renameValue)); }} style={{ display: "flex", gap: 6 }}>
                      <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={24} aria-label="Profile name" autoFocus style={{ ...settingsInput, flex: 1 }} />
                      <button type="submit" style={settingsButton}>Save</button>
                    </form>
                  ) : (
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                      {p.name}
                      {p.isAdmin && <Tag>ADMIN</Tag>}
                      {p.isShared && <Tag>SHARED</Tag>}
                    </p>
                  )}
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--dim)" }}>{describeStatus(p)}</p>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {!p.isShared && !p.isAdmin && (
                    <button onClick={() => createInvite(p)} style={settingsButton}>
                      {p.isLinked || p.inviteExpiresAt ? "New invite link" : "Create invite link"}
                    </button>
                  )}
                  {p.inviteExpiresAt && (
                    <button onClick={() => run(api.family.revokeInvite(p.id).then(() => setInvite(null)))} style={settingsButton}>Revoke link</button>
                  )}
                  {p.isLinked && !p.isAdmin && (
                    <button onClick={() => confirmThen(`Unlink ${p.name}'s Google account? They're signed out everywhere and need a new invite link.`, () => api.family.unlink(p.id))} style={settingsButton}>
                      Unlink Google
                    </button>
                  )}
                  {renamingId !== p.id && (
                    <button onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }} style={settingsButton}>Rename</button>
                  )}
                  {!p.isAdmin && (
                    <button onClick={() => confirmThen(`Remove ${p.name}? They're signed out everywhere.`, () => api.family.removeProfile(p.id))} style={settingsButton}>
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {invite?.profileId === p.id && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginTop: 12, padding: 12, borderRadius: 8, background: "var(--surf-2)" }}>
                  {invite.qrDataUrl && <img src={invite.qrDataUrl} alt={`QR code of ${p.name}'s invite link`} width={120} height={120} style={{ borderRadius: 6 }} />}
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--muted)" }}>
                      Send this to {p.name}. Valid until {new Date(invite.expiresAt).toLocaleDateString()} and works once.
                    </p>
                    <input readOnly value={invite.url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} style={{ ...settingsInput, width: "100%", fontSize: 12 }} />
                    <button onClick={() => copyInvite(invite.url)} style={{ ...settingsButton, marginTop: 8 }}>
                      {isCopied ? <><Check size={14} aria-hidden="true" /> Copied</> : <><Copy size={14} aria-hidden="true" /> Copy link</>}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); run(api.family.addProfile(newProfileName).then(() => setNewProfileName(""))); }}
        style={{ display: "flex", gap: 8, marginTop: 14 }}
      >
        <input value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} maxLength={24} placeholder="New profile name" aria-label="New profile name" style={{ ...settingsInput, flex: "0 1 240px" }} />
        <button type="submit" disabled={!newProfileName.trim()} style={{ ...settingsButton, opacity: newProfileName.trim() ? 1 : 0.5 }}>Add profile</button>
      </form>
    </SettingsSection>
  );
}

function Tag({ children }: { children: string }) {
  return <span className="mono" style={{ marginLeft: 8, fontSize: 9, letterSpacing: 1, color: "var(--muted)" }}>{children}</span>;
}

function describeStatus(p: FamilyProfile): string {
  if (p.isShared) return "Shared profile · open to everyone who is signed in";
  const active = p.lastActiveAt ? ` · last active ${formatLastUsed(p.lastActiveAt)}` : "";
  if (p.isLinked) return `Linked to ${p.googleEmail ?? "a Google account"}${active}`;
  if (p.inviteExpiresAt) return `Invite link sent · valid until ${new Date(p.inviteExpiresAt).toLocaleDateString()}`;
  return "Not linked yet";
}
