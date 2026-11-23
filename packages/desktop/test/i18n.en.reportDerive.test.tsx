// @vitest-environment jsdom
// Task 6a (§6.9 check 5): the report's derive layer words everything it
// produces in English when asked for "en". The fixture's log was recorded on
// a Chinese client, so its own strings (spell names, a pet's name) are CJK —
// those are log data (spell names are spec §8 item 1's job), so every CJK
// string in the fixture is first swapped for an ASCII token: any CJK left in
// the output then came from the derive code or the dictionary.
import { ensureAnalysisData } from "@gladlog/analysis";
import { CJK_LEAK } from "@gladlog/analysis/src/utils/localizedText";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { LangProvider } from "../src/renderer/src/i18n/LangProvider";
import { cliWaitHint } from "../src/renderer/src/report/derive/aiRunStatus";
import { deriveCcBreakDash } from "../src/renderer/src/report/derive/ccBreakDash";
import { cohortDims } from "../src/renderer/src/report/derive/cohortDims";
import { deriveDeathRecaps } from "../src/renderer/src/report/derive/deathRecap";
import { deriveDetailBreakdown } from "../src/renderer/src/report/derive/detailBreakdown";
import { deriveDispelDash } from "../src/renderer/src/report/derive/dispelDash";
import {
  deriveEventRows,
  eventKindLabel,
  groupEventRows,
} from "../src/renderer/src/report/derive/eventsView";
import { buildReportMarkdown } from "../src/renderer/src/report/derive/exportReport";
import {
  candidateShortLabel,
  categoryLabel,
  severityLabel,
} from "../src/renderer/src/report/derive/findingDisplay";
import { curveMetricLabel } from "../src/renderer/src/report/derive/flowSeries";
import { deriveKeyMoments } from "../src/renderer/src/report/derive/keyMoments";
import { missedKickLabel } from "../src/renderer/src/report/derive/kickText";
import {
  candidateDetail,
  deriveMistakes,
  deriveMistakesUncached,
  localizeMistakes,
  type Mistake,
  MISTAKE_RULES,
  syncReadyCdsText,
} from "../src/renderer/src/report/derive/mistakes";
import { derivePressureLanes } from "../src/renderer/src/report/derive/pressureLanes";
import { selfReviewNote } from "../src/renderer/src/report/derive/selfReviewNote";
import { deriveStatsTable } from "../src/renderer/src/report/derive/statsTable";
import { teamSideLabel } from "../src/renderer/src/report/derive/teamSide";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { deriveUncoveredHighlights } from "../src/renderer/src/report/derive/uncoveredHighlights";
import { deriveVideoMoments } from "../src/renderer/src/report/derive/videoMoments";
import { zeroFindingText } from "../src/renderer/src/report/derive/zeroFindingText";
import { ExportReportPage } from "../src/renderer/src/report/ExportReportPage";
import { loadRealMatchFixture } from "./fixtures/loadFixture";
import { FACTS, VARIANTS } from "./support/mistakeDetailMatrix";

/** Deep copy with every CJK string replaced by a stable ASCII token. */
function asciiLog<T>(value: T): T {
  const tokens = new Map<string, string>();
  return JSON.parse(JSON.stringify(value), (_k, v: unknown) => {
    if (typeof v !== "string" || !CJK_LEAK.test(v)) return v;
    let t = tokens.get(v);
    if (!t) {
      t = `LogName${tokens.size}`;
      tokens.set(v, t);
    }
    return t;
  }) as T;
}

/** Every string inside `value` that holds CJK, with its path. */
function cjkStrings(value: unknown, path = ""): string[] {
  if (typeof value === "string")
    return CJK_LEAK.test(value) ? [`${path}: ${value}`] : [];
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) =>
      cjkStrings(v, `${path}.${k}`),
    );
  return [];
}

/** The fixture with one injected death (as report.deathrecap.test) and a
 * dispel + an interrupt row so the events table words those too. */
