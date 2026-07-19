import { CombatUnitReaction } from "@gladlog/parser-compat";

import { reconstructDispelSummary } from "../utils/dispelAnalysis";
import { analyzePlayerCCAndTrinket } from "../utils/ccTrinketAnalysis";
import {
  annotateDefensiveTimings,
  DEFENSIVE_TAGS,
  extractMajorCooldowns,
  isHealerSpec,
  isMeleeSpec,
  type IMajorCooldownInfo,
} from "../utils/cooldowns";
import { reconstructEnemyCDTimeline } from "../utils/enemyCDs";
import {
  analyzeBurstLedger,
  type IBurstLedgerEntry,
} from "../utils/burstLedger";
import {
  analyzeOutgoingCCChains,
  type IOutgoingCCChain,
} from "../utils/drAnalysis";
import { getHpPercentAtTime } from "../utils/killWindowTargetSelection";
import {
  computeOwnerPositionEvents,
  type IPositionEvent,
  stayedInHadRealCost,
} from "../utils/positionAnalysis";
import { causalLint } from "./causalLint";
import { fmtFactNum as fmt } from "./factFormat";
import {
  claimChecker,
  extractPlaceholderKeys,
  interpolate,
} from "../compare/claimChecker";
import type { CandidateEvent, Finding } from "./types";

/** 深挖轮(自动追问):每场最多深挖的 finding 数(高严重度优先)。 */
export const DEEP_DIVE_MAX = 2;
/** 证据包窗口:finding 锚点时刻向前/向后(秒)。 */
export const PACK_BEFORE_S = 30;
export const PACK_AFTER_S = 10;
/** 证据包条目上限(按时间序截断,防 prompt 膨胀)。 */
const PACK_MAX_ITEMS = 14;

/** 短名(去 realm):facts 里的名字用它 —— realm 常含数字(Area52),写进正文
 * 会被裸数字审计误杀;chips 的 unitNames 保留全名给回放定位。 */
const sn = (name: string) => name.split("-")[0] ?? name;

/** 走位失误的三类(修 3):只收真失误,KITED/HEALER_TRAINED 等不算。 */
const POSITION_MISTAKES = new Set<IPositionEvent["type"]>([
  "STAYED_IN",
  "MISSED_PUSH",
  "CD_OUT_OF_RANGE",
]);

export interface PackItem {
  /** 占位符命名空间(p1, p2, …):叙述里用 {{p1.t}} 引用。 */
  key: string;
  kind:
    | "cc"
    | "defensive"
    | "enemy-cd"
    | "hp"
    | "dispel"
    | "position"
    | "target-hp"
    | "enemy-defensive"
    | "immunity"
    | "our-cc"
    | "our-cd"
    | "off-target"
    | "dr-clip";
  /** 相对秒(chip 跳转锚点)。 */
  t: number;
  /** chip 文本。 */
  label: string;
  unitNames: string[];
  facts: Record<string, string>;
}

/** 进攻类 kind 集合(单源):`PackItem.kind` 的进攻子集,prompt 图例门与未来
 * 任何"是否进攻条目"判断都从这里读,别在别处重列字符串数组(会跟 union 类型脱钩)。 */
export const OFFENSIVE_KINDS = new Set<PackItem["kind"]>([
  "target-hp",
  "enemy-defensive",
  "immunity",
  "our-cc",
  "our-cd",
  "off-target",
  "dr-clip",
]);

export interface DeepDivePack {
  findingIndex: number;
  anchorFrom: number;
  anchorTo: number;
  items: PackItem[];
  /** 全部条目 facts,键 = `${item.key}.${字段}`(claimChecker 用)。 */
  facts: Record<string, string>;
}

/**
 * 深挖证据包(确定性扩容):围绕 finding 引用事件的时刻窗口
 * [minT-30, maxT+10],从既有谓词拉出初轮菜单没放的细节 —— 受控/防御施放/
 * 敌方进攻 CD/HP 轨迹/驱散。全部数值进 facts,叙述只能经占位符引用
 * (谓词单源:不新算任何事实,只换取景框)。
 */
