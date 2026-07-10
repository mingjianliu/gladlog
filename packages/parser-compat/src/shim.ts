import { GladLogParser } from "@gladlog/parser";
import { toLegacyMatch, toLegacyShuffle } from "./convert";
import type { IArenaMatch, IShuffleMatch } from "./types";

export class WoWCombatLogParser {
  private parser: GladLogParser;
  private arenaMatchListeners: ((c: IArenaMatch) => void)[] = [];
  private soloShuffleListeners: ((m: IShuffleMatch) => void)[] = [];

  constructor(wowVersion: "retail" | string, timezone?: string) {
    this.parser = new GladLogParser({
      wowVersion: wowVersion === "retail" ? "retail" : undefined,
      timezone,
    });

    this.parser.on("match", (m) => {
      const legacyMatch = toLegacyMatch(m);
      for (const cb of this.arenaMatchListeners) {
        cb(legacyMatch);
      }
    });

    this.parser.on("shuffle", (s) => {
      const legacyShuffle = toLegacyShuffle(s);
      for (const cb of this.soloShuffleListeners) {
        cb(legacyShuffle);
      }
    });
  }

  public parseLine(raw: string): void {
    try {
      this.parser.push(raw);
    } catch {
      // Ensure any input does not throw
    }
  }

  public flush(): void {
    this.parser.end();
  }

  public on(event: "arena_match_ended", cb: (c: IArenaMatch) => void): this;
  public on(event: "solo_shuffle_ended", cb: (m: IShuffleMatch) => void): this;
  public on(event: "arena_match_ended" | "solo_shuffle_ended", cb: any): this {
    if (event === "arena_match_ended") {
      this.arenaMatchListeners.push(cb);
    } else if (event === "solo_shuffle_ended") {
      this.soloShuffleListeners.push(cb);
    }
    return this;
  }
}
