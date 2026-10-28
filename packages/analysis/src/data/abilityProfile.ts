/**
 * 一个技能的**功能画像** —— GH #29 阶段 2 的地基。
 *
 * 为什么要有它:`SpellTag` 只有三个值(Defensive / Offensive / Control),而
 * 「这技能干什么」实际被拆在 89 张按 id 分类的表里(56 张纯手工、987 条手写登记、
 * 平均一个技能 2.57 张表)。三值 tag 撑不住的直接后果,2026-08-22 一天里就出了两次:
 *   · GH #28:绝望祷言只能自愈,却被要求去救垂危的队友 —— 判据没有「够不够得着
 *     队友」这一维;
 *   · GH #29 阶段 1:保护祝福是纯物理免疫,却被推荐去躲自然系的 Sleep Walk ——
 *     判据没有「学派」这一维。
 * 实测:48 个 Defensive-tagged CD 里 **11 个(22.9%)完全没有减伤/吸收/免疫**
 * (纯自愈、受治疗增益、团队治疗、产出强化),它们和真正的保命墙共用同一个牌子。
 *
 * 这个模块**只做组合,不新增判断**:每一维都来自已有的单源,官方数据优先、
 * 人工签字兜底。谁是权威在每个字段上标着:
 *
 * | 维度 | 来源 | 单源位置 |
 * |---|---|---|
 * | 学派 / 免疫学派 / 免疫机制 | 官方 DB2 | `spellSchools.ts`(SpellMisc + aura39/77) |
 * | 够不够得着队友 | 官方 DB2 + 手工兜底 | `spellTargeting.ts`(ImplicitTarget) |
 * | 减伤 % | 官方 + 人工覆盖 | `mitigationData.ts` 的 `MITIGATION_TABLE` |
 * | 吸收 / 自愈 / 他愈 / 受治疗增益 / 加速 | 官方 DB2 | `abilityEffectsGenerated`(aura69/Effect10,136/aura118,259/aura31) |
 * | 打不打敌人 / 是不是范围 / 造不造成伤害 | 官方 DB2 | 同上(ImplicitTarget 6,15,16,28,104 + Effect 2 / aura 3) |
 * | 产出强化(官方给不出) | **用户签字** | `curatedAbilityFacts.ts` kind `throughput_role` |
 * | 团队治疗 CD / 可外放 | 手工登记 | `cooldowns` 的 `TEAM_HEAL_CD_IDS` / `spellIdLists` |
 *
 * **形态光环(aura 36)的画像是空的,不等于形态没有效果**(GH #163 第 2 项,
 * 2026-10-27):效果挂在 SpellShapeshift 掩码指向这个形态的被动上,由形态开关。
 * 生命之树 33891 自身只有 aura 36/77/226,+10 % 治疗、回春 +40 % 等在被动 5420;
 * 熊形态的 aura 87 行一部分在被动 1178。官方读法不跟这一跳,所以任何「看画像判断
 * 形态干什么」的新判据都要先补这一跳。现有读者没有一个按形态光环的画像下结论
 * (33891 挂 Utility,不进治疗裁定域;形态只当状态读,见 `druidForms.ts`)。
 *
 * 迁移纪律:消费方一次换一个判据,每次带前后数字。**不要**把这里的字段当成
 * 「tag 的替代品」整体切换 —— 阶段 1 的审计数出 19 处判据直接产 prompt 文本,
 * 那是必须逐处量化的改动面,不是一次性替换。
 */
import { ABILITY_EFFECTS_GENERATED } from "./abilityEffectsGenerated";
import {
  resolveMitigation,
  strongestComponentPct,
} from "./mitigationComponents";
import {
  immunityMechanics,
  immunitySchoolMask,
  spellSchoolMask,
} from "./spellSchools";
import { reachesAlly } from "./spellTargeting";

