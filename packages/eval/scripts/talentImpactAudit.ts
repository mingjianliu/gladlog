/**
 * talentImpactAudit.ts — the STRUCTURED half of the 2026-09-26 talent impact
 * audit: every DB2 SpellEffect row a talent reaches (talent inventory), what
 * kind of change it makes to which spell, and whether the product's consumer
 * for that kind of fact carries it.
 *
 * User 2026-09-26: "通读我们之前学到的所有天赋 然后仔细研究他们每一个对目前所有
 * 技能的影响 有没有体现在代码里 … 不光是冷却 还有被动触发 额外效果 加充能 等等".
 * The scripted half (tooltip-only effects no DB2 row carries) is the reading
 * pass; this script is the deterministic part and its calibration set.
 *
 * Unit = (talent, inventory row, target spell). Kind by encoding:
 *   cooldown   effect 148 · aura 453 / 341 · SpellMod op 11 (107/108/218/219) · aura 454 (recharge rate)
 *   charges    effect 121 · aura 411
 *   duration   op 1          range op 5 · radius op 6       castTime op 10
 *   value      op 0/3/8/12/15/22/23/32/33 (damage / heal / effect points / crit)
 *   replace    aura 332      procTrigger aura 42 (triggered spell = misc / trigger edge)
 *   other ops  14/34/39 cost · 17 chain targets · 18/4/38 proc · 19 period · 37 max stacks …
 * Consumer check per kind:
 *   cooldown / charges → talentModifiers.json (CD_TALENT_MODIFIERS) has (target, talent)
 *   duration           → BUFF_DURATION_TALENT_MODIFIERS / CC_DURATION_TALENT_MODIFIERS (target, talent)
 *   range / radius     → spellReachGenerated rangeMods / radiusMods (target, talent)
 *   value on a MITIGATION_TABLE aura → TALENT_MITIGATION_MODIFIERS (aura, talent)
 *   replace            → CD_TALENT_MODIFIERS replace_spell ∪ TALENT_REPLACES
 *   everything else    → no consumer family exists ("noConsumer")
 * Relevance: the hand tables (CURATED_ID_TABLES) and product sets that name
 * the target spell — a change to a spell no product table names can still
 * matter (the ledger admits spells dynamically), so it is reported, not dropped.
 *
 * Usage: npx tsx packages/eval/scripts/talentImpactAudit.ts [--catalog <catalog.json>] [--out <dir>]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { CURATED_ID_TABLES } from "@gladlog/analysis/src/data/curatedIdRegistry";
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { MITIGATION_TABLE } from "@gladlog/analysis/src/data/mitigationData";
import {
  BUFF_DURATION_TALENT_MODIFIERS,
  CC_DURATION_TALENT_MODIFIERS,
} from "@gladlog/analysis/src/data/spellEffectData";
import { TALENT_MITIGATION_MODIFIERS } from "@gladlog/analysis/src/data/talentMitigationModifiers";
import { TALENT_REPLACES } from "@gladlog/analysis/src/data/talentReplaces";
import { CD_TALENT_MODIFIERS } from "@gladlog/analysis/src/utils/talentModifiers";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const HOME =
  process.env.GLADLOG_EVAL_HOME ??
  join(process.env.HOME ?? "", "code/gladlog-eval-private");
const OUT = arg("--out", join(HOME, "reports/talent-impact-audit-2026-09-26"));
const CATALOG = arg("--catalog", join(OUT, "catalog/catalog.json"));
const PICKS = arg(
  "--picks",
  join(HOME, "reports/talent-catalog-2026-09-13/pickrates.json"),
);
const DATA = resolve("packages/analysis/src/data");

interface Row {
  rowId?: string;
  spellId: string;
  effectIndex: number;
  effect: number;
  aura: number;
  misc0: number;
  basePoints: number;
  pvpMultiplier: number;
  targets: Array<{ spellId: string; via: string }>;
  activation: string;
}
interface Edge {
  talentSpellId: string;
  spellId: string;
  hop: number;
  path: string;
  classId: number;
  specIds?: number[];
}

const VALUE_OPS = new Set([0, 3, 8, 12, 15, 22, 23, 32, 33]);
const OP_NAME: Record<number, string> = {
  0: "damage/heal",
  1: "duration",
  2: "threat",
  3: "points#1",
  4: "procCharges",
  5: "range",
  6: "radius",
  7: "critChance",
  8: "points(all)",
  9: "pushback",
  10: "castTime",
  11: "cooldown",
  12: "points#2",
  13: "targetResist",
  14: "cost",
  15: "critDamage",
  16: "hit",
  17: "chainTargets",
  18: "procChance",
  19: "period",
  20: "chainAmplitude",
  21: "startCooldown",
  22: "periodic",
  23: "points#3",
  24: "bonusCoeff",
  26: "procFrequency",
  27: "amplitude",
  28: "dispelResist",
  31: "doses",
  32: "points#4",
  33: "points#5",
  34: "cost2",
  35: "chainJump",
  37: "maxStacks",
  38: "procCooldown",
  39: "cost3",
  40: "op40",
};

type Kind =
  | "cooldown"
  | "charges"
  | "duration"
  | "range"
  | "radius"
  | "castTime"
  | "value"
  | "replace"
  | "gcd"
  | "procTrigger"
  | "otherSpellMod";

function kindOf(r: Row): { kind: Kind; op?: number } | null {
  const spellMod = r.effect === 6 && [107, 108, 218, 219].includes(r.aura);
  if (r.effect === 121 || (r.effect === 6 && r.aura === 411))
    return { kind: "charges" };
  if (r.effect === 148 || (r.effect === 6 && [453, 341, 454].includes(r.aura)))
    return { kind: "cooldown" };
  if (spellMod) {
    const op = r.misc0;
    if (op === 11) return { kind: "cooldown", op };
    // op 21 StartCooldown = the GCD the spell triggers, not its cooldown
    if (op === 21) return { kind: "gcd", op };
    if (op === 1) return { kind: "duration", op };
    if (op === 5) return { kind: "range", op };
    if (op === 6) return { kind: "radius", op };
    if (op === 10) return { kind: "castTime", op };
    if (VALUE_OPS.has(op)) return { kind: "value", op };
    return { kind: "otherSpellMod", op };
  }
  if (r.effect === 6 && r.aura === 332) return { kind: "replace" };
  if (r.effect === 6 && r.aura === 42) return { kind: "procTrigger" };
  return null;
}

async function main(): Promise<void> {
  await ensureAnalysisData();
  const inv = JSON.parse(
    readFileSync(join(DATA, "talentEffectInventoryGenerated.json"), "utf8"),
  ) as {
    _meta: { build: string };
    rows: Row[];
    edges: Edge[];
  };
  const reach = JSON.parse(
    readFileSync(join(DATA, "spellReachGenerated.json"), "utf8"),
  ).spells as Record<
    string,
    {
      rangeMods?: Array<{ talent: string }>;
      radiusMods?: Array<{ talent: string }>;
    }
  >;
  const zh = JSON.parse(
    readFileSync(join(DATA, "spellNamesZhGenerated.json"), "utf8"),
  ) as Record<string, string>;
  const en = JSON.parse(
    readFileSync(join(DATA, "spellNames.json"), "utf8"),
  ) as Record<string, string>;
  const catalog = JSON.parse(readFileSync(CATALOG, "utf8")).rows as Array<{
    id: string;
    zh: string;
    en: string;
    className: string;
    specIds: number[];
    source: string;
  }>;
  const talentInfo = new Map(catalog.map((c) => [c.id, c]));
  const picks = JSON.parse(readFileSync(PICKS, "utf8")).bySpec as Record<
    string,
    { loadouts: number; tree: Record<string, number>; auto?: string[] }
  >;
  const pickRateOf = (
    talent: string,
    specIds: number[] | undefined,
  ): number | null => {
    let n = 0,
      d = 0;
    for (const s of specIds ?? Object.keys(picks).map(Number)) {
      const p = picks[String(s)];
      if (!p) continue;
      const has =
        p.tree[talent] ?? (p.auto?.includes(talent) ? p.loadouts : undefined);
      if (has === undefined && !specIds) continue;
      n += has ?? 0;
      d += p.loadouts;
    }
    return d ? Math.round((n / d) * 1000) / 1000 : null;
  };
  const observed = new Set(
    (
      JSON.parse(
        readFileSync(join(DATA, "observedSpellIdsGenerated.json"), "utf8"),
      ) as number[]
    ).map(String),
  );

  // relevance index: spell → the hand tables / product sets naming it
  const tablesOf = new Map<string, string[]>();
  const note = (id: string, name: string) => {
    const l = tablesOf.get(id) ?? [];
    if (!l.includes(name)) l.push(name);
    tablesOf.set(id, l);
  };
  for (const t of CURATED_ID_TABLES) for (const id of t.ids()) note(id, t.name);
  for (const id of Object.keys(MITIGATION_TABLE)) note(id, "MITIGATION_TABLE");
  for (const id of Object.keys(CD_TALENT_MODIFIERS))
    note(id, "CD_TALENT_MODIFIERS(target)");

  const rowsBySpell = new Map<string, Row[]>();
  for (const r of inv.rows) {
    const l = rowsBySpell.get(r.spellId) ?? [];
    l.push(r);
    rowsBySpell.set(r.spellId, l);
  }

  const cdHas = (target: string, talent: string, effect?: string) =>
    (CD_TALENT_MODIFIERS[target] ?? []).some(
      (m) => m.talentSpellId === talent && (!effect || m.effect === effect),
    );
  const durHas = (target: string, talent: string) =>
    [
      ...(BUFF_DURATION_TALENT_MODIFIERS[target] ?? []),
      ...(CC_DURATION_TALENT_MODIFIERS[target] ?? []),
    ].some((m) => m.talentSpellId === talent);
  const reachHas = (
    target: string,
    talent: string,
    key: "rangeMods" | "radiusMods",
  ) => (reach[target]?.[key] ?? []).some((m) => m.talent === talent);
  const mitHas = (aura: string, talent: string) =>
    TALENT_MITIGATION_MODIFIERS.some(
      (m) => m.auraSpellId === aura && m.talentSpellId === talent,
    );
  interface Unit {
    talent: string;
    talentName: string;
    className: string;
    source: string;
    path: string;
    hop: number;
    carrier: string;
    carrierName: string;
    activation: string;
    rowId?: string;
    effectIndex: number;
    kind: Kind;
    op?: number;
    opName?: string;
    value: number;
    pvpValue: number;
    target: string;
    targetName: string;
    via: string;
    targetTables: string[];
    targetObserved: boolean;
    pickRate: number | null;
    status: string;
    reason?: string;
  }
  const units: Unit[] = [];
  const seen = new Set<string>();
  for (const e of inv.edges) {
    for (const r of rowsBySpell.get(e.spellId) ?? []) {
      const k = kindOf(r);
      if (!k) continue;
      const info = talentInfo.get(e.talentSpellId);
      const specIds = e.specIds ?? info?.specIds;
      const targets = r.targets.length
        ? r.targets
        : k.kind === "procTrigger" || k.kind === "replace"
          ? []
          : [{ spellId: "(unresolved)", via: "none" }];
      for (const t of targets) {
        const key = `${e.talentSpellId}|${r.rowId ?? r.spellId + ":" + r.effectIndex}|${t.spellId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const pvpValue =
          Math.round(r.basePoints * r.pvpMultiplier * 1000) / 1000;
        let status = "noConsumer";
        let reason: string | undefined;
        const tal = e.talentSpellId;
        const carrierIsTalent = e.hop === 0;
        // the inventory keeps only tracked targets: a category / mask whose
        // spells are all untracked resolves to nothing — no product fact
        const untracked = t.spellId === "(unresolved)";
        switch (untracked ? "untracked" : k.kind) {
          case "untracked":
            status = "noTrackedTarget";
            break;
          case "cooldown":
          case "charges": {
            // Row identity, not talent presence (agy verify 2026-09-26): the
            // same talent may be registered on the target for ANOTHER row
            // (charge row in, cooldown row missing) — that must stay a gap.
            const rowMods = (CD_TALENT_MODIFIERS[t.spellId] ?? []).filter(
              (m) => m.sourceRowId !== undefined && m.sourceRowId === r.rowId,
            );
            const ok = rowMods.length > 0;
            status = ok ? "consumed" : "gap";
            if (
              !ok &&
              (cdHas(t.spellId, tal) ||
                (!carrierIsTalent && cdHas(t.spellId, e.spellId)))
            ) {
              // compileCooldownModifiers' one-effect-two-mechanisms rule keeps
              // ONE of two same-value rows (mask vs charge category): the
              // dropped twin is consumed through the kept one
              const mag =
                Math.abs(pvpValue) > 500
                  ? Math.abs(pvpValue) / 1000
                  : Math.abs(pvpValue);
              const twin = (CD_TALENT_MODIFIERS[t.spellId] ?? []).some(
                (m) =>
                  (m.talentSpellId === tal || m.talentSpellId === e.spellId) &&
                  Math.abs(Math.abs(m.value) - mag) < 1e-6,
              );
              if (twin) status = "consumed";
              else reason = "talent registered on target, but for another row";
            }
            if (!ok && !reason)
              reason =
                pvpValue === 0 && k.kind === "cooldown"
                  ? "pvpMultiplier 0 / base 0 (off in PvP)"
                  : !carrierIsTalent
                    ? `reached via trigger hop ${e.hop} (compiler reads hop 0 only)`
                    : r.activation === "whileAura"
                      ? "carrier is a finite buff (compiler drops whileAura)"
                      : t.spellId === "(unresolved)"
                        ? "no target resolved"
                        : "target untracked or encoding unread";
            if (!ok && pvpValue === 0 && k.kind === "cooldown")
              status = "offInPvp";
            break;
          }
          case "duration":
            status = durHas(t.spellId, tal) ? "consumed" : "gap";
            if (status === "gap")
              reason =
                pvpValue === 0
                  ? "value 0 (scripted amount or off in PvP)"
                  : "not in duration hand tables";
            break;
          case "range":
          case "radius":
            status = reachHas(
              t.spellId,
              tal,
              k.kind === "range" ? "rangeMods" : "radiusMods",
            )
              ? "consumed"
              : "gap";
            break;
          case "value":
            if (MITIGATION_TABLE[t.spellId]) {
              status = mitHas(t.spellId, tal) ? "consumed" : "gap";
              if (status === "gap")
                reason =
                  "value mod on a MITIGATION_TABLE aura (check effect index carries the reduction)";
            } else status = "noConsumer";
            break;
          case "replace":
            status = "replace";
            break;
          default:
            status = "noConsumer";
        }
        // Not consumed, but not a permanent change either: a finite-buff
        // carrier only holds while the buff is up, a trigger-hop row is
        // applied by a proc/cast — both are separate questions from "the
        // talent's standing effect is missing".
        if (status === "gap" || status === "noConsumer") {
          if (r.activation === "whileAura" && k.kind !== "replace")
            status = "conditional";
          else if (!carrierIsTalent) status = "triggered";
        }
        const triggered = k.kind === "procTrigger" ? String(r.misc0 || "") : "";
        units.push({
          talent: tal,
          talentName: info
            ? `${info.zh} / ${info.en}`
            : `${zh[tal] ?? ""} / ${en[tal] ?? ""}`,
          className: info?.className ?? String(e.classId),
          source: info?.source ?? e.path,
          path: e.path,
          hop: e.hop,
          carrier: e.spellId,
          carrierName: `${zh[e.spellId] ?? ""} / ${en[e.spellId] ?? ""}`,
          activation: r.activation,
          rowId: r.rowId,
          effectIndex: r.effectIndex,
          kind: k.kind,
          op: k.op,
          opName:
            k.op !== undefined ? (OP_NAME[k.op] ?? `op${k.op}`) : undefined,
          value: r.basePoints,
          pvpValue,
          target: t.spellId || triggered,
          targetName: `${zh[t.spellId] ?? ""} / ${en[t.spellId] ?? ""}`,
          via: t.via,
          targetTables: tablesOf.get(t.spellId) ?? [],
          targetObserved: observed.has(t.spellId),
          pickRate: pickRateOf(tal, specIds),
          status,
          reason,
        });
      }
    }
  }

  // replace rows: resolve against the consumers once per (talent, carrier row)
  for (const u of units)
    if (u.kind === "replace") {
      const targets = Object.entries(CD_TALENT_MODIFIERS)
        .filter(([, ms]) =>
          ms.some(
            (m) => m.talentSpellId === u.talent && m.effect === "replace_spell",
          ),
        )
        .map(([k]) => k);
      u.status =
        targets.length || TALENT_REPLACES[u.talent] ? "consumed" : "gap";
      if (u.status === "consumed")
        u.target =
          targets.join(",") || (TALENT_REPLACES[u.talent] ?? []).join(",");
    }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, "structured.json"),
    JSON.stringify({ build: inv._meta.build, units }, null, 1),
  );

  // summary: kind × status, and the relevant gaps (target named by a product table, observed, holder share ≥ 5 %)
  const tally: Record<string, Record<string, number>> = {};
  for (const u of units) {
    const row = (tally[u.kind] ??= {});
    row[u.status] = (row[u.status] ?? 0) + 1;
  }
  const relevantGap = (u: Unit) =>
    (u.status === "gap" || u.status === "noConsumer") &&
    u.targetTables.length > 0 &&
    u.targetObserved &&
    (u.pickRate ?? 1) >= 0.05;
  const lines: string[] = [
    `# Talent impact audit — structured half (${inv._meta.build})`,
    "",
    "## kind × status",
    "",
  ];
  lines.push(
    "| kind | " +
      [
        "consumed",
        "gap",
        "noConsumer",
        "conditional",
        "triggered",
        "offInPvp",
      ].join(" | ") +
      " |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const [k, v] of Object.entries(tally))
    lines.push(
      `| ${k} | ${["consumed", "gap", "noConsumer", "conditional", "triggered", "offInPvp", "noTrackedTarget"].map((s) => v[s] ?? 0).join(" | ")} |`,
    );
  lines.push("", "## gaps by reason", "");
  const byReason: Record<string, number> = {};
  for (const u of units)
    if (u.status === "gap")
      byReason[`${u.kind}: ${u.reason ?? "-"}`] =
        (byReason[`${u.kind}: ${u.reason ?? "-"}`] ?? 0) + 1;
  for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1]))
    lines.push(`- ${v} × ${k}`);
  const rel = units.filter(relevantGap);
  lines.push(
    "",
    `## relevant gaps / unconsumed (target in a product table, observed, pick ≥ 5 %): ${rel.length}`,
    "",
  );
  const relTally: Record<string, number> = {};
  for (const u of rel)
    relTally[`${u.kind}${u.opName ? "/" + u.opName : ""} ${u.status}`] =
      (relTally[`${u.kind}${u.opName ? "/" + u.opName : ""} ${u.status}`] ??
        0) + 1;
  for (const [k, v] of Object.entries(relTally).sort((a, b) => b[1] - a[1]))
    lines.push(`- ${v} × ${k}`);
  writeFileSync(join(OUT, "structured.md"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
}

void main();
