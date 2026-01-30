// src/App.jsx
import { Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

import Splash from "./pages/Splash";
import Menu from "./pages/Menu";
import LandUseMap from "./LandUseMap";
import Dashboard from "./Dashboard";

import { WTP_ALL_CSV, EXTRA_DATASETS } from "./utils/data";
import { useLocationGroup, useManyGenericPoints } from "./hooks/useLocationsData";

import "./App.css";

const landuseTypes = ["farmland", "plantation", "orchard", "vineyard", "greenhouse_horticulture"];

function MapProvincePage() {
  const nav = useNavigate();
  const { country, province } = useParams();

  const decodedCountry = useMemo(() => decodeURIComponent(country || ""), [country]);
  const decodedProvince = useMemo(() => decodeURIComponent(province || ""), [province]);

  const [radiusKm, setRadiusKm] = useState(2);
  

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

  // ✅ Build supply points list for drawing circles (Leaflet circles, not Turf)
  const supplyCircleCenters = useMemo(() => {
    const pts = [];

    if (showWtp) {
      for (const r of wtp.effectiveRows || []) {
        const lat = Number(r.lat ?? r.__lat);
        const lon = Number(r.lon ?? r.__lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lat, lon, kind: "wtp" });
      }
    }

    for (const p of extraPointsToShow || []) {
      const lat = Number(p.lat);
      const lon = Number(p.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lat, lon, kind: p.__type || "extra" });
    }

    return pts;
  }, [showWtp, wtp.effectiveRows, extraPointsToShow]);

  // ✅ Initial center: always first WTP if present, else first extra point
  const initialMapCenter = useMemo(() => {
    if (wtp.firstPointCenter) return wtp.firstPointCenter;
    if (extraPointsToShow?.length) return [Number(extraPointsToShow[0].lat), Number(extraPointsToShow[0].lon)];
    return null;
  }, [wtp.firstPointCenter, extraPointsToShow]);

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

        // ✅ circles drawn by Leaflet now
        supplyCircleCenters={supplyCircleCenters}
        circleRadiusKm={radiusKm}

        locationRows={showWtp ? wtp.effectiveRows : []}
        totalProduction={showWtp ? wtp.totalProduction : 0}

        extraPoints={extraPointsToShow}
        

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
