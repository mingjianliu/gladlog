/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GH #167 (fact6 leftovers): an enemy offensive effect its holder's death
 * cut short. 121afd91 r6 1:55 printed `Dark Transformation (5s left)`
 * because the observed aura ended in the Death Knight's 2:00 death — a
 * death the 1:55 row cannot know. The row keeps the effect until the death
 * and states the official time left.
 */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildResourceSnapshot } from "../src/context/resourceSnapshot";
import { ensureAnalysisData } from "../src/data/ensure";
import { reconstructEnemyCDTimeline } from "../src/utils/enemyCDs";
import { SOLO_SHUFFLE_BRACKET } from "../src/utils/roundEnd";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const START = 1_000_000;
const AVATAR = "107574"; // 20 s

const aura = (
  event: LogEvent,
  spellId: string,
  ms: number,
  src: [string, string],
  dest: string,
) => ({
  ...makeAuraEvent(event, spellId, ms, src[0], dest, "BUFF"),
  srcUnitName: src[1],
});

function scene(deathS: number) {
  const warrior = makeUnit("e1", {
    name: "Warrior",
    spec: CombatUnitSpec.Warrior_Arms,
    spellCastEvents: [
      makeSpellCastEvent(
        AVATAR,
        START + 10_000,
        "e1",
        "Warrior",
        "e1",
        "Warrior",
      ),
    ],
    auraEvents: [
      {
        ...makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          AVATAR,
          START + 10_000,
          "e1",
          "e1",
          "BUFF",
        ),
        srcUnitName: "Warrior",
      },
      {
        ...makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          AVATAR,
          START + 15_000,
          "e1",
          "e1",
          "BUFF",
        ),
        srcUnitName: "Warrior",
      },
    ],
  } as any);
  (warrior as any).deathRecords = [{ timestamp: START + deathS * 1000 }];
  const combat = {
    startTime: START,
    endTime: START + 200_000,
    units: { e1: warrior },
  } as any;
  return reconstructEnemyCDTimeline([warrior], combat);
}

const enemyField = (timeline: any, t: number) =>
  buildResourceSnapshot({
    timeSeconds: t,
    ownerCDs: [],
    ownerName: "Owner",
    ownerSpec: "Restoration Druid",
    teammateCDs: [],
    ccTrinketSummaries: [],
    enemyCDTimeline: timeline,
    matchStartMs: START,
  }).match(/enemy:(.+)$/)?.[1];

