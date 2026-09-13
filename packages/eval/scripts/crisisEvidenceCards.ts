/**
 * crisisEvidenceCards.ts — turn the step-2 evidence ledger (GH #94) into
 * short Chinese judging cards for a human.
 *
 * Why: the step-2 lists are complete and cutoff-safe but unreadable — 20
 * crises × ~25 English lines of spell names (user, 2026-09-13: 「这个怎么读
 * 啊 太多了」「格式也不是给人类读的」). This script only RE-PRESENTS the ledger:
 * every number comes from an evidence item's structured `detail` / `amount`,
 * nothing is recomputed from the round, and nothing is dropped silently — the
 * unclassified count and every unknown status travel onto the card.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/crisisEvidenceCards.ts [--in <step2 ledger.json>] [--out <cards.json>]
 */
import { SPELL_NAMES_ZH_GENERATED } from "@gladlog/analysis/src/data/spellNamesZh";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { SPEC_NAMES_ZH } from "../../desktop/src/renderer/src/report/data/specNames";

const HOME =
  process.env.GLADLOG_EVAL_HOME ??
  join(process.env.HOME ?? "", "code/gladlog-eval-private");
const argStr = (f: string) => {
  const i = process.argv.indexOf(f);
  return i < 0 ? undefined : process.argv[i + 1];
};
const inPath =
  argStr("--in") ??
  join(HOME, "reports/temporal-evidence-2026-09-13/step2/ledger.json");
const outPath =
  argStr("--out") ??
  join(HOME, "reports/temporal-evidence-2026-09-13/step2/cards.json");

const shortName = (n: string | undefined) => (n ?? "?").split("-")[0]!;
const zh = (id: string | undefined, fallback: string) =>
  (id && SPELL_NAMES_ZH_GENERATED[id]) || fallback;
const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** English spell name as the evidence text rendered it: the part before " (". */
const enName = (text: string) => text.split(" (")[0]!.replace(/^cast /, "");

function fnZh(f: string): string {
  let m = f.match(/^(\d+)% mitigation$/);
  if (m) return `减伤${m[1]}%`;
  if (f.startsWith("school immunity")) return "免疫伤害";
  if (f.startsWith("mechanic immunity")) return "免疫定身减速等（不挡伤害）";
  if (f === "absorb") return "吸收盾";
  m = f.match(/^\+(\d+)% healing received$/);
  if (m) return `受治疗+${m[1]}%`;
  if (f === "heals") return "治疗";
  if (f === "crowd control") return "控制";
  if (f === "damage") return "伤害";
  return f;
}

type Item = {
  phase: "at-t" | "window";
  kind: string;
  status: "known" | "estimated" | "unknown";
  text: string;
  spellId?: string;
  srcName?: string;
  amount?: number;
  detail?: any;
};

const ledger = JSON.parse(readFileSync(inPath, "utf8"));
const owner = (row: any) => row.evidence.ownerName as string;

