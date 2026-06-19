import type { Face, FaceletState, Move } from './types';

import { BASE_PERMUTATIONS, ROTATION_PERMUTATIONS, type BaseMove } from './geometry';

export const SOLVED_STATE: FaceletState = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

type Rotation = 'x' | 'y' | 'z';
type WideMove = 'u' | 'd' | 'r' | 'l' | 'f' | 'b';
type SliceMove = 'M' | 'E' | 'S';
type MoveBase = BaseMove | Rotation | WideMove | SliceMove;

const FACE_MOVES = new Set<string>(['U', 'D', 'R', 'L', 'F', 'B']);
const ROTATIONS = new Set<string>(['x', 'y', 'z']);
const WIDE_MOVES = new Set<string>(['u', 'd', 'r', 'l', 'f', 'b']);
const SLICE_MOVES = new Set<string>(['M', 'E', 'S']);

export interface ParsedMove {
  base: MoveBase;
  /** Quarter turns clockwise: 1, 2, or 3 (3 ≡ counter-clockwise). */
  turns: 1 | 2 | 3;
}

export function parseMove(move: Move): ParsedMove {
  const base = move[0] as MoveBase;
  const suffix = move.slice(1);
  const known =
    FACE_MOVES.has(base) || ROTATIONS.has(base) || WIDE_MOVES.has(base) || SLICE_MOVES.has(base);
  if (!known || !['', "'", '2', "2'", "'2"].includes(suffix)) {
    throw new Error(`Movimiento inválido: "${move}"`);
  }
  const turns =
    suffix === ''
      ? 1
      : suffix.includes('2') && !suffix.includes("'")
        ? 2
        : suffix.includes('2')
          ? 2
          : 3;
  return { base, turns };
}

/* ------------------------------------------------------------------ */
/* Permutations: P[to] = from. Composition applies left then right.    */
/* ------------------------------------------------------------------ */
function compose(first: number[], second: number[]): number[] {
  return second.map((_, i) => first[second[i]]);
}

/** Wide moves = whole-cube rotation + restoring turn of the untouched face. */
const WIDE_DEFS: Record<WideMove, { rotation: Rotation; rotationTurns: number; face: BaseMove }> = {
  r: { rotation: 'x', rotationTurns: 1, face: 'L' },
  l: { rotation: 'x', rotationTurns: 3, face: 'R' },
  u: { rotation: 'y', rotationTurns: 1, face: 'D' },
  d: { rotation: 'y', rotationTurns: 3, face: 'U' },
  f: { rotation: 'z', rotationTurns: 1, face: 'B' },
  b: { rotation: 'z', rotationTurns: 3, face: 'F' },
};

function repeat(perm: number[], times: number): number[] {
  let result = perm.map((_, i) => i);
  for (let i = 0; i < times; i++) result = compose(perm, result);
  return result;
}

const PERM_BY_BASE: Record<string, number[]> = (() => {
  const map: Record<string, number[]> = { ...BASE_PERMUTATIONS, ...ROTATION_PERMUTATIONS };
  for (const [wide, def] of Object.entries(WIDE_DEFS)) {
    map[wide] = compose(
      repeat(ROTATION_PERMUTATIONS[def.rotation], def.rotationTurns),
      BASE_PERMUTATIONS[def.face],
    );
  }
  // Slices (the CFOP solver emits them): rotate the whole cube, then restore
  // both outer layers — only the middle slice ends up turned.
  //   M follows L's direction, E follows D's, S follows F's.
  const seq = (perms: number[][]) => perms.reduce((acc, p) => compose(acc, p));
  map.M = seq([repeat(map.x, 3), map.R, repeat(map.L, 3)]);
  map.E = seq([repeat(map.y, 3), map.U, repeat(map.D, 3)]);
  map.S = seq([map.z, repeat(map.F, 3), map.B]);
  return map;
})();

export function applyMove(state: FaceletState, move: Move): FaceletState {
  const { base, turns } = parseMove(move);
  const perm = repeat(PERM_BY_BASE[base], turns);
  let next = '';
  for (let i = 0; i < 54; i++) next += state[perm[i]];
  return next;
}

export function applyMoves(state: FaceletState, moves: Move[]): FaceletState {
  return moves.reduce(applyMove, state);
}

export function isSolved(state: FaceletState): boolean {
  for (let f = 0; f < 6; f++) {
    const center = state[f * 9 + 4];
    for (let i = 0; i < 9; i++) {
      if (state[f * 9 + i] !== center) return false;
    }
  }
  return true;
}

