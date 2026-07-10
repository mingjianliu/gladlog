// 全管线吞吐基准 + 浸泡:GladLogParser(L1+L2+L3),统计行速/对局数/诊断
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { GladLogParser } from "../src/api";

async function main() {
  let files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const mi = process.argv.indexOf("--manifest");
  if (mi > -1) files = readFileSync(process.argv[mi + 1], "utf8").split("\n").filter(Boolean);
  let lines = 0, matches = 0, shuffles = 0, diags = 0, dropped = 0, errors = 0;
  const t0 = Date.now();
  for (const [idx, f] of files.entries()) {
    try {
      const p = new GladLogParser();
      p.on("match", () => matches++);
      p.on("shuffle", () => shuffles++);
      p.on("diagnostic", () => diags++);
      const rl = createInterface({ input: createReadStream(f), crlfDelay: Infinity });
      for await (const line of rl) { p.push(line); lines++; }
      p.end();
      dropped += p.stats().linesDropped;
    } catch (e) { errors++; console.error(`ERROR ${f}: ${(e as Error).message}`); }
    if ((idx + 1) % 100 === 0) console.error(`${idx + 1}/${files.length}`);
  }
  const secs = (Date.now() - t0) / 1000;
  console.log(`PIPELINE files=${files.length} lines=${lines} secs=${secs.toFixed(1)} rate=${Math.round(lines / secs).toLocaleString()}/s matches=${matches} shuffles=${shuffles} diags=${diags} dropped=${dropped} errors=${errors}`);
}
main();
