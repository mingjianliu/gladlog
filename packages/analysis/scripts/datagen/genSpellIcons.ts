/**
 * genSpellIcons — spellId → 图标基名(zamimg/wow.tools 通用命名,小写无扩展名)。
 *
 * 数据链:SpellMisc.SpellIconFileDataID → ManifestInterfaceData(FileDataID →
 * interface/icons/<name>.blp)。候选集与 genSpellEffects 相同(策展目录 ∪
 * classMetadata ∪ spellIdLists ∪ 天赋 ∪ PvpTalent)——泳道 chip 图标(backlog #9)
 * 覆盖绝大多数玩家施法;缺表项由 SpellIcon 首字母 fallback 兜底。
 *
 * Build 取 datagen-manifest.json(与其余产物同 build),无 manifest 时才拉最新。
 */
import fs from "fs-extra";

import { collectCandidateIds } from "./lib/candidates";
import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchLatestBuild,
  fetchTable,
  parseCsv,
} from "./lib/wagoCsv";

export function mineSpellIcons(
  csv: {
    spellMisc: Record<string, string>[];
    manifestInterfaceData: Record<string, string>[];
  },
  candidates: Set<string>,
): Record<string, string> {
  // FileDataID → 图标基名(只吃 interface/icons/ 下的行,表很大)
  const iconByFileData = new Map<string, string>();
  for (const row of csv.manifestInterfaceData) {
    if (!row.ID) continue;
    // FilePath 用反斜杠(Interface\ICONS\)——统一成正斜杠再比对
    const dir = (row.FilePath ?? "").toLowerCase().replace(/\\/g, "/");
    if (!dir.includes("interface/icons")) continue;
    const base = (row.FileName ?? "").toLowerCase().replace(/\.blp$/, "");
    if (base) iconByFileData.set(row.ID, base);
  }

  const result: Record<string, string> = {};
  for (const row of csv.spellMisc) {
    if (row.DifficultyID !== "0") continue;
    const id = row.SpellID;
    if (!id || !candidates.has(id)) continue;
    const icon = iconByFileData.get(row.SpellIconFileDataID ?? "");
    if (icon) result[id] = icon;
  }
  return result;
}

export async function main(): Promise<void> {
  const manifestPath = new URL(
    "../../src/data/datagen-manifest.json",
    import.meta.url,
  ).pathname;
  let build: string;
  try {
    build = (fs.readJsonSync(manifestPath) as { build: string }).build;
  } catch {
    build = await fetchLatestBuild();
  }
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;

  const spellMiscParsed = parseCsv(
    await fetchTable("SpellMisc", build, cacheDir),
  );
  assertColumns(
    spellMiscParsed.header,
    ["SpellID", "DifficultyID", "SpellIconFileDataID"],
    "SpellMisc",
  );

  const midParsed = parseCsv(
    await fetchTable("ManifestInterfaceData", build, cacheDir),
  );
  assertColumns(
    midParsed.header,
    ["ID", "FilePath", "FileName"],
    "ManifestInterfaceData",
  );

  const pvpTalentParsed = parseCsv(
    await fetchTable("PvpTalent", build, cacheDir),
  );
  const candidates = collectCandidateIds(pvpTalentParsed.rows);

  const icons = mineSpellIcons(
    {
      spellMisc: spellMiscParsed.rows,
      manifestInterfaceData: midParsed.rows,
    },
    candidates,
  );

  const outPath = new URL(
    "../../src/data/spellIconsGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Candidates: ${candidates.size}\n * Mined: ${Object.keys(icons).length}\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `export const SPELL_ICONS_GENERATED: Record<string, string> = ${JSON.stringify(
        icons,
        Object.keys(icons).sort((a, b) => Number(a) - Number(b)),
        2,
      )};\n`,
  );
  console.log(
    `spellIconsGenerated.ts: ${Object.keys(icons).length}/${candidates.size} candidates mined (build ${build})`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("genSpellIcons.ts")) {
  void main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
