/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (auraEvents, actionIn, spellCastEvents) */
/**
 * scan5/effectEnd.ts — class 8 of the round-7 audit (fact7 F21): when an
 * effect ended and why. One check per sub-class, each read off the round's
 * own rows, never through the predicate it audits (lookups — names, DB2 — are
 * fine):
 *
 *  - `ccEndCauseLogged` (D3, D38, D73): a control line printing `ended early —
 *    cause not logged`, its aura's REMOVED row found on the holder. Kinds:
 *    `break row` (a BROKEN row of that aura within `NEAR_MS` of the REMOVED,
 *    either side), `dispel` (a SPELL_DISPEL naming it), `sanctuary` (a
 *    Blessing of Sanctuary landing on the holder), `ran its length` (the run
 *    reached the official length at the printed DR step, less `JITTER_MS`).
 *  - `naturalEndAtDeath` (D15): a line blaming a death for an end —
 *    `removed at your death`, `ended at their death`, `ended at death`, `its
 *    target died` — whose run reached the aura's full length for its caster
 *    (× the printed DR step). The run is the line's own: `removed at your
 *    death` the owner's copy, `its target died` a dead unit's copy of that
 *    source, a control or `[ENEMY DEF]` line the named unit's copy applied in
 *    the printed second (those lines stand at the start). Another caster's
 *    copy on another unit says nothing about this one. Kinds `full length`,
 *    `left a survivor` (the same source's aura left a unit that lived on, in
 *    the same millisecond).
 *  - `channelOutlived` (D12): `[YOU] [CD] X (channeled Ns, ended m:ss)` with
 *    a cast row of the owner's inside the printed length: a channel does not
 *    run through the caster's next cast (a cast row of a button:
 *    `isButtonPress`, not a pet command). Off-GCD and castable-while-casting
 *    spells are what `kind` names, one kind per spell, so an exception shows.
 *  - `wallHeldPastHold` (D76, user ruling 2026-10-31): `defenseless a–b` on a
 *    unit whose own wall aura, the one its `[ENEMY DEF]` line prints with a
 *    length, ran into the span: the aura's logged REMOVED lies after a + 1 s.
 *  - `unseenEndOpener` (D59): `X active ON THE TARGET Ns` of a stealth /
 *    invisibility aura with no end row, printed longer than the gap to the
 *    first debuff its holder put on a player (a stealth opener whose cast row
 *    the log lost): the gap + 0.1 s. The run is the line's own: the holder's
 *    run applied `pressed Ns after` the burst head's start, or the last one
 *    before that start for `already up`. A debuff that opens nothing is no
 *    end: a snare (a press's rider, DB2 mechanic 11), one the state allows
 *    (DB2 Allow While Stealthed, on Vanish), a press with no unit on its row
 *    still inside its official length (Ring of Frost: a ground effect).
 *  - `immuneCauseUnnamed` (D61): `[CC NOT LANDED] … — logged IMMUNE` with no
 *    cause, while an aura with a DB2 school immunity covering the control's
 *    school, or a mechanic immunity for its mechanic, was up on the target.
 *  - `kickBackVsNextPress` (D28): a `[RES]` `cd:` entry or `[KICK] … back m:ss`
 *    of an interrupt putting it back later than its unit's next press of it.
 */
