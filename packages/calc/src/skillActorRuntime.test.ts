import { describe, expect, it } from 'vitest';
import { KeywordFlag, ModFlag, type Mod } from '@webpob/core';
import { ModDB } from './modDb.js';
import {
  POB_MINION_DAMAGE_GROWTH_PER_LEVEL,
  POB_SERVER_TICK_SEC,
  applyEnemyDebuffsToEnemyDb,
  canSupportActiveSkill,
  computeAuthenticAilmentAndSkillDots,
  computeMinionGroupOffence,
  computeTriggeredSkillRate,
  createActorModBuses,
  doesTypeExpressionMatch,
  injectCompiledGemMods,
  resolveActiveMinionCount,
  resolveCompatibleSupports,
  routeModToActorBuses,
  splitModDBIntoActorBuses,
  type CompiledGemMod,
  type MinionBaseProfile,
  type SkillGemDef,
} from './skillActorRuntime.js';

function mkGem(partial: Partial<SkillGemDef> & Pick<SkillGemDef, 'id' | 'category'>): SkillGemDef {
  return {
    name: { en: partial.id, zh: partial.id },
    game: 'poe1',
    color: 'blue',
    tags: [],
    modFlags: 0,
    keywordFlags: 0,
    stats: [],
    ...partial,
  };
}

function mkMod(
  name: string,
  type: Mod['type'],
  value: Mod['value'],
  flags = 0,
  keywordFlags = 0,
  source = 'Test',
): Mod {
  return { name, type, value, flags, keywordFlags, source };
}

// ============================================================================
// 1. RPN SkillType Support Compatibility Engine
// ============================================================================

describe('skillActorRuntime — 1. RPN SkillType Matcher & Two-Pass Support Resolution', () => {
  it('evaluates RPN AND, OR, NOT, nested expressions, case-insensitivity, and implicit stack OR', () => {
    const spellHitTypes = new Set(['Spell', 'Damage', 'Hit', 'Area', 'Cold']);
    const attackProjTypes = new Set(['Attack', 'Damage', 'Hit', 'Projectile', 'Bow']);

    // Basic AND / OR / NOT
    expect(doesTypeExpressionMatch(['Spell', 'Damage', 'AND'], spellHitTypes)).toBe(true);
    expect(doesTypeExpressionMatch(['spell', 'attack', 'and'], spellHitTypes)).toBe(false);
    expect(doesTypeExpressionMatch(['Spell', 'Attack', 'OR'], spellHitTypes)).toBe(true);
    expect(doesTypeExpressionMatch(['Spell', 'Attack', 'OR'], attackProjTypes)).toBe(true);
    expect(doesTypeExpressionMatch(['Totem', 'NOT'], spellHitTypes)).toBe(true);
    expect(doesTypeExpressionMatch(['Spell', 'NOT'], spellHitTypes)).toBe(false);

    // Implicit OR across multiple remaining stack items (matches PoB CalcTools.lua)
    expect(doesTypeExpressionMatch(['Attack', 'Spell'], spellHitTypes)).toBe(true);
    expect(doesTypeExpressionMatch(['Bow', 'Totem'], spellHitTypes)).toBe(false);

    // Nested RPN: (Attack && Projectile) || (Spell && Area)
    const nested = ['Attack', 'Projectile', 'AND', 'Spell', 'Area', 'AND', 'OR'];
    expect(doesTypeExpressionMatch(nested, spellHitTypes)).toBe(true);
    expect(doesTypeExpressionMatch(nested, attackProjTypes)).toBe(true);
    expect(doesTypeExpressionMatch(nested, new Set(['Spell', 'Projectile']))).toBe(false);

    // Negated conjunction: Spell && !Totem && !Channelling
    const nonProxySpell = ['Spell', 'Totem', 'NOT', 'AND', 'Channelling', 'NOT', 'AND'];
    expect(doesTypeExpressionMatch(nonProxySpell, spellHitTypes)).toBe(true);
    expect(doesTypeExpressionMatch(nonProxySpell, new Set(['Spell', 'Totem']))).toBe(false);

    // Empty expression returns false
    expect(doesTypeExpressionMatch([], spellHitTypes)).toBe(false);

    // Matches minionSkillTypes as union when provided
    expect(
      doesTypeExpressionMatch(['Attack', 'Melee', 'AND'], new Set(['Spell', 'Minion']), new Set(['Attack', 'Melee'])),
    ).toBe(true);
  });

  it('enforces requireSkillTypes, excludeSkillTypes, supportGemsOnly, and graceful tag fallback in canSupportActiveSkill', () => {
    const arc = mkGem({
      id: 'arc',
      category: 'active',
      name: { en: 'Arc', zh: '电弧' },
      tags: ['Spell', 'Lightning', 'Chaining'],
      modFlags: ModFlag.Spell | ModFlag.Hit,
      keywordFlags: KeywordFlag.Spell | KeywordFlag.Lightning | KeywordFlag.Hit,
      skillTypes: ['Spell', 'Damage', 'Hit', 'Chaining', 'Totemable', 'Trappable', 'Mineable', 'Triggerable'],
    });

    const itemIcestorm = mkGem({
      id: 'icestorm',
      category: 'active',
      name: { en: 'Icestorm', zh: '冰风暴' },
      fromItem: true,
      tags: ['Spell', 'Cold', 'Area', 'Duration'],
      modFlags: ModFlag.Spell | ModFlag.Hit | ModFlag.Area,
      skillTypes: ['Spell', 'Damage', 'Hit', 'Area', 'Duration'],
    });

    const empower = mkGem({
      id: 'empower',
      category: 'support',
      name: { en: 'Empower Support', zh: '赋予（辅）' },
      supportGemsOnly: true,
      requireSkillTypes: [],
      excludeSkillTypes: [],
    });

    const fasterAttacks = mkGem({
      id: 'faster_attacks',
      category: 'support',
      name: { en: 'Faster Attacks Support', zh: '快速攻击（辅）' },
      requireSkillTypes: ['Attack'],
    });

    const spellEcho = mkGem({
      id: 'spell_echo',
      category: 'support',
      name: { en: 'Spell Echo Support', zh: '法术回响（辅）' },
      requireSkillTypes: ['Spell'],
      excludeSkillTypes: ['Totem', 'Trapped', 'RemoteMined', 'Triggered', 'Channelling'],
    });

    // Legacy support without requireSkillTypes / excludeSkillTypes (tag fallback)
    const legacyFasterCasting = mkGem({
      id: 'legacy_fc',
      category: 'support',
      name: { en: 'Faster Casting Support', zh: '快速施法（辅）' },
      tags: ['Support', 'Spell'],
      modFlags: ModFlag.Spell,
    });
    const legacyBowSupport = mkGem({
      id: 'legacy_bow',
      category: 'support',
      name: { en: 'Mirage Archer Support', zh: '幻影射手（辅）' },
      tags: ['Support', 'Bow', 'Attack'],
      modFlags: ModFlag.Attack | ModFlag.Bow,
    });

    expect(canSupportActiveSkill(empower, arc)).toBe(true);
    expect(canSupportActiveSkill(empower, itemIcestorm)).toBe(false);
    expect(canSupportActiveSkill(fasterAttacks, arc)).toBe(false);
    expect(canSupportActiveSkill(spellEcho, arc)).toBe(true);
    expect(canSupportActiveSkill(legacyFasterCasting, arc)).toBe(true);
    expect(canSupportActiveSkill(legacyBowSupport, arc)).toBe(false);
  });

  it('performs two-pass support resolution with Spell Totem addSkillTypes unlocking Multiple Totems & Less Duration while blocking Spell Echo', () => {
    const arc = mkGem({
      id: 'poe1_arc',
      category: 'active',
      name: { en: 'Arc', zh: '电弧' },
      skillTypes: ['Spell', 'Damage', 'Hit', 'Chaining', 'Totemable', 'Trappable', 'Mineable', 'Triggerable'],
    });

    const multipleTotems = mkGem({
      id: 'sup_multiple_totems',
      category: 'support',
      name: { en: 'Multiple Totems Support', zh: '多重图腾（辅）' },
      requireSkillTypes: ['Totem', 'SummonsTotem', 'OR'],
    });

    const spellEcho = mkGem({
      id: 'sup_spell_echo',
      category: 'support',
      name: { en: 'Spell Echo Support', zh: '法术回响（辅）' },
      requireSkillTypes: ['Spell'],
      excludeSkillTypes: ['Totem', 'Trapped', 'RemoteMined', 'Triggered', 'Channelling'],
    });

    const lessDuration = mkGem({
      id: 'sup_less_duration',
      category: 'support',
      name: { en: 'Less Duration Support', zh: '缩短持续时间（辅）' },
      requireSkillTypes: ['Duration'],
    });

    const swiftAffliction = mkGem({
      id: 'sup_swift_affliction',
      category: 'support',
      name: { en: 'Swift Affliction Support', zh: '极速腐化（辅）' },
      requireSkillTypes: ['Duration', 'DamageOverTime', 'AND'],
    });

    const spellTotem = mkGem({
      id: 'sup_spell_totem',
      category: 'support',
      name: { en: 'Spell Totem Support', zh: '法术图腾（辅）' },
      requireSkillTypes: ['Spell', 'Totemable', 'AND'],
      excludeSkillTypes: ['Totem', 'SummonsTotem', 'Trapped', 'RemoteMined'],
      addSkillTypes: ['Totem', 'SummonsTotem', 'Duration'],
    });

    const controlledDestruction = mkGem({
      id: 'sup_cd',
      category: 'support',
      name: { en: 'Controlled Destruction Support', zh: '精准破坏（辅）' },
      requireSkillTypes: ['Spell', 'Damage', 'AND'],
    });

    // Note: Multiple Totems placed BEFORE Spell Totem to prove Pass 1 precedes Pass 2!
    const res = resolveCompatibleSupports(arc, [
      multipleTotems,
      spellEcho,
      lessDuration,
      swiftAffliction,
      spellTotem,
      controlledDestruction,
    ]);

    const compatIds = res.compatible.map((g) => g.id);
    const rejectedIds = res.rejected.map((r) => r.entry.id);

    expect(compatIds).toContain('sup_spell_totem'); // Does not self-exclude!
    expect(compatIds).toContain('sup_multiple_totems'); // Unlocked by Pass 1 'Totem'
    expect(compatIds).toContain('sup_less_duration'); // Unlocked by Pass 1 'Duration'
    expect(compatIds).toContain('sup_cd');
    expect(rejectedIds).toContain('sup_spell_echo'); // Blocked by Pass 1 'Totem'
    expect(rejectedIds).toContain('sup_swift_affliction'); // Has Duration but lacks DamageOverTime
    expect(res.addedSkillTypes.has('totem')).toBe(true);
    expect(res.addedSkillTypes.has('duration')).toBe(true);

    // When Spell Totem is disabled, Spell Echo becomes valid and Multiple Totems is rejected
    const resDisabled = resolveCompatibleSupports(arc, [
      { gem: spellTotem, enabled: false },
      { gem: multipleTotems, enabled: true },
      { gem: spellEcho, enabled: true },
    ]);
    expect(resDisabled.compatible.map((e) => e.gem.id)).toEqual(['sup_spell_echo']);
    expect(resDisabled.rejected.map((r) => r.entry.gem.id)).toEqual(['sup_multiple_totems']);
  });
});

