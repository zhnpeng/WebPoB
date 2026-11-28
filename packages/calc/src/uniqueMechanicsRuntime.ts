import {
  KeywordFlag,
  ModFlag,
  type Build,
  type EquipmentSlotId,
  type GameId,
  type Item,
  type Mod,
  type ModType,
  type PassiveNode,
  type WeaponBaseStats,
} from '@webpob/core';
import { normalizeStatLineToEn } from '@webpob/i18n';
import {
  FULL_UTILITY_FLASK_BUFFS,
  extractLocalFlaskEffectPct,
  resolveUtilityFlaskBaseName,
  scaleModLineByMultiplier,
} from './equipmentAndFlasks.js';
import type { ModDB } from './modDb.js';
import { parseModLines, type ParseModOptions } from './modParser.js';

// ============================================================================
// Shared Helpers & Structural Types
// ============================================================================

export type EquippedItemEntry = {
  slot: string;
  item: Item;
};

/** Optional extended Item metadata for callers providing pre-counted socket counts. */
export interface ItemWithSocketCounts extends Item {
  filledSocketCount?: number;
  totalSocketCount?: number;
}

const FLASK_SLOTS: readonly EquipmentSlotId[] = [
  'Flask 1',
  'Flask 2',
  'Flask 3',
  'Flask 4',
  'Flask 5',
];

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

/**
 * Strips PoB XML brace tags (`{enchant}`, `{rune}`, `{crafted}`, `{fractured}`, `{range:0.5}`)
 * and normalizes localized lines to canonical English.
 */
function cleanModLine(raw: string): string {
  const stripped = raw.replace(/\{[^}]*\}/g, '').trim();
  return normalizeStatLineToEn(stripped).trim();
}

function collectCleanItemLines(item: Item): string[] {
  const out: string[] = [];
  for (const raw of [...item.implicits, ...item.explicits]) {
    for (const part of raw.split(/\r?\n/)) {
      const cleaned = cleanModLine(part);
      if (cleaned) out.push(cleaned);
    }
  }
  return out;
}

/**
 * PoB-authentic integer truncation with IEEE-754 epsilon guard
 * (prevents e.g. `1.5 * 1.2 * 100 = 179.99999999999997` truncating to `179` instead of `180`).
 */
