import {
  DAMAGE_TYPES,
  KeywordFlag,
  ModFlag,
  type CompiledGemMod,
  type DamageType,
  type EquipmentSlotId,
  type GameId,
  type GemDefinition,
  type GemInstance,
  type GemLevelStats,
  type Item,
  type Mod,
  type SkillGroup,
  type SkillPartDefinition,
  type WeaponSetId,
} from '@webpob/core';
import { ModDB } from './modDb.js';
import { parseSocketedGemBonuses, resolveGemBonuses } from './gemBonus.js';
import { getPoe2MonsterLife } from './offenceUpgrade.js';

export type GemDefLookup = (gemId: string) => GemDefinition | undefined;

// ============================================================================
// 1. Multi-Part Skill & PoE 2 StatSet Resolver
// ============================================================================

/**
 * Reference PoE 1 base normal-monster life breakpoints aligned with PoB1 `Data/Misc.lua`.
 * Used for PoE 1 `Detonate Dead` / `Detonate Dead of Scavenging` corpse explosion hits.
 */
const POE1_MONSTER_LIFE_ANCHORS: ReadonlyArray<[number, number]> = [
  [1, 52],
  [20, 443],
  [40, 1298],
  [60, 3198],
  [68, 4734],
  [70, 5289],
  [75, 7572],
  [78, 10127],
  [80, 11763],
  [81, 12798],
  [82, 13925],
  [83, 15152],
  [84, 16474],
  [85, 17901],
  [90, 26900],
  [100, 57800],
];

/** Returns PoB1-aligned base corpse maximum life for a given monster level (clamped 1..100). */
export function getPoe1MonsterLife(enemyLevel: number): number {
  const lv = Math.max(1, Math.min(100, Math.round(enemyLevel)));
  for (let i = 0; i < POE1_MONSTER_LIFE_ANCHORS.length; i++) {
    const [aLv, aHp] = POE1_MONSTER_LIFE_ANCHORS[i]!;
    if (aLv === lv) return aHp;
    if (aLv > lv && i > 0) {
      const [prevLv, prevHp] = POE1_MONSTER_LIFE_ANCHORS[i - 1]!;
      const t = (lv - prevLv) / (aLv - prevLv);
      return Math.round(prevHp * Math.pow(aHp / prevHp, t));
    }
  }
  return POE1_MONSTER_LIFE_ANCHORS[POE1_MONSTER_LIFE_ANCHORS.length - 1]![1];
}

/**
 * Exact PoB 1 `Data/Misc.lua:11` `monsterAllyLifeTable` (levels 1..100).
 * Used for PoE 1 Spell Totem / Ballista Totem life calculations (e.g. Bodyswap Spell Totem Self Explosion).
 */
const POE1_MONSTER_ALLY_LIFE_TABLE: readonly number[] = [
  15, 16, 18, 20, 22, 24, 27, 29, 32, 35,
  38, 41, 44, 48, 52, 56, 60, 65, 70, 75,
  81, 87, 93, 99, 106, 114, 121, 130, 138, 148,
  158, 168, 179, 190, 203, 215, 229, 244, 259, 275,
  292, 310, 328, 348, 369, 392, 415, 440, 465, 493,
  522, 552, 584, 618, 653, 691, 730, 772, 816, 862,
  910, 961, 1015, 1072, 1131, 1194, 1260, 1329, 1402, 1478,
  1559, 1644, 1733, 1827, 1926, 2029, 2138, 2253, 2373, 2500,
  2633, 2773, 2919, 3074, 3236, 3406, 3585, 3773, 3970, 4178,
  4395, 4624, 4864, 5116, 5381, 5659, 5951, 6257, 6578, 6916,
];

/** Exact PoB 1 `Data/Skills/sup_str.lua` `SupportSpellTotem` `totem_support_gem_level` table (Lv1..40). */
const POE1_SPELL_TOTEM_LEVEL_BY_GEM_LEVEL: readonly number[] = [
  8, 10, 13, 17, 21, 25, 29, 33, 37, 40,
  43, 46, 49, 52, 55, 58, 61, 64, 67, 70,
  72, 74, 76, 78, 80, 82, 84, 86, 88, 90,
  91, 92, 93, 94, 95, 96, 97, 98, 99, 100,
];

/** Maps a PoE 1 Spell Totem Support gem level (1..40) to its exact monster-ally totem level (8..100). */
export function getPoe1SpellTotemLevel(gemLevel: number): number {
  const idx = Math.max(1, Math.min(40, Math.round(gemLevel))) - 1;
  return POE1_SPELL_TOTEM_LEVEL_BY_GEM_LEVEL[idx] ?? 70;
}

/** Computes PoB 1 base totem maximum life (`CalcOffence.lua:340`: `floor(monsterAllyLifeTable[totemLevel] * totemLifeMult)`). */
export function getPoe1TotemBaseLife(totemLevel: number, totemLifeMult = 1): number {
  const lv = Math.max(1, Math.min(100, Math.round(totemLevel)));
  const base = POE1_MONSTER_ALLY_LIFE_TABLE[lv - 1] ?? 1478;
  return Math.floor(base * Math.max(0, totemLifeMult));
}

export interface ResolveSkillPartOptions {
  /** Override enemy / corpse level (defaults to 84 for PoE 1, 82 for PoE 2). */
  enemyLevel?: number;
  /** Override explicit corpse life for Detonate Dead / Bodyswap variants. */
  corpseLife?: number;
  /** Override game context (defaults to `gemDef.game`). */
  game?: GameId;
  /** Total skill duration multiplier `(1 + Duration INC/100) * Duration MORE` (e.g. Earthquake of Amplification Aftershock). */
  durationMultiplier?: number;
  /** Effective gem quality including Enhance / Dialla / Ashes bonuses (defaults to `gemInst.quality`). */
  effectiveQuality?: number;
  /** Player maximum life for self-explosion skills (e.g. PoE 1 Bodyswap Part 1). */
  playerMaxLife?: number;
  /** Totem maximum life when Bodyswap is cast by a Spell Totem (`isTotem = true`). */
  totemMaxLife?: number;
  /** Optional Spell Totem support gem level (1..40) used to compute base totem life when `totemMaxLife` is omitted. */
  totemSkillLevel?: number;
  /** Optional PoB 1 `totemLifeMult` multiplier (default 1.0 for Spell Totem). */
  totemLifeMult?: number;
  /** Optional summed `TotemLife` INC % when computing fallback totem life for `isTotem = true`. */
  totemLifeIncPct?: number;
  /** Optional product of `TotemLife` MORE multipliers when computing fallback totem life for `isTotem = true`. */
  totemLifeMoreMult?: number;
  /** True when the active skill is cast by a Totem (routes Bodyswap Self Explosion to `totemMaxLife`). */
  isTotem?: boolean;
  /** Minion maximum life for Bodyswap of Sacrifice Part 2 (Minion Explosion). */
  minionMaxLife?: number;
}

export interface ResolvedSkillPartStats {
  partIndex: number;
  partName: string;
  autoAdvancedPart: boolean;
  selectedPart?: SkillPartDefinition;
  spell: boolean;
  attack: boolean;
  melee: boolean;
  projectile: boolean;
  area: boolean;
  baseDamage: Partial<Record<DamageType, [number, number]>>;
  damageEffectivenessPct: number;
  attackDamageMultiplierPct?: number;
  attackSpeedMultiplier: number;
  critChance: number;
  compiledMods: CompiledGemMod[];
  skillData: Record<string, number | boolean | string>;
  /** Effective hit damage multiplier from multi-part sequence/aftershock mechanics (default 1). */
  sequenceDamageMultiplier: number;
  /** Effective hit/repeat count per skill use (default 1, e.g. 4 for Ice Nova of Frostbolts). */
  hitsPerUse: number;
  /** Resolved corpse maximum life when corpse explosion base damage is injected. */
  corpseLife?: number;
  /** Resolved corpse explosion life fraction (e.g. 0.06, 0.09, 0.107). */
  corpseExplosionPct?: number;
  /** Damage type of the injected corpse explosion hit. */
  corpseExplosionDamageType?: DamageType;
}

