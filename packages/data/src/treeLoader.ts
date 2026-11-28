import {
  KeywordFlag,
  ModFlag,
  type CharacterClassDef,
  type CompiledGemMod,
  type DamageType,
  type GameId,
  type GemDefinition,
  type GemLevelStats,
  type Locale,
  type ModTag,
  type ModType,
  type PassiveNode,
  type PassiveTreeData,
  type Poe2RunesDataset,
  type SkillPartDefinition,
  type TimelessJewelDataset,
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
  asm?: number;
  cc?: number;
  mc?: number;
  st?: string[];
  cmods?: CompactCompiledMod[];
  sdata?: Record<string, number>;
}

export interface CompactSkillPartEntry {
  idx: number;
  name: string;
  spell?: boolean;
  attack?: boolean;
  melee?: boolean;
  projectile?: boolean;
  area?: boolean;
  cc?: number;
  de?: number;
  am?: number;
  asm?: number;
  bd?: Partial<Record<DamageType, [number, number]>>;
  cmods?: CompactCompiledMod[];
  sdata?: Record<string, number | boolean | string>;
  ls?: Record<string, CompactGemLevelEntry>;
}

export interface CompactGemEntry {
  id: string;
  altIds?: string[];
  en: string;
  zh?: string;
  cat: 'active' | 'support';
  color: 'red' | 'green' | 'blue' | 'white';
  tags: string[];
  stypes?: string[];
  mstypes?: string[];
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
  qmods?: CompactCompiledMod[];
  sdata?: Record<string, number>;
  mb?: CompactMinionBase;
  qs?: Array<{ t: string; q: number }> | Record<string, never>;
  ls?: Record<string, CompactGemLevelEntry>;
  parts?: CompactSkillPartEntry[];
}

