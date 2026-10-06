import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  STUN_PURGE_GENERATED,
  USABLE_WHILE_CC_GENERATED,
} from "../src/data/usableWhileCcGenerated";
import {
  STUN_PURGE_WITHHELD_IDS,
  USABLE_WHILE_CC_CONDITIONAL,
  USABLE_WHILE_CC_GAP_IDS,
  USABLE_WHILE_CC_SPELL_IDS,
  USABLE_WHILE_STUNNED_BY_PURGE_IDS,
  usableWhileStunned,
} from "../src/utils/cooldowns";

// Task 5 (2026-08-14): USABLE_WHILE_CC_SPELL_IDS stopped being a fully
// hand-written 6-entry list and became a shim: the official generated
// "stunned" table unioned with a hand-written gap layer.
// 2026-09-04 (BACKLOG #41 (8)): the generated table now reads the NAMED bits
// 163 ∪ 378; the gap layer's three ids are covered by 378 and the layer is
// empty; Divine Shield 642 / Icebound Fortitude 48792 were re-ruled NOT
// usable while stunned by the user.
// 2026-10-06 (user ruling U-T1): that re-ruling is reversed — the shim also
// unions the DB2 immunity route (`STUN_PURGE_GENERATED`).
describe("USABLE_WHILE_CC_SPELL_IDS shim", () => {
  it("is a superset of the generated stunned table (union semantics)", () => {
    for (const id of USABLE_WHILE_CC_GENERATED.stunned) {
      expect(USABLE_WHILE_CC_SPELL_IDS.has(id), id).toBe(true);
    }
  });

  it("Divine Protection 498/403876 and Thunderstorm 51490 — the former hand gap layer — now come from the generated table (named bit 378), and the gap layer is empty", () => {
    for (const id of ["498", "403876", "51490"]) {
      expect(USABLE_WHILE_CC_GENERATED.stunned.has(id), id).toBe(true);
      expect(USABLE_WHILE_CC_SPELL_IDS.has(id), id).toBe(true);
    }
    expect(USABLE_WHILE_CC_GAP_IDS.size).toBe(0);
  });

  // Old hand-written 6-entry list: three carry the named bit and stay in.
  it.each([
    ["33206", "Pain Suppression"],
    ["22812", "Barkskin"],
    ["47585", "Dispersion"],
  ])("keeps old member %s (%s) usable while stunned", (id) => {
    expect(USABLE_WHILE_CC_GENERATED.stunned.has(id), id).toBe(true);
    expect(USABLE_WHILE_CC_SPELL_IDS.has(id), id).toBe(true);
  });

  // User ruling U-T1 (2026-10-06) reverses the 2026-09-04 re-ruling ("no named
  // bit, 1 / 0 casts-in-stun"): these come through the IMMUNITY route — DB2
  // "Immunity Purges Effect" + an own immunity that covers the stun — and the
  // old count was a strict-inside test that a purge can never satisfy (the
  // stun is REMOVED just before the cast line). 605 S2 files: 99 of 417
  // Divine Shield casts, 42 of 343 Ice Blocks, 108 of 247 Icebound Fortitudes
  // ended a stun on their caster.
  it.each([
    ["642", "Divine Shield"],
    ["45438", "Ice Block"],
    ["48792", "Icebound Fortitude"],
  ])("%s (%s) is usable while stunned through the immunity route, not a named bit", (id) => {
    expect(USABLE_WHILE_CC_GENERATED.stunned.has(id), id).toBe(false);
    expect(STUN_PURGE_GENERATED[id], id).toBeDefined();
    expect(USABLE_WHILE_STUNNED_BY_PURGE_IDS.has(id), id).toBe(true);
    expect(USABLE_WHILE_CC_SPELL_IDS.has(id), id).toBe(true);
    expect(usableWhileStunned(id), id).toBe(true);
  });

  // User ruling U-T1b (2026-10-06): Blink and the imp's Flee sit on the same
  // DB2 route as Icebound Fortitude and are NOT taken — only the four named.
  it.each([
    ["1953", "Blink"],
    ["119415", "Blink"],
    ["89792", "Flee"],
  ])("%s (%s) is withheld by ruling: not usable while stunned", (id) => {
    expect(STUN_PURGE_WITHHELD_IDS.has(id), id).toBe(true);
    expect(USABLE_WHILE_STUNNED_BY_PURGE_IDS.has(id), id).toBe(false);
    expect(USABLE_WHILE_CC_SPELL_IDS.has(id), id).toBe(false);
    expect(usableWhileStunned(id), id).toBe(false);
  });

  // The route's negative controls: an immunity or a wall WITHOUT the purge
  // attribute (0 of 46 / 499 / 224 / 304 own casts ended a stun).
  it.each([
    ["204018", "Blessing of Spellwarding"],
    ["31224", "Cloak of Shadows"],
    ["186265", "Aspect of the Turtle"],
    ["108271", "Astral Shift"],
  ])("%s (%s) is not on the immunity route", (id) => {
    expect(STUN_PURGE_GENERATED[id], id).toBeUndefined();
    expect(USABLE_WHILE_CC_SPELL_IDS.has(id), id).toBe(false);
    expect(usableWhileStunned(id, undefined, ["1833"]), id).toBe(false);
  });

  // User ruling 2026-08-14: 55233 Vampiric Blood is NOT usable while stunned
  // ("都不行"), and the corpus shows 0 casts-in-stun. The old hand list
  // wrongly included it; the shim must NOT carry that error forward.
  it("does NOT carry forward Vampiric Blood 55233 (user-ruled correction, 2026-08-14)", () => {
    expect(USABLE_WHILE_CC_GENERATED.stunned.has("55233")).toBe(false);
    expect(USABLE_WHILE_CC_SPELL_IDS.has("55233")).toBe(false);
  });
});

