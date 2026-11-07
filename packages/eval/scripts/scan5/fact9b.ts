/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (actionIn, auraEvents, missesIn) */
/**
 * scan5/fact9b.ts — the round-9 audit's class-1 checks, batch 2 (fact9 F24:
 * interrupts and school locks). Log rows are the truth; DB2 schools,
 * mechanics, lockout lengths and the category map are lookups.
 *
 *  - `kickedBarAsRefusal` (D8): a kick-eaten `refused for another reason`
 *    press whose SPELL_CAST_FAILED row is the end of a bar an enemy kicked —
 *    an enemy SPELL_INTERRUPT of that spell on the player within 50 ms after
 *    it (1d6eee5f 0:58.883: Mind Freeze on the Pyroblast begun 0.13 s after a
 *    Spear Hand Strike, filed "its cast bar began and was stopped").
 *  - `pressOutsideButLocked` (D9 / D12): a press listed under `outside the
 *    locked school` that a lock did cover: its own DB2 school is inside this
 *    kick's locked school (kind `thisLock`; `thisLockUnsilenceable` when DB2
 *    says no silence stops the spell — the bucket is right that the lock did
 *    not stop it, wrong about the school: 1eb4dd55 Heart of the Wild under a
 *    Nature Skull Bash), or another enemy kick on the player landed before the
 *    press and still had its school locked at it (kind `laterLock` when that
 *    kick came after this one — 1d6eee5f Pyroblast / Blazing Barrier inside
 *    Mind Freeze's Fire lock — `earlierLock` when before it: 1d6eee5f r5
 *    Pyroblast inside a Rebuke's Fire lock). The lock's length is the
 *    victim's own (`kickLockoutSecondsFor`, Storm Conduit — a lookup), cut
 *    short by the player's own SUCCESS (`spellCastEvents`) or cast start
 *    (`castStartEvents`) of a silenceable spell of that school after the kick
 *    and at or before the press — not one the lock ignores
 *    (`LOCK_IGNORING_CAST_IDS`), not a Stasis replay (`stasisReplayWindows`;
 *    the release itself counts, a release with no SUCCESS row too:
 *    `stasisReleasePressesMs`, GH #182), as the analysis's lock end reads them. A
 *    press DB2 calls unsilenceable is never either.
 *  - `rootAuraCastBlock` (D10): an aura typed `interrupts` (so read as
 *    cast-blocking) put on the player by the other side, under which the
 *    player's SPELL_CAST_SUCCESS of a spell DB2 says a silence stops went out
 *    more than 100 ms inside both ends — while the product's cast-block
 *    reading (`castBlockingAuraIntervals`) still holds that span. Kind = the
 *    aura. 1d6eee5f 0:54.760: Frost Nova under the ghoul's Shambling Rush
 *    root 91807.
 *  - `gripStopAsCancel` (D11): a stop of the player's cast bar (a
 *    SPELL_CAST_FAILED with an interruption reason, no kick) within
 *    `CANCEL_CC_NEAR_S` of another unit's SPELL_CAST_SUCCESS on the player of
 *    a DB2 mechanic-6 spell (grip / knockback) that did not miss — that the
 *    product's bar reading still calls a self-stop (`stopped`, nothing near).
 *    The product's reading is what is being judged, so it is read through
 *    `castBarOutcomesOf`, the one reader the cancel ledger and the
 *    [CAST STOPPED] lines share. 1d6eee5f 1:26.609 Pyroblast, Death Grip 1 ms
 *    later.
 */
