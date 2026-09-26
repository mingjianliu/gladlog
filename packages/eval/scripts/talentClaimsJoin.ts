/**
 * talentClaimsJoin.ts — the JOIN step of the 2026-09-26 talent impact audit:
 * the reading pass's per-talent claims (what each talent's tooltip says it
 * does, one entry per (target, change)) × what the product code carries.
 *
 * Reading pass: $OUT/claims/*.jsonl (method/READER.md). Targets are spell
 * NAMES as the tooltip writes them; this script resolves them to ids
 * deterministically (zhCN / English name index), never trusting a reader id.
 *
 * Coverage per claim kind:
 *   static cooldown / charges        CD_TALENT_MODIFIERS[target] has the talent
 *   cooldownOnEvent / cooldownReset  cdRecastFloorGenerated has the spell (dynamic
 *                                    floor), CORPUS_COOLDOWN_PATCHES has it, or the
 *                                    talent id is referenced in product code
 *   duration                         BUFF / CC_DURATION_TALENT_MODIFIERS name the talent
 *   value (defensive)                TALENT_MITIGATION_MODIFIERS (aura, talent)
 *   everything else                  talent id referenced in product code
 * "referenced" means the id appears somewhere in product code — a lead that the
 * effect MAY be handled, not proof; "none" means nothing names it.
 *
 * Usage: npx tsx packages/eval/scripts/talentClaimsJoin.ts [--out <audit dir>]
 * Output: $OUT/joined.json, $OUT/review.md
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { CURATED_ID_TABLES } from "@gladlog/analysis/src/data/curatedIdRegistry";
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { MITIGATION_TABLE } from "@gladlog/analysis/src/data/mitigationData";
import {
  BUFF_DURATION_TALENT_MODIFIERS,
  CC_DURATION_TALENT_MODIFIERS,
} from "@gladlog/analysis/src/data/spellEffectData";
import { CORPUS_COOLDOWN_PATCHES } from "@gladlog/analysis/src/data/spellEffectOverrides";
import { TALENT_MITIGATION_MODIFIERS } from "@gladlog/analysis/src/data/talentMitigationModifiers";
import { CD_TALENT_MODIFIERS } from "@gladlog/analysis/src/utils/talentModifiers";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const HOME =
  process.env.GLADLOG_EVAL_HOME ??
  join(process.env.HOME ?? "", "code/gladlog-eval-private");
const OUT = arg("--out", join(HOME, "reports/talent-impact-audit-2026-09-26"));
const PICKS = arg(
  "--picks",
  join(HOME, "reports/talent-catalog-2026-09-13/pickrates.json"),
);
const DATA = resolve("packages/analysis/src/data");

interface Effect {
  target?: string;
  targetEn?: string;
  kind?: string;
  change?: string;
  value?: string | null;
  condition?: string;
  dynamic?: boolean;
  db2?: string;
  coachFact?: string;
}

const STATIC_CD = new Set([
  "cooldownFlat",
  "cooldownPct",
  "cooldownRate",
  "charges",
]);
const DYNAMIC_CD = new Set(["cooldownOnEvent", "cooldownReset"]);
const COACH_PRIORITY: Record<string, number> = {
  cooldownAvailability: 0,
  defensive: 1,
  ccEscape: 2,
  cc: 3,
  interrupt: 4,
  dispel: 5,
  healing: 6,
  mobility: 7,
  damage: 8,
  resource: 9,
  none: 10,
};

async function main(): Promise<void> {
  await ensureAnalysisData();
  const zh = JSON.parse(
    readFileSync(join(DATA, "spellNamesZhGenerated.json"), "utf8"),
  ) as Record<string, string>;
  const en = JSON.parse(
    readFileSync(join(DATA, "spellNames.json"), "utf8"),
  ) as Record<string, string>;
  const observed = new Set(
    (
      JSON.parse(
        readFileSync(join(DATA, "observedSpellIdsGenerated.json"), "utf8"),
      ) as number[]
    ).map(String),
  );
  const floors = JSON.parse(
    readFileSync(join(DATA, "cdRecastFloorGenerated.json"), "utf8"),
  ).floors as Record<string, unknown>;
  const floorSpells = new Set(Object.keys(floors).map((k) => k.split("|")[0]!));
  const catalog = JSON.parse(
    readFileSync(join(OUT, "catalog/catalog.json"), "utf8"),
  ).rows as Array<{
    id: string;
    zh: string;
    en: string;
    className: string;
    specIds: number[];
    source: string;
    code: Array<{
      id: string;
      self: boolean;
      tables: string[];
      files: string[];
    }>;
  }>;
  const talentInfo = new Map(catalog.map((c) => [c.id, c]));
  const picks = JSON.parse(readFileSync(PICKS, "utf8")).bySpec as Record<
    string,
    { loadouts: number; tree: Record<string, number>; auto?: string[] }
  >;
  const pickRateOf = (talent: string, specIds: number[]): number | null => {
    let n = 0;
    let d = 0;
    for (const s of specIds) {
      const p = picks[String(s)];
      if (!p) continue;
      n += p.tree[talent] ?? (p.auto?.includes(talent) ? p.loadouts : 0);
      d += p.loadouts;
    }
    return d ? Math.round((n / d) * 1000) / 1000 : null;
  };

  // product relevance index
  const tablesOf = new Map<string, string[]>();
  const note = (id: string, name: string) => {
    const l = tablesOf.get(id) ?? [];
    if (!l.includes(name)) l.push(name);
    tablesOf.set(id, l);
  };
  for (const t of CURATED_ID_TABLES) for (const id of t.ids()) note(id, t.name);
  for (const id of Object.keys(MITIGATION_TABLE)) note(id, "MITIGATION_TABLE");
  for (const id of Object.keys(CD_TALENT_MODIFIERS)) note(id, "cooldownModel");

  // name → ids
  const norm = (s: string) =>
    s
      .replace(/[（(].*?[）)]/g, "")
      .replace(/[「」“”"'\s]/g, "")
      .trim();
  const byZh = new Map<string, string[]>();
  for (const [id, n] of Object.entries(zh)) {
    const k = norm(n);
    if (!k) continue;
    (byZh.get(k) ?? byZh.set(k, []).get(k)!).push(id);
  }
  const byEn = new Map<string, string[]>();
  for (const [id, n] of Object.entries(en)) {
    const k = n.toLowerCase().trim();
    if (!k) continue;
    (byEn.get(k) ?? byEn.set(k, []).get(k)!).push(id);
  }
  const resolveIds = (e: Effect): string[] => {
    const cands = new Set<string>();
    if (e.target)
      for (const id of byZh.get(norm(e.target)) ?? []) cands.add(id);
    if (e.targetEn)
      for (const id of byEn.get(e.targetEn.toLowerCase().trim()) ?? [])
        cands.add(id);
    // keep ids the product or the corpus knows; a name with thousands of
    // homonyms (e.g. "治疗") is pruned to those
    const known = [...cands].filter(
      (id) => tablesOf.has(id) || observed.has(id),
    );
    return (known.length ? known : [...cands]).slice(0, 40);
  };

  const talentReferenced = (talent: string): string[] => {
    const info = talentInfo.get(talent);
    const self = info?.code.find((c) => c.id === talent && c.self);
    if (!self) return [];
    return [
      ...self.tables,
      ...self.files.filter(
        (f) =>
          !/Generated\.(json|ts)$/.test(f) ||
          /talentModifiers|talentMitigation|talentReplaces|spellReach/.test(f),
      ),
    ];
  };

  const files = readdirSync(join(OUT, "claims")).filter(
    (f) => f.endsWith(".jsonl") && !f.startsWith("CALIBRATION"),
  );
  interface Joined {
    talent: string;
    talentZh: string;
    talentEn: string;
    className: string;
    source: string;
    pick: number | null;
    effect: Effect;
    ids: string[];
    tables: string[];
    relevant: boolean;
    status: "covered" | "referenced" | "none" | "unresolved";
    evidence: string;
  }
  const out: Joined[] = [];
  let talents = 0;
  for (const f of files) {
    for (const line of readFileSync(join(OUT, "claims", f), "utf8").split(
      "\n",
    )) {
      if (!line.trim()) continue;
      const c = JSON.parse(line) as {
        id: string;
        zh: string;
        effects: Effect[];
      };
      talents++;
      const info = talentInfo.get(c.id);
      const pick = info ? pickRateOf(c.id, info.specIds) : null;
      const refs = talentReferenced(c.id);
      for (const e of c.effects ?? []) {
        const selfTarget =
          !e.target || /^(self|ally|enemy|自身|你)$/.test(e.target);
        const ids = selfTarget ? [] : resolveIds(e);
        const tables = [
          ...new Set(ids.flatMap((id) => tablesOf.get(id) ?? [])),
        ];
        let status: Joined["status"] = "none";
        let evidence = "";
        const kind = e.kind ?? "other";
        if (!selfTarget && ids.length === 0) status = "unresolved";
        if (STATIC_CD.has(kind)) {
          const hit = ids.find((id) =>
            (CD_TALENT_MODIFIERS[id] ?? []).some(
              (m) => m.talentSpellId === c.id,
            ),
          );
          if (hit) {
            status = "covered";
            evidence = `cooldownModel[${hit}]`;
          }
        } else if (DYNAMIC_CD.has(kind)) {
          const fl = ids.find((id) => floorSpells.has(id));
          const pa = ids.find((id) => CORPUS_COOLDOWN_PATCHES[id]);
          if (fl) {
            status = "covered";
            evidence = `recastFloor[${fl}]`;
          } else if (pa) {
            status = "covered";
            evidence = `corpusCooldownPatch[${pa}]`;
          }
        } else if (kind === "duration") {
          const all = [
            ...Object.entries(BUFF_DURATION_TALENT_MODIFIERS),
            ...Object.entries(CC_DURATION_TALENT_MODIFIERS),
          ];
          const hit = all.find(([, ms]) =>
            ms.some((m) => m.talentSpellId === c.id),
          );
          if (hit) {
            status = "covered";
            evidence = `durationTable[${hit[0]}]`;
          }
        } else if (kind === "value") {
          const hit = TALENT_MITIGATION_MODIFIERS.find(
            (m) => m.talentSpellId === c.id,
          );
          if (hit) {
            status = "covered";
            evidence = `talentMitigation[${hit.auraSpellId}]`;
          }
        }
        if (status !== "covered" && refs.length) {
          status = status === "unresolved" ? "unresolved" : "referenced";
          evidence = refs.slice(0, 6).join(",");
        }
        out.push({
          talent: c.id,
          talentZh: c.zh,
          talentEn: info?.en ?? "",
          className: info?.className ?? f.replace(/-\d+\.jsonl$/, ""),
          source: info?.source ?? "",
          pick,
          effect: e,
          ids,
          tables,
          relevant:
            tables.length > 0 &&
            (COACH_PRIORITY[e.coachFact ?? "none"] ?? 10) <= 5,
          status,
          evidence,
        });
      }
    }
  }
  writeFileSync(join(OUT, "joined.json"), JSON.stringify(out, null, 1));

  // summary + review queue
  const lines: string[] = [
    `# Talent claims × code (reading pass join)`,
    "",
    `talents read: ${talents}; effects: ${out.length}`,
    "",
    "## kind × status (all effects)",
    "",
    "| kind | covered | referenced | none | unresolved |",
    "|---|---|---|---|---|",
  ];
  const tally: Record<string, Record<string, number>> = {};
  for (const j of out) {
    const k = j.effect.kind ?? "other";
    const row = (tally[k] ??= {});
    row[j.status] = (row[j.status] ?? 0) + 1;
  }
  for (const [k, v] of Object.entries(tally).sort())
    lines.push(
      `| ${k} | ${v.covered ?? 0} | ${v.referenced ?? 0} | ${v.none ?? 0} | ${v.unresolved ?? 0} |`,
    );
  const queue = out
    .filter(
      (j) => j.relevant && j.status !== "covered" && (j.pick ?? 1) >= 0.05,
    )
    .sort(
      (a, b) =>
        (COACH_PRIORITY[a.effect.coachFact ?? "none"] ?? 10) -
          (COACH_PRIORITY[b.effect.coachFact ?? "none"] ?? 10) ||
        (b.pick ?? 0) - (a.pick ?? 0),
    );
  lines.push(
    "",
    `## review queue: coach-relevant (cooldown / defensive / ccEscape / cc / interrupt / dispel), target in a product table, not covered, pick ≥ 5 %: ${queue.length}`,
    "",
  );
  const qt: Record<string, number> = {};
  for (const j of queue)
    qt[`${j.effect.coachFact} / ${j.effect.kind} / ${j.status}`] =
      (qt[`${j.effect.coachFact} / ${j.effect.kind} / ${j.status}`] ?? 0) + 1;
  for (const [k, v] of Object.entries(qt).sort((a, b) => b[1] - a[1]))
    lines.push(`- ${v} × ${k}`);
  lines.push(
    "",
    "| class | talent | pick | kind | target → ids | change | value | condition | status | evidence |",
    "|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const j of queue)
    lines.push(
      `| ${j.className} | ${j.talentZh} ${j.talent} | ${j.pick ?? "?"} | ${j.effect.kind} | ${j.effect.target} → ${j.ids.slice(0, 4).join(",")} | ${j.effect.change ?? ""} | ${j.effect.value ?? ""} | ${j.effect.condition ?? ""} | ${j.status} | ${j.evidence} |`,
    );
  writeFileSync(join(OUT, "review.md"), lines.join("\n") + "\n");
  console.log(lines.slice(0, 40).join("\n"));
  if (!existsSync(join(OUT, "claims"))) process.exit(1);
}

void main();
