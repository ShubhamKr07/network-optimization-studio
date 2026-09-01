import { describe, expect, it } from "vitest";
import { GAZETTEER, lookupCity, nearestCity } from "../gazetteer";

describe("nearestCity", () => {
  it("finds Dallas, TX from a nearby point", () => {
    // Close enough to Dallas's real centroid (32.793333, -96.766513) to
    // clearly beat the dense DFW-metroplex suburbs (Richardson, Irving,
    // Garland, ...) also present in the gazetteer.
    expect(nearestCity(32.78, -96.8)).toMatchObject({ city: "Dallas", state: "TX" });
  });

  it("uses true haversine distance, not squared-degree distance", () => {
    // Egegik, AK and Dillingham, AK differ by ~0.855 lat / ~1.010 lng.
    // Query point Q sits at Egegik's latitude and Dillingham's longitude:
    // Egegik is ~1.0 deg away in longitude only, Dillingham ~0.86 deg away
    // in latitude only. Squared-degree distance favors Dillingham
    // (0.855^2 = 0.73 < 1.010^2 = 1.02), but at this high latitude (~58.6
    // deg N) a degree of longitude is worth far fewer real miles than a
    // degree of latitude (cos(58.6 deg) ~= 0.52), so the true nearest city
    // by great-circle miles is actually Egegik (~37 mi vs Dillingham's
    // ~59 mi) — this test would fail against a squared-degree implementation.
    const egegik = GAZETTEER.find((c) => c.city === "Egegik" && c.state === "AK");
    const dillingham = GAZETTEER.find((c) => c.city === "Dillingham" && c.state === "AK");
    expect(egegik).toBeDefined();
    expect(dillingham).toBeDefined();

    const result = nearestCity(egegik!.lat, dillingham!.lng);
    expect(result).toMatchObject({ city: "Egegik", state: "AK" });
  });
});

describe("lookupCity", () => {
  it("finds Dallas, TX case-insensitively", () => {
    expect(lookupCity("dallas", "tx")).toEqual({ lat: 32.793333, lng: -96.766513 });
  });

  it("returns null for an unknown city/state", () => {
    expect(lookupCity("Nowhere", "ZZ")).toBeNull();
  });
});
