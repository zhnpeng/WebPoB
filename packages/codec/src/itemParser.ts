import type { ArmourBaseStats, EquipmentSlotId, GameId, Item, ItemRarity, WeaponBaseStats } from '@webpob/core';
import { getBaseItemStats } from '@webpob/data';
import { normalizeStatLineToEn, toSimplifiedZh } from '@webpob/i18n';
import {
  extractModRanges,
  interpolateModRanges,
  parseModLineRangeTag,
  resolveMagicUtilityFlaskBase,
  shouldIncludeVariantLine,
  type ItemVariantSelection,
} from './pobXmlHelpers.js';

export interface ParseItemOptions {
  /** Selected primary unique variant index from `<Item variant="N">`. */
  variant?: number;
  /** Additional selected alt variant indices from `<Item variantAlt="N" ...>`. */
  variantAlts?: number[];
}

const RARITY_MAP: Record<string, ItemRarity> = {
  normal: 'NORMAL',
  magic: 'MAGIC',
  rare: 'RARE',
  unique: 'UNIQUE',
  relic: 'UNIQUE',
  普通: 'NORMAL',
  魔法: 'MAGIC',
  稀有: 'RARE',
  传奇: 'UNIQUE',
  暗金: 'UNIQUE',
  古物: 'UNIQUE',
};

const SLOT_KEYWORDS: Array<{ pattern: RegExp; slot: EquipmentSlotId | 'Any'; weaponType?: WeaponBaseStats['weaponType']; twoHanded?: boolean }> = [
  { pattern: /\bjewel\b|珠宝/i, slot: 'Any' },
  { pattern: /wand|法杖|魔杖/i, slot: 'Weapon 1', weaponType: 'Wand', twoHanded: false },
  { pattern: /quarterstaff|细杖/i, slot: 'Weapon 1', weaponType: 'Quarterstaff', twoHanded: true },
  { pattern: /staff|staves|warstaff|长杖|符文之叉/i, slot: 'Weapon 1', weaponType: 'Staff', twoHanded: true },
  { pattern: /crossbow|战弩|十字弓|弩/i, slot: 'Weapon 1', weaponType: 'Crossbow', twoHanded: true },
  { pattern: /bow|长弓|弓/i, slot: 'Weapon 1', weaponType: 'Bow', twoHanded: true },
  { pattern: /spear|战矛|长矛/i, slot: 'Weapon 1', weaponType: 'Sword', twoHanded: false },
  { pattern: /dagger|匕首/i, slot: 'Weapon 1', weaponType: 'Dagger', twoHanded: false },
  { pattern: /claw|爪/i, slot: 'Weapon 1', weaponType: 'Claw', twoHanded: false },
  { pattern: /two hand sword|双手剑/i, slot: 'Weapon 1', weaponType: 'Sword', twoHanded: true },
  { pattern: /sword|剑/i, slot: 'Weapon 1', weaponType: 'Sword', twoHanded: false },
  { pattern: /two hand axe|双手斧/i, slot: 'Weapon 1', weaponType: 'Axe', twoHanded: true },
  { pattern: /axe|斧/i, slot: 'Weapon 1', weaponType: 'Axe', twoHanded: false },
  { pattern: /two hand mace|双手锤/i, slot: 'Weapon 1', weaponType: 'Mace', twoHanded: true },
  { pattern: /mace|sceptre|flail|权杖|短杖|连枷|锤/i, slot: 'Weapon 1', weaponType: 'Mace', twoHanded: false },
  { pattern: /shield|buckler|focus|quiver|盾|法器|箭袋/i, slot: 'Weapon 2' },
  { pattern: /helmet|circlet|crown|tiara|helm|mask|hood|cap|头盔|头环|王冠|冠冕|头冠|帽|面具|兜帽/i, slot: 'Helmet' },
  { pattern: /body armour|robe|garb|plate|regalia|vestment|vest|coat|tunic|brigandine|doublet|jacket|胸甲|长袍|战甲|法衣|背心|外衣|护胸|盔甲/i, slot: 'Body Armour' },
  { pattern: /gloves|gauntlets|mitts|bracers|wraps|手套|护手|手甲|护腕/i, slot: 'Gloves' },
  { pattern: /boots|greaves|sandals|shoes|slippers|sabatons|鞋子|长靴|战靴|便鞋|行靴|护胫|靴/i, slot: 'Boots' },
  { pattern: /amulet|talisman|项链|护颈|护身符/i, slot: 'Amulet' },
  { pattern: /ring|戒指|指环/i, slot: 'Ring 1' },
  { pattern: /belt|vise|sash|腰带|束带/i, slot: 'Belt' },
  { pattern: /charm|咒符|护符/i, slot: 'Charm 1' },
  { pattern: /flask|药剂/i, slot: 'Flask 1' },
];

