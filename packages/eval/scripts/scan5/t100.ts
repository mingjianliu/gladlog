/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, actionIn) */
/**
 * scan5/t100.ts — ticket T100: the owner's "could act" read from hard CC
 * only. Two readers took the `[CC ON TEAM]` control list (or a stun alone)
 * for "free to cast", so a silence or a kick lockout counted as free time.
 * Truth is read from the log rows: a silence aura an enemy put on the owner
 * (APPLIED → the first REMOVED of it after, open-ended without one), and an
 * enemy SPELL_INTERRUPT on the owner for its lockout length
 * (`kickLockoutSecondsFor`, the table lookup) on the interrupted spell's
 * school.
 *
 *  - `slackWhileLocked`: a printed `[SLACK]` / `[CONTESTED]` segment with a
 *    whole second t (from ≤ t < to, the producer's own sweep grid) whose
 *    instant lies inside an owner silence (kind `silence`) or kick lockout
 *    (kind `lockout`). The segment's legend is "you un-CC-d" and its body
 *    ("no damage, no CC, no purge, no kick") counts what a silence stops.
 *  - `cheaperLocked`: a `[YOU] [CD] X … | cheaper available: A, B` line
 *    naming an alternative the owner could not press at X's press: inside an
 *    owner silence the alternative does not cast through (kind `silence`),
 *    or a kick lockout whose school holds the alternative's (kind
 *    `lockout`), or a hard-CC aura (kind `control`; a stun only against a
 *    spell the usable-while-stunned table does not let through), or a
 *    disarm of a weapon spell (kind `disarm`). Per spell,
 *    `intervalBlocksSpell` (the DB2 school / silenceable / weapon lookup).
 *    The [SLACK] check reads silences and lockouts only: hard CC was
 *    already its gate.
 */
import { spellSchoolMask } from "@gladlog/analysis/src/data/spellSchools";
import { disarmSpellIds } from "@gladlog/analysis/src/data/spellTags";
import {
  intervalBlocksSpell,
  isHardCcAura,
  isSilenceEffectAura,
} from "@gladlog/analysis/src/utils/cannotCastIntervals";
import {
  extractMajorCooldowns,
  playerTalentIdSets,
  usableWhileStunned,
} from "@gladlog/analysis/src/utils/cooldowns";
import { isStunDrAura } from "@gladlog/analysis/src/utils/drAnalysis";
import { kickLockoutSecondsFor } from "@gladlog/analysis/src/utils/kickLockout";
import { isWeaponRequiredCast } from "@gladlog/analysis/src/utils/spellMechanics";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["slackWhileLocked", "cheaperLocked"] as const;

interface ILock {
  from: number;
  to: number;
  spellId: string;
  lockout: boolean;
  lockedSchoolMask?: number;
  /** a hard-CC / disarm aura: read by the cheaper check only */
  kind?: "control" | "disarm";
}

const BROKEN = "SPELL_AURA_BROKEN";
const BROKEN_SPELL = "SPELL_AURA_BROKEN_SPELL";
const isBroken = (e: string) => e === BROKEN || e === BROKEN_SPELL;