// ============================================================================
// 2. Three-Actor ModDB Router & CompiledGemMod Injector
// ============================================================================

describe('skillActorRuntime — 2. Three-Actor ModDB Router & CompiledGemMod Injector', () => {
  it('routes Minion* stats to minionDb (normalized) and Enemy*/debuffs to enemyDb while isolating playerDb', () => {
    const buses = createActorModBuses();

    expect(routeModToActorBuses(buses, mkMod('MinionDamage', 'INC', 120))).toBe('minion');
    expect(routeModToActorBuses(buses, mkMod('MinionDamage', 'MORE', 39))).toBe('minion');
    expect(routeModToActorBuses(buses, mkMod('MinionSpeed', 'INC', 45))).toBe('minion');
    expect(routeModToActorBuses(buses, mkMod('MinionCritChance', 'INC', 150))).toBe('minion');
    expect(routeModToActorBuses(buses, mkMod('MinionCritMultiplier', 'BASE', 60))).toBe('minion');
    expect(routeModToActorBuses(buses, mkMod('MinionLife', 'MORE', 20))).toBe('minion');
    expect(routeModToActorBuses(buses, mkMod('MinionElementalPenetration', 'BASE', 18))).toBe('minion');

    // Enemy debuffs & curses
    expect(routeModToActorBuses(buses, mkMod('EnemyFireResist', 'BASE', -36))).toBe('enemy');
    expect(routeModToActorBuses(buses, mkMod('EnemyChaosDamageTaken', 'INC', 90))).toBe('enemy');
    expect(routeModToActorBuses(buses, mkMod('Scorch', 'BASE', 20))).toBe('enemy');
    expect(routeModToActorBuses(buses, mkMod('Brittle', 'BASE', 6))).toBe('enemy');
    expect(routeModToActorBuses(buses, mkMod('Intimidated', 'FLAG', true))).toBe('enemy');
    expect(routeModToActorBuses(buses, mkMod('Unnerved', 'FLAG', true))).toBe('enemy');
    expect(routeModToActorBuses(buses, mkMod('Shock', 'BASE', 30))).toBe('enemy');

    // Player stats stay in playerDb
    expect(routeModToActorBuses(buses, mkMod('Life', 'BASE', 100))).toBe('player');
    expect(routeModToActorBuses(buses, mkMod('ActiveZombieLimit', 'BASE', 2))).toBe('player');

    // Normalized minionDb assertions
    expect(buses.minionDb.sum('INC', 'Damage')).toBe(120);
    expect(buses.minionDb.more('Damage')).toBeCloseTo(1.39, 6);
    expect(buses.minionDb.sum('INC', 'Speed')).toBe(45);
    expect(buses.minionDb.sum('INC', 'CritChance')).toBe(150);
    expect(buses.minionDb.sum('BASE', 'CritMultiplier')).toBe(60);
    expect(buses.minionDb.more('Life')).toBeCloseTo(1.2, 6);
    expect(buses.minionDb.sum('BASE', 'ElementalPenetration')).toBe(18);
    expect(buses.playerDb.sum('INC', 'Damage')).toBe(0);

    // Normalized enemyDb assertions
    expect(buses.enemyDb.sum('BASE', 'FireResist')).toBe(-56); // -36 Flammability + -20 Scorch
    expect(buses.enemyDb.sum('BASE', 'ColdResist')).toBe(-20); // -20 Scorch
    expect(buses.enemyDb.sum('BASE', 'SelfCritChance')).toBe(6); // +6% Brittle
    expect(buses.enemyDb.sum('INC', 'ChaosDamageTaken')).toBe(90); // 15 Wither
    expect(buses.enemyDb.sum('INC', 'DamageTaken', ModFlag.Attack)).toBe(40); // 30 Shock + 10 Intimidated
    expect(buses.enemyDb.sum('INC', 'DamageTaken', ModFlag.Spell)).toBe(40); // 30 Shock + 10 Unnerved
  });

  it('injects SkillStatMap-compiled cmods directly without regex parsing and splits legacy ModDB cleanly', () => {
    const buses = createActorModBuses();
    const compiledMods: CompiledGemMod[] = [
      { name: 'Damage', type: 'MORE', value: 49, target: 'minion' },
      { name: 'FireMin', type: 'BASE', value: 109, target: 'minion' },
      { name: 'FireMax', type: 'BASE', value: 155, target: 'minion' },
      { name: 'FireResist', type: 'BASE', value: -36, target: 'enemy' },
      { name: 'SpellDamage', type: 'INC', value: 20, target: 'player', flags: ModFlag.Spell },
    ];

    const counts = injectCompiledGemMods(
      buses.playerDb,
      buses.enemyDb,
      buses.minionDb,
      compiledMods,
      'Compiled Gem Test',
    );

    expect(counts).toEqual({ playerCount: 1, enemyCount: 1, minionCount: 3 });
    expect(buses.minionDb.more('Damage')).toBeCloseTo(1.49, 6);
    expect(buses.minionDb.sum('BASE', 'FireMin')).toBe(109);
    expect(buses.minionDb.sum('BASE', 'FireMax')).toBe(155);
    expect(buses.enemyDb.sum('BASE', 'FireResist')).toBe(-36);
    expect(buses.playerDb.sum('INC', 'SpellDamage', ModFlag.Spell)).toBe(20);

    // Split from legacy unified ModDB with Spiritual Aid active
    const unified = new ModDB();
    unified.addMod(mkMod('SpiritualAid', 'FLAG', true));
    unified.addMod(mkMod('MinionDamage', 'INC', 80));
    unified.addMod(mkMod('EnemyColdResist', 'BASE', -30));
    const split = splitModDBIntoActorBuses(unified);
    expect(split.minionDb.sum('INC', 'Damage')).toBe(80);
    expect(split.playerDb.sum('INC', 'Damage')).toBe(80); // Spiritual Aid mirrored!
    expect(split.enemyDb.sum('BASE', 'ColdResist')).toBe(-30);
  });
});

// ============================================================================
// 3. Full PoE 1 & PoE 2 Minion Offence Calculator
// ============================================================================

