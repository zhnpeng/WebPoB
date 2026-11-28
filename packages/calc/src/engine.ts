import {
  DAMAGE_TYPES,
  KeywordFlag,
  ModFlag,
  type Build,
  type CalcDefenceOutput,
  type CalcOffenceOutput,
  type CalcOutput,
  type DamageRange,
  type DamageType,
  type EquipmentSlotId,
  type GemDefinition,
  type GemInstance,
  type Item,
  type Mod,
  type NodePowerDelta,
  type PassiveNode,
  type StatBreakdownRow,
} from '@webpob/core';
import {
  findShortestPathToNode,
  getAscendancyStartNodeId,
  getClassDef,
  getClusterNotable,
  getGemById,
  getPoe2RunesData,
  getRuleset,
  getTimelessJewelData,
  getTimelessLutBuffer,
  getTreeForGame,
  removeNodeAndPruneDisconnected,
  resolveGemFromPobRef,
} from '@webpob/data';
import { ModDB } from './modDb.js';
import { parseModLines } from './modParser.js';
import { resolveItemEffectiveStats } from './localItem.js';
import { parseSocketedGemBonuses, resolveGemBonuses } from './gemBonus.js';
import {
  applyPostLifeAscendancyMechanics,
  applyPreStatAscendancyMechanics,
  computeSmallPassiveEffectMultiplier,
  scaleSmallPassiveMods,
} from './ascendancyMods.js';
import {
  collectAllocatedAnointNodes,
  evaluateRadiusAndDistanceJewels,
  resolveActiveSocketedJewels,
  scaleJewelModLines,
} from './jewelAndTreeSetup.js';
import {
  collectExtraSocketedEquipment,
  evaluateActiveFlasks,
  evaluatePoe2MagebloodLegacies,
  evaluateSpecialUniqueGearMechanics,
  scaleModLineByMultiplier,
  type SpecialUniqueGearResult,
} from './equipmentAndFlasks.js';
import {
  computeArchmageBonus,
  computeEffectiveEnemyResistance,
  computePoe2CritMultiplier,
  computeSkillSpecialDamage,
  resolveEffectiveChargesAndRage,
} from './offenceUpgrade.js';
import {
  POE1_EXPANSION_SOCKETS,
  applyPoolZeroingAndKeystoneRules,
  encodeClusterNodeId,
  evaluateAllocatedClusterJewels,
  evaluateAurasAndWatchersEye,
} from './clusterAndReservation.js';
import {
  computeAuthenticAilmentAndSkillDots,
  computeMinionGroupOffence,
  computeTriggeredSkillRate,
  injectCompiledGemMods,
  resolveCompatibleSupports,
  routeModsToActorBuses,
  splitModDBIntoActorBuses,
  type ActorModBuses,
} from './skillActorRuntime.js';
import {
  collectSquireSupportsForMainHand,
  computeSkillInstanceCountMultiplier,
  evaluatePersistentBuffAndStanceSkills,
  isPoe2MetaGemDefinition,
  resolveActiveSkillPartAndStats,
  resolveEffectiveWeaponSetForSkill,
  resolvePoe2MetaGemGroup,
} from './multiPartAndMetaRuntime.js';
import {
  applyPoolConversionsAndKeystones,
  evaluateIngenuityAndRingBonuses,
  evaluatePerSocketItemModifiers,
  evaluatePostPoolBuildEnablingUniques,
  evaluatePreStatBuildEnablingUniques,
  type PostPoolUniqueResult,
  type PreStatUniqueResult,
} from './uniqueMechanicsRuntime.js';
import {
  createBinaryDatasetTimelessLutLookup,
  evaluatePoe2UnbakedSocketedRunes,
  evaluateTattoosAndRunegrafts,
  evaluateTimelessJewels,
  resolvePoe2ItemLocalRuneLines,
} from './timelessAndTattooRuntime.js';

function getActiveEquippedItems(build: Build): Array<{ slot: EquipmentSlotId; item: Item }> {
  const result: Array<{ slot: EquipmentSlotId; item: Item }> = [];
  const ruleset = getRuleset(build.game);

  for (const slot of ruleset.equipmentSlots) {
    // Handle PoE 2 Weapon Set 1 vs Weapon Set 2 slots cleanly
    if (build.game === 'poe2') {
      if (build.activeWeaponSet === 1 && (slot === 'Weapon 1 Swap' || slot === 'Weapon 2 Swap')) {
        continue;
      }
      if (build.activeWeaponSet === 2 && (slot === 'Weapon 1' || slot === 'Weapon 2')) {
        // Only skip Weapon 1/2 if swap weapon is actually equipped
        const hasSwap = Boolean(build.equipped['Weapon 1 Swap'] || build.equipped['Weapon 2 Swap']);
        if (hasSwap) continue;
      }
    }

    const itemId = build.equipped[slot];
    if (!itemId) continue;
    const item = build.items[itemId];
    if (item) {
      result.push({ slot, item });
    }
  }
  // Support Ring 3 (PoE 2 Ritualist Unfurled Finger / PoE 1 Phrecia) when equipped
  if (!ruleset.equipmentSlots.includes('Ring 3') && build.equipped['Ring 3']) {
    const r3 = build.items[build.equipped['Ring 3']];
    if (r3) {
      result.push({ slot: 'Ring 3', item: r3 });
    }
  }
  return result;
}

const TWO_HANDED_IN_ONE_HAND_MOD_RE =
  /You can wield Two-Handed Axes, Maces and Swords in one hand|可以[单單]手[装裝][备備][双雙]手斧、[双雙]手[锤錘]和[双雙]手[剑劍]/i;
const CANT_USE_BODY_ARMOUR_MOD_RE =
  /Can't use (?:Body|Chest) armour|[无無]法使用胸甲/i;
const BRINGER_OF_RAIN_NAME_RE = /^(?:the\s+)?bringer of rain$|^祭[礼禮]之雨$/i;

function isBringerOfRainItem(item: Item): boolean {
  return (
    BRINGER_OF_RAIN_NAME_RE.test(item.name.trim()) ||
    Boolean(item.nameZh && BRINGER_OF_RAIN_NAME_RE.test(item.nameZh.trim())) ||
    Boolean(item.nameZhTw && BRINGER_OF_RAIN_NAME_RE.test(item.nameZhTw.trim()))
  );
}

/**
 * Returns true when a PoE 2 build can wield Two-Handed Axes, Maces, and Swords
 * in one hand (either via the Giant's Blood keystone or an equipped unique such
 * as The Bringer of Rain / 祭礼之雨).
 */
export function canWieldTwoHandedMartialInOneHand(
  build: Build,
  allocatedNodes?: PassiveNode[],
): boolean {
  if (build.game !== 'poe2') return false;
  const nodes = allocatedNodes ?? (() => {
    const tree = getTreeForGame(build.game, build.tree.treeVersion);
    const out: PassiveNode[] = [];
    const seen = new Set<number>();
    const activeSetNodes =
      build.activeWeaponSet === 2 ? build.tree.weaponSet2NodeIds : build.tree.weaponSet1NodeIds;
    for (const id of [...build.tree.allocatedNodeIds, ...activeSetNodes]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const node = tree.nodes[id];
      if (node) out.push(node);
    }
    return out;
  })();

  if (
    nodes.some(
      (n) =>
        n.name.en.trim().toLowerCase() === "giant's blood" ||
        n.stats.some((s) => TWO_HANDED_IN_ONE_HAND_MOD_RE.test(s)),
    )
  ) {
    return true;
  }

  for (const { slot, item } of getActiveEquippedItems(build)) {
    if (slot.startsWith('Flask ') || slot.startsWith('Charm ')) continue;
    if (isBringerOfRainItem(item)) return true;
    if ([...item.implicits, ...item.explicits].some((line) => TWO_HANDED_IN_ONE_HAND_MOD_RE.test(line))) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a weapon can be wielded in a single hand (so it can be
 * dual-wielded or paired with a shield/offhand).
 */
export function canWieldWeaponInOneHand(
  weaponStats: { weaponType?: string; twoHanded?: boolean } | undefined,
  canWield2HIn1H: boolean,
): boolean {
  if (!weaponStats) return false;
  if (!weaponStats.twoHanded) return true;
  if (!canWield2HIn1H) return false;
  return (
    weaponStats.weaponType === 'Axe' ||
    weaponStats.weaponType === 'Mace' ||
    weaponStats.weaponType === 'Sword'
  );
}

/**
 * Returns true when an equipped item disables Body Armour (e.g. The Bringer of Rain).
 */
export function hasCantUseBodyArmour(build: Build): boolean {
  for (const { slot, item } of getActiveEquippedItems(build)) {
    if (slot === 'Body Armour' || slot.startsWith('Flask ') || slot.startsWith('Charm ')) continue;
    if (isBringerOfRainItem(item)) return true;
    if ([...item.implicits, ...item.explicits].some((line) => CANT_USE_BODY_ARMOUR_MOD_RE.test(line))) {
      return true;
    }
  }
  return false;
}

function getActiveWeapons(build: Build): { main?: Item; off?: Item } {
  if (build.game === 'poe2' && build.activeWeaponSet === 2) {
    const hasSwap = Boolean(build.equipped['Weapon 1 Swap'] || build.equipped['Weapon 2 Swap']);
    if (hasSwap) {
      const mId = build.equipped['Weapon 1 Swap'];
      const oId = build.equipped['Weapon 2 Swap'];
      return {
        main: mId ? build.items[mId] : undefined,
        off: oId ? build.items[oId] : undefined,
      };
    }
  }
  const mId = build.equipped['Weapon 1'];
  const oId = build.equipped['Weapon 2'];
  return {
    main: mId ? build.items[mId] : undefined,
    off: oId ? build.items[oId] : undefined,
  };
}

function getLevelScalingFactor(gemLevel: number): number {
  // Smooth realistic scaling anchored at 1.0 for Level 20
  const clamped = Math.max(1, Math.min(30, gemLevel));
  return Math.pow(1.11, clamped - 20);
}

function injectChargeScaling(db: ModDB, chargeType: 'Power' | 'Frenzy' | 'Endurance', active: number): void {
  if (active <= 0) return;
  const inject = (
    statPrefix: string,
    targetName: string,
    modType: 'BASE' | 'INC',
  ) => {
    for (const [, mods] of db.entriesByPrefix(statPrefix)) {
      for (const mod of mods) {
        if (mod.type !== 'BASE' || typeof mod.value !== 'number') continue;
        db.addMod({
          name: targetName,
          type: modType,
          value: active * mod.value,
          flags: mod.flags,
          keywordFlags: mod.keywordFlags,
          source: `${chargeType} Charge Scaling (${active})`,
        });
      }
    }
  };
  inject(`DamagePer${chargeType}Charge`, 'Damage', 'INC');
  inject(`CritMultiPer${chargeType}Charge`, 'CritMultiplier', 'BASE');
  inject(`CritChancePer${chargeType}Charge`, 'CritChance', 'INC');
  inject(`SpeedPer${chargeType}Charge`, 'Speed', 'INC');
  inject(`ArmourPer${chargeType}Charge`, 'Armour', 'INC');
  inject(`EvasionPer${chargeType}Charge`, 'Evasion', 'INC');
  inject(`EnergyShieldPer${chargeType}Charge`, 'EnergyShield', 'INC');
  inject(`MovementSpeedPer${chargeType}Charge`, 'MovementSpeed', 'INC');
  inject(`AreaOfEffectPer${chargeType}Charge`, 'AreaOfEffect', 'INC');

  for (const prefix of [`FlatMinPer${chargeType}Charge:`, `FlatMaxPer${chargeType}Charge:`] as const) {
    for (const [key, mods] of db.entriesByPrefix(prefix)) {
      const [, dmgType] = key.split(':');
      if (!dmgType) continue;
      const suffix = prefix.startsWith('FlatMin') ? 'Min' : 'Max';
      for (const mod of mods) {
        if (mod.type !== 'BASE' || typeof mod.value !== 'number') continue;
        db.addMod({
          name: `${dmgType}${suffix}`,
          type: 'BASE',
          value: active * mod.value,
          flags: mod.flags,
          keywordFlags: mod.keywordFlags,
          source: `${chargeType} Charge Scaling (${active})`,
        });
      }
    }
  }
}

function injectAttributeScaling(db: ModDB, str: number, dex: number, int: number): void {
  const attrValue = (attr: string): number =>
    attr === 'Strength' ? str : attr === 'Dexterity' ? dex : attr === 'Intelligence' ? int : 0;

  for (const [key, mods] of db.entriesByPrefix('DamagePerAttr:')) {
    const [, attr] = key.split(':');
    const value = attrValue(attr ?? '');
    if (value <= 0) continue;
    for (const mod of mods) {
      if (mod.type !== 'BASE' || typeof mod.value !== 'number') continue;
      db.addMod({
        name: 'Damage',
        type: 'INC',
        value: Math.floor(value * mod.value),
        flags: mod.flags,
        keywordFlags: mod.keywordFlags,
        source: `Attribute Stacking (${attr} ${value})`,
      });
    }
  }

  for (const prefix of ['FlatMinPerAttr:', 'FlatMaxPerAttr:'] as const) {
    for (const [key, mods] of db.entriesByPrefix(prefix)) {
      const [, dmgType, attr] = key.split(':');
      const value = attrValue(attr ?? '');
      if (value <= 0 || !dmgType) continue;
      for (const mod of mods) {
        if (mod.type !== 'BASE' || typeof mod.value !== 'number') continue;
        const scaled = Math.floor(value * mod.value + 1e-9);
        if (scaled === 0) continue;
        db.addMod({
          name: `${dmgType}${prefix === 'FlatMinPerAttr:' ? 'Min' : 'Max'}`,
          type: 'BASE',
          value: scaled,
          flags: mod.flags,
          keywordFlags: mod.keywordFlags,
          source: `${mod.source} (${attr} ${value})`,
        });
      }
    }
  }

  // Defence, Pool, Accuracy, Speed & Block Per-Attribute scaling from modParserPoe1
  const incPerAttrMap: ReadonlyArray<[string, string, number]> = [
    ['ArmourPerAttr:', 'Armour', 0],
    ['EvasionPerAttr:', 'Evasion', 0],
    ['EvasionRatingPerAttr:', 'Evasion', 0],
    ['EnergyShieldPerAttr:', 'EnergyShield', 0],
    ['MeleePhysicalDamagePerAttr:', 'PhysicalDamage', ModFlag.Melee],
    ['AttackSpeedPerAttr:', 'Speed', ModFlag.Attack],
    ['CastSpeedPerAttr:', 'Speed', ModFlag.Spell],
  ];
  for (const [prefix, targetStat, extraFlags] of incPerAttrMap) {
    for (const [key, mods] of db.entriesByPrefix(prefix)) {
      const [, attr] = key.split(':');
      const value = attrValue(attr ?? '');
      if (value <= 0) continue;
      for (const mod of mods) {
        if (typeof mod.value !== 'number') continue;
        const scaled = Math.floor(value * mod.value + 1e-9);
        if (scaled === 0) continue;
        db.addMod({
          name: targetStat,
          type: 'INC',
          value: scaled,
          flags: mod.flags | extraFlags,
          keywordFlags: mod.keywordFlags,
          source: `${mod.source} (${attr} ${value})`,
        });
      }
    }
  }
  // AccuracyRatingPerAttr: emit BASE when parsed as BASE (+X Accuracy per Y Attr, e.g. Undeniable / Shaper helm), INC when parsed as INC
  for (const [key, mods] of db.entriesByPrefix('AccuracyRatingPerAttr:')) {
    const [, attr] = key.split(':');
    const value = attrValue(attr ?? '');
    if (value <= 0) continue;
    for (const mod of mods) {
      if (typeof mod.value !== 'number') continue;
      const scaled = Math.floor(value * mod.value + 1e-9);
      if (scaled === 0) continue;
      db.addMod({
        name: 'Accuracy',
        type: mod.type === 'BASE' ? 'BASE' : 'INC',
        value: scaled,
        flags: mod.flags,
        keywordFlags: mod.keywordFlags,
        source: `${mod.source} (${attr} ${value})`,
      });
    }
  }

  const basePerAttrMap: ReadonlyArray<[string, string]> = [
    ['LifePerAttr:', 'Life'],
    ['ManaPerAttr:', 'Mana'],
    ['BlockChancePerAttr:', 'BlockChance'],
  ];
  for (const [prefix, targetStat] of basePerAttrMap) {
    for (const [key, mods] of db.entriesByPrefix(prefix)) {
      const [, attr] = key.split(':');
      const value = attrValue(attr ?? '');
      if (value <= 0) continue;
      for (const mod of mods) {
        if (mod.type !== 'BASE' || typeof mod.value !== 'number') continue;
        const scaled = Math.floor(value * mod.value + 1e-9);
        if (scaled === 0) continue;
        db.addMod({
          name: targetStat,
          type: 'BASE',
          value: scaled,
          flags: mod.flags,
          keywordFlags: mod.keywordFlags,
          source: `${mod.source} (${attr} ${value})`,
        });
      }
    }
  }
}

/**
 * Pure TypeScript Path of Building calculation engine.
 * Supports both PoE 1 and PoE 2 via `GameRuleset`, with full stat breakdowns.
 */
export function calculateBuild(inputBuild: Build): CalcOutput {
  const initialMainGroup =
    inputBuild.skills.find((g) => g.id === inputBuild.mainSkillGroupId) ??
    inputBuild.skills.find((g) => g.enabled);
  let resolvedWeaponSet = resolveEffectiveWeaponSetForSkill(
    initialMainGroup,
    inputBuild.activeWeaponSet,
    inputBuild.game,
  );
  if (
    inputBuild.game === 'poe2' &&
    resolvedWeaponSet === inputBuild.activeWeaponSet &&
    initialMainGroup &&
    !initialMainGroup.slot &&
    (!initialMainGroup.weaponSets || initialMainGroup.weaponSets.length !== 1)
  ) {
    // In PoE 2, non-Shapeshift Spells (e.g. Volcano) auto-swap away from an Animal Talisman set if the alternate set holds a non-Talisman weapon
    const mainActiveDef = initialMainGroup.gems
      .filter((gm) => gm.enabled)
      .map((gm) => getGemById('poe2', gm.gemId))
      .find((d) => d && d.category === 'active' && !isPoe2MetaGemDefinition(d));
    const isHumanSpell =
      mainActiveDef &&
      (mainActiveDef.tags.includes('spell') || (mainActiveDef.skillTypes ?? []).some((t) => t.toLowerCase() === 'spell')) &&
      !(mainActiveDef.skillTypes ?? []).some((t) => /^(?:shapeshift|bear|wolf|wyvern)$/i.test(t));
    if (isHumanSpell) {
      const curSlot = resolvedWeaponSet === 2 ? 'Weapon 1 Swap' : 'Weapon 1';
      const altSet: 1 | 2 = resolvedWeaponSet === 2 ? 1 : 2;
      const altSlot = altSet === 2 ? 'Weapon 1 Swap' : 'Weapon 1';
      const curWep = inputBuild.equipped[curSlot] ? inputBuild.items[inputBuild.equipped[curSlot]!] : undefined;
      const altWep = inputBuild.equipped[altSlot] ? inputBuild.items[inputBuild.equipped[altSlot]!] : undefined;
      if (
        curWep &&
        /\btalisman\b/i.test(curWep.baseName) &&
        altWep &&
        !/\btalisman\b/i.test(altWep.baseName)
      ) {
        resolvedWeaponSet = altSet;
      }
    }
  }
  if (resolvedWeaponSet !== inputBuild.activeWeaponSet) {
    const defOut = calculateBuildSingleWeaponSet(inputBuild);
    const offOut = calculateBuildSingleWeaponSet({
      ...inputBuild,
      activeWeaponSet: resolvedWeaponSet,
    });
    return {
      ...defOut,
      offence: offOut.offence,
    };
  }
  return calculateBuildSingleWeaponSet(inputBuild);
}

function calculateBuildSingleWeaponSet(build: Build): CalcOutput {
  const initialMainGroup =
    build.skills.find((g) => g.id === build.mainSkillGroupId) ??
    build.skills.find((g) => g.enabled);
  const isInitialMainUnarmedConcoction =
    build.game === 'poe2' &&
    Boolean(
      initialMainGroup?.gems.some((gm) => {
        if (!gm.enabled) return false;
        const gd = getGemById('poe2', gm.gemId);
        return Boolean(gd && gd.category === 'active' && /\bconcoction\b/i.test(gd.name.en));
      }),
    );
  const ruleset = getRuleset(build.game);
  const classDef = getClassDef(build.game, build.classId);
  const tree = getTreeForGame(build.game, build.tree.treeVersion);
  const db = new ModDB();
  const warnings: CalcOutput['warnings'] = [];
  const cfg = build.config;
  const poe2RunesDataset = build.game === 'poe2' ? getPoe2RunesData() : null;
  const refreshPoe2ItemRunesFromDataset = (item: Item): Item => {
    if (build.game !== 'poe2' || !poe2RunesDataset?.runes || !item.rawText || !/\{rune\}/i.test(item.rawText)) {
      return item;
    }
    const rawRuneMatches = [...item.rawText.matchAll(/^\s*Rune\s*[:：]\s*(.+?)\s*$/gim)]
      .map((m) => m[1]!.trim())
      .filter((r) => Boolean(r) && !/^none$/i.test(r));
    if (rawRuneMatches.length === 0) return item;
    const lowerDatasetKeys = new Set(Object.keys(poe2RunesDataset.runes).map((k) => k.trim().toLowerCase()));
    if (!rawRuneMatches.every((r) => lowerDatasetKeys.has(r.toLowerCase()))) {
      return item;
    }
    const staleRuneCounts = new Map<string, number>();
    for (const l of item.rawText.split(/\r?\n/)) {
      if (!/\{rune\}/i.test(l)) continue;
      const cleaned = l.replace(/\{[^}]*\}/g, '').trim().toLowerCase();
      if (!cleaned) continue;
      staleRuneCounts.set(cleaned, (staleRuneCounts.get(cleaned) ?? 0) + 1);
    }
    if (staleRuneCounts.size === 0) return item;
    const cleanedImplicits: string[] = [];
    for (const imp of item.implicits) {
      const key = imp.replace(/\{[^}]*\}/g, '').trim().toLowerCase();
      const rem = staleRuneCounts.get(key) ?? 0;
      if (rem > 0) {
        staleRuneCounts.set(key, rem - 1);
      } else {
        cleanedImplicits.push(imp);
      }
    }
    const cleanedRawText = item.rawText
      .split(/\r?\n/)
      .filter((l) => !/\{rune\}/i.test(l))
      .join('\n');
    return {
      ...item,
      implicits: cleanedImplicits,
      rawText: cleanedRawText,
      __poe2RunesRefreshed: true,
    } as Item;
  };
  const expandPoe2LocalRunes = (slot: string, rawInItem: Item): Item => {
    if (build.game !== 'poe2') return rawInItem;
    const item = refreshPoe2ItemRunesFromDataset(rawInItem);
    const localRuneLines = resolvePoe2ItemLocalRuneLines(slot, item, poe2RunesDataset);
    return localRuneLines.length > 0
      ? { ...item, implicits: [...localRuneLines, ...item.implicits] }
      : item;
  };

  // 1. Character base stats & level scaling
  db.setMultiplier('Level', build.level);
  db.addMod({ name: 'Str', type: 'BASE', value: classDef.baseStr, flags: 0, keywordFlags: 0, source: `Class: ${classDef.name.en}` });
  db.addMod({ name: 'Dex', type: 'BASE', value: classDef.baseDex, flags: 0, keywordFlags: 0, source: `Class: ${classDef.name.en}` });
  db.addMod({ name: 'Int', type: 'BASE', value: classDef.baseInt, flags: 0, keywordFlags: 0, source: `Class: ${classDef.name.en}` });

  db.addMod({
    name: 'Life',
    type: 'BASE',
    value: ruleset.baseLife + build.level * ruleset.lifePerLevel + ruleset.campaignLifeFlat,
    flags: 0,
    keywordFlags: 0,
    source: `Level ${build.level}`,
  });
  if (ruleset.campaignLifeIncPct > 0) {
    db.addMod({
      name: 'Life',
      type: 'INC',
      value: ruleset.campaignLifeIncPct,
      flags: 0,
      keywordFlags: 0,
      source: 'Campaign Quest Bonus',
    });
  }
  db.addMod({
    name: 'Mana',
    type: 'BASE',
    value: ruleset.baseMana + build.level * ruleset.manaPerLevel,
    flags: 0,
    keywordFlags: 0,
    source: `Level ${build.level}`,
  });
  if (ruleset.campaignManaIncPct > 0) {
    db.addMod({
      name: 'Mana',
      type: 'INC',
      value: ruleset.campaignManaIncPct,
      flags: 0,
      keywordFlags: 0,
      source: 'Campaign Quest Bonus',
    });
  }
  db.addMod({
    name: 'Evasion',
    type: 'BASE',
    value: ruleset.baseEvasion,
    flags: 0,
    keywordFlags: 0,
    source: 'Base',
  });
  db.addMod({
    name: 'Accuracy',
    type: 'BASE',
    value: Math.max(0, build.level - 1) * ruleset.accuracyPerLevel,
    flags: 0,
    keywordFlags: 0,
    source: `Level ${build.level}`,
  });
  if (ruleset.supportsSpirit) {
    db.addMod({
      name: 'Spirit',
      type: 'BASE',
      value: ruleset.baseSpirit,
      flags: 0,
      keywordFlags: 0,
      source: 'Campaign Base Spirit',
    });
  }

  // Endgame campaign resistance penalties
  db.addMod({ name: 'FireResist', type: 'BASE', value: ruleset.endgameResistPenalty, flags: 0, keywordFlags: 0, source: 'Campaign Penalty' });
  db.addMod({ name: 'ColdResist', type: 'BASE', value: ruleset.endgameResistPenalty, flags: 0, keywordFlags: 0, source: 'Campaign Penalty' });
  db.addMod({ name: 'LightningResist', type: 'BASE', value: ruleset.endgameResistPenalty, flags: 0, keywordFlags: 0, source: 'Campaign Penalty' });
  if (ruleset.endgameChaosResistPenalty !== 0) {
    db.addMod({ name: 'ChaosResist', type: 'BASE', value: ruleset.endgameChaosResistPenalty, flags: 0, keywordFlags: 0, source: 'Campaign Penalty' });
  }

  // Base max resists & crit multi
  db.addMod({ name: 'FireResistMax', type: 'BASE', value: ruleset.defaultMaxResist, flags: 0, keywordFlags: 0, source: 'Base' });
  db.addMod({ name: 'ColdResistMax', type: 'BASE', value: ruleset.defaultMaxResist, flags: 0, keywordFlags: 0, source: 'Base' });
  db.addMod({ name: 'LightningResistMax', type: 'BASE', value: ruleset.defaultMaxResist, flags: 0, keywordFlags: 0, source: 'Base' });
  db.addMod({ name: 'ChaosResistMax', type: 'BASE', value: ruleset.defaultMaxResist, flags: 0, keywordFlags: 0, source: 'Base' });
  db.addMod({ name: 'CritMultiplier', type: 'BASE', value: ruleset.baseCritMultiplier, flags: 0, keywordFlags: 0, source: 'Base' });
  db.addMod({ name: 'MovementSpeed', type: 'BASE', value: 100, flags: 0, keywordFlags: 0, source: 'Base' });

  // PoE 1 Bandit bonuses
  if (build.game === 'poe1' && build.bandit) {
    if (build.bandit === 'Alira') {
      db.addMods(parseModLines(['+15% to all Elemental Resistances'], 'Bandit: Alira'));
    } else if (build.bandit === 'Oak') {
      db.addMods(parseModLines(['+40 to maximum Life'], 'Bandit: Oak'));
    } else if (build.bandit === 'Kraityn') {
      db.addMods(parseModLines(['8% increased Movement Speed'], 'Bandit: Kraityn'));
    }
  }

  // 2. Passive Skill Tree (Shared + PoE 1 cluster subgraph IDs + PoE 2 active weapon set nodes + Anoints + Jewels + Radius/Tattoos)
  const activeTreeNodes = new Set<number>(build.tree.allocatedNodeIds);
  for (const cid of build.tree.clusterNodeIds ?? []) {
    activeTreeNodes.add(cid);
  }
  if (ruleset.supportsWeaponSetPassives) {
    const setNodes =
      build.activeWeaponSet === 2
        ? build.tree.weaponSet2NodeIds
        : build.tree.weaponSet1NodeIds;
    for (const id of setNodes) {
      activeTreeNodes.add(id);
    }
  }

  const anointNodes = collectAllocatedAnointNodes(build, tree, activeTreeNodes);
  const activeSocketedJewels = resolveActiveSocketedJewels(build, tree, activeTreeNodes);
  const allJewelItems = activeSocketedJewels.map((j) => j.jewel);
  const clusterEval =
    build.game === 'poe1'
      ? evaluateAllocatedClusterJewels(activeSocketedJewels, activeTreeNodes, getClusterNotable)
      : null;

  // Build synthetic Cluster Jewel subgraph adjacency so Split Personality inside expansion sockets computes exact BFS distance
  const clusterAdjacency = new Map<number, number[]>();
  if (clusterEval && clusterEval.entries.length > 0) {
    const linkUndirected = (a: number, b: number) => {
      let la = clusterAdjacency.get(a);
      if (!la) {
        la = [];
        clusterAdjacency.set(a, la);
      }
      if (!la.includes(b)) la.push(b);
      let lb = clusterAdjacency.get(b);
      if (!lb) {
        lb = [];
        clusterAdjacency.set(b, lb);
      }
      if (!lb.includes(a)) lb.push(a);
    };
    const medSocketByLargeAndMedIdx = new Map<string, number>();
    const smallSocketByParent = new Map<number, number>();
    for (const [sockIdStr, info] of Object.entries(POE1_EXPANSION_SOCKETS)) {
      const sockId = Number(sockIdStr);
      if (info.socketSize === 1) {
        medSocketByLargeAndMedIdx.set(`${info.largeSocketIndex}:${info.mediumSocketIndex}`, sockId);
      } else if (info.socketSize === 0 && info.parentSocketId !== undefined) {
        smallSocketByParent.set(info.parentSocketId, sockId);
      }
    }
    const largeSlotToMedIdx: Record<number, number> = { 4: 0, 8: 2, 6: 1 };
    for (const entry of clusterEval.entries) {
      if (entry.largeSocketIndex === null) continue;
      const medIdx = entry.mediumSocketIndex ?? 0;
      // Map all active ring positions (0..11) in this cluster subgraph in angular order
      const ringPosToNodeId = new Map<number, number>();
      for (const cid of entry.allocatedClusterNodeIds) {
        const pos = cid & 0xf;
        if (pos <= 11) ringPosToNodeId.set(pos, cid);
      }
      if (entry.sizeIndex === 2) {
        for (const [slotPosStr, subMedIdx] of Object.entries(largeSlotToMedIdx)) {
          const medSockId = medSocketByLargeAndMedIdx.get(`${entry.largeSocketIndex}:${subMedIdx}`);
          if (medSockId && activeTreeNodes.has(medSockId)) {
            ringPosToNodeId.set(Number(slotPosStr), medSockId);
          }
        }
      } else if (entry.sizeIndex === 1) {
        const smSockId = smallSocketByParent.get(entry.nodeId);
        if (smSockId && activeTreeNodes.has(smSockId)) {
          ringPosToNodeId.set(6, smSockId);
        }
      }
      const entranceId =
        ringPosToNodeId.get(0) ??
        encodeClusterNodeId({
          nodeIndex: 0,
          sizeIndex: entry.sizeIndex,
          largeSocketIndex: entry.largeSocketIndex,
          mediumSocketIndex: medIdx,
        });
      linkUndirected(entry.nodeId, entranceId);
      const sortedPositions = [...ringPosToNodeId.keys()].sort((a, b) => a - b);
      if (sortedPositions.length >= 2) {
        for (let i = 0; i < sortedPositions.length; i++) {
          const curNode = ringPosToNodeId.get(sortedPositions[i]!)!;
          const nextNode = ringPosToNodeId.get(sortedPositions[(i + 1) % sortedPositions.length]!)!;
          if (curNode !== nextNode) {
            linkUndirected(curNode, nextNode);
          }
        }
      }
    }
  }

  const classStartIdForRadius =
    tree.classStartNodeIds[build.classId] ?? build.tree.allocatedNodeIds[0] ?? 0;
  const scaledRadiusJewels = activeSocketedJewels.map(({ nodeId, jewel }) => {
    if (/split personality/i.test(jewel.name)) {
      return { nodeId, jewel };
    }
    let socketEffectPct = 0;
    const sockNode = tree.nodes[nodeId];
    if (sockNode) {
      for (const st of sockNode.stats ?? []) {
        const mSockEff = st.match(
          /^(\d+)% increased Effect of (?:bonuses gained from |the )?Socketed Jewel$/i,
        );
        if (mSockEff) socketEffectPct += Number(mSockEff[1]);
      }
    }
    const scaled = scaleJewelModLines(jewel, allJewelItems, build.game, socketEffectPct);
    if (
      scaled.scale.globalScale === 1 &&
      scaled.scale.prefixScale === 1 &&
      scaled.scale.suffixScale === 1
    ) {
      return { nodeId, jewel };
    }
    return {
      nodeId,
      jewel: {
        ...jewel,
        implicits: scaled.implicits,
        explicits: scaled.explicits,
      },
    };
  });
  const activeTreeNodesForRadius =
    anointNodes.length > 0
      ? new Set<number>([...activeTreeNodes, ...anointNodes.map((n) => n.id)])
      : activeTreeNodes;
  const radiusJewelEval = evaluateRadiusAndDistanceJewels(
    scaledRadiusJewels,
    tree,
    activeTreeNodesForRadius,
    classStartIdForRadius,
    clusterAdjacency.size > 0 ? clusterAdjacency : undefined,
    build.tree.nodeOverrides,
  );
  const timelessDataset = getTimelessJewelData(build.game);
  const timelessLutLookup = createBinaryDatasetTimelessLutLookup(
    timelessDataset,
    getTimelessLutBuffer,
  );
  const timelessEval = evaluateTimelessJewels(activeSocketedJewels, tree, activeTreeNodes, {
    game: build.game,
    lutLookup: timelessLutLookup,
    useOfficialSmallNodeRules: Boolean(timelessDataset),
  });
  const tattooEval = evaluateTattoosAndRunegrafts(build, tree, activeTreeNodes, {
    socketedJewels: activeSocketedJewels,
    skipNativelyParsedRunegraftStats: true,
  });

  const allAllocatedNodeDefs = [
    ...[...activeTreeNodes]
      .filter(
        (id) =>
          !radiusJewelEval.suppressedNodeIds.has(id) && !timelessEval.suppressedNodeIds.has(id),
      )
      .map((id) => tree.nodes[id])
      .filter((n): n is NonNullable<typeof n> => Boolean(n)),
    ...anointNodes,
  ];
  const smallPassiveMult = computeSmallPassiveEffectMultiplier(allAllocatedNodeDefs);

  const attrOverrides = build.tree.attributeOverrides ?? {};
  const nodeOverrides = build.tree.nodeOverrides ?? {};
  for (const nodeId of activeTreeNodes) {
    if (radiusJewelEval.suppressedNodeIds.has(nodeId) || timelessEval.suppressedNodeIds.has(nodeId)) {
      continue;
    }
    const node = tree.nodes[nodeId];
    if (!node) continue;
    const tattooOverride = nodeOverrides[nodeId];
    const rawNodeStats = tattooOverride ? tattooOverride.stats : node.stats;
    const chosenAttr = attrOverrides[nodeId];
    const effectiveStats = chosenAttr
      ? rawNodeStats.map((line) => {
          const m = line.match(/^\+(\d+) to any Attribute$/i);
          if (!m) return line;
          const attrName =
            chosenAttr === 'str' ? 'Strength' : chosenAttr === 'dex' ? 'Dexterity' : 'Intelligence';
          return `+${m[1]} to ${attrName}`;
        })
      : rawNodeStats;
    const parsedNodeMods = parseModLines(
      effectiveStats,
      `Tree: ${tattooOverride?.name ?? node.name.en}`,
    );
    const isAttributeTravelSmall =
      node.kind === 'small' &&
      !node.ascendancyId &&
      effectiveStats.length === 1 &&
      /^\+\d+\s+to\s+(?:Strength|Dexterity|Intelligence|any Attribute)$/i.test(effectiveStats[0]!.trim());
    // PoE 2 Titan Hulking Form scales attribute travel nodes too (+5 -> +7, +8 -> +12)
    const isRegularSmall =
      node.kind === 'small' && !node.ascendancyId && (build.game === 'poe2' || !isAttributeTravelSmall);
    db.addMods(
      isRegularSmall && smallPassiveMult !== 1
        ? scaleSmallPassiveMods(parsedNodeMods, smallPassiveMult)
        : parsedNodeMods,
    );
    if (build.game === 'poe1') {
      const nodeSrc = `Tree: ${tattooOverride?.name ?? node.name.en}`;
      for (const st of effectiveStats) {
        const cleanSt = st.replace(/\s+/g, ' ').trim();
        const mMinAs = cleanSt.match(/^Your Action Speed is at least (\d+)% of base value$/i);
        if (mMinAs) {
          db.addMod({ name: 'MinimumActionSpeed', type: 'MAX', value: Number(mMinAs[1]), flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        if (/^Energy Shield Leech effects(?: from Attacks)? are not removed (?:when Energy Shield is Filled|at Full Energy Shield)$/i.test(cleanSt)) {
          db.addMod({ name: 'CanLeechEnergyShieldOnFullEnergyShield', type: 'FLAG', value: true, flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        // Champion: Master of Metal (`Impales you inflict last 1 additional Hit`, `6 to 12 added Physical Damage for each Impale on Enemy`)
        const mImpLast = cleanSt.match(/^Impales you inflict last (\d+) additional Hits?$/i);
        if (mImpLast && !parsedNodeMods.some((m) => m.name === 'ImpaleStacksMax')) {
          db.addMod({ name: 'ImpaleStacksMax', type: 'BASE', value: Number(mImpLast[1]), flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        const mImpPhys = cleanSt.match(
          /^(?:You and nearby Allies )?deal (\d+) to (\d+) added Physical Damage for each Impale on Enemy$/i,
        );
        if (mImpPhys) {
          db.addMod({ name: 'MasterOfMetalPhysMinPerImpale', type: 'BASE', value: Number(mImpPhys[1]), flags: 0, keywordFlags: 0, source: nodeSrc });
          db.addMod({ name: 'MasterOfMetalPhysMaxPerImpale', type: 'BASE', value: Number(mImpPhys[2]), flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        // Champion: Unstoppable Hero (`3% more Armour and Evasion Rating per Fortification above 20`, `3% increased Attack Speed per Fortification above 20`)
        const mFortDef = cleanSt.match(/^(\d+)% more Armour and Evasion Rating per Fortification above (\d+)$/i);
        if (mFortDef) {
          db.addMod({ name: 'MoreArmourEvasionPerFortAbove', type: 'BASE', value: Number(mFortDef[1]), flags: 0, keywordFlags: 0, source: nodeSrc });
          db.addMod({ name: 'FortAboveThreshold', type: 'MAX', value: Number(mFortDef[2]), flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        const mFortAs = cleanSt.match(/^(\d+)% increased Attack Speed per Fortification above (\d+)$/i);
        if (mFortAs) {
          db.addMod({ name: 'AttackSpeedPerFortAbove', type: 'BASE', value: Number(mFortAs[1]), flags: 0, keywordFlags: 0, source: nodeSrc });
          db.addMod({ name: 'FortAboveThreshold', type: 'MAX', value: Number(mFortAs[2]), flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        // Assassin: Ambush and Assassinate (`Critical Strikes have Culling Strike`)
        if (/^Critical Strikes have Culling Strike$/i.test(cleanSt) && !parsedNodeMods.some((m) => m.name === 'CritCullingStrike')) {
          db.addMod({ name: 'CritCullingStrike', type: 'FLAG', value: true, flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        // Elementalist: Mastermind of Discord (`Exposure you inflict applies an extra -25% to the affected Resistance`)
        const mMastermindExp = cleanSt.match(/^Exposure you inflict applies an extra -(\d+)% to the affected Resistance$/i);
        if (mMastermindExp && !parsedNodeMods.some((m) => m.name === 'ExtraExposure')) {
          db.addMod({ name: 'ExtraExposure', type: 'BASE', value: Number(mMastermindExp[1]), flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        // Assassin: Noxious Strike (`5% increased Poison Duration for each Poison you have inflicted Recently`)
        const mNoxDur = cleanSt.match(/^(\d+)% increased Poison Duration for each Poison you have inflicted Recently$/i);
        if (mNoxDur) {
          db.addMod({ name: 'PoisonDurationPerRecentPoison', type: 'BASE', value: Number(mNoxDur[1]), flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        // Mark the Prey (`Marked Enemy takes 10% increased Damage`)
        const mMarkPrey = cleanSt.match(/^Marked Enemy takes (\d+)% increased Damage$/i);
        if (mMarkPrey && !parsedNodeMods.some((m) => m.name === 'EnemyDamageTaken' || m.name === 'DamageTaken')) {
          db.addMod({ name: 'MarkedEnemyDamageTaken', type: 'BASE', value: Number(mMarkPrey[1]), flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
      }
    } else if (build.game === 'poe2') {
      const nodeSrc = `Tree: ${tattooOverride?.name ?? node.name.en}`;
      for (const st of effectiveStats) {
        const cleanSt = st.trim();
        // PoE 2 Stormweaver Scouring Winds & Exposure extra penetration notables
        const mExtraAllExp = cleanSt.match(
          /^Exposure you inflict lowers the affected Resistance by an additional (\d+)%$/i,
        );
        if (mExtraAllExp) {
          db.addMod({ name: 'ExtraExposure', type: 'BASE', value: Number(mExtraAllExp[1]), flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        const mExtraElExp = cleanSt.match(
          /^(Fire|Cold|Lightning) Exposure you inflict lowers Total \1 Resistance by an extra (\d+)%$/i,
        );
        if (mExtraElExp) {
          const elCap = mExtraElExp[1]!.charAt(0).toUpperCase() + mExtraElExp[1]!.slice(1).toLowerCase();
          db.addMod({ name: `Extra${elCap}Exposure`, type: 'BASE', value: Number(mExtraElExp[2]), flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        const mCurseMag = cleanSt.match(/^(\d+)% increased (?:Magnitude of Curses you inflict|Curse Magnitudes?)$/i);
        if (mCurseMag && !parsedNodeMods.some((m) => m.name === 'CurseEffect')) {
          db.addMod({ name: 'CurseEffect', type: 'INC', value: Number(mCurseMag[1]), flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        const mShockMag = cleanSt.match(/^(\d+)% increased (?:Magnitude of Shock you inflict|Shock Magnitudes?)$/i);
        if (mShockMag && !parsedNodeMods.some((m) => m.name === 'ShockEffect' || m.name === 'ShockMagnitude' || m.name === 'EnemyShockMagnitude')) {
          db.addMod({ name: 'ShockEffect', type: 'INC', value: Number(mShockMag[1]), flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        const mWitherMag = cleanSt.match(/^(\d+)% increased (?:Withered Magnitudes?|Magnitude of Withered you inflict)$/i);
        if (mWitherMag && !parsedNodeMods.some((m) => m.name === 'WitherEffect')) {
          db.addMod({ name: 'WitherEffect', type: 'INC', value: Number(mWitherMag[1]), flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        const mLuckyEl = cleanSt.match(/^(\d+)% chance for (Lightning|Fire|Cold|Physical|Chaos) Damage with Hits to be Lucky$/i);
        if (mLuckyEl && !parsedNodeMods.some((m) => /LuckyHits/i.test(m.name))) {
          const elCap = mLuckyEl[2]!.charAt(0).toUpperCase() + mLuckyEl[2]!.slice(1).toLowerCase();
          db.addMod({ name: `${elCap}LuckyHitsChance`, type: 'BASE', value: Number(mLuckyEl[1]), flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        const mSpellCritDmg = cleanSt.match(/^(\d+)% increased Critical Spell Damage Bonus$/i);
        if (mSpellCritDmg && !parsedNodeMods.some((m) => m.name === 'CritDamageBonusInc' || m.name === 'CritMultiplier')) {
          db.addMod({ name: 'CritDamageBonusInc', type: 'INC', value: Number(mSpellCritDmg[1]), flags: ModFlag.Spell, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        // PoE 2 Inspiring Ally: "Increases and Reductions to Companion Damage also apply to you"
        // (Note: `Companions deal X% increased Damage` & `while your Companion is in your Presence` are already parsed by modParserPoe2)
        if (/^Increases and Reductions to Companion Damage also apply to you$/i.test(cleanSt)) {
          db.addMod({ name: 'CompanionDamageAppliesToPlayer', type: 'FLAG', value: true, flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        // PoE 2 Warbringer Greatwolf's Howl: "Ignore Warcry Cooldowns"
        if (/^Ignore Warcry Cooldowns$/i.test(cleanSt)) {
          db.addMod({ name: 'WarcryNoCooldown', type: 'FLAG', value: true, flags: 0, keywordFlags: 0, source: nodeSrc });
          continue;
        }
        // PoE 2 Dynamism: "X% increased Damage if you've Triggered a Skill Recently"
        const mTrigRec = cleanSt.match(/^(\d+)% increased Damage if you've Triggered a Skill Recently$/i);
        if (mTrigRec) {
          db.addMod({
            name: 'Damage',
            type: 'INC',
            value: Number(mTrigRec[1]),
            flags: 0,
            keywordFlags: 0,
            source: nodeSrc,
            tags: [{ type: 'Condition', var: 'TriggeredSkillRecently' }],
          });
          continue;
        }
      }
    }
  }

  // Allocated Anoint / Megalomaniac / Forbidden Flame+Flesh Notables
  for (const anointNode of anointNodes) {
    db.addMods(parseModLines(anointNode.stats, `Anoint: ${anointNode.name.en}`));
  }

  // Mastery effects chosen on PoE 1 mastery nodes
  for (const [nodeIdStr, statText] of Object.entries(build.tree.masteryEffects ?? {})) {
    if (!statText) continue;
    const node = tree.nodes[Number(nodeIdStr)];
    const label = node ? node.name.en : `Mastery ${nodeIdStr}`;
    const masterySrc = `Mastery: ${label}`;
    const masteryLines = statText.split('\n');
    const passthroughMasteryLines: string[] = [];
    for (const ml of masteryLines) {
      const cleanMl = ml.trim();
      if (build.game === 'poe1') {
        const mNbCrit = cleanMl.match(
          /^Elusive also grants \+(\d+)% to Critical Strike Multiplier for Skills Supported by Nightblade$/i,
        );
        if (mNbCrit) {
          db.addMod({ name: 'NightbladeElusiveCritMultiplier', type: 'BASE', value: Number(mNbCrit[1]), flags: 0, keywordFlags: 0, source: masterySrc });
          continue;
        }
        const mNbEff = cleanMl.match(
          /^Skills Supported by Nightblade have (\d+)% increased Effect of Elusive$/i,
        );
        if (mNbEff) {
          db.addMod({ name: 'NightbladeSupportedElusiveEffect', type: 'INC', value: Number(mNbEff[1]), flags: 0, keywordFlags: 0, source: masterySrc });
          continue;
        }
        const mExpMin = cleanMl.match(
          /^Exposure you inflict applies at least -(\d+)% to the affected Resistance$/i,
        );
        if (mExpMin) {
          // Emit ExposureMin OVERRIDE directly (do NOT pass to parseModLines, which misparses this as ExtraExposure +18!)
          db.addMod({ name: 'ExposureMin', type: 'OVERRIDE', value: -Number(mExpMin[1]), flags: 0, keywordFlags: 0, source: masterySrc });
          continue;
        }
        // Wand Mastery: "Wand Attacks fire an additional Projectile"
        if (/^Wand Attacks fire an additional Projectile$/i.test(cleanMl)) {
          db.addMod({ name: 'ProjectileCount', type: 'BASE', value: 1, flags: ModFlag.Wand, keywordFlags: 0, source: masterySrc });
          continue;
        }
        // Shield Mastery: "+1% to Critical Strike Multiplier per 10 Maximum Energy Shield on Shield"
        const mShieldEsCrit = cleanMl.match(
          /^\+(\d+)% to Critical Strike Multiplier per (\d+) Maximum Energy Shield on Shield$/i,
        );
        if (mShieldEsCrit) {
          db.addMod({
            name: 'CritMultiplier',
            type: 'BASE',
            value: Number(mShieldEsCrit[1]),
            flags: 0,
            keywordFlags: 0,
            source: masterySrc,
            tags: [{ type: 'PerStat', stat: 'EnergyShieldOnWeapon 2', div: Number(mShieldEsCrit[2]) }],
          });
          continue;
        }
        // Energy Shield Mastery: "100% increased Energy Shield from Equipped Helmet"
        const mHelmEs = cleanMl.match(/^(\d+)% increased Energy Shield from Equipped Helmet$/i);
        if (mHelmEs) {
          db.addMod({ name: 'EnergyShieldFromHelmet', type: 'INC', value: Number(mHelmEs[1]), flags: 0, keywordFlags: 0, source: masterySrc });
          continue;
        }
        // Critical Mastery: "+3 to Level of all Critical Support Gems"
        const mCritSupLv = cleanMl.match(/^\+(\d+) to Level of all Critical Support Gems$/i);
        if (mCritSupLv) {
          db.addMod({ name: 'GemLevelSup:critical', type: 'BASE', value: Number(mCritSupLv[1]), flags: 0, keywordFlags: 0, source: masterySrc });
          continue;
        }
        // Critical Mastery: "+25% to Critical Strike Multiplier against Unique Enemies"
        const mUniqCrit = cleanMl.match(/^\+(\d+)% to Critical Strike Multiplier against Unique Enemies$/i);
        if (mUniqCrit) {
          db.addMod({
            name: 'CritMultiplier',
            type: 'BASE',
            value: Number(mUniqCrit[1]),
            flags: 0,
            keywordFlags: 0,
            source: masterySrc,
            tags: [{ type: 'Condition', var: 'EnemyRareOrUnique' }],
          });
          continue;
        }
        // Mine Mastery: "Each Mine applies 2% increased Damage taken to Enemies near it, up to 10%"
        const mMineTaken = cleanMl.match(
          /^Each Mine applies (\d+)% increased Damage taken to Enemies near it, up to (\d+)%$/i,
        );
        if (mMineTaken) {
          db.addMod({ name: 'MineNearbyEnemyDmgTakenCap', type: 'BASE', value: Number(mMineTaken[2]), flags: 0, keywordFlags: 0, source: masterySrc });
          continue;
        }
        // Stun/Mace Mastery: "Hits that Stun Enemies have Culling Strike"
        if (/^Hits that Stun Enemies have Culling Strike$/i.test(cleanMl)) {
          db.addMod({
            name: 'CullingStrike',
            type: 'FLAG',
            value: true,
            flags: 0,
            keywordFlags: 0,
            source: masterySrc,
            tags: [{ type: 'Condition', var: 'HitsAlwaysStun' }],
          });
          continue;
        }
        // Physical Mastery: "10% more Maximum Physical Attack Damage"
        const mMoreMaxPhys = cleanMl.match(/^(\d+)% more Maximum (Physical|Fire|Cold|Lightning|Chaos|Elemental) Attack Damage$/i);
        if (mMoreMaxPhys) {
          const dtCap = mMoreMaxPhys[2]!.charAt(0).toUpperCase() + mMoreMaxPhys[2]!.slice(1).toLowerCase();
          db.addMod({
            name: `${dtCap}MaxDamage`,
            type: 'MORE',
            value: Number(mMoreMaxPhys[1]),
            flags: ModFlag.Attack,
            keywordFlags: 0,
            source: masterySrc,
          });
          continue;
        }
        // Caster Mastery: "6% increased Cast Speed for each different Non-Instant Spell you've Cast Recently"
        const mNonInstCast = cleanMl.match(
          /^(\d+)% increased Cast Speed for each different Non-Instant Spell you've Cast Recently$/i,
        );
        if (mNonInstCast) {
          db.addMod({
            name: 'Speed',
            type: 'INC',
            value: Number(mNonInstCast[1]),
            flags: ModFlag.Cast,
            keywordFlags: 0,
            source: masterySrc,
            tags: [{ type: 'Multiplier', var: 'NonInstantSpellCastRecently' }],
          });
          continue;
        }
        // Chaos Mastery: "Deal 10% more Chaos Damage to enemies which have Energy Shield"
        const mVsEs = cleanMl.match(
          /^Deal (\d+)% more (Chaos|Physical|Fire|Cold|Lightning|Elemental) Damage to enemies which have Energy Shield$/i,
        );
        if (mVsEs) {
          const dtCap = mVsEs[2]!.charAt(0).toUpperCase() + mVsEs[2]!.slice(1).toLowerCase();
          db.addMod({
            name: `${dtCap}Damage`,
            type: 'MORE',
            value: Number(mVsEs[1]),
            flags: 0,
            keywordFlags: 0,
            source: masterySrc,
            tags: [{ type: 'Condition', var: 'EnemyHaveEnergyShield' }],
          });
          continue;
        }
      }
      passthroughMasteryLines.push(ml);
    }
    if (passthroughMasteryLines.length > 0) {
      db.addMods(parseModLines(passthroughMasteryLines, masterySrc));
    }
  }

  // Socketed Passive Tree Jewels (Exact PoE 1 >=65536 Cluster Subgraphs, Standard, Voices, The Adorned & Prefix/Suffix scaled)
  if (clusterEval && clusterEval.mods.length > 0) {
    db.addMods(clusterEval.mods);
  }
  const evaluatedClusterSocketIds = new Set<number>(
    clusterEval ? clusterEval.entries.map((e) => e.nodeId) : [],
  );
  for (const { nodeId, jewel } of activeSocketedJewels) {
    const src = `Jewel (${nodeId}): ${jewel.name}`;
    let socketEffectPct = 0;
    const sockNode = tree.nodes[nodeId];
    if (sockNode) {
      for (const st of sockNode.stats ?? []) {
        const mSockEff = st.match(
          /^(\d+)% increased Effect of (?:bonuses gained from |the )?Socketed Jewel$/i,
        );
        if (mSockEff) socketEffectPct += Number(mSockEff[1]);
      }
    }
    const scaled = scaleJewelModLines(jewel, allJewelItems, build.game, socketEffectPct);
    db.addMods(parseModLines(scaled.implicits, `${src} [Implicit]`));
    if (!evaluatedClusterSocketIds.has(nodeId)) {
      db.addMods(parseModLines(scaled.explicits, src));
    }
  }

  // Radius & Distance Jewel synthetic grants (Time-Lost, Against the Darkness, Light of Meaning, Might of the Meek, Split Personality, Attr Conversion)
  for (const entry of radiusJewelEval.addedStatLines) {
    db.addMods(parseModLines(entry.lines, entry.source));
  }
  if (radiusJewelEval.addedMods.length > 0) {
    db.addMods(radiusJewelEval.addedMods);
  }
  // Timeless Jewel synthetic grants & Conqueror Keystones + Tattoos & Runegrafts
  for (const entry of timelessEval.addedStatLines) {
    db.addMods(parseModLines(entry.lines, entry.source));
  }
  if (timelessEval.addedMods.length > 0) {
    db.addMods(timelessEval.addedMods);
  }
  for (const entry of tattooEval.addedStatLines) {
    db.addMods(parseModLines(entry.lines, entry.source));
  }
  if (tattooEval.addedMods.length > 0) {
    db.addMods(tattooEval.addedMods);
  }

  // Dual-Wielding inherent PoE 1 bonuses (10% more Attack Speed + 20% Attack Block)
  const hasHollowPalm =
    build.game === 'poe2' &&
    allAllocatedNodeDefs.some((n) => n.name.en.trim().toLowerCase() === 'hollow palm technique');
  const activeWeapons = getActiveWeapons(build);
  const hollowPalmActive = hasHollowPalm && !activeWeapons.main && !activeWeapons.off;
  if (hollowPalmActive) {
    db.setCondition('HollowPalm', true);
  }
  const canWield2HIn1H = canWieldTwoHandedMartialInOneHand(build, allAllocatedNodeDefs);
  const cantUseBodyArmour = hasCantUseBodyArmour(build);
  const mainWeaponSlot = build.game === 'poe2' && build.activeWeaponSet === 2 && (build.equipped['Weapon 1 Swap'] || build.equipped['Weapon 2 Swap']) ? 'Weapon 1 Swap' : 'Weapon 1';
  const offWeaponSlot = build.game === 'poe2' && build.activeWeaponSet === 2 && (build.equipped['Weapon 1 Swap'] || build.equipped['Weapon 2 Swap']) ? 'Weapon 2 Swap' : 'Weapon 2';
  const mainWeaponResolved = activeWeapons.main
    ? resolveItemEffectiveStats(expandPoe2LocalRunes(mainWeaponSlot, activeWeapons.main), build.game).weaponStats
    : undefined;
  const offWeaponResolved = activeWeapons.off
    ? resolveItemEffectiveStats(expandPoe2LocalRunes(offWeaponSlot, activeWeapons.off), build.game).weaponStats
    : undefined;
  const mainFitsOneHand = canWieldWeaponInOneHand(mainWeaponResolved, canWield2HIn1H);
  const offFitsOneHand = canWieldWeaponInOneHand(offWeaponResolved, canWield2HIn1H);
  const isDualWielding = Boolean(
    mainWeaponResolved &&
      offWeaponResolved &&
      mainFitsOneHand &&
      offFitsOneHand,
  );
  if (isDualWielding && build.game === 'poe1') {
    db.addMod({
      name: 'Speed',
      type: 'MORE',
      value: 10,
      flags: ModFlag.Attack,
      keywordFlags: 0,
      source: 'Dual Wielding',
    });
    db.addMod({
      name: 'BlockChance',
      type: 'BASE',
      value: 20,
      flags: 0,
      keywordFlags: 0,
      source: 'Dual Wielding',
    });
  }

function isKalandrasTouch(item: Item): boolean {
  const lowerName = item.name.trim().toLowerCase();
  if (lowerName === "kalandra's touch" || item.nameZh === '卡兰德之触' || item.nameZhTw === '卡蘭德之觸') {
    return true;
  }
  return [...item.implicits, ...item.explicits].some((line) =>
    /Reflects (?:your other|opposite) Ring|映射另一枚戒指/i.test(line),
  );
}

function countFilledSockets(item: Item): number {
  if (item.rawText) {
    const runeMatches = item.rawText.match(/^Rune\s*[:：]/gim);
    if (runeMatches && runeMatches.length > 0) return runeMatches.length;
  }
  if (item.sockets) {
    const tokens = item.sockets.match(/[RGBWSA]/gi);
    if (tokens && tokens.length > 0) return tokens.length;
  }
  return 0;
}

/**
 * Expands PoE 2 "per Socket filled" modifiers (e.g. Morior Invictus Grand Regalia)
 * into concrete scaled stat lines using the item's filled socket count.
 */
function expandPerSocketFilledMods(lines: readonly string[], filledSockets: number): string[] {
  if (filledSockets <= 0) return [...lines];
  const out: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const mEle = line.match(/^\+(\d+)% to all Elemental Resistances per Socket filled$/i);
    if (mEle) {
      out.push(`+${Number(mEle[1]) * filledSockets}% to all Elemental Resistances`);
      continue;
    }
    const mSingleRes = line.match(/^\+(\d+)% to (Fire|Cold|Lightning|Chaos) Resistance per Socket filled$/i);
    if (mSingleRes) {
      out.push(`+${Number(mSingleRes[1]) * filledSockets}% to ${mSingleRes[2]} Resistance`);
      continue;
    }
    const mAllAttr = line.match(/^\+(\d+) to all Attributes per Socket filled$/i);
    if (mAllAttr) {
      out.push(`+${Number(mAllAttr[1]) * filledSockets} to all Attributes`);
      continue;
    }
    const mAttr = line.match(/^\+(\d+) to (Strength|Dexterity|Intelligence) per Socket filled$/i);
    if (mAttr) {
      out.push(`+${Number(mAttr[1]) * filledSockets} to ${mAttr[2]}`);
      continue;
    }
    const mLife = line.match(/^\+(\d+) to maximum Life per Socket filled$/i);
    if (mLife) {
      out.push(`+${Number(mLife[1]) * filledSockets} to maximum Life`);
      continue;
    }
    const mMana = line.match(/^\+(\d+) to maximum Mana per Socket filled$/i);
    if (mMana) {
      out.push(`+${Number(mMana[1]) * filledSockets} to maximum Mana`);
      continue;
    }
    const mEs = line.match(/^\+(\d+) to maximum Energy Shield per Socket filled$/i);
    if (mEs) {
      out.push(`+${Number(mEs[1]) * filledSockets} to maximum Energy Shield`);
      continue;
    }
    const mSpirit = line.match(/^\+(\d+) to Spirit per Socket filled$/i);
    if (mSpirit) {
      out.push(`+${Number(mSpirit[1]) * filledSockets} to Spirit`);
      continue;
    }
    const mIncLife = line.match(/^(\d+)% increased maximum Life per Socket filled$/i);
    if (mIncLife) {
      out.push(`${Number(mIncLife[1]) * filledSockets}% increased maximum Life`);
      continue;
    }
    const mIncMana = line.match(/^(\d+)% increased maximum Mana per Socket filled$/i);
    if (mIncMana) {
      out.push(`${Number(mIncMana[1]) * filledSockets}% increased maximum Mana`);
      continue;
    }
    const mGlobalDef = line.match(
      /^(\d+)% increased Global (Defences|Armour, Evasion and Energy Shield) per Socket filled$/i,
    );
    if (mGlobalDef) {
      out.push(`${Number(mGlobalDef[1]) * filledSockets}% increased Global ${mGlobalDef[2]}`);
      continue;
    }
    out.push(rawLine);
  }
  return out;
}

function expandPerPlayerLevelMods(lines: readonly string[], level: number): string[] {
  if (level <= 0) return [...lines];
  return lines.map((rawLine) => {
    const m = rawLine
      .trim()
      .match(
        /^Has \+(\d+) to (Armour|Evasion Rating|maximum Energy Shield|maximum Life|maximum Mana|maximum Runic Ward|Runic Ward) per player level$/i,
      );
    if (!m) return rawLine;
    return `+${Number(m[1]) * level} to ${m[2]}`;
  });
}

  // 3. Equipped Items & Active Utility Flasks (with PoB-authentic Local Armour/Weapon resolution)
  // PoE 2 Shaman ascendancy ("Shaman" / 萨满) unlocks Bonded ("Bonded:" / "羁绊：") modifiers on items.
  const allowBonded = build.game === 'poe2' && build.ascendancyId.trim().toLowerCase() === 'shaman';
  const itemModOpts = allowBonded ? { allowBonded: true } : undefined;
  const hasNecromanticAegis =
    build.game === 'poe1' &&
    allAllocatedNodeDefs.some((n) => n.name.en.trim().toLowerCase() === 'necromantic aegis');
  const necromanticAegisMods: Mod[] = [];
  const equippedItems = getActiveEquippedItems(build);
  const nonFlaskEquippedForUniques: Array<{ slot: string; item: Item }> = [];
  let bodyLocalArmour = 0;
  let bodyLocalEvasion = 0;
  let bodyLocalEs = 0;
  let bodyArmourRarity: Item['rarity'] | undefined;
  let helmetLocalArmour = 0;
  let helmetLocalEvasion = 0;
  let helmetLocalEs = 0;
  let glovesLocalArmour = 0;
  let glovesLocalEvasion = 0;
  let glovesLocalEs = 0;
  let bootsLocalArmour = 0;
  let bootsLocalEvasion = 0;
  let bootsLocalEs = 0;
  let shieldLocalArmour = 0;
  let shieldLocalEvasion = 0;
  let shieldLocalEs = 0;
  let focusLocalEs = 0;
  let beltCharmSlots = 0;
  let corruptedEquippedCount = 0;
  let usingShield = false;
  let shieldBaseBlock = 0;
  let bodyArmourEquipped = false;
  let bodyArmourHasLifeMod = false;
  let totalSocketFilledCount = 0;
  let bodyArmourFilledRunes = 0;
  const socketColorTotals = { R: 0, G: 0, B: 0, W: 0 };
  const socketColorBySlot: Record<string, { R: number; G: number; B: number; W: number }> = {};
  const influenceCounts: Record<string, number> = {
    ShaperItem: 0,
    ElderItem: 0,
    CrusaderItem: 0,
    HunterItem: 0,
    RedeemerItem: 0,
    WarlordItem: 0,
    ExarchItem: 0,
    EaterItem: 0,
  };
  const slotAttrReqs: Record<string, { str: number; dex: number; int: number }> = {};
  let yndasStandWardPct = 0;
  let yndasStandReplacesBodyDef = false;
  let nightgripWardChaosPct = 0;
  for (const { slot, item: rawItem } of equippedItems) {
    if (cantUseBodyArmour && slot === 'Body Armour') {
      // Disabled by items such as The Bringer of Rain ("Can't use Body Armour" / "Can't use Chest armour")
      continue;
    }
    if (!slot.startsWith('Flask ') && !slot.startsWith('Charm ') && rawItem.corrupted) {
      corruptedEquippedCount++;
    }
    let item = rawItem;
    let mirroredLabel = '';
    if ((slot === 'Ring 1' || slot === 'Ring 2') && isKalandrasTouch(rawItem)) {
      const oppositeSlot: EquipmentSlotId = slot === 'Ring 1' ? 'Ring 2' : 'Ring 1';
      const oppositeId = build.equipped[oppositeSlot];
      const oppositeItem = oppositeId ? build.items[oppositeId] : undefined;
      if (oppositeItem && !isKalandrasTouch(oppositeItem)) {
        item = oppositeItem;
        mirroredLabel = ` → ${oppositeItem.name}`;
      }
    }
    if (slot.startsWith('Flask ')) {
      // Flasks are evaluated after equipment & tree via `evaluateActiveFlasks` (supports Mageblood & FlaskEffect scaling)
      continue;
    }
    if (slot.startsWith('Charm ')) {
      // PoE 2 Charms only grant combat effects when explicitly toggled active; equipped charms do not passively apply
      if (!build.activeFlaskSlots?.[slot]) {
        continue;
      }
    }
    const isNecromanticAegisShield =
      hasNecromanticAegis &&
      slot === 'Weapon 2' &&
      (Boolean(item.armourStats) || /shield|buckler/i.test(item.baseName));
    if (isNecromanticAegisShield) {
      const aegisSrc = `Necromantic Aegis (Shield): ${item.name}`;
      const aegisResolved = resolveItemEffectiveStats(item, build.game);
      if (aegisResolved.armourStats?.armour) {
        necromanticAegisMods.push({ name: 'Armour', type: 'BASE', value: aegisResolved.armourStats.armour, flags: 0, keywordFlags: 0, source: aegisSrc });
      }
      if (aegisResolved.armourStats?.evasion) {
        necromanticAegisMods.push({ name: 'Evasion', type: 'BASE', value: aegisResolved.armourStats.evasion, flags: 0, keywordFlags: 0, source: aegisSrc });
      }
      if (aegisResolved.armourStats?.energyShield) {
        necromanticAegisMods.push({ name: 'EnergyShield', type: 'BASE', value: aegisResolved.armourStats.energyShield, flags: 0, keywordFlags: 0, source: aegisSrc });
      }
      if (aegisResolved.armourStats?.blockChance) {
        necromanticAegisMods.push({ name: 'BlockChance', type: 'BASE', value: aegisResolved.armourStats.blockChance, flags: 0, keywordFlags: 0, source: aegisSrc });
      }
      necromanticAegisMods.push(
        ...parseModLines(aegisResolved.globalImplicits, `${aegisSrc} [Implicit]`),
        ...parseModLines(aegisResolved.globalExplicits, aegisSrc),
      );
      continue;
    }
    const refreshedItem = refreshPoe2ItemRunesFromDataset(item);
    nonFlaskEquippedForUniques.push({ slot, item: refreshedItem });
    const src = `Item (${slot}): ${rawItem.name}${mirroredLabel}`;
    const runeExpandedItem = expandPoe2LocalRunes(slot, refreshedItem);
    const levelExpandedItem: Item = {
      ...runeExpandedItem,
      implicits: expandPerPlayerLevelMods(runeExpandedItem.implicits, build.level),
      explicits: expandPerPlayerLevelMods(runeExpandedItem.explicits, build.level),
    };
    const resolved = resolveItemEffectiveStats(levelExpandedItem, build.game, itemModOpts);
    const filledSockets = countFilledSockets(item);
    totalSocketFilledCount += filledSockets;
    if (slot === 'Body Armour') {
      bodyArmourEquipped = true;
      bodyArmourFilledRunes = filledSockets;
      if (item.rawText && /\{tags:[^}]*\blife\b/i.test(item.rawText)) {
        bodyArmourHasLifeMod = true;
      } else {
        for (const bl of [...item.implicits, ...item.explicits]) {
          const cleanBl = bl.replace(/\{[^}]*\}/g, '').trim();
          if (
            /\blife\b/i.test(cleanBl) &&
            !/no life modifiers|their maximum life|enemy'?s maximum life|corpse'?s maximum life/i.test(
              cleanBl,
            )
          ) {
            bodyArmourHasLifeMod = true;
            break;
          }
        }
      }
    }
    if (item.sockets) {
      const slotCols = { R: 0, G: 0, B: 0, W: 0 };
      for (const ch of item.sockets.toUpperCase()) {
        if (ch === 'R') {
          socketColorTotals.R++;
          slotCols.R++;
        } else if (ch === 'G') {
          socketColorTotals.G++;
          slotCols.G++;
        } else if (ch === 'B') {
          socketColorTotals.B++;
          slotCols.B++;
        } else if (ch === 'W') {
          socketColorTotals.W++;
          slotCols.W++;
        }
      }
      socketColorBySlot[slot] = slotCols;
    }
    if (item.rawText) {
      const rt = item.rawText;
      if (/^\s*Shaper Item\s*$/im.test(rt)) influenceCounts.ShaperItem!++;
      if (/^\s*Elder Item\s*$/im.test(rt)) influenceCounts.ElderItem!++;
      if (/^\s*Crusader Item\s*$/im.test(rt)) influenceCounts.CrusaderItem!++;
      if (/^\s*Hunter Item\s*$/im.test(rt)) influenceCounts.HunterItem!++;
      if (/^\s*Redeemer Item\s*$/im.test(rt)) influenceCounts.RedeemerItem!++;
      if (/^\s*Warlord Item\s*$/im.test(rt)) influenceCounts.WarlordItem!++;
      if (/^\s*Searing Exarch Item\s*$/im.test(rt)) influenceCounts.ExarchItem!++;
      if (/^\s*Eater of Worlds Item\s*$/im.test(rt)) influenceCounts.EaterItem!++;
      let reqStr = 0;
      let reqDex = 0;
      let reqInt = 0;
      const mReqLine = rt.match(/^\s*Requires\s*:\s*(.+)$/im);
      if (mReqLine?.[1]) {
        const rl = mReqLine[1];
        const ms = rl.match(/(\d+)\s*Str(?:ength)?\b/i);
        const md = rl.match(/(\d+)\s*Dex(?:terity)?\b/i);
        const mi = rl.match(/(\d+)\s*Int(?:elligence)?\b/i);
        if (ms) reqStr = Number(ms[1]);
        if (md) reqDex = Number(md[1]);
        if (mi) reqInt = Number(mi[1]);
      }
      const mStrHdr = rt.match(/^\s*(?:Str|Strength)\s*:\s*(\d+)/im);
      const mDexHdr = rt.match(/^\s*(?:Dex|Dexterity)\s*:\s*(\d+)/im);
      const mIntHdr = rt.match(/^\s*(?:Int|Intelligence)\s*:\s*(\d+)/im);
      if (mStrHdr) reqStr = Math.max(reqStr, Number(mStrHdr[1]));
      if (mDexHdr) reqDex = Math.max(reqDex, Number(mDexHdr[1]));
      if (mIntHdr) reqInt = Math.max(reqInt, Number(mIntHdr[1]));
      if (
        build.game === 'poe2' &&
        reqStr === 0 &&
        reqDex === 0 &&
        reqInt === 0 &&
        item.levelReq &&
        item.levelReq > 0 &&
        resolved.armourStats
      ) {
        const hasArm = (resolved.armourStats.armour ?? 0) > 0;
        const hasEva = (resolved.armourStats.evasion ?? 0) > 0;
        const hasEs = (resolved.armourStats.energyShield ?? 0) > 0;
        const defKinds = (hasArm ? 1 : 0) + (hasEva ? 1 : 0) + (hasEs ? 1 : 0);
        const factor =
          defKinds === 1
            ? slot === 'Gloves'
              ? 1.23
              : slot === 'Boots'
                ? 1.35
                : 1.41
            : defKinds === 2
              ? 0.78
              : 0.55;
        if (hasArm) reqStr = Math.round(item.levelReq * factor);
        if (hasEva) reqDex = Math.round(item.levelReq * factor);
        if (hasEs) reqInt = Math.round(item.levelReq * factor);
      }
      slotAttrReqs[slot] = { str: reqStr, dex: reqDex, int: reqInt };
    }
    const effectiveImplicits = expandPerSocketFilledMods(resolved.globalImplicits, filledSockets);
    const effectiveExplicits = expandPerSocketFilledMods(resolved.globalExplicits, filledSockets);
    if (slot === 'Belt' && build.game === 'poe2') {
      for (const bl of [...effectiveImplicits, ...effectiveExplicits]) {
        const mHasCharms = bl.match(/^Has (\d+) Charm Slots?$/i);
        if (mHasCharms) beltCharmSlots = Math.max(beltCharmSlots, Number(mHasCharms[1]));
        const mPlusCharms = bl.match(/^\+(\d+) Charm Slots?$/i);
        if (mPlusCharms) beltCharmSlots += Number(mPlusCharms[1]);
      }
      if (beltCharmSlots === 0 && item.rawText) {
        const mHeader = item.rawText.match(/^\s*Charm Slots\s*:\s*(\d+)/im);
        if (mHeader) beltCharmSlots = Number(mHeader[1]);
      }
      if (beltCharmSlots === 0) beltCharmSlots = 1;
    }
    for (const checkLine of [...effectiveImplicits, ...effectiveExplicits]) {
      const mYnda = checkLine.match(
        /^Gain Ward (equal to|instead of) (\d+)% of Armour and Evasion Rating (?:on|from) Equipped Body Armour$/i,
      );
      if (mYnda) {
        yndasStandWardPct += Number(mYnda[2]);
        if (mYnda[1]!.toLowerCase() === 'instead of') {
          yndasStandReplacesBodyDef = true;
        }
      }
      const mNightgrip = checkLine.match(
        /^(?:Gain|Adds) Chaos Damage equal to (\d+)% of Ward$/i,
      );
      if (mNightgrip) nightgripWardChaosPct += Number(mNightgrip[1]);
    }
    const hasStalkingPanther =
      build.game === 'poe2' &&
      allAllocatedNodeDefs.some((n) => n.name.en.trim().toLowerCase() === 'stalking panther');
    const slotEvaMult = hasStalkingPanther
      ? slot === 'Body Armour'
        ? 0.5
        : slot === 'Helmet' || slot === 'Gloves' || slot === 'Boots'
          ? 2
          : 1
      : 1;
    const effArmour = resolved.armourStats?.armour ?? 0;
    const effEvasion = Math.round((resolved.armourStats?.evasion ?? 0) * slotEvaMult);
    const effEs = resolved.armourStats?.energyShield ?? 0;
    if (slot === 'Body Armour') {
      bodyLocalArmour = effArmour;
      bodyLocalEvasion = effEvasion;
      bodyLocalEs = effEs;
      bodyArmourRarity = item.rarity;
    } else if (slot === 'Helmet') {
      helmetLocalArmour = effArmour;
      helmetLocalEvasion = effEvasion;
      helmetLocalEs = effEs;
    } else if (slot === 'Gloves') {
      glovesLocalArmour = effArmour;
      glovesLocalEvasion = effEvasion;
      glovesLocalEs = effEs;
    } else if (slot === 'Boots') {
      bootsLocalArmour = effArmour;
      bootsLocalEvasion = effEvasion;
      bootsLocalEs = effEs;
    } else if ((slot === 'Weapon 2' || slot === 'Weapon 2 Swap') && resolved.armourStats) {
      if (/\bfocus\b/i.test(item.baseName)) {
        focusLocalEs = effEs;
      } else {
        shieldLocalArmour = effArmour;
        shieldLocalEvasion = effEvasion;
        shieldLocalEs = effEs;
      }
      if ((resolved.armourStats.blockChance ?? 0) > 0 || /shield|buckler/i.test(item.baseName)) {
        usingShield = true;
        shieldBaseBlock = resolved.armourStats.blockChance ?? 0;
      }
    }
    if (effArmour) {
      db.addMod({ name: 'Armour', type: 'BASE', value: effArmour, flags: 0, keywordFlags: 0, source: src });
    }
    if (effEvasion) {
      db.addMod({ name: 'Evasion', type: 'BASE', value: effEvasion, flags: 0, keywordFlags: 0, source: src });
    }
    if (effEs) {
      db.addMod({ name: 'EnergyShield', type: 'BASE', value: effEs, flags: 0, keywordFlags: 0, source: src });
    }
    if (resolved.armourStats?.ward) {
      db.addMod({ name: 'Ward', type: 'BASE', value: resolved.armourStats.ward, flags: 0, keywordFlags: 0, source: src });
    }
    if (resolved.armourStats?.blockChance) {
      db.addMod({ name: 'BlockChance', type: 'BASE', value: resolved.armourStats.blockChance, flags: 0, keywordFlags: 0, source: src });
    }
    const parsedImpMods = parseModLines(effectiveImplicits, `${src} [Implicit]`, itemModOpts);
    const parsedExpMods = parseModLines(effectiveExplicits, src, itemModOpts);
    const isPoe2QuiverOffensiveStat = (name: string): boolean =>
      /^(?:CritChance|CritDamageBonusInc|CritDamageBonusFlat|CritMultiplier|Speed|Damage|PhysicalDamage|FireDamage|ColdDamage|LightningDamage|ChaosDamage|ElementalDamage|BowDamage|AttackDamage|ProjectileDamage|ProjectileSpeed|Accuracy|PierceChance|(?:Physical|Fire|Cold|Lightning|Chaos)(?:Min|Max))$/.test(
        name,
      );
    if (build.game === 'poe2' && resolved.weaponStats) {
      const wepScopeFlags =
        ModFlag.Attack | weaponTypeToModFlags(resolved.weaponStats.weaponType, resolved.weaponStats.twoHanded);
      for (const m of [...parsedImpMods, ...parsedExpMods]) {
        if (m.name === 'CritDamageBonusFlat' && m.flags === 0) {
          m.flags = wepScopeFlags;
        }
      }
    }
    // PoE 2 Quiver offensive attack/crit/damage/speed/accuracy mods ONLY apply to Bow attacks (CalcSetup.lua),
    // NOT Unarmed Concoctions (`Shattering/Poisonous/Fulminating Concoction`), while +Level of Projectile Skills stays global.
    // Scope to ModFlag.Bow only when main skill is an Unarmed Concoction so Bow Poison/Ailment queries remain intact.
    if (
      build.game === 'poe2' &&
      isInitialMainUnarmedConcoction &&
      (slot === 'Weapon 2' || slot === 'Weapon 2 Swap') &&
      /\bquiver\b/i.test(item.baseName)
    ) {
      for (const m of [...parsedImpMods, ...parsedExpMods]) {
        if (isPoe2QuiverOffensiveStat(m.name)) {
          m.flags |= ModFlag.Bow;
        }
      }
    }
    if (build.game === 'poe2') {
      const parsedItemModsAll = [...parsedImpMods, ...parsedExpMods];
      for (const rawLine of [...effectiveImplicits, ...effectiveExplicits]) {
        const cleanLine = rawLine.replace(/\{[^}]*\}/g, '').trim();
        const mItemExp = cleanLine.match(
          /^Inflict Elemental Exposure on Hit,\s*lowering Total Elemental Resistances by (\d+)%$/i,
        );
        if (mItemExp) {
          db.addMod({
            name: 'ItemEleExposureOnHit',
            type: 'MAX',
            value: Number(mItemExp[1]),
            flags: 0,
            keywordFlags: 0,
            source: src,
          });
          continue;
        }
        const mCursedTaken = cleanLine.match(/^Enemies you Curse take (\d+)% increased Damage$/i);
        if (mCursedTaken) {
          db.addMod({
            name: 'EnemyCursedDamageTaken',
            type: 'BASE',
            value: Number(mCursedTaken[1]),
            flags: 0,
            keywordFlags: 0,
            source: src,
          });
          continue;
        }
        const mCursedRes = cleanLine.match(
          /^Enemies you Curse have -(\d+)% to (Fire|Cold|Lightning|Chaos|Elemental) Resistances?$/i,
        );
        if (mCursedRes) {
          const elCap = mCursedRes[2]!.charAt(0).toUpperCase() + mCursedRes[2]!.slice(1).toLowerCase();
          db.addMod({
            name: `EnemyCursed${elCap}Resist`,
            type: 'BASE',
            value: -Number(mCursedRes[1]),
            flags: 0,
            keywordFlags: 0,
            source: src,
          });
          continue;
        }
        const mItemWither = cleanLine.match(/^(\d+)% increased (?:Withered Magnitudes?|Magnitude of Withered you inflict)$/i);
        if (mItemWither && !parsedItemModsAll.some((m) => m.name === 'WitherEffect' && Number(m.value) === Number(mItemWither[1]))) {
          db.addMod({ name: 'WitherEffect', type: 'INC', value: Number(mItemWither[1]), flags: 0, keywordFlags: 0, source: src });
          continue;
        }
        const mItemShock = cleanLine.match(/^(\d+)% increased (?:Magnitude of Shock you inflict|Shock Magnitudes?)$/i);
        if (
          mItemShock &&
          !parsedItemModsAll.some(
            (m) =>
              (m.name === 'ShockEffect' || m.name === 'ShockMagnitude' || m.name === 'EnemyShockMagnitude') &&
              Number(m.value) === Number(mItemShock[1]),
          )
        ) {
          db.addMod({ name: 'ShockEffect', type: 'INC', value: Number(mItemShock[1]), flags: 0, keywordFlags: 0, source: src });
          continue;
        }
        const mItemSpellCritDmg = cleanLine.match(/^(\d+)% increased Critical Spell Damage Bonus$/i);
        if (
          mItemSpellCritDmg &&
          !parsedItemModsAll.some(
            (m) => (m.name === 'CritDamageBonusInc' || m.name === 'CritMultiplier') && Number(m.value) === Number(mItemSpellCritDmg[1]),
          )
        ) {
          db.addMod({
            name: 'CritDamageBonusInc',
            type: 'INC',
            value: Number(mItemSpellCritDmg[1]),
            flags: ModFlag.Spell,
            keywordFlags: 0,
            source: src,
          });
          continue;
        }
      }
    }
    const globalImpMods = parsedImpMods.filter((m) => !m.tags?.some((t) => t.type === 'SocketedIn'));
    const globalExpMods = parsedExpMods.filter((m) => !m.tags?.some((t) => t.type === 'SocketedIn'));
    db.addMods(globalImpMods);
    db.addMods(globalExpMods);
    if (build.game === 'poe1') {
      const itemQual = Math.max(0, item.quality ?? 0);
      const parsedPoe1ItemMods = [...parsedImpMods, ...parsedExpMods];
      for (const rawLine of [...effectiveImplicits, ...effectiveExplicits]) {
        const cleanLine = rawLine.replace(/\{[^}]*\}/g, '').trim();
        if (!cleanLine) continue;
        // PoE 1 Lucky Damage with Hits on items (including 3.27/3.28 Foulborn `{mutated}Lightning Damage with Hits is Lucky...`)
        const mLuckyItem = cleanLine.match(
          /^(Lightning|Fire|Cold|Physical|Chaos)?\s*Damage with Hits is Lucky(?:\s+if\s+(.+))?$/i,
        );
        if (mLuckyItem && !parsedPoe1ItemMods.some((m) => /LuckyHits/i.test(m.name))) {
          const condText = mLuckyItem[2]?.trim() ?? '';
          const condActive =
            !condText ||
            /\{mutated\}/i.test(rawLine) ||
            (/blocked.*recently/i.test(condText) && Boolean(cfg.rawInputs?.conditionBlockedSpellRecently || cfg.rawInputs?.conditionBlockedRecently));
          if (condActive) {
            if (mLuckyItem[1]) {
              const elCap = mLuckyItem[1].charAt(0).toUpperCase() + mLuckyItem[1].slice(1).toLowerCase();
              db.addMod({ name: `${elCap}LuckyHitsChance`, type: 'BASE', value: 100, flags: 0, keywordFlags: 0, source: src });
            } else {
              db.addMod({ name: 'LuckyHits', type: 'FLAG', value: true, flags: 0, keywordFlags: 0, source: src });
            }
          }
          continue;
        }
        // PoE 1 Weapon Harvest Quality Enchants (global ones only; Attack Speed / Crit Chance per Quality are local and handled in localItem.ts)
        if (itemQual > 0 && /per\s+\d+%\s+Quality/i.test(cleanLine)) {
          const mQEle = cleanLine.match(/^(\d+)% increased Elemental Damage per (\d+)% Quality$/i);
          if (mQEle) {
            const v = Math.floor(itemQual / Number(mQEle[2])) * Number(mQEle[1]);
            if (v > 0) db.addMod({ name: 'ElementalDamage', type: 'INC', value: v, flags: 0, keywordFlags: 0, source: `${src} (Quality Enchant)` });
            continue;
          }
          const mQAoe = cleanLine.match(/^(\d+)% increased Area of Effect per (\d+)% Quality$/i);
          if (mQAoe) {
            const v = Math.floor(itemQual / Number(mQAoe[2])) * Number(mQAoe[1]);
            if (v > 0) db.addMod({ name: 'AreaOfEffect', type: 'INC', value: v, flags: 0, keywordFlags: 0, source: `${src} (Quality Enchant)` });
            continue;
          }
        }
        // Enmity's Embrace: Damage Penetrates Fire Resistance equal to Overcapped Fire Resistance, up to a maximum of X%
        const mEnmity = cleanLine.match(
          /^Damage Penetrates Fire Resistance equal to your Overcapped Fire Resistance(?:,\s*up to a maximum of (\d+)%)?$/i,
        );
        if (mEnmity) {
          const cap = mEnmity[1] ? Number(mEnmity[1]) : 200;
          db.addMod({ name: 'OvercappedFireResAsFirePenCap', type: 'MAX', value: cap, flags: 0, keywordFlags: 0, source: src });
          continue;
        }
        // Replica Heatshiver: Gain X% of Lightning Damage as Extra Cold Damage per Y% Shock on Enemy
        const mRepHs = cleanLine.match(
          /^Gain (\d+)% of Lightning Damage as Extra Cold Damage per (\d+)% Shock on Enemy$/i,
        );
        if (mRepHs) {
          db.addMod({
            name: 'ReplicaHeatshiverGainPerShock',
            type: 'BASE',
            value: Number(mRepHs[1]) / Math.max(1, Number(mRepHs[2])),
            flags: 0,
            keywordFlags: 0,
            source: src,
          });
          continue;
        }
        // Warlord Helmet: "Gain Accuracy Rating equal to your Strength"
        if (/^Gain Accuracy Rating equal to your Strength$/i.test(cleanLine)) {
          const alreadyHasStrAcc = [...globalImpMods, ...globalExpMods].some(
            (m) =>
              m.name === 'AccuracyRatingPerAttr:Strength' ||
              (m.name === 'Accuracy' && m.type === 'BASE' && m.tags?.some((t) => t.type === 'PerStat' && t.stat === 'Str')),
          );
          if (!alreadyHasStrAcc) {
            db.addMod({
              name: 'Accuracy',
              type: 'BASE',
              value: 1,
              flags: 0,
              keywordFlags: 0,
              source: src,
              tags: [{ type: 'PerStat', stat: 'Str', div: 1 }],
            });
          }
          continue;
        }
        // Hunter Boots: "You have Tailwind if you have dealt a Critical Strike Recently"
        if (/^You have Tailwind if you have dealt a Critical Strike Recently$/i.test(cleanLine)) {
          const alreadyHasTw = [...globalImpMods, ...globalExpMods].some((m) => m.name === 'Condition:Tailwind');
          if (!alreadyHasTw) {
            db.addMod({
              name: 'Condition:Tailwind',
              type: 'FLAG',
              value: true,
              flags: 0,
              keywordFlags: 0,
              source: src,
              tags: [{ type: 'Condition', var: 'CritRecently' }],
            });
          }
          continue;
        }
        // Venarius' Astrolabe: "+X to Level of all Elemental Skill/Support Gems if the stars are aligned"
        const mAstrolabe = cleanLine.match(
          /^\+(\d+) to Level of all Elemental (Skill|Support) Gems if the stars are aligned$/i,
        );
        if (mAstrolabe) {
          const kind = mAstrolabe[2]!.toLowerCase();
          const val = Number(mAstrolabe[1]);
          if (kind === 'support') {
            db.addMod({ name: 'GemLevelSup:elemental', type: 'BASE', value: val, flags: 0, keywordFlags: 0, source: src });
          } else {
            db.addMod({ name: 'GemLevel:elemental', type: 'BASE', value: val, flags: 0, keywordFlags: 0, source: src });
          }
          continue;
        }
      }
    }
    if (build.game === 'poe2') {
      const legacyLines = evaluatePoe2MagebloodLegacies(item);
      if (legacyLines.length > 0) {
        db.addMods(parseModLines(legacyLines, `${src} [Mage's Legacy]`, itemModOpts));
      }
    }
  }

  // Extra Socketed Equipment: PoE 1 Abyssal Sockets / Grafts & PoE 2 0.5 Grafted Limbs / Equipment Jewel Sockets
  for (const { slot, item: extraItem, effectMult } of collectExtraSocketedEquipment(build)) {
    if (cantUseBodyArmour && /^Body Armour\s+(?:Abyssal|Jewel)\s+Socket/i.test(slot)) {
      continue;
    }
    const src = `Socketed (${slot}): ${extraItem.name}`;
    const imps =
      effectMult !== 1
        ? extraItem.implicits.map((l) => scaleModLineByMultiplier(l, effectMult))
        : extraItem.implicits;
    const exps =
      effectMult !== 1
        ? extraItem.explicits.map((l) => scaleModLineByMultiplier(l, effectMult))
        : extraItem.explicits;
    db.addMods(parseModLines(imps, `${src} [Implicit]`, itemModOpts));
    db.addMods(parseModLines(exps, src, itemModOpts));
  }

  // PoE 2 Unbaked Runes, Soul Cores, Idols & Abyssal Eyes (`Rune:` headers without `{rune}` implicits)
  if (build.game === 'poe2') {
    const poe2RunesEval = evaluatePoe2UnbakedSocketedRunes(
      nonFlaskEquippedForUniques,
      build.game,
      { datasetRunes: poe2RunesDataset, allowBonded },
    );
    for (const entry of poe2RunesEval.addedStatLines) {
      db.addMods(parseModLines(entry.lines, entry.source, itemModOpts));
    }
    if (poe2RunesEval.addedMods.length > 0) {
      db.addMods(poe2RunesEval.addedMods);
    }
  }

  // PoE 2 Morior Invictus / per-Socket / per-Empty-Socket & Ingenuity / Ritualist Mystic Attunement Ring+Amulet scaling
  evaluatePerSocketItemModifiers(nonFlaskEquippedForUniques, db, itemModOpts);
  const hasMysticAttunement =
    build.game === 'poe2' &&
    allAllocatedNodeDefs.some((n) => n.name.en.trim().toLowerCase() === 'mystic attunement');
  const ringBonusEvalInput = hasMysticAttunement
    ? [
        ...nonFlaskEquippedForUniques,
        {
          slot: 'Ascendancy',
          item: {
            id: '__mystic_attunement__',
            name: 'Mystic Attunement',
            baseName: 'Ascendancy',
            rarity: 'UNIQUE' as const,
            slotType: 'Any' as const,
            quality: 0,
            implicits: [],
            explicits: ['25% increased bonuses gained from Equipped Rings'],
          },
        },
      ]
    : nonFlaskEquippedForUniques;
  const ingenuityRes = evaluateIngenuityAndRingBonuses(ringBonusEvalInput, db, itemModOpts);
  // Also apply Ingenuity/Mystic Attunement ring bonus to Ring 3 and Mystic Attunement +25% to Amulet
  const ring3Entry = nonFlaskEquippedForUniques.find((e) => e.slot === 'Ring 3');
  if (ring3Entry && ingenuityRes.allRingsBonusPct !== 0) {
    evaluateIngenuityAndRingBonuses(
      [
        { slot: 'Ring 1', item: ring3Entry.item },
        {
          slot: 'Belt',
          item: {
            id: '__ring3_scaler__',
            name: 'Ring Bonus Scaler',
            baseName: 'Belt',
            rarity: 'UNIQUE',
            slotType: 'Belt',
            quality: 0,
            implicits: [],
            explicits: [
              `${Math.abs(ingenuityRes.allRingsBonusPct)}% ${ingenuityRes.allRingsBonusPct >= 0 ? 'increased' : 'reduced'} bonuses gained from Equipped Left Ring`,
            ],
          },
        },
      ],
      db,
      itemModOpts,
    );
  }
  // Amulet +25% from Mystic Attunement is already applied via `AmuletEffect INC 25` (ascendancyMods.ts -> equipmentAndFlasks.ts).
  if (yndasStandWardPct > 0 && bodyLocalArmour + bodyLocalEvasion > 0) {
    const clampedYndaPct = Math.min(100, Math.max(0, yndasStandWardPct));
    db.addMod({
      name: 'Ward',
      type: 'BASE',
      value: Math.floor(((bodyLocalArmour + bodyLocalEvasion) * clampedYndaPct) / 100),
      flags: 0,
      keywordFlags: 0,
      source: "Unique: Ynda's Stand",
    });
    if (yndasStandReplacesBodyDef) {
      const removedArm = Math.floor((bodyLocalArmour * clampedYndaPct) / 100);
      const removedEva = Math.floor((bodyLocalEvasion * clampedYndaPct) / 100);
      if (removedArm > 0) {
        db.addMod({
          name: 'Armour',
          type: 'BASE',
          value: -removedArm,
          flags: 0,
          keywordFlags: 0,
          source: "Unique: Ynda's Stand (Body Armour -> Ward)",
        });
        bodyLocalArmour = Math.max(0, bodyLocalArmour - removedArm);
      }
      if (removedEva > 0) {
        db.addMod({
          name: 'Evasion',
          type: 'BASE',
          value: -removedEva,
          flags: 0,
          keywordFlags: 0,
          source: "Unique: Ynda's Stand (Body Armour -> Ward)",
        });
        bodyLocalEvasion = Math.max(0, bodyLocalEvasion - removedEva);
      }
    }
  }

  // Count main skill support colors (for Gemling Legionnaire) & Smith's Masterwork connected notables BEFORE Flasks & Auras
  const mainSupportColors = { red: 0, green: 0, blue: 0 };
  if (initialMainGroup) {
    for (const gm of initialMainGroup.gems) {
      if (!gm.enabled) continue;
      const gd = getGemById(build.game, gm.gemId);
      if (!gd || gd.category !== 'support') continue;
      if (gd.color === 'red') mainSupportColors.red++;
      else if (gd.color === 'green') mainSupportColors.green++;
      else if (gd.color === 'blue') mainSupportColors.blue++;
    }
  }
  const smithMasterworkNode = allAllocatedNodeDefs.find(
    (n) => n.name.en.trim().toLowerCase() === "smith's masterwork",
  );
  const connectedNotableCount = smithMasterworkNode
    ? smithMasterworkNode.adjacent.filter(
        (adjId) => activeTreeNodes.has(adjId) && tree.nodes[adjId]?.kind === 'notable',
      ).length
    : 0;
  db.setMultiplier('AllocatedConnectedNotable', connectedNotableCount);

  // Pre-stat Ascendancy Mechanics BEFORE Flasks & Auras so Nature's Boon (+30% FlaskEffect) & Inspirational (+30% AuraEffect) apply!
  // PoE 2 Lich `Eldritch Empowerment` only grants 30% more Spell Damage when `eldritchEmpowermentSacrifice` config is enabled (PoB2 ConfigOptions.lua:229).
  const preStatAllocatedNodes =
    build.game === 'poe2' && !cfg.rawInputs?.eldritchEmpowermentSacrifice
      ? allAllocatedNodeDefs.filter((n) => n.name.en.trim().toLowerCase() !== 'eldritch empowerment')
      : allAllocatedNodeDefs;
  applyPreStatAscendancyMechanics({
    game: build.game,
    db,
    allocatedNodes: preStatAllocatedNodes,
    config: cfg,
    bodyArmourStats: {
      armour: bodyLocalArmour,
      evasion: bodyLocalEvasion,
      energyShield: bodyLocalEs,
    },
    bodyArmourRarity,
    connectedNotableCount,
    mainSkillSupportColors: mainSupportColors,
    activeAuraCount: 0,
    masteryCount: 0,
  });

  // Pre-stat Build-Enabling Uniques BEFORE Auras so Ashes of the Stars (+GemLevel/+GemQuality) scales Aura Gems too!
  const preUniqueRes: PreStatUniqueResult = evaluatePreStatBuildEnablingUniques({
    db,
    equippedItems: nonFlaskEquippedForUniques,
    socketedJewels: allJewelItems,
    classBaseAttributes: {
      str: classDef.baseStr,
      dex: classDef.baseDex,
      int: classDef.baseInt,
    },
    game: build.game,
  });

  // Evaluate Active Flasks & Tinctures (PoE 1 Mageblood auto-activation, magic utility flask base buffs, Enkindling/Alchemist + global FlaskEffect scaling)
  const flaskEval = evaluateActiveFlasks(build, db.sum('INC', 'FlaskEffect'), {
    ironFlaskEffectPct: db.sum('INC', 'IronFlaskEffect'),
    tinctureEffectPct: db.sum('INC', 'TinctureEffect'),
  });
  if (flaskEval.activeSlots.length > 0) {
    db.setCondition('UsingFlask', true);
  }
  if (flaskEval.modLines.length > 0) {
    db.addMods(parseModLines(flaskEval.modLines, 'Active Flasks', itemModOpts));
  }

  // Special Meta Unique Mechanics (Widowhail, Melding of the Flesh, Ralakesh, Prism of Belief, Sacred Flame, Aegis, Svalinn)
  const uniqueGearResult = evaluateSpecialUniqueGearMechanics(
    nonFlaskEquippedForUniques,
    db,
    build.game,
    { socketedJewels: allJewelItems, skipHeistBaseMagnitudes: true },
  );
  // Scope PoE 2 Widowhail / Quiver Effect scaled offensive mods to ModFlag.Bow only for Unarmed Concoctions
  if (build.game === 'poe2' && isInitialMainUnarmedConcoction) {
    for (const [statName, modList] of db.entriesByPrefix('')) {
      if (
        !/^(?:CritChance|CritDamageBonusInc|CritDamageBonusFlat|CritMultiplier|Speed|Damage|PhysicalDamage|FireDamage|ColdDamage|LightningDamage|ChaosDamage|ElementalDamage|BowDamage|AttackDamage|ProjectileDamage|ProjectileSpeed|Accuracy|PierceChance|(?:Physical|Fire|Cold|Lightning|Chaos)(?:Min|Max))$/.test(
          statName,
        )
      ) {
        continue;
      }
      for (const m of modList) {
        if (m.source.startsWith('Quiver Effect (')) {
          m.flags |= ModFlag.Bow;
        }
      }
    }
  }

  // Parse & apply Custom Modifiers BEFORE keystone pool conversions, auras, and Pain Attunement (62dfba0)
  const customModLines = cfg.customMods
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => Boolean(l) && !l.startsWith('#') && !l.startsWith('//') && !l.startsWith('--'));
  const parsedCustomAffixMods = parseModLines(customModLines, 'Custom Modifiers').map((m) => {
    const mGainCase = m.name.match(/^((?:Physical|Fire|Cold|Lightning|Elemental|NonChaos)?DamageGainAs)(physical|fire|cold|lightning|chaos)$/);
    if (mGainCase) {
      const dstCap = mGainCase[2]!.charAt(0).toUpperCase() + mGainCase[2]!.slice(1);
      return { ...m, name: `${mGainCase[1]}${dstCap}` };
    }
    return m;
  });
  if (parsedCustomAffixMods.length > 0) {
    db.addMods(parsedCustomAffixMods);
  }
  // Custom modifier shorthand: "X% increased/reduced Defences" (global Armour, Evasion, Energy Shield)
  for (const cl of customModLines) {
    const mDef = cl.match(/^(\d+)% (increased|reduced) (?:global )?defences$/i);
    if (mDef) {
      const alreadyHas = parsedCustomAffixMods.some(
        (m) => m.name === 'EnergyShield' && m.type === 'INC' && Math.abs(Number(m.value)) === Number(mDef[1]),
      );
      if (!alreadyHas) {
        const v = (mDef[2]!.toLowerCase() === 'reduced' ? -1 : 1) * Number(mDef[1]);
        db.addMod({ name: 'Armour', type: 'INC', value: v, flags: 0, keywordFlags: 0, source: 'Custom Modifiers' });
        db.addMod({ name: 'Evasion', type: 'INC', value: v, flags: 0, keywordFlags: 0, source: 'Custom Modifiers' });
        db.addMod({ name: 'EnergyShield', type: 'INC', value: v, flags: 0, keywordFlags: 0, source: 'Custom Modifiers' });
      }
    }
  }

  // 4. Pool-Zeroing Keystones/Uniques + Global Auras, Curses/Marks, Persistent Buffs & Watcher's Eye
  const keystonePoolResult = applyPoolZeroingAndKeystoneRules({
    game: build.game,
    db,
    allocatedNodes: allAllocatedNodeDefs,
    equippedItems: nonFlaskEquippedForUniques,
    socketedJewels: activeSocketedJewels,
    baseMaxBlockChance: ruleset.maxBlockChance,
  });

  const customAuraEffect = 0;
  const customCurseEffect = 0;

  const auraMinionDb = new ModDB();
  const auraEnemyDb = new ModDB();
  if (necromanticAegisMods.length > 0) {
    auraMinionDb.addMods(necromanticAegisMods);
  }
  if (cfg.importedPartyMods && cfg.importedPartyMods.length > 0) {
    for (const pm of cfg.importedPartyMods) {
      if (pm.target === 'enemy') {
        auraEnemyDb.addMod(pm);
      } else {
        db.addMod(pm);
      }
    }
  }
  // Boss & Pinnacle enemy context conditions + PoE 2 Unique Boss curse/exposure penalties
  if (cfg.enemyIsBoss !== 'None') {
    auraEnemyDb.setCondition('RareOrUnique', true);
    db.setCondition('EnemyRareOrUnique', true);
    db.setMultiplier('EnemyPower', 20);
    if (cfg.enemyIsBoss === 'Pinnacle') {
      auraEnemyDb.setCondition('PinnacleBoss', true);
      db.setCondition('EnemyPinnacleBoss', true);
    }
    if (build.game === 'poe2') {
      auraEnemyDb.setCondition('Unique', true);
      auraEnemyDb.addMod({
        name: 'CurseEffectOnSelf',
        type: 'MORE',
        value: -50,
        flags: 0,
        keywordFlags: 0,
        source: 'Unique Boss',
      });
      auraEnemyDb.addMod({
        name: 'ExposureEffectOnSelf',
        type: 'MORE',
        value: -50,
        flags: 0,
        keywordFlags: 0,
        source: 'Unique Boss',
      });
    }
    if (cfg.rawInputs?.__enemyIsUber) {
      auraEnemyDb.addMod({
        name: 'DamageTaken',
        type: 'MORE',
        value: -70,
        flags: 0,
        keywordFlags: 0,
        source: 'Uber Pinnacle Boss',
      });
    }
  }

  // Populate generic PoB <ConfigSet><Input> Conditions & Multipliers BEFORE Aura/Buff & Stat evaluation
  if (build.game === 'poe1' && cfg.rawInputs?.bloodSandStance !== 'SAND') {
    db.setCondition('BloodStance', true);
    auraEnemyDb.setCondition('BloodStance', true);
  } else if (build.game === 'poe1' && cfg.rawInputs?.bloodSandStance === 'SAND') {
    db.setCondition('SandStance', true);
    auraEnemyDb.setCondition('SandStance', true);
  }
  if (cfg.rawInputs?.bannerPlanted) {
    db.setCondition('BannerPlanted', true);
    if (build.game === 'poe1') {
      const maxValour = 50 + db.sum('BASE', ['MaximumValour', 'MaxValour']);
      const rawValour =
        typeof cfg.rawInputs.bannerValour === 'number' ? cfg.rawInputs.bannerValour : maxValour;
      const effValour = Math.max(0, Math.min(maxValour, rawValour));
      db.setMultiplier('ValourStacks', effValour);
      db.setMultiplier('BannerValour', effValour);
    }
  }
  if (build.game === 'poe1') {
    if (cfg.rawInputs?.Unbound) {
      db.setCondition('Unbound', true);
    }
    if (cfg.rawInputs?.bladestormInBloodstorm) {
      db.setCondition('BladestormInBloodstorm', true);
    }
    if (cfg.rawInputs?.bladestormInSandstorm) {
      db.setCondition('BladestormInSandstorm', true);
    }
    if (typeof cfg.rawInputs?.barkskinStacks === 'number') {
      const bs = Math.max(0, Math.min(10, cfg.rawInputs.barkskinStacks));
      db.setMultiplier('BarkskinStacks', bs);
      db.setMultiplier('MissingBarkskinStacks', 10 - bs);
    }
  }
  const prideMaxEffect = cfg.rawInputs?.prideEffect === 'MAX';
  db.setCondition('PrideMaxEffect', prideMaxEffect);
  auraEnemyDb.setCondition('PrideMaxEffect', prideMaxEffect);
  if (db.sum('BASE', 'FewerEnemiesToBeSurrounded') >= 5) {
    db.setCondition('Surrounded', true);
  }
  if (cfg.rawInputs) {
    let risingTempestCount = 0;
    for (const [rawKey, rawVal] of Object.entries(cfg.rawInputs)) {
      if (typeof rawVal === 'boolean') {
        if (rawKey.startsWith('conditionEnemy') && rawKey.length > 'conditionEnemy'.length) {
          const enemyVar = rawKey.slice('conditionEnemy'.length);
          // PoE 2 Exposure conditions are gated on CanApply<El>Exposure in applyPoe2ExposureCfg (CalcPerform.lua:472-485)
          if (
            build.game === 'poe2' &&
            (enemyVar === 'FireExposure' || enemyVar === 'ColdExposure' || enemyVar === 'LightningExposure')
          ) {
            continue;
          }
          db.setCondition(`Enemy${enemyVar}`, rawVal);
          auraEnemyDb.setCondition(enemyVar, rawVal);
          if (enemyVar === 'Ignited' && rawVal) {
            db.setCondition('EnemyBurning', true);
            auraEnemyDb.setCondition('Burning', true);
          } else if (enemyVar === 'CriticalWeakness' && rawVal && build.game === 'poe2') {
            const cwStacks =
              typeof cfg.rawInputs.enemyCriticalWeaknessStacks === 'number'
                ? cfg.rawInputs.enemyCriticalWeaknessStacks
                : 20;
            const cwCrit = Math.max(0, Math.min(20, cwStacks)) / 2;
            if (cwCrit > 0) {
              auraEnemyDb.addMod({
                name: 'SelfCritChance',
                type: 'BASE',
                value: cwCrit,
                flags: 0,
                keywordFlags: 0,
                source: 'Critical Weakness',
              });
            }
          } else if (enemyVar === 'CoveredInAsh' && rawVal) {
            auraEnemyDb.addMod({
              name: 'FireDamageTaken',
              type: 'INC',
              value: 20,
              flags: 0,
              keywordFlags: 0,
              source: 'Covered in Ash',
            });
          } else if (enemyVar === 'CoveredInFrost' && rawVal) {
            auraEnemyDb.addMod({
              name: 'ColdDamageTaken',
              type: 'INC',
              value: 20,
              flags: 0,
              keywordFlags: 0,
              source: 'Covered in Frost',
            });
          } else if (enemyVar === 'Brittle' && rawVal && build.game === 'poe1') {
            const brittleVal =
              typeof cfg.rawInputs.conditionBrittleEffect === 'number'
                ? Math.max(0, Math.min(6, cfg.rawInputs.conditionBrittleEffect))
                : 6;
            if (brittleVal > 0) {
              auraEnemyDb.addMod({
                name: 'SelfCritChance',
                type: 'BASE',
                value: brittleVal,
                flags: 0,
                keywordFlags: 0,
                source: 'Brittle',
              });
            }
          } else if (enemyVar === 'OnBrittleGround' && rawVal && build.game === 'poe1') {
            auraEnemyDb.setCondition('Brittle', true);
            db.setCondition('EnemyBrittle', true);
            if (!cfg.rawInputs.conditionEnemyBrittle) {
              auraEnemyDb.addMod({
                name: 'SelfCritChance',
                type: 'BASE',
                value: 2,
                flags: 0,
                keywordFlags: 0,
                source: 'Brittle Ground',
              });
            }
          } else if (enemyVar === 'Scorched' && rawVal && build.game === 'poe1') {
            const scorchVal =
              typeof cfg.rawInputs.conditionScorchedEffect === 'number'
                ? Math.max(0, Math.min(30, cfg.rawInputs.conditionScorchedEffect))
                : 30;
            if (scorchVal > 0) {
              for (const r of ['FireResist', 'ColdResist', 'LightningResist'] as const) {
                auraEnemyDb.addMod({
                  name: r,
                  type: 'BASE',
                  value: -scorchVal,
                  flags: 0,
                  keywordFlags: 0,
                  source: 'Scorched',
                });
              }
            }
          } else if (enemyVar === 'OnScorchedGround' && rawVal && build.game === 'poe1') {
            auraEnemyDb.setCondition('Scorched', true);
            db.setCondition('EnemyScorched', true);
            if (!cfg.rawInputs.conditionEnemyScorched) {
              for (const r of ['FireResist', 'ColdResist', 'LightningResist'] as const) {
                auraEnemyDb.addMod({
                  name: r,
                  type: 'BASE',
                  value: -10,
                  flags: 0,
                  keywordFlags: 0,
                  source: 'Scorched Ground',
                });
              }
            }
          }
        } else if (rawKey === 'conditionOldSpear' && rawVal) {
          db.setCondition('SpearOlderThanHalfSecond', true);
        } else if (rawKey.startsWith('condition') && rawKey.length > 'condition'.length) {
          db.setCondition(rawKey.slice('condition'.length), rawVal);
        } else if (
          (rawKey === 'risingTempestLightning' ||
            rawKey === 'risingTempestCold' ||
            rawKey === 'risingTempestFire') &&
          rawVal
        ) {
          risingTempestCount += 1;
        } else if (rawKey === 'momentumDamage' && rawVal) {
          db.setCondition('Moved2m', true);
        } else if (rawKey === 'parryActive' && rawVal) {
          db.setCondition('ParryActive', true);
        } else if (rawKey === 'onLeyline' && rawVal) {
          db.setCondition('OnLeyline', true);
        } else if (rawKey.startsWith('buff') && rawKey.length > 'buff'.length) {
          db.setCondition(rawKey.slice('buff'.length), rawVal);
          if (rawKey === 'buffUnholyMight' && rawVal) {
            if (build.game === 'poe1') {
              db.addMod({
                name: 'PhysicalDamageConvertToChaos',
                type: 'BASE',
                value: 100,
                flags: 0,
                keywordFlags: 0,
                source: 'Unholy Might',
              });
            } else {
              db.addMod({
                name: 'DamageGainAsChaos',
                type: 'BASE',
                value: 30,
                flags: 0,
                keywordFlags: 0,
                source: 'Chaotic Might',
              });
            }
          } else if (rawKey === 'buffDiamondShrine' && rawVal) {
            db.addMod({
              name: 'DiamondShrineCrit',
              type: 'FLAG',
              value: true,
              flags: 0,
              keywordFlags: 0,
              source: 'Diamond Shrine',
            });
          } else if (rawKey === 'buffAdrenaline' && rawVal) {
            db.addMod({ name: 'Damage', type: 'INC', value: 100, flags: 0, keywordFlags: 0, source: 'Adrenaline' });
            db.addMod({ name: 'Speed', type: 'INC', value: 25, flags: ModFlag.Attack, keywordFlags: 0, source: 'Adrenaline' });
            db.addMod({ name: 'Speed', type: 'INC', value: 25, flags: ModFlag.Spell, keywordFlags: 0, source: 'Adrenaline' });
            db.addMod({ name: 'MovementSpeed', type: 'INC', value: 25, flags: 0, keywordFlags: 0, source: 'Adrenaline' });
            db.addMod({ name: 'PhysDamageReduction', type: 'BASE', value: 10, flags: 0, keywordFlags: 0, source: 'Adrenaline' });
          }
        } else if (rawKey === 'brandAttachedToEnemy' && rawVal) {
          db.setCondition('TargetingBrandedEnemy', true);
        } else if (rawKey === 'infusedChannellingInfusion' && rawVal) {
          db.setCondition('InfusionActive', true);
        } else if (rawKey === 'arcaneCloakUsedRecentlyCheck' && rawVal) {
          db.setCondition('ArcaneCloakUsedRecently', true);
        }
      } else if (typeof rawVal === 'number') {
        if (rawKey.startsWith('multiplier') && rawKey.length > 'multiplier'.length) {
          const multVar = rawKey.slice('multiplier'.length);
          db.setMultiplier(multVar, rawVal);
          db.setStat(multVar, rawVal);
          if (multVar.endsWith('Count') && multVar.length > 5) {
            const baseVar = multVar.slice(0, -5);
            db.setMultiplier(baseVar, rawVal);
            db.setStat(baseVar, rawVal);
          }
          if (multVar === 'PoisonOnEnemy') {
            db.setMultiplier('PoisonStacks', rawVal);
          } else if (multVar === 'NearbyEnemies' && rawVal === 1) {
            db.setCondition('OnlyOneNearbyEnemy', true);
            db.setCondition('AtMostOneNearbyRareOrUniqueEnemy', true);
          }
        } else if (rawKey === 'conditionEnemyChilledEffect') {
          db.setMultiplier('EnemyChillEffect', rawVal);
        } else if (rawKey === 'aspectOfTheSpiderWebStacks') {
          auraEnemyDb.setMultiplier('SpiderWeb', rawVal);
        } else if (rawKey === 'frostShieldStages') {
          db.setMultiplier('FrostShieldStage', rawVal);
        } else if (rawKey === 'sigilOfPowerStages') {
          db.setMultiplier('SigilOfPowerStage', rawVal);
        } else if (rawKey === 'intensifyIntensity') {
          db.setMultiplier('Intensity', rawVal);
        } else if (rawKey === 'overrideCruelty') {
          db.setMultiplier('Cruelty', Math.min(40, Math.max(0, rawVal)));
        } else if (rawKey === 'configResonanceCount') {
          const effRes =
            build.game === 'poe2'
              ? Math.max(0, Math.min(10, rawVal > 10 ? Math.floor(rawVal / 30) : rawVal))
              : Math.max(0, Math.min(50, rawVal));
          db.setMultiplier('ResonanceCount', effRes);
          db.setStat('ResonanceCount', effRes);
        } else if (rawKey === 'configUnholyResonanceCount') {
          const effURes = Math.max(0, Math.min(50, rawVal));
          db.setMultiplier('UnholyResonanceCount', effURes);
          db.setStat('UnholyResonanceCount', effURes);
          db.setMultiplier('ResonanceCount', effURes);
          db.setStat('ResonanceCount', effURes);
        } else if (rawKey === 'BrandsAttachedToEnemy') {
          db.setMultiplier('BrandsAttachedToEnemy', rawVal);
          if (rawVal > 0) db.setCondition('TargetingBrandedEnemy', true);
        } else if (rawKey === 'SecondsSinceInevitableCrit') {
          db.setMultiplier('SecondsSinceInevitableCrit', rawVal);
          if (rawVal < 4) {
            db.setCondition('CritRecently', true);
            db.setCondition('SkillCritRecently', true);
          }
        } else if (rawKey === 'incisionConsumedRecently') {
          db.setMultiplier('IncisionConsumedRecently', rawVal);
        } else if (rawKey === 'windDancerStacks') {
          db.setMultiplier('WindDancerStacks', rawVal);
        } else if (rawKey === 'purpleFlameStacks') {
          db.setMultiplier('PurpleFlamesCount', Math.min(10, Math.max(0, rawVal)));
        } else if (rawKey === 'TotemsSummoned') {
          db.setMultiplier('SummonedTotem', rawVal);
          db.setMultiplier('TotemsSummoned', rawVal);
        }
      } else if (typeof rawVal === 'string') {
        if (rawKey === 'prideEffect' && rawVal.toUpperCase() === 'MAX') {
          db.setCondition('PrideMaxEffect', true);
          auraEnemyDb.setCondition('PrideMaxEffect', true);
        } else if (rawKey === 'bloodSandStance') {
          if (rawVal.toUpperCase() === 'SAND') {
            db.setCondition('SandStance', true);
            db.setCondition('BloodStance', false);
          } else if (rawVal.toUpperCase() === 'BLOOD') {
            db.setCondition('BloodStance', true);
            db.setCondition('SandStance', false);
          }
        }
      }
    }
    if (risingTempestCount > 0) {
      db.setMultiplier('DifferentElementalSkillUsedRecently', risingTempestCount);
    }
  }
  // Pre-set stance & stage multipliers from enabled persistent skills before evaluateAurasAndWatchersEye
  for (const grp of build.skills) {
    if (!grp.enabled) continue;
    for (const gm of grp.gems) {
      if (!gm.enabled) continue;
      const gd = getGemById(build.game, gm.gemId);
      if (!gd) continue;
      const gn = gd.name.en.trim().toLowerCase();
      if (gn === 'blood and sand' || gn === 'flesh and stone') {
        const sp = gm.skillPart ?? grp.skillPart ?? 1;
        if (sp === 2) {
          db.setCondition('SandStance', true);
          db.setCondition('BloodStance', false);
        } else {
          db.setCondition('BloodStance', true);
          db.setCondition('SandStance', false);
        }
      } else if (gn === 'wind dancer' && build.game === 'poe2') {
        const rawWd = Number(
          cfg.rawInputs?.windDancerStacks ??
            cfg.rawInputs?.multiplierWindDancerStacks ??
            cfg.rawInputs?.multiplierWindDancerStage ??
            (gm.count !== undefined ? gm.count : 0),
        );
        const wdStacks = Number.isFinite(rawWd) ? Math.min(6, Math.max(0, Math.round(rawWd))) : 0;
        db.setMultiplier('WindDancerStage', wdStacks);
        db.setMultiplier('WindDancerStacks', wdStacks);
      } else if (gn === 'scavenged plating' && build.game === 'poe2') {
        const rawSp = Number(
          cfg.rawInputs?.scavengedPlatingStacks ??
            cfg.rawInputs?.multiplierScavengedPlatingStacks ??
            cfg.rawInputs?.multiplierScavengedPlatingStack ??
            (gm.count !== undefined ? gm.count : 0),
        );
        const spStacks = Number.isFinite(rawSp) ? Math.min(12, Math.max(0, Math.round(rawSp))) : 0;
        db.setMultiplier('ScavengedPlatingStack', spStacks);
        db.setMultiplier('ScavengedPlatingStacks', spStacks);
      } else if (gn === 'trinity') {
        const defaultRes = build.game === 'poe2' ? 0 : 50;
        const rawRes = Number(cfg.rawInputs?.configResonanceCount ?? defaultRes);
        const effRes =
          build.game === 'poe2'
            ? cfg.rawInputs?.configResonanceCount === undefined
              ? 0
              : Math.max(0, Math.min(10, rawRes > 10 ? Math.floor(rawRes / 30) : Math.floor(rawRes)))
            : Math.max(0, Math.min(50, Number.isFinite(rawRes) ? rawRes : defaultRes));
        db.setMultiplier('ResonanceCount', effRes);
        db.setStat('ResonanceCount', effRes);
      } else if (gn === 'demon form' && build.game === 'poe2' && cfg.rawInputs?.inDemonForm !== false) {
        db.setCondition('DemonForm', true);
        db.setCondition('Shapeshifted', true);
        const dfStacks = Number(cfg.rawInputs?.demonFormStacks ?? 10);
        db.setMultiplier('DemonFlameStacks', Number.isFinite(dfStacks) && dfStacks > 0 ? dfStacks : 10);
      } else if (
        build.game === 'poe1' &&
        gn === 'frost shield' &&
        Number(cfg.rawInputs?.frostShieldStages ?? 0) > 0
      ) {
        const fsStages = Math.min(4, Math.max(0, Math.round(Number(cfg.rawInputs?.frostShieldStages ?? 0))));
        const fsLvl = resolveGemLevelEntry(gd, Math.max(1, Math.min(40, gm.level)));
        const fsCmods = fsLvl?.compiledMods ?? gd.compiledMods ?? [];
        const critMod = fsCmods.find((m) => m.name === 'CritChance' && m.type === 'BASE' && typeof m.value === 'number');
        if (critMod && typeof critMod.value === 'number' && fsStages > 0) {
          db.addMod({
            name: 'BaseCritChance',
            type: 'BASE',
            value: critMod.value * fsStages,
            flags: ModFlag.Spell,
            keywordFlags: 0,
            source: `Skill: Frost Shield (${fsStages} stages)`,
          });
        }
      } else if (
        build.game === 'poe1' &&
        gn === 'sigil of power' &&
        Number(cfg.rawInputs?.sigilOfPowerStages ?? 0) > 0
      ) {
        const spStages = Math.min(4, Math.max(0, Math.round(Number(cfg.rawInputs?.sigilOfPowerStages ?? 0))));
        const spLvl = resolveGemLevelEntry(gd, Math.max(1, Math.min(40, gm.level)));
        const spCmods = spLvl?.compiledMods ?? gd.compiledMods ?? [];
        const lMinMod = spCmods.find((m) => m.name === 'LightningMin' && m.type === 'BASE' && typeof m.value === 'number');
        const lMaxMod = spCmods.find((m) => m.name === 'LightningMax' && m.type === 'BASE' && typeof m.value === 'number');
        if (lMinMod && lMaxMod && typeof lMinMod.value === 'number' && typeof lMaxMod.value === 'number' && spStages > 0) {
          db.addMod({
            name: 'LightningMin',
            type: 'BASE',
            value: lMinMod.value * spStages,
            flags: 0,
            keywordFlags: 0,
            source: `Skill: Sigil of Power (${spStages} stages)`,
          });
          db.addMod({
            name: 'LightningMax',
            type: 'BASE',
            value: lMaxMod.value * spStages,
            flags: 0,
            keywordFlags: 0,
            source: `Skill: Sigil of Power (${spStages} stages)`,
          });
        }
      } else if (
        build.game === 'poe1' &&
        (gn === 'molten shell' || gn === 'vaal molten shell') &&
        gm.enableGlobal1 !== false
      ) {
        const msLvl = resolveGemLevelEntry(gd, Math.max(1, Math.min(40, gm.level)));
        const msCmods = msLvl?.compiledMods ?? gd.compiledMods ?? [];
        const flatArmMod = msCmods.find((m) => m.name === 'Armour' && m.type === 'BASE' && typeof m.value === 'number');
        if (flatArmMod && typeof flatArmMod.value === 'number' && flatArmMod.value > 0) {
          const buffEffMult = Math.max(0, 1 + db.sum('INC', 'BuffEffect') / 100) * db.more('BuffEffect');
          db.addMod({
            name: 'Armour',
            type: 'BASE',
            value: Math.floor(flatArmMod.value * buffEffMult + 1e-9),
            flags: 0,
            keywordFlags: 0,
            source: `Skill: ${gd.name.en}`,
          });
        }
      }
    }
  }

  // PoE 1 Warcry Player Buffs (when enabled and NOT linked to Autoexertion — aligned with PoB1 CalcPerform.lua:2476)
  if (build.game === 'poe1' && !db.flag('CannotGainWarcryBuffs')) {
    const appliedWarcryBuffs = new Set<string>();
    const hasRedbladeBanner = nonFlaskEquippedForUniques.some(
      (e) => e.item.name.trim().toLowerCase() === 'redblade banner',
    );
    const minWarcryPower = db.sum('BASE', 'MinimumWarcryPower');
    const baseEnemyPower = cfg.enemyIsBoss !== 'None' ? 20 : 5;
    const warcryPower = hasRedbladeBanner ? 100 : Math.max(baseEnemyPower, minWarcryPower);
    const globalDurInc = db.sum('INC', 'Duration') + db.sum('INC', 'WarcryDuration');
    const globalDurMore = db.more('Duration') * db.more('WarcryDuration');
    const globalCdrInc = db.sum('INC', 'CooldownRecovery') + db.sum('INC', 'WarcryCooldownRecoveryRate');
    const warcryBuffEffMult =
      Math.max(0, 1 + (db.sum('INC', 'BuffEffect') + db.sum('INC', 'WarcryBuffEffect')) / 100) *
      db.more('BuffEffect');

    for (const grp of build.skills) {
      if (!grp.enabled) continue;
      const hasAutoexertion = grp.gems.some((gm) => {
        if (!gm.enabled) return false;
        const d = getGemById('poe1', gm.gemId);
        return Boolean(d && d.name.en.trim().toLowerCase() === 'autoexertion');
      });
      if (hasAutoexertion) continue;

      for (const gm of grp.gems) {
        if (!gm.enabled) continue;
        const gd = getGemById('poe1', gm.gemId);
        if (!gd || gd.category !== 'active') continue;
        const gn = gd.name.en.trim().toLowerCase();
        if (appliedWarcryBuffs.has(gn)) continue;
        if (
          gn !== 'seismic cry' &&
          gn !== 'ancestral cry' &&
          gn !== 'infernal cry' &&
          gn !== 'intimidating cry' &&
          gn !== "battlemage's cry"
        ) {
          continue;
        }
        appliedWarcryBuffs.add(gn);
        const lvEntry = resolveGemLevelEntry(gd, Math.max(1, Math.min(40, gm.level)));
        const sd = lvEntry?.skillData ?? gd.skillData ?? {};
        const baseDur = typeof sd.duration === 'number' && sd.duration > 0 ? sd.duration : 3.4;
        const baseCd = typeof sd.cooldown === 'number' && sd.cooldown > 0 ? sd.cooldown : 8;
        const fullDur = baseDur * Math.max(0, 1 + globalDurInc / 100) * globalDurMore;
        const actualCd = baseCd / Math.max(0.1, 1 + globalCdrInc / 100);
        const uptime = Math.min(1, fullDur / Math.max(0.1, actualCd));
        const powerCap = gn === 'ancestral cry' ? 15 : gn === "battlemage's cry" ? 30 : 25;
        const powerBonus = Math.floor(Math.min(warcryPower, powerCap) / 5);
        const mult = warcryBuffEffMult * powerBonus * uptime;
        if (mult <= 0) continue;

        if (gn === 'seismic cry') {
          const armMore = Math.floor(5 * mult + 1e-9);
          if (armMore > 0) {
            db.addMod({ name: 'Armour', type: 'MORE', value: armMore, flags: 0, keywordFlags: 0, source: 'Skill: Seismic Cry' });
          }
        } else if (gn === 'ancestral cry') {
          const maxRes = Math.floor(1 * mult + 1e-9);
          const eleRes = Math.floor(5 * mult + 1e-9);
          if (maxRes > 0) {
            for (const mr of ['FireResistMax', 'ColdResistMax', 'LightningResistMax'] as const) {
              db.addMod({ name: mr, type: 'BASE', value: maxRes, flags: 0, keywordFlags: 0, source: 'Skill: Ancestral Cry' });
            }
          }
          if (eleRes > 0) {
            for (const er of ['FireResist', 'ColdResist', 'LightningResist'] as const) {
              db.addMod({ name: er, type: 'BASE', value: eleRes, flags: 0, keywordFlags: 0, source: 'Skill: Ancestral Cry' });
            }
          }
        } else if (gn === 'infernal cry') {
          const physAsFire = Math.floor(5 * mult + 1e-9);
          if (physAsFire > 0) {
            db.addMod({ name: 'PhysicalDamageGainAsFire', type: 'BASE', value: physAsFire, flags: 0, keywordFlags: 0, source: 'Skill: Infernal Cry' });
          }
        } else if (gn === 'intimidating cry') {
          const msInc = Math.floor(3 * mult + 1e-9);
          if (msInc > 0) {
            db.addMod({ name: 'MovementSpeed', type: 'INC', value: msInc, flags: 0, keywordFlags: 0, source: 'Skill: Intimidating Cry' });
          }
        } else if (gn === "battlemage's cry") {
          const baseCrit = Math.round(0.5 * mult * 100) / 100;
          if (baseCrit > 0) {
            db.addMod({ name: 'BaseCritChance', type: 'BASE', value: baseCrit, flags: ModFlag.Attack, keywordFlags: 0, source: "Skill: Battlemage's Cry" });
          }
        }
      }
    }
  }

  // PoE 2 Shapeshift Form inherent player buffs (Bear / Wolf / Wyvern on active main skill)
  if (build.game === 'poe2' && initialMainGroup) {
    for (const gm of initialMainGroup.gems) {
      if (!gm.enabled) continue;
      const gd = getGemById('poe2', gm.gemId);
      if (!gd || gd.category !== 'active') continue;
      const stLower = new Set((gd.skillTypes ?? []).map((t) => t.toLowerCase()));
      const nmLower = gd.name.en.trim().toLowerCase();
      if (
        stLower.has('bear') ||
        nmLower === 'maul' ||
        nmLower === 'walking calamity' ||
        nmLower === 'furious slam' ||
        nmLower === 'ferocious roar' ||
        nmLower === 'rampage'
      ) {
        db.setCondition('Shapeshifted', true);
        db.setCondition('BearForm', true);
        db.addMod({
          name: 'Armour',
          type: 'BASE',
          value: 10 + 10 * build.level,
          flags: 0,
          keywordFlags: 0,
          source: 'Bear Form',
        });
        db.addMod({
          name: 'ArmourAppliesToEle',
          type: 'BASE',
          value: 30,
          flags: 0,
          keywordFlags: 0,
          source: 'Bear Form',
        });
        break;
      } else if (
        stLower.has('wolf') ||
        nmLower === 'shred' ||
        nmLower === 'pounce' ||
        nmLower === 'lunar assault'
      ) {
        db.setCondition('Shapeshifted', true);
        db.setCondition('WolfForm', true);
        db.addMod({
          name: 'MovementSpeed',
          type: 'INC',
          value: 30,
          flags: 0,
          keywordFlags: 0,
          source: 'Wolf Form',
        });
        break;
      } else if (stLower.has('wyvern') || nmLower === 'rend' || nmLower === 'wing blast') {
        db.setCondition('Shapeshifted', true);
        db.setCondition('WyvernForm', true);
        break;
      }
    }
  }

  // PoB 1 XML maps Vaal aura/buff gems as enableGlobal1 = Vaal active, enableGlobal2 = Base aura (Data/Gems.lua),
  // whereas clusterAndReservation & multiPartAndMetaRuntime expect enableGlobal1 = Base, enableGlobal2 = Vaal.
  // Also deduplicate identical enabled Curse gems (keep highest level/quality) so duplicate copies (e.g. Lv20 + Lv1 Temporal Chains)
  // never double-stack on the enemy.
  const VAAL_DUAL_GLOBAL_NAMES = new Set([
    'vaal haste',
    'vaal grace',
    'vaal discipline',
    'vaal righteous fire',
    'vaal molten shell',
  ]);
  const bestCurseByName = new Map<string, { score: number; grpIdx: number; gemIdx: number }>();
  build.skills.forEach((grp, grpIdx) => {
    if (!grp.enabled) return;
    if (grp.weaponSets && grp.weaponSets.length > 0 && !grp.weaponSets.includes(build.activeWeaponSet)) return;
    grp.gems.forEach((gm, gemIdx) => {
      if (!gm.enabled) return;
      const gd = getGemById(build.game, gm.gemId);
      if (!gd || gd.category !== 'active') return;
      const tagsLower = new Set(gd.tags.map((t) => t.toLowerCase()));
      if (!tagsLower.has('curse') || tagsLower.has('mark')) return;
      const key = gd.name.en.trim().toLowerCase();
      const score = gm.level * 1000 + (gm.quality ?? 0);
      const prev = bestCurseByName.get(key);
      if (!prev || score > prev.score) {
        bestCurseByName.set(key, { score, grpIdx, gemIdx });
      }
    });
  });
  const normalizedSkillsForAuras = build.skills.map((grp, grpIdx) => ({
    ...grp,
    gems: grp.gems.map((gm, gemIdx) => {
      let nextGm = gm;
      if (gm.enabled) {
        const gd = getGemById(build.game, gm.gemId);
        if (gd && gd.category === 'active') {
          const tagsLower = new Set(gd.tags.map((t) => t.toLowerCase()));
          if (tagsLower.has('curse') && !tagsLower.has('mark')) {
            const best = bestCurseByName.get(gd.name.en.trim().toLowerCase());
            if (best && (best.grpIdx !== grpIdx || best.gemIdx !== gemIdx)) {
              nextGm = { ...nextGm, enabled: false };
            }
          }
          if (
            build.game === 'poe1' &&
            nextGm.enableGlobal1 !== undefined &&
            nextGm.enableGlobal2 !== undefined &&
            VAAL_DUAL_GLOBAL_NAMES.has(gd.name.en.trim().toLowerCase())
          ) {
            nextGm = {
              ...nextGm,
              enableGlobal1: nextGm.enableGlobal2,
              enableGlobal2: nextGm.enableGlobal1,
            };
          }
        }
      }
      return nextGm;
    }),
  }));
  const auraEval = evaluateAurasAndWatchersEye({
    build: { ...build, skills: normalizedSkillsForAuras },
    playerDb: db,
    minionDb: auraMinionDb,
    enemyDb: auraEnemyDb,
    socketedJewels: activeSocketedJewels,
    extraAuraEffectPct: customAuraEffect,
    extraCurseEffectPct: customCurseEffect,
    mainWeaponType: mainWeaponResolved?.weaponType,
  });
  const totalSpiritReserved = auraEval.totalSpiritReserved;

  // PoE 2 Item-granted Elemental Exposure on Hit (e.g. The Whispering Ice: 60% Exposure -> -30% on Boss)
  if (build.game === 'poe2') {
    const itemEleExp = db.max('ItemEleExposureOnHit') ?? 0;
    if (itemEleExp > 0) {
      for (const el of ['Fire', 'Cold', 'Lightning'] as const) {
        auraEnemyDb.addMod({
          name: `${el}Exposure`,
          type: 'MAX',
          value: itemEleExp,
          flags: 0,
          keywordFlags: 0,
          source: 'Item: Elemental Exposure on Hit',
        });
      }
    }
    // PoE 2 Pounce (Predator's Mark): PoB2 defaults MinionsInPresence to 8 (not 15) when unset in config.
    const pounceGroups = build.skills.filter(
      (grp) =>
        grp.enabled &&
        (!grp.weaponSets || grp.weaponSets.length === 0 || grp.weaponSets.includes(build.activeWeaponSet)) &&
        grp.gems.some((gm) => gm.enabled && getGemById('poe2', gm.gemId)?.name.en.trim().toLowerCase() === 'pounce'),
    );
    if (pounceGroups.length > 0 && typeof cfg.rawInputs?.multiplierMinionsInPresence !== 'number') {
      const predSources = auraEnemyDb
        .calcStat('DamageTaken')
        .sources.filter((s) => s.type === 'INC' && typeof s.value === 'number' && s.source.startsWith("Predator's Mark (Pounce"));
      for (const s of predSources) {
        const applied = s.value as number;
        if (applied > 0) {
          const mQ = s.source.match(/Q(\d+)/);
          const q = mQ ? Number(mQ[1]) : 0;
          const baseDesired = Math.floor(8 * (3 + q * 0.05) + 1e-9);
          const markEffInc = db.sum('INC', ['CurseEffect', 'MarkEffect']);
          const desired = Math.floor(baseDesired * Math.max(0, 1 + markEffInc / 100) + 1e-9);
          if (desired < applied) {
            auraEnemyDb.addMod({
              name: 'DamageTaken',
              type: 'INC',
              value: desired - applied,
              flags: 0,
              keywordFlags: 0,
              source: 'Pounce Default Minion Count Adjustment',
            });
          }
        }
      }
    }
    // PoE 2 Freezing Mark (Buff: Gain 30% of Damage as Extra Cold Damage) & Active-Skill Exposure (e.g. Primal Strikes -50%)
    let hasPoe2FreezingMark = false;
    let hasAnyPoe2Curse = false;
    for (const grp of build.skills) {
      if (!grp.enabled) continue;
      if (grp.weaponSets && grp.weaponSets.length > 0 && !grp.weaponSets.includes(build.activeWeaponSet)) continue;
      for (const gm of grp.gems) {
        if (!gm.enabled) continue;
        const gd = getGemById('poe2', gm.gemId);
        if (!gd) continue;
        const gn = gd.name.en.trim().toLowerCase();
        if (gn === 'freezing mark') hasPoe2FreezingMark = true;
        if (gd.tags.some((t) => t.toLowerCase() === 'curse') && !gd.tags.some((t) => t.toLowerCase() === 'mark')) {
          hasAnyPoe2Curse = true;
        }
        // Propagate enemy Exposure from enabled active skills (e.g. Primal Strikes `Fire/Cold/LightningExposure: 50`)
        for (const cm of gd.compiledMods ?? []) {
          if (
            cm.target === 'enemy' &&
            typeof cm.value === 'number' &&
            cm.value > 0 &&
            (cm.name === 'FireExposure' || cm.name === 'ColdExposure' || cm.name === 'LightningExposure')
          ) {
            auraEnemyDb.addMod({
              name: cm.name,
              type: 'MAX',
              value: cm.value,
              flags: 0,
              keywordFlags: 0,
              source: `Skill: ${gd.name.en}`,
            });
          }
        }
      }
    }
    if (
      hasPoe2FreezingMark &&
      !db.calcStat('DamageGainAsCold').sources.some((s) => /freezing mark/i.test(s.source))
    ) {
      db.addMod({
        name: 'DamageGainAsCold',
        type: 'BASE',
        value: 30,
        flags: 0,
        keywordFlags: 0,
        source: 'Buff: Freezing Mark',
      });
    }
    if (hasAnyPoe2Curse) {
      const cursedTaken = db.sum('BASE', 'EnemyCursedDamageTaken');
      if (cursedTaken !== 0) {
        auraEnemyDb.addMod({
          name: 'DamageTaken',
          type: 'INC',
          value: cursedTaken,
          flags: 0,
          keywordFlags: 0,
          source: 'Enemies you Curse',
        });
      }
      for (const el of ['Fire', 'Cold', 'Lightning', 'Chaos', 'Elemental'] as const) {
        const cRes = db.sum('BASE', `EnemyCursed${el}Resist`);
        if (cRes !== 0) {
          if (el === 'Elemental') {
            for (const sub of ['Fire', 'Cold', 'Lightning'] as const) {
              auraEnemyDb.addMod({ name: `${sub}Resist`, type: 'BASE', value: cRes, flags: 0, keywordFlags: 0, source: 'Enemies you Curse' });
            }
          } else {
            auraEnemyDb.addMod({ name: `${el}Resist`, type: 'BASE', value: cRes, flags: 0, keywordFlags: 0, source: 'Enemies you Curse' });
          }
        }
      }
    }
    // PoE 2 Sigil of Power effective level scaling (includes +Spell / +All Skill levels from gear, e.g. Whispering Ice +9)
    let bestSigilGem: { level: number } | undefined;
    for (const grp of build.skills) {
      if (!grp.enabled) continue;
      if (grp.weaponSets && grp.weaponSets.length > 0 && !grp.weaponSets.includes(build.activeWeaponSet)) continue;
      for (const gm of grp.gems) {
        if (!gm.enabled) continue;
        const gd = getGemById('poe2', gm.gemId);
        if (gd && gd.name.en.trim().toLowerCase() === 'sigil of power') {
          if (!bestSigilGem || gm.level > bestSigilGem.level) bestSigilGem = { level: gm.level };
        }
      }
    }
    if (bestSigilGem) {
      const sigilStages = Math.min(
        4,
        Math.max(1, Math.round(Number(cfg.rawInputs?.sigilOfPowerStages ?? 1) || 1)),
      );
      const effSigilLv = Math.min(
        40,
        Math.max(
          1,
          bestSigilGem.level +
            Math.round(db.sum('BASE', ['GemLevel:all', 'GemLevel:spell', 'AllSkillGemLevel', 'SpellSkillGemLevel'])),
        ),
      );
      const perStageMore = 10 + Math.floor((effSigilLv - 1) / 4);
      const desiredSigilMore = perStageMore * sigilStages;
      const existingSigilMore = db
        .calcStat('Damage', ModFlag.Spell)
        .sources.filter((s) => s.type === 'MORE' && typeof s.value === 'number' && /sigil of power/i.test(s.source))
        .reduce((acc, s) => acc + (s.value as number), 0);
      if (desiredSigilMore > existingSigilMore) {
        const deltaMore = ((100 + desiredSigilMore) / Math.max(1, 100 + existingSigilMore) - 1) * 100;
        db.addMod({
          name: 'Damage',
          type: 'MORE',
          value: deltaMore,
          flags: ModFlag.Spell,
          keywordFlags: 0,
          source: `Sigil of Power (Lv.${effSigilLv} Stage ${sigilStages} Scaling)`,
        });
      }
    }
  }
  // PoE 1 Bonechill Support on chilling active skills (gated on Chilled/ChillingArea)
  // + Bear Trap (+25% Trap/Mine Damage Taken) + Mark the Prey + Temporal Chains Boss CurseEffect scaling (`CalcPerform.lua:3283`)
  if (build.game === 'poe1') {
    const alreadyHasBonechill = auraEnemyDb
      .calcStat('ColdDamageTaken')
      .sources.some((s) => s.type === 'INC' && /bonechill/i.test(s.source));
    const enemyChilledForBonechill = Boolean(
      cfg.enemyChilled ||
        cfg.rawInputs?.conditionEnemyChilled ||
        Number(cfg.rawInputs?.conditionEnemyChilledEffect ?? 0) > 0,
    );
    if (!alreadyHasBonechill) {
      let bestBonechillChillEff = 0;
      for (const grp of build.skills) {
        if (!grp.enabled) continue;
        let hasBonechillSup = false;
        let hasNonSkitterActive = false;
        let hasChillingAreaSkill = false;
        let groupChillEffInc = 0;
        for (const gm of grp.gems) {
          if (!gm.enabled) continue;
          const gd = getGemById('poe1', gm.gemId);
          if (!gd) continue;
          const gn = gd.name.en.trim().toLowerCase().replace(/\s+support$/i, '');
          if (gn === 'bonechill') {
            hasBonechillSup = true;
            groupChillEffInc += 25 + Math.max(0, gm.level - 1);
          } else if (gn === 'unbound ailments' || gn === 'awakened unbound ailments') {
            groupChillEffInc += 35 + Math.max(0, gm.level - 1);
          } else if (gd.category === 'active' && gn !== 'summon skitterbots') {
            hasNonSkitterActive = true;
            if (/^(?:vortex|creeping frost|cold snap|vaal cold snap|arctic armour|skitterbots)/i.test(gn)) {
              hasChillingAreaSkill = true;
            }
          }
        }
        if (hasBonechillSup && hasNonSkitterActive && (enemyChilledForBonechill || hasChillingAreaSkill)) {
          const cfgChill =
            typeof cfg.rawInputs?.conditionEnemyChilledEffect === 'number' && cfg.rawInputs.conditionEnemyChilledEffect > 0
              ? cfg.rawInputs.conditionEnemyChilledEffect
              : 0;
          const defaultChill = Math.floor(
            10 * Math.max(0, 1 + (groupChillEffInc + db.sum('INC', ['EnemyChillEffect', 'ChillEffect'])) / 100) + 1e-9,
          );
          const chillEff = Math.min(30, Math.max(cfgChill, defaultChill));
          if (chillEff > bestBonechillChillEff) bestBonechillChillEff = chillEff;
        }
      }
      if (bestBonechillChillEff > 0) {
        auraEnemyDb.addMod({
          name: 'ColdDamageTaken',
          type: 'INC',
          value: bestBonechillChillEff,
          flags: 0,
          keywordFlags: 0,
          source: 'Support: Bonechill',
        });
      }
    }
    // PoE 1 Bear Trap debuff: Enemies take 25% increased Damage from Trap or Mine Hits
    const hasBearTrap = build.skills.some(
      (grp) =>
        grp.enabled &&
        grp.gems.some((gm) => gm.enabled && getGemById('poe1', gm.gemId)?.name.en.trim().toLowerCase() === 'bear trap'),
    );
    if (
      hasBearTrap &&
      !auraEnemyDb.calcStat('DamageTaken').sources.some((s) => /bear trap/i.test(s.source))
    ) {
      auraEnemyDb.addMod({
        name: 'DamageTaken',
        type: 'INC',
        value: 25,
        flags: 0,
        keywordFlags: KeywordFlag.Trap | KeywordFlag.Mine,
        source: 'Debuff: Bear Trap',
      });
    }
    // PoE 1 Mark the Prey: Marked Enemy takes X% increased Damage
    const markPreyTaken = db.sum('BASE', 'MarkedEnemyDamageTaken');
    if (markPreyTaken > 0) {
      const hasMarkActive = build.skills.some(
        (grp) =>
          grp.enabled &&
          grp.gems.some((gm) => {
            if (!gm.enabled) return false;
            const gd = getGemById('poe1', gm.gemId);
            return Boolean(gd && (gd.tags.some((t) => t.toLowerCase() === 'mark') || /\bmark$/i.test(gd.name.en)));
          }),
      );
      if (hasMarkActive) {
        auraEnemyDb.addMod({
          name: 'DamageTaken',
          type: 'INC',
          value: markPreyTaken,
          flags: 0,
          keywordFlags: 0,
          source: 'Tree: Mark the Prey',
        });
      }
    }
    if (cfg.enemyIsBoss !== 'None') {
      const tcSources = auraEnemyDb
        .calcStat('BuffExpireFaster')
        .sources.filter((s) => s.type === 'MORE' && typeof s.value === 'number' && s.value < 0 && /temporal chains/i.test(s.source));
      if (tcSources.length > 0) {
        const bossCurseScale = cfg.enemyIsBoss === 'Pinnacle' ? 0.67 : 0.67;
        for (const s of tcSources) {
          const curVal = s.value as number; // negative, e.g. -25
          // Neutralize excess negative MORE so effective multiplier becomes 1 + curVal * bossCurseScale / 100
          const targetMult = Math.max(0.25, 1 + (curVal * bossCurseScale) / 100);
          const curMult = Math.max(0.25, 1 + curVal / 100);
          const corrMore = (targetMult / curMult - 1) * 100;
          if (Math.abs(corrMore) > 0.1) {
            auraEnemyDb.addMod({
              name: 'BuffExpireFaster',
              type: 'MORE',
              value: corrMore,
              flags: 0,
              keywordFlags: 0,
              source: 'Temporal Chains (Boss Curse Effect)',
            });
          }
        }
      }
    }
  }

  // PoE 2 Exposure & Blasphemy Normalization (PoB2 CalcPerform.lua:3478-3509 & act_int.lua:1062-1155):
  // 1. Move Exposure-granting skill raw Fire/Cold/LightningResist mods (e.g. Frost Bomb -20, Primal Strikes -50)
  //    into Fire/Cold/LightningExposure MAX so only the strongest source applies and Boss -50% ExposureEffectOnSelf scales them!
  // 2. Neutralize Support: Potent Exposure if it came from a skill group with no enabled active skill.
  // 3. Apply Blasphemy's `-(50 - floor((lv - 1) / 2))%` less Curse Effect to PoE 2 curses socketed with Blasphemy.
  if (build.game === 'poe2') {
    const exposureSkillSources = new Map<string, Set<'Fire' | 'Cold' | 'Lightning'>>();
    const blasphemyCurseLessBySource = new Map<string, number>();
    const curseSupportExtraIncBySource = new Map<string, number>();
    let hasLinkedPotentExposure = false;
    let hasUnlinkedPotentExposure = false;
    for (const grp of build.skills) {
      if (!grp.enabled) continue;
      if (grp.weaponSets && grp.weaponSets.length > 0 && !grp.weaponSets.includes(build.activeWeaponSet)) continue;
      const enabledDefs = grp.gems
        .filter((g) => g.enabled)
        .map((g) => ({ inst: g, def: getGemById('poe2', g.gemId) }))
        .filter((x): x is { inst: typeof grp.gems[number]; def: NonNullable<ReturnType<typeof getGemById>> } => Boolean(x.def));
      const hasActiveInGroup = enabledDefs.some((x) => x.def.category === 'active');
      if (enabledDefs.some((x) => x.def.name.en.trim().toLowerCase() === 'potent exposure')) {
        if (hasActiveInGroup) hasLinkedPotentExposure = true;
        else hasUnlinkedPotentExposure = true;
      }
      const blasphemyGem = enabledDefs.find((x) => x.def.id === 'poe2_blasphemy');
      // Collect PoE 2 curse-effect support gems (e.g. Heightened Curse +25% CurseEffect) not handled by clusterAndReservation
      let groupExtraCurseInc = 0;
      for (const { def } of enabledDefs) {
        if (def.category !== 'support') continue;
        for (const cm of def.compiledMods ?? []) {
          if (cm.name === 'CurseEffect' && cm.type === 'INC' && typeof cm.value === 'number') {
            groupExtraCurseInc += cm.value;
          }
        }
      }
      for (const { def } of enabledDefs) {
        const lowerName = def.name.en.trim().toLowerCase();
        const cmods = def.compiledMods ?? [];
        const isKnownAllEleExposure = lowerName === 'frost bomb' || lowerName === 'primal strikes';
        for (const el of ['Fire', 'Cold', 'Lightning'] as const) {
          if (
            isKnownAllEleExposure ||
            cmods.some((m) => m.name === `${el}Exposure` && m.target === 'enemy')
          ) {
            let set = exposureSkillSources.get(lowerName);
            if (!set) {
              set = new Set();
              exposureSkillSources.set(lowerName, set);
            }
            set.add(el);
          }
        }
        const isHex = def.tags.some((t) => t.toLowerCase() === 'curse') && !def.tags.some((t) => t.toLowerCase() === 'mark');
        if (isHex) {
          if (blasphemyGem) {
            const bLv = Math.max(1, Math.min(40, Math.round(blasphemyGem.inst.level || 20)));
            const lessPct = 50 - Math.floor((bLv - 1) / 2); // Lv1=50%, Lv19-20=41%, Lv21-22=40%
            blasphemyCurseLessBySource.set(lowerName, lessPct);
          }
          if (groupExtraCurseInc !== 0) {
            curseSupportExtraIncBySource.set(lowerName, Math.max(curseSupportExtraIncBySource.get(lowerName) ?? 0, groupExtraCurseInc));
          }
        }
      }
    }
    if (hasUnlinkedPotentExposure && !hasLinkedPotentExposure) {
      const peSources = auraEnemyDb
        .calcStat('ExposureEffect')
        .sources.filter((s) => s.type === 'INC' && s.source === 'Support: Potent Exposure');
      const peSum = peSources.reduce((acc, s) => acc + (typeof s.value === 'number' ? s.value : 0), 0);
      if (peSum > 0) {
        auraEnemyDb.addMod({ name: 'ExposureEffect', type: 'INC', value: -peSum, flags: 0, keywordFlags: 0, source: 'Unlinked Potent Exposure Guard' });
      }
    }
    for (const el of ['Fire', 'Cold', 'Lightning'] as const) {
      const statName = `${el}Resist`;
      const resSources = auraEnemyDb.calcStat(statName).sources;
      for (const s of resSources) {
        if (s.type !== 'BASE' || typeof s.value !== 'number' || s.value >= 0) continue;
        const mSrc = s.source.match(/^Aura\/Buff:\s*(.+?)(?:\s*\(Lv\.\d+\))?$/i);
        if (!mSrc) continue;
        const skillLower = mSrc[1]!.trim().toLowerCase();
        if (exposureSkillSources.get(skillLower)?.has(el)) {
          auraEnemyDb.addMod({ name: statName, type: 'BASE', value: -s.value, flags: 0, keywordFlags: 0, source: `Normalize Exposure (${mSrc[1]})` });
          auraEnemyDb.addMod({ name: `${el}Exposure`, type: 'MAX', value: Math.abs(s.value), flags: 0, keywordFlags: 0, source: s.source });
        }
      }
    }
    if (blasphemyCurseLessBySource.size > 0 || curseSupportExtraIncBySource.size > 0) {
      const basePlayerCurseInc = db.sum('INC', 'CurseEffect', ModFlag.Spell, KeywordFlag.Curse);
      for (const resStat of ['ChaosResist', 'FireResist', 'ColdResist', 'LightningResist', 'ElementalResist'] as const) {
        const resSources = auraEnemyDb.calcStat(resStat).sources;
        for (const s of resSources) {
          if (s.type !== 'BASE' || typeof s.value !== 'number' || s.value >= 0) continue;
          const mSrc = s.source.match(/^Aura\/Buff:\s*(.+?)(?:\s*\(Lv\.\d+\))?$/i);
          if (!mSrc) continue;
          const curseKey = mSrc[1]!.trim().toLowerCase();
          const lessPct = blasphemyCurseLessBySource.get(curseKey) ?? 0;
          const extraInc = curseSupportExtraIncBySource.get(curseKey) ?? 0;
          if (lessPct === 0 && extraInc === 0) continue;
          // s.value already reflects (1 + basePlayerCurseInc/100) * bossMore; scale to include extraInc & blasphemy lessPct
          const incRatio = (100 + basePlayerCurseInc + extraInc) / Math.max(1, 100 + basePlayerCurseInc);
          const blasMult = Math.max(0, 1 - lessPct / 100);
          const scaledVal = -Math.floor(Math.abs(s.value) * incRatio * blasMult + 1e-9);
          const delta = scaledVal - s.value;
          if (delta !== 0) {
            auraEnemyDb.addMod({
              name: resStat,
              type: 'BASE',
              value: delta,
              flags: 0,
              keywordFlags: 0,
              source: `PoE2 Curse Scaling (${mSrc[1]})`,
            });
          }
        }
      }
    }
  }

  // Evaluate Vaal active buffs, Herald of Agony Virulence, & Plague Bearer (skipping skills already handled by auraEval)
  const auraHandledNames = new Set(auraEval.auras.map((a) => a.gemName.trim().toLowerCase()));
  const nonOverlappingPersistentGroups = normalizedSkillsForAuras.map((grp) => ({
    ...grp,
    gems: grp.gems.filter((gm) => {
      const gd = getGemById(build.game, gm.gemId);
      if (!gd) return false;
      const gn = gd.name.en.trim().toLowerCase();
      if (gn.startsWith('vaal ')) return true;
      return !auraHandledNames.has(gn);
    }),
  }));
  evaluatePersistentBuffAndStanceSkills(
    nonOverlappingPersistentGroups,
    build.activeWeaponSet,
    build.game,
    db,
    auraEnemyDb,
    (id) => getGemById(build.game, id),
  );

  // 5. Build Configuration (Charges, Onslaught, Custom Mods)
  if (build.game === 'poe1') {
    const pantheonMajor = cfg.pantheonMajor ?? 'None';
    if (pantheonMajor === 'Solaris') {
      db.addMod({ name: 'PhysDamageReduction', type: 'BASE', value: 6, flags: 0, keywordFlags: 0, source: 'Pantheon: Soul of Solaris' });
    } else if (pantheonMajor === 'Lunaris') {
      db.addMod({ name: 'PhysDamageReduction', type: 'BASE', value: 1, flags: 0, keywordFlags: 0, source: 'Pantheon: Soul of Lunaris' });
      db.addMod({ name: 'MovementSpeed', type: 'INC', value: 1, flags: 0, keywordFlags: 0, source: 'Pantheon: Soul of Lunaris' });
    } else if (pantheonMajor === 'BrineKing') {
      db.addMod({ name: 'ColdResist', type: 'BASE', value: 0, flags: 0, keywordFlags: 0, source: 'Pantheon: Soul of the Brine King' });
    }

    const pantheonMinor = cfg.pantheonMinor ?? 'None';
    if (pantheonMinor === 'Shakari') {
      db.addMod({ name: 'ChaosResist', type: 'BASE', value: 5, flags: 0, keywordFlags: 0, source: 'Pantheon: Soul of Shakari' });
    } else if (pantheonMinor === 'Gruthkul') {
      db.addMod({ name: 'PhysDamageReduction', type: 'BASE', value: 1, flags: 0, keywordFlags: 0, source: 'Pantheon: Soul of Gruthkul' });
    } else if (pantheonMinor === 'Tukohama') {
      db.addMod({ name: 'PhysDamageReduction', type: 'BASE', value: 3, flags: 0, keywordFlags: 0, source: 'Pantheon: Soul of Tukohama' });
    } else if (pantheonMinor === 'Garukhan') {
      db.addMod({ name: 'MovementSpeed', type: 'INC', value: 5, flags: 0, keywordFlags: 0, source: 'Pantheon: Soul of Garukhan' });
    }
  }

  const hasExistingOnslaught = db
    .calcStat('MovementSpeed')
    .sources.some((s) => s.type === 'INC' && /onslaught/i.test(s.source));
  const onslaughtEffInc = db.sum('INC', ['OnslaughtEffect', 'BuffEffectOnSelf']);
  if (cfg.onslaught && !hasExistingOnslaught) {
    const silverFlaskForCfg = flaskEval.perFlask.find((f) => f.baseName === 'Silver Flask');
    const flaskEffBonusPct = silverFlaskForCfg ? Math.round((silverFlaskForCfg.effectMult - 1) * 100) : 0;
    const onslaughtVal = Math.floor(20 * Math.max(0, 1 + (flaskEffBonusPct + onslaughtEffInc) / 100) + 1e-9);
    if (onslaughtVal > 0) {
      db.addMod({ name: 'Speed', type: 'INC', value: onslaughtVal, flags: ModFlag.Attack, keywordFlags: 0, source: 'Onslaught' });
      db.addMod({ name: 'Speed', type: 'INC', value: onslaughtVal, flags: ModFlag.Spell, keywordFlags: 0, source: 'Onslaught' });
      db.addMod({ name: 'MovementSpeed', type: 'INC', value: onslaughtVal, flags: 0, keywordFlags: 0, source: 'Onslaught' });
    }
  }
  if (build.game === 'poe1' && cfg.conditionLowLife && db.flag('PainAttunement')) {
    db.addMod({
      name: 'Damage',
      type: 'MORE',
      value: 30,
      flags: ModFlag.Spell,
      keywordFlags: 0,
      source: 'Pain Attunement (Low Life)',
    });
  }
  if (
    cfg.buffArcaneSurge ||
    db.getEvalContext().conditions.AffectedByArcaneSurge ||
    db.flag('Condition:ArcaneSurge') ||
    db.flag('Condition:AffectedByArcaneSurge')
  ) {
    db.setCondition('AffectedByArcaneSurge', true);
  }
  if (build.game === 'poe1' && (cfg.buffTailwind || db.flag('Condition:Tailwind'))) {
    // PoE 1 3.25+ Tailwind: 8% increased Action Speed scaled by TailwindEffect (Deadeye Gathering Winds: +10% per Gale Force, cap 10 -> 16%)
    // Added directly into `ActionSpeed INC` so it combines additively with Boots Action Speed (PoB1 CalcOffence.lua)
    const rawGaleForce = Number(cfg.rawInputs?.multiplierGaleForce ?? db.getEvalContext().multipliers.GaleForce ?? 0);
    const hasGatheringWinds = allAllocatedNodeDefs.some(
      (n) => n.name.en.trim().toLowerCase() === 'gathering winds',
    );
    const galeForceEff =
      hasGatheringWinds && Number.isFinite(rawGaleForce) && rawGaleForce > 0
        ? Math.min(10, Math.floor(rawGaleForce)) * 10
        : 0;
    const tailwindEffInc = db.sum('INC', 'TailwindEffect') + galeForceEff;
    const tailwindActionSpd = Math.floor(8 * Math.max(0, 1 + tailwindEffInc / 100) + 1e-9);
    if (tailwindActionSpd > 0) {
      db.addMod({ name: 'ActionSpeed', type: 'INC', value: tailwindActionSpd, flags: 0, keywordFlags: 0, source: 'Tailwind' });
      db.addMod({ name: 'MovementSpeed', type: 'MORE', value: tailwindActionSpd, flags: 0, keywordFlags: 0, source: 'Tailwind' });
    }
  } else if (build.game === 'poe2') {
    const rawTw = Number(cfg.rawInputs?.multiplierTailwind ?? db.getEvalContext().multipliers.Tailwind ?? 0);
    const twStacks = Number.isFinite(rawTw) ? Math.min(10, Math.max(0, Math.floor(rawTw))) : 0;
    if (twStacks > 0) {
      // PoE 2 Tailwind (CalcSetup.lua:1013-1017): +2% Attack/Cast Speed, +1% MoveSpeed, +1% DeflectEffect, +10% Evasion per stack (cap 10)
      db.addMod({ name: 'Speed', type: 'INC', value: 2 * twStacks, flags: ModFlag.Attack, keywordFlags: 0, source: `Tailwind (${twStacks})` });
      db.addMod({ name: 'Speed', type: 'INC', value: 2 * twStacks, flags: ModFlag.Cast, keywordFlags: 0, source: `Tailwind (${twStacks})` });
      db.addMod({ name: 'MovementSpeed', type: 'INC', value: twStacks, flags: 0, keywordFlags: 0, source: `Tailwind (${twStacks})` });
      db.addMod({ name: 'DeflectEffect', type: 'INC', value: twStacks, flags: 0, keywordFlags: 0, source: `Tailwind (${twStacks})` });
      db.addMod({ name: 'Evasion', type: 'INC', value: 10 * twStacks, flags: 0, keywordFlags: 0, source: `Tailwind (${twStacks})` });
    }
  }
  if (cfg.enemyIntimidated) {
    db.addMod({ name: 'EnemyDamageTaken', type: 'INC', value: 10, flags: ModFlag.Attack, keywordFlags: 0, source: 'Intimidated' });
  }
  if (cfg.enemyUnnerved) {
    db.addMod({ name: 'EnemyDamageTaken', type: 'INC', value: 10, flags: ModFlag.Spell, keywordFlags: 0, source: 'Unnerved' });
  }
  if (cfg.witheredStacks && cfg.witheredStacks > 0) {
    const maxWither = build.game === 'poe2' ? 10 : 15;
    const stacks = Math.min(maxWither, Math.max(0, Math.round(cfg.witheredStacks)));
    const basePerStack = build.game === 'poe2' ? 5 : 6;
    const perStack = Math.floor(basePerStack * Math.max(0, 1 + db.sum('INC', 'WitherEffect') / 100) + 1e-9);
    const witherInc = stacks * perStack;
    if (witherInc > 0) {
      auraEnemyDb.addMod({
        name: 'ChaosDamageTaken',
        type: 'INC',
        value: witherInc,
        flags: 0,
        keywordFlags: 0,
        source: `Withered (${stacks})`,
      });
    }
  }
  if (build.game === 'poe2') {
    // Upstream PoB 2 `ConfigOptions.lua:1885-1892` & `CalcPerform.lua:472-485`:
    // Gate `conditionEnemy<El>Exposure` on `CanApply<El>Exposure` (requires Exposure source on player/skills/items).
    const applyPoe2ExposureCfg = (el: 'Fire' | 'Cold' | 'Lightning', cfgEnabled: boolean) => {
      const hasSource =
        db.sum('BASE', `${el}ExposureChance`) > 0 ||
        db.flag('InflictExposure') ||
        db.flag('ExposureInPresence') ||
        auraEnemyDb.sum('BASE', `${el}Exposure`) > 0 ||
        (auraEnemyDb.max(`${el}Exposure`) ?? 0) > 0 ||
        build.skills.some((grp) => {
          if (!grp.enabled) return false;
          return grp.gems.some((gm) => {
            if (!gm.enabled) return false;
            const gd = getGemById('poe2', gm.gemId);
            if (!gd) return false;
            const ln = gd.name.en.trim().toLowerCase();
            if (ln === 'frost bomb' || ln === 'primal strikes') return true;
            if (ln.includes('exposure')) return true;
            return (gd.compiledMods ?? []).some(
              (m) =>
                m.name === `${el}Exposure` ||
                m.name === `${el}ExposureChance` ||
                m.name === 'InflictExposure',
            );
          });
        });
      db.setCondition(`CanApply${el}Exposure`, hasSource);
      if (cfgEnabled && hasSource) {
        auraEnemyDb.addMod({ name: `${el}Exposure`, type: 'BASE', value: 20, flags: 0, keywordFlags: 0, source: `${el} Exposure` });
        db.setCondition(`Enemy${el}Exposure`, true);
        db.setCondition('EnemyExposure', true);
        auraEnemyDb.setCondition(`${el}Exposure`, true);
        auraEnemyDb.setCondition('Exposure', true);
      }
    };
    applyPoe2ExposureCfg('Fire', Boolean(cfg.enemyFireExposure));
    applyPoe2ExposureCfg('Cold', Boolean(cfg.enemyColdExposure));
    applyPoe2ExposureCfg('Lightning', Boolean(cfg.enemyLightningExposure));
  } else {
    const extraExposure = db.sum('BASE', 'ExtraExposure');
    const exposureEffMult = Math.max(0, 1 + db.sum('INC', 'ExposureEffect') / 100);
    const exposureMinFloor = db.override('ExposureMin'); // e.g. -18 from Elemental Mastery
    const rawWocType = typeof cfg.rawInputs?.waveOfConvictionExposureType === 'string'
      ? cfg.rawInputs.waveOfConvictionExposureType.trim()
      : '';
    const hasEnabledWoc = build.skills.some(
      (grp) =>
        grp.enabled &&
        grp.gems.some((gm) => gm.enabled && getGemById('poe1', gm.gemId)?.name.en.trim().toLowerCase() === 'wave of conviction'),
    );
    const wocExposureEl =
      hasEnabledWoc && (rawWocType === 'Fire' || rawWocType === 'Cold' || rawWocType === 'Lightning')
        ? rawWocType
        : '';
    const applyPoe1Exposure = (el: 'Fire' | 'Cold' | 'Lightning', cfgEnabled: boolean) => {
      const statName = `Enemy${el}Resist`;
      const auraStatName = `${el}Resist`;
      // Check existing item/skill exposure mods in db (e.g. Eldritch Gloves "-11% Fire Exposure on Hit")
      // AND exposure mods already placed on auraEnemyDb (e.g. Wave of Conviction / Hydrosphere / Frost Bomb)
      const existingExpVal = db
        .calcStat(statName)
        .sources.filter(
          (s) =>
            s.type === 'BASE' &&
            typeof s.value === 'number' &&
            s.value < 0 &&
            (/exposure/i.test(s.source) || /item \(gloves\)/i.test(s.source)),
        )
        .reduce((acc, s) => acc + (s.value as number), 0);
      const auraExpVal = auraEnemyDb
        .calcStat(auraStatName)
        .sources.filter(
          (s) =>
            s.type === 'BASE' &&
            typeof s.value === 'number' &&
            s.value < 0 &&
            /exposure/i.test(s.source),
        )
        .reduce((acc, s) => acc + (s.value as number), 0);
      const isWocEl = wocExposureEl === el;
      const hasAnyExposure = cfgEnabled || isWocEl || existingExpVal < 0 || auraExpVal < 0;
      if (!hasAnyExposure) return;
      // PoB 1 never stacks two Exposures of the same element; auraExpVal from clusterAndReservation
      // already includes ExtraExposure & ExposureEffect, so compute dbTarget separately and take the strongest.
      const baseDbExpMag = Math.max(cfgEnabled ? 10 : 0, isWocEl ? 15 : 0, Math.abs(existingExpVal));
      let effBaseExp = baseDbExpMag;
      if (effBaseExp > 0 && exposureMinFloor !== null && exposureMinFloor < 0) {
        effBaseExp = Math.max(effBaseExp, Math.abs(exposureMinFloor));
      }
      const dbTargetExp =
        effBaseExp > 0
          ? -Math.floor((effBaseExp + extraExposure) * exposureEffMult + 1e-9)
          : 0;
      const targetExp = Math.min(dbTargetExp, auraExpVal);
      const currentCombinedExp = existingExpVal + auraExpVal;
      const delta = targetExp - currentCombinedExp;
      if (delta !== 0) {
        db.addMod({ name: statName, type: 'BASE', value: delta, flags: 0, keywordFlags: 0, source: isWocEl ? `Wave of Conviction (${el} Exposure)` : `${el} Exposure` });
      }
      db.setCondition(`Enemy${el}Exposure`, true);
      db.setCondition('EnemyExposure', true);
    };
    applyPoe1Exposure('Fire', Boolean(cfg.enemyFireExposure));
    applyPoe1Exposure('Cold', Boolean(cfg.enemyColdExposure));
    applyPoe1Exposure('Lightning', Boolean(cfg.enemyLightningExposure));
  }

  // Grant Onslaught from Silver Flask if not already active via config or unique (scaled by Silver Flask + OnslaughtEffect!)
  if (!cfg.onslaught && !hasExistingOnslaught && flaskEval.grantsOnslaught) {
    const silverFlask = flaskEval.perFlask.find((f) => f.baseName === 'Silver Flask');
    const flaskEffPct = silverFlask ? Math.round((silverFlask.effectMult - 1) * 100) : 0;
    const onslaughtVal = Math.floor(20 * Math.max(0, 1 + (flaskEffPct + onslaughtEffInc) / 100) + 1e-9);
    if (onslaughtVal > 0) {
      db.addMod({ name: 'Speed', type: 'INC', value: onslaughtVal, flags: ModFlag.Attack, keywordFlags: 0, source: 'Silver Flask (Onslaught)' });
      db.addMod({ name: 'Speed', type: 'INC', value: onslaughtVal, flags: ModFlag.Spell, keywordFlags: 0, source: 'Silver Flask (Onslaught)' });
      db.addMod({ name: 'MovementSpeed', type: 'INC', value: onslaughtVal, flags: 0, keywordFlags: 0, source: 'Silver Flask (Onslaught)' });
    }
  }

  // Populate ModDB Tag Evaluation Context (Conditions, Multipliers, Equipment Stats)
  const wtMain = mainWeaponResolved?.weaponType;
  const usingStaff = wtMain === 'Staff' || wtMain === 'Quarterstaff';
  const usingTwoHanded = Boolean(mainWeaponResolved?.twoHanded);
  const usingOneHanded = Boolean(mainWeaponResolved && !mainWeaponResolved.twoHanded);
  const activeHeraldCount = auraEval.auras.filter((a) => a.isHerald).length;
  const hasActiveHerald = activeHeraldCount > 0;
  for (const a of auraEval.auras) {
    if (!a.isHerald) continue;
    const hKey = a.gemName.replace(/[^A-Za-z]/g, '');
    if (hKey) {
      db.setCondition(`AffectedBy${hKey}`, true);
    }
  }
  const activeAuraCount = auraEval.auras.filter((a) => a.isAura && a.appliesToPlayer).length;
  const hasLifeResActive = auraEval.lifeReservations.some(
    (r) => !r.zeroedByBlessing && (r.basePct > 0 || r.baseFlat > 0),
  );
  const hasManaResActive = auraEval.manaReservations.some(
    (r) => !r.zeroedByBlessing && (r.basePct > 0 || r.baseFlat > 0),
  );
  if (!bodyArmourEquipped || !bodyArmourHasLifeMod) {
    db.setCondition('NoLifeModOnBodyArmour', true);
  }
  if (hasLifeResActive && hasManaResActive) {
    db.setCondition('ReservedLifeAndMana', true);
  }
  const surroundedEnemiesReq = 5 - db.sum('BASE', 'SurroundedEnemyReduction');
  const cfgEnemyCount = Number(cfg.rawInputs?.enemyCount ?? cfg.rawInputs?.multiplierNearbyEnemyCount ?? 1);
  if (
    surroundedEnemiesReq <= (Number.isFinite(cfgEnemyCount) && cfgEnemyCount > 0 ? cfgEnemyCount : 1) ||
    cfg.rawInputs?.conditionSurrounded === true
  ) {
    db.setCondition('Surrounded', true);
  }
  const hasCompanionActive = build.skills.some(
    (grp) =>
      grp.enabled &&
      grp.gems.some((gm) => {
        if (!gm.enabled) return false;
        const gd = getGemById(build.game, gm.gemId);
        if (!gd) return false;
        const n = gd.name.en.toLowerCase();
        return (
          n.includes('companion') ||
          n.includes('tame beast') ||
          n.includes('rhoa mount') ||
          gd.tags.some((t) => t.toLowerCase() === 'companion') ||
          (gd.skillTypes ?? []).some((t) => t.toLowerCase() === 'companion')
        );
      }),
  );
  if (hasCompanionActive || cfg.rawInputs?.conditionCompanionInPresence === true) {
    db.setCondition('CompanionInPresence', true);
  }
  const isBloodMageAsc =
    build.game === 'poe2' && build.ascendancyId.trim().toLowerCase() === 'blood mage';
  if (isBloodMageAsc || db.flag('BloodMagic') || db.sum('BASE', 'ManaCostConvertToLife') > 0) {
    db.setCondition('SpellCostsLife', true);
  }
  const mainOccupiesBothHands = Boolean(mainWeaponResolved?.twoHanded && !mainFitsOneHand);
  const offHandEmpty = !activeWeapons.off && !usingShield && focusLocalEs === 0 && !mainOccupiesBothHands;
  db.setCondition('OffHandIsEmpty', offHandEmpty);
  // Automatic PoB CalcPerform combat conditions derived from main skill group (active + linked totem/meta supports)
  if (initialMainGroup) {
    let seenPrimaryActive = false;
    for (const gm of initialMainGroup.gems) {
      if (!gm.enabled) continue;
      const gd = getGemById(build.game, gm.gemId);
      if (!gd) continue;
      const tagsL = new Set([
        ...gd.tags.map((t) => t.toLowerCase()),
        ...(gd.skillTypes ?? []).map((t) => t.toLowerCase()),
      ]);
      const isTotemGem =
        tagsL.has('totem') ||
        tagsL.has('summonsattacktotem') ||
        tagsL.has('summonstotem') ||
        tagsL.has('usedbytotem') ||
        gd.name.en.toLowerCase().includes('totem');
      if (isTotemGem) {
        db.setCondition('HaveTotem', true);
      }
      if (gd.category === 'active' && !seenPrimaryActive) {
        seenPrimaryActive = true;
        if (tagsL.has('channelling') || tagsL.has('channel')) {
          db.setCondition('Channelling', true);
        }
      }
    }
  }
  db.setCondition('LowLife', Boolean(cfg.conditionLowLife));
  db.setCondition(
    'FullLife',
    build.game === 'poe2'
      ? Boolean(cfg.rawInputs?.conditionFullLife) || db.flag('ChaosInoculation')
      : !cfg.conditionLowLife,
  );
  db.setCondition('FullMana', cfg.rawInputs?.conditionFullMana !== false && !hasManaResActive);
  db.setCondition('DualWielding', isDualWielding);
  db.setCondition('UsingShield', usingShield);
  db.setCondition('UsingStaff', usingStaff);
  db.setCondition('UsingTwoHandedWeapon', usingTwoHanded);
  db.setCondition('UsingOneHandedWeapon', usingOneHanded);
  db.setCondition('UsingBow', wtMain === 'Bow');
  db.setCondition('UsingWand', wtMain === 'Wand');
  db.setCondition('UsingClaw', wtMain === 'Claw');
  db.setCondition('UsingDagger', wtMain === 'Dagger');
  db.setCondition('UsingSword', wtMain === 'Sword');
  db.setCondition('UsingAxe', wtMain === 'Axe');
  db.setCondition('UsingMace', wtMain === 'Mace');
  db.setCondition('UsingQuarterstaff', wtMain === 'Quarterstaff');
  db.setCondition('UsingCrossbow', wtMain === 'Crossbow');
  const mainHandItemForCond = nonFlaskEquippedForUniques.find((e) => e.slot === 'Weapon 1')?.item;
  db.setCondition(
    'UsingSpear',
    (wtMain as string | undefined) === 'Spear' || Boolean(mainHandItemForCond && /spear/i.test(mainHandItemForCond.baseName)),
  );
  const rawCfgEnemyDist = Number(cfg.rawInputs?.enemyDistance ?? cfg.rawInputs?.projectileDistance ?? 20);
  const effEnemyDist = Number.isFinite(rawCfgEnemyDist) && rawCfgEnemyDist >= 0 ? rawCfgEnemyDist : 20;
  db.setStat('EnemyDistance', effEnemyDist);
  db.setMultiplier('enemyDistance', effEnemyDist);
  if (shieldLocalArmour > 0) db.setStat('ShieldArmour', shieldLocalArmour);
  if (shieldLocalEvasion > 0) db.setStat('ShieldEvasion', shieldLocalEvasion);
  if (
    cfg.rawInputs?.conditionEnemyHeavyStunned ||
    cfg.rawInputs?.conditionEnemyPinned ||
    cfg.rawInputs?.conditionEnemyFrozen ||
    cfg.rawInputs?.conditionEnemyElectrocuted
  ) {
    if (cfg.rawInputs?.conditionEnemyHeavyStunned) {
      db.setCondition('EnemyHeavyStunned', true);
      auraEnemyDb.setCondition('HeavyStunned', true);
    }
    db.setCondition('EnemyImmobilised', true);
    auraEnemyDb.setCondition('Immobilised', true);
  }
  if (typeof cfg.rawInputs?.multiplierMinionsInPresence === 'number') {
    const mpc = Math.max(0, cfg.rawInputs.multiplierMinionsInPresence);
    db.setMultiplier('MinionPresenceCount', mpc);
    auraEnemyDb.setMultiplier('MinionPresenceCount', mpc);
  }
  // PoE 2 `Inspiring Ally` (`CompanionDamageAppliesToPlayer`): apply CompanionDamage INC to player Damage INC
  if (build.game === 'poe2' && db.flag('CompanionDamageAppliesToPlayer')) {
    const compInc = db.sum('INC', 'CompanionDamage');
    if (compInc !== 0) {
      db.addMod({
        name: 'Damage',
        type: 'INC',
        value: compInc,
        flags: 0,
        keywordFlags: 0,
        source: 'Inspiring Ally (Companion Damage)',
      });
    }
  }
  db.setCondition('EnemyShocked', Boolean(cfg.enemyShocked));
  db.setCondition('EnemyChilled', Boolean(cfg.enemyChilled));
  db.setCondition('EnemyTaunted', Boolean(cfg.enemyTaunted));
  db.setCondition('AffectedByHerald', hasActiveHerald);
  db.setCondition('OnConsecratedGround', Boolean(flaskEval.grantsConsecratedGround));
  db.setMultiplier('Herald', activeHeraldCount);
  db.setMultiplier('AuraAffectingSelf', activeAuraCount);
  db.setMultiplier('AuraOrHeraldAffectingSelf', activeAuraCount + activeHeraldCount);
  db.setMultiplier('RedSocket', socketColorTotals.R);
  db.setMultiplier('GreenSocket', socketColorTotals.G);
  db.setMultiplier('BlueSocket', socketColorTotals.B);
  db.setMultiplier('WhiteSocket', socketColorTotals.W);
  db.setMultiplier('SocketFilled', totalSocketFilledCount);
  db.setMultiplier('RunesSocketedInBody Armour', bodyArmourFilledRunes);
  for (const [slotKey, cols] of Object.entries(socketColorBySlot)) {
    db.setMultiplier(`RedSocketIn${slotKey}`, cols.R);
    db.setMultiplier(`GreenSocketIn${slotKey}`, cols.G);
    db.setMultiplier(`BlueSocketIn${slotKey}`, cols.B);
    db.setMultiplier(`WhiteSocketIn${slotKey}`, cols.W);
  }
  if (
    usingStaff &&
    (socketColorBySlot['Weapon 1']?.R ?? 0) >= 1 &&
    (socketColorBySlot['Weapon 1']?.B ?? 0) >= 1
  ) {
    db.setCondition('StaffHasRedAndBlueSocket', true);
  }
  for (const [infKey, infVal] of Object.entries(influenceCounts)) {
    if (infVal > 0) db.setMultiplier(infKey, infVal);
  }
  // Empty coloured sockets on equipped gear (for The Untouched Soul)
  if (build.game === 'poe1') {
    const socketedGemColsBySlot: Record<string, { R: number; G: number; B: number }> = {};
    for (const grp of build.skills) {
      if (!grp.slot) continue;
      const sc = (socketedGemColsBySlot[grp.slot] ??= { R: 0, G: 0, B: 0 });
      for (const gm of grp.gems) {
        const gd = getGemById('poe1', gm.gemId);
        if (!gd) continue;
        if (gd.color === 'red') sc.R++;
        else if (gd.color === 'green') sc.G++;
        else if (gd.color === 'blue') sc.B++;
      }
    }
    let emptyR = 0;
    let emptyG = 0;
    let emptyB = 0;
    const emptyW = socketColorTotals.W;
    for (const [slotKey, cols] of Object.entries(socketColorBySlot)) {
      const used = socketedGemColsBySlot[slotKey] ?? { R: 0, G: 0, B: 0 };
      emptyR += Math.max(0, cols.R - used.R);
      emptyG += Math.max(0, cols.G - used.G);
      emptyB += Math.max(0, cols.B - used.B);
    }
    db.setMultiplier('EmptyRedSocketsInAnySlot', emptyR);
    db.setMultiplier('EmptyGreenSocketsInAnySlot', emptyG);
    db.setMultiplier('EmptyBlueSocketsInAnySlot', emptyB);
    db.setMultiplier('EmptyWhiteSocketsInAnySlot', emptyW);
    const lifePerEmptyR = db.sum('BASE', 'LifePerEmptyRedSocket');
    if (lifePerEmptyR > 0 && emptyR > 0) {
      db.addMod({ name: 'Life', type: 'BASE', value: lifePerEmptyR * emptyR, flags: 0, keywordFlags: 0, source: 'The Untouched Soul (Empty Red Sockets)' });
    }
    const accPerEmptyG = db.sum('BASE', 'AccuracyPerEmptyGreenSocket');
    if (accPerEmptyG > 0 && emptyG > 0) {
      db.addMod({ name: 'Accuracy', type: 'BASE', value: accPerEmptyG * emptyG, flags: 0, keywordFlags: 0, source: 'The Untouched Soul (Empty Green Sockets)' });
    }
    const manaPerEmptyB = db.sum('BASE', 'ManaPerEmptyBlueSocket');
    if (manaPerEmptyB > 0 && emptyB > 0) {
      db.addMod({ name: 'Mana', type: 'BASE', value: manaPerEmptyB * emptyB, flags: 0, keywordFlags: 0, source: 'The Untouched Soul (Empty Blue Sockets)' });
    }
    const resPerEmptyW = db.sum('BASE', 'AllEleResPerEmptyWhiteSocket');
    if (resPerEmptyW > 0 && emptyW > 0) {
      for (const rs of ['FireResist', 'ColdResist', 'LightningResist'] as const) {
        db.addMod({ name: rs, type: 'BASE', value: resPerEmptyW * emptyW, flags: 0, keywordFlags: 0, source: 'The Untouched Soul (Empty White Sockets)' });
      }
    }
  }
  // Shrine buffs granted by items (Blunderbore, The Gull) scaled by ShrineBuffEffect
  const shrineEffMult = Math.max(0, 1 + db.sum('INC', 'ShrineBuffEffect') / 100);
  const massiveShrineTier = db.sum('BASE', 'ShrineBuff:Massive');
  if (massiveShrineTier > 0) {
    const basePct = massiveShrineTier >= 2 ? 40 : 20;
    const scaledPct = Math.floor(basePct * shrineEffMult + 1e-9);
    db.addMod({ name: 'Life', type: 'INC', value: scaledPct, flags: 0, keywordFlags: 0, source: 'Massive Shrine' });
    db.addMod({ name: 'AreaOfEffect', type: 'INC', value: scaledPct, flags: 0, keywordFlags: 0, source: 'Massive Shrine' });
  }
  const brutalShrineTier = db.sum('BASE', 'ShrineBuff:Brutal');
  if (brutalShrineTier > 0) {
    const basePct = brutalShrineTier >= 2 ? 40 : 20;
    const scaledPct = Math.floor(basePct * shrineEffMult + 1e-9);
    db.addMod({ name: 'Damage', type: 'INC', value: scaledPct, flags: 0, keywordFlags: 0, source: 'Brutal Shrine' });
  }
  const accelShrineTier = db.sum('BASE', 'ShrineBuff:Acceleration');
  if (accelShrineTier > 0) {
    const baseAct = accelShrineTier >= 2 ? 50 : 15;
    const scaledAct = Math.floor(baseAct * shrineEffMult + 1e-9);
    db.addMod({ name: 'Speed', type: 'INC', value: scaledAct, flags: ModFlag.Attack, keywordFlags: 0, source: 'Acceleration Shrine' });
    db.addMod({ name: 'Speed', type: 'INC', value: scaledAct, flags: ModFlag.Spell, keywordFlags: 0, source: 'Acceleration Shrine' });
  }
  db.setStat('ShieldBlock', shieldBaseBlock);
  db.setStat('BodyArmourES', bodyLocalEs);
  db.setStat('BodyArmourEvasion', bodyLocalEvasion);
  db.setStat('BodyArmourArmour', bodyLocalArmour);
  db.setStat('EnergyShieldOnBody Armour', bodyLocalEs);
  db.setStat('EvasionOnBody Armour', bodyLocalEvasion);
  db.setStat('ArmourOnBody Armour', bodyLocalArmour);
  db.setStat('HelmetES', helmetLocalEs);
  db.setStat('HelmetArmour', helmetLocalArmour);
  db.setStat('HelmetEvasion', helmetLocalEvasion);
  db.setStat('EnergyShieldOnHelmet', helmetLocalEs);
  db.setStat('ArmourOnHelmet', helmetLocalArmour);
  db.setStat('EvasionOnHelmet', helmetLocalEvasion);
  db.setStat('GlovesArmour', glovesLocalArmour);
  db.setStat('GlovesEvasion', glovesLocalEvasion);
  db.setStat('GlovesES', glovesLocalEs);
  db.setStat('ArmourOnGloves', glovesLocalArmour);
  db.setStat('EvasionOnGloves', glovesLocalEvasion);
  db.setStat('EnergyShieldOnGloves', glovesLocalEs);
  db.setStat('BootsArmour', bootsLocalArmour);
  db.setStat('BootsEvasion', bootsLocalEvasion);
  db.setStat('BootsES', bootsLocalEs);
  db.setStat('ArmourOnBoots', bootsLocalArmour);
  db.setStat('EvasionOnBoots', bootsLocalEvasion);
  db.setStat('EnergyShieldOnBoots', bootsLocalEs);
  db.setStat('FocusES', focusLocalEs);
  db.setStat('ShieldES', shieldLocalEs);
  db.setStat('ShieldArmour', shieldLocalArmour);
  db.setStat('ShieldEvasion', shieldLocalEvasion);
  db.setStat('ArmourOnWeapon 2', shieldLocalArmour);
  db.setStat('EvasionOnWeapon 2', shieldLocalEvasion);
  db.setStat('ArmourOrEvasionOnWeapon 2', shieldLocalArmour + shieldLocalEvasion);
  db.setStat('ArmourEvasionOnWeapon 2', shieldLocalArmour + shieldLocalEvasion);
  db.setStat('EnergyShieldOnWeapon 2', shieldLocalEs + focusLocalEs);
  const attrReqMult = Math.max(0, 1 + db.sum('INC', 'AttributeRequirements') / 100);
  for (const sName of ['Helmet', 'Body Armour', 'Gloves', 'Boots'] as const) {
    const rq = slotAttrReqs[sName];
    if (rq) {
      db.setStat(`StrRequirementsOn${sName}`, Math.round(rq.str * attrReqMult));
      db.setStat(`DexRequirementsOn${sName}`, Math.round(rq.dex * attrReqMult));
      db.setStat(`IntRequirementsOn${sName}`, Math.round(rq.int * attrReqMult));
    }
  }
  const heavyArmourPct = db.sum('BASE', 'ArmourPerStrReqBootsGlovesHelmetPct');
  if (heavyArmourPct > 0) {
    const strReqTotal =
      Math.round((slotAttrReqs.Helmet?.str ?? 0) * attrReqMult) +
      Math.round((slotAttrReqs.Gloves?.str ?? 0) * attrReqMult) +
      Math.round((slotAttrReqs.Boots?.str ?? 0) * attrReqMult);
    const bonusArmour = Math.floor((strReqTotal * heavyArmourPct) / 100);
    if (bonusArmour > 0) {
      db.addMod({
        name: 'Armour',
        type: 'BASE',
        value: bonusArmour,
        flags: 0,
        keywordFlags: 0,
        source: 'Tree: Heavy Armour (Strength Requirements)',
      });
    }
  }
  db.setStat(
    'EvasionOnAllArmourItems',
    bodyLocalEvasion + helmetLocalEvasion + glovesLocalEvasion + bootsLocalEvasion + shieldLocalEvasion,
  );
  db.setStat(
    'EnergyShieldOnAllArmourItems',
    bodyLocalEs + helmetLocalEs + glovesLocalEs + bootsLocalEs + shieldLocalEs + focusLocalEs,
  );
  // Count all socketed gem colors across enabled skills (PoE 2 Gemling Virtuous Barrier / Thaumaturgical Infusion)
  let totalStrMoteGems = 0;
  let totalDexMoteGems = 0;
  let totalIntMoteGems = 0;
  for (const grp of build.skills) {
    if (!grp.enabled) continue;
    for (const gm of grp.gems) {
      if (!gm.enabled) continue;
      const gd = getGemById(build.game, gm.gemId);
      if (!gd) continue;
      if (gd.color === 'red') totalStrMoteGems++;
      else if (gd.color === 'green') totalDexMoteGems++;
      else if (gd.color === 'blue') totalIntMoteGems++;
    }
  }
  db.setMultiplier('StrengthMoteSkillCount', totalStrMoteGems);
  db.setMultiplier('DexterityMoteSkillCount', totalDexMoteGems);
  db.setMultiplier('IntelligenceMoteSkillCount', totalIntMoteGems);
  if (build.game === 'poe2') {
    let passiveCharmSlots = 0;
    for (const nd of allAllocatedNodeDefs) {
      for (const st of nd.stats ?? []) {
        const mCh = st.match(/^\+(\d+) Charm Slots?$/i);
        if (mCh) passiveCharmSlots += Number(mCh[1]);
      }
    }
    const questCharms = Number(cfg.rawInputs?.__questCharmSlots ?? 0);
    const totalCharmSlots = db.flag('CannotUseCharms')
      ? 0
      : Math.min(3, Math.max(0, beltCharmSlots + questCharms + passiveCharmSlots));
    const activeCharms = (['Charm 1', 'Charm 2', 'Charm 3'] as const).filter(
      (s) => Boolean(build.activeFlaskSlots?.[s] && build.equipped[s]),
    ).length;
    db.setStat('EmptyCharms', Math.max(0, totalCharmSlots - activeCharms));
  }
  db.setMultiplier('CorruptedItem', corruptedEquippedCount);
  const distinctMasteryTypes = new Set<string>();
  let allocatedLifeMasteryCount = 0;
  for (const [mIdStr, mText] of Object.entries(build.tree.masteryEffects ?? {})) {
    if (!mText) continue;
    const mn = tree.nodes[Number(mIdStr)]?.name.en ?? mIdStr;
    distinctMasteryTypes.add(mn);
    if (mn.toLowerCase().includes('life mastery')) {
      allocatedLifeMasteryCount++;
    }
  }
  db.setMultiplier('AllocatedMastery', Object.keys(build.tree.masteryEffects ?? {}).length);
  db.setMultiplier('AllocatedMasteryType', distinctMasteryTypes.size);
  db.setMultiplier('AllocatedLifeMastery', allocatedLifeMasteryCount);
  db.setCondition('AtLeast6LifeMasteries', allocatedLifeMasteryCount >= 6);

  // Necromancer Commander of Darkness per-aura speed bonus (now that activeAuraCount is resolved)
  if (
    build.game === 'poe1' &&
    activeAuraCount > 0 &&
    allAllocatedNodeDefs.some((n) => n.name.en.trim().toLowerCase() === 'commander of darkness')
  ) {
    const speedBonus = activeAuraCount * 3;
    db.addMod({ name: 'Speed', type: 'INC', value: speedBonus, flags: ModFlag.Attack, keywordFlags: 0, source: 'Ascendancy: Commander of Darkness' });
    db.addMod({ name: 'Speed', type: 'INC', value: speedBonus, flags: ModFlag.Spell, keywordFlags: 0, source: 'Ascendancy: Commander of Darkness' });
    db.addMod({ name: 'MinionSpeed', type: 'INC', value: speedBonus, flags: 0, keywordFlags: 0, source: 'Ascendancy: Commander of Darkness' });
  }

  const hasMasterfulForm = allAllocatedNodeDefs.some(
    (n) => n.name.en.trim().toLowerCase() === 'masterful form',
  );
  const hasBadgeOfBrotherhood = nonFlaskEquippedForUniques.some(
    (e) => e.item.name.trim().toLowerCase() === 'badge of the brotherhood',
  );
  const chargesAndRage = resolveEffectiveChargesAndRage({
    baseMaxPower: 3,
    extraMaxPower: db.sum('BASE', 'MaxPowerCharges'),
    baseMaxFrenzy: 3,
    extraMaxFrenzy: db.sum('BASE', 'MaxFrenzyCharges'),
    baseMaxEndurance: 3,
    extraMaxEndurance: db.sum('BASE', 'MaxEnduranceCharges'),
    masterfulForm: hasMasterfulForm,
    badgeOfTheBrotherhood: hasBadgeOfBrotherhood,
    usePowerCharges: cfg.usePowerCharges,
    countAsMaxPower: uniqueGearResult.ralakeshCharges.power || db.flag('CountAsMaxPowerCharges'),
    explicitPowerCharges: cfg.powerCharges !== 3 ? cfg.powerCharges : undefined,
    useFrenzyCharges: cfg.useFrenzyCharges,
    countAsMaxFrenzy: uniqueGearResult.ralakeshCharges.frenzy || db.flag('CountAsMaxFrenzyCharges'),
    explicitFrenzyCharges: cfg.frenzyCharges !== 3 ? cfg.frenzyCharges : undefined,
    useEnduranceCharges: cfg.useEnduranceCharges,
    countAsMaxEndurance: uniqueGearResult.ralakeshCharges.endurance || db.flag('CountAsMaxEnduranceCharges'),
    explicitEnduranceCharges: cfg.enduranceCharges !== 3 ? cfg.enduranceCharges : undefined,
    baseMaxRage: 30,
    extraMaxRage: db.sum('BASE', 'MaximumRage'),
    useRage: Boolean(cfg.rage && cfg.rage > 0),
    explicitRage: cfg.rage,
  });

  const extraMaxPowerVal = db.sum('BASE', 'MaxPowerCharges');
  const extraMaxFrenzyVal = db.sum('BASE', 'MaxFrenzyCharges');
  const extraMaxEnduranceVal = db.sum('BASE', 'MaxEnduranceCharges');
  const maxPower =
    cfg.usePowerCharges && cfg.powerCharges > 3 && extraMaxPowerVal === 0
      ? Math.round(cfg.powerCharges)
      : chargesAndRage.maxPower;
  const maxFrenzy =
    cfg.useFrenzyCharges && cfg.frenzyCharges > 3 && extraMaxFrenzyVal === 0
      ? Math.round(cfg.frenzyCharges)
      : chargesAndRage.maxFrenzy;
  const maxEndurance =
    cfg.useEnduranceCharges && cfg.enduranceCharges > 3 && extraMaxEnduranceVal === 0
      ? Math.round(cfg.enduranceCharges)
      : chargesAndRage.maxEndurance;
  const minPower = Math.min(maxPower, Math.max(0, Math.round(db.sum('BASE', 'MinPowerCharges'))));
  const minFrenzy = Math.min(maxFrenzy, Math.max(0, Math.round(db.sum('BASE', 'MinFrenzyCharges'))));
  const minEndurance = Math.min(maxEndurance, Math.max(0, Math.round(db.sum('BASE', 'MinEnduranceCharges'))));
  const activePower = Math.max(
    cfg.usePowerCharges && cfg.powerCharges > 3 && extraMaxPowerVal === 0
      ? Math.round(cfg.powerCharges)
      : chargesAndRage.power,
    minPower,
  );
  const activeFrenzy = Math.max(
    cfg.useFrenzyCharges && cfg.frenzyCharges > 3 && extraMaxFrenzyVal === 0
      ? Math.round(cfg.frenzyCharges)
      : chargesAndRage.frenzy,
    minFrenzy,
  );
  const activeEndurance = Math.max(
    cfg.useEnduranceCharges && cfg.enduranceCharges > 3 && extraMaxEnduranceVal === 0
      ? Math.round(cfg.enduranceCharges)
      : chargesAndRage.endurance,
    minEndurance,
  );

  db.setMultiplier('PowerCharge', activePower);
  db.setMultiplier('FrenzyCharge', activeFrenzy);
  db.setMultiplier('EnduranceCharge', activeEndurance);
  db.setStat('PowerCharges', activePower);
  db.setStat('FrenzyCharges', activeFrenzy);
  db.setStat('EnduranceCharges', activeEndurance);
  db.setMultiplier('RemovablePowerCharge', Math.max(0, activePower - minPower));
  db.setMultiplier('RemovableFrenzyCharge', Math.max(0, activeFrenzy - minFrenzy));
  db.setMultiplier('RemovableEnduranceCharge', Math.max(0, activeEndurance - minEndurance));
  db.setMultiplier('Rage', chargesAndRage.rage);
  db.setStat('Rage', chargesAndRage.rage);
  // PoE 1 Berserk gem (`poe1_berserk`) grants `40 + (lv - 1) + floor(qual * 0.5)%` increased Rage Effect
  // (must be injected BEFORE effRageEffect & Crave the Slaughter so both MORE Attack Damage and Attack Speed scale!).
  if (build.game === 'poe1' && chargesAndRage.rage > 0) {
    let bestPoe1Berserk: { level: number; quality: number } | undefined;
    for (const grp of build.skills) {
      if (!grp.enabled) continue;
      for (const gm of grp.gems) {
        if (!gm.enabled) continue;
        const gd = getGemById('poe1', gm.gemId);
        if (gd && gd.name.en.trim().toLowerCase() === 'berserk') {
          if (!bestPoe1Berserk || gm.level > bestPoe1Berserk.level) {
            bestPoe1Berserk = { level: gm.level, quality: gm.quality ?? 0 };
          }
        }
      }
    }
    if (bestPoe1Berserk) {
      const alreadyHasBerserkRageEff = db
        .calcStat('RageEffect')
        .sources.some((s) => s.type === 'INC' && /berserk/i.test(s.source));
      if (!alreadyHasBerserkRageEff) {
        const bLv = Math.min(40, Math.max(1, bestPoe1Berserk.level));
        const bEff = 40 + (bLv - 1) + Math.floor(Math.max(0, bestPoe1Berserk.quality) * 0.5);
        db.addMod({
          name: 'RageEffect',
          type: 'INC',
          value: bEff,
          flags: 0,
          keywordFlags: 0,
          source: `Skill: Berserk (Lv.${bLv})`,
        });
      }
    }
  }
  const rageEffScale =
    Math.max(0, 1 + db.sum('INC', 'RageEffect') / 100) * db.more('RageEffect');
  const rageEffOverride = db.override('RageEffect');
  const effRageEffect =
    rageEffOverride !== null
      ? Math.floor(rageEffOverride + 1e-9)
      : Math.floor(chargesAndRage.rage * rageEffScale + 1e-9);
  db.setMultiplier('RageEffect', effRageEffect);
  if (chargesAndRage.maxRage > 0 && chargesAndRage.rage >= chargesAndRage.maxRage) {
    db.setCondition('HaveMaximumRage', true);
  }
  if (effRageEffect > 0 && !db.flag('NoRageEffect')) {
    const grantsSpell =
      db.flag('Condition:RageSpellDamage') || db.flag('RageSpellDamage');
    db.addMod({
      name: 'Damage',
      type: 'MORE',
      value: effRageEffect,
      flags: grantsSpell ? ModFlag.Spell : ModFlag.Attack,
      keywordFlags: 0,
      source: `Rage (${chargesAndRage.rage})`,
    });
  }
  db.setCondition('WeaponSet1', build.activeWeaponSet === 1);
  db.setCondition('WeaponSet2', build.activeWeaponSet === 2);

  if (build.game === 'poe1' && activePower > 0) {
    db.addMod({
      name: 'CritChance',
      type: 'INC',
      value: activePower * 50,
      flags: 0,
      keywordFlags: 0,
      source: `Power Charges (${activePower})`,
    });
    if (db.flag('InnerConviction')) {
      db.addMod({
        name: 'Damage',
        type: 'MORE',
        value: activePower * 3,
        flags: ModFlag.Spell,
        keywordFlags: 0,
        source: `Inner Conviction (${activePower} Power Charges)`,
      });
    }
  }
  if (build.game === 'poe1' && activeFrenzy > 0) {
    if (db.flag('AfflictionChargesInsteadOfFrenzy')) {
      db.setMultiplier('AfflictionCharge', activeFrenzy);
      db.addMod({
        name: 'Damage',
        type: 'MORE',
        value: activeFrenzy * 8,
        flags: ModFlag.Ailment | ModFlag.Dot,
        keywordFlags: 0,
        source: `Affliction Charges (${activeFrenzy})`,
      });
    } else {
      db.addMod({ name: 'Speed', type: 'INC', value: activeFrenzy * 4, flags: ModFlag.Attack, keywordFlags: 0, source: `Frenzy Charges (${activeFrenzy})` });
      db.addMod({ name: 'Speed', type: 'INC', value: activeFrenzy * 4, flags: ModFlag.Spell, keywordFlags: 0, source: `Frenzy Charges (${activeFrenzy})` });
      db.addMod({ name: 'Damage', type: 'MORE', value: activeFrenzy * 4, flags: 0, keywordFlags: 0, source: `Frenzy Charges (${activeFrenzy})` });
    }
  }
  if (build.game === 'poe1' && activeEndurance > 0) {
    // Official PoE 1 3.25+ / 3.30 Endurance Charges: +4% Phys & Ele Damage Reduction per charge (no longer +4% Ele Res)
    db.addMod({ name: 'PhysDamageReduction', type: 'BASE', value: activeEndurance * 4, flags: 0, keywordFlags: 0, source: `Endurance Charges (${activeEndurance})` });
  }
  injectChargeScaling(db, 'Power', activePower);
  injectChargeScaling(db, 'Frenzy', activeFrenzy);
  injectChargeScaling(db, 'Endurance', activeEndurance);

  if (cfg.enemyTaunted) {
    const tauntDmg = db.sum('BASE', 'TauntedEnemyDamageTaken');
    if (tauntDmg > 0) {
      db.addMod({
        name: 'EnemyDamageTaken',
        type: 'INC',
        value: tauntDmg,
        flags: 0,
        keywordFlags: 0,
        source: 'Worthy Foe (Taunted Enemy)',
      });
    }
    if (db.flag('TauntedHitsCantBeEvaded')) {
      db.addMod({
        name: 'HitsCantBeEvaded',
        type: 'FLAG',
        value: true,
        flags: ModFlag.Attack,
        keywordFlags: 0,
        source: 'Worthy Foe (Taunted Enemy)',
      });
    }
  }

  // Phase 17 endgame ascendancy / defence mechanics (after tree, items & custom mods load)
  if (db.flag('BodyArmourDoubled') && bodyLocalArmour > 0) {
    db.addMod({
      name: 'Armour',
      type: 'BASE',
      value: bodyLocalArmour,
      flags: 0,
      keywordFlags: 0,
      source: 'Unbreakable (Body Armour doubled)',
    });
  }
  const esPerBodyEvasion = db.sum('BASE', 'EsPerBodyEvasion');
  if (esPerBodyEvasion > 0 && bodyLocalEvasion > 0) {
    db.addMod({
      name: 'EnergyShield',
      type: 'BASE',
      value: Math.floor(bodyLocalEvasion * esPerBodyEvasion),
      flags: 0,
      keywordFlags: 0,
      source: 'Escape Artist (Body Armour Evasion)',
    });
  }
  const evasionPerHelmetEs = db.sum('BASE', 'EvasionPerHelmetEs');
  if (evasionPerHelmetEs > 0 && helmetLocalEs > 0) {
    db.addMod({
      name: 'Evasion',
      type: 'BASE',
      value: Math.floor(helmetLocalEs * evasionPerHelmetEs),
      flags: 0,
      keywordFlags: 0,
      source: 'Escape Artist (Helmet Energy Shield)',
    });
  }
  const lifePerBodyEsPct = db.sum('BASE', 'LifePerBodyEsPct');
  if (lifePerBodyEsPct > 0 && bodyLocalEs > 0) {
    db.addMod({
      name: 'Life',
      type: 'BASE',
      value: Math.floor((bodyLocalEs * lifePerBodyEsPct) / 100),
      flags: 0,
      keywordFlags: 0,
      source: 'Crimson Power (Body Armour Energy Shield)',
    });
  }
  const lifeIncPerCorrupted = db.sum('BASE', 'LifeIncPerCorruptedItem');
  if (lifeIncPerCorrupted > 0 && corruptedEquippedCount > 0) {
    db.addMod({
      name: 'Life',
      type: 'INC',
      value: lifeIncPerCorrupted * corruptedEquippedCount,
      flags: 0,
      keywordFlags: 0,
      source: `Corrupted Items Equipped (${corruptedEquippedCount})`,
    });
  }
  const moreDamagePerMastery = db.sum('BASE', 'MoreDamagePerMastery');
  if (moreDamagePerMastery > 0) {
    const masteryCount = Object.keys(build.tree.masteryEffects ?? {}).length;
    if (masteryCount > 0) {
      db.addMod({
        name: 'Damage',
        type: 'MORE',
        value: masteryCount * moreDamagePerMastery,
        flags: 0,
        keywordFlags: 0,
        source: `Polymath (${masteryCount} Masteries)`,
      });
    }
  }
  // Crave the Slaughter: Every Rage also grants X% increased Attack Speed (scaled by RageEffect)
  if (cfg.rage && cfg.rage > 0) {
    const maxRage = Math.max(0, 30 + Math.round(db.sum('BASE', 'MaximumRage')));
    const rageStacks = Math.min(maxRage, Math.max(0, Math.round(cfg.rage)));
    const rageAsPerStack = db.sum('BASE', 'RageGrantsAttackSpeed');
    const rageEffMult = Math.max(0, 1 + db.sum('INC', 'RageEffect') / 100);
    const effRageAs = Math.floor(rageStacks * rageAsPerStack * rageEffMult + 1e-9);
    if (effRageAs > 0) {
      db.addMod({
        name: 'Speed',
        type: 'INC',
        value: effRageAs,
        flags: ModFlag.Attack,
        keywordFlags: 0,
        source: `Crave the Slaughter (${rageStacks} Rage)`,
      });
    }
  }

  // 6. Compute Attributes & inject Attribute-derived bonuses per GameRuleset
  const strStat = db.calcStat('Str');
  const dexStat = db.calcStat('Dex');
  const intStat = db.calcStat('Int');
  const str = Math.round(strStat.total);
  const dex = Math.round(dexStat.total);
  const int = Math.round(intStat.total);

  db.setStat('Str', str);
  db.setStat('Dex', dex);
  db.setStat('Int', int);
  db.setStat('LowestAttr', Math.min(str, dex, int));

  injectAttributeScaling(db, str, dex, int);

  const skipAllAttrInherent =
    timelessEval.supremeOstentation || db.flag('NoAttributeBonuses') || db.flag('SupremeOstentation');

  if (
    ruleset.lifePerStrength > 0 &&
    !skipAllAttrInherent &&
    !timelessEval.noStrLifeBonus &&
    !db.flag('NoStrLifeBonus')
  ) {
    const effLifePerStr = db.flag('StrLifeHalved')
      ? ruleset.lifePerStrength * 0.5
      : ruleset.lifePerStrength;
    db.addMod({ name: 'Life', type: 'BASE', value: Math.floor(str * effLifePerStr), flags: 0, keywordFlags: 0, source: `Strength (${str})` });
  }
  const hasIronFortressEquipped = nonFlaskEquippedForUniques.some(
    (e) => e.item.name.trim().toLowerCase() === 'the iron fortress',
  );
  const effectiveMeleePhysPerStr =
    build.game === 'poe1' && hasIronFortressEquipped
      ? 0.3
      : ruleset.meleePhysPctPerStrength;
  const strDmgBonus =
    effectiveMeleePhysPerStr > 0 && !skipAllAttrInherent
      ? Math.floor(str * effectiveMeleePhysPerStr)
      : 0;
  if (strDmgBonus > 0) {
    db.addMod({
      name: 'PhysicalDamage',
      type: 'INC',
      value: strDmgBonus,
      flags: ModFlag.Melee,
      keywordFlags: 0,
      source: hasIronFortressEquipped ? `Strength (${str}, The Iron Fortress)` : `Strength (${str})`,
    });
    if (hasIronFortressEquipped) {
      db.addMod({ name: 'StrDmgBonusRatioOverrideApplied', type: 'FLAG', value: true, flags: 0, keywordFlags: 0, source: 'The Iron Fortress' });
    }
    if (db.flag('IronWill')) {
      db.addMod({ name: 'Damage', type: 'INC', value: strDmgBonus, flags: ModFlag.Spell, keywordFlags: 0, source: `Iron Will (Strength ${str})` });
    }
    if (db.flag('IronGrip')) {
      db.addMod({
        name: 'PhysicalDamage',
        type: 'INC',
        value: strDmgBonus,
        flags: ModFlag.Attack | ModFlag.Projectile,
        keywordFlags: 0,
        source: `Iron Grip (Strength ${str})`,
      });
    }
  }
  if (
    ruleset.accuracyPerDexterity > 0 &&
    !skipAllAttrInherent &&
    !timelessEval.noDexAccuracyBonus &&
    !db.flag('NoDexAccuracyBonus')
  ) {
    db.addMod({ name: 'Accuracy', type: 'BASE', value: Math.floor(dex * ruleset.accuracyPerDexterity), flags: 0, keywordFlags: 0, source: `Dexterity (${dex})` });
  }
  const ironReflexes = db.flag('IronReflexes');
  const noDexEvasionBonus =
    db.flag('NoDexBonusToEvasion') || db.flag('NoDexEvasionBonus') || db.flag('Magebane');
  if (
    ruleset.evasionPctPerDexterity > 0 &&
    !ironReflexes &&
    !skipAllAttrInherent &&
    !noDexEvasionBonus
  ) {
    db.addMod({ name: 'Evasion', type: 'INC', value: Math.floor(dex * ruleset.evasionPctPerDexterity), flags: 0, keywordFlags: 0, source: `Dexterity (${dex})` });
  }
  if (
    ruleset.manaPerIntelligence > 0 &&
    !skipAllAttrInherent &&
    !timelessEval.noIntManaBonus &&
    !db.flag('NoIntManaBonus')
  ) {
    db.addMod({ name: 'Mana', type: 'BASE', value: Math.floor(int * ruleset.manaPerIntelligence), flags: 0, keywordFlags: 0, source: `Intelligence (${int})` });
  }
  if (
    ruleset.esPctPerIntelligence > 0 &&
    !skipAllAttrInherent &&
    !db.flag('NoIntEsBonus') &&
    !db.flag('NoIntBonusToES')
  ) {
    db.addMod({ name: 'EnergyShield', type: 'INC', value: Math.floor(int * ruleset.esPctPerIntelligence), flags: 0, keywordFlags: 0, source: `Intelligence (${int})` });
  }
  if (db.flag('CritChancePerLowerStrInt')) {
    const lowerAttr = Math.min(str, int);
    if (lowerAttr > 0) {
      db.addMod({
        name: 'CritChance',
        type: 'INC',
        value: lowerAttr,
        flags: 0,
        keywordFlags: 0,
        source: `Righteous Providence (min Str/Int = ${lowerAttr})`,
      });
    }
  }

  // PoE 1 Champion Fortitude + Unstoppable Hero (3% MORE Armour & Evasion, 3% INC Attack Speed per Fortification > 20)
  if (build.game === 'poe1' && (db.flag('AlwaysFortified') || cfg.fortified || db.flag('UnstoppableHero'))) {
    const maxFort = Math.max(
      0,
      20 + Math.round(db.sum('BASE', 'MaxFortification') + db.sum('BASE', 'MaximumFortification')),
    );
    const effFort =
      cfg.fortificationStacks !== undefined && cfg.fortificationStacks !== 20
        ? Math.min(maxFort, Math.max(0, Math.round(cfg.fortificationStacks)))
        : db.flag('AlwaysFortified') || cfg.fortified
          ? maxFort
          : 0;
    db.setMultiplier('Fortification', effFort);
    if (db.flag('UnstoppableHero') && effFort > 20) {
      const above20 = effFort - 20;
      db.addMod({
        name: 'Armour',
        type: 'MORE',
        value: above20 * 3,
        flags: 0,
        keywordFlags: 0,
        source: `Unstoppable Hero (${effFort} Fortification)`,
      });
      db.addMod({
        name: 'Evasion',
        type: 'MORE',
        value: above20 * 3,
        flags: 0,
        keywordFlags: 0,
        source: `Unstoppable Hero (${effFort} Fortification)`,
      });
      db.addMod({
        name: 'Speed',
        type: 'INC',
        value: above20 * 3,
        flags: ModFlag.Attack,
        keywordFlags: 0,
        source: `Unstoppable Hero (${effFort} Fortification)`,
      });
    }
  }

  // 7. Compute Defence Output (matching official PoB CalcDefence.lua resource conversion order: ES -> Mana BEFORE Life -> ES!)
  const poe2Eb = build.game === 'poe2' && (db.flag('Poe2EldritchBattery') || db.flag('EldritchBattery'));
  if (poe2Eb && !db.flag('Poe2EldritchBatteryApplied')) {
    const preEbEsBase = Math.max(0, db.calcStat('EnergyShield').base);
    if (preEbEsBase > 0) {
      db.addMod({ name: 'Mana', type: 'BASE', value: preEbEsBase, flags: 0, keywordFlags: 0, source: 'Eldritch Battery (ES -> Mana)' });
      db.addMod({ name: 'EnergyShield', type: 'BASE', value: -preEbEsBase, flags: 0, keywordFlags: 0, source: 'Eldritch Battery (ES -> Mana)' });
    }
    db.addMod({ name: 'Poe2EldritchBatteryApplied', type: 'FLAG', value: true, flags: 0, keywordFlags: 0, source: 'Eldritch Battery' });
  }

  const rawLifeEval = db.calcStat('Life');
  const lifeConvToEsPct = Math.min(100, Math.max(0, db.sum('BASE', 'LifeConvertToES')));
  if (lifeConvToEsPct > 0 && rawLifeEval.total > 1) {
    const convertedBase = Math.round(rawLifeEval.base * (lifeConvToEsPct / 100));
    db.addMod({ name: 'EnergyShield', type: 'BASE', value: convertedBase, flags: 0, keywordFlags: 0, source: 'Life Converted to Energy Shield' });
  }

  const prelimLifeEval = db.calcStat('Life');
  const prelimLife =
    lifeConvToEsPct > 0 && prelimLifeEval.total > 1
      ? Math.max(1, Math.round(prelimLifeEval.total * (1 - lifeConvToEsPct / 100)))
      : Math.round(prelimLifeEval.total);
  const prelimMana = Math.round(db.calcStat('Mana').total);
  const prelimEs = Math.round(db.calcStat('EnergyShield').total);
  const prelimAcc = Math.round(db.calcStat('Accuracy').total);
  if (prelimEs > 0 && !db.flag('BlackScytheTraining')) {
    db.setCondition('HaveEnergyShield', true);
  }

  // Post-Life Ascendancy Mechanics (Gore Spike, Beidat's Hand/Will/Gaze, Smith of Kitava, Juggernaut Undeniable, Chieftain Valako/Tasalio, Slayer Masterful Form, Assassin Deadly Infusion)
  applyPostLifeAscendancyMechanics({
    game: build.game,
    db,
    allocatedNodes: allAllocatedNodeDefs,
    config: cfg,
    str,
    dex,
    int,
    maxLife: prelimLife,
    maxMana: prelimMana,
    maxEnergyShield: prelimEs,
    accuracy: prelimAcc,
    maxPowerCharges: maxPower,
    maxFrenzyCharges: maxFrenzy,
    maxEnduranceCharges: maxEndurance,
    activePowerCharges: activePower,
  });
  // Deduplicate Juggernaut Undeniable +2 Accuracy per Strength if BOTH `Tree: Undeniable` (AccuracyRatingPerAttr:Strength)
  // AND `Ascendancy: Undeniable` (from applyPostLifeAscendancyMechanics) emitted flat Str*2 Accuracy!
  if (
    build.game === 'poe1' &&
    allAllocatedNodeDefs.some((n) => n.name.en.trim().toLowerCase() === 'undeniable')
  ) {
    const accSrcs = db.calcStat('Accuracy').sources;
    const hasTreeStrAcc = accSrcs.some((s) => s.type === 'BASE' && /tree:\s*undeniable/i.test(s.source) && /\(strength/i.test(s.source));
    const ascStrAcc = accSrcs.find((s) => s.type === 'BASE' && s.source === 'Ascendancy: Undeniable' && typeof s.value === 'number' && s.value === Math.floor(str * 2));
    if (hasTreeStrAcc && ascStrAcc && typeof ascStrAcc.value === 'number' && ascStrAcc.value > 0) {
      db.addMod({
        name: 'Accuracy',
        type: 'BASE',
        value: -ascStrAcc.value,
        flags: 0,
        keywordFlags: 0,
        source: 'Ascendancy: Undeniable (Dedup Str Accuracy)',
      });
    }
    if (
      db
        .calcStat('Speed', ModFlag.Attack)
        .sources.some((s) => s.type === 'INC' && s.source === 'Ascendancy: Undeniable')
    ) {
      const postUndeniableAcc = Math.round(db.calcStat('Accuracy').total);
      const deltaUndeniableAs = Math.floor(postUndeniableAcc / 150) - Math.floor(prelimAcc / 150);
      if (deltaUndeniableAs > 0) {
        db.addMod({
          name: 'Speed',
          type: 'INC',
          value: deltaUndeniableAs,
          flags: ModFlag.Attack,
          keywordFlags: 0,
          source: `Ascendancy: Undeniable (Post-Str Accuracy ${postUndeniableAcc})`,
        });
      }
    }
  }

  // Evaluate Arcane Surge AFTER post-life ascendancies so Stormweaver `Force of Will` scales `ArcaneSurgeEffect`
  // Also auto-activate on PoE 1 when Arcane Surge Support is linked in any enabled group or Arcane Blessing is allocated
  const hasEnabledArcaneSurgeSupport =
    build.game === 'poe1' &&
    build.skills.some(
      (grp) =>
        grp.enabled &&
        grp.gems.some((gm) => {
          if (!gm.enabled) return false;
          const gd = getGemById('poe1', gm.gemId);
          return Boolean(gd && gd.name.en.trim().toLowerCase().replace(/\s+support$/i, '') === 'arcane surge');
        }),
    );
  if (
    cfg.buffArcaneSurge ||
    hasEnabledArcaneSurgeSupport ||
    db.getEvalContext().conditions.AffectedByArcaneSurge ||
    db.flag('Condition:ArcaneSurge') ||
    db.flag('Condition:AffectedByArcaneSurge')
  ) {
    db.setCondition('AffectedByArcaneSurge', true);
    const asEff = Math.max(0, 1 + db.sum('INC', ['ArcaneSurgeEffect', 'BuffEffectOnSelf']) / 100);
    const defaultAsCast = build.game === 'poe2' ? 15 : 20;
    const defaultAsMana = build.game === 'poe2' ? 20 : 30;
    const asCastSpd = (db.max('ArcaneSurgeCastSpeed') ?? defaultAsCast) * asEff;
    const asManaRegen = (db.max('ArcaneSurgeManaRegen') ?? defaultAsMana) * asEff;
    const asSpellMore =
      Math.max(db.max('ArcaneSurgeDamage') ?? 0, db.sum('BASE', 'ArcaneSurgeDamage')) * asEff;
    db.addMod({ name: 'Speed', type: 'INC', value: asCastSpd, flags: ModFlag.Spell, keywordFlags: 0, source: 'Arcane Surge' });
    db.addMod({ name: 'ManaRegen', type: 'INC', value: asManaRegen, flags: 0, keywordFlags: 0, source: 'Arcane Surge' });
    if (asSpellMore > 0) {
      db.addMod({ name: 'Damage', type: 'MORE', value: asSpellMore, flags: ModFlag.Spell, keywordFlags: 0, source: 'Arcane Surge' });
    }
  }

  // Pool-Conversion Keystones & Faithguard (CI, Faithguard ES->Ward INC redirection, Iron Reflexes hybrid-safe conversion)
  const poolConvRes = applyPoolConversionsAndKeystones({
    game: build.game,
    db,
    allocatedNodes: allAllocatedNodeDefs,
    equippedItems: nonFlaskEquippedForUniques,
    socketedJewels: allJewelItems,
    dex,
  });
  // Power of Purpose (80% of Maximum Mana converted to twice that much Armour)
  if (timelessEval.powerOfPurpose) {
    const prePopMana = Math.round(db.calcStat('Mana').total);
    const convertedMana = Math.round(
      prePopMana * (timelessEval.powerOfPurpose.manaConvertedPct / 100),
    );
    if (convertedMana > 0) {
      db.addMod({
        name: 'Armour',
        type: 'BASE',
        value: convertedMana * timelessEval.powerOfPurpose.armourMultiplier,
        flags: 0,
        keywordFlags: 0,
        source: 'Power of Purpose (Mana -> Armour)',
      });
      db.addMod({
        name: 'Mana',
        type: 'MORE',
        value: -timelessEval.powerOfPurpose.manaConvertedPct,
        flags: 0,
        keywordFlags: 0,
        source: 'Power of Purpose',
      });
    }
  }
  // PoE 1 Heroic Tragedy Vorana (Black Scythe Training: Removes all Energy Shield)
  if (build.game === 'poe1' && db.flag('BlackScytheTraining')) {
    db.addMod({
      name: 'EnergyShield',
      type: 'OVERRIDE',
      value: 0,
      flags: 0,
      keywordFlags: 0,
      source: 'Black Scythe Training',
    });
  }

  // The Apostate (`ConvertArmourESToLife`, PoB1 CalcPerform.lua:1564): Gain Maximum Life instead of ES from equipped Armour items
  if (build.game === 'poe1' && db.flag('ConvertArmourESToLife')) {
    const armourEsToLife = bodyLocalEs + helmetLocalEs + glovesLocalEs + bootsLocalEs + shieldLocalEs;
    if (armourEsToLife > 0) {
      db.addMod({
        name: 'Life',
        type: 'BASE',
        value: armourEsToLife,
        flags: 0,
        keywordFlags: 0,
        source: 'The Apostate (Armour ES -> Life)',
      });
      db.addMod({
        name: 'EnergyShield',
        type: 'BASE',
        value: -armourEsToLife,
        flags: 0,
        keywordFlags: 0,
        source: 'The Apostate (Armour ES -> Life)',
      });
    }
  }

  // Evaluate Life & Mana FIRST and expose them in ModEvalContext BEFORE ES / Spirit / Armour / Evasion
  // so PerStat:Life (PoE 2 Prism Guardian Spirit) and PerStat:Mana evaluate against real pool totals!
  const lifeEval = db.calcStat('Life');
  const manaEval = db.calcStat('Mana');
  const life =
    lifeConvToEsPct > 0 && lifeEval.total > 1
      ? Math.max(1, Math.round(lifeEval.total * (1 - lifeConvToEsPct / 100)))
      : Math.round(lifeEval.total);
  const mana = Math.round(manaEval.total);
  db.setStat('Life', life);
  db.setStat('Mana', mana);

  // Compute Mana & Life Reservations before ES/Armour so Guardian Radiant Faith & The Ivory Tower apply cleanly!
  const genericResEff = db.sum('INC', 'ReservationEfficiency');
  const manaResEff = Math.max(-90, db.sum('INC', 'ManaReservationEfficiency') + genericResEff);
  const lifeResEff = Math.max(-90, db.sum('INC', 'LifeReservationEfficiency') + genericResEff);
  let totalLifeReservedFlat = 0;
  if (life > 1) {
    for (const res of auraEval.lifeReservations) {
      if (res.zeroedByBlessing) continue;
      const effDiv = 1 + Math.max(-90, lifeResEff + res.localEfficiencyPct) / 100;
      if (res.basePct > 0) {
        const basePercentVal = Math.trunc(res.basePct * 100 * res.multiplier + 1e-6);
        const effPct = Math.max(0, Math.round(basePercentVal / effDiv) / 100);
        totalLifeReservedFlat += Math.ceil(life * (effPct / 100) - 1e-9);
      }
      if (res.baseFlat > 0) {
        const baseFlatVal = Math.trunc(res.baseFlat * res.multiplier + 1e-6);
        const effFlat = Math.max(0, Math.round(baseFlatVal / effDiv));
        totalLifeReservedFlat += effFlat;
      }
    }
    const extraLifeResPct = Math.max(0, db.sum('BASE', 'ExtraLifeReserved'));
    if (extraLifeResPct > 0) {
      totalLifeReservedFlat += Math.ceil(life * (extraLifeResPct / 100) - 1e-9);
    }
  }
  const lifeUnreserved = Math.max(0, life - totalLifeReservedFlat);
  db.setStat('LifeReserved', totalLifeReservedFlat);
  db.setStat('LifeUnreserved', lifeUnreserved);
  // The Ivory Tower: "+30 to maximum Energy Shield per 100 Reserved Life" (applied BEFORE ES calc & Energy Blade!)
  if (totalLifeReservedFlat > 0) {
    for (const { item } of nonFlaskEquippedForUniques) {
      for (const rawLine of [...item.implicits, ...item.explicits]) {
        const clean = rawLine.replace(/^\{[^}]*\}/g, '').trim();
        const mIvory = clean.match(/^\+(\d+) to maximum Energy Shield per (\d+) Reserved Life$/i);
        if (mIvory) {
          const perVal = Number(mIvory[1]);
          const perDiv = Math.max(1, Number(mIvory[2]));
          const bonusEs = Math.floor((totalLifeReservedFlat / perDiv) * perVal);
          if (bonusEs > 0) {
            db.addMod({
              name: 'EnergyShield',
              type: 'BASE',
              value: bonusEs,
              flags: 0,
              keywordFlags: 0,
              source: `${item.name} (Reserved Life)`,
            });
          }
        }
      }
    }
  }
  let totalManaReservedFlat = 0;
  let totalManaReservedPctExact = 0;
  if (mana > 0) {
    for (const res of auraEval.manaReservations) {
      if (res.zeroedByBlessing) continue;
      const effDiv = 1 + Math.max(-90, manaResEff + res.localEfficiencyPct) / 100;
      if (res.basePct > 0) {
        const basePercentVal = Math.trunc(res.basePct * 100 * res.multiplier + 1e-6);
        const effPct = Math.max(0, Math.round(basePercentVal / effDiv) / 100);
        totalManaReservedPctExact += effPct;
        totalManaReservedFlat += Math.ceil(mana * (effPct / 100) - 1e-9);
      }
      if (res.baseFlat > 0) {
        const baseFlatVal = Math.trunc(res.baseFlat * res.multiplier + 1e-6);
        const effFlat = Math.max(0, Math.round(baseFlatVal / effDiv));
        totalManaReservedFlat += effFlat;
      }
    }
  }
  const hasRadiantFaith =
    build.game === 'poe1' &&
    allAllocatedNodeDefs.some((n) => n.name.en.trim().toLowerCase() === 'radiant faith');
  if (hasRadiantFaith && totalManaReservedFlat > 0) {
    const rfArmour = Math.floor(totalManaReservedFlat * 0.25);
    const rfEs = Math.floor(totalManaReservedFlat * 0.1);
    if (rfArmour > 0) {
      db.addMod({
        name: 'Armour',
        type: 'BASE',
        value: rfArmour,
        flags: 0,
        keywordFlags: 0,
        source: 'Ascendancy: Radiant Faith',
      });
    }
    if (rfEs > 0) {
      db.addMod({
        name: 'EnergyShield',
        type: 'BASE',
        value: rfEs,
        flags: 0,
        keywordFlags: 0,
        source: 'Ascendancy: Radiant Faith',
      });
    }
  }

  // Pre-evaluate raw & max resistances before Armour/Evasion so Breach/Grasping Mail Overcapped/Uncapped Resist scaling works!
  let fireMaxResist = Math.min(90, Math.round(db.sum('BASE', 'FireResistMax')));
  let coldMaxResist = Math.min(90, Math.round(db.sum('BASE', 'ColdResistMax')));
  let lightningMaxResist = Math.min(90, Math.round(db.sum('BASE', 'LightningResistMax')));
  if (uniqueGearResult.meldingOfTheFleshActive) {
    const highestEleMax = Math.max(fireMaxResist, coldMaxResist, lightningMaxResist);
    fireMaxResist = highestEleMax;
    coldMaxResist = highestEleMax;
    lightningMaxResist = highestEleMax;
  }
  const chaosMaxResist = Math.min(90, Math.round(db.sum('BASE', 'ChaosResistMax')));

  const evalSignedResist = (stat: string): number => {
    const ov = db.override(stat);
    if (ov !== null) return Math.round(ov);
    return Math.round(db.sum('BASE', stat) * Math.max(0, 1 + db.sum('INC', stat) / 100) * db.more(stat));
  };
  const fireRaw = evalSignedResist('FireResist');
  const coldRaw = evalSignedResist('ColdResist');
  const lightningRaw = evalSignedResist('LightningResist');
  const chaosImmune = db.flag('ChaosImmune') || poolConvRes.chaosInoculation;
  const chaosRaw = chaosImmune ? 100 : evalSignedResist('ChaosResist');
  db.setStat('UncappedFireResist', fireRaw);
  db.setStat('UncappedColdResist', coldRaw);
  db.setStat('UncappedLightningResist', lightningRaw);
  db.setStat('UncappedChaosResist', chaosRaw);
  const fireOvercap = Math.max(0, fireRaw - fireMaxResist);
  const coldOvercap = Math.max(0, coldRaw - coldMaxResist);
  const lightOvercap = Math.max(0, lightningRaw - lightningMaxResist);
  db.setStat('OvercappedFireResist', fireOvercap);
  db.setStat('OvercappedColdResist', coldOvercap);
  db.setStat('OvercappedLightningResist', lightOvercap);
  db.setStat('FireResistOverCap', fireOvercap);
  db.setStat('ColdResistOverCap', coldOvercap);
  db.setStat('LightningResistOverCap', lightOvercap);
  db.setStat('FireResistOver75', Math.max(0, Math.min(fireRaw, fireMaxResist) - 75));
  db.setStat('ColdResistOver75', Math.max(0, Math.min(coldRaw, coldMaxResist) - 75));
  db.setStat('LightningResistOver75', Math.max(0, Math.min(lightningRaw, lightningMaxResist) - 75));

  if (db.flag('ArmourIncPerOvercappedFireRes') && fireRaw > fireMaxResist) {
    db.addMod({
      name: 'Armour',
      type: 'INC',
      value: fireRaw - fireMaxResist,
      flags: 0,
      keywordFlags: 0,
      source: 'Overcapped Fire Resistance',
    });
  }
  if (db.flag('ArmourIncPerUncappedFireRes') && fireRaw > 0) {
    db.addMod({
      name: 'Armour',
      type: 'INC',
      value: fireRaw,
      flags: 0,
      keywordFlags: 0,
      source: 'Uncapped Fire Resistance',
    });
  }
  if (db.flag('EvasionIncPerOvercappedColdRes') && coldRaw > coldMaxResist) {
    db.addMod({
      name: 'Evasion',
      type: 'INC',
      value: coldRaw - coldMaxResist,
      flags: 0,
      keywordFlags: 0,
      source: 'Overcapped Cold Resistance',
    });
  }
  if (db.flag('EvasionIncPerUncappedColdRes') && coldRaw > 0) {
    db.addMod({
      name: 'Evasion',
      type: 'INC',
      value: coldRaw,
      flags: 0,
      keywordFlags: 0,
      source: 'Uncapped Cold Resistance',
    });
  }
  if (db.flag('CritIncPerOvercappedLightRes') && lightningRaw > lightningMaxResist) {
    db.addMod({
      name: 'CritChance',
      type: 'INC',
      value: lightningRaw - lightningMaxResist,
      flags: 0,
      keywordFlags: 0,
      source: 'Overcapped Lightning Resistance',
    });
  }
  if (db.flag('CritIncPerUncappedLightRes') && lightningRaw > 0) {
    db.addMod({
      name: 'CritChance',
      type: 'INC',
      value: lightningRaw,
      flags: 0,
      keywordFlags: 0,
      source: 'Uncapped Lightning Resistance',
    });
  }

  // Re-run Iron Reflexes pool conversion if Radiant Faith or Overcap Resist added Base/INC Armour or Evasion
  const finalPoolConvRes =
    ironReflexes &&
    (hasRadiantFaith ||
      db.flag('ArmourIncPerOvercappedFireRes') ||
      db.flag('ArmourIncPerUncappedFireRes') ||
      db.flag('EvasionIncPerOvercappedColdRes') ||
      db.flag('EvasionIncPerUncappedColdRes'))
      ? applyPoolConversionsAndKeystones({
          game: build.game,
          db,
          allocatedNodes: allAllocatedNodeDefs,
          equippedItems: nonFlaskEquippedForUniques,
          socketedJewels: allJewelItems,
          dex,
        })
      : poolConvRes;

  if (db.flag('EsIncAppliesToWardInstead')) {
    const esIncVal = db.calcStat('EnergyShield').incPct;
    if (esIncVal !== 0) {
      db.addMod({
        name: 'Ward',
        type: 'INC',
        value: esIncVal,
        flags: 0,
        keywordFlags: 0,
        source: 'Faithguard (ES -> Ward)',
      });
    }
  }
  // Champion: Unstoppable Hero (`3% more Armour and Evasion Rating / 3% increased Attack Speed per Fortification above 20`)
  // Guard against double-counting when the UnstoppableHero flag block above already applied it.
  if (build.game === 'poe1' && !db.flag('UnstoppableHero') && (cfg.fortified || db.flag('AlwaysFortified'))) {
    const moreDefPerFort = db.sum('BASE', 'MoreArmourEvasionPerFortAbove');
    const asPerFort = db.sum('BASE', 'AttackSpeedPerFortAbove');
    if (moreDefPerFort > 0 || asPerFort > 0) {
      const fortThresh = db.max('FortAboveThreshold') ?? 20;
      const maxFort = 20 + db.sum('BASE', ['MaximumFortification', 'MaxFortification']);
      const curFort =
        typeof cfg.rawInputs?.multiplierFortification === 'number' && cfg.rawInputs.multiplierFortification > 0
          ? cfg.rawInputs.multiplierFortification
          : maxFort;
      const excessFort = Math.max(0, Math.floor(curFort) - fortThresh);
      if (excessFort > 0) {
        if (moreDefPerFort > 0) {
          db.addMod({ name: 'Armour', type: 'MORE', value: excessFort * moreDefPerFort, flags: 0, keywordFlags: 0, source: 'Unstoppable Hero' });
          db.addMod({ name: 'Evasion', type: 'MORE', value: excessFort * moreDefPerFort, flags: 0, keywordFlags: 0, source: 'Unstoppable Hero' });
        }
        if (asPerFort > 0) {
          db.addMod({ name: 'Speed', type: 'INC', value: excessFort * asPerFort, flags: ModFlag.Attack, keywordFlags: 0, source: 'Unstoppable Hero' });
        }
      }
    }
  }
  const esEval = db.calcStat('EnergyShield');
  const wardEval = db.calcStat('Ward');
  const spiritEval = db.calcStat('Spirit');
  const armourEval = db.calcStat('Armour');
  const evasionEval = db.calcStat('Evasion');
  const moveSpeedEval = db.calcStat('MovementSpeed');

  // Slot-specific "% increased / more Armour / Evasion / Energy Shield from Equipped Body Armour / Shield / Helmet / Focus / Boots / Gloves"
  const sumSlotInc = (
    slot: 'BodyArmour' | 'Shield' | 'Helmet' | 'Focus' | 'Boots' | 'Gloves',
    stat: 'EnergyShield' | 'Armour' | 'Evasion',
  ) => {
    const base =
      db.sum('INC', `${stat}From${slot}`) +
      db.sum('INC', `${slot}${stat}Inc`) +
      db.sum('INC', `${slot}DefencesInc`);
    if (stat === 'EnergyShield') {
      return base + db.sum('INC', `${slot}ArmourandEnergyShieldInc`) + db.sum('INC', `${slot}EvasionandEnergyShieldInc`);
    }
    if (stat === 'Armour') {
      return base + db.sum('INC', `${slot}ArmourandEnergyShieldInc`) + db.sum('INC', `${slot}ArmourandEvasionInc`);
    }
    return (
      base +
      db.sum('INC', `${slot}EvasionRatingInc`) +
      db.sum('INC', `${slot}EvasionandEnergyShieldInc`) +
      db.sum('INC', `${slot}ArmourandEvasionInc`)
    );
  };
  const computeSlotExtra = (
    localBase: number,
    slot: 'BodyArmour' | 'Shield' | 'Helmet' | 'Focus' | 'Boots' | 'Gloves',
    stat: 'EnergyShield' | 'Armour' | 'Evasion',
    globalIncPct: number,
    globalMoreMult: number,
  ): number => {
    if (localBase <= 0) return 0;
    const slotInc = sumSlotInc(slot, stat);
    const slotMore = db.more(`${stat}From${slot}`);
    if (slotInc === 0 && slotMore === 1) return 0;
    const baseFactor = Math.max(0, 1 + globalIncPct / 100);
    const fullFactor = Math.max(0, 1 + (globalIncPct + slotInc) / 100) * slotMore;
    return localBase * (fullFactor - baseFactor) * globalMoreMult;
  };
  const extraSlotEs =
    poe2Eb ||
    db.flag('ConvertArmourESToLife') ||
    esEval.sources.some((s) => s.type === 'OVERRIDE' && s.value === 0)
      ? 0
      : computeSlotExtra(bodyLocalEs, 'BodyArmour', 'EnergyShield', esEval.incPct, esEval.moreMultiplier) +
        computeSlotExtra(shieldLocalEs, 'Shield', 'EnergyShield', esEval.incPct, esEval.moreMultiplier) +
        computeSlotExtra(helmetLocalEs, 'Helmet', 'EnergyShield', esEval.incPct, esEval.moreMultiplier) +
        computeSlotExtra(focusLocalEs, 'Focus', 'EnergyShield', esEval.incPct, esEval.moreMultiplier) +
        computeSlotExtra(bootsLocalEs, 'Boots', 'EnergyShield', esEval.incPct, esEval.moreMultiplier) +
        computeSlotExtra(glovesLocalEs, 'Gloves', 'EnergyShield', esEval.incPct, esEval.moreMultiplier);
  const bodyArmourSlotFactor = db.flag('BodyArmourDoubled') ? 2 : 1;
  const extraSlotArmour =
    computeSlotExtra(bodyArmourSlotFactor * bodyLocalArmour, 'BodyArmour', 'Armour', armourEval.incPct, armourEval.moreMultiplier) +
    computeSlotExtra(shieldLocalArmour, 'Shield', 'Armour', armourEval.incPct, armourEval.moreMultiplier) +
    computeSlotExtra(helmetLocalArmour, 'Helmet', 'Armour', armourEval.incPct, armourEval.moreMultiplier) +
    computeSlotExtra(bootsLocalArmour, 'Boots', 'Armour', armourEval.incPct, armourEval.moreMultiplier) +
    computeSlotExtra(glovesLocalArmour, 'Gloves', 'Armour', armourEval.incPct, armourEval.moreMultiplier);
  const extraSlotEvasion =
    computeSlotExtra(bodyLocalEvasion, 'BodyArmour', 'Evasion', evasionEval.incPct, evasionEval.moreMultiplier) +
    computeSlotExtra(shieldLocalEvasion, 'Shield', 'Evasion', evasionEval.incPct, evasionEval.moreMultiplier) +
    computeSlotExtra(helmetLocalEvasion, 'Helmet', 'Evasion', evasionEval.incPct, evasionEval.moreMultiplier) +
    computeSlotExtra(bootsLocalEvasion, 'Boots', 'Evasion', evasionEval.incPct, evasionEval.moreMultiplier) +
    computeSlotExtra(glovesLocalEvasion, 'Gloves', 'Evasion', evasionEval.incPct, evasionEval.moreMultiplier);

  // Corrupted Soul / Replica Soul Tether: Gain X% of Maximum Life as Extra Maximum Energy Shield
  const lifeAsExtraEsPct = Math.max(0, db.sum('BASE', 'LifeAsExtraES'));
  let extraEsFromLife = 0;
  if (lifeAsExtraEsPct > 0 && rawLifeEval.total > 1 && db.calcStat('EnergyShield').total >= 0) {
    // Only add if Energy Shield is not overridden to 0 (e.g. The Agnostic)
    const agnosticZero = esEval.sources.some((s) => s.type === 'OVERRIDE' && s.value === 0);
    if (!agnosticZero) {
      extraEsFromLife =
        rawLifeEval.base *
        (lifeAsExtraEsPct / 100) *
        (1 + (rawLifeEval.incPct + esEval.incPct) / 100) *
        rawLifeEval.moreMultiplier *
        esEval.moreMultiplier;
    }
  }
  // Hierophant Sanctuary of Thought: Gain X% of Maximum Mana as Extra Maximum Energy Shield
  const manaAsExtraEsPct = Math.max(0, db.sum('BASE', 'ManaAsExtraES'));
  let extraEsFromMana = 0;
  if (manaAsExtraEsPct > 0 && manaEval.base > 0) {
    const agnosticZero = esEval.sources.some((s) => s.type === 'OVERRIDE' && s.value === 0);
    if (!agnosticZero) {
      extraEsFromMana =
        manaEval.base *
        (manaAsExtraEsPct / 100) *
        (1 + (manaEval.incPct + esEval.incPct) / 100) *
        manaEval.moreMultiplier *
        esEval.moreMultiplier;
    }
  }
  // Transfiguration of Mind / Soul / Body (Crown of the Inward Eye, Hierophant Divine Guidance — CalcOffence.lua:548-556)
  if (db.flag('TransfigurationOfMind') && manaEval.incPct !== 0) {
    db.addMod({
      name: 'Damage',
      type: 'INC',
      value: Math.floor(manaEval.incPct * 0.3),
      flags: 0,
      keywordFlags: 0,
      source: 'Transfiguration of Mind',
    });
  }
  if (db.flag('TransfigurationOfSoul') && esEval.incPct !== 0) {
    db.addMod({
      name: 'Damage',
      type: 'INC',
      value: Math.floor(esEval.incPct * 0.3),
      flags: ModFlag.Spell,
      keywordFlags: 0,
      source: 'Transfiguration of Soul',
    });
  }
  if (db.flag('TransfigurationOfBody') && rawLifeEval.incPct !== 0) {
    db.addMod({
      name: 'Damage',
      type: 'INC',
      value: Math.floor(rawLifeEval.incPct * 0.3),
      flags: ModFlag.Attack,
      keywordFlags: 0,
      source: 'Transfiguration of Body',
    });
  }
  const energyShield = Math.round(esEval.total + extraEsFromLife + extraEsFromMana + extraSlotEs);
  const ward = Math.round(wardEval.total);
  const spirit = ruleset.supportsSpirit && !db.flag('ZeroSpirit') ? Math.round(spiritEval.total) : 0;

  const evasionAsExtraArmourPct = Math.max(0, db.sum('BASE', 'EvasionAsExtraArmour'));
  const extraArmourFromEvasion =
    evasionAsExtraArmourPct > 0 && !ironReflexes && evasionEval.base > 0
      ? evasionEval.base *
        (evasionAsExtraArmourPct / 100) *
        Math.max(0, 1 + armourEval.incPct / 100) *
        armourEval.moreMultiplier
      : 0;
  let armour = Math.round(armourEval.total + extraSlotArmour + extraArmourFromEvasion);
  let evasion = Math.round(evasionEval.total + extraSlotEvasion);
  if (ironReflexes) {
    armour = Math.round(finalPoolConvRes.resolvedPools.armour + extraSlotArmour + extraSlotEvasion);
    evasion = 0;
  }
  db.setStat('EnergyShield', energyShield);
  db.setStat('Armour', armour);
  db.setStat('Evasion', evasion);
  db.setStat('ShieldArmour', shieldLocalArmour);
  db.setStat('ShieldEvasion', shieldLocalEvasion);
  db.setStat('ShieldES', shieldLocalEs);
  db.setStat('ArmourOnWeapon 2', shieldLocalArmour);
  db.setStat('EvasionOnWeapon 2', shieldLocalEvasion);
  db.setStat('EnergyShieldOnWeapon 2', shieldLocalEs);
  db.setStat('LowestOfArmourAndEvasion', Math.min(armour, evasion));
  const accuracyTotal = Math.round(db.calcStat('Accuracy').total);
  db.setStat('Accuracy', accuracyTotal);

  const lowLifeThresholdPct = db.override('LowLifeThreshold') ?? (build.game === 'poe2' ? 35 : 50);
  const autoLowLife =
    life > 1 && totalLifeReservedFlat > 0 && lifeUnreserved <= life * (lowLifeThresholdPct / 100);
  if (autoLowLife && !cfg.conditionLowLife) {
    db.setCondition('LowLife', true);
    db.setCondition('FullLife', false);
    if (build.game === 'poe1' && db.flag('PainAttunement')) {
      db.addMod({
        name: 'Damage',
        type: 'MORE',
        value: 30,
        flags: ModFlag.Spell,
        keywordFlags: 0,
        source: 'Pain Attunement (Low Life)',
      });
    }
  }
  const totalManaReservedPct =
    mana > 0
      ? Math.round((totalManaReservedFlat / mana) * 1000) / 10
      : 0;
  const manaUnreserved = Math.max(0, mana - totalManaReservedFlat);
  db.setStat('ManaUnreserved', manaUnreserved);
  const spiritUnreserved = spirit - totalSpiritReserved;

  // Guard skills (Molten Shell / Steelskin / Arcane Cloak) add a temporary hit-absorption pool.
  let guardPool = 0;
  if (cfg.activeGuardSkill === 'MoltenShell') {
    const guardShield = Math.min(5000, Math.floor(armour * 0.1));
    guardPool = Math.round(guardShield * 0.75);
  } else if (cfg.activeGuardSkill === 'Steelskin') {
    guardPool = Math.round(2209 * 0.7);
  } else if (cfg.activeGuardSkill === 'ArcaneCloak') {
    const spentMana = manaUnreserved * 0.64;
    guardPool = Math.round(spentMana * 0.75);
    const cloakLightning = Math.floor(spentMana * 0.14);
    if (cloakLightning > 0) {
      db.addMod({
        name: 'LightningMin',
        type: 'BASE',
        value: cloakLightning,
        flags: ModFlag.Hit,
        keywordFlags: 0,
        source: 'Arcane Cloak',
      });
      db.addMod({
        name: 'LightningMax',
        type: 'BASE',
        value: cloakLightning,
        flags: ModFlag.Hit,
        keywordFlags: 0,
        source: 'Arcane Cloak',
      });
    }
  }

  if (totalManaReservedPct > 100) {
    warnings.push({
      code: 'OVER_RESERVED_MANA',
      message: {
        en: `Mana reservation (${totalManaReservedPct}%) exceeds 100%.`,
        zh: `魔力保留（${totalManaReservedPct}%）已超过 100%。`,
      },
    });
  }
  if (ruleset.supportsSpirit && spiritUnreserved < 0) {
    warnings.push({
      code: 'OVER_RESERVED_SPIRIT',
      message: {
        en: `Spirit reserved (${totalSpiritReserved}) exceeds total Spirit (${spirit}).`,
        zh: `精魂保留（${totalSpiritReserved}）已超过总精魂上限（${spirit}）。`,
      },
    });
  }

  const fireResist = Math.min(fireMaxResist, fireRaw);
  const coldResist = Math.min(coldMaxResist, coldRaw);
  const lightningResist = Math.min(lightningMaxResist, lightningRaw);
  const chaosResist = chaosImmune ? 100 : Math.min(chaosMaxResist, chaosRaw);

  if (fireResist < 75 || coldResist < 75 || lightningResist < 75) {
    warnings.push({
      code: 'UNCAPPED_RESISTS',
      message: {
        en: `Elemental resistances are not capped (Fire ${fireResist}% / Cold ${coldResist}% / Light ${lightningResist}%).`,
        zh: `元素抗性未满 75%（火 ${fireResist}% / 冰 ${coldResist}% / 雷 ${lightningResist}%）。`,
      },
    });
  }

  // Armour Phys Damage Reduction against a standard enemy hit (1500 phys hit baseline)
  const referencePhysHit = 1500;
  const armourMit = armour > 0 ? (armour / (armour + ruleset.armourFormulaFactor * referencePhysHit)) * 100 : 0;
  const flatPdr = db.sum('BASE', 'PhysDamageReduction');
  const physDamageReduction = Math.min(90, Math.round((armourMit + flatPdr) * 10) / 10);

  // Evasion chance against level-scaled enemy accuracy (Blind reduces enemy Accuracy by 20%)
  const rawEnemyAcc = 200 + cfg.enemyLevel * 12;
  const enemyAcc = cfg.enemyBlinded ? rawEnemyAcc * 0.8 : rawEnemyAcc;
  const evadeChance =
    evasion > 0 && !db.flag('CannotEvade')
      ? Math.min(95, Math.max(0, Math.round((1 - (1.25 * enemyAcc) / (enemyAcc + Math.pow(evasion / 5, 0.9))) * 100)))
      : 0;

  const maxAttackBlock = Math.min(90, Math.max(0, ruleset.maxBlockChance + Math.round(db.sum('BASE', 'BlockChanceMax'))));
  const maxSpellBlock = Math.min(90, Math.max(0, ruleset.maxBlockChance + Math.round(db.sum('BASE', 'SpellBlockChanceMax'))));
  const rawAttackBlock = db.calcStat('BlockChance').total;
  const blockChance = Math.min(maxAttackBlock, Math.max(0, Math.floor(rawAttackBlock + 1e-6)));
  db.setStat('BlockChance', blockChance);
  let rawSpellBlock = db.calcStat('SpellBlockChance').total;
  if (keystonePoolResult.versatileCombatant) {
    const finalOvercap = Math.max(0, Math.floor(rawAttackBlock + 1e-6) - maxAttackBlock);
    const deltaBonus = finalOvercap * 2 - keystonePoolResult.versatileCombatantSpellBlockBonus;
    if (deltaBonus !== 0) {
      rawSpellBlock += deltaBonus;
    }
  }
  const spellBlockChance = Math.min(maxSpellBlock, Math.max(0, Math.round(rawSpellBlock)));
  db.setStat('SpellBlockChance', spellBlockChance);
  const spellSuppressionChance = ruleset.supportsSpellSuppression
    ? Math.min(100, Math.round(db.sum('BASE', 'SpellSuppressionChance')))
    : 0;

  const lifeRegen =
    Math.round((db.sum('BASE', 'LifeRegen') + (life * db.sum('BASE', 'LifeRegenPercent')) / 100) * 10) / 10;
  const manaRegenInc = db.sum('INC', 'ManaRegen');
  const manaRegen = Math.round(mana * 0.0175 * (1 + manaRegenInc / 100) * 10) / 10;

  // Effective Hit Pool & Max Hit Taken (including Ward, Eldritch Battery & Divine Flesh Ele-Taken-as-Chaos)
  const eldritchBattery = db.flag('EldritchBattery');
  const esProtectingLife = eldritchBattery ? 0 : energyShield;
  const esProtectingMana = eldritchBattery ? energyShield : 0;
  const momPct = Math.min(100, db.sum('BASE', 'DamageTakenFromManaBeforeLife'));
  const effectiveManaBuffer =
    momPct > 0
      ? Math.min(manaUnreserved + esProtectingMana, Math.round((life * momPct) / (100 - momPct + 0.01)))
      : 0;
  const totalPool = life + esProtectingLife + ward + effectiveManaBuffer + guardPool;

  const avgEleRes = (fireResist + coldResist + lightningResist) / 3;
  const eleAsChaosFrac = Math.min(1, Math.max(0, db.sum('BASE', 'EleTakenAsChaos') / 100));
  const fortifyStacks = cfg.fortified ? Math.min(40, Math.max(0, Math.round(cfg.fortificationStacks ?? 20))) : 0;
  const fortifyTakenMult = 1 - fortifyStacks / 100;
  const globalTakenMult = Math.max(
    0.1,
    (1 + db.sum('INC', 'DamageTaken') / 100) * db.more('DamageTaken'),
  );
  let eleTakenFactor =
    Math.max(
      0.1,
      (1 - eleAsChaosFrac) * (1 - avgEleRes / 100) + eleAsChaosFrac * (1 - chaosResist / 100),
    ) *
    fortifyTakenMult *
    globalTakenMult;
  const armourAppliesToElePct = db.sum('BASE', 'ArmourAppliesToEle');
  if (armourAppliesToElePct > 0 && armour > 0) {
    const effectiveEleArmour = armour * (armourAppliesToElePct / 100);
    const eleArmourMitigation =
      effectiveEleArmour / (effectiveEleArmour + ruleset.armourFormulaFactor * 1500);
    eleTakenFactor *= 1 - eleArmourMitigation;
  }
  eleTakenFactor = Math.max(0.05, eleTakenFactor);
  const physTakenFactor =
    Math.max(0.1, 1 - physDamageReduction / 100) * fortifyTakenMult * globalTakenMult;
  const avoidanceFactor = Math.max(0.15, (1 - evadeChance / 100) * (1 - blockChance / 100));

  const maxPhysHitTaken = Math.round(totalPool / physTakenFactor);
  const maxEleHitTaken = Math.round(totalPool / eleTakenFactor);
  const effectiveHitPool = Math.round((totalPool / ((physTakenFactor + eleTakenFactor) / 2)) / avoidanceFactor);

  const defence: CalcDefenceOutput = {
    str,
    dex,
    int,
    life,
    lifeUnreserved,
    lifeRegen,
    energyShield,
    esRegen: 0,
    ...(ward > 0 ? { ward } : {}),
    mana,
    manaUnreserved,
    manaRegen,
    spirit,
    spiritReserved: totalSpiritReserved,
    spiritUnreserved,
    armour,
    physDamageReduction,
    evasion,
    evadeChance,
    blockChance,
    spellBlockChance,
    spellSuppressionChance,
    fireResist,
    fireResistOvercap: Math.max(0, fireRaw - fireMaxResist),
    fireMaxResist,
    coldResist,
    coldResistOvercap: Math.max(0, coldRaw - coldMaxResist),
    coldMaxResist,
    lightningResist,
    lightningResistOvercap: Math.max(0, lightningRaw - lightningMaxResist),
    lightningMaxResist,
    chaosResist,
    chaosResistOvercap: chaosImmune ? 0 : Math.max(0, chaosRaw - chaosMaxResist),
    chaosMaxResist,
    movementSpeedPct: Math.round(moveSpeedEval.total),
    effectiveHitPool,
    maxPhysHitTaken,
    maxEleHitTaken,
  };

  // Automatic LowLife (<= 50% PoE 1 / <= 35% PoE 2) & FullLife derived from unreserved Life
  const isCiFinal = keystonePoolResult.chaosInoculation || db.flag('ChaosInoculation');
  const lowLifeFrac = build.game === 'poe2' ? 0.35 : 0.5;
  const derivedLowLife =
    Boolean(cfg.conditionLowLife) ||
    db.flag('Condition:LowLife') ||
    (!isCiFinal && defence.life > 0 && defence.lifeUnreserved <= defence.life * lowLifeFrac + 1e-6);
  const derivedFullLife =
    Boolean(cfg.conditionFullLife) ||
    Boolean(cfg.rawInputs?.conditionFullLife) ||
    (build.game === 'poe2'
      ? isCiFinal
      : !derivedLowLife && (isCiFinal || (defence.life > 0 && defence.lifeUnreserved >= defence.life)));
  db.setCondition('LowLife', derivedLowLife);
  db.setCondition('FullLife', derivedFullLife);
  if (build.game === 'poe1') {
    const canLeechEsOnFull = db.flag('CanLeechEnergyShieldOnFullEnergyShield');
    if (canLeechEsOnFull) {
      // PoB1 CalcPerform.lua:926-928 (Trickster Soul Drinker / Ghost Reaver): always leeching ES
      db.setCondition('Leeching', true);
      db.setCondition('LeechingEnergyShield', true);
    }
    const derivedFullEs = Boolean(cfg.rawInputs?.conditionFullEnergyShield);
    if (derivedFullEs) {
      db.setCondition('FullEnergyShield', true);
    }
    // Enmity's Embrace: Damage Penetrates Fire Resistance equal to Overcapped Fire Resistance, up to cap (200%)
    const enmityCap = db.max('OvercappedFireResAsFirePenCap') ?? 0;
    if (enmityCap > 0 && defence.fireResistOvercap > 0) {
      db.addMod({
        name: 'FirePenetration',
        type: 'BASE',
        value: Math.min(enmityCap, Math.floor(defence.fireResistOvercap)),
        flags: 0,
        keywordFlags: 0,
        source: "Unique: Enmity's Embrace",
      });
    }
  }
  if (
    build.game === 'poe1' &&
    derivedLowLife &&
    !cfg.conditionLowLife &&
    db.flag('PainAttunement')
  ) {
    const alreadyHasPa = db
      .calcStat('Damage', ModFlag.Spell)
      .sources.some((s) => s.type === 'MORE' && s.source.toLowerCase().includes('pain attunement'));
    if (!alreadyHasPa) {
      db.addMod({
        name: 'Damage',
        type: 'MORE',
        value: 30,
        flags: ModFlag.Spell,
        keywordFlags: 0,
        source: 'Keystone: Pain Attunement (Low Life)',
      });
    }
  }
  const derivedLowMana =
    Boolean(cfg.rawInputs?.conditionLowMana) ||
    (defence.mana > 0 && defence.manaUnreserved <= defence.mana * lowLifeFrac + 1e-6);
  const derivedFullMana =
    Boolean(cfg.rawInputs?.conditionFullMana) ||
    db.flag('Condition:FullMana');
  db.setCondition('LowMana', derivedLowMana);
  db.setCondition('FullMana', derivedFullMana);
  if (
    build.game === 'poe2' &&
    !cfg.rawInputs?.buffUnholyMight &&
    (db.flag('Poe2UnholyMight') || db.flag('Condition:UnholyMight')) &&
    !(db.flag('Poe2UnholyMight') && derivedLowMana)
  ) {
    db.addMod({
      name: 'DamageGainAsChaos',
      type: 'BASE',
      value: 30,
      flags: 0,
      keywordFlags: 0,
      source: 'Unholy Might',
    });
  }
  if (build.game === 'poe2' && db.flag('ExposureInPresence')) {
    auraEnemyDb.addMod({ name: 'FireExposure', type: 'BASE', value: 20, flags: 0, keywordFlags: 0, source: 'Exposure (Presence)' });
    auraEnemyDb.addMod({ name: 'ColdExposure', type: 'BASE', value: 20, flags: 0, keywordFlags: 0, source: 'Exposure (Presence)' });
    auraEnemyDb.addMod({ name: 'LightningExposure', type: 'BASE', value: 20, flags: 0, keywordFlags: 0, source: 'Exposure (Presence)' });
  }
  if (build.game === 'poe2') {
    if ((auraEnemyDb.max('FireExposure') ?? 0) > 0 || auraEnemyDb.sum('BASE', 'FireExposure') > 0) {
      db.setCondition('EnemyFireExposure', true);
      db.setCondition('EnemyExposure', true);
      auraEnemyDb.setCondition('FireExposure', true);
      auraEnemyDb.setCondition('Exposure', true);
    }
    if ((auraEnemyDb.max('ColdExposure') ?? 0) > 0 || auraEnemyDb.sum('BASE', 'ColdExposure') > 0) {
      db.setCondition('EnemyColdExposure', true);
      db.setCondition('EnemyExposure', true);
      auraEnemyDb.setCondition('ColdExposure', true);
      auraEnemyDb.setCondition('Exposure', true);
    }
    if ((auraEnemyDb.max('LightningExposure') ?? 0) > 0 || auraEnemyDb.sum('BASE', 'LightningExposure') > 0) {
      db.setCondition('EnemyLightningExposure', true);
      db.setCondition('EnemyExposure', true);
      auraEnemyDb.setCondition('LightningExposure', true);
      auraEnemyDb.setCondition('Exposure', true);
    }
  }

  // Post-Pool Build-Enabling Uniques (Crown of Eyes, Iron Fortress, Replica Alberon, HoWA, Brutus, Pillar, Rathpith, Perseverance, Ephemeral Edge, Energy Blade, Doryani's Prototype) & Nightgrip Ward->Chaos
  const activeSkillsListForUniques = build.skills
    .filter((g) => g.enabled)
    .flatMap((g) =>
      g.gems
        .filter((gm) => gm.enabled)
        .map((gm) => {
          const gd = getGemById(build.game, gm.gemId);
          return gd ? { name: gd.name.en, level: gm.level, quality: gm.quality, enabled: true } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    );
  const postUniqueRes: PostPoolUniqueResult = evaluatePostPoolBuildEnablingUniques({
    db,
    equippedItems: nonFlaskEquippedForUniques,
    socketedJewels: allJewelItems,
    str,
    dex,
    int,
    life,
    mana,
    energyShield,
    armour,
    evasion,
    fortified: Boolean(cfg.fortified || db.flag('AlwaysFortified')),
    playerLightningResist: lightningResist,
    activeSkills: activeSkillsListForUniques,
    isTwoHanded: usingTwoHanded,
  });
  if (postUniqueRes.ironFortressBlockBonus > 0) {
    defence.blockChance = Math.min(
      maxAttackBlock,
      Math.max(0, Math.floor(db.calcStat('BlockChance').total + 1e-6)),
    );
  }
  if (postUniqueRes.energyBlade?.active) {
    defence.energyShield = postUniqueRes.energyBlade.postBladeEs;
    db.setStat('EnergyShield', postUniqueRes.energyBlade.postBladeEs);
  }
  const totalWardChaosPct = Math.max(nightgripWardChaosPct, db.sum('BASE', 'WardAsChaosPct'));
  if (totalWardChaosPct > 0 && ward > 0) {
    const wardChaos = Math.floor((ward * totalWardChaosPct) / 100);
    if (wardChaos > 0) {
      db.addMod({
        name: 'ChaosMin',
        type: 'BASE',
        value: wardChaos,
        flags: 0,
        keywordFlags: 0,
        source: 'Unique: Nightgrip',
      });
      db.addMod({
        name: 'ChaosMax',
        type: 'BASE',
        value: wardChaos,
        flags: 0,
        keywordFlags: 0,
        source: 'Unique: Nightgrip',
      });
    }
  }

  // 8. Compute Offence Output for Main Skill Group
  const offence = computeOffence(
    build,
    db,
    defence,
    uniqueGearResult,
    activePower,
    auraMinionDb,
    auraEnemyDb,
    preUniqueRes,
    postUniqueRes,
    expandPoe2LocalRunes,
  );

  // Leech rates are capped by the standard PoE maximum recovery per second.
  const lifeLeechPct = db.sum('BASE', 'LifeLeech');
  if (lifeLeechPct > 0 && offence.hitDps > 0) {
    const rawLifeLeech = offence.hitDps * (lifeLeechPct / 100);
    const capLifeLeech = life * 0.2 * (1 + db.sum('INC', 'LifeMaxLeechRateInc') / 100);
    defence.lifeLeechRate = Math.round(Math.min(rawLifeLeech, capLifeLeech));
  }
  const esLeechPct = db.sum('BASE', 'EsLeech');
  if (esLeechPct > 0 && offence.hitDps > 0) {
    const rawEsLeech = offence.hitDps * (esLeechPct / 100);
    const capEsLeech = energyShield * 0.1 * (1 + db.sum('INC', 'EsMaxLeechRateInc') / 100);
    defence.esLeechRate = Math.round(Math.min(rawEsLeech, capEsLeech));
  }

  // 9. Build transparent Calcs Breakdown rows
  const breakdowns: StatBreakdownRow[] = [
    { label: 'Maximum Life', labelZh: '最大生命', ...lifeEval, total: life },
    { label: 'Maximum Energy Shield', labelZh: '最大能量护盾', ...esEval, total: energyShield },
    ...(ward > 0 ? [{ label: 'Ward', labelZh: '结界', ...wardEval, total: ward }] : []),
    { label: 'Maximum Mana', labelZh: '最大魔力', ...manaEval, total: mana },
    ...(ruleset.supportsSpirit
      ? [{ label: 'Spirit', labelZh: '精魂', ...spiritEval, total: spirit }]
      : []),
    { label: 'Armour', labelZh: '护甲', ...armourEval, total: armour },
    { label: 'Evasion Rating', labelZh: '闪避值', ...evasionEval, total: evasion },
    { label: 'Strength', labelZh: '力量', ...strStat, total: str },
    { label: 'Dexterity', labelZh: '敏捷', ...dexStat, total: dex },
    { label: 'Intelligence', labelZh: '智慧', ...intStat, total: int },
    { label: 'Movement Speed (%)', labelZh: '移动速度 (%)', ...moveSpeedEval, total: defence.movementSpeedPct },
    ...(momPct > 0
      ? [
          {
            label: 'Mind Over Matter (%)',
            labelZh: '心灵升华魔力承伤 (%)',
            ...db.calcStat('DamageTakenFromManaBeforeLife'),
            total: momPct,
          },
        ]
      : []),
  ];

  // Exclude start node and ascendancy nodes from main passive point count (just like PoB)
  const startNodeId = tree.classStartNodeIds[build.classId];
  const ascStartNodeId = getAscendancyStartNodeId(tree, build.ascendancyId);
  const allocatedPoints = build.tree.allocatedNodeIds.filter((id) => {
    if (id === startNodeId) return false;
    const node = tree.nodes[id];
    if (!node) return false;
    return !node.ascendancyId;
  }).length;
  const ascendancyPoints = build.tree.allocatedNodeIds.filter((id) => {
    if (id === ascStartNodeId) return false;
    const node = tree.nodes[id];
    return Boolean(node?.ascendancyId);
  }).length;

  return {
    game: build.game,
    offence,
    defence,
    breakdowns,
    allocatedPoints,
    ascendancyPoints,
    weaponSet1Points: build.tree.weaponSet1NodeIds.length,
    weaponSet2Points: build.tree.weaponSet2NodeIds.length,
    warnings,
  };
}

function weaponTypeToModFlags(weaponType: string | undefined, twoHanded?: boolean): number {
  if (!weaponType) return 0;
  let wf = twoHanded ? ModFlag.Weapon2H : ModFlag.Weapon1H;
  switch (weaponType) {
    case 'Sword':
      wf |= ModFlag.Sword | ModFlag.Melee;
      break;
    case 'Axe':
      wf |= ModFlag.Axe | ModFlag.Melee;
      break;
    case 'Mace':
      wf |= ModFlag.Mace | ModFlag.Melee;
      break;
    case 'Staff':
      wf |= ModFlag.Staff | ModFlag.Melee;
      break;
    case 'Quarterstaff':
      wf |= ModFlag.Quarterstaff | ModFlag.Melee;
      break;
    case 'Talisman':
      wf |= ModFlag.Talisman | ModFlag.Melee;
      break;
    case 'Dagger':
      wf |= ModFlag.Dagger | ModFlag.Melee;
      break;
    case 'Claw':
      wf |= ModFlag.Claw | ModFlag.Melee;
      break;
    case 'Bow':
      wf |= ModFlag.Bow | ModFlag.WeaponRanged;
      break;
    case 'Wand':
      wf |= ModFlag.Wand | ModFlag.WeaponRanged;
      break;
    case 'Crossbow':
      wf |= ModFlag.Crossbow | ModFlag.WeaponRanged;
      break;
    default:
      break;
  }
  return wf;
}

function resolveGemLevelEntry(def: GemDefinition, level: number) {
  if (!def.levelScaling || level === 20) return undefined;
  if (def.levelScaling[level]) return def.levelScaling[level];
  // Interpolate smoothly between the nearest exported level breakpoints (including Lv.20 base)
  const keys = Object.keys(def.levelScaling)
    .map(Number)
    .concat([20])
    .sort((a, b) => a - b);
  let low = keys[0]!;
  let high = keys[keys.length - 1]!;
  for (const k of keys) {
    if (k <= level) low = k;
    if (k >= level) {
      high = k;
      break;
    }
  }
  const getEntry = (lv: number) =>
    lv === 20
      ? {
          baseDamage: def.baseDamage,
          attackDamageMultiplierPct: def.attackDamageMultiplierPct,
          damageEffectivenessPct: def.damageEffectivenessPct,
          manaCost: def.manaCost,
          stats: def.stats,
          compiledMods: def.compiledMods,
          skillData: def.skillData,
        }
      : def.levelScaling![lv];
  const lowE = getEntry(low);
  const highE = getEntry(high);
  if (!lowE || !highE || low === high) return lowE ?? highE;
  const t = (level - low) / (high - low);
  let baseDamage: Partial<Record<DamageType, [number, number]>> | undefined;
  if (lowE.baseDamage && highE.baseDamage) {
    baseDamage = {};
    for (const dt of DAMAGE_TYPES) {
      const a = lowE.baseDamage[dt];
      const b = highE.baseDamage[dt];
      if (a && b) {
        // Exponential interpolation closely tracks PoE's skill damage curve
        const mn = a[0] > 0 && b[0] > 0 ? a[0] * Math.pow(b[0] / a[0], t) : a[0] + (b[0] - a[0]) * t;
        const mx = a[1] > 0 && b[1] > 0 ? a[1] * Math.pow(b[1] / a[1], t) : a[1] + (b[1] - a[1]) * t;
        baseDamage[dt] = [Math.round(mn), Math.round(mx)];
      }
    }
  }
  return {
    baseDamage,
    attackDamageMultiplierPct:
      lowE.attackDamageMultiplierPct !== undefined && highE.attackDamageMultiplierPct !== undefined
        ? Math.round((lowE.attackDamageMultiplierPct + (highE.attackDamageMultiplierPct - lowE.attackDamageMultiplierPct) * t) * 10) / 10
        : lowE.attackDamageMultiplierPct,
    damageEffectivenessPct:
      lowE.damageEffectivenessPct !== undefined && highE.damageEffectivenessPct !== undefined
        ? Math.round((lowE.damageEffectivenessPct + (highE.damageEffectivenessPct - lowE.damageEffectivenessPct) * t) * 10) / 10
        : lowE.damageEffectivenessPct,
    manaCost:
      lowE.manaCost !== undefined && highE.manaCost !== undefined
        ? Math.round(lowE.manaCost + (highE.manaCost - lowE.manaCost) * t)
        : lowE.manaCost,
    stats: t < 0.5 ? lowE.stats : highE.stats,
    compiledMods: t < 0.5 ? lowE.compiledMods : highE.compiledMods,
    skillData: t < 0.5 ? lowE.skillData : highE.skillData,
  };
}

function mergeModDbInto(target: ModDB, source: ModDB): void {
  for (const [, list] of source.entriesByPrefix('')) {
    target.addMods(list);
  }
  const srcCtx = source.getEvalContext();
  const dstCtx = target.getEvalContext();
  target.setEvalContext({
    conditions: { ...dstCtx.conditions, ...srcCtx.conditions },
    multipliers: { ...dstCtx.multipliers, ...srcCtx.multipliers },
    stats: { ...dstCtx.stats, ...srcCtx.stats },
    ...(dstCtx.skillTypes || srcCtx.skillTypes
      ? { skillTypes: { ...(dstCtx.skillTypes ?? {}), ...(srcCtx.skillTypes ?? {}) } }
      : {}),
    ...(srcCtx.socketedIn !== undefined
      ? { socketedIn: srcCtx.socketedIn }
      : dstCtx.socketedIn !== undefined
        ? { socketedIn: dstCtx.socketedIn }
        : {}),
  });
}

function computeOffence(
  build: Build,
  globalDb: ModDB,
  defence: CalcDefenceOutput,
  uniqueGearResult?: SpecialUniqueGearResult,
  activePowerCharges = 0,
  auraMinionDb?: ModDB,
  auraEnemyDb?: ModDB,
  preUniqueRes?: PreStatUniqueResult,
  postUniqueRes?: PostPoolUniqueResult,
  expandPoe2LocalRunes?: (slot: string, item: Item) => Item,
): CalcOffenceOutput {
  const baseBuses = splitModDBIntoActorBuses(globalDb, { game: build.game });
  if (auraMinionDb) mergeModDbInto(baseBuses.minionDb, auraMinionDb);
  if (auraEnemyDb) mergeModDbInto(baseBuses.enemyDb, auraEnemyDb);
  const skitterOrBaseShockOverride = Math.max(
    0,
    globalDb.sum('BASE', 'ShockOverride'),
    globalDb.sum('BASE', 'ShockMinimum'),
  );
  if (build.config.enemyShocked || skitterOrBaseShockOverride > 0) {
    const defaultShock = build.game === 'poe2' ? 20 : 15;
    const shockEffMult =
      Math.max(
        0,
        1 +
          globalDb.sum(
            'INC',
            build.game === 'poe2'
              ? ['ShockEffect', 'EnemyShockEffect', 'EnemyShockMagnitude', 'AilmentMagnitude', 'ShockMagnitude']
              : ['ShockEffect', 'EnemyShockEffect'],
          ) /
            100,
      ) *
      globalDb.more(
        build.game === 'poe2'
          ? ['ShockEffect', 'EnemyShockEffect', 'EnemyShockMagnitude', 'AilmentMagnitude', 'ShockMagnitude']
          : ['ShockEffect', 'EnemyShockEffect'],
      );
    const scaledDefaultShock = build.config.enemyShocked
      ? build.game === 'poe2'
        ? Math.max(build.config.shockValue, Math.floor(defaultShock * shockEffMult + 1e-9))
        : build.config.shockValue > 0
          ? build.config.shockValue
          : Math.floor(defaultShock * shockEffMult + 1e-9)
      : 0;
    const rawShockVal = Math.max(scaledDefaultShock, skitterOrBaseShockOverride);
    const shockStacks = Math.max(1, Number(build.config.rawInputs?.ShockStacks ?? 1));
    const maxShock =
      build.game === 'poe2' || shockStacks > 1
        ? 100
        : Math.min(100, 50 + Math.max(0, globalDb.sum('BASE', ['ShockMax', 'MaximumShock'])));
    if (rawShockVal > 0) {
      const effShockPct = Math.max(0, Math.min(maxShock, rawShockVal * shockStacks));
      baseBuses.playerDb.setCondition('EnemyShocked', true);
      baseBuses.enemyDb.setCondition('Shocked', true);
      baseBuses.enemyDb.setMultiplier('ShockEffect', effShockPct);
      baseBuses.playerDb.setMultiplier('EnemyShockEffect', effShockPct);
      baseBuses.enemyDb.addMod({
        name: 'DamageTaken',
        type: 'INC',
        value: effShockPct,
        flags: 0,
        keywordFlags: 0,
        source: 'Shock',
      });
      // Replica Heatshiver: Gain X% of Lightning Damage as Extra Cold Damage per Y% Shock on Enemy
      const repHsPerShock = baseBuses.playerDb.sum('BASE', 'ReplicaHeatshiverGainPerShock');
      if (build.game === 'poe1' && repHsPerShock > 0 && effShockPct > 0) {
        const gainCold = Math.floor(effShockPct * repHsPerShock + 1e-9);
        if (gainCold > 0) {
          baseBuses.playerDb.addMod({
            name: 'LightningDamageGainAsCold',
            type: 'BASE',
            value: gainCold,
            flags: 0,
            keywordFlags: 0,
            source: `Unique: Replica Heatshiver (${effShockPct}% Shock)`,
          });
        }
      }
    }
  }

  const squireEquippedList = getActiveEquippedItems(build);
  const squireBridge = collectSquireSupportsForMainHand(
    build.skills,
    squireEquippedList,
    (id) => getGemById(build.game, id),
  );

  // PoB always evaluates the selected mainSocketGroup for main skill offence even if its group enabled toggle is false
  let mainGroup =
    build.skills.find((g) => g.id === build.mainSkillGroupId) ??
    build.skills.find((g) => g.enabled);

  let mainResult = computeGroupOffence(
    build,
    baseBuses,
    defence,
    mainGroup,
    uniqueGearResult,
    activePowerCharges,
    squireBridge.bridgedSupports,
    preUniqueRes,
    postUniqueRes,
    expandPoe2LocalRunes,
  );

  if (mainResult.offence.skillType === 'None') {
    for (const candidateGrp of build.skills) {
      if (!candidateGrp.enabled || candidateGrp === mainGroup) continue;
      if (
        build.game === 'poe2' &&
        candidateGrp.weaponSets &&
        !candidateGrp.weaponSets.includes(build.activeWeaponSet)
      ) {
        continue;
      }
      const candidateRes = computeGroupOffence(
        build,
        baseBuses,
        defence,
        candidateGrp,
        uniqueGearResult,
        activePowerCharges,
        squireBridge.bridgedSupports,
        preUniqueRes,
        postUniqueRes,
        expandPoe2LocalRunes,
      );
      if (candidateRes.offence.skillType !== 'None') {
        mainGroup = candidateGrp;
        mainResult = candidateRes;
        break;
      }
    }
  }

  // PoB-compatible Full DPS aggregation across all enabled `includeInFullDps` skill groups
  const fullDpsGroups = build.skills.filter(
    (g) =>
      g.enabled &&
      g.includeInFullDps &&
      (build.game !== 'poe2' || !g.weaponSets || g.weaponSets.includes(build.activeWeaponSet)),
  );
  if (fullDpsGroups.length > 0) {
    let sumHitAndStackDps = 0;
    let maxIgnite = 0;
    let maxBleed = 0;
    const breakdown: NonNullable<CalcOffenceOutput['fullDpsBreakdown']> = [];
    for (const grp of fullDpsGroups) {
      const res =
        grp === mainGroup
          ? mainResult
          : computeGroupOffence(
              build,
              baseBuses,
              defence,
              grp,
              uniqueGearResult,
              activePowerCharges,
              squireBridge.bridgedSupports,
              preUniqueRes,
              postUniqueRes,
              expandPoe2LocalRunes,
            );
      if (res.offence.skillType === 'None') continue;
      const count = Math.max(1, res.activeCount);
      const groupHit =
        res.groupStackingDps !== undefined
          ? res.groupStackingDps
          : (res.offence.hitDps + (res.offence.impaleDps ?? 0) + res.offence.poisonDps) * count;
      sumHitAndStackDps += groupHit;
      if (res.offence.igniteDps > maxIgnite) maxIgnite = res.offence.igniteDps;
      if (res.offence.bleedDps > maxBleed) maxBleed = res.offence.bleedDps;
      const contribDps =
        Math.round((groupHit + res.offence.igniteDps + res.offence.bleedDps) * 100) / 100;
      breakdown.push({
        groupId: grp.id,
        label: grp.label,
        skillName: res.offence.mainSkillName,
        count,
        dps: contribDps,
      });
    }
    if (breakdown.length > 0) {
      mainResult.offence.fullDps =
        Math.round((sumHitAndStackDps + maxIgnite + maxBleed) * 100) / 100;
      mainResult.offence.fullDpsBreakdown = breakdown;
    }
  }

  return mainResult.offence;
}

function computeGroupOffence(
  build: Build,
  baseBuses: ActorModBuses,
  _defence: CalcDefenceOutput,
  mainGroup: Build['skills'][number] | undefined,
  uniqueGearResult?: SpecialUniqueGearResult,
  activePowerCharges = 0,
  squireBridgedSupports: GemInstance[] = [],
  preUniqueRes?: PreStatUniqueResult,
  postUniqueRes?: PostPoolUniqueResult,
  expandPoe2LocalRunes?: (slot: string, item: Item) => Item,
): { offence: CalcOffenceOutput; activeCount: number; groupStackingDps?: number } {
  const emptyRanges: Record<DamageType, DamageRange> = {
    Physical: { min: 0, max: 0, average: 0 },
    Lightning: { min: 0, max: 0, average: 0 },
    Cold: { min: 0, max: 0, average: 0 },
    Fire: { min: 0, max: 0, average: 0 },
    Chaos: { min: 0, max: 0, average: 0 },
  };

  if (!mainGroup) {
    return {
      activeCount: 1,
      offence: {
        mainSkillName: { en: 'No Active Skill', zh: '未选择主动技能' },
        skillType: 'None',
        damageByType: emptyRanges,
        averageHit: 0,
        speed: 0,
        critChance: 0,
        critMultiplier: 150,
        hitChance: 100,
        effectiveCritMultiplier: 1,
        hitDps: 0,
        igniteDps: 0,
        bleedDps: 0,
        poisonDps: 0,
        totalDps: 0,
        manaCost: 0,
        manaPerSecond: 0,
      },
    };
  }

  let activeDef: GemDefinition | undefined;
  let activeBaseLevel = 20;
  let activeLevel = 20;
  let activeQuality = 0;
  let activeCount = 1;
  const skillDb = baseBuses.playerDb.clone();
  const groupEnemyDb = baseBuses.enemyDb.clone();
  const groupMinionDb = baseBuses.minionDb.clone();

  // Resolve slot item for PoE 1 matching socket quality bonus (`CalcSetup.lua:19-31`), Dialla's Malefaction,
  // `+N to Level/Quality of Socketed Gems`, and item-granted `Socketed Gems are Supported by Level X ...` pseudo-links
  const slotItem =
    mainGroup.slot && build.equipped[mainGroup.slot]
      ? build.items[build.equipped[mainGroup.slot]!]
      : undefined;
  const socketedRules = slotItem
    ? parseSocketedGemBonuses([...slotItem.implicits, ...slotItem.explicits])
    : [];
  const slotSocketColors: string[] = [];
  let slotAlwaysMatchesSocketColor = false;
  let isDiallasMalefaction = false;
  if (build.game === 'poe1' && slotItem) {
    isDiallasMalefaction = slotItem.name.trim().toLowerCase() === "dialla's malefaction";
    if (
      isDiallasMalefaction ||
      [...slotItem.implicits, ...slotItem.explicits].some((l) =>
        /Gems can be Socketed in this Item ignoring Socket Colour/i.test(l),
      )
    ) {
      slotAlwaysMatchesSocketColor = true;
    }
    if (slotItem.sockets) {
      for (const ch of slotItem.sockets.toUpperCase()) {
        if (ch === 'R' || ch === 'G' || ch === 'B' || ch === 'W' || ch === 'A') {
          slotSocketColors.push(ch);
        }
      }
    } else {
      // Official PoB1 Item.lua:1533: items without explicit Sockets default to `socketLimit` sockets of dominant base colour
      let defaultCol: string | null = null;
      if (slotItem.armourStats) {
        const a = slotItem.armourStats.armour ?? 0;
        const e = slotItem.armourStats.evasion ?? 0;
        const es = slotItem.armourStats.energyShield ?? 0;
        if (a >= e && a >= es && a > 0) defaultCol = 'R';
        else if (e >= a && e >= es && e > 0) defaultCol = 'G';
        else if (es > 0) defaultCol = 'B';
      } else if (slotItem.weaponStats) {
        const wt = slotItem.weaponStats.weaponType;
        if (wt === 'Wand' || wt === 'Staff') defaultCol = 'B';
        else if (wt === 'Bow' || wt === 'Claw' || wt === 'Dagger') defaultCol = 'G';
        else defaultCol = 'R';
      }
      if (defaultCol) {
        for (let i = 0; i < 6; i++) slotSocketColors.push(defaultCol);
      }
    }
  }
  const gemSocketColorByInstance = new Map<string, string>();
  if (build.game === 'poe1' && slotSocketColors.length > 0) {
    let sockCursor = 0;
    for (const gm of mainGroup.gems) {
      if (gm.fromItem) continue;
      const col = slotSocketColors[sockCursor];
      if (col) gemSocketColorByInstance.set(gm.instanceId, col);
      sockCursor++;
    }
  }
  const consumeMatchingSocketBonus = (
    def: GemDefinition,
    gemInstanceId?: string,
  ): { qualBonus: number; diallaLevelBonus: number; diallaQualBonus: number } => {
    if (build.game !== 'poe1' || !slotItem || slotSocketColors.length === 0) {
      return { qualBonus: 0, diallaLevelBonus: 0, diallaQualBonus: 0 };
    }
    const colorKey = def.color === 'red' ? 'R' : def.color === 'green' ? 'G' : def.color === 'blue' ? 'B' : null;
    const sockCol = gemInstanceId ? gemSocketColorByInstance.get(gemInstanceId) : undefined;
    // Official PoB1 CalcSetup.lua:19-31: matching socket quality ONLY on explicit R/G/B match (NEVER White unless colourAlwaysMatches)
    let qualBonus = 0;
    if (slotAlwaysMatchesSocketColor || (colorKey && sockCol === colorKey)) {
      qualBonus = 10;
    }
    let diallaLevelBonus = 0;
    let diallaQualBonus = 0;
    if (isDiallasMalefaction) {
      if (sockCol === 'R' || (!sockCol && colorKey === 'R')) {
        diallaLevelBonus = 2;
      } else if (sockCol === 'G' || (!sockCol && colorKey === 'G')) {
        diallaQualBonus = 30;
      }
    }
    return { qualBonus, diallaLevelBonus, diallaQualBonus };
  };

  const applyGemQualityStats = (
    def: GemDefinition,
    rawQuality: number,
    sourcePrefix: string,
    extraSocketBonus = 0,
  ) => {
    const effectiveQuality = rawQuality + extraSocketBonus;
    if (effectiveQuality <= 0) return effectiveQuality;
    if (def.qualityCompiledMods && def.qualityCompiledMods.length > 0) {
      const baseCmods = def.compiledMods ?? [];
      const scaledQMods = def.qualityCompiledMods
        .map((qm) => {
          if (typeof qm.value === 'number') {
            const v = Math.trunc(qm.value * effectiveQuality + Math.sign(qm.value) * 1e-9);
            if (v === 0) return null;
            // Upstream PoB sums qualityStats into matching same-gem constantStats/levelStats before converting to MORE
            // (e.g. Viper Strike of the Mamba: 200% + 60% = 260% MORE = 3.60x, NOT 3.00 * 1.60 = 4.80x!)
            if (
              build.game === 'poe1' &&
              sourcePrefix === 'Skill' &&
              qm.type === 'MORE' &&
              v > 0 &&
              (!qm.tags || qm.tags.length === 0)
            ) {
              const matchingBase = baseCmods.find(
                (bm) =>
                  bm.name === qm.name &&
                  bm.type === 'MORE' &&
                  typeof bm.value === 'number' &&
                  bm.value > 0 &&
                  (bm.flags ?? 0) === (qm.flags ?? 0) &&
                  (bm.keywordFlags ?? 0) === (qm.keywordFlags ?? 0) &&
                  (!bm.tags || bm.tags.length === 0),
              );
              if (matchingBase && typeof matchingBase.value === 'number') {
                const effRelMore = ((100 + matchingBase.value + v) / (100 + matchingBase.value) - 1) * 100;
                return { ...qm, value: effRelMore };
              }
            }
            return { ...qm, value: v };
          }
          return qm;
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);
      if (scaledQMods.length > 0) {
        injectCompiledGemMods(
          skillDb,
          groupEnemyDb,
          groupMinionDb,
          scaledQMods,
          `${sourcePrefix}: ${def.name.en} (Q${effectiveQuality})`,
          { game: build.game },
        );
      }
    } else if (def.qualityStats) {
      for (const qs of def.qualityStats) {
        const val = Math.trunc(effectiveQuality * qs.perQuality);
        if (val !== 0) {
          const line = qs.template.replace('{v}', String(val));
          routeModsToActorBuses(
            { playerDb: skillDb, enemyDb: groupEnemyDb, minionDb: groupMinionDb },
            parseModLines([line], `${sourcePrefix}: ${def.name.en} (Q${effectiveQuality})`),
            { game: build.game },
          );
        }
      }
    } else if (build.game === 'poe1' && def.category === 'active' && rawQuality > 0 && !(def.compiledMods && def.compiledMods.length > 0)) {
      // Fallback for uncurated PoE 1 active gems without explicit qualityStats
      const val = Math.trunc(rawQuality * 0.5);
      if (val > 0) {
        skillDb.addMod({
          name: 'Damage',
          type: 'INC',
          value: val,
          flags: 0,
          keywordFlags: 0,
          source: `${def.name.en} Quality`,
        });
      }
    }
    return effectiveQuality;
  };

  const activeCandidates: Array<{ inst: GemInstance; def: GemDefinition; fromVaalGem?: boolean }> = [];
  const supportCandidates: Array<{ gem: GemDefinition; instance: GemInstance; enabled: boolean; preScaledBySquire?: boolean }> = [];

  for (const gemInst of mainGroup.gems) {
    if (!gemInst.enabled) continue;
    const def = getGemById(build.game, gemInst.gemId);
    if (!def) continue;
    if (def.category === 'active' && !def.isAuraOrBuff) {
      if (build.game === 'poe1' && /^Vaal\s+/i.test(def.name.en)) {
        // In PoB 1 Data/Gems.lua, Vaal gems expose [1] Vaal <Skill> (enableGlobal1) and [2] Base <Skill> (enableGlobal2)
        // Keep `baseDef` free of `'vaal'` so Multistrike / Spell Echo / Warcry Exertion are NOT falsely excluded!
        const baseName = def.name.en
          .replace(/^Vaal\s+Domination(?=\s+of\b|$)/i, 'Dominating Blow')
          .replace(/^Vaal\s+/i, '')
          .trim();
        const slug = `poe1_${baseName.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
        const baseDef =
          getGemById('poe1', slug) ?? resolveGemFromPobRef('poe1', { nameSpec: baseName });
        if (baseDef && baseDef.id !== def.id) {
          if (gemInst.enableGlobal1 !== false) {
            activeCandidates.push({ inst: gemInst, def, fromVaalGem: true });
          }
          if (gemInst.enableGlobal2 !== false) {
            activeCandidates.push({ inst: gemInst, def: baseDef, fromVaalGem: true });
          }
          if (gemInst.enableGlobal1 === false && gemInst.enableGlobal2 === false) {
            activeCandidates.push({ inst: gemInst, def: baseDef, fromVaalGem: true });
          }
          continue;
        }
      }
      activeCandidates.push({ inst: gemInst, def });
    } else if (def.category === 'support') {
      supportCandidates.push({ gem: def, instance: gemInst, enabled: true });
    }
  }
  // Merge The Squire off-hand supports into Weapon 1 skill groups
  if (mainGroup.slot === 'Weapon 1' && squireBridgedSupports.length > 0) {
    for (const bridgedInst of squireBridgedSupports) {
      const def = getGemById(build.game, bridgedInst.gemId);
      if (def && def.category === 'support') {
        supportCandidates.push({
          gem: def,
          instance: bridgedInst,
          enabled: true,
          preScaledBySquire: true,
        });
      }
    }
  }
  // Instantiate PoE 1 item-granted pseudo-link supports (`Socketed Gems are Supported by Level X <Support>`)
  if (build.game === 'poe1' && slotItem) {
    const existingSupIds = new Set(supportCandidates.map((s) => s.gem.id));
    for (const rawLine of [...slotItem.implicits, ...slotItem.explicits]) {
      const clean = rawLine.replace(/\{[^}]*\}/g, '').trim();
      const mSup = clean.match(/^Socketed Gems are Supported by Level (\d+) (.+)$/i);
      if (!mSup) continue;
      const supLevel = Math.max(1, Math.min(40, Number(mSup[1])));
      const supName = mSup[2]!.trim().replace(/\s+Support$/i, '');
      const supDef = resolveGemFromPobRef('poe1', { nameSpec: supName });
      if (supDef && supDef.category === 'support' && !existingSupIds.has(supDef.id)) {
        existingSupIds.add(supDef.id);
        supportCandidates.push({
          gem: supDef,
          instance: {
            instanceId: `item_sup_${slotItem.id}_${supDef.id}`,
            gemId: supDef.id,
            level: supLevel,
            quality: 0,
            enabled: true,
            fromItem: true,
          },
          enabled: true,
          preScaledBySquire: true,
        });
      }
    }
  }

  // Detect PoE 2 Meta Gem wrapper groups (`Cast on Critical`, `Cast on Shock`, `Cast on Freeze`, `Elemental Invocation`, etc.)
  const poe2MetaResolution =
    build.game === 'poe2'
      ? resolvePoe2MetaGemGroup(mainGroup, (id) => getGemById(build.game, id))
      : null;

  let triggerAttackDef: GemDefinition | undefined;
  let chosenActiveInst: GemInstance | undefined;
  let resolvedPartStats: ReturnType<typeof resolveActiveSkillPartAndStats> | undefined;
  const compatibleSupportNames = new Set<string>();
  let effectiveSkillTypeSet = new Set<string>();

  const effectiveActiveCandidates =
    poe2MetaResolution?.isMetaGroup && poe2MetaResolution.payloadActives.length > 0
      ? poe2MetaResolution.payloadActives
      : activeCandidates;

  if (effectiveActiveCandidates.length > 0) {
    const pickIdx = Math.max(
      0,
      Math.min(effectiveActiveCandidates.length - 1, (mainGroup.mainActiveSkillIndex ?? 1) - 1),
    );
    const chosen = effectiveActiveCandidates[pickIdx]!;
    activeDef = chosen.def;
    chosenActiveInst = chosen.inst;
    activeBaseLevel = chosen.inst.level;

    // Two-pass PoB RPN SkillType compatibility filtering across linked supports.
    // Merge PoE 2 Meta wrapper `addedSkillTypes` (e.g. Spell Totem -> Totem/UsedByTotem/SummonsTotem)
    // BEFORE compatibility filtering so totem/meta supports like Urgent Totems III are accepted.
    const activeDefForSupportCompat =
      poe2MetaResolution?.addedSkillTypes && poe2MetaResolution.addedSkillTypes.length > 0
        ? {
            ...activeDef,
            skillTypes: [
              ...new Set([...(activeDef.skillTypes ?? []), ...poe2MetaResolution.addedSkillTypes]),
            ],
          }
        : activeDef;
    const supportResolution = resolveCompatibleSupports(activeDefForSupportCompat, supportCandidates);
    effectiveSkillTypeSet = supportResolution.effectiveSkillTypes;
    if (poe2MetaResolution?.addedSkillTypes) {
      for (const st of poe2MetaResolution.addedSkillTypes) {
        effectiveSkillTypeSet.add(st.toLowerCase());
      }
    }
    if (poe2MetaResolution?.metaSupportMods && poe2MetaResolution.metaSupportMods.length > 0) {
      skillDb.addMods(poe2MetaResolution.metaSupportMods);
    }
    // PoE 2 Meta / Trigger-socketed spells (Cast on Critical, Cast on Elemental Ailment, Spellslinger, Invocations, etc.)
    // MUST receive SkillType `Triggered` and Condition `SkillIsTriggered` so "Triggered Spells deal X% increased Spell Damage" applies!
    if (build.game === 'poe2') {
      const activeLower = activeDef.name.en.trim().toLowerCase();
      const POE2_META_TRIGGERS = new Set([
        'cast on critical',
        'cast on critical strike',
        'cast on elemental ailment',
        'cast on freeze',
        'cast on shock',
        'cast on ignite',
        'cast on minion death',
        'cast on dodge',
        'spellslinger',
        'barrier invocation',
        'elemental invocation',
        "reaper's invocation",
      ]);
      const hasMetaTriggerInGroup =
        !POE2_META_TRIGGERS.has(activeLower) &&
        mainGroup.gems.some((gm) => {
          if (!gm.enabled || gm === chosen.inst) return false;
          const gd = getGemById('poe2', gm.gemId);
          return Boolean(gd && POE2_META_TRIGGERS.has(gd.name.en.trim().toLowerCase()));
        });
      if (hasMetaTriggerInGroup || effectiveSkillTypeSet.has('triggered') || effectiveSkillTypeSet.has('inbuilttrigger')) {
        effectiveSkillTypeSet.add('triggered');
        skillDb.setCondition('SkillIsTriggered', true);
      }
    }

    // Populate SkillType context on skillDb & groupMinionDb so SkillType-tagged cmods evaluate accurately
    const skillTypeMap: Record<string, boolean> = {};
    for (const st of effectiveSkillTypeSet) {
      skillTypeMap[st] = true;
      if (st === 'triggered') skillTypeMap.Triggered = true;
    }
    for (const st of activeDef.skillTypes ?? []) {
      skillTypeMap[st] = true;
    }
    for (const st of poe2MetaResolution?.addedSkillTypes ?? []) {
      skillTypeMap[st] = true;
    }
    if ((activeDef.modFlags & ModFlag.Attack) !== 0) {
      skillTypeMap['Attack'] = true;
      skillTypeMap['attack'] = true;
    }

    // PoE 1 slot-scoped `Socketed Gems / Socketed Skills / Socketed Vaal Skills` modifiers
    // (Elder/Shaper/Essence pseudo-links, Triumvirate Authority, etc.)
    if (build.game === 'poe1' && slotItem && !chosen.inst.fromItem) {
      const isVaalActive =
        Boolean((chosen as { fromVaalGem?: boolean }).fromVaalGem && /^Vaal\s+/i.test(activeDef.name.en)) ||
        effectiveSkillTypeSet.has('vaal');
      const slotModSrc = `Item (${mainGroup.slot ?? 'Socketed'}): ${slotItem.name}`;
      for (const rawLine of [...slotItem.implicits, ...slotItem.explicits]) {
        const line = rawLine.replace(/^\{[^}]*\}/g, '').trim();
        let m = line.match(
          /^Socketed (?:(Vaal) )?(?:Gems|Skills) deal (\d+)% (more|less) (Attack |Spell |Elemental |Physical |Chaos |Fire |Cold |Lightning |Area |Projectile )?Damage( over Time)?$/i,
        );
        if (m) {
          if (m[1] && !isVaalActive) continue;
          const val = (m[3]!.toLowerCase() === 'less' ? -1 : 1) * Number(m[2]);
          const qual = (m[4] ?? '').trim().toLowerCase();
          const isDot = Boolean(m[5]);
          let statName = 'Damage';
          let mFlags = isDot ? ModFlag.Dot : 0;
          if (qual === 'attack') mFlags |= ModFlag.Attack;
          else if (qual === 'spell') mFlags |= ModFlag.Spell;
          else if (qual === 'area') mFlags |= ModFlag.Area;
          else if (qual === 'projectile') mFlags |= ModFlag.Projectile;
          else if (qual === 'elemental') statName = 'ElementalDamage';
          else if (qual === 'physical') statName = 'PhysicalDamage';
          else if (qual === 'chaos') statName = 'ChaosDamage';
          else if (qual === 'fire') statName = 'FireDamage';
          else if (qual === 'cold') statName = 'ColdDamage';
          else if (qual === 'lightning') statName = 'LightningDamage';
          skillDb.addMod({ name: statName, type: 'MORE', value: val, flags: mFlags, keywordFlags: 0, source: slotModSrc });
          continue;
        }
        m = line.match(/^Socketed (?:Gems|Skills) have (\d+)% (more|less) (Attack and Cast|Attack|Cast) Speed$/i);
        if (m) {
          const val = (m[2]!.toLowerCase() === 'less' ? -1 : 1) * Number(m[1]);
          const kind = m[3]!.toLowerCase();
          if (kind === 'attack and cast' || kind === 'attack') {
            skillDb.addMod({ name: 'Speed', type: 'MORE', value: val, flags: ModFlag.Attack, keywordFlags: 0, source: slotModSrc });
          }
          if (kind === 'attack and cast' || kind === 'cast') {
            skillDb.addMod({ name: 'Speed', type: 'MORE', value: val, flags: ModFlag.Spell, keywordFlags: 0, source: slotModSrc });
          }
          continue;
        }
        m = line.match(/^Socketed (?:Gems|Skills) have \+(\d+(?:\.\d+)?)% to Critical Strike Chance$/i);
        if (m) {
          skillDb.addMod({ name: 'BaseCritChance', type: 'BASE', value: Number(m[1]), flags: 0, keywordFlags: 0, source: slotModSrc });
          continue;
        }
        m = line.match(/^Socketed (?:Gems|Skills) have \+(\d+)% to Critical Strike Multiplier$/i);
        if (m) {
          skillDb.addMod({ name: 'CritMultiplier', type: 'BASE', value: Number(m[1]), flags: 0, keywordFlags: 0, source: slotModSrc });
          continue;
        }
        m = line.match(/^Socketed (?:Attack |Spell )?(?:Gems|Skills) have (\d+)% increased (Attack Speed|Cast Speed|Critical Strike Chance|Area of Effect|Damage)$/i);
        if (m) {
          const val = Number(m[1]);
          const target = m[2]!.toLowerCase();
          if (target === 'attack speed') {
            skillDb.addMod({ name: 'Speed', type: 'INC', value: val, flags: ModFlag.Attack, keywordFlags: 0, source: slotModSrc });
          } else if (target === 'cast speed') {
            skillDb.addMod({ name: 'Speed', type: 'INC', value: val, flags: ModFlag.Spell, keywordFlags: 0, source: slotModSrc });
          } else if (target === 'critical strike chance') {
            skillDb.addMod({ name: 'CritChance', type: 'INC', value: val, flags: 0, keywordFlags: 0, source: slotModSrc });
          } else if (target === 'area of effect') {
            skillDb.addMod({ name: 'AreaOfEffect', type: 'INC', value: val, flags: 0, keywordFlags: 0, source: slotModSrc });
          } else {
            skillDb.addMod({ name: 'Damage', type: 'INC', value: val, flags: 0, keywordFlags: 0, source: slotModSrc });
          }
          continue;
        }
        m = line.match(/^Socketed (?:Vaal )?(?:Gems|Skills) (?:gain|have) (\d+)% increased Damage$/i);
        if (m) {
          if (/^Socketed Vaal/i.test(line) && !isVaalActive) continue;
          skillDb.addMod({ name: 'Damage', type: 'INC', value: Number(m[1]), flags: 0, keywordFlags: 0, source: slotModSrc });
          continue;
        }
        if (/^Socketed (?:Gems|Skills) deal Double Damage$/i.test(line)) {
          skillDb.addMod({ name: 'DoubleDamageChance', type: 'BASE', value: 100, flags: 0, keywordFlags: 0, source: slotModSrc });
        }
      }
    }
    const existingCtx = skillDb.getEvalContext();
    const enrichedCtx = {
      ...existingCtx,
      skillTypes: { ...(existingCtx.skillTypes ?? {}), ...skillTypeMap },
      ...(mainGroup.slot ? { socketedIn: mainGroup.slot } : {}),
    };
    skillDb.setEvalContext(enrichedCtx);
    groupMinionDb.setEvalContext(enrichedCtx);

    let empowerLevelBonus = 0;
    let enhanceQualityBonus = 0;
    let awakenedSupActiveLevelBonus = 0;
    let spellTotemEffLevel: number | undefined;
    const gemcraftNonExceptionalBonus = Math.round(
      baseBuses.playerDb.sum('BASE', 'GemLevelSup:non-exceptional'),
    );

    for (const supEntry of supportResolution.compatible) {
      const def = supEntry.gem as GemDefinition;
      const gemInst = supEntry.instance;
      const isSquireBridged = Boolean(
        (supEntry as { preScaledBySquire?: boolean }).preScaledBySquire,
      );
      const supSock = isSquireBridged || gemInst.fromItem
        ? { qualBonus: 0, diallaLevelBonus: 0, diallaQualBonus: 0 }
        : consumeMatchingSocketBonus(def, gemInst.instanceId);
      const supIsCorrupted = Boolean(
        gemInst.level >= 21 ||
          gemInst.quality >= 21 ||
          def.tags.some((t) => t.toLowerCase() === 'vaal') ||
          (/^awakened\s+/i.test(def.name.en) && gemInst.level >= 6),
      );
      const supBonus = isSquireBridged
        ? resolveGemBonuses(def, baseBuses.playerDb, [], { isCorrupted: supIsCorrupted })
        : resolveGemBonuses(def, baseBuses.playerDb, socketedRules, { isCorrupted: supIsCorrupted });
      const lower = def.name.en.trim().toLowerCase().replace(/\s+support$/i, '');
      const isExceptionalSupport =
        lower === 'empower' ||
        lower === 'awakened empower' ||
        lower === 'enhance' ||
        lower === 'awakened enhance' ||
        lower === 'enlighten' ||
        lower === 'awakened enlighten';
      const extraNonExc = !isExceptionalSupport ? gemcraftNonExceptionalBonus : 0;
      const extraCritSupLv =
        build.game === 'poe1' && def.tags.some((t) => t.toLowerCase() === 'critical')
          ? Math.round(baseBuses.playerDb.sum('BASE', 'GemLevelSup:critical'))
          : 0;
      const effSupLevel = Math.min(
        40,
        Math.max(1, gemInst.level + supBonus.levelBonus + extraNonExc + extraCritSupLv + supSock.diallaLevelBonus),
      );
      const effSupQuality = gemInst.quality + supBonus.qualityBonus + supSock.diallaQualBonus;
      compatibleSupportNames.add(lower);
      if (lower === 'spell totem' || lower === 'ballista totem') {
        spellTotemEffLevel = effSupLevel;
      }

      // PoE 2 Support Gem Level & Quality grants (Cold/Lightning/Fire/Chaos/Physical Mastery +1, Uhtred's Omen +2, Dialla's Desire +1/+5%Q, etc.)
      if (build.game === 'poe2') {
        const supLvCmods = resolveGemLevelEntry(def, effSupLevel)?.compiledMods ?? def.compiledMods ?? [];
        const activeTagsLowerForSup = new Set(chosen.def.tags.map((t) => t.toLowerCase()));
        for (const cm of supLvCmods) {
          if (cm.type !== 'BASE' || typeof cm.value !== 'number' || cm.value === 0) continue;
          if (cm.name === 'SupportedGemLevel') {
            awakenedSupActiveLevelBonus += cm.value;
          } else if (cm.name === 'SupportedGemQuality') {
            enhanceQualityBonus += cm.value;
          } else if (cm.name.startsWith('SupportedGemLevel:')) {
            const reqTag = cm.name.slice('SupportedGemLevel:'.length).toLowerCase();
            if (
              activeTagsLowerForSup.has(reqTag) ||
              (reqTag === 'cold' && (chosen.def.keywordFlags & KeywordFlag.Cold) !== 0) ||
              (reqTag === 'fire' && (chosen.def.keywordFlags & KeywordFlag.Fire) !== 0) ||
              (reqTag === 'lightning' && (chosen.def.keywordFlags & KeywordFlag.Lightning) !== 0) ||
              (reqTag === 'chaos' && (chosen.def.keywordFlags & KeywordFlag.Chaos) !== 0) ||
              (reqTag === 'physical' && (chosen.def.keywordFlags & KeywordFlag.Physical) !== 0)
            ) {
              awakenedSupActiveLevelBonus += cm.value;
            }
          }
        }
      }
      if (build.game === 'poe1' && effSupLevel >= 5) {
        const activeTagsLower = new Set(chosen.def.tags.map((t) => t.toLowerCase()));
        const awkBonus = effSupLevel >= 10 ? 2 : 1;
        if (lower === 'awakened added fire damage' && (activeTagsLower.has('fire') || (chosen.def.keywordFlags & KeywordFlag.Fire) !== 0)) {
          awakenedSupActiveLevelBonus += awkBonus;
        } else if (lower === 'awakened added cold damage' && (activeTagsLower.has('cold') || (chosen.def.keywordFlags & KeywordFlag.Cold) !== 0)) {
          awakenedSupActiveLevelBonus += awkBonus;
        } else if (lower === 'awakened added lightning damage' && (activeTagsLower.has('lightning') || (chosen.def.keywordFlags & KeywordFlag.Lightning) !== 0)) {
          awakenedSupActiveLevelBonus += awkBonus;
        } else if (
          (lower === 'awakened added chaos damage' || lower === 'awakened void manipulation') &&
          (activeTagsLower.has('chaos') || (chosen.def.keywordFlags & KeywordFlag.Chaos) !== 0)
        ) {
          awakenedSupActiveLevelBonus += awkBonus;
        }
      }
      if (build.game === 'poe1' && lower === 'arcane surge') {
        skillDb.setCondition('AffectedByArcaneSurge', true);
      }
      if (build.game === 'poe1' && lower === 'invert the rules') {
        const INVERT_RULES_TABLE = [35, 38, 41, 44, 45, 47, 48, 50, 51, 53, 54, 56, 57, 59, 60];
        const invChance = INVERT_RULES_TABLE[Math.min(INVERT_RULES_TABLE.length - 1, Math.max(0, effSupLevel - 1))] ?? 35;
        skillDb.addMod({
          name: 'InvertEleResChance',
          type: 'BASE',
          value: invChance,
          flags: 0,
          keywordFlags: 0,
          source: `Support: Invert the Rules (Lv.${effSupLevel})`,
        });
        applyGemQualityStats(def, effSupQuality, 'Support', supSock.qualBonus);
        continue;
      }
      if (build.game === 'poe1' && lower === 'unholy trinity') {
        // PoB1 `sup_dex.lua:4307`: 6/7/8% MORE Damage per 10 lowest Unholy Resonance (`div: 10`)
        // plus 90/95/100% Chance to Ignore Chaos/Lightning Res & Enemy PDR while >=25 Unholy Resonance.
        const morePer10 = Math.min(12, Math.max(6, 5 + effSupLevel));
        const ignorePct = Math.min(100, Math.max(90, 85 + effSupLevel * 5));
        const utSrc = `Support: Unholy Trinity (Lv.${effSupLevel})`;
        skillDb.addMod({
          name: 'Damage',
          type: 'MORE',
          value: morePer10,
          flags: 0,
          keywordFlags: 0,
          source: utSrc,
          tags: [{ type: 'PerStat', stat: 'UnholyResonanceCount', div: 10 }],
        });
        for (const igStat of [
          'ChanceToIgnoreChaosResistance',
          'ChanceToIgnoreLightningResistance',
          'ChanceToIgnoreEnemyPhysicalDamageReduction',
        ] as const) {
          skillDb.addMod({
            name: igStat,
            type: 'BASE',
            value: ignorePct,
            flags: 0,
            keywordFlags: 0,
            source: utSrc,
            tags: [{ type: 'Condition', var: 'MultiplierThreshold:UnholyResonanceCount:25' }],
          });
        }
        applyGemQualityStats(def, effSupQuality, 'Support', supSock.qualBonus);
        continue;
      }

      if (lower === 'empower' || lower === 'awakened empower') {
        empowerLevelBonus += Math.max(0, effSupLevel - 1);
        continue;
      }
      if (lower === 'enhance' || lower === 'awakened enhance') {
        enhanceQualityBonus += Math.max(0, effSupLevel - 1) * 8;
        continue;
      }
      if (build.game === 'poe1' && lower === 'rage') {
        const maxRage = Math.max(0, 30 + Math.round(baseBuses.playerDb.sum('BASE', 'MaximumRage')));
        const activeRage = Math.min(maxRage, Math.max(0, Math.round(build.config.rage ?? 0)));
        if (activeRage >= 10) {
          const rageAs = Math.floor((effSupLevel + 19) / 2);
          skillDb.addMod({
            name: 'Speed',
            type: 'INC',
            value: rageAs,
            flags: ModFlag.Attack,
            keywordFlags: 0,
            source: `Support: Rage (Lv.${effSupLevel}, >=10 Rage)`,
          });
        }
        applyGemQualityStats(def, effSupQuality, 'Support', supSock.qualBonus);
        continue;
      }

      const levelEntry = resolveGemLevelEntry(def, effSupLevel);
      const supCmods = levelEntry?.compiledMods ?? def.compiledMods;
      const effectiveStats = levelEntry?.stats ?? def.stats;
      const supSrc = `Support: ${def.name.en}`;

      const isCocSupport =
        lower === 'cast on critical strike' || lower === 'awakened cast on critical strike';
      if (isCocSupport) {
        skillDb.addMod({
          name: 'CastOnCrit',
          type: 'FLAG',
          value: true,
          flags: 0,
          keywordFlags: 0,
          source: supSrc,
        });
      }

      const cocOnlyHasTriggerPart =
        isCocSupport &&
        Boolean(supCmods && supCmods.every((m) => m.name === 'chanceToTriggerOnCrit'));

      if (supCmods && supCmods.length > 0 && !cocOnlyHasTriggerPart) {
        // PoE 2 Arakaali's Lust: 8% more Hit Damage per Poison Stack capped by Multiplier:ArakaaliMaxHitDamage (40% = 5 stacks)
        // + PoE 2 MultiplierThreshold:* gating (e.g. Rageforged I/II requires Rage >= 10)
        const baseAdjustedSupCmods =
          build.game === 'poe2' && lower === "arakaali's lust"
            ? supCmods.map((cm) => {
                if (
                  cm.name === 'Damage' &&
                  cm.type === 'MORE' &&
                  typeof cm.value === 'number' &&
                  cm.value > 0 &&
                  cm.tags?.some((t) => t.type === 'Multiplier' && t.var === 'PoisonStacks')
                ) {
                  const maxHitMod = supCmods.find(
                    (x) => x.name === 'Multiplier:ArakaaliMaxHitDamage' && typeof x.value === 'number',
                  );
                  const maxMorePct = typeof maxHitMod?.value === 'number' && maxHitMod.value > 0 ? maxHitMod.value : 40;
                  const stackCap = Math.max(1, Math.floor(maxMorePct / cm.value));
                  return {
                    ...cm,
                    tags: cm.tags.map((t) =>
                      t.type === 'Multiplier' && t.var === 'PoisonStacks' ? { ...t, limit: stackCap } : t,
                    ),
                  };
                }
                return cm;
              })
            : build.game === 'poe2' && lower === "atalui's bloodletting"
              ? supCmods.map((cm) => {
                  if (
                    cm.name === 'DamageGainAsPhysical' &&
                    cm.type === 'BASE' &&
                    typeof cm.value === 'number' &&
                    cm.value > 0 &&
                    cm.tags?.some((t) => t.type === 'PerStat' && t.stat === 'LifeCost' && t.limit === 40)
                  ) {
                    // Upstream PoB 2 `sup_str.lua:483` uses `limitTotal = true, limit = 40` (40% max total = 20 steps of +2%)
                    return {
                      ...cm,
                      tags: cm.tags.map((t) =>
                        t.type === 'PerStat' && t.stat === 'LifeCost' && t.limit === 40
                          ? { ...t, limitTotal: true }
                          : t,
                      ),
                    };
                  }
                  return cm;
                })
              : supCmods;
        const evalMultsForSup = skillDb.getEvalContext().multipliers;
        const adjustedSupCmods =
          build.game === 'poe2'
            ? baseAdjustedSupCmods.filter((cm) => {
                for (const tg of cm.tags ?? []) {
                  if (tg.type === 'Condition' && typeof tg.var === 'string' && tg.var.startsWith('MultiplierThreshold:')) {
                    const parts = tg.var.split(':');
                    const mVar = parts[1];
                    const thresh = Number(parts[2] ?? 0);
                    if (mVar && Number.isFinite(thresh)) {
                      const curVal =
                        mVar === 'Rage'
                          ? Math.max(evalMultsForSup.Rage ?? 0, Math.round(build.config.rage ?? 0))
                          : (evalMultsForSup[mVar] ?? 0);
                      const ok = curVal >= thresh;
                      skillDb.setCondition(tg.var, ok);
                      if (!ok) return false;
                    }
                  }
                }
                return true;
              })
            : baseAdjustedSupCmods;
        injectCompiledGemMods(skillDb, groupEnemyDb, groupMinionDb, adjustedSupCmods, supSrc, {
          game: build.game,
        });
      } else if (cocOnlyHasTriggerPart && (chosen.def.modFlags & ModFlag.Attack) === 0) {
        const isAwakenedCoc = lower === 'awakened cast on critical strike';
        const cocSpellMore = isAwakenedCoc
          ? effSupLevel <= 10
            ? -(9 - Math.floor((effSupLevel - 1) / 2))
            : -Math.max(0, 5 - Math.floor((effSupLevel - 9) / 3))
          : -Math.max(0, 19 - Math.floor((effSupLevel - 1) / 2));
        if (cocSpellMore !== 0) {
          skillDb.addMod({
            name: 'Damage',
            type: 'MORE',
            value: cocSpellMore,
            flags: ModFlag.Spell,
            keywordFlags: 0,
            source: supSrc,
          });
        }
        if (isAwakenedCoc) {
          const cocCdrInc =
            effSupLevel <= 10
              ? 10 + (effSupLevel - 1) * 3
              : 37 + Math.floor((effSupLevel - 10) * 1.5);
          skillDb.addMod({
            name: 'CooldownRecovery',
            type: 'INC',
            value: cocCdrInc,
            flags: 0,
            keywordFlags: 0,
            source: supSrc,
          });
        }
      } else {
        routeModsToActorBuses(
          { playerDb: skillDb, enemyDb: groupEnemyDb, minionDb: groupMinionDb },
          parseModLines(effectiveStats, supSrc),
          { game: build.game },
        );
      }
      applyGemQualityStats(def, effSupQuality, 'Support', supSock.qualBonus);
    }
    if (build.game === 'poe1' && slotItem && spellTotemEffLevel === undefined) {
      for (const rawL of [...slotItem.implicits, ...slotItem.explicits]) {
        const cl = rawL.replace(/^\{[^}]*\}/g, '').trim();
        const mSt = cl.match(/^Socketed (?:Gems|Skills) are Supported by Level (\d+) (?:Spell Totem|Ballista Totem)/i);
        if (mSt) {
          spellTotemEffLevel = Number(mSt[1]);
          effectiveSkillTypeSet.add('totem');
          break;
        }
      }
    }

    const activeSock = chosen.inst.fromItem
      ? { qualBonus: 0, diallaLevelBonus: 0, diallaQualBonus: 0 }
      : consumeMatchingSocketBonus(chosen.def, chosen.inst.instanceId);
    const defForBonus =
      (chosen as { fromVaalGem?: boolean }).fromVaalGem &&
      !chosen.def.tags.some((t) => t.toLowerCase() === 'vaal')
        ? { ...chosen.def, tags: [...chosen.def.tags, 'vaal'] }
        : chosen.def;
    const activeIsCorrupted = Boolean(
      (chosen as { fromVaalGem?: boolean }).fromVaalGem ||
        chosen.inst.level >= 21 ||
        chosen.inst.quality >= 21 ||
        defForBonus.tags.some((t) => t.toLowerCase() === 'vaal') ||
        (build.game === 'poe1' &&
          socketedRules.some((r) => r.filterKey.split('+').includes('corrupted'))),
    );
    const activeBonus = resolveGemBonuses(defForBonus, baseBuses.playerDb, socketedRules, {
      isCorrupted: activeIsCorrupted,
    });
    const prismBonus =
      uniqueGearResult?.skillSpecificGemLevels[chosen.def.name.en.trim().toLowerCase()] ?? 0;
    const effGemLevelBonus =
      build.game === 'poe1' && chosen.inst.fromItem ? 0 : activeBonus.levelBonus + activeSock.diallaLevelBonus;
    activeLevel = Math.min(
      40,
      Math.max(1, chosen.inst.level + effGemLevelBonus + empowerLevelBonus + awakenedSupActiveLevelBonus + prismBonus),
    );
    const prePartQuality =
      chosen.inst.quality + activeBonus.qualityBonus + enhanceQualityBonus + activeSock.diallaQualBonus + activeSock.qualBonus;
    const prePartIsTotem =
      effectiveSkillTypeSet.has('totem') || effectiveSkillTypeSet.has('summonsattacktotem');
    resolvedPartStats = resolveActiveSkillPartAndStats(chosen.def, chosen.inst, mainGroup, activeLevel, {
      enemyLevel: build.config.enemyLevel,
      game: build.game,
      playerMaxLife: _defence.life,
      isTotem: prePartIsTotem,
      ...(prePartIsTotem && build.game === 'poe1'
        ? {
            totemSkillLevel: spellTotemEffLevel ?? activeLevel,
            totemLifeIncPct: skillDb.sum('INC', 'TotemLife'),
            totemLifeMoreMult: skillDb.more('TotemLife'),
          }
        : {}),
      effectiveQuality: prePartQuality,
    });
    activeCount = computeSkillInstanceCountMultiplier(
      chosen.inst,
      mainGroup,
      resolvedPartStats.skillData,
    );
    const chosenLevelEntry = resolveGemLevelEntry(chosen.def, activeLevel);
    const hasPartOverride = Boolean(
      resolvedPartStats.selectedPart || resolvedPartStats.corpseExplosionDamageType,
    );
    const activeCmods =
      hasPartOverride && resolvedPartStats.compiledMods.length > 0
        ? resolvedPartStats.compiledMods
        : (chosenLevelEntry?.compiledMods ?? chosen.def.compiledMods);
    const chosenEffectiveStats = chosenLevelEntry?.stats ?? chosen.def.stats;
    activeQuality = applyGemQualityStats(
      chosen.def,
      chosen.inst.quality + activeBonus.qualityBonus + enhanceQualityBonus + activeSock.diallaQualBonus,
      'Skill',
      activeSock.qualBonus,
    );
    const skillSrc = `Skill: ${chosen.def.name.en}`;
    if (activeCmods && activeCmods.length > 0) {
      injectCompiledGemMods(skillDb, groupEnemyDb, groupMinionDb, activeCmods, skillSrc, {
        game: build.game,
      });
    } else {
      routeModsToActorBuses(
        { playerDb: skillDb, enemyDb: groupEnemyDb, minionDb: groupMinionDb },
        parseModLines(chosenEffectiveStats, skillSrc),
        { game: build.game },
      );
      if (build.game === 'poe1' && chosen.def.id === 'poe1_arc') {
        const baseChains = 4 + Math.floor((Math.max(1, Math.min(40, activeLevel)) - 1) / 5);
        const qualityChains = Math.trunc(Math.max(0, activeQuality) * 0.05);
        const totalChains = baseChains + qualityChains;
        skillDb.addMod({
          name: 'Damage',
          type: 'MORE',
          value: totalChains * 15,
          flags: 0,
          keywordFlags: 0,
          source: `Arc (${totalChains} Remaining Chains)`,
        });
      }
    }
    // PoE 1 Ice Spear Second Form (Parts 2 & 4): scale `CritMultiplier` by gem level (`29 + lv`, baked 49 at Lv20) + quality (`+2%` per 1% Q; `act_int.lua:9923`)
    if (
      build.game === 'poe1' &&
      chosen.def.id === 'poe1_icespear' &&
      (resolvedPartStats.partIndex === 2 || resolvedPartStats.partIndex === 4)
    ) {
      const targetSecondFormMulti = 29 + Math.min(40, Math.max(1, activeLevel)) + Math.max(0, activeQuality) * 2;
      const existingSkillMulti = skillDb
        .calcStat('CritMultiplier')
        .sources.filter((s) => s.type === 'BASE' && s.source === skillSrc)
        .reduce((acc, s) => acc + (typeof s.value === 'number' ? s.value : 0), 0);
      const deltaMulti = targetSecondFormMulti - existingSkillMulti;
      if (deltaMulti !== 0) {
        skillDb.addMod({
          name: 'CritMultiplier',
          type: 'BASE',
          value: deltaMulti,
          flags: 0,
          keywordFlags: 0,
          source: `${skillSrc} (Second Form Lv/Qual)`,
        });
      }
    }
    const partHasOwnCmods = Boolean(
      resolvedPartStats.selectedPart?.compiledMods?.length ||
        resolvedPartStats.selectedPart?.levels ||
        resolvedPartStats.selectedPart?.attackDamageMultiplierPct !== undefined,
    );
    if (!partHasOwnCmods && resolvedPartStats.sequenceDamageMultiplier !== 1) {
      skillDb.addMod({
        name: 'Damage',
        type: 'MORE',
        value: (resolvedPartStats.sequenceDamageMultiplier - 1) * 100,
        flags: ModFlag.Hit,
        keywordFlags: 0,
        source: `${chosen.def.name.en} (${resolvedPartStats.partName})`,
      });
    }

    const companionAtk = activeCandidates.find(
      (c) => c.inst !== chosen.inst && (c.def.modFlags & ModFlag.Attack) !== 0,
    );
    triggerAttackDef = companionAtk?.def;
  }

  if (!activeDef) {
    return {
      activeCount: 1,
      offence: {
        mainSkillName: { en: 'No Active Skill', zh: '未选择主动技能' },
        skillType: 'None',
        damageByType: emptyRanges,
        averageHit: 0,
        speed: 0,
        critChance: 0,
        critMultiplier: 150,
        hitChance: 100,
        effectiveCritMultiplier: 1,
        hitDps: 0,
        igniteDps: 0,
        bleedDps: 0,
        poisonDps: 0,
        totalDps: 0,
        manaCost: 0,
        manaPerSecond: 0,
      },
    };
  }

  const activeLevelEntry = resolveGemLevelEntry(activeDef, activeLevel);
  const usePartOverride = Boolean(
    resolvedPartStats?.selectedPart || resolvedPartStats?.corpseExplosionDamageType,
  );
  const mergedActiveSkillData: Record<string, number | boolean | string> = {
    ...(activeDef.skillData ?? {}),
    ...(activeLevelEntry?.skillData ?? {}),
    ...(usePartOverride && resolvedPartStats ? resolvedPartStats.skillData : {}),
  };
  const activeSkillData: Record<string, number | boolean | string> | undefined =
    Object.keys(mergedActiveSkillData).length > 0 ? mergedActiveSkillData : undefined;
  const isMinion = Boolean(activeDef.minionBase);

  // Full PoE 1 & PoE 2 Minion Offence Delegation (`minionDb` + `enemyDb` + `Data/Minions.lua`)
  if (isMinion && activeDef.minionBase) {
    const unitSpirit = chosenActiveInst?.spiritReservationOverride ?? activeDef.spiritReservation ?? 0;
    const totalGroupSpirit =
      unitSpirit > 0
        ? unitSpirit * Math.max(1, chosenActiveInst?.count ?? 1)
        : undefined;
    const minionRes = computeMinionGroupOffence({
      game: build.game,
      minionBase: activeDef.minionBase,
      minionDb: groupMinionDb,
      enemyDb: groupEnemyDb,
      playerDb: skillDb,
      effLevel: activeLevel,
      gemInst: chosenActiveInst,
      spiritReserved: totalGroupSpirit,
      skillData: activeSkillData,
      enemyConfig: {
        enemyLevel: build.config.enemyLevel,
        enemyFireResist: build.config.enemyFireResist,
        enemyColdResist: build.config.enemyColdResist,
        enemyLightningResist: build.config.enemyLightningResist,
        enemyChaosResist: build.config.enemyChaosResist,
        enemyArmour: build.config.enemyArmour,
        enemyEvasion: build.config.enemyEvasion,
      },
    });
    const pm = minionRes.perMinion;
    const manaCost = activeLevelEntry?.manaCost ?? activeDef.manaCost ?? 15;
    const castSpeed =
      activeDef.castTime && activeDef.castTime > 0
        ? Math.round(
            (1 / activeDef.castTime) *
              (1 + skillDb.sum('INC', 'Speed', ModFlag.Spell | ModFlag.Cast) / 100) *
              skillDb.more('Speed', ModFlag.Spell | ModFlag.Cast) *
              100,
          ) / 100
        : pm.speed;
    return {
      activeCount: minionRes.activeCount,
      groupStackingDps:
        minionRes.total.hitDps +
        minionRes.total.impaleDps +
        minionRes.total.poisonDps +
        minionRes.total.skillDotDps,
      offence: {
        mainSkillName: activeDef.name,
        mainSkillLevel: activeLevel,
        mainSkillBaseLevel: activeBaseLevel,
        mainSkillQuality: activeQuality,
        skillType: 'Spell',
        damageByType: pm.damageByType,
        averageHit: pm.averageHit,
        speed: pm.speed,
        critChance: pm.critChance,
        critMultiplier: pm.critMultiplier,
        hitChance: pm.hitChance,
        effectiveCritMultiplier: pm.effectiveCritMultiplier,
        hitDps: pm.hitDps,
        ...(pm.impaleDps > 0 ? { impaleDps: pm.impaleDps } : {}),
        igniteDps: pm.igniteDps,
        bleedDps: pm.bleedDps,
        poisonDps: pm.poisonDps,
        totalDps: pm.totalDps,
        manaCost,
        manaPerSecond: Math.round(manaCost * castSpeed * 10) / 10,
      },
    };
  }

  const activeWeapons = getActiveWeapons(build);
  const mainSlotLabel =
    build.game === 'poe2' &&
    build.activeWeaponSet === 2 &&
    (build.equipped['Weapon 1 Swap'] || build.equipped['Weapon 2 Swap'])
      ? 'Weapon 1 Swap'
      : 'Weapon 1';
  const offSlotLabel =
    build.game === 'poe2' &&
    build.activeWeaponSet === 2 &&
    (build.equipped['Weapon 1 Swap'] || build.equipped['Weapon 2 Swap'])
      ? 'Weapon 2 Swap'
      : 'Weapon 2';
  const energyBladeWeaponStats = postUniqueRes?.energyBlade?.active
    ? postUniqueRes.energyBlade.weaponStats
    : undefined;
  const mainWeaponStats = energyBladeWeaponStats
    ? energyBladeWeaponStats
    : activeWeapons.main
      ? resolveItemEffectiveStats(
          expandPoe2LocalRunes
            ? expandPoe2LocalRunes(mainSlotLabel, activeWeapons.main)
            : activeWeapons.main,
          build.game,
        ).weaponStats
      : undefined;
  const rawOffWeaponStats = energyBladeWeaponStats
    ? (postUniqueRes?.energyBlade?.twoHanded ? undefined : activeWeapons.off ? energyBladeWeaponStats : undefined)
    : activeWeapons.off
      ? resolveItemEffectiveStats(
          expandPoe2LocalRunes
            ? expandPoe2LocalRunes(offSlotLabel, activeWeapons.off)
            : activeWeapons.off,
          build.game,
        ).weaponStats
      : undefined;
  const canWield2HIn1H = canWieldTwoHandedMartialInOneHand(build);
  const isDualWield = Boolean(
    mainWeaponStats &&
      rawOffWeaponStats &&
      canWieldWeaponInOneHand(mainWeaponStats, canWield2HIn1H) &&
      canWieldWeaponInOneHand(rawOffWeaponStats, canWield2HIn1H),
  );
  const offWeaponStats = isDualWield ? rawOffWeaponStats : undefined;
  const weaponStats = mainWeaponStats;

  const isAttack =
    usePartOverride && resolvedPartStats
      ? resolvedPartStats.attack
      : (activeDef.modFlags & ModFlag.Attack) !== 0;
  const isShieldOffHandEarly =
    typeof activeSkillData?.setOffHandPhysicalMin === 'number' ||
    typeof activeSkillData?.setOffHandFireMin === 'number' ||
    (typeof activeSkillData?.setOffHandAttackTime === 'number' && activeSkillData.setOffHandAttackTime > 0);
  const isUnarmedConcoctionEarly =
    effectiveSkillTypeSet.has('requiresoffhandnotweapon') ||
    (build.game === 'poe2' && /\bconcoction\b/i.test(activeDef.name.en));
  const weaponModFlags =
    isAttack && !isShieldOffHandEarly && !isUnarmedConcoctionEarly
      ? weaponTypeToModFlags(weaponStats?.weaponType, weaponStats?.twoHanded)
      : 0;
  let partModFlags = activeDef.modFlags;
  if (usePartOverride && resolvedPartStats) {
    if (resolvedPartStats.melee) partModFlags |= ModFlag.Melee;
    else partModFlags &= ~ModFlag.Melee;
    if (resolvedPartStats.projectile) partModFlags |= ModFlag.Projectile;
    else partModFlags &= ~ModFlag.Projectile;
    if (resolvedPartStats.area) partModFlags |= ModFlag.Area;
    else partModFlags &= ~ModFlag.Area;
  }
  const activeNameLower = activeDef.name.en.trim().toLowerCase();
  if (build.game === 'poe2' && activeNameLower === 'arc') {
    partModFlags &= ~ModFlag.Projectile;
  }
  if (isAttack && (isUnarmedConcoctionEarly || (!weaponStats && !isShieldOffHandEarly))) {
    skillDb.setCondition('UsingUnarmed', true);
    skillDb.setCondition('Unarmed', true);
  }
  const flags = isAttack
    ? partModFlags | ModFlag.Attack | ModFlag.Hit | weaponModFlags
    : partModFlags | ModFlag.Spell | ModFlag.Cast | ModFlag.Hit;
  const proxyKwFlags =
    (effectiveSkillTypeSet.has('totem') ||
    effectiveSkillTypeSet.has('summonsattacktotem') ||
    (build.game === 'poe2' &&
      (effectiveSkillTypeSet.has('usedbytotem') || effectiveSkillTypeSet.has('summonstotem')))
      ? KeywordFlag.Totem
      : 0) |
    (effectiveSkillTypeSet.has('trap') || effectiveSkillTypeSet.has('trapped')
      ? KeywordFlag.Trap
      : 0) |
    (effectiveSkillTypeSet.has('mine') || effectiveSkillTypeSet.has('remotemined')
      ? KeywordFlag.Mine
      : 0);
  const kwFlags =
    (isAttack
      ? activeDef.keywordFlags | KeywordFlag.Attack | KeywordFlag.Hit
      : activeDef.keywordFlags | KeywordFlag.Spell | KeywordFlag.Hit) | proxyKwFlags;

  // Populate dynamic skill stats & combat multipliers on skillDb for ModTag evaluation
  const noSpaceSkill = activeDef.name.en.replace(/\s+/g, '');
  skillDb.setStat('Life', _defence.life);
  skillDb.setStat('Mana', _defence.mana);
  skillDb.setStat('ManaUnreserved', _defence.manaUnreserved);
  skillDb.setStat('EnergyShield', _defence.energyShield);
  skillDb.setStat('BlockChance', _defence.blockChance);
  skillDb.setStat('FireResistOverCap', _defence.fireResistOvercap);
  skillDb.setStat('FireResistOver75', Math.max(0, _defence.fireResist - 75));
  skillDb.setStat('ColdResistOver75', Math.max(0, _defence.coldResist - 75));
  skillDb.setStat('LightningResistOver75', Math.max(0, _defence.lightningResist - 75));
  // Sync skill-flagged Accuracy (includes Attack/weapon-specific Accuracy mods & Precision) for PerStat:Accuracy (Undeniable, etc.)
  const skillAccForPerStat = Math.round(skillDb.calcStat('Accuracy', flags, kwFlags).total);
  if (skillAccForPerStat > 0) {
    skillDb.setStat('Accuracy', skillAccForPerStat);
  }
  // Count active Elemental Ailments on Enemy (PoE 2 Harness the Elements, PoE 1 The Taming / The Tempest Rising)
  {
    const pC = skillDb.getEvalContext().conditions;
    const eC = groupEnemyDb.getEvalContext().conditions;
    let eleAilCount = 0;
    let fsiCount = 0;
    for (const [pk, ek, isFsi] of [
      ['EnemyIgnited', 'Ignited', true],
      ['EnemyChilled', 'Chilled', false],
      ['EnemyFrozen', 'Frozen', true],
      ['EnemyShocked', 'Shocked', true],
      ['EnemyElectrified', 'Electrified', false],
      ['EnemyElectrocuted', 'Electrocuted', false],
      ['EnemyScorched', 'Scorched', false],
      ['EnemyBrittle', 'Brittle', false],
      ['EnemySapped', 'Sapped', false],
    ] as const) {
      if (pC[pk] || eC[ek]) {
        eleAilCount++;
        if (isFsi) fsiCount++;
      }
    }
    if (eleAilCount > 0) {
      skillDb.setMultiplier('EnemyElementalAilmentCount', eleAilCount);
      skillDb.setStat('EnemyElementalAilmentCount', eleAilCount);
      if (build.game === 'poe1' && skillDb.flag('EnemyAffectedByEleAilmentCountsAsMoving')) {
        skillDb.setCondition('EnemyMoving', true);
        groupEnemyDb.setCondition('Moving', true);
      }
    }
    if (fsiCount > 0 && skillDb.getEvalContext().multipliers.FreezeShockIgniteOnEnemy === undefined) {
      skillDb.setMultiplier('FreezeShockIgniteOnEnemy', fsiCount);
    }
  }
  // PoE 2 Minion Pact II (`MultiplierThreshold:MinionPresenceCount:1`): auto-detect ONLY sacrificeable active minions
  // (exclude Companion/Rhoa Mount linked with Brutus' Brain or unconfigured companion mounts!)
  if (
    build.game === 'poe2' &&
    skillDb.getEvalContext().multipliers.MinionPresenceCount === undefined
  ) {
    const hasSacrificeableMinion = build.skills.some((grp) => {
      if (!grp.enabled) return false;
      const hasBrutusBrain = grp.gems.some((gm) => {
        if (!gm.enabled) return false;
        const gd = getGemById('poe2', gm.gemId);
        return Boolean(gd && /brutus'?s?\s*brain/i.test(gd.name.en));
      });
      if (hasBrutusBrain) return false;
      return grp.gems.some((gm) => {
        if (!gm.enabled) return false;
        const gd = getGemById('poe2', gm.gemId);
        if (!gd || gd.category !== 'active') return false;
        const n = gd.name.en.trim().toLowerCase();
        if (n === 'rhoa mount') return false;
        return Boolean(gd.minionBase || gd.tags.some((t) => t.toLowerCase() === 'minion'));
      });
    });
    if (hasSacrificeableMinion) {
      skillDb.setMultiplier('MinionPresenceCount', 1);
    }
  }
  // PoE 2 Twister element conditions (`twisterLightning/Cold/Fire`) & Perfect Timing (`Snipe`)
  if (build.game === 'poe2') {
    if (build.config.rawInputs?.twisterLightning) skillDb.setCondition('TwisterLightning', true);
    if (build.config.rawInputs?.twisterCold) skillDb.setCondition('TwisterCold', true);
    if (build.config.rawInputs?.twisterFire) skillDb.setCondition('TwisterFire', true);
    if (skillDb.sum('BASE', 'PerfectTimingBase', flags, kwFlags) > 0 || activeNameLower === 'snipe') {
      skillDb.setCondition('PerfectTiming', true);
    }
    if (build.config.rawInputs?.conditionShapeshiftToAnimal) {
      skillDb.setCondition('Shapeshifted', true);
    }
    if (
      (effectiveSkillTypeSet.has('grenade') ||
        activeDef.tags.some((t) => t.toLowerCase() === 'grenade')) &&
      skillDb.getEvalContext().multipliers.DifferentGrenadeFired === undefined
    ) {
      skillDb.setMultiplier('DifferentGrenadeFired', 1);
    }
    // PoE 2 Berserk scales Rage Effect (`Berserk` gem grants +50..69% Rage Effect -> e.g. 52 Rage -> 90% MORE!).
    // Guard against double-counting when evaluateAurasAndWatchersEye / evaluatePersistentBuffAndStanceSkills already applied Berserk.
    const berserkGroup = build.skills.find(
      (g) =>
        g.enabled &&
        (!g.weaponSets || g.weaponSets.length === 0 || g.weaponSets.includes(build.activeWeaponSet)) &&
        g.gems.some((gm) => gm.enabled && getGemById('poe2', gm.gemId)?.id === 'poe2_berserk'),
    );
    const berserkGem = berserkGroup?.gems.find(
      (gm) => gm.enabled && getGemById('poe2', gm.gemId)?.id === 'poe2_berserk',
    );
    if (berserkGem && (skillDb.getEvalContext().multipliers.Rage ?? 0) > 0) {
      let extraSupportLv = 0;
      for (const sup of berserkGroup!.gems) {
        if (!sup.enabled || sup === berserkGem) continue;
        const sd = getGemById('poe2', sup.gemId);
        if (!sd) continue;
        const sn = sd.name.en.trim().toLowerCase();
        if (sn === "uhtred's exodus") extraSupportLv += 3;
        else if (sn === "uhtred's omen") extraSupportLv += 2;
        else if (sn === "uhtred's augury") extraSupportLv += 1;
      }
      const bLv = Math.min(40, Math.max(1, berserkGem.level + extraSupportLv));
      const bQual = Math.max(0, berserkGem.quality ?? 0);
      const bDef = getGemById('poe2', berserkGem.gemId)!;
      const bCmods = resolveGemLevelEntry(bDef, bLv)?.compiledMods ?? bDef.compiledMods ?? [];
      const rawBerserkRageEff =
        (bCmods.find((m) => m.name === 'RageEffect' && typeof m.value === 'number')?.value as number | undefined) ??
        (bLv <= 30 ? 39 + bLv : 69 + Math.floor((bLv - 30) / 2));
      const desiredBerserkEff = rawBerserkRageEff + Math.floor(bQual * 0.5);
      const alreadyAppliedBerserkEff = skillDb
        .calcStat('RageEffect')
        .sources.filter((s) => s.type === 'INC' && typeof s.value === 'number' && /berserk/i.test(s.source))
        .reduce((acc, s) => acc + (s.value as number), 0);
      const missingBerserkEff = desiredBerserkEff - alreadyAppliedBerserkEff;
      if (missingBerserkEff > 0) {
        const curRage = skillDb.getEvalContext().multipliers.Rage ?? 0;
        const prevRageMore = skillDb.getEvalContext().multipliers.RageEffect ?? curRage;
        const totalRageEffInc = skillDb.sum('INC', 'RageEffect') + missingBerserkEff;
        const newRageMore = Math.floor(curRage * Math.max(0, 1 + totalRageEffInc / 100) + 1e-9);
        const deltaRageMore = newRageMore - prevRageMore;
        if (deltaRageMore > 0) {
          skillDb.addMod({
            name: 'Damage',
            type: 'MORE',
            value: ((100 + newRageMore) / Math.max(1, 100 + prevRageMore) - 1) * 100,
            flags: ModFlag.Attack,
            keywordFlags: 0,
            source: `Berserk (Rage Effect +${missingBerserkEff}%)`,
          });
        }
      }
    }
    // PoE 2 Skill-local Shock Magnitude delta (PoB 2 CalcPerform.lua:3345-3364: max(20 * skillShockEffMult, ShockVal))
    // Note: `EnemyShockMagnitude` from compiled skill cmods (e.g. Fulminating Concoction `50% more`) routes into `groupEnemyDb`
    // because its name starts with `Enemy`, so query both `skillDb` and `groupEnemyDb` without double-counting globalDb.
    if (build.config.enemyShocked) {
      const shockStatNames = ['ShockEffect', 'EnemyShockEffect', 'EnemyShockMagnitude', 'AilmentMagnitude', 'ShockMagnitude'];
      const skillShockEffMult =
        Math.max(
          0,
          1 +
            (skillDb.sum('INC', shockStatNames, flags, kwFlags) +
              groupEnemyDb.sum('INC', ['EnemyShockMagnitude', 'SelfShockMagnitude', 'AilmentMagnitude'], flags, kwFlags)) /
              100,
        ) *
        skillDb.more(shockStatNames, flags, kwFlags) *
        groupEnemyDb.more(['EnemyShockMagnitude', 'SelfShockMagnitude', 'AilmentMagnitude'], flags, kwFlags);
      const shockStacksLocal = Math.max(1, Number(build.config.rawInputs?.ShockStacks ?? 1));
      const skillShockPct = Math.max(
        0,
        Math.min(100, Math.floor(20 * skillShockEffMult + 1e-9) * shockStacksLocal),
      );
      const prevShockPct = groupEnemyDb.getEvalContext().multipliers.ShockEffect ?? 0;
      if (skillShockPct > prevShockPct) {
        groupEnemyDb.addMod({
          name: 'DamageTaken',
          type: 'INC',
          value: skillShockPct - prevShockPct,
          flags: 0,
          keywordFlags: 0,
          source: 'Shock (Skill Magnitude Delta)',
        });
        groupEnemyDb.setMultiplier('ShockEffect', skillShockPct);
        skillDb.setMultiplier('EnemyShockEffect', skillShockPct);
      }
    }
  }
  // PoE 1 Skill-prefixed Custom Modifiers (`"Ice Shot has 35% more projectile damage with hits"`, etc.)
  if (build.config.customMods.trim()) {
    const baseSkillNameLower = activeNameLower.replace(/^vaal\s+/i, '');
    const matchedSkillCustomLines: string[] = [];
    for (const rawLine of build.config.customMods.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith('--')) continue;
      const mPref = line.match(/^([A-Za-z' ]+?)\s+(?:has|have|deals?|gains?)\s+(.+)$/i);
      if (!mPref) continue;
      const prefLower = mPref[1]!.trim().toLowerCase();
      if (prefLower === activeNameLower || prefLower === baseSkillNameLower) {
        matchedSkillCustomLines.push(mPref[2]!.trim());
      }
    }
    if (matchedSkillCustomLines.length > 0) {
      const parsedSkillCustom = parseModLines(matchedSkillCustomLines, 'Custom Modifiers (Skill)');
      if (parsedSkillCustom.length > 0) {
        skillDb.addMods(parsedSkillCustom);
      }
    }
  }
  // PoE 1 Momentum Support (`MomentumStacks` default 3 -> +60% Attack Speed INC on Shield Charge/attacks)
  if (build.game === 'poe1' && compatibleSupportNames.has('momentum')) {
    skillDb.setMultiplier('MomentumStacks', 3);
    skillDb.setStat('MomentumStacks', 3);
  }
  // PoE 1 Ice Nova of Frostbolts (`iceNovaCastOnFrostbolt`: 50% more Damage)
  if (
    build.game === 'poe1' &&
    activeNameLower === 'ice nova of frostbolts' &&
    build.config.rawInputs?.iceNovaCastOnFrostbolt
  ) {
    skillDb.setCondition('CastOnFrostbolt', true);
    skillDb.addMod({
      name: 'Damage',
      type: 'MORE',
      value: 50,
      flags: 0,
      keywordFlags: 0,
      source: 'Ice Nova of Frostbolts (Cast on Frostbolt)',
    });
  }
  // PoE 1 Pact of Beidat (`BeidatAdditionalBeamChains` & uptime-scaled MORE Spell Damage for Arc / beam skills)
  if (build.game === 'poe1' && !isAttack) {
    const beidatGem = build.skills
      .filter((g) => g.enabled)
      .flatMap((g) => g.gems)
      .find((gm) => gm.enabled && getGemById('poe1', gm.gemId)?.id === 'poe1_pactofbeidat');
    if (beidatGem) {
      const bDef = getGemById('poe1', beidatGem.gemId)!;
      const bCmods = resolveGemLevelEntry(bDef, Math.min(40, Math.max(1, beidatGem.level)))?.compiledMods ?? bDef.compiledMods ?? [];
      const extraChains = (bCmods.find((m) => m.name === 'BeidatAdditionalBeamChains' && typeof m.value === 'number')?.value as number | undefined) ?? 4;
      if (activeNameLower === 'arc' || activeNameLower === 'arc of oscillating') {
        skillDb.addMod({
          name: 'ChainCountMax',
          type: 'BASE',
          value: extraChains,
          flags: 0,
          keywordFlags: 0,
          source: 'Pact of Beidat',
        });
      }
    }
  }
  // PoE 1 Delirium % enemy damage reduction (`deliriousPercentage="100Percent"` -> -80% MORE DamageTaken)
  if (build.game === 'poe1' && build.config.rawInputs?.deliriousPercentage) {
    const rawDelirium = String(build.config.rawInputs.deliriousPercentage);
    const mDel = rawDelirium.match(/(\d+)/);
    const delPct = mDel ? Math.min(100, Math.max(0, Number(mDel[1]))) : 0;
    if (delPct > 0) {
      groupEnemyDb.addMod({
        name: 'DamageTaken',
        type: 'MORE',
        value: -Math.round(delPct * 0.8),
        flags: 0,
        keywordFlags: 0,
        source: `Delirious (${delPct}%)`,
      });
    }
  }
  // PoE 1 Mastery 9471: "Nearby Enemies are Intimidated while you have Rage"
  if (
    build.game === 'poe1' &&
    skillDb.flag('EnemyIntimidatedWhileRage') &&
    (skillDb.getEvalContext().multipliers.Rage ?? 0) > 0 &&
    !build.config.enemyIntimidated
  ) {
    groupEnemyDb.addMod({
      name: 'DamageTaken',
      type: 'INC',
      value: 10,
      flags: ModFlag.Attack,
      keywordFlags: 0,
      source: 'Intimidated (Rage Mastery)',
    });
  }
  // PoE 1 Oscillating Sceptre / Keystone Elemental Overload (+40% MORE Elemental Hit & Ailment Damage, NoCritExtraDamage)
  if (
    build.game === 'poe1' &&
    skillDb.flag('ElementalOverload') &&
    !skillDb.flag('NeverCrit', flags, kwFlags)
  ) {
    if (!skillDb.flag('NoCritExtraDamage')) {
      skillDb.addMod({
        name: 'NoCritExtraDamage',
        type: 'FLAG',
        value: true,
        flags: 0,
        keywordFlags: 0,
        source: 'Elemental Overload',
      });
    }
    const alreadyHasEoHit = skillDb
      .calcStat('ElementalDamage', flags, kwFlags)
      .sources.some(
        (s) =>
          s.type === 'MORE' &&
          Number(s.value) === 40 &&
          /elemental overload|custom|tree|keystone/i.test(s.source),
      );
    if (!alreadyHasEoHit) {
      skillDb.addMod({
        name: 'ElementalDamage',
        type: 'MORE',
        value: 40,
        flags: ModFlag.Hit,
        keywordFlags: 0,
        source: 'Elemental Overload',
      });
    }
    const alreadyHasEoAilment = skillDb
      .calcStat('ElementalDamage', ModFlag.Ailment | ModFlag.Dot, KeywordFlag.Ailment)
      .sources.some(
        (s) =>
          s.type === 'MORE' &&
          Number(s.value) === 40 &&
          /elemental overload|custom|tree|keystone/i.test(s.source),
      );
    if (!alreadyHasEoAilment) {
      skillDb.addMod({
        name: 'ElementalDamage',
        type: 'MORE',
        value: 40,
        flags: 0,
        keywordFlags: KeywordFlag.Ailment,
        source: 'Elemental Overload',
      });
    }
  }
  // PoE 1 Eye of Winter DistanceRamp (`act_int.lua:5520`: up to 200% MORE Damage at 60 * ProjectileSpeedMod distance; default 40)
  if (build.game === 'poe1' && activeNameLower.startsWith('eye of winter')) {
    const eyeRamp = skillDb.sum('BASE', 'EyeOfWinterRamp', flags, kwFlags) || 200;
    const rawDist = Number(build.config.rawInputs?.projectileDistance ?? 40);
    const effDist = Number.isFinite(rawDist) && rawDist >= 0 ? rawDist : 40;
    const projSpdMod =
      Math.max(0.1, 1 + skillDb.sum('INC', 'ProjectileSpeed', flags, kwFlags) / 100) *
      skillDb.more('ProjectileSpeed', flags, kwFlags);
    const rampPct = Math.min(1, Math.max(0, effDist / (60 * projSpdMod))) * eyeRamp;
    if (rampPct > 0) {
      skillDb.addMod({
        name: 'Damage',
        type: 'MORE',
        value: rampPct,
        flags: 0,
        keywordFlags: 0,
        source: 'Skill: Eye of Winter (Distance Ramp)',
      });
    }
  }
  // PoE 1 Shroud of the Lightless / Gaze Abyss Eye Jewel count multipliers
  if (build.game === 'poe1') {
    const equippedItemIds = new Set<string>(Object.values(build.equipped).filter(Boolean) as string[]);
    for (const sockId of Object.values(build.tree.socketedJewels ?? {})) {
      if (sockId) equippedItemIds.add(sockId);
    }
    let abyssCount = 0;
    let murderousCount = 0;
    let searchingCount = 0;
    let hypnoticCount = 0;
    let ghastlyCount = 0;
    for (const [itemId, item] of Object.entries(build.items)) {
      if (equippedItemIds.size > 0 && !equippedItemIds.has(itemId)) continue;
      const bn = item.baseName.toLowerCase();
      if (/\bmurderous\s+eye\s+jewel\b/.test(bn)) {
        abyssCount++;
        murderousCount++;
      } else if (/\bsearching\s+eye\s+jewel\b/.test(bn)) {
        abyssCount++;
        searchingCount++;
      } else if (/\bhypnotic\s+eye\s+jewel\b/.test(bn)) {
        abyssCount++;
        hypnoticCount++;
      } else if (/\bghastly\s+eye\s+jewel\b/.test(bn)) {
        abyssCount++;
        ghastlyCount++;
      }
    }
    const mults = skillDb.getEvalContext().multipliers;
    if (abyssCount > 0 && mults.AbyssJewel === undefined) {
      skillDb.setMultiplier('AbyssJewel', abyssCount);
    }
    if (murderousCount > 0 && mults.MurderousEyeJewel === undefined) {
      skillDb.setMultiplier('MurderousEyeJewel', murderousCount);
    }
    if (searchingCount > 0 && mults.SearchingEyeJewel === undefined) {
      skillDb.setMultiplier('SearchingEyeJewel', searchingCount);
    }
    if (hypnoticCount > 0 && mults.HypnoticEyeJewel === undefined) {
      skillDb.setMultiplier('HypnoticEyeJewel', hypnoticCount);
    }
    if (ghastlyCount > 0 && mults.GhastlyEyeJewel === undefined) {
      skillDb.setMultiplier('GhastlyEyeJewel', ghastlyCount);
    }
    // PoE 1 Champion Master of Metal: populate EnemyImpaleStacks before base hit damage evaluation
    if (isAttack && mults.EnemyImpaleStacks === undefined) {
      const earlyImpaleChance = skillDb.sum('BASE', 'ImpaleChance', flags, kwFlags);
      if (earlyImpaleChance > 0) {
        const earlyMaxImpale = 5 + skillDb.sum('BASE', 'ImpaleStacksMax', flags, kwFlags);
        skillDb.setMultiplier('EnemyImpaleStacks', earlyMaxImpale);
      }
    }
    // PoE 1 Unnerve on Hit: 10% increased Spell Damage Taken when enemy is not already Unnerved
    if (
      !isAttack &&
      skillDb.sum('BASE', 'UnnerveOnHitChance', flags, kwFlags) > 0 &&
      !groupEnemyDb.getEvalContext().conditions.Unnerved &&
      !skillDb.getEvalContext().conditions.EnemyUnnerved
    ) {
      groupEnemyDb.setCondition('Unnerved', true);
      skillDb.setCondition('EnemyUnnerved', true);
      groupEnemyDb.addMod({
        name: 'SpellDamageTaken',
        type: 'INC',
        value: 10,
        flags: 0,
        keywordFlags: 0,
        source: 'Unnerved (On Hit)',
      });
    }
  }
  // PoE 1 Sap of the Seasons `ManaBurn` multiplier
  if (build.game === 'poe1' && skillDb.getEvalContext().multipliers.ManaBurn === undefined) {
    const rawManaBurn = Number(
      build.config.rawInputs?.multiplierManaBurn ??
        build.config.rawInputs?.manaBurnStacks ??
        build.config.rawInputs?.tinctureManaBurn ??
        0,
    );
    if (Number.isFinite(rawManaBurn) && rawManaBurn > 0) {
      skillDb.setMultiplier('ManaBurn', rawManaBurn);
    }
  }
  if (activePowerCharges > 0) {
    skillDb.setCondition('UsePowerCharges', true);
    skillDb.setMultiplier('PowerCharge', activePowerCharges);
    skillDb.setStat('PowerCharges', activePowerCharges);
    skillDb.setMultiplier('RemovablePowerCharge', activePowerCharges);
    if (build.game === 'poe2') {
      const hasPowerChargeConsumer =
        activeNameLower === 'flicker strike' ||
        activeNameLower === 'falling thunder' ||
        activeNameLower === 'charged staff' ||
        build.skills.some(
          (g) =>
            g.enabled &&
            g.gems.some((gm) => {
              if (!gm.enabled) return false;
              const gd = getGemById('poe2', gm.gemId);
              if (!gd || gd.category !== 'active') return false;
              const gn = gd.name.en.trim().toLowerCase();
              return gn === 'charged staff' || gn === 'falling thunder' || gn === 'flicker strike';
            }),
        );
      if (hasPowerChargeConsumer) {
        skillDb.setCondition('ConsumedPowerChargeRecently', true);
        skillDb.setCondition('GainedPowerChargeRecently', true);
      }
    }
  }
  const effFrenzyCharges = skillDb.getEvalContext().multipliers.FrenzyCharge ?? (build.config.useFrenzyCharges ? build.config.frenzyCharges : 0);
  if (effFrenzyCharges > 0) {
    skillDb.setMultiplier('FrenzyCharge', effFrenzyCharges);
    skillDb.setStat('FrenzyCharges', effFrenzyCharges);
    skillDb.setMultiplier('RemovableFrenzyCharge', effFrenzyCharges);
  }
  const effEnduranceCharges = skillDb.getEvalContext().multipliers.EnduranceCharge ?? (build.config.useEnduranceCharges ? build.config.enduranceCharges : 0);
  if (effEnduranceCharges > 0) {
    skillDb.setMultiplier('EnduranceCharge', effEnduranceCharges);
    skillDb.setStat('EnduranceCharges', effEnduranceCharges);
    skillDb.setMultiplier('RemovableEnduranceCharge', effEnduranceCharges);
  }
  if (
    (build.config.enemyChilled || skillDb.getEvalContext().conditions.EnemyChilled) &&
    skillDb.getEvalContext().multipliers.EnemyChillEffect === undefined
  ) {
    skillDb.setMultiplier('EnemyChillEffect', 10);
  }
  const arcQualChains =
    build.game === 'poe1' &&
    activeNameLower === 'arc' &&
    !(activeDef.qualityCompiledMods && activeDef.qualityCompiledMods.length > 0)
      ? Math.trunc(Math.max(0, activeQuality) * 0.05)
      : 0;
  const rawExtraProj = Math.max(
    0,
    skillDb.sum('BASE', 'ProjectileCount', flags, kwFlags) +
      skillDb.sum('BASE', `ProjectileCount:${activeNameLower}`, flags, kwFlags),
  );
  const addProjAsChains = skillDb.flag('AdditionalProjectilesAddChainsInstead', flags, kwFlags);
  const rawChainBase =
    skillDb.sum('BASE', 'ChainCountMax', flags, kwFlags) +
    skillDb.sum('BASE', 'ChainCount', flags, kwFlags) +
    arcQualChains +
    (addProjAsChains ? rawExtraProj : 0);
  const chainMax = Math.max(
    0,
    Math.floor(rawChainBase * skillDb.more('ChainCountMax', flags, kwFlags)),
  );
  const skillChainsUsed = Math.max(
    0,
    Math.round(Number(build.config.rawInputs?.skillChainCount ?? 0)),
  );
  const chainRemaining = Math.max(0, chainMax - skillChainsUsed);
  skillDb.setStat('ChainMax', chainMax);
  skillDb.setMultiplier('ChainMax', chainMax);
  skillDb.setStat('ChainRemaining', chainRemaining);
  skillDb.setMultiplier('ChainRemaining', chainRemaining);
  const projCount = addProjAsChains ? 1 : Math.max(1, 1 + rawExtraProj);
  skillDb.setStat('ProjectileCount', projCount);
  skillDb.setMultiplier('ProjectileCount', projCount);

  // Kinetic Fusillade Part 1 sequential projectile MORE damage (must apply BEFORE Step E hit damage!)
  if (
    (activeNameLower === 'kinetic fusillade' || activeNameLower === 'kinetic fusillade of detonation') &&
    (resolvedPartStats?.partIndex ?? 1) === 1
  ) {
    const rawMorePerProj =
      typeof activeSkillData?.damagePerProjectile === 'number' ? activeSkillData.damagePerProjectile : 0;
    // PoB1 `act_int.lua:11220`: Kinetic Fusillade scales base `3..9%` by gem level (`floor(3 + (lv-1)*0.25 + 0.5)`) + `0.2%` per 1% quality
    const morePerProj =
      activeNameLower === 'kinetic fusillade'
        ? Math.floor(3 + Math.max(0, Math.min(40, activeLevel) - 1) * 0.25 + 0.5) +
          Math.trunc(Math.max(0, activeQuality) * 0.2)
        : rawMorePerProj;
    if (morePerProj !== 0 && projCount > 1) {
      skillDb.addMod({
        name: 'Damage',
        type: 'MORE',
        value: (morePerProj * (projCount - 1)) / 2,
        flags: 0,
        keywordFlags: 0,
        source: `Skill: ${activeDef.name.en}`,
      });
    }
  }

  // Sync skill-injected `Multiplier:*` BASE mods and `Condition:*` FLAG mods into skillDb's eval context
  // (e.g. Blade Vortex `Multiplier:BladeVortexBlade`, `Condition:HaveBladeVortex`, brand/stage part multipliers)
  for (const [mKey] of skillDb.entriesByPrefix('Multiplier:')) {
    const varName = mKey.slice('Multiplier:'.length);
    if (!varName || varName.endsWith('MaxStages')) continue;
    const mVal = skillDb.sum('BASE', mKey, flags, kwFlags);
    if (mVal !== 0) {
      skillDb.setMultiplier(varName, mVal);
    }
  }
  for (const [cKey] of skillDb.entriesByPrefix('Condition:')) {
    const condName = cKey.slice('Condition:'.length);
    if (!condName) continue;
    if (skillDb.flag(cKey, flags, kwFlags)) {
      skillDb.setCondition(condName, true);
    }
  }

  // PoE 1 Snipe Support (`snipeHitMulti` / `snipeAilmentMulti` * Snipe stages, default 6 max stages)
  if (build.game === 'poe1' && skillDb.flag('TriggeredBySnipe', flags, kwFlags)) {
    const snipeStages = Math.max(
      1,
      Math.round(
        Number(
          build.config.rawInputs?.configSnipeStages ??
            build.config.rawInputs?.snipeStages ??
            skillDb.getEvalContext().multipliers.SnipeStage ??
            6,
        ),
      ),
    );
    const snipeHit = skillDb.sum('BASE', 'snipeHitMulti', flags, kwFlags);
    const snipeAil = skillDb.sum('BASE', 'snipeAilmentMulti', flags, kwFlags);
    if (snipeHit > 0) {
      skillDb.addMod({
        name: 'Damage',
        type: 'MORE',
        value: snipeHit * snipeStages,
        flags: ModFlag.Hit,
        keywordFlags: 0,
        source: `Snipe (${snipeStages} stages)`,
      });
    }
    if (snipeAil > 0) {
      skillDb.addMod({
        name: 'Damage',
        type: 'MORE',
        value: snipeAil * snipeStages,
        flags: ModFlag.Ailment,
        keywordFlags: 0,
        source: `Snipe (${snipeStages} stages)`,
      });
    }
  }

  // Stage multipliers for Channelling & Brand stage skills (CalcPerform.lua:2375-2392)
  const xmlExplicitStages = chosenActiveInst?.stageCount ?? mainGroup.stageCount;
  const blightBaseMaxStages = Math.round(skillDb.sum('BASE', 'BlightBaseMaxStages', flags, kwFlags));
  const isBlightVariant =
    activeNameLower === 'blight' ||
    activeNameLower === 'blight of contagion' ||
    activeNameLower === 'blight of atrophy';
  let declaredMaxStages = Math.round(
    skillDb.sum('BASE', `Multiplier:${noSpaceSkill}MaxStages`) ||
      (activeNameLower === 'scorching ray' || activeNameLower === 'scorching ray of immolation' ? 8 : 0) ||
      (activeNameLower === 'vaal flameblast' ? 15 : 0) ||
      (activeNameLower === 'bonestorm' ? 20 : 0),
  );
  if (isBlightVariant && (resolvedPartStats?.partIndex ?? 1) === 2) {
    const baseDur =
      typeof activeSkillData?.duration === 'number' && activeSkillData.duration > 0
        ? activeSkillData.duration
        : 2.5;
    const estCastRate =
      (1 / (activeDef.castTime ?? 0.25)) *
      Math.max(0.05, 1 + skillDb.sum('INC', 'Speed', flags, kwFlags) / 100) *
      skillDb.more('Speed', flags, kwFlags);
    const estDur =
      baseDur *
      Math.max(0.1, 1 + skillDb.sum('INC', 'Duration', flags, kwFlags) / 100) *
      skillDb.more('Duration', flags, kwFlags);
    const maxCap = blightBaseMaxStages > 0 ? blightBaseMaxStages : activeNameLower === 'blight' ? 20 : 6;
    const sustAfterFirst = Math.max(0, Math.min(Math.floor(estCastRate * estDur) - 1, maxCap - 1));
    declaredMaxStages = sustAfterFirst + 1;
    const lcOfSkill = noSpaceSkill.replace(/Of/g, 'of');
    skillDb.setMultiplier(`${noSpaceSkill}Stage`, declaredMaxStages);
    skillDb.setMultiplier(`${noSpaceSkill}StageAfterFirst`, sustAfterFirst);
    skillDb.setMultiplier(`${lcOfSkill}Stage`, declaredMaxStages);
    skillDb.setMultiplier(`${lcOfSkill}StageAfterFirst`, sustAfterFirst);
  } else if (declaredMaxStages > 0 || isBlightVariant) {
    const effMaxCap =
      declaredMaxStages > 0
        ? declaredMaxStages
        : blightBaseMaxStages > 0
          ? blightBaseMaxStages
          : activeNameLower === 'blight'
            ? 20
            : 6;
    let effStages =
      xmlExplicitStages !== undefined
        ? Math.max(1, Math.min(effMaxCap, xmlExplicitStages))
        : build.game === 'poe2' && activeNameLower === 'supercharged slam'
          ? 1
          : effMaxCap;
    if (activeNameLower === 'penance brand of dissipation' && xmlExplicitStages === undefined) {
      effStages = Math.min(20, effMaxCap);
    }
    const afterFirst = Math.max(0, effStages - 1);
    const lcOfSkill = noSpaceSkill.replace(/Of/g, 'of');
    skillDb.setMultiplier(`${noSpaceSkill}Stage`, effStages);
    skillDb.setMultiplier(`${noSpaceSkill}StageAfterFirst`, afterFirst);
    skillDb.setMultiplier(`${lcOfSkill}Stage`, effStages);
    skillDb.setMultiplier(`${lcOfSkill}StageAfterFirst`, afterFirst);
  }
  // Bane / Bane of Condemnation: `Multiplier:CurseApplied` = count of enabled linked Curse gems
  if (build.game === 'poe1' && (activeNameLower === 'bane' || activeNameLower === 'bane of condemnation')) {
    let linkedCurses = 0;
    for (const gm of mainGroup.gems) {
      if (!gm.enabled || gm === chosenActiveInst) continue;
      const gd = getGemById('poe1', gm.gemId);
      if (gd && gd.tags.some((t) => t.toLowerCase() === 'curse' || t.toLowerCase() === 'hex')) {
        linkedCurses++;
      }
    }
    if (linkedCurses > 0) {
      skillDb.setMultiplier('CurseApplied', linkedCurses);
    }
  }
  // Elemental Hit: 10% more Damage per Elemental Ailment on Enemy (only when not already provided by compiledMods)
  if (build.game === 'poe1' && activeNameLower.startsWith('elemental hit')) {
    const conds = skillDb.getEvalContext().conditions;
    const eConds = groupEnemyDb.getEvalContext().conditions;
    let eleAilments = 0;
    for (const [pKey, eKey] of [
      ['EnemyIgnited', 'Ignited'],
      ['EnemyChilled', 'Chilled'],
      ['EnemyFrozen', 'Frozen'],
      ['EnemyShocked', 'Shocked'],
      ['EnemyScorched', 'Scorched'],
      ['EnemyBrittle', 'Brittle'],
      ['EnemySapped', 'Sapped'],
    ] as const) {
      if (conds[pKey] || eConds[eKey]) eleAilments++;
    }
    if (eleAilments > 0) {
      skillDb.setMultiplier('ElementalHitAilmentOnEnemy', eleAilments);
      const damageEntry = skillDb.entriesByPrefix('Damage').find(([k]) => k === 'Damage');
      const alreadyHasEhCmod = Boolean(
        damageEntry &&
          damageEntry[1].some(
            (m) =>
              m.type === 'MORE' &&
              m.tags?.some((t) => t.type === 'Multiplier' && t.var === 'ElementalHitAilmentOnEnemy'),
          ),
      );
      if (!alreadyHasEhCmod) {
        skillDb.addMod({
          name: 'Damage',
          type: 'MORE',
          value: eleAilments * 10,
          flags: ModFlag.Hit,
          keywordFlags: 0,
          source: `Elemental Hit (${eleAilments} Elemental Ailments)`,
        });
      }
    }
  }

  // Wintertide Brand Part 1 average stage + Wintertide's End multiplier (PoB1 act_int.lua:21275)
  if (activeNameLower === 'wintertide brand' && (resolvedPartStats?.partIndex ?? 1) === 1) {
    const wbMaxStages = Math.max(1, Math.round(skillDb.sum('BASE', 'Multiplier:WintertideBrandMaxStages') || 20));
    const wbDmgPerStage = skillDb.sum('BASE', 'Multiplier:WintertideBrandDamagePerStage') || 20;
    const repFreq =
      typeof activeSkillData?.repeatFrequency === 'number' && activeSkillData.repeatFrequency > 0
        ? activeSkillData.repeatFrequency
        : 0.25;
    const actRate =
      (1 + skillDb.sum('INC', ['Speed', 'BrandActivationFrequency'], flags, kwFlags) / 100) *
      skillDb.more('BrandActivationFrequency', flags, kwFlags);
    const hitInterval = repFreq / Math.max(0.05, actRate);
    const baseDur =
      typeof activeSkillData?.duration === 'number' && activeSkillData.duration > 0
        ? activeSkillData.duration
        : 3.0;
    const durMult =
      Math.max(0.1, 1 + skillDb.sum('INC', 'Duration', flags, kwFlags) / 100) *
      skillDb.more('Duration', flags, kwFlags);
    const effDur = baseDur * durMult;
    const reachedStages = Math.min(Math.floor(effDur / Math.max(0.01, hitInterval)), wbMaxStages);
    const timeToMax = reachedStages * hitInterval;
    const timeAtMax = Math.max(0, effDur - timeToMax);
    const avgStages =
      effDur > 0
        ? ((reachedStages * (reachedStages - 1) * 0.5) * hitInterval + reachedStages * timeAtMax) / effDur
        : reachedStages;
    const avgDmgMult = avgStages * wbDmgPerStage;
    const endBase = typeof activeSkillData?.durationTertiary === 'number' ? activeSkillData.durationTertiary : 1.0;
    const endDur = endBase * durMult;
    const endUptime = effDur > 0 ? Math.min(1, endDur / effDur) : 0;
    const attachedLimit = Math.max(1, Math.round(skillDb.sum('BASE', 'BrandsAttachedLimit', flags, kwFlags)));
    const endDmgMult = reachedStages * wbDmgPerStage;
    const wbTotalMore = attachedLimit * (100 + avgDmgMult) + endUptime * (100 + endDmgMult) - 100;
    if (wbTotalMore !== 0) {
      skillDb.addMod({
        name: 'Damage',
        type: 'MORE',
        value: wbTotalMore,
        flags: ModFlag.Dot,
        keywordFlags: 0,
        source: 'Wintertide Brand Average Multiplier',
      });
    }
  }

  // Blood Sacrament (Relic of the Pact): ChannelledLifeReservedPerStage (PoB1 other.lua:669-688)
  if (activeNameLower === 'blood sacrament' && _defence.life > 1) {
    const resEffInc =
      baseBuses.playerDb.sum('INC', ['ManaReservationEfficiency', 'ReservationEfficiency', 'LifeReservationEfficiency']) +
      skillDb.sum('INC', ['ReservationEfficiency', 'LifeReservationEfficiency'], flags, kwFlags);
    const resEffDiv = Math.max(0.1, 1 + resEffInc / 100);
    const basePctPerStage = 2 / resEffDiv;
    const availLifePct = Math.max(0, (_defence.lifeUnreserved / Math.max(1, _defence.life)) * 100 - 0.01);
    const maxSafeStages = Math.max(1, Math.floor(availLifePct / Math.max(0.01, basePctPerStage)));
    const effSacStages =
      xmlExplicitStages !== undefined ? Math.min(maxSafeStages, xmlExplicitStages) : maxSafeStages;
    const totalReservedPct = effSacStages * basePctPerStage;
    const totalReservedLife = Math.floor((_defence.life * totalReservedPct) / 100);
    skillDb.setMultiplier('ChannelledLifeReservedPercentPerStage', totalReservedPct);
    skillDb.setMultiplier('ChannelledLifeReservedPerStage', Math.floor(totalReservedLife / 10));
  }

  // Boneshatter / Complex Trauma sustainable TraumaStacks (CalcOffence.lua:2890-2928)
  if (build.game === 'poe1' && skillDb.flag('HasTrauma', flags, kwFlags)) {
    const explicitTrauma = Number(build.config.rawInputs?.multiplierTraumaStacks ?? 0);
    let traumaStacks = explicitTrauma > 0 ? Math.round(explicitTrauma) : 0;
    if (traumaStacks <= 0) {
      const baseTraumaDur = Math.max(1, skillDb.sum('BASE', 'TraumaDuration', flags, kwFlags) || 6);
      const durMult =
        Math.max(0.1, 1 + skillDb.sum('INC', 'Duration', flags, kwFlags) / 100) *
        skillDb.more('Duration', flags, kwFlags);
      const effTraumaDur = baseTraumaDur * durMult;
      const wAps = weaponStats?.attacksPerSecond ?? 1.2;
      const atkSpdMult = activeDef.attackSpeedMultiplier ?? 0.85;
      const estAps =
        wAps *
        atkSpdMult *
        Math.max(0.05, 1 + skillDb.sum('INC', 'Speed', flags, kwFlags) / 100) *
        skillDb.more('Speed', flags, kwFlags);
      const repeats = Math.max(1, 1 + skillDb.sum('BASE', 'RepeatCount', flags, kwFlags));
      traumaStacks = Math.max(1, Math.floor((estAps / repeats) * effTraumaDur));
      if (activeNameLower === 'boneshatter of complex trauma') {
        traumaStacks = Math.min(9, traumaStacks);
      }
    }
    skillDb.setMultiplier('TraumaStacks', traumaStacks);
    skillDb.setMultiplier('SustainableTraumaStacks', traumaStacks);
  }

  // Nightblade Elusive Crit Multiplier scaling (PoB1 CalcPerform.lua:828-855 & CalcOffence.lua:558-562)
  if (
    build.game === 'poe1' &&
    skillDb.flag('SupportedByNightblade') &&
    (Boolean(build.config.rawInputs?.buffElusive) || skillDb.flag('Condition:CanBeElusive'))
  ) {
    skillDb.setCondition('Elusive', true);
    const nbBase = skillDb.sum('BASE', 'NightbladeElusiveCritMultiplier', flags, kwFlags);
    if (nbBase > 0) {
      const overrideElusive =
        typeof build.config.rawInputs?.overrideBuffElusive === 'number'
          ? build.config.rawInputs.overrideBuffElusive
          : typeof build.config.rawInputs?.overrideElusive === 'number'
            ? build.config.rawInputs.overrideElusive
            : undefined;
      const maxSkillElusiveInc = Math.max(0, skillDb.max('ElusiveEffect', flags, kwFlags) ?? 40);
      const elusiveInc =
        skillDb.sum(
          'INC',
          ['ElusiveEffect', 'NightbladeElusiveEffect', 'NightbladeSupportedElusiveEffect', 'BuffEffectOnSelf', 'BuffEffect'],
          flags,
          kwFlags,
        ) + maxSkillElusiveInc;
      const elusiveMore = skillDb.more(['ElusiveEffect', 'BuffEffectOnSelf'], flags, kwFlags);
      const peakElusivePct = Math.max(0, (100 + elusiveInc) * elusiveMore);
      const avgElusivePct =
        overrideElusive !== undefined ? Math.min(overrideElusive, peakElusivePct) : peakElusivePct * 0.5;
      const nbCritBonus = Math.floor((nbBase * Math.max(0, avgElusivePct)) / 100 + 1e-9);
      if (nbCritBonus > 0) {
        skillDb.addMod({
          name: 'CritMultiplier',
          type: 'BASE',
          value: nbCritBonus,
          flags: ModFlag.Attack,
          keywordFlags: 0,
          source: 'Nightblade (Elusive)',
        });
      }
    }
  }

  // Cruelty default DoT multiplier when linked (40% max Cruelty unless overridden)
  if (skillDb.flag('Cruelty') && skillDb.getEvalContext().multipliers.Cruelty === undefined) {
    skillDb.setMultiplier('Cruelty', 40);
  }
  // Lifetap buff auto-active when Lifetap support is linked
  if (compatibleSupportNames.has('lifetap')) {
    skillDb.setCondition('Lifetap', true);
  }
  if (compatibleSupportNames.has('inspiration') || compatibleSupportNames.has('awakened inspiration')) {
    const maxInsp = Math.max(5, 5 + skillDb.sum('BASE', 'InspirationMaxCharges', flags, kwFlags));
    skillDb.setMultiplier('InspirationCharge', maxInsp);
  }
  if (compatibleSupportNames.has('trinity') || compatibleSupportNames.has('awakened trinity')) {
    if (
      build.config.rawInputs?.configResonanceCount === undefined &&
      skillDb.getEvalContext().multipliers.ResonanceCount === undefined
    ) {
      const resVal = build.game === 'poe2' ? 0 : 50;
      skillDb.setMultiplier('ResonanceCount', resVal);
      skillDb.setStat('ResonanceCount', resVal);
    }
  }
  if (build.game === 'poe1' && compatibleSupportNames.has('unholy trinity')) {
    if (
      build.config.rawInputs?.configUnholyResonanceCount === undefined &&
      skillDb.getEvalContext().multipliers.UnholyResonanceCount === undefined
    ) {
      skillDb.setMultiplier('UnholyResonanceCount', 50);
      skillDb.setStat('UnholyResonanceCount', 50);
    }
  }
  skillDb.setCondition('MeleeProximity', true);
  skillDb.setCondition('averageRepeat', true);
  const stoicismSec = Number(build.config.rawInputs?.stoicismSeconds ?? 0);
  if (
    stoicismSec > 0 &&
    (compatibleSupportNames.has('stoicism i') || compatibleSupportNames.has('stoicism ii'))
  ) {
    skillDb.setCondition('UsingStoicism', true);
    skillDb.setMultiplier('StoicismSeconds', Math.min(10, stoicismSec));
  }
  if (
    effectiveSkillTypeSet.has('channelling') ||
    effectiveSkillTypeSet.has('channel') ||
    activeDef.tags.some((t) => t.toLowerCase() === 'channelling')
  ) {
    skillDb.setCondition('Channelling', true);
    if (build.game === 'poe2') {
      const burgeonCap = skillDb.sum('BASE', 'Multiplier:BurgeonDamageCap', flags, kwFlags);
      const burgeonPerSec = compatibleSupportNames.has('burgeon ii') ? 20 : 10;
      const maxChanSec = burgeonCap > 0 ? burgeonCap / burgeonPerSec : 2;
      // PoB 2 defaults ChannellingTime to 0 unless explicitly configured (prevents bogus Burgeon II +40% MORE)
      const rawChanSec = Number(build.config.rawInputs?.channellingTime ?? 0);
      if (Number.isFinite(rawChanSec) && rawChanSec > 0) {
        skillDb.setMultiplier('ChannellingTime', Math.min(maxChanSec, rawChanSec));
      }
    } else {
      // PoE 1 Focused Channelling (`24% MORE/s`, cap 60% = 2.5s)
      const rawChanSec = Number(
        build.config.rawInputs?.configChannellingTime ??
          build.config.rawInputs?.channellingTime ??
          (compatibleSupportNames.has('focused channelling') ? 2.5 : 0),
      );
      if (Number.isFinite(rawChanSec) && rawChanSec > 0) {
        skillDb.setMultiplier('ChannellingTime', Math.min(2.5, rawChanSec));
      }
    }
  }
  const hasLevelManaCost = activeLevelEntry?.manaCost !== undefined;
  const rawBaseMana = activeLevelEntry?.manaCost ?? activeDef.manaCost ?? Math.round(8 + activeLevel * 1.6);
  const levelScaledMana = hasLevelManaCost
    ? rawBaseMana
    : rawBaseMana * Math.pow(1.09, Math.max(0, activeLevel - 20));
  const supCostMult =
    build.game === 'poe2'
      ? Math.pow(1.12, Math.max(0, compatibleSupportNames.size))
      : Math.pow(1.2, Math.max(0, compatibleSupportNames.size));
  const baseSkillManaCost = levelScaledMana * supCostMult;
  const lifeCostConvPct = Math.min(
    100,
    Math.max(
      skillDb.flag('BloodMagic') ? 100 : 0,
      skillDb.sum('BASE', ['HybridManaAndLifeCost_Life', 'SkillManaCostConvertToLifeCost'], flags, kwFlags),
    ),
  );
  const lifeCostMore = skillDb.more('LifeCost', flags, kwFlags);
  const nonChanLifeCostPct =
    build.game === 'poe2' &&
    !isAttack &&
    !effectiveSkillTypeSet.has('channelling') &&
    !effectiveSkillTypeSet.has('channel')
      ? Math.max(0, skillDb.sum('BASE', 'NonChannellingSpellLifeCostPct', flags, kwFlags))
      : 0;
  const extraNonChanLifeCost =
    nonChanLifeCostPct > 0 ? Math.round((_defence.life * nonChanLifeCostPct) / 100) : 0;
  const estLifeCost =
    Math.round(((baseSkillManaCost * lifeCostConvPct) / 100) * lifeCostMore) + extraNonChanLifeCost;
  const estManaCost = Math.max(0, Math.round(baseSkillManaCost - estLifeCost));
  skillDb.setStat('LifeCost', estLifeCost);
  skillDb.setStat('ManaCost', estManaCost);
  // Earthquake of Amplification: 100msEarthquakeDuration multiplier ((base + 25ms*qual) * Duration INC * Duration MORE * 10)
  if (activeNameLower === 'earthquake of amplification') {
    const baseEqDur =
      (typeof activeSkillData?.duration === 'number' && activeSkillData.duration > 0
        ? activeSkillData.duration
        : 2.5) +
      Math.trunc(Math.max(0, activeQuality) * 25) / 1000;
    const durInc = skillDb.sum('INC', 'Duration', flags, kwFlags);
    const durMore = skillDb.more('Duration', flags, kwFlags);
    const effDur = Math.max(0, baseEqDur * Math.max(0, 1 + durInc / 100) * durMore);
    skillDb.setMultiplier('100msEarthquakeDuration', Math.floor(effDur * 10 + 1e-6));
  }

  // Ruthless Support average repeat multiplier (CalcOffence.lua:2820)
  const ruthlessHitMult = skillDb.sum('BASE', 'RuthlessBlowHitMultiplier', flags, kwFlags);
  const ruthlessBlowPeriod = Math.max(1, skillDb.sum('BASE', 'RuthlessBlowMaxCount', flags, kwFlags) || 3);
  if (ruthlessHitMult > 0) {
    skillDb.addMod({
      name: 'Damage',
      type: 'MORE',
      value: ruthlessHitMult / ruthlessBlowPeriod,
      flags: ModFlag.Hit,
      keywordFlags: 0,
      source: 'Ruthless (Average)',
    });
  }
  const ruthlessAilMult = skillDb.sum('BASE', 'RuthlessBlowAilmentMultiplier', flags, kwFlags);
  if (ruthlessAilMult > 0) {
    skillDb.addMod({
      name: 'Damage',
      type: 'MORE',
      value: ruthlessAilMult / ruthlessBlowPeriod,
      flags: ModFlag.Ailment | ModFlag.Dot,
      keywordFlags: 0,
      source: 'Ruthless (Ailment Average)',
    });
  }

  // PoE 1 Warcry Exerted Attacks (Overexertion, Intimidating Cry, Rallying Cry, War Bringer, Echoes of Creation — CalcOffence.lua:2888-2950)
  const isExertableMelee =
    build.game === 'poe1' &&
    isAttack &&
    (flags & ModFlag.Melee) !== 0 &&
    !effectiveSkillTypeSet.has('neverexertable') &&
    !effectiveSkillTypeSet.has('vaal') &&
    !effectiveSkillTypeSet.has('channel') &&
    !effectiveSkillTypeSet.has('totem') &&
    !compatibleSupportNames.has('multistrike') &&
    !compatibleSupportNames.has('awakened multistrike');
  if (isExertableMelee) {
    const exertingWarcries = new Set<string>();
    let hasIntimidatingCry = false;
    let hasRallyingCry = false;
    for (const grp of build.skills) {
      if (!grp.enabled) continue;
      for (const gm of grp.gems) {
        if (!gm.enabled) continue;
        const gd = getGemById('poe1', gm.gemId);
        if (!gd || gd.category !== 'active') continue;
        const wn = gd.name.en.trim().toLowerCase();
        if (
          wn === 'intimidating cry' ||
          wn === 'seismic cry' ||
          wn === 'infernal cry' ||
          wn === 'ancestral cry' ||
          wn === 'rallying cry' ||
          wn === "battlemage's cry"
        ) {
          exertingWarcries.add(wn);
          if (wn === 'intimidating cry') hasIntimidatingCry = true;
          if (wn === 'rallying cry') hasRallyingCry = true;
        }
      }
    }
    const exertCount = exertingWarcries.size;
    if (exertCount > 0) {
      const incExert = skillDb.sum('INC', 'ExertIncrease', flags, kwFlags);
      if (incExert !== 0) {
        skillDb.addMod({ name: 'Damage', type: 'INC', value: incExert, flags: ModFlag.Attack, keywordFlags: 0, source: 'Exerted Attacks' });
      }
      const moreExert = (skillDb.more('ExertIncrease', flags, kwFlags) - 1) * 100;
      if (moreExert !== 0) {
        skillDb.addMod({ name: 'Damage', type: 'MORE', value: moreExert, flags: ModFlag.Attack, keywordFlags: 0, source: 'Exerted Attacks' });
      }
      const moreExertAtk = (skillDb.more('ExertAttackIncrease', flags, kwFlags) - 1) * 100;
      if (moreExertAtk !== 0) {
        skillDb.addMod({ name: 'Damage', type: 'MORE', value: moreExertAtk, flags: ModFlag.Attack, keywordFlags: 0, source: 'Exerted Attack Damage' });
      }
      const overexertPerWarcry = (skillDb.more('OverexertionExertAverageIncrease', flags, kwFlags) - 1) * 100;
      if (overexertPerWarcry > 0 && exertCount > 1) {
        // Overexertion: ExertIncrease covers the 1st warcry (+14..18%), OverexertionExertAverageIncrease adds +10..12% per additional exerting warcry
        skillDb.addMod({
          name: 'Damage',
          type: 'MORE',
          value: overexertPerWarcry * (exertCount - 1),
          flags: ModFlag.Attack,
          keywordFlags: 0,
          source: `Overexertion (${exertCount} Exerting Warcries)`,
        });
      }
      const echoesPerWarcry = (skillDb.more('EchoesExertAverageIncrease', flags, kwFlags) - 1) * 100;
      if (echoesPerWarcry > 0) {
        skillDb.addMod({
          name: 'Damage',
          type: 'MORE',
          value: echoesPerWarcry * exertCount,
          flags: ModFlag.Attack,
          keywordFlags: 0,
          source: `Echoes of Creation (${exertCount} Warcries)`,
        });
      }
      if (hasIntimidatingCry) {
        skillDb.addMod({
          name: 'DoubleDamageChance',
          type: 'BASE',
          value: 100,
          flags: ModFlag.Attack | ModFlag.Hit,
          keywordFlags: 0,
          source: 'Intimidating Cry (Exerted)',
        });
      }
      if (hasRallyingCry) {
        skillDb.addMod({
          name: 'Damage',
          type: 'MORE',
          value: 15,
          flags: ModFlag.Attack,
          keywordFlags: 0,
          source: 'Rallying Cry (Exerted)',
        });
      }
    }
  }

  // Crown of Eyes / Kinetic Blast (200%) / Kinetic Fusillade (150%) / Battlemage's Cry / Wandslinger (CalcOffence.lua:655-669)
  const hasCrownOfEyes = Boolean(postUniqueRes && postUniqueRes.crownOfEyesAttackInc !== 0);
  const hasSpellDmgToAtk =
    isAttack &&
    (skillDb.flag('SpellDamageAppliesToAttacks', flags, kwFlags) || hasCrownOfEyes);
  if (hasSpellDmgToAtk) {
    const dbImproved = skillDb.sum('BASE', 'ImprovedSpellDamageAppliesToAttacks', flags, kwFlags);
    const skillIntrinsicPct =
      build.game === 'poe1' && activeNameLower === 'kinetic blast'
        ? 200
        : build.game === 'poe1' && activeNameLower === 'heavy strike of trarthus'
          ? 150 + Math.max(0, activeQuality)
          : build.game === 'poe1' &&
              (activeNameLower === 'kinetic fusillade' ||
                activeNameLower === 'kinetic fusillade of detonation' ||
                activeNameLower === 'power siphon' ||
                activeNameLower === 'power siphon of the archmage' ||
                hasCrownOfEyes)
            ? 150
            : 100;
    const convPct = Math.max(100, dbImproved, skillIntrinsicPct);
    const spellOnlyInc =
      skillDb.sum('INC', 'Damage', ModFlag.Spell, KeywordFlag.Spell) -
      skillDb.sum('INC', 'Damage', 0, 0);
    const targetBonus = Math.trunc((spellOnlyInc * convPct) / 100);
    const alreadyAdded = postUniqueRes?.crownOfEyesAttackInc ?? 0;
    const deltaBonus = targetBonus - alreadyAdded;
    if (deltaBonus !== 0) {
      skillDb.addMod({
        name: 'Damage',
        type: 'INC',
        value: deltaBonus,
        flags: ModFlag.Attack,
        keywordFlags: 0,
        source: 'Spell Damage Applies to Attacks',
      });
    }
    // Prevent double-dipping Strength's PhysicalDamage bonus when Iron Will already converted Strength to Spell Damage (CalcOffence.lua:663-666)
    if (skillDb.flag('IronWill') && _defence.str >= 5) {
      const strRatio = skillDb.flag('StrDmgBonusRatioOverrideApplied')
        ? 0.3
        : getRuleset(build.game).meleePhysPctPerStrength;
      const strPhys = Math.floor(_defence.str * strRatio);
      if (strPhys > 0) {
        if ((flags & ModFlag.Melee) !== 0) {
          skillDb.addMod({
            name: 'PhysicalDamage',
            type: 'INC',
            value: -strPhys,
            flags: ModFlag.Melee,
            keywordFlags: 0,
            source: 'Iron Will (Strength Dedup)',
          });
        } else if (skillDb.flag('IronGrip') && (flags & ModFlag.Projectile) !== 0) {
          skillDb.addMod({
            name: 'PhysicalDamage',
            type: 'INC',
            value: -strPhys,
            flags: ModFlag.Attack | ModFlag.Projectile,
            keywordFlags: 0,
            source: 'Iron Will (Strength Dedup)',
          });
        }
      }
    }
  }

  // PoE 2 Vilenta's Propulsion (`CastSpeedAppliesToProjectileSpeed`, CalcOffence.lua:944-952)
  if (skillDb.flag('CastSpeedAppliesToProjectileSpeed', flags, kwFlags)) {
    const convMult =
      (skillDb.sum('BASE', 'ImprovedCastSpeedAppliesToProjectileSpeed', flags, kwFlags) || 100) / 100;
    const castOnlySpeedInc =
      skillDb.sum('INC', 'Speed', ModFlag.Cast | ModFlag.Spell, KeywordFlag.Spell) -
      skillDb.sum('INC', 'Speed', 0, 0);
    const convertedProjSpeed = castOnlySpeedInc * convMult;
    if (convertedProjSpeed !== 0) {
      skillDb.addMod({
        name: 'ProjectileSpeed',
        type: 'INC',
        value: convertedProjSpeed,
        flags: 0,
        keywordFlags: 0,
        source: 'Cast Speed Applies to Projectile Speed',
      });
    }
  }

  // PoE 2 Projectile Acceleration III (`ProjSpeedAppliesToProjectileDamage` / `ProjectileSpeedAppliesToProjectileDamage`)
  if (
    skillDb.flag('ProjSpeedAppliesToProjectileDamage', flags, kwFlags) ||
    skillDb.flag('ProjectileSpeedAppliesToProjectileDamage', flags, kwFlags)
  ) {
    const projSpeedInc = skillDb.sum('INC', 'ProjectileSpeed', flags, kwFlags);
    if (projSpeedInc !== 0) {
      skillDb.addMod({
        name: 'Damage',
        type: 'INC',
        value: projSpeedInc,
        flags: ModFlag.Projectile,
        keywordFlags: 0,
        source: 'Projectile Speed Applies to Projectile Damage',
      });
    }
  }

  // PoE 2 Feathered Fletching: Projectile Speed INC/RED applies to Damage with Bows (CalcOffence.lua:953-959)
  if (
    isAttack &&
    weaponStats?.weaponType === 'Bow' &&
    (skillDb.flag('ProjSpeedAppliesToBowDamage', flags, kwFlags) ||
      skillDb.flag('ProjectileSpeedAppliesToBowDamage', flags, kwFlags))
  ) {
    const projSpeedInc = skillDb.sum('INC', 'ProjectileSpeed', flags, kwFlags);
    if (projSpeedInc !== 0) {
      skillDb.addMod({
        name: 'Damage',
        type: 'INC',
        value: projSpeedInc,
        flags: ModFlag.Bow,
        keywordFlags: 0,
        source: 'Feathered Fletching (Projectile Speed)',
      });
    }
  }

  // PoE 2 Lich Price of Power: Spells consume a Power Charge if able to deal 40% more Damage
  if (!isAttack && activePowerCharges > 0) {
    const priceMore = skillDb.sum('BASE', 'PriceOfPowerSpellMore', flags, kwFlags);
    if (priceMore > 0) {
      skillDb.addMod({
        name: 'Damage',
        type: 'MORE',
        value: priceMore,
        flags: ModFlag.Spell,
        keywordFlags: 0,
        source: 'Ascendancy: Price of Power',
      });
    }
  }

  // Multistrike / Greater Multistrike / Greater Spell Echo average repeat damage multipliers (PoB1 CalcOffence.lua:850-892)
  // Hybrid melee+projectile/area skills (Lightning Strike, Frost Blades, Molten Strike, Smite) still receive Multistrike's
  // ModFlag.Melee RepeatCount & Repeat{One,Two,Three}Damage bonuses on their projectile/area parts.
  const hasMultistrikeSupForRepeat =
    compatibleSupportNames.has('multistrike') ||
    compatibleSupportNames.has('awakened multistrike') ||
    compatibleSupportNames.has('greater multistrike');
  const repeatQueryFlags =
    isAttack && hasMultistrikeSupForRepeat && (activeDef.modFlags & ModFlag.Melee) !== 0
      ? flags | ModFlag.Melee
      : flags;
  skillDb.setCondition('averageRepeat|alwaysFinalRepeat', true);
  const repeatCountVal = Math.max(1, 1 + Math.round(skillDb.sum('BASE', 'RepeatCount', repeatQueryFlags, kwFlags)));
  if (repeatCountVal > 1 && !skillDb.flag('NoRepeatBonuses', repeatQueryFlags, kwFlags)) {
    const rFinalMore = skillDb.more('RepeatFinalDamage', repeatQueryFlags, kwFlags);
    const rFinalPct = (rFinalMore - 1) * 100;
    if (rFinalPct !== 0) {
      skillDb.addMod({
        name: 'Damage',
        type: 'MORE',
        value: rFinalPct / repeatCountVal,
        flags: ModFlag.Hit,
        keywordFlags: 0,
        source: 'Repeat Final Damage (Average)',
      });
    }
    const rPerRepeatMore = skillDb.more('RepeatPerRepeatDamage', repeatQueryFlags, kwFlags);
    const rPerRepeatPct = (rPerRepeatMore - 1) * 100;
    if (rPerRepeatPct !== 0) {
      const avgPerRepeatMore =
        rFinalMore !== 1
          ? (((100 + (rPerRepeatPct * (repeatCountVal - 2)) / 2) * (repeatCountVal - 1) +
              (100 + rPerRepeatPct * (repeatCountVal - 1)) * rFinalMore) /
              (repeatCountVal + rFinalPct / 100)) -
            100
          : (rPerRepeatPct * (repeatCountVal - 1)) / 2;
      if (avgPerRepeatMore !== 0) {
        skillDb.addMod({
          name: 'Damage',
          type: 'MORE',
          value: avgPerRepeatMore,
          flags: ModFlag.Hit,
          keywordFlags: 0,
          source: 'Repeat Per Repeat Damage (Average)',
        });
      }
    }
  }
  const r1More = skillDb.more('RepeatOneDamage', repeatQueryFlags, kwFlags);
  const r2More = skillDb.more('RepeatTwoDamage', repeatQueryFlags, kwFlags);
  const r3More = skillDb.more('RepeatThreeDamage', repeatQueryFlags, kwFlags);
  if (r1More !== 1 || r2More !== 1 || r3More !== 1) {
    const hasThird = r3More !== 1 || repeatCountVal >= 4;
    const avgRepeatMult = hasThird
      ? (1 + r1More + r2More + r3More) / 4
      : (1 + r1More + r2More) / 3;
    const pctMore = Math.round((avgRepeatMult - 1) * 10000) / 100;
    if (pctMore !== 0) {
      skillDb.addMod({
        name: 'Damage',
        type: 'MORE',
        value: pctMore,
        flags: ModFlag.Attack | ModFlag.Hit,
        keywordFlags: 0,
        source: 'Multistrike (Average Repeat)',
      });
    }
  }

  const hasResolvedPartDmg = Boolean(
    usePartOverride && resolvedPartStats && Object.keys(resolvedPartStats.baseDamage).length > 0,
  );
  const resolvedPartOrBaseDmg = hasResolvedPartDmg
    ? resolvedPartStats!.baseDamage
    : (activeLevelEntry?.baseDamage ?? activeDef.baseDamage);
  const levelFactor = activeLevelEntry || hasResolvedPartDmg ? 1 : getLevelScalingFactor(activeLevel);
  let effectiveness =
    ((usePartOverride ? resolvedPartStats?.damageEffectivenessPct : undefined) ??
      activeLevelEntry?.damageEffectivenessPct ??
      activeDef.damageEffectivenessPct ??
      100) / 100;

  // Step A: Base Min/Max per DamageType before conversion
  const baseMin: Record<DamageType, number> = { Physical: 0, Lightning: 0, Cold: 0, Fire: 0, Chaos: 0 };
  const baseMax: Record<DamageType, number> = { Physical: 0, Lightning: 0, Cold: 0, Fire: 0, Chaos: 0 };

  const doubleHitsDualWield = Boolean(
    build.game === 'poe1' && isDualWield && activeSkillData?.doubleHitsWhenDualWielding,
  );
  if (build.game === 'poe2' && isDualWield && activeSkillData?.doubleHitsWhenDualWielding) {
    skillDb.addMod({
      name: 'DPS',
      type: 'MORE',
      value: 100,
      flags: 0,
      keywordFlags: 0,
      source: 'Hits with both weapons',
    });
  }
  const offHandSetMin =
    typeof activeSkillData?.setOffHandPhysicalMin === 'number'
      ? activeSkillData.setOffHandPhysicalMin
      : undefined;
  const offHandSetMax =
    typeof activeSkillData?.setOffHandPhysicalMax === 'number'
      ? activeSkillData.setOffHandPhysicalMax
      : undefined;
  const offHandFireMin =
    typeof activeSkillData?.setOffHandFireMin === 'number'
      ? activeSkillData.setOffHandFireMin
      : undefined;
  const offHandFireMax =
    typeof activeSkillData?.setOffHandFireMax === 'number'
      ? activeSkillData.setOffHandFireMax
      : undefined;
  const offHandAttackTimeMs =
    typeof activeSkillData?.setOffHandAttackTime === 'number' && activeSkillData.setOffHandAttackTime > 0
      ? activeSkillData.setOffHandAttackTime
      : undefined;
  const isShieldOffHandAttack =
    offHandSetMin !== undefined ||
    offHandFireMin !== undefined ||
    offHandAttackTimeMs !== undefined;
  if (isShieldOffHandAttack) {
    skillDb.setCondition('OffHandAttack', true);
  }
  const isUnarmedConcoction =
    effectiveSkillTypeSet.has('requiresoffhandnotweapon') ||
    (build.game === 'poe2' && /\bconcoction\b/i.test(activeDef.name.en));

  if (isAttack) {
    const partAtkMultPct = usePartOverride ? resolvedPartStats?.attackDamageMultiplierPct : undefined;
    const baseAtkPct =
      partAtkMultPct ??
      activeLevelEntry?.attackDamageMultiplierPct ??
      activeDef.attackDamageMultiplierPct ??
      100;
    const atkMult =
      activeLevelEntry || partAtkMultPct !== undefined
        ? baseAtkPct / 100
        : (baseAtkPct / 100) * Math.pow(1.03, activeLevel - 20);
    // PoB 2 CalcOffence.lua:4131-4136: attacks scale added flat damage by level-scaled `baseMultiplier` (`atkMult`)
    if (build.game === 'poe2' && !isUnarmedConcoction) {
      effectiveness = atkMult;
    }
    if (isShieldOffHandAttack) {
      if (offHandSetMin !== undefined && offHandSetMax !== undefined) {
        baseMin.Physical += offHandSetMin * atkMult;
        baseMax.Physical += offHandSetMax * atkMult;
      }
      if (offHandFireMin !== undefined && offHandFireMax !== undefined) {
        baseMin.Fire += offHandFireMin * atkMult;
        baseMax.Fire += offHandFireMax * atkMult;
      }
      // `off_hand_minimum/maximum_added_physical_damage_per_15_shield_armour_and_evasion_rating` uses `statList` in PoB
      // so `cmods` has the per-15 base value without a single-stat PerStat tag; add remaining `(chunks - 1)` shield bonus here.
      const shieldArmEva =
        (skillDb.getEvalContext().stats['ArmourOnWeapon 2'] ?? 0) +
        (skillDb.getEvalContext().stats['EvasionOnWeapon 2'] ?? 0);
      const chunks15 = Math.floor(shieldArmEva / 15);
      if (chunks15 > 1) {
        const cmodsList = activeLevelEntry?.compiledMods ?? activeDef.compiledMods ?? [];
        const per15Min = cmodsList.find(
          (m) =>
            m.name === 'PhysicalMin' &&
            typeof m.value === 'number' &&
            m.tags?.some((t) => t.type === 'Condition' && t.var === 'OffHandAttack') &&
            !m.tags?.some((t) => t.type === 'PerStat'),
        );
        const per15Max = cmodsList.find(
          (m) =>
            m.name === 'PhysicalMax' &&
            typeof m.value === 'number' &&
            m.tags?.some((t) => t.type === 'Condition' && t.var === 'OffHandAttack') &&
            !m.tags?.some((t) => t.type === 'PerStat'),
        );
        if (per15Min && typeof per15Min.value === 'number') {
          baseMin.Physical += per15Min.value * (chunks15 - 1) * atkMult;
        }
        if (per15Max && typeof per15Max.value === 'number') {
          baseMax.Physical += per15Max.value * (chunks15 - 1) * atkMult;
        }
      }
    } else if (isUnarmedConcoction) {
      const srcDmg = resolvedPartOrBaseDmg;
      if (srcDmg) {
        for (const dt of DAMAGE_TYPES) {
          const range = srcDmg[dt];
          if (range) {
            baseMin[dt] += range[0] * levelFactor;
            baseMax[dt] += range[1] * levelFactor;
          }
        }
      }
      // PoE 1 Poisonous Concoction / of Bouncing: Added Chaos Damage from highest-recovery equipped Life Flask
      if (build.game === 'poe1' && activeNameLower.startsWith('poisonous concoction')) {
        let bestFlaskLife = 0;
        const flaskRecInc =
          skillDb.sum('INC', ['FlaskRecovery', 'FlaskLifeRecovery', 'FlaskEffect']) +
          baseBuses.playerDb.sum('INC', ['FlaskRecovery', 'FlaskLifeRecovery', 'FlaskEffect']);
        for (const fSlot of ['Flask 1', 'Flask 2', 'Flask 3', 'Flask 4', 'Flask 5'] as const) {
          const fId = build.equipped[fSlot];
          const fItem = fId ? build.items[fId] : undefined;
          if (!fItem || !/life flask/i.test(fItem.baseName)) continue;
          const bn = fItem.baseName.toLowerCase();
          const rawBase = bn.includes('divine')
            ? 2400
            : bn.includes('eternal')
              ? 2080
              : bn.includes('hallowed')
                ? 1990
                : bn.includes('sanctified')
                  ? 1460
                  : 1200;
          let localRecInc = 0;
          for (const fl of [...fItem.implicits, ...fItem.explicits]) {
            const mInc = fl.match(/(\d+)%\s+increased\s+(?:Amount\s+Recovered|Life\s+Recovered)/i);
            if (mInc) localRecInc += Number(mInc[1]);
            const mRed = fl.match(/(\d+)%\s+reduced\s+(?:Amount\s+Recovered|Life\s+Recovered)/i);
            if (mRed) localRecInc -= Number(mRed[1]);
          }
          const qualMult = 1 + Math.max(0, fItem.quality || 20) / 100;
          const totalRec = rawBase * qualMult * Math.max(0, 1 + localRecInc / 100) * Math.max(0, 1 + flaskRecInc / 100);
          if (totalRec > bestFlaskLife) bestFlaskLife = totalRec;
        }
        if (bestFlaskLife > 0) {
          const flaskPct = activeNameLower.includes('bouncing') ? 0.11 : 0.09;
          const flatFlaskChaos = bestFlaskLife * flaskPct;
          baseMin.Chaos += flatFlaskChaos;
          baseMax.Chaos += flatFlaskChaos;
        }
      }
    } else if (isDualWield && mainWeaponStats && offWeaponStats) {
      const dwDiv = doubleHitsDualWield ? 1 : 2;
      baseMin.Physical += ((mainWeaponStats.physicalMin + offWeaponStats.physicalMin) / dwDiv) * atkMult;
      baseMax.Physical += ((mainWeaponStats.physicalMax + offWeaponStats.physicalMax) / dwDiv) * atkMult;
      for (const dt of ['Fire', 'Cold', 'Lightning', 'Chaos'] as const) {
        const mRange = mainWeaponStats.elementalDamage?.[dt];
        const oRange = offWeaponStats.elementalDamage?.[dt];
        if (mRange || oRange) {
          baseMin[dt] += (((mRange?.[0] ?? 0) + (oRange?.[0] ?? 0)) / dwDiv) * atkMult;
          baseMax[dt] += (((mRange?.[1] ?? 0) + (oRange?.[1] ?? 0)) / dwDiv) * atkMult;
        }
      }
    } else {
      const wMin = weaponStats?.physicalMin ?? 15;
      const wMax = weaponStats?.physicalMax ?? 30;
      baseMin.Physical += wMin * atkMult;
      baseMax.Physical += wMax * atkMult;
      // PoE 2 Amazon Penetrate: "Gain Added Physical Damage equal to 25% of the Accuracy Rating on the Weapon"
      // Guard against double-counting when ascendancyMods.ts already emitted AmazonPenetrateWeaponAccPct.
      if (
        build.game === 'poe2' &&
        activeWeapons.main &&
        skillDb.sum('BASE', 'AmazonPenetrateWeaponAccPct') === 0
      ) {
        const accAsPhysPct = skillDb.sum('BASE', 'WeaponAccuracyAsAddedPhysPct', flags, kwFlags);
        if (accAsPhysPct > 0) {
          const expandedMain = expandPoe2LocalRunes
            ? expandPoe2LocalRunes(mainSlotLabel, activeWeapons.main)
            : activeWeapons.main;
          let weaponLocalAcc = 0;
          for (const rawL of [...expandedMain.implicits, ...expandedMain.explicits]) {
            const cl = rawL.replace(/^\{[^}]*\}/g, '').trim();
            const mAcc = cl.match(/^\+(\d+)\s+to\s+Accuracy\s+Rating$/i);
            if (mAcc) weaponLocalAcc += Number(mAcc[1]);
          }
          if (weaponLocalAcc > 0) {
            const addedPhys = Math.floor((weaponLocalAcc * accAsPhysPct) / 100 + 1e-9);
            baseMin.Physical += addedPhys * atkMult;
            baseMax.Physical += addedPhys * atkMult;
          }
        }
      }
      if (weaponStats?.elementalDamage) {
        for (const [el, range] of Object.entries(weaponStats.elementalDamage)) {
          if (!range) continue;
          const dt = el as DamageType;
          baseMin[dt] += range[0] * atkMult;
          baseMax[dt] += range[1] * atkMult;
        }
      }
      const srcDmg = resolvedPartOrBaseDmg;
      if (srcDmg) {
        for (const dt of DAMAGE_TYPES) {
          const range = srcDmg[dt];
          if (range) {
            baseMin[dt] += range[0] * levelFactor;
            baseMax[dt] += range[1] * levelFactor;
          }
        }
      }
    }
  } else if (resolvedPartOrBaseDmg) {
    const srcDmg = resolvedPartOrBaseDmg;
    for (const dt of DAMAGE_TYPES) {
      const range = srcDmg[dt];
      if (range) {
        baseMin[dt] += range[0] * levelFactor;
        baseMax[dt] += range[1] * levelFactor;
      }
    }
  }
  // Supplement any missing damage types from `activeSkillData` (e.g. PoE 2 Cold-Infused Spark, Penance Brand, item skills)
  if (activeSkillData) {
    for (const dt of DAMAGE_TYPES) {
      const sMin = activeSkillData[`${dt}Min`];
      const sMax = activeSkillData[`${dt}Max`];
      if (typeof sMin === 'number' && typeof sMax === 'number' && (sMin > 0 || sMax > 0)) {
        if (baseMin[dt] === 0 && baseMax[dt] === 0) {
          baseMin[dt] = sMin;
          baseMax[dt] = sMax;
        }
      }
    }
  }

  // Detect active special support / buff gems (Rakiata's Flow, Garukhan's Resolve, Archmage, Ephemeral Edge, Righteous Fire)
  const linkedSupportNames = new Set<string>(compatibleSupportNames);
  let archmageLevel = 0;
  for (const gi of mainGroup.gems) {
    if (!gi.enabled) continue;
    const d = getGemById(build.game, gi.gemId);
    if (!d) continue;
    const lowerEn = d.name.en.trim().toLowerCase();
    linkedSupportNames.add(lowerEn);
    if (lowerEn === 'archmage' || lowerEn === 'archmage support') {
      archmageLevel = Math.max(archmageLevel, gi.level);
    }
  }
  if (build.game === 'poe2' && archmageLevel === 0) {
    for (const grp of build.skills) {
      if (!grp.enabled) continue;
      for (const gi of grp.gems) {
        if (!gi.enabled) continue;
        const d = getGemById(build.game, gi.gemId);
        if (d && d.name.en.trim().toLowerCase() === 'archmage') {
          archmageLevel = Math.max(archmageLevel, gi.level);
        }
      }
    }
  }
  let rfBuffLevel = 0;
  let rfArcaneDevotionLevel = 0;
  if (build.game === 'poe1' && activeDef.name.en.trim().toLowerCase() !== 'righteous fire') {
    for (const grp of build.skills) {
      if (!grp.enabled) continue;
      for (const gi of grp.gems) {
        if (!gi.enabled) continue;
        const d = getGemById(build.game, gi.gemId);
        const dn = d?.name.en.trim().toLowerCase();
        if (dn === 'righteous fire') {
          rfBuffLevel = Math.max(rfBuffLevel, gi.level);
        } else if (dn === 'righteous fire of arcane devotion') {
          rfArcaneDevotionLevel = Math.max(rfArcaneDevotionLevel, gi.level);
        }
      }
    }
  }
  if (rfBuffLevel > 0 && !isAttack) {
    const alreadyHasRfSpellMore = skillDb
      .calcStat('Damage', flags, kwFlags)
      .sources.some((s) => s.type === 'MORE' && s.source.toLowerCase().includes('righteous fire'));
    if (!alreadyHasRfSpellMore) {
      skillDb.addMod({
        name: 'Damage',
        type: 'MORE',
        value: 20 + (rfBuffLevel - 1),
        flags: ModFlag.Spell,
        keywordFlags: 0,
        source: `Righteous Fire (Lv.${rfBuffLevel})`,
      });
    }
  }
  if (
    rfArcaneDevotionLevel > 0 &&
    !isAttack &&
    _defence.lifeUnreserved > 1 &&
    _defence.mana > 0
  ) {
    const alreadyHasRfArcCastMore = skillDb
      .calcStat('Speed', flags, kwFlags)
      .sources.some((s) => s.type === 'MORE' && s.source.toLowerCase().includes('righteous fire'));
    if (!alreadyHasRfArcCastMore) {
      skillDb.addMod({
        name: 'Speed',
        type: 'MORE',
        value: 5 + (rfArcaneDevotionLevel - 1),
        flags: ModFlag.Cast,
        keywordFlags: 0,
        source: `Righteous Fire of Arcane Devotion (Lv.${rfArcaneDevotionLevel})`,
      });
    }
  }

  const hasEphemeralEdge = Boolean(
    activeWeapons.main && activeWeapons.main.name.trim().toLowerCase() === 'ephemeral edge',
  );
  const ephemeralAlreadyApplied = (postUniqueRes?.ephemeralEdgeLightningMax ?? 0) > 0;
  const isDetonateDeadHandledByPart = Boolean(resolvedPartStats?.corpseExplosionDamageType);
  const hasCompiledSkillMods = Boolean(
    (activeLevelEntry?.compiledMods ?? activeDef.compiledMods)?.length ||
      activeLevelEntry?.skillData ||
      activeDef.skillData,
  );
  const hasSkillDotData = Boolean(
    activeSkillData &&
      (typeof activeSkillData.PhysicalDot === 'number' ||
        typeof activeSkillData.FireDot === 'number' ||
        typeof activeSkillData.ColdDot === 'number' ||
        typeof activeSkillData.LightningDot === 'number' ||
        typeof activeSkillData.ChaosDot === 'number' ||
        activeSkillData.dotDamageByType),
  );
  const flickExtraPowerCharge =
    build.game === 'poe2' &&
    activeNameLower === 'flicker strike' &&
    weaponStats?.weaponType === 'Quarterstaff' &&
    skillDb.flag('QuarterstaffSkillsConsumeAdditionalPowerCharge', flags, kwFlags)
      ? 1
      : 0;
  const specialSkillDmg = computeSkillSpecialDamage(
    isDetonateDeadHandledByPart ? '__dd_handled_by_part__' : activeDef.name.en,
    build.game,
    {
      gemLevel: activeLevel,
      enemyLevel: build.config.enemyLevel,
      maxLife: _defence.life,
      maxMana: _defence.mana,
      maxEs: _defence.energyShield,
      ephemeralEdge: isAttack && hasEphemeralEdge && !ephemeralAlreadyApplied,
      powerCharges: activePowerCharges > 0 ? activePowerCharges + flickExtraPowerCharge : 0,
      stages:
        xmlExplicitStages ??
        (build.game === 'poe1' && activeNameLower === 'vaal flameblast' ? 15 : undefined),
      isChannelling: activeDef.tags.some((t) => t.toLowerCase() === 'channelling'),
      hasCompiledSkillMods,
      hasSkillDotData,
    },
  );
  for (const dt of DAMAGE_TYPES) {
    const extraRange = specialSkillDmg.flatAddedDamage[dt];
    if (extraRange) {
      baseMin[dt] += extraRange.min;
      baseMax[dt] += extraRange.max;
    }
  }
  if (specialSkillDmg.hitMoreMult !== 1) {
    skillDb.addMod({
      name: 'Damage',
      type: 'MORE',
      value: (specialSkillDmg.hitMoreMult - 1) * 100,
      flags: ModFlag.Hit,
      keywordFlags: 0,
      source: `${activeDef.name.en} Stage/Skill Multiplier`,
    });
  }

  // PoE 1 Archmage flat Lightning Damage from unreserved Mana (handle Lv21+ delta if Lv20 cmods exist)
  if (build.game === 'poe1' && archmageLevel > 0 && !isAttack) {
    const lMaxEntry = skillDb.entriesByPrefix('LightningMax').find(([k]) => k === 'LightningMax');
    const hasArchmageFlat = Boolean(
      lMaxEntry && lMaxEntry[1].some((m) => m.type === 'BASE' && /archmage/i.test(m.source)),
    );
    const am = computeArchmageBonus('poe1', _defence.manaUnreserved, archmageLevel);
    if (!hasArchmageFlat && am.flatLightningMax > 0) {
      baseMin.Lightning += am.flatLightningMin * effectiveness;
      baseMax.Lightning += am.flatLightningMax * effectiveness;
    } else if (hasArchmageFlat && archmageLevel > 20) {
      const am20 = computeArchmageBonus('poe1', _defence.manaUnreserved, 20);
      const deltaMin = Math.max(0, am.flatLightningMin - am20.flatLightningMin);
      const deltaMax = Math.max(0, am.flatLightningMax - am20.flatLightningMax);
      if (deltaMax > 0) {
        baseMin.Lightning += deltaMin * effectiveness;
        baseMax.Lightning += deltaMax * effectiveness;
      }
    }
  }
  // PoE 1 Mind of the Council: Attacks have Added Lightning Damage equal to X% of Maximum Mana
  if (build.game === 'poe1' && isAttack && _defence.mana > 0) {
    const motcPct = skillDb.sum('BASE', 'MindOfTheCouncilManaPct', flags, kwFlags);
    if (motcPct > 0) {
      const motcFlat = Math.floor((_defence.mana * motcPct) / 100);
      baseMin.Lightning += motcFlat * effectiveness;
      baseMax.Lightning += motcFlat * effectiveness;
    }
  }

  // PoE 1 Sacrifice Support (`sacrificeLifePercent` * `sacrificeLifeAsChaos` -> flat Chaos Spell Damage)
  if (build.game === 'poe1' && !isAttack && compatibleSupportNames.has('sacrifice') && _defence.life > 1) {
    const sacEntry = supportCandidates.find((s) => s.gem.id === 'poe1_supportsacrifice');
    const sacLv = sacEntry ? Math.min(40, Math.max(1, sacEntry.instance.level)) : 20;
    const sacLvData = sacEntry ? resolveGemLevelEntry(sacEntry.gem, sacLv)?.skillData : undefined;
    const sacLifePct = Number(
      sacLvData?.sacrificeLifePercent ?? sacEntry?.gem.skillData?.sacrificeLifePercent ?? 20,
    );
    const sacAsChaos = Number(
      sacLvData?.sacrificeLifeAsChaos ?? sacEntry?.gem.skillData?.sacrificeLifeAsChaos ?? 54,
    );
    const sacChaos = _defence.life * (sacLifePct / 100) * (sacAsChaos / 100);
    if (sacChaos > 0) {
      baseMin.Chaos += sacChaos * effectiveness;
      baseMax.Chaos += sacChaos * effectiveness;
    }
  }

  // PoE 1 Spellblade Support (adds 116..135% of 1H melee weapon / Energy Blade damage to supported Spells)
  if (
    build.game === 'poe1' &&
    !isAttack &&
    compatibleSupportNames.has('spellblade') &&
    mainWeaponStats &&
    !mainWeaponStats.twoHanded &&
    mainWeaponStats.weaponType !== 'Wand' &&
    mainWeaponStats.weaponType !== 'Bow'
  ) {
    const sbEntry = supportCandidates.find((s) => s.gem.id === 'poe1_supportspellblade');
    const sbLv = sbEntry ? Math.min(40, Math.max(1, sbEntry.instance.level)) : 20;
    const sbLvData = sbEntry ? resolveGemLevelEntry(sbEntry.gem, sbLv)?.skillData : undefined;
    const sbPct = Number(
      sbLvData?.spellbladeWeaponDamagePct ??
        sbEntry?.gem.skillData?.spellbladeWeaponDamagePct ??
        (115 + Math.min(20, sbLv) + Math.max(0, sbLv - 20) * 1.5),
    );
    const sbMult = (sbPct / 100) * effectiveness;
    baseMin.Physical += mainWeaponStats.physicalMin * sbMult;
    baseMax.Physical += mainWeaponStats.physicalMax * sbMult;
    if (mainWeaponStats.elementalDamage) {
      for (const [el, rng] of Object.entries(mainWeaponStats.elementalDamage)) {
        if (!rng) continue;
        const dt = el as DamageType;
        baseMin[dt] += rng[0] * sbMult;
        baseMax[dt] += rng[1] * sbMult;
      }
    }
  }

  // PoE 1 Spellslinger (adds Equipped Wand damage to supported Spells)
  if (
    build.game === 'poe1' &&
    !isAttack &&
    (skillDb.flag('Condition:SupportedBySpellslinger') ||
      linkedSupportNames.has('spellslinger') ||
      mainGroup.gems.some((g) => g.enabled && getGemById('poe1', g.gemId)?.id === 'poe1_spellslinger'))
  ) {
    const wands = [mainWeaponStats, offWeaponStats].filter(
      (w): w is NonNullable<typeof w> => Boolean(w && w.weaponType === 'Wand'),
    );
    for (const w of wands) {
      baseMin.Physical += w.physicalMin * effectiveness;
      baseMax.Physical += w.physicalMax * effectiveness;
      if (w.elementalDamage) {
        for (const [el, rng] of Object.entries(w.elementalDamage)) {
          if (!rng) continue;
          const dt = el as DamageType;
          baseMin[dt] += rng[0] * effectiveness;
          baseMax[dt] += rng[1] * effectiveness;
        }
      }
    }
  }

  // Add flat damage modifiers scaled by effectiveness (doubled when dual-wielding simultaneous hit skills)
  const flatEffectiveness = doubleHitsDualWield ? effectiveness * 2 : effectiveness;
  for (const dt of DAMAGE_TYPES) {
    const addMin = skillDb.sum('BASE', `${dt}Min`, flags, kwFlags);
    const addMax = skillDb.sum('BASE', `${dt}Max`, flags, kwFlags);
    baseMin[dt] += addMin * flatEffectiveness;
    baseMax[dt] += addMax * flatEffectiveness;
  }
  // PoE 1 Champion: Master of Metal (`You and nearby Allies deal 6 to 12 added Physical Damage for each Impale on Enemy`)
  if (build.game === 'poe1' && isAttack && skillDb.sum('BASE', 'ImpaleChance', flags, kwFlags) > 0) {
    const momMin = skillDb.sum('BASE', 'MasterOfMetalPhysMinPerImpale');
    const momMax = skillDb.sum('BASE', 'MasterOfMetalPhysMaxPerImpale');
    if (momMin > 0 || momMax > 0) {
      const momStacks = 5 + skillDb.sum('BASE', 'ImpaleStacksMax', flags, kwFlags);
      baseMin.Physical += momMin * momStacks * flatEffectiveness;
      baseMax.Physical += momMax * momStacks * flatEffectiveness;
    }
  }

  // PoE 1 Flame Wall: Added Fire Damage to Projectiles passing through Flame Wall (`flameWallAddedDamage`)
  if (
    build.game === 'poe1' &&
    (flags & ModFlag.Projectile) !== 0 &&
    Boolean(build.config.rawInputs?.flameWallAddedDamage) &&
    !skillDb.getEvalContext().conditions.FlameWallAddedDamage
  ) {
    skillDb.setCondition('FlameWallAddedDamage', true);
    for (const grp of build.skills) {
      if (!grp.enabled) continue;
      for (const gm of grp.gems) {
        if (!gm.enabled) continue;
        const gd = getGemById('poe1', gm.gemId);
        if (!gd || gd.name.en.trim().toLowerCase() !== 'flame wall') continue;
        const fwBonus = resolveGemBonuses(gd, baseBuses.playerDb, []);
        const fwLv = Math.min(40, Math.max(1, gm.level + fwBonus.levelBonus));
        const fwEntry = resolveGemLevelEntry(gd, fwLv);
        const fwCmods = fwEntry?.compiledMods ?? gd.compiledMods ?? [];
        const fMin = fwCmods.find((m) => m.name === 'FireMin' && typeof m.value === 'number')?.value;
        const fMax = fwCmods.find((m) => m.name === 'FireMax' && typeof m.value === 'number')?.value;
        if (typeof fMin === 'number' && typeof fMax === 'number' && fMax > 0) {
          const lvScale = fwEntry ? 1 : Math.pow(1.08, fwLv - 20);
          baseMin.Fire += fMin * lvScale * effectiveness;
          baseMax.Fire += fMax * lvScale * effectiveness;
        }
        break;
      }
    }
  }

  // PoE 2 Amazon Penetrate: Attacks using your Weapons have Added Physical Damage equal to 25% of Weapon Accuracy
  if (build.game === 'poe2' && isAttack && activeWeapons.main) {
    const penAccPct = skillDb.sum('BASE', 'AmazonPenetrateWeaponAccPct', flags, kwFlags);
    if (penAccPct > 0) {
      const expandedMain = expandPoe2LocalRunes
        ? expandPoe2LocalRunes(mainSlotLabel, activeWeapons.main)
        : activeWeapons.main;
      let localWepAcc = 0;
      for (const rawLine of [...expandedMain.implicits, ...expandedMain.explicits]) {
        const clean = rawLine.replace(/\{[^}]*\}/g, '').trim();
        const mAcc = clean.match(/^\+?(\d+) to Accuracy Rating$/i);
        if (mAcc) localWepAcc += Number(mAcc[1]);
      }
      const addedPhysFromAcc = Math.floor((localWepAcc * penAccPct) / 100);
      if (addedPhysFromAcc > 0) {
        baseMin.Physical += addedPhysFromAcc * effectiveness;
        baseMax.Physical += addedPhysFromAcc * effectiveness;
      }
    }
  }

  // PoE 2 Uptime Scaled Infernal Cry & Empowered / Ancestrally Boosted Attacks (`CalcOffence.lua:3458-3780`)
  const isPoe2ExertableMelee =
    build.game === 'poe2' &&
    isAttack &&
    (flags & ModFlag.Melee) !== 0 &&
    !effectiveSkillTypeSet.has('neverexertable') &&
    !effectiveSkillTypeSet.has('triggered') &&
    !effectiveSkillTypeSet.has('otherthingusesskill') &&
    activeNameLower !== 'mace strike';
  if (isPoe2ExertableMelee) {
    let infernalCryGem: { def: GemDefinition; level: number; quality: number; extraEmpowers: number; extraCdr: number } | undefined;
    for (const grp of build.skills) {
      if (!grp.enabled) continue;
      const icInst = grp.gems.find((g) => {
        if (!g.enabled) return false;
        const d = getGemById('poe2', g.gemId);
        return Boolean(d && d.name.en.trim().toLowerCase() === 'infernal cry');
      });
      if (icInst) {
        const icDef = getGemById('poe2', icInst.gemId)!;
        let extraEmpowers = 0;
        let extraCdr = 0;
        for (const sg of grp.gems) {
          if (!sg.enabled) continue;
          const sd = getGemById('poe2', sg.gemId);
          if (!sd || sd.category !== 'support') continue;
          const sn = sd.name.en.trim().toLowerCase();
          if (sn.startsWith('echoing cry')) extraEmpowers += 1;
          if (sn.startsWith('cooldown recovery')) extraCdr += sn.includes('ii') ? 35 : 25;
        }
        infernalCryGem = { def: icDef, level: icInst.level, quality: icInst.quality ?? 0, extraEmpowers, extraCdr };
        break;
      }
    }
    const estWepAps = weaponStats?.attacksPerSecond ?? 1.2;
    const estAtkSpd =
      estWepAps *
      (activeDef.attackSpeedMultiplier ?? 1) *
      Math.max(0.05, 1 + skillDb.sum('INC', 'Speed', flags, kwFlags) / 100) *
      skillDb.more('Speed', flags, kwFlags);
    let infernalUptime = 0;
    if (infernalCryGem) {
      const icLv = Math.min(40, Math.max(1, infernalCryGem.level));
      const lvEntry = resolveGemLevelEntry(infernalCryGem.def, icLv);
      const icCmods = lvEntry?.compiledMods ?? infernalCryGem.def.compiledMods ?? [];
      const basePerPower =
        (icCmods.find((m) => m.name === 'InfernalExtraFireDamageMultiplier' && typeof m.value === 'number')?.value as number | undefined) ??
        29 + icLv;
      const qualPerPower = Math.trunc(Math.max(0, infernalCryGem.quality) * 0.5);
      // PoB2 CalcPerform.lua:1413 & CalcOffence.lua:3504: InfernalExtraFireDamage = base + quality (not scaled by power/10)
      const infernalExtraFire = basePerPower + qualPerPower;
      const baseCd = typeof infernalCryGem.def.skillData?.cooldown === 'number' ? infernalCryGem.def.skillData.cooldown : 8;
      const cdrInc =
        skillDb.sum('INC', ['CooldownRecovery', 'WarcryCooldownRecovery']) + infernalCryGem.extraCdr;
      const hasWarcryNoCooldown = skillDb.flag('WarcryNoCooldown');
      const effIcCd = hasWarcryNoCooldown ? 0 : baseCd / Math.max(0.1, 1 + cdrInc / 100);
      const warcrySpdInc = skillDb.sum('INC', 'WarcrySpeed');
      const effIcCast = 0.8 / Math.max(0.1, 1 + warcrySpdInc / 100);
      const empowers = Math.max(
        1,
        1 +
          infernalCryGem.extraEmpowers +
          skillDb.sum('BASE', ['NumInfernalEmpowers', 'WarcryExtraEmpowers']),
      );
      const storedUses = Math.max(1, 1 + skillDb.sum('BASE', 'AdditionalCooldownUses'));
      infernalUptime =
        estAtkSpd > 0
          ? Math.min(1, Math.min((empowers / estAtkSpd) / Math.max(0.1, effIcCd + effIcCast), 1) * storedUses)
          : 0;
      const scaledFireGain = infernalExtraFire * infernalUptime;
      if (scaledFireGain > 0) {
        skillDb.addMod({
          name: 'DamageGainAsFire',
          type: 'BASE',
          value: scaledFireGain,
          flags: ModFlag.Melee,
          keywordFlags: 0,
          source: 'Uptime Scaled Infernal Cry',
        });
      }
    }
    const maxEmpFlag =
      skillDb.flag('MaxBoostedUptimeRatio', flags, kwFlags) ||
      skillDb.flag('MaxEmpoweredUptimeRatio', flags, kwFlags);
    const fowCd = skillDb.sum('BASE', 'FistOfWarCooldown', flags, kwFlags);
    const isSlamBoostEligible =
      effectiveSkillTypeSet.has('slam') &&
      !effectiveSkillTypeSet.has('vaal') &&
      !effectiveSkillTypeSet.has('otherthingusesskill');
    const fowUptime =
      fowCd > 0 && estAtkSpd > 0 && isSlamBoostEligible ? Math.min(1, (1 / estAtkSpd) / fowCd) : 0;
    const hasAncestralEmpowerment =
      isSlamBoostEligible && skillDb.flag('AncestralEmpowerment', flags, kwFlags);
    const ancestralUptime = skillDb.flag('MaxBoostedUptimeRatio', flags, kwFlags)
      ? 1
      : hasAncestralEmpowerment
        ? Math.min(1, 0.5 + fowUptime)
        : fowUptime;
    const empoweredUptime = maxEmpFlag ? 1 : Math.max(infernalUptime, ancestralUptime);
    if (empoweredUptime > 0) {
      const empInc = skillDb.sum('INC', ['EmpoweredIncrease', 'ExertIncrease'], flags, kwFlags);
      if (empInc !== 0) {
        skillDb.addMod({
          name: 'Damage',
          type: 'INC',
          value: empInc * empoweredUptime,
          flags: ModFlag.Attack,
          keywordFlags: 0,
          source: 'Uptime Scaled Empowered Attacks',
        });
      }
    }
    if (ancestralUptime > 0) {
      const ancInc = skillDb.sum('INC', 'AncestralBoostIncrease', flags, kwFlags);
      if (ancInc !== 0) {
        skillDb.addMod({
          name: 'Damage',
          type: 'INC',
          value: ancInc * ancestralUptime,
          flags: ModFlag.Attack,
          keywordFlags: 0,
          source: 'Uptime Scaled Ancestrally Boosted Attacks',
        });
      }
      // PoE 2 Ancestral Boost (`CalcOffence.lua:3691-3712`): only apply MORE damage when AncestralBoostMoreDamage or
      // Fist of War III (`Multiplier:AncestralBoostEffect`) grants it, and never inflate `showAverage` single-hit display (e.g. Sunder).
      const ancBoostEffExtra = skillDb.sum('BASE', 'Multiplier:AncestralBoostEffect', flags, kwFlags);
      const ancExplicitMore = skillDb.sum('BASE', 'AncestralBoostMoreDamage', flags, kwFlags);
      const ancMoreBase =
        ancExplicitMore > 0
          ? ancExplicitMore * Math.max(1, 1 + ancBoostEffExtra)
          : ancBoostEffExtra > 0 && !activeSkillData?.showAverage
            ? 30 * (1 + ancBoostEffExtra)
            : 0;
      if (ancMoreBase > 0) {
        skillDb.addMod({
          name: 'Damage',
          type: 'MORE',
          value: Math.round(ancMoreBase * ancestralUptime * 100) / 100,
          flags: ModFlag.Attack,
          keywordFlags: 0,
          source: 'Uptime Scaled Ancestral Boost',
        });
      }
    }
  }

  // Step B: Full PoE Conversion & Gain-as-Extra Pipeline (Physical -> Lightning -> Cold -> Fire -> Chaos)
  // PoE 2 strictly separates Conversion from Gain-as-Extra (Gained damage NEVER re-converts or double-dips into further Gains!)
  const DMG_BIT: Record<DamageType, number> = {
    Physical: 1,
    Lightning: 2,
    Cold: 4,
    Fire: 8,
    Chaos: 16,
  };
  const ELE_MASK = DMG_BIT.Lightning | DMG_BIT.Cold | DMG_BIT.Fire;
  const packets: Record<DamageType, Map<number, [number, number]>> = {
    Physical: new Map(),
    Lightning: new Map(),
    Cold: new Map(),
    Fire: new Map(),
    Chaos: new Map(),
  };
  const poe2GainPackets: Record<DamageType, Map<number, [number, number]>> = {
    Physical: new Map(),
    Lightning: new Map(),
    Cold: new Map(),
    Fire: new Map(),
    Chaos: new Map(),
  };
  const addPacketTo = (
    dest: Record<DamageType, Map<number, [number, number]>>,
    target: DamageType,
    mask: number,
    mn: number,
    mx: number,
  ) => {
    if (mn <= 0 && mx <= 0) return;
    const prev = dest[target].get(mask);
    if (prev) {
      prev[0] += mn;
      prev[1] += mx;
    } else {
      dest[target].set(mask, [mn, mx]);
    }
  };
  const addPacket = (target: DamageType, mask: number, mn: number, mx: number) =>
    addPacketTo(packets, target, mask, mn, mx);
  const addGainPacket = (target: DamageType, mask: number, mn: number, mx: number) =>
    addPacketTo(build.game === 'poe2' ? poe2GainPackets : packets, target, mask, mn, mx);
  for (const dt of DAMAGE_TYPES) {
    addPacket(dt, DMG_BIT[dt], baseMin[dt], baseMax[dt]);
  }

  const embitterOnlyCold = skillDb.flag('DamageGainIsOnlyCold', flags, kwFlags);

  const applyConversionStage = (
    source: DamageType,
    targets: readonly DamageType[],
    convModPrefix: string,
    gainModPrefix?: string,
  ) => {
    const srcEntries = [...packets[source].entries()];
    if (srcEntries.length === 0) return;
    const skillConvs = targets.map((t) => Math.max(0, skillDb.sum('BASE', `Skill${convModPrefix}${t}`, flags, kwFlags)));
    const skillConvSum = skillConvs.reduce((a, b) => a + b, 0);
    const skillScale = skillConvSum > 100 ? 100 / skillConvSum : 1;
    const scaledSkillConvs = skillConvs.map((v) => v * skillScale);
    const remForDb = Math.max(0, 100 - Math.min(100, skillConvSum));

    const dbConvs = targets.map((t) => Math.max(0, skillDb.sum('BASE', `${convModPrefix}${t}`, flags, kwFlags)));
    const dbConvSum = dbConvs.reduce((a, b) => a + b, 0);
    const dbScale = dbConvSum > remForDb && dbConvSum > 0 ? remForDb / dbConvSum : 1;

    const convPcts = targets.map((_, i) => scaledSkillConvs[i]! + dbConvs[i]! * dbScale);
    const convSum = convPcts.reduce((a, b) => a + b, 0);
    const convScale = convSum > 100 ? 100 / convSum : 1;
    const rawGainPcts = gainModPrefix
      ? targets.map((t) =>
          Math.max(
            0,
            skillDb.sum('BASE', `${gainModPrefix}${t}`, flags, kwFlags) +
              skillDb.sum('BASE', `Skill${gainModPrefix}${t}`, flags, kwFlags),
          ),
        )
      : targets.map(() => 0);
    const gainSum = rawGainPcts.reduce((a, b) => a + b, 0);
    const gainPcts = embitterOnlyCold
      ? targets.map((t) => (t === 'Cold' ? gainSum : 0))
      : rawGainPcts;
    if (convSum <= 0 && gainSum <= 0) return;

    const totalConvFrac = Math.min(1, (convSum * convScale) / 100);
    const remainingFrac = Math.max(0, 1 - totalConvFrac);
    packets[source].clear();

    for (const [mask, [mn, mx]] of srcEntries) {
      if (remainingFrac > 0) {
        addPacket(source, mask, mn * remainingFrac, mx * remainingFrac);
      }
      targets.forEach((target, i) => {
        const cFrac = (convPcts[i]! * convScale) / 100;
        const gFrac = gainPcts[i]! / 100;
        const nextMask = build.game === 'poe1' ? mask | DMG_BIT[target] : DMG_BIT[target];
        if (cFrac > 0) {
          addPacket(target, nextMask, mn * cFrac, mx * cFrac);
        }
        if (gFrac > 0) {
          addGainPacket(target, nextMask, mn * gFrac, mx * gFrac);
        }
      });
    }
  };

  applyConversionStage('Physical', ['Lightning', 'Cold', 'Fire', 'Chaos'], 'PhysicalDamageConvertTo', 'PhysicalDamageGainAs');
  applyConversionStage('Lightning', ['Cold', 'Fire', 'Chaos'], 'LightningDamageConvertTo', 'LightningDamageGainAs');
  applyConversionStage('Cold', ['Fire', 'Chaos'], 'ColdDamageConvertTo', 'ColdDamageGainAs');
  applyConversionStage('Fire', ['Chaos'], 'FireDamageConvertTo', 'FireDamageGainAs');

  // Elemental Damage Gain as Extra Fire / Cold / Lightning / Chaos (PoE 2 RC-1: 7+ builds!)
  for (const destType of ['Fire', 'Cold', 'Lightning', 'Chaos'] as const) {
    const eleExtraPct = skillDb.sum('BASE', `ElementalDamageGainAs${destType}`, flags, kwFlags);
    if (eleExtraPct <= 0) continue;
    const frac = eleExtraPct / 100;
    const targetType: DamageType = embitterOnlyCold ? 'Cold' : destType;
    for (const el of ['Lightning', 'Cold', 'Fire'] as const) {
      for (const [mask, [mn, mx]] of packets[el].entries()) {
        const nextMask = build.game === 'poe1' ? mask | DMG_BIT[targetType] : DMG_BIT[targetType];
        addGainPacket(targetType, nextMask, mn * frac, mx * frac);
      }
    }
  }

  // Generic "Gain X% of Damage as Extra Physical/Fire/Cold/Lightning/Chaos/Random Element Damage" (including SkillDamageGainAs* & Embitter)
  const randomEleExtra =
    skillDb.sum('BASE', ['DamageGainAsRandom', 'DamageGainAsRandomElement', 'SkillDamageGainAsRandomElement'], flags, kwFlags) / 3;
  const rawGenericExtraPcts: Record<DamageType, number> = {
    Physical: skillDb.sum('BASE', ['DamageGainAsPhysical', 'SkillDamageGainAsPhysical'], flags, kwFlags),
    Fire: skillDb.sum('BASE', ['DamageGainAsFire', 'SkillDamageGainAsFire'], flags, kwFlags) + randomEleExtra,
    Cold: skillDb.sum('BASE', ['DamageGainAsCold', 'SkillDamageGainAsCold'], flags, kwFlags) + randomEleExtra,
    Lightning: skillDb.sum('BASE', ['DamageGainAsLightning', 'SkillDamageGainAsLightning'], flags, kwFlags) + randomEleExtra,
    Chaos: skillDb.sum('BASE', ['DamageGainAsChaos', 'SkillDamageGainAsChaos'], flags, kwFlags),
  };
  const totalGenericExtraSum =
    rawGenericExtraPcts.Physical +
    rawGenericExtraPcts.Fire +
    rawGenericExtraPcts.Cold +
    rawGenericExtraPcts.Lightning +
    rawGenericExtraPcts.Chaos;
  const genericExtraPcts: Record<DamageType, number> = embitterOnlyCold
    ? { Physical: 0, Fire: 0, Cold: totalGenericExtraSum, Lightning: 0, Chaos: 0 }
    : rawGenericExtraPcts;
  if (totalGenericExtraSum > 0) {
    let totalPreMin = 0;
    let totalPreMax = 0;
    for (const dt of DAMAGE_TYPES) {
      for (const [mn, mx] of packets[dt].values()) {
        totalPreMin += mn;
        totalPreMax += mx;
      }
    }
    for (const target of DAMAGE_TYPES) {
      const pct = genericExtraPcts[target];
      if (pct > 0) {
        const extraFrac = pct / 100;
        addGainPacket(target, DMG_BIT[target], totalPreMin * extraFrac, totalPreMax * extraFrac);
      }
    }
  }

  // PoE 2 Archmage: Gain X% of ALL Damage as Extra Fire/Cold/Lightning/Chaos per 100 Maximum Mana (Non-Channelling Spells)
  const isChannellingSkill = activeDef.tags.some((t) => t.toLowerCase() === 'channelling');
  if (!isAttack && !isChannellingSkill && _defence.mana >= 100) {
    const manaHundreds = Math.floor(_defence.mana / 100);
    let totalPreMin = 0;
    let totalPreMax = 0;
    for (const dt of DAMAGE_TYPES) {
      for (const [mn, mx] of packets[dt].values()) {
        totalPreMin += mn;
        totalPreMax += mx;
      }
    }
    let appliedPerMana100 = false;
    for (const target of ['Fire', 'Cold', 'Lightning', 'Chaos'] as const) {
      const per100 = skillDb.sum('BASE', `SpellGainAs${target}PerMana100`, flags, kwFlags);
      if (per100 > 0) {
        appliedPerMana100 = true;
        const extraFrac = (per100 * manaHundreds) / 100;
        addGainPacket(target, DMG_BIT[target], totalPreMin * extraFrac, totalPreMax * extraFrac);
      }
    }
    const hasArchmageGainCmod = skillDb
      .calcStat('DamageGainAsLightning', flags, kwFlags)
      .sources.some((s) => s.source.toLowerCase().includes('archmage'));
    if (!appliedPerMana100 && !hasArchmageGainCmod && build.game === 'poe2' && archmageLevel > 0) {
      const am2 = computeArchmageBonus('poe2', _defence.mana, archmageLevel);
      if (am2.gainAsExtraLightningPct > 0) {
        const extraFrac = am2.gainAsExtraLightningPct / 100;
        addGainPacket('Lightning', DMG_BIT.Lightning, totalPreMin * extraFrac, totalPreMax * extraFrac);
      }
    }
  }

  if (build.game === 'poe2') {
    for (const dt of DAMAGE_TYPES) {
      for (const [mask, [mn, mx]] of poe2GainPackets[dt].entries()) {
        addPacket(dt, mask, mn, mx);
      }
    }
  }

  const finalBaseMin: Record<DamageType, number> = { Physical: 0, Lightning: 0, Cold: 0, Fire: 0, Chaos: 0 };
  const finalBaseMax: Record<DamageType, number> = { Physical: 0, Lightning: 0, Cold: 0, Fire: 0, Chaos: 0 };
  const finalBaseAvg: Record<DamageType, number> = { Physical: 0, Lightning: 0, Cold: 0, Fire: 0, Chaos: 0 };
  for (const dt of DAMAGE_TYPES) {
    for (const [mn, mx] of packets[dt].values()) {
      finalBaseMin[dt] += mn;
      finalBaseMax[dt] += mx;
    }
    finalBaseAvg[dt] = (finalBaseMin[dt] + finalBaseMax[dt]) / 2;
  }

  // Step C: Enemy mitigation & DamageTaken from groupEnemyDb (with Double & Triple Damage + High-Impact Mine aura)
  const ruleset = getRuleset(build.game);
  let highImpactMineDd = 0;
  let mineNearbyTakenInc = 0;
  if (build.game === 'poe1') {
    const isMineEarly =
      effectiveSkillTypeSet.has('mine') ||
      effectiveSkillTypeSet.has('remotemined') ||
      activeDef.tags.some((t) => t.toLowerCase() === 'mine');
    const minePerDd = groupEnemyDb.sum('BASE', 'SelfDoubleDamageChance', flags, kwFlags);
    const rawCfgMines =
      build.config.rawInputs?.multiplierActiveMines ??
      build.config.rawInputs?.activeMineCount ??
      (isMineEarly ? build.config.rawInputs?.multiplierMineDetonatedRecently : undefined);
    const parsedCfgMines = rawCfgMines !== undefined ? Number(rawCfgMines) : 0;
    const maxActiveMines = Math.max(1, 15 + Math.round(skillDb.sum('BASE', 'ActiveMineLimit', flags, kwFlags)));
    const effMines =
      Number.isFinite(parsedCfgMines) && parsedCfgMines > 0
        ? Math.min(maxActiveMines, Math.max(1, parsedCfgMines))
        : 0;
    if (minePerDd > 0 && effMines > 0) {
      const mineAuraMult = Math.max(0, 1 + skillDb.sum('INC', ['MineAuraEffect', 'AuraEffect'], flags, kwFlags) / 100);
      highImpactMineDd = Math.floor(minePerDd * effMines * mineAuraMult + 1e-9);
    }
    const mineTakenCap = skillDb.sum('BASE', 'MineNearbyEnemyDmgTakenCap', flags, kwFlags);
    if (mineTakenCap > 0 && (effMines > 0 || isMineEarly)) {
      mineNearbyTakenInc = Math.min(mineTakenCap, Math.max(1, effMines || 5) * 2);
    }
  }
  const baseDoubleDamagePct = skillDb.sum('BASE', 'DoubleDamageChance', flags, kwFlags) + highImpactMineDd;
  const hasEleSkillTriple =
    skillDb.flag('TripleDamageElementalSkill') &&
    ((kwFlags & (KeywordFlag.Fire | KeywordFlag.Cold | KeywordFlag.Lightning)) !== 0 ||
      activeDef.tags.some((t) => /^(fire|cold|lightning|elemental|prismatic)$/i.test(t)));
  const baseTripleDamagePct =
    (hasEleSkillTriple ? 100 : 0) +
    skillDb.sum('BASE', 'TripleDamageChance', flags, kwFlags) +
    groupEnemyDb.sum('BASE', 'SelfTripleDamageChance', flags, kwFlags);

  // DamageTakenConsecratedGround applies ONLY when the ENEMY is on Consecrated Ground (not player-only conditionOnConsecratedGround!).
  const enemyOnConsecGround = Boolean(
    groupEnemyDb.getEvalContext().conditions.OnConsecratedGround ||
      skillDb.getEvalContext().conditions.EnemyOnConsecratedGround ||
      build.config.rawInputs?.conditionEnemyOnConsecratedGround,
  );
  const consecGroundTakenInc = enemyOnConsecGround
    ? Math.floor(
        groupEnemyDb.sum('INC', 'DamageTakenConsecratedGround') *
          Math.max(0, 1 + skillDb.sum('INC', 'ConsecratedGroundEffect') / 100) +
          1e-9,
      )
    : 0;
  const yokePerAilment = skillDb.sum('BASE', 'EnemyDamageTakenPerAilmentType', flags, kwFlags);
  let yokeTakenInc = 0;
  if (yokePerAilment > 0) {
    const pConds = skillDb.getEvalContext().conditions;
    const eConds = groupEnemyDb.getEvalContext().conditions;
    let ailmentTypes = 0;
    for (const [pKey, eKey] of [
      ['EnemyIgnited', 'Ignited'],
      ['EnemyChilled', 'Chilled'],
      ['EnemyFrozen', 'Frozen'],
      ['EnemyShocked', 'Shocked'],
      ['EnemyBleeding', 'Bleeding'],
      ['EnemyPoisoned', 'Poisoned'],
      ['EnemyScorched', 'Scorched'],
      ['EnemyBrittle', 'Brittle'],
      ['EnemySapped', 'Sapped'],
    ] as const) {
      if (pConds[pKey] || eConds[eKey]) ailmentTypes++;
    }
    yokeTakenInc = yokePerAilment * ailmentTypes;
  }
  const enemyGlobalDmgTakenInc =
    groupEnemyDb.sum('INC', 'DamageTaken', flags, kwFlags) +
    ((flags & ModFlag.Projectile) !== 0 ? groupEnemyDb.sum('INC', 'ProjectileDamageTaken', flags, kwFlags) : 0) +
    ((flags & ModFlag.Area) !== 0 ? groupEnemyDb.sum('INC', 'AreaDamageTaken', flags, kwFlags) : 0) +
    consecGroundTakenInc +
    yokeTakenInc +
    mineNearbyTakenInc;
  const enemyGlobalDmgTakenMore = groupEnemyDb.more('DamageTaken', flags, kwFlags);
  const curseEleRes = groupEnemyDb.sum('BASE', 'ElementalResist', flags, kwFlags);
  // PoE 2 Exposure (`CalcPerform.lua:3478-3509`): take the SINGLE strongest Fire/Cold/LightningExposure source
  // (never sum stacking sources like Primal Strikes 50 + Lightning Exposure Support 20!), then scale by ExposureEffect & boss -50% ExposureEffectOnSelf.
  // Also normalize raw Fire/Cold/LightningResist BASE < 0 injected directly by main-skill Exposure gems (e.g. Frost Bomb as main skill!).
  if (build.game === 'poe2' && (activeNameLower === 'frost bomb' || activeNameLower === 'primal strikes')) {
    const els: ReadonlyArray<'Fire' | 'Cold' | 'Lightning'> = ['Fire', 'Cold', 'Lightning'];
    const mainSkillSrc = `Skill: ${activeDef.name.en}`;
    for (const el of els) {
      const stName = `${el}Resist`;
      for (const s of groupEnemyDb.calcStat(stName).sources) {
        if (s.type === 'BASE' && typeof s.value === 'number' && s.value < 0 && s.source === mainSkillSrc) {
          groupEnemyDb.addMod({ name: stName, type: 'BASE', value: -s.value, flags: 0, keywordFlags: 0, source: `Normalize Main Exposure (${activeDef.name.en})` });
          groupEnemyDb.addMod({ name: `${el}Exposure`, type: 'MAX', value: Math.abs(s.value), flags: 0, keywordFlags: 0, source: mainSkillSrc });
        }
      }
    }
  }
  const resolvePoe2Exposure = (el: 'Fire' | 'Cold' | 'Lightning'): number => {
    if (build.game !== 'poe2') return 0;
    const expSources = groupEnemyDb.calcStat(`${el}Exposure`).sources;
    let rawExp = Math.max(0, groupEnemyDb.max(`${el}Exposure`) ?? 0);
    for (const s of expSources) {
      if ((s.type === 'BASE' || s.type === 'MAX') && typeof s.value === 'number' && s.value > rawExp) {
        rawExp = s.value;
      }
    }
    if (rawExp <= 0) return 0;
    const extraExp =
      groupEnemyDb.sum('BASE', ['ExtraExposure', `Extra${el}Exposure`]) +
      skillDb.sum('BASE', ['ExtraExposure', `Extra${el}Exposure`]);
    const expEffInc =
      skillDb.sum('INC', ['ExposureEffect', `${el}ExposureEffect`]) +
      groupEnemyDb.sum('INC', ['ExposureEffect', `${el}ExposureEffect`]);
    const expOnSelfMore = groupEnemyDb.more('ExposureEffectOnSelf');
    return Math.floor((rawExp + extraExp) * Math.max(0, 1 + expEffInc / 100) * expOnSelfMore + 1e-9);
  };
  const poe2FireExp = resolvePoe2Exposure('Fire');
  const poe2ColdExp = resolvePoe2Exposure('Cold');
  const poe2LightExp = resolvePoe2Exposure('Lightning');
  const curseFireRes = curseEleRes + groupEnemyDb.sum('BASE', 'FireResist', flags, kwFlags) - poe2FireExp;
  const curseColdRes = curseEleRes + groupEnemyDb.sum('BASE', 'ColdResist', flags, kwFlags) - poe2ColdExp;
  const curseLightRes = curseEleRes + groupEnemyDb.sum('BASE', 'LightningResist', flags, kwFlags) - poe2LightExp;
  const curseChaosRes = groupEnemyDb.sum('BASE', 'ChaosResist', flags, kwFlags);

  // Step D: Accuracy / Hit Chance (exact PoE 1 & PoE 2 PoB formulas incl. Enemy Blind & AccuracyVsEnemy)
  let hitChance = 100;
  const cannotBeEvaded =
    skillDb.flag('HitsCantBeEvaded', flags, kwFlags) ||
    skillDb.flag('CannotBeEvaded', flags, kwFlags) ||
    Boolean(activeSkillData?.cannotBeEvaded);
  const canExceedHitChance =
    build.game === 'poe2' &&
    isAttack &&
    (skillDb.flag('HitChanceCanExceed100', flags, kwFlags) ||
      skillDb.flag('Condition:HitChanceCanExceed100', flags, kwFlags));
  if (isAttack && (!cannotBeEvaded || canExceedHitChance)) {
    let accuracy = Math.max(
      1,
      skillDb.calcStat('Accuracy', flags, kwFlags).total * skillDb.more('AccuracyVsEnemy', flags, kwFlags),
    );
    // PoE 2 Accuracy distance falloff (`CalcOffence.lua:2715-2731`: AccuracyFalloffStart=20, End=90, MaxPenalty=90%)
    if (build.game === 'poe2' && !skillDb.flag('NoAccuracyDistancePenalty', flags, kwFlags)) {
      const rawEnemyDist = Number(
        build.config.rawInputs?.enemyDistance ??
          build.config.rawInputs?.projectileDistance ??
          20,
      );
      const distUnits = Number.isFinite(rawEnemyDist) ? rawEnemyDist : 20;
      const distCapped = Math.max(20, Math.min(90, distUnits));
      if (distCapped > 20) {
        const penMod =
          Math.max(0, 1 + skillDb.sum('INC', 'AccuracyPenalty', flags, kwFlags) / 100) *
          skillDb.more('AccuracyPenalty', flags, kwFlags);
        const maxPenPct = Math.floor(90 * penMod);
        const accPenaltyFactor = Math.max(0.05, 1 - ((distCapped - 20) / 70) * (maxPenPct / 100));
        accuracy = Math.max(1, Math.floor(accuracy * accPenaltyFactor));
      }
    }
    const enemyEvaBase = Math.max(0, build.config.enemyEvasion + groupEnemyDb.sum('BASE', 'Evasion'));
    const enemyBlindMult =
      (build.config.enemyBlinded ||
        groupEnemyDb.getEvalContext().conditions.Blinded ||
        skillDb.getEvalContext().conditions.EnemyBlinded)
        ? Math.max(0.1, 1 - 0.2 * Math.max(0, 1 + skillDb.sum('INC', 'BlindEffect') / 100))
        : 1;
    const enemyEva = Math.max(
      1,
      enemyEvaBase *
        Math.max(0.1, 1 + groupEnemyDb.sum('INC', 'Evasion') / 100) *
        groupEnemyDb.more('Evasion') *
        enemyBlindMult,
    );
    const hitChanceMod =
      Math.max(0, 1 + skillDb.sum('INC', 'HitChance', flags, kwFlags) / 100) *
      skillDb.more('HitChance', flags, kwFlags);
    const rawHitChance =
      build.game === 'poe2'
        ? ((accuracy * 1.25) / (accuracy + enemyEva * 0.3)) * 100
        : (accuracy / (accuracy + Math.pow(enemyEva / 5, 0.9))) * 125;
    if (!cannotBeEvaded) {
      hitChance = Math.min(100, Math.max(5, Math.round(rawHitChance) * hitChanceMod));
    }
    if (canExceedHitChance) {
      const hasAscCriticalStrike = skillDb
        .calcStat('BaseCritChance', flags, kwFlags)
        .sources.some((s) => s.source === 'Ascendancy: Critical Strike');
      const uncappedHitChance = Math.max(
        hitChance,
        Math.max(5, Math.round(rawHitChance)) * hitChanceMod,
      );
      if (!hasAscCriticalStrike && uncappedHitChance > 100) {
        skillDb.setMultiplier('ExcessHitChance', Math.round((uncappedHitChance - 100) * 100) / 100);
      }
    }
  }

  // Precise Technique & Point Blank (PoE 1)
  if (build.game === 'poe1' && isAttack) {
    const ptMorePct = skillDb.sum('BASE', 'PreciseTechniqueMorePct', flags, kwFlags);
    if (ptMorePct > 0) {
      const accCheck = skillDb.calcStat('Accuracy', flags, kwFlags).total;
      if (accCheck > _defence.life) {
        skillDb.addMod({
          name: 'Damage',
          type: 'MORE',
          value: ptMorePct,
          flags: ModFlag.Attack,
          keywordFlags: 0,
          source: 'Precise Technique',
        });
      }
    }
    if (skillDb.flag('FarShot', flags, kwFlags) && (flags & ModFlag.Projectile) !== 0) {
      const projDist = Number(build.config.rawInputs?.projectileDistance ?? 0);
      if (projDist > 0) {
        let fsMore = 0;
        if (projDist <= 10) fsMore = -20;
        else if (projDist <= 35) fsMore = -20 * (1 - (projDist - 10) / 25);
        else fsMore = 30 * Math.min(1, (projDist - 35) / 35);
        if (fsMore !== 0) {
          skillDb.addMod({
            name: 'Damage',
            type: 'MORE',
            value: Math.round(fsMore * 100) / 100,
            flags: ModFlag.Attack | ModFlag.Hit | ModFlag.Projectile,
            keywordFlags: 0,
            source: 'Far Shot',
          });
        }
      }
    }
    if (skillDb.flag('PointBlank', flags, kwFlags) && (flags & ModFlag.Projectile) !== 0) {
      const projDist = Number(build.config.rawInputs?.projectileDistance ?? 0);
      if (projDist > 0) {
        let pbMore = 0;
        if (projDist <= 10) pbMore = 30;
        else if (projDist <= 35) pbMore = 30 * (1 - (projDist - 10) / 25);
        else pbMore = -30 * Math.min(1, (projDist - 35) / 115);
        if (pbMore !== 0) {
          skillDb.addMod({
            name: 'Damage',
            type: 'MORE',
            value: pbMore,
            flags: ModFlag.Attack | ModFlag.Hit | ModFlag.Projectile,
            keywordFlags: 0,
            source: 'Point Blank',
          });
        }
      }
    }
  } else if (
    build.game === 'poe2' &&
    isAttack &&
    (flags & ModFlag.Projectile) !== 0 &&
    skillDb.flag('PointBlank', flags, kwFlags)
  ) {
    // PoE 2 Point Blank (`Tree:41875` / Deadeye): up to 20% MORE within 3.5m (35 units), scaling to 0% at 7m (70 units)
    // Skip if already injected via `modParserPoe2` DistanceRamp rule so it never double-counts.
    const alreadyHasPbRamp = skillDb
      .calcStat('Damage', flags, kwFlags)
      .sources.some((s) => s.type === 'MORE' && s.source.toLowerCase().includes('point blank'));
    if (!alreadyHasPbRamp) {
      const dist = Number(
        build.config.rawInputs?.enemyDistance ?? build.config.rawInputs?.projectileDistance ?? 20,
      );
      const d = Number.isFinite(dist) ? dist : 20;
      const pbMore = d <= 35 ? 20 : d >= 70 ? 0 : 20 * (1 - (d - 35) / 35);
      if (pbMore > 0) {
        skillDb.addMod({
          name: 'Damage',
          type: 'MORE',
          value: Math.round(pbMore * 100) / 100,
          flags: ModFlag.Attack | ModFlag.Hit | ModFlag.Projectile,
          keywordFlags: 0,
          source: 'Point Blank',
        });
      }
    }
  }

  // Step E: Crit Chance & Crit Multiplier (PoE 1 additive CritMulti vs PoE 2 scaled CritDamageBonus + Lucky/Bifurcated)
  const neverCrit = skillDb.flag('NeverCrit', flags, kwFlags);
  const isPoe1PerfectAgony = build.game === 'poe1' && skillDb.flag('PerfectAgony', flags, kwFlags);
  const noCritExtra =
    skillDb.flag('NoCritExtraDamage', flags, kwFlags) ||
    skillDb.flag('NoExtraDamageFromCrits', flags, kwFlags) ||
    skillDb.flag('ElementalOverload', flags, kwFlags) ||
    isPoe1PerfectAgony;
  const hasDiamondShrine = skillDb.flag('DiamondShrineCrit');
  const enemyCritBonus = groupEnemyDb.sum('BASE', 'SelfCritChance', flags, kwFlags);
  let flatBaseCrit = skillDb.sum('BASE', ['BaseCritChance', 'CritChance'], flags, kwFlags);
  const enemyCritMulti = groupEnemyDb.sum('BASE', 'SelfCritMultiplier', flags, kwFlags);
  const weaponCritOverride = skillDb.override('WeaponBaseCritChance', flags, kwFlags);
  let spellCritOverride =
    skillDb.override('SpellBaseCritOverride', flags, kwFlags) ??
    (skillDb.sum('BASE', 'SpellBaseCritOverride', flags, kwFlags) || null);
  // PoE 1 Sandstorm Visage: Base Spell Critical Strike Chance is equal to Main Hand Weapon Crit Chance
  if (
    build.game === 'poe1' &&
    !isAttack &&
    skillDb.flag('SpellCritChanceFromMainHandWeapon', flags, kwFlags) &&
    mainWeaponStats &&
    mainWeaponStats.critChance > 0
  ) {
    spellCritOverride = mainWeaponStats.critChance;
  }
  // PoE 1 Seething Fury: +OffHandBaseCritPer10ShieldEs & +OffHandCritMultiPer10ShieldEs on off-hand shield attacks
  let seethingFuryCritMulti = 0;
  if (build.game === 'poe1' && isShieldOffHandAttack) {
    const shieldEsVal = skillDb.getEvalContext().stats.ShieldES ?? 0;
    const shieldEs10 = Math.floor(shieldEsVal / 10);
    if (shieldEs10 > 0) {
      const sfCritPer10 = skillDb.sum('BASE', 'OffHandBaseCritPer10ShieldEs', flags, kwFlags);
      const sfMultiPer10 = skillDb.sum('BASE', 'OffHandCritMultiPer10ShieldEs', flags, kwFlags);
      if (sfCritPer10 > 0) flatBaseCrit += shieldEs10 * sfCritPer10;
      if (sfMultiPer10 > 0) seethingFuryCritMulti = shieldEs10 * sfMultiPer10;
    }
  }
  const sdataBaseCrit =
    typeof activeSkillData?.CritChance === 'number' && activeSkillData.CritChance > 0
      ? activeSkillData.CritChance
      : undefined;
  const rawWeaponBaseCrit =
    offHandSetMin !== undefined
      ? (sdataBaseCrit ?? activeDef.baseCritChance ?? 5)
      : isUnarmedConcoction
        ? (sdataBaseCrit ?? activeDef.baseCritChance ?? 0)
        : isDualWield && mainWeaponStats && offWeaponStats
          ? (mainWeaponStats.critChance + offWeaponStats.critChance) / 2
          : (weaponStats?.critChance ?? sdataBaseCrit ?? activeDef.baseCritChance ?? 5);
  const weaponBaseCrit = weaponCritOverride !== null ? weaponCritOverride : rawWeaponBaseCrit;
  const resolvedSkillBaseCrit = !isAttack && spellCritOverride !== null
    ? spellCritOverride
    : isAttack
      ? weaponBaseCrit
      : (sdataBaseCrit ?? activeDef.baseCritChance ?? 6);
  const baseCrit = resolvedSkillBaseCrit + enemyCritBonus + flatBaseCrit;
  // PoE 2 Inexorable Critical I / II (`SecondsSinceInevitableCrit` default 10s + `InevitableCritCap` / `InevitableCritMultCap` clamping)
  if (build.game === 'poe2') {
    const inevCritCap = skillDb.sum('BASE', 'Multiplier:InevitableCritCap', flags, kwFlags);
    if (inevCritCap > 0) {
      const inevMultCap = skillDb.sum('BASE', 'Multiplier:InevitableCritMultCap', flags, kwFlags);
      const rawInevSecs =
        typeof build.config.rawInputs?.SecondsSinceInevitableCrit === 'number'
          ? build.config.rawInputs.SecondsSinceInevitableCrit
          : 10;
      const satSecs = inevMultCap < 0 ? 5 : 10;
      const clampedSecs = Math.max(0, Math.min(rawInevSecs, satSecs));
      skillDb.setMultiplier('SecondsSinceInevitableCrit', clampedSecs);
      if (rawInevSecs < 4) {
        skillDb.setCondition('CritRecently', true);
        skillDb.setCondition('SkillCritRecently', true);
      }
    }
  }
  const critInc = skillDb.sum('INC', 'CritChance', flags, kwFlags);
  const critMore = skillDb.more('CritChance', flags, kwFlags);
  const hasGarukhansResolve = linkedSupportNames.has("garukhan's resolve");
  const hasBifurcatedCrit = hasGarukhansResolve || skillDb.flag('BifurcateCrit', flags, kwFlags);
  const critChanceCapOverride =
    skillDb.override('CritChanceCap', flags, kwFlags) ??
    (hasGarukhansResolve ? 50 : null);
  const effLowLife = Boolean(skillDb.getEvalContext().conditions.LowLife);
  const effFullLife = Boolean(skillDb.getEvalContext().conditions.FullLife);

  let critChance: number;
  let critMultiplier: number;
  let effectiveCritMultiplier: number;
  let rawPoe1CritMulti = 150;

  if (build.game === 'poe2') {
    const flatCritBonus = skillDb.sum('BASE', 'CritDamageBonusFlat', flags, kwFlags);
    const incCritBonus =
      Math.max(0, skillDb.sum('BASE', 'CritMultiplier', flags, kwFlags) - ruleset.baseCritMultiplier) +
      skillDb.sum('INC', 'CritDamageBonusInc', flags, kwFlags) +
      skillDb.sum('INC', 'CritMultiplier', flags, kwFlags);
    const paLowLifeMore =
      effLowLife ? skillDb.sum('BASE', 'CritDamageBonusLowLifeMore', flags, kwFlags) : 0;
    const paFullLifeMore =
      effFullLife ? skillDb.sum('BASE', 'CritDamageBonusFullLifeMore', flags, kwFlags) : 0;
    const moreCritBonusMult =
      skillDb.more('CritDamageBonusInc', flags, kwFlags) *
      skillDb.more('CritMultiplier', flags, kwFlags) *
      (1 + paLowLifeMore / 100) *
      (1 + paFullLifeMore / 100);
    const overridePoe2Bonus = skillDb.override('CritDamageBonusOverride', flags, kwFlags);
    const hasInevitable = skillDb.flag('InevitableCriticalHits', flags, kwFlags);
    const poe2Crit = computePoe2CritMultiplier({
      baseCritChance: hasDiamondShrine ? 100 : baseCrit,
      incCritChancePct: critInc,
      moreCritChanceMult: critMore,
      ...(critChanceCapOverride !== null ? { critChanceCap: critChanceCapOverride } : {}),
      ...(isAttack ? { accuracyHitChancePct: hitChance } : {}),
      flatBonusPct: flatCritBonus,
      incBonusPct: incCritBonus,
      moreBonusMult: moreCritBonusMult,
      ...(overridePoe2Bonus !== null ? { overrideBonusPct: overridePoe2Bonus } : {}),
      enemyExtraCritFlatPct: enemyCritMulti,
      enemyExtraCritIncPct: groupEnemyDb.sum('INC', 'SelfCritMultiplier', flags, kwFlags),
      luckyCrit:
        skillDb.flag('CritChanceIsLucky', flags, kwFlags) ||
        skillDb.flag('CritChanceLucky', flags, kwFlags),
      bifurcatedCrit: hasBifurcatedCrit,
      inevitableCrits: hasInevitable,
      neverCrit,
      noCritMultiplier: noCritExtra,
    });
    const effPoe2Crit =
      (hasDiamondShrine || (hasInevitable && poe2Crit.effectiveCritChance > 0)) && !neverCrit
        ? 100
        : poe2Crit.effectiveCritChance;
    critChance = hasInevitable && effPoe2Crit >= 100
      ? 100
      : Math.round(effPoe2Crit * 100) / 100;
    critMultiplier = neverCrit ? 0 : Math.round(poe2Crit.critMultiplierPct);
    effectiveCritMultiplier =
      neverCrit || noCritExtra ? 1 : 1 + (critChance / 100) * Math.max(0, poe2Crit.critMultiplierPct / 100 - 1);
  } else {
    const preLuckyCrit = neverCrit
      ? 0
      : hasDiamondShrine
        ? 100
        : Math.min(100, baseCrit * (1 + critInc / 100) * critMore);
    const isLuckyCrit =
      skillDb.flag('CritChanceIsLucky', flags, kwFlags) ||
      skillDb.flag('CritChanceLucky', flags, kwFlags);
    const preBifurcateCrit =
      isLuckyCrit && !neverCrit && !hasDiamondShrine
        ? (1 - Math.pow(1 - preLuckyCrit / 100, 2)) * 100
        : preLuckyCrit;
    let postUseCrit =
      hasBifurcatedCrit && !neverCrit && !hasDiamondShrine
        ? (1 - Math.pow(1 - preBifurcateCrit / 100, 2)) * 100
        : preBifurcateCrit;
    if (!neverCrit && !hasDiamondShrine) {
      if (skillDb.flag('Every3UseCrit', flags, kwFlags)) {
        postUseCrit = (2 * postUseCrit + 100) / 3;
      }
      if (skillDb.flag('Every5UseCrit', flags, kwFlags)) {
        postUseCrit = (4 * postUseCrit + 100) / 5;
      }
      if (skillDb.flag('Every6UseCrit', flags, kwFlags)) {
        postUseCrit = (5 * postUseCrit + 100) / 6;
      }
    }
    const postBifurcateCrit = postUseCrit;
    critChance = Math.round(postBifurcateCrit * (isAttack ? hitChance / 100 : 1) * 100) / 100;
    const overridePoe1Multi = skillDb.override('CritMultiplierOverride', flags, kwFlags);
    const enemyCritMultiInc = 1 + groupEnemyDb.sum('INC', 'SelfCritMultiplier', flags, kwFlags) / 100;
    const iceSpearSecondFormQualMulti =
      (activeNameLower === 'ice spear' || activeNameLower === 'ice spear of splitting') &&
      ((resolvedPartStats?.partIndex ?? chosenActiveInst?.skillPart ?? 1) === 2 ||
        (resolvedPartStats?.partIndex ?? chosenActiveInst?.skillPart ?? 1) === 4)
        ? Math.max(0, activeQuality) * 2
        : 0;
    const baseExtraCritPct =
      overridePoe1Multi !== null
        ? Math.max(0, overridePoe1Multi - 100)
        : Math.max(0, (skillDb.sum('BASE', 'CritMultiplier', flags, kwFlags) + seethingFuryCritMulti + iceSpearSecondFormQualMulti - 100 + enemyCritMulti) * enemyCritMultiInc);
    rawPoe1CritMulti = Math.round(100 + baseExtraCritPct);
    let effPoe1CritMulti = rawPoe1CritMulti;
    if (hasBifurcatedCrit && !neverCrit && !noCritExtra && !hasDiamondShrine && postBifurcateCrit > 0) {
      // PoB1 CalcOffence.lua:3265-3302 (Assassin Spell Critical Strike Chance Bifurcates)
      const bifurcateMultiChance = (preBifurcateCrit * preBifurcateCrit) / 100;
      const conditionalBifurcateChance = Math.min(1, bifurcateMultiChance / postBifurcateCrit);
      effPoe1CritMulti = Math.round(100 + baseExtraCritPct * (1 + conditionalBifurcateChance));
    }
    critMultiplier = neverCrit
      ? 0
      : noCritExtra
        ? 100
        : effPoe1CritMulti;
    effectiveCritMultiplier =
      neverCrit || noCritExtra ? 1 : 1 + (critChance / 100) * Math.max(0, critMultiplier / 100 - 1);

    // PoE 1 Lightning Tendrils / Lightning Tendrils of Eccentricity: Average Pulse Damage (`act_int.lua:12735-12740`)
    if (
      typeof activeSkillData?.pulseDamage === 'number' &&
      activeSkillData.pulseDamage > 0 &&
      typeof activeSkillData?.pulseInterval === 'number' &&
      activeSkillData.pulseInterval > 1
    ) {
      const pulseDmgFrac = activeSkillData.pulseDamage / 100;
      const pulseInt = activeSkillData.pulseInterval;
      const partIdx = resolvedPartStats?.partIndex ?? chosenActiveInst?.skillPart ?? 1;
      if (partIdx === 2) {
        // Stronger Pulse: guaranteed crit + full pulseDamage MORE
        if (!neverCrit && !hasDiamondShrine) {
          critChance = 100;
          effectiveCritMultiplier = noCritExtra ? 1 : Math.max(1, critMultiplier / 100);
        }
        skillDb.addMod({
          name: 'Damage',
          type: 'MORE',
          value: activeSkillData.pulseDamage,
          flags: 0,
          keywordFlags: KeywordFlag.Hit | KeywordFlag.Ailment,
          source: 'Stronger Pulse Damage',
        });
      } else {
        // Part 1 ("Average DPS"): exact PoB1 weighted average across (interval - 1) normal pulses + 1 guaranteed-crit stronger pulse
        const cm = noCritExtra || neverCrit ? 1 : Math.max(1, critMultiplier / 100);
        const preC = neverCrit ? 0 : Math.min(1, Math.max(0, preBifurcateCrit / 100));
        const effC = neverCrit ? 0 : Math.min(1, Math.max(0, critChance / 100));
        const denom = pulseInt * (1 - effC + cm * effC);
        const avgPulseMore =
          denom > 0
            ? 100 * (((pulseInt - 1) * (1 + preC * (cm - 1)) + (1 + pulseDmgFrac) * cm) / denom - 1)
            : 0;
        if (avgPulseMore > 0) {
          skillDb.addMod({
            name: 'Damage',
            type: 'MORE',
            value: avgPulseMore,
            flags: 0,
            keywordFlags: KeywordFlag.Hit | KeywordFlag.Ailment,
            source: 'Average Pulse Damage',
          });
        }
      }
    }
  }
  if (
    specialSkillDmg.canHit &&
    !neverCrit &&
    critChance > 0 &&
    (build.game === 'poe1'
      ? build.config.rawInputs?.conditionCritInPast8Sec !== false
      : build.config.rawInputs?.conditionCritInPast8Sec === true)
  ) {
    skillDb.setCondition('CritInPast8Sec', true);
  }

  // Double & Triple Damage including On-Crit chances (PoB1 CalcOffence.lua:3321-3330)
  const critShareForMult = neverCrit ? 0 : Math.min(1, Math.max(0, critChance / 100));
  const ddOnCritPct = Math.min(100, Math.max(0, skillDb.sum('BASE', 'DoubleDamageChanceOnCrit', flags, kwFlags)));
  const tdOnCritPct = Math.min(100, Math.max(0, skillDb.sum('BASE', 'TripleDamageChanceOnCrit', flags, kwFlags)));
  const doubleDamagePct = Math.min(100, Math.max(0, baseDoubleDamagePct + ddOnCritPct * critShareForMult));
  const tripleDamagePct = Math.min(100, Math.max(0, baseTripleDamagePct + tdOnCritPct * critShareForMult));
  const effDoubleDamagePct = Math.max(0, doubleDamagePct * (1 - tripleDamagePct / 100));
  const doubleDamageMult = 1 + effDoubleDamagePct / 100 + (2 * tripleDamagePct) / 100;

  const damageByType: Record<DamageType, DamageRange> = { ...emptyRanges };
  const preMitigationHitByType: Record<DamageType, number> = {
    Physical: 0,
    Lightning: 0,
    Cold: 0,
    Fire: 0,
    Chaos: 0,
  };
  const dealNoPhys = skillDb.flag('DealNoPhysical', flags, kwFlags);
  const dealNoFire = skillDb.flag('DealNoFire', flags, kwFlags);
  const dealNoCold = skillDb.flag('DealNoCold', flags, kwFlags);
  const dealNoLight = skillDb.flag('DealNoLightning', flags, kwFlags);
  const dealNoEle =
    skillDb.flag('DealNoElemental', flags, kwFlags) || (dealNoFire && dealNoCold && dealNoLight);
  const dealNoChaos = skillDb.flag('DealNoChaos', flags, kwFlags);
  const dealNoNonFire = skillDb.flag('DealNoNonFire', flags, kwFlags);
  const globalMinMore = skillDb.more('MinDamage', flags, kwFlags);
  const globalMaxMore = skillDb.more('MaxDamage', flags, kwFlags);
  const hasLuckyHits = skillDb.flag('LuckyHits', flags, kwFlags);
  const hasLightningNoCritLucky = skillDb.flag('LightningNoCritLucky', flags, kwFlags);
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
      damageByType[dt] = { min: 0, max: 0, average: 0 };
      continue;
    }
    let rawMin = 0;
    let rawMax = 0;
    const typeMinMore =
      globalMinMore * skillDb.more([`${dt}MinDamage`, `Min${dt}Damage`], flags, kwFlags);
    const typeMaxMore =
      globalMaxMore * skillDb.more([`${dt}MaxDamage`, `Max${dt}Damage`], flags, kwFlags);
    for (const [mask, [pMin, pMax]] of packets[dt].entries()) {
      const statNames: string[] = ['Damage'];
      if ((mask & ELE_MASK) !== 0) statNames.push('ElementalDamage');
      for (const srcType of DAMAGE_TYPES) {
        if ((mask & DMG_BIT[srcType]) !== 0) {
          statNames.push(`${srcType}Damage`);
        }
      }
      const inc = skillDb.sum('INC', statNames, flags, kwFlags);
      const more = skillDb.more(statNames, flags, kwFlags);
      const mult = Math.max(0, 1 + inc / 100) * more;
      rawMin += pMin * mult * typeMinMore;
      rawMax += pMax * mult * typeMaxMore;
    }
    const typeLuckyChance = hasLuckyHits
      ? 1
      : Math.min(
          1,
          Math.max(
            0,
            skillDb.sum('BASE', ['LuckyHitsChance', `${dt}LuckyHitsChance`], flags, kwFlags) / 100,
          ),
        );
    const rawAvg =
      typeLuckyChance > 0
        ? typeLuckyChance * ((rawMin + 2 * rawMax) / 3) + (1 - typeLuckyChance) * ((rawMin + rawMax) / 2)
        : (rawMin + rawMax) / 2;
    preMitigationHitByType[dt] = rawAvg * effectiveCritMultiplier * doubleDamageMult;

    // Enemy mitigation (Resistances + Curses + Penetration; separate Non-Crit & Crit Enemy Armour PDR + Negative PDR)
    let enemyFactor = 1;
    let typeDmgTakenInc = enemyGlobalDmgTakenInc;
    let typeDmgTakenMore = enemyGlobalDmgTakenMore;
    if (dt === 'Physical') {
      typeDmgTakenInc += groupEnemyDb.sum('INC', 'PhysicalDamageTaken', flags, kwFlags);
      typeDmgTakenMore *= groupEnemyDb.more('PhysicalDamageTaken', flags, kwFlags);
      const poe2ArmourBroken =
        build.game === 'poe2' &&
        Boolean(
          build.config.rawInputs?.conditionEnemyArmourBroken ||
            build.config.rawInputs?.enemyIsArmourBroken ||
            groupEnemyDb.getEvalContext().conditions.ArmourBroken ||
            skillDb.getEvalContext().conditions.EnemyArmourBroken,
        );
      if (poe2ArmourBroken) {
        // PoE 2 Fully Broken Armour (`CalcSetup.lua`): Enemy Armour = 0 AND +20% increased Physical Damage Taken!
        typeDmgTakenInc += 20;
      }
      const eArm = poe2ArmourBroken
        ? 0
        : Math.max(
            0,
            (build.config.enemyArmour + groupEnemyDb.sum('BASE', 'Armour')) *
              Math.max(0, 1 + groupEnemyDb.sum('INC', 'Armour') / 100) *
              groupEnemyDb.more('Armour'),
          );
      const baseEnemyPdr =
        (groupEnemyDb.sum('BASE', 'PhysicalDamageReduction', flags, kwFlags) +
          skillDb.sum('BASE', 'EnemyPhysicalDamageReduction', flags, kwFlags)) /
        100;
      const pdrFloor = build.game === 'poe2' ? -1.0 : -0.75;
      const pdrCap = 0.75;
      if ((eArm > 0 || baseEnemyPdr !== 0) && rawAvg > 0) {
        const armPdrNonCrit = eArm > 0 ? eArm / (eArm + ruleset.armourFormulaFactor * rawAvg * doubleDamageMult) : 0;
        const pdrNonCrit = Math.max(pdrFloor, Math.min(pdrCap, armPdrNonCrit + baseEnemyPdr));
        const critFactor = neverCrit || noCritExtra ? 1 : Math.max(1, critMultiplier / 100);
        const critFrac = neverCrit || noCritExtra ? 0 : critChance / 100;
        if (eArm > 0 && critFrac > 0 && critFactor > 1) {
          const armPdrCrit = eArm / (eArm + ruleset.armourFormulaFactor * rawAvg * doubleDamageMult * critFactor);
          const pdrCrit = Math.max(pdrFloor, Math.min(pdrCap, armPdrCrit + baseEnemyPdr));
          const weightedPhys = (1 - critFrac) * (1 - pdrNonCrit) + critFrac * critFactor * (1 - pdrCrit);
          enemyFactor = weightedPhys / effectiveCritMultiplier;
        } else {
          enemyFactor = 1 - pdrNonCrit;
        }
      }
    } else if (dt === 'Fire' || dt === 'Cold' || dt === 'Lightning') {
      typeDmgTakenInc += groupEnemyDb.sum('INC', ['ElementalDamageTaken', `${dt}DamageTaken`], flags, kwFlags);
      typeDmgTakenMore *= groupEnemyDb.more(['ElementalDamageTaken', `${dt}DamageTaken`], flags, kwFlags);
      const hasRakiata =
        linkedSupportNames.has("rakiata's flow") ||
        linkedSupportNames.has('rakiatas flow') ||
        skillDb.flag('InvertEnemyEleRes', flags, kwFlags);
      const invertEleResChance = hasRakiata
        ? 1
        : Math.min(
            1,
            Math.max(
              0,
              (skillDb.sum(
                'BASE',
                ['InvertEleResChance', 'HitsInvertEleResChance', 'InvertEnemyEleResChance'],
                flags,
                kwFlags,
              ) +
                skillDb.sum('BASE', [`Invert${dt}ResChance`, `HitsInvert${dt}ResChance`], flags, kwFlags)) /
                100,
            ),
          );
      const allEnemyEle = {
        Fire: build.config.enemyFireResist + curseFireRes,
        Cold: build.config.enemyColdResist + curseColdRes,
        Lightning:
          postUniqueRes?.enemyLightningResistOverride !== null &&
          postUniqueRes?.enemyLightningResistOverride !== undefined
            ? postUniqueRes.enemyLightningResistOverride
            : build.config.enemyLightningResist + curseLightRes,
      };
      const baseEnemyRes = allEnemyEle[dt];
      const pen =
        skillDb.sum('BASE', `${dt}Penetration`, flags, kwFlags) +
        skillDb.sum('BASE', 'ElementalPenetration', flags, kwFlags);
      const poe2MinPen =
        build.game === 'poe2'
          ? (skillDb.override('ElementalPenetrationMinimum', flags, kwFlags) ?? 0)
          : undefined;
      const hitsIgnoreEleRes =
        skillDb.flag(`Ignore${dt}Resistance`, flags, kwFlags) ||
        skillDb.flag('IgnoreElementalResistances', flags, kwFlags) ||
        skillDb.flag('IgnoreElementalResistance', flags, kwFlags) ||
        groupEnemyDb.flag(`SelfIgnore${dt}Resistance`, flags, kwFlags);
      const critIgnoresEleRes =
        skillDb.flag('CritIgnoresEleRes', flags, kwFlags) ||
        skillDb.flag(`CritIgnores${dt}Res`, flags, kwFlags);
      const critIgnoresNonNegEleRes = skillDb.flag('CritIgnoresNonNegativeEleRes', flags, kwFlags);
      const hitsIgnoreNonNegEleRes =
        skillDb.flag('HitsIgnoreNonNegativeEleResFrozen', flags, kwFlags) &&
        Boolean(build.config.rawInputs?.conditionFrozen || skillDb.getEvalContext().conditions.Frozen);
      const effBaseEnemyRes = hitsIgnoreNonNegEleRes ? Math.min(0, baseEnemyRes) : baseEnemyRes;
      const nonCritElePen = skillDb.sum('BASE', 'NonCritElePen', flags, kwFlags);
      if (hitsIgnoreEleRes) {
        enemyFactor = 1;
      } else if (hasRakiata || invertEleResChance > 0 || uniqueGearResult?.enemyResistLowestElement) {
        const resEval = computeEffectiveEnemyResistance(effBaseEnemyRes, {
          element: dt,
          allElementalResists: allEnemyEle,
          penetrationPct: pen,
          ...(poe2MinPen !== undefined ? { minPenRes: poe2MinPen } : {}),
          invertEnemyEleRes: hasRakiata,
          invertChance: invertEleResChance,
          useLowestEleRes: Boolean(uniqueGearResult?.enemyResistLowestElement),
          // When Rakiata's Flow inverts positive enemy resistance to negative, do not override it back to 0% via CritIgnoresEleRes (e.g. Choir of the Storm)
          ignoreOnCrit:
            (hasRakiata && effBaseEnemyRes > 0)
              ? false
              : critIgnoresEleRes || (critIgnoresNonNegEleRes && effBaseEnemyRes > 0),
          critChancePct: neverCrit || noCritExtra ? 0 : critChance,
        });
        enemyFactor = resEval.damageMult;
      } else {
        const minPenFloor = poe2MinPen ?? 0;
        const nonCritRes =
          build.game === 'poe2'
            ? (effBaseEnemyRes > minPenFloor ? Math.max(minPenFloor, Math.min(75, effBaseEnemyRes) - pen - nonCritElePen) : effBaseEnemyRes)
            : Math.min(75, effBaseEnemyRes) - pen - nonCritElePen;
        const critRes = critIgnoresEleRes
          ? 0
          : critIgnoresNonNegEleRes
            ? Math.min(0, effBaseEnemyRes)
            : build.game === 'poe2'
              ? (effBaseEnemyRes > minPenFloor ? Math.max(minPenFloor, Math.min(75, effBaseEnemyRes) - pen) : effBaseEnemyRes)
              : Math.min(75, effBaseEnemyRes) - pen;
        if (critIgnoresEleRes || critIgnoresNonNegEleRes || nonCritElePen !== 0) {
          const critFactor = neverCrit || noCritExtra ? 1 : Math.max(1, critMultiplier / 100);
          const critFrac = neverCrit || noCritExtra ? 0 : critChance / 100;
          const nonCritMult = Math.max(0.05, 1 - nonCritRes / 100);
          const critMult = Math.max(0.05, 1 - critRes / 100);
          enemyFactor = ((1 - critFrac) * nonCritMult + critFrac * critFactor * critMult) / effectiveCritMultiplier;
        } else {
          enemyFactor = 1 - nonCritRes / 100;
        }
      }
      const ignoreEleResChance = Math.min(
        1,
        Math.max(0, skillDb.sum('BASE', `ChanceToIgnore${dt}Resistance`, flags, kwFlags) / 100),
      );
      if (ignoreEleResChance > 0) {
        enemyFactor = (1 - ignoreEleResChance) * enemyFactor + ignoreEleResChance;
      }
    } else if (dt === 'Chaos') {
      typeDmgTakenInc += groupEnemyDb.sum('INC', 'ChaosDamageTaken', flags, kwFlags);
      typeDmgTakenMore *= groupEnemyDb.more('ChaosDamageTaken', flags, kwFlags);
      const chaosPen = skillDb.sum('BASE', 'ChaosPenetration', flags, kwFlags);
      const baseChaosEnemyRes =
        preUniqueRes?.enemyChaosResistOverride !== null &&
        preUniqueRes?.enemyChaosResistOverride !== undefined
          ? preUniqueRes.enemyChaosResistOverride
          : Math.min(75, build.config.enemyChaosResist + curseChaosRes);
      const hitsIgnoreChaosRes =
        skillDb.flag('IgnoreChaosResistance', flags, kwFlags) ||
        groupEnemyDb.flag('SelfIgnoreChaosResistance', flags, kwFlags);
      const usesLowestRes =
        build.game === 'poe1' &&
        (skillDb.flag('ChaosDamageUsesLowestResistance', flags, kwFlags) ||
          activeNameLower.startsWith('hexblast'));
      if (hitsIgnoreChaosRes) {
        enemyFactor = 1;
      } else if (usesLowestRes) {
        const candRes: Array<{ el: 'Fire' | 'Cold' | 'Lightning' | 'Chaos'; res: number; pen: number }> = [
          {
            el: 'Fire',
            res: Math.min(75, build.config.enemyFireResist + curseFireRes),
            pen: skillDb.sum('BASE', ['FirePenetration', 'ElementalPenetration'], flags, kwFlags),
          },
          {
            el: 'Cold',
            res: Math.min(75, build.config.enemyColdResist + curseColdRes),
            pen: skillDb.sum('BASE', ['ColdPenetration', 'ElementalPenetration'], flags, kwFlags),
          },
          {
            el: 'Lightning',
            res:
              postUniqueRes?.enemyLightningResistOverride !== null &&
              postUniqueRes?.enemyLightningResistOverride !== undefined
                ? postUniqueRes.enemyLightningResistOverride
                : Math.min(75, build.config.enemyLightningResist + curseLightRes),
            pen: skillDb.sum('BASE', ['LightningPenetration', 'ElementalPenetration'], flags, kwFlags),
          },
          { el: 'Chaos', res: baseChaosEnemyRes, pen: chaosPen },
        ];
        candRes.sort((a, b) => a.res - b.res);
        const lowest = candRes[0]!;
        const effRes = lowest.res - lowest.pen;
        enemyFactor = 1 - effRes / 100;
      } else {
        const effRes = baseChaosEnemyRes - chaosPen;
        enemyFactor = 1 - effRes / 100;
      }
      const ignoreChaosResChance = Math.min(
        1,
        Math.max(0, skillDb.sum('BASE', 'ChanceToIgnoreChaosResistance', flags, kwFlags) / 100),
      );
      if (ignoreChaosResChance > 0) {
        enemyFactor = (1 - ignoreChaosResChance) * enemyFactor + ignoreChaosResChance;
      }
    }

    const finalMult =
      Math.max(0.05, enemyFactor) * Math.max(0, 1 + typeDmgTakenInc / 100) * typeDmgTakenMore;
    const min = rawMin * finalMult;
    const max = rawMax * finalMult;
    let average: number;
    if (typeLuckyChance > 0) {
      average = typeLuckyChance * ((min + 2 * max) / 3) + (1 - typeLuckyChance) * ((min + max) / 2);
    } else if (dt === 'Lightning' && hasLightningNoCritLucky) {
      const critFrac = neverCrit || noCritExtra ? 0 : critChance / 100;
      const noCritShare = effectiveCritMultiplier > 0 ? (1 - critFrac) / effectiveCritMultiplier : 1;
      const luckyAvg = (min + 2 * max) / 3;
      const normalAvg = (min + max) / 2;
      average = noCritShare * luckyAvg + (1 - noCritShare) * normalAvg;
    } else {
      average = (min + max) / 2;
    }
    damageByType[dt] = { min: Math.round(min), max: Math.round(max), average: Math.round(average * 100) / 100 };
    totalAvgHit += average;
  }

  // Step F: Attack / Cast Speed (with Dual-Wield harmonic APS, Trap/Mine throw times, Cooldowns & CoC)
  const isTrapSkill =
    effectiveSkillTypeSet.has('trap') ||
    effectiveSkillTypeSet.has('trapped') ||
    activeDef.tags.some((t) => t.toLowerCase() === 'trap');
  const isMineSkill =
    effectiveSkillTypeSet.has('mine') ||
    effectiveSkillTypeSet.has('remotemined') ||
    activeDef.tags.some((t) => t.toLowerCase() === 'mine');
  // PoE 2 Unarmed / Concoction base attack rate is 1.65 (Data/Misc.lua; Concoctions apply -15% -> 1.4025)
  const weaponBaseAps =
    build.game === 'poe2' && isUnarmedConcoction
      ? 1.65
      : isDualWield && mainWeaponStats && offWeaponStats
        ? 2 / (1 / Math.max(0.1, mainWeaponStats.attacksPerSecond) + 1 / Math.max(0.1, offWeaponStats.attacksPerSecond))
        : (weaponStats?.attacksPerSecond ?? (build.game === 'poe2' ? 1.65 : 1.2));
  const skillFixedAttackTimeMs =
    offHandAttackTimeMs ??
    (typeof activeSkillData?.attackTime === 'number' && activeSkillData.attackTime > 0
      ? activeSkillData.attackTime
      : undefined);
  const sdataAtkSpeedMult =
    activeDef.attackSpeedMultiplier === undefined && typeof activeSkillData?.attackSpeedMultiplier === 'number'
      ? Math.max(0.05, 1 + activeSkillData.attackSpeedMultiplier / 100)
      : undefined;
  const resolvedAtkSpeedMult =
    (usePartOverride ? resolvedPartStats?.attackSpeedMultiplier : undefined) ??
    activeDef.attackSpeedMultiplier ??
    sdataAtkSpeedMult ??
    1;
  // PoE 2 Barrage Repeats buff (`CalcOffence.lua:1114-1127`)
  if (
    build.game === 'poe2' &&
    effectiveSkillTypeSet.has('barrageable') &&
    !skillDb.flag('OneShotProj', flags, kwFlags) &&
    !skillDb.flag('NoAdditionalProjectiles', flags, kwFlags)
  ) {
    let barrageGemQual: number | undefined;
    for (const grp of build.skills) {
      if (!grp.enabled) continue;
      for (const gm of grp.gems) {
        if (!gm.enabled) continue;
        const gd = getGemById('poe2', gm.gemId);
        if (gd && gd.id === 'poe2_barrage') {
          barrageGemQual = gm.quality ?? 0;
          break;
        }
      }
      if (barrageGemQual !== undefined) break;
    }
    if (barrageGemQual !== undefined) {
      const removableFrenzy = skillDb.flag('CannotConsumeCharges', flags, kwFlags)
        ? 0
        : (skillDb.getEvalContext().multipliers.RemovableFrenzyCharge ?? 0);
      const barrageRepeats = 2 + Math.max(0, removableFrenzy);
      const repeatDmgMod = 0.5 + Math.trunc(Math.max(0, barrageGemQual) * 0.25) / 100;
      const dpsMulti = (1 + barrageRepeats) * repeatDmgMod;
      if (dpsMulti > 0) {
        skillDb.addMod({
          name: 'DPS',
          type: 'MORE',
          value: dpsMulti,
          flags: 0,
          keywordFlags: 0,
          source: 'Barrage Repeats',
        });
      }
    }
  }

  // PoE 2 Hazards `Chance To Rearm` (`CalcOffence.lua:1647-1650`) & `GrenadeActivateTwice` (`CalcOffence.lua:1281-1284`)
  if (build.game === 'poe2' && skillDb.flag('CanCreateHazards', flags, kwFlags)) {
    const rearmChance = Math.min(100, Math.max(0, skillDb.sum('BASE', 'HazardRearmChance', flags, kwFlags)));
    if (rearmChance > 0) {
      skillDb.addMod({
        name: 'DPS',
        type: 'MORE',
        value: rearmChance,
        flags: 0,
        keywordFlags: 0,
        source: 'Chance To Rearm',
      });
    }
  }
  if (
    build.game === 'poe2' &&
    (effectiveSkillTypeSet.has('grenade') || activeDef.tags.some((t) => t.toLowerCase() === 'grenade'))
  ) {
    const grenadeTwice = Math.min(100, Math.max(0, skillDb.sum('BASE', 'GrenadeActivateTwice', flags, kwFlags)));
    if (grenadeTwice > 0) {
      skillDb.addMod({
        name: 'DPS',
        type: 'MORE',
        value: grenadeTwice,
        flags: 0,
        keywordFlags: 0,
        source: 'Repeating Explosives',
      });
    }
  }
  // PoE 2 Dance with Death (`25% more Skill Speed while Off Hand is empty and using a 1H Martial Weapon`)
  if (
    build.game === 'poe2' &&
    !activeWeapons.off &&
    !build.equipped[offSlotLabel] &&
    mainWeaponStats &&
    !mainWeaponStats.twoHanded &&
    mainWeaponStats.weaponType !== 'Wand' &&
    (mainWeaponStats.weaponType as string) !== 'Sceptre' &&
    !/sceptre/i.test(activeWeapons.main?.baseName ?? '')
  ) {
    const dwdMore = skillDb.sum('BASE', 'DanceWithDeathSkillSpeedMore', flags, kwFlags);
    if (dwdMore > 0) {
      skillDb.addMod({
        name: 'Speed',
        type: 'MORE',
        value: dwdMore,
        flags: 0,
        keywordFlags: 0,
        source: 'Dance with Death',
      });
    }
  }

  // PoE 2 Unleash Seals (`HasSeals` + `DamageSeal`, `CalcOffence.lua:1291-1313`)
  if (
    build.game === 'poe2' &&
    !isAttack &&
    skillDb.flag('HasSeals', flags, kwFlags) &&
    skillDb.flag('DamageSeal', flags, kwFlags) &&
    !skillDb.flag('NoRepeatBonuses', flags, kwFlags) &&
    !(typeof activeSkillData?.hitTimeOverride === 'number' && activeSkillData.hitTimeOverride > 0)
  ) {
    const rawCastTime = activeDef.castTime ?? 0.75;
    const rawCastSpdMult =
      Math.max(0.05, 1 + skillDb.sum('INC', 'Speed', flags, kwFlags) / 100) *
      skillDb.more('Speed', flags, kwFlags);
    const totalCastSpd = rawCastTime > 0 ? (1 / rawCastTime) * rawCastSpdMult : 0;
    const sealFreqBase = skillDb.sum('BASE', 'SealGainFrequency', flags, kwFlags);
    const sealFreqMod =
      Math.max(0.05, 1 + skillDb.sum('INC', 'SealGainFrequency', flags, kwFlags) / 100) *
      skillDb.more('SealGainFrequency', flags, kwFlags);
    const sealCooldown = (rawCastTime * sealFreqBase) / sealFreqMod / 100;
    const sealRepeatMult =
      Math.max(0, 1 + skillDb.sum('INC', 'SealRepeatPenalty', flags, kwFlags) / 100) *
      skillDb.more('SealRepeatPenalty', flags, kwFlags);
    if (sealCooldown > 0 && totalCastSpd > 0) {
      const unleashDpsMore =
        Math.round(((1 / sealCooldown / (totalCastSpd * 1.1)) * sealRepeatMult) * 10000) / 100;
      if (unleashDpsMore > 0) {
        skillDb.addMod({
          name: 'DPS',
          type: 'MORE',
          value: unleashDpsMore,
          flags: 0,
          keywordFlags: 0,
          source: 'Unleash',
        });
      }
    }
  }

  const flatBaseSpeedTime = skillDb.sum('BASE', 'Speed', flags, kwFlags);
  let baseTimeSec: number;
  if (isMineSkill) {
    baseTimeSec = 0.3;
  } else if (isTrapSkill) {
    baseTimeSec = 0.6;
  } else if (isAttack) {
    if (build.game === 'poe2' && Boolean(activeSkillData?.castTimeOverridesAttackTime)) {
      let localWepSpdInc = 0;
      if (activeWeapons.main) {
        const expMain = expandPoe2LocalRunes
          ? expandPoe2LocalRunes(mainSlotLabel, activeWeapons.main)
          : activeWeapons.main;
        for (const rl of [...expMain.implicits, ...expMain.explicits]) {
          const cl = rl.replace(/^\{[^}]*\}/g, '').trim();
          const mSpd = cl.match(/^(\d+)% (increased|reduced) Attack Speed$/i);
          if (mSpd) {
            localWepSpdInc += (mSpd[2]!.toLowerCase() === 'reduced' ? -1 : 1) * Number(mSpd[1]);
          }
        }
      }
      baseTimeSec = (activeDef.castTime ?? 1) / Math.max(0.1, 1 + localWepSpdInc / 100);
    } else if (skillFixedAttackTimeMs !== undefined) {
      baseTimeSec = skillFixedAttackTimeMs / 1000 / Math.max(0.05, resolvedAtkSpeedMult) + flatBaseSpeedTime;
    } else {
      baseTimeSec = 1 / Math.max(0.05, weaponBaseAps * resolvedAtkSpeedMult) + flatBaseSpeedTime;
    }
  } else {
    baseTimeSec = (activeDef.castTime ?? 0.75) + flatBaseSpeedTime;
  }
  const hasMultistrikeSup =
    compatibleSupportNames.has('multistrike') ||
    compatibleSupportNames.has('awakened multistrike') ||
    compatibleSupportNames.has('greater multistrike');
  const speedQueryFlags =
    isAttack && hasMultistrikeSup && (activeDef.modFlags & ModFlag.Melee) !== 0
      ? flags | ModFlag.Melee
      : flags;
  const speedInc =
    skillDb.sum('INC', 'Speed', speedQueryFlags, kwFlags) +
    (isMineSkill ? skillDb.sum('INC', 'MineLayingSpeed', speedQueryFlags, kwFlags) : 0) +
    specialSkillDmg.hitRateIncPct;
  const isPoe2Flicker = build.game === 'poe2' && activeNameLower === 'flicker strike';
  const skillTimeDiv = isAttack
    ? Math.max(0.1, skillDb.more('SkillAttackTime', speedQueryFlags, kwFlags))
    : 1;
  const speedMore =
    (skillDb.more('Speed', speedQueryFlags, kwFlags) / skillTimeDiv) *
    (isMineSkill ? skillDb.more('MineLayingSpeed', speedQueryFlags, kwFlags) : 1) *
    (isPoe2Flicker ? 1 : specialSkillDmg.hitRateMoreMult);
  const combinedSpeedMult =
    build.game === 'poe2'
      ? Math.round(Math.max(0.05, 1 + speedInc / 100) * speedMore * 100) / 100
      : Math.max(0.05, 1 + speedInc / 100) * speedMore;
  const extraTotalAttackTime = isAttack ? Math.max(0, skillDb.sum('BASE', 'TotalAttackTime', flags, kwFlags)) : 0;
  const extraTotalCastTime = !isAttack ? Math.max(0, skillDb.sum('BASE', 'TotalCastTime', flags, kwFlags)) : 0;
  const totalUseTimeSec =
    baseTimeSec > 0 && combinedSpeedMult > 0
      ? baseTimeSec / combinedSpeedMult + extraTotalAttackTime + extraTotalCastTime
      : 0;
  // Action Speed (Boots Eldritch implicit + Tailwind + Trickster One Step Ahead 108% floor; PoB1 CalcOffence.lua)
  // Also evaluate conditional Tailwind (e.g. Hunter boots "You have Tailwind if you have dealt a Critical Strike Recently")
  // if it became active once skillDb's combat CritRecently condition is populated.
  if (
    build.game === 'poe1' &&
    skillDb.flag('Condition:Tailwind', flags, kwFlags) &&
    !skillDb.calcStat('ActionSpeed', flags, kwFlags).sources.some((s) => s.source === 'Tailwind')
  ) {
    const twEff = skillDb.sum('INC', 'TailwindEffect', flags, kwFlags);
    const twVal = Math.floor(8 * Math.max(0, 1 + twEff / 100) + 1e-9);
    if (twVal > 0) {
      skillDb.addMod({ name: 'ActionSpeed', type: 'INC', value: twVal, flags: 0, keywordFlags: 0, source: 'Tailwind' });
    }
  }
  const minActionSpeedPct =
    build.game === 'poe1'
      ? (skillDb.max('MinimumActionSpeed', flags, kwFlags) ??
        (skillDb.flag('OneStepAhead', flags, kwFlags) ? 105 : 0))
      : 0;
  const actionSpeedMult =
    Math.max(minActionSpeedPct, Math.max(1, 100 + skillDb.sum('INC', 'ActionSpeed', flags, kwFlags))) / 100;
  let speedExact = totalUseTimeSec > 0 ? (1 / totalUseTimeSec) * actionSpeedMult : 0;
  // PoE 1 MineThrowCount (Minefield +4 -> 5 / 1.4 = 3.571x effective mines/sec; PoB1 CalcOffence.lua:1365-1377)
  if (isMineSkill && speedExact > 0) {
    const mineThrowCount = Math.max(1, 1 + skillDb.sum('BASE', 'MineThrowCount', flags, kwFlags));
    if (mineThrowCount > 1) {
      speedExact = (speedExact * mineThrowCount) / (1 + (mineThrowCount - 1) * 0.1);
    }
  }
  const effCooldown =
    activeDef.cooldown ??
    (typeof activeSkillData?.cooldown === 'number' && activeSkillData.cooldown > 0
      ? activeSkillData.cooldown
      : undefined);
  if (effCooldown && effCooldown > 0 && !specialSkillDmg.bypassCooldown) {
    const cdr = Math.max(0, skillDb.sum('INC', 'CooldownRecovery', flags, kwFlags));
    const cdRepeats = Math.max(1, 1 + skillDb.sum('BASE', 'RepeatCount', flags, kwFlags));
    const cdRate = ((1 + cdr / 100) / effCooldown) * cdRepeats;
    speedExact = Math.min(speedExact, cdRate);
  }
  let triggerRate: number | undefined;

  if (!isAttack && skillDb.flag('CastOnCrit') && triggerAttackDef) {
    const cdr = Math.max(0, skillDb.sum('INC', 'CooldownRecovery', flags, kwFlags));
    const atkFlags = triggerAttackDef.modFlags | ModFlag.Attack | ModFlag.Hit | weaponTypeToModFlags(weaponStats?.weaponType, weaponStats?.twoHanded);
    const atkKw = triggerAttackDef.keywordFlags | KeywordFlag.Attack | KeywordFlag.Hit;
    const trigSkillData = triggerAttackDef.skillData;
    const trigNameLower = triggerAttackDef.name.en.trim().toLowerCase();
    const rawTrigAtkSpdMult =
      triggerAttackDef.attackSpeedMultiplier ??
      (typeof trigSkillData?.attackSpeedMultiplier === 'number'
        ? Math.max(0.05, 1 + trigSkillData.attackSpeedMultiplier / 100)
        : 1);
    const trigAtkSpdMult =
      rawTrigAtkSpdMult === 1 && (trigNameLower === 'cyclone' || trigNameLower === 'vaal cyclone')
        ? 3
        : rawTrigAtkSpdMult;
    const trigStageSpeedMore =
      trigNameLower === 'cyclone of tumult'
        ? 1 + 0.25 * (skillDb.getEvalContext().multipliers.CycloneofTumultStage ?? 5)
        : 1;
    const atkBaseAps = weaponBaseAps * trigAtkSpdMult;
    // Include Attack-only supports (e.g. Faster Attacks socketed or granted by weapon "Supported by Level X Faster Attacks")
    // that were excluded from Spell skillDb when computing Cyclone / trigger attack APS.
    let extraTrigAtkSpeedInc = 0;
    const cocSlotItem = mainGroup.slot ? build.items[build.equipped[mainGroup.slot] ?? ''] : undefined;
    if (cocSlotItem) {
      for (const rawL of [...cocSlotItem.implicits, ...cocSlotItem.explicits]) {
        const cleanL = rawL.replace(/\{[^}]*\}/g, '').trim();
        const mFa = cleanL.match(/^Socketed Gems are Supported by Level (\d+) Faster Attacks$/i);
        if (mFa) {
          const faLv = Math.max(1, Math.min(30, Number(mFa[1])));
          extraTrigAtkSpeedInc += 25 + faLv - 1; // Faster Attacks: 25% at Lv1, +1% per level (44% at Lv20)
        }
      }
    }
    for (const gm of mainGroup.gems) {
      if (!gm.enabled) continue;
      const gd = getGemById('poe1', gm.gemId);
      if (!gd || gd.category !== 'support') continue;
      if (gd.name.en.trim().toLowerCase().replace(/\s+support$/i, '') === 'faster attacks') {
        const faLv = Math.max(1, Math.min(30, gm.level));
        extraTrigAtkSpeedInc += 25 + faLv - 1 + Math.floor((gm.quality ?? 0) * 0.5);
      }
    }
    let atkAps =
      atkBaseAps *
      Math.max(0.05, 1 + (skillDb.sum('INC', 'Speed', atkFlags, atkKw) + extraTrigAtkSpeedInc) / 100) *
      skillDb.more('Speed', atkFlags, atkKw) *
      trigStageSpeedMore *
      actionSpeedMult;
    const trigGemInst = mainGroup.gems.find(
      (g) => g.enabled && getGemById(build.game, g.gemId)?.id === triggerAttackDef.id,
    );
    if (trigNameLower === 'lancing steel of spraying' && trigGemInst?.skillPart === 2) {
      const lancingProj = Math.max(1, 8 + skillDb.sum('BASE', 'ProjectileCount', atkFlags, atkKw));
      atkAps *= lancingProj;
    }

    let atkHitChance = 100;
    if (!skillDb.flag('HitsCantBeEvaded', atkFlags, atkKw) && !skillDb.flag('CannotBeEvaded', atkFlags, atkKw)) {
      const acc = Math.max(1, skillDb.calcStat('Accuracy', atkFlags, atkKw).total);
      const eEva = Math.max(1, build.config.enemyEvasion + groupEnemyDb.sum('BASE', 'Evasion'));
      const rawHit = (acc / (acc + Math.pow(eEva / 5, 0.9))) * 125;
      atkHitChance = Math.min(100, Math.max(5, Math.round(rawHit)));
    }
    const atkNeverCrit = skillDb.flag('NeverCrit', atkFlags, atkKw);
    const atkFlatBaseCrit = skillDb.sum('BASE', 'BaseCritChance', atkFlags, atkKw);
    const atkPreCrit = atkNeverCrit
      ? 0
      : Math.min(
          100,
          (weaponBaseCrit + enemyCritBonus + atkFlatBaseCrit) *
            Math.max(0, 1 + skillDb.sum('INC', 'CritChance', atkFlags, atkKw) / 100) *
            skillDb.more('CritChance', atkFlags, atkKw),
        );
    const trigRes = computeTriggeredSkillRate({
      cooldown: 0.15,
      icdrPct: cdr,
      attackAps: atkAps,
      attackHitChancePct: atkHitChance,
      attackCritChancePct: atkPreCrit,
    });
    const effRate = trigRes.syncedTriggerRate ?? trigRes.effectiveTriggerRate;
    speedExact = effRate;
    triggerRate = Math.round(effRate * 100) / 100;
  } else if (
    build.game === 'poe1' &&
    !isAttack &&
    (compatibleSupportNames.has('cast while channelling') ||
      compatibleSupportNames.has('awakened cast while channelling'))
  ) {
    const cwcGem = mainGroup.gems.find((g) => {
      if (!g.enabled) return false;
      const gd = getGemById('poe1', g.gemId);
      if (!gd) return false;
      const n = gd.name.en.trim().toLowerCase().replace(/\s+support$/i, '');
      return n === 'cast while channelling' || n === 'awakened cast while channelling';
    });
    const isAwk = Boolean(cwcGem && /awakened/i.test(getGemById('poe1', cwcGem.gemId)?.name.en ?? ''));
    const cwcLv = Math.max(1, cwcGem?.level ?? (isAwk ? 5 : 20));
    const interval = isAwk
      ? Math.max(0.28, 0.35 - Math.max(0, cwcLv - 1) * 0.0125)
      : Math.max(0.30, 0.445 - Math.max(0, cwcLv - 1) * 0.005);
    const effRate = 1 / interval;
    speedExact = effRate;
    triggerRate = Math.round(effRate * 100) / 100;
  } else if (
    build.game === 'poe1' &&
    !isAttack &&
    (mainGroup.slot === 'Weapon 1' || mainGroup.slot === 'Weapon 2')
  ) {
    // PoE 1 Weapon-Triggered Spells: Mjolner (0.25s CD on hit, Lightning spells) & Cospri's Malice (0.25s CD on melee crit, Cold spells)
    const sockItemId = build.equipped[mainGroup.slot];
    const sockItem = sockItemId ? build.items[sockItemId] : undefined;
    const sockNameL = (sockItem?.name ?? '').trim().toLowerCase();
    const isMjolner =
      (sockNameL === 'mjolner' || sockNameL === 'mjölner') &&
      ((kwFlags & KeywordFlag.Lightning) !== 0 || activeDef.tags.some((t) => t.toLowerCase() === 'lightning'));
    const isCospris =
      sockNameL === "cospri's malice" &&
      ((kwFlags & KeywordFlag.Cold) !== 0 || activeDef.tags.some((t) => t.toLowerCase() === 'cold'));
    if (isMjolner || isCospris) {
      // Find best enabled melee attack trigger skill in another skill group (e.g. Cyclone)
      let trigAtkDef: GemDefinition | undefined;
      for (const grp of build.skills) {
        if (!grp.enabled || grp.slot === mainGroup.slot) continue;
        for (const gm of grp.gems) {
          if (!gm.enabled) continue;
          const gd = getGemById('poe1', gm.gemId);
          if (!gd || gd.category !== 'active') continue;
          if ((gd.modFlags & ModFlag.Attack) !== 0 && (gd.modFlags & ModFlag.Melee) !== 0) {
            const gn = gd.name.en.trim().toLowerCase();
            if (gn.startsWith('cyclone') || !trigAtkDef) {
              trigAtkDef = gd;
            }
          }
        }
      }
      if (trigAtkDef) {
        const cdr = Math.max(0, skillDb.sum('INC', 'CooldownRecovery', flags, kwFlags));
        const trigWep = mainGroup.slot === 'Weapon 2' ? (offWeaponStats ?? weaponStats) : weaponStats;
        const trigBaseAps = trigWep?.attacksPerSecond ?? 1.2;
        const atkFlags =
          trigAtkDef.modFlags |
          ModFlag.Attack |
          ModFlag.Hit |
          weaponTypeToModFlags(trigWep?.weaponType, trigWep?.twoHanded);
        const atkKw = trigAtkDef.keywordFlags | KeywordFlag.Attack | KeywordFlag.Hit;
        const tNameL = trigAtkDef.name.en.trim().toLowerCase();
        const rawMult =
          trigAtkDef.attackSpeedMultiplier ??
          (typeof trigAtkDef.skillData?.attackSpeedMultiplier === 'number'
            ? Math.max(0.05, 1 + trigAtkDef.skillData.attackSpeedMultiplier / 100)
            : 1);
        const tMult = rawMult === 1 && (tNameL === 'cyclone' || tNameL === 'vaal cyclone') ? 3 : rawMult;
        const atkAps =
          trigBaseAps *
          tMult *
          Math.max(0.05, 1 + skillDb.sum('INC', 'Speed', atkFlags, atkKw) / 100) *
          skillDb.more('Speed', atkFlags, atkKw) *
          actionSpeedMult;
        let atkHitChance = 100;
        if (!skillDb.flag('HitsCantBeEvaded', atkFlags, atkKw) && !skillDb.flag('CannotBeEvaded', atkFlags, atkKw)) {
          const acc = Math.max(1, skillDb.calcStat('Accuracy', atkFlags, atkKw).total);
          const eEva = Math.max(1, build.config.enemyEvasion + groupEnemyDb.sum('BASE', 'Evasion'));
          atkHitChance = Math.min(100, Math.max(5, Math.round((acc / (acc + Math.pow(eEva / 5, 0.9))) * 125)));
        }
        let atkCritChance = 100;
        if (isCospris) {
          const atkNeverCrit = skillDb.flag('NeverCrit', atkFlags, atkKw);
          const atkFlatCrit = skillDb.sum('BASE', 'BaseCritChance', atkFlags, atkKw);
          atkCritChance = atkNeverCrit
            ? 0
            : Math.min(
                100,
                ((trigWep?.critChance ?? 5.5) + enemyCritBonus + atkFlatCrit) *
                  Math.max(0, 1 + skillDb.sum('INC', 'CritChance', atkFlags, atkKw) / 100) *
                  skillDb.more('CritChance', atkFlags, atkKw),
              );
        }
        // Count enabled matching spells socketed in the same trigger weapon (Mjolner/Cospri's rotates through them!)
        const sameSlotSpells = mainGroup.gems.filter((gm) => {
          if (!gm.enabled) return false;
          const gd = getGemById('poe1', gm.gemId);
          if (!gd || gd.category !== 'active' || (gd.modFlags & ModFlag.Spell) === 0) return false;
          return isMjolner
            ? (gd.keywordFlags & KeywordFlag.Lightning) !== 0 || gd.tags.some((t) => t.toLowerCase() === 'lightning')
            : (gd.keywordFlags & KeywordFlag.Cold) !== 0 || gd.tags.some((t) => t.toLowerCase() === 'cold');
        }).length;
        const trigRes = computeTriggeredSkillRate({
          cooldown: 0.25,
          icdrPct: cdr,
          attackAps: atkAps,
          attackHitChancePct: atkHitChance,
          attackCritChancePct: atkCritChance,
        });
        const effRate = (trigRes.syncedTriggerRate ?? trigRes.effectiveTriggerRate) / Math.max(1, sameSlotSpells);
        speedExact = effRate;
        triggerRate = Math.round(effRate * 100) / 100;
      }
    }
  } else if (
    poe2MetaResolution?.isMetaGroup &&
    poe2MetaResolution.estimatedTriggerRate > 0
  ) {
    speedExact = poe2MetaResolution.estimatedTriggerRate;
    triggerRate = poe2MetaResolution.estimatedTriggerRate;
  }
  // PoE 2 Crossbows: adjust effective firing rate ONLY when skill explicitly defines `reloadTime > 0` (CalcOffence.lua:3020)
  const crossbowBoltCount =
    build.game === 'poe2'
      ? (typeof activeSkillData?.boltCount === 'number' && activeSkillData.boltCount > 0
          ? activeSkillData.boltCount
          : skillDb.sum('BASE', 'CrossbowBoltCount', flags, kwFlags))
      : 0;
  // PoE 2 Grenade Activate Twice (`CalcOffence.lua:1281-1284`): `GrenadeActivateTwice` BASE -> `DPS MORE`
  if (build.game === 'poe2' && (effectiveSkillTypeSet.has('grenade') || activeDef.tags.some((t) => t.toLowerCase() === 'grenade'))) {
    const detonateTwice = Math.min(100, Math.max(0, skillDb.sum('BASE', 'GrenadeActivateTwice', flags, kwFlags)));
    if (detonateTwice > 0) {
      skillDb.addMod({
        name: 'DPS',
        type: 'MORE',
        value: detonateTwice,
        flags: 0,
        keywordFlags: 0,
        source: 'Grenade Activate Twice',
      });
    }
  }
  const crossbowBaseReloadTable: Record<string, number> = {
    'makeshift crossbow': 0.8,
    'tense crossbow': 0.85,
    'sturdy crossbow': 0.75,
    'varnished crossbow': 0.8,
    'dyad crossbow': 1.1,
    'alloy crossbow': 0.7,
    'bombard crossbow': 0.75,
    'construct crossbow': 0.8,
    'blackfire crossbow': 0.85,
    'piercing crossbow': 0.85,
    'cumbrous crossbow': 0.9,
    'dedalian crossbow': 0.85,
    'esoteric crossbow': 0.8,
    'taut crossbow': 0.85,
    'robust crossbow': 0.75,
    'painted crossbow': 0.8,
    'twin crossbow': 1.1,
    'cannonade crossbow': 0.75,
    'bleak crossbow': 0.8,
    'runeforged makeshift crossbow': 0.8,
    'runeforged tense crossbow': 0.85,
    'runemastered tense crossbow': 0.6,
    'runeforged sturdy crossbow': 0.85,
    'runeforged dyad crossbow': 1.1,
    'runemastered dyad crossbow': 0.75,
    'runeforged bombard crossbow': 0.75,
    'stout crossbow': 0.75,
    'engraved crossbow': 0.8,
    'flexed crossbow': 0.85,
    'gemini crossbow': 1.1,
    'siege crossbow': 0.75,
    'desolate crossbow': 0.8,
    'elegant crossbow': 0.85,
  };
  const weaponCrossbowReload =
    activeWeapons.main?.baseName
      ? crossbowBaseReloadTable[activeWeapons.main.baseName.trim().toLowerCase()]
      : undefined;
  const crossbowBaseReload =
    build.game === 'poe2' &&
    weaponStats?.weaponType === 'Crossbow' &&
    !effectiveSkillTypeSet.has('grenade')
      ? typeof activeSkillData?.reloadTime === 'number' && activeSkillData.reloadTime > 0
        ? activeSkillData.reloadTime
        : crossbowBoltCount > 0 && activeNameLower !== 'crossbow shot'
          ? (weaponCrossbowReload ?? 0.8)
          : 0
      : 0;
  if (crossbowBaseReload > 0 && crossbowBoltCount > 0 && speedExact > 0) {
    const noConsumePct = Math.min(100, Math.max(0, skillDb.sum('BASE', 'ChanceToNotConsumeAmmo', flags, kwFlags)));
    const instantReloadPct = Math.min(100, Math.max(0, skillDb.sum('BASE', 'InstantReloadChance', flags, kwFlags)));
    if (noConsumePct < 100) {
      const effBolts = crossbowBoltCount / Math.max(0.01, 1 - noConsumePct / 100);
      const reloadInc = skillDb.sum('INC', ['ReloadSpeed', 'Speed'], flags, kwFlags);
      const reloadMore =
        skillDb.more('ReloadSpeed', flags, kwFlags) * skillDb.more('Speed', flags, kwFlags);
      const effReloadSec =
        (crossbowBaseReload / Math.max(0.05, (1 + reloadInc / 100) * reloadMore)) *
        (1 - instantReloadPct / 100);
      const totalFiringTime = effBolts / speedExact;
      speedExact = effBolts / Math.max(0.01, totalFiringTime + effReloadSec);
    }
  }
  const speed = Math.round(speedExact * 100) / 100;

  // Fist of War cooldown-uptime average multiplier (CalcOffence.lua:2812)
  const fowDmgMult = isAttack ? skillDb.sum('BASE', 'FistOfWarDamageMultiplier', flags, kwFlags) : 0;
  let fowAvgMult = 1;
  if (fowDmgMult > 0 && speedExact > 0) {
    const fowCd = Math.max(0.1, skillDb.sum('BASE', 'FistOfWarCooldown', flags, kwFlags) || 1.8);
    const fowUptime = Math.min(1, (1 / speedExact) / fowCd);
    fowAvgMult = 1 + (fowDmgMult / 100) * fowUptime;
  }

  // Dynamic PoB `preDamageFunc` multi-projectile & sequence `dpsMultiplier` rules
  const partIdxForDps = resolvedPartStats?.partIndex ?? 1;
  let dynamicPreDamageDpsMult = 1;
  const isSequentialProj =
    skillDb.flag('SequentialProjectiles', flags, kwFlags) &&
    !skillDb.flag('OneShotProj', flags, kwFlags) &&
    !skillDb.flag('NoAdditionalProjectiles', flags, kwFlags) &&
    !skillDb.flag('SingleProjectile', flags, kwFlags);
  if (activeNameLower === 'kinetic fusillade' || activeNameLower === 'kinetic fusillade of detonation') {
    if (partIdxForDps === 1) {
      dynamicPreDamageDpsMult *= projCount;
    }
  } else if (isSequentialProj && build.game === 'poe1') {
    dynamicPreDamageDpsMult *= projCount;
  } else if (
    (activeNameLower === 'spark' || activeNameLower === 'spark of the nova') &&
    build.game === 'poe1' &&
    partIdxForDps === 2
  ) {
    // Spark Part 2 ("Maximum Hits"): floor(effDuration / 0.66) + 1 hits per cast (CalcOffence / act_int.lua)
    const baseSparkDur =
      typeof activeSkillData?.duration === 'number' && activeSkillData.duration > 0
        ? activeSkillData.duration
        : 2.0;
    const effSparkDur =
      baseSparkDur *
      Math.max(0.1, 1 + skillDb.sum('INC', 'Duration', flags, kwFlags) / 100) *
      skillDb.more('Duration', flags, kwFlags);
    dynamicPreDamageDpsMult *= Math.max(1, Math.floor(effSparkDur / 0.66) + 1);
  } else if (
    (activeNameLower === 'ice spear' || activeNameLower === 'ice spear of splitting') &&
    build.game === 'poe1' &&
    (partIdxForDps === 3 || partIdxForDps === 4)
  ) {
    dynamicPreDamageDpsMult *= projCount;
  } else if (
    activeNameLower === 'shield crush' &&
    build.game === 'poe1' &&
    partIdxForDps === 2 &&
    !(typeof activeSkillData?.dpsMultiplier === 'number' && activeSkillData.dpsMultiplier > 1)
  ) {
    dynamicPreDamageDpsMult *= 2;
  } else if (
    (activeNameLower === 'lacerate' ||
      activeNameLower === 'lacerate of haemorrhage' ||
      activeNameLower === 'lacerate of butchering') &&
    build.game === 'poe1' &&
    partIdxForDps === 2 &&
    !(typeof activeSkillData?.dpsMultiplier === 'number' && activeSkillData.dpsMultiplier > 1)
  ) {
    dynamicPreDamageDpsMult *= 2;
  } else if (
    activeNameLower === 'ball lightning of orbiting' ||
    activeNameLower === 'ball lightning of static' ||
    (activeNameLower === 'ball lightning' && partIdxForDps >= 2)
  ) {
    if (activeNameLower === 'ball lightning of static' || partIdxForDps >= 2) {
      const strikeInt =
        typeof activeSkillData?.strikeInterval === 'number' && activeSkillData.strikeInterval > 0
          ? activeSkillData.strikeInterval
          : 0.15;
      const ballDur =
        typeof activeSkillData?.duration === 'number' && activeSkillData.duration > 0
          ? activeSkillData.duration
          : 2.0;
      dynamicPreDamageDpsMult *= Math.max(1, Math.floor(ballDur / strikeInt));
    }
  } else if (
    (activeNameLower === 'forbidden rite' ||
      activeNameLower === 'forbidden rite of soul sacrifice') &&
    partIdxForDps === 2
  ) {
    // Official PoB1 Forbidden Rite Part 2 ("All Primary Projectiles"): 1 primary + projCount additional
    dynamicPreDamageDpsMult *= projCount + 1;
  } else if (
    (activeNameLower === 'blazing salvo' ||
      activeNameLower === 'blast rain' ||
      activeNameLower === 'barrage' ||
      activeNameLower === 'barrage of volley fire' ||
      activeNameLower === 'vaal lightning arrow') &&
    partIdxForDps === 2
  ) {
    dynamicPreDamageDpsMult *= projCount;
  } else if (
    (activeNameLower === 'tornado shot' || activeNameLower === 'tornado shot of cloudburst') &&
    partIdxForDps === 2
  ) {
    const secProj = Math.max(0, skillDb.sum('BASE', 'tornadoShotSecondaryProjectiles', flags, kwFlags) || 3);
    const secHitChance = Math.min(1, (20 * secProj) / 100);
    const avgSec =
      projCount +
      Math.max(0, skillDb.sum('BASE', 'SplitCount', flags, kwFlags)) +
      Math.max(0, groupEnemyDb.sum('BASE', 'SelfSplitCount', flags, kwFlags));
    dynamicPreDamageDpsMult *= 1 + secHitChance * avgSec;
  } else if (
    (activeNameLower === 'molten strike' || activeNameLower === 'molten strike of the zenith') &&
    build.game === 'poe1' &&
    (partIdxForDps === 3 || partIdxForDps === 5 || partIdxForDps === 6)
  ) {
    // Official PoB1 `act_str.lua:8024-8081` Molten Strike / Zenith ball overlap & 5th-strike weighted average
    const aoeInc =
      skillDb.sum('INC', 'AreaOfEffect', flags, kwFlags) +
      (Boolean(activeSkillData?.projectileSpeedAppliesToMSAreaOfEffect)
        ? skillDb.sum('INC', 'ProjectileSpeed', flags, kwFlags)
        : 0);
    const aoeMore = skillDb.more('AreaOfEffect', flags, kwFlags);
    const radiusScale = Math.sqrt(Math.max(0.1, 1 + aoeInc / 100) * aoeMore);
    const enemyRadius = skillDb.override('EnemyRadius', flags, kwFlags) ?? (skillDb.sum('BASE', 'EnemyRadius', flags, kwFlags) || 2);
    const ballRadius = Math.floor(9 * radiusScale);
    const innerRadius = 2;
    const outerRadius = Math.max(innerRadius + 1, Math.floor(25 * radiusScale));
    const overlapChance = Math.min(1, Math.max(0, (enemyRadius + ballRadius - innerRadius) / (outerRadius - innerRadius)));
    if (activeNameLower === 'molten strike of the zenith' && partIdxForDps === 6) {
      // PoB1 `act_str.lua:8060-8062`: 5th strike deals (600 + 10*Q)% MORE damage (800% at Q20, 830% at Q23)
      const rawFifthDmg =
        typeof activeSkillData?.FifthStrikeDamage === 'number' ? activeSkillData.FifthStrikeDamage : 600;
      const fifthDmgPct =
        rawFifthDmg === 600 ? 600 + Math.max(0, activeQuality) * 10 : rawFifthDmg;
      const fifthExtraProj =
        typeof activeSkillData?.FifthStrikeProjectiles === 'number' ? activeSkillData.FifthStrikeProjectiles : 5;
      const fifthMult = 1 + fifthDmgPct / 100;
      dynamicPreDamageDpsMult *=
        overlapChance * (0.8 * projCount + 0.2 * fifthMult * (projCount + fifthExtraProj));
    } else {
      dynamicPreDamageDpsMult *= overlapChance * projCount;
    }
  } else if (build.game === 'poe1' && activeNameLower === 'storm burst' && partIdxForDps === 2) {
    // Official PoB1 `act_int.lua:18119-18126` Storm Burst Part 2 ("Max Channelled Orbs")
    const sbBaseDur = typeof activeSkillData?.duration === 'number' && activeSkillData.duration > 0 ? activeSkillData.duration : 1.2;
    const sbDurMod =
      Math.max(0.1, 1 + skillDb.sum('INC', 'Duration', flags, kwFlags) / 100) *
      skillDb.more('Duration', flags, kwFlags);
    const sbJump =
      typeof activeSkillData?.repeatFrequency === 'number' && activeSkillData.repeatFrequency > 0
        ? activeSkillData.repeatFrequency
        : 0.4;
    const sbOrbMult = 1 + Math.floor((sbBaseDur * sbDurMod * 10) / (sbJump * 10));
    dynamicPreDamageDpsMult *= Math.max(1, sbOrbMult);
  } else if (build.game === 'poe1' && activeNameLower === 'swordstorm') {
    dynamicPreDamageDpsMult *= 8;
  } else if (build.game === 'poe2' && activeNameLower === 'bonestorm') {
    const bsStages = Math.max(1, skillDb.getEvalContext().multipliers.BonestormStage ?? 20);
    dynamicPreDamageDpsMult *= bsStages;
  }

  const attachedBrandsMult =
    effectiveSkillTypeSet.has('brand') && activeNameLower !== 'wintertide brand'
      ? Math.max(1, Math.round(skillDb.sum('BASE', 'BrandsAttachedLimit', flags, kwFlags)))
      : 1;
  const sdataDpsMult =
    typeof activeSkillData?.dpsMultiplier === 'number' && activeSkillData.dpsMultiplier > 0
      ? activeSkillData.dpsMultiplier
      : undefined;
  const dpsMult =
    (sdataDpsMult ?? activeDef.dpsMultiplier ?? 1) *
    dynamicPreDamageDpsMult *
    attachedBrandsMult *
    skillDb.more('DPS', flags, kwFlags);

  // Separate periodic/pulse hit rate (`hitTimeOverride`, `hitTimeMultiplier`, `hitFrequency`, Brand `repeatFrequency`) from display Cast/Attack `speed`
  let hitRateForDps = speedExact;
  const isShowAvgSkill = Boolean(activeSkillData?.showAverage) && !effCooldown;
  if (typeof activeSkillData?.hitTimeOverride === 'number' && activeSkillData.hitTimeOverride > 0) {
    hitRateForDps = 1 / activeSkillData.hitTimeOverride;
  } else if (
    typeof activeSkillData?.hitTimeMultiplier === 'number' &&
    activeSkillData.hitTimeMultiplier > 0 &&
    !activeSkillData.triggeredOnDeath &&
    speedExact > 0
  ) {
    const rawHitTime = (1 / speedExact) * activeSkillData.hitTimeMultiplier;
    const minChan =
      typeof activeSkillData.minChannelTime === 'number' && activeSkillData.minChannelTime > 0
        ? activeSkillData.minChannelTime
        : 0;
    hitRateForDps = 1 / Math.max(rawHitTime, minChan);
  } else if (
    build.game === 'poe2' &&
    Boolean(activeSkillData?.channelRelease) &&
    typeof activeSkillData?.minChannelTime === 'number' &&
    activeSkillData.minChannelTime > 0 &&
    speedExact > 0
  ) {
    const chStages = Math.max(
      1,
      Number(skillDb.getEvalContext().multipliers[`${noSpaceSkill}Stage`] ?? 1),
    );
    hitRateForDps = 1 / Math.max(activeSkillData.minChannelTime, chStages / speedExact);
  } else if (
    build.game === 'poe2' &&
    !isShowAvgSkill &&
    typeof activeSkillData?.channelPercentOfAttackTime === 'number' &&
    activeSkillData.channelPercentOfAttackTime > 0
  ) {
    hitRateForDps = speedExact / activeSkillData.channelPercentOfAttackTime;
  } else if (build.game === 'poe2' && activeNameLower === 'bonestorm') {
    const bsStages = Math.max(1, skillDb.getEvalContext().multipliers.BonestormStage ?? 20);
    hitRateForDps = speedExact / Math.max(1, Math.ceil(bsStages / Math.max(1, projCount)));
  } else if (typeof activeSkillData?.hitFrequency === 'number' && activeSkillData.hitFrequency > 0) {
    const perBlade =
      (typeof activeSkillData.hitFrequencyPerBlade === 'number' ? activeSkillData.hitFrequencyPerBlade : 0) +
      (activeNameLower === 'blade vortex' ? Math.max(0, activeQuality) * 0.0025 : 0);
    const bladeStages = Math.max(
      0,
      activeNameLower === 'blade vortex'
        ? (skillDb.getEvalContext().multipliers.BladeVortexBlade ?? declaredMaxStages)
        : declaredMaxStages,
    );
    hitRateForDps = (1 + bladeStages * perBlade) / activeSkillData.hitFrequency;
  } else if (
    build.game === 'poe1' &&
    activeNameLower === 'winter orb' &&
    typeof activeSkillData?.repeatFrequency === 'number' &&
    activeSkillData.repeatFrequency > 0
  ) {
    const woFreqInc = skillDb.sum('INC', ['HitRate', 'Speed'], flags, kwFlags);
    const woFreqMore = skillDb.more('HitRate', flags, kwFlags) * skillDb.more('Speed', flags, kwFlags);
    hitRateForDps =
      (1 / activeSkillData.repeatFrequency) * Math.max(0.05, 1 + woFreqInc / 100) * woFreqMore * actionSpeedMult;
  } else if (
    effectiveSkillTypeSet.has('brand') &&
    typeof activeSkillData?.repeatFrequency === 'number' &&
    activeSkillData.repeatFrequency > 0
  ) {
    const brandFreqInc = skillDb.sum('INC', ['BrandActivationFrequency', 'Speed'], flags, kwFlags);
    const brandFreqMore = skillDb.more('BrandActivationFrequency', flags, kwFlags);
    hitRateForDps =
      (1 / activeSkillData.repeatFrequency) * Math.max(0.05, 1 + brandFreqInc / 100) * brandFreqMore * actionSpeedMult;
  }

  const isPoe2PureDotPart =
    build.game === 'poe2' &&
    activeNameLower === 'essence drain' &&
    (resolvedPartStats?.partIndex ?? 1) === 2;
  const effectiveCanHit = specialSkillDmg.canHit && !isPoe2PureDotPart;
  const avgHitWithCrit = effectiveCanHit
    ? Math.round(totalAvgHit * effectiveCritMultiplier * doubleDamageMult * fowAvgMult * 100) / 100
    : 0;
  const hitDps = effectiveCanHit
    ? Math.round(avgHitWithCrit * hitRateForDps * dpsMult * (hitChance / 100) * 100) / 100
    : 0;

  // Impale DPS (PoB 1 CalcOffence.lua:5658-5680: 10% stored PRE-MITIGATION phys hit * (1 + impaleEffect) * impaleStacks,
  // mitigated by enemy armour against the combined impale hit + EnemyImpalePhysicalDamageReduction, capped at 75% PDR)
  const impaleChance = isAttack ? Math.min(100, Math.max(0, skillDb.sum('BASE', 'ImpaleChance', flags, kwFlags))) : 0;
  let impaleDps = 0;
  if (isAttack && impaleChance > 0 && preMitigationHitByType.Physical > 0) {
    const impaleEffectInc = skillDb.sum('INC', 'ImpaleEffect', flags, kwFlags);
    const impaleEffectMore = Math.round(skillDb.more('ImpaleEffect', flags, kwFlags) * 100) / 100;
    const impaleStoredDamage = 0.1 * Math.max(0, 1 + impaleEffectInc / 100) * impaleEffectMore;
    const maxImpaleHits = 5 + skillDb.sum('BASE', 'ImpaleStacksMax', flags, kwFlags);
    const impaleHitDamageMod = impaleStoredDamage * maxImpaleHits;
    const storedHitAvg = preMitigationHitByType.Physical * fowAvgMult;
    const impaleEnemyArmour = Math.max(
      0,
      (build.config.enemyArmour + groupEnemyDb.sum('BASE', 'Armour')) *
        Math.max(0, 1 + groupEnemyDb.sum('INC', 'Armour') / 100) *
        groupEnemyDb.more('Armour'),
    );
    const impaleArmourPdr =
      impaleEnemyArmour > 0 && impaleHitDamageMod * storedHitAvg > 0
        ? impaleEnemyArmour / (impaleEnemyArmour + ruleset.armourFormulaFactor * impaleHitDamageMod * storedHitAvg)
        : 0;
    const impaleBasePdr =
      (groupEnemyDb.sum('BASE', 'PhysicalDamageReduction', flags, kwFlags) +
        skillDb.sum('BASE', 'EnemyImpalePhysicalDamageReduction', flags, kwFlags)) /
      100;
    const impaleResist = skillDb.flag('IgnoreEnemyImpalePhysicalDamageReduction', flags, kwFlags)
      ? 0
      : Math.min(0.75, Math.max(0, impaleBasePdr + impaleArmourPdr));
    const impalePhysTakenInc =
      enemyGlobalDmgTakenInc +
      groupEnemyDb.sum('INC', ['PhysicalDamageTaken', 'ReflectedDamageTaken'], flags, kwFlags);
    const impalePhysTakenMore =
      enemyGlobalDmgTakenMore *
      groupEnemyDb.more('PhysicalDamageTaken', flags, kwFlags) *
      groupEnemyDb.more('ReflectedDamageTaken', flags, kwFlags);
    const impaleEnemyFactor =
      (1 - impaleResist) * Math.max(0, 1 + impalePhysTakenInc / 100) * impalePhysTakenMore;
    const impaleDmgMod = impaleHitDamageMod * impaleEnemyFactor * (impaleChance / 100);
    impaleDps =
      Math.round(storedHitAvg * impaleDmgMod * hitRateForDps * dpsMult * (hitChance / 100) * 100) / 100;
  }

  // Authentic Ailments (Poison stacks, Mamba single-poison, Crimson Dance/Aggravated Bleed, Ignite) & skillData DoTs
  const wintertideAttachedLimit =
    build.game === 'poe1' && activeNameLower === 'wintertide brand'
      ? Math.max(1, Math.round(skillDb.sum('BASE', 'BrandsAttachedLimit', flags, kwFlags)))
      : 0;
  const mergedSkillData: Record<string, unknown> = {
    ...(activeSkillData ?? {}),
    ...(wintertideAttachedLimit > 1 ? { dotMaxStacks: wintertideAttachedLimit } : {}),
    ...(Object.keys(specialSkillDmg.baseDotDps).length > 0
      ? {
          dotDamageByType: specialSkillDmg.baseDotDps,
          spellDmgAppliesToDot: specialSkillDmg.spellDmgAppliesToDot,
        }
      : {}),
  };
  if (fowAvgMult > 1) {
    skillDb.addMod({
      name: 'DotDamage',
      type: 'MORE',
      value: (fowAvgMult - 1) * 100,
      flags: ModFlag.Ailment | ModFlag.Dot,
      keywordFlags: 0,
      source: 'Fist of War (Ailment Average)',
    });
  }
  if (specialSkillDmg.ailmentMoreMult !== 1) {
    skillDb.addMod({
      name: 'DotDamage',
      type: 'MORE',
      value: (specialSkillDmg.ailmentMoreMult - 1) * 100,
      flags: ModFlag.Ailment | ModFlag.Dot,
      keywordFlags: 0,
      source: `${activeDef.name.en} Ailment Multiplier`,
    });
  }
  if (specialSkillDmg.dotMoreMult !== 1) {
    skillDb.addMod({
      name: 'DotDamage',
      type: 'MORE',
      value: (specialSkillDmg.dotMoreMult - 1) * 100,
      flags: ModFlag.Dot,
      keywordFlags: 0,
      source: `${activeDef.name.en} DoT Multiplier`,
    });
  }
  // Skills with inherent Ignite keyword in curated gems have at least 25% base ignite chance if none in cmods
  if (
    build.game === 'poe1' &&
    (kwFlags & KeywordFlag.Ignite) !== 0 &&
    skillDb.sum('BASE', 'IgniteChance', flags, kwFlags) === 0
  ) {
    skillDb.addMod({
      name: 'IgniteChance',
      type: 'BASE',
      value: 25,
      flags: ModFlag.Hit,
      keywordFlags: 0,
      source: `Skill: ${activeDef.name.en}`,
    });
  }

  // PoE 1 Assassin: Noxious Strike (`5% increased Poison Duration for each Poison you have inflicted Recently`)
  if (build.game === 'poe1') {
    const perRecentPoison = skillDb.sum('BASE', 'PoisonDurationPerRecentPoison');
    const recentPoisons = Number(build.config.rawInputs?.multiplierPoisonAppliedRecently ?? 0);
    if (perRecentPoison > 0 && Number.isFinite(recentPoisons) && recentPoisons > 0) {
      skillDb.addMod({
        name: 'PoisonDuration',
        type: 'INC',
        value: perRecentPoison * recentPoisons,
        flags: 0,
        keywordFlags: 0,
        source: 'Tree: Noxious Strike',
      });
    }
  }

  const baseRangeByType: Record<DamageType, [number, number]> = {
    Physical: [finalBaseMin.Physical, finalBaseMax.Physical],
    Lightning: [finalBaseMin.Lightning, finalBaseMax.Lightning],
    Cold: [finalBaseMin.Cold, finalBaseMax.Cold],
    Fire: [finalBaseMin.Fire, finalBaseMax.Fire],
    Chaos: [finalBaseMin.Chaos, finalBaseMax.Chaos],
  };
  const hitsPerUseForAilments = Math.max(1, dpsMult * (doubleHitsDualWield ? 2 : 1));
  const dotResult = computeAuthenticAilmentAndSkillDots({
    game: build.game,
    skillDb,
    enemyDb: groupEnemyDb,
    baseDamageByType: finalBaseAvg,
    baseDamageRangeByType: baseRangeByType,
    preMitigationHitByType,
    hitDamageRangeByType: damageByType,
    flags,
    keywordFlags: kwFlags,
    speed: hitRateForDps,
    hitChancePct: hitChance,
    critChancePct: critChance,
    critMultiplierPct: critMultiplier,
    ...(build.game === 'poe1' ? { rawCritMultiplierPct: rawPoe1CritMulti } : {}),
    hitsPerUse: hitsPerUseForAilments,
    isAttack,
    skillHasDurationTag: effectiveSkillTypeSet.has('duration'),
    skillData: Object.keys(mergedSkillData).length > 0 ? mergedSkillData : undefined,
    enemyConfig: {
      enemyLevel: build.config.enemyLevel,
      enemyFireResist: build.config.enemyFireResist,
      enemyColdResist: build.config.enemyColdResist,
      enemyLightningResist: build.config.enemyLightningResist,
      enemyChaosResist: build.config.enemyChaosResist,
      enemyArmour: build.config.enemyArmour,
      enemyEvasion: build.config.enemyEvasion,
    },
  } as Parameters<typeof computeAuthenticAilmentAndSkillDots>[0]);

  const POE1_DOT_DPS_CAP = 35_791_394; // floor((2^31 - 1) / 60)
  const capPoe1Dot = (v: number) => (build.game === 'poe1' ? Math.min(POE1_DOT_DPS_CAP, v) : v);
  const igniteDps = capPoe1Dot(dotResult.ignite.totalDps);
  const bleedDps = capPoe1Dot(dotResult.bleed.totalDps);
  const poisonDps = capPoe1Dot(dotResult.poison.totalDps);
  const spellDotDps = capPoe1Dot(dotResult.skillDot.totalDps);
  const causticGroundDps = capPoe1Dot(dotResult.causticGroundDps ?? 0);
  const burningGroundDps = capPoe1Dot(dotResult.burningGroundDps ?? 0);

  // Mirage Archer, Sacred Wisps & General's Cry CombinedDPS contribution (CalcMirages.lua / CalcOffence.lua)
  let mirageAndWispsDps = 0;
  if (build.game === 'poe1') {
    const mirageableDps = hitDps + impaleDps + poisonDps;
    if (
      mirageableDps > 0 &&
      (skillDb.flag('triggeredByMirageArcher') || compatibleSupportNames.has('mirage archer'))
    ) {
      const maCount = Math.max(1, Math.round(skillDb.sum('BASE', 'MirageArcherMaxCount', flags, kwFlags)));
      const rawMaSpd = skillDb.sum('BASE', 'MirageArcherLessAttackSpeed', flags, kwFlags);
      const rawMaDmg = skillDb.sum('BASE', 'MirageArcherLessDamage', flags, kwFlags);
      const maLessSpd = rawMaSpd !== 0 ? rawMaSpd : -60;
      const maLessDmg = rawMaDmg !== 0 ? rawMaDmg : -31;
      const maMult = maCount * Math.max(0, 1 + maLessSpd / 100) * Math.max(0, 1 + maLessDmg / 100);
      mirageAndWispsDps += mirageableDps * maMult;
    }
    if (
      mirageableDps > 0 &&
      Boolean(activeSkillData?.triggeredBySacredWisps || compatibleSupportNames.has('sacred wisps'))
    ) {
      const swLessDmg = skillDb.sum('BASE', 'SacredWispsLessDamage', flags, kwFlags);
      const swCount = Math.max(1, Math.round(skillDb.sum('BASE', 'SacredWispsMaxCount', flags, kwFlags) || 2));
      const swCastChance = build.config.enemyIsBoss !== 'None' ? 0.5 : 0.25;
      const swMult = swCount * swCastChance * Math.max(0, 1 + swLessDmg / 100);
      mirageAndWispsDps += mirageableDps * swMult;
    }
    const gcGem = mainGroup.gems.find((g) => {
      if (!g.enabled) return false;
      const d = getGemById('poe1', g.gemId);
      return Boolean(d && d.name.en.trim().toLowerCase() === "general's cry");
    });
    if (gcGem && isAttack && (flags & ModFlag.Melee) !== 0 && avgHitWithCrit > 0) {
      const gcDef = getGemById('poe1', gcGem.gemId)!;
      const gcLv = Math.min(40, Math.max(1, gcGem.level));
      const gcEntry = resolveGemLevelEntry(gcDef, gcLv);
      const gcCmods = gcEntry?.compiledMods ?? gcDef.compiledMods ?? [];
      const gcLessDmg =
        (gcCmods.find((m) => m.name === 'Damage' && m.type === 'MORE' && typeof m.value === 'number')?.value as number | undefined) ??
        -30;
      const maxWarriors = Math.max(
        1,
        Math.round(5 + skillDb.sum('BASE', 'GeneralsCryDoubleMaxCount', flags, kwFlags)),
      );
      const gcBaseCd = typeof gcDef.skillData?.cooldown === 'number' ? gcDef.skillData.cooldown : 4;
      const gcCdr = skillDb.sum('INC', ['CooldownRecovery', 'WarcryCooldownRecovery']);
      const effGcCd = gcBaseCd / Math.max(0.1, 1 + gcCdr / 100);
      const warriorRate = maxWarriors / Math.max(0.35, effGcCd);
      const gcDmgMult = Math.max(0, 1 + gcLessDmg / 100);
      const gcHitDps = avgHitWithCrit * warriorRate * dpsMult * (hitChance / 100) * gcDmgMult;
      const gcImpaleDps =
        impaleDps > 0 && hitDps > 0 ? impaleDps * (gcHitDps / hitDps) : 0;
      if (gcHitDps + gcImpaleDps > hitDps + impaleDps) {
        mirageAndWispsDps += (gcHitDps + gcImpaleDps) - (hitDps + impaleDps);
      }
    }
  }

  // Culling Strike Multiplier (PoB1 CalcOffence.lua:3345-3352 & PoB2 CalcOffence.lua:4069-4079)
  const effHitRateForCull = Math.max(0, hitRateForDps * dpsMult * (hitChance / 100));
  let cullPct = 0;
  if (build.game === 'poe2') {
    const enemyRarityThreshold = build.config.enemyIsBoss !== 'None' ? 5 : 30;
    const critCullOverride = skillDb.override('CriticalCullPercent', flags, kwFlags);
    const hasCritCull =
      skillDb.flag('CritCanCull', flags, kwFlags) ||
      skillDb.flag('CritCullingStrike', flags, kwFlags);
    let critCull = critCullOverride ?? (hasCritCull ? enemyRarityThreshold : 0);
    if (critCull > 0 && effHitRateForCull > 0) {
      critCull = Math.min(critCull, critCull * (1 - Math.pow(Math.max(0, 1 - critChance / 100), effHitRateForCull)));
    }
    const regCullOverride = skillDb.override('CullPercent', flags, kwFlags);
    const hasRegCull =
      skillDb.flag('CanCull', flags, kwFlags) ||
      skillDb.flag('CullingStrike', flags, kwFlags) ||
      compatibleSupportNames.has('culling strike') ||
      compatibleSupportNames.has('culling strike i') ||
      compatibleSupportNames.has('culling strike ii');
    const regCull = regCullOverride ?? (hasRegCull ? enemyRarityThreshold : 0);
    const incCullMult = Math.max(0, 1 + skillDb.sum('INC', 'CullPercent', flags, kwFlags) / 100);
    cullPct = Math.min(90, Math.max(critCull, regCull) * incCullMult);
  } else {
    const critCullBase = Math.max(
      skillDb.max('CriticalCullPercent', flags, kwFlags) ?? 0,
      skillDb.sum('BASE', 'CriticalCullPercent', flags, kwFlags),
      skillDb.flag('CritCullingStrike', flags, kwFlags) ? 10 : 0,
    );
    const critCull =
      critCullBase > 0 && effHitRateForCull > 0
        ? Math.min(
            critCullBase,
            critCullBase * (1 - Math.pow(Math.max(0, 1 - critChance / 100), effHitRateForCull)),
          )
        : 0;
    const regCull = Math.max(
      skillDb.max('CullPercent', flags, kwFlags) ?? 0,
      skillDb.sum('BASE', 'CullPercent', flags, kwFlags),
      skillDb.sum('BASE', 'CullingStrikeThreshold', flags, kwFlags),
      skillDb.flag('CullingStrike', flags, kwFlags) || compatibleSupportNames.has('culling strike') ? 10 : 0,
    );
    cullPct = Math.min(90, Math.max(critCull, regCull));
  }
  const cullMult = cullPct > 0 ? 100 / (100 - cullPct) : 1;

  const isPoe2CrossbowNonGrenade =
    build.game === 'poe2' &&
    weaponStats?.weaponType === 'Crossbow' &&
    !effectiveSkillTypeSet.has('grenade');
  const hasHitTimeOverride =
    typeof activeSkillData?.hitTimeOverride === 'number' && activeSkillData.hitTimeOverride > 0;
  const poe2SelfCastCooldownDisablesAvg =
    build.game === 'poe2' &&
    Boolean(effCooldown && effCooldown > 0) &&
    !isTrapSkill &&
    !isMineSkill;
  const showAverage =
    Boolean(activeSkillData?.showAverage) &&
    triggerRate === undefined &&
    !isPoe2CrossbowNonGrenade &&
    !hasHitTimeOverride &&
    !poe2SelfCastCooldownDisablesAvg;
  const avgDamagePerHit = Math.round(avgHitWithCrit * (hitChance / 100) * 100) / 100;
  const showAvgImpalePerHit =
    showAverage && impaleDps > 0 && speedExact > 0 ? impaleDps / speedExact : 0;
  const totalDps = showAverage
    ? Math.round((avgDamagePerHit + showAvgImpalePerHit) * cullMult * 100) / 100
    : Math.round(
        (hitDps +
          impaleDps +
          igniteDps +
          bleedDps +
          poisonDps +
          spellDotDps +
          causticGroundDps +
          burningGroundDps +
          mirageAndWispsDps) *
          cullMult *
          100,
      ) / 100;
  const manaCost = activeLevelEntry?.manaCost ?? activeDef.manaCost ?? 15;
  const manaPerSecond = Math.round(manaCost * speed * 10) / 10;

  return {
    activeCount,
    offence: {
      mainSkillName: activeDef.name,
      mainSkillLevel: activeLevel,
      mainSkillBaseLevel: activeBaseLevel,
      mainSkillQuality: activeQuality,
      skillType: isAttack ? 'Attack' : 'Spell',
      damageByType,
      averageHit: avgHitWithCrit,
      speed,
      critChance,
      critMultiplier,
      hitChance,
      effectiveCritMultiplier: Math.round(effectiveCritMultiplier * 100) / 100,
      hitDps,
      ...(impaleDps > 0 ? { impaleDps } : {}),
      igniteDps,
      bleedDps,
      poisonDps,
      totalDps,
      ...(triggerRate !== undefined ? { triggerRate } : {}),
      manaCost,
      manaPerSecond,
    },
  };
}

/**
 * Simulates toggling a passive skill node (allocating shortest path or removing+pruning)
 * to compute live `NodePowerDelta` (`ΔDPS`, `ΔLife`, `ΔES`, `ΔEHP`) for tree hover tooltips.
 */
export function computeNodePower(
  build: Build,
  nodeId: number,
  baseline?: CalcOutput,
): NodePowerDelta {
  const baseOut = baseline ?? calculateBuild(build);
  const tree = getTreeForGame(build.game, build.tree.treeVersion);
  const startNodeId = tree.classStartNodeIds[build.classId] ?? build.tree.allocatedNodeIds[0] ?? 0;
  const ascStartNodeId = getAscendancyStartNodeId(tree, build.ascendancyId);
  const rootIds = ascStartNodeId ? [startNodeId, ascStartNodeId] : [startNodeId];

  const allAllocated = new Set<number>([
    ...build.tree.allocatedNodeIds,
    ...(build.game === 'poe2'
      ? build.activeWeaponSet === 2
        ? build.tree.weaponSet2NodeIds
        : build.tree.weaponSet1NodeIds
      : []),
  ]);

  const isAllocated = allAllocated.has(nodeId);
  let simulatedBuild: Build;

  if (isAllocated) {
    if (rootIds.includes(nodeId)) {
      return { nodeId, isAllocated: true, dpsDelta: 0, dpsDeltaPct: 0, lifeDelta: 0, esDelta: 0, ehpDelta: 0 };
    }
    const pruned = removeNodeAndPruneDisconnected(tree, [...allAllocated], rootIds, nodeId);
    simulatedBuild = {
      ...build,
      tree: {
        ...build.tree,
        allocatedNodeIds: pruned,
        weaponSet1NodeIds: build.tree.weaponSet1NodeIds.filter((id) => pruned.includes(id)),
        weaponSet2NodeIds: build.tree.weaponSet2NodeIds.filter((id) => pruned.includes(id)),
      },
    };
  } else {
    const path = findShortestPathToNode(tree, allAllocated, nodeId);
    if (path.length === 0) {
      return { nodeId, isAllocated: false, dpsDelta: 0, dpsDeltaPct: 0, lifeDelta: 0, esDelta: 0, ehpDelta: 0 };
    }
    simulatedBuild = {
      ...build,
      tree: {
        ...build.tree,
        allocatedNodeIds: [...build.tree.allocatedNodeIds, ...path],
      },
    };
  }

  const nextOut = calculateBuild(simulatedBuild);
  const dpsDelta = nextOut.offence.totalDps - baseOut.offence.totalDps;
  const dpsDeltaPct =
    baseOut.offence.totalDps > 0
      ? Math.round((dpsDelta / baseOut.offence.totalDps) * 1000) / 10
      : 0;

  return {
    nodeId,
    isAllocated,
    dpsDelta,
    dpsDeltaPct,
    lifeDelta: nextOut.defence.life - baseOut.defence.life,
    esDelta: nextOut.defence.energyShield - baseOut.defence.energyShield,
    ehpDelta: nextOut.defence.effectiveHitPool - baseOut.defence.effectiveHitPool,
  };
}
