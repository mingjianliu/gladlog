/**
 * Unit tests for the geometry grounding scanner — a synthetic fixture of
 * stationary units (zero displacement, so mutations must be detected 100% of the
 * time and a fast-movement escape cannot be triggered). This carries the hard
 * gate on mutation detection.
 */
import {
  CC_MAX_PLAUSIBLE_RANGE_YARDS,
  computeOwnerPositionEvents,
  formatPositionEventsForContext,
} from "@gladlog/analysis";
import { describe, expect, it } from "vitest";
import {
  checkGeoClaims,
  extractGeoClaims,
  mutationDetectionRate,
} from "../src/quality/positioningScan";

/** A stationary unit: fixed coordinates for the entire match. */
function staticUnit(name: string, x: number, y: number, startMs: number): any {
  const advancedActions = Array.from({ length: 61 }, (_, i) => i * 2_000).map(
    (dt) => ({
      timestamp: startMs + dt,
      advancedActorCurrentHp: 100,
      advancedActorMaxHp: 100,
      advancedActorPositionX: x,
      advancedActorPositionY: y,
      advanced: true,
      advancedActorPowers: [],
    }),
  );
  return { name, advancedActions };
}

const START = 1_000_000;
// The owner sits at the origin and the enemy caster at (10, 0) — a constant 10yd
const owner = staticUnit("Me-Realm-US", 0, 0, START);
const friendB = staticUnit("Buddy-Realm-US", 0, 5, START);
const caster = staticUnit("Bad-Realm-US", 10, 0, START);

const ctx = {
  owner,
  friends: [owner, friendB],
  enemies: [caster],
  // Nagrand — a zone with no obstacle data; G5 tests configure their own
  zoneId: "1505",
  matchStartMs: START,
  unitIdMap: new Map<number, string>([
    [1, "Me-Realm-US"],
    [2, "Buddy-Realm-US"],
    [3, "Bad-Realm-US"],
  ]),
};

const PROMPT = [
  '  <unit id="1" name="Me-Realm-US" spec="Holy Paladin" role="log owner">',
  '  <unit id="2" name="Buddy-Realm-US" spec="Arms Warrior" role="teammate">',
  '  <unit id="3" name="Bad-Realm-US" spec="Subtlety Rogue" role="enemy">',
  "0:30  [CC ON TEAM]   1(HPaladin) ← Cheap Shot (by 3(SRogue)) | 4s [DR: Stun Full] | 10.0yd from caster",
  "  0:40–0:50 you were camped by Bad-Realm-US (closest 10.0yd) — no CC on the healer during this window",
  "    0:55 [High burst] 10→10yd from Bad-Realm-US — you were the burst target",
].join("\n");

describe("extractGeoClaims", () => {
  it("extracts unit id map and all claim kinds", () => {
    const { claims, unitIdMap } = extractGeoClaims(PROMPT);
    expect(unitIdMap.get(3)).toBe("Bad-Realm-US");
    expect(claims.map((c) => c.kind)).toEqual([
      "CC_DISTANCE",
      "TRAINED",
      "STAYED_OR_KITED",
    ]);
    const cc = claims[0];
    expect(cc.targetName).toBe("1(HPaladin)");
    expect(cc.unitName).toBe("3(SRogue)");
    expect(cc.distanceYards).toBe(10);
  });
});

