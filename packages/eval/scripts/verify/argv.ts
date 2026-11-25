/**
 * verify/argv.ts — the runner's command line read by position: which value a
 * flag was given at each place it stands, and the line a worker is started
 * with. Apart from `verify/run.ts` so both can be tested without starting it.
 */

/** what follows `flag` at every place it stands in `args`: `undefined` where
 * the line ends on it. A value that happens to spell a flag is still a value
 * here; the caller says what it refuses. */
export function operandsOf(
  args: readonly string[],
  flag: string,
): Array<string | undefined> {
  const out: Array<string | undefined> = [];
  args.forEach((a, i) => {
    if (a === flag) out.push(args[i + 1]);
  });
  return out;
}

/** `args` without `flag` and the one value after it, wherever it stands. By
 * position: another flag's value that equals the dropped one stays
 * (`--out 10 --chunks 10` keeps `--chunks 10`). */
export function withoutFlag(args: readonly string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) {
      i++;
      continue;
    }
    out.push(args[i]!);
  }
  return out;
}

/** what a worker is started with after the script and the capture: this
 * run's own `--out`, its chunk and state file first (a flag is read at its
 * first place), then the parent's line without its `--out`. */
export function workerArgv(
  parentArgs: readonly string[],
  out: string,
  worker: string,
  statePath: string,
): string[] {
  return [
    "--out",
    out,
    "--worker",
    worker,
    "--state",
    statePath,
    ...withoutFlag(parentArgs, "--out"),
  ];
}