function truncPoB(n: number): number {
  return Math.trunc(n + Math.sign(n) * 1e-9);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getRawModsForStat(db: ModDB, statName: string): readonly Mod[] {
  for (const [key, list] of db.entriesByPrefix(statName)) {
    if (key === statName) return list;
  }
  return [];
}

function hasStatSource(
  db: ModDB,
  statName: string,
  type: ModType,
  sourceSubstr: string,
  expectedValue?: number,
): boolean {
  const needle = sourceSubstr.toLowerCase();
  return getRawModsForStat(db, statName).some((m) => {
    if (m.type !== type) return false;
    if (!m.source.toLowerCase().includes(needle)) return false;
    if (expectedValue !== undefined && typeof m.value === 'number') {
      return Math.abs(m.value - expectedValue) < 1e-6;
    }
    return true;
  });
}

/**
 * Exact PoE 1 (3.23+) Energy Blade base lightning damage `[min, max]` by gem level 1..40,
 * matching upstream PoB1 `Data/Skills/act_int.lua` (`skills["EnergyBlade"]`) via
 * `calcLib.buildSkillInstanceStats`.
 */
const ENERGY_BLADE_BASE_LIGHTNING: ReadonlyArray<readonly [number, number]> = [
  [2, 40], // Lv 1
  [2, 46], // Lv 2
  [3, 53], // Lv 3
  [3, 60], // Lv 4
  [4, 68], // Lv 5
  [4, 77], // Lv 6
  [5, 87], // Lv 7
  [5, 98], // Lv 8
  [6, 110], // Lv 9
  [6, 118], // Lv 10
  [7, 127], // Lv 11
  [7, 136], // Lv 12
  [8, 146], // Lv 13
  [8, 157], // Lv 14
  [9, 168], // Lv 15
  [9, 180], // Lv 16
  [10, 193], // Lv 17
  [11, 206], // Lv 18
  [12, 220], // Lv 19
  [12, 235], // Lv 20
  [13, 250], // Lv 21
  [14, 267], // Lv 22
  [15, 284], // Lv 23
  [16, 303], // Lv 24
  [17, 322], // Lv 25
  [18, 343], // Lv 26
  [19, 365], // Lv 27
  [20, 387], // Lv 28
  [22, 412], // Lv 29
  [23, 437], // Lv 30
  [24, 450], // Lv 31
  [24, 464], // Lv 32
  [25, 478], // Lv 33
  [26, 492], // Lv 34
  [27, 507], // Lv 35
  [27, 522], // Lv 36
  [28, 538], // Lv 37
  [29, 554], // Lv 38
  [30, 570], // Lv 39
  [31, 587], // Lv 40
];

function getEnergyBladeBaseLightning(level: number): readonly [number, number] {
  const clamped = Math.max(1, Math.min(ENERGY_BLADE_BASE_LIGHTNING.length, Math.round(level)));
  return ENERGY_BLADE_BASE_LIGHTNING[clamped - 1]!;
}

function isBuildLike(
  input: Build | ReadonlyArray<EquippedItemEntry>,
): input is Build {
  return !Array.isArray(input) && typeof input === 'object' && input !== null && 'equipped' in input && 'items' in input;
}

function extractEquippedEntries(
  input: Build | ReadonlyArray<EquippedItemEntry>,
): EquippedItemEntry[] {
  if (!isBuildLike(input)) {
    return [...input];
  }
  const out: EquippedItemEntry[] = [];
  const equippedMap = input.equipped as Record<string, string | undefined>;
  for (const [slot, itemId] of Object.entries(equippedMap)) {
    if (!itemId) continue;
    const item = input.items[itemId];
    if (item) {
      out.push({ slot, item });
    }
  }
  return out;
}

function isKalandrasTouch(item: Item): boolean {
  const lower = normalizeName(item.name);
  if (lower === "kalandra's touch") return true;
  return collectCleanItemLines(item).some((l) => /Reflects (?:your other|opposite) Ring/i.test(l));
}

function formatNumberTrimmed(val: number, decimals: number): string {
  if (decimals <= 0) return String(Math.round(val));
  const fixed = val.toFixed(decimals);
  return fixed.replace(/\.?0+$/, '');
}

/**
 * Computes a signed delta-scaled modifier line for a target multiplier `totalMult` on top of
 * an already-ingested 1.0x item line. Preserves integer vs decimal precision and `+`/`-` signs.
 *
 * When `totalMult < 1` (e.g. `reduced bonuses gained from Equipped Rings`), returns
 * `negateParsed = true` with positive magnitude deltas so `parseModLines` parses them cleanly
 * and the caller negates the resulting numeric mod values.
 */
function buildSignedDeltaLine(
  line: string,
  totalMult: number,
): { line: string; negateParsed: boolean } | null {
  if (!Number.isFinite(totalMult) || Math.abs(totalMult - 1) < 1e-9) return null;
  const isReduction = totalMult < 1;
  let anyNonZero = false;

  const out = line.replace(/([+-]?)(\d+(?:\.\d+)?)/g, (_match, sign: string, numStr: string) => {
    const raw = Number(numStr);
    const dotIdx = numStr.indexOf('.');
    const decimals = dotIdx === -1 ? 0 : numStr.length - dotIdx - 1;

    let totalVal: number;
    let delta: number;
    if (decimals === 0) {
      totalVal = truncPoB(raw * totalMult);
      delta = totalVal - raw;
    } else {
      const factor = Math.pow(10, decimals);
      totalVal = truncPoB(raw * totalMult * factor) / factor;
      delta = Math.round((totalVal - raw) * factor) / factor;
    }

    const mag = isReduction ? -delta : delta;
    if (mag !== 0) anyNonZero = true;
    return `${sign}${formatNumberTrimmed(Math.max(0, mag), decimals)}`;
  });

  if (!anyNonZero) return null;
  return { line: out, negateParsed: isReduction };
}

function negateNumericMods(mods: readonly Mod[]): Mod[] {
  return mods.map((m) =>
    typeof m.value === 'number' && (m.type === 'BASE' || m.type === 'INC' || m.type === 'MORE')
      ? { ...m, value: -m.value }
      : m,
  );
}

// ============================================================================
// 1. PoE 2 `Ingenuity` Utility Belt Ring Bonus Scaler
// ============================================================================

const INGENUITY_SKIP_LINE_RE =
  /(?:Modifier magnitudes|Reflects (?:your other|opposite) Ring|^Has \d+ (?:Extra )?Sockets?$|^Grants Skill:|^Corrupted$|^Mirrored$|^Unidentified$|^Requires Level|bonuses gained from (?:your )?(?:(?:left|right) )?Equipped (?:(?:Left|Right) )?Rings?$)/i;

export interface IngenuityRingEvaluation {
  slot: 'Ring 1' | 'Ring 2';
  itemName: string;
  bonusPct: number;
  multiplier: number;
  deltaLines: string[];
  mods: Mod[];
}

export interface IngenuityEvaluationResult {
  allRingsBonusPct: number;
  leftRingBonusPct: number;
  rightRingBonusPct: number;
  rings: IngenuityRingEvaluation[];
  mods: Mod[];
  appliedSources: string[];
}

/**
 * Evaluates PoE 2 `Ingenuity` Utility Belt (and any item granting increased/reduced bonuses
 * gained from Equipped Rings / Left Ring / Right Ring), computing PoB-authentic integer/decimal
 * truncation deltas on `Ring 1` and `Ring 2` implicits & explicits and injecting them into `db`.
 */
export function evaluateIngenuityAndRingBonuses(
  equippedOrBuild: Build | ReadonlyArray<EquippedItemEntry>,
  db: ModDB,
  opts?: ParseModOptions,
): IngenuityEvaluationResult {
  const entries = extractEquippedEntries(equippedOrBuild);

  let allRingsBonusPct = 0;
  let leftRingBonusPct = 0;
  let rightRingBonusPct = 0;
  const beltSourceNames: string[] = [];
  const beltSourceSlots = new Set<string>();

  for (const { slot, item } of entries) {
    let matchedItem = false;
    for (const line of collectCleanItemLines(item)) {
      const mBoth = line.match(
        /^(\d+)% (increased|reduced) bonuses gained from (?:your )?Equipped Rings$/i,
      );
      if (mBoth) {
        const sign = mBoth[2]!.toLowerCase() === 'reduced' ? -1 : 1;
        allRingsBonusPct += sign * Number(mBoth[1]);
        matchedItem = true;
        continue;
      }

      const mLeft = line.match(
        /^(\d+)% (increased|reduced) bonuses gained from (?:your )?(?:Equipped Left|left Equipped) Ring$/i,
      );
      if (mLeft) {
        const sign = mLeft[2]!.toLowerCase() === 'reduced' ? -1 : 1;
        leftRingBonusPct += sign * Number(mLeft[1]);
        matchedItem = true;
        continue;
      }

      const mRight = line.match(
        /^(\d+)% (increased|reduced) bonuses gained from (?:your )?(?:Equipped Right|right Equipped) Ring$/i,
      );
      if (mRight) {
        const sign = mRight[2]!.toLowerCase() === 'reduced' ? -1 : 1;
        rightRingBonusPct += sign * Number(mRight[1]);
        matchedItem = true;
      }
    }
    if (matchedItem) {
      beltSourceNames.push(item.name);
      beltSourceSlots.add(slot.toLowerCase());
    }
  }

  // Also consume non-item `Ring1Effect` / `Ring2Effect` INC modifiers parsed into `db`
  // (e.g. PoE 2 passive tree / ascendancy / jewel ring-effect bonuses) without double-counting
  // lines already scanned from equipped items like `Ingenuity` (whose ModDB source is the slot name e.g. 'Belt').
  const beltSourceLower = new Set(beltSourceNames.map((n) => n.toLowerCase()));
  const extraDbRingEffect = (statName: 'Ring1Effect' | 'Ring2Effect'): number => {
    let extra = 0;
    for (const s of db.calcStat(statName).sources) {
      if (s.type !== 'INC' || typeof s.value !== 'number') continue;
      const srcLower = s.source.toLowerCase();
      let fromScannedItem = false;
      for (const slotL of beltSourceSlots) {
        if (srcLower === slotL || srcLower.startsWith(`${slotL}:`) || srcLower.includes(`(${slotL})`)) {
          fromScannedItem = true;
          break;
        }
      }
      if (!fromScannedItem) {
        for (const bName of beltSourceLower) {
          if (bName && srcLower.includes(bName)) {
            fromScannedItem = true;
            break;
          }
        }
      }
      if (!fromScannedItem) extra += s.value;
    }
    return extra;
  };
  leftRingBonusPct += extraDbRingEffect('Ring1Effect');
  rightRingBonusPct += extraDbRingEffect('Ring2Effect');

  const ring1Entry = entries.find((e) => e.slot === 'Ring 1');
  const ring2Entry = entries.find((e) => e.slot === 'Ring 2');
  const beltLabel = beltSourceNames.length > 0 ? beltSourceNames.join(' + ') : 'Ingenuity';

  const rings: IngenuityRingEvaluation[] = [];
  const allMods: Mod[] = [];
  const appliedSources: string[] = [];

  const ringSpecs: Array<{
    slot: 'Ring 1' | 'Ring 2';
    entry: EquippedItemEntry | undefined;
    opposite: EquippedItemEntry | undefined;
    bonusPct: number;
  }> = [
    {
      slot: 'Ring 1',
      entry: ring1Entry,
      opposite: ring2Entry,
      bonusPct: allRingsBonusPct + leftRingBonusPct,
    },
    {
      slot: 'Ring 2',
      entry: ring2Entry,
      opposite: ring1Entry,
      bonusPct: allRingsBonusPct + rightRingBonusPct,
    },
  ];

  for (const spec of ringSpecs) {
    if (!spec.entry || spec.bonusPct === 0) continue;

    // Resolve Kalandra's Touch reflection if applicable
    let effectiveItem = spec.entry.item;
    if (isKalandrasTouch(effectiveItem) && spec.opposite && !isKalandrasTouch(spec.opposite.item)) {
      effectiveItem = spec.opposite.item;
    }

    const multiplier = Math.max(0, 1 + spec.bonusPct / 100);
    const signLabel = spec.bonusPct >= 0 ? `+${spec.bonusPct}%` : `${spec.bonusPct}%`;
    const src = `${beltLabel} (${signLabel} ${spec.slot}: ${spec.entry.item.name})`;
    const deltaLines: string[] = [];
    const ringMods: Mod[] = [];

    for (const raw of [...effectiveItem.implicits, ...effectiveItem.explicits]) {
      for (const part of raw.split(/\r?\n/)) {
        const line = cleanModLine(part);
        if (!line || INGENUITY_SKIP_LINE_RE.test(line)) continue;
        const built = buildSignedDeltaLine(line, multiplier);
        if (!built) continue;
        const parsed = parseModLines([built.line], src, opts);
        if (parsed.length === 0) continue;
        const finalMods = built.negateParsed ? negateNumericMods(parsed) : parsed;
        deltaLines.push(built.negateParsed ? `-(${built.line})` : built.line);
        ringMods.push(...finalMods);
      }
    }

    if (ringMods.length > 0) {
      db.addMods(ringMods);
      allMods.push(...ringMods);
      appliedSources.push(src);
    }

    rings.push({
      slot: spec.slot,
      itemName: spec.entry.item.name,
      bonusPct: spec.bonusPct,
      multiplier,
      deltaLines,
      mods: ringMods,
    });
  }

  return {
    allRingsBonusPct,
    leftRingBonusPct,
    rightRingBonusPct,
    rings,
    mods: allMods,
    appliedSources,
  };
}

// ============================================================================
// 1b. PoE 2 Equipped Focus Bonus Scaler (e.g. Disciple of Varashta `Instruments of Power`)
// ============================================================================

const FOCUS_SCALE_SKIP_LINE_RE =
  /^(?:\+\d+ to maximum Energy Shield$|\d+% (?:increased|reduced) (?:maximum )?Energy Shield$|Grants Skill:|Corrupted$|Mirrored$|Unidentified$|Requires Level)/i;

export interface FocusScalingOptions extends ParseModOptions {
  /** Explicit signed bonus percentage override (e.g. `-50` for Instruments of Power); defaults to `FocusEffect` / `EffectOfBonusesFromFocus` in `db` + allocated nodes. */
  focusEffectPct?: number;
  /** Optional allocated passive nodes to auto-detect `"N% (increased|reduced) bonuses gained from Equipped Focus"`. */
  allocatedNodes?: readonly PassiveNode[];
}

export interface FocusScalingResult {
  focusEffectPct: number;
  multiplier: number;
  slot: string | null;
  itemName: string | null;
  deltaLines: string[];
  mods: Mod[];
  appliedSources: string[];
}

/**
 * Evaluates PoE 2 Equipped Focus bonus scaling (e.g. Disciple of Varashta `Instruments of Power`:
 * `"50% reduced bonuses gained from Equipped Focus"`), computing PoB 2 `CalcSetup.lua:1625-1636` +
 * `ModStore.lua:114` (`m_modf(round(value * scale, 2))`) signed deltas on the equipped Focus's
 * non-local implicit & explicit mods and injecting them into `db` (guarded by `FocusEffectApplied`).
 */
export function evaluateEquippedFocusScaling(
  equippedOrBuild: Build | ReadonlyArray<EquippedItemEntry>,
  db: ModDB,
  opts?: FocusScalingOptions,
): FocusScalingResult {
  const entries = extractEquippedEntries(equippedOrBuild);
  let focusEffectPct =
    opts?.focusEffectPct ?? db.sum('INC', ['FocusEffect', 'EffectOfBonusesFromFocus']);

  if (opts?.focusEffectPct === undefined && focusEffectPct === 0 && opts?.allocatedNodes) {
    for (const node of opts.allocatedNodes) {
      for (const raw of node?.stats ?? []) {
        for (const part of raw.split(/\r?\n/)) {
          const line = cleanModLine(part);
          const m = line.match(/^(\d+)% (increased|reduced) bonuses gained from Equipped Focus$/i);
          if (m) {
            const sign = m[2]!.toLowerCase() === 'reduced' ? -1 : 1;
            focusEffectPct += sign * Number(m[1]);
          }
        }
      }
    }
  }

  const multiplier = Math.max(0, 1 + focusEffectPct / 100);
  const scale = multiplier - 1;
  const focusEntry = entries.find(
    ({ slot, item }) =>
      (slot === 'Weapon 2' || slot === 'Weapon 2 Swap') && /\bfocus\b/i.test(item.baseName),
  );

  if (!focusEntry || Math.abs(scale) < 1e-9 || db.flag('FocusEffectApplied')) {
    return {
      focusEffectPct,
      multiplier,
      slot: focusEntry?.slot ?? null,
      itemName: focusEntry?.item.name ?? null,
      deltaLines: [],
      mods: [],
      appliedSources: [],
    };
  }

  const isReduction = scale < 0;
  const signLabel = focusEffectPct >= 0 ? `+${focusEffectPct}%` : `${focusEffectPct}%`;
  const src = `Focus Effect (${signLabel} ${focusEntry.slot}: ${focusEntry.item.name})`;
  const deltaLines: string[] = [];
  const mods: Mod[] = [];
  const parseOpts: ParseModOptions = { ...opts };

  for (const raw of [...focusEntry.item.implicits, ...focusEntry.item.explicits]) {
    for (const part of raw.split(/\r?\n/)) {
      const line = cleanModLine(part);
      if (!line || FOCUS_SCALE_SKIP_LINE_RE.test(line)) continue;
      let anyNonZero = false;
      const deltaLine = line.replace(
        /([+-]?)(\d+(?:\.\d+)?)/g,
        (_match, sign: string, numStr: string) => {
          const rawNum = Number(numStr);
          const dotIdx = numStr.indexOf('.');
          const decimals = dotIdx === -1 ? 0 : numStr.length - dotIdx - 1;
          let delta: number;
          if (decimals === 0) {
            delta = Math.trunc(Math.round(rawNum * scale * 100) / 100);
          } else {
            const factor = Math.pow(10, decimals);
            delta = Math.trunc(Math.round(rawNum * scale * factor * 100) / 100) / factor;
          }
          const mag = isReduction ? -delta : delta;
          if (mag !== 0) anyNonZero = true;
          return `${sign}${formatNumberTrimmed(Math.max(0, mag), decimals)}`;
        },
      );
      if (!anyNonZero) continue;
      const parsed = parseModLines([deltaLine], src, parseOpts);
      if (parsed.length === 0) continue;
      const finalMods = isReduction ? negateNumericMods(parsed) : parsed;
      deltaLines.push(isReduction ? `-(${deltaLine})` : deltaLine);
      mods.push(...finalMods);
    }
  }

  const appliedSources: string[] = [];
  if (mods.length > 0) {
    db.addMods(mods);
    db.addMod(mkMod('FocusEffectApplied', 'FLAG', true, src));
    appliedSources.push(src);
  }

  return {
    focusEffectPct,
    multiplier,
    slot: focusEntry.slot,
    itemName: focusEntry.item.name,
    deltaLines,
    mods,
    appliedSources,
  };
}

// ============================================================================
// 2. PoE 2 `Morior Invictus` & Socket-Count Item Modifiers
// ============================================================================

export interface ItemSocketCounts {
  totalSockets: number;
  filledSockets: number;
  emptySockets: number;
}

const PER_SOCKET_FILLED_RE =
  /^([+-]?\d+(?:\.\d+)?)(%?)\s+(.+?)\s+per Socket filled$/i;
const PER_SOCKETED_RUNE_RE =
  /^([+-]?\d+(?:\.\d+)?)(%?)\s+(.+?)\s+per Socketed (?:Rune or Soul Core|Soul Core or Rune|Rune,\s*Soul Core or Idol|Augment|Item)$/i;
const PER_EMPTY_SOCKET_RE =
  /^([+-]?\d+(?:\.\d+)?)(%?)\s+(.+?)\s+per Empty Socket$/i;

function extractSocketTokenCount(item: ItemWithSocketCounts): number {
  if (typeof item.totalSocketCount === 'number' && Number.isFinite(item.totalSocketCount)) {
    return Math.max(0, Math.floor(item.totalSocketCount));
  }
  if (item.sockets) {
    const tokens = item.sockets.match(/[RGBWSAD]/gi);
    if (tokens && tokens.length > 0) return tokens.length;
  }
  if (item.rawText) {
    const m = item.rawText.match(/^\s*Sockets\s*:\s*(.+)$/im);
    if (m) {
      const tokens = m[1]!.match(/[RGBWSAD]/gi);
      if (tokens && tokens.length > 0) return tokens.length;
    }
  }
  return 0;
}

/**
 * Counts total, filled, and empty sockets on an equipped item from:
 * 1. Explicit `filledSocketCount` property (if present),
 * 2. `Rune:` lines in `item.rawText`,
 * 3. `{rune}` lines in `item.implicits`,
 * 4. Fallback to socket tokens in `item.sockets` / `Sockets: S S S S S` when the item has
 *    `{rune}` or `per Socket filled` / `per Socketed Rune or Soul Core` lines.
 */
export function countItemSockets(item: ItemWithSocketCounts): ItemSocketCounts {
  const socketTokens = extractSocketTokenCount(item);

  // 1. Explicit filledSocketCount property
  if (typeof item.filledSocketCount === 'number' && Number.isFinite(item.filledSocketCount)) {
    const filled = Math.max(0, Math.floor(item.filledSocketCount));
    const total = Math.max(socketTokens, filled);
    return {
      totalSockets: total,
      filledSockets: filled,
      emptySockets: Math.max(0, total - filled),
    };
  }

  // 2. Count non-empty `Rune:` lines in rawText (ignoring placeholder `Rune: None`)
  if (item.rawText) {
    const runeRe = /^\s*Rune\s*[:：]\s*(.+?)\s*$/gim;
    let filled = 0;
    let anyRuneHeader = false;
    let rm: RegExpExecArray | null;
    while ((rm = runeRe.exec(item.rawText)) !== null) {
      anyRuneHeader = true;
      const val = rm[1]!.trim();
      if (val && !/^none$/i.test(val)) {
        filled++;
      }
    }
    if (anyRuneHeader) {
      const total = Math.max(socketTokens, filled);
      return {
        totalSockets: total,
        filledSockets: filled,
        emptySockets: Math.max(0, total - filled),
      };
    }
  }

  // 3. Count `{rune}` lines in implicits
  const runeImplicitCount = item.implicits.filter((l) => /\{rune\}/i.test(l)).length;
  if (runeImplicitCount > 0) {
    const total = Math.max(socketTokens, runeImplicitCount);
    return {
      totalSockets: total,
      filledSockets: runeImplicitCount,
      emptySockets: Math.max(0, total - runeImplicitCount),
    };
  }

  // 4. Fallback to socket tokens when item has `per Socket filled` / `per Socketed Rune or Soul Core`
  const allClean = collectCleanItemLines(item);
  const hasFilledMod = allClean.some(
    (l) => PER_SOCKET_FILLED_RE.test(l) || PER_SOCKETED_RUNE_RE.test(l),
  );
  if (hasFilledMod && socketTokens > 0) {
    return {
      totalSockets: socketTokens,
      filledSockets: socketTokens,
      emptySockets: 0,
    };
  }

  return {
    totalSockets: socketTokens,
    filledSockets: 0,
    emptySockets: socketTokens,
  };
}

function parseDirectPerSocketFallback(
  scaledVal: number,
  pctSign: string,
  body: string,
  source: string,
): Mod[] {
  const lower = body.trim().toLowerCase();
  if (lower === 'to spirit') {
    return [mkMod('Spirit', 'BASE', scaledVal, source)];
  }
  if (
    lower === 'increased global defences' ||
    lower === 'increased global armour, evasion and energy shield'
  ) {
    return [
      mkMod('Armour', 'INC', scaledVal, source),
      mkMod('Evasion', 'INC', scaledVal, source),
      mkMod('EnergyShield', 'INC', scaledVal, source),
      mkMod('Ward', 'INC', scaledVal, source),
    ];
  }
  if (lower === 'increased attributes' || lower === 'increased all attributes') {
    return [
      mkMod('Str', 'INC', scaledVal, source),
      mkMod('Dex', 'INC', scaledVal, source),
      mkMod('Int', 'INC', scaledVal, source),
    ];
  }
  if (lower === 'to all attributes') {
    return [
      mkMod('Str', 'BASE', scaledVal, source),
      mkMod('Dex', 'BASE', scaledVal, source),
      mkMod('Int', 'BASE', scaledVal, source),
    ];
  }
  if (lower === 'increased rarity of items found') {
    return [mkMod('ItemRarity', 'INC', scaledVal, source)];
  }
  if (lower === 'to all elemental resistances' && pctSign === '%') {
    return [
      mkMod('FireResist', 'BASE', scaledVal, source),
      mkMod('ColdResist', 'BASE', scaledVal, source),
      mkMod('LightningResist', 'BASE', scaledVal, source),
    ];
  }
  const mRes = lower.match(/^to (fire|cold|lightning|chaos) resistance$/);
  if (mRes && pctSign === '%') {
    const el = mRes[1]!.charAt(0).toUpperCase() + mRes[1]!.slice(1);
    return [mkMod(`${el}Resist`, 'BASE', scaledVal, source)];
  }
  const mMaxPool = lower.match(/^to maximum (life|mana|energy shield)$/);
  if (mMaxPool) {
    const stat =
      mMaxPool[1] === 'energy shield'
        ? 'EnergyShield'
        : mMaxPool[1]!.charAt(0).toUpperCase() + mMaxPool[1]!.slice(1);
    return [mkMod(stat, 'BASE', scaledVal, source)];
  }
  return [];
}

export interface EvaluatedPerSocketItemEntry {
  slot: string;
  itemName: string;
  counts: ItemSocketCounts;
  scaledLines: string[];
  mods: Mod[];
}

export interface PerSocketEvaluationResult {
  entries: EvaluatedPerSocketItemEntry[];
  mods: Mod[];
  appliedSources: string[];
}

/**
 * Evaluates PoE 2 `Morior Invictus` and all `per Socket filled` / `per Socketed Rune or Soul Core`
 * / `per Empty Socket` item modifiers across equipped items, injecting scaled canonical mods into `db`
 * while guarding against double-counting lines already parsed into `db`.
 */
export function evaluatePerSocketItemModifiers(
  equippedOrBuild: Build | ReadonlyArray<EquippedItemEntry>,
  db: ModDB,
  opts?: ParseModOptions & { skipDuplicateCheck?: boolean },
): PerSocketEvaluationResult {
  const entries = extractEquippedEntries(equippedOrBuild);
  const results: EvaluatedPerSocketItemEntry[] = [];
  const allMods: Mod[] = [];
  const appliedSources: string[] = [];

  for (const { slot, item } of entries) {
    const counts = countItemSockets(item as ItemWithSocketCounts);
    const cleanLines = collectCleanItemLines(item);
    const scaledLines: string[] = [];
    const itemMods: Mod[] = [];
    const src = `Per-Socket (${slot}): ${item.name}`;

    for (const line of cleanLines) {
      let match: RegExpMatchArray | null = null;
      let count = 0;

      if ((match = line.match(PER_SOCKET_FILLED_RE))) {
        count = counts.filledSockets;
      } else if ((match = line.match(PER_SOCKETED_RUNE_RE))) {
        count = counts.filledSockets;
      } else if ((match = line.match(PER_EMPTY_SOCKET_RE))) {
        count = counts.emptySockets;
      } else {
        continue;
      }

      if (count <= 0) continue;

      const rawStr = match[1]!;
      const rawVal = Number(rawStr);
      const hasPlus = rawStr.startsWith('+');
      const pctSign = match[2] ?? '';
      const body = match[3]!.trim();

      const dotIdx = rawStr.indexOf('.');
      const decimals = dotIdx === -1 ? 0 : rawStr.length - dotIdx - 1;
      const factor = Math.pow(10, decimals);
      const scaledVal =
        decimals === 0 ? rawVal * count : Math.round(rawVal * count * factor) / factor;

      const prefix = hasPlus && scaledVal >= 0 ? '+' : '';
      const canonicalLine = `${prefix}${formatNumberTrimmed(scaledVal, decimals)}${pctSign} ${body}`;

      let parsed = parseModLines([canonicalLine], src, opts);
      if (parsed.length === 0) {
        parsed = parseDirectPerSocketFallback(scaledVal, pctSign, body, src);
      }
      if (parsed.length === 0) continue;

      // Guard against double-counting if engine/parseModLines already injected this exact scaled mod from this item
      const filtered = opts?.skipDuplicateCheck
        ? parsed
        : parsed.filter((m) => {
            if (typeof m.value !== 'number') return true;
            return !hasStatSource(db, m.name, m.type, item.name, m.value);
          });

      if (filtered.length > 0) {
        scaledLines.push(canonicalLine);
        itemMods.push(...filtered);
      }
    }

    if (itemMods.length > 0) {
      db.addMods(itemMods);
      allMods.push(...itemMods);
      appliedSources.push(src);
      results.push({
        slot,
        itemName: item.name,
        counts,
        scaledLines,
        mods: itemMods,
      });
    }
  }

  return {
    entries: results,
    mods: allMods,
    appliedSources,
  };
}

// ============================================================================
// 3. `Mageblood` Auto-Active Magic Utility Flasks & Enkindling/Prefix Scaling
// ============================================================================

const MAGEBLOOD_FLASK_META_RE =
  /^(?:(?:\d+)% (?:increased|reduced) (?:effect(?: of Flask)?|Duration|Charge Recovery|Charges per use|Charges used)|Used when Charges reach full|Gains no Charges during Effect|Reused at the end of this Flask's effect|Use when you (?:become|take|hit|start|use)|Gain \d+ Charges? when you are Hit|\d+% chance to gain a Flask Charge|Creates (?:Consecrated|Chilled) Ground on Use|Creates a Smoke Cloud on Use|Taunts Enemies|Restores Ward on use)/i;

function normalizeFlaskSuffixLine(line: string): string {
  const mAddEle = line.match(/^(\d+)% additional Elemental Resistances(?: during Effect)?$/i);
  if (mAddEle) {
    return `+${mAddEle[1]}% to all Elemental Resistances`;
  }
  return line.replace(/\s+during Effect$/i, '').trim();
}

export interface MagebloodFlaskOptions {
  /** Slots already evaluated as active flasks (so they are never double-counted). */
  alreadyActiveFlaskSlots?:
    | ReadonlySet<EquipmentSlotId>
    | ReadonlyArray<EquipmentSlotId>
    | Partial<Record<EquipmentSlotId, boolean>>;
  /** Global `% increased Flask Effect` (defaults to `db.sum('INC', 'FlaskEffect')`). */
  globalFlaskEffectPct?: number;
  /**
   * Set to `true` if `alreadyActiveFlaskSlots` were ALREADY scaled by local Enkindling/Prefix
   * + global `FlaskEffect` (skips them completely). Defaults to `false`, meaning already-active
   * Mageblood flasks receive only their missing effect delta (`trunc(v * mult) - v`).
   */
  alreadyScaledByEffect?: boolean;
  parseOpts?: ParseModOptions;
}

export interface EvaluatedMagebloodFlaskEntry {
  slot: EquipmentSlotId;
  itemName: string;
  baseName: string;
  mode: 'full' | 'effect_delta' | 'skipped';
  localEffectPct: number;
  globalEffectPct: number;
  totalEffectPct: number;
  effectMult: number;
  appliedLines: string[];
  mods: Mod[];
}

export interface MagebloodEvaluationResult {
  magebloodLeftCount: number;
  magebloodRightCount: number;
  activatedSlots: EquipmentSlotId[];
  newlyActivatedSlots: EquipmentSlotId[];
  deltaScaledSlots: EquipmentSlotId[];
  grantsOnslaught: boolean;
  onslaughtEffectPct: number;
  perFlask: EvaluatedMagebloodFlaskEntry[];
  mods: Mod[];
  appliedSources: string[];
}

function toSlotSet(
  input: MagebloodFlaskOptions['alreadyActiveFlaskSlots'],
): Set<EquipmentSlotId> {
  const set = new Set<EquipmentSlotId>();
  if (!input) return set;
  if (input instanceof Set) {
    for (const s of input) set.add(s);
    return set;
  }
  if (Array.isArray(input)) {
    for (const s of input) set.add(s);
    return set;
  }
  for (const [slot, active] of Object.entries(input)) {
    if (active) set.add(slot as EquipmentSlotId);
  }
  return set;
}

/**
 * Detects PoE 1 `Mageblood` on equipped items, selects the first `N` Magic Utility Flasks
 * across `Flask 1`..`Flask 5` (matching PoB1's exact slot-order selection), and injects
 * Enkindling/Alchemist + global `FlaskEffect`-scaled base buffs (including scaled Silver Flask
 * Onslaught) and explicit suffix modifiers into `db` without double-counting active flasks.
 */
export function evaluateMagebloodFlasks(
  equippedOrBuild: Build | ReadonlyArray<EquippedItemEntry>,
  db: ModDB,
  opts?: MagebloodFlaskOptions,
): MagebloodEvaluationResult {
  const entries = extractEquippedEntries(equippedOrBuild);
  const bySlot = new Map<string, Item>();
  for (const e of entries) {
    bySlot.set(e.slot, e.item);
  }

  let magebloodLeftCount = 0;
  let magebloodRightCount = 0;
  for (const { item } of entries) {
    for (const line of collectCleanItemLines(item)) {
      const mLeft = line.match(
        /^Leftmost (\d+) Magic Utility Flasks constantly apply their Flask Effects to you$/i,
      );
      if (mLeft) {
        magebloodLeftCount = Math.max(magebloodLeftCount, Number(mLeft[1]));
      }
      const mRight = line.match(
        /^Rightmost (\d+) Magic Utility Flasks constantly apply their Flask Effects to you$/i,
      );
      if (mRight) {
        magebloodRightCount = Math.max(magebloodRightCount, Number(mRight[1]));
      }
    }
  }

  if (magebloodLeftCount === 0 && magebloodRightCount === 0) {
    return {
      magebloodLeftCount: 0,
      magebloodRightCount: 0,
      activatedSlots: [],
      newlyActivatedSlots: [],
      deltaScaledSlots: [],
      grantsOnslaught: false,
      onslaughtEffectPct: 0,
      perFlask: [],
      mods: [],
      appliedSources: [],
    };
  }

  // PoB1 rule: check Flask 1..5 in slot order, collect Magic Utility Flasks, take first/last N
  const magicUtilitySlots: Array<{ slot: EquipmentSlotId; item: Item; baseName: string }> = [];
  for (const slot of FLASK_SLOTS) {
    const item = bySlot.get(slot);
    if (!item) continue;
    if (item.rarity !== 'MAGIC') continue;
    const baseName = resolveUtilityFlaskBaseName(item);
    if (!baseName) continue;
    magicUtilitySlots.push({ slot, item, baseName });
  }

  const selectedSlots = new Set<EquipmentSlotId>();
  for (let i = 0; i < Math.min(magebloodLeftCount, magicUtilitySlots.length); i++) {
    selectedSlots.add(magicUtilitySlots[i]!.slot);
  }
  for (let i = 0; i < Math.min(magebloodRightCount, magicUtilitySlots.length); i++) {
    selectedSlots.add(magicUtilitySlots[magicUtilitySlots.length - 1 - i]!.slot);
  }

  const alreadyActive = toSlotSet(opts?.alreadyActiveFlaskSlots);
  const globalEffectPct = opts?.globalFlaskEffectPct ?? db.sum('INC', 'FlaskEffect');

  const activatedSlots: EquipmentSlotId[] = [];
  const newlyActivatedSlots: EquipmentSlotId[] = [];
  const deltaScaledSlots: EquipmentSlotId[] = [];
  const perFlask: EvaluatedMagebloodFlaskEntry[] = [];
  const allMods: Mod[] = [];
  const appliedSources: string[] = [];
  let grantsOnslaught = false;
  let onslaughtEffectPct = 0;

  for (const { slot, item, baseName } of magicUtilitySlots) {
    if (!selectedSlots.has(slot)) continue;
    activatedSlots.push(slot);

    const localEffectPct = extractLocalFlaskEffectPct(item);
    const totalEffectPct = localEffectPct + globalEffectPct;
    const effectMult = Math.max(0, 1 + totalEffectPct / 100);
    const wasAlreadyActive = alreadyActive.has(slot);

    if (wasAlreadyActive && opts?.alreadyScaledByEffect) {
      perFlask.push({
        slot,
        itemName: item.name,
        baseName,
        mode: 'skipped',
        localEffectPct,
        globalEffectPct,
        totalEffectPct,
        effectMult,
        appliedLines: [],
        mods: [],
      });
      continue;
    }

    const mode: 'full' | 'effect_delta' = wasAlreadyActive ? 'effect_delta' : 'full';
    const src =
      mode === 'full'
        ? `Mageblood (${slot}): ${item.name}`
        : `Mageblood Effect Delta (${slot}): ${item.name}`;

    const appliedLines: string[] = [];
    const flaskMods: Mod[] = [];

    // 1. Base utility flask buffs
    const rawBuffs = FULL_UTILITY_FLASK_BUFFS[baseName] ?? [];
    for (const buffLine of rawBuffs) {
      if (/^Onslaught$/i.test(buffLine)) {
        grantsOnslaught = true;
        const scaledOnslaught = truncPoB(20 * effectMult);
        onslaughtEffectPct = Math.max(onslaughtEffectPct, scaledOnslaught);
        const valToInject = mode === 'full' ? scaledOnslaught : scaledOnslaught - 20;
        if (valToInject !== 0) {
          appliedLines.push(`Onslaught (${valToInject}% Attack/Cast/Movement Speed)`);
          flaskMods.push(
            mkMod('Speed', 'INC', valToInject, `${src} [Onslaught]`, ModFlag.Attack),
            mkMod('Speed', 'INC', valToInject, `${src} [Onslaught]`, ModFlag.Spell),
            mkMod('MovementSpeed', 'INC', valToInject, `${src} [Onslaught]`),
          );
        }
        continue;
      }
      if (/^Phasing$/i.test(buffLine)) {
        if (mode === 'full') {
          appliedLines.push('Phasing');
          flaskMods.push(mkMod('Phasing', 'FLAG', true, `${src} [Base]`));
        }
        continue;
      }

      if (mode === 'full') {
        const scaled = scaleModLineByMultiplier(buffLine, effectMult);
        const parsed = parseModLines([scaled], `${src} [Base]`, opts?.parseOpts);
        if (parsed.length > 0) {
          appliedLines.push(scaled);
          flaskMods.push(...parsed);
        }
      } else {
        const delta = buildSignedDeltaLine(buffLine, effectMult);
        if (delta) {
          const parsed = parseModLines([delta.line], `${src} [Base Delta]`, opts?.parseOpts);
          if (parsed.length > 0) {
            const finalMods = delta.negateParsed ? negateNumericMods(parsed) : parsed;
            appliedLines.push(delta.negateParsed ? `-(${delta.line})` : delta.line);
            flaskMods.push(...finalMods);
          }
        }
      }
    }

    // 2. Explicit & non-meta implicit suffix lines
    for (const raw of [...item.implicits, ...item.explicits]) {
      const line = cleanModLine(raw);
      if (!line || MAGEBLOOD_FLASK_META_RE.test(line)) continue;
      const normalized = normalizeFlaskSuffixLine(line);
      if (!normalized) continue;

      if (mode === 'full') {
        const scaled = scaleModLineByMultiplier(normalized, effectMult);
        const parsed = parseModLines([scaled], src, opts?.parseOpts);
        if (parsed.length > 0) {
          appliedLines.push(scaled);
          flaskMods.push(...parsed);
        }
      } else {
        const delta = buildSignedDeltaLine(normalized, effectMult);
        if (delta) {
          const parsed = parseModLines([delta.line], `${src} [Suffix Delta]`, opts?.parseOpts);
          if (parsed.length > 0) {
            const finalMods = delta.negateParsed ? negateNumericMods(parsed) : parsed;
            appliedLines.push(delta.negateParsed ? `-(${delta.line})` : delta.line);
            flaskMods.push(...finalMods);
          }
        }
      }
    }

    if (flaskMods.length > 0) {
      db.addMods(flaskMods);
      allMods.push(...flaskMods);
      appliedSources.push(src);
    }

    if (mode === 'full') {
      newlyActivatedSlots.push(slot);
    } else if (flaskMods.length > 0) {
      deltaScaledSlots.push(slot);
    }

    perFlask.push({
      slot,
      itemName: item.name,
      baseName,
      mode,
      localEffectPct,
      globalEffectPct,
      totalEffectPct,
      effectMult,
      appliedLines,
      mods: flaskMods,
    });
  }

  return {
    magebloodLeftCount,
    magebloodRightCount,
    activatedSlots,
    newlyActivatedSlots,
    deltaScaledSlots,
    grantsOnslaught,
    onslaughtEffectPct,
    perFlask,
    mods: allMods,
    appliedSources,
  };
}

// ============================================================================
// 4. Stat-Stacking, Weapon-Transform & Resistance Build-Enabling Uniques
// ============================================================================

export interface PreStatUniqueContext {
  db: ModDB;
  equippedItems: ReadonlyArray<EquippedItemEntry>;
  socketedJewels?: readonly Item[];
  /** Character class base attributes (used by Crystallised Omniscience to restore base Str/Dex/Int). */
  classBaseAttributes?: { str: number; dex: number; int: number };
  game?: GameId;
}

export interface PreStatUniqueResult {
  crystallisedOmniscienceActive: boolean;
  omniscienceTotal: number;
  omniscienceAllResBonus: number;
  omniscienceElePenBonus: number;
  restoredBaseAttributes: { str: number; dex: number; int: number } | null;
  allSkillGemQualityBonus: number;
  allSkillGemLevelBonus: number;
  heartOfTheWellActive: boolean;
  originalSinActive: boolean;
  enemyChaosResistOverride: number | null;
  doryanisPrototypeActive: boolean;
  appliedSources: string[];
}

function inferClassBaseAttr(
  db: ModDB,
  statName: 'Str' | 'Dex' | 'Int',
  explicitBase?: number,
): number {
  if (explicitBase !== undefined) return explicitBase;
  const evalStat = db.calcStat(statName);
  let classBase = 0;
  for (const s of evalStat.sources) {
    if (s.type === 'BASE' && typeof s.value === 'number' && /^Class:/i.test(s.source)) {
      classBase += s.value;
    }
  }
  return classBase;
}

/**
 * Joins PoB XML multiline-wrapped item modifiers (e.g. The Taming's
 * `"48% increased Elemental Damage with Hits and Ailments for"` +
 * `"each type of Elemental Ailment on Enemy"`).
 */
function joinWrappedItemLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let cur = lines[i]!;
    while (
      i + 1 < lines.length &&
      /\b(?:for|with|and|of|to|on|while|if|per|from|in|or|when|your|apply|dealing|melee|spell|attack|weapon)$/i.test(cur) &&
      !/^(?:Left|Right) ring slot:/i.test(lines[i + 1]!)
    ) {
      i += 1;
      cur = `${cur} ${lines[i]!}`;
    }
    out.push(cur);
  }
  return out;
}

