/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * t29 (pipeline 2026-11-08) class check — T29.
 *
 *  - pressEffectRefusedListed: a `[RES]` row's `enemy:` entry `X/<spec>(Ns
 *    left)` whose holder's latest press of X at or before the row is one the
 *    game refused — the product's own predicate, `pressEffectRefusedAtCast`
 *    (a SPELL_MISSED of the cast or an effect id by the caster in the
 *    press's start window, nothing of it landed) — on a row after the
 *    press's second: a refused press ran for no time. b74d7bf6 r1 2:45:
 *    Deathmark met two IMMUNE and put no 360194 on anyone; `[RES]` listed it
 *    to 3:00. Kind: `refused <missType>` (the first miss's type). Counted:
 *    every enemy entry (no `(no press)` tag) whose holder — spec unique on
 *    the roster — has a press of X at or before the row.
 *  - refusedPressMarker (T29 R15): a menu `missed-sync-window` row's
 *    `pressedAfter` / `priorPress` entry that carries `(refused: <MISS>[;
 *    cooldown spent|not spent])` (`REFUSED_PRESS_MARKER_RE`) — its press
 *    (the holder's press of X — the holder `readyCds` names, else the
 *    team's — at the printed second, one press only) must be one the
 *    producer's `pressRefusalMissType` refuses with that miss type, a
 *    non-ABSORB miss row of that type must sit on the press's own target
 *    (the cast row's dest, when it names one) in its start window, and the
 *    cooldown clause must be `refusedPressCooldownState`'s reading (absent
 *    when it decides nothing). Kind: the first disagreement. Counted: every
 *    marker.
 *  - refusedPressUnmarked: a `pressedAfter` entry whose press the producer
 *    refuses, printed without the marker. Counted: every `pressedAfter`
 *    entry whose press is found.
 *  - refusedNotSpentReadiness: a `cooldown not spent` marker on X while a
 *    later missed-sync row of the round leaves the holder's X out of
 *    `readyCds` where the producer's readiness (`syncWindowCdFor` +
 *    `evaluateSyncWindow` on the holder's ledger entry — which still counts
 *    the refused press, GH #158 — with its feasibility gates) lists X only
 *    with the refused press dropped. Counted: every `not spent` marker.
 */
import {
  enemyHealerCcWindows,
  evaluateSyncWindow,
  mergeHealerCcWindows,
  parseSyncReadyCdEntry,
  syncWindowCdFor,
} from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import {
  parseResRow,
  splitResList,
} from "@gladlog/analysis/src/context/resRow";
import { effectSpanIdsOfCast } from "@gladlog/analysis/src/data/castEffectAuras";
import { unitCooldownEntry } from "@gladlog/analysis/src/utils/cooldowns";
import {
  pressEffectRefusedAtCast,
  pressRefusalMissType,
} from "@gladlog/analysis/src/utils/enemyCDs";
import {
  REFUSED_PRESS_MARKER_RE,
  refusedPressCooldownState,
} from "@gladlog/analysis/src/utils/refusedPress";
import { toRenderSecond } from "@gladlog/analysis/src/utils/renderGrid";

import { type IRoundCtx, nameOf, secOf, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "pressEffectRefusedListed",
  "refusedPressMarker",
  "refusedPressUnmarked",
  "refusedNotSpentReadiness",
] as const;

export function run(ctx: IRoundCtx): void {
  pressEffectRefusedListed(ctx);
  refusedPressMarkers(ctx);
}

const ROSTER =
  /<unit\s+id="(\d+)"\s+name="[^"]+"\s+spec="([^"]+)"\s+role="enemy"/;
const ENTRY = /^(.*)\/([^/]+?)\((\d+)s left\)$/;

function pressEffectRefusedListed(ctx: IRoundCtx): void {
  const lines = ctx.text.split("\n");
  const pidsOfSpec = new Map<string, string[]>();
  for (const l of lines) {
    const r = ROSTER.exec(l);
    if (r) pidsOfSpec.set(r[2]!, [...(pidsOfSpec.get(r[2]!) ?? []), r[1]!]);
  }
  const combat = { units: ctx.legacy.units };
  let atS = 0;
  for (const l of lines) {
    const t = /^(\d+:\d{2})\s/.exec(l);
    if (t) atS = secOf(t[1]!);
    const enemy = parseResRow(l)?.enemy;
    if (!enemy) continue;
    for (const entry of splitResList(enemy)) {
      const e = ENTRY.exec(entry.trim());
      if (!e || / \(no press\)$/.test(e[1]!)) continue;
      const pids = pidsOfSpec.get(e[2]!) ?? [];
      if (pids.length !== 1) continue;
      const holder = ctx.unitOfPid(pids[0]);
      if (!holder) continue;
      const rowEndMs = ctx.start + (atS + 1) * 1000 - 1;
      const presses = successesOf(holder)
        .filter((c: any) => nameOf(c.spellId, c.spellName) === e[1])
        .sort((x: any, y: any) => tsOf(x) - tsOf(y));
      const i = presses.reduce(
        (last: number, c: any, k: number) => (tsOf(c) <= rowEndMs ? k : last),
        -1,
      );
      if (i < 0) continue;
      ctx.bump("pressEffectRefusedListed");
      const press = presses[i];
      const p = tsOf(press);
      // a row in the press's own second may list it
      if (Math.floor((p - ctx.start) / 1000) >= atS) continue;
      const next = presses
        .slice(i + 1)
        .find((c: any) => String(c.spellId) === String(press.spellId));
      const id = String(press.spellId);
      if (
        !pressEffectRefusedAtCast(
          holder,
          id,
          p,
          next ? tsOf(next) : Infinity,
          combat,
        )
      )
        continue;
      const miss = ((holder.missesOut ?? []) as any[]).find(
        (m) =>
          m.srcUnitId === holder.id &&
          m.missType !== "ABSORB" &&
          effectSpanIdsOfCast(id).has(String(m.spellId)) &&
          tsOf(m) >= p,
      );
      const kind = `refused ${miss?.missType ?? "?"}`;
      ctx.violate(
        "pressEffectRefusedListed",
        kind,
        ctx.start + atS * 1000,
        `${holder.name}:${Math.floor((p - ctx.start) / 1000)}:${e[1]}`,
        `${holder.name}: ${e[1]} pressed at ${((p - ctx.start) / 1000).toFixed(3)}s, refused (${kind}); [RES] ${atS}s lists ${entry.trim()}`,
        l.trim().slice(0, 220),
      );
    }
  }
}

const SYNC_ROW =
  /id=missed-sync-window:\S+ type=missed-sync-window t=\d+s [^\n]*?facts=\{t=(\d+), windowEndT=(\d+),([^\n]*)\}/g;
/** one fact's value: up to the next `, key=` (values carry no ", ") */
const factOf = (facts: string, key: string): string | undefined =>
  new RegExp(`(?:^|, )${key}=(.*?)(?=, [A-Za-z]+=|$)`).exec(facts)?.[1];
const PRESSED_AFTER =
  /(.+?) ([+-]\d+(?:\.\d+)?)s( \(refused: [A-Z_]+(?:; cooldown (?:spent|not spent))?\))?(?:; |$)/g;
const PRIOR_PRESS =
  /(.+?) at (\d+) (\(refused: [A-Z_]+(?:; cooldown (?:spent|not spent))?\))(?:、|$)/g;

function refusedPressMarkers(ctx: IRoundCtx): void {
  if (!ctx.owner || !ctx.menu.includes("missed-sync-window")) return;
  const side = ctx.players.filter((u) => u.reaction === ctx.owner.reaction);
  const rs = ctx.rawStreams();
  const failed = rs.available ? rs.castFailed : undefined;
  /** the presses of X (English name) by `units`, each with its next press
   * of the same id (the timeline's bound) */
  const pressesOf = (name: string, units: readonly any[]) =>
    units.flatMap((u) => {
      const own = successesOf(u).sort((a: any, b: any) => tsOf(a) - tsOf(b));
      return own
        .filter((c: any) => nameOf(c.spellId, c.spellName) === name)
        .map((c: any) => ({
          u,
          c,
          id: String(c.spellId),
          ms: tsOf(c),
          next: own.find(
            (n: any) =>
              String(n.spellId) === String(c.spellId) && tsOf(n) > tsOf(c),
          ),
        }));
    });
  type Press = ReturnType<typeof pressesOf>[number];
  const rows = [...ctx.menu.matchAll(SYNC_ROW)].map((row) => {
    const facts = row[3]!;
    /** readyCds: "X (yours)" / "X (Name's)" → every holder of X it names
     * (codex T29-1j #3: two holders of one spell both stay) */
    const holders = new Map<string, any[]>();
    for (const part of factOf(facts, "readyCds")?.split("、") ?? []) {
      const e = parseSyncReadyCdEntry(part);
      const u = e.yours
        ? ctx.owner
        : e.holder
          ? ctx.byName.get(e.holder)
          : undefined;
      if (u) holders.set(e.spell, [...(holders.get(e.spell) ?? []), u]);
    }
    return { row, fromS: +row[1]!, endS: +row[2]!, facts, holders };
  });
  const notSpent: Press[] = [];
  const check = (
    name: string,
    candidates: Press[],
    marker: string | undefined,
    where: string,
  ) => {
    // a press the scan cannot pin to one caster is not checked (codex
    // T29-1i #4: never the first of several)
    if (candidates.length !== 1) return;
    const p = candidates[0]!;
    const nextMs = p.next ? tsOf(p.next) : Infinity;
    const missType = pressRefusalMissType(p.u, p.id, p.ms, nextMs, ctx.legacy);
    const at = ((p.ms - ctx.start) / 1000).toFixed(3);
    const factId = `${p.u.name}:${Math.floor((p.ms - ctx.start) / 1000)}:${name}`;
    if (!marker) {
      ctx.bump("refusedPressUnmarked");
      if (missType !== undefined)
        ctx.violate(
          "refusedPressUnmarked",
          `refused ${missType}`,
          p.ms,
          factId,
          `${p.u.name}: ${name} at ${at}s refused (${missType}) but printed with no marker`,
          where.slice(0, 220),
        );
      return;
    }
    ctx.bump("refusedPressMarker");
    const m = REFUSED_PRESS_MARKER_RE.exec(marker)!;
    const dest = p.c.destUnitId;
    const missRow = ((p.u.missesOut ?? []) as any[]).find(
      (r) =>
        r.srcUnitId === p.u.id &&
        r.missType === m[1] &&
        r.missType !== "ABSORB" &&
        effectSpanIdsOfCast(p.id).has(String(r.spellId)) &&
        tsOf(r) >= p.ms &&
        tsOf(r) <= p.ms + 2_000 &&
        (!dest || dest === "0000000000000000" || r.destUnitId === dest),
    );
    const cd = refusedPressCooldownState(
      p.u,
      ctx.legacy as never,
      p.id,
      (p.ms - ctx.start) / 1000,
      failed,
    );
    const kind =
      missType === undefined
        ? "press not refused"
        : missType !== m[1]
          ? `miss type ${missType} printed ${m[1]}`
          : !missRow
            ? "no miss row on the target"
            : cd !== m[2]
              ? `cooldown ${cd ?? "undecided"} printed ${m[2] ?? "none"}`
              : undefined;
    if (m[2] === "not spent") notSpent.push(p);
    if (kind)
      ctx.violate(
        "refusedPressMarker",
        kind,
        p.ms,
        factId,
        `${p.u.name}: ${name} at ${at}s printed ${marker}; producer: ${missType ?? "not refused"}, cooldown ${cd ?? "undecided"}`,
        where.slice(0, 220),
      );
  };
  for (const r of rows) {
    for (const e of (factOf(r.facts, "pressedAfter") ?? "").matchAll(
      PRESSED_AFTER,
    )) {
      const name = e[1]!;
      const d = +e[2]!;
      const holders = r.holders.get(name);
      // the press: its second minus the printed delay is the lock's end,
      // which floors to `endS`
      const c = pressesOf(name, holders ?? side).filter((p) => {
        const to = (p.ms - ctx.start) / 1000 - d;
        return to >= r.endS - 0.05 && to < r.endS + 1.05;
      });
      check(name, c, e[3]?.trim(), r.row[0]);
    }
    for (const e of (factOf(r.facts, "priorPress") ?? "").matchAll(
      PRIOR_PRESS,
    )) {
      const name = e[1]!;
      const s = +e[2]!;
      const c = pressesOf(name, side).filter(
        (p) => Math.floor((p.ms - ctx.start) / 1000) === s,
      );
      check(name, c, e[3], r.row[0]);
    }
  }
  // a later lock that leaves X out of readyCds where the producer's own
  // readiness (`syncWindowCdFor` + `evaluateSyncWindow`: the ledger, which
  // still counts the refused press — GH #158 — and the holder's feasibility
  // gates) lists it only with the refused press dropped (codex T29-1i #5,
  // T29-1j #2)
  if (!notSpent.length) return;
  const enemies = ctx.players.filter((u) => u.reaction !== ctx.owner.reaction);
  const units: any[] = Object.values(ctx.legacy.units ?? {});
  const enemyIds = new Set<string>(enemies.map((u) => u.id));
  const enemyAndPetIds = new Set<string>([
    ...enemyIds,
    ...units
      .filter((u) => u.ownerId && enemyIds.has(u.ownerId))
      .map((u) => u.id as string),
  ]);
  let windows: any[] = [];
  try {
    windows = mergeHealerCcWindows(
      enemyHealerCcWindows(side, enemies, ctx.legacy),
    );
  } catch {
    windows = [];
  }
  for (const p of notSpent) {
    ctx.bump("refusedNotSpentReadiness");
    const name = nameOf(p.id, p.c.spellName);
    const pS = (p.ms - ctx.start) / 1000;
    const entry = unitCooldownEntry(p.u, ctx.legacy as never, p.id);
    const self = entry?.casts.find((c) => Math.abs(c.timeSeconds - pS) < 0.05);
    if (!entry || !self) continue;
    const syncCd = (casts: typeof entry.casts) =>
      syncWindowCdFor(
        { ...entry, casts, ownerName: p.u.name },
        p.u,
        enemies,
        enemyAndPetIds,
        ctx.start,
        units,
        ctx.legacy,
        failed,
      );
    const counted = syncCd(entry.casts);
    const dropped = syncCd(entry.casts.filter((c) => c !== self));
    for (const r of rows) {
      if (r.fromS <= pS) continue;
      if ((r.holders.get(name) ?? []).includes(p.u)) continue;
      const w = windows.find((x) => toRenderSecond(x.fromSeconds) === r.fromS);
      if (!w) continue;
      if (
        evaluateSyncWindow(w, [counted]).ready.length ||
        !evaluateSyncWindow(w, [dropped]).ready.length
      )
        continue;
      ctx.violate(
        "refusedNotSpentReadiness",
        "ready only with the refused press dropped",
        ctx.start + r.fromS * 1000,
        `${p.u.name}:${Math.floor(pS)}:${name}`,
        `${name} refused at ${pS.toFixed(3)}s (cooldown not spent); the ${r.fromS}s lock's readyCds omit it, ready there with the press dropped`,
        r.row[0].slice(0, 220),
      );
      break;
    }
  }
}
