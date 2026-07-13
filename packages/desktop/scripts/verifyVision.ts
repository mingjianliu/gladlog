// Headless data-faithfulness check (C1). Renders each report component to
// static HTML, parses it with jsdom, runs checkFaithful, prints structured
// diffs, and exits non-zero if anything diverged. Cross-agent primitive:
//   npm -w @gladlog/desktop run verify:vision
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { loadMatchFixture } from "../test/fixtures/loadFixture";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import { meterRows } from "../src/renderer/src/report/derive/meterRows";
import { timelineMarks } from "../src/renderer/src/report/derive/timelineMarks";
import {
  cohortDims,
  type CohortDim,
} from "../src/renderer/src/report/derive/cohortDims";
import {
  checkFaithful,
  type Divergence,
} from "../src/renderer/src/report/derive/faithfulness";
import { Meters } from "../src/renderer/src/report/components/Meters";
import { TimelineStrip } from "../src/renderer/src/report/components/TimelineStrip";
import { CohortDimsTable } from "../src/renderer/src/report/components/CohortDimsTable";
import type { CandidateEvent } from "@gladlog/analysis";

function rootOf(html: string): HTMLElement {
  const dom = new JSDOM(
    `<!doctype html><body><div id="root">${html}</div></body>`,
  );
  return dom.window.document.getElementById("root") as unknown as HTMLElement;
}

// Timeline + cohort inputs aren't part of the match fixture (they come from
// candidate extraction and the compare service); use deterministic fixtures so
// the check is self-contained and reproducible.
const candidates: CandidateEvent[] = [
  {
    id: "d1",
    type: "death",
    t: 12,
    unitNames: ["PlayerA-Test"],
    facts: { t: "12" },
  },
  {
    id: "d2",
    type: "death",
    t: 47,
    unitNames: ["PlayerB-Test"],
    facts: { t: "47" },
  },
];
const cohortFixture: CohortDim[] = [
  {
    key: "offensiveIndex",
    value: 0.31,
    p10: 0.2,
    p50: 0.49,
    p90: 0.7,
    percentile: 30,
    verdict: "low",
  },
  {
    key: "uptime",
    value: 0.95,
    p10: 0.6,
    p50: 0.8,
    p90: 0.9,
    percentile: 96,
    verdict: "high",
  },
];

function main(): void {
  const match = loadMatchFixture();
  const results: { component: string; divergences: Divergence[] }[] = [];

  const meterModel = meterRows(deriveSummary(match), "damage");
  results.push({
    component: "meters",
    divergences: checkFaithful(
      "meters",
      rootOf(
        renderToStaticMarkup(
          createElement(Meters, { rows: deriveSummary(match), mode: "damage" }),
        ),
      ),
      meterModel,
    ),
  });

  const tlModel = timelineMarks(candidates);
  results.push({
    component: "timeline",
    divergences: checkFaithful(
      "timeline",
      rootOf(
        renderToStaticMarkup(
          createElement(TimelineStrip, {
            candidates,
            activeEventIds: [],
            onSelect: () => {},
          }),
        ),
      ),
      tlModel,
    ),
  });

  const cohortModel = cohortDims(cohortFixture);
  results.push({
    component: "cohort",
    divergences: checkFaithful(
      "cohort",
      rootOf(
        renderToStaticMarkup(
          createElement(CohortDimsTable, { rows: cohortModel }),
        ),
      ),
      cohortModel,
    ),
  });

  console.log(JSON.stringify(results, null, 2));
  const total = results.reduce((a, r) => a + r.divergences.length, 0);
  if (total > 0) {
    console.error(`verify:vision FAILED — ${total} divergence(s)`);
    process.exit(1);
  }
  console.error("verify:vision OK — 0 divergences");
}

main();