export function buildDeepDivePack(
  combat: any,
  finding: Finding,
  findingIndex: number,
  candidates: CandidateEvent[],
  ownerName?: string,
): DeepDivePack | null {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const ts = (finding.eventIds ?? [])
    .map((id) => byId.get(id))
    .filter((c): c is CandidateEvent => !!c && Number.isFinite(c.t) && c.t > 0)
    .map((c) => c.t);
  if (ts.length === 0) return null; // 整场观察类无锚点,不深挖
  const durS = ((combat?.endTime ?? 0) - (combat?.startTime ?? 0)) / 1000;
  const anchorFrom = Math.max(0, Math.min(...ts) - PACK_BEFORE_S);
  const anchorTo = Math.min(durS, Math.max(...ts) + PACK_AFTER_S);
  const inWin = (t: number) => t >= anchorFrom && t <= anchorTo;

  const units = Object.values(combat?.units ?? {}) as any[];
  const players = units.filter((u) => u.info);
  const friends = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = players.filter(
    (u) => u.reaction !== CombatUnitReaction.Friendly,
  );
  if (friends.length === 0 || enemies.length === 0) return null;
  // role 标签(修 2):owner=被教的人,教练落点优先它;teammate/enemy 仅背景。
  const friendlyRole = (fullName: string) =>
    ownerName && fullName === ownerName ? "owner" : "teammate";
  const petsOf = (side: any[]) => {
    const ids = new Set(side.map((u) => u.id));
    return units.filter((u) => u.ownerId && ids.has(u.ownerId));
  };
  const enemyPets = petsOf(enemies);
  const friendlyPets = petsOf(friends);
  const ownerUnit = ownerName
    ? friends.find((u) => u.name === ownerName)
    : undefined;
  // 走位分析(修 3)复用 owner 的 CC/CD 摘要,循环里顺手捕获,不重复算。
  let ownerCcSummary: ReturnType<typeof analyzePlayerCCAndTrinket> | undefined;
  let ownerCds: IMajorCooldownInfo[] | undefined;

  const raw: Omit<PackItem, "key">[] = [];

  // 受控(友方):CC 实例 + 饰品状态
  for (const u of friends) {
    try {
      const s = analyzePlayerCCAndTrinket(u, enemies, combat, enemyPets);
      if (u === ownerUnit) ownerCcSummary = s;
      for (const cc of s.ccInstances) {
        if (!inWin(cc.atSeconds)) continue;
        raw.push({
          kind: "cc",
          t: cc.atSeconds,
          label: `${cc.spellName} → ${u.name.split("-")[0]}(${cc.durationSeconds.toFixed(1)}s)`,
          unitNames: [u.name],
          facts: {
            t: fmt(cc.atSeconds),
            spell: cc.spellName,
            unit: sn(u.name),
            role: friendlyRole(u.name),
            duration: cc.durationSeconds.toFixed(1),
            trinket: cc.trinketState,
          },
        });
      }
    } catch {
      /* 单类缺席 */
    }
  }

  // 防御施放(友方,含 timing 审计标签)
  let enemyTl: ReturnType<typeof reconstructEnemyCDTimeline> | null = null;
  for (const u of friends) {
    try {
      enemyTl = enemyTl ?? reconstructEnemyCDTimeline(enemies, combat);
      const cds = annotateDefensiveTimings(
        extractMajorCooldowns(u, combat),
        u,
        combat,
        enemyTl,
      );
      if (u === ownerUnit) ownerCds = cds;
      for (const cd of cds) {
        if (!DEFENSIVE_TAGS.has(cd.tag)) continue;
        for (const cast of cd.casts) {
          if (!inWin(cast.timeSeconds)) continue;
          raw.push({
            kind: "defensive",
            t: cast.timeSeconds,
            label: `${cd.spellName}(${u.name.split("-")[0]})`,
            unitNames: [u.name],
            facts: {
              t: fmt(cast.timeSeconds),
              spell: cd.spellName,
              unit: sn(u.name),
              role: friendlyRole(u.name),
              ...(cast.timingLabel && cast.timingLabel !== "Unknown"
                ? { timing: cast.timingLabel }
                : {}),
            },
          });
        }
      }
    } catch {
      /* 单类缺席 */
    }
  }

  // 敌方进攻 CD 施放
  try {
    enemyTl = enemyTl ?? reconstructEnemyCDTimeline(enemies, combat);
    for (const p of enemyTl.players) {
      for (const cd of p.offensiveCDs) {
        if (!inWin(cd.castTimeSeconds)) continue;
        raw.push({
          kind: "enemy-cd",
          t: cd.castTimeSeconds,
          label: `敌 ${cd.spellName}(${p.playerName.split("-")[0]})`,
          unitNames: [p.playerName],
          facts: {
            t: fmt(cd.castTimeSeconds),
            spell: cd.spellName,
            player: sn(p.playerName),
            role: "enemy",
          },
        });
      }
    }
  } catch {
    /* 单类缺席 */
  }

  // HP 轨迹:finding 点名的友方单位在锚点前的检查点(采样纪律在 helper 内)
  const focus = friends.filter((u) =>
    (finding.eventIds ?? []).some((id) =>
      byId.get(id)?.unitNames.includes(u.name),
    ),
  );
  // 焦点 = 最末锚点(死亡/高潮时刻)。**不要**写成 anchorTo - PACK_AFTER_S:
  // anchorTo 被 durS 夹过,一旦比赛在锚点后 <PACK_AFTER_S 秒就结束(竞技场里
  // 决定性死亡恰恰就是比赛结束的原因,这是常态不是边角),反推回来会比真锚点早,
  // HP 检查点与截断中心一起前移(实测 100s 死/105s 结束 → focusT 早 5s,
  // 三个「死前血线」全部错位)。进攻路径的 focusT 用 Math.min(首锚点=起手)——
  // 两条路径语义本就不同,不要强行统一。
  const focusT = Math.max(...ts);
  for (const u of focus) {
    try {
      // 逐检查点独立条目:t=真实时刻(占位符)、hp=血量(占位符),不再把
      // 偏移量 15/10/5 编进 key 名 —— 那会诱导模型写「死前 15 秒」的裸数字
      // 被审计丢(2026-07-19 纪律 smoke 实测根因)。
      for (const back of [15, 10, 5]) {
        const tPt = focusT - back;
        if (tPt < 0) continue;
        const pct = getHpPercentAtTime(u, tPt, combat.startTime);
        if (pct === null) continue;
        raw.push({
          kind: "hp",
          t: tPt,
          label: `${sn(u.name)} HP ${Math.round(pct)}%`,
          unitNames: [u.name],
          facts: {
            t: fmt(tPt),
            unit: sn(u.name),
            role: friendlyRole(u.name),
            hp: String(Math.round(pct)),
          },
        });
      }
    } catch {
      /* 单类缺席 */
    }
  }

  // 驱散(全部优先级)
  try {
    const ds = reconstructDispelSummary(
      friends,
      enemies,
      combat,
      friendlyPets,
      enemyPets,
    );
    for (const e of [...ds.allyCleanse, ...ds.ourPurges]) {
      if (!inWin(e.timeSeconds)) continue;
      raw.push({
        kind: "dispel",
        t: e.timeSeconds,
        label: `${e.dispelSpellName} 解 ${e.removedSpellName}`,
        unitNames: [e.sourceName, e.targetName],
        facts: {
          t: fmt(e.timeSeconds),
          spell: e.dispelSpellName,
          removed: e.removedSpellName,
          src: sn(e.sourceName),
          tgt: sn(e.targetName),
          role: friendlyRole(e.sourceName),
          priority: e.priority,
        },
      });
    }
  } catch {
    /* 单类缺席 */
  }

  // 走位失误(修 3):owner 的 STAYED_IN/MISSED_PUSH/CD_OUT_OF_RANGE 落在窗口内。
  // 补上资源信号看不见的「死于走位」缺口(519 场调查:救回贼 9/40、Havoc 4/9)。
  if (ownerUnit && enemyTl) {
    try {
      const posEvents = computeOwnerPositionEvents({
        owner: ownerUnit,
        enemies,
        combat,
        burstWindows: enemyTl.alignedBurstWindows,
        ownerCooldowns: ownerCds ?? [],
        ownerCCSummary: ownerCcSummary,
        isHealer: isHealerSpec(ownerUnit.spec),
        ownerIsMelee: isMeleeSpec(ownerUnit.spec),
        friends,
      });
      for (const e of posEvents) {
        if (!POSITION_MISTAKES.has(e.type)) continue;
        if (!inWin(e.atSeconds)) continue;
        const f: Record<string, string> = {
          t: fmt(e.atSeconds),
          role: "owner",
          kind:
            e.type === "STAYED_IN"
              ? "stayed-in"
              : e.type === "MISSED_PUSH"
                ? "missed-push"
                : "cd-out-of-range",
        };
        if (e.nearestEnemyName) f.enemy = sn(e.nearestEnemyName);
        if (e.dangerLabel) f.threat = e.dangerLabel;
        if (e.type === "STAYED_IN") {
          // hpStart 与 hpMin 成对给:门要靠「起始→最低」的跌幅判断有无代价
          // (stayedInHadRealCost),模型也能据此说「从满血被打到 X」。
          if (e.ownerHpStartPct != null)
            f.hpStart = String(Math.round(e.ownerHpStartPct));
          if (e.ownerHpMinPct != null)
            f.hpMin = String(Math.round(e.ownerHpMinPct));
          if (e.ownerDefensiveAvailable !== undefined)
            f.defAvail = e.ownerDefensiveAvailable ? "yes" : "no";
        }
        if (e.type === "MISSED_PUSH" && e.startDistanceYards != null)
          f.dist = String(Math.round(e.startDistanceYards));
        if (e.type === "CD_OUT_OF_RANGE" && e.spellName) f.spell = e.spellName;
        const label =
          e.type === "STAYED_IN"
            ? `走位:停留承压`
            : e.type === "MISSED_PUSH"
              ? `走位:脱节`
              : `走位:${e.spellName ?? "大招"}空放`;
        raw.push({
          kind: "position",
          t: e.atSeconds,
          label,
          unitNames: [ownerUnit.name],
          facts: f,
        });
      }
    } catch {
      /* 走位分析需高级日志/几何,缺则该类缺席 */
    }
  }

  // 截断按「靠近焦点时刻」而非纯时间序:窗口早段的密集小事件不能把
  // 死亡/锚点附近的关键证据挤出包(agy 复核 #4);选完再按时间排列出清单。
  // focusT 已在 HP 段声明(= 最末锚点 Math.max(...ts))。
  const items: PackItem[] = raw
    .sort((a, b) => Math.abs(a.t - focusT) - Math.abs(b.t - focusT))
    .slice(0, PACK_MAX_ITEMS)
    .sort((a, b) => a.t - b.t)
    .map((it, i) => ({ ...it, key: `p${i + 1}` }));
  if (items.length === 0) return null;
  // 可教信号门(修 1)由调用方施用:hasCoachableSignal(pack.items) → false 则跳过。
  // 门放调用方而非这里,职责分离(构包 vs 是否值得深挖),eval 也能一路量 before/after。

  const facts: Record<string, string> = {};
  for (const it of items)
    for (const [k, v] of Object.entries(it.facts)) facts[`${it.key}.${k}`] = v;

  return { findingIndex, anchorFrom, anchorTo, items, facts };
}

