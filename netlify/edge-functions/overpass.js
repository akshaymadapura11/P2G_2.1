// netlify/edge-functions/overpass.js — same-origin Overpass proxy (Edge Function).
//
// Runs on Deno at the edge and STREAMS the upstream Overpass response straight
// to the browser, so there is no ~6 MB response cap like regular Netlify
// Functions (the real per-province queries are 10-15 MB+). The browser calls
// this same-origin (/api/overpass), so no CORS is involved; the function fetches
// Overpass server-side with a proper User-Agent (mirrors 406 without one).
//
// Wired to /api/overpass via [[edge_functions]] in netlify.toml.

const MIRRORS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const UPSTREAM_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent": "P2GreeN/1.0 (agricultural nutrient map; +github.com/akshaymadapura11/P2G_2.1)",
  "Accept": "application/json",
};

export default async (request) => {
  let body = "";
  if (request.method === "POST") {
    body = await request.text(); // already "data=<encoded QL>"
  } else {
    const d = new URL(request.url).searchParams.get("data");
    if (d) body = "data=" + encodeURIComponent(d);
  }
  if (!body) {
    return new Response(JSON.stringify({ error: "missing query" }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }

  const tried = [];
  for (const url of MIRRORS) {
    const host = new URL(url).host;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 28000);
      const resp = await fetch(url, {
        method: "POST", headers: UPSTREAM_HEADERS, body, signal: ctrl.signal,
      });
      clearTimeout(timer);
      const ct = resp.headers.get("content-type") || "";
      if (!resp.ok || !ct.includes("json")) {
        tried.push(`${host}:${resp.status}${ct.includes("json") ? "" : "/non-json"}`);
        try { await resp.body?.cancel(); } catch { /* ignore */ }
        continue;
      }
      // Stream the upstream body straight through — no buffering, no size cap.
      return new Response(resp.body, {
        status: 200,
        headers: {
          "content-type": "application/json",
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
