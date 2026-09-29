import { useCallback, useEffect, useState } from "react";
import { Tv } from "lucide-react";

import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { KuroLogo } from "../components/Navbar";
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

  return (
    <main style={{
      minHeight: "100vh", background: "var(--bg)", padding: "48px 16px",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 36,
    }}>
      <KuroLogo />

      {isPairing ? (
        <section aria-label="Sign in this TV" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, textAlign: "center" }}>Sign in this TV</h1>
          <TvPairing onApproved={refresh} />
          <button onClick={() => setIsPairing(false)} style={secondaryButton}>Sign in with Google instead</button>
        </section>
      ) : (
        <section aria-label="Sign in" style={{ width: "100%", maxWidth: 380, textAlign: "center", display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <h1 style={{ margin: "0 0 6px", fontSize: 28, fontWeight: 800 }}>Sign in</h1>
            <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>
              {isApprovingTv ? "Sign in first, then approve the TV." : "Kuro is for this household only."}
            </p>
          </div>

          {clientId === undefined && <p style={{ color: "var(--dim)", fontSize: 13 }}>Loading…</p>}
          {clientId === null && (
            <p role="alert" style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
              Google sign-in isn't set up yet. Add <code>GOOGLE_CLIENT_ID</code> to the server settings.
            </p>
          )}
          {clientId && <GoogleSignInButton clientId={clientId} onCredential={handleCredential} onLoadError={handleLoadError} />}

          {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--danger-text)", lineHeight: 1.5 }}>{error}</p>}

          <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--dim)", fontSize: 12 }}>
            <span style={{ flex: 1, height: 1, background: "var(--line)" }} /> or <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
          </div>

          <button onClick={() => setIsPairing(true)} style={secondaryButton}>
            <Tv size={16} aria-hidden="true" /> Sign in a TV with a code
          </button>
          <p style={{ margin: 0, fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>
            New here? Ask the admin for an invite link.
          </p>
        </section>
      )}
    </main>
  );
}

const secondaryButton: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, alignSelf: "center",
  minHeight: 44, padding: "0 20px", borderRadius: 999, fontSize: 14, fontWeight: 500,
  background: "var(--surf)", color: "var(--muted)", border: "1px solid var(--line-2)",
};
