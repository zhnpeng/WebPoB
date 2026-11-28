import { KeywordFlag, ModFlag, type ModTag, type ModType } from '@webpob/core';

export type ActorScope = 'player' | 'minion' | 'enemy' | 'totem' | 'ally' | 'companion';

export type SubjectHint =
  | 'flask'
  | 'charm'
  | 'tincture'
  | 'aura'
  | 'curse'
  | 'mark'
  | 'offering'
  | 'mine'
  | 'trap'
  | 'totem'
  | 'brand'
  | 'warcry'
  | 'banner'
  | 'herald'
  | 'parry'
  | 'ballista'
  | 'stance'
  | 'guard'
  | 'retaliation'
  | 'debuff'
  | 'minion';

export type SlotScope = 'BodyArmour' | 'Shield' | 'Helmet' | 'Focus' | 'Boots' | 'Gloves';

export interface Stage1Effect {
  actorScope?: ActorScope;
  subjectHint?: SubjectHint;
  flags?: number;
  keywordFlags?: number;
  tags?: ModTag[];
  modSuffix?: 'Taken' | 'Dealt';
  slotScope?: SlotScope;
}

export interface Stage1Rule {
  regex: RegExp;
  apply: (match: RegExpMatchArray) => Stage1Effect;
}

export interface Stage2ScopeRule {
  regex: RegExp;
  flags?: number;
  keywordFlags?: number;
  tags?: readonly ModTag[];
  actorScope?: ActorScope;
  slotScope?: SlotScope;
}

export interface ModNameTarget {
  /** Canonical stat name(s) consumed by WebPoB's calculation engine. */
  names: readonly string[];
  /** Optional per-name ModFlag overrides (e.g. Attack and Cast Speed -> Attack + Spell). */
  perNameFlags?: readonly number[];
  /** Additional ModFlags OR'd onto all emitted mods. */
  flags?: number;
  /** Additional KeywordFlags OR'd onto all emitted mods. */
  keywordFlags?: number;
  /** Additional ModTags attached to all emitted mods. */
  tags?: readonly ModTag[];
  /**
   * Optional stat name override when matched via a flat BASE form
   * (e.g. "+1.8% to Critical Strike Chance" -> BaseCritChance,
   * "+20% to Critical Damage Bonus" -> CritDamageBonusFlat).
   */
  baseNames?: readonly string[];
  /** Optional forced ModType override. */
  forceType?: ModType;
  /** Optional actor scope override (e.g. "minion damage"). */
  actorScope?: ActorScope;
}

export function toPascalCase(raw: string): string {
  return raw
    .trim()
    .replace(/['’]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

export function capFirst(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function normalizeSlotScope(raw: string): SlotScope {
  const lower = raw.trim().toLowerCase();
  if (lower.includes('body')) return 'BodyArmour';
  if (lower.includes('shield')) return 'Shield';
  if (lower.includes('helmet')) return 'Helmet';
  if (lower.includes('focus')) return 'Focus';
  if (lower.includes('boot')) return 'Boots';
  return 'Gloves';
}

function mapEquipDefenceStat(slot: SlotScope, rawStat: string): string {
  const lower = rawStat.trim().toLowerCase();
  if (lower.includes('energy shield')) return `${slot}ES`;
  if (lower.includes('evasion')) return `${slot}Evasion`;
  return `${slot}Armour`;
}

function mapElementKeyword(el: string): number {
  switch (el.trim().toLowerCase()) {
    case 'fire':
      return KeywordFlag.Fire;
    case 'cold':
      return KeywordFlag.Cold;
    case 'lightning':
      return KeywordFlag.Lightning;
    case 'chaos':
      return KeywordFlag.Chaos;
    case 'physical':
      return KeywordFlag.Physical;
    default:
      return 0;
  }
}

function mapWeaponConditionVar(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (lower.includes('two') && lower.includes('handed')) return 'UsingTwoHandedWeapon';
  if (lower.includes('one') && lower.includes('handed')) return 'UsingOneHandedWeapon';
  if (lower.includes('quarterstaff')) return 'UsingQuarterstaff';
  if (lower.includes('crossbow')) return 'UsingCrossbow';
  if (lower.includes('bow')) return 'UsingBow';
  if (lower.includes('wand')) return 'UsingWand';
  if (lower.includes('claw')) return 'UsingClaw';
  if (lower.includes('dagger')) return 'UsingDagger';
  if (lower.includes('sword')) return 'UsingSword';
  if (lower.includes('axe')) return 'UsingAxe';
  if (lower.includes('mace') || lower.includes('sceptre') || lower.includes('flail')) return 'UsingMace';
  if (lower.includes('staff')) return 'UsingStaff';
  if (lower.includes('spear')) return 'UsingSpear';
  if (lower.includes('shield')) return 'UsingShield';
  if (lower.includes('melee')) return 'UsingMeleeWeapon';
  return `Using${toPascalCase(raw)}`;
}

// ============================================================================
// Stage 1A: Prefix Scope / Watcher's Eye / Condition / Actor Peeler
// ============================================================================

const ENEMY_STATUS_PATTERN =
  '(Hindered|Maimed|Intimidated|Unnerved|Taunted|Blinded|Chilled|Frozen|Shocked|Ignited|Burning|Bleeding|Poisoned|Withered|Cursed|Marked|Stunned|Pinned|Dazed|Crushed|Electrocuted|Immobilised)';

export const STAGE1_PREFIX_RULES: readonly Stage1Rule[] = [
  // Watcher's Eye & Aura-affected prefix ("While affected by Hatred, ...")
  {
    regex: /^While affected by (?:a )?Herald,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'AffectedByHerald' }] }),
  },
  {
    regex: /^While affected by no Flasks?,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'UsingFlask', neg: true }] }),
  },
  {
    regex: /^While affected by (?:a )?Flasks?,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'UsingFlask' }] }),
  },
  {
    regex: /^While affected by a (?:Non-Vaal )?Guard Skill(?: Buff)?,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'AffectedByGuardSkill' }] }),
  },
  {
    regex: /^While affected by ([A-Za-z][A-Za-z ']*?),\s*/i,
    apply: (m) => ({
      tags: [{ type: 'Condition', var: `AffectedBy${toPascalCase(m[1]!)}` }],
    }),
  },

  // Leading comma-delimited status / wielding / presence conditions
  {
    regex: /^(?:While|When) not on Low Life,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'LowLife', neg: true }] }),
  },
  {
    regex: /^(?:While|When) not on Full Life,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'FullLife', neg: true }] }),
  },
  {
    regex: /^(?:While|When) not on Full Energy Shield,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'FullEnergyShield', neg: true }] }),
  },
  {
    regex: /^(?:While|When) on Low Life,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'LowLife' }] }),
  },
  {
    regex: /^(?:While|When) on Full Life,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'FullLife' }] }),
  },
  {
    regex: /^(?:While|When) on Full Energy Shield,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'FullEnergyShield' }] }),
  },
  {
    regex: /^(?:While|When) you have no Energy Shield,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'HaveEnergyShield', neg: true }] }),
  },
  {
    regex: /^(?:While|When) you have Energy Shield,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'HaveEnergyShield' }] }),
  },
  {
    regex: /^While not Dual Wielding,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'DualWielding', neg: true }] }),
  },
  {
    regex: /^While Dual Wielding,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'DualWielding' }] }),
  },
  {
    regex: /^While holding a Shield,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'UsingShield' }] }),
  },
  {
    regex: /^While wielding a (Two[\s-]Handed (?:Melee )?Weapon|One[\s-]Handed (?:Melee )?Weapon|Quarterstaff|Crossbow|Staff|Bow|Wand|Claw|Dagger|Sword|Axe|Mace|Spear),\s*/i,
    apply: (m) => ({ tags: [{ type: 'Condition', var: mapWeaponConditionVar(m[1]!) }] }),
  },
  {
    regex: /^While (?:you are )?Sprinting,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'Sprinting' }] }),
  },
  {
    regex: /^While (Leeching|Channelling|Stationary|Moving|Focused|Focussed|Shapeshifted|Fortified|Phasing|Elusive),\s*/i,
    apply: (m) => {
      const k = m[1]!.toLowerCase();
      return { tags: [{ type: 'Condition', var: k === 'focussed' ? 'Focused' : capFirst(k) }] };
    },
  },
  {
    regex: /^(?:While )?on Consecrated Ground,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'OnConsecratedGround' }] }),
  },
  {
    regex: /^While (?:you are )?affected by Herald of (Thunder|Ice|Ash|Plague),\s*/i,
    apply: (m) => ({ tags: [{ type: 'Condition', var: `AffectedByHeraldOf${capFirst(m[1]!)}` }] }),
  },
  {
    regex: /^While a Pinnacle (?:Atlas )?Boss is in your Presence,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'EnemyPinnacleBoss' }] }),
  },
  {
    regex: /^While a (?:Rare or )?Unique Enemy is in your Presence,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'EnemyRareOrUnique' }] }),
  },
  {
    regex: /^During (?:any )?(?:Flask )?Effect,\s*/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'UsingFlask' }] }),
  },
  {
    regex: /^For each nearby Corpse,\s*/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'NearbyCorpse' }] }),
  },
  {
    regex: /^If you(?:'ve| have) (Crit|dealt a Critical (?:Strike|Hit)|Killed(?: an Enemy)?|Hit(?: an Enemy)?|been Hit|Blocked|Attacked|Cast a Spell|Consumed a Corpse|Used a Warcry|Warcried) Recently,\s*/i,
    apply: (m) => {
      const raw = m[1]!.toLowerCase();
      const v = raw.includes('crit')
        ? 'CritRecently'
        : raw.includes('kill')
          ? 'KilledRecently'
          : raw.includes('been hit')
            ? 'BeenHitRecently'
            : raw.includes('hit')
              ? 'HitRecently'
              : raw.includes('block')
                ? 'BlockedRecently'
                : raw.includes('attack')
                  ? 'AttackedRecently'
                  : raw.includes('spell')
                    ? 'CastSpellRecently'
                    : raw.includes('corpse')
                      ? 'ConsumedCorpseRecently'
                      : 'UsedWarcryRecently';
      return { tags: [{ type: 'Condition', var: v }] };
    },
  },

  // Ring / Socketed prefixes
  {
    regex: /^Left Ring Slot:\s*/i,
    apply: () => ({ tags: [{ type: 'SocketedIn', slotName: 'Ring 1' }] }),
  },
  {
    regex: /^Right Ring Slot:\s*/i,
    apply: () => ({ tags: [{ type: 'SocketedIn', slotName: 'Ring 2' }] }),
  },
  {
    regex: /^Socketed (?:(Attack|Spell|Melee|Minion|Aura|Curse|Golem|Travel|Warcry|Vaal|Fire|Cold|Lightning|Chaos|Physical) )?(?:Gems|Skills) (?:have |deal |gain )/i,
    apply: (m) => {
      const scope = (m[1] ?? '').toLowerCase();
      let flags = 0;
      let keywordFlags = 0;
      const tags: ModTag[] = [{ type: 'SocketedIn' }];
      if (scope === 'attack') flags = ModFlag.Attack;
      else if (scope === 'spell') flags = ModFlag.Spell;
      else if (scope === 'melee') flags = ModFlag.Melee;
      else if (scope === 'minion' || scope === 'golem') keywordFlags = KeywordFlag.Minion;
      else if (scope === 'aura') keywordFlags = KeywordFlag.Aura;
      else if (scope === 'curse') keywordFlags = KeywordFlag.Curse;
      else if (scope === 'warcry') keywordFlags = KeywordFlag.Warcry;
      else if (scope) keywordFlags = mapElementKeyword(scope);
      return { flags, keywordFlags, tags };
    },
  },

  // Rage-scaling prefix
  {
    regex: /^(?:Every|Each) (\d+) Rage also grants /i,
    apply: (m) => ({ tags: [{ type: 'PerStat', stat: 'Rage', div: Number(m[1]) }] }),
  },
  {
    regex: /^(?:Every|Each) Rage also grants /i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'Rage' }] }),
  },

  // Enemy debuff & damage-taken actor scopes (specific before generic)
  {
    regex: new RegExp(`^(?:Nearby )?Enemies ${ENEMY_STATUS_PATTERN} by you take `, 'i'),
    apply: (m) => ({
      actorScope: 'enemy',
      modSuffix: 'Taken',
      tags: [{ type: 'Condition', var: `Enemy${capFirst(m[1]!)}` }],
    }),
  },
  {
    regex: new RegExp(`^(?:Nearby )?Enemies ${ENEMY_STATUS_PATTERN} by you have `, 'i'),
    apply: (m) => ({
      actorScope: 'enemy',
      tags: [{ type: 'Condition', var: `Enemy${capFirst(m[1]!)}` }],
    }),
  },
  {
    regex: new RegExp(`^(?:Nearby )?Enemies ${ENEMY_STATUS_PATTERN} by you deal `, 'i'),
    apply: (m) => ({
      actorScope: 'enemy',
      modSuffix: 'Dealt',
      tags: [{ type: 'Condition', var: `Enemy${capFirst(m[1]!)}` }],
    }),
  },
  {
    regex: /^(?:Nearby )?Enemies (?:you Curse|Cursed by you) take /i,
    apply: () => ({
      actorScope: 'enemy',
      modSuffix: 'Taken',
      tags: [{ type: 'Condition', var: 'EnemyCursed' }],
    }),
  },
  {
    regex: /^(?:Nearby )?Enemies (?:you Curse|Cursed by you) have /i,
    apply: () => ({
      actorScope: 'enemy',
      tags: [{ type: 'Condition', var: 'EnemyCursed' }],
    }),
  },
  {
    regex: /^(?:Nearby )?Enemies (?:you Curse|Cursed by you) deal /i,
    apply: () => ({
      actorScope: 'enemy',
      modSuffix: 'Dealt',
      tags: [{ type: 'Condition', var: 'EnemyCursed' }],
    }),
  },
  {
    regex: /^Cursed Enemies take /i,
    apply: () => ({
      actorScope: 'enemy',
      modSuffix: 'Taken',
      tags: [{ type: 'Condition', var: 'EnemyCursed' }],
    }),
  },
  {
    regex: /^Cursed Enemies have /i,
    apply: () => ({
      actorScope: 'enemy',
      tags: [{ type: 'Condition', var: 'EnemyCursed' }],
    }),
  },
  {
    regex: /^(?:Marked Enem(?:y|ies)|Enemies you Mark) (?:take|takes) /i,
    apply: () => ({
      actorScope: 'enemy',
      modSuffix: 'Taken',
      tags: [{ type: 'Condition', var: 'EnemyMarked' }],
    }),
  },
  {
    regex: /^(?:Marked Enem(?:y|ies)|Enemies you Mark) (?:have|has) /i,
    apply: () => ({
      actorScope: 'enemy',
      tags: [{ type: 'Condition', var: 'EnemyMarked' }],
    }),
  },
  {
    regex: /^(?:Marked Enem(?:y|ies)|Enemies you Mark) (?:deal|deals) /i,
    apply: () => ({
      actorScope: 'enemy',
      modSuffix: 'Dealt',
      tags: [{ type: 'Condition', var: 'EnemyMarked' }],
    }),
  },
  {
    regex: /^(?:Nearby )?Enemies (?:in your Presence )?take /i,
    apply: () => ({ actorScope: 'enemy', modSuffix: 'Taken' }),
  },
  {
    regex: /^(?:Nearby )?Enemies (?:in your Presence )?have /i,
    apply: () => ({ actorScope: 'enemy' }),
  },
  {
    regex: /^(?:Nearby )?Enemies (?:in your Presence )?deal /i,
    apply: () => ({ actorScope: 'enemy', modSuffix: 'Dealt' }),
  },
  {
    regex: new RegExp(`^Hits against ${ENEMY_STATUS_PATTERN} Enemies have `, 'i'),
    apply: (m) => ({
      flags: ModFlag.Hit,
      tags: [{ type: 'Condition', var: `Enemy${capFirst(m[1]!)}` }],
    }),
  },

  // Minion & Companion actor scopes
  {
    regex: /^Minions created Recently (?:have |deal |gain )/i,
    apply: () => ({
      actorScope: 'minion',
      keywordFlags: KeywordFlag.Minion,
      tags: [{ type: 'Condition', var: 'MinionsCreatedRecently' }],
    }),
  },
  {
    regex: /^Minions(?:' Attacks|' Hits) (?:have |deal |gain )/i,
    apply: () => ({
      actorScope: 'minion',
      flags: ModFlag.Attack,
      keywordFlags: KeywordFlag.Minion,
    }),
  },
  {
    regex: /^Minions (?:have |deal |gain |leech )?/i,
    apply: () => ({
      actorScope: 'minion',
      keywordFlags: KeywordFlag.Minion,
    }),
  },
  {
    regex: /^(?:Summoned |Raised |Undead )?(?:Golems|Zombies|Skeletons|Raging Spirits|Spectres|Holy Relics|Animated Weapons|Animated Guardians?|Minions) (?:have |deal |gain )/i,
    apply: () => ({
      actorScope: 'minion',
      keywordFlags: KeywordFlag.Minion,
    }),
  },
  {
    regex: /^Companions (?:have |deal |gain )?/i,
    apply: () => ({
      actorScope: 'companion',
      keywordFlags: KeywordFlag.Minion,
    }),
  },

  // Ally / Totem / Subject-Hinted Prefixes
  {
    regex: /^You and (?:Nearby )?Allies(?: in your Presence)? (?:have |deal |gain )?/i,
    apply: () => ({}),
  },
  {
    regex: /^You and your Minions (?:have |deal |gain )?/i,
    apply: () => ({}),
  },
  {
    regex: /^You and your Totems /i,
    apply: () => ({}),
  },
  {
    regex: /^(?:Nearby )?Allies(?: in your Presence)? (?:have |deal |gain )?/i,
    apply: () => ({ actorScope: 'ally' }),
  },
  {
    regex: /^Totems (?:have |gain |deal )/i,
    apply: () => ({ actorScope: 'totem', keywordFlags: KeywordFlag.Totem }),
  },
  {
    regex: /^Totems /i,
    apply: () => ({ actorScope: 'totem', keywordFlags: KeywordFlag.Totem }),
  },
  {
    regex: /^Flasks applied to you have /i,
    apply: () => ({ subjectHint: 'flask' }),
  },
  {
    regex: /^Charms applied to you have /i,
    apply: () => ({ subjectHint: 'charm' }),
  },
  {
    regex: /^Tinctures applied to you have /i,
    apply: () => ({ subjectHint: 'tincture' }),
  },
  {
    regex: /^Auras from your Skills (?:have |grant )/i,
    apply: () => ({ subjectHint: 'aura', keywordFlags: KeywordFlag.Aura }),
  },
  {
    regex: /^Your Curses have /i,
    apply: () => ({ subjectHint: 'curse', keywordFlags: KeywordFlag.Curse }),
  },
  {
    regex: /^Your Marks have /i,
    apply: () => ({ subjectHint: 'mark' }),
  },
  {
    regex: /^Offerings have /i,
    apply: () => ({ subjectHint: 'offering' }),
  },
  {
    regex: /^Mines have /i,
    apply: () => ({ subjectHint: 'mine', keywordFlags: KeywordFlag.Mine }),
  },
  {
    regex: /^Traps have /i,
    apply: () => ({ subjectHint: 'trap', keywordFlags: KeywordFlag.Trap }),
  },
  {
    regex: /^Parry has /i,
    apply: () => ({ subjectHint: 'parry' }),
  },
  {
    regex: /^Debuffs you inflict have /i,
    apply: () => ({ subjectHint: 'debuff' }),
  },
  {
    regex: /^Hits against you (?:have |deal )?/i,
    apply: () => ({ actorScope: 'enemy', flags: ModFlag.Hit }),
  },
  {
    regex: /^Meta Skills (?:gain |have |deal )/i,
    apply: () => ({ tags: [{ type: 'SkillType', skillType: 'Meta' }] }),
  },
  {
    regex: /^Brand Recall (?:has |grants )/i,
    apply: () => ({ tags: [{ type: 'SkillType', skillType: 'BrandRecall' }] }),
  },
  {
    regex: /^Spells which can gain Intensity have /i,
    apply: () => ({ flags: ModFlag.Spell }),
  },
  {
    regex: /^Skills supported by Unleash have /i,
    apply: () => ({ flags: ModFlag.Spell }),
  },
  {
    regex: /^Final Repeat of Spells has /i,
    apply: () => ({ flags: ModFlag.Spell }),
  },
  {
    regex: /^Offering Skills (?:have |deal |gain )/i,
    apply: () => ({ subjectHint: 'offering' }),
  },
  {
    regex: /^Stuns from Critical (?:Strikes|Hits) have /i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'CriticalStrike' }] }),
  },

  // Generic player verb prefixes
  {
    regex: /^Has (?=[+-]\d)/i,
    apply: () => ({}),
  },
  {
    regex: /^Prevent (?=\+?\d)/i,
    apply: () => ({}),
  },
  {
    regex: /^Items and Gems have /i,
    apply: () => ({}),
  },
  {
    regex: /^Skills used by this Graft have /i,
    apply: () => ({ tags: [{ type: 'SkillType', skillType: 'Graft' }] }),
  },
  {
    regex: /^(?:You )?[Tt]ake /i,
    apply: () => ({ modSuffix: 'Taken' }),
  },
  {
    regex: /^Hits (?:have |deal )/i,
    apply: () => ({ flags: ModFlag.Hit }),
  },
  {
    regex: /^Critical (?:Strikes|Hits) (?:have |deal )/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'CriticalStrike' }] }),
  },
  {
    regex: /^(?:You (?:have |deal |gain )|Deal |Causes |Your Flasks grant )/i,
    apply: () => ({}),
  },
];

