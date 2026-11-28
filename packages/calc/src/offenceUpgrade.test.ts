import { describe, expect, it } from 'vitest';
import {
  POE1_ARCHMAGE_MANA_PCT_BY_LEVEL,
  POE2_MONSTER_LIFE_TABLE,
  computeAilmentScaling,
  computeArchmageBonus,
  computeEffectiveEnemyResistance,
  computeEphemeralEdgeLightning,
  computePoe2CritMultiplier,
  computeSkillSpecialDamage,
  getPoe2MonsterLife,
  normalizeWeaponType,
  resolveEffectiveChargesAndRage,
} from './offenceUpgrade.js';

describe('offenceUpgrade — 1. computePoe2CritMultiplier', () => {
  it('computes base PoE 2 Crit Damage Bonus (+100% -> 200% total multiplier)', () => {
    const res = computePoe2CritMultiplier({ baseCritChance: 10 });
    expect(res.baseBonusPct).toBe(100);
    expect(res.effectiveBonusPct).toBe(100);
    expect(res.critMultiplierPct).toBe(200);
    expect(res.critMultiplier).toBe(2);
    expect(res.effectiveCritChance).toBe(10);
    // critEffect = 0.9 * 1 + 0.1 * 2 = 1.1
    expect(res.critEffect).toBeCloseTo(1.1, 6);
  });

  it('scales Critical Damage Bonus by INC and MORE (Pain Attunement 30% more)', () => {
    // (100 + 20) * (1 + 250/100) * 1.30 = 120 * 3.5 * 1.30 = 546% bonus -> 646% total crit multi
    const res = computePoe2CritMultiplier({
      baseCritChance: 10,
      incCritChancePct: 400,
      flatBonusPct: 20,
      incBonusPct: 250,
      moreBonusMult: 1.3,
    });
    expect(res.effectiveCritChance).toBeCloseTo(50, 6);
    expect(res.baseBonusPct).toBeCloseTo(546, 6);
    expect(res.critMultiplierPct).toBeCloseTo(646, 6);
    expect(res.critMultiplier).toBeCloseTo(6.46, 6);
  });

  it('computes Lucky Crit: p_eff = 1 - (1 - p)^2', () => {
    const res = computePoe2CritMultiplier({
      baseCritChance: 10,
      incCritChancePct: 400, // 50% pre-lucky
      luckyCrit: true,
    });
    expect(res.preLuckyCritChance).toBeCloseTo(50, 6);
    expect(res.effectiveCritChance).toBeCloseTo(75, 6);
  });

  it("computes Garukhan's Resolve Bifurcated Crit (+33.33% more crit bonus at 50% pre-bifurcate crit)", () => {
    // PoB2 CalcOffence.lua L3905-3907 & L3994-4014:
    // preBifurcate = 50% -> effectiveCrit = 75%, doubleCritChance = 25%
    // conditionalBifurcateChance = 25 / 75 = 1/3 -> critBifurcates = 4/3 (+33.33% more bonus)
    const res = computePoe2CritMultiplier({
      baseCritChance: 10,
      incCritChancePct: 400, // 50%
      incBonusPct: 200, // baseBonus = 300%
      bifurcatedCrit: true,
    });
    expect(res.preBifurcateCritChance).toBeCloseTo(50, 6);
    expect(res.effectiveCritChance).toBeCloseTo(75, 6);
    expect(res.critBifurcates).toBeCloseTo(4 / 3, 6);
    expect(res.effectiveBonusPct).toBeCloseTo(400, 6);
    expect(res.critMultiplierPct).toBeCloseTo(500, 6);

    // Exact PoB 2 LuaJIT verification on Ritualist Lightning Spear (#54):
    // base=24.76+1=25.76%, inc=273% -> 96.08% -> bifurcated 99.85%, conditional double-crit +92.45%
    // baseBonus=(100+17)*(1+4.49)=642.33 -> * 1.924557 = 1236.20 + 94 (Sniper's Mark) = 1330.20 -> 1430%
    const ritualistLs = computePoe2CritMultiplier({
      baseCritChance: 24.76,
      flatAddedBaseCrit: 1,
      incCritChancePct: 273,
      flatBonusPct: 17,
      incBonusPct: 449,
      enemyExtraCritFlatPct: 94,
      bifurcatedCrit: true,
    });
    expect(ritualistLs.effectiveCritChance).toBeCloseTo(99.85, 2);
    expect(Math.round(ritualistLs.critMultiplierPct)).toBe(1430);

    // Exact PoB 2 LuaJIT verification on Deadeye Ice Shot (#26):
    // base=10+1.22=11.22%, inc=379%, Garukhan cap=50% -> bifurcated 75% (+33.33% bonus)
    // baseBonus=(100+25)*(1+6.45)=931.25 -> * 4/3 = 1241.67 -> 1342%
    const deadeyeIceShot = computePoe2CritMultiplier({
      baseCritChance: 10,
      flatAddedBaseCrit: 1.22,
      incCritChancePct: 379,
      critChanceCap: 50,
      flatBonusPct: 25,
      incBonusPct: 645,
      bifurcatedCrit: true,
    });
    expect(deadeyeIceShot.effectiveCritChance).toBeCloseTo(75, 4);
    expect(Math.round(deadeyeIceShot.critMultiplierPct)).toBe(1342);
  });

  it('applies base crit overrides (Sunder the Flesh 15%, Overwhelm 8%, Sandstorm Visage)', () => {
    // Blood Mage Detonate Dead: Sunder the Flesh sets Spell base crit to 15%
    // With 175% inc crit -> 15 * 2.75 = 41.25% (exact Oracle match!)
    const sunder = computePoe2CritMultiplier({
      baseCritChance: 8,
      isSpell: true,
      sunderTheFlesh: true,
      incCritChancePct: 175,
    });
    expect(sunder.baseCritChance).toBe(15);
    expect(sunder.effectiveCritChance).toBeCloseTo(41.25, 6);

    // Slayer Overwhelm: sets Weapon Attack base crit to 8%
    const overwhelm = computePoe2CritMultiplier({
      baseCritChance: 5,
      isAttack: true,
      overwhelm: true,
      flatAddedBaseCrit: 1, // e.g. Struck Through +1%
    });
    expect(overwhelm.baseCritChance).toBe(9);

    // Sandstorm Visage: Spell base crit equals main-hand weapon crit (e.g. 11.5%)
    const sandstorm = computePoe2CritMultiplier({
      baseCritChance: 4,
      isSpell: true,
      sandstormVisageWeaponCrit: 11.5,
      incCritChancePct: 800,
    });
    expect(sandstorm.baseCritChance).toBe(11.5);
    expect(sandstorm.effectiveCritChance).toBe(100);
  });

  it('handles neverCrit and noCritMultiplier flags cleanly', () => {
    const rt = computePoe2CritMultiplier({
      baseCritChance: 15,
      incBonusPct: 300,
      neverCrit: true,
    });
    expect(rt.effectiveCritChance).toBe(0);
    expect(rt.critEffect).toBe(1);

    const noMulti = computePoe2CritMultiplier({
      baseCritChance: 50,
      incBonusPct: 300,
      noCritMultiplier: true,
    });
    expect(noMulti.effectiveCritChance).toBe(50);
    expect(noMulti.critMultiplierPct).toBe(100);
    expect(noMulti.critEffect).toBe(1);
  });
});

