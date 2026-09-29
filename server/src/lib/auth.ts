// Sessions, PINs and request guards for household sign-in.
// A session belongs to the person who signed in (owner) and remembers which profile the
// device is using (active). Tokens and PINs are stored only as hashes.

import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

import db from "../db/client.js";

export const SESSION_COOKIE = "kuro_session";
export const GUEST_PROFILE_ID = "guest";
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// Rolling expiry: refreshed at most once a day so every request isn't a DB write
const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

export interface ProfileRow {
  id: string;
  name: string;
  color: string;
  initial: string;
  is_admin: number;
  is_shared: number;
  google_sub: string | null;
  google_email: string | null;
  pin_hash: string | null;
  pin_failures: number;
  pin_locked_until: number;
  sort_order: number;
}

export interface AuthSession {
  tokenHash: string;
  owner: ProfileRow;
  activeProfileId: string;
  deviceName: string;
  deviceKind: "browser" | "tv";
}

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthSession;
  }
}

export function createToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getProfile(id: string): ProfileRow | undefined {
  return db.prepare("SELECT * FROM profiles WHERE id = ?").get(id) as ProfileRow | undefined;
}

export function listProfiles(): ProfileRow[] {
  return db.prepare("SELECT * FROM profiles ORDER BY sort_order, created_at").all() as ProfileRow[];
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function startSession(req: Request, res: Response, ownerId: string, deviceName: string, deviceKind: "browser" | "tv"): void {
  const token = createToken();
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (token_hash, owner_profile_id, active_profile_id, device_name, device_kind, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(hashToken(token), ownerId, ownerId, deviceName, deviceKind, now, now, now + SESSION_TTL_MS);
  setSessionCookie(req, res, token);
}

export function endSession(req: Request, res: Response): void {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  res.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, sameSite: "lax", secure: isHttps(req) });
}

export function readSession(req: Request, res: Response): AuthSession | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const row = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash) as {
    owner_profile_id: string;
    active_profile_id: string;
    device_name: string;
    device_kind: "browser" | "tv";
    last_used_at: number;
    expires_at: number;
  } | undefined;
  const now = Date.now();
  if (!row || row.expires_at < now) {
    if (row) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }

  const owner = getProfile(row.owner_profile_id);
  if (!owner) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }

  if (now - row.last_used_at > SESSION_RENEW_AFTER_MS) {
    db.prepare("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?").run(now, now + SESSION_TTL_MS, tokenHash);
    setSessionCookie(req, res, token);
  }

  // A deleted profile falls back to the owner's own profile
  const isActiveValid = row.active_profile_id === GUEST_PROFILE_ID || !!getProfile(row.active_profile_id);
  return {
    tokenHash,
    owner,
    activeProfileId: isActiveValid ? row.active_profile_id : owner.id,
    deviceName: row.device_name,
    deviceKind: row.device_kind,
  };
}

export function setActiveProfile(tokenHash: string, profileId: string): void {
  db.prepare("UPDATE sessions SET active_profile_id = ? WHERE token_hash = ?").run(profileId, tokenHash);
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(req),
    maxAge: SESSION_TTL_MS,
  });
}

// Cloudflare terminates TLS and forwards plain HTTP, so the original scheme comes from the header.
function isHttps(req: Request): boolean {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

// ── Guards ────────────────────────────────────────────────────────────────────

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = readSession(req, res);
  if (!session) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to use Kuro" } });
    return;
  }
  req.auth = session;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth?.owner.is_admin) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Only the admin can do this" } });
    return;
  }
  next();
}

// SameSite=Lax already keeps the cookie off cross-site POSTs; this also rejects them explicitly.
export function rejectCrossSiteWrites(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !origin) return next();
  let originHost = "";
  try { originHost = new URL(origin).host; } catch { /* malformed origin is rejected below */ }
  if (originHost !== req.headers.host) {
    res.status(403).json({ error: { code: "CROSS_SITE", message: "Cross-site request blocked" } });
    return;
  }
  next();
}

// Guest browses without leaving history, favourites or likes behind.
export function ignoreGuestWrites(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.activeProfileId === GUEST_PROFILE_ID && req.method !== "GET") {
    res.json({ ok: true });
    return;
  }
  next();
}

export function activeProfileId(req: Request): string {
  if (!req.auth) throw new Error("activeProfileId used on a route without requireAuth");
  return req.auth.activeProfileId;
}

// ── PINs ──────────────────────────────────────────────────────────────────────

export const PIN_PATTERN = /^\d{4}$/;

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, 32);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return function isAllowed(key: string): boolean {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      if (hits.size > 10_000) for (const [k, e] of hits) if (e.resetAt < now) hits.delete(k);
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= limit;
  };
}

// Behind Cloudflare and nginx the socket address is the proxy's, so prefer the forwarded client IP.
export function clientIp(req: Request): string {
  const forwarded = req.headers["cf-connecting-ip"] ?? req.headers["x-real-ip"];
  return (typeof forwarded === "string" && forwarded) || req.socket.remoteAddress || "unknown";
}

export function describeDevice(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