export interface AbilityProfile {
  /** 这法术**是**什么学派(SpellMisc.SchoolMask;1 物理 / 126 全魔法)。 */
  school?: number;
  /** 按下去能不能作用到施法者以外的友方(官方 targeting + 手工外放兜底)。 */
  reachesAlly: boolean;
  /** 百分比减伤(官方挖掘 + 人工覆盖层)。 */
  mitigationPct?: number;
  /** 提供吸收护盾(aura69;DB2 不存数值,只能是布尔)。 */
  absorbs: boolean;
  /** 治疗施法者自己。 */
  healsSelf: boolean;
  /** 治疗别人(团队治疗/指向队友的治疗,含一跳触发)。 */
  healsOthers: boolean;
  /** 提高**受到**的治疗量 %(守护之魂 60、复苏之茧 50)。 */
  healingReceivedPct?: number;
  /** 加速 %。 */
  /** % movement-speed increase (aura 31 = A_MOD_INCREASE_SPEED; called hastePct until 2026-09-04 — it never was haste). */
  moveSpeedPct?: number;
  /** 效果指向敌人(官方 ImplicitTarget:指定/范围/锥形敌人)。 */
  hitsEnemy: boolean;
  /** 指向敌人且是范围/锥形,不是指定单体。 */
  enemyAoE: boolean;
  /** 造成直接或周期伤害。 */
  dealsDamage: boolean;
  /** 免疫的学派掩码(圣盾术 127、保护祝福 1、驱邪祝福 126)。 */
  immuneSchools?: number;
  /** 免疫的机制 id(12 = 昏迷等)。 */
  immuneMechanics?: number[];
  /** 用户签字:挂着 Defensive 牌子、实为自身产出强化(神圣显灵、复仇十字军)。 */
  throughputRole: boolean;
}

/** 用户签字的产出强化册(kind `throughput_role`),经 cooldowns 派生。
 *  这里用文件路径直接读签字册,避免 data → utils 的反向依赖。 */
import { CURATED_ABILITY_FACTS } from "./curatedAbilityFacts";
import { effectiveCooldownSeconds } from "./spellEffectData";
import spellIdListsData from "./spellIdLists";
const THROUGHPUT_ROLE_IDS = new Set<string>(
  CURATED_ABILITY_FACTS.filter((f) => f.kind === "throughput_role").map(
    (f) => f.id,
  ),
);

export function abilityProfile(spellId: string): AbilityProfile {
  const effects = ABILITY_EFFECTS_GENERATED[spellId];
  // GH #96 M3a: through the component resolver (self-cast profile).
  const mitigationRes = resolveMitigation(spellId, { carrierIsCaster: true });
  const mitigation = mitigationRes
    ? {
        pct: strongestComponentPct(mitigationRes, { includeImmunity: true })!
          .pctMin,
      }
    : undefined;
  return {
    school: spellSchoolMask(spellId),
    reachesAlly: reachesAlly(spellId),
    // MITIGATION_TABLE 的值是 { pct, schoolMask },不是裸数字 —— 2026-08-22 首版
    // 这里写成 `typeof x === "number"` ,于是盾墙这种 40% 大墙的 mitigationPct
    // 恒为 undefined、isSurvivalWall 恒为 false。冒烟表一眼看出来(盾墙 wall=n),
    // 所以每个新谓词都要先打一张已知答案的表出来对。
    mitigationPct: mitigation?.pct,
    absorbs: effects?.absorbs === true,
    healsSelf: effects?.healsSelf === true,
    healsOthers: effects?.healsOthers === true,
    healingReceivedPct: effects?.healingReceivedPct,
    moveSpeedPct: effects?.moveSpeedPct,
    hitsEnemy: effects?.hitsEnemy === true,
    enemyAoE: effects?.enemyAoE === true,
    dealsDamage: effects?.dealsDamage === true,
    immuneSchools: immunitySchoolMask(spellId),
    immuneMechanics: immunityMechanics(spellId),
    throughputRole: THROUGHPUT_ROLE_IDS.has(spellId),
  };
}

/**
 * 「这是不是一堵能扛住爆发的墙」—— 减伤、吸收、或学派/机制免疫,三者有其一。
 *
 * 这正是那些**问错问题**的判据真正想问的东西:cd-waste 的「有没有一堵纯保命的墙
 * 你整局没按」、低压力免责注、防御时机标签、death-unused-defensive 的「你死那刻
 * 还有哪堵本来能救你的墙」。它们现在问的是 `tag === "Defensive"` 或
 * `!isThroughput`(= 不是 Offensive,于是整个 Control 集合都算进来了)。
 *
 * 故意**不**把「自愈」算成墙:绝望祷言、振奋是回血不是扛伤,这两类在
 * 「爆发已经打在脸上」的语境里价值完全不同 —— 需要时调用方自己加
 * `healsSelf`,别把它糊进这个谓词。
 */
export function isSurvivalWall(spellId: string): boolean {
  const p = abilityProfile(spellId);
  return (
    p.mitigationPct !== undefined ||
    p.absorbs ||
    p.immuneSchools !== undefined ||
    (p.immuneMechanics?.length ?? 0) > 0
  );
}

