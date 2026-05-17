import { useState, useEffect, useRef } from "react";
import { ChevronUp, ChevronDown, Check, X, Plus, ExternalLink, AlertCircle, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import type { ScraperSettings, ScraperDef, CustomScraper } from "../lib/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function moveItem(arr: string[], idx: number, dir: "up" | "down"): string[] {
  const next = [...arr];
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= next.length) return next;
  [next[idx], next[swap]] = [next[swap], next[idx]];
  return next;
}

function normalizeHost(raw: string): string {
  try {
    const url = raw.includes("://") ? raw : `https://${raw}`;
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return raw.toLowerCase().trim();
  }
}

function toHttps(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `https://${s}`;
}

// Derive a slug and display name from a hostname: "anikototv.to" → {id:"anikototv", name:"Anikototv"}
function deriveFromHost(host: string): { id: string; name: string; source: string } {
  const base = host.split(".")[0].toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const name = base.charAt(0).toUpperCase() + base.slice(1);
  return { id: base, name, source: base };
}

function matchCatalog(input: string, catalog: ScraperDef[]): ScraperDef | null {
  const host = normalizeHost(input);
  return catalog.find((s) => s.knownDomains.some((d) => d === host || host.endsWith(`.${d}`))) ?? null;
}

// ─── Consumet source tester ───────────────────────────────────────────────────

type TestState = "idle" | "testing" | "ok" | "fail";

function TestButton({ source }: { source: string }) {
  const [state, setState] = useState<TestState>("idle");
  const [msg, setMsg] = useState("");

  async function run() {
    setState("testing");
    setMsg("");
    try {
      const r = await api.services.testScraper(source);
      if (r.ok) {
        setState("ok");
        setMsg(`${r.count} results found`);
      } else {
        setState("fail");
        setMsg(r.error ?? "Failed");
      }
    } catch {
      setState("fail");
      setMsg("Connection error");
    }
  }

  const color = state === "ok" ? "#4ade80" : state === "fail" ? "#ef4444" : "var(--dim)";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, minWidth: 60 }}>
      <button
        onClick={run}
        disabled={state === "testing"}
        title={`Test if Consumet supports "${source}"`}
        className="mono"
        style={{
          fontSize: 9, padding: "3px 8px", borderRadius: 4, fontWeight: 700, letterSpacing: 0.5,
          background: "var(--surf-2)", color,
          border: `1px solid ${state === "idle" || state === "testing" ? "var(--line-2)" : color}`,
          cursor: state === "testing" ? "default" : "pointer",
          display: "flex", alignItems: "center", gap: 4, opacity: state === "testing" ? 0.6 : 1,
        }}
      >
        {state === "ok" && <Check size={9} />}
        {state === "fail" && <AlertCircle size={9} />}
        {state === "testing" ? "…" : state === "ok" ? "OK" : state === "fail" ? "FAIL" : "TEST"}
      </button>
      {msg && <span style={{ fontSize: 10, color, lineHeight: 1.3, maxWidth: 120, textAlign: "right" }}>{msg}</span>}
    </div>
  );
}

// ─── Scraper card (catalog or custom) ────────────────────────────────────────

