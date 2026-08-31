// Offline size reduction for the pre-generated landuse GeoJSON. Reads the raw
// capture (scripts/landuse_raw), simplifies harder, drops tiny slivers, lowers
// coordinate precision, and writes the shipped files (public/data/landuse).
// No network — safe to re-run with different knobs.
//
//   node scripts/shrinkLanduse.mjs [--tol=0.0012] [--dp=4] [--minarea=800]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "scripts", "landuse_raw");
const OUT = path.join(ROOT, "public", "data", "landuse");

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split("=")[1]) : d; };
const TOL = arg("tol", 0.0012);
const DP = arg("dp", 4);
const MIN_AREA = arg("minarea", 800);

const f = 10 ** DP;
const r = (n) => Math.round(n * f) / f;
function roundGeom(g) {
  if (g.type === "Polygon") g.coordinates = g.coordinates.map((ring) => ring.map(([x, y]) => [r(x), r(y)]));
  else if (g.type === "MultiPolygon") g.coordinates = g.coordinates.map((p) => p.map((ring) => ring.map(([x, y]) => [r(x), r(y)])));
  return g;
}

fs.mkdirSync(OUT, { recursive: true });
const files = fs.readdirSync(SRC).filter((n) => n.endsWith(".geojson"));
let inTotal = 0, outTotal = 0, polyIn = 0, polyOut = 0, areaAll = 0, areaKept = 0;

for (const name of files) {
  const src = path.join(SRC, name);
  inTotal += fs.statSync(src).size;
  const fc = JSON.parse(fs.readFileSync(src, "utf8"));
  const kept = [];
  for (const feat of fc.features || []) {
    polyIn++;
    const a = turf.area(feat);
    areaAll += a;
    if (!(a > MIN_AREA)) continue;
    areaKept += a;
    let simp = feat;
    try { simp = turf.simplify(feat, { tolerance: TOL, highQuality: false, mutate: true }); } catch { /* keep */ }
    const g = roundGeom(simp.geometry);
    // drop rings that collapsed to <4 points after simplification
    const ok = g.type === "Polygon" ? g.coordinates[0]?.length >= 4
      : g.coordinates.every((p) => p[0]?.length >= 4);
    if (!ok) continue;
    kept.push({ type: "Feature", properties: { landuse: feat.properties.landuse }, geometry: g });
    polyOut++;
  }
  const out = path.join(OUT, name);
  fs.writeFileSync(out, JSON.stringify({ type: "FeatureCollection", features: kept }));
  outTotal += fs.statSync(out).size;
}

const mb = (b) => (b / 1048576).toFixed(1);
console.log(`tol=${TOL} dp=${DP} minarea=${MIN_AREA}`);
console.log(`files=${files.length}  polys ${polyIn} -> ${polyOut}`);
console.log(`size  ${mb(inTotal)} MB -> ${mb(outTotal)} MB`);
console.log(`farmland area retained: ${(100 * areaKept / areaAll).toFixed(2)}%`);
