import type { Build, CalcOutput, DamageRange, DamageType } from '@webpob/core';

const ZERO_RANGE: DamageRange = { min: 0, max: 0, average: 0 };

const EMPTY_DAMAGE_BY_TYPE: Record<DamageType, DamageRange> = {
  Physical: ZERO_RANGE,
  Fire: ZERO_RANGE,
  Cold: ZERO_RANGE,
  Lightning: ZERO_RANGE,
  Chaos: ZERO_RANGE,
};

/**
 * Lightweight zero-allocation placeholder used on initial store hydration before
 * the dedicated background `calc.worker` posts back the full `CalcOutput`.
 */
export function createEmptyCalcOutput(build: Build): CalcOutput {
  const allocatedPoints = Math.max(0, build.tree.allocatedNodeIds.length - 1);
  return {
    game: build.game,
    offence: {
      mainSkillName: { en: '—', zh: '—' },
      skillType: 'None',
      damageByType: EMPTY_DAMAGE_BY_TYPE,
      averageHit: 0,
      speed: 1,
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
      spirit: build.game === 'poe2' ? 100 : 0,
      spiritReserved: 0,
      spiritUnreserved: build.game === 'poe2' ? 100 : 0,
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
      movementSpeedPct: 100,
      effectiveHitPool: 0,
      maxPhysHitTaken: 0,
      maxEleHitTaken: 0,
    },
    breakdowns: [],
    allocatedPoints,
    weaponSet1Points: build.tree.weaponSet1NodeIds.length,
    weaponSet2Points: build.tree.weaponSet2NodeIds.length,
    warnings: [],
  };
}
