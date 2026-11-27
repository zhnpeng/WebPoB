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

export interface ResolveSkillPartOptions {
  /** Override enemy / corpse level (defaults to 84 for PoE 1, 82 for PoE 2). */
  enemyLevel?: number;
  /** Override explicit corpse life for Detonate Dead variants. */
  corpseLife?: number;
  /** Override game context (defaults to `gemDef.game`). */
  game?: GameId;
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

  const baseLevelEntry = resolveLevelFromMap(
    gemDef.levelScaling as Record<number, GemLevelStats> | undefined,
    clampedLevel,
  );
  const partLevelEntry = selectedPart
    ? resolveLevelFromMap(selectedPart.levels, clampedLevel)
    : undefined;

  const partIndex = selectedPart?.index ?? explicitPartIdx ?? 1;
  const partName = selectedPart?.name ?? gemDef.name.en;

  const baseDamage = cloneDamageMap(
    partLevelEntry?.baseDamage ??
      selectedPart?.baseDamage ??
      baseLevelEntry?.baseDamage ??
      gemDef.baseDamage,
  );

  const damageEffectivenessPct =
    partLevelEntry?.damageEffectivenessPct ??
    selectedPart?.damageEffectiveness ??
    baseLevelEntry?.damageEffectivenessPct ??
    gemDef.damageEffectivenessPct ??
    100;

  const attackDamageMultiplierPct =
    partLevelEntry?.attackDamageMultiplierPct ??
    baseLevelEntry?.attackDamageMultiplierPct ??
    gemDef.attackDamageMultiplierPct;

  const attackSpeedMultiplier =
    partLevelEntry?.attackSpeedMultiplier ??
    selectedPart?.attackSpeedMultiplier ??
    gemDef.attackSpeedMultiplier ??
    1;

  const critChance =
    partLevelEntry?.critChance ?? selectedPart?.critChance ?? gemDef.baseCritChance ?? 0;

