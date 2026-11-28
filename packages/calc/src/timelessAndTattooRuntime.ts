import {
  KeywordFlag,
  ModFlag,
  type Build,
  type EquipmentSlotId,
  type GameId,
  type Item,
  type Mod,
  type ModTag,
  type ModType,
  type PassiveNode,
  type PassiveTreeData,
} from '@webpob/core';
import { normalizeStatLineToEn } from '@webpob/i18n';
import {
  getJewelRadiusPx,
  resolveActiveSocketedJewels,
  scaleStatLineNumeric,
  type JewelRadiusLabel,
} from './jewelAndTreeSetup.js';
import { parseModLines } from './modParser.js';

// ============================================================================
// Shared Internal Helpers
// ============================================================================

function mkMod(
  name: string,
  type: ModType,
  value: number | boolean | string,
  source: string,
  flags = 0,
  keywordFlags = 0,
  tags?: ModTag[],
): Mod {
  return tags && tags.length > 0
    ? { name, type, value, flags, keywordFlags, source, tags }
    : { name, type, value, flags, keywordFlags, source };
}

function stripPobTags(line: string): string {
  return normalizeStatLineToEn(line.replace(/\{[^}]*\}/g, '').trim()).trim();
}

function normalizeRadiusLabel(raw: string): JewelRadiusLabel {
  const lower = raw.trim().toLowerCase();
  if (lower === 'small') return 'Small';
  if (lower === 'medium') return 'Medium';
  if (lower === 'large') return 'Large';
  if (lower === 'very large') return 'Very Large';
  if (lower === 'massive') return 'Massive';
  return 'Large';
}

function resolveRadiusLabelFromItem(
  item: Item,
  defaultLabel: JewelRadiusLabel,
): JewelRadiusLabel {
  const allLines = [...item.implicits, ...item.explicits].map(stripPobTags);
  for (const line of allLines) {
    const m = line.match(
      /^Upgrades Radius to (Small|Medium|Large|Very Large|Massive)$/i,
    );
    if (m) return normalizeRadiusLabel(m[1]!);
  }
  if (item.rawText) {
    const m = item.rawText.match(
      /^\s*Radius\s*:\s*(Small|Medium|Large|Very Large|Massive)\b/im,
    );
    if (m) return normalizeRadiusLabel(m[1]!);
  }
  return defaultLabel;
}

function scaleStatLineDelta(line: string, mult: number): string | null {
  if (mult === 1 || !Number.isFinite(mult)) return null;
  let anyNonZero = false;
  const out = line.replace(
    /([+-]?)(\d+(?:\.\d+)?)/g,
    (_full, sign: string, numStr: string) => {
      const val = Number(numStr);
      const dotIdx = numStr.indexOf('.');
      if (dotIdx === -1) {
        const delta = Math.trunc(val * mult) - val;
        if (delta !== 0) anyNonZero = true;
        return `${sign}${delta}`;
      }
      const decimals = numStr.length - dotIdx - 1;
      const factor = Math.pow(10, decimals);
      const scaled = Math.trunc(val * mult * factor) / factor;
      const delta = Math.round((scaled - val) * factor) / factor;
      if (delta !== 0) anyNonZero = true;
      return `${sign}${delta}`;
    },
  );
  return anyNonZero ? out : null;
}

