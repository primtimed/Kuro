import crypto from "crypto";
import { Router, type Request, type Response } from "express";

import db from "../db/client.js";
import {
  GUEST_PROFILE_ID,
  PIN_PATTERN,
  clientIp,
  createRateLimiter,
  createToken,
  describeDevice,
  endSession,
  getProfile,
  hashPin,
  hashToken,
  listProfiles,
  readSession,
  requireAuth,
  setActiveProfile,
  startSession,
  verifyPin,
  type AuthSession,
  type ProfileRow,
} from "../lib/auth.js";
import { getGoogleClientId, verifyGoogleCredential } from "../lib/google.js";
import { findValidInvite, getAdminName } from "../lib/invites.js";

const router = Router();

const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 5 * 60 * 1000;
const PAIR_TTL_MS = 10 * 60 * 1000;
// No 0/O or 1/I, so codes read unambiguously off a TV screen
const PAIR_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIR_CODE_LENGTH = 8;
const MAX_DEVICE_NAME_LENGTH = 40;

const isLoginAllowed = createRateLimiter(20, 10 * 60 * 1000);
const isInviteLookupAllowed = createRateLimiter(30, 10 * 60 * 1000);
const isPairStartAllowed = createRateLimiter(10, 10 * 60 * 1000);
const isPairPollAllowed = createRateLimiter(400, 10 * 60 * 1000);
const isPairApproveAllowed = createRateLimiter(10, 10 * 60 * 1000);

function sendError(res: Response, status: number, code: string, message: string, extra: object = {}) {
  return res.status(status).json({ error: { code, message, ...extra } });
}

// GET /api/auth/config — the client id is public; the client needs it to render the Google button
router.get("/config", (_req, res) => {
  res.json({ googleClientId: getGoogleClientId() || null });
});

// GET /api/auth/me
router.get("/me", (req, res) => {
  const session = readSession(req, res);
  if (!session) return sendError(res, 401, "UNAUTHENTICATED", "Sign in to use Kuro");
  return res.json(toMe(session));
});

// GET /api/auth/invite/:token — what the invite page shows before signing in
router.get("/invite/:token", (req, res) => {
  if (!isInviteLookupAllowed(clientIp(req))) return sendError(res, 429, "RATE_LIMITED", "Too many attempts, try again later");
  const invite = findValidInvite(req.params.token);
  const profile = invite ? getProfile(invite.profile_id) : undefined;
  if (!invite || !profile) {
    return sendError(res, 410, "INVITE_INVALID", `This invite is no longer valid. Ask ${getAdminName()} for a new one.`);
  }
  return res.json({ kind: invite.kind, profile: { name: profile.name, color: profile.color, initial: profile.initial } });
});