function interpolateDamageMaps(
  lowMap: Partial<Record<DamageType, [number, number]>> | undefined,
  highMap: Partial<Record<DamageType, [number, number]>> | undefined,
  t: number,
): Partial<Record<DamageType, [number, number]>> | undefined {
  if (!lowMap && !highMap) return undefined;
  if (!lowMap) return highMap ? { ...highMap } : undefined;
  if (!highMap) return { ...lowMap };
  const out: Partial<Record<DamageType, [number, number]>> = {};
  for (const dt of DAMAGE_TYPES) {
    const a = lowMap[dt];
    const b = highMap[dt];
    if (a && b) {
      const mn = a[0] > 0 && b[0] > 0 ? a[0] * Math.pow(b[0] / a[0], t) : a[0] + (b[0] - a[0]) * t;
      const mx = a[1] > 0 && b[1] > 0 ? a[1] * Math.pow(b[1] / a[1], t) : a[1] + (b[1] - a[1]) * t;
      out[dt] = [Math.round(mn), Math.round(mx)];
    } else if (a) {
      out[dt] = [a[0], a[1]];
    } else if (b) {
      out[dt] = [b[0], b[1]];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function resolveLevelFromMap(
  levels: Record<number, GemLevelStats> | undefined,
  effLevel: number,
): GemLevelStats | undefined {
  if (!levels) return undefined;
  const clamped = Math.max(1, Math.min(40, Math.round(effLevel)));
  if (levels[clamped]) return levels[clamped];
  // Level 20 is stored directly on GemDefinition / SkillPartDefinition when omitted from `ls`
  if (clamped === 20) return undefined;
  const keys = Object.keys(levels)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (keys.length === 0) return undefined;
  if (clamped <= keys[0]!) return levels[keys[0]!];
  if (clamped >= keys[keys.length - 1]!) return levels[keys[keys.length - 1]!];

  let low = keys[0]!;
  let high = keys[keys.length - 1]!;
  for (const k of keys) {
    if (k <= clamped) low = k;
    if (k >= clamped) {
      high = k;
      break;
    }
  }
  const lowE = levels[low];
  const highE = levels[high];
  if (!lowE || !highE || low === high) return lowE ?? highE;
  const t = (clamped - low) / (high - low);
  const lerp = (a?: number, b?: number) =>
    a !== undefined && b !== undefined ? Math.round((a + (b - a) * t) * 100) / 100 : (a ?? b);

  return {
    baseDamage: interpolateDamageMaps(lowE.baseDamage, highE.baseDamage, t),
    attackDamageMultiplierPct: lerp(lowE.attackDamageMultiplierPct, highE.attackDamageMultiplierPct),
    damageEffectivenessPct: lerp(lowE.damageEffectivenessPct, highE.damageEffectivenessPct),
    attackSpeedMultiplier: lerp(lowE.attackSpeedMultiplier, highE.attackSpeedMultiplier),
    critChance: lerp(lowE.critChance, highE.critChance),
    manaCost:
      lowE.manaCost !== undefined && highE.manaCost !== undefined
        ? Math.round(lowE.manaCost + (highE.manaCost - lowE.manaCost) * t)
        : (lowE.manaCost ?? highE.manaCost),
    stats: t < 0.5 ? lowE.stats : highE.stats,
    compiledMods: t < 0.5 ? lowE.compiledMods : highE.compiledMods,
    skillData: t < 0.5 ? lowE.skillData : highE.skillData,
  };
}

function hasPositiveBaseDamage(bd?: Partial<Record<DamageType, [number, number]>>): boolean {
  if (!bd) return false;
  for (const dt of DAMAGE_TYPES) {
    const r = bd[dt];
    if (r && (r[0] > 0 || r[1] > 0)) return true;
  }
  return false;
}

function partHasDamagingStats(part: SkillPartDefinition, levelEntry?: GemLevelStats): boolean {
  if (hasPositiveBaseDamage(levelEntry?.baseDamage ?? part.baseDamage)) {
    return true;
  }
  const am =
    levelEntry?.attackDamageMultiplierPct ??
    part.attackDamageMultiplierPct ??
    levelEntry?.attackSpeedMultiplier ??
    part.attackSpeedMultiplier;
  if (am !== undefined && am > 0) {
    return true;
  }
  const de = levelEntry?.damageEffectivenessPct ?? part.damageEffectiveness;
  if (de !== undefined && de > 0) {
    return true;
  }
  return false;
}

function cloneDamageMap(
  bd?: Partial<Record<DamageType, [number, number]>>,
): Partial<Record<DamageType, [number, number]>> {
  const out: Partial<Record<DamageType, [number, number]>> = {};
  if (!bd) return out;
  for (const dt of DAMAGE_TYPES) {
    const range = bd[dt];
    if (range) out[dt] = [range[0], range[1]];
  }
  return out;
}

/**
 * Resolves the active skill part / PoE 2 `statSet` and merges part-level stats on top of
 * base gem stats. Auto-advances past zero-damage PoE 2 setup `statSet[1]` parts (such as
 * `Twister`) to the primary damaging part, and computes PoB-authentic multi-hit / sequence /
 * corpse-explosion multipliers for iconic multi-part skills.
 */
export function resolveActiveSkillPartAndStats(
  gemDef: GemDefinition,
  gemInst: GemInstance,
  group: SkillGroup,
  effLevel: number,
  options: ResolveSkillPartOptions = {},
): ResolvedSkillPartStats {
  const game = options.game ?? gemDef.game;
  const clampedLevel = Math.max(1, Math.min(40, Math.round(effLevel)));
  const explicitPartIdx =
    gemInst.skillPart ?? gemInst.statSetIndex ?? group.skillPart ?? group.statSetIndex;
  const parts = gemDef.parts ?? [];

  let selectedPart: SkillPartDefinition | undefined;
  let autoAdvancedPart = false;

  if (parts.length > 0) {
    const requestedPart =
      explicitPartIdx !== undefined
        ? (parts.find((p) => p.index === explicitPartIdx) ?? parts[explicitPartIdx - 1] ?? parts[0])
        : parts[0];
    selectedPart = requestedPart;

    // Auto-advance past PoE 2 0-damage statSet[1] wrapper (e.g. Twister) when unset or requesting part 1
    const isDefaultOrFirst = explicitPartIdx === undefined || explicitPartIdx === 1;
    if (isDefaultOrFirst && selectedPart && parts.length > 1 && selectedPart === parts[0]) {
      const firstLevel = resolveLevelFromMap(selectedPart.levels, clampedLevel);
      if (!partHasDamagingStats(selectedPart, firstLevel)) {
        for (let i = 1; i < parts.length; i++) {
          const cand = parts[i]!;
          const candLevel = resolveLevelFromMap(cand.levels, clampedLevel);
          if (partHasDamagingStats(cand, candLevel)) {
            selectedPart = cand;
            autoAdvancedPart = true;
            break;
          }
        }
      }
    }
  }

  const partHasOwnLevelMap = Boolean(
    selectedPart?.levels && Object.keys(selectedPart.levels).length > 0,
  );
  const baseLevelEntry = resolveLevelFromMap(
    gemDef.levelScaling as Record<number, GemLevelStats> | undefined,
    clampedLevel,
  );
  const partLevelEntry =
    selectedPart && partHasOwnLevelMap
      ? resolveLevelFromMap(selectedPart.levels, clampedLevel)
      : undefined;

  const partIndex = selectedPart?.index ?? explicitPartIdx ?? 1;
  const partName = selectedPart?.name ?? gemDef.name.en;

  const selectedPartDotData = selectedPart?.skillData ?? partLevelEntry?.skillData;
  const partIsPureDot =
    Boolean(
      selectedPart &&
        !partLevelEntry?.baseDamage &&
        !selectedPart.baseDamage &&
        selectedPartDotData &&
        (typeof selectedPartDotData.PhysicalDot === 'number' ||
          typeof selectedPartDotData.FireDot === 'number' ||
          typeof selectedPartDotData.ColdDot === 'number' ||
          typeof selectedPartDotData.LightningDot === 'number' ||
          typeof selectedPartDotData.ChaosDot === 'number'),
    );

  const baseDamage = partIsPureDot
    ? {}
    : cloneDamageMap(
        partHasOwnLevelMap
          ? (partLevelEntry?.baseDamage ??
              selectedPart?.baseDamage ??
              baseLevelEntry?.baseDamage ??
              gemDef.baseDamage)
          : (baseLevelEntry?.baseDamage ??
              selectedPart?.baseDamage ??
              gemDef.baseDamage),
      );

  const damageEffectivenessPct = partHasOwnLevelMap
    ? (partLevelEntry?.damageEffectivenessPct ??
        selectedPart?.damageEffectiveness ??
        baseLevelEntry?.damageEffectivenessPct ??
        gemDef.damageEffectivenessPct ??
        100)
    : (baseLevelEntry?.damageEffectivenessPct ??
        selectedPart?.damageEffectiveness ??
        gemDef.damageEffectivenessPct ??
        100);

  let attackDamageMultiplierPct = partHasOwnLevelMap
    ? (partLevelEntry?.attackDamageMultiplierPct ??
        selectedPart?.attackDamageMultiplierPct ??
        baseLevelEntry?.attackDamageMultiplierPct ??
        gemDef.attackDamageMultiplierPct)
    : (baseLevelEntry?.attackDamageMultiplierPct ??
        selectedPart?.attackDamageMultiplierPct ??
        gemDef.attackDamageMultiplierPct);

  const attackSpeedMultiplier = partHasOwnLevelMap
    ? (partLevelEntry?.attackSpeedMultiplier ??
        selectedPart?.attackSpeedMultiplier ??
        baseLevelEntry?.attackSpeedMultiplier ??
        gemDef.attackSpeedMultiplier ??
        1)
    : (baseLevelEntry?.attackSpeedMultiplier ??
        selectedPart?.attackSpeedMultiplier ??
        gemDef.attackSpeedMultiplier ??
        1);

  const critChance =
    partLevelEntry?.critChance ?? selectedPart?.critChance ?? gemDef.baseCritChance ?? 0;

  const compiledMods: CompiledGemMod[] = [...(partHasOwnLevelMap
    ? (partLevelEntry?.compiledMods ??
        selectedPart?.compiledMods ??
        baseLevelEntry?.compiledMods ??
        gemDef.compiledMods ??
        [])
    : (baseLevelEntry?.compiledMods ??
        selectedPart?.compiledMods ??
        gemDef.compiledMods ??
        []))];

  const skillData: Record<string, number | boolean | string> = {
    ...(gemDef.skillData ?? {}),
    ...(baseLevelEntry?.skillData ?? {}),
    ...(selectedPart?.skillData ?? {}),
    ...(partLevelEntry?.skillData ?? {}),
  };

  const spell = selectedPart?.spell ?? (gemDef.modFlags & ModFlag.Spell) !== 0;
  const attack = selectedPart?.attack ?? (gemDef.modFlags & ModFlag.Attack) !== 0;
  const melee = selectedPart?.melee ?? (gemDef.modFlags & ModFlag.Melee) !== 0;
  const projectile = selectedPart?.projectile ?? (gemDef.modFlags & ModFlag.Projectile) !== 0;
  const area = selectedPart?.area ?? (gemDef.modFlags & ModFlag.Area) !== 0;

  let sequenceDamageMultiplier = 1;
  let hitsPerUse = 1;
  let corpseLife: number | undefined;
  let corpseExplosionPct: number | undefined;
  let corpseExplosionDamageType: DamageType | undefined;

  const skillKey = gemDef.name.en.trim().toLowerCase();
  const partNameLower = partName.trim().toLowerCase();

  // Iconic multi-part & sequence multipliers
  if (skillKey === 'molten strike of the zenith' && !selectedPart?.compiledMods?.length) {
    // Synthetic / uncompiled fallback for 5th-attack 1000% more (11x) & sequence average ((4*1 + 11)/5 = 3x)
    if (/(?:average|sequence)/i.test(partNameLower)) {
      sequenceDamageMultiplier = 3;
    } else if (/(?:5th|fifth)/i.test(partNameLower)) {
      sequenceDamageMultiplier = 11;
    }
  } else if (skillKey === 'tempest flurry' && !selectedPart?.attackDamageMultiplierPct) {
    // Synthetic / uncompiled fallback for PoE 2 Quarterstaff combo sequence when official PoB 2 part
    // `attackDamageMultiplierPct` (`am = 140 / 90 / 421`) is absent.
    if (/(?:4th|fourth|final)/i.test(partNameLower) || partIndex === 3) {
      sequenceDamageMultiplier = 1.5;
    } else if (/(?:3rd|third)/i.test(partNameLower) || partIndex === 2) {
      sequenceDamageMultiplier = 1.2;
      hitsPerUse = 2;
    } else if (/(?:average|sequence|combo)/i.test(partNameLower) || partIndex === 4) {
      sequenceDamageMultiplier = 1.25;
    }
  } else if (game === 'poe2' && (skillKey === 'walking calamity' || skillKey === 'apocalypse')) {
    // PoB 2 Data/Skills/act_str.lua:20748 (`WalkingCalamityPlayer`) & other.lua:971 (`ApocalypsePlayer`):
    // Base activation skills have `base_deal_no_damage` (0 DPS) unless a damaging sub-part is explicitly selected.
    if (!selectedPart || !/meteor|fire|cold|lightning/i.test(partNameLower)) {
      attackDamageMultiplierPct = 0;
      sequenceDamageMultiplier = 0;
      for (const k of Object.keys(baseDamage) as DamageType[]) {
        delete baseDamage[k];
      }
    }
  } else if (game === 'poe2' && skillKey === 'flameblast') {
    // PoB 2 Data/Skills/act_int.lua:8461 (`FlameblastPlayer`):
    // Max 10 stages, +75% MORE Spell Damage per stage (+750% MORE at max stages -> 8.5x Hit & Ignite).
    const maxStageMod = compiledMods.find(
      (m) => m.name === 'Multiplier:FlameblastMaxStages' && typeof m.value === 'number',
    );
    const maxStages = typeof maxStageMod?.value === 'number' && maxStageMod.value > 0 ? maxStageMod.value : 10;
    const perStageMod = compiledMods.find(
      (m) =>
        m.name === 'Damage' &&
        m.type === 'MORE' &&
        typeof m.value === 'number' &&
        m.tags?.some((t) => t.type === 'Multiplier' && t.var === 'FlameblastStage'),
    );
    const perStagePct = typeof perStageMod?.value === 'number' ? perStageMod.value : 75;
    compiledMods.push({
      name: 'Damage',
      type: 'MORE',
      value: maxStages * perStagePct,
      flags: ModFlag.Spell,
      keywordFlags: 0,
    });
  } else if (skillKey === 'earthquake of amplification') {
    if (/aftershock/i.test(partNameLower) || partIndex === 2) {
      const baseDurationSec =
        typeof skillData.duration === 'number' && skillData.duration > 0 ? skillData.duration : 2.0;
      const qualDurBonusSec =
        typeof options.effectiveQuality === 'number' && options.effectiveQuality > 0
          ? Math.trunc(options.effectiveQuality * 25) / 1000
          : 0;
      const durMult =
        typeof options.durationMultiplier === 'number' && Number.isFinite(options.durationMultiplier)
          ? Math.max(0, options.durationMultiplier)
          : 1;
      const durationSec = (baseDurationSec + qualDurBonusSec) * durMult;
      // 10% more Damage per 0.1s scaled duration (default 2.0s * 1 -> 200% more = 3.0x; e.g. 9.3s -> 10.3x)
      sequenceDamageMultiplier = 1 + Math.round((durationSec / 0.1) * 10) / 100;
    }
  } else if (skillKey === 'earthquake') {
    if (/aftershock/i.test(partNameLower) || partIndex === 2) {
      // PoB1 Lv20 Earthquake Aftershock: 150% more Damage with Hits and Ailments (2.5x)
      sequenceDamageMultiplier = 2.5;
    }
  } else if (skillKey === 'ice nova of frostbolts') {
    // Cast on Frostbolts expands up to 4 times per cast ONLY when an explicit part is selected
    // (`poe1_icenovaaltx` in poe1-gems.json has no parts, so `partName` defaults to "Ice Nova of Frostbolts").
    const repeats =
      typeof skillData.frostboltExpansions === 'number' && skillData.frostboltExpansions >= 1
        ? Math.round(skillData.frostboltExpansions)
        : 4;
    if (Boolean(selectedPart) && (partIndex === 2 || /cast on frostbolt/i.test(partNameLower))) {
      hitsPerUse = repeats;
      sequenceDamageMultiplier = repeats;
    }
  } else if (skillKey === 'bodyswap' || skillKey === 'bodyswap of sacrifice') {
    // PoB1 act_int.lua:2286-2465 (`Bodyswap` & `BodyswapAltX`):
    // - Part 1 ("Self Explosion"): adds `lifePool * selfFireExplosionLifeMultiplier` flat Fire damage
    //   (`Bodyswap`: 6% base + floor(quality * 0.3)% per CalcTools.lua:197; `Bodyswap of Sacrifice`: 4% base).
    // - Part 2 ("Corpse Explosion" / "Minion Explosion"): replaces base Fire with corpse/minion life explosion.
    const isSacrifice = skillKey === 'bodyswap of sacrifice';
    const isSecondaryPart =
      partIndex === 2 || /(?:corpse|minion)/i.test(partNameLower);
    const effQual = Math.max(0, options.effectiveQuality ?? gemInst.quality ?? 0);

    if (!isSecondaryPart) {
      const baseSelfPct =
        typeof skillData.selfFireExplosionLifeMultiplier === 'number' &&
        skillData.selfFireExplosionLifeMultiplier > 0
          ? skillData.selfFireExplosionLifeMultiplier
          : isSacrifice
            ? 0.04
            : 0.06;
      const qualSelfPct = isSacrifice ? 0 : Math.trunc(effQual * 0.3) / 100;
      const totalSelfPct = baseSelfPct + qualSelfPct;
      const computedTotemLife = options.isTotem
        ? typeof options.totemMaxLife === 'number' && options.totemMaxLife > 0
          ? options.totemMaxLife
          : Math.round(
              getPoe1TotemBaseLife(
                getPoe1SpellTotemLevel(options.totemSkillLevel ?? clampedLevel),
                options.totemLifeMult ?? 1,
              ) *
                Math.max(0, 1 + (options.totemLifeIncPct ?? 0) / 100) *
                Math.max(0, options.totemLifeMoreMult ?? 1),
            )
        : 0;
      const lifePool =
        options.isTotem && computedTotemLife > 0
          ? computedTotemLife
          : typeof options.playerMaxLife === 'number' && options.playerMaxLife > 0
            ? options.playerMaxLife
            : 0;
      if (lifePool > 0 && totalSelfPct > 0) {
        const bonusFire = Math.round(lifePool * totalSelfPct);
        const prev = baseDamage.Fire;
        baseDamage.Fire = prev ? [prev[0] + bonusFire, prev[1] + bonusFire] : [bonusFire, bonusFire];
        skillData.FireBonusMin = lifePool * totalSelfPct;
        skillData.FireBonusMax = lifePool * totalSelfPct;
        corpseLife = lifePool;
        corpseExplosionPct = totalSelfPct;
        corpseExplosionDamageType = 'Fire';
      }
    } else if (!isSacrifice) {
      const enemyLevel = options.enemyLevel ?? 84;
      corpseLife = options.corpseLife ?? getPoe1MonsterLife(enemyLevel);
      corpseExplosionPct =
        typeof skillData.corpseExplosionLifeMultiplier === 'number' &&
        skillData.corpseExplosionLifeMultiplier > 0
          ? skillData.corpseExplosionLifeMultiplier
          : (60 + (clampedLevel - 1)) / 1000;
      corpseExplosionDamageType = 'Fire';
      const corpseDmg = Math.round(corpseLife * corpseExplosionPct);
      // PoB1 act_int.lua:2311 tags spell FireMin/FireMax with skillPart = 1; Part 2 deals pure corpse explosion
      baseDamage.Fire = [corpseDmg, corpseDmg];
    } else if (typeof options.minionMaxLife === 'number' && options.minionMaxLife > 0) {
      const baseMinionPct =
        typeof skillData.selfFireExplosionLifeMultiplier === 'number' &&
        skillData.selfFireExplosionLifeMultiplier > 0
          ? skillData.selfFireExplosionLifeMultiplier
          : 0.29;
      const qualMinionPct = Math.trunc(effQual * 0.25) / 100;
      const totalMinionPct = baseMinionPct + qualMinionPct;
      const minionDmg = Math.round(options.minionMaxLife * totalMinionPct);
      corpseLife = options.minionMaxLife;
      corpseExplosionPct = totalMinionPct;
      corpseExplosionDamageType = 'Fire';
      baseDamage.Fire = [minionDmg, minionDmg];
    }
  } else if (
    skillKey === 'detonate dead' ||
    skillKey === 'detonate dead of scavenging' ||
    skillKey === 'vaal detonate dead'
  ) {
    const enemyLevel = options.enemyLevel ?? (game === 'poe2' ? 82 : 84);
    const isExplosionPart =
      game === 'poe2' ||
      skillKey === 'detonate dead of scavenging' ||
      /(?:explosion|corpse)/i.test(partNameLower) ||
      partIndex === 2;

    if (isExplosionPart) {
      if (game === 'poe2') {
        corpseLife = options.corpseLife ?? getPoe2MonsterLife(enemyLevel);
        // PoB2 act_int.lua: 5.0% at Lv1 + 0.3% per level (e.g. Lv20 = 10.7%, Lv23 = 11.6%)
        corpseExplosionPct = (50 + (clampedLevel - 1) * 3) / 1000;
        corpseExplosionDamageType = 'Physical';
      } else {
        corpseLife = options.corpseLife ?? getPoe1MonsterLife(enemyLevel);
        corpseExplosionPct = skillKey === 'detonate dead of scavenging' ? 0.09 : 0.06;
        corpseExplosionDamageType = 'Fire';
      }
      const corpseDmg = Math.round(corpseLife * corpseExplosionPct);
      const prev = baseDamage[corpseExplosionDamageType];
      baseDamage[corpseExplosionDamageType] = prev
        ? [prev[0] + corpseDmg, prev[1] + corpseDmg]
        : [corpseDmg, corpseDmg];
    }
  }

  return {
    partIndex,
    partName,
    autoAdvancedPart,
    selectedPart,
    spell,
    attack,
    melee,
    projectile,
    area,
    baseDamage,
    damageEffectivenessPct,
    ...(attackDamageMultiplierPct !== undefined ? { attackDamageMultiplierPct } : {}),
    attackSpeedMultiplier,
    critChance,
    compiledMods,
    skillData,
    sequenceDamageMultiplier,
    hitsPerUse,
    ...(corpseLife !== undefined ? { corpseLife } : {}),
    ...(corpseExplosionPct !== undefined ? { corpseExplosionPct } : {}),
    ...(corpseExplosionDamageType ? { corpseExplosionDamageType } : {}),
  };
}

// ============================================================================
// 2. PoE 2 Meta Gem Wrapper & Payload Router
// ============================================================================

const POE2_META_GEM_BASE_RATES: Readonly<Record<string, number>> = {
  'cast on critical': 2.5,
  'cast on critical strike': 2.5,
  'cast on shock': 2.0,
  'cast on freeze': 2.0,
  'cast on ignite': 2.0,
  'cast on elemental ailment': 2.0,
  'cast on minion death': 1.5,
  'cast on block': 1.5,
  'elemental invocation': 1.8,
  "reaper's invocation": 1.8,
  spellslinger: 2.5,
};

function normalizeGemLookupName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+support$/i, '');
}

export function isPoe2MetaGemDefinition(def: GemDefinition): boolean {
  const key = normalizeGemLookupName(def.name.en);
  if (key in POE2_META_GEM_BASE_RATES) return true;
  const hasMetaTag =
    def.tags.some((t) => t.trim().toLowerCase() === 'meta') ||
    (def.skillTypes ?? []).some((t) => t.trim().toLowerCase() === 'meta');
  return hasMetaTag && def.category === 'active';
}

export interface Poe2MetaGemResolution {
  isMetaGroup: boolean;
  /** True when the meta wrapper is PoE 2 `Spell Totem` (`SummonMetaTotemSpellTotemPlayer` / `SupportMetaTotemSpellTotemPlayer`). */
  isSpellTotemMeta?: boolean;
  metaGem?: GemInstance;
  metaDef?: GemDefinition;
  payloadActives: Array<{ inst: GemInstance; def: GemDefinition }>;
  /** Enabled non-meta support gems in the group that should be routed onto the payload active skill. */
  routedSupports?: Array<{ inst: GemInstance; def: GemDefinition }>;
  /** Implicit support modifiers contributed by the meta wrapper (e.g. Spell Totem `-25%` less Cast Speed). */
  metaSupportMods?: Mod[];
  /** Extra SkillTypes granted to the payload active skill by the meta wrapper (e.g. `UsedByTotem`, `Totem`). */
  addedSkillTypes?: string[];
  estimatedTriggerRate: number;
}

function isSpellTotemMetaDef(def: GemDefinition): boolean {
  const key = normalizeGemLookupName(def.name.en);
  if (key === 'spell totem' || key === 'supportmetatotemspelltotemplayer') {
    return true;
  }
  const idLower = def.id.toLowerCase();
  if (idLower === 'poe2_metaspelltotem' || idLower.includes('metatotemspelltotem')) {
    return true;
  }
  return (def.altIds ?? []).some((a) => /metatotemspelltotem|skillgemspelltotem/i.test(a));
}

function isMortarCannonMetaDef(def: GemDefinition): boolean {
  const key = normalizeGemLookupName(def.name.en);
  if (key === 'mortar cannon' || key === 'supportmortarcannonplayer') {
    return true;
  }
  const idLower = def.id.toLowerCase();
  if (idLower === 'poe2_mortarcannon' || idLower.includes('mortarcannon')) {
    return true;
  }
  return (def.altIds ?? []).some((a) => /mortarcannon/i.test(a));
}

function isHollowFormMetaDef(def: GemDefinition): boolean {
  const key = normalizeGemLookupName(def.name.en);
  if (key === 'hollow form' || key === 'supporthollowformplayer') {
    return true;
  }
  const idLower = def.id.toLowerCase();
  if (idLower === 'poe2_hollowform' || idLower.includes('hollowform')) {
    return true;
  }
  return (def.altIds ?? []).some((a) => /hollowform/i.test(a));
}

function isMirageDeadeyeMetaDef(def: GemDefinition): boolean {
  const key = normalizeGemLookupName(def.name.en);
  if (key === 'mirage deadeye' || key === 'supportmiragedeadeyeplayer') {
    return true;
  }
  const idLower = def.id.toLowerCase();
  if (idLower === 'poe2_miragedeadeye' || idLower.includes('miragedeadeye')) {
    return true;
  }
  return (def.altIds ?? []).some((a) => /miragedeadeye/i.test(a));
}

function isMirageArcherMetaDef(def: GemDefinition): boolean {
  const key = normalizeGemLookupName(def.name.en);
  if (key === 'mirage archer' || key === 'supportmiragearcherplayer') {
    return true;
  }
  const idLower = def.id.toLowerCase();
  if (idLower === 'poe2_miragearcher' || idLower.includes('miragearcher')) {
    return true;
  }
  return (def.altIds ?? []).some((a) => /miragearcher/i.test(a));
}

function isAncestralWarriorTotemMetaDef(def: GemDefinition): boolean {
  const key = normalizeGemLookupName(def.name.en);
  if (key === 'ancestral warrior totem' || key === 'supportancestralwarriortotemplayer') {
    return true;
  }
  const idLower = def.id.toLowerCase();
  if (idLower === 'poe2_ancestralwarriortotem' || idLower.includes('ancestralwarriortotem')) {
    return true;
  }
  return (def.altIds ?? []).some((a) => /ancestralwarriortotem/i.test(a));
}

/**
 * Detects PoE 2 Meta Gem wrapper groups (`Cast on Critical`, `Cast on Shock`, `Cast on Freeze`,
 * `Cast on Ignite`, `Cast on Elemental Ailment`, `Cast on Minion Death`, `Cast on Block`,
 * `Elemental Invocation`, `Reaper's Invocation`, `Spellslinger`, `Spell Totem`, `Mortar Cannon`,
 * `Hollow Form`, `Mirage Deadeye`, `Mirage Archer`, and `Ancestral Warrior Totem`) and extracts
 * the socketed payload active skill(s), routed supports, and wrapper modifiers.
 */
export function resolvePoe2MetaGemGroup(
  group: SkillGroup,
  getGemDef: GemDefLookup,
): Poe2MetaGemResolution {
  let metaGem: GemInstance | undefined;
  let metaDef: GemDefinition | undefined;
  const resolved: Array<{ inst: GemInstance; def: GemDefinition }> = [];

  for (const inst of group.gems) {
    if (!inst.enabled) continue;
    const def = getGemDef(inst.gemId);
    if (!def) continue;
    resolved.push({ inst, def });
    if (
      !metaGem &&
      (isPoe2MetaGemDefinition(def) ||
        isSpellTotemMetaDef(def) ||
        isMortarCannonMetaDef(def) ||
        isHollowFormMetaDef(def) ||
        isMirageDeadeyeMetaDef(def) ||
        isMirageArcherMetaDef(def) ||
        isAncestralWarriorTotemMetaDef(def))
    ) {
      metaGem = inst;
      metaDef = def;
    }
  }

  if (!metaGem || !metaDef) {
    return {
      isMetaGroup: false,
      payloadActives: [],
      estimatedTriggerRate: 0,
    };
  }

  const isSpellTotem = isSpellTotemMetaDef(metaDef);
  const isMortarCannon = isMortarCannonMetaDef(metaDef);
  const isHollowForm = isHollowFormMetaDef(metaDef);
  const isMirageDeadeye = isMirageDeadeyeMetaDef(metaDef);
  const isMirageArcher = isMirageArcherMetaDef(metaDef);
  const isAncestralWarriorTotem = isAncestralWarriorTotemMetaDef(metaDef);
  const payloadActives = resolved.filter(
    ({ inst, def }) =>
      inst !== metaGem &&
      def.category === 'active' &&
      !def.isAuraOrBuff &&
      !isPoe2MetaGemDefinition(def) &&
      !isSpellTotemMetaDef(def) &&
      !isMortarCannonMetaDef(def) &&
      !isHollowFormMetaDef(def) &&
      !isMirageDeadeyeMetaDef(def) &&
      !isMirageArcherMetaDef(def) &&
      !isAncestralWarriorTotemMetaDef(def),
  );
  const routedSupports = resolved.filter(
    ({ inst, def }) => inst !== metaGem && def.category === 'support',
  );

  if (payloadActives.length === 0) {
    return {
      isMetaGroup: true,
      ...(isSpellTotem ? { isSpellTotemMeta: true } : {}),
      metaGem,
      metaDef,
      payloadActives: [],
      routedSupports,
      estimatedTriggerRate: 0,
    };
  }

  if (isSpellTotem) {
    // PoB 2 Data/Skills/act_str.lua:18285-18300 SupportMetaTotemSpellTotemPlayer:
    // -25% less Cast Speed (ModFlag.Cast), ActiveTotemLimit OVERRIDE 2, adds Totem / UsedByTotem skill types.
    // estimatedTriggerRate MUST stay 0 so engine.ts uses payload cast speed instead of a trigger override.
    const metaSupportMods: Mod[] = [
      {
        name: 'Speed',
        type: 'MORE',
        value: -25,
        flags: ModFlag.Cast,
        keywordFlags: 0,
        source: 'Spell Totem',
      },
      {
        name: 'ActiveTotemLimit',
        type: 'OVERRIDE',
        value: 2,
        flags: 0,
        keywordFlags: 0,
        source: 'Spell Totem',
      },
    ];
    return {
      isMetaGroup: true,
      isSpellTotemMeta: true,
      metaGem,
      metaDef,
      payloadActives,
      routedSupports,
      metaSupportMods,
      addedSkillTypes: ['UsedByTotem', 'UsedByProxy', 'SupportedBySpellTotem', 'Totem'],
      estimatedTriggerRate: 0,
    };
  }

  if (isMortarCannon) {
    // PoB 2 Data/Skills/act_str.lua:14245-14330 SupportMortarCannonPlayer:
    // -50% less Attack Speed (ModFlag.Attack), -50% less Damage, +100% increased Grenade Cooldown Recovery,
    // +1 ActiveTotemLimit, adds Totem / UsedByTotem / SupportedByMortarTotem skill types.
    const metaSupportMods: Mod[] = [
      {
        name: 'Speed',
        type: 'MORE',
        value: -50,
        flags: ModFlag.Attack,
        keywordFlags: 0,
        source: 'Mortar Cannon',
      },
      {
        name: 'Damage',
        type: 'MORE',
        value: -50,
        flags: 0,
        keywordFlags: 0,
        source: 'Mortar Cannon',
      },
      {
        name: 'CooldownRecovery',
        type: 'INC',
        value: 100,
        flags: 0,
        keywordFlags: 0,
        source: 'Mortar Cannon',
      },
      {
        name: 'ActiveTotemLimit',
        type: 'BASE',
        value: 1,
        flags: 0,
        keywordFlags: 0,
        source: 'Mortar Cannon',
      },
    ];
    return {
      isMetaGroup: true,
      metaGem,
      metaDef,
      payloadActives,
      routedSupports,
      metaSupportMods,
      addedSkillTypes: ['UsedByTotem', 'UsedByProxy', 'SupportedByMortarTotem', 'Totem'],
      estimatedTriggerRate: 0,
    };
  }

  if (isHollowForm) {
    // PoB 2 Data/Skills/other.lua:8955-9032 SupportHollowFormPlayer:
    // -30% less Attack Speed (ModFlag.Attack), -15% less Damage, adds UsedByClone / UsedByProxy / SupportedByHollowForm.
    const metaSupportMods: Mod[] = [
      {
        name: 'Speed',
        type: 'MORE',
        value: -30,
        flags: ModFlag.Attack,
        keywordFlags: 0,
        source: 'Hollow Form',
      },
      {
        name: 'Damage',
        type: 'MORE',
        value: -15,
        flags: 0,
        keywordFlags: 0,
        source: 'Hollow Form',
      },
    ];
    return {
      isMetaGroup: true,
      metaGem,
      metaDef,
      payloadActives,
      routedSupports,
      metaSupportMods,
      addedSkillTypes: ['UsedByClone', 'UsedByProxy', 'SupportedByHollowForm'],
      estimatedTriggerRate: 0,
    };
  }

  if (isMirageDeadeye) {
    // PoB 2 Data/Skills/other.lua:11415-11490 SupportMirageDeadeyePlayer:
    // -50% less Damage (`support_lingering_mirage_damage_+%_final = -50`), adds UsedByClone / UsedByProxy / SupportedByMirageDeadeye.
    const metaSupportMods: Mod[] = [
      {
        name: 'Damage',
        type: 'MORE',
        value: -50,
        flags: 0,
        keywordFlags: 0,
        source: 'Mirage Deadeye',
      },
    ];
    return {
      isMetaGroup: true,
      metaGem,
      metaDef,
      payloadActives,
      routedSupports,
      metaSupportMods,
      addedSkillTypes: ['UsedByClone', 'UsedByProxy', 'SupportedByMirageDeadeye'],
      estimatedTriggerRate: 0,
    };
  }

  if (isMirageArcher) {
    // PoB 2 Data/Skills/act_dex.lua:5022-5095 SupportMirageArcherPlayer:
    // -30% less Damage (`support_lingering_mirage_damage_+%_final = -30`), adds UsedByClone / UsedByProxy / SupportedByMirageArcher.
    const metaSupportMods: Mod[] = [
      {
        name: 'Damage',
        type: 'MORE',
        value: -30,
        flags: 0,
        keywordFlags: 0,
        source: 'Mirage Archer',
      },
    ];
    return {
      isMetaGroup: true,
      metaGem,
      metaDef,
      payloadActives,
      routedSupports,
      metaSupportMods,
      addedSkillTypes: ['UsedByClone', 'UsedByProxy', 'SupportedByMirageArcher'],
      estimatedTriggerRate: 0,
    };
  }

  if (isAncestralWarriorTotem) {
    // PoB 2 Data/Skills/act_str.lua:570-605 SupportAncestralWarriorTotemPlayer:
    // ActiveTotemLimit OVERRIDE 10, adds UsedByTotem / UsedByProxy / Totem.
    const metaSupportMods: Mod[] = [
      {
        name: 'ActiveTotemLimit',
        type: 'OVERRIDE',
        value: 10,
        flags: 0,
        keywordFlags: 0,
        source: 'Ancestral Warrior Totem',
      },
    ];
    return {
      isMetaGroup: true,
      metaGem,
      metaDef,
      payloadActives,
      routedSupports,
      metaSupportMods,
      addedSkillTypes: ['UsedByTotem', 'UsedByProxy', 'Totem'],
      estimatedTriggerRate: 0,
    };
  }

  // Official PoB 2 (`CalcTriggers.lua`) does NOT override Speed with a synthetic energy trigger rate
  // for PoE 2 energy-meta gems (`Cast on Critical`, `Cast on Shock/Freeze/Ignite`, `Elemental Invocation`,
  // etc.); it computes the payload spell's own cast speed (e.g. Comet `+1.0s` total cast time -> `0.68/s`).
  // Returning `estimatedTriggerRate: 0` lets `engine.ts` compute the exact payload spell cast speed.
  return {
    isMetaGroup: true,
    metaGem,
    metaDef,
    payloadActives,
    routedSupports,
    estimatedTriggerRate: 0,
  };
}

// ============================================================================
// 3. Persistent Spirit Buffs (PoE 2), Stances, Vaal Gating & Herald of Agony (PoE 1)
// ============================================================================

export interface PersistentBuffEvalResult {
  appliedSkills: string[];
  activeStance?: 'Blood' | 'Sand';
  witheredStacksApplied: number;
  virulenceStacks: number;
  playerModsAdded: Mod[];
  enemyModsAdded: Mod[];
}

/**
 * Evaluates persistent Spirit Buffs (PoE 2: `Wind Dancer`, `Ghost Dance`, `Grim Feast`,
 * `Scavenged Plating`, `Berserk`, `Overwhelming Presence`, `Withering Presence`,
 * `Combat Frenzy`, `Trinity`, `Plague Bearer`) and PoE 1 Stance / Vaal / Buff skills
 * (`Blood and Sand`, `Flesh and Stone`, Vaal `enableGlobal1`/`enableGlobal2`, `Herald of Agony`).
 */
export function evaluatePersistentBuffAndStanceSkills(
  skills: readonly SkillGroup[],
  activeWeaponSet: WeaponSetId,
  game: GameId,
  playerDb: ModDB,
  enemyDb: ModDB,
  getGemDef: GemDefLookup,
): PersistentBuffEvalResult {
  const appliedSkills: string[] = [];
  const seenPersistentBuffs = new Set<string>();
  const playerModsAdded: Mod[] = [];
  const enemyModsAdded: Mod[] = [];
  let activeStance: 'Blood' | 'Sand' | undefined;
  let witheredStacksApplied = 0;
  let virulenceStacks = 0;

  const addPlayerMod = (mod: Mod) => {
    playerDb.addMod(mod);
    playerModsAdded.push(mod);
  };
  const addEnemyMod = (mod: Mod) => {
    enemyDb.addMod(mod);
    enemyModsAdded.push(mod);
  };

  for (const group of skills) {
    if (!group.enabled) continue;
    if (
      game === 'poe2' &&
      group.weaponSets &&
      group.weaponSets.length > 0 &&
      !group.weaponSets.includes(activeWeaponSet)
    ) {
      continue;
    }

    for (const gem of group.gems) {
      if (!gem.enabled) continue;
      const def = getGemDef(gem.gemId);
      if (!def || def.category !== 'active') continue;

      const rawName = def.name.en.trim();
      const lower = rawName.toLowerCase();
      const level = Math.max(1, Math.min(40, Math.round(gem.level || 20)));

      // Handle PoE 1 Vaal gem enableGlobal1 (base) vs enableGlobal2 (Vaal active) gating
      const isVaalGem = lower.startsWith('vaal ');
      if (isVaalGem) {
        const baseEnabled = gem.enableGlobal1 !== false;
        const vaalEnabled = gem.enableGlobal2 === true;
        if (!baseEnabled && !vaalEnabled) {
          continue;
        }
        if (vaalEnabled) {
          playerDb.setCondition('VaalSkillActive', true);
          if (lower === 'vaal haste') {
            const speedBonus = 24 + Math.min(12, Math.floor((level - 1) * 0.5));
            addPlayerMod({
              name: 'Speed',
              type: 'INC',
              value: speedBonus,
              flags: ModFlag.Attack,
              keywordFlags: 0,
              source: 'Vaal Haste',
            });
            addPlayerMod({
              name: 'Speed',
              type: 'INC',
              value: speedBonus,
              flags: ModFlag.Spell,
              keywordFlags: 0,
              source: 'Vaal Haste',
            });
            addPlayerMod({
              name: 'MovementSpeed',
              type: 'INC',
              value: 12,
              flags: 0,
              keywordFlags: 0,
              source: 'Vaal Haste',
            });
          } else if (lower === 'vaal grace') {
            addPlayerMod({
              name: 'Evasion',
              type: 'MORE',
              value: 15,
              flags: 0,
              keywordFlags: 0,
              source: 'Vaal Grace',
            });
            addPlayerMod({
              name: 'SpellSuppressionChance',
              type: 'BASE',
              value: 15,
              flags: 0,
              keywordFlags: 0,
              source: 'Vaal Grace',
            });
          } else if (lower === 'vaal discipline') {
            addPlayerMod({
              name: 'VaalDisciplineActive',
              type: 'FLAG',
              value: true,
              flags: 0,
              keywordFlags: 0,
              source: 'Vaal Discipline',
            });
            addPlayerMod({
              name: 'EnergyShieldRechargeRate',
              type: 'INC',
              value: 20,
              flags: 0,
              keywordFlags: 0,
              source: 'Vaal Discipline',
            });
          } else if (lower === 'vaal righteous fire') {
            const spellMore = 29 + Math.min(12, Math.floor((level - 1) * 0.5));
            addPlayerMod({
              name: 'Damage',
              type: 'MORE',
              value: spellMore,
              flags: ModFlag.Spell,
              keywordFlags: 0,
              source: 'Vaal Righteous Fire',
            });
          } else if (lower === 'vaal molten shell') {
            addPlayerMod({
              name: 'GuardShield',
              type: 'BASE',
              value: 1000 + level * 150,
              flags: 0,
              keywordFlags: 0,
              source: 'Vaal Molten Shell',
            });
          } else {
            addPlayerMod({
              name: 'VaalBuffActive',
              type: 'FLAG',
              value: true,
              flags: 0,
              keywordFlags: 0,
              source: rawName,
            });
          }
          appliedSkills.push(`${rawName} (Vaal)`);
        }
        if (baseEnabled) {
          appliedSkills.push(`${rawName} (Base)`);
        }
        continue;
      }

      // PoE 2 Persistent Spirit Buffs (plus cross-game Trinity / Plague Bearer)
      if (game === 'poe2') {
        if (lower === 'wind dancer') {
          const ctxMult = playerDb.getEvalContext().multipliers;
          const configuredStages =
            gem.count !== undefined
              ? gem.count
              : (ctxMult.WindDancerStage ?? ctxMult.WindDancerStacks ?? 0);
          const stages = Math.min(6, Math.max(0, Math.round(configuredStages)));
          if (stages > 0) {
            // Upstream PoB 2 WindDancerPlayer: flat 10% more Evasion Rating per stage across all gem levels
            const perStagePct = 10;
            addPlayerMod({
              name: 'Evasion',
              type: 'MORE',
              value: perStagePct * stages,
              flags: 0,
              keywordFlags: 0,
              source: `Wind Dancer (${stages} stages)`,
            });
          }
          playerDb.setMultiplier('WindDancerStage', stages);
          appliedSkills.push('Wind Dancer');
          continue;
        }

        if (lower === 'ghost dance') {
          const recoverPct = 5 + Math.floor((level - 1) / 5);
          addPlayerMod({
            name: 'GhostDanceActive',
            type: 'FLAG',
            value: true,
            flags: 0,
            keywordFlags: 0,
            source: 'Ghost Dance',
          });
          addPlayerMod({
            name: 'GhostShroudEsRecoverPctOfEvasion',
            type: 'BASE',
            value: recoverPct,
            flags: 0,
            keywordFlags: 0,
            source: 'Ghost Dance',
          });
          playerDb.setCondition('GhostDance', true);
          appliedSkills.push('Ghost Dance');
          continue;
        }

        if (lower === 'grim feast') {
          addPlayerMod({
            name: 'GrimFeastActive',
            type: 'FLAG',
            value: true,
            flags: 0,
            keywordFlags: 0,
            source: 'Grim Feast',
          });
          addPlayerMod({
            name: 'EnergyShieldOverflowPct',
            type: 'BASE',
            value: 100,
            flags: 0,
            keywordFlags: 0,
            source: 'Grim Feast',
          });
          addPlayerMod({
            name: 'GrimRemnantEsRestore',
            type: 'BASE',
            value: Math.round(25 + level * 6),
            flags: 0,
            keywordFlags: 0,
            source: 'Grim Feast',
          });
          appliedSkills.push('Grim Feast');
          continue;
        }

        if (lower === 'scavenged plating') {
          const ctxMult = playerDb.getEvalContext().multipliers;
          const configuredStacks =
            gem.count !== undefined
              ? gem.count
              : (ctxMult.ScavengedPlatingStack ?? ctxMult.ScavengedPlatingStacks ?? 0);
          const stacks = Math.min(12, Math.max(0, Math.round(configuredStacks)));
          if (stacks > 0) {
            const perStackPct = Math.floor(4 + (level - 1) * 0.15);
            addPlayerMod({
              name: 'Armour',
              type: 'MORE',
              value: perStackPct * stacks,
              flags: 0,
              keywordFlags: 0,
              source: `Scavenged Plating (${stacks} stacks)`,
            });
            addPlayerMod({
              name: 'Thorns',
              type: 'BASE',
              value: stacks * (5 + level * 2),
              flags: 0,
              keywordFlags: 0,
              source: `Scavenged Plating (${stacks} stacks)`,
            });
          }
          playerDb.setMultiplier('ScavengedPlatingStack', stacks);
          appliedSkills.push('Scavenged Plating');
          continue;
        }

        if (lower === 'berserk') {
          if (seenPersistentBuffs.has('berserk')) continue;
          seenPersistentBuffs.add('berserk');
          // PoB 2 Data/Skills/act_str.lua:1447,1524-1563 BerserkPlayer:
          // Lv1=40%..Lv30=69% (+1/lv), Lv31-40=+1 per 2 lv (max 74%) + 0.5% per quality (+10% at Q20).
          // Emits RageEffect INC cleanly for engine.ts (CalcPerform.lua:789) without double-applying Damage MORE.
          const baseRageEffect = level <= 30 ? 39 + level : 69 + Math.floor((level - 30) / 2);
          const qualityRageEffect = Math.floor(Math.max(0, gem.quality ?? 0) * 0.5);
          const rageEffectPct = baseRageEffect + qualityRageEffect;
          addPlayerMod({
            name: 'RageEffect',
            type: 'INC',
            value: rageEffectPct,
            flags: 0,
            keywordFlags: 0,
            source: 'Berserk',
          });
          playerDb.setCondition('Berserk', true);
          appliedSkills.push('Berserk');
          continue;
        }

        if (lower === 'overwhelming presence') {
          if (seenPersistentBuffs.has('overwhelming presence')) continue;
          seenPersistentBuffs.add('overwhelming presence');
          const thresholdReduction = 20 + Math.max(0, level - 1);
          addEnemyMod({
            name: 'AilmentThreshold',
            type: 'INC',
            value: -thresholdReduction,
            flags: 0,
            keywordFlags: 0,
            source: 'Overwhelming Presence',
          });
          addEnemyMod({
            name: 'StunThreshold',
            type: 'INC',
            value: -thresholdReduction,
            flags: 0,
            keywordFlags: 0,
            source: 'Overwhelming Presence',
          });
          appliedSkills.push('Overwhelming Presence');
          continue;
        }

        if (lower === 'withering presence') {
          if (seenPersistentBuffs.has('withering presence')) continue;
          seenPersistentBuffs.add('withering presence');
          // PoB 2 Data/Skills/act_int.lua:23274-23338 WitheringPresencePlayer & CalcPerform.lua:714-718:
          // Withering Presence grants `Condition:CanWither`; Withered stacks are ONLY applied when
          // configured via `<Input name="multiplierWitheredStackCount">` (handled in `engine.ts`).
          // Never fabricate 10 Withered stacks when `gem.count` is omitted or default `1`, which both
          // inflates unconfigured builds by +50..80% and double-counts configured `cfg.witheredStacks`.
          // Explicit multi-stack `gem.count > 1` remains honored for direct unit/caller tests.
          addPlayerMod({
            name: 'Condition:CanWither',
            type: 'FLAG',
            value: true,
            flags: 0,
            keywordFlags: 0,
            source: 'Withering Presence',
          });
          playerDb.setCondition('CanWither', true);
          if (gem.count !== undefined && gem.count > 1) {
            const stacks = Math.min(10, Math.round(gem.count));
            // Scale PoE 2 Withered (5% per stack, max 10 stacks) by WitherEffect (e.g. +60% -> 8%/stack = 80%).
            const witherEffectInc =
              playerDb.sum('INC', 'WitherEffect') + enemyDb.sum('INC', 'WitherEffect');
            const perStackPct = Math.floor(5 * Math.max(0, 1 + witherEffectInc / 100) + 1e-9);
            const chaosTakenInc = stacks * perStackPct;
            witheredStacksApplied = Math.max(witheredStacksApplied, stacks);
            addEnemyMod({
              name: 'ChaosDamageTaken',
              type: 'INC',
              value: chaosTakenInc,
              flags: 0,
              keywordFlags: 0,
              source: `Withering Presence (${stacks} Withered)`,
            });
            addEnemyMod({
              name: 'EnemyChaosDamageTaken',
              type: 'INC',
              value: chaosTakenInc,
              flags: 0,
              keywordFlags: 0,
              source: `Withering Presence (${stacks} Withered)`,
            });
            enemyDb.setMultiplier('WitheredStack', stacks);
          }
          appliedSkills.push('Withering Presence');
          continue;
        }

        if (lower === 'combat frenzy') {
          if (seenPersistentBuffs.has('combat frenzy')) continue;
          seenPersistentBuffs.add('combat frenzy');
          addPlayerMod({
            name: 'CombatFrenzyActive',
            type: 'FLAG',
            value: true,
            flags: 0,
            keywordFlags: 0,
            source: 'Combat Frenzy',
          });
          addPlayerMod({
            name: 'FrenzyChargeOnAilment',
            type: 'FLAG',
            value: true,
            flags: 0,
            keywordFlags: 0,
            source: 'Combat Frenzy',
          });
          playerDb.setCondition('CombatFrenzy', true);
          appliedSkills.push('Combat Frenzy');
          continue;
        }

        if (lower === 'charge regulation') {
          if (seenPersistentBuffs.has('charge regulation')) continue;
          seenPersistentBuffs.add('charge regulation');
          // PoB 2 `poe2-gems.json` (`poe2_chargeregulation`) already ships compiledMods for
          // Speed INC / CritChance MORE / Armour-Evasion-ES MORE which `evaluateAurasAndWatchersEye`
          // injects natively. Skip emitting fallback mods when `gemDef.compiledMods` is populated
          // so Charge Regulation is NEVER double-applied (still works for synthetic/uncompiled defs).
          if (def?.compiledMods && def.compiledMods.length > 0) {
            appliedSkills.push('Charge Regulation');
            continue;
          }
          // PoB 2 Data/Skills/act_int.lua:3119-3245 ChargeRegulationPlayer (Lv1..40):
          // - With Frenzy Charges (>=1): Speed INC (20%..30%)
          // - With Power Charges (>=1): CritChance MORE (20%..32%)
          // - With Endurance Charges (>=1): Armour / Evasion / EnergyShield MORE (15%..24%)
          const CHARGE_REG_SPEED_INC = [
            20, 21, 21, 21, 21, 22, 22, 22, 22, 23,
            23, 23, 23, 24, 24, 24, 24, 25, 25, 25,
            25, 26, 26, 26, 26, 27, 27, 27, 27, 28,
            28, 28, 28, 29, 29, 29, 29, 30, 30, 30,
          ];
          const CHARGE_REG_CRIT_MORE = [
            20, 20, 20, 21, 21, 21, 22, 22, 22, 23,
            23, 23, 24, 24, 24, 25, 25, 25, 26, 26,
            26, 27, 27, 27, 28, 28, 28, 29, 29, 29,
            30, 30, 30, 31, 31, 31, 32, 32, 32, 33,
          ];
          const CHARGE_REG_DEF_MORE = [
            15, 15, 16, 16, 16, 16, 17, 17, 17, 17,
            18, 18, 18, 18, 19, 19, 19, 19, 20, 20,
            20, 20, 21, 21, 21, 21, 22, 22, 22, 22,
            23, 23, 23, 23, 24, 24, 24, 24, 25, 25,
          ];
          const lvIdx = Math.max(0, Math.min(39, Math.round(level) - 1));
          const speedInc = CHARGE_REG_SPEED_INC[lvIdx] ?? 25;
          const critMore = CHARGE_REG_CRIT_MORE[lvIdx] ?? 26;
          const defMore = CHARGE_REG_DEF_MORE[lvIdx] ?? 20;
          addPlayerMod({
            name: 'Speed',
            type: 'INC',
            value: speedInc,
            flags: 0,
            keywordFlags: 0,
            source: 'Charge Regulation',
            tags: [{ type: 'Multiplier', var: 'FrenzyCharge', limit: 1 }],
          });
          addPlayerMod({
            name: 'CritChance',
            type: 'MORE',
            value: critMore,
            flags: 0,
            keywordFlags: 0,
            source: 'Charge Regulation',
            tags: [{ type: 'Multiplier', var: 'PowerCharge', limit: 1 }],
          });
          for (const defStat of ['Armour', 'Evasion', 'EnergyShield'] as const) {
            addPlayerMod({
              name: defStat,
              type: 'MORE',
              value: defMore,
              flags: 0,
              keywordFlags: 0,
              source: 'Charge Regulation',
              tags: [{ type: 'Multiplier', var: 'EnduranceCharge', limit: 1 }],
            });
          }
          appliedSkills.push('Charge Regulation');
          continue;
        }
      }

      // Cross-game persistent buffs: Trinity & Plague Bearer (deduplicated across socket groups)
      if (lower === 'trinity') {
        if (seenPersistentBuffs.has('trinity')) continue;
        seenPersistentBuffs.add('trinity');

        if (game === 'poe2') {
          // PoB 2 Data/Skills/act_int.lua:21847-21919 TrinityPlayer:
          // Grants MORE Elemental Damage per 30 Resonance (0% Elemental Penetration in PoE 2).
          // Prefer level-scaled `def.levelScaling[level].compiledMods` / `def.compiledMods` when present.
          const POE2_TRINITY_PER_30: readonly number[] = [
            1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 5, 5, 6,
            6, 6, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 10, 10,
          ];
          const lvEntry = resolveLevelFromMap(
            def.levelScaling as Record<number, GemLevelStats> | undefined,
            level,
          );
          const compiledCandidates = lvEntry?.compiledMods ?? def.compiledMods ?? [];
          const compiledPer30Mod = compiledCandidates.find(
            (cm) => cm.name === 'ElementalDamage' && cm.type === 'MORE' && typeof cm.value === 'number',
          );
          const per30 =
            typeof compiledPer30Mod?.value === 'number' && compiledPer30Mod.value > 0
              ? compiledPer30Mod.value
              : (POE2_TRINITY_PER_30[Math.min(40, Math.max(1, level)) - 1] ?? 6);

          const ctx = playerDb.getEvalContext();
          const hasExplicitResonance =
            ctx.multipliers.ResonanceCount !== undefined || ctx.stats.ResonanceCount !== undefined;
          const rawResonance = ctx.multipliers.ResonanceCount ?? ctx.stats.ResonanceCount ?? 0;
          // Handle both conventions cleanly:
          // - Direct callers / unit tests omitting ResonanceCount default to max 300 (10 stacks)
          // - `engine.ts` passes explicit `0` when PoE 2 `configResonanceCount` is unset (PoB 2 ConfigOptions.lua:689),
          //   pre-divided stacks `1..10`, or raw resonance `11..300`
          let resonanceStacks: number;
          let effectiveResonance: number;
          if (!hasExplicitResonance) {
            resonanceStacks = 10;
            effectiveResonance = 300;
          } else if (rawResonance <= 0) {
            resonanceStacks = 0;
            effectiveResonance = 0;
          } else if (rawResonance <= 10) {
            resonanceStacks = Math.floor(rawResonance);
            effectiveResonance = resonanceStacks * 30;
          } else {
            effectiveResonance = Math.min(300, rawResonance);
            resonanceStacks = Math.min(10, Math.floor(effectiveResonance / 30));
          }

          const eleMorePct = resonanceStacks * per30;
          if (eleMorePct > 0) {
            addPlayerMod({
              name: 'ElementalDamage',
              type: 'MORE',
              value: eleMorePct,
              flags: 0,
              keywordFlags: 0,
              source: 'Trinity (Resonance)',
            });
          }
          // PoB 2 Data/Skills/act_int.lua:21850-21854: `trinity_skill_speed_+%_while_all_resonance_is_at_least_250_to_grant`
          // grants generic Skill Speed (`Speed INC`, flags = 0) applying to Attacks, Spells (Cast), Warcries, and Totems.
          const qualSpeedInc = Math.floor(Math.max(0, gem.quality ?? 0) * 0.75);
          if (qualSpeedInc > 0 && effectiveResonance >= 250) {
            addPlayerMod({
              name: 'Speed',
              type: 'INC',
              value: qualSpeedInc,
              flags: 0,
              keywordFlags: 0,
              source: 'Trinity (Quality)',
            });
          }
          appliedSkills.push('Trinity');
          continue;
        }

        // PoE 1 Trinity Support / Buff: MORE Elemental Damage + Elemental Penetration
        const eleMorePct = 18 + Math.min(22, Math.max(0, level - 1));
        const elePenPct = 8 + Math.min(12, Math.floor(level / 2));
        addPlayerMod({
          name: 'ElementalDamage',
          type: 'MORE',
          value: eleMorePct,
          flags: 0,
          keywordFlags: 0,
          source: 'Trinity (Full Resonance)',
        });
        addPlayerMod({
          name: 'ElementalPenetration',
          type: 'BASE',
          value: elePenPct,
          flags: 0,
          keywordFlags: 0,
          source: 'Trinity (Full Resonance)',
        });
        for (const elem of ['Fire', 'Cold', 'Lightning'] as const) {
          addPlayerMod({
            name: `${elem}Penetration`,
            type: 'BASE',
            value: elePenPct,
            flags: 0,
            keywordFlags: 0,
            source: 'Trinity (Full Resonance)',
          });
        }
        appliedSkills.push('Trinity');
        continue;
      }

      if (lower === 'plague bearer') {
        addPlayerMod({
          name: 'PlagueBearerActive',
          type: 'FLAG',
          value: true,
          flags: 0,
          keywordFlags: 0,
          source: 'Plague Bearer',
        });
        addPlayerMod({
          name: 'Damage',
          type: 'MORE',
          value: 20,
          flags: 0,
          keywordFlags: KeywordFlag.Poison,
          source: 'Plague Bearer',
        });
        appliedSkills.push('Plague Bearer');
        continue;
      }

      // PoE 1 Stances & Herald of Agony
      if (game === 'poe1') {
        if (lower === 'blood and sand') {
          const explicitPart = gem.skillPart ?? group.skillPart;
          const isSandStance =
            explicitPart === 2 ||
            (explicitPart === undefined && Boolean(playerDb.getEvalContext().conditions.SandStance));
          const stanceBonus = 5 + Math.min(10, Math.max(0, level - 1) * 2); // Lv6 -> 15%
          if (isSandStance) {
            activeStance = 'Sand';
            playerDb.setCondition('SandStance', true);
            playerDb.setCondition('BloodStance', false);
            addPlayerMod({
              name: 'AreaOfEffect',
              type: 'MORE',
              value: stanceBonus,
              flags: ModFlag.Melee,
              keywordFlags: 0,
              source: 'Blood and Sand (Sand Stance)',
            });
            addPlayerMod({
              name: 'Damage',
              type: 'MORE',
              value: -5,
              flags: ModFlag.Melee | ModFlag.Area,
              keywordFlags: 0,
              source: 'Blood and Sand (Sand Stance)',
            });
          } else {
            activeStance = 'Blood';
            playerDb.setCondition('BloodStance', true);
            playerDb.setCondition('SandStance', false);
            addPlayerMod({
              name: 'Damage',
              type: 'MORE',
              value: stanceBonus,
              flags: ModFlag.Melee | ModFlag.Area,
              keywordFlags: 0,
              source: 'Blood and Sand (Blood Stance)',
            });
            addPlayerMod({
              name: 'AreaOfEffect',
              type: 'MORE',
              value: -5,
              flags: ModFlag.Melee,
              keywordFlags: 0,
              source: 'Blood and Sand (Blood Stance)',
            });
          }
          appliedSkills.push(`Blood and Sand (${activeStance})`);
          continue;
        }

        if (lower === 'flesh and stone') {
          const explicitPart = gem.skillPart ?? group.skillPart;
          const isSandStance =
            explicitPart === 2 ||
            (explicitPart === undefined && Boolean(playerDb.getEvalContext().conditions.SandStance));
          if (isSandStance) {
            // PoB 1 Data/Skills/act_str.lua:4443-4498: Sand Stance -10%..-(9+floor((lv+1)/2))% less Damage Taken from Hits (-19% at Lv20)
            activeStance = 'Sand';
            playerDb.setCondition('SandStance', true);
            playerDb.setCondition('BloodStance', false);
            enemyDb.setCondition('Blinded', true);
            addPlayerMod({
              name: 'DamageTaken',
              type: 'MORE',
              value: -(9 + Math.floor((level + 1) / 2)),
              flags: 0,
              keywordFlags: 0,
              source: 'Flesh and Stone (Sand Stance)',
            });
          } else {
            // PoB 1 Data/Skills/act_str.lua:4440-4498: Blood Stance 10%..(10+floor(lv/2))% MORE Physical Damage Taken by Hits (20% at Lv20)
            activeStance = 'Blood';
            playerDb.setCondition('BloodStance', true);
            playerDb.setCondition('SandStance', false);
            const physTakenMore = 10 + Math.floor(level / 2);
            addEnemyMod({
              name: 'PhysicalDamageTaken',
              type: 'MORE',
              value: physTakenMore,
              flags: ModFlag.Hit,
              keywordFlags: 0,
              source: 'Flesh and Stone (Blood Stance)',
            });
          }
          appliedSkills.push(`Flesh and Stone (${activeStance})`);
          continue;
        }

        if (lower === 'herald of agony') {
          const stacks = Math.min(60, Math.max(0, Math.round(gem.count ?? 40)));
          virulenceStacks = Math.max(virulenceStacks, stacks);
          playerDb.setMultiplier('Virulence', stacks);
          addPlayerMod({
            name: 'PoisonChance',
            type: 'BASE',
            value: 20,
            flags: 0,
            keywordFlags: 0,
            source: 'Herald of Agony',
          });
          addPlayerMod({
            name: 'Damage',
            type: 'MORE',
            value: 10 + Math.floor((level - 1) * 0.5),
            flags: 0,
            keywordFlags: KeywordFlag.Poison,
            source: 'Herald of Agony',
          });
          if (stacks > 0) {
            const perStackDmgInc = 10 + Math.floor(level / 2);
            const perStackFlatPhys = Math.round(6 + level * 1.2);
            addPlayerMod({
              name: 'MinionDamage',
              type: 'INC',
              value: stacks * perStackDmgInc,
              flags: 0,
              keywordFlags: KeywordFlag.Minion,
              source: `Herald of Agony (${stacks} Virulence)`,
              target: 'minion',
            });
            addPlayerMod({
              name: 'MinionAttackSpeed',
              type: 'INC',
              value: stacks * 2,
              flags: ModFlag.Attack,
              keywordFlags: KeywordFlag.Minion,
              source: `Herald of Agony (${stacks} Virulence)`,
              target: 'minion',
            });
            addPlayerMod({
              name: 'MinionPhysicalMin',
              type: 'BASE',
              value: stacks * perStackFlatPhys,
              flags: 0,
              keywordFlags: KeywordFlag.Minion,
              source: `Herald of Agony (${stacks} Virulence)`,
              target: 'minion',
            });
            addPlayerMod({
              name: 'MinionPhysicalMax',
              type: 'BASE',
              value: stacks * Math.round(perStackFlatPhys * 1.5),
              flags: 0,
              keywordFlags: KeywordFlag.Minion,
              source: `Herald of Agony (${stacks} Virulence)`,
              target: 'minion',
            });
          }
          appliedSkills.push(`Herald of Agony (${stacks} Virulence)`);
          continue;
        }
      }
    }
  }

  return {
    appliedSkills,
    ...(activeStance ? { activeStance } : {}),
    witheredStacksApplied,
    virulenceStacks,
    playerModsAdded,
    enemyModsAdded,
  };
}

// ============================================================================
// 4. PoE 2 Effective Weapon Set & The Squire Main-Hand Support Bridging
// ============================================================================

/**
 * Resolves the effective PoE 2 weapon set (`1` or `2`) for a skill group when the group
 * exclusively targets `[1]` or `[2]`, otherwise returning `defaultWeaponSet`.
 */
export function resolveEffectiveWeaponSetForSkill(
  mainGroup: SkillGroup | undefined,
  defaultWeaponSet: WeaponSetId,
  game: GameId,
): WeaponSetId {
  if (game !== 'poe2' || !mainGroup) {
    return defaultWeaponSet;
  }
  if (mainGroup.slot === 'Weapon 1 Swap' || mainGroup.slot === 'Weapon 2 Swap') {
    return 2;
  }
  if (mainGroup.slot === 'Weapon 1' || mainGroup.slot === 'Weapon 2') {
    return 1;
  }
  if (!mainGroup.weaponSets || mainGroup.weaponSets.length === 0) {
    return defaultWeaponSet;
  }
  const uniqueSets = Array.from(new Set(mainGroup.weaponSets));
  if (uniqueSets.length === 1) {
    return uniqueSets[0] === 2 ? 2 : 1;
  }
  return defaultWeaponSet;
}

export interface SquireSupportBridgeResult {
  hasSquire: boolean;
  squireQualityBonus: number;
  squireLevelBonus: number;
  bridgedSupports: GemInstance[];
}

type EquippedItemsInput =
  | ReadonlyArray<{ slot: EquipmentSlotId; item: Item }>
  | Partial<Record<EquipmentSlotId, Item | undefined>>;

function findOffHandItem(equippedItems: EquippedItemsInput): Item | undefined {
  if (Array.isArray(equippedItems)) {
    return equippedItems.find((entry) => entry.slot === 'Weapon 2')?.item;
  }
  return (equippedItems as Partial<Record<EquipmentSlotId, Item | undefined>>)['Weapon 2'];
}

function isSquireItem(item: Item | undefined): boolean {
  if (!item) return false;
  const allLines = [...item.implicits, ...item.explicits];
  if (
    allLines.some((line) =>
      /socketed support gems can also support skills from your main hand/i.test(line),
    )
  ) {
    return true;
  }
  return item.name.trim().toLowerCase() === 'the squire';
}

/**
 * Detects `The Squire` (or any off-hand item with `"Socketed Support Gems can also Support
 * Skills from your Main Hand"`) in `Weapon 2` and collects all enabled support gems from
 * `<Skill slot="Weapon 2">` groups with The Squire's socketed support quality/level bonuses
 * pre-applied so `engine.ts` can merge them directly into `<Skill slot="Weapon 1">`.
 */
export function collectSquireSupportsForMainHand(
  skills: readonly SkillGroup[],
  equippedItems: EquippedItemsInput,
  getGemDef: GemDefLookup,
): SquireSupportBridgeResult {
  const offHand = findOffHandItem(equippedItems);
  if (!isSquireItem(offHand) || !offHand) {
    return {
      hasSquire: false,
      squireQualityBonus: 0,
      squireLevelBonus: 0,
      bridgedSupports: [],
    };
  }

  const squireRules = parseSocketedGemBonuses([...offHand.implicits, ...offHand.explicits]);
  const emptyDb = new ModDB();
  let squireQualityBonus = 0;
  let squireLevelBonus = 0;

  for (const rule of squireRules) {
    if (rule.activeOnly) continue;
    if (rule.filterKey === 'all' || rule.filterKey === 'support') {
      if (rule.kind === 'quality') squireQualityBonus += rule.value;
      if (rule.kind === 'level') squireLevelBonus += rule.value;
    }
  }

  const bridgedSupports: GemInstance[] = [];
  for (const group of skills) {
    if (!group.enabled || group.slot !== 'Weapon 2') continue;
    for (const gem of group.gems) {
      if (!gem.enabled) continue;
      const def = getGemDef(gem.gemId);
      if (!def || def.category !== 'support') continue;
      const bonus = resolveGemBonuses(def, emptyDb, squireRules);
      bridgedSupports.push({
        ...gem,
        level: Math.min(40, Math.max(1, gem.level + bonus.levelBonus)),
        quality: gem.quality + bonus.qualityBonus,
      });
    }
  }

  return {
    hasSquire: true,
    squireQualityBonus,
    squireLevelBonus,
    bridgedSupports,
  };
}

// ============================================================================
// 5. Multi-Instance Skill Count Multiplier
// ============================================================================

/**
 * Returns `Math.max(1, Math.round(gemInst.count ?? 1))` so multi-instance skills
 * (`count="3"` totems, brands, orbs, twisters, minions) scale Combined/Full DPS accurately.
 */
export function computeSkillInstanceCountMultiplier(
  gemInst?: GemInstance,
  _group?: SkillGroup,
  _skillData?: Record<string, number | boolean | string>,
): number {
  const raw = gemInst?.count;
  if (raw === undefined || !Number.isFinite(raw)) {
    return 1;
  }
  return Math.max(1, Math.round(raw));
}