function getAllocatedNodesInRadius(
  socketNode: PassiveNode,
  tree: PassiveTreeData,
  activeTreeNodes: Set<number>,
  radiusPx: number,
  excludeAscendancy = true,
): PassiveNode[] {
  const rSq = radiusPx * radiusPx;
  const out: PassiveNode[] = [];
  for (const id of activeTreeNodes) {
    if (id === socketNode.id) continue;
    const node = tree.nodes[id];
    if (!node) continue;
    if (node.kind === 'mastery' || node.kind === 'start' || node.kind === 'jewel') {
      continue;
    }
    if (excludeAscendancy && node.ascendancyId) continue;
    const dx = node.x - socketNode.x;
    const dy = node.y - socketNode.y;
    if (dx * dx + dy * dy <= rSq) {
      out.push(node);
    }
  }
  return out;
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    const buf = Buffer.from(cleaned, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  if (typeof atob === 'function') {
    const bin = atob(cleaned);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  // Pure JS fallback
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(128);
  lookup.fill(255);
  for (let i = 0; i < alphabet.length; i++) {
    lookup[alphabet.charCodeAt(i)] = i;
  }
  const len = cleaned.length;
  const pad = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  const out = new Uint8Array(((len * 3) >> 2) - pad);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const a = lookup[cleaned.charCodeAt(i)] ?? 0;
    const b = lookup[cleaned.charCodeAt(i + 1)] ?? 0;
    const c = i + 2 < len ? (lookup[cleaned.charCodeAt(i + 2)] ?? 0) : 0;
    const d = i + 3 < len ? (lookup[cleaned.charCodeAt(i + 3)] ?? 0) : 0;
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    if (p < out.length) out[p++] = (triple >> 16) & 0xff;
    if (p < out.length) out[p++] = (triple >> 8) & 0xff;
    if (p < out.length) out[p++] = triple & 0xff;
  }
  return out;
}

// ============================================================================
// 1. Timeless Jewel Evaluator (All 6 Jewels — PoE 1 & PoE 2)
// ============================================================================

export type TimelessJewelType =
  | 'Glorious Vanity'
  | 'Lethal Pride'
  | 'Brutal Restraint'
  | 'Militant Faith'
  | 'Elegant Hubris'
  | 'Heroic Tragedy'
  | 'Undying Hate';

export interface ParsedTimelessJewel {
  jewelType: TimelessJewelType;
  seed: number;
  conqueror: string;
  keystoneName: string;
  radiusLabel: JewelRadiusLabel;
  devotionLines: string[];
}

export interface TimelessLutNodeEntry {
  mode: 'add' | 'replace';
  stats: string[];
  name?: string;
}

export interface TimelessLutLookup {
  lookupNode?(
    jewelType: TimelessJewelType | string,
    seed: number,
    nodeId: number,
  ): TimelessLutNodeEntry | null;
}

export interface CompactTimelessJewelLutSection {
  minSeed: number;
  maxSeed: number;
  seedStep?: number;
  legionPassives: ReadonlyArray<{
    id?: number;
    name?: string;
    stats: string[];
    mode?: 'add' | 'replace';
  }>;
  /**
   * Per-node seed table indexed by `Math.floor((seed - minSeed) / (seedStep ?? 1))`:
   * - `string`: base64-encoded `Uint8Array` (or little-endian `Uint16Array` when `bytesPerEntry === 2`)
   * - `number[]`: direct array of passive indices
   */
  nodes: Record<number, string | number[]>;
  /** Bytes per seed entry for base64 payloads: `1` (default, Uint8Array) or `2` (Uint16Array LE). */
  bytesPerEntry?: 1 | 2;
  /** When true (default), index `0` means "no change" and indices `1..N` map to `legionPassives[idx - 1]`. */
  oneBasedIndex?: boolean;
  /** Default mode if a passive entry omits `mode`. */
  defaultMode?: 'add' | 'replace';
}

export type CompactTimelessLutPayload = Partial<
  Record<TimelessJewelType | string, CompactTimelessJewelLutSection>
>;

export interface TimelessJewelKeystoneReplacement {
  jewelNodeId: number;
  replacedNodeId: number;
  originalKeystoneName: string;
  jewelType: TimelessJewelType;
  conqueror: string;
  keystoneName: string;
  descriptionLines: string[];
}

export interface TimelessJewelDetail {
  nodeId: number;
  jewelName: string;
  jewelType: TimelessJewelType;
  seed: number;
  conqueror: string;
  keystoneName: string;
  radiusLabel: JewelRadiusLabel;
  radiusPx: number;
  nodesInRadius: number;
  smallsInRadius: number;
  notablesInRadius: number;
  keystonesReplaced: number;
  devotion: number;
  lutHits: number;
}

export interface TimelessJewelResult {
  /** Synthetic stat lines generated by timeless jewels (ready for `parseModLines`). */
  addedStatLines: Array<{ source: string; lines: string[] }>;
  /** Direct `Mod` objects generated (keystone effects, special devotion mods, etc.). */
  addedMods: Mod[];
  /** Passive node IDs whose original stats must be suppressed (replaced Keystones, Elegant Hubris smalls, Militant Faith travel nodes, LUT replacements). */
  suppressedNodeIds: Set<number>;
  /** True when Caspiro's Supreme Ostentation keystone is active (skip inherent Str/Dex/Int bonuses). */
  supremeOstentation: boolean;
  /** Extra % of Maximum Life gained as Extra Maximum Energy Shield from Corrupted Soul (15 when active). */
  lifeGainAsEsPct: number;
  /** True when PoE 2 Vorana's Black Scythe Training / Circular Teaching disables Strength's inherent Life bonus. */
  noStrLifeBonus: boolean;
  /** True when PoE 2 Medved's Circular Teachings disables Dexterity's inherent Accuracy bonus. */
  noDexAccuracyBonus?: boolean;
  /** True when PoE 2 Olroth's Knightly Tenets disables Intelligence's inherent Mana bonus. */
  noIntManaBonus?: boolean;
  /** Active Power of Purpose conversion descriptor (80% Mana -> 2x Armour), if active. */
  powerOfPurpose: { manaConvertedPct: number; armourMultiplier: number } | null;
  /** Total Devotion accumulated from Militant Faith jewels. */
  totalDevotion: number;
  /** Keystones replaced in radius. */
  replacedKeystones: TimelessJewelKeystoneReplacement[];
  /** Structured per-jewel evaluation diagnostics. */
  details: TimelessJewelDetail[];
}

export interface EvaluateTimelessJewelsOptions {
  /** Optional external LUT lookup (e.g. from `createCompactTimelessLutLookup` or `createBinaryDatasetTimelessLutLookup`). */
  lutLookup?: TimelessLutLookup;
  /** Explicit game override (defaults to `tree.game`). */
  game?: GameId;
  /** When true, uses exact PoB1/PoB2 `smallNodeEffects` (+2/+4 Str/Dex on smalls only, LUT-driven Militant Faith notable Devotion, PoE 1 Kalguur +1%/+2% Ward). */
  useOfficialSmallNodeRules?: boolean;
}

function defaultLutModeForJewel(jewelType: string): 'add' | 'replace' {
  const lower = jewelType.trim().toLowerCase();
  if (lower === 'glorious vanity' || lower === 'elegant hubris') {
    return 'replace';
  }
  return 'add';
}

/**
 * Creates an O(1) cached `TimelessLutLookup` from a compact base64 `Uint8Array` / `Uint16Array`
 * or numeric-array LUT payload (matching `poe1-timeless-jewels.json` contract).
 */
export function createCompactTimelessLutLookup(
  payload: CompactTimelessLutPayload,
): TimelessLutLookup {
  const normalizedSections = new Map<string, CompactTimelessJewelLutSection>();
  for (const [key, sec] of Object.entries(payload)) {
    if (sec) {
      normalizedSections.set(key.trim().toLowerCase(), sec);
    }
  }

  const decodedCache = new Map<string, Uint8Array>();

  return {
    lookupNode(jewelType, seed, nodeId): TimelessLutNodeEntry | null {
      const secKey = jewelType.trim().toLowerCase();
      const section = normalizedSections.get(secKey);
      if (!section) return null;

      const step = section.seedStep && section.seedStep > 0 ? section.seedStep : 1;
      if (seed < section.minSeed || seed > section.maxSeed) return null;
      const offset = seed - section.minSeed;
      if (offset % step !== 0) return null;
      const slotIndex = Math.floor(offset / step);

      const rawNodeTable = section.nodes[nodeId];
      if (rawNodeTable === undefined) return null;

      let passiveIdx: number;
      if (Array.isArray(rawNodeTable)) {
        if (slotIndex < 0 || slotIndex >= rawNodeTable.length) return null;
        passiveIdx = rawNodeTable[slotIndex]!;
      } else {
        const cacheKey = `${secKey}:${nodeId}`;
        let bytes = decodedCache.get(cacheKey);
        if (!bytes) {
          bytes = decodeBase64ToBytes(rawNodeTable);
          decodedCache.set(cacheKey, bytes);
        }
        const bpe = section.bytesPerEntry ?? 1;
        if (bpe === 2) {
          const bytePos = slotIndex * 2;
          if (bytePos + 1 >= bytes.length) return null;
          passiveIdx = bytes[bytePos]! | (bytes[bytePos + 1]! << 8);
        } else {
          if (slotIndex < 0 || slotIndex >= bytes.length) return null;
          passiveIdx = bytes[slotIndex]!;
        }
      }

      const oneBased = section.oneBasedIndex !== false;
      if (oneBased && passiveIdx === 0) return null;

      const arrayIdx = oneBased ? passiveIdx - 1 : passiveIdx;
      const passive =
        section.legionPassives[arrayIdx] ??
        section.legionPassives.find((p) => p.id === passiveIdx);
      if (!passive || !passive.stats || passive.stats.length === 0) return null;

      return {
        mode: passive.mode ?? section.defaultMode ?? defaultLutModeForJewel(jewelType),
        stats: [...passive.stats],
        name: passive.name,
      };
    },
  };
}

interface BinaryDatasetJewelDesc {
  name: string;
  file: string;
  minSeed: number;
  maxSeed: number;
  seedStep?: number;
  numSeeds: number;
  numNodes: number;
  localToGlobal?: Record<string, number>;
}

interface BinaryDatasetPassiveEntry {
  id: string;
  dn?: string;
  sd?: string[];
  ks?: boolean;
  kind?: 'addition' | 'replace';
}

/**
 * Creates an O(1) `TimelessLutLookup` backed by `poe1-timeless-jewels.json` metadata
 * and inflated `timeless/poe1-*.bin` raw `Uint8Array` buffers (`nodeIdx * numSeeds + seedIdx`).
 */
export function createBinaryDatasetTimelessLutLookup(
  dataset: import('@webpob/core').TimelessJewelDataset | null | undefined,
  getBuffer: (file: string) => Uint8Array | null,
): TimelessLutLookup | undefined {
  if (!dataset || typeof dataset !== 'object') return undefined;
  const rawNodes = (dataset as { reachableNodeIds?: unknown }).reachableNodeIds;
  const rawJewels = (dataset as { jewels?: Record<string, BinaryDatasetJewelDesc> }).jewels;
  const rawPassives = (dataset as { legionPassives?: Record<string, BinaryDatasetPassiveEntry> })
    .legionPassives;
  if (!Array.isArray(rawNodes) || !rawJewels || !rawPassives) return undefined;

  const nodeIdToIndex = new Map<number, number>();
  rawNodes.forEach((nid, idx) => {
    if (typeof nid === 'number') nodeIdToIndex.set(nid, idx);
  });

  const jewelsByName = new Map<string, BinaryDatasetJewelDesc>();
  for (const desc of Object.values(rawJewels)) {
    if (desc?.name && desc.file) {
      jewelsByName.set(desc.name.trim().toLowerCase(), desc);
    }
  }

  return {
    lookupNode(jewelType, seed, nodeId): TimelessLutNodeEntry | null {
      const desc = jewelsByName.get(jewelType.trim().toLowerCase());
      if (!desc) return null;
      const nodeIdx = nodeIdToIndex.get(nodeId);
      if (nodeIdx === undefined || nodeIdx < 0 || nodeIdx >= desc.numNodes) return null;
      const step = desc.seedStep && desc.seedStep > 0 ? desc.seedStep : 1;
      if (seed < desc.minSeed || seed > desc.maxSeed) return null;
      const offset = seed - desc.minSeed;
      if (offset % step !== 0) return null;
      const seedIdx = Math.floor(offset / step);
      if (seedIdx < 0 || seedIdx >= desc.numSeeds) return null;

      const buf = getBuffer(desc.file);
      if (!buf) return null;
      const byteIndex = nodeIdx * desc.numSeeds + seedIdx;
      if (byteIndex < 0 || byteIndex >= buf.length) return null;

      const localId = buf[byteIndex]!;
      const globalId = desc.localToGlobal?.[String(localId)] ?? localId;
      const passive = rawPassives[String(globalId)];
      if (!passive) return null;

      const mode: 'add' | 'replace' =
        passive.kind === 'replace'
          ? 'replace'
          : passive.kind === 'addition'
            ? 'add'
            : defaultLutModeForJewel(jewelType);
      return {
        mode,
        stats: Array.isArray(passive.sd) ? [...passive.sd] : [],
        name: passive.dn,
      };
    },
  };
}

interface TimelessConquerorSpec {
  keystoneName: string;
  descriptionLines: string[];
  buildMods: (source: string) => Mod[];
  supremeOstentation?: boolean;
  lifeGainAsEsPct?: number;
  noStrLifeBonus?: boolean;
  noDexAccuracyBonus?: boolean;
  noIntManaBonus?: boolean;
  powerOfPurpose?: { manaConvertedPct: number; armourMultiplier: number };
}

function getConquerorKeystoneSpec(
  jewelType: TimelessJewelType,
  conqueror: string,
  game: GameId,
): TimelessConquerorSpec | null {
  const c = conqueror.trim().toLowerCase();

  switch (jewelType) {
    case 'Glorious Vanity':
      if (c === 'doryani') {
        return {
          keystoneName: 'Corrupted Soul',
          descriptionLines: [
            '50% of Non-Chaos Damage taken bypasses Energy Shield',
            'Gain 15% of Maximum Life as Extra Maximum Energy Shield',
          ],
          lifeGainAsEsPct: 15,
          buildMods: (src) => [
            mkMod('CorruptedSoul', 'FLAG', true, src),
            mkMod('LifeAsExtraES', 'BASE', 15, src),
            mkMod('NonChaosDamageBypassEs', 'BASE', 50, src),
          ],
        };
      }
      if (c === 'xibaqua') {
        return {
          keystoneName: 'Divine Flesh',
          descriptionLines: [
            'All Damage taken bypasses Energy Shield',
            '50% of Elemental Damage taken as Chaos Damage',
            '+5% to maximum Chaos Resistance',
          ],
          buildMods: (src) => [
            mkMod('DivineFlesh', 'FLAG', true, src),
            mkMod('AllDamageBypassEs', 'FLAG', true, src),
            mkMod('EleTakenAsChaos', 'BASE', 50, src),
            mkMod('ChaosResistMax', 'BASE', 5, src),
          ],
        };
      }
      if (c === 'ahuana') {
        return {
          keystoneName: 'Immortal Ambition',
          descriptionLines: [
            'Energy Shield starts at zero',
            'Cannot Recharge or Regenerate Energy Shield',
            'Lose 5% of Energy Shield per second',
            'Life Leech effects are not removed at Full Life',
            'Life Leech effects Recover Energy Shield instead while on Full Life',
          ],
          buildMods: (src) => [
            mkMod('ImmortalAmbition', 'FLAG', true, src),
            mkMod('EnergyShieldStartsAtZero', 'FLAG', true, src),
            mkMod('NoEsRecharge', 'FLAG', true, src),
            mkMod('NoEsRegen', 'FLAG', true, src),
            mkMod('Overleech', 'FLAG', true, src),
            mkMod('EsDegenPercent', 'BASE', 5, src),
          ],
        };
      }
      return null;

    case 'Lethal Pride':
      if (c === 'kaom') {
        return {
          keystoneName: 'Strength of Blood',
          descriptionLines: [
            'Recovery from Life Leech is not applied',
            '1% less Damage taken for every 2% Recovery per second from Life Leech',
          ],
          buildMods: (src) => [mkMod('StrengthOfBlood', 'FLAG', true, src)],
        };
      }
      if (c === 'rakiata') {
        return {
          keystoneName: 'Tempered by War',
          descriptionLines: [
            '50% of Cold and Lightning Damage taken as Fire Damage',
            '50% less Cold Resistance',
            '50% less Lightning Resistance',
          ],
          buildMods: (src) => [
            mkMod('TemperedByWar', 'FLAG', true, src),
            mkMod('ColdTakenAsFire', 'BASE', 50, src),
            mkMod('LightningTakenAsFire', 'BASE', 50, src),
            mkMod('ColdResist', 'MORE', -50, src),
            mkMod('LightningResist', 'MORE', -50, src),
          ],
        };
      }
      if (c === 'akoya') {
        return {
          keystoneName: 'Chainbreaker',
          descriptionLines: [
            'Increases and Reductions to Mana Regeneration Rate instead apply to Rage Regeneration Rate',
            '+3 to Rage Regeneration per second',
            'Skills have +5 Rage Cost',
          ],
          buildMods: (src) => [
            mkMod('Chainbreaker', 'FLAG', true, src),
            mkMod('RageRegen', 'BASE', 3, src),
          ],
        };
      }
      return null;

    case 'Brutal Restraint':
      if (c === 'balbala') {
        return {
          keystoneName: 'The Traitor',
          descriptionLines: [
            'Flasks gain 4 Charges every 5 seconds for each empty Flask Slot',
          ],
          buildMods: (src) => [mkMod('TheTraitor', 'FLAG', true, src)],
        };
      }
      if (c === 'asenath') {
        return {
          keystoneName: 'Dance with Death',
          descriptionLines: [
            "Can't use Helmets",
            'Your Critical Strike Chance is Lucky',
            'Your Damage with Critical Strikes is Lucky',
          ],
          buildMods: (src) => [
            mkMod('DanceWithDeath', 'FLAG', true, src),
            mkMod('CritChanceLucky', 'FLAG', true, src),
            mkMod('CritDamageLucky', 'FLAG', true, src),
          ],
        };
      }
      if (c === 'nasima') {
        return {
          keystoneName: 'Second Sight',
          descriptionLines: [
            'You are Blind',
            'Blind does not affect your Light Radius',
            '25% more Melee Critical Strike Chance while Blinded',
          ],
          buildMods: (src) => [
            mkMod('SecondSight', 'FLAG', true, src),
            mkMod('Blind', 'FLAG', true, src),
            mkMod('CritChance', 'MORE', 25, src, ModFlag.Melee),
          ],
        };
      }
      return null;

    case 'Militant Faith':
      if (c === 'dominus') {
        return {
          keystoneName: 'Inner Conviction',
          descriptionLines: [
            '3% more Spell Damage per Power Charge',
            'Gain Power Charges instead of Frenzy Charges',
          ],
          // Uses ModTag Multiplier:PowerCharge directly so ModDB evaluates 3% MORE Spell Damage
          // per active Power Charge without triggering duplicate InnerConviction flag hooks.
          buildMods: (src) => [
            mkMod('Damage', 'MORE', 3, src, ModFlag.Spell, 0, [
              { type: 'Multiplier', var: 'PowerCharge' },
            ]),
            mkMod('GainPowerInsteadOfFrenzy', 'FLAG', true, src),
          ],
        };
      }
      if (c === 'maxarius') {
        return {
          keystoneName: 'Transcendence',
          descriptionLines: [
            'Armour applies to Fire, Cold and Lightning Damage taken from Hits instead of Physical Damage',
            '-15% to all maximum Elemental Resistances',
          ],
          buildMods: (src) => [
            mkMod('Transcendence', 'FLAG', true, src),
            mkMod('ArmourAppliesToEle', 'BASE', 100, src),
            mkMod('ArmourDoesNotApplyToPhys', 'FLAG', true, src),
            mkMod('FireResistMax', 'BASE', -15, src),
            mkMod('ColdResistMax', 'BASE', -15, src),
            mkMod('LightningResistMax', 'BASE', -15, src),
          ],
        };
      }
      if (c === 'avarius') {
        return {
          keystoneName: 'Power of Purpose',
          descriptionLines: [
            '80% of Maximum Mana is converted to twice that much Armour',
          ],
          powerOfPurpose: { manaConvertedPct: 80, armourMultiplier: 2 },
          buildMods: (src) => [
            mkMod('PowerOfPurpose', 'FLAG', true, src),
            mkMod('ManaConvertToArmourPct', 'BASE', 80, src),
            mkMod('ManaToArmourMultiplier', 'BASE', 2, src),
          ],
        };
      }
      return null;

    case 'Elegant Hubris':
      if (c === 'cadiro') {
        return {
          keystoneName: 'Supreme Decadence',
          descriptionLines: [
            'Life Recovery from Flasks also applies to Energy Shield',
            '30% less Life Recovery from Flasks',
          ],
          buildMods: (src) => [
            mkMod('SupremeDecadence', 'FLAG', true, src),
            mkMod('LifeFlasksApplyToEs', 'FLAG', true, src),
            mkMod('LifeRecoveryFromFlasks', 'MORE', -30, src),
          ],
        };
      }
      if (c === 'victario') {
        return {
          keystoneName: 'Supreme Grandstanding',
          descriptionLines: [
            'Nearby Allies and Enemies Share Charges with you',
          ],
          buildMods: (src) => [mkMod('SupremeGrandstanding', 'FLAG', true, src)],
        };
      }
      if (c === 'caspiro') {
        return {
          keystoneName: 'Supreme Ostentation',
          descriptionLines: [
            'Ignore Attribute Requirements',
            'Gain no inherent bonuses from Attributes',
          ],
          supremeOstentation: true,
          buildMods: (src) => [
            mkMod('SupremeOstentation', 'FLAG', true, src),
            mkMod('IgnoreAttributeRequirements', 'FLAG', true, src),
            mkMod('NoAttributeBonuses', 'FLAG', true, src),
          ],
        };
      }
      return null;

    case 'Heroic Tragedy':
      if (c === 'vorana') {
        if (game === 'poe2') {
          return {
            keystoneName: 'Circular Teaching',
            descriptionLines: [
              'Strength provides no inherent bonus to Maximum Life',
              '1% increased maximum Energy Shield per 2 Strength',
            ],
            noStrLifeBonus: true,
            buildMods: (src) => [
              mkMod('CircularTeaching', 'FLAG', true, src),
              mkMod('BlackScytheTraining', 'FLAG', true, src),
              mkMod('NoStrLifeBonus', 'FLAG', true, src),
              mkMod('EnergyShield', 'INC', 1, src, 0, 0, [
                { type: 'PerStat', stat: 'Str', div: 2 },
              ]),
            ],
          };
        }
        return {
          keystoneName: 'Black Scythe Training',
          descriptionLines: ['Ward does not break on Hit', '50% faster Restoration of Ward'],
          buildMods: (src) => [
            mkMod('BlackScytheTraining', 'FLAG', true, src),
            mkMod('WardRestoration', 'INC', 50, src),
          ],
        };
      }
      if (c === 'uhtred') {
        return {
          keystoneName: 'Celestial Mathematics',
          descriptionLines: ['Celestial Mathematics'],
          buildMods: (src) => [mkMod('CelestialMathematics', 'FLAG', true, src)],
        };
      }
      if (c === 'medved') {
        if (game === 'poe2') {
          return {
            keystoneName: 'Circular Teachings',
            descriptionLines: [
              'Gain no inherent bonus from Dexterity',
              '1% increased Armour per 2 Dexterity',
            ],
            noDexAccuracyBonus: true,
            buildMods: (src) => [
              mkMod('CircularTeachings', 'FLAG', true, src),
              mkMod('NoDexAccuracyBonus', 'FLAG', true, src),
              mkMod('Armour', 'INC', 1, src, 0, 0, [
                { type: 'PerStat', stat: 'Dex', div: 2 },
              ]),
            ],
          };
        }
        return {
          keystoneName: 'Unbreaking',
          descriptionLines: ['40% less Ward', 'Ward has a 60% chance to not Break'],
          buildMods: (src) => [
            mkMod('Unbreaking', 'FLAG', true, src),
            mkMod('Ward', 'MORE', -40, src),
          ],
        };
      }
      if (c === 'olroth') {
        if (game === 'poe2') {
          return {
            keystoneName: 'Knightly Tenets',
            descriptionLines: [
              'Gain no inherent bonus from Intelligence',
              '1% increased Evasion Rating per 2 Intelligence',
            ],
            noIntManaBonus: true,
            buildMods: (src) => [
              mkMod('KnightlyTenets', 'FLAG', true, src),
              mkMod('NoIntManaBonus', 'FLAG', true, src),
              mkMod('Evasion', 'INC', 1, src, 0, 0, [
                { type: 'PerStat', stat: 'Int', div: 2 },
              ]),
            ],
          };
        }
        return {
          keystoneName: 'Knightly Vow',
          descriptionLines: ['Knightly Vow'],
          buildMods: (src) => [mkMod('KnightlyVow', 'FLAG', true, src)],
        };
      }
      return null;

    case 'Undying Hate':
      // Official PoB 2 Data/TimelessJewelData/LegionPassives.lua:10274-10470 (Abyssal keystones)
      if (c === 'amanamu') {
        return {
          keystoneName: 'Sacrifice of Flesh',
          descriptionLines: [
            'When taking damage from Hits, 20% of Life Loss is prevented, then 150% of Life Loss prevented this way is Lost over 4 seconds',
          ],
          buildMods: (src) => [mkMod('SacrificeOfFlesh', 'FLAG', true, src)],
        };
      }
      if (c === 'kulemak') {
        return {
          keystoneName: 'Sacrifice of Loyalty',
          descriptionLines: [
            'You deal 1% more Damage per 2 total Power of your Undead Minions',
            'Undead Minions have 25% less maximum Life',
          ],
          buildMods: (src) => [mkMod('SacrificeOfLoyalty', 'FLAG', true, src)],
        };
      }
      if (c === 'kurgal') {
        return {
          keystoneName: 'Sacrifice of Mind',
          descriptionLines: [
            'Mana Recovery from Regeneration Overflows maximum Mana',
            '50% less Mana Regeneration Rate',
          ],
          buildMods: (src) => [
            mkMod('SacrificeOfMind', 'FLAG', true, src),
            mkMod('ManaRegen', 'MORE', -50, src),
          ],
        };
      }
      if (c === 'tecrod') {
        return {
          keystoneName: 'Sacrifice of Blood',
          descriptionLines: [
            'Regenerate 1 Life per second per 16 Life spent in the past 4 seconds',
            '20% more Life Cost of Skills',
          ],
          buildMods: (src) => [
            mkMod('SacrificeOfBlood', 'FLAG', true, src),
            mkMod('LifeCost', 'MORE', 20, src),
          ],
        };
      }
      if (c === 'ulaman') {
        return {
          keystoneName: 'Sacrifice of Sight',
          descriptionLines: [
            'Projectiles do one of the following at random: Fork an additional time, Chain an additional time, Chain from Terrain an additional time, Cannot collide with targets',
          ],
          buildMods: (src) => [mkMod('SacrificeOfSight', 'FLAG', true, src)],
        };
      }
      return null;
  }
}

function canonicalCapitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Parses a Timeless Jewel item into its canonical type, numeric seed, conqueror,
 * mapped keystone name, radius label, and any Devotion scaling lines.
 * Returns `null` if the item is not a recognized Timeless Jewel.
 */
export function parseTimelessJewel(
  jewel: Item,
  game: GameId = 'poe1',
): ParsedTimelessJewel | null {
  const candidateLines: string[] = [];
  for (const raw of [...jewel.implicits, ...jewel.explicits]) {
    for (const part of raw.split(/\r?\n/)) {
      const cleaned = stripPobTags(part);
      if (cleaned) candidateLines.push(cleaned);
    }
  }
  if (candidateLines.length === 0 && jewel.rawText) {
    for (const part of jewel.rawText.split(/\r?\n/)) {
      const cleaned = stripPobTags(part);
      if (cleaned) candidateLines.push(cleaned);
    }
  }

  let jewelType: TimelessJewelType | null = null;
  let seed = 0;
  let conqueror = '';
  const devotionLines: string[] = [];

  for (const line of candidateLines) {
    if (/\bper\s+\d+\s+Devotion\b/i.test(line)) {
      devotionLines.push(line);
      continue;
    }

    let m = line.match(
      /Bathed in the blood of (\d+) sacrificed in the name of (Doryani|Xibaqua|Ahuana|Mazcotl)/i,
    );
    if (m) {
      jewelType = 'Glorious Vanity';
      seed = Number(m[1]);
      conqueror = canonicalCapitalize(m[2]!);
      continue;
    }

    m = line.match(
      /Commanded leadership over (\d+) warriors under (Kaom|Rakiata|Akoya)/i,
    );
    if (m) {
      jewelType = 'Lethal Pride';
      seed = Number(m[1]);
      conqueror = canonicalCapitalize(m[2]!);
      continue;
    }

    m = line.match(
      /Denoted service of (\d+) dekhara in the akhara of (Balbala|Asenath|Nasima)/i,
    );
    if (m) {
      jewelType = 'Brutal Restraint';
      seed = Number(m[1]);
      conqueror = canonicalCapitalize(m[2]!);
      continue;
    }

    m = line.match(
      /Carved to glorify (\d+) new faithful converted by High Templar (Dominus|Maxarius|Avarius|Venarius)/i,
    );
    if (m) {
      jewelType = 'Militant Faith';
      seed = Number(m[1]);
      conqueror = canonicalCapitalize(m[2]!);
      continue;
    }

    m = line.match(
      /Commissioned (\d+) coins to commemorate (Cadiro|Victario|Caspiro)/i,
    );
    if (m) {
      jewelType = 'Elegant Hubris';
      seed = Number(m[1]);
      conqueror = canonicalCapitalize(m[2]!);
      continue;
    }

    m = line.match(
      /Remembrancing (\d+) songworthy deeds by the line of (Vorana|Uhtred|Medved|Olroth)/i,
    );
    if (m) {
      jewelType = 'Heroic Tragedy';
      seed = Number(m[1]);
      conqueror = canonicalCapitalize(m[2]!);
      continue;
    }

    m = line.match(
      /Glorifying the defilement of (\d+) souls in tribute to (Amanamu|Kulemak|Kurgal|Tecrod|Ulaman)/i,
    );
    if (m) {
      jewelType = 'Undying Hate';
      seed = Number(m[1]);
      conqueror = canonicalCapitalize(m[2]!);
      continue;
    }
  }

  if (!jewelType) return null;

  const spec = getConquerorKeystoneSpec(jewelType, conqueror, game);
  const defaultRadius: JewelRadiusLabel = jewelType === 'Undying Hate' ? 'Very Large' : 'Large';
  const radiusLabel = resolveRadiusLabelFromItem(jewel, defaultRadius);

  return {
    jewelType,
    seed,
    conqueror,
    keystoneName: spec?.keystoneName ?? '',
    radiusLabel,
    devotionLines,
  };
}

function isAttributeTravelSmallNode(node: PassiveNode): boolean {
  if (node.kind !== 'small' || node.ascendancyId) return false;
  if (node.name.en.trim().toLowerCase() === 'attribute') return true;
  if (node.stats.length !== 1) return false;
  const line = stripPobTags(node.stats[0]!);
  return /^\+(?:5|10) to (?:Strength|Dexterity|Intelligence|any Attribute)$/i.test(line);
}

/**
 * Evaluates a single Militant Faith `per <D> Devotion` line given accumulated `devotion`.
 * Emits either a scaled canonical stat line (for `parseModLines`) or direct `Mod`s when
 * `parseModLines` cannot represent the stat natively.
 */
function evaluateDevotionLine(
  line: string,
  devotion: number,
  source: string,
  outStatLines: string[],
  outMods: Mod[],
): void {
  const m = line.match(/^(.+?)\s+per\s+(\d+)\s+Devotion$/i);
  if (!m) return;
  const baseClause = m[1]!.trim();
  const div = Math.max(1, Number(m[2]));
  const steps = Math.floor(devotion / div);
  if (steps <= 0) return;

  const scaledLine = scaleStatLineNumeric(baseClause, steps);

  // Special Devotion lines that need direct Mod representation if parseModLines cannot parse them
  const mTotem = scaledLine.match(/^(\d+)% increased Totem Damage$/i);
  if (mTotem) {
    outMods.push(
      mkMod('Damage', 'INC', Number(mTotem[1]), source, 0, KeywordFlag.Totem),
    );
    return;
  }
  const mBrand = scaledLine.match(/^(\d+)% increased Brand Damage$/i);
  if (mBrand) {
    outMods.push({
      ...mkMod('Damage', 'INC', Number(mBrand[1]), source),
      tags: [{ type: 'SkillType', skillType: 'Brand' }],
    });
    return;
  }
  const mChannel = scaledLine.match(
    /^(\d+)% increased (?:Channelling Damage|Damage with Channelling Skills)$/i,
  );
  if (mChannel) {
    outMods.push({
      ...mkMod('Damage', 'INC', Number(mChannel[1]), source),
      tags: [{ type: 'Condition', var: 'Channelling' }],
    });
    return;
  }
  const mManaEff = scaledLine.match(/^(\d+)% increased Mana Cost Efficiency$/i);
  if (mManaEff) {
    outMods.push(mkMod('ManaCostEfficiency', 'INC', Number(mManaEff[1]), source));
    return;
  }
  const mAuraSelf = scaledLine.match(
    /^(\d+)% increased Effect of non-Curse Auras on you$/i,
  );
  if (mAuraSelf) {
    outMods.push(mkMod('AuraEffectOnSelf', 'INC', Number(mAuraSelf[1]), source));
    return;
  }
  const mMinionSpeed = scaledLine.match(
    /^(\d+)% increased Minion Attack and Cast Speed$/i,
  );
  if (mMinionSpeed) {
    outMods.push(mkMod('MinionSpeed', 'INC', Number(mMinionSpeed[1]), source));
    return;
  }

  // Standard parseable lines: "+X% to all Elemental Resistances", "X% increased Area/Elemental/Minion Damage",
  // "X% reduced Mana Cost of Skills", "X% increased Global Defences", etc.
  const testParsed = parseModLines([scaledLine], source);
  if (testParsed.length > 0) {
    outStatLines.push(scaledLine);
    return;
  }

  // Fallback: push scaled line anyway so diagnostics/future parser rules pick it up
  outStatLines.push(scaledLine);
}

/**
 * Evaluates all socketed Timeless Jewels (`Glorious Vanity`, `Lethal Pride`,
 * `Brutal Restraint`, `Militant Faith`, `Elegant Hubris`, `Heroic Tragedy`)
 * across both PoE 1 (`Large = 1800px`) and PoE 2 (`Large = 1560px`).
 */
export function evaluateTimelessJewels(
  jewels: ReadonlyArray<{ nodeId: number; jewel: Item }>,
  tree: PassiveTreeData,
  activeTreeNodes: Set<number>,
  options?: EvaluateTimelessJewelsOptions,
): TimelessJewelResult {
  const game = options?.game ?? tree.game;
  const lutLookup = options?.lutLookup;
  const officialSmalls = Boolean(options?.useOfficialSmallNodeRules);

  const addedStatLines: Array<{ source: string; lines: string[] }> = [];
  const addedMods: Mod[] = [];
  const suppressedNodeIds = new Set<number>();
  const replacedKeystones: TimelessJewelKeystoneReplacement[] = [];
  const details: TimelessJewelDetail[] = [];

  let supremeOstentation = false;
  let lifeGainAsEsPct = 0;
  let noStrLifeBonus = false;
  let noDexAccuracyBonus = false;
  let noIntManaBonus = false;
  let powerOfPurpose: { manaConvertedPct: number; armourMultiplier: number } | null = null;
  let totalDevotion = 0;

  const appliedKeystoneNames = new Set<string>();

  for (const { nodeId, jewel } of jewels) {
    const parsed = parseTimelessJewel(jewel, game);
    if (!parsed) continue;

    const socketNode = tree.nodes[nodeId];
    if (!socketNode) continue;

    const radiusPx = getJewelRadiusPx(parsed.radiusLabel, game, tree.version);
    const inRadius = getAllocatedNodesInRadius(
      socketNode,
      tree,
      activeTreeNodes,
      radiusPx,
      true,
    );

    const smalls = inRadius.filter((n) => n.kind === 'small');
    const notables = inRadius.filter((n) => n.kind === 'notable');
    const keystones = inRadius.filter((n) => n.kind === 'keystone');

    const jewelSrc = `Timeless Jewel (${parsed.jewelType} ${parsed.seed}, ${parsed.conqueror})`;
    let keystonesReplaced = 0;
    let jewelDevotion = 0;
    let lutHits = 0;

    // 1. Replace allocated Keystones in radius with Conqueror's Keystone
    const conquerorSpec = getConquerorKeystoneSpec(
      parsed.jewelType,
      parsed.conqueror,
      game,
    );
    for (const ksNode of keystones) {
      suppressedNodeIds.add(ksNode.id);
      keystonesReplaced++;

      if (conquerorSpec) {
        replacedKeystones.push({
          jewelNodeId: nodeId,
          replacedNodeId: ksNode.id,
          originalKeystoneName: ksNode.name.en,
          jewelType: parsed.jewelType,
          conqueror: parsed.conqueror,
          keystoneName: conquerorSpec.keystoneName,
          descriptionLines: [...conquerorSpec.descriptionLines],
        });

        if (!appliedKeystoneNames.has(conquerorSpec.keystoneName)) {
          appliedKeystoneNames.add(conquerorSpec.keystoneName);
          const ksSrc = `Timeless Keystone: ${conquerorSpec.keystoneName} (${parsed.jewelType})`;
          addedMods.push(...conquerorSpec.buildMods(ksSrc));
          if (conquerorSpec.supremeOstentation) supremeOstentation = true;
          if (conquerorSpec.lifeGainAsEsPct) {
            lifeGainAsEsPct += conquerorSpec.lifeGainAsEsPct;
          }
          if (conquerorSpec.noStrLifeBonus) noStrLifeBonus = true;
          if (conquerorSpec.noDexAccuracyBonus) noDexAccuracyBonus = true;
          if (conquerorSpec.noIntManaBonus) noIntManaBonus = true;
          if (conquerorSpec.powerOfPurpose) {
            powerOfPurpose = { ...conquerorSpec.powerOfPurpose };
          }
        }
      }
    }

    // 2. Small & Notable passive rules per Timeless Jewel
    const lutLines: string[] = [];

    if (parsed.jewelType === 'Elegant Hubris') {
      // Small Passive Skills in Radius grant nothing!
      for (const s of smalls) {
        suppressedNodeIds.add(s.id);
      }
      if (lutLookup?.lookupNode) {
        for (const n of notables) {
          const hit = lutLookup.lookupNode(parsed.jewelType, parsed.seed, n.id);
          if (hit) {
            lutHits++;
            if (hit.mode === 'replace') suppressedNodeIds.add(n.id);
            lutLines.push(...hit.stats);
          }
        }
      }
    } else if (parsed.jewelType === 'Glorious Vanity') {
      // Passives in radius are Conquered by the Vaal: ALL smalls and notables are replaced
      for (const node of [...smalls, ...notables]) {
        suppressedNodeIds.add(node.id);
        if (lutLookup?.lookupNode) {
          const hit = lutLookup.lookupNode(parsed.jewelType, parsed.seed, node.id);
          if (hit) {
            lutHits++;
            lutLines.push(...hit.stats);
          }
        }
      }
    } else if (parsed.jewelType === 'Lethal Pride') {
      let bonusStr = 0;
      if (officialSmalls) {
        for (const s of smalls) {
          bonusStr += isAttributeTravelSmallNode(s) ? 2 : 4;
        }
      } else {
        bonusStr = smalls.length * 2 + notables.length * 4;
      }
      if (bonusStr > 0) {
        addedStatLines.push({
          source: jewelSrc,
          lines: [`+${bonusStr} to Strength`],
        });
      }
      if (lutLookup?.lookupNode) {
        for (const node of [...smalls, ...notables]) {
          const hit = lutLookup.lookupNode(parsed.jewelType, parsed.seed, node.id);
          if (hit) {
            lutHits++;
            if (hit.mode === 'replace') suppressedNodeIds.add(node.id);
            lutLines.push(...hit.stats);
          }
        }
      }
    } else if (parsed.jewelType === 'Brutal Restraint') {
      let bonusDex = 0;
      if (officialSmalls) {
        for (const s of smalls) {
          bonusDex += isAttributeTravelSmallNode(s) ? 2 : 4;
        }
      } else {
        bonusDex = smalls.length * 2 + notables.length * 4;
      }
      if (bonusDex > 0) {
        addedStatLines.push({
          source: jewelSrc,
          lines: [`+${bonusDex} to Dexterity`],
        });
      }
      if (lutLookup?.lookupNode) {
        for (const node of [...smalls, ...notables]) {
          const hit = lutLookup.lookupNode(parsed.jewelType, parsed.seed, node.id);
          if (hit) {
            lutHits++;
            if (hit.mode === 'replace') suppressedNodeIds.add(node.id);
            lutLines.push(...hit.stats);
          }
        }
      }
    } else if (parsed.jewelType === 'Militant Faith') {
      for (const s of smalls) {
        if (isAttributeTravelSmallNode(s)) {
          suppressedNodeIds.add(s.id);
          jewelDevotion += 10;
        } else {
          jewelDevotion += 5;
        }
      }
      for (const n of notables) {
        if (lutLookup?.lookupNode) {
          const hit = lutLookup.lookupNode(parsed.jewelType, parsed.seed, n.id);
          if (hit) {
            lutHits++;
            if (hit.mode === 'replace') suppressedNodeIds.add(n.id);
            let notableDevFromLut = 0;
            for (const st of hit.stats) {
              const mDev = stripPobTags(st).match(/^\+(\d+) to Devotion$/i);
              if (mDev) {
                notableDevFromLut += Number(mDev[1]);
              } else {
                lutLines.push(st);
              }
            }
            jewelDevotion += officialSmalls ? notableDevFromLut : 10;
            continue;
          }
        }
        jewelDevotion += 10;
      }
      if (lutLookup?.lookupNode) {
        for (const s of smalls) {
          const hit = lutLookup.lookupNode(parsed.jewelType, parsed.seed, s.id);
          if (hit) {
            lutHits++;
            if (hit.mode === 'replace') suppressedNodeIds.add(s.id);
            for (const st of hit.stats) {
              const mDev = stripPobTags(st).match(/^\+(\d+) to Devotion$/i);
              if (!mDev) {
                lutLines.push(st);
              }
            }
          }
        }
      }

      totalDevotion += jewelDevotion;
      if (jewelDevotion > 0) {
        addedMods.push(mkMod('Devotion', 'BASE', jewelDevotion, jewelSrc));
        const devotionStatLines: string[] = [];
        for (const devLine of parsed.devotionLines) {
          evaluateDevotionLine(
            devLine,
            jewelDevotion,
            `${jewelSrc} (${jewelDevotion} Devotion)`,
            devotionStatLines,
            addedMods,
          );
        }
        if (devotionStatLines.length > 0) {
          addedStatLines.push({
            source: `${jewelSrc} (${jewelDevotion} Devotion)`,
            lines: devotionStatLines,
          });
        }
      }
    } else if (parsed.jewelType === 'Heroic Tragedy') {
      if (officialSmalls && game === 'poe1') {
        let bonusWardInc = 0;
        for (const s of smalls) {
          bonusWardInc += isAttributeTravelSmallNode(s) ? 1 : 2;
        }
        if (bonusWardInc > 0) {
          addedStatLines.push({
            source: jewelSrc,
            lines: [`${bonusWardInc}% increased Ward`],
          });
        }
      }
      if (lutLookup?.lookupNode) {
        for (const node of [...smalls, ...notables]) {
          const hit = lutLookup.lookupNode(parsed.jewelType, parsed.seed, node.id);
          if (hit) {
            lutHits++;
            if (hit.mode === 'replace') suppressedNodeIds.add(node.id);
            lutLines.push(...hit.stats);
          }
        }
      }
    } else if (parsed.jewelType === 'Undying Hate') {
      // Official PoB 2 `Classes/PassiveSpec.lua:1779-1786` (`conqueredBy.conqueror.type == "abyss"`):
      // - Attribute travel small nodes keep their attribute and gain `+3 to Tribute`.
      // - Non-attribute small passives in radius are replaced (`abyss_small_tribute`: `+5 to Tribute`).
      let jewelTribute = 0;
      for (const s of smalls) {
        if (isAttributeTravelSmallNode(s)) {
          jewelTribute += 3;
        } else {
          suppressedNodeIds.add(s.id);
          jewelTribute += 5;
        }
      }
      if (jewelTribute > 0) {
        addedMods.push(mkMod('Tribute', 'BASE', jewelTribute, jewelSrc));
      }
      if (lutLookup?.lookupNode) {
        for (const node of [...smalls, ...notables]) {
          const hit = lutLookup.lookupNode(parsed.jewelType, parsed.seed, node.id);
          if (hit) {
            lutHits++;
            if (hit.mode === 'replace') suppressedNodeIds.add(node.id);
            lutLines.push(...hit.stats);
          }
        }
      }
    }

    if (lutLines.length > 0) {
      addedStatLines.push({
        source: `${jewelSrc} [LUT]`,
        lines: lutLines,
      });
    }

    details.push({
      nodeId,
      jewelName: jewel.name,
      jewelType: parsed.jewelType,
      seed: parsed.seed,
      conqueror: parsed.conqueror,
      keystoneName: parsed.keystoneName,
      radiusLabel: parsed.radiusLabel,
      radiusPx,
      nodesInRadius: inRadius.length,
      smallsInRadius: smalls.length,
      notablesInRadius: notables.length,
      keystonesReplaced,
      devotion: jewelDevotion,
      lutHits,
    });
  }

  return {
    addedStatLines,
    addedMods,
    suppressedNodeIds,
    supremeOstentation,
    lifeGainAsEsPct,
    noStrLifeBonus,
    ...(noDexAccuracyBonus ? { noDexAccuracyBonus: true } : {}),
    ...(noIntManaBonus ? { noIntManaBonus: true } : {}),
    powerOfPurpose,
    totalDevotion,
    replacedKeystones,
    details,
  };
}

// ============================================================================
// 2. Tattoo & Runegraft Evaluator (Warrior's Tale, Journey Tattoos, Runegrafts)
// ============================================================================

const KNOWN_KARUI_TRIBES: readonly string[] = [
  'Ramako',
  'Hinekora',
  'Tasalio',
  'Tukohama',
  'Valako',
  'Arohongui',
  'Rongokurai',
  'Ngamahu',
  'Kitava',
  'Makanui',
  'Maata',
  'Tuahu',
];

export interface TattooTribeCounts {
  totalTattoos: number;
  byTribe: Record<string, number>;
  runegraftCount: number;
}

export interface TattooAndRunegraftResult {
  /** Synthetic stat lines (Warrior's Tale delta copies & expanded Journey Tattoo lines). */
  addedStatLines: Array<{ source: string; lines: string[] }>;
  /** Direct Mod objects for translated Runegraft / Tattoo modifiers. */
  addedMods: Mod[];
  /** Total `+N to Level of all non-Exceptional Support Gems` from Runegraft of Gemcraft. */
  nonExceptionalSupportLevelBonus: number;
  /** Allocated Tattoo counts (total and by tribe) + Runegraft count. */
  counts: TattooTribeCounts;
  /** Allocated Tattoo node IDs boosted by Warrior's Tale. */
  warriorsTaleAffectedNodeIds: Set<number>;
}

export interface EvaluateTattoosAndRunegraftsOptions {
  /** Pre-resolved active socketed jewels (if omitted, resolves from `build.tree.socketedJewels`). */
  socketedJewels?: ReadonlyArray<{ nodeId: number; jewel: Item }>;
  /**
   * When true, skips emitting Runegraft `addedMods` for lines that `parseModLines`
   * already covers natively (e.g. `40% increased Global Defences`, `15% increased Mana Reservation Efficiency`),
   * preventing double-counting if the caller already ran `parseModLines` on `nodeOverrides`.
   * Defaults to `false`.
   */
  skipNativelyParsedRunegraftStats?: boolean;
}

function isRunegraftOverride(override: { name?: string; stats: string[] }): boolean {
  return /\brunegraft\b/i.test(override.name ?? '');
}

function isTattooOverride(override: { name?: string; stats: string[] }): boolean {
  if (isRunegraftOverride(override)) return false;
  return /\btattoo\b/i.test(override.name ?? '');
}

function extractTattooTribe(name?: string): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const tribe of KNOWN_KARUI_TRIBES) {
    if (new RegExp(`\\b${tribe.toLowerCase()}\\b`).test(lower)) {
      return tribe;
    }
  }
  return null;
}

