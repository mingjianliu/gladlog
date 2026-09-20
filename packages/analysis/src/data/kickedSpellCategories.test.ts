import { describe, expect, it } from "vitest";
import { classifyKickedSpell } from "./kickedSpellCategories";

describe("classifyKickedSpell — GH #79 interrupted spell classification", () => {
  it("classifies major hardcast heals as 'heal'", () => {
    expect(classifyKickedSpell("2061")).toBe("heal"); // Flash Heal
    expect(classifyKickedSpell("77472")).toBe("heal"); // Healing Wave
    expect(classifyKickedSpell("8936")).toBe("heal"); // Regrowth
    expect(classifyKickedSpell("82326")).toBe("heal"); // Holy Light
    expect(classifyKickedSpell("115175")).toBe("heal"); // Soothing Mist
    expect(classifyKickedSpell("1262763")).toBe("heal"); // Benediction
    expect(classifyKickedSpell("421453")).toBe("heal"); // Ultimate Penitence
    expect(classifyKickedSpell("186263")).toBe("heal"); // Shadow Mend
    expect(classifyKickedSpell("740")).toBe("heal"); // Tranquility
    expect(classifyKickedSpell("194509")).toBe("heal"); // Power Word: Radiance
  });

  it("classifies crowd control casts as 'control'", () => {
    expect(classifyKickedSpell("33786")).toBe("control"); // Cyclone
    expect(classifyKickedSpell("118")).toBe("control"); // Polymorph
    expect(classifyKickedSpell("5782")).toBe("control"); // Fear
    expect(classifyKickedSpell("605")).toBe("control"); // Mind Control
    expect(classifyKickedSpell("51514")).toBe("control"); // Hex
    expect(classifyKickedSpell("360806")).toBe("control"); // Sleep Walk
    expect(classifyKickedSpell("113724")).toBe("control"); // Ring of Frost (active id)
    expect(classifyKickedSpell("198898")).toBe("control"); // Song of Chi-Ji
    expect(classifyKickedSpell("410126")).toBe("control"); // Searing Glare
    expect(classifyKickedSpell("305485")).toBe("control"); // Lightning Lasso
    expect(classifyKickedSpell("352278")).toBe("control"); // Ice Wall
  });

  it("classifies offensive casts and nukes as 'damage'", () => {
    expect(classifyKickedSpell("116858")).toBe("damage"); // Chaos Bolt
    expect(classifyKickedSpell("199786")).toBe("damage"); // Glacial Spike
    expect(classifyKickedSpell("116")).toBe("damage"); // Frostbolt
    expect(classifyKickedSpell("51505")).toBe("damage"); // Lava Burst
    expect(classifyKickedSpell("356995")).toBe("damage"); // Disintegrate
    expect(classifyKickedSpell("1259790")).toBe("damage"); // Unstable Affliction
    expect(classifyKickedSpell("198590")).toBe("damage"); // Drain Soul
    expect(classifyKickedSpell("8092")).toBe("damage"); // Mind Blast
    expect(classifyKickedSpell("188196")).toBe("damage"); // Lightning Bolt
    expect(classifyKickedSpell("34914")).toBe("damage"); // Vampiric Touch
    expect(classifyKickedSpell("263165")).toBe("damage"); // Void Torrent
    expect(classifyKickedSpell("30451")).toBe("damage"); // Arcane Blast
  });

  it("classifies utility/dispel as 'other'", () => {
    expect(classifyKickedSpell("32375")).toBe("other"); // Mass Dispel
  });

  it("returns 'unknown' for unrecognized or empty spell ids", () => {
    expect(classifyKickedSpell("nonexistent_id")).toBe("unknown");
    expect(classifyKickedSpell("")).toBe("unknown");
  });
});