describe('offenceUpgrade — 2. resolveEffectiveChargesAndRage', () => {
  it('auto-syncs active charges to dynamic max caps (Assassin 11 PC, Slayer 7 Frenzy/Endurance)', () => {
    // Assassin Winter Orb: 3 base + 8 extra = 11 Power Charges
    const assassin = resolveEffectiveChargesAndRage({
      extraMaxPower: 8,
      usePowerCharges: true,
    });
    expect(assassin.maxPower).toBe(11);
    expect(assassin.power).toBe(11);

    // Slayer Elemental Hit with Masterful Form: 7 Frenzy -> 7 Endurance
    const slayer = resolveEffectiveChargesAndRage({
      extraMaxFrenzy: 4,
      masterfulForm: true,
      useFrenzyCharges: true,
      useEnduranceCharges: true,
    });
    expect(slayer.maxFrenzy).toBe(7);
    expect(slayer.frenzy).toBe(7);
    expect(slayer.maxEndurance).toBe(7);
    expect(slayer.endurance).toBe(7);
  });

  it('respects explicit user caps, Badge of the Brotherhood, Ralakesh, and dynamic Rage cap (40)', () => {
    // Explicit lower cap respected
    const capped = resolveEffectiveChargesAndRage({
      extraMaxPower: 8,
      usePowerCharges: true,
      explicitPowerCharges: 5,
    });
    expect(capped.power).toBe(5);
    expect(capped.maxPower).toBe(11);

    // Badge of the Brotherhood + Ralakesh's Impatience (countAsMax even when use* is false)
    const ralakesh = resolveEffectiveChargesAndRage({
      extraMaxPower: 7, // 10 max power
      badgeOfTheBrotherhood: true, // 10 max frenzy
      usePowerCharges: false,
      countAsMaxPower: true,
      countAsMaxFrenzy: true,
    });
    expect(ralakesh.power).toBe(10);
    expect(ralakesh.frenzy).toBe(10);

    // Juggernaut Rage 40 (30 base + 10 extra)
    const jugg = resolveEffectiveChargesAndRage({
      extraMaxEndurance: 4,
      useEnduranceCharges: true,
      extraMaxRage: 10,
      useRage: true,
    });
    expect(jugg.endurance).toBe(7);
    expect(jugg.maxRage).toBe(40);
    expect(jugg.rage).toBe(40);
  });
});

