/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * fact9 (F24) class 6 — roster / kit:
 *  - rosterClassMismatch (D23): a spell a player of class X cast that the
 *    class rosters (`classMetadata`) list only under other classes —
 *    Snowdrift 389794 sat in the Death Knight roster, every caster a Frost
 *    Mage;
 *  - variantPressDropped (D27): an enemy press of a talent's same-name,
 *    same-cooldown replacement of an offensive cooldown (Concentrated
 *    Coolness: Frozen Orb 198149 for 84714) with no `[ENEMY CD]` line of it,
 *    or the caster's kit without it;
 *  - triggeredControlOnCooldown (D22): a talent-triggered control (Absolute
 *    Zero 377048 off Frostwyrm's Fury 279302) listed in `[HEALER EXPOSURE]`
 *    while its button was on its cooldown. The pairs are the check's own,
 *    not the product table.
 */
import { classMetadata } from "@gladlog/analysis/src/data/classSpells";
import { spellEffectData } from "@gladlog/analysis/src/data/spellEffectData";
import talentModifiers from "@gladlog/analysis/src/data/talentModifiers.json";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";

import { APPLIED, type IRoundCtx, nameOf, secOf, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "rosterClassMismatch",
  "variantPressDropped",
  "triggeredControlOnCooldown",
] as const;

// ---------------------------------------------------------------- D23
const classesOfSpell = new Map<string, Set<string>>();
for (const c of classMetadata)
  for (const a of c.abilities) {
    const id = String(a.spellId);
    if (!classesOfSpell.has(id)) classesOfSpell.set(id, new Set());
    classesOfSpell.get(id)!.add(String(c.unitClass));
  }

/** Dark Simulacrum's buff on the Death Knight: the copied spell is cast as
 * itself, by a Death Knight (45dda1d9 r1 1:25: Fear 2.9 s after the buff) */
const DARK_SIMULACRUM_BUFF = "77616";
const SIMULACRUM_S = 12;

function rosterClass(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  for (const p of ctx.players) {
    const seen = new Set<string>();
    const copied = ((p.auraEvents ?? []) as any[])
      .filter(
        (a) =>
          a.logLine?.event === APPLIED &&
          String(a.spellId) === DARK_SIMULACRUM_BUFF &&
          a.destUnitId === p.id,
      )
      .map(tsOf);
    for (const c of successesOf(p)) {
      const id = String(c.spellId);
      if (seen.has(id)) continue;
      const t = tsOf(c);
      if (copied.some((b) => b <= t && t - b <= SIMULACRUM_S * 1000)) continue;
      seen.add(id);
      const classes = classesOfSpell.get(id);
      if (!classes) continue;
      ctx.bump("rosterClassMismatch");
      if (classes.has(String(p.class))) continue;
      ctx.violate(
        "rosterClassMismatch",
        "cast",
        tsOf(c),
        `${id}#${p.class}`,
        `${nameOf(id, c.spellName)} ${id} cast by class ${p.class}; rosters list it under ${[...classes].join(", ")}`,
      );
    }
  }
}

// ---------------------------------------------------------------- D27
/** replacement id → the offensive cooldown it replaces: a talent's
 * replace_spell row whose replacement keeps the name and the cooldown */
const VARIANT_OF = new Map<string, string>();
for (const [key, mods] of Object.entries(
  talentModifiers as Record<string, any[]>,
)) {
  if (!OFFENSIVE_CD_SPELL_IDS.has(key)) continue;
  for (const m of mods) {
    if (m.effect !== "replace_spell" || m.conditional) continue;
    const v = String(m.value);
    if (v === key || OFFENSIVE_CD_SPELL_IDS.has(v)) continue;
    const a = spellEffectData[key];
    const b = spellEffectData[v];
    if (!a?.cooldownSeconds || a.cooldownSeconds !== b?.cooldownSeconds)
      continue;
    if (nameOf(key) !== nameOf(v)) continue;
    VARIANT_OF.set(v, key);
  }
}

const ENEMY_CD = /^(\d+:\d{2}) {2}\[ENEMY CD\] {3}(\d+)\([^)]*\) \([^)]*\): (.+)$/;

function kitOf(ctx: IRoundCtx, pid: string): string | undefined {
  const at = ctx.text.indexOf(`<unit id="${pid}" `);
  if (at < 0) return undefined;
  const end = ctx.text.indexOf("</unit>", at);
  return ctx.text.slice(at, end < 0 ? undefined : end);
}

