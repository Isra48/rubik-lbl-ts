import type { Face } from './types';

/**
 * Geometric model of the 3x3 facelet layout (URFDLB order, 54 stickers).
 * Each facelet index maps to a sticker center position on the surface of a
 * 3×3×3 grid with coordinates in {-1, 0, 1}, plus its outward normal.
 *
 * This single source of geometry powers:
 *  - the move engine (permutations are DERIVED by rotating stickers, no
 *    hand-written tables to get wrong),
 *  - the 3D viewer (sticker meshes are placed with the same data).
 *
 * Facelet convention (same as cubejs / Kociemba): each face is read row by
 * row from its top-left, looking straight at the face:
 *  - U seen from above with B at the top
 *  - D seen from below with F at the top
 *  - F/R/L/B seen straight on, U at the top
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface StickerGeometry {
  index: number;
  face: Face;
  row: number;
  col: number;
  position: Vec3;
  normal: Vec3;
}

export const FACE_ORDER: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];

function stickerPosition(face: Face, row: number, col: number): { position: Vec3; normal: Vec3 } {
  switch (face) {
    case 'U':
      return { position: { x: col - 1, y: 1, z: row - 1 }, normal: { x: 0, y: 1, z: 0 } };
    case 'D':
      return { position: { x: col - 1, y: -1, z: 1 - row }, normal: { x: 0, y: -1, z: 0 } };
    case 'F':
      return { position: { x: col - 1, y: 1 - row, z: 1 }, normal: { x: 0, y: 0, z: 1 } };
    case 'B':
      return { position: { x: 1 - col, y: 1 - row, z: -1 }, normal: { x: 0, y: 0, z: -1 } };
    case 'R':
      return { position: { x: 1, y: 1 - row, z: 1 - col }, normal: { x: 1, y: 0, z: 0 } };
    case 'L':
      return { position: { x: -1, y: 1 - row, z: col - 1 }, normal: { x: -1, y: 0, z: 0 } };
  }
}

export const STICKERS: StickerGeometry[] = FACE_ORDER.flatMap((face, faceIdx) =>
  Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    return { index: faceIdx * 9 + i, face, row, col, ...stickerPosition(face, row, col) };
  }),
);

const keyOf = (p: Vec3, n: Vec3) => `${p.x},${p.y},${p.z}|${n.x},${n.y},${n.z}`;

const STICKER_BY_KEY = new Map<string, number>(
  STICKERS.map((s) => [keyOf(s.position, s.normal), s.index]),
);

/** Quarter-turn rotations around each axis, oriented so the named face turns clockwise. */
export type BaseMove = Face;

/** Rotates a vector the way the given face turn (or whole-cube x/y/z rotation) does. */
export function rotateVec(v: Vec3, move: BaseMove | 'x' | 'y' | 'z'): Vec3 {
  switch (move) {
    case 'x':
      return rotate(v, 'R');
    case 'y':
      return rotate(v, 'U');
    case 'z':
      return rotate(v, 'F');
    default:
      return rotate(v, move);
  }
}

function rotate(v: Vec3, move: BaseMove): Vec3 {
  switch (move) {
    case 'U': // clockwise seen from +y
      return { x: -v.z, y: v.y, z: v.x };
    case 'D': // clockwise seen from -y
      return { x: v.z, y: v.y, z: -v.x };
    case 'R': // clockwise seen from +x
      return { x: v.x, y: v.z, z: -v.y };
    case 'L': // clockwise seen from -x
      return { x: v.x, y: -v.z, z: v.y };
    case 'F': // clockwise seen from +z
      return { x: v.y, y: -v.x, z: v.z };
    case 'B': // clockwise seen from -z
      return { x: -v.y, y: v.x, z: v.z };
  }
}

function inLayer(p: Vec3, move: BaseMove): boolean {
  switch (move) {
    case 'U':
      return p.y === 1;
    case 'D':
      return p.y === -1;
    case 'R':
      return p.x === 1;
    case 'L':
      return p.x === -1;
    case 'F':
      return p.z === 1;
    case 'B':
      return p.z === -1;
  }
}

/**
 * Permutation tables derived from geometry: PERM[move][to] = from, i.e. after
 * the move, facelet `to` shows the sticker previously at index `from`.
 */
export const BASE_PERMUTATIONS: Record<BaseMove, number[]> = (() => {
  const result = {} as Record<BaseMove, number[]>;
  for (const move of FACE_ORDER) {
    const perm = STICKERS.map((s) => s.index);
    for (const s of STICKERS) {
      if (!inLayer(s.position, move)) continue;
      const target = STICKER_BY_KEY.get(keyOf(rotate(s.position, move), rotate(s.normal, move)));
      if (target === undefined)
        throw new Error(`geometry bug: no target for sticker ${s.index} on ${move}`);
      perm[target] = s.index;
    }
    result[move] = perm;
  }
  return result;
})();

/** Whole-cube rotations (x like R, y like U, z like F) as facelet permutations. */
export const ROTATION_PERMUTATIONS: Record<'x' | 'y' | 'z', number[]> = (() => {
  const result = {} as Record<'x' | 'y' | 'z', number[]>;
  for (const move of ['x', 'y', 'z'] as const) {
    const perm = STICKERS.map((s) => s.index);
    for (const s of STICKERS) {
      const target = STICKER_BY_KEY.get(
        keyOf(rotateVec(s.position, move), rotateVec(s.normal, move)),
      );
      if (target === undefined)
        throw new Error(`geometry bug: no target for sticker ${s.index} on ${move}`);
      perm[target] = s.index;
    }
    result[move] = perm;
  }
  return result;
})();
