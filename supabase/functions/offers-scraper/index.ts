import { DOMParser, Element as DomElement } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

console.log("Edge function starting… environment check");

type Variant = "us" | "us-florida" | "ca";
type Source = "us" | "ca";

type RawOffer = {
  title: string;
  text: string;
  link: string;
  category?: string;
};

type CanonicalOffer = {
  source: Source;
  variant: Variant;
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

type CookieJar = Map<string, string>;

const DISNEY_HEADERS = {
  "user-agent": USER_AGENT,
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  referer: "https://disneyworld.disney.go.com/",
  "upgrade-insecure-requests": "1",
};
const MAX_REDIRECTS = 10;

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

function encodeCookieJson(value: Record<string, unknown>): string {
  return encodeURIComponent(JSON.stringify(value));
}

const COOKIE_PRESETS: Record<Variant, Record<string, string>> = {
  us: {},
  "us-florida": {
    geolocation_aka_jar: encodeCookieJson({
      zipCode: "32830",
      region: "FL",
      country: "US",
      metro: "LAKE BUENA VISTA",
      metroCode: "534",
    }),
    GEOLOCATION_jar: encodeCookieJson({
      zipCode: "32830",
      region: "FL",
      country: "united states",
      metro: "lake buena vista",
      metroCode: "534",
      countryisocode: "us",
    }),
  },
  ca: {
    localeCookie_jar_aka: encodeCookieJson({
      contentLocale: "en_CA",
      version: "3",
      precedence: 0,
      akamai: "true",
    }),
    languageSelection_jar_aka: encodeCookieJson({
      preferredLanguage: "en_CA",
      version: "1",
      precedence: 0,
      language: "en_CA",
      akamai: "true",
    }),
    geolocation_aka_jar: encodeCookieJson({
      zipCode: "M5H 2N2",
      region: "ON",
      country: "CA",
      metro: "TORONTO",
      metroCode: "0",
    }),
    GEOLOCATION_jar: encodeCookieJson({
      zipCode: "M5H 2N2",
      region: "ON",
      country: "canada",
      metro: "toronto",
      metroCode: "0",
      countryisocode: "ca",
    }),
  },
};

type GeoPreset = {
  variant: Variant;
  source: Source;
  baseUrl: string;
  cookies: Record<string, string>;
};

type OfferCounts = {
  found: number;
  new: number;
  changed: number;
  same: number;
};

function resolveVariants(sourceParam: string | null): Variant[] {
  if (!sourceParam || sourceParam === "us") {
    return ["us", "us-florida", "ca"];
  }
  if (sourceParam === "us-only") {
    return ["us"];
  }
  if (sourceParam === "us-florida") {
    return ["us-florida"];
  }
  if (sourceParam === "ca") {
    return ["ca"];
  }
  if (sourceParam === "all") {
    return ["us", "us-florida", "ca"];
  }

  throw new Error(`Unsupported source parameter '${sourceParam}'`);
}

function variantToSource(variant: Variant): Source {
  return variant === "ca" ? "ca" : "us";
}

function buildPreset(
  variant: Variant,
  baseUrls: { us: string; ca: string }
): GeoPreset {
  const source = variantToSource(variant);
  const baseUrl = variant === "ca" ? baseUrls.ca : baseUrls.us;
  return {
    variant,
    source,
    baseUrl,
    cookies: COOKIE_PRESETS[variant] ?? {},
  };
}

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

function canonicalize(
  offer: RawOffer,
  source: Source,
  variant: Variant,
  baseUrl: string
): CanonicalOffer {
  return {
    source,
    variant,
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
  variant: Variant,
  baseUrl: string,
  rawOffers: RawOffer[]
): Promise<CanonicalOfferWithHash[]> {
  const seenKeys = new Set<string>();
  const canonicalOffers: CanonicalOfferWithHash[] = [];

  for (const raw of rawOffers) {
    if (!raw.link) {
      continue;
    }

    const canonical = canonicalize(raw, source, variant, baseUrl);

    const dedupeKey = `${variant}:${canonical.link}`;
    if (seenKeys.has(dedupeKey)) {
      continue;
    }

    const payload = {
      source: canonical.source,
      variant: canonical.variant,
      title: canonical.title,
      text: canonical.text,
      link: canonical.link,
      category: canonical.category,
    };

    const hash = await sha256Hex(JSON.stringify(payload));

    seenKeys.add(dedupeKey);
    canonicalOffers.push({ ...canonical, hash });
  }

  return canonicalOffers;
}

async function fetchText(url: string, initialCookies: Record<string, string> = {}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let currentUrl = url;
    const visited = new Set<string>();
    const cookieEntries: [string, string][] = [["gp", "1"]];
    for (const [name, value] of Object.entries(initialCookies)) {
      cookieEntries.push([name, value]);
    }
    const cookieJar: CookieJar = new Map(cookieEntries);

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const cookieState = Array.from(cookieJar.entries())
        .sort(([aName], [bName]) => aName.localeCompare(bName))
        .map(([name, value]) => `${name}=${value}`)
        .join(";");
      const visitKey = `${currentUrl}|${cookieState}`;
      if (visited.has(visitKey)) {
        throw new Error(`Redirect loop detected for ${currentUrl}`);
      }
      visited.add(visitKey);

      const headers = new Headers(DISNEY_HEADERS);
      if (cookieJar.size > 0) {
        headers.set(
          "cookie",
          Array.from(cookieJar.entries())
            .map(([name, value]) => `${name}=${value}`)
            .join("; ")
        );
      }

      const response = await fetch(currentUrl, {
        signal: controller.signal,
        headers,
        redirect: "manual",
      });

      const setCookie = response.headers.getSetCookie
        ? response.headers.getSetCookie()
        : (response.headers.get("set-cookie") ?? "").split(/,(?=[^;]+?=)/);
      for (const cookie of setCookie) {
        if (!cookie) {
          continue;
        }
        const [pair] = cookie.split(";", 1);
        if (!pair) {
          continue;
        }
        const [name, ...rest] = pair.split("=");
        if (!name || rest.length === 0) {
          continue;
        }
        cookieJar.set(name.trim(), rest.join("=").trim());
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Redirect ${response.status} missing Location header`);
        }
        const nextUrl = new URL(location, currentUrl).toString();
        if (nextUrl.includes("disneyinternational.com")) {
          throw new Error("Redirected to international site — possible locale loop");
        }
        currentUrl = nextUrl;
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    }

    throw new Error(`Exceeded ${MAX_REDIRECTS} redirects without landing page`);
  } finally {
    clearTimeout(timeout);
  }
}

async function scrapeOffers(
  source: Source,
  baseUrl: string,
  initialCookies: Record<string, string> = {}
): Promise<RawOffer[]> {
  const html = await fetchText(baseUrl, initialCookies);
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
    ".searchResult",
    "article.searchResult",
  ];

  const nodes = new Set<DomElement>();

  for (const selector of selectors) {
    for (const node of doc.querySelectorAll(selector)) {
      if (node instanceof DomElement) {
        nodes.add(node as DomElement);
      }
    }
  }

  const offers: RawOffer[] = [];

  for (const node of nodes) {
    const linkEl = node.querySelector("a[href]");
    const titleEl =
      node.querySelector("[data-automation-id='offerTitle']") ??
      node.querySelector(".offer-card__title") ??
      node.querySelector(".offerTitle") ??
      node.querySelector("h3") ??
      node.querySelector("h2");
    const textEl =
      node.querySelector("[data-automation-id='offerDescription']") ??
      node.querySelector(".offer-card__content") ??
      node.querySelector(".cell.details ul") ??
      node.querySelector(".cell.details") ??
      node.querySelector("p");
    const categoryEl =
      node.querySelector("[data-automation-id='offerCategory']") ??
      node.querySelector(".offer-card__category") ??
      node.querySelector(".detailsOfferTypes");

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
      .eq("scrape_variant", offer.variant)
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
        scrape_variant: offer.variant,
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
        source,
        scrape_variant: offer.variant,
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
        source,
        scrape_variant: offer.variant,
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
        source,
        scrape_variant: offer.variant,
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

    const usUrl =
      Deno.env.get("DISNEY_BASE_URL") ??
      "https://disneyworld.disney.go.com/special-offers/";
    const caUrl =
      Deno.env.get("DISNEY_CA_URL") ??
      "https://disneyworld.disney.go.com/en_CA/special-offers/";

    const baseUrls = { us: usUrl, ca: caUrl };
    const variantsToRun = resolveVariants(sourceParam);
    const presets = variantsToRun.map((variant) => buildPreset(variant, baseUrls));

    const dryRun = Deno.env.get("SCRAPER_DRY_RUN") === "1";

    const totals: OfferCounts = { found: 0, new: 0, changed: 0, same: 0 };
    const perVariant: Partial<Record<Variant, OfferCounts>> = {};

    for (const preset of presets) {
      const rawOffers = await scrapeOffers(
        preset.source,
        preset.baseUrl,
        preset.cookies
      );
      const canonicalOffers = await canonicalizeOffers(
        preset.source,
        preset.variant,
        preset.baseUrl,
        rawOffers
      );

      const counts: OfferCounts = {
        found: canonicalOffers.length,
        new: 0,
        changed: 0,
        same: 0,
      };

      if (canonicalOffers.length > 0) {
        const result = await upsertOffers(preset.source, canonicalOffers, dryRun);
        counts.new = result.new;
        counts.changed = result.changed;
        counts.same = result.same;
      }

      totals.found += counts.found;
      totals.new += counts.new;
      totals.changed += counts.changed;
      totals.same += counts.same;
      perVariant[preset.variant] = counts;

      if (!dryRun) {
        const now = new Date().toISOString();
        const { error: logError } = await supabase.from("scrape_log").insert({
          run_time: now,
          source: preset.variant,
          offers_found: counts.found,
          offers_new: counts.new,
          offers_changed: counts.changed,
        });

        if (logError) {
          console.error("scrape_log insert error:", logError.message ?? logError);
        }
      }
    }

    const responseBody = {
      ok: true,
      counts: totals,
      requested: sourceParam ?? "us",
      variants: perVariant,
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
