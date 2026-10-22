/**
 * Official targeting facts: does a spell's effect reach a FRIENDLY unit other
 * than the caster? Source: DB2 `SpellEffect.ImplicitTarget_0/_1`.
 *
 * Why this table exists (GH #28, 2026-08-22): the coach accused a Priest of
 * not pressing Desperate Prayer (19236) to save a dying teammate. Desperate
 * Prayer heals the caster and nobody else. No hand table was wrong — the
 * predicate simply had no "can this reach an ally at all" dimension, so every
 * Defensive-tagged cooldown in the owner's kit counted as an answer to a
 * teammate's crisis. The only list that expressed "castable on an ally"
 * (`externalDefensiveSpellIds`, 14 hand entries) is a curated list, and by
 * CLAUDE.md's Curated-List Completeness Rule it can only ever prove there are
 * no false positives — it silently missed Tranquility / Divine Hymn / Aura
 * Mastery, which DO reach allies.
 *
 * The rule (validated against both directions of ground truth, see the
 * assertions at the bottom of this script):
 *
 *  1. Take the spell's `DifficultyID == 0` effect rows.
 *  2. Prefer real effects: rows with `Effect != 3` (3 = DUMMY). Dummy rows
 *     count only when the spell has NO real rows at all. Trap this avoids:
 *     Obsidian Scales (363916) carries a leftover `Effect=3, ImplicitTarget=21
 *     (UNIT_TARGET_ALLY)` slot that would mark a self-only dragon defensive as
 *     ally-reaching. Trap the fallback preserves: Rallying Cry (97462) is
 *     implemented ENTIRELY as dummy rows (`Effect=3`, target 56 = caster-area
 *     party) and would otherwise read as self-only.
 *  3. Follow ONE `EffectTriggerSpell` hop. Trap this avoids: Divine Hymn
 *     (64843) and Tranquility (740) target only the caster themselves — the
 *     ally healing lives in the triggered spells 64844 / 157982. Measured
 *     safe on the other direction too: Cloak of Shadows (35729) and Unending
 *     Resolve (449587) trigger self-only spells, so the hop adds no false
 *     positives there.
 *  4. `reachesOthers = true` iff any considered target is in
 *     `ALLY_IMPLICIT_TARGETS`.
 *
 * `ALLY_IMPLICIT_TARGETS` is a decoding table for an official enum, not a
 * spell allowlist — but it is still a hand-maintained set, so the generator
 * ASSERTS both directions before writing (see `verify()`): every id in
 * `externalDefensiveSpellIds` (ground truth for "reaches an ally") must come
 * out true, and a control set of unambiguous personal defensives must come out
 * false. A patch that introduces a new friendly-target enum value turns this
 * script red on its next run instead of silently marking a real external
 * self-only.
 */
import fs from "fs-extra";

import { classMetadata } from "../../src/data/classSpells";
import spellIdLists from "../../src/data/spellIdLists";
import { ALLY_IMPLICIT_TARGETS } from "./lib/allyTargets";
import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  assertMinRows,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

/** Ground truth A — must all be `true`. Curated "castable on a teammate" list;
 *  this direction catches a friendly-target enum value we failed to decode. */
const MUST_REACH_ALLY = spellIdLists.externalDefensiveSpellIds as string[];

/** Ground truth B — must all be `false`. Unambiguous personal defensives (the
 *  ones the coach was wrongly demanding be spent on a teammate); this
 *  direction catches an over-broad decode. */
const MUST_BE_SELF_ONLY = [
  "19236", // Desperate Prayer (the GH #28 report)
  "642", // Divine Shield
  "45438", // Ice Block
  "871", // Shield Wall
  "48792", // Icebound Fortitude
  "104773", // Unending Resolve
  "115203", // Fortifying Brew
  "31224", // Cloak of Shadows
  "61336", // Survival Instincts
  "108271", // Astral Shift
  "363916", // Obsidian Scales (the dummy-effect trap)
  "22812", // Barkskin
  "5277", // Evasion
  "118038", // Die by the Sword
  "185311", // Crimson Vial
  "11426", // Ice Barrier
  "47585", // Dispersion
];

