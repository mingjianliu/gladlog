/**
 * `checkCdHoardedOwnerFree` — a cd-hoarded row's `ownerFreeS` is the span its
 * owner gate passed on (`ownerFreeSpan`: from `facts.t` to the end of the
 * response window), so it never reads under `REACTION_WINDOW_S` and never
 * over the window the row states (re-eval 2026-10-08 I05, user ruling
 * 2026-10-11: 22 of 644 rows on the 605 capture printed less than 1 s, 6 of
 * them 0.0, while the gate had counted the 1.5 s before `t`).
 */
import { buildFindingsPrompt } from "@gladlog/analysis";
import {
  CD_HOARD_RESPONSE_S,
  cdHoardedEvents,
  ownerFreeSpan,
} from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { RESPONSE_PRE_MS } from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import { actWindowFor } from "@gladlog/analysis/src/utils/cannotCastIntervals";
import { REACTION_WINDOW_S } from "@gladlog/analysis/src/utils/cooldowns";
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { checkCdHoardedOwnerFree } from "../src/quality/promptQualityCheck";

const row = (facts: string) =>
  `  - id=cd-hoarded:P1:P2:79 type=cd-hoarded t=79s units=Me/Mate facts={t=79, crisisUnit=Mate, crisisHpPct=38, dmg2sPct=59, readyCds=Spirit Link Totem, own=no, refDeathSpent=5.8, refDeathHeld=13.0, refN=15645${facts}}`;

describe("checkCdHoardedOwnerFree", () => {
  it("flags a row whose owner had less than REACTION_WINDOW_S after t (3b56ac97 r4 @79, 30846f8e @82)", () => {
    const f = checkCdHoardedOwnerFree([
      row(", ownerCc=Hammer of Justice +0.8…+5.8s, ownerFreeS=0.8"),
      row(
        ", ownerCc=Counterspell lockout (Frost) -0.4…+5.6s; Blinding Sleet +1.9…+2.4s, ownerFreeS=0.0",
      ),
    ]);
    expect(f).toHaveLength(2);
    expect(f[0]).toContain("ownerFreeS=0.8");
    expect(f[1]).toContain("ownerFreeS=0.0");
  });

  it("passes REACTION_WINDOW_S and more, up to the window the row states", () => {
    expect(
      checkCdHoardedOwnerFree([
        row(
          `, ownerCc=Hammer of Justice +1.0…+5.5s, ownerFreeS=${REACTION_WINDOW_S.toFixed(1)}`,
        ),
        row(
          `, ownerCc=Blind -4.4…+0.6s, ownerFreeS=${(CD_HOARD_RESPONSE_S - 0.6).toFixed(1)}`,
        ),
        row(
          `, ownerCc=Hammer of Justice -3.0…-0.5s, ownerFreeS=${CD_HOARD_RESPONSE_S.toFixed(1)}`,
        ),
        row(", windowS=1.7, ownerCc=Storm Bolt -2.0…-0.1s, ownerFreeS=1.7"),
      ]),
    ).toEqual([]);
  });

  it("flags more free time than the window: the 5 s, or windowS when the row states one", () => {
    const f = checkCdHoardedOwnerFree([
      row(", ownerCc=Blind -4.4…-0.6s, ownerFreeS=5.4"),
      row(", windowS=1.7, ownerCc=Storm Bolt +0.4…+1.4s, ownerFreeS=2.0"),
    ]);
    expect(f).toHaveLength(2);
    expect(f[0]).toContain(`${CD_HOARD_RESPONSE_S} s window`);
    expect(f[1]).toContain("1.7 s window");
  });

  it("flags one fact without the other", () => {
    expect(
      checkCdHoardedOwnerFree([
        row(", ownerCc=Hammer of Justice +1.0…+5.5s"),
        row(", ownerFreeS=3.0"),
      ]),
    ).toHaveLength(2);
  });

  it("leaves a row with neither fact, and other candidate types, alone", () => {
    expect(
      checkCdHoardedOwnerFree([
        row(""),
        "  - id=kick-eaten:P1:363 type=kick-eaten t=362.8s units=Me/Sham facts={t=362.8, ownerCc=Hammer of Justice +0.8…+5.8s, ownerFreeS=0.2}",
      ]),
    ).toEqual([]);
  });
});