describe("G4 endpoint identity (2026-09-26, audits 483f / eb80)", () => {
  it("a STAYED span with a switched nearest enemy yields start on X, end on Y, and X's own end distance", () => {
    const { claims } = extractGeoClaims(
      "    0:55–1:05 [High burst] 10→2.1yd from Bad-Realm-US→Buddy-Realm-US (Bad-Realm-US 22.7yd at the end) — you were the burst target",
    );
    expect(
      claims.map((c) => [c.endpoint, c.unitName, c.atSeconds, c.distanceYards]),
    ).toEqual([
      ["start", "Bad-Realm-US", 55, 10],
      ["end", "Buddy-Realm-US", 65, 2.1],
      ["end-own", "Bad-Realm-US", 65, 22.7],
      // G4d (FT-T12 D2): the span's identity claim — whom the two ends name
      [undefined, "Bad-Realm-US", 55, 0],
    ]);
    expect(claims.map((c) => c.kind)).toEqual([
      "STAYED_OR_KITED",
      "STAYED_OR_KITED",
      "STAYED_OR_KITED",
      "MEASURED_ENEMY",
    ]);
    expect(claims[3]).toMatchObject({
      toSeconds: 65,
      endUnitName: "Buddy-Realm-US",
    });
  });

  it("a wrong 'X Dyd at the end' is caught (codex review: 22.7 → 999 used to pass)", () => {
    const bad = extractGeoClaims(
      "    0:55–1:05 [High burst] 10→10yd from Bad-Realm-US→Bad-Realm-US (Bad-Realm-US 999yd at the end)",
    ).claims;
    expect(checkGeoClaims(bad, ctx).violations.map((v) => v.code)).toEqual([
      "G4_END_DISTANCE",
    ]);
  });

  it("a name with parentheses parses (realm Aggra(Português)) and keeps its peak claim", () => {
    const { claims } = extractGeoClaims(
      "    0:17 [Low burst] opened 10.5→20.8yd from Duibz-Aggra(Português)-EU (peak at 0:25, from Kámí-Stormscale-EU) — burst targeted X",
    );
    expect(claims.map((c) => [c.endpoint, c.unitName])).toEqual([
      ["start", "Duibz-Aggra(Português)-EU"],
      ["peak", "Kámí-Stormscale-EU"],
    ]);
  });

  it("a KITED line's B is checked at its peak, against the peak's enemy", () => {
    const { claims } = extractGeoClaims(
      "    0:55 [High burst] opened 4→18yd from Bad-Realm-US (peak at 0:59, from Buddy-Realm-US)",
    );
    expect(
      claims.map((c) => [c.endpoint, c.unitName, c.atSeconds, c.distanceYards]),
    ).toEqual([
      ["start", "Bad-Realm-US", 55, 4],
      ["peak", "Buddy-Realm-US", 59, 18],
    ]);
  });

  it("a wrong end distance is a G4_END_DISTANCE violation (static units)", () => {
    const ok = extractGeoClaims(
      "    0:55–1:05 [High burst] 10→10yd from Bad-Realm-US",
    ).claims;
    expect(checkGeoClaims(ok, ctx).violations).toEqual([]);
    const bad = extractGeoClaims(
      "    0:55–1:05 [High burst] 10→25yd from Bad-Realm-US",
    ).claims;
    expect(checkGeoClaims(bad, ctx).violations.map((v) => v.code)).toEqual([
      "G4_END_DISTANCE",
    ]);
  });
});

describe("G4 on a moving unit with a fractional sampling instant", () => {
  // The enemy walks away 10 yd/s along x from t = 60 s. Analysis samples the
  // end ON the render grid (1:05 → 65.0 s, 60 yd) — the value the line shows
  // is the rendered second's own (codex review: a raw 65.9 s sample relied on
  // the 2 s slack, which also admits 40 yd).
  const walker: any = {
    name: "Runner-Realm-US",
    advancedActions: Array.from({ length: 121 }, (_, i) => i * 1_000).map(
      (dt) => ({
        timestamp: START + dt,
        advancedActorCurrentHp: 100,
        advancedActorMaxHp: 100,
        advancedActorPositionX: dt < 60_000 ? 10 : 10 + (dt - 60_000) / 100,
        advancedActorPositionY: 0,
        advanced: true,
        advancedActorPowers: [],
      }),
    ),
  };
  const mctx = { ...ctx, enemies: [walker] };
  it("the rendered second's own distance passes", () => {
    const c = extractGeoClaims(
      "    0:55–1:05 [High burst] 10→60yd from Runner-Realm-US",
    ).claims;
    expect(checkGeoClaims(c, mctx).violations).toEqual([]);
  });
  it("…and still rejects a value no instant near the rendered second supports", () => {
    const c = extractGeoClaims(
      "    0:55–1:05 [High burst] 10→20yd from Runner-Realm-US",
    ).claims;
    expect(checkGeoClaims(c, mctx).violations.map((v) => v.code)).toEqual([
      "G4_END_DISTANCE",
    ]);
  });
});

