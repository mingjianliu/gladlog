/**
 * Ability effect facts (GH #29 stage 2 foundation) — the官方 half of a
 * cooldown's functional profile that no existing generator covers yet:
 * absorb, healing (self vs others), healing-received amplification, and movement speed (aura 31).
 *
 * Why these four: the stage-1 audit classified all 48 Defensive-tagged
 * cooldowns and found **11 of them (22.9%) have no damage reduction, absorb or
 * immunity at all** — Desperate Prayer and Exhilaration are pure self-heals,
 * Guardian Spirit and Vampiric Blood amplify healing RECEIVED, Divine Hymn and
 * Tranquility are team heals, Apotheosis and Avenging Crusader are throughput
 * empowers. One three-valued tag calls every one of them "Defensive", so every
 * judgement that means "did you have a WALL" (cd-waste, the low-pressure
 * exemption note, defensive timing labels, death-unused-defensive) is asking a
 * question the tag cannot answer.
 *
 * Together with the already-shipped generators this completes the official
 * side of that profile:
 *   · reaches an ally           → spellTargetingGenerated (GH #28)
 *   · school / immunity masks   → spellSchoolsGenerated   (GH #29 stage 1)
 *   · damage reduction %        → mitigationGenerated + curated overrides
 *   · **this file**             → absorb / heal / healing-received / movement speed
 * What stays human-signed is documented in `curatedAbilityFacts.ts`
 * (`throughput_role`): "this cooldown empowers your own output" has no DB2
 * field — only a dozen different modifier auras whose meaning hides in a
 * SpellModOp code.
 *
 * Extraction rules (each one has a positive AND a negative control asserted
 * before anything is written — the discipline that caught two shipped bugs on
 * 2026-08-22, both of which were "the control set was missing a whole class"):
 *   · absorb          — `EffectAura = 69` (SCHOOL_ABSORB). DB2 stores 0 points
 *                       (the amount is a spell-power coefficient), so this is
 *                       a boolean, never a number.
 *   · healsSelf       — a heal effect (`Effect` 10 HEAL / 136 HEAL_PCT, or
 *                       aura 8 PERIODIC_HEAL / 20 OBS_MOD_HEALTH) whose target
 *                       is the caster.
 *   · healsOthers     — the same effect families aimed at a friendly target
 *                       (ALLY_IMPLICIT_TARGETS, shared with genSpellTargeting
 *                       so the two generators cannot drift), one
 *                       EffectTriggerSpell hop — Divine Hymn/Tranquility carry
 *                       their ally healing in 64844/157982.
 *   · healingReceived — `EffectAura` 118 (MOD_HEALING_PCT received) or 259,
 *                       points > 0.
 *   · moveSpeed       — `EffectAura = 31` = A_MOD_INCREASE_SPEED (SimC
 *                       data_enums.hh / TrinityCore SPELL_AURA_MOD_INCREASE_SPEED),
 *                       points > 0. This field was called `hastePct` until
 *                       2026-09-04 — aura 31 is MOVEMENT speed, not haste
 *                       (Dispersion +50 % and Zephyr +30 % are run-speed
 *                       buffs; haste auras are 138/193/216). The `> 0` guard is
 *                       load bearing: Blessing of Freedom carries an aura-31
 *                       row with 0 points (a dead slot) — consistent with a
 *                       movement aura, not a haste one.
 */
import fs from "fs-extra";

import { classMetadata } from "../../src/data/classSpells";
import spellIdLists from "../../src/data/spellIdLists";
import { ALLY_IMPLICIT_TARGETS } from "./lib/allyTargets";
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
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

