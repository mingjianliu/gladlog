// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TimelineStrip } from "../src/renderer/src/report/components/TimelineStrip";
import { timelineMarks } from "../src/renderer/src/report/derive/timelineMarks";
import { checkFaithful } from "../src/renderer/src/report/derive/faithfulness";
import type { CandidateEvent } from "@gladlog/analysis";

function ev(id: string, t: number, type = "death"): CandidateEvent {
  return { id, type, t, unitNames: [], facts: { t: String(t) } };
}
const candidates = [ev("a", 10), ev("b", 25), ev("c", 40)];

describe("checkFaithful: timeline", () => {
  it("faithful render has no divergences", () => {
    const model = timelineMarks(candidates);
    const { container } = render(
      <TimelineStrip
        candidates={candidates}
        activeEventIds={[]}
        onSelect={() => {}}
      />,
    );
    expect(checkFaithful("timeline", container, model)).toEqual([]);
  });

  it("HAS TEETH: a mis-placed mark (wrong left%) is caught", () => {
    const model = timelineMarks(candidates);
    const { container } = render(
      <TimelineStrip
        candidates={candidates}
        activeEventIds={[]}
        onSelect={() => {}}
      />,
    );
    const mark = container.querySelector<HTMLElement>('[data-mark-id="a"]');
    expect(mark).toBeTruthy();
    mark!.style.left = "88%"; // lie: model says 25%
    const divs = checkFaithful("timeline", container, model);
    expect(
      divs.some((d) => d.element === "a" && d.invariant === "view-faithful"),
    ).toBe(true);
  });

  it("HAS TEETH: a phantom mark id (not in the model) is caught", () => {
    const model = timelineMarks(candidates);
    const { container } = render(
      <TimelineStrip
        candidates={candidates}
        activeEventIds={[]}
        onSelect={() => {}}
      />,
    );
    const mark = container.querySelector<HTMLElement>('[data-mark-id="a"]');
    mark!.setAttribute("data-mark-id", "ghost");
    const divs = checkFaithful("timeline", container, model);
    expect(divs.some((d) => d.invariant === "maps-to-event")).toBe(true);
  });
});
