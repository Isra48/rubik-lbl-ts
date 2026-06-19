import type { FaceletState, Move } from '../types';

import { CROSS_PDB_B64, LL_TABLE_B64 } from './beginnerTables.generated';
import { applyMove as faceletApplyMove } from '../moveEngine';

/**
 * Decodes a base64 string into an Int8Array (pure JS — atob is not reliable on
 * Hermes). Used to load the precomputed solver tables instantly instead of
 * rebuilding them at runtime (the build froze the JS thread for seconds).
 */
const B64_LOOKUP = (() => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const table = new Uint8Array(128);
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  return table;
})();

function decodeInt8(base64: string): Int8Array {
  const clean = base64.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)];
    const b = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c = i + 2 < clean.length ? B64_LOOKUP[clean.charCodeAt(i + 2)] : 0;
    const d = i + 3 < clean.length ? B64_LOOKUP[clean.charCodeAt(i + 3)] : 0;
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) out[o++] = ((c & 3) << 6) | d;
  }
  return new Int8Array(out.buffer, out.byteOffset, out.byteLength);
}

/**
 * Beginner (Layer-by-Layer) cube solver.
 *
 * Produces the classic LBL stages, each with the move list the learner still
 * needs to apply. The bottom (D) layer is treated as the first layer, and the
 * top (U) layer as the last layer.
 *
 * Strategy:
 *  - Stages 1-3 (cross, first-layer corners, middle edges) are solved with a
 *    PDB-guided IDA* over the 18 face moves. The pattern databases give exact
 *    distances for each piece subset, so the searches are shallow and fast.
 *  - Stages 4-6 (LL edge orientation, LL edge permutation, LL corner position)
 *    are solved with a small breadth-first search over a handful of
 *    F2L-preserving algorithms ("macros") plus U setup turns.
 *  - Stage 7 (LL corner orientation) uses the classic R' D' R D method.
 *
 * Everything is computed on a fast cubie model (permutation + orientation
 * arrays). The cubie move tables are *derived* from the real facelet engine at
 * module load, so they cannot drift from ground truth. The emitted moves are
 * plain face-move notation and are validated end-to-end by the test suite.
 */

export interface BeginnerStage {
  key: string;
  label: string;
  moves: Move[];
}

const SOLVED_FACELET =
  'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

/* ------------------------------------------------------------------ */
/* Cubie model                                                         */
/* ------------------------------------------------------------------ */

// Edge slots (0..11). Each entry lists the two facelet indices; the first is
// the "primary" sticker used as the orientation reference.
// 0 UF 1 UR 2 UB 3 UL 4 DF 5 DR 6 DB 7 DL 8 FR 9 FL 10 BR 11 BL
const EDGE_FACELETS: readonly (readonly [number, number])[] = [
  [7, 19], // UF
  [5, 10], // UR
  [1, 46], // UB
  [3, 37], // UL
  [28, 25], // DF
  [32, 16], // DR
  [34, 52], // DB
  [30, 43], // DL
  [23, 12], // FR
  [21, 41], // FL
  [48, 14], // BR
  [50, 39], // BL
];

// Corner slots (0..7). First facelet index is the primary (orientation ref).
// 0 UFR 1 UFL 2 UBR 3 UBL 4 DFR 5 DFL 6 DBR 7 DBL
const CORNER_FACELETS: readonly (readonly [number, number, number])[] = [
  [8, 9, 20], // UFR
  [6, 18, 38], // UFL
  [2, 45, 11], // UBR
  [0, 36, 47], // UBL
  [29, 26, 15], // DFR
  [27, 44, 24], // DFL (sides swapped for consistent corner-twist chirality)
  [35, 17, 51], // DBR
  [33, 53, 42], // DBL
];

const EDGE_LETTERS: readonly (readonly [string, string])[] = EDGE_FACELETS.map(
  ([a, b]) => [SOLVED_FACELET[a], SOLVED_FACELET[b]] as const,
);
const CORNER_LETTERS: readonly (readonly [string, string, string])[] =
  CORNER_FACELETS.map(
    ([a, b, c]) =>
      [SOLVED_FACELET[a], SOLVED_FACELET[b], SOLVED_FACELET[c]] as const,
  );

