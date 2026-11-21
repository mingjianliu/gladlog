/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects */
/**
 * scan5/t163.ts — pipeline T163 (GH #173 item 46), count first: a kill
 * window's `defenseless` span is cut on an external at the pair its
 * `[ENEMY DEF]` line prints — the rendered second plus the printed length
 * (`renderedExternalSpanS`: floor(start) + length). The aura's logged end
 * (the paired interval's `auraToS`) is later by the start's fraction and by
 * the press-to-aura lag: 8888b780 `defenseless 1:36`, Time
 * Dilation up to 1:37.09.
 *
 * `externalSpanEndsEarly` — per owner context, per external the product
 * lists on an enemy (`enemyDefensiveEvents`, kind `external`, with an
 * observed length that prints above 0.0 s). The aura's end is read from the
 * RAW aura rows of the recipient — the APPLIED / REFRESH of the press's aura
 * nearest the event, and the first REMOVED after it — not from the event's
 * own fields: the product's cut is the later of the printed sum and the
 * event's paired end, so a check on those fields can never fail (codex
 * 85-tk-WIN-T163-1 #2). Kinds:
 *  - `a defenseless window opens before the aura's logged end` — a window of
 *    the product's own `computeOffensiveWindows` on the recipient starts at
 *    or after the event and more than `MIN_EARLY_S` before the raw end;
 *  - `cut in an earlier rendered second, no window opens there` — out of the
 *    total: floor(cut) < floor(raw end);
 *  - `no REMOVED row for the aura` — out of the total: nothing to read.
 *
 * `killWindowReadyGrid` — assembly review 80-PIPE-186-B170: a start moved
 * inside a second is still printed as that second, so what the line calls
 * ready is the printed second's. Per `[KILL WINDOW]` / `[VULNERABLE]` line
 * of the owner's context, the printed ready list (`your CC ready: X, Y`,
 * the single-control `CC ready` under the block's `Your CC: X.` header, or
 * `your CC on cooldown` = none) against the producer's own controls
 * (`ownerCcSpellsOf`) ready at the printed first second (`isCCReadyAt`).
 * Kinds: `printed ready, not ready at the printed second`; `ready at the
 * printed second, not printed`; out of the total: `owner dies in the
 * printed second` (the producer reads death at the raw start).
 */
import { castsOfEffectAura } from "@gladlog/analysis/src/data/castEffectAuras";
import { ENEMY_IMMUNITY_EXTERNAL_CASTS } from "@gladlog/analysis/src/data/spellIdLists";
import {
  enemyDefensiveEvents,
  isBelowWallFloorExternal,
  renderedExternalSpanS,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import {
  isCCReadyAt,
  ownerCcSpellsOf,
} from "@gladlog/analysis/src/utils/healerOffenseAnalysis";
import { computeOffensiveWindows } from "@gladlog/analysis/src/utils/offensiveWindows";
import { firstDeathMs } from "@gladlog/analysis/src/utils/unitDeath";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  secOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["externalSpanEndsEarly", "killWindowReadyGrid"] as const;
const C = "externalSpanEndsEarly";
const R = "killWindowReadyGrid";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `${C}|cut in an earlier rendered second, no window opens there`,
  `${C}|no REMOVED row for the aura`,
  `${R}|owner dies in the printed second`,
]);

/** the owner's ready clause of a kill-window line: `your CC ready: …`, the
 * single-control `CC ready (…)`, or `your CC on cooldown` with or without
 * T167's ` (back inside: X m:ss、…)` (batch review 80-PIPE-202-B184 #1: the
 * clause made every such line skip this check) */
export const READY_LINE_RE =
  /^\s+\[(?:KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–\d+:\d\d.*?; (your CC ready: [^;]*|CC ready(?: \(enemy healer DR: [^)]*\))?|your CC on cooldown)(?: \(back inside: [^)]*\))?[;.]/;

function readyGrid(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  let spells: ReturnType<typeof ownerCcSpellsOf> | undefined;
  let single: string | undefined;
  const start = (ctx.legacy as any).startTime as number;
  const deadFrom = (firstDeathMs(owner as any) - start) / 1000;
  for (const l of ctx.lines) {
    const yc = /^\s*Your CC: (.+)\.$/.exec(l);
    if (yc) single = yc[1]!;
    const m = READY_LINE_RE.exec(l);
    if (!m) continue;
    const a = secOf(m[1]!);
    const clause = m[2]!;
    let printed: string[];
    if (clause.startsWith("your CC ready: "))
      printed = clause
        .slice("your CC ready: ".length)
        .split(", ")
        .map((x) => x.replace(/ \(enemy healer DR: [^)]*\)$/, "").trim());
    else if (clause.startsWith("CC ready")) {
      if (!single) continue;
      printed = [single];
    } else printed = [];
    ctx.bump(R);
    if (deadFrom < a + 1) {
      if (deadFrom >= a)
        ctx.violate(
          R,
          "owner dies in the printed second",
          start + a * 1000,
          `${owner.id}|${m[1]}`,
          `window ${m[1]}`,
          l.trim().slice(0, 160),
        );
      continue;
    }
    spells ??= ownerCcSpellsOf(ctx.legacy as any, owner as any);
    const want = spells
      .filter((s) => isCCReadyAt(s, a))
      .map((s) => s.spellName);
    const extra = printed.filter((n) => !want.includes(n));
    const missing = want.filter((n) => !printed.includes(n));
    if (extra.length > 0)
      ctx.violate(
        R,
        "printed ready, not ready at the printed second",
        start + a * 1000,
        `${owner.id}|${m[1]}|+${extra.join(",")}`,
        `window ${m[1]} prints ready ${extra.join(", ")}; at ${m[1]} the producer's readiness gives ${want.join(", ") || "none"}`,
        l.trim().slice(0, 160),
      );
    if (missing.length > 0)
      ctx.violate(
        R,
        "ready at the printed second, not printed",
        start + a * 1000,
        `${owner.id}|${m[1]}|-${missing.join(",")}`,
        `window ${m[1]} does not print ${missing.join(", ")} ready; the producer's readiness at ${m[1]} gives ${want.join(", ")}`,
        l.trim().slice(0, 160),
      );
  }
}

