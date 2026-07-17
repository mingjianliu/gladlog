export { aggregateCells, type Cell,type PerMatchRecord } from "./cellAggregator";
export {
  type DetailedMatchStub,
  type DetailedStubUnit,
  downloadLogText,
  fetchDetailedStubs,
  fetchMatchStubs,
  fetchWithRetry,
  type MatchStub,
} from "./feedClient";
export { buildPerMatchRecords,combatToRecords } from "./perMatchRecord";
