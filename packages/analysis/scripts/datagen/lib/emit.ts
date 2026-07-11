import fs from "fs-extra";
import path from "path";

export function writeArtifact(filePath: string, content: string): void {
  fs.ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}