function ScraperCard({
  id, name, note, audio, displayUrl, urlOverride, isCustom, source,
  onUrlChange, onRemove,
}: {
  id: string;
  name: string;
  note?: string;
  audio: ("sub" | "dub")[];
  displayUrl: string;
  urlOverride: string;
  isCustom?: boolean;
  source?: string;
  onUrlChange: (url: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(urlOverride || displayUrl);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitEdit() {
    const trimmed = draft.trim();
    onUrlChange(trimmed && trimmed !== displayUrl ? toHttps(trimmed) : "");
    setEditing(false);
  }

  const isModified = !!urlOverride && urlOverride !== displayUrl;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr auto auto",
      alignItems: "center", gap: 12,
      padding: "12px 14px", borderRadius: 8,
      background: "var(--surf)", border: "1px solid var(--line-2)",
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{name}</span>
          {isCustom && (
            <span className="mono" style={{
              fontSize: 9, padding: "2px 6px", borderRadius: 3, fontWeight: 700, letterSpacing: 0.5,
              background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.25)",
            }}>CUSTOM</span>
          )}
          <div style={{ display: "flex", gap: 4 }}>
            {audio.map((a) => (
              <span key={a} className="mono" style={{
                fontSize: 9, padding: "2px 6px", borderRadius: 3, fontWeight: 700, letterSpacing: 0.5,
                background: a === "sub" ? "rgba(99,102,241,0.1)" : "rgba(245,158,11,0.1)",
                color: a === "sub" ? "#818cf8" : "#fbbf24",
                border: `1px solid ${a === "sub" ? "rgba(99,102,241,0.25)" : "rgba(245,158,11,0.25)"}`,
              }}>
                {a.toUpperCase()}
              </span>
            ))}
          </div>
        </div>

        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(false); }}
            placeholder={displayUrl}
            style={{
              width: "100%", background: "var(--surf-3)", border: "1px solid var(--accent)",
              color: "var(--text)", padding: "4px 8px", borderRadius: 5,
              fontSize: 12, outline: "none", fontFamily: "monospace", boxSizing: "border-box",
            }}
          />
        ) : (
          <button onClick={startEdit} title="Click to edit URL" style={{ background: "none", textAlign: "left", maxWidth: "100%", cursor: "text" }}>
            <span style={{
              fontSize: 12, color: isModified ? "var(--accent)" : "var(--dim)",
              fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block",
            }}>
              {urlOverride || displayUrl}
              {isModified && <span className="mono" style={{ marginLeft: 6, fontSize: 9, color: "var(--accent)" }}>CUSTOM</span>}
            </span>
          </button>
        )}
        {note && <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 2 }}>{note}</div>}
      </div>

      <a href={urlOverride || displayUrl} target="_blank" rel="noreferrer" title="Open site"
        style={{ color: "var(--dim)", display: "flex", alignItems: "center" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--muted)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}>
        <ExternalLink size={14} />
      </a>

      {isCustom && source && <TestButton source={source} />}

      <button onClick={onRemove} aria-label={`Remove ${name}`} style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, borderRadius: 6,
        background: "rgba(239,68,68,0.1)", color: "#ef4444",
        border: "1px solid rgba(239,68,68,0.25)", cursor: "pointer",
      }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.2)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.1)"; }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ─── Custom scraper add form (shown when URL doesn't match catalog) ───────────

