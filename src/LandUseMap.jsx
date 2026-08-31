// src/LandUseMap.jsx
import { useEffect, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  LayerGroup,
  Circle,
  GeoJSON,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import osmtogeojson from "osmtogeojson";
import { centroid, distance, feature as turfFeature } from "@turf/turf";
import area from "@turf/area";
import { landuseSlug } from "./utils/data";
import "leaflet/dist/leaflet.css";

/* ---------------- Icons ---------------- */
function createColoredSquareIcon(hex = "#1967d2") {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
      <circle cx="8" cy="8" r="6" fill="${hex}"/>
    </svg>`
  );
  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${svg}`,
    iconRetinaUrl: `data:image/svg+xml;charset=UTF-8,${svg}`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
    className: "",
  });
}
/* ---------------- Dataset colors ---------------- */
const DATASET_COLORS = {
  wtp: "#8bd212ff",
  airports: "#f2ff00ff",
  prisons: "#f9c300ff",
  stadiums: "#ff8800ff",
  universities: "#ff6200ff",
  chefExpress: "#703d10ff",
  trainStations: "#ed0b07ff",
  festivals: "#79590bff",
  construction: "#6b6209ff",
};

function normalizeDatasetKey(k) {
  const s = String(k || "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "chefexpress" || lower === "chefexpress") return "chefExpress";
  // keep camelCase keys like trainStations
  return s;
}

function datasetColorFor(point) {
  const raw = point?.__type || point?.type || point?.dataset || "";
  const key = normalizeDatasetKey(raw);
  return DATASET_COLORS[key] || "#444444";
}

const wtpIcon = createColoredSquareIcon(DATASET_COLORS.wtp);

/* ---------------- Landuse colors ---------------- */
const LANDUSE_COLORS = {
  farmland: "#6dacffff",
  plantation: "#27c6a9ff",
  orchard: "#1a64a1ff",
  vineyard: "#5f008bff",
  greenhouse_horticulture: "#5525ceff",
  green_public_spaces: "#c9267dff",
};

// LIVE Overpass for full-resolution farmland. openstreetmap.fr is a full-planet
// instance that stays reachable with CORS (Access-Control-Allow-Origin: *) when
// the others are down. overpass-api.de is a secondary for when it is back up.
const OVERPASS_ENDPOINTS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
const LIVE_TIMEOUT_MS = 30000;   // abort a slow endpoint and fail over / fall back
const LIVE_CAP_BYTES = 24 * 1024 * 1024; // abort huge responses (big rural regions)
const overpassCache = new Map(); // query -> Promise<geojson>

// Fetch + parse Overpass JSON, but abort if it exceeds the byte cap or the time
// limit — so a giant region (which a browser can't parse) fails over to the
// pre-generated static file instead of freezing the tab.
async function fetchCapped(endpoint, body, parentSignal) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (parentSignal) {
    if (parentSignal.aborted) ctrl.abort();
    else parentSignal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), LIVE_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > LIVE_CAP_BYTES) { ctrl.abort(); throw new Error("Overpass response too large"); }
      chunks.push(value);
    }
    const buf = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    return osmtogeojson(JSON.parse(new TextDecoder().decode(buf)));
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onAbort);
  }
}

function fetchOverpassLive(query, parentSignal) {
  if (overpassCache.has(query)) return overpassCache.get(query);
  const p = (async () => {
    const body = "data=" + encodeURIComponent(query);
    let lastErr;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        return await fetchCapped(endpoint, body, parentSignal);
      } catch (e) {
        if (parentSignal?.aborted) throw e;
        lastErr = e;
      }
    }
    throw lastErr || new Error("Overpass unavailable");
  })();
  overpassCache.set(query, p);
  p.catch(() => overpassCache.delete(query));
  return p;
}

// Pre-generated per-province static GeoJSON (scripts/genLanduse.mjs), served
// same-origin from /data/landuse/<slug>.geojson. Used as a reliable FALLBACK
// when the live Overpass fetch fails, times out, or is too large to parse.
const landuseFileCache = new Map(); // slug -> Promise<FeatureCollection>

