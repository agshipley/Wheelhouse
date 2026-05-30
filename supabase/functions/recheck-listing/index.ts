const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const { sourceUrl, name } = await req.json();
  if (!sourceUrl) {
    return new Response(JSON.stringify({ error: "sourceUrl is required" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY secret not set" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const searchPrompt = `Find this business-for-sale listing and describe all of its details in plain text.

URL: ${sourceUrl}${name ? `\nBusiness name: ${name}` : ""}

If the URL is a direct listing page, read it. If it is a search or category page, search for "${name}" on BizBuySell, BizQuest, or BizBen to find the specific listing page and read that.

Describe everything you find: asking price, monthly rent, lease term, SDE/net income/cash flow, annual revenue, square footage, capacity, ABC license type, seller financing availability, kitchen presence, location details, and any other relevant facts.`;

  const EXTRACT_PROMPT = `Extract structured data from this business listing description. Return ONLY valid JSON, no markdown, no prose. Keys: name (string), city (string), asking (number USD or null), sqft (number or null), capacity (number or null), licenseType ("47"|"48"|"unknown"), rentMonthly (number/mo or null), leaseYears (number or null), sde (number or null), revenue (number or null), sellerFinancing (true|false), conceptChange ("none"|"light"|"moderate"|"heavy"), beachProximity ("on"|"adjacent"|"inland"|"unknown"), kitchen (true|false|null), notes (key facts max 120 chars or null). Use null for any field not stated.`;

  try {
    // Step 1: web search — gather listing details as plain text
    const messages: unknown[] = [{ role: "user", content: searchPrompt }];
    let gatheredText = "";

    for (let turn = 0; turn < 8; turn++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "web-search-2025-03-05",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2000,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
          messages,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      messages.push({ role: "assistant", content: data.content });

      if (data.stop_reason === "end_turn") {
        gatheredText = (data.content as { type: string; text?: string }[])
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        break;
      }
      if (data.stop_reason === "tool_use") {
        const toolResults = (data.content as { type: string; id?: string }[])
          .filter((b) => b.type === "tool_use")
          .map((b) => ({ type: "tool_result", tool_use_id: b.id, content: "" }));
        messages.push({ role: "user", content: toolResults });
      } else {
        break;
      }
    }

    if (!gatheredText) throw new Error("No data found for this listing");

    // Step 2: single-turn extraction — convert gathered text to structured JSON
    const extractRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        messages: [{ role: "user", content: `${EXTRACT_PROMPT}\n\nLISTING DESCRIPTION:\n${gatheredText}` }],
      }),
    });

    const extractData = await extractRes.json();
    if (extractData.error) throw new Error(extractData.error.message);

    const txt = (extractData.content as { type: string; text?: string }[])
      .filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const clean = txt.replace(/```json\n?/g, "").replace(/```/g, "").trim();
    let result = null;
    try { result = JSON.parse(clean); } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Could not extract structured data from listing");
      result = JSON.parse(match[0]);
    }

    if (!result) throw new Error("No structured data extracted from listing");

    return new Response(JSON.stringify({ result }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
