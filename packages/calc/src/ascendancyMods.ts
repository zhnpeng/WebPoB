import {
  KeywordFlag,
  ModFlag,
  type BuildConfig,
  type GameId,
  type Mod,
  type ModType,
  type PassiveNode,
} from '@webpob/core';
import type { ModDB } from './modDb.js';

export interface AscendancyBodyArmourStats {
  armour?: number;
  evasion?: number;
  energyShield?: number;
}

export interface AscendancySupportColors {
  red?: number;
  green?: number;
  blue?: number;
}

export interface AscendancyPreContext {
  game: GameId;
  db: ModDB;
  allocatedNodes: readonly PassiveNode[];
  config?: Partial<BuildConfig>;
  /** Resolved local stats of Equipped Body Armour (from localItem.ts). */
  bodyArmourStats?: AscendancyBodyArmourStats;
  /** Number of active player auras (for Necromancer Commander of Darkness). */
  activeAuraCount?: number;
  /** Number of allocated distinct Mastery types (for Trickster Polymath). */
  masteryCount?: number;
  /** Connected support gem colors on main skill (for PoE 2 Gemling Legionnaire). */
  mainSkillSupportColors?: AscendancySupportColors;
  /** Number of active summoned golems (for Elementalist Liege of the Primordial). */
  activeGolemCount?: number;
}

export interface AscendancyPostLifeContext {
  game: GameId;
  db: ModDB;
  allocatedNodes: readonly PassiveNode[];
  config?: Partial<BuildConfig>;
  /** Evaluated Attributes after tree, equipment, and pre-pass. */
  str: number;
  dex: number;
  int: number;
  /** Evaluated Maximum Life (after Strength and % inc/more Life). */
  maxLife: number;
  /** Evaluated Maximum Mana (after Intelligence and % inc/more Mana). */
  maxMana: number;
  /** Evaluated Maximum Energy Shield. */
  maxEnergyShield?: number;
  /** Evaluated Accuracy Rating before Undeniable Strength->Accuracy is added. */
  accuracy?: number;
  /** Evaluated Evasion Rating (for Invoker ...and Protect me from Harm). */
  evasion?: number;
  /** Evaluated Armour Rating. */
  armour?: number;
  /** Optional explicit max charge counts (defaults to reading ModDB). */
  maxPowerCharges?: number;
  maxFrenzyCharges?: number;
  maxEnduranceCharges?: number;
  /** Current active Power Charges (for Assassin Deadly Infusion). */
  activePowerCharges?: number;
}

export interface AscendancyNotableDescriptor {
  game: GameId;
  ascendancy: string;
  name: string;
  phase: 'small-passive' | 'pre' | 'post-life' | 'both';
}