describe("[RES] enemy: time left of an effect its holder's death cut short (GH #167)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("removed in the death cascade → the row before the death states the official 20 s", () => {
    const tl = scene(15.04);
    const cd = tl.players[0]!.offensiveCDs[0]!;
    expect(cd.buffEndSeconds).toBeCloseTo(15, 3);
    expect(cd.deathCutOfficialEndSeconds).toBeCloseTo(30, 3);
    expect(enemyField(tl, 12)).toContain("(18s left)");
    // shown until the death, as before
    expect(enemyField(tl, 16)).toBeUndefined();
  });

  it("control: removed long before the holder died → the observed end stands", () => {
    const tl = scene(40);
    const cd = tl.players[0]!.offensiveCDs[0]!;
    expect(cd.deathCutOfficialEndSeconds).toBeUndefined();
    expect(enemyField(tl, 12)).toContain("(3s left)");
  });

  it("codex 20-G167-02 #5: the REMOVED logged just after the UNIT_DIED is the cascade too", () => {
    const cd = scene(14.96).players[0]!.offensiveCDs[0]!;
    expect(cd.deathCutOfficialEndSeconds).toBeCloseTo(30, 3);
  });

  it("codex 20-G167-02 #3: the holder's death, not the caster's — Power Infusion on a teammate", () => {
    const priest = makeUnit("e2", {
      name: "Priest",
      spec: CombatUnitSpec.Priest_Shadow,
      spellCastEvents: [
        makeSpellCastEvent(
          "10060",
          START + 10_000,
          "e2",
          "Priest",
          "e1",
          "Mate",
        ),
      ],
    } as any);
    const mate = makeUnit("e1", {
      name: "Mate",
      spec: CombatUnitSpec.Warrior_Arms,
      auraEvents: [
        aura(
          LogEvent.SPELL_AURA_APPLIED,
          "10060",
          START + 10_000,
          ["e2", "Priest"],
          "e1",
        ),
        aura(
          LogEvent.SPELL_AURA_REMOVED,
          "10060",
          START + 13_000,
          ["e2", "Priest"],
          "e1",
        ),
      ],
    } as any);
    (mate as any).deathRecords = [{ timestamp: START + 13_030 }];
    const combat = {
      startTime: START,
      endTime: START + 200_000,
      units: { e1: mate, e2: priest },
    } as any;
    const cd = reconstructEnemyCDTimeline([priest, mate], combat).players.find(
      (p) => p.playerName === "Priest",
    )!.offensiveCDs[0]!;
    expect(cd.buffEndSeconds).toBeCloseTo(13, 3);
    expect(cd.deathCutOfficialEndSeconds).toBeGreaterThan(13);
    // control: the caster dying there instead says nothing about the buff
    (mate as any).deathRecords = [];
    (priest as any).deathRecords = [{ timestamp: START + 13_030 }];
    expect(
      reconstructEnemyCDTimeline([priest, mate], combat).players.find(
        (p) => p.playerName === "Priest",
      )!.offensiveCDs[0]!.deathCutOfficialEndSeconds,
    ).toBeUndefined();
  });

  it("codex 20-G167-02 #4: a Solo Shuffle round ended by another player's death", () => {
    const warrior = makeUnit("e1", {
      name: "Warrior",
      spec: CombatUnitSpec.Warrior_Arms,
      info: {} as any,
      spellCastEvents: [
        makeSpellCastEvent(
          AVATAR,
          START + 10_000,
          "e1",
          "Warrior",
          "e1",
          "Warrior",
        ),
      ],
      auraEvents: [
        aura(
          LogEvent.SPELL_AURA_APPLIED,
          AVATAR,
          START + 10_000,
          ["e1", "Warrior"],
          "e1",
        ),
        aura(
          LogEvent.SPELL_AURA_REMOVED,
          AVATAR,
          START + 15_000,
          ["e1", "Warrior"],
          "e1",
        ),
      ],
    } as any);
    const other = makeUnit("p9", { name: "Other", info: {} as any } as any);
    (other as any).deathRecords = [{ timestamp: START + 15_020 }];
    const combat = (bracket: string) =>
      ({
        startTime: START,
        endTime: START + 200_000,
        startInfo: { bracket },
        units: { e1: warrior, p9: other },
      }) as any;
    const cut = (bracket: string) =>
      reconstructEnemyCDTimeline([warrior], combat(bracket)).players[0]!
        .offensiveCDs[0]!.deathCutOfficialEndSeconds;
    expect(cut(SOLO_SHUFFLE_BRACKET)).toBeCloseTo(30, 3);
    // control: in a 3v3 another player's death ends no one's buff
    expect(cut("Rated Arena 3v3")).toBeUndefined();
  });

  it("codex 20-G167-02 #1: a later press of the chain whose span ends later does not shorten the cut press's time left", () => {
    const timeline = {
      players: [
        {
          playerName: "Warrior",
          specName: "Arms Warrior",
          offensiveCDs: [
            {
              spellId: AVATAR,
              spellName: "Avatar",
              castTimeSeconds: 10,
              cooldownSeconds: 90,
              availableAgainAtSeconds: 100,
              buffEndSeconds: 15,
              deathCutOfficialEndSeconds: 30,
              dangerWeight: 1,
            },
            {
              spellId: AVATAR,
              spellName: "Avatar",
              castTimeSeconds: 13,
              cooldownSeconds: 90,
              availableAgainAtSeconds: 103,
              buffEndSeconds: 15.5,
              dangerWeight: 1,
            },
          ],
        },
      ],
      alignedBurstWindows: [],
    };
    expect(enemyField(timeline, 14)).toContain("(16s left)");
  });

  it("codex 20-G167-02 #2: an aura-only occurrence (Havoc Metamorphosis — the button never logs) cut by its holder's death", () => {
    const dh = (deathS: number) => {
      const u = makeUnit("e1", {
        name: "Dh",
        spec: CombatUnitSpec.DemonHunter_Havoc,
        spellCastEvents: [
          makeSpellCastEvent("200166", START + 10_400, "e1", "Dh", "e1", "Dh"),
        ],
        auraEvents: [
          aura(
            LogEvent.SPELL_AURA_APPLIED,
            "162264",
            START + 10_000,
            ["e1", "Dh"],
            "e1",
          ),
          aura(
            LogEvent.SPELL_AURA_REMOVED,
            "162264",
            START + 15_000,
            ["e1", "Dh"],
            "e1",
          ),
        ],
      } as any);
      (u as any).deathRecords = [{ timestamp: START + deathS * 1000 }];
      return u;
    };
    const metaOf = (deathS: number) => {
      const u = dh(deathS);
      return reconstructEnemyCDTimeline([u], {
        startTime: START,
        endTime: START + 200_000,
        units: { e1: u },
      } as any).players[0]!.offensiveCDs.find((c) => c.spellId === "191427")!;
    };
    const cut = metaOf(15.04);
    expect(cut.buffEndSeconds).toBeCloseTo(15, 3);
    expect(cut.deathCutOfficialEndSeconds).toBeGreaterThan(15);
    expect(metaOf(40).deathCutOfficialEndSeconds).toBeUndefined();
  });

  it("codex 20-G167-06 #1: a Demonic form (Eye Beam) cut by its holder's death keeps Demonic's 5 s, not Metamorphosis's", () => {
    const u = makeUnit("e1", {
      name: "Dh",
      spec: CombatUnitSpec.DemonHunter_Havoc,
      spellCastEvents: [
        makeSpellCastEvent("198013", START + 9_800, "e1", "Dh", "e2", "X"),
      ],
      auraEvents: [
        aura(
          LogEvent.SPELL_AURA_APPLIED,
          "162264",
          START + 10_000,
          ["e1", "Dh"],
          "e1",
        ),
        aura(
          LogEvent.SPELL_AURA_REMOVED,
          "162264",
          START + 13_000,
          ["e1", "Dh"],
          "e1",
        ),
      ],
    } as any);
    (u as any).deathRecords = [{ timestamp: START + 13_040 }];
    const tl = reconstructEnemyCDTimeline([u], {
      startTime: START,
      endTime: START + 200_000,
      units: { e1: u },
    } as any);
    const form = [
      ...tl.players[0]!.offensiveCDs,
      ...(tl.players[0]!.offensiveFacts ?? []),
    ].find((c) => c.spellId === "162264")!;
    expect(form.buffEndSeconds).toBeCloseTo(13, 3);
    expect(form.deathCutOfficialEndSeconds).toBeCloseTo(15, 3);
  });

  it("codex 20-G167-06 #3: a natural expiry at the aura's own end beside a Shuffle round's death is no cut (the press logged after its aura)", () => {
    const warrior = makeUnit("e1", {
      name: "Warrior",
      spec: CombatUnitSpec.Warrior_Arms,
      info: {} as any,
      spellCastEvents: [
        makeSpellCastEvent(
          AVATAR,
          START + 10_500,
          "e1",
          "Warrior",
          "e1",
          "Warrior",
        ),
      ],
      auraEvents: [
        aura(
          LogEvent.SPELL_AURA_APPLIED,
          AVATAR,
          START + 10_000,
          ["e1", "Warrior"],
          "e1",
        ),
        aura(
          LogEvent.SPELL_AURA_REMOVED,
          AVATAR,
          START + 30_000,
          ["e1", "Warrior"],
          "e1",
        ),
      ],
    } as any);
    const other = makeUnit("p9", { name: "Other", info: {} as any } as any);
    (other as any).deathRecords = [{ timestamp: START + 30_080 }];
    const tl = reconstructEnemyCDTimeline([warrior], {
      startTime: START,
      endTime: START + 200_000,
      startInfo: { bracket: SOLO_SHUFFLE_BRACKET },
      units: { e1: warrior, p9: other },
    } as any);
    expect(
      tl.players[0]!.offensiveCDs[0]!.deathCutOfficialEndSeconds,
    ).toBeUndefined();
  });

  const avatarScene = (
    casts: number[],
    rows: Array<[LogEvent, number]>,
    deathS: number,
  ) => {
    const warrior = makeUnit("e1", {
      name: "Warrior",
      spec: CombatUnitSpec.Warrior_Arms,
      spellCastEvents: casts.map((t) =>
        makeSpellCastEvent(
          AVATAR,
          START + t * 1000,
          "e1",
          "Warrior",
          "e1",
          "Warrior",
        ),
      ),
      auraEvents: rows.map(([ev, t]) =>
        aura(ev, AVATAR, START + t * 1000, ["e1", "Warrior"], "e1"),
      ),
    } as any);
    (warrior as any).deathRecords = [{ timestamp: START + deathS * 1000 }];
    return reconstructEnemyCDTimeline([warrior], {
      startTime: START,
      endTime: START + 200_000,
      units: { e1: warrior },
    } as any);
  };

  it("codex 20-G167-11 #1: a press that refreshed the aura restarts its official length", () => {
    const tl = avatarScene(
      [10, 20],
      [
        [LogEvent.SPELL_AURA_APPLIED, 10],
        [LogEvent.SPELL_AURA_REFRESH, 20],
        [LogEvent.SPELL_AURA_REMOVED, 25],
      ],
      25.04,
    );
    const second = tl.players[0]!.offensiveCDs.find(
      (c) => Math.abs(c.castTimeSeconds - 20) < 0.01,
    )!;
    expect(second.deathCutOfficialEndSeconds).toBeCloseTo(40, 3);
    expect(enemyField(tl, 22)).toContain("(18s left)");
  });

  it("codex 20-G167-11 #2: a 0.3 s cut that moves the rounded number still counts", () => {
    const tl = avatarScene(
      [10.6],
      [
        [LogEvent.SPELL_AURA_APPLIED, 10.6],
        [LogEvent.SPELL_AURA_REMOVED, 30.3],
      ],
      30.34,
    );
    expect(
      tl.players[0]!.offensiveCDs[0]!.deathCutOfficialEndSeconds,
    ).toBeCloseTo(30.6, 3);
    expect(enemyField(tl, 25)).toContain("(6s left)");
  });
});
