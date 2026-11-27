import {
  KeywordFlag,
  ModFlag,
  type CharacterClassDef,
  type CompiledGemMod,
  type DamageType,
  type GameId,
  type GemDefinition,
  type Locale,
  type ModTag,
  type ModType,
  type PassiveNode,
  type PassiveTreeData,
} from '@webpob/core';
import { getGemsForGame, POE1_GEMS, POE2_GEMS, setRegisteredGems } from './gems.js';
import { getClassesForGame, registerClassesData } from './classes.js';
import { getTreeForGame, hasOfficialTreeLoaded, registerTreeData, setLatestTreeVersion } from './trees.js';
import {
  applyLocaleOverlayToClasses,
  applyLocaleOverlayToGems,
  applyLocaleOverlayToTree,
} from './localeOverlay.js';

export interface CompactTreeNode {
  id: number;
  en: string;
  zh?: string;
  k: 's' | 'n' | 'K' | 'M' | 'J' | 'S';
  x: number;
  y: number;
  g?: number;
  o?: number;
  r?: number;
  a?: number;
  st?: string[];
  sz?: string[];
  adj: number[];
  cs?: string;
  asc?: string;
  me?: Array<{ id: number; st: string[]; sz?: string[] }>;
}

export interface CompactTreePayload {
  game: GameId;
  version: string;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  classStartNodeIds: Record<string, number>;
  groups: Record<number, { x: number; y: number }>;
  nodes: CompactTreeNode[];
}

export interface CompactCompiledMod {
  n: string;
  t: ModType;
  v: number | boolean | string;
  f?: number;
  k?: number;
  tg?: 'skill' | 'player' | 'enemy' | 'minion';
  tags?: ModTag[];
}

export interface CompactMinionBase {
  pMin: number;
  pMax: number;
  aps: number;
  cc: number;
  cm: number;
  moreAps?: number;
  ele?: Partial<Record<DamageType, [number, number]>>;
  limitStat?: string;
  baseLimit?: number;
}

export interface CompactGemLevelEntry {
  bd?: Partial<Record<DamageType, [number, number]>>;
  am?: number;
  de?: number;
  mc?: number;
  st?: string[];
  cmods?: CompactCompiledMod[];
  sdata?: Record<string, number>;
}

export interface CompactGemsPayload {
  game: GameId;
  count: number;
  gems: Array<{
    id: string;
    altIds?: string[];
    en: string;
    zh?: string;
    cat: 'active' | 'support';
    color: 'red' | 'green' | 'blue' | 'white';
    tags: string[];
    stypes?: string[];
    reqTypes?: string[];
    addTypes?: string[];
    excTypes?: string[];
    ct?: number;
    cd?: number;
    dm?: number;
    cc?: number;
    asm?: number;
    mrp?: number;
    mrf?: number;
    sr?: number;
    bd?: Partial<Record<DamageType, [number, number]>>;
    am?: number;
    de?: number;
    mc?: number;
    st?: string[];
    cmods?: CompactCompiledMod[];
    sdata?: Record<string, number>;
    mb?: CompactMinionBase;
    qs?: Array<{ t: string; q: number }> | Record<string, never>;
    ls?: Record<string, CompactGemLevelEntry>;
  }>;
}

const KIND_MAP: Record<CompactTreeNode['k'], PassiveNode['kind']> = {
  s: 'small',
  n: 'notable',
  K: 'keystone',
  M: 'mastery',
  J: 'jewel',
  S: 'start',
};

const loadedGemsFlag: Partial<Record<GameId, boolean>> = {};

const getClassesFallback = (game: GameId): CharacterClassDef[] => getClassesForGame(game);

export const OFFICIAL_TREE_FILES: Record<GameId, string> = {
  poe1: 'poe1-tree-3_30.json',
  poe2: 'poe2-tree-0_5.json',
};

export const OFFICIAL_CLASSES_FILES: Record<GameId, string> = {
  poe1: 'poe1-classes.json',
  poe2: 'poe2-classes.json',
};