describe('skillActorRuntime — 3. Full PoE 1 & PoE 2 Minion Offence Calculator', () => {
  it('computes Lv.25 Summon Raging Spirit x20 with level growth, Phys->Fire conversion, curses, and count scaling', () => {
    const buses = createActorModBuses();

    // Inject minion scaling & anger aura flat fire + flammability curse
    injectCompiledGemMods(
      buses.playerDb,
      buses.enemyDb,
      buses.minionDb,
      [
        { name: 'Damage', type: 'INC', value: 250, target: 'minion' },
        { name: 'Damage', type: 'MORE', value: 49, target: 'minion' }, // Awakened Minion Damage
        { name: 'Speed', type: 'INC', value: 60, target: 'minion' }, // Flesh Offering + Haste
        { name: 'FireMin', type: 'BASE', value: 110, target: 'minion' }, // Anger aura
        { name: 'FireMax', type: 'BASE', value: 155, target: 'minion' },
        { name: 'FirePenetration', type: 'BASE', value: 15, target: 'minion' },
        { name: 'CannotIgnite', type: 'FLAG', value: true, target: 'minion' },
        { name: 'FireResist', type: 'BASE', value: -36, target: 'enemy' }, // Flammability
      ],
      'SRS Build',
    );
    applyEnemyDebuffsToEnemyDb(buses.enemyDb, {
      game: 'poe1',
      enemyFireExposure: true, // -10% Fire Res
      enemyShocked: true,
      shockValue: 20, // +20% Damage Taken
    });

    const srsProfile: MinionBaseProfile = {
      physicalMin: 158,
      physicalMax: 237,
      attacksPerSecond: 1 / 0.57,
      moreAttackSpeedPct: 40,
      critChance: 5,
      critMultiplier: 130,
      baseLimit: 20,
      limitStat: 'ActiveRagingSpiritLimit',
      conversions: { PhysicalToFire: 100 },
    };

    const result = computeMinionGroupOffence({
      game: 'poe1',
      minionBase: srsProfile,
      minionDb: buses.minionDb,
      enemyDb: buses.enemyDb,
      playerDb: buses.playerDb,
      effLevel: 25,
      gemInst: { level: 25, count: 20 },
      enemyConfig: { enemyFireResist: 50 }, // Pinnacle Boss 50% Fire Res
    });

    // Level 25 scaling = 1.095^5 ≈ 1.5742387
    const expectedScale = Math.pow(POB_MINION_DAMAGE_GROWTH_PER_LEVEL, 5);
    expect(result.levelDamageScale).toBeCloseTo(expectedScale, 6);
    expect(result.activeCount).toBe(20);

    // 100% Phys converted to Fire -> Physical hit = 0, Fire hit > 0
    expect(result.perMinion.damageByType.Physical.average).toBe(0);
    expect(result.perMinion.damageByType.Fire.average).toBeGreaterThan(0);

    // Verify exact hand-calculated per-minion Fire hit:
    // Base converted phys avg = ((158+237)/2) * 1.095^5 = 197.5 * 1.5742387 = 310.9121
    // Added flat Fire avg = (110+155)/2 = 132.5 -> total Fire base avg = 443.4121
    // Mult = (1 + 2.50) * 1.49 = 5.215 -> rawAvg = 2312.394
    // Enemy Fire Res = 50 - 36 (Flamm) - 10 (Exp) = 4%; after 15% pen = -11% -> factor = 1.11
    // Enemy Shock = 1.20 -> finalMult = 1.11 * 1.20 = 1.332
    // Fire avg = 2312.394 * 1.332 = 3080.109
    // Crit effect = 1 + 0.05 * 0.30 = 1.015 -> avgHit = 3126.31
    // Speed = (1/0.57) * 1.40 * 1.60 = 3.92982 -> perMinionHitDps ≈ 12,285.85
    // Total x20 ≈ 245,717
    const baseFireAvg = 197.5 * expectedScale + 132.5;
    const expectedRawFire = baseFireAvg * 3.5 * 1.49;
    const expectedMitFire = expectedRawFire * 1.11 * 1.2;
    const expectedAvgHit = expectedMitFire * 1.015;
    const expectedSpeed = (1 / 0.57) * 1.4 * 1.6;
    const expectedPerMinionDps = expectedAvgHit * expectedSpeed;

    expect(result.perMinion.hitDps).toBeCloseTo(expectedPerMinionDps, 0);
    expect(result.total.hitDps).toBeCloseTo(expectedPerMinionDps * 20, -1);
    expect(result.total.totalDps).toBeCloseTo(result.total.hitDps, 1);
  });

  it('computes PoE 2 Skeletal Arsonist x8 using Spirit-reserved count, elemental base damage, and PoE 2 crit/mitigation', () => {
    const buses = createActorModBuses();
    injectCompiledGemMods(
      buses.playerDb,
      buses.enemyDb,
      buses.minionDb,
      [
        { name: 'Damage', type: 'INC', value: 180, target: 'minion' },
        { name: 'Damage', type: 'MORE', value: 35, target: 'minion' },
        { name: 'Speed', type: 'INC', value: 30, target: 'minion' },
        { name: 'FireResist', type: 'BASE', value: -30, target: 'enemy' }, // Flammability
      ],
      'Arsonist Build',
      { game: 'poe2' },
    );

    const arsonistProfile: MinionBaseProfile = {
      physicalMin: 0,
      physicalMax: 0,
      elementalDamage: { Fire: [420, 630] },
      attacksPerSecond: 1.15,
      modFlags: ModFlag.Attack | ModFlag.Projectile | ModFlag.Area | ModFlag.Hit,
      keywordFlags: KeywordFlag.Minion | KeywordFlag.Fire | KeywordFlag.Hit,
      critChance: 5,
      critMultiplier: 130,
      spiritPerMinion: 39,
    };

    // 312 Spirit reserved / 39 Spirit per Arsonist = 8 active Arsonists
    const res = computeMinionGroupOffence({
      game: 'poe2',
      minionBase: arsonistProfile,
      minionDb: buses.minionDb,
      enemyDb: buses.enemyDb,
      playerDb: buses.playerDb,
      effLevel: 24,
      spiritReserved: 312,
      enemyConfig: { enemyFireResist: 50 },
    });

    expect(res.activeCount).toBe(8);
    expect(res.perMinion.damageByType.Fire.average).toBeGreaterThan(0);
    expect(res.total.hitDps).toBeCloseTo(res.perMinion.hitDps * 8, 0);

    // Also verify limitStat resolution for PoE 1 Raise Zombie (3 base + 4 playerDb = 7)
    const playerDb = new ModDB();
    playerDb.addMod(mkMod('ActiveZombieLimit', 'BASE', 4));
    expect(
      resolveActiveMinionCount({
        game: 'poe1',
        minionBase: {
          physicalMin: 260,
          physicalMax: 390,
          attacksPerSecond: 1.18,
          critChance: 5,
          critMultiplier: 130,
          baseLimit: 3,
          limitStat: 'ActiveZombieLimit',
        },
        playerDb,
        minionDb: new ModDB(),
      }),
    ).toBe(7);
  });

  it('computes Poison SRS group DPS with infinite PoE 1 poison stacks multiplied across all 20 minions', () => {
    const buses = createActorModBuses();
    injectCompiledGemMods(
      buses.playerDb,
      buses.enemyDb,
      buses.minionDb,
      [
        { name: 'ChaosMin', type: 'BASE', value: 200, target: 'minion' },
        { name: 'ChaosMax', type: 'BASE', value: 300, target: 'minion' },
        { name: 'PoisonChance', type: 'BASE', value: 100, target: 'minion' },
        { name: 'Damage', type: 'INC', value: 100, target: 'minion' },
        { name: 'CannotIgnite', type: 'FLAG', value: true, target: 'minion' },
      ],
      'Poison SRS',
    );
    applyEnemyDebuffsToEnemyDb(buses.enemyDb, { game: 'poe1', witheredStacks: 15 }); // +90% Chaos Damage Taken

    const res = computeMinionGroupOffence({
      game: 'poe1',
      minionBase: {
        physicalMin: 158,
        physicalMax: 237,
        attacksPerSecond: 2.0,
        critChance: 0,
        critMultiplier: 130,
        baseLimit: 20,
        conversions: { PhysicalToFire: 100 },
      },
      minionDb: buses.minionDb,
      enemyDb: buses.enemyDb,
      effLevel: 20,
      gemInst: { count: 20 },
      enemyConfig: { enemyChaosResist: 30 },
    });

    // Base Chaos avg = 250 -> 0.30 * 250 * 2.0 (100% inc) * 0.70 (30% res) * 1.90 (15 Wither) = 199.5 single stack
    // 1 minion @ 2 APS * 2s = 4 stacks -> 798 DPS; 20 minions -> 80 stacks -> 15,960 Poison DPS!
    expect(res.ailments.poison.singleStackDps).toBeCloseTo(199.5, 1);
    expect(res.ailments.poison.effectiveStacks).toBeCloseTo(4, 2);
    expect(res.perMinion.poisonDps).toBeCloseTo(798, 1);
    expect(res.total.poisonDps).toBeCloseTo(15960, 0);
  });
});

// ============================================================================
// 4. PoB-Authentic Poison Stacks, Crimson Dance / Aggravated Bleed, Spell DoT & CoC Trigger Rate
// ============================================================================

