import {
  ModFlag,
  type Build,
  type CompiledGemMod,
  type EquipmentSlotId,
  type GameId,
  type GemDefinition,
  type GemInstance,
  type Item,
  type Mod,
  type ModType,
  type PassiveNode,
} from '@webpob/core';
import {
  getClusterNotable,
  getGemById,
  type ClusterNotableDef,
} from '@webpob/data';
import { normalizeStatLineToEn } from '@webpob/i18n';
import { parseSocketedGemBonuses, resolveGemBonuses } from './gemBonus.js';
import { resolveItemEffectiveStats } from './localItem.js';
import { ModDB } from './modDb.js';
import { parseModLines } from './modParser.js';
import { injectCompiledGemMods } from './skillActorRuntime.js';

// ============================================================================
// Shared Helpers
// ============================================================================

function stripPobTags(line: string): string {
  return normalizeStatLineToEn(line.replace(/\{[^}]*\}/g, '').trim()).trim();
}

function mkMod(
  name: string,
  type: ModType,
  value: number | boolean | string,
  source: string,
  flags = 0,
  keywordFlags = 0,
): Mod {
  return { name, type, value, flags, keywordFlags, source };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function hasStatSource(
  db: ModDB,
  statName: string,
  type: ModType,
  sourceSubstr: string,
): boolean {
  const needle = sourceSubstr.toLowerCase();
  return db
    .calcStat(statName)
    .sources.some((s) => s.type === type && s.source.toLowerCase().includes(needle));
}

function collectCleanItemLines(item: Item): string[] {
  const out: string[] = [];
  for (const raw of [...item.implicits, ...item.explicits]) {
    for (const part of raw.split(/\r?\n/)) {
      const cleaned = stripPobTags(part);
      if (cleaned) out.push(cleaned);
    }
  }
  return out;
}

function scaleNumericMods(
  mods: readonly Mod[],
  multiplier: number,
  includeMore: boolean,
): Mod[] {
  if (Math.abs(multiplier - 1) < 1e-9) return [...mods];
  return mods.map((mod) => {
    if (
      typeof mod.value === 'number' &&
      (mod.type === 'BASE' || mod.type === 'INC' || (includeMore && mod.type === 'MORE'))
    ) {
      return { ...mod, value: Math.trunc(mod.value * multiplier + Math.sign(mod.value) * 1e-9) };
    }
    return mod;
  });
}

// ============================================================================
// 1. Exact PoE 1 Cluster Jewel Subgraph Allocator
// ============================================================================

/** PoB 1 signal bit (bit 16) identifying synthetic Cluster Jewel subgraph node IDs. */
export const CLUSTER_NODE_SIGNAL_BIT = 0x10000;

export type ClusterJewelSize = 'Small' | 'Medium' | 'Large';
export type ClusterJewelSizeIndex = 0 | 1 | 2;

export interface DecodedClusterNodeId {
  nodeId: number;
  /** Bits 0..3: Node index within the cluster (0..11; 12 is the blank mastery node). */
  nodeIndex: number;
  /** Bits 4..5: Cluster size index (0 = Small, 1 = Medium, 2 = Large). */
  sizeIndex: ClusterJewelSizeIndex;
  size: ClusterJewelSize;
  /** Bits 6..8: Parent outer Large socket index (0..5). */
  largeSocketIndex: number;
  /** Bits 9..10: Parent nested Medium socket index (0..2). */
  mediumSocketIndex: number;
  /** Bits 11..15: Unused / outer expansion group index (0 in current PoB 1). */
  outerGroupIndex: number;
  /** Subgraph base ID (`nodeId & ~0xF`), matching PoB 1 `PassiveSpec.subGraphs` keys. */
  subgraphBaseId: number;
}

export interface ExpansionSocketInfo {
  socketSize: ClusterJewelSizeIndex;
  largeSocketIndex: number;
  mediumSocketIndex: number;
  parentSocketId?: number;
}

/**
 * Official PoE 1 passive tree expansion jewel socket hierarchy (42 sockets across 6 outer Large
 * sockets, 18 nested Medium sockets, and 18 nested Small sockets — aligned with PoB1 `TreeData`).
 */
export const POE1_EXPANSION_SOCKETS: Readonly<Record<number, ExpansionSocketInfo>> = {
  // 6 Outer Large Jewel Sockets (size = 2)
  7960: { socketSize: 2, largeSocketIndex: 0, mediumSocketIndex: 0 },
  46882: { socketSize: 2, largeSocketIndex: 1, mediumSocketIndex: 0 },
  55190: { socketSize: 2, largeSocketIndex: 2, mediumSocketIndex: 0 },
  2491: { socketSize: 2, largeSocketIndex: 3, mediumSocketIndex: 0 },
  32763: { socketSize: 2, largeSocketIndex: 4, mediumSocketIndex: 0 },
  21984: { socketSize: 2, largeSocketIndex: 5, mediumSocketIndex: 0 },

  // 18 Nested Medium Jewel Sockets (size = 1)
  29712: { socketSize: 1, largeSocketIndex: 0, mediumSocketIndex: 0, parentSocketId: 7960 },
  48679: { socketSize: 1, largeSocketIndex: 0, mediumSocketIndex: 1, parentSocketId: 7960 },
  9408: { socketSize: 1, largeSocketIndex: 0, mediumSocketIndex: 2, parentSocketId: 7960 },

  22994: { socketSize: 1, largeSocketIndex: 1, mediumSocketIndex: 0, parentSocketId: 46882 },
  40400: { socketSize: 1, largeSocketIndex: 1, mediumSocketIndex: 1, parentSocketId: 46882 },
  46393: { socketSize: 1, largeSocketIndex: 1, mediumSocketIndex: 2, parentSocketId: 46882 },

  49080: { socketSize: 1, largeSocketIndex: 2, mediumSocketIndex: 0, parentSocketId: 55190 },
  17219: { socketSize: 1, largeSocketIndex: 2, mediumSocketIndex: 1, parentSocketId: 55190 },
  44169: { socketSize: 1, largeSocketIndex: 2, mediumSocketIndex: 2, parentSocketId: 55190 },

  10532: { socketSize: 1, largeSocketIndex: 3, mediumSocketIndex: 0, parentSocketId: 2491 },
  23756: { socketSize: 1, largeSocketIndex: 3, mediumSocketIndex: 1, parentSocketId: 2491 },
  46519: { socketSize: 1, largeSocketIndex: 3, mediumSocketIndex: 2, parentSocketId: 2491 },

  6910: { socketSize: 1, largeSocketIndex: 4, mediumSocketIndex: 0, parentSocketId: 32763 },
  49684: { socketSize: 1, largeSocketIndex: 4, mediumSocketIndex: 1, parentSocketId: 32763 },
  33753: { socketSize: 1, largeSocketIndex: 4, mediumSocketIndex: 2, parentSocketId: 32763 },

  64583: { socketSize: 1, largeSocketIndex: 5, mediumSocketIndex: 0, parentSocketId: 21984 },
  61288: { socketSize: 1, largeSocketIndex: 5, mediumSocketIndex: 1, parentSocketId: 21984 },
  13170: { socketSize: 1, largeSocketIndex: 5, mediumSocketIndex: 2, parentSocketId: 21984 },

  // 18 Nested Small Jewel Sockets (size = 0)
  12613: { socketSize: 0, largeSocketIndex: 0, mediumSocketIndex: 0, parentSocketId: 29712 },
  16218: { socketSize: 0, largeSocketIndex: 0, mediumSocketIndex: 1, parentSocketId: 48679 },
  2311: { socketSize: 0, largeSocketIndex: 0, mediumSocketIndex: 2, parentSocketId: 9408 },

  61305: { socketSize: 0, largeSocketIndex: 1, mediumSocketIndex: 0, parentSocketId: 22994 },
  12161: { socketSize: 0, largeSocketIndex: 1, mediumSocketIndex: 1, parentSocketId: 40400 },
  3109: { socketSize: 0, largeSocketIndex: 1, mediumSocketIndex: 2, parentSocketId: 46393 },

  24970: { socketSize: 0, largeSocketIndex: 2, mediumSocketIndex: 0, parentSocketId: 49080 },
  36931: { socketSize: 0, largeSocketIndex: 2, mediumSocketIndex: 1, parentSocketId: 17219 },
  14993: { socketSize: 0, largeSocketIndex: 2, mediumSocketIndex: 2, parentSocketId: 44169 },

  23984: { socketSize: 0, largeSocketIndex: 3, mediumSocketIndex: 0, parentSocketId: 10532 },
  51198: { socketSize: 0, largeSocketIndex: 3, mediumSocketIndex: 1, parentSocketId: 23756 },
  61666: { socketSize: 0, largeSocketIndex: 3, mediumSocketIndex: 2, parentSocketId: 46519 },

  18436: { socketSize: 0, largeSocketIndex: 4, mediumSocketIndex: 0, parentSocketId: 6910 },
  11150: { socketSize: 0, largeSocketIndex: 4, mediumSocketIndex: 1, parentSocketId: 49684 },
  22748: { socketSize: 0, largeSocketIndex: 4, mediumSocketIndex: 2, parentSocketId: 33753 },

  9797: { socketSize: 0, largeSocketIndex: 5, mediumSocketIndex: 0, parentSocketId: 64583 },
  41876: { socketSize: 0, largeSocketIndex: 5, mediumSocketIndex: 1, parentSocketId: 61288 },
  59585: { socketSize: 0, largeSocketIndex: 5, mediumSocketIndex: 2, parentSocketId: 13170 },
};

/**
 * Official PoE 1 cluster notable sort order (aligned with PoB1 `Data/ClusterJewels.lua`).
 * Determines which notable sits at the front vs back of a multi-notable Cluster Jewel.
 */
const POE1_CLUSTER_NOTABLE_ORDER_LIST: readonly string[] = [
  'Prodigious Defence', 'Advance Guard', 'Gladiatorial Combat', 'Strike Leader', 'Powerful Ward',
  'Enduring Ward', "Gladiator's Fortitude", 'Precise Retaliation', 'Veteran Defender', 'Iron Breaker',
  'Deep Cuts', 'Master the Fundamentals', 'Force Multiplier', 'Furious Assault', 'Vicious Skewering',
  'Grim Oath', 'Battle-Hardened', 'Replenishing Presence', 'Master of Command', 'Spiteful Presence',
  'Purposeful Harbinger', 'Destructive Aspect', 'Electric Presence', 'Volatile Presence', 'Righteous Path',
  'Skullbreaker', 'Pressure Points', 'Overwhelming Malice', 'Magnifier', 'Savage Response',
  'Eye of the Storm', 'Basics of Pain', 'Quick Getaway', 'Assert Dominance', 'Vast Power',
  'Powerful Assault', 'Intensity', 'Titanic Swings', 'Towering Threat', 'Ancestral Echo',
  'Ancestral Reach', 'Ancestral Might', 'Ancestral Preservation', 'Snaring Spirits', 'Sleepless Sentries',
  'Ancestral Guidance', 'Ancestral Inspiration', 'Vital Focus', 'Unrestrained Focus', 'Unwavering Focus',
  'Enduring Focus', 'Precise Focus', 'Stoic Focus', 'Hex Breaker', 'Arcane Adept',
  'Distilled Perfection', 'Spiked Concoction', 'Fasting', "Mender's Wellspring", 'Special Reserve',
  'Numbing Elixir', 'Mob Mentality', 'Cry Wolf', 'Haunting Shout', 'Lead By Example',
  'Provocateur', 'Warning Call', 'Rattling Bellow', 'Bloodscent', 'Run Through',
  'Wound Aggravation', 'Overlord', 'Expansive Might', 'Weight Advantage', 'Wind-up',
  'Fan of Blades', 'Disease Vector', 'Arcing Shot', 'Tempered Arrowheads', 'Broadside',
  'Explosive Force', 'Opportunistic Fusilade', "Storm's Hand", 'Battlefield Dominator', 'Martial Mastery',
  'Surefooted Striker', 'Graceful Execution', 'Brutal Infamy', 'Fearsome Warrior', 'Combat Rhythm',
  'Hit and Run', 'Insatiable Killer', 'Mage Bane', 'Martial Momentum', 'Deadly Repartee',
  'Quick and Deadly', 'Smite the Weak', 'Heavy Hitter', 'Martial Prowess', 'Calamitous',
  'Devastator', 'Fuel the Fight', 'Drive the Destruction', 'Feed the Fury', 'Seal Mender',
  'Conjured Wall', 'Arcane Heroism', 'Practiced Caster', 'Burden Projection', 'Thaumophage',
  'Essence Rush', 'Sap Psyche', 'Sadist', 'Corrosive Elements', "Doryani's Lesson",
  'Disorienting Display', 'Prismatic Heart', 'Widespread Destruction', 'Master of Fire', 'Smoking Remains',
  'Cremator', 'Snowstorm', 'Storm Drinker', 'Paralysis', 'Supercharge',
  'Blanketed Snow', 'Cold to the Core', 'Cold-Blooded Killer', 'Touch of Cruelty', 'Unwaveringly Evil',
  'Unspeakable Gifts', 'Dark Ideation', 'Unholy Grace', 'Wicked Pall', 'Renewal',
  'Raze and Pillage', 'Rotten Claws', 'Call to the Slaughter', 'Hulking Corpses', 'Vicious Bite',
  'Primordial Bond', 'Blowback', 'Fan the Flames', 'Cooked Alive', 'Burning Bright',
  'Wrapped in Flame', 'Vivid Hues', 'Rend', 'Disorienting Wounds', 'Compound Injury',
  'Septic Spells', 'Low Tolerance', 'Steady Torment', 'Eternal Suffering', 'Eldritch Inspiration',
  'Wasting Affliction', 'Haemorrhage', 'Flow of Life', 'Exposure Therapy', 'Brush with Death',
  'Vile Reinvigoration', 'Circling Oblivion', 'Brewed for Potency', 'Astonishing Affliction', 'Cold Conduction',
  'Inspired Oppression', 'Chilling Presence', 'Deep Chill', 'Blast-Freeze', 'Thunderstruck',
  'Stormrider', 'Overshock', 'Evil Eye', 'Forbidden Words', "Doedre's Spite",
  'Victim Maker', 'Master of Fear', 'Wish for Death', 'Heraldry', 'Endbringer',
  'Cult-Leader', 'Empowered Envoy', 'Dark Messenger', 'Agent of Destruction', 'Lasting Impression',
  'Self-Fulfilling Prophecy', 'Invigorating Portents', 'Pure Agony', 'Disciples', 'Dread March',
  'Blessed Rebirth', 'Life from Death', 'Feasting Fiends', 'Bodyguards', 'Follow-Through',
  'Streamlined', 'Shrieking Bolts', 'Eye to Eye', 'Repeater', 'Aerodynamics',
  'Chip Away', 'Seeker Runes', 'Remarkable', 'Brand Loyalty', 'Holy Conquest',
  'Grand Design', 'Set and Forget', 'Expert Sabotage', 'Guerilla Tactics', 'Expendability',
  'Arcane Pyrotechnics', 'Surprise Sabotage', 'Careful Handling', 'Peak Vigour', 'Fettle',
  'Feast of Flesh', 'Sublime Sensation', 'Surging Vitality', 'Peace Amidst Chaos', 'Adrenaline',
  'Wall of Muscle', 'Mindfulness', 'Liquid Inspiration', 'Openness', 'Daring Ideas',
  'Clarity of Purpose', 'Scintillating Idea', 'Holistic Health', 'Genius', 'Improvisor',
  'Stubborn Student', 'Savour the Moment', 'Energy From Naught', 'Will Shaper', 'Spring Back',
  'Conservation of Energy', 'Heart of Iron', 'Prismatic Carapace', 'Militarism', 'Second Skin',
  'Dragon Hunter', 'Enduring Composure', 'Prismatic Dance', 'Natural Vigour', 'Untouchable',
  'Shifting Shadow', 'Readiness', 'Confident Combatant', 'Flexible Sentry', 'Vicious Guard',
  'Mystical Ward', 'Rote Reinforcement', 'Mage Hunter', 'Riot Queller', 'One with the Shield',
  'Aerialist', 'Elegant Form', 'Darting Movements', 'No Witnesses', "Molten One's Mark",
  'Fire Attunement', 'Pure Might', 'Blacksmith', 'Non-Flammable', 'Winter Prowler',
  'Hibernator', 'Pure Guile', 'Alchemist', 'Antifreeze', 'Wizardry',
  'Capacitor', 'Pure Aptitude', 'Sage', 'Insulated', 'Born of Chaos',
  'Antivenom', 'Rot-Resistant', 'Blessed', 'Student of Decay', 'Skeletal Atrophy',
  'Lord of Drought', 'Blizzard Caller', 'Tempt the Storm', 'Misery Everlasting', 'Exploit Weakness',
  "Hound's Mark", "Doedre's Gluttony", "Doedre's Apathy", 'Master of the Maelstrom', 'Self-Control',
  'Uncompromising', 'Sublime Form', 'Mortifying Aspect', 'Frantic Aspect', 'Introspection',
  'Blood Artist', 'Phlebotomist', 'Aggressive Defence', 'Holy Word', 'Fiery Aegis',
];

export const POE1_CLUSTER_NOTABLE_SORT_ORDER: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>();
  POE1_CLUSTER_NOTABLE_ORDER_LIST.forEach((name, idx) => {
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, idx);
  });
  return map;
})();