const SEGMENT_RE =
  /^\s*\[(SLACK|CONTESTED)\] (\d+:\d{2})–(\d+:\d{2}) \(\d+s, team min HP/;
const CHEAPER_RE =
  /^(\d+:\d{2})\s+\[YOU\] \[CD\]\s+(.+?) \(.*\| cheaper available: (.+?)(?: \||$)/;

function ownerLocks(ctx: IRoundCtx): ILock[] {
  const owner = ctx.owner;
  const enemy = new Set(
    ctx.units
      .filter((u) => u.reaction !== owner.reaction)
      .map((u) => u.id as string),
  );
  const locks: ILock[] = [];
  const auras = ((owner.auraEvents ?? []) as any[]).filter(
    (a) => a.destUnitId === owner.id,
  );
  auras.forEach((a, i) => {
    if (ev(a) !== APPLIED || !enemy.has(a.srcUnitId)) return;
    const id = String(a.spellId ?? "");
    const kind = isSilenceEffectAura(id)
      ? undefined
      : isHardCcAura(id)
        ? ("control" as const)
        : disarmSpellIds.has(id)
          ? ("disarm" as const)
          : null;
    if (kind === null) return;
    const end = auras
      .slice(i + 1)
      .find(
        (r) =>
          (ev(r) === REMOVED || isBroken(ev(r))) &&
          String(r.spellId) === id,
      );
    locks.push({
      from: tsOf(a),
      to: end ? tsOf(end) : Infinity,
      spellId: id,
      lockout: false,
      ...(kind ? { kind } : {}),
    });
  });
  for (const k of (owner.actionIn ?? []) as any[]) {
    if (ev(k) !== "SPELL_INTERRUPT" || !enemy.has(k.srcUnitId)) continue;
    const lockMs =
      kickLockoutSecondsFor(
        String(k.spellId),
        owner,
        String(k.extraSpellId),
        tsOf(k),
        ctx.units.find((u) => u.id === k.srcUnitId),
      ) * 1000;
    const iv: ILock = {
      from: tsOf(k),
      to: tsOf(k) + lockMs,
      spellId: String(k.spellId),
      lockout: true,
    };
    const m = spellSchoolMask(String(k.extraSpellId));
    if (m !== undefined) iv.lockedSchoolMask = m;
    locks.push(iv);
  }
  return locks;
}

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  let locks: ILock[] | undefined;
  for (const line of ctx.lines) {
    const seg = SEGMENT_RE.exec(line);
    if (seg) {
      const C = "slackWhileLocked";
      ctx.bump(C);
      locks ??= ownerLocks(ctx);
      const from = secOf(seg[2]!);
      const to = secOf(seg[3]!);
      let hit: ILock | undefined;
      let seconds = 0;
      for (let t = from; t < to; t++) {
        const ms = ctx.start + t * 1000;
        const l = locks.find(
          (iv) => iv.kind === undefined && iv.from <= ms && ms < iv.to,
        );
        if (!l) continue;
        hit ??= l;
        seconds++;
      }
      if (hit)
        ctx.violate(
          C,
          hit.lockout ? "lockout" : "silence",
          ctx.start + from * 1000,
          `${ctx.owner.id}#${seg[1]}#${from}`,
          `[${seg[1]}] ${seg[2]}–${seg[3]}: ${seconds} whole second(s) under the owner's ${nameOf(hit.spellId, hit.spellId)} (${hit.lockout ? "kick lockout" : "silence"})`,
          line.trim(),
        );
      continue;
    }
    const ch = CHEAPER_RE.exec(line);
    if (!ch) continue;
    const C = "cheaperLocked";
    const sec = secOf(ch[1]!);
    const pressed = ch[2]!.trim();
    const press = successesOf(ctx.owner).find(
      (c) =>
        nameOf(String(c.spellId)) === pressed &&
        Math.floor((tsOf(c) - ctx.start) / 1000) === sec,
    );
    if (!press) continue;
    locks ??= ownerLocks(ctx);
    const pressMs = tsOf(press);
    const roster = extractMajorCooldowns(ctx.owner, ctx.legacy);
    const pvpTalents = playerTalentIdSets(ctx.owner).pvpTalentIds;
    for (const altName of ch[3]!.split(", ").map((s) => s.trim())) {
      const alt = roster.find((cd: any) => cd.spellName === altName);
      if (!alt) continue;
      ctx.bump(C);
      const l = locks.find(
        (iv) =>
          iv.from <= pressMs &&
          pressMs < iv.to &&
          (iv.kind === "disarm"
            ? isWeaponRequiredCast(alt.spellId)
            : iv.kind === "control"
              ? !(
                  isStunDrAura(iv.spellId) &&
                  usableWhileStunned(alt.spellId, pvpTalents)
                )
              : intervalBlocksSpell(iv, alt.spellId)),
      );
      if (!l) continue;
      ctx.violate(
        C,
        l.kind ?? (l.lockout ? "lockout" : "silence"),
        pressMs,
        `${ctx.owner.id}#${press.spellId}#${pressMs}#${alt.spellId}`,
        `${pressed} at ${ch[1]} offers ${altName} (${alt.spellId}) inside the owner's ${nameOf(l.spellId, l.spellId)} (${l.lockout ? `kick lockout, school ${l.lockedSchoolMask}` : (l.kind ?? "silence")}, ${((pressMs - l.from) / 1000).toFixed(2)}s in)`,
        line.trim(),
      );
    }
  }
}
