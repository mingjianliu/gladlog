/**
 * CPU-calibration scene for the first-paint budget (GH #145 item 2).
 *
 * The ratio gate (`firstPaintRatio`, heavy ÷ control) divides the runner's
 * speed out, but it is blind BY CONSTRUCTION to a fixed per-load cost — a big
 * blob at module top level raises heavy and control alike. Only an absolute
 * reading of the control sees that, and absolute milliseconds on
 * ubuntu-latest span ~2.3× for the same code, so a +50 % fixed cost (the
 * 2026-07-25 icon table) passes `firstPaintControl`.
 *
 * This page is the same-run normaliser: a fixed workload that shares NOTHING
 * with the app — no app module, no fixture, no app data — so an app
 * regression does not move its own work (only indirectly, through the shared
 * browser's GC and memory state between loads), while a slow runner slows it
 * like it slows the control. `firstPaint.spec.ts` times it interleaved with the two report
 * scenes and logs `[budget] firstPaintControlPerCal=` (control floor ÷ this
 * floor). Its mix follows the control's: a module load, a JSON parse, a
 * script-heavy pass, and a large DOM insert with layout and paint. Plain DOM,
 * not React: importing React here would make Vite split React out of the
 * app's chunk into a shared one, changing the very scenes being measured.
 *
 * Deterministic by construction (seeded PRNG, fixed sizes): never change the
 * sizes or the work without restarting the CI sample population the lock is
 * taken from.
 */

const ROWS = 80_000;
const RENDERED = 8_000;

/** mulberry32: a fixed seed gives the same rows on every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface IRow {
  id: number;
  name: string;
  hp: number;
  samples: number[];
}

function buildRows(): IRow[] {
  const rnd = prng(145);
  const rows: IRow[] = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push({
      id: i,
      name: `unit-${Math.floor(rnd() * 1e9).toString(36)}`,
      hp: Math.floor(rnd() * 1e6),
      samples: Array.from({ length: 16 }, () => Math.floor(rnd() * 1000)),
    });
  }
  // a JSON round trip, as the report's fixture load does
  return JSON.parse(JSON.stringify(rows)) as IRow[];
}

function crunch(rows: IRow[]): IRow[] {
  const sorted = [...rows].sort(
    (a, b) => b.hp - a.hp || a.name.localeCompare(b.name),
  );
  for (const r of sorted) r.samples.sort((a, b) => a - b);
  return sorted.slice(0, RENDERED);
}

function render(rows: IRow[]): void {
  const table = document.createElement("table");
  const body = table.createTBody();
  for (const r of rows) {
    const tr = body.insertRow();
    tr.insertCell().textContent = r.name;
    tr.insertCell().textContent = String(r.hp);
    tr.insertCell().textContent = r.samples.join(" ");
  }
  document.getElementById("root")!.append(table);
  // force layout now, then mark done two frames later: paint has happened
  void table.offsetHeight;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const done = document.createElement("div");
      done.dataset["testid"] = "cal-done";
      done.textContent = "done";
      document.body.prepend(done);
    }),
  );
}

render(crunch(buildRows()));
