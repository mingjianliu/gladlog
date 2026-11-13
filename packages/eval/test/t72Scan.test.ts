/**
 * scan5/t72 (pipeline T72, user ruling R19): the five ruled buttons against
 * the producer's own predicate, and the window lines the check reads.
 */
import { classMetadata } from "@gladlog/analysis/src/data/classSpells";
import { effectiveCooldownSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import {
  isOffensiveCdFor,
  OFFENSIVE_PRESS_FACT_IDS,
} from "@gladlog/analysis/src/utils/spellDanger";
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { RULED, run, WINDOW_RE } from "../scripts/scan5/t72";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5/t72 ruledOffensivePress", () => {
  it("R19 的五个技能在生产谓词里都是进攻大招,名字就是名册打印的名字", () => {
    const rosterName = new Map(
      classMetadata.flatMap((c) =>
        c.abilities.map((a) => [String(a.spellId), a.name] as const),
      ),
    );
    expect(Object.keys(RULED).sort()).toEqual(
      ["153561", "375901", "385059", "426591", "439843"].sort(),
    );
    for (const [id, name] of Object.entries(RULED)) {
      expect(isOffensiveCdFor(id, undefined), id).toBe(true);
      expect(OFFENSIVE_PRESS_FACT_IDS.has(id), id).toBe(false);
      expect(rosterName.get(id), id).toBe(name);
      expect(effectiveCooldownSeconds(id), id).toBe(45);
    }
  });

  it("读 [KILL WINDOW] 与 [VULNERABLE] 行的起止秒", () => {
    const kw = WINDOW_RE.exec(
      "  [KILL WINDOW] 1:28–1:34 on Restoration Druid (Unit-Realm): team offensive CDs ready at 1:28: Frostwyrm's Fury (pressed inside: Reaper's Mark 1:31); your CC ready.",
    )!;
    expect([kw[1], kw[2]]).toEqual(["1:28", "1:34"]);
    expect(
      WINDOW_RE.exec(
        "  [VULNERABLE] 0:40–0:52 (12s) on Arcane Mage (Unit-Realm): no major defensives",
      )?.[2],
    ).toBe("0:52");
    expect(WINDOW_RE.exec("1:28  [ENEMY CD]   5(Enemy): Meteor")).toBeNull();
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
describe("scan5/t72 pressOnlyDeliveryOutsideBurst (codex 81-tk-G-T72-2b)", () => {
  const T0 = 1_000_000;
  const at = (s: number) => T0 + s * 1000;
  const unit = (id: string, hostile: boolean, over: object = {}): any => ({
    id,
    name: id,
    type: CombatUnitType.Player,
    reaction: hostile
      ? CombatUnitReaction.Hostile
      : CombatUnitReaction.Friendly,
    spellCastEvents: [],
    auraEvents: [],
    damageIn: [],
    damageOut: [],
    healOut: [],
    healIn: [],
    deathRecords: [],
    ...over,
  });
  // Meteor pressed at 9.2 s, its impact at 11.49 s, and a second delivery a
  // shield ate whole at 15.2 s — past the producer's reach, so the burst
  // ends at 11.49 s and the scan must say so
  function scan(lateName: string, mateDiesAtS?: number) {
    const mage = unit("mage", false, {
      class: CombatUnitClass.Mage,
      spec: CombatUnitSpec.Mage_Fire,
      spellCastEvents: [
        {
          spellId: "153561",
          spellName: "Meteor",
          srcUnitId: "mage",
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: at(9.2) },
        },
      ],
      damageOut: [
        {
          spellId: "351140",
          spellName: "Meteor",
          srcUnitId: "mage",
          destUnitId: "foe",
          effectiveAmount: 120_000,
          logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: at(11.49) },
        },
        {
          spellId: "17",
          spellName: "Power Word: Shield",
          attackSpellId: "351140",
          attackSpellName: lateName,
          srcUnitId: "mage",
          destUnitId: "foe",
          effectiveAmount: 90_000,
          logLine: { event: "SPELL_ABSORBED", timestamp: at(15.2) },
        },
      ],
    });
    const mate = unit("mate", false, {
      deathRecords:
        mateDiesAtS === undefined ? [] : [{ timestamp: at(mateDiesAtS) }],
    });
    const foe = unit("foe", true);
    const players = [mage, mate, foe];
    const seen: string[] = [];
    let checked = 0;
    run({
      owner: mage,
      players,
      units: players,
      lines: [],
      legacy: {
        startTime: T0,
        endTime: at(30),
        startInfo: { bracket: "3v3" },
        units: Object.fromEntries(players.map((p) => [p.id, p])),
      },
      // the scan harness's cut: a 3v3 stops at its first friendly death
      roundEndAt: mateDiesAtS === undefined ? at(30) : at(mateDiesAtS),
      firstOwnerOfRound: false,
      violate: (c: string, _k: string, _t: number, _f: string, d: string) => {
        if (c === "pressOnlyDeliveryOutsideBurst") seen.push(d);
      },
      bump: (c: string) => {
        if (c === "pressOnlyDeliveryOutsideBurst") checked++;
      },
    } as any);
    return { checked, n: seen.length, detail: seen[0] ?? "" };
  }

  it("爆发窗口之后的投放行被报出来,被盾吃掉的也算", () => {
    const r = scan("Meteor");
    expect(r.checked).toBe(1);
    expect(r.n).toBe(1);
    expect(r.detail).toContain("to +6.00s");
  });

  it("#1 3v3 里队友先死不提前截断:账本的回合到日志结束", () => {
    expect(scan("Meteor", 12).n).toBe(1);
  });

  it("#2 吸收行的攻击技能名是客户端语言,按 id 归到英文名", () => {
    expect(scan("流星").n).toBe(1);
  });
});
