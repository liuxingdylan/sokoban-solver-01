// Room-decomposed push-optimal Sokoban solver.
//
// Strategy: the levels this competition draws are a one-cell-wide hallway
// with 1-4 small rooms opening off it through a single door each, and no box
// can ever leave its room in an optimal solution (a box pushed out through a
// door can never be pushed back). So the level splits into independent
// per-room problems whose push optima add up to the level optimum. Each room
// is solved push-optimally with A* over pushes, then the per-room move
// strings are stitched together with hallway walks.
//
// The search itself: states are (sorted box cells, player cell); expansion
// is by pushes only, using a flood fill of the player's reachable region to
// find every legal push from a state. The heuristic is the minimum-assignment
// sum of box-to-goal walking distances (precomputed BFS distances ignoring
// boxes), which is admissible and consistent for push costs, so the first
// goal state popped from the priority queue is push-optimal. Deadlock
// pruning: a box on a cell from which no goal is reachable by reverse pulls
// (ignoring other boxes) can never be solved, and a box landing in a frozen
// 2x2 block of walls/boxes is pruned too. States are canonicalised by the
// lowest cell of the player's reachable region, so two states with the same
// boxes and the same reachable region collapse into one.
//
// Determinism: budgets are counted in state expansions, never wall-clock
// time; there is no randomness, no clock reads, and every tie is broken by
// fixed orders (direction order u, d, l, r, then insertion order). Two runs
// on the same input therefore produce byte-identical output.
//
// If a level does not decompose into rooms (unexpected shape), the solver
// falls back to the same A* over the whole level with a fixed expansion
// budget, and if that also fails it writes an empty (valid, zero-point)
// solution rather than crashing or writing nothing.
//
// Pure JavaScript syntax only (no TypeScript-only constructs), so Node 22's
// type stripping runs it as-is. Only node:fs and node:path are used.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Expansion budgets (work, never wall clock, so runs stay deterministic).
const ROOM_EXPANSION_LIMIT = 200000;
const WHOLE_LEVEL_EXPANSION_LIMIT = 400000;

const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const LETTER = ['u', 'd', 'l', 'r'];

// ---------------------------------------------------------------------------
// Level parsing (XSB: # wall, ' ' floor, . goal, $ box, * box on goal,
// @ player, + player on goal).
// ---------------------------------------------------------------------------

function parseLevel(text) {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals = [];
  const boxes = [];
  let player = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  }
  boxes.sort((a, b) => a - b);
  goals.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

// A board is just width/height plus a wall mask; a cell is floor iff wall==0.
function boardFromFloor(w, h, floorCells) {
  const wall = new Uint8Array(w * h).fill(1);
  for (const c of floorCells) wall[c] = 0;
  return { w, h, wall };
}

// One step from cell c in direction k (0=u,1=d,2=l,3=r); -1 if off the board.
function step(board, c, k) {
  const x = c % board.w;
  const y = (c / board.w) | 0;
  const nx = x + DX[k];
  const ny = y + DY[k];
  if (nx < 0 || ny < 0 || nx >= board.w || ny >= board.h) return -1;
  return ny * board.w + nx;
}

// ---------------------------------------------------------------------------
// Board searches: flood fill, BFS distances, shortest walk.
// ---------------------------------------------------------------------------

// Cells reachable from `from` without crossing walls or `occupied` boxes.
// Returns { seen: Uint8Array, low: lowest reachable cell index }.
function floodFill(board, occupied, from) {
  const seen = new Uint8Array(board.w * board.h);
  const stack = new Int32Array(board.w * board.h);
  let n = 0;
  let low = from;
  stack[n++] = from;
  seen[from] = 1;
  while (n > 0) {
    const p = stack[--n];
    if (p < low) low = p;
    for (let k = 0; k < 4; k++) {
      const q = step(board, p, k);
      if (q >= 0 && !board.wall[q] && !occupied[q] && !seen[q]) {
        seen[q] = 1;
        stack[n++] = q;
      }
    }
  }
  return { seen, low };
}

