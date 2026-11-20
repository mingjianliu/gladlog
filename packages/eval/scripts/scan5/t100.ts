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
 *    `lockout`), or a stun the usable-while-stunned table does not let the
 *    alternative through, or a disarm of a weapon spell (kind `disarm`).
 *    Kind `control` (a fear / incapacitate / disorient — T187): an offer
 *    inside a hard CC that is not a stun and that the game does not let the
 *    alternative through (`hardCcLetsPress`: DB2's "Allow While Fleeing" /
 *    "Allow While Confused" per the aura's own mechanic). An offer the
 *    table lets through is counted out of the total (`control let through
 *    | <state>`). Per spell,
 *    `intervalBlocksSpell` (the DB2 school / silenceable / weapon lookup).
 *    The [SLACK] check reads silences and lockouts only: hard CC was
 *    already its gate.
 *  - `castInsideNonStunCc` (inventory, T187 — the forward check of the two
 *    usable-while tables): a SPELL_CAST_SUCCESS of the owner at least
 *    300 ms inside an enemy fear / horror / disorient on it and 300 ms
 *    before its end, by state | spell (id) | whether the table lets it
 *    through. A row "not in the table" with many casts is a table gap.
 */
import { spellSchoolMask } from "@gladlog/analysis/src/data/spellSchools";
import { disarmSpellIds } from "@gladlog/analysis/src/data/spellTags";
import {
  castBlockingAuraIntervals,
  enemySourceIds,
  hardCcLetsPress,
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
import {
  ccMechanicOf,
  isWeaponRequiredCast,
  mechanicStateOf,
} from "@gladlog/analysis/src/utils/spellMechanics";

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

export const CHECKS = [
  "slackWhileLocked",
  "cheaperLocked",
  "castInsideNonStunCc",
] as const;
/** an offer inside a fear / disorient the game lets the alternative
 * through: a right offer, counted and kept out of the total */
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "cheaperLocked|control let through | feared",
  "cheaperLocked|control let through | confused",
  // the tables' forward check is an inventory: the spell is in the detail
  "castInsideNonStunCc|feared | in the table",
  "castInsideNonStunCc|feared | NOT in the table",
  "castInsideNonStunCc|confused | in the table",
  "castInsideNonStunCc|confused | NOT in the table",
]);
const stateOfAura = (auraId: string) => {
  const mech = ccMechanicOf(auraId);
  return mech === undefined ? null : mechanicStateOf(mech);
};

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
const CD_LINE_RE = /^(\d+:\d{2})\s+\[YOU\] \[CD\]\s+(.+)$/;
const CHEAPER_RE = /\| cheaper available: (.+?)(?: \||$)/;
/** the pressed spell's name: up to its target arrow, HP part or first
 * field (codex 85-tk-L-T100-1 #2: a line with no HP part has no "(") */
