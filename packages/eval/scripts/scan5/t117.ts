/**
 * scan5/t117.ts — ticket T117 (fact12 retest M2, 1d26a991 1:16): a
 * `[REJECTED] your X ×N — why` line counts every press of X refused for
 * that reason in its run. Truth is the owner's SPELL_CAST_FAILED rows.
 *
 *  - `rejectRunUndercount`: X's runs rebuilt from its rows, every reason
 *    walked together. A refusal of the open run's reason within
 *    `REJECT_RUN_GAP_S` of its last counts; one for another reason (another
 *    kind, or a reason outside the kinds such as Mortal Coil's "horrified"
 *    between six "out of range" presses) is stepped over when X's next row
 *    that is not the global cooldown / an action in progress resumes the
 *    run in its gap, and it is no "not ready" refusal (the spell itself on
 *    cooldown); otherwise the run ends there and another kind starts its
 *    own. A run is printed from `REJECT_RUN_MIN` presses or when it touches
 *    the `REJECT_NEAR_DEATH_S` before a teammate's death; a line takes an
 *    unused printed run of its reason starting in its second — the one of
 *    its count, else the smallest (runs starting together print in flush
 *    order).
 *    Violation: the run holds more presses than the line's ×N. Counted:
 *    every [REJECTED] line matched to a run.
 *  - `rejectRunPastRoundEnd` (batch review 80-PIPE-90-B80): a line whose ×N
 *    no run of the round's own presses (rows before `roundEndAt`) reaches,
 *    while the run built with the presses at or after the round's end
 *    does. Counted: every [REJECTED] line.
 */
import { NOT_READY_REASONS } from "@gladlog/analysis/src/analysis/candidates/shared";
import {
  OTHER_REFUSAL_REASONS,
  REJECT_NEAR_DEATH_S,
  REJECT_RUN_GAP_S,
  REJECT_RUN_MIN,
  rejectKindOf,
  rejectWhyOf,
} from "@gladlog/analysis/src/context/spellOutcomeLines";
import { withVisionObscuredCauses } from "@gladlog/analysis/src/utils/visionObscured";

import { type IRoundCtx, nameOf, secOf } from "./ctx";

export const CHECKS = ["rejectRunUndercount", "rejectRunPastRoundEnd"] as const;

const LINE =
  /^\s*(\d+:\d{2})\s+\[REJECTED\]\s+your (.+?) ×(\d+) — (.+?)(?: \(\d+:\d{2}–\d+:\d{2}\))?$/;
/** the global cooldown's and an action in progress: refused before range,
 * sight or movement were read */
