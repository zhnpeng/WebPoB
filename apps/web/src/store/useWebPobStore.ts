import { create } from 'zustand';
import type {
  Build,
  BuildConfig,
  CalcOutput,
  EquipmentSlotId,
  GameId,
  Item,
  Locale,
  SkillSetSpec,
  WeaponSetId,
} from '@webpob/core';
import {
  createEmptyBuild,
  findShortestPathToNode,
  getAscendancyStartNodeId,
  getClassesForGame,
  getGemsForGame,
  getSampleBuild,
  getTreeForGame,
  hasOfficialTreeLoaded,
  loadDataManifest,
  loadLocaleOverlay,
  loadOfficialBaseItems,
  loadOfficialClasses,
  loadOfficialClusterNotables,
  loadOfficialGems,
  loadOfficialTree,
  loadOfficialUniques,
  removeNodeAndPruneDisconnected,
} from '@webpob/data';
import { createEmptyCalcOutput } from '../utils/emptyCalcOutput';
import { calculateBuildInWorker } from '../workers/calcWorkerClient';

export type ActiveTab = 'tree' | 'skills' | 'items' | 'calcs' | 'config' | 'import' | 'notes';
export type TreePaintMode = 'shared' | 'set1' | 'set2';

interface WebPobState {
  locale: Locale;
  activeTab: ActiveTab;
  treePaintMode: TreePaintMode;
  corsProxyUrl: string;
  dataLoading: boolean;
  calcReady: boolean;
  treeRevision: number;
  build: Build;
  calc: CalcOutput;
  past: Build[];
  future: Build[];
  canUndo: boolean;
  canRedo: boolean;

  // Actions
  undo: () => void;
  redo: () => void;
  ensureOfficialDataLoaded: (game?: GameId, treeVersion?: string) => Promise<void>;
  ensureSecondaryDataLoaded: (game?: GameId) => Promise<void>;
  ensureLocaleOverlayLoaded: (game?: GameId, locale?: Locale) => Promise<void>;
  setLocale: (locale: Locale) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setTreePaintMode: (mode: TreePaintMode) => void;
  setCorsProxyUrl: (url: string) => void;
  switchGame: (game: GameId) => void;
  loadSampleBuild: (game?: GameId) => void;
  createNewBuild: (game?: GameId) => void;
  replaceBuild: (nextBuild: Build) => Promise<void>;

  // Character & Tree
  setBuildMeta: (patch: Partial<Pick<Build, 'name' | 'level' | 'classId' | 'ascendancyId' | 'activeWeaponSet' | 'bandit' | 'notes'>>) => void;
  togglePassiveNode: (nodeId: number) => void;
  setMasteryEffect: (nodeId: number, effectText: string | null) => void;
  socketJewel: (nodeId: number, item: Item | null) => void;
  resetPassiveTree: () => void;
  switchTreeSpec: (index: number) => void;
  addTreeSpec: (title: string, cloneCurrent?: boolean) => void;
  deleteTreeSpec: (index: number) => void;

  // Skills
  setMainSkillGroup: (groupId: string) => void;
  addSkillGroup: () => void;
  removeSkillGroup: (groupId: string) => void;
  toggleSkillGroup: (groupId: string) => void;
  updateSkillGroup: (groupId: string, patch: { label?: string; slot?: EquipmentSlotId; weaponSets?: WeaponSetId[]; mainActiveSkillIndex?: number; includeInFullDps?: boolean }) => void;
  addGemToGroup: (groupId: string, gemId: string) => void;
  removeGemFromGroup: (groupId: string, instanceId: string) => void;
  updateGem: (groupId: string, instanceId: string, patch: { level?: number; quality?: number; enabled?: boolean; count?: number }) => void;
  switchSkillSet: (index: number) => void;
  addSkillSet: (title: string, cloneCurrent?: boolean) => void;
  deleteSkillSet: (index: number) => void;

  // Items
  addItem: (item: Item, autoEquipSlot?: EquipmentSlotId) => void;
  equipItem: (slot: EquipmentSlotId, itemId: string) => void;
  unequipSlot: (slot: EquipmentSlotId) => void;
  toggleFlaskActive: (slot: EquipmentSlotId) => void;
  switchItemSet: (index: number) => void;
  addItemSet: (title: string, cloneCurrent?: boolean) => void;
  deleteItemSet: (index: number) => void;

  // Config
  updateConfig: (patch: Partial<BuildConfig>) => void;
}

const STORAGE_KEY = 'webpob_state_v1';