import {
  isCastBlockingAuraType,
  SPELL_CATEGORIES,
} from "@gladlog/analysis/src/data/spellCategories";
import {
  schoolLockedBy,
  spellSchoolMask,
} from "@gladlog/analysis/src/data/spellSchools";
import { castBlockingAuraIntervals } from "@gladlog/analysis/src/utils/cannotCastIntervals";
import {
  CAST_INTERRUPTED_REASONS,
  castBarOutcomesOf,
} from "@gladlog/analysis/src/utils/castBarOutcomes";
import { CANCEL_CC_NEAR_S } from "@gladlog/analysis/src/utils/castStopEvidence";
import { LOCK_IGNORING_CAST_IDS } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import {
  STASIS_RELEASE_SPELL_ID,
  stasisReleasePressesMs,
  stasisReplayWindows,
} from "@gladlog/analysis/src/utils/combatStates";
import { kickLockoutSecondsFor } from "@gladlog/analysis/src/utils/kickLockout";
import {
  ccMechanicOf,
  isSilenceableCast,
  isUnsilenceableCast,
} from "@gladlog/analysis/src/utils/spellMechanics";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "kickedBarAsRefusal",
  "pressOutsideButLocked",
  "rootAuraCastBlock",
  "gripStopAsCancel",
] as const;

const KICK_ROW = /type=kick-eaten t=([\d.]+)s .*?facts=\{(.*)\}\s*$/;
const GRIP_MECHANIC = 6;

interface Press {
  name: string;
  offS: number;
}

/** the presses of every `<head>Nx … (list)` clause of a postKick value */
function clausePresses(facts: string, head: string): Press[] {
  const out: Press[] = [];
  let at = facts.indexOf(head);
  while (at >= 0) {
    const open = facts.indexOf("(", at);
    const close = facts.indexOf(")", open);
    if (open < 0 || close < 0) break;
    for (const entry of facts.slice(open + 1, close).split("、")) {
      const m = /^(.+?)(?:×\d+)? ((?:\+[\d.]+\/?)+)s$/.exec(entry.trim());
      if (!m) continue;
      for (const o of m[2]!.split("/"))
        out.push({ name: m[1]!, offS: Number(o.slice(1)) });
    }
    at = facts.indexOf(head, close);
  }
  return out;
}

/** the player's SPELL_CAST_FAILED row a printed press stands for: same
 * English name, offset floored to 0.1 s as the producer floors it */
function rowOf(failed: any[], kickS: number, p: Press): any | undefined {
  return failed.find(
    (f) =>
      nameOf(f.spellId, f.spellName) === p.name &&
      (Math.floor((f.tSeconds - kickS) * 10 + 1e-6) / 10).toFixed(1) ===
        p.offS.toFixed(1),
  );
}

