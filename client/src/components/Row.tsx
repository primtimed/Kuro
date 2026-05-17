import { useRef } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Media } from "../lib/types";
import { Card, CardSkeleton } from "./Card";
import { useIsMobile } from "../hooks/useIsMobile";

interface RowProps {
  title: string;
  titleColor?: string;
  items: Media[];
  loading?: boolean;
  ranked?: boolean;
  seeAllTo?: string;
}

export function Row({ title, titleColor, items, loading, ranked, seeAllTo }: RowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const pad = isMobile ? 16 : 32;

  function scroll(dir: "left" | "right") {
    if (!ref.current) return;
    ref.current.scrollBy({ left: dir === "right" ? 650 : -650, behavior: "smooth" });
  }

  return (
    <section style={{ marginBottom: isMobile ? 32 : 52 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: `0 ${pad}px 16px`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <span style={{
            width: 3, height: 17, borderRadius: 2,
            background: titleColor ?? "var(--accent)", flexShrink: 0,
          }} />
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>{title}</h2>
        </div>
        {!loading && items.length > 5 && seeAllTo && (
          <Link
            to={seeAllTo}
            className="mono"
            style={{
              fontSize: 10, color: "var(--muted)", letterSpacing: 1.5,
              padding: "4px 10px", borderRadius: 4,
              border: "1px solid var(--line-2)",
              transition: "color 150ms, border-color 150ms",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--accent)";
              e.currentTarget.style.borderColor = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--muted)";
              e.currentTarget.style.borderColor = "var(--line-2)";
            }}
          >
            SEE ALL →
          </Link>
        )}
      </div>

      <div style={{ position: "relative" }}>
        <button
          onClick={() => scroll("left")}
          aria-label="Scroll left"
          style={{
            position: "absolute", left: 0, top: 0, bottom: 20, zIndex: 10, width: 64,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(to right, rgba(10,10,10,0.97) 35%, transparent)",
            opacity: 0, transition: "opacity 200ms",
          }}
          className="row-scroll-btn"
        >
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            background: "var(--surf-2)", border: "1px solid var(--line-2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
          }}>
            <ChevronLeft size={15} />
          </div>
        </button>

        <div
          ref={ref}
          className="row-scroll"
          style={{ padding: `4px ${pad}px 12px` }}
          onMouseEnter={(e) => {
            const btns = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".row-scroll-btn");
            btns?.forEach((b) => (b.style.opacity = "1"));
          }}
          onMouseLeave={(e) => {
            const btns = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".row-scroll-btn");
            btns?.forEach((b) => (b.style.opacity = "0"));
          }}
        >
          {loading
            ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)
            : items.map((m, idx) => (
              <Card key={m.id} media={m} rank={ranked ? idx + 1 : undefined} />
            ))}
        </div>

        <button
          onClick={() => scroll("right")}
          aria-label="Scroll right"
          style={{
            position: "absolute", right: 0, top: 0, bottom: 20, zIndex: 10, width: 64,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(to left, rgba(10,10,10,0.97) 35%, transparent)",
            opacity: 0, transition: "opacity 200ms",
          }}
          className="row-scroll-btn"
        >
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            background: "var(--surf-2)", border: "1px solid var(--line-2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
          }}>
            <ChevronRight size={15} />
          </div>
        </button>
      </div>
    </section>
  );
}