describe("checkGeoClaims on static fixture", () => {
  it("true claims pass with 0 violations", () => {
    const { claims } = extractGeoClaims(PROMPT);
    const r = checkGeoClaims(claims, ctx);
    expect(r.checked).toBeGreaterThan(0);
    // The TRAINED definition violation (10yd > 8yd) is one expected hit — swap
    // it out for a compliant distance to verify the rest
    const defViolations = r.violations.filter(
      (v) => v.code !== "G2_TRAINED_DEFINITION",
    );
    expect(defViolations).toEqual([]);
  });

  it("distance mutation (+15yd) is detected on every claim kind (静止单位无逃逸)", () => {
    const { claims } = extractGeoClaims(PROMPT);
    for (const c of claims) {
      const r = checkGeoClaims(
        [{ ...c, distanceYards: c.distanceYards + 15 }],
        ctx,
      );
      expect(r.checked, c.kind).toBe(1);
      expect(r.violations.length, c.kind).toBeGreaterThan(0);
    }
  });

  it("wrong-unit mutation is detected (CC caster swapped to a friend 5yd away)", () => {
    const { claims } = extractGeoClaims(PROMPT);
    const cc = claims.find((c) => c.kind === "CC_DISTANCE")!;
    // Swap the caster for the teammate at (0,5) → caster→target distance is 5yd,
    // not the claimed 10yd
    const r = checkGeoClaims([{ ...cc, unitName: "2(AWarrior)" }], ctx);
    expect(r.violations.length).toBeGreaterThan(0);
  });

  it("impossible CC distance (>50yd) flags G6", () => {
    const far = staticUnit("Far-Realm-US", 60, 0, START);
    const farCtx = {
      ...ctx,
      enemies: [far],
      unitIdMap: new Map([
        [1, "Me-Realm-US"],
        [3, "Far-Realm-US"],
      ]),
    };
    const prompt =
      "0:30  [CC ON TEAM]   1(HPaladin) ← Freezing Trap (by 3(BMHunter)) | 4s [DR: Stun Full] | 60.0yd from caster";
    const { claims } = extractGeoClaims(prompt);
    const r = checkGeoClaims(claims, farCtx);
    expect(r.violations.some((v) => v.code === "G6_IMPOSSIBLE_CC")).toBe(true);
  });

  // G6's ceiling = the producing side's suppression threshold in
  // ccTrinketAnalysis, CC_MAX_PLAUSIBLE_RANGE_YARDS. The gate used to hardcode
  // 50 privately while the producing side nulls out any distance above 45, so no
  // real claim in the (45, 50] band could ever trigger G6 — the first case below
  // lands in exactly that band and was green before the tightening.
  it("CC 距离刚过产出侧可信上限即 G6(真距离一致也不放行)", () => {
    const justOver = 1 + CC_MAX_PLAUSIBLE_RANGE_YARDS;
    const far = staticUnit("Far-Realm-US", justOver, 0, START);
    const farCtx = {
      ...ctx,
      enemies: [far],
      unitIdMap: new Map([
        [1, "Me-Realm-US"],
        [3, "Far-Realm-US"],
      ]),
    };
    const prompt = `0:30  [CC ON TEAM]   1(HPaladin) ← Freezing Trap (by 3(BMHunter)) | 4s [DR: Stun Full] | ${justOver.toFixed(1)}yd from caster`;
    const r = checkGeoClaims(extractGeoClaims(prompt).claims, farCtx);
    // The recomputed distance matches the claim → G1 must stay quiet; only G6
    // may fire.
    expect(r.violations.map((v) => v.code)).toEqual(["G6_IMPOSSIBLE_CC"]);
  });

  it("CC 距离正好等于上限时不算违规(边界含等号,与产出侧 <= 一致)", () => {
    const atCap = CC_MAX_PLAUSIBLE_RANGE_YARDS;
    const far = staticUnit("Far-Realm-US", atCap, 0, START);
    const farCtx = {
      ...ctx,
      enemies: [far],
      unitIdMap: new Map([
        [1, "Me-Realm-US"],
        [3, "Far-Realm-US"],
      ]),
    };
    const prompt = `0:30  [CC ON TEAM]   1(HPaladin) ← Freezing Trap (by 3(BMHunter)) | 4s [DR: Stun Full] | ${atCap.toFixed(1)}yd from caster`;
    const r = checkGeoClaims(extractGeoClaims(prompt).claims, farCtx);
    expect(r.violations).toEqual([]);
  });

  it("LoS-break claim on a zone without obstacle data flags G5_NO_GEOMETRY", () => {
    const prompt =
      "0:07  [HEALER EXPOSURE]   Moderate burst — trinket ready — ⚠ Exposed — LoS break ~12.3yd away (pillar-blocks Bad-Realm-US) | …";
    const { claims } = extractGeoClaims(prompt);
    expect(claims).toHaveLength(1);
    const r = checkGeoClaims(claims, { ...ctx, zoneId: "999999" });
    expect(r.violations.some((v) => v.code === "G5_NO_GEOMETRY")).toBe(true);
  });
});

