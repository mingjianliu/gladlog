type RaidBotsTalentData = RaidbotsTalentSpec[];

interface RaidbotsTalentSpec {
  traitTreeId: number;
  className: string;
  classId: number;
  specName: string;
  specId: number;
  classNodes: ClassNode[];
  heroNodes: HeroNode[];
  subTreeNodes: SubtreeNode[];
  specNodes: SpecNode[];
  fullNodeOrder: number[];
}

interface ClassNode {
  id: number;
  name: string;
  type: string;
  posX: number;
  posY: number;
  maxRanks: number;
  entryNode?: boolean;
  next: number[];
  prev: number[];
  entries: Entry[];
  freeNode?: boolean;
  reqPoints?: number;
}

interface HeroNode {
  id: number;
  name: string;
  type: string;
  posX: number;
  posY: number;
  maxRanks: number;
  entryNode?: boolean;
  subTreeId: number;
  requiresNode: number;
  next: number[];
  prev: number[];
  entries: Entry[];
  freeNode?: boolean;
}

interface SubtreeNode {
  id: number;
  name: string;
  type: string;
  posX: number;
  posY: number;
  entryNode?: boolean;
  next: number[];
  prev: number[];
  entries: SubtreeNodeEntry[];
}

interface Entry {
  id: number;
  definitionId: number;
  maxRanks: number;
  type: string;
  name: string;
  spellId: number;
  icon: string;
  index: number;
}

interface SubtreeNodeEntry {
  id: number;
  type: string;
  name: string;
  traitSubTreeId: number;
  traitTreeId: number;
  atlasMemberName: string;
  nodes: number[];
}

interface SpecNode {
  id: number;
  name: string;
  type: string;
  posX: number;
  posY: number;
  maxRanks: number;
  entryNode?: boolean;
  next: number[];
  prev: number[];
  entries: Entry2[];
  reqPoints?: number;
  freeNode?: boolean; // MANUAL EDIT ADDED THIS HERE
}

interface Entry2 {
  id: number;
  definitionId: number;
  maxRanks: number;
  type: string;
  name: string;
  spellId: number;
  icon: string;
  index: number;
}

type MappedRaidbotsSpec = RaidbotsTalentSpec & {
  specNodeMap: Record<number, SpecNode>;
  classNodeMap: Record<number, ClassNode>;
  subtreeNodeMap: Record<number, SubtreeNode>;
  heroNodeMap: Record<number, HeroNode>;
};

export const nodeMaps: Record<number, MappedRaidbotsSpec> = {};

// Loaded in the background rather than with a top-level await (same reason as
// spellEffectData.ts: TLA blocks first paint). nodeMaps keeps the same object
// identity and is filled in place once loading completes; consumers already
// have a degradation path (getTalentNames/getPlayerTalentedSpellInfo return
// empty for an undefined spec). Memoizing consumers must use
// talentDataReady() to avoid getting stuck on a cached empty-table result.
let talentDataLoaded = false;
export const talentDataReady = (): boolean => talentDataLoaded;
const talentLoad = import("./talentIdMap.json").then((mod) => {
  const talentIdMap = (mod.default ?? mod) as RaidBotsTalentData;
  fillNodeMaps(talentIdMap);
  talentDataLoaded = true;
});
export const ensureTalentData = (): Promise<void> => talentLoad;

function fillNodeMaps(talentIdMap: RaidBotsTalentData): void {
  talentIdMap.forEach((spec) => {
    nodeMaps[spec.specId] = {
      ...spec,
      classNodeMap: spec.classNodes.reduce(
        (prev, cur) => {
          prev[cur.id] = cur;
          return prev;
        },
        {} as Record<number, ClassNode>,
      ),
      specNodeMap: spec.specNodes.reduce(
        (prev, cur) => {
          prev[cur.id] = cur;
          return prev;
        },
        {} as Record<number, SpecNode>,
      ),
      heroNodeMap: spec.heroNodes.reduce(
        (prev, cur) => {
          prev[cur.id] = cur;
          return prev;
        },
        {} as Record<number, HeroNode>,
      ),
      subtreeNodeMap: spec.subTreeNodes.reduce(
        (prev, cur) => {
          prev[cur.id] = cur;
          return prev;
        },
        {} as Record<number, SubtreeNode>,
      ),
    };
  });
}

// local function MakeBase64ConversionTable()
// 	local base64ConversionTable = {};
// 	base64ConversionTable[0] = 'A';
// 	for num = 1, 25 do
// 		table.insert(base64ConversionTable, string.char(65 + num));
// 	end

// 	for num = 0, 25 do
// 		table.insert(base64ConversionTable, string.char(97 + num));
// 	end

// 	for num = 0, 9 do
// 		table.insert(base64ConversionTable, tostring(num));
// 	end