function inferSlotAndWeapon(hintText: string, game: GameId = 'poe1'): {
  slotType: EquipmentSlotId | 'Any';
  weaponType?: WeaponBaseStats['weaponType'];
  twoHanded?: boolean;
} {
  const normalizedHint = toSimplifiedZh(hintText);
  if (game === 'poe2' && /\btalisman\b|魔符/i.test(normalizedHint) && !/\bamulet\b|项链/i.test(normalizedHint)) {
    return {
      slotType: 'Weapon 1',
      weaponType: 'Talisman',
      twoHanded: true,
    };
  }
  for (const entry of SLOT_KEYWORDS) {
    if (entry.pattern.test(normalizedHint)) {
      return {
        slotType: entry.slot,
        weaponType: entry.weaponType,
        twoHanded: entry.twoHanded,
      };
    }
  }
  return { slotType: 'Any' };
}

function stripAugmented(val: string): string {
  return val
    .replace(/\(augmented\)|\(unmet\)|\(fire\)|\(cold\)|\(lightning\)|\(chaos\)|（已增强）|（已增強）|（未满足）|（未滿足）/gi, '')
    .trim();
}

function parseDamageRange(val: string): [number, number] | null {
  const m = stripAugmented(val).match(/(\d+)\s*(?:-|–|~|至|到)\s*(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

function parseAllDamageRanges(val: string): Array<[number, number]> {
  const cleaned = stripAugmented(val);
  const ranges: Array<[number, number]> = [];
  const re = /(\d+)\s*(?:-|–|~|至|到)\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    ranges.push([Number(m[1]), Number(m[2])]);
  }
  return ranges;
}

/**
 * Parses both English and Chinese Path of Exile 1/2 in-game `Ctrl+C` item text
 * as well as Path of Building XML `<Item>` text blocks into a normalized `Item`.
 */
export function parseItemText(
  rawText: string,
  idOverride?: string,
  game: GameId = 'poe1',
  options?: ParseItemOptions,
): Item | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const modRanges = extractModRanges(trimmed);
  const lines = trimmed
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return null;

  let rarity: ItemRarity = 'RARE';
  let itemClassHint = '';
  let quality = 0;
  let sockets: string | undefined;
  let socketCount: number | undefined;
  const runes: string[] = [];
  let catalyst: string | undefined;
  let catalystQuality: number | undefined;
  let levelReq: number | undefined;
  let implicitCountHint: number | null = null;
  let variantListCount = 0;
  let usesVariantGroups = false;
  let selectedVersion: number | undefined;
  let selectedVariantFromText: number | undefined;
  const selectedAltVariantsFromText: number[] = [];
  const variantGroupSelections = new Map<number, number>();

  const armourStats: ArmourBaseStats = {};
  let hasArmourStats = false;
  let physDamage: [number, number] | null = null;
  let critChance: number | null = null;
  let aps: number | null = null;
  const eleDamage: NonNullable<WeaponBaseStats['elementalDamage']> = {};

  // Split by PoE clipboard separator "--------" if present
  const hasSeparators = lines.some((l) => /^-{4,}$/.test(l));
  const sections: string[][] = [];
  if (hasSeparators) {
    let current: string[] = [];
    for (const line of lines) {
      if (/^-{4,}$/.test(line)) {
        if (current.length > 0) sections.push(current);
        current = [];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) sections.push(current);
  } else {
    sections.push(lines);
  }

  // Extract header info (Section 0)
  const headerLines = sections[0] ?? [];
  const nameCandidates: string[] = [];
  let bodyStartIdxInFlatLines = 0;

  if (hasSeparators) {
    for (const line of headerLines) {
      const sLine = toSimplifiedZh(line);
      const classMatch = sLine.match(/^(?:Item Class|物品类别|物品种类|物品类型)\s*[:：]\s*(.+)$/i);
      if (classMatch) {
        itemClassHint = classMatch[1]!.trim();
        continue;
      }
      const rarityMatch = sLine.match(/^(?:Rarity|稀\s*有\s*度)\s*[:：]\s*(.+)$/i);
      if (rarityMatch) {
        const key = rarityMatch[1]!.trim().toLowerCase();
        rarity = RARITY_MAP[key] ?? RARITY_MAP[rarityMatch[1]!.trim()] ?? 'RARE';
        continue;
      }
      nameCandidates.push(line);
    }
  } else {
    // Standard Path of Building XML <Item> text format (no "--------" separators):
    // Rarity: RARE -> Line 1: Name -> Line 2: BaseName (for RARE/UNIQUE) -> remaining lines are properties & mods
    let idx = 0;
    while (idx < lines.length) {
      const line = lines[idx]!;
      const sLine = toSimplifiedZh(line);
      const classMatch = sLine.match(/^(?:Item Class|物品类别|物品种类|物品类型)\s*[:：]\s*(.+)$/i);
      if (classMatch) {
        itemClassHint = classMatch[1]!.trim();
        idx++;
        continue;
      }
      const rarityMatch = sLine.match(/^(?:Rarity|稀\s*有\s*度)\s*[:：]\s*(.+)$/i);
      if (rarityMatch) {
        const key = rarityMatch[1]!.trim().toLowerCase();
        rarity = RARITY_MAP[key] ?? RARITY_MAP[rarityMatch[1]!.trim()] ?? 'RARE';
        idx++;
        continue;
      }
      break;
    }
    const expectedHeaderLines = rarity === 'NORMAL' || rarity === 'MAGIC' ? 1 : 2;
    for (let k = 0; k < expectedHeaderLines && idx < lines.length; k++) {
      const candidate = lines[idx]!;
      if (/^(?:Unique ID|Item Level|Quality|Sockets|LevelReq|Implicits|Armour|Evasion|Energy Shield|Runic Ward|Ward|Physical Damage)\s*[:：]/i.test(candidate)) {
        break;
      }
      nameCandidates.push(candidate);
      idx++;
    }
    bodyStartIdxInFlatLines = idx;
  }

  let name = nameCandidates[0] ?? 'Custom Item';
  let baseName = nameCandidates.length >= 2 ? nameCandidates[1]! : name;
  if (rarity === 'NORMAL' || rarity === 'MAGIC') {
    baseName = name;
    if (rarity === 'MAGIC') {
      const canonicalFlaskBase = resolveMagicUtilityFlaskBase(name);
      if (canonicalFlaskBase) {
        baseName = canonicalFlaskBase;
      }
    }
  }

  const rawStatCandidates: string[] = [];
  const rawTaggedImplicits: string[] = [];
  const implicits: string[] = [];
  const explicits: string[] = [];

  // Process all lines for property metadata & stat lines
  const bodyLines = hasSeparators
    ? sections.slice(1).flatMap((sec, idx) => (idx > 0 ? ['__SEC__', ...sec] : sec))
    : lines.slice(bodyStartIdxInFlatLines);

  let afterImplicitsMarker = false;
  let corrupted = false;
  const rawCollectedSections: string[][] = [[]];

  for (const rawLine of bodyLines) {
    if (rawLine === '__SEC__') {
      if (rawCollectedSections[rawCollectedSections.length - 1]!.length > 0) {
        rawCollectedSections.push([]);
      }
      continue;
    }

    const line = toSimplifiedZh(rawLine);

    // Metadata properties
    const qualMatch = line.match(/^(?:Quality|品质)\s*[:：]\s*\+?(\d+)%?/i);
    if (qualMatch) {
      quality = Number(qualMatch[1]);
      continue;
    }

    const sockMatch = line.match(/^(?:Sockets|插槽)\s*[:：]\s*(.+)$/i);
    if (sockMatch) {
      sockets = sockMatch[1]!.trim();
      const tokens = sockets
        .split(/[\s-]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      if (tokens.length > 0) {
        socketCount = tokens.length;
      }
      continue;
    }

    const runeMatch = line.match(/^(?:Rune|符文)\s*[:：]\s*(.+)$/i);
    if (runeMatch) {
      const runeName = runeMatch[1]!.trim();
      if (runeName) runes.push(runeName);
      continue;
    }

    const catalystMatch = line.match(/^Catalyst\s*[:：]\s*(.+)$/i);
    if (catalystMatch) {
      const catName = catalystMatch[1]!.trim();
      if (catName) catalyst = catName;
      continue;
    }

    const catalystQualMatch = line.match(/^CatalystQuality\s*[:：]\s*\+?(\d+)%?$/i);
    if (catalystQualMatch) {
      catalystQuality = Number(catalystQualMatch[1]);
      continue;
    }

    const lvlMatch = line.match(/^(?:LevelReq|Level|等级)\s*[:：]\s*(\d+)/i);
    if (lvlMatch) {
      levelReq = Number(lvlMatch[1]);
      continue;
    }

    const impCountMatch = line.match(/^Implicits\s*[:：]\s*(\d+)$/i);
    if (impCountMatch) {
      implicitCountHint = Number(impCountMatch[1]);
      afterImplicitsMarker = true;
      continue;
    }

    // PoB Variant / Version header lines
    if (/^Variant\s*[:：]\s*/i.test(line)) {
      variantListCount++;
      continue;
    }
    if (/^Version\s*[:：]\s*/i.test(line)) {
      usesVariantGroups = true;
      continue;
    }
    const selVariantMatch = line.match(/^Selected Variant\s*[:：]\s*(\d+)$/i);
    if (selVariantMatch) {
      selectedVariantFromText = Number(selVariantMatch[1]);
      continue;
    }
    const selAltVariantMatch = line.match(
      /^Selected Alt Variant(?:\s+(?:Two|Three|Four|Five))?\s*[:：]\s*(\d+)$/i,
    );
    if (selAltVariantMatch) {
      selectedAltVariantsFromText.push(Number(selAltVariantMatch[1]));
      continue;
    }
    const selVersionMatch = line.match(/^Selected Version\s*[:：]\s*(\d+)$/i);
    if (selVersionMatch) {
      selectedVersion = Number(selVersionMatch[1]);
      usesVariantGroups = true;
      continue;
    }
    const selVariantGroupMatch = line.match(/^Selected Variant Group\s*[:：]\s*(\d+)\s*=\s*(\d+)$/i);
    if (selVariantGroupMatch) {
      variantGroupSelections.set(Number(selVariantGroupMatch[1]), Number(selVariantGroupMatch[2]));
      usesVariantGroups = true;
      continue;
    }

    if (/^(?:Corrupted|Twice Corrupted|已腐化|双重腐化)$/i.test(line)) {
      corrupted = true;
      continue;
    }

    const qualModMatch = line.match(/^Quality\s*\(([^)]*Modifiers)\)\s*[:：]\s*\+?(\d+)%?/i);
    if (qualModMatch) {
      const catKind = qualModMatch[1]!.trim();
      const catVal = Number(qualModMatch[2]);
      if (catKind && !catalyst) catalyst = catKind;
      if (Number.isFinite(catVal) && catalystQuality === undefined) catalystQuality = catVal;
      continue;
    }

    if (
      /^(?:Unique ID|Requirements|需求|Item Level|物品等级|Requires|需求等级|Note|备注|Weapon Range|攻击范围|Limited to|仅限|Radius|影响范围|ArmourBasePercentile|EvasionBasePercentile|EnergyShieldBasePercentile|WardBasePercentile|<ModRange\b)/i.test(line) ||
      /^(?:Rune|符文|Crafted|Prefix|Suffix|League|Source|Upgrade|Unreleased|Catalyst|CatalystQuality|Cluster Jewel Skill|Cluster Jewel Node Count|Talisman Tier|Memory Strands|Has Alt Variant(?:\s+(?:Two|Three|Four|Five))?|Allow Duplicate Variants|Has Variants|Selected Variants)\s*[:：]/i.test(line) ||
      /^(?:Str|Dex|Int|Strength|Dexterity|Intelligence|力量|敏捷|智慧|Class|职业)\s*[:：]\s*\d+/i.test(line) ||
      /^(?:Unidentified|未鉴定|Mirrored|已复制|Split|已分裂|Sanctified|Historic|Foulborn Unique|Foil Unique(?:\s*\([^)]*\))?|Synthesised Item|追忆物品|Fractured Item|分裂物品|Searing Exarch Item|Eater of Worlds Item|Shaper Item|Elder Item|Crusader Item|Hunter Item|Redeemer Item|Warlord Item)$/i.test(line)
    ) {
      continue;
    }

    // Defensive base stats
    const armMatch = line.match(/^(?:Armour|护甲值|护甲)\s*[:：]\s*(\d+)/i);
    if (armMatch) {
      armourStats.armour = Number(armMatch[1]);
      hasArmourStats = true;
      continue;
    }
    const evaMatch = line.match(/^(?:Evasion Rating|Evasion|闪避值|闪避)\s*[:：]\s*(\d+)/i);
    if (evaMatch) {
      armourStats.evasion = Number(evaMatch[1]);
      hasArmourStats = true;
      continue;
    }
    const esMatch = line.match(/^(?:Energy Shield|能量护盾)\s*[:：]\s*(\d+)/i);
    if (esMatch) {
      armourStats.energyShield = Number(esMatch[1]);
      hasArmourStats = true;
      continue;
    }
    const wardMatch = line.match(/^(?:Runic Ward|Ward|符文结界|结界)\s*[:：]\s*(\d+)/i);
    if (wardMatch) {
      armourStats.ward = Number(wardMatch[1]);
      hasArmourStats = true;
      continue;
    }
    const blkMatch = line.match(/^(?:Chance to Block|Block Chance|格挡几率|格挡率)\s*[:：]\s*(\d+)%/i);
    if (blkMatch) {
      armourStats.blockChance = Number(blkMatch[1]);
      hasArmourStats = true;
      continue;
    }
    const spiritPropMatch = line.match(/^(?:Spirit|精魂)\s*[:：]\s*\+?(\d+)/i);
    if (spiritPropMatch) {
      implicits.push(`+${Number(spiritPropMatch[1])} to Spirit`);
      continue;
    }

    // Weapon base stats
    const physMatch = line.match(/^(?:Physical Damage|物理伤害)\s*[:：]\s*(.+)$/i);
    if (physMatch) {
      physDamage = parseDamageRange(physMatch[1]!);
      continue;
    }
    const fireDmgMatch = line.match(/^(?:Fire Damage|火焰伤害)\s*[:：]\s*(.+)$/i);
    if (fireDmgMatch) {
      const range = parseDamageRange(fireDmgMatch[1]!);
      if (range) eleDamage.Fire = range;
      continue;
    }
    const coldDmgMatch = line.match(/^(?:Cold Damage|冰霜伤害|冰冷伤害)\s*[:：]\s*(.+)$/i);
    if (coldDmgMatch) {
      const range = parseDamageRange(coldDmgMatch[1]!);
      if (range) eleDamage.Cold = range;
      continue;
    }
    const lightDmgMatch = line.match(/^(?:Lightning Damage|闪电伤害)\s*[:：]\s*(.+)$/i);
    if (lightDmgMatch) {
      const range = parseDamageRange(lightDmgMatch[1]!);
      if (range) eleDamage.Lightning = range;
      continue;
    }
    const chaosDmgMatch = line.match(/^(?:Chaos Damage|混沌伤害)\s*[:：]\s*(.+)$/i);
    if (chaosDmgMatch) {
      const range = parseDamageRange(chaosDmgMatch[1]!);
      if (range) eleDamage.Chaos = range;
      continue;
    }
    const eleMatch = line.match(/^(?:Elemental Damage|元素伤害)\s*[:：]\s*(.+)$/i);
    if (eleMatch) {
      const ranges = parseAllDamageRanges(eleMatch[1]!);
      const slots: Array<'Fire' | 'Cold' | 'Lightning'> = ['Fire', 'Cold', 'Lightning'];
      ranges.forEach((r, idx) => {
        const target = slots[idx] ?? 'Lightning';
        const prev = eleDamage[target];
        eleDamage[target] = prev ? [prev[0] + r[0], prev[1] + r[1]] : r;
      });
      continue;
    }
    const critMatch = line.match(/^(?:Critical Strike Chance|Critical Hit Chance|攻击暴击率|暴击几率|暴击率)\s*[:：]\s*(\d+(?:\.\d+)?)%/i);
    if (critMatch) {
      critChance = Number(critMatch[1]);
      continue;
    }
    const apsMatch = line.match(/^(?:Attacks per Second|每秒攻击次数)\s*[:：]\s*(\d+(?:\.\d+)?)/i);
    if (apsMatch) {
      aps = Number(apsMatch[1]);
      continue;
    }

    // Skip standalone weapon class lines like "Wand" or "One Handed Sword" (only before Implicits marker!)
    if (
      !afterImplicitsMarker &&
      /^(?:(?:One Handed|Two Handed)\s+(?:Sword|Axe|Mace|Staff)|Bow|Bows|Wand|Wands|Staff|Staves|Warstaff|Warstaves|Quarterstaff|Quarterstaves|Crossbow|Crossbows|Spear|Spears|Sceptre|Sceptres|Flail|Flails|Dagger|Daggers|Rune Dagger|Claw|Claws|Talisman|Talismans|单手剑|单手斧|单手锤|双手剑|双手斧|双手锤|弓|法杖|魔杖|细杖|长杖|权杖|战矛|战弩|十字弓|爪|匕首|魔符)$/i.test(
        line.trim(),
      )
    ) {
      itemClassHint = itemClassHint || line.trim();
      continue;
    }

    // Ignore flavour text (lines without digits and without known flag keywords)
    const isImplicitTag = /\((?:implicit|enchant|rune)\)|（(?:基底|固有|附魔|符文)）/i.test(line);

    if (afterImplicitsMarker && implicitCountHint !== null) {
      rawStatCandidates.push(line);
    } else if (isImplicitTag) {
      rawTaggedImplicits.push(line);
    } else {
      rawCollectedSections[rawCollectedSections.length - 1]!.push(line);
    }
  }

  // Resolve active unique variants (PoB `<Item variant="...">` / `Selected Variant: N` / `Variant:` list)
  const resolvedPrimaryVariant =
    selectedVariantFromText ??
    options?.variant ??
    (variantListCount > 0 ? variantListCount : undefined);
  const activeVariants = new Set<number>();
  if (resolvedPrimaryVariant !== undefined && Number.isFinite(resolvedPrimaryVariant)) {
    activeVariants.add(resolvedPrimaryVariant);
  }
  for (const alt of [...(options?.variantAlts ?? []), ...selectedAltVariantsFromText]) {
    if (Number.isFinite(alt) && alt > 0) {
      activeVariants.add(alt);
    }
  }
  const variantSelection: ItemVariantSelection = {
    activeVariants,
    usesVariantGroups,
    selectedVersion,
    variantGroupSelections,
  };

  let runeImplicitsCount = 0;
  const isRuneLine = (rawLine: string): boolean => /\{rune\}|\(rune\)|（符文）/i.test(rawLine);

  const CATALYST_TAG_GROUPS: Readonly<Record<string, readonly string[]>> = {
    abrasive: ['attack'],
    attack: ['attack'],
    accelerating: ['speed'],
    speed: ['speed'],
    fertile: ['resource', 'life', 'mana'],
    'life and mana': ['resource', 'life', 'mana'],
    imbued: ['caster'],
    caster: ['caster'],
    intrinsic: ['jewellery_attribute', 'attribute'],
    attribute: ['jewellery_attribute', 'attribute'],
    noxious: ['physical_damage', 'chaos_damage', 'physical', 'chaos'],
    'physical and chaos': ['physical_damage', 'chaos_damage', 'physical', 'chaos'],
    prismatic: ['jewellery_resistance', 'elemental_resistance', 'chaos_resistance', 'resistance'],
    resistance: ['jewellery_resistance', 'elemental_resistance', 'chaos_resistance', 'resistance'],
    tempering: ['jewellery_defense', 'defences'],
    defence: ['jewellery_defense', 'defences'],
    turbulent: ['jewellery_elemental', 'elemental_damage', 'elemental'],
    elemental: ['jewellery_elemental', 'elemental_damage', 'elemental'],
    unstable: ['critical'],
    critical: ['critical'],
  };
  const normCatalystKey = catalyst
    ? catalyst.trim().toLowerCase().replace(/\s*modifiers\s*$/i, '')
    : '';
  const activeCatalystTags =
    game === 'poe1' && normCatalystKey && catalystQuality && catalystQuality > 0
      ? CATALYST_TAG_GROUPS[normCatalystKey]
      : undefined;

  const resolveAndNormalizeModLine = (rawLine: string, rawModIndex?: number): string | null => {
    if (!shouldIncludeVariantLine(rawLine, variantSelection)) {
      return null;
    }
    if (isRuneLine(rawLine)) {
      runeImplicitsCount++;
    }
    const inlineRanges = parseModLineRangeTag(rawLine);
    const modRangeOverride =
      inlineRanges ?? (rawModIndex !== undefined ? modRanges.get(rawModIndex) : undefined);
    let interpolated = interpolateModRanges(rawLine, modRangeOverride);
    if (activeCatalystTags && catalystQuality && /\(\d/.test(rawLine)) {
      const mTags = rawLine.match(/\{tags:([^}]*)\}/i);
      if (mTags?.[1]) {
        const lineTags = mTags[1]
          .toLowerCase()
          .split(',')
          .map((t) => t.trim());
        if (activeCatalystTags.some((ct) => lineTags.includes(ct))) {
          const catMult = 1 + catalystQuality / 100;
          interpolated = interpolated.replace(
            /([+-]?)(\d+(?:\.\d+)?)/g,
            (_full, sign: string, numStr: string) => {
              const val = Number(numStr);
              const dotIdx = numStr.indexOf('.');
              if (dotIdx === -1) {
                return `${sign}${Math.trunc(val * catMult + 1e-9)}`;
              }
              const decimals = numStr.length - dotIdx - 1;
              const factor = Math.pow(10, decimals);
              return `${sign}${Math.trunc(val * catMult * factor + 1e-9) / factor}`;
            },
          );
        }
      }
    }
    const normalized = normalizeStatLineToEn(interpolated);
    return normalized || null;
  };

  for (const rawImp of rawTaggedImplicits) {
    const normalized = resolveAndNormalizeModLine(rawImp);
    if (normalized) implicits.push(normalized);
  }

  if (implicitCountHint !== null) {
    for (let i = 0; i < rawStatCandidates.length; i++) {
      const normalized = resolveAndNormalizeModLine(rawStatCandidates[i]!, i + 1);
      if (!normalized) continue;
      if (i < implicitCountHint) {
        implicits.push(normalized);
      } else {
        explicits.push(normalized);
      }
    }
  } else {
    let modIdx = 1;
    const nonEmptySections = rawCollectedSections
      .map((sec) =>
        sec
          .map((rawLine) => resolveAndNormalizeModLine(rawLine, modIdx++))
          .filter((l): l is string => Boolean(l)),
      )
      .filter((s) => s.length > 0);
    if (nonEmptySections.length >= 2 && implicits.length === 0) {
      // Heuristic: if first mod section has <= 2 lines, treat as implicits and last as explicits
      if (nonEmptySections[0]!.length <= 2) {
        implicits.push(...nonEmptySections[0]!);
        for (let i = 1; i < nonEmptySections.length; i++) {
          explicits.push(...nonEmptySections[i]!);
        }
      } else {
        for (const sec of nonEmptySections) {
          explicits.push(...sec);
        }
      }
    } else {
      for (const sec of nonEmptySections) {
        explicits.push(...sec);
      }
    }
  }

  const inferred = inferSlotAndWeapon(`${itemClassHint} ${baseName} ${name}`, game);
  const explicitWeaponInHeader = Boolean(
    physDamage || Object.keys(eleDamage).length > 0 || aps !== null || critChance !== null,
  );
  const explicitArmourInHeader = hasArmourStats;
  const rawOfficialBase = getBaseItemStats(baseName, 0, game);
  const recomputePoe2XmlLocal =
    game === 'poe2' && !hasSeparators && Boolean(rawOfficialBase?.armour || rawOfficialBase?.weapon);
  const localStatsPrecomputed = recomputePoe2XmlLocal
    ? false
    : explicitWeaponInHeader || explicitArmourInHeader;
  const officialBase = localStatsPrecomputed ? getBaseItemStats(baseName, quality, game) : rawOfficialBase;

  let weaponStats: WeaponBaseStats | undefined;
  if (explicitWeaponInHeader) {
    weaponStats = {
      physicalMin: physDamage?.[0] ?? officialBase?.weapon?.physicalMin ?? 10,
      physicalMax: physDamage?.[1] ?? officialBase?.weapon?.physicalMax ?? 20,
      elementalDamage: Object.keys(eleDamage).length > 0 ? eleDamage : undefined,
      attacksPerSecond: aps ?? officialBase?.weapon?.attacksPerSecond ?? 1.2,
      critChance: critChance ?? officialBase?.weapon?.critChance ?? 6,
      weaponType: inferred.weaponType ?? officialBase?.weapon?.weaponType ?? 'Sword',
      twoHanded: inferred.twoHanded ?? officialBase?.weapon?.twoHanded ?? false,
    };
  } else if (officialBase?.weapon) {
    weaponStats = { ...officialBase.weapon };
  }

  // Merge official base armour/evasion/ES stats if item text omitted explicit defense lines.
  // Also preserve shield base `blockChance` when XML provides Armour/Evasion/ES without `Chance to Block:`.
  if (!hasArmourStats && officialBase?.armour) {
    Object.assign(armourStats, officialBase.armour);
    hasArmourStats = true;
  } else if (
    hasArmourStats &&
    armourStats.blockChance === undefined &&
    officialBase?.armour?.blockChance !== undefined
  ) {
    armourStats.blockChance = officialBase.armour.blockChance;
  }

  const isChineseName = /[\u4e00-\u9fff]/.test(name);
  const rawFilledSockets = Math.max(runes.length, runeImplicitsCount);
  const filledSocketCount =
    socketCount !== undefined
      ? Math.min(rawFilledSockets, socketCount)
      : rawFilledSockets > 0
        ? rawFilledSockets
        : undefined;

  return {
    id: idOverride ?? `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    nameZh: isChineseName ? name : undefined,
    baseName,
    baseNameZh: /[\u4e00-\u9fff]/.test(baseName) ? baseName : undefined,
    rarity,
    slotType: inferred.slotType,
    quality,
    sockets,
    ...(socketCount !== undefined ? { socketCount } : {}),
    ...(filledSocketCount !== undefined ? { filledSocketCount } : {}),
    ...(runes.length > 0 ? { runes } : {}),
    ...(catalyst ? { catalyst } : {}),
    ...(catalystQuality !== undefined ? { catalystQuality } : {}),
    levelReq,
    weaponStats,
    armourStats: hasArmourStats ? armourStats : undefined,
    implicits,
    explicits,
    rawText: trimmed,
    ...(corrupted ? { corrupted: true } : {}),
    ...(resolvedPrimaryVariant !== undefined ? { variant: resolvedPrimaryVariant } : {}),
    ...(selectedVariantFromText !== undefined ? { selectedVariant: selectedVariantFromText } : {}),
    localStatsPrecomputed,
  };
}

/**
 * Formats a normalized Item into Path of Building's canonical `<Item>` text format.
 */
export function formatItemToPobText(item: Item): string {
  const lines: string[] = [];
  lines.push(`Rarity: ${item.rarity}`);
  lines.push(item.name);
  if (
    item.rarity !== 'NORMAL' &&
    item.rarity !== 'MAGIC' &&
    item.baseName &&
    item.baseName !== item.name
  ) {
    lines.push(item.baseName);
  }
  if (item.quality > 0) {
    lines.push(`Quality: ${item.quality}`);
  }
  if (item.catalyst) {
    lines.push(`Catalyst: ${item.catalyst}`);
  }
  if (item.catalystQuality !== undefined && item.catalystQuality > 0) {
    lines.push(`CatalystQuality: ${item.catalystQuality}`);
  }
  if (item.sockets) {
    lines.push(`Sockets: ${item.sockets}`);
  }
  if (item.runes && item.runes.length > 0) {
    for (const rune of item.runes) {
      lines.push(`Rune: ${rune}`);
    }
  }
  if (item.levelReq) {
    lines.push(`LevelReq: ${item.levelReq}`);
  }
  if (item.armourStats?.armour) {
    lines.push(`Armour: ${item.armourStats.armour}`);
  }
  if (item.armourStats?.evasion) {
    lines.push(`Evasion: ${item.armourStats.evasion}`);
  }
  if (item.armourStats?.energyShield) {
    lines.push(`Energy Shield: ${item.armourStats.energyShield}`);
  }
  if (item.armourStats?.blockChance) {
    lines.push(`Chance to Block: ${item.armourStats.blockChance}%`);
  }
  if (item.weaponStats) {
    lines.push(`Physical Damage: ${item.weaponStats.physicalMin}-${item.weaponStats.physicalMax}`);
    lines.push(`Critical Strike Chance: ${item.weaponStats.critChance}%`);
    lines.push(`Attacks per Second: ${item.weaponStats.attacksPerSecond}`);
  }
  lines.push(`Implicits: ${item.implicits.length}`);
  for (const imp of item.implicits) {
    lines.push(imp);
  }
  for (const exp of item.explicits) {
    lines.push(exp);
  }
  return lines.join('\n');
}
