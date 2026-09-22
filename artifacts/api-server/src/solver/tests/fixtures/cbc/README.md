# CBC termination-evidence fixtures (P0R.1 spike)

Captured against **PuLP 3.3.2**'s bundled CBC, macOS x64 build: `Version: 2.10.3`,
`Build Date: Dec 15 2019` (see the spike report for the Linux x64/arm64 binary
version check — Linux x64 is the same `2.10.3`/`Dec 15 2019` build; Linux
**arm64** is a different build, `2.10.10` — verify which architecture
production actually runs before trusting these fixtures as byte-for-byte
representative of the deployed binary; see report Section "PuLP + CBC
versions observed").

Every `<case>.log` is the **real, unmodified CBC log** (captured via
`PULP_CBC_CMD(logPath=...)`) for that terminal state, with only the
`command line - ...` line's machine-specific absolute paths replaced by
`<CBC_BIN>` / `<WORKDIR>/problem-pulp.<ext>` placeholders — every CBC-emitted
line (the actual evidence) is untouched.

Every `<case>.sol` is **only the first line** (the status header) of CBC's
real `.sol` file — `parse_cbc_termination` never reads past line 1, and the
full per-variable dump is 20KB-1.3MB of noise per case, not worth committing.

## Cases (all real CBC output, one real solve per case)

| file | real source | solutionStatus | terminationReason |
|---|---|---|---|
| `optimal_optimality_proven` | JADE forced-open ground truth (`test_jade.py::test_ground_truth_objective_and_facilities`) | optimal | optimality_proven |
| `optimal_lp_only` | transport-coal, singleSource=False (a pure LP — zero integer/binary variables, found during B2 when every model was actually routed through capture for the first time) | optimal | optimality_proven |
| `feasible_gap_limit` | p-median-brazil P=5 cap=20M gap=0.05 — the exact scenario the design spec's §1 cites as mis-classified today | feasible | gap_limit |
| `infeasible` | JADE forced-open exceeding P (`test_jade.py::test_forced_open_exceeds_p_infeasible`) | infeasible | infeasible |
| `infeasible_lp_relaxation` | synthetic trivial LP (`x >= 2` with `x`'s own upper bound `1`, no integer variables) | infeasible | infeasible |
| `infeasible_integer` | transport-coal, singleSource=True, gap=0.05 — a real degenerate MILP (~36s exhaustive search) whose LP relaxation is feasible but no integer-feasible solution exists (found during B2) | infeasible | infeasible |
| `no_solution_time_limit` | p-median-us P=10, `timeLimitSec=0.15` (too tight for even one incumbent) | no_solution | time_limit |
| `feasible_time_limit` | synthetic hard 2-constraint 0/1 knapsack (400 binaries, correlated value/weight), `timeLimit=0.05` | feasible | time_limit |
| `feasible_node_limit` | same synthetic knapsack, `maxNodes=5` | feasible | node_limit |
| `no_solution_node_limit` | same synthetic knapsack, `maxNodes=0` + heuristics disabled (`-heur off`) | no_solution | node_limit |
| `unbounded` | trivial synthetic LP: maximize an unbounded-above free variable, no constraints | unbounded | unbounded |

**Why synthetic fixtures for 3 of the 8:** this app's real teaching-scale
datasets (26 warehouses / 200 customers at the largest) solve to a *proven*
optimum in well under 0.2s — CBC's feasibility-pump heuristic finds and
proves the integer optimum before any deliberately-tight time/node limit can
land mid-search with an incumbent already present but the tree still open.
Reproducing `feasible/time_limit`, `feasible/node_limit`, and
`no_solution/node_limit` reliably needed a deliberately harder synthetic MIP
(a subset-sum-like multi-knapsack). `optimal_optimality_proven`,
`feasible_gap_limit`, `infeasible`, and `no_solution_time_limit` are all real
production-dataset solves.

## Real finding: CBC has (at least) two distinct infeasibility log shapes

`infeasible` (MIP-presolve infeasibility, a real 5226-binary-variable
problem) prints a **standalone** `Problem is infeasible - N seconds` line
with **no `Result -` line at all**. `infeasible_lp_relaxation` (a trivial
pure-LP infeasibility, no integer variables) instead prints **no**
standalone "Problem is infeasible" line, but **does** print `Result - Linear
relaxation infeasible`. Both real solves' `.sol` first token agrees
(`"Infeasible"`), but a parser checking only one of the two log shapes would
silently misclassify the other as "no Result line -> malformed" (or worse,
fall through to a wrong branch). `cbc_termination.py`'s `classify_cbc_termination`
checks for both.

## Real finding (B2): a THIRD infeasibility shape — `.sol` token `"Integer"`

`infeasible_integer` (a real transport-coal single-source solve) prints
`Result - Problem proven infeasible` in the log — a real MIP whose LP
relaxation is feasible but whose exhaustive branch-and-bound search proves
no integer-feasible point exists — with a `.sol` first token of `"Integer"`,
not `"Infeasible"`. PuLP's own `COIN_CMD.get_status()` already maps both
tokens identically to `LpStatusInfeasible`; before this fix,
`classify_cbc_termination` only recognized the `"Infeasible"` token and
raised a false "infeasibility signal mismatch" `CBCParseError` on this case
instead of classifying it correctly. Found when B2 first routed
`transport-coal`'s single-source case (a genuinely hard, ~36-second
degenerate MILP) through capture for the first time.

## Real finding (B2): a pure-LP optimum never prints a `Result -` line at all

`optimal_lp_only` (a real transport-coal multi-source solve, zero integer/
binary variables declared anywhere in the model) never enters CBC's
branch-and-bound layer, so it never prints a `Result -` trailer of any kind
— the log goes straight from presolve iterations to Clp's own `Optimal -
objective value X` / `Optimal objective X - N iterations time Y` pair. This
is distinct from `optimal_optimality_proven` (JADE), where presolve reduces
every *declared* integer/binary variable away but CBC still runs its full
MIP wrapper (and still prints `Result - Optimal solution found`) because the
model *declared* integer variables in the first place — the determining
factor is whether CBC was invoked in MIP mode at all, not whether any
integer variables survive presolve. Discovered when B2 first routed every
production model (not just JADE/Brazil/synthetic fixtures) through capture
— `transport-coal`'s default `singleSource=False` case is a genuine pure LP
and was previously untested by this module. `classify_cbc_termination` now
falls back to `_LP_ONLY_OPTIMAL_RE` only when no `Result -` line exists at
all (so a real MIP's classification is never affected).

## Not attainable / not captured in this spike

- `feasible/interrupted`, `no_solution/interrupted` — CBC has no log state
  for "I was killed"; a killed process either writes no terminal `Result -`
  line at all or is truncated mid-write. Classifying `interrupted` requires
  the **caller** (Node's process supervisor) to know it deliberately
  terminated CBC — this is the paired, out-of-scope Node process-group task,
  not something `parse_cbc_termination` can discover from log content alone.
- A genuine `Integer` first-token `.sol` case (present in PuLP's own
  `get_status()` mapping dict but never observed in any of ~40 exploratory
  solves run for this spike) — not fixture-backed; the parser treats an
  unrecognized `.sol` first token defensively (see `cbc_termination.py`).
