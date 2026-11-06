/**
 * GH #178 (2026-11-06): the one reader of a `[RES]` ledger row's text. The
 * row is written by `buildResourceSnapshot` (resourceSnapshot.ts):
 *
 *   `      [RES] rdy:<R>  cd:<C>[ | Atonements: N][  enemy:<E>][  focus:<F>][  cc:<X>]`
 *
 * Fields are joined by two spaces; a value never holds two spaces in a row
 * (entries are comma-joined, a name holds single spaces). The Disc-priest
 * count rides on the `cd:` value as ` | Atonements: N`. Every gate and corpus
 * scan that reads the row goes through `parseResRow` / `splitResList` /
 * `resLedgerName`, so a new token or field is taught in one place (F23's
 * `~X[k/N]` had to be found in eight hand-written regexes).
 */

/** A ledger row as rendered: six spaces, `[RES] rdy:`. The prompt's legend
 * lines (`  [RES] rdy: = abilities READY then …`, `  [RES] lists …`) are not
 * rows. */
export const RES_ROW_LINE_RE = /^ {6}\[RES\] rdy:/;

export function isResRowLine(line: string): boolean {
  return RES_ROW_LINE_RE.test(line);
}

export interface IResRow {
  /** the `rdy:` value: a full list (`A,B,2:C` / `—`) or a change list
   * (`Δ`, `Δ +A -2:B ~C[1/2]`) */
  rdy: string;
  /** `rdy:Δ …`: a change list against the previous row */
  delta: boolean;
  /** the `cd:` value without the Atonements count (`—` when empty) */
  cd: string;
  /** the ` | Atonements: N` count, when printed */
  atonements?: number;
  enemy?: string;
  focus?: string;
  cc?: string;
}

const FIELD_SEP = / {2,}/;
const ATONEMENTS = / \| Atonements: (\d+)$/;

/** The fields of a `[RES]` row, or `undefined` for any other line. */
export function parseResRow(line: string): IResRow | undefined {
  if (!RES_ROW_LINE_RE.test(line)) return undefined;
  const fields = line.trimStart().slice("[RES] ".length).split(FIELD_SEP);
  const out: IResRow = { rdy: "", delta: false, cd: "" };
  for (const f of fields) {
    const colon = f.indexOf(":");
    if (colon < 0) continue;
    const name = f.slice(0, colon);
    const value = f.slice(colon + 1);
    if (name === "rdy") {
      out.rdy = value;
      out.delta = value === "Δ" || value.startsWith("Δ ");
    } else if (name === "cd") {
      const a = ATONEMENTS.exec(value);
      out.cd = a ? value.slice(0, a.index) : value;
      if (a) out.atonements = Number(a[1]);
    } else if (name === "enemy") out.enemy = value;
    else if (name === "focus") out.focus = value;
    else if (name === "cc") out.cc = value;
  }
  return out;
}

/** The entries of a comma-joined ledger list. The ledger joins with a bare
 * comma; a name may hold ", " itself (Invoke Chi-Ji, the Red Crane). */
export function splitResList(s: string): string[] {
  return s.split(/,(?! )/);
}

/** A ledger entry's name without its display suffixes (`[1/2]`, `[1–2/2]`,
 * `(no mana 6.1k/11.5k)`). */
export function resLedgerName(n: string): string {
  return n.trim().replace(/(\[[\d–-]+\/\d+\]|\(no mana [^)]*\))+$/, "");
}