describe("CC_DISTANCE checks the rendered second only (ccDistanceClaimWindowS)", () => {
  // The caster stands 30yd away until 29.5s, then 10yd away: the CC at 0:30
  // was cast from 10yd. The old ±2s window spanned 10–30yd and let a claim of
  // 25yd through; the producer's instant lies in [30, 31) only.
  const moving: any = {
    name: "Bad-Realm-US",
    advancedActions: Array.from({ length: 121 }, (_, i) => i * 500).map(
      (dt) => ({
        timestamp: START + dt,
        advancedActorCurrentHp: 100,
        advancedActorMaxHp: 100,
        advancedActorPositionX: dt < 29_500 ? 30 : 10,
        advancedActorPositionY: 0,
        advanced: true,
        advancedActorPowers: [],
      }),
    ),
  };
  const movingCtx = { ...ctx, enemies: [moving] };
  const line = (yd: string) =>
    [
      '  <unit id="1" name="Me-Realm-US" spec="Holy Paladin" role="log owner">',
      '  <unit id="3" name="Bad-Realm-US" spec="Subtlety Rogue" role="enemy">',
      `0:30  [CC ON TEAM]   1(HPaladin) ← Cheap Shot (by 3(SRogue)) | 4s [DR: Stun Full] | ${yd}yd from caster`,
    ].join("\n");

  it("the true distance at the rendered second passes", () => {
    const r = checkGeoClaims(extractGeoClaims(line("10.0")).claims, movingCtx);
    expect(r.checked).toBe(1);
    expect(r.violations).toHaveLength(0);
  });

  it("a distance only true two seconds earlier is a violation", () => {
    const r = checkGeoClaims(extractGeoClaims(line("25.0")).claims, movingCtx);
    expect(r.violations.map((v) => v.code)).toEqual(["G1_DISTANCE_MISMATCH"]);
  });
});