/**
 * Display-layer data contract published by the data pipeline in
 * `apps/web/public/data/manifest.json`. Lets the frontend discover tree versions,
 * classes and other datasets without any hardcoded `3_30` / `0_5` constants.
 */
export interface DataManifestGame {
  latestTreeVersion: string;
  trees: Record<string, string>;
  classes: string;
  gems: string;
  bases: string;
  uniques: string;
  clusters?: string;
  ascendancyArt?: string;
  /** Optional on-demand locale overlay files (e.g. `{ "zh-TW": "poe1-i18n-zh-TW.json" }`). */
  i18n?: Partial<Record<Locale, string>>;
}

export interface DataManifest {
  schemaVersion: number;
  generatedAt: string;
  source: string;
  games: Record<GameId, DataManifestGame>;
}

let cachedManifest: DataManifest | null = null;
let manifestLoadPromise: Promise<DataManifest | null> | null = null;

const normalizeVersionKey = (version?: string): string =>
  String(version ?? '').trim().toLowerCase().replace(/^v/, '').replace(/[.-]/g, '_');

/** Registers a manifest in memory (e.g. from `fetch` or a Vite JSON import). */
export function registerDataManifest(manifest: DataManifest | null): void {
  cachedManifest = manifest;
  manifestLoadPromise = null;
}

/** Returns the currently cached manifest, if one has been loaded. */
export function getDataManifest(): DataManifest | null {
  return cachedManifest;
}

/**
 * Fetches and caches `manifest.json`. Returns `null` (without throwing) when the
 * manifest is unavailable so unit tests / offline builds fall back to the
 * hardcoded `OFFICIAL_TREE_FILES` constants.
 */
export async function loadDataManifest(basePath = '/data'): Promise<DataManifest | null> {
  if (cachedManifest) return cachedManifest;
  if (manifestLoadPromise) return manifestLoadPromise;
  const url = `${basePath.replace(/\/+$/, '')}/manifest.json`;
  manifestLoadPromise = (async () => {
    try {
      if (typeof fetch !== 'function') return null;
      const res = await fetch(url);
      if (!res.ok) return null;
      const manifest = (await res.json()) as DataManifest;
      if (!manifest || !manifest.games) return null;
      cachedManifest = manifest;
      return manifest;
    } catch {
      return null;
    }
  })();
  return manifestLoadPromise;
}

/** Resolves the tree filename for `game`/`treeVersion` from the manifest, if available. */
export function resolveTreeFileFromManifest(
  manifest: DataManifest | null,
  game: GameId,
  treeVersion?: string,
): string | undefined {
  const entry = manifest?.games?.[game];
  if (!entry?.trees) return undefined;
  const key = normalizeVersionKey(treeVersion);
  if (key && entry.trees[key]) return entry.trees[key];
  if (key) {
    const match = Object.keys(entry.trees).find((k) => normalizeVersionKey(k) === key);
    if (match) return entry.trees[match];
  }
  const latest = entry.latestTreeVersion;
  if (latest && entry.trees[latest]) return entry.trees[latest];
  const latestKey = Object.keys(entry.trees).find((k) => normalizeVersionKey(k) === normalizeVersionKey(latest));
  if (latestKey) return entry.trees[latestKey];
  const first = Object.values(entry.trees)[0];
  return first;
}

export const OFFICIAL_GEMS_FILES: Record<GameId, string> = {
  poe1: 'poe1-gems.json',
  poe2: 'poe2-gems.json',
};

export function hydrateCompactTree(payload: CompactTreePayload): PassiveTreeData {
  const nodes: Record<number, PassiveNode> = {};
  for (const cn of payload.nodes) {
    nodes[cn.id] = {
      id: cn.id,
      name: { en: cn.en, zh: cn.zh ?? cn.en },
      kind: KIND_MAP[cn.k],
      x: cn.x,
      y: cn.y,
      group: cn.g,
      orbit: cn.o,
      orbitRadius: cn.r,
      angle: cn.a,
      stats: cn.st ?? [],
      statsZh: cn.sz,
      adjacent: cn.adj,
      classStartId: cn.cs,
      ascendancyId: cn.asc,
      masteryEffects: cn.me?.map((m) => ({
        id: m.id,
        stats: m.st,
        statsZh: m.sz,
      })),
    };
  }

  const tree: PassiveTreeData = {
    game: payload.game,
    version: payload.version,
    isOfficialFull: true,
    bounds: payload.bounds,
    groups: payload.groups,
    nodes,
    classStartNodeIds: payload.classStartNodeIds,
  };
  applyLocaleOverlayToTree(tree);
  return tree;
}

