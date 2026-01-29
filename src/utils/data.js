// src/utils/data.js

// ONE CSV for all regions:

export const WTP_ALL_CSV = "/data/wtp_all.csv";

// If you have public buildings CSVs per region keep them as-is;
// otherwise you can do the same strategy later.
export const LOCATION_GROUPS = [
  {
    id: "thessaly",
    name: "Thessaly",
    defaultCenter: [39.366, 22.945],
    defaultRadiusKm: 10,
    wtpCsv: WTP_ALL_CSV,
  },
  {
    id: "attica",
    name: "Attica",
    defaultCenter: [37.9838, 23.7275],
    defaultRadiusKm: 10,
    wtpCsv: WTP_ALL_CSV,
  },
  {
    id: "iledefrance",
    name: "Île-de-France",
    defaultCenter: [48.8566, 2.3522],
    defaultRadiusKm: 10,
    wtpCsv: WTP_ALL_CSV,
  },
  {
    id: "budapest",
    name: "Budapest",
    defaultCenter: [47.4979, 19.0402],
    defaultRadiusKm: 10,
    wtpCsv: WTP_ALL_CSV,
  },
  {
    id: "campania",
    name: "Campania",
    defaultCenter: [40.8518, 14.2681],
    defaultRadiusKm: 10,
    wtpCsv: WTP_ALL_CSV,
  },
];


// Additional point datasets
export const EXTRA_DATASETS = [
  { key: "airports", label: "Airports", url: "/data/Airports_NUTS2_supply.csv" },
  { key: "prisons", label: "Prisons", url: "/data/Prisons_NUTS2_supply.csv" },
  { key: "stadiums", label: "Stadiums", url: "/data/Stadiums_NUTS2_supply.csv" },
  { key: "universities", label: "Universities", url: "/data/Universities_NUTS2_supply.csv" },
  { key: "chefExpress", label: "CheffExpress", url: "/data/CheffExpress_NUTS2_supply.csv" },
];