/**
 * Phase A (Pre-Attribute / Pre-Pool): evaluates build-enabling uniques that transform attributes,
 * gem levels/quality, damage conversion, or enemy resistances prior to final pool resolution:
 * - `Crystallised Omniscience`
 * - `Ashes of the Stars`
 * - `Heart of the Well` (PoE 2 Diamond)
 * - `Original Sin`
 * - `Doryani's Prototype`
 * - Slot-conditional rings (`Shavronne's Revelation`, `Polaric Devastation`), `Xoph's Blood` Ash,
 *   `Singularity`, `Betrayal's Sting`, `Yaomac's Accord` Vaal mods, and quality-scaled grants.
 */
export function evaluatePreStatBuildEnablingUniques(
  ctx: PreStatUniqueContext,
): PreStatUniqueResult {
  const { db } = ctx;
  const allEntries: EquippedItemEntry[] = [
    ...ctx.equippedItems,
    ...(ctx.socketedJewels ?? []).map((item, i) => ({ slot: `Jewel ${i + 1}`, item })),
  ];

  let crystallisedOmniscienceActive = false;
  let omniResDivisor = 15;
  let omniPenDivisor = 15;
  let omniscienceTotal = 0;
  let omniscienceAllResBonus = 0;
  let omniscienceElePenBonus = 0;
  let restoredBaseAttributes: { str: number; dex: number; int: number } | null = null;

  let allSkillGemQualityBonus = 0;
  let allSkillGemLevelBonus = 0;
  let heartOfTheWellActive = false;
  let originalSinActive = false;
  let enemyChaosResistOverride: number | null = null;
  let doryanisPrototypeActive = false;

  const appliedSources: string[] = [];

  for (const { slot, item } of allEntries) {
    const src = `Unique (${slot}): ${item.name}`;
    const lines = collectCleanItemLines(item);
    const isHeartOfTheWell = normalizeName(item.name) === 'heart of the well';

    for (const line of lines) {
      // 1. Crystallised Omniscience detection & direct Omniscience mods
      if (/^Modifiers to Attributes instead apply to Omniscience$/i.test(line)) {
        crystallisedOmniscienceActive = true;
        appliedSources.push(src);
        continue;
      }
      const mOmniFlat = line.match(/^\+(\d+) to Omniscience$/i);
      if (mOmniFlat) {
        const val = Number(mOmniFlat[1]);
        if (!hasStatSource(db, 'Omniscience', 'BASE', item.name, val)) {
          db.addMod(mkMod('Omniscience', 'BASE', val, src));
        }
        continue;
      }
      const mOmniInc = line.match(/^(\d+)% increased Omniscience$/i);
      if (mOmniInc) {
        const val = Number(mOmniInc[1]);
        if (!hasStatSource(db, 'Omniscience', 'INC', item.name, val)) {
          db.addMod(mkMod('Omniscience', 'INC', val, src));
        }
        continue;
      }
      const mOmniRes = line.match(/^\+1% to all Elemental Resistances per (\d+) Omniscience$/i);
      if (mOmniRes) {
        omniResDivisor = Math.max(1, Number(mOmniRes[1]));
        continue;
      }
      const mOmniPen = line.match(/^Penetrate 1% Elemental Resistances per (\d+) Omniscience$/i);
      if (mOmniPen) {
        omniPenDivisor = Math.max(1, Number(mOmniPen[1]));
        continue;
      }

      // 2. Ashes of the Stars (+Quality and +Level of all Skill Gems)
      const mAllGemQual = line.match(/^\+(\d+)% to Quality of all Skill Gems$/i);
      if (mAllGemQual) {
        const q = Number(mAllGemQual[1]);
        allSkillGemQualityBonus += q;
        if (!hasStatSource(db, 'GemQuality:all', 'BASE', item.name, q)) {
          db.addMod(mkMod('GemQuality:all', 'BASE', q, src));
        }
        appliedSources.push(src);
        continue;
      }
      const mAllGemLvl = line.match(/^\+(\d+) to Level of all Skill Gems$/i);
      if (mAllGemLvl) {
        const lv = Number(mAllGemLvl[1]);
        allSkillGemLevelBonus += lv;
        if (!hasStatSource(db, 'GemLevel:all', 'BASE', item.name, lv)) {
          db.addMod(mkMod('GemLevel:all', 'BASE', lv, src));
        }
        continue;
      }

      // 3. Heart of the Well (PoE 2 Diamond) — Gain as Extra + Random Element + Penetration
      const mRandElem = line.match(
        /^Gain (\d+(?:\.\d+)?)% of Damage as Extra (?:Elemental )?Damage of a random Element$/i,
      );
      if (mRandElem) {
        heartOfTheWellActive = true;
        const perElem = Number(mRandElem[1]) / 3;
        if (!hasStatSource(db, 'DamageGainAsFire', 'BASE', `${item.name} [Random`)) {
          const randSrc = `${src} [Random Element Expected]`;
          db.addMod(mkMod('DamageGainAsFire', 'BASE', perElem, randSrc));
          db.addMod(mkMod('DamageGainAsCold', 'BASE', perElem, randSrc));
          db.addMod(mkMod('DamageGainAsLightning', 'BASE', perElem, randSrc));
          appliedSources.push(randSrc);
        }
        continue;
      }
      if (isHeartOfTheWell) {
        heartOfTheWellActive = true;
        const mGain = line.match(
          /^Gain (\d+(?:\.\d+)?)% of Damage as Extra (Fire|Cold|Lightning|Chaos) Damage$/i,
        );
        if (mGain) {
          const val = Number(mGain[1]);
          const stat = `DamageGainAs${mGain[2]!.charAt(0).toUpperCase()}${mGain[2]!.slice(1).toLowerCase()}`;
          if (!hasStatSource(db, stat, 'BASE', item.name, val)) {
            db.addMod(mkMod(stat, 'BASE', val, src));
            appliedSources.push(src);
          }
          continue;
        }
        const mPen = line.match(
          /^(?:Damage )?Penetrates? (\d+)% (?:of Enemy )?(Fire|Cold|Lightning|Elemental) Resistances?$/i,
        );
        if (mPen) {
          const val = Number(mPen[1]);
          const el = mPen[2]!.charAt(0).toUpperCase() + mPen[2]!.slice(1).toLowerCase();
          if (el === 'Elemental') {
            for (const target of ['FirePenetration', 'ColdPenetration', 'LightningPenetration']) {
              if (!hasStatSource(db, target, 'BASE', item.name, val)) {
                db.addMod(mkMod(target, 'BASE', val, src));
              }
            }
          } else {
            const target = `${el}Penetration`;
            if (!hasStatSource(db, target, 'BASE', item.name, val)) {
              db.addMod(mkMod(target, 'BASE', val, src));
            }
          }
          appliedSources.push(src);
          continue;
        }
      }

      // 4. Original Sin
      if (/^All Elemental Damage Converted to Chaos Damage$/i.test(line)) {
        originalSinActive = true;
        if (!db.flag('OriginalSin')) {
          db.addMod(mkMod('OriginalSin', 'FLAG', true, src));
          db.addMod(mkMod('FireDamageConvertToChaos', 'BASE', 100, src));
          db.addMod(mkMod('ColdDamageConvertToChaos', 'BASE', 100, src));
          db.addMod(mkMod('LightningDamageConvertToChaos', 'BASE', 100, src));
        }
        appliedSources.push(src);
        continue;
      }
      if (
        /^(?:Nearby Enemies'?|Enemies in your Presence'?s?) Chaos Resistance is 0$/i.test(line) ||
        /^Enemies in your Presence have 0% Chaos Resistance$/i.test(line)
      ) {
        originalSinActive = true;
        enemyChaosResistOverride = 0;
        db.addMod(mkMod('OriginalSinZeroChaosRes', 'FLAG', true, src));
        db.addMod(mkMod('EnemyChaosResist', 'OVERRIDE', 0, src));
        db.addMod(mkMod('EnemyChaosResistOverride', 'OVERRIDE', 0, src));
        appliedSources.push(src);
        continue;
      }

      // 5. Doryani's Prototype (PoE 1: "Nearby Enemies...", PoE 2: "Enemies in your Presence...")
      if (/^(?:Nearby Enemies|Enemies in your Presence) have Lightning Resistance equal to yours$/i.test(line)) {
        doryanisPrototypeActive = true;
        if (!db.flag('DoryanisPrototype')) {
          db.addMod(mkMod('DoryanisPrototype', 'FLAG', true, src));
          db.addMod(mkMod('EnemyLightningResistEqualsPlayer', 'FLAG', true, src));
        }
        appliedSources.push(src);
        continue;
      }

      // 6. The Tempest Rising (PoE 1 3.25+: "You and Enemies in your Presence count as moving while affected by Elemental Ailments")
      if (
        /(?:Enemies(?: in your Presence)?|You and Enemies in your Presence) count as moving while affected by Elemental Ailments/i.test(
          line,
        ) ||
        /Enemies affected by Elemental Ailments count as moving/i.test(line)
      ) {
        if (!db.flag('EnemyAffectedByEleAilmentCountsAsMoving')) {
          db.addMod(mkMod('EnemyAffectedByEleAilmentCountsAsMoving', 'FLAG', true, src));
        }
        appliedSources.push(src);
        continue;
      }

      // 7. Left / Right Ring slot conditional modifiers (Shavronne's Revelation, Polaric Devastation, etc.)
      const mRingSlot = line.match(/^(Left|Right) ring slot:\s*(.+)$/i);
      if (mRingSlot) {
        const dir = mRingSlot[1]!.toLowerCase();
        const slotMatches =
          (dir === 'left' && slot === 'Ring 1') || (dir === 'right' && slot === 'Ring 2');
        if (slotMatches) {
          const inner = mRingSlot[2]!.trim();
          if (/^Cover Enemies in Ash\b/i.test(inner)) {
            const requiresIgnite = /\bwhen you Ignite them\b/i.test(inner);
            if (
              !db.getEvalContext().conditions.EnemyCoveredInAsh &&
              !hasStatSource(db, 'EnemyFireDamageTaken', 'INC', 'Ash')
            ) {
              db.addMod({
                ...mkMod('EnemyFireDamageTaken', 'INC', 20, `${src} (Covered in Ash)`),
                ...(requiresIgnite ? { tags: [{ type: 'Condition', var: 'EnemyIgnited' }] } : {}),
              });
            }
            if (!requiresIgnite || db.getEvalContext().conditions.EnemyIgnited) {
              db.setCondition('EnemyCoveredInAsh', true);
            }
            appliedSources.push(src);
          } else if (/^Cover Enemies in Frost\b/i.test(inner)) {
            const requiresFreeze = /\bwhen you Freeze them\b/i.test(inner);
            if (
              !db.getEvalContext().conditions.EnemyCoveredInFrost &&
              !hasStatSource(db, 'EnemyColdDamageTaken', 'INC', 'Frost')
            ) {
              db.addMod({
                ...mkMod('EnemyColdDamageTaken', 'INC', 20, `${src} (Covered in Frost)`),
                ...(requiresFreeze ? { tags: [{ type: 'Condition', var: 'EnemyFrozen' }] } : {}),
              });
            }
            if (!requiresFreeze || db.getEvalContext().conditions.EnemyFrozen) {
              db.setCondition('EnemyCoveredInFrost', true);
            }
            appliedSources.push(src);
          } else {
            const parsedInner = parseModLines([inner], src);
            const dedupedInner = parsedInner.filter((m) =>
              typeof m.value === 'number'
                ? !hasStatSource(db, m.name, m.type, src, m.value)
                : !hasStatSource(db, m.name, m.type, src),
            );
            if (dedupedInner.length > 0) {
              db.addMods(dedupedInner);
              appliedSources.push(src);
            }
          }
        }
        continue;
      }

      // 8. Cover Enemies in Ash (Xoph's Blood, Foulborn Xoph's Blood, etc.)
      if (/^Cover Enemies in Ash\b/i.test(line)) {
        if (
          !db.getEvalContext().conditions.EnemyCoveredInAsh &&
          !hasStatSource(db, 'EnemyFireDamageTaken', 'INC', 'Ash')
        ) {
          db.addMod(mkMod('EnemyFireDamageTaken', 'INC', 20, `${src} (Covered in Ash)`));
        }
        db.setCondition('EnemyCoveredInAsh', true);
        appliedSources.push(src);
        continue;
      }

      // 8b. Legacy of Fury ("Nearby Enemies are Scorched" — base -10% Ele Res, scaled by Scorch Effect, cap 30%)
      if (/^Nearby Enemies are Scorched$/i.test(line)) {
        if (
          !db.getEvalContext().conditions.EnemyScorched &&
          !hasStatSource(db, 'EnemyFireResist', 'BASE', 'Scorch')
        ) {
          let localScorchEff = 0;
          for (const otherLine of lines) {
            const mScEff = otherLine.match(/^(\d+)% increased Effect of Scorch$/i);
            if (mScEff) localScorchEff += Number(mScEff[1]);
          }
          const dbScorchEff =
            db.sum('INC', 'EnemyScorchEffect') + db.sum('INC', 'EnemyAilmentEffect');
          // Avoid double-counting if modParser already parsed local "increased Effect of Scorch" into db
          const totalScorchEffInc = Math.max(localScorchEff, dbScorchEff);
          const scorchVal = Math.min(30, Math.floor(10 * Math.max(0, 1 + totalScorchEffInc / 100) + 1e-9));
          if (scorchVal > 0) {
            const scorchSrc = `${src} (Scorched)`;
            db.addMod(mkMod('EnemyFireResist', 'BASE', -scorchVal, scorchSrc));
            db.addMod(mkMod('EnemyColdResist', 'BASE', -scorchVal, scorchSrc));
            db.addMod(mkMod('EnemyLightningResist', 'BASE', -scorchVal, scorchSrc));
          }
        }
        db.setCondition('EnemyScorched', true);
        appliedSources.push(src);
        continue;
      }

      // 9. Singularity ("Nearby Enemies are Hindered, with 25% reduced Movement Speed")
      if (/^Nearby Enemies are Hindered\b/i.test(line)) {
        db.setCondition('EnemyHindered', true);
        appliedSources.push(src);
        continue;
      }

      // 10. Betrayal's Sting (additional poison chance on poison infliction)
      const mAddPoison = line.match(
        /^(\d+)% chance to inflict an additional Poison on the same Target when you inflict Poison$/i,
      );
      if (mAddPoison) {
        const val = Number(mAddPoison[1]);
        if (val > 0 && !hasStatSource(db, 'AdditionalPoisonChance', 'BASE', src, val)) {
          db.addMod(mkMod('AdditionalPoisonChance', 'BASE', val, src));
          appliedSources.push(src);
        }
        continue;
      }

      // 11. Vaal Skill increased Damage / Crit Chance on uniques (Yaomac's Accord, etc.)
      const mVaalDmg = line.match(/^(\d+)% increased Damage with Vaal Skills$/i);
      if (mVaalDmg) {
        const val = Number(mVaalDmg[1]);
        if (val > 0 && !hasStatSource(db, 'Damage', 'INC', src, val)) {
          db.addMod({
            ...mkMod('Damage', 'INC', val, src),
            tags: [{ type: 'SkillType', skillType: 'Vaal' }],
          });
          appliedSources.push(src);
        }
        continue;
      }
      const mVaalCrit = line.match(/^(\d+)% increased Critical Strike Chance with Vaal Skills$/i);
      if (mVaalCrit) {
        const val = Number(mVaalCrit[1]);
        if (val > 0 && !hasStatSource(db, 'CritChance', 'INC', src, val)) {
          db.addMod({
            ...mkMod('CritChance', 'INC', val, src),
            tags: [{ type: 'SkillType', skillType: 'Vaal' }],
          });
          appliedSources.push(src);
        }
        continue;
      }

      // 12. Quality-scaled item grants (Foulborn Skin of the Loyal, Nebulis, etc.)
      const mQualRes = line.match(
        /^Grants \+(\d+)% to (Fire|Cold|Lightning|Chaos) Resistance per (\d+)% Quality$/i,
      );
      if (mQualRes) {
        const steps = Math.floor(Math.max(0, item.quality ?? 0) / Math.max(1, Number(mQualRes[3])));
        const val = steps * Number(mQualRes[1]);
        const statName = `${mQualRes[2]}Resist`;
        if (val > 0 && !hasStatSource(db, statName, 'BASE', src, val)) {
          db.addMod(mkMod(statName, 'BASE', val, src));
          appliedSources.push(src);
        }
        continue;
      }
      const mQualAoe = line.match(/^Grants (\d+)% increased Area of Effect per (\d+)% Quality$/i);
      if (mQualAoe) {
        const steps = Math.floor(Math.max(0, item.quality ?? 0) / Math.max(1, Number(mQualAoe[2])));
        const val = steps * Number(mQualAoe[1]);
        if (val > 0 && !hasStatSource(db, 'AreaOfEffect', 'INC', src, val)) {
          db.addMod(mkMod('AreaOfEffect', 'INC', val, src));
          appliedSources.push(src);
        }
        continue;
      }

      // 13. Harvest Weapon Global Quality Enchant (Elemental Damage per N% Quality;
      // Attack Speed & Crit Chance per Quality are local weapon mods already precomputed in weapon header stats)
      const mQualEle = line.match(/^(\d+)% increased Elemental Damage per (\d+)% Quality$/i);
      if (mQualEle) {
        const steps = Math.floor(Math.max(0, item.quality ?? 0) / Math.max(1, Number(mQualEle[2])));
        const val = steps * Number(mQualEle[1]);
        if (val > 0 && !hasStatSource(db, 'ElementalDamage', 'INC', src, val)) {
          db.addMod(mkMod('ElementalDamage', 'INC', val, src));
          appliedSources.push(src);
        }
        continue;
      }

      // 14. Badge of the Brotherhood / Replica Badge of the Brotherhood
      if (/^Your Maximum Frenzy Charges is equal to your Maximum Power Charges$/i.test(line)) {
        if (!db.flag('BadgeOfTheBrotherhood')) {
          db.addMod(mkMod('BadgeOfTheBrotherhood', 'FLAG', true, src));
          appliedSources.push(src);
        }
        continue;
      }
      if (/^Your Maximum Endurance Charges is equal to your Maximum Frenzy Charges$/i.test(line)) {
        if (!hasStatSource(db, 'MaxEnduranceCharges', 'BASE', src)) {
          const maxFrenzy = 3 + db.sum('BASE', 'MaxFrenzyCharges');
          const maxEndurance = 3 + db.sum('BASE', 'MaxEnduranceCharges');
          const delta = maxFrenzy - maxEndurance;
          if (delta !== 0) {
            db.addMod(mkMod('MaxEnduranceCharges', 'BASE', delta, src));
          }
          appliedSources.push(src);
        }
        continue;
      }
    }
  }

  // Resolve Crystallised Omniscience attribute redirection
  if (crystallisedOmniscienceActive) {
    const src = 'Unique: Crystallised Omniscience';
    const baseStr = inferClassBaseAttr(db, 'Str', ctx.classBaseAttributes?.str);
    const baseDex = inferClassBaseAttr(db, 'Dex', ctx.classBaseAttributes?.dex);
    const baseInt = inferClassBaseAttr(db, 'Int', ctx.classBaseAttributes?.int);

    const strEval = db.calcStat('Str');
    const dexEval = db.calcStat('Dex');
    const intEval = db.calcStat('Int');

    const nonBaseStr = Math.max(0, strEval.base - baseStr);
    const nonBaseDex = Math.max(0, dexEval.base - baseDex);
    const nonBaseInt = Math.max(0, intEval.base - baseInt);

    const omniFlat = db.sum('BASE', 'Omniscience') + nonBaseStr + nonBaseDex + nonBaseInt;
    const omniInc = db.sum('INC', 'Omniscience') + strEval.incPct + dexEval.incPct + intEval.incPct;
    const omniMore = db.more('Omniscience');
    omniscienceTotal = Math.max(0, Math.floor(omniFlat * Math.max(0, 1 + omniInc / 100) * omniMore + 1e-9));

    // Restore Str/Dex/Int to class base ONLY
    db.addMod(mkMod('Str', 'OVERRIDE', baseStr, src));
    db.addMod(mkMod('Dex', 'OVERRIDE', baseDex, src));
    db.addMod(mkMod('Int', 'OVERRIDE', baseInt, src));
    restoredBaseAttributes = { str: baseStr, dex: baseDex, int: baseInt };

    db.addMod(mkMod('CrystallisedOmniscience', 'FLAG', true, src));
    db.addMod(mkMod('Omniscience', 'OVERRIDE', omniscienceTotal, src));
    db.setStat('Omniscience', omniscienceTotal);

    omniscienceAllResBonus = Math.floor(omniscienceTotal / omniResDivisor);
    omniscienceElePenBonus = Math.floor(omniscienceTotal / omniPenDivisor);

    if (omniscienceAllResBonus > 0) {
      db.addMod(mkMod('FireResist', 'BASE', omniscienceAllResBonus, src));
      db.addMod(mkMod('ColdResist', 'BASE', omniscienceAllResBonus, src));
      db.addMod(mkMod('LightningResist', 'BASE', omniscienceAllResBonus, src));
    }
    if (omniscienceElePenBonus > 0) {
      db.addMod(mkMod('FirePenetration', 'BASE', omniscienceElePenBonus, src));
      db.addMod(mkMod('ColdPenetration', 'BASE', omniscienceElePenBonus, src));
      db.addMod(mkMod('LightningPenetration', 'BASE', omniscienceElePenBonus, src));
    }
  }

  return {
    crystallisedOmniscienceActive,
    omniscienceTotal,
    omniscienceAllResBonus,
    omniscienceElePenBonus,
    restoredBaseAttributes,
    allSkillGemQualityBonus,
    allSkillGemLevelBonus,
    heartOfTheWellActive,
    originalSinActive,
    enemyChaosResistOverride,
    doryanisPrototypeActive,
    appliedSources,
  };
}

