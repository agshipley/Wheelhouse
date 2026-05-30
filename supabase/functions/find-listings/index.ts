import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/* ── row mapping (mirrors bar_screener.jsx) ── */
function oppToRow(o: Record<string, unknown>, mode: string) {
  return {
    id: o.id,
    mode,
    name: o.name,
    city: o.city ?? null,
    asking: o.asking ?? null,
    sqft: o.sqft ?? null,
    capacity: o.capacity ?? null,
    license_type: o.licenseType ?? "unknown",
    rent_monthly: o.rentMonthly ?? null,
    lease_years: o.leaseYears ?? null,
    sde: o.sde ?? null,
    revenue: o.revenue ?? null,
    seller_financing: o.sellerFinancing ?? false,
    concept_change: o.conceptChange ?? "light",
    beach_proximity: o.beachProximity ?? "unknown",
    kitchen: o.kitchen ?? null,
    source_url: o.sourceUrl ?? null,
    notes: o.notes ?? null,
  };
}

function newId() {
  return crypto.randomUUID();
}

/* ── normalise tool output into app-shaped object ── */
function normaliseListing(input: Record<string, unknown>) {
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    id: newId(),
    name: String(input.name ?? ""),
    city: input.city ? String(input.city) : null,
    asking: num(input.asking),
    sqft: num(input.sqft),
    capacity: num(input.capacity),
    licenseType: String(input.licenseType ?? "unknown"),
    rentMonthly: num(input.rentMonthly),
    leaseYears: num(input.leaseYears),
    sde: num(input.sde),
    revenue: num(input.revenue),
    sellerFinancing: Boolean(input.sellerFinancing),
    conceptChange: String(input.conceptChange ?? "light"),
    beachProximity: String(input.beachProximity ?? "unknown"),
    kitchen: input.kitchen == null ? null : Boolean(input.kitchen),
    sourceUrl: input.sourceUrl ? String(input.sourceUrl) : null,
    notes: input.notes ? String(input.notes) : null,
  };
}

const SYSTEM_PROMPT = `You are a bar acquisition researcher. Search BizBuySell.com, BizQuest.com, BizBen.com, and LoopNet for bars and restaurants currently listed for sale.

For each listing found, call the add_listing tool. Use at most 5 web searches total, then stop — do not write a summary or explanation.

DATA ACCURACY RULES:
- asking: only populate if the asking price is explicitly stated for this specific listing. If it appears in a search snippet but you are not certain it belongs to this listing, leave it null. Do not guess or infer.
- sourceUrl: this must be the direct permalink URL for the individual listing — the URL shown on the listing card itself (e.g. bizbuysell.com/business-opportunity/some-name/1234567/). Never use the search page URL you used to find it. If you cannot identify a direct listing URL, omit sourceUrl.
- All other fields: leave null if not explicitly stated. Do not infer or estimate.

Field guidance:
- licenseType: California ABC "47" = full restaurant/bar license, "48" = bar-only (21+), "unknown" if not stated
- conceptChange: "none" = buying turnkey as-is, "light" = minor rebrand/refresh, "moderate" = significant remodel or rebrand, "heavy" = full concept change required
- beachProximity: "on" = within 2 blocks of ocean, "adjacent" = walkable (under 10 min), "inland" = not a beach area, "unknown" if unclear
- sde: seller's discretionary earnings — the annual owner cash flow figure brokers use. Often labeled "Net Income", "Owner Benefit", or "Cash Flow"
- notes: pull the most useful facts from the listing (location highlights, lease terms, any financials mentioned), max 120 chars`;

const ADD_LISTING_TOOL = {
  name: "add_listing",
  description: "Adds a bar or restaurant listing to the acquisition pipeline. Call this once per listing found.",
  input_schema: {
    type: "object",
    required: ["name", "city"],
    properties: {
      name:            { type: "string",  description: "Business name" },
      city:            { type: "string",  description: "City and state" },
      asking:          { type: "number",  description: "Asking price USD" },
      sqft:            { type: "number",  description: "Square footage" },
      capacity:        { type: "number",  description: "Seated/standing capacity" },
      licenseType:     { type: "string",  enum: ["47", "48", "unknown"] },
      rentMonthly:     { type: "number",  description: "Monthly rent USD" },
      leaseYears:      { type: "number",  description: "Remaining lease years" },
      sde:             { type: "number",  description: "Annual seller discretionary earnings" },
      revenue:         { type: "number",  description: "Annual gross revenue" },
      sellerFinancing: { type: "boolean", description: "Seller financing available" },
      conceptChange:   { type: "string",  enum: ["none", "light", "moderate", "heavy"] },
      beachProximity:  { type: "string",  enum: ["on", "adjacent", "inland", "unknown"] },
      kitchen:         { type: "boolean", description: "Commercial kitchen present" },
      notes:           { type: "string",  description: "Key facts, max 120 chars" },
      sourceUrl:       { type: "string",  description: "Direct URL to this listing" },
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const { location, maxPrice, count, mode, existingNames } = await req.json();

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY secret not set" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  /* ── SSE stream setup ── */
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  const send = async (type: string, data: unknown) => {
    await writer.write(enc.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
  };

  /* ── agent loop (runs in background, streams results) ── */
  (async () => {
    try {
      const systemPrompt = SYSTEM_PROMPT +
        (existingNames?.length
          ? `\n\nDO NOT add these already-found listings: ${existingNames.join(", ")}`
          : "");

      const messages: unknown[] = [{
        role: "user",
        content: `Find ${count} active bars or restaurants for sale in "${location}"${maxPrice ? ` under $${Number(maxPrice).toLocaleString()}` : ""}. Call add_listing for each one you find.`,
      }];

      let found = 0;
      let timedOut = false;
      // 115s self-imposed deadline — sends a clean done event safely before
      // Supabase's 2-minute wall-time cuts the wire without warning.
      const deadline = Date.now() + 115_000;

      for (let i = 0; i < 15; i++) {
        if (Date.now() > deadline) {
          timedOut = true;
          break;
        }
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "web-search-2025-03-05",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4000,
            system: systemPrompt,
            tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }, ADD_LISTING_TOOL],
            messages,
          }),
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        messages.push({ role: "assistant", content: data.content });

        if (data.stop_reason === "end_turn") break;

        if (data.stop_reason === "tool_use") {
          const toolResults: unknown[] = [];

          for (const block of data.content) {
            if (block.type !== "tool_use") continue;

            if (block.name === "add_listing") {
              const listing = normaliseListing(block.input);
              await supabase.from("opportunities").insert(oppToRow(listing, mode ?? "custom"));
              found++;
              await send("listing", listing);
              await send("status", `Found ${found}: ${block.input.name}`);
              toolResults.push({ type: "tool_result", tool_use_id: block.id, content: `Added "${block.input.name}"` });
            } else {
              // web_search — server-side, acknowledge with empty content
              await send("status", "Searching the web…");
              toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "" });
            }
          }

          messages.push({ role: "user", content: toolResults });
        } else {
          break;
        }
      }

      await send("done", { found, timedOut });
    } catch (err) {
      await send("error", err instanceof Error ? err.message : String(err));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      ...CORS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});
