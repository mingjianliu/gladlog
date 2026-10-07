// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KpiChips } from "../src/renderer/src/report/components/KpiChips";
import {
  deriveDispelDash,
  scopedMissedPurgeInstances,
} from "../src/renderer/src/report/derive/dispelDash";
import { deriveStatsTable } from "../src/renderer/src/report/derive/statsTable";
import type { StoredMatch } from "../src/renderer/src/report/derive/types";
import { loadMatchFixture } from "./fixtures/loadFixture";

const m = loadMatchFixture();

type RawUnit = {
  id: string;
  name: string;
  info?: unknown;
  reaction: string;
  casts: Array<Record<string, unknown>>;
  actionsOut?: Array<Record<string, unknown>>;
};

/**
 * The fixture has `actionsOut` stripped (loadFixture.ts), so every dispel
 * here is injected: on the first friendly player, a deliberate Purify (cast +
 * dispel at the same instant), a Cleanse the Weak proc (no cast) and a Cat
 * Form rider (listed id). Raw shape mirrors what parser-compat's convert.ts
 * reads: `srcId/destId/spellId` plus the raw `params` array whose [11]/[12]
 * carry the removed aura (extraSpellFields).
 */
function withDispels(): { clone: StoredMatch; me: RawUnit; ally: RawUnit } {
  const clone = JSON.parse(JSON.stringify(m)) as StoredMatch;
  const units = Object.values(
    clone.units as unknown as Record<string, RawUnit>,
  );
  const friends = units.filter((u) => u.info && u.reaction === "Friendly");
  const me = friends[0]!;
  const ally = friends[1] ?? me;
  const t = clone.startTime + 30_000;
  const mk = (spellId: number, spellName: string, ts: number) => ({
    timestamp: ts,
    eventName: "SPELL_DISPEL",
    srcId: me.id,
    srcName: me.name,
    destId: ally.id,
    destName: ally.name,
    spellId,
    spellName,
    params: [
      me.id,
      me.name,
      "0x511",
      "0x0",
      ally.id,
      ally.name,
      "0x512",
      "0x0",
      String(spellId),
      spellName,
      "0x2",
      "589",
      "Shadow Word: Pain",
      "0x20",
      "DEBUFF",
    ],
  });
  me.actionsOut = [
    ...(me.actionsOut ?? []),
    mk(527, "Purify", t),
    mk(199427, "Cleanse the Weak", t + 5000),
    mk(768, "Cat Form", t + 9000),
  ];
  me.casts = [
    ...me.casts,
    {
      timestamp: t,
      eventName: "SPELL_CAST_SUCCESS",
      srcId: me.id,
      srcName: me.name,
      destId: ally.id,
      destName: ally.name,
      spellId: 527,
      spellName: "Purify",
      params: [
        me.id,
        me.name,
        "0x511",
        "0x0",
        ally.id,
        ally.name,
        "0x512",
        "0x0",
        "527",
        "Purify",
        "0x2",
      ],
    },
  ];
  return { clone, me, ally };
}

describe("dispel dashboard splits deliberate vs passive (UI review #3)", () => {
  it("row counts, instance labels and friendly totals", () => {
    const { clone, me } = withDispels();
    const dash = deriveDispelDash(clone);
    const row = dash.rows.find((r) => r.unitId === me.id);
    expect(row).toBeTruthy();
    expect(row!.cleanses).toBe(1);
    expect(row!.passive).toBe(2);
    expect(dash.totals).toEqual({ friendlyDeliberate: 1, friendlyPassive: 2 });
    const passive = row!.events.filter((e) => e.passive);
    expect(passive).toHaveLength(2);
    expect(passive.every((e) => e.label.endsWith("(被动)"))).toBe(true);
    expect(row!.events.find((e) => !e.passive)!.label).not.toContain("被动");
  });

  it("stats table 驱散 column counts deliberate only", () => {
    const { clone, me } = withDispels();
    const rows = deriveStatsTable(clone);
    const mine = rows.find((r) => r.unitId === me.id)!;
    expect(mine.cleanses).toBe(1);
  });

  it("KPI chip renders the deliberate count with a passive suffix", () => {
    const { clone } = withDispels();
    const dash = deriveDispelDash(clone);
    const { container } = render(
      <KpiChips mistakes={[]} bands={[]} kickRows={[]} dispelDash={dash} />,
    );
    const chip = container.querySelector("[data-testid=kpi-dispel]")!;
    expect(chip.querySelector(".rpt-kpi-v")!.textContent).toMatch(/^1/);
    expect(chip.querySelector(".rpt-kpi-passive")!.textContent).toBe("+2 被动");
  });

  it("no passive dispels → no suffix (the unmodified fixture has none)", () => {
    const dash = deriveDispelDash(m);
    const { container } = render(
      <KpiChips mistakes={[]} bands={[]} kickRows={[]} dispelDash={dash} />,
    );
    expect(container.querySelector(".rpt-kpi-passive")).toBeNull();
  });
});