function variantPresses(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  for (const u of ctx.players) {
    if (u.reaction === owner.reaction) continue;
    const pid = ctx.pidOf(u.name);
    if (!pid) continue;
    let kitChecked = false;
    for (const c of successesOf(u)) {
      const key = VARIANT_OF.get(String(c.spellId));
      if (!key) continue;
      const t = tsOf(c);
      if (t < ctx.start || t > ctx.roundEndAt) continue;
      const name = nameOf(key);
      const sec = Math.floor((t - ctx.start) / 1000);
      ctx.bump("variantPressDropped");
      const printed = ctx.lines.some((l) => {
        const m = ENEMY_CD.exec(l);
        return (
          !!m &&
          m[2] === pid &&
          Math.abs(secOf(m[1]!) - sec) <= 1 &&
          m[3]!.includes(name)
        );
      });
      if (!printed)
        ctx.violate(
          "variantPressDropped",
          "enemyCd",
          t,
          `${pid}#${sec}#${c.spellId}`,
          `${name} ${c.spellId} pressed by ${pid}; no [ENEMY CD] line of it`,
        );
      if (kitChecked) continue;
      kitChecked = true;
      const kit = kitOf(ctx, pid);
      if (kit !== undefined && !kit.includes(`${name} [`))
        ctx.violate(
          "variantPressDropped",
          "kit",
          t,
          `${pid}#kit#${c.spellId}`,
          `${name} ${c.spellId} pressed by ${pid}; not in the unit's kit`,
          kit.slice(0, 300),
        );
    }
  }
}

// ---------------------------------------------------------------- D22
/** control → the buttons whose press triggers it */
const TRIGGERED: Record<string, string[]> = {
  "377048": ["279302"], // Absolute Zero ← Frostwyrm's Fury
  "372245": ["433874", "357210", "403631"], // Terror of the Skies ← Deep Breath / Breath of Eons
};
const LANDING_S = 5;

function triggeredControls(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const enemies = ctx.players.filter((u) => u.reaction !== owner.reaction);
  for (const [control, buttons] of Object.entries(TRIGGERED)) {
    const name = nameOf(control);
    // listed as a threat (`Absolute Zero Full DR`), not the control the
    // healer is already in (`healer already in Absolute Zero until 0:10`)
    const listed = new RegExp(
      `${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (?:Full|\\d+%) DR`,
    );
    const lines = ctx.lines.filter(
      (l) => l.includes("[HEALER EXPOSURE]") && listed.test(l),
    );
    if (lines.length === 0) continue;
    const cdMs = Math.max(
      ...buttons.map((b) => (spellEffectData[b]?.cooldownSeconds ?? 0) * 1000),
    );
    if (cdMs <= 0) continue;
    // each holder's activations: button presses, and control landings with
    // no press before them (a press the log lost)
    const holders = enemies
      .map((u) => {
        const presses = successesOf(u)
          .filter((c) => buttons.includes(String(c.spellId)))
          .map(tsOf);
        const landings = ctx.units
          .flatMap((t) => (t.auraEvents ?? []) as any[])
          .filter(
            (a) =>
              a.logLine?.event === APPLIED &&
              String(a.spellId) === control &&
              a.srcUnitId === u.id,
          )
          .map(tsOf);
        const acts = [
          ...presses,
          ...landings.filter(
            (l) => !presses.some((p) => p <= l && l - p <= LANDING_S * 1000),
          ),
        ].sort((a, b) => a - b);
        return { u, acts };
      })
      .filter((h) => h.acts.length > 0);
    if (holders.length === 0) continue;
    for (const line of lines) {
      const m = /^(\d+:\d{2}) /.exec(line);
      if (!m) continue;
      const at = ctx.start + secOf(m[1]!) * 1000;
      ctx.bump("triggeredControlOnCooldown");
      // the line's instant is somewhere in its floored second: only an
      // activation before the second began certainly preceded it
      const onCd = holders.every((h) => {
        const last = h.acts.filter((a) => a <= at).pop();
        return last !== undefined && at - last < cdMs - 1000;
      });
      if (!onCd) continue;
      const gaps = holders
        .map((h) => {
          const last = h.acts.filter((a) => a <= at).pop()!;
          return `${((at - last) / 1000).toFixed(1)} s`;
        })
        .join(", ");
      ctx.violate(
        "triggeredControlOnCooldown",
        "healerExposure",
        at,
        `${m[1]}#${control}`,
        `${name} listed ${gaps} after its button (cooldown ${cdMs / 1000} s)`,
        line.slice(0, 300),
      );
    }
  }
}

export function run(ctx: IRoundCtx): void {
  rosterClass(ctx);
  variantPresses(ctx);
  triggeredControls(ctx);
}
