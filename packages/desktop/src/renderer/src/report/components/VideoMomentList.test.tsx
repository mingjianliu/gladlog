// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { VideoMoment } from "../derive/videoMoments";
import { VideoMomentList } from "./VideoMomentList";

const mm = (
  tS: number,
  kind: VideoMoment["kind"] = "death",
  weight: VideoMoment["weight"] = "major",
): VideoMoment => ({ tS, kind, weight, label: `moment@${tS}`, unitNames: [] });

describe("VideoMomentList", () => {
  it("空清单渲染 emptyText", () => {
    const { container } = render(
      <VideoMomentList moments={[]} curBattleS={null} emptyText="空空如也" />,
    );
    expect(container.textContent).toContain("空空如也");
  });

  it("点击某行:onSeek 收到该时刻的战斗秒", () => {
    const onSeek = vi.fn();
    const moments = [mm(10), mm(20)];
    const { container } = render(
      <VideoMomentList
        moments={moments}
        curBattleS={null}
        onSeek={onSeek}
        emptyText="x"
      />,
    );
    const rows = container.querySelectorAll(".rpt-video-moment-row");
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[1]);
    expect(onSeek).toHaveBeenCalledWith(20);
  });

  it("unreachableBeforeBattleS 默认 0:所有行都是普通行,title 为「定位到该时刻」", () => {
    const moments = [mm(0), mm(10)];
    const { container } = render(
      <VideoMomentList moments={moments} curBattleS={null} emptyText="x" />,
    );
    const rows = container.querySelectorAll(".rpt-video-moment-row");
    expect(rows).toHaveLength(2);
    rows.forEach((row) => {
      expect(row.className).not.toContain("unreachable");
      expect((row as HTMLElement).title).toBe("定位到该时刻");
    });
  });

  it("缺头(unreachableBeforeBattleS>0)时,tS 落在缺头段内的行加 unreachable class + 专属 title", () => {
    const moments = [mm(5), mm(20)]; // 5 落在缺头段(<12),20 不落在
    const { container } = render(
      <VideoMomentList
        moments={moments}
        curBattleS={null}
        emptyText="x"
        unreachableBeforeBattleS={12}
      />,
    );
    const rows = container.querySelectorAll(".rpt-video-moment-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].className).toContain("unreachable");
    expect((rows[0] as HTMLElement).title).toBe("该时刻在录像开始之前");
    expect(rows[1].className).not.toContain("unreachable");
    expect((rows[1] as HTMLElement).title).toBe("定位到该时刻");
  });
});
