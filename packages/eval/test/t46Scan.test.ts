/**
 * scan5/t46: what an interrupt's school lockout stops, read off the log. The
 * shape is 1d26a991's — a Retribution Paladin Spell Locked on a Holy cast
 * (5 s), Judgment and Blade of Justice (Holy, PreventionType 2) refused "not
 * ready" until the lock ends.
 */
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  finalize,
  load,
  MIN_REFUSALS,
  report,
  run,
} from "../scripts/scan5/t46";

const START = 1_000_000;
const KICK_S = 30;
const FLASH_OF_LIGHT = "19750"; // Holy, silenceable
const SPELL_LOCK = "19647"; // 5 s
const JUDGMENT = 20271; // Holy, pacify-only
const HAMMER_OF_WRATH = 24275; // Holy, silenceable
const BADGE = "345228"; // Arcane, PreventionType 6
const POLYMORPH = "118"; // Arcane

type Ctx = Parameters<typeof run>[0];

const success = (spellId: string, atS: number) => ({
  spellId,
  timestamp: START + atS * 1000,
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: START + atS * 1000,
  },
});
const kick = (interrupted: string, atS = KICK_S) => ({
  spellId: SPELL_LOCK,
  extraSpellId: interrupted,
  srcUnitId: "enemy",
  timestamp: START + atS * 1000,
  logLine: { event: "SPELL_INTERRUPT", timestamp: START + atS * 1000 },
});
const refused = (spellId: number, tSeconds: number) => ({
  tSeconds,
  unitGuid: "p",
  spellId,
  spellName: `spell-${spellId}`,
  reason: "Not yet recovered",
});

function scan(
  interrupted: string,
  casts: ReturnType<typeof success>[],
  failed: ReturnType<typeof refused>[],
): { checked: Record<string, number>; seen: string[] } {
  const seen: string[] = [];
  const checked: Record<string, number> = {};
  const player = {
    id: "p",
    name: "Player",
    reaction: 1,
    info: {},
    actionIn: [kick(interrupted)],
    spellCastEvents: casts,
  };
  const units = [player, { id: "enemy", name: "Enemy", reaction: 2 }];
  const ref = {
    where: "f",
    archive: "a",
    round: 1,
    roundKey: "a#1",
    start: START,
  };
  run({
    firstOwnerOfRound: true,
    players: [player],
    units,
    start: START,
    where: "f",
    ref,
    rawStreams: () => ({
      available: true,
      manaSamples: [],
      castFailed: failed,
    }),
    violate: (check: string, kind: string, _t: number, _f: string, d: string) =>
      seen.push(`${check}|${kind}: ${d}`),
    bump: (c: string, n = 1) => {
      checked[c] = (checked[c] ?? 0) + n;
    },
  } as unknown as Ctx);
  finalize((_ref, check, kind, _t, _f, detail) =>
    seen.push(`${check}|${kind}: ${detail}`),
  );
  return { checked, seen };
}

beforeAll(async () => {
  await ensureAnalysisData();
});
beforeEach(() => {
  load({ rows: new Map() });
});

describe("scan5/t46 — a school lockout and the spells of its school", () => {
  it("pacify-only refusals deep in a Holy lock are read as stopped: nothing to judge", () => {
    const failed = Array.from({ length: MIN_REFUSALS + 1 }, (_, i) =>
      refused(JUDGMENT, KICK_S + 0.5 + i * 0.2),
    );
    const r = scan(FLASH_OF_LIGHT, [], failed);
    // the product reads Judgment as stopped by the lock, so no refusal is
    // "read as not stopped" — the count that was 25 on 605 before T46
    expect(r).toEqual({ checked: {}, seen: [] });
    expect(report().join("\n")).toContain(
      `0(0) ${MIN_REFUSALS + 1}(1) 0 0/${MIN_REFUSALS + 1} ${JUDGMENT} Judgment [unsilenceable]`,
    );
  });

  it("a silenceable spell that went out deep in the lock is a violation; in the lock's second half it is only tallied", () => {
    const r = scan(
      FLASH_OF_LIGHT,
      [
        success(String(HAMMER_OF_WRATH), KICK_S + 1),
        success(String(HAMMER_OF_WRATH), KICK_S + 4),
      ],
      [],
    );
    expect(r.checked).toEqual({ lockedWentOut: 1 });
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]).toContain("lockedWentOut|silenceable: Hammer of Wrath");
    expect(report().join("\n")).toContain(
      `1(1) 0(0) 0 2/0 ${HAMMER_OF_WRATH} Hammer of Wrath [silenceable]`,
    );
  });

  it("a spell DB2 exempts (Gladiator's Badge under an Arcane lock) goes out without a violation", () => {
    const r = scan(POLYMORPH, [success(BADGE, KICK_S + 0.5)], []);
    expect(r).toEqual({ checked: { lockedWentOut: 1 }, seen: [] });
  });

  it("a spell outside the locked school is not counted at all", () => {
    const r = scan(POLYMORPH, [], [refused(JUDGMENT, KICK_S + 1)]);
    expect(r).toEqual({ checked: {}, seen: [] });
    expect(report()[1]).toContain("t46 per spell (0)");
  });
});
