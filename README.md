# Wheelhouse

A bar acquisition pipeline screener built for evaluating SoCal coastal bar purchase opportunities. Screen listings, model all-in capital requirements, score concept fit and economics, and find or verify new listings — all in one place.

---

## For Users

### What it does

Wheelhouse is a private deal-tracking tool for evaluating bars and restaurants for sale. You paste in a listing (or let it find listings automatically), and it immediately tells you:

- **All-in capital required** — not just the asking price, but closing costs, license transfer fees, rebrand budget, inventory, working capital, and contingency, modeled as a range
- **Partner check size** — how much equity you'd need from a partner after your cash, SBA debt, and seller carry
- **Concept score** — how well the location, size, license type, and beach proximity match your target concept
- **Economics score** — whether the asking price is reasonable relative to earnings, rent burden, and lease terms
- **Action recommendation** — Pursue now, Broker call, Hold, Pass, etc.

### Two modes

- **Boardwalk Thesis** — pre-tuned for a SoCal coastal bar with $150k operator cash, SBA financing, seller carry preferred, Type 47 license, 80–120 seat capacity, beach-led
- **Custom Search** — open mode; set your own capital, capacity, license preference, and concept priority

### Adding listings

**Manually:** Click "Add Opportunity," fill in what you know, or paste a broker blurb into the AI Parse box and let it auto-fill the fields.

**Automatically:** Click "Find Listings," enter a location and optional price ceiling, and the app searches BizBuySell, BizQuest, and BizBen in real time. Listings appear in the pipeline as they're found.

### Cleaning up listings

Scraped listings are often incomplete. Three tools help:

- **Edit** — opens any listing in a form so you can fix individual fields
- **Re-check** — re-scrapes the source URL using AI and pre-fills the edit form with whatever fresh data it finds; fields it can't find stay as-is
- **Check Links** — scans all source URLs and flags dead or timed-out links so you know which listings may have sold

### Criteria panel

Click "Criteria" to adjust your capital stack, capacity targets, license preference, concept priority, SBA toggle, and seller carry assumption. Changes re-score the entire pipeline instantly.

### Scores and recommendations

Scores are 1–5. The action badge is determined by combining concept fit and economics:

| Concept | Economics | Action |
|---|---|---|
| High | High | Pursue now |
| High | Unknown | Broker call — verify financials |
| High | Low | Concept fit, weak economics |
| Low | High | Economics-led alternative |
| Either | Rent > 18% revenue | Pass — rent kills it |

All-in estimates are parametric models, not quotes. They support judgment — they don't replace broker calls, lease review, or financial diligence.

---

## Technical Reference

### Architecture

```
Browser (React SPA)
    │
    ├── Supabase Postgres  ← opportunities + params tables
    │       (read/write via @supabase/supabase-js, anon key)
    │
    └── Supabase Edge Functions (Deno)
            ├── find-listings     ← Claude agent loop + SSE stream
            ├── recheck-listing   ← Claude web search, returns JSON
            ├── parse-listing     ← Claude single-turn extraction
            └── check-links       ← parallel HEAD requests
```

The entire UI is a single file: `bar_screener.jsx`. All agent work runs server-side in Supabase Edge Functions to avoid browser timeouts and keep the Anthropic API key out of the client bundle.

### Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 6 |
| UI components | Lucide React (icons only), inline styles |
| Database | Supabase Postgres |
| Edge Functions | Supabase (Deno runtime) |
| AI | Anthropic Claude (Haiku for extraction, Sonnet for search agent) |
| Deployment | Railway (nixpacks build, `vite preview`) |

### Database schema

