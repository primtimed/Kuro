import type { ReactNode } from "react";

export function SettingsSection({ label, description, icon, meta, children }: {
  label: string;
  description?: ReactNode;
  icon?: ReactNode;
  /** Right side of the card header: a count or a primary action. */
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="panel" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: description ? 6 : 14 }}>
        {icon && (
          <span aria-hidden="true" style={{
            width: 34, height: 34, borderRadius: 8, flexShrink: 0,
            display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent-hi)",
          }}>
            {icon}
          </span>
        )}
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>{label}</h2>
        {meta && <div style={{ marginLeft: "auto" }}>{meta}</div>}
      </div>
      {description && <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "var(--dim)", lineHeight: 1.55 }}>{description}</p>}
      {children}
    </section>
  );
}

export const settingsButton: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, minHeight: 40, padding: "0 14px",
  borderRadius: 7, fontSize: 13, fontWeight: 600,
  background: "var(--surf-2)", border: "1px solid var(--line-2)", color: "var(--text)",
};

export const settingsPrimaryButton: React.CSSProperties = {
  ...settingsButton, background: "var(--accent)", borderColor: "var(--accent)",
};

export const settingsDangerButton: React.CSSProperties = {
  ...settingsButton, background: "var(--danger-soft)", borderColor: "var(--danger-soft)", color: "var(--danger-text)",
};

export const settingsInput: React.CSSProperties = {
  minHeight: 40, padding: "0 12px", borderRadius: 7, fontSize: 14, fontFamily: "inherit",
  background: "var(--surf-2)", color: "var(--text)", border: "1px solid var(--line-2)",
};

/** A device or profile row inside a settings card. */
export const settingsRow: React.CSSProperties = {
  display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 12,
  borderRadius: 10, background: "var(--surf-2)", border: "1px solid var(--line)",
};

export function formatLastUsed(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