function sample(): ReportSource {
  const m = asciiLog(loadRealMatchFixture()) as unknown as ReportSource & {
    units: Record<string, Record<string, unknown>>;
  };
  const players = Object.values(m.units).filter(
    (u) => u.kind === "Player" && (u.damageIn as unknown[] | undefined)?.length,
  ) as unknown as Array<{
    id: string;
    name: string;
    damageIn: Array<{ timestamp: number }>;
    deaths: Array<Record<string, unknown>>;
    actionsOut?: Array<Record<string, unknown>>;
  }>;
  players.sort((a, b) => b.damageIn.length - a.damageIn.length);
  const victim = players[0]!;
  const t = Math.max(...victim.damageIn.map((d) => d.timestamp));
  victim.deaths.push({
    timestamp: t,
    eventName: "UNIT_DIED",
    spellId: 0,
    spellName: "",
    srcId: "",
    srcName: "",
    destId: victim.id,
    destName: victim.name,
    unconscious: false,
  });
  const actor = players[1]!;
  const row = (eventName: string) => ({
    timestamp: t - 1000,
    eventName,
    spellId: 527,
    spellName: "Purify",
    srcName: actor.name,
    destName: victim.name,
    extraSpellName: "Polymorph",
  });
  actor.actionsOut = [row("SPELL_DISPEL"), row("SPELL_INTERRUPT")];
  return m;
}

