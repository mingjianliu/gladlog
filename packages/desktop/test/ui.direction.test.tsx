// @vitest-environment jsdom
// Direction pass (2026-11-27): the report headline, the fresh-character
// rating line and the record headline.
import { render } from "@testing-library/react";

import { BracketRow } from "../src/renderer/src/components/CharacterStats";
import type { BracketLine } from "../src/renderer/src/components/dashboard";
import { VerdictLine } from "../src/renderer/src/report/components/VerdictLine";
import type { DeathRecap } from "../src/renderer/src/report/derive/deathRecap";

const recap = (over: Partial<DeathRecap>): DeathRecap =>
  ({
    unitId: "u1",
    unitName: "Ztlivid-Illidan",
    deathS: 150.4,
    events: [],
    rows: [],
    availableImmunities: [],
    missedExternals: [],
    ...over,
  }) as unknown as DeathRecap;

describe("战报头条", () => {
  it("大号时间 + 阵亡者 + 原因逐行列出", () => {
    const { container } = render(
      <VerdictLine
        recap={recap({
          missedExternals: [
            {
              casterName: "Steviebb-Illidan",
              spellName: "Darkness",
              casterWasInCC: false,
              casterCouldNotPay: false,
            },
            {
              casterName: "Me",
              spellName: "Spirit Link Totem",
              casterWasInCC: true,
              casterIsOwner: true,
            },
          ] as unknown as DeathRecap["missedExternals"],
        })}
        onOpen={() => {}}
      />,
    );
    expect(container.querySelector(".rpt-verdict-time")?.textContent).toBe(
      "2:30",
    );
    expect(container.querySelector(".rpt-verdict-text")?.textContent).toBe(
      "Ztlivid 阵亡",
    );
    const rows = [...container.querySelectorAll(".rpt-verdict-row")].map(
      (r) => r.textContent,
    );
    expect(rows).toEqual([
      "可给未给Steviebb 的 Darkness",
      "想给给不了你的 Spirit Link Totem",
    ]);
  });

  it("没有可说的原因时不画空列表", () => {
    const { container } = render(
      <VerdictLine recap={recap({})} onOpen={() => {}} />,
    );
    expect(container.querySelector(".rpt-verdict-why")).toBeNull();
  });
});

describe("战绩:新角色不显示涨跌", () => {
  const line = (over: Partial<BracketLine>): BracketLine =>
    ({
      bracket: "3v3",
      games: 10,
      rateWins: 6,
      rateGames: 10,
      perRound: false,
      rating: 2136,
      baseline: 96,
      delta: 2040,
      peak: 2136,
      points: [],
      lastPlayed: 0,
      ...over,
    }) as BracketLine;

  it("起点低于 1000:写「新角色，从 N 起」,不出 ▲2040", () => {
    const { container, getByTestId } = render(<BracketRow line={line({})} />);
    expect(getByTestId("cs-fresh").textContent).toBe("新角色，从 96 起");
    expect(container.textContent).not.toContain("2040");
  });

  it("正常起点照常显示涨跌", () => {
    const { container, queryByTestId } = render(
      <BracketRow line={line({ baseline: 2397, delta: 17, rating: 2414 })} />,
    );
    expect(queryByTestId("cs-fresh")).toBeNull();
    expect(container.textContent).toContain("17");
  });
});

describe("GCD 泳道:死亡回顾的结论钉在对应玩家那一列", () => {
  it("可给未给 / 被控 / 无敌未按 各进各的列;没有这一列的施法者不猜", async () => {
    const { laneNotesFromRecaps } = await import(
      "../src/renderer/src/report/derive/deathReasons"
    );
    const r = recap({
      unitId: "zt",
      deathS: 150,
      availableImmunities: [
        { spellId: "1", spellName: "Unending Resolve", wasInCC: false },
        { spellId: "2", spellName: "Dark Pact", wasInCC: true },
      ],
      missedExternals: [
        { casterName: "Steviebb", spellId: "3", spellName: "Darkness", casterWasInCC: false },
        { casterName: "Me", spellId: "4", spellName: "Spirit Link Totem", casterWasInCC: true },
        { casterName: "Me", spellId: "5", spellName: "Earth Shield", casterWasInCC: false, casterCouldNotPay: true },
        { casterName: "Ghost", spellId: "6", spellName: "X", casterWasInCC: false },
      ],
    } as unknown as Partial<DeathRecap>);
    const notes = laneNotesFromRecaps(
      [r],
      1_000_000,
      new Map([
        ["Steviebb", "st"],
        ["Me", "me"],
        ["Ztlivid-Illidan", "zt"],
      ]),
    );
    const tMs = 1_000_000 + 150_000;
    expect(notes).toEqual({
      zt: [{ tMs, kind: "unpressed", spellName: "Unending Resolve" }],
      st: [{ tMs, kind: "missed", spellName: "Darkness" }],
      me: [{ tMs, kind: "blocked", spellName: "Spirit Link Totem" }],
    });
  });
});