// ── GH #31 ② (2026-09-02, user-ruled): kill-window major-defensive predicate ──

/**
 * The curated kill-window major-defensive roster — the old
 * `spellIdLists.externalOrBigDefensiveSpellIds` hand list, single-sourced
 * here, MINUS Apotheosis 200183 (user sign-off 2026-09-02: throughput CD,
 * wrong table) PLUS Ancient of Lore 473909 (audit find: user-ruled 30%
 * mitigation in GH #44, genuinely missing from the hand list).
 *
 * NEGATIVE RESULT recorded (2026-09-02, kwDefDiagScan on 200 archive files):
 * replacing this roster with the official DB2 face was tried and REVERTED —
 * `absorbs` is a boolean (DB2 stores no size), so the face admits every 30s
 * spam barrier (Ice/Prismatic/Blazing Barrier, 700 casts in 200 files) and
 * `immuneSchools` carries target-side semantics (Imprison, Time Stop), which
 * fragmented spans +12% and dropped span-kill −5pp. The face lives on as the
 * season AUDIT (kwDefAdmitScan-style: it found Ancient of Lore), never the
 * runtime predicate. Same lesson as official-data-over-heuristics: official
 * fields must be measured before trusted.
 */
export const KW_MAJOR_DEFENSIVE_IDS: ReadonlySet<string> = new Set(
  [
    ...((spellIdListsData as { externalOrBigDefensiveSpellIds?: string[] })
      .externalOrBigDefensiveSpellIds ?? []),
    "473909", // Ancient of Lore (GH #44: official 30%)
    // Triage 2026-09-29, enemy-def F-E3 — the span stayed "defenseless"
    // through these presses (2abc9185: `defenseless 0:17–1:40` across three
    // Blurs). User rulings 2026-09-30: A24 "Blur 期间不算 defenseless,切开
    // 窗口"; A25 (Burrow and Time Stop are immunities); the 2026-09-26
    // kill-live-gated verdict for Greater Invisibility, kept by C2. All four
    // are the logged CAST ids, cooldown ≥ 30 s in DB2.
    // NOT Mass Invisibility 414664 (user ruling P-b8, 2026-10-01): its aura
    // runs the full 12.0 s on 524 of 575 lines of the 605-file capture, on
    // the mage's allies too, whatever they do — in the roster it wrote
    // "Target had a major defensive up: Mass Invisibility" on 227 burst
    // lines whose target was being hit.
    "198589", // Blur — 60 s
    "110959", // Greater Invisibility — 120 s
    "409293", // Burrow — 120 s
    "378441", // Time Stop — 45 s
    // User ruling 2026-10-20 (fact1215 retest idx 45 / 47 / 48 「都要」):
    // the two 20–99 % walls signed in W1g (2026-09-26) went into
    // `bigDefensiveSpellIds` and the mitigation table but never into this
    // list, so the burst ledger never said "a major defensive up" for them
    // and the span never timed their cooldown; Dark Pact's cooldown was
    // never timed either (`defenseless 1:59–2:07` with it back since 1:58).
    "403876", // Divine Protection (Retribution) — 60 s
    "264735", // Survival of the Fittest — 90 s
    "108416", // Dark Pact — 60 s
    // User ruling 2026-10-21 (fact3 D49, 605 preview approved): Vanish, an
    // immunity-kind save (ENEMY_IMMUNITY_SAVE_AURAS) — a charge in hand keeps
    // the rogue out of `defenseless` (b3aa876f r0: `defenseless 1:10–1:31`
    // with the second charge pressed at 1:31.9). Preview: rogue [KILL
    // WINDOW] lines 1,203 → 752; kick-priority −6; 56 burst lines name it.
    "1856", // Vanish — 120 s
    // fact5 D22 (F18, 2026-10-24): the PRESSED Spirit of Redemption (Spirit
    // of the Redeemer, PvP), the immunity-kind save of fact2 ruling 5
    // (`ENEMY_IMMUNITY_SAVE_AURAS`) — the one such save this roster lacked
    // (Burrow, Time Stop and Vanish are here; Mass Invisibility is out by
    // P-b8; Guardian of the Forgotten Queen goes on an ally). 0c56ee06:
    // `defenseless 0:49–1:04` on a Holy Priest who pressed it at 1:04.8.
    "215769", // Spirit of Redemption (pressed) — 120 s
  ].filter((id) => id !== "200183"),
); // Apotheosis dropped

