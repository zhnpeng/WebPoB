import { describe, expect, it } from 'vitest';
import {
  KeywordFlag,
  ModFlag,
  type GemDefinition,
  type GemInstance,
  type Item,
  type SkillGroup,
} from '@webpob/core';
import {
  getPoe2RunesData,
  getTimelessJewelData,
  registerGemsData,
  registerPoe2RunesData,
  registerTimelessJewelData,
  getGemsForGame,
} from '@webpob/data';
import { ModDB } from './modDb.js';
import {
  collectSquireSupportsForMainHand,
  computeSkillInstanceCountMultiplier,
  evaluatePersistentBuffAndStanceSkills,
  getPoe1MonsterLife,
  getPoe1SpellTotemLevel,
  getPoe1TotemBaseLife,
  resolveActiveSkillPartAndStats,
  resolveEffectiveWeaponSetForSkill,
  resolvePoe2MetaGemGroup,
} from './multiPartAndMetaRuntime.js';

function makeGemDef(overrides: Partial<GemDefinition> & { id: string; en: string }): GemDefinition {
  const { id, en, ...rest } = overrides;
  return {
    id,
    name: { en, zh: en },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['Spell'],
    modFlags: ModFlag.Spell | ModFlag.Hit,
    keywordFlags: KeywordFlag.Spell | KeywordFlag.Hit,
    stats: [],
    ...rest,
  };
}