// ============================================================================
// Stage 1B: Trailing Suffix Peeler (Actor / PerStat / Multiplier / Condition)
// ============================================================================

export const STAGE1_SUFFIX_RULES: readonly Stage1Rule[] = [
  // Trailing actor scope
  {
    regex: /\s+for Minions$/i,
    apply: () => ({ actorScope: 'minion', keywordFlags: KeywordFlag.Minion }),
  },

  // --- PerStat: Equipped item defences (most specific first) ---
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(\d+)\s+(?:Item\s+)?(maximum Energy Shield|Energy Shield|Evasion Rating|Evasion|Armour)\s+on\s+(?:your\s+)?(?:Equipped\s+)?(Body Armour|Helmet|Shield|Gloves|Boots|Focus)$/i,
    apply: (m) => {
      const slot = normalizeSlotScope(m[3]!);
      return {
        tags: [{ type: 'PerStat', stat: mapEquipDefenceStat(slot, m[2]!), div: Number(m[1]) }],
      };
    },
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(\d+)%?\s+Chance\s+to\s+Block\s+on\s+(?:your\s+)?(?:Equipped\s+)?Shield$/i,
    apply: (m) => ({
      tags: [{ type: 'PerStat', stat: 'ShieldBlock', div: Number(m[1]) }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(\d+)%?\s+Chance\s+to\s+Block\s+Spell\s+Damage$/i,
    apply: (m) => ({
      tags: [{ type: 'PerStat', stat: 'SpellBlockChance', div: Number(m[1]) }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(\d+)%?\s+Chance\s+to\s+Block(?:\s+Attack\s+Damage|\s+Attacks)?$/i,
    apply: (m) => ({
      tags: [{ type: 'PerStat', stat: 'BlockChance', div: Number(m[1]) }],
    }),
  },

  // --- PerStat: Core character stats ---
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(?:(\d+)\s+)?Strength(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'PerStat',
          stat: 'Str',
          div: Number(m[1] ?? 1),
          ...(m[2] ? { limit: Number(m[2]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(?:(\d+)\s+)?Dexterity(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'PerStat',
          stat: 'Dex',
          div: Number(m[1] ?? 1),
          ...(m[2] ? { limit: Number(m[2]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(?:(\d+)\s+)?Intelligence(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'PerStat',
          stat: 'Int',
          div: Number(m[1] ?? 1),
          ...(m[2] ? { limit: Number(m[2]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(?:(\d+)\s+)?(?:of your )?Lowest Attribute$/i,
    apply: (m) => ({
      tags: [{ type: 'PerStat', stat: 'LowestAttr', div: Number(m[1] ?? 1) }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(?:(\d+)\s+)?(?:point of )?Strength or Intelligence,\s*whichever is lower$/i,
    apply: (m) => ({
      tags: [{ type: 'PerStat', stat: 'LowestStrInt', div: Number(m[1] ?? 1) }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(?:(\d+)\s+)?Total Attributes$/i,
    apply: (m) => ({
      tags: [{ type: 'PerStat', stat: 'TotalAttributes', div: Number(m[1] ?? 1) }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(?:(\d+)\s+)?Accuracy Rating$/i,
    apply: (m) => ({
      tags: [{ type: 'PerStat', stat: 'Accuracy', div: Number(m[1] ?? 1) }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(?:(\d+)\s+)?Armour(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'PerStat',
          stat: 'Armour',
          div: Number(m[1] ?? 1),
          ...(m[2] ? { limit: Number(m[2]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(?:(\d+)\s+)?Evasion(?: Rating)?(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'PerStat',
          stat: 'Evasion',
          div: Number(m[1] ?? 1),
          ...(m[2] ? { limit: Number(m[2]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(?:(\d+)\s+)?(?:Maximum\s+)?Energy Shield(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'PerStat',
          stat: 'EnergyShield',
          div: Number(m[1] ?? 1),
          ...(m[2] ? { limit: Number(m[2]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(?:(\d+)\s+)?(?:Player\s+)?(?:Maximum\s+)?Life(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'PerStat',
          stat: 'Life',
          div: Number(m[1] ?? 1),
          ...(m[2] ? { limit: Number(m[2]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(?:(\d+)\s+)?Unreserved\s+(?:Maximum\s+)?Mana(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'PerStat',
          stat: 'ManaUnreserved',
          div: Number(m[1] ?? 1),
          ...(m[2] ? { limit: Number(m[2]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(?:(\d+)\s+)?(?:Maximum\s+)?Mana(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'PerStat',
          stat: 'Mana',
          div: Number(m[1] ?? 1),
          ...(m[2] ? { limit: Number(m[2]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(\d+)%\s+of\s+(?:maximum\s+)?(Mana|Life)\s+(?:they\s+)?Reserve[ds]?$/i,
    apply: (m) => ({
      tags: [{ type: 'PerStat', stat: `${capFirst(m[2]!)}ReservedPercent`, div: Number(m[1]) }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(?:(\d+)%\s+)?Uncapped\s+(Fire|Cold|Lightning|Chaos)\s+Resistance$/i,
    apply: (m) => ({
      tags: [{ type: 'PerStat', stat: `Uncapped${capFirst(m[2]!)}Resist`, div: Number(m[1] ?? 1) }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(\d+)\s+(?:total\s+)?Mana\s+(?:you have\s+)?spent\s+Recently(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'PerStat',
          stat: 'ManaSpentRecently',
          div: Number(m[1]),
          ...(m[2] ? { limit: Number(m[2]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(\d+)\s+Rage$/i,
    apply: (m) => ({
      tags: [{ type: 'PerStat', stat: 'Rage', div: Number(m[1]) }],
    }),
  },

  // --- Multipliers ---
  {
    regex: /(?:\s*,\s*|\s+)per\s+(Power|Frenzy|Endurance)\s+Charge\s+consumed\s+Recently$/i,
    apply: (m) => ({
      tags: [{ type: 'Multiplier', var: `${capFirst(m[1]!)}ChargeConsumedRecently` }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)per\s+Maximum\s+(Power|Frenzy|Endurance)\s+Charge$/i,
    apply: (m) => ({
      tags: [{ type: 'Multiplier', var: `${capFirst(m[1]!)}ChargeMax` }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)per\s+Endurance,\s+Frenzy\s+or\s+Power\s+Charge$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'TotalCharges' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)per\s+(Power|Frenzy|Endurance)\s+Charge$/i,
    apply: (m) => ({
      tags: [{ type: 'Multiplier', var: `${capFirst(m[1]!)}Charge` }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)per\s+Rage(?:\s+while you are not losing Rage)?$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'Rage' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+(?:Equipped\s+)?Corrupted\s+Item(?:\s+Equipped)?$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'CorruptedItem' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+(?:Equipped\s+)?(Normal|Magic|Rare|Unique|Shaper|Elder)\s+Item(?:\s+Equipped|\s+you have Equipped)?$/i,
    apply: (m) => ({ tags: [{ type: 'Multiplier', var: `${capFirst(m[1]!)}Item` }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+different type of Mastery you have Allocated$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'AllocatedMasteryType' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Allocated\s+Mastery(?:\s+Passive Skill)?$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'AllocatedMastery' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Allocated\s+Notable(?:\s+Passive Skill)?$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'AllocatedNotable' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Socket\s+filled$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'SocketFilled' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+(?:Active|Summoned)\s+Golem$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'ActiveGolem' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+(?:Summoned\s+)?Totem$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'SummonedTotem' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Fortification$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'Fortification' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+(?:of your )?Aura or Herald Skills? affecting you$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'AuraOrHeraldAffectingSelf' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Herald(?:\s+Buff|\s+Skill)?\s+affecting you$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'Herald' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+different Non-Instant Spell you(?:'ve| have) Cast Recently$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'NonInstantSpellCastRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+(?:Nearby\s+)?Enemy(?:\s+in Close Range|\s+in your Presence)?(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'Multiplier',
          var: 'NearbyEnemies',
          ...(m[1] ? { limit: Number(m[1]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+(?:of your )?Brands?(?:\s+Attached to them)?(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'Multiplier',
          var: 'ActiveBrand',
          ...(m[1] ? { limit: Number(m[1]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Curse on (?:the )?Enemy$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'CurseOnEnemy' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Minion(?:\s+from\s+your\s+Non-Vaal\s+Skills)?(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'Multiplier',
          var: 'SummonedMinion',
          ...(m[1] ? { limit: Number(m[1]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Tailwind$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'Tailwind' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Combo\s+consumed(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'Multiplier',
          var: 'ComboConsumed',
          ...(m[1] ? { limit: Number(m[1]), limitTotal: true } : {}),
        } as unknown as ModTag,
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)for\s+each\s+time\s+you(?:'ve|\s+have)\s+Warcried\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'WarcriesUsedRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)for\s+each\s+different\s+Warcry\s+you(?:'ve|\s+have)\s+used\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'DifferentWarcriesUsedRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)for\s+each\s+time\s+you(?:'ve|\s+have)\s+been\s+Hit\s+by\s+an\s+Enemy\s+Recently(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'Multiplier',
          var: 'HitByEnemyRecently',
          ...(m[1] ? { limit: Number(m[1]), limitTotal: true } : {}),
        } as unknown as ModTag,
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for every|for each|per)\s+(\d+)\s+(?:player\s+)?Levels?$/i,
    apply: (m) => ({ tags: [{ type: 'PerStat', stat: 'Level', div: Number(m[1]) }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+(?:player\s+)?Level$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'Level' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Blue Support Gem$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'BlueSupportGem' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+(Red|Green|Blue|White)\s+Socket(?:\s+on .+)?$/i,
    apply: (m) => ({ tags: [{ type: 'Multiplier', var: `${capFirst(m[1]!)}Socket` }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+(?:of your )?Mines?\s+Detonated Recently(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'Multiplier',
          var: 'MineDetonatedRecently',
          ...(m[1] ? { limit: Number(m[1]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+(?:of your )?Traps?\s+Triggered Recently(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'Multiplier',
          var: 'TrapTriggeredRecently',
          ...(m[1] ? { limit: Number(m[1]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Enemy (?:you(?:'ve| have) )?Killed Recently(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'Multiplier',
          var: 'EnemyKilledRecently',
          ...(m[1] ? { limit: Number(m[1]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Poison(?:\s+on (?:you|Enemy)|\s+you have inflicted Recently)(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'Multiplier',
          var: 'PoisonStack',
          ...(m[1] ? { limit: Number(m[1]) } : {}),
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Abyss(?:al)? Jewel affecting you$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'AbyssJewel' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+(Ghastly|Murderous|Hypnotic|Searching)\s+Eye Jewel affecting you(?:,\s*up to (?:a maximum of )?\+?(\d+)%?)?$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'Multiplier',
          var: `${capFirst(m[1]!)}EyeJewel`,
          ...(m[2] ? { limit: Number(m[2]), limitTotal: true } : {}),
        } as unknown as ModTag,
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)for each (?:type of )?Elemental Ailment(?: type)? (?:on Enemy|among your Ailments on them)$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'EnemyElementalAilmentCount' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Impale on Enemy$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'EnemyImpaleStacks' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Socketed Rune(?:\s+or Soul Core)?$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'SocketedRune' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:for each|per)\s+Buff on you$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'BuffOnSelf' }] }),
  },

  // --- Conditions: Negated FIRST, then positive ---
  {
    regex: /(?:\s*,\s*|\s+)(?:while|when)\s+not\s+on\s+Low\s+Life$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'LowLife', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:while|when)\s+not\s+on\s+Full\s+Life$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'FullLife', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:while|when)\s+not\s+on\s+Low\s+Energy\s+Shield$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'LowEnergyShield', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:while|when)\s+not\s+on\s+Full\s+Energy\s+Shield$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'FullEnergyShield', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:while|when|if)\s+you\s+have\s+no\s+Energy\s+Shield$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'HaveEnergyShield', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:while|when)\s+not\s+Dual\s+Wielding$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'DualWielding', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:while|when)\s+on\s+Low\s+Life$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'LowLife' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:while|when)\s+on\s+Full\s+Life$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'FullLife' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:while|when)\s+on\s+Low\s+Energy\s+Shield$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'LowEnergyShield' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:while|when)\s+on\s+Full\s+Energy\s+Shield$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'FullEnergyShield' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:while|when)\s+on\s+Low\s+Mana$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'LowMana' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:while|when|if)\s+you\s+have\s+Energy\s+Shield$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'HaveEnergyShield' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you\s+have\s+Reserved\s+Life\s+and\s+Mana$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'ReservedLifeAndMana' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+there\s+are\s+no\s+([A-Za-z ]+?)\s+Modifiers\s+on\s+Equipped\s+([A-Za-z ]+)$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'Condition',
          var: `No${toPascalCase(m[1]!)}ModOn${toPascalCase(m[2]!)}`,
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you\s+have\s+at\s+least\s+(\d+)\s+(Strength|Dexterity|Intelligence)$/i,
    apply: (m) => {
      const attr = m[2]!.toLowerCase();
      const stat = attr === 'strength' ? 'Str' : attr === 'dexterity' ? 'Dex' : 'Int';
      return { tags: [{ type: 'Condition', var: `StatThreshold:${stat}:${m[1]}` }] };
    },
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you\s+have\s+at\s+least\s+(\d+)\s+([A-Za-z ]+?)\s+Master(?:y|ies)\s+allocated$/i,
    apply: (m) => ({
      tags: [{ type: 'Condition', var: `AtLeast${m[1]}${toPascalCase(m[2]!)}Masteries` }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+Dual\s+Wielding(?:\s+or\s+holding\s+a\s+Shield)?$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'DualWielding' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+holding\s+a\s+Shield$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'UsingShield' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)with\s+Shields$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'UsingShield' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+wielding\s+(?:a|an)\s+(Two[\s-]Handed (?:Melee )?Weapon|One[\s-]Handed (?:Melee )?Weapon|Quarterstaff|Crossbow|Staff|Bow|Wand|Claw|Dagger|Sword|Axe|Mace or Sceptre|Mace|Spear|Flail|Melee Weapon)$/i,
    apply: (m) => ({ tags: [{ type: 'Condition', var: mapWeaponConditionVar(m[1]!) }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+(?:your\s+)?Off\s+Hand\s+is\s+empty$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'OffHandIsEmpty' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+Unarmed$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'Unarmed' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+you\s+have\s+Unbroken\s+Ward$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'HaveUnbrokenWard' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+at\s+(Maximum|Minimum)\s+(Power|Frenzy|Endurance)\s+Charges$/i,
    apply: (m) => ({
      tags: [
        {
          type: 'Condition',
          var: `At${m[1]!.toLowerCase() === 'maximum' ? 'Max' : 'Min'}${capFirst(m[2]!)}Charges`,
        },
      ],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you\s+have\s+(?:an\s+)?Equipped\s+(Helmet|Body Armour|Gloves|Boots)\s+with\s+no\s+Socketed\s+Gems$/i,
    apply: (m) => ({
      tags: [{ type: 'Condition', var: `NoSocketedGemsIn${toPascalCase(m[1]!)}` }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+Leeching(?:\s+(Life|Mana|Energy Shield))?$/i,
    apply: (m) => ({
      tags: [{ type: 'Condition', var: m[1] ? `Leeching${toPascalCase(m[1])}` : 'Leeching' }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+(Channelling|Stationary|Moving|Sprinting|Focused|Focussed|Shapeshifted|Fortified|Phasing|Elusive|Unbound)$/i,
    apply: (m) => {
      const k = m[1]!.toLowerCase();
      return { tags: [{ type: 'Condition', var: k === 'focussed' ? 'Focused' : capFirst(k) }] };
    },
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+you\s+are\s+(Stationary|Moving|Fortified|Phasing|Elusive|Ignited|Chilled|Shocked|Bleeding|Poisoned|Cursed)$/i,
    apply: (m) => ({ tags: [{ type: 'Condition', var: capFirst(m[1]!) }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:while\s+)?on\s+Consecrated\s+Ground$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'OnConsecratedGround' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+(?:you\s+are\s+)?affected\s+by\s+a\s+Herald$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'AffectedByHerald' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+affected\s+by\s+no\s+Flasks?$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'UsingFlask', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+under\s+no\s+Flask\s+Effects$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'UsingFlask', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:during\s+(?:any\s+)?(?:Flask\s+)?Effect|while\s+using\s+a\s+Flask|while\s+affected\s+by\s+(?:a\s+)?Flasks?)$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'UsingFlask' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+(?:you\s+are\s+)?affected\s+by\s+Herald\s+of\s+(Thunder|Ice|Ash|Plague)$/i,
    apply: (m) => ({ tags: [{ type: 'Condition', var: `AffectedByHeraldOf${capFirst(m[1]!)}` }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+(?:you\s+are\s+)?affected\s+by\s+([A-Za-z][A-Za-z ']*?)$/i,
    apply: (m) => ({ tags: [{ type: 'Condition', var: `AffectedBy${toPascalCase(m[1]!)}` }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+using\s+([A-Za-z][A-Za-z ']*?)$/i,
    apply: (m) => ({ tags: [{ type: 'Condition', var: `AffectedBy${toPascalCase(m[1]!)}` }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:during|while\s+you\s+have)\s+(Onslaught|Tailwind|Fortify|Phasing|Elusive|Arcane Surge)$/i,
    apply: (m) => {
      const k = m[1]!.toLowerCase();
      const v =
        k === 'fortify'
          ? 'Fortified'
          : k === 'arcane surge'
            ? 'AffectedByArcaneSurge'
            : capFirst(k);
      return { tags: [{ type: 'Condition', var: v }] };
    },
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+at\s+(?:Maximum|Full)\s+(Power|Frenzy|Endurance)\s+Charges$/i,
    apply: (m) => ({ tags: [{ type: 'Condition', var: `AtMax${capFirst(m[1]!)}Charges` }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+at\s+Maximum\s+Rage$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'HaveMaximumRage' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+at\s+Maximum\s+Fortification$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'HaveMaximumFortification' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+in\s+(Blood|Sand)\s+Stance$/i,
    apply: (m) => ({ tags: [{ type: 'Condition', var: `${capFirst(m[1]!)}Stance` }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)not\s+at\s+Close\s+Range$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'AtCloseRange', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)at\s+Close\s+Range$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'AtCloseRange' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)(?:with|on)\s+Critical\s+(?:Strikes|Hits)$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'CriticalStrike' }] }),
  },

  // Recent / combat event conditions
  {
    regex: /(?:\s*,\s*|\s+)if\s+you\s+haven't\s+(?:dealt\s+a\s+Critical\s+(?:Strike|Hit)|Crit)\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'CritRecently', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+(?:dealt\s+a\s+Critical\s+(?:Strike|Hit)|Crit)\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'CritRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you\s+haven't\s+Killed\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'KilledRecently', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+Killed(?:\s+an\s+Enemy)?\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'KilledRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you\s+haven't\s+been\s+Hit\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'BeenHitRecently', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+been\s+Hit\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'BeenHitRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+Hit(?:\s+an\s+Enemy)?\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'HitRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+Blocked(?:\s+an\s+Attack|\s+a\s+Spell)?\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'BlockedRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+Attacked\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'AttackedRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+Cast\s+a\s+Spell\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'CastSpellRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+Consumed\s+a\s+[Cc]orpse\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'ConsumedCorpseRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+Spent\s+Life\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'SpentLifeRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+Suppressed\s+Spell\s+Damage\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'SuppressedRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+Used\s+a\s+(Warcry|Movement Skill|Travel Skill|Minion Skill|Retaliation Skill|Fire Skill|Cold Skill|Lightning Skill|Chaos Skill|Vaal Skill|Skill)\s+Recently$/i,
    apply: (m) => ({
      tags: [{ type: 'Condition', var: `Used${toPascalCase(m[1]!)}Recently` }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+consumed\s+a\s+(Power|Frenzy|Endurance)\s+Charge\s+Recently$/i,
    apply: (m) => ({
      tags: [{ type: 'Condition', var: `Consumed${capFirst(m[1]!)}ChargeRecently` }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+you\s+have\s+a\s+Totem$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'HaveTotem' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+(Frozen|Chilled|Ignited|Shocked|Stunned|Impaled|Cursed|Taunted)\s+an\s+Enemy\s+Recently$/i,
    apply: (m) => ({
      tags: [{ type: 'Condition', var: `${capFirst(m[1]!)}EnemyRecently` }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you\s+haven't\s+Summoned\s+a\s+Totem\s+in\s+the\s+past\s+\d+\s+seconds$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'NoSummonedTotemsRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+Energy\s+Shield\s+Recharge\s+has\s+started\s+in\s+the\s+past\s+\d+\s+seconds$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'EnergyShieldRechargeStartedRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+Dodge\s+Rolled\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'DodgeRolledRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+used\s+a\s+Mark\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'UsedMarkRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+used\s+a\s+(Life|Mana)\s+Flask\s+in\s+the\s+past\s+\d+\s+seconds$/i,
    apply: (m) => ({ tags: [{ type: 'Condition', var: `Used${capFirst(m[1]!)}FlaskRecently` }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+inflicted\s+Exposure\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'InflictedExposureRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you\s+haven't\s+taken\s+Damage\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'TakenDamageRecently', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)for\s+\d+\s+seconds\s+when\s+you\s+Kill\s+(?:an\s+Enemy|a\s+Rare\s+or\s+Unique\s+Enemy)$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'KilledRecently' }] }),
  },

  // --- Enemy status conditions ("against <Status> Enemies") ---
  {
    regex: new RegExp(`(?:\\s*,\\s*|\\s+)against\\s+${ENEMY_STATUS_PATTERN}\\s+Enem(?:y|ies)$`, 'i'),
    apply: (m) => ({
      tags: [{ type: 'Condition', var: `Enemy${capFirst(m[1]!)}` }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)against\s+(?:Rare\s+(?:and|or)\s+)?Unique\s+Enemies$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'EnemyRareOrUnique' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)against\s+Enemies\s+(?:that\s+are\s+)?on\s+Full\s+Life$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'EnemyFullLife' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)against\s+Enemies\s+(?:that\s+are\s+)?on\s+Low\s+Life$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'EnemyLowLife' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)against\s+Enemies\s+(?:that\s+are\s+)?not\s+on\s+Low\s+Life$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'EnemyLowLife', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)against\s+Enemies\s+affected\s+by\s+(?:Elemental\s+)?Ailments$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'EnemyAffectedByAilment' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)against\s+Enemies\s+that\s+cannot\s+have\s+Life\s+Leeched\s+from\s+them$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'EnemyCannotBeLeeched' }] }),
  },
  {
    regex: new RegExp(`(?:\\s*,\\s*|\\s+)on\\s+${ENEMY_STATUS_PATTERN}\\s+Enemies$`, 'i'),
    apply: (m) => ({
      tags: [{ type: 'Condition', var: `Enemy${capFirst(m[1]!)}` }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)with\s+Spells\s+that\s+cost\s+Life$/i,
    apply: () => ({
      flags: ModFlag.Spell,
      tags: [{ type: 'Condition', var: 'SpellCostsLife' }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)with\s+Skills\s+that\s+cost\s+Life$/i,
    apply: () => ({
      tags: [{ type: 'Condition', var: 'SpellCostsLife' }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)to\s+your\s+Marked\s+targets$/i,
    apply: () => ({
      tags: [{ type: 'Condition', var: 'EnemyMarked' }],
    }),
  },
  {
    regex: /(?<!bonuses gained)(?<!bonus gained)(?:\s*,\s*|\s+)from\s+(?:your\s+)?Equipped\s+(Body Armour|Shield|Helmet|Focus|Boots|Gloves)$/i,
    apply: (m) => ({ slotScope: normalizeSlotScope(m[1]!) }),
  },
  {
    regex: /(?:\s*,\s*|\s+)for\s+each\s+type\s+of\s+Elemental\s+Ailment\s+on\s+(?:the\s+)?Enemy$/i,
    apply: () => ({ tags: [{ type: 'Multiplier', var: 'ElementalAilmentTypesOnEnemy' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+a\s+(?:Rare\s+or\s+)?Unique\s+Enemy\s+is\s+(?:Nearby|in\s+your\s+Presence)$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'EnemyRareOrUnique' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+your\s+Companion\s+is\s+in\s+your\s+Presence$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'CompanionInPresence' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+Surrounded$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'Surrounded' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you\s+haven't\s+been\s+(Stunned|Frozen|Chilled|Ignited|Shocked|Bleeding|Poisoned)\s+Recently$/i,
    apply: (m) => ({ tags: [{ type: 'Condition', var: `Been${capFirst(m[1]!)}Recently`, neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+been\s+(Stunned|Frozen|Chilled|Ignited|Shocked|Bleeding|Poisoned)\s+Recently$/i,
    apply: (m) => ({ tags: [{ type: 'Condition', var: `Been${capFirst(m[1]!)}Recently` }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+not\s+Ignited,\s+Frozen\s+or\s+Shocked$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'Ignited|Frozen|Shocked', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+(Ignited|Chilled|Frozen|Shocked|Poisoned|Scorched|Brittle|Sapped)\s+an\s+Enemy\s+Recently$/i,
    apply: (m) => ({ tags: [{ type: 'Condition', var: `${capFirst(m[1]!)}EnemyRecently` }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+Insane$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'Insane' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+Sane$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'Insane', neg: true }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+you(?:'ve|\s+have)\s+Shapeshifted(?:\s+to\s+an\s+Animal\s+form)?\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'ShapeshiftedRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)if\s+Leech\s+was\s+removed\s+by\s+Filling\s+Unreserved\s+Life\s+Recently$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'LeechRemovedByFullLifeRecently' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)against\s+enemies\s+within\s+(\d+(?:\.\d+)?)\s*m(?:etres?)?$/i,
    apply: (m) => ({
      tags: [{ type: 'Condition', var: `EnemyDistanceLe:${Math.round(Number(m[1]) * 10)}` }],
    }),
  },
  {
    regex: /(?:\s*,\s*|\s+)by\s+Cursed\s+Enemies$/i,
    apply: () => ({ tags: [{ type: 'Condition', var: 'EnemyCursed' }] }),
  },
  {
    regex: /(?:\s*,\s*|\s+)against\s+you$/i,
    apply: () => ({ actorScope: 'enemy' }),
  },
  {
    regex: /(?:\s*,\s*|\s+)on\s+Enemies$/i,
    apply: () => ({}),
  },
  {
    regex: /(?:\s*,\s*|\s+)while\s+active$/i,
    apply: () => ({}),
  },
];

// ============================================================================
// Stage 2: Weapon, Skill & Element Scope Peeler (Leading & Trailing)
// ============================================================================

export const STAGE2_PREFIX_SCOPE_RULES: readonly Stage2ScopeRule[] = [
  // Weapon attack prefixes
  { regex: /^Bow Attacks (?:deal |have |gain )/i, flags: ModFlag.Bow | ModFlag.Attack },
  { regex: /^Wand Attacks (?:deal |have |gain )/i, flags: ModFlag.Wand | ModFlag.Attack },
  { regex: /^Claw Attacks (?:deal |have |gain )/i, flags: ModFlag.Claw | ModFlag.Attack },
  { regex: /^Dagger Attacks (?:deal |have |gain )/i, flags: ModFlag.Dagger | ModFlag.Attack },
  { regex: /^Sword Attacks (?:deal |have |gain )/i, flags: ModFlag.Sword | ModFlag.Attack },
  { regex: /^Axe Attacks (?:deal |have |gain )/i, flags: ModFlag.Axe | ModFlag.Attack },
  { regex: /^Mace(?: or Sceptre)? Attacks (?:deal |have |gain )/i, flags: ModFlag.Mace | ModFlag.Attack },
  { regex: /^Staff Attacks (?:deal |have |gain )/i, flags: ModFlag.Staff | ModFlag.Attack },
  { regex: /^Quarterstaff Attacks (?:deal |have |gain )/i, flags: ModFlag.Quarterstaff | ModFlag.Attack },
  { regex: /^Crossbow Attacks (?:deal |have |gain )/i, flags: ModFlag.Crossbow | ModFlag.Attack },
  { regex: /^Spear Attacks (?:deal |have |gain )/i, flags: ModFlag.Sword | ModFlag.Melee | ModFlag.Attack },
  { regex: /^(?:Axe or Sword|Claw or Dagger) Attacks (?:deal |have |gain )/i, flags: ModFlag.Attack | ModFlag.Melee },
  { regex: /^Mace,\s*Sceptre or Staff Attacks (?:deal |have |gain )/i, flags: ModFlag.Attack },
  {
    regex: /^Attacks with Two[\s-]Handed Melee Weapons (?:deal |have |gain )/i,
    flags: ModFlag.Attack | ModFlag.Weapon2H | ModFlag.Melee,
  },
  {
    regex: /^Attacks with Two[\s-]Handed Weapons (?:deal |have |gain )/i,
    flags: ModFlag.Attack | ModFlag.Weapon2H,
  },
  {
    regex: /^Attacks with One[\s-]Handed Melee Weapons (?:deal |have |gain )/i,
    flags: ModFlag.Attack | ModFlag.Weapon1H | ModFlag.Melee,
  },
  {
    regex: /^Attacks with One[\s-]Handed Weapons (?:deal |have |gain )/i,
    flags: ModFlag.Attack | ModFlag.Weapon1H,
  },
  { regex: /^Attacks with Melee Weapons (?:deal |have |gain )/i, flags: ModFlag.Attack | ModFlag.Melee },
  { regex: /^Attacks with Ranged Weapons (?:deal |have |gain )/i, flags: ModFlag.Attack | ModFlag.WeaponRanged },
  { regex: /^Attacks with this Weapon (?:deal |have |gain )?/i, flags: ModFlag.Attack },

  // Totem / Trap / Mine skill prefixes
  { regex: /^Attacks used by Totems (?:deal |have )/i, flags: ModFlag.Attack, keywordFlags: KeywordFlag.Totem },
  { regex: /^Spells [Cc]ast by Totems (?:deal |have )/i, flags: ModFlag.Spell, keywordFlags: KeywordFlag.Totem },
  { regex: /^Skills used by Totems (?:deal |have )/i, keywordFlags: KeywordFlag.Totem },
  { regex: /^Skills (?:used by|which throw) Traps (?:deal |have )/i, keywordFlags: KeywordFlag.Trap },
  { regex: /^Skills (?:used by|which throw) Mines (?:deal |have )/i, keywordFlags: KeywordFlag.Mine },

  // Element + Skill/Spell prefixes
  { regex: /^Fire Spells (?:deal |have |gain )/i, flags: ModFlag.Spell, keywordFlags: KeywordFlag.Fire },
  { regex: /^Cold Spells (?:deal |have |gain )/i, flags: ModFlag.Spell, keywordFlags: KeywordFlag.Cold },
  { regex: /^Lightning Spells (?:deal |have |gain )/i, flags: ModFlag.Spell, keywordFlags: KeywordFlag.Lightning },
  { regex: /^Chaos Spells (?:deal |have |gain )/i, flags: ModFlag.Spell, keywordFlags: KeywordFlag.Chaos },
  { regex: /^Physical Spells (?:deal |have |gain )/i, flags: ModFlag.Spell, keywordFlags: KeywordFlag.Physical },
  { regex: /^Fire Skills (?:deal |have |gain )/i, keywordFlags: KeywordFlag.Fire },
  { regex: /^Cold Skills (?:deal |have |gain )/i, keywordFlags: KeywordFlag.Cold },
  { regex: /^Lightning Skills (?:deal |have |gain )/i, keywordFlags: KeywordFlag.Lightning },
  { regex: /^Chaos Skills (?:deal |have |gain )/i, keywordFlags: KeywordFlag.Chaos },
  { regex: /^Physical Skills (?:deal |have |gain )/i, keywordFlags: KeywordFlag.Physical },

  // Skill category prefixes
  { regex: /^Projectile Attack Skills (?:deal |have |gain )/i, flags: ModFlag.Attack | ModFlag.Projectile },
  { regex: /^Melee Attack Skills (?:deal |have |gain )/i, flags: ModFlag.Attack | ModFlag.Melee },
  { regex: /^Melee (?:Skills|Attacks) (?:deal |have |gain )/i, flags: ModFlag.Melee },
  { regex: /^Bow Skills (?:deal |have |fire |gain )/i, flags: ModFlag.Bow },
  { regex: /^Attack Skills (?:deal |have |gain )/i, flags: ModFlag.Attack },
  { regex: /^Attacks (?:deal |have |gain )/i, flags: ModFlag.Attack },
  { regex: /^Triggered Spells (?:deal |have |gain )/i, flags: ModFlag.Spell, tags: [{ type: 'SkillType', skillType: 'Triggered' }] },
  { regex: /^Spell Skills (?:deal |have |gain )/i, flags: ModFlag.Spell },
  { regex: /^Spells (?:deal |have |gain )/i, flags: ModFlag.Spell },
  { regex: /^Projectiles from Spells /i, flags: ModFlag.Spell | ModFlag.Projectile },
  { regex: /^Projectiles (?:deal |have |gain )/i, flags: ModFlag.Projectile },
  { regex: /^Area Skills (?:deal |have |gain )/i, flags: ModFlag.Area },
  { regex: /^Non-Curse Aura Skills (?:deal |have |gain )/i, keywordFlags: KeywordFlag.Aura },
  { regex: /^Aura Skills (?:deal |have |gain )/i, keywordFlags: KeywordFlag.Aura },
  { regex: /^(?:Curse|Hex) Skills (?:deal |have |gain )/i, keywordFlags: KeywordFlag.Curse },
  { regex: /^Warcry Skills (?:deal |have |gain )/i, keywordFlags: KeywordFlag.Warcry },
  { regex: /^Herald Skills (?:deal |have |gain )/i, tags: [{ type: 'SkillType', skillType: 'Herald' }] },
  { regex: /^Brand Skills (?:deal |have |gain )/i, tags: [{ type: 'SkillType', skillType: 'Brand' }] },
  { regex: /^Channelling Skills (?:deal |have |gain )/i, tags: [{ type: 'SkillType', skillType: 'Channel' }] },
  { regex: /^Non-Channelling Spells (?:deal |have |gain )/i, flags: ModFlag.Spell, tags: [{ type: 'SkillType', skillType: 'Channel', neg: true }] },
  { regex: /^Non-Channelling Attacks (?:deal |have |gain )/i, flags: ModFlag.Attack, tags: [{ type: 'SkillType', skillType: 'Channel', neg: true }] },
  { regex: /^Non-Channelling Skills (?:deal |have |gain )/i, tags: [{ type: 'SkillType', skillType: 'Channel', neg: true }] },
  { regex: /^Banner Skills (?:deal |have |gain )/i, tags: [{ type: 'SkillType', skillType: 'Banner' }] },
  { regex: /^Guard Skills (?:deal |have |gain )/i, tags: [{ type: 'SkillType', skillType: 'Guard' }] },
  { regex: /^Mark Skills (?:deal |have |gain )/i, tags: [{ type: 'SkillType', skillType: 'Mark' }] },
  { regex: /^Link Skills (?:deal |have |gain )/i, tags: [{ type: 'SkillType', skillType: 'Link' }] },
  { regex: /^Retaliation Skills (?:deal |have |gain )/i, tags: [{ type: 'SkillType', skillType: 'Retaliation' }] },
  { regex: /^Stance Skills (?:deal |have |gain )/i, tags: [{ type: 'SkillType', skillType: 'Stance' }] },
  { regex: /^Travel Skills (?:deal |have |gain )/i, tags: [{ type: 'SkillType', skillType: 'Travel' }] },
  { regex: /^Movement Skills (?:deal |have |gain )/i, keywordFlags: KeywordFlag.Movement },
  { regex: /^Grenade Skills (?:deal |have |gain )/i, tags: [{ type: 'SkillType', skillType: 'Grenade' }] },
  { regex: /^Detonator Skills (?:deal |have |gain )/i, tags: [{ type: 'SkillType', skillType: 'Detonator' }] },
  { regex: /^Non-Minion Skills (?:deal |have |gain )/i, tags: [{ type: 'SkillType', skillType: 'Minion', neg: true }] },
  { regex: /^Minion Skills (?:deal |have |gain )/i, keywordFlags: KeywordFlag.Minion },
  { regex: /^(?:Exerted|Empowered|Ancestrally Boosted) Attacks (?:deal |have |gain )/i, flags: ModFlag.Attack },
  { regex: /^Slam Skills you use yourself (?:deal |have |gain )/i, flags: ModFlag.Attack | ModFlag.Melee },
  { regex: /^Slam Skills (?:deal |have |gain )/i, flags: ModFlag.Attack | ModFlag.Melee },
  { regex: /^Skills (?:have |deal |gain )/i },
];

export const STAGE2_SUFFIX_SCOPE_RULES: readonly Stage2ScopeRule[] = [
  // Weapons (longest / most specific first)
  { regex: /\s+with Two[\s-]Handed Melee Weapons$/i, flags: ModFlag.Weapon2H | ModFlag.Melee },
  { regex: /\s+with Two[\s-]Handed Weapons$/i, flags: ModFlag.Weapon2H },
  { regex: /\s+with One[\s-]Handed Melee Weapons$/i, flags: ModFlag.Weapon1H | ModFlag.Melee },
  { regex: /\s+with One[\s-]Handed (?:Weapons|Attacks)$/i, flags: ModFlag.Weapon1H },
  { regex: /\s+with Melee Weapons$/i, flags: ModFlag.Melee },
  { regex: /\s+with Ranged Weapons$/i, flags: ModFlag.WeaponRanged },
  { regex: /\s+(?:with|to) Bow Attacks$/i, flags: ModFlag.Bow | ModFlag.Attack },
  { regex: /\s+with Bow Skills$/i, flags: ModFlag.Bow },
  { regex: /\s+with Bows$/i, flags: ModFlag.Bow },
  { regex: /\s+(?:with|to) Wand Attacks$/i, flags: ModFlag.Wand | ModFlag.Attack },
  { regex: /\s+with Wands$/i, flags: ModFlag.Wand },
  { regex: /\s+(?:with|to) Claw Attacks$/i, flags: ModFlag.Claw | ModFlag.Attack },
  { regex: /\s+with Claws$/i, flags: ModFlag.Claw },
  { regex: /\s+(?:with|to) Dagger Attacks$/i, flags: ModFlag.Dagger | ModFlag.Attack },
  { regex: /\s+with Daggers$/i, flags: ModFlag.Dagger },
  { regex: /\s+(?:with|to) Sword Attacks$/i, flags: ModFlag.Sword | ModFlag.Attack },
  { regex: /\s+with Swords$/i, flags: ModFlag.Sword },
  { regex: /\s+(?:with|to) Axe Attacks$/i, flags: ModFlag.Axe | ModFlag.Attack },
  { regex: /\s+with Axes$/i, flags: ModFlag.Axe },
  { regex: /\s+with (?:Axes or Swords|Claws or Daggers)$/i, flags: ModFlag.Attack | ModFlag.Melee },
  { regex: /\s+with Maces,\s*Sceptres or Staves$/i, flags: ModFlag.Attack },
  { regex: /\s+(?:with|to) Mace(?: or Sceptre| and Sceptre)? Attacks$/i, flags: ModFlag.Mace | ModFlag.Attack },
  { regex: /\s+with Maces(?: (?:or|and) Sceptres)?$/i, flags: ModFlag.Mace },
  { regex: /\s+with Flails$/i, flags: ModFlag.Mace },
  { regex: /\s+(?:with|to) Quarterstaff Attacks$/i, flags: ModFlag.Quarterstaff | ModFlag.Attack },
  { regex: /\s+with Quarterstaves$/i, flags: ModFlag.Quarterstaff },
  { regex: /\s+(?:with|to) Staff Attacks$/i, flags: ModFlag.Staff | ModFlag.Attack },
  { regex: /\s+with Staves$/i, flags: ModFlag.Staff },
  { regex: /\s+(?:with|to|for) Crossbow Attacks$/i, flags: ModFlag.Crossbow | ModFlag.Attack },
  { regex: /\s+with Crossbows$/i, flags: ModFlag.Crossbow },
  { regex: /\s+(?:with|to) Spear Attacks$/i, flags: ModFlag.Sword | ModFlag.Melee | ModFlag.Attack },
  { regex: /\s+with Spears$/i, flags: ModFlag.Sword | ModFlag.Melee },
  { regex: /\s+with (?:this )?Weapons?$/i, flags: ModFlag.Attack },
  { regex: /\s+from Melee Weapon(?:s| Attacks)?$/i, flags: ModFlag.Attack | ModFlag.Melee },

  // Delivery / Skill types (compound BEFORE single)
  { regex: /\s+with Hits and Ailments$/i, flags: ModFlag.Hit | ModFlag.Ailment },
  { regex: /\s+with Ailments from Attack Skills$/i, flags: ModFlag.Ailment | ModFlag.Attack },
  { regex: /\s+(?:with|for) Ailments$/i, flags: ModFlag.Ailment },
  { regex: /\s+with Hits$/i, flags: ModFlag.Hit },
  { regex: /\s+on Melee Hit$/i, flags: ModFlag.Melee | ModFlag.Hit },
  { regex: /\s+(?:for|with|of) Spell (?:Skills|Damage)$/i, flags: ModFlag.Spell },
  { regex: /\s+(?:for|with|of) Spells$/i, flags: ModFlag.Spell },
  { regex: /\s+(?:for|with|of) Attack (?:Skills|Damage)$/i, flags: ModFlag.Attack },
  { regex: /\s+(?:for|with|of) Attacks$/i, flags: ModFlag.Attack },
  { regex: /\s+with Plant Skills$/i, tags: [{ type: 'SkillType', skillType: 'Plant' }] },
  { regex: /\s+(?:with|for|of) Area Skills$/i, flags: ModFlag.Area },
  { regex: /\s+(?:with|for|of) Projectile (?:Skills|Attacks)$/i, flags: ModFlag.Projectile },
  { regex: /\s+with Projectiles$/i, flags: ModFlag.Projectile },
  { regex: /\s+(?:with|for|of) Melee (?:Skills|Attacks|Damage)$/i, flags: ModFlag.Melee },
  { regex: /\s+of (?:Non-Curse )?Aura Skills$/i, keywordFlags: KeywordFlag.Aura },
  { regex: /\s+(?:of|with|for) (?:Curse|Hex) (?:Aura )?Skills$/i, keywordFlags: KeywordFlag.Curse },
  { regex: /\s+(?:of|for) (?:Curses|Hexes)$/i, keywordFlags: KeywordFlag.Curse },
  { regex: /\s+(?:of|with|for) Warcry Skills$/i, keywordFlags: KeywordFlag.Warcry },
  { regex: /\s+with Warcries$/i, keywordFlags: KeywordFlag.Warcry },
  { regex: /\s+(?:of|with|for) Herald Skills$/i, tags: [{ type: 'SkillType', skillType: 'Herald' }] },
  { regex: /\s+(?:of|with|for) Totem Skills$/i, keywordFlags: KeywordFlag.Totem },
  { regex: /\s+(?:of|with|for) Trap Skills$/i, keywordFlags: KeywordFlag.Trap },
  { regex: /\s+(?:with|for) Traps$/i, keywordFlags: KeywordFlag.Trap },
  { regex: /\s+(?:of|with|for) Mine Skills$/i, keywordFlags: KeywordFlag.Mine },
  { regex: /\s+(?:with|for) Mines$/i, keywordFlags: KeywordFlag.Mine },
  { regex: /\s+(?:of|with|for) Brand Skills$/i, tags: [{ type: 'SkillType', skillType: 'Brand' }] },
  { regex: /\s+(?:of|with|for) Movement Skills$/i, keywordFlags: KeywordFlag.Movement },
  { regex: /\s+(?:of|with|for) Travel Skills$/i, tags: [{ type: 'SkillType', skillType: 'Travel' }] },
  { regex: /\s+(?:of|with|for) Stance Skills$/i, tags: [{ type: 'SkillType', skillType: 'Stance' }] },
  { regex: /\s+(?:of|with|for) Grenade Skills$/i, tags: [{ type: 'SkillType', skillType: 'Grenade' }] },
  { regex: /\s+(?:of|with|for) Command Skills$/i, tags: [{ type: 'SkillType', skillType: 'Command' }] },
  { regex: /\s+(?:of|with|for) Companion Skills$/i, tags: [{ type: 'SkillType', skillType: 'Companion' }] },
  { regex: /\s+(?:of|with|for) Non-Companion Skills$/i, tags: [{ type: 'SkillType', skillType: 'Companion', neg: true }] },
  { regex: /\s+(?:of|with|for) Banner Skills$/i, tags: [{ type: 'SkillType', skillType: 'Banner' }] },
  { regex: /\s+(?:of|with|for) Guard Skills$/i, tags: [{ type: 'SkillType', skillType: 'Guard' }] },
  { regex: /\s+(?:of|with|for) Link Skills$/i, tags: [{ type: 'SkillType', skillType: 'Link' }] },
  { regex: /\s+(?:of|with|for) Retaliation Skills$/i, tags: [{ type: 'SkillType', skillType: 'Retaliation' }] },
  { regex: /\s+(?:of|with|for) Mark Skills$/i, tags: [{ type: 'SkillType', skillType: 'Mark' }] },
  { regex: /\s+(?:of|for) Marks$/i, tags: [{ type: 'SkillType', skillType: 'Mark' }] },
  { regex: /\s+(?:of|with|for) Channelling Skills$/i, tags: [{ type: 'SkillType', skillType: 'Channel' }] },
  { regex: /\s+(?:of|with|for) Non-Channelling Skills$/i, tags: [{ type: 'SkillType', skillType: 'Channel', neg: true }] },
  { regex: /\s+(?:of|with|for) Minion Skills$/i, keywordFlags: KeywordFlag.Minion },

  // Element Skill suffixes
  { regex: /\s+(?:with|of|for) Fire Spells$/i, flags: ModFlag.Spell, keywordFlags: KeywordFlag.Fire },
  { regex: /\s+(?:with|of|for) Cold Spells$/i, flags: ModFlag.Spell, keywordFlags: KeywordFlag.Cold },
  { regex: /\s+(?:with|of|for) Lightning Spells$/i, flags: ModFlag.Spell, keywordFlags: KeywordFlag.Lightning },
  { regex: /\s+(?:with|of|for) Chaos Spells$/i, flags: ModFlag.Spell, keywordFlags: KeywordFlag.Chaos },
  { regex: /\s+(?:with|of|for) Physical Spells$/i, flags: ModFlag.Spell, keywordFlags: KeywordFlag.Physical },
  { regex: /\s+(?:with|of|for) Fire Skills$/i, keywordFlags: KeywordFlag.Fire },
  { regex: /\s+(?:with|of|for) Cold Skills$/i, keywordFlags: KeywordFlag.Cold },
  { regex: /\s+(?:with|of|for) Lightning Skills$/i, keywordFlags: KeywordFlag.Lightning },
  { regex: /\s+(?:with|of|for) Chaos Skills$/i, keywordFlags: KeywordFlag.Chaos },
  { regex: /\s+(?:with|of|for) Physical Skills$/i, keywordFlags: KeywordFlag.Physical },
];

// ============================================================================
// Stage 4: Comprehensive `MOD_NAME_TABLE` (aligned 100% with engine.ts)
// ============================================================================

export const MOD_NAME_TABLE: Record<string, ModNameTarget> = {
  // --- Attributes ---
  strength: { names: ['Str'] },
  dexterity: { names: ['Dex'] },
  intelligence: { names: ['Int'] },
  'strength and dexterity': { names: ['Str', 'Dex'] },
  'dexterity and strength': { names: ['Str', 'Dex'] },
  'strength and intelligence': { names: ['Str', 'Int'] },
  'intelligence and strength': { names: ['Str', 'Int'] },
  'dexterity and intelligence': { names: ['Dex', 'Int'] },
  'intelligence and dexterity': { names: ['Dex', 'Int'] },
  attributes: { names: ['Str', 'Dex', 'Int'] },
  'all attributes': { names: ['Str', 'Dex', 'Int'] },
  'any attribute': { names: ['AnyAttribute'] },
  omniscience: { names: ['Omni'] },
  devotion: { names: ['Devotion'] },
  'attribute requirements': { names: ['AttributeRequirements'] },
  'strength requirement': { names: ['StrRequirement'] },
  'dexterity requirement': { names: ['DexRequirement'] },
  'intelligence requirement': { names: ['IntRequirement'] },

  // --- Life / Mana / Energy Shield / Ward / Spirit ---
  life: { names: ['Life'] },
  'maximum life': { names: ['Life'] },
  mana: { names: ['Mana'] },
  'maximum mana': { names: ['Mana'] },
  'life and mana': { names: ['Life', 'Mana'] },
  'maximum life and mana': { names: ['Life', 'Mana'] },
  'maximum life and maximum mana': { names: ['Life', 'Mana'] },
  'energy shield': { names: ['EnergyShield'] },
  'maximum energy shield': { names: ['EnergyShield'] },
  'global energy shield': { names: ['EnergyShield'] },
  ward: { names: ['Ward'] },
  'ward from equipped armour items': { names: ['Ward'] },
  'maximum ward': { names: ['Ward'] },
  'runic ward': { names: ['Ward'] },
  'maximum runic ward': { names: ['Ward'] },
  spirit: { names: ['Spirit'] },
  'maximum spirit': { names: ['Spirit'] },
  'maximum darkness': { names: ['Darkness'] },
  'maximum life, mana and global energy shield': { names: ['Life', 'Mana', 'EnergyShield'] },

  // --- Primary Defences ---
  armour: { names: ['Armour'] },
  evasion: { names: ['Evasion'] },
  'evasion rating': { names: ['Evasion'] },
  'armour and evasion': { names: ['Armour', 'Evasion'] },
  'armour and evasion rating': { names: ['Armour', 'Evasion'] },
  'evasion and armour': { names: ['Armour', 'Evasion'] },
  'evasion rating and armour': { names: ['Armour', 'Evasion'] },
  'armour and energy shield': { names: ['Armour', 'EnergyShield'] },
  'energy shield and armour': { names: ['Armour', 'EnergyShield'] },
  'evasion and energy shield': { names: ['Evasion', 'EnergyShield'] },
  'evasion rating and energy shield': { names: ['Evasion', 'EnergyShield'] },
  'energy shield and evasion': { names: ['Evasion', 'EnergyShield'] },
  'armour, evasion and energy shield': { names: ['Armour', 'Evasion', 'EnergyShield'] },
  'armour, evasion rating and energy shield': { names: ['Armour', 'Evasion', 'EnergyShield'] },
  defences: { names: ['Armour', 'Evasion', 'EnergyShield', 'Ward'] },
  'global defences': { names: ['Armour', 'Evasion', 'EnergyShield', 'Ward'] },
  'deflection rating': { names: ['DeflectionRating'] },
  'physical damage reduction': { names: ['PhysDamageReduction'] },
  'physical damage reduction from hits': { names: ['PhysDamageReduction'] },
  'elemental damage reduction': { names: ['ElementalDamageReduction'] },

  // --- Resistances ---
  'fire resistance': { names: ['FireResist'] },
  'cold resistance': { names: ['ColdResist'] },
  'lightning resistance': { names: ['LightningResist'] },
  'chaos resistance': { names: ['ChaosResist'] },
  'maximum fire resistance': { names: ['FireResistMax'] },
  'maximum fire resistances': { names: ['FireResistMax'] },
  'maximum cold resistance': { names: ['ColdResistMax'] },
  'maximum cold resistances': { names: ['ColdResistMax'] },
  'maximum lightning resistance': { names: ['LightningResistMax'] },
  'maximum lightning resistances': { names: ['LightningResistMax'] },
  'maximum chaos resistance': { names: ['ChaosResistMax'] },
  'maximum chaos resistances': { names: ['ChaosResistMax'] },
  'fire and cold resistances': { names: ['FireResist', 'ColdResist'] },
  'cold and fire resistances': { names: ['FireResist', 'ColdResist'] },
  'fire and lightning resistances': { names: ['FireResist', 'LightningResist'] },
  'lightning and fire resistances': { names: ['FireResist', 'LightningResist'] },
  'cold and lightning resistances': { names: ['ColdResist', 'LightningResist'] },
  'lightning and cold resistances': { names: ['ColdResist', 'LightningResist'] },
  'fire and chaos resistances': { names: ['FireResist', 'ChaosResist'] },
  'cold and chaos resistances': { names: ['ColdResist', 'ChaosResist'] },
  'lightning and chaos resistances': { names: ['LightningResist', 'ChaosResist'] },
  'elemental resistance': { names: ['FireResist', 'ColdResist', 'LightningResist'] },
  'elemental resistances': { names: ['FireResist', 'ColdResist', 'LightningResist'] },
  'all elemental resistances': { names: ['FireResist', 'ColdResist', 'LightningResist'] },
  'all resistances': { names: ['FireResist', 'ColdResist', 'LightningResist', 'ChaosResist'] },
  'elemental and chaos resistances': {
    names: ['FireResist', 'ColdResist', 'LightningResist', 'ChaosResist'],
  },
  'all maximum elemental resistances': {
    names: ['FireResistMax', 'ColdResistMax', 'LightningResistMax'],
  },
  'all maximum resistances': {
    names: ['FireResistMax', 'ColdResistMax', 'LightningResistMax', 'ChaosResistMax'],
  },

  // --- Block / Suppression / Dodge / Evade ---
  'chance to block': { names: ['BlockChance'] },
  'block chance': { names: ['BlockChance'] },
  'chance to block attack damage': { names: ['BlockChance'] },
  'chance to block attacks': { names: ['BlockChance'] },
  'to block': { names: ['BlockChance'] },
  'to block attacks': { names: ['BlockChance'] },
  'to block attack damage': { names: ['BlockChance'] },
  'maximum block chance': { names: ['BlockChanceMax'] },
  'maximum chance to block': { names: ['BlockChanceMax'] },
  'maximum chance to block attack damage': { names: ['BlockChanceMax'] },
  'chance to block spell damage': { names: ['SpellBlockChance'] },
  'chance to block spells': { names: ['SpellBlockChance'] },
  'spell block chance': { names: ['SpellBlockChance'] },
  'to block spells': { names: ['SpellBlockChance'] },
  'to block spell damage': { names: ['SpellBlockChance'] },
  'maximum chance to block spell damage': { names: ['SpellBlockChanceMax'] },
  'maximum spell block chance': { names: ['SpellBlockChanceMax'] },
  'chance to block attack and spell damage': { names: ['BlockChance', 'SpellBlockChance'] },
  'chance to block attacks and spells': { names: ['BlockChance', 'SpellBlockChance'] },
  'chance to suppress spell damage': { names: ['SpellSuppressionChance'] },
  'to suppress spell damage': { names: ['SpellSuppressionChance'] },
  'amount of suppressed spell damage prevented': { names: ['SpellSuppressionEffect'] },
  'of suppressed spell damage': { names: ['SpellSuppressionEffect'] },
  'of damage from deflected hits': { names: ['DeflectedHitDamagePrevented'] },
  'chance to evade': { names: ['EvadeChance'] },
  'chance to evade attacks': { names: ['EvadeChance'] },
  'chance to evade attack hits': { names: ['EvadeChance'] },
  'to evade attack hits': { names: ['EvadeChance'] },
  'to dodge attack hits': { names: ['AttackDodgeChance'] },
  'to dodge spell hits': { names: ['SpellDodgeChance'] },

  // --- Recovery / Regen / Recharge / Leech / Recoup ---
  'life regeneration rate': { names: ['LifeRegen'] },
  'life regeneration': { names: ['LifeRegen'] },
  'mana regeneration rate': { names: ['ManaRegen'] },
  'mana regeneration': { names: ['ManaRegen'] },
  'life and mana regeneration rate': { names: ['LifeRegen', 'ManaRegen'] },
  'energy shield regeneration rate': { names: ['EnergyShieldRegen'] },
  'ward regeneration rate': { names: ['WardRegen'] },
  'runic ward regeneration rate': { names: ['WardRegen'] },
  'energy shield recharge rate': { names: ['EnergyShieldRecharge'] },
  'start of energy shield recharge': { names: ['EnergyShieldRechargeFaster'] },
  'restoration of ward': { names: ['WardRechargeFaster'] },
  'life recovery rate': { names: ['LifeRecoveryRate'] },
  'life cost efficiency': { names: ['LifeCostEfficiency'] },
  'weapon damage': { names: ['Damage'], flags: ModFlag.Attack },
  'melee weapon critical strike multiplier': {
    names: ['CritMultiplier'],
    flags: ModFlag.Attack | ModFlag.Melee,
  },
  'melee weapon critical strike chance': {
    names: ['CritChance'],
    flags: ModFlag.Attack | ModFlag.Melee,
  },
  'melee weapon elemental damage': {
    names: ['ElementalDamage'],
    flags: ModFlag.Attack | ModFlag.Melee,
  },
  'mana recovery rate': { names: ['ManaRecoveryRate'] },
  'energy shield recovery rate': { names: ['EnergyShieldRecoveryRate'] },
  'recovery rate of life, mana and energy shield': {
    names: ['LifeRecoveryRate', 'ManaRecoveryRate', 'EnergyShieldRecoveryRate'],
  },
  'recovery rate of life and energy shield': {
    names: ['LifeRecoveryRate', 'EnergyShieldRecoveryRate'],
  },
  'total recovery per second from life leech': { names: ['LifeLeechRate'] },
  'total recovery per second from mana leech': { names: ['ManaLeechRate'] },
  'total recovery per second from energy shield leech': { names: ['EnergyShieldLeechRate'] },
  'total recovery per second from life, mana, or energy shield leech': {
    names: ['LifeLeechRate', 'ManaLeechRate', 'EnergyShieldLeechRate'],
  },
  'maximum total life recovery per second from leech': { names: ['LifeMaxLeechRateInc'] },
  'maximum total recovery per second from life leech': { names: ['LifeMaxLeechRateInc'] },
  'maximum total energy shield recovery per second from leech': { names: ['EsMaxLeechRateInc'] },
  'maximum total recovery per second from energy shield leech': { names: ['EsMaxLeechRateInc'] },
  'maximum total mana recovery per second from leech': { names: ['ManaMaxLeechRateInc'] },
  'maximum total recovery per second from mana leech': { names: ['ManaMaxLeechRateInc'] },
  'maximum total life, mana and energy shield recovery per second from leech': {
    names: ['LifeMaxLeechRateInc', 'ManaMaxLeechRateInc', 'EsMaxLeechRateInc'],
  },
  'amount of life leeched': { names: ['LifeLeechAmount'] },
  'amount of mana leeched': { names: ['ManaLeechAmount'] },
  'maximum recovery per life leech': { names: ['LifeLeechMaxRecovery'] },
  'speed of recoup effects': { names: ['RecoupSpeed'] },

  // --- Damage Taken ---
  'damage taken': { names: ['DamageTaken'] },
  'damage taken from hits': { names: ['DamageTaken'] },
  'damage taken when hit': { names: ['DamageTaken'] },
  'damage taken from damage over time': { names: ['DamageTakenOverTime'] },
  'damage over time taken': { names: ['DamageTakenOverTime'] },
  'physical damage taken': { names: ['PhysicalDamageTaken'] },
  'physical damage taken from hits': { names: ['PhysicalDamageTaken'] },
  'physical damage taken from attack hits': { names: ['PhysicalDamageTakenFromAttacks'] },
  'physical damage taken from attacks': { names: ['PhysicalDamageTakenFromAttacks'] },
  'fire damage taken': { names: ['FireDamageTaken'] },
  'cold damage taken': { names: ['ColdDamageTaken'] },
  'lightning damage taken': { names: ['LightningDamageTaken'] },
  'chaos damage taken': { names: ['ChaosDamageTaken'] },
  'elemental damage taken': { names: ['ElementalDamageTaken'] },
  'attack damage taken': { names: ['AttackDamageTaken'] },
  'spell damage taken': { names: ['SpellDamageTaken'] },
  'extra damage from critical strikes': { names: ['CritExtraDamageTaken'] },
  'extra damage from critical hits': { names: ['CritExtraDamageTaken'] },

  // --- Damage (Basic & Typed) ---
  damage: { names: ['Damage'] },
  'global damage': { names: ['Damage'] },
  'minimum damage': { names: ['MinDamage'] },
  'maximum damage': { names: ['MaxDamage'] },
  'minimum attack damage': { names: ['MinDamage'], flags: ModFlag.Attack },
  'maximum attack damage': { names: ['MaxDamage'], flags: ModFlag.Attack },
  'minimum spell damage': { names: ['MinDamage'], flags: ModFlag.Spell },
  'maximum spell damage': { names: ['MaxDamage'], flags: ModFlag.Spell },
  'physical damage': { names: ['PhysicalDamage'] },
  'minimum physical damage': { names: ['PhysicalMinDamage'] },
  'maximum physical damage': { names: ['PhysicalMaxDamage'] },
  'minimum physical attack damage': { names: ['PhysicalMinDamage'], flags: ModFlag.Attack },
  'maximum physical attack damage': { names: ['PhysicalMaxDamage'], flags: ModFlag.Attack },
  'fire damage': { names: ['FireDamage'] },
  'minimum fire damage': { names: ['FireMinDamage'] },
  'maximum fire damage': { names: ['FireMaxDamage'] },
  'cold damage': { names: ['ColdDamage'] },
  'minimum cold damage': { names: ['ColdMinDamage'] },
  'maximum cold damage': { names: ['ColdMaxDamage'] },
  'lightning damage': { names: ['LightningDamage'] },
  'minimum lightning damage': { names: ['LightningMinDamage'] },
  'maximum lightning damage': { names: ['LightningMaxDamage'] },
  'chaos damage': { names: ['ChaosDamage'] },
  'minimum chaos damage': { names: ['ChaosMinDamage'] },
  'maximum chaos damage': { names: ['ChaosMaxDamage'] },
  'elemental damage': { names: ['ElementalDamage'] },
  'spell damage': { names: ['Damage'], flags: ModFlag.Spell },
  'attack damage': { names: ['Damage'], flags: ModFlag.Attack },
  'melee damage': { names: ['Damage'], flags: ModFlag.Melee },
  'melee physical damage': { names: ['PhysicalDamage'], flags: ModFlag.Melee },
  'physical melee damage': { names: ['PhysicalDamage'], flags: ModFlag.Melee },
  'attack physical damage': { names: ['PhysicalDamage'], flags: ModFlag.Attack },
  'physical attack damage': { names: ['PhysicalDamage'], flags: ModFlag.Attack },
  'attack fire damage': { names: ['FireDamage'], flags: ModFlag.Attack },
  'attack cold damage': { names: ['ColdDamage'], flags: ModFlag.Attack },
  'attack lightning damage': { names: ['LightningDamage'], flags: ModFlag.Attack },
  'attack chaos damage': { names: ['ChaosDamage'], flags: ModFlag.Attack },
  'attack elemental damage': { names: ['ElementalDamage'], flags: ModFlag.Attack },
  'spell physical damage': { names: ['PhysicalDamage'], flags: ModFlag.Spell },
  'spell fire damage': { names: ['FireDamage'], flags: ModFlag.Spell },
  'spell cold damage': { names: ['ColdDamage'], flags: ModFlag.Spell },
  'spell lightning damage': { names: ['LightningDamage'], flags: ModFlag.Spell },
  'spell chaos damage': { names: ['ChaosDamage'], flags: ModFlag.Spell },
  'projectile damage': { names: ['Damage'], flags: ModFlag.Projectile },
  'projectile attack damage': { names: ['Damage'], flags: ModFlag.Projectile | ModFlag.Attack },
  'area damage': { names: ['Damage'], flags: ModFlag.Area },
  'attack area damage': { names: ['Damage'], flags: ModFlag.Attack | ModFlag.Area },
  'spell area damage': { names: ['Damage'], flags: ModFlag.Spell | ModFlag.Area },
  'bow damage': { names: ['Damage'], flags: ModFlag.Bow },
  'wand damage': { names: ['Damage'], flags: ModFlag.Wand },
  'wand physical damage': { names: ['PhysicalDamage'], flags: ModFlag.Wand },
  'claw physical damage': { names: ['PhysicalDamage'], flags: ModFlag.Claw },
  'sword physical damage': { names: ['PhysicalDamage'], flags: ModFlag.Sword },
  'minion damage': { names: ['MinionDamage'], keywordFlags: KeywordFlag.Minion, actorScope: 'minion' },
  'totem damage': { names: ['Damage'], keywordFlags: KeywordFlag.Totem },
  'trap damage': { names: ['Damage'], keywordFlags: KeywordFlag.Trap },
  'mine damage': { names: ['Damage'], keywordFlags: KeywordFlag.Mine },
  'trap and mine damage': { names: ['Damage'], keywordFlags: KeywordFlag.Trap | KeywordFlag.Mine },
  'brand damage': { names: ['Damage'], tags: [{ type: 'SkillType', skillType: 'Brand' }] },
  'channelling damage': { names: ['Damage'], tags: [{ type: 'SkillType', skillType: 'Channel' }] },
  'retaliation damage': { names: ['Damage'], tags: [{ type: 'SkillType', skillType: 'Retaliation' }] },
  'thorns damage': { names: ['ThornsDamage'] },
  'grenade damage': { names: ['Damage'], tags: [{ type: 'SkillType', skillType: 'Grenade' }] },
  'hazard damage': { names: ['Damage'], tags: [{ type: 'SkillType', skillType: 'Hazard' }] },
  'ballista damage': { names: ['Damage'], keywordFlags: KeywordFlag.Totem },
  'parry damage': { names: ['ParryDamage'] },

  // --- DoT & Ailments ---
  'damage over time': { names: ['DotDamage'] },
  'physical damage over time': { names: ['DotDamage'], keywordFlags: KeywordFlag.Physical },
  'fire damage over time': { names: ['DotDamage'], keywordFlags: KeywordFlag.Fire },
  'cold damage over time': { names: ['DotDamage'], keywordFlags: KeywordFlag.Cold },
  'chaos damage over time': { names: ['DotDamage'], keywordFlags: KeywordFlag.Chaos },
  'burning damage': { names: ['IgniteDamage'] },
  'ignite damage': { names: ['IgniteDamage'] },
  'damage with ignite': { names: ['IgniteDamage'] },
  'damage with ignites': { names: ['IgniteDamage'] },
  'poison damage': { names: ['DotDamage'], keywordFlags: KeywordFlag.Poison },
  'bleeding damage': { names: ['DotDamage'], keywordFlags: KeywordFlag.Bleed },
  'damage with poison': { names: ['DotDamage'], keywordFlags: KeywordFlag.Poison },
  'damage with bleeding': { names: ['DotDamage'], keywordFlags: KeywordFlag.Bleed },
  'damage with bleed': { names: ['DotDamage'], keywordFlags: KeywordFlag.Bleed },
  'damage over time multiplier': { names: ['DotMultiplier'] },
  'physical damage over time multiplier': { names: ['PhysicalDotMultiplier'] },
  'fire damage over time multiplier': { names: ['FireDotMultiplier'] },
  'cold damage over time multiplier': { names: ['ColdDotMultiplier'] },
  'chaos damage over time multiplier': { names: ['ChaosDotMultiplier'] },
  'damage over time multiplier for poison': { names: ['ChaosDotMultiplier'] },
  'damage over time multiplier for chaos': { names: ['ChaosDotMultiplier'] },
  'damage over time multiplier for bleeding': { names: ['PhysicalDotMultiplier'] },
  'damage over time multiplier for physical': { names: ['PhysicalDotMultiplier'] },
  'damage over time multiplier for ignite': { names: ['FireDotMultiplier'] },
  'damage over time multiplier for fire': { names: ['FireDotMultiplier'] },
  'damage over time multiplier for cold': { names: ['ColdDotMultiplier'] },

  // Ailment Magnitude / Speed / Chance / Duration
  'magnitude of ailments': { names: ['AilmentMagnitude'] },
  'magnitude of damaging ailments': { names: ['AilmentMagnitude'] },
  'magnitude of ailments you inflict': { names: ['AilmentMagnitude'] },
  'magnitude of damaging ailments you inflict': { names: ['AilmentMagnitude'] },
  'magnitude of non-damaging ailments': { names: ['NonDamagingAilmentMagnitude'] },
  'magnitude of non-damaging ailments you inflict': { names: ['NonDamagingAilmentMagnitude'] },
  'magnitude of ignite': { names: ['IgniteMagnitude'] },
  'magnitude of ignite you inflict': { names: ['IgniteMagnitude'] },
  'ignite magnitude': { names: ['IgniteMagnitude'] },
  'magnitude of bleeding': { names: ['BleedingMagnitude'] },
  'magnitude of bleeding you inflict': { names: ['BleedingMagnitude'] },
  'bleeding magnitude': { names: ['BleedingMagnitude'] },
  'magnitude of poison': { names: ['PoisonMagnitude'] },
  'magnitude of poison you inflict': { names: ['PoisonMagnitude'] },
  'poison magnitude': { names: ['PoisonMagnitude'] },
  'magnitude of shock': { names: ['ShockMagnitude'] },
  'magnitude of shock you inflict': { names: ['ShockMagnitude'] },
  'shock magnitude': { names: ['ShockMagnitude'] },
  'magnitude of chill': { names: ['ChillMagnitude'] },
  'magnitude of chill you inflict': { names: ['ChillMagnitude'] },
  'chill magnitude': { names: ['ChillMagnitude'] },
  'flammability magnitude': { names: ['FlammabilityMagnitude'] },
  'withered magnitude': { names: ['WitherEffect'] },
  'effect of withered': { names: ['WitherEffect'] },
  'effect of non-damaging ailments': { names: ['NonDamagingAilmentEffect'] },
  'effect of non-damaging ailments you inflict': { names: ['NonDamagingAilmentEffect'] },
  'effect of shock': { names: ['ShockEffect'] },
  'effect of shock on you': { names: ['SelfShockEffect'] },
  'effect of chill': { names: ['ChillEffect'] },
  'effect of chill on you': { names: ['SelfChillEffect'] },
  'effect of chill and shock on you': { names: ['SelfChillEffect', 'SelfShockEffect'] },
  'effect of scorch': { names: ['EnemyScorchEffect'] },
  'effect of scorch you inflict': { names: ['EnemyScorchEffect'] },
  'effect of brittle': { names: ['EnemyBrittleEffect'] },
  'effect of brittle you inflict': { names: ['EnemyBrittleEffect'] },
  'effect of sap': { names: ['EnemySapEffect'] },
  'effect of sap you inflict': { names: ['EnemySapEffect'] },
  'effect of exposure on you': { names: ['ExposureEffectOnSelf'] },
  'magnitude of ignite on you': { names: ['SelfIgniteMagnitude'] },
  'magnitude of shock on you': { names: ['SelfShockMagnitude'] },
  'magnitude of chill on you': { names: ['SelfChillMagnitude'] },
  'effect of lightning ailments': { names: ['ShockEffect'] },
  'effect of lightning ailments you inflict': { names: ['ShockEffect'] },
  'effect of cold ailments': { names: ['ChillEffect'] },
  'effect of cold ailments you inflict': { names: ['ChillEffect'] },
  'effect of fire ailments': { names: ['IgniteEffect'] },
  'effect of fire ailments you inflict': { names: ['IgniteEffect'] },
  'slowing potency of debuffs on you': { names: ['SlowPotencyOnSelf'] },
  'slow magnitude': { names: ['SlowMagnitude'] },
  'parried debuff magnitude': { names: ['ParryDebuffMagnitude'] },
  'parried debuff duration': { names: ['ParryDebuffDuration'] },
  'archon buff duration': { names: ['ArchonBuffDuration'] },
  'elemental infusion duration': { names: ['ElementalInfusionDuration'] },
  'mirage archer duration': { names: ['MirageArcherDuration'] },
  'warcry duration': { names: ['WarcryDuration'], keywordFlags: KeywordFlag.Warcry },
  'banner duration': { names: ['BannerDuration'] },
  'hazard duration': { names: ['HazardDuration'] },
  'movement speed penalty from using skills while moving': { names: ['MoveSpeedPenaltyReduction'] },
  'movement speed penalty from using skills': { names: ['MoveSpeedPenaltyReduction'] },
  'movement speed penalty while actively blocking': { names: ['MoveSpeedPenaltyReduction'] },
  'implicit modifier magnitudes': { names: ['ImplicitModEffect'] },
  'charm charges gained': { names: ['CharmChargesGained'] },
  'charm charges used': { names: ['CharmChargesUsed'] },
  'life flask charges gained': { names: ['LifeFlaskChargesGained'] },
  'mana flask charges gained': { names: ['ManaFlaskChargesGained'] },
  'to hinder enemies on hit': { names: ['HinderChance'] },
  'to hinder on hit': { names: ['HinderChance'] },
  'to double stun duration': { names: ['DoubleStunDurationChance'] },
  'to pierce an enemy': { names: ['PierceChance'], flags: ModFlag.Projectile },
  'to pierce enemies': { names: ['PierceChance'], flags: ModFlag.Projectile },
  'to apply incision': { names: ['IncisionChance'] },
  'to build an additional combo on hit': { names: ['ExtraComboChance'] },
  'to gain volatility on kill': { names: ['VolatilityOnKillChance'] },
  'to not consume charges': { names: ['FlaskChanceNotConsumeCharges'] },
  'to treat enemy monster elemental resistance values as inverted': { names: ['InvertEnemyEleResChance'] },
  'to chain an additional time': { names: ['ExtraChainChance'] },
  'maximum effect of shock': { names: ['ShockMaxEffect'] },
  'to ignite': { names: ['IgniteChance'] },
  'to ignite on hit': { names: ['IgniteChance'] },
  'chance to ignite': { names: ['IgniteChance'] },
  'to shock': { names: ['ShockChance'] },
  'to shock on hit': { names: ['ShockChance'] },
  'chance to shock': { names: ['ShockChance'] },
  'to freeze': { names: ['FreezeChance'] },
  'to freeze on hit': { names: ['FreezeChance'] },
  'chance to freeze': { names: ['FreezeChance'] },
  'to freeze, shock and ignite': { names: ['FreezeChance', 'ShockChance', 'IgniteChance'] },
  'to cause bleeding': { names: ['BleedChance'] },
  'to cause bleeding on hit': { names: ['BleedChance'] },
  'to inflict bleeding': { names: ['BleedChance'] },
  'to inflict bleeding on hit': { names: ['BleedChance'] },
  'to bleed': { names: ['BleedChance'] },
  'to poison': { names: ['PoisonChance'] },
  'to poison on hit': { names: ['PoisonChance'] },
  'to cause poison': { names: ['PoisonChance'] },
  'to inflict ailments': { names: ['AilmentChance'] },
  'chance to inflict ailments': { names: ['AilmentChance'] },
  'to electrocute': { names: ['ElectrocuteChance'] },
  'to impale enemies on hit': { names: ['ImpaleChance'] },
  'to impale on hit': { names: ['ImpaleChance'] },
  'to impale on attack hit': { names: ['ImpaleChance'], flags: ModFlag.Attack },
  'to impale on spell hit': { names: ['ImpaleChance'], flags: ModFlag.Spell },
  'to impale': { names: ['ImpaleChance'] },
  'impale effect': { names: ['ImpaleEffect'] },
  'effect of impales you inflict': { names: ['ImpaleEffect'] },
  'effect of impales inflicted': { names: ['ImpaleEffect'] },
  'impale duration': { names: ['ImpaleDuration'] },
  'to deal double damage': { names: ['DoubleDamageChance'] },
  'to deal triple damage': { names: ['TripleDamageChance'] },
  'to maim on hit': { names: ['MaimChance'] },
  'to blind enemies on hit': { names: ['BlindChance'] },
  'to blind on hit': { names: ['BlindChance'] },
  'to daze on hit': { names: ['DazeChance'] },
  'to inflict withered on hit': { names: ['WitherOnHitChance'] },
  'to knock enemies back on hit': { names: ['KnockbackChance'] },
  'to ignore enemy physical damage reduction': { names: ['EnemyPhysicalDamageReductionIgnoreChance'] },
  'to avoid being stunned': { names: ['AvoidStun'] },
  'to ignore stuns while casting': { names: ['IgnoreStunsWhileCasting'] },
  'to avoid elemental ailments': { names: ['AvoidElementalAilments'] },
  'to avoid ailments': { names: ['AvoidAilments'] },
  'to avoid bleeding': { names: ['AvoidBleed'] },
  'to avoid being poisoned': { names: ['AvoidPoison'] },
  'to avoid being impaled': { names: ['AvoidImpale'] },
  'to avoid being frozen': { names: ['AvoidFreeze'] },
  'to avoid being chilled': { names: ['AvoidChill'] },
  'to avoid being shocked': { names: ['AvoidShock'] },
  'to avoid being ignited': { names: ['AvoidIgnite'] },
  'duration of ailments on enemies': { names: ['AilmentDuration'] },
  'duration of ailments': { names: ['AilmentDuration'] },
  'duration of damaging ailments': { names: ['AilmentDuration'] },
  'duration of elemental ailments on enemies': { names: ['ElementalAilmentDuration'] },
  'duration of elemental ailments': { names: ['ElementalAilmentDuration'] },
  'duration of elemental ailments on you': { names: ['SelfElementalAilmentDuration'] },
  'elemental ailment duration on you': { names: ['SelfElementalAilmentDuration'] },
  'ignite duration': { names: ['IgniteDuration'] },
  'ignite duration on enemies': { names: ['IgniteDuration'] },
  'ignite duration on you': { names: ['SelfIgniteDuration'] },
  'bleeding duration': { names: ['BleedingDuration'] },
  'bleed duration': { names: ['BleedingDuration'] },
  'bleeding duration on you': { names: ['SelfBleedDuration'] },
  'bleed duration on you': { names: ['SelfBleedDuration'] },
  'daze duration': { names: ['DazeDuration'] },
  'poison duration': { names: ['PoisonDuration'] },
  'poison duration on enemies': { names: ['PoisonDuration'] },
  'poison duration on you': { names: ['SelfPoisonDuration'] },
  'shock duration': { names: ['ShockDuration'] },
  'shock duration on you': { names: ['SelfShockDuration'] },
  'chill duration': { names: ['ChillDuration'] },
  'chill duration on you': { names: ['SelfChillDuration'] },
  'freeze duration': { names: ['FreezeDuration'] },
  'freeze duration on you': { names: ['SelfFreezeDuration'] },
  'duration of freezes you inflict': { names: ['FreezeDuration'] },
  'duration of ignite, shock and chill': {
    names: ['IgniteDuration', 'ShockDuration', 'ChillDuration'],
  },
  'duration of ignite, shock and chill on enemies': {
    names: ['IgniteDuration', 'ShockDuration', 'ChillDuration'],
  },

  // --- Speed / Accuracy / Crit ---
  'movement speed': { names: ['MovementSpeed'] },
  'action speed': { names: ['ActionSpeed'] },
  'attack speed': { names: ['Speed'], flags: ModFlag.Attack },
  'melee attack speed': { names: ['Speed'], flags: ModFlag.Attack | ModFlag.Melee },
  'cast speed': { names: ['Speed'], flags: ModFlag.Spell },
  'attack and cast speed': {
    names: ['Speed', 'Speed'],
    perNameFlags: [ModFlag.Attack, ModFlag.Spell],
  },
  'skill speed': {
    names: ['Speed', 'Speed'],
    perNameFlags: [ModFlag.Attack, ModFlag.Spell],
  },
  'attack, cast and movement speed': {
    names: ['Speed', 'Speed', 'MovementSpeed'],
    perNameFlags: [ModFlag.Attack, ModFlag.Spell, 0],
  },
  'reload speed': { names: ['ReloadSpeed'], flags: ModFlag.Crossbow },
  'crossbow reload speed': { names: ['ReloadSpeed'], flags: ModFlag.Crossbow },
  'warcry speed': { names: ['WarcrySpeed'], keywordFlags: KeywordFlag.Warcry },
  'use speed': { names: ['UseSpeed'] },
  accuracy: { names: ['Accuracy'] },
  'accuracy rating': { names: ['Accuracy'] },
  'minion accuracy rating': {
    names: ['MinionAccuracy'],
    keywordFlags: KeywordFlag.Minion,
    actorScope: 'minion',
  },
  'critical strike chance': { names: ['CritChance'], baseNames: ['BaseCritChance'] },
  'critical hit chance': { names: ['CritChance'], baseNames: ['BaseCritChance'] },
  'attack critical strike chance': {
    names: ['CritChance'],
    baseNames: ['BaseCritChance'],
    flags: ModFlag.Attack,
  },
  'attack critical hit chance': {
    names: ['CritChance'],
    baseNames: ['BaseCritChance'],
    flags: ModFlag.Attack,
  },
  'melee critical strike chance': {
    names: ['CritChance'],
    baseNames: ['BaseCritChance'],
    flags: ModFlag.Melee,
  },
  'spell critical strike chance': {
    names: ['CritChance'],
    baseNames: ['BaseCritChance'],
    flags: ModFlag.Spell,
  },
  'spell critical hit chance': {
    names: ['CritChance'],
    baseNames: ['BaseCritChance'],
    flags: ModFlag.Spell,
  },
  'ballista critical hit chance': {
    names: ['CritChance'],
    baseNames: ['BaseCritChance'],
    keywordFlags: KeywordFlag.Totem,
  },
  'critical strike multiplier': { names: ['CritMultiplier'] },
  'attack critical strike multiplier': { names: ['CritMultiplier'], flags: ModFlag.Attack },
  'melee critical strike multiplier': { names: ['CritMultiplier'], flags: ModFlag.Melee },
  'spell critical strike multiplier': { names: ['CritMultiplier'], flags: ModFlag.Spell },
  'critical damage bonus': {
    names: ['CritDamageBonusInc'],
    baseNames: ['CritDamageBonusFlat'],
  },
  'critical spell damage bonus': {
    names: ['CritDamageBonusInc'],
    baseNames: ['CritDamageBonusFlat'],
    flags: ModFlag.Spell,
  },
  'critical damage bonus for attack damage': {
    names: ['CritDamageBonusInc'],
    baseNames: ['CritDamageBonusFlat'],
    flags: ModFlag.Attack,
  },
  'ballista critical damage bonus': {
    names: ['CritDamageBonusInc'],
    baseNames: ['CritDamageBonusFlat'],
    keywordFlags: KeywordFlag.Totem,
  },
  'thorns critical damage bonus': {
    names: ['ThornsCritDamageBonus'],
  },

  // --- Reservation / Cost / Cooldown / AoE / Duration ---
  'mana reservation efficiency': { names: ['ManaReservationEfficiency'] },
  'mana reservation efficiency of skills': { names: ['ManaReservationEfficiency'] },
  'reservation efficiency': { names: ['ManaReservationEfficiency'] },
  'reservation efficiency of skills': { names: ['ManaReservationEfficiency'] },
  'life reservation efficiency': { names: ['LifeReservationEfficiency'] },
  'life reservation efficiency of skills': { names: ['LifeReservationEfficiency'] },
  'spirit reservation efficiency': { names: ['SpiritReservationEfficiency'] },
  'spirit reservation efficiency of skills': { names: ['SpiritReservationEfficiency'] },
  'mana reservation': { names: ['ManaReserved'] },
  'mana reserved': { names: ['ManaReserved'] },
  'mana reservation of skills': { names: ['ManaReserved'] },
  'life reservation': { names: ['LifeReserved'] },
  'life reserved': { names: ['LifeReserved'] },
  'reservation of skills': { names: ['ManaReserved'] },
  reservation: { names: ['ManaReserved'] },
  'cost of skills': { names: ['SkillCost'] },
  'skill cost': { names: ['SkillCost'] },
  'total cost': { names: ['SkillCost'] },
  'mana cost': { names: ['ManaCost'] },
  'mana cost of skills': { names: ['ManaCost'] },
  'total mana cost': { names: ['ManaCost'] },
  'total mana cost of skills': { names: ['ManaCost'] },
  'life cost': { names: ['LifeCost'] },
  'life cost of skills': { names: ['LifeCost'] },
  'cost efficiency': { names: ['CostEfficiency'] },
  'cost efficiency of skills': { names: ['CostEfficiency'] },
  'mana cost efficiency': { names: ['ManaCostEfficiency'] },
  'mana cost efficiency of skills': { names: ['ManaCostEfficiency'] },
  'cooldown recovery': { names: ['CooldownRecovery'] },
  'cooldown recovery rate': { names: ['CooldownRecovery'] },
  'cooldown recovery speed': { names: ['CooldownRecovery'] },
  'cooldown use': { names: ['AdditionalCooldownUses'] },
  'cooldown uses': { names: ['AdditionalCooldownUses'] },
  'warcry cooldown recovery rate': { names: ['CooldownRecovery'], keywordFlags: KeywordFlag.Warcry },
  'grenade detonation time': { names: ['GrenadeDetonationTime'] },
  'aftershock area of effect': { names: ['AftershockAreaOfEffect'] },
  'area of effect': { names: ['AreaOfEffect'] },
  'area of effect of skills': { names: ['AreaOfEffect'] },
  'presence area of effect': { names: ['PresenceAreaOfEffect'] },
  'hazard area of effect': {
    names: ['AreaOfEffect'],
    tags: [{ type: 'SkillType', skillType: 'Hazard' }],
  },
  'grenade area of effect': {
    names: ['AreaOfEffect'],
    tags: [{ type: 'SkillType', skillType: 'Grenade' }],
  },
  duration: { names: ['Duration'] },
  'skill effect duration': { names: ['Duration'] },
  'curse duration': { names: ['Duration'], keywordFlags: KeywordFlag.Curse },
  'hex duration': { names: ['Duration'], keywordFlags: KeywordFlag.Curse },
  'minion duration': { names: ['MinionDuration'], keywordFlags: KeywordFlag.Minion },
  'totem duration': { names: ['TotemDuration'], keywordFlags: KeywordFlag.Totem },
  'trap duration': { names: ['TrapDuration'], keywordFlags: KeywordFlag.Trap },
  'mine duration': { names: ['MineDuration'], keywordFlags: KeywordFlag.Mine },
  'fortification duration': { names: ['FortifyDuration'] },
  'projectile speed': { names: ['ProjectileSpeed'], flags: ModFlag.Projectile },
  'bolt speed': { names: ['ProjectileSpeed'], flags: ModFlag.Projectile | ModFlag.Crossbow },
  'arrow speed': { names: ['ProjectileSpeed'], flags: ModFlag.Projectile | ModFlag.Bow },
  'melee strike range': { names: ['MeleeWeaponRange'] },
  'metres to melee strike range': { names: ['MeleeWeaponRange'] },
  'metre to melee strike range': { names: ['MeleeWeaponRange'] },
  'weapon range': { names: ['WeaponRange'] },
  'metres to weapon range': { names: ['WeaponRange'] },
  'metre to weapon range': { names: ['WeaponRange'] },
  'parry range': { names: ['ParryRange'] },

  // --- Aura / Curse / Flask / Buff Effects ---
  'aura effect': { names: ['AuraEffect'] },
  'aura magnitude': { names: ['AuraEffect'] },
  'aura magnitudes': { names: ['AuraEffect'] },
  'effect of non-curse auras from your skills': { names: ['AuraEffect'] },
  'effect of non-curse auras you cast': { names: ['AuraEffect'] },
  'effect of non-curse auras': { names: ['AuraEffect'] },
  'effect of auras on you': { names: ['AuraEffectOnSelf'] },
  'effect on you': { names: ['EffectOnSelf'] },
  'effect of auras from mines': { names: ['AuraEffect'], keywordFlags: KeywordFlag.Mine },
  'curse effect': { names: ['CurseEffect'] },
  'curse magnitude': { names: ['CurseEffect'] },
  'curse magnitudes': { names: ['CurseEffect'] },
  'effect of curses': { names: ['CurseEffect'] },
  'effect of your curses': { names: ['CurseEffect'] },
  'effect of curses on them': { names: ['CurseEffect'] },
  'effect of curses on you': { names: ['CurseEffectOnSelf'] },
  'effect of your marks': { names: ['MarkEffect'] },
  'effect of your mark skills': { names: ['MarkEffect'] },
  'effect of marks': { names: ['MarkEffect'] },
  'effect of offerings': { names: ['OfferingEffect'] },
  'effect of flasks': { names: ['FlaskEffect'] },
  'flask effect': { names: ['FlaskEffect'] },
  'flask effect duration': { names: ['FlaskDuration'] },
  'charm effect duration': { names: ['CharmDuration'] },
  'flask charges gained': { names: ['FlaskChargesGained'] },
  'flask charges used': { names: ['FlaskChargesUsed'] },
  'charges per use': { names: ['FlaskChargesUsed'] },
  'charges used': { names: ['FlaskChargesUsed'] },
  'charge recovery': { names: ['FlaskChargeRecovery'] },
  'amount recovered': { names: ['FlaskRecovery'] },
  'recovery rate': { names: ['FlaskRecoveryRate'] },
  'flask recovery rate': { names: ['FlaskRecoveryRate'] },
  'recovery from flasks': { names: ['FlaskRecovery'] },
  'life recovery from flasks': { names: ['FlaskLifeRecovery'] },
  'mana recovery from flasks': { names: ['FlaskManaRecovery'] },
  'life and mana recovery from flasks': { names: ['FlaskLifeRecovery', 'FlaskManaRecovery'] },
  'flask life recovery rate': { names: ['FlaskLifeRecoveryRate'] },
  'flask mana recovery rate': { names: ['FlaskManaRecoveryRate'] },
  'effect of tinctures': { names: ['TinctureEffect'] },
  'mana burn rate': { names: ['TinctureManaBurnRate'] },
  'warcry buff effect': { names: ['WarcryBuffEffect'], keywordFlags: KeywordFlag.Warcry },
  'buff effect': { names: ['BuffEffect'] },
  'effect of buffs on you': { names: ['BuffEffectOnSelf'] },
  'effect of herald buffs on you': { names: ['HeraldBuffEffect'] },
  'effect of arcane surge on you': { names: ['ArcaneSurgeEffect'] },
  'effect of onslaught on you': { names: ['OnslaughtEffect'] },
  'effect of tailwind on you': { names: ['TailwindEffect'] },
  'effect of elusive on you': { names: ['ElusiveEffect'] },
  'elusive effect': { names: ['ElusiveEffect'] },
  'effect of cruelty': { names: ['CrueltyEffect'] },
  'effect of archon buffs on you': { names: ['ArchonBuffEffect'] },
  'effect of puppet master': { names: ['PuppetMasterEffect'] },
  'effect of fully broken armour': { names: ['FullyBrokenArmourEffect'] },
  'effect of small passive skills': { names: ['SmallPassiveEffect'] },
  'bonuses gained from equipped quiver': { names: ['QuiverEffect'] },
  'bonus gained from equipped quiver': { names: ['QuiverEffect'] },
  'bonuses gained from equipped amulet': { names: ['AmuletEffect'] },
  'bonus gained from equipped amulet': { names: ['AmuletEffect'] },
  'bonuses gained from equipped focus': { names: ['EffectOfBonusesFromFocus'] },
  'bonus gained from equipped focus': { names: ['EffectOfBonusesFromFocus'] },
  'effect of socketed jewels': { names: ['SocketedJewelEffect'] },
  'effect of buffs granted by your golems': { names: ['GolemBuffEffect'] },
  'effect of consecrated ground you create': { names: ['ConsecratedGroundEffect'] },
  'exposure effect': { names: ['ExposureEffect'] },
  'blind effect': { names: ['BlindEffect'] },
  effect: { names: ['LocalEffect'] },
  magnitude: { names: ['LocalMagnitude'] },
  magnitudes: { names: ['LocalMagnitude'] },

  // --- Charges & Rage ---
  'maximum power charge': { names: ['MaxPowerCharges'] },
  'maximum power charges': { names: ['MaxPowerCharges'] },
  'minimum power charge': { names: ['MinPowerCharges'] },
  'minimum power charges': { names: ['MinPowerCharges'] },
  'maximum frenzy charge': { names: ['MaxFrenzyCharges'] },
  'maximum frenzy charges': { names: ['MaxFrenzyCharges'] },
  'minimum frenzy charge': { names: ['MinFrenzyCharges'] },
  'minimum frenzy charges': { names: ['MinFrenzyCharges'] },
  'maximum endurance charge': { names: ['MaxEnduranceCharges'] },
  'maximum endurance charges': { names: ['MaxEnduranceCharges'] },
  'minimum endurance charge': { names: ['MinEnduranceCharges'] },
  'minimum endurance charges': { names: ['MinEnduranceCharges'] },
  'maximum power charges and maximum endurance charges': {
    names: ['MaxPowerCharges', 'MaxEnduranceCharges'],
  },
  'maximum frenzy charges and maximum power charges': {
    names: ['MaxFrenzyCharges', 'MaxPowerCharges'],
  },
  'maximum endurance, frenzy and power charges': {
    names: ['MaxEnduranceCharges', 'MaxFrenzyCharges', 'MaxPowerCharges'],
  },
  'power charge duration': { names: ['PowerChargeDuration'] },
  'frenzy charge duration': { names: ['FrenzyChargeDuration'] },
  'endurance charge duration': { names: ['EnduranceChargeDuration'] },
  'charge duration': { names: ['ChargeDuration'] },
  'maximum rage': { names: ['MaximumRage'] },
  'minimum rage': { names: ['MinimumRage'] },
  'rage effect': { names: ['RageEffect'] },
  'maximum fortification': { names: ['MaxFortification'] },
  'maximum valour': { names: ['MaxValour'] },
  'maximum intensity': { names: ['MaxIntensity'] },
  'maximum number of seals': { names: ['MaxUnleashSeals'] },

  // --- Totem / Trap / Mine / Minion Limits & Utility ---
  'totem placement speed': { names: ['TotemPlacementSpeed'], keywordFlags: KeywordFlag.Totem },
  'totem placement range': { names: ['TotemPlacementRange'], keywordFlags: KeywordFlag.Totem },
  'totem life': { names: ['TotemLife'], keywordFlags: KeywordFlag.Totem },
  'trap throwing speed': { names: ['TrapThrowingSpeed'], keywordFlags: KeywordFlag.Trap },
  'mine throwing speed': { names: ['MineThrowingSpeed'], keywordFlags: KeywordFlag.Mine },
  'mine laying speed': { names: ['MineThrowingSpeed'], keywordFlags: KeywordFlag.Mine },
  'trap and mine throwing speed': {
    names: ['TrapThrowingSpeed', 'MineThrowingSpeed'],
    keywordFlags: KeywordFlag.Trap | KeywordFlag.Mine,
  },
  'detonation speed': { names: ['MineDetonationSpeed'], keywordFlags: KeywordFlag.Mine },
  'trap trigger area of effect': { names: ['TrapTriggerAreaOfEffect'], keywordFlags: KeywordFlag.Trap },
  'brand attachment range': { names: ['BrandAttachmentRange'] },
  'brand activation frequency': { names: ['BrandActivationFrequency'] },
  'maximum number of summoned totems': { names: ['ActiveTotemLimit'] },
  'maximum number of summoned ballista totems': { names: ['ActiveBallistaTotemsLimit'] },
  'maximum number of summoned golems': { names: ['ActiveGolemLimit'] },
  'maximum number of golems': { names: ['ActiveGolemLimit'] },
  'maximum number of raised zombies': { names: ['ActiveZombieLimit'] },
  'maximum number of zombies': { names: ['ActiveZombieLimit'] },
  'maximum number of summoned skeletons': { names: ['ActiveSkeletonLimit'] },
  'maximum number of skeletons': { names: ['ActiveSkeletonLimit'] },
  'maximum number of spectres': { names: ['ActiveSpectreLimit'] },
  'maximum number of raised spectres': { names: ['ActiveSpectreLimit'] },
  'maximum number of summoned raging spirits': { names: ['ActiveRagingSpiritLimit'] },
  'maximum number of raging spirits': { names: ['ActiveRagingSpiritLimit'] },

  // --- Stun / Buildup / Threshold / Misc ---
  'stun recovery': { names: ['StunRecovery'] },
  'stun and block recovery': { names: ['StunRecovery'] },
  'block and stun recovery': { names: ['StunRecovery'] },
  'block recovery': { names: ['BlockRecovery'] },
  'stun threshold': { names: ['StunThreshold'] },
  'ailment threshold': { names: ['AilmentThreshold'] },
  'elemental ailment threshold': { names: ['AilmentThreshold'] },
  'freeze threshold': { names: ['FreezeThreshold'] },
  'enemy stun threshold': { names: ['EnemyStunThreshold'] },
  'stun duration': { names: ['EnemyStunDuration'] },
  'stun duration on enemies': { names: ['EnemyStunDuration'] },
  'stun buildup': { names: ['StunBuildup'] },
  'freeze buildup': { names: ['FreezeBuildup'] },
  'pin buildup': { names: ['PinBuildup'] },
  'electrocute buildup': { names: ['ElectrocuteBuildup'] },
  'immobilisation buildup': { names: ['ImmobilisationBuildup'] },
  'knockback distance': { names: ['KnockbackDistance'] },
  'light radius': { names: ['LightRadius'] },
  'character size': { names: ['CharacterSize'] },
  'rarity of items found': { names: ['LootRarity'] },
  'item rarity': { names: ['LootRarity'] },
  'quantity of items found': { names: ['LootQuantity'] },
  'item quantity': { names: ['LootQuantity'] },
  'passive skill points': { names: ['ExtraPoints'] },
  'passive skill point': { names: ['ExtraPoints'] },
  'seconds to cooldown': { names: ['CooldownFlat'] },
  'second to cooldown': { names: ['CooldownFlat'] },
  'energy': { names: ['MetaEnergyGain'] },
  'glory generation': { names: ['GloryGeneration'] },
  'experience gain of gems': { names: ['GemExperienceGain'] },
  'projectile range': { names: ['ProjectileRange'] },
  'maximum quality': { names: ['ItemMaxQuality'] },
};

// ============================================================================
// Actor Scope Stat Name Remappers
// ============================================================================

const MINION_STAT_REMAP: Readonly<Record<string, string>> = {
  Damage: 'MinionDamage',
  Speed: 'MinionSpeed',
  Life: 'MinionLife',
  CritChance: 'MinionCritChance',
  BaseCritChance: 'MinionBaseCritChance',
  CritMultiplier: 'MinionCritMultiplier',
  CritDamageBonusInc: 'MinionCritDamageBonusInc',
  CritDamageBonusFlat: 'MinionCritDamageBonusFlat',
  Accuracy: 'MinionAccuracy',
  MovementSpeed: 'MinionMovementSpeed',
  AreaOfEffect: 'MinionAreaOfEffect',
  Armour: 'MinionArmour',
  Evasion: 'MinionEvasion',
  EnergyShield: 'MinionEnergyShield',
  FireResist: 'MinionFireResist',
  ColdResist: 'MinionColdResist',
  LightningResist: 'MinionLightningResist',
  ChaosResist: 'MinionChaosResist',
  FireResistMax: 'MinionFireResistMax',
  ColdResistMax: 'MinionColdResistMax',
  LightningResistMax: 'MinionLightningResistMax',
  ChaosResistMax: 'MinionChaosResistMax',
  CooldownRecovery: 'MinionCooldownRecovery',
  Duration: 'MinionDuration',
  LifeRegen: 'MinionLifeRegen',
  LifeRegenPercent: 'MinionLifeRegenPercent',
  PhysDamageReduction: 'MinionPhysDamageReduction',
  BlockChance: 'MinionBlockChance',
  LifeLeech: 'MinionLifeLeech',
};

const ENEMY_TAKEN_REMAP: Readonly<Record<string, string>> = {
  Damage: 'EnemyDamageTaken',
  PhysicalDamage: 'EnemyPhysicalDamageTaken',
  ChaosDamage: 'EnemyChaosDamageTaken',
  FireDamage: 'EnemyFireDamageTaken',
  ColdDamage: 'EnemyColdDamageTaken',
  LightningDamage: 'EnemyLightningDamageTaken',
  ElementalDamage: 'EnemyElementalDamageTaken',
  DotDamage: 'EnemyDotDamageTaken',
};

const PLAYER_TAKEN_REMAP: Readonly<Record<string, string>> = {
  Damage: 'DamageTaken',
  PhysicalDamage: 'PhysicalDamageTaken',
  FireDamage: 'FireDamageTaken',
  ColdDamage: 'ColdDamageTaken',
  LightningDamage: 'LightningDamageTaken',
  ChaosDamage: 'ChaosDamageTaken',
  ElementalDamage: 'ElementalDamageTaken',
  DotDamage: 'DamageTakenOverTime',
};

export function remapStatNameForScope(
  statName: string,
  actorScope: ActorScope,
  modSuffix?: 'Taken' | 'Dealt',
  slotScope?: SlotScope,
  subjectHint?: SubjectHint,
): string {
  // Subject hints resolve ambiguous stems like "Effect" / "Duration" / "Magnitude"
  if (subjectHint) {
    if (statName === 'LocalEffect' || statName === 'LocalMagnitude') {
      switch (subjectHint) {
        case 'flask':
          return 'FlaskEffect';
        case 'charm':
          return 'CharmEffect';
        case 'tincture':
          return 'TinctureEffect';
        case 'aura':
          return 'AuraEffect';
        case 'curse':
          return 'CurseEffect';
        case 'mark':
          return 'MarkEffect';
        case 'offering':
          return 'OfferingEffect';
        case 'banner':
          return 'BannerAuraEffect';
        case 'warcry':
          return 'WarcryBuffEffect';
        default:
          break;
      }
    }
    if (statName === 'EffectOnSelf' && subjectHint === 'aura') {
      return 'AuraEffectOnSelf';
    }
  }

  // Equipment slot defence scaling ("60% increased Energy Shield from Equipped Shield")
  if (slotScope) {
    if (
      statName === 'Armour' ||
      statName === 'Evasion' ||
      statName === 'EnergyShield' ||
      statName === 'Ward'
    ) {
      return `${statName}From${slotScope}`;
    }
  }

  if (actorScope === 'minion') {
    if (statName.startsWith('Minion')) return statName;
    return MINION_STAT_REMAP[statName] ?? `Minion${statName}`;
  }

  if (actorScope === 'companion') {
    return statName.startsWith('Companion') ? statName : `Companion${statName}`;
  }

  if (actorScope === 'ally') {
    return statName.startsWith('Ally') ? statName : `Ally${statName}`;
  }

  if (actorScope === 'totem') {
    if (statName === 'Damage' || statName === 'Speed') return statName;
    return statName.startsWith('Totem') ? statName : `Totem${statName}`;
  }

  if (actorScope === 'enemy') {
    if (modSuffix === 'Taken') {
      if (ENEMY_TAKEN_REMAP[statName]) return ENEMY_TAKEN_REMAP[statName]!;
      return statName.startsWith('Enemy')
        ? statName.endsWith('Taken')
          ? statName
          : `${statName}Taken`
        : `Enemy${statName}Taken`;
    }
    if (modSuffix === 'Dealt') {
      return statName.startsWith('Enemy') ? `${statName}Dealt` : `Enemy${statName}Dealt`;
    }
    if (statName === 'BaseCritChance' || statName === 'CritChance') return 'EnemyCritChance';
    if (statName === 'CurseEffect') return 'CurseEffect';
    return statName.startsWith('Enemy') ? statName : `Enemy${statName}`;
  }

  if (modSuffix === 'Taken') {
    return (
      PLAYER_TAKEN_REMAP[statName] ??
      (statName.includes('Taken') ? statName : `${statName}Taken`)
    );
  }

  return statName;
}
