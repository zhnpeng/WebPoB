import type {
  ArmourBaseStats,
  Build,
  EquipmentSlotId,
  GemDefinition,
  GemInstance,
  Item,
  ItemRarity,
  SkillGroup,
  WeaponBaseStats,
} from '@webpob/core';
import {
  createDefaultConfig,
  getAscendancyStartNodeId,
  getBaseItemStats,
  getClassesForGame,
  getGemsForGame,
  getLocaleOverlay,
  getTreeForGame,
  getUniquesForGame,
} from '@webpob/data';
import { normalizeStatLineToEn, toSimplifiedZh } from '@webpob/i18n';

const WEGAME_POE2_API_BASE = 'https://www.wegame.com.cn/api/v1/wegame.pallas.poe2.Profile';
const WEGAME_SHARE_REGEX =
  /(?:https?:\/\/)?(?:www\.)?wegame\.com\.cn\/helper\/poe2\/?#\/share\/([A-Za-z0-9_%~.=+-]+)/i;

export interface WeGameModEntry {
  description?: string;
  flags?: Record<string, unknown>;
}

export interface WeGameProperty {
  name?: string;
  type?: number;
  values?: Array<[string, number]>;
}

export interface WeGameRawGem {
  baseType?: string;
  typeLine?: string;
  inventoryId?: string | null;
  support?: boolean;
  properties?: WeGameProperty[];
  socketedItems?: WeGameRawGem[];
}

export interface WeGameRawSocketedItem {
  id?: string;
  name?: string;
  baseType?: string;
  typeLine?: string;
  rarity?: string;
  frameType?: number;
  properties?: WeGameProperty[];
  implicitMods?: Array<string | WeGameModEntry>;
  explicitMods?: Array<string | WeGameModEntry>;
}

export interface WeGameRawEquipment {
  id?: string;
  name?: string;
  baseType?: string;
  typeLine?: string;
  inventoryId?: string;
  frameType?: number;
  rarity?: string;
  ilvl?: number;
  properties?: WeGameProperty[];
  sockets?: Array<{ group?: number; type?: string }>;
  socketedItems?: WeGameRawSocketedItem[];
  implicitMods?: Array<string | WeGameModEntry>;
  explicitMods?: Array<string | WeGameModEntry>;
  enchantMods?: Array<string | WeGameModEntry>;
  runeMods?: Array<string | WeGameModEntry>;
  craftedMods?: Array<string | WeGameModEntry>;
  fracturedMods?: Array<string | WeGameModEntry>;
}

export interface WeGameSkillOverride {
  id?: string;
  name?: string;
  grantedStrength?: number;
  grantedDexterity?: number;
  grantedIntelligence?: number;
  stats?: string[];
}

export interface WeGameRawJewelSlot {
  socket_id?: string;
  socket_name?: string;
  jewel?: {
    id?: string;
    display_name?: string;
    name?: string;
    rarity?: number;
    level?: number;
    mod_descriptions?: Array<{ type?: number; values?: string[] }>;
  };
}

export interface WeGamePoe2Bundle {
  shareCode?: string;
  roleInfo?: {
    role?: {
      role_id?: string;
      name?: string;
      level?: number;
      class_name?: string;
      phrase?: string;
      league_id?: string;
    };
  };
  roleProfile?: {
    skills?: Array<{ name?: string; total_dps?: string | number }>;
  };
  talentTree?: {
    talent_tree?: {
      hashes?: number[];
      specialisations?: {
        set1?: number[];
        set2?: number[];
      };
      skill_overrides?: Record<string, WeGameSkillOverride>;
      quest_stats?: string[];
    };
  };
  equipments?: {
    equipments?: WeGameRawEquipment[];
  };
  skills?: {
    skills?: WeGameRawGem[];
  };
  jewels?: {
    jewel_data?: string | WeGameRawJewelSlot[];
  };
}

/**
 * Extracts the public share hash from a WeGame PoE 2 Helper share URL
 * (e.g. `https://www.wegame.com.cn/helper/poe2/#/share/<hash>`).
 */
export function extractWeGamePoe2ShareCode(input: string): string | null {
  const trimmed = input.trim();
  const m = trimmed.match(WEGAME_SHARE_REGEX);
  if (!m?.[1]) return null;
  let code = m[1].split(/[?#&]/)[0] ?? '';
  try {
    code = decodeURIComponent(code);
  } catch {
    // keep raw token if malformed percent-encoding
  }
  code = code.trim();
  if (!/^[A-Za-z0-9_=-]{8,256}$/.test(code)) return null;
  return code;
}

export function isWeGamePoe2ShareUrl(input: string): boolean {
  return extractWeGamePoe2ShareCode(input) !== null;
}

/**
 * Strips PoE 2 / WeGame inline keyword markup `[Key|Display]` -> `Display`
 * and collapses extra whitespace.
 */
export function cleanWeGameMarkup(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .replace(/\[(?:[^|\]]+\|)?([^\]]+)\]/g, '$1')
    .replace(/<<[^>]+>>/g, '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractModLines(
  list?: Array<string | WeGameModEntry>,
  notableEnByNorm?: Map<string, string>,
  notableEnByZh?: Map<string, string>,
): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const entry of list) {
    const raw = typeof entry === 'string' ? entry : entry?.description;
    if (!raw || !raw.trim()) continue;
    const trimmed = raw.trim();
    // Resolve PoE 2 anoints first using the passive tree's exact Chinese notable map
    // (handles both "配置 [life_recoup17|坚韧血肉]", "配置 [DeliriumAnoint_Paragon|典范]", and plain "配置 诡计面纱").
    if (notableEnByZh) {
      // PoE 2 From Nothing ("无根之源"): "[passive_keystone_...|异灵之体]范围内的天赋可以在\n未连结至天赋树的情况下配置"
      const mFromNothing = trimmed.match(
        /^\[[^|\]]+\|([^\]]+)\]范围内的天赋可以在[\s\r\n]*未连结至天赋树的情况下配置$/,
      );
      if (mFromNothing) {
        const ksEn = notableEnByZh.get(mFromNothing[1]!.trim());
        if (ksEn) {
          out.push(`Passives in radius of ${ksEn} can be Allocated without being connected to your tree`);
          continue;
        }
      }
      const mBracketAnoint = trimmed.match(/^配置\s*\[[^|\]]+\|([^\]]+)\]$/);
      if (mBracketAnoint) {
        const zhTarget = mBracketAnoint[1]!.trim();
        const enFromZh = notableEnByZh.get(zhTarget);
        if (enFromZh) {
          out.push(`Allocates ${enFromZh}`);
          continue;
        }
      }
      const mPlainAnoint = trimmed.match(/^配置\s+([^\[\]\s][^[\]]*)$/);
      if (mPlainAnoint) {
        const zhTarget = mPlainAnoint[1]!.trim();
        const enFromZh = notableEnByZh.get(zhTarget);
        if (enFromZh) {
          out.push(`Allocates ${enFromZh}`);
          continue;
        }
      }
    }
    // Run normalizeStatLineToEn on the raw WeGame string FIRST so embedded English keys like
    // "[DeliriumAnoint_Paragon|典范]" and "[LegacyOfBismuth|灰岩] 继承" are preserved before bracket stripping.
    let en = normalizeStatLineToEn(raw);
    if (!en) continue;
    if (notableEnByNorm && /^Allocates\s+/i.test(en)) {
      const target = en.replace(/^Allocates\s+/i, '').trim();
      const normKey = target.toLowerCase().replace(/[^a-z0-9]/g, '');
      const exact = notableEnByNorm.get(normKey);
      if (exact) {
        en = `Allocates ${exact}`;
      }
    }
    out.push(en);
  }
  return out;
}

function isWeGameSocketedJewel(si: WeGameRawSocketedItem): boolean {
  const base = cleanWeGameMarkup(si.baseType || si.typeLine || si.name);
  const propNames = (si.properties ?? []).map((p) => cleanWeGameMarkup(p.name)).join(' ');
  if (/珠宝|Jewel/i.test(propNames)) return true;
  if (/^(?:宝钻|红玉|翠绿|蓝玉|钻石|蓝宝石|绿宝石|红宝石|失落的(?:红玉|翠绿|蓝玉)|永恒珠宝|Time-Lost|Timeless|Ruby|Emerald|Sapphire|Diamond)$/i.test(base)) {
    return true;
  }
  return /珠宝|Jewel/i.test(base);
}

