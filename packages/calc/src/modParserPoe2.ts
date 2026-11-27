import { KeywordFlag, ModFlag, type Mod, type ModType } from '@webpob/core';

export interface Poe2ParserRule {
  pattern: RegExp;
  build: (match: RegExpMatchArray, source: string) => Mod[];
}

function mkMod(
  name: string,
  type: ModType,
  value: number | boolean | string,
  source: string,
  flags = 0,
  keywordFlags = 0,
): Mod {
  return { name, type, value, flags, keywordFlags, source };
}

function signedVal(amount: string, kind: string): { type: ModType; value: number } {
  const n = Number(amount);
  const k = kind.toLowerCase();
  if (k === 'reduced') return { type: 'INC', value: -n };
  if (k === 'less') return { type: 'MORE', value: -n };
  if (k === 'more') return { type: 'MORE', value: n };
  return { type: 'INC', value: n };
}

function weaponToFlag(weapon: string): number {
  const w = weapon.toLowerCase();
  if (w.includes('two handed') || w.includes('two-handed')) return ModFlag.Weapon2H;
  if (w.includes('one handed') || w.includes('one-handed')) return ModFlag.Weapon1H;
  if (w.includes('quartersta')) return ModFlag.Quarterstaff;
  if (w.includes('crossbow')) return ModFlag.Crossbow;
  if (w.includes('bow')) return ModFlag.Bow;
  if (w.includes('mace') || w.includes('flail')) return ModFlag.Mace;
  if (w.includes('sta')) return ModFlag.Staff;
  if (w.includes('wand')) return ModFlag.Wand;
  if (w.includes('sword')) return ModFlag.Sword;
  if (w.includes('axe')) return ModFlag.Axe;
  if (w.includes('dagger')) return ModFlag.Dagger;
  if (w.includes('claw')) return ModFlag.Claw;
  if (w.includes('spear')) return ModFlag.Attack;
  return ModFlag.Attack;
}

function elementToKeyword(el?: string): number {
  if (!el) return 0;
  switch (el.toLowerCase()) {
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
    case 'elemental':
      return KeywordFlag.Fire | KeywordFlag.Cold | KeywordFlag.Lightning;
    default:
      return 0;
  }
}

function normalizeSlotName(slot: string): string {
  return slot.replace(/\s+/g, '');
}

/**
 * PoE 2 Keystones, Ascendancies, and high-frequency passive/item/jewel modifier rules.
 * Appended to `PARSER_RULES` in `modParser.ts` without disturbing PoE 1 rules.
 */