describe('skillActorRuntime — 4. Authentic Ailments, Spell DoTs & Trigger Rate Quantizer', () => {
  it('computes infinite-stack PoE 1 Poison (10 APS * 4s * 100% = 40 stacks) vs Viper Strike of the Mamba single-stack high-multiplier poison', () => {
    // Case A: Standard multi-stack PoE 1 Poison (e.g. Poisonous Concoction / Pestilent Strike)
    const skillDb = new ModDB();
    const enemyDb = new ModDB();
    skillDb.addMod(mkMod('PoisonChance', 'BASE', 100));
    skillDb.addMod(mkMod('ChaosDamage', 'INC', 200)); // 3.0x
    skillDb.addMod(mkMod('PoisonDamage', 'MORE', 50)); // 1.5x
    skillDb.addMod(mkMod('ChaosDotMultiplier', 'BASE', 60)); // 1.6x
    skillDb.addMod(mkMod('PoisonDuration', 'INC', 100)); // 2s -> 4s
    applyEnemyDebuffsToEnemyDb(enemyDb, { game: 'poe1', witheredStacks: 15 }); // +90% Chaos Taken

    const multiStack = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb,
      enemyDb,
      baseDamageByType: { Physical: 100, Chaos: 400 },
      flags: ModFlag.Attack | ModFlag.Hit,
      speed: 10,
      hitChancePct: 100,
      enemyConfig: { enemyChaosResist: 30 }, // 0.70x
    });

    // Single stack = 0.30 * (100 + 400) * 3.0 * 1.5 * 1.6 * 0.70 * 1.90 = 150 * 7.2 * 1.33 = 1436.4
    expect(multiStack.poison.effectiveDurationSec).toBeCloseTo(4.0, 4);
    expect(multiStack.poison.effectiveStacks).toBeCloseTo(40, 4);
    expect(multiStack.poison.maxStacks).toBe(Number.POSITIVE_INFINITY);
    expect(multiStack.poison.singleStackDps).toBeCloseTo(1436.4, 1);
    expect(multiStack.poison.totalDps).toBeCloseTo(1436.4 * 40, 0);

    // Case B: Viper Strike of the Mamba (CannotPoisonAlreadyPoisoned -> 1 massive stack + Low Tolerance + huge MORE + faster)
    const mambaDb = new ModDB();
    mambaDb.addMod(mkMod('PoisonChance', 'BASE', 100));
    mambaDb.addMod(mkMod('CannotPoisonAlreadyPoisoned', 'FLAG', true));
    mambaDb.addMod(mkMod('PoisonDamage', 'INC', 900)); // 3x Low Tolerance (300% each) -> 10.0x
    mambaDb.addMod(mkMod('PoisonDamage', 'MORE', 300)); // Mamba dual-wield / gem huge MORE -> 4.0x
    mambaDb.addMod(mkMod('ChaosDotMultiplier', 'BASE', 80)); // 1.8x
    mambaDb.addMod(mkMod('PoisonFaster', 'INC', 50)); // 1.5x pure DPS gain on single-stack poison!

    const mamba = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: mambaDb,
      enemyDb,
      baseDamageByType: { Physical: 200, Chaos: 800 },
      flags: ModFlag.Attack | ModFlag.Melee | ModFlag.Hit,
      speed: 6,
      hitChancePct: 100,
      skillData: { poisonDuration: 4.0 },
      enemyConfig: { enemyChaosResist: 30 },
    });

    // Single stack = 0.30 * 1000 * 10.0 * 4.0 * 1.8 * 1.5 * (0.70 * 1.90) = 32,400 * 1.33 = 43,092
    expect(mamba.poison.isSinglePoisonCap).toBe(true);
    expect(mamba.poison.maxStacks).toBe(1);
    expect(mamba.poison.effectiveStacks).toBe(1); // Strictly capped at 1 despite 6 APS * 2.67s = 16!
    expect(mamba.poison.fasterMult).toBeCloseTo(1.5, 4);
    expect(mamba.poison.effectiveDurationSec).toBeCloseTo(4.0 / 1.5, 2);
    expect(mamba.poison.singleStackDps).toBeCloseTo(43092, 0);
    expect(mamba.poison.totalDps).toBeCloseTo(43092, 0);
  });

  it('computes PoE 2 Poison magnitude formula and Pathfinder multi-stack cap (default 1, +AdditionalPoisonStack, 2x Pathfinder)', () => {
    const enemyDb = new ModDB();
    applyEnemyDebuffsToEnemyDb(enemyDb, { game: 'poe2', witheredStacks: 10 }); // PoE 2 Wither: 10 * 5% = +50% Chaos Taken

    // Default PoE 2 (cap = 1)
    const baseDb = new ModDB();
    baseDb.addMod(mkMod('PoisonChance', 'BASE', 100));
    baseDb.addMod(mkMod('PoisonMagnitude', 'INC', 100)); // 2.0x
    baseDb.addMod(mkMod('PoisonMagnitude', 'MORE', 25)); // 1.25x

    const poe2Default = computeAuthenticAilmentAndSkillDots({
      game: 'poe2',
      skillDb: baseDb,
      enemyDb,
      baseDamageByType: {},
      preMitigationHitByType: { Physical: 1000, Chaos: 500 },
      flags: ModFlag.Attack | ModFlag.Hit,
      speed: 4,
      enemyConfig: { enemyChaosResist: 0 },
    });

    // 0.20 * 1500 * 2.0 * 1.25 * 1.50 (Wither) = 1125 single stack, capped to 1 stack
    expect(poe2Default.poison.maxStacks).toBe(1);
    expect(poe2Default.poison.effectiveStacks).toBe(1);
    expect(poe2Default.poison.singleStackDps).toBeCloseTo(1125, 1);
    expect(poe2Default.poison.totalDps).toBeCloseTo(1125, 1);

    // PoE 2 Pathfinder: +2 AdditionalPoisonStack (Comorbidity + Tree) AND DoublePoisonStacks (2x -> (1+2)*2 = 6 stacks!)
    const pfDb = baseDb.clone();
    pfDb.addMod(mkMod('AdditionalPoisonStack', 'BASE', 2));
    pfDb.addMod(mkMod('DoublePoisonStacks', 'FLAG', true));

    const poe2Pathfinder = computeAuthenticAilmentAndSkillDots({
      game: 'poe2',
      skillDb: pfDb,
      enemyDb,
      baseDamageByType: {},
      preMitigationHitByType: { Physical: 1000, Chaos: 500 },
      flags: ModFlag.Attack | ModFlag.Hit,
      speed: 4, // 4 APS * 2s = 8 uncapped -> capped at 6!
      enemyConfig: { enemyChaosResist: 0 },
    });

    expect(poe2Pathfinder.poison.maxStacks).toBe(6);
    expect(poe2Pathfinder.poison.effectiveStacks).toBe(6);
    expect(poe2Pathfinder.poison.totalDps).toBeCloseTo(1125 * 6, 0);
  });

  it('computes PoE 1 Bleed (70% stationary, 210% Moving/Aggravated, Crimson Dance 35% * min(8, stacks)) and skillData Spell DoTs', () => {
    const bleedDb = new ModDB();
    const enemyDb = new ModDB();
    bleedDb.addMod(mkMod('BleedChance', 'BASE', 100));
    bleedDb.addMod(mkMod('PhysicalDamage', 'INC', 100)); // 2.0x
    bleedDb.addMod(mkMod('PhysicalDotMultiplier', 'BASE', 50)); // 1.5x

    // Stationary: 0.70 * 1000 * 2.0 * 1.5 = 2100
    const stationary = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: bleedDb,
      enemyDb,
      baseDamageByType: { Physical: 1000 },
      flags: ModFlag.Attack | ModFlag.Melee | ModFlag.Hit,
      speed: 2,
    });
    expect(stationary.bleed.isAggravatedOrMoving).toBe(false);
    expect(stationary.bleed.isCrimsonDance).toBe(false);
    expect(stationary.bleed.totalDps).toBeCloseTo(2100, 1);

    // Aggravated / Moving: 2.10 * 1000 * 2.0 * 1.5 = 6300 (exact 3x stationary!)
    const aggravated = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: bleedDb,
      enemyDb,
      baseDamageByType: { Physical: 1000 },
      flags: ModFlag.Attack | ModFlag.Melee | ModFlag.Hit,
      speed: 2,
      enemyMovingOrAggravated: true,
    });
    expect(aggravated.bleed.isAggravatedOrMoving).toBe(true);
    expect(aggravated.bleed.totalDps).toBeCloseTo(6300, 1);

    // Crimson Dance: 0.35 * 1000 * 2.0 * 1.5 = 1050/stack; @ 2 APS * 5s = 10 -> capped at 8 stacks = 8400 (ignores Moving!)
    const cdDb = bleedDb.clone();
    cdDb.addMod(mkMod('CrimsonDance', 'FLAG', true));
    const cdFull = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: cdDb,
      enemyDb,
      baseDamageByType: { Physical: 1000 },
      flags: ModFlag.Attack | ModFlag.Melee | ModFlag.Hit,
      speed: 2,
      enemyMovingOrAggravated: true,
    });
    expect(cdFull.bleed.isCrimsonDance).toBe(true);
    expect(cdFull.bleed.isAggravatedOrMoving).toBe(false);
    expect(cdFull.bleed.effectiveStacks).toBe(8);
    expect(cdFull.bleed.singleStackDps).toBeCloseTo(1050, 1);
    expect(cdFull.bleed.totalDps).toBeCloseTo(8400, 1);

    // Crimson Dance below cap: 50% bleed chance * 2 APS * 5s = 5 stacks -> 5250
    const cdPartialDb = new ModDB();
    cdPartialDb.addMod(mkMod('BleedChance', 'BASE', 50));
    cdPartialDb.addMod(mkMod('PhysicalDamage', 'INC', 100));
    cdPartialDb.addMod(mkMod('PhysicalDotMultiplier', 'BASE', 50));
    cdPartialDb.addMod(mkMod('CrimsonDance', 'FLAG', true));
    const cdPartial = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: cdPartialDb,
      enemyDb,
      baseDamageByType: { Physical: 1000 },
      flags: ModFlag.Attack | ModFlag.Melee | ModFlag.Hit,
      speed: 2,
    });
    expect(cdPartial.bleed.effectiveStacks).toBeCloseTo(5, 4);
    expect(cdPartial.bleed.totalDps).toBeCloseTo(5250, 1);

    // skillData Spell / Ground DoT (e.g. Toxic Rain overlapping pods)
    const trDb = new ModDB();
    trDb.addMod(mkMod('ChaosDamage', 'INC', 200)); // 3.0x
    trDb.addMod(mkMod('Damage', 'INC', 50, ModFlag.Area)); // +50% -> 3.5x
    trDb.addMod(mkMod('ChaosDotMultiplier', 'BASE', 100)); // 2.0x
    trDb.addMod(mkMod('Duration', 'INC', 50)); // 1.0s -> 1.5s
    const trRes = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: trDb,
      enemyDb,
      baseDamageByType: {},
      speed: 4, // 4 APS * 4 pods * 1.5s = 24 overlapping pods!
      skillData: {
        ChaosDot: 300,
        dotIsArea: true,
        dotCanStack: true,
        dotBaseDuration: 1.0,
        dotHitsPerUse: 4,
      },
      enemyConfig: { enemyChaosResist: 0 },
    });
    // 300 * 3.5 * 2.0 * 24 = 50,400 Chaos DoT DPS
    expect(trRes.skillDot.effectiveStacks).toBeCloseTo(24, 4);
    expect(trRes.skillDot.byType.Chaos).toBeCloseTo(50400, 0);
    expect(trRes.skillDot.totalDps).toBeCloseTo(50400, 0);
  });

  it('quantizes CoC 0.15s cooldown to exact PoB 0.033s server-tick breakpoints (0%, 14%, 52%, 128% ICDR)', () => {
    expect(POB_SERVER_TICK_SEC).toBe(0.033);

    // 0% ICDR -> 5 ticks (0.165s, 6.06/s), next breakpoint = 14%
    const bp0 = computeTriggeredSkillRate({ cooldown: 0.15, icdrPct: 0, attackCritRate: 12 });
    expect(bp0.serverTicks).toBe(5);
    expect(bp0.effectiveCooldown).toBeCloseTo(0.165, 6);
    expect(bp0.triggerCap).toBeCloseTo(1 / 0.165, 4);
    expect(bp0.effectiveTriggerRate).toBeCloseTo(6.0606, 3);
    expect(bp0.nextIcdrBreakpointPct).toBe(14);

    // 13% ICDR -> still 5 ticks (0.165s)
    const bp13 = computeTriggeredSkillRate({ cooldown: 0.15, icdrPct: 13, attackCritRate: 12 });
    expect(bp13.serverTicks).toBe(5);
    expect(bp13.effectiveCooldown).toBeCloseTo(0.165, 6);

    // 14% ICDR -> Breakpoint 1: 4 ticks (0.132s, 7.5758/s), next breakpoint = 52%
    const bp14 = computeTriggeredSkillRate({ cooldown: 0.15, icdrPct: 14, attackCritRate: 12 });
    expect(bp14.serverTicks).toBe(4);
    expect(bp14.effectiveCooldown).toBeCloseTo(0.132, 6);
    expect(bp14.triggerCap).toBeCloseTo(1 / 0.132, 4);
    expect(bp14.effectiveTriggerRate).toBeCloseTo(7.5758, 3);
    expect(bp14.nextIcdrBreakpointPct).toBe(52);

    // 51% ICDR -> still 4 ticks (0.132s)
    const bp51 = computeTriggeredSkillRate({ cooldown: 0.15, icdrPct: 51, attackCritRate: 12 });
    expect(bp51.serverTicks).toBe(4);

    // 52% ICDR -> Breakpoint 2: 3 ticks (0.099s, 10.101/s), next breakpoint = 128%
    const bp52 = computeTriggeredSkillRate({ cooldown: 0.15, icdrPct: 52, attackCritRate: 12 });
    expect(bp52.serverTicks).toBe(3);
    expect(bp52.effectiveCooldown).toBeCloseTo(0.099, 6);
    expect(bp52.triggerCap).toBeCloseTo(1 / 0.099, 4);
    expect(bp52.effectiveTriggerRate).toBeCloseTo(10.101, 3);
    expect(bp52.nextIcdrBreakpointPct).toBe(128);

    // 128% ICDR -> Breakpoint 3: 2 ticks (0.066s, 15.1515/s)
    const bp128 = computeTriggeredSkillRate({ cooldown: 0.15, icdrPct: 128, attackCritRate: 20 });
    expect(bp128.serverTicks).toBe(2);
    expect(bp128.effectiveCooldown).toBeCloseTo(0.066, 6);
    expect(bp128.effectiveTriggerRate).toBeCloseTo(15.1515, 3);

    // Attack crit rate bottleneck below cap (e.g. 52% ICDR cap 10.10/s, attack crit rate 8.5/s)
    const critCapped = computeTriggeredSkillRate({
      cooldown: 0.15,
      icdrPct: 52,
      attackAps: 10,
      attackHitChancePct: 100,
      attackCritChancePct: 85,
    });
    expect(critCapped.attackCritRate).toBeCloseTo(8.5, 4);
    expect(critCapped.effectiveTriggerRate).toBeCloseTo(8.5, 4);

    // Two linked spells share CoC cooldown round-robin (each gets half rate)
    const dualSpell = computeTriggeredSkillRate({
      cooldown: 0.15,
      icdrPct: 52,
      attackCritRate: 12,
      linkedTriggeredSkills: 2,
    });
    expect(dualSpell.effectiveTriggerRate).toBeCloseTo(10.101 / 2, 3);
  });
});

