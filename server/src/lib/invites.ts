// One-time links that attach a Google account to a profile. Only the link's hash is stored,
// so the database alone can't be used to join. 'setup' links also make the profile admin.

import db from "../db/client.js";
import { createToken, hashToken, type ProfileRow } from "./auth.js";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface InviteRow {
  token_hash: string;
  profile_id: string;
  kind: "invite" | "setup";
  expires_at: number;
  used_at: number | null;
}

// Creating a link replaces any unused one for the same profile, so only the newest works.
export function createInvite(profileId: string, kind: "invite" | "setup"): { token: string; expiresAt: number } {
  const token = createToken();
  const now = Date.now();
  const expiresAt = now + INVITE_TTL_MS;
  db.transaction(() => {
    db.prepare("DELETE FROM invites WHERE profile_id = ? AND used_at IS NULL").run(profileId);
    db.prepare("INSERT INTO invites (token_hash, profile_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(hashToken(token), profileId, kind, now, expiresAt);
  })();
  return { token, expiresAt };
}

export function findValidInvite(token: string): InviteRow | null {
  const row = db.prepare("SELECT * FROM invites WHERE token_hash = ?").get(hashToken(token)) as InviteRow | undefined;
  return row && !row.used_at && row.expires_at > Date.now() ? row : null;
}

export function revokeInvites(profileId: string): void {
  db.prepare("DELETE FROM invites WHERE profile_id = ? AND used_at IS NULL").run(profileId);
}

export function pendingInviteExpiry(profileId: string): number | null {
  const row = db.prepare("SELECT MAX(expires_at) AS expires_at FROM invites WHERE profile_id = ? AND used_at IS NULL AND expires_at > ?")
    .get(profileId, Date.now()) as { expires_at: number | null };
  return row.expires_at;
}

export function getAdminName(): string {
  const row = db.prepare("SELECT name FROM profiles WHERE is_admin = 1 ORDER BY sort_order LIMIT 1").get() as { name: string } | undefined;
  return row?.name ?? "the admin";
}

// Until an admin has linked a Google account nobody can sign in, so print a setup link
// in the server log. Also used by the recovery script when the admin is locked out.
export function printAdminSetupLink(): void {
  const admin = db.prepare("SELECT * FROM profiles WHERE is_admin = 1 ORDER BY sort_order LIMIT 1").get() as ProfileRow | undefined;
  if (!admin) {
    console.error("[auth] No admin profile exists; cannot create a setup link");
    return;
  }
  const { token } = createInvite(admin.id, "setup");
  const base = (process.env.PUBLIC_URL ?? "http://localhost:7000").replace(/\/$/, "");
  console.log(
    `\n[auth] Admin setup link for "${admin.name}" (works once, valid 7 days):\n` +
    `[auth]   ${base}/invite/${token}\n` +
    `[auth] Open it, sign in with Google, and ${admin.name} becomes the admin.\n`
  );
}

export function ensureAdminSetupLink(): void {
  const linkedAdmin = db.prepare("SELECT 1 FROM profiles WHERE is_admin = 1 AND google_sub IS NOT NULL").get();
  if (!linkedAdmin) printAdminSetupLink();
}