export interface CompactGemsPayload {
  game: GameId;
  count: number;
  gems: CompactGemEntry[];
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
  timelessJewels?: string;
  runes?: string;
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

function hydratePartSkillData(
  sdata?: Record<string, number | boolean | string>,
): Record<string, number | boolean | string> | undefined {
  if (!sdata || typeof sdata !== 'object' || Array.isArray(sdata)) return undefined;
  if (Object.keys(sdata).length === 0) return undefined;
  return { ...sdata };
}

function hydratePartLevels(
  ls?: Record<string, CompactGemLevelEntry>,
): Record<number, GemLevelStats> | undefined {
  if (!ls) return undefined;
  const out: Record<number, GemLevelStats> = {};
  let count = 0;
  for (const [lvStr, snap] of Object.entries(ls)) {
    const lv = Number(lvStr);
    if (!Number.isFinite(lv)) continue;
    const compiledMods = hydrateCompiledMods(snap.cmods);
    const skillData = hydratePartSkillData(snap.sdata);
    out[lv] = {
      ...(snap.bd ? { baseDamage: snap.bd } : {}),
      ...(snap.am !== undefined ? { attackDamageMultiplierPct: snap.am } : {}),
      ...(snap.de !== undefined ? { damageEffectivenessPct: snap.de } : {}),
      ...(snap.asm !== undefined ? { attackSpeedMultiplier: snap.asm } : {}),
      ...(snap.cc !== undefined ? { critChance: snap.cc } : {}),
      ...(snap.mc !== undefined ? { manaCost: snap.mc } : {}),
      ...(snap.st && snap.st.length > 0 ? { stats: snap.st } : {}),
      ...(compiledMods ? { compiledMods } : {}),
      ...(skillData ? { skillData } : {}),
    };
    count++;
  }
  return count > 0 ? out : undefined;
}

function hydrateSkillParts(
  parts?: CompactSkillPartEntry[],
): SkillPartDefinition[] | undefined {
  if (!Array.isArray(parts) || parts.length === 0) return undefined;
  return parts.map((p) => {
    const compiledMods = hydrateCompiledMods(p.cmods);
    const skillData = hydratePartSkillData(p.sdata);
    const levels = hydratePartLevels(p.ls);
    return {
      index: p.idx,
      name: p.name,
      ...(p.spell !== undefined ? { spell: p.spell } : {}),
      ...(p.attack !== undefined ? { attack: p.attack } : {}),
      ...(p.melee !== undefined ? { melee: p.melee } : {}),
      ...(p.projectile !== undefined ? { projectile: p.projectile } : {}),
      ...(p.area !== undefined ? { area: p.area } : {}),
      ...(p.cc !== undefined ? { critChance: p.cc } : {}),
      ...(p.de !== undefined ? { damageEffectiveness: p.de } : {}),
      ...(p.am !== undefined ? { attackDamageMultiplierPct: p.am } : {}),
      ...(p.asm !== undefined ? { attackSpeedMultiplier: p.asm } : {}),
      ...(p.bd ? { baseDamage: p.bd } : {}),
      ...(compiledMods ? { compiledMods } : {}),
      ...(skillData ? { skillData } : {}),
      ...(levels ? { levels } : {}),
    };
  });
}

interface UpstreamMultiplierTagPatch {
  varName: string;
  limitTotal?: boolean;
  divToPerStat?: number;
}

/**
 * Restores upstream PoB1/PoB2 `Multiplier` tag metadata (`limitTotal = true`, `div = N`) that was
 * omitted when compact `poe1-gems.json` / `poe2-gems.json` payloads were exported.
 */
const UPSTREAM_MULTIPLIER_TAG_PATCHES: Readonly<
  Record<GameId, Readonly<Record<string, readonly UpstreamMultiplierTagPatch[]>>>
> = {
  poe1: {
    poe1_supportfocusedchannelling: [{ varName: 'ChannellingTime', limitTotal: true }],
    poe1_supportexemplar: [{ varName: 'CritRecently', limitTotal: true }],
    poe1_supportinvention: [{ varName: 'PlacedDuration', limitTotal: true }],
    poe1_lightningconduit: [{ varName: 'ShockEffect', divToPerStat: 5 }],
    poe1_galvanicfield: [{ varName: 'ShockEffect', divToPerStat: 5 }],
    poe1_frostblinkaltx: [{ varName: 'ChillEffect', divToPerStat: 5 }],
    poe1_supportbloodsoakedbanner: [{ varName: 'ValourStacks', divToPerStat: 8 }],
    poe1_chainhook: [{ varName: 'Rage', divToPerStat: 5 }],
    poe1_chainhookalty: [{ varName: 'Rage', divToPerStat: 5 }],
    poe1_cleavealtx: [{ varName: 'Rage', divToPerStat: 5 }],
  },
  poe2: {
    poe2_incisionsupport: [{ varName: 'IncisionConsumedRecently', limitTotal: true }],
    poe2_lightningconduit: [{ varName: 'ShockEffect', divToPerStat: 5 }],
  },
};

function patchCompiledModsWithUpstreamTags(
  mods: CompiledGemMod[] | undefined,
  patches: readonly UpstreamMultiplierTagPatch[] | undefined,
): CompiledGemMod[] | undefined {
  if (!mods || !patches || patches.length === 0) return mods;
  return mods.map((m) => {
    if (!m.tags || m.tags.length === 0) return m;
    let changed = false;
    const nextTags = m.tags.map((tag) => {
      if (tag.type !== 'Multiplier') return tag;
      const patch = patches.find((p) => p.varName === tag.var);
      if (!patch) return tag;
      if (patch.divToPerStat !== undefined) {
        changed = true;
        return {
          type: 'PerStat' as const,
          stat: tag.var,
          div: patch.divToPerStat,
          ...(tag.limit !== undefined ? { limit: tag.limit } : {}),
        };
      }
      if (patch.limitTotal && tag.limit !== undefined) {
        const cur = tag as { limitTotal?: boolean };
        if (!cur.limitTotal) {
          changed = true;
          return { ...tag, limitTotal: true } as ModTag;
        }
      }
      return tag;
    });
    return changed ? { ...m, tags: nextTags } : m;
  });
}

function applyUpstreamTagPatchesToGem(
  game: GameId,
  gemId: string,
  compiledMods: CompiledGemMod[] | undefined,
  levelScaling: GemDefinition['levelScaling'] | undefined,
  parts: SkillPartDefinition[] | undefined,
): {
  compiledMods: CompiledGemMod[] | undefined;
  levelScaling: GemDefinition['levelScaling'] | undefined;
  parts: SkillPartDefinition[] | undefined;
} {
  const patches = UPSTREAM_MULTIPLIER_TAG_PATCHES[game][gemId];
  if (!patches || patches.length === 0) {
    return { compiledMods, levelScaling, parts };
  }
  const patchedCompiled = patchCompiledModsWithUpstreamTags(compiledMods, patches);
  let patchedLs = levelScaling;
  if (levelScaling) {
    patchedLs = {};
    for (const [lv, snap] of Object.entries(levelScaling)) {
      const lvNum = Number(lv);
      patchedLs[lvNum] = snap.compiledMods
        ? { ...snap, compiledMods: patchCompiledModsWithUpstreamTags(snap.compiledMods, patches) }
        : snap;
    }
  }
  let patchedParts = parts;
  if (parts) {
    patchedParts = parts.map((p) => {
      let nextLevels = p.levels;
      if (p.levels) {
        nextLevels = {};
        for (const [lv, snap] of Object.entries(p.levels)) {
          const lvNum = Number(lv);
          nextLevels[lvNum] = snap.compiledMods
            ? { ...snap, compiledMods: patchCompiledModsWithUpstreamTags(snap.compiledMods, patches) }
            : snap;
        }
      }
      return {
        ...p,
        ...(p.compiledMods ? { compiledMods: patchCompiledModsWithUpstreamTags(p.compiledMods, patches) } : {}),
        ...(nextLevels ? { levels: nextLevels } : {}),
      };
    });
  }
  return { compiledMods: patchedCompiled, levelScaling: patchedLs, parts: patchedParts };
}

const UPSTREAM_MISSING_SKILL_COMPILED_MODS: Readonly<
  Record<GameId, Readonly<Record<string, readonly CompiledGemMod[]>>>
> = {
  poe1: {
    // Upstream PoB1 3.30 Data/Skills/act_str.lua & act_int.lua:
    // active_skill_additive_spell_damage_modifiers_apply_to_attack_damage_at_%_value
    poe1_heavystrikealty: [{ name: 'ImprovedSpellDamageAppliesToAttacks', type: 'BASE', value: 150, flags: 0, keywordFlags: 0 }],
    poe1_kineticblastaltx: [{ name: 'ImprovedSpellDamageAppliesToAttacks', type: 'BASE', value: 150, flags: 0, keywordFlags: 0 }],
    poe1_kineticbolt: [{ name: 'ImprovedSpellDamageAppliesToAttacks', type: 'BASE', value: 200, flags: 0, keywordFlags: 0 }],
    poe1_kineticfusillade: [{ name: 'ImprovedSpellDamageAppliesToAttacks', type: 'BASE', value: 150, flags: 0, keywordFlags: 0 }],
    poe1_kineticfusilladealtx: [{ name: 'ImprovedSpellDamageAppliesToAttacks', type: 'BASE', value: 150, flags: 0, keywordFlags: 0 }],
    poe1_kineticrain: [{ name: 'ImprovedSpellDamageAppliesToAttacks', type: 'BASE', value: 200, flags: 0, keywordFlags: 0 }],
    poe1_kineticrainaltx: [{ name: 'ImprovedSpellDamageAppliesToAttacks', type: 'BASE', value: 200, flags: 0, keywordFlags: 0 }],
    poe1_kineticrainkineticinstability: [{ name: 'ImprovedSpellDamageAppliesToAttacks', type: 'BASE', value: 200, flags: 0, keywordFlags: 0 }],
    poe1_powersiphon: [{ name: 'ImprovedSpellDamageAppliesToAttacks', type: 'BASE', value: 150, flags: 0, keywordFlags: 0 }],
    poe1_powersiphonaltx: [{ name: 'ImprovedSpellDamageAppliesToAttacks', type: 'BASE', value: 150, flags: 0, keywordFlags: 0 }],
    poe1_vaalpowersiphonaltx: [{ name: 'ImprovedSpellDamageAppliesToAttacks', type: 'BASE', value: 150, flags: 0, keywordFlags: 0 }],
    poe1_somaticshell: [{ name: 'ImprovedSpellDamageAppliesToAttacks', type: 'BASE', value: 150, flags: 0, keywordFlags: 0 }],
  },
  poe2: {},
};

const UPSTREAM_SKILL_DATA_OVERRIDES: Readonly<
  Record<GameId, Readonly<Record<string, Readonly<Record<string, number>>>>>
> = {
  poe1: {
    // Upstream PoB1 3.30 Data/Skills/act_int.lua: lightning_tendrils_channelled_larger_pulse_interval = 3
    poe1_lightningtendrils: { pulseInterval: 3 },
  },
  poe2: {},
};

const UPSTREAM_MISSING_QUALITY_COMPILED_MODS: Readonly<
  Record<GameId, Readonly<Record<string, readonly CompiledGemMod[]>>>
> = {
  poe1: {
    // Upstream PoB1 3.30 Data/Skills/act_str.lua: active_skill_hit_ailment_damage_with_projectile_+%_final = 0.5/qual
    poe1_moltenstrike: [
      {
        name: 'Damage',
        type: 'MORE',
        value: 0.5,
        flags: ModFlag.Projectile | ModFlag.Hit | ModFlag.Ailment,
        keywordFlags: 0,
      },
    ],
    poe1_vaalmoltenstrike: [
      {
        name: 'Damage',
        type: 'MORE',
        value: 0.5,
        flags: ModFlag.Projectile | ModFlag.Hit | ModFlag.Ailment,
        keywordFlags: 0,
      },
    ],
    // Upstream PoB1 3.30 Data/Skills/sup_str.lua: cruelty_effect_+% = 0.25/qual
    poe1_supportcruelty: [
      {
        name: 'CrueltyEffect',
        type: 'INC',
        value: 0.25,
        flags: 0,
        keywordFlags: 0,
      },
    ],
    // Upstream PoB1 3.30 Data/Skills/act_dex.lua: Windburst 0.5% increased Projectile Damage per quality
    poe1_windburst: [
      {
        name: 'Damage',
        type: 'INC',
        value: 0.5,
        flags: ModFlag.Projectile,
        keywordFlags: 0,
      },
    ],
    // Upstream PoB1 3.30 Data/Skills/act_int.lua: Bane display_linked_curse_effect_+% = 1/qual
    poe1_bane: [
      {
        name: 'CurseEffect',
        type: 'INC',
        value: 1,
        flags: 0,
        keywordFlags: 0,
      },
    ],
    // Upstream PoB1 3.30 Data/Skills/sup_str.lua: Maim Support maim_effect_+% = 1/qual
    poe1_supportmaim: [
      {
        name: 'MaimEffect',
        type: 'INC',
        value: 1,
        flags: 0,
        keywordFlags: 0,
      },
    ],
  },
  poe2: {
    // Upstream PoB2 0.5 Data/Skills/act_str.lua: walking_calamity_non_skill_base_all_damage_%_to_gain_as_fire = 0.5/qual
    poe2_walkingcalamity: [
      {
        name: 'DamageGainAsFire',
        type: 'BASE',
        value: 0.5,
        flags: 0,
        keywordFlags: 0,
      },
    ],
    // Upstream PoB2 0.5 Data/Skills/act_str.lua: armour_break_amount_+% = 1/qual
    poe2_resonatingshield: [
      {
        name: 'ArmourBreak',
        type: 'INC',
        value: 1,
        flags: 0,
        keywordFlags: 0,
      },
    ],
    // Upstream PoB2 0.5 Data/Skills/act_str.lua: active_skill_damage_+%_final_vs_fully_broken_armour = 1/qual
    poe2_leapslam: [
      {
        name: 'Damage',
        type: 'MORE',
        value: 1,
        flags: 0,
        keywordFlags: 0,
        tags: [{ type: 'Condition', var: 'EnemyArmourBroken' }],
      },
    ],
  },
};

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
  const stypeSet = new Set((entry.stypes ?? []).map((t) => t.toLowerCase()));
  const isSpell = tagSet.has('spell');
  const isAttack = tagSet.has('attack');
  const hasMinionProfile = Boolean(entry.mb);
  const hasReservation =
    (entry.mrp ?? 0) > 0 || (entry.mrf ?? 0) > 0 || (entry.sr ?? 0) > 0;
  const hasSpellHitDamage = Boolean(entry.bd && Object.keys(entry.bd).length > 0);
  const isAura =
    !hasMinionProfile &&
    !isAttack &&
    (hasReservation || (!hasSpellHitDamage && (tagSet.has('aura') || tagSet.has('herald'))));

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
  if (tagSet.has('projectile') || stypeSet.has('projectile')) modFlags |= ModFlag.Projectile;
  if (tagSet.has('melee') || stypeSet.has('melee')) modFlags |= ModFlag.Melee;
  if (tagSet.has('area') || stypeSet.has('area') || stypeSet.has('areaspell')) modFlags |= ModFlag.Area;
  if (tagSet.has('bow') || stypeSet.has('bow')) modFlags |= ModFlag.Bow;
  if (tagSet.has('wand') || stypeSet.has('wandattack')) modFlags |= ModFlag.Wand;
  if (
    tagSet.has('crossbow') ||
    tagSet.has('ammunition') ||
    stypeSet.has('crossbowskill') ||
    stypeSet.has('crossbowammoskill') ||
    (game === 'poe2' && (tagSet.has('grenade') || stypeSet.has('grenade')))
  ) {
    modFlags |= ModFlag.Crossbow;
  }
  if (tagSet.has('staff') || stypeSet.has('requiresstaff')) modFlags |= ModFlag.Staff;
  if (tagSet.has('quarterstaff')) modFlags |= ModFlag.Quarterstaff;
  if (tagSet.has('talisman')) modFlags |= ModFlag.Talisman;
  if (tagSet.has('fire')) kwFlags |= KeywordFlag.Fire;
  if (tagSet.has('cold')) kwFlags |= KeywordFlag.Cold;
  if (tagSet.has('lightning')) kwFlags |= KeywordFlag.Lightning;
  if (tagSet.has('chaos')) kwFlags |= KeywordFlag.Chaos;
  if (tagSet.has('physical')) kwFlags |= KeywordFlag.Physical;
  if (tagSet.has('totem') || stypeSet.has('summonstotem') || stypeSet.has('summonsattacktotem')) {
    kwFlags |= KeywordFlag.Totem;
  }
  if (tagSet.has('trap')) kwFlags |= KeywordFlag.Trap;
  if (tagSet.has('mine')) kwFlags |= KeywordFlag.Mine;
  if (tagSet.has('warcry') || stypeSet.has('warcry')) kwFlags |= KeywordFlag.Warcry;
  if (tagSet.has('movement') || tagSet.has('travel') || stypeSet.has('movement') || stypeSet.has('travel')) {
    kwFlags |= KeywordFlag.Movement;
  }
  if (tagSet.has('aura') || stypeSet.has('aura')) kwFlags |= KeywordFlag.Aura;
  if (tagSet.has('curse') || tagSet.has('hex') || stypeSet.has('appliescurse')) kwFlags |= KeywordFlag.Curse;
  if (tagSet.has('minion') || hasMinionProfile || stypeSet.has('minion') || stypeSet.has('createsminion')) {
    kwFlags |= KeywordFlag.Minion;
  }
  if (tagSet.has('spirit') || (entry.sr ?? 0) > 0) kwFlags |= KeywordFlag.Spirit;