function kickRows(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const enemySide = new Set(
    ctx.units
      .filter((u) => u.reaction !== owner.reaction)
      .map((u) => u.id as string),
  );
  const kicks = ((owner.actionIn ?? []) as any[]).filter(
    (k) => ev(k) === "SPELL_INTERRUPT" && enemySide.has(k.srcUnitId),
  );
  const failed = ctx
    .rawStreams()
    .castFailed.filter((f) => f.unitGuid === owner.id);
  for (const line of ctx.menu.split("\n")) {
    const m = KICK_ROW.exec(line);
    if (!m) continue;
    const kick = kicks.find(
      (k) => Math.abs(tsOf(k) - (ctx.start + Number(m[1]) * 1000)) <= 100,
    );
    if (!kick) continue;
    const kickS = (tsOf(kick) - ctx.start) / 1000;
    const facts = m[2]!;
    for (const p of clausePresses(facts, "refused for another reason ")) {
      const f = rowOf(failed, kickS, p);
      if (!f) continue;
      ctx.bump("kickedBarAsRefusal");
      const fMs = ctx.start + f.tSeconds * 1000;
      const by = kicks.find(
        (k) =>
          k.extraSpellId === String(f.spellId) &&
          tsOf(k) >= fMs - 5 &&
          tsOf(k) <= fMs + 50,
      );
      if (!by) continue;
      ctx.violate(
        "kickedBarAsRefusal",
        "kicked",
        fMs,
        `${owner.name}#${m[1]}#${p.name}+${p.offS}`,
        `kick-eaten t=${m[1]}: ${p.name} +${p.offS}s filed as refused; ${nameOf(by.spellId, by.spellName)} kicked it at ${fmtS((tsOf(by) - ctx.start) / 1000)}`,
        line.slice(0, 300),
      );
    }
    const lockedMask = spellSchoolMask(String(kick.extraSpellId));
    const replays = stasisReplayWindows(owner);
    // the analysis's lock-end casts: the SUCCESS rows, plus a Stasis release
    // the log wrote no SUCCESS for, read off the ready aura's early REMOVED
    // (`stasisReleasePressesMs`, ccTrinketAnalysis' castTimes — GH #182)
    const successes = ((owner.spellCastEvents ?? []) as any[]).filter(
      (c) => ev(c) === "SPELL_CAST_SUCCESS",
    );
    const lockEndCasts = [
      ...successes,
      ...stasisReleasePressesMs(owner)
        .filter(
          (ms) =>
            !successes.some(
              (c) =>
                tsOf(c) === ms && String(c.spellId) === STASIS_RELEASE_SPELL_ID,
            ),
        )
        .map((ms) => ({ spellId: STASIS_RELEASE_SPELL_ID, timestamp: ms })),
    ];
    for (const p of clausePresses(facts, "outside the locked school ")) {
      const f = rowOf(failed, kickS, p);
      if (!f) continue;
      ctx.bump("pressOutsideButLocked");
      const id = String(f.spellId);
      const mask = spellSchoolMask(id);
      if (mask === undefined) continue;
      const fMs = ctx.start + f.tSeconds * 1000;
      let kind: string | undefined;
      if (lockedMask !== undefined && schoolLockedBy(mask, lockedMask))
        kind = isUnsilenceableCast(id) ? "thisLockUnsilenceable" : "thisLock";
      else if (!isUnsilenceableCast(id)) {
        const other = kicks.filter((k) => {
          if (k === kick || tsOf(k) >= fMs) return false;
          const lm = spellSchoolMask(String(k.extraSpellId));
          if (lm === undefined || !schoolLockedBy(mask, lm)) return false;
          const lockMs =
            kickLockoutSecondsFor(
              String(k.spellId),
              owner,
              String(k.extraSpellId),
              tsOf(k),
              ctx.units.find((u) => u.id === k.srcUnitId),
            ) * 1000;
          // the player's own cast in that school after the kick ends its lock
          const freesLock = (c: any, ignoreRelease: boolean) => {
            if (tsOf(c) <= tsOf(k) || tsOf(c) > fMs) return false;
            const cid = String(c.spellId);
            if (LOCK_IGNORING_CAST_IDS.has(cid)) return false;
            if (
              !(ignoreRelease && cid === STASIS_RELEASE_SPELL_ID) &&
              replays.some((w) => tsOf(c) >= w.from && tsOf(c) <= w.to)
            )
              return false;
            const cm = spellSchoolMask(cid);
            return (
              isSilenceableCast(cid) &&
              cm !== undefined &&
              schoolLockedBy(cm, lm)
            );
          };
          const freed =
            lockEndCasts.some((c) => freesLock(c, true)) ||
            ((owner.castStartEvents ?? []) as any[]).some((c) =>
              freesLock(c, false),
            );
          return !freed && tsOf(k) + lockMs > fMs + 50;
        });
        if (other.some((k) => tsOf(k) > tsOf(kick))) kind = "laterLock";
        else if (other.length > 0) kind = "earlierLock";
      }
      if (!kind) continue;
      ctx.violate(
        "pressOutsideButLocked",
        kind,
        fMs,
        `${owner.name}#${m[1]}#${p.name}+${p.offS}`,
        `kick-eaten t=${m[1]}: ${p.name} +${p.offS}s (school ${mask}) listed outside the locked school ${lockedMask ?? "?"}`,
        line.slice(0, 300),
      );
    }
  }
}

