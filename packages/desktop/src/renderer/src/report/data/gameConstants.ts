// Source: Blizzard's official UI palette and the public specialization ID docs;
// to be replaced by generated artifacts once the subproject 5 data pipeline is
// in place
import { SPEC_ICONS } from "@gladlog/analysis";

export const CLASS_COLORS: Record<number, string> = {
  1: "#C69B6D",
  2: "#F48CBA",
  3: "#AAD372",
  4: "#FFF468",
  5: "#FFFFFF",
  6: "#C41E3A",
  7: "#0070DD",
  8: "#3FC7EB",
  9: "#8788EE",
  10: "#00FF98",
  11: "#FF7C0A",
  12: "#A330C9",
  13: "#33937F",
};

export const SPEC_NAMES: Record<number, string> = {
  62: "Arcane Mage",
  63: "Fire Mage",
  64: "Frost Mage",
  65: "Holy Paladin",
  66: "Protection Paladin",
  70: "Retribution Paladin",
  71: "Arms Warrior",
  72: "Fury Warrior",
  73: "Protection Warrior",
  102: "Balance Druid",
  103: "Feral Druid",
  104: "Guardian Druid",
  105: "Restoration Druid",
  250: "Blood DK",
  251: "Frost DK",
  252: "Unholy DK",
  253: "Beast Mastery Hunter",
  254: "Marksmanship Hunter",
  255: "Survival Hunter",
  256: "Discipline Priest",
  257: "Holy Priest",
  258: "Shadow Priest",
  259: "Assassination Rogue",
  260: "Outlaw Rogue",
  261: "Subtlety Rogue",
  262: "Elemental Shaman",
  263: "Enhancement Shaman",
  264: "Restoration Shaman",
  265: "Affliction Warlock",
  266: "Demonology Warlock",
  267: "Destruction Warlock",
  268: "Brewmaster Monk",
  269: "Windwalker Monk",
  270: "Mistweaver Monk",
  577: "Havoc DH",
  581: "Vengeance DH",
  1480: "Devourer DH",
  1467: "Devastation Evoker",
  1468: "Preservation Evoker",
  1473: "Augmentation Evoker",
};

export function classColor(classId: number): string {
  return CLASS_COLORS[classId] || "#9d9d9d";
}

/** Two-letter class glyphs (for replay dots / legends); classId is Blizzard's
 * class ID. */
const CLASS_GLYPH: Record<number, string> = {
  1: "WA",
  2: "PA",
  3: "HU",
  4: "RO",
  5: "PR",
  6: "DK",
  7: "SH",
  8: "MG",
  9: "WL",
  10: "MK",
  11: "DR",
  12: "DH",
  13: "EV",
};

export function classGlyph(classId: number): string {
  return CLASS_GLYPH[classId] || "??";
}

export function specName(specId: number): string {
  return SPEC_NAMES[specId] || "";
}

/**
 * specId -> icon base name (resolved from Blizzard's
 * ChrSpecialization.SpellIconFileID, see
 * packages/analysis/scripts/datagen/genSpecIcons.ts).
 *
 * Rendered by <SpellIcon> -- through the main-process iconCache (permanent disk
 * cache + per-session budget), the same path as spell icons. This used to
 * return a direct images.wowarenalogs.com link, a third-party volunteer
 * project's CDN, so the shipped app spent their bandwidth every time it
 * rendered the match list; that link was cut per docs/DATA-COMPLIANCE.md.
 * Unknown spec -> null (the caller falls back to a glyph dot).
 */
export function specIconName(specId: number): string | null {
  return SPEC_ICONS[String(specId)] ?? null;
}
