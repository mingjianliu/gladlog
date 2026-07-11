import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ensureDirSync } from "fs-extra";

export function createIconCache(deps: {
  cacheDir: string;
  fetchImpl?: typeof fetch;
  maxFetchesPerSession?: number;
}): {
  get(iconName: string): Promise<string | null>;
} {
  const failed = new Set<string>();
  const fetchFn = deps.fetchImpl ?? fetch;
  // 会话级网络预算:防被攻陷的 renderer 用海量名字打穿内存/磁盘(终审 F5)。
  // 正常战报的图标数远低于此;缓存命中不计入预算。
  const maxFetches = deps.maxFetchesPerSession ?? 512;
  let fetches = 0;

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

      if (fetches >= maxFetches) {
        return null;
      }
      try {
        fetches++;
        const url = `https://wow.zamimg.com/images/wow/icons/large/${iconName}.jpg`;
        const res = await fetchFn(url);
        if (!res.ok) {
          failed.add(iconName);
          return null;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
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
