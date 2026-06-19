/**
 * rubik-lbl-ts — a zero-dependency Rubik's Cube toolkit in pure TypeScript.
 *
 *  • Layer-by-Layer (beginner method) solver written from scratch — no external
 *    solver libraries. IDA* + pattern database for the first two layers, a
 *    precomputed table for the last layer.
 *  • Sticker color matching: classify the stickers of a scanned face from raw
 *    RGBA pixels, and find the valid cube assembly regardless of how each face
 *    was rotated while scanning.
 *  • A geometry-derived move engine and a full solvability validator.
 */

// ---- Core types ----
export type { Face, FaceletState, Move } from './types';

// ---- Move engine (geometry-derived, no hand-written permutation tables) ----
export {
  SOLVED_STATE,
  applyMove,
  applyMoves,
  isSolved,
  invertMove,
  invertMoves,
  countStickers,
  centerString,
  reorientToStandardCenters,
  parseMove,
  getMoveSpec,
} from './moveEngine';
export type { ParsedMove, MoveSpec } from './moveEngine';

// ---- Geometry (single source of truth) ----
export {
  FACE_ORDER,
  STICKERS,
  BASE_PERMUTATIONS,
  ROTATION_PERMUTATIONS,
  rotateVec,
} from './geometry';
export type { Vec3, StickerGeometry, BaseMove } from './geometry';

// ---- Validation (full solvability check) ----
export { validateState } from './validation';
export type { ValidationResult } from './validation';

// ---- Beginner (Layer-by-Layer) solver ----
export { solveBeginner } from './solver/beginnerSolver';
export type { BeginnerStage } from './solver/beginnerSolver';

// ---- Sticker color matching ----
export {
  DEFAULT_REFERENCES,
  colorDistance,
  classifyColor,
  sampleRegion,
  sampleGrid,
  detectFaceColors,
} from './vision/colorMatch';
export type { RGB, DetectedFace } from './vision/colorMatch';

// ---- Scan orientation search ----
export { rotateFaceLetters, findValidAssemblies, findValidAssembly } from './vision/orientation';
export type { NormalizedScan } from './vision/orientation';
