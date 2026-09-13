/**
 * talentProtectionScan.ts — every talent (class / spec / hero / PvP) that adds
 * protection: damage reduction, absorbs, max health, self-healing, healing
 * received, cheat-death, or a buff to an existing defensive cooldown.
 *
 * User 2026-09-13 (GH #95 follow-up): "帮我扫一下所有的天赋，包括英雄天赋，
 * 看一下有没有什么技能是可以点完以后加了额外减伤或者额外回血的" — e.g.
 * Restoration Shaman's 自然守护者 (Nature's Guardian: heal 20 % max HP when
 * dropping low) is not damage reduction but works like a wall.
 *
 * Why a new scan: `genTalentMitigation.ts` covers ONLY "damage taken reduced"
 * (tooltip predicate, 67 hits over a 3,491-spell universe). Absorbs, max HP,
 * heals and defensive-CD modifiers were never asked. Same universe
 * (`buildTalentUniverse`), two independent nets per talent:
 *
 *  1. DB2 effects over the talent's LINKED spells — the talent id, every
 *     `EffectTriggerSpell` it names (two hops), and every spell id its zhCN
 *     tooltip references (`$12345s1`). The genTalentMitigation header records
 *     why linking matters: the number usually lives on a separate buff.
 *       dr           aura 87 with negative points
 *       absorb       aura 69
 *       maxHealth    aura 133 / 34 / 230 with positive points
 *       selfHeal     effect 10 (heal) / 136 (heal pct), aura 8 / 20 (periodic)
 *       healTaken    aura 118 with positive points
 *       defMod       aura 107 / 108 whose class mask covers a defensive
 *                    cooldown (MITIGATION_TABLE ∪ big/external lists ∪
 *                    NO_MITIGATION_IDS walls) of the same class set
 *  2. zhCN tooltip keywords (受到的伤害降低 / 吸收 / 生命值上限 / 恢复…生命值 /
 *     受到的治疗 / 致命).
 *
 * Every row carries which nets hit, so db2-only and tooltip-only rows can be
 * audited. Positive control: 30884 自然守护者 must be flagged selfHeal.
 *
 * Nothing ships; this is a list for the user to rule on.
 *
 * Baseline 2026-09-13 (build 12.1.0.69587): 376 of 3,491 talents flagged,
 * 32 of them the defensive cooldown itself. Excluding those (344):
 * dr 91, selfHeal 88, absorb 86, defMod 65, maxHealth 28, healTaken 22,
 * cheatDeath 5. By source: class 140 / spec 151 / hero 55 / pvp 30.
 * Positive control 30884 自然守护者 → 31616 effect 136 (heal % max HP).
 * Precision fixes after a sample read: 致命一击 (crit) is not cheat-death,
 * 「对吸收护盾造成」 is breaking an enemy shield, heals must target the caster.
 *
 * Usage:
 *   DATAGEN_BUILD=12.1.0.69587 DATAGEN_CACHE=~/.cache/gladlog-datagen \
 *     npx tsx packages/eval/scripts/talentProtectionScan.ts
 * Output: $GLADLOG_EVAL_HOME/reports/talent-protection-2026-09-13/{scan.json,scan.md}
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildTalentUniverse } from "@gladlog/analysis/scripts/datagen/genTalentMitigation";
import { pvpBasePoints } from "@gladlog/analysis/scripts/datagen/lib/pvpMultiplier";
import {
  applyHotfixOverlay,
  loadHotfixOverlay,
} from "@gladlog/analysis/scripts/datagen/lib/simcHotfix";
import {
  fetchTable,
  parseCsv,
} from "@gladlog/analysis/scripts/datagen/lib/wagoCsv";
import {
  MITIGATION_TABLE,
  NO_MITIGATION_IDS,
} from "@gladlog/analysis/src/data/mitigationData";
import { PVP_TALENT_POOL_GENERATED } from "@gladlog/analysis/src/data/pvpTalentPoolGenerated";
import spellIdLists from "@gladlog/analysis/src/data/spellIdLists";

import { SPEC_NAMES_ZH } from "../../desktop/src/renderer/src/report/data/specNames";

type Cat =
  | "dr"
  | "absorb"
  | "maxHealth"
  | "selfHeal"
  | "healTaken"
  | "defMod"
  | "cheatDeath";

const TOOLTIP: Array<[Cat, RegExp]> = [
  ["dr", /受到的?伤害(降低|减少|下降)|承受的伤害(降低|减少)|伤害减免/],
  // not 「对吸收护盾造成额外伤害」 (breaking an enemy's shield)
  ["absorb", /(?<!对)吸收.{0,12}伤害|(为你|使你|你获得|提供).{0,12}护盾/],
  ["maxHealth", /生命值上限|最大生命值(提高|增加)/],
  ["selfHeal", /(为你|使你|你)(恢复|回复).{0,20}生命值|治疗你/],
  ["healTaken", /受到的治疗(效果)?(提高|增加)/],
  // 致命一击 is a critical strike, not lethal damage
  ["cheatDeath", /致命伤害|免于一死|免于死亡|不会(被杀死|死亡)|原本会杀死你/],
];

async function main(): Promise<void> {
  const build = process.env.DATAGEN_BUILD ?? "12.1.0.69587";
  const cache = process.env.DATAGEN_CACHE;
  const dataDir = new URL("../../analysis/src/data/", import.meta.url).pathname;
  const specs = JSON.parse(readFileSync(`${dataDir}talentIdMap.json`, "utf8"));
  const zhNames = JSON.parse(
    readFileSync(`${dataDir}spellNamesZhGenerated.json`, "utf8"),
  ) as Record<string, string>;
  const specName = new Map<number, string>(
    specs.map((s: any) => [
      s.specId,
      SPEC_NAMES_ZH[`${s.specName} ${s.className}`] ??
        `${s.className}/${s.specName}`,
    ]),
  );
  const classOfSpec = new Map<number, string>(
    specs.map((s: any) => [s.specId, s.className]),
  );
  const universe = buildTalentUniverse(specs, PVP_TALENT_POOL_GENERATED);

  const spellRows = parseCsv(
    await fetchTable("Spell", build, cache, "zhCN"),
  ).rows;
  const desc = new Map<string, string>();
  for (const r of spellRows) {
    const t = [r.Description_lang, r.AuraDescription_lang]
      .filter(Boolean)
      .join(" ");
    if (t) desc.set(r.ID, t);
  }

  const eff = parseCsv(await fetchTable("SpellEffect", build, cache));
  applyHotfixOverlay(
    eff.rows,
    loadHotfixOverlay(
      new URL("../../analysis/src/data/", import.meta.url).pathname,
    ),
  );
  type Row = {
    idx: number;
    effect: string;
    aura: string;
    pts: number;
    misc0: string;
    trigger: string;
    mask: number[];
    target: string;
  };
  const effects = new Map<string, Row[]>();
  for (const r of eff.rows) {
    if (r.DifficultyID !== "0") continue;
    const list = effects.get(r.SpellID) ?? [];
    list.push({
      idx: Number(r.EffectIndex),
      effect: r.Effect,
      aura: r.EffectAura,
      pts: pvpBasePoints(r),
      misc0: r.EffectMiscValue_0,
      trigger: r.EffectTriggerSpell,
      target: r.ImplicitTarget_0,
      mask: [0, 1, 2, 3].map(
        (i) => Number(r[`EffectSpellClassMask_${i}`] ?? 0) >>> 0,
      ),
    });
    effects.set(r.SpellID, list);
  }

  const classOpts = new Map<string, { set: number; mask: number[] }>();
  for (const r of parseCsv(await fetchTable("SpellClassOptions", build, cache))
    .rows) {
    classOpts.set(r.SpellID, {
      set: Number(r.SpellClassSet),
      mask: [0, 1, 2, 3].map((i) => Number(r[`SpellClassMask_${i}`]) >>> 0),
    });
  }

  const defensiveIds = new Set<string>([
    ...Object.keys(MITIGATION_TABLE),
    ...NO_MITIGATION_IDS,
    ...spellIdLists.bigDefensiveSpellIds.map(String),
    ...spellIdLists.externalDefensiveSpellIds.map(String),
  ]);
  const defensives = [...defensiveIds]
    .map((id) => ({ id, opt: classOpts.get(id) }))
    .filter((d) => d.opt && d.opt.mask.some((m) => m !== 0));

  const nameOf = (id: string) => zhNames[id] ?? id;
  /** ImplicitTarget 1 = the caster; 0 on an aura row applied by the spell
   * itself is also the carrier. Everything else (allies, party, area, enemy)
   * is tagged "other" so a self-protection list can filter it out. */
  const whoOf = (t: string) =>
    t === "1" || t === "0" || t === "" ? "self" : `t${t}`;
  /** SpellModOp (TrinityCore SharedDefines; op 23 = PointsIndex2 verified
   * 2026-09-13 on Bait and Switch → Cloak effect #3). */
  const OP: Record<string, string> = {
    "0": "value",
    "3": "value#1",
    "8": "value",
    "12": "value#2",
    "23": "value#3",
    "32": "value#4",
    "33": "value#5",
    "22": "periodic value",
    "1": "duration",
    "11": "cooldown",
    "21": "cooldown",
  };
  const REF_RE = /\$\{?\$?(\d{3,})[sSwWdDtTaAmM]\d*/g;

  const rows: any[] = [];
  for (const [id, src] of universe) {
    const tip = desc.get(id) ?? "";
    // linked spells: self, triggers (2 hops), tooltip references
    const linked = new Set<string>([id]);
    for (const m of tip.matchAll(REF_RE)) linked.add(m[1]!);
    for (let hop = 0; hop < 2; hop++) {
      for (const s of [...linked])
        for (const e of effects.get(s) ?? [])
          if (e.trigger && e.trigger !== "0") linked.add(e.trigger);
    }
    const db2 = new Map<Cat, string[]>();
    const add = (c: Cat, note: string) => {
      const l = db2.get(c) ?? [];
      if (!l.includes(note)) l.push(note);
      db2.set(c, l);
    };
    const talentOpt = classOpts.get(id);
    for (const s of linked) {
      for (const e of effects.get(s) ?? []) {
        const tag = `${s === id ? "self" : nameOf(s) + "(" + s + ")"}#${e.idx + 1}`;
        const who = whoOf(e.target);
        if (e.aura === "87" && e.pts < 0)
          add("dr", `${tag} ${e.pts}% [${who}]`);
        if (e.aura === "69") add("absorb", `${tag} [${who}]`);
        if (["133", "34", "230"].includes(e.aura) && e.pts > 0)
          add(
            "maxHealth",
            `${tag} +${e.pts}${e.aura === "133" ? "%" : ""} [${who}]`,
          );
        if ((e.effect === "10" || e.effect === "136") && who === "self")
          add(
            "selfHeal",
            `${tag} ${e.effect === "136" ? e.pts + "% max HP" : "heal"}`,
          );
        if ((e.aura === "8" || e.aura === "20") && who === "self")
          add(
            "selfHeal",
            `${tag} periodic${e.aura === "20" ? " " + e.pts + "%" : ""}`,
          );
        if (e.aura === "118" && e.pts > 0)
          add("healTaken", `${tag} +${e.pts}% [${who}]`);
        if ((e.aura === "107" || e.aura === "108") && e.mask.some((m) => m)) {
          const set = classOpts.get(s)?.set ?? talentOpt?.set;
          for (const d of defensives) {
            if (set !== undefined && d.opt!.set !== set) continue;
            if (!d.opt!.mask.some((m, i) => (m & e.mask[i]!) !== 0)) continue;
            const op = OP[e.misc0];
            if (!op) continue; // range, cost, cast time … not protection
            add("defMod", `${tag} → ${nameOf(d.id)}(${d.id}) ${op} ${e.pts}`);
          }
        }
      }
    }
    const tipHits = TOOLTIP.filter(([, re]) => re.test(tip)).map(([c]) => c);
    const cats = new Set<Cat>([...db2.keys(), ...tipHits]);
    if (!cats.size) continue;
    rows.push({
      id,
      zh: nameOf(id),
      className: classOfSpec.get(src.specIds[0]!) ?? "?",
      // the talent IS a known defensive cooldown (Ice Block, Obsidian Scales…)
      // rather than something that adds protection on top
      isDefensiveItself: defensiveIds.has(id),
      source: src.source,
      specs: src.specIds.map((s) => specName.get(s) ?? String(s)),
      cats: [...cats],
      db2: Object.fromEntries(db2),
      tooltipCats: tipHits,
      tooltip: tip.slice(0, 260),
    });
  }

  const count = (c: Cat) => rows.filter((r) => r.cats.includes(c));
  const both = (c: Cat) =>
    rows.filter((r) => r.db2[c] && r.tooltipCats.includes(c)).length;
  const summary = {
    universe: universe.size,
    rowsWithAnyProtection: rows.length,
    byCategory: Object.fromEntries(
      (
        [
          "dr",
          "absorb",
          "maxHealth",
          "selfHeal",
          "healTaken",
          "defMod",
          "cheatDeath",
        ] as Cat[]
      ).map((c) => [
        c,
        {
          any: count(c).length,
          db2AndTooltip: both(c),
          db2Only: rows.filter((r) => r.db2[c] && !r.tooltipCats.includes(c))
            .length,
          tooltipOnly: rows.filter(
            (r) => !r.db2[c] && r.tooltipCats.includes(c),
          ).length,
        },
      ]),
    ),
    bySource: rows.reduce((a: Record<string, number>, r) => {
      a[r.source] = (a[r.source] ?? 0) + 1;
      return a;
    }, {}),
    positiveControl30884: rows.find((r) => r.id === "30884") ?? null,
  };

  const outDir = join(
    process.env.GLADLOG_EVAL_HOME ??
      join(process.env.HOME ?? "", "code/gladlog-eval-private"),
    "reports/talent-protection-2026-09-13",
  );
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "scan.json"),
    JSON.stringify({ summary, rows }, null, 1),
  );
  console.log(JSON.stringify(summary, null, 1));
}

void main();
