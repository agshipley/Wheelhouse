const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const { blurb } = await req.json();
  if (!blurb?.trim()) {
    return new Response(JSON.stringify({ error: "No blurb provided" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY secret not set" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

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
      messages: [{
        role: "user",
        content: `Extract structured data from this business-for-sale listing. Return ONLY valid JSON, no markdown, no prose. Keys: name (string), city (string), asking (number USD or null), sqft (number or null), capacity (number or null), licenseType ("47"|"48"|"unknown"), rentMonthly (number/mo or null), leaseYears (number or null), sde (number or null), revenue (number or null), sellerFinancing (true|false), conceptChange ("none"|"light"|"moderate"|"heavy"), beachProximity ("on"|"adjacent"|"inland"|"unknown"), kitchen (true|false), notes (short string).\n\nLISTING:\n${blurb}`,
      }],
    }),
  });

  const data = await res.json();
  if (data.error) {
    return new Response(JSON.stringify({ error: data.error.message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const txt = (data.content || [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n");
  const clean = txt.replace(/```json/g, "").replace(/```/g, "").trim();

  try {
    const result = JSON.parse(clean);
    return new Response(JSON.stringify({ result }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Failed to parse AI response" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
