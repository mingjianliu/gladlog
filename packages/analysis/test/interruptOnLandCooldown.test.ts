/**
 * FT-T11c (2026-10-09): an on-interrupt talent shortens the cooldown of a
 * press that interrupted a cast, for its holder only — Coldthirst (Mind
 * Freeze −3 s), Light of the Sun (Solar Beam −15 s). One number
 * (`interruptPressCooldownSeconds`) behind `[KICK] … back`, kick readiness
 * and the owner's [RES] kick entry.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  ON_INTERRUPT_COOLDOWN_REDUCTIONS,
  onInterruptReductionFor,
} from "../src/data/talentScriptedCooldowns";
import {
  interruptCooldownRemainingMs,
  interruptBackAtMs,
  interruptCooldownSeconds,
  interruptPressCooldownSeconds,
  LANDED_PAIR_MS,
} from "../src/utils/enemyInterrupts";
import { LANDED_PAIR_MS as AUDIT_LANDED_PAIR_MS } from "../src/utils/kickAudit";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const MIND_FREEZE = "47528";
const COLDTHIRST = "378848";
const SOLAR_BEAM = "78675";
const LIGHT_OF_THE_SUN = "202918";

const interrupt = (atS: number): any => ({
  spellId: MIND_FREEZE,
  spellName: "Mind Freeze",
  timestamp: T0 + atS * 1000,
  srcUnitId: "p1",
  destUnitId: "e1",
  logLine: { event: LogEvent.SPELL_INTERRUPT, timestamp: T0 + atS * 1000 },
});
/** Coldthirst's node in the Death Knight class tree (resolves to 378848). */
const COLDTHIRST_NODE = "76083";
/** A Death Knight who pressed Mind Freeze at `kickS`; `talents` = tree
 * nodes; `landedS` = the presses that have a SPELL_INTERRUPT. */
const knight = (kickS: number[], talents: string[], landedS: number[]) =>
  makeUnit("p1", {
    name: "Knight",
    spec: "252",
    info: {
      teamId: "0",
      specId: "252",
      // tree node ids (COMBATANT_INFO lists nodes, not spell ids)
      talents: talents.map((node) => ({ id1: Number(node), id2: 0, count: 1 })),
      pvpTalents: [],
    },
    spellCastEvents: kickS.map((s) =>
      makeSpellCastEvent(MIND_FREEZE, T0 + s * 1000, "e1", "E", "p1", "Knight"),
    ),
    actionOut: landedS.map(interrupt),
  } as any);

