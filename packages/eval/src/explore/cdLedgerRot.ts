/**
 * Corpus-wide scan for the "cd-ledger-rot" bug class behind Task 7 (B3):
 * a major cooldown's ledger entry says `neverUsed` while the raw log shows
 * the ability actually fired — the same "施法/光环双 id 断链" shape as the
 * rest of this codebase's aura/cast-id splits (see `AURA_ONLY_ACTIVATION_IDS`
 * in `packages/analysis/src/utils/cooldowns.ts` for the confirmed root
 * cause: Renewing Blaze/374348 never emits SPELL_CAST_SUCCESS — it is a
 * reactive proc whose only on-log evidence is a self-applied buff aura under
 * a DIFFERENT id, 374349).
 *
 * Per the shared-predicate rule, the ledger side of the check is
 * `extractMajorCooldowns` itself — the SAME function the analysis/prompt
 * path calls — never a re-derived "was this ever used" judgement. The scan
 * only adds one INDEPENDENT signal extractMajorCooldowns does not currently
 * consume: a self-applied `SPELL_AURA_APPLIED` whose resolved English name
 * matches a `neverUsed` CD's name. A hit here is a spellId not yet covered
 * by `AURA_ONLY_ACTIVATION_IDS` (a residual, logged for the next batch) —
 * once a spellId IS added there, `extractMajorCooldowns` folds the aura
 * evidence into `casts` itself, `neverUsed` flips to false, and the loop
 * below never reaches it (the `if (!cd.neverUsed) continue` guard), so the
 * same scan run also serves as the fix's own before/after measurement.
 */
import {
  extractMajorCooldowns,
  getEnglishSpellName,
  type IMajorCooldownInfo,
} from "@gladlog/analysis";
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { type LegacyRound, splitTeams } from "./storeAccess";

export interface CdLedgerRotHit {
  matchId: string;
  roundSeq?: number;
  unitName: string;
  spellId: string;
  spellName: string;
  auraSpellId: string;
  auraTimeSeconds: number;
}

/**
 * Independent evidence check: a self-applied (caster === target === unit)
 * SPELL_AURA_APPLIED whose resolved English name matches `cd.spellName`.
 * Self-applied only — an aura another unit put on this one (e.g. an
 * external heal-over-time) is not evidence THIS unit activated anything.
 *
 * Exported (only) so `explore.cdLedgerRot.test.ts` can pin the self-cast
 * filter directly, without constructing a full synthetic `LegacyRound` just
 * to exercise this one predicate — not otherwise used outside this module.
 */
export function findSelfAuraEvidence(
  unit: ICombatUnit,
  cd: Pick<IMajorCooldownInfo, "spellId" | "spellName">,
): { spellId: string; timestamp: number } | undefined {
  for (const a of unit.auraEvents) {
    if (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
    if (a.srcUnitId !== unit.id || a.destUnitId !== unit.id) continue;
    if (!a.spellId) continue;
    if (getEnglishSpellName(a.spellId, "") !== cd.spellName) continue;
    return { spellId: a.spellId, timestamp: a.timestamp };
  }
  return undefined;
}

/** Scans one already-loaded round for the contradiction. Pure, no I/O. */
export function scanRoundForCdLedgerRot(
  matchId: string,
  legacy: LegacyRound,
  roundSeq?: number,
): CdLedgerRotHit[] {
  const { friends, enemies } = splitTeams(legacy);
  const players = [...friends, ...enemies];
  const hits: CdLedgerRotHit[] = [];

  for (const unit of players) {
    const cds = extractMajorCooldowns(unit, legacy);
    for (const cd of cds) {
      if (!cd.neverUsed) continue;
      const evidence = findSelfAuraEvidence(unit, cd);
      if (!evidence) continue;
      hits.push({
        matchId,
        roundSeq,
        unitName: unit.name,
        spellId: cd.spellId,
        spellName: cd.spellName,
        auraSpellId: evidence.spellId,
        auraTimeSeconds: (evidence.timestamp - legacy.startTime) / 1000,
      });
    }
  }
  return hits;
}

/**
 * Collapses exact-duplicate hits to one. Needed because the CLI's partial
 * file is append-only and resumable (`cdLedgerRotScan.ts`'s own header
 * explains why): killing a batch mid-match can append that match's hits
 * once but leave its id out of the processed-id file, so the NEXT batch
 * reprocesses the same match and appends the same hits again. The dedupe
 * key deliberately excludes nothing from the hit's identity (same match +
 * round + unit + spell + aura + time = the same real-world event), so two
 * independently-detected DIFFERENT procs of the same spell in the same
 * second are never merged away.
 */
export function dedupeHits(hits: CdLedgerRotHit[]): CdLedgerRotHit[] {
  const seen = new Set<string>();
  const out: CdLedgerRotHit[] = [];
  for (const h of hits) {
    const key = `${h.matchId}#${h.roundSeq ?? ""}|${h.unitName}|${h.spellId}|${h.auraSpellId}|${h.auraTimeSeconds}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

/** One line per hit, sorted for stable diffing across scan runs. */
function formatHitLines(hits: CdLedgerRotHit[]): string[] {
  const sorted = [...hits].sort((a, b) =>
    a.matchId === b.matchId
      ? a.unitName.localeCompare(b.unitName) ||
        a.spellId.localeCompare(b.spellId)
      : a.matchId.localeCompare(b.matchId),
  );
  return sorted.map(
    (h) =>
      `${h.matchId}${h.roundSeq !== undefined ? `#${h.roundSeq}` : ""}  ${h.unitName}  ${h.spellName}(${h.spellId})  aura=${h.auraSpellId}@${h.auraTimeSeconds.toFixed(1)}s`,
  );
}

/** Renders the markdown report body (counts + full list) for a finished scan. */
export function formatReport(opts: {
  tag: string;
  matchesScanned: number;
  errors: number;
  hits: CdLedgerRotHit[];
}): string {
  const { tag, matchesScanned, errors } = opts;
  const hits = dedupeHits(opts.hits);
  const lines = [
    `# cd-ledger-rot scan — ${tag}`,
    "",
    `matches scanned: ${matchesScanned}`,
    `matches errored (skipped): ${errors}`,
    `contradictions (flow/aura evidence ∧ ledger neverUsed): ${hits.length}`,
    "",
    "## hits",
    "",
    ...(hits.length ? formatHitLines(hits) : ["(none)"]),
    "",
  ];
  return lines.join("\n");
}
