const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXTRACT_PROMPT = `Extract structured data from this business-for-sale listing. Return ONLY valid JSON, no markdown, no prose. Keys: name (string), city (string), asking (number USD or null), sqft (number or null), capacity (number or null), licenseType ("47"|"48"|"unknown"), rentMonthly (number/mo or null), leaseYears (number or null), sde (number or null), revenue (number or null), sellerFinancing (true|false), conceptChange ("none"|"light"|"moderate"|"heavy"), beachProximity ("on"|"adjacent"|"inland"|"unknown"), kitchen (true|false), notes (short string, key facts only).`;

function extractJson(content: { type: string; text?: string }[]): unknown {
  const txt = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const clean = txt.replace(/```json\n?/g, "").replace(/```/g, "").trim();
  return JSON.parse(clean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const { blurb, url } = await req.json();
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY secret not set" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    let result: unknown;

    if (url?.trim()) {
      // URL mode: use web search to fetch and read the listing page
      const messages: unknown[] = [{
        role: "user",
        content: `${EXTRACT_PROMPT}\n\nFetch and read this listing page: ${url.trim()}`,
      }];

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
            max_tokens: 1500,
            tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
            messages,
          }),
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        messages.push({ role: "assistant", content: data.content });

        if (data.stop_reason === "end_turn") {
          result = extractJson(data.content);
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
    } else if (blurb?.trim()) {
      // Text mode: single-turn extraction from pasted text
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1000,
          messages: [{ role: "user", content: `${EXTRACT_PROMPT}\n\nLISTING:\n${blurb.trim()}` }],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      result = extractJson(data.content);
    } else {
      return new Response(JSON.stringify({ error: "Provide a listing URL or paste listing text" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ result }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