export interface EnergyBladeTransformResult {
  active: boolean;
  twoHanded: boolean;
  gemLevel: number;
  gemQuality: number;
  lessEsPct: number;
  postBladeEs: number;
  aps: number;
  critChance: number;
  lightningMin: number;
  lightningMax: number;
  weaponStats: WeaponBaseStats;
}

export interface PostPoolUniqueContext {
  db: ModDB;
  equippedItems: ReadonlyArray<EquippedItemEntry>;
  socketedJewels?: readonly Item[];
  str: number;
  dex: number;
  int: number;
  life: number;
  mana: number;
  energyShield: number;
  armour: number;
  evasion: number;
  fortified?: boolean;
  playerLightningResist?: number;
  /** Set when caller already applied `The Iron Fortress` `StrDmgBonusRatioOverride` directly to Strength's damage bonus. */
  ironFortressRatioApplied?: boolean;
  energyBlade?: {
    active: boolean;
    twoHanded?: boolean;
    gemLevel?: number;
    gemQuality?: number;
  };
  activeSkills?: ReadonlyArray<{ name: string; level?: number; quality?: number; enabled?: boolean }>;
  isTwoHanded?: boolean;
}

export interface PostPoolUniqueResult {
  crownOfEyesAttackInc: number;
  ironFortressBlockBonus: number;
  ironFortressExtraMeleePhysInc: number;
  replicaAlberonsChaosMin: number;
  replicaAlberonsChaosMax: number;
  howaLightningMin: number;
  howaLightningMax: number;
  howaAttackSpeedInc: number;
  brutusFireMin: number;
  brutusFireMax: number;
  pillarPhysWeaponInc: number;
  pillarAttackSpeedInc: number;
  rathpithSpellDamageInc: number;
  rathpithSpellCritInc: number;
  perseveranceAttackInc: number;
  perseveranceGrantedOnslaught: boolean;
  ephemeralEdgeLightningMax: number;
  energyBlade: EnergyBladeTransformResult | null;
  enemyLightningResistOverride: number | null;
  appliedSources: string[];
}

