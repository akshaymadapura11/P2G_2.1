// src/LandUseMap.jsx
import { useEffect, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  CircleMarker,
  LayerGroup,
  Circle,
  GeoJSON,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import osmtogeojson from "osmtogeojson";
import * as turf from "@turf/turf";
import area from "@turf/area";
import "leaflet/dist/leaflet.css";

/* ---------------- Icons ---------------- */
function createColoredDotIcon(hex = "#1967d2") {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
      <circle cx="12" cy="12" r="6" fill="${hex}" stroke="white" stroke-width="2"/>
    </svg>`
  );
  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${svg}`,
    iconRetinaUrl: `data:image/svg+xml;charset=UTF-8,${svg}`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -10],
    className: "",
  });
}
const wtpIcon = createColoredDotIcon("#1967d2");

/* ---------------- Dataset colors ---------------- */
const DATASET_COLORS = {
  airports: "#1a73e8",
  prisons: "#f9ab00",
  stadiums: "#34a853",
  universities: "#a142f4",
  chefExpress: "#d93025",
  trainStations: "#00acc1",
  festivals: "#fb8c00",
  construction: "#6d4c41",
};

function normalizeDatasetKey(k) {
  const s = String(k || "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "chefexpress" || lower === "cheffexpress") return "chefExpress";
  // keep camelCase keys like trainStations
  return s;
}

function datasetColorFor(point) {
  const raw = point?.__type || point?.type || point?.dataset || "";
  const key = normalizeDatasetKey(raw);
  return DATASET_COLORS[key] || "#444";
}

/* ---------------- Landuse colors ---------------- */
const LANDUSE_COLORS = {
  farmland: "#FFD700",
  plantation: "#8B4513",
  orchard: "#7FFF00",
  vineyard: "#8B008B",
  greenhouse_horticulture: "#00CED1",
};

const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];

const overpassCache = new Map();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function fetchOverpassWithBackoff(query, abortSignal, cacheKey) {
  if (overpassCache.has(cacheKey)) return overpassCache.get(cacheKey);

  const maxAttempts = 4;
  let endpointIdx = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[endpointIdx % OVERPASS_ENDPOINTS.length];
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: "data=" + encodeURIComponent(query),
        signal: abortSignal,
      });

      if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);
      const json = await resp.json();
      const gj = osmtogeojson(json);
      overpassCache.set(cacheKey, gj);
      return gj;
    } catch (err) {
      if (abortSignal?.aborted) throw err;
      endpointIdx++;
      const backoff = Math.min(1500 * 2 ** attempt, 9000) + Math.random() * 400;
      await sleep(backoff);
    }
  }

  throw new Error("Overpass failed after multiple retries");
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
  return pt?.name || pt?.wwtp_name || pt?.plant_name || pt?.["wwtp_name"] || fallback;
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
    asNum(pt?.production) ??
    asNum(pt?.liters_per_year) ??
    asNum(pt?.n_kgper_year) ??
    asNum(pt?.n_kg_per_year) ??
    asNum(pt?.__production) ??
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
    c = turf.centroid(polyFeature);
  } catch {
    return false;
  }
  const [cx, cy] = c?.geometry?.coordinates || [];
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return false;

  // bbox prefilter first, distance second
  for (const b of circleBoxes || []) {
    if (cy < b.minLat || cy > b.maxLat || cx < b.minLon || cx > b.maxLon) continue;

    const d = turf.distance([cx, cy], [b.lon, b.lat], { units: "kilometers" });
    if (d <= km) return true;
  }
  return false;
}

export default function LandUseMap({
  center,
  searchRadiusKm,

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

    const tags = enabled.join("|");
    const { south, west, north, east } = bbox;

    const cacheKey = `bbox|centroid+bbox|${tags}|${south.toFixed(4)},${west.toFixed(
      4
    )},${north.toFixed(4)},${east.toFixed(4)}|r:${Number(searchRadiusKm || 0).toFixed(2)}|n:${supplyCircleCenters.length}`;

    const query = `
      [out:json][timeout:90];
      (
        nwr["landuse"~"${tags}"](${south},${west},${north},${east});
      );
      out geom;
    `;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const run = async () => {
      try {
        const gj = await fetchOverpassWithBackoff(query, controller.signal, cacheKey);

        const kept = [];
        let totalA = 0;

        for (const f of gj.features || []) {
          const lu =
            f.properties?.landuse ?? f.properties?.tags?.landuse ?? f.properties?.["landuse"];
          if (!lu || !landuseToggles[lu]) continue;

          const g = f.geometry;
          if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;

          const tf = turf.feature(g, { landuse: lu });

          // ✅ Keep only if centroid is inside ANY circle (bbox prefilter)
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

        onDataUpdate(kept);
      } catch (e) {
        if (e?.name === "AbortError") return;
        console.error("Overpass landuse error:", e);
        onDataUpdate([]);
      }
    };

    const t = setTimeout(run, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [searchRadiusKm, supplyCircleCenters, landuseToggles, totalProduction, onDataUpdate, circleBoxes]);

  const featuresKey = useMemo(() => {
    if (!features?.length) return "features-none";
    try {
      const fc = turf.featureCollection(features);
      const b = turf.bbox(fc).map((n) => n.toFixed(4)).join("|");
      return `n:${features.length}|b:${b}`;
    } catch {
      return `n:${features.length}`;
    }
  }, [features]);

  const stylePlot = (feature) => ({
    fillColor: LANDUSE_COLORS[feature.properties.landuse] || "#ccc",
    weight: 1,
    color: "#555",
    fillOpacity: 0.55,
  });

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
                pathOptions={{ color: "#111", weight: 1, opacity: 0.5, fillOpacity: 0 }}
              />
            );
          })}
      </LayerGroup>

      {/* polygons (filtered) */}
      {features?.length > 0 && (
        <GeoJSON key={featuresKey} data={{ type: "FeatureCollection", features }} style={stylePlot} />
      )}

      {/* WTP markers */}
      {(locationRows || []).map((pt, i) => {
        const lat = asNum(pt.lat ?? pt.__lat ?? pt.latitude ?? pt.Latitude);
        const lon = asNum(pt.lon ?? pt.__lon ?? pt.longitude ?? pt.Longitude ?? pt.lng);
        if (lat == null || lon == null) return null;

        const displayName = pickWtpName(pt, `WTP ${i + 1}`);
        const pe = pickPeValue(pt);
        const prod = pickWtpProduction(pt);

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
                    <strong>Output:</strong> {prod.toLocaleString()}
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

          return (
            <CircleMarker
              key={`extra-${p.__type || "x"}-${i}`}
              center={[lat, lon]}
              radius={markerRadius}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.9, weight: 2 }}
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
                  <div style={{ marginTop: 8, color: "#666" }}>
                    Lat/Lon: {lat.toFixed(5)}, {lon.toFixed(5)}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </LayerGroup>
    </MapContainer>
  );
}
