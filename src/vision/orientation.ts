import { validateState } from '../validation';
import { FACE_ORDER } from '../geometry';
import type { Face, FaceletState } from '../types';

/**
 * When scanning, people rotate the cube arbitrarily to find each center, so a
 * captured face's rows/cols rarely match the facelet convention — corners stop
 * matching and validation fails even though every COLOR is right.
 *
 * The fix: a face photographed at any angle is just the true face rotated by
 * 0/90/180/270°. We search all 4⁶ = 4096 per-face rotation combinations for
 * one that assembles into a physically valid cube. For a scrambled cube the
 * valid assembly is (in practice) unique, so scanning orientation stops
 * mattering entirely.
 */

/** Rotates a 3×3 face (row-major letters) 90° clockwise `turns` times. */
export function rotateFaceLetters(letters: Face[], turns: number): Face[] {
  let current = letters;
  for (let t = 0; t < ((turns % 4) + 4) % 4; t++) {
    const next = new Array<Face>(9);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        next[row * 3 + col] = current[(2 - col) * 3 + row];
      }
    }
    current = next;
  }
  return current;
}

export interface NormalizedScan {
  state: FaceletState;
  /** Quarter turns (CW) applied to each captured face to make it consistent. */
  rotations: Record<Face, number>;
  /** True when the scan was already consistent as captured. */
  wasAligned: boolean;
}

const rotationCost = (k: number) => Math.min(k, 4 - k);

/**
 * Finds EVERY distinct per-face-rotation assembly of the captured faces that
 * forms a physically valid cube, sorted by total rotation (the most likely one
 * first). Usually there's exactly one; mis-detected colors give zero (then the
 * colors are wrong, not the orientation); rare symmetric scans give several,
 * which the UI lets the user cycle through if the picked one doesn't match.
 */
export function findValidAssemblies(faces: Partial<Record<Face, Face[]>>): NormalizedScan[] {
  if (FACE_ORDER.some((f) => !faces[f])) return [];

  // Precompute the 4 rotations of each face
  const rotated: Record<Face, Face[][]> = {} as Record<Face, Face[][]>;
  for (const face of FACE_ORDER) {
    rotated[face] = [0, 1, 2, 3].map((k) => rotateFaceLetters(faces[face]!, k));
  }

  const byState = new Map<FaceletState, NormalizedScan & { cost: number }>();
  const ks = [0, 0, 0, 0, 0, 0];
  for (ks[0] = 0; ks[0] < 4; ks[0]++)
    for (ks[1] = 0; ks[1] < 4; ks[1]++)
      for (ks[2] = 0; ks[2] < 4; ks[2]++)
        for (ks[3] = 0; ks[3] < 4; ks[3]++)
          for (ks[4] = 0; ks[4] < 4; ks[4]++)
            for (ks[5] = 0; ks[5] < 4; ks[5]++) {
              const state = FACE_ORDER.map((face, i) => rotated[face][ks[i]].join('')).join('');
              if (byState.has(state) || !validateState(state).valid) continue;
              const cost = ks.reduce((sum, k) => sum + rotationCost(k), 0);
              byState.set(state, {
                state,
                rotations: Object.fromEntries(FACE_ORDER.map((face, i) => [face, ks[i]])) as Record<
                  Face,
                  number
                >,
                wasAligned: cost === 0,
                cost,
              });
            }

  return [...byState.values()]
    .sort((a, b) => a.cost - b.cost)
    .map(({ cost: _cost, ...scan }) => scan);
}

/**
 * Finds per-face rotations that assemble the captured faces into a solvable
 * state. Returns the minimal-rotation solution, or null if no combination is
 * valid (then the colors themselves are wrong, not the orientation).
 */
export function findValidAssembly(faces: Partial<Record<Face, Face[]>>): NormalizedScan | null {
  return findValidAssemblies(faces)[0] ?? null;
}