interface Cubie {
  ep: number[]; // ep[slot] = edge piece currently at slot
  eo: number[]; // edge orientation (0/1) at slot
  cp: number[]; // cp[slot] = corner piece at slot
  co: number[]; // corner orientation (0/1/2) at slot
}

function findEdgePiece(a: string, b: string): number {
  for (let p = 0; p < 12; p++) {
    const [la, lb] = EDGE_LETTERS[p];
    if ((la === a && lb === b) || (la === b && lb === a)) return p;
  }
  throw new Error(`Arista desconocida: ${a}${b}`);
}

function findCornerPiece(a: string, b: string, c: string): number {
  for (let p = 0; p < 8; p++) {
    const set = CORNER_LETTERS[p];
    if (
      set.includes(a) &&
      set.includes(b) &&
      set.includes(c) &&
      a !== b &&
      b !== c &&
      a !== c
    ) {
      return p;
    }
  }
  throw new Error(`Esquina desconocida: ${a}${b}${c}`);
}

function faceletToCubie(state: FaceletState): Cubie {
  const ep = new Array<number>(12);
  const eo = new Array<number>(12);
  const cp = new Array<number>(8);
  const co = new Array<number>(8);

  for (let s = 0; s < 12; s++) {
    const [i0, i1] = EDGE_FACELETS[s];
    const a = state[i0];
    const b = state[i1];
    const piece = findEdgePiece(a, b);
    ep[s] = piece;
    eo[s] = a === EDGE_LETTERS[piece][0] ? 0 : 1;
  }
  for (let s = 0; s < 8; s++) {
    const [i0, i1, i2] = CORNER_FACELETS[s];
    const a = state[i0];
    const b = state[i1];
    const c = state[i2];
    const piece = findCornerPiece(a, b, c);
    cp[s] = piece;
    const primary = CORNER_LETTERS[piece][0];
    co[s] = a === primary ? 0 : b === primary ? 1 : 2;
  }
  return { ep, eo, cp, co };
}

/* ------------------------------------------------------------------ */
/* Move tables (derived from the facelet engine)                        */
/* ------------------------------------------------------------------ */

interface MoveTable {
  eFrom: number[]; // eFrom[dest] = source slot feeding dest
  eOAdd: number[]; // edge orientation added at dest
  cFrom: number[];
  cOAdd: number[];
}

function deriveBaseTable(base: string): MoveTable {
  const after = faceletApplyMove(SOLVED_FACELET, base);
  const c = faceletToCubie(after);
  // From solved, the piece now at slot d came from slot c.ep[d]; the
  // orientation it shows is the delta the move adds at slot d.
  return {
    eFrom: c.ep.slice(),
    eOAdd: c.eo.slice(),
    cFrom: c.cp.slice(),
    cOAdd: c.co.slice(),
  };
}

// Compose: apply table A then table B.
function compose(a: MoveTable, b: MoveTable): MoveTable {
  const eFrom = new Array<number>(12);
  const eOAdd = new Array<number>(12);
  const cFrom = new Array<number>(8);
  const cOAdd = new Array<number>(8);
  for (let d = 0; d < 12; d++) {
    const mid = b.eFrom[d];
    eFrom[d] = a.eFrom[mid];
    eOAdd[d] = (a.eOAdd[mid] + b.eOAdd[d]) % 2;
  }
  for (let d = 0; d < 8; d++) {
    const mid = b.cFrom[d];
    cFrom[d] = a.cFrom[mid];
    cOAdd[d] = (a.cOAdd[mid] + b.cOAdd[d]) % 3;
  }
  return { eFrom, eOAdd, cFrom, cOAdd };
}

const BASE_FACES = ['U', 'R', 'F', 'D', 'L', 'B'] as const;

const MOVE_TABLES: Record<string, MoveTable> = (() => {
  const map: Record<string, MoveTable> = {};
  for (const face of BASE_FACES) {
    const t1 = deriveBaseTable(face);
    const t2 = compose(t1, t1);
    const t3 = compose(t2, t1);
    map[face] = t1;
    map[`${face}2`] = t2;
    map[`${face}'`] = t3;
  }
  return map;
})();

