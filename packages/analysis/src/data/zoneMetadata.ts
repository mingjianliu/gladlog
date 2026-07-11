/**
 * 竞技场区域名表(旧 zoneMetadata.ts 的合规替代——原文件为上游+自有混改,不带走)。
 * 来源:暴雪公开游戏事实(instance id → 竞技场名)。仅含 prompt 所需的 name;
 * 子项目 5 管线产物替换(含地图几何)。
 */
export interface IZoneMetadata {
  id: string;
  name: string;
}
const z = (id: string, name: string): [string, IZoneMetadata] => [id, { id, name }];
export const zoneMetadata: Record<string, IZoneMetadata> = Object.fromEntries([
  z("572", "Ruins of Lordaeron"),
  z("617", "Dalaran Sewers"),
  z("980", "Tol'viron Arena"),
  z("1134", "Tiger's Peak"),
  z("1504", "Black Rook Hold Arena"),
  z("1505", "Nagrand Arena"),
  z("1552", "Ashamane's Fall"),
  z("1672", "Blade's Edge Arena"),
  z("1825", "Hook Point"),
  z("1911", "Mugambala"),
  z("2167", "The Robodrome"),
  z("2373", "Empyrean Domain"),
  z("2509", "Maldraxxus Coliseum"),
  z("2547", "Enigma Crucible"),
  z("2563", "Nokhudon Proving Grounds"),
  z("2759", "Cage of Carnage"),
]);
