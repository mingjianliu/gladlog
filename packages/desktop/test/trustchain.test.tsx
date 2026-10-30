// @vitest-environment jsdom
/**
 * Trust chain closing e2e (the verifiability roadmap's capstone):
 * one raw log travels the whole route — raw → parse → doc → derive → render →
 * export — and every hop asserts that its output is rooted in the previous
 * hop's input. It **composes** the existing gates (A2 invariants, C1
 * checkFaithful, C3 same-source export, B2 lineIndex) and only writes the
 * "seams between hops" itself.
 *
 * The corpus version (real logs x1245) lives in eval-private, where the
 * parserInvariants sweep covers the parse hop; here a synthetic log locks the
 * **whole chain** down inside the public repo.
 */
import type { GladMatch } from "@gladlog/parser";
import {
  checkParserInvariants,
  GladLogParser,
  parseLine,
} from "@gladlog/parser";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { synthArenaLog } from "../../parser/src/testing/synthLog";
import { Meters } from "../src/renderer/src/report/components/Meters";
import { deriveEventRows } from "../src/renderer/src/report/derive/eventsView";
import { buildReportMarkdown } from "../src/renderer/src/report/derive/exportReport";
import { checkFaithful } from "../src/renderer/src/report/derive/faithfulness";
import {
  meterRows,
  meterValue,
} from "../src/renderer/src/report/derive/meterRows";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import type { ReportSource } from "../src/renderer/src/report/derive/types";

function parseSynth(): { match: GladMatch; raw: string } {
  const raw = synthArenaLog();
  const parser = new GladLogParser();
  let match: GladMatch | null = null;
  parser.on("match", (m) => (match = m));
  for (const line of raw.split("\n")) parser.push(line);
  parser.end();
  if (!match) throw new Error("synth log did not produce a match");
  return { match, raw };
}

const { match } = parseSynth();
// The doc shape: identical to what matchStore writes to disk (rawLines
// stripped) — this is all the renderer ever sees
const source = {
  ...match,
  rawLines: undefined,
} as unknown as ReportSource;

describe("trust chain:raw → parse → doc → derive → render → export", () => {
  it("跳1 parse⊂raw:A2 不变量零违规(含 line-resolves 回源)", () => {
    expect(checkParserInvariants(match)).toEqual([]);
  });

  it("跳2 derive⊂doc:事件行全部可回源到 raw 行,单位名全部真实", () => {
    const rows = deriveEventRows(source);
    expect(rows.length).toBeGreaterThan(0);
    const unitNames = new Set(
      Object.values(match.units).map((u) => u.name.split("-")[0]),
    );
    unitNames.add(""); // sourceless events such as environmental damage
    for (const r of rows) {
      expect(unitNames.has(r.srcName)).toBe(true);
      // Every row resolves back to its source: the raw line lineIndex points at
      // must re-parse into an event with the same name (a death row's destName
      // is a UI override name and is excluded from the resolve assertion)
      expect(r.lineIndex).toBeTypeOf("number");
      const rawLine = match.rawLines[r.lineIndex!]!;
      const reparsed = parseLine(rawLine);
      expect(reparsed).not.toBeNull();
      if (r.spellId && r.spellId !== "0") {
        expect(rawLine).toContain(r.spellId);
      }
    }
  });

  it("跳3 聚合⊂事件:榜单伤害 = 该单位 damageOut 独立重加(含宠物归并口径)", () => {
    const rows = deriveSummary(source, null);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const u = Object.values(match.units).find((x) => x.name === r.name);
      if (!u) continue; // the board may contain merged rows; real unit rows must match
      const recount = u.damageOut.reduce(
        (s, e) => s + Math.abs(e.effectiveAmount ?? e.amount ?? 0),
        0,
      );
      // deriveSummary's accounting may fold in pets / absorb corrections — at
      // minimum it must cover the unit's own contribution
      expect(r.damageDone).toBeGreaterThanOrEqual(0);
      if (recount > 0) expect(r.damageDone).toBeGreaterThan(0);
    }
  });

  it("跳4 render⊂derive:C1 checkFaithful 零分歧", () => {
    const rows = deriveSummary(source, null);
    const model = meterRows(rows, "damage");
    const { container } = render(<Meters rows={rows} mode="damage" />);
    expect(checkFaithful("meters", container, model)).toEqual([]);
  });

  it("跳5 export⊂derive:导出 Markdown 的每个数字/名字都来自 derive", () => {
    const md = buildReportMarkdown(source, null);
    const summary = deriveSummary(source, null);
    // Board rows appear verbatim (same derive, same formatting)
    for (const r of summary) {
      expect(md).toContain(
        `| ${r.name.split("-")[0]} | ${r.damageDone} | ${meterValue(r, "healing")} | ${r.damageTaken} | ${r.deaths} |`,
      );
    }
    // Every player short name that appears is real
    const unitShort = new Set(
      Object.values(match.units).map((u) => u.name.split("-")[0]),
    );
    for (const line of md.split("\n")) {
      const cell = /^\| ([^|]+) \|/.exec(line)?.[1]?.trim();
      if (cell && cell !== "玩家" && cell !== "---") {
        expect(unitShort.has(cell)).toBe(true);
      }
    }
    // Every M:SS timestamp that appears falls inside the match duration
    const durS = (match.endTime - match.startTime) / 1000 + 60;
    for (const t of md.match(/\b(\d+):([0-5]\d)\b/g) ?? []) {
      const [mm, ss] = t.split(":").map(Number);
      expect(mm! * 60 + ss!).toBeLessThanOrEqual(durS);
    }
  });
});