// All 18 face moves, in a search-friendly order.
const ALL_MOVES: Move[] = (() => {
  const out: Move[] = [];
  for (const face of BASE_FACES) {
    out.push(face, `${face}2`, `${face}'`);
  }
  return out;
})();

function applyTable(c: Cubie, t: MoveTable): Cubie {
  const ep = new Array<number>(12);
  const eo = new Array<number>(12);
  const cp = new Array<number>(8);
  const co = new Array<number>(8);
  for (let d = 0; d < 12; d++) {
    const s = t.eFrom[d];
    ep[d] = c.ep[s];
    eo[d] = (c.eo[s] + t.eOAdd[d]) % 2;
  }
  for (let d = 0; d < 8; d++) {
    const s = t.cFrom[d];
    cp[d] = c.cp[s];
    co[d] = (c.co[s] + t.cOAdd[d]) % 3;
  }
  return { ep, eo, cp, co };
}

function applyMoveCubie(c: Cubie, move: Move): Cubie {
  return applyTable(c, MOVE_TABLES[move]);
}

function applyMovesCubie(c: Cubie, moves: Move[]): Cubie {
  let cur = c;
  for (const m of moves) cur = applyMoveCubie(cur, m);
  return cur;
}

/* ------------------------------------------------------------------ */
/* Pattern databases                                                    */
/* ------------------------------------------------------------------ */

// Precomputed forward maps for coordinate BFS: where each slot's piece goes
// under each move, and the orientation added there.
interface CoordMove {
  eTo: number[]; // eTo[s] = dest slot for a piece at slot s
  eToAdd: number[]; // orientation added when moving from slot s
  cTo: number[];
  cToAdd: number[];
}

const COORD_MOVES: CoordMove[] = ALL_MOVES.map((m) => {
  const t = MOVE_TABLES[m];
  const eTo = new Array<number>(12);
  const eToAdd = new Array<number>(12);
  const cTo = new Array<number>(8);
  const cToAdd = new Array<number>(8);
  for (let d = 0; d < 12; d++) {
    eTo[t.eFrom[d]] = d;
    eToAdd[t.eFrom[d]] = t.eOAdd[d];
  }
  for (let d = 0; d < 8; d++) {
    cTo[t.cFrom[d]] = d;
    cToAdd[t.cFrom[d]] = t.cOAdd[d];
  }
  return { eTo, eToAdd, cTo, cToAdd };
});

type Pdb = Int8Array;

function buildEdgePdb(pieces: number[]): Pdb {
  // index = positions (base 12) then orientations (base 2) of `pieces`.
  const k = pieces.length;
  const oriSpan = 1 << k;
  const size = 12 ** k * oriSpan;
  const dist = new Int8Array(size).fill(-1);

  const encode = (pos: number[], ori: number[]): number => {
    let idx = 0;
    for (let i = 0; i < k; i++) idx = idx * 12 + pos[i];
    for (let i = 0; i < k; i++) idx = idx * 2 + ori[i];
    return idx;
  };

  const startPos = pieces.slice();
  const startOri = new Array<number>(k).fill(0);
  const startIdx = encode(startPos, startOri);
  dist[startIdx] = 0;

  // BFS frontier stored as encoded indices; decode on expand.
  let frontier = [startIdx];
  let depth = 0;
  while (frontier.length) {
    const next: number[] = [];
    for (const idx of frontier) {
      // decode
      let rem = idx;
      const ori = new Array<number>(k);
      for (let i = k - 1; i >= 0; i--) {
        ori[i] = rem & 1;
        rem >>= 1;
      }
      const pos = new Array<number>(k);
      for (let i = k - 1; i >= 0; i--) {
        pos[i] = rem % 12;
        rem = Math.floor(rem / 12);
      }
      for (const cm of COORD_MOVES) {
        const nPos = new Array<number>(k);
        const nOri = new Array<number>(k);
        for (let i = 0; i < k; i++) {
          const s = pos[i];
          nPos[i] = cm.eTo[s];
          nOri[i] = (ori[i] + cm.eToAdd[s]) % 2;
        }
        const nIdx = encode(nPos, nOri);
        if (dist[nIdx] === -1) {
          dist[nIdx] = depth + 1;
          next.push(nIdx);
        }
      }
    }
    frontier = next;
    depth++;
  }
  return dist;
}


