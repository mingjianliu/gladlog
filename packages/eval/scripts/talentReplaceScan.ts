/**
 * talentReplaceScan — corpus NOMINATION of class / hero-talent replacement
 * pairs (talent X taken → spell Y no longer exists for that player), and the
 * reverse check of the pairs already registered in `TALENT_REPLACES`.
 *
 * Why it exists (reliability audit C1, 2026-09-26): Restoration Shaman
 * Ancestral Swiftness 443454 (Farseer talent 448861) replaces Nature's
 * Swiftness 378081 — the tooltip says so ("If you know Nature's Swiftness, it
 * is replaced by Ancestral Swiftness") — but no DB2 relation the datagen reads
 * encodes it: TraitDefinition.OverridesSpellID is 0 for 448861 (the override
 * is conditional on knowing NS) and the talent's only SpellEffect row is an
 * aura-226 dummy (basePoints 443454, misc0 0), not the aura-332 override the
 * `replace_spell` extraction reads. The ledger therefore kept a Nature's
 * Swiftness entry the player could not press: cd-waste "never pressed NS" on
 * a round with five Ancestral Swiftness casts (match 4ef486f5).
 *
 * Method (codex astra review of the first draft, 2026-09-26: the scan must NOT
 * enumerate `extractMajorCooldowns` — a registered pair would then vanish
 * from its own evidence, and the product under audit would pick the
 * denominator). Everything here is RAW evidence, independent of the ledger:
 *   per player of one spec: talent ids held (COMBATANT_INFO decoded through
 *   `playerTalentIdSets`; players whose talents did not decode are skipped,
 *   never treated as "holds nothing") and SPELL_CAST_SUCCESS counts of every
 *   spell with an official cooldown ≥ MIN_CD_SECONDS.
 *   Y universe per spec = spells cast by ≥ `--other-cast` of the spec's NON-holders
 *   of X (a real button of that spec); X universe = talents with ≥ `--min-n`
 *   holders AND ≥ `--min-n` non-holders in the spec (a universal talent has no
 *   control group and is reported as such, not silently dropped).
 *   Nominated: holders' cast rate of Y ≤ `--holder-cast` while non-holders' ≥
 *   `--other-cast`. Each nomination prints the holders who DID cast Y (counter-
 *   evidence — a real cast means the table must not drop Y for that player),
 *   the talents whose holder set is ≥ 95 % the same as X's (correlated talents
 *   the corpus cannot tell apart — pick by the tooltip, never by the number)
 *   and the spells holders press that non-holders never do (the replacement).
 *   Two shapes are NOT replacements and are filtered out (first run, 2026-09-26: 700 raw
 *   nominations, almost all of them these): (i) Y is an alias id of a spell the holders DO
 *   press (Bladestorm 227847 vs 446035 — `canonicalSpellId`); (ii) Y is itself a talent-tree
 *   spell most holders did not take (Colossus's Demolish for Slayer holders; a choice node's
 *   other side) — that is ownership, which `talentOwnershipOf` already answers. Talents with
 *   the same holder set (a whole hero tree) are printed once, together.
 * These are nomination criteria. A pair enters `TALENT_REPLACES` only with the
 * tooltip / DB2 sentence quoted in its note (Game-Behaviour Rule).
 *
 * Reverse check: every registered pair is re-measured on the same raw counts;
 * a pair whose holders cast Y is printed CONTRADICTED.
 *
 * Baseline 2026-09-26 (manifest-archive-2026-08-28-newseason, --every 30,
 * 605 files): see the commit that added `TALENT_REPLACES`.
 *
 *   npx tsx packages/eval/scripts/talentReplaceScan.ts --manifest <m> [--every 30]
 *       [--min-n 8] [--holder-cast 0.1] [--other-cast 0.5] [--talent <id>]
 */
import { ensureAnalysisData, specToString } from "@gladlog/analysis";
import {
  effectiveCooldownSeconds,
  getEnglishSpellName,
} from "@gladlog/analysis/src/data/spellEffectData";
import { TALENT_REPLACES } from "@gladlog/analysis/src/data/talentReplaces";
import { TALENT_REPLACES_GENERATED } from "@gladlog/analysis/src/data/talentReplacesGenerated";
import {
  canonicalSpellId,
  MIN_CD_SECONDS,
  PVP_TALENT_REPLACES,
  playerTalentIdSets,
} from "@gladlog/analysis/src/utils/cooldowns";
import { getSpecTalentTreeSpellIds } from "@gladlog/analysis/src/utils/talents";
import { GladLogParser } from "@gladlog/parser";
import type { CombatUnitSpec } from "@gladlog/parser-compat";
import { toLegacyMatch, toLegacyShuffle } from "@gladlog/parser-compat";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { arg, argOf } from "./lib/cli";

