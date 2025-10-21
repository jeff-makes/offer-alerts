import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 10_000;

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function countOffers(html: string): number {
  const patterns: RegExp[] = [
    /offer-card/gi,
    /data-automation-id=["']offer/gi,
    /special-offers\/[a-z0-9-]+/gi,
  ];

  const seen = new Set<string>();
  let total = 0;

  for (const pattern of patterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      const key =
        pattern.source === "special-offers\\/[a-z0-9-]+"
          ? match[0]
          : `${pattern.source}:${match.index}`;
      if (!seen.has(key)) {
        seen.add(key);
        total += 1;
      }
    }
  }

  return total;
}

Deno.serve(async () => {
  const url = Deno.env.get("URL");
  const key = Deno.env.get("SERVICE_ROLE_KEY");
  const usUrl =
    Deno.env.get("DISNEY_BASE_URL") ??
    "https://disneyworld.disney.go.com/special-offers/";
  const caUrl =
    Deno.env.get("DISNEY_CA_URL") ??
    "https://disneyworld.disney.go.com/en_CA/special-offers/";

  if (!url || !key) {
    const error = new Error("Missing required environment variables");
    console.error(error.message);
    return new Response(
      JSON.stringify({ ok: false, error: error?.message ?? "unknown" }),
      {
        headers: { "content-type": "application/json" },
        status: 500,
      }
    );
  }

  const supabase = createClient(url, key);

  let usCount = 0;
  let caCount = 0;

  try {
    usCount = countOffers(await fetchText(usUrl));
  } catch (error) {
    console.error("US fetch failed:", error);
  }

  try {
    caCount = countOffers(await fetchText(caUrl));
  } catch (error) {
    console.error("CA fetch failed:", error);
  }

  const total = usCount + caCount;

  const { error } = await supabase.from("scrape_log").insert({
    offers_found: total,
    offers_new: 0,
    offers_changed: 0,
  });

  if (error) {
    console.error("scrape_log insert error:", error.message ?? error);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      counts: { us: usCount, ca: caCount },
      total,
    }),
    {
      headers: { "content-type": "application/json" },
    }
  );
});
