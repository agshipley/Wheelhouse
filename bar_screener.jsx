import React, { useState, useEffect, useMemo } from "react";
import {
  Anchor, Plus, Trash2, ChevronDown, ChevronRight, Sparkles,
  SlidersHorizontal, RotateCcw, ExternalLink, AlertCircle, X, Search,
} from "lucide-react";

/* ============================================================
   WHEELHOUSE — Bar Acquisition Screener
   Deterministic all-in capitalization + dual-score screening,
   tuned to reproduce the SoCal coastal bar project's logic.
   ============================================================ */

const C = {
  paper: "#F4EFE4", card: "#FBF8F0", ink: "#16242E", line: "#E2D9C6",
  lineSoft: "#EDE6D6", muted: "#6E6757", accent: "#0E7C7B", navy: "#1F3A5F",
  amber: "#B5781A", red: "#A8443A", green: "#2F7D52", chipBg: "#ECE4D2",
};

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
`;

const display = { fontFamily: "'Fraunces', Georgia, serif" };
const ui = { fontFamily: "'Archivo', system-ui, sans-serif" };
const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

/* ---------------------- helpers ---------------------- */
const k = (n) => (n == null ? "—" : "$" + Math.round(n / 1000) + "k");
const m = (n) =>
  n == null ? "—" : n >= 1000000 ? "$" + (n / 1000000).toFixed(2).replace(/0$/, "") + "M" : k(n);
const rangeK = (lo, hi) => (lo == null ? "—" : `${k(lo)}–${k(hi)}`);
const rangeM = (lo, hi) => {
  if (lo == null) return "—";
  const f = (x) => (x >= 1000000 ? "$" + (x / 1000000).toFixed(1) + "M" : k(x));
  return `${f(lo)}–${f(hi)}`;
};

/* normalize every opportunity to canonical types (numbers/booleans),
   so seed data, form data, and storage round-trips all behave identically */
function normalizeOpp(o) {
  const numOrNull = (v) => (v === "" || v == null ? null : Number(v));
  const boolOf = (v) => v === true || v === "true";
  return {
    ...o,
    asking: numOrNull(o.asking),
    sqft: numOrNull(o.sqft),
    capacity: numOrNull(o.capacity),
    rentMonthly: numOrNull(o.rentMonthly),
    leaseYears: numOrNull(o.leaseYears),
    sde: numOrNull(o.sde),
    revenue: numOrNull(o.revenue),
    sellerFinancing: boolOf(o.sellerFinancing),
    kitchen: o.kitchen == null ? null : boolOf(o.kitchen),
  };
}
const newId = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : "x" + Date.now() + Math.random().toString(36).slice(2);

/* storage shim: prefers the Claude.ai artifact API, falls back to localStorage */
const store = {
  async get(key) {
    if (typeof window !== "undefined" && typeof window.storage !== "undefined") {
      return window.storage.get(key);
    }
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem(key);
      return v ? { value: v } : null;
    }
    return null;
  },
  async set(key, value) {
    if (typeof window !== "undefined" && typeof window.storage !== "undefined") {
      return window.storage.set(key, value);
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
    }
  },
};

/* ---------------------- all-in capitalization engine ---------------------- */
function sizeBucket(o) {
  const sq = o.sqft || 0;
  const cap = o.capacity || 0;
  if (sq) return sq <= 2200 ? "small" : sq >= 4000 ? "large" : "medium";
  if (cap) return cap <= 75 ? "small" : cap >= 130 ? "large" : "medium";
  return "medium";
}
const BY_SIZE = {
  small:  { lease: [10, 25], inv: [25, 45], pay: [25, 50], wc: [80, 130] },
  medium: { lease: [12, 35], inv: [30, 60], pay: [40, 100], wc: [110, 200] },
  large:  { lease: [15, 40], inv: [45, 80], pay: [70, 140], wc: [150, 250] },
};
const REBRAND = { none: [10, 30], light: [25, 75], moderate: [40, 90], heavy: [80, 150] };

function computeAllIn(o, p) {
  const ask = Number(o.asking) || 0;
  if (!ask) return null;
  const pLo = ask * p.negLow, pHi = ask * p.negHigh;
  const b = BY_SIZE[sizeBucket(o)];
  const reb = REBRAND[o.conceptChange || "light"];
  const sba = p.useSBA && ask > 200000 ? [25, 45] : [0, 0];
  const rows = [
    ["Purchase price", pLo / 1000, pHi / 1000],
    ["Closing / legal / escrow", (pLo * 0.03) / 1000, (pHi * 0.05) / 1000],
    ["License transfer + ABC consultant", 10, 20],
    ["Lease assignment + security", b.lease[0], b.lease[1]],
    ["Rebrand / concept capex", reb[0], reb[1]],
    ["Opening inventory", b.inv[0], b.inv[1]],
    ["Payroll ramp / training", b.pay[0], b.pay[1]],
    ["6-month working capital", b.wc[0], b.wc[1]],
  ];
  if (sba[1]) rows.push(["SBA fees", sba[0], sba[1]]);
  let subLo = rows.reduce((s, r) => s + r[1], 0);
  let subHi = rows.reduce((s, r) => s + r[2], 0);
  const contLo = subLo * 0.1, contHi = subHi * 0.1;
  rows.push(["Contingency (10%)", contLo, contHi]);
  const allLo = (subLo + contLo) * 1000, allHi = (subHi + contHi) * 1000;

  const purchaseBase = (pLo + pHi) / 2;
  const debt = p.useSBA && ask > 200000 ? Math.min(p.sbaPct * purchaseBase, 1500000) : 0;
  const carry =
    p.sellerCarry !== "none" && o.sellerFinancing
      ? p.carryPct * purchaseBase
      : 0;
  const checkLo = Math.max(0, allLo - p.operatorCash - debt - carry);
  const checkHi = Math.max(0, allHi - p.operatorCash - debt - carry);
  return { rows, allLo, allHi, base: (allLo + allHi) / 2, debt, carry, checkLo, checkHi, operatorCash: p.operatorCash };
}

/* ---------------------- scoring ---------------------- */
function clamp(x) { return Math.max(1, Math.min(5, x)); }

function conceptScore(o, p) {
  let s = 3;
  const beachW = p.conceptPriority === "cashflow" ? 0.4 : 1;
  if (o.beachProximity === "on") s += 1.5 * beachW;
  else if (o.beachProximity === "adjacent") s += 0.5 * beachW;
  else if (o.beachProximity === "inland") s -= 1.5 * beachW;
  const cap = o.capacity;
  if (cap) {
    if (cap >= p.capLow && cap <= p.capHigh) s += 1;
    else if (cap >= p.capLow * 0.8 && cap <= p.capHigh * 1.2) s += 0.3;
    else s -= 1;
  }
  if (o.licenseType && o.licenseType !== "unknown") {
    if (p.prefLicense === "either" || p.prefLicense === o.licenseType) s += 0.5;
    if (p.conceptPriority === "beach" && o.licenseType === "48") s -= 1;
  } else s -= 0.2;
  if (o.kitchen === true) s += 0.3;
  if (o.leaseYears) { if (o.leaseYears >= 10) s += 0.3; else if (o.leaseYears < 5) s -= 0.3; }
  return clamp(s);
}

function econScore(o) {
  const ask = Number(o.asking) || 0;
  let s = 3, conf = "ok", note = null;
  if (o.sde) {
    const mult = ask / o.sde;
    if (mult < 3) s += 1.5; else if (mult < 4) s += 0.7; else if (mult < 5) s += 0;
    else if (mult < 6) s -= 0.7; else s -= 1.5;
  } else { s = 2; conf = "low"; note = "No SDE — financials unverified"; }
  if (o.rentMonthly && o.revenue) {
    const r = (o.rentMonthly * 12) / o.revenue;
    if (r < 0.08) s += 0.7; else if (r < 0.12) s += 0.2; else if (r < 0.15) s -= 0.5; else s -= 1.2;
  }
  if (o.leaseYears) { if (o.leaseYears >= 12) s += 0.4; else if (o.leaseYears >= 8) s += 0.2; else if (o.leaseYears < 5) s -= 0.4; }
  if (o.sellerFinancing === true || o.sellerFinancing === "true") s += 0.4;
  return { score: clamp(s), conf, note, mult: o.sde ? (ask / o.sde) : null };
}

function rentKills(o) {
  if (o.rentMonthly && o.revenue && (o.rentMonthly * 12) / o.revenue > 0.18) return true;
  if (o.rentMonthly >= 25000 && Number(o.asking) > 0 && Number(o.asking) < 260000) return true;
  return false;
}

function recommend(o, p, fin, cScore, eObj) {
  if (rentKills(o)) return { action: "Pass — rent kills it", tone: "red" };
  const capCeil = p.operatorCash + p.maxPartnerCheck + (fin ? fin.debt + fin.carry : 0);
  if (fin && fin.allLo > capCeil) return { action: "Pursue if capital expands", tone: "amber" };
  const cHigh = cScore >= 3.8, cLow = cScore <= 2.5;
  const eHigh = eObj.score >= 3.8, eLow = eObj.score <= 2.5, eUnknown = eObj.conf === "low";
  if (cHigh && eHigh) return { action: "Pursue now", tone: "green" };
  if (cHigh && eUnknown) return { action: "Broker call — verify financials", tone: "navy" };
  if (cHigh && eLow) return { action: "Concept fit, weak economics", tone: "amber" };
  if (cLow && eHigh) return { action: "Economics-led alternative", tone: "accent" };
  if (cLow && eLow) return { action: "Pass", tone: "red" };
  return { action: "Hold / investigate", tone: "muted" };
}

function diligenceFlags(o) {
  const f = ["ABC license transfer + good standing", "Lease assignment / landlord consent"];
  if (!o.licenseType || o.licenseType === "unknown") f.push("Verify ABC license type & status");
  if (o.licenseType === "47") f.push("Type 47 food-service / kitchen compliance");
  if (o.conceptChange && o.conceptChange !== "none") f.push("CUP supports new concept (hours / entertainment / patio)");
  if (o.sde) f.push("Verify SDE with 3-yr tax returns + bank statements");
  else f.push("Obtain 3-yr P&L + tax returns (no verified financials)");
  if (!o.capacity) f.push("Confirm true fire-code occupancy with broker");
  if (o.leaseYears && o.leaseYears < 10) f.push("Short lease — verify options & rent resets");
  return f;
}

const BROKER_QS = [
  "Actual 3-year revenue, SDE, and add-backs?",
  "ABC license type, status, conditions?",
  "Lease: assignable? remaining term, options, escalators, consent process?",
  "True fire-code occupancy / seat count?",
  "Seller financing available, and on what terms?",
  "Reason for sale?",
  "Deferred capex (kitchen, HVAC, equipment)?",
  "Any ABC discipline, CUP conditions, neighbor/police history?",
];

/* ---------------------- parameter presets ---------------------- */
const PARAMS_BOARDWALK = {
  operatorCash: 150000, maxPartnerCheck: 300000, useSBA: true, sbaPct: 0.5,
  sellerCarry: "preferred", carryPct: 0.25, negLow: 0.9, negHigh: 1.0,
  capLow: 80, capHigh: 120, prefLicense: "47", conceptPriority: "beach",
};
const PARAMS_CUSTOM = {
  operatorCash: 200000, maxPartnerCheck: 500000, useSBA: true, sbaPct: 0.5,
  sellerCarry: "preferred", carryPct: 0.25, negLow: 0.9, negHigh: 1.0,
  capLow: 60, capHigh: 150, prefLicense: "either", conceptPriority: "cashflow",
};

/* ---------------------- seed pipeline ---------------------- */
const SEED_BOARDWALK = [
  { id: "ob", name: "Ocean Beach (SD)", city: "Ocean Beach, San Diego", asking: 345000, sqft: 2076, capacity: 95, licenseType: "47", rentMonthly: 9336, leaseYears: 15, sde: null, revenue: null, sellerFinancing: true, conceptChange: "moderate", beachProximity: "on", kitchen: true, sourceUrl: "https://www.bizquest.com/asset-sales/ocean-beach-restaurant-bar-for-sale/BW2316437", notes: "Brand/menu excluded. Reduced from $395k." },
  { id: "sc", name: "San Clemente Sports B&G", city: "San Clemente", asking: 550000, sqft: null, capacity: null, licenseType: "47", rentMonthly: null, leaseYears: null, sde: null, revenue: null, sellerFinancing: true, conceptChange: "light", beachProximity: "adjacent", kitchen: true, sourceUrl: "https://www.bizben.com/business-for-sale/bar-and-grill-for-sale-in-san-clemente-california-279513.php", notes: "$270k down + owner carry. Size NDA-gated." },
  { id: "bs", name: "Belmont Shore", city: "Long Beach", asking: 725000, sqft: 2900, capacity: 100, licenseType: "47", rentMonthly: 11400, leaseYears: 5, sde: null, revenue: null, sellerFinancing: false, conceptChange: "light", beachProximity: "adjacent", kitchen: true, sourceUrl: "https://www.bizbuysell.com/california/long-beach/bars-pubs-and-taverns-for-sale/", notes: "5+5 lease. Location Matters." },
  { id: "hbms", name: "HB Main Street", city: "Huntington Beach", asking: 965000, sqft: 6000, capacity: 110, licenseType: "47", rentMonthly: 9000, leaseYears: 20, sde: null, revenue: null, sellerFinancing: false, conceptChange: "light", beachProximity: "on", kitchen: true, sourceUrl: "https://www.bizbuysell.com/california/orange-county/restaurants-and-food-business-assets-for-sale/", notes: "Type 47 no live entertainment. All-cash ask." },
  { id: "cm", name: "Costa Mesa", city: "Costa Mesa", asking: 840000, sqft: 4800, capacity: 101, licenseType: "47", rentMonthly: 11800, leaseYears: 16, sde: 223000, revenue: 1753200, sellerFinancing: false, conceptChange: "light", beachProximity: "inland", kitchen: true, sourceUrl: "https://openfair.co/businesses-for-sale/en/for-sale-restaurant-and-bar-47-abc-license-costa-mesa-california-OF0045308", notes: "Claimed $223k net — VERIFY. 16-yr lease." },
  { id: "os", name: "Oceanside Downtown", city: "Oceanside", asking: 795000, sqft: 4231, capacity: 150, licenseType: "47", rentMonthly: 17940, leaseYears: 16, sde: null, revenue: null, sellerFinancing: false, conceptChange: "moderate", beachProximity: "adjacent", kitchen: true, sourceUrl: "https://www.bizbuysell.com/california/oceanside/restaurants-and-food-businesses-for-sale/", notes: "Larger venue. Fully fixturized." },
  { id: "sushi", name: "HB Sushi", city: "Huntington Beach", asking: 450000, sqft: 1681, capacity: 60, licenseType: "47", rentMonthly: 10700, leaseYears: 6, sde: null, revenue: null, sellerFinancing: false, conceptChange: "heavy", beachProximity: "on", kitchen: true, sourceUrl: "https://www.bizquest.com/asset-sales/hb-sushi-and-hand-roll-restaurant-full-liquor-license/BW2486378", notes: "50-70 cap. Sushi→bar rebrand is heavy." },
  { id: "turcs", name: "TURCS (RE included)", city: "Sunset Beach", asking: 3250000, sqft: 1900, capacity: 70, licenseType: "48", rentMonthly: 0, leaseYears: 99, sde: null, revenue: null, sellerFinancing: false, conceptChange: "none", beachProximity: "on", kitchen: false, sourceUrl: "https://www.bizbuysell.com/business-opportunity/price-reduction-iconic-bar-and-real-estate-by-the-beach-for-sale/2294980/", notes: "RE + business. Live only with RE partner." },
  { id: "ncw", name: "Newport Coast Hwy", city: "Newport Beach", asking: 195000, sqft: 5500, capacity: 250, licenseType: "47", rentMonthly: 38500, leaseYears: 5, sde: null, revenue: null, sellerFinancing: false, conceptChange: "moderate", beachProximity: "adjacent", kitchen: true, sourceUrl: "https://www.bizquest.com/asset-sales/newport-beach-prime-coast-highway-restaurant-bar-for-lease/BW2483391", notes: "Rent $38.5k/mo — lease dump." },
  { id: "pl", name: "HB Peter's Landing", city: "Huntington Beach", asking: 200000, sqft: 4850, capacity: 200, licenseType: "47", rentMonthly: 28000, leaseYears: 10, sde: null, revenue: null, sellerFinancing: false, conceptChange: "moderate", beachProximity: "on", kitchen: true, sourceUrl: "https://www.bizquest.com/asset-sales/huntington-beach-waterfront-restaurant-for-lease-2-am-liquor/BW2311037", notes: "Rent $28k/mo — lease dump." },
];

const TONE_COLOR = { green: C.green, accent: C.accent, navy: C.navy, amber: C.amber, red: C.red, muted: C.muted };
const ORDER = { "Pursue now": 0, "Economics-led alternative": 1, "Broker call — verify financials": 2, "Concept fit, weak economics": 3, "Pursue if capital expands": 4, "Hold / investigate": 5, "Pass": 6, "Pass — rent kills it": 7 };

/* ============================================================
   TABLE GRID — single source of truth for column widths
   ============================================================ */
const GRID_COLS = "minmax(160px, 2fr) 88px 168px 132px 68px 68px minmax(148px, 1fr)";

/* ============================================================
   UI
   ============================================================ */
export default function App() {
  const [mode, setMode] = useState("boardwalk");
  const [paramsByMode, setParamsByMode] = useState({ boardwalk: PARAMS_BOARDWALK, custom: PARAMS_CUSTOM });
  const [oppsByMode, setOppsByMode] = useState({ boardwalk: SEED_BOARDWALK.map(normalizeOpp), custom: [] });
  const [loaded, setLoaded] = useState(false);
  const [showCriteria, setShowCriteria] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [finding, setFinding] = useState(false);
  const [findErr, setFindErr] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState("");

  const params = paramsByMode[mode];
  const opps = oppsByMode[mode];
  const setParams = (np) => setParamsByMode((s) => ({ ...s, [mode]: np }));
  const setOpps = (no) => setOppsByMode((s) => ({ ...s, [mode]: no }));

  useEffect(() => {
    (async () => {
      try {
        for (const md of ["boardwalk", "custom"]) {
          try {
            const o = await store.get(`wh:opps:${md}`);
            if (o && o.value) setOppsByMode((s) => ({ ...s, [md]: JSON.parse(o.value).map(normalizeOpp) }));
          } catch (e) {}
          try {
            const pr = await store.get(`wh:params:${md}`);
            if (pr && pr.value) setParamsByMode((s) => ({ ...s, [md]: JSON.parse(pr.value) }));
          } catch (e) {}
        }
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    (async () => { try { await store.set(`wh:opps:${mode}`, JSON.stringify(opps)); } catch (e) {} })();
  }, [opps, mode, loaded]);
  useEffect(() => {
    if (!loaded) return;
    (async () => { try { await store.set(`wh:params:${mode}`, JSON.stringify(params)); } catch (e) {} })();
  }, [params, mode, loaded]);

  const scored = useMemo(() => {
    return opps
      .map((o) => {
        const fin = computeAllIn(o, params);
        const cScore = conceptScore(o, params);
        const eObj = econScore(o);
        const rec = recommend(o, params, fin, cScore, eObj);
        return { o, fin, cScore, eObj, rec, flags: diligenceFlags(o) };
      })
      .sort((a, b) => (ORDER[a.rec.action] ?? 9) - (ORDER[b.rec.action] ?? 9) || (b.cScore + b.eObj.score) - (a.cScore + a.eObj.score));
  }, [opps, params]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return scored;
    return scored.filter((s) =>
      s.o.name.toLowerCase().includes(q) || (s.o.city || "").toLowerCase().includes(q)
    );
  }, [scored, search]);

  const addOpp = (o) => { setOpps([normalizeOpp({ ...o, id: newId() }), ...opps]); setShowAdd(false); };
  const delOpp = (id) => {
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Remove this opportunity from the pipeline?")) return;
    setOpps(opps.filter((x) => x.id !== id));
  };
  const resetSeed = () => {
    if (mode === "boardwalk") setOpps(SEED_BOARDWALK.map(normalizeOpp)); else setOpps([]);
    setParams(mode === "boardwalk" ? PARAMS_BOARDWALK : PARAMS_CUSTOM);
  };

  const findListings = async (location, maxPrice, count) => {
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) { setFindErr("Set VITE_ANTHROPIC_API_KEY in your Railway environment variables."); return; }
    setFinding(true); setFindErr(null);

    const prompt = `Search BizBuySell.com, BizQuest.com, and BizBen.com for bar and restaurant businesses currently listed for sale in "${location}"${maxPrice ? ` priced under $${Number(maxPrice).toLocaleString()}` : ""}. Find ${count} active listings.\n\nFor each listing return a JSON object with exactly these fields:\nname (string), city (string), asking (number or null), sqft (number or null), capacity (number or null), licenseType ("47"|"48"|"unknown"), rentMonthly (number or null), leaseYears (number or null), sde (number or null), revenue (number or null), sellerFinancing (boolean), conceptChange ("none"|"light"|"moderate"|"heavy"), beachProximity ("on"|"adjacent"|"inland"|"unknown"), kitchen (boolean), notes (string under 100 chars), sourceUrl (direct listing URL).\n\nReturn ONLY a valid JSON array. No markdown, no prose.`;

    try {
      let messages = [{ role: "user", content: prompt }];
      let finalText = null;

      for (let i = 0; i < 10; i++) {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "web-search-2025-03-05",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514", max_tokens: 4000,
            tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
            messages,
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        if (data.stop_reason === "end_turn") {
          finalText = (data.content || []).find(b => b.type === "text")?.text;
          break;
        }
        if (data.stop_reason === "tool_use") {
          messages = [
            ...messages,
            { role: "assistant", content: data.content },
            {
              role: "user",
              content: data.content
                .filter(b => b.type === "tool_use")
                .map(b => ({ type: "tool_result", tool_use_id: b.id, content: "" })),
            },
          ];
        } else {
          finalText = (data.content || []).find(b => b.type === "text")?.text;
          break;
        }
      }

      if (!finalText) throw new Error("No response from search.");
      const clean = finalText.replace(/```json/g, "").replace(/```/g, "").trim();
      const match = clean.match(/\[[\s\S]*\]/);
      if (!match) throw new Error("Couldn't parse listings from response.");
      const listings = JSON.parse(match[0]);
      if (!Array.isArray(listings) || !listings.length) throw new Error("No listings found — try a different location.");

      setOpps(prev => [...listings.map(j => normalizeOpp({ ...j, id: newId() })), ...prev]);
      setShowFind(false);
    } catch (e) {
      setFindErr(e.message || "Search failed — try again.");
    }
    setFinding(false);
  };

  return (
    <div style={{ ...ui, background: C.paper, color: C.ink, minHeight: "100vh" }}>
      <style>{FONTS}</style>

      {/* ── TOP NAV ── */}
      <header style={{ background: C.ink, position: "sticky", top: 0, zIndex: 50, boxShadow: "0 1px 0 rgba(255,255,255,0.07)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 20px", display: "flex", alignItems: "center", height: 54, gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: C.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Anchor size={17} color="#fff" strokeWidth={2.2} />
            </div>
            <span style={{ ...display, fontSize: 20, fontWeight: 700, color: C.paper, letterSpacing: "-0.01em" }}>Wheelhouse</span>
            <span style={{ ...ui, fontSize: 12, color: "rgba(255,255,255,0.38)", marginLeft: 2 }}>Bar acquisition screener</span>
          </div>
          {/* mode toggle */}
          <div style={{ display: "flex", background: "rgba(255,255,255,0.1)", borderRadius: 8, padding: 3, flexShrink: 0 }}>
            {[["boardwalk", "Boardwalk Thesis"], ["custom", "Custom Search"]].map(([id, label]) => (
              <button key={id} onClick={() => { setMode(id); setExpanded(null); setSearch(""); }}
                style={{ ...ui, fontSize: 13, fontWeight: 600, padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
                  background: mode === id ? C.paper : "transparent",
                  color: mode === id ? C.ink : "rgba(255,255,255,0.6)",
                  transition: "background 0.15s, color 0.15s" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 20px 60px" }}>

        {/* mode strap */}
        <div style={{
          background: mode === "boardwalk" ? C.navy : C.accent,
          color: "#fff", borderRadius: 10, padding: "10px 16px", marginBottom: 18, fontSize: 13, lineHeight: 1.5,
        }}>
          {mode === "boardwalk"
            ? "Pre-tuned: $150k operator cash · SBA on · seller carry preferred · 80–120 cap · Type 47 · beach-led · seeded with the live shortlist."
            : "Open mode: configure your own capital, capacity, license, and concept priority, then add any listing to screen it."}
        </div>

        {/* ── CONTROLS ROW ── */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
          {/* search */}
          <div style={{ display: "flex", alignItems: "center", gap: 0, flex: "1 1 200px", maxWidth: 380 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "#fff", border: `1px solid ${C.line}`, borderRadius: "9px 0 0 9px",
              padding: "0 12px", height: 38, flex: 1,
              borderRight: "none",
            }}>
              <Search size={14} color={C.muted} style={{ flexShrink: 0 }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setSearch("")}
                placeholder="Search by name or city…"
                style={{ ...ui, fontSize: 13, border: "none", outline: "none", flex: 1, background: "transparent", color: C.ink }}
              />
              {search && (
                <button onClick={() => setSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, display: "flex", alignItems: "center", padding: 0 }}>
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              style={{
                ...ui, height: 38, padding: "0 16px", fontSize: 13, fontWeight: 600,
                background: C.ink, color: C.paper, border: "none", borderRadius: "0 9px 9px 0",
                cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              Search
            </button>
          </div>

          <button onClick={() => setShowCriteria((s) => !s)}
            style={btn(showCriteria ? C.ink : C.card, showCriteria ? C.paper : C.ink, !showCriteria)}>
            <SlidersHorizontal size={14} /> Criteria
          </button>
          <button onClick={resetSeed} style={btn(C.card, C.muted, true)}>
            <RotateCcw size={14} /> Reset
          </button>

          {/* right-side CTAs */}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={() => { setShowFind(s => !s); setFindErr(null); }}
              style={{ ...btn(showFind ? C.accent : C.card, showFind ? "#fff" : C.accent, !showFind), border: showFind ? "none" : `1.5px solid ${C.accent}` }}>
              <Sparkles size={14} /> Find Listings
            </button>
            <button onClick={() => setShowAdd(true)}
              style={{ ...btn(C.accent, "#fff"), padding: "9px 20px", fontSize: 14, fontWeight: 700 }}>
              <Plus size={16} /> Add Opportunity
            </button>
          </div>
        </div>

        {showCriteria && <Criteria params={params} setParams={setParams} mode={mode} />}
        {showFind && <FindPanel onFind={findListings} onClose={() => setShowFind(false)} finding={finding} error={findErr} />}

        {/* ── PIPELINE TABLE ── */}
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflowX: "auto", background: C.card }}>

          {/* table header */}
          <div style={{
            display: "grid", gridTemplateColumns: GRID_COLS, gap: 8, alignItems: "center",
            ...mono, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted,
            padding: "10px 16px", borderBottom: `1px solid ${C.line}`,
          }}>
            <div>Target</div>
            <div style={{ textAlign: "right" }}>Asking</div>
            <div style={{ textAlign: "right" }}>All-in range</div>
            <div style={{ textAlign: "right" }}>Partner $</div>
            <div style={{ textAlign: "center" }}>Concept</div>
            <div style={{ textAlign: "center" }}>Econ</div>
            <div style={{ textAlign: "right" }}>Action</div>
          </div>

          {filtered.length === 0 && (
            <div style={{ padding: "40px 16px", textAlign: "center", color: C.muted, fontSize: 13.5 }}>
              {search
                ? `No results for "${search}" — try a different name or city.`
                : "No opportunities yet. Click Add Opportunity to get started."}
            </div>
          )}

          {filtered.map((s) => (
            <Row key={s.o.id} s={s}
              expanded={expanded === s.o.id}
              onToggle={() => setExpanded(expanded === s.o.id ? null : s.o.id)}
              onDelete={() => delOpp(s.o.id)} />
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 10 }}>
          <span style={{ ...mono, fontSize: 11.5, color: C.muted }}>
            {filtered.length}{filtered.length !== scored.length ? ` of ${scored.length}` : ""} {filtered.length === 1 ? "opportunity" : "opportunities"}
          </span>
        </div>

        <div style={{ ...ui, fontSize: 11.5, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
          Estimates from a parametric sources-and-uses model, not quotes. Scores support judgment; they do not replace broker calls,
          financial diligence, ABC/CUP verification, or lease review. All-in ranges assume {Math.round((1 - params.negLow) * 100)}–0% off ask
          {params.useSBA ? `, SBA debt ≈ ${Math.round(params.sbaPct * 100)}% of purchase` : ", no SBA debt"}
          {params.sellerCarry !== "none" ? `, seller carry ≈ ${Math.round(params.carryPct * 100)}% where available.` : ", no seller carry."}
        </div>
      </div>

      {/* ── ADD OPPORTUNITY MODAL ── */}
      {showAdd && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(22,36,46,0.6)",
            zIndex: 100, overflowY: "auto", padding: "32px 16px",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }}
        >
          <div style={{ width: "100%", maxWidth: 700 }}>
            <AddForm onAdd={addOpp} onClose={() => setShowAdd(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── shared button style ── */
function btn(bg, fg, border) {
  return {
    ...ui, display: "inline-flex", alignItems: "center", gap: 6,
    fontSize: 13, fontWeight: 600, padding: "8px 14px", borderRadius: 9,
    cursor: "pointer", background: bg, color: fg,
    border: border ? `1px solid ${C.line}` : "none",
  };
}

/* ── score dot ── */
function Score({ v, conf }) {
  const col = v >= 3.8 ? C.green : v >= 3 ? C.accent : v >= 2.5 ? C.amber : C.red;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
      <span style={{ ...mono, fontSize: 13, fontWeight: 600, color: col }}>{v.toFixed(1)}</span>
      {conf === "low" && <AlertCircle size={11} color={C.amber} />}
    </div>
  );
}

/* ── pipeline row ── */
function Row({ s, expanded, onToggle, onDelete }) {
  const { o, fin, cScore, eObj, rec, flags } = s;
  const tone = TONE_COLOR[rec.tone];
  return (
    <div style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
      {/* summary */}
      <div
        onClick={onToggle}
        style={{ display: "grid", gridTemplateColumns: GRID_COLS, gap: 8, padding: "12px 16px", alignItems: "center", cursor: "pointer" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = C.lineSoft; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        {/* name + city */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ color: C.muted, flexShrink: 0 }}>
            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...ui, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.name}</div>
            <div style={{ ...ui, fontSize: 11.5, color: C.muted }}>{o.city}</div>
          </div>
        </div>

        <div style={{ ...mono, fontSize: 13, textAlign: "right" }}>{m(Number(o.asking))}</div>
        <div style={{ ...mono, fontSize: 12.5, textAlign: "right", color: C.muted }}>{fin ? rangeM(fin.allLo, fin.allHi) : "—"}</div>
        <div style={{ ...mono, fontSize: 13, textAlign: "right" }}>{fin ? rangeK(fin.checkLo, fin.checkHi) : "—"}</div>
        <div><Score v={cScore} /></div>
        <div><Score v={eObj.score} conf={eObj.conf} /></div>
        <div style={{ textAlign: "right" }}>
          <span style={{
            ...ui, fontSize: 11.5, fontWeight: 600, color: "#fff", background: tone,
            padding: "4px 10px", borderRadius: 20, whiteSpace: "nowrap", display: "inline-block",
          }}>
            {rec.action}
          </span>
        </div>
      </div>

      {/* expanded detail */}
      {expanded && (
        <div style={{ padding: "4px 20px 20px 44px", background: "#fff", borderTop: `1px solid ${C.lineSoft}` }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
            {/* sources & uses */}
            <div style={{ flex: "1 1 320px", minWidth: 280 }}>
              <Hd>Sources & uses (estimated)</Hd>
              {fin ? (
                <table style={{ width: "100%", ...mono, fontSize: 12, borderCollapse: "collapse" }}>
                  <tbody>
                    {fin.rows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                        <td style={{ padding: "4px 0", ...ui, color: C.ink }}>{r[0]}</td>
                        <td style={{ padding: "4px 0", textAlign: "right", color: C.muted }}>{k(r[1] * 1000)}</td>
                        <td style={{ padding: "4px 8px 4px 0", textAlign: "right" }}>{k(r[2] * 1000)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ padding: "6px 0", ...ui, fontWeight: 700 }}>All-in</td>
                      <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 600 }}>{k(fin.allLo)}</td>
                      <td style={{ padding: "6px 8px 6px 0", textAlign: "right", fontWeight: 600 }}>{k(fin.allHi)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : <Note>Enter an asking price to model all-in capital.</Note>}
              {fin && (
                <div style={{ ...ui, fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
                  Stack: operator <b style={{ color: C.ink }}>{k(fin.operatorCash)}</b> ·
                  debt <b style={{ color: C.ink }}>{k(fin.debt)}</b> · seller carry <b style={{ color: C.ink }}>{k(fin.carry)}</b> ·
                  partner check <b style={{ color: C.ink }}>{rangeK(fin.checkLo, fin.checkHi)}</b>
                </div>
              )}
            </div>

            {/* scores + flags */}
            <div style={{ flex: "1 1 300px", minWidth: 260 }}>
              <Hd>Read</Hd>
              <div style={{ ...ui, fontSize: 12.5, lineHeight: 1.55, marginBottom: 10 }}>
                <div>Concept fit <b>{cScore.toFixed(1)}</b> · Economics <b>{eObj.score.toFixed(1)}</b>
                  {eObj.mult ? <> · {eObj.mult.toFixed(1)}x SDE</> : ""}
                </div>
                {eObj.note && <div style={{ color: C.amber, marginTop: 3 }}>{eObj.note}</div>}
                <div style={{ marginTop: 3 }}>
                  License: {o.licenseType === "unknown" || !o.licenseType ? "verify with ABC" : "Type " + o.licenseType}
                  {" · "}Capacity: {o.capacity || "unknown"}
                  {" · "}Lease: {o.leaseYears ? o.leaseYears + " yr" : "unknown"}
                </div>
                {o.notes && <div style={{ color: C.muted, marginTop: 4, fontStyle: "italic" }}>{o.notes}</div>}
              </div>
              <Hd>Diligence gates</Hd>
              <ul style={{ margin: "0 0 10px", paddingLeft: 16, ...ui, fontSize: 12, lineHeight: 1.5 }}>
                {flags.map((f, i) => <li key={i} style={{ marginBottom: 2 }}>{f}</li>)}
              </ul>
              <Hd>Broker questions</Hd>
              <ul style={{ margin: 0, paddingLeft: 16, ...ui, fontSize: 12, lineHeight: 1.5, color: C.muted }}>
                {BROKER_QS.map((q, i) => <li key={i} style={{ marginBottom: 2 }}>{q}</li>)}
              </ul>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
                {o.sourceUrl && (
                  <a href={o.sourceUrl} target="_blank" rel="noreferrer"
                    style={{ ...ui, fontSize: 12, fontWeight: 600, color: C.accent, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
                    <ExternalLink size={13} /> View listing
                  </a>
                )}
                <button onClick={onDelete}
                  style={{ ...ui, fontSize: 12, fontWeight: 600, color: C.red, background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
                  <Trash2 size={13} /> Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const Hd = ({ children }) => (
  <div style={{ ...mono, fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", color: C.muted, marginBottom: 6 }}>
    {children}
  </div>
);
const Note = ({ children }) => <div style={{ ...ui, fontSize: 12.5, color: C.muted }}>{children}</div>;

/* ── criteria panel ── */
function Criteria({ params, setParams, mode }) {
  const set = (key, val) => setParams({ ...params, [key]: val });
  const num = (v) => (v === "" ? 0 : Number(v));
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, background: C.card, padding: "16px", marginBottom: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <Field label="Operator cash"><MoneyIn v={params.operatorCash} on={(x) => set("operatorCash", num(x))} /></Field>
        <Field label="Max partner check"><MoneyIn v={params.maxPartnerCheck} on={(x) => set("maxPartnerCheck", num(x))} /></Field>
        <Field label="Target capacity">
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <SmallNum v={params.capLow} on={(x) => set("capLow", num(x))} />
            <span style={{ color: C.muted }}>–</span>
            <SmallNum v={params.capHigh} on={(x) => set("capHigh", num(x))} />
          </div>
        </Field>
        <Field label="Preferred license">
          <Seg opts={[["47", "47"], ["48", "48"], ["either", "Either"]]} v={params.prefLicense} on={(x) => set("prefLicense", x)} />
        </Field>
        <Field label="Concept priority">
          <Seg opts={[["beach", "Beach"], ["cashflow", "Cash-flow"]]} v={params.conceptPriority} on={(x) => set("conceptPriority", x)} />
        </Field>
        <Field label="SBA debt">
          <Seg opts={[[true, "On"], [false, "Off"]]} v={params.useSBA} on={(x) => set("useSBA", x)} />
        </Field>
        <Field label="Seller carry">
          <Seg opts={[["preferred", "Pref."], ["required", "Req."], ["none", "None"]]} v={params.sellerCarry} on={(x) => set("sellerCarry", x)} />
        </Field>
      </div>
    </div>
  );
}

const Field = ({ label, children }) => (
  <div style={{ minWidth: 120 }}>
    <div style={{ ...mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: C.muted, marginBottom: 5 }}>{label}</div>
    {children}
  </div>
);

function MoneyIn({ v, on }) {
  return (
    <div style={{ display: "flex", alignItems: "center", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 8px" }}>
      <span style={{ ...mono, fontSize: 12, color: C.muted }}>$</span>
      <input value={v} onChange={(e) => on(e.target.value.replace(/[^0-9]/g, ""))}
        style={{ ...mono, fontSize: 12.5, border: "none", outline: "none", width: 78, background: "transparent", color: C.ink }} />
    </div>
  );
}

function SmallNum({ v, on }) {
  return (
    <input value={v} onChange={(e) => on(e.target.value.replace(/[^0-9]/g, ""))}
      style={{ ...mono, fontSize: 12.5, border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 7px", width: 48, background: "#fff", outline: "none", color: C.ink, textAlign: "center" }} />
  );
}

function Seg({ opts, v, on }) {
  return (
    <div style={{ display: "flex", background: C.chipBg, borderRadius: 8, padding: 2 }}>
      {opts.map(([val, label]) => (
        <button key={String(val)} onClick={() => on(val)}
          style={{ ...ui, fontSize: 12, fontWeight: 600, padding: "5px 9px", borderRadius: 6, border: "none", cursor: "pointer",
            background: v === val ? C.ink : "transparent", color: v === val ? C.paper : C.muted }}>
          {label}
        </button>
      ))}
    </div>
  );
}

/* ── add form (modal) ── */
const BLANK = {
  name: "", city: "", asking: "", sqft: "", capacity: "", licenseType: "unknown",
  rentMonthly: "", leaseYears: "", sde: "", revenue: "", sellerFinancing: "false",
  conceptChange: "light", beachProximity: "unknown", kitchen: "true", sourceUrl: "", notes: "",
};

function AddForm({ onAdd, onClose }) {
  const [f, setF] = useState(BLANK);
  const [blurb, setBlurb] = useState("");
  const [parsing, setParsing] = useState(false);
  const [perr, setPerr] = useState(null);
  const set = (key, val) => setF((prev) => ({ ...prev, [key]: val }));

  const parse = async () => {
    if (!blurb.trim()) return;
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      setPerr("Set VITE_ANTHROPIC_API_KEY in your Railway environment variables.");
      return;
    }
    setParsing(true); setPerr(null);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 1000,
          messages: [{ role: "user", content:
            `Extract structured data from this business-for-sale listing. Return ONLY valid JSON, no markdown, no prose. Keys: name (string), city (string), asking (number USD or null), sqft (number or null), capacity (number or null), licenseType ("47"|"48"|"unknown"), rentMonthly (number/mo or null), leaseYears (number or null), sde (number or null), revenue (number or null), sellerFinancing (true|false), conceptChange ("none"|"light"|"moderate"|"heavy"), beachProximity ("on"|"adjacent"|"inland"|"unknown"), kitchen (true|false), notes (short string).\n\nLISTING:\n${blurb}` }],
        }),
      });
      const data = await res.json();
      const txt = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const clean = txt.replace(/```json/g, "").replace(/```/g, "").trim();
      const j = JSON.parse(clean);
      setF({
        name: j.name || "", city: j.city || "", asking: j.asking ?? "", sqft: j.sqft ?? "",
        capacity: j.capacity ?? "", licenseType: j.licenseType || "unknown",
        rentMonthly: j.rentMonthly ?? "", leaseYears: j.leaseYears ?? "", sde: j.sde ?? "",
        revenue: j.revenue ?? "", sellerFinancing: String(j.sellerFinancing ?? false),
        conceptChange: j.conceptChange || "light", beachProximity: j.beachProximity || "unknown",
        kitchen: String(j.kitchen ?? true), sourceUrl: "", notes: j.notes || "",
      });
    } catch (e) {
      setPerr("Couldn't parse listing — check your API key or fill the fields in manually below.");
    }
    setParsing(false);
  };

  const submit = () => {
    if (!f.name.trim()) return;
    onAdd({
      ...f,
      asking: f.asking === "" ? null : Number(f.asking),
      sqft: f.sqft === "" ? null : Number(f.sqft),
      capacity: f.capacity === "" ? null : Number(f.capacity),
      rentMonthly: f.rentMonthly === "" ? null : Number(f.rentMonthly),
      leaseYears: f.leaseYears === "" ? null : Number(f.leaseYears),
      sde: f.sde === "" ? null : Number(f.sde),
      revenue: f.revenue === "" ? null : Number(f.revenue),
      sellerFinancing: f.sellerFinancing === "true",
      kitchen: f.kitchen === "true",
    });
  };

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: C.card, padding: "22px 22px 20px", boxShadow: "0 24px 64px rgba(22,36,46,0.28)" }}>
      {/* modal header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ ...display, fontSize: 20, fontWeight: 600 }}>Add Opportunity</div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, display: "flex", alignItems: "center" }}>
          <X size={20} />
        </button>
      </div>

      {/* AI parse section */}
      <div style={{ background: `${C.accent}14`, border: `1px solid ${C.accent}44`, borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <Sparkles size={14} color={C.accent} />
          <span style={{ ...ui, fontSize: 11.5, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.06em" }}>AI Parse</span>
          <span style={{ ...ui, fontSize: 12, color: C.muted, marginLeft: 4 }}>— paste a broker blurb to auto-fill the fields below</span>
        </div>
        <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} rows={3}
          placeholder="Paste listing text here…"
          style={{ ...ui, fontSize: 13, width: "100%", border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", outline: "none", resize: "vertical", background: "#fff", color: C.ink, boxSizing: "border-box", marginBottom: 10 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={parse} disabled={parsing || !blurb.trim()}
            style={{ ...btn(C.accent, "#fff"), opacity: (parsing || !blurb.trim()) ? 0.5 : 1 }}>
            <Sparkles size={14} /> {parsing ? "Parsing…" : "Parse with AI"}
          </button>
          {perr && <span style={{ ...ui, fontSize: 12, color: C.amber }}>{perr}</span>}
        </div>
      </div>

      {/* fields */}
      <Hd>Listing details</Hd>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <In label="Name *" v={f.name} on={(x) => set("name", x)} w={200} />
        <In label="City / area" v={f.city} on={(x) => set("city", x)} w={160} />
        <In label="Asking $" v={f.asking} on={(x) => set("asking", x.replace(/[^0-9]/g, ""))} w={110} mono />
        <In label="Sq ft" v={f.sqft} on={(x) => set("sqft", x.replace(/[^0-9]/g, ""))} w={80} mono />
        <In label="Capacity" v={f.capacity} on={(x) => set("capacity", x.replace(/[^0-9]/g, ""))} w={80} mono />
        <In label="Rent $/mo" v={f.rentMonthly} on={(x) => set("rentMonthly", x.replace(/[^0-9]/g, ""))} w={100} mono />
        <In label="Lease yrs" v={f.leaseYears} on={(x) => set("leaseYears", x.replace(/[^0-9]/g, ""))} w={80} mono />
        <In label="SDE $" v={f.sde} on={(x) => set("sde", x.replace(/[^0-9]/g, ""))} w={110} mono />
        <In label="Revenue $" v={f.revenue} on={(x) => set("revenue", x.replace(/[^0-9]/g, ""))} w={120} mono />
      </div>
      <div style={{ marginBottom: 14 }}>
        <In label="Source URL" v={f.sourceUrl} on={(x) => set("sourceUrl", x)} w="100%" />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginBottom: 16 }}>
        <Field label="License"><Seg opts={[["47", "47"], ["48", "48"], ["unknown", "?"]]} v={f.licenseType} on={(x) => set("licenseType", x)} /></Field>
        <Field label="Beach"><Seg opts={[["on", "On"], ["adjacent", "Adj."], ["inland", "Inland"], ["unknown", "?"]]} v={f.beachProximity} on={(x) => set("beachProximity", x)} /></Field>
        <Field label="Concept change"><Seg opts={[["none", "None"], ["light", "Light"], ["moderate", "Mod."], ["heavy", "Heavy"]]} v={f.conceptChange} on={(x) => set("conceptChange", x)} /></Field>
        <Field label="Kitchen"><Seg opts={[["true", "Yes"], ["false", "No"]]} v={f.kitchen} on={(x) => set("kitchen", x)} /></Field>
        <Field label="Seller carry"><Seg opts={[["true", "Yes"], ["false", "No"]]} v={f.sellerFinancing} on={(x) => set("sellerFinancing", x)} /></Field>
      </div>

      <div style={{ marginBottom: 18 }}>
        <In label="Notes" v={f.notes} on={(x) => set("notes", x)} w="100%" />
      </div>

      <div style={{ display: "flex", gap: 8, paddingTop: 16, borderTop: `1px solid ${C.line}` }}>
        <button onClick={submit} disabled={!f.name.trim()}
          style={{ ...btn(C.ink, C.paper), padding: "10px 22px", fontSize: 14, opacity: f.name.trim() ? 1 : 0.45 }}>
          <Plus size={15} /> Add to pipeline
        </button>
        <button onClick={onClose} style={btn(C.card, C.muted, true)}>Cancel</button>
      </div>
    </div>
  );
}

function In({ label, v, on, w, mono: isMono, placeholder }) {
  return (
    <div style={{ width: w === "100%" ? "100%" : w }}>
      <div style={{ ...mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: C.muted, marginBottom: 4 }}>{label}</div>
      <input value={v} onChange={(e) => on(e.target.value)} placeholder={placeholder || ""}
        style={{ ...(isMono ? mono : ui), fontSize: 12.5, width: "100%", border: `1px solid ${C.line}`, borderRadius: 7, padding: "7px 10px", outline: "none", background: "#fff", color: C.ink, boxSizing: "border-box" }} />
    </div>
  );
}

/* ── find listings panel ── */
function FindPanel({ onFind, onClose, finding, error }) {
  const [location, setLocation] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [count, setCount] = useState("5");

  const go = () => {
    if (!location.trim() || finding) return;
    onFind(location.trim(), maxPrice ? Number(maxPrice) : null, Number(count));
  };

  return (
    <div style={{ border: `1px solid ${C.accent}55`, borderRadius: 12, background: `${C.accent}08`, padding: "16px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={15} color={C.accent} />
          <span style={{ ...ui, fontSize: 14, fontWeight: 700, color: C.ink }}>Find Live Listings</span>
          <span style={{ ...ui, fontSize: 12, color: C.muted }}>searches BizBuySell · BizQuest · BizBen in real time</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, display: "flex" }}><X size={16} /></button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <In label="Location / area *" v={location} on={setLocation} w={260} placeholder="e.g. Huntington Beach, Orange County" />
        <In label="Max price ($)" v={maxPrice} on={(v) => setMaxPrice(v.replace(/[^0-9]/g, ""))} w={140} mono placeholder="no limit" />
        <Field label="# of results">
          <Seg opts={[["3", "3"], ["5", "5"], ["8", "8"]]} v={count} on={setCount} />
        </Field>
        <button
          onClick={go}
          disabled={!location.trim() || finding}
          style={{ ...btn(C.accent, "#fff"), opacity: (!location.trim() || finding) ? 0.5 : 1, padding: "9px 20px", alignSelf: "flex-end" }}
        >
          <Sparkles size={14} /> {finding ? "Searching the web…" : "Find Listings"}
        </button>
      </div>

      {finding && (
        <div style={{ ...ui, fontSize: 12.5, color: C.muted, marginTop: 10 }}>
          Searching listing sites for active bars and restaurants for sale… takes 15–30 seconds.
        </div>
      )}
      {error && (
        <div style={{ ...ui, fontSize: 12.5, color: C.red, marginTop: 10 }}>{error}</div>
      )}
    </div>
  );
}