// analysis produces X ⇄ the gate verifies X, on the rendered menu
describe("checkCdHoardedOwnerFree ⇄ cdHoardedEvents (one span for the gate and the fact)", () => {
  const T0 = 1_000_000;
  const at = (s: number) => T0 + s * 1000;
  const OWNER = { id: "h", name: "Healer-R" };
  const MATE = { id: "m", name: "Mate-R" };
  const stunned = (fromS: number, toS: number) =>
    ({
      id: "h",
      auraEvents: [
        {
          spellId: "853",
          spellName: "Hammer of Justice",
          srcUnitId: "e",
          timestamp: at(fromS),
          logLine: { event: LogEvent.SPELL_AURA_APPLIED },
        },
        {
          spellId: "853",
          spellName: "Hammer of Justice",
          srcUnitId: "e",
          timestamp: at(toS),
          logLine: { event: LogEvent.SPELL_AURA_REMOVED },
        },
      ],
      actionIn: [],
      deathRecords: [],
    }) as unknown as ICombatUnit;
  const menu = (
    u: ICombatUnit,
    gate: (
      act: ReturnType<typeof actWindowFor>,
    ) => ReturnType<typeof actWindowFor>["couldRespond"],
  ) => {
    const act = actWindowFor(u, new Set(["e"]), T0);
    const events = cdHoardedEvents(
      [
        {
          crisisUnit: MATE,
          own: false,
          points: [
            {
              tSec: 60,
              hpPct: 30,
              dmg2s: 0.3,
              attackers2s: 1,
              enemyBurst: false,
              inCC: false,
              dangerous: true,
            },
          ],
        },
      ],
      [
        {
          spellId: "33206",
          spellName: "Pain Suppression",
          tag: "Defensive",
          cooldownSeconds: 180,
          casts: [],
          neverUsed: true,
        },
      ],
      OWNER,
      undefined,
      undefined,
      undefined,
      gate(act),
      undefined,
      act.stateIn,
    );
    return buildFindingsPrompt(events, "", "Discipline Priest").split("\n");
  };

  it("every row the producer prints passes — stun swept across the window", () => {
    let rows = 0;
    for (let from = 57.5; from <= 66; from += 0.173)
      for (const len of [0.5, 1.5, 3, 4.5, 6]) {
        const lines = menu(stunned(from, from + len), (a) => a.couldRespond);
        rows += lines.filter((l) => l.includes("type=cd-hoarded ")).length;
        expect(checkCdHoardedOwnerFree(lines)).toEqual([]);
      }
    expect(rows).toBeGreaterThan(40);
  });

  it("mutation: the gate asked over the old window (1.5 s before t included) prints a row the check rejects", () => {
    const pre = RESPONSE_PRE_MS / 1000;
    const oldGate =
      (
        act: ReturnType<typeof actWindowFor>,
      ): ReturnType<typeof actWindowFor>["couldRespond"] =>
      (fromS, toS, spellId) =>
        act.couldRespond(fromS - pre, toS, spellId);
    // free for the 1.5 s before t and 0.75 s after it, then stunned to the end
    const u = stunned(60.75, 65.761);
    expect(ownerFreeSpan(60)).toEqual({ fromS: 60, toS: 65 });
    const mutated = menu(u, oldGate);
    expect(mutated.some((l) => l.includes("ownerFreeS=0.8"))).toBe(true);
    expect(checkCdHoardedOwnerFree(mutated)).toHaveLength(1);
    // the product's gate does not print it at all
    expect(
      menu(u, (a) => a.couldRespond).some((l) =>
        l.includes("type=cd-hoarded "),
      ),
    ).toBe(false);
  });
});
