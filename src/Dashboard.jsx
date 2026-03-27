// src/Dashboard.jsx
import { useState } from "react";
import "./App.css";

const ABOUT_TEXT = `P2GreeN's overall objective is to foster a paradigm shift, from a linearly organised resource and nutrient system within the agri-food supply chain, towards a circular material flow system between urban and rural areas thereby restoring the coupling of the water-agri-food system using a holistic symbiotic resource management approach following the 3R principle "Reduce, Reuse, Recover".

To achieve this, P2GreeN will develop new circular governance solutions for the transition from fork to farm to halt and eliminate N & P pollution by connecting blue urban with green rural infrastructure, focussing on circular nutrient flows of nitrogen (N) and phosphorus (P). This objective will be achieved through the implementation and exploration of innovative N & P recovery solutions for the utilisation of human excreta from urban settlements and its conversion into safe bio-based fertilisers for agricultural production in three pilot regions (P2GreeN pilot regions) on a north-south trajectory from the Baltic Sea region via North German Plain to the region of Axarquia in Southern Spain and by multiplying the impact via four follower regions in Hungary, Italy, France and Greece.

The P2GreeN pilot regions will provide an operational environment to develop, adapt and demonstrate innovative circular systems for the utilisation of human excreta from urban settlements and its conversion into safe bio-based fertilisers for agricultural production and thus create innovative governance solutions at the water-agri-food nexus. P2GreeN will close nutrient cycles of N & P to foster the transition towards a circular and clean economy (green transition) as well as supporting sustainable food systems from farm to fork offering viable alternatives to reduce the current usage of mineral fertilisers with innovative Green bio-based fertilisers and thus minimise the pressure on the natural resources, specifically water and soil. P2GreeN will further enable policy makers to replicate P2GreeN's sustainable regional circular economy models in all regional settings across Europe.`;

const LANDUSE_LABELS = {
  farmland: "Farmland",
  plantation: "Plantation",
  orchard: "Orchard",
  vineyard: "Vineyard",
  greenhouse_horticulture: "Greenhouse horticulture",
  green_public_spaces: "Green public spaces",
};

const LANDUSE_COLORS = {
  farmland: "#FFD700",
  plantation: "#8B4513",
  orchard: "#355811ff",
  vineyard: "#8B008B",
  greenhouse_horticulture: "#00CED1",
  green_public_spaces: "#00b800ff",
};

const REQUIRED_KG_PER_HA = 160;

const SUPPLY_COLORS = {
  wtp: "#1967d2",
  airports: "#1a73e8",
  prisons: "#f9ab00",
  stadiums: "#2b412eff",
  universities: "#a142f4",
  chefExpress: "#d93025",
  trainStations: "#00acc1",
  festivals: "#fb8c00",
  construction: "#6d4c41",
};

function swatchStyle(hex) {
  return {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: hex,
    border: "1px solid rgba(0,0,0,0.25)",
    display: "inline-block",
    flexShrink: 0,
  };
}

