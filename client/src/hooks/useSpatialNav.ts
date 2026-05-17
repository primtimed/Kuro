import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";

type Dir = "up" | "down" | "left" | "right";

const KEY_DIR: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

// Tags where we must not intercept arrow keys
const PASSTHRU_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "VIDEO"]);

const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

function getVisible(): Element[] {
  return Array.from(document.querySelectorAll<Element>(FOCUSABLE)).filter((el) => {
    if ((el as HTMLElement).offsetParent === null) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

// Exported so the scoring logic can be unit-tested without a live DOM.
export function pickBest(current: Element, dir: Dir, candidates: Element[]): Element | null {
  const cr = current.getBoundingClientRect();
  const cCX = cr.left + cr.width / 2;
  const cCY = cr.top + cr.height / 2;
  let best: Element | null = null;
  let bestScore = Infinity;

  for (const el of candidates) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const eCX = r.left + r.width / 2;
    const eCY = r.top + r.height / 2;
    let primary: number;
    let secondary: number;

    switch (dir) {
      case "right":
        if (eCX <= cCX) continue;
        primary = eCX - cCX;
        secondary = Math.abs(eCY - cCY);
        break;
      case "left":
        if (eCX >= cCX) continue;
        primary = cCX - eCX;
        secondary = Math.abs(eCY - cCY);
        break;
      case "down":
        if (eCY <= cCY) continue;
        primary = eCY - cCY;
        secondary = Math.abs(eCX - cCX);
        break;
      default: // up
        if (eCY >= cCY) continue;
        primary = cCY - eCY;
        secondary = Math.abs(eCX - cCX);
        break;
    }

    // Primary axis distance + weighted secondary axis penalty.
    // The 2.5× weight keeps focus inside the same row/column before jumping to an adjacent one.
    const s = primary + secondary * 2.5;
    if (s < bestScore) {
      bestScore = s;
      best = el;
    }
  }
  return best;
}

export function useSpatialNav() {
  const navigate = useNavigate();
  const location = useLocation();

  // On route change, move focus to the page's preferred start element,
  // falling back to the first focusable element in <main>, then anywhere.
  useEffect(() => {
    const t = setTimeout(() => {
      const preferred = document.querySelector<HTMLElement>("[data-tv-autofocus]");
      if (preferred) { preferred.focus(); return; }
      const inMain = document.querySelector<HTMLElement>(`main ${FOCUSABLE}`);
      if (inMain) { inMain.focus(); return; }
      (getVisible()[0] as HTMLElement | undefined)?.focus();
    }, 120);
    return () => clearTimeout(t);
  }, [location.pathname]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // TV remote back button (Silk browser on Firestick, etc.)
      if (e.key === "GoBack" || e.key === "BrowserBack") {
        navigate(-1);
        return;
      }

      const dir = KEY_DIR[e.key];
      if (!dir) return;

      const active = document.activeElement;

      // Nothing focused → focus first visible element
      if (!active || active === document.body || active === document.documentElement) {
        e.preventDefault();
        (getVisible()[0] as HTMLElement | undefined)?.focus();
        return;
      }

      // Let native key handling through for text inputs, selects, and video elements.
      // This keeps the HLS player's space/arrow seek handlers intact.
      if (PASSTHRU_TAGS.has((active as HTMLElement).tagName)) return;

      e.preventDefault();
      // stopPropagation in capture phase prevents bubble-phase handlers from also firing.
      e.stopPropagation();

      const next = pickBest(active, dir, getVisible());
      if (next) {
        (next as HTMLElement).focus({ preventScroll: true });
        next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      }
    }

    // Capture phase so we run before per-component bubble handlers.
    // When we bail early (PASSTHRU_TAGS), the event continues to bubble normally.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [navigate]);
}
