#!/usr/bin/env python3
"""Stage C (VoD): induce a taxonomy over the free-form `semantic` labels, then assign.
Free generation first, clustering second: 2101 verdicts produced 2058 unique labels — the label is
useless as a grouping key until this step. Writes taxonomy.json. Progress is line-buffered; do not
pipe through `tail` (that hid 45 minutes of progress once).
  cluster.py [--in verdicts_remap] [--model M --effort E]
"""
import argparse, collections, json
from common import DATA, claude_call, read_json, write_json

INDUCE = """Below are {n} short kebab-case labels. Each names one verdict a professional World of Warcraft
arena coach delivered while reviewing a student's match.

Induce a taxonomy: group them into 20-35 coherent clusters. A cluster is a recurring COACHING
CONCERN, at the granularity a coach would recognise as "one thing I keep telling people" — not so
coarse that "cooldowns" swallows half the corpus, not so fine that it just renames a label.

Output JSON only, no fence:
{{"clusters": [{{"id": "<kebab-case>", "name_zh": "<短中文名>", "definition": "<one line: what belongs here>"}}]}}

LABELS
{labels}
"""
ASSIGN = """Assign each label to exactly one cluster id from the taxonomy. If a label genuinely fits none, use "other".

TAXONOMY
{tax}

LABELS
{labels}

Output JSON only, no fence: {{"assign": {{"<label>": "<cluster-id>", ...}}}}
"""

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--in", dest="src", default="verdicts_remap"); ap.add_argument("--model"); ap.add_argument("--effort"); a = ap.parse_args()
    labels = collections.Counter()
    for f in (DATA / a.src).glob("*.json"):
        for v in read_json(f).get("verdicts", []): labels[v["semantic"]] += 1
    uniq = sorted(labels); print(f"unique semantic labels: {len(uniq)} over {sum(labels.values())} verdicts", flush=True)
    tax = claude_call(INDUCE.format(n=len(uniq), labels="\n".join(uniq)), a.model, a.effort); print(f"induced {len(tax['clusters'])} clusters", flush=True)
    assign = {}
    for k in range(0, len(uniq), 220):
        assign.update(claude_call(ASSIGN.format(tax=json.dumps(tax, ensure_ascii=False), labels="\n".join(uniq[k:k+220])), a.model, a.effort).get("assign", {}))
        print(f"  assigned {len(assign)}/{len(uniq)}", flush=True)
    write_json(DATA / "taxonomy.json", {"clusters": tax["clusters"], "assign": assign, "counts": dict(labels)}); print("wrote taxonomy.json")

if __name__ == "__main__": main()