/** Same floor the kill-window state machine has always applied — hoisted from
 * offensiveWindows.ts's literal so scan/product/gate share one number. */
export const KW_MAJOR_DEF_MIN_CD_S = 30;

/** Cooldown seconds the kill-window family reasons with — spellEffectData's
 * official field, single-sourced here so the predicate and the span state
 * machine can never disagree on it. */
export function kwCooldownSeconds(spellId: string): number {
  return effectiveCooldownSeconds(spellId) ?? 0;
}

/**
 * Is this spell a MAJOR defensive for KILL-WINDOW purposes — i.e., while its
 * buff runs (or while it is available), the enemy is NOT "defenseless"?
 * Curated roster + >=30s cooldown (see the roster's doc comment for why the
 * official face was reverted). Deliberately NOT the same predicate as
 * cooldowns.ts's `MAJOR_DEFENSIVE_IDS` (rendering priority / self-only-claim
 * family) — documented in docs/predicate-index.md.
 */
export function isKillWindowMajorDefensive(spellId: string): boolean {
  return (
    KW_MAJOR_DEFENSIVE_IDS.has(spellId) &&
    kwCooldownSeconds(spellId) >= KW_MAJOR_DEF_MIN_CD_S
  );
}

/**
 * Major defensives that count while IN HAND but are no defense that is UP
 * (user ruling 2026-10-20, fact1215 retest idx 54 「我觉得都算」: a ready
 * Alter Time is a major defensive in hand — `defenseless 2:28–2:34` on a
 * mage whose Alter Time had been back since ~1:03). The pressed half keeps
 * fact1215 R7 (2026-10-18): a rewind is no defense that was up and cuts
 * nothing, so these never enter `KW_MAJOR_DEFENSIVE_IDS` (whose members also
 * read "Target had a major defensive up" in the burst ledger). Logged CAST
 * ids, cooldown ≥ `KW_MAJOR_DEF_MIN_CD_S` in DB2.
 */
export const KW_IN_HAND_ONLY_DEFENSIVE_IDS: ReadonlySet<string> = new Set([
  "342245", // Alter Time — 60 s (runs as 342246)
]);

/**
 * Roster members that do NOT keep their owner out of a span while unpressed
 * in its kit (user ruling 2026-10-20, 「去掉治疗和只能给队友的」 — the 605
 * preview read 2,002 lines off an unpressed Desperate Prayer): a heal, which
 * the `defenseless` legend already says is not counted, and a cooldown that
 * only reaches an ally. Pressed, they keep the machine's reading. Evidence:
 *  - heals: Desperate Prayer 19236 (`NO_MITIGATION_IDS`: pure healing + max
 *    health), Divine Hymn 64843 and Tranquility 740 (DB2 `healsOthers`, no
 *    mitigation-table row);
 *  - ally-only: Blessing of Sacrifice 6940 — 0 of 948 casts in the 605
 *    new-season files named the caster (Pain Suppression 75 of 592, Guardian
 *    Spirit 70 of 1,239, Ironbark 37 of 460, Time Dilation 29 of 383, Life
 *    Cocoon 16 of 187, Blessing of Protection 56 of 235 — those reach the
 *    caster and stay).
 * Registered in curatedIdRegistry.
 */
export const KW_UNPRESSED_NOT_IN_HAND_IDS: ReadonlySet<string> = new Set([
  "19236", // Desperate Prayer — a heal
  "64843", // Divine Hymn — a heal
  "740", // Tranquility — a heal
  "6940", // Blessing of Sacrifice — an ally only
]);

/** Does a roster defensive the unit OWNS and never pressed keep it out of
 * every span (`unusedKitRows`; user rulings 2026-10-20)? */
export function unpressedKitDefensiveInHand(spellId: string): boolean {
  return (
    countsAsKillWindowDefensiveInHand(spellId) &&
    !KW_UNPRESSED_NOT_IN_HAND_IDS.has(spellId)
  );
}

/** Does a READY charge of this spell mean the unit still holds a major
 * defensive (kill-window family: the span state machine, target selection's
 * defensive state)? The roster plus the in-hand-only rewinds. */
export function countsAsKillWindowDefensiveInHand(spellId: string): boolean {
  return (
    isKillWindowMajorDefensive(spellId) ||
    (KW_IN_HAND_ONLY_DEFENSIVE_IDS.has(spellId) &&
      kwCooldownSeconds(spellId) >= KW_MAJOR_DEF_MIN_CD_S)
  );
}
