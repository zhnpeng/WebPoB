import type { Build, EquipmentSlotId, GameId, Item } from '@webpob/core';
import { normalizeStatLineToEn } from '@webpob/i18n';
import type { ModDB } from './modDb.js';
import { parseModLines } from './modParser.js';

/**
 * Extra equipment socket slots beyond standard `EquipmentSlotId`:
 * - PoE 1 Abyssal Sockets (Stygian Vise, Darkness Enthroned, Shroud of the Lightless, Bubonic Trail, etc.)
 * - PoE 2 0.5 Grafted Limbs (`Arm 1/2`, `Leg 1/2`)
 * - PoE 2 0.5 Equipment Jewel Sockets (`Gloves/Helmet/Boots/Body Armour Jewel Socket N`)
 */
export type ExtraEquipmentSlotId =
  | 'Belt Abyssal Socket 1'
  | 'Belt Abyssal Socket 2'
  | 'Body Armour Abyssal Socket 1'
  | 'Body Armour Abyssal Socket 2'
  | 'Body Armour Abyssal Socket 3'
  | 'Boots Abyssal Socket 1'
  | 'Boots Abyssal Socket 2'
  | 'Gloves Abyssal Socket 1'
  | 'Gloves Abyssal Socket 2'
  | 'Helmet Abyssal Socket 1'
  | 'Helmet Abyssal Socket 2'
  | 'Weapon 1 Abyssal Socket 1'
  | 'Weapon 1 Abyssal Socket 2'
  | 'Weapon 2 Abyssal Socket 1'
  | 'Weapon 2 Abyssal Socket 2'
  | 'Arm 1'
  | 'Arm 2'
  | 'Leg 1'
  | 'Leg 2'
  | 'Gloves Jewel Socket 1'
  | 'Helmet Jewel Socket 1'
  | 'Boots Jewel Socket 1'
  | 'Body Armour Jewel Socket 1'
  | 'Body Armour Jewel Socket 2';

/**
 * Complete canonical PoE 1 Utility Flask base buff table (matching official PoB1 `Data/Bases/flask.lua`),
 * plus `Progenesis` special unique entry.
 */
export const FULL_UTILITY_FLASK_BUFFS: Record<string, readonly string[]> = {
  'Granite Flask': ['+1500 to Armour'],
  'Jade Flask': ['+1500 to Evasion Rating'],
  'Quicksilver Flask': ['40% increased Movement Speed'],
  'Silver Flask': ['Onslaught'],
  'Diamond Flask': ['100% increased Global Critical Strike Chance'],
  'Amethyst Flask': ['+35% to Chaos Resistance'],
  'Ruby Flask': ['+5% to maximum Fire Resistance', '+40% to Fire Resistance'],
  'Sapphire Flask': ['+5% to maximum Cold Resistance', '+40% to Cold Resistance'],
  'Topaz Flask': ['+5% to maximum Lightning Resistance', '+40% to Lightning Resistance'],
  'Bismuth Flask': ['+35% to all Elemental Resistances'],
  'Quartz Flask': ['+10% chance to Suppress Spell Damage', 'Phasing'],
  'Sulphur Flask': ['40% increased Damage'],
  'Basalt Flask': ['20% more Armour'],
  'Stibnite Flask': ['20% more Evasion Rating'],
  'Aquamarine Flask': ['60% reduced Effect of Freeze on you'],
  'Corundum Flask': ['30% increased Stun Threshold'],
  'Gold Flask': ['+30% to Item Rarity'],
  'Iron Flask': ['+200 to Ward'],
  Progenesis: [
    '+35% to Chaos Resistance',
    '25% of Life loss from Damage taken occurs over 4 seconds instead',
  ],
};

const CANONICAL_UTILITY_FLASK_BASES: readonly string[] = [
  'Granite Flask',
  'Jade Flask',
  'Quicksilver Flask',
  'Silver Flask',
  'Diamond Flask',
  'Amethyst Flask',
  'Ruby Flask',
  'Sapphire Flask',
  'Topaz Flask',
  'Bismuth Flask',
  'Quartz Flask',
  'Sulphur Flask',
  'Basalt Flask',
  'Stibnite Flask',
  'Aquamarine Flask',
  'Corundum Flask',
  'Gold Flask',
  'Iron Flask',
];

const NON_UTILITY_FLASK_RE = /\b(?:Life|Mana|Hybrid)\s+Flask\b/i;

const FLASK_SLOTS: readonly EquipmentSlotId[] = [
  'Flask 1',
  'Flask 2',
  'Flask 3',
  'Flask 4',
  'Flask 5',
];

/**
 * Strip PoB XML metadata tags like `{enchant}`, `{crafted}`, `{fractured}`, `{range:0.5}`
 * and normalize localized lines to canonical English.
 */
function cleanModLine(raw: string): string {
  const stripped = raw
    .replace(/\{[^}]*\}/g, '')
    .trim();
  return normalizeStatLineToEn(stripped).trim();
}

/**
 * PoB-authentic integer truncation with IEEE-754 epsilon guard
 * (prevents e.g. `1.5 * 1.2 * 100 = 179.99999999999997` truncating to `179` instead of `180`).
 */
function truncPoB(n: number): number {
  return Math.trunc(n + Math.sign(n) * 1e-9);
}

/**
 * Scales every numeric token in a modifier line by `mult` using PoB integer truncation (`Math.trunc`),
 * preserving leading `+`/`-` signs and decimal precision only when `preserveDecimals` is true.
 */
export function scaleModLineByMultiplier(
  line: string,
  mult: number,
  preserveDecimals = false,
): string {
  if (!Number.isFinite(mult) || Math.abs(mult - 1) < 1e-9) return line;
  return line.replace(/([+-]?)(\d+(?:\.\d+)?)/g, (_match, sign: string, numStr: string) => {
    const raw = Number(numStr);
    const scaled = preserveDecimals
      ? truncPoB(raw * mult * 100) / 100
      : truncPoB(raw * mult);
    return `${sign}${scaled}`;
  });
}

/**
 * Computes a delta-only scaled line (i.e. `Math.trunc(val * totalMult) - val`) for adding
 * extra bonus magnitude on top of an item whose 1.0x base stats were already ingested.
 * Returns `null` if every numeric delta is 0.
 */
function buildDeltaScaledLine(line: string, totalMult: number): string | null {
  if (!Number.isFinite(totalMult) || totalMult <= 1) return null;
  let anyNonZero = false;
  const out = line.replace(/([+-]?)(\d+(?:\.\d+)?)/g, (_match, sign: string, numStr: string) => {
    const raw = Number(numStr);
    const totalVal = truncPoB(raw * totalMult);
    const delta = totalVal - raw;
    if (delta !== 0) anyNonZero = true;
    return `${sign}${delta}`;
  });
  return anyNonZero ? out : null;
}

/**
 * Matches ANY normal, magic (prefixed/suffixed), or unique flask item to its canonical
 * utility flask base name in `FULL_UTILITY_FLASK_BUFFS`.
 * Returns `null` for Life, Mana, Hybrid flasks, or non-flask items.
 */
export function resolveUtilityFlaskBaseName(item: Item): string | null {
  const baseText = (item.baseName ?? '').trim();
  const nameText = (item.name ?? '').trim();

  if (NON_UTILITY_FLASK_RE.test(baseText) || NON_UTILITY_FLASK_RE.test(nameText)) {
    return null;
  }

  const baseLower = baseText.toLowerCase();
  const nameLower = nameText.toLowerCase();

  for (const canonical of CANONICAL_UTILITY_FLASK_BASES) {
    const needle = canonical.toLowerCase();
    if (baseLower.includes(needle) || nameLower.includes(needle)) {
      return canonical;
    }
  }

  if (baseLower === 'progenesis' || nameLower === 'progenesis') {
    return 'Progenesis';
  }

  return null;
}

/**
 * Extracts local per-flask increased/reduced effect percentage from a flask's implicits & explicits
 * (e.g. Enkindling Orb `70% increased effect`, Alchemist's `25% increased effect`, or `X% reduced effect`).
 */
