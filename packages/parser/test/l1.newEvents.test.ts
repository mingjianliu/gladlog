import { describe, it, expect } from "vitest";

import { parseLine } from "../src/l1/parseLine";
import { splitLine } from "../src/l1/splitTopLevel";
import { decodeAdvanced } from "../src/l1/decoders";

/**
 * The five event classes the product used to discard (BACKLOG #36). Every
 * fixture below is a verbatim line out of the 12.1 archive — the field layouts
 * were pinned by measurement, not by reading documentation, so the tests have
 * to be anchored on real lines too.
 */

// Shadow Priest: powerType 13 = Insanity, 600/15000.
const CAST_INSANITY =
  '8/14/2026 22:10:40.2992  SPELL_CAST_SUCCESS,Player-1329-0A3E3781,"Suzukie-Ravencrest-EU",0x512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,341263,"Shadowy Apparition",0x20,Player-1329-0A3E3781,0000000000000000,780960,780960,340,3266,822,2342,0,54477,13,600,15000,0,2811.54,2285.07,0,5.6179,310';

const MISSED_IMMUNE =
  '8/22/2026 19:15:45.632-7  SPELL_MISSED,Player-3725-0C5316D2,"Nojudge-Jubei\'Thos-US",0x512,0x80000020,Player-3725-0C5316D2,"Nojudge-Jubei\'Thos-US",0x512,0x80000020,118,"Polymorph",0x40,IMMUNE,nil,0,0,nil,ST';

const DAMAGE_SPLIT_BOS =
  '8/22/2026 21:20:28.554-7  DAMAGE_SPLIT,Player-73-09B3C1B0,"Dekestei-BleedingHollow-US",0x548,0x80000000,Player-3685-099E825B,"Elanorwen-Turalyon-US",0x20548,0x80000000,6940,"Blessing of Sacrifice",0x2,Player-3685-099E825B,0000000000000000,779846,1047780,3703,3561,3264,3351,0,0,0,238070,250000,0,1284.92,1671.01,0,3.4845,334,1959,0,-1,4,0,0,0,nil,nil,nil,ST';

const EMPOWER_END =
  '8/23/2026 00:30:04.144-4  SPELL_EMPOWER_END,Player-84-0A9CB15D,"Blackdragon-Mug\'thol-US",0x548,0x80000000,0000000000000000,nil,0x80000000,0x80000000,355936,"Dream Breath",0x8,3';

// Prefix = the ABSORB (Vaelx applied Necrotic Wound to Mordakar); EXTRA = the
// heal that got eaten (Calawen's Prayer of Mending).
const HEAL_ABSORBED =
  '8/21/2026 12:00:00.0000  SPELL_HEAL_ABSORBED,Player-1-VAELX,"Vaelx-Blackmoore-EU",0x548,0x80000000,Player-2-MORDA,"Mordakar-TwistingNether-EU",0x512,0x80000000,356528,"Necrotic Wound",0x20,Player-3-CALAW,"Calawen-TwistingNether-EU",0x512,0x80000000,33110,"Prayer of Mending",0x2,3130,39135';

describe("resource fields in the advanced block (#2)", () => {
  it("reads powerType/current/max, anchored off the x/y pair", () => {
    const adv = decodeAdvanced(splitLine(CAST_INSANITY)!.params, 11);
    expect(adv.powers).toEqual([{ powerType: 13, current: 600, max: 15000 }]);
    // the anchor still resolves the rest of the block correctly
    expect(adv.hp).toBe(780960);
    expect(adv.x).toBeCloseTo(2811.54, 2);
  });

  it("splits pipe-separated multi-power readings", () => {
    const line = CAST_INSANITY.replace(
      ",13,600,15000,",
      ",13|0,600|4200,15000|50000,",
    );
    const adv = decodeAdvanced(splitLine(line)!.params, 11);
    expect(adv.powers).toEqual([
      { powerType: 13, current: 600, max: 15000 },
      { powerType: 0, current: 4200, max: 50000 },
    ]);
  });
});

