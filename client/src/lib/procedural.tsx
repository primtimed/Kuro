// Procedural SVG art — seeded from media title hash.

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTES: [string, string][] = [
  ["#E50914", "#1a0507"],
  ["#3b0764", "#0a0712"],
  ["#0c4a6e", "#04101a"],
  ["#7c2d12", "#160604"],
  ["#064e3b", "#03100c"],
  ["#831843", "#180510"],
  ["#1e3a8a", "#040818"],
  ["#365314", "#070d04"],
  ["#7c1d6f", "#180416"],
  ["#854d0e", "#180e04"],
  ["#0e7490", "#03171c"],
  ["#581c87", "#100418"],
];

const ACCENTS = [
  "#f43f5e", "#fb7185", "#facc15", "#fbbf24", "#22d3ee", "#a78bfa",
  "#f97316", "#84cc16", "#ec4899", "#06b6d4", "#fde047", "#ffffff",
];

export interface CoverProps {
  title: string;
  w?: number;
  h?: number;
  rounded?: number;
}

export function AnimeCover({ title, w = 240, h = 340, rounded = 6 }: CoverProps) {
  const seed = hashStr(title);
  const rnd = mulberry32(seed);
  const [c1, c2] = PALETTES[seed % PALETTES.length];
  const accent = ACCENTS[(seed >> 3) % ACCENTS.length];
  const style = seed % 6;
  const id = `cv-${seed.toString(36)}`;

  let deco: React.ReactNode = null;
  if (style === 0) {
    const r = 60 + rnd() * 30, cx = 40 + rnd() * 160, cy = 60 + rnd() * 100;
    deco = <g><circle cx={cx} cy={cy} r={r} fill={accent} opacity="0.85" /><circle cx={cx + r * 0.35} cy={cy - r * 0.25} r={r * 0.18} fill={c2} opacity="0.4" /></g>;
  } else if (style === 1) {
    deco = <g>
      <polygon points={`0,${h * 0.3} ${w},0 ${w},${h * 0.55} 0,${h * 0.85}`} fill={accent} opacity="0.55" />
      <polygon points={`0,${h * 0.5} ${w},${h * 0.25} ${w},${h * 0.7} 0,${h}`} fill="#000" opacity="0.55" />
    </g>;
  } else if (style === 2) {
    const dots: React.ReactNode[] = [];
    for (let y = 0; y < h; y += 14) for (let x = 0; x < w; x += 14) {
      const r = (1 - y / h) * 5 + 0.5;
      if (r > 0.5) dots.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill={accent} opacity={0.7 - (y / h) * 0.5} />);
    }
    deco = <g>{dots}</g>;
  } else if (style === 3) {
    const bars: React.ReactNode[] = [];
    for (let i = 0; i < 8; i++) {
      const x = (w / 8) * i + rnd() * 4, bh = 80 + rnd() * 200, by = h - bh;
      bars.push(<rect key={i} x={x} y={by} width={w / 12} height={bh} fill={accent} opacity={0.25 + rnd() * 0.55} />);
    }
    deco = <g>{bars}</g>;
  } else if (style === 4) {
    const peakX = 40 + rnd() * (w - 80);
    deco = <g>
      <polygon points={`0,${h} ${peakX},${h * 0.25} ${w},${h}`} fill={accent} opacity="0.7" />
      <polygon points={`0,${h} ${peakX + 40},${h * 0.45} ${w},${h}`} fill="#000" opacity="0.5" />
      <circle cx={w * 0.78} cy={h * 0.22} r="22" fill={accent} opacity="0.9" />
    </g>;
  } else {
    deco = <g>
      {[0, 1, 2, 3].map((i) => <circle key={i} cx={w * 0.2} cy={h * 0.3} r={40 + i * 28} fill="none" stroke={accent} strokeWidth="2" opacity={0.7 - i * 0.15} />)}
      <rect x={w * 0.1} y={h * 0.6} width={w * 0.45} height="3" fill={accent} />
    </g>;
  }

  const short = title.length <= 18 ? title : title.slice(0, title.indexOf(":") > 0 && title.indexOf(":") < 18 ? title.indexOf(":") : 18).trim() + (title.length > 18 ? "…" : "");
  const fontSize = short.length > 14 ? 18 : short.length > 10 ? 22 : 26;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="xMidYMid slice"
      style={{ display: "block", borderRadius: rounded, background: c2 }}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c1} stopOpacity="1" />
          <stop offset="1" stopColor={c2} stopOpacity="1" />
        </linearGradient>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.45" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.9" />
        </linearGradient>
        <pattern id={`${id}-grain`} x="0" y="0" width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="transparent" />
          <circle cx="1.5" cy="1.5" r="0.4" fill="#fff" opacity="0.06" />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${id}-bg)`} />
      {deco}
      <rect width={w} height={h} fill={`url(#${id}-grain)`} />
      <rect width={w} height={h} fill={`url(#${id}-fade)`} />
      <text x="12" y="22" fontFamily="Geist Mono, monospace" fontSize="9" fontWeight="500" fill="#fff" opacity="0.7" letterSpacing="1">SVG</text>
      <text x="12" y={h - 38} fontFamily="Geist, sans-serif" fontSize={fontSize} fontWeight="800" fill="#fff" style={{ letterSpacing: "-0.02em" }}>{short}</text>
      <rect x="0" y={h - 4} width={w * 0.35} height="4" fill={accent} />
    </svg>
  );
}

