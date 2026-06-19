import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SOLVED_STATE,
  applyMoves,
  isSolved,
  validateState,
  solveBeginner,
  classifyColor,
  detectFaceColors,
  DEFAULT_REFERENCES,
  findValidAssembly,
  type Face,
  type Move,
} from '../index';

/** A handful of fixed scrambles (avoids any RNG so the test is deterministic). */
const SCRAMBLES: Move[][] = [
  "R U R' U' R' F R2 U' R' U' R U R' F'".split(' '),
  "F R U' R' U' R U R' F' R U R' U' R' F R F'".split(' '),
  "D2 R' U2 R F2 L U' B2 R2 F' U R2 D B' L2 F".split(' '),
  "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2".split(' '),
];

test('beginner solver returns moves that fully solve each scramble', () => {
  for (const scramble of SCRAMBLES) {
    const scrambled = applyMoves(SOLVED_STATE, scramble);
    assert.equal(validateState(scrambled).valid, true, 'scrambled state must be valid');

    const stages = solveBeginner(scrambled);
    const solution = stages.flatMap((s) => s.moves);
    const final = applyMoves(scrambled, solution);

    assert.equal(isSolved(final), true, `solution should solve scramble: ${scramble.join(' ')}`);
  }
});

test('beginner solver emits the 7 classic LBL stages', () => {
  const scrambled = applyMoves(SOLVED_STATE, SCRAMBLES[0]);
  const stages = solveBeginner(scrambled);
  assert.deepEqual(
    stages.map((s) => s.key),
    ['cross', 'f1', 'f2l', 'llCross', 'llEdges', 'llCornerPos', 'llCornerOri'],
  );
});

test('color matching classifies each reference color back to its face', () => {
  for (const face of Object.keys(DEFAULT_REFERENCES) as Face[]) {
    assert.equal(classifyColor(DEFAULT_REFERENCES[face]), face);
  }
});

test('detectFaceColors reads a synthetic solved-white face', () => {
  // 3×3 grid, 30×30 px, every pixel = white reference color (RGBA).
  const size = 30;
  const px = new Uint8Array(size * size * 4);
  const white = DEFAULT_REFERENCES.U;
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = white.r;
    px[i * 4 + 1] = white.g;
    px[i * 4 + 2] = white.b;
    px[i * 4 + 3] = 255;
  }
  const { letters } = detectFaceColors(px, size, size, DEFAULT_REFERENCES, 3);
  assert.equal(letters.length, 9);
  assert.ok(letters.every((l) => l === 'U'));
});

test('findValidAssembly recovers the cube even when faces are mis-rotated', () => {
  // Build the six faces of a scrambled cube, then rotate two of them 90°/180°.
  const scrambled = applyMoves(SOLVED_STATE, SCRAMBLES[2]);
  const faceArr = (i: number) => scrambled.slice(i * 9, i * 9 + 9).split('') as Face[];
  const rot = (a: Face[]): Face[] => {
    const n = new Array<Face>(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) n[r * 3 + c] = a[(2 - c) * 3 + r];
    return n;
  };
  // FACE_ORDER = U R F D L B
  const faces: Record<Face, Face[]> = {
    U: faceArr(0),
    R: rot(faceArr(1)), // rotated 90°
    F: faceArr(2),
    D: rot(rot(faceArr(3))), // rotated 180°
    L: faceArr(4),
    B: faceArr(5),
  };
  const assembly = findValidAssembly(faces);
  assert.ok(assembly, 'should find a valid assembly');
  assert.equal(validateState(assembly!.state).valid, true);
});
