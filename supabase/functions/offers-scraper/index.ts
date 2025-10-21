import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

console.log("Edge function starting… environment check");

type Source = "us" | "ca";

type RawOffer = {
  title: string;
  text: string;
  link: string;
  category?: string;
};

type CanonicalOffer = {
  source: Source;
  title: string;
  text: string;
  link: string;
  category: string | null;
};

type CanonicalOfferWithHash = CanonicalOffer & { hash: string };

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 10_000;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase configuration");
}

const supabase = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});

const TRACKING_QUERY_PREFIXES = ["utm_"];
const TRACKING_QUERY_KEYS = new Set([
  "cmp",
  "mcid",
  "icid",
  "cid",
  "clk",
  "mkwid",
  "ef_id",
  "affid",
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function canonicalizeLink(rawLink: string, baseUrl: string): string {
  const url = new URL(rawLink, baseUrl);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  const params = Array.from(url.searchParams.entries())
    .filter(([key]) => {
      const lowerKey = key.toLowerCase();
      if (TRACKING_QUERY_KEYS.has(lowerKey)) {
        return false;
      }
      return !TRACKING_QUERY_PREFIXES.some((prefix) => lowerKey.startsWith(prefix));
    })
    .sort(([aKey], [bKey]) => aKey.localeCompare(bKey));

  url.search = "";
  for (const [key, value] of params) {
    url.searchParams.append(key, value);
  }

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

function canonicalize(offer: RawOffer, source: Source, baseUrl: string): CanonicalOffer {
  return {
    source,
    title: normalizeWhitespace(offer.title),
    text: normalizeWhitespace(offer.text),
    link: canonicalizeLink(offer.link, baseUrl),
    category: offer.category ? normalizeWhitespace(offer.category) : null,
  };
}

async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function canonicalizeOffers(
  source: Source,
  baseUrl: string,
  rawOffers: RawOffer[]
): Promise<CanonicalOfferWithHash[]> {
  const seenLinks = new Set<string>();
  const canonicalOffers: CanonicalOfferWithHash[] = [];

  for (const raw of rawOffers) {
    if (!raw.link) {
      continue;
    }

    const canonical = canonicalize(raw, source, baseUrl);

    if (seenLinks.has(canonical.link)) {
      continue;
    }

    const payload = {
      title: canonical.title,
      text: canonical.text,
      link: canonical.link,
      category: canonical.category,
    };

    const hash = await sha256Hex(JSON.stringify(payload));

    seenLinks.add(canonical.link);
    canonicalOffers.push({ ...canonical, hash });
  }

  return canonicalOffers;
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Added redirect handling to prevent infinite loops on Disney site
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
      },
      redirect: "follow",
    });
    if (response.url !== url && response.url.includes("disneyinternational.com")) {
      throw new Error("Redirected to international site — possible locale loop");
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function buildDebugOffers(
  baseUrl: string,
  variantToggle: boolean
): RawOffer[] {
  const stableLink = new URL("/special-offers/spring-savings", baseUrl).toString();
  const variantLink = new URL("/special-offers/resort-discount", baseUrl).toString();
  const bonusLink = new URL("/special-offers/dining-plan", baseUrl).toString();

  const offers: RawOffer[] = [
    {
      title: "Save Up to 25% on Select Rooms",
      text: "Book early and enjoy magical savings at select Disney Resort hotels.",
      link: stableLink,
      category: "Resort Offer",
    },
    {
      title: "Florida Residents Special",
      text: variantToggle
        ? "Residents can save even more on late summer stays."
        : "Residents can save on late summer stays.",
      link: variantLink,
      category: "Florida Residents",
    },
  ];

  if (variantToggle) {
    offers.push({
      title: "Disney Dining Plan Returns",
      text: "Bundle a dining plan with your vacation for extra value.",
      link: bonusLink,
      category: "Dining",
    });
  }

  return offers;
}

async function scrapeOffers(
  source: Source,
  baseUrl: string,
  debugSeed: boolean,
  variantToggle: boolean
): Promise<RawOffer[]> {
  if (debugSeed) {
    return buildDebugOffers(baseUrl, variantToggle);
  }

  const html = await fetchText(baseUrl);
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  if (!doc) {
    return [];
  }

  const selectors = [
    "[data-automation-id^='offer']",
    ".offer-card",
    "article.offer-card",
    "li.offer-card",
  ];

  const nodes = new Set<Element>();

  for (const selector of selectors) {
    for (const node of doc.querySelectorAll(selector)) {
      nodes.add(node as Element);
    }
  }

  const offers: RawOffer[] = [];

  for (const node of nodes) {
    const linkEl = node.querySelector("a[href]");
    const titleEl =
      node.querySelector("[data-automation-id='offerTitle']") ??
      node.querySelector(".offer-card__title") ??
      node.querySelector("h3") ??
      node.querySelector("h2");
    const textEl =
      node.querySelector("[data-automation-id='offerDescription']") ??
      node.querySelector(".offer-card__content") ??
      node.querySelector("p");
    const categoryEl =
      node.querySelector("[data-automation-id='offerCategory']") ??
      node.querySelector(".offer-card__category");

    if (!linkEl || !titleEl || !textEl) {
      continue;
    }

    const href = linkEl.getAttribute("href");
    if (!href) {
      continue;
    }

    offers.push({
      title: titleEl.textContent ?? "",
      text: textEl.textContent ?? "",
      link: new URL(href, baseUrl).toString(),
      category: categoryEl?.textContent ?? undefined,
    });
  }

  return offers;
}

async function upsertOffers(
  source: Source,
  offers: CanonicalOfferWithHash[],
  dryRun: boolean
): Promise<{ new: number; changed: number; same: number }> {
  let offersNew = 0;
  let offersChanged = 0;
  let offersSame = 0;

  const now = new Date().toISOString();

  for (const offer of offers) {
    const { data: existing, error: existingError } = await supabase
      .from("offers")
      .select("id, hash")
      .eq("source", source)
      .eq("link", offer.link)
      .maybeSingle();

    if (existingError) {
      throw new Error(`offers select failed: ${existingError.message}`);
    }

    if (!existing) {
      offersNew += 1;
      if (dryRun) {
        continue;
      }

      const insertPayload = {
        source,
        title: offer.title,
        text: offer.text,
        link: offer.link,
        category: offer.category,
        hash: offer.hash,
        first_seen: now,
        last_seen: now,
        last_changed: now,
      };

      const { data: inserted, error: insertError } = await supabase
        .from("offers")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insertError || !inserted) {
        throw new Error(`offers insert failed: ${insertError?.message ?? "unknown"}`);
      }

      const versionPayload = {
        offer_id: inserted.id,
        hash: offer.hash,
        captured_at: now,
        title: offer.title,
        text: offer.text,
        link: offer.link,
        category: offer.category,
      };

      const { error: versionError } = await supabase
        .from("offer_versions")
        .insert(versionPayload);

      if (versionError) {
        throw new Error(`offer_versions insert failed: ${versionError.message}`);
      }

      continue;
    }

    if (existing.hash !== offer.hash) {
      offersChanged += 1;
      if (dryRun) {
        continue;
      }

      const updatePayload = {
        title: offer.title,
        text: offer.text,
        link: offer.link,
        category: offer.category,
        hash: offer.hash,
        last_seen: now,
        last_changed: now,
      };

      const { error: updateError } = await supabase
        .from("offers")
        .update(updatePayload)
        .eq("id", existing.id);

      if (updateError) {
        throw new Error(`offers update failed: ${updateError.message}`);
      }

      const versionPayload = {
        offer_id: existing.id,
        hash: offer.hash,
        captured_at: now,
        title: offer.title,
        text: offer.text,
        link: offer.link,
        category: offer.category,
      };

      const { error: versionError } = await supabase
        .from("offer_versions")
        .insert(versionPayload);

      if (versionError) {
        throw new Error(`offer_versions insert failed: ${versionError.message}`);
      }

      continue;
    }

    offersSame += 1;
    if (dryRun) {
      continue;
    }

    const { error: touchError } = await supabase
      .from("offers")
      .update({ last_seen: now })
      .eq("id", existing.id);

    if (touchError) {
      throw new Error(`offers last_seen update failed: ${touchError.message}`);
    }
  }

  return { new: offersNew, changed: offersChanged, same: offersSame };
}

Deno.serve(async (req) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing required Supabase configuration");
    }

    const requestUrl = new URL(req.url);
    const sourceParam = requestUrl.searchParams.get("source");
    const source: Source = sourceParam === "ca" ? "ca" : "us";

    const usUrl =
      Deno.env.get("DISNEY_BASE_URL") ??
      "https://disneyworld.disney.go.com/special-offers/";
    const caUrl =
      Deno.env.get("DISNEY_CA_URL") ??
      "https://disneyworld.disney.go.com/en_CA/special-offers/";

    const baseUrl = source === "ca" ? caUrl : usUrl;

    const dryRun = Deno.env.get("SCRAPER_DRY_RUN") === "1";
    console.log("SCRAPER_DEBUG_SEED:", Deno.env.get("SCRAPER_DEBUG_SEED"));
    const debugSeed = Deno.env.get("SCRAPER_DEBUG_SEED") === "1";
    const variantToggle =
      requestUrl.searchParams.get("_variant") === "1" ||
      (Math.floor(Date.now() / (1000 * 60 * 60)) % 2 === 1);

    const rawOffers = await scrapeOffers(source, baseUrl, debugSeed, variantToggle);
    const canonicalOffers = await canonicalizeOffers(source, baseUrl, rawOffers);

    const counts = {
      found: canonicalOffers.length,
      new: 0,
      changed: 0,
      same: 0,
    };

    if (canonicalOffers.length > 0) {
      const result = await upsertOffers(source, canonicalOffers, dryRun);
      counts.new = result.new;
      counts.changed = result.changed;
      counts.same = result.same;
    }

    if (!dryRun) {
      const now = new Date().toISOString();
      const { error: logError } = await supabase.from("scrape_log").insert({
        run_time: now,
        source,
        offers_found: counts.found,
        offers_new: counts.new,
        offers_changed: counts.changed,
      });

      if (logError) {
        console.error("scrape_log insert error:", logError.message ?? logError);
      }
    }

    const responseBody = {
      ok: true,
      counts,
      source,
    };

    return new Response(JSON.stringify(responseBody), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    console.error("offers-scraper error:", error);
    const message = error instanceof Error ? error.message : "unknown error";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      headers: { "content-type": "application/json" },
      status: 500,
    });
  }
});
