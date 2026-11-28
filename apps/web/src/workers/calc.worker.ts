/// <reference lib="webworker" />
import type {
  Build,
  CalcOutput,
  EquipmentSlotId,
  GameId,
  Locale,
  NodePowerDelta,
} from '@webpob/core';
import {
  findShortestPathToNode,
  getTreeForGame,
  loadDataManifest,
  loadLocaleOverlay,
  loadOfficialBaseItems,
  loadOfficialClasses,
  loadOfficialClusterNotables,
  loadOfficialGems,
  loadOfficialTree,
  loadOfficialUniques,
} from '@webpob/data';
import {
  calculateBuild,
  computeNodePower,
  parseModLine,
  rankSupportGemsForGroup,
  rankUniqueUpgradesForSlot,
  type RankedSupportRecommendation,
  type RankedUniqueUpgrade,
} from '@webpob/calc';

export interface NodePowerHeatItem {
  nodeId: number;
  dpsDeltaPct: number;
  ehpDeltaPct: number;
  pathCost: number;
  dpsPerPoint: number;
  ehpPerPoint: number;
}

export type CalcWorkerRequest =
  | {
      type: 'CALC_BUILD';
      requestId: number;
      build: Build;
      locale?: Locale;
    }
  | {
      type: 'CALC_BATCH';
      requestId: number;
      builds: Array<{ key: string; build: Build }>;
      locale?: Locale;
    }
  | {
      type: 'NODE_POWER';
      requestId: number;
      build: Build;
      nodeId: number;
      locale?: Locale;
    }
  | {
      type: 'HEATMAP';
      requestId: number;
      build: Build;
      candidateNodeIds: number[];
      locale?: Locale;
    }
  | {
      type: 'RANK_SUPPORTS';
      requestId: number;
      build: Build;
      groupId: string;
      limit: number;
      locale?: Locale;
    }
  | {
      type: 'RANK_UNIQUES';
      requestId: number;
      build: Build;
      slot: EquipmentSlotId;
      sortBy: 'dps' | 'ehp';
      limit: number;
      locale?: Locale;
    }
  | {
      type: 'CHECK_ITEM_PASTE';
      requestId: number;
      build: Build;
      globalLines: string[];
      locale?: Locale;
    };

export type CalcWorkerResponse =
  | {
      type: 'CALC_BUILD_RESULT';
      requestId: number;
      output: CalcOutput;
    }
  | {
      type: 'CALC_BATCH_RESULT';
      requestId: number;
      outputs: Record<string, CalcOutput>;
    }
  | {
      type: 'NODE_POWER_RESULT';
      requestId: number;
      delta: NodePowerDelta;
    }
  | {
      type: 'HEATMAP_RESULT';
      requestId: number;
      items: NodePowerHeatItem[];
      durationMs: number;
    }
  | {
      type: 'RANK_SUPPORTS_RESULT';
      requestId: number;
      items: RankedSupportRecommendation[];
    }
  | {
      type: 'RANK_UNIQUES_RESULT';
      requestId: number;
      items: RankedUniqueUpgrade[];
    }
  | {
      type: 'CHECK_ITEM_PASTE_RESULT';
      requestId: number;
      parsedGlobalCount: number;
      output: CalcOutput;
    }
  | {
      type: 'ERROR';
      requestId: number;
      message: string;
    };

const gameDataPromises = new Map<GameId, Promise<void>>();
const treePromises = new Map<string, Promise<unknown>>();
const overlayPromises = new Map<string, Promise<unknown>>();

async function ensureWorkerData(game: GameId, treeVersion?: string, locale?: Locale): Promise<void> {
  let gameTask = gameDataPromises.get(game);
  if (!gameTask) {
    gameTask = Promise.all([
      loadOfficialClasses(game, '/data'),
      loadOfficialGems(game),
      loadOfficialBaseItems(game),
      loadOfficialUniques(game),
      game === 'poe1' ? loadOfficialClusterNotables() : Promise.resolve(0),
    ])
      .then(() => undefined)
      .catch((err) => {
        gameDataPromises.delete(game);
        throw err;
      });
    gameDataPromises.set(game, gameTask);
  }

  const treeKey = `${game}:${treeVersion ?? ''}`;
  let treeTask = treePromises.get(treeKey);
  if (!treeTask) {
    treeTask = loadOfficialTree(game, '/data', treeVersion).catch((err) => {
      treePromises.delete(treeKey);
      throw err;
    });
    treePromises.set(treeKey, treeTask);
  }

  const tasks: Array<Promise<unknown>> = [gameTask, treeTask];

  if (locale === 'zh-TW') {
    const overlayKey = `${game}:zh-TW`;
    let overlayTask = overlayPromises.get(overlayKey);
    if (!overlayTask) {
      overlayTask = loadDataManifest('/data')
        .then((manifest) =>
          loadLocaleOverlay(game, 'zh-TW', '/data', manifest?.games?.[game]?.i18n?.['zh-TW']),
        )
        .catch((err) => {
          overlayPromises.delete(overlayKey);
          throw err;
        });
      overlayPromises.set(overlayKey, overlayTask);
    }
    tasks.push(overlayTask);
  }

  await Promise.all(tasks);
}

