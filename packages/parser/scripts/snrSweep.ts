import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { parseLine } from "../src/l1/parseLine";

interface FailureSample {
  file: string;
  line: number;
  content: string;
}

function collectFiles(paths: string[]): string[] {
  const files: string[] = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) {
      continue;
    }
    const stat = fs.statSync(p);
    if (stat.isFile()) {
      files.push(path.resolve(p));
    } else if (stat.isDirectory()) {
      const recurse = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            recurse(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (ext === ".log" || ext === ".txt") {
              files.push(path.resolve(fullPath));
            }
          }
        }
      };
      recurse(p);
    }
  }
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  let outPath: string | null = null;
  const inputPaths: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") {
      if (i + 1 < args.length) {
        outPath = args[i + 1]!;
        i++;
      }
    } else {
      inputPaths.push(args[i]!);
    }
  }

  if (inputPaths.length === 0) {
    console.error("Usage: tsx scripts/snrSweep.ts <日志目录或文件...> [--out <json路径>]");
    process.exit(1);
  }

  const files = collectFiles(inputPaths);

  let linesTotal = 0;
  let nonEmpty = 0;
  let typedOk = 0;
  let genericOk = 0;
  let failed = 0;
  const knownEventCounts: Record<string, number> = {};
  const unknownEventCounts: Record<string, number> = {};
  const failures: FailureSample[] = [];

  for (const filePath of files) {
    let fileFailures = 0;
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let lineNum = 0;
    for await (const line of rl) {
      lineNum++;
      linesTotal++;
      if (line.trim() === "") {
        continue;
      }
      nonEmpty++;

      const parsed = parseLine(line);
      if (parsed === null) {
        failed++;
        if (fileFailures < 20) {
          failures.push({
            file: filePath,
            line: lineNum,
            content: line.slice(0, 120),
          });
          fileFailures++;
        }
      } else {
        const eventName = parsed.eventName || "UNKNOWN";
        if (parsed.known === false) {
          genericOk++;
          unknownEventCounts[eventName] = (unknownEventCounts[eventName] || 0) + 1;
        } else {
          typedOk++;
          knownEventCounts[eventName] = (knownEventCounts[eventName] || 0) + 1;
        }
      }
    }

    process.stderr.write(`Processed ${filePath}\n`);
  }

  const topKnownEvents = Object.fromEntries(
    Object.entries(knownEventCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
  );

  const topUnknownEvents = Object.fromEntries(
    Object.entries(unknownEventCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
  );

  const typedRate = nonEmpty > 0 ? (typedOk + genericOk) / nonEmpty : 0;
  const outputJson = {
    files: files.length,
    linesTotal,
    nonEmpty,
    typedOk,
    genericOk,
    failed,
    typedRate,
    topKnownEvents,
    topUnknownEvents,
    failureSamples: failures.slice(0, 100),
  };

  if (outPath) {
    const absoluteOutPath = path.resolve(outPath);
    fs.mkdirSync(path.dirname(absoluteOutPath), { recursive: true });
    fs.writeFileSync(absoluteOutPath, JSON.stringify(outputJson, null, 2), "utf-8");
  }

  const ratePercent = (typedRate * 100).toFixed(4);
  console.log(
    `SNR files=${files.length} nonEmpty=${nonEmpty} typedOk=${typedOk} genericOk=${genericOk} failed=${failed} rate=${ratePercent}%`
  );
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
