import type { DamageType, GameId } from '@webpob/core';

// ============================================================================
// 1. PoE 2 Crit Damage Bonus, Lucky / Bifurcated Crit & Base Crit Overrides
// ============================================================================

export interface Poe2CritOptions {
  /** Base critical hit chance % from skill or weapon (e.g. 5, 8, 10). */
  baseCritChance: number;
  /** Flat added base critical hit chance % (e.g. Struck Through +1%). */
  flatAddedBaseCrit?: number;
  /** Explicit base critical hit chance override % (takes precedence if set). */
  baseCritOverride?: number;
  /** Blood Mage "Sunder the Flesh": Base Critical Hit Chance for Spells is 15%. */
  sunderTheFlesh?: boolean;
  /** Slayer "Overwhelm": Base Critical Strike Chance for Attacks with Weapons is 8%. */
  overwhelm?: boolean;
  /** Sandstorm Visage: Base Spell Crit Chance equals main-hand weapon's Crit Chance. */
  sandstormVisageWeaponCrit?: number;
  /** Whether this skill is a Spell (used for Sunder the Flesh / Sandstorm Visage). */
  isSpell?: boolean;
  /** Whether this skill is an Attack (used for Overwhelm). */
  isAttack?: boolean;
  /** Sum of "% increased Critical Hit Chance" (INC). */
  incCritChancePct?: number;
  /** Product of MORE Critical Hit Chance multipliers (default 1, e.g. Charge Regulation 1.26). */
  moreCritChanceMult?: number;
  /** Flat added Critical Damage Bonus % on top of PoE 2's +100% base bonus. */
  flatBonusPct?: number;
  /** Sum of "% increased Critical (Spell |Attack )?Damage Bonus" (INC on the bonus). */
  incBonusPct?: number;
  /** Product of MORE Critical Damage Bonus multipliers (default 1, e.g. Pain Attunement 1.30). */
  moreBonusMult?: number;
  /** Explicit override for the Critical Damage Bonus % (replaces calculated bonus). */
  overrideBonusPct?: number;
  /** Enemy flat extra critical damage taken % (SelfCritMultiplier BASE). */
  enemyExtraCritFlatPct?: number;
  /** Enemy increased/reduced extra critical damage taken % (SelfCritMultiplier INC). */
  enemyExtraCritIncPct?: number;
  /** Lucky Crit Chance: p_eff = 1 - (1 - p)^2. */
  luckyCrit?: boolean;
  /** Pre-accuracy / pre-lucky / pre-bifurcate critical chance cap % (e.g. Garukhan's Resolve 50%). */
  critChanceCap?: number;
  /** Optional attack accuracy hit chance % applied before Lucky & Bifurcate (PoB2 CalcOffence.lua:3897). */
  accuracyHitChancePct?: number;
  /** Garukhan's Resolve / Tangletongue Bifurcated Crit: rolls crit twice, doubling bonus when both succeed. */
  bifurcatedCrit?: boolean;
  /** Oracle "Forced Outcome": Inevitable Critical Hits (rerolls non-crits with 30% roll-down penalty). */
  inevitableCrits?: boolean;
  /** Skill cannot deal critical strikes (Resolute Technique, Elemental Overload, etc.). */
  neverCrit?: boolean;
  /** Critical strikes deal no extra damage. */
  noCritMultiplier?: boolean;
}