describe("i18n: 战报 derive 层英文模式不出中文", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  afterEach(cleanup);

  it("整局 derive(失误/关键时刻/驱散/打破控制/统计/压力/事件/明细/导出/未覆盖/死亡/录像时刻)", () => {
    const m = sample();
    const out = {
      mistakes: deriveMistakes(m, undefined, "en"),
      mistakesRanged: deriveMistakes(m, { fromS: 0, toS: 60 }, "en"),
      keyMoments: deriveKeyMoments(m, undefined, "en"),
      dispel: deriveDispelDash(m, undefined, "en"),
      ccBreak: deriveCcBreakDash(m, undefined, "en"),
      stats: deriveStatsTable(m, undefined, "en"),
      pressure: derivePressureLanes(m, "en"),
      events: groupEventRows(deriveEventRows(m, "en")),
      breakdown: Object.values(m.units).flatMap((u) =>
        (["damage", "healing", "taken"] as const).map((mode) =>
          deriveDetailBreakdown(m, u.id, mode, undefined, "en"),
        ),
      ),
      md: buildReportMarkdown(m, undefined, "en"),
      mdRange: buildReportMarkdown(m, { fromS: 5, toS: 50 }, "en"),
      uncovered: deriveUncoveredHighlights(m, 90, [], "en"),
      deaths: deriveDeathRecaps(m, "en"),
      video: deriveVideoMoments(m, [], "en"),
    };
    // the sample really exercises these paths
    expect(out.mistakes.length).toBeGreaterThan(0);
    expect(out.keyMoments.some((k) => k.kind === "death")).toBe(true);
    expect(out.deaths.length).toBeGreaterThan(0);
    expect(out.events.some((r) => "detail" in r && r.detail === "−lost")).toBe(
      true,
    );
    expect(out.md).toContain("## Damage / healing");
    expect(cjkStrings(out)).toEqual([]);
  });

  it("失误:en 结果与不走缓存直接按 en 算的相同;同一语言再调返回同一个缓存对象,zh / en 各存一份;踢断 / 驱散行按自带的文本输入出英文", () => {
    const m = sample();
    const zh = deriveMistakes(m);
    const en = deriveMistakes(m, undefined, "en");
    expect(en).toEqual(deriveMistakesUncached(m, undefined, "en"));
    expect(deriveMistakes(m, undefined, "en")).toBe(en);
    expect(deriveMistakes(m)).toBe(zh);
    expect(zh.map((x) => x.detail)).not.toEqual(en.map((x) => x.detail));
    // kick and purge rows carry their own text inputs
    const rows: Mistake[] = [
      {
        tS: 1,
        unitName: "A",
        type: "missed-kick",
        label: "",
        severity: "minor",
        detail: "",
        seekNames: [],
        isOwner: true,
        timed: true,
        text: {
          kind: "kick",
          kickKind: "immune",
          kickSpell: "Kick",
          castSpell: "Fear",
        },
      },
      {
        tS: 2,
        unitName: "B",
        type: "missed-kick",
        label: "",
        severity: "minor",
        detail: "",
        seekNames: [],
        isOwner: true,
        timed: true,
        text: {
          kind: "kick",
          kickKind: "missed",
          kickSpell: "Kick",
          castSpell: "",
        },
      },
      {
        tS: 3,
        unitName: "C",
        type: "missed-purge-kill-window",
        label: "",
        severity: "average",
        detail: "",
        seekNames: [],
        isOwner: true,
        timed: true,
        text: { kind: "purge", spell: "Ice Barrier", enemy: "C", durationS: 6 },
      },
    ];
    const worded = localizeMistakes(rows, "en");
    expect(worded.map((r) => [r.label, r.detail])).toEqual([
      ["Target immune to interrupt", "Kick went into Fear's cast"],
      ["Missed interrupt", "Kick missed"],
      [
        "Missed purge in a kill window",
        "Ice Barrier stayed on C for 6s without being purged",
      ],
    ]);
  });

  it("失误卡句子:每条规则、每个分支的句子框架都是英文", () => {
    const details = MISTAKE_RULES.flatMap((r) =>
      VARIANTS.map((v) =>
        candidateDetail({ type: r.type, facts: { ...FACTS, ...v } }, "en"),
      ),
    );
    expect(details.filter(Boolean).length).toBeGreaterThan(30);
    expect(cjkStrings(details)).toEqual([]);
    expect(syncReadyCdsText(VARIANTS[3]!.readyCds, "en")).toBe(
      "The Hunt (A-Realm's), Touch of the Magi (yours), Avatar",
    );
  });

  it("标签类 derive(严重度/类别/类型/打断结果/状态行/对比/0 条说明/自查/阵营/曲线/事件类型)", () => {
    const k = (missType?: string) =>
      ({
        kickMiss: missType
          ? { missType, targetId: "t", targetName: "T" }
          : undefined,
        refusedAtCastSpellName: "Fear",
        targetId: "t",
      }) as Parameters<typeof missedKickLabel>[0];
    const labels = [
      ...(["high", "med", "low"] as const).map((s) => severityLabel(s, "en")),
      ...[
        "survival",
        "cooldowns",
        "positioning",
        "target-selection",
        "cc",
        "interrupts",
        "dispels",
        "offense",
      ].map((c) => categoryLabel(c, "en")),
      ...["death", "cd-waste", "kick-priority-team", "backlash-dispel"].map(
        (type) =>
          candidateShortLabel(
            { type, spell: "" } as Parameters<typeof candidateShortLabel>[0],
            "en",
          ),
      ),
      missedKickLabel(k("IMMUNE"), "en"),
      missedKickLabel(k("REFLECT"), "en"),
      missedKickLabel(k(), "en"),
      cliWaitHint("claude-cli", "en")!,
      ...cohortDims(
        [
          {
            key: "offensiveIndex",
            value: 1.5,
            p10: 0,
            p50: 1,
            p90: 2,
            percentile: 30,
            verdict: "below median",
          },
        ],
        "en",
      ).flatMap((r) => [r.displayLabel, r.keyLabel, r.verdictLabel]),
      ...[
        { dropped: 1 },
        { dropped: 3 },
        { dropped: 0, fallbackReason: "no-candidates" as const },
        { dropped: 0, fallbackReason: "no-client" as const },
        { dropped: 0, fallbackReason: "bad-json" as const },
        { dropped: 0, fallbackReason: "empty-reply" as const },
        { dropped: 0 },
      ].map((r) => zeroFindingText(r, "en")),
      selfReviewNote({ findings: [], selfReview: { status: "failed" } }, "en")!,
      selfReviewNote(
        {
          findings: [
            { category: "cc", severity: "high", title: "b", explanation: "" },
          ],
          selfReview: {
            status: "reviewed",
            original: [
              { category: "cc", severity: "high", title: "a", explanation: "" },
              { category: "x", severity: "low", title: "q", explanation: "" },
            ],
          },
        },
        "en",
      )!,
      ...(["friendly", "enemy", "unknown"] as const).map((s) =>
        teamSideLabel(s, "en"),
      ),
      ...(["hp", "damage", "healing", "taken", "healed"] as const).map((x) =>
        curveMetricLabel(x, "en"),
      ),
      ...(
        [
          "damage",
          "heal",
          "cast",
          "aura",
          "dispel",
          "interrupt",
          "death",
        ] as const
      ).map((x) => eventKindLabel(x, "en")),
    ];
    expect(labels).toContain("Target selection");
    expect(labels).toContain("Medium");
    expect(cjkStrings(labels)).toEqual([]);
  });

  it("离屏导出页:加载中与「对局不存在」在英文模式下是英文", async () => {
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      settings: { get: vi.fn(async () => ({ language: "en" })) },
      matches: { get: vi.fn(async () => null) },
    };
    const { container } = render(
      <LangProvider firstRunPicker={false}>
        <ExportReportPage matchId="m-1" roundSeq={null} range={null} />
      </LangProvider>,
    );
    expect(await screen.findByText("Match m-1 not found")).toBeTruthy();
    expect(CJK_LEAK.test(container.textContent ?? "")).toBe(false);
  });
});