export const SUPPORTED_ASCENDANCY_NOTABLES: readonly AscendancyNotableDescriptor[] = [
  // PoE 2 Ascendancies (24 notables across 10 ascendancies)
  { game: 'poe2', ascendancy: 'Titan', name: 'Hulking Form', phase: 'small-passive' },
  { game: 'poe2', ascendancy: 'Invoker', name: 'Lead me through Grace...', phase: 'pre' },
  { game: 'poe2', ascendancy: 'Invoker', name: '...and Protect me from Harm', phase: 'both' },
  { game: 'poe2', ascendancy: 'Blood Mage', name: 'Sunder the Flesh', phase: 'pre' },
  { game: 'poe2', ascendancy: 'Blood Mage', name: 'Gore Spike', phase: 'post-life' },
  { game: 'poe2', ascendancy: 'Blood Mage', name: 'Crimson Power', phase: 'pre' },
  { game: 'poe2', ascendancy: 'Infernalist', name: "Beidat's Hand", phase: 'post-life' },
  { game: 'poe2', ascendancy: 'Infernalist', name: "Beidat's Will", phase: 'post-life' },
  { game: 'poe2', ascendancy: 'Infernalist', name: "Beidat's Gaze", phase: 'post-life' },
  { game: 'poe2', ascendancy: 'Infernalist', name: 'Altered Flesh', phase: 'pre' },
  { game: 'poe2', ascendancy: 'Deadeye', name: 'Gathering Winds', phase: 'pre' },
  { game: 'poe2', ascendancy: 'Deadeye', name: 'Point Blank', phase: 'pre' },
  { game: 'poe2', ascendancy: 'Deadeye', name: 'Endless Munitions', phase: 'pre' },
  { game: 'poe2', ascendancy: 'Stormweaver', name: 'Force of Will', phase: 'both' },
  { game: 'poe2', ascendancy: 'Stormweaver', name: 'Constant Gale', phase: 'pre' },
  { game: 'poe2', ascendancy: 'Lich', name: 'Soulless Form', phase: 'both' },
  { game: 'poe2', ascendancy: 'Lich', name: 'Eldritch Empowerment', phase: 'pre' },
  { game: 'poe2', ascendancy: 'Gemling Legionnaire', name: 'Enhanced Effectiveness', phase: 'both' },
  { game: 'poe2', ascendancy: 'Gemling Legionnaire', name: 'Gem Studded', phase: 'pre' },
  { game: 'poe2', ascendancy: 'Gemling Legionnaire', name: 'Integrated Efficiency', phase: 'pre' },
  { game: 'poe2', ascendancy: 'Amazon', name: 'Critical Strike', phase: 'both' },
  { game: 'poe2', ascendancy: 'Amazon', name: 'Predatory Instinct', phase: 'pre' },
  { game: 'poe2', ascendancy: 'Ritualist', name: 'Unfurled Finger', phase: 'pre' },
  { game: 'poe2', ascendancy: 'Ritualist', name: 'Mystic Attunement', phase: 'pre' },

  // PoE 1 Ascendancies (35 notables across 12 ascendancies)
  { game: 'poe1', ascendancy: 'Chieftain', name: "Valako, Storm's Embrace", phase: 'post-life' },
  { game: 'poe1', ascendancy: 'Chieftain', name: 'Tasalio, Cleansing Water', phase: 'post-life' },
  { game: 'poe1', ascendancy: 'Chieftain', name: "Ramako, Sun's Light", phase: 'pre' },
  { game: 'poe1', ascendancy: 'Juggernaut', name: 'Undeniable', phase: 'both' },
  { game: 'poe1', ascendancy: 'Juggernaut', name: 'Unbreakable', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Juggernaut', name: 'Untiring', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Slayer', name: 'Masterful Form', phase: 'post-life' },
  { game: 'poe1', ascendancy: 'Slayer', name: 'Overwhelm', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Slayer', name: 'Bane of Legends', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Slayer', name: 'Headsman', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Assassin', name: 'Opportunistic', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Assassin', name: 'For the Jugular', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Assassin', name: 'Unstable Infusion', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Assassin', name: 'Deadly Infusion', phase: 'post-life' },
  { game: 'poe1', ascendancy: 'Elementalist', name: 'Shaper of Flames', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Elementalist', name: 'Mastermind of Discord', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Elementalist', name: 'Heart of Destruction', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Elementalist', name: 'Liege of the Primordial', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Necromancer', name: 'Commander of Darkness', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Necromancer', name: 'Unnatural Strength', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Necromancer', name: 'Mindless Aggression', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Deadeye', name: 'Gathering Winds', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Deadeye', name: 'Far Shot', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Champion', name: 'Fortitude', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Champion', name: 'Inspirational', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Inquisitor', name: 'Inevitable Judgement', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Inquisitor', name: 'Pious Path', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Inquisitor', name: 'Augury of Penitence', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Trickster', name: 'One Step Ahead', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Trickster', name: 'Polymath', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Trickster', name: 'Spellbreaker', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Gladiator', name: 'More Than Skill', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Gladiator', name: 'Jagged Technique', phase: 'pre' },
  { game: 'poe1', ascendancy: 'Pathfinder', name: "Nature's Boon", phase: 'pre' },
  { game: 'poe1', ascendancy: 'Pathfinder', name: 'Master Toxicist', phase: 'pre' },
] as const;

function normalizeNodeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function indexNodesByName(allocatedNodes: readonly PassiveNode[]): Map<string, PassiveNode> {
  const map = new Map<string, PassiveNode>();
  for (const node of allocatedNodes) {
    if (!node?.name?.en) continue;
    map.set(normalizeNodeName(node.name.en), node);
  }
  return map;
}

function addMod(
  db: ModDB,
  name: string,
  type: ModType,
  value: number | boolean | string,
  source: string,
  flags = 0,
  keywordFlags = 0,
): void {
  db.addMod({ name, type, value, flags, keywordFlags, source });
}

function hasSourceMod(db: ModDB, statName: string, sourceSubstring: string): boolean {
  const lower = sourceSubstring.toLowerCase();
  return db
    .calcStat(statName)
    .sources.some((entry) => entry.source.toLowerCase().includes(lower));
}

