/**
 * fetchSimcHotfixes.ts — pull the live hotfix overlay out of SimulationCraft's
 * generated data (BACKLOG #41 (3), 2026-09-04). See lib/simcHotfix.ts for why
 * wago cannot provide this and how the field mapping was derived.
 *
 * Output: src/data/hotfixOverlayGenerated.json, applied by every generator
 * that derives numbers from SpellEffect (genMitigation, genTalentMitigation,
 * genAbilityEffects, genTalentModifiers) through `applyHotfixOverlay`.
 *
 * Self-verification (the mapping is empirical, so it is re-checked every run):
 * for each mapped field, the share of hotfixes whose OLD value equals the
 * DATAGEN_BUILD CSV value is printed; the run FAILS if PvpMultiplier or
 * EffectBasePointsF fall below 50 % — that means SimC re-ordered its struct
 * and the overlay would patch the wrong column. Rows the CSV lacks (effects
 * newer than DATAGEN_BUILD) are reported, not counted against the rate.
 *
 * Usage:
 *   DATAGEN_BUILD=<build> DATAGEN_CACHE=<dir> [SIMC_BRANCH=<branch>] \
 *     npx tsx packages/analysis/scripts/datagen/fetchSimcHotfixes.ts
 * Branch resolution: SIMC_BRANCH > GitHub API default branch of
 * simulationcraft/simc (the expansion branch, e.g. "midnight"). The two files
 * are cached under DATAGEN_CACHE keyed by the branch's head commit.
 */
import fs from "fs-extra";
import path from "path";

import { writeArtifact } from "./lib/emit";
import {
  buildHotfixOverlay,
  dataDirOf,
  HOTFIX_GUARDED_COLUMNS,
  HOTFIX_OVERLAY_FILE,
  IHotfixOverlay,
  parseClientDataVersion,
  parseSimcSpellData,
  SIMC_EFFECT_FIELD_COLUMNS,
} from "./lib/simcHotfix";
import { fetchTable, parseCsv, resolveBuild } from "./lib/wagoCsv";

const REPO = "simulationcraft/simc";
const FILES = {
  spellData: "engine/dbc/generated/sc_spell_data.inc",
  version: "engine/dbc/generated/client_data_version.inc",
};

async function ghJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

async function resolveBranch(): Promise<{ branch: string; commit: string }> {
  const branch =
    process.env.SIMC_BRANCH ??
    ((await ghJson(`https://api.github.com/repos/${REPO}`))
      .default_branch as string);
  if (!/^[\w.-]+$/.test(branch)) throw new Error(`odd branch name: ${branch}`);
  const head = await ghJson(
    `https://api.github.com/repos/${REPO}/commits/${encodeURIComponent(branch)}`,
  );
  const commit = String(head.sha ?? "");
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error("could not read head sha");
  return { branch, commit };
}

async function fetchRaw(
  branchOrCommit: string,
  file: string,
  cacheDir: string | undefined,
  cacheKey: string,
): Promise<string> {
  const cacheFile = cacheDir ? path.join(cacheDir, cacheKey) : undefined;
  if (cacheFile && fs.existsSync(cacheFile))
    return fs.readFileSync(cacheFile, "utf8");
  const url = `https://raw.githubusercontent.com/${REPO}/${branchOrCommit}/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
  if (cacheFile) {
    fs.ensureDirSync(path.dirname(cacheFile));
    fs.writeFileSync(cacheFile, text, "utf8");
  }
  return text;
}

/** Old-value match rate per mapped field against the DATAGEN_BUILD CSV. */
export function verifyFieldMapping(
  overlayEffects: IHotfixOverlay["effects"],
  hotfixes: { id: number; field: number; old: number }[],
  rows: Record<string, string>[],
): Record<string, { n: number; equal: number; missing: number }> {
  const byId = new Map(rows.map((r) => [r.ID, r]));
  const out: Record<string, { n: number; equal: number; missing: number }> = {};
  for (const h of hotfixes) {
    const col = SIMC_EFFECT_FIELD_COLUMNS[h.field];
    if (!col || !overlayEffects[String(h.id)]) continue;
    const s = (out[col] ??= { n: 0, equal: 0, missing: 0 });
    const row = byId.get(String(h.id));
    if (!row) {
      s.missing++;
      continue;
    }
    s.n++;
    if (Math.abs(Number(row[col]) - h.old) < 1e-4) s.equal++;
  }
  return out;
}

export async function main(): Promise<void> {
  const build = await resolveBuild();
  const cacheDir = process.env.DATAGEN_CACHE;
  const { branch, commit } = await resolveBranch();
  const short = commit.slice(0, 12);
  const [spellDataSrc, versionSrc] = await Promise.all([
    fetchRaw(
      commit,
      FILES.spellData,
      cacheDir,
      `simc-${short}-sc_spell_data.inc`,
    ),
    fetchRaw(
      commit,
      FILES.version,
      cacheDir,
      `simc-${short}-client_data_version.inc`,
    ),
  ]);
  const data = parseSimcSpellData(spellDataSrc);
  const version = parseClientDataVersion(versionSrc);
  if (data.build !== version.build)
    throw new Error(
      `SimC data build ${data.build} != client_data_version ${version.build}`,
    );
  const overlay = buildHotfixOverlay(data, version, {
    branch,
    commit,
    fetchedAt: new Date().toISOString(),
  });

  // Self-verification against the pinned client build.
  const csv = parseCsv(await fetchTable("SpellEffect", build, cacheDir));
  const rates = verifyFieldMapping(
    overlay.effects,
    data.effectHotfixes,
    csv.rows,
  );
  for (const [col, s] of Object.entries(rates))
    console.log(
      `  ${col}: old==csv ${s.equal}/${s.n}${s.missing ? ` (+${s.missing} effects newer than ${build})` : ""}`,
    );
  for (const col of HOTFIX_GUARDED_COLUMNS) {
    const s = rates[col];
    if (s && s.n >= 4 && s.equal / s.n < 0.5)
      throw new Error(
        `SimC field mapping drift: ${col} old-value match ${s.equal}/${s.n} < 50 % — check SIMC_EFFECT_FIELD_COLUMNS against spell_data.hpp`,
      );
  }

  const outPath = path.join(dataDirOf(import.meta.url), HOTFIX_OVERLAY_FILE);
  writeArtifact(outPath, `${JSON.stringify(overlay, null, 2)}\n`);
  const nEff = Object.keys(overlay.effects).length;
  const nSpells = new Set(Object.values(overlay.effects).map((e) => e.spellId))
    .size;
  console.log(
    `hotfixOverlayGenerated: ${nEff} effect hotfixes on ${nSpells} spells, ${overlay.spellHotfixIds.length} spell-flag hotfixes, ${overlay.powerHotfixes.length} power hotfixes — SimC ${branch}@${short}, client ${version.build}, hotfixes ${version.hotfixDate} (${version.hotfixBuild}); verified against wago ${build}`,
  );
}

if (
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1]?.endsWith("fetchSimcHotfixes.ts")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