/**
 * B-tier X1 (user ruling 2026-10-06): the dispel panel lists the windows only
 * a scoped removal could have answered — Shattering Throw on an immunity
 * shield — for each teammate who holds it, the ones that were not actionable
 * included and flagged (the prompt's "not actionable"). 47867c33 round 1
 * 1:41: Divine Shield on a Holy Paladin, unpurged for 8 s, an Arms Warrior
 * with Shattering Throw.
 */
describe("dispel panel: scoped missed removals (X1)", () => {
  const tool = {
    name: "Shattering Throw",
    scope: "immunity" as const,
    note: "immunity shields only, 1.5s cast",
    castSeconds: 1.5,
  };
  // only `name` and the spec are read: an Arms Warrior is no general purger
  const warrior = { id: "w1", name: "Warrior-R", spec: "71" } as never;
  const priest = { id: "p1", name: "Priest-R", spec: "256" } as never;
  const win = (
    over: Record<string, unknown>,
    holder: Record<string, unknown>,
  ) =>
    ({
      timeSeconds: 101.2,
      durationSeconds: 8,
      enemyName: "Paladin-E",
      enemySpec: "Holy Paladin",
      spellName: "Divine Shield",
      spellId: "642",
      priority: "Critical",
      purgeWasOnCD: false,
      teamUnderPressure: false,
      purgersLockedOut: false,
      losReachable: true,
      scopedPurgers: [
        {
          purgerName: "Warrior-R",
          tool,
          lockedOut: false,
          losReachable: true,
          ...holder,
        },
      ],
      ...over,
    }) as never;

  it("an actionable window: one row naming the tool and its holder, no flag", () => {
    const rows = scopedMissedPurgeInstances([warrior, priest], [win({}, {})]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tS).toBe(101.2);
    expect(rows[0]!.unitName).toBe("Paladin-E");
    expect(rows[0]!.label).toContain("挂在 Paladin-E 身上 8s 未被打掉");
    expect(rows[0]!.label).toContain("可用 Shattering Throw(Warrior-R)");
    expect(rows[0]!.label).not.toContain("当时做不到");
    expect(rows[0]!.notActionable).toBeUndefined();
  });

  it("a window its holder could not answer is still listed, flagged with the reason", () => {
    const flagged = (holder: Record<string, unknown>) =>
      scopedMissedPurgeInstances([warrior], [win({}, holder)])[0]!;
    const locked = flagged({ lockedOut: true });
    expect(locked.notActionable).toBe(true);
    expect(locked.label).toContain("(持有者被控/被锁)");
    expect(locked.label.endsWith(" · 当时做不到")).toBe(true);
    expect(flagged({ losReachable: false }).label).toContain(
      "(无视线/超射程) · 当时做不到",
    );
    // back with 3 s of the buff left: under the 3 s reaction + 1.5 s cast
    const onCd = flagged({ purgeReadyAtSeconds: 106.2 });
    expect(onCd.label).toContain("(技能全程在 CD) · 当时做不到");
    // back with 6 s left: actionable again
    expect(
      flagged({ purgeReadyAtSeconds: 103.2 }).notActionable,
    ).toBeUndefined();
    // an unknown reach is not a reason
    expect(flagged({ losReachable: null }).notActionable).toBeUndefined();
  });

  it("nobody holding a scoped removal: no rows; and the time range filters them", () => {
    expect(scopedMissedPurgeInstances([priest], [win({}, {})])).toEqual([]);
    expect(
      scopedMissedPurgeInstances([warrior], [win({}, {})], {
        fromS: 0,
        toS: 60,
      } as never),
    ).toEqual([]);
  });

  it("the unmodified fixture has no scoped window: the panel's list is what it was", () => {
    const dash = deriveDispelDash(m);
    expect(dash.missedPurges.some((i) => i.label.includes("可用 "))).toBe(
      false,
    );
  });
});
