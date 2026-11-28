import { deflate, inflate } from 'pako';
import {
  KeywordFlag,
  ModFlag,
  type Build,
  type EquipmentSlotId,
  type GameId,
  type GemInstance,
  type Item,
  type ItemSetSpec,
  type Mod,
  type ModTag,
  type ModType,
  type SkillGroup,
  type SkillSetSpec,
  type TreeSpec,
  type WeaponSetId,
} from '@webpob/core';
import {
  createDefaultConfig,
  getClassesForGame,
  getGemsForGame,
  getRuleset,
  getTreeForGame,
  resolveGemFromPobRef,
} from '@webpob/data';
import { formatItemToPobText, parseItemText, type ParseItemOptions } from './itemParser.js';
import {
  escapeXml,
  extractActiveConfigSetXml,
  extractCustomModifierBlocks,
  parseAttributes,
  parseMasteryEffectsAttr,
  parseNodeOverrides,
  parseSkillWeaponSets,
  serializeMasteryEffectsAttr,
  serializeNodeOverrides,
  unescapeXml,
} from './pobXmlHelpers.js';

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input
    .trim()
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);

  if (typeof atob === 'function') {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

const POE1_CLASS_TO_NUM: Record<string, number> = {
  Scion: 0,
  Marauder: 1,
  Ranger: 2,
  Witch: 3,
  Duelist: 4,
  Templar: 5,
  Shadow: 6,
};

// Official PoB 2 0.5 tree.lua class indices (`classes[1..8]`) & internal integer IDs (`integerId`)
const POE2_CLASS_META: Record<string, { treeClassId: number; internalId: number }> = {
  Ranger: { treeClassId: 1, internalId: 2 },
  Huntress: { treeClassId: 2, internalId: 8 },
  Warrior: { treeClassId: 3, internalId: 6 },
  Mercenary: { treeClassId: 4, internalId: 9 },
  Druid: { treeClassId: 5, internalId: 11 },
  Witch: { treeClassId: 6, internalId: 1 },
  Sorceress: { treeClassId: 7, internalId: 7 },
  Monk: { treeClassId: 8, internalId: 10 },
};

// Official PoB 2 0.5 tree.lua ascendancy indices (`ascendancies[1..4]`) & internal IDs (`internalId`)
const POE2_ASCENDANCY_META: Record<string, { ascendClassId: number; internalId: string }> = {
  Deadeye: { ascendClassId: 1, internalId: 'Ranger1' },
  Pathfinder: { ascendClassId: 2, internalId: 'Ranger3' },
  Amazon: { ascendClassId: 1, internalId: 'Huntress1' },
  'Spirit Walker': { ascendClassId: 2, internalId: 'Huntress2' },
  Ritualist: { ascendClassId: 3, internalId: 'Huntress3' },
  Titan: { ascendClassId: 1, internalId: 'Warrior1' },
  Warbringer: { ascendClassId: 2, internalId: 'Warrior2' },
  'Smith of Kitava': { ascendClassId: 3, internalId: 'Warrior3' },
  Tactician: { ascendClassId: 1, internalId: 'Mercenary1' },
  Witchhunter: { ascendClassId: 2, internalId: 'Mercenary2' },
  'Gemling Legionnaire': { ascendClassId: 3, internalId: 'Mercenary3' },
  Oracle: { ascendClassId: 1, internalId: 'Druid1' },
  Shaman: { ascendClassId: 2, internalId: 'Druid2' },
  Infernalist: { ascendClassId: 1, internalId: 'Witch1' },
  'Blood Mage': { ascendClassId: 2, internalId: 'Witch2' },
  Lich: { ascendClassId: 3, internalId: 'Witch3' },
  'Abyssal Lich': { ascendClassId: 4, internalId: 'Witch3b' },
  Stormweaver: { ascendClassId: 1, internalId: 'Sorceress1' },
  Chronomancer: { ascendClassId: 2, internalId: 'Sorceress2' },
  'Disciple of Varashta': { ascendClassId: 3, internalId: 'Sorceress3' },
  'Martial Artist': { ascendClassId: 1, internalId: 'Monk1' },
  Invoker: { ascendClassId: 2, internalId: 'Monk2' },
  'Acolyte of Chayula': { ascendClassId: 3, internalId: 'Monk3' },
};

/**
 * Serializes a WebPoB `Build` into official Path of Building XML format
 * (`<PathOfBuilding>` for PoE 1, `<PathOfBuilding2>` for PoE 2).
 */
export function buildToPobXml(build: Build): string {
  const rootTag = build.game === 'poe2' ? 'PathOfBuilding2' : 'PathOfBuilding';
  const mainIdx = Math.max(
    1,
    build.skills.findIndex((s) => s.id === build.mainSkillGroupId) + 1,
  );
  const poe2ClassMeta = build.game === 'poe2' ? POE2_CLASS_META[build.classId] : undefined;
  const poe2AscMeta =
    build.game === 'poe2' && build.ascendancyId
      ? POE2_ASCENDANCY_META[build.ascendancyId]
      : undefined;
  const classNum =
    build.game === 'poe2'
      ? (poe2ClassMeta?.treeClassId ?? 3)
      : (POE1_CLASS_TO_NUM[build.classId] ?? 3);
  const ascendClassNum = build.game === 'poe2' ? (poe2AscMeta?.ascendClassId ?? 0) : 0;
  const poe2InternalClassAttrs =
    build.game === 'poe2'
      ? `${poe2ClassMeta ? ` classInternalId="${poe2ClassMeta.internalId}"` : ''} ascendancyInternalId="${escapeXml(poe2AscMeta?.internalId ?? '')}"`
      : '';
  const gemsCatalog = getGemsForGame(build.game);
  const tree = getTreeForGame(build.game);
  const targetVersion = build.game === 'poe2' ? '0_1' : '3_0';

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<${rootTag}>`);

  // <Build>
  lines.push(
    `  <Build level="${build.level}" targetVersion="${targetVersion}" className="${escapeXml(build.classId)}" ascendClassName="${escapeXml(build.ascendancyId)}" ascendancyName="${escapeXml(build.ascendancyId)}" mainSocketGroup="${mainIdx}" activeWeaponSet="${build.activeWeaponSet}" bandit="${escapeXml(build.bandit ?? 'None')}" buildName="${escapeXml(build.name)}" />`,
  );

  // Pre-assign numeric item IDs so both <Tree><Spec><Sockets> and <Items> share exact IDs
  const itemEntries = Object.values(build.items);
  const idToNum = new Map<string, number>();
  itemEntries.forEach((item, index) => {
    idToNum.set(item.id, index + 1);
  });

  // <Tree> (supports multiple <Spec> plans with activeSpec index)
  const specsToWrite: TreeSpec[] =
    build.treeSpecs && build.treeSpecs.length > 0
      ? build.treeSpecs.map((s, i) => (i === (build.activeTreeSpecIndex ?? 0) ? build.tree : s))
      : [build.tree];
  const activeSpecAttr = Math.max(1, Math.min(specsToWrite.length, (build.activeTreeSpecIndex ?? 0) + 1));

  lines.push(`  <Tree activeSpec="${activeSpecAttr}">`);
  for (const spec of specsToWrite) {
    const allNodesSet = new Set<number>(spec.allocatedNodeIds);
    for (const cid of spec.clusterNodeIds ?? []) allNodesSet.add(cid);
    if (build.game === 'poe2') {
      for (const id of spec.weaponSet1NodeIds) allNodesSet.add(id);
      for (const id of spec.weaponSet2NodeIds) allNodesSet.add(id);
    }
    const nodesStr = [...allNodesSet].join(',');
    const ws1Str = spec.weaponSet1NodeIds.join(',');
    const ws2Str = spec.weaponSet2NodeIds.join(',');
    const wsAttrs =
      build.game === 'poe2' ? ` weaponSet1Nodes="${ws1Str}" weaponSet2Nodes="${ws2Str}"` : '';
    const masteryAttrStr = serializeMasteryEffectsAttr(spec.masteryEffects, tree);
    const masteryAttr = masteryAttrStr ? ` masteryEffects="${escapeXml(masteryAttrStr)}"` : '';
    const jewelSockets = Object.entries(spec.socketedJewels ?? {})
      .map(([nodeId, itemId]) => ({ nodeId, numId: idToNum.get(itemId) }))
      .filter((s): s is { nodeId: string; numId: number } => Boolean(s.numId));
    const hasWsChildren =
      build.game === 'poe2' && (spec.weaponSet1NodeIds.length > 0 || spec.weaponSet2NodeIds.length > 0);
    const attrOverrideEntries = Object.entries(spec.attributeOverrides ?? {});
    const strOverrides = attrOverrideEntries.filter(([, v]) => v === 'str').map(([k]) => k);
    const dexOverrides = attrOverrideEntries.filter(([, v]) => v === 'dex').map(([k]) => k);
    const intOverrides = attrOverrideEntries.filter(([, v]) => v === 'int').map(([k]) => k);
    const hasAttrOverrides =
      strOverrides.length > 0 || dexOverrides.length > 0 || intOverrides.length > 0;
    const nodeOverrideLines = serializeNodeOverrides(spec.nodeOverrides);
    const hasNodeOverrides = nodeOverrideLines.length > 0;
    const hasOverrides = hasAttrOverrides || hasNodeOverrides;

    if (jewelSockets.length > 0 || hasWsChildren || hasOverrides) {
      lines.push(
        `    <Spec title="${escapeXml(spec.title)}" treeVersion="${escapeXml(spec.treeVersion)}" classId="${classNum}" ascendClassId="${ascendClassNum}"${poe2InternalClassAttrs} nodes="${nodesStr}"${wsAttrs}${masteryAttr}>`,
      );
      if (build.game === 'poe2' && spec.weaponSet1NodeIds.length > 0) {
        lines.push(`      <WeaponSet1 nodes="${ws1Str}" />`);
      }
      if (build.game === 'poe2' && spec.weaponSet2NodeIds.length > 0) {
        lines.push(`      <WeaponSet2 nodes="${ws2Str}" />`);
      }
      if (jewelSockets.length > 0) {
        lines.push(`      <Sockets>`);
        for (const s of jewelSockets) {
          lines.push(`        <Socket nodeId="${s.nodeId}" itemId="${s.numId}" />`);
        }
        lines.push(`      </Sockets>`);
      }
      if (hasOverrides) {
        lines.push(`      <Overrides>`);
        if (hasAttrOverrides) {
          lines.push(
            `        <AttributeOverride strNodes="${strOverrides.join(',')}" dexNodes="${dexOverrides.join(',')}" intNodes="${intOverrides.join(',')}" />`,
          );
        }
        for (const overrideLine of nodeOverrideLines) {
          lines.push(overrideLine);
        }
        lines.push(`      </Overrides>`);
      }
      lines.push(`    </Spec>`);
    } else {
      lines.push(
        `    <Spec title="${escapeXml(spec.title)}" treeVersion="${escapeXml(spec.treeVersion)}" classId="${classNum}" ascendClassId="${ascendClassNum}"${poe2InternalClassAttrs} nodes="${nodesStr}"${wsAttrs}${masteryAttr} />`,
      );
    }
  }
  lines.push(`  </Tree>`);

  // <Skills> (supports multiple <SkillSet> loadouts with activeSkillSet)
  const skillSetsToWrite: SkillSetSpec[] =
    build.skillSets && build.skillSets.length > 0
      ? build.skillSets.map((setSpec, i) =>
          i === (build.activeSkillSetIndex ?? 0)
            ? { ...setSpec, skills: build.skills, mainSkillGroupId: build.mainSkillGroupId }
            : setSpec,
        )
      : [{ id: '1', title: 'Default', skills: build.skills, mainSkillGroupId: build.mainSkillGroupId }];
  const activeSkillSetIdx = Math.max(
    0,
    Math.min(skillSetsToWrite.length - 1, build.activeSkillSetIndex ?? 0),
  );
  const activeSkillSetId = skillSetsToWrite[activeSkillSetIdx]?.id || String(activeSkillSetIdx + 1);

  lines.push(`  <Skills activeSkillSet="${escapeXml(activeSkillSetId)}" defaultGemQuality="0">`);
  skillSetsToWrite.forEach((setSpec, idx) => {
    const setId = setSpec.id || String(idx + 1);
    const titleAttr = setSpec.title ? ` title="${escapeXml(setSpec.title)}"` : '';
    lines.push(`    <SkillSet id="${escapeXml(setId)}"${titleAttr}>`);
    for (const group of setSpec.skills) {
      const slotAttr = group.slot ? ` slot="${escapeXml(group.slot)}"` : '';
      const wsAttr =
        group.weaponSets && group.weaponSets.length > 0
          ? ` weaponSets="${group.weaponSets.join(',')}"`
          : '';
      const poe2SetAttrs =
        build.game === 'poe2' && group.weaponSets !== undefined
          ? ` set1="${group.weaponSets.includes(1)}" set2="${group.weaponSets.includes(2)}"`
          : '';
      const mainActive = group.mainActiveSkillIndex ?? 1;
      const fullDpsAttr = group.includeInFullDps ? ' includeInFullDPS="true"' : '';
      const groupPartAttr =
        group.skillPart !== undefined && group.skillPart >= 1
          ? ` skillPart="${group.skillPart}" skillPartCalcs="${group.skillPart}"`
          : '';
      const groupStatSetAttr =
        group.statSetIndex !== undefined && group.statSetIndex >= 1
          ? ` statSetIndex="${group.statSetIndex}" statSetIndexCalcs="${group.statSetIndex}"`
          : '';
      const groupSourceAttr = group.source ? ` source="${escapeXml(group.source)}"` : '';
      lines.push(
        `      <Skill enabled="${group.enabled}" mainActiveSkill="${mainActive}" mainActiveSkillCalcs="${mainActive}"${fullDpsAttr}${groupPartAttr}${groupStatSetAttr}${groupSourceAttr} label="${escapeXml(group.label)}"${slotAttr}${wsAttr}${poe2SetAttrs}>`,
      );
      for (const gem of group.gems) {
        const def = gemsCatalog.find((g) => g.id === gem.gemId);
        const nameSpec = def ? def.name.en.replace(/\s+Support$/i, '') : gem.gemId;
        const countAttr = gem.count && gem.count > 1 ? ` count="${gem.count}"` : '';
        const gemPartAttr =
          gem.skillPart !== undefined && gem.skillPart >= 1
            ? ` skillPart="${gem.skillPart}" skillPartCalcs="${gem.skillPart}"`
            : '';
        const gemStatSetAttr =
          gem.statSetIndex !== undefined && gem.statSetIndex >= 1
            ? ` statSetIndex="${gem.statSetIndex}" statSetIndexCalcs="${gem.statSetIndex}"`
            : '';
        const global1Attr =
          gem.enableGlobal1 !== undefined ? ` enableGlobal1="${gem.enableGlobal1}"` : '';
        const global2Attr =
          gem.enableGlobal2 !== undefined ? ` enableGlobal2="${gem.enableGlobal2}"` : '';
        const xmlBaseLevel = gem.corruptLevel ? gem.level - gem.corruptLevel : gem.level;
        const corruptLevelAttr =
          gem.corruptLevel !== undefined && gem.corruptLevel !== 0
            ? ` corruptLevel="${gem.corruptLevel}"`
            : '';
        lines.push(
          `        <Gem gemId="${escapeXml(gem.gemId)}" nameSpec="${escapeXml(nameSpec)}" level="${xmlBaseLevel}"${corruptLevelAttr} quality="${gem.quality}" enabled="${gem.enabled}"${countAttr}${gemPartAttr}${gemStatSetAttr}${global1Attr}${global2Attr} />`,
        );
      }
      lines.push(`      </Skill>`);
    }
    lines.push(`    </SkillSet>`);
  });
  lines.push(`  </Skills>`);

  // <Items> (supports multiple <ItemSet> loadouts with activeItemSet)
  const itemSetsToWrite: ItemSetSpec[] =
    build.itemSets && build.itemSets.length > 0
      ? build.itemSets.map((setSpec, i) =>
          i === (build.activeItemSetIndex ?? 0)
            ? { ...setSpec, equipped: build.equipped, activeFlaskSlots: build.activeFlaskSlots }
            : setSpec,
        )
      : [{ id: '1', title: 'Default', equipped: build.equipped, activeFlaskSlots: build.activeFlaskSlots }];
  const activeItemSetIdx = Math.max(
    0,
    Math.min(itemSetsToWrite.length - 1, build.activeItemSetIndex ?? 0),
  );
  const activeItemSetId = itemSetsToWrite[activeItemSetIdx]?.id || String(activeItemSetIdx + 1);

  lines.push(`  <Items activeItemSet="${escapeXml(activeItemSetId)}">`);
  itemEntries.forEach((item, index) => {
    const numId = index + 1;
    const itemVariant = item.variant ?? item.selectedVariant;
    const variantAttr = itemVariant !== undefined ? ` variant="${itemVariant}"` : '';
    const body = escapeXml(formatItemToPobText(item));
    lines.push(`    <Item id="${numId}"${variantAttr}>\n${body}\n    </Item>`);
  });
  itemSetsToWrite.forEach((setSpec, idx) => {
    const setId = setSpec.id || String(idx + 1);
    const titleAttr = setSpec.title ? ` title="${escapeXml(setSpec.title)}"` : '';
    const itemSetWsAttr =
      idx === activeItemSetIdx && build.game === 'poe2' && build.activeWeaponSet === 2
        ? ' useSecondWeaponSet="true"'
        : '';
    lines.push(`    <ItemSet id="${escapeXml(setId)}"${titleAttr}${itemSetWsAttr}>`);
    for (const [slot, itemId] of Object.entries(setSpec.equipped)) {
      if (!itemId) continue;
      const numId = idToNum.get(itemId);
      if (numId) {
        const isActiveFlask =
          slot.startsWith('Flask ') && setSpec.activeFlaskSlots?.[slot as EquipmentSlotId];
        lines.push(
          `      <Slot name="${escapeXml(slot)}" itemId="${numId}"${isActiveFlask ? ' active="true"' : ''} />`,
        );
      }
    }
    lines.push(`    </ItemSet>`);
  });
  lines.push(`  </Items>`);

  // <Config>
  const cfg = build.config;
  lines.push(`  <Config activeConfigSet="1">`);
  lines.push(`    <ConfigSet id="1">`);
  lines.push(`      <Input name="enemyLevel" number="${cfg.enemyLevel}" />`);
  lines.push(`      <Input name="enemyIsBoss" string="${escapeXml(cfg.enemyIsBoss)}" />`);
  lines.push(`      <Input name="usePowerCharges" boolean="${cfg.usePowerCharges}" />`);
  lines.push(`      <Input name="powerCharges" number="${cfg.powerCharges}" />`);
  lines.push(`      <Input name="useFrenzyCharges" boolean="${cfg.useFrenzyCharges}" />`);
  lines.push(`      <Input name="frenzyCharges" number="${cfg.frenzyCharges}" />`);
  lines.push(`      <Input name="useEnduranceCharges" boolean="${cfg.useEnduranceCharges}" />`);
  lines.push(`      <Input name="enduranceCharges" number="${cfg.enduranceCharges}" />`);
  lines.push(`      <Input name="buffOnslaught" boolean="${cfg.onslaught}" />`);
  lines.push(`      <Input name="enemyShocked" boolean="${cfg.enemyShocked}" />`);
  lines.push(`      <Input name="shockValue" number="${cfg.shockValue}" />`);
  if (cfg.enemyChilled) lines.push(`      <Input name="conditionEnemyChilled" boolean="true" />`);
  if (cfg.conditionLowLife) lines.push(`      <Input name="conditionLowLife" boolean="true" />`);
  if (cfg.conditionFullLife) lines.push(`      <Input name="conditionFullLife" boolean="true" />`);
  if (cfg.buffArcaneSurge) lines.push(`      <Input name="buffArcaneSurge" boolean="true" />`);
  if (cfg.buffTailwind) lines.push(`      <Input name="buffTailwind" boolean="true" />`);
  if (cfg.enemyIntimidated) lines.push(`      <Input name="conditionEnemyIntimidated" boolean="true" />`);
  if (cfg.enemyUnnerved) lines.push(`      <Input name="conditionEnemyUnnerved" boolean="true" />`);
  if (cfg.enemyBlinded) lines.push(`      <Input name="conditionEnemyBlinded" boolean="true" />`);
  if (cfg.enemyTaunted) lines.push(`      <Input name="conditionEnemyTaunted" boolean="true" />`);
  if (cfg.witheredStacks) lines.push(`      <Input name="multiplierWitheredStackCount" number="${cfg.witheredStacks}" />`);
  if (cfg.enemyFireExposure) lines.push(`      <Input name="conditionEnemyFireExposure" boolean="true" />`);
  if (cfg.enemyColdExposure) lines.push(`      <Input name="conditionEnemyColdExposure" boolean="true" />`);
  if (cfg.enemyLightningExposure) lines.push(`      <Input name="conditionEnemyLightningExposure" boolean="true" />`);
  if (cfg.rage && cfg.rage > 0) lines.push(`      <Input name="multiplierRage" number="${cfg.rage}" />`);
  if (cfg.fortified) {
    lines.push(`      <Input name="buffFortification" boolean="true" />`);
    if (cfg.fortificationStacks !== undefined && cfg.fortificationStacks !== 20) {
      lines.push(`      <Input name="overrideFortification" number="${cfg.fortificationStacks}" />`);
    }
  }
  if (cfg.activeGuardSkill && cfg.activeGuardSkill !== 'None') {
    lines.push(`      <Input name="activeGuardSkill" string="${escapeXml(cfg.activeGuardSkill)}" />`);
  }
  if (cfg.pantheonMajor && cfg.pantheonMajor !== 'None') {
    lines.push(`      <Input name="pantheonMajorGod" string="${escapeXml(cfg.pantheonMajor)}" />`);
  }
  if (cfg.pantheonMinor && cfg.pantheonMinor !== 'None') {
    lines.push(`      <Input name="pantheonMinorGod" string="${escapeXml(cfg.pantheonMinor)}" />`);
  }
  if (cfg.customMods.trim()) {
    lines.push(`      <Placeholder name="customMods" string="${escapeXml(cfg.customMods)}" />`);
  }
  lines.push(`    </ConfigSet>`);
  lines.push(`  </Config>`);

  // <Notes>
  lines.push(`  <Notes>${escapeXml(build.notes)}</Notes>`);
  lines.push(`</${rootTag}>`);
  return lines.join('\n');
}

/**
 * Compresses and Base64URL-encodes a `Build` into a standard Path of Building share code.
 */
export function encodeBuildToPobCode(build: Build): string {
  const xml = buildToPobXml(build);
  const compressed = deflate(new TextEncoder().encode(xml));
  return bytesToBase64Url(compressed);
}

/**
 * Decodes a Path of Building share code (Base64URL + zlib) back into raw XML string.
 */
export function decodePobCodeToXml(code: string): string {
  const bytes = base64UrlToBytes(code);
  const inflated = inflate(bytes);
  return new TextDecoder('utf-8').decode(inflated);
}

function parseNodeList(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function parsePositiveIntAttr(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : undefined;
}

function matchGemId(
  game: GameId,
  rawGemId?: string,
  rawNameSpec?: string,
  rawSkillId?: string,
  rawVariantId?: string,
): string | null {
  return (
    resolveGemFromPobRef(game, {
      gemId: rawGemId,
      nameSpec: rawNameSpec,
      skillId: rawSkillId,
      variantId: rawVariantId,
    })?.id ?? null
  );
}

/**
 * PoE 1 Legacy of Phrecia (`*_alternate`) ascendancy node stats for Aristocrat, Paladin, and Whisperer.
 * Used when an imported build references a `3_25_alternate`..`3_28_alternate` tree whose alternate
 * ascendancy node IDs are absent from the standard PoE 1 passive tree JSON.
 */
const PHRECIA_ALTERNATE_NODE_STATS: Readonly<Record<number, readonly string[]>> = {
  // Aristocrat (alternate Duelist / Slayer slot)
  2748: ['40% increased Strength'], // Illicit Gains
  50743: ['40% increased Intelligence'], // Private Tuition
  11154: ['40% increased Dexterity'], // Fancy Foil
  30851: ['+20% to Quality of all Skill Gems'], // Centerpiece
  46836: ['+1 to Level of all Skill Gems'], // Family Heirlooms
  35022: ['+4 to Level of all non-Exceptional Support Gems'], // Gem-lined Cap
  // Paladin (alternate Duelist / Champion slot)
  2134: ['Regenerate 0.5% of Life per second', '5% increased effect of Non-Curse Auras from your Skills'],
  2437: ['Regenerate 0.5% of Life per second', '5% increased effect of Non-Curse Auras from your Skills'],
  38874: ['Regenerate 0.5% of Life per second', '5% increased effect of Non-Curse Auras from your Skills'],
  49271: ['Regenerate 0.5% of Life per second', '5% increased effect of Non-Curse Auras from your Skills'],
  11127: ['Regenerate 0.5% of Life per second', '5% increased effect of Non-Curse Auras from your Skills'],
  363: ['Regenerate 0.5% of Life per second', '5% increased effect of Non-Curse Auras from your Skills'],
  29126: ['Regenerate 0.5% of Life per second', '5% increased effect of Non-Curse Auras from your Skills'],
  54067: ['Regenerate 0.5% of Life per second', '5% increased effect of Non-Curse Auras from your Skills'],
  43835: ['Regenerate 0.5% of Life per second', '5% increased effect of Non-Curse Auras from your Skills'],
  13763: ['Nearby Enemies take 25% increased Elemental Damage'], // Light of Divinity
  42396: ['Magic Utility Flasks applied to you have 40% increased Effect'], // Field Medicine
  40171: ['40% increased Effect of Non-Curse Auras from your Skills while you have a Linked Target'], // Absolution
  46492: ['Enemies Taunted by you take 20% increased Damage'], // Bring the Battle
  // Whisperer (alternate Ranger / Deadeye slot)
  1116: ['10% increased Attack Damage', '6% increased maximum Mana'],
  21095: ['10% increased Attack Damage', '6% increased maximum Mana'],
  540: ['10% increased Attack Damage', '6% increased maximum Mana'],
  24726: ['10% increased Attack Damage', '6% increased maximum Mana'],
  15390: ['10% increased Attack Damage', '6% increased maximum Mana'],
  9982: ['10% increased Attack Damage', '6% increased maximum Mana'],
  27553: ['10% increased Attack Damage', '6% increased maximum Mana'],
  17123: ['10% increased Attack Damage', '6% increased maximum Mana'],
  30419: ['10% increased Attack Damage', '6% increased maximum Mana'],
  2266: [
    '+4 to Minimum Frenzy Charges',
    '+4 to Minimum Power Charges',
    '+1 to Maximum Frenzy Charges',
    '+1 to Maximum Power Charges',
  ], // there is more
  26415: ['20% of Damage taken Recouped as Mana', '100% of Physical Damage is taken from Mana before Life'], // don't panic yet
  // Harbinger (alternate Witch / Occultist slot)
  63336: ['10% increased Energy Shield Recharge Rate', '15% increased Mana Regeneration Rate'],
  1811: ['10% increased Energy Shield Recharge Rate', '15% increased Mana Regeneration Rate'],
  23770: ['10% increased Energy Shield Recharge Rate', '15% increased Mana Regeneration Rate'],
  58661: ['10% increased Energy Shield Recharge Rate', '15% increased Mana Regeneration Rate'],
  39702: [
    '30% of Non-Chaos Damage taken bypasses Energy Shield',
    'Gain 20% of Maximum Mana as Extra Maximum Energy Shield',
    'Gain 10% of Maximum Life as Extra Maximum Energy Shield',
  ],
  34822: ['100% increased Area of Effect of Hex Skills'],
  3702: ['55% increased Cooldown Recovery Rate'],
};

/**
 * Parses official Path of Building XML (PoE 1 or PoE 2) into a WebPoB `Build` object.
 */
export function xmlToBuild(xml: string): Build {
  const trimmedXml = xml.trim();
  if (/^(?:<!doctype\s+html\b|<html\b)/i.test(trimmedXml)) {
    throw new Error(
      'Received an HTML webpage instead of a Path of Building XML/code. If this is a poe.ninja character page, click "Copy PoB code" on the page and paste the PoB code or poe.ninja/poe2/pob/... link instead.',
    );
  }
  const hasPobRoot = /<PathOfBuilding2?\b/i.test(trimmedXml);
  const hasBuildTag = /<Build\b/i.test(trimmedXml);
  if (!hasPobRoot && !hasBuildTag) {
    throw new Error(
      'Invalid Path of Building XML: missing <PathOfBuilding> or <PathOfBuilding2> root element.',
    );
  }

  const isPoe2 =
    /<PathOfBuilding2\b/i.test(trimmedXml) ||
    /className="(?:Sorceress|Monk|Warrior|Mercenary|Huntress|Druid)"/i.test(trimmedXml) ||
    /weaponSet1Nodes="/i.test(trimmedXml);
  const game: GameId = isPoe2 ? 'poe2' : 'poe1';

  const buildTag = trimmedXml.match(/<Build\b([^>]*)\/?>/i);
  const buildAttrs = buildTag ? parseAttributes(buildTag[1]!) : {};

  const classes = getClassesForGame(game);
  const classDef =
    classes.find((c) => c.id.toLowerCase() === (buildAttrs.className ?? '').toLowerCase()) ??
    classes[0]!;
  const level = Math.max(1, Math.min(100, Number(buildAttrs.level ?? 90) || 90));
  const ascendancyId = buildAttrs.ascendClassName || buildAttrs.ascendancyName || '';
  const mainSocketGroupIdx = Math.max(1, Number(buildAttrs.mainSocketGroup ?? 1) || 1);

  // Parse <Item> elements first so both <Tree><Spec><Sockets> and <Items><ItemSet> can resolve itemIds
  const items: Record<string, Item> = {};
  const numIdToItemId = new Map<string, string>();
  const itemRegex = /<Item\b([^>]*)>([\s\S]*?)<\/Item>/gi;
  let itemMatch: RegExpExecArray | null;
  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const attrs = parseAttributes(itemMatch[1]!);
    const numId = attrs.id ?? String(numIdToItemId.size + 1);
    const body = unescapeXml(itemMatch[2] ?? '').trim();
    const itemId = `imp_item_${numId}`;
    const variantNum = attrs.variant !== undefined ? Number(attrs.variant) : undefined;
    const variantAlts = [
      attrs.variantAlt,
      attrs.variantAlt2,
      attrs.variantAlt3,
      attrs.variantAlt4,
      attrs.variantAlt5,
    ]
      .map((v) => (v !== undefined ? Number(v) : NaN))
      .filter((n) => Number.isFinite(n) && n > 0);
    const itemOptions: ParseItemOptions | undefined =
      (variantNum !== undefined && Number.isFinite(variantNum)) || variantAlts.length > 0
        ? {
            ...(variantNum !== undefined && Number.isFinite(variantNum) ? { variant: variantNum } : {}),
            ...(variantAlts.length > 0 ? { variantAlts } : {}),
          }
        : undefined;
    const parsed = parseItemText(body, itemId, game, itemOptions);
    if (parsed) {
      items[itemId] = parsed;
      numIdToItemId.set(numId, itemId);
    }
  }

  // Parse <Items activeItemSet="..."> & all <ItemSet> blocks (scoped to <Items>...</Items>)
  const itemsSectionMatch = xml.match(/<Items\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Items>)/i);
  const itemsHeaderAttrs = itemsSectionMatch ? parseAttributes(itemsSectionMatch[1]!) : {};
  const itemsSectionXml = itemsSectionMatch?.[2] ?? xml;
  const requestedItemSetId = itemsHeaderAttrs.activeItemSet || '1';
  const itemSets: ItemSetSpec[] = [];
  const itemSetWsFlags: boolean[] = [];
  const parseSlotsFromBlock = (
    blockXml: string,
  ): {
    eq: Partial<Record<EquipmentSlotId, string>>;
    fl: Partial<Record<EquipmentSlotId, boolean>>;
  } => {
    const eq: Partial<Record<EquipmentSlotId, string>> = {};
    const fl: Partial<Record<EquipmentSlotId, boolean>> = {};
    const slotRegex = /<Slot\b([^>]*)\/?>/gi;
    let slotMatch: RegExpExecArray | null;
    while ((slotMatch = slotRegex.exec(blockXml)) !== null) {
      const attrs = parseAttributes(slotMatch[1]!);
      const slotName = attrs.name as EquipmentSlotId | undefined;
      const itemId = attrs.itemId ? numIdToItemId.get(attrs.itemId) : undefined;
      if (slotName && itemId) {
        eq[slotName] = itemId;
        if ((slotName.startsWith('Flask ') || slotName.startsWith('Charm ')) && attrs.active === 'true') {
          fl[slotName] = true;
        }
      }
    }
    return { eq, fl };
  };
  const itemSetBlockRegex = /<ItemSet\b([^>]*?)(?:\/>|>([\s\S]*?)<\/ItemSet>)/gi;
  let isMatch: RegExpExecArray | null;
  while ((isMatch = itemSetBlockRegex.exec(itemsSectionXml)) !== null) {
    const isAttrs = parseAttributes(isMatch[1]!);
    const isInner = isMatch[2] ?? '';
    const { eq, fl } = parseSlotsFromBlock(isInner);
    itemSets.push({
      id: isAttrs.id || String(itemSets.length + 1),
      title: isAttrs.title || (itemSets.length === 0 ? 'Default' : `Set ${itemSets.length + 1}`),
      equipped: eq,
      ...(Object.keys(fl).length > 0 ? { activeFlaskSlots: fl } : {}),
    });
    itemSetWsFlags.push(isAttrs.useSecondWeaponSet === 'true');
  }
  if (itemSets.length === 0) {
    // Legacy PoB XML without <ItemSet> wrappers: parse direct <Slot> children of <Items>
    const { eq, fl } = parseSlotsFromBlock(itemsSectionXml);
    if (Object.keys(eq).length > 0) {
      itemSets.push({
        id: '1',
        title: 'Default',
        equipped: eq,
        ...(Object.keys(fl).length > 0 ? { activeFlaskSlots: fl } : {}),
      });
      itemSetWsFlags.push(itemsHeaderAttrs.useSecondWeaponSet === 'true');
    }
  }
  let activeItemSetIndex = itemSets.findIndex((s) => s.id === requestedItemSetId);
  if (activeItemSetIndex < 0) {
    const numericIdx = Number(requestedItemSetId) - 1;
    activeItemSetIndex =
      Number.isFinite(numericIdx) && numericIdx >= 0 && numericIdx < itemSets.length ? numericIdx : 0;
  }
  const activeItemSet = itemSets[activeItemSetIndex];
  const equipped: Partial<Record<EquipmentSlotId, string>> = activeItemSet ? { ...activeItemSet.equipped } : {};
  const activeFlaskSlots: Partial<Record<EquipmentSlotId, boolean>> = activeItemSet?.activeFlaskSlots
    ? { ...activeItemSet.activeFlaskSlots }
    : {};
  const activeWeaponSet: WeaponSetId =
    buildAttrs.activeWeaponSet === '2' ||
    itemSetWsFlags[activeItemSetIndex] ||
    itemsHeaderAttrs.useSecondWeaponSet === 'true'
      ? 2
      : 1;

  // Parse <Tree activeSpec="..."> & ALL <Spec> elements (scoped to <Tree>...</Tree>)
  const defaultTree = getTreeForGame(game);
  const defaultStartNodeId = defaultTree.classStartNodeIds[classDef.id];
  const treeSectionMatch = xml.match(/<Tree\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Tree>)/i);
  const treeHeaderAttrs = treeSectionMatch ? parseAttributes(treeSectionMatch[1]!) : {};
  const treeSectionXml = treeSectionMatch?.[2] ?? xml;
  const requestedSpecId = treeHeaderAttrs.activeSpec || '1';
  const requestedSpecIdx = Math.max(1, Number(requestedSpecId) || 1) - 1;

  const treeSpecs: TreeSpec[] = [];
  const treeSpecIds: Array<string | undefined> = [];
  const treeSpecPhreciaModLines: string[][] = [];
  const specBlockRegex = /<Spec\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Spec>)/gi;
  let spMatch: RegExpExecArray | null;
  while ((spMatch = specBlockRegex.exec(treeSectionXml)) !== null) {
    const specAttrs = parseAttributes(spMatch[1]!);
    const specInner = spMatch[2] ?? '';
    const specTree = getTreeForGame(game, specAttrs.treeVersion);
    const specStartNodeId = specTree.classStartNodeIds[classDef.id] ?? defaultStartNodeId;
    const ws1ChildMatch = specInner.match(/<WeaponSet1\b[^>]*\bnodes="([^"]*)"/i);
    const ws2ChildMatch = specInner.match(/<WeaponSet2\b[^>]*\bnodes="([^"]*)"/i);
    const weaponSet1NodeIds = parseNodeList(ws1ChildMatch?.[1] ?? specAttrs.weaponSet1Nodes).filter((id) =>
      Boolean(specTree.nodes[id]),
    );
    const weaponSet2NodeIds = parseNodeList(ws2ChildMatch?.[1] ?? specAttrs.weaponSet2Nodes).filter((id) =>
      Boolean(specTree.nodes[id]),
    );
    const wsExclusiveSet = new Set<number>([...weaponSet1NodeIds, ...weaponSet2NodeIds]);
    const rawSpecNodes = parseNodeList(specAttrs.nodes);
    let allocatedNodeIds = rawSpecNodes.filter(
      (id) => Boolean(specTree.nodes[id]) && !wsExclusiveSet.has(id),
    );
    const phreciaModLines: string[] = [];
    if (game === 'poe1' && /_alternate$/i.test(specAttrs.treeVersion ?? '')) {
      for (const id of rawSpecNodes) {
        if (specTree.nodes[id]) continue;
        const altStats = PHRECIA_ALTERNATE_NODE_STATS[id];
        if (altStats) {
          phreciaModLines.push(...altStats);
        }
      }
    }
    const clusterNodeIds =
      game === 'poe1' ? rawSpecNodes.filter((id) => id >= 65536 && !specTree.nodes[id]) : [];
    if (specStartNodeId && !allocatedNodeIds.includes(specStartNodeId)) {
      allocatedNodeIds = [specStartNodeId, ...allocatedNodeIds];
    }
    // Preserve ALL <Spec><Sockets> jewel nodeIds (including Voices / cluster jewel / legacy socket IDs absent from tree.nodes)
    const specJewels: Record<number, string> = {};
    const jewelSocketRegex = /<Socket\b([^>]*)\/?>/gi;
    let jsMatch: RegExpExecArray | null;
    while ((jsMatch = jewelSocketRegex.exec(specInner)) !== null) {
      const attrs = parseAttributes(jsMatch[1]!);
      const nodeId = Number(attrs.nodeId);
      const itemId = attrs.itemId ? numIdToItemId.get(attrs.itemId) : undefined;
      if (Number.isFinite(nodeId) && nodeId > 0 && itemId) {
        specJewels[nodeId] = itemId;
      }
    }
    const specAttributeOverrides: Record<number, 'str' | 'dex' | 'int'> = {};
    const attrOverrideRegex = /<AttributeOverride\b([^>]*)\/?>/gi;
    let aoMatch: RegExpExecArray | null;
    while ((aoMatch = attrOverrideRegex.exec(specInner)) !== null) {
      const attrs = parseAttributes(aoMatch[1]!);
      for (const id of parseNodeList(attrs.strNodes)) specAttributeOverrides[id] = 'str';
      for (const id of parseNodeList(attrs.dexNodes)) specAttributeOverrides[id] = 'dex';
      for (const id of parseNodeList(attrs.intNodes)) specAttributeOverrides[id] = 'int';
    }
    const masteryEffects = parseMasteryEffectsAttr(specAttrs.masteryEffects, specTree);
    const specNodeOverrides = parseNodeOverrides(specInner);
    treeSpecs.push({
      title: specAttrs.title || (treeSpecs.length === 0 ? 'Default' : `Spec ${treeSpecs.length + 1}`),
      treeVersion: specAttrs.treeVersion || specTree.version,
      allocatedNodeIds,
      ...(clusterNodeIds.length > 0 ? { clusterNodeIds } : {}),
      weaponSet1NodeIds,
      weaponSet2NodeIds,
      masteryEffects,
      ...(Object.keys(specJewels).length > 0 ? { socketedJewels: specJewels } : {}),
      ...(Object.keys(specAttributeOverrides).length > 0
        ? { attributeOverrides: specAttributeOverrides }
        : {}),
      ...(Object.keys(specNodeOverrides).length > 0
        ? { nodeOverrides: specNodeOverrides }
        : {}),
    });
    treeSpecIds.push(specAttrs.id);
    treeSpecPhreciaModLines.push(phreciaModLines);
  }
  if (treeSpecs.length === 0) {
    treeSpecs.push({
      title: 'Default',
      treeVersion: defaultTree.version,
      allocatedNodeIds: defaultStartNodeId ? [defaultStartNodeId] : [],
      weaponSet1NodeIds: [],
      weaponSet2NodeIds: [],
      masteryEffects: {},
    });
    treeSpecIds.push(undefined);
    treeSpecPhreciaModLines.push([]);
  }
  const specIdMatchIdx = treeSpecIds.findIndex((id) => id !== undefined && id === requestedSpecId);
  const activeTreeSpecIndex =
    specIdMatchIdx >= 0 ? specIdMatchIdx : Math.max(0, Math.min(treeSpecs.length - 1, requestedSpecIdx));
  const activeTreeSpec = treeSpecs[activeTreeSpecIndex]!;
  const activeSpecPhreciaModLines = treeSpecPhreciaModLines[activeTreeSpecIndex] ?? [];

  // Parse <Skills activeSkillSet="..."> & all <SkillSet> blocks
  // Track exact 1-based XML <Skill> ordinal so `mainSocketGroup` never shifts when empty or item-source <Skill/> tags precede it.
  const parseSkillGroupsFromBlock = (
    blockXml: string,
    prefix: string,
  ): { groups: SkillGroup[]; byXmlOrdinal: Map<number, string>; groupMineCounts: Map<string, number> } => {
    const parsed: SkillGroup[] = [];
    const byXmlOrdinal = new Map<number, string>();
    const groupMineCounts = new Map<string, number>();
    const skillRegex = /<Skill(?=\s|>|\/)([^>]*?)(?:\/>|>([\s\S]*?)<\/Skill>)/gi;
    let skillMatch: RegExpExecArray | null;
    let xmlOrdinal = 0;
    let groupCounter = 1;
    while ((skillMatch = skillRegex.exec(blockXml)) !== null) {
      xmlOrdinal++;
      const attrs = parseAttributes(skillMatch[1]!);
      const inner = skillMatch[2] ?? '';
      const gems: GemInstance[] = [];
      let firstEnabledGemMineCount: number | undefined;
      const gemRegex = /<Gem(?=\s|>|\/)([^>]*?)(?:\/>|>([\s\S]*?)<\/Gem>)/gi;
      let gemMatch: RegExpExecArray | null;
      let gemCounter = 1;
      while ((gemMatch = gemRegex.exec(inner)) !== null) {
        const gAttrs = parseAttributes(gemMatch[1]!);
        const gemInner = gemMatch[2] ?? '';
        const matchedId = matchGemId(
          game,
          gAttrs.gemId,
          gAttrs.nameSpec,
          gAttrs.skillId,
          gAttrs.variantId,
        );
        if (matchedId) {
          const parsedCount = Number(gAttrs.count ?? 1);
          const gemSkillPart =
            parsePositiveIntAttr(gAttrs.skillPart) ?? parsePositiveIntAttr(gAttrs.skillPartCalcs);
          // Official PoB 1 CalcActiveSkill.lua:686 only reads skillStageCount in MAIN mode (not skillStageCountCalcs).
          const gemStageCount =
            parsePositiveIntAttr(gAttrs.skillStageCount) ??
            (game === 'poe2' ? parsePositiveIntAttr(gAttrs.skillStageCountCalcs) : undefined);
          if (gAttrs.enabled !== 'false' && firstEnabledGemMineCount === undefined) {
            const gemMineCount = parsePositiveIntAttr(gAttrs.skillMineCount);
            if (gemMineCount !== undefined) {
              firstEnabledGemMineCount = gemMineCount;
            }
          }
          let gemStatSetIndex =
            parsePositiveIntAttr(gAttrs.statSetIndex) ??
            parsePositiveIntAttr(gAttrs.statSetIndexCalcs);
          if (gemStatSetIndex === undefined && gemInner) {
            const ssRegex = /<StatSetIndex\b([^>]*)\/?>/gi;
            let ssm: RegExpExecArray | null;
            while ((ssm = ssRegex.exec(gemInner)) !== null) {
              const ssAttrs = parseAttributes(ssm[1]!);
              const idxVal = parsePositiveIntAttr(ssAttrs.index);
              if (idxVal === undefined) continue;
              if (!gAttrs.skillId || !ssAttrs.grantedEffect || ssAttrs.grantedEffect === gAttrs.skillId) {
                gemStatSetIndex = idxVal;
                break;
              }
              if (gemStatSetIndex === undefined) {
                gemStatSetIndex = idxVal;
              }
            }
          }
          const enableGlobal1 =
            gAttrs.enableGlobal1 !== undefined ? gAttrs.enableGlobal1 !== 'false' : undefined;
          const enableGlobal2 =
            gAttrs.enableGlobal2 !== undefined ? gAttrs.enableGlobal2 === 'true' : undefined;
          const baseGemLevel = Number(gAttrs.level ?? 20) || 20;
          const rawCorruptLevel =
            gAttrs.corruptLevel !== undefined ? Number(gAttrs.corruptLevel) : 0;
          const corruptLevel = Number.isFinite(rawCorruptLevel) ? Math.round(rawCorruptLevel) : 0;
          gems.push({
            instanceId: `${prefix}_g_${groupCounter}_${gemCounter++}`,
            gemId: matchedId,
            level: Math.max(1, baseGemLevel + corruptLevel),
            quality: Number(gAttrs.quality ?? 0) || 0,
            enabled: gAttrs.enabled !== 'false',
            ...(corruptLevel !== 0 ? { corruptLevel } : {}),
            ...(Number.isFinite(parsedCount) && parsedCount > 1 ? { count: Math.round(parsedCount) } : {}),
            ...(gemSkillPart !== undefined ? { skillPart: gemSkillPart } : {}),
            ...(gemStatSetIndex !== undefined ? { statSetIndex: gemStatSetIndex } : {}),
            ...(gemStageCount !== undefined ? { stageCount: gemStageCount } : {}),
            ...(gAttrs.fromItem === 'true' || Boolean(attrs.source && /^Item:/i.test(attrs.source))
              ? { fromItem: true }
              : {}),
            ...(enableGlobal1 !== undefined ? { enableGlobal1 } : {}),
            ...(enableGlobal2 !== undefined ? { enableGlobal2 } : {}),
          });
        }
      }
      // PoE 1 3.28+ Imbued Support Gem on <Skill imbuedSupport="..."> (Level 1 support linked to the skill group)
      if (game === 'poe1' && attrs.imbuedSupport && attrs.imbuedSupport !== 'nil') {
        const imbuedId =
          matchGemId(game, undefined, attrs.imbuedSupport, undefined, undefined) ??
          matchGemId(game, undefined, `${attrs.imbuedSupport} Support`, undefined, undefined);
        if (imbuedId && !gems.some((g) => g.gemId === imbuedId)) {
          gems.push({
            instanceId: `${prefix}_g_${groupCounter}_${gemCounter++}`,
            gemId: imbuedId,
            level: 1,
            quality: 0,
            enabled: true,
            fromItem: true,
          });
        }
      }
      if (gems.length === 0 && attrs.skillId) {
        const itemSkillMatched = matchGemId(game, undefined, attrs.label, attrs.skillId, undefined);
        if (itemSkillMatched) {
          const isFreeSceptreOrItemAura = Boolean(attrs.source && /^Item:/i.test(attrs.source));
          gems.push({
            instanceId: `${prefix}_g_${groupCounter}_1`,
            gemId: itemSkillMatched,
            level: Number(attrs.level ?? 20) || 20,
            quality: 0,
            enabled: true,
            ...(isFreeSceptreOrItemAura ? { fromItem: true } : {}),
            ...(isFreeSceptreOrItemAura && game === 'poe2' ? { spiritReservationOverride: 0 } : {}),
          });
        }
      }
      if (gems.length === 0 && (attrs.source || attrs.slot)) {
        // Resolve item-granted <Skill source="Item:1:Relic of the Pact, ..." slot="Weapon 1"/> when <Gem> & skillId are omitted
        let sourceItem: Item | undefined;
        const mSrcItem = attrs.source?.match(/^Item:(\d+):/i);
        if (mSrcItem?.[1]) {
          const mappedId = numIdToItemId.get(mSrcItem[1]);
          if (mappedId) sourceItem = items[mappedId];
        }
        if (!sourceItem && attrs.slot) {
          const slotItemId = equipped[attrs.slot as EquipmentSlotId];
          if (slotItemId) sourceItem = items[slotItemId];
        }
        if (sourceItem) {
          let grantedName: string | undefined;
          let grantedLevel = Number(attrs.level ?? 0) || 0;
          for (const rawLine of [...sourceItem.implicits, ...sourceItem.explicits]) {
            const cleanLine = rawLine.replace(/\{[^}]*\}/g, '').trim();
            let mGrant = cleanLine.match(/^Grants Skill:\s*Level\s+(\d+)\s+(.+)$/i);
            if (mGrant) {
              grantedLevel = Number(mGrant[1]);
              grantedName = mGrant[2]!.trim();
              break;
            }
            mGrant = cleanLine.match(/^Grants Level\s+(\d+)\s+(.+?)\s+Skill$/i);
            if (mGrant) {
              grantedLevel = Number(mGrant[1]);
              grantedName = mGrant[2]!.trim();
              break;
            }
            mGrant = cleanLine.match(/^Grants Skill:\s*(.+)$/i);
            if (mGrant) {
              grantedName = mGrant[1]!.trim();
              break;
            }
            mGrant = cleanLine.match(/^Trigger Level\s+(\d+)\s+([A-Za-z ':-]+?)\s+(?:on|when|from)\b/i);
            if (mGrant) {
              grantedLevel = Number(mGrant[1]);
              grantedName = mGrant[2]!.trim();
              break;
            }
          }
          if (!grantedName) {
            const itemLower = sourceItem.name.trim().toLowerCase();
            if (itemLower.includes('relic of the pact')) {
              grantedName = 'Blood Sacrament';
              grantedLevel = grantedLevel || 1;
            } else if (itemLower.includes("death's oath")) {
              grantedName = 'Death Aura';
              grantedLevel = grantedLevel || 20;
            } else if (itemLower.includes('whispering ice')) {
              grantedName = 'Icestorm';
              grantedLevel = grantedLevel || 1;
            } else if (itemLower.includes("arakaali's fang")) {
              grantedName = 'Raise Spiders';
              grantedLevel = grantedLevel || 1;
            } else if (itemLower.includes("doryani's fist")) {
              grantedName = "Doryani's Touch";
              grantedLevel = grantedLevel || 20;
            }
          }
          if (grantedName) {
            const itemSkillMatched =
              matchGemId(game, undefined, grantedName, undefined, undefined) ??
              matchGemId(game, undefined, attrs.label, grantedName.replace(/\s+/g, ''), undefined);
            if (itemSkillMatched) {
              gems.push({
                instanceId: `${prefix}_g_${groupCounter}_1`,
                gemId: itemSkillMatched,
                level: grantedLevel || 20,
                quality: 0,
                enabled: true,
                fromItem: true,
                ...(game === 'poe2' ? { spiritReservationOverride: 0 } : {}),
              });
            }
          }
        }
      }
      if (gems.length > 0) {
        const parsedGroupCount = parsePositiveIntAttr(attrs.groupCount);
        if (parsedGroupCount !== undefined && parsedGroupCount > 1 && gems.length === 1 && !gems[0]!.count) {
          gems[0]!.count = parsedGroupCount;
        }
        const weaponSets = parseSkillWeaponSets(attrs, game);
        const mainActiveRaw = Number(attrs.mainActiveSkill ?? attrs.mainActiveSkillCalcs ?? 1);
        const groupSkillPart =
          parsePositiveIntAttr(attrs.skillPart) ?? parsePositiveIntAttr(attrs.skillPartCalcs);
        const groupStatSetIndex =
          parsePositiveIntAttr(attrs.statSetIndex) ??
          parsePositiveIntAttr(attrs.statSetIndexCalcs);
        const groupStageCount =
          parsePositiveIntAttr(attrs.skillStageCount) ??
          (game === 'poe2' ? parsePositiveIntAttr(attrs.skillStageCountCalcs) : undefined);
        const groupSource =
          attrs.source?.trim() || (attrs.mercenary === 'true' ? 'Mercenary' : undefined);
        const groupEnabled =
          attrs.enabled !== undefined ? attrs.enabled !== 'false' : attrs.active !== 'false';
        const groupId = `${prefix}_sg_${groupCounter}`;
        const resolvedMineCount =
          parsePositiveIntAttr(attrs.skillMineCount) ?? firstEnabledGemMineCount;
        if (resolvedMineCount !== undefined) {
          groupMineCounts.set(groupId, resolvedMineCount);
        }
        parsed.push({
          id: groupId,
          label: attrs.label || `Skill Group ${groupCounter}`,
          enabled: groupEnabled,
          ...(attrs.includeInFullDPS === 'true' ? { includeInFullDps: true } : {}),
          slot: attrs.slot as EquipmentSlotId | undefined,
          weaponSets,
          ...(Number.isFinite(mainActiveRaw) && mainActiveRaw > 1 ? { mainActiveSkillIndex: mainActiveRaw } : {}),
          ...(groupSkillPart !== undefined ? { skillPart: groupSkillPart } : {}),
          ...(groupStatSetIndex !== undefined ? { statSetIndex: groupStatSetIndex } : {}),
          ...(groupStageCount !== undefined ? { stageCount: groupStageCount } : {}),
          ...(groupSource ? { source: groupSource } : {}),
          gems,
        });
        byXmlOrdinal.set(xmlOrdinal, groupId);
        groupCounter++;
      }
    }
    return { groups: parsed, byXmlOrdinal, groupMineCounts };
  };

  const makeFallbackSkillGroup = (prefix: string): SkillGroup => {
    const fallbackGem = getGemsForGame(game)[0]!;
    return {
      id: `${prefix}_sg_1`,
      label: 'Main Skill',
      enabled: true,
      slot: game === 'poe1' ? 'Body Armour' : undefined,
      weaponSets: game === 'poe2' ? [1, 2] : undefined,
      gems: [{ instanceId: `${prefix}_g_1`, gemId: fallbackGem.id, level: 20, quality: 20, enabled: true }],
    };
  };

  const skillsSectionMatch = xml.match(/<Skills\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Skills>)/i);
  const skillsHeaderAttrs = skillsSectionMatch ? parseAttributes(skillsSectionMatch[1]!) : {};
  const skillsSectionXml = skillsSectionMatch?.[2] ?? xml;
  const requestedSkillSetId = skillsHeaderAttrs.activeSkillSet || '1';
  const skillSets: SkillSetSpec[] = [];
  const skillSetMineCounts: Map<string, number>[] = [];
  const skillSetBlockRegex = /<SkillSet\b([^>]*?)(?:\/>|>([\s\S]*?)<\/SkillSet>)/gi;
  let ssMatch: RegExpExecArray | null;
  while ((ssMatch = skillSetBlockRegex.exec(skillsSectionXml)) !== null) {
    const ssAttrs = parseAttributes(ssMatch[1]!);
    const ssInner = ssMatch[2] ?? '';
    const setId = ssAttrs.id || String(skillSets.length + 1);
    const {
      groups: parsedGroups,
      byXmlOrdinal,
      groupMineCounts,
    } = parseSkillGroupsFromBlock(ssInner, `imp_ss${setId}`);
    const setSkills = parsedGroups.length > 0 ? parsedGroups : [makeFallbackSkillGroup(`imp_ss${setId}`)];
    const resolvedMainId =
      byXmlOrdinal.get(mainSocketGroupIdx) ??
      setSkills[mainSocketGroupIdx - 1]?.id ??
      setSkills[0]!.id;
    skillSets.push({
      id: setId,
      title: ssAttrs.title || (skillSets.length === 0 ? 'Default' : `Skill Set ${skillSets.length + 1}`),
      skills: setSkills,
      mainSkillGroupId: resolvedMainId,
    });
    skillSetMineCounts.push(groupMineCounts);
  }

  let activeSkillSetIndex = 0;
  let skills: SkillGroup[];
  let mainSkillGroupId: string;
  let activeGroupMineCounts = new Map<string, number>();
  if (skillSets.length > 0) {
    activeSkillSetIndex = skillSets.findIndex((s) => s.id === requestedSkillSetId);
    if (activeSkillSetIndex < 0) {
      const numericIdx = Number(requestedSkillSetId) - 1;
      activeSkillSetIndex =
        Number.isFinite(numericIdx) && numericIdx >= 0 && numericIdx < skillSets.length ? numericIdx : 0;
    }
    const activeSkillSet = skillSets[activeSkillSetIndex]!;
    skills = activeSkillSet.skills;
    mainSkillGroupId = activeSkillSet.mainSkillGroupId ?? activeSkillSet.skills[0]!.id;
    activeGroupMineCounts = skillSetMineCounts[activeSkillSetIndex] ?? new Map<string, number>();
  } else {
    const {
      groups: parsedGroups,
      byXmlOrdinal,
      groupMineCounts,
    } = parseSkillGroupsFromBlock(xml, 'imp');
    skills = parsedGroups.length > 0 ? parsedGroups : [makeFallbackSkillGroup('imp')];
    mainSkillGroupId =
      byXmlOrdinal.get(mainSocketGroupIdx) ??
      skills[mainSocketGroupIdx - 1]?.id ??
      skills[0]!.id;
    activeGroupMineCounts = groupMineCounts;
  }

  // Parse <Config> inputs using clean official PoB defaults (`enemyIsBoss` defaults to Pinnacle in both PoB1 & PoB2!)
  const ruleset = getRuleset(game);
  const config: Build['config'] = {
    ...createDefaultConfig(),
    enemyLevel: 84,
    enemyIsBoss: 'Pinnacle',
    enemyFireResist: ruleset.defaultEnemyEleResist,
    enemyColdResist: ruleset.defaultEnemyEleResist,
    enemyLightningResist: ruleset.defaultEnemyEleResist,
    enemyChaosResist: game === 'poe1' ? 30 : 0,
    enemyArmour: game === 'poe1' ? 61989 : 8063,
    enemyEvasion: game === 'poe1' ? 10143 : 1175,
    usePowerCharges: false,
    useFrenzyCharges: false,
    useEnduranceCharges: false,
    onslaught: false,
    enemyShocked: false,
    shockValue: 0,
    enemyChilled: false,
  };
  let banditFromConfig: Build['bandit'] | undefined;
  let explicitEnemyLevel = false;
  let explicitEnemyEleRes = false;
  let explicitEnemyChaosRes = false;
  let explicitEnemyArmour = false;
  let explicitEnemyEvasion = false;
  const questCustomModLines: string[] = [...activeSpecPhreciaModLines];
  const rawInputs: Record<string, boolean | number | string> = {};
  let selfCurseCount = 0;
  const activeConfigXml = extractActiveConfigSetXml(xml);
  const inputRegex = /<(Input|Placeholder)\b([^>]*)\/?>/gi;
  let inputMatch: RegExpExecArray | null;
  while ((inputMatch = inputRegex.exec(activeConfigXml)) !== null) {
    const elemTag = inputMatch[1]!.toLowerCase();
    const attrs = parseAttributes(inputMatch[2]!);
    const key = attrs.name;
    // Official PoB <Placeholder> only stores UI placeholder hints (except WebPoB's own customMods serialization)
    if (elemTag === 'placeholder') {
      if (key === 'customMods' && attrs.string) {
        config.customMods = attrs.string;
      }
      continue;
    }
    if (key && !/^quest/i.test(key) && key !== 'customMods') {
      if (attrs.boolean !== undefined) {
        const boolVal = attrs.boolean === 'true';
        rawInputs[key] = boolVal;
        if (/^playerCursedWith/i.test(key) && boolVal) {
          selfCurseCount += 1;
        }
        if (key === 'conditionImpaledRecently' && boolVal && rawInputs.conditionImpaledEnemyRecently === undefined) {
          rawInputs.conditionImpaledEnemyRecently = true;
        }
        if (key === 'conditionAdrenaline' && boolVal && rawInputs.buffAdrenaline === undefined) {
          rawInputs.buffAdrenaline = true;
        }
      } else if (attrs.number !== undefined) {
        const parsedNum = Number(attrs.number);
        if (Number.isFinite(parsedNum)) {
          if (key === 'conditionStationary') {
            // PoB 1 ConfigOptions.lua:158-170: numeric conditionStationary sets both StationarySeconds & Condition:Stationary
            rawInputs.multiplierStationarySeconds = parsedNum;
            rawInputs.conditionStationary = parsedNum > 0;
          } else {
            rawInputs[key] = parsedNum;
            if (key === 'multiplierChannelling' && parsedNum > 0) {
              if (rawInputs.channellingTime === undefined) rawInputs.channellingTime = parsedNum;
              if (rawInputs.conditionChannelling === undefined) rawInputs.conditionChannelling = true;
            } else if (key === 'ActiveBrands' && parsedNum > 0) {
              if (rawInputs.multiplierActiveBrand === undefined) rawInputs.multiplierActiveBrand = parsedNum;
            } else if (/^playerCursedWith/i.test(key) && parsedNum > 0) {
              selfCurseCount += 1;
            }
          }
        }
      } else if (attrs.string !== undefined) {
        rawInputs[key] = attrs.string;
      }
    }
    // PoE 2 campaign quest rewards stored as <Input name="quest..." boolean="false"|string="..."/>
    // Skip legacy PoE 2 v0.1 Cruel difficulty quest rewards (removed in PoB 2 v0.3+/v0.5 Data/QuestRewards.lua)
    if (game === 'poe2' && key && /^quest/i.test(key) && !/^questAct\d+Cruel/i.test(key)) {
      if (attrs.boolean === 'false') {
        if (/clearfell/i.test(key)) questCustomModLines.push('-10% to Cold Resistance');
        else if (/freythorn|azak bog/i.test(key)) questCustomModLines.push('-30 to Spirit');
        else if (/kriar village/i.test(key)) questCustomModLines.push('-40 to Spirit');
        else if (/ogham manor/i.test(key)) questCustomModLines.push('-20 to maximum Life');
        else if (/spires of deshar/i.test(key)) questCustomModLines.push('-10% to Lightning Resistance');
        else if (/jiquani/i.test(key)) questCustomModLines.push('-10% to Fire Resistance');
        else if (/eye of hinekora.*silent hall/i.test(key)) questCustomModLines.push('5% reduced maximum Mana');
        else if (/khari crossing/i.test(key)) questCustomModLines.push('5% reduced maximum Life');
      } else if (attrs.string) {
        for (const rawQuestLine of attrs.string.split(/\r?\n/)) {
          const ql = rawQuestLine.trim();
          if (!ql) continue;
          const mCharmSlot = ql.match(/^\+(\d+)\s*Charm Slots?$/i);
          if (mCharmSlot) {
            rawInputs.__questCharmSlots =
              Number(rawInputs.__questCharmSlots ?? 0) + Number(mCharmSlot[1]);
            continue;
          }
          if (
            /^\+?100\s*(?:to\s+)?Spirit$/i.test(ql) ||
            /^\+?20\s*to maximum Life$/i.test(ql) ||
            /^5%\s*increased maximum (?:Life|Mana)$/i.test(ql) ||
            /^\+10%\s*to (?:Fire|Cold|Lightning) Resistance$/i.test(ql) ||
            /Charm Slot/i.test(ql)
          ) {
            continue;
          }
          questCustomModLines.push(ql);
        }
      }
    }
    if (key === 'bandit' && attrs.string) {
      if (attrs.string === 'None' || attrs.string === 'Alira' || attrs.string === 'Kraityn' || attrs.string === 'Oak') {
        banditFromConfig = attrs.string;
      }
    }
    if (key === 'enemyLevel' && attrs.number !== undefined) {
      config.enemyLevel = Number(attrs.number);
      explicitEnemyLevel = true;
    }
    if (key === 'enemyFireResist' && attrs.number !== undefined) {
      config.enemyFireResist = Number(attrs.number);
      explicitEnemyEleRes = true;
    }
    if (key === 'enemyColdResist' && attrs.number !== undefined) {
      config.enemyColdResist = Number(attrs.number);
      explicitEnemyEleRes = true;
    }
    if (key === 'enemyLightningResist' && attrs.number !== undefined) {
      config.enemyLightningResist = Number(attrs.number);
      explicitEnemyEleRes = true;
    }
    if (key === 'enemyChaosResist' && attrs.number !== undefined) {
      config.enemyChaosResist = Number(attrs.number);
      explicitEnemyChaosRes = true;
    }
    if (key === 'enemyArmour' && attrs.number !== undefined) {
      config.enemyArmour = Number(attrs.number);
      explicitEnemyArmour = true;
    }
    if (key === 'enemyEvasion' && attrs.number !== undefined) {
      config.enemyEvasion = Number(attrs.number);
      explicitEnemyEvasion = true;
    }
    if (key === 'enemyIsBoss' && attrs.string) {
      const normalizedBoss = attrs.string.trim().toLowerCase();
      if (normalizedBoss === 'none') {
        config.enemyIsBoss = 'None';
      } else if (normalizedBoss === 'guardian' || normalizedBoss === 'boss') {
        config.enemyIsBoss = 'Guardian';
      } else if (
        normalizedBoss === 'pinnacle' ||
        normalizedBoss === 'uber' ||
        normalizedBoss === 'shaper' ||
        normalizedBoss === 'sirus'
      ) {
        config.enemyIsBoss = 'Pinnacle';
      }
      if (normalizedBoss === 'uber') {
        rawInputs.__enemyIsUber = true;
      }
    }
    if (key === 'usePowerCharges' && attrs.boolean) config.usePowerCharges = attrs.boolean === 'true';
    if (key === 'powerCharges' && attrs.number) config.powerCharges = Number(attrs.number);
    if (key === 'useFrenzyCharges' && attrs.boolean) config.useFrenzyCharges = attrs.boolean === 'true';
    if (key === 'frenzyCharges' && attrs.number) config.frenzyCharges = Number(attrs.number);
    if (key === 'useEnduranceCharges' && attrs.boolean) config.useEnduranceCharges = attrs.boolean === 'true';
    if (key === 'enduranceCharges' && attrs.number) config.enduranceCharges = Number(attrs.number);
    if ((key === 'onslaught' || key === 'buffOnslaught') && attrs.boolean) config.onslaught = attrs.boolean === 'true';
    if ((key === 'enemyShocked' || key === 'conditionEnemyShocked') && attrs.boolean) {
      config.enemyShocked = attrs.boolean === 'true';
    }
    if ((key === 'shockValue' || key === 'conditionShockEffect') && attrs.number) {
      config.shockValue = Number(attrs.number);
    }
    if ((key === 'enemyChilled' || key === 'conditionEnemyChilled') && attrs.boolean) {
      config.enemyChilled = attrs.boolean === 'true';
    }
    if (key === 'conditionLowLife' && attrs.boolean) config.conditionLowLife = attrs.boolean === 'true';
    if (key === 'conditionFullLife' && attrs.boolean) config.conditionFullLife = attrs.boolean === 'true';
    if (key === 'buffArcaneSurge' && attrs.boolean) config.buffArcaneSurge = attrs.boolean === 'true';
    if (key === 'buffTailwind' && attrs.boolean) config.buffTailwind = attrs.boolean === 'true';
    if (key === 'conditionEnemyIntimidated' && attrs.boolean) config.enemyIntimidated = attrs.boolean === 'true';
    if (key === 'conditionEnemyUnnerved' && attrs.boolean) config.enemyUnnerved = attrs.boolean === 'true';
    if (key === 'conditionEnemyBlinded' && attrs.boolean) config.enemyBlinded = attrs.boolean === 'true';
    if (key === 'conditionEnemyTaunted' && attrs.boolean) config.enemyTaunted = attrs.boolean === 'true';
    if (key === 'multiplierWitheredStackCount' && attrs.number) config.witheredStacks = Number(attrs.number);
    if (key === 'conditionEnemyFireExposure' && attrs.boolean) config.enemyFireExposure = attrs.boolean === 'true';
    if (key === 'conditionEnemyColdExposure' && attrs.boolean) config.enemyColdExposure = attrs.boolean === 'true';
    if (key === 'conditionEnemyLightningExposure' && attrs.boolean) config.enemyLightningExposure = attrs.boolean === 'true';
    if (key === 'multiplierRage' && attrs.number) config.rage = Number(attrs.number);
    if (key === 'buffFortification' && attrs.boolean) config.fortified = attrs.boolean === 'true';
    if (key === 'overrideFortification' && attrs.number) config.fortificationStacks = Number(attrs.number);
    if (key === 'activeGuardSkill' && attrs.string) {
      if (
        attrs.string === 'None' ||
        attrs.string === 'MoltenShell' ||
        attrs.string === 'Steelskin' ||
        attrs.string === 'ArcaneCloak'
      ) {
        config.activeGuardSkill = attrs.string;
      }
    }
    if ((key === 'pantheonMajorGod' || key === 'pantheonMajor') && attrs.string) {
      const normalized = attrs.string.replace(/^The/, '');
      if (
        normalized === 'None' ||
        normalized === 'BrineKing' ||
        normalized === 'Lunaris' ||
        normalized === 'Solaris' ||
        normalized === 'Arakaali'
      ) {
        config.pantheonMajor = normalized;
      }
    }
    if ((key === 'pantheonMinorGod' || key === 'pantheonMinor') && attrs.string) {
      if (
        attrs.string === 'None' ||
        attrs.string === 'Abberath' ||
        attrs.string === 'Gruthkul' ||
        attrs.string === 'Ralakesh' ||
        attrs.string === 'Shakari' ||
        attrs.string === 'Tukohama' ||
        attrs.string === 'Garukhan'
      ) {
        config.pantheonMinor = attrs.string;
      }
    }
    if (key === 'customMods' && attrs.string) config.customMods = attrs.string;
  }
  const customModifierBlocks = extractCustomModifierBlocks(activeConfigXml);
  const customModParts: string[] = [];
  if (config.customMods.trim()) {
    customModParts.push(config.customMods.trim());
  }
  for (const block of customModifierBlocks) {
    if (!customModParts.includes(block)) {
      customModParts.push(block);
    }
  }
  for (const qLine of questCustomModLines) {
    customModParts.push(qLine);
  }
  if (customModParts.length > 0) {
    config.customMods = customModParts.join('\n');
  }
  // Apply PoB default enemy resistances when enemyIsBoss was explicitly set to None or Boss/Guardian without manual enemy*Resist
  if (!explicitEnemyEleRes) {
    if (config.enemyIsBoss === 'None') {
      const normalEleRes = 0;
      config.enemyFireResist = normalEleRes;
      config.enemyColdResist = normalEleRes;
      config.enemyLightningResist = normalEleRes;
    } else if (config.enemyIsBoss === 'Guardian') {
      const bossEleRes = game === 'poe2' ? 30 : 40;
      config.enemyFireResist = bossEleRes;
      config.enemyColdResist = bossEleRes;
      config.enemyLightningResist = bossEleRes;
    }
  }
  if (!explicitEnemyChaosRes) {
    if (config.enemyIsBoss === 'None') {
      config.enemyChaosResist = 0;
    } else if (config.enemyIsBoss === 'Guardian') {
      config.enemyChaosResist = game === 'poe2' ? 0 : 25;
    }
  }
  // Resolve default enemyLevel per official PoB 1 (`CalcSetup.lua:523`) & PoB 2 (`ConfigOptions.lua:1987-2123`):
  // - PoE 2 Pinnacle/Uber Bosses default to level 82 (minimum 82); Normal/Standard Bosses default to min(85, charLevel).
  // - PoE 1 Pinnacle/Uber Bosses default to level 84; Normal/Guardian Bosses default to min(84, charLevel).
  if (!explicitEnemyLevel) {
    if (game === 'poe2') {
      config.enemyLevel =
        config.enemyIsBoss === 'Pinnacle' ? 82 : Math.min(85, Math.max(1, level));
    } else {
      config.enemyLevel =
        config.enemyIsBoss === 'Pinnacle' ? 84 : Math.min(84, Math.max(1, level));
    }
  }
  // Scale PoE 2 default enemy evasion & armour by `enemyLevel` & boss tier per official PoB2 `ConfigOptions.lua` & `Data/Bosses.lua`
  if (game === 'poe2') {
    const POE2_MONSTER_EVASION: readonly number[] = [
      24, 30, 36, 43, 49, 56, 63, 70, 77, 84, 91, 98, 105, 113, 120, 128, 136, 144, 152, 160,
      168, 176, 185, 193, 202, 211, 220, 229, 238, 247, 257, 266, 276, 286, 296, 306, 316, 326, 337, 347,
      358, 369, 380, 391, 403, 414, 426, 438, 449, 462, 474, 486, 499, 511, 524, 537, 551, 564, 578, 591,
      605, 619, 634, 648, 663, 677, 692, 708, 723, 738, 754, 770, 786, 803, 819, 836, 853, 870, 887, 905,
      923, 941, 959, 977, 996, 1015, 1034, 1053, 1073, 1093, 1113, 1133, 1154, 1174, 1195, 1217, 1238, 1260, 1282, 1304,
    ];
    const POE2_MONSTER_ARMOUR: readonly number[] = [
      3, 6, 8, 10, 13, 16, 19, 22, 26, 30, 34, 39, 43, 49, 54, 60, 67, 73, 81, 89,
      97, 106, 116, 126, 137, 149, 161, 174, 189, 204, 220, 237, 255, 274, 295, 317, 340, 364, 391, 418,
      448, 479, 512, 547, 585, 624, 666, 711, 758, 808, 861, 917, 976, 1039, 1105, 1176, 1250, 1329, 1412, 1500,
      1594, 1692, 1796, 1906, 2023, 2146, 2276, 2413, 2558, 2712, 2874, 3044, 3225, 3416, 3617, 3829, 4053, 4290, 4540, 4803,
      5081, 5375, 5684, 6011, 6355, 6718, 7101, 7505, 7930, 8379, 8852, 9351, 9877, 10431, 11015, 11630, 12279, 12962, 13682, 14441,
    ];
    const isUber = Boolean(rawInputs.__enemyIsUber);
    const effectiveTableLevel =
      config.enemyIsBoss === 'Pinnacle' ? Math.max(82, config.enemyLevel) : config.enemyLevel;
    const lvIdx = Math.max(0, Math.min(99, Math.round(effectiveTableLevel) - 1));
    // Exact PoB 2 `Data/Bosses.lua` means: PinnacleArmourMean=150%, PinnacleEvasionMean=124.9091%,
    // UberArmourMean=125%, UberEvasionMean=116.5714%; None / Standard Boss use 100% monster table.
    const armMult = config.enemyIsBoss === 'Pinnacle' ? (isUber ? 1.25 : 1.5) : 1;
    const evaMult =
      config.enemyIsBoss === 'Pinnacle'
        ? (isUber ? 116.57142857142857 : 124.9090909090909) / 100
        : 1;
    if (!explicitEnemyEvasion) {
      config.enemyEvasion = Math.round(POE2_MONSTER_EVASION[lvIdx]! * evaMult);
    }
    if (!explicitEnemyArmour) {
      config.enemyArmour = Math.round(POE2_MONSTER_ARMOUR[lvIdx]! * armMult);
    }
  }

  // Parse optional PoB <Party><ImportedBuffs> aurabot / party buffs
  const partyMatch = xml.match(/<Party\b([^>]*)>([\s\S]*?)<\/Party>/i);
  if (partyMatch) {
    const partyAttrs = parseAttributes(partyMatch[1]!);
    const dest = (partyAttrs.destination ?? 'All').trim().toLowerCase();
    if (dest !== 'none') {
      const importedMods: Mod[] = [];
      const ibRegex = /<ImportedBuffs\b([^>]*)>([\s\S]*?)<\/ImportedBuffs>/gi;
      let ibMatch: RegExpExecArray | null;
      while ((ibMatch = ibRegex.exec(partyMatch[2]!)) !== null) {
        const ibAttrs = parseAttributes(ibMatch[1]!);
        const bufName = (ibAttrs.name ?? '').trim();
        if (dest !== 'all' && dest !== bufName.toLowerCase()) continue;
        const target: Mod['target'] =
          bufName === 'Curse' || bufName === 'EnemyMods' || bufName === 'EnemyConditions'
            ? 'enemy'
            : 'player';
        const rawBuf = unescapeXml(ibMatch[2] ?? '');
        const isStructuredSection =
          bufName === 'Aura' ||
          bufName === 'Curse' ||
          bufName === 'Warcry Skills' ||
          bufName === 'Link Skills';
        let sectionMode: 'CurseLimit' | 'Name' | 'Effect' | 'isMark' | 'Stats' =
          bufName === 'Curse' ? 'CurseLimit' : isStructuredSection ? 'Name' : 'Stats';
        let currentName = '';
        let currentEffectPct = 100;
        let currentModType = '';
        const seenAuraEffects = new Map<string, number>();

        for (const rawLine of rawBuf.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line) continue;
          if (isStructuredSection) {
            if (line !== '---' && line.includes('---')) {
              continue;
            }
            if (line === '---') {
              sectionMode = 'Name';
              continue;
            }
            if (sectionMode === 'CurseLimit') {
              sectionMode = 'Name';
              continue;
            }
            if (sectionMode === 'Name') {
              currentName = line.replace(/_Debuff$/, '');
              currentEffectPct = 100;
              if (line === 'extraAura' || line === 'otherEffects') {
                currentModType = line;
                sectionMode = 'Stats';
              } else {
                currentModType = '';
                sectionMode = 'Effect';
              }
              continue;
            }
            if (sectionMode === 'Effect') {
              const eff = Number(line);
              currentEffectPct = Number.isFinite(eff) ? eff : 100;
              const prevEff = seenAuraEffects.get(currentName);
              if (prevEff !== undefined && prevEff >= currentEffectPct) {
                currentName = '__SKIP__';
              } else {
                seenAuraEffects.set(currentName, currentEffectPct);
                if (bufName === 'Aura' && currentName && !currentName.startsWith('__')) {
                  importedMods.push({
                    name: `AffectedBy${currentName.replace(/\s+/g, '')}`,
                    type: 'FLAG',
                    value: true,
                    flags: 0,
                    keywordFlags: 0,
                    source: `Party (Aura): ${currentName}`,
                    target: 'player',
                  });
                }
              }
              sectionMode = bufName === 'Curse' ? 'isMark' : 'Stats';
              continue;
            }
            if (sectionMode === 'isMark') {
              sectionMode = 'Stats';
              continue;
            }
          }
          if (currentName === '__SKIP__' || !line.includes('|') || line.includes('MinionModifier|LIST')) {
            continue;
          }
          let modLine = line;
          let lineEffectPct = currentEffectPct;
          if (currentModType === 'otherEffects') {
            const firstPipe = line.indexOf('|');
            const secondPipe = firstPipe > 0 ? line.indexOf('|', firstPipe + 1) : -1;
            if (secondPipe > 0) {
              const parsedEff = Number(line.slice(firstPipe + 1, secondPipe));
              lineEffectPct = Number.isFinite(parsedEff) ? parsedEff : 100;
              modLine = line.slice(secondPipe + 1);
            }
          }
          const parts = modLine.split('|');
          if (parts.length < 6) continue;
          const [valStr, srcStr, statName, modTypeStr, flagsStr, kwFlagsStr, tagsStr] = parts;
          if (!statName || !modTypeStr) continue;
          if (modTypeStr !== 'BASE' && modTypeStr !== 'INC' && modTypeStr !== 'MORE' && modTypeStr !== 'FLAG' && modTypeStr !== 'OVERRIDE') {
            continue;
          }
          let value: number | boolean | string =
            modTypeStr === 'FLAG' ? valStr === 'true' || valStr === '1' : Number(valStr);
          if (typeof value === 'number') {
            if (!Number.isFinite(value)) continue;
            if (
              isStructuredSection &&
              currentModType !== 'extraAura' &&
              lineEffectPct !== 100 &&
              (modTypeStr === 'BASE' || modTypeStr === 'INC' || modTypeStr === 'MORE')
            ) {
              const scaled = value * (lineEffectPct / 100);
              value =
                statName === 'LifeRegen' || statName === 'ManaRegen'
                  ? Math.round(scaled * 100) / 100
                  : Math.trunc(scaled + Math.sign(scaled) * 1e-9);
            }
          }
          const parseNamedBitmask = (
            rawMask: string | undefined,
            table: Record<string, number>,
          ): number => {
            if (!rawMask || rawMask === '-') return 0;
            const asNum = Number(rawMask);
            if (!Number.isNaN(asNum)) return asNum;
            let mask = 0;
            for (const tok of rawMask.split(/[,|+/]/)) {
              const k = tok.trim().toLowerCase();
              if (k && table[k] !== undefined) mask |= table[k]!;
            }
            return mask;
          };
          const flags = parseNamedBitmask(flagsStr, {
            attack: ModFlag.Attack,
            spell: ModFlag.Spell,
            cast: ModFlag.Cast,
            hit: ModFlag.Hit,
            dot: ModFlag.Dot,
            melee: ModFlag.Melee,
            area: ModFlag.Area,
            projectile: ModFlag.Projectile,
            ailment: ModFlag.Ailment,
            weapon: ModFlag.Attack,
            bow: ModFlag.Bow,
            wand: ModFlag.Wand,
          });
          const keywordFlags = parseNamedBitmask(kwFlagsStr, {
            aura: KeywordFlag.Aura,
            curse: KeywordFlag.Curse,
            warcry: KeywordFlag.Warcry,
            spell: KeywordFlag.Spell,
            attack: KeywordFlag.Attack,
            physical: KeywordFlag.Physical,
            fire: KeywordFlag.Fire,
            cold: KeywordFlag.Cold,
            lightning: KeywordFlag.Lightning,
            chaos: KeywordFlag.Chaos,
            hit: KeywordFlag.Hit,
            ailment: KeywordFlag.Ailment,
            bleed: KeywordFlag.Bleed,
            ignite: KeywordFlag.Ignite,
            poison: KeywordFlag.Poison,
          });
          const tags: ModTag[] = [];
          if (tagsStr && tagsStr !== '-') {
            for (const rawTag of tagsStr.split(',')) {
              const kv: Record<string, string> = {};
              for (const seg of rawTag.split('/')) {
                const eqIdx = seg.indexOf('=');
                if (eqIdx > 0) {
                  kv[seg.slice(0, eqIdx)] = seg.slice(eqIdx + 1);
                }
              }
              if (kv.type === 'Condition' && kv.var) {
                tags.push({
                  type: 'Condition',
                  var: kv.var,
                  ...(kv.neg === 'true' ? { neg: true } : {}),
                });
              } else if (kv.type === 'Multiplier' && kv.var) {
                tags.push({
                  type: 'Multiplier',
                  var: kv.var,
                  ...(kv.limit ? { limit: Number(kv.limit) } : {}),
                  ...(kv.base ? { base: Number(kv.base) } : {}),
                });
              } else if (kv.type === 'PerStat' && kv.stat) {
                tags.push({
                  type: 'PerStat',
                  stat: kv.stat,
                  div: Number(kv.div ?? 1) || 1,
                  ...(kv.limit ? { limit: Number(kv.limit) } : {}),
                });
              } else if (kv.type === 'SkillType' && kv.skillType) {
                tags.push({
                  type: 'SkillType',
                  skillType: kv.skillType,
                  ...(kv.neg === 'true' ? { neg: true } : {}),
                });
              }
            }
          }
          importedMods.push({
            name: statName,
            type: modTypeStr as ModType,
            value,
            flags,
            keywordFlags,
            source: `Party (${bufName}): ${srcStr || 'Buff'}`,
            target,
            ...(tags.length > 0 ? { tags } : {}),
          });
          if (statName === 'Condition:ChampionIntimidate' && value === true) {
            importedMods.push({
              name: 'DamageTaken',
              type: 'INC',
              value: 20,
              flags: 0,
              keywordFlags: 0,
              source: 'Party: Worthy Foe (Champion)',
              target: 'enemy',
            });
          }
        }
      }
      if (importedMods.length > 0) {
        config.importedPartyMods = importedMods;
      }
    }
  }

  if (selfCurseCount > 0) {
    if (rawInputs.multiplierCurseOnSelf === undefined) {
      rawInputs.multiplierCurseOnSelf = selfCurseCount;
    }
    if (rawInputs.conditionCursed === undefined) {
      rawInputs.conditionCursed = true;
    }
  }
  const mainMineCount = activeGroupMineCounts.get(mainSkillGroupId);
  if (
    mainMineCount !== undefined &&
    rawInputs.activeMineCount === undefined &&
    rawInputs.multiplierActiveMines === undefined
  ) {
    rawInputs.activeMineCount = mainMineCount;
    rawInputs.multiplierActiveMines = mainMineCount;
  }

  if (game === 'poe1') {
    for (const fSlot of ['Flask 1', 'Flask 2', 'Flask 3', 'Flask 4', 'Flask 5'] as const) {
      const fItemId = equipped[fSlot];
      const fItem = fItemId ? items[fItemId] : undefined;
      const base = fItem?.baseName?.trim().toLowerCase() ?? '';
      if (base === 'diamond flask' && rawInputs.conditionHaveDiamondFlask === undefined) {
        rawInputs.conditionHaveDiamondFlask = true;
      } else if (base === 'bismuth flask' && rawInputs.conditionHaveBismuthFlask === undefined) {
        rawInputs.conditionHaveBismuthFlask = true;
      } else if (base === 'amethyst flask' && rawInputs.conditionHaveAmethystFlask === undefined) {
        rawInputs.conditionHaveAmethystFlask = true;
      }
    }
  }

  if (Object.keys(rawInputs).length > 0) {
    config.rawInputs = rawInputs;
  }

  // Parse <Notes>
  const notesMatch = xml.match(/<Notes>([\s\S]*?)<\/Notes>/i);
  const notes = notesMatch ? unescapeXml(notesMatch[1]!).trim() : '';

  return {
    id: `imported_${Date.now()}`,
    name: buildAttrs.buildName || `${classDef.name.en} (Lv.${level})`,
    game,
    level,
    classId: classDef.id,
    ascendancyId,
    activeWeaponSet,
    bandit: banditFromConfig ?? (buildAttrs.bandit as Build['bandit']) ?? 'None',
    tree: activeTreeSpec,
    ...(treeSpecs.length > 1 ? { treeSpecs, activeTreeSpecIndex } : {}),
    skills,
    mainSkillGroupId,
    ...(skillSets.length > 1 ? { skillSets, activeSkillSetIndex } : {}),
    items,
    equipped,
    ...(Object.keys(activeFlaskSlots).length > 0 ? { activeFlaskSlots } : {}),
    ...(itemSets.length > 1 ? { itemSets, activeItemSetIndex } : {}),
    config,
    notes,
  };
}

/**
 * Convenience function: decodes a PoB share code (or raw XML) directly into a `Build`.
 */
export function importBuildFromCode(input: string): { build: Build; xml: string } {
  const trimmed = input.trim();
  const xml = trimmed.startsWith('<') ? trimmed : decodePobCodeToXml(trimmed);
  const build = xmlToBuild(xml);
  return { build, xml };
}

export interface PoeNinjaCharacterUrlInfo {
  game: GameId;
  league: string;
  account: string;
  character: string;
}

/**
 * Detects a `poe.ninja` character detail webpage URL (PoE 1 or PoE 2),
 * e.g. `https://poe.ninja/poe2/builds/forbiddenrites/character/brazwv-1435/ArkkFR`.
 */
export function parsePoeNinjaCharacterUrl(inputUrl: string): PoeNinjaCharacterUrlInfo | null {
  const trimmed = inputUrl.trim();
  const match = trimmed.match(
    /^https?:\/\/(?:www\.)?poe\.ninja\/(?:(poe[12])\/)?builds\/([^/?#]+)\/character\/([^/?#]+)\/([^/?#]+)/i,
  );
  if (!match) return null;
  const game: GameId = match[1]?.toLowerCase() === 'poe2' ? 'poe2' : 'poe1';
  return {
    game,
    league: decodeURIComponent(match[2]!),
    account: decodeURIComponent(match[3]!),
    character: decodeURIComponent(match[4]!),
  };
}

/**
 * Resolves `pobb.in`, `poe.ninja` (PoE 1 & PoE 2), `maxroll.gg` (PoE 1 & PoE 2), and `pastebin.com`
 * share URLs to their raw PoB code endpoints.
 */
export function resolveShareUrl(inputUrl: string): string | null {
  const trimmed = inputUrl.trim();
  const pobbin = trimmed.match(/^https?:\/\/(?:www\.)?pobb\.in\/([A-Za-z0-9_-]+)/i);
  if (pobbin) {
    return `https://pobb.in/${pobbin[1]}/raw`;
  }
  const ninja = trimmed.match(/^https?:\/\/(?:www\.)?poe\.ninja\/(?:(poe[12])\/)?pob\/(?:raw\/)?([A-Za-z0-9_-]+)/i);
  if (ninja) {
    const gamePath = ninja[1] ? `${ninja[1].toLowerCase()}/` : '';
    return `https://poe.ninja/${gamePath}pob/raw/${ninja[2]}`;
  }
  const maxroll = trimmed.match(
    /^https?:\/\/(?:www\.)?maxroll\.gg\/(poe2?|poe1)\/(?:api\/)?pob\/([A-Za-z0-9_-]+)/i,
  );
  if (maxroll) {
    const gamePath = maxroll[1]!.toLowerCase() === 'poe2' ? 'poe2' : 'poe';
    return `https://maxroll.gg/${gamePath}/api/pob/${maxroll[2]}`;
  }
  const pastebin = trimmed.match(/^https?:\/\/(?:www\.)?pastebin\.com\/(?:raw\/)?([A-Za-z0-9]+)/i);
  if (pastebin) {
    return `https://pastebin.com/raw/${pastebin[1]}`;
  }
  return null;
}

/**
 * Fetches a PoB code from a `pobb.in`, `poe.ninja`, `maxroll.gg`, or `pastebin.com` URL, optionally routing through
 * a lightweight CORS proxy (e.g. `https://proxy.example.workers.dev/?url=...`).
 */
export async function fetchRemoteBuildCode(url: string, corsProxyBase?: string): Promise<string> {
  const ninjaChar = parsePoeNinjaCharacterUrl(url);
  if (ninjaChar) {
    const exampleLink = ninjaChar.game === 'poe2' ? 'poe.ninja/poe2/pob/xxxx' : 'poe.ninja/poe1/pob/xxxx';
    throw new Error(
      `poe.ninja character webpage (${ninjaChar.game.toUpperCase()} · ${ninjaChar.character}) cannot be fetched directly because poe.ninja protects character pages behind Cloudflare. Click "Copy PoB code" on that page and paste the PoB code or ${exampleLink} link instead.`,
    );
  }
  const rawEndpoint = resolveShareUrl(url) ?? url.trim();
  const target = corsProxyBase?.trim()
    ? `${corsProxyBase.replace(/\/+$/, '')}/?url=${encodeURIComponent(rawEndpoint)}`
    : rawEndpoint;
  const response = await fetch(target);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${rawEndpoint}`);
  }
  const text = (await response.text()).trim();
  if (/^(?:<!doctype\s+html\b|<html\b)/i.test(text)) {
    throw new Error(
      `The URL returned an HTML webpage instead of a raw PoB share code (${rawEndpoint}). Please paste a raw PoB code or a supported share link (pobb.in / poe.ninja/pob / maxroll.gg / WeGame).`,
    );
  }
  return text;
}
