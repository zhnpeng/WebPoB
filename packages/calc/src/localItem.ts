import type { ArmourBaseStats, GameId, Item, WeaponBaseStats } from '@webpob/core';
import { getBaseItemStats } from '@webpob/data';
import { normalizeStatLineToEn } from '@webpob/i18n';
import { normalizeWeaponType } from './offenceUpgrade.js';

export interface ResolvedItemStats {
  armourStats?: ArmourBaseStats;
  weaponStats?: WeaponBaseStats;
  globalImplicits: string[];
  globalExplicits: string[];
}

interface LocalArmourAccum {
  flatArmour: number;
  flatEvasion: number;
  flatEs: number;
  flatBlock: number;
  flatWard: number;
  incArmour: number;
  incEvasion: number;
  incEs: number;
  incWard: number;
}

interface LocalWeaponAccum {
  flatPhysMin: number;
  flatPhysMax: number;
  incPhys: number;
  incAttackSpeed: number;
  flatCrit: number;
  incCrit: number;
  eleDamage: Partial<Record<'Fire' | 'Cold' | 'Lightning' | 'Chaos', [number, number]>>;
}

function tryConsumeLocalArmourMod(rawLine: string, acc: LocalArmourAccum): boolean {
  const line = normalizeStatLineToEn(rawLine);
  if (!line) return false;

  let m = line.match(/^\+(\d+) to Armour$/i);
  if (m) {
    acc.flatArmour += Number(m[1]);
    return true;
  }
  m = line.match(/^\+(\d+) to Evasion Rating$/i);
  if (m) {
    acc.flatEvasion += Number(m[1]);
    return true;
  }
  m = line.match(/^\+(\d+) to maximum Energy Shield$/i);
  if (m) {
    acc.flatEs += Number(m[1]);
    return true;
  }
  m = line.match(/^(\d+)% increased Armour$/i);
  if (m) {
    acc.incArmour += Number(m[1]);
    return true;
  }
  m = line.match(/^(\d+)% increased Evasion Rating$/i);
  if (m) {
    acc.incEvasion += Number(m[1]);
    return true;
  }
  m = line.match(/^(\d+)% increased (?:maximum )?Energy Shield$/i);
  if (m) {
    acc.incEs += Number(m[1]);
    return true;
  }
  m = line.match(/^(\d+)% increased Armour and Evasion$/i);
  if (m) {
    acc.incArmour += Number(m[1]);
    acc.incEvasion += Number(m[1]);
    return true;
  }
  m = line.match(/^(\d+)% increased Armour and Energy Shield$/i);
  if (m) {
    acc.incArmour += Number(m[1]);
    acc.incEs += Number(m[1]);
    return true;
  }
  m = line.match(/^(\d+)% increased Evasion and Energy Shield$/i);
  if (m) {
    acc.incEvasion += Number(m[1]);
    acc.incEs += Number(m[1]);
    return true;
  }
  m = line.match(/^(\d+)% increased Armour, Evasion and Energy Shield$/i);
  if (m) {
    acc.incArmour += Number(m[1]);
    acc.incEvasion += Number(m[1]);
    acc.incEs += Number(m[1]);
    return true;
  }
  m = line.match(/^\+(\d+)% Chance to Block$/i);
  if (m) {
    acc.flatBlock += Number(m[1]);
    return true;
  }
  m = line.match(/^\+(\d+) to Ward$/i);
  if (m) {
    acc.flatWard += Number(m[1]);
    return true;
  }
  m = line.match(/^(\d+)% increased Ward$/i);
  if (m) {
    acc.incWard += Number(m[1]);
    return true;
  }
  return false;
}

