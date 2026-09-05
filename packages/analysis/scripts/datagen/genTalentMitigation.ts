/**
 * Talent-granted damage reduction (2026-08-18).
 *
 * Why this exists: `genMitigation.ts` reads the official DB2 aura
 * `AURA_MOD_DAMAGE_PERCENT_TAKEN` (87), but gates its input on a **46-id hand
 * whitelist** (`bigDefensiveSpellIds` + `externalDefensiveSpellIds` +
 * `attributedMitigationSpellIds`). Mitigation that a *talent* grants — hero
 * passives, PvP talents, DR hanging off a mobility ability — is therefore
 * invisible **by construction, not by data absence**: DB2 has the rows, the
 * generator never asks for those ids. This is the fourth instance of the
 * Curated-List Completeness Rule in CLAUDE.md, same shape as the others.
 * Motivating measurement (2026-08-18, 1228 rounds): 26.1% of enemy snapshots
 * had *zero* tracked defensives, which is what made
 * `killWindowTargetSelection`'s softness score incomparable across enemies.
 *
 * ## Why the predicate is the tooltip, not the aura
 *
 * The obvious approach — run the aura-87 extraction over the talent spell
 * universe — was tried first and **under-recalls badly**: 35 hits, only one of
 * them (473909) new above 20%. The reason is that a talent's own spell id
 * usually does not carry the mitigation aura; the number lives on a *separate*
 * buff spell that the talent's tooltip references (`通透影像` 373446 reads
 * "渐隐术会使你受到的伤害降低$373447s1%" — the 5% is on 373447). A second
 * attempt keyed on `EffectAura=4` (DUMMY) with a percent-shaped value produced
 * 24 candidates that were mostly **not** mitigation at all (374277 强化灵界打击
 * -50 is a Death Strike buff), because a DUMMY value carries no unit.
 *
 * So the predicate here is: **the localized tooltip says "受到的伤害降低"**,
 * and the percentage is resolved by following the placeholder the tooltip
 * itself points at (`$<spellId>s<n>` → that spell's effect row n, `$s<n>` →
 * this spell's own row n). That turns an archaeology problem into a lookup:
 * 67 talents match, 56 resolve mechanically, and the residue is emitted as
 * `pendingRuling` rather than guessed at.
 *
 * `auraSpellId` is recorded alongside, because it — not the talent id — is
 * what a combat log's aura events actually show; a consumer asking "is this
 * DR active right now" must match on that id.
 *
 * ## Guards
 *
 * The tooltip predicate is locale-dependent, so it fails *silently* if wago's
 * zhCN column ever lags a build. Three guards make that loud: a minimum hit
 * count, and two positive controls (473909 知识古树, a PvP talent whose id the
 * node tree does not contain at all; 431873 瞬息之隔, whose percentage only
 * resolves through the tooltip path). Any of them failing throws.
 *
 * Absorb shields (`EffectAura=69`) are deliberately out of scope: they are a
 * flat absorbed amount, not a percentage, and mixing units in one table is
 * what a consumer would get wrong.
 *
 * ## `beneficiary` — read this before using the table
 *
 * A tooltip saying "受到的伤害降低" does not say *whose* damage. 459546 不要见怪
 * reduces damage taken **by the hunter's pet**; 53480 牺牲咆哮 and 98008
 * 灵魂链接图腾 protect **allies**. A consumer asking "how hard is this enemy
 * player to kill" must not count either. The `beneficiary` field is a
 * **tooltip heuristic**, not official data: 宠物 → "pet", 盟友/目标/小队 →
 * "other", otherwise "self". It is deliberately conservative in the sense that
 * it is easy to audit (the tooltip ships with every entry) and impossible to
 * silently trust (the field name says heuristic in its doc comment). Anything
 * consuming this for enemy hardness should filter to `beneficiary === "self"`
 * and re-check the residue by hand.
 *
 * Usage: `DATAGEN_BUILD=<build> DATAGEN_CACHE=<dir> npx tsx
 * packages/analysis/scripts/datagen/genTalentMitigation.ts`
 */
import { readFileSync } from "node:fs";

import { PVP_TALENT_POOL_GENERATED } from "../../src/data/pvpTalentPoolGenerated";
import { writeArtifact } from "./lib/emit";
import { PVP_MULTIPLIER_COLUMN, pvpBasePoints } from "./lib/pvpMultiplier";
import {
  applyHotfixOverlay,
  dataDirOf,
  loadHotfixOverlay,
} from "./lib/simcHotfix";
import {
  assertColumns,
  assertMinRows,
  fetchLatestBuild,
  fetchTable,
  parseCsv,
} from "./lib/wagoCsv";

