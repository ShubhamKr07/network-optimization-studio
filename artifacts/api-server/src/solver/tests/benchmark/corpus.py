# corpus.py
import json, math
from pathlib import Path
from dataclasses import dataclass

class ManifestError(ValueError):
    pass

MODEL_TYPES = {
    "p-median-us": "p_median", "p-median-brazil": "capacitated_pmedian",
    "transport-coal": "transport", "two-echelon-gold-au": "two_echelon",
    "two-echelon-jade-us": "two_echelon_jade", "chens-cosmetics-cn": "chens",
}

def _repo_root():
    p = Path(__file__).resolve()
    return next(parent for parent in p.parents
                if (parent / "pnpm-workspace.yaml").exists())

def _required_inputs(model_id):
    manifest = json.loads((_repo_root() / "solvers" / model_id / "manifest.json").read_text())
    # gap is supplied by Cell; modelType is the solve.py dispatcher field.
    return (set(manifest["inputsSchema"]["required"]) - {"gap"}) | {"modelType"}

@dataclass(frozen=True)
class Case:
    case_id: str
    inputs: dict
    generator_seed: int | None = None

    def case_key(self, cell) -> str:
        """L-R4: case_id is unique only WITHIN a cell, but objective deltas
        pair the same case ACROSS gaps. The pairing key therefore excludes
        gap and includes the stratum identity."""
        return f"{cell.model_id}|{cell.regime}|{cell.edit_family or '-'}|{self.case_id}"

@dataclass(frozen=True)
class Cell:
    model_id: str
    regime: str
    edit_family: str | None
    gap: float
    weight: float
    cases: tuple          # tuple[Case, ...] — MP-R1: a SET of distinct cases

    @property
    def key(self) -> str:
        return f"{self.model_id}|{self.regime}|{self.edit_family or '-'}|{self.gap}"

@dataclass(frozen=True)
class Manifest:
    version: int
    strata: list
    gaps: list

    def validate(self, min_cases_per_cell: int) -> None:
        """L-R1: a weights-only check is insufficient for an authoritative
        corpus. Full validation, all failures raising ManifestError."""
        weights = [s["weight"] for s in self.strata]
        if any(not isinstance(w, (int, float)) or not math.isfinite(w) for w in weights):
            raise ManifestError("weights must be finite numbers")
        if abs(sum(weights) - 1.0) >= 1e-9:
            raise ManifestError("stratum weights must sum to 1")
        if any(s["weight"] < 0 for s in self.strata):
            raise ManifestError("weights must be non-negative")
        if self.version != 1:
            raise ManifestError(f"unsupported manifest version: {self.version}")
        live = set(MODEL_TYPES)
        if any(not isinstance(g, (int, float)) or not math.isfinite(g) or
               g not in (0, 0.005, 0.01, 0.02) for g in self.gaps):
            raise ManifestError(f"gap outside the allowed set: {self.gaps}")
        for s in self.strata:
            if s["model_id"] not in live:
                raise ManifestError(f"unknown model_id: {s['model_id']}")
            required = _required_inputs(s["model_id"])
            for c in s["cases"]:
                missing = required - set(c["inputs"])
                if missing:
                    raise ManifestError(
                        f"{s['model_id']} case {c['case_id']} missing {sorted(missing)}")
                if c["inputs"]["modelType"] != MODEL_TYPES[s["model_id"]]:
                    raise ManifestError(
                        f"{s['model_id']} case {c['case_id']} has wrong modelType")
            if s["regime"] not in ("forced_open", "free_choice"):
                raise ManifestError(f"bad regime: {s['regime']}")
            if s.get("edit_family") not in (None, "demand", "capacity", "force", "distance"):
                raise ManifestError(f"bad edit_family: {s.get('edit_family')}")
            ids = [c["case_id"] for c in s["cases"]]
            if len(ids) != len(set(ids)):
                raise ManifestError(f"duplicate case_id in {s['model_id']}")
            if len(ids) < min_cases_per_cell:
                raise ManifestError(
                    f"{s['model_id']} has {len(ids)} cases; need at least "
                    f"{min_cases_per_cell} distinct cases")
        keys = [c.key for c in self.cells()]
        if len(keys) != len(set(keys)):
            raise ManifestError("duplicate cell key")

    def cells(self) -> list:
        return [
            # F-R14: float(g). A manifest written `gaps: [0, ...]` would
            # otherwise key the mandatory baseline as `...|0` while every
            # consumer looks up `...|0.0`, surfacing as "required stratum
            # missing" that reads like a corpus defect after a CSV round-trip.
            Cell(s["model_id"], s["regime"], s.get("edit_family"), float(g), s["weight"],
                 tuple(Case(c["case_id"], c["inputs"], c.get("generator_seed"))
                       for c in s["cases"]))
            for s in self.strata for g in self.gaps
        ]

def load_manifest(path: str, min_cases_per_cell: int = 1) -> Manifest:
    raw = json.loads(open(path).read())
    m = Manifest(raw["version"], raw["strata"], raw["gaps"])
    m.validate(min_cases_per_cell)
    return m
