import { describe, expect, it } from "vitest";

import { getEnglishSpellName } from "../src/data/spellEffectData";

// Real-log regression (public wowarenalogs testlogs, a 2024 zhTW client):
// Unstable Affliction's retired id 316099 is not in the name table, the
// fallback was the log's own name, and [KICK] lines printed `痛苦動盪` (44
// gate failures over three owner views of 13 logs).
describe("getEnglishSpellName — a client-locale fallback is never printed", () => {
  it("an id the table lacks with a CJK log name falls back to the id", () => {
    expect(getEnglishSpellName("316099", "痛苦動盪")).toBe("316099");
    expect(getEnglishSpellName("999999901", "树皮术")).toBe("999999901");
    expect(getEnglishSpellName("999999902", "보호막")).toBe("999999902");
  });
  it("D4 (user 2026-10-24): an accented Latin-script log name falls back to the id too", () => {
    expect(getEnglishSpellName("999999904", "Écorce")).toBe("999999904");
    expect(getEnglishSpellName("999999905", "Rindenhaut ß")).toBe("999999905");
    expect(getEnglishSpellName("999999906", "Protección")).toBe("999999906");
  });
  it("an English log name for an id the table lacks is still used", () => {
    expect(getEnglishSpellName("999999903", "Some New Spell")).toBe(
      "Some New Spell",
    );
  });
  it("a known id reads the table, whatever the log wrote", () => {
    expect(getEnglishSpellName("22812", "树皮术")).toBe("Barkskin");
  });
});