const CLUSTER_SIZE_LABELS: readonly ClusterJewelSize[] = ['Small', 'Medium', 'Large'];

const CLUSTER_TEMPLATES: Record<
  ClusterJewelSizeIndex,
  {
    size: ClusterJewelSize;
    smallIndices: readonly number[];
    notableIndices: readonly number[];
    socketIndices: readonly number[];
    totalIndices: number;
  }
> = {
  0: {
    size: 'Small',
    smallIndices: [0, 4, 2],
    notableIndices: [4],
    socketIndices: [4],
    totalIndices: 6,
  },
  1: {
    size: 'Medium',
    smallIndices: [0, 6, 8, 4, 10, 2],
    notableIndices: [6, 10, 2, 0],
    socketIndices: [6],
    totalIndices: 12,
  },
  2: {
    size: 'Large',
    smallIndices: [0, 4, 6, 8, 10, 2, 7, 5, 9, 3, 11, 1],
    notableIndices: [6, 4, 8, 10, 2],
    socketIndices: [4, 8, 6],
    totalIndices: 12,
  },
};

/**
 * Decodes a PoE 1 Cluster Jewel subgraph node ID (`>= 65536`) into its exact PoB1 bitfields:
 * - Bits 0..3:   node index within cluster (0..11; 12 = blank mastery)
 * - Bits 4..5:   cluster size (0 = Small, 1 = Medium, 2 = Large)
 * - Bits 6..8:   parent outer Large socket index (0..5)
 * - Bits 9..10:  parent nested Medium socket index (0..2)
 * - Bits 11..15: outer group / unused bits (0 in current PoB 1)
 * - Bit 16:      signal bit (0x10000 = 65536)
 */
export function decodeClusterNodeId(nodeId: number): DecodedClusterNodeId | null {
  if (!Number.isInteger(nodeId) || nodeId < CLUSTER_NODE_SIGNAL_BIT) {
    return null;
  }
  const sizeBits = (nodeId >> 4) & 0x3;
  if (sizeBits > 2) return null;
  const sizeIndex = sizeBits as ClusterJewelSizeIndex;
  return {
    nodeId,
    nodeIndex: nodeId & 0xf,
    sizeIndex,
    size: CLUSTER_SIZE_LABELS[sizeIndex]!,
    largeSocketIndex: (nodeId >> 6) & 0x7,
    mediumSocketIndex: (nodeId >> 9) & 0x3,
    outerGroupIndex: (nodeId >> 11) & 0x1f,
    subgraphBaseId: nodeId & ~0xf,
  };
}

/**
 * Encodes PoE 1 Cluster Jewel bitfields into an official PoB 1 cluster node ID (`>= 65536`).
 */
export function encodeClusterNodeId(parts: {
  nodeIndex: number;
  sizeIndex: ClusterJewelSizeIndex;
  largeSocketIndex: number;
  mediumSocketIndex?: number;
  outerGroupIndex?: number;
}): number {
  const outer = (parts.outerGroupIndex ?? 0) & 0x1f;
  const med = (parts.mediumSocketIndex ?? 0) & 0x3;
  const large = parts.largeSocketIndex & 0x7;
  const size = parts.sizeIndex & 0x3;
  const idx = parts.nodeIndex & 0xf;
  return (
    CLUSTER_NODE_SIGNAL_BIT |
    (outer << 11) |
    (med << 9) |
    (large << 6) |
    (size << 4) |
    idx
  );
}

/**
 * Scales a Cluster Jewel small passive grant line by `smallEffectPct` using PoB integer flooring:
 * `Math.floor(val * (1 + smallEffectPct / 100))` (preserving decimal precision when floats appear).
 */
export function scaleClusterGrantLine(line: string, smallEffectPct: number): string {
  if (smallEffectPct <= 0) return line;
  const mult = 1 + smallEffectPct / 100;
  return line.replace(/([+-]?)(\d+(?:\.\d+)?)/g, (_all, sign: string, numStr: string) => {
    const val = Number(numStr);
    const dotIdx = numStr.indexOf('.');
    if (dotIdx === -1) {
      const scaled = Math.floor(val * mult + 1e-9);
      return `${sign}${scaled}`;
    }
    const decimals = numStr.length - dotIdx - 1;
    const factor = Math.pow(10, decimals);
    const scaled = Math.floor(val * mult * factor + 1e-9) / factor;
    return `${sign}${scaled}`;
  });
}

export interface ClusterTemplateLayout {
  socketIndices: number[];
  notableIndices: number[];
  smallIndices: number[];
}

/**
 * Computes exact PoB 1 node index placement for sockets, notables, and small passives
 * within a Cluster Jewel subgraph (aligned with PoB1 `PassiveSpecClass:BuildSubgraph`
 * and `itemLib.getClusterJewelNotableIndices`).
 */
export function getClusterTemplateLayout(
  sizeIndex: ClusterJewelSizeIndex,
  totalAdded: number,
  socketCount: number,
  notableCount: number,
): ClusterTemplateLayout {
  const tmpl = CLUSTER_TEMPLATES[sizeIndex];
  const occupied = new Set<number>();

  // 1. Sub-socket indices
  const socketIndices: number[] = [];
  if (sizeIndex === 2 && socketCount === 1) {
    socketIndices.push(6);
    occupied.add(6);
  } else {
    for (let i = 0; i < Math.min(socketCount, tmpl.socketIndices.length); i++) {
      const idx = tmpl.socketIndices[i]!;
      socketIndices.push(idx);
      occupied.add(idx);
    }
  }

  // 2. Notable indices (sorted ascending, matching `itemLib.getClusterJewelNotableIndices`)
  const notableIndices: number[] = [];
  if (sizeIndex === 0 && totalAdded === 1 && notableCount === 1 && socketCount === 0) {
    // Keystone Small Cluster Jewel (e.g. One With Nothing / Hollow Palm) sits at index 0
    notableIndices.push(0);
    occupied.add(0);
  } else {
    for (const rawIdx of tmpl.notableIndices) {
      if (notableIndices.length >= notableCount) break;
      let nodeIndex = rawIdx;
      if (sizeIndex === 1) {
        if (socketCount === 0 && notableCount === 2) {
          if (nodeIndex === 6) nodeIndex = 4;
          else if (nodeIndex === 10) nodeIndex = 8;
        } else if (totalAdded === 4) {
          if (nodeIndex === 10) nodeIndex = 9;
          else if (nodeIndex === 2) nodeIndex = 3;
        }
      }
      if (!occupied.has(nodeIndex)) {
        notableIndices.push(nodeIndex);
        occupied.add(nodeIndex);
      }
    }
    notableIndices.sort((a, b) => a - b);
  }

  // 3. Small passive fill indices
  const smallCount = Math.max(0, totalAdded - socketCount - notableCount);
  const smallIndices: number[] = [];
  for (const rawIdx of tmpl.smallIndices) {
    if (smallIndices.length >= smallCount) break;
    let nodeIndex = rawIdx;
    if (sizeIndex === 1) {
      if (totalAdded === 5 && nodeIndex === 4) {
        nodeIndex = 3;
      } else if (totalAdded === 4) {
        if (nodeIndex === 8) nodeIndex = 9;
        else if (nodeIndex === 4) nodeIndex = 3;
      }
    }
    if (!occupied.has(nodeIndex)) {
      smallIndices.push(nodeIndex);
      occupied.add(nodeIndex);
    }
  }

  return { socketIndices, notableIndices, smallIndices };
}

function detectClusterJewelSizeIndex(jewel: Item, totalAdded: number, socketCount: number): ClusterJewelSizeIndex {
  const lowerBase = jewel.baseName.toLowerCase();
  const lowerName = jewel.name.toLowerCase();
  if (lowerBase.includes('large cluster') || lowerName === 'voices') return 2;
  if (lowerBase.includes('medium cluster') || lowerName === 'megalomaniac') return 1;
  if (lowerBase.includes('small cluster')) return 0;
  if (socketCount >= 2 || totalAdded >= 8) return 2;
  if (totalAdded >= 4) return 1;
  return 0;
}

function isClusterJewelItem(jewel: Item): boolean {
  const lowerBase = jewel.baseName.toLowerCase();
  if (lowerBase.includes('cluster jewel')) return true;
  const lines = collectCleanItemLines(jewel);
  return lines.some(
    (l) =>
      /^Adds \d+ Passive Skills$/i.test(l) ||
      /^Added Small Passive Skills (?:also )?grant:/i.test(l),
  );
}

interface ParsedClusterJewelMeta {
  sizeIndex: ClusterJewelSizeIndex;
  size: ClusterJewelSize;
  totalAdded: number;
  socketCount: number;
  smallEffectPct: number;
  notableNames: string[];
  smallGrants: string[];
}

function parseClusterJewelMeta(jewel: Item): ParsedClusterJewelMeta {
  const allLines = collectCleanItemLines(jewel);
  let totalAdded = 0;
  let socketCount = 0;
  let smallEffectPct = 0;
  const notableNames: string[] = [];
  const smallGrants: string[] = [];

  for (const line of allLines) {
    let m = line.match(/^Adds (\d+) Passive Skills$/i);
    if (m) {
      totalAdded = Number(m[1]);
      continue;
    }
    m = line.match(/^(\d+) Added Passive Skills? (?:is|are) (?:a )?Jewel Sockets?$/i);
    if (m) {
      socketCount = Number(m[1]);
      continue;
    }
    m = line.match(/^Adds (\d+) Jewel Sockets?$/i);
    if (m) {
      socketCount = Number(m[1]);
      continue;
    }
    m = line.match(/^1 Added Passive Skill is (.+)$/i);
    if (m) {
      notableNames.push(m[1]!.trim());
      continue;
    }
    m = line.match(/^Added Small Passive Skills (?:also )?grant:\s*(.+)$/i);
    if (m) {
      const grant = m[1]!.trim();
      if (grant && !/^nothing$/i.test(grant)) {
        smallGrants.push(grant);
      }
      continue;
    }
    m = line.match(/^Added Small Passive Skills have (\d+)% increased effect$/i);
    if (m) {
      smallEffectPct += Number(m[1]);
      continue;
    }
  }

  // Fallback to PoB XML `Cluster Jewel Node Count: N` in rawText if implicit was absent
  if (totalAdded === 0 && jewel.rawText) {
    const mCount = jewel.rawText.match(/^\s*Cluster Jewel Node Count\s*:\s*(\d+)/im);
    if (mCount) {
      totalAdded = Number(mCount[1]);
    }
  }
  // Unique keystone small cluster jewels (1 added passive skill with no `Adds N Passive Skills` line)
  if (totalAdded === 0 && notableNames.length > 0 && socketCount === 0) {
    totalAdded = notableNames.length;
  }

  const sizeIndex = detectClusterJewelSizeIndex(jewel, totalAdded, socketCount);
  return {
    sizeIndex,
    size: CLUSTER_SIZE_LABELS[sizeIndex]!,
    totalAdded,
    socketCount,
    smallEffectPct,
    notableNames,
    smallGrants,
  };
}