  const altIds = hydrateStringList(entry.altIds);
  const skillTypes = hydrateStringList(entry.stypes);
  const minionSkillTypes = hydrateStringList(entry.mstypes);
  const requireSkillTypes = hydrateStringList(entry.reqTypes);
  const addSkillTypes = hydrateStringList(entry.addTypes);
  const excludeSkillTypes = hydrateStringList(entry.excTypes);
  const rawCompiledMods = hydrateCompiledMods(entry.cmods);
  const extraSkillMods = UPSTREAM_MISSING_SKILL_COMPILED_MODS[game][entry.id];
  const compiledMods = (() => {
    if (!extraSkillMods || extraSkillMods.length === 0) return rawCompiledMods;
    const merged = rawCompiledMods ? [...rawCompiledMods] : [];
    for (const em of extraSkillMods) {
      if (!merged.some((m) => m.name === em.name && m.type === em.type)) {
        merged.push({ ...em });
      }
    }
    return merged.length > 0 ? merged : undefined;
  })();
  const rawQualityCompiledMods = hydrateCompiledMods(entry.qmods);
  const qualityStats = hydrateQualityStats(entry.qs);
  const fallbackQualityMods =
    (!rawQualityCompiledMods || rawQualityCompiledMods.length === 0) &&
    (!qualityStats || qualityStats.length === 0)
      ? UPSTREAM_MISSING_QUALITY_COMPILED_MODS[game][entry.id]
      : undefined;
  const qualityCompiledMods =
    rawQualityCompiledMods ??
    (fallbackQualityMods ? fallbackQualityMods.map((m) => ({ ...m })) : undefined);
  const rawSkillData = hydrateSkillData(entry.sdata);
  const extraSkillData = UPSTREAM_SKILL_DATA_OVERRIDES[game][entry.id];
  const skillData = (() => {
    if (!extraSkillData) return rawSkillData;
    const merged: Record<string, number> = rawSkillData ? { ...rawSkillData } : {};
    for (const [k, v] of Object.entries(extraSkillData)) {
      if (merged[k] === undefined) merged[k] = v;
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
  })();
  const minionBase = hydrateMinionBase(entry.mb);
  const rawLevelScaling = hydrateLevelScaling(entry.ls);
  const rawParts = hydrateSkillParts(entry.parts);
  const {
    compiledMods: patchedCompiledMods,
    levelScaling,
    parts,
  } = applyUpstreamTagPatchesToGem(game, entry.id, compiledMods, rawLevelScaling, rawParts);

  const structuredFields = {
    ...(altIds ? { altIds } : {}),
    ...(skillTypes ? { skillTypes } : {}),
    ...(minionSkillTypes ? { minionSkillTypes } : {}),
    ...(requireSkillTypes ? { requireSkillTypes } : {}),
    ...(addSkillTypes ? { addSkillTypes } : {}),
    ...(excludeSkillTypes ? { excludeSkillTypes } : {}),
    ...(patchedCompiledMods ? { compiledMods: patchedCompiledMods } : {}),
    ...(qualityCompiledMods ? { qualityCompiledMods } : {}),
    ...(skillData ? { skillData } : {}),
    ...(minionBase ? { minionBase } : {}),
    ...(parts ? { parts } : {}),
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
    ...(!isAura && entry.sr !== undefined ? { spiritReservation: entry.sr } : {}),
    ...(qualityStats ? { qualityStats } : {}),
    ...(levelScaling ? { levelScaling } : {}),
    ...(isAura
      ? {
          ...(entry.mrp !== undefined || (game === 'poe1' && !entry.mrf)
            ? { manaReservationPct: entry.mrp ?? 35 }
            : {}),
          ...(entry.mrf !== undefined ? { manaReservationFlat: entry.mrf } : {}),
          spiritReservation: entry.sr ?? (game === 'poe2' ? (isFreeItemAura ? 0 : 30) : undefined),
          stats:
            officialStats.length > 0
              ? officialStats
              : game === 'poe2'
                ? []
                : [`15% more ${primaryDamageType} Damage`],
        }
      : isAttack
        ? {
            ...(entry.bd ? { baseDamage: entry.bd } : {}),
            ...(entry.cc !== undefined ? { baseCritChance: entry.cc } : {}),
            attackDamageMultiplierPct: entry.am ?? (entry.bd ? 100 : 145),
            damageEffectivenessPct: entry.de ?? entry.am ?? (entry.bd ? 100 : 145),
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
    const synth = synthesizeGemDefinition(game, official);
    const altIds = mergeAltIds(
      g.altIds,
      official.altIds,
      official.id !== g.id ? official.id : undefined,
    );
    return {
      ...synth,
      id: g.id,
      name: {
        en: synth.name.en,
        zh: official.zh ?? g.name.zh ?? synth.name.en,
        ...(g.name.zhTw ? { zhTw: g.name.zhTw } : {}),
      },
      isAuraOrBuff: g.isAuraOrBuff ?? synth.isAuraOrBuff,
      ...(altIds ? { altIds } : {}),
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

export const OFFICIAL_TIMELESS_JEWELS_FILES: Record<GameId, string> = {
  poe1: 'poe1-timeless-jewels.json',
  poe2: 'poe2-timeless-jewels.json',
};

export const OFFICIAL_POE2_RUNES_FILE = 'poe2-runes.json';

const timelessJewelStore: Partial<Record<GameId, TimelessJewelDataset | null>> = {};
const timelessLutBufferStore: Record<string, Uint8Array> = {};
let poe2RunesStore: Poe2RunesDataset | null = null;

function normalizeLutKey(file: string): string {
  return file.trim().replace(/^\/+/, '').replace(/^data\/+/i, '');
}

/** Registers an inflated raw binary LUT buffer (e.g. `timeless/poe1-lethal-pride.bin`) in memory. */
export function registerTimelessLutBuffer(file: string, rawBytes: Uint8Array): void {
  const key = normalizeLutKey(file);
  if (key) {
    timelessLutBufferStore[key] = rawBytes;
  }
}

/** Returns a previously registered raw binary Timeless Jewel LUT buffer, or `null`. */
export function getTimelessLutBuffer(file: string): Uint8Array | null {
  return timelessLutBufferStore[normalizeLutKey(file)] ?? null;
}

/**
 * Lazily fetches and inflates a `deflate-raw` compressed Timeless Jewel LUT shard
 * (e.g. `timeless/poe1-lethal-pride.bin`) using Web `DecompressionStream('deflate-raw')`.
 */
export async function loadTimelessLutBuffer(
  file: string,
  basePath = '/data',
): Promise<Uint8Array | null> {
  const key = normalizeLutKey(file);
  if (timelessLutBufferStore[key]) return timelessLutBufferStore[key]!;
  if (typeof fetch !== 'function') return null;
  try {
    const url = `${basePath.replace(/\/+$/, '')}/${key}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    if (typeof DecompressionStream === 'function' && res.body) {
      const ds = new DecompressionStream('deflate-raw');
      const inflatedStream = res.body.pipeThrough(ds);
      const ab = await new Response(inflatedStream).arrayBuffer();
      const bytes = new Uint8Array(ab);
      timelessLutBufferStore[key] = bytes;
      return bytes;
    }
    const ab = await res.arrayBuffer();
    const bytes = new Uint8Array(ab);
    timelessLutBufferStore[key] = bytes;
    return bytes;
  } catch {
    return null;
  }
}

/** Registers optional Timeless Jewel dataset in memory for a game. */
export function registerTimelessJewelData(game: GameId, data: unknown): void {
  timelessJewelStore[game] =
    data && typeof data === 'object' ? (data as TimelessJewelDataset) : null;
}

/** Returns the currently registered Timeless Jewel dataset for `game`, or `null`. */
export function getTimelessJewelData(game: GameId): TimelessJewelDataset | null {
  return timelessJewelStore[game] ?? null;
}

/** Registers optional PoE 2 Runes / Soul Cores dataset in memory. */
export function registerPoe2RunesData(data: unknown): void {
  poe2RunesStore = data && typeof data === 'object' ? (data as Poe2RunesDataset) : null;
}

/** Returns the currently registered PoE 2 Runes dataset, or `null`. */
export function getPoe2RunesData(): Poe2RunesDataset | null {
  return poe2RunesStore;
}

/**
 * Optionally fetches and registers the Timeless Jewel dataset from `/data`.
 * Gracefully no-ops and returns `null` on 404 or offline environments.
 */
export async function loadOfficialTimelessJewels(
  game: GameId,
  basePath = '/data',
): Promise<TimelessJewelDataset | null> {
  if (timelessJewelStore[game]) return timelessJewelStore[game] ?? null;
  if (typeof fetch !== 'function') return null;
  try {
    const manifest = await loadDataManifest(basePath);
    const file = manifest?.games?.[game]?.timelessJewels ?? OFFICIAL_TIMELESS_JEWELS_FILES[game];
    const url = `${basePath.replace(/\/+$/, '')}/${file}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const payload = await res.json();
    registerTimelessJewelData(game, payload);
    return getTimelessJewelData(game);
  } catch {
    return null;
  }
}

/**
 * Optionally fetches and registers the PoE 2 Runes / Soul Cores dataset from `/data`.
 * Gracefully no-ops and returns `null` on 404 or offline environments.
 */
export async function loadOfficialPoe2Runes(
  basePath = '/data',
): Promise<Poe2RunesDataset | null> {
  if (poe2RunesStore) return poe2RunesStore;
  if (typeof fetch !== 'function') return null;
  try {
    const manifest = await loadDataManifest(basePath);
    const file = manifest?.games?.poe2?.runes ?? OFFICIAL_POE2_RUNES_FILE;
    const url = `${basePath.replace(/\/+$/, '')}/${file}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const payload = await res.json();
    registerPoe2RunesData(payload);
    return getPoe2RunesData();
  } catch {
    return null;
  }
}