describe('offenceUpgrade — 3. computeArchmageBonus', () => {
  it('matches PoE 2 Archmage Oracle (3402 Mana -> +136% Gain as Extra Lightning)', () => {
    const res = computeArchmageBonus('poe2', 3402, 20);
    expect(res.gainAsExtraLightningPct).toBe(136);
    expect(res.flatLightningMin).toBe(0);
    expect(res.flatLightningMax).toBe(0);
    expect(res.manaCostPct).toBeCloseTo(6.1, 4);
    expect(res.addedManaCost).toBeCloseTo(3402 * 0.061, 4);
  });

  it('matches PoE 1 Archmage sup_int.lua scaling by gem level', () => {
    expect(POE1_ARCHMAGE_MANA_PCT_BY_LEVEL[0]).toBe(8);
    expect(POE1_ARCHMAGE_MANA_PCT_BY_LEVEL[19]).toBe(14);
    expect(POE1_ARCHMAGE_MANA_PCT_BY_LEVEL[35]).toBe(19);

    const lv20 = computeArchmageBonus('poe1', 6000, 20);
    expect(lv20.unreservedManaDamagePct).toBe(14);
    expect(lv20.flatLightningMin).toBeCloseTo(840, 4);
    expect(lv20.flatLightningMax).toBeCloseTo(840, 4);
    expect(lv20.addedManaCost).toBeCloseTo(300, 4); // 5% of 6000

    const lv36 = computeArchmageBonus('poe1', 6000, 36);
    expect(lv36.unreservedManaDamagePct).toBe(19);
    expect(lv36.flatLightningMin).toBeCloseTo(1140, 4);
  });
});

