const PREFIX = "kuro:";

interface Entry<T> { v: T; exp: number }

export function lcGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    if (Date.now() > entry.exp) { localStorage.removeItem(PREFIX + key); return null; }
    return entry.v;
  } catch { return null; }
}

export function lcSet<T>(key: string, value: T, ttlMs: number): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ v: value, exp: Date.now() + ttlMs }));
  } catch { /* storage quota exceeded */ }
}
