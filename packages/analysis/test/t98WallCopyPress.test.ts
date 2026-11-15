/**
 * T98 (fact13 D5 / D11): a wall's talent copy is no press, and a press that
 * refreshes the copy is one.
 *
 *  - D5 (1a2fabdb 1:25): Exhilaration's Survival of the Fittest copy went up
 *    at .265 and the hunter's own press refreshed it at .528; the burst
 *    ledger's one interval of the aura (8.3 s) read `[no press logged]`
 *    while the `[ENEMY DEF]` timeline had the copy (0.3 s) and the press.
 *  - D11 (47a03469 r0 2:04.935): the same copy on the hunter and its pet, no
 *    264735 cast row in the round — the copy on the pet read as a press.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { analyzeBurstLedger, wallTimingPhrase } from "../src/utils/burstLedger";
import {
  effectEvidenceCastSeconds,
  petSharesOwnersCopy,
} from "../src/utils/cooldowns";
import { enemyDefensiveEvents } from "../src/utils/enemyDefensives";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T = 1_000_000;
const at = (s: number) => T + s * 1000;
const SOTF = "264735";
const EXHILARATION = "109304";
const info = { teamId: "0", specId: "x" } as unknown as NonNullable<
  Parameters<typeof makeUnit>[1]
>["info"];
type Combat = Parameters<typeof analyzeBurstLedger>[3];

const buff = (
  event: LogEvent,
  s: number,
  src: string,
  dest: string,
  name = "Hunter",
) => ({
  ...makeAuraEvent(event, SOTF, at(s), src, dest, "BUFF"),
  srcUnitName: name,
  spellName: "Survival of the Fittest",
});
const cast = (id: string, s: number, src = "e1", name = "Hunter") =>
  makeSpellCastEvent(id, at(s), "p1", "Ret", src, name, 0, id);

describe("T98 D5 — a copy a press refreshed is a pressed wall in the burst ledger", () => {
  const dmg = (s: number) => ({
    logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: at(s), parameters: [] },
    timestamp: at(s),
    effectiveAmount: -50_000,
    amount: -50_000,
    srcUnitId: "p1",
    srcUnitName: "Ret",
    destUnitId: "e1",
    destUnitName: "Hunter",
    spellId: "1",
    spellName: "TestSpell",
  });
  const ret = makeUnit("p1", {
    name: "Ret",
    spec: CombatUnitSpec.Paladin_Retribution,
    info,
    spellCastEvents: [
      makeSpellCastEvent(
        "31884",
        at(10),
        "p1",
        "S",
        "p1",
        "Ret",
        0,
        "Avenging Wrath",
      ),
    ],
    damageOut: [dmg(12), dmg(17)],
  });
  // copy at 13.5 (with Exhilaration), the hunter's own press refreshing it
  // 0.26 s later, the aura gone at 21.8
  const hunter = (pressS: number | undefined) =>
    makeUnit("e1", {
      name: "Hunter",
      spec: CombatUnitSpec.Hunter_Marksmanship,
      reaction: CombatUnitReaction.Hostile,
      info,
      auraEvents: [
        buff(LogEvent.SPELL_AURA_APPLIED, 13.5, "e1", "e1"),
        ...(pressS !== undefined
          ? [buff(LogEvent.SPELL_AURA_REFRESH, pressS, "e1", "e1")]
          : []),
        buff(
          LogEvent.SPELL_AURA_REMOVED,
          pressS !== undefined ? pressS + 8 : 16.5,
          "e1",
          "e1",
        ),
      ],
      spellCastEvents: [
        cast(EXHILARATION, 13.5),
        ...(pressS !== undefined ? [cast(SOTF, pressS)] : []),
      ],
    });
  const combat = { startTime: T, endTime: at(120) } as unknown as Combat;
  const hitOf = (u: ReturnType<typeof makeUnit>) =>
    analyzeBurstLedger(
      ret,
      [],
      [u],
      combat,
    )[0]!.dominantTarget?.defensivesHit.find((d) => d.spellId === SOTF);

  it("the [ENEMY DEF] timeline has the copy, then the press", () => {
    const events = enemyDefensiveEvents(hunter(13.76), [], {
      startTime: T,
      endTime: at(120),
    } as unknown as Parameters<typeof enemyDefensiveEvents>[2]).filter(
      (e) => e.spellId === SOTF,
    );
    expect(events.find((e) => e.noPressLogged)?.atSeconds).toBeCloseTo(13.5, 3);
    expect(events.find((e) => !e.noPressLogged)?.pressSeconds).toBeCloseTo(
      13.76,
      3,
    );
  });
  it("the ledger's one interval reads pressed, at the press", () => {
    const hit = hitOf(hunter(13.76));
    expect(hit?.noPressLogged).toBeUndefined();
    expect(wallTimingPhrase(hit)).toBe("pressed 3.8s after the burst opened");
  });
  it("a press later in the copy (the timeline cuts there) reads pressed too", () => {
    // 47a03469 r3 1:53: the copy 2.0 s, then the press — `splitAtRepressRefresh`
    const hit = hitOf(hunter(15.46));
    expect(hit?.noPressLogged).toBeUndefined();
    expect(wallTimingPhrase(hit)).toBe("pressed 5.5s after the burst opened");
  });
  it("a press that opens the next interval (the copy's REMOVED lost) is not the copy's", () => {
    // codex 85-tk-K-T98-1 #1: copy at 13.5, no REMOVED, a fresh press at 18
    const u = makeUnit("e1", {
      name: "Hunter",
      spec: CombatUnitSpec.Hunter_Marksmanship,
      reaction: CombatUnitReaction.Hostile,
      info,
      auraEvents: [
        buff(LogEvent.SPELL_AURA_APPLIED, 13.5, "e1", "e1"),
        buff(LogEvent.SPELL_AURA_APPLIED, 18, "e1", "e1"),
        buff(LogEvent.SPELL_AURA_REMOVED, 26, "e1", "e1"),
      ],
      spellCastEvents: [cast(EXHILARATION, 13.5), cast(SOTF, 18)],
    });
    const hits = analyzeBurstLedger(ret, [], [u], combat)[0]!
      .dominantTarget!.defensivesHit.filter((d) => d.spellId === SOTF)
      .sort((x, y) => (x.startOffsetMs ?? 0) - (y.startOffsetMs ?? 0));
    expect(hits.map((h) => wallTimingPhrase(h))).toEqual([
      "3.5s after the burst opened [no press logged]",
      "pressed 8.0s after the burst opened",
    ]);
  });
  it("a press in the copy's last instant still refreshed it", () => {
    // codex 85-tk-K-T98-1b #1: copy at 13.5, press at 15.46, gone at 15.48
    const u = makeUnit("e1", {
      name: "Hunter",
      spec: CombatUnitSpec.Hunter_Marksmanship,
      reaction: CombatUnitReaction.Hostile,
      info,
      auraEvents: [
        buff(LogEvent.SPELL_AURA_APPLIED, 13.5, "e1", "e1"),
        buff(LogEvent.SPELL_AURA_REFRESH, 15.46, "e1", "e1"),
        buff(LogEvent.SPELL_AURA_REMOVED, 15.48, "e1", "e1"),
      ],
      spellCastEvents: [cast(EXHILARATION, 13.5), cast(SOTF, 15.46)],
    });
    expect(wallTimingPhrase(hitOf(u))).toBe(
      "pressed 5.5s after the burst opened",
    );
  });
  it("a namesake's press is not the copy holder's (ids decide)", () => {
    // codex 85-tk-K-T98-1 #2: two units named alike; the other one's
    // external on the holder is no press of the holder's own copy
    const PS = "33206";
    const ps = (event: LogEvent, s: number, src: string) => ({
      ...makeAuraEvent(event, PS, at(s), src, "e1", "BUFF"),
      srcUnitName: "Priest",
      spellName: "Pain Suppression",
    });
    const holder = makeUnit("e1", {
      name: "Priest",
      spec: CombatUnitSpec.Priest_Discipline,
      reaction: CombatUnitReaction.Hostile,
      info,
      auraEvents: [
        ps(LogEvent.SPELL_AURA_APPLIED, 13.5, "e1"),
        ps(LogEvent.SPELL_AURA_APPLIED, 15.5, "e2"),
        ps(LogEvent.SPELL_AURA_REMOVED, 21.5, "e1"),
        ps(LogEvent.SPELL_AURA_REMOVED, 23.5, "e2"),
      ],
    });
    const twin = makeUnit("e2", {
      name: "Priest",
      spec: CombatUnitSpec.Priest_Discipline,
      reaction: CombatUnitReaction.Hostile,
      info,
      spellCastEvents: [
        {
          ...makeSpellCastEvent(
            PS,
            at(15.5),
            "e1",
            "Priest",
            "e2",
            "Priest",
            0,
            PS,
          ),
          spellName: "Pain Suppression",
        },
      ],
    });
    const hit = analyzeBurstLedger(
      ret,
      [],
      [holder, twin],
      combat,
    )[0]!.dominantTarget?.defensivesHit.find(
      (d) => d.spellId === PS && d.startOffsetMs === 3500,
    );
    expect(wallTimingPhrase(hit)).toBe(
      "3.5s after the burst opened [no press logged]",
    );
  });
  it("a press after the burst ended does not make its copy pressed", () => {
    // batch review 80-PIPE-73-B70 #1: the copy overlaps the burst's end, the
    // press refreshing it comes after the burst — only the unpressed copy
    // was up during the burst
    const toS = analyzeBurstLedger(ret, [], [hunter(undefined)], combat)[0]!
      .toSeconds;
    const u = makeUnit("e1", {
      name: "Hunter",
      spec: CombatUnitSpec.Hunter_Marksmanship,
      reaction: CombatUnitReaction.Hostile,
      info,
      auraEvents: [
        buff(LogEvent.SPELL_AURA_APPLIED, toS - 1, "e1", "e1"),
        buff(LogEvent.SPELL_AURA_REFRESH, toS + 1, "e1", "e1"),
        buff(LogEvent.SPELL_AURA_REMOVED, toS + 9, "e1", "e1"),
      ],
      spellCastEvents: [cast(EXHILARATION, toS - 1), cast(SOTF, toS + 1)],
    });
    const hit = hitOf(u);
    expect(hit?.noPressLogged).toBe(true);
  });
  it("the copy no press refreshed keeps [no press logged]", () => {
    const hit = hitOf(hunter(undefined));
    expect(hit?.noPressLogged).toBe(true);
    expect(wallTimingPhrase(hit)).toBe(
      "3.5s after the burst opened [no press logged]",
    );
  });
});

describe("T98 D11 — the copy on the caster's own pet is no press", () => {
  const PID = "h1";
  const PET = "pet1";
  const combatOf = (...us: ReturnType<typeof makeUnit>[]) =>
    ({
      startTime: T,
      endTime: at(180),
      units: Object.fromEntries(us.map((u) => [u.id, u])),
    }) as unknown as Parameters<typeof effectEvidenceCastSeconds>[3];
  const hunterWith = (auras: ReturnType<typeof buff>[]) =>
    makeUnit(PID, {
      name: "Hunter",
      spec: CombatUnitSpec.Hunter_Marksmanship,
      auraEvents: auras,
      spellCastEvents: [cast(EXHILARATION, 124.935, PID)],
    });
  const pet = makeUnit(PET, { name: "Pet", ownerId: PID });

  it("the copy on the hunter and its pet in one batch proves no press", () => {
    const u = hunterWith([
      buff(LogEvent.SPELL_AURA_APPLIED, 124.935, PID, PID),
      buff(LogEvent.SPELL_AURA_APPLIED, 124.935, PID, PET),
    ]);
    expect(effectEvidenceCastSeconds(u, SOTF, 90, combatOf(u, pet))).toEqual(
      [],
    );
  });
  it("the aura on the pet alone still proves a press (no owner copy)", () => {
    const u = hunterWith([
      buff(LogEvent.SPELL_AURA_APPLIED, 124.935, PID, PET),
    ]);
    expect(effectEvidenceCastSeconds(u, SOTF, 90, combatOf(u, pet))).toEqual([
      124.935,
    ]);
  });
  it("on an ally that is no pet, the owner's own copy beside it does not matter", () => {
    const ally = makeUnit("a1", { name: "Ally" });
    const u = hunterWith([
      buff(LogEvent.SPELL_AURA_APPLIED, 124.935, PID, PID),
      buff(LogEvent.SPELL_AURA_APPLIED, 124.935, PID, "a1"),
    ]);
    expect(effectEvidenceCastSeconds(u, SOTF, 90, combatOf(u, ally))).toEqual([
      124.935,
    ]);
  });
});

describe("T98 — petSharesOwnersCopy, one predicate for analysis and its gate", () => {
  // batch review 80-PIPE-73-B70 #3: Stampeding Roar self and pet rows under
  // two variant ids, no cast row
  const roar = (id: string, dest: string) => ({
    ...makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      id,
      at(20),
      "d1",
      dest,
      "BUFF",
    ),
    spellName: "Stampeding Roar",
  });
  const druid = makeUnit("d1", {
    name: "Druid",
    auraEvents: [roar("77761", "d1")] as never,
  });
  const pet = { id: "pet1", ownerId: "d1" };
  it("a variant id on the pet in the owner's batch is the owner's copy", () => {
    const is = petSharesOwnersCopy(druid, [druid, pet], "77764");
    expect(is(roar("77764", "pet1") as never)).toBe(true);
  });
  it("another unit is no pet", () => {
    const is = petSharesOwnersCopy(druid, [druid, pet], "77764");
    expect(is(roar("77764", "x9") as never)).toBe(false);
  });
});
