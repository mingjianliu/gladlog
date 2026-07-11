/**
 * Arena obstacle geometry for line-of-sight checks.
 *
 * All coordinates are in WoW game space (same system as advancedActorPositionX/Y).
 * The arena bounds per zone are in zoneMetadata.ts for reference.
 *
 * Coordinate derivation:
 *   gameX = zone.maxX - imagePixelX / 5
 *   gameY = zone.minY + imagePixelY / 5
 *
 * Shape types:
 *   circle  — cylindrical pillar: center (cx, cy) and radius r
 *   polygon — arbitrary convex obstacle: vertices as [x, y][] in order
 *
 * Accuracy:
 *   Nagrand (1505) — validated against real position data from combat logs.
 *   All other arenas — measured from minimap images at
 *   https://images.wowarenalogs.com/minimaps/{zoneId}.png; approximate.
 *   Refine as more advanced-logging position data is collected.
 */

export type CircleObstacle = {
  type: 'circle';
  cx: number;
  cy: number;
  r: number;
};

export type PolygonObstacle = {
  type: 'polygon';
  vertices: [number, number][];
};

export type ArenaObstacle = CircleObstacle | PolygonObstacle;

/**
 * Per-zone obstacle list. Key = zoneId string (matches combat.startInfo.zoneId).
 */
