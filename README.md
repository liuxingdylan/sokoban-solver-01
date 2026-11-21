# Sokoban Solver — room-decomposed push-optimal A*

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/liuxingdylan/sokoban-solver-01/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/liuxingdylan/sokoban-solver-01/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

Solves every instance of a 5-level Sokoban set in as few pushes as possible
(push-optimal, P*), by splitting each level into its rooms and solving each
room on its own.

## How it works

Levels in this competition are a one-cell-wide hallway with 1–4 small rooms
opening off it through a single door each. A box pushed out through a door
can never be pushed back, so in an optimal solution no box ever leaves its
room — the rooms are independent problems whose push optima add up to the
level optimum.

1. **Parse** the XSB level (`#` wall, ` ` floor, `.` goal, `$` box,
   `*` box on goal, `@` player, `+` player on goal).
2. **Decompose**: the hallway is the maximal run of open cells in the
   player's row containing the player. Removing the hallway row splits the
   remaining floor into connected components; each component holding boxes
   is a room, and its door is the cell touching the hallway.
3. **Solve each room** with push-optimal A* over pushes only. A state is
   the sorted box cells plus the player cell; expansion flood-fills the
   player's reachable region and tries every legal push from it. The
   heuristic is the minimum-assignment sum of box-to-goal walking distances
   (BFS distances ignoring boxes, over all box/goal permutations), which is
   admissible and consistent — so the first goal state popped is
   push-optimal. Deadlock pruning drops states with a box on a cell from
   which no goal is reachable by reverse pulls, and states where a box lands
   in a frozen 2×2 block of walls/boxes. States are canonicalised by the
   lowest cell of the player's reachable region.
4. **Stitch**: walk the player along the hallway to each room's entry
   square (rooms in door-column order), append the room's moves, walk back
   out to the entry square, and continue. Walks are shortest-path BFS
   treating current boxes as obstacles.

**Fallbacks (never crash, always answer):** if a level does not decompose
into rooms, the same A* runs over the whole level with a fixed expansion
budget; if that fails too, an empty (valid, zero-point) solution is written.
All budgets are counted in state expansions — never wall-clock time, no
randomness, no clock reads — so two runs on the same input are
byte-identical.

## Run

```sh
# As the grader runs it (Node 22, type stripping handles the .ts file,
# which is written in pure JavaScript syntax):
node /bot/main.ts            # reads /input/<id>/level.txt, writes /output/<id>/solution.txt

# Locally:
mkdir -p out
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Score

Practice set (`grade-local --driver process`): **1,000,000** — all five
instances solved at P* (13, 16, 29, 47, 60 pushes), in ~0.4 s total for the
set, deterministic across runs. Three freshly generated sets (15 more
levels, drawn with the kit's own generator from different seeds) also all
score 1,000,000. See `BUILD-NOTES.md` in this repo for details.

No dependencies, no network, only `node:fs` and `node:path`. MIT licensed.

---

<sub>Entered on [make.fun](https://make.fun/?ref=zzj73w81&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