// Lazily-built databases (built once, cached for the process lifetime).
let PDB_CROSS: Pdb | null = null;

const CROSS_EDGES = [4, 5, 6, 7]; // DF DR DB DL
const DCORNERS = [4, 5, 6, 7]; // DFR DFL DBR DBL
const MIDDLE_EDGES = [8, 9, 10, 11]; // FR FL BR BL
const U_EDGES = [0, 1, 2, 3]; // UF UR UB UL
const U_CORNERS = [0, 1, 2, 3]; // UFR UFL UBR UBL

function ensurePdbs(): void {
  // Load the precomputed table (instant) instead of rebuilding it; fall back to
  // building only if the bundled table is somehow missing.
  if (!PDB_CROSS) PDB_CROSS = CROSS_PDB_B64 ? decodeInt8(CROSS_PDB_B64) : buildEdgePdb(CROSS_EDGES);
}

function posOfEdges(c: Cubie, pieces: number[]): { pos: number[]; ori: number[] } {
  const pos = new Array<number>(pieces.length);
  const ori = new Array<number>(pieces.length);
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const slot = c.ep.indexOf(p);
    pos[i] = slot;
    ori[i] = c.eo[slot];
  }
  return { pos, ori };
}

function edgePdbValue(pdb: Pdb, c: Cubie, pieces: number[]): number {
  const { pos, ori } = posOfEdges(c, pieces);
  let idx = 0;
  for (let i = 0; i < pieces.length; i++) idx = idx * 12 + pos[i];
  for (let i = 0; i < pieces.length; i++) idx = idx * 2 + ori[i];
  return pdb[idx];
}

/* ------------------------------------------------------------------ */
/* Goal predicates                                                      */
/* ------------------------------------------------------------------ */

function edgesSolved(c: Cubie, slots: number[]): boolean {
  for (const s of slots) {
    if (c.ep[s] !== s || c.eo[s] !== 0) return false;
  }
  return true;
}

function cornersSolved(c: Cubie, slots: number[]): boolean {
  for (const s of slots) {
    if (c.cp[s] !== s || c.co[s] !== 0) return false;
  }
  return true;
}

const isCross = (c: Cubie) => edgesSolved(c, CROSS_EDGES);
const isF1 = (c: Cubie) => isCross(c) && cornersSolved(c, DCORNERS);
const isF2L = (c: Cubie) => isF1(c) && edgesSolved(c, MIDDLE_EDGES);

const isLLEdgesOriented = (c: Cubie) =>
  isF2L(c) && c.eo[0] === 0 && c.eo[1] === 0 && c.eo[2] === 0 && c.eo[3] === 0;
const isLLEdgesSolved = (c: Cubie) => isF2L(c) && edgesSolved(c, U_EDGES);
const isLLCornersPositioned = (c: Cubie) =>
  isLLEdgesSolved(c) && U_CORNERS.every((s) => c.cp[s] === s);
const isSolvedCubie = (c: Cubie) =>
  edgesSolved(c, [...CROSS_EDGES, ...MIDDLE_EDGES, ...U_EDGES]) &&
  cornersSolved(c, [...DCORNERS, ...U_CORNERS]);

/* ------------------------------------------------------------------ */
/* IDA* for the first two layers                                        */
/* ------------------------------------------------------------------ */

const FACE_OF: Record<string, string> = {};
for (const m of ALL_MOVES) FACE_OF[m] = m[0];
// Opposite faces, to prune commuting redundancy (only allow one order).
const OPPOSITE: Record<string, string> = {
  U: 'D',
  D: 'U',
  R: 'L',
  L: 'R',
  F: 'B',
  B: 'F',
};

