// Verifies "Sign in with Google" ID tokens: signature, issuer, audience (our client id),
// expiry — via Google's official library — plus a verified email.

import { OAuth2Client } from "google-auth-library";

export interface GoogleIdentity {
  sub: string; // stable Google account id
  email: string;
}

let client: OAuth2Client | null = null;

export function getGoogleClientId(): string {
  return process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
}

export async function verifyGoogleCredential(credential: string): Promise<GoogleIdentity> {
  const clientId = getGoogleClientId();
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not configured");
  client ??= new OAuth2Client(clientId);

  const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || !payload.email_verified) {
    throw new Error("Google account has no verified email");
  }
  return { sub: payload.sub, email: payload.email };
}
