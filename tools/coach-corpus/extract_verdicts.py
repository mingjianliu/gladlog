#!/usr/bin/env python3
"""Stage B (VoD): transcript -> coaching verdicts, TWO-STAGE by default.

Stage 1 is blind (no type list in sight; the coach's own granularity). Stage 2 maps each verdict onto
gladlog's declared types using the REAL predicate definitions, with an honest "unmapped".
  extract_verdicts.py [--out verdicts] [--shard i n] [--model M --effort E]
  extract_verdicts.py --remap-from verdicts_remap --out verdicts_v3 ...   # stage 2 only, keeps *_v1
Historical dirs in the data root: verdicts/ = 2026-09-05 single-prompt v1 (slug mapping, superseded);
verdicts_remap/ = v2 (stage 2 rerun with real definitions; the numbers in the HANDOFF).
"""
import argparse, time
from common import DATA, ACTIVE, RETIRED, load_type_defs, def_block, claude_call, read_json, write_json, shard, transcript_body, SECURITY

OPEN = """You are open-coding a World of Warcraft arena VoD review.

MATCH: {bracket} | {map} | patch {patch}
student plays {you}; allies {ally1}, {ally2}
enemies {enemy1}, {enemy2}, {enemy3}

A coach narrates a replay of the student's match. Extract every distinct VERDICT — a judgement that
something was done wrong, done right, or should have been done differently. Skip pure narration,
filler and greetings.

Describe each verdict IN YOUR OWN WORDS, using whatever vocabulary the coach's own thinking
suggests. Do not try to fit any pre-existing category scheme.

Per verdict:
{{"t_start": <sec>, "t_end": <sec>,
  "paraphrase": "<ONE sentence, your own words, never quote the coach verbatim>",
  "polarity": "mistake"|"correct"|"alternative",
  "subject": "student"|"ally"|"enemy",
  "semantic": "<short kebab-case label naming what this verdict is ABOUT>",
  "outcome_claim": "<what the coach says it caused, or null>",
  "needs_frame": <bool: does confirming this need reading the screen state?>}}

Output one JSON object: {{"verdicts":[...]}}. No prose, no fence.
""" + SECURITY

MAP = """You are mapping coaching verdicts onto an analysis tool's declared candidate types.

Each type below carries its REAL operational definition — the predicate the tool actually fires on.
Map a verdict to a type only when the coach's judgement is the SAME event the predicate describes,
not merely the same topic. "Topic overlap" is not a match.

DECLARED TYPES — ACTIVE
{active}

DECLARED TYPES — RETIRED (still valid mapping targets; the tool once fired them)
{retired}

If no predicate describes the verdict's event, answer "unmapped". Use it freely and honestly —
unmapped verdicts are the interesting ones. Do not stretch.

map_confidence: "high" = the predicate would fire on exactly this event; "medium" = same event
family, predicate might not catch this instance; "low" = topical resemblance only.

VERDICTS
{items}

Output one JSON object, no fence:
{{"map": {{"<index>": {{"gladlog_type": "<type or unmapped>", "map_confidence": "high"|"medium"|"low"}}, ...}}}}
"""

def map_stage(vs, defs, model, effort):
    if not vs: return
    items = "\n".join(f'{i}. [{v.get("semantic","?")}] {v.get("paraphrase","")}' for i, v in enumerate(vs))
    m = claude_call(MAP.format(active=def_block(defs, ACTIVE, "active"), retired=def_block(defs, RETIRED, "retired"), items=items), model, effort).get("map", {})
    for i, v in enumerate(vs):
        e = m.get(str(i)) or {}
        v["gladlog_type"] = e.get("gladlog_type", "unmapped"); v["map_confidence"] = e.get("map_confidence", "low")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default="verdicts"); ap.add_argument("--remap-from")
    ap.add_argument("--shard", nargs=2, type=int, default=[0,1]); ap.add_argument("--model"); ap.add_argument("--effort"); a = ap.parse_args()
    defs = load_type_defs(); out_dir = DATA / a.out
    src = DATA / (a.remap_from or "transcripts"); files = shard(sorted(src.glob("*.json")), *a.shard)
    print(f"shard {a.shard[0]}/{a.shard[1]}: {len(files)} -> {out_dir.name} ({'remap only' if a.remap_from else 'two-stage'}) model={a.model or 'inherit'} effort={a.effort or 'inherit'}", flush=True)
    for n, f in enumerate(files, 1):
        out = out_dir / f.name
        if out.exists(): print(f"[{n}/{len(files)}] {f.stem} cached", flush=True); continue
        rec = read_json(f); t0 = time.time()
        try:
            if a.remap_from:
                vs = rec.get("verdicts", [])
                for v in vs:
                    for k in ("gladlog_type","map_confidence"): v[k + "_v1"] = v.get(k)
            else:
                c = rec["comp"]
                vs = claude_call(OPEN.format(bracket=rec.get("bracket"), map=rec.get("map"), patch=rec.get("patch"), body=transcript_body(rec),
                                             **{k: c.get(k) for k in ("you","ally1","ally2","enemy1","enemy2","enemy3")}), a.model, a.effort).get("verdicts", [])
                for v in vs: v.setdefault("semantic", "unlabelled"); v.setdefault("paraphrase", "")
                rec = {k: rec.get(k) for k in ("uuid","title","patch","bracket","type","staff","map","durSec","comp")}
            map_stage(vs, defs, a.model, a.effort); rec["verdicts"] = vs; rec["mapping"] = "two-stage-real-definitions"
            write_json(out, rec)
            un = sum(1 for v in vs if v["gladlog_type"] == "unmapped")
            print(f"[{n}/{len(files)}] {f.stem} {len(vs)} verdicts, {un} unmapped in {time.time()-t0:.0f}s", flush=True)
        except Exception as e:
            print(f"[{n}/{len(files)}] {f.stem} FAILED {e}", flush=True)

if __name__ == "__main__": main()
