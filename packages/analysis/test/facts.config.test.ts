import { afterEach, describe, expect, it } from "vitest";

import { classMetadata } from "../src/data/classSpells";
import inventory from "../src/data/talentEffectInventoryGenerated.json";
import {
  type DecisionRecord,
  setDecisionSink,
  traceDecision,
} from "../src/facts/decisionTrace";
import {
  __resetFactConfigForTests,
  configureFacts,
  getFactConfig,
  PRODUCTION_FACT_CONFIG,
} from "../src/facts/factProviderConfig";

// GH #96 D6 — one immutable fact configuration per process, and a trace that
// is inert unless an eval harness installs a sink.
describe("fact provider configuration", () => {
  afterEach(() => {
    __resetFactConfigForTests();
    delete process.env.GLADLOG_FACT_CONFIG;
  });

  it("defaults to the production configuration", () => {
    expect(getFactConfig()).toEqual(PRODUCTION_FACT_CONFIG);
  });

  it("rejects unknown switches from the environment and from configureFacts", () => {
    process.env.GLADLOG_FACT_CONFIG = '{"noSuchSwitch":true}';
    expect(() => getFactConfig()).toThrow(/unknown switch/);
    __resetFactConfigForTests();
    delete process.env.GLADLOG_FACT_CONFIG;
    expect(() => configureFacts({ noSuchSwitch: true })).toThrow(
      /unknown switch/,
    );
  });

  it("re-selecting the same configuration after a read is allowed", () => {
    getFactConfig();
    expect(() => configureFacts({})).not.toThrow();
  });
});

describe("decision trace", () => {
  afterEach(() => setDecisionSink(null));

  const rec: DecisionRecord = {
    type: "cd-hoarded",
    opportunityId: "o1",
    ownerId: "p1",
    verdict: "suppressed",
    reason: "no-ready-cd",
    facts: {},
    candidateIds: [],
  };

  it("is a no-op without a sink", () => {
    expect(() => traceDecision(rec)).not.toThrow();
  });

  it("delivers records to the installed sink", () => {
    const got: DecisionRecord[] = [];
    setDecisionSink((r) => got.push(r));
    traceDecision(rec);
    expect(got).toEqual([rec]);
  });
});

// GH #96 D5. A cooldown modifier carried by a TEMPORARY buff (finite duration:
// Berserk, Incarnation: Guardian of Ursoc, Ascendance, Avatar) is excluded from
// the permanent cooldown table since M0, so a "not ready" claim on its target
// could be wrong while the buff ran. Measured 2026-09-13 (build 12.1.0.69587):
// 20 such modifier edges, all REDUCTIONS, targeting Growl / Mangle / Thrash /
// Frenzied Regeneration / Force of Nature / Nightmare Echo / Stormstrike /
// Windstrike / Thunder Clap / Thunder Blast — none tracked by the cooldown
// ledger, so no product claim can be affected and no uncertainty wiring exists
// yet. This guard turns that measurement into a tripwire: the moment a target
// enters the ledger (e.g. someone adds Frenzied Regeneration to classMetadata),
// the readiness claims about it must first become "uncertain" while the source
// aura overlapped the recharge (design D5).
describe("temporary cooldown modifiers never reach a tracked cooldown (D5 tripwire)", () => {
  it("no whileAura cooldown/charge modifier targets a classMetadata ability", () => {
    const tracked = new Set(
      classMetadata.flatMap((c) =>
        c.abilities.filter((a) => a.tags.length > 0).map((a) => a.spellId),
      ),
    );
    const hop0 = new Set(
      (inventory.edges as Array<{ spellId: string; hop: number }>)
        .filter((e) => e.hop === 0)
        .map((e) => e.spellId),
    );
    const isCooldownMod = (r: {
      effect: number;
      aura: number;
      misc0: number;
    }) =>
      r.effect === 121 ||
      r.effect === 148 ||
      (r.effect === 6 &&
        (r.aura === 411 ||
          r.aura === 453 ||
          r.aura === 454 ||
          ((r.aura === 107 || r.aura === 108) && r.misc0 === 11)));
    const hits: string[] = [];
    for (const r of inventory.rows as Array<{
      spellId: string;
      effect: number;
      aura: number;
      misc0: number;
      activation: string;
      targets: Array<{ spellId: string }>;
    }>) {
      if (r.activation !== "whileAura" || !hop0.has(r.spellId)) continue;
      if (!isCooldownMod(r)) continue;
      for (const t of r.targets)
        if (tracked.has(t.spellId)) hits.push(`${r.spellId}→${t.spellId}`);
    }
    expect(hits).toEqual([]);
  });
});
