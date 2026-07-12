import fs from "fs-extra";

export interface KeystoneGate {
  spec: string;
  keystoneNodeIds: number[];
  match: "any" | "all";
  metric: string;
  groupPresent: string;
  groupAbsent: string;
}
export interface GateTable {
  wowPatchVersion: string;
  gates: KeystoneGate[];
}

/** Boolean keystone assignment. O(1)-ish, no distance math. */
export function assignBuildGroup(
  talents: number[],
  gate: KeystoneGate,
): string {
  const set = new Set(talents);
  const present =
    gate.match === "all"
      ? gate.keystoneNodeIds.every((id) => set.has(id))
      : gate.keystoneNodeIds.some((id) => set.has(id));
  return present ? gate.groupPresent : gate.groupAbsent;
}

export async function loadGateTable(filePath: string): Promise<GateTable> {
  const t = (await fs.readJson(filePath)) as GateTable;
  return { wowPatchVersion: t.wowPatchVersion, gates: t.gates ?? [] };
}
