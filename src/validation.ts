import type { FaceletState } from './types';

import { STICKERS, type Vec3 } from './geometry';
import { countStickers, SOLVED_STATE } from './moveEngine';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/* ------------------------------------------------------------------ */
/* Cubie slots derived from geometry: group stickers by 3D position.  */
/* Corners have 3 stickers, edges 2, centers 1.                        */
/* ------------------------------------------------------------------ */
interface CornerSlot {
  /** Facelet indices in clockwise order (seen from outside), starting at the U/D facelet. */
  facelets: [number, number, number];
}

interface EdgeSlot {
  /** Primary facelet first: the one on U/D if present, else the one on F/B. */
  facelets: [number, number];
}

const posKey = (p: Vec3) => `${p.x},${p.y},${p.z}`;

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

const { CORNER_SLOTS, EDGE_SLOTS } = (() => {
  const byPos = new Map<string, typeof STICKERS>();
  for (const s of STICKERS) {
    const key = posKey(s.position);
    byPos.set(key, [...(byPos.get(key) ?? []), s]);
  }

  const corners: CornerSlot[] = [];
  const edges: EdgeSlot[] = [];

  for (const group of byPos.values()) {
    if (group.length === 3) {
      const p = group[0].position;
      const ud = group.find((s) => s.normal.y !== 0)!;
      const rest = group.filter((s) => s !== ud);
      // a→b is clockwise seen from outside the corner iff (a×b)·p < 0
      const [second, third] =
        dot(cross(ud.normal, rest[0].normal), p) < 0 ? [rest[0], rest[1]] : [rest[1], rest[0]];
      corners.push({ facelets: [ud.index, second.index, third.index] });
    } else if (group.length === 2) {
      const primary =
        group.find((s) => s.normal.y !== 0) ?? group.find((s) => s.normal.z !== 0) ?? group[0];
      const other = group.find((s) => s !== primary)!;
      edges.push({ facelets: [primary.index, other.index] });
    }
  }
  return { CORNER_SLOTS: corners, EDGE_SLOTS: edges };
})();

const cubieKey = (letters: string[]) => [...letters].sort().join('');

const SOLVED_CORNERS = CORNER_SLOTS.map((slot) =>
  cubieKey(slot.facelets.map((i) => SOLVED_STATE[i])),
);
const SOLVED_EDGES = EDGE_SLOTS.map((slot) => cubieKey(slot.facelets.map((i) => SOLVED_STATE[i])));

function permutationParity(perm: number[]): number {
  let inversions = 0;
  for (let i = 0; i < perm.length; i++) {
    for (let j = i + 1; j < perm.length; j++) {
      if (perm[i] > perm[j]) inversions++;
    }
  }
  return inversions % 2;
}

/**
 * Full solvability check for a scanned/edited facelet state:
 * sticker counts, centers, cubie existence, corner twist (%3), edge flip (%2)
 * and permutation parity. Reasons are user-facing (Spanish).
 */
export function validateState(state: FaceletState): ValidationResult {
  if (typeof state !== 'string' || state.length !== 54 || /[^URFDLB]/.test(state)) {
    return { valid: false, reason: 'El estado del cubo está incompleto.' };
  }

  const counts = countStickers(state);
  for (const [face, count] of Object.entries(counts)) {
    if (count !== 9) {
      return {
        valid: false,
        reason: `Hay ${count} stickers del color ${face} (deben ser 9). Corrige los colores marcados.`,
      };
    }
  }

  const centers = [4, 13, 22, 31, 40, 49].map((i) => state[i]).join('');
  if (centers !== 'URFDLB') {
    return { valid: false, reason: 'Los centros no coinciden con las 6 caras. Vuelve a escanear.' };
  }

  // Corners: every cubie exists exactly once; twist sum % 3 === 0
  const cornerPerm: number[] = [];
  let twist = 0;
  for (const slot of CORNER_SLOTS) {
    const letters = slot.facelets.map((i) => state[i]);
    const cubieIndex = SOLVED_CORNERS.indexOf(cubieKey(letters));
    if (cubieIndex === -1 || cornerPerm.includes(cubieIndex)) {
      return {
        valid: false,
        reason: 'Hay una esquina con colores imposibles o repetidos. Revisa los stickers.',
      };
    }
    cornerPerm.push(cubieIndex);
    const orientation = letters.findIndex((l) => l === 'U' || l === 'D');
    twist += orientation;
  }
  if (twist % 3 !== 0) {
    return {
      valid: false,
      reason: 'Una esquina está girada: este estado no se puede resolver. Revisa el escaneo.',
    };
  }

  // Edges: every cubie exists exactly once; flip sum % 2 === 0
  const edgePerm: number[] = [];
  let flip = 0;
  for (const slot of EDGE_SLOTS) {
    const letters = slot.facelets.map((i) => state[i]) as [string, string];
    const cubieIndex = SOLVED_EDGES.indexOf(cubieKey(letters));
    if (cubieIndex === -1 || edgePerm.includes(cubieIndex)) {
      return {
        valid: false,
        reason: 'Hay una arista con colores imposibles o repetidos. Revisa los stickers.',
      };
    }
    edgePerm.push(cubieIndex);
    const primaryLetter =
      letters.find((l) => l === 'U' || l === 'D') ?? letters.find((l) => l === 'F' || l === 'B')!;
    if (letters[0] !== primaryLetter) flip += 1;
  }
  if (flip % 2 !== 0) {
    return {
      valid: false,
      reason: 'Una arista está volteada: este estado no se puede resolver. Revisa el escaneo.',
    };
  }

  if (permutationParity(cornerPerm) !== permutationParity(edgePerm)) {
    return {
      valid: false,
      reason:
        'Dos piezas están intercambiadas: este estado no se puede resolver. Revisa el escaneo.',
    };
  }

  return { valid: true };
}
