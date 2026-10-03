import {
  Anvil,
  ArrowRightLeft,
  BarChart3,
  Circle,
  CircleDollarSign,
  ClipboardList,
  DoorOpen,
  Factory,
  FolderOpen,
  Grid3x3,
  // Aliased: a bare `Map` import shadows the global Map constructor in a module
  // that is a natural place to later write `new Map()`.
  Map as MapIcon,
  MapPinned,
  Pickaxe,
  Route,
  Ruler,
  SlidersHorizontal,
  Truck,
  Users,
  Warehouse,
  Waypoints,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Sidebar entity id -> icon. Ids come from inputEntriesForModel() and
 * OUTPUT_ENTRIES in Workspace.tsx. Icons are unique across the WHOLE set, not
 * merely within one model's list, so two chapters never share a glyph for
 * different concepts (entityIcons.test.ts enforces this).
 *
 * Four of these are deliberately not the obvious pick, because the obvious
 * pick misleads a student (spec 2026-10-03 §4.6):
 *  - cost-summary's LABEL is "Solution Summary", and for max-coverage-us the
 *    objective is covered demand, not cost — a receipt would be wrong there.
 *  - customer-assignments is a customer->warehouse mapping; Link2 is the
 *    universal hyperlink glyph.
 *  - refineries: FlaskConical reads "lab/experiment" in an app whose pages are
 *    titled "... Model Lab"; a gold refinery is an industrial processing node.
 *  - open-warehouses: PackageCheck reads "parcel delivered", not "facility open".
 */
const ENTITY_ICONS: Record<string, LucideIcon> = {
  // inputs
  "input-map": MapIcon,
  customers: Users,
  warehouses: Warehouse,
  distances: Ruler,
  "optimization-parameters": SlidersHorizontal,
  deliveryCosts: Truck,
  mines: Pickaxe,
  stations: Zap,
  laneCosts: Route,
  refineries: Anvil,
  plants: Factory,
  "capability-matrix": Grid3x3,
  transportCosts: CircleDollarSign,
  // outputs
  "output-map": MapPinned,
  "cost-summary": ClipboardList,
  "open-warehouses": DoorOpen,
  "customer-assignments": ArrowRightLeft,
  flows: Waypoints,
  "service-stats": BarChart3,
};

/**
 * The Scenarios section's rail icon. FolderOpen rather than Layers: the Input
 * Map tab already has a UI concept called the Layers row (Workspace.tsx's
 * saveInLayersRow*), and two unrelated "layers" on one screen is a teaching
 * hazard.
 */
export const SCENARIOS_ICON: LucideIcon = FolderOpen;

/** Every mapped id, for the uniqueness test. */
export const ENTITY_ICON_IDS: string[] = Object.keys(ENTITY_ICONS);

/**
 * A future sidebar entry with no mapping renders a generic dot rather than
 * crashing the rail.
 */
export function iconForEntity(id: string): LucideIcon {
  return ENTITY_ICONS[id] ?? Circle;
}
