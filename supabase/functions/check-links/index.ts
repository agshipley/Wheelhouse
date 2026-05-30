const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { links } = await req.json() as { links: { id: string; url: string }[] };
  if (!Array.isArray(links) || !links.length) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results = await Promise.all(
    links.map(async ({ id, url }) => {
      try {
        const res = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(8000),
          headers: {
            // Mimic a real browser to avoid bot-detection false positives
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });
        return { id, ok: res.ok, status: res.status };
      } catch (e) {
        const msg = (e as Error).message;
        // Timeout is a soft failure — we don't know the link is dead
        const timedOut = msg.includes("timed out") || msg.includes("TimeoutError");
        return { id, ok: timedOut ? null : false, status: null, error: msg };
      }
    })
  );

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