const EFFECT_DUMMY = "3";
/** Effect ids that heal outright. */
const HEAL_EFFECTS = new Set(["10", "136"]);
/** Auras that heal over time / keep health topped up. */
const HEAL_AURAS = new Set(["8", "20"]);
const AURA_ABSORB = "69";
const AURA_HEALING_RECEIVED = new Set(["118", "259"]);
/** A_MOD_INCREASE_SPEED — movement speed (was mislabelled haste until 2026-09-04). */
const AURA_MOVE_SPEED = "31";
/** Effect = 2 SCHOOL_DAMAGE(直接伤害);aura 3 = PERIODIC_DAMAGE。 */
const DAMAGE_EFFECTS = new Set(["2"]);
const DAMAGE_AURAS = new Set(["3"]);
/**
 * 指向敌人的 ImplicitTarget 值 —— 2026-08-22 逐个用已知技能对照钉出来的
 * (GH #29 第 6 项「进攻面 41% 空白」):
 *   6   指定敌人      变形术 / 死亡标记 / 触身通
 *   15  近身范围敌人  刀扇(15,22)
 *   16  目标区域敌人  战争践踏(18,16)/ 冰霜之环(87,16)/ 混沌新星(18,16)/ 枯萎凋零
 *   28  动态区域敌人  火焰之雨(1,28,87)/ 枯萎凋零
 *   104 锥形敌人      震荡波(1,104)
 * **只收验证过的值**:同族的 24(另一个锥形值)没有对照就不收 —— 宁可漏一个
 * (少判一次「打敌人」),不要凭猜把友方/位置标记算成敌方。18/87 是**目的地**
 * 标记不是敌方标记(GH #28 那次 405 条假阳的成因),它们只在与 16/28 同行时
 * 才意味着敌方,所以这里不收。
 */
const ENEMY_IMPLICIT_TARGETS = new Set(["6", "15", "16", "28", "104"]);
/** 其中属于「范围/锥形」而不是「指定单体」的。 */
const ENEMY_AREA_TARGETS = new Set(["15", "16", "28", "104"]);

export type AbilityEffectFacts = {
  absorbs?: true;
  /** 效果指向敌人(而不是自己/队友)。 */
  hitsEnemy?: true;
  /** 指向敌人且是范围/锥形(不是指定单体)。 */
  enemyAoE?: true;
  /** 造成直接或周期伤害。 */
  dealsDamage?: true;
  healsSelf?: true;
  healsOthers?: true;
  /** % increase to healing RECEIVED (Guardian Spirit 60, Life Cocoon 50). */
  healingReceivedPct?: number;
  /** % movement-speed increase (Dispersion 50, Zephyr 30) — aura 31 = A_MOD_INCREASE_SPEED. */
  moveSpeedPct?: number;
};

/** [spellId, field, expected, why] — asserted before writing. */
const CONTROLS: Array<[string, keyof AbilityEffectFacts, boolean, string]> = [
  ["17", "absorbs", true, "真言术:盾 —— 纯吸收"],
  ["11426", "absorbs", true, "寒冰护体 —— 吸收"],
  ["871", "absorbs", false, "盾墙 —— 百分比减伤,不是吸收"],
  ["19236", "healsSelf", true, "绝望祷言 —— 自愈(GH #28 那条)"],
  ["109304", "healsSelf", true, "振奋 —— 自愈"],
  ["22812", "healsSelf", false, "树皮 —— 减伤,不治疗"],
  ["740", "healsOthers", true, "宁静 —— 团队治疗(经一跳 157982)"],
  ["64843", "healsOthers", true, "神圣赞美诗 —— 团队治疗(经一跳 64844)"],
  ["19236", "healsOthers", false, "绝望祷言 —— 只治自己"],
  ["871", "healsOthers", false, "盾墙 —— 不治疗"],
  // 进攻面(GH #29 第 6 项)
  ["360194", "hitsEnemy", true, "死亡标记 —— 指定敌人(目标 6)"],
  ["118", "hitsEnemy", true, "变形术 —— 指定敌人"],
  ["82691", "hitsEnemy", true, "冰霜之环 —— 目标区域敌人(16)"],
  ["51723", "hitsEnemy", true, "刀扇 —— 近身范围敌人(15)"],
  ["46968", "hitsEnemy", true, "震荡波 —— 锥形敌人(104)"],
  ["871", "hitsEnemy", false, "盾墙 —— 自身"],
  ["33206", "hitsEnemy", false, "苦修 —— 队友"],
  ["10060", "hitsEnemy", false, "强化 —— 队友"],
  ["190319", "hitsEnemy", false, "燃烧 —— 自身增益"],
  ["82691", "enemyAoE", true, "冰霜之环 —— 区域"],
  ["46968", "enemyAoE", true, "震荡波 —— 锥形"],
  ["118", "enemyAoE", false, "变形术 —— 指定单体"],
  ["360194", "enemyAoE", false, "死亡标记 —— 指定单体"],
  ["179057", "dealsDamage", true, "混沌新星 —— Effect 2 直接伤害"],
  ["871", "dealsDamage", false, "盾墙 —— 不造成伤害"],
  ["118", "dealsDamage", false, "变形术 —— 纯控制,不造成伤害"],
];
const NUMERIC_CONTROLS: Array<
  [string, "healingReceivedPct" | "moveSpeedPct", number, string]
