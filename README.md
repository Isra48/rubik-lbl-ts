<div align="center">

# rubik-lbl-ts 🧊

### Toolkit de cubo de Rubik en **TypeScript puro, cero dependencias**

Un **solver del método principiante (Layer-by-Layer)** escrito desde cero —
sin librerías de solver externas— más **detección/match de colores de stickers**,
un **motor de movimientos derivado de la geometría** y un **validador de solvabilidad**.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Zero deps](https://img.shields.io/badge/dependencies-0-success?style=for-the-badge)
![MIT](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)

</div>

> Extraído del proyecto [Kiubo](https://github.com/Isra48/Kiubo) y liberado para la
> comunidad cubera. Todo el código es propio: el solver **no** usa `cubejs` ni
> `rubiks-cube-solver`, y el match de stickers **no** depende de ninguna SDK de cámara.

---

## ¿Por qué?

La mayoría de los solvers de JS envuelven librerías de caja negra (Kociemba/two-phase)
que escupen una solución óptima ininteligible para un humano. Este paquete hace lo
contrario: resuelve el cubo **como lo haría un principiante**, en las 7 etapas clásicas
del método por capas, devolviendo la lista de movimientos de cada etapa por separado —
ideal para **enseñar**, **animar paso a paso** o construir un tutor.

Y como bonus, incluye el **algoritmo de match de stickers** para reconstruir el estado
del cubo a partir de fotos de las 6 caras.

---

## Instalación

```bash
npm install rubik-lbl-ts
```

Sin dependencias de runtime. Funciona en Node, navegador y React Native.

---

## Uso rápido

### 1. Resolver con el método principiante

```ts
import { SOLVED_STATE, applyMoves, solveBeginner } from 'rubik-lbl-ts';

// Un cubo revuelto, en notación facelet URFDLB (54 chars).
const scrambled = applyMoves(SOLVED_STATE, "R U R' U' F R F'".split(' '));

const stages = solveBeginner(scrambled);
for (const stage of stages) {
  console.log(`${stage.label}: ${stage.moves.join(' ')}`);
}
// Cruz de la primera capa: ...
// Primera capa (esquinas): ...
// Segunda capa: ...
// Cruz de la última capa: ...
// Aristas de la última capa: ...
// Esquinas: posición: ...
// Esquinas: orientación: ...
```

`solveBeginner` devuelve un arreglo de 7 `BeginnerStage`, cada uno con `{ key, label, moves }`.
Concatena todos los `moves` para obtener la solución completa.

### 2. Match de stickers (reconstruir el cubo desde fotos)

```ts
import {
  detectFaceColors,
  findValidAssembly,
  DEFAULT_REFERENCES,
  type Face,
  type RGB,
} from 'rubik-lbl-ts';

// `pixels` = RGBA plano (4 bytes/pixel) de una foto CUADRADA de una cara.
// Decodifícala con lo que prefieras (canvas getImageData, jpeg-js, sharp, RN…).
const { letters, samples } = detectFaceColors(pixels, width, height, DEFAULT_REFERENCES, 3);

// El centro (índice 4 en 3×3) es la verdad de tierra del color de esa cara:
// úsalo para CALIBRAR las referencias y mejorar las siguientes detecciones.
const calibrated = { ...DEFAULT_REFERENCES, U: samples[4] };

// Junta las 6 caras (escaneadas en cualquier rotación) y deja que el algoritmo
// encuentre el ensamblaje físicamente válido:
const faces: Partial<Record<Face, Face[]>> = { U: lettersU, R: lettersR, /* … */ };
const assembly = findValidAssembly(faces);
if (assembly) {
  console.log(assembly.state); // facelet string listo para solveBeginner()
}
```

### 3. Validar un estado

```ts
import { validateState } from 'rubik-lbl-ts';

const result = validateState(facelet);
if (!result.valid) console.warn(result.reason); // mensajes en español, aptos para UI
```

---

## Cómo funciona

### El solver principiante (Layer-by-Layer)

Trabaja sobre un **modelo _cubie_** rápido (arreglos de permutación + orientación de
piezas, no strings de 54 caracteres). Las tablas de movimiento se **derivan del motor
facelet** en tiempo de carga, así que no pueden desincronizarse de la verdad.

| Etapas | Técnica |
| ------ | ------- |
| **1-3** · cruz, esquinas 1ª capa, aristas 2ª capa | **IDA\*** guiado por **Pattern Database** (distancia exacta de la cruz) + BFS de macros para insertar cada pieza |
| **4-6** · orientación/permutación de aristas y posición de esquinas de la última capa | **BFS sobre "macros"** (algoritmos clásicos: OLL-edge, Sune, T-perm, 3-cycles…) que preservan las dos primeras capas |
| **7** · orientación de esquinas | **Tabla precomputada (Dijkstra)** sobre los **62 208** estados de la última capa |

Las tablas pesadas (PDB de la cruz + tabla de última capa) vienen **precomputadas y
codificadas en base64** (`src/solver/beginnerTables.generated.ts`) para cargar al instante
en lugar de reconstruirlas en runtime (lo que congelaría el hilo de JS en Hermes/React
Native). Si esos strings estuvieran vacíos, el solver las reconstruye solo como _fallback_.

### El match de stickers

1. **Muestreo robusto:** por cada celda de la rejilla N×N toma la **mediana** de una
   ventana de píxeles (resiste brillos, sombras y bordes del sticker mucho mejor que la media).
2. **Clasificación tolerante a iluminación:** compara cada color contra las referencias
   en un espacio que pondera fuerte la **cromaticidad** (proporciones de color, que
   sobreviven a cambios de brillo) más saturación y un poco de brillo. Nearest-neighbor.
3. **Autocalibración:** el centro de cada cara es la verdad de tierra de su color, así que
   puedes reemplazar las referencias con los centros capturados y la detección mejora.
4. **Búsqueda de orientación** (`findValidAssemblies`): como al escanear giras el cubo
   libremente, cada cara llega rotada 0/90/180/270°. Se prueban las **4⁶ = 4096**
   combinaciones de rotación y se queda con las que forman un cubo válido (en la práctica,
   una sola). Así la orientación al escanear deja de importar.

---

## API

### Solver
- `solveBeginner(state): BeginnerStage[]` — resuelve por capas, 7 etapas.

### Motor de movimientos
- `SOLVED_STATE` · `applyMove` · `applyMoves` · `isSolved` · `invertMove` · `invertMoves`
- `parseMove` · `getMoveSpec` (spec de animación: eje, capas, ángulo) · `countStickers`
- `centerString` · `reorientToStandardCenters`

### Validación
- `validateState(state): ValidationResult` — conteos, centros, twist/flip y paridad.

### Match de stickers
- `detectFaceColors(pixels, w, h, refs?, n?)` · `classifyColor` · `colorDistance`
- `sampleGrid` · `sampleRegion` · `DEFAULT_REFERENCES`

### Orientación de escaneo
- `findValidAssembly` · `findValidAssemblies` · `rotateFaceLetters`

### Geometría
- `FACE_ORDER` · `STICKERS` · `BASE_PERMUTATIONS` · `ROTATION_PERMUTATIONS` · `rotateVec`

### Tipos
- `Face` · `FaceletState` · `Move` · `BeginnerStage` · `RGB` · `DetectedFace`
  · `NormalizedScan` · `ValidationResult` · `MoveSpec`

---

## Notación facelet (URFDLB)

El estado es un string de 54 caracteres: 9 stickers por cara en el orden
**U, R, F, D, L, B**, cada cara leída fila por fila desde su esquina superior izquierda.
Idéntica a la convención de `cubejs` / Kociemba. Cubo resuelto:

```
UUUUUUUUU RRRRRRRRR FFFFFFFFF DDDDDDDDD LLLLLLLLL BBBBBBBBB
```

---

## Desarrollo

```bash
npm install
npm run build      # compila a dist/ (CommonJS + .d.ts)
npm run typecheck  # tsc --noEmit
npm test           # node:test — resuelve scrambles fijos y valida el match de color
```

---

## Licencia

[MIT](./LICENSE) © Isra48 — úsalo, modifícalo y compártelo libremente. 🇲🇽
