# Sokoban solver — build notes

## Algorithm
- Room decomposition: hallway = maximal open run in the player's row;
  rooms = connected components of open cells after removing the hallway row;
  each room's door is its cell adjacent to the hallway. Rooms solved in
  door-column order, stitched with hallway walks and exit walks.
- Per room: push-optimal A* over pushes only (flood-fill reachable region
  per state), minimum-assignment box→goal BFS-distance heuristic
  (admissible + consistent, ≤4 boxes so ≤24 permutations), dead-cell
  pruning via reverse-pull reachability, frozen-2×2 pruning, states
  canonicalised by lowest reachable-region cell.
- Fallbacks: whole-level A* (400k-expansion budget) if decomposition fails;
  empty solution if that fails too. Never crashes, always writes a
  solution.txt per instance.
- Determinism: budgets by expansion count only; no clock, no randomness;
  fixed tie-break orders. Pure JS syntax inside main.ts (no TS-only
  constructs), only node:fs / node:path. Original code written for this
  entry (I/O skeleton shape only mirrors the kit starter).

## Practice grade-local
- Command: `node cli/makefun.mjs grade-local --kit . --bot <repo> --driver process`
- Score: **1,000,000** (5000/5000 points), passed=1, all 5 instances answered.
- Per-instance pushes (manifest P* in brackets): i001 13 [13], i002 16 [16],
  i003 29 [29], i004 47 [47], i005 60 [60].
- Runtime: ~0.35 s for the whole set locally (Node v24.22.1, this VM);
  grade-local total wall ~2.8 s including harness overhead. Limit is 60 s.
- Grader size: 20,966 bytes (code size v1; LICENSE counts 0 as unchanged
  starter file). Repo on disk 22,024 bytes total (main.ts + LICENSE + README.md).

## Determinism check
- Two direct runs on the practice set: outputs byte-identical (`diff -r` clean).
- Two direct runs on extra set k2: byte-identical.
- grade-local (runs the bot twice itself): "L1 regrade reproduced byte for byte".

## Extra-set robustness (kit generator, fresh seeds)
Generator driven directly: `node --experimental-strip-types
program/generator/draw.ts` with seed.json files whose seeds are
sha256("agent-fun/instance/practice/v1" || u32be(k) || practice-round
signature) for k=1,2,3 (same drand round 34141021 signature as practice,
different draw index → fresh levels from the kit's own generator).
- Set k1: P* 12/15/28/42/66 — all solved at P*, score 1,000,000, 0.37 s.
- Set k2: P* 16/15/29/45/61 — all solved at P*, score 1,000,000, 0.44 s.
- Set k3: P* 13/16/30/43/56 — all solved at P*, score 1,000,000, 0.32 s.
- Total: 15 extra levels, all at P*. Extra sets + seeds kept at
  `extra-sets/k{1,2,3}/` and `extra-seeds/k{1,2,3}/`.

## Not verified
- Not run under Docker / Node 22 (no Docker on this VM; local Node is
  v24.22.1, server runs Node 22.23.4). Code uses only node:fs/node:path and
  no TS-only syntax; also verified it runs under
  `node --experimental-strip-types` (Node 22.6–22.17 invocation).
- Not tested on levels outside the generator's shape (e.g. hand-made
  levels); the whole-level A* fallback exists for those but its optimality
  on arbitrary levels was not measured.
- Expansion budgets (200k/room, 400k whole-level) were never approached on
  any tested level, so worst-case runtime on a pathological unseen room is
  unmeasured — but the generator only keeps rooms its own 250k-state BFS
  solves, and A* with the assignment heuristic expands far fewer states
  than that BFS on every level tested.
- NOT submitted; no GitHub repo created; API key/keypair untouched. Repo
  left uncommitted at `repo/` for review.
