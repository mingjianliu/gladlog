/**
 * talentCatalog.ts — one row per talent in the game (class / spec / hero / PvP):
 * what it does (zhCN tooltip with placeholders resolved to numbers), its
 * official effects (auras, triggers, spell modifiers and the spells they
 * reach), and where the repo references it.
 *
 * User 2026-09-13: "我之前反复说让您把天赋都读明白……能不能我们把所有天赋扫一下，
 * 把每一个具体说明的作用，以及它在代码上的关联和体现都理出来？消不消费先不说，
 * 先把数据先理清楚". This is a data inventory, not a consumer change.
 *
 * Sources (build pinned, same wago cache the datagen scripts use):
 *  - universe: `buildTalentUniverse` (talentIdMap class/spec/hero nodes ∪ the
 *    PvP talent pool) — the same 3,491-spell universe genTalentMitigation uses;
 *    node facts (choice / maxRanks / hero sub-tree) from talentIdMap.json
 *  - Spell (zhCN) descriptions, SpellEffect (+ SimC hotfix overlay, PvP
 *    multiplier kept alongside the base value), SpellMisc → SpellDuration,
 *    SpellRadius, SpellAuraOptions, SpellCooldowns, SpellClassOptions
 *  - code: CURATED_ID_TABLES (hand tables, by name) + a literal-id index over
 *    packages/{analysis,desktop,eval}/src (tests and pure name/icon catalogs
 *    excluded, listed separately as "catalog")
 *  - corpus: observedSpellIdsGenerated.json (talent id or a linked id seen in logs)
 *
 * Usage:
 *   DATAGEN_BUILD=12.1.0.69587 DATAGEN_CACHE=~/.cache/gladlog-datagen \
 *     npx tsx packages/eval/scripts/talentCatalog.ts
 * Output: $GLADLOG_EVAL_HOME/reports/talent-catalog-2026-09-13/catalog.json
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

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
import { CURATED_ID_TABLES } from "@gladlog/analysis/src/data/curatedIdRegistry";
import { PVP_TALENT_POOL_GENERATED } from "@gladlog/analysis/src/data/pvpTalentPoolGenerated";

import { SPEC_NAMES_ZH } from "../../desktop/src/renderer/src/report/data/specNames";

const REPO = new URL("../../../", import.meta.url).pathname;
const DATA = join(REPO, "packages/analysis/src/data/");

/** Files that only NAME or DECORATE ids (a hit there says nothing about
 * behaviour). Reported separately so "referenced in code" means semantics. */
const CATALOG_FILES = [
  "spellNamesZhGenerated.json",
  "spellNames.json",
  "spellIconsGenerated",
  "spellSchoolsGenerated",
  "observedSpellIdsGenerated.json",
  "talentIdMap.json",
  "talentNames.ts",
  "talentStrings.ts",
  "specIconsGenerated.ts",
  "spellManaCostGenerated.json",
  "hotfixOverlayGenerated.json",
  "spellTargetingGenerated",
  // full DB2 mirror (durations, dispel type, cooldowns) for the whole talent
  // universe — a hit there means "the datagen dumped it", not "code uses it"
  "spellEffectGenerated.json",
  "pvpTalentPoolGenerated.ts",
  "pvpTalentReplacesGenerated.ts",
];
const isCatalog = (f: string) => CATALOG_FILES.some((c) => f.includes(c));

