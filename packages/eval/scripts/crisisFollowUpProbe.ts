/**
 * crisisFollowUpProbe.ts — for healer crisis points judged "no response",
 * did a CC break (trinket / racial) lead to a follow-up action, and did a
 * mobility / freedom press actually open distance? (GH #96 M4, 2026-09-14)
 *
 * User ruling (2026-09-14): a trinket or break racial alone is not a response —
 * "交了徽章或者种族技能的话,后续有没有其他动作?如果只交徽章,什么都不干的话,不是有反应";
 * mobility or Blessing of Freedom counts only if distance opened —
 * "给位移或者自由祝福的话,看有没有拉开距离".
 *
 * The product's response window is [t − 1.5 s, t + 3 s]. A break or a mobility
 * press late in that window can only pay off after it closes, so this probe
 * measures, per accusable point (feasible && dangerous && !responded) with such
 * a press, what happens in the RESPONSE_WINDOW_MS after the press itself:
 *  - break → any owner cast the predicate credits (wall / protective /
 *    external / CC-root-interrupt on an enemy) or own healing ≥ SELF_HEAL_BIG
 *    of max HP;
 *  - mobility → kitedAway (the predicate's own kite test) from the press to
 *    press + RESPONSE_WINDOW_MS.
 * Counts only; the product rule is not changed by this probe.
 *
 * Usage: npx tsx packages/eval/scripts/crisisFollowUpProbe.ts --manifest <manifest> [--every 5]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  CRISIS_PROTECTIVE_ANSWER_IDS,
  crisisDecisionPoints,
  kitedAway,
  RESPONSE_PRE_MS,
  RESPONSE_WINDOW_MS,
  SELF_HEAL_BIG,
} from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import { BREAK_RACIAL_SPELL_IDS } from "@gladlog/analysis/src/data/racialAbilities";
import spellIdLists from "@gladlog/analysis/src/data/spellIdLists";
import { ccSpellIds, rootSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import { PVP_TRINKET_SPELL_IDS } from "@gladlog/analysis/src/utils/killWindowTargetSelection";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { gunzipSync } from "zlib";

import { arg } from "./lib/cli";

const manifest = arg("--manifest", "");
const every = Number(arg("--every", "5"));

const BREAK = new Set<string>([
  ...PVP_TRINKET_SPELL_IDS,
  ...BREAK_RACIAL_SPELL_IDS,
]);
/** mobility / freedom presses seen in healer crisis windows (completeness scan) */
const MOBILITY = new Set<string>([
  "1044", // Blessing of Freedom
  "115008", // Chi Torpedo
  "109132", // Roll
  "58875", // Spirit Walk
  "768", // Cat Form
  "210053", // Mount Form
  "190784", // Divine Steed
  "121536", // Angelic Feather
  "1850", // Dash
  "252216", // Tiger Dash
  "358267", // Hover
]);
const CREDIT = new Set<string>([
  ...spellIdLists.bigDefensiveSpellIds.map(String),
  ...spellIdLists.externalDefensiveSpellIds.map(String),
  ...CRISIS_PROTECTIVE_ANSWER_IDS,
]);
const CONTROL = new Set<string>([...ccSpellIds, ...rootSpellIds]);

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

const tally = {
  rounds: 0,
  accusable: 0,
  breakPoints: 0,
  breakFollowedUp: 0,
  mobilityPoints: 0,
  mobilityOpenedDistance: 0,
  bySpell: {} as Record<string, { points: number; ok: number }>,
};
const bump = (id: string, ok: boolean) => {
  const r = (tally.bySpell[id] ??= { points: 0, ok: 0 });
  r.points++;
  if (ok) r.ok++;
};

for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(resolve(f));
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    let legacy: any;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    tally.rounds++;
    const units = Object.values(legacy.units ?? {}) as any[];
    const players = units.filter((u) => u.info);
    for (const owner of players.filter((u) => isHealerSpec(u.spec))) {
      const enemies = players.filter((u) => u.reaction !== owner.reaction);
      const enemyIds = new Set(enemies.map((u) => u.id));
      const maxHp = Math.max(
        1,
        ...((owner.advancedActions ?? []) as any[]).map(
          (x) => x.advancedActorMaxHp ?? 0,
        ),
      );
      for (const p of crisisDecisionPoints(owner, legacy, "healer")) {
        if (!(p.feasible && p.dangerous && !p.responded)) continue;
        tally.accusable++;
        const w0 = p.tMs - RESPONSE_PRE_MS;
        const w1 = p.tMs + RESPONSE_WINDOW_MS;
        const casts = ((owner.spellCastEvents ?? []) as any[]).filter(
          (c) => c.logLine?.event === LogEvent.SPELL_CAST_SUCCESS,
        );
        const attackers = [
          ...new Set(
            ((owner.damageIn ?? []) as any[])
              .filter((d) => d.timestamp > p.tMs - 2000 && d.timestamp <= p.tMs)
              .map((d) => {
                const src = legacy.units[d.srcUnitId];
                return src?.info ? src.id : src?.ownerId;
              })
              .filter((id: string | undefined) => id && enemyIds.has(id)),
          ),
        ].map((id) => legacy.units[id as string]);
        let sawBreak = false,
          breakOk = false,
          sawMob = false,
          mobOk = false;
        for (const c of casts) {
          if (c.timestamp < w0 || c.timestamp > w1) continue;
          const id = String(c.spellId ?? "");
          const from = c.timestamp,
            to = c.timestamp + RESPONSE_WINDOW_MS;
          if (BREAK.has(id)) {
            sawBreak = true;
            const follow =
              casts.some(
                (x) =>
                  x.timestamp > from &&
                  x.timestamp <= to &&
                  (CREDIT.has(String(x.spellId)) ||
                    (CONTROL.has(String(x.spellId)) &&
                      enemyIds.has(x.destUnitId))),
              ) ||
              ((owner.healIn ?? []) as any[])
                .filter(
                  (h) =>
                    h.srcUnitId === owner.id &&
                    h.timestamp > from &&
                    h.timestamp <= to,
                )
                .reduce(
                  (n, h) => n + Math.abs(h.effectiveAmount ?? h.amount ?? 0),
                  0,
                ) /
                maxHp >=
                SELF_HEAL_BIG;
            if (follow) breakOk = true;
            bump(id, follow);
          }
          if (MOBILITY.has(id)) {
            if (id === "1044" && c.destUnitId && c.destUnitId !== owner.id)
              continue;
            sawMob = true;
            const opened = kitedAway(owner, attackers, from, to);
            if (opened) mobOk = true;
            bump(id, opened);
          }
        }
        if (sawBreak) {
          tally.breakPoints++;
          if (breakOk) tally.breakFollowedUp++;
        }
        if (sawMob) {
          tally.mobilityPoints++;
          if (mobOk) tally.mobilityOpenedDistance++;
        }
      }
    }
  }
}
const home =
  process.env.GLADLOG_EVAL_HOME ??
  join(process.env.HOME ?? "", "code/gladlog-eval-private");
writeFileSync(
  join(home, "reports/talent-integration-2026-09-13/crisisFollowUp.json"),
  JSON.stringify({ files: files.length, ...tally }, null, 1),
);
console.log(JSON.stringify({ files: files.length, ...tally }, null, 1));