> = [
  ["47788", "healingReceivedPct", 60, "守护之魂 —— 受治疗 +60%"],
  ["55233", "healingReceivedPct", 30, "鲜血之力 —— 受治疗 +30%"],
  ["47585", "moveSpeedPct", 50, "消散 —— 移动速度 +50%(aura 31 = A_MOD_INCREASE_SPEED,不是加速)"],
];
/** 反向:这些**不许**有对应字段(1044 的 aura31 是 0 点死槽)。 */
const NEGATIVE_NUMERIC: Array<[string, keyof AbilityEffectFacts, string]> = [
  ["1044", "moveSpeedPct", "自由祝福 —— aura31 但 0 点,是死槽不是移速"],
  ["33206", "healingReceivedPct", "苦修 —— 减伤,不改受治疗量"],
];

async function main(): Promise<void> {
  const build = await resolveBuild(process.argv[2]);
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;

  // 宇宙 = **观测集** ∪ 职业目录 ∪ 手工防御表(以及本文件各自额外需要的集合)。
  // 为什么不是「全部被挖过的 9,613 个 id」:那份宇宙让三个生成物给 renderer 主
  // chunk 加了 364 kB(3,130 → 3,494 kB,+11.6%),firstPaint 预算随即三次里红两次。
  // 仓库为这条早有先例 —— genSpellIcons 的注释写着「universe = observed ∪
  // SpellCooldowns ∪ candidates;不要退回全表,13.8MB 会撑爆首渲预算」。
  // 收缩不损失完备性:消费者问的都是「打过照面的技能」,而观测集正是语料里真出现过
  // 的 id;职业目录与手工表另行并入,保证任何已登记的 id 一定有行(有测试钉着)。
  const observed = (
    JSON.parse(
      fs.readFileSync(
        new URL(
          "../../src/data/observedSpellIdsGenerated.json",
          import.meta.url,
        ).pathname,
        "utf8",
      ),
    ) as Array<string | number>
  ).map(String);
  const universe = new Set<string>([
    ...observed,
    ...classMetadata.flatMap((c) => c.abilities.map((a) => a.spellId)),
    ...(spellIdLists.externalDefensiveSpellIds as string[]),
    ...(spellIdLists.externalOrBigDefensiveSpellIds as string[]),
  ]);

  const parsed = parseCsv(await fetchTable("SpellEffect", build, cacheDir));
  // Live hotfixes on top of the client build (BACKLOG #41 (3)).
  const hf = applyHotfixOverlay(
    parsed.rows,
    loadHotfixOverlay(dataDirOf(import.meta.url)),
  );
  console.log(`hotfix overlay: ${hf.applied} writes on ${hf.rowsTouched} rows`);
  assertColumns(
    parsed.header,
    [
      "SpellID",
      "DifficultyID",
      "Effect",
      "EffectAura",
      "EffectTriggerSpell",
      "EffectBasePointsF",
      "ImplicitTarget_0",
      "ImplicitTarget_1",
      PVP_MULTIPLIER_COLUMN,
    ],
    "SpellEffect",
  );
  assertMinRows(parsed.rows, 500000, "SpellEffect");

  type Row = {
    effect: string;
    aura: string;
    trigger: string;
    points: number;
    targets: string[];
  };
  const bySpell = new Map<string, Row[]>();
  const rowOf = (r: Record<string, string>): Row => ({
    effect: r.Effect,
    aura: r.EffectAura,
    trigger: r.EffectTriggerSpell,
    // PvP-scaled (lib/pvpMultiplier.ts): healingReceivedPct / moveSpeedPct are
    // arena numbers; the boolean facts only look at the sign / non-zero.
    points: pvpBasePoints(r),
    targets: [r.ImplicitTarget_0, r.ImplicitTarget_1].filter(
      (t) => t && t !== "0",
    ),
  });
  const keep = (sid: string, row: Row): void => {
    const list = bySpell.get(sid);
    if (list) list.push(row);
    else bySpell.set(sid, [row]);
  };
  for (const r of parsed.rows) {
    if (r.DifficultyID !== "0" || !universe.has(r.SpellID)) continue;
    keep(r.SpellID, rowOf(r));
  }
  const triggered = new Set<string>();
  for (const rows of bySpell.values())
    for (const r of rows)
      if (r.trigger && r.trigger !== "0" && !bySpell.has(r.trigger))
        triggered.add(r.trigger);
  for (const r of parsed.rows) {
    if (r.DifficultyID !== "0" || !triggered.has(r.SpellID)) continue;
    keep(r.SpellID, rowOf(r));
  }

  const considered = (rows: Row[]): Row[] => {
    const real = rows.filter((r) => r.effect !== EFFECT_DUMMY);
    return real.length > 0 ? real : rows;
  };
  const isHealRow = (r: Row): boolean =>
    HEAL_EFFECTS.has(r.effect) || HEAL_AURAS.has(r.aura);
  const hitsAlly = (r: Row): boolean =>
    r.targets.some((t) => ALLY_IMPLICIT_TARGETS.has(t));
  const hitsEnemyRow = (r: Row): boolean =>
    r.targets.some((t) => ENEMY_IMPLICIT_TARGETS.has(t));
  const isDamageRow = (r: Row): boolean =>
    DAMAGE_EFFECTS.has(r.effect) || DAMAGE_AURAS.has(r.aura);
  /** 1 = UNIT_CASTER;没有目标槽的效果也按「作用于自己」算(自身光环)。 */
  const hitsSelf = (r: Row): boolean =>
    r.targets.length === 0 || r.targets.includes("1");

  const factsFor = (id: string, hop = true): AbilityEffectFacts => {
    const facts: AbilityEffectFacts = {};
    for (const row of considered(bySpell.get(id) ?? [])) {
      if (row.aura === AURA_ABSORB) facts.absorbs = true;
      if (isHealRow(row)) {
        if (hitsAlly(row)) facts.healsOthers = true;
        else if (hitsSelf(row)) facts.healsSelf = true;
      }
      if (AURA_HEALING_RECEIVED.has(row.aura) && row.points > 0)
        facts.healingReceivedPct = Math.max(
          facts.healingReceivedPct ?? 0,
          Math.round(row.points),
        );
      if (row.aura === AURA_MOVE_SPEED && row.points > 0)
        facts.moveSpeedPct = Math.max(
          facts.moveSpeedPct ?? 0,
          Math.round(row.points),
        );
      if (hitsEnemyRow(row)) {
        facts.hitsEnemy = true;
        if (row.targets.some((t) => ENEMY_AREA_TARGETS.has(t)))
          facts.enemyAoE = true;
      }
      if (isDamageRow(row)) facts.dealsDamage = true;
      if (hop && row.trigger && row.trigger !== "0") {
        const deep = factsFor(row.trigger, false);
        // 一跳只补「够得着别人」这一面:触发法术自身的目标才是真受众
        if (deep.healsOthers) facts.healsOthers = true;
        if (deep.absorbs) facts.absorbs = true;
        // 一跳同样补进攻面:旋风斩这类本体只有 E64 触发,伤害与目标都在被触发的法术上
        if (deep.hitsEnemy) facts.hitsEnemy = true;
        if (deep.enemyAoE) facts.enemyAoE = true;
        if (deep.dealsDamage) facts.dealsDamage = true;
        if (deep.healingReceivedPct !== undefined)
          facts.healingReceivedPct = Math.max(
            facts.healingReceivedPct ?? 0,
            deep.healingReceivedPct,
          );
      }
    }
    return facts;
  };

  const out: Record<string, AbilityEffectFacts> = {};
  for (const id of [...universe].sort((a, b) => Number(a) - Number(b))) {
    const f = factsFor(id);
    if (Object.keys(f).length > 0) out[id] = f;
  }

  // ── ground truth, both directions, before writing ────────────────────────
  const misses: string[] = [];
  for (const [id, field, expected, why] of CONTROLS) {
    const got = out[id]?.[field] === true;
    if (got !== expected)
      misses.push(`${id} ${field}: 期望 ${expected} 实得 ${got}(${why})`);
  }
  for (const [id, field, expected, why] of NUMERIC_CONTROLS) {
    const got = out[id]?.[field];
    if (got !== expected)
      misses.push(`${id} ${field}: 期望 ${expected} 实得 ${got}(${why})`);
  }
  for (const [id, field, why] of NEGATIVE_NUMERIC) {
    if (out[id]?.[field] !== undefined)
      misses.push(`${id} ${field}: 不该有值,实得 ${out[id]?.[field]}(${why})`);
  }
  if (misses.length > 0)
    throw new Error(
      `genAbilityEffects: ground-truth check failed —\n  ${misses.join("\n  ")}`,
    );

  const count = (pred: (f: AbilityEffectFacts) => boolean): number =>
    Object.values(out).filter(pred).length;
  const jsonPath = new URL(
    "../../src/data/abilityEffectsGenerated.json",
    import.meta.url,
  ).pathname;
  const tsPath = new URL(
    "../../src/data/abilityEffectsGenerated.ts",
    import.meta.url,
  ).pathname;
  writeArtifact(jsonPath, JSON.stringify(out) + "\n");
  writeArtifact(
    tsPath,
    `/**\n` +
      ` * Generated at: ${new Date().toISOString()}\n` +
      ` * Build: ${build}\n` +
      ` * Source: DB2 SpellEffect — aura 69 (absorb), Effect 10/136 + aura 8/20\n` +
      ` *   (healing, split self vs ally by ImplicitTarget), aura 118/259\n` +
      ` *   (healing received %), aura 31 (movement speed %). One EffectTriggerSpell hop,\n` +
      ` *   dummy rows ignored unless they are all the spell has.\n` +
      ` *   See scripts/datagen/genAbilityEffects.ts for the rules and controls.\n` +
      ` * Absent field = the official rows do not show that effect. Treat as\n` +
      ` *   "not known to do this", never as proof of absence for a spell whose\n` +
      ` *   implementation is a dummy row + server script.\n` +
      ` * ids: ${Object.keys(out).length} — absorb ${count((f) => !!f.absorbs)}, heals self ${count((f) => !!f.healsSelf)}, heals others ${count((f) => !!f.healsOthers)}, healing-received ${count((f) => f.healingReceivedPct !== undefined)}, moveSpeed ${count((f) => f.moveSpeedPct !== undefined)}, hits enemy ${count((f) => !!f.hitsEnemy)}, enemy AoE ${count((f) => !!f.enemyAoE)}, deals damage ${count((f) => !!f.dealsDamage)}\n` +
      ` * The data lives in the .json of the same name (vite json.stringify ->\n` +
      ` * JSON.parse loading — the big-JSON lesson).\n` +
      ` */\n\n` +
      `// 静态 import,**不要改成动态**(2026-08-22 试过并回退):把这三份挪成懒加载\n` +
      `// chunk 确实让 renderer 主 chunk 从 3,360 回到 3,135 kB,但 firstPaint 反而两次都红\n` +
      `// (5215 / 5269),而静态 + 收缩宇宙那版两次都过(4488 / 4600)—— 首渲用例每次 reload\n` +
      `// 都绕缓存,多三个 chunk 的抓取代价盖过了主 chunk 变小的收益。控制体积靠**收缩宇宙**\n` +
      `// (观测集 ∪ 职业目录 ∪ 手工表),不靠拆 chunk。\n` +
      `import raw from "./abilityEffectsGenerated.json";\n\n` +
      `export type AbilityEffectFacts = {\n` +
      `  absorbs?: true;\n` +
      `  healsSelf?: true;\n` +
      `  healsOthers?: true;\n` +
      `  healingReceivedPct?: number;\n` +
      `  moveSpeedPct?: number;\n` +
      `  hitsEnemy?: true;\n` +
      `  enemyAoE?: true;\n` +
      `  dealsDamage?: true;\n` +
      `};\n\n` +
      `export const ABILITY_EFFECTS_GENERATED: Record<string, AbilityEffectFacts> =\n` +
      `  raw as Record<string, AbilityEffectFacts>;\n`,
  );
  console.log(
    `abilityEffectsGenerated: ${Object.keys(out).length} ids — absorb ${count((f) => !!f.absorbs)}, healsSelf ${count((f) => !!f.healsSelf)}, healsOthers ${count((f) => !!f.healsOthers)}, healingReceived ${count((f) => f.healingReceivedPct !== undefined)}, moveSpeed ${count((f) => f.moveSpeedPct !== undefined)}, hitsEnemy ${count((f) => !!f.hitsEnemy)}, enemyAoE ${count((f) => !!f.enemyAoE)}, dealsDamage ${count((f) => !!f.dealsDamage)} (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