function CustomAddForm({
  initialUrl, onAdd, onCancel,
}: {
  initialUrl: string;
  onAdd: (c: CustomScraper) => void;
  onCancel: () => void;
}) {
  const host = normalizeHost(initialUrl);
  const derived = deriveFromHost(host);

  const [name, setName] = useState(derived.name);
  const [source, setSource] = useState(derived.source);
  const [url, setUrl] = useState(toHttps(initialUrl));
  const [audio, setAudio] = useState<("sub" | "dub")[]>(["sub", "dub"]);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);

  function toggleAudio(a: "sub" | "dub") {
    setAudio((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
  }

  async function testSource() {
    if (!source.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.services.testScraper(source.trim());
      setTestResult({ ok: r.ok, msg: r.ok ? `Works — found ${r.count} results` : (r.error ?? "Not supported by Consumet") });
    } catch {
      setTestResult({ ok: false, msg: "Connection error" });
    } finally {
      setTesting(false);
    }
  }

  function handleAdd() {
    if (!name.trim() || !source.trim() || !url.trim() || audio.length === 0) return;
    const id = source.toLowerCase().replace(/[^a-z0-9_-]/g, "") || derived.id;
    onAdd({ id, name: name.trim(), url: toHttps(url.trim()), source: source.trim(), audio });
  }

  return (
    <div style={{
      padding: 16, borderRadius: 8, marginTop: 8,
      background: "var(--surf)", border: "1px solid var(--accent)",
    }}>
      <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
        Unknown site — add as custom scraper
      </p>
      <div style={{
        margin: "0 0 14px", padding: "8px 10px", borderRadius: 6,
        background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)",
        fontSize: 12, color: "rgba(251,191,36,0.9)", lineHeight: 1.55,
      }}>
        <strong>Custom scrapers use Consumet.</strong> The source name must match a site that Consumet supports. Use the <strong>Test</strong> button to check — if it fails, the scraper will never produce streams.
        <br />Known working sources: <span style={{ fontFamily: "monospace" }}>gogoanime, zoro, animefox, 9anime</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <FormRow label="Display name">
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="e.g. AnikotoTV" />
        </FormRow>
        <FormRow label="Website URL">
          <input value={url} onChange={(e) => setUrl(e.target.value)} style={inputStyle} placeholder="https://anikototv.to" />
        </FormRow>
        <FormRow label="Consumet source name">
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={source}
              onChange={(e) => { setSource(e.target.value); setTestResult(null); }}
              style={{ ...inputStyle, fontFamily: "monospace", flex: 1 }}
              placeholder="e.g. gogoanime"
            />
            <button
              onClick={testSource}
              disabled={testing || !source.trim()}
              style={{
                padding: "7px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                background: testing ? "var(--surf-2)" : testResult?.ok ? "rgba(74,222,128,0.1)" : testResult ? "rgba(239,68,68,0.1)" : "var(--surf-2)",
                color: testing ? "var(--dim)" : testResult?.ok ? "#4ade80" : testResult ? "#ef4444" : "var(--muted)",
                border: `1px solid ${testResult?.ok ? "rgba(74,222,128,0.3)" : testResult ? "rgba(239,68,68,0.3)" : "var(--line-2)"}`,
                cursor: testing || !source.trim() ? "default" : "pointer",
              }}
            >
              {testing ? "Testing…" : testResult?.ok ? "✓ Works" : testResult ? "✗ Fail" : "Test"}
            </button>
          </div>
        </FormRow>
        {testResult && (
          <p style={{
            margin: 0, fontSize: 11, lineHeight: 1.5, paddingLeft: 140,
            color: testResult.ok ? "#4ade80" : "#ef4444",
          }}>
            {testResult.msg}
          </p>
        )}
        <FormRow label="Audio">
          <div style={{ display: "flex", gap: 8 }}>
            {(["sub", "dub"] as const).map((a) => (
              <button
                key={a}
                onClick={() => toggleAudio(a)}
                className="mono"
                style={{
                  padding: "5px 14px", borderRadius: 6, fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                  background: audio.includes(a) ? (a === "sub" ? "rgba(99,102,241,0.2)" : "rgba(245,158,11,0.2)") : "var(--surf-2)",
                  color: audio.includes(a) ? (a === "sub" ? "#818cf8" : "#fbbf24") : "var(--dim)",
                  border: `1px solid ${audio.includes(a) ? (a === "sub" ? "rgba(99,102,241,0.4)" : "rgba(245,158,11,0.4)") : "var(--line-2)"}`,
                  cursor: "pointer",
                }}
              >
                {a.toUpperCase()}
              </button>
            ))}
          </div>
        </FormRow>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button
          onClick={handleAdd}
          disabled={!name.trim() || !source.trim() || audio.length === 0}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600,
            background: "var(--accent)", color: "#fff", border: "none",
            cursor: !name.trim() || !source.trim() || audio.length === 0 ? "not-allowed" : "pointer",
            opacity: !name.trim() || !source.trim() || audio.length === 0 ? 0.5 : 1,
          }}
        >
          <Plus size={13} /> Add custom scraper
        </button>
        <button onClick={onCancel} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 13,
          background: "transparent", color: "var(--muted)",
          border: "1px solid var(--line-2)", cursor: "pointer",
        }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--surf-2)", border: "1px solid var(--line-2)",
  color: "var(--text)", padding: "7px 10px", borderRadius: 6,
  fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box",
};

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", alignItems: "center", gap: 12 }}>
      <label style={{ fontSize: 12, color: "var(--dim)", fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

// ─── Priority order list ──────────────────────────────────────────────────────

function OrderList({ label, order, activeIds, allNames, onChange }: {
  label: string;
  order: string[];
  activeIds: Set<string>;
  allNames: Map<string, string>;
  onChange: (o: string[]) => void;
}) {
  const visible = order.filter((id) => activeIds.has(id));
  if (visible.length === 0) {
    return (
      <div style={{ minWidth: 220 }}>
        <p className="mono" style={{ margin: "0 0 10px", fontSize: 10, color: "var(--dim)", letterSpacing: 1 }}>{label.toUpperCase()}</p>
        <p style={{ fontSize: 12, color: "var(--dim)", fontStyle: "italic" }}>No active scrapers.</p>
      </div>
    );
  }
  return (
    <div style={{ minWidth: 220 }}>
      <p className="mono" style={{ margin: "0 0 10px", fontSize: 10, color: "var(--dim)", letterSpacing: 1 }}>{label.toUpperCase()}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {visible.map((id, idx) => (
          <div key={id} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
            borderRadius: 6, background: "var(--surf)", border: "1px solid var(--line-2)",
          }}>
            <span className="mono" style={{ fontSize: 10, color: "var(--dim)", width: 14, textAlign: "center" }}>{idx + 1}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{allNames.get(id) ?? id}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <button onClick={() => onChange(moveItem(order, order.indexOf(id), "up"))} disabled={idx === 0}
                aria-label="Move up" style={{ opacity: idx === 0 ? 0.25 : 1, padding: 2, color: "var(--muted)" }}>
                <ChevronUp size={12} />
              </button>
              <button onClick={() => onChange(moveItem(order, order.indexOf(id), "down"))} disabled={idx === visible.length - 1}
                aria-label="Move down" style={{ opacity: idx === visible.length - 1 ? 0.25 : 1, padding: 2, color: "var(--muted)" }}>
                <ChevronDown size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function Settings() {
  const [catalog, setCatalog] = useState<ScraperDef[]>([]);
  const [settings, setSettings] = useState<ScraperSettings | null>(null);
  const [addInput, setAddInput] = useState("");
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.services.scrapers().then(setCatalog).catch(() => {});
    api.services.settings().then(setSettings).catch(() => {});
  }, []);

  if (!settings) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", padding: "80px 32px 64px" }}>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>
      </div>
    );
  }

  const activeIds = new Set([...settings.sub_order, ...settings.dub_order]);
  const activeCatalog = catalog.filter((s) => activeIds.has(s.id));
  const inactiveCatalog = catalog.filter((s) => !activeIds.has(s.id));
  const activeCustoms = (settings.custom_scrapers ?? []).filter((c) => activeIds.has(c.id));

  // Name lookup for order lists
  const allNames = new Map<string, string>([
    ...catalog.map((s) => [s.id, s.name] as [string, string]),
    ...(settings.custom_scrapers ?? []).map((c) => [c.id, c.name] as [string, string]),
  ]);

  function addCatalogScraper(def: ScraperDef) {
    setSettings((prev) => {
      if (!prev) return prev;
      const sub = def.audio.includes("sub") && !prev.sub_order.includes(def.id)
        ? [...prev.sub_order, def.id] : prev.sub_order;
      const dub = def.audio.includes("dub") && !prev.dub_order.includes(def.id)
        ? [...prev.dub_order, def.id] : prev.dub_order;
      return { ...prev, sub_order: sub, dub_order: dub };
    });
    setAddInput("");
    setShowCustomForm(false);
  }

  function addCustomScraper(c: CustomScraper) {
    setSettings((prev) => {
      if (!prev) return prev;
      const sub = c.audio.includes("sub") && !prev.sub_order.includes(c.id)
        ? [...prev.sub_order, c.id] : prev.sub_order;
      const dub = c.audio.includes("dub") && !prev.dub_order.includes(c.id)
        ? [...prev.dub_order, c.id] : prev.dub_order;
      const customs = [...(prev.custom_scrapers ?? []).filter((x) => x.id !== c.id), c];
      return { ...prev, sub_order: sub, dub_order: dub, custom_scrapers: customs };
    });
    setAddInput("");
    setShowCustomForm(false);
  }

  function removeScraper(id: string) {
    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sub_order: prev.sub_order.filter((s) => s !== id),
        dub_order: prev.dub_order.filter((s) => s !== id),
        custom_scrapers: (prev.custom_scrapers ?? []).filter((c) => c.id !== id),
      };
    });
  }

  function setUrl(id: string, url: string, defaultUrl: string) {
    setSettings((prev) => {
      if (!prev) return prev;
      const urls = { ...prev.scraper_urls };
      if (!url || url === defaultUrl) { delete urls[id]; } else { urls[id] = url; }
      return { ...prev, scraper_urls: urls };
    });
  }

  function handleAddInput() {
    const val = addInput.trim();
    if (!val) return;
    const match = matchCatalog(val, catalog);
    if (match) {
      if (activeIds.has(match.id)) return; // already active
      addCatalogScraper(match);
    } else {
      setShowCustomForm(true);
    }
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      await api.services.updateSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  const totalActive = activeCatalog.length + activeCustoms.length;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: "80px 32px 64px" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 700 }}>Settings</h1>
      <p style={{ margin: "0 0 36px", fontSize: 14, color: "var(--muted)" }}>
        Manage anime scrapers. Click a URL to edit it if a site has moved to a new domain.
      </p>

      <div style={{ maxWidth: 740 }}>

        {/* ── Active scrapers ── */}
        <p className="mono" style={{ margin: "0 0 12px", fontSize: 10, color: "var(--dim)", letterSpacing: 1 }}>
          ACTIVE SCRAPERS
        </p>

        {totalActive === 0 ? (
          <p style={{ fontSize: 13, color: "var(--dim)", marginBottom: 24, fontStyle: "italic" }}>No active scrapers. Add one below.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
            {activeCatalog.map((def) => (
              <ScraperCard
                key={def.id}
                id={def.id} name={def.name} note={def.note} audio={def.audio}
                displayUrl={def.defaultUrl}
                urlOverride={settings.scraper_urls[def.id] ?? ""}
                onUrlChange={(url) => setUrl(def.id, url, def.defaultUrl)}
                onRemove={() => removeScraper(def.id)}
              />
            ))}
            {activeCustoms.map((c) => (
              <ScraperCard
                key={c.id}
                id={c.id} name={c.name} audio={c.audio}
                displayUrl={c.url}
                urlOverride={settings.scraper_urls[c.id] ?? ""}
                isCustom source={c.source}
                onUrlChange={(url) => setUrl(c.id, url, c.url)}
                onRemove={() => removeScraper(c.id)}
              />
            ))}
          </div>
        )}

        {/* ── Add scraper ── */}
        <p className="mono" style={{ margin: "0 0 10px", fontSize: 10, color: "var(--dim)", letterSpacing: 1 }}>
          ADD SCRAPER
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            value={addInput}
            onChange={(e) => { setAddInput(e.target.value); setShowCustomForm(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddInput(); }}
            placeholder="Enter site URL — e.g. animepahe.ru, gogoanime.gg, anikototv.to"
            style={{
              flex: 1, background: "var(--surf)", border: "1px solid var(--line-2)",
              color: "var(--text)", padding: "9px 12px", borderRadius: 7,
              fontSize: 13, outline: "none", fontFamily: "inherit",
            }}
          />
          <button
            onClick={handleAddInput}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "9px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600,
              background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer",
            }}
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {/* Custom form — shown when URL doesn't match catalog */}
        {showCustomForm && (
          <CustomAddForm
            initialUrl={addInput}
            onAdd={addCustomScraper}
            onCancel={() => setShowCustomForm(false)}
          />
        )}

        {/* Quick-add chips for inactive catalog scrapers */}
        {inactiveCatalog.length > 0 && !showCustomForm && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 32 }}>
            {inactiveCatalog.map((def) => (
              <button key={def.id} onClick={() => addCatalogScraper(def)} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 500,
                background: "var(--surf)", color: "var(--muted)",
                border: "1px solid var(--line-2)", cursor: "pointer",
                transition: "border-color 150ms, color 150ms",
              }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--line-2)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--muted)"; }}
              >
                <Plus size={11} />
                {def.name}
                <span style={{ fontSize: 10, color: "var(--dim)", fontFamily: "monospace" }}>{normalizeHost(def.defaultUrl)}</span>
              </button>
            ))}
          </div>
        )}

        {!showCustomForm && <div style={{ marginBottom: 32 }} />}

        {/* ── Priority order ── */}
        <div style={{ height: 1, background: "var(--line)", margin: "0 0 28px" }} />
        <p className="mono" style={{ margin: "0 0 6px", fontSize: 10, color: "var(--dim)", letterSpacing: 1 }}>PRIORITY ORDER</p>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>
          Kuro tries scrapers top-to-bottom and uses the first that works.
        </p>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
          <OrderList label="Sub" order={settings.sub_order} activeIds={activeIds} allNames={allNames}
            onChange={(o) => setSettings((s) => s ? { ...s, sub_order: o } : s)} />
          <OrderList label="Dub" order={settings.dub_order} activeIds={activeIds} allNames={allNames}
            onChange={(o) => setSettings((s) => s ? { ...s, dub_order: o } : s)} />
        </div>

        {/* ── Save ── */}
        <button onClick={save} disabled={saving} style={{
          marginTop: 28, display: "flex", alignItems: "center", gap: 8,
          padding: "9px 20px", borderRadius: 7, fontSize: 13, fontWeight: 600,
          background: saved ? "var(--seen-soft)" : "var(--accent)",
          color: saved ? "var(--seen-text)" : "#fff",
          border: saved ? "1px solid var(--seen-border)" : "none",
          opacity: saving ? 0.6 : 1, cursor: saving ? "wait" : "pointer",
        }}>
          {saved ? <><Check size={13} /> Saved</> : "Save changes"}
        </button>

        <RecommendationsSection />
      </div>
    </div>
  );
}

