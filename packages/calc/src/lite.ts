import type { CalcOutput, DamageRange, GameId } from '@webpob/core';

export {
  analyzeBuildDiagnostics,
  type BuildDiagnostic,
  type DiagnosticSeverity,
} from './diagnostics.js';
export { resolveItemEffectiveStats, type ResolvedItemStats } from './localItem.js';

const ZERO_RANGE: DamageRange = { min: 0, max: 0, average: 0 };

/**
 * Lightweight zeroed placeholder `CalcOutput` for initial main-thread store hydration
 * before the Web Worker finishes computing the live build.
 */
export function createEmptyCalcOutput(game: GameId): CalcOutput {
  return {
    game,
    offence: {
      mainSkillName: { en: '', zh: '' },
      skillType: 'None',
      damageByType: {
        Physical: { ...ZERO_RANGE },
        Fire: { ...ZERO_RANGE },
        Cold: { ...ZERO_RANGE },
        Lightning: { ...ZERO_RANGE },
        Chaos: { ...ZERO_RANGE },
      },
      averageHit: 0,
      speed: 0,
      critChance: 0,
      critMultiplier: 150,
      hitChance: 100,
      effectiveCritMultiplier: 1,
      hitDps: 0,
      igniteDps: 0,
      bleedDps: 0,
      poisonDps: 0,
      totalDps: 0,
      manaCost: 0,
      manaPerSecond: 0,
    },
    defence: {
      str: 0,
      dex: 0,
      int: 0,
      life: 0,
      lifeUnreserved: 0,
      lifeRegen: 0,
      energyShield: 0,
      esRegen: 0,
      ward: 0,
      mana: 0,
      manaUnreserved: 0,
      manaRegen: 0,
      spirit: 0,
      spiritReserved: 0,
      spiritUnreserved: 0,
      armour: 0,
      physDamageReduction: 0,
      evasion: 0,
      evadeChance: 0,
      blockChance: 0,
      spellBlockChance: 0,
      spellSuppressionChance: 0,
      fireResist: 0,
      fireResistOvercap: 0,
      fireMaxResist: 75,
      coldResist: 0,
      coldResistOvercap: 0,
      coldMaxResist: 75,
      lightningResist: 0,
      lightningResistOvercap: 0,
      lightningMaxResist: 75,
      chaosResist: 0,
      chaosResistOvercap: 0,
      chaosMaxResist: 75,
      movementSpeedPct: 0,
      effectiveHitPool: 0,
      maxPhysHitTaken: 0,
      maxEleHitTaken: 0,
    },
    breakdowns: [],
    allocatedPoints: 0,
    weaponSet1Points: 0,
    weaponSet2Points: 0,
    warnings: [],
  };
}
