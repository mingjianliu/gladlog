import { useEffect, useMemo, useState } from "react";

import { type AnalysisRunInput, buildAnalysisInput } from "../analysisInput";
import type { ReportSource } from "../types";
import {
  canDeriveOffThread,
  peekAnalysisInput,
  prepareAnalysisInput,
} from "./offThreadDerive";

type Plan =
  | { kind: "off" }
  | { kind: "value"; value: AnalysisRunInput | null }
  | { kind: "pending"; p: Promise<AnalysisRunInput | null> };

/**
 * buildAnalysisInput(source, matchId) for a component, without freezing the
 * page to build it (offThreadDerive.ts): a cached value is returned at once;
 * otherwise it is built in the derive worker and `pending` is true until it
 * lands (`input` is null meanwhile). A source the worker cannot take, or a
 * worker that fails, is built in place — the old behaviour.
 *
 * Built against the raw streams the page holds at the moment of the call,
 * like the synchronous call it replaces. `enabled` false (analysis tables not
 * loaded yet) = null, not pending.
 */
export function useAnalysisInput(
  source: ReportSource,
  matchId: string | undefined,
  enabled = true,
): { input: AnalysisRunInput | null; pending: boolean } {
  const plan = useMemo((): Plan => {
    if (!enabled || !matchId) return { kind: "off" };
    // not one for the worker: the plain call (it checks the caches itself)
    if (!canDeriveOffThread(source))
      return { kind: "value", value: buildAnalysisInput(source, matchId) };
    const hit = peekAnalysisInput(source, matchId);
    if (hit !== undefined) return { kind: "value", value: hit };
    const p = prepareAnalysisInput(source, matchId);
    if (p === null)
      return { kind: "value", value: buildAnalysisInput(source, matchId) };
    return { kind: "pending", p };
  }, [source, matchId, enabled]);

  const [landed, setLanded] = useState<{
    plan: Plan;
    value: AnalysisRunInput | null;
  } | null>(null);
  useEffect(() => {
    if (plan.kind !== "pending" || !matchId) return;
    let live = true;
    plan.p.then(
      (value) => {
        if (live) setLanded({ plan, value });
      },
      () => {
        // the worker failed this one: build it here, as before the worker
        if (live)
          setLanded({ plan, value: buildAnalysisInput(source, matchId) });
      },
    );
    return () => {
      live = false;
    };
  }, [plan, source, matchId]);

  if (plan.kind === "off") return { input: null, pending: false };
  if (plan.kind === "value") return { input: plan.value, pending: false };
  if (landed?.plan === plan) return { input: landed.value, pending: false };
  return { input: null, pending: true };
}
