// Admin-only household management: profiles, invite links and Google account links.
// Mounted behind requireAuth + requireAdmin.

import crypto from "crypto";
import { Router, type Request } from "express";

import db from "../db/client.js";
import { getProfile, listProfiles, type AuthSession } from "../lib/auth.js";
import { createInvite, pendingInviteExpiry, revokeInvites } from "../lib/invites.js";

const router = Router();

const MAX_NAME_LENGTH = 24;
const PROFILE_COLORS = ["#e50914", "#3b82f6", "#a855f7", "#22c55e", "#f59e0b", "#14b8a6", "#ec4899", "#f97316"];
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function initialsOf(name: string): string {
  const letters = name.replace(/[^\p{L}\p{N}]/gu, "");
  return (letters.slice(0, 1).toUpperCase() + letters.slice(1, 2).toLowerCase()) || "?";
}

// The link must point at whichever address the admin is using (public domain or localhost).
function originOf(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] === "https" ? "https" : req.protocol;
  return `${proto}://${req.headers.host}`;
}

// GET /api/family
router.get("/", (_req, res) => {
  const lastActive = new Map(
    (db.prepare("SELECT owner_profile_id, MAX(last_used_at) AS last_used_at FROM sessions GROUP BY owner_profile_id").all() as
      { owner_profile_id: string; last_used_at: number }[]).map((r) => [r.owner_profile_id, r.last_used_at])
  );
  res.json(listProfiles().map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    initial: p.initial,
    isAdmin: !!p.is_admin,
    isShared: !!p.is_shared,
    googleEmail: p.google_email,
    isLinked: !!p.google_sub,
    hasPin: !!p.pin_hash,
    lastActiveAt: lastActive.get(p.id) ?? null,
    inviteExpiresAt: pendingInviteExpiry(p.id),
  })));
});

// POST /api/family/profiles { name }
router.post("/profiles", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, MAX_NAME_LENGTH) : "";
  if (!name) return res.status(400).json({ error: { code: "INVALID_NAME", message: "Name is required" } });

  const count = db.prepare("SELECT COUNT(*) FROM profiles").pluck().get() as number;
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) FROM profiles").pluck().get() as number;
  const id = crypto.randomBytes(6).toString("hex");
  db.prepare("INSERT INTO profiles (id, name, color, initial, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, name, PROFILE_COLORS[count % PROFILE_COLORS.length], initialsOf(name), maxOrder + 1, Date.now());
  return res.json({ ok: true, id });
});

// PATCH /api/family/profiles/:id { name?, color? }
router.patch("/profiles/:id", (req, res) => {
  const profile = getProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });

  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, MAX_NAME_LENGTH) : profile.name;
  const color = typeof req.body?.color === "string" && COLOR_PATTERN.test(req.body.color) ? req.body.color : profile.color;
  if (!name) return res.status(400).json({ error: { code: "INVALID_NAME", message: "Name is required" } });

  db.prepare("UPDATE profiles SET name = ?, color = ?, initial = ? WHERE id = ?").run(name, color, initialsOf(name), profile.id);
  return res.json({ ok: true });
});

// DELETE /api/family/profiles/:id — signs the person out everywhere; their library rows stay
router.delete("/profiles/:id", (req, res) => {
  const profile = getProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
  if (profile.is_admin) return res.status(400).json({ error: { code: "ADMIN_PROFILE", message: "The admin profile can't be removed" } });

  db.transaction(() => {
    db.prepare("DELETE FROM sessions WHERE owner_profile_id = ?").run(profile.id);
    db.prepare("DELETE FROM invites WHERE profile_id = ?").run(profile.id);
    db.prepare("DELETE FROM profiles WHERE id = ?").run(profile.id);
  })();
  return res.json({ ok: true });
});

// POST /api/family/profiles/:id/invite → { url, expiresAt }; replaces any earlier unused link
router.post("/profiles/:id/invite", (req, res) => {
  const profile = getProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
  if (profile.is_shared) {
    return res.status(400).json({ error: { code: "SHARED_PROFILE", message: "Shared profiles are open to everyone and have no Google account" } });
  }
  const { token, expiresAt } = createInvite(profile.id, "invite");
  return res.json({ url: `${originOf(req)}/invite/${token}`, expiresAt });
});

// DELETE /api/family/profiles/:id/invite
router.delete("/profiles/:id/invite", (req, res) => {
  revokeInvites(req.params.id);
  res.json({ ok: true });
});

// POST /api/family/profiles/:id/unlink — detaches the Google account and signs it out everywhere
router.post("/profiles/:id/unlink", (req, res) => {
  const session = req.auth as AuthSession;
  const profile = getProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
  if (profile.id === session.owner.id) {
    return res.status(400).json({ error: { code: "SELF_UNLINK", message: "You can't unlink your own account; that would lock you out" } });
  }
  db.transaction(() => {
    db.prepare("UPDATE profiles SET google_sub = NULL, google_email = NULL WHERE id = ?").run(profile.id);
    db.prepare("DELETE FROM sessions WHERE owner_profile_id = ?").run(profile.id);
  })();
  return res.json({ ok: true });
});

export default router;