function idaStar(
  start: Cubie,
  goal: (c: Cubie) => boolean,
  heuristic: (c: Cubie) => number,
): Move[] {
  if (goal(start)) return [];
  let bound = heuristic(start);
  const path: Move[] = [];

  // Returns true if solved; mutates `path`. nextBound captured via closure.
  let nextBound = Infinity;

  const dfs = (c: Cubie, g: number, prevFace: string, prevPrevFace: string): boolean => {
    const h = heuristic(c);
    const f = g + h;
    if (f > bound) {
      if (f < nextBound) nextBound = f;
      return false;
    }
    if (goal(c)) return true;
    for (const m of ALL_MOVES) {
      const face = FACE_OF[m];
      if (face === prevFace) continue;
      // Skip B after F if they commute, to avoid exploring both orders.
      if (OPPOSITE[face] === prevFace && face > prevFace) continue;
      if (OPPOSITE[face] === prevPrevFace && face === prevFace) continue; // unreachable but safe
      const nc = applyMoveCubie(c, m);
      path.push(m);
      if (dfs(nc, g + 1, face, prevFace)) return true;
      path.pop();
    }
    return false;
  };

  while (bound < 40) {
    nextBound = Infinity;
    if (dfs(start, 0, '', '')) return path.slice();
    if (nextBound === Infinity) break;
    bound = nextBound;
  }
  throw new Error('IDA* no encontró solución (no debería pasar)');
}

function hCross(c: Cubie): number {
  return edgePdbValue(PDB_CROSS!, c, CROSS_EDGES);
}

/* ------------------------------------------------------------------ */
/* Last-layer macros + BFS                                              */
/* ------------------------------------------------------------------ */

const parse = (s: string): Move[] => s.trim().split(/\s+/);

// OLL edges (yellow cross): F R U R' U' F'
const OLL_EDGE = parse("F R U R' U' F'");
// Edge 3-cycle (Ua-perm), pure edges.
const EDGE_3CYCLE = parse("R U' R U R U R U' R' U' R2");
// T-perm: swaps two edges (and two corners) — gives edge-parity flexibility.
const T_PERM = parse("R U R' U' R' F R2 U' R' U' R U R' F'");
// Corner 3-cycle (Aa-perm), preserves edges.
const CORNER_3CYCLE = parse("R' F R' B2 R F' R' B2 R2");
// Sune / Anti-Sune — orient last-layer corners. They live in the LL group, so
// BFS over {U, Sune, AntiSune} with the "fully solved" goal restores edges too.
const SUNE = parse("R U R' U R U2 R'");
const ANTISUNE = parse("R U2 R' U' R U' R'");

/* ------------------------------------------------------------------ */
/* First-two-layers macros (deterministic insertion via macro BFS)      */
/* ------------------------------------------------------------------ */

// Conjugating a move by the y rotation (y' m y) renames faces this way; applying
// it repeatedly rotates a "front-right slot" algorithm to the other three slots.
const RENAME_Y: Record<string, string> = { U: 'U', R: 'F', F: 'L', D: 'D', L: 'B', B: 'R' };

function renameY(moves: Move[], times: number): Move[] {
  let cur = moves;
  for (let t = 0; t < times; t++) {
    cur = cur.map((m) => RENAME_Y[m[0]] + m.slice(1));
  }
  return cur;
}

function slotVariants(base: Move[]): Move[][] {
  return [0, 1, 2, 3].map((t) => renameY(base, t));
}

const SETUP_U: Move[][] = [['U'], ['U2'], ["U'"]];

// Corner insert: "sexy" (R U R' U') and its inverse, at each of the 4 D-corner
// slots. Each preserves the cross and the other three D corners.
const CORNER_MACROS: Move[][] = [
  ...SETUP_U,
  ...slotVariants(parse("R U R' U'")),
  ...slotVariants(parse("U R U' R'")),
];

// Middle-edge insert (right- and left-hand), at each of the 4 middle slots.
// Each preserves the cross and all D corners.
const EDGE_MACROS: Move[][] = [
  ...SETUP_U,
  ...slotVariants(parse("U R U' R' U' F' U F")),
  ...slotVariants(parse("U' L' U L U F U' F'")),
];

// Full-state signature. (A sub-goal signature can't be used here: the macros'
// effect on a target piece depends on the rest of the cube, so merging states
// by sub-goal would prune valid paths.)
function fullKey(c: Cubie): string {
  return c.ep.join(',') + '|' + c.eo.join('') + '|' + c.cp.join(',') + '|' + c.co.join('');
}

