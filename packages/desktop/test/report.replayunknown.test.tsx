// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";

import { ReplayView } from "../src/renderer/src/report/components/ReplayView";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

/**
 * 开局位置盲窗。
 *
 * 坐标只搭在 `*_DAMAGE`(承伤方)/`*_HEAL`(被治疗者)/`SPELL_CAST_SUCCESS`
 * (施法者)这几类记录上,而跑动不产生任何战斗日志记录 —— 一个人开局只是
 * 在跑,日志里关于他一条记录都没有。本 fixture 实测各人首样本在
 * +0.6 / +1.2 / +1.5 / +2.8 / +5.4 / +14.2 秒。
 *
 * 这段时间必须标成「位置未知」,不能当确定位置画:sampleAt 只能把位置钉在
 * 首样本上,那是「他第一次卷进战斗的地方」,通常离起跑点隔了大半个场地。
 */
describe("回放开局的位置盲窗", () => {
  it("开局时刻:所有单位都还没有坐标依据 → 全部标成未知态", () => {
    const { container } = render(<ReplayView source={m} />);
    const units = container.querySelectorAll(".rpt-replay-unit");
    expect(units.length).toBeGreaterThan(0);
    const asserted = [...units].filter(
      (u) => !u.classList.contains("rpt-replay-unit-unknown"),
    );
    expect(asserted).toHaveLength(0);
  });

  it("开局时刻不画走位尾迹(没有走过的路可画)", () => {
    const { container } = render(<ReplayView source={m} />);
    expect(container.querySelectorAll(".rpt-replay-trail")).toHaveLength(0);
  });

  it("拖到 +20s(晚于所有人的首样本)→ 不再有未知态", () => {
    const { container } = render(<ReplayView source={m} />);
    const scrub = container.querySelector(
      ".rpt-replay-scrub",
    ) as HTMLInputElement;
    fireEvent.change(scrub, {
      target: { value: String(m.startTime + 20_000) },
    });
    const units = container.querySelectorAll(".rpt-replay-unit");
    expect(units.length).toBeGreaterThan(0);
    const unknown = [...units].filter((u) =>
      u.classList.contains("rpt-replay-unit-unknown"),
    );
    expect(unknown).toHaveLength(0);
  });
});
