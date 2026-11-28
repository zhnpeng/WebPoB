import {
  KeywordFlag,
  ModFlag,
  type BuildConfig,
  type GameId,
  type ItemRarity,
  type Mod,
  type ModType,
  type PassiveNode,
} from '@webpob/core';
import type { ModDB } from './modDb.js';
import { parseModLines } from './modParser.js';

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
  /** Rarity of Equipped Body Armour (for PoE 2 Smith of Kitava Normal Body Armour grants). */
  bodyArmourRarity?: ItemRarity;
  /** Number of allocated notables connected to Smith's Masterwork (if applicable). */
  connectedNotableCount?: number;
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
  { game: 'poe2', ascendancy: 'Smith of Kitava', name: 'Coal Stoker', phase: 'post-life' },
  { game: 'poe2', ascendancy: 'Smith of Kitava', name: 'Forged in Flame', phase: 'post-life' },
  { game: 'poe2', ascendancy: 'Smith of Kitava', name: "Smith's Masterwork", phase: 'pre' },

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
  { game: 'poe1', ascendancy: 'Gladiator', name: 'War of Attrition', phase: 'pre' },
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

function hasRawSourceMod(db: ModDB, statName: string, sourceSubstring: string): boolean {
  const lower = sourceSubstring.toLowerCase();
  for (const [key, list] of db.entriesByPrefix(statName)) {
    if (key !== statName) continue;
    for (const mod of list) {
      if (mod.source.toLowerCase().includes(lower)) return true;
    }
  }
  return false;
}