describe('offenceUpgrade — 4. computeSkillSpecialDamage', () => {
  it('matches PoE 2 Detonate Dead corpse explosion Oracle (Lv23 @ Lv82 corpse = 3822.9 Phys)', () => {
    expect(POE2_MONSTER_LIFE_TABLE.length).toBe(100);
    expect(getPoe2MonsterLife(82)).toBe(32956);

    const dd = computeSkillSpecialDamage('Detonate Dead', 'poe2', {
      gemLevel: 23,
      enemyLevel: 82,
    });
    expect(dd.corpseLife).toBe(32956);
    expect(dd.corpseLifePct).toBeCloseTo(0.116, 6);
    expect(dd.flatAddedDamage.Physical?.min).toBeCloseTo(3822.896, 2);
    expect(Math.round(dd.flatAddedDamage.Physical?.min ?? 0)).toBe(3823);
  });

  it('computes PoE 1 Righteous Fire burn DoT (70% Life+ES), no hit/ignite, and +39% more Spell Damage buff', () => {
    const rf = computeSkillSpecialDamage('Righteous Fire', 'poe1', {
      gemLevel: 20,
      maxLife: 5733,
      maxEs: 150,
    });
    expect(rf.canHit).toBe(false);
    expect(rf.canIgnite).toBe(false);
    expect(rf.baseDotDps.Fire).toBeCloseTo(0.7 * (5733 + 150), 4);
    expect(rf.buffSpellMorePct).toBe(39);

    const rf21 = computeSkillSpecialDamage('Righteous Fire', 'poe1', {
      gemLevel: 21,
      maxLife: 4773,
      maxEs: 1883,
    });
    expect(rf21.buffSpellMorePct).toBe(40);
    // PoE 3.23+: pure 70% of Life + ES with zero flat level base (4659.2 at 4773+1883)
    expect(rf21.baseDotDps.Fire).toBeCloseTo(4659.2, 4);

    const rfArcane = computeSkillSpecialDamage('Righteous Fire of Arcane Devotion', 'poe1', {
      gemLevel: 20,
      maxMana: 8000,
    });
    expect(rfArcane.canHit).toBe(false);
    expect(rfArcane.canIgnite).toBe(false);
    expect(rfArcane.spellDmgAppliesToDot).toBe(true);
    expect(rfArcane.baseDotDps.Fire).toBeCloseTo(5600, 4);
  });

  it('marks Bane and Bane of Condemnation as non-hitting Spell DoTs (canHit = false)', () => {
    for (const skillName of ['Bane', 'Bane of Condemnation']) {
      const res = computeSkillSpecialDamage(skillName, 'poe1', {
        gemLevel: 20,
        hasSkillDotData: true,
      });
      expect(res.canHit).toBe(false);
      expect(res.spellDmgAppliesToDot).toBe(true);
      expect(res.baseDotDps.Chaos).toBeUndefined();

      const fallback = computeSkillSpecialDamage(skillName, 'poe1', { gemLevel: 20 });
      expect(fallback.canHit).toBe(false);
      expect(fallback.baseDotDps.Chaos).toBeGreaterThan(1200);
    }
  });

  it('computes PoE 1 Spell DoT skills (Exsanguinate, Reap, Corrupting Fever, Essence Drain, Blight, Vortex, Cold Snap, Forbidden Rite)', () => {
    const exsang = computeSkillSpecialDamage('Exsanguinate', 'poe1', { gemLevel: 20, stages: 3 });
    expect(exsang.baseDotDps.Physical).toBeGreaterThan(1500);
    expect(exsang.dotMoreMult).toBe(3);
    expect(exsang.spellDmgAppliesToDot).toBe(true);

    const reap = computeSkillSpecialDamage('Reap', 'poe1', { gemLevel: 20, stages: 5 });
    expect(reap.baseDotDps.Physical).toBeGreaterThan(2500);
    expect(reap.hitMoreMult).toBeCloseTo(1.75, 6);
    expect(reap.dotMoreMult).toBeCloseTo(1.75, 6);

    const cf = computeSkillSpecialDamage('Corrupting Fever', 'poe1', { gemLevel: 20, stages: 10 });
    expect(cf.canHit).toBe(false);
    expect(cf.dotMoreMult).toBe(10);
    expect(cf.spellDmgAppliesToDot).toBe(false);

    const ed = computeSkillSpecialDamage('Essence Drain', 'poe1', { gemLevel: 20 });
    expect(ed.baseDotDps.Chaos).toBeGreaterThan(1600);
    expect(ed.spellDmgAppliesToDot).toBe(true);

    const blight = computeSkillSpecialDamage('Blight', 'poe1', { gemLevel: 20, stages: 20 });
    expect(blight.canHit).toBe(false);
    expect(blight.dotMoreMult).toBe(20);

    const vortex = computeSkillSpecialDamage('Vortex', 'poe1', { gemLevel: 20 });
    expect(vortex.baseDotDps.Cold).toBeGreaterThan(2300);

    const coldSnap = computeSkillSpecialDamage('Cold Snap', 'poe1', { gemLevel: 20 });
    expect(coldSnap.baseDotDps.Cold).toBeGreaterThan(1900);

    const fr = computeSkillSpecialDamage('Forbidden Rite', 'poe1', { maxLife: 5000, maxEs: 2000 });
    expect(fr.flatAddedDamage.Chaos?.min).toBeCloseTo(5000 * 0.14 + 2000 * 0.05, 4);

    const frss = computeSkillSpecialDamage('Forbidden Rite of Soul Sacrifice', 'poe1', {
      maxEs: 12200,
    });
    expect(frss.flatAddedDamage.Chaos?.min).toBeCloseTo(2440, 4);
  });

  it('computes Stage/Burst skills (Vaal Flameblast, Winter Orb, Flicker Strike, Penance Brand) and Ephemeral Edge', () => {
    const vfb10 = computeSkillSpecialDamage('Vaal Flameblast', 'poe1', { stages: 10 });
    expect(vfb10.hitMoreMult).toBeCloseTo(21, 6); // +2000% more Hit
    expect(vfb10.ailmentMoreMult).toBeCloseTo(12, 6); // +1100% more Ailment

    const worb = computeSkillSpecialDamage('Winter Orb', 'poe1', {
      stages: 10,
      isChannelling: true,
    });
    expect(worb.hitRateIncPct).toBe(180);
    expect(worb.hitRateMoreMult).toBe(2);

    const flickerPoe1 = computeSkillSpecialDamage('Flicker Strike', 'poe1', {
      hasChargeBypass: true,
    });
    expect(flickerPoe1.bypassCooldown).toBe(true);

    const pbrand = computeSkillSpecialDamage('Penance Brand of Dissipation', 'poe1', {
      stages: 20,
    });
    expect(pbrand.hitMoreMult).toBeCloseTo(4.8, 6);
    expect(pbrand.ailmentMoreMult).toBeCloseTo(4.8, 6);

    // Ephemeral Edge: 20% of Max ES as Max Lightning Damage
    const ee = computeEphemeralEdgeLightning(23821);
    expect(ee.min).toBe(0);
    expect(ee.max).toBeCloseTo(4764.2, 4);
    expect(ee.avg).toBeCloseTo(2382.1, 4);

    const splittingSteelEE = computeSkillSpecialDamage('Splitting Steel', 'poe1', {
      ephemeralEdge: true,
      maxEs: 20000,
    });
    expect(splittingSteelEE.flatAddedDamage.Lightning?.min).toBe(0);
    expect(splittingSteelEE.flatAddedDamage.Lightning?.max).toBe(4000);
  });
});