const pressedNameOf = (rest: string): string =>
  rest.split(/ → | \(| \| /)[0]!.trim();

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
    // hard CC is read from the producer's own intervals below
    const kind = isSilenceEffectAura(id)
      ? undefined
      : isHardCcAura(id)
        ? null
        : disarmSpellIds.has(id)
          ? ("disarm" as const)
          : null;
    if (kind === null) return;
    // closed by its own caster's REMOVED (codex 85-tk-L-T100-1 #3: two
    // rogues' Garrotes overlap); a break names the breaker, so any
    const end = auras
      .slice(i + 1)
      .find(
        (r) =>
          String(r.spellId) === id &&
          ((ev(r) === REMOVED && r.srcUnitId === a.srcUnitId) ||
            isBroken(ev(r))),
      );
    locks.push({
      from: tsOf(a),
      to: end ? tsOf(end) : Infinity,
      spellId: id,
      lockout: false,
      ...(kind ? { kind } : {}),
    });
  });
  // hard CC: the producer's own cast-blocking intervals
  // (`castBlockingAuraIntervals` — its ends, a missing REMOVED capped at
  // the aura's duration, and its admission of a reflected or
  // friendly-sourced control; codex 85-tk-CD-T187-1 #1 #2: this scan's own
  // open-ended, enemy-only reading counted an expired Fear and missed a
  // priest's reflected Psychic Scream)
  for (const a of castBlockingAuraIntervals(
    owner,
    enemySourceIds(
      ctx.units.filter((u) => u.info && u.reaction !== owner.reaction),
      ctx.units,
    ),
  )) {
    if (!isHardCcAura(a.spellId) || isSilenceEffectAura(a.spellId)) continue;
    locks.push({
      from: a.from,
      to: a.to,
      spellId: a.spellId,
      lockout: false,
      kind: "control",
    });
  }
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
  {
    const C = "castInsideNonStunCc";
    const EDGE_MS = 300;
    const ccs = ownerLocks(ctx).filter(
      (iv) => iv.kind === "control" && stateOfAura(iv.spellId) !== null,
    );
    if (ccs.length > 0)
      for (const c of successesOf(ctx.owner)) {
        const ms = tsOf(c);
        const cc = ccs.find(
          (iv) =>
            !isStunDrAura(iv.spellId) &&
            iv.from + EDGE_MS <= ms &&
            ms + EDGE_MS <= iv.to,
        );
        if (!cc) continue;
        ctx.bump(C);
        const id = String(c.spellId);
        ctx.violate(
          C,
          `${stateOfAura(cc.spellId)} | ${hardCcLetsPress({ ...cc }, id) ? "in the table" : "NOT in the table"}`,
          ms,
          `${ctx.roundKey}|${ctx.owner.id}|${id}|${ms}`,
          `${nameOf(id)} (${id}) cast ${((ms - cc.from) / 1000).toFixed(1)}s into ${nameOf(cc.spellId, cc.spellId)}`,
        );
      }
  }
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
    const cd = CD_LINE_RE.exec(line);
    const ch = cd ? CHEAPER_RE.exec(cd[2]!) : null;
    if (!cd || !ch) continue;
    const C = "cheaperLocked";
    const sec = secOf(cd[1]!);
    const pressed = pressedNameOf(cd[2]!);
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
    // a trailing `[UNNECESSARY …]` / `[while stunned …]` note is not part
    // of the last alternative's name (codex 85-tk-L-T100-1b #1)
    const alts = ch[1]!.split(" [")[0]!;
    for (const altName of alts.split(", ").map((s) => s.trim())) {
      const alt = roster.find((cd: any) => cd.spellName === altName);
      if (!alt) continue;
      ctx.bump(C);
      const blockers = locks.filter(
        (iv) =>
          iv.from <= pressMs &&
          pressMs < iv.to &&
          (iv.kind === "disarm"
            ? isWeaponRequiredCast(alt.spellId)
            : iv.kind === "control"
              ? isStunDrAura(iv.spellId)
                ? !usableWhileStunned(alt.spellId, pvpTalents)
                : true
              : intervalBlocksSpell(iv, alt.spellId)),
      );
      const stops = (iv: ILock): boolean =>
        iv.kind !== "control" ||
        isStunDrAura(iv.spellId) ||
        !hardCcLetsPress(iv, alt.spellId);
      // a counted blocker wins over an unjudged (non-stun) control that
      // overlaps it (codex 85-tk-L-T100-1b #2)
      // a blocker that stops the alternative wins over a fear / disorient
      // the game lets it through
      const l = blockers.find(stops) ?? blockers[0];
      if (!l) continue;
      ctx.violate(
        C,
        l.kind === "control" && isStunDrAura(l.spellId)
          ? "stun"
          : l.kind === "control" && !stops(l)
            ? `control let through | ${stateOfAura(l.spellId)}`
            : (l.kind ?? (l.lockout ? "lockout" : "silence")),
        pressMs,
        `${ctx.owner.id}#${press.spellId}#${pressMs}#${alt.spellId}`,
        `${pressed} at ${cd[1]} offers ${altName} (${alt.spellId}) inside the owner's ${nameOf(l.spellId, l.spellId)} (${l.lockout ? `kick lockout, school ${l.lockedSchoolMask}` : (l.kind ?? "silence")}, ${((pressMs - l.from) / 1000).toFixed(2)}s in)`,
        line.trim(),
      );
    }
  }
}