export interface OffensiveMapInput {
  entries: IBurstLedgerEntry[];
  healerChains: IOutgoingCCChain[];
  candFacts: Record<string, string>[];
  candTypes: string[];
  ownerName?: string;
  inWin: (t: number) => boolean;
}

/** 进攻证据 → PackItem(纯):目标血线/敌方防御免疫/我方对敌奶 CC/大招对齐 + 类型专属条。 */
export function offensivePackItems(
  inp: OffensiveMapInput,
): Omit<PackItem, "key">[] {
  const raw: Omit<PackItem, "key">[] = [];
  const ownerShort = inp.ownerName ? sn(inp.ownerName) : undefined;
  // 全名比较(agy 复核):短名会在跨服撞名(同名不同服)时把队友误判成 owner —
  // 与 buildDeepDivePack 的 friendlyRole 同款,role 只认全名,display 仍用短名。
  const role = (name: string) =>
    inp.ownerName && name === inp.ownerName ? "owner" : "teammate";

  for (const e of inp.entries) {
    if (!inp.inWin(e.fromSeconds) && !inp.inWin(e.toSeconds)) continue;
    const t = e.dominantTarget;
    if (t) {
      // 目标血线:start(burst 起)+ end(burst 止),取自 ledger 已算值(谓词单源)
      if (t.hpStartPct != null && inp.inWin(e.fromSeconds))
        raw.push({
          kind: "target-hp",
          t: e.fromSeconds,
          label: `${sn(t.unitName)} HP`,
          unitNames: [t.unitName],
          facts: {
            t: fmt(e.fromSeconds),
            hp: String(t.hpStartPct),
            unit: sn(t.unitName),
            role: "enemy-target",
          },
        });
      if (t.hpEndPct != null && inp.inWin(e.toSeconds))
        raw.push({
          kind: "target-hp",
          t: e.toSeconds,
          label: `${sn(t.unitName)} HP`,
          unitNames: [t.unitName],
          facts: {
            t: fmt(e.toSeconds),
            hp: String(t.hpEndPct),
            unit: sn(t.unitName),
            role: "enemy-target",
          },
        });
      // 窗口守卫(agy 复核):这条固定锚在 e.fromSeconds,外层 guard 是
      // fromSeconds OR toSeconds 命中就放行整条 entry,单独补 inWin 防止
      // fromSeconds 落在窗口外时仍把该条目时刻标在窗口外(pack 的
      // anchorFrom/anchorTo 是 prompt 里明写的范围,条目时刻不能越界)。
      if (inp.inWin(e.fromSeconds))
        for (const d of t.defensivesHit) {
          raw.push({
            kind: d.isImmunity ? "immunity" : "enemy-defensive",
            t: e.fromSeconds,
            label: `${d.spellName}(${sn(t.unitName)})`,
            unitNames: [t.unitName],
            facts: {
              t: fmt(e.fromSeconds),
              spell: d.spellName,
              unit: sn(t.unitName),
              role: "enemy",
              ...(d.isImmunity ? { overlap: d.overlapSeconds.toFixed(1) } : {}),
            },
          });
        }
    }
    // 我方大招对齐(owner 自身 spells + ally 重叠)
    for (const s of e.spells)
      if (inp.inWin(s.castTimeSeconds))
        raw.push({
          kind: "our-cd",
          t: s.castTimeSeconds,
          label: `${s.spellName}`,
          unitNames: inp.ownerName ? [inp.ownerName] : [],
          facts: {
            t: fmt(s.castTimeSeconds),
            spell: s.spellName,
            unit: ownerShort ?? "owner",
            role: "owner",
          },
        });
    if (inp.inWin(e.fromSeconds))
      for (const a of e.allyCDsOverlapping)
        raw.push({
          kind: "our-cd",
          t: e.fromSeconds,
          label: `${a.spellName}(${sn(a.playerName)})`,
          unitNames: [a.playerName],
          facts: {
            t: fmt(e.fromSeconds),
            spell: a.spellName,
            unit: sn(a.playerName),
            role: role(a.playerName),
          },
        });
  }

  // 我方对敌奶 CC 链(窗口内)
  for (const chain of inp.healerChains)
    for (const app of chain.applications) {
      if (!inp.inWin(app.atSeconds)) continue;
      raw.push({
        kind: "our-cc",
        t: app.atSeconds,
        label: `${app.spellName} → ${sn(chain.targetName)}`,
        unitNames: [app.casterName],
        facts: {
          t: fmt(app.atSeconds),
          spell: app.spellName,
          unit: sn(chain.targetName),
          caster: sn(app.casterName),
          role: role(app.casterName),
        },
      });
    }

  // 类型专属条(承接候选自带 facts;名字短名)
  inp.candTypes.forEach((type, i) => {
    const cf = inp.candFacts[i] ?? {};
    const tt = Number(cf.t);
    if (type === "off-target-in-window")
      raw.push({
        kind: "off-target",
        t: Number.isFinite(tt) ? tt : 0,
        label: `脱靶`,
        unitNames: [],
        facts: {
          ...(cf.t ? { t: cf.t } : {}),
          role: "owner",
          ...(cf.onTargetPct ? { onTargetPct: cf.onTargetPct } : {}),
          ...(cf.offTarget ? { target: sn(cf.offTarget) } : {}),
        },
      });
    // juked-kick 已从进攻深挖降级(Task 6 A/B:5 类里唯一均值 <3.5,combined 2.9,
    // 四个 ≤2 分全是它 —— 「读假招别乱踢」是自明的泛化建议,深挖只是硬套上下文,
    // 不产生新洞察。仍作初轮 finding 保留,只是不深挖)。故此处不再产 juked 条目。
    if (type === "dr-clipped-cc")
      raw.push({
        kind: "dr-clip",
        t: Number.isFinite(tt) ? tt : 0,
        label: `踩 DR`,
        unitNames: [],
        facts: {
          ...(cf.t ? { t: cf.t } : {}),
          role: "owner",
          ...(cf.spell ? { spell: cf.spell } : {}),
          ...(cf.target ? { target: sn(cf.target) } : {}),
          ...(cf.dr ? { dr: cf.dr } : {}),
        },
      });
  });

  return raw;
}

