/**
 * Official school / immunity facts (GH #29 stage 1).
 *
 * Two questions this answers, both of which the repo used to answer with tiny
 * hand lists that can only ever prove the absence of false positives:
 *
 *  1. **What school is this spell?** `SpellMisc.SchoolMask` (1 = Physical,
 *     2 Holy, 4 Fire, 8 Nature, 16 Frost, 32 Shadow, 64 Arcane). Replaces
 *     `PHYSICAL_CC_IDS` (9 hand entries): measured 2026-08-22, the hand list is
 *     correct but partial — Hammer of Justice (2), Shadowfury (32), Chaos Nova
 *     (124) are magic CCs it never listed, and nothing could have told you.
 *
 *  2. **Which schools does this immunity actually stop?** `SpellEffect`
 *     `EffectAura = 39` (SCHOOL_IMMUNITY) with `EffectMiscValue_0` as the
 *     school mask. Measured: Divine Shield 127 (everything), Blessing of
 *     Protection **1 (physical only)**, Blessing of Spellwarding 126 (all
 *     magic), Ice Block 1|127. The predicate `MAGIC_ONLY_IMMUNITY_IDS` (5 hand
 *     entries) encoded only half of this — "a magic-only immunity does not stop
 *     a physical CC" — and had no symmetric rule, so the coach told players to
 *     use Blessing of Protection (physical immunity) to avoid Sleep Walk (a
 *     Nature-school CC). Measured 2 such suggestions in 250 matches.
 *
 * Mechanic immunity (`EffectAura = 77`, `EffectMiscValue_0` = mechanic id) is
 * emitted alongside because it is the same query and it is the other half of
 * "can this actually stop that" — Icebound Fortitude is immune to the STUN
 * mechanic rather than to a school.
 *
 * NOT every avoidance tool has an official immunity row: Anti-Magic Shell
 * (absorb, aura 69), Spell Reflection (aura 28), Cloak of Shadows (its only
 * aura 39 is the 1 s all-school 35729 it triggers — a moment on cast, not the
 * 5 s aura's mask, see `isFlash`), Bladestorm and Aspect of the Turtle work
 * through other auras entirely. Consumers must therefore treat
 * "absent" as UNKNOWN and fall back to the curated rule — never as "stops
 * nothing". `spellSchools.ts` is where that fallback lives.
 *
 * Ground truth runs before anything is written, in both directions (see
 * `verify()` at the bottom): known school masks must match, and the immunity
 * masks of the four unambiguous immunity buffs must come out exactly right.
 */
import fs from "fs-extra";

import { classMetadata } from "../../src/data/classSpells";
import spellIdLists from "../../src/data/spellIdLists";
import { ccSpellIds } from "../../src/data/spellTags";
import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  assertMinRows,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

/** SpellEffect.EffectAura = 39 — SPELL_AURA_SCHOOL_IMMUNITY. */
const AURA_SCHOOL_IMMUNITY = "39";
/** SpellEffect.EffectAura = 77 — SPELL_AURA_MECHANIC_IMMUNITY. */
const AURA_MECHANIC_IMMUNITY = "77";
/** a triggered aura this short is a moment on cast, not the parent's
 * standing immunity (see `isFlash`) */
const FLASH_IMMUNITY_MAX_MS = 1000;
/** SpellEffect.Effect = 3 — DUMMY. Same treatment as genSpellTargeting: a dummy
 *  row only counts when the spell has nothing else. */
const EFFECT_DUMMY = "3";

export type SpellSchoolFacts = {
  /** SpellMisc.SchoolMask — the school this spell IS. */
  school?: number;
  /** Union of every SCHOOL_IMMUNITY mask the spell grants. */
  immuneSchools?: number;
  /** Mechanic ids the spell grants immunity to (sorted, deduped). */
  immuneMechanics?: number[];
};

