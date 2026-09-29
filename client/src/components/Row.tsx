import { useEffect, useRef, useState } from "react";
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
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  function scroll(dir: "left" | "right") {
    if (!ref.current) return;
    ref.current.scrollBy({ left: dir === "right" ? 650 : -650, behavior: "smooth" });
  }

  function updateScrollState() {
    const el = ref.current;
    if (!el) return;
    // 1px slack because scrollLeft can be fractional on zoomed / HiDPI screens
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    updateScrollState();
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    return () => observer.disconnect();
  }, [items, loading]);

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
        {canScrollLeft && (
          <button
            onClick={() => scroll("left")}
            aria-label="Scroll left"
            className="row-scroll-btn"
            style={{ left: 8 }}
          >
            <ChevronLeft size={20} />
          </button>
        )}

        <div
          ref={ref}
          className="row-scroll"
          style={{ padding: `4px ${pad}px 12px` }}
          onScroll={updateScrollState}
        >
          {loading
            ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)
            : items.map((m, idx) => (
              <Card key={m.id} media={m} rank={ranked ? idx + 1 : undefined} />
            ))}
        </div>

        {canScrollRight && (
          <button
            onClick={() => scroll("right")}
            aria-label="Scroll right"
            className="row-scroll-btn"
            style={{ right: 8 }}
          >
            <ChevronRight size={20} />
          </button>
        )}
      </div>
    </section>
  );
}