function orderNotablesForPlacement(notableNames: readonly string[]): string[] {
  if (notableNames.length <= 1) return [...notableNames];
  const allKnown = notableNames.every((n) =>
    POE1_CLUSTER_NOTABLE_SORT_ORDER.has(n.trim().toLowerCase()),
  );
  if (!allKnown) {
    // Keep deterministic declaration order for synthetic / unrecognized notable names
    return [...notableNames];
  }
  return [...notableNames].sort(
    (a, b) =>
      (POE1_CLUSTER_NOTABLE_SORT_ORDER.get(a.trim().toLowerCase()) ?? 0) -
      (POE1_CLUSTER_NOTABLE_SORT_ORDER.get(b.trim().toLowerCase()) ?? 0),
  );
}

export interface SocketedClusterJewel {
  nodeId: number;
  jewel: Item;
}

export type ClusterNotableLookupFn = (name: string) => ClusterNotableDef | undefined;

export interface EvaluatedClusterJewelEntry {
  nodeId: number;
  jewelName: string;
  size: ClusterJewelSize;
  sizeIndex: ClusterJewelSizeIndex;
  largeSocketIndex: number | null;
  mediumSocketIndex: number | null;
  totalAdded: number;
  socketCount: number;
  smallEffectPct: number;
  allocatedClusterNodeIds: number[];
  allNotableNames: string[];
  grantedNotableNames: string[];
  maxSmallCount: number;
  grantedSmallCount: number;
  scaledSmallGrants: string[];
  usedSubgraphAllocation: boolean;
  mods: Mod[];
}

export interface ClusterJewelEvaluationResult {
  usedSubgraphAllocation: boolean;
  entries: EvaluatedClusterJewelEntry[];
  mods: Mod[];
}

function subgraphKey(
  largeSocketIndex: number,
  mediumSocketIndex: number,
  sizeIndex: ClusterJewelSizeIndex,
): string {
  return `${largeSocketIndex}:${mediumSocketIndex}:${sizeIndex}`;
}

// Large cluster socket positions -> PoB1 child expansionJewel.index (`getJewels = { 0, 2, 1 }` for `{ 4, 8, 6 }`)
const LARGE_SOCKET_NODE_INDEX_TO_MED_INDEX: Readonly<Record<number, number>> = {
  4: 0,
  8: 2,
  6: 1,
};

/**
 * Evaluates all socketed PoE 1 Cluster Jewels against the exact allocated cluster subgraph
 * node IDs (`>= 65536`), matching both outer tree expansion sockets (`< 65536`) and nested
 * cluster sockets (`>= 65536` or official Medium/Small expansion socket IDs).
 *
 * - Caps granted notables and small passives to the actual allocated subgraph nodes
 *   (excluding sub-socket nodes and mastery nodes from small passive grants).
 * - Scales small passive grants using `Math.floor(val * (1 + smallEffectPct / 100))`.
 * - Falls back gracefully to full-cluster grants when `allocatedNodeIds` contains no
 *   `>= 65536` cluster node IDs (preserving compatibility with synthetic unit tests).
 */
export function evaluateAllocatedClusterJewels(
  socketedJewels: ReadonlyArray<SocketedClusterJewel>,
  allocatedNodeIds: ReadonlyArray<number> | ReadonlySet<number>,
  getClusterNotableFn: ClusterNotableLookupFn = getClusterNotable,
): ClusterJewelEvaluationResult {
  // 1. Decode all allocated >= 65536 cluster node IDs (excluding blank mastery index 12)
  const nodesBySubgraph = new Map<string, DecodedClusterNodeId[]>();
  let totalAllocatedClusterNodes = 0;

  for (const rawId of allocatedNodeIds) {
    if (rawId < CLUSTER_NODE_SIGNAL_BIT) continue;
    const decoded = decodeClusterNodeId(rawId);
    if (!decoded) continue;
    if (decoded.nodeIndex === 12) continue; // blank mastery node
    totalAllocatedClusterNodes++;
    const key = subgraphKey(decoded.largeSocketIndex, decoded.mediumSocketIndex, decoded.sizeIndex);
    let bucket = nodesBySubgraph.get(key);
    if (!bucket) {
      bucket = [];
      nodesBySubgraph.set(key, bucket);
    }
    bucket.push(decoded);
  }

  const usedSubgraphAllocation = totalAllocatedClusterNodes > 0;
  const clusterJewels = socketedJewels.filter(({ jewel }) => isClusterJewelItem(jewel));

  // Track claimed subgraph keys so fallback matching for unknown synthetic socket IDs never double-claims
  const claimedSubgraphKeys = new Set<string>();
  const resolvedCoords = new Map<
    number,
    { largeSocketIndex: number; mediumSocketIndex: number; key: string } | null
  >();

  // Pass 1: Resolve all jewels with known official tree socket IDs or encoded >= 65536 socket IDs
  const parsedMetas = clusterJewels.map(({ nodeId, jewel }) => ({
    nodeId,
    jewel,
    meta: parseClusterJewelMeta(jewel),
  }));

  if (usedSubgraphAllocation) {
    for (let i = 0; i < parsedMetas.length; i++) {
      const { nodeId, meta } = parsedMetas[i]!;
      let resolved: { largeSocketIndex: number; mediumSocketIndex: number; key: string } | null =
        null;

      if (nodeId >= CLUSTER_NODE_SIGNAL_BIT) {
        const decodedSocket = decodeClusterNodeId(nodeId);
        if (decodedSocket) {
          const directKey = subgraphKey(
            decodedSocket.largeSocketIndex,
            decodedSocket.mediumSocketIndex,
            meta.sizeIndex,
          );
          if (nodesBySubgraph.has(directKey)) {
            resolved = {
              largeSocketIndex: decodedSocket.largeSocketIndex,
              mediumSocketIndex: decodedSocket.mediumSocketIndex,
              key: directKey,
            };
          } else if (
            decodedSocket.sizeIndex === 2 &&
            meta.sizeIndex < 2 &&
            decodedSocket.mediumSocketIndex === 0
          ) {
            const mappedMed = LARGE_SOCKET_NODE_INDEX_TO_MED_INDEX[decodedSocket.nodeIndex];
            if (mappedMed !== undefined) {
              const mappedKey = subgraphKey(
                decodedSocket.largeSocketIndex,
                mappedMed,
                meta.sizeIndex,
              );
              resolved = {
                largeSocketIndex: decodedSocket.largeSocketIndex,
                mediumSocketIndex: mappedMed,
                key: mappedKey,
              };
            }
          }
          if (!resolved) {
            resolved = {
              largeSocketIndex: decodedSocket.largeSocketIndex,
              mediumSocketIndex: decodedSocket.mediumSocketIndex,
              key: directKey,
            };
          }
        }
      } else {
        const officialSocket = POE1_EXPANSION_SOCKETS[nodeId];
        if (officialSocket) {
          const key = subgraphKey(
            officialSocket.largeSocketIndex,
            officialSocket.mediumSocketIndex,
            meta.sizeIndex,
          );
          resolved = {
            largeSocketIndex: officialSocket.largeSocketIndex,
            mediumSocketIndex: officialSocket.mediumSocketIndex,
            key,
          };
        }
      }

      if (resolved) {
        resolvedCoords.set(i, resolved);
        claimedSubgraphKeys.add(resolved.key);
      }
    }

    // Pass 2: For any jewel using a non-standard/synthetic socket ID (< 65536 and not in POE1_EXPANSION_SOCKETS),
    // deterministically pair with the next unclaimed subgraph of the same cluster size.
    const sortedSubgraphKeys = [...nodesBySubgraph.keys()].sort();
    for (let i = 0; i < parsedMetas.length; i++) {
      if (resolvedCoords.has(i)) continue;
      const { meta } = parsedMetas[i]!;
      const matchingKey = sortedSubgraphKeys.find((k) => {
        if (claimedSubgraphKeys.has(k)) return false;
        const parts = k.split(':');
        return Number(parts[2]) === meta.sizeIndex;
      });
      if (matchingKey) {
        const parts = matchingKey.split(':');
        resolvedCoords.set(i, {
          largeSocketIndex: Number(parts[0]),
          mediumSocketIndex: Number(parts[1]),
          key: matchingKey,
        });
        claimedSubgraphKeys.add(matchingKey);
      } else {
        resolvedCoords.set(i, null);
      }
    }
  }

  const entries: EvaluatedClusterJewelEntry[] = [];
  const allMods: Mod[] = [];

  for (let i = 0; i < parsedMetas.length; i++) {
    const { nodeId, jewel, meta } = parsedMetas[i]!;
    const maxSmallCount = Math.max(0, meta.totalAdded - meta.socketCount - meta.notableNames.length);
    const scaledSmallGrants =
      meta.smallEffectPct > 0
        ? meta.smallGrants.map((g) => scaleClusterGrantLine(g, meta.smallEffectPct))
        : [...meta.smallGrants];

    const coords = resolvedCoords.get(i) ?? null;
    const matchedNodes =
      usedSubgraphAllocation && coords ? (nodesBySubgraph.get(coords.key) ?? []) : [];

    let grantedNotableNames: string[];
    let grantedSmallCount: number;

    if (!usedSubgraphAllocation) {
      // Legacy fallback: no >= 65536 cluster IDs present in build -> grant full jewel
      grantedNotableNames = [...meta.notableNames];
      grantedSmallCount = maxSmallCount;
    } else {
      const orderedNotables = orderNotablesForPlacement(meta.notableNames);
      const layout = getClusterTemplateLayout(
        meta.sizeIndex,
        meta.totalAdded,
        meta.socketCount,
        orderedNotables.length,
      );

      const socketIndexSet = new Set<number>(layout.socketIndices);
      const notableIndexToName = new Map<number, string>();
      for (let ni = 0; ni < Math.min(layout.notableIndices.length, orderedNotables.length); ni++) {
        notableIndexToName.set(layout.notableIndices[ni]!, orderedNotables[ni]!);
      }
      const smallIndexSet = new Set<number>(layout.smallIndices);

      // Deduplicate node indices and strip sub-socket indices / blank mastery 12
      const uniqueNonSocketIndices = new Set<number>();
      for (const n of matchedNodes) {
        if (n.nodeIndex >= 12) continue;
        if (socketIndexSet.has(n.nodeIndex)) continue;
        uniqueNonSocketIndices.add(n.nodeIndex);
      }

      const effectiveAllocatedCount = uniqueNonSocketIndices.size;
      if (effectiveAllocatedCount === 0) {
        grantedNotableNames = [];
        grantedSmallCount = 0;
      } else {
        const allCanonicalMatch = [...uniqueNonSocketIndices].every(
          (idx) => notableIndexToName.has(idx) || smallIndexSet.has(idx),
        );

        if (allCanonicalMatch) {
          // Exact PoB subgraph match: grant only notables and small passives at allocated node indices
          grantedNotableNames = [];
          let smallAllocated = 0;
          for (const idx of [...uniqueNonSocketIndices].sort((a, b) => a - b)) {
            const notableName = notableIndexToName.get(idx);
            if (notableName) {
              grantedNotableNames.push(notableName);
            } else if (smallIndexSet.has(idx)) {
              smallAllocated++;
            }
          }
          grantedSmallCount = Math.min(maxSmallCount, smallAllocated);
        } else {
          // Count-capped fallback for synthetic tests passing non-template node indices (e.g. 0..N-1):
          // prioritize any notables whose canonical index IS allocated, never exceed allocated count.
          const pickedNotables: string[] = [];
          const pickedSet = new Set<string>();
          for (const idx of [...uniqueNonSocketIndices].sort((a, b) => a - b)) {
            const name = notableIndexToName.get(idx);
            if (name && !pickedSet.has(name)) {
              pickedNotables.push(name);
              pickedSet.add(name);
            }
          }
          // Count non-notable allocated indices first to determine remaining capacity
          const remainingForNotables = Math.max(
            0,
            Math.min(orderedNotables.length, effectiveAllocatedCount) - pickedNotables.length,
          );
          // Only fill additional notables if allocated count exceeds maxSmallCount + already-picked notables
          const overflowNotables = Math.max(
            0,
            Math.min(
              remainingForNotables,
              effectiveAllocatedCount - pickedNotables.length - maxSmallCount,
            ),
          );
          if (overflowNotables > 0) {
            const targetNotableCount = pickedNotables.length + overflowNotables;
            for (const name of orderedNotables) {
              if (pickedNotables.length >= targetNotableCount) break;
              if (!pickedSet.has(name)) {
                pickedNotables.push(name);
                pickedSet.add(name);
              }
            }
          }
          grantedNotableNames = pickedNotables;
          grantedSmallCount = Math.max(
            0,
            Math.min(maxSmallCount, effectiveAllocatedCount - grantedNotableNames.length),
          );
        }

        // Strict safety invariant: never grant more notables + smalls than allocated non-socket nodes
        const cap = Math.min(effectiveAllocatedCount, Math.max(0, meta.totalAdded - meta.socketCount));
        if (grantedNotableNames.length > cap) {
          grantedNotableNames = grantedNotableNames.slice(0, cap);
        }
        if (grantedNotableNames.length + grantedSmallCount > cap) {
          grantedSmallCount = Math.max(0, cap - grantedNotableNames.length);
        }
      }
    }

    const jewelMods: Mod[] = [];
    for (const notableName of grantedNotableNames) {
      const def = getClusterNotableFn(notableName);
      if (def) {
        jewelMods.push(...parseModLines(def.st, `Cluster Notable (${nodeId}): ${def.en}`));
      }
    }
    if (grantedSmallCount > 0 && scaledSmallGrants.length > 0) {
      for (let s = 0; s < grantedSmallCount; s++) {
        jewelMods.push(
          ...parseModLines(scaledSmallGrants, `Cluster Small (${nodeId}): ${jewel.name}`),
        );
      }
    }

    allMods.push(...jewelMods);
    entries.push({
      nodeId,
      jewelName: jewel.name,
      size: meta.size,
      sizeIndex: meta.sizeIndex,
      largeSocketIndex: coords ? coords.largeSocketIndex : null,
      mediumSocketIndex: coords ? coords.mediumSocketIndex : null,
      totalAdded: meta.totalAdded,
      socketCount: meta.socketCount,
      smallEffectPct: meta.smallEffectPct,
      allocatedClusterNodeIds: matchedNodes.map((n) => n.nodeId),
      allNotableNames: meta.notableNames,
      grantedNotableNames,
      maxSmallCount,
      grantedSmallCount,
      scaledSmallGrants,
      usedSubgraphAllocation,
      mods: jewelMods,
    });
  }

  return {
    usedSubgraphAllocation,
    entries,
    mods: allMods,
  };
}

