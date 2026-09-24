/**
 * World-coordinate bounding box per arena (zoneId), plus the minimap base image.
 * The data comes from the calibration notes in @gladlog/analysis
 * arenaGeometry.ts (5 px per world unit):
 *   pixelX = (maxX - gameX) * 5   pixelY = (gameY - minY) * 5
 *   imgW   = (maxX - minX) * 5     imgH   = (maxY - minY) * 5
 * The base image ships with the bundle (see arenaMapUrl below).
 * Except for Nagrand (1505, validated against real positions), the values are
 * approximate and will be refined as needed.
 */
interface ArenaMap {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const ARENA_MAPS: Record<string, ArenaMap> = {
  "1505": { minX: -2091, maxX: -1998, minY: 6605, maxY: 6704 }, // Nagrand
  "1672": { minX: 2732, maxX: 2833, minY: 5951, maxY: 6061 }, // Blade's Edge
  "572": { minX: 1239, maxX: 1334, minY: 1580, maxY: 1742 }, // Ruins of Lordaeron
  "617": { minX: 1227, maxX: 1351, minY: 744, maxY: 836 }, // Dalaran Sewers
  "1134": { minX: 495, maxX: 635, minY: 573, maxY: 685 }, // Tiger's Peak
  "980": { minX: -10781, maxX: -10654, minY: 379, maxY: 483 }, // Tol'viron
  "1504": { minX: 1366, maxX: 1467, minY: 1190, maxY: 1286 }, // Black Rook Hold
  "1552": { minX: 3500, maxX: 3603, minY: 5478, maxY: 5586 }, // Ashamane's Fall
  "1911": { minX: -1994, maxX: -1888, minY: 1237, maxY: 1354 }, // Mugambala
  "1825": { minX: 965, maxX: 1052, minY: -369, maxY: -292 }, // Hook Point
  "2167": { minX: -372, maxX: -190, minY: -328, maxY: -232 }, // The Robodrome
  "2373": { minX: -1307, maxX: -1187, minY: 669, maxY: 786 }, // Empyrean Domain
  "2509": { minX: 2772, maxX: 2893, minY: 2180, maxY: 2331 }, // Maldraxxus Coliseum
  "2547": { minX: 156, maxX: 367, minY: 196, maxY: 338 }, // Enigma Crucible
  "2563": { minX: -595, maxX: -473, minY: 4120, maxY: 4230 }, // Nokhudon
};

const PX_PER_UNIT = 5;

export function arenaMap(
  zoneId: string | number | undefined,
): ArenaMap | undefined {
  return zoneId == null ? undefined : ARENA_MAPS[String(zoneId)];
}

// There used to be an arenaMapUrl() here: first hotlinking
// images.wowarenalogs.com's minimaps/<zoneId>.png, then briefly (2026-08-01)
// bundling the images. Both are gone — inspection showed those PNGs contain
// **no map artwork at all**, just a transparent background plus a few opaque
// rectangles, and those rectangles line up one-for-one with this repo's own
// arenaObstacles (1505: 4↔4, 1911: 3↔3, 2547: 4↔4, off by a few pixels). In
// other words the base image only re-drew obstacles the replay already renders:
// zero visual gain, in exchange for either depending on someone else's CDN or
// putting binaries of unclear provenance into an MIT repo.
//
// Everything the replay draws on the ground comes from our own data: the
// outline from arenaFloors.json (mined from position samples) and the obstacles
// from @gladlog/analysis's arenaObstacles (same source as the LoS predicate,
// covering 16 zones — one more (2759) than those PNGs). See
// docs/DATA-COMPLIANCE.md.

/** Base-image pixel size (= world span × 5). */
export const arenaPx = (a: ArenaMap) => ({
  w: (a.maxX - a.minX) * PX_PER_UNIT,
  h: (a.maxY - a.minY) * PX_PER_UNIT,
});

/** World coordinates → base-image pixels (x axis flipped, y downwards). */
export const arenaToPx = (a: ArenaMap, x: number, y: number) => ({
  x: (a.maxX - x) * PX_PER_UNIT,
  y: (y - a.minY) * PX_PER_UNIT,
});
