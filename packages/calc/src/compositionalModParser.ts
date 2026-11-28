import {
  KeywordFlag,
  ModFlag,
  type GameId,
  type Mod,
  type ModTag,
  type ModType,
} from '@webpob/core';
import { normalizeStatLineToEn } from '@webpob/i18n';
import { normalizeGemFilterTokens } from './gemBonus.js';
import {
  capFirst,
  MOD_NAME_TABLE,
  remapStatNameForScope,
  STAGE1_PREFIX_RULES,
  STAGE1_SUFFIX_RULES,
  STAGE2_PREFIX_SCOPE_RULES,
  STAGE2_SUFFIX_SCOPE_RULES,
  toPascalCase,
  type ActorScope,
  type ModNameTarget,
  type SlotScope,
  type SubjectHint,
} from './compositionalModTables.js';

export interface CompositionalParseOptions {
  game?: GameId;
  allowBonded?: boolean;
}

interface PeelState {
  stem: string;
  actorScope: ActorScope;
  subjectHint?: SubjectHint;
  flags: number;
  keywordFlags: number;
  tags: ModTag[];
  modSuffix?: 'Taken' | 'Dealt';
  slotScope?: SlotScope;
}

const POB_BRACE_TAG_RE =
  /\{(?:variant:[^}]*|range:[^}]*|tags:[^}]*|crafted|fractured|enchant|implicit|crucible|scourge|mutated|custom|exarch|eater|synthesised|veiled|[^}]*)\}/gi;

const PAREN_PROVENANCE_RE =
  /\((?:implicit|crafted|enchant|fractured|rune|desecrated|scourge|mutated|augmented|unmet|crucible|veiled|synthetic)\)/gi;

/**
 * Splits multi-line modifier entries (e.g. Keystones containing embedded `\n`)
 * into individual lines, strips PoB metadata tags (`{variant:...}`, `{range:...}`,
 * `{crafted}`, `{fractured}`, `{enchant}`, `{implicit}`, `{crucible}`, `{scourge}`,
 * `{mutated}`), resolves PoE 2 `[Key|Display]` markup -> `Display`, and normalizes
 * ZH -> EN via `normalizeStatLineToEn`.
 */
export function splitAndNormalizeModLines(rawLines: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of rawLines) {
    if (!entry) continue;
    for (const part of entry.split(/\r?\n/)) {
      const preStripped = part
        .replace(POB_BRACE_TAG_RE, '')
        .replace(/\[(?:[^|\]]+\|)?([^\]]+)\]/g, '$1')
        .replace(PAREN_PROVENANCE_RE, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!preStripped) continue;
      const normalized = normalizeStatLineToEn(preStripped);
      if (normalized) {
        out.push(normalized);
      }
    }
  }
  return out;
}

function makeMod(
  name: string,
  type: ModType,
  value: number | boolean | string,
  source: string,
  flags: number,
  keywordFlags: number,
  tags: readonly ModTag[],
): Mod {
  const mod: Mod = { name, type, value, flags, keywordFlags, source };
  if (tags.length > 0) {
    // Compositional suffix rules (", up to X%") express a total value cap (limitTotal),
    // not a raw stack count (e.g. Arcane Capacitor: 10% per 200 Mana, up to 50% total; Indigon: 25% per 200 Mana, up to 2000% total).
    mod.tags = tags.map((tag) => {
      if (
        (tag.type === 'PerStat' || tag.type === 'Multiplier') &&
        tag.limit !== undefined &&
        typeof value === 'number' &&
        value > 0
      ) {
        return { ...tag, limitTotal: true } as unknown as ModTag;
      }
      return tag;
    });
  }
  return mod;
}

function emitScopedMod(
  baseName: string,
  type: ModType,
  value: number | boolean | string,
  source: string,
  state: PeelState,
  extraFlags = 0,
  extraKeywordFlags = 0,
  extraTags: readonly ModTag[] = [],
): Mod {
  const name = remapStatNameForScope(
    baseName,
    state.actorScope,
    state.modSuffix,
    state.slotScope,
    state.subjectHint,
  );
  const combinedTags =
    extraTags.length > 0 ? [...state.tags, ...extraTags] : state.tags;
  return makeMod(
    name,
    type,
    value,
    source,
    state.flags | extraFlags,
    state.keywordFlags | extraKeywordFlags,
    combinedTags,
  );
}

// ============================================================================
// Pre-Peel Exact Keystone / Structural Patterns
// ============================================================================