/** Ground truth C — must all be `false`. Enemy-facing spells, the class whose
 *  absence let the 18/87 decode bug ship: an area/destination marker on an
 *  enemy AoE must never read as "reaches a friendly unit". */
const MUST_NOT_REACH_ALLY = [
  "1680", // Whirlwind (Warrior) — enemy AoE
  "5740", // Rain of Fire (Warlock) — enemy AoE
  "43265", // Death and Decay (Death Knight) — enemy AoE
  "26573", // Consecration (Paladin) — enemy AoE
  "82691", // Ring of Frost (Mage) — enemy CC
  "179057", // Chaos Nova (Demon Hunter) — enemy CC
  "20549", // War Stomp (Tauren racial) — enemy CC
  "6544", // Heroic Leap (Warrior) — mobility, damages enemies at the landing point
];

type EffectRow = {
  effect: string;
  trigger: string;
  targets: string[];
};

/** An ENERGIZE (Effect 30) on the caster alone: the press's resource gain,
 *  not what the spell does. Divine Toll (375576) carries one (Holy Power,
 *  target 1) beside dummy rows aimed at UNIT_DEST_AREA_ALLY / _ENEMY — its
 *  real effect is the scripted Holy Shock on up to 5 units; read off the
 *  energize alone it was "self-only" and the NOTE called it a correctly
 *  HELD self defensive (fact3 D7, 0c796c56-r3 P:74). */
function isCasterEnergize(r: EffectRow): boolean {
  return r.effect === "30" && r.targets.every((t) => t === "1");
}

function considered(rows: EffectRow[]): EffectRow[] {
  const real = rows.filter((r) => r.effect !== "3" && !isCasterEnergize(r));
  return real.length > 0 ? real : rows;
}