export function invertMove(move: Move): Move {
  const { base, turns } = parseMove(move);
  return turns === 2 ? `${base}2` : turns === 1 ? `${base}'` : base;
}

export function invertMoves(moves: Move[]): Move[] {
  return [...moves].reverse().map(invertMove);
}

/** Counts the stickers of each face letter — quick sanity input for validation. */
export function countStickers(state: FaceletState): Record<Face, number> {
  const counts: Record<Face, number> = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 };
  for (const ch of state) {
    if (ch in counts) counts[ch as Face] += 1;
  }
  return counts;
}

const CENTER_INDICES = [4, 13, 22, 31, 40, 49];

export function centerString(state: FaceletState): string {
  return CENTER_INDICES.map((i) => state[i]).join('');
}

/**
 * Whole-cube reorientation so the centers sit at the standard URFDLB layout.
 * A scramble that includes slice/middle-layer turns (or a manual middle-layer
 * swipe) rotates the centers; the result is a perfectly solvable cube, just
 * reoriented. The solver/validation expect URFDLB centers, so we rotate the
 * whole cube (BFS over x/y/z) until the centers match. Returns null only if no
 * orientation works (genuinely invalid state).
 */
export function reorientToStandardCenters(state: FaceletState): FaceletState | null {
  if (centerString(state) === 'URFDLB') return state;
  const rotations: Move[] = ['x', 'y', 'z', "x'", "y'", "z'"];
  const seen = new Set<string>([state]);
  let frontier = [state];
  // All 24 orientations are reachable within depth 3 over {x, y, z}.
  for (let depth = 0; depth < 4 && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const s of frontier) {
      for (const r of rotations) {
        const rotated = applyMove(s, r);
        if (centerString(rotated) === 'URFDLB') return rotated;
        if (!seen.has(rotated)) {
          seen.add(rotated);
          next.push(rotated);
        }
      }
    }
    frontier = next;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Animation spec for the 3D viewer                                    */
/* ------------------------------------------------------------------ */
export interface MoveSpec {
  axis: 'x' | 'y' | 'z';
  /** Layer coordinates (along axis) that rotate: subsets of [-1, 0, 1]. */
  layers: number[];
  /** Total signed angle in radians (right-hand rule around +axis). */
  angle: number;
}

const FACE_SPECS: Record<BaseMove, { axis: 'x' | 'y' | 'z'; layer: number; direction: 1 | -1 }> = {
  U: { axis: 'y', layer: 1, direction: -1 },
  D: { axis: 'y', layer: -1, direction: 1 },
  R: { axis: 'x', layer: 1, direction: -1 },
  L: { axis: 'x', layer: -1, direction: 1 },
  F: { axis: 'z', layer: 1, direction: -1 },
  B: { axis: 'z', layer: -1, direction: 1 },
};

const ROTATION_AXIS: Record<Rotation, 'x' | 'y' | 'z'> = { x: 'x', y: 'y', z: 'z' };

export function getMoveSpec(move: Move): MoveSpec {
  const { base, turns } = parseMove(move);
  const signedTurns = turns === 3 ? -1 : turns;
  const quarter = Math.PI / 2;

  if (ROTATIONS.has(base)) {
    // x/y/z turn the whole cube like R/U/F respectively (direction -1)
    return {
      axis: ROTATION_AXIS[base as Rotation],
      layers: [-1, 0, 1],
      angle: -1 * signedTurns * quarter,
    };
  }
  if (WIDE_MOVES.has(base)) {
    const faceSpec = FACE_SPECS[base.toUpperCase() as BaseMove];
    return {
      axis: faceSpec.axis,
      layers: [0, faceSpec.layer],
      angle: faceSpec.direction * signedTurns * quarter,
    };
  }
  if (SLICE_MOVES.has(base)) {
    // M follows L (+x), E follows D (+y), S follows F (−z direction sign)
    const sliceSpec = {
      M: { axis: 'x' as const, direction: 1 },
      E: { axis: 'y' as const, direction: 1 },
      S: { axis: 'z' as const, direction: -1 },
    }[base as SliceMove];
    return {
      axis: sliceSpec.axis,
      layers: [0],
      angle: sliceSpec.direction * signedTurns * quarter,
    };
  }
  const spec = FACE_SPECS[base as BaseMove];
  return { axis: spec.axis, layers: [spec.layer], angle: spec.direction * signedTurns * quarter };
}