export function buildOffensiveDeepDivePack(
  combat: any,
  finding: Finding,
  findingIndex: number,
  candidates: CandidateEvent[],
  ownerName?: string,
): DeepDivePack | null {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const cands = (finding.eventIds ?? [])
    .map((id) => byId.get(id))
    .filter((c): c is CandidateEvent => !!c);
  const ts = cands
    .filter((c) => Number.isFinite(c.t) && c.t > 0)
    .map((c) => c.t);
  if (ts.length === 0) return null;
  const durS = ((combat?.endTime ?? 0) - (combat?.startTime ?? 0)) / 1000;
  const anchorFrom = Math.max(0, Math.min(...ts) - PACK_BEFORE_S);
  const anchorTo = Math.min(durS, Math.max(...ts) + PACK_AFTER_S);
  const inWin = (t: number) => t >= anchorFrom && t <= anchorTo;

  const units = Object.values(combat?.units ?? {}) as any[];
  const players = units.filter((u) => u.info);
  const friends = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = players.filter(
    (u) => u.reaction !== CombatUnitReaction.Friendly,
  );
  if (friends.length === 0 || enemies.length === 0) return null;
  const owner = ownerName
    ? friends.find((u) => u.name === ownerName)
    : undefined;
  if (!owner) return null;

  let entries: IBurstLedgerEntry[] = [];
  let healerChains: IOutgoingCCChain[] = [];
  try {
    entries = analyzeBurstLedger(owner, friends, enemies, combat);
  } catch {
    /* 无高级日志 */
  }
  try {
    const enemyHealers = new Set(
      enemies.filter((e) => isHealerSpec(e.spec)).map((e) => e.name),
    );
    healerChains = analyzeOutgoingCCChains(friends, enemies, combat).filter(
      (c) => enemyHealers.has(c.targetName),
    );
  } catch {
    /* 缺席 */
  }

  const raw = offensivePackItems({
    entries,
    healerChains,
    candFacts: cands.map((c) => c.facts),
    candTypes: cands.map((c) => c.type),
    ownerName,
    inWin,
  });
  if (raw.length === 0) return null;

  // 截断:靠近焦点时刻(复用死亡 pack 同逻辑)
  const focusT = Math.min(...ts);
  const items: PackItem[] = raw
    .sort((a, b) => Math.abs(a.t - focusT) - Math.abs(b.t - focusT))
    .slice(0, PACK_MAX_ITEMS)
    .sort((a, b) => a.t - b.t)
    .map((it, i) => ({ ...it, key: `p${i + 1}` }));

  const facts: Record<string, string> = {};
  for (const it of items)
    for (const [k, v] of Object.entries(it.facts)) facts[`${it.key}.${k}`] = v;
  return { findingIndex, anchorFrom, anchorTo, items, facts };
}