/**
 * Phase B (Post-Attribute / Post-Pool Offence & Defence): evaluates stat-stacking,
 * pool-scaling, and weapon-transforming uniques using resolved character attributes and pools:
 * - `Crown of Eyes`
 * - `The Iron Fortress`
 * - `Replica Alberon's Warpath`
 * - `Hand of Wisdom and Action`
 * - `Brutus' Lead Sprinkler`
 * - `Pillar of the Caged God`
 * - `Rathpith Globe`
 * - `Perseverance`
 * - `Ephemeral Edge`
 * - `Energy Blade`
 * - `Doryani's Prototype` (enemy Lightning Resistance sync)
 */
export function evaluatePostPoolBuildEnablingUniques(
  ctx: PostPoolUniqueContext,
): PostPoolUniqueResult {
  const { db, str, dex, int, life, mana, energyShield, armour, evasion } = ctx;
  const allEntries: EquippedItemEntry[] = [
    ...ctx.equippedItems,
    ...(ctx.socketedJewels ?? []).map((item, i) => ({ slot: `Jewel ${i + 1}`, item })),
  ];

  // Resolve exact capped elemental resistances (honoring Kitava penalty, max resist cap, and Melding)
  const getCappedPlayerEleResist = (elem: 'Fire' | 'Cold' | 'Lightning'): number => {
    const stats = db.getEvalContext().stats;
    const uncapped = stats[`Uncapped${elem}Resist`];
    const overcap = stats[`${elem}ResistOverCap`] ?? stats[`Overcapped${elem}Resist`];
    if (typeof uncapped === 'number' && typeof overcap === 'number') {
      return Math.min(90, Math.round(uncapped - overcap));
    }
    if (elem === 'Lightning' && ctx.playerLightningResist !== undefined) {
      return Math.min(90, Math.round(ctx.playerLightningResist));
    }
    const maxCap = Math.min(90, db.override(`${elem}ResistMax`) ?? Math.round(db.sum('BASE', `${elem}ResistMax`) || 75));
    const raw = db.override(`${elem}Resist`) ?? Math.round(db.sum('BASE', `${elem}Resist`));
    return Math.min(maxCap, raw);
  };

  let crownOfEyesAttackInc = 0;
  let ironFortressBlockBonus = 0;
  let ironFortressExtraMeleePhysInc = 0;
  let replicaAlberonsChaosMin = 0;
  let replicaAlberonsChaosMax = 0;
  let howaLightningMin = 0;
  let howaLightningMax = 0;
  let howaAttackSpeedInc = 0;
  let brutusFireMin = 0;
  let brutusFireMax = 0;
  let pillarPhysWeaponInc = 0;
  let pillarAttackSpeedInc = 0;
  let rathpithSpellDamageInc = 0;
  let rathpithSpellCritInc = 0;
  let perseveranceAttackInc = 0;
  let perseveranceGrantedOnslaught = false;
  let ephemeralEdgeLightningMax = 0;
  let energyBladeResult: EnergyBladeTransformResult | null = null;
  let enemyLightningResistOverride: number | null = null;

  const appliedSources: string[] = [];

  for (const { slot, item } of allEntries) {
    const src = `Unique (${slot}): ${item.name}`;
    const lowerName = normalizeName(item.name);
    const lines = joinWrappedItemLines(collectCleanItemLines(item));

    const hasPerAttrOrPerStatFromItem = (statNames: readonly string[]): boolean => {
      for (const sn of statNames) {
        for (const [, list] of db.entriesByPrefix(sn)) {
          for (const m of list) {
            if (!m.source.toLowerCase().includes(lowerName)) continue;
            if (sn.includes('PerAttr:') || m.tags?.some((t) => t.type === 'PerStat')) {
              return true;
            }
          }
        }
      }
      return false;
    };

    const getExistingBaseModsFromItem = (
      statName: string,
    ): { total: number; count: number; flags: number } => {
      let total = 0;
      let count = 0;
      let flags = 0;
      for (const m of getRawModsForStat(db, statName)) {
        if (m.type !== 'BASE' || typeof m.value !== 'number') continue;
        if (!m.source.toLowerCase().includes(lowerName)) continue;
        if (m.tags?.some((t) => t.type === 'PerStat')) continue;
        total += m.value;
        count += 1;
        flags = m.flags;
      }
      return { total, count, flags };
    };

    for (const line of lines) {
      // 1. Crown of Eyes
      const mCrown = line.match(
        /^Increases and Reductions to Spell Damage also apply to Attacks at (\d+)% of their value$/i,
      );
      if (mCrown && !db.flag('CrownOfEyesApplied')) {
        const pct = Number(mCrown[1]);
        const spellOnlyInc =
          db.sum('INC', 'Damage', ModFlag.Spell, KeywordFlag.Spell) -
          db.sum('INC', 'Damage', 0, 0);
        const alreadyAppliedBase = hasStatSource(
          db,
          'Damage',
          'INC',
          'Spell Damage Applies to Attacks',
        );
        const targetBonus = truncPoB((spellOnlyInc * pct) / 100);
        const bonusToAdd = alreadyAppliedBase ? targetBonus - spellOnlyInc : targetBonus;
        crownOfEyesAttackInc = targetBonus;
        if (bonusToAdd !== 0) {
          db.addMod(mkMod('Damage', 'INC', bonusToAdd, src, ModFlag.Attack));
        }
        db.addMod(mkMod('CrownOfEyesApplied', 'FLAG', true, src));
        appliedSources.push(src);
        continue;
      }

      // 2. Iron Fortress (+Block per 50 Str, +3% Melee Phys per 10 Str instead of 2%)
      const mFortBlock = line.match(
        /^\+(\d+)% Chance to Block Attack Damage per (\d+) Strength$/i,
      );
      if (mFortBlock) {
        const val = Math.floor(str / Math.max(1, Number(mFortBlock[2]))) * Number(mFortBlock[1]);
        ironFortressBlockBonus += val;
        if (!hasPerAttrOrPerStatFromItem(['BlockChance'])) {
          const existingBlock = getExistingBaseModsFromItem('BlockChance');
          if (existingBlock.count > 0) {
            const delta = val - existingBlock.total;
            if (delta !== 0) {
              db.addMod(mkMod('BlockChance', 'BASE', delta, `${src} (Stepped Adjustment)`));
            }
          } else if (
            val > 0 &&
            !hasPerAttrOrPerStatFromItem(['BlockChancePerAttr:Strength']) &&
            !hasStatSource(db, 'BlockChance', 'BASE', item.name, val)
          ) {
            db.addMod(mkMod('BlockChance', 'BASE', val, src));
          }
        }
        appliedSources.push(src);
        continue;
      }
      const mFortStrDmg = line.match(
        /^Strength'?s Damage Bonus instead grants (\d+)% (?:increased )?Melee Physical Damage per (\d+) Strength$/i,
      );
      if (mFortStrDmg) {
        const upgradedPct = Math.floor(str / Math.max(1, Number(mFortStrDmg[2]))) * Number(mFortStrDmg[1]);
        const basePct = Math.floor(str / 10) * 2;
        const extra = Math.max(0, upgradedPct - basePct);
        ironFortressExtraMeleePhysInc += extra;
        const alreadyAppliedByStrOverride =
          Boolean(ctx.ironFortressRatioApplied) ||
          db.sum('BASE', 'StrDmgBonusRatioOverride') > 0 ||
          hasStatSource(db, 'PhysicalDamage', 'INC', 'Iron Fortress') ||
          hasStatSource(db, 'PhysicalDamage', 'INC', item.name, extra);
        if (extra > 0 && !alreadyAppliedByStrOverride) {
          db.addMod(mkMod('PhysicalDamage', 'INC', extra, src, ModFlag.Melee));
        }
        appliedSources.push(src);
        continue;
      }

      // 3. Replica Alberon's Warpath
      const mAlberon = line.match(
        /^Adds (\d+) to (\d+) Chaos Damage to Attacks per (\d+) Strength$/i,
      );
      if (mAlberon) {
        const steps = Math.floor(str / Math.max(1, Number(mAlberon[3])));
        const cMin = Number(mAlberon[1]) * steps;
        const cMax = Number(mAlberon[2]) * steps;
        replicaAlberonsChaosMin += cMin;
        replicaAlberonsChaosMax += cMax;
        if (!hasPerAttrOrPerStatFromItem(['ChaosMin', 'ChaosMax'])) {
          const existingMin = getExistingBaseModsFromItem('ChaosMin');
          const existingMax = getExistingBaseModsFromItem('ChaosMax');
          const hasPerAttrChaos = hasPerAttrOrPerStatFromItem([
            'FlatMinPerAttr:Chaos:Strength',
            'FlatMaxPerAttr:Chaos:Strength',
          ]);
          if (existingMin.count > 0 || existingMax.count > 0) {
            // engine.ts injectAttributeScaling expands FlatMinPerAttr/FlatMaxPerAttr continuously
            // (e.g. floor(2154 * 1.0) = 2154 instead of stepped floor(2154 / 80) * 80 = 2080).
            // Reconcile via exact stepped delta instead of double-counting a full second copy.
            const minDelta = cMin - existingMin.total;
            const maxDelta = cMax - existingMax.total;
            if (minDelta !== 0) {
              db.addMod(
                mkMod(
                  'ChaosMin',
                  'BASE',
                  minDelta,
                  `${src} (Stepped Adjustment)`,
                  existingMin.count > 0 ? existingMin.flags : ModFlag.Attack,
                ),
              );
            }
            if (maxDelta !== 0) {
              db.addMod(
                mkMod(
                  'ChaosMax',
                  'BASE',
                  maxDelta,
                  `${src} (Stepped Adjustment)`,
                  existingMax.count > 0 ? existingMax.flags : ModFlag.Attack,
                ),
              );
            }
          } else if (!hasPerAttrChaos) {
            if (cMin > 0 && !hasStatSource(db, 'ChaosMin', 'BASE', item.name, cMin)) {
              db.addMod(mkMod('ChaosMin', 'BASE', cMin, src, ModFlag.Attack));
            }
            if (cMax > 0 && !hasStatSource(db, 'ChaosMax', 'BASE', item.name, cMax)) {
              db.addMod(mkMod('ChaosMax', 'BASE', cMax, src, ModFlag.Attack));
            }
          }
        }
        appliedSources.push(src);
        continue;
      }
      if (/^Cannot deal Non-Chaos Damage$/i.test(line)) {
        db.addMod(mkMod('DealNoPhysical', 'FLAG', true, src));
        db.addMod(mkMod('DealNoFire', 'FLAG', true, src));
        db.addMod(mkMod('DealNoCold', 'FLAG', true, src));
        db.addMod(mkMod('DealNoLightning', 'FLAG', true, src));
        appliedSources.push(src);
        continue;
      }

      // 4. Hand of Wisdom and Action (HoWA)
      const mHowaDmg = line.match(
        /^Adds (\d+) to (\d+) Lightning Damage to Attacks(?: with this Weapon)? per (\d+) Intelligence$/i,
      );
      if (mHowaDmg) {
        const steps = Math.floor(int / Math.max(1, Number(mHowaDmg[3])));
        const lMin = Number(mHowaDmg[1]) * steps;
        const lMax = Number(mHowaDmg[2]) * steps;
        howaLightningMin += lMin;
        howaLightningMax += lMax;
        if (!hasPerAttrOrPerStatFromItem(['FlatMinPerAttr:Lightning', 'LightningMin'])) {
          if (lMin > 0 && !hasStatSource(db, 'LightningMin', 'BASE', item.name, lMin)) {
            db.addMod(mkMod('LightningMin', 'BASE', lMin, src, ModFlag.Attack));
          }
          if (lMax > 0 && !hasStatSource(db, 'LightningMax', 'BASE', item.name, lMax)) {
            db.addMod(mkMod('LightningMax', 'BASE', lMax, src, ModFlag.Attack));
          }
        }
        appliedSources.push(src);
        continue;
      }

      // 5. Brutus' Lead Sprinkler
      const mBrutus = line.match(
        /^Adds (\d+) to (\d+) Fire Damage to Attacks with this Weapon per (\d+) Strength$/i,
      );
      if (mBrutus) {
        const steps = Math.floor(str / Math.max(1, Number(mBrutus[3])));
        const fMin = Number(mBrutus[1]) * steps;
        const fMax = Number(mBrutus[2]) * steps;
        brutusFireMin += fMin;
        brutusFireMax += fMax;
        if (!hasPerAttrOrPerStatFromItem(['FlatMinPerAttr:Fire', 'FireMin'])) {
          if (fMin > 0 && !hasStatSource(db, 'FireMin', 'BASE', item.name, fMin)) {
            db.addMod(mkMod('FireMin', 'BASE', fMin, src, ModFlag.Attack));
          }
          if (fMax > 0 && !hasStatSource(db, 'FireMax', 'BASE', item.name, fMax)) {
            db.addMod(mkMod('FireMax', 'BASE', fMax, src, ModFlag.Attack));
          }
        }
        appliedSources.push(src);
        continue;
      }

      // 6. Pillar of the Caged God & HoWA Attack Speed per Dexterity (PoE 1 & PoE 2 wordings)
      const mPillarPhys = line.match(
        /^(\d+)% increased (Physical )?Weapon Damage per (\d+) Strength$/i,
      );
      if (mPillarPhys) {
        const isPhysOnly = Boolean(mPillarPhys[2]);
        const val = Math.floor(str / Math.max(1, Number(mPillarPhys[3]))) * Number(mPillarPhys[1]);
        pillarPhysWeaponInc += val;
        const targetStat = isPhysOnly ? 'PhysicalDamage' : 'Damage';
        const hasCompositionalPerStr = getRawModsForStat(db, targetStat).some((m) =>
          m.tags?.some((t) => t.type === 'PerStat' && (t.stat === 'Str' || t.stat === 'Strength')),
        );
        if (
          val > 0 &&
          !hasCompositionalPerStr &&
          !hasPerAttrOrPerStatFromItem(['DamagePerAttr:Strength', 'MeleePhysicalDamagePerAttr:Strength', targetStat]) &&
          !hasStatSource(db, targetStat, 'INC', item.name, val)
        ) {
          db.addMod(mkMod(targetStat, 'INC', val, src, ModFlag.Attack));
        }
        appliedSources.push(src);
        continue;
      }
      const mAsPerDex = line.match(/^(\d+)% increased Attack Speed per (\d+) Dexterity$/i);
      if (mAsPerDex) {
        const val = Math.floor(dex / Math.max(1, Number(mAsPerDex[2]))) * Number(mAsPerDex[1]);
        if (lowerName.includes('pillar of the caged god')) {
          pillarAttackSpeedInc += val;
        } else {
          howaAttackSpeedInc += val;
        }
        if (
          val > 0 &&
          !hasPerAttrOrPerStatFromItem(['AttackSpeedPerAttr:Dexterity', 'Speed']) &&
          !hasStatSource(db, 'Speed', 'INC', item.name, val)
        ) {
          db.addMod(mkMod('Speed', 'INC', val, src, ModFlag.Attack));
        }
        appliedSources.push(src);
        continue;
      }
      const mAoePerInt = line.match(/^(\d+)% increased Area of Effect(?: for Attacks)? per (\d+) Intelligence$/i);
      if (mAoePerInt) {
        const val = Math.floor(int / Math.max(1, Number(mAoePerInt[2]))) * Number(mAoePerInt[1]);
        if (
          val > 0 &&
          !hasPerAttrOrPerStatFromItem(['AreaOfEffect']) &&
          !hasStatSource(db, 'AreaOfEffect', 'INC', item.name, val)
        ) {
          db.addMod(mkMod('AreaOfEffect', 'INC', val, src));
        }
        continue;
      }

      // 7. Rathpith Globe (PoE 1 & PoE 2 wordings)
      const mRathSpell = line.match(
        /^(\d+)% increased Spell Damage per (\d+) (?:Player )?Maximum Life$/i,
      );
      if (mRathSpell) {
        const val = Math.floor(life / Math.max(1, Number(mRathSpell[2]))) * Number(mRathSpell[1]);
        rathpithSpellDamageInc += val;
        if (
          val > 0 &&
          !hasPerAttrOrPerStatFromItem(['Damage']) &&
          !hasStatSource(db, 'Damage', 'INC', item.name, val)
        ) {
          db.addMod(mkMod('Damage', 'INC', val, src, ModFlag.Spell));
        }
        appliedSources.push(src);
        continue;
      }
      const mRathCrit = line.match(
        /^(\d+)% increased Critical (?:Strike|Hit) Chance for Spells per (\d+) (?:Player )?Maximum Life$/i,
      );
      if (mRathCrit) {
        const val = Math.floor(life / Math.max(1, Number(mRathCrit[2]))) * Number(mRathCrit[1]);
        rathpithSpellCritInc += val;
        if (
          val > 0 &&
          !hasPerAttrOrPerStatFromItem(['CritChance']) &&
          !hasStatSource(db, 'CritChance', 'INC', item.name, val)
        ) {
          db.addMod(mkMod('CritChance', 'INC', val, src, ModFlag.Spell));
        }
        appliedSources.push(src);
        continue;
      }

      // 8. Perseverance
      const mPersev = line.match(
        /^(\d+)% increased Attack Damage per (\d+) of the lowest of Armour and Evasion Rating$/i,
      );
      if (mPersev) {
        const lowest = Math.max(0, Math.min(armour, evasion));
        const val = Math.floor(lowest / Math.max(1, Number(mPersev[2]))) * Number(mPersev[1]);
        perseveranceAttackInc += val;
        if (
          val > 0 &&
          !hasPerAttrOrPerStatFromItem(['Damage']) &&
          !hasStatSource(db, 'Damage', 'INC', item.name, val)
        ) {
          db.addMod(mkMod('Damage', 'INC', val, src, ModFlag.Attack));
        }
        appliedSources.push(src);
        continue;
      }
      if (/^You have Onslaught while (?:you have Fortify|Fortified)$/i.test(line)) {
        if (ctx.fortified) {
          perseveranceGrantedOnslaught = true;
          if (!hasStatSource(db, 'MovementSpeed', 'INC', 'Onslaught')) {
            db.addMod(mkMod('Speed', 'INC', 20, `${src} (Onslaught)`, ModFlag.Attack));
            db.addMod(mkMod('Speed', 'INC', 20, `${src} (Onslaught)`, ModFlag.Spell));
            db.addMod(mkMod('MovementSpeed', 'INC', 20, `${src} (Onslaught)`));
          }
          appliedSources.push(`${src} (Onslaught)`);
        }
        continue;
      }

      // 9. Ephemeral Edge
      const mEphemeral = line.match(
        /^Attacks with this Weapon have Added Maximum Lightning Damage equal to (\d+(?:\.\d+)?)% of Player'?s Maximum Energy Shield$/i,
      );
      if (mEphemeral) {
        const pct = Number(mEphemeral[1]);
        const addedMax = Math.round((Math.max(0, energyShield) * pct) / 100);
        ephemeralEdgeLightningMax += addedMax;
        if (addedMax > 0 && !hasStatSource(db, 'LightningMax', 'BASE', item.name, addedMax)) {
          db.addMod(mkMod('LightningMax', 'BASE', addedMax, src, ModFlag.Attack));
        }
        appliedSources.push(src);
        continue;
      }

      // 10. Doryani's Prototype enemy Lightning Resistance sync (PoE 1 & PoE 2 wording)
      if (/^(?:Nearby Enemies|Enemies in your Presence) have Lightning Resistance equal to yours$/i.test(line)) {
        if (ctx.playerLightningResist !== undefined) {
          const synced = Math.max(-200, Math.round(ctx.playerLightningResist));
          enemyLightningResistOverride = synced;
          db.addMod(mkMod('DoryanisPrototype', 'FLAG', true, src));
          db.addMod(mkMod('EnemyLightningResist', 'OVERRIDE', synced, src));
          db.addMod(mkMod('EnemyLightningResistOverride', 'OVERRIDE', synced, src));
          appliedSources.push(src);
        }
        continue;
      }

      // 11. Mind of the Council ("Attack Skills have Added Lightning Damage equal to N% of maximum Mana")
      const mMindCouncil = line.match(
        /^Attack Skills have Added Lightning Damage equal to (\d+(?:\.\d+)?)% of maximum Mana$/i,
      );
      if (mMindCouncil) {
        const pct = Number(mMindCouncil[1]);
        const added = Math.round((Math.max(0, mana) * pct) / 100);
        if (added > 0 && !hasStatSource(db, 'LightningMin', 'BASE', src, added)) {
          db.addMod(mkMod('LightningMin', 'BASE', added, src, ModFlag.Attack));
          db.addMod(mkMod('LightningMax', 'BASE', added, src, ModFlag.Attack));
          appliedSources.push(src);
        }
        continue;
      }

      // 12. Nebulis (Elemental Damage per 1% Fire/Cold/Lightning Resistance above 75%, & classic Cold/Lightning variant)
      const hasPerStatResOver75 =
        db.getEvalContext().stats.FireResistOver75 !== undefined ||
        db.getEvalContext().stats.ColdResistOver75 !== undefined ||
        db.getEvalContext().stats.LightningResistOver75 !== undefined;
      const mNebulisEle = line.match(
        /^(\d+)% increased Elemental Damage per 1% Fire, Cold, or Lightning Resistance above 75%$/i,
      );
      if (mNebulisEle) {
        const alreadyParsedNebulis =
          hasPerStatResOver75 &&
          getRawModsForStat(db, 'ElementalDamage').some((m) =>
            m.tags?.some((t) => t.type === 'PerStat' && /ResistOver75$/.test(t.stat)),
          );
        const perPct = Number(mNebulisEle[1]);
        const steps =
          Math.max(0, getCappedPlayerEleResist('Fire') - 75) +
          Math.max(0, getCappedPlayerEleResist('Cold') - 75) +
          Math.max(0, getCappedPlayerEleResist('Lightning') - 75);
        const bonus = steps * perPct;
        if (!alreadyParsedNebulis && bonus > 0 && !hasStatSource(db, 'ElementalDamage', 'INC', src, bonus)) {
          db.addMod(mkMod('ElementalDamage', 'INC', bonus, src));
          appliedSources.push(src);
        }
        continue;
      }
      const mNebulisSingle = line.match(
        /^(\d+)% increased (Fire|Cold|Lightning) Damage per 1% (Fire|Cold|Lightning) Resistance above 75%$/i,
      );
      if (mNebulisSingle) {
        const perPct = Number(mNebulisSingle[1]);
        const dmgElem = mNebulisSingle[2]! as 'Fire' | 'Cold' | 'Lightning';
        const resElem = mNebulisSingle[3]! as 'Fire' | 'Cold' | 'Lightning';
        const steps = Math.max(0, getCappedPlayerEleResist(resElem) - 75);
        const bonus = steps * perPct;
        const statName = `${dmgElem}Damage`;
        const alreadyParsedSingle =
          hasPerStatResOver75 &&
          getRawModsForStat(db, statName).some((m) =>
            m.tags?.some((t) => t.type === 'PerStat' && t.stat === `${resElem}ResistOver75`),
          );
        if (!alreadyParsedSingle && bonus > 0 && !hasStatSource(db, statName, 'INC', src, bonus)) {
          db.addMod(mkMod(statName, 'INC', bonus, src));
          appliedSources.push(src);
        }
        continue;
      }

      // 13. Enmity's Embrace fallback (if parseModLines didn't emit FirePenetration per overcapped Fire Res)
      const mEnmity = line.match(
        /^(?:Fire )?Damage Penetrates (\d+)% Fire Resistance per (\d+)% Overcapped Fire Resistance(?:, up to a maximum of (\d+)%)?$/i,
      );
      if (mEnmity) {
        const alreadyFromItem = getRawModsForStat(db, 'FirePenetration').some((m) =>
          m.source.toLowerCase().includes(lowerName),
        );
        if (!alreadyFromItem) {
          const per = Number(mEnmity[1]);
          const step = Math.max(1, Number(mEnmity[2]));
          const cap = mEnmity[3] ? Number(mEnmity[3]) : 200;
          const stats = db.getEvalContext().stats;
          const overcap = Math.max(0, stats.FireResistOverCap ?? stats.OvercappedFireResist ?? 0);
          const pen = Math.min(cap, Math.floor(overcap / step) * per);
          if (pen > 0) {
            db.addMod(mkMod('FirePenetration', 'BASE', pen, src));
            appliedSources.push(src);
          }
        }
        continue;
      }

      // 14. The Taming wrapped-line fallback ("N% increased Elemental Damage with Hits and Ailments for each type of Elemental Ailment on Enemy")
      const mTaming = line.match(
        /^(\d+)% increased Elemental Damage with Hits and Ailments for each type of Elemental Ailment on Enemy$/i,
      );
      if (mTaming) {
        const alreadyFromItem = getRawModsForStat(db, 'ElementalDamage').some((m) =>
          m.source.toLowerCase().includes(lowerName),
        );
        if (!alreadyFromItem) {
          const conds = db.getEvalContext().conditions;
          let eleAilmentCount = 0;
          for (const key of [
            'EnemyIgnited',
            'EnemyChilled',
            'EnemyFrozen',
            'EnemyShocked',
            'EnemyScorched',
            'EnemyBrittle',
            'EnemySapped',
          ]) {
            if (conds[key]) eleAilmentCount += 1;
          }
          const bonus = Number(mTaming[1]) * eleAilmentCount;
          if (bonus > 0) {
            db.addMod(mkMod('ElementalDamage', 'INC', bonus, src, ModFlag.Hit));
            db.addMod(mkMod('ElementalDamage', 'INC', bonus, src, ModFlag.Ailment));
            appliedSources.push(src);
          }
        }
        continue;
      }

      // 15. Elevated / Hunter Boots Tailwind & Tailwind Effect (reconciles with buffTailwind so no double-counting)
      const mTailwindEff = line.match(/^(\d+)% increased Effect of Tailwind on you$/i);
      if (mTailwindEff) {
        const effPct = Number(mTailwindEff[1]);
        const hasTailwindAlready = hasStatSource(db, 'ActionSpeed', 'INC', 'Tailwind');
        const extra = Math.floor((8 * effPct) / 100 + 1e-9);
        if (
          hasTailwindAlready &&
          extra > 0 &&
          !hasStatSource(db, 'ActionSpeed', 'INC', `${src} (Tailwind)`) &&
          !hasStatSource(db, 'ActionSpeed', 'INC', `${src} (Tailwind Effect)`)
        ) {
          db.addMod(mkMod('ActionSpeed', 'INC', extra, `${src} (Tailwind Effect)`));
          appliedSources.push(`${src} (Tailwind Effect)`);
        }
        continue;
      }
      if (/^You have Tailwind if you have dealt a Critical Strike Recently$/i.test(line)) {
        if (
          db.getEvalContext().conditions.CritRecently &&
          !hasStatSource(db, 'ActionSpeed', 'INC', 'Tailwind')
        ) {
          let localTwEff = 0;
          for (const l2 of lines) {
            const mEff = l2.match(/^(\d+)% increased Effect of Tailwind on you$/i);
            if (mEff) localTwEff += Number(mEff[1]);
          }
          const twVal = Math.floor(8 * (1 + localTwEff / 100) + 1e-9);
          db.addMod(mkMod('ActionSpeed', 'INC', twVal, `${src} (Tailwind)`));
          db.setCondition('Tailwind', true);
          appliedSources.push(`${src} (Tailwind)`);
        }
        continue;
      }

      // 16. Wilma's Requital ("Increases and Reductions to Cast Speed apply to Attack Speed")
      if (/^Increases and Reductions to Cast Speed apply to Attack Speed$/i.test(line)) {
        if (!hasStatSource(db, 'Speed', 'INC', "Wilma's Requital")) {
          const castSpeedMods = getRawModsForStat(db, 'Speed').filter(
            (m) =>
              m.type === 'INC' &&
              typeof m.value === 'number' &&
              (m.flags & ModFlag.Spell) !== 0 &&
              (m.flags & ModFlag.Attack) === 0,
          );
          for (const cm of castSpeedMods) {
            db.addMod({
              ...cm,
              flags: (cm.flags & ~ModFlag.Spell) | ModFlag.Attack,
              source: `${cm.source} (Wilma's Requital)`,
            });
          }
          if (castSpeedMods.length > 0) {
            appliedSources.push(`${src} (Wilma's Requital)`);
          }
        }
        continue;
      }
    }

    // Kalandra's Touch reflection for post-pool ring uniques (e.g. The Taming wrapped line, Enmity's Embrace)
    if (isKalandrasTouch(item) && (slot === 'Ring 1' || slot === 'Ring 2')) {
      const oppSlot = slot === 'Ring 1' ? 'Ring 2' : 'Ring 1';
      const oppEntry = ctx.equippedItems.find((e) => e.slot === oppSlot);
      if (oppEntry && !isKalandrasTouch(oppEntry.item)) {
        const oppLines = joinWrappedItemLines(collectCleanItemLines(oppEntry.item));
        const refSrc = `Item (${slot}): Kalandra's Touch (Reflected ${oppEntry.item.name})`;
        for (const rLine of oppLines) {
          const mTamingRef = rLine.match(
            /^(\d+)% increased Elemental Damage with Hits and Ailments for each type of Elemental Ailment on Enemy$/i,
          );
          if (mTamingRef && !hasStatSource(db, 'ElementalDamage', 'INC', refSrc)) {
            const conds = db.getEvalContext().conditions;
            let eleAilmentCount = 0;
            for (const key of [
              'EnemyIgnited',
              'EnemyChilled',
              'EnemyFrozen',
              'EnemyShocked',
              'EnemyScorched',
              'EnemyBrittle',
              'EnemySapped',
            ]) {
              if (conds[key]) eleAilmentCount += 1;
            }
            const bonus = Number(mTamingRef[1]) * eleAilmentCount;
            if (bonus > 0) {
              db.addMod(mkMod('ElementalDamage', 'INC', bonus, refSrc, ModFlag.Hit));
              db.addMod(mkMod('ElementalDamage', 'INC', bonus, refSrc, ModFlag.Ailment));
              appliedSources.push(refSrc);
            }
          }
        }
      }
    }

    // Fallback: Replica Alberon's Warpath non-chaos lockout if named without explicit lockout line
    if (lowerName === "replica alberon's warpath" && !db.flag('DealNoPhysical')) {
      db.addMod(mkMod('DealNoPhysical', 'FLAG', true, src));
      db.addMod(mkMod('DealNoFire', 'FLAG', true, src));
      db.addMod(mkMod('DealNoCold', 'FLAG', true, src));
      db.addMod(mkMod('DealNoLightning', 'FLAG', true, src));
    }
  }

  // Doryani's Prototype flag already set in Pre-Stat phase
  if (
    enemyLightningResistOverride === null &&
    db.flag('DoryanisPrototype') &&
    ctx.playerLightningResist !== undefined
  ) {
    const synced = Math.max(-200, Math.round(ctx.playerLightningResist));
    enemyLightningResistOverride = synced;
    db.addMod(mkMod('EnemyLightningResist', 'OVERRIDE', synced, "Unique: Doryani's Prototype"));
    db.addMod(mkMod('EnemyLightningResistOverride', 'OVERRIDE', synced, "Unique: Doryani's Prototype"));
  }

  // 11. Energy Blade buff transformation (PoE 3.23+ exact PoB1 act_int.lua / CalcOffence.lua)
  const detectedEnergyBladeSkill = (ctx.activeSkills ?? []).find(
    (s) => s.enabled !== false && normalizeName(s.name) === 'energy blade',
  );
  const energyBladeActive = Boolean(ctx.energyBlade?.active || detectedEnergyBladeSkill);

  if (energyBladeActive) {
    const gemLevel = Math.max(
      1,
      Math.round(ctx.energyBlade?.gemLevel ?? detectedEnergyBladeSkill?.level ?? 20),
    );
    const gemQuality = Math.max(
      0,
      ctx.energyBlade?.gemQuality ?? detectedEnergyBladeSkill?.quality ?? 0,
    );
    const twoHanded = Boolean(
      ctx.energyBlade?.twoHanded ??
        ctx.isTwoHanded ??
        allEntries.some(
          (e) => (e.slot === 'Weapon 1' || e.slot === 'Weapon 1 Swap') && e.item.weaponStats?.twoHanded,
        ),
    );
    // PoE 3.23+ (act_int.lua:5118): always 50% less Maximum Energy Shield;
    // quality grants 0.5% increased Attack Speed per 1% quality instead of reducing ES penalty.
    const lessEsPct = 50;
    const src = `Skill: Energy Blade (Lv${gemLevel} Q${gemQuality})`;

    if (!hasStatSource(db, 'EnergyShield', 'MORE', 'Energy Blade')) {
      db.addMod(mkMod('EnergyShield', 'MORE', -lessEsPct, src));
    }

    const qualityAttackSpeedInc = Math.floor(gemQuality * 0.5 + 1e-9);
    if (qualityAttackSpeedInc > 0 && !hasStatSource(db, 'Speed', 'INC', 'Energy Blade')) {
      db.addMod(mkMod('Speed', 'INC', qualityAttackSpeedInc, src, ModFlag.Attack));
    }

    const postBladeEs = Math.max(0, Math.round(energyShield * (1 - lessEsPct / 100)));
    const [baseLightningMin, baseLightningMax] = getEnergyBladeBaseLightning(gemLevel);
    // ModStore.lua:571: PercentStat rounds up via math.ceil(value * stat * percent / 100)
    const esLightningMin = postBladeEs > 0 ? Math.ceil(2 * (postBladeEs * 0.01) - 1e-9) : 0;
    const esLightningMax = postBladeEs > 0 ? Math.ceil(40 * (postBladeEs * 0.01) - 1e-9) : 0;
    // act_int.lua:5121 & CalcOffence.lua:573,582-583: 70% more damage with Two-Handed Weapons
    const ebDmgInc = db.sum('INC', 'EnergyBladeDamage');
    const ebDmgMore = db.more('EnergyBladeDamage');
    const twoHandedMult =
      twoHanded && !hasStatSource(db, 'EnergyBladeDamage', 'MORE', 'Energy Blade') ? 1.7 : 1;
    const dmgMod = Math.max(0, (1 + ebDmgInc / 100) * ebDmgMore * twoHandedMult);
    const aps = twoHanded ? 1.6 : 1.7;
    const critChance = 7;
    const lightningMin = Math.floor((baseLightningMin + esLightningMin) * dmgMod + 1e-9);
    const lightningMax = Math.floor((baseLightningMax + esLightningMax) * dmgMod + 1e-9);

    energyBladeResult = {
      active: true,
      twoHanded,
      gemLevel,
      gemQuality,
      lessEsPct,
      postBladeEs,
      aps,
      critChance,
      lightningMin,
      lightningMax,
      weaponStats: {
        physicalMin: 0,
        physicalMax: 0,
        elementalDamage: { Lightning: [lightningMin, lightningMax] },
        attacksPerSecond: aps,
        critChance,
        weaponType: 'Sword',
        twoHanded,
      },
    };
    appliedSources.push(src);
  }

  return {
    crownOfEyesAttackInc,
    ironFortressBlockBonus,
    ironFortressExtraMeleePhysInc,
    replicaAlberonsChaosMin,
    replicaAlberonsChaosMax,
    howaLightningMin,
    howaLightningMax,
    howaAttackSpeedInc,
    brutusFireMin,
    brutusFireMax,
    pillarPhysWeaponInc,
    pillarAttackSpeedInc,
    rathpithSpellDamageInc,
    rathpithSpellCritInc,
    perseveranceAttackInc,
    perseveranceGrantedOnslaught,
    ephemeralEdgeLightningMax,
    energyBlade: energyBladeResult,
    enemyLightningResistOverride,
    appliedSources,
  };
}

