// Sample "Al's Athletics" p-median data for the UI kit (illustrative subset).
export const WAREHOUSES = [
  { id: "WH-01", name: "Allentown DC", state: "PA", status: "active",      x: 82, y: 32 },
  { id: "WH-02", name: "Atlanta DC",   state: "GA", status: "active",      x: 74, y: 62 },
  { id: "WH-03", name: "Chicago DC",   state: "IL", status: "forced_open", x: 63, y: 32 },
  { id: "WH-04", name: "Dallas DC",    state: "TX", status: "active",      x: 48, y: 68 },
  { id: "WH-05", name: "Denver DC",    state: "CO", status: "active",      x: 35, y: 42 },
  { id: "WH-06", name: "Reno DC",      state: "NV", status: "inactive",    x: 14, y: 38 },
  { id: "WH-07", name: "Seattle DC",   state: "WA", status: "active",      x: 12, y: 12 },
  { id: "WH-08", name: "Tampa DC",     state: "FL", status: "active",      x: 78, y: 80 }
];
export const CUSTOMERS = [
  { id: "C-101", name: "New York",     state: "NY", demand: 28540, x: 86, y: 27 },
  { id: "C-102", name: "Los Angeles",  state: "CA", demand: 24310, x: 10, y: 55 },
  { id: "C-103", name: "Chicago",      state: "IL", demand: 18240, x: 64, y: 30 },
  { id: "C-104", name: "Houston",      state: "TX", demand: 14780, x: 50, y: 76 },
  { id: "C-105", name: "Phoenix",      state: "AZ", demand: 11020, x: 22, y: 60 },
  { id: "C-106", name: "Philadelphia", state: "PA", demand: 10110, x: 84, y: 33 },
  { id: "C-107", name: "San Antonio",  state: "TX", demand: 8790,  x: 46, y: 78 },
  { id: "C-108", name: "San Diego",    state: "CA", demand: 8120,  x: 11, y: 60 },
  { id: "C-109", name: "Seattle",      state: "WA", demand: 7013,  x: 13, y: 10 },
  { id: "C-110", name: "Miami",        state: "FL", demand: 6480,  x: 82, y: 88 },
  { id: "C-111", name: "Minneapolis",  state: "MN", demand: 5920,  x: 55, y: 20 },
  { id: "C-112", name: "Boston",       state: "MA", demand: 5410,  x: 90, y: 20 }
];
// Post-solve assignment: open warehouses and which customers each serves.
export const SOLUTION = {
  open: ["WH-03", "WH-02", "WH-05", "WH-01"],
  assign: {
    "C-101": "WH-01", "C-106": "WH-01", "C-112": "WH-01",
    "C-103": "WH-03", "C-111": "WH-03",
    "C-102": "WH-05", "C-105": "WH-05", "C-108": "WH-05", "C-109": "WH-05",
    "C-104": "WH-02", "C-107": "WH-02", "C-110": "WH-02"
  },
  stats: ["objective 2,384,911", "avg distance 413 mi", "run 0.24s"]
};
export const CHAPTERS = [
  { chapter: "Chapter 3",  title: "Al's Athletics — P-Median", description: "Facility-location: choose which warehouses to open to minimize weighted distance to customers." },
  { chapter: "Chapter 5",  title: "Coal Transport LP", description: "Transportation LP: route coal from mines to power stations at minimum cost." },
  { chapter: "Chapter 5",  title: "Brazil Capacity — Capacitated P-Median", description: "Capacitated facility location: open warehouses under per-site capacity limits." },
  { chapter: "Chapter 10", title: "Gold Refinery Siting — Two-Echelon", description: "Two-echelon facility location: site a refinery between a gold mine and ten customers." }
];