interface PlayerRow {
  /** spec id string, as the parser carries it */
  spec: string;
  /** class / spec / hero talent spell ids + PvP talent ids (prefixed "pvp:") */
  talents: Set<string>;
  /** SPELL_CAST_SUCCESS count per spell id with cooldown ≥ MIN_CD_SECONDS */
  casts: Map<string, number>;
  /** owner name, for the counter-evidence listing */
  name: string;
}

function nameOf(id: string): string {
  return getEnglishSpellName(id, "") || "?";
}

async function main(): Promise<void> {
  const manifest = arg("--manifest", "");
  if (!manifest) {
    console.error(
      "usage: --manifest <file> [--every N] [--min-n N] [--holder-cast r] [--other-cast r] [--talent <id>]",
    );
    process.exit(2);
  }
  const every = argOf("--every", 30);
  const minN = argOf("--min-n", 8);
  const holderCastMax = argOf("--holder-cast", 0.1);
  const otherCastMin = argOf("--other-cast", 0.5);
  const onlyTalent = arg("--talent", "");
  await ensureAnalysisData();

  const files = readFileSync(manifest, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((_, i) => i % every === 0);

  const players: PlayerRow[] = [];
  let rounds = 0;
  let skippedNoTalents = 0;
  for (const path of files) {
    let text: string;
    try {
      const raw = readFileSync(path);
      text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const combats: any[] = [];
    try {
      const parser = new GladLogParser();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parser.on("shuffle", (sh: any) => {
        for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r);
      });
      for (const line of text.split("\n")) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    for (const combat of combats) {
      rounds++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const u of Object.values(combat?.units ?? {}) as any[]) {
        if (!u.info) continue;
        const sets = playerTalentIdSets(u);
        if (sets.talentedSpellIds === null) {
          skippedNoTalents++;
          continue;
        }
        const talents = new Set<string>(sets.talentedSpellIds);
        for (const p of sets.pvpTalentIds)
          if (p && p !== "0") talents.add(`pvp:${p}`);
        const casts = new Map<string, number>();
        for (const e of u.spellCastEvents ?? []) {
          if (e.logLine?.event !== "SPELL_CAST_SUCCESS" || !e.spellId) continue;
          if ((effectiveCooldownSeconds(e.spellId) ?? 0) < MIN_CD_SECONDS)
            continue;
          casts.set(e.spellId, (casts.get(e.spellId) ?? 0) + 1);
        }
        players.push({
          spec: String(u.spec),
          talents,
          casts,
          name: u.name ?? "?",
        });
      }
    }
  }
  console.log(
    `files ${files.length} rounds ${rounds} players ${players.length} (skipped, talents undecoded: ${skippedNoTalents})`,
  );

  const bySpec = new Map<string, PlayerRow[]>();
  for (const p of players)
    bySpec.set(p.spec, [...(bySpec.get(p.spec) ?? []), p]);

  const castRate = (
    rows: PlayerRow[],
    y: string,
  ): { n: number; cast: number } => {
    let cast = 0;
    for (const r of rows) if ((r.casts.get(y) ?? 0) > 0) cast++;
    return { n: rows.length, cast };
  };

  // ── Reverse check of the registered tables ─────────────────────────────────
  console.log("\n== registered pairs, re-measured on raw casts ==");
  const registered: { talent: string; replaced: string; table: string }[] = [];
  for (const [t, ys] of Object.entries(TALENT_REPLACES))
    for (const y of ys)
      registered.push({ talent: t, replaced: y, table: "TALENT_REPLACES" });
  for (const [t, ys] of Object.entries(TALENT_REPLACES_GENERATED))
    for (const y of ys)
      registered.push({ talent: t, replaced: y, table: "TALENT_REPLACES_GENERATED" });
  for (const [t, ys] of Object.entries(PVP_TALENT_REPLACES))
    for (const y of ys)
      registered.push({
        talent: `pvp:${t}`,
        replaced: y,
        table: "PVP_TALENT_REPLACES",
      });
  for (const r of registered) {
    for (const [spec, rows] of bySpec) {
      const holders = rows.filter((p) => p.talents.has(r.talent));
      if (holders.length === 0) continue;
      const others = rows.filter((p) => !p.talents.has(r.talent));
      const h = castRate(holders, r.replaced);
      const o = castRate(others, r.replaced);
      if (h.n + o.n < minN) continue;
      const verdict = h.cast > 0 ? "CONTRADICTED" : "ok";
      console.log(
        `${verdict}\t${r.table}\t${specToString(spec as CombatUnitSpec)}\t${r.talent} ${nameOf(r.talent.replace(/^pvp:/, ""))} → ${r.replaced} ${nameOf(r.replaced)}\tholders cast ${h.cast}/${h.n}\tnon-holders cast ${o.cast}/${o.n}`,
      );
    }
  }

  // ── Nominations ────────────────────────────────────────────────────────────
  console.log(
    `\n== nominations (holders' cast rate ≤ ${holderCastMax}, non-holders' ≥ ${otherCastMin}, n ≥ ${minN} both sides) ==`,
  );
  const known = new Set(registered.map((r) => `${r.talent}|${r.replaced}`));
  /** (spec|Y|holder-set) → talents sharing that exact holder set (printed once) */
  const grouped = new Map<string, string[]>();
  let nominated = 0;
  for (const [spec, rows] of [...bySpec.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    const talentUniverse = new Map<string, number>();
    for (const p of rows)
      for (const t of p.talents)
        talentUniverse.set(t, (talentUniverse.get(t) ?? 0) + 1);
    for (const [x, holderN] of talentUniverse) {
      if (onlyTalent && x !== onlyTalent && x !== `pvp:${onlyTalent}`) continue;
      const holders = rows.filter((p) => p.talents.has(x));
      const others = rows.filter((p) => !p.talents.has(x));
      const universal = others.length < minN;
      if (holderN < minN) continue;
      if (universal && !onlyTalent) continue;
      // Y universe: real buttons of the spec (cast by ≥ otherCastMin of non-holders)
      const ys = new Set<string>();
      for (const p of others) for (const y of p.casts.keys()) ys.add(y);
      const treeIds = getSpecTalentTreeSpellIds(Number(spec));
      const holderSig = holders.map((p) => players.indexOf(p)).join(",");
      for (const y of ys) {
        const o = castRate(others, y);
        const h = castRate(holders, y);
        if (!universal && o.cast / o.n < otherCastMin) continue;
        if (h.cast / h.n > holderCastMax) continue;
        if (universal && !onlyTalent) continue;
        // (i) alias of a spell the holders press → same button, other id
        const canonY = canonicalSpellId(y);
        if (holders.some((p) => [...p.casts.keys()].some((z) => z !== y && canonicalSpellId(z) === canonY))) continue;
        // (ii) a tree spell most holders did not take → ownership, not replacement
        if (treeIds.has(y)) {
          let own = 0;
          for (const p of holders) if (p.talents.has(y)) own++;
          if (own / holders.length < 0.5) continue;
        }
        // one line per (spec, Y, holder set): a whole hero tree shares one holder set
        const groupKey = `${spec}|${y}|${holderSig}`;
        if (grouped.has(groupKey)) {
          grouped.get(groupKey)!.push(x);
          continue;
        }
        grouped.set(groupKey, [x]);
        nominated++;
        const flag = known.has(`${x}|${y}`) ? "KNOWN" : "NEW";
        console.log(
          `\n${flag}\t${specToString(spec as CombatUnitSpec)}\ttalent ${x} ${nameOf(x.replace(/^pvp:/, ""))} → ${y} ${nameOf(y)}` +
            `\tholders cast ${h.cast}/${h.n}\tnon-holders cast ${o.cast}/${o.n}${universal ? "\t(no control group)" : ""}`,
        );
        const counter = holders.filter((p) => (p.casts.get(y) ?? 0) > 0);
        if (counter.length)
          console.log(
            `  counter-evidence: ${counter
              .slice(0, 6)
              .map((p) => `${p.name} ×${p.casts.get(y)}`)
              .join(", ")}${counter.length > 6 ? " …" : ""}`,
          );
        // correlated talents: holder sets ≥ 95 % identical
        const corr: string[] = [];
        for (const [x2, n2] of talentUniverse) {
          if (x2 === x || n2 < minN) continue;
          let both = 0;
          for (const p of holders) if (p.talents.has(x2)) both++;
          const jaccard = both / (holderN + n2 - both);
          if (jaccard >= 0.95)
            corr.push(`${x2} ${nameOf(x2.replace(/^pvp:/, ""))}`);
        }
        if (corr.length)
          console.log(
            `  correlated talents (indistinguishable here): ${corr.join(", ")}`,
          );
        // the replacement: pressed by ≥ 70 % of holders, ≤ 5 % of non-holders
        const repl: string[] = [];
        const holderIds = new Set<string>();
        for (const p of holders)
          for (const id of p.casts.keys()) holderIds.add(id);
        for (const z of holderIds) {
          const hz = castRate(holders, z);
          const oz = castRate(others, z);
          if (hz.cast / hz.n >= 0.7 && (oz.n === 0 || oz.cast / oz.n <= 0.05))
            repl.push(
              `${z} ${nameOf(z)} (holders ${hz.cast}/${hz.n}, non-holders ${oz.cast}/${oz.n}, cd ${effectiveCooldownSeconds(z)})`,
            );
        }
        if (repl.length)
          console.log(`  holders press instead: ${repl.join("; ")}`);
      }
    }
  }
  for (const [k, xs] of grouped)
    if (xs.length > 1)
      console.log(`same holder set as ${xs[0]} (${k.split("|")[1]} ${nameOf(k.split("|")[1]!)}): ${xs.slice(1).map((x) => `${x} ${nameOf(x.replace(/^pvp:/, ""))}`).join(", ")}`);
  console.log(`\nnominations: ${nominated}`);
}

void main();