function isPerAllocatedTattooLine(line: string): boolean {
  return /\bper\s+Allocated\s+(?:(?:[A-Za-z]+\s+)?Tattoo|Journey\s+Tattoo\s+of\s+.+)$/i.test(line);
}

/**
 * Evaluates PoE 1 Tattoos (`Warrior's Tale` radius doubling, tribe counts & Journey Tattoos)
 * and Runegrafts (`Runegraft of the Fortress`, `Runegraft of Treachery`, `Runegraft of Gemcraft`,
 * plus any Global Defences / Reservation Efficiency lines inside `nodeOverrides`).
 */
export function evaluateTattoosAndRunegrafts(
  build: Build,
  tree: PassiveTreeData,
  activeTreeNodes: Set<number>,
  options?: EvaluateTattoosAndRunegraftsOptions,
): TattooAndRunegraftResult {
  const addedStatLines: Array<{ source: string; lines: string[] }> = [];
  const addedMods: Mod[] = [];
  const warriorsTaleAffectedNodeIds = new Set<number>();
  const byTribe: Record<string, number> = {};
  let totalTattoos = 0;
  let runegraftCount = 0;
  let nonExceptionalSupportLevelBonus = 0;

  const nodeOverrides = build.tree.nodeOverrides ?? {};
  const skipNative = Boolean(options?.skipNativelyParsedRunegraftStats);

  // 1. Count all allocated Tattoos by Karui tribe and Runegrafts
  for (const nodeId of activeTreeNodes) {
    const override = nodeOverrides[nodeId];
    if (!override) continue;
    if (isRunegraftOverride(override)) {
      runegraftCount++;
      continue;
    }
    if (isTattooOverride(override)) {
      totalTattoos++;
      const tribe = extractTattooTribe(override.name);
      if (tribe) {
        byTribe[tribe] = (byTribe[tribe] ?? 0) + 1;
      }
    }
  }

  // 2. Detect Warrior's Tale Crimson Jewel(s) & compute per-node Tattoo effect boost %
  const socketedJewels =
    options?.socketedJewels ?? resolveActiveSocketedJewels(build, tree, activeTreeNodes);

  const warriorsTaleBoostPctByNode = new Map<number, { pct: number; jewelNodeId: number }>();

  for (const { nodeId: jewelNodeId, jewel } of socketedJewels) {
    const socketNode = tree.nodes[jewelNodeId];
    if (!socketNode) continue;

    const cleanLines = [...jewel.implicits, ...jewel.explicits].map(stripPobTags);
    let tattooEffectPct = 0;
    for (const line of cleanLines) {
      const m = line.match(
        /^(\d+)% increased effect of Tattoo(?: Passive Skill)?s in Radius$/i,
      );
      if (m) {
        tattooEffectPct += Number(m[1]);
      }
    }
    if (tattooEffectPct === 0 && jewel.name.trim().toLowerCase() === "warrior's tale") {
      tattooEffectPct = 100;
    }
    if (tattooEffectPct <= 0) continue;

    const radiusLabel = resolveRadiusLabelFromItem(jewel, 'Medium');
    const radiusPx = getJewelRadiusPx(radiusLabel, tree.game, tree.version);
    const inRadius = getAllocatedNodesInRadius(
      socketNode,
      tree,
      activeTreeNodes,
      radiusPx,
      true,
    );

    for (const node of inRadius) {
      const override = nodeOverrides[node.id];
      if (!override || !isTattooOverride(override)) continue;
      const prev = warriorsTaleBoostPctByNode.get(node.id);
      warriorsTaleBoostPctByNode.set(node.id, {
        pct: (prev?.pct ?? 0) + tattooEffectPct,
        jewelNodeId,
      });
      warriorsTaleAffectedNodeIds.add(node.id);
    }
  }

  // Emit 1x (or N%) delta copies for Warrior's Tale affected Tattoo nodes
  for (const [nodeId, { pct, jewelNodeId }] of warriorsTaleBoostPctByNode.entries()) {
    const override = nodeOverrides[nodeId];
    if (!override) continue;
    const mult = 1 + pct / 100;
    const deltaLines: string[] = [];
    for (const rawLine of override.stats) {
      const clean = stripPobTags(rawLine);
      if (!clean || isPerAllocatedTattooLine(clean)) continue;
      const delta = scaleStatLineDelta(clean, mult);
      if (delta) deltaLines.push(delta);
    }
    if (deltaLines.length > 0) {
      addedStatLines.push({
        source: `Warrior's Tale (${jewelNodeId}): ${override.name ?? `Tattoo ${nodeId}`}`,
        lines: deltaLines,
      });
    }
  }

  // 3. Journey Tattoos (`per Allocated Journey Tattoo of <Name>` / `per Allocated <Tribe> Tattoo` / `per Allocated Tattoo`)
  //    & Runegrafts (`Runegraft of the Fortress`, `Treachery`, `Gemcraft`, etc.)
  const byJourneyName: Record<string, number> = {};
  for (const nodeId of activeTreeNodes) {
    const ov = nodeOverrides[nodeId];
    if (!ov?.name) continue;
    const normName = ov.name.trim().toLowerCase();
    if (normName.startsWith('journey tattoo of ')) {
      byJourneyName[normName] = (byJourneyName[normName] ?? 0) + 1;
    }
  }

  for (const nodeId of activeTreeNodes) {
    const override = nodeOverrides[nodeId];
    if (!override) continue;
    const src = `Override (${nodeId}): ${override.name ?? `Node ${nodeId}`}`;
    const isRunegraft = isRunegraftOverride(override);

    for (const rawLine of override.stats) {
      const line = stripPobTags(rawLine);
      if (!line) continue;

      // 3a. Journey Tattoo `per Allocated Journey Tattoo of <X>` and `per Allocated (<Tribe> )?Tattoo` lines
      const mNamedJourney = line.match(
        /^(.+?)\s+per\s+Allocated\s+(Journey\s+Tattoo\s+of\s+.+)$/i,
      );
      if (mNamedJourney) {
        const baseClause = mNamedJourney[1]!.trim();
        const targetName = mNamedJourney[2]!.trim();
        const count = byJourneyName[targetName.toLowerCase()] ?? 0;
        if (count > 0) {
          const wtBoostPct = warriorsTaleBoostPctByNode.get(nodeId)?.pct ?? 0;
          const totalScale = count * (1 + wtBoostPct / 100);
          const expanded = scaleStatLineNumeric(baseClause, totalScale);
          addedStatLines.push({
            source: `${src} (${count} ${targetName})`,
            lines: [expanded],
          });
        }
        continue;
      }

      const mJourney = line.match(
        /^(.+?)\s+per\s+Allocated\s+(?:([A-Za-z]+)\s+)?Tattoo$/i,
      );
      if (mJourney) {
        const baseClause = mJourney[1]!.trim();
        const rawTribe = mJourney[2]?.trim();
        const canonicalTribe = rawTribe ? canonicalCapitalize(rawTribe) : null;
        const count = canonicalTribe
          ? (byTribe[canonicalTribe] ?? 0)
          : totalTattoos;
        if (count > 0) {
          const wtBoostPct = warriorsTaleBoostPctByNode.get(nodeId)?.pct ?? 0;
          const totalScale = count * (1 + wtBoostPct / 100);
          const expanded = scaleStatLineNumeric(baseClause, totalScale);
          addedStatLines.push({
            source: `${src} (${count} ${canonicalTribe ?? 'Total'} Tattoos)`,
            lines: [expanded],
          });
        }
        continue;
      }

      // 3b. Runegraft of Gemcraft: `+N to Level of all non-Exceptional Support Gems`
      const mGemcraft = line.match(
        /^\+(\d+) to Level of all non-Exceptional Support Gems?$/i,
      );
      if (mGemcraft) {
        const bonus = Number(mGemcraft[1]);
        nonExceptionalSupportLevelBonus += bonus;
        addedMods.push(mkMod('GemLevelSup:non-exceptional', 'BASE', bonus, src));
        continue;
      }

      // 3c. Runegraft of the Fortress downside / attribute scaling: `10% reduced Attributes` / `X% increased Attributes`
      const mAttrPct = line.match(
        /^(\d+)% (increased|reduced) (?:all )?Attributes$/i,
      );
      if (mAttrPct) {
        const val =
          mAttrPct[2]!.toLowerCase() === 'reduced'
            ? -Number(mAttrPct[1])
            : Number(mAttrPct[1]);
        const alreadyNative = skipNative && parseModLines([line], src).length > 0;
        if (!alreadyNative) {
          addedMods.push(
            mkMod('Str', 'INC', val, src),
            mkMod('Dex', 'INC', val, src),
            mkMod('Int', 'INC', val, src),
          );
        }
        continue;
      }

      // 3d. Global Defences inside Runegraft / nodeOverrides
      //     (e.g. Runegraft of the Fortress `40% increased Global Defences` or `40% increased Defences`)
      const mGlobalDef = line.match(
        /^(\d+)% (increased|reduced) (?:Global )?Defences$/i,
      );
      if (mGlobalDef) {
        const alreadyNative = skipNative && parseModLines([line], src).length > 0;
        if (!alreadyNative) {
          const val =
            mGlobalDef[2]!.toLowerCase() === 'reduced'
              ? -Number(mGlobalDef[1])
              : Number(mGlobalDef[1]);
          addedMods.push(
            mkMod('Armour', 'INC', val, src),
            mkMod('Evasion', 'INC', val, src),
            mkMod('EnergyShield', 'INC', val, src),
            mkMod('Ward', 'INC', val, src),
          );
        }
        continue;
      }

      // 3e. Mana / Life / Spirit / Generic Reservation Efficiency inside Runegraft / nodeOverrides
      //     (e.g. Runegraft of Treachery `15% increased Mana Reservation Efficiency of Skills`)
      const mResEff = line.match(
        /^(\d+)% (increased|reduced) (Mana |Life |Spirit )?Reservation Efficiency(?: of Skills)?$/i,
      );
      if (mResEff) {
        const alreadyNative = skipNative && parseModLines([line], src).length > 0;
        if (!alreadyNative) {
          const val =
            mResEff[2]!.toLowerCase() === 'reduced'
              ? -Number(mResEff[1])
              : Number(mResEff[1]);
          const scope = (mResEff[3] ?? '').trim().toLowerCase();
          const statName =
            scope === 'life'
              ? 'LifeReservationEfficiency'
              : scope === 'spirit'
                ? 'SpiritReservationEfficiency'
                : scope === 'mana'
                  ? 'ManaReservationEfficiency'
                  : 'ReservationEfficiency';
          addedMods.push(mkMod(statName, 'INC', val, src));
        }
        continue;
      }

      // 3f. Other Runegraft-specific lines not parsed by parseModLines (if any)
      if (isRunegraft) {
        // Runegraft of the Warp: "Buffs on you expire 30% slower", "Debuffs on you expire 30% faster"
        const mBuffExpire = line.match(/^Buffs on you expire (\d+)% slower$/i);
        if (mBuffExpire) {
          addedMods.push(mkMod('BuffExpireRate', 'INC', -Number(mBuffExpire[1]), src));
          continue;
        }
        // Runegraft of the Sinistral: "10% more Attack speed with Offhand" (PoB 1 Speed MORE 10, ModFlag.Attack)
        const mOffhandSpeed = line.match(/^(\d+)% more Attack speed with Offhand$/i);
        if (mOffhandSpeed) {
          const alreadyNative = skipNative && parseModLines([line], src).length > 0;
          if (!alreadyNative) {
            addedMods.push(mkMod('Speed', 'MORE', Number(mOffhandSpeed[1]), src, ModFlag.Attack));
          }
          continue;
        }
      }
    }
  }

  return {
    addedStatLines,
    addedMods,
    nonExceptionalSupportLevelBonus,
    counts: {
      totalTattoos,
      byTribe,
      runegraftCount,
    },
    warriorsTaleAffectedNodeIds,
  };
}

