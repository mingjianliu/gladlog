#!/usr/bin/env python3
"""Stage B (courses): transcript -> coaching RULES, two-stage, with log-decidability triage.

  extract_rules.py [--out rules] [--course TITLE] [--shard i n] [--model M --effort E]
  extract_rules.py --remap-from rules_opus --out rules_opus_v3 ...   # stage 2 only, keeps *_v1
Triage boundary (tightened 2026-09-05): "log-decidable" means gladlog's CURRENT code already
derives the fact, not merely that the raw event is in the log. Denominator for the 三分 is
kind == "decision" only (aggregate.py enforces it).
"""
import argparse, time
from common import DATA, ACTIVE, RETIRED, load_type_defs, def_block, claude_call, read_json, write_json, shard, transcript_body, SECURITY

EXTRACT = """You are extracting coaching RULES from a scripted World of Warcraft arena tutorial.

COURSE: {course}   ·   LESSON: {title}   ·   CHAPTER: {chapter}

A rule is a reusable instruction with a condition: "when X, do Y (because Z)". Not a one-off
observation about a specific match. Extract every distinct rule the lesson teaches. Skip
greetings, filler, and pure narration.

Per rule, in your own words (never quote the coach verbatim):
{{"rule": "<one sentence: the instruction>",
  "trigger": "<the observable game-state condition under which it applies, or null if unconditional>",
  "role_scope": "melee"|"ranged"|"healer"|"all",
  "comp_scope": "<enemy spec/comp it is specific to, or \\"any\\">",
  "consequence": "<what the coach says happens if you do / don't, or null>",
  "kind": "decision"|"mechanic-fact"|"mindset",
  "t_start": <sec>, "t_end": <sec>}}

kind: "decision" = a choice the player makes in-match; "mechanic-fact" = a game fact used to
justify decisions (spell school, DR, range); "mindset" = attitude / meta advice.

Output one JSON object, no fence: {{"rules":[...]}}
""" + SECURITY

MAP = """Below are coaching rules extracted from arena tutorials. For each, do two things.

(1) gladlog mapping. Each declared type below carries its REAL operational predicate. Map only when
the rule's *violation* is the SAME event the predicate fires on — not the same topic. Otherwise
"unmapped". Confidence: high = predicate fires on exactly this; medium = same event family; low =
topical resemblance only.

DECLARED TYPES — ACTIVE
{active}
DECLARED TYPES — RETIRED (still valid targets)
{retired}

(2) Log-decidability. gladlog reads WoW advanced combat logs: every cast, aura apply/remove,
damage/heal with amounts, unit HP samples, unit positions (x,y), deaths, CC with DR, interrupts,
dispels — for all ten players. It does NOT have: camera/what the player saw, intent, voice comms,
targeting before a cast lands, line-of-sight geometry beyond raw coordinates, enemy cooldown state
except by inference from casts.
Classify whether the rule's violation could be detected from the log. The line between the first
two classes is NOT "is the raw event in the log" — almost everything is. It is whether gladlog's
CURRENT analysis code already DERIVES the fact the rule needs:
  "log-decidable"        — every fact the trigger and violation need is one gladlog already
                           computes today: casts, aura apply/remove, CC with DR category,
                           interrupts (landed/missed), dispels/purges, deaths, HP samples,
                           major-cooldown availability (cdAvailableAt), enemy-healer CC windows,
                           friendly crisis windows, offensive kill windows, PvP trinket state,
                           damage/heal amounts, unit positions (x,y)
  "needs-new-data"       — the raw events exist but the rule needs a DERIVED quantity or
                           expectation gladlog does not compute: an uptime or duration metric
                           (e.g. snare uptime, melee uptime, time-on-target), a distance/LoS model
                           built from coordinates, a per-player or per-comp baseline, a "should have
                           been reserved for phase X" expectation, enemy cooldown state inferred
                           beyond casts. Name the missing derivation.
  "structurally-no"      — depends on something the log cannot contain (intent, vision, voice
                           comms, what the UI displayed, what the player believed)
Worked example: "keep the target snared" — snare aura apply/remove IS logged, but gladlog has no
snare-uptime metric → needs-new-data (uptime metric), not log-decidable.
Give one sentence of reasoning naming the missing fact when not log-decidable.

RULES
{items}

Output one JSON object, no fence:
{{"map": {{"<index>": {{"gladlog_type": "<type|unmapped>", "map_confidence": "high"|"medium"|"low",
  "decidable": "log-decidable"|"needs-new-data"|"structurally-no", "why": "<one sentence>"}}, ...}}}}
"""

def map_stage(rules, defs, model, effort):
    if not rules: return
    items = "\n".join(f'{i}. [{r.get("role_scope","?")}/{r.get("kind","?")}] {r["rule"]}  || trigger: {r.get("trigger")}  || vs: {r.get("comp_scope")}' for i, r in enumerate(rules))
    m = claude_call(MAP.format(active=def_block(defs, ACTIVE, "active"), retired=def_block(defs, RETIRED, "retired"), items=items), model, effort).get("map", {})
    for i, r in enumerate(rules):
        e = m.get(str(i)) or {}
        r["gladlog_type"] = e.get("gladlog_type", "unmapped"); r["map_confidence"] = e.get("map_confidence", "low")
        r["decidable"] = e.get("decidable", "needs-new-data"); r["why"] = e.get("why", "")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default="rules"); ap.add_argument("--remap-from"); ap.add_argument("--course")
    ap.add_argument("--shard", nargs=2, type=int, default=[0,1]); ap.add_argument("--model"); ap.add_argument("--effort"); a = ap.parse_args()
    defs = load_type_defs(); out_dir = DATA / a.out
    src = DATA / (a.remap_from or "transcripts_courses"); files = sorted(src.glob("*.json"))
    if a.course: files = [f for f in files if read_json(f).get("course") == a.course]
    files = shard(files, *a.shard)
    print(f"shard {a.shard[0]}/{a.shard[1]}: {len(files)} lessons -> {out_dir.name} ({'remap only' if a.remap_from else 'two-stage'}) model={a.model or 'inherit'} effort={a.effort or 'inherit'}", flush=True)
    for n, f in enumerate(files, 1):
        out = out_dir / f.name
        if out.exists(): print(f"[{n}/{len(files)}] {f.stem} cached", flush=True); continue
        rec = read_json(f); t0 = time.time()
        try:
            if a.remap_from:
                rules = rec.get("rules", [])
                for r in rules:
                    for k in ("gladlog_type","map_confidence","decidable","why"): r[k + "_v1"] = r.get(k)
            else:
                rules = claude_call(EXTRACT.format(course=rec["course"], title=rec["title"], chapter=rec["chapter"], body=transcript_body(rec)), a.model, a.effort).get("rules", [])
                for r in rules: r.setdefault("rule", ""); r.setdefault("trigger", None)
                rec = {k: rec.get(k) for k in ("uuid","course","chapter","order","title","durSec")}
            map_stage(rules, defs, a.model, a.effort); rec["rules"] = rules; rec["mapping"] = "two-stage-real-definitions+derived-boundary"
            write_json(out, rec)
            dec = [r for r in rules if r.get("kind") == "decision"]
            print(f"[{n}/{len(files)}] {f.stem} '{rec['title'][:34]}' {len(rules)} rules, {len(dec)} decision, {sum(1 for r in dec if r['decidable']=='log-decidable')} log-decidable in {time.time()-t0:.0f}s", flush=True)
        except Exception as e:
            print(f"[{n}/{len(files)}] {f.stem} FAILED {e}", flush=True)

if __name__ == "__main__": main()
