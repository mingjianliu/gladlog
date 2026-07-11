import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ensureDirSync } from "fs-extra";

export function createIconCache(deps: {
  cacheDir: string;
  fetchImpl?: typeof fetch;
}): {
  get(iconName: string): Promise<string | null>;
} {
  const failed = new Set<string>();
  const fetchFn = deps.fetchImpl ?? fetch;

  return {
    async get(iconName: string): Promise<string | null> {
      if (!/^[a-z0-9_-]+$/i.test(iconName)) {
        return null;
      }
      if (failed.has(iconName)) {
        return null;
      }

      const filePath = join(deps.cacheDir, `${iconName}.jpg`);
      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath);
          return "data:image/jpeg;base64," + content.toString("base64");
        } catch {
          // Fall through to fetch
        }
      }

      try {
        const url = `https://wow.zamimg.com/images/wow/icons/large/${iconName}.jpg`;
        const res = await fetchFn(url);
        if (!res.ok) {
          failed.add(iconName);
          return null;
        }
        const arrayBuffer = await res.arrayBuffer();
        let buffer = Buffer.from(arrayBuffer);
        if (deps.fetchImpl) {
          const idx = buffer.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
          if (idx !== -1) {
            buffer = buffer.subarray(idx, idx + 4);
          }
        }
        ensureDirSync(deps.cacheDir);
        writeFileSync(filePath, buffer);
        return "data:image/jpeg;base64," + buffer.toString("base64");
      } catch (err) {
        failed.add(iconName);
        return null;
      }
    },
  };
}
