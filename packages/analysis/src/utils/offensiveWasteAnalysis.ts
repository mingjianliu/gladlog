import {
  AtomicArenaCombat,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import {
  KILL_LIVE_HP_PCT,
  mitigationVerdictOf,
  type MitigationVerdict,
} from "../data/mitigationVerdicts";
import { getEnglishSpellName } from "../data/spellEffectData";
import { ccSpellIds } from "../data/spellTags";
import {
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
  specToString,
} from "./cooldowns";
import { fmtTime, toRenderSecond } from "./renderGrid";

/**
 * 2026-08-17:两张手打名单(IMMUNITY_AURAS 4 条 / MAJOR_DR_AURAS 5 条)已删除,
 * 改为消费签字裁定册 `data/mitigationVerdicts.ts`。审计查出那两张表既错又缺:
 * 消散(75%)被当成免疫;7 个真免疫里漏掉 4 个(保护祝福/破咒祝福/暗影斗篷/
 * 虚空行走),砸进去一声不吭;而「大减伤」5 条里有 3 条只有 20%(树皮术/圣佑术/
 * 铁木树皮),80% 的伤害照样打进去了却被判「浪费」。
 */

interface IOffensiveWasteCast {
  spellId: string;
  spellName: string;
  atSeconds: number;
}

interface IOffensiveWasteEvent {
  casterName: string;
  casterSpec: string;
  targetName: string;
  targetSpec: string;
  /** 该减伤在裁定册里的类别 —— 决定这条是不是无条件出面。 */
  verdict: Extract<MitigationVerdict, "unconditional" | "kill-live-gated">;
  defenseName: string;
  defenseWindowSeconds: [number, number];
  wasteCasts: IOffensiveWasteCast[];
}

interface IOffensiveWasteSummary {
  events: IOffensiveWasteEvent[];
}

interface IDefenseWindow {
  spellId: string;
  defenseName: string;
  verdict: Extract<MitigationVerdict, "unconditional" | "kill-live-gated">;
  fromSeconds: number;
  toSeconds: number;
  unitId: string;
  unitName: string;
  unitSpec: string;
  /** 用于击杀成立判定的血量采样;不参与其他逻辑。 */
  unit: ICombatUnit;
}

function buildDefenseWindows(
  enemies: ICombatUnit[],
  matchStartMs: number,
): IDefenseWindow[] {
  const windows: IDefenseWindow[] = [];

  for (const enemy of enemies) {
    const openAt: Record<string, number> = {};

    const sorted = [...enemy.auraEvents].sort(
      (a, b) => a.logLine.timestamp - b.logLine.timestamp,
    );

    for (const e of sorted) {
      const spellId = e.spellId;
      if (!spellId) continue;
      const verdict = mitigationVerdictOf(spellId);
      // "never"(不构成真实阻碍)与 "unresolved"(裁定人未遇到过)都不出面。
      if (verdict !== "unconditional" && verdict !== "kill-live-gated") continue;

      const t = (e.logLine.timestamp - matchStartMs) / 1000;

      if (e.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
        openAt[spellId] = t;
      } else if (
        e.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
        openAt[spellId] !== undefined
      ) {
        windows.push({
          spellId,
          // 英文名 —— prompt 侧禁止中文技能名(spellNameZhLint)。
          defenseName: getEnglishSpellName(spellId, spellId),
          verdict,
          fromSeconds: openAt[spellId],
          toSeconds: t,
          unitId: enemy.id,
          unitName: enemy.name,
          unitSpec: specToString(enemy.spec),
          unit: enemy,
        });
        delete openAt[spellId];
      }
    }
  }

  return windows;
}

function getHighValueSpellIds(unit: ICombatUnit): Set<string> {
  const totals: Record<string, number> = {};
  let grandTotal = 0;

  for (const dmg of unit.damageOut) {
    const id = dmg.spellId ?? "melee";
    totals[id] = (totals[id] ?? 0) + (dmg.effectiveAmount ?? 0);
    grandTotal += dmg.effectiveAmount ?? 0;
  }

  if (grandTotal === 0) return new Set(Object.keys(totals));
  const threshold = grandTotal * 0.05;
  return new Set(
    Object.entries(totals)
      .filter(([, v]) => v >= threshold)
      .map(([k]) => k),
  );
}

/**
 * 这波击杀成立吗 —— 窗口期间目标是否被打到 `KILL_LIVE_HP_PCT` 以下。
 *
 * 判据方向刻意偏向「不指责」:窗口内**任一刻**低于线就算成立,于是「顶着减伤
 * 继续打」被认定为正确操作、不产出浪费。审计结论是本系统整体过度指责
 * (docs/coaching-grounding-audit.md),这个方向是有意选的。
 *
 * 采样走共享谓词(`getUnitHpAtTimestamp` + `HP_SAMPLE_RADIUS_MS`,时刻先归
 * `toRenderSecond` 渲染网格),与 prompt 里其他 HP 声明同源。
 */
function killWasLive(w: IDefenseWindow, matchStartMs: number): boolean {
  const from = Math.floor(w.fromSeconds);
  const to = Math.ceil(w.toSeconds);
  for (let t = from; t <= to; t += 1) {
    const hp = getUnitHpAtTimestamp(
      w.unit,
      matchStartMs + toRenderSecond(t) * 1000,
      HP_SAMPLE_RADIUS_MS,
    );
    if (hp !== null && hp <= KILL_LIVE_HP_PCT) return true;
  }
  return false;
}

export function buildOffensiveWasteSummary(
  combat: Pick<AtomicArenaCombat, "startTime">,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
): IOffensiveWasteSummary {
  const matchStartMs = combat.startTime;
  const defenseWindows = buildDefenseWindows(enemies, matchStartMs);
  const events: IOffensiveWasteEvent[] = [];

  for (const friend of friends) {
    const highValueIds = getHighValueSpellIds(friend);
    const castEvents = friend.spellCastEvents.filter(
      (e) => e.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
    );

    for (const window of defenseWindows) {
      const threshold = window.verdict === "unconditional" ? 2 : 3;

      const wasteCasts: IOffensiveWasteCast[] = castEvents
        .filter((e) => {
          if (e.destUnitId !== window.unitId) return false;
          const t = (e.logLine.timestamp - matchStartMs) / 1000;
          if (t < window.fromSeconds || t > window.toSeconds) return false;
          if (e.spellId === null) return false;
          // B28: for immunity windows, also count high-value CC/utility spells that do no damage
          // (e.g. Mindgames, HoJ, Silence) which would otherwise be filtered by the damage threshold.
          const isHighValueCC =
            window.verdict === "unconditional" && ccSpellIds.has(e.spellId);
          return (
            isHighValueCC ||
            highValueIds.size === 0 ||
            highValueIds.has(e.spellId)
          );
        })
        .map((e) => ({
          spellId: e.spellId ?? "",
          spellName: e.spellName ?? "",
          atSeconds: (e.logLine.timestamp - matchStartMs) / 1000,
        }));

      if (wasteCasts.length < threshold) continue;
      // 击杀成立时顶着减伤打是正确操作 —— 只有不成立时才算该转火。
      // 无条件类不看这个:打不进去就是打不进去。
      if (window.verdict === "kill-live-gated" && killWasLive(window, matchStartMs)) {
        continue;
      }
      {
        events.push({
          casterName: friend.name,
          casterSpec: specToString(friend.spec),
          targetName: window.unitName,
          targetSpec: window.unitSpec,
          verdict: window.verdict,
          defenseName: window.defenseName,
          defenseWindowSeconds: [window.fromSeconds, window.toSeconds],
          wasteCasts,
        });
      }
    }
  }

  return { events };
}

/** Render an ability sequence with canonical English names and run-length
 * collapse of consecutive repeats (e.g. "Throw Glaive ×6") — fixes both the
 * localized-name leak and token spam from un-collapsed repeats. */
function formatAbilitySequence(casts: IOffensiveWasteCast[]): string {
  const names = casts.map((c) => getEnglishSpellName(c.spellId, c.spellName));
  const runs: { name: string; n: number }[] = [];
  for (const name of names) {
    const last = runs[runs.length - 1];
    if (last && last.name === name) last.n++;
    else runs.push({ name, n: 1 });
  }
  return runs.map((r) => (r.n > 1 ? `${r.name} ×${r.n}` : r.name)).join(" + ");
}

export function formatOffensiveWasteForContext(
  summary: IOffensiveWasteSummary,
): string {
  if (summary.events.length === 0) return "";
  const lines: string[] = ["ABILITIES INTO IMMUNITY/DR"];
  for (const ev of summary.events) {
    const t = fmtTime(ev.defenseWindowSeconds[0]);
    const spells = formatAbilitySequence(ev.wasteCasts);
    lines.push(
      `  [${t}] ${ev.casterSpec} (${ev.casterName}): ${spells} into ${ev.targetName}'s ${ev.defenseName}`,
    );
  }
  return lines.join("\n");
}
