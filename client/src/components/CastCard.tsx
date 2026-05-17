import type { CastMember } from "../lib/types";
import { CastPortrait } from "../lib/procedural";

interface CastCardProps {
  member: CastMember;
}

export function CastCard({ member }: CastCardProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center", width: 80 }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", overflow: "hidden", border: "1px solid var(--line-2)" }}>
        {member.image ? (
          <img src={member.image} alt={member.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
        ) : (
          <CastPortrait name={member.name} size={56} />
        )}
      </div>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: "var(--text)" }} className="clip-2">{member.name}</p>
      <p className="mono" style={{ margin: 0, fontSize: 9, color: "var(--dim)", letterSpacing: 0.5 }}>{member.role.toUpperCase()}</p>
    </div>
  );
}