// Breadth-first search over macro moves to reach `goal`, deduplicating on the
// sub-goal signature so the frontier stays inside the relevant subspace.
function bfsMacro(
  start: Cubie,
  goal: (c: Cubie) => boolean,
  macros: Move[][],
  keyFn: (c: Cubie) => string,
  maxDepth: number,
): Move[] {
  if (goal(start)) return [];
  interface Node {
    cube: Cubie;
    moves: Move[];
  }
  const visited = new Set<string>([keyFn(start)]);
  let frontier: Node[] = [{ cube: start, moves: [] }];
  let depth = 0;
  while (frontier.length && depth < maxDepth) {
    const next: Node[] = [];
    for (const node of frontier) {
      for (const macro of macros) {
        const nc = applyMovesCubie(node.cube, macro);
        const key = keyFn(nc);
        if (visited.has(key)) continue;
        const moves = node.moves.concat(macro);
        if (goal(nc)) return moves;
        visited.add(key);
        next.push({ cube: nc, moves });
      }
    }
    frontier = next;
    depth++;
  }
  throw new Error('BFS de capas no encontró solución');
}

/* ------------------------------------------------------------------ */
/* Precomputed last-layer solver                                        */
/* ------------------------------------------------------------------ */

// After the first two layers are solved, the last layer is one of 62 208
// states. We BFS the whole last-layer group once (over F2L-preserving macros)
// and store, for each state, the macro that moves it one step toward solved.

const LL_MACROS: Move[][] = [
  ['U'],
  ['U2'],
  ["U'"],
  OLL_EDGE,
  SUNE,
  ANTISUNE,
  CORNER_3CYCLE,
  EDGE_3CYCLE,
  T_PERM,
];
const LL_MACROS_INV: Move[][] = LL_MACROS.map((m) => invertMoveList(m));

function invertMoveList(moves: Move[]): Move[] {
  return [...moves].reverse().map((m) => {
    const t = turnsOf(m);
    const face = m[0];
    return t === 2 ? `${face}2` : t === 3 ? face : `${face}'`;
  });
}

// Rank a permutation of {0,1,2,3} (0..23).
function rank4(a: number[]): number {
  let r = 0;
  for (let i = 0; i < 4; i++) {
    let c = a[i];
    for (let j = 0; j < i; j++) if (a[j] < a[i]) c--;
    r = r * (4 - i) + c;
  }
  return r;
}

const LL_SIZE = 24 * 81 * 24 * 16;

function encodeLL(c: Cubie): number {
  const cpr = rank4([c.cp[0], c.cp[1], c.cp[2], c.cp[3]]);
  const epr = rank4([c.ep[0], c.ep[1], c.ep[2], c.ep[3]]);
  const co = c.co[0] * 27 + c.co[1] * 9 + c.co[2] * 3 + c.co[3];
  const eo = c.eo[0] * 8 + c.eo[1] * 4 + c.eo[2] * 2 + c.eo[3];
  return ((cpr * 81 + co) * 24 + epr) * 16 + eo;
}

function unrank4(r: number): number[] {
  const c0 = Math.floor(r / 6);
  const rem = r % 6;
  const c1 = Math.floor(rem / 2);
  const c2 = rem % 2;
  const elems = [0, 1, 2, 3];
  const a0 = elems.splice(c0, 1)[0];
  const a1 = elems.splice(c1, 1)[0];
  const a2 = elems.splice(c2, 1)[0];
  return [a0, a1, a2, elems[0]];
}

function decodeLL(idx: number): Cubie {
  const eo = idx % 16;
  idx = Math.floor(idx / 16);
  const epr = idx % 24;
  idx = Math.floor(idx / 24);
  const co = idx % 81;
  const cpr = Math.floor(idx / 81);
  const cp4 = unrank4(cpr);
  const ep4 = unrank4(epr);
  // First two layers are solved (pieces 4..11 home, orientation 0).
  const ep = [ep4[0], ep4[1], ep4[2], ep4[3], 4, 5, 6, 7, 8, 9, 10, 11];
  const cp = [cp4[0], cp4[1], cp4[2], cp4[3], 4, 5, 6, 7];
  const eoArr = [(eo >> 3) & 1, (eo >> 2) & 1, (eo >> 1) & 1, eo & 1, 0, 0, 0, 0, 0, 0, 0, 0];
  const coArr = [
    Math.floor(co / 27) % 3,
    Math.floor(co / 9) % 3,
    Math.floor(co / 3) % 3,
    co % 3,
    0,
    0,
    0,
    0,
  ];
  return { ep, eo: eoArr, cp, co: coArr };
}

