// Offline generator: pre-fetch farmland / green polygons per province from
// Overpass and write them as static GeoJSON under public/data/landuse/, so the
// app never depends on a live Overpass mirror at runtime.
//
// Usage:  node scripts/genLanduse.mjs [--force] [--pad=20]
// Resumable: skips provinces whose file already exists (unless --force).
//
// Uses curl for the Overpass request (multi-mirror failover + retries; curl
// ignores CORS so we can also use no-CORS mirrors like kumi), then the same
// osmtogeojson + turf the app uses so geometry handling is identical.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import Papa from "papaparse";
import osmtogeojson from "osmtogeojson";
import * as turf from "@turf/turf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "public", "data");
const OUT = path.join(DATA, "landuse");

const FORCE = process.argv.includes("--force");
// Cache farmland within PAD_KM of supply points. The app shows farmland within
// the radius control (default 2 km) of those points, so a small pad keeps files
// tiny while covering normal use; larger radii clip to what's cached.
const PAD_KM = Number((process.argv.find((a) => a.startsWith("--pad=")) || "").split("=")[1]) || 3;

// Mirrors tried in order, per attempt. curl bypasses CORS, so no-CORS mirrors
// (kumi) are usable here even though the browser cannot use them.
const MIRRORS = [
  // openstreetmap.fr (full planet instance) is reachable from this network and
  // has global data while overpass-api.de is unreachable and the rest 502 — so
  // it leads. The others stay as fallbacks in case it rate-limits.
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const LANDUSE_TAGS = ["farmland", "plantation", "orchard", "vineyard", "greenhouse_horticulture"];
const GREEN_LEISURE = ["park", "garden", "nature_reserve", "recreation_ground"];

const SUPPLY_FILES = [
  "wtp_all.csv",
  "Airports_NUTS2_supply.csv",
  "Prisons_NUTS2_supply.csv",
  "Stadiums_NUTS2_supply.csv",
  "Universities_NUTS2_supply.csv",
  "CheffExpress_NUTS2_supply.csv",
  "TrainStations_NUTS2_supply.csv",
  "Festivals_NUTS2_supply.csv",
  "ConstructionSites_NUTS2_supply.csv",
];

/* ---- app-identical normalization (copied from src/hooks/useLocationsData.js) ---- */
const ALLOWED_COUNTRIES = new Set(["France", "Italy", "Hungary", "Greece"]);
const COUNTRY_MAP = { FR: "France", IT: "Italy", HU: "Hungary", EL: "Greece", GR: "Greece", Greece: "Greece", France: "France", Italy: "Italy", Hungary: "Hungary" };
function normalizeCountry(v) {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s) return "";
  return COUNTRY_MAP[s.toUpperCase()] || COUNTRY_MAP[s] || s;
}
const PROV_MAP = {
  "αττικη": "Attica", "ανατολικη μακεδονια θρακη": "Eastern Macedonia and Thrace",
  "ανατολικη μακεδονια και θρακη": "Eastern Macedonia and Thrace", "κεντρικη μακεδονια": "Central Macedonia",
  "δυτικη μακεδονια": "Western Macedonia", "θεσσαλια": "Thessaly", "ηπειρος": "Epirus",
  "ιονια νησια": "Ionian Islands", "δυτικη ελλαδα": "Western Greece", "στερεα ελλαδα": "Central Greece",
  "πελοποννησος": "Peloponnese", "βορειο αιγαιο": "North Aegean", "νοτιο αιγαιο": "South Aegean", "κρητη": "Crete",
};
function normalizeProvinceName(p) {
  if (p == null) return "";
  let s = String(p).trim();
  if (!s) return "";
  const dashIdx = s.indexOf(" - ");
  if (dashIdx !== -1) s = s.slice(dashIdx + 3).trim();
  s = s.replace(/^A(?=[Ͱ-Ͽ])/u, "Α");
  const key = String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[,_-]/g, " ").replace(/\s+/g, " ").trim();
  return PROV_MAP[key] || s;
}
function toNum(x) {
  if (x == null) return null;
  if (typeof x === "string") { const t = x.trim(); if (t === "") return null; x = t.replace(",", "."); }
  const n = Number(x); return Number.isFinite(n) ? n : null;
}
function pick(row, keys) { for (const k of keys) if (row?.[k] != null && String(row[k]).trim() !== "") return row[k]; return null; }
function parseLatLon(row) {
  let lat = toNum(pick(row, ["lat", "latitude", "Latitude", "__lat"]));
  let lon = toNum(pick(row, ["lon", "lng", "longitude", "Longitude", "__lon"]));
  if ((lat == null || lon == null) && row?.location != null) {
    const parts = String(row.location).split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const a = toNum(parts[0]), b = toNum(parts[1]);
      if (a != null && b != null) {
        if (Math.abs(a) <= 90 && Math.abs(b) <= 180) { lat = a; lon = b; }
        else if (Math.abs(b) <= 90 && Math.abs(a) <= 180) { lat = b; lon = a; }
      }
    }
  }
  if (lat == null || lon == null) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}
