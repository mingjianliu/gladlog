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
 *    out. For a kick, a lockout on another school counts with more than
 *    0.2 s left. For a root or a disarm, the unlisted instance counts when
 *    it outlasts every listed one by at least 1 s. Kind = K.
 */
import {
  disarmSpellIds,
  rootSpellIds,
} from "@gladlog/analysis/src/data/spellTags";
import { kickLockoutSecondsFor } from "@gladlog/analysis/src/utils/kickLockout";

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
  /^(\d+)\/(.+?)-(?:<1s|\d+s)(?:\[stun\])?(?:\[trinketed\])?(\[root\]|\[disarm\]|\[kick\])?$/;
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
    out.push({
      kind,
      name: nameOf(id, a.spellName),
      from: tsOf(a),
      to: end ? tsOf(end) : Infinity,
    });
  });
  for (const k of (unit.actionIn ?? []) as any[]) {
    if (ev(k) !== "SPELL_INTERRUPT" || !enemy.has(k.srcUnitId)) continue;
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
  let sec: number | undefined;
  for (const line of ctx.lines) {
    const tm = TIME_RE.exec(line);
    if (tm) sec = Number(tm[1]) * 60 + Number(tm[2]);
    const m = RES_CC_RE.exec(line);
    if (!m || sec === undefined) continue;
    const ms = ctx.start + sec * 1000;
    // listed entries per (pid, kind)
    const listed = new Map<string, string[]>();
    for (const raw of m[1]!.split(",")) {
      const e = ENTRY_RE.exec(raw.trim());
      if (!e || !e[3]) continue;
      const kind = e[3].slice(1, -1) as Kind;
      const key = `${e[1]}|${kind}`;
      listed.set(key, [...(listed.get(key) ?? []), e[2]!]);
    }
    for (const [key, names] of listed) {
      const [pid, kind] = key.split("|") as [string, Kind];
      const unit = ctx.unitOfPid(pid);
      if (!unit) continue;
      ctx.bump(C);
      let insts = cache.get(unit.id);
      if (!insts) cache.set(unit.id, (insts = instancesOf(ctx, unit)));
      const active = insts.filter(
        (iv) => iv.kind === kind && iv.from <= ms && ms < iv.to,
      );
      const listedEnd = Math.max(
        ...active.filter((iv) => names.includes(iv.name)).map((iv) => iv.to),
      );
      const dropped = active.find((iv) =>
        names.includes(iv.name)
          ? false
          : kind === "kick"
            ? iv.to - ms > 200
            : Number.isFinite(listedEnd) && iv.to >= listedEnd + 1000,
      );
      if (!dropped) continue;
      ctx.violate(
        C,
        kind,
        ms,
        `${unit.id}#${kind}#${dropped.name}#${dropped.from}`,
        `${pid}: lists ${names.join(", ")} [${kind}] at ${sec}s, leaves out ${dropped.name} (${((dropped.to - ms) / 1000).toFixed(1)}s left)`,
        line.trim(),
      );
    }
  }
}