// ============================================================================
// 3. PoE 2 Unbaked `Rune:` & `Soul Core` Resolver
// ============================================================================

export type Poe2RuneSlotCategory = 'weapon' | 'caster' | 'sceptre' | 'armour';

export interface Poe2RuneEntry {
  stats: string[];
  /** True when the rune grants local armour defences or local weapon physical damage already baked into PoB2 headers. */
  isLocalDefenceOrPhys?: boolean;
}

export interface Poe2RuneDef {
  name: string;
  isSoulCore?: boolean;
  armour?: Poe2RuneEntry;
  weapon?: Poe2RuneEntry;
  caster?: Poe2RuneEntry;
  sceptre?: Poe2RuneEntry;
}

export interface Poe2RunesLookup {
  lookupRune?(runeName: string): Poe2RuneDef | null;
}

export interface Poe2UnbakedRuneItemDetail {
  slot: string;
  itemName: string;
  slotCategory: Poe2RuneSlotCategory;
  runesFound: string[];
  appliedRunes: string[];
  skippedRunes: Array<{ name: string; reason: string }>;
  skippedEntireItemReason?: string;
}

export interface Poe2UnbakedRunesResult {
  /** Synthetic stat lines from unbaked PoE 2 runes & soul cores (ready for `parseModLines`). */
  addedStatLines: Array<{ source: string; lines: string[] }>;
  /** Direct `Mod` objects for rune/soul core stats that `parseModLines` does not cover natively. */
  addedMods: Mod[];
  /** Per-item diagnostics for debugging & verification. */
  details: Poe2UnbakedRuneItemDetail[];
}