// POST /api/auth/google { credential, invite? }
router.post("/google", async (req, res) => {
  if (!isLoginAllowed(clientIp(req))) return sendError(res, 429, "RATE_LIMITED", "Too many sign-in attempts, try again later");
  const { credential, invite } = (req.body ?? {}) as { credential?: unknown; invite?: unknown };
  if (typeof credential !== "string" || !credential) return sendError(res, 400, "INVALID_REQUEST", "credential is required");

  let identity;
  try {
    identity = await verifyGoogleCredential(credential);
  } catch (err) {
    console.error("[auth] Google sign-in rejected:", (err as Error).message);
    return sendError(res, 401, "INVALID_CREDENTIAL", "Google sign-in failed, please try again");
  }

  const linked = db.prepare("SELECT * FROM profiles WHERE google_sub = ?").get(identity.sub) as ProfileRow | undefined;
  let ownerId: string;

  if (typeof invite === "string" && invite) {
    const row = findValidInvite(invite);
    const profile = row ? getProfile(row.profile_id) : undefined;
    if (!row || !profile) {
      return sendError(res, 410, "INVITE_INVALID", `This invite is no longer valid. Ask ${getAdminName()} for a new one.`);
    }
    if (linked && linked.id !== profile.id) {
      return sendError(res, 409, "ALREADY_LINKED", `This Google account is already linked to ${linked.name}.`);
    }
    db.transaction(() => {
      // Linking a different Google account signs the previous one out everywhere
      if (profile.google_sub && profile.google_sub !== identity.sub) {
        db.prepare("DELETE FROM sessions WHERE owner_profile_id = ?").run(profile.id);
      }
      db.prepare("UPDATE profiles SET google_sub = ?, google_email = ?, is_admin = MAX(is_admin, ?) WHERE id = ?")
        .run(identity.sub, identity.email, row.kind === "setup" ? 1 : 0, profile.id);
      db.prepare("UPDATE invites SET used_at = ? WHERE token_hash = ?").run(Date.now(), row.token_hash);
    })();
    ownerId = profile.id;
  } else {
    if (!linked) {
      return sendError(res, 403, "NOT_A_MEMBER", `This Google account isn't part of this household. Ask ${getAdminName()} for an invite link.`);
    }
    db.prepare("UPDATE profiles SET google_email = ? WHERE id = ?").run(identity.email, linked.id);
    ownerId = linked.id;
  }

  startSession(req, res, ownerId, describeDevice(req.headers["user-agent"]), "browser");
  return res.json({ ok: true });
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

// POST /api/auth/active-profile { profileId, pin? }
// Your own profile, the shared profile, Guest and profiles without a PIN open directly.
router.post("/active-profile", requireAuth, (req, res) => {
  const session = req.auth as AuthSession;
  const { profileId, pin } = (req.body ?? {}) as { profileId?: unknown; pin?: unknown };
  if (typeof profileId !== "string") return sendError(res, 400, "INVALID_REQUEST", "profileId is required");

  if (profileId === GUEST_PROFILE_ID) {
    setActiveProfile(session.tokenHash, GUEST_PROFILE_ID);
    return res.json(toMe({ ...session, activeProfileId: GUEST_PROFILE_ID }));
  }

  const profile = getProfile(profileId);
  if (!profile) return sendError(res, 404, "NOT_FOUND", "Profile not found");

  const isOpen = profile.id === session.owner.id || !!profile.is_shared || !profile.pin_hash;
  if (!isOpen) {
    const now = Date.now();
    if (profile.pin_locked_until > now) {
      return sendError(res, 423, "PIN_LOCKED", "Too many wrong PINs, try again in a few minutes", {
        retryAfterSec: Math.ceil((profile.pin_locked_until - now) / 1000),
      });
    }
    if (typeof pin !== "string" || !pin) return sendError(res, 401, "PIN_REQUIRED", "Enter the PIN for this profile");
    if (!verifyPin(pin, profile.pin_hash as string)) {
      const failures = profile.pin_failures + 1;
      if (failures >= PIN_MAX_FAILURES) {
        db.prepare("UPDATE profiles SET pin_failures = 0, pin_locked_until = ? WHERE id = ?").run(now + PIN_LOCK_MS, profile.id);
        return sendError(res, 423, "PIN_LOCKED", "Too many wrong PINs, try again in a few minutes", { retryAfterSec: PIN_LOCK_MS / 1000 });
      }
      db.prepare("UPDATE profiles SET pin_failures = ? WHERE id = ?").run(failures, profile.id);
      return sendError(res, 401, "PIN_INCORRECT", "Wrong PIN", { attemptsLeft: PIN_MAX_FAILURES - failures });
    }
    db.prepare("UPDATE profiles SET pin_failures = 0 WHERE id = ?").run(profile.id);
  }

  setActiveProfile(session.tokenHash, profile.id);
  return res.json(toMe({ ...session, activeProfileId: profile.id }));
});

// POST /api/auth/pin { pin: "1234" | null } — set, change or remove your own PIN.
// Signing in with Google is the proof of identity, so a forgotten PIN is simply replaced.
router.post("/pin", requireAuth, (req, res) => {
  const session = req.auth as AuthSession;
  const { pin } = (req.body ?? {}) as { pin?: unknown };
  if (pin !== null && (typeof pin !== "string" || !PIN_PATTERN.test(pin))) {
    return sendError(res, 400, "INVALID_PIN", "A PIN is exactly 4 digits");
  }
  db.prepare("UPDATE profiles SET pin_hash = ?, pin_failures = 0, pin_locked_until = 0 WHERE id = ?")
    .run(pin === null ? null : hashPin(pin), session.owner.id);
  return res.json({ ok: true, hasPin: pin !== null });
});

// ── TV pairing ────────────────────────────────────────────────────────────────

// POST /api/auth/pair/start — called by the TV; returns the code to show on screen
router.post("/pair/start", (req, res) => {
  if (!isPairStartAllowed(clientIp(req))) return sendError(res, 429, "RATE_LIMITED", "Too many pairing attempts, try again later");
  const now = Date.now();
  db.prepare("DELETE FROM pairings WHERE expires_at < ?").run(now);

  const code = createPairCode();
  const pollToken = createToken();
  const expiresAt = now + PAIR_TTL_MS;
  db.prepare("INSERT INTO pairings (code, poll_token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(code, hashToken(pollToken), now, expiresAt);
  return res.json({ code: `${code.slice(0, 4)}-${code.slice(4)}`, pollToken, expiresAt });
});

// POST /api/auth/pair/poll { pollToken } — the TV asks whether a phone approved it yet
router.post("/pair/poll", (req, res) => {
  if (!isPairPollAllowed(clientIp(req))) return sendError(res, 429, "RATE_LIMITED", "Too many requests");
  const { pollToken } = (req.body ?? {}) as { pollToken?: unknown };
  if (typeof pollToken !== "string") return sendError(res, 400, "INVALID_REQUEST", "pollToken is required");

  const pollHash = hashToken(pollToken);
  const row = db.prepare("SELECT * FROM pairings WHERE poll_token_hash = ?").get(pollHash) as {
    expires_at: number;
    approved_by_profile_id: string | null;
    device_name: string | null;
  } | undefined;
  if (!row || row.expires_at < Date.now()) {
    if (row) db.prepare("DELETE FROM pairings WHERE poll_token_hash = ?").run(pollHash);
    return res.json({ status: "expired" });
  }
  if (!row.approved_by_profile_id) return res.json({ status: "pending" });

  db.prepare("DELETE FROM pairings WHERE poll_token_hash = ?").run(pollHash);
  startSession(req, res, row.approved_by_profile_id, row.device_name ?? "TV", "tv");
  return res.json({ status: "approved" });
});

// POST /api/auth/pair/approve { code, deviceName } — a signed-in phone approves the TV,
// which then signs in as that person
router.post("/pair/approve", requireAuth, (req, res) => {
  const session = req.auth as AuthSession;
  if (!isPairApproveAllowed(session.tokenHash)) return sendError(res, 429, "RATE_LIMITED", "Too many attempts, try again later");
  const { code, deviceName } = (req.body ?? {}) as { code?: unknown; deviceName?: unknown };
  const normalized = typeof code === "string" ? code.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  const name = typeof deviceName === "string" && deviceName.trim() ? deviceName.trim().slice(0, MAX_DEVICE_NAME_LENGTH) : "TV";

  const result = db.prepare(
    "UPDATE pairings SET approved_by_profile_id = ?, device_name = ? WHERE code = ? AND expires_at > ? AND approved_by_profile_id IS NULL"
  ).run(session.owner.id, name, normalized, Date.now());
  if (result.changes === 0) {
    return sendError(res, 404, "PAIR_CODE_INVALID", "That code is wrong or has expired. Check the code on the TV.");
  }
  return res.json({ ok: true });
});

function createPairCode(): string {
  let code = "";
  for (let i = 0; i < PAIR_CODE_LENGTH; i++) code += PAIR_CODE_ALPHABET[crypto.randomInt(PAIR_CODE_ALPHABET.length)];
  return code;
}

// ── Devices ───────────────────────────────────────────────────────────────────

interface SessionRow {
  token_hash: string;
  owner_profile_id: string;
  device_name: string;
  device_kind: string;
  created_at: number;
  last_used_at: number;
}

// GET /api/auth/devices — your own devices; the admin sees everyone's
router.get("/devices", requireAuth, (req, res) => {
  const session = req.auth as AuthSession;
  const rows = (session.owner.is_admin
    ? db.prepare("SELECT * FROM sessions WHERE expires_at > ? ORDER BY last_used_at DESC").all(Date.now())
    : db.prepare("SELECT * FROM sessions WHERE owner_profile_id = ? AND expires_at > ? ORDER BY last_used_at DESC").all(session.owner.id, Date.now())
  ) as SessionRow[];
  const names = new Map(listProfiles().map((p) => [p.id, p.name]));
  return res.json(rows.map((r) => ({
    id: r.token_hash,
    name: r.device_name,
    kind: r.device_kind,
    ownerName: names.get(r.owner_profile_id) ?? "Unknown",
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    isCurrent: r.token_hash === session.tokenHash,
  })));
});

// PATCH /api/auth/devices/:id { name }
router.patch("/devices/:id", requireAuth, (req, res) => {
  const session = req.auth as AuthSession;
  const { name } = (req.body ?? {}) as { name?: unknown };
  if (typeof name !== "string" || !name.trim()) return sendError(res, 400, "INVALID_REQUEST", "name is required");
  const device = findManageableDevice(req, session);
  if (!device) return sendError(res, 404, "NOT_FOUND", "Device not found");
  db.prepare("UPDATE sessions SET device_name = ? WHERE token_hash = ?").run(name.trim().slice(0, MAX_DEVICE_NAME_LENGTH), device.token_hash);
  return res.json({ ok: true });
});

// DELETE /api/auth/devices/:id — signs that device out
router.delete("/devices/:id", requireAuth, (req, res) => {
  const session = req.auth as AuthSession;
  const device = findManageableDevice(req, session);
  if (!device) return sendError(res, 404, "NOT_FOUND", "Device not found");
  if (device.token_hash === session.tokenHash) endSession(req, res);
  else db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(device.token_hash);
  return res.json({ ok: true });
});

function findManageableDevice(req: Request, session: AuthSession): SessionRow | undefined {
  const device = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(req.params.id) as SessionRow | undefined;
  if (!device) return undefined;
  return device.owner_profile_id === session.owner.id || session.owner.is_admin ? device : undefined;
}

// ── Response shape ────────────────────────────────────────────────────────────

function toMe(session: AuthSession) {
  return {
    owner: { id: session.owner.id, name: session.owner.name, isAdmin: !!session.owner.is_admin },
    activeProfileId: session.activeProfileId,
    device: { name: session.deviceName, kind: session.deviceKind },
    profiles: listProfiles().map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      initial: p.initial,
      isShared: !!p.is_shared,
      isOwner: p.id === session.owner.id,
      // Whether switching to it asks for a PIN from this session
      needsPin: p.id !== session.owner.id && !p.is_shared && !!p.pin_hash,
      hasPin: !!p.pin_hash,
    })),
  };
}

export default router;