function tryConsumeLocalWeaponMod(rawLine: string, acc: LocalWeaponAccum): boolean {
  const line = normalizeStatLineToEn(rawLine);
  if (!line) return false;

  // Local flat damage: "Adds X to Y <Type> Damage" (NOT "to Spells" / "to Attacks")
  let m = line.match(/^Adds (\d+) to (\d+) (Physical|Fire|Cold|Lightning|Chaos) Damage$/i);
  if (m) {
    const mn = Number(m[1]);
    const mx = Number(m[2]);
    const dt = m[3] as 'Physical' | 'Fire' | 'Cold' | 'Lightning' | 'Chaos';
    if (dt === 'Physical') {
      acc.flatPhysMin += mn;
      acc.flatPhysMax += mx;
    } else {
      const prev = acc.eleDamage[dt] ?? [0, 0];
      acc.eleDamage[dt] = [prev[0] + mn, prev[1] + mx];
    }
    return true;
  }

  m = line.match(/^(\d+)% increased Physical Damage$/i);
  if (m) {
    acc.incPhys += Number(m[1]);
    return true;
  }

  m = line.match(/^(\d+)% increased Attack Speed$/i);
  if (m) {
    acc.incAttackSpeed += Number(m[1]);
    return true;
  }

  // Local Crit Chance: "X% increased Critical Strike Chance" (NOT "Global" / "for Spells")
  m = line.match(/^(\d+)% increased Critical (?:Strike|Hit) Chance$/i);
  if (m) {
    acc.incCrit += Number(m[1]);
    return true;
  }

  m = line.match(/^\+(\d+(?:\.\d+)?)% to Critical (?:Strike|Hit) Chance$/i);
  if (m) {
    acc.flatCrit += Number(m[1]);
    return true;
  }

  return false;
}

/**
 * Resolves Path of Building-authentic Local Armour & Local Weapon stats
 * (PoE 1 3.25+/3.30 & PoE 2 0.5 multiplicative quality formula) and returns
 * only the non-local modifiers that should be fed to the global `ModDB`.
 */