function syncDocumentLang(locale: Locale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

function detectDefaultLocale(): Locale {
  if (typeof navigator !== 'undefined') {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    const primary = langs.find(Boolean) ?? '';
    if (/^zh[-_](?:TW|HK|MO|Hant)\b/i.test(primary)) return 'zh-TW';
    if (/^zh(?:$|[-_])/i.test(primary)) return 'zh-CN';
  }
  return 'en';
}

function getUrlLocaleOverride(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    const lang = new URLSearchParams(window.location.search).get('lang')?.trim();
    if (!lang) return null;
    if (/^en(?:$|[-_])/i.test(lang)) return 'en';
    if (/^(?:zh[-_](?:TW|HK|MO|Hant)|tw|hant)$/i.test(lang)) return 'zh-TW';
    if (/^zh(?:$|[-_])/i.test(lang)) return 'zh-CN';
  } catch {
    // ignore URL parse errors
  }
  return null;
}

function loadInitialBuild(): { build: Build; locale: Locale } {
  const urlLocale = getUrlLocaleOverride();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { build?: Build; locale?: Locale };
      if (parsed.build && (parsed.build.game === 'poe1' || parsed.build.game === 'poe2')) {
        const storedLocale: Locale =
          parsed.locale === 'en' ? 'en' : parsed.locale === 'zh-TW' ? 'zh-TW' : 'zh-CN';
        const locale: Locale = urlLocale ?? storedLocale;
        syncDocumentLang(locale);
        return { build: parsed.build, locale };
      }
    }
  } catch {
    // ignore storage failures
  }
  const locale: Locale = urlLocale ?? detectDefaultLocale();
  syncDocumentLang(locale);
  return { build: getSampleBuild('poe1'), locale };
}

function persistState(build: Build, locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ build, locale }));
  } catch {
    // ignore quota errors
  }
}

const initial = loadInitialBuild();

const MAX_HISTORY = 40;

const DEFAULT_CORS_PROXY =
  typeof window !== 'undefined' && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(window.location.origin)
    ? `${window.location.origin}/api/proxy`
    : '';

const secondaryLoaded: Partial<Record<GameId, Promise<void>>> = {};