/**
 * "damage taken is reduced" in the zhCN tooltip. Deliberately excludes
 * 造成的伤害降低 (damage *dealt* reduced — that is a debuff on the enemy) by
 * requiring the 受到/承受 stem.
 */
const TAKEN_RE = /(受到的?伤害(降低|减少|下降)|承受的伤害(降低|减少)|伤害减免)/;

/**
 * The placeholder that follows the "damage taken reduced" phrase, which is
 * where the number lives. Forms seen in 12.1: `$s1` / `$S1` / `$w2` (this
 * spell's own effect row) and `${$373447s1}` / `$373447s1` (another spell's).
 * The `[^%]{0,40}?` hop skips conditional wrappers like `$?s316714[`.
 */
const PLACEHOLDER_RE =
  /(?:受到的?伤害(?:降低|减少|下降)|承受的伤害(?:降低|减少)|伤害减免(?:提高至)?)[^%]{0,40}?\$\{?\$?(\d+)?([sSwW])(\d+)/;

/** A tooltip that states the number literally, e.g. 「受到的伤害降低20%」. */
const LITERAL_RE =
  /(?:受到的?伤害(?:降低|减少|下降)|承受的伤害(?:降低|减少))(\d+(?:\.\d+)?)%/;

/** Below this many tooltip matches, assume the locale column regressed. */
const MIN_TOOLTIP_HITS = 40;

interface TalentNodeEntry {
  spellId?: number;
  name?: string;
}
interface TalentNode {
  id: number;
  name?: string;
  entries?: TalentNodeEntry[];
}
interface TalentSpec {
  specId: number;
  className: string;
  specName: string;
  classNodes?: TalentNode[];
  specNodes?: TalentNode[];
  heroNodes?: TalentNode[];
}

/**
 * Who the DR applies to. **Tooltip heuristic, not official data** — see the
 * header's `beneficiary` section before consuming it.
 */
export type Beneficiary = "self" | "pet" | "other";

/**
 * Exported for tests. Proximity-based: the noun nearest BEFORE the
 * "受到的伤害降低" phrase is who the reduction applies to. A global "mentions
 * 宠物 anywhere → pet" rule was tried first and misclassified 53480 牺牲咆哮
 * ("命令你的宠物保护一名盟友，使其受到的伤害降低" — the DR goes to the ALLY,
 * the pet is only the damage-redirect vehicle; user correction 2026-08-18) and
 * 1272094 守护者之皮 ("你的宠物时刻保护着你，使你受到的伤害降低" — the DR is
 * on the hunter). 其/目标 resolve to whatever stood closest in the sentence.
 */
export function classifyBeneficiary(description: string): Beneficiary {
  const at = description.search(TAKEN_RE);
  const prefix = at >= 0 ? description.slice(0, at) : description;
  const markers: Array<[RegExp, Beneficiary]> = [
    [/宠物/g, "pet"],
    [/(盟友|队友|小队|团队成员|受保护目标|目标)/g, "other"],
    [/你/g, "self"],
  ];
  let best: { pos: number; who: Beneficiary } | null = null;
  for (const [re, who] of markers) {
    for (const m of prefix.matchAll(re)) {
      const pos = m.index ?? -1;
      if (best === null || pos > best.pos) best = { pos, who };
    }
  }
  return best?.who ?? "self";
}

export interface ITalentSource {
  /** Which tree the id came from. */
  source: "class" | "spec" | "hero" | "pvp";
  /** Spec ids that can take it (raidbots specId / PvpTalent SpecID). */
  specIds: number[];
}

/** Builds the talent spell universe with provenance. Exported for tests. */
export function buildTalentUniverse(
  specs: TalentSpec[],
  pvpPool: Record<string, Record<string, string>>,
): Map<string, ITalentSource> {
  const out = new Map<string, ITalentSource>();
  const add = (
    id: string,
    source: ITalentSource["source"],
    specId: number,
  ): void => {
    const prev = out.get(id);
    if (prev) {
      if (!prev.specIds.includes(specId)) prev.specIds.push(specId);
      return;
    }
    out.set(id, { source, specIds: [specId] });
  };
  for (const spec of specs) {
    const groups: Array<[ITalentSource["source"], TalentNode[]]> = [
      ["class", spec.classNodes ?? []],
      ["spec", spec.specNodes ?? []],
      ["hero", spec.heroNodes ?? []],
    ];
    for (const [source, nodes] of groups) {
      for (const node of nodes) {
        for (const entry of node.entries ?? []) {
          if (entry.spellId) add(String(entry.spellId), source, spec.specId);
        }
      }
    }
  }
  // PvP talents are NOT in the node tree — without this half the 473909
  // positive control is missed entirely. See header.
  for (const [specId, granted] of Object.entries(pvpPool)) {
    for (const id of Object.keys(granted)) add(id, "pvp", Number(specId));
  }
  return out;
}

export interface IResolvedPct {
  pct: number | null;
  /** The spell whose aura actually carries the DR (what shows up in the log). */
  auraSpellId: string | null;
  /** Human-checkable trace of how the number was obtained. */
  via: string;
}

/**
 * Resolves the DR percentage a tooltip promises, by following the placeholder
 * the tooltip itself points at. Exported for tests.
 */
export function resolvePct(
  spellId: string,
  description: string,
  effects: Map<string, Map<number, { aura: string; pts: number }>>,
): IResolvedPct {
  const literal = description.match(LITERAL_RE);
  if (literal) {
    const pct = Math.round(Number(literal[1]));
    if (pct > 0 && pct <= 100)
      return { pct, auraSpellId: spellId, via: `tooltip literal ${pct}%` };
  }
  const m = description.match(PLACEHOLDER_RE);
  if (!m)
    return { pct: null, auraSpellId: null, via: "no parsable placeholder" };
  const refId = m[1] ?? spellId;
  const index = Number(m[3]) - 1;
  const row = effects.get(refId)?.get(index);
  if (!row)
    return {
      pct: null,
      auraSpellId: refId,
      via: `${refId} effect ${index + 1} — no such row`,
    };
  const pct = Math.abs(Math.round(row.pts));
  if (!(pct > 0 && pct <= 100))
    return {
      pct: null,
      auraSpellId: refId,
      via: `${refId} effect ${index + 1} (aura ${row.aura}) = ${row.pts} — not a usable percent`,
    };
  return {
    pct,
    auraSpellId: refId,
    via: `${refId === spellId ? "self" : `ref ${refId}`} ${m[2]}${m[3]} (aura ${row.aura}) = ${row.pts}`,
  };
}

export async function main(): Promise<void> {
  const build = process.env.DATAGEN_BUILD ?? (await fetchLatestBuild());
  const dataDir = new URL("../../src/data/", import.meta.url).pathname;
  const specs = JSON.parse(
    readFileSync(`${dataDir}talentIdMap.json`, "utf8"),
  ) as TalentSpec[];
  const zhNames = JSON.parse(
    readFileSync(`${dataDir}spellNamesZhGenerated.json`, "utf8"),
  ) as Record<string, string>;

  const universe = buildTalentUniverse(specs, PVP_TALENT_POOL_GENERATED);

  const spellCsv = await fetchTable(
    "Spell",
    build,
    process.env.DATAGEN_CACHE,
    "zhCN",
  );
  const spellParsed = parseCsv(spellCsv);
  assertMinRows(spellParsed.rows, 300000, "Spell(zhCN)");
  assertColumns(
    spellParsed.header,
    ["ID", "Description_lang", "AuraDescription_lang"],
    "Spell(zhCN)",
  );
  const descriptions = new Map<string, string>();
  for (const row of spellParsed.rows) {
    const text = [row.Description_lang, row.AuraDescription_lang]
      .filter(Boolean)
      .join(" ");
    if (text) descriptions.set(row.ID, text);
  }

  const effectCsv = await fetchTable(
    "SpellEffect",
    build,
    process.env.DATAGEN_CACHE,
  );
  const effectParsed = parseCsv(effectCsv);
  // Live hotfixes on top of the client build (BACKLOG #41 (3)).
  const hf = applyHotfixOverlay(
    effectParsed.rows,
    loadHotfixOverlay(dataDirOf(import.meta.url)),
  );
  console.log(`hotfix overlay: ${hf.applied} writes on ${hf.rowsTouched} rows`);
  // Same truncation guard as genMitigation: a partial download must blow up.
  assertMinRows(effectParsed.rows, 500000, "SpellEffect");
  assertColumns(
    effectParsed.header,
    [
      "DifficultyID",
      "EffectAura",
      "EffectBasePointsF",
      "EffectIndex",
      "SpellID",
      PVP_MULTIPLIER_COLUMN,
    ],
    "SpellEffect",
  );
  const effects = new Map<string, Map<number, { aura: string; pts: number }>>();
  for (const row of effectParsed.rows) {
    if (row.DifficultyID !== "0") continue;
    const byIndex = effects.get(row.SpellID) ?? new Map();
    byIndex.set(Number(row.EffectIndex), {
      aura: row.EffectAura,
      // PvP-scaled (lib/pvpMultiplier.ts): the tooltip placeholder resolves to
      // the arena number — Roar of Sacrifice $s1 = −15 × 1.667 = 25 %.
      pts: pvpBasePoints(row),
    });
    effects.set(row.SpellID, byIndex);
  }

  const entries: Record<
    string,
    {
      pct: number;
      auraSpellId: string;
      zh: string;
      via: string;
      beneficiary: Beneficiary;
    } & ITalentSource
  > = {};
  const pendingRuling: Array<
    {
      spellId: string;
      zh: string;
      why: string;
      tooltip: string;
    } & ITalentSource
  > = [];
  // 用户逐条裁定排除的 pendingRuling 项(2026-08-20 批量裁定):tooltip 提及
  // 减伤但占位符/effect 解析不出可用百分比 —— 解析不出就不猜(签字纪律);
  // 真有减伤的已由官方减伤表覆盖(壮胆酒 115203=20%,2026-07-30 用户裁定)。
  // 语义:仅当 resolvePct 失败时才生效(跳过 pendingRuling 队列);若新 build
  // 使其可解析,正常入表,本表自然失效 —— 不遮蔽新数据。
  const RULED_EXCLUDED: Record<string, string> = {
    "48263": "三战老兵 — effect aura87=0,耐力天赋无可用减伤百分比",
    "1223323": "不破之谊 — 宠物受伤降低,effect 行不存在",
    "1264405": "午夜舞步 — effect aura219=0",
    "388917": "壮胆酒天赋 tooltip 变量不可解析;官方表 115203=20% 已覆盖",
    "974": "大地之盾 — 治疗增益,减伤 effect=0",
    "443028": "天神御身 — effect aura87=0",
    "115175": "抚慰之雾 — 治疗引导,减伤 effect=0",
    "1232897": "莱卡拉的启发 — 多形态变量 tooltip 不可解析",
  };
  let tooltipHits = 0;
  for (const [spellId, src] of universe) {
    const description = descriptions.get(spellId);
    if (!description || !TAKEN_RE.test(description)) continue;
    tooltipHits++;
    const { pct, auraSpellId, via } = resolvePct(spellId, description, effects);
    const zh = zhNames[spellId] ?? "?";
    if (pct === null || auraSpellId === null) {
      if (RULED_EXCLUDED[spellId]) continue; // 已裁定排除,不再排队
      pendingRuling.push({
        spellId,
        zh,
        why: via,
        tooltip: description.replace(/\s+/g, " ").slice(0, 160),
        ...src,
      });
      continue;
    }
    entries[spellId] = {
      pct,
      auraSpellId,
      zh,
      via,
      beneficiary: classifyBeneficiary(description),
      ...src,
    };
  }
  pendingRuling.sort((a, b) => a.zh.localeCompare(b.zh));

  if (tooltipHits < MIN_TOOLTIP_HITS) {
    throw new Error(
      `Only ${tooltipHits} talents matched the zhCN "受到的伤害降低" tooltip ` +
        `predicate (expected >= ${MIN_TOOLTIP_HITS}). The locale column has ` +
        `most likely regressed for this build — do not ship a silently empty table.`,
    );
  }
  for (const [control, why] of [
    ["473909", "PvP talent 知识古树 — the node tree alone does not contain it"],
    ["431873", "瞬息之隔 — only resolves through the tooltip path"],
  ] as const) {
    if (!entries[control]) {
      throw new Error(
        `Positive control failed: ${control} (${why}) did not resolve. ` +
          `Do not ship a table that silently lost its control.`,
      );
    }
  }

  const artifact = {
    _meta: {
      generatedAt: new Date().toISOString(),
      build,
      source:
        "zhCN Spell.Description_lang tooltip predicate over the talent spell " +
        "universe (talentIdMap class/spec/hero nodes ∪ PvpTalent pool); " +
        "percentage resolved through the placeholder the tooltip points at",
      universeSize: universe.size,
      tooltipHits,
      beneficiaryIsHeuristic:
        "tooltip-derived, not official — filter to self for enemy hardness",
    },
    entries,
    pendingRuling,
  };
  writeArtifact(
    `${dataDir}talentMitigationGenerated.json`,
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  console.log(
    `universe=${universe.size} tooltipHits=${tooltipHits} ` +
      `entries=${Object.keys(entries).length} pendingRuling=${pendingRuling.length}`,
    build,
  );
}

if (
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1]?.endsWith("genTalentMitigation.ts")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