const AURA: Record<string, string> = {
  "3": "周期伤害",
  "4": "标记(dummy)",
  "5": "迷惑",
  "7": "恐惧",
  "8": "周期治疗",
  "12": "昏迷",
  "20": "周期治疗(%)",
  "22": "抗性",
  "23": "周期触发",
  "26": "定身",
  "27": "沉默",
  "29": "属性",
  "31": "移速",
  "33": "减速",
  "42": "触发法术",
  "47": "招架",
  "49": "闪避",
  "52": "暴击",
  "60": "缴械/沉默",
  "65": "急速",
  "69": "吸收护盾",
  "79": "造成伤害%",
  "87": "受到伤害%",
  "107": "技能修改(平值)",
  "108": "技能修改(百分比)",
  "118": "受到治疗%",
  "123": "穿透",
  "133": "生命上限%",
  "136": "造成治疗%",
  "166": "攻强%",
  "189": "等级属性",
  "226": "周期标记",
  "231": "带值触发",
  "232": "机制时长",
  "234": "机制时长",
  "332": "替换技能",
  "411": "充能数",
  "453": "充能恢复",
  "454": "充能恢复%",
  "34": "生命上限",
  "230": "生命上限",
  "56": "变形",
  "36": "形态",
  "64": "免疫机制",
  "39": "学派免疫",
  "40": "伤害免疫",
  "77": "机制免疫",
  "184": "近战命中减",
  "186": "法术命中减",
};
const EFFECT: Record<string, string> = {
  "2": "学派伤害",
  "3": "标记",
  "6": "施加光环",
  "10": "治疗",
  "24": "制造物品",
  "29": "冲锋/跳跃",
  "30": "回能",
  "35": "区域光环(团队)",
  "36": "学会技能",
  "38": "驱散",
  "41": "跳跃",
  "42": "跳到目标",
  "53": "附魔",
  "58": "武器伤害",
  "62": "能量燃烧",
  "64": "触发法术",
  "68": "打断",
  "77": "脚本",
  "95": "剥皮",
  "108": "驱散机制",
  "126": "偷取光环",
  "136": "治疗(%)",
  "140": "强制施放",
  "142": "触发带值",
  "144": "击退",
  "145": "拉近",
  "151": "触发(对自己)",
  "164": "移除光环",
  "174": "施加光环(团队)",
  "179": "区域触发",
  "202": "施加光环(区域)",
};
/** SpellModOp (TrinityCore SharedDefines). op 23 = PointsIndex2 checked
 * 2026-09-13 on Bait and Switch → Cloak of Shadows effect #3. */
const OP: Record<string, string> = {
  "0": "伤害/治疗",
  "1": "持续时间",
  "3": "效果1数值",
  "5": "射程",
  "6": "半径",
  "7": "暴击率",
  "8": "全部效果数值",
  "10": "施法时间",
  "11": "冷却",
  "12": "效果2数值",
  "14": "消耗",
  "15": "暴击效果",
  "17": "连锁目标",
  "18": "触发几率",
  "19": "间隔",
  "21": "冷却(起始)",
  "22": "周期伤害/治疗",
  "23": "效果3数值",
  "24": "系数",
  "26": "触发频率",
  "31": "叠层",
  "32": "效果4数值",
  "33": "效果5数值",
};

const fmt = (n: number) =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);

