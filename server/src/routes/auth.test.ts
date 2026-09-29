import crypto from "crypto";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import db from "../db/client.js";
import { rejectCrossSiteWrites, requireAdmin, requireAuth } from "../lib/auth.js";
import { createInvite } from "../lib/invites.js";
import authRouter from "./auth.js";
import familyRouter from "./family.js";
import libraryRouter from "./library.js";

// Google's token check is a network call; the stand-in accepts credentials shaped "sub|email".
vi.mock("../lib/google.js", () => ({
  getGoogleClientId: () => "test-client-id",
  verifyGoogleCredential: async (credential: string) => {
    const [sub, email] = credential.split("|");
    if (!sub || !email) throw new Error("invalid token");
    return { sub, email };
  },
}));

let baseUrl = "";
let server: ReturnType<express.Express["listen"]>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", rejectCrossSiteWrites);
  app.use("/api/auth", authRouter);
  app.use("/api", requireAuth);
  app.use("/api/family", requireAdmin, familyRouter);
  app.use("/api/library", libraryRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => { server.close(); });

// Minimal browser: remembers the session cookie between requests. Each device has its own
// client IP so the per-IP sign-in rate limit applies per device, as it does in real use.
class Device {
  cookie = "";
  lastSetCookie = "";
  ip = `10.${crypto.randomInt(256)}.${crypto.randomInt(256)}.${crypto.randomInt(256)}`;

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Real-IP": this.ip, ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      this.lastSetCookie = setCookie;
      const pair = setCookie.split(";")[0];
      this.cookie = pair.endsWith("=") ? "" : pair;
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
}

function makeProfile(name: string, options: { isAdmin?: boolean; isShared?: boolean } = {}): string {
  const id = crypto.randomBytes(6).toString("hex");
  db.prepare("INSERT INTO profiles (id, name, color, initial, is_admin, is_shared, created_at) VALUES (?, ?, '#000000', 'X', ?, ?, ?)")
    .run(id, name, options.isAdmin ? 1 : 0, options.isShared ? 1 : 0, Date.now());
  return id;
}

function uniqueGoogleAccount(): string {
  const sub = crypto.randomBytes(8).toString("hex");
  return `${sub}|${sub}@gmail.com`;
}

async function joinWithInvite(profileId: string, kind: "invite" | "setup" = "invite") {
  const device = new Device();
  const account = uniqueGoogleAccount();
  const { token } = createInvite(profileId, kind);
  await device.call("POST", "/api/auth/google", { credential: account, invite: token });
  return { device, account };
}

describe("sign-in", () => {
  it("rejects API calls without a session", async () => {
    const res = await new Device().call("GET", "/api/library/favorites");
    expect(res.status).toBe(401);
  });

  it("links the admin through the setup link", async () => {
    const adminId = makeProfile("Admin", { isAdmin: true });
    const { device } = await joinWithInvite(adminId, "setup");
    const me = await device.call("GET", "/api/auth/me");
    expect(me.body.owner).toEqual({ id: adminId, name: "Admin", isAdmin: true });
  });

  it("lets a linked member sign in again without an invite", async () => {
    const { account } = await joinWithInvite(makeProfile("Ronny"));
    const res = await new Device().call("POST", "/api/auth/google", { credential: account });
    expect(res.status).toBe(200);
  });

  it("refuses Google accounts that were never invited", async () => {
    const res = await new Device().call("POST", "/api/auth/google", { credential: uniqueGoogleAccount() });
    expect(res.body.error.code).toBe("NOT_A_MEMBER");
  });

  it("sets the session cookie as HttpOnly", async () => {
    const { device } = await joinWithInvite(makeProfile("Cookie"));
    expect(device.lastSetCookie).toMatch(/HttpOnly/i);
  });
});

