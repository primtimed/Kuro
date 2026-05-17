import { describe, it, expect, beforeEach } from "vitest";
import { pickBest } from "./useSpatialNav";

// Helper: create a mock Element whose getBoundingClientRect returns the given rect.
function el(x: number, y: number, w = 178, h = 237): Element {
  const e = document.createElement("button");
  e.getBoundingClientRect = () =>
    ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect;
  return e;
}

// Layout used across several tests:
//
//   Row 0 (y=200): A  B  C  D  E
//   Row 1 (y=500): F  G  H  I  J
//   Row 2 (y=800): K  L  M
//
// Cards are 178 px wide with a 14 px gap → each card starts at x = 32 + i*(178+14)
function card(col: number, row: number): Element {
  const x = 32 + col * 192;
  const y = [200, 500, 800][row];
  return el(x, y);
}

describe("pickBest — right", () => {
  let row: Element[];
  beforeEach(() => {
    row = [card(0, 0), card(1, 0), card(2, 0), card(3, 0), card(4, 0)];
  });

  it("picks the immediately adjacent card to the right", () => {
    expect(pickBest(row[0], "right", row)).toBe(row[1]);
  });

  it("from the last card returns null (no wrapping)", () => {
    expect(pickBest(row[4], "right", row)).toBeNull();
  });

  it("skips cards already to the left", () => {
    expect(pickBest(row[2], "right", row)).toBe(row[3]);
  });
});

describe("pickBest — left", () => {
  let row: Element[];
  beforeEach(() => {
    row = [card(0, 0), card(1, 0), card(2, 0), card(3, 0)];
  });

  it("picks the immediately adjacent card to the left", () => {
    expect(pickBest(row[3], "left", row)).toBe(row[2]);
  });

  it("from the first card returns null", () => {
    expect(pickBest(row[0], "left", row)).toBeNull();
  });
});

describe("pickBest — down", () => {
  let all: Element[];
  let row0: Element[];
  let row1: Element[];
  beforeEach(() => {
    row0 = [card(0, 0), card(1, 0), card(2, 0), card(3, 0)];
    row1 = [card(0, 1), card(1, 1), card(2, 1), card(3, 1)];
    all = [...row0, ...row1];
  });

  it("moves to the card directly below (same column)", () => {
    expect(pickBest(row0[1], "down", all)).toBe(row1[1]);
  });

  it("returns null when already in the last row", () => {
    expect(pickBest(row1[2], "down", all)).toBeNull();
  });

  it("prefers vertically-aligned card over a diagonal one", () => {
    // row0[0] is at col 0; row1[0] is directly below; row1[3] is far right
    expect(pickBest(row0[0], "down", all)).toBe(row1[0]);
  });
});

describe("pickBest — up", () => {
  let all: Element[];
  let row0: Element[];
  let row1: Element[];
  beforeEach(() => {
    row0 = [card(0, 0), card(1, 0), card(2, 0)];
    row1 = [card(0, 1), card(1, 1), card(2, 1)];
    all = [...row0, ...row1];
  });

  it("moves to the card directly above (same column)", () => {
    expect(pickBest(row1[2], "up", all)).toBe(row0[2]);
  });

  it("returns null when already in the first row", () => {
    expect(pickBest(row0[0], "up", all)).toBeNull();
  });
});

describe("pickBest — cross-row penalty keeps navigation in the same row", () => {
  it("ArrowRight does not jump to a card in the row below", () => {
    // Card A is at col 0, row 0. Card B is at col 1, row 0. Card C is at col 0, row 1.
    // When pressing right from A, B (same row, directly right) should win over C (below).
    const A = card(0, 0);
    const B = card(1, 0);
    const C = card(0, 1);
    expect(pickBest(A, "right", [A, B, C])).toBe(B);
  });

  it("ArrowDown does not jump to a card far to the right in the next row", () => {
    // From col-1 row-0, pressing down should land on col-1 row-1, not col-4 row-1.
    const A = card(1, 0);
    const close = card(1, 1);
    const far = card(4, 1);
    expect(pickBest(A, "down", [A, close, far])).toBe(close);
  });
});

describe("pickBest — three rows", () => {
  it("skips intermediate rows and navigates row by row when only adjacent row exists", () => {
    const top = card(0, 0);
    const mid = card(0, 1);
    const bot = card(0, 2);
    // From top, down → mid (not bot)
    expect(pickBest(top, "down", [top, mid, bot])).toBe(mid);
    // From mid, down → bot
    expect(pickBest(mid, "down", [top, mid, bot])).toBe(bot);
  });
});

describe("pickBest — single candidate", () => {
  it("returns the only candidate in the correct direction", () => {
    const current = el(100, 100);
    const right = el(300, 100);
    expect(pickBest(current, "right", [current, right])).toBe(right);
  });

  it("returns null when the only candidate is in the wrong direction", () => {
    const current = el(300, 100);
    const left = el(100, 100);
    expect(pickBest(current, "right", [current, left])).toBeNull();
  });
});
