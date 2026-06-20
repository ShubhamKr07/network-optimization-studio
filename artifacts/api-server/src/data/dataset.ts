export interface WarehouseCandidate {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

export interface Customer {
  id: string;
  lat: number;
  lng: number;
  demand: number;
}

export const WAREHOUSES: WarehouseCandidate[] = [
  { id: "LA",   city: "Los Angeles",    state: "CA", lat: 34.0522, lng: -118.2437 },
  { id: "CHI",  city: "Chicago",        state: "IL", lat: 41.8781, lng: -87.6298  },
  { id: "ATL",  city: "Atlanta",        state: "GA", lat: 33.7490, lng: -84.3880  },
  { id: "DAL",  city: "Dallas",         state: "TX", lat: 32.7767, lng: -96.7970  },
  { id: "NYC",  city: "New York",       state: "NY", lat: 40.7128, lng: -74.0060  },
  { id: "HOU",  city: "Houston",        state: "TX", lat: 29.7604, lng: -95.3698  },
  { id: "PHX",  city: "Phoenix",        state: "AZ", lat: 33.4484, lng: -112.0740 },
  { id: "PHL",  city: "Philadelphia",   state: "PA", lat: 39.9526, lng: -75.1652  },
  { id: "SA",   city: "San Antonio",    state: "TX", lat: 29.4241, lng: -98.4936  },
  { id: "SD",   city: "San Diego",      state: "CA", lat: 32.7157, lng: -117.1611 },
  { id: "CLB",  city: "Columbus",       state: "OH", lat: 39.9612, lng: -82.9988  },
  { id: "IND",  city: "Indianapolis",   state: "IN", lat: 39.7684, lng: -86.1581  },
  { id: "CLT",  city: "Charlotte",      state: "NC", lat: 35.2271, lng: -80.8431  },
  { id: "SEA",  city: "Seattle",        state: "WA", lat: 47.6062, lng: -122.3321 },
  { id: "DEN",  city: "Denver",         state: "CO", lat: 39.7392, lng: -104.9903 },
  { id: "BOS",  city: "Boston",         state: "MA", lat: 42.3601, lng: -71.0589  },
  { id: "NSH",  city: "Nashville",      state: "TN", lat: 36.1627, lng: -86.7816  },
  { id: "MEM",  city: "Memphis",        state: "TN", lat: 35.1495, lng: -90.0490  },
  { id: "POR",  city: "Portland",       state: "OR", lat: 45.5051, lng: -122.6750 },
  { id: "LV",   city: "Las Vegas",      state: "NV", lat: 36.1699, lng: -115.1398 },
  { id: "KC",   city: "Kansas City",    state: "MO", lat: 39.0997, lng: -94.5786  },
  { id: "MSP",  city: "Minneapolis",    state: "MN", lat: 44.9778, lng: -93.2650  },
  { id: "MIA",  city: "Miami",          state: "FL", lat: 25.7617, lng: -80.1918  },
  { id: "TPA",  city: "Tampa",          state: "FL", lat: 27.9506, lng: -82.4572  },
  { id: "SLC",  city: "Salt Lake City", state: "UT", lat: 40.7608, lng: -111.8910 },
  { id: "CIN",  city: "Cincinnati",     state: "OH", lat: 39.1031, lng: -84.5120  },
];

function seededRand(seed: number) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function generateCustomers(): Customer[] {
  const rand = seededRand(42);

  const clusters: Array<{ lat: number; lng: number; weight: number; spread: number }> = [
    { lat: 40.71, lng: -74.01, weight: 15, spread: 2.5 },
    { lat: 34.05, lng: -118.24, weight: 15, spread: 2.0 },
    { lat: 41.88, lng: -87.63, weight: 12, spread: 2.0 },
    { lat: 29.76, lng: -95.37, weight: 8, spread: 1.5 },
    { lat: 33.75, lng: -84.39, weight: 7, spread: 1.5 },
    { lat: 33.45, lng: -112.07, weight: 7, spread: 1.5 },
    { lat: 47.61, lng: -122.33, weight: 6, spread: 1.2 },
    { lat: 39.74, lng: -104.99, weight: 6, spread: 1.2 },
    { lat: 29.42, lng: -98.49, weight: 5, spread: 1.0 },
    { lat: 32.78, lng: -96.80, weight: 5, spread: 1.2 },
    { lat: 39.95, lng: -75.17, weight: 5, spread: 1.0 },
    { lat: 25.76, lng: -80.19, weight: 5, spread: 1.0 },
    { lat: 42.36, lng: -71.06, weight: 5, spread: 1.0 },
    { lat: 44.98, lng: -93.27, weight: 4, spread: 1.0 },
    { lat: 36.16, lng: -86.78, weight: 4, spread: 1.0 },
    { lat: 39.10, lng: -94.58, weight: 3, spread: 1.0 },
    { lat: 36.17, lng: -115.14, weight: 3, spread: 0.8 },
    { lat: 40.76, lng: -111.89, weight: 3, spread: 0.8 },
    { lat: 35.15, lng: -90.05, weight: 3, spread: 0.8 },
    { lat: 35.23, lng: -80.84, weight: 3, spread: 0.8 },
    { lat: 39.96, lng: -82.99, weight: 3, spread: 0.8 },
    { lat: 27.95, lng: -82.46, weight: 3, spread: 0.8 },
    { lat: 39.77, lng: -86.16, weight: 3, spread: 0.8 },
    { lat: 45.50, lng: -122.68, weight: 2, spread: 0.6 },
    { lat: 32.72, lng: -117.16, weight: 2, spread: 0.6 },
  ];

  const totalWeight = clusters.reduce((s, c) => s + c.weight, 0);
  const customers: Customer[] = [];

  for (let i = 0; i < 200; i++) {
    let pick = rand() * totalWeight;
    let cluster = clusters[clusters.length - 1];
    for (const c of clusters) {
      pick -= c.weight;
      if (pick <= 0) { cluster = c; break; }
    }

    const gaussian = () => {
      let u = 0, v = 0;
      while (u === 0) u = rand();
      while (v === 0) v = rand();
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    };

    const lat = Math.max(25.5, Math.min(48.5, cluster.lat + gaussian() * cluster.spread));
    const lng = Math.max(-124, Math.min(-67, cluster.lng + gaussian() * cluster.spread));
    const demand = Math.max(100, Math.round((0.5 + rand() * 1.5) * 1000));

    customers.push({ id: `C${String(i + 1).padStart(3, "0")}`, lat, lng, demand });
  }

  return customers;
}

export const CUSTOMERS: Customer[] = generateCustomers();

export const TOTAL_DEMAND = CUSTOMERS.reduce((s, c) => s + c.demand, 0);