export interface EvaluatePoe2UnbakedRunesOptions {
  /** Optional external lookup to override or extend `POE2_RUNE_CATALOG`. */
  runesLookup?: Poe2RunesLookup;
  /** Optional full `poe2-runes.json` dataset (`305` Runes, Soul Cores, Idols, Abyssal Eyes). */
  datasetRunes?: import('@webpob/core').Poe2RunesDataset | null;
  /** Whether Shaman Bonded modifiers are unlocked globally. */
  allowBonded?: boolean;
}

/**
 * Built-in canonical PoE 2 Rune (Lesser / Standard / Greater / Perfect) and Soul Core catalog.
 */
export const POE2_RUNE_CATALOG: Readonly<Record<string, Poe2RuneDef>> = {
  // --- Elemental Resistance / Elemental Damage Runes ---
  'lesser desert rune': {
    name: 'Lesser Desert Rune',
    armour: { stats: ['+10% to Fire Resistance'] },
    weapon: { stats: ['Adds 4 to 7 Fire Damage to Attacks'] },
  },
  'desert rune': {
    name: 'Desert Rune',
    armour: { stats: ['+12% to Fire Resistance'] },
    weapon: { stats: ['Adds 7 to 11 Fire Damage to Attacks'] },
  },
  'greater desert rune': {
    name: 'Greater Desert Rune',
    armour: { stats: ['+14% to Fire Resistance'] },
    weapon: { stats: ['Adds 11 to 18 Fire Damage to Attacks'] },
  },

  'lesser glacial rune': {
    name: 'Lesser Glacial Rune',
    armour: { stats: ['+10% to Cold Resistance'] },
    weapon: { stats: ['Adds 3 to 6 Cold Damage to Attacks'] },
  },
  'glacial rune': {
    name: 'Glacial Rune',
    armour: { stats: ['+12% to Cold Resistance'] },
    weapon: { stats: ['Adds 6 to 10 Cold Damage to Attacks'] },
  },
  'greater glacial rune': {
    name: 'Greater Glacial Rune',
    armour: { stats: ['+14% to Cold Resistance'] },
    weapon: { stats: ['Adds 10 to 16 Cold Damage to Attacks'] },
  },

  'lesser storm rune': {
    name: 'Lesser Storm Rune',
    armour: { stats: ['+10% to Lightning Resistance'] },
    weapon: { stats: ['Adds 1 to 13 Lightning Damage to Attacks'] },
  },
  'storm rune': {
    name: 'Storm Rune',
    armour: { stats: ['+12% to Lightning Resistance'] },
    weapon: { stats: ['Adds 1 to 20 Lightning Damage to Attacks'] },
  },
  'greater storm rune': {
    name: 'Greater Storm Rune',
    armour: { stats: ['+14% to Lightning Resistance'] },
    weapon: { stats: ['Adds 1 to 32 Lightning Damage to Attacks'] },
  },

  // --- Local Defence / Local Physical Runes (skipped when item headers already reflect local stats) ---
  'lesser iron rune': {
    name: 'Lesser Iron Rune',
    armour: {
      stats: ['16% increased Armour, Evasion and Energy Shield'],
      isLocalDefenceOrPhys: true,
    },
    weapon: {
      stats: ['16% increased Physical Damage'],
      isLocalDefenceOrPhys: true,
    },
  },
  'iron rune': {
    name: 'Iron Rune',
    armour: {
      stats: ['20% increased Armour, Evasion and Energy Shield'],
      isLocalDefenceOrPhys: true,
    },
    weapon: {
      stats: ['20% increased Physical Damage'],
      isLocalDefenceOrPhys: true,
    },
  },
  'greater iron rune': {
    name: 'Greater Iron Rune',
    armour: {
      stats: ['25% increased Armour, Evasion and Energy Shield'],
      isLocalDefenceOrPhys: true,
    },
    weapon: {
      stats: ['25% increased Physical Damage'],
      isLocalDefenceOrPhys: true,
    },
  },
  'perfect iron rune': {
    name: 'Perfect Iron Rune',
    armour: {
      stats: ['30% increased Armour, Evasion and Energy Shield'],
      isLocalDefenceOrPhys: true,
    },
    weapon: {
      stats: ['30% increased Physical Damage'],
      isLocalDefenceOrPhys: true,
    },
  },
  'lesser tempered rune': {
    name: 'Lesser Tempered Rune',
    weapon: {
      stats: ['Adds 2 to 4 Physical Damage'],
      isLocalDefenceOrPhys: true,
    },
  },
  'tempered rune': {
    name: 'Tempered Rune',
    weapon: {
      stats: ['Adds 4 to 7 Physical Damage'],
      isLocalDefenceOrPhys: true,
    },
  },
  'greater tempered rune': {
    name: 'Greater Tempered Rune',
    weapon: {
      stats: ['Adds 6 to 10 Physical Damage'],
      isLocalDefenceOrPhys: true,
    },
  },

  // --- Resource & Utility Runes ---
  'lesser body rune': {
    name: 'Lesser Body Rune',
    armour: { stats: ['+20 to maximum Life'] },
    weapon: { stats: ['2% of Physical Damage Leeched as Life'] },
  },
  'body rune': {
    name: 'Body Rune',
    armour: { stats: ['+25 to maximum Life'] },
    weapon: { stats: ['2.5% of Physical Damage Leeched as Life'] },
  },
  'greater body rune': {
    name: 'Greater Body Rune',
    armour: { stats: ['+30 to maximum Life'] },
    weapon: { stats: ['3% of Physical Damage Leeched as Life'] },
  },
  'perfect body rune': {
    name: 'Perfect Body Rune',
    armour: { stats: ['+40 to maximum Life'] },
    weapon: { stats: ['3.5% of Physical Damage Leeched as Life'] },
  },

  'lesser mind rune': {
    name: 'Lesser Mind Rune',
    armour: { stats: ['+20 to maximum Mana'] },
    weapon: { stats: ['1.5% of Physical Damage Leeched as Mana'] },
  },
  'mind rune': {
    name: 'Mind Rune',
    armour: { stats: ['+25 to maximum Mana'] },
    weapon: { stats: ['2% of Physical Damage Leeched as Mana'] },
  },
  'greater mind rune': {
    name: 'Greater Mind Rune',
    armour: { stats: ['+30 to maximum Mana'] },
    weapon: { stats: ['2.5% of Physical Damage Leeched as Mana'] },
  },
  'perfect mind rune': {
    name: 'Perfect Mind Rune',
    armour: { stats: ['+40 to maximum Mana'] },
    weapon: { stats: ['3% of Physical Damage Leeched as Mana'] },
  },

  'lesser rebirth rune': {
    name: 'Lesser Rebirth Rune',
    armour: { stats: ['Regenerate 0.25% of Life per second'] },
    weapon: { stats: ['Gain 15 Life per Enemy Killed'] },
  },
  'rebirth rune': {
    name: 'Rebirth Rune',
    armour: { stats: ['Regenerate 0.3% of Life per second'] },
    weapon: { stats: ['Gain 20 Life per Enemy Killed'] },
  },
  'greater rebirth rune': {
    name: 'Greater Rebirth Rune',
    armour: { stats: ['Regenerate 0.4% of Life per second'] },
    weapon: { stats: ['Gain 25 Life per Enemy Killed'] },
  },

  'lesser inspiration rune': {
    name: 'Lesser Inspiration Rune',
    armour: { stats: ['12% increased Energy Shield Recharge Rate'] },
    weapon: { stats: ['Gain 12 Mana per Enemy Killed'] },
  },
  'inspiration rune': {
    name: 'Inspiration Rune',
    armour: { stats: ['15% increased Energy Shield Recharge Rate'] },
    weapon: { stats: ['Gain 15 Mana per Enemy Killed'] },
  },
  'greater inspiration rune': {
    name: 'Greater Inspiration Rune',
    armour: { stats: ['18% increased Energy Shield Recharge Rate'] },
    weapon: { stats: ['Gain 20 Mana per Enemy Killed'] },
  },

  'lesser stone rune': {
    name: 'Lesser Stone Rune',
    armour: { stats: ['+30 to Stun Threshold'] },
    weapon: { stats: ['20% increased Stun Buildup'] },
  },
  'stone rune': {
    name: 'Stone Rune',
    armour: { stats: ['+40 to Stun Threshold'] },
    weapon: { stats: ['25% increased Stun Buildup'] },
  },
  'greater stone rune': {
    name: 'Greater Stone Rune',
    armour: { stats: ['+50 to Stun Threshold'] },
    weapon: { stats: ['30% increased Stun Buildup'] },
  },

  'lesser vision rune': {
    name: 'Lesser Vision Rune',
    armour: { stats: ['8% increased Life and Mana Recovery from Flasks'] },
    weapon: { stats: ['+80 to Accuracy Rating'] },
  },
  'vision rune': {
    name: 'Vision Rune',
    armour: { stats: ['10% increased Life and Mana Recovery from Flasks'] },
    weapon: { stats: ['+100 to Accuracy Rating'] },
  },
  'greater vision rune': {
    name: 'Greater Vision Rune',
    armour: { stats: ['12% increased Life and Mana Recovery from Flasks'] },
    weapon: { stats: ['+120 to Accuracy Rating'] },
  },

  // --- Attribute Runes ---
  'lesser robust rune': {
    name: 'Lesser Robust Rune',
    armour: { stats: ['+6 to Strength'] },
    weapon: { stats: ['+6 to Strength'] },
    caster: { stats: ['+6 to Strength'] },
    sceptre: { stats: ['+6 to Strength'] },
  },
  'robust rune': {
    name: 'Robust Rune',
    armour: { stats: ['+8 to Strength'] },
    weapon: { stats: ['+8 to Strength'] },
    caster: { stats: ['+8 to Strength'] },
    sceptre: { stats: ['+8 to Strength'] },
  },
  'greater robust rune': {
    name: 'Greater Robust Rune',
    armour: { stats: ['+10 to Strength'] },
    weapon: { stats: ['+10 to Strength'] },
    caster: { stats: ['+10 to Strength'] },
    sceptre: { stats: ['+10 to Strength'] },
  },

  'lesser adept rune': {
    name: 'Lesser Adept Rune',
    armour: { stats: ['+6 to Dexterity'] },
    weapon: { stats: ['+6 to Dexterity'] },
    caster: { stats: ['+6 to Dexterity'] },
    sceptre: { stats: ['+6 to Dexterity'] },
  },
  'adept rune': {
    name: 'Adept Rune',
    armour: { stats: ['+8 to Dexterity'] },
    weapon: { stats: ['+8 to Dexterity'] },
    caster: { stats: ['+8 to Dexterity'] },
    sceptre: { stats: ['+8 to Dexterity'] },
  },
  'greater adept rune': {
    name: 'Greater Adept Rune',
    armour: { stats: ['+10 to Dexterity'] },
    weapon: { stats: ['+10 to Dexterity'] },
    caster: { stats: ['+10 to Dexterity'] },
    sceptre: { stats: ['+10 to Dexterity'] },
  },

  'lesser resolve rune': {
    name: 'Lesser Resolve Rune',
    armour: { stats: ['+6 to Intelligence'] },
    weapon: { stats: ['+6 to Intelligence'] },
    caster: { stats: ['+6 to Intelligence'] },
    sceptre: { stats: ['+6 to Intelligence'] },
  },
  'resolve rune': {
    name: 'Resolve Rune',
    armour: { stats: ['+8 to Intelligence'] },
    weapon: { stats: ['+8 to Intelligence'] },
    caster: { stats: ['+8 to Intelligence'] },
    sceptre: { stats: ['+8 to Intelligence'] },
  },
  'greater resolve rune': {
    name: 'Greater Resolve Rune',
    armour: { stats: ['+10 to Intelligence'] },
    weapon: { stats: ['+10 to Intelligence'] },
    caster: { stats: ['+10 to Intelligence'] },
    sceptre: { stats: ['+10 to Intelligence'] },
  },

  // --- All 15 PoE 2 Soul Cores ---
  'soul core of tacati': {
    name: 'Soul Core of Tacati',
    isSoulCore: true,
    armour: { stats: ['+7% to Chaos Resistance'] },
    weapon: { stats: ['15% chance to Poison on Hit'] },
  },
  'soul core of citaqualotl': {
    name: 'Soul Core of Citaqualotl',
    isSoulCore: true,
    armour: { stats: ['+5% to all Elemental Resistances'] },
    weapon: { stats: ['30% increased Elemental Damage with Attacks'] },
  },
  'soul core of jiquani': {
    name: 'Soul Core of Jiquani',
    isSoulCore: true,
    armour: { stats: ['2% increased maximum Life'] },
    weapon: { stats: ['Recover 2% of Life on Kill'] },
  },
  'soul core of zalatl': {
    name: 'Soul Core of Zalatl',
    isSoulCore: true,
    armour: { stats: ['2% increased maximum Mana'] },
    weapon: { stats: ['Recover 2% of Mana on Kill'] },
  },
  'soul core of azcapa': {
    name: 'Soul Core of Azcapa',
    isSoulCore: true,
    armour: { stats: ['10% increased Rarity of Items found'] },
    weapon: { stats: ['+15 to Spirit'] },
    caster: { stats: ['+15 to Spirit'] },
    sceptre: { stats: ['+15 to Spirit'] },
  },
  'soul core of topotante': {
    name: 'Soul Core of Topotante',
    isSoulCore: true,
    armour: { stats: ['15% increased Elemental Ailment Threshold'] },
    weapon: { stats: ['Attacks with this Weapon Penetrate 15% Elemental Resistances'] },
  },
  'soul core of quipolatl': {
    name: 'Soul Core of Quipolatl',
    isSoulCore: true,
    armour: { stats: ['10% reduced Slowing Potency of Debuffs on You'] },
    weapon: { stats: ['5% increased Attack Speed'] },
  },
  'soul core of ticaba': {
    name: 'Soul Core of Ticaba',
    isSoulCore: true,
    armour: { stats: ['Hits against you have 10% reduced Critical Damage Bonus'] },
    weapon: { stats: ['+12% to Critical Damage Bonus'] },
  },
  'soul core of atmohua': {
    name: 'Soul Core of Atmohua',
    isSoulCore: true,
    armour: { stats: ['Convert 20% of Requirements to Strength'] },
    weapon: { stats: ['Convert 20% of Requirements to Strength'] },
  },
  'soul core of cholotl': {
    name: 'Soul Core of Cholotl',
    isSoulCore: true,
    armour: { stats: ['Convert 20% of Requirements to Dexterity'] },
    weapon: { stats: ['Convert 20% of Requirements to Dexterity'] },
  },
  'soul core of zantipi': {
    name: 'Soul Core of Zantipi',
    isSoulCore: true,
    armour: { stats: ['Convert 20% of Requirements to Intelligence'] },
    weapon: { stats: ['Convert 20% of Requirements to Intelligence'] },
  },
  'soul core of opiloti': {
    name: 'Soul Core of Opiloti',
    isSoulCore: true,
    armour: { stats: ['10% increased Charm Charges gained'] },
    weapon: { stats: ['15% chance to cause Bleeding on Hit'] },
  },
  'soul core of puhuarte': {
    name: 'Soul Core of Puhuarte',
    isSoulCore: true,
    armour: { stats: ['+1% to maximum Fire Resistance'] },
    weapon: { stats: ['30% increased chance to Ignite'] },
  },
  'soul core of tzamoto': {
    name: 'Soul Core of Tzamoto',
    isSoulCore: true,
    armour: { stats: ['+1% to maximum Cold Resistance'] },
    weapon: { stats: ['20% increased Freeze Buildup'] },
  },
  'soul core of xopec': {
    name: 'Soul Core of Xopec',
    isSoulCore: true,
    armour: { stats: ['+1% to maximum Lightning Resistance'] },
    weapon: { stats: ['30% increased chance to Shock'] },
  },
};

