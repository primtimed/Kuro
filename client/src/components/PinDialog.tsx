import { useEffect, useState } from "react";
import { Delete } from "lucide-react";

import { api, ApiError } from "../lib/api";

import type { Account } from "../lib/accounts";

const PIN_LENGTH = 4;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"] as const;

interface PinDialogProps {
  profile: Account;
  onUnlocked: () => void;
  onCancel: () => void;
}

// On-screen keypad so a TV remote can enter the PIN; physical keyboards work too.
export function PinDialog({ profile, onUnlocked, onCancel }: PinDialogProps) {
  const [digits, setDigits] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    if (digits.length !== PIN_LENGTH) return;
    setIsChecking(true);
    api.auth.switchProfile(profile.id, digits)
      .then(onUnlocked)
      .catch((err: unknown) => {
        setDigits("");
        setMessage(describePinError(err));
      })
      .finally(() => setIsChecking(false));
  }, [digits, profile.id, onUnlocked]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      else if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("back");
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  function press(key: string) {
    if (isChecking) return;
    setMessage(null);
    if (key === "back") setDigits((d) => d.slice(0, -1));
    else setDigits((d) => (d.length < PIN_LENGTH ? d + key : d));
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="pin-title" style={{
      position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        width: "100%", maxWidth: 340, padding: 28, borderRadius: 14, textAlign: "center",
        background: "var(--surf)", border: "1px solid var(--line-2)",
      }}>
        <div aria-hidden="true" style={{
          width: 64, height: 64, margin: "0 auto 14px", borderRadius: 10, fontSize: 22, fontWeight: 800,
          display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text)",
          background: `linear-gradient(135deg, ${profile.color}, ${profile.color}88)`,
        }}>
          {profile.initial}
        </div>
        <h2 id="pin-title" style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700 }}>Enter {profile.name}'s PIN</h2>
        <p aria-live="polite" style={{ margin: "0 0 18px", minHeight: 18, fontSize: 13, color: message ? "var(--danger-text)" : "var(--muted)" }}>
          {message ?? (isChecking ? "Checking…" : "4 digits")}
        </p>

        <div aria-label={`${digits.length} of ${PIN_LENGTH} digits entered`} style={{ display: "flex", justifyContent: "center", gap: 14, marginBottom: 22 }}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span key={i} style={{
              width: 14, height: 14, borderRadius: "50%",
              background: i < digits.length ? "var(--text)" : "transparent",
              border: "2px solid var(--muted)",
            }} />
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {KEYS.map((key, i) => key === "" ? <span key={i} /> : (
            <button
              key={key}
              onClick={() => press(key)}
              data-tv-autofocus={key === "1" ? true : undefined}
              aria-label={key === "back" ? "Delete last digit" : key}
              style={{
                minHeight: 56, borderRadius: 10, fontSize: 22, fontWeight: 600,
                background: "var(--surf-2)", color: "var(--text)", border: "1px solid var(--line-2)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {key === "back" ? <Delete size={20} aria-hidden="true" /> : key}
            </button>
          ))}
        </div>

        <button onClick={onCancel} style={{
          marginTop: 16, minHeight: 44, padding: "0 20px", borderRadius: 8, fontSize: 14,
          background: "transparent", color: "var(--muted)", border: "1px solid var(--line-2)",
        }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function describePinError(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something went wrong, try again";
  if (err.code === "PIN_INCORRECT") {
    const left = err.details.attemptsLeft as number | undefined;
    return left ? `Wrong PIN · ${left} ${left === 1 ? "try" : "tries"} left` : "Wrong PIN";
  }
  if (err.code === "PIN_LOCKED") {
    const minutes = Math.ceil(((err.details.retryAfterSec as number | undefined) ?? 300) / 60);
    return `Too many wrong PINs. Try again in ${minutes} min`;
  }
  return err.message;
}