export interface Poe2CritResult {
  /** Resolved base crit chance % after overrides and flat additions. */
  baseCritChance: number;
  /** Crit chance % after INC/MORE, clamped to [0, 100], before Lucky/Bifurcated. */
  preLuckyCritChance: number;
  /** Crit chance % after Lucky, before Bifurcated. */
  preBifurcateCritChance: number;
  /** Final effective crit chance % in [0, 100]. */
  effectiveCritChance: number;
  /** Pre-bifurcated Critical Damage Bonus % (base +100% scaled by INC/MORE). */
  baseBonusPct: number;
  /** Final effective Critical Damage Bonus % (after Bifurcated & enemy modifiers). */
  effectiveBonusPct: number;
  /** Total Critical Multiplier as a percentage (100 + effectiveBonusPct, e.g. 200% base). */
  critMultiplierPct: number;
  /** Total Critical Multiplier as a decimal factor (critMultiplierPct / 100, e.g. 2.0 base). */
  critMultiplier: number;
  /** Average hit damage multiplier from crits: 1 - p + p * critMultiplier. */
  critEffect: number;
  /** Expected number of crits per crit hit under Bifurcated Crit (1 when not bifurcated). */
  critBifurcates: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Computes PoE 2 Critical Hit Chance, Critical Damage Bonus, Total Crit Multiplier,
 * Lucky Crit, Bifurcated Crit (Garukhan's Resolve), and base crit overrides
 * aligned with official PoB2 `CalcOffence.lua`.
 *
 * Official PoE 2 formula:
 *   baseBonus = 100 + flatBonusPct
 *   bonus = baseBonus * (1 + incBonusPct / 100) * moreBonusMult
 *   totalCritMultiplierPct = 100 + effectiveBonusPct
 */
export function computePoe2CritMultiplier(opts: Poe2CritOptions): Poe2CritResult {
  if (opts.neverCrit) {
    return {
      baseCritChance: 0,
      preLuckyCritChance: 0,
      preBifurcateCritChance: 0,
      effectiveCritChance: 0,
      baseBonusPct: 0,
      effectiveBonusPct: 0,
      critMultiplierPct: 100,
      critMultiplier: 1,
      critEffect: 1,
      critBifurcates: 1,
    };
  }

  // 1. Resolve base crit chance with overrides
  let resolvedBaseCrit = opts.baseCritChance;
  if (opts.baseCritOverride !== undefined) {
    resolvedBaseCrit = opts.baseCritOverride;
  } else if (opts.isSpell && opts.sunderTheFlesh) {
    resolvedBaseCrit = 15;
  } else if (opts.isSpell && opts.sandstormVisageWeaponCrit !== undefined && opts.sandstormVisageWeaponCrit > 0) {
    resolvedBaseCrit = opts.sandstormVisageWeaponCrit;
  } else if (opts.isAttack && opts.overwhelm) {
    resolvedBaseCrit = 8;
  }
  const baseCritChance = Math.max(0, resolvedBaseCrit + (opts.flatAddedBaseCrit ?? 0));

  // 2. Scale crit chance by INC and MORE, apply CritChanceCap & AccuracyHitChance before Lucky/Bifurcate (PoB2 CalcOffence.lua:3886-3908)
  const incMult = Math.max(0, 1 + (opts.incCritChancePct ?? 0) / 100);
  const moreMult = Math.max(0, opts.moreCritChanceMult ?? 1);
  const rawCritChance = Math.round(baseCritChance * incMult * moreMult * 100) / 100;
  const cappedCritChance =
    opts.critChanceCap !== undefined
      ? clamp(Math.min(rawCritChance, opts.critChanceCap), 0, 100)
      : clamp(rawCritChance, 0, 100);
  const preLuckyCritChance =
    opts.accuracyHitChancePct !== undefined
      ? clamp(cappedCritChance * (opts.accuracyHitChancePct / 100), 0, 100)
      : cappedCritChance;

  // 3. Apply Lucky Crit: p_eff = 1 - (1 - p)^2
  const preBifurcateCritChance = opts.luckyCrit
    ? (1 - Math.pow(1 - preLuckyCritChance / 100, 2)) * 100
    : preLuckyCritChance;

  // 4. Apply Bifurcated Crit (Garukhan's Resolve / Tangletongue): rolls crit twice
  const preInevitableCritChance = opts.bifurcatedCrit
    ? (1 - Math.pow(1 - preBifurcateCritChance / 100, 2)) * 100
    : preBifurcateCritChance;

  let inevitableMoreMult = 1;
  let effectiveCritChance = preInevitableCritChance;
  let critBifurcates = 1;

  // 4b. Oracle "Forced Outcome" Inevitable Critical Hits (PoB2 CalcOffence.lua L3909-3934)
  if (opts.inevitableCrits && preInevitableCritChance > 0) {
    const p = preInevitableCritChance / 100;
    const q = 1 - p;
    let critBonusMultiplier =
      1 * p + 0.7 * q * p + 0.4 * Math.pow(q, 2) * p + 0.1 * Math.pow(q, 3) * p;
    if (opts.bifurcatedCrit) {
      critBonusMultiplier = (critBonusMultiplier * 2 * preBifurcateCritChance) / preInevitableCritChance;
      critBifurcates = 1 + (preBifurcateCritChance * preBifurcateCritChance) / (100 * preInevitableCritChance);
    }
    const lessCritBonus = Math.round((1 - critBonusMultiplier) * -100);
    inevitableMoreMult = Math.max(0, 1 + lessCritBonus / 100);
    effectiveCritChance = 100;
  }

  // 5. Compute PoE 2 Critical Damage Bonus (base +100%, scaled by INC and MORE)
  if (opts.noCritMultiplier) {
    return {
      baseCritChance,
      preLuckyCritChance,
      preBifurcateCritChance,
      effectiveCritChance,
      baseBonusPct: 0,
      effectiveBonusPct: 0,
      critMultiplierPct: 100,
      critMultiplier: 1,
      critEffect: 1,
      critBifurcates: 1,
    };
  }

  const rawBaseBonus = 100 + (opts.flatBonusPct ?? 0);
  const bonusIncMult = Math.max(0, 1 + (opts.incBonusPct ?? 0) / 100);
  const bonusMoreMult = Math.max(0, (opts.moreBonusMult ?? 1) * inevitableMoreMult);
  const baseBonusPct =
    opts.overrideBonusPct !== undefined
      ? Math.max(0, opts.overrideBonusPct)
      : Math.max(0, rawBaseBonus * bonusIncMult * bonusMoreMult);

  let effectiveBonusPct = baseBonusPct;

  // Bifurcated Crit conditional double-crit bonus (PoB2 CalcOffence.lua L3994-4014)
  if (opts.bifurcatedCrit && !opts.inevitableCrits && effectiveCritChance > 0) {
    const bifurcateMultiChance = (preBifurcateCritChance * preBifurcateCritChance) / 100;
    const conditionalBifurcateChance = bifurcateMultiChance / effectiveCritChance;
    critBifurcates = 1 + conditionalBifurcateChance;
    effectiveBonusPct = baseBonusPct * critBifurcates;
  }

  // Enemy extra crit damage taken modifiers
  const enemyFlat = opts.enemyExtraCritFlatPct ?? 0;
  const enemyIncMult = Math.max(0, 1 + (opts.enemyExtraCritIncPct ?? 0) / 100);
  if (enemyFlat !== 0 || enemyIncMult !== 1) {
    effectiveBonusPct = (effectiveBonusPct + enemyFlat) * enemyIncMult;
  }
  effectiveBonusPct = Math.max(0, effectiveBonusPct);

  const critMultiplierPct = 100 + effectiveBonusPct;
  const critMultiplier = critMultiplierPct / 100;
  const p = effectiveCritChance / 100;
  const critEffect = 1 - p + p * critMultiplier;

  return {
    baseCritChance,
    preLuckyCritChance,
    preBifurcateCritChance,
    effectiveCritChance,
    baseBonusPct,
    effectiveBonusPct,
    critMultiplierPct,
    critMultiplier,
    critEffect,
    critBifurcates,
  };
}

// ============================================================================
// 2. Effective Charges & Rage Cap Syncing
// ============================================================================

export interface ChargesAndRageOptions {
  /** Base max charges (defaults to 3 each). */
  baseMaxPower?: number;
  baseMaxFrenzy?: number;
  baseMaxEndurance?: number;
  /** Additional +N to Maximum Power/Frenzy/Endurance Charges from tree/items/ascendancy. */
  extraMaxPower?: number;
  extraMaxFrenzy?: number;
  extraMaxEndurance?: number;
  /** Config toggles: whether each charge type is enabled. */
  usePowerCharges?: boolean;
  useFrenzyCharges?: boolean;
  useEnduranceCharges?: boolean;
  /** Optional explicit user count overrides (if omitted/undefined, syncs to max when enabled). */
  explicitPowerCharges?: number | null;
  explicitFrenzyCharges?: number | null;
  explicitEnduranceCharges?: number | null;
  /** Ralakesh's Impatience: count as having maximum charges even if not generated. */
  countAsMaxPower?: boolean;
  countAsMaxFrenzy?: boolean;
  countAsMaxEndurance?: boolean;
  /** Slayer Masterful Form: Maximum Endurance Charges equals Maximum Frenzy Charges. */
  masterfulForm?: boolean;
  /** Badge of the Brotherhood: Maximum Frenzy Charges equals Maximum Power Charges. */
  badgeOfTheBrotherhood?: boolean;
  /** Base max Rage (defaults to 30). */
  baseMaxRage?: number;
  /** Additional +N to Maximum Rage (e.g. +10 from tree/Berserk -> 40 on Juggernaut). */
  extraMaxRage?: number;
  /** Whether Rage is active in config. */
  useRage?: boolean;
  /** Optional explicit user Rage override (if omitted/undefined, syncs to maxRage when enabled). */
  explicitRage?: number | null;
}

export interface EffectiveChargesAndRage {
  power: number;
  maxPower: number;
  frenzy: number;
  maxFrenzy: number;
  endurance: number;
  maxEndurance: number;
  rage: number;
  maxRage: number;
}

/**
 * Resolves dynamic charge caps (Power, Frenzy, Endurance) and Rage cap,
 * auto-syncing active counts to max when enabled without an explicit lower cap,
 * and honoring Ralakesh's Impatience, Masterful Form, and Badge of the Brotherhood.
 */
export function resolveEffectiveChargesAndRage(
  opts: ChargesAndRageOptions,
): EffectiveChargesAndRage {
  const maxPower = Math.max(0, Math.floor((opts.baseMaxPower ?? 3) + (opts.extraMaxPower ?? 0)));
  let maxFrenzy = Math.max(0, Math.floor((opts.baseMaxFrenzy ?? 3) + (opts.extraMaxFrenzy ?? 0)));
  if (opts.badgeOfTheBrotherhood) {
    maxFrenzy = maxPower;
  }
  let maxEndurance = Math.max(
    0,
    Math.floor((opts.baseMaxEndurance ?? 3) + (opts.extraMaxEndurance ?? 0)),
  );
  if (opts.masterfulForm) {
    maxEndurance = maxFrenzy;
  }

  const resolveCount = (
    enabled: boolean | undefined,
    countAsMax: boolean | undefined,
    explicit: number | null | undefined,
    max: number,
  ): number => {
    if (countAsMax) return max;
    if (!enabled) return 0;
    if (explicit !== undefined && explicit !== null) {
      return clamp(Math.floor(explicit), 0, max);
    }
    return max;
  };

  const power = resolveCount(
    opts.usePowerCharges,
    opts.countAsMaxPower,
    opts.explicitPowerCharges,
    maxPower,
  );
  const frenzy = resolveCount(
    opts.useFrenzyCharges,
    opts.countAsMaxFrenzy,
    opts.explicitFrenzyCharges,
    maxFrenzy,
  );
  const endurance = resolveCount(
    opts.useEnduranceCharges,
    opts.countAsMaxEndurance,
    opts.explicitEnduranceCharges,
    maxEndurance,
  );

  const maxRage = Math.max(0, Math.floor((opts.baseMaxRage ?? 30) + (opts.extraMaxRage ?? 0)));
  const rage = opts.useRage
    ? opts.explicitRage !== undefined && opts.explicitRage !== null
      ? clamp(Math.floor(opts.explicitRage), 0, maxRage)
      : maxRage
    : 0;

  return {
    power,
    maxPower,
    frenzy,
    maxFrenzy,
    endurance,
    maxEndurance,
    rage,
    maxRage,
  };
}

// ============================================================================
// 3. Archmage Mana-to-Lightning Scaling (PoE 1 & PoE 2)
// ============================================================================

/**
 * Official PoB1 `sup_int.lua` `SupportArchmage` level table:
 * `archmage_gain_lightning_damage_%_of_max_unreserved_mana` for gem levels 1..40.
 */
export const POE1_ARCHMAGE_MANA_PCT_BY_LEVEL: readonly number[] = [
  8, 8, 9, 9, 9, 10, 10, 10, 11, 11,
  11, 12, 12, 12, 13, 13, 13, 14, 14, 14,
  15, 15, 15, 16, 16, 16, 17, 17, 17, 18,
  18, 18, 18, 18, 18, 19, 19, 19, 19, 19,
] as const;

export interface ArchmageBonusResult {
  game: GameId;
  /** PoE 2: % of Damage Gained as Extra Lightning Damage (0 for PoE 1). */
  gainAsExtraLightningPct: number;
  /** PoE 1: Flat Added Lightning Damage (min == max) to Spells (0 for PoE 2). */
  flatLightningMin: number;
  flatLightningMax: number;
  /** Percentage of Mana added to spell mana cost. */
  manaCostPct: number;
  /** Flat added Mana cost computed from maxMana * manaCostPct / 100. */
  addedManaCost: number;
  /** PoE 1: % of unreserved Mana converted to flat Lightning Damage (0 for PoE 2). */
  unreservedManaDamagePct: number;
}

/**
 * Computes Archmage bonus for PoE 1 and PoE 2 aligned with official PoB1 `sup_int.lua`
 * and PoB2 `act_int.lua`.
 *
 * - **PoE 2**: Grants `4%` of Damage Gained as Extra Lightning Damage per `100` Maximum Mana
 *   (`Math.floor(maxMana / 100) * 4`, e.g. 3402 Mana -> +136% Gain as Extra Lightning).
 *   Adds `8.0% - 0.1% * (gemLevel - 1)` of Maximum Mana to Non-Channelling Spell Mana Cost.
 * - **PoE 1**: Adds flat Lightning Damage to Spells equal to `pct%` of Unreserved Mana
 *   (from `POE1_ARCHMAGE_MANA_PCT_BY_LEVEL` by gem level; `manaCostPct` defaults to 5% of
 *   unreserved Mana).
 */
export function computeArchmageBonus(
  game: GameId,
  maxMana: number,
  gemLevel: number = 20,
  manaCostPct?: number,
): ArchmageBonusResult {
  const safeMana = Math.max(0, maxMana);
  const clampedLevel = clamp(Math.floor(gemLevel), 1, 40);

  if (game === 'poe2') {
    const gainAsExtraLightningPct = Math.floor(safeMana / 100) * 4;
    // PoB2 act_int.lua: 800 permyriad at Lv1, -10 permyriad per level (clamped >= 100 permyriad)
    const defaultCostPct = Math.max(1, (800 - (clampedLevel - 1) * 10) / 100);
    const resolvedCostPct = manaCostPct ?? defaultCostPct;
    return {
      game: 'poe2',
      gainAsExtraLightningPct,
      flatLightningMin: 0,
      flatLightningMax: 0,
      manaCostPct: resolvedCostPct,
      addedManaCost: (safeMana * resolvedCostPct) / 100,
      unreservedManaDamagePct: 0,
    };
  }

  // PoE 1: SupArchmage adds flat Lightning Damage = pct% of unreserved Mana
  const unreservedManaDamagePct = POE1_ARCHMAGE_MANA_PCT_BY_LEVEL[clampedLevel - 1] ?? 14;
  const flatLightning = (safeMana * unreservedManaDamagePct) / 100;
  const resolvedCostPct = manaCostPct ?? 5;
  return {
    game: 'poe1',
    gainAsExtraLightningPct: 0,
    flatLightningMin: flatLightning,
    flatLightningMax: flatLightning,
    manaCostPct: resolvedCostPct,
    addedManaCost: (safeMana * resolvedCostPct) / 100,
    unreservedManaDamagePct,
  };
}

// ============================================================================
// 4. Skill Special Damage (Detonate Dead, Spell DoTs, Stages, Burst, Ephemeral Edge)
// ============================================================================

/**
 * Exact PoB2 `Data/Misc.lua` `monsterLifeTable` (index 0 = Lv.1 .. index 99 = Lv.100).
 * Lv.82 = 32,956.
 */
export const POE2_MONSTER_LIFE_TABLE: readonly number[] = [
  15, 20, 24, 28, 33, 38, 45, 50, 58, 67,
  78, 89, 103, 118, 134, 158, 178, 200, 224, 249,
  276, 305, 335, 366, 400, 434, 472, 510, 551, 593,
  637, 683, 731, 790, 853, 921, 995, 1074, 1160, 1253,
  1353, 1462, 1578, 1705, 1841, 1967, 2101, 2244, 2395, 2556,
  2726, 2909, 3102, 3307, 3525, 3756, 4002, 4264, 4540, 4834,
  5147, 5478, 5829, 6203, 6555, 7079, 7646, 8257, 8918, 11148,
  11984, 12882, 13849, 14887, 18609, 20005, 21505, 23118, 24852, 31065,
  31997, 32956, 33945, 34963, 36012, 37093, 38206, 39352, 40532, 41748,
  43001, 44291, 45619, 46988, 48398, 49850, 51345, 52885, 54472, 56106,
] as const;

/** Returns official PoB2 base monster life for a given enemy/corpse level (clamped 1..100). */
export function getPoe2MonsterLife(enemyLevel: number): number {
  const idx = clamp(Math.floor(enemyLevel), 1, POE2_MONSTER_LIFE_TABLE.length) - 1;
  return POE2_MONSTER_LIFE_TABLE[idx] ?? 15;
}

/**
 * Computes Ephemeral Edge's flat added maximum Lightning Damage:
 * "Attacks with this Weapon have Added Maximum Lightning Damage equal to 20% of Player's Maximum Energy Shield"
 */
export function computeEphemeralEdgeLightning(
  maxEs: number,
  esPct: number = 20,
): { min: number; max: number; avg: number } {
  const max = Math.max(0, maxEs) * (Math.max(0, esPct) / 100);
  return { min: 0, max, avg: max / 2 };
}

/**
 * Reference Lv.20 base DoT DPS values for PoE 1 Spell DoT skills (per second),
 * scaled cleanly by gem level (~11.5% per level around Lv.20 when exact table isn't supplied).
 */
const POE1_SPELL_DOT_LV20_BASE: Record<
  string,
  { type: DamageType; lv20Dps: number; spellDmgApplies: boolean; canHit: boolean; maxStages?: number }
> = {
  exsanguinate: {
    type: 'Physical',
    lv20Dps: 1568.5,
    spellDmgApplies: true,
    canHit: true,
    maxStages: 3,
  },
  reap: {
    type: 'Physical',
    lv20Dps: 2522.7,
    spellDmgApplies: true,
    canHit: true,
    maxStages: 5,
  },
  'corrupting fever': {
    type: 'Physical',
    lv20Dps: 1363.9,
    spellDmgApplies: false,
    canHit: false,
    maxStages: 10,
  },
  'essence drain': {
    type: 'Chaos',
    lv20Dps: 1621.8,
    spellDmgApplies: true,
    canHit: true,
  },
  blight: {
    type: 'Chaos',
    lv20Dps: 315.4,
    spellDmgApplies: true,
    canHit: false,
    maxStages: 20,
  },
  'blight of contagion': {
    type: 'Chaos',
    lv20Dps: 315.4,
    spellDmgApplies: true,
    canHit: false,
    maxStages: 6,
  },
  'blight of atrophy': {
    type: 'Chaos',
    lv20Dps: 315.4,
    spellDmgApplies: true,
    canHit: false,
    maxStages: 6,
  },
  bane: {
    type: 'Chaos',
    lv20Dps: 1243.45,
    spellDmgApplies: true,
    canHit: false,
  },
  'bane of condemnation': {
    type: 'Chaos',
    lv20Dps: 1685.3,
    spellDmgApplies: true,
    canHit: false,
  },
  contagion: {
    type: 'Chaos',
    lv20Dps: 336.52,
    spellDmgApplies: true,
    canHit: false,
  },
  'contagion of subsiding': {
    type: 'Chaos',
    lv20Dps: 2017.32,
    spellDmgApplies: true,
    canHit: false,
  },
  'contagion of transference': {
    type: 'Chaos',
    lv20Dps: 1117.7,
    spellDmgApplies: true,
    canHit: false,
  },
  'vaal blight': {
    type: 'Chaos',
    lv20Dps: 962.52,
    spellDmgApplies: true,
    canHit: false,
  },
  'vaal blight of contagion': {
    type: 'Chaos',
    lv20Dps: 962.52,
    spellDmgApplies: true,
    canHit: false,
  },
  'vaal blight of atrophy': {
    type: 'Chaos',
    lv20Dps: 962.52,
    spellDmgApplies: true,
    canHit: false,
  },
  'scorching ray': {
    type: 'Fire',
    lv20Dps: 914.03,
    spellDmgApplies: true,
    canHit: false,
    maxStages: 8,
  },
  'scorching ray of immolation': {
    type: 'Fire',
    lv20Dps: 2744,
    spellDmgApplies: true,
    canHit: false,
  },
  'searing bond': {
    type: 'Fire',
    lv20Dps: 4430.6,
    spellDmgApplies: true,
    canHit: false,
  },
  'searing bond of detonation': {
    type: 'Fire',
    lv20Dps: 2977.7,
    spellDmgApplies: true,
    canHit: false,
  },
  'death aura': {
    type: 'Chaos',
    lv20Dps: 765,
    spellDmgApplies: false,
    canHit: false,
  },
  'wintertide brand': {
    type: 'Cold',
    lv20Dps: 342,
    spellDmgApplies: true,
    canHit: false,
    maxStages: 20,
  },
  vortex: {
    type: 'Cold',
    lv20Dps: 2376.4,
    spellDmgApplies: true,
    canHit: true,
  },
  'cold snap': {
    type: 'Cold',
    lv20Dps: 1941.2,
    spellDmgApplies: true,
    canHit: true,
  },
};

export interface SkillSpecialDamageOptions {
  /** Active gem level (default 20). */
  gemLevel?: number;
  /** Enemy / corpse level for corpse explosion skills (default 82). */
  enemyLevel?: number;
  /** Explicit corpse maximum life override (if omitted, uses monster life table). */
  corpseLife?: number;
  /** Explicit corpse explosion life % override (e.g. 0.116 for 11.6%). */
  corpseLifePct?: number;
  /** Player maximum Life (for Righteous Fire, Forbidden Rite). */
  maxLife?: number;
  /** Player maximum Energy Shield (for Righteous Fire, Forbidden Rite, Ephemeral Edge). */
  maxEs?: number;
  /** Player maximum Mana (for Righteous Fire of Arcane Devotion). */
  maxMana?: number;
  /** Skill stages / stacks / energy / blood charges. */
  stages?: number;
  /** Whether Winter Orb is actively channelling (doubles fire frequency). */
  isChannelling?: boolean;
  /** Whether Flicker Strike has Frenzy/Power charge cooldown bypass active. */
  hasChargeBypass?: boolean;
  /** Active Power Charges (for PoE 2 Flicker Strike burst hits). */
  powerCharges?: number;
  /** Whether Ephemeral Edge is equipped (adds 20% of Max ES as Max Lightning Damage). */
  ephemeralEdge?: boolean;
  /** Ephemeral Edge % roll override (default 20). */
  ephemeralEdgePct?: number;
  /** Optional exact base DoT DPS override (e.g. from gem level table). */
  baseDotOverride?: number;
  /** When true, official `poe{1,2}-gems.json` `cmods`/`sdata` are already injected, so skip static stage approximations that would double-count. */
  hasCompiledSkillMods?: boolean;
  /** When true, `skillData` already contains non-ailment base DoT (`*Dot`), so skip static `POE1_SPELL_DOT_LV20_BASE`. */
  hasSkillDotData?: boolean;
}

export interface SkillSpecialDamageResult {
  /** Additional flat base damage to add to the skill's hit damage. */
  flatAddedDamage: Partial<Record<DamageType, { min: number; max: number }>>;
  /** Base non-ailment Damage over Time DPS by damage type. */
  baseDotDps: Partial<Record<DamageType, number>>;
  /** Whether the skill can hit enemies (false for Righteous Fire, Blight, Corrupting Fever). */
  canHit: boolean;
  /** Whether the skill can inflict Ignite (false for Righteous Fire). */
  canIgnite: boolean;
  /** Whether Spell Damage modifiers apply to the skill's DoT. */
  spellDmgAppliesToDot: boolean;
  /** Multiplicative hit damage multiplier from stages/charges (default 1). */
  hitMoreMult: number;
  /** Multiplicative ailment damage multiplier from stages (default 1). */
  ailmentMoreMult: number;
  /** Multiplicative DoT multiplier from stages/stacks (default 1). */
  dotMoreMult: number;
  /** Increased hit/fire rate % from stages (e.g. Winter Orb). */
  hitRateIncPct: number;
  /** Multiplicative hit/fire rate multiplier (e.g. Winter Orb channelling 2x, PoE 2 Flicker burst). */
  hitRateMoreMult: number;
  /** If true, engine MUST NOT cap attack speed by skill cooldown (Flicker Strike). */
  bypassCooldown: boolean;
  /** Global Spell Damage MORE % buff granted by skill (e.g. Righteous Fire +39% at Lv20). */
  buffSpellMorePct: number;
  /** Resolved corpse life (for Detonate Dead). */
  corpseLife?: number;
  /** Resolved corpse life fraction (e.g. 0.116 for 11.6% at Lv23). */
  corpseLifePct?: number;
}

function defaultSkillSpecialResult(): SkillSpecialDamageResult {
  return {
    flatAddedDamage: {},
    baseDotDps: {},
    canHit: true,
    canIgnite: true,
    spellDmgAppliesToDot: false,
    hitMoreMult: 1,
    ailmentMoreMult: 1,
    dotMoreMult: 1,
    hitRateIncPct: 0,
    hitRateMoreMult: 1,
    bypassCooldown: false,
    buffSpellMorePct: 0,
  };
}

function addFlatDamage(
  target: Partial<Record<DamageType, { min: number; max: number }>>,
  type: DamageType,
  min: number,
  max: number,
): void {
  const prev = target[type];
  if (prev) {
    target[type] = { min: prev.min + min, max: prev.max + max };
  } else {
    target[type] = { min, max };
  }
}

/**
 * Computes special skill mechanics aligned with PoB1 & PoB2:
 * - PoE 2 `Detonate Dead` corpse explosion Physical damage
 * - PoE 1 `Righteous Fire` (Life + ES burn DoT + 39% more Spell Damage buff, no hit/ignite)
 * - PoE 1 Spell DoT skills (`Exsanguinate`, `Reap`, `Corrupting Fever`, `Essence Drain`, `Blight`, `Vortex`, `Cold Snap`)
 * - PoE 1 `Forbidden Rite` & `Forbidden Rite of Soul Sacrifice` (Life/ES -> Chaos base damage)
 * - PoE 1 Stage / Burst skills (`Vaal Flameblast`, `Winter Orb`, `Flicker Strike`, `Penance Brand of Dissipation`)
 * - `Ephemeral Edge` (20% of Max ES added as Max Lightning Damage)
 */
export function computeSkillSpecialDamage(
  skillName: string,
  game: GameId,
  opts: SkillSpecialDamageOptions = {},
): SkillSpecialDamageResult {
  const res = defaultSkillSpecialResult();
  const key = skillName.trim().toLowerCase();
  const gemLevel = clamp(Math.floor(opts.gemLevel ?? 20), 1, 40);

  // Ephemeral Edge unique weapon bonus (applies to any attack using it)
  if (opts.ephemeralEdge && (opts.maxEs ?? 0) > 0) {
    const ee = computeEphemeralEdgeLightning(opts.maxEs ?? 0, opts.ephemeralEdgePct ?? 20);
    addFlatDamage(res.flatAddedDamage, 'Lightning', ee.min, ee.max);
  }

  // PoE 2 Detonate Dead corpse explosion
  if (key === 'detonate dead' && game === 'poe2') {
    const corpseLife = opts.corpseLife ?? getPoe2MonsterLife(opts.enemyLevel ?? 82);
    // PoB2 act_int.lua: corpse_explosion_monster_life_permillage_physical = 50 + (level - 1) * 3
    const corpseLifePct = opts.corpseLifePct ?? (50 + (gemLevel - 1) * 3) / 1000;
    const physDmg = corpseLife * corpseLifePct;
    addFlatDamage(res.flatAddedDamage, 'Physical', physDmg, physDmg);
    res.corpseLife = corpseLife;
    res.corpseLifePct = corpseLifePct;
    return res;
  }

  // PoE 1 Righteous Fire (3.23+: pure 70% of Max Life + Max ES, no flat base; cannot hit or ignite)
  if (key === 'righteous fire' && game === 'poe1') {
    const life = Math.max(0, opts.maxLife ?? 0);
    const es = Math.max(0, opts.maxEs ?? 0);
    // PoB1 act_int.lua: 4200% per minute = 70% per second of Max Life + Max ES
    res.baseDotDps.Fire = opts.baseDotOverride ?? 0.7 * (life + es);
    res.canHit = false;
    res.canIgnite = false;
    // PoB1 act_int.lua: 20% more Spell Damage at Lv1, +1% per level -> 39% at Lv20, 40% at Lv21
    res.buffSpellMorePct = 20 + (gemLevel - 1);
    return res;
  }

  // PoE 1 Righteous Fire of Arcane Devotion (70% of Max Mana, Spell Damage applies to DoT; cannot hit or ignite)
  if (key === 'righteous fire of arcane devotion' && game === 'poe1') {
    const mana = Math.max(0, opts.maxMana ?? 0);
    res.baseDotDps.Fire = opts.baseDotOverride ?? 0.7 * mana;
    res.canHit = false;
    res.canIgnite = false;
    res.spellDmgAppliesToDot = true;
    return res;
  }

  // PoE 1 Vaal Righteous Fire variants (sacrifices 60% of Life+ES / Mana, deals 158% of sacrificed as Fire DoT)
  if (
    (key === 'vaal righteous fire' || key === 'vaal righteous fire of arcane devotion') &&
    game === 'poe1'
  ) {
    const pool =
      key === 'vaal righteous fire of arcane devotion'
        ? Math.max(0, opts.maxMana ?? 0)
        : Math.max(0, opts.maxLife ?? 0) + Math.max(0, opts.maxEs ?? 0);
    // PoB1 act_int.lua Lv20: percentSacrificed = 0.6, RFMultiplier = 1.58 (1.20 + 0.02 * (lv - 1))
    const rfMult = 1.2 + (gemLevel - 1) * 0.02;
    res.baseDotDps.Fire = opts.baseDotOverride ?? 0.6 * rfMult * pool;
    res.canHit = false;
    res.canIgnite = false;
    res.spellDmgAppliesToDot = key === 'vaal righteous fire of arcane devotion';
    return res;
  }

  // PoE 1 Forbidden Rite & Forbidden Rite of Soul Sacrifice
  if (key === 'forbidden rite of soul sacrifice') {
    const chaosBase = 0.2 * Math.max(0, opts.maxEs ?? 0);
    addFlatDamage(res.flatAddedDamage, 'Chaos', chaosBase, chaosBase);
    return res;
  }
  if (key === 'forbidden rite') {
    const chaosBase =
      0.14 * Math.max(0, opts.maxLife ?? 0) + 0.05 * Math.max(0, opts.maxEs ?? 0);
    addFlatDamage(res.flatAddedDamage, 'Chaos', chaosBase, chaosBase);
    return res;
  }

  // PoE 1 Spell DoT skills (Exsanguinate, Reap, Corrupting Fever, Essence Drain, Blight, Bane, Wintertide Brand, Vortex, Cold Snap)
  const dotProfile = POE1_SPELL_DOT_LV20_BASE[key];
  if (dotProfile && game === 'poe1') {
    res.canHit = dotProfile.canHit;
    res.spellDmgAppliesToDot = dotProfile.spellDmgApplies;
    if (!opts.hasSkillDotData) {
      const levelScale = Math.pow(1.115, gemLevel - 20);
      const baseDps = opts.baseDotOverride ?? dotProfile.lv20Dps * levelScale;
      res.baseDotDps[dotProfile.type] = baseDps;

      if (!opts.hasCompiledSkillMods) {
        if (key === 'exsanguinate') {
          const stages = clamp(Math.floor(opts.stages ?? 3), 1, dotProfile.maxStages ?? 3);
          res.dotMoreMult = stages; // +100% more DoT per stage after first -> 3x at 3 stages
        } else if (key === 'reap') {
          const bloodCharges = clamp(Math.floor(opts.stages ?? 5), 0, dotProfile.maxStages ?? 5);
          // 15% more Damage per Blood Charge (applies to both hit and DoT)
          const chargeMult = 1 + 0.15 * bloodCharges;
          res.hitMoreMult = chargeMult;
          res.dotMoreMult = chargeMult;
        } else if (key === 'corrupting fever') {
          const stages = clamp(Math.floor(opts.stages ?? 10), 1, dotProfile.maxStages ?? 10);
          res.dotMoreMult = stages; // +100% more DoT per stack after first -> 10x at 10 stacks
        } else if (key === 'blight') {
          const stages = clamp(Math.floor(opts.stages ?? 20), 1, dotProfile.maxStages ?? 20);
          res.dotMoreMult = stages;
        }
      }
      return res;
    }
  }

  if (opts.hasCompiledSkillMods) {
    // Only keep dynamic pool/charge mechanics not expressed as static cmods (RF, FR, DD, Ephemeral Edge, Flicker cooldown bypass)
    if (key === 'flicker strike') {
      if (game === 'poe1') {
        res.bypassCooldown = opts.hasChargeBypass ?? true;
      } else {
        const pc = Math.max(0, Math.floor(opts.powerCharges ?? 0));
        res.bypassCooldown = true;
        res.hitRateMoreMult = pc > 0 ? 1 + 2 * pc : 1;
      }
    }
    return res;
  }

  // PoE 1 Vaal Flameblast
  if (key === 'vaal flameblast') {
    // PoB1 act_int.lua: 200% more Hit & 110% more Ailment per stage (max 15; standard 10)
    const stages = clamp(Math.floor(opts.stages ?? 10), 1, 15);
    res.hitMoreMult = 1 + 2.0 * stages;
    res.ailmentMoreMult = 1 + 1.1 * stages;
    return res;
  }

  // PoE 1 Winter Orb
  if (key === 'winter orb') {
    // PoB1 act_int.lua: +20% increased fire rate per stage after first; 2x fire rate while channelling
    const stages = clamp(Math.floor(opts.stages ?? 10), 1, 12);
    res.hitRateIncPct = 20 * Math.max(0, stages - 1);
    res.hitRateMoreMult = opts.isChannelling ? 2 : 1;
    return res;
  }

  // Flicker Strike (PoE 1 cooldown bypass + PoE 2 Power Charge burst)
  if (key === 'flicker strike') {
    if (game === 'poe1') {
      res.bypassCooldown = opts.hasChargeBypass ?? true;
    } else {
      // PoE 2 Flicker Strike consumes Power Charges for burst strikes (1 + 2 * PC base)
      const pc = Math.max(0, Math.floor(opts.powerCharges ?? 0));
      res.bypassCooldown = true;
      res.hitRateMoreMult = pc > 0 ? 1 + 2 * pc : 1;
    }
    return res;
  }

  // PoE 1 Penance Brand of Dissipation
  if (key === 'penance brand of dissipation') {
    // PoB1 act_int.lua: +20% more Hit & Ailment damage per Energy after first (up to 20 Energy)
    const energy = clamp(Math.floor(opts.stages ?? 20), 1, 20);
    const mult = 1 + 0.2 * Math.max(0, energy - 1);
    res.hitMoreMult = mult;
    res.ailmentMoreMult = mult;
    return res;
  }

  return res;
}

// ============================================================================
// 5. Effective Enemy Resistance (Rakiata's Flow, Sacred Flame, Inevitable Judgement)
// ============================================================================

export interface EffectiveEnemyResistanceOptions {
  /** Damage element being evaluated (default 'Lightning'). */
  element?: DamageType;
  /** All elemental resistances of the enemy (required for Sacred Flame lowest-res lookup). */
  allElementalResists?: { Fire: number; Cold: number; Lightning: number };
  /** Exposure reduction % (positive value, e.g. 15 reduces resist by 15). */
  exposurePct?: number;
  /** Curse / debuff resistance reduction % (positive value, e.g. 34 reduces resist by 34). */
  curseReductionPct?: number;
  /** Resistance penetration % (positive value, e.g. 15 penetrates 15% resist on hits). */
  penetrationPct?: number;
  /** PoE 2 minimum resistance reachable via penetration (undefined for PoE 1; 0 for PoE 2, -50 for Leopold's Applause). */
  minPenRes?: number;
  /** Enemy max resistance cap (default 75). */
  maxResistCap?: number;
  /** Enemy minimum resistance floor (default -200). */
  resistFloor?: number;
  /** Rakiata's Flow: inverts enemy elemental resistances (50% -> -50%). */
  invertEnemyEleRes?: boolean;
  /** Partial chance (0..1) to treat enemy elemental resistance as inverted (e.g. 0.25 Mastery). */
  invertChance?: number;
  /** Sacred Flame: enemies resist elemental damage based on their lowest elemental resistance. */
  useLowestEleRes?: boolean;
  /** Inquisitor Inevitable Judgement: Critical Strikes ignore Enemy Elemental Resistances (0%). */
  ignoreOnCrit?: boolean;
  /** Effective critical strike chance % (0..100) used to blend Inevitable Judgement. */
  critChancePct?: number;
}

export interface EffectiveEnemyResistanceResult {
  /** Effective enemy resistance % after lowest-res, debuffs, inversion, and penetration. */
  effectiveResist: number;
  /** Damage multiplier taken by enemy from resistance: (100 - effectiveResist) / 100. */
  damageMult: number;
  /** Multiplier on critical strikes (1.0 when Inevitable Judgement applies). */
  critDamageMult: number;
  /** Multiplier on non-critical strikes. */
  nonCritDamageMult: number;
  /** Whether resistance inversion was applied. */
  inverted: boolean;
  /** Whether Inevitable Judgement ignored resistance on crits. */
  ignoredOnCrit: boolean;
  /** Whether Sacred Flame lowest elemental resistance was used. */
  usedLowest: boolean;
}

/**
 * Computes effective enemy resistance and resulting damage multiplier, handling:
 * - **Rakiata's Flow** (`invertEnemyEleRes`: `50% -> -50%`, `1.5 / 0.5 = 3.0x` multiplier)
 * - **Sacred Flame** (`useLowestEleRes`: uses `min(Fire, Cold, Lightning)` resistance)
 * - **Inevitable Judgement** (`ignoreOnCrit`: crits treat elemental resistance as `0%`)
 * - Exposure, curses, penetration, and resistance floor/cap.
 */
export function computeEffectiveEnemyResistance(
  baseEnemyRes: number,
  opts: EffectiveEnemyResistanceOptions = {},
): EffectiveEnemyResistanceResult {
  const element = opts.element ?? 'Lightning';
  const isElemental = element === 'Fire' || element === 'Cold' || element === 'Lightning';
  const maxCap = opts.maxResistCap ?? 75;
  const minFloor = opts.resistFloor ?? -200;

  let res = baseEnemyRes;
  let usedLowest = false;

  // 1. Sacred Flame: use lowest elemental resistance
  if (isElemental && opts.useLowestEleRes && opts.allElementalResists) {
    const { Fire, Cold, Lightning } = opts.allElementalResists;
    res = Math.min(Fire, Cold, Lightning);
    usedLowest = true;
  }

  // 2. Apply exposure & curses, then clamp to [minFloor, maxCap]
  res = res - (opts.exposurePct ?? 0) - (opts.curseReductionPct ?? 0);
  res = clamp(res, minFloor, maxCap);

  // 3. Penetration
  const pen = opts.penetrationPct ?? 0;

  // 4. Rakiata's Flow / Inversion Mastery
  const invertChance = isElemental
    ? opts.invertEnemyEleRes
      ? 1
      : clamp(opts.invertChance ?? 0, 0, 1)
    : 0;
  const inverted = invertChance > 0;

  const applyPen = (baseR: number): number => {
    const cappedR = clamp(baseR, minFloor, maxCap);
    if (opts.minPenRes !== undefined) {
      return cappedR > opts.minPenRes
        ? clamp(Math.max(opts.minPenRes, cappedR - pen), minFloor, maxCap)
        : cappedR;
    }
    return clamp(cappedR - pen, minFloor, maxCap);
  };
  const normalRes = applyPen(res);
  const invertedRes = applyPen(-res);

  const normalMult = (100 - normalRes) / 100;
  const invertedMult = (100 - invertedRes) / 100;
  const nonCritDamageMult = (1 - invertChance) * normalMult + invertChance * invertedMult;
  const effectiveNonCritRes = (1 - invertChance) * normalRes + invertChance * invertedRes;

  // 5. Inevitable Judgement: crits ignore enemy elemental resistances (treat as 0% -> 1.0x)
  const ignoredOnCrit = isElemental && Boolean(opts.ignoreOnCrit);
  const critDamageMult = ignoredOnCrit ? 1.0 : nonCritDamageMult;

  const critRatio =
    opts.critChancePct !== undefined
      ? clamp(opts.critChancePct, 0, 100) / 100
      : ignoredOnCrit
        ? 1
        : 0;

  const damageMult = ignoredOnCrit
    ? (1 - critRatio) * nonCritDamageMult + critRatio * critDamageMult
    : nonCritDamageMult;

  const effectiveResist = 100 - damageMult * 100;

  return {
    effectiveResist: ignoredOnCrit ? effectiveResist : effectiveNonCritRes,
    damageMult,
    critDamageMult,
    nonCritDamageMult,
    inverted,
    ignoredOnCrit,
    usedLowest,
  };
}

// ============================================================================
// 6. Ailment Speed & Magnitude Scaling (PoE 1 & PoE 2)
// ============================================================================

export interface AilmentScalingOptions {
  /** Sum of "Damaging Ailments / Ignite / Bleeding / Poison deal damage X% faster". */
  fasterPct?: number;
  /** Sum of "Damaging Ailments deal damage X% slower" (divides rate). */
  slowerPct?: number;
  /** PoE 2: Sum of "X% increased Magnitude of (Damaging Ailments|Ignite|Bleeding|Poison)". */
  magnitudeIncPct?: number;
  /** PoE 2: Product of MORE Ailment Magnitude multipliers (default 1). */
  magnitudeMoreMult?: number;
  /** PoE 1: Damage over Time Multiplier % (e.g. 80 -> 1.80x). */
  dotMultiPct?: number;
  /** Optional base ailment duration in seconds (default 4). */
  baseDurationSec?: number;
  /** Sum of "% increased Ailment Duration" (default 0). */
  durationIncPct?: number;
}

export interface AilmentScalingResult {
  /** Final scaled ailment DPS. */
  scaledDps: number;
  /** Multiplicative DPS factor from faster/slower speed. */
  fasterMult: number;
  /** Multiplicative factor from PoE 2 Ailment Magnitude. */
  magnitudeMult: number;
  /** Multiplicative factor from PoE 1 DoT Multiplier. */
  dotMulti: number;
  /** Combined multiplicative DPS factor (fasterMult * magnitudeMult * dotMulti). */
  totalMult: number;
  /** Effective ailment duration in seconds (inversely scaled by fasterMult). */
  effectiveDurationSec: number;
  /** Total damage dealt over one full ailment application (scaledDps * effectiveDurationSec). */
  totalDamage: number;
}

/**
 * Scales ailment DPS by PoE 1 & PoE 2 "Damaging Ailments deal damage X% faster",
 * PoE 2 Ailment Magnitude ("X% increased Magnitude of Damaging Ailments / Ignite / Bleeding / Poison"),
 * and PoE 1 DoT Multiplier, while adjusting effective duration inversely with faster speed.
 */
export function computeAilmentScaling(
  baseDps: number,
  opts: AilmentScalingOptions = {},
): AilmentScalingResult {
  const safeBase = Math.max(0, baseDps);
  const fasterRate = Math.max(0.1, 1 + (opts.fasterPct ?? 0) / 100);
  const slowerRate = Math.max(0.1, 1 + (opts.slowerPct ?? 0) / 100);
  const fasterMult = fasterRate / slowerRate;

  const magnitudeMult =
    Math.max(0, 1 + (opts.magnitudeIncPct ?? 0) / 100) * Math.max(0, opts.magnitudeMoreMult ?? 1);
  const dotMulti = Math.max(0, 1 + (opts.dotMultiPct ?? 0) / 100);

  const totalMult = fasterMult * magnitudeMult * dotMulti;
  const scaledDps = safeBase * totalMult;

  const baseDuration = Math.max(0, opts.baseDurationSec ?? 4);
  const durationIncMult = Math.max(0, 1 + (opts.durationIncPct ?? 0) / 100);
  const effectiveDurationSec = (baseDuration * durationIncMult) / fasterMult;
  const totalDamage = scaledDps * effectiveDurationSec;

  return {
    scaledDps,
    fasterMult,
    magnitudeMult,
    dotMulti,
    totalMult,
    effectiveDurationSec,
    totalDamage,
  };
}

// ============================================================================
// 7. Weapon Type Normalization (PoE 2 Quarterstaff Fix)
// ============================================================================

/**
 * Normalizes weapon type classification, specifically fixing PoE 2 Quarterstaff
 * bases (`Sinister Quarterstaff`, `Crescent Quarterstaff`, `Gothic Quarterstaff`, etc.)
 * that were misclassified as `'Staff'` in base item tables.
 */
export function normalizeWeaponType(baseName: string, currentType?: string): string {
  const trimmed = baseName.trim();
  const lower = trimmed.toLowerCase();

  // PoE 2 Quarterstaff MUST resolve to 'Quarterstaff', never 'Staff'
  if (lower.includes('quarterstaff')) {
    return 'Quarterstaff';
  }

  // Other unambiguous PoE 2 weapon classes when currentType is missing or generic
  if (!currentType || currentType === 'None') {
    if (lower.includes('crossbow')) return 'Crossbow';
    if (lower.includes('spear')) return 'Spear';
    if (lower.includes('flail')) return 'Flail';
    if (lower.includes('warstaff') || lower.includes('staff')) return 'Staff';
  }

  return currentType ?? 'None';
}