function makeGemInst(overrides: Partial<GemInstance> & { gemId: string }): GemInstance {
  return {
    instanceId: `inst_${overrides.gemId}`,
    level: 20,
    quality: 0,
    enabled: true,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<SkillGroup> = {}): SkillGroup {
  return {
    id: 'sg_1',
    label: 'Test Group',
    enabled: true,
    gems: [],
    ...overrides,
  };
}

describe('multiPartAndMetaRuntime', () => {
  it('resolves explicit multi-part selection and merges part-level stats at effLevel', () => {
    const gemDef = makeGemDef({
      id: 'test_multipart',
      en: 'Test MultiPart Skill',
      baseDamage: { Fire: [100, 150] },
      damageEffectivenessPct: 100,
      baseCritChance: 5,
      parts: [
        {
          index: 1,
          name: 'Initial Hit',
          spell: true,
          critChance: 6,
          damageEffectiveness: 120,
          baseDamage: { Fire: [150, 220] },
        },
        {
          index: 2,
          name: 'Detonation',
          spell: true,
          area: true,
          critChance: 8,
          damageEffectiveness: 210,
          baseDamage: { Fire: [400, 600] },
          compiledMods: [
            { name: 'Damage', type: 'MORE', value: 30, flags: ModFlag.Area, keywordFlags: 0 },
          ],
          skillData: { explosionRadius: 24 },
          levels: {
            21: {
              baseDamage: { Fire: [520, 780] },
              damageEffectivenessPct: 230,
            },
          },
        },
      ],
    });
    const inst = makeGemInst({ gemId: gemDef.id, level: 21, skillPart: 2 });
    const group = makeGroup({ gems: [inst], skillPart: 1 });

    const res = resolveActiveSkillPartAndStats(gemDef, inst, group, 21);
    expect(res.partIndex).toBe(2);
    expect(res.partName).toBe('Detonation');
    expect(res.autoAdvancedPart).toBe(false);
    expect(res.area).toBe(true);
    expect(res.critChance).toBe(8);
    expect(res.damageEffectivenessPct).toBe(230);
    expect(res.baseDamage.Fire).toEqual([520, 780]);
    expect(res.compiledMods).toHaveLength(1);
    expect(res.skillData.explosionRadius).toBe(24);
  });

  it('auto-advances past zero-damage PoE 2 statSet[1] (Twister) to the primary damaging part', () => {
    const twister = makeGemDef({
      id: 'poe2_twister',
      en: 'Twister',
      game: 'poe2',
      tags: ['Attack', 'Projectile'],
      modFlags: ModFlag.Attack | ModFlag.Projectile | ModFlag.Hit,
      keywordFlags: KeywordFlag.Attack | KeywordFlag.Hit,
      parts: [
        {
          index: 1,
          name: 'Whirlwind Cast',
          attack: true,
          damageEffectiveness: 0,
          attackSpeedMultiplier: 0,
        },
        {
          index: 2,
          name: 'Twister Projectile',
          attack: true,
          projectile: true,
          damageEffectiveness: 165,
          attackSpeedMultiplier: 1.0,
          baseDamage: { Physical: [45, 85] },
        },
      ],
    });

    // Unset part -> auto-advances to part 2
    const instUnset = makeGemInst({ gemId: twister.id });
    const resUnset = resolveActiveSkillPartAndStats(twister, instUnset, makeGroup(), 20);
    expect(resUnset.autoAdvancedPart).toBe(true);
    expect(resUnset.partIndex).toBe(2);
    expect(resUnset.partName).toBe('Twister Projectile');
    expect(resUnset.damageEffectivenessPct).toBe(165);
    expect(resUnset.baseDamage.Physical).toEqual([45, 85]);

    // Explicitly requesting part 1 on a 0-damage wrapper also auto-advances to damaging part 2
    const instPart1 = makeGemInst({ gemId: twister.id, statSetIndex: 1 });
    const resPart1 = resolveActiveSkillPartAndStats(twister, instPart1, makeGroup(), 20);
    expect(resPart1.autoAdvancedPart).toBe(true);
    expect(resPart1.partIndex).toBe(2);
  });

  it('computes Molten Strike of the Zenith 5th-attack 1000% more and sequence average multipliers', () => {
    const zenith = makeGemDef({
      id: 'poe1_ms_zenith',
      en: 'Molten Strike of the Zenith',
      tags: ['Attack', 'Melee', 'Projectile', 'Fire'],
      modFlags: ModFlag.Attack | ModFlag.Melee | ModFlag.Hit,
      parts: [
        { index: 1, name: 'Melee Hit', attack: true, melee: true, attackSpeedMultiplier: 0.8 },
        { index: 2, name: '5th Attack Projectiles', attack: true, projectile: true, attackSpeedMultiplier: 0.8 },
        { index: 3, name: 'Sequence Average', attack: true, projectile: true, attackSpeedMultiplier: 0.8 },
      ],
    });

    const normal = resolveActiveSkillPartAndStats(zenith, makeGemInst({ gemId: zenith.id, skillPart: 1 }), makeGroup(), 20);
    const fifth = resolveActiveSkillPartAndStats(zenith, makeGemInst({ gemId: zenith.id, skillPart: 2 }), makeGroup(), 20);
    const average = resolveActiveSkillPartAndStats(zenith, makeGemInst({ gemId: zenith.id, skillPart: 3 }), makeGroup(), 20);

    expect(normal.sequenceDamageMultiplier).toBe(1);
    expect(fifth.sequenceDamageMultiplier).toBe(11); // 1000% more = 11x
    expect(average.sequenceDamageMultiplier).toBe(3); // (4*1 + 11) / 5 = 3x
  });

  it('computes Earthquake aftershock and Ice Nova of Frostbolts repeat multipliers', () => {
    const eq = makeGemDef({
      id: 'poe1_eq',
      en: 'Earthquake',
      tags: ['Attack', 'Melee', 'Area', 'Slam'],
      modFlags: ModFlag.Attack | ModFlag.Melee | ModFlag.Area | ModFlag.Hit,
      parts: [
        { index: 1, name: 'Initial Hit', attack: true, melee: true, area: true, damageEffectiveness: 150 },
        { index: 2, name: 'Aftershock', attack: true, melee: true, area: true, damageEffectiveness: 150 },
      ],
    });
    const eqAftershock = resolveActiveSkillPartAndStats(eq, makeGemInst({ gemId: eq.id, skillPart: 2 }), makeGroup(), 20);
    expect(eqAftershock.sequenceDamageMultiplier).toBe(2.5);

    const iceNova = makeGemDef({
      id: 'poe1_ice_nova_fb',
      en: 'Ice Nova of Frostbolts',
      tags: ['Spell', 'Area', 'Cold'],
      parts: [
        { index: 1, name: 'Self Cast', spell: true, area: true, baseDamage: { Cold: [600, 900] } },
        { index: 2, name: 'Cast on Frostbolts', spell: true, area: true, baseDamage: { Cold: [600, 900] } },
      ],
    });
    const frostboltCast = resolveActiveSkillPartAndStats(
      iceNova,
      makeGemInst({ gemId: iceNova.id, skillPart: 2 }),
      makeGroup(),
      20,
    );
    expect(frostboltCast.hitsPerUse).toBe(4);
    expect(frostboltCast.sequenceDamageMultiplier).toBe(4);
  });

  it('computes Tempest Flurry combo strike multipliers across parts', () => {
    const flurry = makeGemDef({
      id: 'poe2_tempest_flurry',
      en: 'Tempest Flurry',
      game: 'poe2',
      tags: ['Attack', 'Melee', 'Lightning'],
      modFlags: ModFlag.Attack | ModFlag.Melee | ModFlag.Hit,
      parts: [
        { index: 1, name: '1st & 2nd Strikes', attack: true, melee: true, damageEffectiveness: 100 },
        { index: 2, name: '3rd Strike', attack: true, melee: true, damageEffectiveness: 110 },
        { index: 3, name: '4th Final Strike', attack: true, melee: true, damageEffectiveness: 140 },
      ],
    });
    const third = resolveActiveSkillPartAndStats(flurry, makeGemInst({ gemId: flurry.id, statSetIndex: 2 }), makeGroup(), 20);
    const fourth = resolveActiveSkillPartAndStats(flurry, makeGemInst({ gemId: flurry.id, statSetIndex: 3 }), makeGroup(), 20);
    expect(third.hitsPerUse).toBe(2);
    expect(third.sequenceDamageMultiplier).toBe(1.2);
    expect(fourth.sequenceDamageMultiplier).toBe(1.5);
  });

  it('computes Detonate Dead corpse explosion base damage for both PoE 1 and PoE 2', () => {
    const ddPoe2 = makeGemDef({
      id: 'poe2_dd',
      en: 'Detonate Dead',
      game: 'poe2',
      tags: ['Spell', 'Area', 'Fire', 'Physical'],
    });
    const resPoe2 = resolveActiveSkillPartAndStats(ddPoe2, makeGemInst({ gemId: ddPoe2.id, level: 23 }), makeGroup(), 23, {
      enemyLevel: 82,
    });
    expect(resPoe2.corpseLife).toBe(32956);
    expect(resPoe2.corpseExplosionPct).toBeCloseTo(0.116, 4);
    expect(resPoe2.corpseExplosionDamageType).toBe('Physical');
    expect(resPoe2.baseDamage.Physical![0]).toBe(Math.round(32956 * 0.116));

    const ddScav = makeGemDef({
      id: 'poe1_dd_scav',
      en: 'Detonate Dead of Scavenging',
      game: 'poe1',
      tags: ['Spell', 'Area', 'Fire'],
    });
    const resScav = resolveActiveSkillPartAndStats(ddScav, makeGemInst({ gemId: ddScav.id, level: 20 }), makeGroup(), 20, {
      enemyLevel: 84,
    });
    expect(resScav.corpseLife).toBe(getPoe1MonsterLife(84));
    expect(resScav.corpseExplosionPct).toBe(0.09);
    expect(resScav.corpseExplosionDamageType).toBe('Fire');
    expect(resScav.baseDamage.Fire![0]).toBe(Math.round(getPoe1MonsterLife(84) * 0.09));
  });

  it('routes PoE 2 Cast on Critical Meta Gem wrapper to socketed payload spells with positive trigger rate', () => {
    const cocMeta = makeGemDef({
      id: 'poe2_coc',
      en: 'Cast on Critical',
      game: 'poe2',
      tags: ['Meta', 'Spirit'],
      isAuraOrBuff: true,
    });
    const comet = makeGemDef({
      id: 'poe2_comet',
      en: 'Comet',
      game: 'poe2',
      tags: ['Spell', 'Cold', 'Area'],
      castTime: 1.0,
      baseDamage: { Cold: [600, 900] },
    });
    const sup = makeGemDef({
      id: 'poe2_conc',
      en: 'Concentrated Effect Support',
      game: 'poe2',
      category: 'support',
      tags: ['Support', 'Area'],
    });
    const lookup = new Map<string, GemDefinition>([
      [cocMeta.id, cocMeta],
      [comet.id, comet],
      [sup.id, sup],
    ]);

    const metaGroup = makeGroup({
      gems: [
        makeGemInst({ gemId: cocMeta.id, level: 20, quality: 20 }),
        makeGemInst({ gemId: comet.id, level: 20 }),
        makeGemInst({ gemId: sup.id, level: 20 }),
      ],
    });
    const res = resolvePoe2MetaGemGroup(metaGroup, (id) => lookup.get(id));
    expect(res.isMetaGroup).toBe(true);
    expect(res.metaGem?.gemId).toBe(cocMeta.id);
    expect(res.payloadActives).toHaveLength(1);
    expect(res.payloadActives[0]!.def.name.en).toBe('Comet');
    // Official PoB 2 does not inject a synthetic energy trigger rate override for Cast on Critical
    expect(res.estimatedTriggerRate).toBe(0);

    // Non-meta group returns isMetaGroup: false
    const normalGroup = makeGroup({ gems: [makeGemInst({ gemId: comet.id })] });
    const normalRes = resolvePoe2MetaGemGroup(normalGroup, (id) => lookup.get(id));
    expect(normalRes.isMetaGroup).toBe(false);
    expect(normalRes.payloadActives).toHaveLength(0);
    expect(normalRes.estimatedTriggerRate).toBe(0);
  });

  it('evaluates PoE 2 Spirit Buffs (Wind Dancer, Scavenged Plating, Withering Presence, Berserk, Trinity) honoring active weapon set', () => {
    const defs = new Map<string, GemDefinition>([
      ['wd', makeGemDef({ id: 'wd', en: 'Wind Dancer', game: 'poe2', isAuraOrBuff: true })],
      ['sp', makeGemDef({ id: 'sp', en: 'Scavenged Plating', game: 'poe2', isAuraOrBuff: true })],
      ['wp', makeGemDef({ id: 'wp', en: 'Withering Presence', game: 'poe2', isAuraOrBuff: true })],
      ['bsk', makeGemDef({ id: 'bsk', en: 'Berserk', game: 'poe2', isAuraOrBuff: true })],
      ['tri', makeGemDef({ id: 'tri', en: 'Trinity', game: 'poe2', isAuraOrBuff: true })],
    ]);

    const playerDb = new ModDB();
    playerDb.setMultiplier('Rage', 30);
    const enemyDb = new ModDB();

    const skills: SkillGroup[] = [
      makeGroup({ id: 'g1', weaponSets: [1], gems: [makeGemInst({ gemId: 'wd', level: 20, count: 3 })] }),
      makeGroup({ id: 'g2', weaponSets: [2], gems: [makeGemInst({ gemId: 'sp', level: 20, count: 10 })] }), // inactive on WS 1
      makeGroup({ id: 'g3', weaponSets: [1, 2], gems: [makeGemInst({ gemId: 'wp', level: 20, count: 8 })] }),
      makeGroup({ id: 'g4', weaponSets: [1, 2], gems: [makeGemInst({ gemId: 'bsk', level: 20 })] }),
      makeGroup({ id: 'g5', weaponSets: [1, 2], gems: [makeGemInst({ gemId: 'tri', level: 20 })] }),
    ];

    const evalRes = evaluatePersistentBuffAndStanceSkills(
      skills,
      1,
      'poe2',
      playerDb,
      enemyDb,
      (id) => defs.get(id),
    );

    expect(evalRes.appliedSkills).toContain('Wind Dancer');
    expect(evalRes.appliedSkills).not.toContain('Scavenged Plating');
    expect(evalRes.appliedSkills).toContain('Withering Presence');
    expect(evalRes.appliedSkills).toContain('Berserk');
    expect(evalRes.appliedSkills).toContain('Trinity');

    // Wind Dancer: 3 stages * 19% = 57% more Evasion
    expect(playerDb.more('Evasion')).toBeCloseTo(1.57, 2);
    // Scavenged Plating skipped because weaponSets: [2] vs activeWeaponSet: 1
    expect(playerDb.more('Armour')).toBe(1);
    // Withering Presence: 8 stacks * 5% = 40% increased Chaos Damage Taken on enemyDb
    expect(evalRes.witheredStacksApplied).toBe(8);
    expect(enemyDb.sum('INC', 'ChaosDamageTaken')).toBe(40);
    // Berserk (Lv20/Q0) emits official PoB 2 RageEffect INC (59%) cleanly without double-applying Damage MORE
    expect(playerDb.sum('INC', 'RageEffect')).toBe(59);
    expect(playerDb.getEvalContext().conditions.Berserk).toBe(true);
    // PoE 2 Trinity Lv20 default (300 resonance = 10 stacks * 6% = 60% MORE Ele) and 0% Elemental Penetration
    expect(playerDb.more('ElementalDamage')).toBeCloseTo(1.6, 2);
    expect(playerDb.sum('BASE', 'LightningPenetration')).toBe(0);
    expect(playerDb.sum('BASE', 'ElementalPenetration')).toBe(0);
  });

  it('scales PoE 2 Trinity accurately for both pre-divided stacks (1..10 from engine.ts) and raw resonance (0..300) + Q20 speed', () => {
    const triDef = makeGemDef({
      id: 'poe2_trinity',
      en: 'Trinity',
      game: 'poe2',
      isAuraOrBuff: true,
      compiledMods: [
        { name: 'ElementalDamage', type: 'MORE', value: 6, flags: 0, keywordFlags: 0 },
      ],
      levelScaling: {
        18: {
          compiledMods: [
            { name: 'ElementalDamage', type: 'MORE', value: 5, flags: 0, keywordFlags: 0 },
          ],
        },
      },
    });
    const defs = new Map<string, GemDefinition>([[triDef.id, triDef]]);

    // Case 1: engine.ts pre-divided stacks = 6 (180 Resonance) at Lv20 (per30 = 6) -> +36% MORE Ele, no Q20 speed (<250)
    const db1 = new ModDB();
    db1.setMultiplier('ResonanceCount', 6);
    evaluatePersistentBuffAndStanceSkills(
      [makeGroup({ id: 'g1', gems: [makeGemInst({ gemId: triDef.id, level: 20, quality: 20 })] })],
      1,
      'poe2',
      db1,
      new ModDB(),
      (id) => defs.get(id),
    );
    expect(db1.more('ElementalDamage')).toBeCloseTo(1.36, 4);
    expect(db1.sum('INC', 'Speed', ModFlag.Attack)).toBe(0);

    // Case 2: engine.ts pre-divided stacks = 10 (300 Resonance) at Lv18 (per30 = 5) -> +50% MORE Ele + Q20 +15% Speed
    const db2 = new ModDB();
    db2.setMultiplier('ResonanceCount', 10);
    evaluatePersistentBuffAndStanceSkills(
      [makeGroup({ id: 'g2', gems: [makeGemInst({ gemId: triDef.id, level: 18, quality: 20 })] })],
      1,
      'poe2',
      db2,
      new ModDB(),
      (id) => defs.get(id),
    );
    expect(db2.more('ElementalDamage')).toBeCloseTo(1.5, 4);
    expect(db2.sum('INC', 'Speed', ModFlag.Attack)).toBe(15);
    expect(db2.sum('INC', 'Speed', ModFlag.Spell)).toBe(15);
  });

  it('computes PoE 1 Bodyswap Spell Totem Self Explosion from exact PoB 1 totem life table when totemMaxLife is omitted', () => {
    expect(getPoe1SpellTotemLevel(20)).toBe(70);
    expect(getPoe1SpellTotemLevel(34)).toBe(94);
    expect(getPoe1TotemBaseLife(70, 1)).toBe(1478);
    expect(getPoe1TotemBaseLife(94, 1)).toBe(5116);

    const bodyswap = makeGemDef({
      id: 'poe1_bodyswap',
      en: 'Bodyswap',
      game: 'poe1',
      modFlags: ModFlag.Spell | ModFlag.Area,
      baseDamage: { Fire: [100, 150] },
      skillData: { selfFireExplosionLifeMultiplier: 0.06 },
    });
    const inst = makeGemInst({ gemId: bodyswap.id, level: 22, quality: 54 });
    const grp = makeGroup({ gems: [inst] });

    // Lv34 Spell Totem (base 5116) with +110% Totem Life INC -> 10,744 TotemLife (vs 5,394 PlayerLife)
    // Self explosion % = 6% + floor(54 * 0.3)% = 6% + 16% = 22% -> round(10744 * 0.22) = 2364 flat Fire
    const res = resolveActiveSkillPartAndStats(bodyswap, inst, grp, 22, {
      game: 'poe1',
      isTotem: true,
      playerMaxLife: 5394,
      totemSkillLevel: 34,
      totemLifeIncPct: 110,
      effectiveQuality: 54,
    });
    expect(res.corpseLife).toBe(10744);
    expect(res.corpseExplosionPct).toBeCloseTo(0.22, 6);
    expect(res.baseDamage.Fire).toEqual([100 + 2364, 150 + 2364]);
  });

  it('deduplicates PoE 2 Trinity across socket groups, scales Withering Presence by WitherEffect, and applies Berserk quality', () => {
    const defs = new Map<string, GemDefinition>([
      ['wp', makeGemDef({ id: 'wp', en: 'Withering Presence', game: 'poe2', isAuraOrBuff: true })],
      ['bsk', makeGemDef({ id: 'bsk', en: 'Berserk', game: 'poe2', isAuraOrBuff: true })],
      ['tri', makeGemDef({ id: 'tri', en: 'Trinity', game: 'poe2', isAuraOrBuff: true })],
    ]);

    const playerDb = new ModDB();
    playerDb.setMultiplier('ResonanceCount', 300);
    playerDb.addMod({
      name: 'WitherEffect',
      type: 'INC',
      value: 60,
      flags: 0,
      keywordFlags: 0,
      source: 'Tree: Withered Effect',
    });
    const enemyDb = new ModDB();

    const skills: SkillGroup[] = [
      makeGroup({ id: 'g1', gems: [makeGemInst({ gemId: 'tri', level: 18, quality: 20 })] }),
      makeGroup({ id: 'g2', gems: [makeGemInst({ gemId: 'tri', level: 18, quality: 20 })] }),
      makeGroup({ id: 'g3', gems: [makeGemInst({ gemId: 'wp', level: 19, count: 10 })] }),
      makeGroup({ id: 'g4', gems: [makeGemInst({ gemId: 'bsk', level: 20, quality: 20 })] }),
    ];

    const evalRes = evaluatePersistentBuffAndStanceSkills(
      skills,
      1,
      'poe2',
      playerDb,
      enemyDb,
      (id) => defs.get(id),
    );

    // Trinity applied ONCE: Lv18 per30=5, floor(300/30)*5 = 50% MORE Ele, 0% Pen, Q20 = 15% INC speed
    expect(evalRes.appliedSkills.filter((s) => s === 'Trinity')).toHaveLength(1);
    expect(playerDb.more('ElementalDamage')).toBeCloseTo(1.5, 4);
    expect(playerDb.sum('BASE', 'FirePenetration')).toBe(0);
    expect(playerDb.sum('INC', 'Speed', ModFlag.Attack)).toBe(15);

    // Withering Presence: 10 stacks * floor(5 * 1.6) = 80% Chaos Damage Taken
    expect(enemyDb.sum('INC', 'ChaosDamageTaken')).toBe(80);

    // Berserk Lv20/Q20: 59% + floor(20 * 0.5) = 69% RageEffect INC
    expect(playerDb.sum('INC', 'RageEffect')).toBe(69);
  });

  it('routes PoE 2 Spell Totem meta wrapper supports onto payload spell with -25% less cast speed and zero trigger rate override', () => {
    const spellTotem = makeGemDef({
      id: 'poe2_metaspelltotem',
      en: 'Spell Totem',
      game: 'poe2',
      tags: ['Meta', 'Spell', 'Totem'],
      altIds: ['SupportMetaTotemSpellTotemPlayer', 'SummonMetaTotemSpellTotemPlayer'],
    });
    const grimPillars = makeGemDef({
      id: 'poe2_grimpillars',
      en: 'Grim Pillars',
      game: 'poe2',
      tags: ['Spell', 'Cold', 'Area'],
      castTime: 0.7,
    });
    const urgentTotems = makeGemDef({
      id: 'poe2_urgenttotemssupportthree',
      en: 'Urgent Totems III',
      game: 'poe2',
      category: 'support',
      tags: ['Support', 'Totem'],
    });
    const execute3 = makeGemDef({
      id: 'poe2_executesupportthree',
      en: 'Execute III',
      game: 'poe2',
      category: 'support',
      tags: ['Support'],
    });

    const lookup = new Map<string, GemDefinition>([
      [spellTotem.id, spellTotem],
      [grimPillars.id, grimPillars],
      [urgentTotems.id, urgentTotems],
      [execute3.id, execute3],
    ]);

    const group = makeGroup({
      gems: [
        makeGemInst({ gemId: spellTotem.id, level: 19 }),
        makeGemInst({ gemId: grimPillars.id, level: 18, quality: 20 }),
        makeGemInst({ gemId: urgentTotems.id, level: 1 }),
        makeGemInst({ gemId: execute3.id, level: 1 }),
      ],
    });

    const res = resolvePoe2MetaGemGroup(group, (id) => lookup.get(id));
    expect(res.isMetaGroup).toBe(true);
    expect(res.isSpellTotemMeta).toBe(true);
    expect(res.estimatedTriggerRate).toBe(0);
    expect(res.payloadActives.map((p) => p.def.id)).toEqual(['poe2_grimpillars']);
    expect(res.routedSupports?.map((s) => s.def.id)).toEqual([
      'poe2_urgenttotemssupportthree',
      'poe2_executesupportthree',
    ]);
    expect(res.metaSupportMods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Speed', type: 'MORE', value: -25 }),
        expect.objectContaining({ name: 'ActiveTotemLimit', type: 'OVERRIDE', value: 2 }),
      ]),
    );
    expect(res.addedSkillTypes).toContain('Totem');
    expect(res.addedSkillTypes).toContain('UsedByTotem');
  });

  it('evaluates PoE 1 Blood and Sand stance switching and Herald of Agony Virulence crawler scaling', () => {
    const defs = new Map<string, GemDefinition>([
      ['bas', makeGemDef({ id: 'bas', en: 'Blood and Sand', game: 'poe1', isAuraOrBuff: true })],
      ['hoag', makeGemDef({ id: 'hoag', en: 'Herald of Agony', game: 'poe1', isAuraOrBuff: true })],
    ]);

    const dbBlood = new ModDB();
    const resBlood = evaluatePersistentBuffAndStanceSkills(
      [
        makeGroup({ gems: [makeGemInst({ gemId: 'bas', level: 6, skillPart: 1 })] }),
        makeGroup({ gems: [makeGemInst({ gemId: 'hoag', level: 20, count: 40 })] }),
      ],
      1,
      'poe1',
      dbBlood,
      new ModDB(),
      (id) => defs.get(id),
    );
    expect(resBlood.activeStance).toBe('Blood');
    expect(dbBlood.more('Damage', ModFlag.Melee | ModFlag.Area)).toBeCloseTo(1.15, 2);
    expect(resBlood.virulenceStacks).toBe(40);
    expect(dbBlood.sum('INC', 'MinionDamage', 0, KeywordFlag.Minion)).toBe(800);
    expect(dbBlood.sum('BASE', 'PoisonChance')).toBe(20);

    const dbSand = new ModDB();
    const resSand = evaluatePersistentBuffAndStanceSkills(
      [makeGroup({ gems: [makeGemInst({ gemId: 'bas', level: 6, skillPart: 2 })] })],
      1,
      'poe1',
      dbSand,
      new ModDB(),
      (id) => defs.get(id),
    );
    expect(resSand.activeStance).toBe('Sand');
    expect(dbSand.more('AreaOfEffect', ModFlag.Melee)).toBeCloseTo(1.15, 2);
    expect(dbSand.more('Damage', ModFlag.Melee | ModFlag.Area)).toBeCloseTo(0.95, 2);
  });

  it('honors Vaal gem enableGlobal1 vs enableGlobal2 gating cleanly', () => {
    const vaalHaste = makeGemDef({
      id: 'poe1_vaal_haste',
      en: 'Vaal Haste',
      game: 'poe1',
      isAuraOrBuff: true,
    });
    const lookup = (id: string) => (id === vaalHaste.id ? vaalHaste : undefined);

    // Base enabled, Vaal disabled -> Vaal burst speed MUST NOT apply
    const dbNoVaal = new ModDB();
    const resNoVaal = evaluatePersistentBuffAndStanceSkills(
      [makeGroup({ gems: [makeGemInst({ gemId: vaalHaste.id, enableGlobal1: true, enableGlobal2: false })] })],
      1,
      'poe1',
      dbNoVaal,
      new ModDB(),
      lookup,
    );
    expect(resNoVaal.appliedSkills).toEqual(['Vaal Haste (Base)']);
    expect(dbNoVaal.sum('INC', 'Speed', ModFlag.Attack)).toBe(0);

    // Vaal enabled -> Vaal Haste attack/cast speed applies
    const dbWithVaal = new ModDB();
    const resWithVaal = evaluatePersistentBuffAndStanceSkills(
      [makeGroup({ gems: [makeGemInst({ gemId: vaalHaste.id, enableGlobal1: true, enableGlobal2: true })] })],
      1,
      'poe1',
      dbWithVaal,
      new ModDB(),
      lookup,
    );
    expect(resWithVaal.appliedSkills).toContain('Vaal Haste (Vaal)');
    expect(dbWithVaal.sum('INC', 'Speed', ModFlag.Attack)).toBeGreaterThanOrEqual(30);
  });

  it('resolves effective PoE 2 weapon set exclusively targeted by main skill group', () => {
    expect(resolveEffectiveWeaponSetForSkill(makeGroup({ weaponSets: [2] }), 1, 'poe2')).toBe(2);
    expect(resolveEffectiveWeaponSetForSkill(makeGroup({ weaponSets: [1] }), 2, 'poe2')).toBe(1);
    expect(resolveEffectiveWeaponSetForSkill(makeGroup({ weaponSets: [1, 2] }), 2, 'poe2')).toBe(2);
    expect(resolveEffectiveWeaponSetForSkill(makeGroup({ weaponSets: [2] }), 1, 'poe1')).toBe(1);
  });

  it('bridges Weapon 2 support gems onto Main Hand when The Squire is equipped, including socketed support quality bonus', () => {
    const squire: Item = {
      id: 'item_squire',
      name: 'The Squire',
      baseName: 'Elegant Round Shield',
      rarity: 'UNIQUE',
      slotType: 'Weapon 2',
      quality: 20,
      implicits: [],
      explicits: [
        '+40% to Quality of Socketed Support Gems',
        '+1 to Level of Socketed Support Gems',
        'Socketed Support Gems can also Support Skills from your Main Hand',
      ],
    };

    const defs = new Map<string, GemDefinition>([
      ['sup_a', makeGemDef({ id: 'sup_a', en: 'Multistrike Support', category: 'support', tags: ['Support', 'Melee'] })],
      ['sup_b', makeGemDef({ id: 'sup_b', en: 'Melee Physical Damage Support', category: 'support', tags: ['Support', 'Melee'] })],
      ['act_c', makeGemDef({ id: 'act_c', en: 'Tempest Shield', category: 'active', tags: ['Spell'] })],
    ]);

    const skills: SkillGroup[] = [
      makeGroup({
        id: 'sg_squire',
        slot: 'Weapon 2',
        gems: [
          makeGemInst({ gemId: 'sup_a', level: 20, quality: 20, enabled: true }),
          makeGemInst({ gemId: 'sup_b', level: 20, quality: 0, enabled: true }),
          makeGemInst({ gemId: 'sup_b', level: 20, quality: 0, enabled: false }), // disabled support ignored
          makeGemInst({ gemId: 'act_c', level: 20, quality: 0, enabled: true }), // active gem ignored
        ],
      }),
    ];

    const bridged = collectSquireSupportsForMainHand(
      skills,
      [{ slot: 'Weapon 2', item: squire }],
      (id) => defs.get(id),
    );
    expect(bridged.hasSquire).toBe(true);
    expect(bridged.squireQualityBonus).toBe(40);
    expect(bridged.squireLevelBonus).toBe(1);
    expect(bridged.bridgedSupports).toHaveLength(2);
    expect(bridged.bridgedSupports[0]!.quality).toBe(60); // 20 + 40
    expect(bridged.bridgedSupports[0]!.level).toBe(21); // 20 + 1
    expect(bridged.bridgedSupports[1]!.quality).toBe(40); // 0 + 40

    // Ordinary shield does not bridge supports
    const normalShield: Item = { ...squire, name: 'Rare Shield', explicits: ['+100 to maximum Life'] };
    const noBridge = collectSquireSupportsForMainHand(
      skills,
      { 'Weapon 2': normalShield },
      (id) => defs.get(id),
    );
    expect(noBridge.hasSquire).toBe(false);
    expect(noBridge.bridgedSupports).toHaveLength(0);
  });

  it('computes multi-instance skill count multiplier accurately', () => {
    expect(computeSkillInstanceCountMultiplier(makeGemInst({ gemId: 'x', count: 3 }))).toBe(3);
    expect(computeSkillInstanceCountMultiplier(makeGemInst({ gemId: 'x', count: undefined }))).toBe(1);
    expect(computeSkillInstanceCountMultiplier(makeGemInst({ gemId: 'x', count: 0 }))).toBe(1);
    expect(computeSkillInstanceCountMultiplier(makeGemInst({ gemId: 'x', count: -4 }))).toBe(1);
    expect(computeSkillInstanceCountMultiplier(makeGemInst({ gemId: 'x', count: 4.6 }))).toBe(5);
  });

  it('hydrates CompactSkillPartEntry into GemDefinition.parts and stores optional timeless/runes datasets', () => {
    const beforePoe2 = getGemsForGame('poe2');
    registerGemsData('poe2', {
      game: 'poe2',
      count: 1,
      gems: [
        {
          id: 'poe2_synthetic_twister',
          en: 'Synthetic Twister',
          cat: 'active',
          color: 'green',
          tags: ['Attack', 'Projectile'],
          parts: [
            { idx: 1, name: 'Cast', attack: true, de: 0, am: 0 },
            {
              idx: 2,
              name: 'Projectile',
              attack: true,
              projectile: true,
              cc: 7,
              de: 150,
              am: 1.1,
              bd: { Physical: [30, 60] },
              ls: { '20': { bd: { Physical: [50, 100] }, de: 180 } },
            },
          ],
        },
      ],
    });
    const hydrated = getGemsForGame('poe2').find((g) => g.id === 'poe2_synthetic_twister');
    expect(hydrated?.parts).toHaveLength(2);
    expect(hydrated?.parts?.[1]?.damageEffectiveness).toBe(150);
    expect(hydrated?.parts?.[1]?.levels?.[20]?.baseDamage?.Physical).toEqual([50, 100]);
    expect(beforePoe2.length).toBeGreaterThan(0);

    registerTimelessJewelData('poe1', { game: 'poe1', version: '3_30', seeds: { 1234: {} } });
    expect(getTimelessJewelData('poe1')?.version).toBe('3_30');

    registerPoe2RunesData({ version: '0_5', runes: { 'Perfect Mind Rune': { mana: 35 } } });
    expect(getPoe2RunesData()?.version).toBe('0_5');

    // Clean up test registries
    registerTimelessJewelData('poe1', null);
    registerPoe2RunesData(null);
  });

  it('does NOT fabricate a 4x Frostbolts multiplier for partless Ice Nova of Frostbolts (poe1_icenovaaltx)', () => {
    const iceNovaPartless = makeGemDef({
      id: 'poe1_icenovaaltx',
      en: 'Ice Nova of Frostbolts',
      tags: ['Spell', 'Area', 'Cold'],
      baseDamage: { Cold: [590, 885] },
    });
    const res = resolveActiveSkillPartAndStats(
      iceNovaPartless,
      makeGemInst({ gemId: iceNovaPartless.id }),
      makeGroup(),
      20,
    );
    expect(res.hitsPerUse).toBe(1);
    expect(res.sequenceDamageMultiplier).toBe(1);
  });

  it('scales Earthquake of Amplification Aftershock multiplier with durationMultiplier and quality', () => {
    const eqAmp = makeGemDef({
      id: 'poe1_earthquakealtx',
      en: 'Earthquake of Amplification',
      tags: ['Attack', 'Melee', 'Area', 'Slam', 'Duration'],
      modFlags: ModFlag.Attack | ModFlag.Melee | ModFlag.Area | ModFlag.Hit,
      parts: [
        { index: 1, name: 'Initial impact', attack: true, melee: true, area: true },
        { index: 2, name: 'Aftershock', attack: true, melee: true, area: true, skillData: { duration: 2.0 } },
      ],
    });
    const unscaled = resolveActiveSkillPartAndStats(
      eqAmp,
      makeGemInst({ gemId: eqAmp.id, skillPart: 2 }),
      makeGroup(),
      20,
    );
    expect(unscaled.sequenceDamageMultiplier).toBe(3.0); // 2.0s -> 200% more = 3.0x

    const scaled = resolveActiveSkillPartAndStats(
      eqAmp,
      makeGemInst({ gemId: eqAmp.id, skillPart: 2 }),
      makeGroup(),
      20,
      { durationMultiplier: 4.65 },
    );
    expect(scaled.sequenceDamageMultiplier).toBe(10.3); // 9.3s -> 930% more = 10.3x
  });

  it('computes PoE 1 Bodyswap Part 1 Self Explosion (player/totem life + quality) and Part 2 Corpse Explosion', () => {
    const bodyswap = makeGemDef({
      id: 'poe1_bodyswap',
      en: 'Bodyswap',
      tags: ['Spell', 'Area', 'Fire', 'Movement'],
      baseDamage: { Fire: [210, 315] },
      parts: [
        {
          index: 1,
          name: 'Self Explosion',
          spell: true,
          area: true,
          baseDamage: { Fire: [210, 315] },
          skillData: { selfFireExplosionLifeMultiplier: 0.06, corpseExplosionLifeMultiplier: 0.079 },
        },
        {
          index: 2,
          name: 'Corpse Explosion',
          spell: false,
          area: true,
          baseDamage: { Fire: [210, 315] },
          skillData: { selfFireExplosionLifeMultiplier: 0.06, corpseExplosionLifeMultiplier: 0.079, explodeCorpse: true },
        },
      ],
    });

    // Self-cast Part 1 at 20% quality: 6% + floor(20 * 0.3)% = 12% of 5000 Life = +600 Fire
    const selfRes = resolveActiveSkillPartAndStats(
      bodyswap,
      makeGemInst({ gemId: bodyswap.id, skillPart: 1, quality: 20 }),
      makeGroup(),
      20,
      { playerMaxLife: 5000 },
    );
    expect(selfRes.corpseExplosionPct).toBeCloseTo(0.12, 4);
    expect(selfRes.baseDamage.Fire).toEqual([810, 915]);
    expect(selfRes.skillData.FireBonusMin).toBeCloseTo(600, 4);

    // Self-cast Part 1 with Lv4 Enhance (44% effective quality): 6% + floor(44 * 0.3)% = 19% of 10000 Life = +1900 Fire
    const enhanceRes = resolveActiveSkillPartAndStats(
      bodyswap,
      makeGemInst({ gemId: bodyswap.id, skillPart: 1, quality: 20 }),
      makeGroup(),
      21,
      { playerMaxLife: 10000, effectiveQuality: 44 },
    );
    expect(enhanceRes.corpseExplosionPct).toBeCloseTo(0.19, 4);
    expect(enhanceRes.baseDamage.Fire).toEqual([2110, 2215]);

    // Spell Totem Part 1 uses totemMaxLife instead of playerMaxLife
    const totemRes = resolveActiveSkillPartAndStats(
      bodyswap,
      makeGemInst({ gemId: bodyswap.id, skillPart: 1, quality: 20 }),
      makeGroup(),
      20,
      { playerMaxLife: 4000, totemMaxLife: 15000, isTotem: true },
    );
    expect(totemRes.baseDamage.Fire).toEqual([210 + 1800, 315 + 1800]);

    // Part 2 Corpse Explosion replaces base Fire with pure corpse explosion (no Part 1 spell base)
    const corpseRes = resolveActiveSkillPartAndStats(
      bodyswap,
      makeGemInst({ gemId: bodyswap.id, skillPart: 2, quality: 20 }),
      makeGroup(),
      20,
      { enemyLevel: 84 },
    );
    const expectedCorpse = Math.round(getPoe1MonsterLife(84) * 0.079);
    expect(corpseRes.baseDamage.Fire).toEqual([expectedCorpse, expectedCorpse]);
  });

  it('routes PoE 2 Mortar Cannon, Hollow Form, Mirage Deadeye, Mirage Archer, and Ancestral Warrior Totem meta wrappers with official PoB 2 support mods', () => {
    const explosiveGrenade = makeGemDef({
      id: 'poe2_explosivegrenade',
      en: 'Explosive Grenade',
      game: 'poe2',
      tags: ['Attack', 'Grenade', 'Fire'],
    });
    const mortarCannon = makeGemDef({
      id: 'poe2_mortarcannon',
      en: 'Mortar Cannon',
      game: 'poe2',
      tags: ['Meta', 'Totem', 'Grenade'],
      altIds: ['MetaMortarCannonPlayer', 'SupportMortarCannonPlayer'],
    });
    const whirlingAssault = makeGemDef({
      id: 'poe2_whirlingassault',
      en: 'Whirling Assault',
      game: 'poe2',
      tags: ['Attack', 'Melee'],
    });
    const hollowForm = makeGemDef({
      id: 'poe2_hollowform',
      en: 'Hollow Form',
      game: 'poe2',
      tags: ['Meta', 'Melee'],
      altIds: ['MetaHollowFormPlayer', 'SupportHollowFormPlayer'],
    });
    const lightningArrow = makeGemDef({
      id: 'poe2_lightningarrow',
      en: 'Lightning Arrow',
      game: 'poe2',
      tags: ['Attack', 'Projectile', 'Bow'],
    });
    const mirageDeadeye = makeGemDef({
      id: 'poe2_miragedeadeye',
      en: 'Mirage Deadeye',
      game: 'poe2',
      tags: ['Meta'],
      altIds: ['MetaMirageDeadeyePlayer', 'SupportMirageDeadeyePlayer'],
    });
    const mirageArcher = makeGemDef({
      id: 'poe2_miragearcher',
      en: 'Mirage Archer',
      game: 'poe2',
      tags: ['Meta'],
      altIds: ['MetaMirageArcherPlayer', 'SupportMirageArcherPlayer'],
    });
    const ancestralTotem = makeGemDef({
      id: 'poe2_ancestralwarriortotem',
      en: 'Ancestral Warrior Totem',
      game: 'poe2',
      tags: ['Meta', 'Totem'],
      altIds: ['AncestralWarriorTotemPlayer', 'SupportAncestralWarriorTotemPlayer'],
    });

    const lookup = new Map<string, GemDefinition>([
      [explosiveGrenade.id, explosiveGrenade],
      [mortarCannon.id, mortarCannon],
      [whirlingAssault.id, whirlingAssault],
      [hollowForm.id, hollowForm],
      [lightningArrow.id, lightningArrow],
      [mirageDeadeye.id, mirageDeadeye],
      [mirageArcher.id, mirageArcher],
      [ancestralTotem.id, ancestralTotem],
    ]);

    const mortarRes = resolvePoe2MetaGemGroup(
      makeGroup({ gems: [makeGemInst({ gemId: mortarCannon.id }), makeGemInst({ gemId: explosiveGrenade.id })] }),
      (id) => lookup.get(id),
    );
    expect(mortarRes.isMetaGroup).toBe(true);
    expect(mortarRes.estimatedTriggerRate).toBe(0);
    expect(mortarRes.addedSkillTypes).toEqual(expect.arrayContaining(['Totem', 'UsedByTotem', 'SupportedByMortarTotem']));
    expect(mortarRes.metaSupportMods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Speed', type: 'MORE', value: -50, flags: ModFlag.Attack }),
        expect.objectContaining({ name: 'Damage', type: 'MORE', value: -50 }),
        expect.objectContaining({ name: 'CooldownRecovery', type: 'INC', value: 100 }),
        expect.objectContaining({ name: 'ActiveTotemLimit', type: 'BASE', value: 1 }),
      ]),
    );

    const hollowRes = resolvePoe2MetaGemGroup(
      makeGroup({ gems: [makeGemInst({ gemId: hollowForm.id }), makeGemInst({ gemId: whirlingAssault.id })] }),
      (id) => lookup.get(id),
    );
    expect(hollowRes.isMetaGroup).toBe(true);
    expect(hollowRes.estimatedTriggerRate).toBe(0);
    expect(hollowRes.addedSkillTypes).toEqual(expect.arrayContaining(['UsedByClone', 'SupportedByHollowForm']));
    expect(hollowRes.metaSupportMods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Speed', type: 'MORE', value: -30, flags: ModFlag.Attack }),
        expect.objectContaining({ name: 'Damage', type: 'MORE', value: -15 }),
      ]),
    );

    const deadeyeRes = resolvePoe2MetaGemGroup(
      makeGroup({ gems: [makeGemInst({ gemId: mirageDeadeye.id }), makeGemInst({ gemId: lightningArrow.id })] }),
      (id) => lookup.get(id),
    );
    expect(deadeyeRes.metaSupportMods).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Damage', type: 'MORE', value: -50 })]),
    );
    expect(deadeyeRes.addedSkillTypes).toContain('SupportedByMirageDeadeye');

    const archerRes = resolvePoe2MetaGemGroup(
      makeGroup({ gems: [makeGemInst({ gemId: mirageArcher.id }), makeGemInst({ gemId: lightningArrow.id })] }),
      (id) => lookup.get(id),
    );
    expect(archerRes.metaSupportMods).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Damage', type: 'MORE', value: -30 })]),
    );

    const ancRes = resolvePoe2MetaGemGroup(
      makeGroup({ gems: [makeGemInst({ gemId: ancestralTotem.id }), makeGemInst({ gemId: whirlingAssault.id })] }),
      (id) => lookup.get(id),
    );
    expect(ancRes.metaSupportMods).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'ActiveTotemLimit', type: 'OVERRIDE', value: 10 })]),
    );
    expect(ancRes.addedSkillTypes).toContain('Totem');
  });

  it('does NOT fabricate 10 Withered stacks for PoE 2 Withering Presence when gem.count is omitted or default 1', () => {
    const wpDef = makeGemDef({ id: 'wp', en: 'Withering Presence', game: 'poe2', isAuraOrBuff: true });
    const defs = new Map<string, GemDefinition>([[wpDef.id, wpDef]]);

    const playerDb = new ModDB();
    const enemyDb = new ModDB();
    const res = evaluatePersistentBuffAndStanceSkills(
      [makeGroup({ id: 'g1', gems: [makeGemInst({ gemId: 'wp', level: 20, count: 1 })] })],
      1,
      'poe2',
      playerDb,
      enemyDb,
      (id) => defs.get(id),
    );
    expect(res.appliedSkills).toContain('Withering Presence');
    expect(res.witheredStacksApplied).toBe(0);
    expect(playerDb.getEvalContext().conditions.CanWither).toBe(true);
    expect(enemyDb.sum('INC', 'ChaosDamageTaken')).toBe(0);
  });

  it('resolves PoE 2 Walking Calamity & Apocalypse base activation to 0 DPS and Flameblast to 10-stage +750% MORE Spell Damage', () => {
    const wc = makeGemDef({
      id: 'poe2_walkingcalamity',
      en: 'Walking Calamity',
      game: 'poe2',
      tags: ['Attack', 'Area', 'Fire', 'Buff'],
    });
    const wcRes = resolveActiveSkillPartAndStats(wc, makeGemInst({ gemId: wc.id, level: 20 }), makeGroup(), 20, {
      game: 'poe2',
    });
    expect(wcRes.attackDamageMultiplierPct).toBe(0);
    expect(wcRes.sequenceDamageMultiplier).toBe(0);
    expect(wcRes.baseDamage).toEqual({});

    const apoc = makeGemDef({
      id: 'poe2_apocalypse',
      en: 'Apocalypse',
      game: 'poe2',
      tags: ['Spell', 'Area', 'Buff'],
      baseDamage: { Fire: [100, 200] },
    });
    const apocRes = resolveActiveSkillPartAndStats(
      apoc,
      makeGemInst({ gemId: apoc.id, level: 20 }),
      makeGroup(),
      20,
      { game: 'poe2' },
    );
    expect(apocRes.sequenceDamageMultiplier).toBe(0);
    expect(apocRes.baseDamage).toEqual({});

    const fb = makeGemDef({
      id: 'poe2_flameblast',
      en: 'Flameblast',
      game: 'poe2',
      tags: ['Spell', 'Area', 'Fire', 'Channelling'],
      baseDamage: { Fire: [244, 367] },
      compiledMods: [
        { name: 'Multiplier:FlameblastMaxStages', type: 'BASE', value: 10, flags: 0, keywordFlags: 0 },
        {
          name: 'Damage',
          type: 'MORE',
          value: 75,
          flags: ModFlag.Spell,
          keywordFlags: 0,
          tags: [{ type: 'Multiplier', var: 'FlameblastStage' }],
        },
      ],
    });
    const fbRes = resolveActiveSkillPartAndStats(fb, makeGemInst({ gemId: fb.id, level: 20 }), makeGroup(), 20, {
      game: 'poe2',
    });
    expect(fbRes.compiledMods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Damage', type: 'MORE', value: 750, flags: ModFlag.Spell }),
      ]),
    );
  });

  it('evaluates PoE 2 Charge Regulation persistent Spirit buff gated by active Frenzy/Power/Endurance charges', () => {
    const crDef = makeGemDef({
      id: 'poe2_chargeregulation',
      en: 'Charge Regulation',
      game: 'poe2',
      tags: ['Buff', 'Persistent'],
    });
    const playerDb = new ModDB();
    const enemyDb = new ModDB();
    const res = evaluatePersistentBuffAndStanceSkills(
      [makeGroup({ gems: [makeGemInst({ gemId: crDef.id, level: 20 })] })],
      1,
      'poe2',
      playerDb,
      enemyDb,
      (id) => (id === crDef.id ? crDef : undefined),
    );
    expect(res.appliedSkills).toContain('Charge Regulation');

    // Without charges active, all Charge Regulation bonuses evaluate to 0 / 1.0x
    expect(playerDb.sum('INC', 'Speed')).toBe(0);
    expect(playerDb.more('CritChance')).toBe(1);
    expect(playerDb.more('Armour')).toBe(1);

    // With Frenzy/Power/Endurance charges active (>= 1), Lv20 grants +25% Speed INC, 26% MORE CritChance, 20% MORE Defences
    playerDb.setMultiplier('FrenzyCharge', 3);
    playerDb.setMultiplier('PowerCharge', 2);
    playerDb.setMultiplier('EnduranceCharge', 1);
    expect(playerDb.sum('INC', 'Speed')).toBe(25);
    expect(playerDb.more('CritChance')).toBeCloseTo(1.26, 4);
    expect(playerDb.more('Armour')).toBeCloseTo(1.2, 4);
    expect(playerDb.more('Evasion')).toBeCloseTo(1.2, 4);
    expect(playerDb.more('EnergyShield')).toBeCloseTo(1.2, 4);
  });
});
