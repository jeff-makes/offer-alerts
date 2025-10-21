import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const url = Deno.env.get("URL")!;
  const key = Deno.env.get("SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, key);

  await supabase.from("scrape_log").insert({
    offers_found: 0,
    offers_new: 0,
    offers_changed: 0,
  });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
});
