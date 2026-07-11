/**
 * 法术 id 列表(spellIdLists.json 的合规替代——原文件为上游 ND 期,不带走)。
 * 来源:暴雪公开游戏事实。子项目 5 管线产物替换。
 */
const spellIdLists = {
  // 大型自保墙(不含外部减伤)
  bigDefensiveSpellIds: [
    "642", "45438", "871", "48792", "104773", "115203", "186265", "196555",
    "31224", "61336", "122470", "108271", "363916", "31850", "86659", "22812",
    "118038", "184364", "19236", "47585", "498",
  ],
  // 外部减伤(施加给队友的保命技)
  externalDefensiveSpellIds: [
    "33206", // Pain Suppression
    "47788", // Guardian Spirit
    "102342", // Ironbark
    "6940", // Blessing of Sacrifice
    "1022", // Blessing of Protection
    "204018", // Blessing of Spellwarding
    "116849", // Life Cocoon
    "62618", // Power Word: Barrier
    "98008", // Spirit Link Totem
    "97462", // Rallying Cry
    "196718", // Darkness
    "51052", // Anti-Magic Zone
    "357170", // Time Dilation
    "374227", // Zephyr
  ],
  // 外部或大型自保(上表 + 主自保墙)
  externalOrBigDefensiveSpellIds: [
    "33206", "47788", "102342", "6940", "1022", "204018", "116849",
    "62618", "98008", "97462", "196718", "51052", "357170", "374227",
    "642", "45438", "871", "48792", "104773", "115203", "186265",
    "196555", "31224", "61336", "122470", "108271", "363916", "31850", "86659",
    "22812", "5277", "118038", "184364", "19236", "47585", "498", "64843", "740", "200183",
  ],
};
export default spellIdLists;