export const arenaObstacles: Record<string, ArenaObstacle[]> = {
  // ---------------------------------------------------------------------------
  // Nagrand Arena — 4 cylindrical pillars arranged asymmetrically.
  // Measured from minimap image (465×495 px, 5 px/unit).
  // zone bounds: minX=-2091 maxX=-1998 minY=6605 maxY=6704
  // Calibration history:
  //   r=5.5 → r=3.5 → r=3.0 → r=2.5 (2026 H1): shrank radii to eliminate violations.
  //   Jul 2026 void analysis (617k samples, 790-log corpus) showed that was the wrong
  //   fix: the pillars were mis-POSITIONED, not oversized. Each real pillar leaves a
  //   ~9×9 zero-sample void (r≈4); the drawn centers sat on the void EDGES, so
  //   shrinking "fixed" violations while under-blocking. Recentered on the observed
  //   voids, r=4 (0.5-unit inset from the void bbox).
  // ---------------------------------------------------------------------------
  '1505': [
    { type: 'circle', cx: -2044.5, cy: 6623.5, r: 4 }, // north pillar (void x[-2049..-2040] y[6619..6627])
    { type: 'circle', cx: -2018, cy: 6638.5, r: 4 }, // east pillar (void x[-2022..-2014] y[6634..6642])
    { type: 'circle', cx: -2042, cy: 6685.5, r: 4 }, // south pillar (void x[-2046..-2038] y[6681..6689])
    { type: 'circle', cx: -2071.5, cy: 6670, r: 4 }, // west pillar (void x[-2075..-2068] y[6666..6673])
  ],

  // ---------------------------------------------------------------------------
  // Blade's Edge Arena — elevated H-shaped bridge with ramp columns.
  // 505×550 px. zone bounds: minX=2732 maxX=2833 minY=5951 maxY=6061
  // Three-piece structure: top-right column, central spine, bottom-left column.
  // ---------------------------------------------------------------------------
  '1672': [
    {
      type: 'polygon',
      vertices: [
        [2774, 5962],
        [2744, 5962],
        [2744, 5985],
        [2774, 5985],
      ],
    }, // top-right column
    {
      type: 'polygon',
      vertices: [
        [2804, 5982],
        [2755, 5982],
        [2755, 6011],
        [2804, 6011],
      ],
    }, // central spine
    {
      type: 'polygon',
      vertices: [
        [2828, 6016],
        [2802, 6016],
        [2802, 6044],
        [2828, 6044],
      ],
    }, // bottom-left column
  ],

  // ---------------------------------------------------------------------------
  // Ruins of Lordaeron — large central tomb + 2 small decorative pillars.
  // 475×810 px. zone bounds: minX=1239 maxX=1334 minY=1580 maxY=1742
  // Obs#0 (central tomb): ~8339 violations across 12 logs — confirmed ELEVATED WALKABLE
  //   surface. Players stand on top of the sarcophagus. 2D limitation: do not shrink.
  // Obs#1 (east pillar): 495 violations, min_dist 0.0–0.3 from centroid → edge-touching.
  //   Shrunk by 1 unit on each side (was 5×6, now 3×4).
  // Obs#2 (west pillar): 361 violations, min_dist 0.5–1.2 → edge-touching.
  //   Shrunk by 1 unit on each side (was 3×5, now 1×3).
  // Calibrated from 12 combat logs, ~120k samples (Apr 2026).
  // ---------------------------------------------------------------------------
  // Jul 2026 recalibration + Jul 2026-b phantom removal (ring-density audit +
  // Gemini/minimap visual cross-check). Void% alone can't tell a solid pillar
  // (players hug all 4 sides) from an out-of-bounds void (a near-empty side):
  // four "data-derived structures" added here were phantoms — the NE/SE/E/NW
  // voids sit OUTSIDE the arena floor (min-side 17–45 samples vs 2000+ for real
  // structures; all four read "black/empty" on the minimap). Removed. The 3
  // survivors have all 4 sides densely surrounded by players.
  '572': [
    {
      type: 'polygon',
      vertices: [
        [1295, 1659],
        [1276, 1659],
        [1276, 1672],
        [1295, 1672],
      ],
    }, // central tomb (⚠ ELEVATED — violations expected, do not shrink)
    {
      type: 'polygon',
      vertices: [
        [1317, 1675],
        [1314, 1675],
        [1314, 1679],
        [1317, 1679],
      ],
    }, // small pillar (west) — ring-confirmed real (all sides hugged)
    {
      type: 'polygon',
      vertices: [
        [1258, 1656],
        [1252, 1656],
        [1252, 1660],
        [1258, 1660],
      ],
    }, // W structure — ring-confirmed real (min-side 2114)
  ],

  // ---------------------------------------------------------------------------
  // Dalaran Sewers — REBUILT Jul 2026, phantoms removed Jul 2026-b.
  // 620×460 px. zone bounds: minX=1227 maxX=1351 minY=744 maxY=836
  // The former two 14×45 "stone blocks" were fictional (above-ambient density,
  // 180k violations) — replaced with 4 void-derived structures. A later
  // ring-density audit + Gemini/minimap visual check found 2 of those 4 (the
  // "east structure" + "north box") were also phantoms: they sit on open floor
  // outside the platform (min-side 28 / 104 samples vs 6000+ for the 2 real
  // diamonds). Removed. The 2 survivors are surrounded on all sides.
  // ---------------------------------------------------------------------------
  '617': [
    {
      type: 'polygon',
      vertices: [
        [1312, 771],
        [1305, 771],
        [1305, 778],
        [1312, 778],
      ],
    }, // center-east diamond — ring-confirmed real (min-side 6932)
    {
      type: 'polygon',
      vertices: [
        [1278, 804],
        [1271, 804],
        [1271, 812],
        [1278, 812],
      ],
    }, // center-south diamond — ring-confirmed real (min-side 6339)
  ],

  // ---------------------------------------------------------------------------
  // Tiger's Peak — REBUILT Jul 2026 (75 logs / 810k samples, void analysis).
  // 700×560 px. zone bounds: minX=495 maxX=635 minY=573 maxY=685
  // The two r=10 "pillars" were removed: their footprints have NO contiguous
  // zero-sample core (3–6% scattered void) — they are low walkable daises, not
  // sight blockers, and produced 23k violations + the Tiger's Peak share of the
  // sweep's false "LoS blocked" annotations. The two wall segments are real
  // (98–100% void) and are tightened to their observed footprints. North-band
  // (y<585) voids are the starting pen area and are deliberately not modeled.
  // ---------------------------------------------------------------------------
  '1134': [
    {
      type: 'polygon',
      vertices: [
        [596, 629],
        [588, 629],
        [588, 637],
        [596, 637],
      ],
    }, // west wall segment (observed void 29 cells)
    {
      type: 'polygon',
      vertices: [
        [545, 630],
        [541, 630],
        [541, 637],
        [545, 637],
      ],
    }, // east wall segment (observed void 22 cells)
  ],

  // ---------------------------------------------------------------------------
  // Tol'Viron Arena — 1 square pillar (north) + 2 diamond pillars (south-west, south-east).
  // 635×520 px. zone bounds: minX=-10781 maxX=-10654 minY=379 maxY=483
  // ---------------------------------------------------------------------------
  '980': [
    {
      type: 'polygon',
      vertices: [
        [-10709, 396],
        [-10719, 396],
        [-10719, 403],
        [-10709, 403],
      ],
    }, // north pillar (axis-aligned square)
    {
      type: 'polygon',
      vertices: [
        [-10687, 445],
        [-10683, 449],
        [-10687, 453],
        [-10691, 449],
      ],
    }, // south-west diamond pillar
    {
      type: 'polygon',
      vertices: [
        [-10740, 445],
        [-10736, 449],
        [-10740, 453],
        [-10744, 449],
      ],
    }, // south-east diamond pillar
  ],

  // ---------------------------------------------------------------------------
  // Black Rook Hold Arena — single central circular pillar.
  // 505×480 px. zone bounds: minX=1366 maxX=1467 minY=1190 maxY=1286
  // ---------------------------------------------------------------------------
  '1504': [
    // Jul 2026 void analysis (485k samples): real pillar void is 8×8 at
    // x[1417..1424] y[1244..1251] — recentered and grown from r=3.5.
    { type: 'circle', cx: 1421, cy: 1248, r: 4 }, // central pillar
  ],

  // ---------------------------------------------------------------------------
  // Ashamane's Fall — 1 rectangular stone + 2 diamond tree-root pillars.
  // 515×540 px. zone bounds: minX=3500 maxX=3603 minY=5478 maxY=5586
  // ---------------------------------------------------------------------------
  // Jul 2026 void analysis (724k samples): diamonds enlarged to their observed
  // voids (46/44 cells).
  '1552': [
    {
      type: 'polygon',
      vertices: [
        [3574, 5532],
        [3566, 5532],
        [3566, 5538],
        [3574, 5538],
      ],
    }, // central stone structure (void 88%)
    {
      type: 'polygon',
      vertices: [
        [3526.5, 5519.5],
        [3522, 5524],
        [3517.5, 5519.5],
        [3522, 5515],
      ],
    }, // north-east diamond pillar (void x[3517..3526] y[5516..5522])
    {
      type: 'polygon',
      vertices: [
        [3528, 5554],
        [3523.5, 5558.5],
        [3519, 5554],
        [3523.5, 5549.5],
      ],
    }, // south-east diamond pillar (void x[3519..3527] y[5550..5557])
    // NOTE: further void clusters exist near the west/north zone boundary
    // (x<=3503, y<=5497) but sit on the nominal play-bounds edge — likely
    // decor/alcoves, deliberately not modeled.
  ],

  // ---------------------------------------------------------------------------
  // Mugambala — 2 small square totems (west side) + 1 tall rectangular column (east).
  // 530×585 px. zone bounds: minX=-1994 maxX=-1888 minY=1237 maxY=1354
  // ---------------------------------------------------------------------------
  '1911': [
    {
      type: 'polygon',
      vertices: [
        [-1918, 1281],
        [-1924, 1281],
        [-1924, 1287],
        [-1918, 1287],
      ],
    }, // north-west totem
    {
      type: 'polygon',
      vertices: [
        [-1918, 1312],
        [-1924, 1312],
        [-1924, 1318],
        [-1918, 1318],
      ],
    }, // south-west totem
    {
      type: 'polygon',
      vertices: [
        [-1962, 1292],
        [-1970, 1292],
        [-1970, 1308],
        [-1962, 1308],
      ],
    }, // east tall column
  ],

  // ---------------------------------------------------------------------------
  // Hook Point — 2 small square pillars.
  // 435×385 px. zone bounds: minX=965 maxX=1052 minY=-369 maxY=-292
  // ---------------------------------------------------------------------------
  // Jul 2026 void analysis (633k samples): both pillars were drawn on the EDGE
  // of their real voids (verdict SUSPECT, 40–50% void). Replaced with the
  // observed 8–9-unit-square voids (53/56 cells, density ~0.7 = round-ish).
  '1825': [
    {
      type: 'polygon',
      vertices: [
        [1036, -330],
        [1030, -330],
        [1030, -323],
        [1036, -323],
      ],
    }, // west pillar (void x[1029..1036] y[-331..-323])
    {
      type: 'polygon',
      vertices: [
        [1007, -320],
        [1000, -320],
        [1000, -313],
        [1007, -313],
      ],
    }, // east pillar (void x[999..1007] y[-321..-313])
  ],

  // ---------------------------------------------------------------------------
  // The Robodrome — 2 diamond pillars (moving central platform excluded).
  // 910×480 px. zone bounds: minX=-372 maxX=-190 minY=-328 maxY=-232
  // ---------------------------------------------------------------------------
  '2167': [
    {
      type: 'polygon',
      vertices: [
        [-261, -303],
        [-257, -299],
        [-261, -295],
        [-265, -299],
      ],
    }, // west diamond pillar
    {
      type: 'polygon',
      vertices: [
        [-305, -303],
        [-301, -299],
        [-305, -295],
        [-309, -299],
      ],
    }, // east diamond pillar
  ],

  // ---------------------------------------------------------------------------
  // Empyrean Domain — 4 small diamond crystal pillars arranged in a diamond pattern.
  // 600×585 px. zone bounds: minX=-1307 maxX=-1187 minY=669 maxY=786
  // ---------------------------------------------------------------------------
  // Jul 2026 void analysis (522k samples): three of four crystals were drawn on
  // the edges of their real voids (SUSPECT, 41–69% void). Recentered on the
  // observed ~8-unit voids (33–37 cells each) and enlarged to half-diagonal 4.5.
  '2373': [
    {
      type: 'polygon',
      vertices: [
        [-1246.5, 700.5],
        [-1251, 705],
        [-1255.5, 700.5],
        [-1251, 696],
      ],
    }, // north crystal (void x[-1255..-1248] y[697..703])
    {
      type: 'polygon',
      vertices: [
        [-1216.5, 729.5],
        [-1221, 734],
        [-1225.5, 729.5],
        [-1221, 725],
      ],
    }, // east crystal (void x[-1225..-1218] y[726..732])
    {
      type: 'polygon',
      vertices: [
        [-1275.5, 730],
        [-1280, 734.5],
        [-1284.5, 730],
        [-1280, 725.5],
      ],
    }, // west crystal (void x[-1284..-1277] y[726..733])
    {
      type: 'polygon',
      vertices: [
        [-1246.5, 760],
        [-1251, 764.5],
        [-1255.5, 760],
        [-1251, 755.5],
      ],
    }, // south crystal (void x[-1255..-1248] y[756..763])
  ],

  // ---------------------------------------------------------------------------
  // Maldraxxus Coliseum — 3 bone/pillar obstacles (2 large, 1 smaller).
  // 605×755 px. zone bounds: minX=2772 maxX=2893 minY=2180 maxY=2331
  // Obs#0 (north-east): 164 violations → 7 after 1st shrink → shrunk 2nd pass (now 8×6).
  // Obs#1 (south-west): 44 violations → 12 after 1st shrink → shrunk 2nd pass (now 8×7).
  // Obs#2 (south-east, 6×6): 1 violation, min_dist=1.3 — borderline. Held for more data.
  // Calibrated from 12 combat logs, ~120k samples (Apr 2026).
  // ---------------------------------------------------------------------------
  '2509': [
    {
      type: 'polygon',
      vertices: [
        [2814, 2226],
        [2806, 2226],
        [2806, 2232],
        [2814, 2232],
      ],
    }, // north-east pillar — shrunk 2nd pass Apr 2026
    {
      type: 'polygon',
      vertices: [
        [2867, 2251],
        [2859, 2251],
        [2859, 2258],
        [2867, 2258],
      ],
    }, // south-west pillar — shrunk 2nd pass Apr 2026
    {
      type: 'polygon',
      vertices: [
        [2809, 2273],
        [2803, 2273],
        [2803, 2279],
        [2809, 2279],
      ],
    }, // south-east pillar (smaller) — held pending more data
  ],

  // ---------------------------------------------------------------------------
  // Enigma Crucible — 4 hexagonal crystal clusters (2 large + 2 small), modelled as circles.
  // 1055×710 px. zone bounds: minX=156 maxX=367 minY=196 maxY=338
  // Large clusters (#0, #3) reduced r=6→r=5 from TWW 11.0+ position data (edge-touching
  // violations at 4.5–5.9 units from center across ~20 matches).
  // ---------------------------------------------------------------------------
  '2547': [
    { type: 'circle', cx: 291, cy: 250, r: 5 }, // north-west cluster (large)
    { type: 'circle', cx: 255, cy: 240, r: 3 }, // north-east single
    { type: 'circle', cx: 278, cy: 293, r: 3 }, // south-west single
    { type: 'circle', cx: 241, cy: 280, r: 5 }, // south-east cluster (large)
  ],

  // ---------------------------------------------------------------------------
  // Nokhudon Proving Grounds — 2 tilted pillars + 2 round pillars + 1 diagonal wall.
  // 610×550 px. zone bounds: minX=-595 maxX=-473 minY=4120 maxY=4230
  // Obs#0 (north-west tilted, r=4): 915 violations, min_dist=0.3 from center.
  //   Players pass THROUGH the center → ELEVATED WALKABLE surface. Do not shrink.
  // Obs#1 (north-east round, r=3): 9 violations, min_dist=5.2 — borderline, held.
  // Obs#2 (central diagonal wall): 70 violations likely from elevated ramp geometry.
  //   2D limitation — do not shrink.
  // Obs#3 (south-west round, r=3): clean.
  // Obs#4 (south-east tilted, r=4): 936 violations, min_dist=0.3 from center.
  //   Players pass THROUGH the center → ELEVATED WALKABLE surface. Do not shrink.
  // Calibrated from 6 combat logs, ~20k samples (Apr 2026).
  // ---------------------------------------------------------------------------
  // Jul 2026 recalibration (55 logs / 610k samples, zero-density void analysis):
  // the two "tilted pillars" (former obs#0/#4) were removed — zero void cells in
  // their footprints and at/above-ambient sample density means they are walkable
  // daises, not sight blockers. The two round pillars are real solid structures;
  // replaced with their observed void footprints (56 and 53 contiguous cells).
  // Central diagonal wall kept as-is (88% void — correct, slightly conservative).
  '2563': [
    {
      type: 'polygon',
      vertices: [
        [-547, 4151],
        [-554, 4151],
        [-554, 4158],
        [-547, 4158],
      ],
    }, // north-east round pillar (observed void 56 cells; inset 1 unit — round pillar in a square void bbox)
    {
      type: 'polygon',
      vertices: [
        [-519, 4170],
        [-521, 4168],
        [-546, 4184],
        [-544, 4186],
      ],
    }, // central diagonal wall (⚠ partially elevated — violations expected)
    {
      type: 'polygon',
      vertices: [
        [-512, 4193],
        [-518, 4193],
        [-518, 4199],
        [-512, 4199],
      ],
    }, // south-west round pillar (observed void 53 cells; inset 1 unit — round pillar in a square void bbox)
  ],

  // ---------------------------------------------------------------------------
  // Cage of Carnage — geometry built entirely from Jul 2026 void analysis
  // (503k samples, 790-log corpus; the old zone-2373-inherited coords were
  // ~1700 units wrong and had been cleared). Five compact zero-sample voids
  // (density >=0.5 in bbox) adopted as solid obstacles.
  // ---------------------------------------------------------------------------
  '2759': [
    {
      type: 'polygon',
      vertices: [
        [418, 410],
        [411, 410],
        [411, 416],
        [418, 416],
      ],
    }, // south-west structure (void 46 cells)
    {
      type: 'polygon',
      vertices: [
        [475, 352],
        [469, 352],
        [469, 358],
        [475, 358],
      ],
    }, // north-east structure (void 44 cells)
    {
      type: 'polygon',
      vertices: [
        [427, 363],
        [422, 363],
        [422, 368],
        [427, 368],
      ],
    }, // west structure (void 25 cells)
    {
      type: 'polygon',
      vertices: [
        [465, 401],
        [460, 401],
        [460, 406],
        [465, 406],
      ],
    }, // east structure (void 25 cells)
    // NW structure removed Jul 2026-b: the original 17-cell void was a
    // small-sample artifact — on the full 2M-sample corpus its footprint is
    // WALKED THROUGH (void 0%), so it is not a solid LoS blocker.
  ],
};
