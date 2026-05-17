---
paths:
  - "**/*.tsx"
  - "**/*.css"
  - "**/components/**"
  - "**/pages/**"
---

# Frontend

## Design Tokens

This project uses the **Kuro design system**. Look for existing CSS vars before writing any styles. Never hardcode raw color, spacing, or typography values in components.

## Component Framework

This project uses: **Tailwind CSS 4** + **Radix UI** primitives + **Lucide** icons. Don't add competing libraries.

| Category | In use |
|---|---|
| CSS | Tailwind CSS 4 + Kuro CSS vars |
| Primitives | Radix UI (@radix-ui/*) |
| Icons | Lucide React |
| Art | Procedural SVG via `client/src/lib/procedural.ts` |

## Layout

- CSS Grid for 2D, Flexbox for 1D. Use `gap`, not margin hacks.
- Semantic HTML: `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<footer>`.
- Mobile-first. Touch targets: minimum 44x44px.

## Accessibility (non-negotiable)

- All interactive elements keyboard-accessible.
- Images: meaningful `alt` text. Decorative: `alt=""`.
- Form inputs: associated `<label>` or `aria-label`.
- Contrast: 4.5:1 normal text, 3:1 large text.
- Visible focus indicators. Never `outline: none` without replacement.
- Color never the sole indicator.
- `aria-live` for dynamic content. Respect `prefers-reduced-motion` and `prefers-color-scheme`.

## TV Remote / D-pad (non-negotiable)

This app must be fully navigable with a TV remote (Firestick, Ziggo, etc.). Spatial navigation is handled globally by `useSpatialNav` — **do not break it**.

Rules for every new component:

- **All interactive elements must be focusable.** `<button>` and `<a href>` are focusable by default. Any custom clickable `<div>` or `<span>` needs `tabIndex={0}` and an `onKeyDown` handler for Enter/Space.
- **Never suppress focus.** Do not set `tabIndex={-1}` on elements the user should be able to reach with a remote.
- **Focus start point.** The primary action on a new page or modal (Play, Confirm, first item) must carry `data-tv-autofocus`. The spatial nav hook picks this up on route change.
- **Player / input exemption.** Elements where arrow keys have native meaning (`<video>`, `<input>`, `<textarea>`, `<select>`) are automatically skipped by `useSpatialNav` — do not add workarounds.
- **Card focus style.** Focusable cards use `className="kuro-card"` on the link and `className="kuro-card-img"` on the image wrapper. The CSS in `index.css` applies the correct TV focus ring; do not override it.
- **No invisible focus traps.** Modals/dropdowns must close on Escape (existing convention). They must not trap focus in a way that prevents navigating out with the D-pad.
- **Touch-target minimum.** 44 × 44 px — remote cursor clicks behave like touch taps on some devices.

## Performance

- Images: `loading="lazy"` below fold, explicit `width`/`height`.
- Fonts: `font-display: swap`.
- Animations: `transform` and `opacity` only.
- Large lists: virtualize at 100+ items.
- Bundle size: never import a whole library for one function.
