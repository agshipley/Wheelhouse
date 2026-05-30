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

  const prompt = `Find and extract all available data for this specific business-for-sale listing.

URL: ${sourceUrl}${name ? `\nBusiness name: ${name}` : ""}

If the URL is a direct listing page, read it. If it is a search or category page, search for "${name}" on BizBuySell, BizQuest, or BizBen to find the specific individual listing page, then read that page.

Return ONLY valid JSON (no markdown, no prose) with these exact keys:
name (string), city (string), asking (number USD or null), sqft (number or null), capacity (number or null),
licenseType ("47"|"48"|"unknown"), rentMonthly (number per month or null), leaseYears (number remaining or null),
sde (number annual or null), revenue (number annual or null), sellerFinancing (true or false),
conceptChange ("none"|"light"|"moderate"|"heavy"), beachProximity ("on"|"adjacent"|"inland"|"unknown"),
kitchen (true or false or null), notes (key facts max 120 chars or null).

Use null for any field not explicitly stated in the listing.`;

  try {
    const messages: unknown[] = [{ role: "user", content: prompt }];
    let result = null;

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
        const txt = (data.content as { type: string; text?: string }[])
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        const clean = txt.replace(/```json\n?/g, "").replace(/```/g, "").trim();
        result = JSON.parse(clean);
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