export interface BuildEnablingUniquesContext extends PreStatUniqueContext {
  postPool?: Omit<PostPoolUniqueContext, 'db' | 'equippedItems' | 'socketedJewels'>;
}

export interface BuildEnablingUniquesResult {
  preStat: PreStatUniqueResult;
  postPool: PostPoolUniqueResult | null;
}

/**
 * Convenience entry point running Phase A (pre-attribute/pre-pool) and, when resolved pools
 * are provided via `ctx.postPool`, Phase B (post-attribute/post-pool) build-enabling uniques.
 */
export function evaluateBuildEnablingUniques(
  ctx: BuildEnablingUniquesContext,
): BuildEnablingUniquesResult {
  const preStat = evaluatePreStatBuildEnablingUniques(ctx);
  const postPool = ctx.postPool
    ? evaluatePostPoolBuildEnablingUniques({
        db: ctx.db,
        equippedItems: ctx.equippedItems,
        socketedJewels: ctx.socketedJewels,
        ...ctx.postPool,
      })
    : null;
  return { preStat, postPool };
}

// ============================================================================
// 5. Pool-Conversion Keystones & `Faithguard`
// ============================================================================

export interface PoolConversionContext {
  game: GameId;
  db: ModDB;
  allocatedNodes?: readonly PassiveNode[];
  equippedItems?: ReadonlyArray<EquippedItemEntry>;
  socketedJewels?: readonly Item[];
  /** Optional Dexterity value (ensures Dexterity grants 0% Evasion INC under Iron Reflexes). */
  dex?: number;
}

