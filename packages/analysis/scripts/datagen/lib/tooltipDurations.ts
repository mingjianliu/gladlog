/**
 * Reading a talent's duration effect off its tooltip (GH #155, 2026-10-21).
 *
 * User correction 2026-10-21: "你们完全没有去读天赋" — the talent tooltips
 * state the base duration, what extends it, by how much and up to what cap.
 * Spiritwalker's Momentum 443425: 「使用带有施法时间的法术会使灵魂行者的恩赐和
 * 灵魂行者的神盾的持续时间延长${$s1/1000}秒，最多可延长${$s2/1000}秒。」 The DB2
 * rows behind such a talent are dummy auras with no class mask, so the
 * SpellMod compilers (`genTalentModifiers.ts`) never see them; the sentence
 * does. The same correction was made once before (2026-09-22, the
 * `BUFF_DURATION_TALENT_MODIFIERS` header) and closed only the label-encoded
 * half — this module reads the text itself.
 *
 * Three pure steps, each unit-tested on real tooltips:
 *  1. `expandForSpec` — resolve `$?COND[…]?COND[…][…]` chains for one spec
 *     (`evalCondition` from tooltipSpecGates.ts); a condition that cannot be
 *     decided marks the rendering `unknown`.
 *  2. `evalAmount` — a placeholder or `${…}` expression to a number:
 *     `$sN` / `$mN` (this spell's effect N), `$<id>sN` / `$<id>mN` (another
 *     spell's), `$d` / `$<id>d` (a duration, seconds), literals and
 *     + − × ÷ with parentheses. Anything else → undefined (never guessed).
 *  3. `parseDurationClauses` — each sentence that says a duration is extended:
 *     the targets (names before 「的持续时间」, split on 和 / 、 / 与 / 以及 /
 *     或, or `$@spellnameN`), the amount and its unit (秒 / %), a cap
 *     (「最多(可)延长 N 秒」, or 「最多可达基础持续时间的 N%」), and whether it
 *     is FIXED (the spell simply lasts longer) or PER-EVENT (a trigger — 每 /
 *     当…时 / 会使 / 施放 / 使用 / 消耗 / 击中 / 爆击 / 期间 — extends it each
 *     time). The trigger text is kept verbatim: what counts as an event is
 *     verified against the log, not decided here.
 */
import { evalCondition } from "./tooltipSpecGates";