export const POE2_EXTRA_MOD_RULES: readonly Poe2ParserRule[] = [
  // =========================================================================
  // 1. P0 PoE 2 Keystones (exact wording from poe2-tree-0_5.json)
  // =========================================================================

  // Chaos Inoculation (PoE 2 two-line wording)
  {
    pattern: /^Maximum Life is 1$/i,
    build: (_, src) => [mkMod('Life', 'OVERRIDE', 1, src)],
  },
  {
    pattern: /^Immune to Chaos Damage and Bleeding$/i,
    build: (_, src) => [
      mkMod('ChaosImmune', 'FLAG', true, src),
      mkMod('BleedImmune', 'FLAG', true, src),
    ],
  },

  // Blood Magic (PoE 2 wording)
  {
    pattern: /^You have no Mana$/i,
    build: (_, src) => [
      mkMod('Mana', 'OVERRIDE', 0, src),
      mkMod('BloodMagic', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^Skill Mana Costs Converted to Life Costs$/i,
    build: (_, src) => [
      mkMod('BloodMagic', 'FLAG', true, src),
      mkMod('ManaCostConvertToLife', 'BASE', 100, src),
    ],
  },

  // Mind Over Matter (PoE 2 wording)
  {
    pattern: /^All Damage is taken from Mana before Life$/i,
    build: (_, src) => [mkMod('DamageTakenFromManaBeforeLife', 'BASE', 100, src)],
  },

  // Eldritch Battery (PoE 2: converts ES -> Mana)
  {
    pattern: /^Convert (\d+)% of maximum Energy Shield to maximum Mana$/i,
    build: (m, src) => [
      mkMod('Poe2EldritchBattery', 'FLAG', true, src),
      mkMod('EsConvertToMana', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^Mana Costs are Doubled$/i,
    build: (_, src) => [mkMod('ManaCost', 'MORE', 100, src)],
  },

  // Resolute Technique (PoE 2 wording)
  {
    pattern: /^Never deal Critical Hits$/i,
    build: (_, src) => [mkMod('NeverCrit', 'FLAG', true, src)],
  },
  {
    pattern: /^Accuracy Rating is Doubled$/i,
    build: (_, src) => [mkMod('Accuracy', 'MORE', 100, src)],
  },

  // Pain Attunement (PoE 2: Critical Damage Bonus on Low/Full Life)
  {
    pattern: /^(\d+)% more Critical Damage Bonus when on Low Life$/i,
    build: (m, src) => [
      mkMod('CritDamageBonusLowLifeMore', 'BASE', Number(m[1]), src),
      mkMod('PainAttunement', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^(\d+)% less Critical Damage Bonus when on Full Life$/i,
    build: (m, src) => [mkMod('CritDamageBonusFullLifeMore', 'BASE', -Number(m[1]), src)],
  },

  // Avatar of Fire (PoE 2: 75% of all Damage Converted to Fire Damage)
  {
    pattern: /^(\d+)% of Damage Converted to (Fire|Cold|Lightning|Chaos) Damage$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      const target = m[2]!;
      const mods: Mod[] = [];
      for (const el of ['Physical', 'Fire', 'Cold', 'Lightning', 'Chaos']) {
        if (el !== target) {
          mods.push(mkMod(`${el}DamageConvertTo${target}`, 'BASE', v, src));
        }
      }
      return mods;
    },
  },

  // Spectral Ward (PoE 2 wording: "Item Evasion")
  {
    pattern: /^\+(\d+) to Maximum Energy Shield per (\d+) Item Evasion on Equipped Body Armour$/i,
    build: (m, src) => [mkMod('EsPerBodyEvasion', 'BASE', Number(m[1]) / Number(m[2]), src)],
  },

  // Zealot's Oath
  {
    pattern: /^Excess Life Recovery from Regeneration is applied to Energy Shield$/i,
    build: (_, src) => [mkMod('ZealotsOath', 'FLAG', true, src)],
  },
  {
    pattern: /^Energy Shield does not Recharge$/i,
    build: (_, src) => [mkMod('NoEsRecharge', 'FLAG', true, src)],
  },

  // Giant's Blood
  {
    pattern: /^You can wield Two-Handed Axes, Maces and Swords in one hand$/i,
    build: (_, src) => [mkMod('GiantsBlood', 'FLAG', true, src)],
  },
  {
    pattern: /^Triple Attribute requirements of Martial Weapons$/i,
    build: (_, src) => [mkMod('MartialWeaponAttrReq', 'MORE', 200, src)],
  },
  {
    pattern: /^Inherent Life granted by Strength is halved$/i,
    build: (_, src) => [mkMod('StrLifeHalved', 'FLAG', true, src)],
  },

  // Acrobatics
  {
    pattern: /^(?:Acrobatics|You can Evade all Hits)$/i,
    build: (_, src) => [mkMod('Acrobatics', 'FLAG', true, src)],
  },

  // Eternal Youth
  {
    pattern: /^Life Recharges instead of Energy Shield$/i,
    build: (_, src) => [mkMod('EternalYouth', 'FLAG', true, src)],
  },

  // Kaom's Heart (PoE 2): You have no Spirit
  {
    pattern: /^You have no Spirit$/i,
    build: (_, src) => [mkMod('ZeroSpirit', 'FLAG', true, src)],
  },

  // Witchhunter Obsessive Rituals: 50% less Armour and Evasion Rating
  {
    pattern: /^(\d+)% (less|more) Armour and Evasion(?: Rating)?$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      return [mkMod('Armour', 'MORE', val, src), mkMod('Evasion', 'MORE', val, src)];
    },
  },

  // Whispers of Doom
  {
    pattern: /^You can apply an additional Curse$/i,
    build: (_, src) => [
      mkMod('WhispersOfDoom', 'FLAG', true, src),
      mkMod('EnemyCurseLimit', 'BASE', 1, src),
    ],
  },
  {
    pattern: /^Double Activation Delay of Curses$/i,
    build: (_, src) => [mkMod('CurseActivationDelay', 'MORE', 100, src)],
  },

  // Ancestral Bond
  {
    pattern: /^Your Totem Limit is doubled$/i,
    build: (_, src) => [
      mkMod('AncestralBond', 'FLAG', true, src),
      mkMod('ActiveTotemLimit', 'MORE', 100, src),
    ],
  },
  {
    pattern: /^No Charge requirement for placing Totems$/i,
    build: (_, src) => [mkMod('TotemNoChargeReq', 'FLAG', true, src)],
  },
  {
    pattern: /^Totems reserve (\d+) Spirit each$/i,
    build: (m, src) => [mkMod('TotemSpiritReservation', 'BASE', Number(m[1]), src)],
  },

  // Additional PoE 2 Keystones (Crimson Assault, Unwavering Stance, Glancing Blows, Oasis, Vaal Pact, etc.)
  {
    pattern: /^Bleeding you inflict is Aggravated$/i,
    build: (_, src) => [
      mkMod('CrimsonAssault', 'FLAG', true, src),
      mkMod('AggravatedBleed', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^Base Bleeding Duration is (\d+(?:\.\d+)?) seconds?$/i,
    build: (m, src) => [mkMod('BleedBaseDuration', 'OVERRIDE', Number(m[1]), src)],
  },
  {
    pattern: /^Cannot be Light Stunned$/i,
    build: (_, src) => [
      mkMod('UnwaveringStance', 'FLAG', true, src),
      mkMod('CannotBeLightStunned', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^Cannot Dodge Roll or Sprint$/i,
    build: (_, src) => [mkMod('CannotDodgeRoll', 'FLAG', true, src)],
  },
  {
    pattern: /^Chance to Evade is Unlucky$/i,
    build: (_, src) => [
      mkMod('GlancingBlows', 'FLAG', true, src),
      mkMod('EvadeChanceUnlucky', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^Chance to Deflect is Lucky$/i,
    build: (_, src) => [mkMod('DeflectChanceLucky', 'FLAG', true, src)],
  },
  {
    pattern: /^Cannot use Charms$/i,
    build: (_, src) => [
      mkMod('Oasis', 'FLAG', true, src),
      mkMod('CannotUseCharms', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) Recovery from Flasks$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('FlaskRecovery', type, value, src)];
    },
  },
  {
    pattern: /^Cannot Recover Life other than from Leech$/i,
    build: (_, src) => [
      mkMod('VaalPact', 'FLAG', true, src),
      mkMod('CannotRecoverLifeOtherThanLeech', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^Life Leech effects are not removed when Unreserved Life is Filled$/i,
    build: (_, src) => [mkMod('Overleech', 'FLAG', true, src)],
  },
  {
    pattern: /^Leech Life (\d+)% (faster|slower|more quickly|less quickly)$/i,
    build: (m, src) => {
      const k = m[2]!.toLowerCase();
      const v = Number(m[1]);
      if (k === 'more quickly') return [mkMod('LifeLeechSpeed', 'MORE', v, src)];
      if (k === 'less quickly') return [mkMod('LifeLeechSpeed', 'MORE', -v, src)];
      return [mkMod('LifeLeechSpeed', 'INC', k === 'slower' ? -v : v, src)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) Maximum Rage$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('MaximumRage', type, value, src)];
    },
  },
  {
    pattern: /^Regenerate (\d+) Rage per second per (\d+) Rage spent Recently$/i,
    build: (m, src) => [mkMod('RageRegenPerRageSpent', 'BASE', Number(m[1]) / Number(m[2]), src)],
  },
  {
    pattern: /^No Rage effect$/i,
    build: (_, src) => [
      mkMod('PrimalHunger', 'FLAG', true, src),
      mkMod('NoRageEffect', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^Fire Spells Convert (\d+)% of Fire Damage to Chaos Damage$/i,
    build: (m, src) => [
      mkMod('BlackflameCovenant', 'FLAG', true, src),
      mkMod('FireDamageConvertToChaos', 'BASE', Number(m[1]), src, ModFlag.Spell, KeywordFlag.Fire),
    ],
  },
  {
    pattern: /^Chaos Damage from Fire Spells Contributes to Flammability and Ignite Magnitudes$/i,
    build: (_, src) => [mkMod('ChaosContributesToIgnite', 'FLAG', true, src)],
  },
  {
    pattern: /^Ignite inflicted with Fire Spells deals Chaos Damage instead of Fire Damage$/i,
    build: (_, src) => [mkMod('IgniteDealsChaosDamage', 'FLAG', true, src)],
  },
  {
    pattern: /^Gain (Power|Frenzy|Endurance) Charges instead of (Power|Frenzy|Endurance) Charges$/i,
    build: (m, src) => [
      mkMod('Resonance', 'FLAG', true, src),
      mkMod(`Gain${m[1]}InsteadOf${m[2]}`, 'FLAG', true, src),
    ],
  },
  {
    pattern: /^You can have two Companions of different types$/i,
    build: (_, src) => [
      mkMod('TrustedKinship', 'FLAG', true, src),
      mkMod('MaxCompanions', 'OVERRIDE', 2, src),
    ],
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) Reservation Efficiency of (Companion|non-Companion|Herald|Aura|Minion) Skills$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod(`${m[3]!.replace(/[^A-Za-z]/g, '')}ReservationEfficiency`, type, value, src)];
    },
  },
  {
    pattern: /^Non-Minion Skills have (\d+)% (increased|reduced|more|less) Reservation Efficiency$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('NonMinionReservationEfficiency', type, value, src)];
    },
  },
  {
    pattern: /^You can equip a non-Unique Sceptre while wielding a Talisman$/i,
    build: (_, src) => [mkMod('LordOfTheWilds', 'FLAG', true, src)],
  },
  {
    pattern: /^Dodge Roll cannot Avoid Damage$/i,
    build: (_, src) => [mkMod('Bulwark', 'FLAG', true, src)],
  },
  {
    pattern: /^Take (\d+)% (less|more) Damage from Hits while Dodge Rolling$/i,
    build: (m, src) => [
      mkMod('DamageTakenWhileDodgeRolling', 'MORE', m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]), src),
    ],
  },
  {
    pattern: /^Take (\d+)% (less|more) Damage over Time if you(?:'ve| have| haven't) started taking Damage over Time in the past second$/i,
    build: (m, src) => [
      mkMod('Heartstopper', 'FLAG', true, src),
      mkMod('DotDamageTaken', 'MORE', m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]), src),
    ],
  },
  {
    pattern: /^If you would gain a Charge, Allies in your Presence gain that Charge instead$/i,
    build: (_, src) => [mkMod('Conduit', 'FLAG', true, src)],
  },
  {
    pattern: /^All bonuses from Equipped Amulet apply to your Minions instead of you$/i,
    build: (_, src) => [mkMod('NecromanticTalisman', 'FLAG', true, src)],
  },
  {
    pattern: /^You cannot Recover Energy Shield from Regeneration$/i,
    build: (_, src) => [mkMod('NoEsRegen', 'FLAG', true, src)],
  },
  {
    pattern: /^You cannot Recover Energy Shield to above Armour$/i,
    build: (_, src) => [mkMod('EsRecoveryCappedByArmour', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+)% of Physical Damage prevented Recouped as Energy Shield per enemy Power$/i,
    build: (m, src) => [
      mkMod('ScarredFaith', 'FLAG', true, src),
      mkMod('PhysPreventedRecoupAsEsPerPower', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^Can Attack as though using a Quarterstaff while both of your hand slots are empty$/i,
    build: (_, src) => [mkMod('HollowPalmTechnique', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% more Attack Speed per (\d+) Item Evasion on Equipped Armour Items$/i,
    build: (m, src) => [
      mkMod('HollowPalmTechnique', 'FLAG', true, src),
      mkMod('HollowPalmAttackSpeedPerEvasion', 'BASE', Number(m[1]) / Number(m[2]), src, ModFlag.Attack),
    ],
  },
  {
    pattern: /^\+(\d+(?:\.\d+)?)% to Critical Hit Chance per (\d+) Item Energy Shield on Equipped Armour Items$/i,
    build: (m, src) => [
      mkMod('HollowPalmCritPerEs', 'BASE', Number(m[1]) / Number(m[2]), src, ModFlag.Attack),
    ],
  },
  {
    pattern: /^(\d+)% more Skill Speed while Off Hand is empty and you have$/i,
    build: (m, src) => [
      mkMod('DanceWithDeath', 'FLAG', true, src),
      mkMod('DanceWithDeathSkillSpeedMore', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^Invoked Spells consume (\d+)% less Energy$/i,
    build: (m, src) => [mkMod('InvokedSpellEnergyCost', 'MORE', -Number(m[1]), src)],
  },

  // =========================================================================
  // 2. P0 PoE 2 Crit, Speed & Ascendancy Core Wording
  // =========================================================================

  // Invoker "Lead me through Grace..." & Titan "Hulking Form"
  {
    pattern: /^\+(\d+) to Spirit for every (\d+) Item Energy Shield on Equipped Body Armour$/i,
    build: (m, src) => [mkMod('SpiritPerBodyEs', 'BASE', Number(m[1]) / Number(m[2]), src)],
  },
  {
    pattern: /^\+(\d+) to Spirit for every (\d+) Evasion Rating on Equipped Body Armour$/i,
    build: (m, src) => [mkMod('SpiritPerBodyEvasion', 'BASE', Number(m[1]) / Number(m[2]), src)],
  },
  {
    pattern: /^(\d+)% increased effect of Small Passive Skills$/i,
    build: (m, src) => [mkMod('SmallPassiveEffect', 'INC', Number(m[1]), src)],
  },

  // Crit Damage Bonus (Spell, Attack, Weapon, Conditional, Global)
  {
    pattern: /^(\d+)% (increased|reduced) Critical Spell Damage Bonus$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('CritDamageBonusInc', type, value, src, ModFlag.Spell)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced) Critical Damage Bonus for Attack Damage$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('CritDamageBonusInc', type, value, src, ModFlag.Attack)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced) Critical Damage Bonus with (Two Handed Weapons|One Handed Weapons|Quarterstaves|Spears|Crossbows|Bows|Maces|Flails|Staves|Wands|Swords|Axes|Daggers|Claws|Traps|Melee Weapons|Attack Skills|Spell Skills)$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('CritDamageBonusInc', type, value, src, weaponToFlag(m[3]!))];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced) Critical Damage Bonus$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('CritDamageBonusInc', type, value, src)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced) Critical Damage Bonus (?:if|while|against) .+$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('ConditionalCritDamageBonusInc', type, value, src)];
    },
  },

  // Crit Chance (Attacks, Spells, Struck Through, Sunder the Flesh, Throatseeker, Weapon, Conditional)
  {
    pattern: /^(\d+)% (increased|reduced) Critical Hit Chance for Attacks$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('CritChance', type, value, src, ModFlag.Attack)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced) Critical Hit Chance for Spells$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('CritChance', type, value, src, ModFlag.Spell)];
    },
  },
  {
    pattern: /^Attacks have \+(\d+(?:\.\d+)?)% to Critical Hit Chance$/i,
    build: (m, src) => [mkMod('CritChance', 'BASE', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^Base Critical Hit Chance for Spells is (\d+(?:\.\d+)?)%$/i,
    build: (m, src) => [mkMod('SpellBaseCritOverride', 'BASE', Number(m[1]), src, ModFlag.Spell)],
  },
  {
    pattern: /^(\d+)% reduced Critical Hit Chance$/i,
    build: (m, src) => [mkMod('CritChance', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced) Critical Hit Chance with (Two Handed Weapons|One Handed Weapons|Quarterstaves|Spears|Crossbows|Bows|Maces|Flails|Staves|Wands|Swords|Axes|Daggers|Claws|Traps)$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('CritChance', type, value, src, weaponToFlag(m[3]!))];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced) Critical Hit Chance (?:against|while|if) .+$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('ConditionalCritChance', type, value, src)];
    },
  },
  {
    pattern: /^Projectiles have (\d+)% increased Critical Hit Chance(?: .+)?$/i,
    build: (m, src) => [mkMod('ConditionalCritChance', 'INC', Number(m[1]), src, ModFlag.Projectile)],
  },
  {
    pattern: /^Hits against you have (\d+)% reduced Critical Damage Bonus$/i,
    build: (m, src) => [mkMod('CritDamageReduction', 'INC', Number(m[1]), src)],
  },

  // Skill Speed & Attack/Cast Speed variants
  {
    pattern: /^(\d+)% (increased|reduced|more|less) Skill Speed$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [
        mkMod('Speed', type, value, src, ModFlag.Attack),
        mkMod('Speed', type, value, src, ModFlag.Spell),
      ];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) Skill Speed (?:while|with|if) .+$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [
        mkMod('ConditionalSpeed', type, value, src, ModFlag.Attack),
        mkMod('ConditionalSpeed', type, value, src, ModFlag.Spell),
      ];
    },
  },
  {
    pattern: /^(\d+)% reduced Attack Speed(?: .+)?$/i,
    build: (m, src) => [mkMod('Speed', 'INC', -Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^(\d+)% reduced Cast Speed(?: .+)?$/i,
    build: (m, src) => [mkMod('Speed', 'INC', -Number(m[1]), src, ModFlag.Spell)],
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) Melee Attack Speed$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('Speed', type, value, src, ModFlag.Attack | ModFlag.Melee)];
    },
  },
  {
    pattern: /^(\d+)% increased Attack Speed (?:while|if) .+$/i,
    build: (m, src) => [mkMod('ConditionalSpeed', 'INC', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^(\d+)% increased Cast Speed (?:while|if) .+$/i,
    build: (m, src) => [mkMod('ConditionalSpeed', 'INC', Number(m[1]), src, ModFlag.Spell)],
  },
  {
    pattern: /^(\d+)% increased Attack and Cast Speed with (Fire|Cold|Lightning|Chaos|Physical|Elemental) Skills$/i,
    build: (m, src) => {
      const kw = elementToKeyword(m[2]);
      return [
        mkMod('Speed', 'INC', Number(m[1]), src, ModFlag.Attack, kw),
        mkMod('Speed', 'INC', Number(m[1]), src, ModFlag.Spell, kw),
      ];
    },
  },
  {
    pattern: /^(\d+)% increased Attack and Cast Speed (?:while|if) .+$/i,
    build: (m, src) => [
      mkMod('ConditionalSpeed', 'INC', Number(m[1]), src, ModFlag.Attack),
      mkMod('ConditionalSpeed', 'INC', Number(m[1]), src, ModFlag.Spell),
    ],
  },
  {
    pattern: /^(\d+)% increased Crossbow Reload Speed$/i,
    build: (m, src) => [mkMod('ReloadSpeed', 'INC', Number(m[1]), src, ModFlag.Crossbow)],
  },
  {
    pattern: /^(\d+)% increased Warcry Speed$/i,
    build: (m, src) => [mkMod('WarcrySpeed', 'INC', Number(m[1]), src, 0, KeywordFlag.Warcry)],
  },
  {
    pattern: /^Mark Skills have (\d+)% increased Use Speed$/i,
    build: (m, src) => [mkMod('MarkUseSpeed', 'INC', Number(m[1]), src)],
  },

  // =========================================================================
  // 3. P0 PoE 2 Attributes, Defences, Spirit, Recovery & Equipment Scaling
  // =========================================================================

  // % Increased / Reduced Attributes
  {
    pattern: /^(\d+)% (increased|reduced) Strength$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('Str', type, value, src)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced) Dexterity$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('Dex', type, value, src)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced) Intelligence$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('Int', type, value, src)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced) (?:all )?Attributes$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [
        mkMod('Str', type, value, src),
        mkMod('Dex', type, value, src),
        mkMod('Int', type, value, src),
      ];
    },
  },
  {
    pattern: /^(?:Equipment and Skill Gems have )?(\d+)% (increased|reduced) Attribute Requirements$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('AttributeRequirements', type, value, src)];
    },
  },

  // Equipment-slot Defence Scaling
  {
    pattern: /^(\d+)% increased (Armour|Evasion Rating|Energy Shield) from Equipped (Body Armour|Shield|Helmet|Focus|Boots|Gloves)$/i,
    build: (m, src) => {
      const stat =
        m[2]!.toLowerCase() === 'armour'
          ? 'Armour'
          : m[2]!.toLowerCase().startsWith('evasion')
            ? 'Evasion'
            : 'EnergyShield';
      return [mkMod(`${stat}From${normalizeSlotName(m[3]!)}`, 'INC', Number(m[1]), src)];
    },
  },
  {
    pattern: /^(\d+)% increased Armour, Evasion(?: Rating)? and Energy Shield from Equipped (Body Armour|Shield|Helmet|Focus|Boots|Gloves)$/i,
    build: (m, src) => {
      const slot = normalizeSlotName(m[2]!);
      const v = Number(m[1]);
      return [
        mkMod(`ArmourFrom${slot}`, 'INC', v, src),
        mkMod(`EvasionFrom${slot}`, 'INC', v, src),
        mkMod(`EnergyShieldFrom${slot}`, 'INC', v, src),
      ];
    },
  },
  {
    pattern: /^(\d+)% increased bonuses gained from Equipped Quiver$/i,
    build: (m, src) => [mkMod('QuiverEffect', 'INC', Number(m[1]), src)],
  },

  // Block, Deflection, Armour-to-Elemental
  {
    pattern: /^(\d+)% (increased|reduced) Block [Cc]hance$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('BlockChance', type, value, src)];
    },
  },
  {
    pattern: /^\+(\d+)% to maximum Block [Cc]hance$/i,
    build: (m, src) => [mkMod('BlockChanceMax', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Gain Deflection Rating equal to (\d+)% of Evasion Rating$/i,
    build: (m, src) => [mkMod('DeflectionPerEvasionPct', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced) Deflection Rating$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('DeflectionRating', type, value, src)];
    },
  },
  {
    pattern: /^\+?(\d+)% of Armour also applies to Elemental Damage(?: while .+)?$/i,
    build: (m, src) => [mkMod('ArmourAppliesToElementalPct', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+?(\d+)% of Armour also applies to (Fire|Cold|Lightning) Damage(?: while .+)?$/i,
    build: (m, src) => [mkMod(`ArmourAppliesTo${m[2]}Pct`, 'BASE', Number(m[1]), src)],
  },

  // ES Recharge, Life/Mana Regen & Recovery
  {
    pattern: /^(\d+)% faster start of Energy Shield Recharge(?: while .+)?$/i,
    build: (m, src) => [mkMod('EnergyShieldRechargeDelay', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced) Energy Shield Recharge Rate(?: while .+)?$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('EnergyShieldRechargeRate', type, value, src)];
    },
  },
  {
    pattern: /^(\d+(?:\.\d+)?) Life Regeneration per second$/i,
    build: (m, src) => [mkMod('LifeRegen', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Regenerate (\d+(?:\.\d+)?)% of maximum Life per second$/i,
    build: (m, src) => [mkMod('LifeRegenPercent', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced) Life Regeneration [Rr]ate$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('LifeRegen', type, value, src)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced) Life Regeneration [Rr]ate (?:while|if) .+$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('ConditionalLifeRegen', type, value, src)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced) Mana Regeneration [Rr]ate (?:while|if) .+$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('ConditionalManaRegen', type, value, src)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) (Life|Mana|Energy Shield) Recovery [Rr]ate$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const stat = m[3]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : m[3]!;
      return [mkMod(`${stat}RecoveryRate`, type, value, src)];
    },
  },

  // Reduced Defences, Mana, Movement Speed, Conditional Defences
  {
    pattern: /^(\d+)% reduced Armour, Evasion(?: Rating)? and Energy Shield$/i,
    build: (m, src) => {
      const v = -Number(m[1]);
      return [
        mkMod('Armour', 'INC', v, src),
        mkMod('Evasion', 'INC', v, src),
        mkMod('EnergyShield', 'INC', v, src),
      ];
    },
  },
  {
    pattern: /^(\d+)% reduced maximum (Life|Mana|Energy Shield)$/i,
    build: (m, src) => {
      const stat = m[2]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : m[2]!;
      return [mkMod(stat, 'INC', -Number(m[1]), src)];
    },
  },
  {
    pattern: /^(\d+)% less (?:maximum )?Energy Shield$/i,
    build: (m, src) => [mkMod('EnergyShield', 'MORE', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced Movement Speed$/i,
    build: (m, src) => [mkMod('MovementSpeed', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Movement Speed (?:while|if|when) .+$/i,
    build: (m, src) => [mkMod('ConditionalMovementSpeed', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced Movement Speed Penalty (?:from using Skills while moving|while Actively Blocking)$/i,
    build: (m, src) => [mkMod('MoveSpeedPenaltyReduction', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Armour, Evasion(?: Rating)? and Energy Shield (?:while|if) .+$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      return [
        mkMod('ConditionalArmour', 'INC', v, src),
        mkMod('ConditionalEvasion', 'INC', v, src),
        mkMod('ConditionalEnergyShield', 'INC', v, src),
      ];
    },
  },
  {
    pattern: /^(\d+)% increased Armour and Evasion(?: Rating)? (?:while|if) .+$/i,
    build: (m, src) => [
      mkMod('ConditionalArmour', 'INC', Number(m[1]), src),
      mkMod('ConditionalEvasion', 'INC', Number(m[1]), src),
    ],
  },
  {
    pattern: /^(\d+)% increased (Armour|Evasion Rating|maximum Energy Shield) (?:while|if|when) .+$/i,
    build: (m, src) => {
      const stat =
        m[2]!.toLowerCase() === 'armour'
          ? 'ConditionalArmour'
          : m[2]!.toLowerCase().startsWith('evasion')
            ? 'ConditionalEvasion'
            : 'ConditionalEnergyShield';
      return [mkMod(stat, 'INC', Number(m[1]), src)];
    },
  },

  // Spirit, Aura Magnitude, Curse Magnitude, Item Rarity
  {
    pattern: /^(\d+)% (increased|reduced|more|less) Spirit$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('Spirit', type, value, src)];
    },
  },
  {
    pattern: /^Aura Skills have (\d+)% increased Magnitudes?$/i,
    build: (m, src) => [mkMod('AuraEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Banner Skills have (\d+)% increased Aura Magnitudes?$/i,
    build: (m, src) => [mkMod('BannerAuraEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Curse Magnitudes?$/i,
    build: (m, src) => [mkMod('CurseEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Rarity of Items found$/i,
    build: (m, src) => [mkMod('ItemRarity', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced) Light Radius$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('LightRadius', type, value, src)];
    },
  },
  {
    pattern: /^Grants (\d+) Passive Skill Points?$/i,
    build: (m, src) => [mkMod('ExtraPassivePoints', 'BASE', Number(m[1]), src)],
  },

  // =========================================================================
  // 4. P1 PoE 2 Combat, Weapons, AoE, Ailments, Stun/Threshold & Conditionals
  // =========================================================================

  // Area Damage & Area of Effect
  {
    pattern: /^(\d+)% (increased|more|less) Attack Area Damage$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('Damage', type, value, src, ModFlag.Attack | ModFlag.Area)];
    },
  },
  {
    pattern: /^(\d+)% (increased|more|less) Spell Area Damage$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('Damage', type, value, src, ModFlag.Spell | ModFlag.Area)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) Area of Effect(?: for Attacks)?$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const flags = /for Attacks$/i.test(m[0]!) ? ModFlag.Attack : 0;
      return [mkMod('AreaOfEffect', type, value, src, flags)];
    },
  },
  {
    pattern: /^(Spell|Banner|Warcry|Detonator) Skills? have (\d+)% increased Area of Effect$/i,
    build: (m, src) => {
      const flags = m[1]!.toLowerCase() === 'spell' ? ModFlag.Spell : 0;
      const kw = m[1]!.toLowerCase() === 'warcry' ? KeywordFlag.Warcry : 0;
      return [mkMod('AreaOfEffect', 'INC', Number(m[2]), src, flags, kw)];
    },
  },
  {
    pattern: /^(\d+)% increased Area of Effect (?:of Curses|of Ancestrally Boosted Attacks|if .+)$/i,
    build: (m, src) => [mkMod('AreaOfEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced) Presence Area of Effect$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('PresenceAreaOfEffect', type, value, src)];
    },
  },

  // Weapon-Specific Damage & Attack Speed
  {
    pattern: /^(\d+)% increased Damage with (Two Handed Weapons|One Handed Weapons|Quarterstaves|Spears|Crossbows|Bows|Maces|Flails|Staves|Wands|Swords|Axes|Daggers|Claws|Plant Skills|Warcries)$/i,
    build: (m, src) => {
      const target = m[2]!.toLowerCase();
      if (target === 'warcries') {
        return [mkMod('Damage', 'INC', Number(m[1]), src, 0, KeywordFlag.Warcry)];
      }
      if (target === 'plant skills') {
        return [mkMod('PlantDamage', 'INC', Number(m[1]), src)];
      }
      return [mkMod('Damage', 'INC', Number(m[1]), src, weaponToFlag(m[2]!))];
    },
  },
  {
    pattern: /^(\d+)% increased Elemental Damage with Attacks$/i,
    build: (m, src) => [mkMod('ElementalDamage', 'INC', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^(\d+)% increased Attack (Physical|Fire|Cold|Lightning|Chaos) Damage$/i,
    build: (m, src) => [mkMod(`${m[2]}Damage`, 'INC', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^(\d+)% increased (Totem|Trap|Grenade|Hazard|Ballista|Thorns|Parry) [Dd]amage$/i,
    build: (m, src) => [mkMod(`${m[2]!.charAt(0).toUpperCase()}${m[2]!.slice(1).toLowerCase()}Damage`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+) to (\d+) Physical Thorns damage$/i,
    build: (m, src) => [
      mkMod('ThornsPhysicalMin', 'BASE', Number(m[1]), src),
      mkMod('ThornsPhysicalMax', 'BASE', Number(m[2]), src),
    ],
  },
  {
    pattern: /^Thorns Damage has (\d+)% chance to ignore Enemy Armour$/i,
    build: (m, src) => [mkMod('ThornsIgnoreArmourChance', 'BASE', Number(m[1]), src)],
  },

  // Ailment Magnitude, Speed, Chance & Duration
  {
    pattern: /^Damaging Ailments deal damage (\d+)% faster$/i,
    build: (m, src) => [mkMod('AilmentFaster', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Ignites you inflict deal Damage (\d+)% faster$/i,
    build: (m, src) => [mkMod('IgniteFaster', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) Magnitude of (Damaging Ailments|Non-Damaging Ailments|Ailments|Ignite|Bleeding|Poison|Shock|Chill|Jagged Ground)(?: you (?:inflict|create))?(?: (?:against|with) .+)?$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const kind = m[3]!.toLowerCase();
      const stat =
        kind === 'ignite'
          ? 'IgniteMagnitude'
          : kind === 'bleeding'
            ? 'BleedMagnitude'
            : kind === 'poison'
              ? 'PoisonMagnitude'
              : kind === 'shock'
                ? 'ShockMagnitude'
                : kind === 'chill'
                  ? 'ChillMagnitude'
                  : kind === 'non-damaging ailments'
                    ? 'NonDamagingAilmentMagnitude'
                    : kind === 'jagged ground'
                      ? 'JaggedGroundMagnitude'
                      : 'AilmentMagnitude';
      return [mkMod(stat, type, value, src)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) (Ignite|Flammability|Poison|Shock|Bleeding|Withered) Magnitude$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod(`${m[3]}Magnitude`, type, value, src)];
    },
  },
  {
    pattern: /^(\d+)% increased chance to (?:inflict Ailments|Shock|Ignite|Freeze|Electrocute)(?: (?:with|against) .+)?$/i,
    build: (m, src) => {
      const raw = m[0]!.toLowerCase();
      const stat = raw.includes('shock')
        ? 'ShockChance'
        : raw.includes('ignite')
          ? 'IgniteChance'
          : raw.includes('freeze')
            ? 'FreezeChance'
            : raw.includes('electrocute')
              ? 'ElectrocuteChance'
              : 'AilmentChance';
      return [mkMod(stat, 'INC', Number(m[1]), src)];
    },
  },
  {
    pattern: /^Attacks with One-Handed Weapons have (\d+)% increased Chance to inflict Ailments$/i,
    build: (m, src) => [mkMod('AilmentChance', 'INC', Number(m[1]), src, ModFlag.Weapon1H)],
  },
  {
    pattern: /^(\d+)% chance to (inflict Bleeding|Daze|Blind Enemies|Impale) on (?:Spell )?Hit(?: with Attacks)?$/i,
    build: (m, src) => {
      const kind = m[2]!.toLowerCase();
      const stat = kind.includes('bleed')
        ? 'BleedChance'
        : kind.includes('daze')
          ? 'DazeChance'
          : kind.includes('blind')
            ? 'BlindChance'
            : 'ImpaleChance';
      return [mkMod(stat, 'BASE', Number(m[1]), src)];
    },
  },
  {
    pattern: /^(\d+)% chance for Attack Hits to apply Incision$/i,
    build: (m, src) => [mkMod('IncisionChance', 'BASE', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^(\d+)% increased (Ignite|Bleeding|Poison|Shock|Chill|Duration of Damaging Ailments|Pin|Armour Break|Curse|Hazard|Elemental Infusion|Archon Buff|Minion|Parried Debuff)(?: Duration)?(?: on Enemies)?$/i,
    build: (m, src) => {
      const key = m[2]!.replace(/\s+/g, '');
      return [mkMod(`${key}Duration`, 'INC', Number(m[1]), src)];
    },
  },

  // Buildup, Stun/Ailment Threshold, Armour Break, Duration, Projectile Speed
  {
    pattern: /^(?:Causes )?(\d+)% increased (?:Projectile )?(Stun|Freeze|Pin|Electrocute|Immobilisation) [Bb]uildup(?: with .+)?$/i,
    build: (m, src) => [mkMod(`${m[2]}Buildup`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Ballista Immobilisation buildup$/i,
    build: (m, src) => [mkMod('BallistaImmobilisationBuildup', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to Stun Threshold$/i,
    build: (m, src) => [mkMod('StunThreshold', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced) (Stun|Elemental Ailment|Freeze|Culling Strike) Threshold(?: (?:while|if) .+)?$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod(`${m[3]!.replace(/\s+/g, '')}Threshold`, type, value, src)];
    },
  },
  {
    pattern: /^Gain additional (Stun|Ailment|Elemental Ailment) Threshold equal to (\d+)% of maximum Energy Shield$/i,
    build: (m, src) => [mkMod(`${m[1]!.replace(/\s+/g, '')}ThresholdFromEsPct`, 'BASE', Number(m[2]), src)],
  },
  {
    pattern: /^Gain (\d+)% of maximum Energy Shield as additional Freeze Threshold$/i,
    build: (m, src) => [mkMod('FreezeThresholdFromEsPct', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(?:Hits )?Break (\d+)% increased Armour(?: on targets with Ailments)?$/i,
    build: (m, src) => [mkMod('ArmourBreak', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased effect of Fully Broken Armour$/i,
    build: (m, src) => [mkMod('FullyBrokenArmourEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced Armour Break taken$/i,
    build: (m, src) => [mkMod('ArmourBreakTaken', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced) (?:Skill Effect )?Duration$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('Duration', type, value, src)];
    },
  },
  {
    pattern: /^Banner Skills have (\d+)% increased Duration$/i,
    build: (m, src) => [mkMod('BannerDuration', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced) (Projectile|Bolt) Speed$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('ProjectileSpeed', type, value, src, ModFlag.Projectile)];
    },
  },
  {
    pattern: /^(\d+)% increased Knockback Distance$/i,
    build: (m, src) => [mkMod('KnockbackDistance', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Stun Recovery$/i,
    build: (m, src) => [mkMod('StunRecovery', 'INC', Number(m[1]), src)],
  },

  // Debuffs, Slows, Exposure, Blind, Curse/Mark Effect, Penetration
  {
    pattern: /^(\d+)% reduced Slowing Potency of Debuffs on You$/i,
    build: (m, src) => [mkMod('SlowPotencyOnSelf', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^Debuffs you inflict have (\d+)% increased Slow Magnitude$/i,
    build: (m, src) => [mkMod('SlowMagnitude', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Debuffs on you expire (\d+)% faster$/i,
    build: (m, src) => [mkMod('DebuffExpiryRate', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Buffs on you expire (\d+)% slower$/i,
    build: (m, src) => [mkMod('BuffExpiryRate', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced (?:effect|Effect|Magnitude|Duration) of (Curses|Shock|Chill|Ignite|Bleeding|Ailments) on [Yy]ou$/i,
    build: (m, src) => [mkMod(`${m[2]}OnSelfReduction`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased (Exposure|Blind|Arcane Surge|Archon Buffs|Puppet Master|Parried Debuff)(?: Effect| effect| Magnitude)?(?: on you)?$/i,
    build: (m, src) => [mkMod(`${m[2]!.replace(/\s+/g, '')}Effect`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Effect of your Mark Skills$/i,
    build: (m, src) => [mkMod('MarkEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% faster Curse Activation$/i,
    build: (m, src) => [mkMod('CurseActivationSpeed', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Damage Penetrates (\d+)% of Enemy Elemental Resistances$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      return [
        mkMod('FirePenetration', 'BASE', v, src),
        mkMod('ColdPenetration', 'BASE', v, src),
        mkMod('LightningPenetration', 'BASE', v, src),
      ];
    },
  },
  {
    pattern: /^Enemies Blinded by you have (\d+)% reduced Critical Hit Chance$/i,
    build: (m, src) => [mkMod('BlindedEnemyCritReduction', 'INC', Number(m[1]), src)],
  },

  // Recoup, Leech, On-Kill Recovery, Flasks & Charms
  {
    pattern: /^(\d+)% of (?:Physical |Elemental )?Damage taken Recouped as (Life|Mana|Energy Shield)(?: while .+)?$/i,
    build: (m, src) => {
      const target = m[2]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : m[2]!;
      return [mkMod(`${target}Recoup`, 'BASE', Number(m[1]), src)];
    },
  },
  {
    pattern: /^(\d+)% increased speed of Recoup Effects$/i,
    build: (m, src) => [mkMod('RecoupSpeed', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) amount of (Life|Mana) Leeched$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod(`${m[3]}LeechAmount`, type, value, src)];
    },
  },
  {
    pattern: /^Leeches (\d+(?:\.\d+)?)% of Physical Damage as (Life|Mana)$/i,
    build: (m, src) => [mkMod(`${m[2]}Leech`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Recover (\d+(?:\.\d+)?)% of maximum (Life|Mana) (?:on Kill|when you consume a Power Charge|for each Endurance Charge consumed)$/i,
    build: (m, src) => [mkMod(`${m[2]}OnKillPct`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Gain (\d+) (Life|Mana) per enemy killed$/i,
    build: (m, src) => [mkMod(`${m[2]}OnKill`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Recover (\d+) Life when you Block$/i,
    build: (m, src) => [mkMod('LifeOnBlock', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) (?:Flask )?(Life|Mana|Life and Mana) Recovery(?: rate)? from Flasks(?: .+)?$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const t = m[3]!.toLowerCase();
      if (t === 'life and mana') {
        return [
          mkMod('FlaskLifeRecovery', type, value, src),
          mkMod('FlaskManaRecovery', type, value, src),
        ];
      }
      return [mkMod(`Flask${t === 'life' ? 'Life' : 'Mana'}Recovery`, type, value, src)];
    },
  },
  {
    pattern: /^(\d+)% increased Flask (Life|Mana) Recovery rate$/i,
    build: (m, src) => [mkMod(`Flask${m[2]}RecoveryRate`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced) (?:Life |Mana )?(Flask|Charm|Flask and Charm) Charges (?:gained|used)(?: from Mana Flasks)?$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod(`${m[3]!.replace(/\s+/g, '')}Charges`, type, value, src)];
    },
  },
  {
    pattern: /^(\d+)% increased (Flask|Charm) Effect Duration$/i,
    build: (m, src) => [mkMod(`${m[2]}Duration`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Charms applied to you have (\d+)% increased Effect$/i,
    build: (m, src) => [mkMod('CharmEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Life Flasks gain (\d+(?:\.\d+)?) charges per Second$/i,
    build: (m, src) => [mkMod('LifeFlaskChargesPerSec', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Has (\d+) Charm Slots?$/i,
    build: (m, src) => [mkMod('CharmSlots', 'BASE', Number(m[1]), src)],
  },

  // Conditional Damage (Full/Low Life, Herald, Dazed/Blinded/Ignited/Burning/Immobilised, Companion, Shapeshifted, etc.)
  {
    pattern: /^(\d+)% increased (Attack |Spell |Melee |Elemental |Fire |Cold |Lightning |Physical |Chaos )?Damage (?:with Hits )?(?:while|against|if) .+$/i,
    build: (m, src) => {
      const scope = (m[2] ?? '').trim().toLowerCase();
      if (scope === 'attack') return [mkMod('ConditionalDamage', 'INC', Number(m[1]), src, ModFlag.Attack)];
      if (scope === 'spell') return [mkMod('ConditionalDamage', 'INC', Number(m[1]), src, ModFlag.Spell)];
      if (scope === 'melee') return [mkMod('ConditionalDamage', 'INC', Number(m[1]), src, ModFlag.Melee)];
      if (scope) {
        const cap = scope.charAt(0).toUpperCase() + scope.slice(1);
        return [mkMod(`Conditional${cap}Damage`, 'INC', Number(m[1]), src)];
      }
      return [mkMod('ConditionalDamage', 'INC', Number(m[1]), src)];
    },
  },
  {
    pattern: /^(Empowered Attacks|Ancestrally Boosted Attacks|Attack Skills|Channelling Skills|Triggered Spells|Invocated Spells|Herald Skills|Projectiles) deal (\d+)% increased (?:Spell )?Damage(?: .+)?$/i,
    build: (m, src) => {
      const subject = m[1]!.toLowerCase();
      const flags = subject.includes('attack')
        ? ModFlag.Attack
        : subject.includes('spell')
          ? ModFlag.Spell
          : subject.includes('projectile')
            ? ModFlag.Projectile
            : 0;
      return [mkMod('ConditionalDamage', 'INC', Number(m[2]), src, flags)];
    },
  },
  {
    pattern: /^Allies in your Presence deal (\d+)% increased Damage$/i,
    build: (m, src) => [mkMod('AllyDamage', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Allies in your Presence have (\d+)% increased Attack Speed$/i,
    build: (m, src) => [mkMod('AllyAttackSpeed', 'INC', Number(m[1]), src)],
  },

  // Companions, Minions, Totems, Offerings
  {
    pattern: /^Companions deal (\d+)% (increased|more|less) Damage$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('CompanionDamage', type, value, src)];
    },
  },
  {
    pattern: /^Companions have (\d+)% (increased|more|less) maximum Life$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('CompanionLife', type, value, src)];
    },
  },
  {
    pattern: /^Companions have (\d+)% increased (Movement Speed|Area of Effect)$/i,
    build: (m, src) => [mkMod(`Companion${m[2]!.replace(/\s+/g, '')}`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Companions have \+(\d+)% to all Elemental Resistances$/i,
    build: (m, src) => [mkMod('CompanionElementalResist', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Companions gain (\d+)% Damage as extra (Fire|Cold|Lightning|Chaos) Damage$/i,
    build: (m, src) => [mkMod(`CompanionGainAs${m[2]}`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Minions have \+(\d+)% to (all Elemental Resistances|(?:Fire|Cold|Lightning|Chaos) Resistance)$/i,
    build: (m, src) => [mkMod(`Minion${m[2]!.replace(/\s+/g, '')}`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Minions have (\d+)% (?:increased|additional) (Area of Effect|Critical Hit Chance|Physical Damage Reduction|Cooldown Recovery Rate for Command Skills)$/i,
    build: (m, src) => [mkMod(`Minion${m[2]!.replace(/\s+/g, '')}`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Minions deal (\d+)% increased Damage with Command Skills$/i,
    build: (m, src) => [mkMod('MinionCommandDamage', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Minions Revive (\d+)% faster$/i,
    build: (m, src) => [mkMod('MinionReviveSpeed', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Offerings have (\d+)% increased Maximum Life$/i,
    build: (m, src) => [mkMod('OfferingLife', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Totem (Placement speed|Life)$/i,
    build: (m, src) => [mkMod(`Totem${m[2]!.replace(/\s+/g, '')}`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Spells Cast by Totems have (\d+)% increased Cast Speed$/i,
    build: (m, src) => [mkMod('TotemCastSpeed', 'INC', Number(m[1]), src, ModFlag.Spell, KeywordFlag.Totem)],
  },
  {
    pattern: /^Attacks used by Totems have (\d+)% increased Attack Speed$/i,
    build: (m, src) => [mkMod('TotemAttackSpeed', 'INC', Number(m[1]), src, ModFlag.Attack, KeywordFlag.Totem)],
  },
  {
    pattern: /^Totems gain \+(\d+)% to all Maximum Elemental Resistances$/i,
    build: (m, src) => [mkMod('TotemEleResistMax', 'BASE', Number(m[1]), src)],
  },

  // Costs, Rage, Charges, Energy, Remnants, Projectiles, Warcries, Misc PoE 2 Mechanics
  {
    pattern: /^(\d+)% of (?:Skill |Spell )?Mana Costs? Converted to Life Costs?$/i,
    build: (m, src) => [mkMod('ManaCostConvertToLife', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Mana Cost Efficiency$/i,
    build: (m, src) => [mkMod('ManaCostEfficiency', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced) (Life|Mana) Cost of Skills$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod(`${m[3]}Cost`, type, value, src)];
    },
  },
  {
    pattern: /^Reserves (\d+)% of Life$/i,
    build: (m, src) => [mkMod('LifeReservedPct', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Gain (\d+) Rage (?:on Melee(?: Axe)? Hit|when Hit by an Enemy)$/i,
    build: (m, src) => [mkMod('RageOnHit', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to maximum Rage while Shapeshifted$/i,
    build: (m, src) => [mkMod('MaximumRage', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Inherent Rage loss starts (\d+(?:\.\d+)?) seconds? later$/i,
    build: (m, src) => [mkMod('RageLossDelay', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Inherent loss of Rage is (\d+)% slower$/i,
    build: (m, src) => [mkMod('RageLossRate', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased (Frenzy|Power|Endurance|Endurance, Frenzy and Power) Charge Duration$/i,
    build: (m, src) => [mkMod('ChargeDuration', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance (?:that if you would gain|when you gain a) (Power|Frenzy|Endurance) Charges?/i,
    build: (m, src) => [mkMod(`${m[2]}ChargeBonusChance`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Meta Skills gain (\d+)% increased Energy$/i,
    build: (m, src) => [mkMod('MetaEnergyGain', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Glory generation(?: for Banner Skills)?$/i,
    build: (m, src) => [mkMod('GloryGeneration', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Remnants (?:can be collected from (\d+)% further away|you create have (\d+)% increased effect)$/i,
    build: (m, src) => [mkMod('RemnantBonus', 'INC', Number(m[1] ?? m[2]), src)],
  },
  {
    pattern: /^(\d+)% chance to create an additional Remnant$/i,
    build: (m, src) => [mkMod('ExtraRemnantChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased (Warcry Cooldown Recovery Rate|Cooldown Recovery Rate for Grenade Skills)$/i,
    build: (m, src) => [mkMod('CooldownRecovery', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased total Power counted by Warcries$/i,
    build: (m, src) => [mkMod('WarcryPower', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% Chance to build an additional Combo on Hit$/i,
    build: (m, src) => [mkMod('ExtraComboChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance to gain Volatility on Kill$/i,
    build: (m, src) => [mkMod('VolatilityOnKillChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance (?:for Projectiles )?to Pierce (?:an Enemy|Enemies(?: within \d+m distance of you)?)$/i,
    build: (m, src) => [mkMod('PierceChance', 'BASE', Number(m[1]), src, ModFlag.Projectile)],
  },
  {
    pattern: /^Projectiles have (\d+)% chance to Chain an additional time from terrain$/i,
    build: (m, src) => [mkMod('TerrainChainChance', 'BASE', Number(m[1]), src, ModFlag.Projectile)],
  },
  {
    pattern: /^\+?(\d+)% (?:Surpassing )?chance (?:for Spell Skills )?to fire (?:an|\d+) additional (?:Projectiles?|Arrows?)$/i,
    build: (m, src) => [mkMod('ExtraProjectileChance', 'BASE', Number(m[1]), src, ModFlag.Projectile)],
  },
  {
    pattern: /^(\d+)% increased Accuracy Rating (?:with .+|while .+)$/i,
    build: (m, src) => [mkMod('Accuracy', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance to Gain Arcane Surge when you deal a Critical Hit$/i,
    build: (m, src) => [mkMod('ArcaneSurgeOnCritChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% Surpassing Chance to gain a Puppet Master stack whenever you use a Command Skill$/i,
    build: (m, src) => [mkMod('PuppetMasterStackChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Archon recovery period expires (\d+)% faster$/i,
    build: (m, src) => [mkMod('ArchonRecoveryRate', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Sealed Skills have (\d+)% increased Seal gain frequency$/i,
    build: (m, src) => [mkMod('SealGainFrequency', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Parry Hit Area of Effect$/i,
    build: (m, src) => [mkMod('ParryAreaOfEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance to not destroy Corpses when Consuming Corpses$/i,
    build: (m, src) => [mkMod('CorpsePreserveChance', 'BASE', Number(m[1]), src)],
  },

  // =========================================================================
  // 5. PoE 2 Skill-Specific & Tag Gem Level Scaling (+X to Level of all <SkillName|Nova|...> Skills)
  // =========================================================================
  {
    pattern: /^\+(\d+) to Level of all ([A-Za-z][A-Za-z' -]*?) (?:Skill Gems?|Skills?)$/i,
    build: (m, src) => {
      const rawKey = m[2]!.trim().toLowerCase().replace(/\s+/g, '+');
      return [mkMod(`GemLevel:${rawKey}`, 'BASE', Number(m[1]), src)];
    },
  },
];