const MIN_EARLY_S = 0.05;

export function run(ctx: IRoundCtx): void {
  readyGrid(ctx);
  const owner = ctx.owner;
  if (!owner) return;
  const friends = (ctx.players as any[]).filter(
    (p) => p.reaction === owner.reaction,
  );
  const enemies = (ctx.players as any[]).filter(
    (p) => p.reaction !== owner.reaction,
  );
  const combat = { ...ctx.legacy, startTime: ctx.start, endTime: ctx.end };
  let windows: ReturnType<typeof computeOffensiveWindows> | undefined;
  for (const caster of enemies)
    for (const d of enemyDefensiveEvents(
      caster as never,
      enemies as never,
      combat as never,
    ) as any[]) {
      if (d.kind !== "external" || d.observedSeconds === undefined) continue;
      // the product's own eligibility: an ally copy below the wall floor
      // cuts no window (codex 85-tk-WIN-T163-2 #2)
      if (isBelowWallFloorExternal(d)) continue;
      const shown = renderedExternalSpanS(d);
      if (!shown) continue;
      ctx.bump(C);
      const key = `${owner.name}#${d.recipientId}#${d.spellId}#${Math.round(d.atSeconds * 1000)}`;
      const recipient = (ctx.units as any[]).find(
        (u) => u.id === d.recipientId,
      );
      const immunityAura = (
        ENEMY_IMMUNITY_EXTERNAL_CASTS as Record<string, string | undefined>
      )[d.spellId];
      const isPressAura = (id: string) =>
        id === d.spellId ||
        id === immunityAura ||
        castsOfEffectAura(id).includes(d.spellId);
      const fromCaster = (a: any) =>
        a.srcUnitId === d.casterId ||
        (ctx.units as any[]).find((u) => u.id === a.srcUnitId)?.ownerId ===
          d.casterId;
      const rows = ((recipient?.auraEvents ?? []) as any[]).filter(
        (a) => isPressAura(String(a.spellId)) && fromCaster(a),
      );
      const atMs = ctx.start + d.atSeconds * 1000;
      const on = rows
        .filter(
          (a) =>
            (ev(a) === APPLIED || ev(a) === REFRESH) &&
            tsOf(a) >= atMs - 500 &&
            tsOf(a) <= atMs + 2500,
        )
        .sort((x, y) => Math.abs(tsOf(x) - atMs) - Math.abs(tsOf(y) - atMs))[0];
      const off = on
        ? rows.find((a) => ev(a) === REMOVED && tsOf(a) > tsOf(on))
        : undefined;
      if (!off) {
        ctx.violate(C, "no REMOVED row for the aura", atMs, key, "");
        continue;
      }
      const loggedEnd = (tsOf(off) - ctx.start) / 1000;
      if (!(loggedEnd - d.atSeconds > MIN_EARLY_S)) continue;
      windows ??= computeOffensiveWindows(
        enemies as never,
        friends as never,
        combat as never,
      );
      const opened = windows.find(
        (w) =>
          w.targetUnitId === d.recipientId &&
          w.fromSeconds >= d.atSeconds &&
          w.fromSeconds < loggedEnd - MIN_EARLY_S,
      );
      const detail = `${nameOf(d.spellId, d.spellName)} ${d.spellId} on ${(ctx.units as any[]).find((u) => u.id === d.recipientId)?.name ?? d.recipientId}: line at ${d.atSeconds.toFixed(2)} s, aura to ${loggedEnd.toFixed(2)} s, cut at ${shown.to.toFixed(2)} s (${fmtS(d.atSeconds)} + ${(shown.to - shown.from).toFixed(1)} s)`;
      if (opened)
        ctx.violate(
          C,
          "a defenseless window opens before the aura's logged end",
          ctx.start + d.atSeconds * 1000,
          key,
          `${detail}; window ${opened.fromSeconds.toFixed(2)}–${opened.toSeconds.toFixed(2)} s prints ${fmtS(opened.fromSeconds)}–${fmtS(opened.toSeconds)}`,
        );
      else if (Math.floor(shown.to) < Math.floor(loggedEnd))
        ctx.violate(
          C,
          "cut in an earlier rendered second, no window opens there",
          ctx.start + d.atSeconds * 1000,
          key,
          detail,
        );
    }
}