/**
 * Lazily fetches and hydrates the full official passive tree from static
 * `/data/*.json` assets. The filename is resolved from `manifest.json` when
 * available (so future `1_0` / season trees ship without client changes), with a
 * graceful fallback to `OFFICIAL_TREE_FILES` in unit tests / offline builds.
 *
 * Pass `treeVersion` to load a specific historical tree (keeps old share links
 * rendering their original passives).
 */
export async function loadOfficialTree(
  game: GameId,
  basePath = '/data',
  treeVersion?: string,
): Promise<PassiveTreeData> {
  const requested = normalizeVersionKey(treeVersion);

  if (requested && hasOfficialTreeLoaded(game, requested)) {
    return getTreeForGame(game, requested);
  }
  if (!requested && hasOfficialTreeLoaded(game)) {
    return getTreeForGame(game);
  }

  const manifest = await loadDataManifest(basePath);
  const file = resolveTreeFileFromManifest(manifest, game, treeVersion) ?? OFFICIAL_TREE_FILES[game];
  const url = `${basePath.replace(/\/+$/, '')}/${file}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (hasOfficialTreeLoaded(game)) return getTreeForGame(game, treeVersion);
    throw new Error(`Failed to load official ${game} tree (${res.status})`);
  }
  const payload = (await res.json()) as CompactTreePayload;
  const hydrated = hydrateCompactTree(payload);
  // Honour the exact version the caller asked for even if the payload's own version
  // string differs (manifest keys are the source of truth for lookups).
  const tree =
    requested && normalizeVersionKey(hydrated.version) !== requested
      ? { ...hydrated, version: requested }
      : hydrated;
  registerTreeData(tree);
  // Pin the manifest's latest version as the active tree even when we just loaded a
  // historical version for an old share link.
  const manifestLatest = manifest?.games?.[game]?.latestTreeVersion;
  if (manifestLatest) setLatestTreeVersion(game, manifestLatest);
  return tree;
}

/**
 * Loads the pipeline-provided class/ascendancy table for `game` and registers it
 * so `getClassesForGame` returns dynamic (not hardcoded) classes.
 */
export async function loadOfficialClasses(
  game: GameId,
  basePath = '/data',
): Promise<CharacterClassDef[]> {
  const manifest = await loadDataManifest(basePath);
  const file = manifest?.games?.[game]?.classes ?? OFFICIAL_CLASSES_FILES[game];
  const url = `${basePath.replace(/\/+$/, '')}/${file}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return getClassesFallback(game);
    const payload = (await res.json()) as {
      game?: GameId;
      version?: string;
      classes?: CharacterClassDef[];
    };
    const classes = payload?.classes;
    if (!Array.isArray(classes) || classes.length === 0) return getClassesFallback(game);
    applyLocaleOverlayToClasses(game, classes);
    return registerClassesData(game, classes);
  } catch {
    return getClassesFallback(game);
  }
}

function hydrateStringList(list?: string[]): string[] | undefined {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list;
}

function hydrateCompiledMods(cmods?: CompactCompiledMod[]): CompiledGemMod[] | undefined {
  if (!Array.isArray(cmods) || cmods.length === 0) return undefined;
  return cmods.map((m) => ({
    name: m.n,
    type: m.t,
    value: m.v,
    flags: m.f ?? 0,
    keywordFlags: m.k ?? 0,
    ...(m.tg !== undefined ? { target: m.tg } : {}),
    ...(Array.isArray(m.tags) && m.tags.length > 0 ? { tags: m.tags } : {}),
  }));
}