export function resolveItemEffectiveStats(item: Item, game: GameId): ResolvedItemStats {
  // Hand-crafted starter presets without `localStatsPrecomputed` flag retain backward compatibility
  if (item.localStatsPrecomputed === undefined) {
    return {
      armourStats: item.armourStats,
      weaponStats: item.weaponStats,
      globalImplicits: item.implicits,
      globalExplicits: item.explicits,
    };
  }

  const hasPrecomputedSpiritHeader = Boolean(
    item.rawText && /^(?:Spirit|精魂)\s*[:：]\s*\+?\d+/im.test(item.rawText),
  );
  const stripLocalSpirit = (lines: readonly string[]): string[] =>
    hasPrecomputedSpiritHeader
      ? lines.filter((l) => !/^\d+%\s+increased\s+Spirit$/i.test(normalizeStatLineToEn(l)))
      : [...lines];

  const isWeapon = Boolean(item.weaponStats);
  const isArmour = !isWeapon && Boolean(item.armourStats);

  if (!isWeapon && !isArmour) {
    return {
      armourStats: item.armourStats,
      weaponStats: item.weaponStats,
      globalImplicits: stripLocalSpirit(item.implicits),
      globalExplicits: stripLocalSpirit(item.explicits),
    };
  }

  const globalImplicits: string[] = [];
  const globalExplicits: string[] = [];

  if (isArmour) {
    const acc: LocalArmourAccum = {
      flatArmour: 0,
      flatEvasion: 0,
      flatEs: 0,
      flatBlock: 0,
      flatWard: 0,
      incArmour: 0,
      incEvasion: 0,
      incEs: 0,
      incWard: 0,
    };
    for (const line of item.implicits) {
      if (!tryConsumeLocalArmourMod(line, acc)) globalImplicits.push(line);
    }
    for (const line of item.explicits) {
      if (!tryConsumeLocalArmourMod(line, acc)) globalExplicits.push(line);
    }

    if (item.localStatsPrecomputed) {
      let preArmour = item.armourStats;
      if (preArmour && preArmour.blockChance === undefined) {
        const baseBlock = getBaseItemStats(item.baseName, 0, game)?.armour?.blockChance;
        if (baseBlock || acc.flatBlock) {
          preArmour = {
            ...preArmour,
            blockChance: Math.min(100, (baseBlock ?? 0) + acc.flatBlock),
          };
        }
      }
      return {
        armourStats: preArmour,
        weaponStats: undefined,
        globalImplicits: stripLocalSpirit(globalImplicits),
        globalExplicits: stripLocalSpirit(globalExplicits),
      };
    }

    // Official PoB Item.lua: Tabula Rasa, Skin of the Loyal/Lords & The Apostate have zero base defences
    const ZERO_BASE_DEFENCE_UNIQUES = new Set([
      'Tabula Rasa',
      'Skin of the Loyal',
      'Skin of the Lords',
      'The Apostate',
    ]);
    // Compute exact PoB 3.30 / PoE 2 0.5 local Armour/Evasion/ES/Ward with multiplicative Quality
    const rawBase = ZERO_BASE_DEFENCE_UNIQUES.has(item.name)
      ? {}
      : (getBaseItemStats(item.baseName, 0, game)?.armour ?? item.armourStats ?? {});
    const qMult = 1 + Math.max(0, item.quality) / 100;
    const baseArm = (rawBase.armour ?? 0) + acc.flatArmour;
    const baseEva = (rawBase.evasion ?? 0) + acc.flatEvasion;
    const baseEs = (rawBase.energyShield ?? 0) + acc.flatEs;
    const baseWard = (rawBase.ward ?? 0) + acc.flatWard;

    const computedArmour: ArmourBaseStats = {
      ...(baseArm > 0 ? { armour: Math.round(baseArm * (1 + acc.incArmour / 100) * qMult) } : {}),
      ...(baseEva > 0 ? { evasion: Math.round(baseEva * (1 + acc.incEvasion / 100) * qMult) } : {}),
      ...(baseEs > 0 ? { energyShield: Math.round(baseEs * (1 + acc.incEs / 100) * qMult) } : {}),
      ...(baseWard > 0 ? { ward: Math.round(baseWard * (1 + acc.incWard / 100) * qMult) } : {}),
      ...(rawBase.blockChance || acc.flatBlock
        ? { blockChance: Math.min(100, (rawBase.blockChance ?? 0) + acc.flatBlock) }
        : {}),
    };

    return {
      armourStats: computedArmour,
      weaponStats: undefined,
      globalImplicits: stripLocalSpirit(globalImplicits),
      globalExplicits: stripLocalSpirit(globalExplicits),
    };
  }

  // Weapon local computation
  const acc: LocalWeaponAccum = {
    flatPhysMin: 0,
    flatPhysMax: 0,
    incPhys: 0,
    incAttackSpeed: 0,
    flatCrit: 0,
    incCrit: 0,
    eleDamage: {},
  };
  for (const line of item.implicits) {
    if (!tryConsumeLocalWeaponMod(line, acc)) globalImplicits.push(line);
  }
  for (const line of item.explicits) {
    if (!tryConsumeLocalWeaponMod(line, acc)) globalExplicits.push(line);
  }

  if (item.localStatsPrecomputed) {
    const preWeapon = item.weaponStats
      ? {
          ...item.weaponStats,
          weaponType: normalizeWeaponType(
            item.baseName,
            item.weaponStats.weaponType,
          ) as WeaponBaseStats['weaponType'],
        }
      : undefined;
    return {
      armourStats: undefined,
      weaponStats: preWeapon,
      globalImplicits: stripLocalSpirit(globalImplicits),
      globalExplicits: stripLocalSpirit(globalExplicits),
    };
  }

  const rawBase = getBaseItemStats(item.baseName, 0, game)?.weapon ?? item.weaponStats!;
  const qMult = 1 + Math.max(0, item.quality) / 100;
  const physMin = Math.round((rawBase.physicalMin + acc.flatPhysMin) * (1 + acc.incPhys / 100) * qMult);
  const physMax = Math.round((rawBase.physicalMax + acc.flatPhysMax) * (1 + acc.incPhys / 100) * qMult);
  const attacksPerSecond = Math.round(rawBase.attacksPerSecond * (1 + acc.incAttackSpeed / 100) * 100) / 100;
  const critChance = Math.round((rawBase.critChance + acc.flatCrit) * (1 + acc.incCrit / 100) * 100) / 100;

  const mergedEle: Partial<Record<'Fire' | 'Cold' | 'Lightning' | 'Chaos', [number, number]>> = {};
  for (const dt of ['Fire', 'Cold', 'Lightning', 'Chaos'] as const) {
    const baseR = rawBase.elementalDamage?.[dt];
    const addR = acc.eleDamage[dt];
    if (baseR || addR) {
      mergedEle[dt] = [(baseR?.[0] ?? 0) + (addR?.[0] ?? 0), (baseR?.[1] ?? 0) + (addR?.[1] ?? 0)];
    }
  }

  const computedWeapon: WeaponBaseStats = {
    ...rawBase,
    weaponType: normalizeWeaponType(item.baseName, rawBase.weaponType) as WeaponBaseStats['weaponType'],
    physicalMin: physMin,
    physicalMax: physMax,
    elementalDamage: Object.keys(mergedEle).length > 0 ? mergedEle : undefined,
    attacksPerSecond,
    critChance,
  };

  return {
    armourStats: undefined,
    weaponStats: computedWeapon,
    globalImplicits: stripLocalSpirit(globalImplicits),
    globalExplicits: stripLocalSpirit(globalExplicits),
  };
}
