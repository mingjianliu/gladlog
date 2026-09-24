/**
 * Arena zone name table (the compliant replacement for the old
 * zoneMetadata.ts — that file was a mix of upstream and our own edits and was
 * not carried over).
 * Source: publicly known Blizzard game facts (instance id → arena name).
 * Contains only the name the prompt needs; to be replaced by the subproject-5
 * pipeline output (which includes map geometry).
 */
interface IZoneMetadata {
  id: string;
  name: string;
}
const z = (id: string, name: string): [string, IZoneMetadata] => [
  id,
  { id, name },
];
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