// Walking distance from `from` to every cell, ignoring boxes. -1 = unreachable.
function bfsDistances(board, from) {
  const dist = new Int32Array(board.w * board.h).fill(-1);
  const queue = new Int32Array(board.w * board.h);
  let head = 0;
  let tail = 0;
  queue[tail++] = from;
  dist[from] = 0;
  while (head < tail) {
    const p = queue[head++];
    for (let k = 0; k < 4; k++) {
      const q = step(board, p, k);
      if (q >= 0 && !board.wall[q] && dist[q] < 0) {
        dist[q] = dist[p] + 1;
        queue[tail++] = q;
      }
    }
  }
  return dist;
}

// Shortest walk from `from` to `to` around walls and `occupied` boxes,
// as a string of u/d/l/r, or null when unreachable. Direction order is
// fixed (u, d, l, r) so ties resolve identically every run.
function shortestWalk(board, occupied, from, to) {
  if (from === to) return '';
  const prev = new Int32Array(board.w * board.h).fill(-1);
  const how = new Int8Array(board.w * board.h);
  const queue = new Int32Array(board.w * board.h);
  let head = 0;
  let tail = 0;
  queue[tail++] = from;
  prev[from] = from;
  while (head < tail) {
    const p = queue[head++];
    if (p === to) break;
    for (let k = 0; k < 4; k++) {
      const q = step(board, p, k);
      if (q >= 0 && !board.wall[q] && !occupied[q] && prev[q] < 0) {
        prev[q] = p;
        how[q] = k;
        queue[tail++] = q;
      }
    }
  }
  if (prev[to] < 0) return null;
  let s = '';
  for (let p = to; p !== from; p = prev[p]) s = LETTER[how[p]] + s;
  return s;
}

// ---------------------------------------------------------------------------
// Deadlock analysis.
// ---------------------------------------------------------------------------

// live[c] = 1 when a lone box on c could still be pushed onto some goal.
// Computed by reverse pulls: a box on y can be pulled back from a live
// cell x = y + d provided the player could have stood at y - d.
function liveCells(board, goals) {
  const live = new Uint8Array(board.w * board.h);
  const queue = new Int32Array(board.w * board.h);
  let head = 0;
  let tail = 0;
  for (const g of goals) {
    live[g] = 1;
    queue[tail++] = g;
  }
  while (head < tail) {
    const x = queue[head++];
    for (let k = 0; k < 4; k++) {
      const y = step(board, x, k ^ 1); // cell the box is pulled back onto
      if (y < 0 || board.wall[y] || live[y]) continue;
      const stand = step(board, y, k ^ 1); // where the player stood
      if (stand < 0 || board.wall[stand]) continue;
      live[y] = 1;
      queue[tail++] = y;
    }
  }
  return live;
}

// True when the box just pushed onto `t` is stuck in a 2x2 block made of
// walls and boxes with at least one box off its goal.
function frozenBlock(board, occupied, goalSet, t) {
  const tx = t % board.w;
  const ty = (t / board.w) | 0;
  for (let ay = ty - 1; ay <= ty; ay++) {
    for (let ax = tx - 1; ax <= tx; ax++) {
      if (ax < 0 || ay < 0 || ax + 1 >= board.w || ay + 1 >= board.h) continue;
      const a = ay * board.w + ax;
      const b = a + 1;
      const c = a + board.w;
      const d = c + 1;
      const filled =
        (board.wall[a] || occupied[a]) &&
        (board.wall[b] || occupied[b]) &&
        (board.wall[c] || occupied[c]) &&
        (board.wall[d] || occupied[d]);
      if (!filled) continue;
      if (
        (occupied[a] && !goalSet[a]) ||
        (occupied[b] && !goalSet[b]) ||
        (occupied[c] && !goalSet[c]) ||
        (occupied[d] && !goalSet[d])
      ) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Binary heap (min-heap on [f, h, insertion order]) for A*.
// ---------------------------------------------------------------------------

function heapPush(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (compareItems(heap[parent], heap[i]) <= 0) break;
    const tmp = heap[parent];
    heap[parent] = heap[i];
    heap[i] = tmp;
    i = parent;
  }
}

function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < heap.length && compareItems(heap[left], heap[smallest]) < 0) smallest = left;
      if (right < heap.length && compareItems(heap[right], heap[smallest]) < 0) smallest = right;
      if (smallest === i) break;
      const tmp = heap[smallest];
      heap[smallest] = heap[i];
      heap[i] = tmp;
      i = smallest;
    }
  }
  return top;
}