describe("Blessing of Protection: a school-limited purge, on oneself (ruling U-T1)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  const BOP = "1022";
  const CHEAP_SHOT = "1833"; // physical
  const KIDNEY_SHOT = "408"; // physical
  const HAMMER_OF_JUSTICE = "853"; // holy

  it("is on the route with the physical mask only, and outside the every-stun set", () => {
    expect(STUN_PURGE_GENERATED[BOP]).toEqual({ schoolMask: 1, stunMechanic: false });
    expect(USABLE_WHILE_STUNNED_BY_PURGE_IDS.has(BOP)).toBe(false);
    expect(USABLE_WHILE_CC_SPELL_IDS.has(BOP)).toBe(false);
  });

  it("no stun named (the caller cannot say the press is on the stunned unit itself) → not usable", () => {
    expect(usableWhileStunned(BOP)).toBe(false);
    expect(usableWhileStunned(BOP, new Set(), [])).toBe(false);
  });

  it("usable under physical stuns — 13 of 13 purged stuns in the corpus were physical", () => {
    expect(usableWhileStunned(BOP, undefined, [CHEAP_SHOT])).toBe(true);
    expect(usableWhileStunned(BOP, undefined, [CHEAP_SHOT, KIDNEY_SHOT])).toBe(true);
  });

  it("not under a magic stun, a mix, or a stun whose school is unknown", () => {
    expect(usableWhileStunned(BOP, undefined, [HAMMER_OF_JUSTICE])).toBe(false);
    expect(usableWhileStunned(BOP, undefined, [CHEAP_SHOT, HAMMER_OF_JUSTICE])).toBe(false);
    expect(usableWhileStunned(BOP, undefined, ["999999999"])).toBe(false);
  });
});

describe("usableWhileStunned", () => {
  it("returns true for an unconditional (generated) member, no talent context needed", () => {
    expect(usableWhileStunned("33206")).toBe(true);
  });

  it("returns true for Divine Protection 498 (named bit 378), no talent context needed", () => {
    expect(usableWhileStunned("498")).toBe(true);
  });

  it("returns false for a spell in neither the unconditional set nor the conditional layer", () => {
    expect(usableWhileStunned("55233")).toBe(false);
    expect(usableWhileStunned("55233", new Set(["119996"]))).toBe(false);
  });

  it("returns true for Thunderstorm 51490 (named bit 378), no talent context needed", () => {
    expect(usableWhileStunned("51490")).toBe(true);
  });

  // Task 6 (2026-08-14, user-signed): 119996 (转世:转移 Transcendence: Transfer)
  // is the first real occupant of the conditional layer, gated on the
  // Mistweaver PvP talent Eminence (353584). 51490 was the other Task-5
  // placeholder candidate but research found it has no gating talent (it
  // moved to the unconditional gap layer instead, tested above) — so the
  // conditional layer is no longer empty, but still has exactly one member.
  it("conditional layer has exactly the signed 119996 entry", () => {
    expect(Object.keys(USABLE_WHILE_CC_CONDITIONAL)).toEqual(["119996"]);
    expect(USABLE_WHILE_CC_CONDITIONAL["119996"].requiresTalent).toBe("353584");
  });

  it("conditional-layer hit without talent context is conservative (false)", () => {
    expect(usableWhileStunned("119996")).toBe(false);
    expect(usableWhileStunned("119996", new Set())).toBe(false);
  });

  it("conditional-layer hit with a different talent (not the gating one) is still false", () => {
    expect(usableWhileStunned("119996", new Set(["999999"]))).toBe(false);
  });

  it("conditional-layer hit WITH the gating talent (Eminence 353584) is true", () => {
    expect(usableWhileStunned("119996", new Set(["353584"]))).toBe(true);
  });
});
