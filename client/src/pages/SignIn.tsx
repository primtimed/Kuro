import { useCallback, useEffect, useState } from "react";
import { Tv } from "lucide-react";

import { AuthLayout } from "../components/AuthLayout";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { TvPairing } from "../components/TvPairing";
import { useAccount } from "../context/AccountContext";
import { api } from "../lib/api";

// TV browsers where typing a Google password with a remote is painful — go straight to a code
const TV_USER_AGENT = /AFT|SmartTV|SMART-TV|Tizen|Web0S|webOS|BRAVIA|Android TV|CrKey|HbbTV|NetCast/i;

export function SignIn() {
  const { refresh } = useAccount();
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(() => TV_USER_AGENT.test(navigator.userAgent));
  const isApprovingTv = window.location.pathname === "/pair";

  useEffect(() => {
    api.auth.config()
      .then((c) => setClientId(c.googleClientId))
      .catch(() => setClientId(null));
  }, []);

  const handleCredential = useCallback((credential: string) => {
    setError(null);
    api.auth.signInWithGoogle(credential)
      .then(refresh)
      .catch((err: Error) => setError(err.message));
  }, [refresh]);

  const handleLoadError = useCallback((message: string) => setError(message), []);

  const caption = (
    <>
      <p className="mono" style={{ margin: 0, fontSize: 11, letterSpacing: 2, fontWeight: 800, color: "var(--accent-hi)" }}>YOUR HOUSEHOLD'S STREAMING</p>
      <p className="auth-headline">Anime, TV &amp;<br /><span style={{ color: "var(--accent)" }}>live channels.</span></p>
      <p style={{ margin: "14px 0 0", maxWidth: 520, fontSize: 15, lineHeight: 1.6, color: "var(--hero-text)" }}>
        One place for everyone at home — with your own profile, watch progress and lists on every device.
      </p>
    </>
  );

  if (isPairing) {
    return (
      <AuthLayout caption={caption}>
        <h1 className="auth-title">Sign in <span style={{ color: "var(--accent)" }}>this TV.</span></h1>
        <p className="auth-sub">Approve this screen from a phone that's already signed in.</p>
        <TvPairing onApproved={refresh} />
        <button onClick={() => setIsPairing(false)} className="btn-slant btn-slant--ghost" style={{ width: "100%", justifyContent: "center", marginTop: 24 }}>
          Sign in with Google instead
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout caption={caption}>
      <h1 className="auth-title">Welcome <span style={{ color: "var(--accent)" }}>back.</span></h1>
      <p className="auth-sub">
        {isApprovingTv
          ? "Sign in first, then approve the TV."
          : "Kuro is for this household only. Sign in with the Google account linked to your profile."}
      </p>

      {clientId === undefined && <p style={{ color: "var(--dim)", fontSize: 13 }}>Loading…</p>}
      {clientId === null && (
        <p role="alert" style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
          Google sign-in isn't set up yet. Add <code>GOOGLE_CLIENT_ID</code> to the server settings.
        </p>
      )}
      {clientId && <GoogleSignInButton clientId={clientId} onCredential={handleCredential} onLoadError={handleLoadError} isWide />}

      {error && <p role="alert" style={{ margin: "14px 0 0", fontSize: 13, color: "var(--danger-text)", lineHeight: 1.5 }}>{error}</p>}

      <div aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0", color: "var(--dim)", fontSize: 12 }}>
        <span style={{ flex: 1, height: 1, background: "var(--line)" }} /> or <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
      </div>

      <button onClick={() => setIsPairing(true)} className="btn-slant btn-slant--ghost" style={{ width: "100%", justifyContent: "center" }}>
        <Tv size={16} aria-hidden="true" /> Sign in a TV with a code
      </button>
      <p style={{ margin: "18px 0 0", fontSize: 12.5, color: "var(--dim)", textAlign: "center", lineHeight: 1.5 }}>
        New here? Ask the admin for an invite link.
      </p>
    </AuthLayout>
  );
}