const TRANSPARENT = new Set<string>([
  ...(OTHER_REFUSAL_REASONS["another action in progress"] ?? []),
  ...(OTHER_REFUSAL_REASONS["can't do that yet"] ?? []),
]);

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  // the producer's rows: a vision-obscured refusal carries its cause, which
  // is part of its kind (pipeline T108 — a Burrow's refusals and a Smoke
  // Bomb's are two runs)
  const roundEndS = (ctx.roundEndAt - ctx.start) / 1000;
  const owned = (
    withVisionObscuredCauses(ctx.rawStreams(), ctx.legacy)?.castFailed ?? []
  )
    .filter((f) => f.unitGuid === ctx.owner.id)
    .sort((a, b) => a.tSeconds - b.tSeconds);
  // the round's own presses, as the producer cuts them (`roundEndMs`)
  const inRound = owned.filter((f) => f.tSeconds < roundEndS);
  // B15b: a run touching the REJECT_NEAR_DEATH_S before a teammate's death
  // is printed from one press
  const deaths = ctx.players
    .filter((u) => u.id !== ctx.owner.id && u.reaction === ctx.owner.reaction)
    .flatMap((u) => (u.deathRecords ?? []) as Array<{ timestamp: number }>)
    .map((d) => (d.timestamp - ctx.start) / 1000);
  /** the printed runs of `spell`, every reason walked together (codex
   * 85-tk-L-T117-1b #2: a refusal stepped over inside another kind's run
   * starts no run of its own; #3: an unprinted run takes no line) */
  const runsOf = new Map<
    string,
    Array<{ sec: number; from: number; count: number; why: string }>
  >();
  // per spell id, as the product keys them (codex 85-tk-L-T117-1c: two ids
  // of one name are two runs), then joined under the name a line prints
  const build = (spell: string, failed = inRound) =>
    [
      ...new Set(
        failed
          .filter((f) => nameOf(String(f.spellId), f.spellName) === spell)
          .map((f) => String(f.spellId)),
      ),
    ]
      .flatMap((id) => buildId(id, failed))
      .sort((a, b) => a.from - b.from);
  const buildId = (id: string, failed: typeof owned) => {
    const rows = failed.filter(
      (f) => String(f.spellId) === id && !TRANSPARENT.has(f.reason),
    );
    const out: Array<{
      sec: number;
      from: number;
      count: number;
      why: string;
    }> = [];
    let cur:
      | {
          kind: NonNullable<ReturnType<typeof rejectKindOf>>;
          by: string | undefined;
          from: number;
          last: number;
          count: number;
        }
      | undefined;
    const byOf = (k: string, f: (typeof rows)[number]) =>
      k === "vision obscured" ? f.obscuredBy : undefined;
    const end = () => {
      if (
        cur &&
        (cur.count >= REJECT_RUN_MIN ||
          deaths.some(
            (d) => cur!.from <= d && cur!.last >= d - REJECT_NEAR_DEATH_S,
          ))
      )
        out.push({
          sec: Math.floor(cur.from),
          // the product's order: by its exact start (codex 85-tk-L-T117-1d)
          from: cur.from,
          count: cur.count,
          why: rejectWhyOf(cur.kind, cur.by),
        });
      cur = undefined;
    };
    /** the next row resumes the open run in its gap */
    const resumes = (j: number) => {
      const next = rows[j + 1];
      return (
        !!cur &&
        !!next &&
        rejectKindOf(next.reason) === cur.kind &&
        byOf(cur.kind, next) === cur.by &&
        next.tSeconds - cur.last <= REJECT_RUN_GAP_S
      );
    };
    rows.forEach((f, j) => {
      const k = rejectKindOf(f.reason);
      if (k === undefined) {
        // the spell itself not ready ends the run (batch 13)
        if (NOT_READY_REASONS.has(f.reason) || !resumes(j)) end();
        return;
      }
      const by = byOf(k, f);
      const same = !!cur && cur.kind === k && cur.by === by;
      if (cur && same && f.tSeconds - cur.last <= REJECT_RUN_GAP_S) {
        cur.count++;
        cur.last = f.tSeconds;
        return;
      }
      if (cur && !same && resumes(j)) return;
      end();
      cur = { kind: k, by, from: f.tSeconds, last: f.tSeconds, count: 1 };
    });
    end();
    return out;
  };
  for (const l of ctx.lines) {
    const m = LINE.exec(l);
    if (!m) continue;
    const sec = secOf(m[1]!);
    const spell = m[2]!;
    const n = Number(m[3]);
    const why = m[4]!;
    let runs = runsOf.get(spell);
    if (!runs) runsOf.set(spell, (runs = build(spell)));
    // the line's run among those of its reason in its second: the one of
    // its count when there is one, else the smallest — the product's order
    // among runs starting together is its flush order, which the line does
    // not show (codex 85-tk-L-T117-1e)
    const same = runs
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.sec === sec && r.why === why);
    // batch review 80-PIPE-90-B80: a line whose ×N is reached only with the
    // presses made at or after the round's end — the run built without the
    // cut holds N, the round's own run holds fewer or is not printed
    ctx.bump("rejectRunPastRoundEnd");
    if (!same.some(({ r }) => r.count >= n)) {
      const uncut = build(spell, owned).filter(
        (r) => r.sec === sec && r.why === why && r.count >= n,
      );
      if (uncut.length > 0)
        ctx.violate(
          "rejectRunPastRoundEnd",
          why,
          ctx.start + sec * 1000,
          `${spell}:${m[1]}`,
          `${spell} ×${n} at ${m[1]} counts presses at or after the round's end (${roundEndS.toFixed(1)}s); the round's own run holds ${same[0]?.r.count ?? 0}`,
          l.trim(),
        );
    }
    if (same.length === 0) continue;
    const pick =
      same.find(({ r }) => r.count === n) ??
      same.reduce((a, b) => (b.r.count < a.r.count ? b : a));
    const at = pick.i;
    const run = runs.splice(at, 1)[0]!;
    ctx.bump("rejectRunUndercount");
    if (run.count <= n) continue;
    ctx.violate(
      "rejectRunUndercount",
      why,
      ctx.start + sec * 1000,
      `${spell}:${m[1]}`,
      `${spell} refused "${why}" ${run.count} times in the run from ${m[1]}; the line says ×${n}`,
      l.trim(),
    );
  }
}