describe('offenceUpgrade — 5. computeEffectiveEnemyResistance', () => {
  it("handles Rakiata's Flow resistance inversion (50% -> -50%, 3.0x multiplier)", () => {
    const normal = computeEffectiveEnemyResistance(50, { element: 'Lightning' });
    expect(normal.effectiveResist).toBe(50);
    expect(normal.damageMult).toBeCloseTo(0.5, 6);

    const rakiata = computeEffectiveEnemyResistance(50, {
      element: 'Lightning',
      invertEnemyEleRes: true,
    });
    expect(rakiata.inverted).toBe(true);
    expect(rakiata.effectiveResist).toBe(-50);
    expect(rakiata.damageMult).toBeCloseTo(1.5, 6);
    expect(rakiata.damageMult / normal.damageMult).toBeCloseTo(3.0, 6);
  });

  it('handles Sacred Flame (lowest elemental resistance) and Inevitable Judgement (ignore on crit)', () => {
    const sacred = computeEffectiveEnemyResistance(50, {
      element: 'Fire',
      useLowestEleRes: true,
      allElementalResists: { Fire: 50, Cold: 50, Lightning: -10 },
    });
    expect(sacred.usedLowest).toBe(true);
    expect(sacred.effectiveResist).toBe(-10);
    expect(sacred.damageMult).toBeCloseTo(1.1, 6);

    const inq100 = computeEffectiveEnemyResistance(50, {
      element: 'Cold',
      ignoreOnCrit: true,
      critChancePct: 100,
    });
    expect(inq100.ignoredOnCrit).toBe(true);
    expect(inq100.critDamageMult).toBe(1.0);
    expect(inq100.damageMult).toBeCloseTo(1.0, 6);
    expect(inq100.effectiveResist).toBeCloseTo(0, 6);

    const inq50 = computeEffectiveEnemyResistance(50, {
      element: 'Cold',
      ignoreOnCrit: true,
      critChancePct: 50,
    });
    // 50% non-crit (0.5x) + 50% crit (1.0x) = 0.75x
    expect(inq50.damageMult).toBeCloseTo(0.75, 6);
  });
});