// ============================================================================
// 5. PoB 1 & PoB 2 Ailment, Skill DoT, Actor Routing & Minion Parity Fixes
// ============================================================================

describe('skillActorRuntime — 5. PoB 1 & PoB 2 Ailment, Skill DoT, Routing & Minion Parity', () => {
  it('keeps player-scoped Enemy* stats on playerDb and honors mod.target in splitModDBIntoActorBuses', () => {
    const unified = new ModDB();
    unified.addMod(mkMod('EnemyIgniteDuration', 'INC', 50));
    unified.addMod(mkMod('EnemyAilmentDuration', 'INC', 54));
    unified.addMod(mkMod('EnemyShockEffect', 'INC', 40));
    unified.addMod(mkMod('EnemyCurseLimit', 'BASE', 1));
    unified.addMod({ ...mkMod('EnemyDamageTakenPerAilmentType', 'INC', 10), target: 'player' } as Mod);
    unified.addMod({ ...mkMod('DamageTakenConsecratedGround', 'INC', 15), target: 'enemy' } as Mod);
    unified.addMod(mkMod('EnemyFireResist', 'BASE', -36));

    const split = splitModDBIntoActorBuses(unified);
    expect(split.playerDb.sum('INC', 'EnemyIgniteDuration')).toBe(50);
    expect(split.playerDb.sum('INC', 'EnemyAilmentDuration')).toBe(54);
    expect(split.playerDb.sum('INC', 'EnemyShockEffect')).toBe(40);
    expect(split.playerDb.sum('BASE', 'EnemyCurseLimit')).toBe(1);
    expect(split.playerDb.sum('INC', 'EnemyDamageTakenPerAilmentType')).toBe(10);
    expect(split.enemyDb.sum('INC', 'DamageTakenConsecratedGround')).toBe(15);
    expect(split.enemyDb.sum('BASE', 'FireResist')).toBe(-36);
    expect(split.enemyDb.sum('INC', 'IgniteDuration')).toBe(0);
    expect(split.enemyDb.sum('INC', 'AilmentDuration')).toBe(0);
  });

  it('expands multi-bit compiled gem keywordFlags (Deadly Ailments, Melee Physical Damage, Trap & Mine) and blocks melee/area hit double-dipping', () => {
    const buses = createActorModBuses();
    injectCompiledGemMods(
      buses.playerDb,
      buses.enemyDb,
      buses.minionDb,
      [
        // Deadly Ailments (k = Ignite | Bleed | Poison = 917504)
        { name: 'Damage', type: 'MORE', value: 44, keywordFlags: KeywordFlag.Ignite | KeywordFlag.Bleed | KeywordFlag.Poison },
        // Melee Physical Damage: hit mod (f=Melee) + MeleeHit ailment mod (f=Melee|Hit, k=Bleed|Poison)
        { name: 'PhysicalDamage', type: 'MORE', value: 49, flags: ModFlag.Melee },
        {
          name: 'Damage',
          type: 'MORE',
          value: 49,
          flags: ModFlag.Melee | ModFlag.Hit,
          keywordFlags: KeywordFlag.Bleed | KeywordFlag.Poison,
        },
        // Concentrated Effect (f=Area) — must NOT double-dip into Bleed!
        { name: 'Damage', type: 'MORE', value: 39, flags: ModFlag.Area },
        // Trap and Mine Damage (k = Trap | Mine = 6144)
        { name: 'Damage', type: 'MORE', value: 49, keywordFlags: KeywordFlag.Trap | KeywordFlag.Mine },
      ],
      'Supports',
    );
    // Player mods routed via routeModToActorBuses:
    // - "with Hits and Ailments" (Hit|Ailment) applies to BOTH
    // - "+25% PhysicalDotMultiplier with Attack Skills" (Attack) applies to Attack bleed
    // - "30% inc PhysicalDamage with Axes" (Attack|Axe) applies to Axe bleed
    // - "100% inc Attack Damage" (bare Damage with Attack) must NOT double-dip into bleed!
    routeModToActorBuses(buses, mkMod('Damage', 'INC', 50, ModFlag.Hit | ModFlag.Ailment));
    routeModToActorBuses(buses, mkMod('PhysicalDotMultiplier', 'BASE', 25, ModFlag.Attack));
    routeModToActorBuses(buses, mkMod('PhysicalDamage', 'INC', 30, ModFlag.Attack | ModFlag.Axe));
    routeModToActorBuses(buses, mkMod('Damage', 'INC', 100, ModFlag.Attack));
    buses.playerDb.addMod(mkMod('BleedChance', 'BASE', 100));

    // Verify Trap and Mine Damage matches both Trap-only and Mine-only queries
    expect(buses.playerDb.more('Damage', ModFlag.Spell | ModFlag.Hit, KeywordFlag.Trap)).toBeCloseTo(1.49, 4);
    expect(buses.playerDb.more('Damage', ModFlag.Spell | ModFlag.Hit, KeywordFlag.Mine)).toBeCloseTo(1.49, 4);
    // Verify "with Hits and Ailments" applies to Axe Hit
    expect(buses.playerDb.sum('INC', 'Damage', ModFlag.Attack | ModFlag.Hit | ModFlag.Axe, KeywordFlag.Attack)).toBe(150);

    const bleedRes = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: buses.playerDb,
      enemyDb: buses.enemyDb,
      baseDamageByType: { Physical: 1000 },
      flags: ModFlag.Attack | ModFlag.Melee | ModFlag.Area | ModFlag.Axe | ModFlag.Hit,
      keywordFlags: KeywordFlag.Attack | KeywordFlag.Hit,
      speed: 2,
    });

    // Expected Bleed:
    // base=1000, INC = 50% (Hits & Ailments) + 30% (Axe) = +80% (1.8x) — Attack 100% NOT included!
    // MORE = 1.44 (Deadly Ailments) * 1.49 (MeleePhys ailment cmod) = 2.15 (rounded per-bucket by ModDB: round(1.44*1.49*100)/100 = 2.15)
    // Conc Effect 1.39 & MeleePhys hit 1.49 NOT included!
    // DotMulti = 1.25 (+25% with Attack Skills)
    // 0.70 * 1000 * 1.80 * 2.15 * 1.25 = 3386.25
    expect(bleedRes.bleed.totalDps).toBeCloseTo(3386.25, 1);
  });

  it('applies PoE 1 IgniteBurnFaster, Temporal Chains BuffExpireFaster, Eye of Malice resist INC, DamageTakenOverTime, EO, and Blackflame Burning Ground', () => {
    const skillDb = new ModDB();
    const enemyDb = new ModDB();
    skillDb.addMod(mkMod('EnemyIgniteChance', 'BASE', 50));
    skillDb.addMod(mkMod('IgniteBurnFaster', 'INC', 50)); // 1.5x faster
    skillDb.addMod(mkMod('EnemyIgniteDuration', 'INC', 20)); // 1.2x duration
    skillDb.addMod(mkMod('AilmentsAreNeverFromCrit', 'FLAG', true)); // Elemental Overload
    skillDb.addMod(mkMod('AllDamageCanIgnite', 'FLAG', true));
    skillDb.addMod(mkMod('IgniteToChaos', 'FLAG', true)); // Blackflame
    skillDb.addMod(mkMod('IgniteDpsAsBurningGround', 'MAX', 30));

    // Temporal Chains (-25% MORE BuffExpireFaster -> 1 / 0.75 = 1.3333x duration!)
    enemyDb.addMod(mkMod('BuffExpireFaster', 'MORE', -25));
    // Elemental Weakness (-30% ElementalResist) + Eye of Malice (+50% FireResist INC)
    // Enemy base Fire res = 0 -> -30 * 1.5 = -45% (1.45x) for Burning Ground
    enemyDb.addMod(mkMod('ElementalResist', 'BASE', -30));
    enemyDb.addMod(mkMod('FireResist', 'INC', 50));
    // Chaos res = 0, +20% DamageTakenOverTime + 10% ChaosDamageTakenOverTime -> 1.30x for Blackflame Ignite
    enemyDb.addMod(mkMod('DamageTakenOverTime', 'INC', 20));
    enemyDb.addMod(mkMod('ChaosDamageTakenOverTime', 'INC', 10));

    const res = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb,
      enemyDb,
      baseDamageByType: { Lightning: 500 },
      baseDamageRangeByType: { Lightning: [100, 900] },
      flags: ModFlag.Spell | ModFlag.Hit,
      speed: 2,
      critChancePct: 40, // EO disables crit-always-ignite and +50% crit DoT multi!
      enemyConfig: { enemyFireResist: 0, enemyChaosResist: 0 },
    });

    // EO: chanceOnCrit == chanceOnHit == 50% (NOT 40% + 60%*50% = 70%!)
    expect(res.ignite.effectiveChancePct).toBeCloseTo(50, 2);
    // Duration = 4.0 * 1.2 / 1.5 / 0.75 = 4.2667s
    expect(res.ignite.effectiveDurationSec).toBeCloseTo(4.27, 2);
    expect(res.ignite.fasterMult).toBeCloseTo(1.5, 4);

    // Stacks = 0.5 * 2 * 4.2667 = 4.2667 -> rollFrac = 4.2667 / 5.2667 = 0.81013
    // Lightning base = 100 + (900 - 100) * 0.81013 = 748.10
    // Pre-enemy Ignite DPS = 0.9 * 748.10 * 1.0 (EO no +50% crit multi!) * 1.5 = 1009.94
    // Blackflame Ignite (Chaos): 1009.94 * 1.0 (0% chaos res) * 1.30 (DoT taken) = 1312.92
    // Burning Ground (ALWAYS Fire mitigation!): 1009.94 * 1.45 (-45% Eye of Malice Fire res) * 1.20 (DoT taken) * 0.30 = 527.19
    expect(res.ignite.totalDps).toBeCloseTo(1312.92, 0);
    expect(res.burningGroundDps).toBeCloseTo(527.19, 0);

    // Perfect Agony + Elemental Overload completely disables ailment infliction (CalcOffence.lua:4349-4352)
    const paEoDb = skillDb.clone();
    paEoDb.addMod(mkMod('PerfectAgony', 'FLAG', true));
    const paEoRes = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: paEoDb,
      enemyDb,
      baseDamageByType: { Fire: 1000 },
      flags: ModFlag.Spell | ModFlag.Hit,
      speed: 2,
      critChancePct: 50,
    });
    expect(paEoRes.ignite.totalDps).toBe(0);
  });

  it('applies PoE 1 Ryslatha/Volatility MinPhysicalDamage/MaxPhysicalDamage MORE, over-stack crit probability, AdditionalPoisonChance, and Temporal Chains', () => {
    // Part A: Bleed with Volatility/Ryslatha canonical names + over-stack crit probability
    const bleedDb = new ModDB();
    bleedDb.addMod(mkMod('BleedChance', 'BASE', 100));
    bleedDb.addMod(mkMod('MinPhysicalDamage', 'MORE', -50)); // 0.5x min
    bleedDb.addMod(mkMod('MaxPhysicalDamage', 'MORE', 50)); // 1.5x max

    const bleedRes = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: bleedDb,
      enemyDb: new ModDB(),
      baseDamageByType: { Physical: 500 },
      baseDamageRangeByType: { Physical: [200, 800] },
      flags: ModFlag.Attack | ModFlag.Melee | ModFlag.Hit,
      speed: 2, // 2 APS * 5s = 10 stacks -> rollFrac = 10/11 = 0.90909
      critChancePct: 50, // over-stack crit = 1 - 0.5^10 = 99.90% -> nearly full +50% crit DoT multi!
    });
    // rMin = 200 * 0.5 = 100, rMax = 800 * 1.5 = 1200
    // roll = 100 + 1100 * (10/11) = 1100
    // critDotMulti = 1 + 0.5 * (1 - 0.5^10) = 1.49951
    // DPS = 0.70 * 1100 * 1.49951 = 1154.62
    expect(bleedRes.bleed.totalDps).toBeCloseTo(1154.62, 0);

    // Part B: Poison with AdditionalPoisonChance + Temporal Chains + AilmentEffect
    const psnDb = new ModDB();
    const psnEnemy = new ModDB();
    psnDb.addMod(mkMod('PoisonChance', 'BASE', 100));
    psnDb.addMod(mkMod('AdditionalPoisonChance', 'BASE', 50)); // 1.5x poisons per hit
    psnDb.addMod(mkMod('AilmentEffect', 'INC', 20)); // 1.2x
    psnEnemy.addMod(mkMod('BuffExpireFaster', 'MORE', -25)); // 1/0.75 = 1.3333x duration

    const psnRes = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: psnDb,
      enemyDb: psnEnemy,
      baseDamageByType: { Chaos: 1000 },
      flags: ModFlag.Attack | ModFlag.Hit,
      speed: 3,
      enemyConfig: { enemyChaosResist: 0 },
    });
    // Duration = 2.0 / 0.75 = 2.6667s; stacks = 3 * 1.5 * 2.6667 = 12 stacks
    // Single stack = 0.30 * 1000 * 1.20 = 360 -> Total = 4320
    expect(psnRes.poison.effectiveDurationSec).toBeCloseTo(2.67, 2);
    expect(psnRes.poison.effectiveStacks).toBeCloseTo(12, 2);
    expect(psnRes.poison.singleStackDps).toBeCloseTo(360, 1);
    expect(psnRes.poison.totalDps).toBeCloseTo(4320, 0);
  });

  it('handles PoE 1 & PoE 2 non-ailment skillDot Area/Projectile inheritance, Unnerved exclusion, PDR, and Hit MORE gating (Chain II)', () => {
    const skillDb = new ModDB();
    const enemyDb = new ModDB();
    // Area damage (Concentrated Effect) + SpellDamageAppliesToDot + Chain II (-50% MORE Hit Damage)
    skillDb.addMod(mkMod('Damage', 'MORE', 40, ModFlag.Area));
    skillDb.addMod(mkMod('Damage', 'INC', 100, ModFlag.Spell));
    skillDb.addMod(mkMod('SpellDamageAppliesToDot', 'FLAG', true));
    skillDb.addMod(mkMod('Damage', 'MORE', -50, ModFlag.Hit)); // Chain II — must NOT reduce skillDot!
    // Unnerved (+10% Spell Damage Taken) — must NOT leak into Spell DoT!
    applyEnemyDebuffsToEnemyDb(enemyDb, { game: 'poe1', enemyUnnerved: true });
    // DamageTakenOverTime (+25%) DOES apply!
    enemyDb.addMod(mkMod('DamageTakenOverTime', 'INC', 25));

    const res = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb,
      enemyDb,
      baseDamageByType: {},
      flags: ModFlag.Spell | ModFlag.Area | ModFlag.Hit,
      keywordFlags: KeywordFlag.Spell | KeywordFlag.Hit,
      speed: 2,
      skillData: { ChaosDot: 1000 }, // dotIsArea omitted -> inherits ModFlag.Area!
      enemyConfig: { enemyChaosResist: 0 },
    });
    // 1000 * 2.0 (Spell 100% via SpellDamageAppliesToDot) * 1.40 (Area) * 1.25 (DoT taken, NO Unnerve!) = 3500
    expect(res.skillDot.byType.Chaos).toBeCloseTo(3500, 1);

    // PhysicalDot respects positive enemy PhysicalDamageReduction (20% PDR -> 0.80x)
    const physEnemy = new ModDB();
    physEnemy.addMod(mkMod('PhysicalDamageReduction', 'BASE', 20));
    const physRes = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: new ModDB(),
      enemyDb: physEnemy,
      baseDamageByType: {},
      flags: ModFlag.Spell,
      speed: 1,
      skillData: { PhysicalDot: 1000 },
    });
    expect(physRes.skillDot.byType.Physical).toBeCloseTo(800, 1);
  });

  it('implements PoE 2 AilmentEffect (Low Tolerance), BleedMagnitude alias, linear uptime, level-82 threshold, roll/crit over-stacking, and CritPoisonChance (Atsak)', () => {
    // Case A: PoE 2 Low Tolerance (AilmentEffect INC +60%) + CritPoisonChance (Atsak's Sight)
    const psnDb = new ModDB();
    psnDb.addMod(mkMod('CritPoisonChance', 'BASE', 100)); // 0% on non-crit, 100% on crit
    psnDb.addMod(mkMod('AilmentEffect', 'INC', 60, 0, KeywordFlag.Poison)); // 1.60x Low Tolerance!

    const atsak = computeAuthenticAilmentAndSkillDots({
      game: 'poe2',
      skillDb: psnDb,
      enemyDb: new ModDB(),
      baseDamageByType: {},
      // Non-crit hit = 1000, critMult = 200%, critChance = 50% -> preMitigationAvg = 1000 * 1.5 = 1500
      preMitigationHitByType: { Physical: 1500 },
      flags: ModFlag.Attack | ModFlag.Hit,
      speed: 2, // 0.5 chance * 2 APS * 2s = 2 stacks -> capped to 1
      critChancePct: 50,
      critMultiplierPct: 200,
      enemyConfig: { enemyChaosResist: 0 },
    });
    // 100% of poisons come from crits (2000 unmitigated hit): 0.20 * 2000 * 1.60 (Low Tolerance) = 640
    expect(atsak.poison.chancePct).toBeCloseTo(50, 2);
    expect(atsak.poison.singleStackDps).toBeCloseTo(640, 1);
    expect(atsak.poison.effectiveStacks).toBe(1);
    expect(atsak.poison.totalDps).toBeCloseTo(640, 1);

    // Case B: PoE 2 Bleed with `BleedMagnitude` alias + AilmentEffect + order-statistic roll average + over-stack crit
    const bldDb = new ModDB();
    bldDb.addMod(mkMod('BleedChance', 'BASE', 100));
    bldDb.addMod(mkMod('BleedMagnitude', 'INC', 50)); // 1.5x (alias alongside BleedingMagnitude)
    bldDb.addMod(mkMod('AilmentEffect', 'MORE', 20)); // 1.2x

    const poe2Bleed = computeAuthenticAilmentAndSkillDots({
      game: 'poe2',
      skillDb: bldDb,
      enemyDb: new ModDB(),
      baseDamageByType: {},
      // Non-crit = 1000, critMult = 200%, crit = 50% -> preAvg = 1500; range [500, 1500] avg 1000
      preMitigationHitByType: { Physical: 1500 },
      hitDamageRangeByType: { Physical: { min: 500, max: 1500, average: 1000 } },
      flags: ModFlag.Attack | ModFlag.Hit,
      speed: 1.8, // 1.8 * 5s = 9 stacks -> roll = 9/10 = 0.9 -> rollUplift = (500 + 1000*0.9)/1000 = 1.4
      critChancePct: 50, // overCrit = 1 - 0.5^9 = 0.998047 -> effPre = 1000 * 1.998047 = 1998.047
      critMultiplierPct: 200,
    });
    // 0.15 * 1998.047 * 1.4 * 1.5 * 1.2 = 755.26
    expect(poe2Bleed.bleed.totalDps).toBeCloseTo(755.26, 0);

    // Case C: PoE 2 Ignite level-82 threshold (71303) & linear uptime min(1, hitChance * chance * speed * dur)
    const ignRes = computeAuthenticAilmentAndSkillDots({
      game: 'poe2',
      skillDb: new ModDB(),
      enemyDb: new ModDB(),
      baseDamageByType: {},
      preMitigationHitByType: { Fire: 7130.3 }, // 7130.3 / 71303 * 20 = 2.0% ignite chance!
      flags: ModFlag.Attack | ModFlag.Hit,
      speed: 2, // 2% * 2 APS * 4s = 0.16 linear uptime (NOT binomial 1 - 0.98^8 = 0.1492!)
      critChancePct: 0,
      enemyConfig: { enemyLevel: 82, enemyFireResist: 0 },
    });
    expect(ignRes.ignite.effectiveChancePct).toBeCloseTo(2, 2);
    expect(ignRes.ignite.effectiveStacks).toBeCloseTo(0.16, 4);
    expect(ignRes.ignite.singleStackDps).toBeCloseTo(0.2 * 7130.3, 1);
    expect(ignRes.ignite.totalDps).toBeCloseTo(0.2 * 7130.3 * 0.16, 1);
  });

  it('applies minion ActionSpeed, Blind Evasion MORE, Eye of Malice resist INC, and TripleDamageChance', () => {
    const minionDb = new ModDB();
    const enemyDb = new ModDB();
    minionDb.addMod(mkMod('ActionSpeed', 'INC', 25)); // 1.25x speed
    minionDb.addMod(mkMod('TripleDamageChance', 'BASE', 50)); // 1 + 0.5 * 2 = 2.0x hit dmg
    minionDb.addMod(mkMod('CannotIgnite', 'FLAG', true));
    enemyDb.addMod(mkMod('ElementalResist', 'BASE', -20));
    enemyDb.addMod(mkMod('FireResist', 'INC', 50)); // -20 * 1.5 = -30% -> 1.30x

    const res = computeMinionGroupOffence({
      game: 'poe1',
      minionBase: {
        physicalMin: 0,
        physicalMax: 0,
        elementalDamage: { Fire: [100, 100] },
        attacksPerSecond: 2.0,
        critChance: 0,
        critMultiplier: 130,
        baseLimit: 1,
      },
      minionDb,
      enemyDb,
      effLevel: 20,
      enemyConfig: { enemyFireResist: 0 },
    });

    // Avg hit = 100 * 1.30 (res) * 2.0 (50% triple dmg) = 260; speed = 2.0 * 1.25 = 2.5 -> hitDps = 650
    expect(res.perMinion.speed).toBeCloseTo(2.5, 4);
    expect(res.perMinion.averageHit).toBeCloseTo(260, 1);
    expect(res.perMinion.hitDps).toBeCloseTo(650, 1);
  });

  it('coalesces matching same-gem quality (Q...) and base MORE mods additively without merging distinct base MORE mods', () => {
    const skillDb = new ModDB();
    const enemyDb = new ModDB();
    const minionDb = new ModDB();

    // Lacerate of Haemorrhage: Q50 adds 100% more Ailment Damage, Lv21 adds 138% more Ailment Damage
    // PoB sums these into 238% more (3.38x), NOT 2.00 * 2.38 = 4.76x!
    injectCompiledGemMods(
      skillDb,
      enemyDb,
      minionDb,
      [{ name: 'Damage', type: 'MORE', value: 100, keywordFlags: KeywordFlag.Bleed }],
      'Skill: Lacerate of Haemorrhage (Q50)',
      { game: 'poe1' },
    );
    injectCompiledGemMods(
      skillDb,
      enemyDb,
      minionDb,
      [{ name: 'Damage', type: 'MORE', value: 138, keywordFlags: KeywordFlag.Bleed }],
      'Skill: Lacerate of Haemorrhage',
      { game: 'poe1' },
    );
    expect(skillDb.more('Damage', ModFlag.Dot | ModFlag.Ailment, KeywordFlag.Bleed)).toBeCloseTo(3.38, 4);

    // Distinct base MORE mods on the same gem (Multistrike -19% & +22%) remain separate multiplicative mods
    injectCompiledGemMods(
      skillDb,
      enemyDb,
      minionDb,
      [
        { name: 'Damage', type: 'MORE', value: -19, flags: ModFlag.Attack },
        { name: 'Damage', type: 'MORE', value: 22, flags: ModFlag.Attack },
      ],
      'Support: Multistrike',
      { game: 'poe1' },
    );
    // round(0.81 * 1.22 * 100) / 100 = 0.99 (NOT 1 + (-19 + 22)/100 = 1.03!)
    expect(skillDb.more('Damage', ModFlag.Attack, KeywordFlag.Attack)).toBeCloseTo(0.99, 4);
  });

  it('supports PoE 2 config PoisonStacks, DurationofDamagingAilmentsDuration, Escalating Toxins, PoisonFaster, and AllDamageCanPoison', () => {
    const skillDb = new ModDB();
    const enemyDb = new ModDB();
    skillDb.addMod(mkMod('PoisonChance', 'BASE', 100));
    skillDb.addMod(mkMod('PoisonStacks', 'BASE', 2)); // 1 base + 2 = 3
    skillDb.addMod(mkMod('DoublePoisonStacks', 'FLAG', true)); // 3 * 2 = 6 max stacks
    skillDb.addMod(mkMod('AllDamageCanPoison', 'FLAG', true)); // Plaguefinger
    skillDb.addMod(mkMod('AilmentMagnitude', 'MORE', 100, 0, KeywordFlag.Poison)); // 2.0x
    skillDb.addMod(mkMod('PoisonFaster', 'INC', 22)); // 1.22x rate & /1.22 duration
    skillDb.addMod(mkMod('DurationofDamagingAilmentsDuration', 'INC', 40)); // Wasting/Intense Dose
    skillDb.addMod(mkMod('ToxicDeliveryPoisonDurCap', 'BASE', 100)); // Escalating Toxins (10%/poison)
    skillDb.setMultiplier('PoisonAppliedRecently', 6); // +60% Poison Duration
    skillDb.setMultiplier('PoisonStacks', 6); // multiplierPoisonOnEnemy = 6 override

    const res = computeAuthenticAilmentAndSkillDots({
      game: 'poe2',
      skillDb,
      enemyDb,
      baseDamageByType: {},
      preMitigationHitByType: { Physical: 1000, Lightning: 500 },
      flags: ModFlag.Attack | ModFlag.Hit,
      speed: 1.5, // 1.5 * 3.28 = 4.92 < 6, overridden to 6 by config PoisonStacks
      critChancePct: 0,
      enemyConfig: { enemyChaosResist: 0 },
    });

    // Duration = 2.0 * (1 + (40 + 60)/100) / 1.22 = 4.0 / 1.22 = 3.2787s
    expect(res.poison.effectiveDurationSec).toBeCloseTo(3.28, 2);
    expect(res.poison.maxStacks).toBe(6);
    expect(res.poison.effectiveStacks).toBe(6);
    // Single stack = 0.20 * (1000 + 500) * 2.0 (mag) * 1.22 (faster) = 732 -> 6 stacks = 4392
    expect(res.poison.singleStackDps).toBeCloseTo(732, 1);
    expect(res.poison.totalDps).toBeCloseTo(4392, 1);
  });

  it('applies PoE 1 ToxicDeliveryPoisonDurCap, The Tempest Rising Moving Bleed, Ruthless Blow Bleed, ElementalOverload, and Crimson Dance anti-double-halving', () => {
    // 1. Assassin Toxic Delivery (+100% Poison Duration cap at 5%/poison)
    const psnDb = new ModDB();
    psnDb.addMod(mkMod('PoisonChance', 'BASE', 100));
    psnDb.addMod(mkMod('ToxicDeliveryPoisonDurCap', 'BASE', 100));
    psnDb.setMultiplier('PoisonAppliedRecently', 25); // 25 * 5 = 125 -> capped at +100%
    const psnRes = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: psnDb,
      enemyDb: new ModDB(),
      baseDamageByType: { Chaos: 1000 },
      flags: ModFlag.Attack | ModFlag.Hit,
      speed: 2,
      enemyConfig: { enemyChaosResist: 0 },
    });
    // Duration = 2.0 * 2.0 = 4.0s -> 8 stacks -> 0.30 * 1000 * 8 = 2400
    expect(psnRes.poison.effectiveDurationSec).toBeCloseTo(4.0, 2);
    expect(psnRes.poison.totalDps).toBeCloseTo(2400, 1);

    // 2. The Tempest Rising flag stays on playerDb in splitModDBIntoActorBuses + Moving condition gives 3x Bleed + Ruthless Blow
    const rawDb = new ModDB();
    rawDb.addMod(mkMod('EnemyAffectedByEleAilmentCountsAsMoving', 'FLAG', true));
    const split = splitModDBIntoActorBuses(rawDb, { game: 'poe1' });
    expect(split.playerDb.flag('EnemyAffectedByEleAilmentCountsAsMoving')).toBe(true);

    const bleedDb = new ModDB();
    const bleedEnemy = new ModDB();
    bleedDb.addMod(mkMod('BleedChance', 'BASE', 100));
    bleedDb.addMod(mkMod('RuthlessBlowMaxCount', 'BASE', 3)); // 33% chance
    bleedDb.addMod(mkMod('RuthlessBlowAilmentMultiplier', 'BASE', 97, ModFlag.Melee)); // 1 + 0.33*0.97 = 1.3201x
    bleedEnemy.setCondition('Moving', true); // set by engine when Tempest Rising + Ele Ailment active
    const bleedRes = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: bleedDb,
      enemyDb: bleedEnemy,
      baseDamageByType: { Physical: 1000 },
      flags: ModFlag.Attack | ModFlag.Melee | ModFlag.Hit,
      speed: 2,
    });
    // 2.10 (Moving 3x) * 1000 * 1.3201 (Ruthless) = 2772.21
    expect(bleedRes.bleed.totalDps).toBeCloseTo(2772.21, 1);

    // 3. Crimson Dance anti-double-halving when explicit -50% MORE BleedDamage is already present
    const cdDb = new ModDB();
    cdDb.addMod(mkMod('BleedChance', 'BASE', 100));
    cdDb.addMod(mkMod('CrimsonDance', 'FLAG', true));
    cdDb.addMod(mkMod('DotDamage', 'MORE', -50, ModFlag.Dot | ModFlag.Ailment, KeywordFlag.Bleed));
    const cdRes = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: cdDb,
      enemyDb: new ModDB(),
      baseDamageByType: { Physical: 1000 },
      flags: ModFlag.Attack | ModFlag.Melee | ModFlag.Hit,
      speed: 2, // 10 stacks -> capped at 8
    });
    // Single stack = 0.70 * 1000 * 0.50 = 350 (NOT 0.35 * 1000 * 0.50 = 175!) -> 8 stacks = 2800
    expect(cdRes.bleed.singleStackDps).toBeCloseTo(350, 1);
    expect(cdRes.bleed.totalDps).toBeCloseTo(2800, 1);

    // 4. ElementalOverload flag disables crit ailment bonuses (62dfba0)
    const eoDb = new ModDB();
    eoDb.addMod(mkMod('ElementalOverload', 'FLAG', true));
    eoDb.addMod(mkMod('IgniteChance', 'BASE', 25));
    const eoRes = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: eoDb,
      enemyDb: new ModDB(),
      baseDamageByType: { Fire: 1000 },
      flags: ModFlag.Spell | ModFlag.Hit,
      speed: 1,
      critChancePct: 100,
      enemyConfig: { enemyFireResist: 0 },
    });
    expect(eoRes.ignite.effectiveChancePct).toBeCloseTo(25, 2);
    expect(eoRes.ignite.singleStackDps).toBeCloseTo(900, 1); // No +50% crit DoT multi!
  });

  it('expands Defences cmods (Stone Golem), preserves Multiplier-tagged fractional MORE (Herald of the Hive), and inherits elemental conversion chains on PoE 1 Ignite', () => {
    // 1. Defences compiled mod expansion -> Armour, Evasion, EnergyShield, Ward
    const buses = createActorModBuses();
    injectCompiledGemMods(
      buses.playerDb,
      buses.enemyDb,
      buses.minionDb,
      [
        { name: 'Defences', type: 'INC', value: 20, target: 'player' },
        {
          name: 'Damage',
          type: 'MORE',
          value: 3,
          target: 'player',
          tags: [{ type: 'Multiplier', var: 'Herald' }],
        },
      ],
      'Stone Golem & Herald of the Hive',
      { game: 'poe1', effectMultiplier: 1.5, scaleMore: true },
    );
    expect(buses.playerDb.sum('INC', 'Armour')).toBe(30);
    expect(buses.playerDb.sum('INC', 'Evasion')).toBe(30);
    expect(buses.playerDb.sum('INC', 'EnergyShield')).toBe(30);
    expect(buses.playerDb.sum('INC', 'Ward')).toBe(30);

    // Multiplier-tagged MORE preserves 2-decimal precision (3 * 1.5 = 4.5, NOT truncated to 4!)
    buses.playerDb.setMultiplier('Herald', 4);
    // 4.5 * 4 = 18% MORE Damage -> 1.18x
    expect(buses.playerDb.more('Damage')).toBeCloseTo(1.18, 4);

    // 2. PoE 1 Ignite elemental conversion-chain inheritance (Lightning -> Cold -> Fire)
    const convDb = new ModDB();
    convDb.addMod(mkMod('IgniteChance', 'BASE', 100));
    convDb.addMod(mkMod('LightningDamageConvertToCold', 'BASE', 100));
    convDb.addMod(mkMod('ColdDamageConvertToFire', 'BASE', 100));
    convDb.addMod(mkMod('LightningDamage', 'INC', 100)); // inherited via Lightning -> Cold -> Fire
    convDb.addMod(mkMod('ColdDamage', 'INC', 50)); // inherited via Cold -> Fire
    convDb.addMod(mkMod('FireDamage', 'INC', 50)); // direct Fire
    // PhysicalDamage INC must NOT bleed into an elemental-only Fire hit!
    convDb.addMod(mkMod('PhysicalDamage', 'INC', 200));
    const convRes = computeAuthenticAilmentAndSkillDots({
      game: 'poe1',
      skillDb: convDb,
      enemyDb: new ModDB(),
      baseDamageByType: { Fire: 1000 },
      flags: ModFlag.Spell | ModFlag.Hit,
      keywordFlags: KeywordFlag.Spell | KeywordFlag.Lightning | KeywordFlag.Hit,
      speed: 1,
      enemyConfig: { enemyFireResist: 0 },
    });
    // Total INC = 100 (Lightning) + 50 (Cold) + 50 (Fire) = +200% (3.0x); Phys 200% excluded!
    // Single stack = 0.90 * 1000 * 3.0 = 2700
    expect(convRes.ignite.singleStackDps).toBeCloseTo(2700, 1);
  });

  it('scopes SpiritualCommand to Attack speed only, evaluates PoE 2 CriticalStrike ailment magnitude, and honors Minion CritChance OVERRIDE (SRS of Enormity)', () => {
    // 1. SpiritualCommand copies Minion Attack Speed strictly to ModFlag.Attack (NEVER ModFlag.Spell)
    const buses = createActorModBuses();
    routeModToActorBuses(buses, mkMod('MinionAttackSpeed', 'INC', 25), { spiritualCommand: true });
    routeModToActorBuses(buses, mkMod('MinionCastSpeed', 'INC', 30), { spiritualCommand: true });
    expect(buses.playerDb.sum('INC', 'Speed', ModFlag.Attack)).toBe(25);
    expect(buses.playerDb.sum('INC', 'Speed', ModFlag.Spell)).toBe(0);

    // 2. PoE 2 CriticalStrike-conditioned BleedingMagnitude / PoisonMagnitude / IgniteMagnitude
    const critBleedDb = new ModDB();
    critBleedDb.addMod(mkMod('BleedChance', 'BASE', 100));
    critBleedDb.addMod({
      ...mkMod('BleedingMagnitude', 'INC', 100),
      tags: [{ type: 'Condition', var: 'CriticalStrike' }],
    });
    // 0% crit -> CriticalStrike=false -> magMult = 1.0 -> 0.15 * 1000 = 150
    const nonCritBleed = computeAuthenticAilmentAndSkillDots({
      game: 'poe2',
      skillDb: critBleedDb,
      enemyDb: new ModDB(),
      baseDamageByType: { Physical: 1000 },
      preMitigationHitByType: { Physical: 1000 },
      flags: ModFlag.Attack | ModFlag.Hit,
      speed: 1,
      critChancePct: 0,
      critMultiplierPct: 200,
    });
    expect(nonCritBleed.bleed.singleStackDps).toBeCloseTo(150, 1);

    // 100% crit -> CriticalStrike=true -> magMult = 2.0 -> 0.15 * 1000 * 2.0 = 300
    const fullCritBleed = computeAuthenticAilmentAndSkillDots({
      game: 'poe2',
      skillDb: critBleedDb,
      enemyDb: new ModDB(),
      baseDamageByType: { Physical: 1000 },
      preMitigationHitByType: { Physical: 1000 },
      flags: ModFlag.Attack | ModFlag.Hit,
      speed: 1,
      critChancePct: 100,
      critMultiplierPct: 200,
    });
    expect(fullCritBleed.bleed.singleStackDps).toBeCloseTo(300, 1);

    // 3. Minion CritChance OVERRIDE (SRS of Enormity = 100% CritChance)
    const minionDb = new ModDB();
    minionDb.addMod({
      name: 'CritChance',
      type: 'OVERRIDE',
      value: 100,
      flags: 0,
      keywordFlags: 0,
      source: 'Skill: Summon Raging Spirit of Enormity',
    });
    const srsRes = computeMinionGroupOffence({
      game: 'poe1',
      minionBase: {
        physicalMin: 100,
        physicalMax: 200,
        attacksPerSecond: 1.5,
        critChance: 5,
        critMultiplier: 130,
        baseLimit: 6,
      },
      minionDb,
      enemyDb: new ModDB(),
      effLevel: 20,
    });
    expect(srsRes.perMinion.critChance).toBe(100);
  });

  it('emits PoE 1 Infused Channelling 10% MORE Infusion buff gated on InfusionActive without double-counting on quality pass', () => {
    const icBuses = createActorModBuses();
    injectCompiledGemMods(
      icBuses.playerDb,
      icBuses.enemyDb,
      icBuses.minionDb,
      [{ name: 'Damage', type: 'MORE', value: 29, flags: 0, keywordFlags: 0 }],
      'Support: Infused Channelling',
      { game: 'poe1' },
    );
    // Without InfusionActive condition -> only 29% MORE
    expect(icBuses.playerDb.more('Damage')).toBeCloseTo(1.29, 2);
    // With InfusionActive=true -> 1.29 * 1.10 = 1.419 -> 1.42 (ModDB rounds MORE to 2 decimals)
    icBuses.playerDb.setCondition('InfusionActive', true);
    expect(icBuses.playerDb.more('Damage')).toBeCloseTo(1.42, 2);
    // Re-injecting (e.g. quality pass) must NOT double-count the 10% Infusion buff
    injectCompiledGemMods(
      icBuses.playerDb,
      icBuses.enemyDb,
      icBuses.minionDb,
      [{ name: 'Damage', type: 'INC', value: 10, flags: 0, keywordFlags: 0 }],
      'Support: Infused Channelling (Q20)',
      { game: 'poe1' },
    );
    expect(icBuses.playerDb.more('Damage')).toBeCloseTo(1.42, 2);
  });
});
