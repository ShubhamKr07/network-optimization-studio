# cli.py
"""Entrypoint for the real measurement campaign: `python3 -m benchmark.cli run
--manifest <path> [...]`. This module is NOT exercised by the fast unit test
suite (M1.5 constraint: benchmark unit tests never run real solves) -- it is
the separate, deliberately-not-run-here CLI that a real campaign invokes.
"""
import argparse
import uuid

from benchmark.corpus import load_manifest
from benchmark.runner import run_campaign, run_determinism
from benchmark.stats import aggregate
from benchmark.report import write_raw, write_aggregates


def _find_cell(manifest, cell_key):
    for cell in manifest.cells():
        if cell.key == cell_key:
            return cell
    return None


def build_arg_parser():
    parser = argparse.ArgumentParser(prog="benchmark.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    run_p = sub.add_parser("run")
    run_p.add_argument("--manifest", required=True)
    run_p.add_argument("--min-cases", type=int, default=30)
    run_p.add_argument("--max-cases", type=int, default=200)
    run_p.add_argument("--ci-width", type=float, default=0.10)
    run_p.add_argument("--warmup", type=int, default=3)
    run_p.add_argument("--seed", type=int, default=0)
    run_p.add_argument("--out-dir", required=True)
    run_p.add_argument("--determinism-cell", default=None,
                       help="cell_key to also run run_determinism() on "
                            "(its first case); appended to raw CSV under the "
                            "same run_id, kind=determinism, excluded from "
                            "aggregates.")
    run_p.add_argument("--determinism-reps", type=int, default=30)
    return parser


def main(argv=None):
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if args.command == "run":
        run_id = str(uuid.uuid4())
        manifest = load_manifest(args.manifest, min_cases_per_cell=args.min_cases)
        observations = run_campaign(
            manifest, min_cases=args.min_cases, max_cases=args.max_cases,
            ci_width=args.ci_width, warmup=args.warmup, seed=args.seed)

        if args.determinism_cell:
            cell = _find_cell(manifest, args.determinism_cell)
            if cell is None:
                raise SystemExit(
                    f"--determinism-cell {args.determinism_cell!r} not found "
                    f"in manifest")
            observations = observations + run_determinism(
                cell, cell.cases[0], reps=args.determinism_reps)

        stats = aggregate(observations, min_cases=args.min_cases)

        raw_path = f"{args.out_dir}/benchmark-raw.csv"
        aggregates_path = f"{args.out_dir}/benchmark-aggregates.csv"
        write_raw(observations, raw_path, run_id=run_id)
        write_aggregates(stats, observations, manifest, aggregates_path, run_id=run_id)
        print(f"run_id={run_id}")
        print(f"raw={raw_path}")
        print(f"aggregates={aggregates_path}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
