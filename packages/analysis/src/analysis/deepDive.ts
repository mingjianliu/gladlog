import { CombatUnitReaction } from "@gladlog/parser-compat";

import { reconstructDispelSummary } from "../utils/dispelAnalysis";
import { analyzePlayerCCAndTrinket } from "../utils/ccTrinketAnalysis";
import {
  annotateDefensiveTimings,
  DEFENSIVE_TAGS,
  extractMajorCooldowns,
} from "../utils/cooldowns";
import { reconstructEnemyCDTimeline } from "../utils/enemyCDs";
import { getHpPercentAtTime } from "../utils/killWindowTargetSelection";
import { causalLint } from "./causalLint";
import { claimChecker, interpolate } from "../compare/claimChecker";
import type { CandidateEvent, Finding } from "./types";

/** 深挖轮(自动追问):每场最多深挖的 finding 数(高严重度优先)。 */
export const DEEP_DIVE_MAX = 2;
/** 证据包窗口:finding 锚点时刻向前/向后(秒)。 */
export const PACK_BEFORE_S = 30;
export const PACK_AFTER_S = 10;
/** 证据包条目上限(按时间序截断,防 prompt 膨胀)。 */
const PACK_MAX_ITEMS = 14;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export interface PackItem {
  /** 占位符命名空间(p1, p2, …):叙述里用 {{p1.t}} 引用。 */
  key: string;
  kind: "cc" | "defensive" | "enemy-cd" | "hp" | "dispel";
  /** 相对秒(chip 跳转锚点)。 */
  t: number;
  /** chip 文本。 */
  label: string;
  unitNames: string[];
  facts: Record<string, string>;
}

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
  const petsOf = (side: any[]) => {
    const ids = new Set(side.map((u) => u.id));
    return units.filter((u) => u.ownerId && ids.has(u.ownerId));
  };
  const enemyPets = petsOf(enemies);
  const friendlyPets = petsOf(friends);

  const raw: Omit<PackItem, "key">[] = [];

  // 受控(友方):CC 实例 + 饰品状态
  for (const u of friends) {
    try {
      const s = analyzePlayerCCAndTrinket(u, enemies, combat, enemyPets);
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
            unit: u.name,
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
              unit: u.name,
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
            player: p.playerName,
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
  for (const u of focus) {
    try {
      const checkpoints = [15, 10, 5];
      const factsHp: Record<string, string> = {};
      for (const back of checkpoints) {
        const pct = getHpPercentAtTime(
          u,
          anchorTo - PACK_AFTER_S - back,
          combat.startTime,
        );
        if (pct !== null) factsHp[`hpT${back}`] = String(Math.round(pct));
      }
      if (Object.keys(factsHp).length > 0) {
        raw.push({
          kind: "hp",
          t: anchorTo - PACK_AFTER_S,
          label: `${u.name.split("-")[0]} HP 轨迹`,
          unitNames: [u.name],
          facts: { t: fmt(anchorTo - PACK_AFTER_S), unit: u.name, ...factsHp },
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
          src: e.sourceName,
          tgt: e.targetName,
          priority: e.priority,
        },
      });
    }
  } catch {
    /* 单类缺席 */
  }

  // 截断按「靠近焦点时刻」而非纯时间序:窗口早段的密集小事件不能把
  // 死亡/锚点附近的关键证据挤出包(agy 复核 #4);选完再按时间排列出清单。
  const focusT = anchorTo - PACK_AFTER_S;
  const items: PackItem[] = raw
    .sort((a, b) => Math.abs(a.t - focusT) - Math.abs(b.t - focusT))
    .slice(0, PACK_MAX_ITEMS)
    .sort((a, b) => a.t - b.t)
    .map((it, i) => ({ ...it, key: `p${i + 1}` }));
  if (items.length === 0) return null;

  const facts: Record<string, string> = {};
  for (const it of items)
    for (const [k, v] of Object.entries(it.facts)) facts[`${it.key}.${k}`] = v;

  return { findingIndex, anchorFrom, anchorTo, items, facts };
}

/** 深挖 prompt:每个 pack 一段;审计纪律与初轮同宗(占位符/无因果/只引清单)。 */
export function buildDeepDivePrompt(
  packs: DeepDivePack[],
  findings: Finding[],
  specName: string,
): string {
  const sections = packs.map((p) => {
    const f = findings[p.findingIndex]!;
    const listing = p.items
      .map(
        (it) =>
          `  - key=${it.key} kind=${it.kind} t=${fmt(it.t)}s units=${it.unitNames.join("/")} facts={${Object.entries(
            it.facts,
          )
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
    `You are a World of Warcraft arena coach deepening findings from a ${specName}'s match review. For EACH finding below, write ONE short paragraph (3-5 sentences) that digs into the underlying play using ONLY its evidence pack.`,
    ``,
    ...sections,
    ``,
    `HARD RULES:`,
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
    // citedKeys ∪ usedKeys(agy 复核 #6:两者错位会让 chip 跳错时刻)
    const usedKeys = [
      ...new Set(
        [...entry.deepDive.matchAll(/\{\{(p\d+)\.[^}]+\}\}/g)].map(
          (m) => m[1]!,
        ),
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