function isWeGameGrantedSkillSocket(si: WeGameRawSocketedItem): boolean {
  // WeGame includes item-granted active skills in `socketedItems` with no mods & no rune/jewel base
  const hasMods =
    (Array.isArray(si.explicitMods) && si.explicitMods.length > 0) ||
    (Array.isArray(si.implicitMods) && si.implicitMods.length > 0);
  return !hasMods && !isWeGameSocketedJewel(si);
}

function resolveCanonicalBaseFallback(rawBaseZh: string, props?: WeGameProperty[]): string {
  const propText = (props ?? []).map((p) => cleanWeGameMarkup(p.name)).join(' ');
  if (/法器|Focus/i.test(rawBaseZh) || /\bFocus\b|法器/i.test(propText)) return 'Focus';
  if (/圆盾|轻盾|Buckler/i.test(rawBaseZh)) return 'Buckler';
  if (/塔盾|巨盾|盾|Shield/i.test(rawBaseZh) || /格挡几率|Chance to Block/i.test(propText)) return 'Shield';
  if (/箭袋|Quiver/i.test(rawBaseZh)) return 'Quiver';
  if (/战矛|Spear/i.test(rawBaseZh) || /战矛|Spear/i.test(propText)) return 'Spear';
  if (/战弩|弩|Crossbow/i.test(rawBaseZh)) return 'Crossbow';
  if (/长弓|弓|Bow/i.test(rawBaseZh)) return 'Bow';
  if (/细杖|Quarterstaff/i.test(rawBaseZh)) return 'Quarterstaff';
  if (/长杖|Staff/i.test(rawBaseZh)) return 'Staff';
  if (/法杖|Wand/i.test(rawBaseZh)) return 'Wand';
  if (/权杖|Sceptre/i.test(rawBaseZh)) return 'Sceptre';
  if (/戒指|Ring/i.test(rawBaseZh)) return 'Ring';
  if (/项链|Amulet/i.test(rawBaseZh)) return 'Amulet';
  if (/腰带|Belt/i.test(rawBaseZh)) return 'Belt';
  return rawBaseZh;
}

function mapRarity(frameType?: number, rarity?: string): ItemRarity {
  const r = (rarity ?? '').toUpperCase();
  if (r === 'UNIQUE' || frameType === 3) return 'UNIQUE';
  if (r === 'RARE' || frameType === 2 || frameType === 13) return 'RARE';
  if (r === 'MAGIC' || frameType === 1) return 'MAGIC';
  return 'NORMAL';
}

