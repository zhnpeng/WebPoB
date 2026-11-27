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
  type StatBreakdownRow,
} from '@webpob/core';
import {
  findShortestPathToNode,
  getAscendancyStartNodeId,
  getClassDef,
  getClusterNotable,
  getGemById,
  getRuleset,
  getTreeForGame,
  removeNodeAndPruneDisconnected,
  UTILITY_FLASK_BUFFS,
} from '@webpob/data';
import { normalizeStatLineToEn } from '@webpob/i18n';
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
  computeAilmentScaling,
  computeArchmageBonus,
  computeEffectiveEnemyResistance,
  computePoe2CritMultiplier,
  computeSkillSpecialDamage,
  resolveEffectiveChargesAndRage,
} from './offenceUpgrade.js';

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
  return result;
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

function scaleClusterGrantLine(line: string, effectPct: number): string {
  if (effectPct <= 0) return line;
  const mult = 1 + effectPct / 100;
  return line.replace(/([+-]?)(\d+(?:\.\d+)?)/g, (_all, sign: string, numStr: string) => {
    const scaled = Math.floor(Number(numStr) * mult);
    return `${sign}${scaled}`;
  });
}

function injectClusterJewelMods(db: ModDB, jewel: Item, nodeId: number) {
  const allLines = [...jewel.implicits, ...jewel.explicits].map((l) => normalizeStatLineToEn(l)).filter(Boolean);
  let totalAdded = 0;
  let socketCount = 0;
  let smallEffectPct = 0;
  const notableNames: string[] = [];
  const smallGrants: string[] = [];

  for (const line of allLines) {
    let m = line.match(/^Adds (\d+) Passive Skills$/i);
    if (m) {
      totalAdded = Number(m[1]);
      continue;
    }
    m = line.match(/^(\d+) Added Passive Skills? (?:is|are) (?:a )?Jewel Sockets?$/i);
    if (m) {
      socketCount = Number(m[1]);
      continue;
    }
    m = line.match(/^1 Added Passive Skill is (.+)$/i);
    if (m) {
      notableNames.push(m[1]!.trim());
      continue;
    }
    m = line.match(/^Added Small Passive Skills (?:also )?grant:\s*(.+)$/i);
    if (m) {
      smallGrants.push(m[1]!.trim());
      continue;
    }
    m = line.match(/^Added Small Passive Skills have (\d+)% increased effect$/i);
    if (m) {
      smallEffectPct += Number(m[1]);
      continue;
    }
  }

  for (const notableName of notableNames) {
    const def = getClusterNotable(notableName);
    if (def) {
      db.addMods(parseModLines(def.st, `Cluster Notable (${nodeId}): ${def.en}`));
    }
  }

  const smallCount = Math.max(0, totalAdded - socketCount - notableNames.length);
  if (smallCount > 0 && smallGrants.length > 0) {
    const scaledGrants = smallGrants.map((g) => scaleClusterGrantLine(g, smallEffectPct));
    for (let i = 0; i < smallCount; i++) {
      db.addMods(parseModLines(scaledGrants, `Cluster Small (${nodeId}): ${jewel.name}`));
    }
  }
}

function getLevelScalingFactor(gemLevel: number): number {
  // Smooth realistic scaling anchored at 1.0 for Level 20
  const clamped = Math.max(1, Math.min(30, gemLevel));
  return Math.pow(1.11, clamped - 20);
}

function scaleNumericMods(
  mods: readonly Mod[],
  multiplier: number,
  includeMore: boolean,
): Mod[] {
  if (multiplier === 1) return [...mods];
  return mods.map((mod) => {
    if (
      typeof mod.value === 'number' &&
      (mod.type === 'BASE' || mod.type === 'INC' || (includeMore && mod.type === 'MORE'))
    ) {
      return { ...mod, value: Math.trunc(mod.value * multiplier) };
    }
    return mod;
  });
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
  inject(`SpeedPer${chargeType}Charge`, 'Speed', 'INC');
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
        db.addMod({
          name: `${dmgType}${prefix === 'FlatMinPerAttr:' ? 'Min' : 'Max'}`,
          type: 'BASE',
          value: Math.floor(value * mod.value),
          flags: mod.flags,
          keywordFlags: mod.keywordFlags,
          source: `Attribute Stacking (${attr} ${value})`,
        });
      }
    }
  }
}

/**
 * Pure TypeScript Path of Building calculation engine.
 * Supports both PoE 1 and PoE 2 via `GameRuleset`, with full stat breakdowns.
 */
