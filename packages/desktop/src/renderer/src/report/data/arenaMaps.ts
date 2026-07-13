/**
 * 每个竞技场(zoneId)的世界坐标包围盒 + minimap 底图。
 * 数据来自 @gladlog/analysis arenaGeometry.ts 的校准注释(5 px/世界单位):
 *   pixelX = (maxX - gameX) * 5   pixelY = (gameY - minY) * 5
 *   imgW   = (maxX - minX) * 5     imgH   = (maxY - minY) * 5
 * 底图从 wowarenalogs 公共 CDN 运行时加载(不入仓库——版权 + 体积)。
 * 除纳格兰(1505,已用真实位置校验)外,其余为近似,后续按需微调。
 */
export interface ArenaMap {
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

export function arenaMapUrl(zoneId: string | number): string {
  return `https://images.wowarenalogs.com/minimaps/${zoneId}.png`;
}

/** 底图像素尺寸(= 世界跨度 × 5)。 */
export const arenaPx = (a: ArenaMap) => ({
  w: (a.maxX - a.minX) * PX_PER_UNIT,
  h: (a.maxY - a.minY) * PX_PER_UNIT,
});

/** 世界坐标 → 底图像素(x 轴翻转,y 向下)。 */
export const arenaToPx = (a: ArenaMap, x: number, y: number) => ({
  x: (a.maxX - x) * PX_PER_UNIT,
  y: (y - a.minY) * PX_PER_UNIT,
});
