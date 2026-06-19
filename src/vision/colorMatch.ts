import type { Face } from '../types';

/**
 * Sticker color matching — zero-dependency, platform-agnostic.
 *
 * Given the raw RGBA pixels of a square photo of one cube face, this module
 * samples each cell of the N×N grid and classifies its color into a face letter
 * (U/D/R/L/F/B) using nearest-neighbor matching in a lighting-tolerant space.
 *
 * It does NOT decode the image for you — feed it a flat RGBA `Uint8Array`
 * (4 bytes/pixel, row-major) plus its width/height. Any decoder works (browser
 * canvas `getImageData`, `jpeg-js`, `sharp`, React Native image-manipulator…),
 * which keeps this package free of native/platform dependencies.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Reference colors per face for nearest-neighbor classification.
 * Defaults approximate a stickered cube under indoor light; replace them with
 * CALIBRATED samples as faces get captured (each face's center sticker is
 * ground truth for its color) so detection improves with every face.
 */
export const DEFAULT_REFERENCES: Record<Face, RGB> = {
  U: { r: 225, g: 225, b: 215 }, // white
  D: { r: 230, g: 200, b: 45 }, // yellow
  R: { r: 195, g: 35, b: 50 }, // red
  L: { r: 235, g: 115, b: 35 }, // orange
  F: { r: 25, g: 150, b: 80 }, // green (standard scheme: green front)
  B: { r: 30, g: 90, b: 185 }, // blue
};

/**
 * Distance in a lighting-tolerant space: chromaticity (color proportions,
 * which survive brightness changes) weighted heavily, plus saturation and
 * a little brightness to separate white from grey-ish tints.
 */
export function colorDistance(a: RGB, b: RGB): number {
  const ta = Math.max(1, a.r + a.g + a.b);
  const tb = Math.max(1, b.r + b.g + b.b);
  const dr = a.r / ta - b.r / tb;
  const dg = a.g / ta - b.g / tb;
  const db = a.b / ta - b.b / tb;
  const chroma = Math.sqrt(dr * dr + dg * dg + db * db);

  const sat = (c: RGB) => {
    const max = Math.max(c.r, c.g, c.b);
    return max === 0 ? 0 : (max - Math.min(c.r, c.g, c.b)) / max;
  };
  const value = (c: RGB) => Math.max(c.r, c.g, c.b) / 255;

  return chroma * 3 + Math.abs(sat(a) - sat(b)) * 0.8 + Math.abs(value(a) - value(b)) * 0.25;
}

/** Classifies a sampled RGB against the (possibly calibrated) references. */
export function classifyColor(rgb: RGB, references: Record<Face, RGB> = DEFAULT_REFERENCES): Face {
  let best: Face = 'U';
  let bestDistance = Infinity;
  for (const face of Object.keys(references) as Face[]) {
    const d = colorDistance(rgb, references[face]);
    if (d < bestDistance) {
      bestDistance = d;
      best = face;
    }
  }
  return best;
}

/**
 * Median color of a square window around (cx, cy) — robust against glare,
 * shadows and sticker borders, unlike a plain mean. `pixels` is RGBA.
 */
export function sampleRegion(
  pixels: Uint8Array | Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  cx: number,
  cy: number,
  half: number,
): RGB {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = Math.max(0, cy - half); y < Math.min(imageHeight, cy + half); y++) {
    for (let x = Math.max(0, cx - half); x < Math.min(imageWidth, cx + half); x++) {
      const offset = (y * imageWidth + x) * 4;
      rs.push(pixels[offset]);
      gs.push(pixels[offset + 1]);
      bs.push(pixels[offset + 2]);
    }
  }
  if (rs.length === 0) return { r: 0, g: 0, b: 0 };
  const median = (arr: number[]) => {
    arr.sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)];
  };
  return { r: median(rs), g: median(gs), b: median(bs) };
}

/**
 * Samples the median color of each cell of an N×N grid laid over a square image
 * (row-major). Decoder-agnostic and pure, so it unit-tests directly; the same
 * routine serves 2×2 / 3×3 / 4×4 by varying `n`. Pass a square RGBA image.
 */
export function sampleGrid(
  pixels: Uint8Array | Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  n: number,
): RGB[] {
  const cell = imageWidth / n;
  const samples: RGB[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const cx = Math.round((col + 0.5) * cell);
      const cy = Math.round((row + 0.5) * cell);
      samples.push(sampleRegion(pixels, imageWidth, imageHeight, cx, cy, Math.round(cell * 0.26)));
    }
  }
  return samples;
}

export interface DetectedFace {
  /** Classified face letter for each cell (row-major, length N²). */
  letters: Face[];
  /** Raw sampled colors per cell (row-major) — keep the center to calibrate. */
  samples: RGB[];
}

/**
 * End-to-end match for one already-decoded, square RGBA face image: samples the
 * N×N grid, then classifies each cell. Returns the letters plus the raw samples
 * (use `samples[Math.floor(n*n/2)]`, the center, to calibrate references).
 *
 * @param pixels Flat RGBA bytes, row-major, length `width*height*4`.
 * @param width  Image width in pixels (should equal height — crop to a square).
 * @param height Image height in pixels.
 * @param references Color references (default or calibrated).
 * @param n Grid size: 2, 3 or 4.
 */
export function detectFaceColors(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  references: Record<Face, RGB> = DEFAULT_REFERENCES,
  n = 3,
): DetectedFace {
  const samples = sampleGrid(pixels, width, height, n);
  const letters = samples.map((rgb) => classifyColor(rgb, references));
  return { letters, samples };
}