export function calculateBuild(build: Build): CalcOutput {
  const ruleset = getRuleset(build.game);
  const classDef = getClassDef(build.game, build.classId);
  const tree = getTreeForGame(build.game);
  const db = new ModDB();
  const warnings: CalcOutput['warnings'] = [];
  const cfg = build.config;

  // 1. Character base stats & level scaling
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

  // 2. Passive Skill Tree (Shared + PoE 2 active weapon set nodes + Anoints + Jewels + Radius/Tattoos)
  const activeTreeNodes = new Set<number>(build.tree.allocatedNodeIds);
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
  const classStartIdForRadius =
    tree.classStartNodeIds[build.classId] ?? build.tree.allocatedNodeIds[0] ?? 0;
  const radiusJewelEval = evaluateRadiusAndDistanceJewels(
    activeSocketedJewels,
    tree,
    activeTreeNodes,
    classStartIdForRadius,
  );

  const allAllocatedNodeDefs = [
    ...[...activeTreeNodes]
      .map((id) => tree.nodes[id])
      .filter((n): n is NonNullable<typeof n> => Boolean(n)),
    ...anointNodes,
  ];
  const smallPassiveMult = computeSmallPassiveEffectMultiplier(allAllocatedNodeDefs);

  const attrOverrides = build.tree.attributeOverrides ?? {};
  const nodeOverrides = build.tree.nodeOverrides ?? {};
  for (const nodeId of activeTreeNodes) {
    if (radiusJewelEval.suppressedNodeIds.has(nodeId)) continue;
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
    const isRegularSmall = node.kind === 'small' && !node.ascendancyId;
    db.addMods(
      isRegularSmall && smallPassiveMult !== 1
        ? scaleSmallPassiveMods(parsedNodeMods, smallPassiveMult)
        : parsedNodeMods,
    );
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
    db.addMods(parseModLines(statText.split('\n'), `Mastery: ${label}`));
  }

  // Socketed Passive Tree Jewels (Standard, Voices, Cluster, The Adorned & Prefix/Suffix scaled)
  for (const { nodeId, jewel } of activeSocketedJewels) {
    if (jewel.baseName.toLowerCase().includes('cluster jewel')) {
      injectClusterJewelMods(db, jewel, nodeId);
      continue;
    }
    const src = `Jewel (${nodeId}): ${jewel.name}`;
    const scaled = scaleJewelModLines(jewel, allJewelItems, build.game);
    db.addMods(parseModLines(scaled.implicits, `${src} [Implicit]`));
    db.addMods(parseModLines(scaled.explicits, src));
  }

  // Radius & Distance Jewel synthetic grants (Time-Lost, Against the Darkness, Light of Meaning, Might of the Meek, Split Personality, Attr Conversion)
  for (const entry of radiusJewelEval.addedStatLines) {
    db.addMods(parseModLines(entry.lines, entry.source));
  }
  if (radiusJewelEval.addedMods.length > 0) {
    db.addMods(radiusJewelEval.addedMods);
  }

  // Dual-Wielding inherent PoE 1 bonuses (10% more Attack Speed + 20% Attack Block)
  const activeWeapons = getActiveWeapons(build);
  const mainWeaponResolved = activeWeapons.main
    ? resolveItemEffectiveStats(activeWeapons.main, build.game).weaponStats
    : undefined;
  const offWeaponResolved = activeWeapons.off
    ? resolveItemEffectiveStats(activeWeapons.off, build.game).weaponStats
    : undefined;
  const isDualWielding = Boolean(
    mainWeaponResolved &&
      offWeaponResolved &&
      !mainWeaponResolved.twoHanded &&
      !offWeaponResolved.twoHanded,
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
        /^Has \+(\d+) to (Armour|Evasion Rating|maximum Energy Shield|maximum Life|maximum Mana) per player level$/i,
      );
    if (!m) return rawLine;
    return `+${Number(m[1]) * level} to ${m[2]}`;
  });
}

  // 3. Equipped Items & Active Utility Flasks (with PoB-authentic Local Armour/Weapon resolution)
  // PoE 2 Shaman ascendancy ("Shaman" / 萨满) unlocks Bonded ("Bonded:" / "羁绊：") modifiers on items.
  const allowBonded = build.game === 'poe2' && build.ascendancyId.trim().toLowerCase() === 'shaman';
  const itemModOpts = allowBonded ? { allowBonded: true } : undefined;
  const equippedItems = getActiveEquippedItems(build);
  const nonFlaskEquippedForUniques: Array<{ slot: string; item: Item }> = [];
  let bodyLocalArmour = 0;
  let bodyLocalEvasion = 0;
  let bodyLocalEs = 0;
  let helmetLocalArmour = 0;
  let helmetLocalEvasion = 0;
  let helmetLocalEs = 0;
  let shieldLocalArmour = 0;
  let shieldLocalEvasion = 0;
  let shieldLocalEs = 0;
  let corruptedEquippedCount = 0;
  let usingShield = false;
  for (const { slot, item: rawItem } of equippedItems) {
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
    nonFlaskEquippedForUniques.push({ slot, item });
    const src = `Item (${slot}): ${rawItem.name}${mirroredLabel}`;
    const levelExpandedItem: Item = {
      ...item,
      implicits: expandPerPlayerLevelMods(item.implicits, build.level),
      explicits: expandPerPlayerLevelMods(item.explicits, build.level),
    };
    const resolved = resolveItemEffectiveStats(levelExpandedItem, build.game);
    const filledSockets = countFilledSockets(item);
    const effectiveImplicits = expandPerSocketFilledMods(resolved.globalImplicits, filledSockets);
    const effectiveExplicits = expandPerSocketFilledMods(resolved.globalExplicits, filledSockets);
    if (slot === 'Body Armour') {
      bodyLocalArmour = resolved.armourStats?.armour ?? 0;
      bodyLocalEvasion = resolved.armourStats?.evasion ?? 0;
      bodyLocalEs = resolved.armourStats?.energyShield ?? 0;
    } else if (slot === 'Helmet') {
      helmetLocalArmour = resolved.armourStats?.armour ?? 0;
      helmetLocalEvasion = resolved.armourStats?.evasion ?? 0;
      helmetLocalEs = resolved.armourStats?.energyShield ?? 0;
    } else if ((slot === 'Weapon 2' || slot === 'Weapon 2 Swap') && resolved.armourStats) {
      shieldLocalArmour = resolved.armourStats.armour ?? 0;
      shieldLocalEvasion = resolved.armourStats.evasion ?? 0;
      shieldLocalEs = resolved.armourStats.energyShield ?? 0;
      if ((resolved.armourStats.blockChance ?? 0) > 0 || /shield|buckler/i.test(item.baseName)) {
        usingShield = true;
      }
    }
    if (resolved.armourStats?.armour) {
      db.addMod({ name: 'Armour', type: 'BASE', value: resolved.armourStats.armour, flags: 0, keywordFlags: 0, source: src });
    }
    if (resolved.armourStats?.evasion) {
      db.addMod({ name: 'Evasion', type: 'BASE', value: resolved.armourStats.evasion, flags: 0, keywordFlags: 0, source: src });
    }
    if (resolved.armourStats?.energyShield) {
      db.addMod({ name: 'EnergyShield', type: 'BASE', value: resolved.armourStats.energyShield, flags: 0, keywordFlags: 0, source: src });
    }
    if (resolved.armourStats?.ward) {
      db.addMod({ name: 'Ward', type: 'BASE', value: resolved.armourStats.ward, flags: 0, keywordFlags: 0, source: src });
    }
    if (resolved.armourStats?.blockChance) {
      db.addMod({ name: 'BlockChance', type: 'BASE', value: resolved.armourStats.blockChance, flags: 0, keywordFlags: 0, source: src });
    }
    db.addMods(parseModLines(effectiveImplicits, `${src} [Implicit]`, itemModOpts));
    db.addMods(parseModLines(effectiveExplicits, src, itemModOpts));
    if (build.game === 'poe2') {
      const legacyLines = evaluatePoe2MagebloodLegacies(item);
      if (legacyLines.length > 0) {
        db.addMods(parseModLines(legacyLines, `${src} [Mage's Legacy]`, itemModOpts));
      }
    }
  }

  // Extra Socketed Equipment: PoE 1 Abyssal Sockets (with Darkness Enthroned scaling) & PoE 2 0.5 Grafted Limbs / Equipment Jewel Sockets
  for (const { slot, item: extraItem, effectMult } of collectExtraSocketedEquipment(build)) {
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

  // Evaluate Active Flasks (PoE 1 Mageblood auto-activation, magic utility flask base buffs, Enkindling/Alchemist + global FlaskEffect scaling)
  const flaskEval = evaluateActiveFlasks(build, db.sum('INC', 'FlaskEffect'));
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

  // 4. Global Auras, Curses/Marks & Persistent Spirit Buffs (with +Gem Level / Empower / Enlighten / Socketed scaling)
  const customModLines = cfg.customMods
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const parsedCustomAffixMods = parseModLines(customModLines, 'Custom Modifiers');
  const customAuraEffect = parsedCustomAffixMods
    .filter((m) => m.name === 'AuraEffect' && m.type === 'INC' && typeof m.value === 'number')
    .reduce((sum, m) => sum + (m.value as number), 0);
  const customCurseEffect = parsedCustomAffixMods
    .filter((m) => m.name === 'CurseEffect' && m.type === 'INC' && typeof m.value === 'number')
    .reduce((sum, m) => sum + (m.value as number), 0);
  const auraEffectPct = db.sum('INC', 'AuraEffect') + customAuraEffect;
  const curseEffectPct = db.sum('INC', 'CurseEffect') + customCurseEffect;
  const auraReservations: Array<{ pct: number; flat: number; mult: number }> = [];
  let totalSpiritReserved = 0;
  // Deduplicate active global auras/buffs by gem ID (PoB2 exports item-granted skills both as a player group and as a source="Item:..." group).
  const activeGlobalBuffs = new Map<
    string,
    {
      def: GemDefinition;
      gemInst: GemInstance;
      effLevel: number;
      isAura: boolean;
      isCurseOrMark: boolean;
      groupEnlightenMult: number;
    }
  >();
  for (const group of build.skills) {
    if (!group.enabled) continue;
    if (build.game === 'poe2' && group.weaponSets && !group.weaponSets.includes(build.activeWeaponSet)) {
      continue;
    }
    const slotItem =
      group.slot && build.equipped[group.slot] ? build.items[build.equipped[group.slot]!] : undefined;
    const groupSocketedRules = slotItem
      ? parseSocketedGemBonuses([...slotItem.implicits, ...slotItem.explicits])
      : [];

    // Check if Empower or Enlighten is linked in this aura/curse skill group
    let groupEmpowerBonus = 0;
    let groupEnlightenMult = 1;
    for (const supInst of group.gems) {
      if (!supInst.enabled) continue;
      const supDef = getGemById(build.game, supInst.gemId);
      if (!supDef || supDef.category !== 'support') continue;
      const lower = supDef.name.en.toLowerCase();
      if (lower === 'empower' || lower === 'awakened empower') {
        const supBon = resolveGemBonuses(supDef, db, groupSocketedRules);
        groupEmpowerBonus += Math.max(0, supInst.level + supBon.levelBonus - 1);
      } else if (lower === 'enlighten' || lower === 'awakened enlighten') {
        const supBon = resolveGemBonuses(supDef, db, groupSocketedRules);
        const effEnlightenLv = Math.max(1, supInst.level + supBon.levelBonus);
        // Official PoE 1 Enlighten multiplier: Lv.1=100%, Lv.2=96%, Lv.3=92%, Lv.4=88%, Lv.5=84%, Lv.6=80%...
        groupEnlightenMult *= Math.max(0.5, 1 - Math.max(0, effEnlightenLv - 1) * 0.04);
      }
    }

    for (const gemInst of group.gems) {
      if (!gemInst.enabled) continue;
      const def = getGemById(build.game, gemInst.gemId);
      if (!def) continue;
      const tags = new Set(def.tags.map((tag) => tag.toLowerCase()));
      const isCurseOrMark = tags.has('curse') || tags.has('mark');
      const isHerald = tags.has('herald');
      const isAura = !isCurseOrMark && !isHerald && (tags.has('aura') || (def.manaReservationPct ?? 0) > 0);
      const isGlobalBuff = def.isAuraOrBuff || (def.category === 'active' && (isAura || isCurseOrMark));
      if (!isGlobalBuff) continue;
      const gemBon = resolveGemBonuses(def, db, groupSocketedRules);
      const effLevel = Math.min(40, Math.max(1, gemInst.level + gemBon.levelBonus + groupEmpowerBonus));
      const prev = activeGlobalBuffs.get(def.id);
      if (
        !prev ||
        effLevel > prev.effLevel ||
        (effLevel === prev.effLevel && groupEnlightenMult < prev.groupEnlightenMult)
      ) {
        activeGlobalBuffs.set(def.id, {
          def,
          gemInst,
          effLevel,
          isAura,
          isCurseOrMark,
          groupEnlightenMult,
        });
      }
    }
  }

  for (const { def, gemInst, effLevel, isAura, isCurseOrMark, groupEnlightenMult } of activeGlobalBuffs.values()) {
    const levelEntry = resolveGemLevelEntry(def, effLevel);
    // Official PoB2 act_dex.lua: Wind Dancer weaponTypes excludes Quarterstaff / Wand / Unarmed
    const windDancerDisallowed =
      def.id === 'poe2_winddancer' &&
      (mainWeaponResolved?.weaponType === 'Quarterstaff' || mainWeaponResolved?.weaponType === 'Wand');
    const auraStats = windDancerDisallowed ? [] : (levelEntry?.stats ?? def.stats);
    const parsedAuraMods = parseModLines(
      auraStats,
      `Aura/Buff: ${def.name.en}${effLevel !== gemInst.level ? ` (Lv.${effLevel})` : ''}`,
    );
    if (isAura && auraEffectPct > 0) {
      db.addMods(scaleNumericMods(parsedAuraMods, 1 + auraEffectPct / 100, true));
    } else if (isCurseOrMark && curseEffectPct > 0) {
      db.addMods(scaleNumericMods(parsedAuraMods, 1 + curseEffectPct / 100, false));
    } else {
      db.addMods(parsedAuraMods);
    }
    if (def.manaReservationPct || def.manaReservationFlat) {
      auraReservations.push({
        pct: def.manaReservationPct ?? 0,
        flat: def.manaReservationFlat ?? 0,
        mult: groupEnlightenMult,
      });
    }
    const spiritCost = gemInst.spiritReservationOverride ?? def.spiritReservation ?? 0;
    if (spiritCost > 0) {
      totalSpiritReserved += spiritCost;
    }
  }

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

  if (cfg.onslaught) {
    db.addMod({ name: 'Speed', type: 'INC', value: 20, flags: ModFlag.Attack, keywordFlags: 0, source: 'Onslaught' });
    db.addMod({ name: 'Speed', type: 'INC', value: 20, flags: ModFlag.Spell, keywordFlags: 0, source: 'Onslaught' });
    db.addMod({ name: 'MovementSpeed', type: 'INC', value: 20, flags: 0, keywordFlags: 0, source: 'Onslaught' });
  }
  if (cfg.conditionLowLife && db.flag('PainAttunement')) {
    db.addMod({
      name: 'Damage',
      type: 'MORE',
      value: 30,
      flags: ModFlag.Spell,
      keywordFlags: 0,
      source: 'Pain Attunement (Low Life)',
    });
  }
  if (cfg.buffArcaneSurge) {
    // Official PoE 1 3.30 Arcane Surge buff: 20% increased Cast Speed & 30% increased Mana Regen
    db.addMod({ name: 'Speed', type: 'INC', value: 20, flags: ModFlag.Spell, keywordFlags: 0, source: 'Arcane Surge' });
    db.addMod({ name: 'ManaRegen', type: 'INC', value: 30, flags: 0, keywordFlags: 0, source: 'Arcane Surge' });
  }
  if (cfg.buffTailwind) {
    // Tailwind: 8% increased Action Speed (multiplicative with Attack/Cast/Movement Speed)
    db.addMod({ name: 'Speed', type: 'MORE', value: 8, flags: ModFlag.Attack, keywordFlags: 0, source: 'Tailwind' });
    db.addMod({ name: 'Speed', type: 'MORE', value: 8, flags: ModFlag.Spell, keywordFlags: 0, source: 'Tailwind' });
    db.addMod({ name: 'MovementSpeed', type: 'MORE', value: 8, flags: 0, keywordFlags: 0, source: 'Tailwind' });
  }
  if (cfg.enemyIntimidated) {
    db.addMod({ name: 'EnemyDamageTaken', type: 'INC', value: 10, flags: ModFlag.Attack, keywordFlags: 0, source: 'Intimidated' });
  }
  if (cfg.enemyUnnerved) {
    db.addMod({ name: 'EnemyDamageTaken', type: 'INC', value: 10, flags: ModFlag.Spell, keywordFlags: 0, source: 'Unnerved' });
  }
  if (cfg.witheredStacks && cfg.witheredStacks > 0) {
    const stacks = Math.min(15, Math.max(0, Math.round(cfg.witheredStacks)));
    db.addMod({
      name: 'EnemyChaosDamageTaken',
      type: 'INC',
      value: stacks * 6,
      flags: 0,
      keywordFlags: 0,
      source: `Withered (${stacks})`,
    });
  }
  const extraExposure = db.sum('BASE', 'ExtraExposure');
  const exposurePenalty = -(10 + extraExposure);
  if (cfg.enemyFireExposure) {
    db.addMod({ name: 'EnemyFireResist', type: 'BASE', value: exposurePenalty, flags: 0, keywordFlags: 0, source: 'Fire Exposure' });
  }
  if (cfg.enemyColdExposure) {
    db.addMod({ name: 'EnemyColdResist', type: 'BASE', value: exposurePenalty, flags: 0, keywordFlags: 0, source: 'Cold Exposure' });
  }
  if (cfg.enemyLightningExposure) {
    db.addMod({ name: 'EnemyLightningResist', type: 'BASE', value: exposurePenalty, flags: 0, keywordFlags: 0, source: 'Lightning Exposure' });
  }
  if (cfg.rage && cfg.rage > 0) {
    // Official PoE 1 (3.30) & PoE 2 (0.5) Rage: Base Maximum Rage = 30, grants 1% more Attack Damage per Rage
    const maxRage = Math.max(0, 30 + Math.round(db.sum('BASE', 'MaximumRage')));
    const rageStacks = Math.min(maxRage, Math.max(0, Math.round(cfg.rage)));
    if (rageStacks > 0) {
      db.addMod({
        name: 'Damage',
        type: 'MORE',
        value: rageStacks,
        flags: ModFlag.Attack,
        keywordFlags: 0,
        source: `Rage (${rageStacks})`,
      });
    }
  }

  if (cfg.customMods.trim()) {
    db.addMods(parsedCustomAffixMods);
  }

  // Grant Onslaught from Silver Flask if not already active via config
  if (!cfg.onslaught && flaskEval.grantsOnslaught) {
    db.addMod({ name: 'Speed', type: 'INC', value: 20, flags: ModFlag.Attack, keywordFlags: 0, source: 'Silver Flask (Onslaught)' });
    db.addMod({ name: 'Speed', type: 'INC', value: 20, flags: ModFlag.Spell, keywordFlags: 0, source: 'Silver Flask (Onslaught)' });
    db.addMod({ name: 'MovementSpeed', type: 'INC', value: 20, flags: 0, keywordFlags: 0, source: 'Silver Flask (Onslaught)' });
  }

  // Populate ModDB Tag Evaluation Context (Conditions, Multipliers, Equipment Stats)
  const usingStaff =
    mainWeaponResolved?.weaponType === 'Staff' || mainWeaponResolved?.weaponType === 'Quarterstaff';
  const usingTwoHanded = Boolean(mainWeaponResolved?.twoHanded);
  const hasActiveHerald = [...activeGlobalBuffs.values()].some(({ def }) =>
    def.tags.some((t) => t.toLowerCase() === 'herald'),
  );
  const activeAuraCount = [...activeGlobalBuffs.values()].filter(({ isAura }) => isAura).length;
  db.setCondition('LowLife', Boolean(cfg.conditionLowLife));
  db.setCondition('FullLife', !cfg.conditionLowLife);
  db.setCondition('DualWielding', isDualWielding);
  db.setCondition('UsingShield', usingShield);
  db.setCondition('UsingStaff', usingStaff);
  db.setCondition('UsingTwoHandedWeapon', usingTwoHanded);
  db.setCondition('EnemyShocked', Boolean(cfg.enemyShocked));
  db.setCondition('EnemyChilled', Boolean(cfg.enemyChilled));
  db.setCondition('EnemyTaunted', Boolean(cfg.enemyTaunted));
  db.setCondition('AffectedByHerald', hasActiveHerald);
  db.setCondition('OnConsecratedGround', Boolean(flaskEval.grantsConsecratedGround));
  db.setStat('BodyArmourES', bodyLocalEs);
  db.setStat('BodyArmourEvasion', bodyLocalEvasion);
  db.setStat('BodyArmourArmour', bodyLocalArmour);
  db.setStat('HelmetES', helmetLocalEs);
  db.setStat('ShieldES', shieldLocalEs);
  db.setStat('ShieldArmour', shieldLocalArmour);
  db.setStat('ShieldEvasion', shieldLocalEvasion);
  db.setMultiplier('CorruptedItem', corruptedEquippedCount);
  db.setMultiplier('AllocatedMastery', Object.keys(build.tree.masteryEffects ?? {}).length);

  // Pre-stat Ascendancy Mechanics (Invoker Spirit, Sunder the Flesh, Deadeye, Stormweaver, Slayer, Assassin, Necromancer, etc.)
  applyPreStatAscendancyMechanics({
    game: build.game,
    db,
    allocatedNodes: allAllocatedNodeDefs,
    config: cfg,
    bodyArmourStats: {
      armour: bodyLocalArmour,
      evasion: bodyLocalEvasion,
      energyShield: bodyLocalEs,
    },
    activeAuraCount,
    masteryCount: 0,
  });

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
    countAsMaxPower: uniqueGearResult.ralakeshCharges.power,
    explicitPowerCharges: cfg.powerCharges !== 3 ? cfg.powerCharges : undefined,
    useFrenzyCharges: cfg.useFrenzyCharges,
    countAsMaxFrenzy: uniqueGearResult.ralakeshCharges.frenzy,
    explicitFrenzyCharges: cfg.frenzyCharges !== 3 ? cfg.frenzyCharges : undefined,
    useEnduranceCharges: cfg.useEnduranceCharges,
    countAsMaxEndurance: uniqueGearResult.ralakeshCharges.endurance,
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
  db.setMultiplier('Rage', chargesAndRage.rage);

  if (activePower > 0) {
    const perCharge = build.game === 'poe2' ? 40 : 50;
    db.addMod({
      name: 'CritChance',
      type: 'INC',
      value: activePower * perCharge,
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
  if (activeFrenzy > 0) {
    db.addMod({ name: 'Speed', type: 'INC', value: activeFrenzy * 4, flags: ModFlag.Attack, keywordFlags: 0, source: `Frenzy Charges (${activeFrenzy})` });
    db.addMod({ name: 'Speed', type: 'INC', value: activeFrenzy * 4, flags: ModFlag.Spell, keywordFlags: 0, source: `Frenzy Charges (${activeFrenzy})` });
    db.addMod({ name: 'Damage', type: 'MORE', value: activeFrenzy * 4, flags: 0, keywordFlags: 0, source: `Frenzy Charges (${activeFrenzy})` });
  }
  if (activeEndurance > 0) {
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
  // Crave the Slaughter: Every Rage also grants X% increased Attack Speed
  if (cfg.rage && cfg.rage > 0) {
    const maxRage = Math.max(0, 30 + Math.round(db.sum('BASE', 'MaximumRage')));
    const rageStacks = Math.min(maxRage, Math.max(0, Math.round(cfg.rage)));
    const rageAsPerStack = db.sum('BASE', 'RageGrantsAttackSpeed');
    if (rageStacks > 0 && rageAsPerStack > 0) {
      db.addMod({
        name: 'Speed',
        type: 'INC',
        value: rageStacks * rageAsPerStack,
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

  if (ruleset.lifePerStrength > 0) {
    db.addMod({ name: 'Life', type: 'BASE', value: Math.floor(str * ruleset.lifePerStrength), flags: 0, keywordFlags: 0, source: `Strength (${str})` });
  }
  const strDmgBonus = ruleset.meleePhysPctPerStrength > 0 ? Math.floor(str * ruleset.meleePhysPctPerStrength) : 0;
  if (strDmgBonus > 0) {
    db.addMod({ name: 'PhysicalDamage', type: 'INC', value: strDmgBonus, flags: ModFlag.Melee, keywordFlags: 0, source: `Strength (${str})` });
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
  if (ruleset.accuracyPerDexterity > 0) {
    db.addMod({ name: 'Accuracy', type: 'BASE', value: Math.floor(dex * ruleset.accuracyPerDexterity), flags: 0, keywordFlags: 0, source: `Dexterity (${dex})` });
  }
  const ironReflexes = db.flag('IronReflexes');
  if (ruleset.evasionPctPerDexterity > 0 && !ironReflexes) {
    db.addMod({ name: 'Evasion', type: 'INC', value: Math.floor(dex * ruleset.evasionPctPerDexterity), flags: 0, keywordFlags: 0, source: `Dexterity (${dex})` });
  }
  if (ruleset.manaPerIntelligence > 0) {
    db.addMod({ name: 'Mana', type: 'BASE', value: Math.floor(int * ruleset.manaPerIntelligence), flags: 0, keywordFlags: 0, source: `Intelligence (${int})` });
  }
  if (ruleset.esPctPerIntelligence > 0) {
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

  // 7. Compute Defence Output (including Iron Reflexes, Ward, PoE 2 EB, Slot-Specific Defence INC, Ascendancy Post-Life & Reservation)
  const rawLifeEval = db.calcStat('Life');
  const lifeConvToEsPct = Math.min(100, Math.max(0, db.sum('BASE', 'LifeConvertToES')));
  if (lifeConvToEsPct > 0 && rawLifeEval.total > 1) {
    const convertedBase = Math.round(rawLifeEval.base * (lifeConvToEsPct / 100));
    db.addMod({ name: 'EnergyShield', type: 'BASE', value: convertedBase, flags: 0, keywordFlags: 0, source: 'Life Converted to Energy Shield' });
  }

  // PoE 2 Eldritch Battery: Convert 100% of maximum Energy Shield to maximum Mana
  const poe2Eb = build.game === 'poe2' && db.flag('Poe2EldritchBattery');
  if (poe2Eb) {
    const preEbEsBase = db.calcStat('EnergyShield').base;
    if (preEbEsBase > 0) {
      db.addMod({ name: 'Mana', type: 'BASE', value: preEbEsBase, flags: 0, keywordFlags: 0, source: 'Eldritch Battery (ES -> Mana)' });
    }
    db.addMod({ name: 'EnergyShield', type: 'OVERRIDE', value: 0, flags: 0, keywordFlags: 0, source: 'Eldritch Battery' });
  }

  const prelimLifeEval = db.calcStat('Life');
  const prelimLife =
    lifeConvToEsPct > 0 && prelimLifeEval.total > 1
      ? Math.max(1, Math.round(prelimLifeEval.total * (1 - lifeConvToEsPct / 100)))
      : Math.round(prelimLifeEval.total);
  const prelimMana = Math.round(db.calcStat('Mana').total);
  const prelimEs = Math.round(db.calcStat('EnergyShield').total);
  const prelimAcc = Math.round(db.calcStat('Accuracy').total);

  // Post-Life Ascendancy Mechanics (Gore Spike, Beidat's Hand/Will/Gaze, Juggernaut Undeniable, Chieftain Valako/Tasalio, Slayer Masterful Form, Assassin Deadly Infusion)
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

  const lifeEval = db.calcStat('Life');
  const esEval = db.calcStat('EnergyShield');
  const wardEval = db.calcStat('Ward');
  const manaEval = db.calcStat('Mana');
  const spiritEval = db.calcStat('Spirit');
  const armourEval = db.calcStat('Armour');
  const evasionEval = db.calcStat('Evasion');
  const moveSpeedEval = db.calcStat('MovementSpeed');

  const life =
    lifeConvToEsPct > 0 && lifeEval.total > 1
      ? Math.max(1, Math.round(lifeEval.total * (1 - lifeConvToEsPct / 100)))
      : Math.round(lifeEval.total);
  db.setStat('Life', life);
  db.setStat('Mana', Math.round(manaEval.total));

  // Slot-specific "% increased Armour / Evasion / Energy Shield from Equipped Body Armour / Shield / Helmet"
  const sumSlotInc = (slot: 'BodyArmour' | 'Shield' | 'Helmet', stat: 'EnergyShield' | 'Armour' | 'Evasion') => {
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
  const extraSlotEs =
    poe2Eb || esEval.sources.some((s) => s.type === 'OVERRIDE' && s.value === 0)
      ? 0
      : (bodyLocalEs * (sumSlotInc('BodyArmour', 'EnergyShield') / 100) +
          shieldLocalEs * (sumSlotInc('Shield', 'EnergyShield') / 100) +
          helmetLocalEs * (sumSlotInc('Helmet', 'EnergyShield') / 100)) *
        esEval.moreMultiplier;
  const extraSlotArmour =
    (bodyLocalArmour * (sumSlotInc('BodyArmour', 'Armour') / 100) +
      shieldLocalArmour * (sumSlotInc('Shield', 'Armour') / 100) +
      helmetLocalArmour * (sumSlotInc('Helmet', 'Armour') / 100)) *
    armourEval.moreMultiplier;
  const extraSlotEvasion =
    (bodyLocalEvasion * (sumSlotInc('BodyArmour', 'Evasion') / 100) +
      shieldLocalEvasion * (sumSlotInc('Shield', 'Evasion') / 100) +
      helmetLocalEvasion * (sumSlotInc('Helmet', 'Evasion') / 100)) *
    evasionEval.moreMultiplier;

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
  // Hierophant Divine Guidance: Transfiguration of Mind (30% of Mana INC applies to Damage)
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
  const energyShield = Math.round(esEval.total + extraEsFromLife + extraEsFromMana + extraSlotEs);
  const ward = Math.round(wardEval.total);
  const mana = Math.round(manaEval.total);
  const spirit = ruleset.supportsSpirit && !db.flag('ZeroSpirit') ? Math.round(spiritEval.total) : 0;

  let armour = Math.round(armourEval.total + extraSlotArmour);
  let evasion = Math.round(evasionEval.total + extraSlotEvasion);
  if (ironReflexes) {
    // Official PoB Iron Reflexes: Base Evasion converts to Armour and scales with BOTH Armour & Evasion inc/more
    const convertedArmour =
      evasionEval.base *
      (1 + (armourEval.incPct + evasionEval.incPct) / 100) *
      armourEval.moreMultiplier *
      evasionEval.moreMultiplier;
    armour = Math.round(armourEval.total + extraSlotArmour + convertedArmour);
    evasion = 0;
  }
  db.setStat('EnergyShield', energyShield);
  db.setStat('Armour', armour);
  db.setStat('Evasion', evasion);
  db.setStat('Accuracy', Math.round(db.calcStat('Accuracy').total));

  const manaResEff = Math.max(-90, db.sum('INC', 'ManaReservationEfficiency'));
  let totalManaReservedFlat = 0;
  let totalManaReservedPctExact = 0;
  for (const res of auraReservations) {
    if (res.pct > 0) {
      // Matches PoB CalcPerform: basePercentVal = trunc(pct * 100 * mult); reservedPercent = round(basePercentVal / (1 + eff/100)) / 100
      const basePercentVal = Math.trunc(res.pct * 100 * res.mult + 1e-6);
      const effPct = Math.max(0, Math.round(basePercentVal / (1 + manaResEff / 100)) / 100);
      totalManaReservedPctExact += effPct;
      totalManaReservedFlat += Math.ceil(mana * (effPct / 100) - 1e-9);
    }
    if (res.flat > 0) {
      const baseFlatVal = Math.trunc(res.flat * res.mult + 1e-6);
      const effFlat = Math.max(0, Math.round(baseFlatVal / (1 + manaResEff / 100)));
      totalManaReservedFlat += effFlat;
    }
  }
  const totalManaReservedPct =
    mana > 0
      ? Math.round((totalManaReservedFlat / mana) * 1000) / 10
      : Math.round(totalManaReservedPctExact * 10) / 10;
  const manaUnreserved = Math.max(0, mana - totalManaReservedFlat);
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

  const fireRaw = Math.round(db.sum('BASE', 'FireResist'));
  const coldRaw = Math.round(db.sum('BASE', 'ColdResist'));
  const lightningRaw = Math.round(db.sum('BASE', 'LightningResist'));
  const chaosImmune = db.flag('ChaosImmune');
  const chaosRaw = chaosImmune ? 100 : Math.round(db.sum('BASE', 'ChaosResist'));

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
    evasion > 0
      ? Math.min(95, Math.max(0, Math.round((1 - (1.25 * enemyAcc) / (enemyAcc + Math.pow(evasion / 5, 0.9))) * 100)))
      : 0;

  const maxAttackBlock = Math.min(90, ruleset.maxBlockChance + Math.round(db.sum('BASE', 'BlockChanceMax')));
  const maxSpellBlock = Math.min(90, ruleset.maxBlockChance + Math.round(db.sum('BASE', 'SpellBlockChanceMax')));
  const rawAttackBlock = db.calcStat('BlockChance').total;
  const blockChance = Math.min(maxAttackBlock, Math.max(0, Math.floor(rawAttackBlock + 1e-6)));
  const spellBlockChance = Math.min(maxSpellBlock, Math.max(0, Math.round(db.sum('BASE', 'SpellBlockChance'))));
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
    lifeUnreserved: life,
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

  // 8. Compute Offence Output for Main Skill Group
  const offence = computeOffence(build, db, defence, uniqueGearResult, activePower);

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
    return !node?.ascendancyId;
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
  };
}

function computeOffence(
  build: Build,
  globalDb: ModDB,
  defence: CalcDefenceOutput,
  uniqueGearResult?: SpecialUniqueGearResult,
  activePowerCharges = 0,
): CalcOffenceOutput {
  const mainGroup =
    build.skills.find((g) => g.id === build.mainSkillGroupId && g.enabled) ??
    build.skills.find((g) => g.enabled);

  const mainResult = computeGroupOffence(build, globalDb, defence, mainGroup, uniqueGearResult, activePowerCharges);

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
          : computeGroupOffence(build, globalDb, defence, grp, uniqueGearResult, activePowerCharges);
      if (res.offence.skillType === 'None') continue;
      const count = Math.max(1, res.activeCount);
      const groupHit = (res.offence.hitDps + (res.offence.impaleDps ?? 0) + res.offence.poisonDps) * count;
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
  globalDb: ModDB,
  _defence: CalcDefenceOutput,
  mainGroup: Build['skills'][number] | undefined,
  uniqueGearResult?: SpecialUniqueGearResult,
  activePowerCharges = 0,
): { offence: CalcOffenceOutput; activeCount: number } {
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
  const skillDb = globalDb.clone();

  // Resolve slot item for PoE 1 matching socket quality bonus AND `+N to Level/Quality of Socketed Gems`
  let slotDefaultSocketColor: 'red' | 'green' | 'blue' | undefined;
  const slotItem =
    mainGroup.slot && build.equipped[mainGroup.slot]
      ? build.items[build.equipped[mainGroup.slot]!]
      : undefined;
  const socketedRules = slotItem
    ? parseSocketedGemBonuses([...slotItem.implicits, ...slotItem.explicits])
    : [];
  if (build.game === 'poe1' && slotItem) {
    if (slotItem.armourStats) {
      const a = slotItem.armourStats.armour ?? 0;
      const e = slotItem.armourStats.evasion ?? 0;
      const es = slotItem.armourStats.energyShield ?? 0;
      if (es > 0 && a === 0 && e === 0) slotDefaultSocketColor = 'blue';
      else if (a > 0 && e === 0 && es === 0) slotDefaultSocketColor = 'red';
      else if (e > 0 && a === 0 && es === 0) slotDefaultSocketColor = 'green';
    } else if (slotItem.weaponStats) {
      const wt = slotItem.weaponStats.weaponType;
      if (wt === 'Wand' || wt === 'Staff') slotDefaultSocketColor = 'blue';
      else if (wt === 'Bow' || wt === 'Claw' || wt === 'Dagger') slotDefaultSocketColor = 'green';
      else if (wt === 'Axe' || wt === 'Mace') slotDefaultSocketColor = 'red';
    }
  }

  const applyGemQualityStats = (def: GemDefinition, rawQuality: number, sourcePrefix: string) => {
    const socketBonus =
      build.game === 'poe1' && slotDefaultSocketColor && def.color === slotDefaultSocketColor ? 10 : 0;
    const effectiveQuality = rawQuality + socketBonus;
    if (effectiveQuality <= 0) return effectiveQuality;
    if (def.qualityStats) {
      for (const qs of def.qualityStats) {
        const val = Math.trunc(effectiveQuality * qs.perQuality);
        if (val !== 0) {
          const line = qs.template.replace('{v}', String(val));
          skillDb.addMods(parseModLines([line], `${sourcePrefix}: ${def.name.en} (Q${effectiveQuality})`));
        }
      }
    } else if (def.category === 'active' && rawQuality > 0) {
      // Fallback for uncurated active gems without explicit qualityStats
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

  const activeCandidates: Array<{
    inst: (typeof mainGroup.gems)[number];
    def: GemDefinition;
  }> = [];

  let empowerLevelBonus = 0;
  let enhanceQualityBonus = 0;

  for (const gemInst of mainGroup.gems) {
    if (!gemInst.enabled) continue;
    const def = getGemById(build.game, gemInst.gemId);
    if (!def) continue;
    if (def.category === 'active' && !def.isAuraOrBuff) {
      activeCandidates.push({ inst: gemInst, def });
    } else if (def.category === 'support') {
      const supBonus = resolveGemBonuses(def, globalDb, socketedRules);
      const effSupLevel = Math.min(40, Math.max(1, gemInst.level + supBonus.levelBonus));
      const effSupQuality = gemInst.quality + supBonus.qualityBonus;
      const lower = def.name.en.toLowerCase();
      if (lower === 'empower' || lower === 'awakened empower') {
        empowerLevelBonus += Math.max(0, effSupLevel - 1);
        continue;
      }
      if (lower === 'enhance' || lower === 'awakened enhance') {
        enhanceQualityBonus += Math.max(0, effSupLevel - 1) * 8;
        continue;
      }
      if (build.game === 'poe1' && lower === 'rage') {
        // Official PoE 1 3.30 Rage Support: +(floor((lv+19)/2))% increased Attack Speed while at >= 10 Rage (Lv.20 = +19%)
        const maxRage = Math.max(0, 30 + Math.round(globalDb.sum('BASE', 'MaximumRage')));
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
        applyGemQualityStats(def, effSupQuality, 'Support');
        continue;
      }
      const levelEntry = resolveGemLevelEntry(def, effSupLevel);
      const effectiveStats = levelEntry?.stats ?? def.stats;
      skillDb.addMods(parseModLines(effectiveStats, `Support: ${def.name.en}`));
      applyGemQualityStats(def, effSupQuality, 'Support');
    }
  }

  let triggerAttackDef: GemDefinition | undefined;
  if (activeCandidates.length > 0) {
    const pickIdx = Math.max(
      0,
      Math.min(activeCandidates.length - 1, (mainGroup.mainActiveSkillIndex ?? 1) - 1),
    );
    const chosen = activeCandidates[pickIdx]!;
    activeDef = chosen.def;
    activeBaseLevel = chosen.inst.level;
    const activeBonus = resolveGemBonuses(chosen.def, globalDb, socketedRules);
    const prismBonus =
      uniqueGearResult?.skillSpecificGemLevels[chosen.def.name.en.trim().toLowerCase()] ?? 0;
    activeLevel = Math.min(
      40,
      Math.max(1, chosen.inst.level + activeBonus.levelBonus + empowerLevelBonus + prismBonus),
    );
    activeCount = Math.max(1, chosen.inst.count ?? 1);
    const chosenLevelEntry = resolveGemLevelEntry(chosen.def, activeLevel);
    const chosenEffectiveStats = chosenLevelEntry?.stats ?? chosen.def.stats;
    activeQuality = applyGemQualityStats(
      chosen.def,
      chosen.inst.quality + activeBonus.qualityBonus + enhanceQualityBonus,
      'Skill',
    );
    skillDb.addMods(parseModLines(chosenEffectiveStats, `Skill: ${chosen.def.name.en}`));
    // Official PoE 1 Arc mechanic: 15% more Damage with Hits and Ailments per remaining Chain
    // Base chains scale every 5 levels (Lv.1-5: 4, Lv.6-10: 5, Lv.11-15: 6, Lv.16-20: 7, Lv.21-25: 8, Lv.26-30: 9) + 0.05 chains per 1% quality
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
    const companionAtk = activeCandidates.find(
      (c, i) => i !== pickIdx && (c.def.modFlags & ModFlag.Attack) !== 0,
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

  const isMinion = Boolean(activeDef.minionBase);
  const isAttack = !isMinion && (activeDef.modFlags & ModFlag.Attack) !== 0;
  const flags = activeDef.modFlags | ModFlag.Hit;
  const kwFlags = activeDef.keywordFlags;
  const activeLevelEntry = resolveGemLevelEntry(activeDef, activeLevel);
  const levelFactor = activeLevelEntry ? 1 : getLevelScalingFactor(activeLevel);
  void activeQuality;

  const effectiveness =
    ((activeLevelEntry?.damageEffectivenessPct ?? activeDef.damageEffectivenessPct ?? 100) / 100);
  const activeWeapons = getActiveWeapons(build);
  const mainWeaponStats = activeWeapons.main
    ? resolveItemEffectiveStats(activeWeapons.main, build.game).weaponStats
    : undefined;
  const offWeaponStats = activeWeapons.off
    ? resolveItemEffectiveStats(activeWeapons.off, build.game).weaponStats
    : undefined;
  const isDualWield = Boolean(
    !isMinion && mainWeaponStats && offWeaponStats && !mainWeaponStats.twoHanded && !offWeaponStats.twoHanded,
  );
  const weaponStats = mainWeaponStats;

  // Step A: Base Min/Max per DamageType before conversion
  const baseMin: Record<DamageType, number> = { Physical: 0, Lightning: 0, Cold: 0, Fire: 0, Chaos: 0 };
  const baseMax: Record<DamageType, number> = { Physical: 0, Lightning: 0, Cold: 0, Fire: 0, Chaos: 0 };

  if (isMinion && activeDef.minionBase) {
    baseMin.Physical += activeDef.minionBase.physicalMin * levelFactor;
    baseMax.Physical += activeDef.minionBase.physicalMax * levelFactor;
  } else if (isAttack) {
    const baseAtkPct = activeLevelEntry?.attackDamageMultiplierPct ?? activeDef.attackDamageMultiplierPct ?? 100;
    const atkMult = activeLevelEntry ? baseAtkPct / 100 : (baseAtkPct / 100) * Math.pow(1.03, activeLevel - 20);
    if (isDualWield && mainWeaponStats && offWeaponStats) {
      baseMin.Physical += ((mainWeaponStats.physicalMin + offWeaponStats.physicalMin) / 2) * atkMult;
      baseMax.Physical += ((mainWeaponStats.physicalMax + offWeaponStats.physicalMax) / 2) * atkMult;
      for (const dt of ['Fire', 'Cold', 'Lightning', 'Chaos'] as const) {
        const mRange = mainWeaponStats.elementalDamage?.[dt];
        const oRange = offWeaponStats.elementalDamage?.[dt];
        if (mRange || oRange) {
          baseMin[dt] += (((mRange?.[0] ?? 0) + (oRange?.[0] ?? 0)) / 2) * atkMult;
          baseMax[dt] += (((mRange?.[1] ?? 0) + (oRange?.[1] ?? 0)) / 2) * atkMult;
        }
      }
    } else {
      const wMin = weaponStats?.physicalMin ?? 15;
      const wMax = weaponStats?.physicalMax ?? 30;
      baseMin.Physical += wMin * atkMult;
      baseMax.Physical += wMax * atkMult;
      if (weaponStats?.elementalDamage) {
        for (const [el, range] of Object.entries(weaponStats.elementalDamage)) {
          if (!range) continue;
          const dt = el as DamageType;
          baseMin[dt] += range[0] * atkMult;
          baseMax[dt] += range[1] * atkMult;
        }
      }
    }
  } else if (activeLevelEntry?.baseDamage ?? activeDef.baseDamage) {
    const srcDmg = activeLevelEntry?.baseDamage ?? activeDef.baseDamage!;
    for (const dt of DAMAGE_TYPES) {
      const range = srcDmg[dt];
      if (range) {
        baseMin[dt] += range[0] * levelFactor;
        baseMax[dt] += range[1] * levelFactor;
      }
    }
  }

  // Detect active special support / buff gems (Rakiata's Flow, Garukhan's Resolve, Archmage, Ephemeral Edge, Righteous Fire)
  const linkedSupportNames = new Set<string>();
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
  if (build.game === 'poe1' && activeDef.name.en.trim().toLowerCase() !== 'righteous fire') {
    for (const grp of build.skills) {
      if (!grp.enabled) continue;
      for (const gi of grp.gems) {
        if (!gi.enabled) continue;
        const d = getGemById(build.game, gi.gemId);
        if (d && d.name.en.trim().toLowerCase() === 'righteous fire') {
          rfBuffLevel = Math.max(rfBuffLevel, gi.level);
        }
      }
    }
  }
  if (rfBuffLevel > 0 && !isAttack && !isMinion) {
    skillDb.addMod({
      name: 'Damage',
      type: 'MORE',
      value: 20 + (rfBuffLevel - 1),
      flags: ModFlag.Spell,
      keywordFlags: 0,
      source: `Righteous Fire (Lv.${rfBuffLevel})`,
    });
  }

  const hasEphemeralEdge = Boolean(
    activeWeapons.main && activeWeapons.main.name.trim().toLowerCase() === 'ephemeral edge',
  );
  const specialSkillDmg = computeSkillSpecialDamage(activeDef.name.en, build.game, {
    gemLevel: activeLevel,
    enemyLevel: build.config.enemyLevel,
    maxLife: _defence.life,
    maxEs: _defence.energyShield,
    ephemeralEdge: isAttack && hasEphemeralEdge,
    powerCharges: activePowerCharges,
    isChannelling: activeDef.tags.some((t) => t.toLowerCase() === 'channelling'),
  });
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

  // PoE 1 Archmage flat Lightning Damage from unreserved Mana (if not already added by gem stats)
  if (build.game === 'poe1' && archmageLevel > 0 && !isAttack && !isMinion) {
    const am = computeArchmageBonus('poe1', _defence.manaUnreserved, archmageLevel);
    if (am.flatLightningMax > 0) {
      baseMin.Lightning += am.flatLightningMin * effectiveness;
      baseMax.Lightning += am.flatLightningMax * effectiveness;
    }
  }

  // Add flat damage modifiers scaled by effectiveness
  for (const dt of DAMAGE_TYPES) {
    const addMin = skillDb.sum('BASE', `${dt}Min`, flags, kwFlags);
    const addMax = skillDb.sum('BASE', `${dt}Max`, flags, kwFlags);
    baseMin[dt] += addMin * effectiveness;
    baseMax[dt] += addMax * effectiveness;
  }

  // Step B: Full PoE Conversion & Gain-as-Extra Pipeline (Physical -> Lightning -> Cold -> Fire -> Chaos)
  // PoE 1 tracks full conversion-history bitmask so converted damage inherits all intermediate type modifiers;
  // PoE 2 scales converted damage only by its final damage type.
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
    const convPcts = targets.map((t) => Math.max(0, skillDb.sum('BASE', `${convModPrefix}${t}`, flags, kwFlags)));
    const convSum = convPcts.reduce((a, b) => a + b, 0);
    const convScale = convSum > 100 ? 100 / convSum : 1;
    const gainPcts = gainModPrefix
      ? targets.map((t) => Math.max(0, skillDb.sum('BASE', `${gainModPrefix}${t}`, flags, kwFlags)))
      : targets.map(() => 0);
    const gainSum = gainPcts.reduce((a, b) => a + b, 0);
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
        const totalFrac = cFrac + gFrac;
        if (totalFrac > 0) {
          const nextMask = build.game === 'poe1' ? mask | DMG_BIT[target] : DMG_BIT[target];
          addPacket(target, nextMask, mn * totalFrac, mx * totalFrac);
        }
      });
    }
  };

  applyConversionStage('Physical', ['Lightning', 'Cold', 'Fire', 'Chaos'], 'PhysicalDamageConvertTo', 'PhysicalDamageGainAs');
  applyConversionStage('Lightning', ['Cold', 'Fire', 'Chaos'], 'LightningDamageConvertTo');
  applyConversionStage('Cold', ['Fire', 'Chaos'], 'ColdDamageConvertTo');
  applyConversionStage('Fire', ['Chaos'], 'FireDamageConvertTo');

  const eleExtraChaos = skillDb.sum('BASE', 'ElementalDamageGainAsChaos', flags, kwFlags);
  if (eleExtraChaos > 0) {
    const frac = eleExtraChaos / 100;
    for (const el of ['Lightning', 'Cold', 'Fire'] as const) {
      for (const [mask, [mn, mx]] of packets[el].entries()) {
        const nextMask = build.game === 'poe1' ? mask | DMG_BIT.Chaos : DMG_BIT.Chaos;
        addPacket('Chaos', nextMask, mn * frac, mx * frac);
      }
    }
  }

  // Generic "Gain X% of Damage as Extra Fire/Cold/Lightning/Chaos Damage" (PoE 2 weapons/runes/rings & PoE 1 effects)
  const genericExtraPcts = {
    Fire: skillDb.sum('BASE', 'DamageGainAsFire', flags, kwFlags),
    Cold: skillDb.sum('BASE', 'DamageGainAsCold', flags, kwFlags),
    Lightning: skillDb.sum('BASE', 'DamageGainAsLightning', flags, kwFlags),
    Chaos: skillDb.sum('BASE', 'DamageGainAsChaos', flags, kwFlags),
  };
  if (
    genericExtraPcts.Fire > 0 ||
    genericExtraPcts.Cold > 0 ||
    genericExtraPcts.Lightning > 0 ||
    genericExtraPcts.Chaos > 0
  ) {
    let totalPreMin = 0;
    let totalPreMax = 0;
    for (const dt of DAMAGE_TYPES) {
      for (const [mn, mx] of packets[dt].values()) {
        totalPreMin += mn;
        totalPreMax += mx;
      }
    }
    for (const target of ['Fire', 'Cold', 'Lightning', 'Chaos'] as const) {
      const pct = genericExtraPcts[target];
      if (pct > 0) {
        const extraFrac = pct / 100;
        addPacket(target, DMG_BIT[target], totalPreMin * extraFrac, totalPreMax * extraFrac);
      }
    }
  }

  // PoE 2 Archmage: Gain X% of ALL Damage as Extra Fire/Cold/Lightning/Chaos per 100 Maximum Mana (Non-Channelling Spells)
  const isChannellingSkill = activeDef.tags.some((t) => t.toLowerCase() === 'channelling');
  if (!isAttack && !isMinion && !isChannellingSkill && _defence.mana >= 100) {
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
        addPacket(target, DMG_BIT[target], totalPreMin * extraFrac, totalPreMax * extraFrac);
      }
    }
    if (!appliedPerMana100 && build.game === 'poe2' && archmageLevel > 0) {
      const am2 = computeArchmageBonus('poe2', _defence.mana, archmageLevel);
      if (am2.gainAsExtraLightningPct > 0) {
        const extraFrac = am2.gainAsExtraLightningPct / 100;
        addPacket('Lightning', DMG_BIT.Lightning, totalPreMin * extraFrac, totalPreMax * extraFrac);
      }
    }
  }

  const finalBaseMin: Record<DamageType, number> = { Physical: 0, Lightning: 0, Cold: 0, Fire: 0, Chaos: 0 };
  const finalBaseMax: Record<DamageType, number> = { Physical: 0, Lightning: 0, Cold: 0, Fire: 0, Chaos: 0 };
  for (const dt of DAMAGE_TYPES) {
    for (const [mn, mx] of packets[dt].values()) {
      finalBaseMin[dt] += mn;
      finalBaseMax[dt] += mx;
    }
  }

  // Step C: Apply Increased & More multipliers + Enemy Resistances / Curses / Penetration + Shock/DamageTaken
  // Official PoB uses enemyFire/Cold/Lightning/ChaosResist directly (Pinnacle default = 50% Ele / 30% Chaos).
  const enemyBossResistBonus = 0;

  const shockVal = build.config.enemyShocked ? Math.max(0, Math.min(100, build.config.shockValue)) : 0;
  const enemyGlobalDmgTaken = skillDb.sum('INC', 'EnemyDamageTaken', flags, kwFlags);
  const enemyPhysDmgTaken = skillDb.sum('INC', 'EnemyPhysicalDamageTaken', flags, kwFlags);
  const enemyChaosDmgTaken = skillDb.sum('INC', 'EnemyChaosDamageTaken', flags, kwFlags);
  const curseFireRes = skillDb.sum('BASE', 'EnemyFireResist', flags, kwFlags);
  const curseColdRes = skillDb.sum('BASE', 'EnemyColdResist', flags, kwFlags);
  const curseLightRes = skillDb.sum('BASE', 'EnemyLightningResist', flags, kwFlags);
  const curseChaosRes = skillDb.sum('BASE', 'EnemyChaosResist', flags, kwFlags);

  const ruleset = getRuleset(build.game);
  const doubleDamagePct = Math.min(100, Math.max(0, skillDb.sum('BASE', 'DoubleDamageChance', flags, kwFlags)));
  const doubleDamageMult = 1 + doubleDamagePct / 100;

  // Step D: Accuracy / Hit Chance first (exact PoE 1 & PoE 2 PoB formulas)
  let hitChance = 100;
  if (isAttack && !skillDb.flag('HitsCantBeEvaded', flags, kwFlags)) {
    const accuracy = Math.max(1, skillDb.calcStat('Accuracy', flags, kwFlags).total);
    const enemyEva = Math.max(1, build.config.enemyEvasion);
    const rawHitChance =
      build.game === 'poe2'
        ? ((accuracy * 1.25) / (accuracy + enemyEva * 0.3)) * 100
        : (accuracy / (accuracy + Math.pow(enemyEva / 5, 0.9))) * 125;
    hitChance = Math.min(100, Math.max(5, Math.round(rawHitChance)));
  }

  // Step E: Crit Chance & Crit Multiplier (PoE 1 additive CritMulti vs PoE 2 scaled CritDamageBonus + Lucky/Bifurcated)
  const neverCrit = skillDb.flag('NeverCrit', flags, kwFlags);
  const noCritExtra =
    skillDb.flag('NoCritExtraDamage', flags, kwFlags) || skillDb.flag('NoExtraDamageFromCrits', flags, kwFlags);
  const enemyCritBonus = skillDb.sum('BASE', 'EnemyCritChance', flags, kwFlags);
  const flatBaseCrit = isMinion ? 0 : skillDb.sum('BASE', 'BaseCritChance', flags, kwFlags);
  const enemyCritMulti = skillDb.sum('BASE', 'EnemyCritMultiplier', flags, kwFlags);
  const weaponCritOverride = skillDb.override('WeaponBaseCritChance', flags, kwFlags);
  const spellCritOverride =
    skillDb.override('SpellBaseCritOverride', flags, kwFlags) ??
    (skillDb.sum('BASE', 'SpellBaseCritOverride', flags, kwFlags) || null);
  const rawWeaponBaseCrit =
    isDualWield && mainWeaponStats && offWeaponStats
      ? (mainWeaponStats.critChance + offWeaponStats.critChance) / 2
      : (weaponStats?.critChance ?? 5);
  const weaponBaseCrit = weaponCritOverride !== null ? weaponCritOverride : rawWeaponBaseCrit;
  const resolvedSkillBaseCrit = !isAttack && !isMinion && spellCritOverride !== null
    ? spellCritOverride
    : isAttack
      ? weaponBaseCrit
      : (activeDef.baseCritChance ?? 6);
  const baseCrit = isMinion
    ? (activeDef.minionBase?.critChance ?? 5) + enemyCritBonus
    : resolvedSkillBaseCrit + enemyCritBonus + flatBaseCrit;
  const critInc = isMinion ? 0 : skillDb.sum('INC', 'CritChance', flags, kwFlags);
  const critMore = isMinion ? 1 : skillDb.more('CritChance', flags, kwFlags);
  const hasGarukhansResolve = linkedSupportNames.has("garukhan's resolve");

  let critChance: number;
  let critMultiplier: number;
  let effectiveCritMultiplier: number;

  if (build.game === 'poe2' && !isMinion) {
    const flatCritBonus = skillDb.sum('BASE', 'CritDamageBonusFlat', flags, kwFlags);
    const incCritBonus =
      Math.max(0, skillDb.sum('BASE', 'CritMultiplier', flags, kwFlags) - ruleset.baseCritMultiplier) +
      skillDb.sum('INC', 'CritDamageBonusInc', flags, kwFlags) +
      skillDb.sum('INC', 'CritMultiplier', flags, kwFlags);
    const paLowLifeMore =
      build.config.conditionLowLife ? skillDb.sum('BASE', 'CritDamageBonusLowLifeMore', flags, kwFlags) : 0;
    const paFullLifeMore =
      !build.config.conditionLowLife ? skillDb.sum('BASE', 'CritDamageBonusFullLifeMore', flags, kwFlags) : 0;
    const moreCritBonusMult =
      skillDb.more('CritDamageBonusInc', flags, kwFlags) *
      (1 + paLowLifeMore / 100) *
      (1 + paFullLifeMore / 100);
    const poe2Crit = computePoe2CritMultiplier({
      baseCritChance: baseCrit,
      incCritChancePct: critInc,
      moreCritChanceMult: critMore,
      flatBonusPct: flatCritBonus,
      incBonusPct: incCritBonus,
      moreBonusMult: moreCritBonusMult,
      enemyExtraCritFlatPct: enemyCritMulti,
      luckyCrit: hasGarukhansResolve || skillDb.flag('CritChanceIsLucky', flags, kwFlags),
      bifurcatedCrit: hasGarukhansResolve,
      neverCrit,
      noCritMultiplier: noCritExtra,
    });
    critChance = Math.round(poe2Crit.effectiveCritChance * (isAttack ? hitChance / 100 : 1) * 100) / 100;
    critMultiplier = neverCrit ? 0 : Math.round(poe2Crit.critMultiplierPct);
    effectiveCritMultiplier =
      neverCrit || noCritExtra ? 1 : 1 + (critChance / 100) * Math.max(0, poe2Crit.critMultiplierPct / 100 - 1);
  } else {
    const preEffectiveCrit = neverCrit ? 0 : Math.min(100, baseCrit * (1 + critInc / 100) * critMore);
    critChance = Math.round(preEffectiveCrit * (isAttack ? hitChance / 100 : 1) * 100) / 100;
    critMultiplier = neverCrit
      ? 0
      : noCritExtra
        ? 100
        : isMinion
          ? Math.round((activeDef.minionBase?.critMultiplier ?? 130) + enemyCritMulti)
          : Math.round(skillDb.sum('BASE', 'CritMultiplier', flags, kwFlags) + enemyCritMulti);
    effectiveCritMultiplier =
      neverCrit || noCritExtra ? 1 : 1 + (critChance / 100) * Math.max(0, critMultiplier / 100 - 1);
  }

  const damageByType: Record<DamageType, DamageRange> = { ...emptyRanges };
  const dealNoEle = skillDb.flag('DealNoElemental', flags, kwFlags);
  const dealNoChaos = skillDb.flag('DealNoChaos', flags, kwFlags);
  const dealNoNonFire = skillDb.flag('DealNoNonFire', flags, kwFlags);
  let totalAvgHit = 0;

  for (const dt of DAMAGE_TYPES) {
    const isEle = dt === 'Fire' || dt === 'Cold' || dt === 'Lightning';
    if ((isEle && dealNoEle) || (dt === 'Chaos' && dealNoChaos) || (dealNoNonFire && dt !== 'Fire')) {
      damageByType[dt] = { min: 0, max: 0, average: 0 };
      continue;
    }
    let rawMin = 0;
    let rawMax = 0;
    for (const [mask, [pMin, pMax]] of packets[dt].entries()) {
      const statNames: string[] = isMinion ? ['MinionDamage'] : ['Damage'];
      if (!isMinion) {
        if ((mask & ELE_MASK) !== 0) statNames.push('ElementalDamage');
        for (const srcType of DAMAGE_TYPES) {
          if ((mask & DMG_BIT[srcType]) !== 0) {
            statNames.push(`${srcType}Damage`);
          }
        }
      }
      const inc = skillDb.sum('INC', statNames, flags, kwFlags);
      const more = skillDb.more(statNames, flags, kwFlags);
      const mult = (1 + inc / 100) * more;
      rawMin += pMin * mult;
      rawMax += pMax * mult;
    }
    const rawAvg = (rawMin + rawMax) / 2;

    // Enemy mitigation (Resistances + Curses + Penetration; separate Non-Crit & Crit Enemy Armour PDR)
    let enemyFactor = 1;
    let typeDmgTaken = shockVal + enemyGlobalDmgTaken;
    if (dt === 'Physical') {
      typeDmgTaken += enemyPhysDmgTaken;
      const eArm = Math.max(0, build.config.enemyArmour);
      if (eArm > 0 && rawAvg > 0) {
        const pdrCap = 0.75;
        const pdrNonCrit = Math.min(pdrCap, eArm / (eArm + ruleset.armourFormulaFactor * rawAvg * doubleDamageMult));
        const critFactor = neverCrit || noCritExtra ? 1 : Math.max(1, critMultiplier / 100);
        const critFrac = neverCrit || noCritExtra ? 0 : critChance / 100;
        if (critFrac > 0 && critFactor > 1) {
          const pdrCrit = Math.min(
            pdrCap,
            eArm / (eArm + ruleset.armourFormulaFactor * rawAvg * doubleDamageMult * critFactor),
          );
          const weightedPhys = (1 - critFrac) * (1 - pdrNonCrit) + critFrac * critFactor * (1 - pdrCrit);
          enemyFactor = weightedPhys / effectiveCritMultiplier;
        } else {
          enemyFactor = 1 - pdrNonCrit;
        }
      }
    } else if (dt === 'Fire' || dt === 'Cold' || dt === 'Lightning') {
      const hasRakiata = linkedSupportNames.has("rakiata's flow") || linkedSupportNames.has('rakiatas flow');
      const allEnemyEle = {
        Fire: build.config.enemyFireResist + enemyBossResistBonus + curseFireRes,
        Cold: build.config.enemyColdResist + enemyBossResistBonus + curseColdRes,
        Lightning: build.config.enemyLightningResist + enemyBossResistBonus + curseLightRes,
      };
      const baseEnemyRes = allEnemyEle[dt];
      const pen =
        skillDb.sum('BASE', `${dt}Penetration`, flags, kwFlags) +
        skillDb.sum('BASE', 'ElementalPenetration', flags, kwFlags);
      const critIgnoresEleRes = skillDb.flag('CritIgnoresEleRes', flags, kwFlags);
      const nonCritElePen = skillDb.sum('BASE', 'NonCritElePen', flags, kwFlags);
      if (hasRakiata || uniqueGearResult?.enemyResistLowestElement) {
        const resEval = computeEffectiveEnemyResistance(baseEnemyRes, {
          element: dt,
          allElementalResists: allEnemyEle,
          penetrationPct: pen,
          invertEnemyEleRes: hasRakiata,
          useLowestEleRes: Boolean(uniqueGearResult?.enemyResistLowestElement),
          ignoreOnCrit: critIgnoresEleRes,
          critChancePct: neverCrit || noCritExtra ? 0 : critChance,
        });
        enemyFactor = resEval.damageMult;
      } else {
        const nonCritRes = Math.min(75, baseEnemyRes) - pen - nonCritElePen;
        const critRes = critIgnoresEleRes ? 0 : Math.min(75, baseEnemyRes) - pen;
        if (critIgnoresEleRes || nonCritElePen !== 0) {
          const critFactor = neverCrit || noCritExtra ? 1 : Math.max(1, critMultiplier / 100);
          const critFrac = neverCrit || noCritExtra ? 0 : critChance / 100;
          const nonCritMult = Math.max(0.05, 1 - nonCritRes / 100);
          const critMult = Math.max(0.05, 1 - critRes / 100);
          enemyFactor = ((1 - critFrac) * nonCritMult + critFrac * critFactor * critMult) / effectiveCritMultiplier;
        } else {
          enemyFactor = 1 - nonCritRes / 100;
        }
      }
    } else if (dt === 'Chaos') {
      typeDmgTaken += enemyChaosDmgTaken;
      const chaosPen = skillDb.sum('BASE', 'ChaosPenetration', flags, kwFlags);
      const effRes = Math.min(75, build.config.enemyChaosResist + enemyBossResistBonus / 2 + curseChaosRes) - chaosPen;
      enemyFactor = 1 - effRes / 100;
    }

    const finalMult = Math.max(0.05, enemyFactor) * (1 + typeDmgTaken / 100);
    const min = rawMin * finalMult;
    const max = rawMax * finalMult;
    const average = (min + max) / 2;
    damageByType[dt] = { min: Math.round(min), max: Math.round(max), average: Math.round(average * 100) / 100 };
    totalAvgHit += average;
  }

  // Step F: Attack / Cast Speed (with Dual-Wield harmonic APS, Minion Speed, Trap/Mine throw times, Cooldowns & CoC)
  const isTrapSkill =
    activeDef.tags.some((t) => t.toLowerCase() === 'trap') ||
    mainGroup.gems.some((gi) => {
      if (!gi.enabled) return false;
      const d = getGemById(build.game, gi.gemId);
      return Boolean(d && d.category === 'support' && d.tags.some((t) => t.toLowerCase() === 'trap'));
    });
  const isMineSkill =
    activeDef.tags.some((t) => t.toLowerCase() === 'mine') ||
    mainGroup.gems.some((gi) => {
      if (!gi.enabled) return false;
      const d = getGemById(build.game, gi.gemId);
      return Boolean(d && d.category === 'support' && d.tags.some((t) => t.toLowerCase() === 'mine'));
    });
  const weaponBaseAps =
    isDualWield && mainWeaponStats && offWeaponStats
      ? 2 / (1 / Math.max(0.1, mainWeaponStats.attacksPerSecond) + 1 / Math.max(0.1, offWeaponStats.attacksPerSecond))
      : (weaponStats?.attacksPerSecond ?? 1.2);
  const baseRate = isMinion && activeDef.minionBase
    ? activeDef.minionBase.attacksPerSecond * (1 + (activeDef.minionBase.moreAttackSpeedPct ?? 0) / 100)
    : isMineSkill
      ? 1 / 0.3
      : isTrapSkill
        ? 1 / 0.6
        : isAttack
          ? weaponBaseAps * (activeDef.attackSpeedMultiplier ?? 1)
          : 1 / (activeDef.castTime ?? 0.75);
  const speedInc =
    (isMinion
      ? skillDb.sum('INC', 'MinionSpeed', flags, kwFlags)
      : skillDb.sum('INC', 'Speed', flags, kwFlags)) + specialSkillDmg.hitRateIncPct;
  const isPoe2Flicker = build.game === 'poe2' && activeDef.name.en.trim().toLowerCase() === 'flicker strike';
  const speedMore =
    (isMinion
      ? skillDb.more('MinionSpeed', flags, kwFlags)
      : skillDb.more('Speed', flags, kwFlags)) * (isPoe2Flicker ? 1 : specialSkillDmg.hitRateMoreMult);
  let speedExact = baseRate * (1 + speedInc / 100) * speedMore;
  if (activeDef.cooldown && activeDef.cooldown > 0 && !specialSkillDmg.bypassCooldown) {
    const cdr = Math.max(0, skillDb.sum('INC', 'CooldownRecovery', flags, kwFlags));
    const cdRate = (1 + cdr / 100) / activeDef.cooldown;
    speedExact = Math.min(speedExact, cdRate);
  }
  let triggerRate: number | undefined;

  if (!isAttack && skillDb.flag('CastOnCrit') && triggerAttackDef) {
    const cdr = Math.max(0, skillDb.sum('INC', 'CooldownRecovery', flags, kwFlags));
    const serverTick = 0.033;
    const baseCd = 0.15;
    const effCd = Math.ceil(baseCd / (1 + cdr / 100) / serverTick - 1e-9) * serverTick;
    const maxTriggerRate = 1 / effCd;

    const atkFlags = triggerAttackDef.modFlags;
    const atkKw = triggerAttackDef.keywordFlags;
    const atkBaseAps = weaponBaseAps * (triggerAttackDef.attackSpeedMultiplier ?? 1);
    const atkAps =
      atkBaseAps *
      (1 + skillDb.sum('INC', 'Speed', atkFlags, atkKw) / 100) *
      skillDb.more('Speed', atkFlags, atkKw);

    let atkHitChance = 100;
    if (!skillDb.flag('HitsCantBeEvaded', atkFlags, atkKw)) {
      const acc = Math.max(1, skillDb.calcStat('Accuracy', atkFlags, atkKw).total);
      const eEva = Math.max(1, build.config.enemyEvasion);
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
            (1 + skillDb.sum('INC', 'CritChance', atkFlags, atkKw) / 100) *
            skillDb.more('CritChance', atkFlags, atkKw),
        );
    const atkEffCrit = atkPreCrit * (atkHitChance / 100);
    const atkTime = 1 / Math.max(0.01, atkAps);
    const minAttacksPerTrigger = Math.max(1, Math.ceil((effCd - 1e-9) / atkTime));
    const syncAps = atkAps / minAttacksPerTrigger;
    const effRate = Math.min(maxTriggerRate, syncAps * (atkHitChance / 100) * (atkEffCrit / 100));
    speedExact = effRate;
    triggerRate = Math.round(effRate * 100) / 100;
  }
  const speed = Math.round(speedExact * 100) / 100;

  const dpsMult = activeDef.dpsMultiplier ?? 1;
  const avgHitWithCrit = specialSkillDmg.canHit
    ? Math.round(totalAvgHit * effectiveCritMultiplier * doubleDamageMult * 100) / 100
    : 0;
  const hitDps = specialSkillDmg.canHit
    ? Math.round(avgHitWithCrit * speedExact * dpsMult * (hitChance / 100) * 100) / 100
    : 0;

  // Impale DPS (Physical Attacks: 10% stored phys * (1 + impaleEffect) * maxHits * impaleChance)
  const impaleChance = isAttack ? Math.min(100, Math.max(0, skillDb.sum('BASE', 'ImpaleChance', flags, kwFlags))) : 0;
  let impaleDps = 0;
  if (isAttack && impaleChance > 0 && damageByType.Physical.average > 0) {
    const impaleEffect = skillDb.sum('INC', 'ImpaleEffect', flags, kwFlags);
    const maxImpaleHits = 5 + skillDb.sum('BASE', 'ImpaleStacksMax', flags, kwFlags);
    const physHitDps =
      damageByType.Physical.average *
      effectiveCritMultiplier *
      doubleDamageMult *
      speedExact *
      dpsMult *
      (hitChance / 100);
    impaleDps =
      Math.round(physHitDps * 0.1 * (1 + impaleEffect / 100) * maxImpaleHits * (impaleChance / 100) * 100) / 100;
  }

  // Ailment DPS (Ignite / Bleed / Poison) using authentic ailment base damage (no Hit/Spell/Pen/Armour scaling)
  const ailmentFlags = (flags & ~(ModFlag.Hit | ModFlag.Spell)) | ModFlag.Ailment | ModFlag.Dot;
  const dotMulti = skillDb.sum('BASE', 'DotMultiplier', ailmentFlags, kwFlags);
  const dotInc = skillDb.sum('INC', 'DotDamage', ailmentFlags, kwFlags);
  const dotMore = skillDb.more('DotDamage', ailmentFlags, kwFlags);

  const cannotIgnite = skillDb.flag('CannotIgnite', flags, kwFlags);
  const igniteChance = cannotIgnite ? 0 : Math.min(100, skillDb.sum('BASE', 'IgniteChance', flags, kwFlags));
  const rawFireBaseAvg = (finalBaseMin.Fire + finalBaseMax.Fire) / 2;
  const hasIgnite =
    !cannotIgnite &&
    !dealNoEle &&
    rawFireBaseAvg > 0 &&
    ((kwFlags & KeywordFlag.Ignite) !== 0 || igniteChance > 0 || critChance > 0);
  let igniteDps = 0;
  if (hasIgnite) {
    const fireDotMulti = dotMulti + skillDb.sum('BASE', 'FireDotMultiplier', ailmentFlags, kwFlags);
    const igniteStatNames = isMinion
      ? ['MinionDamage', 'DotDamage', 'IgniteDamage']
      : ['Damage', 'ElementalDamage', 'FireDamage', 'DotDamage', 'IgniteDamage'];
    const igniteInc = skillDb.sum('INC', igniteStatNames, ailmentFlags, kwFlags);
    const igniteMore = skillDb.more(igniteStatNames, ailmentFlags, kwFlags);
    const enemyFireResNoPen = Math.min(75, build.config.enemyFireResist + enemyBossResistBonus + curseFireRes);
    const fireDotEnemyMult = Math.max(0.05, 1 - enemyFireResNoPen / 100) * (1 + (shockVal + enemyGlobalDmgTaken) / 100);
    const baseIgnite = rawFireBaseAvg * 0.9 * (1 + igniteInc / 100) * igniteMore * fireDotEnemyMult;
    const noCritAilments = skillDb.flag('NoCritAilments', flags, kwFlags);
    const nonCritIgnite = baseIgnite * (1 + fireDotMulti / 100);
    const critIgnite = noCritAilments ? nonCritIgnite : baseIgnite * (1 + (fireDotMulti + 50) / 100);
    const baseChanceFrac = Math.min(1, ((kwFlags & KeywordFlag.Ignite) !== 0 ? Math.max(25, igniteChance) : igniteChance) / 100);
    const critFrac = critChance / 100;
    const effIgniteChance = critFrac + (1 - critFrac) * baseChanceFrac;
    const critShare = effIgniteChance > 0 ? Math.min(1, (critFrac / effIgniteChance) * 1.9) : 0;
    const igniteUptime =
      baseChanceFrac > 0 ? 1 : Math.min(1, 1 - Math.pow(1 - effIgniteChance, Math.max(1, speedExact * 4)));
    igniteDps = Math.round((nonCritIgnite * (1 - critShare) + critIgnite * critShare) * igniteUptime * 100) / 100;
  }

  const bleedChance = Math.min(100, skillDb.sum('BASE', 'BleedChance', flags, kwFlags));
  const rawPhysBaseAvg = (finalBaseMin.Physical + finalBaseMax.Physical) / 2;
  let bleedDps = 0;
  if ((isAttack || build.game === 'poe2') && !dealNoNonFire && rawPhysBaseAvg > 0 && bleedChance > 0) {
    const physDotMulti = dotMulti + skillDb.sum('BASE', 'PhysicalDotMultiplier', ailmentFlags, kwFlags);
    const bleedStatNames = ['Damage', 'PhysicalDamage', 'DotDamage'];
    const bleedInc = skillDb.sum('INC', bleedStatNames, ailmentFlags, kwFlags);
    const bleedMore = skillDb.more(bleedStatNames, ailmentFlags, kwFlags);
    const physDotEnemyMult = 1 + (shockVal + enemyGlobalDmgTaken + enemyPhysDmgTaken) / 100;
    const rawBleed =
      rawPhysBaseAvg *
      (build.game === 'poe2' ? 0.15 : 0.7) *
      (build.game === 'poe2' ? effectiveCritMultiplier : 1) *
      (1 + bleedInc / 100) *
      bleedMore *
      (1 + physDotMulti / 100) *
      physDotEnemyMult;
    const scaledBleed = computeAilmentScaling(rawBleed, {
      fasterPct: skillDb.sum('INC', 'AilmentFaster', ailmentFlags, kwFlags),
      magnitudeIncPct:
        skillDb.sum('INC', 'AilmentMagnitude', ailmentFlags, kwFlags) +
        skillDb.sum('INC', 'BleedingMagnitude', ailmentFlags, kwFlags),
      magnitudeMoreMult:
        skillDb.more('AilmentMagnitude', ailmentFlags, kwFlags) *
        skillDb.more('BleedingMagnitude', ailmentFlags, kwFlags) *
        specialSkillDmg.ailmentMoreMult,
    });
    bleedDps = Math.round(scaledBleed.scaledDps * 100) / 100;
  }

  // Non-ailment Spell DoT DPS (Righteous Fire, Exsanguinate, Reap, Corrupting Fever, Essence Drain, Blight, Vortex, Cold Snap)
  let spellDotDps = 0;
  for (const dt of DAMAGE_TYPES) {
    const baseDot = specialSkillDmg.baseDotDps[dt];
    if (!baseDot || baseDot <= 0) continue;
    const dotStatNames = ['Damage', 'DotDamage', `${dt}Damage`];
    if (dt === 'Fire' || dt === 'Cold' || dt === 'Lightning') dotStatNames.push('ElementalDamage');
    const dotFlags = (specialSkillDmg.spellDmgAppliesToDot ? ModFlag.Spell : 0) | ModFlag.Dot;
    const inc = skillDb.sum('INC', dotStatNames, dotFlags, kwFlags);
    const more = skillDb.more(dotStatNames, dotFlags, kwFlags) * specialSkillDmg.dotMoreMult;
    const specDotMulti =
      dotMulti +
      (dt === 'Fire'
        ? skillDb.sum('BASE', 'FireDotMultiplier', dotFlags, kwFlags)
        : dt === 'Cold'
          ? skillDb.sum('BASE', 'ColdDotMultiplier', dotFlags, kwFlags)
          : dt === 'Physical'
            ? skillDb.sum('BASE', 'PhysicalDotMultiplier', dotFlags, kwFlags)
            : dt === 'Chaos'
              ? skillDb.sum('BASE', 'ChaosDotMultiplier', dotFlags, kwFlags)
              : 0);
    const baseEnemyRes =
      dt === 'Fire'
        ? build.config.enemyFireResist + curseFireRes
        : dt === 'Cold'
          ? build.config.enemyColdResist + curseColdRes
          : dt === 'Lightning'
            ? build.config.enemyLightningResist + curseLightRes
            : dt === 'Chaos'
              ? build.config.enemyChaosResist + curseChaosRes
              : 0;
    const enemyResMult = dt === 'Physical' ? 1 : Math.max(0.05, 1 - Math.min(75, baseEnemyRes) / 100);
    spellDotDps +=
      baseDot *
      (1 + inc / 100) *
      more *
      (1 + specDotMulti / 100) *
      enemyResMult *
      (1 + (shockVal + enemyGlobalDmgTaken) / 100);
  }
  spellDotDps = Math.round(spellDotDps * 100) / 100;

  const poisonChance = Math.min(100, skillDb.sum('BASE', 'PoisonChance', flags, kwFlags));
  const rawChaosBaseAvg = dealNoChaos || dealNoNonFire ? 0 : (finalBaseMin.Chaos + finalBaseMax.Chaos) / 2;
  const rawPhysForPoison = dealNoNonFire ? 0 : rawPhysBaseAvg;
  let poisonDps = 0;
  if (poisonChance > 0 && rawPhysForPoison + rawChaosBaseAvg > 0) {
    const chaosDotMulti = dotMulti + skillDb.sum('BASE', 'ChaosDotMultiplier', ailmentFlags, kwFlags);
    const chaosPoisonInc = skillDb.sum('INC', ['Damage', 'ChaosDamage', 'DotDamage'], ailmentFlags, kwFlags);
    const chaosPoisonMore = skillDb.more(['Damage', 'ChaosDamage', 'DotDamage'], ailmentFlags, kwFlags);
    const physPoisonInc =
      build.game === 'poe1'
        ? skillDb.sum('INC', ['Damage', 'PhysicalDamage', 'ChaosDamage', 'DotDamage'], ailmentFlags, kwFlags)
        : chaosPoisonInc;
    const physPoisonMore =
      build.game === 'poe1'
        ? skillDb.more(['Damage', 'PhysicalDamage', 'ChaosDamage', 'DotDamage'], ailmentFlags, kwFlags)
        : chaosPoisonMore;
    const enemyChaosRes = Math.min(75, build.config.enemyChaosResist + enemyBossResistBonus / 2 + curseChaosRes);
    const chaosDotEnemyMult =
      Math.max(0.05, 1 - enemyChaosRes / 100) * (1 + (shockVal + enemyGlobalDmgTaken + enemyChaosDmgTaken) / 100);
    const basePoisonRaw =
      (rawChaosBaseAvg * (1 + chaosPoisonInc / 100) * chaosPoisonMore +
        rawPhysForPoison * (1 + physPoisonInc / 100) * physPoisonMore) *
      0.3;
    const singlePoison = basePoisonRaw * (1 + chaosDotMulti / 100) * chaosDotEnemyMult;
    const activeStacks = speedExact * (hitChance / 100) * (poisonChance / 100) * 2.0; // 2s base duration
    poisonDps = Math.round(singlePoison * activeStacks * 100) / 100;
  }
  void dotInc;
  void dotMore;

  const totalDps = Math.round((hitDps + impaleDps + igniteDps + bleedDps + poisonDps + spellDotDps) * 100) / 100;
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
  const tree = getTreeForGame(build.game);
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
