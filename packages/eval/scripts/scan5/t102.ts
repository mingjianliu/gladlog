/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, actionIn) */
/**
 * scan5/t102.ts — ticket T102: concurrent controls of one kind on a unit
 * collapsed to one `[RES] … cc:` entry. The kick slot took the first active
 * lockout (`interruptInstances.find`), and so did the root and disarm
 * slots. 16a56b26 r0 1:40: `cc:1/Counter Shot-<1s[kick]` while a Rebuke on
 * Nature held 2.2 s more. 26c4ac25 r0 2:24: `Counter Shot-1s[kick]` while a
 * Spell Lock on Shadow held 3.8 s more.
 *
 * Truth comes from the log rows, read at the row's own second t (the
 * snapshot's render second, `atSeconds <= t < end`):
 *  - a kick is an enemy SPELL_INTERRUPT on the unit plus its lockout
 *    (`kickLockoutSecondsFor`);
 *  - a root (`rootSpellIds`) or disarm (`disarmSpellIds`) is an enemy aura,
 *    APPLIED to the first REMOVED / BROKEN of it from that caster.
 *
 *  - `resCcConcurrentDropped`: a `[RES]` row whose `cc:` lists at least one
 *    entry of kind K (`[kick]` / `[root]` / `[disarm]`) for a unit while the
 *    log holds another instance of K on that unit at t that the row leaves
 *    out. Each listed entry stands for one active instance of its name
 *    (the one whose remaining renders as the entry's through the producer's
 *    `resCcRemainingText`, else the nearest), so a second
 *    same-name instance is not covered by the first. For a kick, a lockout
 *    left over counts with more than 0.2 s left. For a root or a disarm,
 *    one counts when it outlasts the listed one by more than 0.2 s. A root
 *    or disarm aura with no end row runs its official length; with none it
 *    is left out. A root or disarm ends by the analysis's `roundEndMs`, as
 *    it clips them; a kick keeps its full lockout, as it renders. A SPELL_INTERRUPT row the log wrote twice is one. Kind = K.
 */
import { resCcRemainingText } from "@gladlog/analysis/src/context/resLedgerPrune";
import { spellEffectData } from "@gladlog/analysis/src/data/spellEffectData";
import {
  disarmSpellIds,
  rootSpellIds,
} from "@gladlog/analysis/src/data/spellTags";
import { kickLockoutSecondsFor } from "@gladlog/analysis/src/utils/kickLockout";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import { APPLIED, ev, type IRoundCtx, nameOf, REMOVED, tsOf } from "./ctx";

export const CHECKS = ["resCcConcurrentDropped"] as const;

type Kind = "kick" | "root" | "disarm";
interface IInst {
  kind: Kind;
  name: string;
  from: number;
  to: number;
}

const TIME_RE = /^\s*(\d+):(\d\d)\s/;
const RES_CC_RE = /\[RES\].*?\s\scc:(\S.*?)(?:\s\s|$)/;
const ENTRY_RE =
  /^(\d+)\/(.+?)-(<1s|\d+s)(?:\[stun\])?(?:\[trinketed\])?(\[root\]|\[disarm\]|\[kick\])?$/;
/** an unlisted instance ending this much later than what was listed is a
 * drop; below it the log and the analysis's lengths may differ by rounding */
const SLACK_MS = 200;
/** the rendered remaining's whole seconds (`resCcRemainingText`:
 * `Math.round`, `<1s` below one) */
const renderedS = (t: string): number =>
  t === "<1s" ? 0 : Number(t.slice(0, -1));
const BROKEN = (e: string) =>
  e === "SPELL_AURA_BROKEN" || e === "SPELL_AURA_BROKEN_SPELL";

function instancesOf(ctx: IRoundCtx, unit: any): IInst[] {
  const enemy = new Set(
    ctx.units
      .filter((u) => u.reaction !== unit.reaction)
      .map((u) => u.id as string),
  );
  const out: IInst[] = [];
  const auras = ((unit.auraEvents ?? []) as any[]).filter(
    (a) => a.destUnitId === unit.id,
  );
  auras.forEach((a, i) => {
    if (ev(a) !== APPLIED || !enemy.has(a.srcUnitId)) return;
    const id = String(a.spellId ?? "");
    const kind: Kind | undefined = rootSpellIds.has(id)
      ? "root"
      : disarmSpellIds.has(id)
        ? "disarm"
        : undefined;
    if (!kind) return;
    const end = auras
      .slice(i + 1)
      .find(
        (r) =>
          String(r.spellId) === id &&
          ((ev(r) === REMOVED && r.srcUnitId === a.srcUnitId) || BROKEN(ev(r))),
      );
    // no end row: the official length bounds it; with none, its end is
    // unknown and the instance is left out (codex 85-tk-L-T102-1 #3)
    const lenS = spellEffectData[id]?.durationSeconds;
    if (!end && !lenS) return;
    out.push({
      kind,
      name: nameOf(id, a.spellName),
      from: tsOf(a),
      to: end ? tsOf(end) : tsOf(a) + lenS! * 1000,
    });
  });
  const seenKick = new Set<string>();
  for (const k of (unit.actionIn ?? []) as any[]) {
    if (ev(k) !== "SPELL_INTERRUPT" || !enemy.has(k.srcUnitId)) continue;
    // a row the log wrote twice is one interrupt
    const kk = `${k.srcUnitId}|${k.spellId}|${tsOf(k)}`;
    if (seenKick.has(kk)) continue;
    seenKick.add(kk);
    const lockS = kickLockoutSecondsFor(
      String(k.spellId),
      unit,
      String(k.extraSpellId),
      tsOf(k),
      ctx.units.find((u) => u.id === k.srcUnitId),
    );
    out.push({
      kind: "kick",
      name: nameOf(String(k.spellId), k.spellName),
      from: tsOf(k),
      to: tsOf(k) + lockS * 1000,
    });
  }
  return out;
}

