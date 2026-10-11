import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { AuthLayout } from "../components/AuthLayout";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
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
    <AuthLayout caption={
      <>
        <p className="mono" style={{ margin: 0, fontSize: 11, letterSpacing: 2, fontWeight: 800, color: "var(--accent-hi)" }}>YOU'RE INVITED</p>
        <p className="auth-headline">Join the<br /><span style={{ color: "var(--accent)" }}>household.</span></p>
      </>
    }>
      {isInvalid && (
        <>
          <h1 className="auth-title">Invite not <span style={{ color: "var(--accent)" }}>valid.</span></h1>
          <p role="alert" className="auth-sub">{error}</p>
        </>
      )}

      {!isInvalid && !invite && <p style={{ color: "var(--dim)" }}>Checking invite…</p>}

      {invite && (
        <>
          <div aria-hidden="true" style={{
            width: 76, height: 76, borderRadius: 16, margin: "22px 0 0", fontSize: 32, fontWeight: 900, color: "var(--text)",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: `linear-gradient(135deg, ${invite.profile.color}, ${invite.profile.color}88)`,
          }}>
            {invite.profile.initial}
          </div>
          <h1 className="auth-title">
            {invite.kind === "setup" ? <>Set up <span style={{ color: "var(--accent)" }}>Kuro.</span></> : <>Hi <span style={{ color: "var(--accent)" }}>{invite.profile.name}.</span></>}
          </h1>
          <p className="auth-sub">
            {invite.kind === "setup"
              ? `Sign in with Google to become the admin, linked to the ${invite.profile.name} profile.`
              : `You're invited to join Kuro as ${invite.profile.name}. Sign in with Google once; after that "Sign in with Google" works on any device.`}
          </p>
          {clientId
            ? <GoogleSignInButton clientId={clientId} onCredential={handleCredential} onLoadError={handleLoadError} isWide />
            : <p role="alert" style={{ fontSize: 13, color: "var(--muted)" }}>Google sign-in isn't set up on the server yet.</p>}
          {error && <p role="alert" style={{ margin: "14px 0 0", fontSize: 13, color: "var(--danger-text)", lineHeight: 1.5 }}>{error}</p>}
          <p style={{ margin: "18px 0 0", fontSize: 12.5, color: "var(--dim)", textAlign: "center" }}>This link works once and expires after 7 days.</p>
        </>
      )}
    </AuthLayout>
  );
}