let LL_SOLVE_MACRO: Int8Array | null = null; // index into LL_MACROS_INV, or -1

// Loads the precomputed last-layer table (instant) instead of running the
// Dijkstra below at runtime, which froze the JS thread for ~2s (much worse on
// Hermes). The slow builder is kept as a fallback / for regeneration.
function buildLLTable(): void {
  if (LL_SOLVE_MACRO) return;
  if (LL_TABLE_B64) {
    LL_SOLVE_MACRO = decodeInt8(LL_TABLE_B64);
    return;
  }
  buildLLTableSlow();
}

// Dijkstra (Dial's buckets) from solved, weighting each macro by its move count,
// so the stored solutions are short in moves rather than just in macros.
function buildLLTableSlow(): void {
  if (LL_SOLVE_MACRO) return;
  const solveMacro = new Int8Array(LL_SIZE).fill(-1);
  const dist = new Int32Array(LL_SIZE).fill(-1);
  const weights = LL_MACROS.map((m) => m.length);
  const startIdx = encodeLL(faceletToCubie(SOLVED_FACELET));
  dist[startIdx] = 0;
  const buckets: number[][] = [];
  const push = (d: number, idx: number) => {
    (buckets[d] ||= []).push(idx);
  };
  push(0, startIdx);
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (const idx of bucket) {
      if (dist[idx] !== d) continue; // stale entry
      const cube = decodeLL(idx);
      for (let mi = 0; mi < LL_MACROS.length; mi++) {
        const nc = applyMovesCubie(cube, LL_MACROS[mi]);
        const nIdx = encodeLL(nc);
        const nd = d + weights[mi];
        if (dist[nIdx] === -1 || nd < dist[nIdx]) {
          dist[nIdx] = nd;
          solveMacro[nIdx] = mi;
          push(nd, nIdx);
        }
      }
    }
  }
  LL_SOLVE_MACRO = solveMacro;
}

// Returns the move list (expanded) that solves the last layer from `start`.
function solveLastLayer(start: Cubie): Move[] {
  buildLLTable();
  const table = LL_SOLVE_MACRO!;
  let cube = start;
  let idx = encodeLL(cube);
  const moves: Move[] = [];
  let guard = 0;
  while (table[idx] !== -1 && guard < 100) {
    const inv = LL_MACROS_INV[table[idx]];
    moves.push(...inv);
    cube = applyMovesCubie(cube, inv);
    idx = encodeLL(cube);
    guard++;
  }
  if (!isSolvedCubie(cube)) {
    throw new Error('Tabla de última capa incompleta');
  }
  return moves;
}

/* ------------------------------------------------------------------ */
/* Move-list simplification                                             */
/* ------------------------------------------------------------------ */

function turnsOf(move: Move): number {
  if (move.endsWith('2')) return 2;
  if (move.endsWith("'")) return 3;
  return 1;
}

function moveFromTurns(face: string, turns: number): Move | null {
  const t = ((turns % 4) + 4) % 4;
  if (t === 0) return null;
  if (t === 1) return face;
  if (t === 2) return `${face}2`;
  return `${face}'`;
}