export interface PoolConversionResult {
  poe2EldritchBattery: boolean;
  convertedEsToManaBase: number;
  chaosInoculation: boolean;
  ironReflexes: boolean;
  convertedEvasionToArmour: number;
  evasionOnlyIncPct: number;
  faithguard: boolean;
  faithguardRedirectedIncPct: number;
  resolvedPools: {
    life: number;
    mana: number;
    energyShield: number;
    armour: number;
    evasion: number;
    ward: number;
    chaosResist: number;
    chaosResistMax: number;
  };
  appliedRules: string[];
}

/**
 * Applies pool-conversion keystones and unique defence redirection rules to `db`:
 * - **PoE 2 `Eldritch Battery`**: Converts base flat Energy Shield into base flat Mana (ES INC
 *   does NOT scale converted ES; Mana INC scales it) and zeroes final Energy Shield (`0`).
 *   (No-op for ES->Mana conversion in PoE 1.)
 * - **`Chaos Inoculation` (CI)**: Sets `Life = 1`, `ChaosResist = 100`, `ChaosResistMax = 100`.
 * - **`Iron Reflexes`**: Converts flat Evasion Rating into Armour scaled once by Armour +
 *   non-hybrid Evasion INC (never double-counting hybrid `Armour and Evasion` INC, and Dexterity
 *   grants `0%` Evasion INC), setting final `Evasion = 0`.
 * - **`Faithguard`**: Redirects net `EnergyShield` INC to `Ward` INC and computes `EnergyShield`
 *   with `0%` INC.
 */