// MUST match landuseSlug() in src/utils/data.js
function landuseSlug(country, province) {
  return `${country}__${province}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/* ---- gather supply points grouped by province ---- */
function readCsv(file) {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) return [];
  return Papa.parse(fs.readFileSync(p, "utf8"), { header: true, skipEmptyLines: true }).data;
}
const groups = new Map(); // slug -> { country, province, pts: [[lat,lon]] }
for (const file of SUPPLY_FILES) {
  for (const row of readCsv(file)) {
    const country = normalizeCountry(row.country ?? row.country_code ?? row.Country ?? "");
    if (!ALLOWED_COUNTRIES.has(country)) continue;
    const province = normalizeProvinceName(row.province ?? row.Province ?? row.nuts2 ?? row.NUTS2 ?? "");
    if (!province) continue;
    const ll = parseLatLon(row);
    if (!ll) continue;
    const slug = landuseSlug(country, province);
    if (!groups.has(slug)) groups.set(slug, { country, province, pts: [] });
    groups.get(slug).pts.push([ll.lat, ll.lon]);
  }
}
console.log(`Provinces with supply points: ${groups.size}  (pad ${PAD_KM} km)`);

/* ---- Overpass fetch via curl, with mirror failover ---- */
function curlOverpass(url, query, timeoutS) {
  try {
    // -k: skip TLS verification. Safe here — this is a one-time local fetch of
    // PUBLIC OSM data (validated as JSON below), and several mirrors fail only
    // on Windows/schannel cert checks (expired/untrusted root) while serving
    // fine. This runs offline in the generator, never in the shipped app.
    const body = execFileSync("curl", ["-sS", "-k", "-m", String(timeoutS),
      "-H", "User-Agent: P2GreeN-landuse-cache-generator/1.0",
      "--data-urlencode", "data=" + query, url], { maxBuffer: 1 << 30, encoding: "utf8" });
    if (body && body.trimStart().startsWith("{")) {
      const j = JSON.parse(body);
      if (Array.isArray(j.elements)) return j;
    }
  } catch { /* dead mirror */ }
  return null;
}
// Is any mirror reachable right now? Cheap probe so a full run bails fast when
// the whole fleet is down (the outer retry loop tries again later).
function anyMirrorUp() {
  for (const url of MIRRORS) if (curlOverpass(url, "[out:json][timeout:8];out count;", 12)) return url;
  return null;
}
function overpass(query) {
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of MIRRORS) {
      const j = curlOverpass(url, query, 300); // big rural regions can be 100+ MB
      if (j) return j;
    }
  }
  return null;
}

// Synchronous sleep (the loop below is synchronous via execFileSync).
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const round5 = (n) => Math.round(n * 1e5) / 1e5;
function roundCoords(g) {
  if (g.type === "Polygon") g.coordinates = g.coordinates.map((r) => r.map(([x, y]) => [round5(x), round5(y)]));
  else if (g.type === "MultiPolygon") g.coordinates = g.coordinates.map((p) => p.map((r) => r.map(([x, y]) => [round5(x), round5(y)])));
  return g;
}

fs.mkdirSync(OUT, { recursive: true });

// Bail fast (exit 2) if no mirror is reachable, so the outer retry loop can
// wait and try again instead of grinding through 70 dead-mirror timeouts.
const up = anyMirrorUp();
if (!up) { console.log("No Overpass mirror reachable right now — exiting for retry."); process.exit(2); }
console.log(`Mirror reachable: ${up}`);

let slugs = [...groups.keys()].sort();
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];
if (only) slugs = slugs.filter((s) => s.includes(only));
const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 0;
if (limit > 0) slugs = slugs.slice(0, limit);
let done = 0, skipped = 0, failed = 0;

const latPadDeg = PAD_KM / 111;
const q = (bb) => `[out:json][timeout:280];\n(\n` +
  `way["landuse"~"${LANDUSE_TAGS.join("|")}"]${bb};\nrelation["landuse"~"${LANDUSE_TAGS.join("|")}"]${bb};\n` +
  `way["leisure"~"${GREEN_LEISURE.join("|")}"]${bb};\nrelation["leisure"~"${GREEN_LEISURE.join("|")}"]${bb};\n` +
  `);\nout geom;`;

for (const slug of slugs) {
  const { country, province, pts } = groups.get(slug);
  const outFile = path.join(OUT, `${slug}.geojson`);
  if (!FORCE && fs.existsSync(outFile)) { skipped++; continue; }

  // One bbox query for the whole province. Simplest and lowest total download
  // (no overlap); for spread-out farming regions this can be large, so the
  // curl timeout is generous. We keep only polygons within PAD_KM of a point.
  const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lonPad = PAD_KM / (111 * Math.cos((lat0 * Math.PI) / 180));
  const S = Math.min(...pts.map((p) => p[0])) - latPadDeg, N = Math.max(...pts.map((p) => p[0])) + latPadDeg;
  const W = Math.min(...pts.map((p) => p[1])) - lonPad, E = Math.max(...pts.map((p) => p[1])) + lonPad;

  process.stdout.write(`[${done + skipped + failed + 1}/${slugs.length}] ${slug} (${pts.length} pts) ... `);
  const json = overpass(q(`(${S},${W},${N},${E})`));
  if (!json) { console.log("FAILED (all mirrors)"); failed++; continue; }

  const kept = [];
  for (const f of osmtogeojson(json).features || []) {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    const props = f.properties || {};
    let lu = props.landuse ?? props.tags?.landuse;
    if (!lu) {
      const leisure = props.leisure ?? props.tags?.leisure;
      if (GREEN_LEISURE.includes(leisure)) lu = "green_public_spaces";
    }
    if (!lu || (!LANDUSE_TAGS.includes(lu) && lu !== "green_public_spaces")) continue;

    // Keep only polygons whose centroid is within PAD_KM of a supply point
    // (cell bboxes are looser than that), then drop tiny slivers and simplify.
    let cx, cy;
    try { [cx, cy] = turf.centroid(f).geometry.coordinates; } catch { continue; }
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    let near = false;
    for (const [pa, pb] of pts) {
      if (turf.distance([cx, cy], [pb, pa], { units: "kilometers" }) <= PAD_KM) { near = true; break; }
    }
    if (!near) continue;
    if (!(turf.area(f) > 200)) continue;
    let simp = f;
    try { simp = turf.simplify(f, { tolerance: 0.0005, highQuality: false, mutate: false }); } catch { /* keep original */ }
    kept.push({ type: "Feature", properties: { landuse: lu }, geometry: roundCoords(simp.geometry) });
  }
  fs.writeFileSync(outFile, JSON.stringify({ type: "FeatureCollection", features: kept }));
  console.log(`${kept.length} polys, ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`);
  done++;
  sleepSync(800); // be gentle on the public instance between provinces
}
console.log(`\nDone. generated=${done} skipped=${skipped} failed=${failed}  -> ${path.relative(ROOT, OUT)}`);