async function main(): Promise<void> {
  const build = process.env.DATAGEN_BUILD ?? "12.1.0.69587";
  const cache = process.env.DATAGEN_CACHE;
  const load = async (t: string, loc?: string) =>
    parseCsv(await fetchTable(t, build, cache, loc)).rows;

  const specs = JSON.parse(
    readFileSync(join(DATA, "talentIdMap.json"), "utf8"),
  );
  const zhNames = JSON.parse(
    readFileSync(join(DATA, "spellNamesZhGenerated.json"), "utf8"),
  ) as Record<string, string>;
  const observed = new Set(
    (
      JSON.parse(
        readFileSync(join(DATA, "observedSpellIdsGenerated.json"), "utf8"),
      ) as Array<string | number>
    ).map(String),
  );
  const universe = buildTalentUniverse(specs, PVP_TALENT_POOL_GENERATED);

  // ── node facts: choice / ranks / hero sub-tree, per spell id ───────────────
  const node = new Map<
    string,
    {
      en: string;
      kind: string;
      maxRanks: number;
      choiceWith: string[];
      hero?: string;
      entryType?: string;
    }
  >();
  for (const s of specs) {
    const subName = new Map<number, string>();
    for (const sn of s.subTreeNodes ?? [])
      for (const e of sn.entries ?? []) subName.set(e.traitSubTreeId, e.name);
    for (const group of ["classNodes", "specNodes", "heroNodes"]) {
      for (const n of s[group] ?? []) {
        for (const e of n.entries ?? []) {
          if (!e.spellId || node.has(String(e.spellId))) continue;
          node.set(String(e.spellId), {
            en: e.name,
            kind: n.type,
            maxRanks: e.maxRanks ?? n.maxRanks ?? 1,
            entryType: e.type,
            choiceWith: (n.entries ?? [])
              .filter((x: any) => x.spellId && x.spellId !== e.spellId)
              .map((x: any) => String(x.spellId)),
            hero: n.subTreeId ? subName.get(n.subTreeId) : undefined,
          });
        }
      }
    }
  }
  const specZh = new Map<number, string>(
    specs.map((s: any) => [
      s.specId,
      SPEC_NAMES_ZH[`${s.specName} ${s.className}`] ??
        `${s.className}/${s.specName}`,
    ]),
  );
  const classOfSpec = new Map<number, string>(
    specs.map((s: any) => [s.specId, s.className]),
  );

  // ── DB2 ─────────────────────────────────────────────────────────────────────
  const desc = new Map<string, string>();
  for (const r of await load("Spell", "zhCN")) {
    const t = [r.Description_lang, r.AuraDescription_lang].filter(Boolean);
    if (t.length) desc.set(r.ID, t[0]!);
  }
  const enName = new Map<string, string>();
  for (const r of await load("SpellName")) enName.set(r.ID, r.Name_lang);

  const effRows = await load("SpellEffect");
  applyHotfixOverlay(effRows, loadHotfixOverlay(DATA));
  type Eff = {
    idx: number;
    effect: string;
    aura: string;
    base: number;
    pvp: number;
    misc0: string;
    trigger: string;
    target: string;
    period: number;
    chain: number;
    radiusIdx: string;
    mask: number[];
    mechanic: string;
    /** spell-power / attack-power coefficients: most damage and healing
     * effects carry base 0 and scale from these instead */
    sp: number;
    ap: number;
  };
  const effects = new Map<string, Eff[]>();
  for (const r of effRows) {
    if (r.DifficultyID !== "0") continue;
    const l = effects.get(r.SpellID) ?? [];
    l.push({
      idx: Number(r.EffectIndex),
      effect: r.Effect,
      aura: r.EffectAura,
      base: Number(r.EffectBasePointsF),
      pvp: pvpBasePoints(r),
      misc0: r.EffectMiscValue_0,
      trigger: r.EffectTriggerSpell,
      target: r.ImplicitTarget_0,
      period: Number(r.EffectAuraPeriod || 0),
      chain: Number(r.EffectChainTargets || 0),
      radiusIdx: r.EffectRadiusIndex_0,
      mechanic: r.EffectMechanic,
      sp: Number(r.EffectBonusCoefficient || 0),
      ap: Number(r.BonusCoefficientFromAP || 0),
      mask: [0, 1, 2, 3].map(
        (i) => Number(r[`EffectSpellClassMask_${i}`] ?? 0) >>> 0,
      ),
    });
    effects.set(r.SpellID, l);
  }
  for (const l of effects.values()) l.sort((a, b) => a.idx - b.idx);

  const durationMs = new Map<string, number>();
  for (const r of await load("SpellDuration"))
    durationMs.set(r.ID, Number(r.Duration));
  const spellDur = new Map<string, { pve: number; pvp: number }>();
  for (const r of await load("SpellMisc")) {
    if (r.DifficultyID !== "0") continue;
    spellDur.set(r.SpellID, {
      pve: durationMs.get(r.DurationIndex) ?? 0,
      pvp: durationMs.get(r.PvPDurationIndex) ?? 0,
    });
  }
  const radius = new Map<string, number>();
  for (const r of await load("SpellRadius")) radius.set(r.ID, Number(r.Radius));
  const auraOpt = new Map<
    string,
    { stacks: number; proc: number; charges: number }
  >();
  for (const r of await load("SpellAuraOptions")) {
    if (r.DifficultyID && r.DifficultyID !== "0") continue;
    auraOpt.set(r.SpellID, {
      stacks: Number(r.CumulativeAura || 0),
      proc: Number(r.ProcChance || 0),
      charges: Number(r.ProcCharges || 0),
    });
  }
  // Cooldown: a charge category (MaxCharges / ChargeRecoveryTime) wins — Pain
  // Suppression's 180 s lives there while SpellCooldowns only carries its
  // 1.5 s GCD. A plain recovery time <= 1.5 s is the GCD, not a cooldown.
  const chargeCat = new Map<string, { charges: number; ms: number }>();
  for (const r of await load("SpellCategory"))
    chargeCat.set(r.ID, {
      charges: Number(r.MaxCharges || 0),
      ms: Number(r.ChargeRecoveryTime || 0),
    });
  const cooldown = new Map<string, { s: number; charges: number }>();
  /** ChargeCategory → spells in it (aura 411 / 453 / 454 target a category) */
  const spellsByChargeCat = new Map<string, string[]>();
  for (const r of await load("SpellCategories")) {
    if (r.DifficultyID && r.DifficultyID !== "0") continue;
    if (r.ChargeCategory && r.ChargeCategory !== "0") {
      const l = spellsByChargeCat.get(r.ChargeCategory) ?? [];
      l.push(r.SpellID);
      spellsByChargeCat.set(r.ChargeCategory, l);
    }
    const c = chargeCat.get(r.ChargeCategory);
    if (c && c.ms > 0)
      cooldown.set(r.SpellID, { s: c.ms / 1000, charges: c.charges });
  }
  for (const r of await load("SpellCooldowns")) {
    if (r.DifficultyID && r.DifficultyID !== "0") continue;
    if (cooldown.has(r.SpellID)) continue;
    const ms = Math.max(
      Number(r.RecoveryTime || 0),
      Number(r.CategoryRecoveryTime || 0),
    );
    if (ms > 1500) cooldown.set(r.SpellID, { s: ms / 1000, charges: 0 });
  }
  const classOpts = new Map<string, { set: number; mask: number[] }>();
  for (const r of await load("SpellClassOptions"))
    classOpts.set(r.SpellID, {
      set: Number(r.SpellClassSet),
      mask: [0, 1, 2, 3].map((i) => Number(r[`SpellClassMask_${i}`]) >>> 0),
    });

  const zh = (id: string) => zhNames[id] ?? enName.get(id) ?? id;

  // ── tooltip interpolation ───────────────────────────────────────────────────
  const effAt = (id: string, n: number) =>
    (effects.get(id) ?? []).find((e) => e.idx === n - 1);
  const pointsText = (e: Eff | undefined, letter: string) => {
    if (!e) return null;
    let v = Math.abs(e.base);
    let p = Math.abs(e.pvp);
    if (letter === "s" && v === 0 && (e.sp > 0 || e.ap > 0)) {
      const parts = [];
      if (e.sp > 0) parts.push(`${fmt(e.sp * 100)}%法强`);
      if (e.ap > 0) parts.push(`${fmt(e.ap * 100)}%攻强`);
      return { v: 0, p: 0, coef: parts.join("+") };
    }
    if (letter === "t") {
      v = e.period / 1000;
      p = v;
    }
    if (letter === "x") {
      v = e.chain;
      p = v;
    }
    if (letter === "a" || letter === "A") {
      v = radius.get(e.radiusIdx) ?? 0;
      p = v;
    }
    return { v, p };
  };
  const tokenValue = (
    ref: string,
    letter: string,
    n: number,
  ): { v: number; p: number; coef?: string } | null => {
    const l = letter.toLowerCase();
    if (l === "d") {
      const d = spellDur.get(ref);
      if (!d || !d.pve) return null;
      return { v: d.pve / 1000, p: (d.pvp || d.pve) / 1000 };
    }
    if (l === "u") {
      const o = auraOpt.get(ref);
      return o ? { v: o.stacks, p: o.stacks } : null;
    }
    if (l === "h") {
      const o = auraOpt.get(ref);
      return o ? { v: o.proc, p: o.proc } : null;
    }
    if (l === "n") {
      const o = auraOpt.get(ref);
      return o ? { v: o.charges, p: o.charges } : null;
    }
    if (l === "o") {
      const e = effAt(ref, n);
      const d = spellDur.get(ref);
      if (!e || !e.period || !d?.pve) return null;
      const ticks = d.pve / e.period;
      return { v: Math.abs(e.base) * ticks, p: Math.abs(e.pvp) * ticks };
    }
    if (["s", "m", "w", "t", "x", "a", "e", "b"].includes(l))
      return pointsText(
        effAt(ref, n),
        l === "a" ? "a" : l === "t" ? "t" : l === "x" ? "x" : "s",
      );
    return null;
  };

  // (?![a-zA-Z]): $abs( / $max( / $cond( are functions, not tokens
  const TOKEN = /\$(\d+)?([sSmMwWdDtTaAxXuUhHoOnN])(\d?)(?![a-zA-Z])/g;
  let unresolvedTotal = 0;
  const interpolate = (
    id: string,
    text: string,
    depth = 0,
  ): { text: string; unresolved: number } => {
    let unresolved = 0;
    let s = text.replace(/\|c[0-9a-fA-F]{8}|\|r|\|n/gi, "");
    // $@spellname123 / $@spelldesc123 / $@spellicon123
    s = s.replace(/\$@spellname(\d+)/g, (_, r) => zh(r));
    s = s.replace(/\$@spellicon\d+/g, "");
    s = s.replace(/\$@spell(?:desc|tooltip)(\d+)/g, (_, r) =>
      depth < 1 ? interpolate(r, desc.get(r) ?? "", depth + 1).text : zh(r),
    );
    // plurals / gender: $lpoint:points;  $gheshe:she;
    s = s.replace(/\$[lLgG]([^:;]*):([^;]*);/g, (_, a) => a);
    // conditionals $?s123[A][B], chained ?a456[C][D]
    for (let guard = 0; guard < 50; guard++) {
      const at = s.search(/\$\?/);
      if (at < 0) break;
      let i = at + 2;
      const branches: string[] = [];
      const readGroup = () => {
        if (s[i] !== "[") return null;
        let depthB = 0,
          j = i;
        for (; j < s.length; j++) {
          if (s[j] === "[") depthB++;
          else if (s[j] === "]" && --depthB === 0) break;
        }
        const g = s.slice(i + 1, j);
        i = j + 1;
        return g;
      };
      for (let k = 0; k < 10; k++) {
        while (i < s.length && s[i] !== "[") i++;
        const g = readGroup();
        if (g === null) break;
        branches.push(g);
        if (s[i] === "?") {
          i++;
          continue;
        }
        if (s[i] === "[") {
          const e = readGroup();
          if (e !== null) branches.push(e);
        }
        break;
      }
      const shown = branches.filter((b) => b.trim()).join(" ／ ");
      s = s.slice(0, at) + (shown ? `〔${shown}〕` : "") + s.slice(i);
    }
    // ${ expression }
    s = s.replace(/\$\{([^}]*)\}/g, (whole, expr: string) => {
      let ok = true;
      let coef: string | undefined;
      const val = (which: "v" | "p") =>
        expr.replace(TOKEN, (_, ref, letter, n) => {
          const t = tokenValue(ref ?? id, letter, Number(n || 1));
          if (t?.coef) coef ??= t.coef;
          if (!t || t.coef) {
            ok = false;
            return "0";
          }
          return String(t[which]);
        });
      const ev = (e: string) => {
        if (!/^[\d.+\-*/()\s]+$/.test(e)) {
          ok = false;
          return NaN;
        }
        try {
          return Function(`"use strict";return (${e})`)() as number;
        } catch {
          ok = false;
          return NaN;
        }
      };
      const v = ev(val("v"));
      const p = ev(val("p"));
      // a coefficient-scaled amount inside arithmetic: show the coefficient
      // and say the expression adds a modifier, instead of leaking tokens
      if (coef) return `（${coef}，另有加成）`;
      if (!ok || !Number.isFinite(v)) {
        unresolved++;
        return whole;
      }
      const a = fmt(Math.abs(v)),
        b = fmt(Math.abs(p));
      return a === b ? a : `${a}（PvP ${b}）`;
    });
    s = s.replace(TOKEN, (whole, ref, letter, n) => {
      const t = tokenValue(ref ?? id, letter, Number(n || 1));
      if (!t) {
        unresolved++;
        return whole;
      }
      if (t.coef) return `（${t.coef}）`;
      // zhCN tooltips write 持续$d with no unit
      const unit = letter.toLowerCase() === "d" ? "秒" : "";
      const a = fmt(t.v) + unit,
        b = fmt(t.p) + unit;
      return a === b ? a : `${a}（PvP ${b}）`;
    });
    const leftover = (s.match(/\$[A-Za-z<]/g) ?? []).length;
    return {
      text: s.replace(/\s+/g, " ").trim(),
      unresolved: unresolved + leftover,
    };
  };

  // ── code index ──────────────────────────────────────────────────────────────
  const needed = new Set<string>();
  const linkedOf = new Map<string, string[]>();
  const REF = /\$\{?\$?(\d{3,})[sSmMwWdDtTaAxXuUhHoOnN]/g;
  for (const id of universe.keys()) {
    const linked = new Set<string>([id]);
    for (const m of (desc.get(id) ?? "").matchAll(REF)) linked.add(m[1]!);
    for (const m of (desc.get(id) ?? "").matchAll(/\$@spell\w+?(\d+)/g))
      linked.add(m[1]!);
    for (let hop = 0; hop < 2; hop++)
      for (const s of [...linked])
        for (const e of effects.get(s) ?? [])
          if (e.trigger && e.trigger !== "0") linked.add(e.trigger);
    const list = [...linked].filter((x) => x !== id);
    linkedOf.set(id, list);
    needed.add(id);
    list.forEach((x) => needed.add(x));
  }
  const registry = new Map<string, string[]>();
  for (const t of CURATED_ID_TABLES) {
    for (const x of t.ids()) {
      if (!needed.has(x)) continue;
      const l = registry.get(x) ?? [];
      l.push(t.name);
      registry.set(x, l);
    }
  }
  const semanticFiles = new Map<string, Set<string>>();
  const catalogFiles = new Map<string, Set<string>>();
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (f !== "node_modules" && f !== "__screenshots__") walk(p);
        continue;
      }
      if (!/\.(ts|tsx|json)$/.test(f) || /\.test\.|\.spec\./.test(f)) continue;
      const rel = relative(REPO, p);
      const target = isCatalog(rel) ? catalogFiles : semanticFiles;
      const text = readFileSync(p, "utf8");
      for (const m of text.matchAll(/(?<![\d.])(\d{3,7})(?![\d.])/g)) {
        if (!needed.has(m[1]!)) continue;
        // a bare 3-digit number in code is usually a constant, not an id
        if (m[1]!.length === 3 && !rel.endsWith(".json")) {
          const before = text[(m.index ?? 0) - 1];
          if (before !== '"' && before !== "'") continue;
        }
        const s = target.get(m[1]!) ?? new Set();
        s.add(rel);
        target.set(m[1]!, s);
      }
    }
  };
  for (const pkg of ["analysis", "desktop", "eval"])
    walk(join(REPO, "packages", pkg, "src"));

  // ── tags from effects ───────────────────────────────────────────────────────
  const CC_AURA = new Set(["5", "7", "12", "26", "27", "60"]);
  const tagsOf = (ids: string[], tip: string): string[] => {
    const t = new Set<string>();
    for (const s of ids) {
      for (const e of effects.get(s) ?? []) {
        const self = e.target === "1" || e.target === "0" || e.target === "";
        if (e.aura === "87" && e.pvp < 0) t.add("减伤");
        if (e.aura === "69") t.add("护盾");
        if (["133", "34", "230"].includes(e.aura) && e.pvp > 0)
          t.add("血量上限");
        if (
          (e.effect === "10" ||
            e.effect === "136" ||
            e.aura === "8" ||
            e.aura === "20") &&
          self
        )
          t.add("自我回血");
        if (
          (e.effect === "10" ||
            e.effect === "136" ||
            e.aura === "8" ||
            e.aura === "20") &&
          !self
        )
          t.add("治疗他人");
        if (e.aura === "118" && e.pvp > 0) t.add("受疗提高");
        if (["39", "40", "77"].includes(e.aura)) t.add("免疫");
        if (
          e.effect === "2" ||
          e.aura === "3" ||
          (e.aura === "79" && e.pvp > 0)
        )
          t.add("伤害");
        if (CC_AURA.has(e.aura)) t.add("控制");
        if (e.aura === "31" || ["29", "41", "42"].includes(e.effect))
          t.add("位移");
        if (e.effect === "68") t.add("打断");
        if (e.effect === "38") t.add("驱散");
        if (e.effect === "30") t.add("资源");
        if (e.aura === "107" || e.aura === "108") {
          const op = e.misc0;
          if (op === "11" || op === "21") t.add("改冷却");
          else if (op === "1") t.add("改持续");
          else t.add("改数值/其他");
        }
        if (["411", "453", "454"].includes(e.aura)) t.add("改充能");
        if (e.aura === "332" || e.effect === "36") t.add("替换/学会技能");
      }
    }
    if (/致命伤害|免于一死|免于死亡|不会(被杀死|死亡)|原本会杀死你/.test(tip))
      t.add("防致死");
    return [...t];
  };

  // candidate spells a modifier can reach: every talent/linked/observed spell
  const reachPool = [...new Set([...needed, ...observed])].filter((x) =>
    classOpts.get(x)?.mask.some((m) => m),
  );

  /** ClassID → SpellClassSet, same mapping genTalentModifiers uses; a talent
   * spell without its own SpellClassOptions row gets its class's set instead
   * of matching every class's mask. */
  const FAMILY_BY_CLASS: Record<string, number> = {
    Warrior: 4,
    Paladin: 10,
    Hunter: 9,
    Rogue: 8,
    Priest: 6,
    "Death Knight": 15,
    Shaman: 11,
    Mage: 3,
    Warlock: 5,
    Monk: 53,
    Druid: 7,
    "Demon Hunter": 107,
    Evoker: 224,
  };
  const reachSet = new Set(reachPool);

  const rows: any[] = [];
  for (const [id, src] of universe) {
    const n = node.get(id);
    const tip = desc.get(id) ?? "";
    const it = interpolate(id, tip);
    unresolvedTotal += it.unresolved;
    const linked = linkedOf.get(id) ?? [];
    const allIds = [id, ...linked];
    const effectLines: string[] = [];
    const className = classOfSpec.get(src.specIds[0]!) ?? "?";
    /** machine-readable, uncapped: every (talent effect → target spell) pair */
    const modsRaw: Array<{
      via: string;
      effectIndex: number;
      aura: string;
      op: string | null;
      base: number;
      pvp: number;
      targets: string[];
    }> = [];
    const modifies: Array<{
      spell: string;
      name: string;
      op: string;
      value: number;
      via: string;
    }> = [];
    for (const s of allIds) {
      for (const e of effects.get(s) ?? []) {
        const who =
          e.target === "1" || e.target === "0" || e.target === ""
            ? ""
            : ` 目标${e.target}`;
        const kind =
          e.aura !== "0"
            ? `光环:${AURA[e.aura] ?? e.aura}`
            : `效果:${EFFECT[e.effect] ?? e.effect}`;
        const val =
          e.base || e.pvp
            ? ` ${fmt(e.base)}${e.pvp !== e.base ? `(PvP ${fmt(e.pvp)})` : ""}`
            : "";
        const trig =
          e.trigger && e.trigger !== "0"
            ? ` → ${zh(e.trigger)}(${e.trigger})`
            : "";
        const op =
          e.aura === "107" || e.aura === "108"
            ? ` [${OP[e.misc0] ?? "op" + e.misc0}]`
            : "";
        effectLines.push(
          `${s === id ? "本体" : zh(s) + "(" + s + ")"} #${e.idx + 1} ${kind}${op}${val}${who}${trig}`,
        );
        if (["411", "453", "454"].includes(e.aura) && e.misc0 !== "0") {
          const targets = (spellsByChargeCat.get(e.misc0) ?? []).filter((x) =>
            reachSet.has(x),
          );
          if (targets.length)
            modsRaw.push({
              via: s,
              effectIndex: e.idx,
              aura: e.aura,
              op: null,
              base: e.base,
              pvp: e.pvp,
              targets,
            });
        }
        if ((e.aura === "107" || e.aura === "108") && e.mask.some((m) => m)) {
          const set =
            classOpts.get(s)?.set ??
            classOpts.get(id)?.set ??
            FAMILY_BY_CLASS[className];
          const hits = reachPool.filter((x) => {
            const o = classOpts.get(x)!;
            return (
              (set === undefined || o.set === set) &&
              o.mask.some((m, i) => (m & e.mask[i]!) !== 0)
            );
          });
          if (hits.length)
            modsRaw.push({
              via: s,
              effectIndex: e.idx,
              aura: e.aura,
              op: e.misc0,
              base: e.base,
              pvp: e.pvp,
              targets: hits,
            });
          for (const h of hits.slice(0, 12))
            modifies.push({
              spell: h,
              name: zh(h),
              op: OP[e.misc0] ?? `op${e.misc0}`,
              value: e.pvp,
              via: s,
            });
        }
      }
    }
    const code = allIds
      .map((x) => ({
        id: x,
        self: x === id,
        tables: registry.get(x) ?? [],
        files: [...(semanticFiles.get(x) ?? [])],
        catalog: [...(catalogFiles.get(x) ?? [])],
      }))
      .filter((c) => c.tables.length || c.files.length);
    rows.push({
      id,
      zh: zh(id),
      en: n?.en ?? enName.get(id) ?? "",
      className,
      specIds: src.specIds,
      modsRaw,
      specs: src.specIds.map((s) => specZh.get(s) ?? String(s)),
      source: src.source,
      hero: n?.hero ?? null,
      node: n
        ? {
            kind: n.kind,
            maxRanks: n.maxRanks,
            entryType: n.entryType,
            choiceWith: n.choiceWith.map((c) => `${zh(c)}(${c})`),
          }
        : null,
      cooldownS: cooldown.get(id)?.s ?? null,
      charges: cooldown.get(id)?.charges || null,
      description: it.text,
      descriptionRaw: tip,
      unresolved: it.unresolved,
      effects: effectLines,
      modifies,
      linked: linked.map((x) => `${zh(x)}(${x})`),
      tags: tagsOf(allIds, tip),
      code,
      inCode: code.length > 0,
      observed: allIds.filter((x) => observed.has(x)),
    });
  }

  const summary = {
    build,
    talents: rows.length,
    bySource: rows.reduce(
      (a: Record<string, number>, r) => (
        (a[r.source] = (a[r.source] ?? 0) + 1),
        a
      ),
      {},
    ),
    referencedInCode: rows.filter((r) => r.inCode).length,
    talentIdItselfInCode: rows.filter((r) => r.code.some((c: any) => c.self))
      .length,
    inRegistryTables: rows.filter((r) =>
      r.code.some((c: any) => c.tables.length),
    ).length,
    observedInLogs: rows.filter((r) => r.observed.length).length,
    withDescription: rows.filter((r) => r.descriptionRaw).length,
    descriptionsFullyResolved: rows.filter(
      (r) => r.descriptionRaw && r.unresolved === 0,
    ).length,
    unresolvedPlaceholders: unresolvedTotal,
    tagCounts: rows.reduce((a: Record<string, number>, r) => {
      for (const t of r.tags) a[t] = (a[t] ?? 0) + 1;
      return a;
    }, {}),
  };
  const outDir = join(
    process.env.GLADLOG_EVAL_HOME ??
      join(process.env.HOME ?? "", "code/gladlog-eval-private"),
    "reports/talent-catalog-2026-09-13",
  );
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "catalog.json"),
    JSON.stringify({ summary, rows }, null, 1),
  );
  console.log(JSON.stringify(summary, null, 1));
}

void main();