function RecommendationsSection() {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  async function refresh() {
    setState("loading");
    try {
      await api.library.refreshRecommendations();
      setState("done");
    } catch {
      setState("idle");
    }
  }

  return (
    <>
      <div style={{ height: 1, background: "var(--line)", margin: "36px 0 28px" }} />
      <p className="mono" style={{ margin: "0 0 6px", fontSize: 10, color: "var(--dim)", letterSpacing: 1 }}>RECOMMENDATIONS</p>
      <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>
        Recommendations are cached for 24 hours. Refresh to recalculate them based on your latest activity.
      </p>
      {state === "done" ? (
        <p style={{ fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
          <Check size={14} style={{ color: "#4ade80" }} /> Done — visit the home page to see refreshed recommendations.
        </p>
      ) : (
        <button
          onClick={refresh}
          disabled={state === "loading"}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "9px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600,
            background: "var(--surf)", border: "1px solid var(--line-2)", color: "var(--muted)",
            cursor: state === "loading" ? "wait" : "pointer",
            opacity: state === "loading" ? 0.6 : 1,
          }}
        >
          <RefreshCw size={13} style={{ animation: state === "loading" ? "spin 1s linear infinite" : "none" }} />
          {state === "loading" ? "Refreshing…" : "Refresh Recommendations"}
        </button>
      )}
    </>
  );
}