describe("G4c TOP_DAMAGER — STAYED 'most damage to you in the span' (B24b)", () => {
  const dmg = (s: number, srcUnitId: string, amount: number) => ({
    logLine: { timestamp: START + s * 1000 },
    srcUnitId,
    effectiveAmount: -amount,
  });
  const healer = { ...staticUnit("Heal-Realm-US", 3, 0, START), id: "e-heal" };
  const mage = { ...staticUnit("Mage-Realm-US", 30, 0, START), id: "e-mage" };
  const hunter = { ...staticUnit("Hunt-Realm-US", 30, 5, START), id: "e-hunt" };
  const me = {
    ...owner,
    id: "me",
    damageIn: [
      dmg(81, "e-heal", 8_000),
      dmg(83, "e-mage", 600_000),
      dmg(91.9, "e-mage", 495_000),
      dmg(85, "e-hunt-pet", 400_000),
      dmg(86, "e-hunt", 376_000),
      // outside the rendered span
      dmg(92, "e-hunt", 900_000),
    ],
  };
  const tctx = {
    ...ctx,
    owner: me,
    friends: [me],
    enemies: [healer, mage, hunter],
    units: [me, healer, mage, hunter, { id: "e-hunt-pet", ownerId: "e-hunt" }],
  } as any;
  const line = (name: string, k: number) =>
    `    1:21–1:31 [High burst] 3→3yd from Heal-Realm-US — your HP 91%→33% (min over window) (near-death — the stay was costly) — most damage to you in the span: ${name} (${k}k) — a defensive CD was available`;
  const top = (name: string, k: number) =>
    extractGeoClaims(line(name, k)).claims.filter(
      (c) => c.kind === "TOP_DAMAGER",
    );

  it("extracts the claim with the span's two rendered seconds", () => {
    const [c] = top("Mage-Realm-US", 1095);
    expect(c).toMatchObject({
      kind: "TOP_DAMAGER",
      atSeconds: 81,
      toSeconds: 91,
      unitName: "Mage-Realm-US",
      amountK: 1095,
    });
  });

  it("passes for the producer's own answer", () => {
    const r = checkGeoClaims(top("Mage-Realm-US", 1095), tctx);
    expect(r.checked).toBe(1);
    expect(r.violations).toEqual([]);
  });

  it("catches the wrong player (the nearest enemy, the healer) and a wrong amount", () => {
    expect(
      checkGeoClaims(top("Heal-Realm-US", 8), tctx).violations.map(
        (v) => v.code,
      ),
    ).toEqual(["G4_TOP_DAMAGER"]);
    expect(
      checkGeoClaims(top("Mage-Realm-US", 1110), tctx).violations.map(
        (v) => v.code,
      ),
    ).toEqual(["G4_TOP_DAMAGER"]);
  });

  it("credits a pet to its owner only when the units are passed — the scan passes them", () => {
    // pet 400k + hunter 376k = 776k < mage 1095k: still the mage; with the
    // mage's hits removed the hunter leads only through the pet
    const noMage = {
      ...tctx,
      owner: {
        ...me,
        damageIn: me.damageIn.filter(
          (d: { srcUnitId: string }) => d.srcUnitId !== "e-mage",
        ),
      },
    };
    expect(
      checkGeoClaims(top("Hunt-Realm-US", 776), noMage).violations,
    ).toEqual([]);
  });

  it("the mutation harness perturbs the amount and is detected", () => {
    const m = mutationDetectionRate(top("Mage-Realm-US", 1095), tctx);
    expect(m.byKind["TOP_DAMAGER"]).toEqual({ mutated: 1, detected: 1 });
  });
});

