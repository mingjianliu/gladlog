import {
  buildFindingsPrompt,
  buildMatchContext,
  ensureAnalysisData,
  extractCandidateFindings,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import { CANDIDATE_TYPE_FLAGS } from "@gladlog/analysis/src/data/candidateTypeFlags";
import { GladLogParser } from "@gladlog/parser";
import {
  CombatUnitReaction,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import fs from "fs-extra";
import path from "path";

import { buildCoverageManifest } from "../quality/coverageManifest";

export interface IndexEntry {
  ordinal: number;
  file: string;
  matchId: string;
  spec: string;
  result: string;
  /** Name of the prompt's protagonist unit — the verification gates restore the
   * viewpoint from it (absent = old corpus, where the gates fall back to the
   * friendly healer). */
  ownerName?: string;
}

export async function buildCorpus(opts: {
  logPaths: string[];
  outDir: string;
  /** healer = the friendly healer; dps = the friendly non-healer with the
   * highest total damage (the D2 degraded verification corpus: the log recorder
   * is not that DPS, but every deterministic analysis is viewpoint-independent
   * and only [YOU]'s intentionality is one notch weaker); recorder = the log
   * recorder themselves (same semantics as the product's
   * StructuredAnalysisPanel — use this for a true DPS-viewpoint corpus). */
  ownerFilter?: "healer" | "dps" | "recorder";
}): Promise<{ entries: IndexEntry[]; fingerprint: string }> {
  const { logPaths, outDir, ownerFilter } = opts;
  // The spell-name / talent tables load in the background and the prompt must
  // never degrade — they have to be ready before any prompt is built (contract
  // in analysis' data/ensure.ts).
  await ensureAnalysisData();
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
        } else if (ownerFilter === "recorder") {
          owner = players.find((u) => u.id === combat.playerId);
          if (!owner) continue;
        } else if (ownerFilter === "dps") {
          // The friendly non-healer with the highest total damage
          // (deterministic; ties go to the first one iterated)
          let best: any = null;
          let bestDmg = -1;
          for (const u of players) {
            if (u.reaction !== CombatUnitReaction.Friendly) continue;
            if (isHealerSpec(u.spec)) continue;
            const dmg = (u.damageOut ?? []).reduce(
              (sum: number, e: any) => sum + Math.abs(e.effectiveAmount ?? 0),
              0,
            );
            if (dmg > bestDmg) {
              bestDmg = dmg;
              best = u;
            }
          }
          owner = best;
          if (!owner) continue;
        } else {
          // Default: use first player
          owner = players[0];
          if (!owner) continue;
        }

        // Separate friends and enemies
        const friends = players.filter((u) => u.reaction === owner.reaction);
        const enemies = players.filter((u) => u.reaction !== owner.reaction);

        // Build prompt (the timeline variant is the default, matching
        // production; GLADLOG_TIMELINE_PROMPT=0 falls back to the sparse variant
        // for a control arm)
        const richContext = buildMatchContext(combat, friends, enemies, {
          owner,
        });
        // GLADLOG_CORPUS_PROMPT=findings renders the PRODUCTION single-shot
        // prompt (candidate menu + legend + rich context, exactly what
        // desktop/main/analysis.ts sends) instead of the bare context. Needed
        // for any A/B whose change lives in the candidate menu — with the bare
        // context both arms are byte-identical and eval-ab correctly aborts
        // (2026-08-30: five candidate-menu A/Bs hit exactly that).
        // GLADLOG_CANDIDATE_FLAGS_OFF=backlashDispel,kickPriority builds a
        // control arm on the SAME code with the named CANDIDATE_TYPE_FLAGS
        // forced false (the harness precedent: flags are flipped by direct
        // assignment). Same commit both arms → the only prompt delta is the
        // candidate lines the flags gate, which is exactly the A/B question.
        for (const key of (process.env.GLADLOG_CANDIDATE_FLAGS_OFF ?? "")
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean)) {
          if (key in CANDIDATE_TYPE_FLAGS)
            (CANDIDATE_TYPE_FLAGS as Record<string, boolean>)[key] = false;
          else throw new Error(`GLADLOG_CANDIDATE_FLAGS_OFF: unknown flag ${key}`);
        }
        const prompt =
          process.env.GLADLOG_CORPUS_PROMPT === "findings"
            ? buildFindingsPrompt(
                extractCandidateFindings(combat, owner.id),
                richContext,
                specToString(owner.spec) || String(owner.spec),
              )
            : richContext;

        // Write prompt file
        const nnn = String(ordinal).padStart(3, "0");
        const id8 = gladId.slice(0, 8);
        const promptFile = path.join(outDir, "prompts", `${nnn}-${id8}.txt`);
        await fs.writeFile(promptFile, prompt, "utf-8");

        // Write manifest
        const manifest = buildCoverageManifest(combat, gladId);
        const manifestFile = path.join(outDir, "manifests", `${nnn}.json`);
        await fs.writeJson(manifestFile, manifest, { spaces: 2 });

        // result is from the owner's viewpoint (contract of the old ledger /
        // calibration suite: 'Win' | 'Loss' | 'Unknown')
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
          ownerName: owner.name,
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
