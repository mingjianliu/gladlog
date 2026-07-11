import fs from "fs-extra";
import path from "path";
import { GladLogParser } from "@gladlog/parser";
import {
  toLegacyMatch,
  toLegacyShuffle,
  CombatUnitReaction,
} from "@gladlog/parser-compat";
import {
  buildMatchContext,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import { buildCoverageManifest } from "../quality/coverageManifest";

export interface IndexEntry {
  ordinal: number;
  file: string;
  matchId: string;
  spec: string;
  result: string;
}

export async function buildCorpus(opts: {
  logPaths: string[];
  outDir: string;
  ownerFilter?: "healer";
}): Promise<{ entries: IndexEntry[]; fingerprint: string }> {
  const { logPaths, outDir, ownerFilter } = opts;
  const entries: IndexEntry[] = [];

  // Ensure output directories
  await fs.ensureDir(path.join(outDir, "prompts"));
  await fs.ensureDir(path.join(outDir, "manifests"));

  let ordinal = 1;

  for (const logPath of logPaths) {
    try {
      const content = await fs.readFile(logPath, "utf-8");
      const parser = new GladLogParser();
      const combats: { gladId: string; combat: any }[] = [];

      parser.on("match", (m: any) =>
        combats.push({ gladId: m.id, combat: toLegacyMatch(m) }),
      );
      parser.on("shuffle", (sh: any) => {
        const legacy = toLegacyShuffle(sh);
        (legacy.rounds ?? []).forEach((round: any, idx: number) =>
          combats.push({
            gladId: sh.rounds[idx]?.id ?? `${sh.rounds[0]?.id}-r${idx}`,
            combat: round,
          }),
        );
      });

      for (const line of content.split("\n")) {
        parser.push(line);
      }
      parser.end();

      // Process each combat
      for (const { gladId, combat } of combats) {
        const units: any[] = Object.values(combat.units);
        const players = units.filter((u) => u.info);

        // Select owner based on filter
        let owner: any = null;
        if (ownerFilter === "healer") {
          owner = players.find(
            (u) =>
              isHealerSpec(u.spec) &&
              u.reaction === CombatUnitReaction.Friendly,
          );
          if (!owner) {
            // Skip this combat if no healer found when ownerFilter is "healer"
            continue;
          }
        } else {
          // Default: use first player
          owner = players[0];
          if (!owner) continue;
        }

        // Separate friends and enemies
        const friends = players.filter((u) => u.reaction === owner.reaction);
        const enemies = players.filter((u) => u.reaction !== owner.reaction);

        // Build prompt(timeline 变体为默认,与产线一致;GLADLOG_TIMELINE_PROMPT=0 可退回稀疏变体做对照臂)
        const prompt = buildMatchContext(combat, friends, enemies, {
          owner,
          useTimelinePrompt: process.env.GLADLOG_TIMELINE_PROMPT !== "0",
        });

        // Write prompt file
        const nnn = String(ordinal).padStart(3, "0");
        const id8 = gladId.slice(0, 8);
        const promptFile = path.join(outDir, "prompts", `${nnn}-${id8}.txt`);
        await fs.writeFile(promptFile, prompt, "utf-8");

        // Write manifest
        const manifest = buildCoverageManifest(combat, gladId);
        const manifestFile = path.join(outDir, "manifests", `${nnn}.json`);
        await fs.writeJson(manifestFile, manifest, { spaces: 2 });

        // result 为 owner 视角(旧台账/校准套件契约:'Win' | 'Loss' | 'Unknown')
        const winningTeamId = combat.winningTeamId;
        const ownerTeamId = owner.info?.teamId;
        const result =
          winningTeamId != null && ownerTeamId != null
            ? String(winningTeamId) === String(ownerTeamId)
              ? "Win"
              : "Loss"
            : "Unknown";

        // Create index entry
        entries.push({
          ordinal,
          file: `prompts/${nnn}-${id8}.txt`,
          matchId: gladId,
          spec: specToString(owner.spec) || String(owner.spec),
          result,
        });

        ordinal++;
      }
    } catch (err) {
      // Log error but continue processing other files
      console.warn(`WARN: ${logPath}: ${err}`);
    }
  }

  // Write index
  const indexFile = path.join(outDir, "index.json");
  await fs.writeJson(indexFile, entries, { spaces: 2 });

  // Compute fingerprint
  let fingerprint: string;
  if (entries.length === 0) {
    fingerprint = "0: ..";
  } else {
    const first = entries[0].matchId.slice(0, 8);
    const last = entries[entries.length - 1].matchId.slice(0, 8);
    fingerprint = `${entries.length}: ${first}..${last}`;
  }

  // Write fingerprint
  const fingerprintFile = path.join(outDir, "fingerprint.txt");
  await fs.writeFile(fingerprintFile, fingerprint + "\n", "utf-8");

  return { entries, fingerprint };
}
