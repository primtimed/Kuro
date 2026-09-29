import type { ReactNode } from "react";

export function SettingsSection({ label, description, children }: { label: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label}>
      <div style={{ height: 1, background: "var(--line)", margin: "36px 0 28px" }} />
      <p className="mono" style={{ margin: "0 0 6px", fontSize: 10, color: "var(--dim)", letterSpacing: 1 }}>{label.toUpperCase()}</p>
      {description && <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>{description}</p>}
      {children}
    </section>
  );
}

export const settingsButton: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, minHeight: 40, padding: "0 14px",
  borderRadius: 7, fontSize: 13, fontWeight: 500,
  background: "var(--surf)", border: "1px solid var(--line-2)", color: "var(--muted)",
};

export const settingsInput: React.CSSProperties = {
  minHeight: 40, padding: "0 12px", borderRadius: 7, fontSize: 14, fontFamily: "inherit",
  background: "var(--surf)", color: "var(--text)", border: "1px solid var(--line-2)",
};

export function formatLastUsed(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
