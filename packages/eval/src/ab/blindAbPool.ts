/* eslint-disable no-console */
/**
 * blindAbPool.ts
 *
 * Builds the blinded scoring pool for /improve-healer-prompts Phase 2. Takes
 * every ordinal that has a prompt + response in BOTH ab-test/control/ and
 * ab-test/treatment/, and lays each arm out as an opaque, shuffled
 * blind/items/item-NN/{prompt.txt,response.txt}. The judge scores items
 * without knowing which arm (or even which pair) an item belongs to; only
 * abCompareStats.ts reads blind/mapping.json to unblind and compute paired
 * statistics.
 *
 * The MATCHID: header (ordinal-integrity guard from eval-healer-prompts
 * Step 2) is verified against the arm's index and then stripped, so it cannot
 * leak pairing information to the judge.
 *
 * Usage:
 *   npm run -w @wowarenalogs/tools start:blindAbPool
 *   (expects packages/tools/local-batch/healer-eval/ab-test/{control,treatment}/)
 */

import fs from "fs-extra";
import path from "path";

interface IndexEntry {
  ordinal: number;
  file: string;
  matchId: string;
  spec: string;
  result: string;
}

interface MappingItem {
  blindId: string;
  arm: "control" | "treatment";
  ordinal: number;
  matchId: string;
}

async function loadArm(abDir: string, arm: "control" | "treatment") {
  const armDir = path.join(abDir, arm);
  const indexFile = path.join(armDir, "index.json");
  if (!(await fs.pathExists(indexFile))) {
    console.error(`Missing ${indexFile} — run the ${arm} phase first.`);
    process.exit(1);
  }
  const entries = (await fs.readJson(indexFile)) as IndexEntry[];
  const byOrdinal = new Map<
    number,
    { entry: IndexEntry; prompt: string; response: string }
  >();
  for (const entry of entries) {
    const ordinalStr = String(entry.ordinal).padStart(3, "0");
    const promptPath = path.join(armDir, entry.file);
    const responsePath = path.join(armDir, "responses", `${ordinalStr}.txt`);
    if (
      !(await fs.pathExists(promptPath)) ||
      !(await fs.pathExists(responsePath))
    )
      continue;
    const prompt = await fs.readFile(promptPath, "utf8");
    let response = await fs.readFile(responsePath, "utf8");
    const headerMatch = response.match(/^MATCHID:\s*(\S+)\s*\n/);
    if (headerMatch) {
      if (headerMatch[1] !== entry.matchId) {
        console.warn(
          `  ${arm}/${ordinalStr}: MATCHID header (${headerMatch[1]}) != index (${entry.matchId}) — excluded (file-swap?)`,
        );
        continue;
      }
      response = response.slice(headerMatch[0].length).replace(/^\s*\n/, "");
    }
    byOrdinal.set(entry.ordinal, { entry, prompt, response });
  }
  return byOrdinal;
}

export async function buildBlindPool(
  abDir: string,
): Promise<{ items: number; pairs: number }> {
  const blindDir = path.join(abDir, "blind");

  const control = await loadArm(abDir, "control");
  const treatment = await loadArm(abDir, "treatment");
  const shared = [...control.keys()]
    .filter((ordinal) => treatment.has(ordinal))
    .sort((a, b) => a - b);
  if (shared.length === 0) {
    console.error("No ordinals present in both arms.");
    process.exit(1);
  }

  const items: { mapping: MappingItem; prompt: string; response: string }[] =
    [];
  for (const ordinal of shared) {
    for (const arm of ["control", "treatment"] as const) {
      const source =
        arm === "control" ? control.get(ordinal) : treatment.get(ordinal);
      if (!source) continue;
      items.push({
        mapping: { blindId: "", arm, ordinal, matchId: source.entry.matchId },
        prompt: source.prompt,
        response: source.response,
      });
    }
  }

  // Fisher–Yates with Math.random: the shuffle order must NOT be reproducible
  // by the orchestrating agent, so no fixed seed here.
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  await fs.remove(blindDir);
  await fs.ensureDir(path.join(blindDir, "scores"));
  const mapping: MappingItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const blindId = `item-${String(i + 1).padStart(2, "0")}`;
    items[i].mapping.blindId = blindId;
    const itemDir = path.join(blindDir, "items", blindId);
    await fs.ensureDir(itemDir);
    await fs.writeFile(
      path.join(itemDir, "prompt.txt"),
      items[i].prompt,
      "utf8",
    );
    await fs.writeFile(
      path.join(itemDir, "response.txt"),
      items[i].response,
      "utf8",
    );
    mapping.push(items[i].mapping);
  }
  await fs.writeJson(
    path.join(blindDir, "mapping.json"),
    { generatedAt: new Date().toISOString(), mapping },
    { spaces: 2 },
  );

  console.log(
    `Blind pool: ${items.length} items (${shared.length} pairs) under ${path.join(blindDir, "items")}`,
  );
  console.log(
    `Mapping (DO NOT read until all scores are written): ${path.join(blindDir, "mapping.json")}`,
  );

  return { items: items.length, pairs: shared.length };
}
