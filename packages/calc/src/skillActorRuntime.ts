import {
  DAMAGE_TYPES,
  KeywordFlag,
  ModFlag,
  type DamageRange,
  type DamageType,
  type GameId,
  type GemDefinition,
  type GemInstance,
  type Mod,
  type ModCondition,
  type ModTag,
  type ModType,
} from '@webpob/core';
import { getRuleset } from '@webpob/data';
import { ModDB } from './modDb.js';
import { computePoe2CritMultiplier } from './offenceUpgrade.js';

// ============================================================================
// Shared Types & Constants
// ============================================================================

export type ActorTarget = 'skill' | 'player' | 'enemy' | 'minion' | 'parent';

/**
 * Pre-compiled modifier produced directly from PoB's `SkillStatMap` / `baseMods`
 * so skill & support runtime injection bypasses English regex parsing completely.
 */
export interface CompiledGemMod {
  name: string;
  type: ModType;
  value: number | boolean | string;
  flags?: number;
  keywordFlags?: number;
  /** Target actor bus (defaults to `'player'` / skill DB). */
  target?: ActorTarget;
  /** PoB `ModTag` predicates/scalers (`Condition`, `Multiplier`, `PerStat`, `SkillType`, `SocketedIn`). */
  tags?: ModTag[];
  /** Optional legacy condition descriptor. */
  condition?: ModCondition;
  /** Optional explicit source attribution override. */
  source?: string;
}

/**
 * Structured PoB `skillData` payload for ailment durations, single-poison overrides,
 * spell/ground DoTs, triggers, and cooldowns.
 */
export interface SkillDataMap {
  /** Base non-ailment DoT DPS per second by damage type (matching PoB `skillData.<Type>Dot`). */
  PhysicalDot?: number;
  FireDot?: number;
  ColdDot?: number;
  LightningDot?: number;
  ChaosDot?: number;
  /** Alternative map form for base non-ailment DoT DPS per second. */
  dotDamageByType?: Partial<Record<DamageType, number>>;
  /** Whether Spell Damage modifiers apply to this skill's non-ailment DoT (e.g. Essence Drain, Vortex, Exsanguinate). */
  spellDmgAppliesToDot?: boolean;
  /** Whether Area Damage modifiers apply to this skill's non-ailment DoT. */
  dotIsArea?: boolean;
  /** Whether Projectile Damage modifiers apply to this skill's non-ailment DoT (e.g. Toxic Rain, Caustic Arrow). */
  dotIsProjectile?: boolean;
  /** Whether the skill's non-ailment DoT stacks across casts/hits (e.g. Toxic Rain pods, Blight, Exsanguinate). */
  dotCanStack?: boolean;
  /** Maximum active stacks for stacking non-ailment DoTs. */
  dotMaxStacks?: number;
  /** Base duration in seconds for non-ailment DoTs (e.g. Toxic Rain pod duration). */
  dotBaseDuration?: number;
  /** Overlapping hits/pods per skill use for stacking non-ailment DoTs. */
  dotHitsPerUse?: number;
  /** Base Poison duration in seconds (default 2.0; e.g. Viper Strike = 4.0). */
  poisonDuration?: number;
  /** Base Bleeding duration in seconds (default 5.0). */
  bleedDuration?: number;
  /** Base Ignite duration in seconds (default 4.0). */
  igniteDuration?: number;
  /** Whether generic Skill Effect `Duration` mods scale this skill's Poison duration (true when skill has Duration tag). */
  durationAppliesToPoison?: boolean;
  /** Single-poison cap flag (e.g. `Viper Strike of the Mamba`: cannot poison already-poisoned enemies). */
  cannotPoisonAlreadyPoisoned?: boolean;
  /** Explicit hard cap on poison stacks for this skill. */
  maxPoisonStacks?: number;
  /** Base trigger cooldown in seconds (e.g. 0.15 for Cast On Critical Strike). */
  cooldown?: number;
  /** Extra opaque PoB `skillData` keys. */
  [key: string]: unknown;
}

/**
 * Extended Lv.20 (or `baseLevel`) Minion combat profile supporting both PoE 1
 * (SRS, Raise Zombie, Summon Skeletons, Spectres) and PoE 2 persistent skeletal minions.
 */
export interface MinionBaseProfile {
  physicalMin: number;
  physicalMax: number;
  /** Optional elemental/chaos base damages (e.g. PoE 2 Skeletal Arsonist Fire, Frost Mage Cold). */
  elementalDamage?: Partial<Record<'Fire' | 'Cold' | 'Lightning' | 'Chaos', [number, number]>>;
  /** Optional full damage map (compatible with `GemDefinition.baseDamage`). */
  baseDamage?: Partial<Record<DamageType, [number, number]>>;
  attacksPerSecond: number;
  /** Optional base cast time in seconds for spell-casting minions. */
  castTime?: number;
  /** Whether the minion's primary damage skill is a Spell instead of an Attack. */
  isSpell?: boolean;
  /** Minion combat ModFlags (defaults to `Attack | Hit | Melee` for attackers, `Spell | Hit` for casters). */
  modFlags?: number;
  /** Minion combat KeywordFlags. */
  keywordFlags?: number;
  /** Added damage effectiveness percentage (default 100). */
  damageEffectivenessPct?: number;
  /** Base critical strike chance percentage (e.g. 5). */
  critChance: number;
  /** Base critical strike multiplier percentage (PoE 1 default 130, PoE 2 e.g. 130 or 200). */
  critMultiplier: number;
  /** Optional inherent more attack speed % (e.g. PoE 1 SRS 40%). */
  moreAttackSpeedPct?: number;
  /** Player stat name contributing additional active minions (e.g. `'ActiveZombieLimit'`, `'ActiveRagingSpiritLimit'`). */
  limitStat?: string;
  /** Base maximum active minions (e.g. 20 for SRS, 3 for Raise Zombie). */
  baseLimit?: number;
  /** PoE 2 Spirit reserved per persistent minion (e.g. 39 for Skeletal Arsonist). */
  spiritPerMinion?: number;
  /** Optional PoB SkillTypes for minion skills (used by support RPN matching). */
  minionSkillTypes?: readonly string[];
  /** Optional inherent minion damage conversions (e.g. `{ PhysicalToFire: 100 }` for SRS). */
  conversions?: Partial<Record<`${DamageType}To${DamageType}`, number>>;
  /** Reference gem level for the base damage values (defaults to 20). */
  baseLevel?: number;
}

/**
 * Forward-compatible runtime skill/support gem descriptor.
 * Structurally accepts any `@webpob/core` `GemDefinition` as-is while unlocking
 * PoB RPN `SkillType` matching, `CompiledGemMod` (`cmods`), and `skillData`.
 */
export interface SkillGemDef
  extends Omit<
    GemDefinition,
    | 'minionBase'
    | 'levelScaling'
    | 'skillTypes'
    | 'minionSkillTypes'
    | 'requireSkillTypes'
    | 'excludeSkillTypes'
    | 'addSkillTypes'
    | 'compiledMods'
    | 'qualityCompiledMods'
    | 'skillData'
  > {
  minionBase?: MinionBaseProfile;
  /** Official PoB active `SkillType` list (e.g. `['Spell', 'Damage', 'Hit', 'Totemable', 'Triggerable']`). */
  skillTypes?: readonly string[];
  /** Official PoB minion `SkillType` list. */
  minionSkillTypes?: readonly string[];
  /** Official PoB support RPN required `SkillType` expression. */
  requireSkillTypes?: readonly string[];
  /** Official PoB support RPN excluded `SkillType` expression. */
  excludeSkillTypes?: readonly string[];
  /** Official PoB support `SkillType`s added to the active skill in Pass 1 (e.g. Spell Totem -> `['Totem', 'Duration']`). */
  addSkillTypes?: readonly string[];
  /** When true, support ignores `minionSkillTypes` during RPN matching (e.g. Spell Totem / Trap / Mine / CoC). */
  ignoreMinionTypes?: boolean;
  /** When true, support can only link to socketed skill gems and NOT item-granted skills (e.g. Empower / Enhance / Enlighten). */
  supportGemsOnly?: boolean;
  /** True if this active skill is granted by an item rather than a socketed gem. */
  fromItem?: boolean;
  /** Pre-compiled `SkillStatMap` modifiers for zero-regex injection. */
  cmods?: readonly CompiledGemMod[];
  compiledMods?: readonly CompiledGemMod[];
  qualityCompiledMods?: readonly CompiledGemMod[];
  /** Structured PoB `skillData` table. */
  skillData?: SkillDataMap;
  /** Optional per-level scaling table (compatible with `GemDefinition['levelScaling']`). */
  levelScaling?: Record<
    number,
    {
      baseDamage?: Partial<Record<DamageType, [number, number]>>;
      attackDamageMultiplierPct?: number;
      damageEffectivenessPct?: number;
      manaCost?: number;
      stats?: string[];
      cmods?: readonly CompiledGemMod[];
      compiledMods?: readonly CompiledGemMod[];
      skillData?: SkillDataMap;
    }
  >;
}

export const POB_SERVER_TICK_SEC = 0.033;
export const POB_MINION_DAMAGE_GROWTH_PER_LEVEL = 1.095;

const DMG_BIT: Record<DamageType, number> = {
  Physical: 1,
  Lightning: 2,
  Cold: 4,
  Fire: 8,
  Chaos: 16,
};
const ELE_MASK = DMG_BIT.Lightning | DMG_BIT.Cold | DMG_BIT.Fire;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function emptyDamageRanges(): Record<DamageType, DamageRange> {
  return {
    Physical: { min: 0, max: 0, average: 0 },
    Lightning: { min: 0, max: 0, average: 0 },
    Cold: { min: 0, max: 0, average: 0 },
    Fire: { min: 0, max: 0, average: 0 },
    Chaos: { min: 0, max: 0, average: 0 },
  };
}

// ============================================================================
// 1. RPN SkillType Support Compatibility Engine
//    (Modeled directly on PoB CalcTools.lua & CalcActiveSkill.lua)
// ============================================================================

export type SkillTypeSetInput =
  | ReadonlySet<string>
  | readonly string[]
  | Record<string, boolean | undefined>;

