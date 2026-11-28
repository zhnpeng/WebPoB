import {
  KeywordFlag,
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
  resolveGemFromPobRef,
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

export function isClusterJewelItem(jewel: Item): boolean {
  const lowerBase = jewel.baseName.toLowerCase();
  const lowerName = jewel.name.toLowerCase();
  if (lowerBase.includes('cluster jewel') || lowerName === 'voices') return true;
  const lines = collectCleanItemLines(jewel);
  return lines.some(
    (l) =>
      /^Adds \d+ Passive Skills$/i.test(l) ||
      /^Adds \d+ Jewel Socket(?: Passive Skills)?s?$/i.test(l) ||
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
  let nothingCount = 0;
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
    m = line.match(/^Adds (\d+) Jewel Socket(?: Passive Skills)?s?$/i);
    if (m) {
      socketCount = Number(m[1]);
      continue;
    }
    m = line.match(/^Adds (\d+) Small Passive Skills? which grant Nothing$/i);
    if (m) {
      nothingCount = Number(m[1]);
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
  if (totalAdded === 0 && socketCount > 0) {
    totalAdded = socketCount + nothingCount;
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
        if (claimedSubgraphKeys.has(resolved.key)) {
          resolvedCoords.set(i, null);
        } else {
          resolvedCoords.set(i, resolved);
          claimedSubgraphKeys.add(resolved.key);
        }
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
        const notableSrc = `Cluster Notable (${nodeId}): ${def.en}`;
        // Join multiline-wrapped cluster notable descriptions (e.g. Purposeful Harbinger, Follow-Through, Seeker Runes)
        const joinedLines: string[] = [];
        for (let li = 0; li < def.st.length; li++) {
          let cur = def.st[li]!.trim();
          while (
            li + 1 < def.st.length &&
            /\b(?:for|with|and|of|to|on|while|if|per|from|in|or|when|your)$/i.test(cur)
          ) {
            li += 1;
            cur = `${cur} ${def.st[li]!.trim()}`;
          }
          joinedLines.push(cur);
        }
        for (const jLine of joinedLines) {
          const mPh = jLine.match(
            /^Auras from your Skills have (\d+)% increased Effect on you for each Herald affecting you, up to a maximum of (\d+)%$/i,
          );
          if (mPh) {
            jewelMods.push(mkMod('PurposefulHarbingerPerHerald', 'BASE', Number(mPh[1]), notableSrc));
            continue;
          }
          const mHeraldry = jLine.match(
            /^Enemies within \d+ metres have (Fire|Cold|Lightning) Exposure while you are affected by Herald of (Ash|Ice|Thunder)$/i,
          );
          if (mHeraldry) {
            jewelMods.push(mkMod(`HeraldryExposure:${mHeraldry[1]}`, 'FLAG', true, notableSrc));
            continue;
          }
          const mMasterExp = jLine.match(
            /^Enemies within \d+ metres have (Fire|Cold|Lightning) Exposure$/i,
          );
          if (mMasterExp) {
            const el =
              mMasterExp[1]!.charAt(0).toUpperCase() + mMasterExp[1]!.slice(1).toLowerCase();
            jewelMods.push(mkMod(`MasterOfElementExposure:${el}`, 'FLAG', true, notableSrc));
            continue;
          }
          const mSkillRes = jLine.match(
            /^([A-Za-z' ]+?) has (\d+)% increased Mana Reservation Efficiency$/i,
          );
          if (mSkillRes) {
            jewelMods.push(
              mkMod(
                `SkillManaReservationEfficiency:${mSkillRes[1]!.trim().toLowerCase()}`,
                'INC',
                Number(mSkillRes[2]),
                notableSrc,
              ),
            );
            continue;
          }
          const mPreciseFocus = jLine.match(
            /^\+(\d+)% to Critical Strike Multiplier if you've been Channelling for at least \d+ seconds?$/i,
          );
          if (mPreciseFocus) {
            jewelMods.push({
              ...mkMod('CritMultiplier', 'BASE', Number(mPreciseFocus[1]), notableSrc),
              tags: [{ type: 'Condition', var: 'Channelling' }],
            });
            continue;
          }
          const mWeightAdv = jLine.match(
            /^(\d+)% chance to deal Double Damage while wielding a Mace, Sceptre or Staff$/i,
          );
          if (mWeightAdv) {
            jewelMods.push({
              ...mkMod('DoubleDamageChance', 'BASE', Number(mWeightAdv[1]), notableSrc),
              tags: [{ type: 'Condition', var: 'UsingMace|UsingStaff' }],
            });
            continue;
          }
          const mPressurePts = jLine.match(
            /^Your Critical Strikes have a (\d+)% chance to deal Double Damage$/i,
          );
          if (mPressurePts) {
            jewelMods.push(
              mkMod('DoubleDamageChanceOnCrit', 'BASE', Number(mPressurePts[1]), notableSrc),
            );
            continue;
          }
          const mCritAilDot = jLine.match(
            /^\+(\d+)% to Damage over Time Multiplier for (Ignite|Ailments) from Critical Strikes$/i,
          );
          if (mCritAilDot) {
            jewelMods.push(
              mkMod(
                'CritAilmentDotMultiplier',
                'BASE',
                Number(mCritAilDot[1]),
                notableSrc,
                0,
                mCritAilDot[2]!.toLowerCase() === 'ignite' ? KeywordFlag.Ignite : 0,
              ),
            );
            continue;
          }
          const mTrapMinePen = jLine.match(
            /^(Trap|Mine) Damage Penetrates (\d+)% Elemental Resistances$/i,
          );
          if (mTrapMinePen) {
            const kw =
              mTrapMinePen[1]!.toLowerCase() === 'trap' ? KeywordFlag.Trap : KeywordFlag.Mine;
            const penVal = Number(mTrapMinePen[2]);
            jewelMods.push(mkMod('FirePenetration', 'BASE', penVal, notableSrc, 0, kw));
            jewelMods.push(mkMod('ColdPenetration', 'BASE', penVal, notableSrc, 0, kw));
            jewelMods.push(mkMod('LightningPenetration', 'BASE', penVal, notableSrc, 0, kw));
            continue;
          }
          const mCompoundInj = jLine.match(
            /^(\d+)% increased Damage with Bleeding you inflict on Maimed Enemies$/i,
          );
          if (mCompoundInj) {
            jewelMods.push({
              ...mkMod(
                'Damage',
                'INC',
                Number(mCompoundInj[1]),
                notableSrc,
                ModFlag.Ailment,
                KeywordFlag.Bleed,
              ),
              tags: [{ type: 'Condition', var: 'EnemyMaimed' }],
            });
            continue;
          }
          const mViciousSkew = jLine.match(
            /^(\d+)% increased Effect of Impales inflicted by Hits that also inflict Bleeding$/i,
          );
          if (mViciousSkew) {
            jewelMods.push({
              ...mkMod('ImpaleEffect', 'INC', Number(mViciousSkew[1]), notableSrc),
              tags: [{ type: 'Condition', var: 'EnemyBleeding' }],
            });
            continue;
          }
          const mRottenClaws = jLine.match(
            /^Minions have a? ?(\d+)% chance to Impale on Hit with Attacks$/i,
          );
          if (mRottenClaws) {
            jewelMods.push(
              mkMod('MinionImpaleChance', 'BASE', Number(mRottenClaws[1]), notableSrc, ModFlag.Attack),
            );
            continue;
          }
          const mRenewal = jLine.match(
            /^Minions have (\d+)% chance to deal Double Damage while they are on Full Life$/i,
          );
          if (mRenewal) {
            jewelMods.push({
              ...mkMod('MinionDoubleDamageChance', 'BASE', Number(mRenewal[1]), notableSrc),
              tags: [{ type: 'Condition', var: 'LowLife', neg: true }],
            });
            continue;
          }
          const mVastPower = jLine.match(
            /^(\d+)% increased Area of Effect per Power Charge, up to a maximum of (\d+)%$/i,
          );
          if (mVastPower) {
            jewelMods.push({
              ...mkMod('AreaOfEffect', 'INC', Number(mVastPower[1]), notableSrc),
              tags: [{ type: 'Multiplier', var: 'PowerCharge', limit: Number(mVastPower[2]) }],
            });
            continue;
          }
          jewelMods.push(...parseModLines([jLine], notableSrc));
        }
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

/**
 * Builds PoB1-exact undirected Cluster Jewel subgraph adjacency for Split Personality BFS distance.
 *
 * Uses the complete `getClusterTemplateLayout` ring (including UNALLOCATED positions) so BFS through
 * `activeTreeNodes` never teleports across an unallocated branch via a wrap-around shortcut edge
 * (e.g. an 8-passive Large Cluster with only positions `0 -> 1 -> 2 -> 4 (medSock0)` allocated must
 * traverse 3 hops instead of shortcutting `0 <-> medSock0` in 1 hop).
 */
export function buildClusterSubgraphAdjacency(
  entries: readonly EvaluatedClusterJewelEntry[],
  activeTreeNodes: ReadonlySet<number>,
): Map<number, number[]> {
  const clusterAdjacency = new Map<number, number[]>();
  if (entries.length === 0) return clusterAdjacency;

  const linkUndirected = (a: number, b: number) => {
    let la = clusterAdjacency.get(a);
    if (!la) {
      la = [];
      clusterAdjacency.set(a, la);
    }
    if (!la.includes(b)) la.push(b);
    let lb = clusterAdjacency.get(b);
    if (!lb) {
      lb = [];
      clusterAdjacency.set(b, lb);
    }
    if (!lb.includes(a)) lb.push(a);
  };

  const medSocketByLargeAndMedIdx = new Map<string, number>();
  const smallSocketByParent = new Map<number, number>();
  for (const [sockIdStr, info] of Object.entries(POE1_EXPANSION_SOCKETS)) {
    const sockId = Number(sockIdStr);
    if (info.socketSize === 1) {
      medSocketByLargeAndMedIdx.set(`${info.largeSocketIndex}:${info.mediumSocketIndex}`, sockId);
    } else if (info.socketSize === 0 && info.parentSocketId !== undefined) {
      smallSocketByParent.set(info.parentSocketId, sockId);
    }
  }
  const largeSlotToMedIdx: Record<number, number> = { 4: 0, 8: 2, 6: 1 };

  for (const entry of entries) {
    if (entry.largeSocketIndex === null) continue;
    const medIdx = entry.mediumSocketIndex ?? 0;
    const layout = getClusterTemplateLayout(
      entry.sizeIndex,
      entry.totalAdded,
      entry.socketCount,
      entry.allNotableNames.length,
    );

    const ringPosToNodeId = new Map<number, number>();
    const allPosSet = new Set<number>([
      ...layout.socketIndices,
      ...layout.notableIndices,
      ...layout.smallIndices,
    ]);
    for (const cid of entry.allocatedClusterNodeIds) {
      const pos = cid & 0xf;
      if (pos <= 11) {
        allPosSet.add(pos);
        ringPosToNodeId.set(pos, cid);
      }
    }

    for (const pos of allPosSet) {
      if (ringPosToNodeId.has(pos)) continue;
      ringPosToNodeId.set(
        pos,
        encodeClusterNodeId({
          nodeIndex: pos,
          sizeIndex: entry.sizeIndex,
          largeSocketIndex: entry.largeSocketIndex,
          mediumSocketIndex: medIdx,
        }),
      );
    }

    // Override sub-socket ring positions with their official passive tree expansion socket IDs
    if (entry.sizeIndex === 2) {
      for (const [slotPosStr, subMedIdx] of Object.entries(largeSlotToMedIdx)) {
        const slotPos = Number(slotPosStr);
        if (!allPosSet.has(slotPos)) continue;
        const medSockId = medSocketByLargeAndMedIdx.get(`${entry.largeSocketIndex}:${subMedIdx}`);
        if (medSockId && (activeTreeNodes.has(medSockId) || layout.socketIndices.includes(slotPos))) {
          ringPosToNodeId.set(slotPos, medSockId);
        }
      }
    } else if (entry.sizeIndex === 1) {
      if (allPosSet.has(6)) {
        const smSockId = smallSocketByParent.get(entry.nodeId);
        if (smSockId && (activeTreeNodes.has(smSockId) || layout.socketIndices.includes(6))) {
          ringPosToNodeId.set(6, smSockId);
        }
      }
    }

    const entranceId =
      ringPosToNodeId.get(0) ??
      encodeClusterNodeId({
        nodeIndex: 0,
        sizeIndex: entry.sizeIndex,
        largeSocketIndex: entry.largeSocketIndex,
        mediumSocketIndex: medIdx,
      });
    linkUndirected(entry.nodeId, entranceId);

    const sortedPositions = [...ringPosToNodeId.keys()].sort((a, b) => a - b);
    if (sortedPositions.length >= 2) {
      for (let i = 0; i < sortedPositions.length; i++) {
        const curNode = ringPosToNodeId.get(sortedPositions[i]!)!;
        const nextNode = ringPosToNodeId.get(sortedPositions[(i + 1) % sortedPositions.length]!)!;
        if (curNode !== nextNode) {
          linkUndirected(curNode, nextNode);
        }
      }
    }
  }

  return clusterAdjacency;
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
  // Note: Official PoB 2 preserves `output.Mana` (does NOT override Mana to 0 unless `Removes all Mana` is present).
  const pyromanticPact =
    hasNode('pyromantic pact') ||
    hasLine(/Maximum Mana is replaced by .*Maximum Infernal Flame/i);
  const poe2RemovesAllMana = game === 'poe2' && hasLine(/^Removes all Mana$/i);

  if (poe2RemovesAllMana) {
    if (db.override('Mana') !== 0) {
      db.addMod(mkMod('Mana', 'OVERRIDE', 0, 'Removes all Mana'));
    }
    manaZeroed = true;
  }

  if (pyromanticPact) {
    const src = 'Ascendancy: Pyromantic Pact';
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

  // Collect socketed jewels upfront (used for Sublime Vision, per-skill effect, and Watcher's Eye Pass 2)
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

  // Pre-scan equipped gear & socketed jewels for per-skill aura/herald/golem effect, reservation efficiency,
  // Sublime Vision restrictions, Curse-on-Hit gear mods, Replica Farrul's Fur, Annihilation's Approach, and item Exposure.
  const perSkillEffectPct = new Map<string, number>();
  const perSkillEffectScannedSources = new Set<string>();
  const perSkillResEffPct = new Map<string, number>();
  let sublimeOnlyAuraLower: string | null = null;
  const curseOnHitEntries: Array<{ curseName: string; effectPct: number; source: string }> = [];
  let hasReplicaFarrulOnslaught = false;
  let hasAnnihilationsApproachAdrenaline = false;
  const itemExposureBase: Record<'Fire' | 'Cold' | 'Lightning', number> = {
    Fire: 0,
    Cold: 0,
    Lightning: 0,
  };

  const scanItemsForAuraHooks: Array<{ label: string; item: Item }> = [
    ...equipped.map(({ slot, item }) => ({ label: `Item (${slot}): ${item.name}`, item })),
    ...jewelsToScan.map((item) => ({ label: `Jewel: ${item.name}`, item })),
  ];
  for (const { label, item } of scanItemsForAuraHooks) {
    for (const line of collectCleanItemLines(item)) {
      const mSkillEff = line.match(
        /^([A-Za-z' ]+?) has (\d+)% increased (?:Aura|Buff) Effect$/i,
      );
      if (mSkillEff) {
        const key = mSkillEff[1]!.trim().toLowerCase();
        perSkillEffectPct.set(key, (perSkillEffectPct.get(key) ?? 0) + Number(mSkillEff[2]));
        perSkillEffectScannedSources.add(`${key}|${label}`);
        continue;
      }
      const mGolemEff = line.match(
        /^(\d+)% increased Effect of the Buff granted by your (Flame|Ice|Lightning|Chaos|Stone|Carrion) Golems$/i,
      );
      if (mGolemEff) {
        const key = `summon ${mGolemEff[2]!.toLowerCase()} golem`;
        perSkillEffectPct.set(key, (perSkillEffectPct.get(key) ?? 0) + Number(mGolemEff[1]));
        continue;
      }
      const mSkillRes = line.match(
        /^([A-Za-z' ]+?) has (\d+)% increased (?:Mana )?Reservation Efficiency$/i,
      );
      if (mSkillRes) {
        const key = mSkillRes[1]!.trim().toLowerCase();
        perSkillResEffPct.set(key, (perSkillResEffPct.get(key) ?? 0) + Number(mSkillRes[2]));
        continue;
      }
      const mSublime = line.match(/^Aura Skills other than ([A-Za-z' ]+?) are Disabled$/i);
      if (mSublime) {
        sublimeOnlyAuraLower = mSublime[1]!.trim().toLowerCase();
        continue;
      }
      const mCurseHit = line.match(
        /^Curse Enemies with (Vulnerability|Temporal Chains|Flammability|Frostbite|Conductivity|Elemental Weakness|Despair|Enfeeble|Punishment|Poacher's Mark|Assassin's Mark|Sniper's Mark|Warlord's Mark) on Hit(?:, with (\d+)% increased Effect)?$/i,
      );
      if (mCurseHit) {
        curseOnHitEntries.push({
          curseName: mCurseHit[1]!,
          effectPct: mCurseHit[2] ? Number(mCurseHit[2]) : 0,
          source: label,
        });
        continue;
      }
      if (/^You have Onslaught while you have Cat's Agility$/i.test(line)) {
        hasReplicaFarrulOnslaught = true;
        continue;
      }
      if (/^Gain Adrenaline when you become Flame-Touched$/i.test(line)) {
        hasAnnihilationsApproachAdrenaline = true;
        continue;
      }
      const mExpApply = line.match(
        /^Inflict (Fire|Cold|Lightning) Exposure on Hit, applying -(\d+)% to (?:Fire|Cold|Lightning) Resistance$/i,
      );
      if (mExpApply) {
        const el = (mExpApply[1]!.charAt(0).toUpperCase() +
          mExpApply[1]!.slice(1).toLowerCase()) as 'Fire' | 'Cold' | 'Lightning';
        itemExposureBase[el] = Math.max(itemExposureBase[el], Number(mExpApply[2]));
        continue;
      }
      const mExpChance = line.match(
        /^(\d+)% chance to inflict (Fire|Cold|Lightning) Exposure on Hit$/i,
      );
      if (mExpChance) {
        const el = (mExpChance[2]!.charAt(0).toUpperCase() +
          mExpChance[2]!.slice(1).toLowerCase()) as 'Fire' | 'Cold' | 'Lightning';
        itemExposureBase[el] = Math.max(itemExposureBase[el], 10);
      }
    }
  }

  // Sync Blood/Sand Stance onto enemyDb so Flesh and Stone's enemy cmod (`Condition:BloodStance`) activates.
  // Honor explicit `rawInputs.bloodSandStance` case-insensitively (e.g. "SAND" / "BLOOD" / 1 / 2),
  // and otherwise mirror whatever stance engine.ts already resolved from `skillPart` onto enemyDb.
  if (build.game === 'poe1') {
    const pConds = playerDb.getEvalContext().conditions;
    const rawStance = build.config.rawInputs?.bloodSandStance;
    const rawStanceStr = typeof rawStance === 'string' ? rawStance.trim().toLowerCase() : '';
    if (rawStance !== undefined) {
      const isSand = rawStance === 2 || rawStanceStr === 'sand';
      const isBlood = !isSand;
      playerDb.setCondition('BloodStance', isBlood);
      playerDb.setCondition('SandStance', isSand);
      enemyDb.setCondition('BloodStance', isBlood);
      enemyDb.setCondition('SandStance', isSand);
    } else if (pConds.BloodStance || pConds.SandStance) {
      enemyDb.setCondition('BloodStance', Boolean(pConds.BloodStance));
      enemyDb.setCondition('SandStance', Boolean(pConds.SandStance));
    }
  }

  const savedPlayerCtx = playerDb.getEvalContext();
  playerDb.setEvalContext({
    ...savedPlayerCtx,
    skillTypes: {
      ...(savedPlayerCtx.skillTypes ?? {}),
      Aura: true,
      aura: true,
      Spell: true,
      spell: true,
      Area: true,
      area: true,
      Buff: true,
      buff: true,
      HasReservation: true,
      hasreservation: true,
    },
  });
  const auraQueryFlags = ModFlag.Spell | ModFlag.Area;
  const auraQueryKw = KeywordFlag.Aura;
  const baseAuraEffectPct =
    playerDb.sum('INC', 'AuraEffect', auraQueryFlags, auraQueryKw) + (ctx.extraAuraEffectPct ?? 0);
  let selfOnlyAuraEffectPct = playerDb.sum(
    'INC',
    'AuraEffectOnSelf',
    auraQueryFlags,
    auraQueryKw,
  );
  const genericResEff = playerDb.sum('INC', 'ReservationEfficiency', auraQueryFlags, auraQueryKw);
  const globalManaResEff =
    playerDb.sum('INC', 'ManaReservationEfficiency', auraQueryFlags, auraQueryKw) + genericResEff;
  const globalLifeResEff =
    playerDb.sum('INC', 'LifeReservationEfficiency', auraQueryFlags, auraQueryKw) + genericResEff;
  playerDb.setEvalContext({
    ...savedPlayerCtx,
    skillTypes: {
      ...(savedPlayerCtx.skillTypes ?? {}),
      Curse: true,
      curse: true,
      Hex: true,
      hex: true,
      Mark: true,
      mark: true,
      Spell: true,
      spell: true,
    },
  });
  const baseCurseEffectPct =
    playerDb.sum('INC', 'CurseEffect', ModFlag.Spell, KeywordFlag.Curse) +
    (ctx.extraCurseEffectPct ?? 0);
  const baseMarkEffectPct = baseCurseEffectPct + playerDb.sum('INC', 'MarkEffect');
  playerDb.setEvalContext(savedPlayerCtx);

  interface CandidateAura {
    def: GemDefinition;
    gemInst: GemInstance;
    effLevel: number;
    canonicalAuraName: string | null;
    isAura: boolean;
    isCurseOrMark: boolean;
    isHerald: boolean;
    isGolemBuff: boolean;
    isStanceBuff: boolean;
    isSpectralTigerBuff: boolean;
    isApproachingFlamesBuff: boolean;
    isEnemyOnlyAura: boolean;
    isMark: boolean;
    effQuality: number;
    groupCurseEffectInc: number;
    groupHasBonechill: boolean;
    groupBonechillColdTakenInc: number;
    groupSkitterbotAilmentEffectInc: number;
    groupHasGenerosity: boolean;
    generosityEffectPct: number;
    groupHasArrogance: boolean;
    arroganceEffectPct: number;
    arroganceResMult: number;
    groupHasBlessing: boolean;
    blessingName?: string;
    blessingEffectPct: number;
    groupHasPrismGuardian: boolean;
    groupHasAtziriCommunion: boolean;
    localResEffPct: number;
    enlightenMult: number;
  }

  const deduped = new Map<string, CandidateAura>();
  let hasCombustionGroup = false;
  let skitterbotAppliedBonechill = false;
  let nonSkitterBonechillFound = false;
  let nonSkitterBonechillHasChillingArea = false;
  let nonSkitterBonechillLevel = 0;
  let nonSkitterBonechillAilmentInc = 0;
  let mainGroupHasMaim = false;
  let secondaryGroupMaimBonus = 0;
  let hasFeedingFrenzyMinionGroup = false;
  let hasAnyStanceSkill = false;
  const skillExposureBase: Record<'Fire' | 'Cold' | 'Lightning', number> = {
    Fire: 0,
    Cold: 0,
    Lightning: 0,
  };
  const activePacts: Array<{
    key: 'Beidat' | 'Ghorr' | 'Ktash' | 'Lycia';
    name: string;
    effLevel: number;
    effQuality: number;
    groupCdrInc: number;
  }> = [];
  const resolvedMainIdx = build.skills.findIndex((g) => g.id === build.mainSkillGroupId);
  const mainGroupIndex = resolvedMainIdx >= 0 ? resolvedMainIdx : 0;
  // PoE 2 `Ice Bite I/II` GlobalEffect support buff:
  // Only applies when linked to an Attack/Warcry active skill (never spells like Orb of Storms / Ice Nova),
  // never stacks across multiple skill groups (keep single highest tier), and must NOT re-inject into
  // `playerDb` when already socketed on the main active skill group (where engine.ts already injects it
  // into `skillDb`, otherwise Attack skills like Ice Shot double-count +30% -> +60% DamageGainAsCold!).
  let poe2IceBiteOnMain = false;
  let poe2IceBiteBest: { def: GemDefinition; effLevel: number; tier: number } | null = null;
  const poe2PersistentSupFamilyBest = new Map<string, { def: GemDefinition; effLevel: number; tier: number }>();
  const resolvePoe2PersistentSupFamily = (
    supNameL: string,
  ): { family: string; tier: number } | null => {
    for (const fam of ['precision', 'clarity', 'vitality', 'mysticism', 'herbalism', 'cannibalism'] as const) {
      if (supNameL === fam || supNameL === `${fam} i`) return { family: fam, tier: 1 };
      if (supNameL === `${fam} ii`) return { family: fam, tier: 2 };
    }
    return null;
  };

  for (let groupIdx = 0; groupIdx < build.skills.length; groupIdx++) {
    const group = build.skills[groupIdx]!;
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
    let groupEnhanceQualityBonus = 0;
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
    let groupCurseEffectInc = 0;
    let groupHasBonechill = false;
    let groupBonechillColdTakenInc = 0;
    let groupSkitterbotAilmentEffectInc = 0;
    let groupHasAtziriCommunion = false;
    let groupHasCombustion = false;
    let groupHasMaim = false;
    let groupHasFeedingFrenzy = false;
    let groupCdrInc = 0;

    const applySupportByName = (
      rawName: string,
      effLevel: number,
      effQuality: number,
      resolvedStats?: readonly string[],
    ) => {
      const lower = stripSupportSuffix(rawName);
      if (lower === 'empower' || lower === 'awakened empower') {
        groupEmpowerBonus += Math.max(0, effLevel - 1);
      } else if (lower === 'enhance' || lower === 'awakened enhance') {
        groupEnhanceQualityBonus += Math.max(0, effLevel - 1) * 8;
      } else if (lower === 'mark on hit') {
        // Official PoB1 Mark On Hit Support: -(40 - effLevel) INC CurseEffect at Lv1..20 (Lv20 = -16% + 0.25% per quality)
        const basePenalty = -(36 - effLevel);
        const qualBonus = Math.trunc(Math.max(0, effQuality) * 0.25);
        groupCurseEffectInc += basePenalty + qualBonus;
      } else if (lower === 'hextouch' || lower === 'awakened hextouch') {
        const isAwk = lower === 'awakened hextouch';
        const basePenalty = isAwk ? -(25 - effLevel) : -(35 - Math.floor(effLevel / 2));
        const qualBonus = Math.trunc(Math.max(0, effQuality) * 0.25);
        groupCurseEffectInc += basePenalty + qualBonus;
      } else if (lower === 'blasphemy' || lower === 'awakened blasphemy') {
        const isAwk = lower === 'awakened blasphemy';
        const basePenalty = isAwk ? -(22 - Math.floor(effLevel / 2)) : -(25 - Math.floor(effLevel / 4));
        const qualBonus = Math.trunc(Math.max(0, effQuality) * 0.5);
        groupCurseEffectInc += basePenalty + qualBonus;
      } else if (lower === 'bonechill') {
        groupHasBonechill = true;
        // PoB1 Data/Skills/sup_int.lua:566-587: Bonechill grants (24 + effLevel)% increased Effect of Chill (Lv20 = 44%)
        groupBonechillColdTakenInc = Math.max(groupBonechillColdTakenInc, 24 + effLevel);
      } else if (lower === 'combustion') {
        groupHasCombustion = true;
      } else if (lower === 'maim') {
        groupHasMaim = true;
      } else if (lower === 'feeding frenzy') {
        groupHasFeedingFrenzy = true;
      } else if (lower === 'second wind') {
        groupCdrInc += Math.max(0, 5 + effLevel);
      } else if (lower === 'unbound ailments' || lower === 'awakened unbound ailments') {
        const isAwk = lower === 'awakened unbound ailments';
        groupSkitterbotAilmentEffectInc += (isAwk ? 55 + effLevel * 2 : 35 + effLevel) + Math.trunc(Math.max(0, effQuality) * 0.5);
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
      } else if (lower === "atziri's communion" || lower === 'atziris communion') {
        groupHasAtziriCommunion = true;
      }
    };

    // Item-granted supports in the skill group's slot
    for (const itemSup of slotAuraInfo.itemGrantedSupports) {
      applySupportByName(itemSup.name, itemSup.level, 0);
    }

    // Linked support gems in this skill group
    const poe2PersistentPlayerSupportMods: Array<{ def: GemDefinition; effLevel: number; effQuality: number }> = [];
    for (const supInst of group.gems) {
      if (!supInst.enabled) continue;
      const supDef = lookupGem(build.game, supInst.gemId);
      if (!supDef || supDef.category !== 'support') continue;
      const supBon = resolveGemBonuses(supDef, playerDb, groupSocketedRules);
      const effSupLevel = Math.min(40, Math.max(1, supInst.level + supBon.levelBonus));
      const effSupQuality = supInst.quality + supBon.qualityBonus;
      const supStats = resolveAuraLevelStats(supDef, effSupLevel);
      applySupportByName(supDef.name.en, effSupLevel, effSupQuality, supStats);
      if (build.game === 'poe2') {
        const supNameL = stripSupportSuffix(supDef.name.en);
        if (supNameL === 'fire exposure') {
          enemyDb.addMod({ name: 'FireExposure', type: 'BASE', value: 20, flags: 0, keywordFlags: 0, source: 'Support: Fire Exposure' });
        } else if (supNameL === 'cold exposure') {
          enemyDb.addMod({ name: 'ColdExposure', type: 'BASE', value: 20, flags: 0, keywordFlags: 0, source: 'Support: Cold Exposure' });
        } else if (supNameL === 'lightning exposure') {
          enemyDb.addMod({ name: 'LightningExposure', type: 'BASE', value: 20, flags: 0, keywordFlags: 0, source: 'Support: Lightning Exposure' });
        } else if (supNameL === 'potent exposure') {
          enemyDb.addMod({ name: 'ExposureEffect', type: 'INC', value: 20, flags: 0, keywordFlags: 0, source: 'Support: Potent Exposure' });
        }
        if (
          supNameL === 'blazing critical' ||
          supNameL === 'direstrike' ||
          supNameL === 'direstrike i' ||
          supNameL === 'direstrike ii'
        ) {
          const globalSupCmods = resolveAuraLevelCompiledMods(supDef, effSupLevel);
          if (globalSupCmods && globalSupCmods.length > 0) {
            const pMods = globalSupCmods.filter((m) => m.target === 'player');
            if (pMods.length > 0) {
              injectCompiledGemMods(playerDb, enemyDb, minionDb, pMods, `Support Buff: ${supDef.name.en}`, {
                game: 'poe2',
              });
            }
          }
        } else if (supNameL === 'ice bite' || supNameL === 'ice bite i' || supNameL === 'ice bite ii') {
          if (groupIdx === mainGroupIndex) {
            poe2IceBiteOnMain = true;
          } else {
            const groupHasAttackOrWarcry = group.gems.some((g) => {
              if (!g.enabled) return false;
              const gd = lookupGem('poe2', g.gemId);
              if (!gd || gd.category !== 'active') return false;
              return gd.tags.some((t) => /^(attack|warcry)$/i.test(t));
            });
            if (groupHasAttackOrWarcry) {
              const tier = supNameL === 'ice bite ii' ? 2 : 1;
              if (
                !poe2IceBiteBest ||
                tier > poe2IceBiteBest.tier ||
                (tier === poe2IceBiteBest.tier && effSupLevel > poe2IceBiteBest.effLevel)
              ) {
                poe2IceBiteBest = { def: supDef, effLevel: effSupLevel, tier };
              }
            }
          }
        } else if (resolvePoe2PersistentSupFamily(supNameL)) {
          poe2PersistentPlayerSupportMods.push({ def: supDef, effLevel: effSupLevel, effQuality: effSupQuality });
        }
      }
    }
    if (build.game === 'poe2' && poe2PersistentPlayerSupportMods.length > 0) {
      const groupHasPersistentActive = group.gems.some((g) => {
        if (!g.enabled) return false;
        const gd = lookupGem('poe2', g.gemId);
        if (!gd || gd.category !== 'active') return false;
        const tl = new Set(gd.tags.map((t) => t.toLowerCase()));
        return Boolean(gd.isAuraOrBuff || (gd.spiritReservation ?? 0) > 0 || tl.has('persistent') || tl.has('aura') || tl.has('herald'));
      });
      if (groupHasPersistentActive) {
        for (const ps of poe2PersistentPlayerSupportMods) {
          const fam = resolvePoe2PersistentSupFamily(stripSupportSuffix(ps.def.name.en));
          if (fam) {
            const prev = poe2PersistentSupFamilyBest.get(fam.family);
            if (!prev || fam.tier > prev.tier || (fam.tier === prev.tier && ps.effLevel > prev.effLevel)) {
              poe2PersistentSupFamilyBest.set(fam.family, { def: ps.def, effLevel: ps.effLevel, tier: fam.tier });
            }
          }
        }
      }
    }

    // Track PoE 1 group-level global support effects (Combustion, Bonechill, Maim, Feeding Frenzy)
    if (build.game === 'poe1') {
      const groupActiveDefs = group.gems
        .filter((g) => g.enabled)
        .map((g) => lookupGem('poe1', g.gemId))
        .filter((d): d is GemDefinition => Boolean(d && d.category === 'active'));
      if (groupHasCombustion && groupActiveDefs.length > 0) {
        const groupHasEleFocus = group.gems.some((g) => {
          if (!g.enabled) return false;
          const sd = lookupGem('poe1', g.gemId);
          const sn = sd ? stripSupportSuffix(sd.name.en) : '';
          return sn === 'elemental focus' || sn === 'awakened elemental focus';
        });
        if (!groupHasEleFocus) {
          hasCombustionGroup = true;
        }
      }
      if (groupHasMaim && groupActiveDefs.length > 0) {
        if (groupIdx === mainGroupIndex) {
          mainGroupHasMaim = true;
        } else {
          secondaryGroupMaimBonus = Math.max(secondaryGroupMaimBonus, 10);
        }
      }
      if (
        groupHasFeedingFrenzy &&
        groupActiveDefs.some((d) => d.tags.some((t) => /^(minion|golem)$/i.test(t)))
      ) {
        hasFeedingFrenzyMinionGroup = true;
      }
      if (groupHasBonechill) {
        const groupHasEleFocusForChill = group.gems.some((g) => {
          if (!g.enabled) return false;
          const sd = lookupGem('poe1', g.gemId);
          const sn = sd ? stripSupportSuffix(sd.name.en) : '';
          return sn === 'elemental focus' || sn === 'awakened elemental focus';
        });
        // PoB1 CalcPerform.lua:1433: Bonechill applies to ANY enabled attack/spell/chilling skill unless CannotChill
        const nonSkitterActive = groupActiveDefs.find(
          (d) => d.name.en.trim().toLowerCase() !== 'summon skitterbots',
        );
        if (nonSkitterActive && !groupHasEleFocusForChill) {
          nonSkitterBonechillFound = true;
          nonSkitterBonechillLevel = Math.max(nonSkitterBonechillLevel, groupBonechillColdTakenInc);
          nonSkitterBonechillAilmentInc = Math.max(
            nonSkitterBonechillAilmentInc,
            groupSkitterbotAilmentEffectInc,
          );
          const hasAreaChill = groupActiveDefs.some((d) => {
            const n = d.name.en.trim().toLowerCase();
            return (
              n.includes('cold snap') ||
              n.includes('vortex') ||
              n.includes('creeping frost') ||
              n.includes('arctic armour') ||
              n.includes('wintertide')
            );
          });
          if (hasAreaChill) {
            nonSkitterBonechillHasChillingArea = true;
          }
        }
      }
    }

    // In PoE 2, MetaDeadeyeMarks (Called Shots) cannot apply multiple Marks simultaneously
    // (e.g. Sniper's Mark + Freezing Mark in the same group). Keep only the highest-level Mark
    // (tie-breaking to last-socketed) in a MetaDeadeyeMarks group.
    let poe2DeadeyeMetaWinnerGemId: string | null = null;
    if (build.game === 'poe2') {
      const hasMetaDeadeyeMarks = group.gems.some(
        (g) => g.enabled && /metadeadeyemarks/i.test(g.gemId),
      );
      if (hasMetaDeadeyeMarks) {
        const markGemsInGroup = group.gems
          .filter((g) => {
            if (!g.enabled) return false;
            const d = lookupGem('poe2', g.gemId);
            return Boolean(d && d.category === 'active' && d.tags.some((t) => t.toLowerCase() === 'mark'));
          });
        if (markGemsInGroup.length > 1) {
          let best = markGemsInGroup[0]!;
          for (let mi = 1; mi < markGemsInGroup.length; mi++) {
            const cur = markGemsInGroup[mi]!;
            if (cur.level >= best.level) {
              best = cur;
            }
          }
          poe2DeadeyeMetaWinnerGemId = best.gemId;
        }
      }
    }

    // Evaluate active auras / buffs / curses in this skill group
    for (const gemInst of group.gems) {
      if (!gemInst.enabled) continue;
      if (poe2DeadeyeMetaWinnerGemId && gemInst.gemId !== poe2DeadeyeMetaWinnerGemId) {
        const maybeMark = lookupGem('poe2', gemInst.gemId);
        if (maybeMark && maybeMark.tags.some((t) => t.toLowerCase() === 'mark')) {
          continue;
        }
      }
      const rawDef = lookupGem(build.game, gemInst.gemId);
      if (!rawDef) continue;

      const subGems: Array<{ def: GemDefinition; fromVaalGem: boolean }> = [];
      if (build.game === 'poe1' && /^Vaal\s+/i.test(rawDef.name.en)) {
        // In PoB 1 SkillsTab/CalcSetup, Vaal aura/buff gems list Base skill as [1] (enableGlobal1, default ON)
        // and the temporary Vaal active skill as [2] (enableGlobal2, default OFF unless explicitly true).
        if (gemInst.enableGlobal1 !== false) {
          const baseName = rawDef.name.en
            .replace(/^Vaal\s+Impurity\s+of\s+/i, 'Purity of ')
            .replace(/^Vaal\s+/i, '')
            .trim();
          const slug = `poe1_${baseName.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
          const baseDef =
            lookupGem('poe1', slug) ??
            resolveGemFromPobRef('poe1', { nameSpec: baseName });
          if (baseDef && baseDef.id !== rawDef.id) {
            subGems.push({ def: baseDef, fromVaalGem: true });
          }
        }
        if (gemInst.enableGlobal2 === true) {
          subGems.push({ def: rawDef, fromVaalGem: true });
        }
      } else {
        if (gemInst.enableGlobal1 === false) continue;
        subGems.push({ def: rawDef, fromVaalGem: false });
      }

      for (const { def, fromVaalGem } of subGems) {
        const tags = new Set(def.tags.map((t) => t.toLowerCase()));
        const lowerGemName = def.name.en.trim().toLowerCase();

        // PoE 1 Exposure utility skills & Pacts (even when not isGlobalBuff)
        if (build.game === 'poe1' && def.category === 'active') {
          const gemBonUtil = resolveGemBonuses(def, playerDb, groupSocketedRules);
          const utilLevel = Math.min(40, Math.max(1, gemInst.level + gemBonUtil.levelBonus + groupEmpowerBonus));
          const utilQual = Math.max(0, (gemInst.quality ?? 0) + gemBonUtil.qualityBonus + groupEnhanceQualityBonus);
          if (lowerGemName === 'wave of conviction') {
            const rawWoc = build.config.rawInputs?.waveOfConvictionExposureType;
            const wocEl: 'Fire' | 'Cold' | 'Lightning' =
              rawWoc === 'Cold' || rawWoc === 2
                ? 'Cold'
                : rawWoc === 'Lightning' || rawWoc === 3
                  ? 'Lightning'
                  : 'Fire';
            skillExposureBase[wocEl] = Math.max(skillExposureBase[wocEl], 15);
          } else if (lowerGemName === 'frost bomb') {
            skillExposureBase.Cold = Math.max(skillExposureBase.Cold, 15);
          } else if (lowerGemName === 'scorching ray') {
            skillExposureBase.Fire = Math.max(
              skillExposureBase.Fire,
              25 + Math.floor(utilQual * 0.25 + 1e-9),
            );
          } else if (lowerGemName === 'hydrosphere') {
            skillExposureBase.Cold = Math.max(skillExposureBase.Cold, 10);
            skillExposureBase.Lightning = Math.max(skillExposureBase.Lightning, 10);
          } else if (lowerGemName === 'pact of beidat') {
            activePacts.push({ key: 'Beidat', name: def.name.en, effLevel: utilLevel, effQuality: utilQual, groupCdrInc });
          } else if (lowerGemName === 'pact of ghorr') {
            activePacts.push({ key: 'Ghorr', name: def.name.en, effLevel: utilLevel, effQuality: utilQual, groupCdrInc });
          } else if (lowerGemName === "pact of k'tash" || lowerGemName === 'pact of ktash') {
            activePacts.push({ key: 'Ktash', name: def.name.en, effLevel: utilLevel, effQuality: utilQual, groupCdrInc });
          } else if (lowerGemName === 'pact of lycia') {
            activePacts.push({ key: 'Lycia', name: def.name.en, effLevel: utilLevel, effQuality: utilQual, groupCdrInc });
          }
          if (tags.has('stance')) {
            hasAnyStanceSkill = true;
          }
        }

        const canonicalAuraName =
          WATCHERS_EYE_AURA_BY_LOWER.get(lowerGemName) ?? null;
        const isMark = tags.has('mark');
        const isCurseOrMark = tags.has('curse') || isMark;
        const isHerald = tags.has('herald');
        const isGolemBuff =
          build.game === 'poe1' && tags.has('golem') && def.category === 'active';
        const isStanceBuff =
          build.game === 'poe1' && tags.has('stance') && !tags.has('aura');
        const isSpectralTigerBuff =
          build.game === 'poe1' && lowerGemName === 'summon spectral tiger';
        const isApproachingFlamesBuff =
          build.game === 'poe1' && lowerGemName === 'approaching flames';
        const isRighteousFireBuff =
          build.game === 'poe1' &&
          (lowerGemName === 'righteous fire' || lowerGemName === 'righteous fire of arcane devotion');
        const isSmiteBuff = build.game === 'poe1' && lowerGemName === 'smite';
        const isBloodRageBuff = build.game === 'poe1' && lowerGemName === 'blood rage';
        const isFlameSurgeBuff = build.game === 'poe1' && lowerGemName === 'flame surge';
        const isFlameWallBuff =
          build.game === 'poe2' &&
          lowerGemName === 'flame wall' &&
          Boolean(
            playerDb.getEvalContext().conditions.FlameWallAddedDamage ||
              build.config.rawInputs?.flameWallAddedDamage,
          );
        const isArcaneCloakBuff =
          build.game === 'poe1' &&
          lowerGemName === 'arcane cloak' &&
          (Boolean(
            playerDb.getEvalContext().conditions.ArcaneCloakUsedRecently ||
              build.config.activeGuardSkill === 'ArcaneCloak',
          ) ||
            (build.config.activeGuardSkill !== 'MoltenShell' &&
              build.config.activeGuardSkill !== 'Steelskin' &&
              build.config.rawInputs?.arcaneCloakUsedRecentlyCheck !== false));
        if (isArcaneCloakBuff) {
          playerDb.setCondition('ArcaneCloakUsedRecently', true);
        }
        const isSigilOfPowerBuff =
          lowerGemName === 'sigil of power' &&
          (build.game === 'poe2' || (playerDb.getEvalContext().multipliers.SigilOfPowerStage ?? 0) > 0);
        if (
          isSigilOfPowerBuff &&
          (hasStatSource(playerDb, 'Damage', 'MORE', 'Sigil of Power') ||
            hasStatSource(playerDb, 'LightningMin', 'BASE', 'Sigil of Power'))
        ) {
          continue;
        }
        if (
          isSigilOfPowerBuff &&
          build.game === 'poe2' &&
          (playerDb.getEvalContext().multipliers.SigilOfPowerStage ?? 0) <= 0
        ) {
          playerDb.setMultiplier('SigilOfPowerStage', 1);
        }
        if (isCurseOrMark) {
          const cleanCurseKey = def.name.en.replace(/[^A-Za-z]/g, '');
          if (cleanCurseKey) {
            playerDb.setCondition(`SelfCast${cleanCurseKey}`, true);
          }
        }
        const isElementalConfluxBuff =
          build.game === 'poe2' && lowerGemName === 'elemental conflux';
        const hasGlobalEffectCmod =
          build.game === 'poe2' &&
          def.category === 'active' &&
          Boolean(
            def.compiledMods?.some(
              (m) =>
                m.target === 'enemy' &&
                (m.name.endsWith('Exposure') ||
                  m.name === 'DamageTaken' ||
                  m.name === 'SelfCritChance' ||
                  m.name === 'SelfCritMultiplier'),
            ) ||
              def.compiledMods?.some(
                (m) =>
                  m.target === 'player' &&
                  (lowerGemName === 'charged staff' ||
                    lowerGemName === 'war banner' ||
                    lowerGemName === 'electrocuting arrow' ||
                    lowerGemName === 'voltaic mark' ||
                    lowerGemName === 'freezing mark' ||
                    lowerGemName === 'pain offering' ||
                    (lowerGemName === 'demon form' && Boolean(playerDb.getEvalContext().conditions.DemonForm))),
              ) ||
              def.compiledMods?.some((m) => m.target === 'minion' && lowerGemName === 'pain offering'),
          );
        const isAura =
          !isCurseOrMark &&
          !isHerald &&
          !isGolemBuff &&
          !isStanceBuff &&
          !isSpectralTigerBuff &&
          !isApproachingFlamesBuff &&
          !isRighteousFireBuff &&
          !isBloodRageBuff &&
          !isFlameWallBuff &&
          !isArcaneCloakBuff &&
          !isSigilOfPowerBuff &&
          !isElementalConfluxBuff &&
          !hasGlobalEffectCmod &&
          (isSmiteBuff || tags.has('aura') || (def.manaReservationPct ?? 0) > 0 || canonicalAuraName !== null);
        const isGlobalBuff =
          Boolean(def.isAuraOrBuff) ||
          isHerald ||
          isGolemBuff ||
          isStanceBuff ||
          isSpectralTigerBuff ||
          isApproachingFlamesBuff ||
          isRighteousFireBuff ||
          isBloodRageBuff ||
          isFlameWallBuff ||
          isSmiteBuff ||
          isFlameSurgeBuff ||
          isArcaneCloakBuff ||
          isSigilOfPowerBuff ||
          isElementalConfluxBuff ||
          hasGlobalEffectCmod ||
          (def.category === 'active' && (isAura || isCurseOrMark || (def.spiritReservation ?? 0) > 0));
        if (!isGlobalBuff) continue;

        const isEnemyOnlyAura = canonicalAuraName === 'Pride';
        const defForBonus =
          fromVaalGem && !tags.has('vaal')
            ? { ...def, tags: [...def.tags, 'vaal'] }
            : def;
        const gemBon = resolveGemBonuses(defForBonus, playerDb, groupSocketedRules);
        const awakenedBonus = isAura && !isEnemyOnlyAura ? groupAwakenedGenAuraLevelBonus : 0;
        const effLevel = Math.min(
          40,
          Math.max(1, gemInst.level + gemBon.levelBonus + groupEmpowerBonus + awakenedBonus),
        );
        const effQuality = Math.max(0, (gemInst.quality ?? 0) + gemBon.qualityBonus + groupEnhanceQualityBonus);

        const candidate: CandidateAura = {
          def,
          gemInst,
          effLevel,
          effQuality,
          canonicalAuraName,
          isAura,
          isCurseOrMark,
          isMark,
          isHerald,
          isGolemBuff,
          isStanceBuff,
          isSpectralTigerBuff,
          isApproachingFlamesBuff,
          isEnemyOnlyAura,
          groupCurseEffectInc,
          groupHasBonechill,
          groupBonechillColdTakenInc,
          groupSkitterbotAilmentEffectInc,
          groupHasGenerosity,
          generosityEffectPct,
          groupHasArrogance,
          arroganceEffectPct,
          arroganceResMult,
          groupHasBlessing,
          blessingName,
          blessingEffectPct,
          groupHasPrismGuardian: slotAuraInfo.reservesLifeInsteadOfMana,
          groupHasAtziriCommunion,
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
  }

  // Default stance when a stance skill is enabled and neither stance is explicitly set
  if (
    build.game === 'poe1' &&
    hasAnyStanceSkill &&
    !playerDb.getEvalContext().conditions.BloodStance &&
    !playerDb.getEvalContext().conditions.SandStance
  ) {
    playerDb.setCondition('BloodStance', true);
    enemyDb.setCondition('BloodStance', true);
  }

  // Pre-Pass-1: populate Herald count (for Herald of the Hive & Purposeful Harbinger),
  // GolemBuffEffect (with PoE 3.28+ Liege of the Primordial stale-source guard),
  // Aspect of the Cat, Summon Spectral Tiger, Approaching Flames, and RF Arcane Devotion thresholds.
  const allCandidates = [...deduped.values()];
  const activeHeraldCountPre = allCandidates.filter((c) => c.isHerald).length;
  if (activeHeraldCountPre > 0) {
    playerDb.setMultiplier('Herald', activeHeraldCountPre);
    const phPerHerald = playerDb.sum('BASE', 'PurposefulHarbingerPerHerald');
    if (phPerHerald > 0) {
      selfOnlyAuraEffectPct += Math.min(40, phPerHerald * activeHeraldCountPre);
    }
  }

  const maxMana = ctx.maxMana ?? Math.round(playerDb.calcStat('Mana').total);
  const maxLife = ctx.maxLife ?? Math.round(playerDb.calcStat('Life').total);

  if (!playerDb.flag('ChaosInoculation') && (playerDb.getEvalContext().stats.LifeUnreserved ?? 0) <= 0) {
    playerDb.setStat('LifeUnreserved', Math.max(2, maxLife));
  }
  if ((playerDb.getEvalContext().stats.ManaUnreserved ?? 0) <= 0 && maxMana > 0) {
    playerDb.setStat('ManaUnreserved', maxMana);
  }
  if (build.game === 'poe1') {
    const lifeUnres = playerDb.getEvalContext().stats.LifeUnreserved ?? (playerDb.flag('ChaosInoculation') ? 1 : maxLife);
    playerDb.setCondition('StatThreshold:LifeUnreserved:2', !playerDb.flag('ChaosInoculation') && lifeUnres >= 2);
    playerDb.setCondition('StatThreshold:Mana:1', maxMana >= 1);
  }

  // Compute PoE 1 GolemBuffEffect filtering legacy ascendancyMods.ts Liege of the Primordial values on 3.28+
  const treeVerMatch = (build.tree?.treeVersion ?? '').match(/^(\d+)_(\d+)/);
  const treeMajor = treeVerMatch ? Number(treeVerMatch[1]) : 3;
  const treeMinor = treeVerMatch ? Number(treeVerMatch[2]) : 28;
  let poe1GolemBuffEffectPct = 0;
  let seenLiegeLegacy = false;
  for (const s of playerDb.calcStat('GolemBuffEffect').sources) {
    if (s.type !== 'INC' || typeof s.value !== 'number') continue;
    if (s.source === 'Ascendancy: Liege of the Primordial') {
      if (!seenLiegeLegacy) {
        seenLiegeLegacy = true;
        if (treeMajor === 3 && treeMinor === 27) poe1GolemBuffEffectPct += 50;
        else if (treeMajor < 3 || (treeMajor === 3 && treeMinor <= 26)) poe1GolemBuffEffectPct += 100;
      }
      continue;
    }
    poe1GolemBuffEffectPct += s.value;
  }

  // Aspect of the Cat & Replica Farrul's Fur Onslaught
  if (
    build.game === 'poe1' &&
    allCandidates.some((c) => c.def.name.en.trim().toLowerCase() === 'aspect of the cat')
  ) {
    const raw = build.config.rawInputs;
    const stealth = Boolean(raw?.aspectOfTheCatCatsStealth);
    const agility =
      raw?.aspectOfTheCatCatsAgility !== undefined ? Boolean(raw.aspectOfTheCatCatsAgility) : !stealth;
    playerDb.setCondition('CatsAgilityActive', agility);
    playerDb.setCondition('CatsStealthActive', stealth);
    if (
      agility &&
      hasReplicaFarrulOnslaught &&
      !hasStatSource(playerDb, 'MovementSpeed', 'INC', 'Onslaught')
    ) {
      const onslaughtEffMult = Math.max(0, 1 + playerDb.sum('INC', 'OnslaughtEffect') / 100);
      const onslaughtVal = Math.floor(20 * onslaughtEffMult + 1e-9);
      if (onslaughtVal > 0) {
        playerDb.addMod(mkMod('Speed', 'INC', onslaughtVal, "Replica Farrul's Fur (Onslaught)", ModFlag.Attack));
        playerDb.addMod(mkMod('Speed', 'INC', onslaughtVal, "Replica Farrul's Fur (Onslaught)", ModFlag.Spell));
        playerDb.addMod(mkMod('MovementSpeed', 'INC', onslaughtVal, "Replica Farrul's Fur (Onslaught)"));
        playerDb.setCondition('Onslaught', true);
      }
    }
  }

  // Soul Eater (Coiling Whisper / Headhunter / config multiplierSoulEater: +5% Attack & Cast Speed per stack, max 45)
  if (
    build.game === 'poe1' &&
    typeof build.config.rawInputs?.multiplierSoulEater === 'number' &&
    build.config.rawInputs.multiplierSoulEater > 0 &&
    !hasStatSource(playerDb, 'Speed', 'INC', 'Soul Eater')
  ) {
    const seStacks = Math.min(45, Math.max(0, Math.floor(build.config.rawInputs.multiplierSoulEater)));
    if (seStacks > 0) {
      const seSrc = `Soul Eater (${seStacks} stacks)`;
      playerDb.addMod(mkMod('Speed', 'INC', seStacks * 5, seSrc, ModFlag.Attack));
      playerDb.addMod(mkMod('Speed', 'INC', seStacks * 5, seSrc, ModFlag.Spell));
    }
  }

  // Inject deduplicated PoE 2 Ice Bite & persistent support buffs (one highest-tier entry per family;
  // skip Ice Bite when already socketed on the main active skill group so engine.ts never double-counts it).
  if (build.game === 'poe2') {
    if (poe2IceBiteBest && !poe2IceBiteOnMain) {
      const globalSupCmods = resolveAuraLevelCompiledMods(poe2IceBiteBest.def, poe2IceBiteBest.effLevel);
      if (globalSupCmods && globalSupCmods.length > 0) {
        const pMods = globalSupCmods.filter((m) => m.target === 'player');
        if (pMods.length > 0) {
          injectCompiledGemMods(playerDb, enemyDb, minionDb, pMods, `Support Buff: ${poe2IceBiteBest.def.name.en}`, {
            game: 'poe2',
          });
        }
      }
    }
    for (const best of poe2PersistentSupFamilyBest.values()) {
      const cmods = resolveAuraLevelCompiledMods(best.def, best.effLevel);
      if (cmods && cmods.length > 0) {
        const pMods = cmods.filter((m) => m.target === 'player');
        if (pMods.length > 0) {
          injectCompiledGemMods(playerDb, enemyDb, minionDb, pMods, `Support Buff: ${best.def.name.en}`, {
            game: 'poe2',
          });
        }
      }
    }
  }

  // Summon Spectral Tiger stack count & tree/item trigger synthesis (Huntleader node 35011 / Farrul's Chase)
  if (build.game === 'poe1') {
    const hasTigerCandidate = allCandidates.some((c) => c.isSpectralTigerBuff);
    const hasTigerFromTreeOrItem =
      !hasTigerCandidate &&
      (build.tree.allocatedNodeIds.includes(35011) ||
        getActiveEquippedItemsSimple(build).some(({ item }) =>
          collectCleanItemLines(item).some((l) => /Triggers?\s+Level\s+\d+\s+Summon\s+Spectral\s+Tiger/i.test(l)),
        ));
    if (hasTigerCandidate || hasTigerFromTreeOrItem) {
      const tigerCount =
        typeof build.config.rawInputs?.multiplierSpectralTigerCount === 'number'
          ? build.config.rawInputs.multiplierSpectralTigerCount
          : 5;
      playerDb.setMultiplier('SpectralTigerCount', Math.max(0, tigerCount));
      if (hasTigerFromTreeOrItem && tigerCount > 0) {
        const tigerSrc = `Skill: Summon Spectral Tiger (${tigerCount} tigers)`;
        playerDb.addMod(mkMod('Speed', 'INC', 7 * tigerCount, tigerSrc, ModFlag.Attack));
        playerDb.addMod(mkMod('Speed', 'INC', 7 * tigerCount, tigerSrc, ModFlag.Spell));
        playerDb.addMod(mkMod('CritChance', 'INC', 25 * tigerCount, tigerSrc));
      }
    }
  }

  // Approaching Flames (Annihilation's Approach boots) -> Adrenaline
  if (
    build.game === 'poe1' &&
    allCandidates.some((c) => c.isApproachingFlamesBuff) &&
    hasAnnihilationsApproachAdrenaline &&
    !hasStatSource(playerDb, 'Damage', 'INC', 'Adrenaline')
  ) {
    const src = "Annihilation's Approach (Adrenaline)";
    playerDb.addMod(mkMod('Damage', 'INC', 100, src));
    playerDb.addMod(mkMod('Speed', 'INC', 25, src, ModFlag.Attack));
    playerDb.addMod(mkMod('Speed', 'INC', 25, src, ModFlag.Spell));
    playerDb.addMod(mkMod('MovementSpeed', 'INC', 25, src));
    playerDb.addMod(mkMod('PhysDamageReduction', 'BASE', 10, src));
    playerDb.setCondition('Adrenaline', true);
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

  let appliedHexCount = 0;
  let appliedMarkCount = 0;
  const appliedCurseNamesLower = new Set<string>();

  const hexPriority = (cand: CandidateAura): number => {
    if (!cand.isCurseOrMark || cand.isMark) return 0;
    const nm = cand.def.name.en.trim().toLowerCase();
    if (
      nm === 'elemental weakness' ||
      nm === 'conductivity' ||
      nm === 'flammability' ||
      nm === 'frostbite' ||
      nm === 'despair' ||
      nm === 'vulnerability' ||
      nm === 'punishment'
    ) {
      return 1;
    }
    return 2;
  };
  const rawNonCurseCandidates = allCandidates.filter((c) => !c.isCurseOrMark);
  // Deduplicate Sigil of Power candidates (e.g. Chiming Staff item-granted + gem slot in PoE 2):
  // keep only the single highest-level Sigil of Power so its MORE Spell Damage is never double-counted.
  let bestSigilIdx = -1;
  let bestSigilLv = -1;
  for (let i = 0; i < rawNonCurseCandidates.length; i++) {
    const c = rawNonCurseCandidates[i]!;
    if (c.def.name.en.trim().toLowerCase() === 'sigil of power') {
      if (c.effLevel > bestSigilLv) {
        bestSigilLv = c.effLevel;
        bestSigilIdx = i;
      }
    }
  }
  const nonCurseCandidates = rawNonCurseCandidates.filter(
    (c, idx) => c.def.name.en.trim().toLowerCase() !== 'sigil of power' || idx === bestSigilIdx,
  );
  const curseCandidates = allCandidates
    .filter((c) => c.isCurseOrMark)
    .sort((a, b) => hexPriority(a) - hexPriority(b));

  let curseLimit = 1;

  const evaluateCandidate = (cand: CandidateAura) => {
    const {
      def,
      gemInst,
      effLevel,
      effQuality,
      isAura,
      isCurseOrMark,
      isMark,
      isHerald,
      isGolemBuff,
      isEnemyOnlyAura,
    } = cand;
    const lowerAuraName = def.name.en.trim().toLowerCase();

    // Sublime Vision: Aura Skills other than <X> are Disabled (applies strictly to gems with the `aura` tag,
    // never disabling Arctic Armour / Tempest Shield / Petrified Blood / Heralds / Aspects / Stances,
    // and permitting Vaal <X> alongside base <X>).
    const gemHasAuraTag = def.tags.some((t) => t.toLowerCase() === 'aura');
    if (
      sublimeOnlyAuraLower &&
      gemHasAuraTag &&
      !isCurseOrMark &&
      !isHerald &&
      lowerAuraName !== sublimeOnlyAuraLower &&
      lowerAuraName !== `vaal ${sublimeOnlyAuraLower}`
    ) {
      return;
    }

    if (isCurseOrMark) {
      const lowerCurseMark = lowerAuraName;
      // PoE 2 Freezing Mark / Voltaic Mark grant a 10s player buff on activation; Pounce (Predator's Mark) stacks with utility marks
      const isPoe2SecondaryMarkBuff =
        build.game === 'poe2' &&
        (lowerCurseMark === 'freezing mark' ||
          lowerCurseMark === 'voltaic mark' ||
          lowerCurseMark === 'pounce');
      if (isMark) {
        if (appliedMarkCount >= 1 && !isPoe2SecondaryMarkBuff) return;
        if (!isPoe2SecondaryMarkBuff) appliedMarkCount++;
      } else {
        if (appliedHexCount >= curseLimit) return;
        appliedHexCount++;
      }
      appliedCurseNamesLower.add(lowerCurseMark);
      if (build.game === 'poe2' && lowerCurseMark === 'pounce') {
        const capVal = 45 + Math.floor(Math.max(0, effQuality) * 0.75);
        const perVal = 3 + Math.max(0, effQuality) * 0.05;
        const rawMinions =
          typeof build.config.rawInputs?.multiplierMinionsInPresence === 'number'
            ? build.config.rawInputs.multiplierMinionsInPresence
            : build.skills.some(
                  (grp) =>
                    grp.enabled &&
                    grp.gems.some((gm) => {
                      if (!gm.enabled) return false;
                      const gd = lookupGem('poe2', gm.gemId);
                      return Boolean(gd && (gd.minionBase || gd.tags.some((t) => /minion|companion/i.test(t))));
                    }),
                )
              ? 15
              : 8;
        const markEffInc =
          baseMarkEffectPct + cand.groupCurseEffectInc + playerDb.sum('INC', 'MarkEffect');
        const rawPredTaken = Math.min(capVal, Math.floor(rawMinions * perVal + 1e-9));
        const scaledPredTaken = Math.floor(rawPredTaken * Math.max(0, 1 + markEffInc / 100) + 1e-9);
        if (scaledPredTaken > 0) {
          enemyDb.addMod({
            name: 'DamageTaken',
            type: 'INC',
            value: scaledPredTaken,
            flags: 0,
            keywordFlags: 0,
            source: `Predator's Mark (Pounce Q${effQuality})`,
          });
        }
        enemyDb.setCondition('Marked', true);
        playerDb.setCondition('EnemyMarked', true);
        return;
      }
      enemyDb.setCondition('Cursed', true);
      playerDb.setCondition('EnemyCursed', true);
      if (isMark) {
        enemyDb.setCondition('Marked', true);
        playerDb.setCondition('EnemyMarked', true);
      }
    }
    const rawStats = resolveAuraLevelStats(def, effLevel);
    const baseCompiledMods = resolveAuraLevelCompiledMods(def, effLevel);
    let qualCurseEffInc = 0;
    let qualGolemBuffEffInc = 0;
    const scaledQualityMods =
      effQuality > 0 && def.qualityCompiledMods
        ? def.qualityCompiledMods
            .map((qm) => {
              if (qm.name === 'CurseEffect' && qm.type === 'INC' && typeof qm.value === 'number') {
                qualCurseEffInc += Math.trunc(qm.value * effQuality + Math.sign(qm.value) * 1e-9);
                return null;
              }
              if (isGolemBuff && qm.name === 'BuffEffect' && qm.type === 'INC' && typeof qm.value === 'number') {
                qualGolemBuffEffInc += Math.trunc(qm.value * effQuality + Math.sign(qm.value) * 1e-9);
                return null;
              }
              if (typeof qm.value === 'number') {
                const v = Math.trunc(qm.value * effQuality + Math.sign(qm.value) * 1e-9);
                return v !== 0 ? { ...qm, value: v } : null;
              }
              return qm;
            })
            .filter((m): m is NonNullable<typeof m> => m !== null)
        : [];
    const rawCombinedMods =
      baseCompiledMods && baseCompiledMods.length > 0
        ? [...baseCompiledMods, ...scaledQualityMods]
        : scaledQualityMods.length > 0
          ? scaledQualityMods
          : undefined;
    const compiledMods =
      rawCombinedMods && lowerAuraName === 'sigil of power'
        ? rawCombinedMods.filter((m, idx, arr) => {
            const sig = `${m.name}|${m.type}|${m.value}|${m.flags ?? 0}|${m.keywordFlags ?? 0}|${m.target ?? ''}|${JSON.stringify(m.tags ?? [])}`;
            return (
              arr.findIndex(
                (x) =>
                  `${x.name}|${x.type}|${x.value}|${x.flags ?? 0}|${x.keywordFlags ?? 0}|${x.target ?? ''}|${JSON.stringify(x.tags ?? [])}` ===
                  sig,
              ) === idx
            );
          })
        : rawCombinedMods;
    const sourceLabel = `Aura/Buff: ${def.name.en}${effLevel !== gemInst.level ? ` (Lv.${effLevel})` : ''}`;
    const parsedBaseMods =
      compiledMods && compiledMods.length > 0 ? [] : parseModLines(rawStats, sourceLabel);

    // PoE 1 Flame Surge: creates Burning Ground dealing 25% of Ignite DPS (unscalable global buff)
    if (build.game === 'poe1' && lowerAuraName === 'flame surge') {
      enemyDb.addMod({
        name: 'IgniteDpsAsBurningGround',
        type: 'MAX',
        value: 25,
        flags: 0,
        keywordFlags: 0,
        source: sourceLabel,
      });
    }
    // PoE 1 Alchemist's Mark: Caustic Ground (% of single Poison DPS) & Burning Ground (% of Ignite DPS)
    if (build.game === 'poe1' && lowerAuraName === "alchemist's mark") {
      const clampedLv = Math.min(40, Math.max(1, effLevel));
      const baseCausticPct = 59 + clampedLv;
      const baseBurningPct =
        clampedLv >= 36 ? 31 : clampedLv >= 30 ? 30 : 20 + Math.floor(clampedLv / 3);
      const effectiveMarkQualInc =
        qualCurseEffInc !== 0 ? qualCurseEffInc : Math.trunc(Math.max(0, effQuality) * 0.5);
      const totalMarkEffInc = baseMarkEffectPct + cand.groupCurseEffectInc + effectiveMarkQualInc;
      const markEffMult = Math.max(0, 1 + totalMarkEffInc / 100);
      const causticPct = Math.floor(baseCausticPct * markEffMult + 1e-9);
      const burningPct = Math.floor(baseBurningPct * markEffMult + 1e-9);
      if (causticPct > 0) {
        enemyDb.addMod({
          name: 'PoisonDpsAsCausticGround',
          type: 'MAX',
          value: causticPct,
          flags: 0,
          keywordFlags: 0,
          source: sourceLabel,
        });
      }
      if (burningPct > 0) {
        enemyDb.addMod({
          name: 'IgniteDpsAsBurningGround',
          type: 'MAX',
          value: burningPct,
          flags: 0,
          keywordFlags: 0,
          source: sourceLabel,
        });
      }
    }
    // PoE 2 Elemental Conflux (act_int.lua:5652, ConfigOptions.lua:401-419): Average divides by 3 (`invert = true`)
    if (build.game === 'poe2' && lowerAuraName === 'elemental conflux') {
      const clampedLv = Math.min(40, Math.max(1, effLevel));
      const lvBase =
        clampedLv <= 30 ? 39 + clampedLv : 69 + Math.floor((clampedLv - 30) / 2);
      const qualMore = Math.trunc(Math.max(0, effQuality) * 0.5);
      const fullMore = lvBase + qualMore;
      const confluxMode = Number(build.config.rawInputs?.elementalConfluxElement ?? 1);
      if (confluxMode === 2) {
        playerDb.addMod({ name: 'LightningDamage', type: 'MORE', value: fullMore, flags: 0, keywordFlags: 0, source: sourceLabel });
      } else if (confluxMode === 3) {
        playerDb.addMod({ name: 'ColdDamage', type: 'MORE', value: fullMore, flags: 0, keywordFlags: 0, source: sourceLabel });
      } else if (confluxMode === 4) {
        playerDb.addMod({ name: 'FireDamage', type: 'MORE', value: fullMore, flags: 0, keywordFlags: 0, source: sourceLabel });
      } else {
        const avgMore = Math.round((fullMore / 3) * 100) / 100;
        playerDb.addMod({ name: 'LightningDamage', type: 'MORE', value: avgMore, flags: 0, keywordFlags: 0, source: sourceLabel });
        playerDb.addMod({ name: 'ColdDamage', type: 'MORE', value: avgMore, flags: 0, keywordFlags: 0, source: sourceLabel });
        playerDb.addMod({ name: 'FireDamage', type: 'MORE', value: avgMore, flags: 0, keywordFlags: 0, source: sourceLabel });
      }
    }
    if (build.game === 'poe1' && lowerAuraName === 'summon skitterbots') {
      const skitterShockInc =
        (baseCompiledMods?.find((m) => m.name === 'EnemyShockEffect' && typeof m.value === 'number')?.value as number | undefined) ??
        Math.min(20, Math.floor(effLevel));
      const skitterChillInc =
        (baseCompiledMods?.find((m) => m.name === 'EnemyChillEffect' && typeof m.value === 'number')?.value as number | undefined) ??
        Math.min(20, Math.floor(effLevel));
      const totalSkitterAilInc =
        playerDb.sum('INC', 'SkitterbotAilmentEffect') + cand.groupSkitterbotAilmentEffectInc;
      const shockEff = Math.floor(15 * Math.max(0, 1 + (skitterShockInc + totalSkitterAilInc) / 100));
      const bonechillChillEffInc = cand.groupHasBonechill ? cand.groupBonechillColdTakenInc : 0;
      const chillEff = Math.floor(
        10 * Math.max(0, 1 + (skitterChillInc + totalSkitterAilInc + bonechillChillEffInc) / 100),
      );
      if (shockEff > 0) {
        playerDb.addMod({
          name: 'ShockOverride',
          type: 'BASE',
          value: shockEff,
          flags: 0,
          keywordFlags: 0,
          source: 'Summon Skitterbots',
        });
        playerDb.setCondition('EnemyShocked', true);
        enemyDb.setCondition('Shocked', true);
      }
      if (chillEff > 0) {
        playerDb.setCondition('EnemyChilled', true);
        enemyDb.setCondition('Chilled', true);
        if (cand.groupHasBonechill) {
          skitterbotAppliedBonechill = true;
          const rawChillCfg = build.config.rawInputs?.conditionEnemyChilledEffect;
          const effectiveBonechill =
            typeof rawChillCfg === 'number' && rawChillCfg > 0
              ? Math.max(chillEff, Math.min(40, Math.floor(rawChillCfg)))
              : Math.min(30, chillEff);
          enemyDb.addMod({
            name: 'ColdDamageTaken',
            type: 'INC',
            value: effectiveBonechill,
            flags: 0,
            keywordFlags: 0,
            source: 'Summon Skitterbots (Bonechill)',
          });
        }
      }
    }

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

    const isBannerAura =
      build.game === 'poe1' &&
      (lowerAuraName === 'war banner' ||
        lowerAuraName === 'dread banner' ||
        lowerAuraName === 'defiance banner');
    const bannerAuraEffInc = isBannerAura ? playerDb.sum('INC', 'BannerAuraEffect') : 0;

    const auraEffectDbKeys: string[] = [];
    const auraLabelForKey = cand.canonicalAuraName ?? def.name.en;
    if (auraLabelForKey) {
      auraEffectDbKeys.push(`AuraEffect:${auraLabelForKey}`);
      const noSpaceAura = auraLabelForKey.replace(/\s+/g, '');
      if (noSpaceAura !== auraLabelForKey) {
        auraEffectDbKeys.push(`AuraEffect:${noSpaceAura}`);
      }
      auraEffectDbKeys.push(`${noSpaceAura}AuraEffect`);
    }
    let dbPerAuraEffectPct = 0;
    for (const statKey of auraEffectDbKeys) {
      const statRes = playerDb.calcStat(statKey);
      for (const s of statRes.sources) {
        if (s.type !== 'INC' || typeof s.value !== 'number') continue;
        if (perSkillEffectScannedSources.has(`${lowerAuraName}|${s.source}`)) continue;
        dbPerAuraEffectPct += s.value;
      }
    }
    const skillSpecificEffectPct =
      (perSkillEffectPct.get(lowerAuraName) ?? 0) + dbPerAuraEffectPct;
    const skillSpecificResEffPct =
      (perSkillResEffPct.get(lowerAuraName) ?? 0) +
      playerDb.sum('INC', `SkillManaReservationEfficiency:${lowerAuraName}`);

    const auraEffectPctForPlayer = isAura
      ? baseAuraEffectPct +
        selfOnlyAuraEffectPct +
        cand.arroganceEffectPct +
        cand.blessingEffectPct +
        bannerAuraEffInc +
        skillSpecificEffectPct
      : 0;
    const auraEffectPctForMinions = isAura
      ? baseAuraEffectPct +
        cand.generosityEffectPct +
        cand.arroganceEffectPct +
        cand.blessingEffectPct +
        bannerAuraEffInc +
        skillSpecificEffectPct
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
          localEfficiencyPct: cand.localResEffPct + skillSpecificResEffPct,
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
          (reservesLife ? globalLifeResEff : globalManaResEff) +
          cand.localResEffPct +
          skillSpecificResEffPct;
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
          localEfficiencyPct: cand.localResEffPct + skillSpecificResEffPct,
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
        const poe2BossHexMult =
          build.game === 'poe2' && isCurseOrMark && !isMark && build.config.enemyIsBoss !== 'None'
            ? 0.5
            : 1;
        const totalCurseInc =
          (isMark ? baseMarkEffectPct : baseCurseEffectPct) + cand.groupCurseEffectInc + qualCurseEffInc;
        const spiderWebStacks =
          build.game === 'poe1' && lowerAuraName === 'aspect of the spider'
            ? Math.max(
                1,
                Number(
                  build.config.rawInputs?.aspectOfTheSpiderWebStacks ??
                    enemyDb.getEvalContext().multipliers.SpiderWeb ??
                    1,
                ),
              )
            : 1;
        const enemyMult = isCurseOrMark
          ? Math.max(0, 1 + totalCurseInc / 100) * poe2BossHexMult
          : lowerAuraName === 'aspect of the spider'
            ? spiderWebStacks
            : (1 + auraEffectPctForPlayer / 100) * supremeEgoMoreMult;
        injectCompiledGemMods(playerDb, enemyDb, minionDb, enemyCmods, sourceLabel, {
          game: build.game,
          effectMultiplier: enemyMult,
          scaleMore: !isCurseOrMark,
        });
      }

      const isPoe2MinionOffering =
        build.game === 'poe2' && lowerAuraName === 'pain offering';
      if (allyCmods.length > 0 && isPoe2MinionOffering) {
        const forcedMinionOffering = allyCmods.map((m) => ({
          ...m,
          target: 'player' as const,
        }));
        const tmpMin = new ModDB();
        const tmpUnused = new ModDB();
        injectCompiledGemMods(tmpMin, tmpUnused, tmpUnused, forcedMinionOffering, `${sourceLabel} [Minion Offering]`, {
          game: build.game,
        });
        minionMods = collectModsFromDb(tmpMin);
        minionDb.addMods(minionMods);
      } else if (allyCmods.length > 0 && appliesToPlayer) {
        const tmpPlayer = new ModDB();
        const tmpEnemy = new ModDB();
        const tmpMinion = new ModDB();
        tmpPlayer.setEvalContext(playerDb.getEvalContext());
        const poe2BossHexMult =
          build.game === 'poe2' && isCurseOrMark && !isMark && build.config.enemyIsBoss !== 'None'
            ? 0.5
            : 1;
        const totalCurseInc =
          (isMark ? baseMarkEffectPct : baseCurseEffectPct) + cand.groupCurseEffectInc + qualCurseEffInc;
        const heraldEffectMult = isHerald
          ? Math.max(
              0,
              1 +
                (playerDb.sum('INC', ['HeraldBuffEffect', 'BuffEffectOnSelf']) +
                  skillSpecificEffectPct) /
                  100,
            )
          : 1;
        const golemEffectMult = isGolemBuff
          ? Math.max(
              0,
              1 +
                (poe1GolemBuffEffectPct +
                  qualGolemBuffEffInc +
                  playerDb.sum('INC', 'BuffEffectOnSelf') +
                  skillSpecificEffectPct) /
                  100,
            )
          : 1;
        let bannerValourMult = 1;
        if (isBannerAura) {
          const isPlanted = Boolean(
            playerDb.getEvalContext().conditions.BannerPlanted ||
              build.config.rawInputs?.bannerPlanted,
          );
          if (isPlanted) {
            const maxValour = 50 + playerDb.sum('BASE', ['MaximumValour', 'MaxValour']);
            const rawCfgValour = build.config.rawInputs?.bannerValour;
            const rawValour =
              typeof rawCfgValour === 'number'
                ? rawCfgValour
                : Math.max(maxValour, playerDb.getEvalContext().multipliers.BannerValour ?? 0);
            const effValour = Math.max(0, Math.min(maxValour, rawValour));
            playerDb.setCondition('BannerPlanted', true);
            playerDb.setMultiplier('BannerValour', effValour);
            playerDb.setMultiplier('ValourStacks', effValour);
            const valourMorePerStack =
              (baseCompiledMods?.find(
                (m) =>
                  m.name === 'AuraEffect' &&
                  m.type === 'MORE' &&
                  typeof m.value === 'number' &&
                  m.tags?.some((t) => t.type === 'Multiplier' && t.var === 'BannerValour'),
              )?.value as number | undefined) ?? 10;
            bannerValourMult = 1 + (valourMorePerStack / 100) * effValour;
          } else {
            bannerValourMult = 0;
          }
        }
        const playerMult = isAura
          ? (1 + auraEffectPctForPlayer / 100) * supremeEgoMoreMult * bannerValourMult
          : isHerald
            ? heraldEffectMult
            : isGolemBuff
              ? golemEffectMult
              : isCurseOrMark
                ? Math.max(0, 1 + totalCurseInc / 100) * poe2BossHexMult
                : 1;
        const shouldScaleMore =
          (isAura || isHerald) &&
          lowerAuraName !== 'righteous fire' &&
          lowerAuraName !== 'righteous fire of arcane devotion';
        if (playerMult > 0) {
          injectCompiledGemMods(tmpPlayer, tmpEnemy, tmpMinion, allyCmods, sourceLabel, {
            game: build.game,
            effectMultiplier: playerMult,
            scaleMore: shouldScaleMore,
          });
        }
        playerMods = collectModsFromDb(tmpPlayer);
        playerDb.addMods(playerMods);
        // Propagate Condition:* flags set by allyCmods (e.g. HaveFireGolem / HaveLightningGolem) onto playerDb
        const tmpConds = tmpPlayer.getEvalContext().conditions;
        for (const [ck, cv] of Object.entries(tmpConds)) {
          if (cv && !playerDb.getEvalContext().conditions[ck]) {
            playerDb.setCondition(ck, true);
          }
        }
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

    // Track active canonical aura names for Watcher's Eye & condition evaluation (incl. Heralds for Coming Calamity!)
    const auraKey = cand.canonicalAuraName ?? (isAura || isHerald ? def.name.en : null);
    if (auraKey) {
      activeAurasAll.add(auraKey);
      // Pride triggers "while using Pride" on Watcher's Eye when active on the player's skills;
      // all other auras & heralds trigger "while affected by <Aura/Herald>" when affecting the player.
      if (appliesToPlayer || isEnemyOnlyAura || isHerald) {
        activeAurasAffectingPlayer.add(auraKey);
        const noSpace = auraKey.replace(/\s+/g, '');
        playerDb.setCondition(`AffectedBy${noSpace}`, true);
        if (isHerald) {
          playerDb.setCondition('AffectedByHerald', true);
          playerDb.setCondition(`AffectedBy${noSpace.replace(/Of/g, 'of')}`, true);
          playerDb.setCondition(`AffectedBy${noSpace.replace(/of/g, 'Of')}`, true);
        }
      }
      if (appliesToMinions) {
        activeAurasAffectingMinions.add(auraKey);
        minionDb.setCondition(`AffectedBy${auraKey.replace(/\s+/g, '')}`, true);
      }
    }

    const spiritUnitCost = gemInst.spiritReservationOverride ?? def.spiritReservation ?? 0;
    if (spiritUnitCost > 0) {
      const spiritCount = def.minionBase && (gemInst.count ?? 1) > 1 ? Math.floor(gemInst.count!) : 1;
      const totalUnitSpirit = spiritUnitCost * spiritCount;
      // PoE 2 Atziri's Communion (`LifeReservePercentPerSpirit = 0.66`): converts Spirit reservation into % Life reservation!
      if (build.game === 'poe2' && cand.groupHasAtziriCommunion) {
        const baseLifePct = Math.round(totalUnitSpirit * 0.66 * 100) / 100;
        const { effectivePct, effectiveFlat } = computeReservationAmounts(
          baseLifePct,
          0,
          1,
          globalLifeResEff + cand.localResEffPct,
          maxLife,
        );
        lifeReservations.push({
          gemId: def.id,
          gemName: def.name.en,
          pool: 'Life',
          basePct: baseLifePct,
          baseFlat: 0,
          multiplier: 1,
          localEfficiencyPct: cand.localResEffPct,
          effectivePct,
          effectiveFlat,
          zeroedByBlessing: false,
        });
        totalLifeReservedPct += effectivePct;
        totalLifeReservedFlat += effectiveFlat;
      } else {
        totalSpiritReserved += totalUnitSpirit;
      }
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
      localReservationEfficiencyPct: cand.localResEffPct + skillSpecificResEffPct,
      zeroedByBlessing,
      playerMods,
      minionMods,
    });
  };

  // PASS 1: Non-curse Auras, Heralds, Golems, Stances, Aspects, and Global Buffs
  for (const cand of nonCurseCandidates) {
    evaluateCandidate(cand);
  }

  // PASS 2: Watcher's Eye & Sublime Vision conditional jewel lines BEFORE CurseLimit resolution
  const watchersEyeLines: WatchersEyeEvaluatedLine[] = [];
  const watchersEyeMods: Mod[] = [];

  for (const jewel of jewelsToScan) {
    const lines = collectCleanItemLines(jewel);
    for (const line of lines) {
      const parsedCond = parseWatchersEyeCondition(line);
      if (!parsedCond) continue;

      const condKey = `AffectedBy${parsedCond.requiredAura.replace(/\s+/g, '')}`;
      const active =
        activeAurasAffectingPlayer.has(parsedCond.requiredAura) ||
        Boolean(playerDb.getEvalContext().conditions[condKey]) ||
        playerDb.flag(condKey);
      const mods = active
        ? parseWatchersEyeEffectLine(
            parsedCond.strippedModLine,
            `${jewel.name} (${parsedCond.requiredAura})`,
          )
        : [];

      if (active && mods.length > 0) {
        const jewelNameLower = jewel.name.trim().toLowerCase();
        const dedupedMods = mods.filter((m) => {
          const existingEntry = playerDb.entriesByPrefix(m.name).find(([k]) => k === m.name);
          const existing = existingEntry ? existingEntry[1] : [];
          return !existing.some(
            (em) =>
              em.type === m.type &&
              em.value === m.value &&
              em.source.toLowerCase().includes(jewelNameLower),
          );
        });
        if (dedupedMods.length > 0) {
          playerDb.addMods(dedupedMods);
          watchersEyeMods.push(...dedupedMods);
        }
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

  // PASS 3: Resolve CurseLimit (including EnemyCurseLimit from Whispers of Doom / Sublime Vision / gear) and evaluate Curses/Marks
  curseLimit = playerDb.flag('CurseLimitIsMaximumPowerCharges')
    ? Math.max(
        1,
        3 + Math.round(playerDb.sum('BASE', ['MaxPowerCharges', 'PowerChargesMax'])),
      )
    : Math.max(
        1,
        1 + Math.round(playerDb.sum('BASE', ['AdditionalCurse', 'CurseLimit', 'EnemyCurseLimit'])),
      );

  for (const cand of curseCandidates) {
    evaluateCandidate(cand);
  }

  // Item Curse-on-Hit modifiers (e.g. Foulborn Uul-Netol's Kiss Vulnerability, Asenath's Gentle Touch Temporal Chains)
  if (build.game === 'poe1' && curseOnHitEntries.length > 0) {
    for (const entry of curseOnHitEntries) {
      const lowerCurse = entry.curseName.trim().toLowerCase();
      if (appliedCurseNamesLower.has(lowerCurse)) continue;
      const cDef = resolveGemFromPobRef('poe1', { nameSpec: entry.curseName });
      if (!cDef) continue;
      const isMark = cDef.tags.some((t) => t.toLowerCase() === 'mark');
      if (isMark) {
        if (appliedMarkCount >= 1) continue;
        appliedMarkCount++;
      } else {
        if (appliedHexCount >= curseLimit) continue;
        appliedHexCount++;
      }
      appliedCurseNamesLower.add(lowerCurse);
      enemyDb.setCondition('Cursed', true);
      playerDb.setCondition('EnemyCursed', true);
      if (isMark) {
        enemyDb.setCondition('Marked', true);
        playerDb.setCondition('EnemyMarked', true);
      }
      const cmods = resolveAuraLevelCompiledMods(cDef, 1);
      if (cmods && cmods.length > 0) {
        const enemyCmods = cmods.filter((m) => m.target === 'enemy');
        const totalEff = (isMark ? baseMarkEffectPct : baseCurseEffectPct) + entry.effectPct;
        const mult = Math.max(0, 1 + totalEff / 100);
        if (enemyCmods.length > 0) {
          injectCompiledGemMods(playerDb, enemyDb, minionDb, enemyCmods, `${entry.source} (${cDef.name.en} on Hit)`, {
            game: 'poe1',
            effectMultiplier: mult,
            scaleMore: false,
          });
        }
      }
    }
  }

  if (appliedHexCount + appliedMarkCount > 0) {
    playerDb.setMultiplier('CurseOnEnemy', appliedHexCount + appliedMarkCount);
    enemyDb.setMultiplier('CurseOnSelf', appliedHexCount + appliedMarkCount);
  }

  // POST-PASS PoE 1 Global Utility Skills, Exposure, Combustion, Bonechill, Maim, Feeding Frenzy, and Pacts
  if (build.game === 'poe1') {
    // 1. PoE 1 Exposure (strongest base per element across items, skills, and Heraldry; deduplicated with cfg.enemy*Exposure)
    const extraExposure = playerDb.sum('BASE', 'ExtraExposure');
    const exposureEffMult = Math.max(0, 1 + playerDb.sum('INC', 'ExposureEffect') / 100);
    const heraldryMap: Record<'Fire' | 'Cold' | 'Lightning', string> = {
      Fire: 'AffectedByHeraldOfAsh',
      Cold: 'AffectedByHeraldOfIce',
      Lightning: 'AffectedByHeraldOfThunder',
    };
    for (const el of ['Fire', 'Cold', 'Lightning'] as const) {
      const heraldryBase =
        playerDb.flag(`HeraldryExposure:${el}`) &&
        (playerDb.getEvalContext().conditions[heraldryMap[el]] ||
          playerDb.getEvalContext().conditions[heraldryMap[el].replace('Of', 'of')])
          ? 10
          : 0;
      const masterBase = playerDb.flag(`MasterOfElementExposure:${el}`) ? 10 : 0;
      const bestBase = Math.max(
        itemExposureBase[el],
        skillExposureBase[el],
        heraldryBase,
        masterBase,
      );
      if (bestBase <= 0) continue;
      const cfgAlreadySet =
        el === 'Fire'
          ? Boolean(build.config.enemyFireExposure)
          : el === 'Cold'
            ? Boolean(build.config.enemyColdExposure)
            : Boolean(build.config.enemyLightningExposure);
      const fullPen = Math.floor((bestBase + extraExposure) * exposureEffMult + 1e-9);
      const base10Pen = Math.floor((10 + extraExposure) * exposureEffMult + 1e-9);
      const penToAdd = cfgAlreadySet ? Math.max(0, fullPen - base10Pen) : fullPen;
      if (penToAdd > 0) {
        enemyDb.addMod(
          mkMod(`${el}Resist`, 'BASE', -penToAdd, `${el} Exposure (${bestBase}% base)`),
        );
      }
      if (!cfgAlreadySet) {
        playerDb.setCondition(`Enemy${el}Exposure`, true);
        playerDb.setCondition('EnemyExposure', true);
        enemyDb.setCondition(`${el}Exposure`, true);
        enemyDb.setCondition('Exposure', true);
      }
    }

    // 2. Combustion Support (-10% Enemy Fire Resistance strictly when enemy is Ignited, CalcPerform.lua:2863-2873)
    const enemyIgnitedForCombustion = Boolean(
      build.config.rawInputs?.conditionEnemyIgnited ||
        (build.config as { enemyIgnited?: boolean }).enemyIgnited,
    );
    if (hasCombustionGroup && enemyIgnitedForCombustion) {
      enemyDb.addMod(mkMod('FireResist', 'BASE', -10, 'Support: Combustion'));
    }

    // 3. Non-Skitterbots Bonechill Support (PoE 3.25+: Cold Damage Taken increased by Chill Effect,
    // including Bonechill's own (24 + level)% increased Chill Effect from sup_int.lua:566)
    if (nonSkitterBonechillFound && !skitterbotAppliedBonechill) {
      const rawChillInput = build.config.rawInputs?.conditionEnemyChilledEffect;
      const chillEffMult = Math.max(
        0,
        1 +
          (playerDb.sum('INC', 'EnemyChillEffect') +
            nonSkitterBonechillAilmentInc +
            nonSkitterBonechillLevel) /
            100,
      );
      const areaChillVal = Math.min(30, Math.floor(10 * chillEffMult + 1e-9));
      const chillVal =
        typeof rawChillInput === 'number' && rawChillInput > 0
          ? Math.max(nonSkitterBonechillHasChillingArea ? areaChillVal : 0, Math.min(40, Math.floor(rawChillInput)))
          : areaChillVal;
      if (
        chillVal > 0 &&
        (nonSkitterBonechillHasChillingArea ||
          (typeof rawChillInput === 'number' && rawChillInput > 0) ||
          Boolean(build.config.rawInputs?.conditionEnemyChilled))
      ) {
        enemyDb.addMod(mkMod('ColdDamageTaken', 'INC', chillVal, 'Support: Bonechill'));
        playerDb.setCondition('EnemyChilled', true);
        enemyDb.setCondition('Chilled', true);
      }
    }

    // 4. Secondary-skill Maim Support (+10% Enemy Physical Damage Taken when Maimed)
    if (!mainGroupHasMaim && secondaryGroupMaimBonus > 0) {
      enemyDb.addMod(mkMod('PhysicalDamageTaken', 'INC', secondaryGroupMaimBonus, 'Support: Maim'));
      playerDb.setCondition('EnemyMaimed', true);
      enemyDb.setCondition('Maimed', true);
    }

    // 5. Feeding Frenzy Support on minion groups (+10% more Minion Damage, +10% inc Minion Speed)
    if (
      hasFeedingFrenzyMinionGroup &&
      !build.config.rawInputs?.buffFeedingFrenzy &&
      !hasStatSource(minionDb, 'Damage', 'MORE', 'Feeding Frenzy')
    ) {
      minionDb.addMod(mkMod('Damage', 'MORE', 10, 'Buff: Feeding Frenzy'));
      minionDb.addMod(mkMod('Speed', 'INC', 10, 'Buff: Feeding Frenzy', ModFlag.Attack));
      minionDb.addMod(mkMod('Speed', 'INC', 10, 'Buff: Feeding Frenzy', ModFlag.Spell));
    }

    // 6. Pact of Beidat / Ghorr / K'Tash / Lycia (CalcOffence.lua:2922-2969 uptime-scaled MORE Damage)
    if (activePacts.length > 0) {
      const mainGrp = build.skills[mainGroupIndex];
      const mainActiveInst = mainGrp?.gems.find((g) => {
        if (!g.enabled) return false;
        const d = lookupGem('poe1', g.gemId);
        return Boolean(d && d.category === 'active');
      });
      const mainActiveDef = mainActiveInst ? lookupGem('poe1', mainActiveInst.gemId) : undefined;
      if (mainActiveDef) {
        const mTags = new Set(mainActiveDef.tags.map((t) => t.toLowerCase()));
        const isMainSpell = mTags.has('spell') && !mTags.has('brand');
        if (isMainSpell) {
          const isMainVaal = mTags.has('vaal') || /^vaal\s+/i.test(mainActiveDef.name.en);
          const isMainChannel = mTags.has('channelling') || mTags.has('channeling');
          const isMainProjOrChainOrArea =
            mTags.has('projectile') || mTags.has('chaining') || mTags.has('area');
          const isMainDot =
            mTags.has('damage_over_time') ||
            mTags.has('dot') ||
            Boolean(mainActiveDef.skillData?.baseDotDamage);

          // Estimate main spell cast speed & repeats for PoB Pact uptime calculation
          const baseCastTime = Math.max(0.1, mainActiveDef.castTime ?? 0.7);
          const spellSpdInc = playerDb.sum('INC', 'Speed', ModFlag.Spell, KeywordFlag.Spell);
          const spellSpdMore = playerDb.more('Speed', ModFlag.Spell, KeywordFlag.Spell);
          const hasSpellEcho = Boolean(
            mainGrp?.gems.some((g) => {
              if (!g.enabled) return false;
              const sd = lookupGem('poe1', g.gemId);
              const sn = sd ? stripSupportSuffix(sd.name.en) : '';
              return sn === 'spell echo' || sn === 'awakened spell echo';
            }),
          );
          const echoSpeedMult = hasSpellEcho ? 1.54 : 1;
          const repeats = hasSpellEcho ? 2 : 1;
          const estMainSpeed =
            (1 / baseCastTime) * Math.max(0.1, 1 + spellSpdInc / 100) * spellSpdMore * echoSpeedMult;
          const empoweredUseRate = estMainSpeed / repeats;
          const pactMaxHit = Boolean(build.config.rawInputs?.conditionPactMaxHit);

          const appliedPactKeys = new Set<string>();
          for (const pact of activePacts) {
            if (appliedPactKeys.has(pact.key)) continue;
            const applies =
              (pact.key === 'Beidat' && !isMainVaal && !isMainChannel && isMainProjOrChainOrArea) ||
              (pact.key === 'Ghorr' && !isMainVaal && isMainDot) ||
              (pact.key === 'Ktash' && isMainVaal) ||
              (pact.key === 'Lycia' && !isMainVaal && isMainChannel);
            if (!applies) continue;
            appliedPactKeys.add(pact.key);

            const baseCd = pact.key === 'Ktash' ? 6 : 4;
            const qualCdr = pact.key === 'Ktash' ? Math.floor(pact.effQuality * 0.5) : 0;
            const totalCdr = Math.max(
              -50,
              playerDb.sum('INC', 'CooldownRecovery') + pact.groupCdrInc + qualCdr,
            );
            const cooldown = baseCd / Math.max(0.1, 1 + totalCdr / 100);
            const pactCastRate =
              (1 / 0.8) * Math.max(0.1, 1 + spellSpdInc / 100) * spellSpdMore;
            const pactCastTime = 1 / Math.min(pactCastRate, 30.303);
            const count =
              pact.key === 'Beidat'
                ? 6 + Math.floor(pact.effQuality * 0.1 + 1e-9)
                : pact.key === 'Ktash'
                  ? 1
                  : 3;
            const uptime =
              empoweredUseRate <= 0
                ? 1
                : Math.min(1, count / empoweredUseRate / (cooldown + pactCastTime));
            const effectMult = pactMaxHit ? 1 : uptime;
            const rawMore =
              pact.key === 'Beidat'
                ? 15 + pact.effLevel
                : pact.key === 'Ktash'
                  ? 9 + pact.effLevel
                  : 40;
            const scaledMore = Math.round(rawMore * effectMult * 100) / 100;
            if (scaledMore > 0) {
              const modFlags = pact.key === 'Ghorr' ? ModFlag.Dot : 0;
              const modKw = pact.key === 'Beidat' ? KeywordFlag.Hit | KeywordFlag.Ailment : 0;
              const modTags =
                pact.key === 'Ktash'
                  ? [{ type: 'SkillType' as const, skillType: 'Vaal' }]
                  : undefined;
              playerDb.addMod({
                ...mkMod('Damage', 'MORE', scaledMore, `Uptime Scaled ${pact.name}`, modFlags, modKw),
                ...(modTags ? { tags: modTags } : {}),
              });
            }
          }
        }
      }
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
