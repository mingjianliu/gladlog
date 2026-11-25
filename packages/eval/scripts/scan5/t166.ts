/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t166.ts — ticket T166 item 2 (user ruling R102): the burst ledger's
 * `Target had a major defensive up: X active ON THE TARGET …` line named a
 * school-limited wall whatever the burst's schools (605 s0 14 r1: Blessing
 * of Protection over 448k of frost and arcane). A wall whose school touches
 * none of the holder's damage in the stretch it covered is no longer held
 * (`wallTouchesNoneOf`, in `analyzeBurstLedger`).
 *
 * THIS SCAN RE-RUNS THE ENGINE: its numbers are the checkout's. The bursts
 * and the walls each one holds are the producer's own (`analyzeBurstLedger`
 * → `dominantTarget.defensivesHit`); the printed lines are the capture's.
 *
 *  - `ledgerWallSchool`: a printed wall line of a `Burst #` block (`Target
 *    had a major defensive up`, `Target had an ally's N% copy up`, `⚠ Target
 *    was IMMUNE`) against the walls the checkout's ledger holds for that
 *    burst. Kinds: `printed, the ledger holds none: <wall>` (non-zero on a
 *    capture taken before the ruling landed, 0 on one taken with it),
 *    `held by the ledger, not printed: <wall>`, `no such burst in the
 *    ledger`. Counted: every wall line printed or held.
 *  - `ledgerLimitedImmunityNoRow`: inventory, never a failure — a held wall
 *    with no `MITIGATION_TABLE` row whose DB2 immunity is school-limited
 *    (`limitedImmunitySchoolMask`: Peaceweaver, magic) over damage of the
 *    holder none of which is in its schools. R102 named the table's walls;
 *    this one stays printed (codex 85-tk-L2-T166-1 #2).
 *    Counted: every held wall of that kind.
 */
import { MITIGATION_TABLE } from "@gladlog/analysis/src/data/mitigationData";
import {
  analyzeBurstLedger,
  burstDamageBySchoolOn,
  wallRefusedAttackOf,
  wallTouchesNoneOf,
} from "@gladlog/analysis/src/utils/burstLedger";
import {
  limitedImmunitySchoolMask,
  wallTableIdOfAura,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { documentRecordsAttackSpell } from "@gladlog/analysis/src/utils/incomingPressure";

import { type IRoundCtx, secOf } from "./ctx";

export const CHECKS = [
  "ledgerWallSchool",
  "ledgerLimitedImmunityNoRow",
] as const;
const NO_ROW_NONE =
  "reaches none of the holder's damage and refused none, still printed";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `ledgerLimitedImmunityNoRow|${NO_ROW_NONE}`,
]);

