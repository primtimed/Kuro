import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { KuroLogo } from "../components/Navbar";
import { api } from "../lib/api";

import type { InviteInfo } from "../lib/types";

export function Invite() {
  const { token = "" } = useParams();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    api.auth.invite(token)
      .then(setInvite)
      .catch((err: Error) => { setIsInvalid(true); setError(err.message); });
    api.auth.config()
      .then((c) => setClientId(c.googleClientId))
      .catch(() => setClientId(null));
  }, [token]);

  const handleCredential = useCallback((credential: string) => {
    setError(null);
    api.auth.signInWithGoogle(credential, token)
      // Full reload: the invite URL must not stay in the address bar or history state
      .then(() => { window.location.replace("/"); })
      .catch((err: Error) => setError(err.message));
  }, [token]);

  const handleLoadError = useCallback((message: string) => setError(message), []);

  return (
    <main style={{
      minHeight: "100vh", background: "var(--bg)", padding: "48px 16px",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 32,
    }}>
      <KuroLogo />
      <section aria-label="Join Kuro" style={{ width: "100%", maxWidth: 380, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        {isInvalid && (
          <>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Invite not valid</h1>
            <p role="alert" style={{ margin: 0, fontSize: 14, color: "var(--muted)", lineHeight: 1.5 }}>{error}</p>
          </>
        )}

        {!isInvalid && !invite && <p style={{ color: "var(--dim)" }}>Checking invite…</p>}

        {invite && (
          <>
            <div aria-hidden="true" style={{
              width: 88, height: 88, borderRadius: 12, fontSize: 30, fontWeight: 800, color: "var(--text)",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: `linear-gradient(135deg, ${invite.profile.color}, ${invite.profile.color}88)`,
            }}>
              {invite.profile.initial}
            </div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>
              {invite.kind === "setup" ? "Set up Kuro" : `Join Kuro as ${invite.profile.name}`}
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: "var(--muted)", lineHeight: 1.5 }}>
              {invite.kind === "setup"
                ? `Sign in with Google to become the admin, linked to the ${invite.profile.name} profile.`
                : `Sign in with Google once. After that you just use "Sign in with Google" on any device.`}
            </p>
            {clientId
              ? <GoogleSignInButton clientId={clientId} onCredential={handleCredential} onLoadError={handleLoadError} />
              : <p role="alert" style={{ fontSize: 13, color: "var(--muted)" }}>Google sign-in isn't set up on the server yet.</p>}
            {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--danger-text)", lineHeight: 1.5 }}>{error}</p>}
            <p style={{ margin: 0, fontSize: 12, color: "var(--dim)" }}>This link works once and expires after 7 days.</p>
          </>
        )}
      </section>
    </main>
  );
}
