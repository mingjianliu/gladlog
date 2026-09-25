/**
 * CLI: buffs players actually carry that change a ledger cooldown's charges,
 * cooldown or recharge rate — and whether the cooldown model knows about them
 * (GH #106 follow-up, 2026-09-25).
 *
 * The talent inventory (datagen genTalentModifiers → talentEffectInventory)
 * starts from talent / PvP / spec-passive spells and follows DB2 trigger
 * links. Two kinds of effect never reach the ledger that way:
 *   - a buff a talent grants through a SCRIPT (a dummy aura, no DB2 trigger):
 *     Call of the Elder Druid 426784 → Heart of the Wild 319454, whose
 *     effect 8 is aura 411 "+1 max charge" on Frenzied Regeneration's charge
 *     category 1568 — Restoration Druids pressed it twice within 1.2–4.5 s in
 *     11 of 11 such pairs, always with 319454 up; the inventory has no row for
 *     319454 at all;
 *   - a finite-duration buff the inventory does reach ("whileAura"), whose
 *     SpellMods compileCooldownModifiers drops on purpose because they only
 *     hold while the buff is up (Incarnation / Berserk rows).
 * This is the forward completeness check of the Curated-List Completeness
 * Rule (CLAUDE.md): start from what the corpus shows players carrying, ask
 * DB2 what each of those auras does to a ledger cooldown, and list what the
 * model does not know.
 *
 * Pass 1 (corpus): every aura a player applied to themselves, per spec, and
 * the spells extractMajorCooldowns actually put in that spec's ledger (the
 * ledger is classMetadata PLUS runtime rosters — Restoration Druid's
 * Frenzied Regeneration comes from the healer save roster, not the catalog —
 * so it is read from the product, not re-derived from a hand list).
 * Pass 2 (DB2, local datagen cache): those auras go into the SAME target
 * resolution the generator uses (buildTalentInventory — class mask, charge
 * category, cooldown category, SpellLabel) as spec sources of the specs that
 * carried them; rows that hit a spell in the ledger of a spec that carried
 * the aura, with a charge / cooldown / charge-recovery effect, are reported as
 *   MODELLED   the aura is already a modifier source for that target
 *   CONDITIONAL the generator reaches it but drops it (finite buff)
 *   UNSEEN     the generator never reaches the aura at all
 *
 * Usage:
 *   tsx packages/eval/scripts/auraCooldownModScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-2026-08-28-newseason.txt \
 *     [--every 30] [--dump <json>] | --from-dump <json>
 *   DATAGEN_CACHE (default ~/.cache/gladlog-datagen) picks the table cache;
 *   the DB2 build defaults to the one talentEffectInventoryGenerated.json was
 *   built from (DATAGEN_BUILD overrides), so "UNSEEN" is judged against the
 *   same tables the generator read.
 */
import {
  AURA_ADD_FLAT_MODIFIER,
  AURA_ADD_FLAT_MODIFIER_BY_LABEL,
  AURA_ADD_PCT_MODIFIER,
  AURA_ADD_PCT_MODIFIER_BY_LABEL,
  AURA_CHARGE_RECOVERY_MULTIPLIER,
  AURA_MOD_CATEGORY_COOLDOWN,
  AURA_MOD_MAX_CHARGES,
  AURA_MOD_SPELL_CATEGORY_COOLDOWN,
  buildTalentInventory,
  SPELLMOD_COOLDOWN,
} from "@gladlog/analysis/scripts/datagen/lib/talentInventory";
import {
  fetchTable,
  parseCsv,
} from "@gladlog/analysis/scripts/datagen/lib/wagoCsv";
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { PVP_TALENT_POOL_GENERATED } from "@gladlog/analysis/src/data/pvpTalentPoolGenerated";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import inventoryGenerated from "@gladlog/analysis/src/data/talentEffectInventoryGenerated.json";
import talentIdMap from "@gladlog/analysis/src/data/talentIdMap.json";
import talentModifiers from "@gladlog/analysis/src/data/talentModifiers.json";
import { extractMajorCooldowns } from "@gladlog/analysis/src/utils/cooldowns";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { gunzipSync } from "zlib";

type Dump = {
  manifest: string;
  every: number;
  filesRead: number;
  /** aura id → spec → units that applied it to themselves */
  auras: Record<string, Record<string, number>>;
  /** spec → spell id → units whose ledger (extractMajorCooldowns) had it */
  ledger: Record<string, Record<string, number>>;
};

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { manifest: "", every: 30, dump: "", fromDump: "" };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--manifest") out.manifest = a[++i] ?? "";
    else if (a[i] === "--every") out.every = Number(a[++i]);
    else if (a[i] === "--dump") out.dump = a[++i] ?? "";
    else if (a[i] === "--from-dump") out.fromDump = a[++i] ?? "";
  }
  if (
    (!out.manifest && !out.fromDump) ||
    !Number.isInteger(out.every) ||
    out.every < 1
  ) {
    console.error(
      "usage: auraCooldownModScan.ts (--manifest <path> [--every N] [--dump <json>] | --from-dump <json>)",
    );
    process.exit(1);
  }
  return out;
}