export function extractLocalFlaskEffectPct(item: Item): number {
  let localEffect = 0;
  for (const raw of [...item.implicits, ...item.explicits]) {
    const line = cleanModLine(raw);
    const mInc = line.match(/^(\d+)% increased effect(?: of Flask)?$/i);
    if (mInc) {
      localEffect += Number(mInc[1]);
      continue;
    }
    const mRed = line.match(/^(\d+)% reduced effect(?: of Flask)?$/i);
    if (mRed) {
      localEffect -= Number(mRed[1]);
    }
  }
  return localEffect;
}

const FLASK_META_LINE_RE =
  /^(?:(?:\d+)% (?:increased|reduced) (?:effect(?: of Flask)?|Duration|Charge Recovery|Charges per use|Charges used)|Used when Charges reach full|Gains no Charges during Effect|Reused at the end of this Flask's effect|Use when you (?:become|take|hit|start|use)|Gain \d+ Charges? when you are Hit|\d+% chance to gain a Flask Charge|Creates (?:Consecrated|Chilled) Ground on Use|Creates a Smoke Cloud on Use|Taunts Enemies|Restores Ward on use|Consecrated Ground created by this Flask|Inflicts Mana Burn every \d+(?:\.\d+)? Seconds?|\d+(?:\.\d+)? Second Cooldown when Deactivated)/i;

const RANGED_OR_OFFHAND_BASE_RE =
  /\b(?:bow|wand|horn|crossbow|quiver|shield|buckler|bundle|focus)\b/i;

/**
 * Returns true if the character currently has a Melee Weapon equipped in their active weapon set
 * (excludes Bows, Wands, Crossbows, Quivers, Shields, Focuses, and Unarmed).
 */
function hasEquippedMeleeWeapon(build: Build): boolean {
  const mainSlot: EquipmentSlotId = build.activeWeaponSet === 2 ? 'Weapon 1 Swap' : 'Weapon 1';
  const offSlot: EquipmentSlotId = build.activeWeaponSet === 2 ? 'Weapon 2 Swap' : 'Weapon 2';
  for (const slot of [mainSlot, offSlot]) {
    const itemId = build.equipped[slot];
    if (!itemId) continue;
    const item = build.items[itemId];
    if (!item) continue;
    const baseText = (item.baseName || item.name || '').trim();
    if (!baseText || RANGED_OR_OFFHAND_BASE_RE.test(baseText)) continue;
    return true;
  }
  return false;
}

/**
 * Normalizes PoE 1 Tincture weapon-coating lines when a Melee Weapon is equipped.
 * In official PoB 1 (`ModFlag.WeaponMelee`), Tincture modifiers apply to ALL attacks made
 * with a coated melee weapon — including projectile/area sub-parts such as `Lightning Strike`
 * projectiles, `Frost Blades` projectiles, `Smite` area, and `Molten Strike` balls, as well as
 * Bleeding/Ailments inflicted by melee weapon attacks (`Blood Sap Tincture`).
 * Mapping `with Melee Weapons` / `Melee Weapon ...` to Attack/Ailment scope prevents
 * `ModFlag.Melee` from falsely dropping Tincture buffs on non-melee parts of melee weapon skills.
 */
function normalizeTinctureWeaponLine(line: string, meleeWeaponEquipped: boolean): string {
  if (!meleeWeaponEquipped) return line;
  const mDotMulti = line.match(
    /^\+(\d+(?:\.\d+)?)% to Damage over Time Multiplier with Melee Weapon Attacks$/i,
  );
  if (mDotMulti) {
    return `+${mDotMulti[1]}% to Damage over Time Multiplier with Ailments`;
  }
  const mBleedDmg = line.match(
    /^(\d+(?:\.\d+)?)% increased Damage with Bleeding from Melee Weapons$/i,
  );
  if (mBleedDmg) {
    return `${mBleedDmg[1]}% increased Damage with Bleeding`;
  }
  const mPen = line.match(/^Melee Weapon Damage Penetrates (.+)$/i);
  if (mPen) {
    return `Attack Damage Penetrates ${mPen[1]}`;
  }
  const mAtkSpd = line.match(/^(\d+(?:\.\d+)?)% increased Melee Weapon Attack Speed$/i);
  if (mAtkSpd) {
    return `${mAtkSpd[1]}% increased Attack Speed`;
  }
  const mWithMeleeWeap = line.match(/^(.+)\s+with Melee Weapons$/i);
  if (mWithMeleeWeap) {
    return `${mWithMeleeWeap[1]} with Attacks`;
  }
  return line;
}

/**
 * Normalizes a flask explicit/implicit buff line so `parseModLines` can parse it cleanly
 * (e.g. `19% additional Elemental Resistances during Effect` -> `+19% to all Elemental Resistances`,
 * and strips trailing `during Effect`).
 */
function normalizeFlaskBuffLine(line: string): string {
  const mAddEleRes = line.match(/^(\d+)% additional Elemental Resistances(?: during Effect)?$/i);
  if (mAddEleRes) {
    return `+${mAddEleRes[1]}% to all Elemental Resistances`;
  }
  return line.replace(/\s+during Effect$/i, '').trim();
}

export interface EvaluatedFlaskEntry {
  slot: EquipmentSlotId;
  itemName: string;
  baseName: string | null;
  autoActivatedByMageblood: boolean;
  localEffectPct: number;
  totalEffectPct: number;
  effectMult: number;
  baseBuffLines: string[];
  explicitLines: string[];
  implicitLines: string[];
}

export interface ActiveFlaskEvaluation {
  modLines: string[];
  sources: string[];
  grantsOnslaught: boolean;
  grantsConsecratedGround: boolean;
  bottledFaithBaseCrit: number;
  progenesisDelayPct: number;
  activeSlots: EquipmentSlotId[];
  perFlask: EvaluatedFlaskEntry[];
}

/**
 * Detects PoE 1 Mageblood leftmost/rightmost Magic Utility Flask auto-activation counts
 * from equipped items (typically `Belt`).
 */
function detectPoe1MagebloodCounts(build: Build): { left: number; right: number } {
  let left = 0;
  let right = 0;
  const equippedMap = build.equipped as Record<string, string | undefined>;
  for (const itemId of Object.values(equippedMap)) {
    if (!itemId) continue;
    const item = build.items[itemId];
    if (!item) continue;
    for (const raw of [...item.implicits, ...item.explicits]) {
      const line = cleanModLine(raw);
      const mLeft = line.match(
        /^Leftmost (\d+) Magic Utility Flasks constantly apply their Flask Effects to you$/i,
      );
      if (mLeft) {
        left = Math.max(left, Number(mLeft[1]));
      }
      const mRight = line.match(
        /^Rightmost (\d+) Magic Utility Flasks constantly apply their Flask Effects to you$/i,
      );
      if (mRight) {
        right = Math.max(right, Number(mRight[1]));
      }
    }
  }
  return { left, right };
}

/**
 * Evaluates all active PoE 1 flasks, including:
 * - PoE 1 `Mageblood` auto-activation of the leftmost (or rightmost) N Magic Utility Flasks
 *   even when `build.activeFlaskSlots[slot]` is false/unset.
 * - Full Utility Flask base buff resolution for magic/normal/unique flasks.
 * - Local per-flask effect (`Enkindling Orb`, `Alchemist's`, `reduced effect`) + `globalFlaskEffectPct`
 *   scaling on BOTH base buffs and explicit flask modifiers using PoB integer truncation.
 * - Special unique flask effects (`Silver Flask` Onslaught, `Bottled Faith` Consecrated Ground & crit,
 *   `Progenesis` 25% delayed life loss).
 */
export function evaluateActiveFlasks(
  build: Build,
  globalFlaskEffectPct = 0,
  extraOptions?: {
    ironFlaskEffectPct?: number;
    tinctureEffectPct?: number;
    magicTinctureEffectPct?: number;
    /** Semantic flag from `DisableUtilityFlasks` / `UtilityFlasksDoNotApplyToPlayer` (e.g. PoE 1 Bloodline `Toad's Price`). */
    disableUtilityFlasks?: boolean;
  },
): ActiveFlaskEvaluation {
  // PoE 1 King in the Mists Bloodline `Toad's Price` (node 44903: "Utility Flasks are Disabled")
  const utilityFlasksDisabled = Boolean(
    extraOptions?.disableUtilityFlasks ||
      (build.game === 'poe1' && build.tree?.allocatedNodeIds?.includes(44903)),
  );
  const { left: magebloodLeft, right: magebloodRight } = detectPoe1MagebloodCounts(build);
  const meleeWeaponEquipped = hasEquippedMeleeWeapon(build);
  const mainGroup =
    build.skills.find((g) => g.id === build.mainSkillGroupId) ?? build.skills[0];
  const mainSkillIsVaal = Boolean(
    mainGroup?.gems.some(
      (g) => g.enabled !== false && /^poe[12]_vaal/i.test(g.gemId),
    ),
  );
  const enemyIsIgnited = Boolean(
    build.config?.rawInputs?.conditionEnemyIgnited ||
      (build.config as { enemyIgnited?: boolean } | undefined)?.enemyIgnited,
  );
  let grantedFlaskMalediction = false;

  // Identify magic utility flasks in slot order 1..5 for Mageblood auto-activation
  const magicUtilitySlots: EquipmentSlotId[] = [];
  for (const slot of FLASK_SLOTS) {
    const itemId = build.equipped[slot];
    if (!itemId) continue;
    const item = build.items[itemId];
    if (!item) continue;
    if (item.rarity === 'MAGIC' && resolveUtilityFlaskBaseName(item) !== null) {
      magicUtilitySlots.push(slot);
    }
  }

  const magebloodActiveSet = new Set<EquipmentSlotId>();
  if (!utilityFlasksDisabled && magebloodLeft > 0) {
    const count = Math.min(magebloodLeft, magicUtilitySlots.length);
    for (let i = 0; i < count; i++) {
      magebloodActiveSet.add(magicUtilitySlots[i]!);
    }
  }
  if (!utilityFlasksDisabled && magebloodRight > 0) {
    const count = Math.min(magebloodRight, magicUtilitySlots.length);
    for (let i = 0; i < count; i++) {
      magebloodActiveSet.add(magicUtilitySlots[magicUtilitySlots.length - 1 - i]!);
    }
  }

  const modLines: string[] = [];
  const sources: string[] = [];
  const activeSlots: EquipmentSlotId[] = [];
  const perFlask: EvaluatedFlaskEntry[] = [];
  let grantsOnslaught = false;
  let grantsConsecratedGround = false;
  let bottledFaithBaseCrit = 0;
  let progenesisDelayPct = 0;

  for (const slot of FLASK_SLOTS) {
    const itemId = build.equipped[slot];
    if (!itemId) continue;
    const item = build.items[itemId];
    if (!item) continue;

    const autoActivatedByMageblood = magebloodActiveSet.has(slot);
    const isActive = autoActivatedByMageblood || Boolean(build.activeFlaskSlots?.[slot]);
    if (!isActive) continue;

    const isTincture = /\btincture\b/i.test(item.baseName) || /\btincture\b/i.test(item.name);
    const baseName = isTincture ? null : resolveUtilityFlaskBaseName(item);
    if (utilityFlasksDisabled && baseName !== null) continue;

    activeSlots.push(slot);
    const localEffectPct = extractLocalFlaskEffectPct(item);
    const tinctureEffectInc = isTincture
      ? (extraOptions?.tinctureEffectPct ?? 0) +
        localEffectPct +
        (item.rarity === 'MAGIC' ? (extraOptions?.magicTinctureEffectPct ?? 0) : 0)
      : 0;
    // PoB1 CalcPerform.lua:1931-1938: Tincture quality multiplies (1 + tinctureEffectInc/100)
    // and truncates to 2 decimal places: floor((1 + effectInc/100) * (1 + quality/100) * 100) / 100
    const effectMult = isTincture
      ? Math.max(
          0,
          Math.floor(
            (1 + tinctureEffectInc / 100) * (1 + Math.max(0, item.quality) / 100) * 100 + 1e-9,
          ) / 100,
        )
      : Math.max(
          0,
          1 +
            (globalFlaskEffectPct +
              (baseName === 'Iron Flask' ? (extraOptions?.ironFlaskEffectPct ?? 0) : 0) +
              localEffectPct) /
              100,
        );
    const totalEffectPct = isTincture
      ? Math.round((effectMult - 1) * 100)
      : globalFlaskEffectPct +
        (baseName === 'Iron Flask' ? (extraOptions?.ironFlaskEffectPct ?? 0) : 0) +
        localEffectPct;
    const src = `Flask (${slot}): ${item.name}`;

    const baseBuffLines: string[] = [];
    const implicitLines: string[] = [];
    const explicitLines: string[] = [];

    if (baseName) {
      if (baseName === 'Silver Flask') {
        grantsOnslaught = true;
      }
      if (baseName === 'Sulphur Flask') {
        grantsConsecratedGround = true;
      }
      const rawBuffs = FULL_UTILITY_FLASK_BUFFS[baseName] ?? [];
      for (const buffLine of rawBuffs) {
        if (/^Onslaught$/i.test(buffLine)) {
          grantsOnslaught = true;
          baseBuffLines.push(buffLine);
          // Do NOT push raw 'Onslaught' into modLines — engine.ts injects
          // scaled Onslaught via flaskEval.grantsOnslaught & silverFlask.effectMult,
          // so emitting raw 'Onslaught' here double-counted +20% Attack/Cast/Move Speed.
          continue;
        }
        if (/^Phasing$/i.test(buffLine)) {
          baseBuffLines.push(buffLine);
          modLines.push(buffLine);
          sources.push(`${src} [Base]`);
          continue;
        }
        const scaled = scaleModLineByMultiplier(buffLine, effectMult);
        baseBuffLines.push(scaled);
        modLines.push(scaled);
        sources.push(`${src} [Base]`);
      }
    }

    const isBottledFaith = item.name.toLowerCase().includes('bottled faith');
    const isProgenesis = item.name.toLowerCase().includes('progenesis');
    if (isBottledFaith) {
      grantsConsecratedGround = true;
    }

    // Implicits (skip meta/enchant/effect lines; detect Consecrated Ground)
    for (const raw of item.implicits) {
      const line = cleanModLine(raw);
      if (!line) continue;
      if (/Creates Consecrated Ground on Use/i.test(line)) {
        grantsConsecratedGround = true;
        continue;
      }
      if (FLASK_META_LINE_RE.test(line)) continue;
      const normalizedBase = normalizeFlaskBuffLine(line);
      const normalized = isTincture
        ? normalizeTinctureWeaponLine(normalizedBase, meleeWeaponEquipped)
        : normalizedBase;
      if (/^Onslaught$/i.test(normalized)) {
        grantsOnslaught = true;
        implicitLines.push(normalized);
        continue;
      }
      const scaled = scaleModLineByMultiplier(normalized, effectMult);
      implicitLines.push(scaled);
      modLines.push(scaled);
      sources.push(`${src} [Implicit]`);
    }

    // Explicits
    let foundProgenesisLine = false;
    for (const raw of item.explicits) {
      const line = cleanModLine(raw);
      if (!line) continue;
      if (FLASK_META_LINE_RE.test(line)) continue;

      // Progenesis delayed life loss
      const mProg = line.match(
        /(\d+)% of Life loss from Damage taken occurs over \d+ seconds instead/i,
      );
      if (mProg) {
        foundProgenesisLine = true;
        progenesisDelayPct = Math.max(
          progenesisDelayPct,
          Math.trunc(Number(mProg[1]) * effectMult),
        );
        const scaledProg = `${Math.trunc(Number(mProg[1]) * effectMult)}% of Life loss from Damage taken occurs over 4 seconds instead`;
        explicitLines.push(scaledProg);
        modLines.push(scaledProg);
        sources.push(src);
        continue;
      }

      // Bottled Faith flat base crit (legacy variant)
      const mBfBaseCrit = line.match(
        /^\+(\d+(?:\.\d+)?)% to Critical Strike Chance against Enemies on Consecrated Ground(?: during Effect)?$/i,
      );
      if (mBfBaseCrit) {
        grantsConsecratedGround = true;
        const scaledCrit = truncPoB(Number(mBfBaseCrit[1]) * effectMult * 100) / 100;
        bottledFaithBaseCrit += scaledCrit;
        const outLine = `+${scaledCrit}% to Critical Strike Chance`;
        explicitLines.push(outLine);
        modLines.push(outLine);
        sources.push(src);
        continue;
      }

      // Bottled Faith % increased crit against enemies on Consecrated Ground (current variant)
      const mBfIncCrit = line.match(
        /^(\d+)% increased Critical Strike Chance against Enemies on Consecrated Ground(?: during Effect)?$/i,
      );
      if (mBfIncCrit) {
        grantsConsecratedGround = true;
        const scaledVal = Math.trunc(Number(mBfIncCrit[1]) * effectMult);
        const outLine = `${scaledVal}% increased Critical Strike Chance`;
        explicitLines.push(outLine);
        modLines.push(outLine);
        sources.push(src);
        continue;
      }

      // Bottled Faith Consecrated Ground increased damage taken (preserves DamageTakenConsecratedGround so ConsecratedGroundEffect scales it)
      const mBfDmgTaken = line.match(
        /^Consecrated Ground created during Effect applies (\d+)% increased Damage taken to Enemies$/i,
      );
      if (mBfDmgTaken) {
        grantsConsecratedGround = true;
        const scaledVal = Math.trunc(Number(mBfDmgTaken[1]) * effectMult + 1e-9);
        const outLine = `Consecrated Ground created during Effect applies ${scaledVal}% increased Damage taken to Enemies`;
        explicitLines.push(outLine);
        modLines.push(outLine);
        sources.push(src);
        continue;
      }

      // Cinderswallow Urn: Malediction (binary +10% enemy damage taken, unscaled by flask effect) & increased damage taken on Ignited enemies
      if (/^Enemies Ignited by you during Effect have Malediction$/i.test(line)) {
        if (enemyIsIgnited && !grantedFlaskMalediction) {
          grantedFlaskMalediction = true;
          const outLine = 'Enemies take 10% increased Damage';
          explicitLines.push(outLine);
          modLines.push(outLine);
          sources.push(`${src} (Malediction)`);
        }
        continue;
      }
      const mCinderTaken = line.match(
        /^Enemies Ignited by you during Effect take (\d+)% increased Damage$/i,
      );
      if (mCinderTaken) {
        if (enemyIsIgnited) {
          const scaledVal = Math.trunc(Number(mCinderTaken[1]) * effectMult + 1e-9);
          if (scaledVal > 0) {
            const outLine = `Enemies take ${scaledVal}% increased Damage`;
            explicitLines.push(outLine);
            modLines.push(outLine);
            sources.push(src);
          }
        }
        continue;
      }

      // Soul Catcher (and Vaal-scoped flask buffs): scale by effectMult and emit when main active skill is a Vaal skill
      const mVaalFlaskCrit = line.match(
        /^(\d+)% increased Critical Strike Chance with Vaal Skills(?: during Effect)?$/i,
      );
      if (mVaalFlaskCrit) {
        if (mainSkillIsVaal) {
          const scaledVal = Math.trunc(Number(mVaalFlaskCrit[1]) * effectMult + 1e-9);
          if (scaledVal > 0) {
            const outLine = `${scaledVal}% increased Critical Strike Chance`;
            explicitLines.push(outLine);
            modLines.push(outLine);
            sources.push(src);
          }
        }
        continue;
      }
      const mVaalFlaskDmg = line.match(
        /^(\d+)% increased Damage with Vaal Skills(?: during Effect)?$/i,
      );
      if (mVaalFlaskDmg) {
        if (mainSkillIsVaal) {
          const scaledVal = Math.trunc(Number(mVaalFlaskDmg[1]) * effectMult + 1e-9);
          if (scaledVal > 0) {
            const outLine = `${scaledVal}% increased Damage`;
            explicitLines.push(outLine);
            modLines.push(outLine);
            sources.push(src);
          }
        }
        continue;
      }

      const normalizedBase = normalizeFlaskBuffLine(line);
      const normalized = isTincture
        ? normalizeTinctureWeaponLine(normalizedBase, meleeWeaponEquipped)
        : normalizedBase;
      if (/^Onslaught$/i.test(normalized)) {
        grantsOnslaught = true;
        explicitLines.push(normalized);
        continue;
      }
      if (/Onslaught/i.test(line) && !/Effect of Onslaught/i.test(line)) {
        grantsOnslaught = true;
      }

      const scaled = scaleModLineByMultiplier(normalized, effectMult);
      explicitLines.push(scaled);
      modLines.push(scaled);
      sources.push(src);
    }

    if (isProgenesis && !foundProgenesisLine && baseName !== 'Progenesis') {
      progenesisDelayPct = Math.max(progenesisDelayPct, Math.trunc(25 * effectMult));
    }

    perFlask.push({
      slot,
      itemName: item.name,
      baseName,
      autoActivatedByMageblood,
      localEffectPct,
      totalEffectPct,
      effectMult,
      baseBuffLines,
      explicitLines,
      implicitLines,
    });
  }

  return {
    modLines,
    sources,
    grantsOnslaught,
    grantsConsecratedGround,
    bottledFaithBaseCrit,
    progenesisDelayPct,
    activeSlots,
    perFlask,
  };
}

/**
 * Official PoE 2 `Mageblood` Legacy base stat definitions (verified against upstream PoB2 `CalcPerform.lua`).
 */
interface Poe2LegacyEffect {
  template: (val: number) => string;
  baseValue: number;
}

const POE2_MAGEBLOOD_LEGACIES: Record<string, readonly Poe2LegacyEffect[]> = {
  amethyst: [{ template: (v) => `+${v}% to Chaos Resistance`, baseValue: 45 }],
  basalt: [{ template: (v) => `${v}% increased Armour`, baseValue: 150 }],
  bismuth: [{ template: (v) => `+${v}% to all Elemental Resistances`, baseValue: 45 }],
  diamond: [{ template: (v) => `${v}% increased Global Critical Strike Chance`, baseValue: 75 }],
  gold: [{ template: (v) => `${v}% increased Rarity of Items found`, baseValue: 45 }],
  granite: [{ template: (v) => `+${v} to Armour`, baseValue: 2000 }],
  jade: [{ template: (v) => `+${v} to Evasion Rating`, baseValue: 2000 }],
  quicksilver: [{ template: (v) => `${v}% increased Movement Speed`, baseValue: 30 }],
  ruby: [
    { template: (v) => `+${v}% to Fire Resistance`, baseValue: 60 },
    { template: (v) => `+${v}% to maximum Fire Resistance`, baseValue: 5 },
  ],
  sapphire: [
    { template: (v) => `+${v}% to Cold Resistance`, baseValue: 60 },
    { template: (v) => `+${v}% to maximum Cold Resistance`, baseValue: 5 },
  ],
  silver: [{ template: (v) => `${v}% increased Attack and Cast Speed`, baseValue: 30 }],
  stibnite: [{ template: (v) => `${v}% increased Evasion Rating`, baseValue: 150 }],
  sulphur: [{ template: (v) => `${v}% increased Damage`, baseValue: 60 }],
  topaz: [
    { template: (v) => `+${v}% to Lightning Resistance`, baseValue: 60 },
    { template: (v) => `+${v}% to maximum Lightning Resistance`, baseValue: 5 },
  ],
};

/**
 * Evaluates PoE 2 `Mageblood` `Legacy of <Type>` explicit modifiers and scales them by
 * `All Mage's Legacies have (N)% increased effect [per duplicate Mage's Legacy you have]`.
 *
 * Matches official PoB2 `CalcPerform.lua`:
 * - Counts occurrences of each distinct Legacy on the item.
 * - `totalDuplicates = sum(Math.max(0, count - 1))`.
 * - When `per duplicate` is present: `effectMult = 1 + totalDuplicates * (effPct / 100)`.
 * - When flat `All Mage's Legacies have N% increased effect` (without `per duplicate`) is present:
 *   `effectMult = 1 + effPct / 100`.
 * - Each distinct Legacy applies once with `Math.floor(baseValue * effectMult)`.
 */
export function evaluatePoe2MagebloodLegacies(item: Item): string[] {
  const legacyCounts = new Map<string, number>();
  let perDuplicateEffectPct = 0;
  let flatEffectPct = 0;

  for (const raw of [...item.implicits, ...item.explicits]) {
    const line = cleanModLine(raw);
    if (!line) continue;

    const mLegacy = line.match(
      /^Legacy of (Amethyst|Basalt|Bismuth|Diamond|Gold|Granite|Jade|Quicksilver|Ruby|Sapphire|Silver|Stibnite|Sulphur|Topaz)$/i,
    );
    if (mLegacy) {
      const key = mLegacy[1]!.toLowerCase();
      legacyCounts.set(key, (legacyCounts.get(key) ?? 0) + 1);
      continue;
    }

    const mPerDupe = line.match(
      /^All Mage's Legacies have (\d+)% increased effect per duplicate Mage's Legacy you have$/i,
    );
    if (mPerDupe) {
      perDuplicateEffectPct += Number(mPerDupe[1]);
      continue;
    }

    const mFlat = line.match(/^All Mage's Legacies have (\d+)% increased effect$/i);
    if (mFlat) {
      flatEffectPct += Number(mFlat[1]);
    }
  }

  if (legacyCounts.size === 0) return [];

  let totalDuplicates = 0;
  for (const stacks of legacyCounts.values()) {
    if (stacks > 1) {
      totalDuplicates += stacks - 1;
    }
  }

  const effectMult =
    1 + (totalDuplicates * perDuplicateEffectPct + flatEffectPct) / 100;

  const out: string[] = [];
  for (const key of legacyCounts.keys()) {
    const defs = POE2_MAGEBLOOD_LEGACIES[key];
    if (!defs) continue;
    for (const def of defs) {
      const scaled = Math.floor(def.baseValue * effectMult + 1e-9);
      out.push(def.template(scaled));
    }
  }

  return out;
}

const ABYSSAL_SOCKET_RE =
  /^(Belt|Body Armour|Boots|Gloves|Helmet|Weapon 1|Weapon 2|Weapon 1 Swap|Weapon 2 Swap) Abyssal Socket (\d+)$/i;
const GRAFTED_LIMB_RE = /^(Arm|Leg|Graft) (\d+)$/i;
const EQUIP_JEWEL_SOCKET_RE =
  /^(Gloves|Helmet|Boots|Body Armour|Belt|Weapon 1|Weapon 2|Weapon 1 Swap|Weapon 2 Swap) Jewel Socket (\d+)$/i;

/**
 * Extracts `(\d+)% increased Effect of Socketed (?:Abyss(?:al)? Jewels|Jewels|Items)` from a parent item
 * (e.g. `Darkness Enthroned` belt in PoE 1 & PoE 2).
 */
function extractSocketedAbyssalJewelEffectPct(item: Item | undefined): number {
  if (!item) return 0;
  let pct = 0;
  for (const raw of [...item.implicits, ...item.explicits]) {
    const line = cleanModLine(raw);
    const m = line.match(
      /^(\d+)% increased Effect of Socketed (?:Abyss(?:al)? Jewels|Jewels|Items)$/i,
    );
    if (m) {
      pct += Number(m[1]);
    }
  }
  return pct;
}

export interface ExtraSocketedEquipmentEntry {
  slot: string;
  item: Item;
  effectMult: number;
}

/**
 * Collects all extra socketed equipment entries outside standard `ruleset.equipmentSlots`:
 * 1. PoE 1 Abyssal Sockets (`Belt/Body Armour/Boots/Gloves/Helmet/Weapon 1/Weapon 2 Abyssal Socket N`),
 *    scaling Belt Abyssal Socket jewels by `Darkness Enthroned`'s `increased Effect of Socketed Abyss(al) Jewels`
 *    (and any similar parent item abyssal jewel effect bonus).
 * 2. PoE 2 0.5 Grafted Limbs (`Arm 1`, `Arm 2`, `Leg 1`, `Leg 2`).
 * 3. PoE 2 0.5 Equipment Jewel Sockets (`Gloves/Helmet/Boots/Body Armour Jewel Socket N`).
 */
export function collectExtraSocketedEquipment(build: Build): ExtraSocketedEquipmentEntry[] {
  const equippedMap = build.equipped as Record<string, string | undefined>;
  const result: ExtraSocketedEquipmentEntry[] = [];

  for (const [slot, itemId] of Object.entries(equippedMap)) {
    if (!itemId) continue;
    const item = build.items[itemId];
    if (!item) continue;

    // 1. PoE 1 Abyssal Sockets
    const mAbyss = slot.match(ABYSSAL_SOCKET_RE);
    if (mAbyss) {
      const parentSlot = mAbyss[1]!;
      const socketIdx = Number(mAbyss[2]);
      const parentId = equippedMap[parentSlot];
      const parentItem = parentId ? build.items[parentId] : undefined;
      if (parentItem?.sockets) {
        const abyssCount = (parentItem.sockets.match(/A/gi) ?? []).length;
        if (socketIdx > abyssCount) continue;
      }
      const effectPct = extractSocketedAbyssalJewelEffectPct(parentItem);
      const effectMult = 1 + effectPct / 100;
      result.push({ slot, item, effectMult });
      continue;
    }

    // 2. PoE 2 0.5 Grafted Limbs (Arm 1/2, Leg 1/2)
    if (GRAFTED_LIMB_RE.test(slot)) {
      result.push({ slot, item, effectMult: 1 });
      continue;
    }

    // 3. PoE 2 0.5 Equipment Jewel Sockets (Gloves/Belt/Boots/Helmet Jewel Socket 1, etc.)
    const mEquipJewel = slot.match(EQUIP_JEWEL_SOCKET_RE);
    if (mEquipJewel) {
      const parentSlot = mEquipJewel[1]!;
      const socketIdx = Number(mEquipJewel[2]);
      const parentId = equippedMap[parentSlot];
      const parentItem = parentId ? build.items[parentId] : undefined;
      if (parentItem) {
        const socketStr =
          parentItem.sockets ||
          parentItem.rawText?.match(/^Sockets:\s*(.+)$/im)?.[1] ||
          '';
        if (socketStr) {
          const jewelSocketCount = (socketStr.match(/J/gi) ?? []).length;
          if (socketIdx > jewelSocketCount) continue;
        }
      }
      const effectPct = extractSocketedAbyssalJewelEffectPct(parentItem);
      const effectMult = 1 + effectPct / 100;
      result.push({ slot, item, effectMult });
    }
  }

  return result;
}

/**
 * Heuristic classifier for PoE ring/amulet/item explicit affix lines as Suffix vs Prefix
 * (used for `Cogwork Ring`, `Helical Ring`, `Simplex Amulet`, and `increased Suffix/Prefix Modifier magnitudes`).
 */
const SUFFIX_MOD_PATTERNS: readonly RegExp[] = [
  /to (?:Fire|Cold|Lightning|Chaos|all Elemental) Resistance/i,
  /to (?:Fire|Cold|Lightning) and (?:Fire|Cold|Lightning|Chaos) Resistance/i,
  /to (?:Strength|Dexterity|Intelligence|all Attributes)/i,
  /to (?:Strength|Dexterity) and (?:Dexterity|Intelligence)/i,
  /increased (?:Attack|Cast|Attack and Cast) Speed/i,
  /Critical Strike (?:Chance|Multiplier)/i,
  /Critical (?:Hit Chance|Damage Bonus)/i,
  /to Accuracy Rating/i,
  /Regenerate .* (?:Life|Mana) per second/i,
  /increased Mana Regeneration Rate/i,
  /chance to Suppress Spell Damage/i,
  /increased Stun and Block Recovery/i,
  /increased Light Radius/i,
  /increased Rarity of Items found/i,
  /Damage over Time Multiplier/i,
];

const PREFIX_MOD_PATTERNS: readonly RegExp[] = [
  /to maximum (?:Life|Mana|Energy Shield)/i,
  /increased (?:Armour|Evasion Rating|Energy Shield|maximum Life|maximum Mana|maximum Energy Shield)/i,
  /Adds \d+ to \d+ .* Damage/i,
  /increased Elemental Damage with Attack Skills/i,
  /increased (?:Physical|Fire|Cold|Lightning|Chaos|Spell|Elemental) Damage/i,
  /increased Movement Speed/i,
  /to (?:Armour|Evasion Rating|Ward)/i,
  /to Level of all/i,
];

const DEFENCE_MOD_PATTERNS: readonly RegExp[] = [
  /(?:Armour|Evasion Rating|Energy Shield|Ward)/i,
];

function isSuffixModLine(line: string): boolean {
  return SUFFIX_MOD_PATTERNS.some((re) => re.test(line));
}

function isPrefixModLine(line: string): boolean {
  return PREFIX_MOD_PATTERNS.some((re) => re.test(line));
}

function isDefenceModLine(line: string): boolean {
  return DEFENCE_MOD_PATTERNS.some((re) => re.test(line));
}

const GENERIC_GEM_TAG_NAMES = new Set([
  'skill',
  'spell',
  'attack',
  'melee',
  'chaos',
  'fire',
  'cold',
  'lightning',
  'physical',
  'minion',
  'aura',
  'curse',
  'projectile',
  'elemental',
  'vaal',
  'all',
  'socketed',
  'bow',
  'wand',
  'brand',
  'totem',
  'trap',
  'mine',
  'warcry',
  'mark',
  'hex',
  'herald',
  'guard',
  'golem',
  'channelling',
  'strike',
  'slam',
  'nova',
  'area',
]);

export interface SpecialUniqueGearOptions {
  /** Reserved life amount (for `The Ivory Tower` +30 ES per 100 Reserved Life). */
  reservedLife?: number;
  /** Optional socketed passive tree jewels (so `Melding of the Flesh` & `Prism of Belief` can also be passed here). */
  socketedJewels?: readonly Item[];
  /** Skip re-scaling Heist ring/amulet Suffix/Prefix/Defence magnitudes when explicits are already pre-baked (PoB XML / Ctrl+C). */
  skipHeistBaseMagnitudes?: boolean;
}

export interface SpecialUniqueGearResult {
  widowhailQuiverBonusPct: number;
  meldingOfTheFleshActive: boolean;
  meldingHighestMaxResist: number | null;
  ralakeshCharges: {
    power: boolean;
    frenzy: boolean;
    endurance: boolean;
  };
  ivoryTowerEsPer100ReservedLife: number;
  ivoryTowerBonusEs: number;
  skillSpecificGemLevels: Record<string, number>;
  enemyResistLowestElement: boolean;
  aegisAuroraEsOnBlockArmourPct: number;
  svalinnLuckyBlock: boolean;
  appliedSources: string[];
}

/**
 * Evaluates top PoE 1 & PoE 2 meta unique equipment/jewel mechanics and injects their
 * derived modifiers into `db`:
 * - `Widowhail` (`N% increased bonuses gained from Equipped Quiver`)
 * - `Melding of the Flesh` (syncs Fire/Cold/Lightning max resist to highest + applies max-res penalty)
 * - `Ralakesh's Impatience` (`Count as having maximum number of Power/Frenzy/Endurance Charges`)
 * - `The Ivory Tower` (`+30 to maximum Energy Shield per 100 Reserved Life`)
 * - `Prism of Belief` (`+N to Level of all <SkillName> Skills`)
 * - `Cogwork Ring` / `Helical Ring` / `Simplex Amulet` (`N% increased Suffix/Prefix/Explicit Defence Modifier magnitudes`)
 * - `Sacred Flame` (`Enemies in your Presence Resist Elemental Damage based on their Lowest Resistance`)
 * - `Aegis Aurora` (`Recover Energy Shield equal to N% of Armour when you Block`)
 * - `Svalinn` (`Chance to Block is Lucky` & `-N% to maximum Chance to Block Attack/Spell Damage`)
 */
export function evaluateSpecialUniqueGearMechanics(
  equippedItems: ReadonlyArray<{ slot: string; item: Item }>,
  db: ModDB,
  game: GameId,
  opts?: SpecialUniqueGearOptions,
): SpecialUniqueGearResult {
  const appliedSources: string[] = [];
  const allItems: Array<{ slot: string; item: Item }> = [
    ...equippedItems,
    ...(opts?.socketedJewels ?? []).map((item, idx) => ({
      slot: `Jewel ${idx + 1}`,
      item,
    })),
  ];

  let widowhailQuiverBonusPct = 0;
  let meldingOfTheFleshActive = false;
  let meldingHighestMaxResist: number | null = null;
  const ralakeshCharges = { power: false, frenzy: false, endurance: false };
  let ivoryTowerEsPer100ReservedLife = 0;
  let ivoryTowerBonusEs = 0;
  const skillSpecificGemLevels: Record<string, number> = {};
  let enemyResistLowestElement = false;
  let aegisAuroraEsOnBlockArmourPct = 0;
  let svalinnLuckyBlock = false;

  for (const { slot, item } of allItems) {
    const src = `Unique (${slot}): ${item.name}`;
    const allLines = [...item.implicits, ...item.explicits].map(cleanModLine).filter(Boolean);

    let suffixMagPct = 0;
    let prefixMagPct = 0;
    let defenceMagPct = 0;

    for (const line of allLines) {
      // 1. Widowhail
      const mWidow = line.match(/^(\d+)% increased bonuses gained from Equipped Quiver$/i);
      if (mWidow) {
        widowhailQuiverBonusPct += Number(mWidow[1]);
        continue;
      }

      // 2. Melding of the Flesh
      if (
        /^Elemental Resistances are capped by your highest Maximum Elemental Resistance instead$/i.test(
          line,
        )
      ) {
        meldingOfTheFleshActive = true;
        appliedSources.push(src);
        continue;
      }
      const mNegMaxEle = line.match(/^-(\d+)% to all maximum Elemental Resistances$/i);
      if (mNegMaxEle) {
        const neg = -Number(mNegMaxEle[1]);
        const alreadyParsed = db
          .calcStat('FireResistMax')
          .sources.some((s) => s.type === 'BASE' && s.value === neg && s.source.includes(item.name));
        if (!alreadyParsed) {
          db.addMod({ name: 'FireResistMax', type: 'BASE', value: neg, flags: 0, keywordFlags: 0, source: src });
          db.addMod({ name: 'ColdResistMax', type: 'BASE', value: neg, flags: 0, keywordFlags: 0, source: src });
          db.addMod({ name: 'LightningResistMax', type: 'BASE', value: neg, flags: 0, keywordFlags: 0, source: src });
        }
        continue;
      }

      // 3. Ralakesh's Impatience (both single-charge 3.26+ and legacy all-3 variants)
      const mRalakeshSingle = line.match(
        /^Count as having maximum number of (Power|Frenzy|Endurance) Charges$/i,
      );
      if (mRalakeshSingle) {
        const kind = mRalakeshSingle[1]!.toLowerCase();
        if (kind === 'power') ralakeshCharges.power = true;
        if (kind === 'frenzy') ralakeshCharges.frenzy = true;
        if (kind === 'endurance') ralakeshCharges.endurance = true;
        appliedSources.push(src);
        continue;
      }
      if (/^Count as having maximum number of Endurance, Frenzy and Power Charges$/i.test(line)) {
        ralakeshCharges.power = true;
        ralakeshCharges.frenzy = true;
        ralakeshCharges.endurance = true;
        appliedSources.push(src);
        continue;
      }

      // 4. The Ivory Tower
      const mIvory = line.match(/^\+(\d+) to maximum Energy Shield per (\d+) Reserved Life$/i);
      if (mIvory) {
        const esGain = Number(mIvory[1]);
        const perLife = Math.max(1, Number(mIvory[2]));
        ivoryTowerEsPer100ReservedLife += (esGain * 100) / perLife;
        db.addMod({
          name: 'EsPer100ReservedLife',
          type: 'BASE',
          value: (esGain * 100) / perLife,
          flags: 0,
          keywordFlags: 0,
          source: src,
        });
        if (opts?.reservedLife && opts.reservedLife > 0) {
          const bonusEs = Math.floor(opts.reservedLife / perLife) * esGain;
          ivoryTowerBonusEs += bonusEs;
          if (bonusEs > 0) {
            db.addMod({
              name: 'EnergyShield',
              type: 'BASE',
              value: bonusEs,
              flags: 0,
              keywordFlags: 0,
              source: src,
            });
          }
        }
        appliedSources.push(src);
        continue;
      }
      if (/^Chaos Damage is taken from Mana before Life$/i.test(line)) {
        db.addMod({
          name: 'ChaosTakenFromManaBeforeLife',
          type: 'FLAG',
          value: true,
          flags: 0,
          keywordFlags: 0,
          source: src,
        });
        continue;
      }

      // 5. Prism of Belief (skill-name-specific +N to Level of all <SkillName> Skills)
      const mPrism = line.match(/^\+(\d+) to Level of all (.+?) Skills$/i);
      if (mPrism) {
        const bonus = Number(mPrism[1]);
        const rawSkill = mPrism[2]!.trim();
        const skillKey = rawSkill.toLowerCase();
        const words = skillKey.split(/\s+/).filter(Boolean);
        const isGeneric = words.length > 0 && words.every((w) => GENERIC_GEM_TAG_NAMES.has(w));
        if (!isGeneric && skillKey.length > 0) {
          const parsedGemLevelKey = `GemLevel:${words.join('+')}`;
          const alreadyParsedByModParser = db
            .calcStat(parsedGemLevelKey)
            .sources.some(
              (s) =>
                s.type === 'BASE' &&
                typeof s.value === 'number' &&
                Math.abs(s.value - bonus) < 1e-6,
            );
          if (!alreadyParsedByModParser) {
            skillSpecificGemLevels[skillKey] = (skillSpecificGemLevels[skillKey] ?? 0) + bonus;
          }
          db.addMod({
            name: `SkillLevel:${skillKey}`,
            type: 'BASE',
            value: bonus,
            flags: 0,
            keywordFlags: 0,
            source: src,
          });
          appliedSources.push(src);
        }
        continue;
      }

      // 6. Cogwork Ring / Helical Ring / Simplex Amulet / Tailoring Orb magnitude mods
      const mSuffixMag = line.match(/^(\d+)% increased Suffix Modifier magnitudes$/i);
      if (mSuffixMag) {
        suffixMagPct += Number(mSuffixMag[1]);
        continue;
      }
      const mPrefixMag = line.match(/^(\d+)% increased Prefix Modifier magnitudes$/i);
      if (mPrefixMag) {
        prefixMagPct += Number(mPrefixMag[1]);
        continue;
      }
      const mDefMag = line.match(/^(\d+)% increased Explicit Defence Modifier magnitudes$/i);
      if (mDefMag) {
        defenceMagPct += Number(mDefMag[1]);
        continue;
      }

      // 7. Sacred Flame
      if (
        /^Enemies in your Presence Resist Elemental Damage based on their Lowest (?:Elemental )?Resistance$/i.test(
          line,
        )
      ) {
        enemyResistLowestElement = true;
        db.addMod({
          name: 'EnemyResistLowestElement',
          type: 'FLAG',
          value: true,
          flags: 0,
          keywordFlags: 0,
          source: src,
        });
        appliedSources.push(src);
        continue;
      }

      // 8. Aegis Aurora
      const mAegis = line.match(/^Recover Energy Shield equal to (\d+)% of Armour when you Block$/i);
      if (mAegis) {
        const pct = Number(mAegis[1]);
        aegisAuroraEsOnBlockArmourPct += pct;
        db.addMod({
          name: 'EsRecoverOnBlockPctArmour',
          type: 'BASE',
          value: pct,
          flags: 0,
          keywordFlags: 0,
          source: src,
        });
        appliedSources.push(src);
        continue;
      }

      // 9. Svalinn
      if (/^Chance to Block is Lucky$/i.test(line)) {
        svalinnLuckyBlock = true;
        db.addMod({
          name: 'BlockChanceLucky',
          type: 'FLAG',
          value: true,
          flags: 0,
          keywordFlags: 0,
          source: src,
        });
        appliedSources.push(src);
        continue;
      }
      const mNegMaxBlock = line.match(
        /^-(\d+)% to maximum Chance to Block (Attack|Spell) Damage$/i,
      );
      if (mNegMaxBlock) {
        const statName =
          mNegMaxBlock[2]!.toLowerCase() === 'spell' ? 'MaxSpellBlockChance' : 'MaxBlockChance';
        db.addMod({
          name: statName,
          type: 'BASE',
          value: -Number(mNegMaxBlock[1]),
          flags: 0,
          keywordFlags: 0,
          source: src,
        });
        continue;
      }

      // 10. Screams of the Desiccated (Massive Shrine Buff while affected by no Flasks: +40% inc Life, +40% inc AoE)
      if (/^You have Massive Shrine Buff while affected by no Flasks$/i.test(line)) {
        if (!db.getEvalContext().conditions.UsingFlask) {
          db.addMod({ name: 'Life', type: 'INC', value: 40, flags: 0, keywordFlags: 0, source: `${src} (Massive Shrine)` });
          db.addMod({ name: 'AreaOfEffect', type: 'INC', value: 40, flags: 0, keywordFlags: 0, source: `${src} (Massive Shrine)` });
          appliedSources.push(`${src} (Massive Shrine)`);
        }
      }
    }

    // Apply Suffix / Prefix / Explicit Defence magnitude deltas on this item's explicit lines
    if (!opts?.skipHeistBaseMagnitudes && (suffixMagPct > 0 || prefixMagPct > 0 || defenceMagPct > 0)) {
      for (const rawExplicit of item.explicits) {
        const cleanExp = cleanModLine(rawExplicit);
        if (!cleanExp) continue;
        // Skip magnitude meta-lines themselves
        if (/Modifier magnitudes$/i.test(cleanExp)) continue;

        let extraPct = 0;
        if (suffixMagPct > 0 && isSuffixModLine(cleanExp)) {
          extraPct += suffixMagPct;
        } else if (prefixMagPct > 0 && isPrefixModLine(cleanExp)) {
          extraPct += prefixMagPct;
        }
        if (defenceMagPct > 0 && isDefenceModLine(cleanExp)) {
          extraPct += defenceMagPct;
        }
        if (extraPct <= 0) continue;

        const deltaLine = buildDeltaScaledLine(cleanExp, 1 + extraPct / 100);
        if (!deltaLine) continue;
        const parsed = parseModLines([deltaLine], `${src} [+${extraPct}% Magnitude]`);
        if (parsed.length > 0) {
          db.addMods(parsed);
        }
      }
      appliedSources.push(`${src} [Magnitude]`);
    }
  }

  // Apply Widowhail + Passive Tree / Jewel QuiverEffect bonuses (scaled by N/100 on top of the 1x quiver already equipped)
  const totalQuiverBonusPct = Math.max(
    widowhailQuiverBonusPct,
    db.sum('INC', ['QuiverEffect', 'EffectOfBonusesFromQuiver']),
  );
  if (totalQuiverBonusPct > 0) {
    const quiverEntry = equippedItems.find(
      ({ slot, item }) =>
        (slot === 'Weapon 2' || slot === 'Weapon 2 Swap') &&
        item.baseName.toLowerCase().includes('quiver'),
    );
    if (quiverEntry) {
      const totalMult = 1 + totalQuiverBonusPct / 100;
      const quiverSrc = `Quiver Effect (+${totalQuiverBonusPct}% Quiver: ${quiverEntry.item.name})`;
      for (const raw of [...quiverEntry.item.implicits, ...quiverEntry.item.explicits]) {
        const line = cleanModLine(raw);
        if (!line) continue;
        const deltaLine = buildDeltaScaledLine(line, totalMult);
        if (!deltaLine) continue;
        const parsed = parseModLines([deltaLine], quiverSrc);
        if (parsed.length > 0) {
          db.addMods(parsed);
        }
      }
      appliedSources.push(quiverSrc);
    }
  }

  // Apply Passive Tree / Jewel AmuletEffect bonuses (`% increased Bonus gained from Equipped Amulet`)
  const totalAmuletBonusPct = db.sum('INC', ['AmuletEffect', 'EffectOfBonusesFromAmulet']);
  if (totalAmuletBonusPct > 0) {
    const amuletEntry = equippedItems.find(({ slot }) => slot === 'Amulet');
    if (amuletEntry) {
      const totalMult = 1 + totalAmuletBonusPct / 100;
      const amuletSrc = `Amulet Effect (+${totalAmuletBonusPct}% Amulet: ${amuletEntry.item.name})`;
      for (const raw of [...amuletEntry.item.implicits, ...amuletEntry.item.explicits]) {
        const line = cleanModLine(raw);
        if (!line) continue;
        const deltaLine = buildDeltaScaledLine(line, totalMult);
        if (!deltaLine) continue;
        const parsed = parseModLines([deltaLine], amuletSrc);
        if (parsed.length > 0) {
          db.addMods(parsed);
        }
      }
      appliedSources.push(amuletSrc);
    }
  }

  // Apply Passive Tree / Ascendancy FocusEffect bonuses (e.g. Disciple of Varashta `Instruments of Power`:
  // `50% reduced bonuses gained from Equipped Focus` -> `EffectOfBonusesFromFocus` = -50).
  // Uses PoB 2 `CalcSetup.lua:1625-1636` + `ModStore.lua:114` (`m_modf(round(val * scale, 2))`) delta scaling.
  const totalFocusBonusPct = db.sum('INC', ['FocusEffect', 'EffectOfBonusesFromFocus']);
  if (totalFocusBonusPct !== 0 && !db.flag('FocusEffectApplied')) {
    const focusEntry = equippedItems.find(
      ({ slot, item }) =>
        (slot === 'Weapon 2' || slot === 'Weapon 2 Swap') &&
        /\bfocus\b/i.test(item.baseName),
    );
    if (focusEntry) {
      const scale = Math.max(0, 1 + totalFocusBonusPct / 100) - 1;
      if (Math.abs(scale) > 1e-9) {
        const isReduction = scale < 0;
        const signLabel = totalFocusBonusPct >= 0 ? `+${totalFocusBonusPct}%` : `${totalFocusBonusPct}%`;
        const focusSrc = `Focus Effect (${signLabel} Focus: ${focusEntry.item.name})`;
        let appliedAny = false;
        for (const raw of [...focusEntry.item.implicits, ...focusEntry.item.explicits]) {
          const line = cleanModLine(raw);
          if (
            !line ||
            /^\+\d+ to maximum Energy Shield$/i.test(line) ||
            /^\d+% (?:increased|reduced) (?:maximum )?Energy Shield$/i.test(line) ||
            /^(?:Grants Skill:|Corrupted$|Mirrored$|Unidentified$|Requires Level)/i.test(line)
          ) {
            continue;
          }
          let anyNonZero = false;
          const deltaLine = line.replace(/([+-]?)(\d+(?:\.\d+)?)/g, (_m, sign: string, numStr: string) => {
            const rawNum = Number(numStr);
            const dotIdx = numStr.indexOf('.');
            const decimals = dotIdx === -1 ? 0 : numStr.length - dotIdx - 1;
            let delta: number;
            if (decimals === 0) {
              // PoB 2 ModStore.lua:114: m_modf(round(value * scale, 2))
              delta = Math.trunc(Math.round(rawNum * scale * 100) / 100);
            } else {
              const factor = Math.pow(10, decimals);
              delta = Math.trunc(Math.round(rawNum * scale * factor * 100) / 100) / factor;
            }
            const mag = isReduction ? -delta : delta;
            if (mag !== 0) anyNonZero = true;
            return `${sign}${decimals > 0 ? mag.toFixed(decimals).replace(/\.?0+$/, '') : String(Math.max(0, mag))}`;
          });
          if (!anyNonZero) continue;
          const parsed = parseModLines([deltaLine], focusSrc);
          if (parsed.length === 0) continue;
          const adjusted = isReduction
            ? parsed.map((m) =>
                typeof m.value === 'number' && (m.type === 'BASE' || m.type === 'INC' || m.type === 'MORE')
                  ? { ...m, value: -m.value }
                  : m,
              )
            : parsed;
          db.addMods(adjusted);
          appliedAny = true;
        }
        if (appliedAny) {
          db.addMod({
            name: 'FocusEffectApplied',
            type: 'FLAG',
            value: true,
            flags: 0,
            keywordFlags: 0,
            source: focusSrc,
          });
          appliedSources.push(focusSrc);
        }
      }
    }
  }

  // Apply Ralakesh's Impatience charge flags & min-equals-max syncing
  if (ralakeshCharges.power) {
    db.addMod({
      name: 'CountAsMaxPowerCharges',
      type: 'FLAG',
      value: true,
      flags: 0,
      keywordFlags: 0,
      source: "Ralakesh's Impatience",
    });
    const maxPower = Math.max(0, 3 + Math.round(db.sum('BASE', 'MaxPowerCharges')));
    const curMin = Math.max(0, Math.round(db.sum('BASE', 'MinPowerCharges')));
    if (maxPower > curMin) {
      db.addMod({
        name: 'MinPowerCharges',
        type: 'BASE',
        value: maxPower - curMin,
        flags: 0,
        keywordFlags: 0,
        source: "Ralakesh's Impatience",
      });
    }
  }
  if (ralakeshCharges.frenzy) {
    db.addMod({
      name: 'CountAsMaxFrenzyCharges',
      type: 'FLAG',
      value: true,
      flags: 0,
      keywordFlags: 0,
      source: "Ralakesh's Impatience",
    });
    const maxFrenzy = Math.max(0, 3 + Math.round(db.sum('BASE', 'MaxFrenzyCharges')));
    const curMin = Math.max(0, Math.round(db.sum('BASE', 'MinFrenzyCharges')));
    if (maxFrenzy > curMin) {
      db.addMod({
        name: 'MinFrenzyCharges',
        type: 'BASE',
        value: maxFrenzy - curMin,
        flags: 0,
        keywordFlags: 0,
        source: "Ralakesh's Impatience",
      });
    }
  }
  if (ralakeshCharges.endurance) {
    db.addMod({
      name: 'CountAsMaxEnduranceCharges',
      type: 'FLAG',
      value: true,
      flags: 0,
      keywordFlags: 0,
      source: "Ralakesh's Impatience",
    });
    const maxEndurance = Math.max(0, 3 + Math.round(db.sum('BASE', 'MaxEnduranceCharges')));
    const curMin = Math.max(0, Math.round(db.sum('BASE', 'MinEnduranceCharges')));
    if (maxEndurance > curMin) {
      db.addMod({
        name: 'MinEnduranceCharges',
        type: 'BASE',
        value: maxEndurance - curMin,
        flags: 0,
        keywordFlags: 0,
        source: "Ralakesh's Impatience",
      });
    }
  }

  // Apply Melding of the Flesh max elemental resistance synchronization
  if (meldingOfTheFleshActive) {
    const cap = game === 'poe1' ? 90 : 90;
    const fireMax = Math.min(cap, Math.round(db.sum('BASE', 'FireResistMax')));
    const coldMax = Math.min(cap, Math.round(db.sum('BASE', 'ColdResistMax')));
    const lightMax = Math.min(cap, Math.round(db.sum('BASE', 'LightningResistMax')));
    const highestMax = Math.max(fireMax, coldMax, lightMax);
    meldingHighestMaxResist = highestMax;

    const elems: Array<{ name: 'FireResistMax' | 'ColdResistMax' | 'LightningResistMax'; cur: number }> = [
      { name: 'FireResistMax', cur: fireMax },
      { name: 'ColdResistMax', cur: coldMax },
      { name: 'LightningResistMax', cur: lightMax },
    ];
    for (const el of elems) {
      if (el.cur < highestMax) {
        db.addMod({
          name: el.name,
          type: 'BASE',
          value: highestMax - el.cur,
          flags: 0,
          keywordFlags: 0,
          source: 'Melding of the Flesh',
        });
      }
      db.addMod({
        name: el.name,
        type: 'OVERRIDE',
        value: highestMax,
        flags: 0,
        keywordFlags: 0,
        source: 'Melding of the Flesh',
      });
    }
  }

  return {
    widowhailQuiverBonusPct,
    meldingOfTheFleshActive,
    meldingHighestMaxResist,
    ralakeshCharges,
    ivoryTowerEsPer100ReservedLife,
    ivoryTowerBonusEs,
    skillSpecificGemLevels,
    enemyResistLowestElement,
    aegisAuroraEsOnBlockArmourPct,
    svalinnLuckyBlock,
    appliedSources,
  };
}