describe("FT-T11c — on-interrupt cooldown talents", () => {
  it("表:两个天赋、各自的打断和秒数;只对持有者给出秒数", () => {
    expect(ON_INTERRUPT_COOLDOWN_REDUCTIONS[COLDTHIRST]).toMatchObject({
      spellId: MIND_FREEZE,
      seconds: 3,
    });
    expect(ON_INTERRUPT_COOLDOWN_REDUCTIONS[LIGHT_OF_THE_SUN]).toMatchObject({
      spellId: SOLAR_BEAM,
      seconds: 15,
    });
    expect(onInterruptReductionFor(MIND_FREEZE, (t) => t === COLDTHIRST)).toBe(
      3,
    );
    expect(onInterruptReductionFor(MIND_FREEZE, () => false)).toBe(0);
    expect(onInterruptReductionFor(SOLAR_BEAM, (t) => t === COLDTHIRST)).toBe(
      0,
    );
  });

  it("审计和冷却用同一个「打断成功」配对窗口", () => {
    expect(AUDIT_LANDED_PAIR_MS).toBe(LANDED_PAIR_MS);
  });

  it("没有持有者信息的单位:这一下的冷却就是静态冷却(不猜)", () => {
    const u = makeUnit("p1", {
      spellCastEvents: [],
      actionOut: [interrupt(30)],
    } as any);
    expect(interruptPressCooldownSeconds(u, MIND_FREEZE, T0 + 30_000, 15)).toBe(
      15,
    );
  });

  it("持有 Coldthirst 且这一下打断成功:15 → 12 秒;就绪时刻跟着提前", () => {
    const holder = knight([30], [COLDTHIRST_NODE], [30.02]);
    const base = interruptCooldownSeconds(MIND_FREEZE, holder)!;
    expect(
      interruptPressCooldownSeconds(holder, MIND_FREEZE, T0 + 30_000, base),
    ).toBe(base - 3);
    // 30 秒按下:base − 3 秒时已好,差 1 秒时还没好
    expect(
      interruptCooldownRemainingMs(
        holder,
        MIND_FREEZE,
        T0 + (30 + base - 3) * 1000,
      ),
    ).toBe(0);
    expect(
      interruptCooldownRemainingMs(
        holder,
        MIND_FREEZE,
        T0 + (30 + base - 4) * 1000,
      ),
    ).toBe(1000);
  });

  it("同一秒里另一个技能的 SPELL_INTERRUPT 不算这次按键打断成功", () => {
    const holder = knight([30], [COLDTHIRST_NODE], []);
    (holder as any).actionOut = [{ ...interrupt(30.3), spellId: "91807" }];
    const base = interruptCooldownSeconds(MIND_FREEZE, holder)!;
    expect(
      interruptPressCooldownSeconds(holder, MIND_FREEZE, T0 + 30_000, base),
    ).toBe(base);
  });

  describe("Light of the Sun 只认主目标;返回时刻从按键算(codex 40-FT-40)", () => {
    const LOTS_NODE = "104083"; // Balance tree node → 202918
    const beam = (atS: number, dest: string): any => ({
      spellId: "97547", // Solar Beam's interrupt-effect id
      spellName: "Solar Beam",
      timestamp: T0 + atS * 1000,
      srcUnitId: "p1",
      destUnitId: dest,
      logLine: { event: LogEvent.SPELL_INTERRUPT, timestamp: T0 + atS * 1000 },
    });
    const druid = (interrupts: any[]) =>
      makeUnit("p1", {
        name: "Druid",
        spec: "102",
        info: {
          teamId: "0",
          specId: "102",
          talents: [{ id1: Number(LOTS_NODE), id2: 0, count: 1 }],
          pvpTalents: [],
        },
        // aimed at e1
        spellCastEvents: [
          makeSpellCastEvent(SOLAR_BEAM, T0 + 30_000, "e1", "A", "p1", "Druid"),
        ],
        actionOut: interrupts,
      } as any);

    it("主目标被打断:60 → 45 秒,back = 按键 + 45", () => {
      const u = druid([beam(30.01, "e1")]);
      const base = interruptCooldownSeconds(SOLAR_BEAM, u)!;
      expect(
        interruptPressCooldownSeconds(u, SOLAR_BEAM, T0 + 30_000, base),
      ).toBe(base - 15);
      expect(interruptBackAtMs(u, "97547", T0 + 30_010, base)).toBe(
        T0 + (30 + base - 15) * 1000,
      );
    });

    it("主目标没在读条,另一个人半秒后走进光束被打断:不减", () => {
      const u = druid([beam(30.5, "e2")]);
      const base = interruptCooldownSeconds(SOLAR_BEAM, u)!;
      expect(
        interruptPressCooldownSeconds(u, SOLAR_BEAM, T0 + 30_000, base),
      ).toBe(base);
    });

    it("4 秒后光束里的人被打断:那一行的 back 仍从 0:30 的按键算,不从 0:34 算", () => {
      const u = druid([beam(34, "e2")]);
      const base = interruptCooldownSeconds(SOLAR_BEAM, u)!;
      expect(interruptBackAtMs(u, "97547", T0 + 34_000, base)).toBe(
        T0 + (30 + base) * 1000,
      );
    });

    it("回合里找不到这次打断的按键(或那次按键早已转好):从打断行自己的时刻算", () => {
      const noCast = makeUnit("p1", {
        spec: "102",
        spellCastEvents: [],
        actionOut: [beam(34, "e2")],
      } as any);
      expect(interruptBackAtMs(noCast, "97547", T0 + 34_000, 60)).toBe(
        T0 + 94_000,
      );
      const u = druid([beam(200, "e1")]);
      const base = interruptCooldownSeconds(SOLAR_BEAM, u)!;
      expect(interruptBackAtMs(u, "97547", T0 + 200_000, base)).toBe(
        T0 + (200 + base) * 1000,
      );
    });
  });

  it("没点天赋的人打断成功也不减", () => {
    const plain = knight([30], [], [30.02]);
    const base = interruptCooldownSeconds(MIND_FREEZE, plain)!;
    expect(
      interruptPressCooldownSeconds(plain, MIND_FREEZE, T0 + 30_000, base),
    ).toBe(base);
  });

  it("没打断到东西的那一下不减,不管有没有天赋", () => {
    const holder = knight([30], [COLDTHIRST_NODE], []);
    const base = interruptCooldownSeconds(MIND_FREEZE, holder)!;
    expect(
      interruptPressCooldownSeconds(holder, MIND_FREEZE, T0 + 30_000, base),
    ).toBe(base);
    // 就绪判断同样:30 秒按下,base 秒后才好
    expect(
      interruptCooldownRemainingMs(
        holder,
        MIND_FREEZE,
        T0 + (30 + base - 1) * 1000,
      ),
    ).toBeGreaterThan(0);
  });
});