describe("SPELL_MISSED missType (#3)", () => {
  it("decodes IMMUNE — the class no other event records", () => {
    const parsed = parseLine(MISSED_IMMUNE)!;
    expect(parsed.missed?.missType).toBe("IMMUNE");
    expect(parsed.spell?.spellId).toBe(118);
    expect(parsed.known).toBe(true);
  });
});

describe("DAMAGE_SPLIT (#4)", () => {
  it("parses as a damage event with its own amount", () => {
    const parsed = parseLine(DAMAGE_SPLIT_BOS)!;
    expect(parsed.known).toBe(true);
    expect(parsed.spell?.spellName).toBe("Blessing of Sacrifice");
    expect(parsed.damage?.amount).toBe(1959);
    // src is the PROTECTED ally, dest is whoever soaks the redirect — pinned
    // because routing src into damageOut would invent damage output.
    expect(parsed.base?.srcName).toBe("Dekestei-BleedingHollow-US");
    expect(parsed.base?.destName).toBe("Elanorwen-Turalyon-US");
  });
});

describe("SPELL_EMPOWER_END (#5)", () => {
  it("decodes the release level from the trailing field", () => {
    const parsed = parseLine(EMPOWER_END)!;
    expect(parsed.empowerLevel).toBe(3);
    expect(parsed.spell?.spellName).toBe("Dream Breath");
  });

  it("START has no level", () => {
    const start = EMPOWER_END.replace(
      "SPELL_EMPOWER_END",
      "SPELL_EMPOWER_START",
    );
    expect(parseLine(start)!.empowerLevel).toBeUndefined();
  });
});

describe("SPELL_HEAL_ABSORBED (#7)", () => {
  it("reads the prefix as the ABSORB and the extra block as the heal", () => {
    const ha = parseLine(HEAL_ABSORBED)!.healAbsorbed!;
    expect(ha.absorbCasterName).toBe("Vaelx-Blackmoore-EU");
    expect(ha.absorbSpellName).toBe("Necrotic Wound");
    expect(ha.victimGuid).toBe("Player-2-MORDA");
    expect(ha.healerName).toBe("Calawen-TwistingNether-EU");
    expect(ha.healSpellName).toBe("Prayer of Mending");
    expect(ha.absorbedAmount).toBe(3130);
    expect(ha.totalAmount).toBe(39135);
  });

  it("is no longer swallowed by the _ABSORBED exclusion branch", () => {
    expect(parseLine(HEAL_ABSORBED)!.known).toBe(true);
  });
});

// Falling damage. No spell triple: the advanced block starts right after the
// base units (actor = the victim), and the environment type precedes the
// 10-field damage tail. Layout uniform on all 65 archive lines of a 2,110-file
// slice (39 params, type 11 from the end, src = nil GUID).
const ENV_FALLING =
  '8/22/2026 17:16:02.3598  ENVIRONMENTAL_DAMAGE,0000000000000000,nil,0x80000000,0x80000000,Player-962-057E5E60,"Siberia-Plain-CN",0x511,0x80000000,Player-962-057E5E60,0000000000000000,1057609,1061660,3982,3829,3326,3415,0,0,0,269887,273000,0,1259.63,766.77,0,0.3360,334,Falling,4051,4051,0,1,0,0,0,nil,nil,nil';

describe("ENVIRONMENTAL_DAMAGE (GH #100 field ledger)", () => {
  it("decodes the damage tail after the environment type", () => {
    const r = parseLine(ENV_FALLING)!;
    expect(r.known).toBe(true);
    expect(r.damage).toMatchObject({
      amount: 4051,
      baseAmount: 4051,
      overkill: 0,
      school: 1,
      effectiveAmount: 4051,
    });
    expect(r.spell).toEqual({
      spellId: 0,
      spellName: "Falling",
      spellSchool: 1,
    });
  });

  it("reads the advanced block at 8 — the victim's own sample", () => {
    const r = parseLine(ENV_FALLING)!;
    expect(r.advanced).toMatchObject({
      actorGuid: "Player-962-057E5E60",
      hp: 1057609,
      maxHp: 1061660,
    });
    expect(r.advanced!.x).toBeCloseTo(1259.63, 2);
  });
});