describe("invite links", () => {
  it("work only once", async () => {
    const profileId = makeProfile("Once");
    const { token } = createInvite(profileId, "invite");
    await new Device().call("POST", "/api/auth/google", { credential: uniqueGoogleAccount(), invite: token });
    const second = await new Device().call("POST", "/api/auth/google", { credential: uniqueGoogleAccount(), invite: token });
    expect(second.status).toBe(410);
  });

  it("stop working after they expire", async () => {
    const { token } = createInvite(makeProfile("Expired"), "invite");
    db.prepare("UPDATE invites SET expires_at = ? WHERE used_at IS NULL AND expires_at > ?").run(Date.now() - 1, Date.now());
    const res = await new Device().call("GET", `/api/auth/invite/${token}`);
    expect(res.status).toBe(410);
  });

  it("are replaced when the admin creates a new one", async () => {
    const profileId = makeProfile("Replaced");
    const { token: oldToken } = createInvite(profileId, "invite");
    createInvite(profileId, "invite");
    const res = await new Device().call("GET", `/api/auth/invite/${oldToken}`);
    expect(res.status).toBe(410);
  });

  it("refuse a Google account already linked to another profile", async () => {
    const { account } = await joinWithInvite(makeProfile("First"));
    const { token } = createInvite(makeProfile("Second"), "invite");
    const res = await new Device().call("POST", "/api/auth/google", { credential: account, invite: token });
    expect(res.status).toBe(409);
  });
});

describe("profile PINs", () => {
  async function setup() {
    const ownerId = makeProfile("Owner");
    const otherId = makeProfile("Other");
    const other = await joinWithInvite(otherId);
    await other.device.call("POST", "/api/auth/pin", { pin: "4321" });
    const { device } = await joinWithInvite(ownerId);
    return { device, ownerId, otherId };
  }

  it("ask for the PIN when opening someone else's protected profile", async () => {
    const { device, otherId } = await setup();
    const res = await device.call("POST", "/api/auth/active-profile", { profileId: otherId });
    expect(res.body.error.code).toBe("PIN_REQUIRED");
  });

  it("open the profile with the right PIN", async () => {
    const { device, otherId } = await setup();
    const res = await device.call("POST", "/api/auth/active-profile", { profileId: otherId, pin: "4321" });
    expect(res.body.activeProfileId).toBe(otherId);
  });

  it("lock the profile after five wrong PINs", async () => {
    const { device, otherId } = await setup();
    const attempt = () => device.call("POST", "/api/auth/active-profile", { profileId: otherId, pin: "0000" });
    await attempt(); await attempt(); await attempt(); await attempt();
    const fifth = await attempt();
    expect(fifth.status).toBe(423);
  });

  it("never ask for your own PIN", async () => {
    const { device, ownerId } = await setup();
    await device.call("POST", "/api/auth/pin", { pin: "1111" });
    const res = await device.call("POST", "/api/auth/active-profile", { profileId: ownerId });
    expect(res.body.activeProfileId).toBe(ownerId);
  });

  it("must be four digits", async () => {
    const { device } = await joinWithInvite(makeProfile("Digits"));
    const res = await device.call("POST", "/api/auth/pin", { pin: "12ab" });
    expect(res.status).toBe(400);
  });
});

describe("guest", () => {
  it("doesn't save anything", async () => {
    const { device } = await joinWithInvite(makeProfile("Host"));
    await device.call("POST", "/api/auth/active-profile", { profileId: "guest" });
    await device.call("POST", "/api/library/favorites", { media_id: "anilist:1", type: "anime", title: "Cowboy Bebop" });
    const saved = db.prepare("SELECT COUNT(*) FROM favorites WHERE account_id = 'guest'").pluck().get();
    expect(saved).toBe(0);
  });
});