export const useWebPobStore = create<WebPobState>((set, get) => {
  let calcSeq = 0;

  const scheduleCalc = (targetBuild: Build): Promise<void> => {
    const ticket = ++calcSeq;
    return calculateBuildInWorker(targetBuild, get().locale)
      .then((output) => {
        if (ticket === calcSeq) {
          set({ calc: output, calcReady: true });
        }
      })
      .catch((err) => {
        console.warn('[WebPoB] Background calculation error:', err);
      });
  };

  const commitBuild = (
    rawNext: Build,
    opts?: { recordHistory?: boolean; clearHistory?: boolean },
  ): Promise<void> => {
    const prevBuild = get().build;
    let nextBuild = rawNext;
    if (nextBuild.treeSpecs && nextBuild.treeSpecs.length > 0) {
      const idx = Math.max(0, Math.min(nextBuild.treeSpecs.length - 1, nextBuild.activeTreeSpecIndex ?? 0));
      const syncedSpecs = nextBuild.treeSpecs.map((s, i) => (i === idx ? nextBuild.tree : s));
      nextBuild = { ...nextBuild, treeSpecs: syncedSpecs, activeTreeSpecIndex: idx };
    }
    if (nextBuild.itemSets && nextBuild.itemSets.length > 0) {
      const idx = Math.max(0, Math.min(nextBuild.itemSets.length - 1, nextBuild.activeItemSetIndex ?? 0));
      const syncedSets = nextBuild.itemSets.map((s, i) =>
        i === idx
          ? { ...s, equipped: nextBuild.equipped, activeFlaskSlots: nextBuild.activeFlaskSlots }
          : s,
      );
      nextBuild = { ...nextBuild, itemSets: syncedSets, activeItemSetIndex: idx };
    }
    if (nextBuild.skillSets && nextBuild.skillSets.length > 0) {
      const idx = Math.max(0, Math.min(nextBuild.skillSets.length - 1, nextBuild.activeSkillSetIndex ?? 0));
      const syncedSkillSets = nextBuild.skillSets.map((s, i) =>
        i === idx
          ? { ...s, skills: nextBuild.skills, mainSkillGroupId: nextBuild.mainSkillGroupId }
          : s,
      );
      nextBuild = { ...nextBuild, skillSets: syncedSkillSets, activeSkillSetIndex: idx };
    }
    persistState(nextBuild, get().locale);
    if (opts?.clearHistory) {
      set({ build: nextBuild, past: [], future: [], canUndo: false, canRedo: false });
    } else if (opts?.recordHistory !== false) {
      const nextPast = [...get().past, prevBuild].slice(-MAX_HISTORY);
      set({ build: nextBuild, past: nextPast, future: [], canUndo: nextPast.length > 0, canRedo: false });
    } else {
      set({ build: nextBuild });
    }
    return scheduleCalc(nextBuild);
  };

  queueMicrotask(() => {
    if (calcSeq === 0) {
      void scheduleCalc(initial.build);
    }
  });

  return {
    locale: initial.locale,
    activeTab: 'tree',
    treePaintMode: 'shared',
    corsProxyUrl: DEFAULT_CORS_PROXY,
    dataLoading: false,
    calcReady: false,
    treeRevision: 0,
    build: initial.build,
    calc: createEmptyCalcOutput(initial.build),
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,

    undo: () => {
      const { past, future, build } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1]!;
      const nextPast = past.slice(0, -1);
      const nextFuture = [build, ...future].slice(0, MAX_HISTORY);
      persistState(previous, get().locale);
      set({
        build: previous,
        past: nextPast,
        future: nextFuture,
        canUndo: nextPast.length > 0,
        canRedo: nextFuture.length > 0,
      });
      void scheduleCalc(previous);
    },

    redo: () => {
      const { past, future, build } = get();
      if (future.length === 0) return;
      const next = future[0]!;
      const nextFuture = future.slice(1);
      const nextPast = [...past, build].slice(-MAX_HISTORY);
      persistState(next, get().locale);
      set({
        build: next,
        past: nextPast,
        future: nextFuture,
        canUndo: nextPast.length > 0,
        canRedo: nextFuture.length > 0,
      });
      void scheduleCalc(next);
    },

    ensureSecondaryDataLoaded: async (gameArg) => {
      const game = gameArg ?? get().build.game;
      if (secondaryLoaded[game]) return secondaryLoaded[game];
      const task = Promise.all([
        loadOfficialBaseItems(game),
        loadOfficialUniques(game),
        game === 'poe1' ? loadOfficialClusterNotables() : Promise.resolve(0),
      ])
        .then(() => {
          const cur = get().build;
          if (cur.game === game) {
            set({ treeRevision: get().treeRevision + 1 });
            void scheduleCalc(cur);
          }
        })
        .catch((err) => {
          console.warn('[WebPoB] Failed to load secondary dataset:', err);
          delete secondaryLoaded[game];
        });
      secondaryLoaded[game] = task;
      return task;
    },

    ensureLocaleOverlayLoaded: async (gameArg, localeArg) => {
      const game = gameArg ?? get().build.game;
      const locale = localeArg ?? get().locale;
      if (locale !== 'zh-TW') return;
      const manifest = await loadDataManifest('/data');
      const manifestFile = manifest?.games?.[game]?.i18n?.[locale];
      const loaded = await loadLocaleOverlay(game, locale, '/data', manifestFile);
      if (loaded && get().build.game === game) {
        const cur = get().build;
        set({ treeRevision: get().treeRevision + 1 });
        void scheduleCalc(cur);
      }
    },

    ensureOfficialDataLoaded: async (gameArg, treeVersionArg) => {
      const game = gameArg ?? get().build.game;
      const activeLocale = get().locale;
      // A specific historical tree version only short-circuits when THAT version is loaded.
      if (treeVersionArg ? hasOfficialTreeLoaded(game, treeVersionArg) : hasOfficialTreeLoaded(game)) {
        if (activeLocale === 'zh-TW') {
          await get().ensureLocaleOverlayLoaded(game, activeLocale);
        }
        return;
      }
      set({ dataLoading: true });
      try {
        // Stage 1 (Critical Path): manifest + classes + passive tree + gems (+ zh-TW overlay when active)
        const manifest = await loadDataManifest('/data');
        const [, tree] = await Promise.all([
          loadOfficialClasses(game, '/data'),
          loadOfficialTree(game, '/data', treeVersionArg),
          loadOfficialGems(game),
          activeLocale === 'zh-TW'
            ? loadLocaleOverlay(game, 'zh-TW', '/data', manifest?.games?.[game]?.i18n?.['zh-TW'])
            : Promise.resolve(null),
        ]);
        const cur = get().build;
        if (cur.game === game) {
          // If current build is a sample build created before official tree loaded, upgrade to official sample path
          const isStarterSample =
            (cur.id === 'sample-poe1-arc' || cur.id === 'sample-poe2-spark') &&
            cur.tree.treeVersion !== tree.version;
          const validCount = cur.tree.allocatedNodeIds.filter((id) => Boolean(tree.nodes[id])).length;
          if (isStarterSample || validCount === 0) {
            if (cur.id === 'sample-poe1-arc' || cur.id === 'sample-poe2-spark') {
              const upgraded = getSampleBuild(game);
              set({ treeRevision: get().treeRevision + 1, dataLoading: false });
              await commitBuild(upgraded, { clearHistory: true });
            } else {
              const startId = tree.classStartNodeIds[cur.classId] ?? Object.values(tree.classStartNodeIds)[0]!;
              const nextBuild: Build = {
                ...cur,
                tree: {
                  ...cur.tree,
                  treeVersion: tree.version,
                  allocatedNodeIds: [startId],
                  weaponSet1NodeIds: [],
                  weaponSet2NodeIds: [],
                },
              };
              set({ treeRevision: get().treeRevision + 1, dataLoading: false });
              await commitBuild(nextBuild, { clearHistory: true });
            }
          } else {
            set({ treeRevision: get().treeRevision + 1, dataLoading: false });
            await commitBuild(cur, { recordHistory: false });
          }
        } else {
          set({ treeRevision: get().treeRevision + 1, dataLoading: false });
        }

        // Stage 2 (Deferred): warm bases, uniques, and cluster notables in the background without blocking first paint
        if (typeof window !== 'undefined') {
          const scheduleIdle =
            (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
              .requestIdleCallback;
          if (scheduleIdle) {
            scheduleIdle(() => void get().ensureSecondaryDataLoaded(game), { timeout: 2500 });
          } else {
            setTimeout(() => void get().ensureSecondaryDataLoaded(game), 800);
          }
        } else {
          void get().ensureSecondaryDataLoaded(game);
        }
      } catch (err) {
        console.warn('[WebPoB] Failed to load official dataset, using built-in fallback:', err);
        set({ dataLoading: false });
      }
    },

    setLocale: (locale) => {
      syncDocumentLang(locale);
      persistState(get().build, locale);
      set({ locale });
      if (locale === 'zh-TW') {
        void get().ensureLocaleOverlayLoaded(get().build.game, locale);
      }
    },

    setActiveTab: (activeTab) => set({ activeTab }),
    setTreePaintMode: (treePaintMode) => set({ treePaintMode }),
    setCorsProxyUrl: (corsProxyUrl) => set({ corsProxyUrl }),

    switchGame: (game) => {
      if (get().build.game === game) return;
      const sample = getSampleBuild(game);
      set({ treePaintMode: 'shared' });
      void commitBuild(sample, { clearHistory: true });
      void get().ensureOfficialDataLoaded(game);
    },

    loadSampleBuild: (game) => {
      const targetGame = game ?? get().build.game;
      set({ treePaintMode: 'shared' });
      void commitBuild(getSampleBuild(targetGame), { clearHistory: true });
    },

    createNewBuild: (game) => {
      const targetGame = game ?? get().build.game;
      set({ treePaintMode: 'shared' });
      void commitBuild(createEmptyBuild(targetGame), { clearHistory: true });
    },

    replaceBuild: async (nextBuild) => {
      set({ treePaintMode: 'shared' });
      const calcPromise = commitBuild(nextBuild, { clearHistory: true });
      // Imported builds may target a historical tree version (old share links). Load
      // that exact passive tree so allocated nodes keep rendering correctly.
      const targetVersion = nextBuild.tree?.treeVersion;
      if (targetVersion && !hasOfficialTreeLoaded(nextBuild.game, targetVersion)) {
        await get().ensureOfficialDataLoaded(nextBuild.game, targetVersion);
      }
      await calcPromise;
    },

    setBuildMeta: (patch) => {
      const cur = get().build;
      const tree = getTreeForGame(cur.game, cur.tree.treeVersion);
      let next: Build = { ...cur, ...patch };
      if (patch.classId && patch.classId !== cur.classId) {
        const classes = getClassesForGame(cur.game);
        const classDef = classes.find((c) => c.id === patch.classId) ?? classes[0]!;
        const startId = tree.classStartNodeIds[classDef.id] ?? Object.values(tree.classStartNodeIds)[0]!;
        const nextAsc = classDef.ascendancies[0]?.id ?? '';
        const ascStartId = getAscendancyStartNodeId(tree, nextAsc);
        next = {
          ...next,
          ascendancyId: nextAsc,
          tree: {
            ...next.tree,
            allocatedNodeIds: ascStartId ? [startId, ascStartId] : [startId],
            weaponSet1NodeIds: [],
            weaponSet2NodeIds: [],
          },
        };
      } else if (patch.ascendancyId !== undefined && patch.ascendancyId !== cur.ascendancyId) {
        // Strip previous ascendancy nodes and seed the newly chosen ascendancy start node
        const mainNodes = cur.tree.allocatedNodeIds.filter((id) => !tree.nodes[id]?.ascendancyId);
        const ascStartId = getAscendancyStartNodeId(tree, patch.ascendancyId);
        next = {
          ...next,
          tree: {
            ...next.tree,
            allocatedNodeIds: ascStartId ? [...mainNodes, ascStartId] : mainNodes,
          },
        };
      }
      commitBuild(next);
    },

    togglePassiveNode: (nodeId) => {
      const cur = get().build;
      const mode = get().treePaintMode;
      const tree = getTreeForGame(cur.game, cur.tree.treeVersion);
      const startId = tree.classStartNodeIds[cur.classId] ?? cur.tree.allocatedNodeIds[0] ?? 0;
      const ascStartId = getAscendancyStartNodeId(tree, cur.ascendancyId);
      const rootIds = ascStartId ? [startId, ascStartId] : [startId];

      // Auto-seed ascendancy start node when user clicks an ascendancy node for the first time
      const clickedNode = tree.nodes[nodeId];
      const baseAlloc =
        clickedNode?.ascendancyId && ascStartId && !cur.tree.allocatedNodeIds.includes(ascStartId)
          ? [...cur.tree.allocatedNodeIds, ascStartId]
          : cur.tree.allocatedNodeIds;

      const sharedSet = new Set(baseAlloc);
      const set1Set = new Set(cur.tree.weaponSet1NodeIds);
      const set2Set = new Set(cur.tree.weaponSet2NodeIds);

      if (cur.game === 'poe2' && (mode === 'set1' || mode === 'set2') && !clickedNode?.ascendancyId) {
        const targetSet = mode === 'set1' ? set1Set : set2Set;
        const otherSet = mode === 'set1' ? set2Set : set1Set;
        if (targetSet.has(nodeId)) {
          targetSet.delete(nodeId);
        } else if (!sharedSet.has(nodeId)) {
          const combined = new Set([...sharedSet, ...targetSet]);
          const path = findShortestPathToNode(tree, combined, nodeId);
          for (const id of path) {
            otherSet.delete(id);
            targetSet.add(id);
          }
        }
        commitBuild({
          ...cur,
          tree: {
            ...cur.tree,
            weaponSet1NodeIds: [...set1Set],
            weaponSet2NodeIds: [...set2Set],
          },
        });
        return;
      }

      // Standard shared allocation / deallocation with multi-root shortest path
      if (sharedSet.has(nodeId)) {
        const pruned = removeNodeAndPruneDisconnected(tree, baseAlloc, rootIds, nodeId);
        const prunedSet = new Set(pruned);
        commitBuild({
          ...cur,
          tree: {
            ...cur.tree,
            allocatedNodeIds: pruned,
            weaponSet1NodeIds: cur.tree.weaponSet1NodeIds.filter((id) => !prunedSet.has(id)),
            weaponSet2NodeIds: cur.tree.weaponSet2NodeIds.filter((id) => !prunedSet.has(id)),
          },
        });
      } else {
        const path = findShortestPathToNode(tree, sharedSet, nodeId);
        if (path.length === 0) return;
        const nextAllocated = [...baseAlloc, ...path];
        const nextSet = new Set(nextAllocated);
        commitBuild({
          ...cur,
          tree: {
            ...cur.tree,
            allocatedNodeIds: nextAllocated,
            weaponSet1NodeIds: cur.tree.weaponSet1NodeIds.filter((id) => !nextSet.has(id)),
            weaponSet2NodeIds: cur.tree.weaponSet2NodeIds.filter((id) => !nextSet.has(id)),
          },
        });
      }
    },

    setMasteryEffect: (nodeId, effectText) => {
      const cur = get().build;
      const nextMasteries = { ...cur.tree.masteryEffects };
      if (!effectText) {
        delete nextMasteries[nodeId];
      } else {
        nextMasteries[nodeId] = effectText;
      }
      commitBuild({
        ...cur,
        tree: {
          ...cur.tree,
          masteryEffects: nextMasteries,
        },
      });
    },

    socketJewel: (nodeId, item) => {
      const cur = get().build;
      const nextSockets = { ...(cur.tree.socketedJewels ?? {}) };
      const nextItems = { ...cur.items };
      if (!item) {
        delete nextSockets[nodeId];
      } else {
        nextItems[item.id] = item;
        nextSockets[nodeId] = item.id;
      }
      commitBuild({
        ...cur,
        items: nextItems,
        tree: {
          ...cur.tree,
          socketedJewels: nextSockets,
        },
      });
    },

    resetPassiveTree: () => {
      const cur = get().build;
      const tree = getTreeForGame(cur.game, cur.tree.treeVersion);
      const startId = tree.classStartNodeIds[cur.classId] ?? Object.values(tree.classStartNodeIds)[0]!;
      commitBuild({
        ...cur,
        tree: {
          ...cur.tree,
          allocatedNodeIds: [startId],
          weaponSet1NodeIds: [],
          weaponSet2NodeIds: [],
        },
      });
    },

    setMainSkillGroup: (groupId) => {
      commitBuild({ ...get().build, mainSkillGroupId: groupId });
    },

    addSkillGroup: () => {
      const cur = get().build;
      const defaultGem = getGemsForGame(cur.game)[0]!;
      const newId = `sg_${Date.now()}`;
      commitBuild({
        ...cur,
        skills: [
          ...cur.skills,
          {
            id: newId,
            label: `Skill Group ${cur.skills.length + 1}`,
            enabled: true,
            slot: cur.game === 'poe1' ? 'Gloves' : undefined,
            weaponSets: cur.game === 'poe2' ? [1, 2] : undefined,
            gems: [
              {
                instanceId: `g_${Date.now()}`,
                gemId: defaultGem.id,
                level: 20,
                quality: 0,
                enabled: true,
              },
            ],
          },
        ],
      });
    },

    removeSkillGroup: (groupId) => {
      const cur = get().build;
      const remaining = cur.skills.filter((g) => g.id !== groupId);
      const nextMain = cur.mainSkillGroupId === groupId ? (remaining[0]?.id ?? '') : cur.mainSkillGroupId;
      commitBuild({ ...cur, skills: remaining, mainSkillGroupId: nextMain });
    },

    toggleSkillGroup: (groupId) => {
      const cur = get().build;
      commitBuild({
        ...cur,
        skills: cur.skills.map((g) => (g.id === groupId ? { ...g, enabled: !g.enabled } : g)),
      });
    },

    updateSkillGroup: (groupId, patch) => {
      const cur = get().build;
      commitBuild({
        ...cur,
        skills: cur.skills.map((g) => (g.id === groupId ? { ...g, ...patch } : g)),
      });
    },

    addGemToGroup: (groupId, gemId) => {
      const cur = get().build;
      commitBuild({
        ...cur,
        skills: cur.skills.map((g) =>
          g.id === groupId
            ? {
                ...g,
                gems: [
                  ...g.gems,
                  {
                    instanceId: `g_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                    gemId,
                    level: 20,
                    quality: 0,
                    enabled: true,
                  },
                ],
              }
            : g,
        ),
      });
    },

    removeGemFromGroup: (groupId, instanceId) => {
      const cur = get().build;
      commitBuild({
        ...cur,
        skills: cur.skills.map((g) =>
          g.id === groupId ? { ...g, gems: g.gems.filter((gem) => gem.instanceId !== instanceId) } : g,
        ),
      });
    },

    updateGem: (groupId, instanceId, patch) => {
      const cur = get().build;
      commitBuild({
        ...cur,
        skills: cur.skills.map((g) =>
          g.id === groupId
            ? {
                ...g,
                gems: g.gems.map((gem) => (gem.instanceId === instanceId ? { ...gem, ...patch } : gem)),
              }
            : g,
        ),
      });
    },

    switchSkillSet: (index) => {
      const cur = get().build;
      const sets: SkillSetSpec[] =
        cur.skillSets && cur.skillSets.length > 0
          ? cur.skillSets
          : [{ id: '1', title: 'Default', skills: cur.skills, mainSkillGroupId: cur.mainSkillGroupId }];
      if (index < 0 || index >= sets.length) return;
      const target = sets[index]!;
      const clonedSkills = target.skills.map((g) => ({
        ...g,
        gems: g.gems.map((gem) => ({ ...gem })),
      }));
      commitBuild({
        ...cur,
        skills: clonedSkills,
        mainSkillGroupId: target.mainSkillGroupId || clonedSkills[0]?.id || '',
        skillSets: sets,
        activeSkillSetIndex: index,
      });
    },

    addSkillSet: (title, cloneCurrent = true) => {
      const cur = get().build;
      const sets: SkillSetSpec[] =
        cur.skillSets && cur.skillSets.length > 0
          ? [...cur.skillSets]
          : [{ id: '1', title: 'Default', skills: cur.skills, mainSkillGroupId: cur.mainSkillGroupId }];
      const curIdx = Math.max(0, Math.min(sets.length - 1, cur.activeSkillSetIndex ?? 0));
      sets[curIdx] = {
        ...sets[curIdx]!,
        skills: cur.skills,
        mainSkillGroupId: cur.mainSkillGroupId,
      };
      const defaultGem = getGemsForGame(cur.game)[0]!;
      const stamp = Date.now();
      const newSkills = cloneCurrent
        ? cur.skills.map((g, gi) => ({
            ...g,
            id: `sg_${stamp}_${gi}`,
            gems: g.gems.map((gem, j) => ({ ...gem, instanceId: `g_${stamp}_${gi}_${j}` })),
          }))
        : [
            {
              id: `sg_${stamp}_0`,
              label: 'Main Skill',
              enabled: true,
              slot: cur.game === 'poe1' ? ('Body Armour' as EquipmentSlotId) : undefined,
              weaponSets: cur.game === 'poe2' ? ([1, 2] as WeaponSetId[]) : undefined,
              gems: [{ instanceId: `g_${stamp}_0_0`, gemId: defaultGem.id, level: 20, quality: 0, enabled: true }],
            },
          ];
      const curMainIdx = Math.max(0, cur.skills.findIndex((g) => g.id === cur.mainSkillGroupId));
      const newMainId = newSkills[curMainIdx]?.id ?? newSkills[0]?.id ?? '';
      const newSet: SkillSetSpec = {
        id: String(stamp),
        title,
        skills: newSkills,
        mainSkillGroupId: newMainId,
      };
      const nextSets = [...sets, newSet];
      commitBuild({
        ...cur,
        skills: newSkills,
        mainSkillGroupId: newMainId,
        skillSets: nextSets,
        activeSkillSetIndex: nextSets.length - 1,
      });
    },

    deleteSkillSet: (index) => {
      const cur = get().build;
      const sets = cur.skillSets && cur.skillSets.length > 0 ? [...cur.skillSets] : [];
      if (sets.length <= 1 || index < 0 || index >= sets.length) return;
      sets.splice(index, 1);
      const nextIdx = Math.max(0, Math.min(sets.length - 1, index > 0 ? index - 1 : 0));
      const nextActive = sets[nextIdx]!;
      commitBuild({
        ...cur,
        skills: nextActive.skills,
        mainSkillGroupId: nextActive.mainSkillGroupId || nextActive.skills[0]?.id || '',
        skillSets: sets,
        activeSkillSetIndex: nextIdx,
      });
    },

    addItem: (item, autoEquipSlot) => {
      const cur = get().build;
      const nextItems = { ...cur.items, [item.id]: item };
      const targetSlot = autoEquipSlot;
      const nextEquipped = targetSlot ? { ...cur.equipped, [targetSlot]: item.id } : cur.equipped;
      const nextFlasks =
        targetSlot && targetSlot.startsWith('Flask ')
          ? { ...(cur.activeFlaskSlots ?? {}), [targetSlot]: true }
          : cur.activeFlaskSlots;
      commitBuild({ ...cur, items: nextItems, equipped: nextEquipped, activeFlaskSlots: nextFlasks });
    },

    equipItem: (slot, itemId) => {
      const cur = get().build;
      commitBuild({ ...cur, equipped: { ...cur.equipped, [slot]: itemId } });
    },

    unequipSlot: (slot) => {
      const cur = get().build;
      const nextEquipped = { ...cur.equipped };
      delete nextEquipped[slot];
      const nextFlasks = { ...(cur.activeFlaskSlots ?? {}) };
      delete nextFlasks[slot];
      commitBuild({ ...cur, equipped: nextEquipped, activeFlaskSlots: nextFlasks });
    },

    toggleFlaskActive: (slot) => {
      const cur = get().build;
      const currentActive = Boolean(cur.activeFlaskSlots?.[slot]);
      commitBuild({
        ...cur,
        activeFlaskSlots: {
          ...(cur.activeFlaskSlots ?? {}),
          [slot]: !currentActive,
        },
      });
    },

    switchTreeSpec: (index) => {
      const cur = get().build;
      const specs = cur.treeSpecs && cur.treeSpecs.length > 0 ? cur.treeSpecs : [cur.tree];
      if (index < 0 || index >= specs.length) return;
      const target = specs[index]!;
      commitBuild({
        ...cur,
        tree: {
          ...target,
          allocatedNodeIds: [...target.allocatedNodeIds],
          weaponSet1NodeIds: [...target.weaponSet1NodeIds],
          weaponSet2NodeIds: [...target.weaponSet2NodeIds],
          masteryEffects: { ...target.masteryEffects },
          ...(target.socketedJewels ? { socketedJewels: { ...target.socketedJewels } } : {}),
          ...(target.attributeOverrides ? { attributeOverrides: { ...target.attributeOverrides } } : {}),
        },
        treeSpecs: specs,
        activeTreeSpecIndex: index,
      });
      if (target.treeVersion && !hasOfficialTreeLoaded(cur.game, target.treeVersion)) {
        void get().ensureOfficialDataLoaded(cur.game, target.treeVersion);
      }
    },

    addTreeSpec: (title, cloneCurrent = true) => {
      const cur = get().build;
      const specs = cur.treeSpecs && cur.treeSpecs.length > 0 ? [...cur.treeSpecs] : [cur.tree];
      const curIdx = Math.max(0, Math.min(specs.length - 1, cur.activeTreeSpecIndex ?? 0));
      specs[curIdx] = cur.tree;
      const tree = getTreeForGame(cur.game, cur.tree.treeVersion);
      const startId = tree.classStartNodeIds[cur.classId] ?? cur.tree.allocatedNodeIds[0] ?? 0;
      const newSpec = cloneCurrent
        ? {
            ...cur.tree,
            title,
            allocatedNodeIds: [...cur.tree.allocatedNodeIds],
            weaponSet1NodeIds: [...cur.tree.weaponSet1NodeIds],
            weaponSet2NodeIds: [...cur.tree.weaponSet2NodeIds],
            masteryEffects: { ...cur.tree.masteryEffects },
            ...(cur.tree.socketedJewels ? { socketedJewels: { ...cur.tree.socketedJewels } } : {}),
            ...(cur.tree.attributeOverrides ? { attributeOverrides: { ...cur.tree.attributeOverrides } } : {}),
          }
        : {
            title,
            treeVersion: tree.version,
            allocatedNodeIds: startId ? [startId] : [],
            weaponSet1NodeIds: [],
            weaponSet2NodeIds: [],
            masteryEffects: {},
          };
      const nextSpecs = [...specs, newSpec];
      commitBuild({
        ...cur,
        tree: newSpec,
        treeSpecs: nextSpecs,
        activeTreeSpecIndex: nextSpecs.length - 1,
      });
    },

    deleteTreeSpec: (index) => {
      const cur = get().build;
      const specs = cur.treeSpecs && cur.treeSpecs.length > 0 ? [...cur.treeSpecs] : [cur.tree];
      if (specs.length <= 1 || index < 0 || index >= specs.length) return;
      specs.splice(index, 1);
      const nextIdx = Math.max(0, Math.min(specs.length - 1, index > 0 ? index - 1 : 0));
      commitBuild({
        ...cur,
        tree: specs[nextIdx]!,
        treeSpecs: specs,
        activeTreeSpecIndex: nextIdx,
      });
    },

    switchItemSet: (index) => {
      const cur = get().build;
      const sets =
        cur.itemSets && cur.itemSets.length > 0
          ? cur.itemSets
          : [{ id: '1', title: 'Default', equipped: cur.equipped, activeFlaskSlots: cur.activeFlaskSlots }];
      if (index < 0 || index >= sets.length) return;
      const target = sets[index]!;
      commitBuild({
        ...cur,
        equipped: { ...target.equipped },
        activeFlaskSlots: target.activeFlaskSlots ? { ...target.activeFlaskSlots } : {},
        itemSets: sets,
        activeItemSetIndex: index,
      });
    },

    addItemSet: (title, cloneCurrent = true) => {
      const cur = get().build;
      const sets =
        cur.itemSets && cur.itemSets.length > 0
          ? [...cur.itemSets]
          : [{ id: '1', title: 'Default', equipped: { ...cur.equipped }, activeFlaskSlots: { ...(cur.activeFlaskSlots ?? {}) } }];
      const curIdx = Math.max(0, Math.min(sets.length - 1, cur.activeItemSetIndex ?? 0));
      sets[curIdx] = {
        ...sets[curIdx]!,
        equipped: { ...cur.equipped },
        activeFlaskSlots: { ...(cur.activeFlaskSlots ?? {}) },
      };
      const newSet = {
        id: String(Date.now()),
        title,
        equipped: cloneCurrent ? { ...cur.equipped } : {},
        activeFlaskSlots: cloneCurrent ? { ...(cur.activeFlaskSlots ?? {}) } : {},
      };
      const nextSets = [...sets, newSet];
      commitBuild({
        ...cur,
        equipped: { ...newSet.equipped },
        activeFlaskSlots: { ...newSet.activeFlaskSlots },
        itemSets: nextSets,
        activeItemSetIndex: nextSets.length - 1,
      });
    },

    deleteItemSet: (index) => {
      const cur = get().build;
      const sets = cur.itemSets && cur.itemSets.length > 0 ? [...cur.itemSets] : [];
      if (sets.length <= 1 || index < 0 || index >= sets.length) return;
      sets.splice(index, 1);
      const nextIdx = Math.max(0, Math.min(sets.length - 1, index > 0 ? index - 1 : 0));
      const nextActive = sets[nextIdx]!;
      commitBuild({
        ...cur,
        equipped: { ...nextActive.equipped },
        activeFlaskSlots: nextActive.activeFlaskSlots ? { ...nextActive.activeFlaskSlots } : {},
        itemSets: sets,
        activeItemSetIndex: nextIdx,
      });
    },

    updateConfig: (patch) => {
      const cur = get().build;
      commitBuild({ ...cur, config: { ...cur.config, ...patch } });
    },
  };
});