  const compiledMods: CompiledGemMod[] = [
    ...(baseLevelEntry?.compiledMods ?? gemDef.compiledMods ?? []),
    ...(partLevelEntry?.compiledMods ?? selectedPart?.compiledMods ?? []),
  ];

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
  if (skillKey === 'molten strike of the zenith') {
    // Every 5th attack deals 1000% more Damage with Hits (11x hit; sequence average = (4 + 11)/5 = 3x)
    if (/(?:5th|fifth|zenith)/i.test(partNameLower) || partIndex === 2 || partIndex === 4) {
      sequenceDamageMultiplier = 11;
    } else if (/(?:average|sequence|combined)/i.test(partNameLower) || partIndex === 3) {
      sequenceDamageMultiplier = 3;
    }
  } else if (skillKey === 'tempest flurry') {
    // PoE 2 Quarterstaff combo sequence (1st/2nd normal, 3rd double-hit, 4th final slam, or sequence average)
    if (/(?:4th|fourth|final)/i.test(partNameLower) || partIndex === 3) {
      sequenceDamageMultiplier = 1.5;
    } else if (/(?:3rd|third)/i.test(partNameLower) || partIndex === 2) {
      sequenceDamageMultiplier = 1.2;
      hitsPerUse = 2;
    } else if (/(?:average|sequence|combo)/i.test(partNameLower) || partIndex === 4) {
      sequenceDamageMultiplier = 1.25;
    }
  } else if (skillKey === 'earthquake of amplification') {
    if (/aftershock/i.test(partNameLower) || partIndex === 2) {
      const durationSec =
        typeof skillData.duration === 'number' && skillData.duration > 0 ? skillData.duration : 2.0;
      // 10% more Damage per 0.1s duration (default 2.0s -> 200% more = 3.0x)
      sequenceDamageMultiplier = 1 + Math.round((durationSec / 0.1) * 10) / 100;
    }
  } else if (skillKey === 'earthquake') {
    if (/aftershock/i.test(partNameLower) || partIndex === 2) {
      // PoB1 Lv20 Earthquake Aftershock: 150% more Damage with Hits and Ailments (2.5x)
      sequenceDamageMultiplier = 2.5;
    }
  } else if (skillKey === 'ice nova of frostbolts') {
    // Cast on Frostbolts expands up to 4 times per cast
    const repeats =
      typeof skillData.frostboltExpansions === 'number' && skillData.frostboltExpansions >= 1
        ? Math.round(skillData.frostboltExpansions)
        : 4;
    if (/frostbolt/i.test(partNameLower) || partIndex === 2) {
      hitsPerUse = repeats;
      sequenceDamageMultiplier = repeats;
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
  metaGem?: GemInstance;
  metaDef?: GemDefinition;
  payloadActives: Array<{ inst: GemInstance; def: GemDefinition }>;
  estimatedTriggerRate: number;
}

/**
 * Detects PoE 2 Meta Gem wrapper groups (`Cast on Critical`, `Cast on Shock`, `Cast on Freeze`,
 * `Cast on Ignite`, `Cast on Elemental Ailment`, `Cast on Minion Death`, `Cast on Block`,
 * `Elemental Invocation`, `Reaper's Invocation`, `Spellslinger`) and extracts the socketed
 * payload active spell(s) along with an estimated trigger rate so calculation engines never
 * report `0 DPS` on Meta Gem wrappers.
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
    if (!metaGem && isPoe2MetaGemDefinition(def)) {
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

  const payloadActives = resolved.filter(
    ({ inst, def }) =>
      inst !== metaGem &&
      def.category === 'active' &&
      !def.isAuraOrBuff &&
      !isPoe2MetaGemDefinition(def),
  );

  if (payloadActives.length === 0) {
    return {
      isMetaGroup: true,
      metaGem,
      metaDef,
      payloadActives: [],
      estimatedTriggerRate: 0,
    };
  }

  const metaKey = normalizeGemLookupName(metaDef.name.en);
  const baseRate = POE2_META_GEM_BASE_RATES[metaKey] ?? 1.8;
  const qualityMult = 1 + Math.max(0, metaGem.quality) * 0.01;
  const levelMult = 1 + Math.max(0, metaGem.level - 1) * 0.015;
  const primaryCastTime = payloadActives[0]?.def.castTime ?? 0.7;
  const energyCastFactor = Math.max(0.5, Math.min(2.0, 0.7 / Math.max(0.35, primaryCastTime)));
  const rawRate = (baseRate * qualityMult * levelMult * energyCastFactor) / payloadActives.length;
  const estimatedTriggerRate = Math.round(Math.min(10, Math.max(0.25, rawRate)) * 100) / 100;

  return {
    isMetaGroup: true,
    metaGem,
    metaDef,
    payloadActives,
    estimatedTriggerRate,
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
          const stages = Math.min(4, Math.max(1, Math.round(gem.count ?? 3)));
          const perStagePct = Math.floor(10 + (level - 1) * 0.5);
          addPlayerMod({
            name: 'Evasion',
            type: 'MORE',
            value: perStagePct * stages,
            flags: 0,
            keywordFlags: 0,
            source: `Wind Dancer (${stages} stages)`,
          });
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
          const stacks = Math.min(10, Math.max(1, Math.round(gem.count ?? 10)));
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
          playerDb.setMultiplier('ScavengedPlatingStack', stacks);
          appliedSkills.push('Scavenged Plating');
          continue;
        }

        if (lower === 'berserk') {
          const rageEffectPct = 20 + Math.max(0, level - 1) * 2;
          addPlayerMod({
            name: 'RageEffect',
            type: 'INC',
            value: rageEffectPct,
            flags: 0,
            keywordFlags: 0,
            source: 'Berserk',
          });
          const activeRage = playerDb.getEvalContext().multipliers.Rage ?? 0;
          if (activeRage > 0) {
            const extraRageDmg = Math.floor((activeRage * rageEffectPct) / 100);
            if (extraRageDmg > 0) {
              addPlayerMod({
                name: 'Damage',
                type: 'MORE',
                value: extraRageDmg,
                flags: ModFlag.Attack,
                keywordFlags: 0,
                source: `Berserk (${activeRage} Rage)`,
              });
            }
          }
          playerDb.setCondition('Berserk', true);
          appliedSkills.push('Berserk');
          continue;
        }

        if (lower === 'overwhelming presence') {
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
          const stacks = Math.min(10, Math.max(1, Math.round(gem.count ?? 10)));
          const chaosTakenInc = stacks * 5;
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
          appliedSkills.push('Withering Presence');
          continue;
        }

        if (lower === 'combat frenzy') {
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
      }

      // Cross-game persistent buffs: Trinity & Plague Bearer
      if (lower === 'trinity') {
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
          const stancePart = gem.skillPart ?? group.skillPart ?? 1;
          const stanceBonus = 5 + Math.min(10, Math.max(0, level - 1) * 2); // Lv6 -> 15%
          if (stancePart === 2) {
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
          const stancePart = gem.skillPart ?? group.skillPart ?? 1;
          if (stancePart === 2) {
            activeStance = 'Sand';
            playerDb.setCondition('SandStance', true);
            playerDb.setCondition('BloodStance', false);
            enemyDb.setCondition('Blinded', true);
            addPlayerMod({
              name: 'DamageTaken',
              type: 'MORE',
              value: -(11 + Math.min(10, Math.floor(level / 2))),
              flags: 0,
              keywordFlags: 0,
              source: 'Flesh and Stone (Sand Stance)',
            });
          } else {
            activeStance = 'Blood';
            playerDb.setCondition('BloodStance', true);
            playerDb.setCondition('SandStance', false);
            const physTaken = 11 + Math.min(10, Math.floor(level / 2));
            addEnemyMod({
              name: 'PhysicalDamageTaken',
              type: 'INC',
              value: physTaken,
              flags: 0,
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
  if (game !== 'poe2' || !mainGroup?.weaponSets || mainGroup.weaponSets.length === 0) {
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
