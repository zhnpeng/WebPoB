/// <reference lib="webworker" />
import type { Build, CalcOutput, GameId, NodePowerDelta } from '@webpob/core';
import {
  findShortestPathToNode,
  getTreeForGame,
  loadOfficialBaseItems,
  loadOfficialClusterNotables,
  loadOfficialGems,
  loadOfficialTree,
} from '@webpob/data';
import { calculateBuild, computeNodePower } from '@webpob/calc';

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
      type: 'CALCULATE';
      requestId: number;
      build: Build;
    }
  | {
      type: 'NODE_POWER';
      requestId: number;
      build: Build;
      nodeId: number;
      baseline: CalcOutput;
    }
  | {
      type: 'HEATMAP';
      requestId: number;
      build: Build;
      candidateNodeIds: number[];
    };

export type CalcWorkerResponse =
  | {
      type: 'CALCULATE_RESULT';
      requestId: number;
      calc: CalcOutput;
    }
  | {
      type: 'NODE_POWER_RESULT';
      requestId: number;
      power: NodePowerDelta;
    }
  | {
      type: 'HEATMAP_RESULT';
      requestId: number;
      items: NodePowerHeatItem[];
      durationMs: number;
    }
  | {
      type: 'ERROR';
      requestId: number;
      message: string;
    };

const loadedGames = new Set<GameId>();
const loadedTreeKeys = new Set<string>();

async function ensureWorkerData(game: GameId, treeVersion?: string) {
  const key = `${game}:${treeVersion ?? ''}`;
  if (loadedTreeKeys.has(key)) return;
  await Promise.all([
    loadOfficialTree(game, '/data', treeVersion),
    ...(loadedGames.has(game)
      ? []
      : [
          loadOfficialGems(game),
          loadOfficialBaseItems(game),
          ...(game === 'poe1' ? [loadOfficialClusterNotables()] : []),
        ]),
  ]);
  loadedGames.add(game);
  loadedTreeKeys.add(key);
}

self.onmessage = async (ev: MessageEvent<CalcWorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'CALCULATE') {
    try {
      await ensureWorkerData(msg.build.game, msg.build.tree.treeVersion);
      const calc = calculateBuild(msg.build);
      const res: CalcWorkerResponse = {
        type: 'CALCULATE_RESULT',
        requestId: msg.requestId,
        calc,
      };
      self.postMessage(res);
    } catch (err) {
      const res: CalcWorkerResponse = {
        type: 'ERROR',
        requestId: msg.requestId,
        message: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(res);
    }
    return;
  }

  if (msg.type === 'NODE_POWER') {
    try {
      await ensureWorkerData(msg.build.game, msg.build.tree.treeVersion);
      const power = computeNodePower(msg.build, msg.nodeId, msg.baseline);
      const res: CalcWorkerResponse = {
        type: 'NODE_POWER_RESULT',
        requestId: msg.requestId,
        power,
      };
      self.postMessage(res);
    } catch (err) {
      const res: CalcWorkerResponse = {
        type: 'ERROR',
        requestId: msg.requestId,
        message: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(res);
    }
    return;
  }

  if (msg.type === 'HEATMAP') {
    const t0 = performance.now();
    try {
      await ensureWorkerData(msg.build.game, msg.build.tree.treeVersion);
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
    } catch (err) {
      const res: CalcWorkerResponse = {
        type: 'ERROR',
        requestId: msg.requestId,
        message: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(res);
    }
  }
};