function hasRawSourceModMatching(
  db: ModDB,
  statName: string,
  sourceSubstring: string,
  type: ModType,
  value: number,
): boolean {
  const lower = sourceSubstring.toLowerCase();
  for (const [key, list] of db.entriesByPrefix(statName)) {
    if (key !== statName) continue;
    for (const mod of list) {
      if (
        mod.type === type &&
        mod.value === value &&
        mod.source.toLowerCase().includes(lower)
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasPerStatMod(
  db: ModDB,
  statName: string,
  perStat: string,
  sourceSubstring?: string,
): boolean {
  const lower = sourceSubstring?.toLowerCase();
  for (const [key, list] of db.entriesByPrefix(statName)) {
    if (key !== statName) continue;
    for (const mod of list) {
      if (lower && !mod.source.toLowerCase().includes(lower)) continue;
      if (mod.tags?.some((t) => t.type === 'PerStat' && t.stat === perStat)) {
        return true;
      }
    }
  }
  return false;
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
 * Matches upstream PoB 2 `CalcSetup.lua:397` (`not node.isAttribute`): only `+5` attribute choice
 * travel nodes (`Tree: Attribute`) are NOT scaled by Titan `Hulking Form`; dedicated small attribute
 * passives (`Tree: Strength`, `Tree: Dexterity`, `Tree: Intelligence`, e.g. `+8`/`+12`) ARE scaled.
 */
export function scaleSmallPassiveMods(mods: readonly Mod[], multiplier: number): Mod[] {
  if (multiplier === 1) return [...mods];
  const isAttributeTravelNode =
    mods.length > 0 &&
    mods.every(
      (m) =>
        m.type === 'BASE' &&
        (m.name === 'Str' || m.name === 'Dex' || m.name === 'Int') &&
        /^Tree:\s*Attribute$/i.test(m.source ?? ''),
    );
  if (isAttributeTravelNode) return [...mods];
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
    applyPoe2PreStatAscendancies(
      db,
      nodes,
      allocatedNodes,
      bodyEs,
      bodyEva,
      config,
      input.mainSkillSupportColors,
      input.bodyArmourRarity,
      input.connectedNotableCount,
    );
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
  allocatedNodes: readonly PassiveNode[],
  bodyEs: number,
  bodyEva: number,
  config?: Partial<BuildConfig>,
  supportColors?: AscendancySupportColors,
  bodyArmourRarity?: ItemRarity,
  connectedNotableCount?: number,
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
    // PoE 2 Tailwind (CalcSetup.lua:1013-1017): +2% Attack/Cast Speed INC, +1% MoveSpeed INC, +1% DeflectEffect INC, +10% Evasion INC per stack (cap 10).
    // Only inject here for standalone unit tests (config === undefined) or explicit buffTailwind; engine.ts applies multiplierTailwind globally without double-counting.
    const hasEngineStacks = Number(config?.rawInputs?.multiplierTailwind ?? 0) > 0;
    const tailwindStacks =
      config === undefined || (config.buffTailwind === true && !hasEngineStacks) ? 10 : 0;
    if (tailwindStacks > 0) {
      addMod(db, 'Speed', 'INC', 2 * tailwindStacks, src, ModFlag.Attack);
      addMod(db, 'Speed', 'INC', 2 * tailwindStacks, src, ModFlag.Cast);
      addMod(db, 'MovementSpeed', 'INC', tailwindStacks, src);
      addMod(db, 'DeflectEffect', 'INC', tailwindStacks, src);
      addMod(db, 'Evasion', 'INC', tailwindStacks * 10, src);
    }
  }

  if (nodes.has('point blank')) {
    addMod(db, 'PointBlank', 'FLAG', true, 'Ascendancy: Point Blank');
  }

  if (nodes.has('far shot')) {
    addMod(db, 'Damage', 'MORE', 20, 'Ascendancy: Far Shot', ModFlag.Projectile | ModFlag.Hit);
  }

  if (nodes.has('endless munitions')) {
    if (!hasRawSourceMod(db, 'ProjectileCount', 'endless munitions')) {
      addMod(db, 'ProjectileCount', 'BASE', 1, 'Ascendancy: Endless Munitions');
    }
  }

  // --- PoE 2 Pathfinder ---
  if (nodes.has('overwhelming toxicity')) {
    const src = 'Ascendancy: Overwhelming Toxicity';
    addMod(db, 'PoisonCanStack', 'FLAG', true, src);
    addMod(db, 'DoublePoisonStacks', 'FLAG', true, src);
  }

  // --- PoE 2 Invoker ---
  if (nodes.has('sunder my enemies...')) {
    addMod(db, 'CritIgnoresNonNegativeEleRes', 'FLAG', true, 'Ascendancy: Sunder my Enemies...');
  }

  // --- PoE 2 Oracle ---
  if (nodes.has('forced outcome')) {
    addMod(db, 'InevitableCriticalHits', 'FLAG', true, 'Ascendancy: Forced Outcome');
  }

  // --- PoE 2 Shaman ---
  if (nodes.has('turning of the seasons')) {
    const src = 'Ascendancy: Turning of the Seasons';
    addMod(db, 'ExposureInPresence', 'FLAG', true, src);
    const eachEle = 10 / 3;
    addMod(db, 'DamageGainAsFire', 'BASE', eachEle, src);
    addMod(db, 'DamageGainAsCold', 'BASE', eachEle, src);
    addMod(db, 'DamageGainAsLightning', 'BASE', eachEle, src);
  }

  // --- PoE 2 Infernalist ---
  if (nodes.has('bringer of flame')) {
    addMod(db, 'AllDamageCanIgnite', 'FLAG', true, 'Ascendancy: Bringer of Flame');
  }

  // --- PoE 2 Stormweaver ---
  if (nodes.has('constant gale')) {
    const src = 'Ascendancy: Constant Gale';
    addMod(db, 'HasArcaneSurge', 'FLAG', true, src);
    addMod(db, 'Condition:AffectedByArcaneSurge', 'FLAG', true, src);
    // PoE 2 Arcane Surge (ConfigOptions.lua:925): 15% INC Cast Speed & 20% INC Mana Regeneration Rate scaled by ArcaneSurgeEffect.
    // Set ArcaneSurgeCastSpeed/ManaRegen MAX so engine.ts evaluates exact PoE 2 values without double-counting;
    // inject directly when config === undefined (standalone unit tests without engine.ts).
    addMod(db, 'ArcaneSurgeCastSpeed', 'MAX', 15, src);
    addMod(db, 'ArcaneSurgeManaRegen', 'MAX', 20, src);
    if (config === undefined) {
      const asEff = Math.max(0, 1 + db.sum('INC', ['ArcaneSurgeEffect', 'BuffEffectOnSelf']) / 100);
      addMod(db, 'Speed', 'INC', 15 * asEff, src, ModFlag.Spell);
      addMod(db, 'ManaRegen', 'INC', 20 * asEff, src);
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
    const src = 'Ascendancy: Eldritch Empowerment';
    addMod(db, 'EldritchEmpowerment', 'FLAG', true, src);
    if (!hasRawSourceMod(db, 'Damage', 'eldritch empowerment')) {
      db.addMod({
        name: 'Damage',
        type: 'MORE',
        value: 30,
        flags: ModFlag.Spell,
        keywordFlags: 0,
        source: src,
        tags: [{ type: 'Condition', var: 'EldritchEmpowermentSacrifice' }],
      });
    }
  }

  if (nodes.has('price of power')) {
    addMod(db, 'PriceOfPowerSpellMore', 'BASE', 40, 'Ascendancy: Price of Power');
  }

  if (nodes.has('necromantic conduit')) {
    const src = 'Ascendancy: Necromantic Conduit';
    addMod(db, 'Poe2UnholyMight', 'FLAG', true, src);
    addMod(db, 'MinionUnholyMight', 'FLAG', true, src);
  }

  // --- PoE 2 Gemling Legionnaire ---
  if (nodes.has('enhanced effectiveness')) {
    const src = 'Ascendancy: Enhanced Effectiveness';
    addMod(db, 'DoubleAttributeBonuses', 'FLAG', true, src);
  }

  if (nodes.has('advanced thaumaturgy')) {
    addMod(db, 'GemlingQuality', 'FLAG', true, 'Ascendancy: Advanced Thaumaturgy');
  }

  if (nodes.has('adaptive capability')) {
    addMod(
      db,
      'GemAttributeRequirementsSatisfiedByHighestAttribute',
      'FLAG',
      true,
      'Ascendancy: Adaptive Capability',
    );
  }

  if (nodes.has('crystalline potential')) {
    const src = 'Ascendancy: Crystalline Potential';
    if (!hasRawSourceMod(db, 'GemQuality:all', 'crystalline potential')) {
      addMod(db, 'GemQuality:all', 'BASE', 10, src);
    }
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

  if (nodes.has('penetrate')) {
    addMod(db, 'AmazonPenetrateWeaponAccPct', 'BASE', 25, 'Ascendancy: Penetrate');
  }

  if (nodes.has('predatory instinct') && Boolean(config?.rawInputs?.conditionEnemyOpenWeakness)) {
    addMod(db, 'Damage', 'MORE', 50, 'Ascendancy: Predatory Instinct');
  }

  if (nodes.has('stalking panther')) {
    addMod(db, 'StalkingPanther', 'FLAG', true, 'Ascendancy: Stalking Panther');
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

  // --- PoE 2 Disciple of Varashta ---
  if (nodes.has('instruments of power')) {
    if (!hasRawSourceMod(db, 'EffectOfBonusesFromFocus', 'instruments of power')) {
      addMod(db, 'EffectOfBonusesFromFocus', 'INC', -50, 'Ascendancy: Instruments of Power');
    }
  }

  // --- PoE 2 Smith of Kitava ---
  if (nodes.has("smith's masterwork") && (connectedNotableCount ?? 0) > 0) {
    addMod(
      db,
      'Armour',
      'BASE',
      (connectedNotableCount ?? 0) * 200,
      "Ascendancy: Smith's Masterwork",
    );
  }

  if (bodyArmourRarity === 'NORMAL') {
    for (const node of allocatedNodes) {
      if (!node?.stats || node.stats.length === 0) continue;
      const src = `Ascendancy: ${node.name?.en ?? 'Smith of Kitava'}`;
      for (const rawLine of node.stats) {
        const mGrant = rawLine.trim().match(/^Body Armour grants\s+(.+)$/i);
        if (!mGrant) continue;
        const inner = mGrant[1]!.trim();
        const mArmApply = inner.match(
          /^\+?(\d+)% of Armour also applies to (Elemental|Fire|Cold|Lightning|Chaos) Damage$/i,
        );
        if (mArmApply) {
          const val = Number(mArmApply[1]);
          const kind = mArmApply[2]!.toLowerCase();
          if (kind === 'elemental') addMod(db, 'ArmourAppliesToEle', 'BASE', val, src);
          else if (kind === 'chaos') addMod(db, 'ArmourAppliesToChaos', 'BASE', val, src);
          else addMod(db, `ArmourAppliesTo${mArmApply[2]}`, 'BASE', val, src);
          continue;
        }
        const mArmFull = inner.match(
          /^Armour also applies to (Elemental|Fire|Cold|Lightning|Chaos) Damage taken from Hits$/i,
        );
        if (mArmFull) {
          const kind = mArmFull[1]!.toLowerCase();
          if (kind === 'elemental') addMod(db, 'ArmourAppliesToEle', 'BASE', 100, src);
          else if (kind === 'chaos') addMod(db, 'ArmourAppliesToChaos', 'BASE', 100, src);
          continue;
        }
        const normalizedInner = inner.replace(/^regenerate\b/i, 'Regenerate');
        const parsed = parseModLines([normalizedInner], src);
        if (parsed.length > 0) {
          db.addMods(parsed);
        }
      }
    }
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

  // Expose Condition:Adrenaline when config buffAdrenaline is active so on-kill Adrenaline items (e.g. Death Rush) never double-count
  if (config?.rawInputs?.buffAdrenaline && !db.flag('Condition:Adrenaline')) {
    addMod(db, 'Condition:Adrenaline', 'FLAG', true, 'Adrenaline');
  }

  // --- PoE 1 Slayer ---
  if (nodes.has('overwhelm')) {
    addMod(db, 'WeaponBaseCritChance', 'OVERRIDE', 8, 'Ascendancy: Overwhelm', ModFlag.Attack);
  }

  // Bane of Legends: 20% more Damage with Hits and Ailments against Unique Enemies (deduplicated against parsed tree stat)
  if (
    nodes.has('bane of legends') &&
    isBossOrUniqueContext(config) &&
    !hasRawSourceModMatching(db, 'Damage', 'bane of legends', 'MORE', 20)
  ) {
    addMod(db, 'Damage', 'MORE', 20, 'Ascendancy: Bane of Legends');
  }

  // Impact: Deal up to 15% more Melee Damage to Enemies, based on proximity (deduplicated against parsed tree stat)
  if (nodes.has('impact') && !hasRawSourceMod(db, 'Damage', 'impact')) {
    const src = 'Ascendancy: Impact';
    if (config === undefined) {
      addMod(db, 'Damage', 'MORE', 15, src, ModFlag.Attack | ModFlag.Melee);
    } else {
      db.addMod({
        name: 'Damage',
        type: 'MORE',
        value: 15,
        flags: ModFlag.Attack | ModFlag.Melee,
        keywordFlags: 0,
        source: src,
        tags: [{ type: 'Condition', var: 'MeleeProximity' }],
      });
    }
  }

  // Headsman (PoE 1 3.25+): 20% Culling Strike (no longer grants 20% more Damage)
  if (nodes.has('headsman')) {
    const src = 'Ascendancy: Headsman';
    addMod(db, 'CullingStrikeThreshold', 'BASE', 20, src);
  }

  // --- PoE 1 Assassin ---
  if (nodes.has('opportunistic')) {
    const src = 'Ascendancy: Opportunistic';
    if (!hasRawSourceMod(db, 'Damage', 'opportunistic')) {
      if (config === undefined) {
        addMod(db, 'Damage', 'MORE', 25, src);
      } else {
        db.addMod({
          name: 'Damage',
          type: 'MORE',
          value: 25,
          flags: 0,
          keywordFlags: 0,
          source: src,
          tags: [{ type: 'Condition', var: 'TwoRareOrUniqueNearby', neg: true }],
        });
      }
    }
    if (!hasRawSourceMod(db, 'CannotTakeReflectedDamage', 'opportunistic')) {
      addMod(db, 'CannotTakeReflectedDamage', 'FLAG', true, src);
    }
  }

  const toxicDelivery = nodes.get('toxic delivery');
  if (toxicDelivery) {
    const src = 'Ascendancy: Toxic Delivery';
    if (!hasRawSourceMod(db, 'ToxicDeliveryPoisonDurCap', 'toxic delivery')) {
      const joined = (toxicDelivery.stats ?? []).join(' ').replace(/\s+/g, ' ');
      const cap = extractNumberFromStats([joined], /up to (?:a maximum of )?(\d+)%/i, 100);
      addMod(db, 'ToxicDeliveryPoisonDurCap', 'BASE', cap, src);
    }
  }

  if (nodes.has('for the jugular')) {
    const src = 'Ascendancy: For the Jugular';
    const enemyLowLife = Boolean(config?.rawInputs?.conditionEnemyLowLife);
    if (!hasRawSourceMod(db, 'CritChance', 'for the jugular')) {
      if (config === undefined) {
        if (enemyLowLife) {
          addMod(db, 'CritChance', 'MORE', 100, src);
        }
      } else {
        db.addMod({
          name: 'CritChance',
          type: 'MORE',
          value: 100,
          flags: 0,
          keywordFlags: 0,
          source: src,
          tags: [{ type: 'Condition', var: 'EnemyLowLife' }],
        });
      }
    }
    if (!hasRawSourceMod(db, 'CritMultiplier', 'for the jugular')) {
      if (config === undefined) {
        if (!enemyLowLife) {
          addMod(db, 'CritMultiplier', 'BASE', 100, src);
        }
      } else {
        db.addMod({
          name: 'CritMultiplier',
          type: 'BASE',
          value: 100,
          flags: 0,
          keywordFlags: 0,
          source: src,
          tags: [{ type: 'Condition', var: 'EnemyLowLife', neg: true }],
        });
      }
    }
    if (!hasRawSourceMod(db, 'CritCullingStrike', 'for the jugular')) {
      addMod(db, 'CritCullingStrike', 'FLAG', true, src);
    }
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

  const liegeNode = nodes.get('liege of the primordial');
  if (liegeNode) {
    const src = 'Ascendancy: Liege of the Primordial';
    if (!hasRawSourceMod(db, 'MaxGolems', 'liege of the primordial')) {
      addMod(db, 'MaxGolems', 'BASE', 2, src);
    }
    const liegeStats = liegeNode.stats ?? [];
    // PoE 1 3.28+ removed GolemBuffEffect from Liege of the Primordial (0%);
    // 3.27 had 50% flat; <=3.26 had 100% flat + 25% per active golem.
    const hasFlatGolemBuff =
      liegeStats.length === 0 ||
      liegeStats.some((s) => /increased effect of buffs granted by your golems/i.test(s));
    if (hasFlatGolemBuff && !hasRawSourceMod(db, 'GolemBuffEffect', 'liege of the primordial')) {
      const flatPct = extractNumberFromStats(
        liegeStats,
        /(\d+)% increased effect of buffs granted by your golems(?:\s|$)/i,
        100,
      );
      if (flatPct > 0) {
        addMod(db, 'GolemBuffEffect', 'INC', flatPct, src);
      }
      const hasPerGolemBuff =
        liegeStats.length === 0 ||
        liegeStats.some((s) => /effect of buffs granted by your golems for each summoned golem/i.test(s));
      if (hasPerGolemBuff && activeGolemCount > 0) {
        const perGolemPct = extractNumberFromStats(
          liegeStats,
          /(\d+)% increased effect of buffs granted by your golems for each summoned golem/i,
          25,
        );
        if (perGolemPct > 0) {
          addMod(db, 'GolemBuffEffect', 'INC', activeGolemCount * perGolemPct, src);
        }
      }
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
    // PoE 1 3.24+ Unholy Might: 100% of Physical Damage Converted to Chaos Damage for Minions
    if (!hasRawSourceMod(db, 'PhysicalDamageConvertToChaos', 'unnatural strength')) {
      db.addMod({
        name: 'PhysicalDamageConvertToChaos',
        type: 'BASE',
        value: 100,
        flags: 0,
        keywordFlags: 0,
        source: src,
        target: 'minion',
      });
    }
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

  // --- PoE 1 Deadeye (and Ascendant Deadeye Tailwind) ---
  if (nodes.has('gathering winds')) {
    const src = 'Ascendancy: Gathering Winds';
    addMod(db, 'HasTailwind', 'FLAG', true, src);
    if (!db.flag('Condition:Tailwind')) {
      addMod(db, 'Condition:Tailwind', 'FLAG', true, src);
    }
    if (config === undefined) {
      // Standalone unit tests without BuildConfig keep base 8% Action Speed / Movement Speed;
      // real builds evaluate Tailwind + Gale Force once in engine.ts via Condition:Tailwind without double-counting.
      addMod(db, 'ActionSpeed', 'INC', 8, src);
      addMod(db, 'MovementSpeed', 'MORE', 8, src);
    }
  }

  const ascendantDeadeye = nodes.get('deadeye');
  if (
    ascendantDeadeye &&
    (ascendantDeadeye.stats ?? []).some((s) => /you and nearby allies have tailwind/i.test(s))
  ) {
    const src = 'Ascendancy: Deadeye';
    addMod(db, 'HasTailwind', 'FLAG', true, src);
    if (!db.flag('Condition:Tailwind')) {
      addMod(db, 'Condition:Tailwind', 'FLAG', true, src);
    }
  }

  const farShotNode = nodes.get('far shot');
  if (farShotNode) {
    const src = 'Ascendancy: Far Shot';
    if (!db.flag('FarShot')) {
      addMod(db, 'FarShot', 'FLAG', true, src);
    }
    if (config === undefined) {
      // Standalone unit tests without BuildConfig keep max Far Shot bonus (30% MORE);
      // real builds evaluate PoB1 distance ramp in engine.ts via the FarShot flag.
      const joinedStats = (farShotNode.stats ?? []).join(' ');
      const maxMore = extractNumberFromStats(
        [...(farShotNode.stats ?? []), joinedStats],
        /dealing up\s+to (\d+)% more Damage/i,
        30,
      );
      addMod(db, 'Damage', 'MORE', maxMore, src, ModFlag.Projectile);
    }
  }

  if (nodes.has('focal point')) {
    if (!hasRawSourceMod(db, 'MarkEffect', 'focal point')) {
      addMod(db, 'MarkEffect', 'INC', 75, 'Ascendancy: Focal Point');
    }
  }

  if (nodes.has('endless munitions')) {
    if (!hasRawSourceMod(db, 'ProjectileCount', 'endless munitions')) {
      addMod(db, 'ProjectileCount', 'BASE', 2, 'Ascendancy: Endless Munitions');
    }
  }

  // --- PoE 1 Ascendant Necromancer (Tree:10099 wraps "Cast\nSpeed" across lines) ---
  const ascendantNecro = nodes.get('necromancer');
  if (ascendantNecro && (ascendantNecro.stats?.length ?? 0) > 0) {
    const joinedNecroStats = ascendantNecro.stats.join(' ').replace(/\s+/g, ' ');
    const auraSpeedMatch = joinedNecroStats.match(
      /Auras from your Skills grant (\d+)% increased Attack and Cast Speed to you and Allies/i,
    );
    if (auraSpeedMatch && !hasRawSourceMod(db, 'Speed', 'necromancer')) {
      const val = Number(auraSpeedMatch[1]);
      const tags = [{ type: 'Multiplier' as const, var: 'AuraAffectingSelf' }];
      db.addMod({
        name: 'Speed',
        type: 'INC',
        value: val,
        flags: ModFlag.Attack,
        keywordFlags: 0,
        source: 'Ascendancy: Necromancer',
        tags,
      });
      db.addMod({
        name: 'Speed',
        type: 'INC',
        value: val,
        flags: ModFlag.Spell,
        keywordFlags: 0,
        source: 'Ascendancy: Necromancer',
        tags,
      });
    }
  }

  // --- PoE 1 Champion ---
  if (nodes.has('fortitude')) {
    const src = 'Ascendancy: Fortitude';
    addMod(db, 'Fortification', 'BASE', 20, src);
    addMod(db, 'AlwaysFortified', 'FLAG', true, src);
    addMod(db, 'Condition:Fortified', 'FLAG', true, src);
    addMod(db, 'Condition:HaveMaximumFortification', 'FLAG', true, src);
  }

  const hasFortAbove20Node =
    nodes.has('unstoppable hero') ||
    Array.from(nodes.values()).some((n) => (n.stats ?? []).some((s) => /per Fortification above 20/i.test(s)));
  if (hasFortAbove20Node) {
    addMod(db, 'UnstoppableHero', 'FLAG', true, 'Ascendancy: Unstoppable Hero');
  }

  if (nodes.has('first to strike, last to fall')) {
    const src = 'Ascendancy: First to Strike, Last to Fall';
    // PoB 1 CalcPerform.lua:790-796: Adrenaline buff (100% INC Damage, 25% INC Attack/Cast/Move Speed, 10% PDR).
    // engine.ts injects Adrenaline for rawInputs.buffAdrenaline; handle conditionAdrenaline here without double-counting.
    if (config?.rawInputs?.conditionAdrenaline && !config?.rawInputs?.buffAdrenaline) {
      const effectMod = Math.max(0, 1 + db.sum('INC', 'BuffEffectOnSelf') / 100);
      addMod(db, 'Condition:Adrenaline', 'FLAG', true, src);
      addMod(db, 'Damage', 'INC', Math.floor(100 * effectMod), src);
      addMod(db, 'Speed', 'INC', Math.floor(25 * effectMod), src, ModFlag.Attack);
      addMod(db, 'Speed', 'INC', Math.floor(25 * effectMod), src, ModFlag.Spell);
      addMod(db, 'MovementSpeed', 'INC', Math.floor(25 * effectMod), src);
      addMod(db, 'PhysDamageReduction', 'BASE', Math.floor(10 * effectMod), src);
    }
    if (
      (config?.rawInputs?.conditionChampionIntimidate || config?.rawInputs?.conditionEnemyFullLife) &&
      !config?.enemyIntimidated
    ) {
      addMod(db, 'EnemyDamageTaken', 'INC', 10, `${src} (Intimidate)`, ModFlag.Attack);
    }
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
    if (!hasRawSourceMod(db, 'EnemyElementalDamageTaken', 'augury of penitence')) {
      addMod(db, 'EnemyElementalDamageTaken', 'INC', 16, src);
    }
    if (
      !hasRawSourceMod(db, 'EnemyElementalDamageDealt', 'augury of penitence') &&
      !hasRawSourceMod(db, 'EnemyDamageDealt', 'augury of penitence')
    ) {
      addMod(db, 'EnemyDamageDealt', 'MORE', -8, src);
    }
  }

  // --- PoE 1 Trickster ---
  if (nodes.has('one step ahead')) {
    const src = 'Ascendancy: One Step Ahead';
    if (!db.flag('OneStepAhead')) {
      addMod(db, 'OneStepAhead', 'FLAG', true, src);
    }
    if (config === undefined) {
      addMod(db, 'ActionSpeed', 'INC', 8, src);
      addMod(db, 'Speed', 'MORE', 8, src, ModFlag.Attack);
      addMod(db, 'Speed', 'MORE', 8, src, ModFlag.Spell);
      addMod(db, 'MovementSpeed', 'MORE', 8, src);
    }
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
    // skillActorRuntime already applies the 3x (210% vs 70%) Aggravated Bleeding rate via AggravatedBleeding;
    // do not inject an extra 100% MORE Bleed Damage mod on top.
    addMod(db, 'AggravatedBleeding', 'FLAG', true, src);
  }

  if (nodes.has('determined survivor')) {
    const src = 'Ascendancy: Determined Survivor';
    if (!hasRawSourceMod(db, 'ShieldBlockOverride', 'determined survivor')) {
      addMod(db, 'ShieldBlockOverride', 'OVERRIDE', 50, src);
    }
    addMod(db, 'DualWieldBonusesDoubled', 'FLAG', true, src);
  }

  if (nodes.has('war of attrition')) {
    const rawPresence = config?.rawInputs?.enemyMultiplierEnemyPresenceSeconds;
    const presenceSeconds = typeof rawPresence === 'number' ? rawPresence : Number(rawPresence);
    if (Number.isFinite(presenceSeconds) && presenceSeconds > 0) {
      db.setMultiplier('PresenceSeconds', presenceSeconds);
    }
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

  // --- PoE 1 Berserker ---
  if (nodes.has('rite of ruin')) {
    if (!hasRawSourceMod(db, 'RageEffect', 'rite of ruin')) {
      addMod(db, 'RageEffect', 'INC', 50, 'Ascendancy: Rite of Ruin');
    }
  }

  if (nodes.has('aspect of carnage')) {
    if (!hasSourceMod(db, 'Damage', 'aspect of carnage')) {
      addMod(db, 'Damage', 'MORE', 40, 'Ascendancy: Aspect of Carnage');
    }
  }

  const craveTheSlaughter = nodes.get('crave the slaughter');
  if (craveTheSlaughter) {
    const ctsStats = craveTheSlaughter.stats ?? [];
    // In PoE 1 3.25+, Crave the Slaughter grants "Every Rage also grants 1% increased Attack Speed" instead of +10 Maximum Rage.
    const grantsMaxRage =
      ctsStats.length === 0 || ctsStats.some((s) => /maximum rage/i.test(s));
    if (grantsMaxRage && !hasRawSourceMod(db, 'MaximumRage', 'crave the slaughter')) {
      addMod(db, 'MaximumRage', 'BASE', 10, 'Ascendancy: Crave the Slaughter');
    }
  }

  // --- PoE 1 Hierophant ---
  if (nodes.has('ritual of awakening')) {
    const src = 'Ascendancy: Ritual of Awakening';
    if (!hasRawSourceMod(db, 'Damage', 'ritual of awakening')) {
      db.addMod({
        name: 'Damage',
        type: 'MORE',
        value: 3,
        flags: 0,
        keywordFlags: 0,
        source: src,
        tags: [{ type: 'Multiplier', var: 'SummonedTotem' }],
      });
    }
  }

  if (nodes.has('arcane blessing')) {
    const src = 'Ascendancy: Arcane Blessing';
    if (!hasRawSourceMod(db, 'ArcaneSurgeDamage', 'arcane blessing')) {
      addMod(db, 'ArcaneSurgeDamage', 'BASE', 20, src);
    }
    if (!db.flag('Condition:ArcaneSurge')) {
      addMod(db, 'Condition:ArcaneSurge', 'FLAG', true, src);
    }
  }

  // --- PoE 1 Warden (Raider): Avatar of the Wilds (Unbound Avatar) ---
  const avatarOfTheWilds = nodes.get('avatar of the wilds') ?? nodes.get('unbound avatar');
  if (avatarOfTheWilds) {
    const src = 'Ascendancy: Avatar of the Wilds';
    const isUnboundActive = Boolean(
      config?.rawInputs?.Unbound ||
        config?.rawInputs?.conditionUnbound ||
        config?.rawInputs?.conditionUnboundAvatar ||
        config?.rawInputs?.buffUnbound ||
        config?.rawInputs?.buffUnboundAvatar,
    );
    if (isUnboundActive) {
      // Mirror PoB 1 ConfigOptions.lua:315 (`Unbound` -> `Condition:Unbound`) so parsed tree lines activate cleanly
      addMod(db, 'Condition:Unbound', 'FLAG', true, src);
    }
    const unboundMore = extractNumberFromStats(
      avatarOfTheWilds.stats,
      /(\d+)% more Elemental Damage while Unbound/i,
      80,
    );
    if (
      !hasRawSourceMod(db, 'ElementalDamage', 'avatar of the wilds') &&
      !hasRawSourceMod(db, 'ElementalDamage', 'unbound avatar')
    ) {
      db.addMod({
        name: 'ElementalDamage',
        type: 'MORE',
        value: unboundMore,
        flags: 0,
        keywordFlags: 0,
        source: src,
        tags: [{ type: 'Condition', var: 'Unbound' }],
      });
    }
  }

  // --- PoE 1 Phrecia Alternate Ascendancies: Aristocrat / Paladin / Whisperer ---
  if (nodes.has('illicit gains') && !hasRawSourceMod(db, 'Str', 'illicit gains')) {
    addMod(db, 'Str', 'INC', 40, 'Ascendancy: Illicit Gains');
  }
  if (nodes.has('private tuition') && !hasRawSourceMod(db, 'Int', 'private tuition')) {
    addMod(db, 'Int', 'INC', 40, 'Ascendancy: Private Tuition');
  }
  if (nodes.has('fancy foil') && !hasRawSourceMod(db, 'Dex', 'fancy foil')) {
    addMod(db, 'Dex', 'INC', 40, 'Ascendancy: Fancy Foil');
  }
  if (nodes.has('family heirlooms') && !hasRawSourceMod(db, 'GemLevel:all', 'family heirlooms')) {
    addMod(db, 'GemLevel:all', 'BASE', 1, 'Ascendancy: Family Heirlooms');
  }
  if (nodes.has('centerpiece') && !hasRawSourceMod(db, 'GemQuality:all', 'centerpiece')) {
    addMod(db, 'GemQuality:all', 'BASE', 20, 'Ascendancy: Centerpiece');
  }
  if (nodes.has('light of divinity') && !hasRawSourceMod(db, 'ElementalDamageTaken', 'light of divinity')) {
    db.addMod({
      name: 'ElementalDamageTaken',
      type: 'INC',
      value: 25,
      flags: 0,
      keywordFlags: 0,
      source: 'Ascendancy: Light of Divinity',
      target: 'enemy',
    });
  }
  if (nodes.has('bring the battle') && !hasRawSourceMod(db, 'DamageTaken', 'bring the battle')) {
    db.addMod({
      name: 'DamageTaken',
      type: 'INC',
      value: 20,
      flags: 0,
      keywordFlags: 0,
      source: 'Ascendancy: Bring the Battle',
      target: 'enemy',
      tags: [{ type: 'Condition', var: 'EnemyTaunted' }],
    });
  }
  if (nodes.has('field medicine') && !hasRawSourceMod(db, 'FlaskEffect', 'field medicine')) {
    addMod(db, 'FlaskEffect', 'INC', 40, 'Ascendancy: Field Medicine');
  }
  if (nodes.has('absolution') && !hasRawSourceMod(db, 'AuraEffect', 'absolution')) {
    db.addMod({
      name: 'AuraEffect',
      type: 'INC',
      value: 40,
      flags: 0,
      keywordFlags: 0,
      source: 'Ascendancy: Absolution',
      tags: [{ type: 'Condition', var: 'HaveLinkedTarget' }],
    });
  }
  if (nodes.has('there is more')) {
    const src = 'Ascendancy: there is more';
    if (!hasRawSourceMod(db, 'MinFrenzyCharges', 'there is more')) {
      addMod(db, 'MinFrenzyCharges', 'BASE', 4, src);
    }
    if (!hasRawSourceMod(db, 'MinPowerCharges', 'there is more')) {
      addMod(db, 'MinPowerCharges', 'BASE', 4, src);
    }
    if (!hasRawSourceMod(db, 'MaxFrenzyCharges', 'there is more')) {
      addMod(db, 'MaxFrenzyCharges', 'BASE', 1, src);
    }
    if (!hasRawSourceMod(db, 'MaxPowerCharges', 'there is more')) {
      addMod(db, 'MaxPowerCharges', 'BASE', 1, src);
    }
  }
  if (nodes.has('an infinite pursuit')) {
    addMod(db, 'NoIntManaBonus', 'FLAG', true, 'Ascendancy: an infinite pursuit');
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
  if (
    goreSpike &&
    maxLife > 0 &&
    !hasRawSourceMod(db, 'CritMultiplier', 'gore spike') &&
    !hasRawSourceMod(db, 'CritDamageBonusInc', 'gore spike') &&
    !hasPerStatMod(db, 'CritDamageBonusInc', 'Life', 'gore spike') &&
    !hasPerStatMod(db, 'CritMultiplier', 'Life', 'gore spike')
  ) {
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

  // --- Stormweaver: Force of Will (+1% Arcane Surge effect per 15 Max Mana, PoE 2 v0.1/v0.2 only) ---
  // In PoE 2 v0.3–v0.5 Force of Will was reworked to "per ten percent missing Mana" (0 at full mana).
  const forceOfWillNode = nodes.get('force of will');
  if (forceOfWillNode && maxMana > 0) {
    const fowStats = forceOfWillNode.stats ?? [];
    const hasPerMaxManaArcaneSurge =
      fowStats.length === 0 ||
      fowStats.some((s) => /arcane surge.*per\s+\d+\s+maximum\s+mana/i.test(s));
    if (hasPerMaxManaArcaneSurge) {
      const perManaDiv = Math.max(
        1,
        extractNumberFromStats(fowStats, /per\s+(\d+)\s+maximum\s+mana/i, 15),
      );
      const arcaneSurgeEffect = Math.floor(maxMana / perManaDiv);
      if (arcaneSurgeEffect > 0) {
        addMod(db, 'ArcaneSurgeEffect', 'INC', arcaneSurgeEffect, 'Ascendancy: Force of Will');
      }
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
  // PoE 2 base inherent bonuses: Str 2 Life/pt (1 with Giant's Blood), Dex 5 Acc/pt, Int 2 Mana/pt -> doubled.
  if (nodes.has('enhanced effectiveness') && !db.flag('NoAttributeBonuses') && !db.flag('SupremeOstentation')) {
    const src = 'Ascendancy: Enhanced Effectiveness';
    if (str > 0 && !db.flag('NoStrLifeBonus')) {
      const strLifePerPt = db.flag('StrLifeHalved') ? 1 : 2;
      addMod(db, 'Life', 'BASE', Math.floor(str * strLifePerPt), src);
    }
    if (dex > 0 && !db.flag('NoDexAccuracyBonus')) {
      addMod(db, 'Accuracy', 'BASE', Math.floor(dex * 5), src);
    }
    if (int > 0 && !db.flag('NoIntManaBonus')) {
      addMod(db, 'Mana', 'BASE', Math.floor(int * 2), src);
    }
  }

  // --- Gemling Legionnaire: Thaumaturgical Infusion ---
  // +1% to Maximum Fire/Lightning/Cold Resistance per 3 Red/Green/Blue Support Gems Socketed
  if (nodes.has('thaumaturgical infusion')) {
    const src = 'Ascendancy: Thaumaturgical Infusion';
    const mults = db.getEvalContext().multipliers;
    const redGems = Math.max(0, mults.StrengthMoteSkillCount ?? 0);
    const greenGems = Math.max(0, mults.DexterityMoteSkillCount ?? 0);
    const blueGems = Math.max(0, mults.IntelligenceMoteSkillCount ?? 0);
    const fireBonus = Math.floor(redGems / 3);
    const lightBonus = Math.floor(greenGems / 3);
    const coldBonus = Math.floor(blueGems / 3);
    if (fireBonus > 0 && !hasRawSourceMod(db, 'FireResistMax', 'thaumaturgical infusion')) {
      addMod(db, 'FireResistMax', 'BASE', fireBonus, src);
    }
    if (lightBonus > 0 && !hasRawSourceMod(db, 'LightningResistMax', 'thaumaturgical infusion')) {
      addMod(db, 'LightningResistMax', 'BASE', lightBonus, src);
    }
    if (coldBonus > 0 && !hasRawSourceMod(db, 'ColdResistMax', 'thaumaturgical infusion')) {
      addMod(db, 'ColdResistMax', 'BASE', coldBonus, src);
    }
  }

  // --- Smith of Kitava: Forged in Flame & Coal Stoker ---
  if (nodes.has('forged in flame')) {
    applyFireMaxResistConversion(db, 'Ascendancy: Forged in Flame');
  }
  if (nodes.has('coal stoker')) {
    applyFireResistHalfConversion(db, 'Ascendancy: Coal Stoker');
  }

  // --- Amazon: Critical Strike (Excess Attack Hit Chance -> Base Crit Chance at 25%) ---
  // Matches upstream PoB 2 CalcDefence.lua:37-38 (`round(rawChance)`) + Blinded 20% less Enemy Evasion.
  if (nodes.has('critical strike')) {
    const acc = Math.max(0, input.accuracy ?? db.calcStat('Accuracy').total);
    let enemyEva = Math.max(1, input.config?.enemyEvasion ?? 500);
    if (
      Boolean(input.config?.rawInputs?.conditionEnemyBlinded) ||
      db.flag('Condition:EnemyBlinded')
    ) {
      enemyEva = Math.max(1, Math.round(enemyEva * 0.8));
    }
    const rawHitChance = Math.round(((acc * 1.25) / (acc + enemyEva * 0.3)) * 100);
    const excessHit = Math.max(0, rawHitChance - 100);
    const extraBaseCrit = Math.round(excessHit * 0.25 * 100) / 100;
    if (extraBaseCrit > 0) {
      addMod(db, 'BaseCritChance', 'BASE', extraBaseCrit, 'Ascendancy: Critical Strike', ModFlag.Attack);
    }
  }
}

function countSourceValuePairs(
  list: ReadonlyArray<{ source: string; type: ModType; value: number | string }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of list) {
    if (entry.type !== 'BASE' || typeof entry.value !== 'number') continue;
    const key = `${entry.source}\0${entry.value}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function applyFireMaxResistConversion(db: ModDB, src: string): void {
  const fireMaxSources = db.calcStat('FireResistMax').sources;
  const coldCounts = countSourceValuePairs(db.calcStat('ColdResistMax').sources);
  const lightCounts = countSourceValuePairs(db.calcStat('LightningResistMax').sources);

  let nonSharedFireMaxMods = 0;
  for (const entry of fireMaxSources) {
    if (entry.type !== 'BASE' || typeof entry.value !== 'number') continue;
    if (entry.source === 'Base') continue;
    const key = `${entry.source}\0${entry.value}`;
    const cRem = coldCounts.get(key) ?? 0;
    const lRem = lightCounts.get(key) ?? 0;
    if (cRem > 0 && lRem > 0) {
      coldCounts.set(key, cRem - 1);
      lightCounts.set(key, lRem - 1);
      continue;
    }
    nonSharedFireMaxMods += entry.value;
  }

  if (nonSharedFireMaxMods !== 0) {
    addMod(db, 'ColdResistMax', 'BASE', nonSharedFireMaxMods, src);
    addMod(db, 'LightningResistMax', 'BASE', nonSharedFireMaxMods, src);
  }
}

function applyFireResistHalfConversion(db: ModDB, src: string): void {
  const fireSources = db.calcStat('FireResist').sources;
  const coldCounts = countSourceValuePairs(db.calcStat('ColdResist').sources);
  const lightCounts = countSourceValuePairs(db.calcStat('LightningResist').sources);

  let nonAllEleFireMods = 0;
  for (const entry of fireSources) {
    if (entry.type !== 'BASE' || typeof entry.value !== 'number') continue;
    if (entry.source === 'Campaign Penalty' || entry.source === 'Base') continue;
    const key = `${entry.source}\0${entry.value}`;
    const cRem = coldCounts.get(key) ?? 0;
    const lRem = lightCounts.get(key) ?? 0;
    if (cRem > 0 && lRem > 0) {
      coldCounts.set(key, cRem - 1);
      lightCounts.set(key, lRem - 1);
      continue;
    }
    nonAllEleFireMods += entry.value;
  }

  const converted = Math.trunc(nonAllEleFireMods * 0.5);
  if (converted !== 0) {
    addMod(db, 'ColdResist', 'BASE', converted, src);
    addMod(db, 'LightningResist', 'BASE', converted, src);
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
    applyFireMaxResistConversion(db, "Ascendancy: Valako, Storm's Embrace");
  }

  // --- Chieftain: Tasalio, Cleansing Water ---
  // Modifiers to Fire Resistance also apply to Cold and Lightning Resistances at 50% of their value.
  if (nodes.has('tasalio, cleansing water')) {
    applyFireResistHalfConversion(db, 'Ascendancy: Tasalio, Cleansing Water');
  }

  // --- Juggernaut: Undeniable ---
  // Gain Accuracy Rating equal to twice your Strength + 1% increased Attack Speed per 150 Accuracy Rating.
  if (nodes.has('undeniable')) {
    const src = 'Ascendancy: Undeniable';
    const strAccBonus = Math.max(0, Math.floor(str * 2));
    if (strAccBonus > 0) {
      addMod(db, 'Accuracy', 'BASE', strAccBonus, src);
    }
    // Deduplicate against parsed tree line `1% increased Attack Speed per 150 Accuracy Rating` (PerStat:Accuracy)
    if (
      !hasRawSourceMod(db, 'Speed', 'undeniable') &&
      !hasPerStatMod(db, 'Speed', 'Accuracy', 'undeniable')
    ) {
      const effectiveAccuracy =
        input.accuracy !== undefined
          ? Math.max(0, input.accuracy + strAccBonus)
          : Math.max(0, db.calcStat('Accuracy').total);
      const attackSpeedInc = Math.floor(effectiveAccuracy / 150);
      if (attackSpeedInc > 0) {
        addMod(db, 'Speed', 'INC', attackSpeedInc, src, ModFlag.Attack);
      }
    }
  }

  // --- Hierophant: Ritual of Awakening ---
  // Default SummonedTotem multiplier to ActiveTotemLimit when TotemsSummoned is not explicitly overridden in config
  if (nodes.has('ritual of awakening')) {
    const curSummoned = db.getEvalContext().multipliers.SummonedTotem;
    if (curSummoned === undefined) {
      const extraTotemLimit = Math.max(0, Math.round(db.sum('BASE', 'ActiveTotemLimit')));
      if (extraTotemLimit > 0) {
        db.setMultiplier('SummonedTotem', 1 + extraTotemLimit);
      }
    }
  }

  // --- Reliquarian: The Scales of Justice ---
  // "4 to 8 added Fire Damage per 100 of Maximum Life or Maximum Mana, whichever is lower"
  const scalesNode = nodes.get('the scales of justice');
  if (scalesNode && !hasRawSourceMod(db, 'FireMin', 'scales of justice')) {
    const lowerPool = Math.max(0, Math.min(input.maxLife, input.maxMana));
    const stacks = Math.floor(lowerPool / 100);
    if (stacks > 0) {
      const joined = (scalesNode.stats ?? []).join(' ').replace(/\s+/g, ' ');
      const mRange = joined.match(/(\d+)\s+to\s+(\d+)\s+added Fire Damage per (\d+)/i);
      const minPer = mRange ? Number(mRange[1]) : 4;
      const maxPer = mRange ? Number(mRange[2]) : 8;
      const div = mRange ? Math.max(1, Number(mRange[3])) : 100;
      const effStacks = Math.floor(lowerPool / div);
      if (effStacks > 0) {
        const src = 'Ascendancy: The Scales of Justice';
        addMod(db, 'FireMin', 'BASE', effStacks * minPer, src);
        addMod(db, 'FireMax', 'BASE', effStacks * maxPer, src);
      }
    }
  }

  // --- Occultist: Vile Bastion ---
  // Maximum Energy Shield is increased by Chance to Block Spell Damage.
  // Note: db.calcStat('SpellBlockChance').total already includes Glancing Blows' MORE 100.
  if (nodes.has('vile bastion') && !hasRawSourceMod(db, 'EnergyShield', 'vile bastion')) {
    const maxSpellBlock = Math.min(90, Math.max(0, 75 + Math.round(db.sum('BASE', 'SpellBlockChanceMax'))));
    const rawSpellBlock = Math.round(db.calcStat('SpellBlockChance').total);
    const effSpellBlock = Math.min(maxSpellBlock, Math.max(0, rawSpellBlock));
    if (effSpellBlock > 0) {
      addMod(db, 'EnergyShield', 'INC', effSpellBlock, 'Ascendancy: Vile Bastion');
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
      if (
        !hasRawSourceMod(db, 'CritMultiPerPowerCharge', 'deadly infusion') &&
        !hasRawSourceMod(db, 'CritMultiplier', 'deadly infusion')
      ) {
        addMod(db, 'CritMultiplier', 'BASE', activePower * 5, src);
      }
      if (activePower >= maxPower && !hasSourceMod(db, 'BaseCritChance', 'deadly infusion')) {
        addMod(db, 'BaseCritChance', 'BASE', 1.5, src);
      }
    }
  }

  // --- Phrecia Aristocrat: Dreadful Attitude (8% increased Damage per 5 of your lowest Attribute) ---
  if (nodes.has('dreadful attitude') && !hasRawSourceMod(db, 'Damage', 'dreadful attitude')) {
    const lowestAttr = Math.max(0, Math.min(input.str, input.dex, input.int));
    const dmgInc = Math.floor(lowestAttr / 5) * 8;
    if (dmgInc > 0) {
      addMod(db, 'Damage', 'INC', dmgInc, 'Ascendancy: Dreadful Attitude');
    }
  }

  // --- Phrecia Whisperer: an infinite pursuit (+1 to Maximum Mana per Dexterity) ---
  if (nodes.has('an infinite pursuit') && input.dex > 0 && !hasRawSourceMod(db, 'Mana', 'an infinite pursuit')) {
    addMod(db, 'Mana', 'BASE', Math.floor(input.dex), 'Ascendancy: an infinite pursuit');
  }

  // --- Phrecia Whisperer: we know all (Attack Skills have Added Lightning Damage equal to 6% of max Mana) ---
  if (nodes.has('we know all') && input.maxMana > 0 && !hasRawSourceMod(db, 'LightningMin', 'we know all')) {
    const addedLight = Math.floor(input.maxMana * 0.06);
    if (addedLight > 0) {
      const src = 'Ascendancy: we know all';
      addMod(db, 'LightningMin', 'BASE', addedLight, src, ModFlag.Attack);
      addMod(db, 'LightningMax', 'BASE', addedLight, src, ModFlag.Attack);
    }
  }
}