export function AnimeBackdrop({ title, w = 1600, h = 720 }: { title: string; w?: number; h?: number }) {
  const seed = hashStr(title) ^ 0xa1bead;
  const rnd = mulberry32(seed);
  const [c1] = PALETTES[hashStr(title) % PALETTES.length];
  const accent = ACCENTS[(hashStr(title) >> 3) % ACCENTS.length];
  const id = `bd-${seed.toString(36)}`;

  const shapes = Array.from({ length: 4 }, (_, i) => (
    <circle key={i} cx={rnd() * w} cy={rnd() * h} r={100 + rnd() * 260}
      fill={i === 0 ? accent : c1} opacity={0.18 + rnd() * 0.25} />
  ));
  const beams = Array.from({ length: 5 }, (_, i) => (
    <rect key={i} x={(w / 5) * i + rnd() * 60} y="0" width={2 + rnd() * 6} height={h}
      fill={accent} opacity={0.05 + rnd() * 0.12} />
  ));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ display: "block" }}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor="#050505" />
        </linearGradient>
        <linearGradient id={`${id}-fadeR`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0a0a0a" stopOpacity="0.95" />
          <stop offset="0.4" stopColor="#0a0a0a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#0a0a0a" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-fadeB`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.5" stopColor="#0a0a0a" stopOpacity="0" />
          <stop offset="1" stopColor="#0a0a0a" stopOpacity="1" />
        </linearGradient>
        <pattern id={`${id}-grain`} x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="0.5" fill="#fff" opacity="0.05" />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${id}-bg)`} />
      {shapes}
      {beams}
      <rect width={w} height={h} fill={`url(#${id}-grain)`} />
      <rect width={w} height={h} fill={`url(#${id}-fadeR)`} />
      <rect width={w} height={h} fill={`url(#${id}-fadeB)`} />
    </svg>
  );
}

export function CastPortrait({ name, size = 56 }: { name: string; size?: number }) {
  const s = hashStr(name);
  const rnd = mulberry32(s);
  const [c1, c2] = PALETTES[s % PALETTES.length];
  const accent = ACCENTS[(s >> 2) % ACCENTS.length];
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  const id = `pt-${s.toString(36)}`;
  return (
    <svg viewBox="0 0 56 56" width={size} height={size} style={{ display: "block", borderRadius: "50%" }}>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor={c2} />
        </linearGradient>
      </defs>
      <rect width="56" height="56" fill={`url(#${id}-g)`} />
      <circle cx={20 + rnd() * 20} cy={20 + rnd() * 16} r={10 + rnd() * 8} fill={accent} opacity="0.55" />
      <text x="28" y="35" textAnchor="middle" fontFamily="Geist, sans-serif" fontSize="20" fontWeight="700" fill="#fff" opacity="0.95">{initials}</text>
    </svg>
  );
}

export function EpisodeThumbnail({ title, epNum, w = 220, h = 124 }: { title: string; epNum: number; w?: number; h?: number }) {
  const seed = ((hashStr(title) ^ (epNum * 9973)) >>> 0);
  const rnd = mulberry32(seed);
  const [c1, c2] = PALETTES[seed % PALETTES.length];
  const accent = ACCENTS[(seed >>> 1) % ACCENTS.length];
  const id = `ep-${seed.toString(36)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ display: "block" }}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor={c2} />
        </linearGradient>
      </defs>
      <rect width={w} height={h} fill={`url(#${id}-bg)`} />
      <polygon points={`0,${h * 0.5} ${w},${h * 0.2} ${w},${h * 0.75} 0,${h * 0.95}`} fill={accent} opacity="0.45" />
      <circle cx={w * 0.7} cy={h * 0.35} r={30 + rnd() * 14} fill={accent} opacity="0.65" />
      <rect width={w} height={h} fill="#000" opacity="0.18" />
    </svg>
  );
}
