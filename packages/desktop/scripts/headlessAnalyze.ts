/**
 * headlessAnalyze.ts — run the REAL product first-round analysis on library
 * matches without the app (GH #18, 2026-08-30: the review bench needs
 * non-empty product caches, and 3 of 1,095 library matches had any).
 *
 * Same chain the renderer runs, no second implementation:
 *   match.json → pickSource → toLegacySafe → resolveOwner →
 *   extractCandidateFindings(+rawStreams) → buildMatchContext →
 *   createAnalysisService(...).run(input)   // writes analysis-v2.<lang>.json
 * Settings come from the app's own settings.json (backend / model / language),
 * so the cache slot is exactly the one the app shows.
 *
 *   npx tsx packages/desktop/scripts/headlessAnalyze.ts <matchId>[#roundSeq] ...
 *   env: GLADLOG_MATCH_DIR (default = app library), GLADLOG_SETTINGS (default = app settings.json)
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildMatchContext,
  extractCandidateFindings,
  parseRawStreams,
  specToString,
  ensureAnalysisData,
} from "@gladlog/analysis";
import { createAnalysisService } from "../src/main/analysis";
import { resolveOwner } from "../src/renderer/src/report/derive/analysisInput";
import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";

const USER_DATA = join(homedir(), "Library/Application Support/gladlog");
const MATCH_DIR =
  process.env["GLADLOG_MATCH_DIR"] ?? join(USER_DATA, "matches");
const SETTINGS =
  process.env["GLADLOG_SETTINGS"] ?? join(USER_DATA, "settings.json");

function pickSource(doc: any, roundSeq: number | undefined): unknown {
  if (doc.kind === "shuffle") {
    const rounds = doc.data?.rounds ?? [];
    return roundSeq !== undefined ? rounds[roundSeq] : rounds[0];
  }
  return doc.data;
}

async function main() {
  await ensureAnalysisData();
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("usage: headlessAnalyze.ts <matchId>[#roundSeq] ...");
    process.exit(2);
  }
  const settings = JSON.parse(readFileSync(SETTINGS, "utf8"));
  console.log(
    `backend=${settings.aiBackend} model=${JSON.stringify(settings.aiModels)} lang=${settings.aiLanguage} dir=${MATCH_DIR}`,
  );
  const svc = createAnalysisService({
    getSettings: () => settings,
    matchesDir: MATCH_DIR,
    emit: (ch, payload) => {
      const p = payload as any;
      if (ch.includes("error") || p?.error)
        console.log(`  [${ch}]`, JSON.stringify(payload).slice(0, 300));
      else if (ch.includes("done") || ch.includes("complete"))
        console.log(`  [${ch}]`);
    },
  });
  for (const spec of ids) {
    const [matchId, seqStr] = spec.split("#");
    const roundSeq = seqStr !== undefined ? Number(seqStr) : undefined;
    const t0 = Date.now();
    try {
      const doc = JSON.parse(
        readFileSync(join(MATCH_DIR, matchId, "match.json"), "utf8"),
      );
      const source = pickSource(doc, roundSeq);
      if (!source) throw new Error("no source/round");
      const legacy = toLegacySafe(source) as any;
      const owner = resolveOwner(legacy);
      if (!owner) throw new Error("no owner");
      const rawPath = join(MATCH_DIR, matchId, "raw.txt");
      const rawStreams = existsSync(rawPath)
        ? parseRawStreams(
            readFileSync(rawPath, "utf8"),
            legacy.startTime ?? 0,
            ((legacy.endTime ?? 0) - (legacy.startTime ?? 0)) / 1000,
          )
        : undefined;
      const players = Object.values(legacy.units).filter(
        (u: any) => u.info,
      ) as any[];
      const friends = players.filter((u) => u.reaction === owner.reaction);
      const enemies = players.filter((u) => u.reaction !== owner.reaction);
      const candidates = extractCandidateFindings(legacy, owner.id, rawStreams);
      const richContext = buildMatchContext(legacy, friends, enemies, {
        owner,
      });
      console.log(
        `${spec}: owner=${owner.name} spec=${specToString(owner.spec)} candidates=${candidates.length} ctx=${richContext.length}ch — running…`,
      );
      await svc.run({
        matchId,
        candidates,
        richContext,
        spec: specToString(owner.spec),
        rosterSpecs: players.map((u) => String(u.spec)),
      });
      const lang = settings.aiLanguage ?? "zh";
      const cache = join(MATCH_DIR, matchId, `analysis-v2.${lang}.json`);
      let n = "?";
      try {
        const a = JSON.parse(readFileSync(cache, "utf8"));
        const r =
          a.schemaVersion === 2 && a.slots
            ? a.slots[a.lastSlotKey]?.result
            : a.result;
        n = String(r?.findings?.length ?? "none");
      } catch {
        /* cache unreadable → reported as "?" */
      }
      console.log(
        `${spec}: done in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${cache} findings=${n}`,
      );
    } catch (e) {
      console.log(`${spec}: FAILED ${(e as Error).message}`);
    }
  }
}
main();
