// 来源:暴雪官方 UI 色板与 specialization ID 公开文档;子项目 5 数据管线建成后由生成产物替换

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

export const CLASS_NAMES: Record<number, string> = {
  1: "Warrior",
  2: "Paladin",
  3: "Hunter",
  4: "Rogue",
  5: "Priest",
  6: "Death Knight",
  7: "Shaman",
  8: "Mage",
  9: "Warlock",
  10: "Monk",
  11: "Druid",
  12: "Demon Hunter",
  13: "Evoker",
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

/** 2 字母职业字形(用于回放圆点/图例);classId 见暴雪 class ID。 */
export const CLASS_GLYPH: Record<number, string> = {
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

export function className(classId: number): string {
  return CLASS_NAMES[classId] || "Unknown";
}

export function specName(specId: number): string {
  return SPEC_NAMES[specId] || "";
}

/** specId → wowarenalogs CDN 图标 slug(旧仓 CombatUnitSpec 枚举键小写)。 */
export const SPEC_SLUGS: Record<number, string> = {
  62: "mage_arcane",
  63: "mage_fire",
  64: "mage_frost",
  65: "paladin_holy",
  66: "paladin_protection",
  70: "paladin_retribution",
  71: "warrior_arms",
  72: "warrior_fury",
  73: "warrior_protection",
  102: "druid_balance",
  103: "druid_feral",
  104: "druid_guardian",
  105: "druid_restoration",
  250: "deathknight_blood",
  251: "deathknight_frost",
  252: "deathknight_unholy",
  253: "hunter_beastmastery",
  254: "hunter_marksmanship",
  255: "hunter_survival",
  256: "priest_discipline",
  257: "priest_holy",
  258: "priest_shadow",
  259: "rogue_assassination",
  260: "rogue_outlaw",
  261: "rogue_subtlety",
  262: "shaman_elemental",
  263: "shaman_enhancement",
  264: "shaman_restoration",
  265: "warlock_affliction",
  266: "warlock_demonology",
  267: "warlock_destruction",
  268: "monk_brewmaster",
  269: "monk_windwalker",
  270: "monk_mistweaver",
  577: "demonhunter_havoc",
  581: "demonhunter_vengeance",
  1480: "demonhunter_devourer",
  1467: "evoker_devastation",
  1468: "evoker_preservation",
  1473: "evoker_augmentation",
};

/** spec 图标 URL(与竞技场 minimap 同一 CDN 先例);未知 spec → null(渲染回退字形点)。 */
export function specIconUrl(specId: number): string | null {
  const slug = SPEC_SLUGS[specId];
  return slug ? `https://images.wowarenalogs.com/specs/${slug}.jpg` : null;
}
