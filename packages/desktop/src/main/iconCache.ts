import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ensureDirSync } from "fs-extra";

/**
 * Creates the icon cache service.
 *
 * - The cache directory is supplied by the caller (in production it is
 *   app.getPath('userData')/icons, see main/index.ts).
 * - Files land on disk as <name>.jpg keyed by icon name, with no eviction
 *   policy (the disk cache is kept forever; it is naturally bounded because
 *   the icon set is finite).
 * - The per-session fetch budget defaults to 512, and the `failed` set is a
 *   per-session memo; neither persists across sessions.
 */
export function createIconCache(deps: {
  cacheDir: string;
  fetchImpl?: typeof fetch;
  maxFetchesPerSession?: number;
  /**
   * Offline mode: issue no network requests at all; a cache miss always
   * returns null.
   *
   * For visual regression only. qa/support/stubExternal uses Playwright's
   * page.route to pin the renderer process's external requests to fixed
   * stubs, but it **cannot intercept the main process** -- icon fetching
   * happens here, so the "draw it if it loaded, don't if it didn't" jitter
   * leaked out from under stubExternal (the random 2286px red build on
   * 2026-07-20 had the same cause). Offline mode makes the baseline take the
   * fallback path for icons every time, removing that variable.
   */
  offline?: boolean;
}): {
  get(iconName: string): Promise<string | null>;
} {
  const failed = new Set<string>();
  const fetchFn = deps.fetchImpl ?? fetch;
  // Per-session network budget: stops a compromised renderer from blowing
  // through memory/disk with a flood of names (final review F5). A normal
  // report needs far fewer icons than this; cache hits don't count against
  // the budget.
  const maxFetches = deps.maxFetchesPerSession ?? 512;
  let fetches = 0;

  return {
    async get(iconName: string): Promise<string | null> {
      // 83 of the 7710 generated icon base names are not plain identifiers:
      // Blizzard's own art files carry spaces, apostrophes and periods
      // ("spell_frost_ring of frost", "inv_misc_fork&knife"), and 7710 of them
      // are still a fixed whitelist that never sees user input. Rejecting those
      // characters silently cost every one of them its icon (Ring of Frost
      // rendered an empty placeholder while every other spell was fine).
      //
      // What must stay rejected is anything that could escape the cache dir:
      // path separators, traversal, NUL, and the URL/format metacharacters that
      // would corrupt the CDN URL. Spaces and trailing/leading whitespace are
      // tolerated because the upstream art names contain them.
      if (!/^[a-z0-9_ .&'()-]+$/i.test(iconName) || iconName.includes("..")) {
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

      // The offline check comes **after** the disk cache: already-cached
      // images stay usable (under E2E the cache directory is an empty temp
      // dir, so in practice everything takes the fallback), it just never
      // initiates a network request.
      if (deps.offline || fetches >= maxFetches) {
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
      } catch {
        failed.add(iconName);
        return null;
      }
    },
  };
}
