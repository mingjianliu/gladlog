export * from "./convert";
export * from "./enums";
export * from "./shim";
export * from "./types";

// Line-level parser API re-exported so `@gladlog/analysis` (which depends only
// on parser-compat, never on parser) can read raw.txt streams through the ONE
// implementation instead of the byte-for-byte mirrors it kept until 2026-09-26.
export {
  decodeAdvanced,
  parseTimestamp,
  splitLine,
  splitTopLevel,
} from "@gladlog/parser";