function parseRange(raw?: string): [number, number] | null {
  if (!raw) return null;
  const m = raw.match(/(\d+(?:\.\d+)?)\s*[-–~]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

function parseFirstNumber(raw?: string): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function inferWeaponType(
  rawProps: WeGameProperty[] | undefined,
  baseName: string,
): { weaponType: WeaponBaseStats['weaponType']; twoHanded: boolean } {
  const joined = `${baseName} ${(rawProps ?? []).map((p) => cleanWeGameMarkup(p.name)).join(' ')}`;
  if (/战弩|弩|Crossbow/i.test(joined)) return { weaponType: 'Crossbow', twoHanded: true };
  if (/长弓|弓|Bow/i.test(joined)) return { weaponType: 'Bow', twoHanded: true };
  if (/细杖|Quarterstaff/i.test(joined)) return { weaponType: 'Quarterstaff', twoHanded: true };
  if (/长杖|Staff/i.test(joined)) return { weaponType: 'Staff', twoHanded: true };
  if (/法杖|Wand/i.test(joined)) return { weaponType: 'Wand', twoHanded: false };
  if (/匕首|Dagger/i.test(joined)) return { weaponType: 'Dagger', twoHanded: false };
  if (/爪|Claw/i.test(joined)) return { weaponType: 'Claw', twoHanded: false };
  if (/斧|Axe/i.test(joined)) return { weaponType: 'Axe', twoHanded: /双手|Two Hand/i.test(joined) };
  if (/锤|权杖|Mace|Sceptre|Flail/i.test(joined)) {
    return { weaponType: 'Mace', twoHanded: /双手|Two Hand/i.test(joined) };
  }
  return { weaponType: 'Sword', twoHanded: /双手|Two Hand/i.test(joined) };
}

function parseWeGameItemProperties(
  props: WeGameProperty[] | undefined,
  baseName: string,
): {
  quality: number;
  armour?: ArmourBaseStats;
  weapon?: WeaponBaseStats;
  spirit?: number;
  isCharm: boolean;
} {
  let quality = 0;
  let armour = 0;
  let evasion = 0;
  let energyShield = 0;
  let ward = 0;
  let blockChance: number | undefined;
  let spirit: number | undefined;
  let physRange: [number, number] | null = null;
  const elementalDamage: Partial<Record<'Fire' | 'Cold' | 'Lightning' | 'Chaos', [number, number]>> = {};
  let critChance: number | null = null;
  let aps: number | null = null;
  let isCharm = false;

  for (const prop of props ?? []) {
    const name = cleanWeGameMarkup(prop.name);
    const val0 = prop.values?.[0]?.[0];

    if (name === '咒符' || /^Charm$/i.test(name)) {
      isCharm = true;
    } else if (/品质|Quality/i.test(name)) {
      const q = parseFirstNumber(val0);
      if (q !== null) quality = Math.round(q);
    } else if (/^(?:护甲|护甲值|Armour)$/i.test(name) && val0) {
      const v = parseFirstNumber(val0);
      if (v !== null) armour = v;
    } else if (/^(?:闪避|闪避值|Evasion Rating|Evasion)$/i.test(name) && val0) {
      const v = parseFirstNumber(val0);
      if (v !== null) evasion = v;
    } else if (/^(?:能量护盾|Energy Shield)$/i.test(name) && val0) {
      const v = parseFirstNumber(val0);
      if (v !== null) energyShield = v;
    } else if (/^(?:符文结界|结界|Ward)$/i.test(name) && val0) {
      const v = parseFirstNumber(val0);
      if (v !== null) ward = v;
    } else if (/格挡几率|Chance to Block/i.test(name) && val0) {
      const v = parseFirstNumber(val0);
      if (v !== null) blockChance = v;
    } else if ((/^(?:精魂|Spirit)$/i.test(name) || prop.type === 25) && val0) {
      const v = parseFirstNumber(val0);
      if (v !== null && v > 0) spirit = Math.round(v);
    } else if (/物理伤害|Physical Damage/i.test(name) && val0) {
      physRange = parseRange(val0);
    } else if (/火焰伤害|Fire Damage/i.test(name) && val0) {
      const r = parseRange(val0);
      if (r) elementalDamage.Fire = r;
    } else if (/冰霜伤害|冰冷伤害|Cold Damage/i.test(name) && val0) {
      const r = parseRange(val0);
      if (r) elementalDamage.Cold = r;
    } else if (/闪电伤害|Lightning Damage/i.test(name) && val0) {
      const r = parseRange(val0);
      if (r) elementalDamage.Lightning = r;
    } else if (/混沌伤害|Chaos Damage/i.test(name) && val0) {
      const r = parseRange(val0);
      if (r) elementalDamage.Chaos = r;
    } else if (/元素伤害|Elemental Damage/i.test(name)) {
      for (const pair of prop.values ?? []) {
        const r = parseRange(pair[0]);
        if (!r) continue;
        // GGG/WeGame value[1] color codes: 4=Fire, 5=Cold, 6=Lightning, 7=Chaos
        const code = pair[1];
        if (code === 4) elementalDamage.Fire = r;
        else if (code === 5) elementalDamage.Cold = r;
        else if (code === 6) elementalDamage.Lightning = r;
        else if (code === 7) elementalDamage.Chaos = r;
        else elementalDamage.Lightning = r;
      }
    } else if (/暴击率|暴击几率|Critical Strike Chance/i.test(name) && val0) {
      const v = parseFirstNumber(val0);
      if (v !== null) critChance = v;
    } else if (/每秒攻击次数|Attacks per Second/i.test(name) && val0) {
      const v = parseFirstNumber(val0);
      if (v !== null) aps = v;
    }
  }

  const armourStats: ArmourBaseStats | undefined =
    armour > 0 || evasion > 0 || energyShield > 0 || ward > 0 || blockChance !== undefined
      ? {
          ...(armour > 0 ? { armour } : {}),
          ...(evasion > 0 ? { evasion } : {}),
          ...(energyShield > 0 ? { energyShield } : {}),
          ...(ward > 0 ? { ward } : {}),
          ...(blockChance !== undefined ? { blockChance } : {}),
        }
      : undefined;

  const hasEle = Object.keys(elementalDamage).length > 0;
  const inferred = inferWeaponType(props, baseName);
  const weaponStats: WeaponBaseStats | undefined =
    physRange || hasEle || aps !== null
      ? {
          physicalMin: physRange?.[0] ?? 0,
          physicalMax: physRange?.[1] ?? 0,
          ...(hasEle ? { elementalDamage } : {}),
          critChance: critChance ?? 5,
          attacksPerSecond: aps ?? 1.2,
          weaponType: inferred.weaponType,
          twoHanded: inferred.twoHanded,
        }
      : undefined;

  return { quality, armour: armourStats, weapon: weaponStats, spirit, isCharm };
}

const WEGAME_INVENTORY_TO_SLOT: Record<string, EquipmentSlotId> = {
  Weapon: 'Weapon 1',
  Offhand: 'Weapon 2',
  Weapon2: 'Weapon 1 Swap',
  Offhand2: 'Weapon 2 Swap',
  Helm: 'Helmet',
  BodyArmour: 'Body Armour',
  Gloves: 'Gloves',
  Boots: 'Boots',
  Amulet: 'Amulet',
  Ring: 'Ring 1',
  Ring2: 'Ring 2',
  Belt: 'Belt',
};

function buildGemLookup(catalog: GemDefinition[]): (rawName?: string) => GemDefinition | undefined {
  const byZh = new Map<string, GemDefinition>();
  const byEn = new Map<string, GemDefinition>();

  for (const gem of catalog) {
    const zh = gem.name.zh.trim().toLowerCase();
    const en = gem.name.en.trim().toLowerCase();
    if (zh) {
      byZh.set(zh, gem);
      byZh.set(zh.replace(/辅助$/, ''), gem);
      byZh.set(zh.replace(/\s+[ivx]+$/i, ''), gem);
    }
    if (en) {
      byEn.set(en, gem);
      byEn.set(en.replace(/\s+support$/i, ''), gem);
      byEn.set(en.replace(/\s+[ivx]+$/i, ''), gem);
    }
  }

  return (rawName?: string) => {
    const clean = cleanWeGameMarkup(rawName).toLowerCase();
    if (!clean) return undefined;
    const noTier = clean.replace(/\s+[ivx]+$/i, '').trim();
    const noSupZh = noTier.replace(/辅助$/, '').trim();
    const noSupEn = noTier.replace(/\s+support$/i, '').trim();
    return (
      byZh.get(clean) ??
      byZh.get(noTier) ??
      byZh.get(noSupZh) ??
      byZh.get(`${noTier}辅助`) ??
      byEn.get(clean) ??
      byEn.get(noTier) ??
      byEn.get(noSupEn)
    );
  };
}

function extractGemLevelAndQuality(props?: WeGameProperty[]): {
  level: number;
  quality: number;
  spiritReservation?: number;
} {
  let level = 20;
  let quality = 0;
  let spiritReservation: number | undefined;
  for (const p of props ?? []) {
    const name = cleanWeGameMarkup(p.name);
    const val0 = p.values?.[0]?.[0];
    if (!val0) continue;
    if (/^(?:等级|Level)$/i.test(name)) {
      const n = parseFirstNumber(val0);
      if (n !== null) level = Math.max(1, Math.min(30, Math.round(n)));
    } else if (/^(?:品质|Quality)$/i.test(name)) {
      const n = parseFirstNumber(val0);
      if (n !== null) quality = Math.max(0, Math.min(30, Math.round(n)));
    } else if (/^(?:保留|Reservation)$/i.test(name) && /精魂|Spirit/i.test(cleanWeGameMarkup(val0))) {
      const n = parseFirstNumber(val0);
      if (n !== null) spiritReservation = Math.max(0, Math.round(n));
    }
  }
  return { level, quality, spiritReservation };
}

/**
 * Pure parser converting WeGame PoE 2 Helper share API payloads into a complete WebPoB `Build`.
 */
export function parseWeGamePoe2Build(bundle: WeGamePoe2Bundle): Build {
  const game = 'poe2' as const;
  const tree = getTreeForGame(game);
  const classes = getClassesForGame(game);
  const gemsCatalog = getGemsForGame(game);
  const matchGem = buildGemLookup(gemsCatalog);

  const role = bundle.roleInfo?.role;
  const rawClassName = cleanWeGameMarkup(role?.class_name);
  const normClass = rawClassName.toLowerCase().replace(/[\s_-]+/g, '');

  let classId = classes[0]!.id;
  let ascendancyId = '';
  if (normClass) {
    const directClass = classes.find(
      (c) =>
        c.id.toLowerCase().replace(/[\s_-]+/g, '') === normClass ||
        c.name.en.toLowerCase().replace(/[\s_-]+/g, '') === normClass ||
        c.name.zh.toLowerCase().replace(/[\s_-]+/g, '') === normClass,
    );
    if (directClass) {
      classId = directClass.id;
    } else {
      for (const c of classes) {
        const asc = c.ascendancies.find(
          (a) =>
            a.id.toLowerCase().replace(/[\s_-]+/g, '') === normClass ||
            a.name.en.toLowerCase().replace(/[\s_-]+/g, '') === normClass ||
            a.name.zh.toLowerCase().replace(/[\s_-]+/g, '') === normClass,
        );
        if (asc) {
          classId = c.id;
          ascendancyId = asc.id;
          break;
        }
      }
    }
  }

  // Passive tree + Weapon Set I / II dual trees + Ascendancy Start Hub
  const startNodeId = tree.classStartNodeIds[classId] ?? Object.values(tree.classStartNodeIds)[0]!;
  const hashSet = new Set<number>([startNodeId]);
  const ascStartNodeId = getAscendancyStartNodeId(tree, ascendancyId);
  if (ascStartNodeId) {
    hashSet.add(ascStartNodeId);
  }
  const rawTree = bundle.talentTree?.talent_tree;
  for (const h of rawTree?.hashes ?? []) {
    if (typeof h === 'number' && Number.isFinite(h)) hashSet.add(h);
  }
  const weaponSet1NodeIds = (rawTree?.specialisations?.set1 ?? []).filter(
    (h): h is number => typeof h === 'number' && Number.isFinite(h),
  );
  const weaponSet2NodeIds = (rawTree?.specialisations?.set2 ?? []).filter(
    (h): h is number => typeof h === 'number' && Number.isFinite(h),
  );

  // Parse PoE 2 self-selected attribute travel nodes & custom overrides from `talent_tree.skill_overrides`
  const attributeOverrides: Record<number, 'str' | 'dex' | 'int'> = {};
  const nodeOverrides: Record<number, { name?: string; stats: string[] }> = {};
  for (const [rawNodeId, ov] of Object.entries(rawTree?.skill_overrides ?? {})) {
    const nodeId = Number(rawNodeId);
    if (!Number.isFinite(nodeId) || !ov) continue;
    const ovId = (ov.id ?? '').toLowerCase();
    const ovStats = (ov.stats ?? []).map((s) => normalizeStatLineToEn(s)).filter(Boolean);
    if (
      (ov.grantedStrength && ov.grantedStrength > 0) ||
      ovId.includes('generic_attribute_strength') ||
      (ovStats.length === 1 && /^\+\d+\s+to Strength$/i.test(ovStats[0]!))
    ) {
      attributeOverrides[nodeId] = 'str';
    } else if (
      (ov.grantedDexterity && ov.grantedDexterity > 0) ||
      ovId.includes('generic_attribute_dexterity') ||
      (ovStats.length === 1 && /^\+\d+\s+to Dexterity$/i.test(ovStats[0]!))
    ) {
      attributeOverrides[nodeId] = 'dex';
    } else if (
      (ov.grantedIntelligence && ov.grantedIntelligence > 0) ||
      ovId.includes('generic_attribute_intelligence') ||
      (ovStats.length === 1 && /^\+\d+\s+to Intelligence$/i.test(ovStats[0]!))
    ) {
      attributeOverrides[nodeId] = 'int';
    } else if (ovStats.length > 0) {
      nodeOverrides[nodeId] = {
        ...(ov.name ? { name: cleanWeGameMarkup(ov.name) } : {}),
        stats: ovStats,
      };
    }
  }

  // Build lookup tables for Delirium Anoints & Chinese Unique/Base -> Canonical English names
  const notableEnByNorm = new Map<string, string>();
  const notableEnByZh = new Map<string, string>();
  for (const node of Object.values(tree.nodes)) {
    if (node.kind === 'notable' || node.kind === 'keystone') {
      const enName = node.name.en.trim();
      const zhName = node.name.zh?.trim();
      if (enName) {
        notableEnByNorm.set(enName.toLowerCase().replace(/[^a-z0-9]/g, ''), enName);
        if (zhName) {
          notableEnByZh.set(zhName, enName);
        }
      }
    }
  }
  const slotToUniqueBucket = (s: string): string => {
    if (/^Weapon|^Offhand|Shield|Quiver|Focus/i.test(s)) return 'Weapon';
    if (/^Ring/i.test(s)) return 'Ring';
    if (/^Flask/i.test(s)) return 'Flask';
    if (/^Charm/i.test(s)) return 'Charm';
    if (/^Helm/i.test(s)) return 'Helmet';
    return s;
  };
  const uniqueZhBySlot = new Map<string, { nameEn: string; baseEn: string }>();
  const baseZhLookup = new Map<string, string>();
  const twOverlay = getLocaleOverlay(game, 'zh-TW');
  if (twOverlay?.bases) {
    for (const [enBase, twBase] of Object.entries(twOverlay.bases)) {
      const twTrim = twBase.trim();
      const simTrim = toSimplifiedZh(twTrim).trim();
      if (twTrim && !baseZhLookup.has(twTrim)) baseZhLookup.set(twTrim, enBase);
      if (simTrim && !baseZhLookup.has(simTrim)) baseZhLookup.set(simTrim, enBase);
    }
  }
  for (const u of getUniquesForGame(game)) {
    if (u.zh && u.s) {
      const key = `${u.zh.trim()}::${slotToUniqueBucket(u.s)}`;
      if (!uniqueZhBySlot.has(key)) {
        uniqueZhBySlot.set(key, { nameEn: u.en, baseEn: u.b });
      }
    }
    if (u.bz && u.b) {
      baseZhLookup.set(u.bz.trim(), u.b);
      baseZhLookup.set(toSimplifiedZh(u.bz).trim(), u.b);
    }
  }
  // Simplified CN PoE 2 base names whose official CN translation differs from TW overlay
  const poe2CnBaseAliases: Record<string, string> = {
    // Helmets
    卡马萨冠冕: 'Kamasan Tiara',
    先祖冠冕: 'Ancestral Tiara',
    法术冠冕: 'Sorcerous Tiara',
    细枝头冠: 'Wicker Tiara',
    帝国巨盔: 'Imperial Greathelm',
    精锐巨盔: 'Elite Greathelm',
    毒蝰帽: 'Viper Cap',
    部族之面: 'Tribal Mask',
    覆甲帽: 'Armoured Cap',
    烁金头冠: 'Gold Circlet',
    // Body Armour
    恢弘盛装: 'Grand Regalia',
    启迪长袍: 'Enlightened Robe',
    祭坛长袍: 'Altar Robe',
    灵鸦斗篷: 'Corvus Mantle',
    冠军胸甲: 'Champion Cuirass',
    督军胸甲: 'Warlord Cuirass',
    士兵胸甲: 'Soldier Cuirass',
    滑击背心: 'Slipstrike Vest',
    滑布外衣: 'Serpentscale Coat',
    英武护甲: 'Heroic Armour',
    华饰环甲: 'Ornate Ringmail',
    华服装束: 'Gilded Vestments',
    // Gloves
    海妖之鳞手套: 'Sirenscale Gloves',
    丰裕手套: 'Opulent Gloves',
    黄金手套: 'Gold Gloves',
    狂热者手套: 'Zealot Gauntlets',
    黑钢手甲: 'Blacksteel Gauntlets',
    钢甲手甲: 'Steelmail Gauntlets',
    巨型护手: 'Massive Mitts',
    铸锻护手: 'Moulded Mitts',
    瓦尔护手: 'Vaal Gloves',
    华饰裹手: 'Adorned Wraps',
    雅致裹手: 'Elegant Wraps',
    坚固裹手: 'Secured Wraps',
    精工护腕: 'Fine Bracers',
    宏伟护腕: 'Refined Bracers',
    信徒袖带: 'Adherent Cuffs',
    强袭之臂: 'Combat Arm',
    偏转之臂: 'Deflective Arm',
    // Boots
    沙丘行者鞋履: 'Dunerunner Sandals',
    沙誓鞋履: 'Sandsworn Sandals',
    丝克玛便鞋: 'Sekhema Sandals',
    捷足便鞋: 'Daggerfoot Shoes',
    魅力便鞋: 'Charmed Shoes',
    龙皮长靴: 'Dragonscale Boots',
    龙鳞长靴: 'Dragonscale Boots',
    蛇鳞长靴: 'Serpentscale Boots',
    黑钢战靴: 'Blacksteel Sabatons',
    掩护战靴: 'Soldiering Sabatons',
    瓦尔胫甲: 'Vaal Greaves',
    塔萨里奥胫甲: 'Tasalian Greaves',
    华丽胫甲: 'Ornate Greaves',
    使徒护腿: 'Apostle Leggings',
    稳步之腿: 'Surefooted Leg',
    闪避之腿: 'Evasive Leg',
    // Focus & Shields
    塔萨里奥法器: 'Tasalian Focus',
    圣洁法器: 'Hallowed Focus',
    熔铸塔盾: 'Crucible Tower Shield',
    黑钢塔盾: 'Blacksteel Tower Shield',
    塔赫亚塔盾: 'Tawhoan Tower Shield',
    // Weapons & Quivers
    翱翔战矛: 'Soaring Spear',
    宏伟战矛: 'Massive Spear',
    阿科扬战矛: 'Akoyan Spear',
    摧城弩: 'Siege Crossbow',
    苍凉战弩: 'Desolate Crossbow',
    邪恶节杖: 'Sinister Quarterstaff',
    决斗法杖: 'Dueling Wand',
    扭曲法杖: 'Twisted Wand',
    虹吸法杖: 'Siphoning Wand',
    符文之叉: 'Runic Fork',
    反射长杖: 'Reflecting Staff',
    圣地权杖: 'Shrine Sceptre',
    克己权杖: 'Stoic Sceptre',
    罪孽权杖: 'Omen Sceptre',
    粗制弓: 'Crude Bow',
    穿射箭袋: 'Penetrating Quiver',
    灌铅大锤: 'Leaden Greathammer',
    秽咒之锤: 'Execratus Hammer',
    灰烬树皮魔符: 'Cinderbark Talisman',
    血亲魔符: 'Familial Talisman',
    荒林魔符: 'Wildwood Talisman',
    易形魔符: 'Changeling Talisman',
    // Jewellery & Belts
    失神项链: 'Absent Amulet',
    哀悼项链: 'Lament Amulet',
    预兆项链: 'Portent Amulet',
    日曜项链: 'Solar Amulet',
    星辉项链: 'Stellar Amulet',
    帝金项链: 'Gold Amulet',
    翠玉项链: 'Jade Amulet',
    琥珀项链: 'Amber Amulet',
    三相戒指: 'Prismatic Ring',
    裂隙戒指: 'Breach Ring',
    深渊印戒: 'Abyssal Signet',
    金光戒指: 'Gold Ring',
    潜能之戒: 'Unset Ring',
    紫晶戒指: 'Amethyst Ring',
    红玉戒指: 'Ruby Ring',
    蓝玉戒指: 'Sapphire Ring',
    黄玉戒指: 'Topaz Ring',
    万用腰带: 'Utility Belt',
    精致腰带: 'Fine Belt',
    重革腰带: 'Heavy Belt',
  };
  for (const [zh, en] of Object.entries(poe2CnBaseAliases)) {
    baseZhLookup.set(zh, en);
  }
  const resolveCanonicalBaseZh = (rawBaseZh: string): string | undefined => {
    const direct = baseZhLookup.get(rawBaseZh) ?? baseZhLookup.get(toSimplifiedZh(rawBaseZh));
    if (direct) return direct;
    // PoE 2 0.5 Runemastered ("符文师匠...") & Runeforged ("符文...") Ward base prefixes
    const mRunemaster = rawBaseZh.match(/^符文师匠(.+)$/);
    if (mRunemaster) {
      const innerEn = baseZhLookup.get(mRunemaster[1]!) ?? baseZhLookup.get(toSimplifiedZh(mRunemaster[1]!));
      if (innerEn) {
        const candidate = `Runemastered ${innerEn}`;
        return getBaseItemStats(candidate, 0, game) ? candidate : innerEn;
      }
    }
    const mRunic = rawBaseZh.match(/^符文(.+)$/);
    if (mRunic) {
      const innerEn = baseZhLookup.get(mRunic[1]!) ?? baseZhLookup.get(toSimplifiedZh(mRunic[1]!));
      if (innerEn) {
        const candidate = `Runeforged ${innerEn}`;
        return getBaseItemStats(candidate, 0, game) ? candidate : innerEn;
      }
    }
    return undefined;
  };
  // Common CN PoE 2 unique aliases (slot-scoped to prevent cross-slot collisions like Belt "夜临" vs Shield "Nightfall")
  const extraUniqueAliases: Array<{ zh: string; bucket: string; nameEn: string; baseEn: string }> = [
    { zh: '无生之辱', bucket: 'Body Armour', nameEn: 'Morior Invictus', baseEn: 'Grand Regalia' },
    { zh: '卡兰德之触', bucket: 'Ring', nameEn: "Kalandra's Touch", baseEn: 'Ring' },
    { zh: '埃斯特拉的道路', bucket: 'Ring', nameEn: "Estra's Path", baseEn: 'Ring' },
    { zh: '元素之章', bucket: 'Ring', nameEn: 'The Taming', baseEn: 'Prismatic Ring' },
    { zh: '库勒马克之握', bucket: 'Ring', nameEn: 'Grip of Kulemak', baseEn: 'Abyssal Signet' },
    { zh: '法师之血', bucket: 'Belt', nameEn: 'Mageblood', baseEn: 'Utility Belt' },
    { zh: '夜临', bucket: 'Belt', nameEn: 'Darkness Enthroned', baseEn: 'Fine Belt' },
    { zh: '黑暗统御', bucket: 'Belt', nameEn: 'Darkness Enthroned', baseEn: 'Fine Belt' },
    { zh: '薛朗的背包', bucket: 'Belt', nameEn: "Shavronne's Satchel", baseEn: 'Fine Belt' },
    { zh: '猎首', bucket: 'Belt', nameEn: 'Headhunter', baseEn: 'Heavy Belt' },
    { zh: '阿兹里的蔑视', bucket: 'Helmet', nameEn: "Atziri's Disdain", baseEn: 'Gold Circlet' },
    { zh: '收缩指令', bucket: 'Helmet', nameEn: 'Constricting Command', baseEn: 'Viper Cap' },
    { zh: '祭礼之雨', bucket: 'Helmet', nameEn: 'The Bringer of Rain', baseEn: 'Decorated Helm' },
    { zh: '谜容', bucket: 'Helmet', nameEn: 'Mask of the Sanguimancer', baseEn: 'Tribal Mask' },
    { zh: '均衡之符', bucket: 'Amulet', nameEn: 'Astramentis', baseEn: 'Stellar Amulet' },
    { zh: '烈火繁花', bucket: 'Amulet', nameEn: 'Fireflower', baseEn: 'Solar Amulet' },
    { zh: '马雷格罗的玫红手套', bucket: 'Gloves', nameEn: "Maligaro's Virtuosity", baseEn: 'Fine Bracers' },
    { zh: '巨铜之顶', bucket: 'Body Armour', nameEn: 'The Brass Dome', baseEn: 'Champion Cuirass' },
    { zh: '奉圣庇护所', bucket: 'Body Armour', nameEn: 'Sacred Sanctuary', baseEn: 'Corvus Mantle' },
    { zh: '敬奉之绸', bucket: 'Body Armour', nameEn: 'Silks of Veneration', baseEn: 'Enlightened Robe' },
    { zh: '血誓', bucket: 'Body Armour', nameEn: 'The Covenant', baseEn: 'Altar Robe' },
    { zh: '神圣之火', bucket: 'Weapon', nameEn: 'Sacred Flame', baseEn: 'Shrine Sceptre' },
    { zh: '森林灵像', bucket: 'Weapon', nameEn: "Sylvan's Effigy", baseEn: 'Stoic Sceptre' },
    { zh: '遗孀之雹', bucket: 'Weapon', nameEn: 'Widowhail', baseEn: 'Crude Bow' },
    { zh: '阿兹里的统治', bucket: 'Weapon', nameEn: "Atziri's Rule", baseEn: 'Reflecting Staff' },
    { zh: '符文猎手的呼唤', bucket: 'Weapon', nameEn: "Runeseeker's Call", baseEn: 'Runic Fork' },
    { zh: '斯瓦林', bucket: 'Weapon', nameEn: 'Svalinn', baseEn: 'Crucible Tower Shield' },
    { zh: '尼布洛克', bucket: 'Weapon', nameEn: 'Nebuloch', baseEn: 'Brigand Mace' },
    { zh: '穿心', bucket: 'Weapon', nameEn: 'Pierce', baseEn: 'Penetrating Quiver' },
  ];
  for (const entry of extraUniqueAliases) {
    uniqueZhBySlot.set(`${entry.zh}::${entry.bucket}`, { nameEn: entry.nameEn, baseEn: entry.baseEn });
  }

  // Equipped items (armour, weapons, jewellery, flasks, charms)
  const items: Record<string, Item> = {};
  const equipped: Partial<Record<EquipmentSlotId, string>> = {};
  const activeFlaskSlots: Partial<Record<EquipmentSlotId, boolean>> = {};
  const usedFlaskSlots = new Set<EquipmentSlotId>();
  const usedCharmSlots = new Set<EquipmentSlotId>();

  const nextFreeSlot = (candidates: EquipmentSlotId[], used: Set<EquipmentSlotId>): EquipmentSlotId | undefined => {
    for (const s of candidates) {
      if (!used.has(s)) {
        used.add(s);
        return s;
      }
    }
    return undefined;
  };

  let ws1SpiritBonus = 0;
  let ws2SpiritBonus = 0;
  let sharedSpiritBonus = 0;

  let itemIdx = 0;
  for (const rawEq of bundle.equipments?.equipments ?? []) {
    itemIdx++;
    const rawBaseZh = cleanWeGameMarkup(rawEq.baseType || rawEq.typeLine) || 'Unknown Base';
    const rawNameZh = cleanWeGameMarkup(rawEq.name) || rawBaseZh;
    const rarity = mapRarity(rawEq.frameType, rawEq.rarity);
    const parsedProps = parseWeGameItemProperties(rawEq.properties, rawBaseZh);
    const isCharm = parsedProps.isCharm || rawBaseZh.includes('咒符') || /Charm$/i.test(rawBaseZh);

    let slot: EquipmentSlotId | undefined;
    if (rawEq.inventoryId === 'Flask') {
      if (isCharm) {
        slot = nextFreeSlot(['Charm 1', 'Charm 2', 'Charm 3'], usedCharmSlots);
      } else if (rawBaseZh.includes('生命') || /Life/i.test(rawBaseZh)) {
        slot = nextFreeSlot(['Flask 1', 'Flask 2'], usedFlaskSlots);
      } else if (rawBaseZh.includes('魔力') || /Mana/i.test(rawBaseZh)) {
        slot = nextFreeSlot(['Flask 2', 'Flask 1'], usedFlaskSlots);
      } else {
        slot = nextFreeSlot(['Flask 1', 'Flask 2'], usedFlaskSlots);
      }
    } else if (rawEq.inventoryId) {
      slot = WEGAME_INVENTORY_TO_SLOT[rawEq.inventoryId];
    }
    if (!slot) continue;

    const matchedUnique =
      rarity === 'UNIQUE' ? uniqueZhBySlot.get(`${rawNameZh}::${slotToUniqueBucket(slot)}`) : undefined;
    const canonicalBase =
      matchedUnique?.baseEn ??
      resolveCanonicalBaseZh(rawBaseZh) ??
      (/^[\x00-\x7F]+$/.test(rawBaseZh) ? rawBaseZh : resolveCanonicalBaseFallback(rawBaseZh, rawEq.properties));
    const canonicalName = matchedUnique?.nameEn ?? rawNameZh;
    const baseName = canonicalBase;
    const name = canonicalName;

    const fallbackStats = getBaseItemStats(baseName, 0, game) ?? getBaseItemStats(rawBaseZh, 0, game);
    const weaponStats = parsedProps.weapon ?? fallbackStats?.weapon;
    const armourStats = parsedProps.armour ?? fallbackStats?.armour;
    const localStatsPrecomputed = Boolean(parsedProps.weapon || parsedProps.armour);

    const hasPrecomputedSpiritProp = Boolean(parsedProps.spirit && parsedProps.spirit > 0);
    const filterLocalSpiritLine = (line: string): boolean =>
      !(hasPrecomputedSpiritProp && /(?:该装备|此装备|此物品)?(?:精魂|Spirit)(?:提高|增加)\s*\d+%|^\d+%\s*increased Spirit$/i.test(line));

    // Extract any equipment-socketed Jewels (e.g. PoE 2 0.5 Grafted / Cardigan's Jewel sockets inside Gloves/Rings)
    const equipSocketedJewelMods: string[] = [];
    let nonSkillSocketedCount = 0;
    for (const si of rawEq.socketedItems ?? []) {
      if (isWeGameGrantedSkillSocket(si)) continue;
      nonSkillSocketedCount++;
      if (isWeGameSocketedJewel(si)) {
        equipSocketedJewelMods.push(
          ...extractModLines(si.implicitMods, notableEnByNorm, notableEnByZh),
          ...extractModLines(si.explicitMods, notableEnByNorm, notableEnByZh),
        );
      }
    }
    const socketCount = Array.isArray(rawEq.sockets) && rawEq.sockets.length > 0 ? rawEq.sockets.length : undefined;
    const filledSocketCount =
      nonSkillSocketedCount > 0
        ? socketCount !== undefined
          ? Math.min(socketCount, nonSkillSocketedCount)
          : nonSkillSocketedCount
        : undefined;

    const implicits = [
      ...(hasPrecomputedSpiritProp ? [`+${parsedProps.spirit} to Spirit`] : []),
      ...extractModLines(rawEq.enchantMods, notableEnByNorm, notableEnByZh).filter(filterLocalSpiritLine),
      ...extractModLines(rawEq.implicitMods, notableEnByNorm, notableEnByZh).filter(filterLocalSpiritLine),
      ...extractModLines(rawEq.runeMods, notableEnByNorm, notableEnByZh).filter(filterLocalSpiritLine),
    ];
    const explicits = [
      ...extractModLines(rawEq.fracturedMods, notableEnByNorm, notableEnByZh).filter(filterLocalSpiritLine),
      ...extractModLines(rawEq.explicitMods, notableEnByNorm, notableEnByZh).filter(filterLocalSpiritLine),
      ...extractModLines(rawEq.craftedMods, notableEnByNorm, notableEnByZh).filter(filterLocalSpiritLine),
      ...equipSocketedJewelMods,
    ];

    // Estimate flat Spirit contribution per weapon set so activeWeaponSet picks the Sceptre set when needed
    let itemFlatSpirit = parsedProps.spirit ?? 0;
    for (const line of [...implicits, ...explicits]) {
      if (line === `+${parsedProps.spirit} to Spirit`) continue;
      const m = line.match(/^(?:\+(\d+)\s*点?(?:最大)?(?:精魂|to Spirit)|(?:最大)?精魂\s*\+?(\d+))$/i);
      if (m) itemFlatSpirit += Number(m[1] || m[2] || 0);
    }
    if (slot === 'Weapon 1' || slot === 'Weapon 2') ws1SpiritBonus += itemFlatSpirit;
    else if (slot === 'Weapon 1 Swap' || slot === 'Weapon 2 Swap') ws2SpiritBonus += itemFlatSpirit;
    else sharedSpiritBonus += itemFlatSpirit;

    const id = rawEq.id ? `wg_${rawEq.id.slice(0, 12)}` : `wg_item_${itemIdx}`;
    items[id] = {
      id,
      name,
      ...(rawNameZh !== name ? { nameZh: rawNameZh } : {}),
      baseName,
      ...(rawBaseZh !== baseName ? { baseNameZh: rawBaseZh } : {}),
      rarity,
      slotType: slot,
      quality: parsedProps.quality,
      ...(socketCount !== undefined ? { socketCount, sockets: Array(socketCount).fill('S').join(' ') } : {}),
      ...(filledSocketCount !== undefined ? { filledSocketCount } : {}),
      weaponStats,
      armourStats,
      implicits,
      explicits,
      localStatsPrecomputed,
    };
    equipped[slot] = id;
    if (slot.startsWith('Flask ') || slot.startsWith('Charm ')) {
      activeFlaskSlots[slot] = true;
    }
  }

  // Passive tree jewels (stored in items & summarized in notes)
  const rawJewelList: WeGameRawJewelSlot[] = (() => {
    const jd = bundle.jewels?.jewel_data;
    if (Array.isArray(jd)) return jd;
    if (typeof jd === 'string' && jd.trim()) {
      try {
        const parsed = JSON.parse(jd);
        return Array.isArray(parsed) ? (parsed as WeGameRawJewelSlot[]) : [];
      } catch {
        return [];
      }
    }
    return [];
  })();

  // Exact PoE 2 0.5 PassiveJewel_<index> -> passive tree jewel socket nodeId mapping
  // (critical for radius jewels like Against the Darkness, Time-Lost Jewels, and Controlled Metamorphosis)
  const POE2_PASSIVE_JEWEL_SOCKET_TO_NODE: Record<number, number> = {
    0: 26725,
    4: 60735,
    5: 61834,
    11: 7960,
    12: 46882,
    13: 55190,
    14: 61419,
    15: 2491,
    16: 54127,
    17: 32763,
    18: 26196,
    20: 21984,
  };
  const JEWEL_UNIQUE_ZH_TO_EN: Record<string, string> = {
    抗衡黑暗: 'Against the Darkness',
    妄想症: 'Megalomaniac',
    可控变形: 'Controlled Metamorphosis',
    无根之源: 'From Nothing',
    人格分裂: 'Split Personality',
    泉井之心: 'Heart of the Well',
    信念的棱镜: 'Prism of Belief',
    英雄的悲歌: 'Heroic Tragedy',
    天神之音: 'Voices',
  };
  const JEWEL_BASE_ZH_TO_EN: Record<string, string> = {
    失落的宝钻: 'Time-Lost Diamond',
    失落的翡翠: 'Time-Lost Emerald',
    失落的蓝玉: 'Time-Lost Sapphire',
    失落的红玉: 'Time-Lost Ruby',
    永恒珠宝: 'Timeless Jewel',
    宝钻: 'Diamond',
    翡翠: 'Emerald',
    蓝玉: 'Sapphire',
    红玉: 'Ruby',
  };

  const jewelSummaries: string[] = [];
  const parsedJewels: Array<{ id: string; socketIdx?: number; mods: string[] }> = [];
  rawJewelList.forEach((slotEntry, idx) => {
    const j = slotEntry.jewel;
    if (!j) return;
    const rawJName = cleanWeGameMarkup(j.display_name || j.name) || `Jewel ${idx + 1}`;
    const rawJBase = cleanWeGameMarkup(j.name) || 'Jewel';
    const jRarity = mapRarity(j.rarity);
    const jName = (jRarity === 'UNIQUE' ? JEWEL_UNIQUE_ZH_TO_EN[rawJName] : undefined) ?? rawJName;
    const jBase = JEWEL_BASE_ZH_TO_EN[rawJBase] ?? rawJBase;
    const jMods: string[] = [];
    for (const md of j.mod_descriptions ?? []) {
      jMods.push(...extractModLines(md.values, notableEnByNorm, notableEnByZh));
    }
    const id = j.id ? `wg_jewel_${j.id.slice(0, 12)}` : `wg_jewel_${idx + 1}`;
    items[id] = {
      id,
      name: jName,
      ...(rawJName !== jName ? { nameZh: rawJName } : {}),
      baseName: jBase,
      ...(rawJBase !== jBase ? { baseNameZh: rawJBase } : {}),
      rarity: jRarity,
      slotType: 'Any',
      quality: 0,
      implicits: [],
      explicits: jMods,
      localStatsPrecomputed: false,
    };
    const mSockIdx = slotEntry.socket_id?.match(/PassiveJewel_(\d+)/i);
    const socketIdx = mSockIdx ? Number(mSockIdx[1]) : undefined;
    parsedJewels.push({ id, socketIdx, mods: jMods });
    jewelSummaries.push(`- ${slotEntry.socket_name || slotEntry.socket_id || `Jewel ${idx + 1}`}: ${rawJName} (${rawJBase})${jMods.length ? ` — ${jMods.join(' / ')}` : ''}`);
  });

  // Socket parsed passive jewels into their exact allocated jewel socket nodes on the passive tree.
  // Any overflow jewels (e.g. Sinister/Ascendancy extra sockets PassiveJewel_24/25/26/30) preserve
  // their non-radius mods via customMods so equipped jewel stats are never dropped.
  const allocatedJewelNodes = [...hashSet]
    .filter((id) => tree.nodes[id]?.kind === 'jewel')
    .sort((a, b) => a - b);
  const allocatedJewelNodeSet = new Set(allocatedJewelNodes);
  const socketedJewels: Record<number, string> = {};
  const unmappedJewels: Array<{ id: string; mods: string[] }> = [];
  for (const pj of parsedJewels) {
    const exactNodeId =
      pj.socketIdx !== undefined ? POE2_PASSIVE_JEWEL_SOCKET_TO_NODE[pj.socketIdx] : undefined;
    if (exactNodeId !== undefined && allocatedJewelNodeSet.has(exactNodeId) && !socketedJewels[exactNodeId]) {
      socketedJewels[exactNodeId] = pj.id;
    } else {
      unmappedJewels.push({ id: pj.id, mods: pj.mods });
    }
  }
  const freeAllocatedJewelNodes = allocatedJewelNodes.filter((nid) => !socketedJewels[nid]);
  const extraJewelMods: string[] = [];
  for (const uj of unmappedJewels) {
    const freeNode = freeAllocatedJewelNodes.shift();
    if (freeNode !== undefined) {
      socketedJewels[freeNode] = uj.id;
    } else {
      for (const line of uj.mods) {
        if (!/in Radius|Ring|Upgrades radius/i.test(line)) {
          extraJewelMods.push(line);
        }
      }
    }
  }

  // Skills & Support Gems
  const skills: SkillGroup[] = [];
  const seenBareActiveIds = new Set<string>();
  let groupIdx = 0;
  let totalReservedSpirit = 0;

  for (const rawSk of bundle.skills?.skills ?? []) {
    const activeDef = matchGem(rawSk.baseType || rawSk.typeLine);
    if (!activeDef) continue;

    const supportList = rawSk.socketedItems ?? [];
    // Deduplicate bare weapon-granted skills (e.g. duplicate Spear Throw with 0 supports)
    if (supportList.length === 0 && seenBareActiveIds.has(activeDef.id)) {
      continue;
    }
    if (supportList.length === 0) {
      seenBareActiveIds.add(activeDef.id);
    }

    groupIdx++;
    const { level, quality, spiritReservation } = extractGemLevelAndQuality(rawSk.properties);
    // Item/Ascendancy-granted skills without an explicit reservation property reserve 0 Spirit (e.g. Sceptre Purity of Fire)
    const isItemOrAscGranted = !rawSk.inventoryId || rawSk.inventoryId === 'AscendancySkills';
    const spiritReservationOverride =
      spiritReservation !== undefined
        ? spiritReservation
        : isItemOrAscGranted && activeDef.isAuraOrBuff
          ? 0
          : undefined;
    totalReservedSpirit += spiritReservationOverride ?? activeDef.spiritReservation ?? 0;

    const groupGems: GemInstance[] = [
      {
        instanceId: `wg_g_${groupIdx}_0`,
        gemId: activeDef.id,
        level,
        quality,
        enabled: true,
        ...(spiritReservationOverride !== undefined ? { spiritReservationOverride } : {}),
      },
    ];

    supportList.forEach((rawSup, si) => {
      const supDef = matchGem(rawSup.baseType || rawSup.typeLine);
      if (!supDef) return;
      const supMeta = extractGemLevelAndQuality(rawSup.properties);
      groupGems.push({
        instanceId: `wg_g_${groupIdx}_${si + 1}`,
        gemId: supDef.id,
        level: supMeta.level,
        quality: supMeta.quality,
        enabled: true,
      });
    });

    skills.push({
      id: `wg_sg_${groupIdx}`,
      label: cleanWeGameMarkup(rawSk.baseType || activeDef.name.zh || activeDef.name.en),
      enabled: true,
      weaponSets: [1, 2],
      gems: groupGems,
    });
  }

  // Build normalized lookup of WeGame roleProfile top DPS skills (sorted descending)
  const profileRankByNorm = new Map<string, number>();
  const sortedProfileSkills = [...(bundle.roleProfile?.skills ?? [])]
    .filter((s) => s.name && Number(s.total_dps) > 0)
    .sort((a, b) => Number(b.total_dps) - Number(a.total_dps));
  sortedProfileSkills.forEach((s, idx) => {
    const norm = s.name!.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm && !profileRankByNorm.has(norm)) {
      profileRankByNorm.set(norm, Math.max(10, 60 - idx * 15));
    }
  });

  // Pick best non-aura active skill group (prefer WeGame top-DPS match & most linked supports)
  let mainSkillGroupId = skills[0]?.id ?? '';
  let bestScore = -1;
  for (const sg of skills) {
    const primaryDef = gemsCatalog.find((g) => g.id === sg.gems[0]?.gemId);
    const isAttackOrSpell = Boolean(primaryDef && primaryDef.category === 'active' && !primaryDef.isAuraOrBuff);
    let profileBonus = 0;
    for (const gemInst of sg.gems) {
      const def = gemsCatalog.find((g) => g.id === gemInst.gemId);
      if (!def) continue;
      const normEn = def.name.en.toLowerCase().replace(/[^a-z0-9]/g, '');
      const rank = profileRankByNorm.get(normEn);
      if (rank) {
        const weighted = gemInst === sg.gems[0] ? rank : Math.round(rank * 0.7);
        if (weighted > profileBonus) profileBonus = weighted;
      }
    }
    const isMinion = primaryDef?.tags.some((t) => t.toLowerCase() === 'minion') ?? false;
    const isUtilitySkill =
      Boolean(
        primaryDef &&
          (primaryDef.tags.some((t) => /^(?:mark|curse|guard|warcry|travel|movement|meta)$/i.test(t)) ||
            /\b(?:mark|curse|barrage|blink)\b/i.test(primaryDef.name.en)),
      );
    const primaryLevel = sg.gems[0]?.level ?? 20;
    const lowLevelUtilityPenalty = primaryLevel <= 5 ? -45 : 0;
    const score =
      (isAttackOrSpell ? 100 : 0) +
      (isUtilitySkill ? -45 : 0) +
      (isMinion ? -15 : 0) +
      lowLevelUtilityPenalty +
      profileBonus +
      sg.gems.length * 10;
    if (score > bestScore) {
      bestScore = score;
      mainSkillGroupId = sg.id;
    }
  }

  if (skills.length === 0 && gemsCatalog.length > 0) {
    const fallbackGem = gemsCatalog.find((g) => g.category === 'active' && !g.isAuraOrBuff) ?? gemsCatalog[0]!;
    skills.push({
      id: 'wg_sg_default',
      label: fallbackGem.name.zh || fallbackGem.name.en,
      enabled: true,
      weaponSets: [1, 2],
      gems: [{ instanceId: 'wg_g_0', gemId: fallbackGem.id, level: 20, quality: 0, enabled: true }],
    });
    mainSkillGroupId = 'wg_sg_default';
  }

  const level = Math.max(1, Math.min(100, Number(role?.level) || 90));
  const charName = cleanWeGameMarkup(role?.name);
  const buildName = charName
    ? `${charName} (Lv.${level})`
    : `${rawClassName || classId} (Lv.${level})`;

  const noteLines: string[] = [
    `Imported from WeGame PoE 2 Helper (${rawClassName || classId}, Lv.${level}).`,
  ];
  const refSkills = (bundle.roleProfile?.skills ?? []).filter((s) => Number(s.total_dps) > 0);
  if (refSkills.length > 0) {
    noteLines.push(
      '',
      'WeGame Reference Panel DPS:',
      ...refSkills.map((s) => `- ${s.name}: ${Number(s.total_dps).toLocaleString('en-US')}`),
    );
  }
  const questStats = (rawTree?.quest_stats ?? []).map((q) => cleanWeGameMarkup(q)).filter(Boolean);
  if (questStats.length > 0) {
    noteLines.push('', 'Quest / Permanent Bonuses:', ...questStats.map((q) => `- ${q}`));
  }
  if (jewelSummaries.length > 0) {
    noteLines.push('', 'Socketed Passive Jewels:', ...jewelSummaries);
  }

  // Apply optional/choice PoE 2 campaign quest bonuses as NET DELTAS over fixed campaign baselines
  // already built into POE2_RULESET (+100 Spirit, +20 Life, +5% inc Life, +5% inc Mana,
  // and Act 1-3 +10% Fire/Cold/Lightning Res baked into net -50% endgameResistPenalty).
  const applicableQuestStats: string[] = [];
  for (const rawQ of rawTree?.quest_stats ?? []) {
    const enQ = normalizeStatLineToEn(rawQ);
    if (!enQ || /毁面首领|咒符栏|BrokenFace|Charm Slot/i.test(enQ)) continue;
    const mSpirit = enQ.match(/^\+?(\d+)\s+to Spirit$/i);
    if (mSpirit) {
      const delta = Number(mSpirit[1]) - 100;
      if (delta !== 0) applicableQuestStats.push(`${delta > 0 ? '+' : ''}${delta} to Spirit`);
      continue;
    }
    const mFlatLife = enQ.match(/^\+?(\d+)\s+to maximum Life$/i);
    if (mFlatLife) {
      const delta = Number(mFlatLife[1]) - 20;
      if (delta > 0) applicableQuestStats.push(`+${delta} to maximum Life`);
      continue;
    }
    const mIncLife = enQ.match(/^(\d+)% increased maximum Life$/i);
    if (mIncLife) {
      const delta = Number(mIncLife[1]) - 5;
      if (delta > 0) applicableQuestStats.push(`${delta}% increased maximum Life`);
      continue;
    }
    const mIncMana = enQ.match(/^(\d+)% increased maximum Mana$/i);
    if (mIncMana) {
      const delta = Number(mIncMana[1]) - 5;
      if (delta > 0) applicableQuestStats.push(`${delta}% increased maximum Mana`);
      continue;
    }
    const mEleRes = enQ.match(/^\+?(\d+)% to (Fire|Cold|Lightning) Resistance$/i);
    if (mEleRes) {
      const delta = Number(mEleRes[1]) - 10;
      if (delta !== 0) applicableQuestStats.push(`${delta > 0 ? '+' : ''}${delta}% to ${mEleRes[2]} Resistance`);
      continue;
    }
    applicableQuestStats.push(enQ);
  }
  const allCustomMods = [...applicableQuestStats, ...extraJewelMods];
  const config = {
    ...createDefaultConfig(),
    ...(allCustomMods.length > 0 ? { customMods: allCustomMods.join('\n') } : {}),
  };

  // Auto-select Weapon Set 2 if Weapon Set 2 holds a Spirit Sceptre needed to cover Spirit reservations
  const ws1SpiritTotal = 100 + sharedSpiritBonus + ws1SpiritBonus;
  const activeWeaponSet: 1 | 2 =
    ws2SpiritBonus > ws1SpiritBonus && totalReservedSpirit > ws1SpiritTotal ? 2 : 1;

  return {
    id: `wegame_${Date.now()}`,
    name: buildName,
    game,
    level,
    classId,
    ascendancyId,
    activeWeaponSet,
    bandit: 'None',
    tree: {
      title: `${buildName} Tree`,
      treeVersion: tree.version,
      allocatedNodeIds: [...hashSet],
      weaponSet1NodeIds,
      weaponSet2NodeIds,
      masteryEffects: {},
      ...(Object.keys(attributeOverrides).length > 0 ? { attributeOverrides } : {}),
      ...(Object.keys(nodeOverrides).length > 0 ? { nodeOverrides } : {}),
      ...(Object.keys(socketedJewels).length > 0 ? { socketedJewels } : {}),
    },
    skills,
    mainSkillGroupId,
    items,
    equipped,
    ...(Object.keys(activeFlaskSlots).length > 0 ? { activeFlaskSlots } : {}),
    config,
    notes: noteLines.join('\n'),
  };
}

async function postWeGameEndpoint<T>(
  endpoint: string,
  payload: Record<string, unknown>,
  corsProxyBase?: string,
): Promise<T> {
  const fullEndpoint = `${WEGAME_POE2_API_BASE}/${endpoint}`;
  const proxyBase = corsProxyBase?.trim().replace(/\/+$/, '');
  const fetchUrl = proxyBase
    ? `${proxyBase}?url=${encodeURIComponent(fullEndpoint)}`
    : fullEndpoint;

  const res = await fetch(fetchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`WeGame ${endpoint} failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { result?: { error_code?: number; error_message?: string } } & T;
  if (data.result && data.result.error_code !== undefined && data.result.error_code !== 0) {
    throw new Error(`WeGame ${endpoint} error: ${data.result.error_message || data.result.error_code}`);
  }
  return data;
}

/**
 * Fetches a public WeGame PoE 2 Helper share link (zero login / zero cookies)
 * via the CORS proxy and converts it into a complete WebPoB `Build`.
 */
export async function fetchWeGamePoe2Build(
  shareUrlOrCode: string,
  corsProxyBase?: string,
): Promise<Build> {
  const shareCode =
    extractWeGamePoe2ShareCode(shareUrlOrCode) ??
    (/^[A-Za-z0-9_=-]{16,256}$/.test(shareUrlOrCode.trim()) ? shareUrlOrCode.trim() : null);

  if (!shareCode) {
    throw new Error('Invalid WeGame PoE 2 share link.');
  }

  const baseReq = { share_code: shareCode, area: 0, from_src: 'poe2_helper' };
  const roleInfo = await postWeGameEndpoint<NonNullable<WeGamePoe2Bundle['roleInfo']>>(
    'GetRoleInfo',
    baseReq,
    corsProxyBase,
  );
  const roleId = roleInfo.role?.role_id;
  if (!roleId) {
    throw new Error('WeGame share link did not return a valid character role.');
  }

  const detailReq = { ...baseReq, role_id: roleId };
  const [talentTree, equipments, skills, jewels, roleProfile] = await Promise.all([
    postWeGameEndpoint<NonNullable<WeGamePoe2Bundle['talentTree']>>('GetTalentTree', detailReq, corsProxyBase),
    postWeGameEndpoint<NonNullable<WeGamePoe2Bundle['equipments']>>('GetEquipments', detailReq, corsProxyBase),
    postWeGameEndpoint<NonNullable<WeGamePoe2Bundle['skills']>>('GetSkills', detailReq, corsProxyBase),
    postWeGameEndpoint<NonNullable<WeGamePoe2Bundle['jewels']>>('GetJewels', detailReq, corsProxyBase).catch(() => undefined),
    postWeGameEndpoint<NonNullable<WeGamePoe2Bundle['roleProfile']>>('GetRoleProfile', detailReq, corsProxyBase).catch(() => undefined),
  ]);

  return parseWeGamePoe2Build({
    shareCode,
    roleInfo,
    roleProfile,
    talentTree,
    equipments,
    skills,
    jewels,
  });
}