const cards = ledger.rows.map((row: any) => {
  const items: Item[] = row.evidence.items;
  const at = items.filter((i) => i.phase === "at-t");
  const win = items.filter((i) => i.phase === "window");
  const who = (src: string | undefined) =>
    src === owner(row) ? "自己" : shortName(src);

  const hpItem = at.find(
    (i) => i.kind === "pressure" && i.detail?.hpPct !== undefined,
  );
  const dmgItem = at.find((i) => i.kind === "pressure" && i.detail?.attackers);

  const protection = at
    .filter((i) =>
      [
        "mitigation",
        "immunity",
        "absorb",
        "hot",
        "healing-received-modifier",
      ].includes(i.kind),
    )
    .map((i) => {
      const name = zh(i.spellId, enName(i.text));
      const tag =
        i.kind === "mitigation"
          ? `减伤${i.amount}%`
          : i.kind === "absorb"
            ? "吸收盾（剩多少未知）"
            : i.kind === "hot"
              ? "持续治疗"
              : i.kind === "healing-received-modifier"
                ? `受治疗+${i.amount}%`
                : i.text.includes("mechanic immunity")
                  ? "免疫定身减速等（不挡伤害）"
                  : "免疫伤害";
      return {
        name,
        tag,
        who: who(i.srcName),
        estimated: i.status !== "known",
      };
    });
  const ccOnOwner = at
    .filter((i) => i.kind === "cc-on-owner")
    .map((i) => ({
      name: zh(i.spellId, enName(i.text)),
      who: shortName(i.srcName),
    }));
  const unclassified =
    at.find((i) => i.kind === "unclassified")?.text.match(/^(\d+)/)?.[1] ?? "0";

  const heals = win.filter((i) => i.kind === "healing");
  const healPct = heals.reduce((s, i) => s + (i.detail?.pctMaxHp ?? 0), 0);
  const healTop = heals
    .filter((i) => !i.detail?.collapsedSources)
    .slice(0, 4)
    .map((i) => ({
      name: zh(i.spellId, i.text.match(/healing from (.+?) by /)?.[1] ?? "?"),
      pct: i.detail?.pctMaxHp ?? null,
      who: i.detail?.self ? "自己" : shortName(i.srcName),
      periodic: !!i.detail?.periodic,
    }));
  const healRest = heals.find((i) => i.detail?.collapsedSources);
  const absorbed = win
    .filter((i) => i.kind === "absorbed-damage")
    .map((i) => ({
      name: zh(i.spellId, i.text.replace(/^\S+ damage absorbed by /, "")),
      k: Math.round((i.amount ?? 0) / 1000),
    }));

  const casts = win
    .filter((i) => i.kind === "cast")
    .map((i) => ({
      name: zh(i.spellId, enName(i.text)),
      fn: (i.detail?.functions ?? []).map(fnZh),
      target:
        i.detail?.target === "self"
          ? "自己"
          : i.detail?.target
            ? shortName(i.detail.target)
            : null,
    }));
  const newProtection = win
    .filter((i) => i.kind === "aura-applied")
    .map((i) => ({
      name: zh(i.spellId, enName(i.text)),
      fn: (i.detail?.functions ?? []).map(fnZh),
      who: i.detail?.self ? "自己" : shortName(i.srcName),
    }));
  const ccOnAttackers = win
    .filter((i) => i.kind === "cc-on-attacker")
    .map((i) => ({
      name: zh(i.spellId, enName(i.text)),
      who: i.detail?.self ? "自己" : shortName(i.srcName),
      target: shortName(i.detail?.target),
    }));
  // one line per (spell, caster, target)
  const ccDedup = [
    ...new Map(
      ccOnAttackers.map((c: any) => [`${c.name}|${c.who}|${c.target}`, c]),
    ).values(),
  ];

  // ── round 2 (amendment 2): enemy offensive state and line of sight ────────
  const enemyActive = at
    .filter((i) => i.kind === "enemy-offensive-active")
    .map((i) => ({
      name: zh(i.spellId, i.text.split(" active on ")[0]!),
      on:
        i.detail?.recipient === owner(row)
          ? "你身上"
          : `${shortName(i.detail?.recipient)} 身上`,
      source: shortName(i.detail?.source),
      ageS: i.detail?.ageS ?? null,
      estimated: i.status !== "known",
    }));
  const castLine = (i: Item) => ({
    name: zh(i.spellId, i.text.match(/ cast (.+?) (?:at t|\d)/)?.[1] ?? "?"),
    source: shortName(i.detail?.source),
    attacker: !!i.detail?.isAttacker,
    ageS: i.detail?.ageS ?? null,
    atS: i.detail?.atS ?? null,
  });
  const enemyCastsBefore = at
    .filter((i) => i.kind === "enemy-offensive-cast")
    .map(castLine);
  const enemyCastsWindow = win
    .filter((i) => i.kind === "enemy-offensive-cast")
    .map(castLine);
  const losLine = (i: Item) => ({
    attacker: shortName(i.detail?.attacker),
    los: i.detail?.los ?? null,
    distance: i.detail?.distance ?? null,
  });
  const losAll = items.filter((i) => i.kind === "los");
  const los = {
    at: losAll.filter((i) => i.phase === "at-t").map(losLine),
    end: losAll.filter((i) => i.phase === "window").map(losLine),
    zoneNote: losAll[0]?.detail?.zoneNote ?? null,
  };

  const mv = win.find((i) => i.kind === "movement");
  const move =
    mv && mv.status !== "unknown"
      ? {
          owner: mv.detail?.ownerMoved ?? null,
          attackers: (mv.detail?.attackers ?? []).map((a: any) => ({
            name: shortName(a.name),
            d0: a.d0 ?? null,
            d1: a.d1 ?? null,
            moved: a.moved ?? null,
            unknown: !!a.unknown,
          })),
        }
      : null;

  const via = Object.entries(row.baseline.responses ?? {})
    .filter(([, v]) => v)
    .map(
      ([k]) =>
        (
          ({
            selfHeal: "自疗",
            wall: "开墙",
            external: "外减",
            control: "控制",
            peel: "队友控制",
            kite: "风筝",
          }) as any
        )[k] ?? k,
    );

  return {
    id: row.roundId,
    index: row.index,
    spec: SPEC_NAMES_ZH[row.ownerSpec] ?? row.ownerSpec,
    bracket: row.bracket === "solo" ? "单排" : row.bracket,
    time: mmss(row.tSec),
    hp: hpItem?.detail?.hpPct ?? null,
    dmgPct: dmgItem?.detail?.dmgPct ?? null,
    attackers: (dmgItem?.detail?.attackers ?? []).map((a: any) =>
      shortName(a.name),
    ),
    protection,
    ccOnOwner,
    unclassified: Number(unclassified),
    healPct,
    healTop,
    healRestPct: healRest?.detail?.pctMaxHp ?? 0,
    healRestN: healRest?.detail?.collapsedSources ?? 0,
    absorbed,
    casts,
    newProtection,
    ccOnAttackers: ccDedup,
    move,
    enemyActive,
    enemyCastsBefore,
    enemyCastsWindow,
    los,
    candidateFacts: row.candidateFacts ?? null,
    product: { responded: !!row.baseline.responded, via },
    died: !!row.outcome.diedWithin10s,
  };
});

writeFileSync(outPath, JSON.stringify(cards));
console.log(`${cards.length} cards → ${outPath}`);
console.log(JSON.stringify(cards[12], null, 1));