describe('offenceUpgrade — 6. computeAilmentScaling', () => {
  it('scales ailment DPS by faster speed, PoE 2 magnitude, and PoE 1 DoT multiplier', () => {
    // Blood Mage: 3x "Damaging Ailments deal damage 7% faster" (+21%) + 50% Magnitude
    const res = computeAilmentScaling(10000, {
      fasterPct: 21,
      magnitudeIncPct: 50,
      baseDurationSec: 5,
    });
    expect(res.fasterMult).toBeCloseTo(1.21, 6);
    expect(res.magnitudeMult).toBeCloseTo(1.5, 6);
    expect(res.totalMult).toBeCloseTo(1.815, 6);
    expect(res.scaledDps).toBeCloseTo(18150, 4);
    expect(res.effectiveDurationSec).toBeCloseTo(5 / 1.21, 6);
    // Faster deals same total damage in less time; magnitude increases total damage
    expect(res.totalDamage).toBeCloseTo(10000 * 1.5 * 5, 4);

    // PoE 1 DoT Multi + faster
    const poe1Bleed = computeAilmentScaling(100000, {
      fasterPct: 20,
      dotMultiPct: 80,
    });
    expect(poe1Bleed.scaledDps).toBeCloseTo(100000 * 1.2 * 1.8, 4);
  });
});

describe('offenceUpgrade — 7. normalizeWeaponType', () => {
  it('classifies PoE 2 Quarterstaff bases as Quarterstaff instead of Staff', () => {
    expect(normalizeWeaponType('Sinister Quarterstaff', 'Staff')).toBe('Quarterstaff');
    expect(normalizeWeaponType('Crescent Quarterstaff', 'Staff')).toBe('Quarterstaff');
    expect(normalizeWeaponType('Gothic Quarterstaff', 'Staff')).toBe('Quarterstaff');
    expect(normalizeWeaponType('Barrier Quarterstaff')).toBe('Quarterstaff');
    expect(normalizeWeaponType('Eclipse Staff', 'Staff')).toBe('Staff');
    expect(normalizeWeaponType('Gemini Bow', 'Bow')).toBe('Bow');
    expect(normalizeWeaponType('Dyad Crossbow')).toBe('Crossbow');
  });
});