function rootAuras(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const enemySide = new Set(
    ctx.units
      .filter((u) => u.reaction !== owner.reaction)
      .map((u) => u.id as string),
  );
  const open = new Map<string, any>();
  const spans: Array<{ id: string; from: number; to: number }> = [];
  for (const a of (owner.auraEvents ?? []) as any[]) {
    const id = String(a.spellId ?? "");
    if (SPELL_CATEGORIES[id]?.type !== "interrupts") continue;
    if (!isCastBlockingAuraType("interrupts")) continue;
    if (ev(a) === APPLIED && enemySide.has(a.srcUnitId)) open.set(id, a);
    else if (
      (ev(a) === REMOVED || ev(a)?.startsWith("SPELL_AURA_BROKEN")) &&
      open.has(id)
    ) {
      spans.push({ id, from: tsOf(open.get(id)), to: tsOf(a) });
      open.delete(id);
    }
  }
  const casts = successesOf(owner);
  // the product's reading of the same spans (`castBlockingAuraIntervals`,
  // the aura half of every cannot-cast interval) — what is judged
  const read = castBlockingAuraIntervals(owner as never, enemySide);
  for (const s of spans) {
    ctx.bump("rootAuraCastBlock");
    if (
      !read.some((r) => r.spellId === s.id && r.from <= s.from && r.to > s.from)
    )
      continue;
    const through = casts.find(
      (c) =>
        tsOf(c) > s.from + 100 &&
        tsOf(c) < s.to - 100 &&
        isSilenceableCast(String(c.spellId)),
    );
    if (!through) continue;
    ctx.violate(
      "rootAuraCastBlock",
      `${nameOf(s.id)} ${s.id}`,
      s.from,
      `${owner.name}#${s.id}#${Math.floor((s.from - ctx.start) / 1000)}`,
      `${nameOf(s.id)} ${fmtS((s.from - ctx.start) / 1000)}–${fmtS((s.to - ctx.start) / 1000)}; ${nameOf(through.spellId)} went out at ${fmtS((tsOf(through) - ctx.start) / 1000)}`,
    );
  }
}

function gripStops(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const failed = ctx
    .rawStreams()
    .castFailed.filter((f) => f.unitGuid === owner.id);
  if (failed.length === 0) return;
  const grips = ((owner.actionIn ?? []) as any[]).filter(
    (a) =>
      ev(a) === "SPELL_CAST_SUCCESS" &&
      a.srcUnitId !== owner.id &&
      ccMechanicOf(String(a.spellId)) === GRIP_MECHANIC &&
      !((owner.missesIn ?? []) as any[]).some(
        (x) => String(x.spellId) === String(a.spellId) && tsOf(x) === tsOf(a),
      ),
  );
  if (grips.length === 0) return;
  const outcomes = castBarOutcomesOf({
    unit: owner,
    startMs: ctx.start,
    failed,
  });
  for (const f of failed) {
    if (!CAST_INTERRUPTED_REASONS.has(f.reason.trim())) continue;
    const fMs = ctx.start + f.tSeconds * 1000;
    const g = grips.find(
      (a) => Math.abs(tsOf(a) - fMs) <= CANCEL_CC_NEAR_S * 1000,
    );
    if (!g) continue;
    ctx.bump("gripStopAsCancel");
    const bar = outcomes.find(
      (o) =>
        o.id === String(f.spellId) &&
        o.end.kind === "stopped" &&
        Math.abs(o.end.atS - f.tSeconds) < 0.001,
    );
    if (!bar || bar.end.kind !== "stopped" || bar.end.near !== null) continue;
    ctx.violate(
      "gripStopAsCancel",
      `${nameOf(g.spellId, g.spellName)} ${g.spellId}`,
      fMs,
      `${owner.name}#${f.spellId}#${Math.round(f.tSeconds * 10)}`,
      `${nameOf(f.spellId, f.spellName)} stopped at ${fmtS(f.tSeconds)}, ${nameOf(g.spellId, g.spellName)} on the player ${tsOf(g) - fMs} ms from it; read as a self-stop`,
    );
  }
}

export function run(ctx: IRoundCtx): void {
  kickRows(ctx);
  rootAuras(ctx);
  gripStops(ctx);
}
