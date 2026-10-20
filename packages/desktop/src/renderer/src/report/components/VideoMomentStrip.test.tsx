// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { VideoMoment } from "../derive/videoMoments";
import type { StripMark } from "./VideoMomentStrip";
import { VideoMomentStrip } from "./VideoMomentStrip";

const mm = (kind: VideoMoment["kind"], weight: VideoMoment["weight"]) =>
  ({ tS: 0, kind, weight, label: "x", unitNames: [] }) as VideoMoment;

describe("VideoMomentStrip", () => {
  it("major 点标 + 爆发金带渲染;minor 不进条;点击回调视频秒", () => {
    const onSeek = vi.fn();
    const marks: StripMark[] = [
      { videoS: 10, moment: mm("death", "major") },
      { videoS: 20, moment: mm("mistake", "major") },
      { videoS: 30, moment: mm("dispel", "minor") }, // 不进条
      { videoS: 40, toVideoS: 55, moment: mm("burst-band", "major") },
    ];
    const { container } = render(
      <VideoMomentStrip marks={marks} durationS={100} onSeek={onSeek} />,
    );
    expect(container.querySelectorAll(".rpt-video-strip-mark")).toHaveLength(2);
    expect(container.querySelectorAll(".rpt-video-strip-band")).toHaveLength(1);
    fireEvent.click(container.querySelector(".rpt-video-strip-death")!);
    expect(onSeek).toHaveBeenCalledWith(10);
  });

  it("duration 未知(0/NaN)→ 不渲染", () => {
    const { container } = render(
      <VideoMomentStrip marks={[]} durationS={0} onSeek={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("窗口 prop:横轴收窄到本轮范围,窗口外的标记丢弃", () => {
    const onSeek = vi.fn();
    const marks: StripMark[] = [
      { videoS: 5, moment: mm("death", "major") }, // 窗口外
      { videoS: 50, moment: mm("death", "major") }, // 窗口内,居中
    ];
    const { container } = render(
      <VideoMomentStrip
        marks={marks}
        durationS={100}
        windowStartS={40}
        windowEndS={60}
        onSeek={onSeek}
      />,
    );
    const marksEls = container.querySelectorAll(".rpt-video-strip-mark");
    expect(marksEls).toHaveLength(1);
    expect((marksEls[0] as HTMLElement).style.left).toBe("50%");
  });

  it("kind=ai:进条、专属 class + ✦ 字形", () => {
    const onSeek = vi.fn();
    const marks: StripMark[] = [{ videoS: 12, moment: mm("ai", "major") }];
    const { container } = render(
      <VideoMomentStrip marks={marks} durationS={100} onSeek={onSeek} />,
    );
    const el = container.querySelector(".rpt-video-strip-ai");
    expect(el).toBeTruthy();
    expect(el!.textContent).toBe("✦");
    fireEvent.click(el!);
    expect(onSeek).toHaveBeenCalledWith(12);
  });

  it("缺头(unreachableBeforeBattleS>0)时窗口外标记不再丢弃,钉在左端并标记不可达", () => {
    const marks: StripMark[] = [
      { videoS: 5, moment: mm("death", "major") }, // 窗口外(缺头段)
      { videoS: 50, moment: mm("death", "major") }, // 窗口内
    ];
    const { container } = render(
      <VideoMomentStrip
        marks={marks}
        durationS={100}
        windowStartS={40}
        windowEndS={60}
        unreachableBeforeBattleS={35}
        onSeek={() => {}}
      />,
    );
    const marksEls = container.querySelectorAll(".rpt-video-strip-mark");
    expect(marksEls).toHaveLength(2);
    const unreachableEl = container.querySelector(
      ".rpt-video-strip-mark--unreachable",
    ) as HTMLElement;
    expect(unreachableEl).toBeTruthy();
    expect(unreachableEl.style.left).toBe("0%");
    expect(unreachableEl.title).toBe("该时刻在录像开始之前");
  });
});