function fetchLanduseFile(slug, abortSignal) {
  if (landuseFileCache.has(slug)) return landuseFileCache.get(slug);
  const p = (async () => {
    const resp = await fetch(`/data/landuse/${slug}.geojson`, { signal: abortSignal });
    if (resp.status === 404) return { type: "FeatureCollection", features: [] };
    if (!resp.ok) throw new Error(`landuse file HTTP ${resp.status}`);
    return resp.json();
  })();
  // Cache the promise so repeat visits to a province don't refetch; drop it on
  // failure so a transient error can be retried.
  landuseFileCache.set(slug, p);
  p.catch(() => landuseFileCache.delete(slug));
  return p;
}

/* ✅ Recenter helper */
function RecenterOnChange({ targetCenter, zoom = 12 }) {
  const map = useMap();
  const lastKeyRef = useRef("");

  useEffect(() => {
    if (!targetCenter || targetCenter.length !== 2) return;

    const lat = Number(targetCenter[0]);
    const lon = Number(targetCenter[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const key = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    if (key === lastKeyRef.current) return;

    lastKeyRef.current = key;
    map.setView([lat, lon], zoom, { animate: false });
  }, [map, targetCenter, zoom]);

  return null;
}

function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickWtpName(pt, fallback) {
  return (
    pt?.name ||
    pt?.["WWTP name"] ||     // ✅ WTP file
    pt?.["WWTP Name"] ||
    pt?.wwtp_name ||
    pt?.plant_name ||
    pt?.["wwtp_name"] ||
    fallback
  );
}


function pickPeValue(pt) {
  return (
    asNum(pt?.peValue) ??
    asNum(pt?.capacity_pe) ??
    asNum(pt?.pe) ??
    asNum(pt?.population_equivalent) ??
    null
  );
}

function pickWtpProduction(pt) {
  return (
    asNum(pt?.kg_n_per_year) ||               // ✅ standardized by hook
    asNum(pt?.["N kg/per year"]) ||           // ✅ WTP file
    asNum(pt?.production) ||
    asNum(pt?.liters_per_year) ||
    asNum(pt?.n_kgper_year) ||
    asNum(pt?.n_kg_per_year) ||
    asNum(pt?.__production) ||
    null
  );
}

function pickWtpProductionP(pt) {
  return (
    asNum(pt?.kg_p_per_year) ||               // ✅ standardized by hook
    asNum(pt?.["P kg/per year"]) ||           // ✅ WTP file
    asNum(pt?.p_kg_per_year) ||
    null
  );
}


/* ✅ One bbox around all circle centers to fetch quickly */
function bboxAroundCenters(centers, radiusKm) {
  const pts = (centers || [])
    .map((p) => ({ lat: asNum(p.lat), lon: asNum(p.lon) }))
    .filter((p) => p.lat != null && p.lon != null);

  if (!pts.length) return null;

  const km = Number(radiusKm);
  const r = Number.isFinite(km) && km > 0 ? km : 0;

  const latPad = r / 111;

  let minLat = Infinity,
    maxLat = -Infinity,
    minLon = Infinity,
    maxLon = -Infinity;

  for (const p of pts) {
    const cos = Math.cos((p.lat * Math.PI) / 180) || 1;
    const lonPad = r / (111 * cos);

    minLat = Math.min(minLat, p.lat - latPad);
    maxLat = Math.max(maxLat, p.lat + latPad);
    minLon = Math.min(minLon, p.lon - lonPad);
    maxLon = Math.max(maxLon, p.lon + lonPad);
  }

  return { south: minLat, west: minLon, north: maxLat, east: maxLon };
}

/* ✅ Build per-circle bbox list for prefiltering */
function buildCircleBBoxes(centers, radiusKm) {
  const km = Number(radiusKm);
  if (!Number.isFinite(km) || km <= 0) return [];

  const out = [];
  for (const p of centers || []) {
    const lat = asNum(p.lat);
    const lon = asNum(p.lon);
    if (lat == null || lon == null) continue;

    const latPad = km / 111;
    const cos = Math.cos((lat * Math.PI) / 180) || 1;
    const lonPad = km / (111 * cos);

    out.push({
      lat,
      lon,
      minLat: lat - latPad,
      maxLat: lat + latPad,
      minLon: lon - lonPad,
      maxLon: lon + lonPad,
    });
  }
  return out;
}

/* ✅ SUPER FAST: centroid inside ANY circle using bbox prefilter + distance */
function centroidInsideAnyCircle(polyFeature, circleBoxes, radiusKm) {
  const km = Number(radiusKm);
  if (!Number.isFinite(km) || km <= 0) return false;

  let c;
  try {
    c = centroid(polyFeature);
  } catch {
    return false;
  }
  const [cx, cy] = c?.geometry?.coordinates || [];
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return false;

  // bbox prefilter first, distance second
  for (const b of circleBoxes || []) {
    if (cy < b.minLat || cy > b.maxLat || cx < b.minLon || cx > b.maxLon) continue;

    const d = distance([cx, cy], [b.lon, b.lat], { units: "kilometers" });
    if (d <= km) return true;
  }
  return false;
}

export default function LandUseMap({
  center,
  searchRadiusKm,

  // province identity (selects the pre-generated landuse file)
  country = "",
  province = "",

  // circles
  supplyCircleCenters = [],
  circleRadiusKm = 2,

  // markers
  locationRows = [],
  extraPoints = [],
  markerRadius = 6,

  // polygons
  landuseToggles = {},
  features = [],
  onDataUpdate = () => {},
  onLoadingChange = () => {},
  totalProduction = 0,
}) {
  const abortRef = useRef(null);

  const firstWtpCenter = useMemo(() => {
    if (!locationRows?.length) return null;
    const pt = locationRows[0];
    const lat = asNum(pt.lat ?? pt.__lat ?? pt.latitude ?? pt.Latitude);
    const lon = asNum(pt.lon ?? pt.__lon ?? pt.longitude ?? pt.Longitude ?? pt.lng);
    return lat != null && lon != null ? [lat, lon] : null;
  }, [locationRows]);

  const firstExtraCenter = useMemo(() => {
    if (!extraPoints?.length) return null;
    const p = extraPoints[0];
    const lat = asNum(p.lat);
    const lon = asNum(p.lon);
    return lat != null && lon != null ? [lat, lon] : null;
  }, [extraPoints]);

  const safeCenter = firstWtpCenter || center || firstExtraCenter || null;
  const initialCenter = safeCenter || [0, 0];

  const radiusMeters = useMemo(() => {
    const km = Number(circleRadiusKm);
    if (!Number.isFinite(km) || km <= 0) return 0;
    return km * 1000;
  }, [circleRadiusKm]);

  const circleKey = useMemo(
    () => `circles:${supplyCircleCenters.length}|km:${circleRadiusKm}`,
    [supplyCircleCenters.length, circleRadiusKm]
  );

  // ✅ precomputed circle bboxes for fast filtering
  const circleBoxesKey = useMemo(() => {
    const bbox = bboxAroundCenters(supplyCircleCenters, searchRadiusKm);
    const b = bbox
      ? `${bbox.south.toFixed(4)},${bbox.west.toFixed(4)},${bbox.north.toFixed(4)},${bbox.east.toFixed(4)}`
      : "none";
    return `cb|r:${Number(searchRadiusKm || 0).toFixed(2)}|n:${supplyCircleCenters.length}|b:${b}`;
  }, [supplyCircleCenters, searchRadiusKm]);

  const circleBoxes = useMemo(() => {
    return buildCircleBBoxes(supplyCircleCenters, searchRadiusKm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleBoxesKey]);

  /* ✅ FAST fetch + centroid filter (bbox prefilter added) */
  useEffect(() => {
    const enabled = Object.keys(LANDUSE_COLORS).filter((k) => landuseToggles?.[k]);
    if (!enabled.length) {
      onDataUpdate([]);
      return;
    }

    const bbox = bboxAroundCenters(supplyCircleCenters, searchRadiusKm);
    if (!bbox) {
      onDataUpdate([]);
      return;
    }

    const slug = landuseSlug(country, province);
    if (!slug) {
      onDataUpdate([]);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Full-resolution live Overpass query for this province's bbox.
    const { south, west, north, east } = bbox;
    const landuseTags = enabled.filter((k) => k !== "green_public_spaces");
    const wantGreen = enabled.includes("green_public_spaces");
    const parts = [];
    if (landuseTags.length) {
      parts.push(
        `way["landuse"~"${landuseTags.join("|")}"](${south},${west},${north},${east});`,
        `relation["landuse"~"${landuseTags.join("|")}"](${south},${west},${north},${east});`
      );
    }
    if (wantGreen) {
      parts.push(
        `way["leisure"~"park|garden|nature_reserve|recreation_ground"](${south},${west},${north},${east});`,
        `relation["leisure"~"park|garden|nature_reserve|recreation_ground"](${south},${west},${north},${east});`
      );
    }
    const query = `[out:json][timeout:30];\n(\n${parts.join("\n")}\n);\nout geom;`;

    const run = async () => {
      onLoadingChange(true);
      try {
        // TEMP: static fallback disabled to force the live openstreetmap.fr path
        // so we can confirm live works (and see any error in the console).
        // Re-enable the try/catch below to restore the static fallback.
        const gj = await fetchOverpassLive(query, controller.signal);
        // let gj;
        // try {
        //   gj = await fetchOverpassLive(query, controller.signal);
        // } catch (e) {
        //   if (controller.signal.aborted) return;
        //   gj = await fetchLanduseFile(slug, controller.signal);
        // }
        if (controller.signal.aborted) return;
        console.info(`landuse: live Overpass returned ${gj.features?.length ?? 0} features`);

        const kept = [];
        let totalA = 0;

        for (const f of gj.features || []) {
          // Static files tag properties.landuse directly; live osmtogeojson
          // output carries raw OSM tags (incl. leisure for green spaces).
          let lu = f.properties?.landuse ?? f.properties?.tags?.landuse;
          if (!lu) {
            const leisure = f.properties?.leisure ?? f.properties?.tags?.leisure;
            if (["park", "garden", "nature_reserve", "recreation_ground"].includes(leisure)) {
              lu = "green_public_spaces";
            }
          }
          if (!lu || !landuseToggles[lu]) continue;

          const g = f.geometry;
          if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;

          const tf = turfFeature(g, { landuse: lu });

          if (!centroidInsideAnyCircle(tf, circleBoxes, searchRadiusKm)) continue;

          const a = area(tf);
          if (!Number.isFinite(a) || a <= 0) continue;

          tf.properties.area = a;
          kept.push(tf);
          totalA += a;
        }

        const prod = Number(totalProduction || 0);
        for (const p of kept) {
          p.properties.fertilizer = totalA > 0 ? (p.properties.area / totalA) * prod : 0;
        }

        // Stream polygons in batches so the map fills in progressively
        const BATCH = 15;
        onDataUpdate([]);
        for (let i = 0; i < kept.length; i += BATCH) {
          if (controller.signal.aborted) return;
          onDataUpdate(kept.slice(0, i + BATCH));
          await new Promise((r) => setTimeout(r, 40));
        }
        if (!controller.signal.aborted) onDataUpdate(kept);
      } catch (e) {
        if (e?.name === "AbortError") return;
        console.error("Landuse load error:", e);
        onDataUpdate([]);
      } finally {
        if (!controller.signal.aborted) onLoadingChange(false);
      }
    };

    run();
    return () => {
      controller.abort();
    };
  }, [country, province, searchRadiusKm, supplyCircleCenters, landuseToggles, totalProduction, onDataUpdate, circleBoxes]);

  const stylePlot = (feature) => ({
    fillColor: LANDUSE_COLORS[feature.properties.landuse] || "#cccccc57",
    weight: 0.25,
    color: "#555",
    fillOpacity: 0.55,
  });

  function onEachPlot(feature, layer) {
    const p = feature.properties || {};
    const lu = p.landuse || "unknown";
    const areaHa = p.area != null ? (p.area / 10000).toFixed(2) : null;
    const fertilizer = p.fertilizer != null ? Number(p.fertilizer).toLocaleString(undefined, { maximumFractionDigits: 1 }) : null;
    const name = p.name || p["name:en"] || null;

    const label = lu
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    let html = `<div style="min-width:180px">`;
    if (name) html += `<strong>${name}</strong><br/>`;
    html += `<span style="color:#555">${label}</span>`;
    if (areaHa) html += `<div style="margin-top:6px"><strong>Area:</strong> ${areaHa} ha</div>`;
    if (fertilizer) html += `<div style="margin-top:4px"><strong>Fertilizer share:</strong> ${fertilizer} kg N/year</div>`;
    html += `</div>`;

    layer.bindPopup(html);
  }

  return (
    <MapContainer center={initialCenter} zoom={12} style={{ height: "100vh", width: "100%" }}>
      <RecenterOnChange targetCenter={safeCenter} zoom={12} />

      <TileLayer
        className="base-map"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap contributors"
      />

      {/* ✅ thin circles */}
      <LayerGroup key={circleKey}>
        {radiusMeters > 0 &&
          (supplyCircleCenters || []).map((p, i) => {
            const lat = Number(p.lat);
            const lon = Number(p.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

            return (
              <Circle
                key={`circ-${i}`}
                center={[lat, lon]}
                radius={radiusMeters}
                pathOptions={{ color: "#5d5d5d72", weight: 1, opacity: 0.5, fillOpacity: 0 }}
              />
            );
          })}
      </LayerGroup>

      {/* polygons — rendered individually so new ones appear without remounting existing */}
      {(features || []).map((f, i) => (
        <GeoJSON
          key={`plot-${i}`}
          data={f}
          style={stylePlot}
          onEachFeature={onEachPlot}
        />
      ))}

      {/* WTP markers */}
      {(locationRows || []).map((pt, i) => {
        const lat = asNum(pt.lat ?? pt.__lat ?? pt.latitude ?? pt.Latitude);
        const lon = asNum(pt.lon ?? pt.__lon ?? pt.longitude ?? pt.Longitude ?? pt.lng);
        if (lat == null || lon == null) return null;

        const displayName = pickWtpName(pt, `WTP ${i + 1}`);
        const pe = pickPeValue(pt);
        const prod = pickWtpProduction(pt);
        const prodP = pickWtpProductionP(pt);

        return (
          <Marker key={`wtp-${i}`} position={[lat, lon]} icon={wtpIcon}>
            <Popup>
              <div style={{ minWidth: 240 }}>
                <strong>{displayName}</strong>
                {pt?.province && pt?.country && (
                  <div style={{ marginTop: 4, color: "#444" }}>
                    {pt.province}, {pt.country}
                  </div>
                )}
                {pe != null && (
                  <div style={{ marginTop: 8 }}>
                    <strong>Capacity (p.e):</strong> {pe.toLocaleString()}
                  </div>
                )}
                {prod != null && (
                  <div style={{ marginTop: 4 }}>
                    <strong>Kg N/year:</strong> {prod.toLocaleString()}
                  </div>
                )}
                {prodP != null && (
                  <div style={{ marginTop: 4 }}>
                    <strong>Kg P/year:</strong> {prodP.toLocaleString()}
                  </div>
                )}
                <div style={{ marginTop: 8, color: "#666" }}>
                  Lat/Lon: {lat.toFixed(5)}, {lon.toFixed(5)}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}

      {/* extra dataset markers */}
      <LayerGroup>
        {(extraPoints || []).map((p, i) => {
          const lat = asNum(p.lat);
          const lon = asNum(p.lon);
          if (lat == null || lon == null) return null;

          const color = datasetColorFor(p);
          const label = p.__label || p.label || p.__type || "Dataset";
          const kg = asNum(p.kg_n_per_year) ?? 0;
          const kgP = asNum(p.kg_p_per_year) ?? 0;

          return (
            <Marker
              key={`extra-${p.__type || "x"}-${i}`}
              position={[lat, lon]}
              icon={createColoredSquareIcon(color)}
            >
              <Popup>
                <div style={{ minWidth: 240 }}>
                  <strong>{p.name || "Location"}</strong>
                  <div style={{ marginTop: 4, color: "#444" }}>{label}</div>
                  {(p.province || p.country) && (
                    <div style={{ marginTop: 6, color: "#666" }}>
                      {[p.province, p.country].filter(Boolean).join(", ")}
                    </div>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <strong>Kg N/year:</strong> {kg.toLocaleString()}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <strong>Kg P/year:</strong> {kgP.toLocaleString()}
                  </div>
                  <div style={{ marginTop: 8, color: "#666" }}>
                    Lat/Lon: {lat.toFixed(5)}, {lon.toFixed(5)}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </LayerGroup>
    </MapContainer>
  );
}
