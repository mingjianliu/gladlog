/**
 * crisisPassiveResponseProbe.ts — GH #93 step 1 (codex R3 criterion): how often
 * does crisisDecisionPoints call a healer "responded" only because of
 *  (a) healing that was already ticking (a HoT placed before the window), or
 *  (b) distance the ATTACKERS opened by moving away?
 *
 * Classification per dangerous feasible responded point (healer role):
 *  (a) selfHeal arm: split the owner's own healing in (t, t + 3 s] into heals
 *      whose spell the owner cast inside the response window [t − 1.5 s,
 *      t + 3 s] ("new") and the rest ("carried": a HoT or absorb-heal from an
 *      earlier press). passive-only = selfHeal is the ONLY arm and new healing
 *      alone stays under SELF_HEAL_BIG.
 *  (b) kite arm: kiteAttribution — owner-explained when the owner's own
 *      displacement explains ≥ KITE_GAIN_YARDS, attacker-explained when only
 *      the attackers' does, mixed otherwise, unknown without positions.
 *      attacker-only = kite is the ONLY arm and it is attacker-explained.
 * Direction warning (issue): dropping these flags makes the predicate accuse
 * MORE. This probe only counts; no product rule changes here.
 *
 * Usage: npx tsx packages/eval/scripts/crisisPassiveResponseProbe.ts --manifest <m> [--every 5]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  crisisDecisionPoints,
  KITE_GAIN_YARDS,
  kiteAttribution,
  RESPONSE_PRE_MS,
  RESPONSE_WINDOW_MS,
  SELF_HEAL_BIG,
} from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { gunzipSync } from "zlib";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "5"));

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

const t = {
  rounds: 0,
  responded: 0,
  selfHealArm: 0,
  selfHealOnlyArm: 0,
  passiveOnly: 0,
  kiteArm: 0,
  kiteOnlyArm: 0,
  kiteOwner: 0,
  kiteAttacker: 0,
  kiteMixed: 0,
  kiteUnknown: 0,
  attackerOnly: 0,
  byBracket: {} as Record<
    string,
    { responded: number; passiveOnly: number; attackerOnly: number }
  >,
};
const examples: Array<Record<string, unknown>> = [];

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
    t.rounds++;
    const bracket = String(legacy.startInfo?.bracket ?? "?");
    const players = (Object.values(legacy.units ?? {}) as any[]).filter(
      (u) => u.info,
    );
    for (const owner of players.filter((u) => isHealerSpec(u.spec))) {
      const enemyIds = new Set(
        players.filter((u) => u.reaction !== owner.reaction).map((u) => u.id),
      );
      const maxHp = Math.max(
        1,
        ...((owner.advancedActions ?? []) as any[]).map(
          (x) => x.advancedActorMaxHp ?? 0,
        ),
      );
      for (const p of crisisDecisionPoints(owner, legacy, "healer")) {
        if (!(p.feasible && p.dangerous && p.responded)) continue;
        t.responded++;
        const b = (t.byBracket[bracket] ??= {
          responded: 0,
          passiveOnly: 0,
          attackerOnly: 0,
        });
        b.responded++;
        const r = p.responses;
        const otherArms = (except: string) =>
          (
            [
              "wall",
              "protective",
              "external",
              "control",
              "kite",
              "selfHeal",
            ] as const
          ).some((k) => k !== except && (r as any)[k]);
        const w0 = p.tMs - RESPONSE_PRE_MS;
        const w1 = p.tMs + RESPONSE_WINDOW_MS;
        if (r.selfHeal) {
          t.selfHealArm++;
          if (!otherArms("selfHeal")) {
            t.selfHealOnlyArm++;
            const castInWindow = new Set(
              ((owner.spellCastEvents ?? []) as any[])
                .filter(
                  (c) =>
                    c.logLine?.event === LogEvent.SPELL_CAST_SUCCESS &&
                    c.timestamp >= w0 &&
                    c.timestamp <= w1,
                )
                .map((c) => String(c.spellId)),
            );
            let fresh = 0,
              carried = 0;
            for (const h of (owner.healIn ?? []) as any[]) {
              if (
                h.srcUnitId !== owner.id ||
                h.timestamp <= p.tMs ||
                h.timestamp > w1
              )
                continue;
              const amt = Math.abs(h.effectiveAmount ?? h.amount ?? 0);
              if (castInWindow.has(String(h.spellId))) fresh += amt;
              else carried += amt;
            }
            if (fresh / maxHp < SELF_HEAL_BIG) {
              t.passiveOnly++;
              b.passiveOnly++;
              if (examples.length < 10)
                examples.push({
                  kind: "passive-heal",
                  file: f,
                  owner: owner.name,
                  tSec: p.tSec,
                  freshPct: Math.round((fresh / maxHp) * 100),
                  carriedPct: Math.round((carried / maxHp) * 100),
                });
            }
          }
        }
        if (r.kite) {
          t.kiteArm++;
          const attackers = [
            ...new Set(
              ((owner.damageIn ?? []) as any[])
                .filter(
                  (d) => d.timestamp > p.tMs - 2000 && d.timestamp <= p.tMs,
                )
                .map((d) => {
                  const src = legacy.units[d.srcUnitId];
                  return src?.info ? src.id : src?.ownerId;
                })
                .filter((id: string | undefined) => id && enemyIds.has(id)),
            ),
          ].map((id) => legacy.units[id as string]);
          const k = kiteAttribution(owner, attackers, p.tMs, w1);
          let cls: "owner" | "attacker" | "mixed" | "unknown";
          if (!k) cls = "unknown";
          else if (k.ownerGain >= KITE_GAIN_YARDS) cls = "owner";
          else if (k.attackerGain >= KITE_GAIN_YARDS) cls = "attacker";
          else cls = "mixed";
          if (cls === "owner") t.kiteOwner++;
          else if (cls === "attacker") t.kiteAttacker++;
          else if (cls === "mixed") t.kiteMixed++;
          else t.kiteUnknown++;
          if (!otherArms("kite")) {
            t.kiteOnlyArm++;
            if (cls === "attacker") {
              t.attackerOnly++;
              b.attackerOnly++;
              if (examples.length < 20)
                examples.push({
                  kind: "attacker-moved",
                  file: f,
                  owner: owner.name,
                  tSec: p.tSec,
                  ...k,
                });
            }
          }
        }
      }
    }
  }
}
const home =
  process.env.GLADLOG_EVAL_HOME ??
  join(process.env.HOME ?? "", "code/gladlog-eval-private");
writeFileSync(
  join(
    home,
    "reports/talent-integration-2026-09-13/crisisPassiveResponse.json",
  ),
  JSON.stringify({ files: files.length, ...t, examples }, null, 1),
);
console.log(JSON.stringify({ files: files.length, ...t }, null, 1));