**`opportunities`**

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| mode | text | `"boardwalk"` or `"custom"` |
| name | text | |
| city | text | |
| asking | numeric | USD |
| sqft | integer | |
| capacity | integer | |
| license_type | text | `"47"`, `"48"`, or `"unknown"` |
| rent_monthly | numeric | USD/month |
| lease_years | numeric | Remaining years |
| sde | numeric | Annual seller discretionary earnings |
| revenue | numeric | Annual gross revenue |
| seller_financing | boolean | |
| concept_change | text | `"none"` / `"light"` / `"moderate"` / `"heavy"` |
| beach_proximity | text | `"on"` / `"adjacent"` / `"inland"` / `"unknown"` |
| kitchen | boolean | nullable |
| source_url | text | nullable |
| notes | text | nullable |
| created_at | timestamptz | auto |

**`params`**

| Column | Type | Notes |
|---|---|---|
| mode | text | PK (`"boardwalk"` or `"custom"`) |
| data | jsonb | Full params object |
| updated_at | timestamptz | |

### Environment variables

Set in Railway (build-time, baked into JS bundle):

```
VITE_SUPABASE_URL        https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY   eyJ...
```

Set as Supabase secrets (runtime, Edge Functions only — never in client bundle):

```
ANTHROPIC_API_KEY        sk-ant-...
```

`VITE_ANTHROPIC_API_KEY` is no longer used and can be removed from Railway if present.

### Edge Functions

#### `find-listings`

SSE-streaming agent loop. Accepts `{ location, maxPrice, count, mode, existingNames }`. Runs up to 15 turns of the Claude Sonnet agent with `web_search` (max 5 uses) and a custom `add_listing` tool. Each `add_listing` call immediately INSERTs the row into Supabase and streams a `listing` event to the browser. Self-imposes a 115s deadline (safely under Supabase's 120s wall-clock limit) and sends a `done` event with `{ found, timedOut }`.

Stream event types: `listing`, `status`, `done`, `error`.

#### `recheck-listing`

Single request/response. Accepts `{ sourceUrl, name }`. Runs a web search agent loop (max 3 searches, 8 turns) to find and read the specific listing page, then returns `{ result: <structured JSON> }`. The browser merges non-null fields over the existing opportunity and opens the edit form with the merged data.

#### `parse-listing`

Single request/response. Accepts `{ blurb }`. One-turn Claude Haiku call — no web search. Extracts structured data from pasted text and returns `{ result: <structured JSON> }`. Used by the AI Parse box in the Add/Edit form.

#### `check-links`

Accepts `{ links: [{ id, url }] }`. Fires parallel `HEAD` requests with an 8s timeout per URL, spoofing a Chrome user-agent to reduce bot-detection false positives. Returns `{ results: [{ id, ok, status }] }` where `ok: null` means timeout (soft failure — link may still be valid).

### Scoring model

**Concept score** (1–5): starts at 3, adjusted by beach proximity (weighted by `conceptPriority`), capacity vs. target range, license type match, kitchen presence, and lease length.

**Economics score** (1–5): starts at 3, adjusted by SDE multiple (primary driver), rent-to-revenue ratio, lease length, and seller financing. Drops to confidence `"low"` with score floor of 2 when SDE is absent.

**All-in capital model**: parametric sources-and-uses with size buckets (small/medium/large by sqft or capacity) driving lease deposit, inventory, payroll ramp, and working capital ranges. Rebrand capex uses `conceptChange` tier. Optional SBA debt (capped at $1.5M) and seller carry reduce the partner equity check.

### Deployment

Railway runs nixpacks auto-detection. Build: `npm install && npm run build`. Start: `npm run preview -- --host --port $PORT`. `vite.config.js` sets `preview.allowedHosts: true` (accepts any Railway-generated domain) and binds to `process.env.PORT`.

To deploy Edge Functions:

```bash
supabase functions deploy find-listings --project-ref <ref>
supabase functions deploy recheck-listing --project-ref <ref>
supabase functions deploy parse-listing --project-ref <ref>
supabase functions deploy check-links --project-ref <ref>
```

### Local development

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

The app falls back to in-memory seed data if Supabase is unreachable, so basic UI work doesn't require a live database connection.