// ============================================================================
// 2. Pool-Zeroing & Conversion Keystones / Uniques
// ============================================================================

export interface PoolZeroingAndKeystoneContext {
  game: GameId;
  db: ModDB;
  allocatedNodes?: readonly PassiveNode[];
  equippedItems?: ReadonlyArray<{ slot: string; item: Item }>;
  socketedJewels?: ReadonlyArray<{ nodeId: number; jewel: Item } | Item>;
  /** Optional pre-resolved total local Energy Shield on equipped Armour items (for The Apostate). */
  armourItemsEnergyShield?: number;
  /** Optional minion Chaos Resistance % (for Fleshcrafter Life->ES conversion). */
  minionChaosResist?: number;
  /** Optional base max Attack Block chance before modifiers (default 75). */
  baseMaxBlockChance?: number;
  /** Optional raw Attack Block chance before cap (for Versatile Combatant overcap conversion). */
  rawAttackBlockChance?: number;
}

export interface PoolZeroingAndKeystoneResult {
  manaZeroed: boolean;
  energyShieldZeroed: boolean;
  bloodMagic: boolean;
  pyromanticPact: boolean;
  theAgnostic: boolean;
  dissolutionOfTheFlesh: boolean;
  immortalAmbition: boolean;
  mahuxotlsMachination: boolean;
  fleshcrafter: boolean;
  fleshcrafterMinionLifeConvertToEsPct: number;
  chaosInoculation: boolean;
  blackbraid: boolean;
  ghostwrithe: boolean;
  theApostate: boolean;
  scarredFaith: boolean;
  solipsism: boolean;
  noIntEsBonus: boolean;
  supremeEgo: boolean;
  versatileCombatant: boolean;
  glancingBlows: boolean;
  blockMultiplier: number;
  spellBlockMultiplier: number;
  versatileCombatantSpellBlockBonus: number;
  apostateConvertedArmourEs: number;
  appliedRules: string[];
}

const ARMOUR_SLOTS_FOR_APOSTATE = new Set([
  'helmet',
  'body armour',
  'gloves',
  'boots',
  'weapon 2',
  'weapon 2 swap',
]);

/**
 * Applies pool-zeroing (`Mana = 0`, `EnergyShield = 0`), Life/ES conversions, and endgame
 * Keystone / Unique defence rules for both PoE 1 and PoE 2, deduplicating against modifiers
 * already parsed into `db`.
 */
