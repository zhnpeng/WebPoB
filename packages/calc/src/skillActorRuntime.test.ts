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
