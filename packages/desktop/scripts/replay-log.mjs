// scripts/replay-log.mjs
import { appendFileSync, readFileSync, writeFileSync } from "fs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const source = arg("source", null);
const dest = arg("dest", null);
const chunk = Number(arg("chunk", "500"));
const interval = Number(arg("interval", "300"));
if (!source || !dest) {
  console.error(
    "usage: node replay-log.mjs --source <log> --dest <dest> [--chunk N] [--interval ms]",
  );
  process.exit(1);
}
const lines = readFileSync(source, "utf-8").split("\n");
writeFileSync(dest, "");
let i = 0;
const timer = setInterval(() => {
  if (i >= lines.length) {
    clearInterval(timer);
    console.log(`done: ${lines.length} lines`);
    return;
  }
  appendFileSync(dest, lines.slice(i, i + chunk).join("\n") + "\n");
  i += chunk;
  process.stdout.write(`\r${i}/${lines.length}`);
}, interval);