/**
 * 可教信号(修 1):包内是否含 ≥1 条「我方可控失误」—— 判据全用 pack facts,
 * 与 death-setup 三型同源:防御交早/晚、被控时饰品在手没交、敌方大 CD 开着
 * 时刷低优先级驱散(浪费 GCD)。无信号 = 干净窗口,不值得一轮模型调用。
 */
export function hasCoachableSignal(items: PackItem[]): boolean {
  const enemyCdInWin = items.some((i) => i.kind === "enemy-cd");
  return items.some((it) => {
    const f = it.facts;
    if (f.role === "enemy") return false; // 只看我方可控
    if (
      it.kind === "defensive" &&
      (f.timing === "Early" || f.timing === "Late")
    )
      return true;
    // 仅 ≥3s 硬控算"饰品该交没交":微控/打断不交饰品是常态不是失误(220 场
    // 确定性实测:不设时长门时 available_unused 命中 242 次、门形同虚设)。
    if (
      it.kind === "cc" &&
      f.trinket === "available_unused" &&
      Number(f.duration) >= 3
    )
      return true;
    if (it.kind === "dispel" && f.priority === "Low" && enemyCdInWin)
      return true;
    // 走位失误:MISSED_PUSH/空放本身即失误,直通;STAYED_IN 必须付出真实代价才算
    // —— 判据与 context formatter 的 "(no real cost)" 标签同源(周度复核 P1#1:
    // 那里曾写着「STAYED_IN 已经只在掉血时触发」,而源头从未按 HP 过滤)。
    if (it.kind === "position") {
      if (f.kind !== "stayed-in") return true;
      return stayedInHadRealCost(
        f.hpMin === undefined ? null : Number(f.hpMin),
        f.hpStart === undefined ? null : Number(f.hpStart),
      );
    }
    return false;
  });
}