/** The index of the `]` closing the `[` at `open`, or -1. */
function closeOf(text: string, open: number): number {
  let depth = 0;
  for (let k = open; k < text.length; k++) {
    if (text[k] === "[") depth++;
    else if (text[k] === "]") {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/**
 * The tooltip as one spec reads it: every `$?COND[a]?COND[b][c]` chain is
 * replaced by the body of the first branch whose condition is true for that
 * spec (else the final `[…]`, else nothing). `unknown` when a condition
 * before the chosen branch, or the chosen one, could not be decided.
 */
export function expandForSpec(
  text: string,
  specIndex: number,
  specId: string,
  specOfSpell: (spellId: string) => readonly string[] | undefined,
): { text: string; unknown: boolean } {
  let unknown = false;
  const walk = (s: string): string => {
    let out = "";
    let k = 0;
    while (k < s.length) {
      if (s.startsWith("$?", k)) {
        let p = k + 1;
        const conds: string[] = [];
        const bodies: string[] = [];
        let elseBody: string | undefined;
        for (;;) {
          if (s[p] === "?") {
            const open = s.indexOf("[", p);
            if (open < 0) break;
            const close = closeOf(s, open);
            if (close < 0) break;
            conds.push(s.slice(p + 1, open));
            bodies.push(s.slice(open + 1, close));
            p = close + 1;
          } else if (s[p] === "[" && conds.length) {
            const close = closeOf(s, p);
            if (close < 0) break;
            elseBody = s.slice(p + 1, close);
            p = close + 1;
            break;
          } else break;
        }
        if (!conds.length) {
          out += s.slice(k, k + 2);
          k += 2;
          continue;
        }
        let chosen: string | undefined;
        for (let j = 0; j < conds.length; j++) {
          const v = evalCondition(conds[j]!, specIndex, specId, specOfSpell);
          if (v === undefined) unknown = true;
          if (v === true) {
            chosen = bodies[j];
            break;
          }
        }
        if (chosen === undefined) chosen = elseBody ?? "";
        out += walk(chosen);
        k = p;
        continue;
      }
      out += s[k];
      k++;
    }
    return out;
  };
  return { text: walk(text), unknown };
}

/** What `evalAmount` reads placeholders from. */
export interface IAmountContext {
  /** the spell whose tooltip this is (`$sN` / `$mN` / `$d`) */
  spellId: string;
  /** effect points of spell `id`, effect index `n` (0-based), PvP-scaled */
  points: (id: string, n: number) => number | undefined;
  /** duration of spell `id` in seconds */
  durationS: (id: string) => number | undefined;
}

/**
 * A number from a tooltip amount token: a literal, a single placeholder, or a
 * `${…}` expression of placeholders, literals, + − * / and parentheses.
 * Undefined when any part cannot be resolved.
 */
export function evalAmount(
  token: string,
  ctx: IAmountContext,
): number | undefined {
  // `${…}.1` / `${…}.2`: the suffix is the display precision, not a digit
  let expr = token.trim().replace(/^(\$\{.*\})\.\d$/, "$1");
  if (expr.startsWith("${") && expr.endsWith("}")) expr = expr.slice(2, -1);
  let failed = false;
  // placeholders: $<id>?s|m<n>, $<id>?d
  expr = expr.replace(
    /\$(\d+)?([sSmM])(\d+)|\$(\d+)?d\b/g,
    (_m, id1, _k, n, id2) => {
      if (n !== undefined) {
        const v = ctx.points(id1 ?? ctx.spellId, Number(n) - 1);
        if (v === undefined) failed = true;
        return v === undefined ? "0" : `(${v})`;
      }
      const d = ctx.durationS(id2 ?? ctx.spellId);
      if (d === undefined) failed = true;
      return d === undefined ? "0" : `(${d})`;
    },
  );
  if (failed) return undefined;
  if (!/^[\d\s.+\-*/()]+$/.test(expr)) return undefined;
  try {
    const v = Function(`"use strict"; return (${expr});`)() as unknown;
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** One parsed "the duration of X is extended" sentence. */
export interface IDurationClause {
  /** target names as written (spell-name placeholders resolved to `#id`) */
  targets: string[];
  kind: "fixed" | "per-event" | "set";
  unit: "s" | "pct";
  amount: number;
  /** per-event: the most the extension can add, in `capUnit` */
  cap?: number;
  capUnit?: "s" | "pct-of-base";
  /** per-event: the words before the target — the trigger, verbatim */
  trigger?: string;
  /** the sentence, verbatim */
  sentence: string;
  /** the sentence names no target before 「持续时间」 (its subject is
   * implied, or a pronoun — 其 / 它 / 它们 — stands for it): `targets` is
   * empty and this is the text before the extension, for the caller to find
   * the spell name in (`subjectSpellIn`) */
  subjectText?: string;
}

/** A sentence the parser saw a duration extension in but could not read. */
export interface IUnparsedClause {
  sentence: string;
  reason: string;
}

// an amount: a ${…} expression (with an optional .N formatting suffix), a
// placeholder, or a literal
const AMOUNT = String.raw`(\$\{[^}]*\}(?:\.\d)?|\$\d*[sSmM]\d+|\$\d*d\b|\d+(?:\.\d+)?)`;
const EXTEND_RE = new RegExp(
  String.raw`(?:持续时间|它们的持续时间|其持续时间)(?:额外|就会|会|都会|也会)?(延长|增加|提高)(至)?\s*` +
    AMOUNT +
    String.raw`\s*(秒|%|分钟)?`,
);
const CAP_RE = new RegExp(
  String.raw`最多(?:可)?(?:延长|达|至|提高|延长至)?(?:至)?\s*` +
    AMOUNT +
    String.raw`\s*(秒|%)?`,
);
const CAP_OF_BASE_RE = new RegExp(
  String.raw`最多可达基础持续时间的\s*` + AMOUNT + String.raw`\s*%`,
);
// words that make an extension happen per event, not once
const TRIGGER_RE =
  /每|当|时[，,]|时，|会使|施放|使用|消耗|击中|爆击|造成伤害|刷新|创造|期间|激活时|召唤天神后|重新施加/;
const NAME_SPLIT_RE = /和|、|与|以及|或/;
const NAME_PREFIX_RE =
  /^(?:并且|并使|并|且|使|你的|你激活的|你已激活的|激活的|正在生效的|一个激活的|一个|目标身上的|你对目标施加的|所有|其)+/;

/** `$@spellnameNNN` → `#NNN`, colour codes and spell icons stripped. */
function normalise(text: string): string {
  return text
    .replace(/\|c[0-9a-fA-F]{8}/g, "")
    .replace(/\|[rR]/g, "")
    .replace(/\$@spellicon\d+/g, "")
    .replace(/\$@spellname(\d+)/g, "#$1");
}

/** The sentences of a rendered tooltip that say a duration is extended. */
export function parseDurationClauses(
  rendered: string,
  ctx: IAmountContext,
): { clauses: IDurationClause[]; unparsed: IUnparsedClause[] } {
  const clauses: IDurationClause[] = [];
  const unparsed: IUnparsedClause[] = [];
  const text = normalise(rendered);
  for (const raw of text.split(/[。；]|\s{2,}/)) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const m = EXTEND_RE.exec(sentence);
    if (!m) {
      if (/持续时间/.test(sentence) && /延长|增加|提高/.test(sentence))
        unparsed.push({ sentence, reason: "no amount after the extension" });
      continue;
    }
    const amount = evalAmount(m[3]!, ctx);
    if (amount === undefined) {
      unparsed.push({ sentence, reason: `amount ${m[3]} not resolvable` });
      continue;
    }
    const unitWord = m[4];
    const unit: IDurationClause["unit"] = unitWord === "%" ? "pct" : "s";
    const value = unitWord === "分钟" ? amount * 60 : amount;
    // the subject: the words before 「的持续时间」 (or before 「持续时间」)
    const at = m.index;
    let head = sentence.slice(0, at).replace(/的$/, "");
    // a trigger clause ends at its last 会使 / 使 / ，
    let trigger: string | undefined;
    const cut = Math.max(
      head.lastIndexOf("会使"),
      head.lastIndexOf("使"),
      head.lastIndexOf("，"),
      head.lastIndexOf(","),
    );
    if (cut >= 0) {
      const before = head.slice(0, cut);
      if (TRIGGER_RE.test(head.slice(0, cut + 2))) trigger = before.trim();
      head = head.slice(cut).replace(/^(?:会使|使|，|,)/, "");
    }
    head = head.replace(/的$/, "");
    const targets = head
      .split(NAME_SPLIT_RE)
      .map((n) => n.replace(NAME_PREFIX_RE, "").replace(/的$/, "").trim())
      .filter(Boolean);
    const implied =
      targets.length === 0 || targets.some((t) => /^(?:其|它|它们)$/.test(t));
    const clause: IDurationClause = {
      targets: implied ? [] : targets,
      ...(implied ? { subjectText: sentence.slice(0, at) } : {}),
      kind: m[2] ? "set" : trigger ? "per-event" : "fixed",
      unit,
      amount: value,
      sentence,
    };
    if (trigger) clause.trigger = trigger;
    const rest = sentence.slice(at + m[0].length);
    const capBase = CAP_OF_BASE_RE.exec(rest);
    const cap = capBase ? undefined : CAP_RE.exec(rest);
    if (capBase) {
      const v = evalAmount(capBase[1]!, ctx);
      if (v === undefined) {
        unparsed.push({ sentence, reason: "cap not resolvable" });
        continue;
      }
      clause.cap = v;
      clause.capUnit = "pct-of-base";
    } else if (cap) {
      const v = evalAmount(cap[1]!, ctx);
      if (v === undefined) {
        unparsed.push({ sentence, reason: "cap not resolvable" });
        continue;
      }
      clause.cap = v;
      clause.capUnit = "s";
    }
    clauses.push(clause);
  }
  return { clauses, unparsed };
}