function simplify(moves: Move[]): Move[] {
  const out: { face: string; turns: number }[] = [];
  for (const m of moves) {
    const face = m[0];
    const turns = turnsOf(m);
    if (out.length && out[out.length - 1].face === face) {
      out[out.length - 1].turns = (out[out.length - 1].turns + turns) % 4;
      if (out[out.length - 1].turns === 0) out.pop();
    } else {
      out.push({ face, turns });
    }
  }
  const result: Move[] = [];
  for (const { face, turns } of out) {
    const m = moveFromTurns(face, turns);
    if (m) result.push(m);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

export function solveBeginner(state: FaceletState): BeginnerStage[] {
  ensurePdbs();
  let cube = faceletToCubie(state);

  const run = (moves: Move[]): void => {
    cube = applyMovesCubie(cube, moves);
  };

  const crossMoves = idaStar(cube, isCross, hCross);
  run(crossMoves);

  // First layer: insert each D corner with the cross + earlier corners kept.
  const f1Moves: Move[] = [];
  for (let j = 4; j <= 7; j++) {
    const placed = DCORNERS.filter((s) => s <= j);
    const m = bfsMacro(
      cube,
      (c) => edgesSolved(c, CROSS_EDGES) && cornersSolved(c, placed),
      CORNER_MACROS,
      fullKey,
      9,
    );
    f1Moves.push(...m);
    run(m);
  }

  // Second layer: insert each middle edge with the first layer kept.
  const f2lMoves: Move[] = [];
  for (let j = 8; j <= 11; j++) {
    const placed = MIDDLE_EDGES.filter((s) => s <= j);
    const m = bfsMacro(
      cube,
      (c) =>
        edgesSolved(c, CROSS_EDGES) &&
        cornersSolved(c, DCORNERS) &&
        edgesSolved(c, placed),
      EDGE_MACROS,
      fullKey,
      9,
    );
    f2lMoves.push(...m);
    run(m);
  }

  // Last layer: one precomputed solution, sliced into the four classic stages
  // at the moments each sub-goal is first reached (the goals are nested, so the
  // slice points are monotonic).
  const llMoves = solveLastLayer(cube);
  const [llCrossMoves, llEdgesMoves, llCornerPosMoves, llCornerOriMoves] =
    sliceLastLayer(cube, llMoves);
  run(llMoves);

  // NOTE: este solver resuelve la cara D primero (primera capa abajo) y la
  // última capa arriba (U). Las etiquetas son agnósticas de color para que
  // sean correctas sin importar cómo orientes el cubo físicamente.
  const stages: BeginnerStage[] = [
    { key: 'cross', label: 'Cruz de la primera capa', moves: simplify(crossMoves) },
    { key: 'f1', label: 'Primera capa (esquinas)', moves: simplify(f1Moves) },
    { key: 'f2l', label: 'Segunda capa', moves: simplify(f2lMoves) },
    { key: 'llCross', label: 'Cruz de la última capa', moves: simplify(llCrossMoves) },
    { key: 'llEdges', label: 'Aristas de la última capa', moves: simplify(llEdgesMoves) },
    { key: 'llCornerPos', label: 'Esquinas: posición', moves: simplify(llCornerPosMoves) },
    { key: 'llCornerOri', label: 'Esquinas: orientación', moves: simplify(llCornerOriMoves) },
  ];
  return stages;
}

// Split a last-layer solution into [orientEdges, permuteEdges, positionCorners,
// orientCorners] by the first move index at which each nested goal holds.
function sliceLastLayer(
  start: Cubie,
  moves: Move[],
): [Move[], Move[], Move[], Move[]] {
  let cube = start;
  let i1 = -1;
  let i2 = -1;
  let i3 = -1;
  const n = moves.length;
  // Index k = number of moves applied so far (0..n).
  const check = (k: number) => {
    if (i1 < 0 && isLLEdgesOriented(cube)) i1 = k;
    if (i2 < 0 && isLLEdgesSolved(cube)) i2 = k;
    if (i3 < 0 && isLLCornersPositioned(cube)) i3 = k;
  };
  check(0);
  for (let k = 0; k < n; k++) {
    cube = applyMoveCubie(cube, moves[k]);
    check(k + 1);
  }
  if (i1 < 0) i1 = n;
  if (i2 < 0) i2 = n;
  if (i3 < 0) i3 = n;
  // Guarantee monotonic, valid slice bounds.
  i2 = Math.max(i1, i2);
  i3 = Math.max(i2, i3);
  return [
    moves.slice(0, i1),
    moves.slice(i1, i2),
    moves.slice(i2, i3),
    moves.slice(i3, n),
  ];
}