/** 进攻深挖:目标触底阈值(%);低于它 + 有(非免疫)防御接了 = 「该控奶/该换端」。 */
const OFFENSIVE_HP_THRESHOLD = 35;

/**
 * 进攻信号(进攻深挖门):非死亡候选已 pre-curate 为失误,门轻 —— 要求进攻故事在场。
 * 免疫单独即可教:把爆发砸进免疫本身就是失误(该追踪敌方免疫、别硬开),不要求目标
 * 也触底 —— 免疫恰恰阻止了掉血,再要求 ≤35% 逻辑自相矛盾(519 场扫描实测:合门时
 * burst-into-immunity 仅 10% 过门,漏掉了旗舰进攻失误)。其余:目标被打低且有非免疫
 * 防御接了(该控奶/换端),或 off-target/dr-clip 各自即失误。
 * (juked-kick 已降级,不进进攻深挖 —— 见 offensivePackItems 注释与 OFFENSIVE_CANDIDATE_TYPES。)
 */
export function hasOffensiveCoachableSignal(items: PackItem[]): boolean {
  if (items.some((i) => i.kind === "immunity")) return true;
  const targetBottomed = items.some(
    (i) =>
      i.kind === "target-hp" && Number(i.facts.hp) <= OFFENSIVE_HP_THRESHOLD,
  );
  const defensiveAnswered = items.some((i) => i.kind === "enemy-defensive");
  if (targetBottomed && defensiveAnswered) return true;
  return items.some((i) => i.kind === "off-target" || i.kind === "dr-clip");
}