/** Ground truth — school masks, verified against the game 2026-08-22. */
const SCHOOL_CONTROLS: Array<[string, number, string]> = [
  ["408", 1, "Kidney Shot — physical"],
  ["1833", 1, "Cheap Shot — physical"],
  ["119381", 1, "Leg Sweep — physical"],
  ["20549", 1, "War Stomp — physical"],
  ["853", 2, "Hammer of Justice — Holy (the hand list never had it)"],
  ["51514", 8, "Hex — Nature"],
  ["5782", 32, "Fear — Shadow"],
  ["118", 64, "Polymorph — Arcane"],
];

/** Ground truth — immunity masks. */
const IMMUNITY_CONTROLS: Array<[string, number, string]> = [
  ["642", 127, "Divine Shield — every school"],
  ["1022", 1, "Blessing of Protection — physical only (the GH #29 case)"],
  ["204018", 126, "Blessing of Spellwarding — all magic, no physical"],
  ["353319", 126, "Peaceweaver — all magic"],
];

async function main(): Promise<void> {
  const build = await resolveBuild(process.argv[2]);
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;

  // Universe = the mined set ∪ every ability the class catalog names ∪ the
  // defensive lists ∪ **every known CC id**. The CC half is what makes the
  // school column useful: a CC whose school we cannot see is a CC no immunity
  // rule can reason about.
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
    ...ccSpellIds,
  ]);

  // ── schools ──────────────────────────────────────────────────────────────
  const miscParsed = parseCsv(await fetchTable("SpellMisc", build, cacheDir));
  assertColumns(
    miscParsed.header,
    ["SpellID", "DifficultyID", "SchoolMask"],
    "SpellMisc",
  );
  assertMinRows(miscParsed.rows, 300000, "SpellMisc");
  const school = new Map<string, number>();
  for (const r of miscParsed.rows) {
    if (r.DifficultyID !== "0") continue;
    if (!universe.has(r.SpellID) || school.has(r.SpellID)) continue;
    const mask = Number(r.SchoolMask);
    if (Number.isFinite(mask) && mask > 0) school.set(r.SpellID, mask);
  }

  // ── immunities ───────────────────────────────────────────────────────────
  const effectParsed = parseCsv(
    await fetchTable("SpellEffect", build, cacheDir),
  );
  assertColumns(
    effectParsed.header,
    [
      "SpellID",
      "DifficultyID",
      "Effect",
      "EffectAura",
      "EffectTriggerSpell",
      "EffectMiscValue_0",
    ],
    "SpellEffect",
  );
  assertMinRows(effectParsed.rows, 500000, "SpellEffect");

  type Row = { effect: string; aura: string; trigger: string; misc: string };
  const bySpell = new Map<string, Row[]>();
  const keep = (sid: string, row: Row): void => {
    const list = bySpell.get(sid);
    if (list) list.push(row);
    else bySpell.set(sid, [row]);
  };
  for (const r of effectParsed.rows) {
    if (r.DifficultyID !== "0") continue;
    if (!universe.has(r.SpellID)) continue;
    keep(r.SpellID, {
      effect: r.Effect,
      aura: r.EffectAura,
      trigger: r.EffectTriggerSpell,
      misc: r.EffectMiscValue_0,
    });
  }
  // One EffectTriggerSpell hop — an immunity can live on a triggered spell,
  // not on the cast id (same trap genSpellTargeting documents).
  const triggered = new Set<string>();
  for (const rows of bySpell.values())
    for (const r of rows)
      if (r.trigger && r.trigger !== "0" && !bySpell.has(r.trigger))
        triggered.add(r.trigger);
  for (const r of effectParsed.rows) {
    if (r.DifficultyID !== "0") continue;
    if (!triggered.has(r.SpellID)) continue;
    keep(r.SpellID, {
      effect: r.Effect,
      aura: r.EffectAura,
      trigger: r.EffectTriggerSpell,
      misc: r.EffectMiscValue_0,
    });
  }

  // A triggered spell whose aura lasts ≤ `FLASH_IMMUNITY_MAX_MS` is a
  // moment on cast, not a standing immunity (fact5 cxa e38f41c9: Spirit
  // Walk 58875 triggers 58876 — aura 77 root / snare, duration index 407 =
  // 100 ms — and The Hunt's root and a Master of the Glaive snare landed on
  // the shaman 3.4 s and 5.0 s into its 8 s aura, no IMMUNE row). Its
  // immunity is not the parent's.
  // fact6 F20 (Q4, user "yes", 2026-10-28): the bar is 1 s. Cloak of
  // Shadows' 35729 (1 s, all schools) gave the 5 s 31224 mask 127, while
  // the fact6 15 rounds show 27 physical direct hits landing ≥ 1 s into a
  // Cloak against 1 physical IMMUNE (002d2573-r0 0:16.8: 11 landed). The
  // same bar takes the 127 off Metamorphosis 191427 and Void Metamorphosis
  // 1217605 (a ≤ 1 s trigger each); no other id changes (build 12.1.5.70391:
  // 21 → 18 school immunities, mechanic immunities unchanged).
  const durationParsed = parseCsv(
    await fetchTable("SpellDuration", build, cacheDir),
  );
  assertColumns(durationParsed.header, ["ID", "Duration"], "SpellDuration");
  const durationMs = new Map<string, number>(
    durationParsed.rows.map((r) => [r.ID, Number(r.Duration)]),
  );
  assertColumns(miscParsed.header, ["DurationIndex"], "SpellMisc");
  const auraMs = new Map<string, number>();
  for (const r of miscParsed.rows) {
    if (r.DifficultyID !== "0" || auraMs.has(r.SpellID)) continue;
    const d = durationMs.get(r.DurationIndex);
    if (d !== undefined && d > 0) auraMs.set(r.SpellID, d);
  }
  const isFlash = (id: string): boolean =>
    (auraMs.get(id) ?? Infinity) <= FLASH_IMMUNITY_MAX_MS;

  const considered = (rows: Row[]): Row[] => {
    const real = rows.filter((r) => r.effect !== EFFECT_DUMMY);
    return real.length > 0 ? real : rows;
  };
  const immunitiesOf = (
    id: string,
    hop = true,
  ): { schools: number; mechanics: Set<number> } => {
    let schools = 0;
    const mechanics = new Set<number>();
    for (const row of considered(bySpell.get(id) ?? [])) {
      const misc = Number(row.misc);
      if (
        row.aura === AURA_SCHOOL_IMMUNITY &&
        Number.isFinite(misc) &&
        misc > 0
      )
        schools |= misc;
      if (
        row.aura === AURA_MECHANIC_IMMUNITY &&
        Number.isFinite(misc) &&
        misc > 0
      )
        mechanics.add(misc);
      if (hop && row.trigger && row.trigger !== "0" && !isFlash(row.trigger)) {
        const deep = immunitiesOf(row.trigger, false);
        schools |= deep.schools;
        for (const m of deep.mechanics) mechanics.add(m);
      }
    }
    return { schools, mechanics };
  };

  const out: Record<string, SpellSchoolFacts> = {};
  for (const id of [...universe].sort((a, b) => Number(a) - Number(b))) {
    const facts: SpellSchoolFacts = {};
    const s = school.get(id);
    if (s !== undefined) facts.school = s;
    const imm = immunitiesOf(id);
    if (imm.schools > 0) facts.immuneSchools = imm.schools;
    if (imm.mechanics.size > 0)
      facts.immuneMechanics = [...imm.mechanics].sort((a, b) => a - b);
    if (Object.keys(facts).length > 0) out[id] = facts;
  }

  // ── ground truth, both directions, before writing ────────────────────────
  const schoolMisses = SCHOOL_CONTROLS.filter(
    ([id, expected]) => out[id]?.school !== expected,
  ).map(
    ([id, expected, why]) =>
      `${id} expected ${expected} (${why}) got ${out[id]?.school}`,
  );
  const immunityMisses = IMMUNITY_CONTROLS.filter(
    ([id, expected]) => out[id]?.immuneSchools !== expected,
  ).map(
    ([id, expected, why]) =>
      `${id} expected ${expected} (${why}) got ${out[id]?.immuneSchools}`,
  );
  if (schoolMisses.length > 0 || immunityMisses.length > 0) {
    throw new Error(
      `genSpellSchools: ground-truth check failed —\n  schools: ${schoolMisses.join("; ") || "ok"}\n  immunities: ${immunityMisses.join("; ") || "ok"}`,
    );
  }

  const withSchool = Object.values(out).filter(
    (f) => f.school !== undefined,
  ).length;
  const withImmunity = Object.values(out).filter(
    (f) => f.immuneSchools !== undefined,
  ).length;
  const withMechanic = Object.values(out).filter(
    (f) => f.immuneMechanics !== undefined,
  ).length;
  const jsonPath = new URL(
    "../../src/data/spellSchoolsGenerated.json",
    import.meta.url,
  ).pathname;
  const tsPath = new URL(
    "../../src/data/spellSchoolsGenerated.ts",
    import.meta.url,
  ).pathname;
  writeArtifact(jsonPath, JSON.stringify(out) + "\n");
  writeArtifact(
    tsPath,
    `/**\n` +
      ` * Generated at: ${new Date().toISOString()}\n` +
      ` * Build: ${build}\n` +
      ` * Source: DB2 SpellMisc.SchoolMask (what school the spell IS) +\n` +
      ` *   SpellEffect aura 39 / 77 (which schools / mechanics it makes you\n` +
      ` *   immune to), one EffectTriggerSpell hop, dummy rows ignored unless\n` +
      ` *   they are all the spell has. See scripts/datagen/genSpellSchools.ts.\n` +
      ` * School mask bits: 1 Physical · 2 Holy · 4 Fire · 8 Nature · 16 Frost ·\n` +
      ` *   32 Shadow · 64 Arcane (126 = all magic, 127 = everything).\n` +
      ` * Absent field = no official row. Consumers MUST treat that as unknown\n` +
      ` *   and fall back, never as "stops nothing" (Anti-Magic Shell, Spell\n` +
      ` *   Reflection, Bladestorm and Aspect of the Turtle all have no aura 39).\n` +
      ` * ids: ${Object.keys(out).length} (${withSchool} with a school, ${withImmunity} with school immunity, ${withMechanic} with mechanic immunity)\n` +
      ` * The data lives in the .json of the same name (vite json.stringify ->\n` +
      ` * JSON.parse loading — the big-JSON lesson).\n` +
      ` */\n\n` +
      `// 静态 import,**不要改成动态**(2026-08-22 试过并回退):把这三份挪成懒加载\n` +
      `// chunk 确实让 renderer 主 chunk 从 3,360 回到 3,135 kB,但 firstPaint 反而两次都红\n` +
      `// (5215 / 5269),而静态 + 收缩宇宙那版两次都过(4488 / 4600)—— 首渲用例每次 reload\n` +
      `// 都绕缓存,多三个 chunk 的抓取代价盖过了主 chunk 变小的收益。控制体积靠**收缩宇宙**\n` +
      `// (观测集 ∪ 职业目录 ∪ 手工表),不靠拆 chunk。\n` +
      `import raw from "./spellSchoolsGenerated.json";\n\n` +
      `export type SpellSchoolFacts = {\n` +
      `  school?: number;\n` +
      `  immuneSchools?: number;\n` +
      `  immuneMechanics?: number[];\n` +
      `};\n\n` +
      `export const SPELL_SCHOOLS_GENERATED: Record<string, SpellSchoolFacts> =\n` +
      `  raw as Record<string, SpellSchoolFacts>;\n`,
  );
  console.log(
    `spellSchoolsGenerated: ${Object.keys(out).length} ids — ${withSchool} schools, ${withImmunity} school immunities, ${withMechanic} mechanic immunities (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
