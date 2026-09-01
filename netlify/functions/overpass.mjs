// netlify/functions/overpass.mjs — server-side Overpass proxy (Netlify Function v2).
//
// The browser calls this SAME-ORIGIN (via /api/overpass), so there is no CORS in
// play at all. This function fetches Overpass server-side — where browser CORS,
// per-user rate-limits, and network-path quirks don't apply — and returns the
// JSON. It fixes the "No Access-Control-Allow-Origin" / ERR_FAILED failures the
// browser hit talking to public Overpass mirrors directly.
//
// Exposed at /api/overpass via the redirect in netlify.toml.

// Tried in order, server-side (CORS irrelevant here, so no-CORS mirrors are fine).
const MIRRORS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export default async (req) => {
  // Query comes as a POST body "data=<encoded QL>" (preferred) or ?data=<QL>.
  let body = "";
  if (req.method === "POST") {
    body = await req.text();
  } else {
    const d = new URL(req.url).searchParams.get("data");
    if (d) body = "data=" + encodeURIComponent(d);
  }
  if (!body) return new Response(JSON.stringify({ error: "missing query" }), {
    status: 400, headers: { "content-type": "application/json" },
  });

  // A descriptive User-Agent is required by some Overpass instances (they 429 or
  // block default/library agents). Short per-mirror timeouts so several fit in
  // Netlify's ~10s function budget.
  const HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "P2GreeN/1.0 (agricultural nutrient map; +github.com/akshaymadapura11/P2G_2.1)",
    "Accept": "application/json",
  };
  const tried = [];
  for (const url of MIRRORS) {
    const host = new URL(url).host;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4500);
      const resp = await fetch(url, { method: "POST", headers: HEADERS, body, signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) { tried.push(`${host}:${resp.status}`); continue; }
      const text = await resp.text();
      if (!text.trimStart().startsWith("{")) { tried.push(`${host}:non-json`); continue; }
      return new Response(text, {
        status: 200,
        headers: {
          "content-type": "application/json",
          // farmland near fixed supply points changes slowly; let the CDN cache it
          "cache-control": "public, max-age=86400",
        },
      });
    } catch (e) {
      tried.push(`${host}:${e.name === "AbortError" ? "timeout" : "err"}`);
    }
  }
  return new Response(JSON.stringify({ error: "overpass unavailable", tried }), {
    status: 502, headers: { "content-type": "application/json" },
  });
};
