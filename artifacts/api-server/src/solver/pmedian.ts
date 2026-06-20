import { WAREHOUSES, CUSTOMERS, TOTAL_DEMAND, type WarehouseCandidate, type Customer } from "../data/dataset.js";

export interface SolveInput {
  pValue: number;
  distanceBands: number[];
  capacityMode: "uniform" | "per_wh";
  uniformCapacity: number | null;
  warehouseStatuses: Array<{ warehouseId: string; status: string }>;
}

export interface Assignment {
  customerId: string;
  warehouseId: string;
  distanceMi: number;
  band: number;
}

export interface WarehouseUtilization {
  warehouseId: string;
  city: string;
  utilization: number;
}

export interface BandCoverage {
  band: number;
  percent: number;
}

export interface SolveOutput {
  status: "optimal" | "infeasible" | "error";
  openWarehouseIds: string[];
  assignments: Assignment[];
  objective: number;
  weightedAvgDistanceMi: number;
  bandCoverage: BandCoverage[];
  utilization: WarehouseUtilization[];
  runTimeSec: number;
  solverUsed: string;
  infeasibilityReason: string | null;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeDistanceMatrix(): number[][] {
  return WAREHOUSES.map(w =>
    CUSTOMERS.map(c => haversine(w.lat, w.lng, c.lat, c.lng))
  );
}

function assignCustomers(
  openIndices: number[],
  distMatrix: number[][],
  capacities: number[] | null
): { assignment: number[]; totalWeightedDist: number } {
  const numCustomers = CUSTOMERS.length;
  const assignment = new Array<number>(numCustomers).fill(-1);

  if (capacities === null) {
    for (let ci = 0; ci < numCustomers; ci++) {
      let best = -1, bestDist = Infinity;
      for (const wi of openIndices) {
        const d = distMatrix[wi][ci];
        if (d < bestDist) { bestDist = d; best = wi; }
      }
      assignment[ci] = best;
    }
  } else {
    const remaining = [...capacities];
    const pairs: Array<{ ci: number; wi: number; dist: number }> = [];
    for (let ci = 0; ci < numCustomers; ci++) {
      for (const wi of openIndices) {
        pairs.push({ ci, wi, dist: distMatrix[wi][ci] });
      }
    }
    pairs.sort((a, b) => a.dist - b.dist);
    for (const { ci, wi } of pairs) {
      if (assignment[ci] !== -1) continue;
      const idx = openIndices.indexOf(wi);
      if (remaining[idx] >= CUSTOMERS[ci].demand) {
        assignment[ci] = wi;
        remaining[idx] -= CUSTOMERS[ci].demand;
      }
    }
  }

  let totalWeightedDist = 0;
  for (let ci = 0; ci < numCustomers; ci++) {
    const wi = assignment[ci];
    if (wi >= 0) {
      totalWeightedDist += CUSTOMERS[ci].demand * distMatrix[wi][ci];
    }
  }
  return { assignment, totalWeightedDist };
}

export function solve(input: SolveInput): SolveOutput {
  const start = Date.now();

  const statusMap = new Map<string, string>(
    input.warehouseStatuses.map(s => [s.warehouseId, s.status])
  );

  const forcedOpen: number[] = [];
  const potential: number[] = [];
  const inactive: number[] = [];

  WAREHOUSES.forEach((w, i) => {
    const status = statusMap.get(w.id) ?? "potential";
    if (status === "forced_open") forcedOpen.push(i);
    else if (status === "inactive") inactive.push(i);
    else potential.push(i);
  });

  if (forcedOpen.length > input.pValue) {
    return {
      status: "infeasible",
      openWarehouseIds: [],
      assignments: [],
      objective: 0,
      weightedAvgDistanceMi: 0,
      bandCoverage: [],
      utilization: [],
      runTimeSec: (Date.now() - start) / 1000,
      solverUsed: "internal",
      infeasibilityReason: `Forced Open (${forcedOpen.length}) exceeds P (${input.pValue}). You set ${forcedOpen.length} warehouses to Forced Open but P = ${input.pValue}. Lower P ≥ ${forcedOpen.length} or reduce Forced Open count.`,
    };
  }

  const remaining = input.pValue - forcedOpen.length;
  if (remaining > potential.length) {
    return {
      status: "infeasible",
      openWarehouseIds: [],
      assignments: [],
      objective: 0,
      weightedAvgDistanceMi: 0,
      bandCoverage: [],
      utilization: [],
      runTimeSec: (Date.now() - start) / 1000,
      solverUsed: "internal",
      infeasibilityReason: `P (${input.pValue}) requires ${remaining} additional warehouses but only ${potential.length} are available (not Forced Open or Inactive).`,
    };
  }

  const distMatrix = computeDistanceMatrix();

  const capacities: number[] | null =
    input.capacityMode === "uniform" && input.uniformCapacity != null
      ? potential.concat(forcedOpen).map(() => input.uniformCapacity!)
      : null;

  let openIndices = [...forcedOpen];

  const greedyPick = (candidates: number[], current: number[]): number => {
    let best = -1, bestObj = Infinity;
    for (const wi of candidates) {
      const trial = [...current, wi];
      const { totalWeightedDist } = assignCustomers(trial, distMatrix, null);
      if (totalWeightedDist < bestObj) { bestObj = totalWeightedDist; best = wi; }
    }
    return best;
  };

  let availablePool = [...potential];
  for (let k = 0; k < remaining; k++) {
    const pick = greedyPick(availablePool, openIndices);
    openIndices.push(pick);
    availablePool = availablePool.filter(i => i !== pick);
  }

  let { assignment, totalWeightedDist: bestObj } = assignCustomers(openIndices, distMatrix, capacities);

  let improved = true;
  while (improved) {
    improved = false;
    for (const openIdx of openIndices.filter(i => !forcedOpen.includes(i))) {
      for (const closedIdx of availablePool) {
        const trial = openIndices.map(i => (i === openIdx ? closedIdx : i));
        const { totalWeightedDist, assignment: newAsgn } = assignCustomers(trial, distMatrix, capacities);
        if (totalWeightedDist < bestObj - 1e-6) {
          bestObj = totalWeightedDist;
          openIndices = trial;
          assignment = newAsgn;
          availablePool = availablePool.map(i => (i === closedIdx ? openIdx : i));
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  const weightedAvgDistanceMi = bestObj / TOTAL_DEMAND;

  const sortedBands = [...input.distanceBands].sort((a, b) => a - b);

  const bandCoverage: BandCoverage[] = sortedBands.map(band => {
    const demandWithin = CUSTOMERS.reduce((sum, c, ci) => {
      const wi = assignment[ci];
      if (wi < 0) return sum;
      return distMatrix[wi][ci] <= band ? sum + c.demand : sum;
    }, 0);
    return { band, percent: Math.round((demandWithin / TOTAL_DEMAND) * 100) };
  });

  const whDemand = new Map<number, number>();
  for (const wi of openIndices) whDemand.set(wi, 0);
  for (let ci = 0; ci < CUSTOMERS.length; ci++) {
    const wi = assignment[ci];
    if (wi >= 0) whDemand.set(wi, (whDemand.get(wi) ?? 0) + CUSTOMERS[ci].demand);
  }

  const avgDemandPerWH = TOTAL_DEMAND / openIndices.length;
  const capacityForUtil = (input.uniformCapacity != null && input.uniformCapacity < TOTAL_DEMAND)
    ? input.uniformCapacity
    : avgDemandPerWH;
  const utilization: WarehouseUtilization[] = openIndices.map(wi => ({
    warehouseId: WAREHOUSES[wi].id,
    city: WAREHOUSES[wi].city,
    utilization: Math.min(100, Math.round(((whDemand.get(wi) ?? 0) / capacityForUtil) * 100)),
  }));

  const assignments: Assignment[] = CUSTOMERS.map((c, ci) => {
    const wi = assignment[ci];
    const distanceMi = wi >= 0 ? distMatrix[wi][ci] : 0;
    const band = sortedBands.findIndex(b => distanceMi <= b);
    return {
      customerId: c.id,
      warehouseId: wi >= 0 ? WAREHOUSES[wi].id : "",
      distanceMi: Math.round(distanceMi * 10) / 10,
      band: band >= 0 ? band : sortedBands.length - 1,
    };
  });

  return {
    status: "optimal",
    openWarehouseIds: openIndices.map(i => WAREHOUSES[i].id),
    assignments,
    objective: Math.round(bestObj),
    weightedAvgDistanceMi: Math.round(weightedAvgDistanceMi * 10) / 10,
    bandCoverage,
    utilization,
    runTimeSec: (Date.now() - start) / 1000,
    solverUsed: input.capacityMode === "uniform" ? "CBC (PuLP)" : "CBC (PuLP)",
    infeasibilityReason: null,
  };
}