function extractNumberFromStats(stats: readonly string[] | undefined, pattern: RegExp, fallback: number): number {
  if (!stats) return fallback;
  for (const line of stats) {
    const match = line.match(pattern);
    if (match && match[1]) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return fallback;
}

function isBossOrUniqueContext(config?: Partial<BuildConfig>): boolean {
  // Default to true when config/enemyIsBoss is omitted so standalone Boss/Unique calculations work cleanly.
  return config?.enemyIsBoss !== 'None';
}

/**
 * Computes the Small Passive Skill effect multiplier from allocated passive nodes.
 * - PoE 2 Titan `Hulking Form` (`50% increased effect of Small Passive Skills`) returns `1.5`.
 * - Returns `1` when no small-passive effect modifiers are allocated.
 */
export function computeSmallPassiveEffectMultiplier(allocatedNodes: readonly PassiveNode[]): number {
  let increasedPct = 0;

  for (const node of allocatedNodes) {
    const stats = node.stats ?? [];
    let matchedInStats = false;
    for (const line of stats) {
      const match = line.match(/(\d+(?:\.\d+)?)% increased effect of Small Passive Skills/i);
      if (match && match[1]) {
        increasedPct += Number(match[1]);
        matchedInStats = true;
      }
    }
    if (!matchedInStats && node.name?.en && normalizeNodeName(node.name.en) === 'hulking form') {
      increasedPct += 50;
    }
  }

  return 1 + increasedPct / 100;
}

/**
 * Scales numeric BASE/INC/MORE values on small passive modifiers using PoB's integer truncation.
 */
export function scaleSmallPassiveMods(mods: readonly Mod[], multiplier: number): Mod[] {
  if (multiplier === 1) return [...mods];
  return mods.map((mod) => {
    if (
      typeof mod.value === 'number' &&
      (mod.type === 'BASE' || mod.type === 'INC' || mod.type === 'MORE')
    ) {
      return { ...mod, value: Math.trunc(mod.value * multiplier) };
    }
    return mod;
  });
}

/**
 * Applies pre-stat ascendancy mechanics after passive tree & equipment local stats
 * are collected and before final Attribute/Life/Defence/Offence evaluation.
 */
export function applyPreStatAscendancyMechanics(input: AscendancyPreContext): void {
  const { game, db, allocatedNodes, config } = input;
  const nodes = indexNodesByName(allocatedNodes);
  const bodyEs = Math.max(0, input.bodyArmourStats?.energyShield ?? 0);
  const bodyEva = Math.max(0, input.bodyArmourStats?.evasion ?? 0);

  if (game === 'poe2') {
    applyPoe2PreStatAscendancies(db, nodes, bodyEs, bodyEva, config, input.mainSkillSupportColors);
  } else {
    applyPoe1PreStatAscendancies(
      db,
      nodes,
      config,
      input.activeAuraCount ?? 0,
      input.masteryCount ?? 0,
      input.activeGolemCount ?? 0,
    );
  }
}

function applyPoe2PreStatAscendancies(
  db: ModDB,
  nodes: Map<string, PassiveNode>,
  bodyEs: number,
  bodyEva: number,
  config?: Partial<BuildConfig>,
  supportColors?: AscendancySupportColors,
): void {
  // --- PoE 2 Invoker ---
  const leadMe = nodes.get('lead me through grace...');
  if (leadMe) {
    const src = 'Ascendancy: Lead me through Grace...';
    const esDivisor = extractNumberFromStats(leadMe.stats, /every (\d+) Item Energy Shield/i, 8);
    const evaDivisor = extractNumberFromStats(leadMe.stats, /every (\d+) (?:Item )?Evasion Rating/i, 20);
    const bonusSpirit = Math.floor(bodyEs / esDivisor) + Math.floor(bodyEva / evaDivisor);
    if (bonusSpirit > 0) {
      addMod(db, 'Spirit', 'BASE', bonusSpirit, src);
    }
    addMod(db, 'NoSpiritFromEquipment', 'FLAG', true, src);
  }

  if (nodes.has('...and protect me from harm')) {
    const src = 'Ascendancy: ...and Protect me from Harm';
    addMod(db, 'Evasion', 'MORE', -35, src);
    addMod(db, 'EvasionAppliesToArmourPdr', 'FLAG', true, src);
  }

  // --- PoE 2 Blood Mage ---
  if (nodes.has('sunder the flesh')) {
    const src = 'Ascendancy: Sunder the Flesh';
    addMod(db, 'SpellBaseCritOverride', 'OVERRIDE', 15, src, ModFlag.Spell);
  }

  if (nodes.has('crimson power') && bodyEs > 0 && db.sum('BASE', 'LifePerBodyEsPct') === 0) {
    addMod(db, 'Life', 'BASE', Math.floor(bodyEs), 'Ascendancy: Crimson Power');
  }

  // --- PoE 2 Infernalist ---
  if (nodes.has('altered flesh')) {
    const src = 'Ascendancy: Altered Flesh';
    addMod(db, 'ColdTakenAsFire', 'BASE', 20, src);
    addMod(db, 'LightningTakenAsFire', 'BASE', 20, src);
    addMod(db, 'PhysTakenAsChaos', 'BASE', 20, src);
  }

  // --- PoE 2 Deadeye ---
  if (nodes.has('gathering winds')) {
    const src = 'Ascendancy: Gathering Winds';
    addMod(db, 'HasTailwind', 'FLAG', true, src);
    if (config?.buffTailwind !== false) {
      // PoE 2 Tailwind (10 stacks): 10% more Skill Speed, 10% inc Movement Speed, 150% inc Evasion
      addMod(db, 'Speed', 'MORE', 10, src, ModFlag.Attack);
      addMod(db, 'Speed', 'MORE', 10, src, ModFlag.Spell);
      addMod(db, 'MovementSpeed', 'INC', 10, src);
      addMod(db, 'Evasion', 'INC', 150, src);
    }
  }

  if (nodes.has('point blank')) {
    addMod(db, 'Damage', 'MORE', 20, 'Ascendancy: Point Blank', ModFlag.Projectile | ModFlag.Hit);
  }

  if (nodes.has('endless munitions')) {
    addMod(db, 'ProjectileCount', 'BASE', 1, 'Ascendancy: Endless Munitions');
  }

  // --- PoE 2 Stormweaver ---
  if (nodes.has('constant gale')) {
    const src = 'Ascendancy: Constant Gale';
    addMod(db, 'HasArcaneSurge', 'FLAG', true, src);
    if (!config?.buffArcaneSurge) {
      // PoE 2 Arcane Surge: 10% more Cast Speed & 20% more Mana Regeneration Rate
      addMod(db, 'Speed', 'MORE', 10, src, ModFlag.Spell);
      addMod(db, 'ManaRegen', 'MORE', 20, src);
    }
  }

  if (nodes.has('force of will')) {
    const src = 'Ascendancy: Force of Will';
    if (!hasSourceMod(db, 'DamageTakenFromManaBeforeLife', 'force of will')) {
      addMod(db, 'DamageTakenFromManaBeforeLife', 'BASE', 20, src);
    }
  }

  // --- PoE 2 Lich ---
  if (nodes.has('soulless form')) {
    const src = 'Ascendancy: Soulless Form';
    addMod(db, 'NoInherentManaRegen', 'FLAG', true, src);
    addMod(db, 'DamageBypassEs', 'BASE', 10, src);
  }

  if (nodes.has('eldritch empowerment')) {
    addMod(db, 'Damage', 'MORE', 30, 'Ascendancy: Eldritch Empowerment', ModFlag.Spell);
  }

  // --- PoE 2 Gemling Legionnaire ---
  if (nodes.has('enhanced effectiveness')) {
    const src = 'Ascendancy: Enhanced Effectiveness';
    addMod(db, 'DoubleAttributeBonuses', 'FLAG', true, src);
  }

  if (nodes.has('gem studded')) {
    const src = 'Ascendancy: Gem Studded';
    addMod(db, 'GemStudded', 'FLAG', true, src);
    const red = Math.max(0, supportColors?.red ?? 0);
    const green = Math.max(0, supportColors?.green ?? 0);
    const blue = Math.max(0, supportColors?.blue ?? 0);
    const maxCount = Math.max(red, green, blue);
    if (maxCount > 0) {
      if (red === maxCount) {
        addMod(db, 'NoExtraDamageFromCrits', 'FLAG', true, src);
      }
      if (blue === maxCount) {
        addMod(db, 'SkillCost', 'MORE', -30, src);
      }
      if (green === maxCount) {
        addMod(db, 'MoveSpeedPenaltyWhileUsingSkills', 'MORE', -40, src);
      }
    }
  }

  if (nodes.has('integrated efficiency')) {
    const src = 'Ascendancy: Integrated Efficiency';
    const red = Math.max(0, supportColors?.red ?? 0);
    const green = Math.max(0, supportColors?.green ?? 0);
    const blue = Math.max(0, supportColors?.blue ?? 0);
    if (red > 0) {
      addMod(db, 'Damage', 'INC', red * 20, src);
    }
    if (green > 0) {
      addMod(db, 'Speed', 'INC', green * 6, src, ModFlag.Attack);
      addMod(db, 'Speed', 'INC', green * 6, src, ModFlag.Spell);
    }
    if (blue > 0) {
      addMod(db, 'CritChance', 'INC', blue * 20, src);
    }
  }

  // --- PoE 2 Amazon ---
  if (nodes.has('critical strike')) {
    addMod(db, 'ExcessAccuracyToCrit', 'FLAG', true, 'Ascendancy: Critical Strike', ModFlag.Attack);
  }

  if (nodes.has('predatory instinct') && isBossOrUniqueContext(config)) {
    addMod(db, 'Damage', 'MORE', 50, 'Ascendancy: Predatory Instinct');
  }

  // --- PoE 2 Ritualist ---
  if (nodes.has('unfurled finger')) {
    const src = 'Ascendancy: Unfurled Finger';
    addMod(db, 'ExtraRingSlot', 'BASE', 1, src);
    addMod(db, 'HasExtraRingSlot', 'FLAG', true, src);
  }

  if (nodes.has('mystic attunement')) {
    const src = 'Ascendancy: Mystic Attunement';
    addMod(db, 'RingEffect', 'INC', 25, src);
    addMod(db, 'AmuletEffect', 'INC', 25, src);
  }
}

function applyPoe1PreStatAscendancies(
  db: ModDB,
  nodes: Map<string, PassiveNode>,
  config: Partial<BuildConfig> | undefined,
  activeAuraCount: number,
  masteryCount: number,
  activeGolemCount: number,
): void {
  // --- PoE 1 Chieftain ---
  if (nodes.has("ramako, sun's light")) {
    const src = "Ascendancy: Ramako, Sun's Light";
    addMod(db, 'EnemyFireResistDotOverride', 'OVERRIDE', -20, src);
    addMod(db, 'RamakoDotFireRes', 'FLAG', true, src);
  }

  // --- PoE 1 Juggernaut ---
  if (nodes.has('undeniable')) {
    if (!hasSourceMod(db, 'Accuracy', 'undeniable')) {
      addMod(db, 'Accuracy', 'BASE', 500, 'Ascendancy: Undeniable');
    }
  }

  if (nodes.has('unbreakable')) {
    const src = 'Ascendancy: Unbreakable';
    if (!db.flag('BodyArmourDoubled')) {
      addMod(db, 'BodyArmourDoubled', 'FLAG', true, src);
    }
    addMod(db, 'ArmourAppliesToChaos', 'BASE', 15, src);
  }

  if (nodes.has('untiring')) {
    const src = 'Ascendancy: Untiring';
    addMod(db, 'LifeRegenRate', 'INC', 40, src);
    addMod(db, 'UntiringPhysPreventedRegen', 'BASE', 1.5, src);
  }

  // --- PoE 1 Slayer ---
  if (nodes.has('overwhelm')) {
    addMod(db, 'WeaponBaseCritChance', 'OVERRIDE', 8, 'Ascendancy: Overwhelm', ModFlag.Attack);
  }

  if (nodes.has('bane of legends') && isBossOrUniqueContext(config)) {
    addMod(db, 'Damage', 'MORE', 20, 'Ascendancy: Bane of Legends');
  }

  if (nodes.has('headsman')) {
    const src = 'Ascendancy: Headsman';
    addMod(db, 'CullingStrikeThreshold', 'BASE', 20, src);
    if (isBossOrUniqueContext(config) || config?.conditionLowLife) {
      addMod(db, 'Damage', 'MORE', 20, src);
    }
  }

  // --- PoE 1 Assassin ---
  if (nodes.has('opportunistic')) {
    const src = 'Ascendancy: Opportunistic';
    addMod(db, 'Damage', 'MORE', 25, src);
    addMod(db, 'CannotTakeReflectedDamage', 'FLAG', true, src);
  }

  if (nodes.has('for the jugular')) {
    const src = 'Ascendancy: For the Jugular';
    if (config?.conditionLowLife) {
      addMod(db, 'CritChance', 'MORE', 100, src);
    } else {
      addMod(db, 'CritMultiplier', 'BASE', 100, src);
    }
    addMod(db, 'CritCullingStrike', 'FLAG', true, src);
  }

  if (nodes.has('unstable infusion')) {
    if (!hasSourceMod(db, 'MaxPowerCharges', 'unstable infusion')) {
      addMod(db, 'MaxPowerCharges', 'BASE', 1, 'Ascendancy: Unstable Infusion');
    }
  }

  // --- PoE 1 Elementalist ---
  if (nodes.has('shaper of flames')) {
    const src = 'Ascendancy: Shaper of Flames';
    addMod(db, 'IgniteDamage', 'MORE', 25, src, ModFlag.Ailment | ModFlag.Dot, KeywordFlag.Ignite);
    addMod(db, 'IgniteChance', 'BASE', 100, src);
    addMod(db, 'AllDamageCanIgnite', 'FLAG', true, src);
  }

  if (nodes.has('mastermind of discord')) {
    if (!hasSourceMod(db, 'ExtraExposure', 'mastermind of discord')) {
      addMod(db, 'ExtraExposure', 'BASE', 25, 'Ascendancy: Mastermind of Discord');
    }
  }

  if (nodes.has('heart of destruction') && isBossOrUniqueContext(config)) {
    addMod(db, 'ElementalDamage', 'MORE', 30, 'Ascendancy: Heart of Destruction');
  }

  if (nodes.has('liege of the primordial')) {
    const src = 'Ascendancy: Liege of the Primordial';
    addMod(db, 'MaxGolems', 'BASE', 2, src);
    addMod(db, 'GolemBuffEffect', 'INC', 100, src);
    if (activeGolemCount > 0) {
      addMod(db, 'GolemBuffEffect', 'INC', activeGolemCount * 25, src);
    }
  }

  // --- PoE 1 Necromancer ---
  if (nodes.has('commander of darkness')) {
    const src = 'Ascendancy: Commander of Darkness';
    addMod(db, 'FireResist', 'BASE', 30, src);
    addMod(db, 'ColdResist', 'BASE', 30, src);
    addMod(db, 'LightningResist', 'BASE', 30, src);
    addMod(db, 'Damage', 'INC', 30, src);
    addMod(db, 'MinionDamage', 'INC', 30, src);
    if (activeAuraCount > 0) {
      const speedBonus = activeAuraCount * 3;
      addMod(db, 'Speed', 'INC', speedBonus, src, ModFlag.Attack);
      addMod(db, 'Speed', 'INC', speedBonus, src, ModFlag.Spell);
      addMod(db, 'MinionSpeed', 'INC', speedBonus, src);
    }
  }

  if (nodes.has('unnatural strength')) {
    const src = 'Ascendancy: Unnatural Strength';
    if (!hasSourceMod(db, 'GemLevel:minion', 'unnatural strength')) {
      addMod(db, 'GemLevel:minion', 'BASE', 2, src);
    }
    addMod(db, 'MinionUnholyMight', 'FLAG', true, src);
  }

  if (nodes.has('mindless aggression')) {
    const src = 'Ascendancy: Mindless Aggression';
    if (!hasSourceMod(db, 'MinionDamage', 'mindless aggression')) {
      addMod(db, 'MinionDamage', 'MORE', 10, src);
    }
    if (!hasSourceMod(db, 'MinionLife', 'mindless aggression')) {
      addMod(db, 'MinionLife', 'MORE', 20, src);
    }
  }

  // --- PoE 1 Deadeye ---
  if (nodes.has('gathering winds')) {
    const src = 'Ascendancy: Gathering Winds';
    addMod(db, 'HasTailwind', 'FLAG', true, src);
    if (!config?.buffTailwind) {
      addMod(db, 'ActionSpeed', 'INC', 8, src);
      addMod(db, 'Speed', 'MORE', 8, src, ModFlag.Attack);
      addMod(db, 'Speed', 'MORE', 8, src, ModFlag.Spell);
      addMod(db, 'MovementSpeed', 'MORE', 8, src);
    }
  }

  if (nodes.has('far shot')) {
    addMod(db, 'Damage', 'MORE', 30, 'Ascendancy: Far Shot', ModFlag.Projectile);
  }

  // --- PoE 1 Champion ---
  if (nodes.has('fortitude')) {
    const src = 'Ascendancy: Fortitude';
    addMod(db, 'Fortification', 'BASE', 20, src);
    addMod(db, 'AlwaysFortified', 'FLAG', true, src);
  }

  if (nodes.has('inspirational')) {
    if (!hasSourceMod(db, 'AuraEffect', 'inspirational')) {
      addMod(db, 'AuraEffect', 'INC', 30, 'Ascendancy: Inspirational');
    }
  }

  // --- PoE 1 Inquisitor ---
  if (nodes.has('inevitable judgement')) {
    const src = 'Ascendancy: Inevitable Judgement';
    addMod(db, 'CritIgnoresEleRes', 'FLAG', true, src);
    if (!hasSourceMod(db, 'NonCritElePen', 'inevitable judgement')) {
      addMod(db, 'NonCritElePen', 'BASE', 10, src);
    }
  }

  if (nodes.has('pious path')) {
    const src = 'Ascendancy: Pious Path';
    addMod(db, 'ConsecratedGroundEsRegen', 'FLAG', true, src);
    addMod(db, 'ConsecratedGroundEffect', 'INC', 50, src);
  }

  if (nodes.has('augury of penitence')) {
    const src = 'Ascendancy: Augury of Penitence';
    addMod(db, 'EnemyElementalDamageTaken', 'INC', 16, src);
    addMod(db, 'EnemyDamageDealt', 'MORE', -8, src);
  }

  // --- PoE 1 Trickster ---
  if (nodes.has('one step ahead')) {
    const src = 'Ascendancy: One Step Ahead';
    addMod(db, 'ActionSpeed', 'INC', 8, src);
    addMod(db, 'Speed', 'MORE', 8, src, ModFlag.Attack);
    addMod(db, 'Speed', 'MORE', 8, src, ModFlag.Spell);
    addMod(db, 'MovementSpeed', 'MORE', 8, src);
  }

  const polymath = nodes.get('polymath');
  if (polymath) {
    const src = 'Ascendancy: Polymath';
    const perMastery = extractNumberFromStats(polymath.stats, /(\d+)% more Damage for each different type of Mastery/i, 3);
    if (db.sum('BASE', 'MoreDamagePerMastery') === 0) {
      addMod(db, 'MoreDamagePerMastery', 'BASE', perMastery, src);
    }
    if (masteryCount > 0 && !hasSourceMod(db, 'Damage', 'polymath')) {
      addMod(db, 'Damage', 'MORE', masteryCount * perMastery, src);
    }
  }

  if (nodes.has('spellbreaker')) {
    const src = 'Ascendancy: Spellbreaker';
    addMod(db, 'SpellSuppressionChance', 'BASE', 20, src);
    addMod(db, 'SpellSuppressionEffect', 'BASE', 20, src);
  }

  // --- PoE 1 Gladiator ---
  if (nodes.has('more than skill')) {
    const src = 'Ascendancy: More Than Skill';
    addMod(db, 'BlockChanceIsLucky', 'FLAG', true, src);
    addMod(db, 'SpellBlockChanceIsLucky', 'FLAG', true, src);
  }

  if (nodes.has('jagged technique')) {
    const src = 'Ascendancy: Jagged Technique';
    addMod(db, 'AggravatedBleeding', 'FLAG', true, src);
    addMod(db, 'Damage', 'MORE', 100, src, ModFlag.Ailment | ModFlag.Dot, KeywordFlag.Bleed);
  }

  // --- PoE 1 Pathfinder ---
  if (nodes.has("nature's boon")) {
    addMod(db, 'FlaskEffect', 'INC', 30, "Ascendancy: Nature's Boon");
  }

  if (nodes.has('master toxicist')) {
    const src = 'Ascendancy: Master Toxicist';
    addMod(db, 'PoisonProliferation', 'FLAG', true, src);
    addMod(db, 'Damage', 'MORE', 20, src, ModFlag.Ailment | ModFlag.Dot, KeywordFlag.Poison);
  }
}

/**
 * Applies post-Life / post-Attribute ascendancy mechanics that depend on evaluated
 * Attributes, Maximum Life, Maximum Mana, Accuracy, Evasion, Resistances, or Charge caps.
 */
export function applyPostLifeAscendancyMechanics(input: AscendancyPostLifeContext): void {
  const { game, db, allocatedNodes, str, dex, int, maxLife, maxMana } = input;
  const nodes = indexNodesByName(allocatedNodes);

  if (game === 'poe2') {
    applyPoe2PostLifeAscendancies(input, nodes, str, dex, int, maxLife, maxMana);
  } else {
    applyPoe1PostLifeAscendancies(input, nodes, str);
  }
}

function applyBeidatNotable(
  db: ModDB,
  node: PassiveNode,
  maxLife: number,
  defaultStat: 'Mana' | 'EnergyShield' | 'Spirit',
  defaultDivisor: number,
  sourceName: string,
): void {
  addMod(db, 'LifeReservedPct', 'BASE', 25, sourceName);
  let targetStat: 'Mana' | 'EnergyShield' | 'Spirit' = defaultStat;
  let divisor = defaultDivisor;

  for (const line of node.stats ?? []) {
    const match = line.match(/\+1 to (?:Maximum )?(Energy Shield|Mana|Spirit) per (\d+) Maximum Life/i);
    if (match && match[1] && match[2]) {
      const statToken = match[1].toLowerCase();
      if (statToken === 'energy shield') targetStat = 'EnergyShield';
      else if (statToken === 'mana') targetStat = 'Mana';
      else if (statToken === 'spirit') targetStat = 'Spirit';
      const parsedDivisor = Number(match[2]);
      if (Number.isFinite(parsedDivisor) && parsedDivisor > 0) divisor = parsedDivisor;
      break;
    }
  }

  const bonus = Math.floor(Math.max(0, maxLife) / divisor);
  if (bonus > 0) {
    addMod(db, targetStat, 'BASE', bonus, sourceName);
  }
}

function applyPoe2PostLifeAscendancies(
  input: AscendancyPostLifeContext,
  nodes: Map<string, PassiveNode>,
  str: number,
  dex: number,
  int: number,
  maxLife: number,
  maxMana: number,
): void {
  const { db } = input;

  // --- Blood Mage: Gore Spike ---
  const goreSpike = nodes.get('gore spike');
  if (goreSpike && maxLife > 0) {
    const divisor = extractNumberFromStats(goreSpike.stats, /per (\d+) (?:current |maximum )?Life/i, 40);
    const critBonus = Math.floor(maxLife / divisor);
    if (critBonus > 0) {
      addMod(db, 'CritMultiplier', 'BASE', critBonus, 'Ascendancy: Gore Spike');
    }
  }

  // --- Infernalist: Beidat's Hand / Will / Gaze ---
  const beidatHand = nodes.get("beidat's hand");
  if (beidatHand) {
    applyBeidatNotable(db, beidatHand, maxLife, 'Mana', 8, "Ascendancy: Beidat's Hand");
  }

  const beidatWill = nodes.get("beidat's will");
  if (beidatWill) {
    applyBeidatNotable(db, beidatWill, maxLife, 'Spirit', 25, "Ascendancy: Beidat's Will");
  }

  const beidatGaze = nodes.get("beidat's gaze");
  if (beidatGaze) {
    applyBeidatNotable(db, beidatGaze, maxLife, 'EnergyShield', 8, "Ascendancy: Beidat's Gaze");
  }

  // --- Invoker: ...and Protect me from Harm (Evasion -> Armour PDR equivalence) ---
  if (nodes.has('...and protect me from harm')) {
    const eva = Math.max(0, Math.round(input.evasion ?? db.calcStat('Evasion').total));
    if (eva > 0) {
      addMod(db, 'ArmourEquivFromEvasion', 'BASE', eva, 'Ascendancy: ...and Protect me from Harm');
    }
  }

  // --- Stormweaver: Force of Will (+1% Arcane Surge effect per 15 Max Mana) ---
  if (nodes.has('force of will') && maxMana > 0) {
    const arcaneSurgeEffect = Math.floor(maxMana / 15);
    if (arcaneSurgeEffect > 0) {
      addMod(db, 'ArcaneSurgeEffect', 'INC', arcaneSurgeEffect, 'Ascendancy: Force of Will');
    }
  }

  // --- Lich: Soulless Form (Mana regen = 6% of Max Life per second) ---
  const soullessForm = nodes.get('soulless form');
  if (soullessForm && maxLife > 0) {
    const pct = extractNumberFromStats(soullessForm.stats, /equal to (\d+(?:\.\d+)?)% of maximum Life/i, 6);
    const manaRegenBase = Math.round(maxLife * (pct / 100) * 10) / 10;
    if (manaRegenBase > 0) {
      addMod(db, 'ManaRegen', 'BASE', manaRegenBase, 'Ascendancy: Soulless Form');
    }
  }

  // --- Gemling Legionnaire: Enhanced Effectiveness (Double inherent attribute bonuses) ---
  // PoE 2 base inherent bonuses: Str 2 Life/pt, Dex 5 Acc/pt, Int 2 Mana/pt -> doubled to 4 / 10 / 4.
  if (nodes.has('enhanced effectiveness')) {
    const src = 'Ascendancy: Enhanced Effectiveness';
    if (str > 0) {
      addMod(db, 'Life', 'BASE', Math.floor(str * 2), src);
    }
    if (dex > 0) {
      addMod(db, 'Accuracy', 'BASE', Math.floor(dex * 5), src);
    }
    if (int > 0) {
      addMod(db, 'Mana', 'BASE', Math.floor(int * 2), src);
    }
  }

  // --- Amazon: Critical Strike (Excess Attack Hit Chance -> Base Crit Chance at 25%) ---
  if (nodes.has('critical strike')) {
    const acc = Math.max(0, input.accuracy ?? db.calcStat('Accuracy').total);
    const enemyEva = Math.max(1, input.config?.enemyEvasion ?? 500);
    const rawHitChance = ((acc * 1.25) / (acc + enemyEva * 0.3)) * 100;
    const excessHit = Math.max(0, rawHitChance - 100);
    const extraBaseCrit = Math.round(excessHit * 0.25 * 100) / 100;
    if (extraBaseCrit > 0) {
      addMod(db, 'BaseCritChance', 'BASE', extraBaseCrit, 'Ascendancy: Critical Strike', ModFlag.Attack);
    }
  }
}

function applyPoe1PostLifeAscendancies(
  input: AscendancyPostLifeContext,
  nodes: Map<string, PassiveNode>,
  str: number,
): void {
  const { db } = input;

  // --- Chieftain: Valako, Storm's Embrace ---
  // Modifiers to Maximum Fire Resistance also apply to Maximum Cold and Lightning Resistances.
  if (nodes.has("valako, storm's embrace")) {
    const src = "Ascendancy: Valako, Storm's Embrace";
    const fireMax = Math.round(db.sum('BASE', 'FireResistMax'));
    const coldMax = Math.round(db.sum('BASE', 'ColdResistMax'));
    const lightMax = Math.round(db.sum('BASE', 'LightningResistMax'));
    if (fireMax > coldMax) {
      addMod(db, 'ColdResistMax', 'BASE', fireMax - coldMax, src);
    }
    if (fireMax > lightMax) {
      addMod(db, 'LightningResistMax', 'BASE', fireMax - lightMax, src);
    }
  }

  // --- Chieftain: Tasalio, Cleansing Water ---
  // Modifiers to Fire Resistance also apply to Cold and Lightning Resistances at 50% of their value.
  if (nodes.has('tasalio, cleansing water')) {
    const src = 'Ascendancy: Tasalio, Cleansing Water';
    const fireSources = db.calcStat('FireResist').sources;
    const coldSources = db.calcStat('ColdResist').sources;
    const lightSources = db.calcStat('LightningResist').sources;

    const hasMatchingSource = (
      list: ReadonlyArray<{ source: string; type: ModType; value: number | string }>,
      source: string,
      value: number,
    ): boolean => list.some((entry) => entry.type === 'BASE' && entry.source === source && entry.value === value);

    let fireOnlyForCold = 0;
    let fireOnlyForLight = 0;
    for (const entry of fireSources) {
      if (entry.type !== 'BASE' || typeof entry.value !== 'number' || entry.value <= 0) continue;
      if (entry.source === 'Campaign Penalty') continue;
      const onCold = hasMatchingSource(coldSources, entry.source, entry.value);
      const onLight = hasMatchingSource(lightSources, entry.source, entry.value);
      if (onCold && onLight) continue; // All-elemental resistance mod: do not double-count
      if (!onCold) fireOnlyForCold += entry.value;
      if (!onLight) fireOnlyForLight += entry.value;
    }

    const coldBonus = Math.floor(fireOnlyForCold * 0.5);
    const lightBonus = Math.floor(fireOnlyForLight * 0.5);
    if (coldBonus > 0) {
      addMod(db, 'ColdResist', 'BASE', coldBonus, src);
    }
    if (lightBonus > 0) {
      addMod(db, 'LightningResist', 'BASE', lightBonus, src);
    }
  }

  // --- Juggernaut: Undeniable ---
  // Gain Accuracy Rating equal to twice your Strength + 1% increased Attack Speed per 150 Accuracy Rating.
  if (nodes.has('undeniable')) {
    const src = 'Ascendancy: Undeniable';
    const strAccBonus = Math.max(0, Math.floor(str * 2));
    if (strAccBonus > 0) {
      addMod(db, 'Accuracy', 'BASE', strAccBonus, src);
    }
    const effectiveAccuracy =
      input.accuracy !== undefined
        ? Math.max(0, input.accuracy + strAccBonus)
        : Math.max(0, db.calcStat('Accuracy').total);
    const attackSpeedInc = Math.floor(effectiveAccuracy / 150);
    if (attackSpeedInc > 0) {
      addMod(db, 'Speed', 'INC', attackSpeedInc, src, ModFlag.Attack);
    }
  }

  // --- Slayer: Masterful Form ---
  // Your Maximum Endurance Charges is equal to your Maximum Frenzy Charges.
  if (nodes.has('masterful form')) {
    const src = 'Ascendancy: Masterful Form';
    const maxFrenzy =
      input.maxFrenzyCharges ??
      Math.max(0, 3 + Math.round(db.sum('BASE', 'MaxFrenzyCharges') + db.sum('BASE', 'FrenzyChargesMax')));
    const maxEndurance =
      input.maxEnduranceCharges ??
      Math.max(0, 3 + Math.round(db.sum('BASE', 'MaxEnduranceCharges') + db.sum('BASE', 'EnduranceChargesMax')));
    const delta = maxFrenzy - maxEndurance;
    if (delta !== 0) {
      addMod(db, 'MaxEnduranceCharges', 'BASE', delta, src);
    }
  }

  // --- Assassin: Deadly Infusion ---
  // +1.5% Base Crit Chance while at maximum Power Charges + 5% Crit Multi per Power Charge.
  if (nodes.has('deadly infusion')) {
    const src = 'Ascendancy: Deadly Infusion';
    const maxPower =
      input.maxPowerCharges ??
      Math.max(0, 3 + Math.round(db.sum('BASE', 'MaxPowerCharges') + db.sum('BASE', 'PowerChargesMax')));
    const activePower =
      input.activePowerCharges ??
      (input.config?.usePowerCharges ? Math.max(0, Math.round(input.config.powerCharges ?? maxPower)) : 0);
    if (activePower > 0) {
      addMod(db, 'CritMultiplier', 'BASE', activePower * 5, src);
      if (activePower >= maxPower) {
        addMod(db, 'BaseCritChance', 'BASE', 1.5, src);
      }
    }
  }
}