export function applyPoolConversionsAndKeystones(
  ctx: PoolConversionContext,
): PoolConversionResult {
  const { game, db } = ctx;
  const allocatedNodes = ctx.allocatedNodes ?? [];
  const equippedItems = ctx.equippedItems ?? [];
  const socketedJewels = ctx.socketedJewels ?? [];

  const nodeNames = new Set<string>();
  const itemNames = new Set<string>();
  const allLines: string[] = [];

  for (const node of allocatedNodes) {
    if (node?.name?.en) nodeNames.add(normalizeName(node.name.en));
    for (const raw of node?.stats ?? []) {
      for (const part of raw.split(/\r?\n/)) {
        const c = cleanModLine(part);
        if (c) allLines.push(c);
      }
    }
  }
  for (const { item } of equippedItems) {
    if (!item) continue;
    itemNames.add(normalizeName(item.name));
    allLines.push(...collectCleanItemLines(item));
  }
  for (const jewel of socketedJewels) {
    if (!jewel) continue;
    itemNames.add(normalizeName(jewel.name));
    allLines.push(...collectCleanItemLines(jewel));
  }

  const hasNode = (name: string) => nodeNames.has(name.toLowerCase());
  const hasItem = (name: string) => itemNames.has(name.toLowerCase());
  const hasLine = (re: RegExp) => allLines.some((l) => re.test(l));

  const appliedRules: string[] = [];

  // 1. PoE 2 Eldritch Battery (NEVER converts/zeroes ES in PoE 1)
  let poe2EldritchBattery = false;
  let convertedEsToManaBase = 0;

  if (
    game === 'poe2' &&
    (hasNode('eldritch battery') ||
      hasLine(/^Converts all Energy Shield to Mana$/i) ||
      hasLine(/^Convert \d+% of maximum Energy Shield to maximum Mana$/i) ||
      db.flag('Poe2EldritchBattery'))
  ) {
    poe2EldritchBattery = true;
    const src = 'Keystone: Eldritch Battery (PoE 2)';
    if (!db.flag('Poe2EldritchBatteryApplied')) {
      let convPct = 100;
      for (const line of allLines) {
        const m = line.match(/^Convert (\d+)% of maximum Energy Shield to maximum Mana$/i);
        if (m) {
          convPct = Number(m[1]);
          break;
        }
      }
      const baseEs = Math.max(0, db.calcStat('EnergyShield').base);
      convertedEsToManaBase = Math.round((baseEs * convPct) / 100);
      if (convertedEsToManaBase > 0) {
        db.addMod(mkMod('Mana', 'BASE', convertedEsToManaBase, src));
        db.addMod(mkMod('EnergyShield', 'BASE', -convertedEsToManaBase, src));
      }
      db.addMod(mkMod('Poe2EldritchBattery', 'FLAG', true, src));
      db.addMod(mkMod('Poe2EldritchBatteryApplied', 'FLAG', true, src));
    }
    appliedRules.push('PoE2:EldritchBattery');
  } else if (game === 'poe1' && (hasNode('eldritch battery') || hasLine(/^Energy Shield protects Mana instead of Life$/i))) {
    if (!db.flag('EldritchBattery')) {
      db.addMod(mkMod('EldritchBattery', 'FLAG', true, 'Keystone: Eldritch Battery (PoE 1)'));
    }
    appliedRules.push('PoE1:EldritchBattery');
  }

  // 2. Chaos Inoculation (CI): Life = 1, ChaosResist = 100%, ChaosResistMax = 100%
  const chaosInoculation =
    hasNode('chaos inoculation') ||
    hasLine(/Maximum Life (?:becomes|is) 1/i) ||
    db.flag('ChaosInoculation') ||
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
    if (db.override('ChaosResist') !== 100) {
      db.addMod(mkMod('ChaosResist', 'OVERRIDE', 100, src));
    }
    if (db.override('ChaosResistMax') !== 100) {
      db.addMod(mkMod('ChaosResistMax', 'OVERRIDE', 100, src));
    }
    appliedRules.push('ChaosInoculation');
  }

  // 3. Faithguard: redirect net EnergyShield INC to Ward INC, compute ES with 0% INC
  const faithguard =
    hasItem('faithguard') ||
    hasLine(/^Increases and Reductions to Maximum Energy Shield instead apply to Ward$/i) ||
    db.flag('Faithguard');
  let faithguardRedirectedIncPct = 0;

  if (faithguard) {
    const src = 'Unique: Faithguard';
    if (!db.flag('FaithguardApplied')) {
      const netEsInc = db.sum('INC', 'EnergyShield');
      faithguardRedirectedIncPct = netEsInc;
      if (netEsInc !== 0) {
        db.addMod(mkMod('Ward', 'INC', netEsInc, src));
        db.addMod(mkMod('EnergyShield', 'INC', -netEsInc, src));
      }
      db.addMod(mkMod('Faithguard', 'FLAG', true, src));
      db.addMod(mkMod('FaithguardApplied', 'FLAG', true, src));
    }
    appliedRules.push('Faithguard');
  }

  // 4. Iron Reflexes: convert flat Evasion -> Armour without double-counting hybrid Armour+Evasion INC,
  //    Dexterity grants 0% Evasion INC, and final Evasion = 0.
  const ironReflexes =
    hasNode('iron reflexes') ||
    hasLine(/^Converts all Evasion Rating to Armour/i) ||
    db.flag('IronReflexes');
  let convertedEvasionToArmour = 0;
  let evasionOnlyIncPct = 0;

  if (ironReflexes) {
    const src = 'Keystone: Iron Reflexes';
    if (!db.flag('IronReflexes')) {
      db.addMod(mkMod('IronReflexes', 'FLAG', true, src));
    }
    if (!db.flag('IronReflexesApplied')) {
      const armourEval = db.calcStat('Armour');
      const evasionEval = db.calcStat('Evasion');

      // Build multiset of Armour INC and MORE sources so hybrid "Armour and Evasion" mods
      // (identical source + value on both Armour and Evasion) are never double-counted.
      const armourIncCounts = new Map<string, number>();
      const armourMoreCounts = new Map<string, number>();
      for (const s of armourEval.sources) {
        if (typeof s.value !== 'number') continue;
        const key = `${s.source}\0${s.value}`;
        if (s.type === 'INC') {
          armourIncCounts.set(key, (armourIncCounts.get(key) ?? 0) + 1);
        } else if (s.type === 'MORE') {
          armourMoreCounts.set(key, (armourMoreCounts.get(key) ?? 0) + 1);
        }
      }

      let evaOnlyInc = 0;
      let evaOnlyMoreMult = 1;
      for (const s of evasionEval.sources) {
        if (typeof s.value !== 'number') continue;
        // Dexterity grants 0% Evasion INC under Iron Reflexes
        if (s.type === 'INC' && /^Dexterity\b/i.test(s.source)) {
          continue;
        }
        const key = `${s.source}\0${s.value}`;
        if (s.type === 'INC') {
          const remaining = armourIncCounts.get(key) ?? 0;
          if (remaining > 0) {
            armourIncCounts.set(key, remaining - 1);
          } else {
            evaOnlyInc += s.value;
          }
        } else if (s.type === 'MORE') {
          const remaining = armourMoreCounts.get(key) ?? 0;
          if (remaining > 0) {
            armourMoreCounts.set(key, remaining - 1);
          } else {
            evaOnlyMoreMult *= 1 + s.value / 100;
          }
        }
      }

      evaOnlyMoreMult = Math.max(0, evaOnlyMoreMult);
      evasionOnlyIncPct = evaOnlyInc;

      const combinedIncPct = armourEval.incPct + evaOnlyInc;
      convertedEvasionToArmour = Math.round(
        Math.max(0, evasionEval.base) *
          Math.max(0, 1 + combinedIncPct / 100) *
          armourEval.moreMultiplier *
          evaOnlyMoreMult,
      );
      const finalArmour = Math.round(armourEval.total) + convertedEvasionToArmour;

      db.addMod(mkMod('Armour', 'OVERRIDE', finalArmour, src));
      db.addMod(mkMod('Evasion', 'OVERRIDE', 0, src));
      db.addMod(mkMod('IronReflexesApplied', 'FLAG', true, src));
    }
    appliedRules.push('IronReflexes');
  }

  const finalLife = Math.round(db.calcStat('Life').total);
  const finalMana = Math.round(db.calcStat('Mana').total);
  const finalEs = Math.round(db.calcStat('EnergyShield').total);
  const finalArmour = Math.round(db.calcStat('Armour').total);
  const finalEvasion = Math.round(db.calcStat('Evasion').total);
  const finalWard = Math.round(db.calcStat('Ward').total);
  const finalChaosResMax =
    db.override('ChaosResistMax') ?? Math.round(db.sum('BASE', 'ChaosResistMax'));
  const finalChaosRes =
    db.override('ChaosResist') ??
    Math.min(finalChaosResMax || 75, Math.round(db.sum('BASE', 'ChaosResist')));

  return {
    poe2EldritchBattery,
    convertedEsToManaBase,
    chaosInoculation,
    ironReflexes,
    convertedEvasionToArmour,
    evasionOnlyIncPct,
    faithguard,
    faithguardRedirectedIncPct,
    resolvedPools: {
      life: finalLife,
      mana: finalMana,
      energyShield: finalEs,
      armour: finalArmour,
      evasion: finalEvasion,
      ward: finalWard,
      chaosResist: finalChaosRes,
      chaosResistMax: finalChaosResMax,
    },
    appliedRules,
  };
}