/** Canonical case/separator-insensitive key for PoB `SkillType` & gem tag tokens. */
export function normalizeSkillTypeToken(token: string): string {
  return token.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/** Converts an array, set, or map of SkillType names into a normalized `Set<string>`. */
export function toNormalizedSkillTypeSet(input?: SkillTypeSetInput): Set<string> {
  const out = new Set<string>();
  if (!input) return out;
  if (input instanceof Set) {
    for (const t of input) {
      const n = normalizeSkillTypeToken(t);
      if (n) out.add(n);
    }
    return out;
  }
  if (Array.isArray(input)) {
    for (const t of input) {
      const n = normalizeSkillTypeToken(t);
      if (n) out.add(n);
    }
    return out;
  }
  for (const [k, v] of Object.entries(input)) {
    if (v) {
      const n = normalizeSkillTypeToken(k);
      if (n) out.add(n);
    }
  }
  return out;
}

/**
 * Exact stack-based Reverse Polish Notation (RPN) boolean evaluator matching
 * upstream PoB `CalcTools.lua` `calcLib.doesTypeExpressionMatch(checkTypes, skillTypes, minionTypes)`:
 *
 * - `'AND'`: pop `b`, pop `a`, push `a && b`
 * - `'OR'`:  pop `b`, pop `a`, push `a || b`
 * - `'NOT'`: pop `a`, push `!a`
 * - Any other token (case-insensitive): push `activeSkillTypes.has(tok) || minionSkillTypes.has(tok)`
 * - Final result: `true` if any remaining item on the stack is `true` (implicit `OR` over residual stack).
 */
export function doesTypeExpressionMatch(
  checkTypes: readonly string[],
  activeSkillTypes: SkillTypeSetInput,
  minionSkillTypes?: SkillTypeSetInput,
): boolean {
  if (checkTypes.length === 0) return false;
  const activeSet = toNormalizedSkillTypeSet(activeSkillTypes);
  const minionSet = minionSkillTypes ? toNormalizedSkillTypeSet(minionSkillTypes) : undefined;
  const stack: boolean[] = [];

  for (const rawToken of checkTypes) {
    const upper = rawToken.trim().toUpperCase();
    if (upper === 'AND') {
      const b = stack.pop() ?? false;
      const a = stack.pop() ?? false;
      stack.push(a && b);
    } else if (upper === 'OR') {
      const b = stack.pop() ?? false;
      const a = stack.pop() ?? false;
      stack.push(a || b);
    } else if (upper === 'NOT') {
      const a = stack.pop() ?? false;
      stack.push(!a);
    } else {
      const key = normalizeSkillTypeToken(rawToken);
      const matched = activeSet.has(key) || Boolean(minionSet && minionSet.has(key));
      stack.push(matched);
    }
  }

  for (const val of stack) {
    if (val) return true;
  }
  return false;
}

/**
 * Extracts normalized active `SkillType`s for a gem.
 * Uses authoritative PoB `gem.skillTypes` when present; otherwise derives a rich
 * compatibility set from `tags`, `modFlags`, `keywordFlags`, and `minionBase`.
 */
export function extractActiveSkillTypes(gem: SkillGemDef): Set<string> {
  if (gem.skillTypes && gem.skillTypes.length > 0) {
    return toNormalizedSkillTypeSet(gem.skillTypes);
  }

  const out = toNormalizedSkillTypeSet(gem.tags);
  const mf = gem.modFlags;
  const kf = gem.keywordFlags;

  if (mf & ModFlag.Attack) out.add('attack');
  if (mf & ModFlag.Spell) out.add('spell');
  if (mf & ModFlag.Hit) {
    out.add('hit');
    out.add('damage');
  }
  if (mf & ModFlag.Dot) out.add('damageovertime');
  if (mf & ModFlag.Melee) out.add('melee');
  if (mf & ModFlag.Area) out.add('area');
  if (mf & ModFlag.Projectile) out.add('projectile');
  if (mf & ModFlag.Bow) out.add('bow');
  if (mf & ModFlag.Ailment) out.add('ailment');

  if (kf & KeywordFlag.Aura) out.add('aura');
  if (kf & KeywordFlag.Curse) {
    out.add('curse');
    out.add('appliescurse');
  }
  if (kf & KeywordFlag.Warcry) out.add('warcry');
  if (kf & KeywordFlag.Movement) out.add('movement');
  if (kf & KeywordFlag.Fire) out.add('fire');
  if (kf & KeywordFlag.Cold) out.add('cold');
  if (kf & KeywordFlag.Lightning) out.add('lightning');
  if (kf & KeywordFlag.Chaos) out.add('chaos');
  if (kf & KeywordFlag.Physical) out.add('physical');
  if (kf & KeywordFlag.Minion || gem.minionBase) {
    out.add('minion');
    out.add('createsminion');
  }
  if (kf & KeywordFlag.Totem) {
    out.add('totem');
    out.add('summonstotem');
  }
  if (kf & KeywordFlag.Trap) {
    out.add('trap');
    out.add('trapped');
  }
  if (kf & KeywordFlag.Mine) {
    out.add('mine');
    out.add('remotemined');
  }
  if (kf & KeywordFlag.Spirit) out.add('spirit');

  const isNonProxyDamager =
    !out.has('aura') &&
    !out.has('warcry') &&
    !out.has('guard') &&
    !out.has('herald') &&
    !out.has('buff');

  if (isNonProxyDamager && (out.has('spell') || out.has('attack'))) {
    if (!out.has('totem') && !out.has('trap') && !out.has('mine') && !out.has('minion')) {
      if (out.has('spell') || out.has('bow') || out.has('wand')) {
        out.add('totemable');
        out.add('trappable');
        out.add('mineable');
      }
      if (!out.has('channelling') && !out.has('vaal')) {
        out.add('triggerable');
      }
    }
  }

  return out;
}

/** Extracts normalized minion `SkillType`s when an active gem summons minions. */
export function extractMinionSkillTypes(gem: SkillGemDef): Set<string> {
  if (gem.minionSkillTypes && gem.minionSkillTypes.length > 0) {
    return toNormalizedSkillTypeSet(gem.minionSkillTypes);
  }
  if (gem.minionBase?.minionSkillTypes && gem.minionBase.minionSkillTypes.length > 0) {
    return toNormalizedSkillTypeSet(gem.minionBase.minionSkillTypes);
  }
  const out = new Set<string>();
  if (!gem.minionBase) return out;
  out.add('minion');
  out.add('damage');
  out.add('hit');
  const mf = gem.minionBase.modFlags ?? gem.modFlags;
  if (gem.minionBase.isSpell || (mf & ModFlag.Spell) !== 0) {
    out.add('spell');
  } else {
    out.add('attack');
    if ((mf & ModFlag.Melee) !== 0) out.add('melee');
  }
  if ((mf & ModFlag.Projectile) !== 0) out.add('projectile');
  if ((mf & ModFlag.Area) !== 0) out.add('area');
  return out;
}

/** Infers Pass-1 `addSkillTypes` for legacy proxy/trigger supports lacking PoB metadata. */
function inferLegacyAddSkillTypes(support: SkillGemDef): readonly string[] {
  if (support.addSkillTypes && support.addSkillTypes.length > 0) {
    return support.addSkillTypes;
  }
  const name = support.name.en.trim().toLowerCase();
  if (name.includes('spell totem') || name.includes('ballista totem')) {
    return ['Totem', 'SummonsTotem', 'Duration'];
  }
  if (name === 'trap' || name === 'trap support') {
    return ['Trap', 'Trapped'];
  }
  if (name.includes('high-impact mine') || name.includes('blastchain mine')) {
    return ['Mine', 'RemoteMined'];
  }
  if (name.includes('arcanist brand')) {
    return ['Brand', 'Duration', 'Triggered'];
  }
  if (name.includes('blasphemy')) {
    return ['Aura', 'AuraAffectsEnemies'];
  }
  if (
    name.includes('cast on critical strike') ||
    name.includes('cast while channelling') ||
    name.includes('cast when damage taken') ||
    name.includes('spellslinger')
  ) {
    return ['Triggered'];
  }
  return [];
}

/** Tag/flag fallback compatibility when a support lacks PoB `requireSkillTypes`/`excludeSkillTypes`. */
function canSupportByTagFallback(
  support: SkillGemDef,
  active: SkillGemDef,
  activeTypes: Set<string>,
  minionTypes: Set<string>,
): boolean {
  const supTags = toNormalizedSkillTypeSet(support.tags);
  const supName = support.name.en.trim().toLowerCase();
  const isMinion = activeTypes.has('minion') || Boolean(active.minionBase);
  const isSpell = activeTypes.has('spell');
  const isAttack = activeTypes.has('attack');

  // Legacy proxy/trigger adders have well-defined archetype prerequisites
  if (supName.includes('spell totem')) {
    return isSpell && !activeTypes.has('totem') && !activeTypes.has('trapped') && !activeTypes.has('remotemined');
  }
  if (supName.includes('ballista totem')) {
    return (
      isAttack &&
      (activeTypes.has('bow') || activeTypes.has('wand') || activeTypes.has('projectile')) &&
      !activeTypes.has('totem') &&
      !activeTypes.has('trapped') &&
      !activeTypes.has('remotemined')
    );
  }
  if (supName === 'trap' || supName === 'trap support') {
    return (isSpell || isAttack) && !activeTypes.has('totem') && !activeTypes.has('trapped') && !activeTypes.has('remotemined');
  }
  if (supName.includes('high-impact mine') || supName.includes('blastchain mine')) {
    return (isSpell || isAttack) && !activeTypes.has('totem') && !activeTypes.has('trapped') && !activeTypes.has('remotemined');
  }
  if (supName.includes('arcanist brand')) {
    return isSpell && !activeTypes.has('brand') && !activeTypes.has('channelling') && !activeTypes.has('totem');
  }
  if (supName.includes('blasphemy')) {
    return activeTypes.has('curse') || activeTypes.has('hex');
  }
  if (supName.includes('cast on critical strike')) {
    return (isSpell || isAttack) && !activeTypes.has('totem') && !activeTypes.has('trapped') && !activeTypes.has('remotemined');
  }
  if (supName.includes('spell echo')) {
    return isSpell && !activeTypes.has('totem') && !activeTypes.has('trapped') && !activeTypes.has('remotemined') && !activeTypes.has('triggered') && !activeTypes.has('channelling');
  }

  // Minion-only supports require a minion active skill
  if (supTags.has('minion') && !isMinion) return false;

  // Attack / Spell mutual exclusion (allowing minion attackers to use Attack/Melee supports)
  const supRequiresAttack =
    (support.modFlags & ModFlag.Attack) !== 0 || (supTags.has('attack') && !supTags.has('spell'));
  const supRequiresSpell =
    (support.modFlags & ModFlag.Spell) !== 0 || (supTags.has('spell') && !supTags.has('attack'));

  if (supRequiresAttack && !isAttack && !minionTypes.has('attack')) return false;
  if (supRequiresSpell && !isSpell && !minionTypes.has('spell')) return false;

  // Specific mechanical tag requirements
  if ((supTags.has('bow') || (support.modFlags & ModFlag.Bow) !== 0) && !activeTypes.has('bow')) {
    return false;
  }
  if (supTags.has('melee') && !activeTypes.has('melee') && !minionTypes.has('melee')) {
    return false;
  }
  if (supTags.has('projectile') && !activeTypes.has('projectile') && !minionTypes.has('projectile')) {
    return false;
  }
  if (supTags.has('area') && !activeTypes.has('area') && !minionTypes.has('area')) {
    return false;
  }
  if (supTags.has('channelling') && !activeTypes.has('channelling')) {
    return false;
  }
  if (supTags.has('duration') && !activeTypes.has('duration')) {
    return false;
  }
  if (supTags.has('strike') && !activeTypes.has('strike')) {
    return false;
  }
  if (supTags.has('slam') && !activeTypes.has('slam')) {
    return false;
  }
  if (supTags.has('totem') && !activeTypes.has('totem')) {
    return false;
  }
  if (supTags.has('trap') && !activeTypes.has('trap') && !activeTypes.has('trapped')) {
    return false;
  }
  if (supTags.has('mine') && !activeTypes.has('mine') && !activeTypes.has('remotemined')) {
    return false;
  }
  if (supTags.has('brand') && !activeTypes.has('brand')) {
    return false;
  }
  if (supTags.has('curse') && !activeTypes.has('curse') && !activeTypes.has('hex')) {
    return false;
  }
  if (supTags.has('aura') && !activeTypes.has('aura')) {
    return false;
  }
  return true;
}

export interface CanSupportOptions {
  /** Override effective active SkillTypes (e.g. after Pass 1 `addSkillTypes`). */
  effectiveSkillTypes?: SkillTypeSetInput;
  /** Override effective minion SkillTypes. */
  effectiveMinionSkillTypes?: SkillTypeSetInput;
  /** Override whether the active skill is item-granted (blocks `supportGemsOnly` supports). */
  activeIsFromItem?: boolean;
}

/**
 * Determines whether a support gem can support an active skill using PoB's exact RPN
 * `requireSkillTypes` / `excludeSkillTypes` evaluator and `supportGemsOnly` gate,
 * falling back gracefully to tag/flag matching when a gem lacks RPN metadata.
 */
export function canSupportActiveSkill(
  support: SkillGemDef,
  active: SkillGemDef,
  opts: CanSupportOptions = {},
): boolean {
  if (support.category !== 'support' || active.category !== 'active') {
    return false;
  }

  const activeFromItem = opts.activeIsFromItem ?? Boolean(active.fromItem);
  if (support.supportGemsOnly && activeFromItem) {
    return false;
  }

  const activeTypes = opts.effectiveSkillTypes
    ? toNormalizedSkillTypeSet(opts.effectiveSkillTypes)
    : extractActiveSkillTypes(active);
  const minionTypes = opts.effectiveMinionSkillTypes
    ? toNormalizedSkillTypeSet(opts.effectiveMinionSkillTypes)
    : extractMinionSkillTypes(active);

  const hasRpnMetadata =
    support.requireSkillTypes !== undefined || support.excludeSkillTypes !== undefined;

  if (!hasRpnMetadata) {
    return canSupportByTagFallback(support, active, activeTypes, minionTypes);
  }

  // Dual-part PoB trigger supports (`Cast On Critical Strike`, `Cast while Channelling`, `Spellslinger`)
  // carry part-1 trigger reqTypes (`Attack` / `Channel`) in compact gem tables while part-2 supports
  // any triggerable Spell in the same linked group.
  const supNameLower = support.name.en.trim().toLowerCase().replace(/\s+support$/i, '');
  if (
    (supNameLower === 'cast on critical strike' ||
      supNameLower === 'awakened cast on critical strike' ||
      supNameLower === 'cast while channelling' ||
      supNameLower === 'awakened cast while channelling' ||
      supNameLower === 'spellslinger') &&
    activeTypes.has('spell') &&
    !activeTypes.has('trapped') &&
    !activeTypes.has('remotemined') &&
    !activeTypes.has('summonstotem') &&
    !activeTypes.has('hasreservation') &&
    !activeTypes.has('disallowtriggersupports')
  ) {
    return true;
  }

  const effectiveMinionCheck = support.ignoreMinionTypes ? undefined : minionTypes;

  if (support.requireSkillTypes && support.requireSkillTypes.length > 0) {
    if (!doesTypeExpressionMatch(support.requireSkillTypes, activeTypes, effectiveMinionCheck)) {
      return false;
    }
  }

  if (support.excludeSkillTypes && support.excludeSkillTypes.length > 0) {
    if (doesTypeExpressionMatch(support.excludeSkillTypes, activeTypes, effectiveMinionCheck)) {
      return false;
    }
  }

  return true;
}

export interface SupportGroupEntry {
  gem: SkillGemDef;
  enabled?: boolean;
  instance?: GemInstance;
}

export type SupportCandidateInput = SkillGemDef | SupportGroupEntry;

export interface ResolveSupportsOptions {
  /** Whether the active skill is granted by an item rather than a socketed gem. */
  activeIsFromItem?: boolean;
  /** Additional SkillTypes injected externally (e.g. from item/ascendancy). */
  extraSkillTypes?: readonly string[];
}

export interface CompatibleSupportsResult<T extends SupportCandidateInput = SkillGemDef> {
  /** Ordered list of enabled supports compatible with the active skill after two-pass resolution. */
  compatible: T[];
  /** Enabled supports rejected by `supportGemsOnly`, `requireSkillTypes`, `excludeSkillTypes`, or fallback rules. */
  rejected: Array<{ entry: T; reason: string }>;
  /** Final active `SkillType` set (base types + Pass-1 `addSkillTypes`). */
  effectiveSkillTypes: Set<string>;
  /** Final minion `SkillType` set. */
  effectiveMinionSkillTypes: Set<string>;
  /** SkillTypes newly added during Pass 1 by proxy/trigger supports. */
  addedSkillTypes: Set<string>;
}

function isSupportGroupEntry(item: SupportCandidateInput): item is SupportGroupEntry {
  return 'gem' in item && typeof item.gem === 'object' && item.gem !== null;
}

function unwrapSupportGem(item: SupportCandidateInput): { gem: SkillGemDef; enabled: boolean } {
  if (isSupportGroupEntry(item)) {
    const enabled = (item.enabled ?? true) && (item.instance ? item.instance.enabled : true);
    return { gem: item.gem, enabled };
  }
  return { gem: item, enabled: true };
}

/**
 * Two-pass PoB support group compatibility resolver (`CalcActiveSkill.lua`):
 *
 * - **Pass 1**: Applies `addSkillTypes` from enabled supports whose `requireSkillTypes`
 *   (and `excludeSkillTypes`) match (fixed-point loop so chained type adders work; e.g.
 *   `Spell Totem`, `High-Impact Mine`, `Trap`, `Cast On Critical Strike`, `Arcanist Brand`, `Blasphemy`).
 * - **Pass 2**: Filters all enabled supports against the augmented `effectiveSkillTypes`
 *   using `requireSkillTypes`, `excludeSkillTypes`, and `supportGemsOnly` — ensuring a
 *   Pass-1 adder never falsely excludes itself via its own `addSkillTypes` while still
 *   blocking incompatible peers (e.g. `Spell Echo` blocked after `Spell Totem` adds `Totem`,
 *   and `Multiple Totems` unlocked!).
 */
export function resolveCompatibleSupports<T extends SupportCandidateInput>(
  active: SkillGemDef,
  supports: readonly T[],
  opts: ResolveSupportsOptions = {},
): CompatibleSupportsResult<T> {
  const baseSkillTypes = extractActiveSkillTypes(active);
  if (opts.extraSkillTypes) {
    for (const t of opts.extraSkillTypes) {
      const n = normalizeSkillTypeToken(t);
      if (n) baseSkillTypes.add(n);
    }
  }
  const effectiveSkillTypes = new Set<string>(baseSkillTypes);
  const effectiveMinionSkillTypes = extractMinionSkillTypes(active);
  const addedSkillTypes = new Set<string>();
  const activeFromItem = opts.activeIsFromItem ?? Boolean(active.fromItem);

  const unwrapped = supports.map((entry) => ({
    entry,
    ...unwrapSupportGem(entry),
  }));

  // Pass 1: fixed-point application of `addSkillTypes` from matching supports
  const pass1Accepted = new Map<number, Set<string>>();
  let changed = true;
  let guard = 0;
  while (changed && guard <= unwrapped.length) {
    changed = false;
    guard++;
    for (let i = 0; i < unwrapped.length; i++) {
      if (pass1Accepted.has(i)) continue;
      const item = unwrapped[i]!;
      if (!item.enabled || item.gem.category !== 'support') continue;

      const toAdd = inferLegacyAddSkillTypes(item.gem);
      if (toAdd.length === 0) continue;

      if (
        canSupportActiveSkill(item.gem, active, {
          effectiveSkillTypes,
          effectiveMinionSkillTypes,
          activeIsFromItem: activeFromItem,
        })
      ) {
        const addedByThis = new Set<string>();
        for (const rawType of toAdd) {
          const norm = normalizeSkillTypeToken(rawType);
          if (!norm) continue;
          if (!effectiveSkillTypes.has(norm)) {
            effectiveSkillTypes.add(norm);
            addedSkillTypes.add(norm);
            addedByThis.add(norm);
          }
        }
        pass1Accepted.set(i, addedByThis);
        changed = true;
      }
    }
  }

  // Pass 2: filter all enabled supports against the augmented skill type set
  const compatible: T[] = [];
  const rejected: Array<{ entry: T; reason: string }> = [];

  for (let i = 0; i < unwrapped.length; i++) {
    const item = unwrapped[i]!;
    if (!item.enabled) continue;
    if (item.gem.category !== 'support') {
      rejected.push({ entry: item.entry, reason: 'not_a_support' });
      continue;
    }

    if (item.gem.supportGemsOnly && activeFromItem) {
      rejected.push({ entry: item.entry, reason: 'support_gems_only' });
      continue;
    }

    // For Pass-1 adders, evaluate against types without the types exclusively added by this support itself
    // so e.g. Spell Totem (adds 'Totem' and excludes 'Totem') does not self-exclude.
    let checkTypes = effectiveSkillTypes;
    if (pass1Accepted.has(i)) {
      const ownAdded = pass1Accepted.get(i)!;
      if (ownAdded.size > 0) {
        checkTypes = new Set<string>(baseSkillTypes);
        for (const [otherIdx, otherAdded] of pass1Accepted.entries()) {
          if (otherIdx === i) continue;
          for (const t of otherAdded) checkTypes.add(t);
        }
      }
    }

    const ok = canSupportActiveSkill(item.gem, active, {
      effectiveSkillTypes: checkTypes,
      effectiveMinionSkillTypes,
      activeIsFromItem: activeFromItem,
    });

    if (ok) {
      compatible.push(item.entry);
    } else {
      rejected.push({ entry: item.entry, reason: 'skill_type_mismatch' });
    }
  }

  return {
    compatible,
    rejected,
    effectiveSkillTypes,
    effectiveMinionSkillTypes,
    addedSkillTypes,
  };
}

// ============================================================================
// 2. Three-Actor ModDB Router & CompiledGemMod Injector
// ============================================================================

export interface ActorModBuses {
  playerDb: ModDB;
  enemyDb: ModDB;
  minionDb: ModDB;
}

/**
 * Minion-meta stats that stay on `playerDb` (they govern the player's minion cap,
 * reservation, or skill level rather than the minion entity's own combat stats).
 */
const PLAYER_SCOPED_MINION_STATS = new Set([
  'MinionLimit',
  'MinionCount',
  'MinionReviveSpeed',
  'MinionSpiritReservation',
  'MinionCost',
  'MinionSkillLevel',
]);

/** Direct canonical name normalization for `Minion*` stats routed into `minionDb`. */
function normalizeMinionStat(mod: Mod): Mod[] {
  if (!mod.name.startsWith('Minion') || mod.name.length <= 6) {
    return [mod];
  }
  const rest = mod.name.slice('Minion'.length);
  const restLower = rest.toLowerCase();

  if (restLower === 'allelementalresistances' || restLower === 'elementalresist') {
    return [
      { ...mod, name: 'FireResist' },
      { ...mod, name: 'ColdResist' },
      { ...mod, name: 'LightningResist' },
    ];
  }
  if (restLower === 'attackspeed') {
    return [{ ...mod, name: 'Speed', flags: mod.flags | ModFlag.Attack }];
  }
  if (restLower === 'castspeed') {
    return [{ ...mod, name: 'Speed', flags: mod.flags | ModFlag.Spell }];
  }
  if (restLower === 'criticalhitchance' || restLower === 'criticalstrikechance') {
    return [{ ...mod, name: 'CritChance' }];
  }
  if (restLower === 'criticaldamagebonus') {
    return [{ ...mod, name: 'CritMultiplier' }];
  }
  if (restLower === 'physicaldamagereduction') {
    return [{ ...mod, name: 'PhysDamageReduction' }];
  }
  if (restLower === 'fireresistance') return [{ ...mod, name: 'FireResist' }];
  if (restLower === 'coldresistance') return [{ ...mod, name: 'ColdResist' }];
  if (restLower === 'lightningresistance') return [{ ...mod, name: 'LightningResist' }];
  if (restLower === 'chaosresistance') return [{ ...mod, name: 'ChaosResist' }];

  return [{ ...mod, name: rest }];
}

const ENEMY_DEBUFF_STAT_NAMES = new Set([
  'Shock',
  'ShockEffect',
  'Scorch',
  'Brittle',
  'Wither',
  'Withered',
  'WitheredStacks',
  'Intimidated',
  'Unnerved',
  'FireExposure',
  'ColdExposure',
  'LightningExposure',
  'CoveredInAsh',
  'CoveredInFrost',
  'Crushed',
]);

/** Normalizes `Enemy*` and high-level debuff mods into canonical `enemyDb` modifiers. */
function normalizeEnemyStat(mod: Mod, game: GameId = 'poe1'): Mod[] {
  const name = mod.name;

  // High-level enemy debuff shorthands
  if (name === 'Intimidated' && (mod.value === true || (typeof mod.value === 'number' && mod.value > 0))) {
    const val = typeof mod.value === 'number' ? mod.value : 10;
    return [{ ...mod, name: 'DamageTaken', type: 'INC', value: val, flags: mod.flags | ModFlag.Attack }];
  }
  if (name === 'Unnerved' && (mod.value === true || (typeof mod.value === 'number' && mod.value > 0))) {
    const val = typeof mod.value === 'number' ? mod.value : 10;
    return [{ ...mod, name: 'DamageTaken', type: 'INC', value: val, flags: mod.flags | ModFlag.Spell }];
  }
  if (name === 'Shock' && typeof mod.value === 'number') {
    return [{ ...mod, name: 'DamageTaken', type: 'INC', value: clamp(mod.value, 0, 100) }];
  }
  if (name === 'Scorch' && typeof mod.value === 'number') {
    const pen = -clamp(Math.abs(mod.value), 0, 30);
    return [
      { ...mod, name: 'FireResist', type: 'BASE', value: pen },
      { ...mod, name: 'ColdResist', type: 'BASE', value: pen },
      { ...mod, name: 'LightningResist', type: 'BASE', value: pen },
    ];
  }
  if (name === 'Brittle' && typeof mod.value === 'number') {
    return [{ ...mod, name: 'SelfCritChance', type: 'BASE', value: clamp(Math.abs(mod.value), 0, 15) }];
  }
  if ((name === 'Wither' || name === 'Withered' || name === 'WitheredStacks') && typeof mod.value === 'number') {
    const maxStacks = game === 'poe2' ? 10 : 15;
    const perStack = game === 'poe2' ? 5 : 6;
    const stacks = clamp(Math.round(mod.value), 0, maxStacks);
    return [{ ...mod, name: 'ChaosDamageTaken', type: 'INC', value: stacks * perStack }];
  }
  if (name === 'FireExposure' || name === 'ColdExposure' || name === 'LightningExposure') {
    const el = name.replace('Exposure', '');
    const pen = typeof mod.value === 'number' ? -Math.abs(mod.value) : mod.value === true ? -10 : 0;
    return pen !== 0 ? [{ ...mod, name: `${el}Resist`, type: 'BASE', value: pen }] : [];
  }
  if (name === 'CoveredInAsh' && (mod.value === true || (typeof mod.value === 'number' && mod.value > 0))) {
    return [{ ...mod, name: 'FireDamageTaken', type: 'INC', value: typeof mod.value === 'number' ? mod.value : 20 }];
  }
  if (name === 'CoveredInFrost' && (mod.value === true || (typeof mod.value === 'number' && mod.value > 0))) {
    return [{ ...mod, name: 'ColdDamageTaken', type: 'INC', value: typeof mod.value === 'number' ? mod.value : 20 }];
  }
  if (name === 'Crushed' && (mod.value === true || (typeof mod.value === 'number' && mod.value > 0))) {
    return [{ ...mod, name: 'PhysicalDamageTaken', type: 'INC', value: typeof mod.value === 'number' ? mod.value : 15 }];
  }

  // `Enemy*` stat prefixes -> strip `Enemy` inside `enemyDb`
  if (name.startsWith('Enemy') && name.length > 5) {
    const rest = name.slice('Enemy'.length);
    if (rest === 'ElementalResist') {
      return [
        { ...mod, name: 'FireResist' },
        { ...mod, name: 'ColdResist' },
        { ...mod, name: 'LightningResist' },
      ];
    }
    if (rest === 'CritChance') {
      if (mod.type !== 'BASE' || (typeof mod.value === 'number' && mod.value < 0)) {
        return [{ ...mod, name: 'MonsterCritChance' }];
      }
      return [{ ...mod, name: 'SelfCritChance' }];
    }
    if (rest === 'CritMultiplier') {
      if (mod.type !== 'BASE' || (typeof mod.value === 'number' && mod.value < 0)) {
        return [{ ...mod, name: 'MonsterCritMultiplier' }];
      }
      return [{ ...mod, name: 'SelfCritMultiplier' }];
    }
    return [{ ...mod, name: rest }];
  }

  // Canonical `enemyDb` names passed with `target === 'enemy'`
  if (name === 'ElementalResist') {
    return [
      { ...mod, name: 'FireResist' },
      { ...mod, name: 'ColdResist' },
      { ...mod, name: 'LightningResist' },
    ];
  }
  if (name === 'CritChance') {
    return [{ ...mod, name: 'SelfCritChance' }];
  }
  if (name === 'CritMultiplier') {
    return [{ ...mod, name: 'SelfCritMultiplier' }];
  }
  return [mod];
}

const PLAYER_SCOPED_ENEMY_STATS = new Set([
  // PoB player-side ailment duration modifiers (stored on player/skill ModDB, NOT enemyDB)
  'EnemyIgniteDuration',
  'EnemyBleedDuration',
  'EnemyPoisonDuration',
  'EnemyAilmentDuration',
  'EnemyElementalAilmentDuration',
  'EnemyChaosAilmentDuration',
  'EnemyChillDuration',
  'EnemyFreezeDuration',
  'EnemyShockDuration',
  'EnemyBrittleDuration',
  'EnemyScorchDuration',
  'EnemySapDuration',
  'EnemyStunDuration',
  // PoB player-side ailment infliction chance & knockback modifiers
  'EnemyIgniteChance',
  'EnemyBleedChance',
  'EnemyPoisonChance',
  'EnemyFreezeChance',
  'EnemyShockChance',
  'EnemyScorchChance',
  'EnemyBrittleChance',
  'EnemySapChance',
  'EnemyKnockbackChance',
  'EnemyKnockbackDistance',
  // PoB player-side non-damaging ailment effect / magnitude / buildup modifiers
  'EnemyShockEffect',
  'EnemyChillEffect',
  'EnemyFreezeEffect',
  'EnemyScorchEffect',
  'EnemyBrittleEffect',
  'EnemySapEffect',
  'EnemyShockMagnitude',
  'EnemyChillMagnitude',
  'EnemyHeavyStunBuildup',
  'EnemyFreezeBuildup',
  'EnemyElectrocuteBuildup',
  'EnemyPinBuildup',
  'EnemyStunThreshold',
  // PoB player-side curse limit, Yoke of Suffering & The Tempest Rising flags
  'EnemyCurseLimit',
  'EnemyDamageTakenPerAilmentType',
  'EnemyAffectedByEleAilmentCountsAsMoving',
]);

const WEAPON_MOD_FLAGS =
  ModFlag.Weapon1H |
  ModFlag.Weapon2H |
  ModFlag.WeaponRanged |
  ModFlag.Bow |
  ModFlag.Wand |
  ModFlag.Sword |
  ModFlag.Axe |
  ModFlag.Mace |
  ModFlag.Staff |
  ModFlag.Dagger |
  ModFlag.Claw |
  ModFlag.Crossbow |
  ModFlag.Quarterstaff |
  ModFlag.Talisman;

const DAMAGING_AILMENT_KW_BITS = [KeywordFlag.Ignite, KeywordFlag.Bleed, KeywordFlag.Poison] as const;
const DAMAGING_AILMENT_KW_MASK = KeywordFlag.Ignite | KeywordFlag.Bleed | KeywordFlag.Poison;
const TRAP_MINE_KW_MASK = KeywordFlag.Trap | KeywordFlag.Mine;

function splitMultiKeywordMod(mod: Mod): Mod[] {
  let out: Mod[] = [mod];
  const ailBits = mod.keywordFlags & DAMAGING_AILMENT_KW_MASK;
  if (ailBits !== 0 && (ailBits & (ailBits - 1)) !== 0) {
    const rest = mod.keywordFlags & ~DAMAGING_AILMENT_KW_MASK;
    out = [];
    for (const bit of DAMAGING_AILMENT_KW_BITS) {
      if ((ailBits & bit) !== 0) {
        out.push({ ...mod, keywordFlags: rest | bit });
      }
    }
  }
  const expanded: Mod[] = [];
  for (const m of out) {
    if ((m.keywordFlags & TRAP_MINE_KW_MASK) === TRAP_MINE_KW_MASK) {
      const rest = m.keywordFlags & ~TRAP_MINE_KW_MASK;
      expanded.push({ ...m, keywordFlags: rest | KeywordFlag.Trap });
      expanded.push({ ...m, keywordFlags: rest | KeywordFlag.Mine });
    } else {
      expanded.push(m);
    }
  }
  return expanded;
}

function normalizeAilmentScopedMod(mod: Mod): Mod {
  let flags = mod.flags;
  let kw = mod.keywordFlags;
  let tags = mod.tags;
  if ((flags & ModFlag.Attack) !== 0) {
    flags &= ~ModFlag.Attack;
    kw |= KeywordFlag.Attack;
  }
  if ((flags & ModFlag.Spell) !== 0) {
    flags &= ~ModFlag.Spell;
    kw |= KeywordFlag.Spell;
  }
  if ((flags & ModFlag.Melee) !== 0) {
    flags &= ~ModFlag.Melee;
    tags = [...(tags ?? []), { type: 'Condition' as const, var: 'MeleeAilment' }];
  }
  flags = (flags & ~(ModFlag.Hit | ModFlag.Area | ModFlag.Projectile)) | ModFlag.Ailment;
  return {
    ...mod,
    flags,
    keywordFlags: kw,
    ...(tags ? { tags } : {}),
  };
}

const INHERENT_DOT_OR_AILMENT_STATS = new Set([
  'DotDamage',
  'BleedDamage',
  'PoisonDamage',
  'IgniteDamage',
  'DotMultiplier',
  'PhysicalDotMultiplier',
  'FireDotMultiplier',
  'ColdDotMultiplier',
  'LightningDotMultiplier',
  'ChaosDotMultiplier',
  'BleedDotMultiplier',
  'PoisonDotMultiplier',
  'IgniteDotMultiplier',
  'CritAilmentDotMultiplier',
  'AilmentEffect',
  'AilmentMagnitude',
  'PoisonMagnitude',
  'BleedingMagnitude',
  'BleedMagnitude',
  'IgniteMagnitude',
]);

function expandPlayerModFlags(mod: Mod): Mod[] {
  const results: Mod[] = [];
  const hasHit = (mod.flags & ModFlag.Hit) !== 0;
  const hasAilment = (mod.flags & ModFlag.Ailment) !== 0;
  const hasDeliveryNonWeapon =
    (mod.flags & (ModFlag.Hit | ModFlag.Melee | ModFlag.Area | ModFlag.Projectile)) !== 0;

  if (hasHit && hasAilment) {
    // Player/tree/item "with Hits and Ailments" mod -> applies to BOTH Hits and Ailments
    results.push({ ...mod, flags: mod.flags & ~ModFlag.Ailment });
    results.push(normalizeAilmentScopedMod(mod));
  } else if (
    hasAilment &&
    !hasHit &&
    (mod.flags & (ModFlag.Attack | ModFlag.Spell | ModFlag.Melee | ModFlag.Area | ModFlag.Projectile)) !== 0
  ) {
    // Player/tree/item "with Ailments from Attack/Spell/Melee Skills" -> preserve delivery as KeywordFlag / MeleeAilment condition
    results.push(normalizeAilmentScopedMod(mod));
  } else if (
    INHERENT_DOT_OR_AILMENT_STATS.has(mod.name) &&
    (mod.flags & (ModFlag.Attack | ModFlag.Spell | ModFlag.Melee)) !== 0
  ) {
    // Inherently DoT/Ailment stats tagged with Attack/Spell/Melee by parser (e.g. "+26% to DoT Multi with Attack Skills",
    // "12% increased DoT with Bow Skills") -> convert Attack/Spell to KeywordFlag so they match DoT & Ailment queries.
    let flags = mod.flags;
    let kw = mod.keywordFlags;
    let tags = mod.tags;
    if ((flags & ModFlag.Attack) !== 0) {
      flags &= ~ModFlag.Attack;
      kw |= KeywordFlag.Attack;
    }
    if ((flags & ModFlag.Spell) !== 0) {
      flags &= ~ModFlag.Spell;
      kw |= KeywordFlag.Spell;
    }
    if ((flags & ModFlag.Melee) !== 0) {
      flags &= ~ModFlag.Melee;
      tags = [...(tags ?? []), { type: 'Condition' as const, var: 'MeleeAilment' }];
    }
    results.push({ ...mod, flags, keywordFlags: kw, ...(tags ? { tags } : {}) });
  } else if (
    !hasDeliveryNonWeapon &&
    (mod.flags & ModFlag.Attack) !== 0 &&
    ((mod.flags & WEAPON_MOD_FLAGS) !== 0 ||
      (mod.name === 'ElementalDamage' && mod.flags === ModFlag.Attack))
  ) {
    // PoB1 parity for parser-emitted weapon mods ("30% inc Phys Damage with Axes", "Axe Attacks deal X% with Hits & Ailments")
    // and WED ("35% inc Elemental Damage with Attack Skills"): use KeywordFlag.Attack so they scale both Hits and Attack Ailments
    // without allowing generic Attack/Melee/Area/Projectile hit mods to double-dip into ailments.
    results.push({
      ...mod,
      flags: mod.flags & ~ModFlag.Attack,
      keywordFlags: mod.keywordFlags | KeywordFlag.Attack,
    });
  } else {
    results.push(mod);
  }
  return results.flatMap(splitMultiKeywordMod);
}

export function isMinionRoutedMod(mod: Mod, target?: ActorTarget): boolean {
  if (target === 'minion') return true;
  if (target === 'enemy' || target === 'player' || target === 'skill' || target === 'parent') return false;
  if (PLAYER_SCOPED_MINION_STATS.has(mod.name)) return false;
  return mod.name.startsWith('Minion') && mod.name.length > 6;
}

export function isEnemyRoutedMod(mod: Mod, target?: ActorTarget): boolean {
  if (target === 'enemy') return true;
  if (target === 'minion' || target === 'player' || target === 'skill' || target === 'parent') return false;
  if (PLAYER_SCOPED_ENEMY_STATS.has(mod.name)) return false;
  if (mod.name.startsWith('Enemy') && mod.name.length > 5) return true;
  if (ENEMY_DEBUFF_STAT_NAMES.has(mod.name)) return true;
  if (
    (mod.keywordFlags & KeywordFlag.Curse) !== 0 &&
    (mod.name.endsWith('Resist') ||
      mod.name.includes('DamageTaken') ||
      mod.name === 'BuffExpireFaster' ||
      mod.name === 'CritChance' ||
      mod.name === 'CritMultiplier' ||
      mod.name === 'SelfCritChance' ||
      mod.name === 'SelfCritMultiplier')
  ) {
    return true;
  }
  return false;
}

/** Creates an isolated `{ playerDb, enemyDb, minionDb }` three-actor ModDB bus set. */
export function createActorModBuses(seed?: Partial<ActorModBuses>): ActorModBuses {
  return {
    playerDb: seed?.playerDb ? seed.playerDb.clone() : new ModDB(),
    enemyDb: seed?.enemyDb ? seed.enemyDb.clone() : new ModDB(),
    minionDb: seed?.minionDb ? seed.minionDb.clone() : new ModDB(),
  };
}

/** Clones all three actor ModDB buses (including their `ModEvalContext`s). */
export function cloneActorModBuses(buses: ActorModBuses): ActorModBuses {
  return {
    playerDb: buses.playerDb.clone(),
    enemyDb: buses.enemyDb.clone(),
    minionDb: buses.minionDb.clone(),
  };
}

export interface RouteModOptions {
  target?: ActorTarget;
  game?: GameId;
  /** When true (Spiritual Aid), `MinionDamage` INC mods also mirror to `playerDb` as `Damage` INC. */
  spiritualAid?: boolean;
  /** When true (Spiritual Command), `MinionSpeed` INC mods also mirror to `playerDb` as `Speed` INC. */
  spiritualCommand?: boolean;
}

/**
 * Routes a single `Mod` into `playerDb`, `enemyDb`, or `minionDb`, normalizing
 * `Minion*` -> canonical minion stats inside `minionDb` and `Enemy*` / debuffs -> canonical
 * enemy stats inside `enemyDb`.
 */
export function routeModToActorBuses(
  buses: ActorModBuses,
  mod: Mod,
  opts: RouteModOptions = {},
): 'player' | 'enemy' | 'minion' {
  const { target, game = 'poe1' } = opts;

  if (isMinionRoutedMod(mod, target)) {
    const normalized = normalizeMinionStat(mod);
    buses.minionDb.addMods(normalized);
    if (opts.spiritualAid && mod.type === 'INC') {
      for (const nm of normalized) {
        if (nm.name === 'Damage') {
          buses.playerDb.addMod({ ...nm, source: `${nm.source} (Spiritual Aid)` });
        }
      }
    }
    if (opts.spiritualCommand && mod.type === 'INC') {
      for (const nm of normalized) {
        // PoE 1 Spiritual Command: "Increases and Reductions to Minion Attack Speed also affect you"
        // Copies strictly to ModFlag.Attack (never ModFlag.Spell).
        if (nm.name === 'Speed' && (nm.flags === 0 || (nm.flags & ModFlag.Attack) !== 0)) {
          buses.playerDb.addMod({ ...nm, flags: ModFlag.Attack, source: `${nm.source} (Spiritual Command)` });
        }
      }
    }
    return 'minion';
  }

  if (isEnemyRoutedMod(mod, target)) {
    const normalized = normalizeEnemyStat(mod, game);
    buses.enemyDb.addMods(normalized);
    return 'enemy';
  }

  buses.playerDb.addMods(expandPlayerModFlags(mod));
  return 'player';
}

/** Routes a list of mods (with optional per-mod `target`) into the three actor buses. */
export function routeModsToActorBuses(
  buses: ActorModBuses,
  mods: readonly (Mod & { target?: ActorTarget })[],
  opts: Omit<RouteModOptions, 'target'> = {},
): { playerCount: number; enemyCount: number; minionCount: number } {
  let playerCount = 0;
  let enemyCount = 0;
  let minionCount = 0;
  for (const mod of mods) {
    const dest = routeModToActorBuses(buses, mod, { ...opts, target: mod.target });
    if (dest === 'player') playerCount++;
    else if (dest === 'enemy') enemyCount++;
    else minionCount++;
  }
  return { playerCount, enemyCount, minionCount };
}

/**
 * Splits a single unified `ModDB` (e.g. from legacy `calculateBuild`) into three clean
 * actor buses `{ playerDb, enemyDb, minionDb }` while preserving the evaluation context.
 */
export function splitModDBIntoActorBuses(
  sourceDb: ModDB,
  opts: Omit<RouteModOptions, 'target'> = {},
): ActorModBuses {
  const buses = createActorModBuses();
  const evalCtx = sourceDb.getEvalContext();
  buses.playerDb.setEvalContext(evalCtx);
  buses.enemyDb.setEvalContext(evalCtx);
  buses.minionDb.setEvalContext(evalCtx);

  const spiritualAid = opts.spiritualAid ?? sourceDb.flag('SpiritualAid');
  const spiritualCommand = opts.spiritualCommand ?? sourceDb.flag('SpiritualCommand');

  for (const [, list] of sourceDb.entriesByPrefix('')) {
    for (const mod of list) {
      const modTarget = (mod as Mod & { target?: ActorTarget }).target;
      routeModToActorBuses(buses, mod, { ...opts, target: modTarget, spiritualAid, spiritualCommand });
    }
  }
  return buses;
}

export interface EnemyDebuffConfig {
  game?: GameId;
  shockValue?: number;
  enemyShocked?: boolean;
  scorchValue?: number;
  brittleValue?: number;
  witheredStacks?: number;
  enemyIntimidated?: boolean;
  enemyUnnerved?: boolean;
  enemyFireExposure?: boolean;
  enemyColdExposure?: boolean;
  enemyLightningExposure?: boolean;
  /** Base exposure penalty magnitude (default 10 in PoE 1, 20 in PoE 2). */
  baseExposurePct?: number;
  /** Extra exposure magnitude (e.g. Elementalist Mastermind of Discord +25). */
  extraExposurePct?: number;
  enemyCoveredInAsh?: boolean;
  enemyCoveredInFrost?: boolean;
  enemyCrushed?: boolean;
}

/** Injects standardized combat debuffs (Shock, Scorch, Brittle, Wither, Exposure, Intimidated, Unnerved) into `enemyDb`. */
export function applyEnemyDebuffsToEnemyDb(enemyDb: ModDB, cfg: EnemyDebuffConfig): void {
  const game = cfg.game ?? 'poe1';
  if (cfg.enemyShocked && (cfg.shockValue ?? 0) > 0) {
    enemyDb.addMod({
      name: 'DamageTaken',
      type: 'INC',
      value: clamp(cfg.shockValue ?? 0, 0, 100),
      flags: 0,
      keywordFlags: 0,
      source: 'Shock',
    });
  }
  if ((cfg.scorchValue ?? 0) > 0) {
    const pen = -clamp(cfg.scorchValue ?? 0, 0, 30);
    for (const el of ['Fire', 'Cold', 'Lightning'] as const) {
      enemyDb.addMod({ name: `${el}Resist`, type: 'BASE', value: pen, flags: 0, keywordFlags: 0, source: 'Scorch' });
    }
  }
  if ((cfg.brittleValue ?? 0) > 0) {
    enemyDb.addMod({
      name: 'SelfCritChance',
      type: 'BASE',
      value: clamp(cfg.brittleValue ?? 0, 0, 15),
      flags: 0,
      keywordFlags: 0,
      source: 'Brittle',
    });
  }
  if ((cfg.witheredStacks ?? 0) > 0) {
    const maxStacks = game === 'poe2' ? 10 : 15;
    const perStack = game === 'poe2' ? 5 : 6;
    const stacks = clamp(Math.round(cfg.witheredStacks ?? 0), 0, maxStacks);
    enemyDb.addMod({
      name: 'ChaosDamageTaken',
      type: 'INC',
      value: stacks * perStack,
      flags: 0,
      keywordFlags: 0,
      source: `Withered (${stacks})`,
    });
  }
  if (cfg.enemyIntimidated) {
    enemyDb.addMod({
      name: 'DamageTaken',
      type: 'INC',
      value: 10,
      flags: ModFlag.Attack,
      keywordFlags: 0,
      source: 'Intimidated',
    });
  }
  if (cfg.enemyUnnerved) {
    enemyDb.addMod({
      name: 'DamageTaken',
      type: 'INC',
      value: 10,
      flags: ModFlag.Spell,
      keywordFlags: 0,
      source: 'Unnerved',
    });
  }
  const exposurePenalty = -((cfg.baseExposurePct ?? (game === 'poe2' ? 20 : 10)) + (cfg.extraExposurePct ?? 0));
  if (cfg.enemyFireExposure) {
    enemyDb.addMod({ name: 'FireResist', type: 'BASE', value: exposurePenalty, flags: 0, keywordFlags: 0, source: 'Fire Exposure' });
  }
  if (cfg.enemyColdExposure) {
    enemyDb.addMod({ name: 'ColdResist', type: 'BASE', value: exposurePenalty, flags: 0, keywordFlags: 0, source: 'Cold Exposure' });
  }
  if (cfg.enemyLightningExposure) {
    enemyDb.addMod({ name: 'LightningResist', type: 'BASE', value: exposurePenalty, flags: 0, keywordFlags: 0, source: 'Lightning Exposure' });
  }
  if (cfg.enemyCoveredInAsh) {
    enemyDb.addMod({ name: 'FireDamageTaken', type: 'INC', value: 20, flags: 0, keywordFlags: 0, source: 'Covered in Ash' });
  }
  if (cfg.enemyCoveredInFrost) {
    enemyDb.addMod({ name: 'ColdDamageTaken', type: 'INC', value: 20, flags: 0, keywordFlags: 0, source: 'Covered in Frost' });
  }
  if (cfg.enemyCrushed) {
    enemyDb.addMod({ name: 'PhysicalDamageTaken', type: 'INC', value: 15, flags: 0, keywordFlags: 0, source: 'Crushed' });
  }
}

export interface InjectCompiledGemModsOptions {
  game?: GameId;
  /** Optional effect scaling multiplier (e.g. `1 + auraEffectPct / 100` or `1 + curseEffectPct / 100`). */
  effectMultiplier?: number;
  /** Whether to scale `MORE` modifiers with `effectMultiplier` (true for Auras, false for Curses). */
  scaleMore?: boolean;
}

/**
 * Directly injects `SkillStatMap`-compiled `cmods` into the three actor ModDBs
 * (`skillDb`, `enemyDb`, `minionDb`) without any regex parsing.
 */
function expandCanonicalCompiledMod(mod: Mod, target?: ActorTarget): Mod[] {
  // Normalize PoB compiled `ModFlag.MeleeHit` ailment mods (compiled as `ModFlag.Melee | ModFlag.Hit` + ailment scope,
  // e.g. Melee Physical Damage f=36 k=Bleed|Poison, Fortify f=292) so they apply strictly to Melee ailments and never double-dip hits.
  let normalizedMod = mod;
  if (
    target !== 'enemy' &&
    (mod.flags & (ModFlag.Melee | ModFlag.Hit)) === (ModFlag.Melee | ModFlag.Hit) &&
    ((mod.flags & ModFlag.Ailment) !== 0 || (mod.keywordFlags & DAMAGING_AILMENT_KW_MASK) !== 0)
  ) {
    normalizedMod = normalizeAilmentScopedMod(mod);
  }

  const expandName = (m: Mod): Mod[] => {
    const convMatch = m.name.match(
      /^Skill(Physical|Lightning|Cold|Fire)Damage(ConvertTo|GainAs)(Lightning|Cold|Fire|Chaos)$/,
    );
    if (convMatch) {
      return [{ ...m, name: `${convMatch[1]}Damage${convMatch[2]}${convMatch[3]}` }];
    }
    if (m.name === 'CannotMultiplePoison' && m.type === 'FLAG' && m.value === true) {
      return [m, { ...m, name: 'CannotPoisonAlreadyPoisoned' }];
    }
    if (target !== 'enemy') {
      if (m.name === 'EnemyIgniteChance') return [{ ...m, name: 'IgniteChance' }];
      if (m.name === 'EnemyBleedChance') return [{ ...m, name: 'BleedChance' }];
      if (m.name === 'EnemyPoisonChance') return [{ ...m, name: 'PoisonChance' }];
      if (m.name === 'EnemyFreezeChance') return [{ ...m, name: 'FreezeChance' }];
      if (m.name === 'EnemyShockChance') return [{ ...m, name: 'ShockChance' }];
    }
    if (target !== 'enemy' && m.name === 'ElementalResist') {
      return [
        { ...m, name: 'FireResist' },
        { ...m, name: 'ColdResist' },
        { ...m, name: 'LightningResist' },
      ];
    }
    if (target !== 'enemy' && m.name === 'ElementalResistMax') {
      return [
        { ...m, name: 'FireResistMax' },
        { ...m, name: 'ColdResistMax' },
        { ...m, name: 'LightningResistMax' },
      ];
    }
    if (m.name === 'AllAttributes') {
      return [
        { ...m, name: 'Str' },
        { ...m, name: 'Dex' },
        { ...m, name: 'Int' },
      ];
    }
    if (target !== 'enemy' && m.name === 'Defences') {
      return [
        { ...m, name: 'Armour' },
        { ...m, name: 'Evasion' },
        { ...m, name: 'EnergyShield' },
        { ...m, name: 'Ward' },
      ];
    }
    return [m];
  };

  return expandName(normalizedMod).flatMap(splitMultiKeywordMod);
}

const GEM_QUALITY_SOURCE_SUFFIX_RE = /\s+\(Q\d+(?:\.\d+)?\)$/;

function serializeModTagsKey(tags: readonly ModTag[] | undefined): string {
  if (!tags || tags.length === 0) return '';
  return JSON.stringify(tags);
}

/**
 * Matches PoB `CalcActiveSkill.lua`: a gem's base level stat and quality stat for the
 * identical stat bucket (`MORE` modifier with identical name/flags/keywordFlags/condition/tags
 * from `"Skill: X"` and `"Skill: X (Q...)"` or `"Support: X"` and `"Support: X (Q...)"`)
 * sum additively into one `MORE` modifier rather than multiplying separately (e.g.
 * `Lacerate of Haemorrhage` 138% + Q50 100% = 238% more Ailment Damage, not 2.38 × 2.00;
 * `Boneshatter of Complex Trauma` 15% + Q20 5% = 20% more Damage per Trauma).
 */
function coalesceSameGemQualityMoreMod(targetDb: ModDB, mod: Mod): boolean {
  if (mod.type !== 'MORE' || typeof mod.value !== 'number') return false;
  const modSrc = mod.source ?? '';
  if (!modSrc) return false;
  const baseSrc = modSrc.replace(GEM_QUALITY_SOURCE_SUFFIX_RE, '');
  const modIsQuality = baseSrc !== modSrc;
  const modTagsKey = serializeModTagsKey(mod.tags);
  const modCond = mod.condition ?? '';

  for (const [key, bucket] of targetDb.entriesByPrefix(mod.name)) {
    if (key !== mod.name) continue;
    for (let i = 0; i < bucket.length; i++) {
      const existing = bucket[i]!;
      if (existing.type !== 'MORE' || typeof existing.value !== 'number') continue;
      if (existing.flags !== mod.flags || existing.keywordFlags !== mod.keywordFlags) continue;
      if ((existing.condition ?? '') !== modCond) continue;
      const existingSrc = existing.source ?? '';
      const existingBaseSrc = existingSrc.replace(GEM_QUALITY_SOURCE_SUFFIX_RE, '');
      if (existingBaseSrc !== baseSrc) continue;
      const existingIsQuality = existingBaseSrc !== existingSrc;
      if (existingIsQuality === modIsQuality) continue;
      if (serializeModTagsKey(existing.tags) !== modTagsKey) continue;
      // Clone-safe replacement so cloned ModDBs never alias mutated Mod objects
      bucket[i] = {
        ...existing,
        value: existing.value + mod.value,
        source: baseSrc,
      };
      return true;
    }
  }
  return false;
}

export function injectCompiledGemMods(
  skillDb: ModDB,
  enemyDb: ModDB,
  minionDb: ModDB,
  compiledMods: readonly CompiledGemMod[],
  source: string,
  opts: InjectCompiledGemModsOptions = {},
): { playerCount: number; enemyCount: number; minionCount: number } {
  const buses: ActorModBuses = { playerDb: skillDb, enemyDb, minionDb };
  const mult = opts.effectMultiplier ?? 1;
  const scaleMore = opts.scaleMore ?? false;

  let playerCount = 0;
  let enemyCount = 0;
  let minionCount = 0;

  for (const cm of compiledMods) {
    let val = cm.value;
    if (
      mult !== 1 &&
      typeof val === 'number' &&
      (cm.type === 'BASE' || cm.type === 'INC' || (scaleMore && cm.type === 'MORE'))
    ) {
      const hasMultiplierTag = Boolean(cm.tags?.some((t) => t.type === 'Multiplier'));
      val =
        Number.isInteger(val) && !hasMultiplierTag
          ? Math.trunc(val * mult + Math.sign(val) * 1e-9)
          : Math.trunc(val * mult * 100 + Math.sign(val) * 1e-7) / 100;
    }

    if (cm.name.startsWith('Condition:') && cm.type === 'FLAG' && val === true) {
      skillDb.setCondition(cm.name.slice('Condition:'.length), true);
    } else if (cm.name.startsWith('Multiplier:') && cm.type === 'BASE' && typeof val === 'number') {
      const multKey = cm.name.slice('Multiplier:'.length);
      skillDb.setMultiplier(multKey, val);
      if (multKey === 'WindDancerStacksLimit') {
        skillDb.setMultiplier('WindDancerStage', val);
        skillDb.setMultiplier('WindDancerStages', val);
      }
    }

    const baseMod: Mod = {
      name: cm.name,
      type: cm.type,
      value: val,
      flags: cm.flags ?? 0,
      keywordFlags: cm.keywordFlags ?? 0,
      source: cm.source ?? source,
      ...(cm.condition ? { condition: cm.condition } : {}),
      ...(cm.tags && cm.tags.length > 0 ? { tags: cm.tags } : {}),
    };

    for (const mod of expandCanonicalCompiledMod(baseMod, cm.target)) {
      if (
        mod.type === 'MORE' &&
        cm.target !== 'enemy' &&
        cm.target !== 'minion' &&
        coalesceSameGemQualityMoreMod(skillDb, mod)
      ) {
        playerCount++;
        continue;
      }
      const dest = routeModToActorBuses(buses, mod, { target: cm.target, game: opts.game });
      if (dest === 'player') playerCount++;
      else if (dest === 'enemy') enemyCount++;
      else minionCount++;
    }
  }

  // PoE 1 Infused Channelling Support: when `InfusionActive` condition is enabled
  // (`infusedChannellingInfusion=true`), Infusion grants 10% more Damage of types matching
  // the supported channelling skill's tags (not emitted in compiled cmods).
  if (
    opts.game === 'poe1' &&
    /\binfused channelling\b/i.test(source) &&
    !skillDb.calcStat('Damage').sources.some((s) => s.type === 'MORE' && s.source.includes('Infusion'))
  ) {
    skillDb.addMod({
      name: 'Damage',
      type: 'MORE',
      value: 10,
      flags: 0,
      keywordFlags: 0,
      source: `${source} (Infusion)`,
      tags: [{ type: 'Condition', var: 'InfusionActive' }],
    });
    playerCount++;
  }

  return { playerCount, enemyCount, minionCount };
}

// ============================================================================
// 4. PoB-Authentic Poison Stack, Bleed (Crimson Dance / Aggravated),
//    Ignite, `skillData` Spell DoT & Trigger Rate Quantizer
//    (Placed before Section 3 so Minion Offence reuses the exact same DoT engine)
// ============================================================================

export interface EnemyDefenceProfile {
  enemyLevel?: number;
  enemyFireResist?: number;
  enemyColdResist?: number;
  enemyLightningResist?: number;
  enemyChaosResist?: number;
  enemyArmour?: number;
  enemyEvasion?: number;
  enemyMoving?: boolean;
  enemyAggravatedBleed?: boolean;
  enemyMaxResist?: number;
}

export interface AuthenticDotInput {
  game: GameId;
  /** Skill/actor ModDB (player `skillDb` or `minionDb`). */
  skillDb: ModDB;
  /** Enemy ModDB holding curses, exposure, wither, shock, scorch, etc. */
  enemyDb: ModDB;
  /** Pre-INC/MORE converted base average hit damage per DamageType (for PoE 1 ailments). */
  baseDamageByType: Partial<Record<DamageType, number>>;
  /** Optional pre-INC/MORE converted base [min, max] per DamageType (for PoE 1 Volatility / Ryslatha top-roll selection). */
  baseDamageRangeByType?: Partial<Record<DamageType, [number, number]>>;
  /**
   * PoE 2 post-INC/MORE, pre-enemy-mitigation average hit damage per DamageType
   * (used for PoE 2 Poison/Bleed/Ignite magnitude scaling; falls back to scaling `baseDamageByType` if omitted).
   */
  preMitigationHitByType?: Partial<Record<DamageType, number>>;
  /** Optional min/max/average hit damage ranges for PoE 2 over-stacking roll uplift. */
  hitDamageRangeByType?: Partial<Record<DamageType, { min: number; max: number; average: number }>>;
  /** Skill ModFlags (e.g. `ModFlag.Attack | ModFlag.Melee | ModFlag.Hit`). */
  flags?: number;
  /** Skill KeywordFlags. */
  keywordFlags?: number;
  /** Attacks or casts per second. */
  speed: number;
  /** Effective hit chance percentage `0..100` (default 100). */
  hitChancePct?: number;
  /** Effective critical strike chance percentage `0..100` (default 0). */
  critChancePct?: number;
  /** Total critical strike multiplier percentage (e.g. 150 in PoE 1, 200 in PoE 2). */
  critMultiplierPct?: number;
  /** Raw pre-override PoE 1 critical strike multiplier percentage (used by Perfect Agony). */
  rawCritMultiplierPct?: number;
  /** Hits per skill use (default 1; e.g. 2 for Double Strike or multi-proj shotguns). */
  hitsPerUse?: number;
  /** Whether the skill is an Attack (used for PoE 1 Bleed gating; defaults to `(flags & ModFlag.Attack) !== 0`). */
  isAttack?: boolean;
  /** Whether the skill has the `Duration` tag (so generic Skill Effect Duration scales Poison). */
  skillHasDurationTag?: boolean;
  /** Explicit override for Crimson Dance (in addition to `skillDb.flag('CrimsonDance')`). */
  crimsonDance?: boolean;
  /** Explicit override for Moving / Aggravated Bleeding. */
  enemyMovingOrAggravated?: boolean;
  /** Optional `skillData` table for non-ailment DoTs, poison/bleed/ignite durations, and single-poison caps. */
  skillData?: SkillDataMap;
  /** Optional base enemy resists/armour/moving profile. */
  enemyConfig?: EnemyDefenceProfile;
}

export interface PoisonDotBreakdown {
  chancePct: number;
  singleStackDps: number;
  effectiveStacks: number;
  maxStacks: number;
  effectiveDurationSec: number;
  fasterMult: number;
  totalDps: number;
  isSinglePoisonCap: boolean;
}

export interface BleedDotBreakdown {
  chancePct: number;
  singleStackDps: number;
  effectiveStacks: number;
  maxStacks: number;
  effectiveDurationSec: number;
  fasterMult: number;
  isAggravatedOrMoving: boolean;
  isCrimsonDance: boolean;
  totalDps: number;
}

export interface IgniteDotBreakdown {
  effectiveChancePct: number;
  singleStackDps: number;
  effectiveStacks: number;
  effectiveDurationSec: number;
  fasterMult: number;
  totalDps: number;
}

export interface SkillSpellDotBreakdown {
  byType: Record<DamageType, number>;
  effectiveStacks: number;
  totalDps: number;
}

export interface AuthenticDotResult {
  poison: PoisonDotBreakdown;
  bleed: BleedDotBreakdown;
  ignite: IgniteDotBreakdown;
  skillDot: SkillSpellDotBreakdown;
  causticGroundDps?: number;
  burningGroundDps?: number;
  totalDotDps: number;
}

const DAMAGE_TYPE_TO_KEYWORD: Record<DamageType, number> = {
  Physical: KeywordFlag.Physical,
  Lightning: KeywordFlag.Lightning,
  Cold: KeywordFlag.Cold,
  Fire: KeywordFlag.Fire,
  Chaos: KeywordFlag.Chaos,
};

function getEnemyResistForDot(
  dt: DamageType,
  enemyDb: ModDB,
  enemyConfig: EnemyDefenceProfile | undefined,
  flags: number,
  kwFlags: number,
): number {
  if (dt === 'Physical') {
    // PoB CalcOffence.lua:4631,5879 — Physical DoTs / Bleed are mitigated only by positive PhysicalDamageReduction [0..90]
    return clamp(enemyDb.sum('BASE', 'PhysicalDamageReduction', flags, kwFlags), 0, 90);
  }
  const maxRes = enemyConfig?.enemyMaxResist ?? 75;
  if (dt === 'Fire') {
    const overrideDot = enemyDb.override('FireResistDotOverride', flags, kwFlags);
    if (overrideDot !== null) return clamp(overrideDot, -200, maxRes);
  }
  const overrideRes = enemyDb.override(`${dt}Resist`, flags, kwFlags);
  if (overrideRes !== null) return clamp(overrideRes, -200, maxRes);

  const cfgBase =
    dt === 'Fire'
      ? (enemyConfig?.enemyFireResist ?? 0)
      : dt === 'Cold'
        ? (enemyConfig?.enemyColdResist ?? 0)
        : dt === 'Lightning'
          ? (enemyConfig?.enemyLightningResist ?? 0)
          : (enemyConfig?.enemyChaosResist ?? 0);
  const isEle = dt === 'Fire' || dt === 'Cold' || dt === 'Lightning';
  const statNames = isEle ? [`${dt}Resist`, 'ElementalResist'] : [`${dt}Resist`];
  const rawBase = cfgBase + enemyDb.sum('BASE', statNames, flags, kwFlags);
  // PoB CalcOffence.lua:507 — INC/MORE on enemy resistance (e.g. Eye of Malice +50% INC scales negative resists too)
  const resMod =
    Math.max(0, 1 + enemyDb.sum('INC', statNames, flags, kwFlags) / 100) *
    enemyDb.more(statNames, flags, kwFlags);
  return clamp(rawBase * resMod, -200, maxRes);
}

function getEnemyDotTakenMult(
  dt: DamageType,
  ailmentSpecificTakenStat: string | null,
  enemyDb: ModDB,
  flags: number,
  kwFlags: number,
): number {
  const isEle = dt === 'Fire' || dt === 'Cold' || dt === 'Lightning';
  // PoB CalcOffence.lua:4632,4902,5253,5876 & PoB2 CalcOffence.lua:5386
  const statNames = [
    'DamageTaken',
    'DotDamageTaken',
    'DamageTakenOverTime',
    `${dt}DamageTaken`,
    `${dt}DamageTakenOverTime`,
  ];
  if (isEle) {
    statNames.push('ElementalDamageTaken', 'ElementalDamageTakenOverTime');
  }
  if (ailmentSpecificTakenStat) statNames.push(ailmentSpecificTakenStat);
  const inc = enemyDb.sum('INC', statNames, flags, kwFlags);
  const more = enemyDb.more(statNames, flags, kwFlags);
  return Math.max(0, 1 + inc / 100) * more;
}

/** PoB CalcOffence.lua:1499 / PoB2 CalcOffence.lua:448 — Temporal Chains / debuff expiration multiplier. */
function getEnemyDebuffDurationMult(enemyDb: ModDB, flags: number, kwFlags: number): number {
  const expireRate =
    Math.max(0, 1 + enemyDb.sum('INC', 'BuffExpireFaster', flags, kwFlags) / 100) *
    enemyDb.more('BuffExpireFaster', flags, kwFlags);
  return 1 / Math.max(0.25, expireRate);
}

const POE2_MONSTER_AILMENT_THRESHOLD: readonly number[] = [
  15, 20, 24, 28, 34, 39, 46, 52, 60, 70, 81, 95, 110, 126, 144, 171, 193, 218, 245, 275,
  306, 340, 376, 413, 455, 497, 543, 590, 641, 695, 752, 812, 874, 950, 1033, 1123, 1220, 1326, 1442, 1568,
  1705, 1854, 2015, 2192, 2384, 2564, 2757, 2966, 3188, 3426, 3681, 3955, 4247, 4560, 4895, 5254, 5638, 6049, 6489, 6959,
  7462, 8001, 8576, 9193, 9649, 10228, 10841, 11492, 12181, 18272, 19369, 20531, 21763, 23068, 34602, 36679, 38879, 41212, 43685, 65527,
  68415, 71303, 74191, 77079, 79967, 82855, 85743, 88631, 91519, 94407, 97295, 100183, 103071, 105959, 108847, 111735, 114623, 117511, 120399, 123287,
];

function getPoe2EnemyAilmentThreshold(enemyLevel: number, enemyDb: ModDB): number {
  // PoB2 Pinnacle Boss default is level 82 (71303); level 84 is 77079.
  const lv = clamp(Math.round(enemyLevel || 82), 1, 100);
  const base = POE2_MONSTER_AILMENT_THRESHOLD[lv - 1] ?? 71303;
  // Note: `normalizeEnemyStat` strips `Enemy` prefix to `AilmentThreshold` inside `enemyDb`
  const threshStats = ['EnemyAilmentThreshold', 'AilmentThreshold'];
  const inc = enemyDb.sum('INC', threshStats);
  const more = enemyDb.more(threshStats);
  return Math.max(1, base * Math.max(0.05, 1 + inc / 100) * more);
}

function withTemporaryCondition<T>(db: ModDB, name: string, value: boolean, fn: () => T): T {
  const conds = db.getEvalContext().conditions;
  const hadKey = Object.prototype.hasOwnProperty.call(conds, name);
  const prev = conds[name];
  conds[name] = value;
  try {
    return fn();
  } finally {
    if (hadKey) {
      conds[name] = prev!;
    } else {
      delete conds[name];
    }
  }
}

function resolvePoe2PreMitigationTypeAvg(
  dt: DamageType,
  input: AuthenticDotInput,
  flags: number,
  kwFlags: number,
): number {
  if (input.preMitigationHitByType && input.preMitigationHitByType[dt] !== undefined) {
    return Math.max(0, input.preMitigationHitByType[dt]!);
  }
  const baseVal = Math.max(0, input.baseDamageByType[dt] ?? 0);
  if (baseVal <= 0) return 0;
  const isEle = dt === 'Fire' || dt === 'Cold' || dt === 'Lightning';
  const statNames = ['Damage', `${dt}Damage`, ...(isEle ? ['ElementalDamage'] : [])];
  const inc = input.skillDb.sum('INC', statNames, flags, kwFlags);
  const more = input.skillDb.more(statNames, flags, kwFlags);
  const critFrac = clamp(input.critChancePct ?? 0, 0, 100) / 100;
  const critMult = Math.max(1, (input.critMultiplierPct ?? 200) / 100);
  const critEffect = 1 - critFrac + critFrac * critMult;
  return baseVal * Math.max(0, 1 + inc / 100) * more * critEffect;
}

/**
 * Computes PoB-authentic Poison (infinite PoE 1 stacks, Mamba single-poison cap, PoE 2 magnitude + stack caps),
 * Bleeding (stationary 70%, Moving/Aggravated 210%, Crimson Dance 35% * min(8, stacks), PoE 2 Bleed),
 * Ignite (PoE 1 & PoE 2), and `skillData`-driven non-ailment Spell/Ground DoTs.
 */
export function computeAuthenticAilmentAndSkillDots(input: AuthenticDotInput): AuthenticDotResult {
  const { game, skillDb, enemyDb, skillData, enemyConfig } = input;
  const flags = input.flags ?? ModFlag.Hit;
  const kwFlags = input.keywordFlags ?? 0;
  const isAttack = input.isAttack ?? (flags & ModFlag.Attack) !== 0;
  const isMelee = (flags & ModFlag.Melee) !== 0;
  const speed = Math.max(0, input.speed);
  const hitChanceFrac = clamp(input.hitChancePct ?? 100, 0, 100) / 100;
  const hitsPerUse = Math.max(1, input.hitsPerUse ?? 1);
  const effectiveHitRate = speed * hitChanceFrac * hitsPerUse;

  const critFrac = clamp(input.critChancePct ?? 0, 0, 100) / 100;
  const noCritAilments =
    skillDb.flag('NoCritAilments', flags, kwFlags) ||
    skillDb.flag('AilmentsAreNeverFromCrit', flags, kwFlags) ||
    skillDb.flag('ElementalOverload', flags, kwFlags);
  const dealNoPhys = skillDb.flag('DealNoPhysical', flags, kwFlags);
  const dealNoFire = skillDb.flag('DealNoFire', flags, kwFlags);
  const dealNoCold = skillDb.flag('DealNoCold', flags, kwFlags);
  const dealNoLight = skillDb.flag('DealNoLightning', flags, kwFlags);
  const dealNoEle =
    skillDb.flag('DealNoElemental', flags, kwFlags) ||
    (dealNoFire && dealNoCold && dealNoLight);
  const dealNoChaos = skillDb.flag('DealNoChaos', flags, kwFlags);
  const dealNoNonFire = skillDb.flag('DealNoNonFire', flags, kwFlags);

  // PoB CalcOffence.lua:4470,4743,5048 — Ailment damage scaling keeps ONLY Dot | Ailment | WeaponMask
  // (never double-dips Attack/Spell/Hit/Melee/Area/Projectile hit mods; Melee Physical Damage & Fortify
  // ailment cmods use the temporary `MeleeAilment` condition instead).
  const ailmentDamageFlags = ModFlag.Dot | ModFlag.Ailment | (flags & WEAPON_MOD_FLAGS);
  // Utility queries (Faster/Slower/Duration) match both hit-cfg (`cfg`) and ailment-cfg (`dotCfg`) modifiers.
  const ailmentUtilityFlags = flags | ModFlag.Ailment | ModFlag.Dot;
  const baseAilmentKw =
    (kwFlags & ~KeywordFlag.Hit) |
    KeywordFlag.Ailment |
    (isAttack ? KeywordFlag.Attack : 0) |
    ((flags & ModFlag.Spell) !== 0 ? KeywordFlag.Spell : 0);

  const isPoe1PerfectAgony =
    game === 'poe1' &&
    (skillDb.flag('PerfectAgony', flags, kwFlags) ||
      skillDb.flag('DotMultiplierIsCritMultiplier', flags, kwFlags));
  const nonCritsNoAilments =
    isPoe1PerfectAgony ||
    skillDb.flag('NonCritsCannotInflictAilments', flags, kwFlags) ||
    skillDb.flag('AilmentsOnlyFromCrit', flags, kwFlags);
  const rawCritMultiForPa = input.rawCritMultiplierPct ?? input.critMultiplierPct ?? 150;
  const enemySelfCritMulti = enemyDb.sum('BASE', 'SelfCritMultiplier', flags, kwFlags);
  const paRatio = (skillDb.sum('BASE', 'PerfectAgonyPct', flags, kwFlags) || 100) / 100;
  const paDotMultiOverride = isPoe1PerfectAgony
    ? Math.round((rawCritMultiForPa - 100) * paRatio + enemySelfCritMulti)
    : null;
  const legacyCritMultiToDegenPct =
    game === 'poe1' && !isPoe1PerfectAgony
      ? skillDb.sum('BASE', 'CritMultiplierAppliesToDegen', flags, kwFlags)
      : 0;
  const legacyCritMultiDegenBonus =
    legacyCritMultiToDegenPct > 0
      ? Math.max(0, Math.floor(((rawCritMultiForPa - 150) * legacyCritMultiToDegenPct) / 100))
      : 0;
  const debuffDurationMult = getEnemyDebuffDurationMult(enemyDb, flags, kwFlags);
  const POE_DOT_DPS_CAP = 35791394.13;

  // PoB1 CalcOffence.lua:3015-3029 — Ruthless Support average ailment damage multiplier
  const ruthlessBlowMaxCount =
    game === 'poe1' ? skillDb.sum('BASE', 'RuthlessBlowMaxCount', flags, kwFlags) : 0;
  const ruthlessBlowChanceFrac =
    ruthlessBlowMaxCount > 0 ? clamp(Math.round(100 / ruthlessBlowMaxCount), 0, 100) / 100 : 0;
  const ruthlessBlowAilmentMult =
    ruthlessBlowChanceFrac > 0
      ? 1 + skillDb.sum('BASE', 'RuthlessBlowAilmentMultiplier', flags, kwFlags) / 100
      : 1;
  const ruthlessBlowAilmentEffect =
    ruthlessBlowChanceFrac > 0
      ? 1 - ruthlessBlowChanceFrac + ruthlessBlowChanceFrac * ruthlessBlowAilmentMult
      : 1;

  // PoB1 CalcOffence.lua — Multistrike / Awakened Multistrike repeat damage multiplier for Ailments:
  // Single-stack ailments (Bleed without Crimson Dance, 1-stack Ignite, single-poison Mamba) keep the
  // highest-damage final repeat (RepeatTwoDamage +44% / RepeatThreeDamage +66%); multi-stack ailments
  // (Poison, Crimson Dance Bleed, multi-stack Ignite) average across all repeats.
  let finalRepeatAilmentMult = 1;
  let avgRepeatAilmentMult = 1;
  if (game === 'poe1' && !skillDb.flag('NoRepeatBonuses', flags, kwFlags)) {
    const repeatCountVal = Math.max(1, 1 + Math.round(skillDb.sum('BASE', 'RepeatCount', flags, kwFlags)));
    const r1More = skillDb.more('RepeatOneDamage', flags, kwFlags);
    const r2More = skillDb.more('RepeatTwoDamage', flags, kwFlags);
    const r3More = skillDb.more('RepeatThreeDamage', flags, kwFlags);
    if (r1More !== 1 || r2More !== 1 || r3More !== 1) {
      const hasThird = r3More !== 1 || repeatCountVal >= 4;
      finalRepeatAilmentMult = Math.max(1, r1More, r2More, hasThird ? r3More : 1);
      avgRepeatAilmentMult = hasThird
        ? (1 + r1More + r2More + r3More) / 4
        : (1 + r1More + r2More) / 3;
    }
  }

  const getPoe1ScaledBaseForAilment = (dt: DamageType, rollFrac: number): number => {
    const range = input.baseDamageRangeByType?.[dt];
    if (range && (range[0] > 0 || range[1] > 0)) {
      const minMore = skillDb.more(['MinDamage', `Min${dt}Damage`, `${dt}MinDamage`], flags, kwFlags);
      const maxMore = skillDb.more(['MaxDamage', `Max${dt}Damage`, `${dt}MaxDamage`], flags, kwFlags);
      const minInc = Math.max(
        0,
        1 + skillDb.sum('INC', [`Min${dt}Damage`, `${dt}MinDamage`], flags, kwFlags) / 100,
      );
      const maxInc = Math.max(
        0,
        1 + skillDb.sum('INC', [`Max${dt}Damage`, `${dt}MaxDamage`], flags, kwFlags) / 100,
      );
      const rMin = range[0] * minMore * minInc;
      const rMax = range[1] * maxMore * maxInc;
      return Math.max(0, rMin + (rMax - rMin) * rollFrac);
    }
    return Math.max(0, input.baseDamageByType[dt] ?? 0);
  };

  const computeAilmentRateMod = (
    fasterStats: readonly string[],
    slowerStats: readonly string[],
    enemySelfFasterStats: readonly string[],
    ailKw: number,
  ): number => {
    const fasterInc = skillDb.sum('INC', fasterStats, ailmentUtilityFlags, ailKw);
    const fasterMore = skillDb.more(fasterStats, ailmentUtilityFlags, ailKw);
    const enemySelfFaster = enemyDb.sum('INC', enemySelfFasterStats);
    const slowerInc = skillDb.sum('INC', slowerStats, ailmentUtilityFlags, ailKw);
    const slowerMore = skillDb.more(slowerStats, ailmentUtilityFlags, ailKw);
    const num = Math.max(0.05, Math.max(0.05, 1 + fasterInc / 100) * fasterMore + enemySelfFaster / 100);
    const den = Math.max(0.05, Math.max(0.05, 1 + slowerInc / 100) * slowerMore);
    return Math.max(0.1, num / den);
  };

  const computeAilmentEffectMod = (ailKw: number): number => {
    const effInc = skillDb.sum('INC', 'AilmentEffect', ailmentDamageFlags, ailKw);
    const effMore = skillDb.more('AilmentEffect', ailmentDamageFlags, ailKw);
    return Math.max(0, 1 + effInc / 100) * effMore;
  };

  const computePoe1DotMultiPair = (
    typeMultiStats: readonly string[],
    ailKw: number,
  ): { nonCritMulti: number; critMulti: number } => {
    if (paDotMultiOverride !== null) {
      const m = Math.max(0, 1 + paDotMultiOverride / 100);
      return { nonCritMulti: m, critMulti: m };
    }
    const evalMulti = (isCrit: boolean): number =>
      withTemporaryCondition(skillDb, 'CriticalStrike', isCrit, () => {
        const ov = skillDb.override('DotMultiplier', ailmentDamageFlags, ailKw);
        if (ov !== null) return Math.max(0, 1 + ov / 100);
        const total =
          skillDb.sum('BASE', 'DotMultiplier', ailmentDamageFlags, ailKw) +
          skillDb.sum('BASE', typeMultiStats, ailmentDamageFlags, ailKw) +
          (isCrit ? 50 + legacyCritMultiDegenBonus + skillDb.sum('BASE', 'CritAilmentDotMultiplier', ailmentDamageFlags, ailKw) : 0);
        return Math.max(0, 1 + total / 100);
      });
    const nonCritMulti = evalMulti(false);
    const critMulti = noCritAilments ? nonCritMulti : evalMulti(true);
    return { nonCritMulti, critMulti };
  };

  const weightByCrit = (
    chanceOnHitPct: number,
    chanceOnCritPct: number,
    sourceCritFrac: number,
    hitVal: number,
    critVal: number,
  ): number => {
    const cHit = chanceOnHitPct * (1 - sourceCritFrac);
    const cCrit = chanceOnCritPct * sourceCritFrac;
    const cSum = cHit + cCrit;
    if (cSum <= 0) return 0;
    return (hitVal * cHit + critVal * cCrit) / cSum;
  };

  const computeAppliedStacks = (ailmentChanceFrac: number, durationSec: number, perHitExtra = 1): number => {
    const base = hitChanceFrac * ailmentChanceFrac * perHitExtra * hitsPerUse;
    return speed > 0 ? base * speed * durationSec : base;
  };

  return withTemporaryCondition(skillDb, 'MeleeAilment', isMelee, () => {
    // -------------------------------------------------------------------------
    // 4.1 POISON (PoE 1 Infinite Stacks / Mamba Single-Poison / PoE 2 Magnitude & Stack Cap)
    // -------------------------------------------------------------------------
    const poisonKw = baseAilmentKw | KeywordFlag.Poison | KeywordFlag.Chaos;
    const cannotPoison =
      skillDb.flag('CannotPoison', flags, poisonKw) || enemyDb.flag('PoisonImmune');
    const enemyAvoidPoisonMult = Math.max(0, 1 - clamp(enemyDb.sum('BASE', 'AvoidPoison'), 0, 100) / 100);
    let poisonChanceOnHitPct = 0;
    let poisonChanceOnCritPct = 0;
    let chaosPoisonChancePct = 0;
    if (!cannotPoison && enemyAvoidPoisonMult > 0) {
      const evalPoisonChance = (isCrit: boolean): number =>
        withTemporaryCondition(skillDb, 'CriticalStrike', isCrit, () => {
          const chanceStats =
            game === 'poe2'
              ? ['PoisonChance', 'EnemyPoisonChance', 'AilmentChance']
              : ['PoisonChance', 'EnemyPoisonChance'];
          const base =
            skillDb.sum('BASE', chanceStats, flags, poisonKw) +
            enemyDb.sum('BASE', 'SelfPoisonChance') +
            (isCrit ? skillDb.sum('BASE', 'CritPoisonChance', flags, poisonKw) : 0);
          if (game === 'poe2') {
            const ov = skillDb.override('PoisonChance', flags, poisonKw);
            if (ov !== null) return clamp(ov * enemyAvoidPoisonMult, 0, 100);
            const inc = skillDb.sum('INC', chanceStats, flags, poisonKw);
            const more = skillDb.more(chanceStats, flags, poisonKw);
            return clamp(base * Math.max(0, 1 + inc / 100) * more * enemyAvoidPoisonMult, 0, 100);
          }
          return clamp(base * enemyAvoidPoisonMult, 0, 100);
        });
      poisonChanceOnHitPct = nonCritsNoAilments ? 0 : evalPoisonChance(false);
      poisonChanceOnCritPct = noCritAilments
        ? nonCritsNoAilments
          ? 0
          : poisonChanceOnHitPct
        : evalPoisonChance(true);
      if (game === 'poe1') {
        chaosPoisonChancePct = clamp(
          skillDb.sum('BASE', 'ChaosPoisonChance', flags, poisonKw) * enemyAvoidPoisonMult,
          0,
          100,
        );
      }
    }
    const effPoisonChanceOnHitPct = clamp(
      poisonChanceOnHitPct + ((input.baseDamageByType.Chaos ?? 0) > 0 && !nonCritsNoAilments ? chaosPoisonChancePct : 0),
      0,
      100,
    );
    const effPoisonChanceOnCritPct = clamp(
      poisonChanceOnCritPct + ((input.baseDamageByType.Chaos ?? 0) > 0 && !(noCritAilments && nonCritsNoAilments) ? chaosPoisonChancePct : 0),
      0,
      100,
    );
    const poisonChanceFrac =
      (effPoisonChanceOnHitPct / 100) * (1 - critFrac) + (effPoisonChanceOnCritPct / 100) * critFrac;
    const poisonChancePct = round2(poisonChanceFrac * 100);

    const allCanPoison = skillDb.flag('AllDamageCanPoison', flags, poisonKw);
    const poisonFasterMult = computeAilmentRateMod(
      ['AilmentFaster', 'PoisonFaster', 'AilmentDealDamageFaster', 'DamageFaster'],
      ['AilmentSlower', 'PoisonSlower'],
      ['SelfPoisonFaster'],
      poisonKw,
    );

    const cannotPoisonAlreadyPoisoned =
      skillDb.flag('CannotPoisonAlreadyPoisoned', flags, poisonKw) ||
      skillDb.flag('CannotMultiplePoison', flags, poisonKw) ||
      skillDb.flag('Condition:NonPoisonedOnly', flags, poisonKw) ||
      Boolean(skillData?.cannotPoisonAlreadyPoisoned);
    if (cannotPoisonAlreadyPoisoned) {
      skillDb.setCondition('NonPoisonedOnly', true);
    }

    // PoB1 CalcOffence.lua:4770-4773 — "inflict X additional poisons" (Poison Mastery / Herald / Ascendancy)
    const additionalPoisonStacks =
      game === 'poe1' && !cannotPoisonAlreadyPoisoned
        ? 1 +
          clamp(skillDb.sum('BASE', 'AdditionalPoisonChance', flags, poisonKw) / 100, 0, 1) +
          Math.max(0, skillDb.sum('BASE', 'AdditionalPoisonStacks', flags, poisonKw))
        : 1;

    const rawSkillDuration =
      typeof skillData?.duration === 'number' && skillData.duration > 0 ? skillData.duration : undefined;
    const poisonBaseDuration = Math.max(
      0.1,
      skillDb.override('PoisonDurationBase', ailmentUtilityFlags, poisonKw) ??
        skillData?.poisonDuration ??
        (skillData?.poisonDurationIsSkillDuration ? rawSkillDuration : undefined) ??
        2.0,
    );
    const poisonDurStats =
      input.skillHasDurationTag ||
      skillData?.durationAppliesToPoison ||
      Boolean(skillData?.poisonDurationIsSkillDuration) ||
      Boolean(skillData?.poisonIsSkillEffect)
        ? [
            'PoisonDuration',
            'AilmentDuration',
            'EnemyPoisonDuration',
            'EnemyAilmentDuration',
            'EnemyChaosAilmentDuration',
            'DamagingAilmentDuration',
            'DurationofDamagingAilmentsDuration',
            'Duration',
          ]
        : [
            'PoisonDuration',
            'AilmentDuration',
            'EnemyPoisonDuration',
            'EnemyAilmentDuration',
            'EnemyChaosAilmentDuration',
            'DamagingAilmentDuration',
            'DurationofDamagingAilmentsDuration',
          ];
    let poisonDurInc = skillDb.sum('INC', poisonDurStats, ailmentUtilityFlags, poisonKw);
    // PoE 1 Assassin `Toxic Delivery` (5% per Poison inflicted Recently, up to 100%)
    // & PoE 2 `Escalating Toxins` (10% per Poison inflicted Recently, up to 100%)
    const toxicDeliveryCap = skillDb.sum('BASE', 'ToxicDeliveryPoisonDurCap', ailmentUtilityFlags, poisonKw);
    if (toxicDeliveryCap > 0) {
      const configuredRecentPoisons =
        skillDb.getEvalContext().multipliers.PoisonAppliedRecently ??
        enemyDb.getEvalContext().multipliers.PoisonAppliedRecently;
      const poisonsAppliedRecently =
        configuredRecentPoisons !== undefined
          ? Math.max(0, configuredRecentPoisons)
          : poisonChanceFrac > 0 && effectiveHitRate > 0
            ? Math.floor(effectiveHitRate * poisonChanceFrac * additionalPoisonStacks * 4)
            : 0;
      const perRecentPoisonPct = game === 'poe2' ? 10 : 5;
      poisonDurInc += Math.min(toxicDeliveryCap, poisonsAppliedRecently * perRecentPoisonPct);
    }
    const poisonDurMore = skillDb.more(poisonDurStats, ailmentUtilityFlags, poisonKw);
    const enemyPoisonDurMod =
      Math.max(0, 1 + enemyDb.sum('INC', ['SelfPoisonDuration', 'SelfAilmentDuration']) / 100) *
      enemyDb.more(['SelfPoisonDuration', 'SelfAilmentDuration']);
    const effectivePoisonDurationSec =
      (poisonBaseDuration *
        Math.max(0.05, 1 + poisonDurInc / 100) *
        poisonDurMore *
        enemyPoisonDurMod *
        debuffDurationMult) /
      poisonFasterMult;

    let maxPoisonStacks: number;
    if (cannotPoisonAlreadyPoisoned) {
      maxPoisonStacks = 1;
    } else if (game === 'poe2') {
      const overridePoe2Stacks = skillDb.override('PoisonStacks', flags, poisonKw);
      if (overridePoe2Stacks !== null) {
        maxPoisonStacks = Math.max(1, Math.floor(overridePoe2Stacks));
      } else {
        const baseMax = skillData?.maxPoisonStacks ?? 1;
        const extraStacks = skillDb.sum(
          'BASE',
          ['AdditionalPoisonStack', 'MaxPoisonStacks', 'PoisonStacks', 'PoisonStacksMax'],
          flags,
          poisonKw,
        );
        const stackMore =
          skillDb.more('MaxPoisonStacks', flags, poisonKw) *
          skillDb.more('PoisonStacks', flags, poisonKw) *
          skillDb.more('PoisonStacksMax', flags, poisonKw) *
          (skillDb.flag('DoublePoisonStacks', flags, poisonKw) ? 2 : 1);
        maxPoisonStacks = Math.max(1, Math.floor((baseMax + extraStacks) * stackMore));
      }
    } else {
      const overrideMax =
        skillDb.override('MaxPoisonStacks', flags, poisonKw) ??
        skillDb.override('PoisonStackLimit', flags, poisonKw);
      maxPoisonStacks =
        overrideMax !== null
          ? Math.max(1, Math.floor(overrideMax))
          : skillData?.maxPoisonStacks !== undefined
            ? Math.max(1, Math.floor(skillData.maxPoisonStacks))
            : Number.POSITIVE_INFINITY;
    }

    let singleStackPoisonDps = 0;
    let effectivePoisonStacks = 0;

    if (poisonChanceFrac > 0) {
      const enemyChaosRes = getEnemyResistForDot('Chaos', enemyDb, enemyConfig, ailmentDamageFlags, poisonKw);
      const enemyChaosResMult = Math.max(0.05, 1 - enemyChaosRes / 100);
      const enemyChaosTakenMult = getEnemyDotTakenMult(
        'Chaos',
        'PoisonDamageTaken',
        enemyDb,
        ailmentDamageFlags,
        poisonKw,
      );
      const poisonEnemyMult = enemyChaosResMult * enemyChaosTakenMult;
      const poisonEffectMod = computeAilmentEffectMod(poisonKw);
      // PoB2 CalcOffence.lua:5255,5268-5270 — configured poison stacks override (`multiplierPoisonOnEnemy`)
      const configPoisonStacks =
        game === 'poe2'
          ? Math.max(
              0,
              enemyDb.sum('BASE', 'Multiplier:PoisonStacks'),
              enemyDb.getEvalContext().multipliers.PoisonStacks ?? 0,
              skillDb.getEvalContext().multipliers.PoisonStacks ?? 0,
            )
          : 0;
      const uncappedStacks =
        configPoisonStacks > 0
          ? configPoisonStacks
          : computeAppliedStacks(
              poisonChanceFrac,
              effectivePoisonDurationSec,
              additionalPoisonStacks,
            );

      if (game === 'poe2') {
        const poisonTypes: DamageType[] = [];
        if (!dealNoPhys && !dealNoNonFire) poisonTypes.push('Physical');
        if (!dealNoChaos && !dealNoNonFire) poisonTypes.push('Chaos');
        if (!dealNoEle) {
          for (const el of ['Fire', 'Cold', 'Lightning'] as const) {
            if (dealNoNonFire && el !== 'Fire') continue;
            if ((el === 'Fire' && dealNoFire) || (el === 'Cold' && dealNoCold) || (el === 'Lightning' && dealNoLight)) {
              continue;
            }
            if (allCanPoison || skillDb.flag(`${el}CanPoison`, flags, poisonKw)) {
              poisonTypes.push(el);
            }
          }
        }
        let preTotal = 0;
        let rMin = 0;
        let rMax = 0;
        let rAvg = 0;
        for (const dt of poisonTypes) {
          preTotal += resolvePoe2PreMitigationTypeAvg(dt, input, flags, kwFlags);
          const r = input.hitDamageRangeByType?.[dt];
          if (r && r.average > 0) {
            rMin += r.min;
            rMax += r.max;
            rAvg += r.average;
          }
        }
        if (preTotal > 0) {
          // PoB2 CalcOffence.lua:5306-5358 — order-statistic roll average & over-stack crit probability
          const stackPotential = Number.isFinite(maxPoisonStacks) && maxPoisonStacks > 0 ? uncappedStacks / maxPoisonStacks : 0;
          const rollAvgFrac =
            Number.isFinite(maxPoisonStacks) && stackPotential > 1
              ? clamp((uncappedStacks - (maxPoisonStacks - 1) / 2) / (uncappedStacks + 1), 0.5, 1)
              : 0.5;
          const rollUplift =
            rAvg > 0 && rMax > rMin && rollAvgFrac !== 0.5
              ? (rMin + (rMax - rMin) * rollAvgFrac) / rAvg
              : 1;
          const baseCritMult = noCritAilments ? 1 : Math.max(1, (input.critMultiplierPct ?? 200) / 100);
          const baseCritEff = 1 - critFrac + critFrac * baseCritMult;
          const nonCritPre = baseCritEff > 0 ? preTotal / baseCritEff : preTotal;
          const overCritFrac =
            critFrac > 0 && critFrac < 1 && stackPotential > 1
              ? 1 - Math.pow(Math.max(0, 1 - critFrac), Math.max(1, stackPotential))
              : critFrac;
          const evalPoisonMagMult = (isCrit: boolean): number =>
            withTemporaryCondition(skillDb, 'CriticalStrike', isCrit, () => {
              const magInc = skillDb.sum('INC', ['AilmentMagnitude', 'PoisonMagnitude'], ailmentDamageFlags, poisonKw);
              const magMore = skillDb.more(['AilmentMagnitude', 'PoisonMagnitude'], ailmentDamageFlags, poisonKw);
              return Math.max(0, 1 + magInc / 100) * magMore;
            });
          const nonCritMagMult = evalPoisonMagMult(false);
          const critMagMult = noCritAilments ? nonCritMagMult : evalPoisonMagMult(true);
          const effectivePreMagTotal = weightByCrit(
            effPoisonChanceOnHitPct,
            effPoisonChanceOnCritPct,
            overCritFrac,
            nonCritPre * nonCritMagMult,
            nonCritPre * baseCritMult * critMagMult,
          );
          singleStackPoisonDps =
            0.2 *
            effectivePreMagTotal *
            rollUplift *
            poisonEffectMod *
            poisonFasterMult *
            poisonEnemyMult;
        }
      } else {
        // PoE 1: 0.30 * base(Phys + Chaos [+ Ele if CanPoison]) scaled by type/Chaos/Poison/Ailment INC & MORE
        const { nonCritMulti, critMulti } = computePoe1DotMultiPair(
          ['ChaosDotMultiplier', 'PoisonDotMultiplier'],
          poisonKw,
        );
        const basePhys = dealNoPhys || dealNoNonFire ? 0 : getPoe1ScaledBaseForAilment('Physical', 0.5);
        const baseChaos = dealNoChaos || dealNoNonFire ? 0 : getPoe1ScaledBaseForAilment('Chaos', 0.5);
        const nonChaosWeight =
          chaosPoisonChancePct > 0 && baseChaos > 0 && effPoisonChanceOnHitPct > 0
            ? poisonChanceOnHitPct / effPoisonChanceOnHitPct
            : 1;

        let scaledBase = 0;
        if (baseChaos > 0) {
          const names = ['Damage', 'ChaosDamage', 'DotDamage', 'PoisonDamage'];
          const inc = skillDb.sum('INC', names, ailmentDamageFlags, poisonKw);
          const more = skillDb.more(names, ailmentDamageFlags, poisonKw);
          scaledBase += baseChaos * Math.max(0, 1 + inc / 100) * more;
        }
        if (basePhys > 0) {
          const names = ['Damage', 'PhysicalDamage', 'ChaosDamage', 'DotDamage', 'PoisonDamage'];
          const inc = skillDb.sum('INC', names, ailmentDamageFlags, poisonKw);
          const more = skillDb.more(names, ailmentDamageFlags, poisonKw);
          scaledBase += basePhys * nonChaosWeight * Math.max(0, 1 + inc / 100) * more;
        }
        if (!dealNoEle) {
          for (const el of ['Fire', 'Cold', 'Lightning'] as const) {
            if (dealNoNonFire && el !== 'Fire') continue;
            if ((el === 'Fire' && dealNoFire) || (el === 'Cold' && dealNoCold) || (el === 'Lightning' && dealNoLight)) {
              continue;
            }
            if (!allCanPoison && !skillDb.flag(`${el}CanPoison`, flags, poisonKw)) continue;
            const baseEl = getPoe1ScaledBaseForAilment(el, 0.5);
            if (baseEl <= 0) continue;
            const names = ['Damage', 'ElementalDamage', `${el}Damage`, 'ChaosDamage', 'DotDamage', 'PoisonDamage'];
            const inc = skillDb.sum('INC', names, ailmentDamageFlags, poisonKw);
            const more = skillDb.more(names, ailmentDamageFlags, poisonKw);
            scaledBase += baseEl * nonChaosWeight * Math.max(0, 1 + inc / 100) * more;
          }
        }

        if (scaledBase > 0) {
          const weightedSource = weightByCrit(
            effPoisonChanceOnHitPct,
            effPoisonChanceOnCritPct,
            critFrac,
            scaledBase * nonCritMulti,
            scaledBase * critMulti,
          );
          const poisonRepeatMult = cannotPoisonAlreadyPoisoned
            ? finalRepeatAilmentMult
            : avgRepeatAilmentMult;
          singleStackPoisonDps =
            0.3 *
            weightedSource *
            ruthlessBlowAilmentEffect *
            poisonRepeatMult *
            poisonEffectMod *
            poisonFasterMult *
            poisonEnemyMult;
        }
      }

      if (singleStackPoisonDps > 0) {
        effectivePoisonStacks = Number.isFinite(maxPoisonStacks)
          ? Math.min(maxPoisonStacks, uncappedStacks)
          : uncappedStacks;
      }
    }

    const totalPoisonDps = Math.min(POE_DOT_DPS_CAP, singleStackPoisonDps * effectivePoisonStacks);
    const causticGroundPct = Math.max(
      skillDb.max('PoisonDpsAsCausticGround', ailmentDamageFlags, poisonKw) ?? 0,
      enemyDb.max('PoisonDpsAsCausticGround') ?? 0,
      skillDb.sum('BASE', 'PoisonDpsAsCausticGround', ailmentDamageFlags, poisonKw),
      enemyDb.sum('BASE', 'PoisonDpsAsCausticGround'),
    );
    const causticGroundDps =
      singleStackPoisonDps > 0 && causticGroundPct > 0
        ? Math.min(POE_DOT_DPS_CAP, (singleStackPoisonDps * causticGroundPct) / 100)
        : 0;

    // -------------------------------------------------------------------------
    // 4.2 BLEEDING (PoE 1 Stationary 70% / Moving & Aggravated 210% / Crimson Dance 35% * min(8, stacks); PoE 2 Bleed)
    // -------------------------------------------------------------------------
    const bleedKw = baseAilmentKw | KeywordFlag.Bleed | KeywordFlag.Physical;
    const cannotBleed =
      skillDb.flag('CannotBleed', flags, bleedKw) || enemyDb.flag('BleedImmune');
    const enemyAvoidBleedMult = Math.max(0, 1 - clamp(enemyDb.sum('BASE', 'AvoidBleed'), 0, 100) / 100);
    let bleedChanceOnHitPct = 0;
    let bleedChanceOnCritPct = 0;
    if (!cannotBleed && enemyAvoidBleedMult > 0) {
      const evalBleedChance = (isCrit: boolean): number =>
        withTemporaryCondition(skillDb, 'CriticalStrike', isCrit, () => {
          const chanceStats =
            game === 'poe2'
              ? ['BleedChance', 'EnemyBleedChance', 'AilmentChance']
              : ['BleedChance', 'EnemyBleedChance'];
          const base =
            skillDb.sum('BASE', chanceStats, flags, bleedKw) +
            enemyDb.sum('BASE', 'SelfBleedChance') +
            (isCrit ? skillDb.sum('BASE', 'CritBleedChance', flags, bleedKw) : 0);
          if (game === 'poe2') {
            const ov = skillDb.override('BleedChance', flags, bleedKw);
            if (ov !== null) return clamp(ov * enemyAvoidBleedMult, 0, 100);
            const inc = skillDb.sum('INC', chanceStats, flags, bleedKw);
            const more = skillDb.more(chanceStats, flags, bleedKw);
            return clamp(base * Math.max(0, 1 + inc / 100) * more * enemyAvoidBleedMult, 0, 100);
          }
          return clamp(base * enemyAvoidBleedMult, 0, 100);
        });
      bleedChanceOnHitPct = nonCritsNoAilments ? 0 : evalBleedChance(false);
      bleedChanceOnCritPct = noCritAilments
        ? nonCritsNoAilments
          ? 0
          : bleedChanceOnHitPct
        : evalBleedChance(true);
    }
    const bleedChanceFrac =
      (bleedChanceOnHitPct / 100) * (1 - critFrac) + (bleedChanceOnCritPct / 100) * critFrac;
    const bleedChancePct = round2(bleedChanceFrac * 100);

    const isCrimsonDance =
      game === 'poe1' && Boolean(input.crimsonDance || skillDb.flag('CrimsonDance', flags, bleedKw));
    const isAggravatedOrMoving =
      !isCrimsonDance &&
      Boolean(
        input.enemyMovingOrAggravated ||
          enemyConfig?.enemyMoving ||
          enemyConfig?.enemyAggravatedBleed ||
          skillDb.flag('BleedAlwaysAggravated', flags, bleedKw) ||
          skillDb.flag('AggravatedBleed', flags, bleedKw) ||
          skillDb.flag('AggravatedBleeding', flags, bleedKw) ||
          skillDb.flag('EnemyMoving', flags, bleedKw) ||
          skillDb.getEvalContext().conditions.EnemyMoving ||
          enemyDb.getEvalContext().conditions.Moving,
      );

    const bleedFasterMult = computeAilmentRateMod(
      ['AilmentFaster', 'BleedFaster', 'AilmentDealDamageFaster', 'DamageFaster'],
      ['AilmentSlower', 'BleedSlower'],
      ['SelfBleedFaster'],
      bleedKw,
    );

    const bleedBaseDuration = Math.max(
      0.1,
      skillDb.override('BleedDurationBase', ailmentUtilityFlags, bleedKw) ??
        skillData?.bleedDuration ??
        (skillData?.bleedDurationIsSkillDuration ? rawSkillDuration : undefined) ??
        5.0,
    );
    const bleedDurStats = skillData?.bleedIsSkillEffect
      ? [
          'BleedDuration',
          'AilmentDuration',
          'EnemyBleedDuration',
          'EnemyAilmentDuration',
          'DamagingAilmentDuration',
          'DurationofDamagingAilmentsDuration',
          'Duration',
        ]
      : [
          'BleedDuration',
          'AilmentDuration',
          'EnemyBleedDuration',
          'EnemyAilmentDuration',
          'DamagingAilmentDuration',
          'DurationofDamagingAilmentsDuration',
        ];
    const bleedDurInc = skillDb.sum('INC', bleedDurStats, ailmentUtilityFlags, bleedKw);
    const bleedDurMore = skillDb.more(bleedDurStats, ailmentUtilityFlags, bleedKw);
    const enemyBleedDurMod =
      Math.max(0, 1 + enemyDb.sum('INC', ['SelfBleedDuration', 'SelfAilmentDuration']) / 100) *
      enemyDb.more(['SelfBleedDuration', 'SelfAilmentDuration']);
    const enemyBleedExpireRate = Math.max(
      0.1,
      Math.max(0.1, 1 + enemyDb.sum('INC', 'BleedExpireRate', ailmentDamageFlags, bleedKw) / 100) *
        enemyDb.more('BleedExpireRate', ailmentDamageFlags, bleedKw),
    );
    const effectiveBleedDurationSec =
      ((bleedBaseDuration * Math.max(0.05, 1 + bleedDurInc / 100) * bleedDurMore * enemyBleedDurMod) /
        enemyBleedExpireRate /
        bleedFasterMult) *
      debuffDurationMult;

    let maxBleedStacks = isCrimsonDance ? 8 : 1;
    if (game === 'poe2') {
      if (skillDb.flag('BleedCanStack', flags, bleedKw)) {
        const ov = skillDb.override('BleedStacks', flags, bleedKw);
        maxBleedStacks =
          ov !== null
            ? Math.max(1, Math.floor(ov))
            : Math.max(
                1,
                Math.floor(
                  (1 + skillDb.sum('BASE', 'BleedStacks', flags, bleedKw)) *
                    skillDb.more('BleedStacks', flags, bleedKw),
                ),
              );
      }
    } else if (!isCrimsonDance) {
      const ovMax = skillDb.override('BleedStacksMax', flags, bleedKw);
      const baseMax = skillDb.sum('BASE', 'BleedStacksMax', flags, bleedKw);
      if (ovMax !== null) maxBleedStacks = Math.max(1, Math.floor(ovMax));
      else if (baseMax > 1) maxBleedStacks = Math.max(1, Math.floor(baseMax));
    }

    let singleStackBleedDps = 0;
    let effectiveBleedStacks = 0;

    const eleCanBleed =
      game === 'poe2' &&
      (skillDb.flag('ElementalCanBleed', flags, bleedKw) ||
        skillDb.flag('AllDamageCanBleed', flags, bleedKw));
    const chaosCanBleed =
      game === 'poe2' &&
      (skillDb.flag('ChaosCanBleed', flags, bleedKw) ||
        skillDb.flag('AllDamageCanBleed', flags, bleedKw));
    const anyAltBleedSource =
      eleCanBleed ||
      chaosCanBleed ||
      (game === 'poe2' &&
        (skillDb.flag('FireCanBleed', flags, bleedKw) ||
          skillDb.flag('ColdCanBleed', flags, bleedKw) ||
          skillDb.flag('LightningCanBleed', flags, bleedKw)));

    if ((isAttack || game === 'poe2') && ((!dealNoPhys && !dealNoNonFire) || anyAltBleedSource) && bleedChanceFrac > 0) {
      const enemyPhysPdr = getEnemyResistForDot('Physical', enemyDb, enemyConfig, ailmentDamageFlags, bleedKw);
      const enemyPhysResMult = Math.max(0.05, 1 - enemyPhysPdr / 100);
      const enemyPhysTakenMult =
        enemyPhysResMult *
        getEnemyDotTakenMult('Physical', 'BleedDamageTaken', enemyDb, ailmentDamageFlags, bleedKw);
      const bleedEffectMod = computeAilmentEffectMod(bleedKw);
      const configBleedStacks = Math.max(
        0,
        enemyDb.sum('BASE', 'Multiplier:BleedStacks'),
        enemyDb.getEvalContext().multipliers.BleedStacks ?? 0,
      );
      const bleedStacks =
        configBleedStacks > 0
          ? configBleedStacks
          : computeAppliedStacks(bleedChanceFrac, effectiveBleedDurationSec);
      const bleedStackPotential = bleedStacks / maxBleedStacks;
      // PoB1 CalcOffence.lua:4539-4545 & PoB2 CalcOffence.lua:5306-5312
      const bleedRollFrac =
        bleedStackPotential > 1
          ? clamp((bleedStacks - (maxBleedStacks - 1) / 2) / (bleedStacks + 1), 0.5, 1)
          : 0.5;
      // PoB1 CalcOffence.lua:4620 & PoB2 CalcOffence.lua:5352 — over-stacking crit probability
      const bleedOverCritFrac =
        critFrac > 0 && critFrac < 1 && bleedStackPotential > 1
          ? 1 - Math.pow(Math.max(0, 1 - critFrac), Math.max(1, bleedStackPotential))
          : critFrac;

      if (game === 'poe2') {
        const bleedTypes: DamageType[] = [];
        if (!dealNoPhys && !dealNoNonFire) bleedTypes.push('Physical');
        if (!dealNoEle) {
          for (const el of ['Fire', 'Cold', 'Lightning'] as const) {
            if (dealNoNonFire && el !== 'Fire') continue;
            if ((el === 'Fire' && dealNoFire) || (el === 'Cold' && dealNoCold) || (el === 'Lightning' && dealNoLight)) {
              continue;
            }
            if (eleCanBleed || skillDb.flag(`${el}CanBleed`, flags, bleedKw)) {
              bleedTypes.push(el);
            }
          }
        }
        if (chaosCanBleed && !dealNoChaos && !dealNoNonFire) {
          bleedTypes.push('Chaos');
        }
        let preBleedTotal = 0;
        let rMin = 0;
        let rMax = 0;
        let rAvg = 0;
        for (const dt of bleedTypes) {
          preBleedTotal += resolvePoe2PreMitigationTypeAvg(dt, input, flags, kwFlags);
          const r = input.hitDamageRangeByType?.[dt];
          if (r && r.average > 0) {
            rMin += r.min;
            rMax += r.max;
            rAvg += r.average;
          }
        }
        if (preBleedTotal > 0) {
          const rollUplift =
            rAvg > 0 && rMax > rMin && bleedRollFrac !== 0.5
              ? (rMin + (rMax - rMin) * bleedRollFrac) / rAvg
              : 1;
          const baseCritMult = noCritAilments ? 1 : Math.max(1, (input.critMultiplierPct ?? 200) / 100);
          const baseCritEff = 1 - critFrac + critFrac * baseCritMult;
          const nonCritPre = baseCritEff > 0 ? preBleedTotal / baseCritEff : preBleedTotal;
          const evalBleedMagMult = (isCrit: boolean): number =>
            withTemporaryCondition(skillDb, 'CriticalStrike', isCrit, () => {
              const magInc = skillDb.sum(
                'INC',
                ['AilmentMagnitude', 'BleedingMagnitude', 'BleedMagnitude'],
                ailmentDamageFlags,
                bleedKw,
              );
              const magMore = skillDb.more(
                ['AilmentMagnitude', 'BleedingMagnitude', 'BleedMagnitude'],
                ailmentDamageFlags,
                bleedKw,
              );
              return Math.max(0, 1 + magInc / 100) * magMore;
            });
          const nonCritMagMult = evalBleedMagMult(false);
          const critMagMult = noCritAilments ? nonCritMagMult : evalBleedMagMult(true);
          const effectivePreMagBleed = weightByCrit(
            bleedChanceOnHitPct,
            bleedChanceOnCritPct,
            bleedOverCritFrac,
            nonCritPre * nonCritMagMult,
            nonCritPre * baseCritMult * critMagMult,
          );
          const baseCoeff = isAggravatedOrMoving ? 0.3 : 0.15;
          singleStackBleedDps =
            baseCoeff *
            effectivePreMagBleed *
            rollUplift *
            bleedEffectMod *
            bleedFasterMult *
            enemyPhysTakenMult;
        }
      } else {
        const basePhys = getPoe1ScaledBaseForAilment('Physical', bleedRollFrac);
        if (basePhys > 0) {
          const { nonCritMulti, critMulti } = computePoe1DotMultiPair(
            ['PhysicalDotMultiplier', 'BleedDotMultiplier'],
            bleedKw,
          );
          const names = ['Damage', 'PhysicalDamage', 'DotDamage', 'BleedDamage'];
          const inc = skillDb.sum('INC', names, ailmentDamageFlags, bleedKw);
          const more = skillDb.more(names, ailmentDamageFlags, bleedKw);
          const scaledBase = basePhys * Math.max(0, 1 + inc / 100) * more;
          const weightedSource = weightByCrit(
            bleedChanceOnHitPct,
            bleedChanceOnCritPct,
            bleedOverCritFrac,
            scaledBase * nonCritMulti,
            scaledBase * critMulti,
          );
          const customBasePct =
            typeof skillData?.bleedBasePercent === 'number' && skillData.bleedBasePercent > 0
              ? skillData.bleedBasePercent / 100
              : null;
          // Guard against double-halving when Crimson Dance's explicit "50% less Damage with Bleeding"
          // passive-tree line is already present in `more` (DotDamage/BleedDamage MORE -50 with KeywordFlag.Bleed).
          const hasExplicitCrimsonDanceLess =
            isCrimsonDance &&
            skillDb.more(['DotDamage', 'BleedDamage'], ailmentDamageFlags, bleedKw) <= 0.5001;
          const baseCoeff = isCrimsonDance
            ? hasExplicitCrimsonDanceLess
              ? (customBasePct ?? 0.7)
              : (customBasePct ?? 0.7) * 0.5
            : isAggravatedOrMoving
              ? (customBasePct ?? 0.7) * 3
              : (customBasePct ?? 0.7);

          const bleedRepeatMult = isCrimsonDance ? avgRepeatAilmentMult : finalRepeatAilmentMult;
          singleStackBleedDps =
            baseCoeff *
            weightedSource *
            ruthlessBlowAilmentEffect *
            bleedRepeatMult *
            bleedEffectMod *
            bleedFasterMult *
            enemyPhysTakenMult;
        }
      }

      if (singleStackBleedDps > 0) {
        // PoB1 CalcOffence.lua:4641 & PoB2 CalcOffence.lua:5399 — activeBleeds = min(bleedStacks, maxStacks)
        effectiveBleedStacks = Math.min(maxBleedStacks, bleedStacks);
      }
    }

    const totalBleedDps = Math.min(POE_DOT_DPS_CAP, singleStackBleedDps * effectiveBleedStacks);

    // -------------------------------------------------------------------------
    // 4.3 IGNITE (PoE 1 & PoE 2)
    // -------------------------------------------------------------------------
    const igniteToChaos = Boolean(
      skillData?.IgniteToChaos ||
        skillDb.flag('IgniteToChaos', flags, baseAilmentKw | KeywordFlag.Ignite) ||
        skillDb.flag('IgniteDealsChaosDamage', flags, baseAilmentKw | KeywordFlag.Ignite),
    );
    const igniteKw = baseAilmentKw | KeywordFlag.Ignite | (igniteToChaos ? KeywordFlag.Chaos : KeywordFlag.Fire);
    const cannotIgnite =
      skillDb.flag('CannotIgnite', flags, igniteKw) ||
      enemyDb.flag('IgniteImmune') ||
      enemyDb.flag('ElementalAilmentImmune');
    const enemyAvoidIgniteMult = Math.max(
      0,
      1 - clamp(enemyDb.sum('BASE', ['AvoidIgnite', 'AvoidAilments', 'AvoidElementalAilments']), 0, 100) / 100,
    );
    const allCanIgnite = skillDb.flag('AllDamageCanIgnite', flags, igniteKw);
    const fireCannotIgnite = skillDb.flag('FireCannotIgnite', flags, igniteKw);
    const physCanIgnite = allCanIgnite || skillDb.flag('PhysicalCanIgnite', flags, igniteKw);
    const coldCanIgnite = allCanIgnite || skillDb.flag('ColdCanIgnite', flags, igniteKw);
    const lightCanIgnite = allCanIgnite || skillDb.flag('LightningCanIgnite', flags, igniteKw);
    const chaosCanIgnite =
      allCanIgnite ||
      skillDb.flag('ChaosContributesToIgnite', flags, igniteKw) ||
      skillDb.flag('ChaosCanIgnite', flags, igniteKw);

    // Precompute PoE 2 unmitigated ignite source damage for scaling threshold ignite chance (CalcOffence.lua:5614-5635)
    let poe2IgnitePreTotal = 0;
    const poe2IgniteTypes: DamageType[] = [];
    if (game === 'poe2' && !cannotIgnite) {
      if (!dealNoEle && !dealNoFire && !fireCannotIgnite) poe2IgniteTypes.push('Fire');
      if (!dealNoNonFire) {
        if (physCanIgnite && !dealNoPhys) poe2IgniteTypes.push('Physical');
        if (!dealNoEle) {
          if (coldCanIgnite && !dealNoCold) poe2IgniteTypes.push('Cold');
          if (lightCanIgnite && !dealNoLight) poe2IgniteTypes.push('Lightning');
        }
        if (chaosCanIgnite && !dealNoChaos) poe2IgniteTypes.push('Chaos');
      }
      for (const dt of poe2IgniteTypes) {
        poe2IgnitePreTotal += resolvePoe2PreMitigationTypeAvg(dt, input, flags, kwFlags);
      }
    }

    let igniteChanceOnHitPct = 0;
    let igniteChanceOnCritPct = 0;
    if (!cannotIgnite && enemyAvoidIgniteMult > 0) {
      if (game === 'poe2') {
        const baseChance =
          skillDb.sum('BASE', ['IgniteChance', 'EnemyIgniteChance', 'AilmentChance'], flags, igniteKw) +
          enemyDb.sum('BASE', 'SelfIgniteChance');
        const incChance =
          skillDb.sum('INC', ['IgniteChance', 'EnemyIgniteChance', 'AilmentChance'], flags, igniteKw) +
          enemyDb.sum('INC', 'SelfIgniteChance');
        const moreChance =
          skillDb.more(['IgniteChance', 'EnemyIgniteChance', 'AilmentChance'], flags, igniteKw) *
          enemyDb.more('SelfIgniteChance');
        const useThresholdChance = Boolean(enemyConfig) && poe2IgnitePreTotal > 0;
        const baseCritMult = noCritAilments ? 1 : Math.max(1, (input.critMultiplierPct ?? 200) / 100);
        const baseCritEff = 1 - critFrac + critFrac * baseCritMult;
        const nonCritHitAvg = baseCritEff > 0 ? poe2IgnitePreTotal / baseCritEff : poe2IgnitePreTotal;
        const critHitAvg = nonCritHitAvg * baseCritMult;
        const enemyThreshold = getPoe2EnemyAilmentThreshold(enemyConfig?.enemyLevel ?? 82, enemyDb);
        const threshHitPct = useThresholdChance ? (nonCritHitAvg / enemyThreshold) * 20 : 0;
        const threshCritPct = useThresholdChance ? (critHitAvg / enemyThreshold) * 20 : 0;
        igniteChanceOnHitPct = nonCritsNoAilments
          ? 0
          : clamp(
              (threshHitPct + baseChance) * Math.max(0, 1 + incChance / 100) * moreChance * enemyAvoidIgniteMult,
              0,
              100,
            );
        igniteChanceOnCritPct = clamp(
          (threshCritPct + baseChance) * Math.max(0, 1 + incChance / 100) * moreChance * enemyAvoidIgniteMult,
          0,
          100,
        );
      } else {
        const critsDontAlwaysIgnite = skillDb.flag('CritsDontAlwaysIgnite', flags, igniteKw);
        const rawHitChance = withTemporaryCondition(skillDb, 'CriticalStrike', false, () =>
          clamp(
            (skillDb.sum('BASE', ['IgniteChance', 'EnemyIgniteChance'], flags, igniteKw) +
              enemyDb.sum('BASE', 'SelfIgniteChance')) *
              enemyAvoidIgniteMult,
            0,
            100,
          ),
        );
        igniteChanceOnHitPct = nonCritsNoAilments ? 0 : rawHitChance;
        if (noCritAilments) {
          // PoB1 CalcOffence.lua:4349-4352 (Elemental Overload): ChanceOnCrit = AilmentsOnlyFromCrit ? 0 : ChanceOnHit
          igniteChanceOnCritPct = nonCritsNoAilments ? 0 : igniteChanceOnHitPct;
        } else if (critsDontAlwaysIgnite) {
          const critExtra = withTemporaryCondition(skillDb, 'CriticalStrike', true, () =>
            clamp(
              (skillDb.sum('BASE', ['IgniteChance', 'EnemyIgniteChance', 'CritIgniteChance'], flags, igniteKw) +
                enemyDb.sum('BASE', 'SelfIgniteChance')) *
                enemyAvoidIgniteMult,
              0,
              100,
            ),
          );
          igniteChanceOnCritPct = critExtra;
        } else {
          igniteChanceOnCritPct = clamp(100 * enemyAvoidIgniteMult, 0, 100);
        }
      }
    }
    const effIgniteChanceFrac =
      (igniteChanceOnHitPct / 100) * (1 - critFrac) + (igniteChanceOnCritPct / 100) * critFrac;

    const igniteFasterMult = computeAilmentRateMod(
      ['AilmentFaster', 'IgniteFaster', 'IgniteBurnFaster', 'AilmentDealDamageFaster', 'DamageFaster'],
      ['AilmentSlower', 'IgniteSlower', 'IgniteBurnSlower'],
      ['SelfIgniteBurnFaster', 'SelfIgniteFaster'],
      igniteKw,
    );

    const igniteBaseDuration = Math.max(
      0.1,
      skillDb.override('IgniteDurationBase', ailmentUtilityFlags, igniteKw) ??
        skillData?.igniteDuration ??
        4.0,
    );
    const igniteDurStats = [
      'IgniteDuration',
      'AilmentDuration',
      'EnemyIgniteDuration',
      'EnemyAilmentDuration',
      'EnemyElementalAilmentDuration',
      'DamagingAilmentDuration',
      'DurationofDamagingAilmentsDuration',
    ];
    const igniteDurInc = skillDb.sum('INC', igniteDurStats, ailmentUtilityFlags, igniteKw);
    const igniteDurMore = skillDb.more(igniteDurStats, ailmentUtilityFlags, igniteKw);
    const enemyIgniteDurMod =
      Math.max(
        0,
        1 +
          enemyDb.sum('INC', ['SelfIgniteDuration', 'SelfAilmentDuration', 'SelfElementalAilmentDuration']) / 100,
      ) * enemyDb.more(['SelfIgniteDuration', 'SelfAilmentDuration', 'SelfElementalAilmentDuration']);
    const effectiveIgniteDurationSec =
      (igniteBaseDuration *
        Math.max(0.05, 1 + igniteDurInc / 100) *
        igniteDurMore *
        enemyIgniteDurMod *
        debuffDurationMult) /
      igniteFasterMult;

    let maxIgniteStacks = 1;
    const igniteCanStack = skillDb.flag('IgniteCanStack', flags, igniteKw);
    const extraIgniteStacks = skillDb.sum('BASE', 'AdditionalIgniteStack', flags, igniteKw);
    if (igniteCanStack || extraIgniteStacks > 0) {
      const ovIgniteStacks =
        skillDb.override('IgniteStacks', flags, igniteKw) ??
        skillDb.override('IgniteStacksMax', flags, igniteKw);
      if (ovIgniteStacks !== null) {
        maxIgniteStacks = Math.max(1, Math.floor(ovIgniteStacks));
      } else {
        const baseExtra =
          extraIgniteStacks + (igniteCanStack ? skillDb.sum('BASE', 'IgniteStacks', flags, igniteKw) : 0);
        const stackMore = igniteCanStack ? skillDb.more('IgniteStacks', flags, igniteKw) : 1;
        maxIgniteStacks = Math.max(1, Math.floor((1 + baseExtra) * stackMore));
      }
    }

    let singleStackIgniteDps = 0;
    let effectiveIgniteStacks = 0;
    let igniteBurningGroundBase = 0;

    const canDealAnyIgnite =
      game === 'poe2' ? poe2IgnitePreTotal > 0 : !dealNoEle && !dealNoFire;

    if (!cannotIgnite && canDealAnyIgnite && effIgniteChanceFrac > 0) {
      const igniteDmgElement: DamageType = igniteToChaos ? 'Chaos' : 'Fire';
      const enemyIgniteRes = getEnemyResistForDot(igniteDmgElement, enemyDb, enemyConfig, ailmentDamageFlags, igniteKw);
      const enemyIgniteResMult = Math.max(0.05, 1 - enemyIgniteRes / 100);
      const enemyIgniteTakenMult = getEnemyDotTakenMult(
        igniteDmgElement,
        'IgniteDamageTaken',
        enemyDb,
        ailmentDamageFlags,
        igniteKw,
      );
      const igniteEnemyMult = enemyIgniteResMult * enemyIgniteTakenMult;
      const igniteEffectMod = computeAilmentEffectMod(igniteKw);

      const igniteStacks = computeAppliedStacks(effIgniteChanceFrac, effectiveIgniteDurationSec);
      const igniteStackPotential = igniteStacks / maxIgniteStacks;
      // PoB1 CalcOffence.lua:5125-5131 & PoB2 CalcOffence.lua:5306-5312
      const igniteRollFrac =
        igniteStackPotential > 1
          ? clamp((igniteStacks - (maxIgniteStacks - 1) / 2) / (igniteStacks + 1), 0.5, 1)
          : 0.5;
      // PoB1 CalcOffence.lua:5233 uses max(1, igniteStacks); PoB2 CalcOffence.lua:5352 uses max(1, stackPotential)
      const igniteCritExponent = game === 'poe1' ? Math.max(1, igniteStacks) : Math.max(1, igniteStackPotential);
      const igniteOverCritFrac =
        critFrac > 0 && critFrac < 1 && igniteCritExponent > 1
          ? 1 - Math.pow(Math.max(0, 1 - critFrac), igniteCritExponent)
          : critFrac;

      if (game === 'poe2') {
        if (poe2IgnitePreTotal > 0) {
          let rMin = 0;
          let rMax = 0;
          let rAvg = 0;
          for (const dt of poe2IgniteTypes) {
            const r = input.hitDamageRangeByType?.[dt];
            if (r && r.average > 0) {
              rMin += r.min;
              rMax += r.max;
              rAvg += r.average;
            }
          }
          const rollUplift =
            rAvg > 0 && rMax > rMin && igniteRollFrac !== 0.5
              ? (rMin + (rMax - rMin) * igniteRollFrac) / rAvg
              : 1;
          const baseCritMult = noCritAilments ? 1 : Math.max(1, (input.critMultiplierPct ?? 200) / 100);
          const baseCritEff = 1 - critFrac + critFrac * baseCritMult;
          const nonCritPre = baseCritEff > 0 ? poe2IgnitePreTotal / baseCritEff : poe2IgnitePreTotal;
          const evalIgniteMagMult = (isCrit: boolean): number =>
            withTemporaryCondition(skillDb, 'CriticalStrike', isCrit, () => {
              const magInc = skillDb.sum('INC', ['AilmentMagnitude', 'IgniteMagnitude'], ailmentDamageFlags, igniteKw);
              const magMore = skillDb.more(['AilmentMagnitude', 'IgniteMagnitude'], ailmentDamageFlags, igniteKw);
              return Math.max(0, 1 + magInc / 100) * magMore;
            });
          const nonCritMagMult = evalIgniteMagMult(false);
          const critMagMult = noCritAilments ? nonCritMagMult : evalIgniteMagMult(true);
          const effectivePreMagTotal = weightByCrit(
            igniteChanceOnHitPct,
            igniteChanceOnCritPct,
            igniteOverCritFrac,
            nonCritPre * nonCritMagMult,
            nonCritPre * baseCritMult * critMagMult,
          );

          const preEnemyDps =
            0.2 *
            effectivePreMagTotal *
            rollUplift *
            igniteEffectMod *
            igniteFasterMult;
          igniteBurningGroundBase = preEnemyDps;
          singleStackIgniteDps = preEnemyDps * igniteEnemyMult;
        }
      } else {
        const { nonCritMulti, critMulti } = computePoe1DotMultiPair(
          ['FireDotMultiplier', 'IgniteDotMultiplier'],
          igniteKw,
        );
        // PoE 1 Conversion Inheritance for Ignite (CalcOffence.lua:5154-5180):
        // When a non-Fire elemental skill converts damage along Lightning -> Cold -> Fire
        // (e.g. Arc + Call of the Brotherhood + Cold to Fire), converted packets inherit ancestor elemental mods.
        const isNativeLight = (kwFlags & KeywordFlag.Lightning) !== 0;
        const isNativeCold = (kwFlags & KeywordFlag.Cold) !== 0;
        const isNativeFire = (kwFlags & KeywordFlag.Fire) !== 0;
        const l2c =
          skillDb.sum('BASE', 'LightningDamageConvertToCold', flags, kwFlags) +
          skillDb.sum('BASE', 'LightningDamageGainAsCold', flags, kwFlags);
        const l2f =
          skillDb.sum('BASE', 'LightningDamageConvertToFire', flags, kwFlags) +
          skillDb.sum('BASE', 'LightningDamageGainAsFire', flags, kwFlags);
        const c2f =
          skillDb.sum('BASE', 'ColdDamageConvertToFire', flags, kwFlags) +
          skillDb.sum('BASE', 'ColdDamageGainAsFire', flags, kwFlags);

        let scaledBase = 0;
        if (!fireCannotIgnite) {
          const baseFire = getPoe1ScaledBaseForAilment('Fire', igniteRollFrac);
          if (baseFire > 0) {
            const names = ['Damage', 'ElementalDamage', 'FireDamage', 'DotDamage', 'IgniteDamage'];
            if (!isNativeFire) {
              if (isNativeCold && c2f > 0) {
                names.push('ColdDamage');
              }
              if (isNativeLight && (l2f > 0 || (l2c > 0 && c2f > 0))) {
                names.push('LightningDamage');
                if (l2c > 0 && c2f > 0 && !names.includes('ColdDamage')) names.push('ColdDamage');
              }
            }
            const inc = skillDb.sum('INC', names, ailmentDamageFlags, igniteKw);
            const more = skillDb.more(names, ailmentDamageFlags, igniteKw);
            scaledBase += baseFire * Math.max(0, 1 + inc / 100) * more;
          }
        }
        if (!dealNoNonFire) {
          const altIgniteTypes: Array<{ dt: DamageType; enabled: boolean }> = [
            { dt: 'Physical', enabled: physCanIgnite && !dealNoPhys },
            { dt: 'Cold', enabled: coldCanIgnite && !dealNoCold && !dealNoEle },
            { dt: 'Lightning', enabled: lightCanIgnite && !dealNoLight && !dealNoEle },
            { dt: 'Chaos', enabled: chaosCanIgnite && !dealNoChaos },
          ];
          for (const { dt, enabled } of altIgniteTypes) {
            if (!enabled) continue;
            const baseOther = getPoe1ScaledBaseForAilment(dt, igniteRollFrac);
            if (baseOther <= 0) continue;
            const names = ['Damage', 'ElementalDamage', 'FireDamage', `${dt}Damage`, 'DotDamage', 'IgniteDamage'];
            if (dt === 'Cold' && !isNativeCold && isNativeLight && l2c > 0) {
              names.push('LightningDamage');
            }
            const inc = skillDb.sum('INC', names, ailmentDamageFlags, igniteKw);
            const more = skillDb.more(names, ailmentDamageFlags, igniteKw);
            scaledBase += baseOther * Math.max(0, 1 + inc / 100) * more;
          }
        }

        if (scaledBase > 0) {
          const weightedSource = weightByCrit(
            igniteChanceOnHitPct,
            igniteChanceOnCritPct,
            igniteOverCritFrac,
            scaledBase * nonCritMulti,
            scaledBase * critMulti,
          );
          const igniteRepeatMult =
            maxIgniteStacks > 1 ? avgRepeatAilmentMult : finalRepeatAilmentMult;
          const preEnemyDps =
            0.9 *
            weightedSource *
            ruthlessBlowAilmentEffect *
            igniteRepeatMult *
            igniteEffectMod *
            igniteFasterMult;
          igniteBurningGroundBase = preEnemyDps;
          singleStackIgniteDps = preEnemyDps * igniteEnemyMult;
        }
      }

      if (singleStackIgniteDps > 0) {
        // PoB1 CalcOffence.lua:5264 & PoB2 CalcOffence.lua:5399 — activeIgnites = min(igniteStacks, maxStacks)
        effectiveIgniteStacks = Math.min(maxIgniteStacks, igniteStacks);
      }
    }

    const totalIgniteDps = Math.min(POE_DOT_DPS_CAP, singleStackIgniteDps * effectiveIgniteStacks);
    const burningGroundPct = Math.max(
      skillDb.max('IgniteDpsAsBurningGround', ailmentDamageFlags, igniteKw) ?? 0,
      enemyDb.max('IgniteDpsAsBurningGround') ?? 0,
      skillDb.sum('BASE', 'IgniteDpsAsBurningGround', ailmentDamageFlags, igniteKw),
      enemyDb.sum('BASE', 'IgniteDpsAsBurningGround'),
    );
    let burningGroundDps = 0;
    if (igniteBurningGroundBase > 0 && burningGroundPct > 0) {
      // PoB1 CalcOffence.lua:5274 — Burning Ground from Ignite always uses Fire enemy mitigation (even with Blackflame!)
      const fireKw = baseAilmentKw | KeywordFlag.Ignite | KeywordFlag.Fire;
      const fireRes = getEnemyResistForDot('Fire', enemyDb, enemyConfig, ailmentDamageFlags, fireKw);
      const fireEffMult =
        Math.max(0.05, 1 - fireRes / 100) *
        getEnemyDotTakenMult('Fire', 'IgniteDamageTaken', enemyDb, ailmentDamageFlags, fireKw);
      burningGroundDps = Math.min(POE_DOT_DPS_CAP, (igniteBurningGroundBase * fireEffMult * burningGroundPct) / 100);
    }

    // -------------------------------------------------------------------------
    // 4.4 `skillData` Non-Ailment Spell / Ground DoTs (Toxic Rain, Essence Drain, Vortex, RF, etc.)
    // -------------------------------------------------------------------------
    const skillDotByType: Record<DamageType, number> = {
      Physical: 0,
      Lightning: 0,
      Cold: 0,
      Fire: 0,
      Chaos: 0,
    };
    let skillDotStacks = 1;
    let totalSkillDotDps = 0;

    if (skillData) {
      const rawDots: Partial<Record<DamageType, number>> = {
        ...(skillData.dotDamageByType ?? {}),
      };
      if (typeof skillData.PhysicalDot === 'number') rawDots.Physical = (rawDots.Physical ?? 0) + skillData.PhysicalDot;
      if (typeof skillData.FireDot === 'number') rawDots.Fire = (rawDots.Fire ?? 0) + skillData.FireDot;
      if (typeof skillData.ColdDot === 'number') rawDots.Cold = (rawDots.Cold ?? 0) + skillData.ColdDot;
      if (typeof skillData.LightningDot === 'number') rawDots.Lightning = (rawDots.Lightning ?? 0) + skillData.LightningDot;
      if (typeof skillData.ChaosDot === 'number') rawDots.Chaos = (rawDots.Chaos ?? 0) + skillData.ChaosDot;
      // Also read skill-level BASE DoT from skillDb cmods (e.g. Exsanguinate / Exsanguinate of Transmission / Reap)
      for (const dt of DAMAGE_TYPES) {
        if ((rawDots[dt] ?? 0) <= 0) {
          const dbDot = skillDb.sum('BASE', `${dt}Dot`, flags, kwFlags);
          if (dbDot > 0) rawDots[dt] = dbDot;
        }
      }

      const hasAnySkillDot = DAMAGE_TYPES.some((dt) => (rawDots[dt] ?? 0) > 0);
      if (hasAnySkillDot) {
        const spellApplies = Boolean(
          skillData.spellDmgAppliesToDot ||
            skillData.dotIsSpell ||
            skillDb.flag('SpellDamageAppliesToDot', flags, kwFlags) ||
            skillDb.flag('SpellDamageAppliesToDoT', flags, kwFlags),
        );
        const dotIsArea =
          skillData.dotIsArea !== undefined ? Boolean(skillData.dotIsArea) : (flags & ModFlag.Area) !== 0;
        const dotIsProjectile =
          skillData.dotIsProjectile !== undefined
            ? Boolean(skillData.dotIsProjectile)
            : (flags & ModFlag.Projectile) !== 0;
        const dotCanStack = Boolean(skillData.dotCanStack || skillDb.flag('DotCanStack', flags, kwFlags));
        // PoB1 CalcOffence.lua:5829-5852 — strip Hit & Attack (unless explicit dotIsAttack), keep Dot + WeaponMask + Area/Proj/Spell
        const dotFlags =
          ModFlag.Dot |
          (flags & WEAPON_MOD_FLAGS) |
          (spellApplies ? ModFlag.Spell : 0) |
          (skillData.dotIsAttack ? ModFlag.Attack : 0) |
          (dotIsArea ? ModFlag.Area : 0) |
          (dotIsProjectile ? ModFlag.Projectile : 0);
        // PoB1 CalcOffence.lua:5848-5852 — SpellDamageAppliesToDot does NOT apply to enemy damage taken (Unnerve must not leak!)
        const dotTakenFlags = dotFlags & ~(ModFlag.Spell | ModFlag.Attack);
        const baseDotKw =
          (kwFlags & ~KeywordFlag.Hit) |
          (isAttack ? KeywordFlag.Attack : 0) |
          ((flags & ModFlag.Spell) !== 0 ? KeywordFlag.Spell : 0);

        if (dotCanStack) {
          const baseDur = Math.max(
            0.1,
            skillData.dotBaseDuration ??
              (typeof skillData.duration === 'number' && skillData.duration > 0 ? skillData.duration : 1.0),
          );
          const durInc = skillDb.sum('INC', 'Duration', dotFlags, baseDotKw);
          const durMore = skillDb.more('Duration', dotFlags, baseDotKw);
          const effDur = baseDur * Math.max(0.1, 1 + durInc / 100) * durMore * debuffDurationMult;
          const perUse = Math.max(1, skillData.dotHitsPerUse ?? 1);
          const rawStacks = speed * perUse * effDur;
          skillDotStacks =
            skillData.dotMaxStacks !== undefined ? Math.min(skillData.dotMaxStacks, rawStacks) : rawStacks;
        } else if (skillData.dotMaxStacks !== undefined && skillData.dotMaxStacks > 1) {
          skillDotStacks = skillData.dotMaxStacks;
        }

        for (const dt of DAMAGE_TYPES) {
          const baseDot = rawDots[dt] ?? 0;
          if (baseDot <= 0) continue;
          const isEle = dt === 'Fire' || dt === 'Cold' || dt === 'Lightning';
          if (
            (dt === 'Physical' && dealNoPhys) ||
            (dt === 'Fire' && dealNoFire) ||
            (dt === 'Cold' && dealNoCold) ||
            (dt === 'Lightning' && dealNoLight) ||
            (isEle && dealNoEle) ||
            (dt === 'Chaos' && dealNoChaos) ||
            (dealNoNonFire && dt !== 'Fire')
          ) {
            continue;
          }
          const dotKw = baseDotKw | DAMAGE_TYPE_TO_KEYWORD[dt];
          const statNames = ['Damage', 'DotDamage', `${dt}Damage`, ...(isEle ? ['ElementalDamage'] : [])];
          const inc = skillDb.sum('INC', statNames, dotFlags, dotKw);
          const more = skillDb.more(statNames, dotFlags, dotKw);
          const dotMultiOv = skillDb.override('DotMultiplier', dotFlags, dotKw);
          const specDotMulti =
            dotMultiOv !== null
              ? dotMultiOv
              : skillDb.sum('BASE', 'DotMultiplier', dotFlags, dotKw) +
                skillDb.sum('BASE', `${dt}DotMultiplier`, dotFlags, dotKw);
          const enemyRes = getEnemyResistForDot(dt, enemyDb, enemyConfig, dotTakenFlags, dotKw);
          const enemyResMult = Math.max(0.05, 1 - enemyRes / 100);
          const enemyTakenMult = getEnemyDotTakenMult(dt, null, enemyDb, dotTakenFlags, dotKw);

          const dps =
            baseDot *
            Math.max(0, 1 + inc / 100) *
            more *
            Math.max(0, 1 + specDotMulti / 100) *
            enemyResMult *
            enemyTakenMult *
            skillDotStacks;
          skillDotByType[dt] = round2(dps);
          totalSkillDotDps += dps;
        }
        totalSkillDotDps = Math.min(POE_DOT_DPS_CAP, totalSkillDotDps);
      }

      // PoB1 CalcOffence.lua:5755-5792 — Decay Support flat Chaos DoT
      const decayBase = typeof skillData.decay === 'number' && skillData.decay > 0 ? skillData.decay : 0;
      if (decayBase > 0 && !dealNoChaos && !dealNoNonFire) {
        const decayKw = (kwFlags & ~KeywordFlag.Hit) | KeywordFlag.Chaos;
        const inc = skillDb.sum('INC', ['Damage', 'DotDamage', 'ChaosDamage'], ModFlag.Dot, decayKw);
        const more = skillDb.more(['Damage', 'DotDamage', 'ChaosDamage'], ModFlag.Dot, decayKw);
        const mult =
          skillDb.override('DotMultiplier', ModFlag.Dot, decayKw) ??
          skillDb.sum('BASE', 'DotMultiplier', ModFlag.Dot, decayKw) +
            skillDb.sum('BASE', 'ChaosDotMultiplier', ModFlag.Dot, decayKw);
        const res = getEnemyResistForDot('Chaos', enemyDb, enemyConfig, ModFlag.Dot, decayKw);
        const taken = getEnemyDotTakenMult('Chaos', null, enemyDb, ModFlag.Dot, decayKw);
        const decayDps =
          decayBase *
          Math.max(0, 1 + inc / 100) *
          more *
          Math.max(0, 1 + mult / 100) *
          Math.max(0.05, 1 - res / 100) *
          taken;
        skillDotByType.Chaos = round2(skillDotByType.Chaos + decayDps);
        totalSkillDotDps = Math.min(POE_DOT_DPS_CAP, totalSkillDotDps + decayDps);
      }
    }

    return {
      poison: {
        chancePct: poisonChancePct,
        singleStackDps: round2(singleStackPoisonDps),
        effectiveStacks: round2(effectivePoisonStacks),
        maxStacks: maxPoisonStacks,
        effectiveDurationSec: round2(effectivePoisonDurationSec),
        fasterMult: round2(poisonFasterMult),
        totalDps: round2(totalPoisonDps),
        isSinglePoisonCap: cannotPoisonAlreadyPoisoned,
      },
      bleed: {
        chancePct: bleedChancePct,
        singleStackDps: round2(singleStackBleedDps),
        effectiveStacks: round2(effectiveBleedStacks),
        maxStacks: maxBleedStacks,
        effectiveDurationSec: round2(effectiveBleedDurationSec),
        fasterMult: round2(bleedFasterMult),
        isAggravatedOrMoving,
        isCrimsonDance,
        totalDps: round2(totalBleedDps),
      },
      ignite: {
        effectiveChancePct: round2(effIgniteChanceFrac * 100),
        singleStackDps: round2(singleStackIgniteDps),
        effectiveStacks: round2(effectiveIgniteStacks),
        effectiveDurationSec: round2(effectiveIgniteDurationSec),
        fasterMult: round2(igniteFasterMult),
        totalDps: round2(totalIgniteDps),
      },
      skillDot: {
        byType: skillDotByType,
        effectiveStacks: round2(skillDotStacks),
        totalDps: round2(totalSkillDotDps),
      },
      ...(causticGroundDps > 0 ? { causticGroundDps: round2(causticGroundDps) } : {}),
      ...(burningGroundDps > 0 ? { burningGroundDps: round2(burningGroundDps) } : {}),
      totalDotDps: round2(
        Math.min(
          POE_DOT_DPS_CAP,
          totalPoisonDps +
            totalBleedDps +
            totalIgniteDps +
            totalSkillDotDps +
            causticGroundDps +
            burningGroundDps,
        ),
      ),
    };
  });
}

// ============================================================================
// 4B. CoC & Trigger Rate Server-Tick Quantizer (PoB CalcTriggers.lua)
// ============================================================================

export interface TriggeredSkillRateInput {
  /** Base trigger cooldown in seconds (e.g. `0.15` for PoE 1 Cast On Critical Strike). */
  cooldown: number;
  /** Increased Cooldown Recovery Rate percentage (e.g. `0`, `14`, `52`, `128`). */
  icdrPct?: number;
  /** Optional MORE Cooldown Recovery Rate multiplier (default `1`). */
  moreCdrMult?: number;
  /**
   * Direct trigger source event rate per second (e.g. `attackCritRate` for CoC).
   * If omitted, computed as `attackAps * (attackHitChancePct / 100) * (attackCritChancePct / 100)`.
   */
  attackCritRate?: number;
  /** Optional trigger attack APS (used when `attackCritRate` is omitted or to compute cycle-sync rate). */
  attackAps?: number;
  /** Optional trigger attack hit chance percentage `0..100` (default 100). */
  attackHitChancePct?: number;
  /** Optional trigger attack critical strike chance percentage `0..100` (default 100). */
  attackCritChancePct?: number;
  /** Number of triggered spells sharing this single trigger cooldown/support (default 1). */
  linkedTriggeredSkills?: number;
  /** Official PoB server tick duration in seconds (default `0.033`). */
  serverTickSec?: number;
}

export interface TriggeredSkillRateResult {
  serverTickSec: number;
  rawCooldown: number;
  serverTicks: number;
  effectiveCooldown: number;
  /** Maximum triggers per second allowed by the quantized server-tick cooldown (before dividing by linked spells). */
  triggerCap: number;
  /** Effective trigger source rate per second (e.g. attack crits per second). */
  attackCritRate: number;
  /** Final effective trigger rate per second for one linked triggered skill. */
  effectiveTriggerRate: number;
  /**
   * Optional PoB cycle-desync rate when `attackAps` is supplied:
   * accounts for missed attacks when `attackAps` slightly exceeds `triggerCap` (e.g. attacking every 0.12s on a 0.132s CD).
   */
  syncedTriggerRate?: number;
  /** Minimum ICDR% required to drop to the next faster server-tick breakpoint (`null` if already at 1 tick). */
  nextIcdrBreakpointPct: number | null;
}

/**
 * Official PoB `CalcTriggers.lua` server-tick cooldown quantizer (`0.033s` = 30.303 ticks/sec):
 *
 * - `effectiveCooldown = Math.ceil(cooldown / (1 + icdr/100) / 0.033) * 0.033`
 * - `triggerCap = 1 / effectiveCooldown`
 * - `effectiveTriggerRate = Math.min(triggerCap, attackCritRate) / linkedTriggeredSkills`
 *
 * Reproduces PoE's exact CoC `0.15s` cooldown breakpoints:
 * - `0%` ICDR  -> 5 ticks (`0.165s`, `6.06/s`)
 * - `14%` ICDR -> 4 ticks (`0.132s`, `7.58/s`)
 * - `52%` ICDR -> 3 ticks (`0.099s`, `10.10/s`)
 * - `128%` ICDR -> 2 ticks (`0.066s`, `15.15/s`)
 */
export function computeTriggeredSkillRate(input: TriggeredSkillRateInput): TriggeredSkillRateResult {
  const serverTickSec = input.serverTickSec ?? POB_SERVER_TICK_SEC;
  const icdrPct = Math.max(-99, input.icdrPct ?? 0);
  const moreCdrMult = Math.max(0.01, input.moreCdrMult ?? 1);
  const linked = Math.max(1, Math.floor(input.linkedTriggeredSkills ?? 1));
  const cdrFactor = Math.max(0.01, (1 + icdrPct / 100) * moreCdrMult);

  const hitFrac = clamp(input.attackHitChancePct ?? 100, 0, 100) / 100;
  const critFrac = clamp(input.attackCritChancePct ?? 100, 0, 100) / 100;
  const attackCritRate = Math.max(
    0,
    input.attackCritRate !== undefined
      ? input.attackCritRate
      : (input.attackAps ?? 0) * hitFrac * critFrac,
  );

  if (input.cooldown <= 0) {
    return {
      serverTickSec,
      rawCooldown: 0,
      serverTicks: 0,
      effectiveCooldown: 0,
      triggerCap: Number.POSITIVE_INFINITY,
      attackCritRate,
      effectiveTriggerRate: attackCritRate / linked,
      nextIcdrBreakpointPct: null,
    };
  }

  const rawCooldown = input.cooldown / cdrFactor;
  // Subtract tiny IEEE-754 epsilon so exact multiples like 0.297 / 0.033 don't round up to 10 ticks
  const serverTicks = Math.max(1, Math.ceil(rawCooldown / serverTickSec - 1e-9));
  const effectiveCooldown = serverTicks * serverTickSec;
  const triggerCap = 1 / effectiveCooldown;
  const effectiveTriggerRate = Math.min(triggerCap, attackCritRate) / linked;

  let syncedTriggerRate: number | undefined;
  if (input.attackAps !== undefined && input.attackAps > 0) {
    const atkTime = 1 / input.attackAps;
    const minAttacksPerTrigger = Math.max(1, Math.ceil((effectiveCooldown - 1e-9) / atkTime));
    const syncAps = input.attackAps / minAttacksPerTrigger;
    syncedTriggerRate = Math.min(triggerCap, syncAps * hitFrac * critFrac) / linked;
  }

  let nextIcdrBreakpointPct: number | null = null;
  if (serverTicks > 1) {
    const targetCd = (serverTicks - 1) * serverTickSec;
    const requiredFactor = input.cooldown / (targetCd * moreCdrMult);
    nextIcdrBreakpointPct = Math.max(0, Math.ceil((requiredFactor - 1) * 100 - 1e-9));
  }

  return {
    serverTickSec,
    rawCooldown,
    serverTicks,
    effectiveCooldown,
    triggerCap,
    attackCritRate,
    effectiveTriggerRate,
    ...(syncedTriggerRate !== undefined ? { syncedTriggerRate } : {}),
    nextIcdrBreakpointPct,
  };
}

// ============================================================================
// 3. Full PoE 1 & PoE 2 Minion Offence Calculator
// ============================================================================

export interface MinionOffenceInput {
  game: GameId;
  minionBase: MinionBaseProfile;
  /** Minion actor ModDB (with normalized `Damage`, `Speed`, `CritChance`, `CritMultiplier`, etc.). */
  minionDb: ModDB;
  /** Enemy actor ModDB (with curses, exposure, wither, shock, etc.). */
  enemyDb: ModDB;
  /** Optional player ModDB for resolving active minion limit stats (e.g. `ActiveZombieLimit`). */
  playerDb?: ModDB;
  /** Effective active gem level (scales Lv.20 base damage via `1.095^(effLevel - 20)` when `!== 20`). */
  effLevel?: number;
  /** Optional GemInstance (`count`, `level`, `spiritReservationOverride`). */
  gemInst?: Partial<Pick<GemInstance, 'count' | 'level' | 'quality' | 'spiritReservationOverride'>>;
  /** Optional explicit active minion count override. */
  explicitCount?: number;
  /** PoE 2 total Spirit reserved by this persistent minion skill (e.g. 312 Spirit / 39 per Arsonist = 8). */
  spiritReserved?: number;
  /** Optional enemy defence baseline (base resists, armour, evasion, moving). */
  enemyConfig?: EnemyDefenceProfile;
  /** Optional skill ModFlags override. */
  flags?: number;
  /** Optional skill KeywordFlags override. */
  keywordFlags?: number;
  /** Optional `skillData` for minion ailments/dots. */
  skillData?: SkillDataMap;
}

export interface MinionPerEntityOffence {
  damageByType: Record<DamageType, DamageRange>;
  averageHit: number;
  speed: number;
  hitChance: number;
  critChance: number;
  critMultiplier: number;
  effectiveCritMultiplier: number;
  hitDps: number;
  impaleDps: number;
  poisonDps: number;
  bleedDps: number;
  igniteDps: number;
  skillDotDps: number;
  totalDps: number;
}

export interface MinionGroupOffenceResult {
  game: GameId;
  effLevel: number;
  levelDamageScale: number;
  activeCount: number;
  perMinion: MinionPerEntityOffence;
  /** Count-multiplied total Minion group offence (stacking Hit/Impale/Poison + non-stacking Ignite/Bleed). */
  total: {
    hitDps: number;
    impaleDps: number;
    poisonDps: number;
    bleedDps: number;
    igniteDps: number;
    skillDotDps: number;
    totalDps: number;
  };
  ailments: AuthenticDotResult;
}

/** Scales Lv.20 (or `baseLevel`) minion base damage via PoB's monster growth factor `1.095^(effLevel - baseLevel)`. */
export function scaleMinionBaseDamageForLevel(
  baseDamage: number,
  effLevel: number,
  baseLevel = 20,
): number {
  if (effLevel === baseLevel) return baseDamage;
  return baseDamage * Math.pow(POB_MINION_DAMAGE_GROWTH_PER_LEVEL, effLevel - baseLevel);
}

/**
 * Resolves the active minion count for a minion skill group:
 * 1. Explicit `explicitCount` or `gemInst.count` when `> 1`.
 * 2. PoE 2 Spirit-reserved count (`Math.floor(spiritReserved / spiritPerMinion)`) when `spiritReserved > 0`.
 * 3. `baseLimit + playerDb.sum('BASE', limitStat)` when `baseLimit > 0` or `limitStat` yields `> 0`.
 * 4. Minimum `1`.
 */
export function resolveActiveMinionCount(input: Pick<
  MinionOffenceInput,
  'game' | 'minionBase' | 'playerDb' | 'minionDb' | 'gemInst' | 'explicitCount' | 'spiritReserved'
>): number {
  const explicit = input.explicitCount ?? input.gemInst?.count;
  if (explicit !== undefined && explicit > 1) {
    return Math.max(1, Math.floor(explicit));
  }

  if (input.game === 'poe2' && input.spiritReserved !== undefined && input.spiritReserved > 0) {
    const spiritCost =
      input.gemInst?.spiritReservationOverride ?? input.minionBase.spiritPerMinion ?? 0;
    if (spiritCost > 0) {
      const bySpirit = Math.floor(input.spiritReserved / spiritCost);
      if (bySpirit > 0) return bySpirit;
    }
  }

  const baseLimit = input.minionBase.baseLimit ?? 0;
  let extraLimit = 0;
  let limitIncludesSkillBase = false;
  if (input.minionBase.limitStat) {
    if (input.playerDb) {
      const evalPlayer = input.playerDb.calcStat(input.minionBase.limitStat);
      extraLimit += Math.floor(evalPlayer.base);
      if (evalPlayer.sources.some((s) => s.type === 'BASE' && s.source.startsWith('Skill:'))) {
        limitIncludesSkillBase = true;
      }
    }
    if (extraLimit === 0 && input.minionDb) {
      const evalMinion = input.minionDb.calcStat(input.minionBase.limitStat);
      extraLimit += Math.floor(evalMinion.base);
      if (evalMinion.sources.some((s) => s.type === 'BASE' && s.source.startsWith('Skill:'))) {
        limitIncludesSkillBase = true;
      }
    }
  }
  const combinedLimit = limitIncludesSkillBase ? extraLimit : baseLimit + extraLimit;
  if (combinedLimit > 0) {
    return Math.max(1, combinedLimit);
  }

  return 1;
}

/**
 * Full PoE 1 & PoE 2 Minion Offence Calculator:
 * - Scales Lv.20 minion physical + elemental base damages to `effLevel` via `1.095^(effLevel - 20)`.
 * - Adds flat Minion Phys/Fire/Cold/Lightning/Chaos damage from `minionDb`.
 * - Runs the full Physical -> Lightning -> Cold -> Fire -> Chaos conversion & gain-as-extra pipeline
 *   (PoE 1 bitmask inheritance vs PoE 2 final-type scaling).
 * - Applies `minionDb` `INC`/`MORE` Damage, Speed, CritChance, CritMultiplier, Double Damage,
 *   Penetration, Impale, and authentic Poison/Bleed/Ignite against `enemyDb` Resistances, Curses,
 *   Exposure, Wither, Shock, and Armour.
 * - Resolves active minion count and returns both per-minion DPS and total group DPS!
 */
export function computeMinionGroupOffence(input: MinionOffenceInput): MinionGroupOffenceResult {
  const { game, minionBase, minionDb, enemyDb, enemyConfig } = input;
  const ruleset = getRuleset(game);
  const effLevel = clamp(Math.floor(input.effLevel ?? input.gemInst?.level ?? 20), 1, 40);
  const baseLevel = minionBase.baseLevel ?? 20;
  const levelDamageScale =
    effLevel !== baseLevel ? Math.pow(POB_MINION_DAMAGE_GROWTH_PER_LEVEL, effLevel - baseLevel) : 1;

  const isSpell =
    minionBase.isSpell ??
    Boolean(minionBase.castTime && minionBase.castTime > 0 && minionBase.attacksPerSecond <= 0);
  const flags =
    input.flags ??
    minionBase.modFlags ??
    ((isSpell ? ModFlag.Spell : ModFlag.Attack | ModFlag.Melee) | ModFlag.Hit);
  const kwFlags =
    input.keywordFlags ??
    minionBase.keywordFlags ??
    (KeywordFlag.Minion | KeywordFlag.Hit | (isSpell ? KeywordFlag.Spell : KeywordFlag.Attack));
  const effectiveness = (minionBase.damageEffectivenessPct ?? 100) / 100;

  // Step A: Base Min/Max damage scaled by level + added flat minion damage
  const baseMin: Record<DamageType, number> = { Physical: 0, Lightning: 0, Cold: 0, Fire: 0, Chaos: 0 };
  const baseMax: Record<DamageType, number> = { Physical: 0, Lightning: 0, Cold: 0, Fire: 0, Chaos: 0 };

  if (minionBase.physicalMin > 0 || minionBase.physicalMax > 0) {
    baseMin.Physical += minionBase.physicalMin * levelDamageScale;
    baseMax.Physical += minionBase.physicalMax * levelDamageScale;
  } else if (minionBase.baseDamage?.Physical) {
    baseMin.Physical += minionBase.baseDamage.Physical[0] * levelDamageScale;
    baseMax.Physical += minionBase.baseDamage.Physical[1] * levelDamageScale;
  }

  for (const dt of ['Fire', 'Cold', 'Lightning', 'Chaos'] as const) {
    const range = minionBase.elementalDamage?.[dt] ?? minionBase.baseDamage?.[dt];
    if (range) {
      baseMin[dt] += range[0] * levelDamageScale;
      baseMax[dt] += range[1] * levelDamageScale;
    }
  }

  for (const dt of DAMAGE_TYPES) {
    const addMin = minionDb.sum('BASE', `${dt}Min`, flags, kwFlags);
    const addMax = minionDb.sum('BASE', `${dt}Max`, flags, kwFlags);
    baseMin[dt] += addMin * effectiveness;
    baseMax[dt] += addMax * effectiveness;
  }

  // Step B: PoE Conversion & Gain-as-Extra Pipeline (Physical -> Lightning -> Cold -> Fire -> Chaos)
  const packets: Record<DamageType, Map<number, [number, number]>> = {
    Physical: new Map(),
    Lightning: new Map(),
    Cold: new Map(),
    Fire: new Map(),
    Chaos: new Map(),
  };

  const addPacket = (target: DamageType, mask: number, mn: number, mx: number) => {
    if (mn <= 0 && mx <= 0) return;
    const prev = packets[target].get(mask);
    if (prev) {
      prev[0] += mn;
      prev[1] += mx;
    } else {
      packets[target].set(mask, [mn, mx]);
    }
  };

  for (const dt of DAMAGE_TYPES) {
    addPacket(dt, DMG_BIT[dt], baseMin[dt], baseMax[dt]);
  }

  const applyConversionStage = (
    source: DamageType,
    targets: readonly DamageType[],
    convModPrefix: string,
    gainModPrefix?: string,
  ) => {
    const srcEntries = [...packets[source].entries()];
    if (srcEntries.length === 0) return;

    // Skill-inherent minion conversions take priority, then external minionDb conversions fill remaining up to 100%
    const skillConvs = targets.map((t) => Math.max(0, minionBase.conversions?.[`${source}To${t}`] ?? 0));
    const skillSum = skillConvs.reduce((a, b) => a + b, 0);
    const skillScale = skillSum > 100 ? 100 / skillSum : 1;
    const scaledSkillConvs = skillConvs.map((v) => v * skillScale);
    const remainingForDb = Math.max(0, 100 - Math.min(100, skillSum));

    const dbConvs = targets.map((t) => Math.max(0, minionDb.sum('BASE', `${convModPrefix}${t}`, flags, kwFlags)));
    const dbSum = dbConvs.reduce((a, b) => a + b, 0);
    const dbScale = dbSum > remainingForDb && dbSum > 0 ? remainingForDb / dbSum : 1;
    const totalConvs = targets.map((_, i) => scaledSkillConvs[i]! + dbConvs[i]! * dbScale);
    const convSum = totalConvs.reduce((a, b) => a + b, 0);

    const gainPcts = gainModPrefix
      ? targets.map((t) => Math.max(0, minionDb.sum('BASE', `${gainModPrefix}${t}`, flags, kwFlags)))
      : targets.map(() => 0);
    const gainSum = gainPcts.reduce((a, b) => a + b, 0);

    if (convSum <= 0 && gainSum <= 0) return;

    const totalConvFrac = Math.min(1, convSum / 100);
    const remainingFrac = Math.max(0, 1 - totalConvFrac);
    packets[source].clear();

    for (const [mask, [mn, mx]] of srcEntries) {
      if (remainingFrac > 0) {
        addPacket(source, mask, mn * remainingFrac, mx * remainingFrac);
      }
      targets.forEach((target, i) => {
        const totalFrac = (totalConvs[i]! + gainPcts[i]!) / 100;
        if (totalFrac > 0) {
          const nextMask = game === 'poe1' ? mask | DMG_BIT[target] : DMG_BIT[target];
          addPacket(target, nextMask, mn * totalFrac, mx * totalFrac);
        }
      });
    }
  };

  applyConversionStage('Physical', ['Lightning', 'Cold', 'Fire', 'Chaos'], 'PhysicalDamageConvertTo', 'PhysicalDamageGainAs');
  applyConversionStage('Lightning', ['Cold', 'Fire', 'Chaos'], 'LightningDamageConvertTo');
  applyConversionStage('Cold', ['Fire', 'Chaos'], 'ColdDamageConvertTo');
  applyConversionStage('Fire', ['Chaos'], 'FireDamageConvertTo');

  const eleExtraChaos = minionDb.sum('BASE', 'ElementalDamageGainAsChaos', flags, kwFlags);
  if (eleExtraChaos > 0) {
    const frac = eleExtraChaos / 100;
    for (const el of ['Lightning', 'Cold', 'Fire'] as const) {
      for (const [mask, [mn, mx]] of packets[el].entries()) {
        const nextMask = game === 'poe1' ? mask | DMG_BIT.Chaos : DMG_BIT.Chaos;
        addPacket('Chaos', nextMask, mn * frac, mx * frac);
      }
    }
  }

  for (const target of ['Fire', 'Cold', 'Lightning', 'Chaos'] as const) {
    const pct = minionDb.sum('BASE', `DamageGainAs${target}`, flags, kwFlags);
    if (pct <= 0) continue;
    let totalPreMin = 0;
    let totalPreMax = 0;
    for (const dt of DAMAGE_TYPES) {
      for (const [mn, mx] of packets[dt].values()) {
        totalPreMin += mn;
        totalPreMax += mx;
      }
    }
    addPacket(target, DMG_BIT[target], (totalPreMin * pct) / 100, (totalPreMax * pct) / 100);
  }

  // Final converted base averages & ranges (for PoE 1 ailments & top-roll selection)
  const convertedBaseAvg: Record<DamageType, number> = {
    Physical: 0,
    Lightning: 0,
    Cold: 0,
    Fire: 0,
    Chaos: 0,
  };
  const convertedBaseRange: Record<DamageType, [number, number]> = {
    Physical: [0, 0],
    Lightning: [0, 0],
    Cold: [0, 0],
    Fire: [0, 0],
    Chaos: [0, 0],
  };
  for (const dt of DAMAGE_TYPES) {
    for (const [mn, mx] of packets[dt].values()) {
      convertedBaseRange[dt][0] += mn;
      convertedBaseRange[dt][1] += mx;
      convertedBaseAvg[dt] += (mn + mx) / 2;
    }
  }

  // Step C: Minion Accuracy / Hit Chance (Lv.20 minion gem summons Lv.70 monster per PoB monsterAccuracyTable)
  let hitChance = 100;
  const enemyEva = Math.max(
    0,
    ((enemyConfig?.enemyEvasion ?? 0) + enemyDb.sum('BASE', 'Evasion')) *
      Math.max(0, 1 + enemyDb.sum('INC', 'Evasion') / 100) *
      enemyDb.more('Evasion'),
  );
  if (!isSpell && enemyEva > 0 && !minionDb.flag('HitsCantBeEvaded', flags, kwFlags)) {
    const monsterLv = effLevel <= 20 ? Math.round(4 + effLevel * 3.3) : 70 + (effLevel - 20) * 2;
    const inherentMonsterAcc = Math.round(200 * Math.pow(1.07, monsterLv));
    const baseAcc = inherentMonsterAcc + minionDb.sum('BASE', 'Accuracy', flags, kwFlags);
    const acc = Math.max(
      1,
      baseAcc * Math.max(0, 1 + minionDb.sum('INC', 'Accuracy', flags, kwFlags) / 100) * minionDb.more('Accuracy', flags, kwFlags),
    );
    const rawHit =
      game === 'poe2'
        ? ((acc * 1.25) / (acc + enemyEva * 0.3)) * 100
        : (acc / (acc + Math.pow(enemyEva / 5, 0.9))) * 125;
    hitChance = clamp(Math.round(rawHit), 5, 100);
  }

  // Step D: Minion Crit Chance & Crit Multiplier
  const neverCrit = minionDb.flag('NeverCrit', flags, kwFlags);
  const noCritExtra = minionDb.flag('NoCritExtraDamage', flags, kwFlags);
  const enemyCritBonus = enemyDb.sum('BASE', 'SelfCritChance', flags, kwFlags);
  const enemyCritMulti = enemyDb.sum('BASE', 'SelfCritMultiplier', flags, kwFlags);
  const baseCrit = Math.max(
    0,
    minionBase.critChance +
      minionDb.sum('BASE', ['BaseCritChance', 'CritChance'], flags, kwFlags) +
      enemyCritBonus,
  );
  const critInc = minionDb.sum('INC', 'CritChance', flags, kwFlags);
  const critMore = minionDb.more('CritChance', flags, kwFlags);

  let critChance: number;
  let critMultiplier: number;
  let effectiveCritMultiplier: number;

  const critOverride = minionDb.override('CritChance', flags, kwFlags);

  if (game === 'poe2') {
    // Base bonus is `minionBase.critMultiplier - 100` (e.g. 130 -> +30% bonus, or 200 -> +100% bonus).
    // `computePoe2CritMultiplier` starts at 100, so offset `flatBonusPct` relative to 100.
    const minionBaseBonusOffset = minionBase.critMultiplier - 200;
    const flatCritBonus =
      minionBaseBonusOffset +
      minionDb.sum('BASE', ['CritMultiplier', 'CritDamageBonusFlat'], flags, kwFlags);
    const incCritBonus = minionDb.sum('INC', ['CritDamageBonusInc', 'CritMultiplier'], flags, kwFlags);
    const moreCritBonus = minionDb.more(['CritDamageBonusInc', 'CritMultiplier'], flags, kwFlags);

    const poe2Crit = computePoe2CritMultiplier({
      baseCritChance: baseCrit,
      incCritChancePct: critInc,
      moreCritChanceMult: critMore,
      flatBonusPct: flatCritBonus,
      incBonusPct: incCritBonus,
      moreBonusMult: moreCritBonus,
      enemyExtraCritFlatPct: enemyCritMulti,
      luckyCrit: minionDb.flag('CritChanceIsLucky', flags, kwFlags),
      neverCrit,
      noCritMultiplier: noCritExtra,
    });
    const effPoe2Crit = neverCrit
      ? 0
      : critOverride !== null
        ? clamp(critOverride, 0, 100)
        : poe2Crit.effectiveCritChance;
    critChance = round2(effPoe2Crit * (isSpell ? 1 : hitChance / 100));
    critMultiplier = neverCrit ? 0 : Math.round(poe2Crit.critMultiplierPct);
    effectiveCritMultiplier =
      neverCrit || noCritExtra ? 1 : 1 + (critChance / 100) * Math.max(0, poe2Crit.critMultiplierPct / 100 - 1);
  } else {
    const preCrit = neverCrit
      ? 0
      : critOverride !== null
        ? clamp(critOverride, 0, 100)
        : clamp(baseCrit * Math.max(0, 1 + critInc / 100) * critMore, 0, 100);
    critChance = round2(preCrit * (isSpell ? 1 : hitChance / 100));
    critMultiplier = neverCrit
      ? 0
      : noCritExtra
        ? 100
        : Math.max(100, Math.round(minionBase.critMultiplier + minionDb.sum('BASE', 'CritMultiplier', flags, kwFlags) + enemyCritMulti));
    effectiveCritMultiplier =
      neverCrit || noCritExtra ? 1 : 1 + (critChance / 100) * Math.max(0, critMultiplier / 100 - 1);
  }

  // Step E: Scaled Hit Damage + Enemy Mitigation (Resistances, Curses, Penetration, Armour, Damage Taken)
  const doubleDamageBasePct = minionDb.sum('BASE', 'DoubleDamageChance', flags, kwFlags);
  const doubleDamageOnCritPct = minionDb.sum('BASE', 'DoubleDamageChanceOnCrit', flags, kwFlags);
  const doubleDamagePct = clamp(doubleDamageBasePct + (doubleDamageOnCritPct * critChance) / 100, 0, 100);
  const tripleDamagePct = clamp(minionDb.sum('BASE', 'TripleDamageChance', flags, kwFlags), 0, 100);
  const doubleDamageMult =
    1 + (tripleDamagePct / 100) * 2 + (Math.max(0, Math.min(100 - tripleDamagePct, doubleDamagePct)) / 100);
  const dealNoPhys = minionDb.flag('DealNoPhysical', flags, kwFlags);
  const dealNoFire = minionDb.flag('DealNoFire', flags, kwFlags);
  const dealNoCold = minionDb.flag('DealNoCold', flags, kwFlags);
  const dealNoLight = minionDb.flag('DealNoLightning', flags, kwFlags);
  const dealNoEle =
    minionDb.flag('DealNoElemental', flags, kwFlags) ||
    (dealNoFire && dealNoCold && dealNoLight);
  const dealNoChaos = minionDb.flag('DealNoChaos', flags, kwFlags);
  const dealNoNonFire = minionDb.flag('DealNoNonFire', flags, kwFlags);

  const enemyGlobalTaken =
    enemyDb.sum('INC', 'DamageTaken', flags, kwFlags) +
    ((flags & ModFlag.Projectile) !== 0 ? enemyDb.sum('INC', 'ProjectileDamageTaken', flags, kwFlags) : 0) +
    ((flags & ModFlag.Area) !== 0 ? enemyDb.sum('INC', 'AreaDamageTaken', flags, kwFlags) : 0);
  const enemyGlobalTakenMore = enemyDb.more('DamageTaken', flags, kwFlags);
  const enemyMaxRes = enemyConfig?.enemyMaxResist ?? 75;
  const enemyArmour = Math.max(
    0,
    ((enemyConfig?.enemyArmour ?? 0) + enemyDb.sum('BASE', 'Armour')) *
      Math.max(0, 1 + enemyDb.sum('INC', 'Armour') / 100) *
      enemyDb.more('Armour'),
  );

  const damageByType = emptyDamageRanges();
  const preMitigationHitByType: Record<DamageType, number> = {
    Physical: 0,
    Lightning: 0,
    Cold: 0,
    Fire: 0,
    Chaos: 0,
  };
  let totalAvgHit = 0;

  for (const dt of DAMAGE_TYPES) {
    const isEle = dt === 'Fire' || dt === 'Cold' || dt === 'Lightning';
    if (
      (dt === 'Physical' && dealNoPhys) ||
      (dt === 'Fire' && dealNoFire) ||
      (dt === 'Cold' && dealNoCold) ||
      (dt === 'Lightning' && dealNoLight) ||
      (isEle && dealNoEle) ||
      (dt === 'Chaos' && dealNoChaos) ||
      (dealNoNonFire && dt !== 'Fire')
    ) {
      continue;
    }

    let rawMin = 0;
    let rawMax = 0;
    for (const [mask, [pMin, pMax]] of packets[dt].entries()) {
      const statNames: string[] = ['Damage'];
      if ((mask & ELE_MASK) !== 0) statNames.push('ElementalDamage');
      for (const srcType of DAMAGE_TYPES) {
        if ((mask & DMG_BIT[srcType]) !== 0) {
          statNames.push(`${srcType}Damage`);
        }
      }
      const inc = minionDb.sum('INC', statNames, flags, kwFlags);
      const more = minionDb.more(statNames, flags, kwFlags);
      const mult = Math.max(0, 1 + inc / 100) * more;
      rawMin += pMin * mult;
      rawMax += pMax * mult;
    }
    const minMore = minionDb.more(['MinDamage', `Min${dt}Damage`, `${dt}MinDamage`], flags, kwFlags);
    const maxMore = minionDb.more(['MaxDamage', `Max${dt}Damage`, `${dt}MaxDamage`], flags, kwFlags);
    rawMin *= minMore;
    rawMax *= maxMore;

    const rawAvg = (rawMin + rawMax) / 2;
    preMitigationHitByType[dt] = rawAvg * effectiveCritMultiplier * doubleDamageMult;

    let enemyFactor = 1;
    let typeTakenInc = enemyGlobalTaken;
    let typeTakenMore = enemyGlobalTakenMore;

    if (dt === 'Physical') {
      typeTakenInc += enemyDb.sum('INC', 'PhysicalDamageTaken', flags, kwFlags);
      typeTakenMore *= enemyDb.more('PhysicalDamageTaken', flags, kwFlags);
      if (enemyArmour > 0 && rawAvg > 0) {
        const pdrCap = 0.75;
        const pdrNonCrit = Math.min(
          pdrCap,
          enemyArmour / (enemyArmour + ruleset.armourFormulaFactor * rawAvg * doubleDamageMult),
        );
        const critFactor = neverCrit || noCritExtra ? 1 : Math.max(1, critMultiplier / 100);
        const critFrac = neverCrit || noCritExtra ? 0 : critChance / 100;
        if (critFrac > 0 && critFactor > 1) {
          const pdrCrit = Math.min(
            pdrCap,
            enemyArmour / (enemyArmour + ruleset.armourFormulaFactor * rawAvg * doubleDamageMult * critFactor),
          );
          const weightedPhys = (1 - critFrac) * (1 - pdrNonCrit) + critFrac * critFactor * (1 - pdrCrit);
          enemyFactor = weightedPhys / effectiveCritMultiplier;
        } else {
          enemyFactor = 1 - pdrNonCrit;
        }
      }
    } else if (isEle) {
      typeTakenInc += enemyDb.sum('INC', ['ElementalDamageTaken', `${dt}DamageTaken`], flags, kwFlags);
      typeTakenMore *= enemyDb.more(['ElementalDamageTaken', `${dt}DamageTaken`], flags, kwFlags);
      const cfgRes =
        dt === 'Fire'
          ? (enemyConfig?.enemyFireResist ?? 0)
          : dt === 'Cold'
            ? (enemyConfig?.enemyColdResist ?? 0)
            : (enemyConfig?.enemyLightningResist ?? 0);
      const resNames = [`${dt}Resist`, 'ElementalResist'];
      const ovRes = enemyDb.override(`${dt}Resist`, flags, kwFlags);
      const rawBaseRes =
        ovRes !== null
          ? ovRes
          : (cfgRes + enemyDb.sum('BASE', resNames, flags, kwFlags)) *
            Math.max(0, 1 + enemyDb.sum('INC', resNames, flags, kwFlags) / 100) *
            enemyDb.more(resNames, flags, kwFlags);
      const baseRes = Math.min(enemyMaxRes, rawBaseRes);
      const pen = minionDb.sum('BASE', [`${dt}Penetration`, 'ElementalPenetration'], flags, kwFlags);
      const effRes = clamp(baseRes - pen, -200, enemyMaxRes);
      enemyFactor = 1 - effRes / 100;
    } else {
      typeTakenInc += enemyDb.sum('INC', 'ChaosDamageTaken', flags, kwFlags);
      typeTakenMore *= enemyDb.more('ChaosDamageTaken', flags, kwFlags);
      const ovRes = enemyDb.override('ChaosResist', flags, kwFlags);
      const rawBaseRes =
        ovRes !== null
          ? ovRes
          : ((enemyConfig?.enemyChaosResist ?? 0) + enemyDb.sum('BASE', 'ChaosResist', flags, kwFlags)) *
            Math.max(0, 1 + enemyDb.sum('INC', 'ChaosResist', flags, kwFlags) / 100) *
            enemyDb.more('ChaosResist', flags, kwFlags);
      const baseRes = Math.min(enemyMaxRes, rawBaseRes);
      const pen = minionDb.sum('BASE', 'ChaosPenetration', flags, kwFlags);
      const effRes = clamp(baseRes - pen, -200, enemyMaxRes);
      enemyFactor = 1 - effRes / 100;
    }

    const finalMult = Math.max(0.05, enemyFactor) * Math.max(0, 1 + typeTakenInc / 100) * typeTakenMore;
    const min = rawMin * finalMult;
    const max = rawMax * finalMult;
    const avg = (min + max) / 2;
    damageByType[dt] = { min: Math.round(min), max: Math.round(max), average: round2(avg) };
    totalAvgHit += avg;
  }

  // Step F: Minion Attack / Cast Speed
  const baseRate =
    isSpell && minionBase.castTime && minionBase.castTime > 0
      ? 1 / minionBase.castTime
      : Math.max(0.01, minionBase.attacksPerSecond) * (1 + (minionBase.moreAttackSpeedPct ?? 0) / 100);
  const speedInc = minionDb.sum('INC', 'Speed', flags, kwFlags);
  const speedMore = minionDb.more('Speed', flags, kwFlags);
  const actionSpeedMult =
    Math.max(0.1, 1 + minionDb.sum('INC', 'ActionSpeed', flags, kwFlags) / 100) *
    minionDb.more('ActionSpeed', flags, kwFlags);
  const speedExact = Math.max(0.01, baseRate * Math.max(0.1, 1 + speedInc / 100) * speedMore * actionSpeedMult);

  const avgHitWithCrit = totalAvgHit * effectiveCritMultiplier * doubleDamageMult;
  const perMinionHitDps = avgHitWithCrit * speedExact * (hitChance / 100);

  // Step G: Minion Impale DPS (Physical Attack Minions)
  let perMinionImpaleDps = 0;
  const impaleChance = !isSpell ? clamp(minionDb.sum('BASE', 'ImpaleChance', flags, kwFlags), 0, 100) : 0;
  if (!isSpell && impaleChance > 0 && damageByType.Physical.average > 0) {
    const impaleEffect = minionDb.sum('INC', 'ImpaleEffect', flags, kwFlags);
    const maxImpaleHits = 5 + minionDb.sum('BASE', 'ImpaleStacksMax', flags, kwFlags);
    const physHitDps =
      damageByType.Physical.average * effectiveCritMultiplier * doubleDamageMult * speedExact * (hitChance / 100);
    perMinionImpaleDps = physHitDps * 0.1 * (1 + impaleEffect / 100) * maxImpaleHits * (impaleChance / 100);
  }

  // Step H: Active Minion Count
  const activeCount = resolveActiveMinionCount(input);

  // Step I: Per-minion & Group Ailments (Poison / Bleed / Ignite / skillData DoTs)
  const perMinionAilments = computeAuthenticAilmentAndSkillDots({
    game,
    skillDb: minionDb,
    enemyDb,
    baseDamageByType: convertedBaseAvg,
    baseDamageRangeByType: convertedBaseRange,
    preMitigationHitByType,
    hitDamageRangeByType: damageByType,
    flags,
    keywordFlags: kwFlags,
    speed: speedExact,
    hitChancePct: hitChance,
    critChancePct: critChance,
    critMultiplierPct: critMultiplier,
    isAttack: !isSpell,
    skillData: input.skillData,
    enemyConfig,
  });

  // Group ailment aggregation:
  // - PoE 1 infinite Poison stacks scale across all `activeCount` minions (capped by `maxStacks` if finite, e.g. PoE 2).
  // - Ignite does not stack across minions (strongest single ignite applies, or maxIgniteStacks).
  // - Bleed does not stack across minions unless Crimson Dance (which caps at 8 across combined hit rate).
  const totalPoisonDps = !Number.isFinite(perMinionAilments.poison.maxStacks)
    ? perMinionAilments.poison.totalDps * activeCount
    : perMinionAilments.poison.singleStackDps *
      Math.min(perMinionAilments.poison.maxStacks, perMinionAilments.poison.effectiveStacks * activeCount);

  const totalBleedDps = perMinionAilments.bleed.isCrimsonDance
    ? perMinionAilments.bleed.singleStackDps *
      Math.min(8, perMinionAilments.bleed.effectiveStacks * activeCount)
    : perMinionAilments.bleed.totalDps;

  const totalIgniteDps = perMinionAilments.ignite.totalDps;
  const totalSkillDotDps =
    input.skillData?.dotCanStack ? perMinionAilments.skillDot.totalDps * activeCount : perMinionAilments.skillDot.totalDps;

  const perMinionTotalDps =
    perMinionHitDps +
    perMinionImpaleDps +
    perMinionAilments.poison.totalDps +
    perMinionAilments.bleed.totalDps +
    perMinionAilments.ignite.totalDps +
    perMinionAilments.skillDot.totalDps;

  const totalHitDps = perMinionHitDps * activeCount;
  const totalImpaleDps = perMinionImpaleDps * activeCount;
  const totalGroupDps =
    totalHitDps + totalImpaleDps + totalPoisonDps + totalBleedDps + totalIgniteDps + totalSkillDotDps;

  return {
    game,
    effLevel,
    levelDamageScale,
    activeCount,
    perMinion: {
      damageByType,
      averageHit: round2(avgHitWithCrit),
      speed: round2(speedExact),
      hitChance,
      critChance,
      critMultiplier,
      effectiveCritMultiplier: round2(effectiveCritMultiplier),
      hitDps: round2(perMinionHitDps),
      impaleDps: round2(perMinionImpaleDps),
      poisonDps: perMinionAilments.poison.totalDps,
      bleedDps: perMinionAilments.bleed.totalDps,
      igniteDps: perMinionAilments.ignite.totalDps,
      skillDotDps: perMinionAilments.skillDot.totalDps,
      totalDps: round2(perMinionTotalDps),
    },
    total: {
      hitDps: round2(totalHitDps),
      impaleDps: round2(totalImpaleDps),
      poisonDps: round2(totalPoisonDps),
      bleedDps: round2(totalBleedDps),
      igniteDps: round2(totalIgniteDps),
      skillDotDps: round2(totalSkillDotDps),
      totalDps: round2(totalGroupDps),
    },
    ailments: perMinionAilments,
  };
}
