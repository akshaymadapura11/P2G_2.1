// src/App.jsx
import { Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import * as turf from "@turf/turf";

import Splash from "./pages/Splash";
import Menu from "./pages/Menu";
import LandUseMap from "./LandUseMap";
import Dashboard from "./Dashboard";

import { WTP_ALL_CSV, EXTRA_DATASETS } from "./utils/data";
import { useLocationGroup, useManyGenericPoints } from "./hooks/useLocationsData";

import "./App.css";

const landuseTypes = ["farmland", "plantation", "orchard", "vineyard", "greenhouse_horticulture"];

function buildCirclesAndUnion(points, radiusKm) {
  const valid = (points || []).filter(
    (p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon))
  );

  if (!valid.length || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    return { circlesFC: turf.featureCollection([]), unionPolygon: null, center: null };
  }

  const circles = valid.map((p) =>
    turf.circle([Number(p.lon), Number(p.lat)], radiusKm, { units: "kilometers", steps: 64 })
  );

  const circlesFC = turf.featureCollection(circles);

  let merged = circles[0];
  for (let i = 1; i < circles.length; i++) {
    try {
      const u = turf.union(merged, circles[i]);
      if (u) merged = u;
    } catch {}
  }

  return {
    circlesFC,
    unionPolygon: merged,
    center: [Number(valid[0].lat), Number(valid[0].lon)],
  };
}

function MapProvincePage() {
  const nav = useNavigate();
  const { country, province } = useParams();

  const decodedCountry = useMemo(() => decodeURIComponent(country || ""), [country]);
  const decodedProvince = useMemo(() => decodeURIComponent(province || ""), [province]);

  const [radiusKm, setRadiusKm] = useState(2);
  const [markerRadius, setMarkerRadius] = useState(6);

  const [toggles, setToggles] = useState(() =>
    landuseTypes.reduce((o, t) => ({ ...o, [t]: true }), {})
  );
  const [features, setFeatures] = useState([]);

  const [showWtp, setShowWtp] = useState(true);

  const [extraToggles, setExtraToggles] = useState(() =>
    EXTRA_DATASETS.reduce((o, d) => ({ ...o, [d.key]: true }), {})
  );

  useEffect(() => {
    setRadiusKm(2);
    setFeatures([]);
    setShowWtp(true);
    setExtraToggles(EXTRA_DATASETS.reduce((o, d) => ({ ...o, [d.key]: true }), {}));
  }, [decodedCountry, decodedProvince]);

  const wtp = useLocationGroup(WTP_ALL_CSV, 2, {
    country: decodedCountry,
    province: decodedProvince,
    globalRadiusKm: radiusKm,
  });

  const extraData = useManyGenericPoints(EXTRA_DATASETS, {
    country: decodedCountry,
    province: decodedProvince,
  });

  const visibleFeatures = useMemo(
    () => (features || []).filter((f) => toggles[f.properties.landuse]),
    [features, toggles]
  );

  const extraPointsToShow = useMemo(() => {
    return Object.entries(extraData.byKey || {})
      .filter(([k]) => extraToggles[k])
      .flatMap(([, rows]) => rows);
  }, [extraData.byKey, extraToggles]);

  const activeSupplyPoints = useMemo(() => {
    const pts = [];
    if (showWtp) {
      for (const r of wtp.effectiveRows || []) pts.push({ lat: r.lat ?? r.__lat, lon: r.lon ?? r.__lon });
    }
    for (const p of extraPointsToShow || []) pts.push({ lat: p.lat, lon: p.lon });
    return pts.filter((p) => p.lat != null && p.lon != null);
  }, [showWtp, wtp.effectiveRows, extraPointsToShow]);

  const aoi = useMemo(() => buildCirclesAndUnion(activeSupplyPoints, radiusKm), [activeSupplyPoints, radiusKm]);

  // Start at first WTP if possible, else first active supply point
  const initialMapCenter = wtp.firstPointCenter || aoi.center;

  // Supplies for graphs
  const wtpSupplyKg = showWtp ? Number(wtp.totalProduction || 0) : 0;

  const publicSupplyKg = useMemo(() => {
    let sum = 0;
    for (const p of extraPointsToShow || []) sum += Number(p.kg_n_per_year || 0);
    return sum;
  }, [extraPointsToShow]);

  const totalSupplyKg = wtpSupplyKg + publicSupplyKg;

  return (
    <div className="mapShell">
      <LandUseMap
        key={`${decodedCountry}__${decodedProvince}`}
        center={initialMapCenter}
        searchRadiusKm={radiusKm}
        unionPolygon={aoi.unionPolygon}
        circlesFC={aoi.circlesFC}
        locationRows={showWtp ? wtp.effectiveRows : []}
        totalProduction={showWtp ? wtp.totalProduction : 0}
        extraPoints={extraPointsToShow}
        markerRadius={markerRadius}
        features={visibleFeatures}
        onDataUpdate={setFeatures}
        landuseToggles={toggles}
      />

      <button className="backBtn" type="button" onClick={() => nav("/")}>
        Back to selection
      </button>

      <Dashboard
        radiusKm={radiusKm}
        onRadiusKmChange={setRadiusKm}
        markerRadius={markerRadius}
        onMarkerRadiusChange={setMarkerRadius}
        landuseTypes={landuseTypes}
        toggles={toggles}
        onToggle={(t) => setToggles((p) => ({ ...p, [t]: !p[t] }))}
        features={visibleFeatures}
        wtpSupplyKg={wtpSupplyKg}
        publicSupplyKg={publicSupplyKg}
        totalSupplyKg={totalSupplyKg}
        showWtp={showWtp}
        onToggleWtp={() => setShowWtp((s) => !s)}
        extraDatasets={EXTRA_DATASETS}
        extraToggles={extraToggles}
        onToggleExtra={(k) => setExtraToggles((p) => ({ ...p, [k]: !p[k] }))}
      />

      {wtp.loading && (
        <div className="notice notice-loading overlayNotice">
          Loading WTPs for {decodedProvince}, {decodedCountry}…
        </div>
      )}
      {wtp.error && <div className="notice notice-error overlayNotice">{wtp.error}</div>}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Splash />} />
      <Route path="/menu" element={<Menu />} />
      <Route path="/map/:country/:province" element={<MapProvincePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