const args = parseArgs();
await ensureAnalysisData();

// ── pass 1: self-applied auras per spec ────────────────────────────────────
let dump: Dump;
if (args.fromDump) {
  dump = JSON.parse(readFileSync(args.fromDump, "utf8")) as Dump;
} else {
  dump = {
    manifest: args.manifest.split("/").pop() ?? "",
    every: args.every,
    filesRead: 0,
    auras: {},
    ledger: {},
  };
  const files = readFileSync(args.manifest, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((_, i) => i % args.every === 0);
  for (const f of files) {
    const parser = new GladLogParser();
    const items: GladMatch[] = [];
    parser.on("match", (m) => items.push(m));
    parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
    let text: string;
    try {
      const raw = readFileSync(f);
      text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
    }
    dump.filesRead++;
    for (const line of text.split("\n")) parser.push(line);
    parser.end();
    for (const m of items) {
      let legacy: ReturnType<typeof toLegacyMatch>;
      try {
        legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
      } catch {
        continue;
      }
      for (const u of Object.values(legacy.units)) {
        if (!u.info || !u.spec) continue;
        const seen = new Set<string>();
        for (const e of u.auraEvents)
          if (
            e.logLine.event === "SPELL_AURA_APPLIED" &&
            e.srcUnitId === u.id &&
            e.destUnitId === u.id &&
            e.spellId
          )
            seen.add(e.spellId);
        for (const id of seen) {
          const bySpec = (dump.auras[id] ??= {});
          bySpec[u.spec] = (bySpec[u.spec] ?? 0) + 1;
        }
        let cds: ReturnType<typeof extractMajorCooldowns> = [];
        try {
          cds = extractMajorCooldowns(u, legacy);
        } catch {
          continue;
        }
        const spec = (dump.ledger[u.spec] ??= {});
        for (const cd of cds) spec[cd.spellId] = (spec[cd.spellId] ?? 0) + 1;
      }
    }
  }
  if (args.dump) {
    const tmp = `${args.dump}.tmp`;
    writeFileSync(tmp, JSON.stringify(dump));
    renameSync(tmp, args.dump);
    console.log(
      `dumped ${Object.keys(dump.auras).length} auras to ${args.dump}`,
    );
  }
}

// ── pass 2: what DB2 says each of those auras does to a ledger cooldown ────
const build =
  process.env.DATAGEN_BUILD ??
  (inventoryGenerated as { _meta: { build: string } })._meta.build;
const cacheDir =
  process.env.DATAGEN_CACHE ??
  path.join(homedir(), ".cache", "gladlog-datagen");
const [effectRaw, classOptRaw, categoriesRaw, labelRaw] = await Promise.all([
  fetchTable("SpellEffect", build, cacheDir),
  fetchTable("SpellClassOptions", build, cacheDir),
  fetchTable("SpellCategories", build, cacheDir),
  fetchTable("SpellLabel", build, cacheDir),
]);

const ledgerIds = new Set<string>();
for (const bySpell of Object.values(dump.ledger))
  for (const id of Object.keys(bySpell)) ledgerIds.add(id);
const inLedgerOf = (spec: string, spellId: string) =>
  (dump.ledger[spec]?.[spellId] ?? 0) > 0;

// every observed aura becomes a "spec source" of the specs that carried it
const specSpells = new Map<string, number[]>();
for (const [id, bySpec] of Object.entries(dump.auras))
  specSpells.set(
    id,
    Object.keys(bySpec)
      .map(Number)
      .filter((s) => s > 0),
  );
const inventory = buildTalentInventory({
  talentTrees: talentIdMap as never,
  pvpPool: PVP_TALENT_POOL_GENERATED,
  spellEffectRows: parseCsv(effectRaw).rows,
  spellClassOptionsRows: parseCsv(classOptRaw).rows,
  spellCategoriesRows: parseCsv(categoriesRaw).rows,
  spellLabelRows: parseCsv(labelRaw).rows,
  trackedSpellIds: ledgerIds,
  specSpells,
});

const COOLDOWN_AURAS = new Set([
  AURA_MOD_MAX_CHARGES,
  AURA_CHARGE_RECOVERY_MULTIPLIER,
  AURA_MOD_CATEGORY_COOLDOWN,
  AURA_MOD_SPELL_CATEGORY_COOLDOWN,
]);
const SPELLMOD_AURAS = new Set([
  AURA_ADD_FLAT_MODIFIER,
  AURA_ADD_PCT_MODIFIER,
  AURA_ADD_FLAT_MODIFIER_BY_LABEL,
  AURA_ADD_PCT_MODIFIER_BY_LABEL,
]);
const kindOf = (aura: number, misc0: number): string | null => {
  if (aura === AURA_MOD_MAX_CHARGES) return "max charges";
  if (aura === AURA_CHARGE_RECOVERY_MULTIPLIER) return "charge recovery ×";
  if (aura === AURA_MOD_CATEGORY_COOLDOWN) return "category cooldown";
  if (aura === AURA_MOD_SPELL_CATEGORY_COOLDOWN) return "spell category cd";
  if (SPELLMOD_AURAS.has(aura) && misc0 === SPELLMOD_COOLDOWN)
    return aura === AURA_ADD_PCT_MODIFIER ||
      aura === AURA_ADD_PCT_MODIFIER_BY_LABEL
      ? "cooldown %"
      : "cooldown ms";
  return null;
};

// what the product already knows
const modelled = new Set<string>();
for (const [target, mods] of Object.entries(
  talentModifiers as Record<string, { talentSpellId: string }[]>,
))
  for (const m of mods) modelled.add(`${m.talentSpellId}>${target}`);
const reachedByGenerator = new Map<string, string>();
for (const r of (
  inventoryGenerated as { rows: { spellId: string; activation: string }[] }
).rows)
  reachedByGenerator.set(r.spellId, r.activation);

// reachable from which observed aura: the inventory's edges (hop 0 = itself)
const carrierOf = new Map<string, Set<string>>();
for (const e of inventory.edges) {
  if (!dump.auras[e.talentSpellId]) continue;
  const s = carrierOf.get(e.spellId) ?? new Set<string>();
  s.add(e.talentSpellId);
  carrierOf.set(e.spellId, s);
}

type Hit = {
  aura: string;
  carrier: string;
  kind: string;
  basePoints: number;
  target: string;
  status: "MODELLED" | "CONDITIONAL" | "UNSEEN";
  units: number;
  specs: string;
};
const hits: Hit[] = [];
for (const r of inventory.rows) {
  const kind = kindOf(r.aura, r.misc0);
  if (!kind || (!COOLDOWN_AURAS.has(r.aura) && !SPELLMOD_AURAS.has(r.aura)))
    continue;
  const targets = r.targets.filter((t) => ledgerIds.has(t.spellId));
  if (!targets.length) continue;
  for (const aura of carrierOf.get(r.spellId) ?? []) {
    const bySpec = dump.auras[aura]!;
    for (const t of targets) {
      // only the specs that both carry the aura and have the target in their
      // ledger — a Druid-wide mask row says nothing about Feral's ledger
      const specs = Object.entries(bySpec).filter(([spec]) =>
        inLedgerOf(spec, t.spellId),
      );
      if (!specs.length) continue;
      const units = specs.reduce((a, [, n]) => a + n, 0);
      const status = modelled.has(`${aura}>${t.spellId}`)
        ? "MODELLED"
        : reachedByGenerator.has(r.spellId)
          ? "CONDITIONAL"
          : "UNSEEN";
      hits.push({
        aura,
        carrier: r.spellId,
        kind,
        basePoints: r.basePoints,
        target: t.spellId,
        status,
        units,
        specs: specs
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([s, n]) => `${s}:${n}`)
          .join(" "),
      });
    }
  }
}

const seen = new Set<string>();
const uniq = hits.filter((h) => {
  const k = `${h.aura}|${h.carrier}|${h.kind}|${h.target}|${h.basePoints}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
const name = (id: string) => getEnglishSpellName(id, "") || `#${id}`;
console.log(
  `files read ${dump.filesRead}; self-applied auras ${Object.keys(dump.auras).length}; DB2 build ${build}`,
);
for (const status of ["UNSEEN", "CONDITIONAL", "MODELLED"] as const) {
  const rows = uniq
    .filter((h) => h.status === status)
    .sort((a, b) => b.units - a.units);
  console.log(`\n── ${status} (${rows.length})`);
  for (const h of rows)
    console.log(
      `${String(h.units).padStart(6)} units  ${h.aura.padEnd(8)} ${name(h.aura).slice(0, 26).padEnd(26)}${h.carrier !== h.aura ? ` via ${h.carrier}` : ""}  ${h.kind} ${h.basePoints}  → ${h.target} ${name(h.target).slice(0, 24)}  [${h.specs}]`,
    );
}