function reachesOthers(
  spellId: string,
  bySpell: Map<string, EffectRow[]>,
  hop = true,
): boolean {
  for (const row of considered(bySpell.get(spellId) ?? [])) {
    if (row.targets.some((t) => ALLY_IMPLICIT_TARGETS.has(t))) return true;
    if (hop && row.trigger && row.trigger !== "0") {
      if (reachesOthers(row.trigger, bySpell, false)) return true;
    }
  }
  return false;
}

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
  assertColumns(
    parsed.header,
    [
      "SpellID",
      "DifficultyID",
      "Effect",
      "EffectTriggerSpell",
      "ImplicitTarget_0",
      "ImplicitTarget_1",
    ],
    "SpellEffect",
  );
  assertMinRows(parsed.rows, 500000, "SpellEffect");

  // Two passes: the universe first, then the spells its effects trigger (the
  // one hop). Rows outside both sets are dropped so the map stays small.
  const bySpell = new Map<string, EffectRow[]>();
  const add = (sid: string, row: EffectRow): void => {
    const list = bySpell.get(sid);
    if (list) list.push(row);
    else bySpell.set(sid, [row]);
  };
  const rowOf = (r: Record<string, string>): EffectRow => ({
    effect: r.Effect,
    trigger: r.EffectTriggerSpell,
    targets: [r.ImplicitTarget_0, r.ImplicitTarget_1].filter(
      (t) => t && t !== "0",
    ),
  });
  for (const r of parsed.rows) {
    if (r.DifficultyID !== "0") continue;
    if (!universe.has(r.SpellID)) continue;
    add(r.SpellID, rowOf(r));
  }
  const triggered = new Set<string>();
  for (const rows of bySpell.values())
    for (const r of rows)
      if (r.trigger && r.trigger !== "0" && !bySpell.has(r.trigger))
        triggered.add(r.trigger);
  for (const r of parsed.rows) {
    if (r.DifficultyID !== "0") continue;
    if (!triggered.has(r.SpellID)) continue;
    add(r.SpellID, rowOf(r));
  }

  const out: Record<string, boolean> = {};
  for (const id of [...universe].sort((a, b) => Number(a) - Number(b))) {
    if (!bySpell.has(id)) continue; // no official effect rows → unknown, absent
    out[id] = reachesOthers(id, bySpell);
  }

  // ── three directions of ground truth, before anything is written ─────────
  // A (must reach an ally) is checked against the EFFECTIVE predicate — the
  // generated flag OR the curated floor consumers apply — because a genuinely
  // friendly effect delivered through a summon is invisible to the official
  // one-hop walk. Which ids lean on that floor is printed, never hidden: a
  // growing list means the official derivation is losing ground.
  const floorOnly = MUST_REACH_ALLY.filter((id) => out[id] !== true);
  const missingSelf = MUST_BE_SELF_ONLY.filter((id) => out[id] !== false);
  const wrongEnemy = MUST_NOT_REACH_ALLY.filter((id) => out[id] !== false);
  if (missingSelf.length > 0 || wrongEnemy.length > 0) {
    throw new Error(
      `genSpellTargeting: ground-truth check failed — ` +
        `personal defensives wrongly marked reachesOthers: [${missingSelf.join(", ")}]; ` +
        `enemy-facing spells wrongly marked reachesOthers: [${wrongEnemy.join(", ")}]. ` +
        `ALLY_IMPLICIT_TARGETS is probably decoding a destination/enemy target as friendly.`,
    );
  }
  const CURATED_FLOOR_EXPECTED = new Set([
    "98008", // Spirit Link Totem — the ally aura lives on the summoned totem (325174)
  ]);
  const unexpectedFloor = floorOnly.filter(
    (id) => !CURATED_FLOOR_EXPECTED.has(id),
  );
  if (unexpectedFloor.length > 0) {
    throw new Error(
      `genSpellTargeting: ally-castable ids the official walk no longer explains: ` +
        `[${unexpectedFloor.join(", ")}]. Either a new friendly ImplicitTarget value ` +
        `needs decoding, or the id belongs in CURATED_FLOOR_EXPECTED with a reason.`,
    );
  }
  if (floorOnly.length > 0)
    console.log(
      `  (curated floor carries: ${floorOnly.join(", ")} — official targeting cannot see these)`,
    );

  const reaching = Object.values(out).filter(Boolean).length;
  const jsonPath = new URL(
    "../../src/data/spellTargetingGenerated.json",
    import.meta.url,
  ).pathname;
  const tsPath = new URL(
    "../../src/data/spellTargetingGenerated.ts",
    import.meta.url,
  ).pathname;
  writeArtifact(jsonPath, JSON.stringify(out) + "\n");
  writeArtifact(
    tsPath,
    `/**\n` +
      ` * Generated at: ${new Date().toISOString()}\n` +
      ` * Build: ${build}\n` +
      ` * Source: DB2 SpellEffect.ImplicitTarget_0/_1 (DifficultyID 0), dummy\n` +
      ` *   effects ignored unless they are all the spell has, one\n` +
      ` *   EffectTriggerSpell hop followed. See scripts/datagen/genSpellTargeting.ts\n` +
      ` *   for the rule, the traps it encodes and the two-directional\n` +
      ` *   ground-truth assertion.\n` +
      ` * true  = at least one effect reaches a FRIENDLY unit other than the caster\n` +
      ` * false = the spell only ever affects the caster (and/or enemies)\n` +
      ` * absent = no official effect row; consumers must fall back, never assume\n` +
      ` * ids: ${Object.keys(out).length} (${reaching} reach others)\n` +
      ` * The data lives in the .json of the same name (vite json.stringify ->\n` +
      ` * JSON.parse loading — the big-JSON lesson).\n` +
      ` */\n\n` +
      `// 静态 import,**不要改成动态**(2026-08-22 试过并回退):把这三份挪成懒加载\n` +
      `// chunk 确实让 renderer 主 chunk 从 3,360 回到 3,135 kB,但 firstPaint 反而两次都红\n` +
      `// (5215 / 5269),而静态 + 收缩宇宙那版两次都过(4488 / 4600)—— 首渲用例每次 reload\n` +
      `// 都绕缓存,多三个 chunk 的抓取代价盖过了主 chunk 变小的收益。控制体积靠**收缩宇宙**\n` +
      `// (观测集 ∪ 职业目录 ∪ 手工表),不靠拆 chunk。\n` +
      `import raw from "./spellTargetingGenerated.json";\n\n` +
      `export const SPELL_REACHES_OTHERS_GENERATED: Record<string, boolean> =\n` +
      `  raw as Record<string, boolean>;\n`,
  );
  console.log(
    `spellTargetingGenerated: ${Object.keys(out).length} ids, ${reaching} reach others (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