const BURST_HEAD = /^\s+Burst #\d+ — (\d+:\d\d)–(\d+:\d\d) \| /;
const WALL_LINE =
  /^\s+(?:Target had a major defensive up|Target had an ally's \d+% copy up \([^)]*\)|⚠ Target was IMMUNE): (.+?) active ON THE TARGET /;

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner as any;
  if (!owner) return;
  const C = "ledgerWallSchool";
  const combat = ctx.legacy as any;
  const friends = ctx.players.filter((p: any) => p.reaction === owner.reaction);
  const enemies = ctx.players.filter((p: any) => p.reaction !== owner.reaction);
  let entries: ReturnType<typeof analyzeBurstLedger>;
  try {
    entries = analyzeBurstLedger(owner, friends, enemies, combat);
  } catch {
    return;
  }
  for (const e of entries) {
    const t = e.dominantTarget;
    for (const d of t?.defensivesHit ?? []) {
      const id = wallTableIdOfAura(d.spellId);
      const mask = limitedImmunitySchoolMask(id);
      if (MITIGATION_TABLE[id] || mask === undefined) continue;
      ctx.bump("ledgerLimitedImmunityNoRow");
      const fromMs = ctx.start + e.fromSeconds * 1000;
      const lo = fromMs + Math.max(0, d.startOffsetMs ?? 0);
      const hi = Math.min(
        fromMs + (d.endOffsetMs ?? Infinity),
        ctx.start + e.toSeconds * 1000,
      );
      // the same two readings the ledger takes of a table wall, on the DB2
      // immunity's mask
      const asImmunity = {
        spellId: id,
        positional: false,
        components: [
          {
            kind: "immunity" as const,
            schoolMask: mask,
            pctMin: 100,
            pctMax: 100,
          },
        ],
        unresolved: [],
      };
      const by = burstDamageBySchoolOn(
        owner,
        t!.unitId,
        lo,
        hi,
        documentRecordsAttackSpell(Object.values(combat.units ?? {})),
      );
      const total = Object.entries(by).reduce(
        (n, [school, amount]) =>
          (Number(school) & 0x7f) === 0 ? n : n + amount,
        0,
      );
      const attackers = [
        owner,
        ...(Object.values(combat.units ?? {}) as any[]).filter(
          (u) => u.ownerId === owner.id,
        ),
      ];
      const damaging = new Set<string>(
        attackers.flatMap((u) =>
          (u.damageOut ?? []).map((x: any) => String(x.spellId)),
        ),
      );
      if (
        wallTouchesNoneOf(asImmunity, by) &&
        !wallRefusedAttackOf(asImmunity, attackers, t!.unitId, lo, hi, (sid) =>
          damaging.has(sid),
        )
      )
        ctx.violate(
          "ledgerLimitedImmunityNoRow",
          NO_ROW_NONE,
          fromMs,
          `${ctx.roundKey}|${owner.id}|${e.fromSeconds}|${d.spellId}`,
          `burst ${e.fromSeconds.toFixed(1)}s–${e.toSeconds.toFixed(1)}s on ${t!.unitName}: ${d.spellName} over ${Math.round(total)} of other schools`,
        );
    }
  }
  // the printed blocks, in order: each burst's span and its wall lines
  const blocks: Array<{ from: number; to: number; walls: string[] }> = [];
  for (const l of ctx.lines) {
    const h = BURST_HEAD.exec(l);
    if (h) {
      blocks.push({ from: secOf(h[1]!), to: secOf(h[2]!), walls: [] });
      continue;
    }
    const w = WALL_LINE.exec(l);
    if (w && blocks.length > 0) blocks[blocks.length - 1]!.walls.push(w[1]!);
  }
  const used = new Set<number>();
  for (const b of blocks) {
    // the header prints both ends floored to the render grid
    const i = entries.findIndex(
      (e, k) =>
        !used.has(k) &&
        Math.floor(e.fromSeconds) === b.from &&
        Math.floor(e.toSeconds) === b.to,
    );
    const atMs = ctx.start + b.from * 1000;
    const fact = `${ctx.roundKey}|${owner.id}|${b.from}`;
    if (i < 0) {
      for (const w of b.walls) {
        ctx.bump(C);
        ctx.violate(C, "no such burst in the ledger", atMs, `${fact}|${w}`, w);
      }
      continue;
    }
    used.add(i);
    const held = (entries[i]!.dominantTarget?.defensivesHit ?? []).map(
      (d) => d.spellName,
    );
    const left = [...held];
    for (const w of b.walls) {
      ctx.bump(C);
      const k = left.indexOf(w);
      if (k >= 0) {
        left.splice(k, 1);
        continue;
      }
      ctx.violate(
        C,
        `printed, the ledger holds none: ${w}`,
        atMs,
        `${fact}|${w}`,
        `burst ${b.from}s–${b.to}s on ${entries[i]!.dominantTarget?.unitName ?? "-"}: printed ${b.walls.join(", ")}; held ${held.join(", ") || "-"}`,
      );
    }
    for (const w of left) {
      ctx.bump(C);
      ctx.violate(
        C,
        `held by the ledger, not printed: ${w}`,
        atMs,
        `${fact}|${w}|held`,
        `burst ${b.from}s–${b.to}s on ${entries[i]!.dominantTarget?.unitName ?? "-"}: printed ${b.walls.join(", ") || "-"}; held ${held.join(", ")}`,
      );
    }
  }
  // a burst the ledger holds walls for with no printed block at all
  entries.forEach((e, k) => {
    if (used.has(k)) return;
    for (const d of e.dominantTarget?.defensivesHit ?? []) {
      ctx.bump(C);
      ctx.violate(
        C,
        `held by the ledger, no burst block printed: ${d.spellName}`,
        ctx.start + e.fromSeconds * 1000,
        `${ctx.roundKey}|${owner.id}|${Math.floor(e.fromSeconds)}|${d.spellName}|noblock`,
        `burst ${e.fromSeconds.toFixed(1)}s–${e.toSeconds.toFixed(1)}s on ${e.dominantTarget?.unitName ?? "-"}`,
      );
    }
  });
}
