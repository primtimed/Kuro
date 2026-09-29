import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check } from "lucide-react";

import { useAccount } from "../context/AccountContext";
import { api } from "../lib/api";
import { useIsMobile } from "../hooks/useIsMobile";

// Opened on a signed-in phone (usually via the TV's QR code) to approve that TV.
export function Pair() {
  const isMobile = useIsMobile();
  const { me } = useAccount();
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get("code") ?? "");
  const [deviceName, setDeviceName] = useState("Living room TV");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [approvedName, setApprovedName] = useState<string | null>(null);

  function handleApprove(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    api.auth.approvePairing(code, deviceName)
      .then(() => setApprovedName(deviceName.trim() || "TV"))
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsSaving(false));
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", minHeight: 48, padding: "0 14px", borderRadius: 8, fontSize: 16, fontFamily: "inherit",
    background: "var(--surf)", color: "var(--text)", border: "1px solid var(--line-2)",
  };

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", padding: isMobile ? "80px 16px 48px" : "96px 32px 64px" }}>
      <div style={{ maxWidth: 420, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 800 }}>Sign in a TV</h1>
        <p style={{ margin: "0 0 28px", fontSize: 14, color: "var(--muted)", lineHeight: 1.5 }}>
          Enter the code shown on the TV. It will be signed in as {me?.owner.name ?? "you"} and can switch to other profiles with their PIN.
        </p>

        {approvedName ? (
          <p role="status" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "var(--seen-text)" }}>
            <Check size={18} aria-hidden="true" /> Approved. {approvedName} will sign in within a few seconds.
          </p>
        ) : (
          <form onSubmit={handleApprove} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              Code on the TV
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABCD-EFGH"
                autoComplete="off"
                autoCapitalize="characters"
                required
                className="mono"
                style={{ ...inputStyle, fontSize: 22, letterSpacing: 3 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              Name this TV
              <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} maxLength={40} style={inputStyle} />
            </label>
            {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--danger-text)" }}>{error}</p>}
            <button type="submit" disabled={isSaving} style={{
              minHeight: 48, borderRadius: 8, fontSize: 15, fontWeight: 700,
              background: "var(--accent)", color: "var(--text)", border: "none", opacity: isSaving ? 0.6 : 1,
            }}>
              {isSaving ? "Approving…" : "Approve TV"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
