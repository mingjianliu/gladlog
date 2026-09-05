#!/usr/bin/env python3
"""Regenerate type_definitions.json from gladlog SOURCE, so the mapper always sees the real
predicates (the 2026-09-05 lesson: slugs cost 25pp; four thin hand glosses lost to real neighbours).

Sources
  * packages/analysis/src/analysis/buildFindingsPrompt.ts — prompt-facing definition per type
  * four types with no prompt entry, transcribed from their emitting code (paths recorded below);
    re-read those files when they change — this block is the hand-maintained part.
--selftest: every ACTIVE/RETIRED type has a definition, and every type mistakes.ts declares is in
the roster (drift detector, per CLAUDE.md's Curated-List Completeness Rule).
"""
import re, subprocess, sys
from common import REPO, TYPE_DEFS, ACTIVE, RETIRED, write_json

PROMPT_TS = REPO / "packages/analysis/src/analysis/buildFindingsPrompt.ts"
MISTAKES_TS = REPO / "packages/desktop/src/renderer/src/report/derive/mistakes.ts"

# Real predicates read from code on 2026-09-05. Keep the file:function pointer with each so the
# next reader can re-verify instead of trusting the paraphrase.
HAND = {
 "cd-waste": '- "cd-waste" (保命 CD 整场未用; candidateFindings.ts cdWasteEvents): fires only if the owner\'s HP fell below CD_WASTE_PRESSURE_HP_PCT=60% at some point in the round (real pressure existed); then, for each major cooldown that is Defensive-tagged, not throughput, not proc-only, and was NEVER pressed the whole match. Cost-norm abilities (Divine Shield / Ice Block) carry a guard: usable but too costly to coach as a routine reaction. The event is "a defensive you had all match and never used, in a round where you were actually under pressure".',
 "missed-kick": '- "missed-kick" (打断空放; utils/kickAudit.ts analyzeKickAudit result="missed"): the player CAST an interrupt and no SPELL_INTERRUPT paired with it within 1 s (it did not land), cast-start data is present, and the target had NOT just cancelled a cast (that would be "juked", retired). The event is "you pressed your kick and it hit air with nothing kickable". It is NOT "you should have kicked" — an unspent interrupt is a different (currently untyped) event.',
 "missed-purge-kill-window": '- "missed-purge-kill-window" (击杀窗口内漏 purge; reconstructDispelSummary.missedPurgeWindows × annotateMissedPurgesWithKillWindows × computeOffensiveWindows, consumed in desktop derive/mistakes.ts): an enemy buff that the owner\'s available purge/offensive dispel could have removed stayed up, AND that window overlapped a friendly offensive kill window (duringKillWindow). Timed at the instant. Generic "you should purge X" outside a kill window is the retired `missed-purge`, not this.',
 "questionable-external": '- "questionable-external" (无压力窗口交出外减; candidates/death.ts, consumer of annotateDefensiveTimings tier "Unnecessary"): the owner cast an ally-castable external (EXTERNAL_DEFENSIVE_IDS) onto a teammate in a no-pressure window — target at high HP AND no damage spike AND no alignment with an enemy burst window (all three required). The event is "you spent an external when nothing was happening to the target".',
 "death": '- "death": the log owner died. Neutral anchoring fact, not an accusation; map here only when the verdict is literally "you died here" with no further judgement.',
}

def from_prompt_ts():
    src = PROMPT_TS.read_text()
    out = {}
    for m in re.finditer(r'"([a-z][a-z0-9-]+)":\s*`(.*?)`\s*,', src, re.S):
        k, v = m.group(1), m.group(2).strip()
        if v.startswith('- "'):
            out[k] = re.sub(r"\s+", " ", v)
    return out

def declared_in_mistakes():
    return set(re.findall(r'type:\s*"([a-z][a-z0-9-]+)"', MISTAKES_TS.read_text()))

def git_rev(path):
    r = subprocess.run(["git", "-C", str(REPO), "log", "-1", "--format=%h %ad", "--date=short", "--", str(path)], capture_output=True, text=True)
    return r.stdout.strip()

def main():
    defs = from_prompt_ts(); defs.update(HAND)
    roster = set(ACTIVE + RETIRED)
    missing = sorted(roster - set(defs)); extra_declared = sorted(declared_in_mistakes() - roster)
    meta = {"generated_from": {"buildFindingsPrompt.ts": git_rev(PROMPT_TS), "mistakes.ts": git_rev(MISTAKES_TS)},
            "hand_written": sorted(HAND), "active": ACTIVE, "retired": RETIRED}
    if "--selftest" in sys.argv:
        ok = not missing and not extra_declared
        print(f"definitions: {len(defs)} · roster: {len(roster)} · missing: {missing or 'none'} · declared-but-not-in-roster: {extra_declared or 'none'}")
        print("SELFTEST", "OK" if ok else "FAIL"); sys.exit(0 if ok else 1)
    if missing:
        sys.exit(f"missing definitions for {missing}")
    write_json(TYPE_DEFS, {"_meta": meta, "definitions": {k: defs[k] for k in sorted(defs)}})
    print(f"wrote {TYPE_DEFS.name}: {len(defs)} definitions ({len(HAND)} hand-written) · sources {meta['generated_from']}")
    if extra_declared:
        print(f"WARNING mistakes.ts declares types not in roster: {extra_declared} — update common.ACTIVE/RETIRED")

if __name__ == "__main__":
    main()
