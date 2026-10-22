/**
 * F16 same-round retest (2026-10-21), [BUFF FADED] cause:
 * - idx 30 (19c03171 0:38 / 0:59): Vanish 11327 lasts 1.5 s, the early-end
 *   slack was 1.5 s, so a Vanish broken 0.39 s in read "(expired)".
 * - idx 41 (4b2e238d 1:43): Frenzied Regeneration removed 0.68 s before its
 *   end, 10 ms after Bear Form came off — a form shift, read "(expired)".
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { extractOwnerCDBuffExpiry } from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import { spellEffectData } from "../src/data/spellEffectData";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);

beforeAll(async () => {
  await ensureAnalysisData();
});

const owner = (
  cls: CombatUnitClass,
  spec: CombatUnitSpec,
  spellId: string,
  castS: number,
  removedS: number,
  extra: ReturnType<typeof makeAuraEvent>[] = [],
) =>
  makeUnit("player-1", {
    name: "You",
    class: cls,
    spec,
    info: {},
    spellCastEvents: [makeSpellCastEvent(spellId, at(castS), "player-1")],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        spellId,
        at(castS),
        "player-1",
        "player-1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        spellId,
        at(removedS),
        "player-1",
        "player-1",
        "BUFF",
      ),
      ...extra,
    ].sort((a, b) => a.timestamp - b.timestamp),
  });

const cdOf = (spellId: string, spellName: string, castS: number) => [
  {
    spellId,
    spellName,
    tag: "Defensive",
    casts: [{ timeSeconds: castS }],
    cooldownSeconds: 120,
    neverUsed: false,
    availableWindows: [],
  },
];

const causeOf = (u: ReturnType<typeof owner>, cds: ReturnType<typeof cdOf>) =>
  extractOwnerCDBuffExpiry(cds as never, u.id, [u], T0, u, [], at(300)).map(
    (e) => e.cause,
  );

describe("F16 retest — [BUFF FADED] cause of a short buff and a form-bound one", () => {
  it("Vanish (1.5 s) removed 0.39 s in ended early; removed at 1.45 s it expired", () => {
    const V = "11327";
    expect(
      causeOf(
        owner(
          CombatUnitClass.Rogue,
          CombatUnitSpec.Rogue_Subtlety,
          V,
          38.561,
          38.948,
        ),
        cdOf(V, "Vanish", 38.561),
      ),
    ).toEqual(["ended_early"]);
    expect(
      causeOf(
        owner(
          CombatUnitClass.Rogue,
          CombatUnitSpec.Rogue_Subtlety,
          V,
          38.561,
          40.011,
        ),
        cdOf(V, "Vanish", 38.561),
      ),
    ).toEqual(["expired"]);
  });

  it("Frenzied Regeneration (3 s) removed 0.68 s early, 10 ms after Bear Form came off → form_shift; with no form removal → expired", () => {
    const FR = "22842";
    const BEAR = "5487";
    const bearOff = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      BEAR,
      at(54.864),
      "player-1",
      "player-1",
      "BUFF",
    );
    expect(
      causeOf(
        owner(
          CombatUnitClass.Druid,
          CombatUnitSpec.Druid_Restoration,
          FR,
          52.554,
          54.874,
          [bearOff],
        ),
        cdOf(FR, "Frenzied Regeneration", 52.554),
      ),
    ).toEqual(["form_shift"]);
    expect(
      causeOf(
        owner(
          CombatUnitClass.Druid,
          CombatUnitSpec.Druid_Restoration,
          FR,
          52.554,
          54.874,
        ),
        cdOf(FR, "Frenzied Regeneration", 52.554),
      ),
    ).toEqual(["expired"]);
  });

  it("fact3 D50 / user ruling 2026-10-21: Intervene runs its arena 3 s — a 3.0 s run expired", () => {
    const u = makeUnit("player-1", {
      name: "You",
      class: CombatUnitClass.Warrior,
      spec: CombatUnitSpec.Warrior_Arms,
      info: {},
      spellCastEvents: [makeSpellCastEvent("3411", at(31.59), "mate")],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "147833",
          at(31.59),
          "player-1",
          "mate",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "147833",
          at(34.59),
          "player-1",
          "mate",
          "BUFF",
        ),
      ],
    });
    const mate = makeUnit("mate", {
      name: "Mate",
      info: {},
      auraEvents: u.auraEvents,
    });
    const causes = extractOwnerCDBuffExpiry(
      cdOf("3411", "Intervene", 31.59) as never,
      u.id,
      [u, mate],
      T0,
      u,
      [],
      at(300),
    ).map((e) => e.cause);
    expect(causes).toEqual(["expired"]);
    expect(spellEffectData["147833"]?.durationSeconds).toBe(3);
  });
});