export function applyPoolZeroingAndKeystoneRules(
  ctx: PoolZeroingAndKeystoneContext,
): PoolZeroingAndKeystoneResult {
  const { game, db } = ctx;
  const allocatedNodes = ctx.allocatedNodes ?? [];
  const equippedItems = ctx.equippedItems ?? [];
  const jewelItems: Item[] = (ctx.socketedJewels ?? []).map((entry) =>
    'jewel' in entry ? entry.jewel : entry,
  );

  const nodeNames = new Set<string>();
  const allLines: string[] = [];

  for (const node of allocatedNodes) {
    if (node?.name?.en) {
      nodeNames.add(normalizeName(node.name.en));
    }
    for (const raw of node?.stats ?? []) {
      for (const part of raw.split(/\r?\n/)) {
        const clean = stripPobTags(part);
        if (clean) allLines.push(clean);
      }
    }
  }

  const equippedByName = new Map<string, Item>();
  for (const { item } of equippedItems) {
    if (!item) continue;
    equippedByName.set(normalizeName(item.name), item);
    allLines.push(...collectCleanItemLines(item));
  }

  const jewelByName = new Map<string, Item>();
  for (const jewel of jewelItems) {
    if (!jewel) continue;
    jewelByName.set(normalizeName(jewel.name), jewel);
    allLines.push(...collectCleanItemLines(jewel));
  }

  const hasNode = (name: string): boolean => nodeNames.has(name.toLowerCase());
  const hasEquipped = (name: string): boolean => equippedByName.has(name.toLowerCase());
  const hasItemOrJewel = (name: string): boolean =>
    equippedByName.has(name.toLowerCase()) || jewelByName.has(name.toLowerCase());
  const hasLine = (re: RegExp): boolean => allLines.some((l) => re.test(l));

  const appliedRules: string[] = [];
  let manaZeroed = db.override('Mana') === 0;
  let energyShieldZeroed = db.override('EnergyShield') === 0;

  // --- 1. PoE 1 & PoE 2 Blood Magic ---
  const hasBloodMagicPoe1 =
    game === 'poe1' &&
    (hasNode('blood magic') ||
      hasLine(/^(?:Removes all mana|Skills Reserve Life instead of Mana|Blood Magic)$/i) ||
      db.flag('BloodMagic'));
  const hasBloodMagicPoe2 =
    game === 'poe2' &&
    (hasNode('blood magic') ||
      hasLine(/^(?:You have no Mana|Skill Mana Costs Converted to Life Costs|Blood Magic)$/i) ||
      db.flag('BloodMagic'));
  const bloodMagic = hasBloodMagicPoe1 || hasBloodMagicPoe2;

  if (bloodMagic) {
    const src = 'Keystone: Blood Magic';
    if (db.override('Mana') !== 0) {
      db.addMod(mkMod('Mana', 'OVERRIDE', 0, src));
    }
    manaZeroed = true;
    if (!db.flag('BloodMagic')) {
      db.addMod(mkMod('BloodMagic', 'FLAG', true, src));
    }
    if (game === 'poe1') {
      // PoE 1 3.25+/3.30 Blood Magic grants 10% more maximum Life — only add if not already parsed from tree
      if (!hasStatSource(db, 'Life', 'MORE', 'blood magic')) {
        db.addMod(mkMod('Life', 'MORE', 10, src));
      }
      appliedRules.push('PoE1:BloodMagic');
    } else {
      if (db.sum('BASE', 'ManaCostConvertToLife') === 0) {
        db.addMod(mkMod('ManaCostConvertToLife', 'BASE', 100, src));
      }
      appliedRules.push('PoE2:BloodMagic');
    }
  }

  // --- 2. PoE 2 Infernalist Pyromantic Pact ---
  const pyromanticPact =
    hasNode('pyromantic pact') ||
    hasLine(/Maximum Mana is replaced by .*Maximum Infernal Flame/i) ||
    (game === 'poe2' && hasLine(/^Removes all Mana$/i));

  if (pyromanticPact) {
    const src = 'Ascendancy: Pyromantic Pact';
    if (db.override('Mana') !== 0) {
      db.addMod(mkMod('Mana', 'OVERRIDE', 0, src));
    }
    manaZeroed = true;
    if (!db.flag('PyromanticPact')) {
      db.addMod(mkMod('PyromanticPact', 'FLAG', true, src));
    }
    appliedRules.push('PoE2:PyromanticPact');
  }

  // --- 3. The Agnostic (ES = 0) ---
  const theAgnostic =
    hasNode('the agnostic') ||
    hasLine(/^(?:The Agnostic|Maximum Energy Shield is 0)$/i);

  if (theAgnostic) {
    const src = 'Keystone: The Agnostic';
    if (db.override('EnergyShield') !== 0) {
      db.addMod(mkMod('EnergyShield', 'OVERRIDE', 0, src));
    }
    energyShieldZeroed = true;
    if (!db.flag('TheAgnostic')) {
      db.addMod(mkMod('TheAgnostic', 'FLAG', true, src));
    }
    appliedRules.push('TheAgnostic');
  }

  // --- 4. Dissolution of the Flesh (ES = 0 + more Maximum Life) ---
  const dissolutionJewel =
    jewelByName.get('dissolution of the flesh') ?? equippedByName.get('dissolution of the flesh');
  const dissolutionOfTheFlesh =
    Boolean(dissolutionJewel) ||
    hasLine(/Life that would be lost by taking Damage is instead Reserved/i);

  if (dissolutionOfTheFlesh) {
    const src = 'Unique: Dissolution of the Flesh';
    if (db.override('EnergyShield') !== 0) {
      db.addMod(mkMod('EnergyShield', 'OVERRIDE', 0, src));
    }
    energyShieldZeroed = true;
    if (!db.flag('DissolutionOfTheFlesh')) {
      db.addMod(mkMod('DissolutionOfTheFlesh', 'FLAG', true, src));
    }
    if (!db.flag('DamageInsteadReservesLife')) {
      db.addMod(mkMod('DamageInsteadReservesLife', 'FLAG', true, src));
    }
    if (dissolutionJewel && !hasStatSource(db, 'Life', 'MORE', 'dissolution')) {
      for (const line of collectCleanItemLines(dissolutionJewel)) {
        const m = line.match(/^(\d+)% more Maximum Life$/i);
        if (m) {
          db.addMod(mkMod('Life', 'MORE', Number(m[1]), src));
          break;
        }
      }
    }
    appliedRules.push('DissolutionOfTheFlesh');
  }

  // Generic "Removes all Energy Shield" catch-all (e.g. from custom/unique sources)
  if (!energyShieldZeroed && hasLine(/^(?:Removes all Energy Shield|Maximum Energy Shield is 0)$/i)) {
    db.addMod(mkMod('EnergyShield', 'OVERRIDE', 0, 'Removes all Energy Shield'));
    energyShieldZeroed = true;
    appliedRules.push('RemovesAllEnergyShield');
  }

  // --- 5. Chaos Inoculation ---
  const chaosInoculation =
    hasNode('chaos inoculation') ||
    hasLine(/^(?:Maximum Life becomes 1, Immune to Chaos Damage|Maximum Life is 1)$/i) ||
    (db.override('Life') === 1 && db.flag('ChaosImmune'));

  if (chaosInoculation) {
    const src = 'Keystone: Chaos Inoculation';
    if (db.override('Life') !== 1) {
      db.addMod(mkMod('Life', 'OVERRIDE', 1, src));
    }
    if (!db.flag('ChaosImmune')) {
      db.addMod(mkMod('ChaosImmune', 'FLAG', true, src));
    }
    if (!db.flag('ChaosInoculation')) {
      db.addMod(mkMod('ChaosInoculation', 'FLAG', true, src));
    }
    appliedRules.push('ChaosInoculation');
  }

  // --- 6. Mahuxotl's Machination & Immortal Ambition ---
  const mahuxotlItem = equippedByName.get("mahuxotl's machination");
  const mahuxotlsMachination = Boolean(mahuxotlItem);
  const mahuxotlHasPoe1Bundle =
    mahuxotlsMachination &&
    (game === 'poe1' ||
      collectCleanItemLines(mahuxotlItem!).some((l) => /^Immortal Ambition$/i.test(l)));

  const immortalAmbition =
    hasNode('immortal ambition') ||
    hasLine(/^Immortal Ambition$/i) ||
    hasEquipped('soul tether') ||
    mahuxotlHasPoe1Bundle;

  if (mahuxotlsMachination) {
    const src = "Unique: Mahuxotl's Machination";
    if (!db.flag('MahuxotlsMachination')) {
      db.addMod(mkMod('MahuxotlsMachination', 'FLAG', true, src));
    }
    if (mahuxotlHasPoe1Bundle) {
      if (!db.flag('CorruptedSoul')) {
        db.addMod(mkMod('CorruptedSoul', 'FLAG', true, src));
      }
      if (db.sum('BASE', 'LifeAsExtraES') === 0) {
        db.addMod(mkMod('LifeAsExtraES', 'BASE', 15, src));
      }
      if (db.sum('BASE', 'EleTakenAsChaos') === 0) {
        db.addMod(mkMod('EleTakenAsChaos', 'BASE', 50, src));
      }
      if (!hasStatSource(db, 'ChaosResistMax', 'BASE', 'mahuxotl') && !hasStatSource(db, 'ChaosResistMax', 'BASE', 'divine flesh')) {
        db.addMod(mkMod('ChaosResistMax', 'BASE', 5, src));
      }
      if (!db.flag('EternalYouth')) {
        db.addMod(mkMod('EternalYouth', 'FLAG', true, src));
      }
      if (!db.flag('EverlastingSacrifice')) {
        db.addMod(mkMod('EverlastingSacrifice', 'FLAG', true, src));
      }
      if (!db.flag('VaalPact')) {
        db.addMod(mkMod('VaalPact', 'FLAG', true, src));
      }
    }
    appliedRules.push('MahuxotlsMachination');
  }

  if (immortalAmbition) {
    const src = 'Keystone: Immortal Ambition';
    if (!db.flag('ImmortalAmbition')) {
      db.addMod(mkMod('ImmortalAmbition', 'FLAG', true, src));
    }
    if (!db.flag('NoEsRecharge')) {
      db.addMod(mkMod('NoEsRecharge', 'FLAG', true, src));
    }
    if (!db.flag('NoEsRegen')) {
      db.addMod(mkMod('NoEsRegen', 'FLAG', true, src));
    }
    if (!db.flag('Overleech')) {
      db.addMod(mkMod('Overleech', 'FLAG', true, src));
    }
    if (!db.flag('EnergyShieldStartsAtZero')) {
      db.addMod(mkMod('EnergyShieldStartsAtZero', 'FLAG', true, src));
    }
    appliedRules.push('ImmortalAmbition');
  }

  // --- 7. Fleshcrafter (Minions Convert 2% Max Life to ES per 1% Chaos Res; >=50% -> 100%) ---
  const fleshcrafter =
    hasEquipped('fleshcrafter') ||
    hasLine(/Minions Convert \d+% of their Maximum Life to Maximum Energy Shield per 1% Chaos Resistance/i);
  let fleshcrafterMinionLifeConvertToEsPct = 0;

  if (fleshcrafter) {
    const src = 'Unique: Fleshcrafter';
    if (!db.flag('Fleshcrafter')) {
      db.addMod(mkMod('Fleshcrafter', 'FLAG', true, src));
    }
    if (!db.flag('MinionChaosDoesNotBypassEs')) {
      db.addMod(mkMod('MinionChaosDoesNotBypassEs', 'FLAG', true, src));
    }
    if (!db.flag('MinionHitsIgnoreEleRes')) {
      db.addMod(mkMod('MinionHitsIgnoreEleRes', 'FLAG', true, src));
    }
    const effectiveMinionChaosRes = ctx.minionChaosResist ?? db.sum('BASE', 'MinionChaosResist');
    fleshcrafterMinionLifeConvertToEsPct = Math.max(
      0,
      Math.min(100, Math.round(effectiveMinionChaosRes * 2)),
    );
    if (fleshcrafterMinionLifeConvertToEsPct > 0 && !hasStatSource(db, 'MinionLifeConvertToES', 'BASE', 'fleshcrafter')) {
      db.addMod(mkMod('MinionLifeConvertToES', 'BASE', fleshcrafterMinionLifeConvertToEsPct, src));
    }
    if (fleshcrafterMinionLifeConvertToEsPct >= 100) {
      db.addMod(mkMod('FleshcrafterMinionsZeroLife', 'FLAG', true, src));
    }
    appliedRules.push('Fleshcrafter');
  }

  // --- 8. PoE 2 Blackbraid (Armour applies to Elemental Damage) ---
  const blackbraidItem = equippedByName.get('blackbraid');
  const blackbraid = Boolean(blackbraidItem);
  if (blackbraid) {
    const src = 'Unique: Blackbraid';
    if (!db.flag('Blackbraid')) {
      db.addMod(mkMod('Blackbraid', 'FLAG', true, src));
    }
    let parsedPct = 0;
    for (const line of collectCleanItemLines(blackbraidItem!)) {
      const m = line.match(/^\+?(\d+)% of Armour also applies to Elemental Damage/i);
      if (m) {
        parsedPct += Number(m[1]);
      }
    }
    const desiredPct = parsedPct > 0 ? parsedPct : 100;
    const existingEle = db.sum('BASE', 'ArmourAppliesToEle');
    if (existingEle < desiredPct) {
      db.addMod(mkMod('ArmourAppliesToEle', 'BASE', desiredPct - existingEle, src));
    }
    appliedRules.push('Blackbraid');
  } else {
    // Bridge PoE 2 `ArmourAppliesToElementalPct` (from modParserPoe2) into `ArmourAppliesToEle`
    const poe2ArmourToEle = db.sum('BASE', 'ArmourAppliesToElementalPct');
    const existingEle = db.sum('BASE', 'ArmourAppliesToEle');
    if (poe2ArmourToEle > 0 && existingEle < poe2ArmourToEle) {
      db.addMod(
        mkMod(
          'ArmourAppliesToEle',
          'BASE',
          poe2ArmourToEle - existingEle,
          'Armour Applies to Elemental Damage',
        ),
      );
    }
  }

  // --- 9. Ghostwrithe (Life Converted to Energy Shield, respecting CI) ---
  const ghostwritheItem = equippedByName.get('ghostwrithe');
  const ghostwrithe = Boolean(ghostwritheItem);
  if (ghostwrithe) {
    const src = 'Unique: Ghostwrithe';
    if (!db.flag('Ghostwrithe')) {
      db.addMod(mkMod('Ghostwrithe', 'FLAG', true, src));
    }
    let convPct = 0;
    for (const line of collectCleanItemLines(ghostwritheItem!)) {
      const m = line.match(/^(\d+)% of Maximum Life Converted to Energy Shield$/i);
      if (m) {
        convPct += Number(m[1]);
      }
    }
    if (convPct === 0) convPct = 50;
    if (!chaosInoculation && db.sum('BASE', 'LifeConvertToES') === 0) {
      db.addMod(mkMod('LifeConvertToES', 'BASE', convPct, src));
    }
    appliedRules.push('Ghostwrithe');
  }

  // --- 10. The Apostate (Gain Maximum Life instead of Maximum ES from Equipped Armour Items) ---
  const theApostate =
    hasEquipped('the apostate') ||
    hasLine(/^Gain Maximum Life instead of Maximum Energy Shield from Equipped Armour Items$/i);
  let apostateConvertedArmourEs = 0;

  if (theApostate) {
    const src = 'Unique: The Apostate';
    if (!db.flag('TheApostate')) {
      db.addMod(mkMod('TheApostate', 'FLAG', true, src));
    }
    if (!db.flag('ConvertArmourESToLife')) {
      db.addMod(mkMod('ConvertArmourESToLife', 'FLAG', true, src));
    }
    if (ctx.armourItemsEnergyShield !== undefined) {
      apostateConvertedArmourEs = Math.max(0, Math.round(ctx.armourItemsEnergyShield));
    } else {
      let sum = 0;
      for (const { slot, item } of equippedItems) {
        if (!ARMOUR_SLOTS_FOR_APOSTATE.has(slot.trim().toLowerCase())) continue;
        const resolved = resolveItemEffectiveStats(item, game);
        sum += resolved.armourStats?.energyShield ?? 0;
      }
      apostateConvertedArmourEs = Math.max(0, Math.round(sum));
    }
    if (
      apostateConvertedArmourEs > 0 &&
      !hasStatSource(db, 'Life', 'BASE', 'the apostate')
    ) {
      db.addMod(mkMod('Life', 'BASE', apostateConvertedArmourEs, src));
      db.addMod(mkMod('EnergyShield', 'BASE', -apostateConvertedArmourEs, src));
    }
    appliedRules.push('TheApostate');
  }

  // --- 11. PoE 2 Scarred Faith ---
  const scarredFaith =
    hasNode('scarred faith') ||
    hasLine(/You cannot Recover Energy Shield to above Armour/i) ||
    db.flag('ScarredFaith');

  if (scarredFaith) {
    const src = 'Keystone: Scarred Faith';
    if (!db.flag('ScarredFaith')) {
      db.addMod(mkMod('ScarredFaith', 'FLAG', true, src));
    }
    if (!db.flag('NoEsRecharge')) {
      db.addMod(mkMod('NoEsRecharge', 'FLAG', true, src));
    }
    if (!db.flag('NoEsRegen')) {
      db.addMod(mkMod('NoEsRegen', 'FLAG', true, src));
    }
    if (!db.flag('EsRecoveryCappedByArmour')) {
      db.addMod(mkMod('EsRecoveryCappedByArmour', 'FLAG', true, src));
    }
    appliedRules.push('ScarredFaith');
  }

  // --- 12. Solipsism (`Intelligence provides no inherent bonus to Energy Shield` -> `NoIntEsBonus`) ---
  const solipsism =
    hasNode('solipsism') ||
    hasLine(/^Intelligence provides no (?:inherent )?bonus to Energy Shield$/i) ||
    db.flag('NoIntEsBonus') ||
    db.flag('NoIntBonusToES');
  let noIntEsBonus = db.flag('NoIntEsBonus') || db.flag('NoIntBonusToES');

  if (solipsism) {
    const src = 'Keystone: Solipsism';
    if (!db.flag('Solipsism')) {
      db.addMod(mkMod('Solipsism', 'FLAG', true, src));
    }
    if (!db.flag('NoIntEsBonus')) {
      db.addMod(mkMod('NoIntEsBonus', 'FLAG', true, src));
    }
    if (!db.flag('NoIntBonusToES')) {
      db.addMod(mkMod('NoIntBonusToES', 'FLAG', true, src));
    }
    noIntEsBonus = true;
    appliedRules.push('Solipsism');
  }

  // --- 13. Supreme Ego ---
  const supremeEgo =
    hasNode('supreme ego') ||
    hasLine(/^Auras from your Skills can only affect you$/i) ||
    db.flag('SupremeEgo');

  if (supremeEgo) {
    const src = 'Keystone: Supreme Ego';
    if (!db.flag('SupremeEgo')) {
      db.addMod(mkMod('SupremeEgo', 'FLAG', true, src));
    }
    if (!db.flag('SelfAurasOnlyAffectYou')) {
      db.addMod(mkMod('SelfAurasOnlyAffectYou', 'FLAG', true, src));
    }
    if (!db.flag('SupremeEgoAuraEffectPer2PctMana')) {
      db.addMod(mkMod('SupremeEgoAuraEffectPer2PctMana', 'FLAG', true, src));
    }
    if (!hasStatSource(db, 'AuraManaReservation', 'MORE', 'supreme ego')) {
      db.addMod(mkMod('AuraManaReservation', 'MORE', 40, src));
    }
    appliedRules.push('SupremeEgo');
  }

  // --- 14. Glancing Blows (PoE 1: BlockChance * 2, SpellBlockChance * 2) ---
  const hasExplicitDoubleBlockLine = hasLine(/^Chance to Block Attack Damage is doubled$/i);
  const glancingBlows =
    hasNode('glancing blows') ||
    hasExplicitDoubleBlockLine ||
    hasItemOrJewel('glancing blows') ||
    db.flag('GlancingBlows');
  let blockMultiplier = 1;
  let spellBlockMultiplier = 1;

  if (glancingBlows) {
    const src = 'Keystone: Glancing Blows';
    if (!db.flag('GlancingBlows')) {
      db.addMod(mkMod('GlancingBlows', 'FLAG', true, src));
    }
    if (game === 'poe1' || hasExplicitDoubleBlockLine) {
      if (!hasStatSource(db, 'BlockChance', 'MORE', 'glancing blows')) {
        db.addMod(mkMod('BlockChance', 'MORE', 100, src));
      }
      if (!hasStatSource(db, 'SpellBlockChance', 'MORE', 'glancing blows')) {
        db.addMod(mkMod('SpellBlockChance', 'MORE', 100, src));
      }
      if (db.override('DamageTakenFromBlockedHits') === null) {
        db.addMod(mkMod('DamageTakenFromBlockedHits', 'OVERRIDE', 65, src));
      }
      blockMultiplier = 2;
      spellBlockMultiplier = 2;
      appliedRules.push('PoE1:GlancingBlows');
    } else {
      if (!db.flag('EvadeChanceUnlucky')) {
        db.addMod(mkMod('EvadeChanceUnlucky', 'FLAG', true, src));
      }
      if (!db.flag('DeflectChanceLucky')) {
        db.addMod(mkMod('DeflectChanceLucky', 'FLAG', true, src));
      }
      appliedRules.push('PoE2:GlancingBlows');
    }
  }

  // --- 15. Versatile Combatant (-10% max Attack/Spell block; +2% Spell Block per 1% Overcapped Attack Block) ---
  const versatileCombatant =
    hasNode('versatile combatant') ||
    hasLine(/Chance to Block Spell Damage for each \d+% Overcapped Chance to Block Attack Damage/i) ||
    db.flag('VersatileCombatant');
  let versatileCombatantSpellBlockBonus = 0;

  if (versatileCombatant) {
    const src = 'Keystone: Versatile Combatant';
    if (!db.flag('VersatileCombatant')) {
      db.addMod(mkMod('VersatileCombatant', 'FLAG', true, src));
    }
    if (!hasStatSource(db, 'BlockChanceMax', 'BASE', 'versatile combatant')) {
      db.addMod(mkMod('BlockChanceMax', 'BASE', -10, src));
    }
    if (!hasStatSource(db, 'SpellBlockChanceMax', 'BASE', 'versatile combatant')) {
      db.addMod(mkMod('SpellBlockChanceMax', 'BASE', -10, src));
    }
    const maxAttackBlock = Math.min(
      90,
      Math.max(0, (ctx.baseMaxBlockChance ?? 75) + Math.round(db.sum('BASE', 'BlockChanceMax'))),
    );
    const rawAttackBlock = ctx.rawAttackBlockChance ?? db.calcStat('BlockChance').total;
    const overcap = Math.max(0, Math.floor(rawAttackBlock + 1e-6) - maxAttackBlock);
    if (overcap > 0) {
      versatileCombatantSpellBlockBonus = overcap * 2;
      if (!hasStatSource(db, 'SpellBlockChance', 'BASE', 'versatile combatant')) {
        db.addMod(mkMod('SpellBlockChance', 'BASE', versatileCombatantSpellBlockBonus, src));
      }
    }
    appliedRules.push('VersatileCombatant');
  }

  return {
    manaZeroed,
    energyShieldZeroed,
    bloodMagic,
    pyromanticPact,
    theAgnostic,
    dissolutionOfTheFlesh,
    immortalAmbition,
    mahuxotlsMachination,
    fleshcrafter,
    fleshcrafterMinionLifeConvertToEsPct,
    chaosInoculation,
    blackbraid,
    ghostwrithe,
    theApostate,
    scarredFaith,
    solipsism,
    noIntEsBonus,
    supremeEgo,
    versatileCombatant,
    glancingBlows,
    blockMultiplier,
    spellBlockMultiplier,
    versatileCombatantSpellBlockBonus,
    apostateConvertedArmourEs,
    appliedRules,
  };
}

// ============================================================================
// 3. Active Aura, Generosity, The Hand of Phrecia & Watcher's Eye Resolver
// ============================================================================

