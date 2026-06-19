/** Core domain types for the cube engine. */

/** The six faces in URFDLB convention. */
export type Face = 'U' | 'D' | 'R' | 'L' | 'F' | 'B';

/**
 * Cube state in facelet notation (URFDLB order, 9 stickers per face = 54 chars).
 * Compatible with the cubejs / Kociemba convention. Solved 3×3:
 * `"UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"`
 */
export type FaceletState = string;

/** A single move in standard notation, e.g. `"R"`, `"U'"`, `"F2"`. */
export type Move = string;
