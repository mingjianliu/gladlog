/**
 * talentScriptedTriage.ts — GH #96 M6: sort the talents that no compiler can
 * read into review queues by the product fact they could touch.
 *
 * Why: the talent catalog (talentCatalog.ts) found talents with no structured
 * DB2 modifier (no aura 107/108 SpellMod row) and no code reference — their
 * effect lives in server scripts, so D2's typed compilers can never see them.
 * Some of them change facts the coach asserts (Guided Prayer is a free heal
 * below 25 % HP; Delay Harm absorbs part of Time Dilation's delayed damage).
 * This is TRIAGE, not a verdict: the buckets come from keyword rules on the
 * resolved zhCN description and only decide which queue a talent waits in.
 * Pick rate (COMBATANT_INFO) orders each queue; `observed` says whether any
 * spell id tied to the talent ever appears in the corpus logs, i.e. whether a
 * consumer could even see it act.
 *
 * Buckets (first match in this order is the primary queue; all matches are kept):
 *  protection  damage taken reduced / absorb / immune / max HP / heal received / cheat death / low-HP trigger
 *  cc          stun, fear, polymorph, silence, root, incapacitate, disorient, interrupt, knockback
 *  cooldown    cooldown / charges
 *  duration    lasts longer / extends
 *  dispel      dispel / remove effects
 *  mobility    movement speed / teleport / charge
 *  healing     healing done
 *  damage      damage done
 *  resource    power types
 *  stat        haste / crit / mastery / versatility / armor
 *  other
 *
 * Usage: npx tsx packages/eval/scripts/talentScriptedTriage.ts
 * Input:  $GLADLOG_EVAL_HOME/reports/talent-catalog-2026-09-13/{catalog,pickrates}.json
 * Output: $GLADLOG_EVAL_HOME/reports/talent-integration-2026-09-13/scriptedTriage.{json,md}
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const home =
  process.env.GLADLOG_EVAL_HOME ??
  join(process.env.HOME ?? "", "code/gladlog-eval-private");
const cat = JSON.parse(
  readFileSync(
    join(home, "reports/talent-catalog-2026-09-13/catalog.json"),
    "utf8",
  ),
) as { rows: any[] };
const picks = JSON.parse(
  readFileSync(
    join(home, "reports/talent-catalog-2026-09-13/pickrates.json"),
    "utf8",
  ),
) as {
  bySpec: Record<
    string,
    { loadouts: number; auto: string[]; tree: Record<string, number> }
  >;
};

const BUCKETS: Array<[string, RegExp]> = [
  [
    "protection",
    // self-directed wording only: "伤害降低" alone also matches AoE falloff
    // ("目标超过5个时伤害降低") and execute talents ("对生命值低于35%的敌人")
    /受到的(所有|魔法|物理|范围攻击)?(伤害|魔法伤害|物理伤害)(降低|减少)|对你造成的(所有)?伤害降低|吸收|护盾|免疫|最大生命值(提高|增加)|受到的治疗|受到致命伤害|防止.{0,6}死亡|你的生命值(降低|低于|下降)/,
  ],
  ["cc", /昏迷|恐惧|变形|沉默|定身|缠绕|瘫痪|迷惑|打断|击退|无法施法|失控/],
  ["cooldown", /冷却时间|充能/],
  ["duration", /持续时间(延长|提高|增加)|延长.{0,6}秒/],
  ["dispel", /驱散|移除.{0,8}(效果|魔法|诅咒|疾病|中毒)/],
  ["mobility", /移动速度|传送|冲锋|跳跃/],
  ["healing", /治疗(量|效果)|恢复.{0,10}生命值/],
  ["damage", /伤害(提高|增加)|造成.{0,20}伤害/],
  [
    "resource",
    /法力值|能量|怒气|符文能量|连击点|神圣能量|灵魂碎片|真气|集中值|狂怒|星界能量|漩涡|精华|痛苦值|恶魔之怒/,
  ],
  ["stat", /急速|爆击|精通|全能|护甲/],
];

function pickRate(t: any): number {
  let best = 0;
  for (const s of t.specIds ?? []) {
    const spec = picks.bySpec[String(s)];
    if (!spec || !spec.loadouts) continue;
    if (spec.auto?.includes(t.id)) return 1;
    best = Math.max(best, (spec.tree?.[t.id] ?? 0) / spec.loadouts);
  }
  return best;
}

const scripted = cat.rows.filter((t) => !(t.modsRaw?.length > 0) && !t.inCode);
const rows = scripted.map((t) => {
  const text = `${t.description ?? ""}`;
  const buckets = BUCKETS.filter(([, re]) => re.test(text)).map(([b]) => b);
  return {
    id: t.id,
    zh: t.zh,
    en: t.en,
    className: t.className,
    specIds: t.specIds,
    source: t.source,
    hero: t.hero,
    entryType: t.node?.entryType ?? null,
    primary: buckets[0] ?? "other",
    buckets,
    pickRate: Math.round(pickRate(t) * 1000) / 1000,
    observed: (t.observed?.length ?? 0) > 0,
    description: text.replace(/\s+/g, " ").slice(0, 200),
  };
});

const CONSUMER: Record<string, string> = {
  protection:
    "crisis-no-response / mitigation / counterfactual / kill attempts",
  cc: "CC tables, DR, cc-break, kick priority",
  cooldown: "cooldown ledger (cd-hoarded, sync windows)",
  duration: "buff / CC duration",
  dispel: "dispel analysis",
  mobility: "kite / positioning",
  healing: "not consumed as a fact (throughput)",
  damage: "not consumed as a fact (throughput)",
  resource: "not consumed",
  stat: "not consumed",
  other: "unclassified",
};

const byPrimary = new Map<string, typeof rows>();
for (const r of rows) {
  const list = byPrimary.get(r.primary) ?? [];
  list.push(r);
  byPrimary.set(r.primary, list);
}
const order = [...BUCKETS.map(([b]) => b), "other"];
const outDir = join(home, "reports/talent-integration-2026-09-13");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "scriptedTriage.json"),
  JSON.stringify({ total: rows.length, rows }, null, 1),
);

const md: string[] = [
  `# Scripted-talent triage (GH #96 M6)`,
  ``,
  `${rows.length} talents with no DB2 SpellMod row and no code reference. Keyword triage on the zhCN description — a queue, not a verdict. Pick rate = max share of loadouts across the talent's specs (COMBATANT_INFO, 34k loadouts).`,
  ``,
  `| Queue | Talents | ≥ 50 % pick | Observed in logs | Consumer that could care |`,
  `| --- | --- | --- | --- | --- |`,
];
for (const b of order) {
  const list = byPrimary.get(b) ?? [];
  md.push(
    `| ${b} | ${list.length} | ${list.filter((r) => r.pickRate >= 0.5).length} | ${list.filter((r) => r.observed).length} | ${CONSUMER[b]} |`,
  );
}
for (const b of ["protection", "cc", "cooldown", "duration", "dispel"]) {
  const list = (byPrimary.get(b) ?? []).sort((x, y) => y.pickRate - x.pickRate);
  md.push(``, `## ${b} (${list.length}) — top 40 by pick rate`, ``);
  md.push(`| Talent | Class | Source | Pick | Observed | Description |`);
  md.push(`| --- | --- | --- | --- | --- | --- |`);
  for (const r of list.slice(0, 40))
    md.push(
      `| ${r.zh} ${r.en ?? ""} ${r.id} | ${r.className} | ${r.source}${r.hero ? ` ${r.hero}` : ""} | ${Math.round(r.pickRate * 100)} % | ${r.observed ? "yes" : "no"} | ${r.description.replace(/\|/g, "/")} |`,
    );
}
writeFileSync(join(outDir, "scriptedTriage.md"), md.join("\n"));
console.log(md.slice(0, 16).join("\n"));
