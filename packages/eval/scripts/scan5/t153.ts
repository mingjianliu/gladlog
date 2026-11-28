/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/t153.ts — ticket T153 (fact14 D3, r13 P7; user ruling A16,
 * 2026-11-18): an offensive-roster cooldown that is a healer's throughput
 * major in that healer's hands — the producer's own predicate,
 * `isHealerHeldOffensive`: a Holy Paladin's Avenging Wrath, any healer's
 * offensive racial window — is no offensive cooldown of either side.
 *
 *  - `healerHeldAsEnemyBurst`, from the enemy healers' own press rows.
 *    Counted: every such press. Kinds, each `<kind>:<spell>`:
 *      `enemyCdLine` — an `[ENEMY CD]` line of the press second names it
 *        for that spec;
 *      `burstOpener` — a `[BURST ANSWERED]` line of the press second says
 *        `enemy opened <spell>`;
 *      `resEnemy` — a `[RES]` line names it as `enemy:…<spell>/<Spec>(`.
 *  - `healerHeldFriendlyTag`, from the printed line. Counted: every
 *    `[ENEMY DEF]` / `[CC ON ENEMY]` line that carries
 *    `[friendly offensive CD active]`. A violation: the product's own tag
 *    predicate (`friendlyOffensiveCdActiveAt`) is false at every tenth of
 *    the printed second and at its last millisecond. Kind `healerHeld`:
 *    a friendly healer's own healer-held aura is up inside the second;
 *    `other`: none is (not this ticket's class).
 */
import { isHealerHeldOffensive } from "@gladlog/analysis/src/data/healerHeldOffensive";
import { offensiveReadBounds } from "@gladlog/analysis/src/utils/auraSurelyUp";
import {
  friendlyOffensiveCdActiveAt,
  hasOffensiveSpellActive,
  isEnemyCdWindowSpell,
  specToString,
} from "@gladlog/analysis/src/utils/cooldowns";
import { ENEMY_DEF_TAG_RE_SRC } from "@gladlog/analysis/src/utils/enemyDefensives";

import { fmtS, type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "healerHeldAsEnemyBurst",
  "healerHeldFriendlyTag",
] as const;

const TAG = "[friendly offensive CD active]";
const TAGGED_LINE = new RegExp(
  String.raw`^\s*(\d+):(\d\d)\s+(?:${ENEMY_DEF_TAG_RE_SRC}|\[CC ON ENEMY\])`,
);
const SECOND_SAMPLES = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 999];

export function run(ctx: IRoundCtx): void {
  const friends = ctx.players.filter(
    (u: any) => u.reaction === ctx.owner?.reaction,
  );
  const enemies = ctx.players.filter((u: any) => !friends.includes(u));

  for (const e of enemies) {
    const spec = specToString(e.spec);
    for (const c of successesOf(e)) {
      const id = String(c.spellId);
      if (
        !isEnemyCdWindowSpell(id, e.spec) ||
        !isHealerHeldOffensive(id, e.spec)
      )
        continue;
      const at = tsOf(c);
      if (at < ctx.start || at >= ctx.roundEndAt) continue;
      ctx.bump("healerHeldAsEnemyBurst");
      const name = nameOf(c.spellId, c.spellName);
      const second = fmtS((at - ctx.start) / 1000);
      const atSecond = ctx.lines.filter((l) => l.startsWith(`${second} `));
      const cdLine = atSecond.find(
        (l) => l.includes("[ENEMY CD]") && l.includes(`(${spec}): ${name}`),
      );
      if (cdLine)
        ctx.violate(
          "healerHeldAsEnemyBurst",
          `enemyCdLine:${name}`,
          at,
          `${e.name}:${second}`,
          `${spec} pressed ${name} at ${second}`,
          cdLine,
        );
      const opener = atSecond.find(
        (l) =>
          l.includes("[BURST ANSWERED]") && l.includes(`enemy opened ${name}`),
      );
      if (opener)
        ctx.violate(
          "healerHeldAsEnemyBurst",
          `burstOpener:${name}`,
          at,
          `${e.name}:${second}`,
          `${spec} pressed ${name} at ${second}`,
          opener,
        );
      // the `enemy:` field of a `[RES]` line (fields are two spaces apart)
      const res = ctx.lines.find((l) => {
        const i = l.includes("[RES]") ? l.indexOf("enemy:") : -1;
        return (
          i >= 0 && l.slice(i).split("  ")[0]!.includes(`${name}/${spec}(`)
        );
      });
      if (res)
        ctx.violate(
          "healerHeldAsEnemyBurst",
          `resEnemy:${name}`,
          at,
          `${e.name}:${second}`,
          `${spec} pressed ${name} at ${second}`,
          res,
        );
    }
  }

  const side = new Set<string>(friends.map((u: any) => u.id));
  // the bounds the timeline passes the tag (`offensiveReadBounds`, T308;
  // codex 85-tk-L5-T308-1f #4)
  const round = offensiveReadBounds(
    ctx.start,
    ctx.end,
    [...friends, ...enemies],
    (ctx.legacy as any)?.startInfo?.bracket,
  );

  for (const line of ctx.lines) {
    if (!line.includes(TAG)) continue;
    const m = TAGGED_LINE.exec(line);
    if (!m) continue;
    ctx.bump("healerHeldFriendlyTag");
    const lo = ctx.start + (+m[1]! * 60 + +m[2]!) * 1000;
    const at = SECOND_SAMPLES.map((d) => lo + d);
    if (
      at.some((ms) =>
        friendlyOffensiveCdActiveAt(friends, enemies, side, ms, round),
      )
    )
      continue;
    const held = friends.find((f: any) =>
      at.some((ms) =>
        hasOffensiveSpellActive(
          f,
          ms,
          side,
          (id) =>
            isEnemyCdWindowSpell(id, f.spec) &&
            isHealerHeldOffensive(id, f.spec),
          round,
        ),
      ),
    );
    ctx.violate(
      "healerHeldFriendlyTag",
      held ? "healerHeld" : "other",
      lo,
      line.trim(),
      held
        ? `only ${specToString(held.spec)}'s own throughput major is up`
        : "no friendly offensive cooldown up in the second",
      line,
    );
  }
}