export function run(ctx: IRoundCtx): void {
  const C = "resCcConcurrentDropped";
  const cache = new Map<string, IInst[]>();
  const roundEnd = roundEndMs(ctx.legacy as never);
  let sec: number | undefined;
  for (const line of ctx.lines) {
    const tm = TIME_RE.exec(line);
    if (tm) sec = Number(tm[1]) * 60 + Number(tm[2]);
    const m = RES_CC_RE.exec(line);
    if (!m || sec === undefined) continue;
    const ms = ctx.start + sec * 1000;
    // listed entries per (pid, kind): name and rendered remaining
    const listed = new Map<string, Array<{ name: string; text: string }>>();
    for (const raw of m[1]!.split(",")) {
      const e = ENTRY_RE.exec(raw.trim());
      if (!e || !e[4]) continue;
      const kind = e[4].slice(1, -1) as Kind;
      const key = `${e[1]}|${kind}`;
      listed.set(key, [
        ...(listed.get(key) ?? []),
        { name: e[2]!, text: e[3]! },
      ]);
    }
    for (const [key, entries] of listed) {
      const [pid, kind] = key.split("|") as [string, Kind];
      const unit = ctx.unitOfPid(pid);
      if (!unit) continue;
      ctx.bump(C);
      let insts = cache.get(unit.id);
      if (!insts) cache.set(unit.id, (insts = instancesOf(ctx, unit)));
      // a root / disarm ends by the round's end as the analysis clips it
      // (its own `roundEndMs`, codex 85-tk-L-T102-1b #2 / 1c #2: a Solo
      // Shuffle death at 11.1 s; a 3v3 round keeps the log's end); a kick
      // renders its full lockout, unclipped (1c #3)
      const active = insts
        .map((iv) =>
          iv.kind === "kick" ? iv : { ...iv, to: Math.min(iv.to, roundEnd) },
        )
        .filter((iv) => iv.kind === kind && iv.from <= ms && ms < iv.to);
      // each listed entry stands for one active instance of its name: the
      // one whose remaining renders as the entry's (the producer's own
      // formatter, codex 85-tk-L-T102-1b #1), else the nearest; a same-name
      // instance left over is not represented (codex 85-tk-L-T102-1 #2)
      const unmatched = [...active];
      const matched: IInst[] = [];
      const leftS = (iv: IInst) => (iv.to - ms) / 1000;
      for (const en of entries) {
        const same = unmatched
          .map((iv, i) => ({ iv, i }))
          .filter((x) => x.iv.name === en.name);
        // of the instances that render as the entry, the one the producer
        // prints: a root / disarm slot takes the longest (1c #1)
        const exact = same
          .filter((x) => resCcRemainingText(leftS(x.iv)) === en.text)
          .reduce<(typeof same)[number] | undefined>(
            (b, x) => (!b || x.iv.to > b.iv.to ? x : b),
            undefined,
          );
        const pick =
          exact ??
          same.reduce<(typeof same)[number] | undefined>(
            (b, x) =>
              !b ||
              Math.abs(leftS(x.iv) - renderedS(en.text)) <
                Math.abs(leftS(b.iv) - renderedS(en.text))
                ? x
                : b,
            undefined,
          );
        if (pick) matched.push(...unmatched.splice(pick.i, 1));
      }
      // a kick: every lockout is listed; a root / disarm: the longest one
      const listedEnd = Math.max(...matched.map((iv) => iv.to));
      const dropped = unmatched.find((iv) =>
        kind === "kick"
          ? iv.to - ms > SLACK_MS
          : Number.isFinite(listedEnd) && iv.to > listedEnd + SLACK_MS,
      );
      if (!dropped) continue;
      ctx.violate(
        C,
        kind,
        ms,
        `${unit.id}#${kind}#${dropped.name}#${dropped.from}`,
        `${pid}: lists ${entries.map((x) => x.name).join(", ")} [${kind}] at ${sec}s, leaves out ${dropped.name} (${((dropped.to - ms) / 1000).toFixed(1)}s left)`,
        line.trim(),
      );
    }
  }
}
