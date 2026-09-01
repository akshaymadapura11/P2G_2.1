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

  let lastStatus = 502;
  for (const url of MIRRORS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000); // stay under Netlify's ~10s
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) { lastStatus = resp.status; continue; }
      const text = await resp.text();
      if (!text.trimStart().startsWith("{")) continue; // HTML error page — next mirror
      return new Response(text, {
        status: 200,
        headers: {
          "content-type": "application/json",
          // farmland near fixed supply points changes slowly; let the CDN cache it
          "cache-control": "public, max-age=86400",
        },
      });
    } catch {
      // timeout / network error — try the next mirror
    }
  }
  return new Response(JSON.stringify({ error: "overpass unavailable", lastStatus }), {
    status: 502, headers: { "content-type": "application/json" },
  });
};
