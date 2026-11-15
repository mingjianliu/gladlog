/**
 * scan5 `hasteScaledExactBack` (pipeline T111, ruling R47): a line pricing a
 * haste-scaled cooldown of its holder's spec prints no exact return.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t111";

const START = 1_000_000;

function scan(lines: string[]): { checked: number; kinds: string[] } {
  const owner = {
    id: "O",
    name: "Owner",
    spec: CombatUnitSpec.Paladin_Protection,
  };
  const units: Record<string, { id: string; name: string; spec: string }> = {
    "2": { id: "M", name: "Mate", spec: CombatUnitSpec.Paladin_Retribution },
    "6": { id: "E", name: "Enemy", spec: CombatUnitSpec.DemonHunter_Devourer },
    "5": {
      id: "P",
      name: "EnemyProt",
      spec: CombatUnitSpec.Paladin_Protection,
    },
  };
  let checked = 0;
  const kinds: string[] = [];
  run({
    lines,
    start: START,
    roundEndAt: START + 600_000,
    owner,
    unitOfPid: (pid: string | undefined) =>
      pid === undefined ? undefined : units[pid],
    bump: () => checked++,
    violate: (_c: string, k: string) => kinds.push(k),
  } as unknown as Parameters<typeof run>[0]);
  return { checked, kinds };
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("hasteScaledExactBack", () => {
  it("a Devourer's Pierce the Veil [PRESS] with an exact back is a violation", () => {
    expect(
      scan([
        "0:24  [PRESS]   6(DDHunter) (Devourer Demon Hunter): Pierce the Veil (30s cd, back 0:54)",
      ]),
    ).toEqual({ checked: 1, kinds: ["press"] });
    expect(
      scan([
        "0:24  [PRESS]   6(DDHunter) (Devourer Demon Hunter): Pierce the Veil (30s cd, cooldown shortens with haste)",
      ]),
    ).toEqual({ checked: 1, kinds: [] });
  });
  it("an enemy Protection kick with `; back` is a violation", () => {
    expect(
      scan([
        "0:16  [KICK]   5(PPaladin) interrupted 1(HPriest)'s Flash Heal (Avenger's Shield; back 0:31)",
      ]),
    ).toEqual({ checked: 1, kinds: ["kick"] });
  });
  it("[RES]: the owner's (Protection) entry must read ≤Ns; a Retribution mate's is not checked", () => {
    expect(
      scan([
        "      [RES] rdy:—  cd:Execution Sentence(40s),2:Execution Sentence(40s)",
      ]),
    ).toEqual({ checked: 1, kinds: ["res"] });
    expect(scan(["      [RES] rdy:—  cd:Execution Sentence(≤40s)"])).toEqual({
      checked: 1,
      kinds: [],
    });
  });
});