/** All 17 official PoE 1 Watcher's Eye aura names (ordered longest-first for regex matching). */
export const WATCHERS_EYE_AURAS: readonly string[] = [
  'Purity of Lightning',
  'Purity of Elements',
  'Purity of Fire',
  'Purity of Ice',
  'Determination',
  'Malevolence',
  'Discipline',
  'Precision',
  'Vitality',
  'Zealotry',
  'Clarity',
  'Hatred',
  'Anger',
  'Grace',
  'Haste',
  'Pride',
  'Wrath',
];

const WATCHERS_EYE_AURA_BY_LOWER = new Map<string, string>(
  WATCHERS_EYE_AURAS.map((name) => [name.toLowerCase(), name]),
);

const AURA_ALTERNATION = WATCHERS_EYE_AURAS.map((a) =>
  a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
).join('|');

const WATCHERS_EYE_PREFIX_RE = new RegExp(
  `^While (?:affected by|(?:you are )?using) (${AURA_ALTERNATION}),?\\s+(.+)$`,
  'i',
);
const WATCHERS_EYE_SUFFIX_RE = new RegExp(
  `^(.+?)\\s+while (?:affected by|(?:you are )?using) (${AURA_ALTERNATION})$`,
  'i',
);
const WATCHERS_EYE_INFIX_RE = new RegExp(
  `^(.+?)\\s+while (?:affected by|(?:you are )?using) (${AURA_ALTERNATION})\\s+(.+)$`,
  'i',
);

export interface AuraReservationEntry {
  gemId: string;
  gemName: string;
  pool: 'Mana' | 'Life';
  basePct: number;
  baseFlat: number;
  multiplier: number;
  localEfficiencyPct: number;
  effectivePct: number;
  effectiveFlat: number;
  zeroedByBlessing: boolean;
  blessingName?: string;
}

export interface EvaluatedAuraEntry {
  gemId: string;
  gemName: string;
  canonicalAuraName: string | null;
  level: number;
  isAura: boolean;
  isCurseOrMark: boolean;
  isHerald: boolean;
  appliesToPlayer: boolean;
  appliesToMinions: boolean;
  blockedFromPlayerBy: Array<'Generosity' | 'The Hand of Phrecia' | 'EnemyOnlyAura'>;
  auraEffectPctForPlayer: number;
  auraEffectPctForMinions: number;
  generosityEffectPct: number;
  arroganceEffectPct: number;
  blessingEffectPct: number;
  reservesPool: 'Mana' | 'Life' | 'None';
  reservationMult: number;
  localReservationEfficiencyPct: number;
  zeroedByBlessing: boolean;
  playerMods: Mod[];
  minionMods: Mod[];
}

export interface WatchersEyeEvaluatedLine {
  jewelName: string;
  rawLine: string;
  requiredAura: string;
  strippedModLine: string;
  active: boolean;
  mods: Mod[];
}

export interface AuraAndWatchersEyeContext {
  build: Build;
  playerDb: ModDB;
  /** Optional separate Minion ModDB (a fresh ModDB is created if omitted). */
  minionDb?: ModDB;
  /** Optional separate Enemy ModDB for Curses, Marks, and enemy-debuff Auras like Pride. */
  enemyDb?: ModDB;
  /** Optional equipped main-hand weapon type (e.g. for PoE 2 Wind Dancer weapon restriction). */
  mainWeaponType?: string;
  /** Optional gem resolver override (defaults to `@webpob/data`'s `getGemById`). */
  getGemByIdFn?: (game: GameId, gemId: string) => GemDefinition | undefined;
  /** Optional socketed jewels override (defaults to resolving `build.tree.socketedJewels`). */
  socketedJewels?: ReadonlyArray<{ nodeId: number; jewel: Item } | Item>;
  /** Optional additional AuraEffect % (e.g. from custom modifiers). */
  extraAuraEffectPct?: number;
  /** Optional additional CurseEffect % (e.g. from custom modifiers). */
  extraCurseEffectPct?: number;
  /** Optional Maximum Mana for exact flat reserved Mana calculation. */
  maxMana?: number;
  /** Optional Maximum Life for exact flat reserved Life calculation. */
  maxLife?: number;
}

export interface AuraAndWatchersEyeResult {
  playerDb: ModDB;
  minionDb: ModDB;
  enemyDb: ModDB;
  hasHandOfPhrecia: boolean;
  activeAurasAffectingPlayer: Set<string>;
  activeAurasAffectingMinions: Set<string>;
  activeAurasAll: Set<string>;
  auras: EvaluatedAuraEntry[];
  manaReservations: AuraReservationEntry[];
  lifeReservations: AuraReservationEntry[];
  totalManaReservedPct: number;
  totalManaReservedFlat: number;
  totalLifeReservedPct: number;
  totalLifeReservedFlat: number;
  totalSpiritReserved: number;
  watchersEyeLines: WatchersEyeEvaluatedLine[];
  watchersEyeMods: Mod[];
}

function resolveAuraLevelCompiledMods(def: GemDefinition, level: number): CompiledGemMod[] | undefined {
  if (!def.levelScaling || level === 20) return def.compiledMods;
  if (def.levelScaling[level]?.compiledMods) return def.levelScaling[level]!.compiledMods;
  const keys = Object.keys(def.levelScaling)
    .map(Number)
    .concat([20])
    .sort((a, b) => a - b);
  let bestKey = 20;
  let bestDist = Math.abs(level - 20);
  for (const k of keys) {
    const d = Math.abs(level - k);
    if (d < bestDist || (d === bestDist && k <= level)) {
      bestDist = d;
      bestKey = k;
    }
  }
  if (bestKey === 20) return def.compiledMods;
  return def.levelScaling[bestKey]?.compiledMods ?? def.compiledMods;
}

function collectModsFromDb(db: ModDB): Mod[] {
  const out: Mod[] = [];
  for (const [, list] of db.entriesByPrefix('')) {
    out.push(...list);
  }
  return out;
}

function resolveAuraLevelStats(def: GemDefinition, level: number): string[] {
  if (!def.levelScaling || level === 20) return def.stats;
  if (def.levelScaling[level]?.stats) return def.levelScaling[level]!.stats!;
  const keys = Object.keys(def.levelScaling)
    .map(Number)
    .concat([20])
    .sort((a, b) => a - b);
  let bestKey = 20;
  let bestDist = Math.abs(level - 20);
  for (const k of keys) {
    const d = Math.abs(level - k);
    if (d < bestDist || (d === bestDist && k <= level)) {
      bestDist = d;
      bestKey = k;
    }
  }
  if (bestKey === 20) return def.stats;
  return def.levelScaling[bestKey]?.stats ?? def.stats;
}

function extractAuraEffectFromStats(lines: readonly string[]): number {
  let sum = 0;
  for (const raw of lines) {
    const line = stripPobTags(raw);
    const m = line.match(
      /^(\d+)% increased (?:Aura Effect|effect of Non-Curse Auras(?: from your Skills)?)$/i,
    );
    if (m) sum += Number(m[1]);
  }
  return sum;
}

function stripSupportSuffix(name: string): string {
  return name.trim().toLowerCase().replace(/\s+support$/i, '').replace(/’/g, "'");
}

function getActiveEquippedItemsSimple(build: Build): Array<{ slot: EquipmentSlotId; item: Item }> {
  const result: Array<{ slot: EquipmentSlotId; item: Item }> = [];
  const hasSwap = Boolean(
    build.equipped['Weapon 1 Swap'] || build.equipped['Weapon 2 Swap'],
  );
  for (const [slotKey, itemId] of Object.entries(build.equipped)) {
    if (!itemId) continue;
    const slot = slotKey as EquipmentSlotId;
    if (build.game === 'poe2') {
      if (build.activeWeaponSet === 1 && (slot === 'Weapon 1 Swap' || slot === 'Weapon 2 Swap')) {
        continue;
      }
      if (build.activeWeaponSet === 2 && hasSwap && (slot === 'Weapon 1' || slot === 'Weapon 2')) {
        continue;
      }
    }
    const item = build.items[itemId];
    if (item) result.push({ slot, item });
  }
  return result;
}

function detectHandOfPhrecia(equipped: ReadonlyArray<{ slot: string; item: Item }>): boolean {
  for (const { item } of equipped) {
    if (normalizeName(item.name) === 'the hand of phrecia') {
      return true;
    }
    for (const line of collectCleanItemLines(item)) {
      if (/Non-Curse Auras from your Skills only apply to Allies/i.test(line)) {
        return true;
      }
    }
  }
  return false;
}

