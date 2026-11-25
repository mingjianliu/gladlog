// @vitest-environment jsdom
import { render } from "@testing-library/react";

import { GcdSwimlane } from "../src/renderer/src/report/components/GcdSwimlane";
import { deriveReplay } from "../src/renderer/src/report/derive/replay";
import type { StoredMatch } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

/** One friendly player casts a Polymorph (CC) at an enemy and a filler nuke at
 *  the same enemy; chips must surface the target — CC targets prominently. */
function buildSynthetic(): { s: StoredMatch; casterId: string; t0: number } {
  const s = JSON.parse(JSON.stringify(m)) as StoredMatch;
  const units = s.units as Record<string, any>;
  const caster = Object.values(units).find(
    (u: any) => u.info && u.reaction === "Friendly",
  ) as any;
  const enemy = Object.values(units).find(
    (u: any) => u.info && u.reaction === "Hostile",
  ) as any;
  const t0 = s.startTime + 30_000;
  const cast = (spellId: number, spellName: string, timestamp: number) => ({
    eventName: "SPELL_CAST_SUCCESS",
    timestamp,
    spellId,
    spellName,
    srcId: caster.id,
    srcName: caster.name,
    destId: enemy.id,
    destName: "Targetdude-SomeRealm-US",
    params: [],
  });
  caster.casts = [
    ...(caster.casts ?? []),
    cast(118, "Polymorph", t0),
    // 116 Frostbolt: keypress-table spell, not a CC
    cast(116, "Frostbolt", t0 + 3_000),
  ];
  return { s, casterId: caster.id, t0 };
}

function renderLane(s: StoredMatch, compact: boolean) {
  const rep = deriveReplay(s);
  return render(
    <GcdSwimlane
      source={s}
      tracks={rep.tracks}
      t={s.startTime}
      startTime={s.startTime}
      endTime={s.endTime}
      selUnits={Object.fromEntries(rep.tracks.map((tr) => [tr.unitId, true]))}
      onToggle={() => {}}
      playing={false}
      compact={compact}
    />,
  ).container;
}

describe("GCD 泳道施法对象", () => {
  it("非紧凑:打在别人身上的施法 chip 显示 →短目标名;控制类带 cc 样式", () => {
    const { s } = buildSynthetic();
    const c = renderLane(s, false);
    const targets = Array.from(c.querySelectorAll(".rpt-gcd-act-target"));
    // 变形与冰箭都对敌施放 → 都有目标后缀(服务器后缀截掉)
    const texts = targets.map((el) => el.textContent);
    expect(texts.some((tx) => tx?.includes("Targetdude"))).toBe(true);
    expect(texts.some((tx) => tx?.includes("SomeRealm"))).toBe(false);
    // 控制类目标醒目:变形术所在 chip 的目标元素带 cc class
    expect(c.querySelector(".rpt-gcd-act-target.cc")).toBeTruthy();
  });

  it("紧凑:仅控制类显示目标,非控制类不显示", () => {
    const { s } = buildSynthetic();
    const c = renderLane(s, true);
    const targets = Array.from(c.querySelectorAll(".rpt-gcd-act-target"));
    expect(targets.length).toBeGreaterThan(0);
    for (const el of targets) {
      expect(el.className).toContain("cc");
    }
  });

  it("自施/无目标施法不渲染目标后缀", () => {
    const s = JSON.parse(JSON.stringify(m)) as StoredMatch;
    const units = s.units as Record<string, any>;
    const caster = Object.values(units).find(
      (u: any) => u.info && u.reaction === "Friendly",
    ) as any;
    caster.casts = [
      {
        eventName: "SPELL_CAST_SUCCESS",
        timestamp: s.startTime + 30_000,
        spellId: 45438,
        spellName: "Ice Block",
        srcId: caster.id,
        srcName: caster.name,
        destId: caster.id,
        destName: caster.name,
        params: [],
      },
    ];
    const c = renderLane(s, false);
    const targets = Array.from(c.querySelectorAll(".rpt-gcd-act-target"));
    expect(targets.some((el) => el.textContent?.includes(caster.name))).toBe(
      false,
    );
  });

  // pipeline T239 (69915cc5 r1): the cast row of a personal defensive logs
  // the caster's current target; neither the chip nor its tooltip names it
  it("只能给自己的防御技能:chip 和悬浮提示都不写施法行里的目标", () => {
    const s = JSON.parse(JSON.stringify(m)) as StoredMatch;
    const units = s.units as Record<string, any>;
    const caster = Object.values(units).find(
      (u: any) => u.info && u.reaction === "Friendly",
    ) as any;
    const enemy = Object.values(units).find(
      (u: any) => u.info && u.reaction === "Hostile",
    ) as any;
    caster.casts = [
      {
        eventName: "SPELL_CAST_SUCCESS",
        timestamp: s.startTime + 30_000,
        spellId: 264735,
        spellName: "Survival of the Fittest",
        srcId: caster.id,
        srcName: caster.name,
        destId: enemy.id,
        destName: "Targetdude-SomeRealm-US",
        params: [],
      },
    ];
    const c = renderLane(s, false);
    expect(c.textContent).not.toContain("Targetdude");
    const titles = Array.from(c.querySelectorAll(".rpt-gcd-act")).map(
      (el) => el.getAttribute("title") ?? "",
    );
    expect(titles.some((t) => t.includes("Survival of the Fittest"))).toBe(
      true,
    );
    expect(titles.some((t) => t.includes("Targetdude"))).toBe(false);
  });
});
