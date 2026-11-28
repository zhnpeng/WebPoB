import { KeywordFlag, ModFlag, type Mod, type ModTag, type ModType } from '@webpob/core';
import { parseModCompositional } from './compositionalModParser.js';
import { parseConditionalSuffix } from './modTagEval.js';

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
      mkMod('SkillManaCostConvertToLifeCost', 'BASE', 100, src),
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
    pattern: /^(\d+(?:\.\d+)?)% more Attack Speed per (\d+) Item Evasion(?: Rating)? on Equipped Armour Items$/i,
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
    pattern: /^(\d+)% more Skill Speed while Off Hand is empty and you have(?:\s+a\s+One-Handed\s+Martial\s+Weapon\s+equipped\s+in\s+your\s+Main\s+Hand)?$/i,
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
    pattern: /^(\d+)% (increased|reduced) Critical (?:Attack Damage Bonus|Damage Bonus for Attack Damage)$/i,
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
  // Grinning Immolation (Tree:34419): "50% more Critical Damage Bonus"
  {
    pattern: /^(\d+)% (more|less) Critical Damage Bonus$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('CritMultiplier', type, value, src)];
    },
  },
  // Gore Spike (Tree:52703): "1% increased Critical Damage Bonus per 50 current Life" / "per 40 Life"
  {
    pattern: /^(\d+)% increased Critical Damage Bonus per (\d+) (?:current |maximum )?Life$/i,
    build: (m, src) => [
      {
        ...mkMod('CritDamageBonusInc', 'INC', Number(m[1]), src),
        tags: [{ type: 'PerStat', stat: 'Life', div: Number(m[2]) }],
      },
    ],
  },
  // Preemptive Strike (Tree:21380): "100% increased Critical Damage Bonus against Enemies that are on Full Life"
  {
    pattern: /^(\d+)% (increased|reduced) Critical Damage Bonus against Enemies that are on Full Life$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [
        {
          ...mkMod('CritMultiplier', type, value, src),
          tags: [{ type: 'Condition', var: 'EnemyFullLife' }],
        },
      ];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced) Critical Damage Bonus if you(?:'ve| have) (consumed|gained) a (Power|Frenzy|Endurance) Charge Recently$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const verb = m[3]!.toLowerCase() === 'consumed' ? 'Consumed' : 'Gained';
      const charge = m[4]!.charAt(0).toUpperCase() + m[4]!.slice(1).toLowerCase();
      return [
        {
          name: 'CritDamageBonusInc',
          type,
          value,
          flags: 0,
          keywordFlags: 0,
          source: src,
          tags: [{ type: 'Condition', var: `${verb}${charge}ChargeRecently` }],
        },
      ];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) Critical Damage Bonus (?:if|while|when|against) .+$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const { baseLine, tags } = parseConditionalSuffix(m[0]!);
      if (
        tags.length > 0 &&
        /^\d+% (?:increased|reduced|more|less) Critical Damage Bonus$/i.test(baseLine)
      ) {
        const statName = type === 'MORE' ? 'CritMultiplier' : 'CritDamageBonusInc';
        return [{ ...mkMod(statName, type, value, src), tags }];
      }
      const comp = parseModCompositional(m[0]!, src);
      if (comp.length > 0 && comp.every((c) => (c.tags?.length ?? 0) > 0)) return comp;
      if (type === 'MORE') return [];
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
    pattern: /^(\d+)% (increased|reduced|more|less) Critical (?:Hit|Strike) Chance (?:against|while|when|if) .+$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const { baseLine, tags } = parseConditionalSuffix(m[0]!);
      if (
        tags.length > 0 &&
        /^\d+% (?:increased|reduced|more|less) Critical (?:Hit|Strike) Chance$/i.test(baseLine)
      ) {
        return [{ ...mkMod('CritChance', type, value, src), tags }];
      }
      const comp = parseModCompositional(m[0]!, src);
      if (comp.length > 0 && comp.every((c) => (c.tags?.length ?? 0) > 0)) return comp;
      if (type === 'MORE') return [];
      return [mkMod('ConditionalCritChance', type, value, src)];
    },
  },
  {
    pattern: /^Projectiles have (\d+)% increased Critical Hit Chance(?: .+)?$/i,
    build: (m, src) => {
      const { baseLine, tags } = parseConditionalSuffix(m[0]!);
      if (tags.length > 0 && /^Projectiles have \d+% increased Critical Hit Chance$/i.test(baseLine)) {
        return [{ ...mkMod('CritChance', 'INC', Number(m[1]), src, ModFlag.Projectile), tags }];
      }
      if (m[0]!.length > 'Projectiles have 00% increased Critical Hit Chance'.length + 2) {
        const comp = parseModCompositional(m[0]!, src);
        if (comp.length > 0) return comp;
        return [mkMod('ConditionalCritChance', 'INC', Number(m[1]), src, ModFlag.Projectile)];
      }
      return [mkMod('CritChance', 'INC', Number(m[1]), src, ModFlag.Projectile)];
    },
  },
  // Sniper (Tree:11526, PoB 2 ModParser.lua:4995): Arrows gain Crit Chance over distance (0 at <=3.5m -> 100% at >=7m)
  // Handles both full single-line PoB phrasing and the split line 2 in poe2-tree-0_5.json.
  {
    pattern: /^(?:Arrows gain Critical Hit Chance as they travel farther,\s*up to\s+)?(\d+)% increased Critical Hit Chance after 7 metres$/i,
    build: (m, src) => [
      {
        ...mkMod('CritChance', 'INC', Number(m[1]), src, ModFlag.Bow),
        tags: [{ type: 'Condition', var: 'DistanceRamp:35:0,70:1' }],
      },
    ],
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
    pattern: /^(\d+)% (increased|reduced|more|less) Skill Speed with Channelling Skills$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const tags: ModTag[] = [{ type: 'Condition', var: 'Channelling' }];
      return [
        { ...mkMod('Speed', type, value, src, ModFlag.Attack), tags },
        { ...mkMod('Speed', type, value, src, ModFlag.Spell), tags },
      ];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) Skill Speed (?:while|when|with|if) .+$/i,
    build: (m, src) => {
      const comp = parseModCompositional(m[0]!, src);
      if (comp.length > 0 && comp.every((c) => (c.tags?.length ?? 0) > 0)) return comp;
      const { type, value } = signedVal(m[1]!, m[2]!);
      const { baseLine, tags } = parseConditionalSuffix(m[0]!);
      if (tags.length > 0 && /^\d+% (?:increased|reduced|more|less) Skill Speed$/i.test(baseLine)) {
        return [
          { ...mkMod('Speed', type, value, src, ModFlag.Attack), tags },
          { ...mkMod('Speed', type, value, src, ModFlag.Spell), tags },
        ];
      }
      return [
        mkMod('ConditionalSpeed', type, value, src, ModFlag.Attack),
        mkMod('ConditionalSpeed', type, value, src, ModFlag.Spell),
      ];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) Unarmed Attack Speed$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [
        {
          ...mkMod('Speed', type, value, src, ModFlag.Attack),
          tags: [{ type: 'Condition', var: 'Unarmed' }],
        },
      ];
    },
  },
  {
    pattern: /^(\d+)% reduced Attack Speed$/i,
    build: (m, src) => [mkMod('Speed', 'INC', -Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^(\d+)% reduced Cast Speed$/i,
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
    pattern: /^(\d+)% (increased|reduced|more|less) Attack Speed (?:while|when|if|against) .+$/i,
    build: (m, src) => {
      const comp = parseModCompositional(m[0]!, src);
      if (comp.length > 0 && comp.every((c) => (c.tags?.length ?? 0) > 0)) return comp;
      const { type, value } = signedVal(m[1]!, m[2]!);
      const { baseLine, tags } = parseConditionalSuffix(m[0]!);
      if (tags.length > 0 && /^\d+% (?:increased|reduced|more|less) Attack Speed$/i.test(baseLine)) {
        return [{ ...mkMod('Speed', type, value, src, ModFlag.Attack), tags }];
      }
      return [mkMod('ConditionalSpeed', type, value, src, ModFlag.Attack)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) Cast Speed (?:while|when|if|against) .+$/i,
    build: (m, src) => {
      const comp = parseModCompositional(m[0]!, src);
      if (comp.length > 0 && comp.every((c) => (c.tags?.length ?? 0) > 0)) return comp;
      const { type, value } = signedVal(m[1]!, m[2]!);
      const { baseLine, tags } = parseConditionalSuffix(m[0]!);
      if (tags.length > 0 && /^\d+% (?:increased|reduced|more|less) Cast Speed$/i.test(baseLine)) {
        return [{ ...mkMod('Speed', type, value, src, ModFlag.Spell), tags }];
      }
      return [mkMod('ConditionalSpeed', type, value, src, ModFlag.Spell)];
    },
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
    pattern: /^(\d+)% (increased|reduced|more|less) Attack and Cast Speed (?:while|when|if|against) .+$/i,
    build: (m, src) => {
      const comp = parseModCompositional(m[0]!, src);
      if (comp.length > 0 && comp.every((c) => (c.tags?.length ?? 0) > 0)) return comp;
      const { type, value } = signedVal(m[1]!, m[2]!);
      const { baseLine, tags } = parseConditionalSuffix(m[0]!);
      if (
        tags.length > 0 &&
        /^\d+% (?:increased|reduced|more|less) Attack and Cast Speed$/i.test(baseLine)
      ) {
        return [
          { ...mkMod('Speed', type, value, src, ModFlag.Attack), tags },
          { ...mkMod('Speed', type, value, src, ModFlag.Spell), tags },
        ];
      }
      return [
        mkMod('ConditionalSpeed', type, value, src, ModFlag.Attack),
        mkMod('ConditionalSpeed', type, value, src, ModFlag.Spell),
      ];
    },
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
    pattern: /^(\d+)% (increased|reduced) bonuses? gained from Equipped Quiver$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('QuiverEffect', type, value, src)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced) bonuses? gained from Equipped Amulet$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('AmuletEffect', type, value, src)];
    },
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
    pattern: /^(\d+)% reduced Movement Speed Penalty (?:from using Skills while moving|while Actively Blocking)$/i,
    build: (m, src) => [mkMod('MoveSpeedPenaltyReduction', 'INC', Number(m[1]), src)],
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
    pattern: /^(\d+)% (increased|reduced|more|less) (?:Damage with Unarmed Attacks|Unarmed (?:Attack )?Damage)$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [
        {
          ...mkMod('Damage', type, value, src, ModFlag.Attack),
          tags: [{ type: 'Condition', var: 'Unarmed' }],
        },
      ];
    },
  },
  {
    pattern: /^(\d+)% increased Damage with (Two Handed Weapons|One Handed Weapons|Quarterstaves|Spears|Crossbows|Bows|Maces|Flails|Staves|Wands|Swords|Axes|Daggers|Claws|Plant Skills|Warcries)$/i,
    build: (m, src) => {
      const target = m[2]!.toLowerCase();
      if (target === 'warcries') {
        return [mkMod('Damage', 'INC', Number(m[1]), src, 0, KeywordFlag.Warcry)];
      }
      if (target === 'plant skills') {
        return [
          {
            ...mkMod('Damage', 'INC', Number(m[1]), src),
            tags: [{ type: 'SkillType', skillType: 'Plant' }],
          },
        ];
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
    pattern: /^(\d+)% (increased|reduced) (Totem|Trap|Grenade|Hazard|Ballista|Thorns|Parry) [Dd]amage$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const kind = m[3]!.toLowerCase();
      if (kind === 'grenade') {
        return [
          {
            ...mkMod('Damage', type, value, src),
            tags: [{ type: 'SkillType', skillType: 'Grenade' }],
          },
        ];
      }
      if (kind === 'hazard') {
        return [
          {
            ...mkMod('Damage', type, value, src),
            tags: [{ type: 'SkillType', skillType: 'Hazard' }],
          },
        ];
      }
      if (kind === 'totem') {
        return [mkMod('Damage', type, value, src, 0, KeywordFlag.Totem)];
      }
      if (kind === 'trap') {
        return [mkMod('Damage', type, value, src, 0, KeywordFlag.Trap)];
      }
      return [mkMod(`${m[3]!.charAt(0).toUpperCase()}${m[3]!.slice(1).toLowerCase()}Damage`, type, value, src)];
    },
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
  // PoE 2 Low Tolerance (Tree:42959): PoB 2 gates "on targets that are not Poisoned" on
  // MultiplierThreshold(PoisonStacks <= 1); keep Magnitude form for unit parity while gating Effect form.
  {
    pattern: /^(\d+)% (increased|reduced) Magnitude of Poison(?: you inflict)? on targets that are not Poisoned$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('AilmentEffect', type, value, src, 0, KeywordFlag.Poison)];
    },
  },
  {
    pattern: /^Critical Hits Poison the enemy$/i,
    build: (_, src) => [
      mkMod('CritPoisonChance', 'BASE', 100, src),
      {
        name: 'PoisonChance',
        type: 'OVERRIDE',
        value: 100,
        flags: 0,
        keywordFlags: 0,
        source: src,
        tags: [{ type: 'Condition', var: 'CriticalStrike' }],
      },
    ],
  },
  // Tacati's Ire: "Poisons you inflict deal Damage 2% faster per Rage"
  {
    pattern: /^Poisons(?: you inflict)? deal [Dd]amage (\d+)% faster per Rage$/i,
    build: (m, src) => [
      {
        ...mkMod('PoisonFaster', 'INC', Number(m[1]), src),
        tags: [{ type: 'Multiplier', var: 'Rage' }],
      },
    ],
  },
  {
    pattern: /^Poisons(?: you inflict)? deal [Dd]amage (\d+)% faster$/i,
    build: (m, src) => [mkMod('PoisonFaster', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(?:Damaging )?Ailments(?: you inflict)? deal [Dd]amage (\d+)% faster$/i,
    build: (m, src) => [mkMod('AilmentFaster', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Ignites you inflict deal Damage (\d+)% faster$/i,
    build: (m, src) => [mkMod('IgniteFaster', 'INC', Number(m[1]), src)],
  },
  // Plaguefinger: "All Damage from Hits Contributes to Poison Magnitude"
  {
    pattern: /^All Damage from Hits Contributes to Poison Magnitude$/i,
    build: (_, src) => [mkMod('AllDamageCanPoison', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) Magnitude of (Damaging Ailments|Non-Damaging Ailments|Ailments|Ignite|Bleeding|Poison|Shock|Chill|Jagged Ground)(?: you (?:inflict|create))?(?: (?:against|with|while|if|when) .+)?$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const kind = m[3]!.toLowerCase();
      const { baseLine, tags: rawTags } = parseConditionalSuffix(m[0]!);
      if (rawTags.length === 0 && /\b(?:against|while|if|when)\b/i.test(baseLine)) {
        return [];
      }
      // skillActorRuntime.ts evaluates damaging-ailment magInc outside CriticalStrike context;
      // keep CriticalStrike gating on non-damaging ailments while preserving non-crit-tagged conditionals (Marked/Cursed/Slowed).
      const isDamagingAilment =
        kind === 'damaging ailments' ||
        kind === 'ignite' ||
        kind === 'bleeding' ||
        kind === 'poison';
      const tags = isDamagingAilment
        ? rawTags.filter((t) => !(t.type === 'Condition' && t.var === 'CriticalStrike'))
        : rawTags;
      const withTags = (mod: Mod): Mod => (tags.length > 0 ? { ...mod, tags } : mod);
      if (kind === 'non-damaging ailments') {
        // PoB 2 ModParser.lua:818-820: expands to EnemyShockMagnitude, EnemyChillMagnitude, EnemyFreezeBuildup
        // Emit WebPoB canonical shock/chill/freeze stats alongside NonDamagingAilmentMagnitude for compatibility.
        return [
          withTags(mkMod('ShockMagnitude', type, value, src)),
          withTags(mkMod('ChillMagnitude', type, value, src)),
          withTags(mkMod('FreezeBuildup', type, value, src)),
          withTags(mkMod('NonDamagingAilmentMagnitude', type, value, src)),
        ];
      }
      const stat =
        kind === 'ignite'
          ? 'IgniteMagnitude'
          : kind === 'bleeding'
            ? 'BleedingMagnitude'
            : kind === 'poison'
              ? 'PoisonMagnitude'
              : kind === 'shock'
                ? 'ShockMagnitude'
                : kind === 'chill'
                  ? 'ChillMagnitude'
                  : kind === 'jagged ground'
                    ? 'JaggedGroundMagnitude'
                    : 'AilmentMagnitude';
      return [withTags(mkMod(stat, type, value, src))];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) (Ignite|Flammability|Poison|Shock|Bleeding|Withered) Magnitude$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      if (m[3]!.toLowerCase() === 'withered') {
        // PoE 2 Withered Magnitude scales Withered ChaosDamageTaken per stack (engine.ts reads WitherEffect)
        return [
          mkMod('WitherEffect', type, value, src),
          mkMod('WitheredMagnitude', type, value, src),
        ];
      }
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
  // PoE 2 Ailment/Poison/Ignite/Bleed/Elemental Ailment Duration (with optional conditional suffixes:
  // Toxic Sludge "against Slowed Enemies", Decrepifying Curse "against Cursed Enemies", Time-Lost Damaging Ailments)
  {
    pattern: /^(\d+)% (increased|reduced) [Dd]uration of (Damaging Ailments|Elemental Ailments|Ailments|Poisons?|Ignites?|Bleedings?|Shocks?|Chills?)(?: you inflict| on Enemies)?(?: (?:against|while|if|when|with) .+)?$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const kind = m[3]!.toLowerCase();
      const { baseLine, tags } = parseConditionalSuffix(m[0]!);
      if (tags.length === 0 && /\b(?:against|while|if|when)\b|\bwith Critical\b/i.test(baseLine)) {
        return [];
      }
      const stat =
        kind === 'damaging ailments'
          ? 'DamagingAilmentDuration'
          : kind === 'elemental ailments'
            ? 'EnemyElementalAilmentDuration'
            : kind === 'ailments'
              ? 'EnemyAilmentDuration'
              : kind.startsWith('poison')
                ? 'EnemyPoisonDuration'
                : kind.startsWith('ignite')
                  ? 'EnemyIgniteDuration'
                  : kind.startsWith('bleed')
                    ? 'EnemyBleedDuration'
                    : kind.startsWith('shock')
                      ? 'EnemyShockDuration'
                      : 'EnemyChillDuration';
      const mod = mkMod(stat, type, value, src);
      return [tags.length > 0 ? { ...mod, tags } : mod];
    },
  },
  {
    pattern: /^(\d+)% increased (Ignite|Bleeding|Poison|Shock|Chill|Duration of Damaging Ailments|Pin|Armour Break|Curse|Hazard|Elemental Infusion|Archon Buff|Minion|Parried Debuff)(?: Duration)?(?: on Enemies)?$/i,
    build: (m, src) => {
      if (m[2]!.toLowerCase() === 'duration of damaging ailments') {
        return [mkMod('DamagingAilmentDuration', 'INC', Number(m[1]), src)];
      }
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
  // Elemental Exposure Effect (Cremation Tree:19715, PoB 2 ModParser.lua:702-704)
  {
    pattern: /^(\d+)% increased (Fire|Cold|Lightning) Exposure Effect$/i,
    build: (m, src) => {
      const el = `${m[2]!.charAt(0).toUpperCase()}${m[2]!.slice(1).toLowerCase()}`;
      return [mkMod(`${el}ExposureEffect`, 'INC', Number(m[1]), src)];
    },
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

  // Conditional Damage (check canonical parseConditionalSuffix first so Elemental Ailment / Exposure / Herald of Blood
  // stay distinct, then fall back to compositionalModParser; return [] for unmatched more/less so later rules run!)
  {
    pattern: /^(\d+)% (increased|reduced|more|less) (Attack |Spell |Melee |Projectile |Area |Elemental |Fire |Cold |Lightning |Physical |Chaos )?Damage (?:with Hits )?(?:while|when|against|if) .+$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const scope = (m[3] ?? '').trim().toLowerCase();
      const { baseLine, tags } = parseConditionalSuffix(m[0]!);
      if (tags.length > 0) {
        const baseMatch = baseLine.match(
          /^\d+% (?:increased|reduced|more|less) (?:(Attack|Spell|Melee|Projectile|Area|Elemental|Fire|Cold|Lightning|Physical|Chaos) )?Damage( with Hits)?$/i,
        );
        if (baseMatch) {
          const hitFlag = baseMatch[2] ? ModFlag.Hit : 0;
          if (scope === 'attack') {
            return [{ ...mkMod('Damage', type, value, src, ModFlag.Attack | hitFlag), tags }];
          }
          if (scope === 'spell') {
            return [{ ...mkMod('Damage', type, value, src, ModFlag.Spell | hitFlag), tags }];
          }
          if (scope === 'melee') {
            return [{ ...mkMod('Damage', type, value, src, ModFlag.Melee | hitFlag), tags }];
          }
          if (scope === 'projectile') {
            return [{ ...mkMod('Damage', type, value, src, ModFlag.Projectile | hitFlag), tags }];
          }
          if (scope === 'area') {
            return [{ ...mkMod('Damage', type, value, src, ModFlag.Area | hitFlag), tags }];
          }
          if (scope) {
            const cap = scope.charAt(0).toUpperCase() + scope.slice(1);
            return [{ ...mkMod(`${cap}Damage`, type, value, src, hitFlag), tags }];
          }
          return [{ ...mkMod('Damage', type, value, src, hitFlag), tags }];
        }
      }
      const comp = parseModCompositional(m[0]!, src);
      if (comp.length > 0 && comp.every((c) => (c.tags?.length ?? 0) > 0)) return comp;
      // Only absorb unmatched "increased" lines into ConditionalDamage; let specialized more/less/reduced rules match below
      if (m[2]!.toLowerCase() !== 'increased') return [];
      if (scope === 'attack') return [mkMod('ConditionalDamage', type, value, src, ModFlag.Attack)];
      if (scope === 'spell') return [mkMod('ConditionalDamage', type, value, src, ModFlag.Spell)];
      if (scope === 'melee') return [mkMod('ConditionalDamage', type, value, src, ModFlag.Melee)];
      if (scope) {
        const cap = scope.charAt(0).toUpperCase() + scope.slice(1);
        return [mkMod(`Conditional${cap}Damage`, type, value, src)];
      }
      return [mkMod('ConditionalDamage', type, value, src)];
    },
  },
  // Empowered Attacks Gain X% as Extra Damage (Cremating Cries, Hail) — gated on EmpoweredAttack so it never leaks unconditionally
  {
    pattern: /^Empowered Attacks Gain (\d+(?:\.\d+)?)% of (?:(Physical|Fire|Cold|Lightning|Elemental) )?Damage as Extra (Fire|Cold|Lightning|Chaos) [Dd]amage$/i,
    build: (m, src) => {
      const from = m[2] ? `${m[2].charAt(0).toUpperCase()}${m[2].slice(1).toLowerCase()}DamageGainAs` : 'DamageGainAs';
      const to = `${m[3]!.charAt(0).toUpperCase()}${m[3]!.slice(1).toLowerCase()}`;
      return [
        {
          ...mkMod(`${from}${to}`, 'BASE', Number(m[1]), src, ModFlag.Attack),
          tags: [{ type: 'Condition', var: 'EmpoweredAttack' }],
        },
      ];
    },
  },
  {
    pattern: /^(Empowered Attacks|Ancestrally Boosted Attacks|Attack Skills|Channelling Skills|Triggered Spells|Invocated Spells|Herald Skills|Projectiles) deal (\d+)% increased (?:Spell )?Damage(?: .+)?$/i,
    build: (m, src) => {
      const subject = m[1]!.toLowerCase();
      const val = Number(m[2]);
      // PoB 2 ModParser.lua:2705-2707 — MUST route Empowered & Ancestrally Boosted BEFORE compositionalModParser
      // so they scale exerted/boosted multipliers instead of leaking as unconditional Damage INC!
      if (subject === 'empowered attacks') {
        return [mkMod('EmpoweredIncrease', 'INC', val, src, ModFlag.Attack)];
      }
      if (subject === 'ancestrally boosted attacks') {
        return [mkMod('AncestralBoostIncrease', 'INC', val, src, ModFlag.Attack)];
      }
      if (subject === 'channelling skills') {
        return [
          {
            ...mkMod('Damage', 'INC', val, src),
            tags: [{ type: 'Condition', var: 'Channelling' }],
          },
        ];
      }
      if (subject === 'triggered spells' || subject === 'invocated spells') {
        return [
          {
            ...mkMod('Damage', 'INC', val, src, ModFlag.Spell),
            tags: [{ type: 'SkillType', skillType: 'Triggered' }],
          },
        ];
      }
      if (subject === 'herald skills') {
        return [
          {
            ...mkMod('Damage', 'INC', val, src),
            tags: [{ type: 'SkillType', skillType: 'Herald' }],
          },
        ];
      }
      const { baseLine, tags } = parseConditionalSuffix(m[0]!);
      if (tags.length > 0) {
        const hitFlag = /\bwith Hits\b/i.test(baseLine) ? ModFlag.Hit : 0;
        if (subject === 'projectiles') {
          return [{ ...mkMod('Damage', 'INC', val, src, ModFlag.Projectile | hitFlag), tags }];
        }
        if (subject === 'attack skills') {
          return [{ ...mkMod('Damage', 'INC', val, src, ModFlag.Attack | hitFlag), tags }];
        }
      }
      const comp = parseModCompositional(m[0]!, src);
      if (comp.length > 0) return comp;
      const hasTrailingCondition = /\b(?:against|while|when|if|per|for each)\b/i.test(m[0]!);
      if (subject === 'attack skills' && !hasTrailingCondition) {
        return [mkMod('Damage', 'INC', val, src, ModFlag.Attack)];
      }
      if (subject === 'projectiles' && !hasTrailingCondition) {
        return [mkMod('Damage', 'INC', val, src, ModFlag.Projectile)];
      }
      const flags = subject.includes('attack')
        ? ModFlag.Attack
        : subject.includes('spell')
          ? ModFlag.Spell
          : subject.includes('projectile')
            ? ModFlag.Projectile
            : 0;
      return [mkMod('ConditionalDamage', 'INC', val, src, flags)];
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
    build: (m, src) => [mkMod('Speed', 'INC', Number(m[1]), src, ModFlag.Cast, KeywordFlag.Totem)],
  },
  {
    pattern: /^Attacks used by (?:Totems|Ballistas) have (\d+)% increased Attack Speed$/i,
    build: (m, src) => [mkMod('Speed', 'INC', Number(m[1]), src, ModFlag.Attack, KeywordFlag.Totem)],
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
    build: (m, src) => [
      // Official PoB 2 ModParser.lua: chance-to-gain Arcane Surge on Critical Hit is gated by Condition:CritRecently
      mkMod('ArcaneSurgeOnCritChance', 'BASE', Number(m[1]), src),
      {
        ...mkMod('Condition:ArcaneSurge', 'FLAG', true, src),
        tags: [{ type: 'Condition', var: 'CritRecently' }],
      },
    ],
  },
  {
    pattern: /^(?:Gain Arcane Surge (?:on Critical Hit|when you (?:deal a Critical Hit|spend .+|Shapeshift .+))|You have Arcane Surge)$/i,
    build: (_, src) => [mkMod('Condition:ArcaneSurge', 'FLAG', true, src)],
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
  // 4b. Wave 4J PoE 2 Mechanics (Random Element Gain, Exposure, Reality Rending,
  //     Point Blank, Lucky Hits, Heavy Stun, Shield Scaling, Leopold, Warcry Empower)
  // =========================================================================

  // Turning of the Seasons (Tree:62523), Node:7197, Hidden Forms (Tree:479):
  // CalcOffence.lua:1337-1348 splits DamageGainAsRandom evenly (1/3 each) in AVERAGE mode.
  {
    pattern: /^Gain (\d+(?:\.\d+)?)% of (?:(Physical) )?Damage as Extra Damage of a [Rr]andom Element( while Shapeshifted)?$/i,
    build: (m, src) => {
      const perEle = Number(m[1]) / 3;
      const prefix = m[2] ? 'PhysicalDamageGainAs' : 'DamageGainAs';
      const tags = m[3] ? [{ type: 'Condition' as const, var: 'Shapeshifted' }] : undefined;
      return (['Fire', 'Cold', 'Lightning'] as const).map((el) => ({
        name: `${prefix}${el}`,
        type: 'BASE' as const,
        value: perEle,
        flags: 0,
        keywordFlags: 0,
        source: src,
        ...(tags ? { tags } : {}),
      }));
    },
  },
  // Turning of the Seasons (Tree:62523): "Enemies in your Presence have Exposure" (20% base Exposure)
  {
    pattern: /^Enemies in your Presence have Exposure$/i,
    build: (_, src) =>
      (['Fire', 'Cold', 'Lightning'] as const).map((el) => ({
        name: `${el}Exposure`,
        type: 'BASE' as const,
        value: 20,
        flags: 0,
        keywordFlags: 0,
        source: src,
        target: 'enemy' as const,
      })),
  },
  {
    pattern: /^(?:Hits )?Inflict (Fire|Cold|Lightning|Elemental) Exposure(?: on Hit)?$/i,
    build: (m, src) => {
      const kind = m[1]!.toLowerCase();
      const elems =
        kind === 'elemental'
          ? (['Fire', 'Cold', 'Lightning'] as const)
          : ([m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase()] as const);
      return elems.map((el) => ({
        name: `${el}Exposure`,
        type: 'BASE' as const,
        value: 20,
        flags: 0,
        keywordFlags: 0,
        source: src,
        target: 'enemy' as const,
      }));
    },
  },
  // Acolyte of Chayula Reality Rending (Tree:25781): weighted expected Extra Damage
  {
    pattern: /^(\d+(?:\.\d+)?)% chance to Gain (\d+(?:\.\d+)?)% of (?:(Physical|Fire|Cold|Lightning|Elemental) )?Damage(?: with Hits)? as Extra (Fire|Cold|Lightning|Chaos|Physical) Damage$/i,
    build: (m, src) => {
      const expectedPct = (Number(m[1]) / 100) * Number(m[2]);
      const fromType = m[3] ? `${m[3].charAt(0).toUpperCase()}${m[3].slice(1).toLowerCase()}` : '';
      const toType = `${m[4]!.charAt(0).toUpperCase()}${m[4]!.slice(1).toLowerCase()}`;
      return [mkMod(`${fromType}DamageGainAs${toType}`, 'BASE', expectedPct, src)];
    },
  },
  // Dimensional Weakspot (Tree:2344): fractional elemental resistance inversion chance (CalcOffence.lua:4362)
  {
    pattern: /^Hits have (\d+(?:\.\d+)?)% chance to treat Enemy Monster Elemental Resistance values as inverted$/i,
    build: (m, src) => [mkMod('HitsInvertEleResChance', 'BASE', Number(m[1]), src, ModFlag.Hit)],
  },
  // Repeating Explosives (Tree:65468): CalcOffence.lua:1281-1284
  {
    pattern: /^Grenades have (\d+)% chance to activate a second time$/i,
    build: (m, src) => [mkMod('GrenadeActivateTwice', 'BASE', Number(m[1]), src)],
  },
  // PoE 2 Point Blank (Tree:41875): 20% more Hit damage up to 3.5m, scaling to 0% at 7m
  // Emit both the exact DistanceRamp MORE mod and semantic PointBlank FLAG (engine.ts dedupes via alreadyHasPbRamp)
  {
    pattern: /^Projectiles deal (\d+)% more Hit [Dd]amage to targets in the first 3\.5 metres(?: of their movement(?:, scaling down with distance travelled to reach 0% after 7 metres)?)?$/i,
    build: (m, src) => [
      mkMod('PointBlank', 'FLAG', true, src),
      {
        name: 'Damage',
        type: 'MORE',
        value: Number(m[1]),
        flags: ModFlag.Projectile | ModFlag.Hit,
        keywordFlags: 0,
        source: src,
        tags: [{ type: 'Condition', var: 'DistanceRamp:35:1,70:0' }],
      },
    ],
  },
  // Wild Storm (15%) / Pure Power (10%) / Heft / Ryslatha's Coil: more/less Max/Min <Type> Damage
  {
    pattern: /^(\d+)% (more|less) (Maximum|Minimum) (Physical|Fire|Cold|Lightning|Chaos) (?:(Attack) )?Damage$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const bound = m[3]!.toLowerCase() === 'maximum' ? 'Max' : 'Min';
      const dt = `${m[4]!.charAt(0).toUpperCase()}${m[4]!.slice(1).toLowerCase()}`;
      const flags = m[5] ? ModFlag.Attack : 0;
      return [mkMod(`${dt}${bound}Damage`, 'MORE', val, src, flags)];
    },
  },
  // Heart of the Well / Lucky Hit chance (ModParser.lua:4336)
  {
    pattern: /^(\d+)% chance for (?:(Lightning|Fire|Cold|Elemental|Physical|Chaos) )?Damage with Hits to be Lucky$/i,
    build: (m, src) => {
      const prefix = m[2] ? `${m[2].charAt(0).toUpperCase()}${m[2].slice(1).toLowerCase()}` : '';
      return [mkMod(`${prefix}LuckyHitsChance`, 'BASE', Number(m[1]), src, ModFlag.Hit)];
    },
  },
  // Skullcrusher (Tree:2645): "20% more Damage against Heavy Stunned Enemies with Maces"
  {
    pattern: /^(\d+)% (more|less|increased|reduced) Damage against Heavy Stunned Enemies with (Two Handed Weapons|One Handed Weapons|Quarterstaves|Spears|Crossbows|Bows|Maces|Flails|Staves|Wands|Swords|Axes|Daggers|Claws)$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [
        {
          name: 'Damage',
          type,
          value,
          flags: weaponToFlag(m[3]!),
          keywordFlags: 0,
          source: src,
          tags: [{ type: 'Condition', var: 'EnemyHeavyStunned' }],
        },
      ];
    },
  },
  // Greatest Defence (Tree:27687): "4% increased Attack Damage per 75 Item Armour and Evasion Rating on Equipped Shield"
  {
    pattern: /^(\d+)% increased Attack Damage per (\d+) (?:Item )?Armour (?:and|or) Evasion(?: Rating)? on (?:Equipped )?Shield$/i,
    build: (m, src) => [
      {
        name: 'Damage',
        type: 'INC',
        value: Number(m[1]),
        flags: ModFlag.Attack,
        keywordFlags: 0,
        source: src,
        tags: [{ type: 'PerStat', stat: 'ShieldArmourAndEvasion', div: Number(m[2]) }],
      },
    ],
  },
  // Warcries Empower an additional Attack (ModParser.lua:5692-5693)
  {
    pattern: /^Warcries Empower (an|\d+) additional Attacks?$/i,
    build: (m, src) => {
      const n = m[1]!.toLowerCase() === 'an' ? 1 : Number(m[1]);
      return [
        mkMod('WarcryExtraEmpowers', 'BASE', n, src),
        mkMod('ExtraEmpoweredAttacks', 'BASE', n, src),
      ];
    },
  },
  // Leopold's Applause (ModParser.lua:3691)
  {
    pattern: /^(?:Your Hits|Elemental Penetration|Elemental Damage with Hits) can Penetrate (?:Elemental )?Resistances down to (?:a minimum of )?(-?\d+)%$/i,
    build: (m, src) => [
      mkMod('ElementalPenetrationMinimum', 'OVERRIDE', -Math.abs(Number(m[1])), src),
    ],
  },
  // Spear projectile distance notable: "40% increased Projectile Damage with Spears while there are no Enemies within 3m"
  {
    pattern: /^(\d+)% (increased|reduced) Projectile Damage with Spears while there are no Enemies within (\d+(?:\.\d+)?)m$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [
        {
          name: 'Damage',
          type,
          value,
          flags: ModFlag.Attack | ModFlag.Projectile,
          keywordFlags: 0,
          source: src,
          tags: [{ type: 'Condition', var: `EnemyDistanceGt:${Math.round(Number(m[3]) * 10)}` }],
        },
      ];
    },
  },

  // =========================================================================
  // 4c. Wave 4M PoE 2 Mechanics (Block Scaling, Elemental Ailment Multipliers,
  //     Mystical Rage, Full Salvo, Marked/Incision, PoisonStacksMax, Implants)
  // =========================================================================

  // Lay Siege (Tree:45599) & Offensive Stance (Tree:10681): "1% increased Damage per 1% Chance to Block"
  {
    pattern: /^(\d+)% (increased|reduced) (?:(Attack|Spell|Melee|Projectile|Physical|Elemental|Fire|Cold|Lightning|Chaos) )?Damage per (\d+)% Chance to Block$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const scope = (m[3] ?? '').toLowerCase();
      const flags =
        scope === 'attack'
          ? ModFlag.Attack
          : scope === 'spell'
            ? ModFlag.Spell
            : scope === 'melee'
              ? ModFlag.Melee
              : scope === 'projectile'
                ? ModFlag.Projectile
                : 0;
      const statName =
        scope === 'physical' ||
        scope === 'elemental' ||
        scope === 'fire' ||
        scope === 'cold' ||
        scope === 'lightning' ||
        scope === 'chaos'
          ? `${scope.charAt(0).toUpperCase()}${scope.slice(1)}Damage`
          : 'Damage';
      return [
        {
          ...mkMod(statName, type, value, src, flags),
          tags: [{ type: 'PerStat', stat: 'BlockChance', div: Number(m[4]) }],
        },
      ];
    },
  },
  // Harness the Elements (Tree:12611) & Stormbreaker (Tree:43139)
  {
    pattern: /^(\d+)% (increased|reduced) (?:(Elemental) )?Damage(?: with Hits(?: and Ailments)?)? for each type of Elemental Ailment on (?:the )?Enemy$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const statName = m[3] ? 'ElementalDamage' : 'Damage';
      return [
        {
          ...mkMod(statName, type, value, src),
          tags: [{ type: 'Multiplier', var: 'EnemyElementalAilmentCount' }],
        },
      ];
    },
  },
  // Mystical Rage (Tree:52764): "Every Rage also grants 2% increased Spell Damage"
  {
    pattern: /^Every Rage also grants (\d+)% increased Spell Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src, ModFlag.Spell),
        tags: [{ type: 'Multiplier', var: 'Rage' }],
      },
    ],
  },
  // Full Salvo (Tree:33887): "25% increased Damage with Crossbows for each type of Ammunition fired in the past 10 seconds"
  {
    pattern: /^(\d+)% (increased|reduced) Damage with Crossbows for each type of Ammunition fired in the past \d+ seconds$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [
        {
          ...mkMod('Damage', type, value, src, ModFlag.Crossbow),
          tags: [{ type: 'Multiplier', var: 'DifferentAmmoFired' }],
        },
      ];
    },
  },
  // Demolitionist (Tree:38570): "Gain 4% of Damage as Extra Fire Damage for every different Grenade fired in the past 8 seconds"
  {
    pattern: /^Gain (\d+(?:\.\d+)?)% of (?:(Physical) )?Damage as Extra (Fire|Cold|Lightning|Chaos) Damage for every different Grenade fired in the past \d+ seconds$/i,
    build: (m, src) => {
      const prefix = m[2] ? 'PhysicalDamageGainAs' : 'DamageGainAs';
      const el = `${m[3]!.charAt(0).toUpperCase()}${m[3]!.slice(1).toLowerCase()}`;
      return [
        {
          ...mkMod(`${prefix}${el}`, 'BASE', Number(m[1]), src),
          tags: [{ type: 'Multiplier', var: 'DifferentGrenadeFired' }],
        },
      ];
    },
  },
  // Escalating Mayhem (Tree:42032): "10% increased Damage for each Hazard triggered Recently, up to 50%"
  {
    pattern: /^(\d+)% increased Damage for each Hazard triggered Recently,\s*up to (\d+)%$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src),
        tags: [
          {
            type: 'Multiplier',
            var: 'HazardTriggeredRecently',
            limit: Number(m[2]),
            limitTotal: true,
          } as unknown as ModTag,
        ],
      },
    ],
  },
  // Marked for Sickness (Tree:63830): "Enemies you Mark take 10% increased Damage"
  {
    pattern: /^Enemies you Mark take (\d+)% increased Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('DamageTaken', 'INC', Number(m[1]), src),
        target: 'enemy',
        tags: [{ type: 'Condition', var: 'Marked|EnemyMarked' }],
      },
    ],
  },
  // Thousand Cuts (Tree:42714): "Enemies you apply Incision to take 2% increased Physical Damage per Incision"
  {
    pattern: /^Enemies you apply Incision to take (\d+)% increased Physical Damage per Incision$/i,
    build: (m, src) => [
      {
        ...mkMod('PhysicalDamageTaken', 'INC', Number(m[1]), src),
        target: 'enemy',
        tags: [{ type: 'Multiplier', var: 'IncisionStack' }],
      },
    ],
  },
  // Ancestral Unity (Tree:62609) & Supportive Ancestors (Tree:19249): Totem Speed per Summoned Totem
  {
    pattern: /^Attacks used by Totems have (\d+)% increased Attack Speed per Summoned Totem$/i,
    build: (m, src) => [
      {
        ...mkMod('Speed', 'INC', Number(m[1]), src, ModFlag.Attack, KeywordFlag.Totem),
        tags: [{ type: 'Multiplier', var: 'ActiveTotem' }],
      },
    ],
  },
  {
    pattern: /^Spells Cast by Totems have (\d+)% increased Cast Speed per Summoned Totem$/i,
    build: (m, src) => [
      {
        ...mkMod('Speed', 'INC', Number(m[1]), src, ModFlag.Cast, KeywordFlag.Totem),
        tags: [{ type: 'Multiplier', var: 'ActiveTotem' }],
      },
    ],
  },
  // Wave 4O PoE 2 Semantic Flags (PoB 2 ModParser.lua:2709, 2774-2775, 3191, 3699)
  {
    pattern: /^Every second Slam Skill you use yourself is Ancestrally Boosted$/i,
    build: (_, src) => [
      { ...mkMod('AncestralEmpowerment', 'FLAG', true, src), tags: [{ type: 'SkillType', skillType: 'Slam' }] },
      { ...mkMod('Condition:AncestrallyBoosted', 'FLAG', true, src), tags: [{ type: 'SkillType', skillType: 'Slam' }] },
    ],
  },
  {
    pattern: /^Chance to Hit with Attacks can exceed 100%$/i,
    build: (_, src) => [
      { ...mkMod('HitChanceCanExceed100', 'FLAG', true, src), tags: [{ type: 'SkillType', skillType: 'Attack' }] },
    ],
  },
  {
    pattern: /^Gain additional Critical Hit Chance equal to (\d+)% of excess chance to Hit with Attacks$/i,
    build: (m, src) => [
      {
        ...mkMod('CritChance', 'BASE', Number(m[1]) / 100, src),
        tags: [
          { type: 'Multiplier', var: 'ExcessHitChance' },
          { type: 'SkillType', skillType: 'Attack' },
        ],
      },
    ],
  },
  {
    pattern: /^Increases and Reductions to Companion Damage also apply to you$/i,
    build: (_, src) => [mkMod('CompanionDamageAppliesToPlayer', 'FLAG', true, src)],
  },
  {
    pattern: /^Spells for which this Sacrifice was fully made deal (\d+)% more Damage$/i,
    build: (m, src) => [
      mkMod('EldritchEmpowerment', 'FLAG', true, src),
      {
        ...mkMod('Damage', 'MORE', Number(m[1]), src, ModFlag.Spell),
        tags: [{ type: 'Condition', var: 'EldritchEmpowermentSacrifice' }],
      },
    ],
  },
  {
    pattern: /^Spells deal (\d+)% more Damage when Sacrificing Energy Shield$/i,
    build: (_, src) => [mkMod('EldritchEmpowerment', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+)% chance for (?:(Mace) )?(Slam|Strike) Skills you use yourself to cause (?:an additional )?Aftershocks?(?:, dealing.*)?$/i,
    build: (m, src) => [
      {
        ...mkMod('AftershockChance', 'BASE', Number(m[1]), src, m[2] ? ModFlag.Mace : 0),
        tags: [{ type: 'SkillType', skillType: m[3]!.toLowerCase() === 'strike' ? 'Strike' : 'Slam' }],
      },
    ],
  },
  // Wave 4O-B: Stripped Defences / Exposure extra resistance lowering (PoB 2 ModParser.lua:2975-2977, 4629-4634)
  {
    pattern: /^Exposure you inflict lowers (?:the affected )?Resistances? by an additional (\d+)%$/i,
    build: (m, src) => [mkMod('ExtraExposure', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Exposure you inflict applies an extra -?(\d+)% to the affected Resistance$/i,
    build: (m, src) => [mkMod('ExtraExposure', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(Fire|Cold|Lightning) Exposure you inflict (?:lowers (?:total )?\1 Resistance by an (?:extra|additional) |applies an extra -?)(\d+)%(?: to \1 Resistance)?$/i,
    build: (m, src) => [mkMod(`Extra${m[1]}Exposure`, 'BASE', Number(m[2]), src)],
  },
  // Electrocution (PoB 2 ModParser.lua:1398, 3861): "Enemies you Electrocute have 20% increased Damage taken"
  {
    pattern: /^Enemies you Electrocute have (\d+)% (increased|reduced) Damage taken$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [
        {
          ...mkMod('EnemyDamageTaken', type, value, src),
          tags: [{ type: 'Condition', var: 'EnemyElectrocuted' }],
        },
      ];
    },
  },
  // The Molten One's Gift (PoB 2 ModParser.lua:5652-5653)
  {
    pattern: /^Fully Broken Armour (?:you inflict also increases|effects also apply to) Fire Damage Taken from Hits$/i,
    build: (_, src) => [mkMod('ArmourBreakFireDamageTaken', 'FLAG', true, src)],
  },
  // Strike Twice (PoB 2 ModParser.lua:3408)
  {
    pattern: /^Targets can be affected by two of your Shocks at the same time$/i,
    build: (_, src) => [
      mkMod('ShockCanStack', 'FLAG', true, src),
      mkMod('ShockStacksMax', 'OVERRIDE', 2, src),
    ],
  },
  // Wyvern's Breath / Shapeshifting Elemental Ailment Chance (and other conditional Elemental Ailment Chance lines)
  {
    pattern: /^(\d+)% (increased|reduced) chance to inflict Elemental Ailments(?: (if|while|against|for|per) .+)$/i,
    build: (m, src) => {
      const { baseLine, tags } = parseConditionalSuffix(m[0]);
      if (tags.length === 0 || baseLine === m[0]) return [];
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [{ ...mkMod('ElementalAilmentChance', type, value, src), tags }];
    },
  },
  // Bleeding Chance on Critical Hit with Attacks/Spells
  {
    pattern: /^(\d+)% chance to inflict Bleeding on Critical Hit(?: with (Attacks|Spells))?$/i,
    build: (m, src) => {
      const flags =
        m[2]?.toLowerCase() === 'attacks'
          ? ModFlag.Attack
          : m[2]?.toLowerCase() === 'spells'
            ? ModFlag.Spell
            : 0;
      return [
        {
          ...mkMod('BleedChance', 'BASE', Number(m[1]), src, flags),
          tags: [{ type: 'Condition', var: 'CriticalStrike' }],
        },
      ];
    },
  },
  // Entropic Incarnation: "Minions gain 10% of Physical Damage as Chaos Damage"
  {
    pattern: /^Minions gain (\d+)% of (Physical|Fire|Cold|Lightning|Elemental) Damage as (?:Extra )?(Fire|Cold|Lightning|Chaos|Physical) Damage$/i,
    build: (m, src) => [
      mkMod(`Minion${m[2]}DamageGainAs${m[3]}`, 'BASE', Number(m[1]), src, 0, KeywordFlag.Minion),
    ],
  },
  // Pinpoint Shot: "Attacks gain increased Accuracy Rating equal to their Critical Hit Chance"
  {
    pattern: /^Attacks gain increased Accuracy Rating equal to their Critical Hit Chance$/i,
    build: (_, src) => [mkMod('AccuracyFromCritChance', 'FLAG', true, src, ModFlag.Attack)],
  },
  // Non-ascendancy Unholy Might triggers (PoB 2 ModParser.lua:4692, 5505)
  {
    pattern: /^Gain Unholy Might on Block for \d+ seconds$/i,
    build: (_, src) => [
      {
        ...mkMod('Condition:UnholyMight', 'FLAG', true, src),
        tags: [{ type: 'Condition', var: 'BlockedRecently' }],
      },
    ],
  },
  {
    pattern: /^Gain Unholy Might during Flask effect$/i,
    build: (_, src) => [
      {
        ...mkMod('Condition:UnholyMight', 'FLAG', true, src),
        tags: [{ type: 'Condition', var: 'UsingFlask' }],
      },
    ],
  },
  // Left / Right Equipped Ring bonus effect (PoB 2 ModParser.lua:5012)
  {
    pattern: /^(\d+)% (increased|reduced) bonuses? gained from (left|right) Equipped Ring$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const stat = m[3]!.toLowerCase() === 'left' ? 'Ring1Effect' : 'Ring2Effect';
      return [mkMod(stat, type, value, src)];
    },
  },
  // Fortified Location: "10% increased Attack Damage / Armour and Evasion Rating per Summoned Totem in your Presence"
  {
    pattern: /^(\d+)% (increased|reduced) (Attack Damage|Armour and Evasion Rating) per Summoned Totem(?: in your Presence)?$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const isAtk = m[3]!.toLowerCase().startsWith('attack');
      return [
        {
          ...mkMod(isAtk ? 'Damage' : 'ArmourAndEvasion', type, value, src, isAtk ? ModFlag.Attack : 0),
          tags: [{ type: 'Multiplier', var: 'ActiveTotem' }],
        },
      ];
    },
  },
  // Bonded Runic Ward & Spell Crit Armour Break (PoE 2 Idol / Rune Bonded mods)
  {
    pattern: /^Break Armour on Critical Hit with Spells equal to (\d+)% of Physical Damage dealt$/i,
    build: (m, src) => [mkMod('SpellCritBreakArmourPct', 'BASE', Number(m[1]), src, ModFlag.Spell)],
  },
  {
    pattern: /^Gain (\d+)% of maximum Life as Extra maximum Runic Ward$/i,
    build: (m, src) => [mkMod('LifeGainAsRunicWard', 'BASE', Number(m[1]), src)],
  },
  // Wave 4P: Blood Mage / Unique Chaos Gain per Life Cost & Additional Life Cost
  {
    pattern: /^Skills gain (\d+)% of Damage as (?:Extra )?(Physical|Fire|Cold|Lightning|Chaos) Damage per (\d+) Life Cost$/i,
    build: (m, src) => [
      {
        ...mkMod(`DamageGainAs${m[2]}`, 'BASE', Number(m[1]), src),
        tags: [{ type: 'PerStat', stat: 'LifeCost', div: Number(m[3]) }],
      },
    ],
  },
  {
    pattern: /^Non-Channelling Spells cost an additional (\d+)% of your maximum Life$/i,
    build: (m, src) => [mkMod('NonChannellingSpellLifeCostPct', 'BASE', Number(m[1]), src)],
  },
  // Casting Cascade (PoB 2 ConfigOptions.lua:1439)
  {
    pattern: /^(\d+)% (increased|reduced) Cast Speed for each different Spell you(?:'ve| have) Cast in the last (?:\d+|eight) seconds$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [
        {
          ...mkMod('Speed', type, value, src, ModFlag.Cast),
          tags: [{ type: 'Multiplier', var: 'NonInstantSpellCastRecently' }],
        },
      ];
    },
  },
  // One with the Storm: Quarterstaff Skills consuming Power Charges count as +1
  {
    pattern: /^Quarterstaff Skills that consume Power Charges count as consuming an additional Power Charge$/i,
    build: (_, src) => [mkMod('QuarterstaffSkillsConsumeAdditionalPowerCharge', 'FLAG', true, src)],
  },
  // Totem Area of Effect / Mighty Trunk
  {
    pattern: /^(\d+)% (increased|reduced) Area of Effect for Skills used by Totems$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [mkMod('AreaOfEffect', type, value, src, 0, KeywordFlag.Totem)];
    },
  },
  // Boon of the Beast (Shapeshift to Human Spell Damage ramp)
  {
    pattern: /^When you Shapeshift to Human form, gain (\d+)% increased Spell Damage per second you were Shapeshifted, up to a maximum of (\d+)%, for \d+ seconds$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src, ModFlag.Spell),
        tags: [
          { type: 'Condition', var: 'ShapeshiftedToHumanRecently' },
          {
            type: 'Multiplier',
            var: 'SecondsShapeshifted',
            limit: Number(m[2]),
            limitTotal: true,
          } as unknown as ModTag,
        ],
      },
    ],
  },
  // Invigorating Archon & Catalysis
  {
    pattern: /^Archon Buffs also grant \+(\d+)% to all Elemental Resistances$/i,
    build: (m, src) => [
      {
        ...mkMod('ElementalResist', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'ArchonBuff' }],
      },
    ],
  },
  {
    pattern: /^Archon Buffs also grant (\d+)% increased Movement Speed$/i,
    build: (m, src) => [
      {
        ...mkMod('MovementSpeed', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'ArchonBuff' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% of Physical Damage from Hits taken as Damage of a Random Element$/i,
    build: (m, src) => [mkMod('PhysicalDamageTakenAsRandomElement', 'BASE', Number(m[1]), src)],
  },
  // Wave 4Q: Demolitionist (split 2-line & single-line), Penetrate (split 2-line & single-line), Engineered Blaze, Marked for Death, Splitting Ground, Critical Weakness, Intimidate
  {
    pattern: /^Gain (\d+)% of Damage as Extra (Fire|Cold|Lightning|Chaos|Physical) Damage for(?: every different Grenade fired in the past \d+ seconds)?$/i,
    build: (m, src) => [
      {
        ...mkMod(`DamageGainAs${m[2]}`, 'BASE', Number(m[1]), src),
        tags: [{ type: 'Multiplier', var: 'DifferentGrenadeFired' }],
      },
    ],
  },
  {
    pattern: /^(?:Attacks using your Weapons have Added Physical Damage equal )?to (\d+)% of the Accuracy Rating on the Weapon$/i,
    build: (m, src) => [mkMod('WeaponAccuracyAsAddedPhysPct', 'BASE', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^(\d+)% (increased|reduced) Area of Effect for Attacks per Enemy you(?:'ve| have) Ignited in the last \d+ seconds,\s*up to (\d+)%$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [
        {
          ...mkMod('AreaOfEffect', type, value, src, ModFlag.Attack),
          tags: [
            {
              type: 'Multiplier',
              var: 'EnemyIgnitedRecently',
              limit: Number(m[3]),
              limitTotal: true,
            } as unknown as ModTag,
          ],
        },
      ];
    },
  },
  {
    pattern: /^Culling Strike against Enemies you Mark$/i,
    build: (_, src) => [
      {
        ...mkMod('CullingStrike', 'FLAG', true, src),
        tags: [{ type: 'Condition', var: 'EnemyMarked' }],
      },
    ],
  },
  {
    pattern: /^Skills which create Fissures have an? (\d+)% chance to create an additional Fissure$/i,
    build: (m, src) => [mkMod('AdditionalFissureChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Critical Hits with Spells apply (\d+) Stacks? of Critical Weakness$/i,
    build: (m, src) => [mkMod('ApplyCriticalWeaknessOnSpellCrit', 'BASE', Number(m[1]), src, ModFlag.Spell)],
  },
  {
    pattern: /^(\d+)% chance to Intimidate Enemies for \d+ seconds on Hit$/i,
    build: (m, src) => [mkMod('ChanceToIntimidateOnHit', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% of Evasion Rating also grants Elemental Damage reduction$/i,
    build: (m, src) => [mkMod('EvasionAsEleReductionPct', 'BASE', Number(m[1]), src)],
  },
  // Wave 4R: PoE 2 Exposure sources (PoB 2 CalcPerform.lua:188-190 hasExposureSource) & utility semantic flags
  {
    pattern: /^Hits that Heavy Stun inflict (Fire|Cold|Lightning) Exposure$/i,
    build: (m, src) => [mkMod(`${m[1]}ExposureChance`, 'BASE', 100, src)],
  },
  {
    pattern: /^(\d+)% chance to inflict (Fire|Cold|Lightning) Exposure on (?:Critical )?Hit$/i,
    build: (m, src) => [mkMod(`${m[2]}ExposureChance`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Inflicts? (Fire|Cold|Lightning) Exposure on Hit$/i,
    build: (m, src) => [mkMod(`${m[1]}ExposureChance`, 'BASE', 100, src)],
  },
  {
    pattern: /^Skills have (\d+)% chance to not remove (Charges|Elemental Infusions) but still count as consuming them$/i,
    build: (m, src) => [
      mkMod(
        m[2]!.toLowerCase().includes('infusion') ? 'ChanceToNotRemoveInfusions' : 'ChanceToNotRemoveCharges',
        'BASE',
        Number(m[1]),
        src,
      ),
    ],
  },
  {
    pattern: /^Break (\d+)% of Armour on (Heavy Stunning|Pinning) an Enemy$/i,
    build: (m, src) => [
      mkMod(
        m[2]!.toLowerCase().startsWith('pin') ? 'ArmourBreakOnPinPct' : 'ArmourBreakOnHeavyStunPct',
        'BASE',
        Number(m[1]),
        src,
      ),
    ],
  },
  // Wave 4T: Chronomancer Apex of the Moment, Now and Again, Infusion limits
  {
    pattern: /^Enemies in your Presence are Slowed by (\d+)%$/i,
    build: (m, src) => [
      mkMod('EnemyActionSpeed', 'INC', -Number(m[1]), src),
      mkMod('Condition:EnemySlowed', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^(Cascadable|Repeatable) Spells have (\d+)% chance to (Echo|Repeat)$/i,
    build: (m, src) => [
      mkMod(
        m[3]!.toLowerCase() === 'echo' ? 'SpellEchoChance' : 'SpellRepeatChance',
        'BASE',
        Number(m[2]),
        src,
        ModFlag.Spell,
      ),
    ],
  },
  {
    pattern: /^\+(\d+) to maximum (Fire|Cold|Lightning) Infusions?$/i,
    build: (m, src) => [mkMod(`Max${m[2]}Infusions`, 'BASE', Number(m[1]), src)],
  },
  // Falcon Dive (PoB 2 ModParser.lua:1620): "1% increased Attack Speed per 400 Accuracy Rating, up to 20%"
  {
    pattern: /^(\d+)% (increased|reduced) (Attack|Cast) Speed per (\d+) Accuracy Rating(?:,\s*up to (\d+)%)?$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      const flags = m[3]!.toLowerCase() === 'attack' ? ModFlag.Attack : ModFlag.Cast;
      const tag = m[5]
        ? ({
            type: 'PerStat',
            stat: 'Accuracy',
            div: Number(m[4]),
            limit: Number(m[5]),
            limitTotal: true,
          } as unknown as ModTag)
        : ({ type: 'PerStat', stat: 'Accuracy', div: Number(m[4]) } as ModTag);
      return [{ ...mkMod('Speed', type, value, src, flags), tags: [tag] }];
    },
  },
  // Shield / Block Fire Gain: "Gain 1% of damage as Fire damage per 1% Chance to Block"
  {
    pattern: /^Gain (\d+(?:\.\d+)?)% of (?:(Physical|Fire|Cold|Lightning|Elemental) )?[Dd]amage as (?:[Ee]xtra )?(Fire|Cold|Lightning|Chaos|Physical) [Dd]amage per (\d+)%? Chance to Block$/i,
    build: (m, src) => {
      const from = m[2]
        ? `${m[2].charAt(0).toUpperCase()}${m[2].slice(1).toLowerCase()}DamageGainAs`
        : 'DamageGainAs';
      const to = `${m[3]!.charAt(0).toUpperCase()}${m[3]!.slice(1).toLowerCase()}`;
      return [
        {
          ...mkMod(`${from}${to}`, 'BASE', Number(m[1]), src),
          tags: [{ type: 'PerStat', stat: 'BlockChance', div: Number(m[4]) }],
        },
      ];
    },
  },
  // Molten Carapace (Tree:51868): "+2% to Maximum Fire Resistance while Ignited"
  {
    pattern: /^\+(\d+)% to Maximum (Fire|Cold|Lightning|Chaos) Resistance while Ignited$/i,
    build: (m, src) => [
      {
        ...mkMod(`${m[2]}ResistMax`, 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'Ignited' }],
      },
    ],
  },
  // Flurry / Unarmed Area: "20% increased Area of Effect while Unarmed"
  {
    pattern: /^(\d+)% (increased|reduced) Area of Effect while Unarmed$/i,
    build: (m, src) => {
      const { type, value } = signedVal(m[1]!, m[2]!);
      return [
        {
          ...mkMod('AreaOfEffect', type, value, src),
          tags: [{ type: 'Condition', var: 'Unarmed' }],
        },
      ];
    },
  },
  // PoisonStacksMax additional PoE 2 phrasings (Overwhelming Toxicity / Stacking Toxins / Building Toxins also handled by modParser.ts)
  {
    pattern: /^\+(\d+) to Maximum (?:number of )?Poisons?(?: you can inflict)?(?: on an Enemy)?$/i,
    build: (m, src) => [
      mkMod('PoisonCanStack', 'FLAG', true, src),
      mkMod('PoisonStacksMax', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^Double Maximum Poison Stacks$/i,
    build: (_, src) => [
      mkMod('PoisonCanStack', 'FLAG', true, src),
      mkMod('PoisonStacksMax', 'MORE', 100, src),
    ],
  },

  // =========================================================================
  // 4d. Wave 4N PoE 2 Mechanics (ElementalGainAs, Esh's Radiance, Price of Power,
  //     Bestial Rage, Yoke of Suffering, Foe Song)
  // =========================================================================

  // Glaciation (Tree:41972), Wands/Focuses/Staves: "Gain X% of Elemental Damage as Extra Fire/Cold/Lightning/Chaos Damage"
  {
    pattern: /^Gain (\d+(?:\.\d+)?)% of Elemental Damage as Extra (Fire|Cold|Lightning|Chaos) Damage$/i,
    build: (m, src) => {
      const dest = `${m[2]!.charAt(0).toUpperCase()}${m[2]!.slice(1).toLowerCase()}`;
      return [mkMod(`ElementalDamageGainAs${dest}`, 'BASE', Number(m[1]), src)];
    },
  },
  // Esh's Radiance & single-element extra gain: "Gain X% of Lightning/Fire/Cold Damage as Extra Chaos/..."
  {
    pattern: /^Gain (\d+(?:\.\d+)?)% of (Fire|Cold|Lightning) Damage as Extra (Fire|Cold|Lightning|Chaos|Physical) Damage$/i,
    build: (m, src) => {
      const from = `${m[2]!.charAt(0).toUpperCase()}${m[2]!.slice(1).toLowerCase()}`;
      const to = `${m[3]!.charAt(0).toUpperCase()}${m[3]!.slice(1).toLowerCase()}`;
      return [mkMod(`${from}DamageGainAs${to}`, 'BASE', Number(m[1]), src)];
    },
  },
  // Price of Power (Tree:2516): "Spells consume a Power Charge if able to deal 40% more Damage"
  {
    pattern: /^Spells consume a Power Charge if able to deal (\d+)% more Damage$/i,
    build: (m, src) => [mkMod('PriceOfPowerSpellMore', 'BASE', Number(m[1]), src)],
  },
  // Bestial Rage (Tree:10873): "Every 10 Rage also grants 12% increased Physical Damage"
  {
    pattern: /^Every (\d+) Rage also grants (\d+)% increased (?:(Physical|Fire|Cold|Lightning|Chaos|Elemental|Attack|Spell) )?Damage$/i,
    build: (m, src) => {
      const div = Number(m[1]);
      const val = Number(m[2]);
      const scope = (m[3] ?? '').toLowerCase();
      const flags =
        scope === 'attack' ? ModFlag.Attack : scope === 'spell' ? ModFlag.Spell : 0;
      const statName =
        scope === 'physical' ||
        scope === 'fire' ||
        scope === 'cold' ||
        scope === 'lightning' ||
        scope === 'chaos' ||
        scope === 'elemental'
          ? `${scope.charAt(0).toUpperCase()}${scope.slice(1)}Damage`
          : 'Damage';
      return [
        {
          ...mkMod(statName, 'INC', val, src, flags),
          tags: [{ type: 'PerStat', stat: 'Rage', div }],
        },
      ];
    },
  },
  // Yoke of Suffering / PoE 2 phrasing: "Enemies take X% increased Damage for each type of Ailment you have inflicted on them"
  {
    pattern: /^Enemies take (\d+)% increased Damage for each type of (?:Elemental )?Ailment (?:you have inflicted on|affecting|on) them$/i,
    build: (m, src) => [
      { ...mkMod('EnemyDamageTakenPerAilmentType', 'BASE', Number(m[1]), src), target: 'player' },
    ],
  },
  // Foe Song / Fire-transform unique/desecrated staff modifier
  {
    pattern: /^Transforms all Cold and Lightning modifiers on (?:this|the) item into equivalent Fire modifiers$/i,
    build: (_, src) => [mkMod('ItemTransformsColdLightToFire', 'FLAG', true, src)],
  },
  // Gemling Legionnaire (Gem Studded): "5% increased Maximum Life/Mana/Movement Speed if you have at least 10 Red/Blue/Green Support Gems Socketed"
  {
    pattern: /^(\d+)% increased Maximum Life if you have at least (\d+) Red Support Gems Socketed$/i,
    build: (m, src) => [
      {
        ...mkMod('Life', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition', var: `MultiplierThreshold:StrengthMoteSkillCount:${m[2]}` }],
      },
    ],
  },
  {
    pattern: /^(\d+)% increased Maximum Mana if you have at least (\d+) Blue Support Gems Socketed$/i,
    build: (m, src) => [
      {
        ...mkMod('Mana', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition', var: `MultiplierThreshold:IntelligenceMoteSkillCount:${m[2]}` }],
      },
    ],
  },
  {
    pattern: /^(\d+)% increased Movement Speed if you have at least (\d+) Green Support Gems Socketed$/i,
    build: (m, src) => [
      {
        ...mkMod('MovementSpeed', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition', var: `MultiplierThreshold:DexterityMoteSkillCount:${m[2]}` }],
      },
    ],
  },
  // Grand Spectrum Spirit jewel: "2% increased Spirit per socketed Grand Spectrum"
  {
    pattern: /^(\d+)% increased Spirit per socketed Grand Spectrum$/i,
    build: (m, src) => [
      {
        ...mkMod('Spirit', 'INC', Number(m[1]), src),
        tags: [{ type: 'Multiplier', var: 'GrandSpectrum' }],
      },
    ],
  },
  // Warbringer Turtle Charm / Block cap & Shield Base Block overrides
  {
    pattern: /^Maximum Block [Cc]hance is (\d+)%$/i,
    build: (m, src) => [mkMod('BlockChanceMax', 'OVERRIDE', Number(m[1]), src)],
  },
  {
    pattern: /^Gain (\d+)% Base Chance to Block from Equipped Shield instead of the Shield's value$/i,
    build: (m, src) => [mkMod('ShieldBlockChanceOverride', 'OVERRIDE', Number(m[1]), src)],
  },
  // PoE 2 ES bypass & Mana regeneration overrides (e.g. Heavy Buffer, Eternal Youth / Lich / Blood Magic)
  {
    pattern: /^(\d+)% of Damage taken bypasses Energy Shield$/i,
    build: (m, src) => [mkMod('DamageTakenBypassesES', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^No inherent Mana Regeneration$/i,
    build: (_, src) => [mkMod('NoInherentManaRegen', 'FLAG', true, src)],
  },
  {
    pattern: /^Regenerate Mana equal to (\d+(?:\.\d+)?)% of maximum Life per second$/i,
    build: (m, src) => [mkMod('ManaRegenFromLifePct', 'BASE', Number(m[1]), src)],
  },
  // Wave 4V: Open Weakness presence speed, Lich Eternal Life, Rage regeneration & Armour defend rules
  {
    pattern: /^(\d+)% increased Movement Speed while an enemy with an Open Weakness is in your Presence$/i,
    build: (m, src) => [
      {
        ...mkMod('MovementSpeed', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'OpenWeaknessEnemyPresence|EnemyHasOpenWeakness|EnemyOpenWeakness' }],
      },
    ],
  },
  {
    pattern: /^Your Life cannot change while you have Energy Shield$/i,
    build: (_, src) => [mkMod('LifeCannotChangeWhileES', 'FLAG', true, src)],
  },
  {
    pattern: /^No Inherent loss of Rage$/i,
    build: (_, src) => [mkMod('NoInherentRageLoss', 'FLAG', true, src)],
  },
  {
    pattern: /^Regenerate (\d+(?:\.\d+)?)% of your maximum Rage per second$/i,
    build: (m, src) => [mkMod('RageRegenPct', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Increases and Reductions to Mana Regeneration Rate also apply to Rage Regeneration Rate$/i,
    build: (_, src) => [mkMod('ManaRegenAppliesToRageRegen', 'FLAG', true, src)],
  },
  // Wave 4W: "Gain X% of Maximum Mana/Life/Energy Shield as Armour/Evasion" (e.g. Chronomancer Comet Armour +550)
  {
    pattern: /^Gain (\d+(?:\.\d+)?)% of [Mm]aximum (Mana|Life|Energy Shield) as (Armour|Evasion(?: Rating)?)$/i,
    build: (m, src) => {
      const fromRaw = m[2]!.toLowerCase();
      const toRaw = m[3]!.toLowerCase();
      const fromStat = fromRaw === 'energy shield' ? 'EnergyShield' : fromRaw === 'life' ? 'Life' : 'Mana';
      const toStat = toRaw.startsWith('evasion') ? 'Evasion' : 'Armour';
      return [
        {
          ...mkMod(toStat, 'BASE', Number(m[1]) / 100, src),
          tags: [{ type: 'PerStat', stat: fromStat, div: 1 }],
        },
      ];
    },
  },
  // Wave 4W: Flat added damage to Unarmed (Melee) Hits / Attacks (e.g. Hollow Palm gloves/rings)
  {
    pattern: /^Adds (\d+) to (\d+) (Physical|Fire|Cold|Lightning|Chaos) [Dd]amage to Unarmed(?: Melee)? (?:Hits|Attacks)$/i,
    build: (m, src) => {
      const el = `${m[3]!.charAt(0).toUpperCase()}${m[3]!.slice(1).toLowerCase()}`;
      const flags = /Melee/i.test(m[0]!) ? ModFlag.Attack | ModFlag.Melee : ModFlag.Attack;
      return [
        { ...mkMod(`${el}Min`, 'BASE', Number(m[1]), src, flags), tags: [{ type: 'Condition', var: 'Unarmed' }] },
        { ...mkMod(`${el}Max`, 'BASE', Number(m[2]), src, flags), tags: [{ type: 'Condition', var: 'Unarmed' }] },
      ];
    },
  },
  // Wave 4X: Chronomancer Now and Again (0_2), Shock reapply, Infinite Curse, Unlimited Totems & Enemy Unlucky mods
  {
    pattern: /^Skills have (\d+)% chance to not consume a Cooldown when used$/i,
    build: (m, src) => [mkMod('ChanceToNotConsumeCooldown', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance on Consuming a Shock on an Enemy to reapply it$/i,
    build: (m, src) => [mkMod('ChanceToReapplyShockOnConsume', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Your Curses have infinite Duration$/i,
    build: (_, src) => [mkMod('InfiniteCurseDuration', 'FLAG', true, src)],
  },
  {
    pattern: /^Unlimited number of Summoned Totems$/i,
    build: (_, src) => [mkMod('UnlimitedTotems', 'FLAG', true, src)],
  },
  {
    pattern: /^Enemy Critical Hit Chance against you is Unlucky$/i,
    build: (_, src) => [mkMod('EnemyCritChanceUnlucky', 'FLAG', true, src)],
  },
  {
    pattern: /^Damage of Enemies Hitting you is Unlucky( while you are on Low Life)?$/i,
    build: (m, src) => [
      {
        ...mkMod('EnemyDamageUnlucky', 'FLAG', true, src),
        ...(m[1] ? { tags: [{ type: 'Condition' as const, var: 'LowLife' }] } : {}),
      },
    ],
  },
  // Wave 6C: Archon Crit (Exhaust All Power), Crossbow Ammo/Reload (Efficient Loading, Reusable Ammunition, Loads an additional bolt), Culling Threshold (Cull the Hordes)
  {
    pattern: /^Archon Buffs also grant (\d+)% increased Critical Damage Bonus$/i,
    build: (m, src) => [
      {
        ...mkMod('CritMultiplier', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'Archon' }],
      },
    ],
  },
  {
    pattern: /^Archon Buffs also grant (\d+)% increased Critical Hit Chance$/i,
    build: (m, src) => [
      {
        ...mkMod('CritChance', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'Archon' }],
      },
    ],
  },
  {
    pattern: /^Loads an additional bolt$/i,
    build: (_, src) => [mkMod('CrossbowBoltCount', 'BASE', 1, src)],
  },
  {
    pattern: /^(\d+)% chance when you Reload a Crossbow to be immediate$/i,
    build: (m, src) => [mkMod('CrossbowInstantReloadChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Bolts fired by Crossbow Attacks have (\d+)% chance to not(?: expend Ammunition if you've Reloaded Recently)?$/i,
    build: (m, src) => [
      {
        ...mkMod('CrossbowNoConsumeAmmoChance', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'ReloadedRecently' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% increased Culling Strike Threshold against Rare or Unique Enemies$/i,
    build: (m, src) => [
      {
        ...mkMod('CullThreshold', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'EnemyRareOrUnique' }],
      },
    ],
  },

  // =========================================================================
  // 5. PoE 2 Skill-Specific & Tag Gem Level Scaling (+X to Level of all <SkillName|Nova|...> Skills)
  // =========================================================================
  // Bolstering / Motoric / Neurological Implants (Tree:32952 / 63259 / 37397)
  {
    pattern: /^\+(\d+) to Level of all Skills with an? (Strength|Dexterity|Intelligence) requirement$/i,
    build: (m, src) => [mkMod(`GemLevel:${m[2]!.toLowerCase()}`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to Level of all ([A-Za-z][A-Za-z' -]*?) (?:Skill Gems?|Skills?)$/i,
    build: (m, src) => {
      const rawKey = m[2]!.trim().toLowerCase().replace(/\s+/g, '+');
      return [mkMod(`GemLevel:${rawKey}`, 'BASE', Number(m[1]), src)];
    },
  },
];