describe("TV pairing", () => {
  async function approvedTv() {
    const ownerId = makeProfile("Viewer");
    const { device: phone } = await joinWithInvite(ownerId);
    const tv = new Device();
    const start = await tv.call("POST", "/api/auth/pair/start");
    await phone.call("POST", "/api/auth/pair/approve", { code: start.body.code, deviceName: "Living room TV" });
    const poll = await tv.call("POST", "/api/auth/pair/poll", { pollToken: start.body.pollToken });
    return { tv, phone, ownerId, start, poll };
  }

  it("keeps the TV waiting until someone approves", async () => {
    const tv = new Device();
    const start = await tv.call("POST", "/api/auth/pair/start");
    const poll = await tv.call("POST", "/api/auth/pair/poll", { pollToken: start.body.pollToken });
    expect(poll.body.status).toBe("pending");
  });

  it("signs the TV in as the person who approved it", async () => {
    const { tv, ownerId } = await approvedTv();
    const me = await tv.call("GET", "/api/auth/me");
    expect(me.body.owner.id).toBe(ownerId);
  });

  it("names the TV as entered on the phone", async () => {
    const { tv } = await approvedTv();
    const me = await tv.call("GET", "/api/auth/me");
    expect(me.body.device).toEqual({ name: "Living room TV", kind: "tv" });
  });

  it("accepts each code only once", async () => {
    const { phone, start } = await approvedTv();
    const again = await phone.call("POST", "/api/auth/pair/approve", { code: start.body.code });
    expect(again.status).toBe(404);
  });

  it("expires codes nobody approved in time", async () => {
    const tv = new Device();
    const start = await tv.call("POST", "/api/auth/pair/start");
    db.prepare("UPDATE pairings SET expires_at = ?").run(Date.now() - 1);
    const poll = await tv.call("POST", "/api/auth/pair/poll", { pollToken: start.body.pollToken });
    expect(poll.body.status).toBe("expired");
  });

  it("can't be approved without signing in", async () => {
    const tv = new Device();
    const start = await tv.call("POST", "/api/auth/pair/start");
    const res = await new Device().call("POST", "/api/auth/pair/approve", { code: start.body.code });
    expect(res.status).toBe(401);
  });
});

describe("devices", () => {
  it("signing a device out ends its session", async () => {
    const { tv, phone } = await (async () => {
      const ownerId = makeProfile("Remover");
      const { device: phoneDevice } = await joinWithInvite(ownerId);
      const tvDevice = new Device();
      const start = await tvDevice.call("POST", "/api/auth/pair/start");
      await phoneDevice.call("POST", "/api/auth/pair/approve", { code: start.body.code });
      await tvDevice.call("POST", "/api/auth/pair/poll", { pollToken: start.body.pollToken });
      return { tv: tvDevice, phone: phoneDevice };
    })();
    const devices = await phone.call("GET", "/api/auth/devices");
    const tvId = devices.body.find((d: { kind: string }) => d.kind === "tv").id;
    await phone.call("DELETE", `/api/auth/devices/${tvId}`);
    const res = await tv.call("GET", "/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("members only see their own devices", async () => {
    await joinWithInvite(makeProfile("Someone"));
    const { device } = await joinWithInvite(makeProfile("Private"));
    const devices = await device.call("GET", "/api/auth/devices");
    expect(devices.body).toHaveLength(1);
  });
});

describe("family admin", () => {
  it("is off-limits to members", async () => {
    const { device } = await joinWithInvite(makeProfile("Member"));
    const res = await device.call("GET", "/api/family");
    expect(res.status).toBe(403);
  });

  it("creates invite links on the address the admin is using", async () => {
    const { device } = await joinWithInvite(makeProfile("Boss", { isAdmin: true }), "setup");
    const res = await device.call("POST", `/api/family/profiles/${makeProfile("Invitee")}/invite`);
    expect(res.body.url).toMatch(new RegExp(`^${baseUrl}/invite/[A-Za-z0-9_-]{43}$`));
  });

  it("unlinking a member signs them out everywhere", async () => {
    const memberId = makeProfile("Unlinked");
    const { device: member } = await joinWithInvite(memberId);
    const { device: admin } = await joinWithInvite(makeProfile("Chief", { isAdmin: true }), "setup");
    await admin.call("POST", `/api/family/profiles/${memberId}/unlink`);
    const res = await member.call("GET", "/api/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("request guards", () => {
  it("rate-limit repeated sign-in attempts from one address", async () => {
    const attacker = new Device();
    const attempts = Array.from({ length: 21 }, () => attacker.call("POST", "/api/auth/google", { credential: uniqueGoogleAccount() }));
    const statuses = (await Promise.all(attempts)).map((r) => r.status);
    expect(statuses).toContain(429);
  });

  it("block writes coming from other websites", async () => {
    const { device } = await joinWithInvite(makeProfile("Target"));
    const res = await device.call("POST", "/api/auth/pin", { pin: "9999" }, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});