function matchPrePeelStructural(line: string, source: string): Mod[] | null {
  // Pool zeroing & Keystone overrides
  if (/^(?:Removes all mana|You have no Mana)$/i.test(line)) {
    return [
      makeMod('Mana', 'OVERRIDE', 0, source, 0, 0, []),
      makeMod('BloodMagic', 'FLAG', true, source, 0, 0, []),
    ];
  }
  if (/^(?:Removes all Energy Shield|You have no Energy Shield|Cannot have Energy Shield)$/i.test(line)) {
    return [makeMod('EnergyShield', 'OVERRIDE', 0, source, 0, 0, [])];
  }
  if (/^You have no Spirit$/i.test(line)) {
    return [makeMod('ZeroSpirit', 'FLAG', true, source, 0, 0, [])];
  }
  const ciMatch = line.match(/^Maximum Life (?:becomes|is) 1(?:,\s*(Immune to Chaos Damage))?$/i);
  if (ciMatch) {
    const mods: Mod[] = [
      makeMod('Life', 'OVERRIDE', 1, source, 0, 0, []),
      makeMod('ChaosInoculation', 'FLAG', true, source, 0, 0, []),
    ];
    if (ciMatch[1]) {
      mods.push(makeMod('ChaosImmune', 'FLAG', true, source, 0, 0, []));
    }
    return mods;
  }
  if (/^(?:Your )?Hits can(?:'t|not) be Evaded$/i.test(line)) {
    return [
      makeMod('CannotBeEvaded', 'FLAG', true, source, 0, KeywordFlag.Hit, []),
      makeMod('HitsCantBeEvaded', 'FLAG', true, source, 0, KeywordFlag.Hit, []),
    ];
  }
  if (/^(?:Never|Cannot) deal Critical (?:Strikes|Hits)$/i.test(line)) {
    return [makeMod('NeverCrit', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^Skills Reserve Life instead of Mana$/i.test(line)) {
    return [makeMod('ReserveLifeInsteadOfMana', 'FLAG', true, source, 0, 0, [])];
  }
  const costLifeMatch = line.match(
    /^(?:(Attack|Spell) )?Skills? Cost Life instead of (?:(\d+)% of )?Mana(?: Cost)?$/i,
  );
  if (costLifeMatch) {
    const pct = costLifeMatch[2] ? Number(costLifeMatch[2]) : 100;
    const scope = (costLifeMatch[1] ?? '').toLowerCase();
    const flags = scope === 'attack' ? ModFlag.Attack : scope === 'spell' ? ModFlag.Spell : 0;
    const mods: Mod[] = [makeMod('ManaCostConvertToLife', 'BASE', pct, source, flags, 0, [])];
    if (pct === 100 && flags === 0) {
      mods.push(makeMod('BloodMagic', 'FLAG', true, source, 0, 0, []));
    }
    return mods;
  }
  if (/^Intelligence provides no inherent bonus to Energy Shield$/i.test(line)) {
    return [makeMod('NoIntBonusToES', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^Auras from your Skills can only affect you$/i.test(line)) {
    return [makeMod('SupremeEgo', 'FLAG', true, source, 0, KeywordFlag.Aura, [])];
  }
  if (/^All Damage is taken from Mana before Life$/i.test(line)) {
    return [makeMod('DamageTakenFromManaBeforeLife', 'BASE', 100, source, 0, 0, [])];
  }
  if (/^Converts all Evasion Rating to Armour/i.test(line)) {
    return [makeMod('IronReflexes', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^Energy Shield protects Mana instead of Life$/i.test(line)) {
    return [makeMod('EldritchBattery', 'FLAG', true, source, 0, 0, [])];
  }
  const poe2Eb = line.match(/^Convert (\d+)% of maximum Energy Shield to maximum Mana$/i);
  if (poe2Eb) {
    return [
      makeMod('Poe2EldritchBattery', 'FLAG', true, source, 0, 0, []),
      makeMod('EsConvertToMana', 'BASE', Number(poe2Eb[1]), source, 0, 0, []),
    ];
  }
  if (/^Strength's Damage bonus applies to all Spell Damage/i.test(line)) {
    return [makeMod('IronWill', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^Strength's Damage bonus applies to Projectile Attack Damage/i.test(line)) {
    return [makeMod('IronGrip', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^Your Critical (?:Strikes|Hits) do not deal extra Damage$/i.test(line)) {
    return [makeMod('NoCritExtraDamage', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^Hits(?: with this Weapon)? have no Critical Damage Bonus$/i.test(line)) {
    return [makeMod('NoCritExtraDamage', 'FLAG', true, source, 0, 0, [])];
  }
  const critIgnores = line.match(
    /^Critical (?:Strikes|Hits) ignore Enemy (?:Monster )?(Elemental|Fire|Cold|Lightning) Resistances?$/i,
  );
  if (critIgnores) {
    const el = capFirst(critIgnores[1]!);
    return [
      makeMod(
        el === 'Elemental' ? 'CritIgnoresEleRes' : `CritIgnores${el}Res`,
        'FLAG',
        true,
        source,
        0,
        0,
        [],
      ),
    ];
  }
  if (/^Life Recovery from Regeneration is not applied$/i.test(line)) {
    return [makeMod('NoLifeRegen', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^Energy Shield does not Recharge$/i.test(line)) {
    return [makeMod('NoEsRecharge', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^No Physical Damage$/i.test(line)) {
    return [makeMod('DealNoPhysical', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^Deal no (Elemental|Chaos|Non-Fire|Physical) Damage$/i.test(line)) {
    const m = line.match(/^Deal no (Elemental|Chaos|Non-Fire|Physical) Damage$/i)!;
    const key = m[1]!.toLowerCase() === 'non-fire' ? 'NonFire' : capFirst(m[1]!);
    return [makeMod(`DealNo${key}`, 'FLAG', true, source, 0, 0, [])];
  }
  if (/^Cannot inflict Elemental Ailments$/i.test(line)) {
    return [makeMod('CannotIgnite', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^Hits always Ignite$/i.test(line)) {
    return [makeMod('IgniteChance', 'BASE', 100, source, ModFlag.Hit, 0, [])];
  }
  if (/^Blood Magic$/i.test(line)) {
    return [
      makeMod('Mana', 'OVERRIDE', 0, source, 0, 0, []),
      makeMod('BloodMagic', 'FLAG', true, source, 0, 0, []),
    ];
  }
  if (/^The Agnostic$/i.test(line)) {
    return [makeMod('EnergyShield', 'OVERRIDE', 0, source, 0, 0, [])];
  }
  if (/^Culling Strike$/i.test(line)) {
    return [makeMod('CullingStrike', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^Battlemage$/i.test(line)) {
    return [makeMod('Battlemage', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^Rampage$/i.test(line)) {
    return [makeMod('Rampage', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^Onslaught$/i.test(line)) {
    return [
      makeMod('Speed', 'INC', 20, source, ModFlag.Attack, 0, []),
      makeMod('Speed', 'INC', 20, source, ModFlag.Spell, 0, []),
      makeMod('MovementSpeed', 'INC', 20, source, 0, 0, []),
    ];
  }
  if (/^Monsters cannot Block your Attacks$/i.test(line)) {
    return [makeMod('AttacksCannotBeBlocked', 'FLAG', true, source, ModFlag.Attack, 0, [])];
  }
  const thresholdLife = line.match(
    /^You count as on (Low|Full) Life while at (\d+)% of maximum Life or (?:below|above)$/i,
  );
  if (thresholdLife) {
    return [
      makeMod(
        `${capFirst(thresholdLife[1]!)}LifeThreshold`,
        'OVERRIDE',
        Number(thresholdLife[2]),
        source,
        0,
        0,
        [],
      ),
    ];
  }
  if (/^Has no Attribute Requirements$/i.test(line)) {
    return [makeMod('NoAttributeRequirements', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^Strikes deal Splash Damage$/i.test(line)) {
    return [makeMod('MeleeSplash', 'FLAG', true, source, ModFlag.Melee, 0, [])];
  }
  if (/^Gain Accuracy Rating equal to your Intelligence$/i.test(line)) {
    return [makeMod('AccuracyFromInt', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^Increases and Reductions to Projectile Speed also apply to Damage with Bows$/i.test(line)) {
    return [makeMod('ProjectileSpeedAppliesToBowDamage', 'FLAG', true, source, ModFlag.Bow, 0, [])];
  }
  if (/^Ignore all Movement Penalties from Armour$/i.test(line)) {
    return [makeMod('NoArmourMovePenalty', 'FLAG', true, source, 0, 0, [])];
  }
  if (/^You have your maximum Fortification$/i.test(line)) {
    return [
      makeMod('AlwaysFortified', 'FLAG', true, source, 0, 0, []),
      makeMod('Condition:Fortified', 'FLAG', true, source, 0, 0, []),
      makeMod('Condition:HaveMaximumFortification', 'FLAG', true, source, 0, 0, []),
    ];
  }
  if (/^(?:Curses you inflict|[A-Za-z ']+?) can affect Hexproof Enemies$/i.test(line)) {
    return [makeMod('IgnoreHexproof', 'FLAG', true, source, 0, KeywordFlag.Curse, [])];
  }
  const onHitDebuff = line.match(/^(Crushes|Maims|Intimidates|Unnerves|Blinds|Taunts) Enemies on Hit$/i);
  if (onHitDebuff) {
    return [makeMod(`${capFirst(onHitDebuff[1]!)}OnHit`, 'FLAG', true, source, ModFlag.Hit, 0, [])];
  }
  const enemyAreStatus = line.match(
    /^(?:Nearby )?Enemies (?:you Curse|in your Presence|within [\d.]+ metres) are (Unnerved|Intimidated|Hindered|Maimed|Blinded|Chilled|Shocked|Taunted|Crushed)(?:,\s*with (\d+)% reduced Movement Speed)?$/i,
  );
  if (enemyAreStatus) {
    const mods = [
      makeMod(`Enemy${capFirst(enemyAreStatus[1]!)}`, 'FLAG', true, source, 0, 0, []),
    ];
    if (enemyAreStatus[2]) {
      mods.push(makeMod('EnemyMovementSpeed', 'INC', -Number(enemyAreStatus[2]), source, 0, 0, []));
    }
    return mods;
  }

  // Standalone Keystone names (e.g. Unique items granting a Keystone directly)
  const STANDALONE_KEYSTONES: Readonly<Record<string, readonly string[]>> = {
    'eldritch battery': ['EldritchBattery'],
    'unwavering stance': ['UnwaveringStance', 'CannotEvade', 'StunImmune'],
    'iron reflexes': ['IronReflexes'],
    'chaos inoculation': ['ChaosInoculation', 'ChaosImmune'],
    'mind over matter': ['MindOverMatter'],
    "zealot's oath": ['ZealotsOath'],
    'ghost reaver': ['GhostReaver'],
    'vaal pact': ['VaalPact'],
    'point blank': ['PointBlank'],
    'resolute technique': ['ResoluteTechnique', 'HitsCantBeEvaded', 'CannotBeEvaded', 'NeverCrit'],
    'ancestral bond': ['AncestralBond'],
    'avatar of fire': ['AvatarOfFire', 'DealNoNonFire'],
    acrobatics: ['Acrobatics'],
    'pain attunement': ['PainAttunement'],
    'iron will': ['IronWill'],
    'iron grip': ['IronGrip'],
    'elemental equilibrium': ['ElementalEquilibrium'],
    'elemental overload': ['ElementalOverload', 'NoCritExtraDamage', 'NoCritAilments'],
    'perfect agony': ['PerfectAgony', 'NoCritExtraDamage', 'NonCritsCannotInflictAilments'],
    'crimson dance': ['CrimsonDance'],
    'wicked ward': ['WickedWard'],
    'glancing blows': ['GlancingBlows'],
    'arrow dancing': ['ArrowDancing'],
    'wind dancer': ['WindDancer'],
    runebinder: ['Runebinder'],
    'ghost dance': ['GhostDance'],
    'lethe shade': ['LetheShade'],
    'eternal youth': ['EternalYouth'],
    magebane: ['Magebane', 'NoDexEvasionBonus'],
    'precise technique': ['PreciseTechnique', 'NeverCrit'],
    'divine shield': ['DivineShield'],
    'versatile combatant': ['VersatileCombatant'],
    'supreme ego': ['SupremeEgo'],
    'corrupted soul': ['CorruptedSoul'],
    'divine flesh': ['DivineFlesh'],
    'inner conviction': ['InnerConviction'],
  };
  const ksFlags = STANDALONE_KEYSTONES[line.toLowerCase()];
  if (ksFlags) {
    const mods = ksFlags.map((f) => makeMod(f, 'FLAG', true, source, 0, 0, []));
    const lowerKs = line.toLowerCase();
    if (lowerKs === 'chaos inoculation') {
      mods.unshift(makeMod('Life', 'OVERRIDE', 1, source, 0, 0, []));
    } else if (lowerKs === 'corrupted soul') {
      mods.unshift(makeMod('LifeAsExtraES', 'BASE', 15, source, 0, 0, []));
    } else if (lowerKs === 'divine flesh') {
      mods.unshift(
        makeMod('ChaosResistMax', 'BASE', 5, source, 0, 0, []),
        makeMod('EleTakenAsChaos', 'BASE', 50, source, 0, 0, []),
      );
    } else if (lowerKs === 'elemental overload') {
      mods.push(makeMod('ElementalDamage', 'MORE', 40, source, 0, 0, []));
    } else if (lowerKs === 'precise technique') {
      mods.push(makeMod('PreciseTechniqueMorePct', 'BASE', 40, source, 0, 0, []));
    } else if (lowerKs === 'magebane') {
      mods.push(
        makeMod('SpellSuppressionChance', 'BASE', 1, source, 0, 0, [
          { type: 'PerStat', stat: 'Dex', div: 15 },
        ]),
      );
    }
    return mods;
  }

  return null;
}

// ============================================================================
// Stage 1 & Stage 2 Iterative Peelers
// ============================================================================

function peelStage1AndStage2(line: string): PeelState {
  const state: PeelState = {
    stem: line.trim(),
    actorScope: 'player',
    flags: 0,
    keywordFlags: 0,
    tags: [],
  };

  const applyEffect = (eff: ReturnType<(typeof STAGE1_PREFIX_RULES)[number]['apply']>) => {
    if (eff.actorScope && state.actorScope === 'player') {
      state.actorScope = eff.actorScope;
    }
    if (eff.subjectHint && !state.subjectHint) {
      state.subjectHint = eff.subjectHint;
    }
    if (eff.flags) state.flags |= eff.flags;
    if (eff.keywordFlags) state.keywordFlags |= eff.keywordFlags;
    if (eff.tags) state.tags.push(...eff.tags);
    if (eff.modSuffix && !state.modSuffix) state.modSuffix = eff.modSuffix;
    if (eff.slotScope && !state.slotScope) state.slotScope = eff.slotScope;
  };

  // Stage 1A: iteratively peel leading prefixes
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 6) {
    changed = false;
    for (const rule of STAGE1_PREFIX_RULES) {
      const m = state.stem.match(rule.regex);
      if (m && m[0].length < state.stem.length) {
        applyEffect(rule.apply(m));
        state.stem = state.stem.slice(m[0].length).trim();
        changed = true;
        break;
      }
    }
  }

  // Stage 1B: iteratively peel trailing suffixes (collect in reverse then append to preserve order)
  const suffixTags: ModTag[] = [];
  changed = true;
  guard = 0;
  while (changed && guard++ < 6) {
    changed = false;
    for (const rule of STAGE1_SUFFIX_RULES) {
      const m = state.stem.match(rule.regex);
      if (m && m[0].length < state.stem.length) {
        const eff = rule.apply(m);
        if (eff.actorScope && state.actorScope === 'player') state.actorScope = eff.actorScope;
        if (eff.flags) state.flags |= eff.flags;
        if (eff.keywordFlags) state.keywordFlags |= eff.keywordFlags;
        if (eff.slotScope && !state.slotScope) state.slotScope = eff.slotScope;
        if (eff.tags) suffixTags.unshift(...eff.tags);
        state.stem = state.stem.slice(0, state.stem.length - m[0].length).trim();
        changed = true;
        break;
      }
    }
  }
  state.tags.push(...suffixTags);

  // Stage 2: iteratively peel weapon / skill / element scopes from both ends
  changed = true;
  guard = 0;
  while (changed && guard++ < 6) {
    changed = false;
    for (const rule of STAGE2_PREFIX_SCOPE_RULES) {
      const m = state.stem.match(rule.regex);
      if (m && m[0].length < state.stem.length) {
        if (rule.flags) state.flags |= rule.flags;
        if (rule.keywordFlags) state.keywordFlags |= rule.keywordFlags;
        if (rule.tags) state.tags.push(...rule.tags);
        if (rule.actorScope && state.actorScope === 'player') state.actorScope = rule.actorScope;
        state.stem = state.stem.slice(m[0].length).trim();
        changed = true;
        break;
      }
    }
    if (changed) continue;
    for (const rule of STAGE2_SUFFIX_SCOPE_RULES) {
      const m = state.stem.match(rule.regex);
      if (m && m[0].length < state.stem.length) {
        if (rule.flags) state.flags |= rule.flags;
        if (rule.keywordFlags) state.keywordFlags |= rule.keywordFlags;
        if (rule.tags) state.tags.push(...rule.tags);
        if (rule.actorScope && state.actorScope === 'player') state.actorScope = rule.actorScope;
        if (rule.slotScope && !state.slotScope) state.slotScope = rule.slotScope;
        state.stem = state.stem.slice(0, state.stem.length - m[0].length).trim();
        changed = true;
        break;
      }
    }
  }

  return state;
}

// ============================================================================
// Stage 3: Post-Peel Special Structural Patterns
// ============================================================================

function matchPostPeelStructural(state: PeelState, source: string): Mod[] | null {
  const s = state.stem;

  // The Agnostic line 2: "Sacrifice 20% of Mana per Second to Recover that much Life"
  let m = s.match(/^Sacrifice (\d+(?:\.\d+)?)% of Mana per Second to Recover that much Life$/i);
  if (m) {
    return [emitScopedMod('AgnosticManaSacrificePct', 'BASE', Number(m[1]), source, state)];
  }

  // Conversions: "X% of <Src> Damage Converted to <Dst> Damage"
  m = s.match(
    /^(\d+(?:\.\d+)?)% of (?:(Physical|Lightning|Cold|Fire|Elemental)\s+)?Damage Converted to (Lightning|Cold|Fire|Chaos) Damage$/i,
  );
  if (m) {
    const val = Number(m[1]);
    const srcRaw = m[2] ? capFirst(m[2]) : 'All';
    const dst = capFirst(m[3]!);
    if (srcRaw === 'All') {
      return (['Physical', 'Lightning', 'Cold', 'Fire'] as const)
        .filter((el) => el !== dst)
        .map((el) => emitScopedMod(`${el}DamageConvertTo${dst}`, 'BASE', val, source, state));
    }
    if (srcRaw === 'Elemental') {
      return (['Lightning', 'Cold', 'Fire'] as const)
        .filter((el) => el !== dst)
        .map((el) => emitScopedMod(`${el}DamageConvertTo${dst}`, 'BASE', val, source, state));
    }
    return [emitScopedMod(`${srcRaw}DamageConvertTo${dst}`, 'BASE', val, source, state)];
  }

  // Multi-source conversion: "50% of Physical, Cold and Lightning Damage Converted to Fire Damage"
  m = s.match(
    /^(\d+(?:\.\d+)?)% of (Physical|Cold|Lightning|Fire),\s*(Physical|Cold|Lightning|Fire) and (Physical|Cold|Lightning|Fire) Damage Converted to (Lightning|Cold|Fire|Chaos) Damage$/i,
  );
  if (m) {
    const val = Number(m[1]);
    const dst = capFirst(m[5]!);
    return [capFirst(m[2]!), capFirst(m[3]!), capFirst(m[4]!)].map((src) =>
      emitScopedMod(`${src}DamageConvertTo${dst}`, 'BASE', val, source, state),
    );
  }

  // Gain as Extra Damage: "Gain X% of [Src] [Scope] Damage as [Extra] <Dst> Damage"
  // Also handles minion phrasing without "Extra" (e.g. "Minions gain 20% of Physical Damage as Chaos Damage").
  m = s.match(
    /^(?:Gain |Gains )?(\d+(?:\.\d+)?)% of (?:(Physical|Lightning|Cold|Fire|Elemental|Non-Chaos)(?:\s+(Attack|Spell|Wand|Melee))?\s+)?Damage as (?:Extra )?(Physical|Lightning|Cold|Fire|Chaos|Elemental) Damage$/i,
  );
  if (m) {
    const val = Number(m[1]);
    const srcRaw = m[2] ? m[2].toLowerCase() : '';
    const midScope = (m[3] ?? '').toLowerCase();
    const dst = capFirst(m[4]!);
    const extraFlags =
      midScope === 'attack'
        ? ModFlag.Attack
        : midScope === 'spell'
          ? ModFlag.Spell
          : midScope === 'wand'
            ? ModFlag.Wand
            : midScope === 'melee'
              ? ModFlag.Melee
              : 0;
    const prefix =
      srcRaw === 'non-chaos'
        ? 'NonChaosDamageGainAs'
        : srcRaw
          ? `${capFirst(srcRaw)}DamageGainAs`
          : 'DamageGainAs';
    if (dst === 'Elemental') {
      return (['Fire', 'Cold', 'Lightning'] as const).map((el) =>
        emitScopedMod(`${prefix}${el}`, 'BASE', val, source, state, extraFlags),
      );
    }
    return [emitScopedMod(`${prefix}${dst}`, 'BASE', val, source, state, extraFlags)];
  }

  // PoE 2 phrasing: "Gain X% Damage as extra <Dst> Damage" (without "of")
  m = s.match(
    /^(?:Gain |Gains )?(\d+(?:\.\d+)?)% Damage as Extra (Physical|Lightning|Cold|Fire|Chaos|Elemental) Damage$/i,
  );
  if (m) {
    const val = Number(m[1]);
    const dst = capFirst(m[2]!);
    if (dst === 'Elemental') {
      return (['Fire', 'Cold', 'Lightning'] as const).map((el) =>
        emitScopedMod(`DamageGainAs${el}`, 'BASE', val, source, state),
      );
    }
    return [emitScopedMod(`DamageGainAs${dst}`, 'BASE', val, source, state)];
  }

  // Added Flat Damage: "Adds X to Y <Element> Damage [to Attacks / Spells / Attacks and Spells]"
  m = s.match(
    /^Adds (\d+)(?:\s+to\s+|-)(\d+) (Physical|Fire|Cold|Lightning|Chaos) (?:(Attack|Spell) )?Damage(?: to (Attacks and Spells|Spells and Attacks|Attacks|Spells|Hits))?$/i,
  );
  if (m) {
    const minVal = Number(m[1]);
    const maxVal = Number(m[2]);
    const el = capFirst(m[3]!);
    const scope = (m[4] ?? m[5] ?? '').toLowerCase();
    const extraFlags =
      scope === 'attack' || scope === 'attacks'
        ? ModFlag.Attack
        : scope === 'spell' || scope === 'spells'
          ? ModFlag.Spell
          : 0;
    return [
      emitScopedMod(`${el}Min`, 'BASE', minVal, source, state, extraFlags),
      emitScopedMod(`${el}Max`, 'BASE', maxVal, source, state, extraFlags),
    ];
  }

  // Alternate Flat Damage: "X to Y [Added|Additional] [Attack|Spell] <Element> [Attack|Spell|Thorns] Damage"
  m = s.match(
    /^(\d+)(?:\s+to\s+|-)(\d+) (?:(?:Added|Additional) )?(?:(Attack|Spell) )?(Physical|Fire|Cold|Lightning|Chaos) (?:(Attack|Spell|Thorns) )?Damage$/i,
  );
  if (m) {
    const minVal = Number(m[1]);
    const maxVal = Number(m[2]);
    const el = capFirst(m[4]!);
    const scope = (m[3] ?? m[5] ?? '').toLowerCase();
    if (scope === 'thorns') {
      return [
        emitScopedMod(`Thorns${el}Min`, 'BASE', minVal, source, state),
        emitScopedMod(`Thorns${el}Max`, 'BASE', maxVal, source, state),
      ];
    }
    const extraFlags =
      scope === 'attack' ? ModFlag.Attack : scope === 'spell' ? ModFlag.Spell : 0;
    return [
      emitScopedMod(`${el}Min`, 'BASE', minVal, source, state, extraFlags),
      emitScopedMod(`${el}Max`, 'BASE', maxVal, source, state, extraFlags),
    ];
  }

  // Life/Mana as Extra ES & Life Converted to ES
  m = s.match(/^(\d+(?:\.\d+)?)% of Maximum Life Converted to Energy Shield$/i);
  if (m) {
    return [emitScopedMod('LifeConvertToES', 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(
    /^(?:Gain )?(\d+(?:\.\d+)?)% of Maximum (Life|Mana) as Extra Maximum Energy Shield$/i,
  );
  if (m) {
    return [emitScopedMod(`${capFirst(m[2]!)}AsExtraES`, 'BASE', Number(m[1]), source, state)];
  }

  // Damage Taken from Mana before Life
  m = s.match(
    /^(\d+(?:\.\d+)?)% of (?:(Physical|Fire|Cold|Lightning|Elemental) )?Damage(?: from Hits)? (?:is )?taken from Mana before Life$/i,
  );
  if (m) {
    const prefix = m[2] ? capFirst(m[2]) : '';
    return [
      emitScopedMod(`${prefix}DamageTakenFromManaBeforeLife`, 'BASE', Number(m[1]), source, state),
    ];
  }

  // Dual-element Damage Taken As (e.g. Purity of Fire Watcher's Eye: "15% of Cold and Lightning Damage taken as Fire Damage")
  m = s.match(
    /^(\d+(?:\.\d+)?)% of (Physical|Fire|Cold|Lightning|Chaos) and (Physical|Fire|Cold|Lightning|Chaos) Damage(?: from Hits)? taken as (Physical|Fire|Cold|Lightning|Chaos) Damage$/i,
  );
  if (m) {
    const val = Number(m[1]);
    const src1 = capFirst(m[2]!);
    const src2 = capFirst(m[3]!);
    const dst = capFirst(m[4]!);
    return [
      emitScopedMod(`${src1}DamageTakenAs${dst}`, 'BASE', val, source, state),
      emitScopedMod(`${src2}DamageTakenAs${dst}`, 'BASE', val, source, state),
    ];
  }

  // Damage Taken As
  m = s.match(
    /^(\d+(?:\.\d+)?)% of (Physical|Fire|Cold|Lightning|Elemental) Damage(?: from Hits)? taken as (Physical|Fire|Cold|Lightning|Chaos) Damage$/i,
  );
  if (m) {
    const src = capFirst(m[2]!);
    const dst = capFirst(m[3]!);
    const stat =
      src === 'Elemental' && dst === 'Chaos'
        ? 'EleTakenAsChaos'
        : `${src}DamageTakenAs${dst}`;
    return [emitScopedMod(stat, 'BASE', Number(m[1]), source, state)];
  }

  // Damage Recouped
  m = s.match(
    /^(\d+(?:\.\d+)?)% of (?:(Physical|Elemental|Fire|Cold|Lightning|Chaos) )?Damage taken Recouped as (Life|Mana|Energy Shield)$/i,
  );
  if (m) {
    const res = m[3]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : capFirst(m[3]!);
    const dmgPrefix = m[2] ? capFirst(m[2]) : '';
    return [emitScopedMod(`${dmgPrefix}${res}Recoup`, 'BASE', Number(m[1]), source, state)];
  }

  // Leech ("X% of [Type] Damage Leeched as Life/Mana/ES" or "Leech(es) X% of ... as ...")
  m = s.match(
    /^(?:Leech(?:es)? )?(\d+(?:\.\d+)?)% of (?:(Physical|Attack|Spell|Elemental|Fire|Cold|Lightning|Chaos|Physical Attack) )?Damage(?: dealt)? (?:is )?(?:Leeched )?as (Life|Energy Shield|Mana)$/i,
  );
  if (m) {
    const scope = (m[2] ?? '').toLowerCase();
    const extraFlags = scope.includes('attack')
      ? ModFlag.Attack
      : scope === 'spell'
        ? ModFlag.Spell
        : 0;
    const res = m[3]!.toLowerCase() === 'energy shield' ? 'Es' : capFirst(m[3]!);
    return [emitScopedMod(`${res}Leech`, 'BASE', Number(m[1]), source, state, extraFlags)];
  }

  // PoE 2 Mana Cost -> Life Cost / Deflection / Threshold conversions / Chaos ES bypass / Reflected
  m = s.match(/^(\d+(?:\.\d+)?)% of (?:Skill |Spell )?Mana Costs? Converted to Life Costs?$/i);
  if (m) {
    return [emitScopedMod('ManaCostConvertToLife', 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(/^Gain (\d+(?:\.\d+)?)% of Mana Cost as Extra Life Cost$/i);
  if (m) {
    return [emitScopedMod('ManaCostGainAsLifeCost', 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(/^Gain Deflection Rating equal to (\d+(?:\.\d+)?)% of Evasion Rating$/i);
  if (m) {
    return [emitScopedMod('DeflectionPerEvasionPct', 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(
    /^Gain additional (Stun|Ailment|Elemental Ailment) Threshold equal to (\d+(?:\.\d+)?)% of maximum Energy Shield$/i,
  );
  if (m) {
    return [
      emitScopedMod(`${toPascalCase(m[1]!)}ThresholdFromEsPct`, 'BASE', Number(m[2]), source, state),
    ];
  }
  m = s.match(/^(\d+(?:\.\d+)?)% of your Energy Shield is added to your Stun Threshold$/i);
  if (m) {
    return [emitScopedMod('StunThresholdFromEsPct', 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(/^(\d+(?:\.\d+)?)% of Chaos Damage taken does not bypass Energy Shield$/i);
  if (m) {
    return [emitScopedMod('ChaosDamageNotBypassEsPct', 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(/^Prevent \+?(\d+)% of Reflected (Elemental|Physical) Damage$/i);
  if (m) {
    return [emitScopedMod(`Reflected${capFirst(m[2]!)}DamagePrevented`, 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(/^Cannot take Reflected (Elemental|Physical) Damage$/i);
  if (m) {
    return [emitScopedMod(`${capFirst(m[1]!)}ReflectImmune`, 'FLAG', true, source, state)];
  }
  m = s.match(
    /^Unaffected by (Shocked Ground|Burning Ground|Chilled Ground|Desecrated Ground|Caustic Ground|Bleeding|Poison|Ignite|Shock|Chill|Freeze|Curses|Blind|Maim|Hinder)$/i,
  );
  if (m) {
    return [emitScopedMod(`UnaffectedBy${toPascalCase(m[1]!)}`, 'FLAG', true, source, state)];
  }
  m = s.match(/^Socketed Gems are Supported by Level (\d+) (.+)$/i);
  if (m) {
    return [emitScopedMod('SocketedSupportedBy', 'LIST', `${m[2]!.trim()} (Lv.${m[1]})`, source, state)];
  }
  m = s.match(/^(?:Skills |Projectiles )?Chain \+?(\d+) (?:additional )?times?$/i);
  if (m) {
    return [emitScopedMod('ChainCountMax', 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(/^Non-Vaal Strike Skills target (\d+) additional nearby Enem(?:y|ies)$/i);
  if (m) {
    return [emitScopedMod('StrikeAdditionalTargets', 'BASE', Number(m[1]), source, state, ModFlag.Melee)];
  }
  m = s.match(/^Can have up to (\d+) additional Traps? placed at a time$/i);
  if (m) {
    return [emitScopedMod('ActiveTrapLimit', 'BASE', Number(m[1]), source, state, 0, KeywordFlag.Trap)];
  }
  m = s.match(/^(\d+(?:\.\d+)?)% of damage from Blocked Hits$/i);
  if (m) {
    return [emitScopedMod('BlockedHitDamageTakenPct', 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(/^(\d+(?:\.\d+)?)% of Flask Recovery applied Instantly$/i);
  if (m) {
    return [emitScopedMod('FlaskInstantRecoveryPct', 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(/^Warcries have a minimum of (\d+) Power$/i);
  if (m) {
    return [emitScopedMod('WarcryMinimumPower', 'BASE', Number(m[1]), source, state, 0, KeywordFlag.Warcry)];
  }
  m = s.match(/^Remnants can be collected from (\d+)% further away$/i);
  if (m) {
    return [emitScopedMod('RemnantCollectRange', 'INC', Number(m[1]), source, state)];
  }
  m = s.match(
    /^\+?(\d+(?:\.\d+)?)% (?:Surpassing )?chance (?:for (?:Spell Skills|Attack Skills|Projectiles|Bow Skills) )?to fire (?:an|(\d+)) additional (?:Projectiles?|Arrows?)$/i,
  );
  if (m) {
    return [emitScopedMod('ExtraProjectileChance', 'BASE', Number(m[1]), source, state, ModFlag.Projectile)];
  }
  m = s.match(
    /^(\d+(?:\.\d+)?)% chance (?:to Recover (\d+(?:\.\d+)?)% of (Life|Mana|Energy Shield) when you use a Skill|to gain a Flask Charge when you deal a Critical Strike|to gain (?:a |an )?(?:Power|Frenzy|Endurance|Unholy Might)? ?Charge?s?.*)$/i,
  );
  if (m) {
    const lower = s.toLowerCase();
    const stat = lower.includes('recover')
      ? 'RecoverOnSkillUseChance'
      : lower.includes('flask charge')
        ? 'FlaskChargeOnCritChance'
        : lower.includes('unholy might')
          ? 'UnholyMightOnKillChance'
          : 'ChargeGainChance';
    return [emitScopedMod(stat, 'BASE', Number(m[1]), source, state)];
  }

  // Instant Leech %
  m = s.match(/^(\d+(?:\.\d+)?)% of (?:(Life|Mana|Energy Shield) )?Leech is Instant$/i);
  if (m) {
    const prefix = m[2] ? toPascalCase(m[2]) : '';
    return [emitScopedMod(`${prefix}InstantLeechPct`, 'BASE', Number(m[1]), source, state)];
  }

  // Life/Mana/ES on Kill / Hit / Block
  m = s.match(
    /^(?:Gain |Grants )?(\d+(?:\.\d+)?) (Life|Mana|Energy Shield) (?:gained )?(?:per Enemy Killed|on Kill)$/i,
  );
  if (m) {
    const res = m[2]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : capFirst(m[2]!);
    return [emitScopedMod(`${res}OnKill`, 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(
    /^(?:Gain |Grants )?(\d+(?:\.\d+)?) (Life|Mana|Energy Shield) (?:gained )?(?:per Enemy Hit|for each Enemy Hit|on Hit)$/i,
  );
  if (m) {
    const res = m[2]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : capFirst(m[2]!);
    return [emitScopedMod(`${res}OnHit`, 'BASE', Number(m[1]), source, state, ModFlag.Hit)];
  }
  m = s.match(
    /^(?:Gain |Recover )?(\d+(?:\.\d+)?) (Life|Mana|Energy Shield) (?:gained )?(?:when you Block|on Block)$/i,
  );
  if (m) {
    const res = m[2]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : capFirst(m[2]!);
    return [emitScopedMod(`${res}OnBlock`, 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(
    /^Recover (\d+(?:\.\d+)?)% of (?:maximum )?(Life|Mana|Energy Shield)(?: over \d+ seconds?)? (on Kill|when you Block|when you use a Flask|when you use a Guard Skill|when you use a Skill)$/i,
  );
  if (m) {
    const res = m[2]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : capFirst(m[2]!);
    const trigger = m[3]!.toLowerCase();
    const stat = trigger === 'on kill'
      ? `${res}OnKillPercent`
      : trigger === 'when you block'
        ? `${res}OnBlockPercent`
        : `${res}RecoveryOnTriggerPercent`;
    return [emitScopedMod(stat, 'BASE', Number(m[1]), source, state)];
  }

  // Gem Levels & Quality (+N to Level of all / Socketed ... Gems/Skills)
  m = s.match(
    /^\+(\d+) to Level of (all|Socketed) (?:([A-Za-z ]+?) )?(Support )?(?:Skill )?(?:Gems?|Skills?)$/i,
  );
  if (m) {
    const isSocketed = m[2]!.toLowerCase() === 'socketed';
    const isSup = Boolean(m[4]);
    const rawFilter = m[3]?.trim();
    const filterKey =
      normalizeGemFilterTokens(rawFilter) ||
      (rawFilter ? rawFilter.toLowerCase().replace(/\s+/g, '+') : 'all');
    const prefix = isSocketed
      ? isSup
        ? 'SocketedGemLevelSup'
        : 'SocketedGemLevel'
      : isSup
        ? 'GemLevelSup'
        : 'GemLevel';
    return [emitScopedMod(`${prefix}:${filterKey}`, 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(
    /^\+(\d+)% to Quality of (all|Socketed) (?:([A-Za-z ]+?) )?(?:Skill )?(?:Gems?|Skills?)$/i,
  );
  if (m) {
    const isSocketed = m[2]!.toLowerCase() === 'socketed';
    const rawFilter = m[3]?.trim();
    const filterKey =
      normalizeGemFilterTokens(rawFilter) ||
      (rawFilter ? rawFilter.toLowerCase().replace(/\s+/g, '+') : 'all');
    const prefix = isSocketed ? 'SocketedGemQuality' : 'GemQuality';
    return [emitScopedMod(`${prefix}:${filterKey}`, 'BASE', Number(m[1]), source, state)];
  }

  // Armour applies to Elemental Damage
  m = s.match(
    /^\+?(\d+(?:\.\d+)?)% of Armour(?: also)? applies to (Fire, Cold and Lightning|Elemental|Fire|Cold|Lightning) Damage(?: taken)?(?: from Hits)?$/i,
  );
  if (m) {
    const target = m[2]!.toLowerCase();
    const stat =
      target === 'elemental' || target.includes('fire, cold')
        ? 'ArmourAppliesToEle'
        : `ArmourAppliesTo${capFirst(target)}`;
    return [emitScopedMod(stat, 'BASE', Number(m[1]), source, state)];
  }

  // Extra Exposure
  m = s.match(
    /^(?:(Fire|Cold|Lightning|Elemental) )?Exposure you inflict applies (?:an extra|at least) -(\d+)% to (?:the affected |(?:Fire|Cold|Lightning) )?Resistances?$/i,
  );
  if (m) {
    return [emitScopedMod('ExtraExposure', 'BASE', Number(m[2]), source, state)];
  }

  // Base Crit Chance Override
  m = s.match(
    /^Base Critical (?:Strike|Hit) Chance(?: for (Attacks|Spells)(?: with Weapons)?)? is (\d+(?:\.\d+)?)%$/i,
  );
  if (m) {
    const scope = (m[1] ?? '').toLowerCase();
    const stat = scope === 'spells' ? 'SpellBaseCritOverride' : 'WeaponBaseCritChance';
    const extraFlags = scope === 'spells' ? ModFlag.Spell : scope === 'attacks' ? ModFlag.Attack : 0;
    return [emitScopedMod(stat, 'OVERRIDE', Number(m[2]), source, state, extraFlags)];
  }

  // Impale extra hits
  m = s.match(/^Impales you inflict last (\d+) additional Hits?$/i);
  if (m) {
    return [emitScopedMod('ImpaleStacksMax', 'BASE', Number(m[1]), source, state, ModFlag.Attack)];
  }

  // Additional Curse
  m = s.match(/^(?:You can apply )?(\d+|an) additional Curses?$/i);
  if (m) {
    const val = m[1]!.toLowerCase() === 'an' ? 1 : Number(m[1]);
    return [emitScopedMod('EnemyCurseLimit', 'BASE', val, source, state)];
  }

  // Pierce count
  m = s.match(/^(?:Projectiles )?Pierce (\d+|an) additional Targets?$/i);
  if (m) {
    const val = m[1]!.toLowerCase() === 'an' ? 1 : Number(m[1]);
    return [emitScopedMod('PierceCount', 'BASE', val, source, state, ModFlag.Projectile)];
  }

  // Immunities ("Cannot be X", "Immune to X", "X cannot be inflicted on you")
  m = s.match(
    /^Immune to (Chaos|Elemental|Fire|Cold|Lightning|Bleeding|Poison|Curse|Curses|Stun|Freeze|Chill|Shock|Ignite)(?: Damage)?(?: and (Bleeding|Poison|Freeze|Chill|Shock|Ignite))?$/i,
  );
  if (m) {
    const norm = (x: string) =>
      x.toLowerCase() === 'bleeding' ? 'Bleed' : x.toLowerCase() === 'curses' ? 'Curse' : capFirst(x);
    const mods = [emitScopedMod(`${norm(m[1]!)}Immune`, 'FLAG', true, source, state)];
    if (m[2]) {
      mods.push(emitScopedMod(`${norm(m[2])!}Immune`, 'FLAG', true, source, state));
    }
    return mods;
  }
  m = s.match(
    /^(?:You )?Cannot be (Frozen|Chilled|Shocked|Ignited|Stunned|Light Stunned|Blinded|Hindered|Maimed|Poisoned|Cursed|Slowed|Knocked Back|Electrocuted|Pinned)$/i,
  );
  if (m) {
    return [emitScopedMod(`CannotBe${toPascalCase(m[1]!)}`, 'FLAG', true, source, state)];
  }
  m = s.match(
    /^(Corrupted Blood|Bleeding|Poison|Ignite|Shock|Chill|Freeze|Damaging Ailments|Elemental Ailments) cannot be inflicted on you$/i,
  );
  if (m) {
    return [emitScopedMod(`${toPascalCase(m[1]!)}Immune`, 'FLAG', true, source, state)];
  }

  // Faster / Slower trailing forms (e.g. "Damaging Ailments [you inflict] deal damage 15% Faster", "Minions Revive 20% faster")
  m = s.match(/^Damaging Ailments(?: you inflict)? deal damage (\d+(?:\.\d+)?)% (faster|slower)$/i);
  if (m) {
    const sign = m[2]!.toLowerCase() === 'slower' ? -1 : 1;
    return [emitScopedMod('AilmentFaster', 'INC', sign * Number(m[1]), source, state)];
  }
  m = s.match(/^(Ignites?|Bleeding|Poisons?)(?: you inflict)? deals? Damage (\d+(?:\.\d+)?)% (faster|slower)$/i);
  if (m) {
    const kind = m[1]!.toLowerCase().startsWith('ignit')
      ? 'Ignite'
      : m[1]!.toLowerCase().startsWith('bleed')
        ? 'Bleed'
        : 'Poison';
    const sign = m[3]!.toLowerCase() === 'slower' ? -1 : 1;
    return [emitScopedMod(`${kind}Faster`, 'INC', sign * Number(m[2]), source, state)];
  }
  m = s.match(/^Revive (\d+(?:\.\d+)?)% (faster|slower)$/i);
  if (m) {
    const sign = m[2]!.toLowerCase() === 'slower' ? -1 : 1;
    return [emitScopedMod('ReviveSpeed', 'INC', sign * Number(m[1]), source, state)];
  }
  m = s.match(/^(Debuffs|Buffs) on you expire (\d+(?:\.\d+)?)% (faster|slower)$/i);
  if (m) {
    const sign = m[3]!.toLowerCase() === 'slower' ? -1 : 1;
    return [emitScopedMod(`${capFirst(m[1]!)}ExpiryRate`, 'INC', sign * Number(m[2]), source, state)];
  }
  m = s.match(/^Inherent loss of Rage is (\d+(?:\.\d+)?)% (slower|faster)$/i);
  if (m) {
    const sign = m[2]!.toLowerCase() === 'slower' ? -1 : 1;
    return [emitScopedMod('RageLossRate', 'INC', sign * Number(m[1]), source, state)];
  }

  // Flask / Charm / Socket / Rage / Utility structural patterns
  m = s.match(/^(?:(Life|Mana) )?Flasks gain (\d+(?:\.\d+)?) [Cc]harges?(?: every (\d+(?:\.\d+)?) [Ss]econds?| per [Ss]econd)$/i);
  if (m) {
    const prefix = m[1] ? capFirst(m[1]) : '';
    const rate = m[3] ? Number(m[2]) / Math.max(0.01, Number(m[3])) : Number(m[2]);
    return [emitScopedMod(`${prefix}FlaskChargesPerSec`, 'BASE', rate, source, state)];
  }
  m = s.match(/^Has (\d+) (?:(Abyssal|Augment) )?Sockets?$/i);
  if (m) {
    const prefix = m[2] ? capFirst(m[2]) : '';
    return [emitScopedMod(`${prefix}SocketCount`, 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(/^(?:Has |\+)(\d+) Charm Slots?$/i);
  if (m) {
    return [emitScopedMod('CharmSlots', 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(/^Gain (\d+) Rage(?: on (?:Melee )?Hit| when Hit by an Enemy)?$/i);
  if (m) {
    return [emitScopedMod('RageOnHit', 'BASE', Number(m[1]), source, state, ModFlag.Hit)];
  }
  m = s.match(/^Reflects (\d+) (Physical|Fire|Cold|Lightning|Chaos) Damage to (?:Melee )?Attackers$/i);
  if (m) {
    return [emitScopedMod(`Thorns${capFirst(m[2]!)}Damage`, 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(/^Grants (?:Skill:\s*)?(?:Level (\d+) )?([A-Za-z][A-Za-z ':-]+)$/i);
  if (m && !/^\d+ Passive Skill Points?$/i.test(m[2]!)) {
    return [emitScopedMod('GrantedSkill', 'LIST', m[2]!.trim(), source, state)];
  }
  m = s.match(/^Break (\d+)% increased Armour$/i);
  if (m) {
    return [emitScopedMod('ArmourBreak', 'INC', Number(m[1]), source, state)];
  }
  m = s.match(/^(?:You have )?Culling Strike$/i);
  if (m) {
    return [emitScopedMod('CullingStrike', 'FLAG', true, source, state)];
  }
  m = s.match(/^are (Unnerved|Intimidated|Hindered|Maimed|Blinded|Chilled|Shocked|Taunted|Crushed)$/i);
  if (m) {
    return [emitScopedMod(`Enemy${capFirst(m[1]!)}`, 'FLAG', true, source, state)];
  }

  return null;
}

// ============================================================================
// Stage 3B & Stage 4: Standard `formList` + `MOD_NAME_TABLE` Lookup
// ============================================================================

function lookupModName(rawStem: string): ModNameTarget | undefined {
  const cleaned = rawStem
    .trim()
    .replace(/\.+$/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  if (MOD_NAME_TABLE[cleaned]) return MOD_NAME_TABLE[cleaned];

  // Strip leading "global " filler and re-check
  if (cleaned.startsWith('global ')) {
    const noGlobal = cleaned.slice(7).trim();
    if (MOD_NAME_TABLE[noGlobal]) return MOD_NAME_TABLE[noGlobal];
  }

  // Strip leading "additional " filler and re-check
  if (cleaned.startsWith('additional ')) {
    const noAdd = cleaned.slice(11).trim();
    if (MOD_NAME_TABLE[noAdd]) return MOD_NAME_TABLE[noAdd];
  }

  // Strip leading "all " filler and re-check
  if (cleaned.startsWith('all ')) {
    const noAll = cleaned.slice(4).trim();
    if (MOD_NAME_TABLE[noAll]) return MOD_NAME_TABLE[noAll];
  }

  return undefined;
}

function emitFromTarget(
  target: ModNameTarget,
  modType: ModType,
  value: number,
  source: string,
  state: PeelState,
): Mod[] {
  const effectiveScope: ActorScope =
    state.actorScope !== 'player' ? state.actorScope : (target.actorScope ?? 'player');
  const effectiveState: PeelState =
    effectiveScope === state.actorScope ? state : { ...state, actorScope: effectiveScope };

  const names =
    modType === 'BASE' && target.baseNames ? target.baseNames : target.names;
  const finalType = target.forceType ?? modType;

  // Special case: Minion "Attack and Cast Speed" maps to a single MinionSpeed mod (flags = 0)
  if (
    effectiveScope === 'minion' &&
    names.length === 2 &&
    names[0] === 'Speed' &&
    names[1] === 'Speed'
  ) {
    return [
      emitScopedMod(
        'Speed',
        finalType,
        value,
        source,
        effectiveState,
        target.flags ?? 0,
        target.keywordFlags ?? 0,
        target.tags ?? [],
      ),
    ];
  }

  return names.map((statName, idx) =>
    emitScopedMod(
      statName,
      finalType,
      value,
      source,
      effectiveState,
      (target.flags ?? 0) | (target.perNameFlags?.[idx] ?? 0),
      target.keywordFlags ?? 0,
      target.tags ?? [],
    ),
  );
}

function matchFormAndLookup(state: PeelState, source: string): Mod[] {
  const s = state.stem;

  // 1. PEN form: "[Attack|Spell] Damage [with Weapons] Penetrates X% [of Enemy] <Element> Resistance(s)"
  let m = s.match(
    /^(?:(Attack|Spell) )?(?:Damage(?: with Weapons)? )?Penetrates? (\d+(?:\.\d+)?)% (?:of (?:Enemy |Cursed Enemies'? )?)?(Fire|Cold|Lightning|Chaos|Elemental) Resistances?$/i,
  );
  if (m) {
    const scope = (m[1] ?? '').toLowerCase();
    const extraFlags = scope === 'attack' ? ModFlag.Attack : scope === 'spell' ? ModFlag.Spell : 0;
    const val = Number(m[2]);
    const el = capFirst(m[3]!);
    return [emitScopedMod(`${el}Penetration`, 'BASE', val, source, state, extraFlags)];
  }

  // 2. REGENPERCENT / REGENFLAT
  m = s.match(
    /^(?:You )?Regenerate (\d+(?:\.\d+)?)% of (?:your )?(?:maximum )?(Life|Mana|Energy Shield) per second$/i,
  );
  if (m) {
    const res = m[2]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : capFirst(m[2]!);
    return [emitScopedMod(`${res}RegenPercent`, 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(
    /^(\d+(?:\.\d+)?)% of (?:maximum )?(Life|Mana|Energy Shield) Regenerat(?:ed|ion) per second$/i,
  );
  if (m) {
    const res = m[2]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : capFirst(m[2]!);
    return [emitScopedMod(`${res}RegenPercent`, 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(
    /^(?:You )?Regenerate (\d+(?:\.\d+)?) (Life|Mana|Energy Shield|Rage) per second$/i,
  );
  if (m) {
    const res = m[2]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : capFirst(m[2]!);
    return [emitScopedMod(`${res}Regen`, 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(
    /^(\d+(?:\.\d+)?) (Life|Mana|Energy Shield|Rage) Regenerat(?:ed|ion) per second$/i,
  );
  if (m) {
    const res = m[2]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : capFirst(m[2]!);
    return [emitScopedMod(`${res}Regen`, 'BASE', Number(m[1]), source, state)];
  }

  // 3. DEGENPERCENT / DEGENFLAT
  m = s.match(
    /^(?:You )?Lose (\d+(?:\.\d+)?)% of (?:your )?(?:maximum )?(Life|Mana|Energy Shield) per second$/i,
  );
  if (m) {
    const res = m[2]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : capFirst(m[2]!);
    return [emitScopedMod(`${res}DegenPercent`, 'BASE', Number(m[1]), source, state)];
  }
  m = s.match(/^(?:You )?Lose (\d+(?:\.\d+)?) (Life|Mana|Energy Shield) per second$/i);
  if (m) {
    const res = m[2]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : capFirst(m[2]!);
    return [emitScopedMod(`${res}Degen`, 'BASE', Number(m[1]), source, state)];
  }

  // 4. DOUBLED form ("Accuracy Rating is Doubled", "Mana Costs are Doubled")
  m = s.match(/^(.+?) (?:is|are) Doubled$/i);
  if (m) {
    const target = lookupModName(m[1]!.replace(/costs$/i, 'cost'));
    if (target) return emitFromTarget(target, 'MORE', 100, source, state);
  }

  // 5. Standard numeric forms: INC / RED / FASTER / SLOWER / MORE / LESS / CHANCE / BASE
  const formAttempts: Array<{ regex: RegExp; type: ModType; sign: 1 | -1; stemGroup: number }> = [
    { regex: /^(\d+(?:\.\d+)?)% increased (.+)$/i, type: 'INC', sign: 1, stemGroup: 2 },
    { regex: /^(\d+(?:\.\d+)?)% reduced (.+)$/i, type: 'INC', sign: -1, stemGroup: 2 },
    { regex: /^(\d+(?:\.\d+)?)% faster (.+)$/i, type: 'INC', sign: 1, stemGroup: 2 },
    { regex: /^(\d+(?:\.\d+)?)% slower (.+)$/i, type: 'INC', sign: -1, stemGroup: 2 },
    { regex: /^(\d+(?:\.\d+)?)% more (.+)$/i, type: 'MORE', sign: 1, stemGroup: 2 },
    { regex: /^(\d+(?:\.\d+)?)% less (.+)$/i, type: 'MORE', sign: -1, stemGroup: 2 },
    {
      regex: /^([+-]?\d+(?:\.\d+)?)% (?:additional |Surpassing )?chance (?:for (?:Attack Hits|Spell Skills|Projectiles|Flasks you use|Lightning Skills|Fire Skills|Cold Skills|Hits) )?(to .+)$/i,
      type: 'BASE',
      sign: 1,
      stemGroup: 2,
    },
    {
      regex: /^Grants? (\d+(?:\.\d+)?) (.+)$/i,
      type: 'BASE',
      sign: 1,
      stemGroup: 2,
    },
    {
      regex: /^([+-]?\d+(?:\.\d+)?)%? (?:to |additional )?(.+)$/i,
      type: 'BASE',
      sign: 1,
      stemGroup: 2,
    },
  ];

  for (const attempt of formAttempts) {
    const fm = s.match(attempt.regex);
    if (!fm) continue;
    const val = attempt.sign * Number(fm[1]);
    if (!Number.isFinite(val)) continue;
    const target = lookupModName(fm[attempt.stemGroup]!);
    if (target) {
      return emitFromTarget(target, attempt.type, val, source, state);
    }
  }

  return [];
}

function parseSingleNormalizedLine(
  canonical: string,
  source: string,
  options?: CompositionalParseOptions,
): Mod[] {
  let line = canonical;

  // Enforce PoE 2 Shaman-only Bonded gate
  const bondedMatch = line.match(/^Bonded:\s*(.+)$/i);
  if (bondedMatch) {
    if (!options?.allowBonded) return [];
    line = bondedMatch[1]!.trim();
    if (!line) return [];
  }

  // Fast check for exact pre-peel Keystones & pool zeroing overrides
  const prePeel = matchPrePeelStructural(line, source);
  if (prePeel) return prePeel;

  // Stages 1 & 2: Peel actor scopes, conditions, multipliers, per-stat, weapon/skill/element flags
  const peeled = peelStage1AndStage2(line);

  // Stage 3A: Post-peel structural patterns (conversions, gain-as-extra, flat added damage, leech, etc.)
  const postStructural = matchPostPeelStructural(peeled, source);
  if (postStructural) return postStructural;

  // Stage 3B & 4: Standard numeric forms (`formList`) + `MOD_NAME_TABLE` lookup
  return matchFormAndLookup(peeled, source);
}

/**
 * PoB-authentic 4-stage compositional modifier parser for PoE 1 and PoE 2.
 * Supports multi-line strings (splitting on `\n`), PoB brace tags, PoE 2 `[Key|Display]`
 * markup, and bilingual ZH/EN normalization.
 */
export function parseModCompositional(
  rawLine: string,
  source: string,
  options?: CompositionalParseOptions,
): Mod[] {
  const lines = splitAndNormalizeModLines([rawLine]);
  if (lines.length === 0) return [];
  const mods: Mod[] = [];
  for (const line of lines) {
    mods.push(...parseSingleNormalizedLine(line, source, options));
  }
  return mods;
}
