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

export function className(classId: number): string {
  return CLASS_NAMES[classId] || "Unknown";
}

export function specName(specId: number): string {
  return SPEC_NAMES[specId] || "";
}