// juked-kick 剔除(Task 6 A/B):进攻深挖只留价值 ≥4.4 的四类;juked-kick 深挖 combined
// 2.9(唯一 <3.5),故降级为只作初轮 finding,不路由进攻深挖(→ classify 归 survival,
// 生存门不命中即不深挖)。
const OFFENSIVE_CANDIDATE_TYPES = new Set([
  "unconverted-burst",
  "burst-into-immunity",
  "off-target-in-window",
  "dr-clipped-cc",
]);

/** 分发:finding 引用候选多数派决定路由;平票偏 survival(死亡教练价值锚定更强)。 */
export function classifyFindingKind(
  finding: Finding,
  candidates: CandidateEvent[],
): "survival" | "offensive" {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  let off = 0,
    surv = 0;
  for (const id of finding.eventIds ?? []) {
    const t = byId.get(id)?.type;
    if (!t) continue;
    if (OFFENSIVE_CANDIDATE_TYPES.has(t)) off++;
    else surv++;
  }
  return off > surv ? "offensive" : "survival";
}

/** 深挖 prompt:每个 pack 一段;审计纪律与初轮同宗(占位符/无因果/只引清单)。 */
export function buildDeepDivePrompt(
  packs: DeepDivePack[],
  findings: Finding[],
  specName: string,
  ownerName?: string,
): string {
  const ownerShort = ownerName ? ownerName.split("-")[0] : "the log owner";
  const sections = packs.map((p) => {
    const f = findings[p.findingIndex]!;
    const listing = p.items
      .map(
        // units= 不印:名字已在 facts(unit/player/src/tgt),独立 token 会
        // 诱导模型写 {{pN.units}} 这个不存在的占位符 → 整条被 claimChecker 丢
        // (2026-07-19 深挖纪律 smoke 实测:3/6 失败全栽在 .units 幽灵字段)。
        (it) =>
          `  - key=${it.key} kind=${it.kind} facts={${Object.entries(it.facts)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")}}`,
      )
      .join("\n");
    return [
      `FINDING ${p.findingIndex}: [${f.severity}] ${f.title} — ${f.explanation}`,
      `EVIDENCE PACK ${p.findingIndex} (window ${fmt(p.anchorFrom)}s–${fmt(p.anchorTo)}s; the ONLY additional evidence you may reference):`,
      listing,
    ].join("\n");
  });
  return [
    `You are a World of Warcraft arena coach deepening findings from ${ownerShort}'s (a ${specName}) match review. You are coaching ${ownerShort} — the person reviewing their own game. For a finding, write ONE short paragraph (3-5 sentences) ONLY IF you can name a specific decision ${ownerShort}'s team could have made differently, grounded in the evidence pack.`,
    ``,
    ...sections,
    ``,
    `HARD RULES:`,
    `- Coach ${ownerShort} (facts with role=owner). role=teammate / role=enemy items are context only — cite a teammate's mistake ONLY when ${ownerShort} could have covered it (peel/CC the attacker, give an external, swap targets).`,
    `- kind=position items are ${ownerShort}'s own movement: kind=stayed-in = stood in a threat and took avoidable damage (hpMin is where HP bottomed, defAvail says if a defensive was up); kind=missed-push = drifted out of range (dist yards) when pressure was needed; kind=cd-out-of-range = fired a cooldown (spell) with no valid target in range. Coach the movement decision, not just cooldown usage.`,
    ...(packs.some((p) => p.items.some((it) => OFFENSIVE_KINDS.has(it.kind)))
      ? [
          `- Offensive items (non-death findings): kind=target-hp = the enemy target's HP (hp) at that moment; kind=enemy-defensive / kind=immunity = what answered ${ownerShort}'s burst on that target (immunity has overlap seconds); kind=our-cc = ${ownerShort}'s team CC landed on the enemy healer; kind=our-cd = ${ownerShort}'s team offensive cooldown; kind=off-target = damage went to the wrong target (onTargetPct); kind=dr-clip = a CC landed on wasted DR (dr). You had the kill set up — coach what to change to close it (swap to the exposed target, hold burst past the immunity, lock their healer first), not survival.`,
        ]
      : []),
    `- If, after reviewing a pack, you cannot name a specific ${ownerShort}-team decision that was clearly suboptimal, OMIT that finding from your output entirely. Do NOT manufacture generic advice ("use defensives better", "peel/reposition", "watch HP"). A clean window is a valid outcome — say nothing rather than pad.`,
    `- Prefer a firm verdict ("trinket the second stun, not the first") over hedging ("worth reconsidering whether...").`,
    `- Reference only pack items; list the keys you used in "citedKeys" (non-empty).`,
    `- Write NO digits in "deepDive". Every number must be a {{key.field}} placeholder from that finding's pack (e.g. {{p1.t}}, {{p2.duration}}). Words for counts ("twice", "briefly") are fine.`,
    `- Do NOT assert causation ("led to"/"caused"/"resulted in" a death/loss). Describe the sequence neutrally and coach what to do differently at these moments.`,
    ``,
    `Output ONLY a JSON array: [{ "findingIndex": number, "deepDive": string, "citedKeys": string[] }]`,
  ].join("\n");
}

