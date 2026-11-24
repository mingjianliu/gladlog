// Spec 2026-11-23 §7 (UI language): under zh settings every prompt is byte for
// byte what it was before the i18n work. The goldens in
// fixtures/zh-prompt-golden/ were written by running this same capture at
// 4f59acca5 (the commit before Task 1; settings key `aiLanguage: "zh"` there,
// `language: "zh"` here) — never regenerate them from a later commit, or the
// test stops proving anything.
//
// One fixture (real-match-sample, with one injected death so it yields
// candidates — it is trimmed to 90 s and has no player death) feeds all three
// paths through the real services, with a stub model client that records what
// it is sent:
// - findings: the analysis service's run() (system instruction + user prompt);
// - window: analyzeWindow() on the renderer-built window request;
// - coach: the coach chat's seeding turn (system instruction with the
//   Markdown clause + seed prompt).
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureAnalysisData } from "@gladlog/analysis";
import { beforeAll, describe, expect, it } from "vitest";

import { createAnalysisService } from "../src/main/analysis";
import { createCoachChatService } from "../src/main/coachChat";
import {
  buildAnalysisInput,
  buildWindowAnalysisRequest,
} from "../src/renderer/src/report/derive/analysisInput";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const GOLDEN_DIR = join(__dirname, "fixtures/zh-prompt-golden");
const ZH_SETTINGS = { language: "zh" as const };

type Sent = {
  system?: string;
  messages: Array<{ role: string; content: string }>;
};

/** The real fixture with a death injected for the player who took the most
 * damage, at their last damage taken (same transform as
 * report.deathrecap.test.tsx) — without it the fixture has no candidates and
 * run() never calls the model. */
function fixtureWithDeath(): ReturnType<typeof loadRealMatchFixture> {
  const m = loadRealMatchFixture();
  const players = Object.values(m.units).filter(
    (u) =>
      u.kind === "Player" && (u as { damageIn?: unknown[] }).damageIn?.length,
  ) as unknown as Array<{
    id: string;
    name: string;
    damageIn: Array<{ timestamp: number }>;
    deaths: Array<Record<string, unknown>>;
  }>;
  players.sort((a, b) => b.damageIn.length - a.damageIn.length);
  const victim = players[0]!;
  victim.deaths.push({
    timestamp: Math.max(...victim.damageIn.map((d) => d.timestamp)),
    eventName: "UNIT_DIED",
    spellId: 0,
    spellName: "",
    srcId: "",
    srcName: "",
    destId: victim.id,
    destName: victim.name,
    unconscious: false,
  });
  return m;
}

/** Golden name → text sent to the model, for the three zh paths. */
async function captureZhPrompts(): Promise<Record<string, string>> {
  const source = fixtureWithDeath();
  const input = buildAnalysisInput(source, "golden-1");
  if (!input) throw new Error("fixture built no analysis input");
  const out: Record<string, string> = {};
  const record = (name: string, p: Sent) => {
    out[`${name}.system.txt`] = p.system ?? "";
    out[`${name}.user.txt`] = p.messages[0]!.content;
  };

  // findings (run)
  {
    const sent: Sent[] = [];
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: "k",
        wowDirectory: null,
        ...ZH_SETTINGS,
      }),
      clientFactory: () => ({
        async *stream(p: Sent) {
          sent.push(p);
          yield { delta: "[]" };
        },
      }),
      matchesDir: mkdtempSync(join(tmpdir(), "gl-zh-golden-run-")),
      emit: () => {},
    });
    await s.run(input as never);
    record("findings", sent[0]!);
  }

  // window (analyzeWindow on the renderer-built request)
  {
    const req = buildWindowAnalysisRequest(source, 0, 90);
    if (!req) throw new Error("fixture built no window request");
    const sent: Sent[] = [];
    const s = createAnalysisService({
      getSettings: () => ({
        anthropicApiKey: "k",
        wowDirectory: null,
        ...ZH_SETTINGS,
      }),
      clientFactory: () => ({
        async *stream(p: Sent) {
          sent.push(p);
          yield { delta: "[]" };
        },
      }),
      matchesDir: mkdtempSync(join(tmpdir(), "gl-zh-golden-win-")),
      emit: () => {},
    });
    await s.analyzeWindow({
      matchId: "golden-1",
      ...req,
      contentLang: "zh",
    } as never);
    record("window", sent[0]!);
  }

  // coach chat seeding turn
  {
    const sent: Sent[] = [];
    const svc = createCoachChatService({
      getSettings: () => ({
        aiBackend: "claudeCli" as const,
        aiBackendCommand: null,
        ...ZH_SETTINGS,
      }),
      matchesDir: mkdtempSync(join(tmpdir(), "gl-zh-golden-chat-")),
      seedClient: (() => ({
        async *stream(p: Sent & { sessionIdHint?: string }) {
          sent.push(p);
          yield { delta: "ok" };
          yield { sessionId: p.sessionIdHint ?? "sid" };
        },
      })) as never,
    });
    await svc.send({
      matchId: "golden-1",
      question: "我这场为什么输了?",
      seed: {
        richContext: input.richContext,
        spec: input.spec,
        ownerName: input.ownerName,
        findingsSummary: "1. [high] survival: Death at 0:30",
      },
    });
    record("coach", sent[0]!);
  }
  return out;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("zh prompt 金样:与 i18n 之前(4f59acca5)逐字节相同(spec §7)", () => {
  it("findings / 选段 / 问教练 的系统指令与用户 prompt 与金样逐字节一致", async () => {
    const now = await captureZhPrompts();
    const goldenNames = readdirSync(GOLDEN_DIR)
      .filter((f) => f.endsWith(".txt"))
      .sort();
    expect(Object.keys(now).sort()).toEqual(goldenNames);
    for (const name of goldenNames) {
      const golden = readFileSync(join(GOLDEN_DIR, name), "utf8");
      // compare lengths first so a mismatch names the file without dumping
      // tens of kilobytes
      expect({ name, length: now[name]!.length }).toEqual({
        name,
        length: golden.length,
      });
      expect(now[name] === golden, name).toBe(true);
    }
    // the capture is not vacuous: zh instruction present, real context sent
    expect(now["findings.system.txt"]).toContain("Simplified Chinese");
    expect(now["coach.system.txt"]).toContain("Markdown");
    expect(now["window.user.txt"]).toContain("SELECTED WINDOW");
    expect(now["findings.user.txt"].length).toBeGreaterThan(5000);
  });
});