function fmt(kg) {
  return kg.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function SupplyCard({ title, supplyKg, demandKg }) {
  const pct = demandKg > 0 ? Math.min((supplyKg / demandKg) * 100, 100) : 0;
  const rawPct = demandKg > 0 ? (supplyKg / demandKg) * 100 : 0;
  return (
    <div className="panel small">
      <h4>{title}</h4>
      <div className="miniStat">
        <div className="miniPct">{rawPct.toFixed(1)}%</div>
        <div className="miniBar">
          <div className="miniBarFill" style={{ width: `${pct}%` }} />
        </div>
        <div className="miniRow">
          <span>Nitrogen fertilizer supply</span>
          <span>= {fmt(supplyKg)} kg</span>
        </div>
        <div className="miniRow">
          <span>Nitrogen fertilizer demand</span>
          <span>= {fmt(demandKg)} kg</span>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({
  extraDatasets = [],
  extraToggles = {},
  onToggleExtra = () => {},

  radiusKm = 2,
  onRadiusKmChange = () => {},

  landuseTypes = [],
  toggles = {},
  onToggle = () => {},

  features = [],

  wtpSupplyKg = 0,
  publicSupplyKg = 0,
  totalSupplyKg = 0,

  showWtp = true,
  onToggleWtp = () => {},
}) {
  const [aboutOpen, setAboutOpen] = useState(false);

  const totalAreaM2 = (features || []).reduce((s, f) => s + (f?.properties?.area || 0), 0);
  const totalAreaKm2 = totalAreaM2 / 1e6;

  const demandKg = (features || []).reduce((sum, f) => {
    const areaHa = (f?.properties?.area || 0) / 10000;
    return sum + areaHa * REQUIRED_KG_PER_HA;
  }, 0);

  return (
    <>
      <div className="rightPanels">

        {/* Panel 1 — Supply sources */}
        <div className="panel">
          <h3>Define fertilizer supply!</h3>
          <p className="panelSub">Choose water treatment plants and/or public buildings to define potential fertilizer supply.</p>

          <label className="panelRow">
            <input type="checkbox" checked={showWtp} onChange={onToggleWtp} />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={swatchStyle(SUPPLY_COLORS.wtp)} />
              Waste water treatment plants
            </span>
          </label>

          {(extraDatasets || []).map((d) => {
            const color = SUPPLY_COLORS[d.key] || "#888";
            return (
              <label key={d.key} className="panelRow">
                <input
                  type="checkbox"
                  checked={!!extraToggles?.[d.key]}
                  onChange={() => onToggleExtra(d.key)}
                />
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={swatchStyle(color)} />
                  {d.label}
                </span>
              </label>
            );
          })}
        </div>

        {/* Panel 2 — Demand radius + Agricultural land */}
        <div className="panel">
          <h3>Define area of fertilizer demand!</h3>
          <p className="panelSub">Input a radius to select which area you want to supply and calculate the required demand of nitrogen.</p>

          <label className="panelRow" style={{ alignItems: "center" }}>
            <span style={swatchStyle(SUPPLY_COLORS.wtp)} />
            <span style={{ flex: 1, marginLeft: 8 }}>Radius in km</span>
            <input
              className="panelInput"
              type="number"
              min="0"
              step="0.5"
              value={radiusKm}
              onChange={(e) => onRadiusKmChange(Number(e.target.value))}
            />
          </label>

          <div className="divider" />

          <h3 style={{ marginTop: 4 }}>Agricultural land</h3>
          <p className="panelSub">Select one or more crop types to visualize and analyze agricultural areas.</p>

          <div className="panelGrid">
            {landuseTypes.map((t) => (
              <label key={t} className="panelRow">
                <input type="checkbox" checked={!!toggles[t]} onChange={() => onToggle(t)} />
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span
                    className="legendSwatch"
                    style={{
                      backgroundColor: LANDUSE_COLORS[t] || "#ccc",
                      border: "1px solid rgba(0,0,0,0.25)",
                    }}
                  />
                  {LANDUSE_LABELS[t] ?? t.replaceAll("_", " ")}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="panel about">
          <button
            type="button"
            onClick={() => setAboutOpen((o) => !o)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: "inherit", width: "100%", textAlign: "left" }}
          >
            ABOUT P2GREEN {aboutOpen ? "▲" : "▼"}
          </button>
          {aboutOpen && (
            <div style={{ marginTop: 12, fontSize: 11, lineHeight: 1.6, opacity: 0.9, whiteSpace: "pre-wrap" }}>
              {ABOUT_TEXT}
            </div>
          )}
        </div>
      </div>

      <div className="bottomMeta">
        <div className="bottomText">
          Total farming area: <strong>{totalAreaKm2.toFixed(2)} km²</strong>
        </div>
      </div>

      <div className="bottomPanels">
        <SupplyCard
          title="Waste water treatment plants supply vs demand per year"
          supplyKg={wtpSupplyKg}
          demandKg={demandKg}
        />
        <SupplyCard title="Public buildings supply vs demand per year" supplyKg={publicSupplyKg} demandKg={demandKg} />
        <SupplyCard title="Total supply vs demand per year" supplyKg={totalSupplyKg} demandKg={demandKg} />
      </div>
    </>
  );
}