function hydrateSkillData(sdata?: Record<string, number>): Record<string, number> | undefined {
  if (!sdata || typeof sdata !== 'object' || Array.isArray(sdata)) return undefined;
  if (Object.keys(sdata).length === 0) return undefined;
  return { ...sdata };
}

function hydrateMinionBase(mb?: CompactMinionBase): GemDefinition['minionBase'] | undefined {
  if (!mb || typeof mb !== 'object') return undefined;
  return {
    physicalMin: mb.pMin,
    physicalMax: mb.pMax,
    attacksPerSecond: mb.aps,
    critChance: mb.cc,
    critMultiplier: mb.cm,
    ...(mb.moreAps !== undefined ? { moreAttackSpeedPct: mb.moreAps } : {}),
    ...(mb.ele && Object.keys(mb.ele).length > 0 ? { elementalDamage: mb.ele } : {}),
    ...(mb.limitStat !== undefined ? { limitStat: mb.limitStat } : {}),
    ...(mb.baseLimit !== undefined ? { baseLimit: mb.baseLimit } : {}),
  };
}

function mergeAltIds(
  existing?: string[],
  officialAltIds?: string[],
  officialId?: string,
): string[] | undefined {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (val?: string) => {
    const trimmed = val?.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push(trimmed);
  };
  if (Array.isArray(existing)) for (const id of existing) push(id);
  if (Array.isArray(officialAltIds)) for (const id of officialAltIds) push(id);
  push(officialId);
  return out.length > 0 ? out : undefined;
}

function hydrateLevelScaling(
  ls?: Record<string, CompactGemLevelEntry>,
): GemDefinition['levelScaling'] | undefined {
  if (!ls) return undefined;
  const out: NonNullable<GemDefinition['levelScaling']> = {};
  let count = 0;
  for (const [lvStr, snap] of Object.entries(ls)) {
    const lv = Number(lvStr);
    if (!Number.isFinite(lv)) continue;
    const compiledMods = hydrateCompiledMods(snap.cmods);
    const skillData = hydrateSkillData(snap.sdata);
    out[lv] = {
      ...(snap.bd ? { baseDamage: snap.bd } : {}),
      ...(snap.am !== undefined ? { attackDamageMultiplierPct: snap.am } : {}),
      ...(snap.de !== undefined ? { damageEffectivenessPct: snap.de } : {}),
      ...(snap.mc !== undefined ? { manaCost: snap.mc } : {}),
      ...(snap.st && snap.st.length > 0 ? { stats: snap.st } : {}),
      ...(compiledMods ? { compiledMods } : {}),
      ...(skillData ? { skillData } : {}),
    };
    count++;
  }
  return count > 0 ? out : undefined;
}

function hydrateQualityStats(
  qs?: Array<{ t: string; q: number }> | Record<string, never>,
): GemDefinition['qualityStats'] | undefined {
  if (!qs) return undefined;
  if (!Array.isArray(qs)) return [];
  return qs.map((row) => ({ template: row.t, perQuality: row.q }));
}