import { castsOfEffectAura } from "@gladlog/analysis/src/data/castEffectAuras";
import { spellEffectData } from "@gladlog/analysis/src/data/spellEffectData";
import {
  immunityCoversSpell,
  spellSchoolMask,
} from "@gladlog/analysis/src/data/spellSchools";
import { ALLOWED_WHILE_STEALTHED_SPELL_IDS } from "@gladlog/analysis/src/data/spellStateAttrsGenerated";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
import { isButtonPress } from "@gladlog/analysis/src/utils/castCommitSpans";
import {
  ENEMY_DEF_TAG_NAME_RE_SRC,
  SAVE_AURA_END_UNSEEN_IDS,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { INTERRUPT_SPELL_IDS } from "@gladlog/analysis/src/utils/enemyInterrupts";
import {
  auraBlocksMechanic,
  ccMechanicOf,
} from "@gladlog/analysis/src/utils/spellMechanics";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  secOf,
  SUCCESS,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "ccEndCauseLogged",
  "naturalEndAtDeath",
  "channelOutlived",
  "wallHeldPastHold",
  "unseenEndOpener",
  "immuneCauseUnnamed",
  "kickBackVsNextPress",
] as const;

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
]);

const NEAR_MS = 50;
const JITTER_MS = 100;
const SANCTUARY = "210256";
const BROKEN = new Set(["SPELL_AURA_BROKEN", "SPELL_AURA_BROKEN_SPELL"]);
const CC_LINE =
  /^\s*(\d+:\d\d)\s+\[(?:CC ON TEAM|CC ON ENEMY|SILENCE)\]\s+(\d+)\([^)]*\) ← (.+?) \(by .*ended early — cause not logged/;
const DR_SHARE: Record<string, number> = { Full: 1, "50%": 0.5, "25%": 0.25 };

const rowsOf = (u: any, id: string): any[] =>
  ((u.auraEvents ?? []) as any[]).filter(
    (a) => a.spellId === id && a.destUnitId === u.id,
  );
const idsNamed = (u: any, name: string): string[] => [
  ...new Set(
    ((u.auraEvents ?? []) as any[])
      .filter((a) => a.spellId && nameOf(a.spellId, a.spellName ?? "") === name)
      .map((a) => a.spellId as string),
  ),
];

function ccEndCause(ctx: IRoundCtx, line: string): void {
  const m = CC_LINE.exec(line);
  if (!m) return;
  const holder = ctx.unitOfPid(m[2]);
  if (!holder) return;
  ctx.bump("ccEndCauseLogged");
  const t = secOf(m[1]!);
  const lo = ctx.start + t * 1000;
  for (const id of idsNamed(holder, m[3]!)) {
    const rows = rowsOf(holder, id);
    const apply = rows.find(
      (a) => ev(a) === APPLIED && tsOf(a) >= lo && tsOf(a) < lo + 1000,
    );
    if (!apply) continue;
    const rm = rows.find((a) => ev(a) === REMOVED && tsOf(a) >= tsOf(apply));
    if (!rm) continue;
    const at = tsOf(rm);
    const fact = `${holder.name}#${id}#${at}`;
    const near = (x: number) => Math.abs(x - at) <= NEAR_MS;
    const say = (kind: string, d: string) =>
      ctx.violate("ccEndCauseLogged", kind, at, fact, d, line);
    if (rows.some((a) => BROKEN.has(ev(a)) && near(tsOf(a))))
      say(
        "break row",
        `${m[3]} on ${holder.name}: a BROKEN row beside its REMOVED`,
      );
    else if (
      ((holder.actionIn ?? []) as any[]).some(
        (x) =>
          ev(x) === "SPELL_DISPEL" && x.extraSpellId === id && near(tsOf(x)),
      )
    )
      say(
        "dispel",
        `${m[3]} on ${holder.name}: a dispel row beside its REMOVED`,
      );
    else if (
      ctx.units.some((u) =>
        successesOf(u).some(
          (c) =>
            c.spellId === SANCTUARY &&
            c.destUnitId === holder.id &&
            near(tsOf(c)),
        ),
      )
    )
      say(
        "sanctuary",
        `${m[3]} on ${holder.name}: Sanctuary landed at its REMOVED`,
      );
    else {
      const dr = /\[DR: \S+ (Full|50%|25%)\]/.exec(line)?.[1];
      const full = spellEffectData[id]?.durationSeconds;
      if (
        dr &&
        full &&
        at - tsOf(apply) >= full * 1000 * DR_SHARE[dr]! - JITTER_MS
      )
        say(
          "ran its length",
          `${m[3]} on ${holder.name}: ${((at - tsOf(apply)) / 1000).toFixed(3)}s of ${full}s × ${dr}`,
        );
    }
    return;
  }
}

const DEATH_LINE = new RegExp(
  String.raw`^\s*(\d+:\d\d)\s+\[(BUFF FADED|CC ON TEAM|CC ON ENEMY|${ENEMY_DEF_TAG_NAME_RE_SRC}|SILENCE)\]\s+(.*)$`,
);
const DEATH_WORDS =
  /removed at your death|ended at their death|ended at death|its target died/;

function naturalEndAtDeath(ctx: IRoundCtx, line: string): void {
  if (!DEATH_WORDS.test(line)) return;
  const m = DEATH_LINE.exec(line);
  if (!m) return;
  const faded = m[2] === "BUFF FADED";
  const rest = m[3]!;
  const named = faded
    ? undefined
    : ctx.unitOfPid(/^(\d+)\(/.exec(rest)?.[1] ?? "");
  const name = faded
    ? /^(.+?) \(/.exec(rest)?.[1]
    : (/← (.+?) \(by /.exec(rest)?.[1] ?? /: (.+?) \(/.exec(rest)?.[1]);
  if ((!faded && !named) || !name) return;
  ctx.bump("naturalEndAtDeath");
  const targetDied = /its target died/.test(rest);
  // whose copy the line talks about, and from whom
  const first = faded ? ctx.owner : named;
  const holders = targetDied ? ctx.players.filter((p) => p !== first) : [first];
  const by = /\(by (\d+)\(/.exec(rest)?.[1];
  const source = targetDied ? first : by ? ctx.unitOfPid(by) : undefined;
  const share =
    DR_SHARE[/\[DR: \S+ (Full|50%|25%)\]/.exec(rest)?.[1] ?? "Full"]!;
  const lo = ctx.start + secOf(m[1]!) * 1000;
  const dies = (u: any, at: number) =>
    ((u.deathRecords ?? []) as any[]).some(
      (d) => d.timestamp >= at - 200 && d.timestamp - at <= 200,
    );
  for (const holder of holders) {
    // one aura name can be two ids: the line's run is the one that went on
    // to the death (Snowdrift's 2 s slow beside its 4 s stun, Berserker
    // Shout's 0.1 s 384102 beside its 6 s 384100)
    const run = idsNamed(holder, name)
      .flatMap((id) => {
        const rows = rowsOf(holder, id).filter(
          (a) => !source || a.srcUnitId === source.id,
        );
        // a [BUFF FADED] line stands at the end, the rest at the start
        const started = faded
          ? undefined
          : rows.find(
              (a) =>
                ev(a) === APPLIED && tsOf(a) >= lo - 200 && tsOf(a) < lo + 1000,
            );
        if (!faded && !started) return [];
        const rm = rows.find(
          (a) =>
            ev(a) === REMOVED &&
            (started
              ? tsOf(a) >= tsOf(started)
              : tsOf(a) >= lo - 1000 && tsOf(a) < lo + 2000),
        );
        if (!rm) return [];
        const apply =
          started ??
          rows
            .filter(
              (a) =>
                (ev(a) === APPLIED || ev(a) === REFRESH) && tsOf(a) <= tsOf(rm),
            )
            .pop();
        return apply ? [{ id, rm, apply, at: tsOf(rm) as number }] : [];
      })
      .sort((x, y) => y.at - x.at)[0];
    if (!run) continue;
    const { id, rm, apply, at } = run;
    if (targetDied && !dies(holder, at)) continue;
    const caster = ctx.units.find((u) => u.id === apply.srcUnitId);
    const full = buffFullDurationForCaster(id, caster, tsOf(apply));
    const fact = `${name}#${at}`;
    if (full && Math.abs(at - tsOf(apply) - full * share * 1000) <= JITTER_MS)
      ctx.violate(
        "naturalEndAtDeath",
        "full length",
        at,
        fact,
        `${name} on ${holder.name}: ran ${((at - tsOf(apply)) / 1000).toFixed(3)}s of ${full}s × ${share}`,
        line,
      );
    else if (
      ctx.players.some(
        (o) =>
          o !== holder &&
          !dies(o, at) &&
          rowsOf(o, id).some(
            (a) =>
              ev(a) === REMOVED &&
              tsOf(a) === at &&
              a.srcUnitId === rm.srcUnitId,
          ),
      )
    )
      ctx.violate(
        "naturalEndAtDeath",
        "left a survivor",
        at,
        fact,
        `${name} left a unit that lived on in the ms it left ${holder.name}`,
        line,
      );
  }
}

const CHANNEL_LINE =
  /^\s*(\d+:\d\d)\s+\[YOU\] \[CD\]\s+(.+?) \((?:channeled|interrupted at) (\d+\.\d)s(?:, ended|, ended) /;

function channelOutlived(ctx: IRoundCtx, line: string): void {
  const m = CHANNEL_LINE.exec(line);
  if (!m) return;
  ctx.bump("channelOutlived");
  const t = secOf(m[1]!);
  const lo = ctx.start + t * 1000;
  const press = successesOf(ctx.owner).find(
    (c) =>
      nameOf(c.spellId, c.spellName ?? "") === m[2] &&
      tsOf(c) >= lo &&
      tsOf(c) < lo + 1000,
  );
  const startRow = ((ctx.owner.spellCastEvents ?? []) as any[]).find(
    (c) =>
      ev(c) === "SPELL_CAST_START" &&
      nameOf(c.spellId, c.spellName ?? "") === m[2] &&
      tsOf(c) >= lo - 3000 &&
      tsOf(c) < lo + 1000,
  );
  const at = press ? tsOf(press) : startRow ? tsOf(startRow) : undefined;
  if (at === undefined) return;
  const end = at + Number(m[3]) * 1000;
  const inside = ((ctx.owner.spellCastEvents ?? []) as any[]).find(
    (c) =>
      (ev(c) === "SPELL_CAST_START" ||
        // a cast row with no DB2 SpellCooldowns row is no button press (a
        // pet command: Command Demon's Spell Lock 119910 inside Dark
        // Harvest, its ticks running on — `isButtonPress`, codex 20-F25-01)
        (ev(c) === SUCCESS && isButtonPress(String(c.spellId)))) &&
      c.srcUnitId === ctx.owner.id &&
      nameOf(c.spellId, c.spellName ?? "") !== m[2] &&
      tsOf(c) > at + 100 &&
      tsOf(c) < end - 100,
  );
  if (inside)
    ctx.violate(
      "channelOutlived",
      nameOf(inside.spellId, inside.spellName ?? ""),
      at,
      `${m[2]}#${at}`,
      `${m[2]} printed ${m[3]}s, ${nameOf(inside.spellId, inside.spellName ?? "")} ${ev(inside)} at +${((tsOf(inside) - at) / 1000).toFixed(3)}s`,
      line,
    );
}

const KILL_WINDOW_ON =
  /\[(?:KILL WINDOW|VULNERABLE)\].* on [^:]*?\(([^)]+)\).*defenseless (\d+:\d\d)–(\d+:\d\d)/;
const ENEMY_DEF_WALL =
  /^\s*(\d+:\d\d)\s+\[ENEMY DEF\]\s+(\d+)\([^)]*\)(?: \([^)]*\))?: (.+?) \((?:\d+%), (\d+\.\d)s/;

function wallHeldPastHold(ctx: IRoundCtx): void {
  const walls = ctx.lines.flatMap((l) => {
    const m = ENEMY_DEF_WALL.exec(l);
    return m
      ? [
          {
            at: secOf(m[1]!),
            unit: ctx.unitOfPid(m[2]),
            name: m[3]!,
            len: Number(m[4]),
          },
        ]
      : [];
  });
  for (const line of ctx.lines) {
    const m = KILL_WINDOW_ON.exec(line);
    if (!m) continue;
    const unit = ctx.byName.get(m[1]!);
    if (!unit) continue;
    ctx.bump("wallHeldPastHold");
    const a = secOf(m[2]!);
    const b = secOf(m[3]!);
    for (const w of walls) {
      if (w.unit !== unit) continue;
      const end = w.at + w.len;
      if (w.at <= a && end > a + 1 && a < b)
        ctx.violate(
          "wallHeldPastHold",
          "aura outlasted the hold",
          ctx.start + a * 1000,
          `${unit.name}#${w.name}#${w.at}#${a}`,
          `${w.name} on ${unit.name} ${fmtS(w.at)} for ${w.len}s, span opens ${m[2]}`,
          line,
        );
    }
  }
}

const BURST_HEAD = /^\s*Burst #\d+ — (\d+:\d\d)–/;
const UNSEEN_LINE =
  /(.+?) active ON THE TARGET (\d+\.\d)s of this burst(?: \((already up|pressed (<?\d+\.\d)s after))?/;
const VANISH = "11327";
const NO_UNIT = "0000000000000000";

/** The first debuff `u` put on a player after `t` that opens something. */
function firstOpener(
  ctx: IRoundCtx,
  u: any,
  id: string,
  t: number,
): any | undefined {
  const opens = (r: any): boolean => {
    const mech = ccMechanicOf(r.spellId);
    if (mech === undefined || mech === 11) return false;
    const presses = new Set<string>([
      r.spellId,
      ...castsOfEffectAura(r.spellId),
    ]);
    if (
      id === VANISH &&
      [...presses].some((p) => ALLOWED_WHILE_STEALTHED_SPELL_IDS.has(p))
    )
      return false;
    return !successesOf(u).some(
      (c) =>
        presses.has(c.spellId) &&
        (!c.destUnitId || c.destUnitId === NO_UNIT) &&
        tsOf(c) <= t &&
        tsOf(c) + (spellEffectData[c.spellId]?.durationSeconds ?? 0) * 1000 >=
          tsOf(r),
    );
  };
  return ctx.players
    .flatMap((p) =>
      ((p.auraEvents ?? []) as any[]).filter(
        (r) =>
          p.id !== u.id &&
          r.destUnitId === p.id &&
          r.srcUnitId === u.id &&
          ev(r) === APPLIED &&
          r.auraType === "DEBUFF" &&
          r.spellId &&
          tsOf(r) > t &&
          opens(r),
      ),
    )
    .sort((x, y) => tsOf(x) - tsOf(y))[0];
}

function unseenEndOpener(ctx: IRoundCtx): void {
  // the ledger's sentence names the aura; its row sits under the burst head
  let burstAt: number | undefined;
  for (const line of ctx.lines) {
    const h = BURST_HEAD.exec(line);
    if (h) burstAt = ctx.start + secOf(h[1]!) * 1000;
    const m = UNSEEN_LINE.exec(line);
    if (!m || burstAt === undefined) continue;
    const name = m[1]!.replace(/^.*: /, "").trim();
    const s = Number(m[2]);
    const after = m[4] ? Number(m[4].replace("<", "")) * 1000 : undefined;
    // the holder: whoever has a run of this aura with no end row, applied
    // where the line says
    for (const u of ctx.players) {
      for (const id of idsNamed(u, name)) {
        if (!SAVE_AURA_END_UNSEEN_IDS.has(id)) continue;
        const rows = rowsOf(u, id);
        const runs = rows.flatMap((a, k) => {
          const next = rows[k + 1];
          return ev(a) === APPLIED && !(next && ev(next) === REMOVED)
            ? [tsOf(a) as number]
            : [];
        });
        // the head and the offset are both printed: a second either way
        const t =
          after !== undefined
            ? runs.find((x) => Math.abs(x - burstAt! - after) <= 1200)
            : runs.filter((x) => x <= burstAt! + 1000).pop();
        if (t === undefined) continue;
        ctx.bump("unseenEndOpener");
        const first = firstOpener(ctx, u, id, t);
        if (!first) continue;
        const gap = (tsOf(first) - t) / 1000;
        if (s > gap + 0.1)
          ctx.violate(
            "unseenEndOpener",
            name,
            t,
            `${u.name}#${id}#${t}`,
            `${name} on ${u.name}: printed ${s}s, ${nameOf(first.spellId, first.spellName ?? "")} of theirs landed ${gap.toFixed(3)}s in`,
            line,
          );
      }
    }
  }
}

/** DB2 aura 186 (spells miss the holder) → its school mask: the immunity the
 * generated school table does not carry (forward query on SpellEffect ×
 * observedSpellIdsGenerated, 12.1.5.70575) */
const SPELL_MISS_AURAS: ReadonlyMap<string, number> = new Map([
  ["31224", 126], // Cloak of Shadows
  ["186265", 127], // Aspect of the Turtle
  ["408558", 127], // Phase Shift
  ["409293", 127], // Burrow
]);

const NOT_LANDED =
  /^\s*(\d+:\d\d)\s+\[CC NOT LANDED\]\s+(\d+)\([^)]*\) ← (.+?) \(by (\d+)\([^)]*\).*— logged IMMUNE\s*$/;

function immuneCauseUnnamed(ctx: IRoundCtx, line: string): void {
  const m = NOT_LANDED.exec(line);
  if (!m) return;
  const target = ctx.unitOfPid(m[2]);
  const caster = ctx.unitOfPid(m[4]);
  if (!target || !caster) return;
  ctx.bump("immuneCauseUnnamed");
  const lo = ctx.start + secOf(m[1]!) * 1000;
  const miss = ((target.missesIn ?? []) as any[]).find(
    (x) =>
      x.missType === "IMMUNE" &&
      x.srcUnitId === caster.id &&
      nameOf(x.spellId, x.spellName ?? "") === m[3] &&
      x.timestamp >= lo &&
      x.timestamp < lo + 1000,
  );
  if (!miss) return;
  const at: number = miss.timestamp;
  const mech = ccMechanicOf(miss.spellId);
  const upIds = new Set<string>();
  for (const a of (target.auraEvents ?? []) as any[]) {
    if (a.destUnitId !== target.id || tsOf(a) > at) continue;
    if (ev(a) === APPLIED || ev(a) === REFRESH) upIds.add(a.spellId);
    else if (ev(a) === REMOVED) upIds.delete(a.spellId);
  }
  for (const id of upIds) {
    if (
      immunityCoversSpell(id, miss.spellId) === true ||
      (mech !== undefined && auraBlocksMechanic(id, mech) === true) ||
      (SPELL_MISS_AURAS.get(id) ?? 0) & (spellSchoolMask(miss.spellId) ?? 0)
    ) {
      ctx.violate(
        "immuneCauseUnnamed",
        nameOf(id),
        at,
        `${target.name}#${miss.spellId}#${at}`,
        `${m[3]} IMMUNE on ${target.name} with ${nameOf(id)} (${id}) up`,
        line,
      );
      return;
    }
  }
}

/** Grimoire of Sacrifice's own Spell Lock: a cooldown of its own beside the
 * pet's 19647 (be070452 r3, 23:07: 132409 at 11.486, the pet's 19647 at
 * 13.616, the next 132409 at 58.219). A [KICK] line's back is its button's. */
const SPELL_LOCK_OWN = "132409";

const KICK_BACK =
  /^\s*(\d+:\d\d)\s+\[KICK\]\s+(?:(\d+)\([^)]*\)|your) .*\(([^;)]+); back (\d+:\d\d)\)/;
const RES_CD = /(?:^|[ ,])(?:(\d+):)?([A-Z][^,()[\]]*?)\((\d+)s\)/g;

function kickBack(ctx: IRoundCtx): void {
  const kickNames = new Set(
    INTERRUPT_SPELL_IDS.map((id) => nameOf(id)).filter(Boolean),
  );
  const rowsNamed = (u: any, name: string): any[] =>
    [...successesOf(u), ...((u.petSpellCastEvents ?? []) as any[])]
      .filter(
        (c) =>
          ev(c) === SUCCESS && nameOf(c.spellId, c.spellName ?? "") === name,
      )
      .sort((x, y) => tsOf(x) - tsOf(y));
  const pressesOf = (u: any, name: string): number[] =>
    rowsNamed(u, name).map(tsOf);
  /** the presses of the button the kick in this second came from */
  const buttonPressesOf = (u: any, name: string, at: number): number[] => {
    const rows = rowsNamed(u, name);
    const own = rows.find((c) => tsOf(c) >= at && tsOf(c) < at + 1000);
    if (!own) return rows.map(tsOf);
    const isOwn = own.spellId === SPELL_LOCK_OWN;
    return rows
      .filter((c) => (c.spellId === SPELL_LOCK_OWN) === isOwn)
      .map(tsOf);
  };
  let t = 0;
  for (const line of ctx.lines) {
    const head = /^\s*(\d+:\d\d)\s/.exec(line);
    if (head) t = secOf(head[1]!);
    const k = KICK_BACK.exec(line);
    if (k) {
      const unit = k[2] ? ctx.unitOfPid(k[2]) : ctx.owner;
      if (unit) {
        const at = ctx.start + secOf(k[1]!) * 1000;
        const back = ctx.start + secOf(k[4]!) * 1000;
        ctx.bump("kickBackVsNextPress");
        const next = buttonPressesOf(unit, k[3]!, at).find(
          (p) => p >= at + 1000,
        );
        if (next !== undefined && next < back - 1000)
          ctx.violate(
            "kickBackVsNextPress",
            `[KICK] ${k[3]}`,
            at,
            `${unit.name}#${k[3]}#${k[1]}#kick`,
            `back ${k[4]}, pressed again ${fmtS((next - ctx.start) / 1000)}`,
            line,
          );
      }
    }
    if (!/^\s*\[RES\]/.test(line)) continue;
    const cd = /(?:^|\s)cd:(\S.*?)(?:\s\||\s{2}|$)/.exec(line)?.[1];
    if (!cd) continue;
    for (const e of cd.matchAll(RES_CD)) {
      if (!kickNames.has(e[2]!)) continue;
      const unit = e[1] ? ctx.unitOfPid(e[1]) : ctx.owner;
      if (!unit) continue;
      ctx.bump("kickBackVsNextPress");
      const at = ctx.start + t * 1000;
      const back = at + Number(e[3]) * 1000;
      const next = pressesOf(unit, e[2]!).find((p) => p >= at + 1000);
      if (next !== undefined && next < back - 2000)
        ctx.violate(
          "kickBackVsNextPress",
          `[RES] ${e[2]}`,
          at,
          `${unit.name}#${e[2]}#${t}#res`,
          `${e[2]}(${e[3]}s) at ${fmtS(t)}, pressed again ${fmtS((next - ctx.start) / 1000)}`,
          line,
        );
    }
  }
}

export function run(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    ccEndCause(ctx, line);
    naturalEndAtDeath(ctx, line);
    channelOutlived(ctx, line);
    immuneCauseUnnamed(ctx, line);
  }
  wallHeldPastHold(ctx);
  unseenEndOpener(ctx);
  kickBack(ctx);
}
