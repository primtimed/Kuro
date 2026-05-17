import { useState } from "react";
import { ACCOUNTS, GUEST_ACCOUNT, type Account } from "../lib/accounts";
import { useAccount } from "../context/AccountContext";
import { KuroLogo } from "../components/Navbar";

export function ProfileSelect() {
  const { setAccount } = useAccount();
  const [hovered, setHovered] = useState<string | null>(null);

  function pick(a: Account) {
    setAccount(a);
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 56,
    }}>
      <KuroLogo />

      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Who's watching?</h1>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>Select your profile to continue</p>
      </div>

      <div style={{
        display: "flex",
        gap: 24,
        flexWrap: "wrap",
        justifyContent: "center",
        maxWidth: 600,
      }}>
        {ACCOUNTS.map((a, i) => (
          <button
            key={a.id}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={i === 0}
            onClick={() => pick(a)}
            onMouseEnter={() => setHovered(a.id)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(a.id)}
            onBlur={() => setHovered(null)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              padding: "4px",
              borderRadius: 8,
              transition: "transform 120ms ease",
              transform: hovered === a.id ? "scale(1.05)" : "scale(1)",
            }}
            aria-label={`Select profile ${a.name}`}
          >
            <div style={{
              width: 88,
              height: 88,
              borderRadius: 10,
              background: `linear-gradient(135deg, ${a.color}, ${a.color}88)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              fontWeight: 800,
              color: "#fff",
              border: hovered === a.id ? `2px solid ${a.color}` : "2px solid transparent",
              boxShadow: hovered === a.id ? `0 0 20px ${a.color}44` : "none",
              transition: "border-color 120ms ease, box-shadow 120ms ease",
            }}>
              {a.initial}
            </div>
            <span style={{
              fontSize: 13,
              fontWeight: 500,
              color: hovered === a.id ? "#fff" : "var(--muted)",
              transition: "color 120ms ease",
            }}>
              {a.name}
            </span>
          </button>
        ))}
      </div>

      <button
        onClick={() => pick(GUEST_ACCOUNT)}
        style={{
          background: "none",
          border: "none",
          color: "var(--muted)",
          fontSize: 14,
          cursor: "pointer",
          padding: "8px 16px",
          borderRadius: 6,
          transition: "color 120ms ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--fg)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
        aria-label="Browse as guest"
      >
        Browse as Guest
      </button>
    </div>
  );
}