function normalizeRuneStatTemplate(raw: string): string {
  return stripPobTags(raw)
    .toLowerCase()
    .replace(/^(?:bonded|羁绊)\s*[:：]\s*/i, '')
    .replace(/[+-]?\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns true if the item already has baked `{rune}` / `(rune)` implicit lines OR untagged
 * PoE 2 `0.1`–`0.4` pre-baked rune implicits (`Bonded:` or matching stat templates),
 * meaning unbaked `Rune:` header synthesis MUST be skipped to prevent double-counting.
 */
export function hasBakedRuneImplicits(
  item: Item,
  slot?: EquipmentSlotId | string,
  datasetRunes?: import('@webpob/core').Poe2RunesDataset | null,
): boolean {
  if ((item as Item & { __poe2RunesRefreshed?: boolean }).__poe2RunesRefreshed) {
    return false;
  }
  for (const line of [...item.implicits, ...item.explicits]) {
    if (/\{rune\}|\(rune\)|（符文）|^\s*(?:Bonded|羁绊)\s*[:：]/i.test(line)) return true;
  }
  if (item.rawText && /\{rune\}|\(rune\)|（符文）/i.test(item.rawText)) {
    return true;
  }
  if (item.implicits.length === 0) return false;

  const runesFound = extractRawRuneNames(item);
  if (runesFound.length === 0) return false;
  if (item.implicits.length < runesFound.length && item.implicits.length <= 1) {
    return false;
  }

  const slotCategory = classifyPoe2RuneSlotCategory(slot ?? 'Body Armour', item);
  const dsMap = buildCaseInsensitiveRuneMap(datasetRunes);
  const candidateKeys = resolveDatasetRuneCandidateKeys(slot ?? 'Body Armour', item, slotCategory);
  const implicitTemplates = new Set(item.implicits.map(normalizeRuneStatTemplate));

  for (const rawRuneName of runesFound) {
    const lowerName = rawRuneName.trim().toLowerCase();
    const dsEntry = dsMap?.get(lowerName);
    if (dsEntry) {
      for (const k of candidateKeys) {
        const sub = dsEntry.slots[k];
        if (!sub) continue;
        for (const l of [...(sub.lines ?? []), ...(sub.bonded ?? [])]) {
          if (implicitTemplates.has(normalizeRuneStatTemplate(l))) {
            return true;
          }
        }
        break;
      }
    }
    const fb = POE2_RUNE_CATALOG[lowerName];
    const fbSub = fb?.[slotCategory];
    if (fbSub) {
      for (const l of fbSub.stats) {
        if (implicitTemplates.has(normalizeRuneStatTemplate(l))) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Extracts all `Rune: <name>` header entries from `item.rawText` or `(item as { runes?: string[] }).runes`.
 */
export function extractRawRuneNames(item: Item): string[] {
  const out: string[] = [];
  const itemWithRunes = item as Item & { runes?: string[] };
  if (Array.isArray(itemWithRunes.runes) && itemWithRunes.runes.length > 0) {
    for (const r of itemWithRunes.runes) {
      const trimmed = r.trim();
      if (trimmed && !/^none$/i.test(trimmed)) out.push(trimmed);
    }
    return out;
  }
  if (!item.rawText) return out;
  const re = /^\s*Rune\s*[:：]\s*(.+?)\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(item.rawText)) !== null) {
    const name = m[1]!.trim();
    if (name && !/^none$/i.test(name)) out.push(name);
  }
  return out;
}

function extractImpersonatedRuneSlotKey(item: Item): string | null {
  for (const raw of [...item.implicits, ...item.explicits]) {
    const line = stripPobTags(raw);
    const m = line.match(
      /gains bonuses from Socketed Items as though it (?:was|were) (?:a |an )?(Body Armour|Helmet|Gloves|Boots|Shield|Buckler|Focus|Wand|Staff|Sceptre|Bow|Crossbow|Quarterstaff|Spear|Talisman|Flail|One Hand Mace|Two Hand Mace|Martial Weapon|Weapon)\b/i,
    );
    if (m) {
      return m[1]!.trim().toLowerCase();
    }
  }
  return null;
}

/**
 * Classifies an equipped PoE 2 item into its Rune / Soul Core slot category.
 */
export function classifyPoe2RuneSlotCategory(
  slot: EquipmentSlotId | string,
  item: Item,
): Poe2RuneSlotCategory {
  const impersonated = extractImpersonatedRuneSlotKey(item);
  if (impersonated) {
    if (impersonated === 'sceptre') return 'sceptre';
    if (impersonated === 'wand' || impersonated === 'staff') return 'caster';
    if (
      impersonated === 'weapon' ||
      impersonated === 'martial weapon' ||
      impersonated === 'bow' ||
      impersonated === 'crossbow' ||
      impersonated === 'quarterstaff' ||
      impersonated === 'spear' ||
      impersonated === 'talisman' ||
      impersonated === 'flail' ||
      impersonated === 'one hand mace' ||
      impersonated === 'two hand mace'
    ) {
      return 'weapon';
    }
    return 'armour';
  }

  if (
    slot === 'Helmet' ||
    slot === 'Body Armour' ||
    slot === 'Gloves' ||
    slot === 'Boots'
  ) {
    return 'armour';
  }

  const base = item.baseName.trim();
  if (slot === 'Weapon 2' || slot === 'Weapon 2 Swap') {
    if (item.armourStats || /\b(?:shield|buckler|focus|quiver)\b/i.test(base)) {
      return 'armour';
    }
  }

  if (/\bsceptre\b/i.test(base)) {
    return 'sceptre';
  }

  const wt = item.weaponStats?.weaponType;
  if (
    wt === 'Wand' ||
    wt === 'Staff' ||
    /\b(?:wand|runic fork)\b/i.test(base) ||
    (/\bstaff\b|\bstaves\b/i.test(base) && !/quarterstaff/i.test(base)) ||
    ((slot === 'Weapon 1' || slot === 'Weapon 1 Swap') &&
      !item.weaponStats &&
      !item.armourStats &&
      !/\b(?:bow|crossbow|quarterstaff|mace|hammer|maul|club|spear|sword|axe|claw|dagger|flail|talisman)\b/i.test(
        base,
      ))
  ) {
    return 'caster';
  }

  if (
    item.weaponStats ||
    /\b(?:bow|crossbow|quarterstaff|mace|hammer|maul|club|spear|sword|axe|claw|dagger|flail)\b/i.test(
      base,
    )
  ) {
    return 'weapon';
  }

  if (
    item.armourStats ||
    /\b(?:helmet|circlet|crown|tiara|helm|mask|hood|cap|robe|garb|plate|regalia|vestment|vest|coat|tunic|brigandine|doublet|jacket|cuirass|mantle|raiment|gloves|gauntlets|mitts|bracers|wraps|boots|greaves|sandals|shoes|slippers|sabatons|leggings|shield|buckler|focus)\b/i.test(
      base,
    )
  ) {
    return 'armour';
  }

  if (slot === 'Weapon 1' || slot === 'Weapon 1 Swap') {
    return 'weapon';
  }
  return 'armour';
}

function getSocketedEffectMultipliers(item: Item): {
  runeMult: number;
  soulCoreMult: number;
} {
  let runePct = 0;
  let soulCorePct = 0;
  for (const raw of [...item.implicits, ...item.explicits]) {
    const line = stripPobTags(raw);
    let m = line.match(/^(\d+)% increased effect of Socketed Soul Cores$/i);
    if (m) {
      soulCorePct += Number(m[1]);
      continue;
    }
    m = line.match(/^(\d+)% increased effect of Socketed Runes$/i);
    if (m) {
      runePct += Number(m[1]);
      continue;
    }
    m = line.match(
      /^(\d+)% increased effect of Socketed (?:Runes and Soul Cores|Augment Items|Items)$/i,
    );
    if (m) {
      runePct += Number(m[1]);
      soulCorePct += Number(m[1]);
      continue;
    }
  }
  return {
    runeMult: 1 + runePct / 100,
    soulCoreMult: 1 + soulCorePct / 100,
  };
}

function translateUnparsedRuneStatLine(
  line: string,
  source: string,
): Mod[] | null {
  // Soul Core of Topotante: "Attacks with this Weapon Penetrate 15% Elemental Resistances"
  let m = line.match(
    /^Attacks with this Weapon Penetrate (\d+)% Elemental Resistances?$/i,
  );
  if (m) {
    const v = Number(m[1]);
    return [
      mkMod('FirePenetration', 'BASE', v, source, ModFlag.Attack),
      mkMod('ColdPenetration', 'BASE', v, source, ModFlag.Attack),
      mkMod('LightningPenetration', 'BASE', v, source, ModFlag.Attack),
    ];
  }

  // Soul Core of Citaqualotl on Weapon: "30% increased Elemental Damage with Attacks"
  m = line.match(/^(\d+)% increased Elemental Damage with Attacks$/i);
  if (m) {
    return [mkMod('ElementalDamage', 'INC', Number(m[1]), source, ModFlag.Attack)];
  }

  // Inspiration Rune on Armour: "15% increased Energy Shield Recharge Rate"
  m = line.match(/^(\d+)% increased Energy Shield Recharge Rate$/i);
  if (m) {
    return [mkMod('EnergyShieldRecharge', 'INC', Number(m[1]), source)];
  }

  // Stone Rune on Armour: "+40 to Stun Threshold"
  m = line.match(/^\+(\d+) to Stun Threshold$/i);
  if (m) {
    return [mkMod('StunThreshold', 'BASE', Number(m[1]), source)];
  }

  // Soul Core of Azcapa on Armour: "10% increased Rarity of Items found"
  m = line.match(/^(\d+)% increased Rarity of Items found$/i);
  if (m) {
    return [mkMod('LootRarity', 'INC', Number(m[1]), source)];
  }

  return null;
}

interface DatasetRuneSubEntry {
  type?: string;
  localMod?: boolean;
  isLocalBaked?: boolean;
  lines?: string[];
  bonded?: string[];
}

function resolveDatasetRuneCandidateKeys(
  slot: EquipmentSlotId | string,
  item: Item,
  slotCategory: Poe2RuneSlotCategory,
): string[] {
  const keys: string[] = [];
  const baseLower = item.baseName.trim().toLowerCase();
  const wt = item.weaponStats?.weaponType;
  const twoHanded = Boolean(item.weaponStats?.twoHanded);

  const impersonated = extractImpersonatedRuneSlotKey(item);
  if (impersonated) {
    if (impersonated === 'martial weapon') {
      keys.push('weapon', 'martial weapon wand or staff');
    } else if (impersonated === 'buckler') {
      keys.push('buckler', 'shield');
    } else if (impersonated === 'wand' || impersonated === 'staff') {
      keys.push(impersonated, 'caster', 'martial weapon wand or staff');
    } else if (impersonated === 'sceptre') {
      keys.push('sceptre', 'caster');
    } else {
      keys.push(impersonated);
    }
  }

  if (slot === 'Helmet') {
    if (!keys.includes('helmet')) keys.push('helmet');
  }
  else if (slot === 'Body Armour') keys.push('body armour');
  else if (slot === 'Gloves') keys.push('gloves');
  else if (slot === 'Boots') keys.push('boots');
  else if (slot === 'Weapon 2' || slot === 'Weapon 2 Swap') {
    if (/\bfocus\b/.test(baseLower)) keys.push('focus');
    else if (/\bbuckler\b/.test(baseLower)) keys.push('buckler', 'shield');
    else if (item.armourStats || /\bshield\b/.test(baseLower)) keys.push('shield');
  }

  if (/\bsceptre\b/.test(baseLower) || slotCategory === 'sceptre') {
    keys.push('sceptre', 'caster');
  } else if (wt === 'Wand' || /\b(?:wand|runic fork)\b/.test(baseLower)) {
    keys.push('wand', 'caster', 'martial weapon wand or staff');
  } else if (
    (wt === 'Staff' || /\bstaff\b|\bstaves\b/.test(baseLower)) &&
    !/quarterstaff/.test(baseLower)
  ) {
    keys.push('staff', 'caster', 'martial weapon wand or staff');
  } else if (wt === 'Quarterstaff' || /quarterstaff|warstaff/.test(baseLower)) {
    keys.push('quarterstaff', 'weapon', 'martial weapon wand or staff');
  } else if (wt === 'Bow' || /\bbow\b/.test(baseLower)) {
    keys.push('bow', 'weapon', 'martial weapon wand or staff');
  } else if (wt === 'Crossbow' || /crossbow/.test(baseLower)) {
    keys.push('crossbow', 'weapon', 'martial weapon wand or staff');
  } else if (/\bspear\b/.test(baseLower)) {
    keys.push('spear', 'weapon', 'martial weapon wand or staff');
  } else if (/\btalisman\b/.test(baseLower)) {
    keys.push('talisman', 'weapon', 'martial weapon wand or staff');
  } else if (/\bflail\b/.test(baseLower)) {
    keys.push('flail', 'weapon', 'martial weapon wand or staff');
  } else if (wt === 'Mace' || /\bmace\b|\bhammer\b|\bmaul\b|\bclub\b/.test(baseLower)) {
    keys.push(twoHanded ? 'two hand mace' : 'one hand mace', 'weapon', 'martial weapon wand or staff');
  } else if (slotCategory === 'caster') {
    keys.push('wand', 'caster', 'staff', 'martial weapon wand or staff', 'weapon');
  } else if (slotCategory === 'weapon') {
    keys.push('weapon', 'martial weapon wand or staff');
  }

  if (!keys.includes(slotCategory)) {
    keys.push(slotCategory);
  }
  if (slotCategory === 'armour' && !keys.includes('armour')) {
    keys.push('armour');
  }
  return keys;
}

function buildCaseInsensitiveRuneMap(
  dataset: import('@webpob/core').Poe2RunesDataset | null | undefined,
): Map<string, { canonicalName: string; slots: Record<string, DatasetRuneSubEntry> }> | null {
  if (!dataset || typeof dataset !== 'object' || !dataset.runes || typeof dataset.runes !== 'object') {
    return null;
  }
  const map = new Map<string, { canonicalName: string; slots: Record<string, DatasetRuneSubEntry> }>();
  for (const [name, val] of Object.entries(dataset.runes)) {
    if (val && typeof val === 'object') {
      map.set(name.trim().toLowerCase(), {
        canonicalName: name,
        slots: val as Record<string, DatasetRuneSubEntry>,
      });
    }
  }
  return map;
}

/**
 * Resolves ONLY local-baked rune stat lines (`16% increased Armour, Evasion and Energy Shield`,
 * `18% increased Physical Damage`, `Adds 13 to 16 Fire Damage`, etc.) for a PoE 2 item whose
 * local stats have NOT been precomputed in headers (`!item.localStatsPrecomputed`), so
 * `resolveItemEffectiveStats` includes socketed Iron/Tempered/Elemental Runes in local weapon & armour calculations.
 */
export function resolvePoe2ItemLocalRuneLines(
  slot: EquipmentSlotId | string,
  item: Item,
  datasetRunes?: import('@webpob/core').Poe2RunesDataset | null,
): string[] {
  if (item.localStatsPrecomputed || hasBakedRuneImplicits(item, slot, datasetRunes)) return [];
  const runesFound = extractRawRuneNames(item);
  if (runesFound.length === 0) return [];

  const slotCategory = classifyPoe2RuneSlotCategory(slot, item);
  const { runeMult, soulCoreMult } = getSocketedEffectMultipliers(item);
  const dsMap = buildCaseInsensitiveRuneMap(datasetRunes);
  const candidateKeys = resolveDatasetRuneCandidateKeys(slot, item, slotCategory);
  const out: string[] = [];

  for (const rawRuneName of runesFound) {
    const lowerName = rawRuneName.trim().toLowerCase();
    const dsEntry = dsMap?.get(lowerName);
    if (dsEntry) {
      let sub: DatasetRuneSubEntry | undefined;
      for (const k of candidateKeys) {
        if (dsEntry.slots[k]) {
          sub = dsEntry.slots[k];
          break;
        }
      }
      if (sub && sub.isLocalBaked && Array.isArray(sub.lines)) {
        const isSoulCore = sub.type === 'SoulCore' || /soul core/i.test(dsEntry.canonicalName);
        const mult = isSoulCore ? soulCoreMult : runeMult;
        for (const l of sub.lines) {
          out.push(mult !== 1 ? scaleStatLineNumeric(l, mult) : l);
        }
      }
      continue;
    }

    const fallback = POE2_RUNE_CATALOG[lowerName];
    const fbSub = fallback?.[slotCategory];
    if (fbSub?.isLocalDefenceOrPhys) {
      const mult = fallback?.isSoulCore ? soulCoreMult : runeMult;
      for (const l of fbSub.stats) {
        out.push(mult !== 1 ? scaleStatLineNumeric(l, mult) : l);
      }
    }
  }
  return out;
}

/**
 * Resolves PoE 2 unbaked `Rune: <Name>` / `Soul Core of <Name>` header lines on equipped items
 * when `item.implicits` does NOT already contain `{rune}` lines, while skipping local
 * defence/physical runes (`Iron Rune`, `Tempered Rune`, weapon flat elemental runes) handled
 * by item headers or `resolvePoe2ItemLocalRuneLines`.
 */
export function evaluatePoe2UnbakedSocketedRunes(
  equippedItems: ReadonlyArray<{ slot: EquipmentSlotId | string; item: Item }>,
  game: GameId,
  options?: EvaluatePoe2UnbakedRunesOptions,
): Poe2UnbakedRunesResult {
  const addedStatLines: Array<{ source: string; lines: string[] }> = [];
  const addedMods: Mod[] = [];
  const details: Poe2UnbakedRuneItemDetail[] = [];

  if (game !== 'poe2') {
    return { addedStatLines, addedMods, details };
  }

  const dsMap = buildCaseInsensitiveRuneMap(options?.datasetRunes);
  const lookupRune = (rawName: string): Poe2RuneDef | null => {
    const ext = options?.runesLookup?.lookupRune?.(rawName);
    if (ext) return ext;
    return POE2_RUNE_CATALOG[rawName.trim().toLowerCase()] ?? null;
  };

  // Count total socketed Idols across all active equipped items for per-Idol scaling runes
  // such as Carved Majesty ("+3 to Spirit per Idol socketed in your Equipment").
  const isSocketedIdol = (rawRuneName: string): boolean => {
    const lowerName = rawRuneName.trim().toLowerCase();
    const dsEntry = dsMap?.get(lowerName);
    if (dsEntry) {
      return Object.values(dsEntry.slots).some((sub) => sub?.type === 'Idol');
    }
    return /\bidol\b/i.test(lowerName) || lowerName === 'carved majesty';
  };
  let totalSocketedIdols = 0;
  for (const { item } of equippedItems) {
    for (const rawRuneName of extractRawRuneNames(item)) {
      if (isSocketedIdol(rawRuneName)) {
        totalSocketedIdols += 1;
      }
    }
  }
  const SPIRIT_PER_IDOL_RE = /^\+?(\d+)\s+to\s+Spirit\s+per\s+Idol\s+socketed\s+in\s+your\s+Equipment$/i;
  const emitSpiritPerIdolMods = (lines: readonly string[], source: string): void => {
    if (totalSocketedIdols <= 0) return;
    for (const rawLine of lines) {
      const m = stripPobTags(rawLine).match(SPIRIT_PER_IDOL_RE);
      if (m) {
        addedMods.push(mkMod('Spirit', 'BASE', Number(m[1]) * totalSocketedIdols, source));
      }
    }
  };

  for (const { slot, item } of equippedItems) {
    const runesFound = extractRawRuneNames(item);
    const bakedSrc = `PoE 2 Rune (${slot}): ${item.name}`;
    // Evaluate dynamic per-Idol mods (e.g. Carved Majesty) even when `{rune}` implicits are baked
    emitSpiritPerIdolMods([...item.implicits, ...item.explicits], bakedSrc);

    if (runesFound.length === 0) continue;

    const slotCategory = classifyPoe2RuneSlotCategory(slot, item);

    // Never double-count items that already have `{rune}` / `(rune)` or pre-baked implicit lines!
    if (hasBakedRuneImplicits(item, slot, options?.datasetRunes)) {
      details.push({
        slot,
        itemName: item.name,
        slotCategory,
        runesFound,
        appliedRunes: [],
        skippedRunes: [],
        skippedEntireItemReason: 'already-baked-rune-implicits',
      });
      continue;
    }

    const hasArmourHeader = Boolean(
      item.armourStats &&
        ((item.armourStats.armour ?? 0) > 0 ||
          (item.armourStats.evasion ?? 0) > 0 ||
          (item.armourStats.energyShield ?? 0) > 0),
    );
    const hasWeaponHeader = Boolean(
      item.weaponStats &&
        (item.weaponStats.physicalMin > 0 || item.weaponStats.physicalMax > 0),
    );
    const { runeMult, soulCoreMult } = getSocketedEffectMultipliers(item);
    const candidateKeys = resolveDatasetRuneCandidateKeys(slot, item, slotCategory);
    const hasFoxIdolOnItem = runesFound.some((r) => r.trim().toLowerCase() === 'fox idol');
    const hasIdolsUseBondedLine = [...item.implicits, ...item.explicits].some((l) =>
      /Idols socketed in this item gain the benefits of their Bonded modifiers/i.test(stripPobTags(l)),
    );
    const allowIdolBonded = Boolean(hasFoxIdolOnItem || hasIdolsUseBondedLine);

    const itemStatLines: string[] = [];
    const appliedRunes: string[] = [];
    const skippedRunes: Array<{ name: string; reason: string }> = [];
    const src = `PoE 2 Rune (${slot}): ${item.name}`;

    for (const rawRuneName of runesFound) {
      const lowerName = rawRuneName.trim().toLowerCase();
      const dsEntry = !options?.runesLookup ? dsMap?.get(lowerName) : undefined;
      if (dsEntry) {
        let sub: DatasetRuneSubEntry | undefined;
        for (const k of candidateKeys) {
          if (dsEntry.slots[k]) {
            sub = dsEntry.slots[k];
            break;
          }
        }
        if (!sub) {
          skippedRunes.push({
            name: rawRuneName,
            reason: `unsupported-slot-category:${slotCategory}`,
          });
          continue;
        }

        const isIdol = sub.type === 'Idol';
        const includeBonded = Boolean(
          options?.allowBonded || (allowIdolBonded && isIdol),
        );
        const bondedLines = includeBonded && Array.isArray(sub.bonded) ? sub.bonded : [];

        if (sub.isLocalBaked && bondedLines.length === 0) {
          skippedRunes.push({
            name: rawRuneName,
            reason: 'local-baked-handled-in-local-item',
          });
          continue;
        }

        const isSoulCore = sub.type === 'SoulCore' || /soul core/i.test(dsEntry.canonicalName);
        const mult = isSoulCore ? soulCoreMult : runeMult;
        const linesToApply = [
          ...(sub.isLocalBaked ? [] : (sub.lines ?? [])),
          ...bondedLines,
        ];
        if (linesToApply.length === 0) continue;

        appliedRunes.push(dsEntry.canonicalName);
        for (const rawStat of linesToApply) {
          const effectiveLine =
            mult !== 1 ? scaleStatLineNumeric(rawStat, mult) : rawStat;
          const directMods = translateUnparsedRuneStatLine(effectiveLine, src);
          if (directMods && directMods.length > 0) {
            addedMods.push(...directMods);
          } else {
            itemStatLines.push(effectiveLine);
          }
        }
        continue;
      }

      const def = lookupRune(rawRuneName);
      if (!def) {
        skippedRunes.push({ name: rawRuneName, reason: 'unknown-rune' });
        continue;
      }

      const entry =
        def[slotCategory] ??
        (slotCategory === 'sceptre' ? def.weapon ?? def.caster : undefined);
      if (!entry) {
        skippedRunes.push({
          name: rawRuneName,
          reason: `unsupported-slot-category:${slotCategory}`,
        });
        continue;
      }

      // Skip local defence/physical runes that PoB 2 already bakes into item header stats
      if (entry.isLocalDefenceOrPhys) {
        if (slotCategory === 'armour' && hasArmourHeader) {
          skippedRunes.push({
            name: rawRuneName,
            reason: 'local-armour-already-in-header',
          });
          continue;
        }
        if (slotCategory === 'weapon' && hasWeaponHeader) {
          skippedRunes.push({
            name: rawRuneName,
            reason: 'local-weapon-phys-already-in-header',
          });
          continue;
        }
      }

      const mult = def.isSoulCore ? soulCoreMult : runeMult;
      appliedRunes.push(def.name);

      for (const rawStat of entry.stats) {
        const effectiveLine =
          mult !== 1 ? scaleStatLineNumeric(rawStat, mult) : rawStat;
        const directMods = translateUnparsedRuneStatLine(effectiveLine, src);
        if (directMods && directMods.length > 0) {
          addedMods.push(...directMods);
        } else {
          itemStatLines.push(effectiveLine);
        }
      }
    }

    if (itemStatLines.length > 0) {
      emitSpiritPerIdolMods(itemStatLines, src);
      addedStatLines.push({
        source: src,
        lines: itemStatLines,
      });
    }

    details.push({
      slot,
      itemName: item.name,
      slotCategory,
      runesFound,
      appliedRunes,
      skippedRunes,
    });
  }

  return {
    addedStatLines,
    addedMods,
    details,
  };
}