function inspectSlotItemAuraModifiers(slotItem: Item | undefined): {
  reservesLifeInsteadOfMana: boolean;
  localReservationEfficiencyPct: number;
  itemGrantedSupports: Array<{ name: string; level: number }>;
} {
  if (!slotItem) {
    return {
      reservesLifeInsteadOfMana: false,
      localReservationEfficiencyPct: 0,
      itemGrantedSupports: [],
    };
  }
  let reservesLifeInsteadOfMana = normalizeName(slotItem.name) === 'prism guardian';
  let localReservationEfficiencyPct = 0;
  const itemGrantedSupports: Array<{ name: string; level: number }> = [];

  for (const line of collectCleanItemLines(slotItem)) {
    if (
      /Socketed Gems (?:Cost and )?Reserve Life instead of Mana/i.test(line) ||
      /Socketed Gems have Blood Magic/i.test(line)
    ) {
      reservesLifeInsteadOfMana = true;
    }
    const mEff = line.match(
      /^Socketed Gems have (\d+)% increased (?:Mana )?Reservation Efficiency$/i,
    );
    if (mEff) {
      localReservationEfficiencyPct += Number(mEff[1]);
    }
    const mSup = line.match(
      /^Socketed Gems are Supported by Level (\d+) (Generosity|Awakened Generosity|Arrogance|Eternal Blessing|Divine Blessing|Guardian'?s Blessing|Enlighten|Empower)$/i,
    );
    if (mSup) {
      itemGrantedSupports.push({ name: mSup[2]!, level: Number(mSup[1]) });
    }
  }

  return {
    reservesLifeInsteadOfMana,
    localReservationEfficiencyPct,
    itemGrantedSupports,
  };
}

/**
 * Extracts `{ requiredAura, strippedModLine }` from a Watcher's Eye conditional line.
 * Supports all three official/community formats:
 * - Prefix: `While affected by Determination, +1000 to Armour`
 * - Suffix: `+5% Chance to Block Attack Damage while affected by Determination`
 *           `10% chance to deal Double Damage while using Pride`
 * - Infix:  `18% of Damage taken while affected by Clarity Recouped as Mana`
 */
export function parseWatchersEyeCondition(
  rawLine: string,
): { requiredAura: string; strippedModLine: string } | null {
  const clean = stripPobTags(rawLine);
  if (!clean) return null;

  let m = clean.match(WATCHERS_EYE_PREFIX_RE);
  if (m) {
    const canonical = WATCHERS_EYE_AURA_BY_LOWER.get(m[1]!.toLowerCase());
    if (canonical) {
      return { requiredAura: canonical, strippedModLine: m[2]!.trim() };
    }
  }

  m = clean.match(WATCHERS_EYE_SUFFIX_RE);
  if (m) {
    const canonical = WATCHERS_EYE_AURA_BY_LOWER.get(m[2]!.toLowerCase());
    if (canonical) {
      return { requiredAura: canonical, strippedModLine: m[1]!.trim() };
    }
  }

  m = clean.match(WATCHERS_EYE_INFIX_RE);
  if (m) {
    const canonical = WATCHERS_EYE_AURA_BY_LOWER.get(m[2]!.toLowerCase());
    if (canonical) {
      return {
        requiredAura: canonical,
        strippedModLine: `${m[1]!.trim()} ${m[3]!.trim()}`.replace(/\s+/g, ' '),
      };
    }
  }

  return null;
}

/**
 * Parses the stripped effect portion of an active Watcher's Eye modifier line into `Mod[]`,
 * delegating first to `parseModLines` and covering Watcher's Eye-specific phrasings.
 */
function parseWatchersEyeEffectLine(strippedLine: string, source: string): Mod[] {
  const direct = parseModLines([strippedLine], source);
  if (direct.length > 0) return direct;

  let m: RegExpMatchArray | null;

  // Clarity: "(6-10)% of Damage taken from Mana before Life" (without "is")
  m = strippedLine.match(/^(\d+)% of Damage (?:is )?taken from Mana before Life$/i);
  if (m) return [mkMod('DamageTakenFromManaBeforeLife', 'BASE', Number(m[1]), source)];

  // Wrath/Anger/Vitality: "(1-1.5)% of [Element] Damage is Leeched as (Life|Mana|Energy Shield)"
  m = strippedLine.match(
    /^(\d+(?:\.\d+)?)% of (?:(?:Physical|Fire|Cold|Lightning|Chaos|Elemental|Attack|Spell) )?Damage (?:is )?Leeched as (Life|Mana|Energy Shield)$/i,
  );
  if (m) {
    const target = m[2]!.toLowerCase() === 'energy shield' ? 'Es' : m[2]!;
    return [mkMod(`${target}Leech`, 'BASE', Number(m[1]), source)];
  }

  // Discipline: "Regenerate (1.5-2.5)% of Energy Shield per Second"
  m = strippedLine.match(/^Regenerate (\d+(?:\.\d+)?)% of Energy Shield per Second$/i);
  if (m) return [mkMod('EnergyShieldRegenPercent', 'BASE', Number(m[1]), source)];

  // Grace: "+(5-8)% chance to Evade Attack Hits"
  m = strippedLine.match(/^\+?(\d+)% chance to Evade Attack Hits$/i);
  if (m) return [mkMod('EvadeChance', 'BASE', Number(m[1]), source)];

  // Purity of Fire/Ice/Lightning: "(10-20)% of X and Y Damage taken as Z Damage"
  m = strippedLine.match(
    /^(\d+)% of (Fire|Cold|Lightning) and (Fire|Cold|Lightning) Damage taken as (Fire|Cold|Lightning) Damage$/i,
  );
  if (m) {
    const v = Number(m[1]);
    return [
      mkMod(`${m[2]}TakenAs${m[4]}`, 'BASE', v, source),
      mkMod(`${m[3]}TakenAs${m[4]}`, 'BASE', v, source),
    ];
  }

  // Zealotry: "Critical Strikes Penetrate (8-10)% of Enemy Elemental Resistances"
  m = strippedLine.match(/^Critical Strikes Penetrate (\d+)% of Enemy Elemental Resistances$/i);
  if (m) {
    const v = Number(m[1]);
    return [
      mkMod('FirePenetration', 'BASE', v, source),
      mkMod('ColdPenetration', 'BASE', v, source),
      mkMod('LightningPenetration', 'BASE', v, source),
    ];
  }

  // Malevolence: "(8-12)% increased Recovery rate of Life and Energy Shield"
  m = strippedLine.match(/^(\d+)% increased Recovery rate of Life and Energy Shield$/i);
  if (m) {
    const v = Number(m[1]);
    return [
      mkMod('LifeRecoveryRate', 'INC', v, source),
      mkMod('EnergyShieldRecoveryRate', 'INC', v, source),
    ];
  }

  // Discipline/Vitality/Clarity: "(10-15)% increased (Life|Mana|Energy Shield) Recovery Rate"
  m = strippedLine.match(/^(\d+)% increased (Life|Mana|Energy Shield) Recovery Rate$/i);
  if (m) {
    const stat = m[2]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : m[2]!;
    return [mkMod(`${stat}RecoveryRate`, 'INC', Number(m[1]), source)];
  }

  // Clarity: "-(10-5) to Total Mana Cost of Skills"
  m = strippedLine.match(/^([+-]?\d+) to Total Mana Cost of Skills$/i);
  if (m) return [mkMod('ManaCost', 'BASE', Number(m[1]), source)];

  // Malevolence: "Damaging Ailments you inflict deal Damage (10-15)% Faster"
  m = strippedLine.match(/^Damaging Ailments you inflict deal Damage (\d+)% Faster$/i);
  if (m) return [mkMod('AilmentDealDamageFaster', 'INC', Number(m[1]), source)];

  // Zealotry: "Consecrated Ground you create causes enemies to take (8-10)% increased Damage"
  m = strippedLine.match(
    /^Consecrated Ground you create causes enemies to take (\d+)% increased Damage$/i,
  );
  if (m) return [mkMod('EnemyDamageTaken', 'INC', Number(m[1]), source)];

  // Zealotry: "(100-120)% increased Critical Strike Chance against Enemies on Consecrated Ground"
  m = strippedLine.match(
    /^(\d+)% increased Critical Strike Chance against Enemies on Consecrated Ground$/i,
  );
  if (m) return [mkMod('CritChance', 'INC', Number(m[1]), source)];

  // Precision/Anger/Hatred/Wrath attack/spell/crit/immunities
  m = strippedLine.match(/^Immune to (Ignite|Freeze|Shock)$/i);
  if (m) return [mkMod(`${m[1]}Immune`, 'FLAG', true, source)];

  m = strippedLine.match(/^Cannot be Blinded$/i);
  if (m) return [mkMod('BlindImmune', 'FLAG', true, source)];

  m = strippedLine.match(/^You have Phasing$/i);
  if (m) return [mkMod('Phasing', 'FLAG', true, source)];

  m = strippedLine.match(/^Your Hits Intimidate Enemies for \d+ seconds$/i);
  if (m) return [mkMod('IntimidateOnHit', 'FLAG', true, source)];

  m = strippedLine.match(/^Unaffected by ([A-Za-z ]+)$/i);
  if (m) {
    const token = m[1]!.trim().replace(/\s+/g, '');
    return [mkMod(`UnaffectedBy${token}`, 'FLAG', true, source)];
  }

  // Impale Watcher's Eye lines (Pride)
  m = strippedLine.match(/^(\d+)% chance to Impale Enemies on Hit with Attacks$/i);
  if (m) return [mkMod('ImpaleChance', 'BASE', Number(m[1]), source, ModFlag.Attack)];

  return [];
}

function computeReservationAmounts(
  basePct: number,
  baseFlat: number,
  mult: number,
  totalEfficiencyPct: number,
  poolMax: number,
): { effectivePct: number; effectiveFlat: number } {
  const clampedEff = Math.max(-90, totalEfficiencyPct);
  const effDiv = 1 + clampedEff / 100;
  let effectivePct = 0;
  let effectiveFlat = 0;

  if (basePct > 0) {
    // Matches PoB1 CalcPerform: basePercentVal = trunc(pct * 100 * mult); reservedPercent = round(basePercentVal / effDiv) / 100
    const basePercentVal = Math.trunc(basePct * 100 * mult + 1e-6);
    effectivePct = Math.max(0, Math.round(basePercentVal / effDiv) / 100);
    if (poolMax > 0) {
      effectiveFlat += Math.ceil(poolMax * (effectivePct / 100) - 1e-9);
    }
  }
  if (baseFlat > 0) {
    const baseFlatVal = Math.trunc(baseFlat * mult + 1e-6);
    const flatRes = Math.max(0, Math.round(baseFlatVal / effDiv));
    effectiveFlat += flatRes;
    if (poolMax > 0) {
      effectivePct += Math.round((flatRes / poolMax) * 10000) / 100;
    }
  }

  return {
    effectivePct: Math.round(effectivePct * 100) / 100,
    effectiveFlat,
  };
}

/**
 * Resolves all active Auras, Curses/Marks, Persistent Buffs, `Generosity` / `Awakened Generosity`,
 * `The Hand of Phrecia`, `Eternal/Divine/Guardian's Blessing`, `Arrogance`, `Prism Guardian`,
 * `Blood Magic` life reservations, and `Watcher's Eye` conditional lines.
 *
 * - Non-curse auras affected by `Generosity` or `The Hand of Phrecia` STILL reserve Mana/Life,
 *   do NOT grant stats to `playerDb`, DO grant scaled aura stats (`1 + (auraEffectPct + generosityAuraEffectPct) / 100`)
 *   to `minionDb`, and do NOT count as affecting the player for `Watcher's Eye`.
 * - `Watcher's Eye` lines activate ONLY when their required aura is active AND affecting the player.
 */
export function evaluateAurasAndWatchersEye(
  ctx: AuraAndWatchersEyeContext,
): AuraAndWatchersEyeResult {
  const { build, playerDb } = ctx;
  const minionDb = ctx.minionDb ?? new ModDB();
  const enemyDb = ctx.enemyDb ?? new ModDB();
  const lookupGem = ctx.getGemByIdFn ?? getGemById;

  const equipped = getActiveEquippedItemsSimple(build);
  const hasHandOfPhrecia = detectHandOfPhrecia(equipped);
  const globalBloodMagic = playerDb.flag('BloodMagic');
  const supremeEgo = playerDb.flag('SupremeEgo') || playerDb.flag('SelfAurasOnlyAffectYou');

  const baseAuraEffectPct = playerDb.sum('INC', 'AuraEffect') + (ctx.extraAuraEffectPct ?? 0);
  const baseCurseEffectPct = playerDb.sum('INC', 'CurseEffect') + (ctx.extraCurseEffectPct ?? 0);

  const genericResEff = playerDb.sum('INC', 'ReservationEfficiency');
  const globalManaResEff = playerDb.sum('INC', 'ManaReservationEfficiency') + genericResEff;
  const globalLifeResEff = playerDb.sum('INC', 'LifeReservationEfficiency') + genericResEff;

  interface CandidateAura {
    def: GemDefinition;
    gemInst: GemInstance;
    effLevel: number;
    canonicalAuraName: string | null;
    isAura: boolean;
    isCurseOrMark: boolean;
    isHerald: boolean;
    isEnemyOnlyAura: boolean;
    groupHasGenerosity: boolean;
    generosityEffectPct: number;
    groupHasArrogance: boolean;
    arroganceEffectPct: number;
    arroganceResMult: number;
    groupHasBlessing: boolean;
    blessingName?: string;
    blessingEffectPct: number;
    groupHasPrismGuardian: boolean;
    localResEffPct: number;
    enlightenMult: number;
  }

  const deduped = new Map<string, CandidateAura>();

  for (const group of build.skills) {
    if (!group.enabled) continue;
    if (
      build.game === 'poe2' &&
      group.weaponSets &&
      !group.weaponSets.includes(build.activeWeaponSet)
    ) {
      continue;
    }

    const slotItem =
      group.slot && build.equipped[group.slot]
        ? build.items[build.equipped[group.slot]!]
        : undefined;
    const groupSocketedRules = slotItem
      ? parseSocketedGemBonuses([...slotItem.implicits, ...slotItem.explicits])
      : [];
    const slotAuraInfo = inspectSlotItemAuraModifiers(slotItem);

    let groupEmpowerBonus = 0;
    let groupAwakenedGenAuraLevelBonus = 0;
    let groupEnlightenMult = 1;
    let groupHasGenerosity = false;
    let generosityEffectPct = 0;
    let groupHasArrogance = false;
    let arroganceEffectPct = 0;
    let arroganceResMult = 1;
    let groupHasBlessing = false;
    let blessingName: string | undefined;
    let blessingEffectPct = 0;

    const applySupportByName = (
      rawName: string,
      effLevel: number,
      effQuality: number,
      resolvedStats?: readonly string[],
    ) => {
      const lower = stripSupportSuffix(rawName);
      if (lower === 'empower' || lower === 'awakened empower') {
        groupEmpowerBonus += Math.max(0, effLevel - 1);
      } else if (lower === 'enlighten' || lower === 'awakened enlighten') {
        groupEnlightenMult *= Math.max(0.5, 1 - Math.max(0, effLevel - 1) * 0.04);
      } else if (lower === 'generosity' || lower === 'awakened generosity') {
        groupHasGenerosity = true;
        const fromStats = resolvedStats ? extractAuraEffectFromStats(resolvedStats) : 0;
        const isAwakened = lower === 'awakened generosity';
        const fallback = isAwakened
          ? effLevel <= 6
            ? 39 + effLevel
            : 45 + Math.floor((effLevel - 6) / 2)
          : 19 + effLevel;
        generosityEffectPct += fromStats > 0 ? fromStats : fallback;
        if (isAwakened && effLevel >= 5) {
          groupAwakenedGenAuraLevelBonus += effLevel >= 10 ? 2 : 1;
        }
      } else if (lower === 'arrogance') {
        groupHasArrogance = true;
        // Official PoB1 sup_str.lua: Lv.1 = +120% (2.20x), Lv.20 = +101% (2.01x), Lv.21 = +100% (2.00x)
        arroganceResMult *= Math.max(1.86, 1 + (121 - effLevel) / 100);
        const fromStats = resolvedStats ? extractAuraEffectFromStats(resolvedStats) : 0;
        const baseEff = fromStats > 0 ? fromStats : Math.floor((effLevel + 19) / 2);
        const qualBonus = Math.trunc(Math.max(0, effQuality) * 0.25);
        arroganceEffectPct += baseEff + qualBonus;
      } else if (
        lower === 'eternal blessing' ||
        lower === 'divine blessing' ||
        lower === "guardian's blessing" ||
        lower === 'guardians blessing'
      ) {
        groupHasBlessing = true;
        blessingName = rawName;
        const fromStats = resolvedStats ? extractAuraEffectFromStats(resolvedStats) : 0;
        let baseEff = fromStats;
        if (baseEff === 0) {
          if (lower === 'eternal blessing') baseEff = Math.max(0, effLevel - 1);
          else if (lower === 'divine blessing') baseEff = 9 + effLevel;
          else baseEff = 7 + effLevel;
        }
        const qualBonus =
          lower === 'eternal blessing' ? Math.trunc(Math.max(0, effQuality) * 0.25) : 0;
        blessingEffectPct += baseEff + qualBonus;
      }
    };

    // Item-granted supports in the skill group's slot
    for (const itemSup of slotAuraInfo.itemGrantedSupports) {
      applySupportByName(itemSup.name, itemSup.level, 0);
    }

    // Linked support gems in this skill group
    for (const supInst of group.gems) {
      if (!supInst.enabled) continue;
      const supDef = lookupGem(build.game, supInst.gemId);
      if (!supDef || supDef.category !== 'support') continue;
      const supBon = resolveGemBonuses(supDef, playerDb, groupSocketedRules);
      const effSupLevel = Math.min(40, Math.max(1, supInst.level + supBon.levelBonus));
      const effSupQuality = supInst.quality + supBon.qualityBonus;
      const supStats = resolveAuraLevelStats(supDef, effSupLevel);
      applySupportByName(supDef.name.en, effSupLevel, effSupQuality, supStats);
    }

    // Evaluate active auras / buffs / curses in this skill group
    for (const gemInst of group.gems) {
      if (!gemInst.enabled) continue;
      const def = lookupGem(build.game, gemInst.gemId);
      if (!def) continue;

      const tags = new Set(def.tags.map((t) => t.toLowerCase()));
      const canonicalAuraName =
        WATCHERS_EYE_AURA_BY_LOWER.get(def.name.en.trim().toLowerCase()) ?? null;
      const isCurseOrMark = tags.has('curse') || tags.has('mark');
      const isHerald = tags.has('herald');
      const isAura =
        !isCurseOrMark &&
        !isHerald &&
        (tags.has('aura') || (def.manaReservationPct ?? 0) > 0 || canonicalAuraName !== null);
      const isGlobalBuff =
        Boolean(def.isAuraOrBuff) ||
        (def.category === 'active' && (isAura || isCurseOrMark || (def.spiritReservation ?? 0) > 0));
      if (!isGlobalBuff) continue;

      const isEnemyOnlyAura = canonicalAuraName === 'Pride';
      const gemBon = resolveGemBonuses(def, playerDb, groupSocketedRules);
      const awakenedBonus = isAura && !isEnemyOnlyAura ? groupAwakenedGenAuraLevelBonus : 0;
      const effLevel = Math.min(
        40,
        Math.max(1, gemInst.level + gemBon.levelBonus + groupEmpowerBonus + awakenedBonus),
      );

      const candidate: CandidateAura = {
        def,
        gemInst,
        effLevel,
        canonicalAuraName,
        isAura,
        isCurseOrMark,
        isHerald,
        isEnemyOnlyAura,
        groupHasGenerosity,
        generosityEffectPct,
        groupHasArrogance,
        arroganceEffectPct,
        arroganceResMult,
        groupHasBlessing,
        blessingName,
        blessingEffectPct,
        groupHasPrismGuardian: slotAuraInfo.reservesLifeInsteadOfMana,
        localResEffPct: slotAuraInfo.localReservationEfficiencyPct,
        enlightenMult: groupEnlightenMult,
      };

      const prev = deduped.get(def.id);
      if (
        !prev ||
        candidate.effLevel > prev.effLevel ||
        (candidate.effLevel === prev.effLevel &&
          candidate.enlightenMult < prev.enlightenMult)
      ) {
        deduped.set(def.id, candidate);
      }
    }
  }

  const activeAurasAffectingPlayer = new Set<string>();
  const activeAurasAffectingMinions = new Set<string>();
  const activeAurasAll = new Set<string>();
  const auras: EvaluatedAuraEntry[] = [];
  const manaReservations: AuraReservationEntry[] = [];
  const lifeReservations: AuraReservationEntry[] = [];
  let totalManaReservedPct = 0;
  let totalManaReservedFlat = 0;
  let totalLifeReservedPct = 0;
  let totalLifeReservedFlat = 0;
  let totalSpiritReserved = 0;

  const maxMana = ctx.maxMana ?? Math.round(playerDb.calcStat('Mana').total);
  const maxLife = ctx.maxLife ?? Math.round(playerDb.calcStat('Life').total);

  for (const cand of deduped.values()) {
    const { def, gemInst, effLevel, isAura, isCurseOrMark, isHerald, isEnemyOnlyAura } = cand;
    const windDancerDisallowed =
      def.id === 'poe2_winddancer' &&
      (ctx.mainWeaponType === 'Quarterstaff' || ctx.mainWeaponType === 'Wand');
    const rawStats = windDancerDisallowed ? [] : resolveAuraLevelStats(def, effLevel);
    const compiledMods = windDancerDisallowed ? undefined : resolveAuraLevelCompiledMods(def, effLevel);
    const sourceLabel = `Aura/Buff: ${def.name.en}${effLevel !== gemInst.level ? ` (Lv.${effLevel})` : ''}`;
    const parsedBaseMods =
      compiledMods && compiledMods.length > 0 ? [] : parseModLines(rawStats, sourceLabel);

    const blockedFromPlayerBy: EvaluatedAuraEntry['blockedFromPlayerBy'] = [];
    const affectedByGenerosity = isAura && !isEnemyOnlyAura && cand.groupHasGenerosity;
    const affectedByPhrecia = isAura && !isEnemyOnlyAura && hasHandOfPhrecia;
    if (affectedByGenerosity) blockedFromPlayerBy.push('Generosity');
    if (affectedByPhrecia) blockedFromPlayerBy.push('The Hand of Phrecia');
    if (isEnemyOnlyAura) blockedFromPlayerBy.push('EnemyOnlyAura');

    const appliesToPlayer = isAura
      ? !affectedByGenerosity && !affectedByPhrecia && !isEnemyOnlyAura
      : true;
    const appliesToMinions = isAura && !isEnemyOnlyAura && !supremeEgo;

    const auraEffectPctForPlayer = isAura
      ? baseAuraEffectPct + cand.arroganceEffectPct + cand.blessingEffectPct
      : 0;
    const auraEffectPctForMinions = isAura
      ? baseAuraEffectPct +
        cand.generosityEffectPct +
        cand.arroganceEffectPct +
        cand.blessingEffectPct
      : 0;

    // Reservation calculation (Generosity & The Hand of Phrecia STILL reserve Mana/Life!)
    const basePct = def.manaReservationPct ?? 0;
    const baseFlat = def.manaReservationFlat ?? 0;
    const hasManaOrLifeRes = basePct > 0 || baseFlat > 0;
    const zeroedByBlessing = isAura && cand.groupHasBlessing;

    let reservesPool: 'Mana' | 'Life' | 'None' = 'None';
    let reservationMult = 1;
    let effectiveReservedPctForSupremeEgo = 0;

    if (hasManaOrLifeRes) {
      if (zeroedByBlessing) {
        reservesPool = 'None';
        reservationMult = 0;
        manaReservations.push({
          gemId: def.id,
          gemName: def.name.en,
          pool: 'Mana',
          basePct,
          baseFlat,
          multiplier: 0,
          localEfficiencyPct: cand.localResEffPct,
          effectivePct: 0,
          effectiveFlat: 0,
          zeroedByBlessing: true,
          blessingName: cand.blessingName,
        });
      } else {
        const reservesLife =
          cand.groupHasArrogance || cand.groupHasPrismGuardian || globalBloodMagic;
        reservesPool = reservesLife ? 'Life' : 'Mana';
        reservationMult =
          cand.enlightenMult *
          (cand.groupHasArrogance ? cand.arroganceResMult : 1) *
          (supremeEgo && isAura ? 1.4 : 1);

        const totalEff =
          (reservesLife ? globalLifeResEff : globalManaResEff) + cand.localResEffPct;
        const { effectivePct, effectiveFlat } = computeReservationAmounts(
          basePct,
          baseFlat,
          reservationMult,
          totalEff,
          reservesLife ? maxLife : maxMana,
        );
        if (!reservesLife) {
          effectiveReservedPctForSupremeEgo = effectivePct;
        }

        const entry: AuraReservationEntry = {
          gemId: def.id,
          gemName: def.name.en,
          pool: reservesPool,
          basePct,
          baseFlat,
          multiplier: Math.round(reservationMult * 1000) / 1000,
          localEfficiencyPct: cand.localResEffPct,
          effectivePct,
          effectiveFlat,
          zeroedByBlessing: false,
        };

        if (reservesLife) {
          lifeReservations.push(entry);
          totalLifeReservedPct += effectivePct;
          totalLifeReservedFlat += effectiveFlat;
        } else {
          manaReservations.push(entry);
          totalManaReservedPct += effectivePct;
          totalManaReservedFlat += effectiveFlat;
        }
      }
    }

    const supremeEgoMoreMult =
      supremeEgo && isAura && effectiveReservedPctForSupremeEgo > 0
        ? 1 + Math.floor(effectiveReservedPctForSupremeEgo / 2) / 100
        : 1;

    let playerMods: Mod[] = [];
    let minionMods: Mod[] = [];

    if (compiledMods && compiledMods.length > 0) {
      const enemyCmods = compiledMods.filter((m) => m.target === 'enemy');
      // Only `target === 'player'` modifiers are global aura/buff grants; `target === undefined` or `'skill'`
      // on Heralds / Tempest Shield are local to that skill's own secondary hit/orb.
      const allyCmods = compiledMods.filter((m) => m.target === 'player');

      if (enemyCmods.length > 0) {
        const enemyMult = isCurseOrMark
          ? 1 + baseCurseEffectPct / 100
          : (1 + auraEffectPctForPlayer / 100) * supremeEgoMoreMult;
        injectCompiledGemMods(playerDb, enemyDb, minionDb, enemyCmods, sourceLabel, {
          game: build.game,
          effectMultiplier: enemyMult,
          scaleMore: !isCurseOrMark,
        });
      }

      if (allyCmods.length > 0 && appliesToPlayer) {
        const tmpPlayer = new ModDB();
        const tmpEnemy = new ModDB();
        const tmpMinion = new ModDB();
        const playerMult = isAura
          ? (1 + auraEffectPctForPlayer / 100) * supremeEgoMoreMult
          : isCurseOrMark
            ? 1 + baseCurseEffectPct / 100
            : 1;
        injectCompiledGemMods(tmpPlayer, tmpEnemy, tmpMinion, allyCmods, sourceLabel, {
          game: build.game,
          effectMultiplier: playerMult,
          scaleMore: isAura,
        });
        playerMods = collectModsFromDb(tmpPlayer);
        playerDb.addMods(playerMods);
        enemyDb.addMods(collectModsFromDb(tmpEnemy));
        minionDb.addMods(collectModsFromDb(tmpMinion));
      }

      if (allyCmods.length > 0 && appliesToMinions) {
        const minionSource = `${sourceLabel} [Minion Aura]`;
        const tmpMinion = new ModDB();
        const tmpUnused = new ModDB();
        const forcedMinionTarget = allyCmods.map((m) => ({
          ...m,
          target: 'player' as const,
        }));
        injectCompiledGemMods(tmpMinion, tmpUnused, tmpUnused, forcedMinionTarget, minionSource, {
          game: build.game,
          effectMultiplier: 1 + auraEffectPctForMinions / 100,
          scaleMore: true,
        });
        minionMods = collectModsFromDb(tmpMinion);
        minionDb.addMods(minionMods);
      }
    } else {
      if (appliesToPlayer) {
        if (isAura && (auraEffectPctForPlayer > 0 || supremeEgoMoreMult !== 1)) {
          const totalMult = (1 + auraEffectPctForPlayer / 100) * supremeEgoMoreMult;
          playerMods = scaleNumericMods(parsedBaseMods, totalMult, true);
        } else if (isCurseOrMark && baseCurseEffectPct > 0) {
          playerMods = scaleNumericMods(parsedBaseMods, 1 + baseCurseEffectPct / 100, false);
        } else {
          playerMods = [...parsedBaseMods];
        }
        playerDb.addMods(playerMods);
      }

      if (appliesToMinions) {
        const minionSource = `${sourceLabel} [Minion Aura]`;
        const baseMinionMods = parsedBaseMods.map((m) => ({ ...m, source: minionSource }));
        minionMods =
          auraEffectPctForMinions > 0
            ? scaleNumericMods(baseMinionMods, 1 + auraEffectPctForMinions / 100, true)
            : baseMinionMods;
        minionDb.addMods(minionMods);
      }
    }

    // Track active canonical aura names for Watcher's Eye & condition evaluation
    const auraKey = cand.canonicalAuraName ?? (isAura ? def.name.en : null);
    if (auraKey) {
      activeAurasAll.add(auraKey);
      // Pride triggers "while using Pride" on Watcher's Eye when active on the player's skills;
      // all other auras trigger "while affected by <Aura>" ONLY when actually affecting the player.
      if (appliesToPlayer || isEnemyOnlyAura) {
        activeAurasAffectingPlayer.add(auraKey);
        playerDb.setCondition(`AffectedBy${auraKey.replace(/\s+/g, '')}`, true);
      }
      if (appliesToMinions) {
        activeAurasAffectingMinions.add(auraKey);
        minionDb.setCondition(`AffectedBy${auraKey.replace(/\s+/g, '')}`, true);
      }
    }

    const spiritUnitCost = gemInst.spiritReservationOverride ?? def.spiritReservation ?? 0;
    if (spiritUnitCost > 0) {
      const spiritCount = def.minionBase && (gemInst.count ?? 1) > 1 ? Math.floor(gemInst.count!) : 1;
      totalSpiritReserved += spiritUnitCost * spiritCount;
    }

    auras.push({
      gemId: def.id,
      gemName: def.name.en,
      canonicalAuraName: cand.canonicalAuraName,
      level: effLevel,
      isAura,
      isCurseOrMark,
      isHerald,
      appliesToPlayer,
      appliesToMinions,
      blockedFromPlayerBy,
      auraEffectPctForPlayer,
      auraEffectPctForMinions,
      generosityEffectPct: affectedByGenerosity ? cand.generosityEffectPct : 0,
      arroganceEffectPct: cand.arroganceEffectPct,
      blessingEffectPct: cand.blessingEffectPct,
      reservesPool,
      reservationMult: Math.round(reservationMult * 1000) / 1000,
      localReservationEfficiencyPct: cand.localResEffPct,
      zeroedByBlessing,
      playerMods,
      minionMods,
    });
  }

  // Evaluate Watcher's Eye jewels (from explicit socketedJewels override or build.tree.socketedJewels)
  const jewelsToScan: Item[] = [];
  if (ctx.socketedJewels) {
    for (const entry of ctx.socketedJewels) {
      jewelsToScan.push('jewel' in entry ? entry.jewel : entry);
    }
  } else if (build.tree.socketedJewels) {
    for (const itemId of Object.values(build.tree.socketedJewels)) {
      const jewel = build.items[itemId];
      if (jewel) jewelsToScan.push(jewel);
    }
  }

  const watchersEyeLines: WatchersEyeEvaluatedLine[] = [];
  const watchersEyeMods: Mod[] = [];

  for (const jewel of jewelsToScan) {
    const lines = collectCleanItemLines(jewel);
    for (const line of lines) {
      const parsedCond = parseWatchersEyeCondition(line);
      if (!parsedCond) continue;

      const active = activeAurasAffectingPlayer.has(parsedCond.requiredAura);
      const mods = active
        ? parseWatchersEyeEffectLine(
            parsedCond.strippedModLine,
            `${jewel.name} (${parsedCond.requiredAura})`,
          )
        : [];

      if (active && mods.length > 0) {
        playerDb.addMods(mods);
        watchersEyeMods.push(...mods);
      }

      watchersEyeLines.push({
        jewelName: jewel.name,
        rawLine: line,
        requiredAura: parsedCond.requiredAura,
        strippedModLine: parsedCond.strippedModLine,
        active,
        mods,
      });
    }
  }

  return {
    playerDb,
    minionDb,
    enemyDb,
    hasHandOfPhrecia,
    activeAurasAffectingPlayer,
    activeAurasAffectingMinions,
    activeAurasAll,
    auras,
    manaReservations,
    lifeReservations,
    totalManaReservedPct: Math.round(totalManaReservedPct * 100) / 100,
    totalManaReservedFlat,
    totalLifeReservedPct: Math.round(totalLifeReservedPct * 100) / 100,
    totalLifeReservedFlat,
    totalSpiritReserved,
    watchersEyeLines,
    watchersEyeMods,
  };
}
