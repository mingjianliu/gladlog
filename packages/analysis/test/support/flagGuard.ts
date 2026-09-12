/**
 * Runtime guard for the module-level mutable flag singletons that tests flip
 * directly (the A/B harness knobs). Installed from the analysis and eval
 * `vitest.setup.ts`: after every test, each flag object must equal its baseline,
 * otherwise that test fails and the flags are reset so the leak cannot cascade.
 *
 * It is what makes sharing the module cache (see testIsolation.ts) safe for these
 * objects: a wrong `finally` restore used to be invisible (each file got fresh
 * modules) and becomes an order-dependent leak once files share a worker. The
 * guard turns that into a deterministic failure in the offending test, in both
 * modes — including CI's fully isolated run.
 *
 * The flag modules are imported LAZILY (in beforeAll), never statically from the
 * setup file: a static import pulls their whole dependency graph into the module
 * registry before the test file's hoisted `vi.mock` calls are registered, which
 * silently disables those mocks (measured: behaviorPriorMalformed.test.ts went red
 * in both modes because healerOffenseAnalysis transitively loaded the mocked JSON).
 *
 * Baselines: CANDIDATE_TYPE_FLAGS is re-derived from the registry (independent of
 * any mutation). The two literal objects are snapshotted the first time a worker
 * loads them, before any test body has run, and kept on globalThis for that worker.
 */
import { afterEach, beforeAll } from "vitest";

type FlagObject = Record<string, boolean>;

/** Every exported mutable `*_FLAGS` object in packages/analysis/src. Completeness
 * is asserted by test/testIsolation.test.ts (a grep over src), so a new flag
 * singleton cannot silently escape the guard. */
export const MUTABLE_FLAG_NAMES = [
  "CANDIDATE_TYPE_FLAGS",
  "DISPEL_FEATURE_FLAGS",
  "HEALER_OFFENSE_FLAGS",
] as const;

export interface FlagGuardState {
  objects: Record<string, FlagObject>;
  baseline: (name: string) => FlagObject;
}

export async function loadFlagGuardState(): Promise<FlagGuardState> {
  const [flags, registry, dispel, offense] = await Promise.all([
    import("../../src/data/candidateTypeFlags"),
    import("../../src/data/candidateTypeRegistry"),
    import("../../src/data/dispelFeatureFlags"),
    import("../../src/utils/healerOffenseAnalysis"),
  ]);
  const objects: Record<string, FlagObject> = {
    CANDIDATE_TYPE_FLAGS: flags.CANDIDATE_TYPE_FLAGS,
    DISPEL_FEATURE_FLAGS: dispel.DISPEL_FEATURE_FLAGS,
    HEALER_OFFENSE_FLAGS: offense.HEALER_OFFENSE_FLAGS,
  };
  const g = globalThis as {
    __gladlogFlagSnapshots?: Record<string, FlagObject>;
  };
  g.__gladlogFlagSnapshots ??= {
    DISPEL_FEATURE_FLAGS: { ...dispel.DISPEL_FEATURE_FLAGS },
    HEALER_OFFENSE_FLAGS: { ...offense.HEALER_OFFENSE_FLAGS },
  };
  const snapshots = g.__gladlogFlagSnapshots;
  return {
    objects,
    baseline: (name) =>
      name === "CANDIDATE_TYPE_FLAGS"
        ? registry.deriveCandidateTypeFlags()
        : snapshots[name],
  };
}

/** Human-readable drift lines, empty when every flag is at its baseline. */
export function flagDrift(state: FlagGuardState): string[] {
  const out: string[] = [];
  for (const [name, obj] of Object.entries(state.objects)) {
    const base = state.baseline(name);
    for (const k of new Set([...Object.keys(base), ...Object.keys(obj)]))
      if (obj[k] !== base[k])
        out.push(
          `${name}.${k}: expected ${String(base[k])}, got ${String(obj[k])}`,
        );
  }
  return out;
}

export function resetFlagsToBaseline(state: FlagGuardState): void {
  for (const [name, obj] of Object.entries(state.objects)) {
    const base = state.baseline(name);
    for (const k of Object.keys(obj)) if (!(k in base)) delete obj[k];
    Object.assign(obj, base);
  }
}

export function installFlagGuard(): void {
  let state: FlagGuardState | null = null;
  beforeAll(async () => {
    state = await loadFlagGuardState();
  });
  afterEach(() => {
    if (!state) return;
    const drift = flagDrift(state);
    if (drift.length === 0) return;
    resetFlagsToBaseline(state);
    throw new Error(
      `test left module flags changed (restore them in finally with a saved copy):\n  ${drift.join("\n  ")}`,
    );
  });
}