function synthesizeGemDefinition(
  game: GameId,
  entry: CompactGemsPayload['gems'][number],
): GemDefinition {
  const tagSet = new Set(entry.tags.map((t) => t.toLowerCase()));
  const isSpell = tagSet.has('spell');
  const isAttack = tagSet.has('attack');
  const isAura =
    tagSet.has('aura') ||
    tagSet.has('herald') ||
    (entry.mrp ?? 0) > 0 ||
    (entry.mrf ?? 0) > 0 ||
    (entry.sr ?? 0) > 0;

  let modFlags = ModFlag.None;
  let kwFlags = KeywordFlag.None;
  if (isAttack) {
    modFlags |= ModFlag.Attack | ModFlag.Hit;
    kwFlags |= KeywordFlag.Attack | KeywordFlag.Hit;
  }
  if (isSpell) {
    modFlags |= ModFlag.Spell | ModFlag.Hit;
    kwFlags |= KeywordFlag.Spell | KeywordFlag.Hit;
  }
  if (tagSet.has('projectile')) modFlags |= ModFlag.Projectile;
  if (tagSet.has('melee')) modFlags |= ModFlag.Melee;
  if (tagSet.has('area')) modFlags |= ModFlag.Area;
  if (tagSet.has('bow')) modFlags |= ModFlag.Bow;
  if (tagSet.has('fire')) kwFlags |= KeywordFlag.Fire;
  if (tagSet.has('cold')) kwFlags |= KeywordFlag.Cold;
  if (tagSet.has('lightning')) kwFlags |= KeywordFlag.Lightning;
  if (tagSet.has('chaos')) kwFlags |= KeywordFlag.Chaos;
  if (tagSet.has('physical')) kwFlags |= KeywordFlag.Physical;

  const altIds = hydrateStringList(entry.altIds);
  const skillTypes = hydrateStringList(entry.stypes);
  const requireSkillTypes = hydrateStringList(entry.reqTypes);
  const addSkillTypes = hydrateStringList(entry.addTypes);
  const excludeSkillTypes = hydrateStringList(entry.excTypes);
  const compiledMods = hydrateCompiledMods(entry.cmods);
  const skillData = hydrateSkillData(entry.sdata);
  const minionBase = hydrateMinionBase(entry.mb);
  const qualityStats = hydrateQualityStats(entry.qs);
  const levelScaling = hydrateLevelScaling(entry.ls);

  const structuredFields = {
    ...(altIds ? { altIds } : {}),
    ...(skillTypes ? { skillTypes } : {}),
    ...(requireSkillTypes ? { requireSkillTypes } : {}),
    ...(addSkillTypes ? { addSkillTypes } : {}),
    ...(excludeSkillTypes ? { excludeSkillTypes } : {}),
    ...(compiledMods ? { compiledMods } : {}),
    ...(skillData ? { skillData } : {}),
    ...(minionBase ? { minionBase } : {}),
  };

  if (entry.cat === 'support') {
    const officialStats = Array.isArray(entry.st) ? entry.st : [];
    return {
      id: entry.id,
      name: { en: entry.en, zh: entry.zh ?? entry.en },
      category: 'support',
      game,
      color: entry.color,
      tags: entry.tags,
      modFlags,
      keywordFlags: kwFlags,
      stats: officialStats,
      ...structuredFields,
      ...(qualityStats ? { qualityStats } : {}),
      ...(levelScaling ? { levelScaling } : {}),
    };
  }

  // Active gem: prefer official Lua-exported Lv.20 numbers when present, fallback otherwise
  const primaryDamageType = tagSet.has('fire')
    ? 'Fire'
    : tagSet.has('cold')
      ? 'Cold'
      : tagSet.has('lightning')
        ? 'Lightning'
        : tagSet.has('chaos')
          ? 'Chaos'
          : 'Physical';

  const officialStats = Array.isArray(entry.st) ? entry.st : [];

  const isFreeItemAura =
    game === 'poe2' &&
    /^(?:Purity of Fire|Purity of Ice|Purity of Lightning|Discipline|Malice)$/i.test(entry.en.trim());

  return {
    id: entry.id,
    name: { en: entry.en, zh: entry.zh ?? entry.en },
    category: 'active',
    game,
    color: entry.color,
    tags: entry.tags,
    modFlags,
    keywordFlags: kwFlags,
    isAuraOrBuff: isAura,
    ...structuredFields,
    ...(entry.cd && entry.cd > 0 ? { cooldown: entry.cd } : {}),
    ...(entry.dm && entry.dm > 1 ? { dpsMultiplier: entry.dm } : {}),
    ...(qualityStats ? { qualityStats } : {}),
    ...(levelScaling ? { levelScaling } : {}),
    ...(isAura
      ? {
          ...(entry.mrp !== undefined || (game === 'poe1' && !entry.mrf)
            ? { manaReservationPct: entry.mrp ?? 35 }
            : {}),
          ...(entry.mrf !== undefined ? { manaReservationFlat: entry.mrf } : {}),
          spiritReservation: entry.sr ?? (game === 'poe2' ? (isFreeItemAura ? 0 : 30) : undefined),
          stats: officialStats.length > 0 ? officialStats : [`15% more ${primaryDamageType} Damage`],
        }
      : isAttack
        ? {
            attackDamageMultiplierPct: entry.am ?? 145,
            damageEffectivenessPct: entry.de ?? entry.am ?? 145,
            attackSpeedMultiplier: entry.asm ?? 1.0,
            manaCost: entry.mc ?? 12,
            stats: officialStats,
          }
        : {
            baseDamage: entry.bd ?? { [primaryDamageType]: [420, 760] as [number, number] },
            damageEffectivenessPct: entry.de ?? 120,
            castTime: entry.ct ?? 0.75,
            baseCritChance: entry.cc ?? (game === 'poe2' ? 9 : 6),
            manaCost: entry.mc ?? 22,
            stats: officialStats,
          }),
  };
}

function normalizeGemNameKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+support$/i, '');
}

function gemCategoryKey(category: 'active' | 'support', name: string): string {
  return `${category}:${normalizeGemNameKey(name)}`;
}

export function registerGemsData(game: GameId, payload: CompactGemsPayload): GemDefinition[] {
  const curated = game === 'poe2' ? POE2_GEMS : POE1_GEMS;
  const payloadByKey = new Map(payload.gems.map((e) => [gemCategoryKey(e.cat, e.en), e]));
  const seenKeys = new Set<string>();
  const merged: GemDefinition[] = curated.map((g) => {
    const key = gemCategoryKey(g.category, g.name.en);
    seenKeys.add(key);
    const official = payloadByKey.get(key);
    if (!official) return g;
    const altIds = mergeAltIds(
      g.altIds,
      official.altIds,
      official.id !== g.id ? official.id : undefined,
    );
    const skillTypes = hydrateStringList(official.stypes);
    const requireSkillTypes = hydrateStringList(official.reqTypes);
    const addSkillTypes = hydrateStringList(official.addTypes);
    const excludeSkillTypes = hydrateStringList(official.excTypes);
    const compiledMods = hydrateCompiledMods(official.cmods);
    const skillData = hydrateSkillData(official.sdata);
    const hydratedMinionBase = hydrateMinionBase(official.mb);
    const mergedMinionBase = hydratedMinionBase
      ? g.minionBase
        ? { ...g.minionBase, ...hydratedMinionBase }
        : hydratedMinionBase
      : undefined;
    const ls = hydrateLevelScaling(official.ls);
    return {
      ...g,
      ...(altIds ? { altIds } : {}),
      ...(skillTypes && !g.skillTypes ? { skillTypes } : {}),
      ...(requireSkillTypes && !g.requireSkillTypes ? { requireSkillTypes } : {}),
      ...(addSkillTypes && !g.addSkillTypes ? { addSkillTypes } : {}),
      ...(excludeSkillTypes && !g.excludeSkillTypes ? { excludeSkillTypes } : {}),
      ...(compiledMods && !g.compiledMods ? { compiledMods } : {}),
      ...(skillData && !g.skillData ? { skillData } : {}),
      ...(mergedMinionBase ? { minionBase: mergedMinionBase } : {}),
      ...(ls && !g.levelScaling ? { levelScaling: ls } : {}),
    };
  });

  for (const entry of payload.gems) {
    const key = gemCategoryKey(entry.cat, entry.en);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    merged.push(synthesizeGemDefinition(game, entry));
  }
  applyLocaleOverlayToGems(game, merged);
  setRegisteredGems(game, merged);
  loadedGemsFlag[game] = true;
  return merged;
}

export async function loadOfficialGems(game: GameId, basePath = '/data'): Promise<GemDefinition[]> {
  if (loadedGemsFlag[game]) {
    return getGemsForGame(game);
  }
  const url = `${basePath.replace(/\/+$/, '')}/${OFFICIAL_GEMS_FILES[game]}`;
  const res = await fetch(url);
  if (!res.ok) {
    return getGemsForGame(game);
  }
  const payload = (await res.json()) as CompactGemsPayload;
  return registerGemsData(game, payload);
}
