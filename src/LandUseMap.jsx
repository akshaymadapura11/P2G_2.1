// src/LandUseMap.jsx
import { useEffect, useRef, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  Marker,
  Popup,
  CircleMarker,
  LayerGroup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import osmtogeojson from "osmtogeojson";
import area from "@turf/area";
import * as turf from "@turf/turf";
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
};

function normalizeDatasetKey(k) {
  const s = String(k || "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "chefexpress" || lower === "cheffexpress") return "chefExpress";
  return lower;
}

function datasetColorFor(point) {
  const raw = point?.__type || point?.type || point?.dataset || "";
  const key = normalizeDatasetKey(raw);
  if (key === "university") return DATASET_COLORS.universities;
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

  const maxAttempts = 5;
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
      const backoff = Math.min(2000 * 2 ** attempt, 12000) + Math.random() * 500;
      endpointIdx++;
      await sleep(backoff);
    }
  }

  throw new Error("Overpass failed after multiple retries");
}

function circleFeatureToPolyString(circleFeature) {
  if (!circleFeature?.geometry) return null;

  let f = circleFeature;
  try {
    f = turf.simplify(circleFeature, { tolerance: 0.003, highQuality: false });
  } catch {}

  const g = f.geometry;
  let outer = null;

  if (g.type === "Polygon") outer = g.coordinates?.[0];
  else if (g.type === "MultiPolygon") outer = g.coordinates?.[0]?.[0];

  if (!outer || outer.length < 4) return null;

  const parts = [];
  for (const [lon, lat] of outer) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    parts.push(`${lat} ${lon}`);
  }
  return parts.length >= 4 ? parts.join(" ") : null;
}

function clipToAllCircles(tf, circlesFC) {
  const circles = circlesFC?.features || [];
  if (!circles.length) return null;

  const parts = [];
  for (const c of circles) {
    try {
      const inter = turf.intersect(tf, c);
      if (inter) parts.push(inter);
    } catch {}
  }

  if (parts.length === 0) {
    try {
      const ctr = turf.centroid(tf);
      for (const c of circles) {
        if (turf.booleanPointInPolygon(ctr, c)) return tf;
      }
    } catch {}
    return null;
  }

  let merged = parts[0];
  for (let i = 1; i < parts.length; i++) {
    try {
      const u = turf.union(merged, parts[i]);
      if (u) merged = u;
    } catch {}
  }
  return merged;
}

/* ✅ Recenter helper: prevents ocean start */
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
    pt?.wwtp_name ||
    pt?.WTP ||
    pt?.plant_name ||
    pt?.["wwtp_name"] ||
    fallback
  );
}

function pickPeValue(pt) {
  return (
    asNum(pt?.peValue) ??
    asNum(pt?.capacity_pe) ??
    asNum(pt?.capacity_p_e) ??
    asNum(pt?.pe) ??
    asNum(pt?.population_equivalent) ??
    null
  );
}

function pickWtpProduction(pt) {
  // depending on your csv, production may be kg/year or liters/year
  return (
    asNum(pt?.production) ??
    asNum(pt?.liters_per_year) ??
    asNum(pt?.n_kgper_year) ??
    asNum(pt?.n_kg_per_year) ??
    asNum(pt?.__production) ??
    null
  );
}