describe("G4d MEASURED_ENEMY — a STAYED span is measured to the enemy that hit the owner most (FT-T12 D2)", () => {
  const dmg = (s: number, srcUnitId: string, amount: number) => ({
    logLine: { timestamp: START + s * 1000 },
    srcUnitId,
    effectiveAmount: -amount,
  });
  // the healer is nearest (3 yd); the mage is in close range (8 yd) and hits
  const healer = { ...staticUnit("Heal-Realm-US", 3, 0, START), id: "e-heal" };
  const mage = { ...staticUnit("Mage-Realm-US", 8, 0, START), id: "e-mage" };
  const hits = [dmg(81, "e-heal", 8_000), dmg(83, "e-mage", 600_000)];
  const mk = (damageIn: unknown[], enemies: any[] = [healer, mage]) => {
    const me = { ...owner, id: "me", damageIn };
    return {
      ...ctx,
      owner: me,
      friends: [me],
      enemies,
      units: [me, ...enemies],
    } as any;
  };
  const measuredLine =
    "    1:21–1:31 [High burst] 8→8yd from Mage-Realm-US (nearest enemy 3–3yd over the window) — you were the burst target — most damage to you in the span: Mage-Realm-US (600k)";
  const nearestLine =
    "    1:21–1:31 [High burst] 3→3yd from Heal-Realm-US — you were the burst target";
  const codes = (line: string, c: any) =>
    checkGeoClaims(extractGeoClaims(line).claims, c).violations.map(
      (v) => v.code,
    );
  const identity = (line: string) =>
    extractGeoClaims(line).claims.filter((c) => c.kind === "MEASURED_ENEMY");

  it("extracts one identity claim per STAYED span line, none for a bare-time or KITED line", () => {
    expect(identity(measuredLine)).toEqual([
      expect.objectContaining({
        kind: "MEASURED_ENEMY",
        atSeconds: 81,
        toSeconds: 91,
        unitName: "Mage-Realm-US",
      }),
    ]);
    expect(identity("    1:21 [High burst] 8→8yd from Mage-Realm-US")).toEqual(
      [],
    );
    expect(
      identity(
        "    1:21 [High burst] opened 8→20yd from Mage-Realm-US (peak at 1:29)",
      ),
    ).toEqual([]);
  });

  it("passes for the producer's own answer, range clause and all", () => {
    const r = checkGeoClaims(extractGeoClaims(measuredLine).claims, mk(hits));
    expect(r.violations).toEqual([]);
    // start + end distance, the top damager, the measured enemy
    expect(r.checked).toBe(4);
  });

  it("catches the pre-D2 reading: the nearest enemy named while another one hit most", () => {
    expect(codes(nearestLine, mk(hits))).toEqual(["G4_MEASURED_ENEMY"]);
  });

  it("catches the two-enemy form on a span that has a measured enemy", () => {
    expect(
      codes(
        "    1:21–1:31 [High burst] 8→3yd from Mage-Realm-US→Heal-Realm-US (Mage-Realm-US 8yd at the end)",
        mk(hits),
      ),
    ).toEqual(["G4_MEASURED_ENEMY"]);
  });

  it("asserts nothing on the fallback: no enemy damage, a tie, or no distance at an endpoint", () => {
    const count = (c: any) => checkGeoClaims(identity(nearestLine), c).checked;
    expect(codes(nearestLine, mk([]))).toEqual([]);
    expect(count(mk([]))).toBe(0);
    const tie = [dmg(81, "e-heal", 5_000), dmg(83, "e-mage", 5_000)];
    expect(codes(nearestLine, mk(tie))).toEqual([]);
    expect(count(mk(tie))).toBe(0);
    // the mage's position stream ends at 1:24: no distance at the span end
    const goneMage = {
      ...mage,
      advancedActions: mage.advancedActions.filter(
        (a: { timestamp: number }) => a.timestamp <= START + 84_000,
      ),
    };
    expect(codes(nearestLine, mk(hits, [healer, goneMage]))).toEqual([]);
    expect(count(mk(hits, [healer, goneMage]))).toBe(0);
  });

  it("the mutation harness swaps the name for another enemy's and is detected", () => {
    const m = mutationDetectionRate(identity(measuredLine), mk(hits));
    expect(m.byKind["MEASURED_ENEMY"]).toEqual({ mutated: 1, detected: 1 });
    // one enemy on the roster: no other name to swap in, nothing counted
    const solo = mutationDetectionRate(
      identity(measuredLine),
      mk([dmg(83, "e-mage", 600_000)], [mage]),
    );
    expect(solo.byKind["MEASURED_ENEMY"]).toBeUndefined();
  });

  it("round trip: the line the producer renders for this roster passes every G4 check", () => {
    // the producer reads HP through `logLine.timestamp`; the gate's fixture
    // units carry the bare `timestamp` only
    const logged = (u: any) => ({
      ...u,
      advancedActions: u.advancedActions.map((a: { timestamp: number }) => ({
        ...a,
        logLine: { timestamp: a.timestamp },
      })),
    });
    const c = mk(hits, [logged(healer), logged(mage)]);
    c.owner = logged(c.owner);
    c.friends = [c.owner];
    c.units = [c.owner, ...c.enemies];
    const events = computeOwnerPositionEvents({
      owner: c.owner,
      enemies: c.enemies,
      combat: {
        startTime: START,
        endTime: START + 120_000,
        units: Object.fromEntries(c.units.map((u: any) => [u.id, u])),
      } as any,
      burstWindows: [
        {
          fromSeconds: 81,
          toSeconds: 91,
          dangerLabel: "High",
          dampeningPct: 0,
          mostPressuredTarget: { unitName: "Me-Realm-US" },
        },
      ] as any,
      ownerCooldowns: [],
      isHealer: true,
      ownerIsMelee: false,
    });
    const line = formatPositionEventsForContext(events).find((l) =>
      l.includes(" burst] "),
    )!;
    expect(line).toContain("1:21–1:31 [High burst] 8→8yd from Mage-Realm-US ");
    const r = checkGeoClaims(extractGeoClaims(line).claims, c);
    expect(r.violations).toEqual([]);
    expect(extractGeoClaims(line).claims.map((x) => x.kind)).toContain(
      "MEASURED_ENEMY",
    );
  });
});
