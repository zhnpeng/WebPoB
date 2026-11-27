import { deflate, inflate } from 'pako';
import type {
  Build,
  EquipmentSlotId,
  GameId,
  GemInstance,
  Item,
  ItemSetSpec,
  SkillGroup,
  SkillSetSpec,
  TreeSpec,
  WeaponSetId,
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

const POE2_CLASS_TO_NUM: Record<string, number> = {
  Witch: 1,
  Ranger: 2,
  Warrior: 6,
  Sorceress: 7,
  Huntress: 8,
  Mercenary: 9,
  Monk: 10,
  Druid: 11,
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
  const classNum =
    build.game === 'poe2'
      ? (POE2_CLASS_TO_NUM[build.classId] ?? 6)
      : (POE1_CLASS_TO_NUM[build.classId] ?? 3);
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
        `    <Spec title="${escapeXml(spec.title)}" treeVersion="${escapeXml(spec.treeVersion)}" classId="${classNum}" ascendClassId="0" nodes="${nodesStr}"${wsAttrs}${masteryAttr}>`,
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
        `    <Spec title="${escapeXml(spec.title)}" treeVersion="${escapeXml(spec.treeVersion)}" classId="${classNum}" ascendClassId="0" nodes="${nodesStr}"${wsAttrs}${masteryAttr} />`,
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
      lines.push(
        `      <Skill enabled="${group.enabled}" mainActiveSkill="${mainActive}" mainActiveSkillCalcs="${mainActive}"${fullDpsAttr} label="${escapeXml(group.label)}"${slotAttr}${wsAttr}${poe2SetAttrs}>`,
      );
      for (const gem of group.gems) {
        const def = gemsCatalog.find((g) => g.id === gem.gemId);
        const nameSpec = def ? def.name.en.replace(/\s+Support$/i, '') : gem.gemId;
        const countAttr = gem.count && gem.count > 1 ? ` count="${gem.count}"` : '';
        lines.push(
          `        <Gem gemId="${escapeXml(gem.gemId)}" nameSpec="${escapeXml(nameSpec)}" level="${gem.level}" quality="${gem.quality}" enabled="${gem.enabled}"${countAttr} />`,
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

  // Parse <Items activeItemSet="..."> & all <ItemSet> blocks
  const itemsHeaderMatch = xml.match(/<Items\b([^>]*)>/i);
  const itemsHeaderAttrs = itemsHeaderMatch ? parseAttributes(itemsHeaderMatch[1]!) : {};
  const requestedItemSetId = itemsHeaderAttrs.activeItemSet || '1';
  const itemSets: ItemSetSpec[] = [];
  const itemSetWsFlags: boolean[] = [];
  const itemSetBlockRegex = /<ItemSet\b([^>]*?)(?:\/>|>([\s\S]*?)<\/ItemSet>)/gi;
  let isMatch: RegExpExecArray | null;
  while ((isMatch = itemSetBlockRegex.exec(xml)) !== null) {
    const isAttrs = parseAttributes(isMatch[1]!);
    const isInner = isMatch[2] ?? '';
    const eq: Partial<Record<EquipmentSlotId, string>> = {};
    const fl: Partial<Record<EquipmentSlotId, boolean>> = {};
    const slotRegex = /<Slot\b([^>]*)\/?>/gi;
    let slotMatch: RegExpExecArray | null;
    while ((slotMatch = slotRegex.exec(isInner)) !== null) {
      const attrs = parseAttributes(slotMatch[1]!);
      const slotName = attrs.name as EquipmentSlotId | undefined;
      const itemId = attrs.itemId ? numIdToItemId.get(attrs.itemId) : undefined;
      if (slotName && itemId) {
        eq[slotName] = itemId;
        if (slotName.startsWith('Flask ') && attrs.active === 'true') {
          fl[slotName] = true;
        }
      }
    }
    itemSets.push({
      id: isAttrs.id || String(itemSets.length + 1),
      title: isAttrs.title || (itemSets.length === 0 ? 'Default' : `Set ${itemSets.length + 1}`),
      equipped: eq,
      ...(Object.keys(fl).length > 0 ? { activeFlaskSlots: fl } : {}),
    });
    itemSetWsFlags.push(isAttrs.useSecondWeaponSet === 'true');
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
    buildAttrs.activeWeaponSet === '2' || itemSetWsFlags[activeItemSetIndex] ? 2 : 1;

  // Parse <Tree activeSpec="..."> & ALL <Spec> elements (supports PoB multi-spec trees!)
  const tree = getTreeForGame(game);
  const startNodeId = tree.classStartNodeIds[classDef.id];
  const treeHeaderMatch = xml.match(/<Tree\b([^>]*)>/i);
  const treeHeaderAttrs = treeHeaderMatch ? parseAttributes(treeHeaderMatch[1]!) : {};
  const requestedSpecIdx = Math.max(1, Number(treeHeaderAttrs.activeSpec ?? 1) || 1) - 1;

  const treeSpecs: TreeSpec[] = [];
  const specBlockRegex = /<Spec\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Spec>)/gi;
  let spMatch: RegExpExecArray | null;
  while ((spMatch = specBlockRegex.exec(xml)) !== null) {
    const specAttrs = parseAttributes(spMatch[1]!);
    const specInner = spMatch[2] ?? '';
    const ws1ChildMatch = specInner.match(/<WeaponSet1\b[^>]*\bnodes="([^"]*)"/i);
    const ws2ChildMatch = specInner.match(/<WeaponSet2\b[^>]*\bnodes="([^"]*)"/i);
    const weaponSet1NodeIds = parseNodeList(ws1ChildMatch?.[1] ?? specAttrs.weaponSet1Nodes).filter((id) =>
      Boolean(tree.nodes[id]),
    );
    const weaponSet2NodeIds = parseNodeList(ws2ChildMatch?.[1] ?? specAttrs.weaponSet2Nodes).filter((id) =>
      Boolean(tree.nodes[id]),
    );
    const wsExclusiveSet = new Set<number>([...weaponSet1NodeIds, ...weaponSet2NodeIds]);
    let allocatedNodeIds = parseNodeList(specAttrs.nodes).filter(
      (id) => Boolean(tree.nodes[id]) && !wsExclusiveSet.has(id),
    );
    if (startNodeId && !allocatedNodeIds.includes(startNodeId)) {
      allocatedNodeIds = [startNodeId, ...allocatedNodeIds];
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
    const masteryEffects = parseMasteryEffectsAttr(specAttrs.masteryEffects, tree);
    const specNodeOverrides = parseNodeOverrides(specInner);
    treeSpecs.push({
      title: specAttrs.title || (treeSpecs.length === 0 ? 'Default' : `Spec ${treeSpecs.length + 1}`),
      treeVersion: specAttrs.treeVersion || tree.version,
      allocatedNodeIds,
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
  }
  if (treeSpecs.length === 0) {
    treeSpecs.push({
      title: 'Default',
      treeVersion: tree.version,
      allocatedNodeIds: startNodeId ? [startNodeId] : [],
      weaponSet1NodeIds: [],
      weaponSet2NodeIds: [],
      masteryEffects: {},
    });
  }
  const activeTreeSpecIndex = Math.max(0, Math.min(treeSpecs.length - 1, requestedSpecIdx));
  const activeTreeSpec = treeSpecs[activeTreeSpecIndex]!;

  // Parse <Skills activeSkillSet="..."> & all <SkillSet> blocks
  const parseSkillGroupsFromBlock = (blockXml: string, prefix: string): SkillGroup[] => {
    const parsed: SkillGroup[] = [];
    const skillRegex = /<Skill\b([^>]*)>([\s\S]*?)<\/Skill>/gi;
    let skillMatch: RegExpExecArray | null;
    let groupCounter = 1;
    while ((skillMatch = skillRegex.exec(blockXml)) !== null) {
      const attrs = parseAttributes(skillMatch[1]!);
      const inner = skillMatch[2]!;
      const gems: GemInstance[] = [];
      const gemRegex = /<Gem\b([^>]*)\/?>/gi;
      let gemMatch: RegExpExecArray | null;
      let gemCounter = 1;
      while ((gemMatch = gemRegex.exec(inner)) !== null) {
        const gAttrs = parseAttributes(gemMatch[1]!);
        const matchedId = matchGemId(
          game,
          gAttrs.gemId,
          gAttrs.nameSpec,
          gAttrs.skillId,
          gAttrs.variantId,
        );
        if (matchedId) {
          const parsedCount = Number(gAttrs.count ?? 1);
          gems.push({
            instanceId: `${prefix}_g_${groupCounter}_${gemCounter++}`,
            gemId: matchedId,
            level: Number(gAttrs.level ?? 20) || 20,
            quality: Number(gAttrs.quality ?? 0) || 0,
            enabled: gAttrs.enabled !== 'false',
            ...(Number.isFinite(parsedCount) && parsedCount > 1 ? { count: Math.round(parsedCount) } : {}),
          });
        }
      }
      if (gems.length > 0) {
        const weaponSets = parseSkillWeaponSets(attrs, game);
        const mainActiveRaw = Number(attrs.mainActiveSkill ?? attrs.mainActiveSkillCalcs ?? 1);
        const groupEnabled =
          attrs.enabled !== undefined ? attrs.enabled !== 'false' : attrs.active !== 'false';
        parsed.push({
          id: `${prefix}_sg_${groupCounter}`,
          label: attrs.label || `Skill Group ${groupCounter}`,
          enabled: groupEnabled,
          ...(attrs.includeInFullDPS === 'true' ? { includeInFullDps: true } : {}),
          slot: attrs.slot as EquipmentSlotId | undefined,
          weaponSets,
          ...(Number.isFinite(mainActiveRaw) && mainActiveRaw > 1 ? { mainActiveSkillIndex: mainActiveRaw } : {}),
          gems,
        });
        groupCounter++;
      }
    }
    return parsed;
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

  const skillsHeaderMatch = xml.match(/<Skills\b([^>]*)>/i);
  const skillsHeaderAttrs = skillsHeaderMatch ? parseAttributes(skillsHeaderMatch[1]!) : {};
  const requestedSkillSetId = skillsHeaderAttrs.activeSkillSet || '1';
  const skillSets: SkillSetSpec[] = [];
  const skillSetBlockRegex = /<SkillSet\b([^>]*?)(?:\/>|>([\s\S]*?)<\/SkillSet>)/gi;
  let ssMatch: RegExpExecArray | null;
  while ((ssMatch = skillSetBlockRegex.exec(xml)) !== null) {
    const ssAttrs = parseAttributes(ssMatch[1]!);
    const ssInner = ssMatch[2] ?? '';
    const setId = ssAttrs.id || String(skillSets.length + 1);
    const parsedGroups = parseSkillGroupsFromBlock(ssInner, `imp_ss${setId}`);
    const setSkills = parsedGroups.length > 0 ? parsedGroups : [makeFallbackSkillGroup(`imp_ss${setId}`)];
    skillSets.push({
      id: setId,
      title: ssAttrs.title || (skillSets.length === 0 ? 'Default' : `Skill Set ${skillSets.length + 1}`),
      skills: setSkills,
      mainSkillGroupId: setSkills[mainSocketGroupIdx - 1]?.id ?? setSkills[0]!.id,
    });
  }

  let activeSkillSetIndex = 0;
  let skills: SkillGroup[];
  let mainSkillGroupId: string;
  if (skillSets.length > 0) {
    activeSkillSetIndex = skillSets.findIndex((s) => s.id === requestedSkillSetId);
    if (activeSkillSetIndex < 0) {
      const numericIdx = Number(requestedSkillSetId) - 1;
      activeSkillSetIndex =
        Number.isFinite(numericIdx) && numericIdx >= 0 && numericIdx < skillSets.length ? numericIdx : 0;
    }
    const activeSkillSet = skillSets[activeSkillSetIndex]!;
    skills = activeSkillSet.skills;
    mainSkillGroupId = activeSkillSet.skills[mainSocketGroupIdx - 1]?.id ?? activeSkillSet.skills[0]!.id;
  } else {
    const parsedGroups = parseSkillGroupsFromBlock(xml, 'imp');
    skills = parsedGroups.length > 0 ? parsedGroups : [makeFallbackSkillGroup('imp')];
    mainSkillGroupId = skills[mainSocketGroupIdx - 1]?.id ?? skills[0]!.id;
  }

  // Parse <Config> inputs using clean official PoB defaults (all optional buffs OFF unless specified in XML)
  const ruleset = getRuleset(game);
  const config: Build['config'] = {
    ...createDefaultConfig(),
    enemyLevel: 84,
    enemyIsBoss: 'None',
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
  const questCustomModLines: string[] = [];
  const activeConfigXml = extractActiveConfigSetXml(xml);
  const inputRegex = /<(?:Input|Placeholder)\b([^>]*)\/?>/gi;
  let inputMatch: RegExpExecArray | null;
  while ((inputMatch = inputRegex.exec(activeConfigXml)) !== null) {
    const attrs = parseAttributes(inputMatch[1]!);
    const key = attrs.name;
    // PoE 2 optional campaign quest rewards stored as <Input name="quest..." string="..."/>
    if (game === 'poe2' && key && /^quest/i.test(key) && attrs.string) {
      for (const rawQuestLine of attrs.string.split(/\r?\n/)) {
        const ql = rawQuestLine.trim();
        if (!ql) continue;
        // Skip fixed campaign baselines already baked into POE2_RULESET
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
    if (key === 'bandit' && attrs.string) {
      if (attrs.string === 'None' || attrs.string === 'Alira' || attrs.string === 'Kraityn' || attrs.string === 'Oak') {
        banditFromConfig = attrs.string;
      }
    }
    if (key === 'enemyLevel' && attrs.number) config.enemyLevel = Number(attrs.number);
    if (key === 'enemyIsBoss' && attrs.string) {
      const normalizedBoss = attrs.string.trim().toLowerCase();
      if (normalizedBoss === 'none') {
        config.enemyIsBoss = 'None';
      } else if (normalizedBoss === 'guardian' || normalizedBoss === 'boss') {
        config.enemyIsBoss = 'Guardian';
      } else if (
        normalizedBoss === 'pinnacle' ||
        normalizedBoss === 'shaper' ||
        normalizedBoss === 'sirus'
      ) {
        config.enemyIsBoss = 'Pinnacle';
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