self.onmessage = async (ev: MessageEvent<CalcWorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'CALC_BUILD') {
      await ensureWorkerData(msg.build.game, msg.build.tree.treeVersion, msg.locale);
      const output = calculateBuild(msg.build);
      const res: CalcWorkerResponse = {
        type: 'CALC_BUILD_RESULT',
        requestId: msg.requestId,
        output,
      };
      self.postMessage(res);
      return;
    }

    if (msg.type === 'CALC_BATCH') {
      const outputs: Record<string, CalcOutput> = {};
      for (const entry of msg.builds) {
        await ensureWorkerData(entry.build.game, entry.build.tree.treeVersion, msg.locale);
        outputs[entry.key] = calculateBuild(entry.build);
      }
      const res: CalcWorkerResponse = {
        type: 'CALC_BATCH_RESULT',
        requestId: msg.requestId,
        outputs,
      };
      self.postMessage(res);
      return;
    }

    if (msg.type === 'NODE_POWER') {
      await ensureWorkerData(msg.build.game, msg.build.tree.treeVersion, msg.locale);
      const baseline = calculateBuild(msg.build);
      const delta = computeNodePower(msg.build, msg.nodeId, baseline);
      const res: CalcWorkerResponse = {
        type: 'NODE_POWER_RESULT',
        requestId: msg.requestId,
        delta,
      };
      self.postMessage(res);
      return;
    }

    if (msg.type === 'HEATMAP') {
      const t0 = performance.now();
      await ensureWorkerData(msg.build.game, msg.build.tree.treeVersion, msg.locale);
      const baseline = calculateBuild(msg.build);
      const baseEhp = Math.max(1, baseline.defence.effectiveHitPool);
      const tree = getTreeForGame(msg.build.game, msg.build.tree.treeVersion);
      const allAllocated = new Set<number>([
        ...msg.build.tree.allocatedNodeIds,
        ...(msg.build.game === 'poe2'
          ? msg.build.activeWeaponSet === 2
            ? msg.build.tree.weaponSet2NodeIds
            : msg.build.tree.weaponSet1NodeIds
          : []),
      ]);
      const items: NodePowerHeatItem[] = [];

      for (const nodeId of msg.candidateNodeIds) {
        const delta = computeNodePower(msg.build, nodeId, baseline);
        if (delta.isAllocated) continue;
        const ehpDeltaPct = Math.round((delta.ehpDelta / baseEhp) * 1000) / 10;
        if (delta.dpsDeltaPct > 0.3 || ehpDeltaPct > 0.3) {
          const pathLen = Math.max(1, findShortestPathToNode(tree, allAllocated, nodeId).length);
          items.push({
            nodeId,
            dpsDeltaPct: delta.dpsDeltaPct,
            ehpDeltaPct,
            pathCost: pathLen,
            dpsPerPoint: Math.round((delta.dpsDeltaPct / pathLen) * 100) / 100,
            ehpPerPoint: Math.round((ehpDeltaPct / pathLen) * 100) / 100,
          });
        }
      }

      const res: CalcWorkerResponse = {
        type: 'HEATMAP_RESULT',
        requestId: msg.requestId,
        items,
        durationMs: Math.round(performance.now() - t0),
      };
      self.postMessage(res);
      return;
    }

    if (msg.type === 'RANK_SUPPORTS') {
      await ensureWorkerData(msg.build.game, msg.build.tree.treeVersion, msg.locale);
      const items = rankSupportGemsForGroup(msg.build, msg.groupId, msg.limit);
      const res: CalcWorkerResponse = {
        type: 'RANK_SUPPORTS_RESULT',
        requestId: msg.requestId,
        items,
      };
      self.postMessage(res);
      return;
    }

    if (msg.type === 'RANK_UNIQUES') {
      await ensureWorkerData(msg.build.game, msg.build.tree.treeVersion, msg.locale);
      const items = rankUniqueUpgradesForSlot(msg.build, msg.slot, msg.sortBy, msg.limit);
      const res: CalcWorkerResponse = {
        type: 'RANK_UNIQUES_RESULT',
        requestId: msg.requestId,
        items,
      };
      self.postMessage(res);
      return;
    }

    if (msg.type === 'CHECK_ITEM_PASTE') {
      await ensureWorkerData(msg.build.game, msg.build.tree.treeVersion, msg.locale);
      const parsedGlobalCount = msg.globalLines.filter(
        (line) => parseModLine(line, 'Check').length > 0,
      ).length;
      const output = calculateBuild(msg.build);
      const res: CalcWorkerResponse = {
        type: 'CHECK_ITEM_PASTE_RESULT',
        requestId: msg.requestId,
        parsedGlobalCount,
        output,
      };
      self.postMessage(res);
    }
  } catch (err) {
    const res: CalcWorkerResponse = {
      type: 'ERROR',
      requestId: msg.requestId,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(res);
  }
};