function compareItems(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

// All permutations of 0..n-1, in lexicographic order (n <= 4 here).
function allPermutations(n) {
  const out = [];
  const cur = [];
  const used = new Uint8Array(n);
  const build = () => {
    if (cur.length === n) {
      out.push(cur.slice());
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = 1;
      cur.push(i);
      build();
      cur.pop();
      used[i] = 0;
    }
  };
  build();
  return out;
}

// ---------------------------------------------------------------------------
// Push-optimal A* over one board.
// Returns { pushes, moves } or null when the budget runs out / unsolvable.
// ---------------------------------------------------------------------------

function pushOptimalAStar(board, goals, boxes, player, maxExpansions) {
  const size = board.w * board.h;
  const n = boxes.length;
  const goalSet = new Uint8Array(size);
  for (const g of goals) goalSet[g] = 1;
  const solved = (bx) => {
    for (const b of bx) if (!goalSet[b]) return false;
    return true;
  };
  if (solved(boxes)) return { pushes: 0, moves: '' };

  const live = liveCells(board, goals);
  for (const b of boxes) if (!live[b]) return null;

  // Heuristic: minimum-assignment sum of box-to-goal walking distances.
  const distToGoal = goals.map((g) => bfsDistances(board, g));
  const perms = allPermutations(n);
  const heuristic = (bx) => {
    let best = Infinity;
    for (const p of perms) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const d = distToGoal[p[i]][bx[i]];
        if (d < 0) {
          sum = Infinity;
          break;
        }
        sum += d;
      }
      if (sum < best) best = sum;
    }
    return best;
  };

  const startBoxes = boxes.slice().sort((a, b) => a - b);
  const startH = heuristic(startBoxes);
  if (startH === Infinity) return null;

  // State storage. stPlayer[s] is where the player stands after the push
  // that created state s (the pushed box's old cell); stPushBox/stPushDir
  // record that push so moves can be rebuilt.
  const stBoxes = [startBoxes];
  const stPlayer = [player];
  const stParent = [-1];
  const stPushBox = [-1];
  const stPushDir = [-1];
  const stG = [0];

  const occupied = new Uint8Array(size);
  const keyOf = (bx, low) => bx.join(',') + '|' + low;

  const startOccupied = new Uint8Array(size);
  for (const b of startBoxes) startOccupied[b] = 1;
  const startLow = floodFill(board, startOccupied, player).low;
  const bestG = new Map();
  bestG.set(keyOf(startBoxes, startLow), 0);

  const heap = [];
  let seq = 0;
  heapPush(heap, [startH, startH, seq++, 0]);

  let expansions = 0;
  while (heap.length > 0) {
    const item = heapPop(heap);
    const s = item[3];
    if (solved(stBoxes[s])) {
      // Rebuild the move string from the state chain.
      const chain = [];
      for (let cur = s; cur > 0; cur = stParent[cur]) chain.push(cur);
      chain.reverse();
      let moves = '';
      let pos = player;
      let curBoxes = startBoxes;
      for (const ns of chain) {
        const boxCell = stPushBox[ns];
        const dir = stPushDir[ns];
        const from = step(board, boxCell, dir ^ 1);
        const occ = new Uint8Array(size);
        for (const b of curBoxes) occ[b] = 1;
        const walk = shortestWalk(board, occ, pos, from);
        if (walk === null) return null; // cannot happen for a generated push
        moves += walk + LETTER[dir];
        const nextBoxes = curBoxes.slice();
        nextBoxes[nextBoxes.indexOf(boxCell)] = step(board, boxCell, dir);
        nextBoxes.sort((a, b) => a - b);
        curBoxes = nextBoxes;
        pos = boxCell;
      }
      return { pushes: chain.length, moves };
    }
    if (++expansions > maxExpansions) return null;

    const bx = stBoxes[s];
    const g = stG[s];
    for (const b of bx) occupied[b] = 1;
    const region = floodFill(board, occupied, stPlayer[s]).seen;
    for (let bi = 0; bi < n; bi++) {
      const boxCell = bx[bi];
      for (let dir = 0; dir < 4; dir++) {
        const from = step(board, boxCell, dir ^ 1);
        const to = step(board, boxCell, dir);
        if (from < 0 || to < 0) continue;
        if (!region[from]) continue; // player cannot reach the push square
        if (board.wall[to] || occupied[to]) continue;
        if (!goalSet[to] && !live[to]) continue; // dead square
        occupied[boxCell] = 0;
        occupied[to] = 1;
        const frozen = frozenBlock(board, occupied, goalSet, to);
        let key = null;
        let nextBoxes = null;
        let low = -1;
        if (!frozen) {
          nextBoxes = bx.slice();
          nextBoxes[bi] = to;
          nextBoxes.sort((a, b) => a - b);
          low = floodFill(board, occupied, boxCell).low;
          key = keyOf(nextBoxes, low);
        }
        occupied[to] = 0;
        occupied[boxCell] = 1;
        if (frozen || key === null) continue;
        const ng = g + 1;
        const prevG = bestG.get(key);
        if (prevG !== undefined && prevG <= ng) continue;
        bestG.set(key, ng);
        const h = heuristic(nextBoxes);
        if (h === Infinity) continue;
        const idx = stBoxes.length;
        stBoxes.push(nextBoxes);
        stPlayer.push(boxCell);
        stParent.push(s);
        stPushBox.push(boxCell);
        stPushDir.push(dir);
        stG.push(ng);
        heapPush(heap, [ng + h, h, seq++, idx]);
      }
    }
    for (const b of bx) occupied[b] = 0;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Room decomposition.
// ---------------------------------------------------------------------------

// Split a level into its rooms. Returns null when the level is not a
// hallway-plus-rooms shape (caller falls back to a whole-level search).
// Each room: { floor, boxes, goals, door, entry } where `door` is the room
// cell touching the hallway and `entry` is the hallway cell beside it.
function decompose(level) {
  const { w, h, wall, goals, boxes, player } = level;
  const hallRow = (player / w) | 0;
  // The hallway: maximal run of open cells in the player's row containing
  // the player.
  const hallCells = [];
  const hallSet = new Uint8Array(w * h);
  const px = player % w;
  let x0 = px;
  while (x0 - 1 >= 0 && !wall[hallRow * w + x0 - 1]) x0--;
  let x1 = px;
  while (x1 + 1 < w && !wall[hallRow * w + x1 + 1]) x1++;
  for (let x = x0; x <= x1; x++) {
    const c = hallRow * w + x;
    hallCells.push(c);
    hallSet[c] = 1;
  }

  // Connected components of open cells outside the hallway row.
  const comp = new Int32Array(w * h).fill(-1);
  const components = [];
  for (let s = 0; s < w * h; s++) {
    if (wall[s] || (s / w | 0) === hallRow || comp[s] >= 0) continue;
    const cells = [s];
    comp[s] = components.length;
    for (let i = 0; i < cells.length; i++) {
      for (let k = 0; k < 4; k++) {
        const q = step({ w, h, wall }, cells[i], k);
        if (q < 0 || wall[q] || (q / w | 0) === hallRow || comp[q] >= 0) continue;
        comp[q] = components.length;
        cells.push(q);
      }
    }
    components.push(cells);
  }

  const rooms = [];
  const goalComp = new Int32Array(w * h).fill(-1);
  for (const g of goals) {
    if ((g / w | 0) === hallRow) return null; // a goal in the hallway: not a room level
    goalComp[g] = comp[g];
  }
  for (let ci = 0; ci < components.length; ci++) {
    const cells = components[ci];
    const roomBoxes = boxes.filter((b) => comp[b] === ci);
    const roomGoals = goals.filter((g) => comp[g] === ci);
    if (roomBoxes.length === 0) continue;
    if (roomBoxes.length !== roomGoals.length) return null;
    // The door: the room cell touching a hallway cell (exactly one, by spec).
    const doors = [];
    for (const c of cells) {
      for (let k = 0; k < 4; k++) {
        const q = step({ w, h, wall }, c, k);
        if (q >= 0 && hallSet[q]) {
          doors.push([c, q]);
          break;
        }
      }
    }
    if (doors.length === 0) return null;
    doors.sort((a, b) => a[0] - b[0]);
    rooms.push({
      floor: cells,
      boxes: roomBoxes,
      goals: roomGoals,
      door: doors[0][0],
      entry: doors[0][1],
    });
  }
  if (rooms.length === 0) return null;
  if (boxes.some((b) => comp[b] < 0)) return null; // a box outside every room
  rooms.sort((a, b) => (a.door % w) - (b.door % w) || a.door - b.door);
  return { rooms, hallCells, hallSet };
}

// Solve one level by rooms, stitching walks between them. Returns the move
// string, or null when any step fails.
function solveByRooms(level) {
  const parts = decompose(level);
  if (parts === null) return null;
  const { w, h, wall } = level;
  const hallBoard = boardFromFloor(w, h, parts.hallCells);

  let moves = '';
  let pos = level.player;
  for (const room of parts.rooms) {
    // Walk along the hallway to this room's entry square.
    const hallOcc = new Uint8Array(w * h);
    const toEntry = shortestWalk(hallBoard, hallOcc, pos, room.entry);
    if (toEntry === null) return null;
    moves += toEntry;
    pos = room.entry;

    // Solve the room on its own board: the room's cells plus the entry
    // square outside its door; the player starts on the entry square.
    const roomBoard = boardFromFloor(w, h, room.floor.concat([room.entry]));
    const solved = pushOptimalAStar(
      roomBoard,
      room.goals,
      room.boxes,
      room.entry,
      ROOM_EXPANSION_LIMIT,
    );
    if (solved === null) return null;
    moves += solved.moves;
    pos = endOfMove(w, room.entry, solved.moves);

    // Walk back out to the entry square (boxes now sit on the goals).
    const occ = new Uint8Array(w * h);
    for (const g of room.goals) occ[g] = 1;
    const out = shortestWalk(roomBoard, occ, pos, room.entry);
    if (out === null) return null;
    moves += out;
    pos = room.entry;
  }
  return moves;
}

// Player cell after playing `moves` (lowercase u/d/l/r) from `from`.
function endOfMove(w, from, moves) {
  let p = from;
  for (const ch of moves) {
    p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  }
  return p;
}

// ---------------------------------------------------------------------------
// Top level: room solve, whole-level fallback, empty solution as last resort.
// ---------------------------------------------------------------------------

function solveLevel(text) {
  const level = parseLevel(text);
  if (level.player < 0) return '';
  const byRooms = solveByRooms(level);
  if (byRooms !== null) return byRooms;
  const floor = [];
  for (let i = 0; i < level.w * level.h; i++) if (!level.wall[i]) floor.push(i);
  const wholeBoard = boardFromFloor(level.w, level.h, floor);
  const whole = pushOptimalAStar(
    wholeBoard,
    level.goals,
    level.boxes,
    level.player,
    WHOLE_LEVEL_EXPANSION_LIMIT,
  );
  if (whole !== null) return whole.moves;
  return '';
}

for (const id of readdirSync(INPUT_DIR).sort()) {
  let moves = '';
  try {
    moves = solveLevel(readFileSync(join(INPUT_DIR, id, 'level.txt'), 'utf8'));
  } catch {
    moves = '';
  }
  mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, id, 'solution.txt'), `${moves}\n`);
}