export default function LandUseMap({
  extraPoints = [],
  markerRadius = 6,

  center,
  searchRadiusKm,
  landuseToggles,
  features = [],
  onDataUpdate,

  unionPolygon,
  circlesFC,

  locationRows = [],
  totalProduction = 0,
}) {
  const abortRef = useRef(null);

  // choose best center:
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

  const circlesSig = useMemo(() => {
    try {
      if (!circlesFC?.features?.length) return "circles-none";
      const b = turf.bbox(circlesFC).map((n) => n.toFixed(6)).join("|");
      return `n:${circlesFC.features.length}|b:${b}`;
    } catch {
      return "circles-fallback";
    }
  }, [circlesFC]);

  const extraLayerKey = useMemo(() => {
    const n = Array.isArray(extraPoints) ? extraPoints.length : 0;
    return `extra:${n}|r:${markerRadius}`;
  }, [extraPoints, markerRadius]);

  useEffect(() => {
    if (!safeCenter || !searchRadiusKm) return;
    if (!circlesFC?.features?.length) return;

    const enabled = Object.keys(LANDUSE_COLORS).filter((k) => landuseToggles?.[k]);
    if (!enabled.length) {
      onDataUpdate([]);
      return;
    }
    const tags = enabled.join("|");

    const statements = (circlesFC.features || [])
      .map((c) => circleFeatureToPolyString(c))
      .filter(Boolean)
      .map((p) => `nwr["landuse"~"${tags}"](poly:"${p}");`)
      .join("\n");

    if (!statements) {
      onDataUpdate([]);
      return;
    }

    const query = `
      [out:json][timeout:180];
      (
        ${statements}
      );
      out body;
      >;
      out skel qt;
    `;

    const cacheKey = `circlesPolyPOST|${tags}|${circlesSig}`;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const run = async () => {
      try {
        const gj = await fetchOverpassWithBackoff(query, controller.signal, cacheKey);

        const clipped = [];
        let totalArea = 0;

        for (const f of gj.features || []) {
          const sourceLanduse =
            f.properties?.landuse ?? f.properties?.tags?.landuse ?? f.properties?.["landuse"];

          if (!sourceLanduse) continue;
          if (!landuseToggles[sourceLanduse]) continue;
          if (!f.geometry) continue;

          const tf = turf.feature(f.geometry, { landuse: sourceLanduse });
          const inter = clipToAllCircles(tf, circlesFC);
          if (!inter) continue;

          if (inter.geometry?.type !== "Polygon" && inter.geometry?.type !== "MultiPolygon") continue;

          const a = area(inter);
          if (a > 0) {
            inter.properties = { ...(inter.properties || {}), landuse: sourceLanduse, area: a };
            totalArea += a;
            clipped.push(inter);
          }
        }

        const totalFert = Number.isFinite(totalProduction) ? totalProduction : 0;
        for (const feat of clipped) {
          feat.properties.fertilizer = totalArea > 0 ? (feat.properties.area / totalArea) * totalFert : 0;
        }

        onDataUpdate(clipped);
      } catch (err) {
        if (err?.name === "AbortError") return;
        console.error("Overpass error:", err);
        onDataUpdate([]);
      }
    };

    const t = setTimeout(run, 200);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [safeCenter, searchRadiusKm, circlesFC, circlesSig, landuseToggles, totalProduction, onDataUpdate]);

  const featuresKey = useMemo(() => {
    if (!features?.length) return "features-none";
    try {
      const fc = turf.featureCollection(features);
      const b = turf.bbox(fc).map((n) => n.toFixed(6)).join("|");
      return `n:${features.length}|b:${b}`;
    } catch {
      return `n:${features.length}`;
    }
  }, [features]);

  const stylePlot = (feature) => ({
    fillColor: LANDUSE_COLORS[feature.properties.landuse] || "#ccc",
    weight: 1,
    color: "#555",
    fillOpacity: 0.6,
  });

  const onEachFeature = (feature, layer) => {
    layer.on({
      mouseover: () => {
        layer.setStyle({ weight: 3, fillOpacity: 0.9 });
        layer
          .bindPopup(
            `Type: ${feature.properties.landuse}<br/>` +
              `Area: ${(feature.properties.area / 1e6).toFixed(2)} km²<br/>` +
              `Fertilizer: ${(feature.properties.fertilizer ?? 0).toFixed(2)}`
          )
          .openPopup();
      },
      mouseout: () => {
        layer.setStyle(stylePlot(feature));
        layer.closePopup();
      },
    });
  };

  return (
    <MapContainer center={initialCenter} zoom={12} style={{ height: "100vh", width: "100%" }}>
      <RecenterOnChange targetCenter={safeCenter} zoom={12} />

      <TileLayer
        className="base-map"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap contributors"
      />

      {/* Demand circles */}
      {circlesFC?.features?.map((c, i) => (
        <GeoJSON key={`aoi-${i}`} data={c} style={{ color: "#111", weight: 2, fillOpacity: 0.08 }} />
      ))}

      {unionPolygon && (
        <GeoJSON key="union" data={unionPolygon} style={{ color: "#333", weight: 2, fillOpacity: 0.04 }} />
      )}

      {/* ✅ WTP markers with details restored */}
      {locationRows?.map((pt, i) => {
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

      {/* Landuse overlays */}
      {features?.length > 0 && (
        <GeoJSON
          key={featuresKey}
          data={{ type: "FeatureCollection", features }}
          style={stylePlot}
          onEachFeature={onEachFeature}
        />
      )}

      {/* ✅ Extra datasets (public buildings) with details restored */}
      <LayerGroup key={extraLayerKey}>
        {(extraPoints || []).map((p, i) => {
          const lat = asNum(p.lat);
          const lon = asNum(p.lon);
          if (lat == null || lon == null) return null;

          const color = datasetColorFor(p);
          const label = p.__label || p.label || p.__type || "Dataset";
          const kg = asNum(p.kg_n_per_year) ?? 0;

          // optional fields from your CSVs
          const cap = asNum(p.capacity);
          const students = asNum(p.students);
          const passengers = asNum(p.passengers);
          const year = asNum(p.year);

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

                  {cap != null && (
                    <div style={{ marginTop: 4 }}>
                      <strong>Capacity:</strong> {cap.toLocaleString()}
                    </div>
                  )}

                  {students != null && (
                    <div style={{ marginTop: 4 }}>
                      <strong>Students:</strong> {students.toLocaleString()}
                    </div>
                  )}

                  {passengers != null && (
                    <div style={{ marginTop: 4 }}>
                      <strong>Passengers:</strong> {passengers.toLocaleString()}
                      {year != null ? ` (${year})` : ""}
                    </div>
                  )}

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