export interface DeepDiveResult {
  findingIndex: number;
  /** 已插值的叙述文本。 */
  text: string;
  /** 引用的证据 chips(跳回放锚点)。 */
  chips: Array<{ t: number; label: string; unitNames: string[] }>;
}

/**
 * 深挖审计:占位符必须命中该 finding 的 pack facts(claimChecker)、无因果
 * 断言(causalLint)、citedKeys ⊆ pack 且非空。任一违规 → 丢弃该条
 * (finding 静默保持初轮内容)。
 */
export function auditDeepDives(
  parsed: unknown,
  packs: DeepDivePack[],
): DeepDiveResult[] {
  if (!Array.isArray(parsed)) return [];
  const byIndex = new Map(packs.map((p) => [p.findingIndex, p]));
  const out: DeepDiveResult[] = [];
  for (const entry of parsed as Array<{
    findingIndex?: number;
    deepDive?: string;
    citedKeys?: string[];
  }>) {
    const pack =
      entry.findingIndex !== undefined ? byIndex.get(entry.findingIndex) : null;
    if (!pack || typeof entry.deepDive !== "string") continue;
    const valid = new Set(pack.items.map((i) => i.key));
    // 文本里实际使用的 pack 键({{pK.field}}):必须全部合法;chips 取
    // citedKeys ∪ usedKeys(agy 复核 #6:两者错位会让 chip 跳错时刻)。
    // 占位符正则从 claimChecker 单源取 —— 本地自写会与它漂开(周度复核新#1:
    // 旧的 /\{\{(p\d+)\.[^}]+\}\}/ 不容忍 `{{ p1.t }}` 的空格,claimChecker 却容忍)。
    const usedKeys = [
      ...new Set(
        extractPlaceholderKeys(entry.deepDive)
          .map((k) => k.split(".")[0]!)
          .filter((ns) => /^p\d+$/.test(ns)),
      ),
    ];
    if (!usedKeys.every((k) => valid.has(k))) continue;
    const keys = [...new Set([...(entry.citedKeys ?? []), ...usedKeys])];
    if (keys.length === 0 || !keys.every((k) => valid.has(k))) continue;
    if (!claimChecker(entry.deepDive, pack.facts).ok) continue;
    // 裸数字禁令(镜像 auditFindings 的严格层:共享 checker 放行会话整数,
    // 这里与初轮同纪律 —— 占位符外任何数字 = 编造或抗命)
    const prose = entry.deepDive
      .replace(/\{\{[^}]*\}\}/g, " ")
      .replace(/\b\d+v\d+\b/gi, " ");
    if (/\d/.test(prose)) continue;
    if (causalLint(entry.deepDive).length > 0) continue;
    const itemsByKey = new Map(pack.items.map((i) => [i.key, i]));
    out.push({
      findingIndex: pack.findingIndex,
      text: interpolate(entry.deepDive, pack.facts),
      chips: keys
        .map((k) => itemsByKey.get(k)!)
        .sort((a, b) => a.t - b.t)
        .map((i) => ({ t: i.t, label: i.label, unitNames: i.unitNames })),
    });
  }
  return out;
}
