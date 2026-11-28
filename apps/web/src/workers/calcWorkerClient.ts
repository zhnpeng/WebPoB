import type {
  Build,
  CalcOutput,
  EquipmentSlotId,
  Locale,
  NodePowerDelta,
} from '@webpob/core';
import type {
  RankedSupportRecommendation,
  RankedUniqueUpgrade,
} from '@webpob/calc';
import { createEmptyCalcOutput } from '../utils/emptyCalcOutput';
import type {
  CalcWorkerRequest,
  CalcWorkerResponse,
  NodePowerHeatItem,
} from './calc.worker';

let workerInstance: Worker | null = null;
let seq = 0;

type AnySuccessResponse = Exclude<CalcWorkerResponse, { type: 'ERROR' }>;

const pending = new Map<
  number,
  {
    resolve: (res: AnySuccessResponse) => void;
    reject: (err: Error) => void;
  }
>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!workerInstance) {
    workerInstance = new Worker(new URL('./calc.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance.onmessage = (ev: MessageEvent<CalcWorkerResponse>) => {
      const msg = ev.data;
      const entry = pending.get(msg.requestId);
      if (!entry) return;
      pending.delete(msg.requestId);
      if (msg.type === 'ERROR') {
        entry.reject(new Error(msg.message));
      } else {
        entry.resolve(msg);
      }
    };
    workerInstance.onerror = (err) => {
      for (const [, p] of pending) {
        p.reject(new Error(err.message || 'Calc worker error'));
      }
      pending.clear();
    };
  }
  return workerInstance;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

function sendRequest<TRes extends AnySuccessResponse>(
  reqBody: DistributiveOmit<CalcWorkerRequest, 'requestId'>,
): Promise<TRes> {
  const worker = getWorker();
  if (!worker) {
    return Promise.reject(new Error('Web Worker is unavailable in this environment'));
  }
  const requestId = ++seq;
  return new Promise<TRes>((resolve, reject) => {
    pending.set(requestId, {
      resolve: (res) => resolve(res as TRes),
      reject,
    });
    worker.postMessage({ ...reqBody, requestId } as CalcWorkerRequest);
  });
}

/**
 * Computes full build offence/defence/breakdowns inside the background Web Worker
 * so the main UI bundle never downloads a duplicate ~1 MB copy of `@webpob/calc`.
 */
export async function calculateBuildInWorker(
  build: Build,
  locale?: Locale,
): Promise<CalcOutput> {
  if (typeof Worker === 'undefined') {
    if (import.meta.env.MODE === 'test') {
      const mod = await import('@webpob/calc');
      return mod.calculateBuild(build);
    }
    return createEmptyCalcOutput(build);
  }
  const res = await sendRequest<Extract<CalcWorkerResponse, { type: 'CALC_BUILD_RESULT' }>>({
    type: 'CALC_BUILD',
    build,
    locale,
  });
  return res.output;
}

export async function calculateBatchInWorker(
  builds: Array<{ key: string; build: Build }>,
  locale?: Locale,
): Promise<Record<string, CalcOutput>> {
  if (builds.length === 0) return {};
  if (typeof Worker === 'undefined') {
    if (import.meta.env.MODE === 'test') {
      const mod = await import('@webpob/calc');
      const out: Record<string, CalcOutput> = {};
      for (const b of builds) out[b.key] = mod.calculateBuild(b.build);
      return out;
    }
    const out: Record<string, CalcOutput> = {};
    for (const b of builds) out[b.key] = createEmptyCalcOutput(b.build);
    return out;
  }
  const res = await sendRequest<Extract<CalcWorkerResponse, { type: 'CALC_BATCH_RESULT' }>>({
    type: 'CALC_BATCH',
    builds,
    locale,
  });
  return res.outputs;
}

export async function computeNodePowerInWorker(
  build: Build,
  nodeId: number,
  locale?: Locale,
): Promise<NodePowerDelta> {
  if (typeof Worker === 'undefined') {
    if (import.meta.env.MODE === 'test') {
      const mod = await import('@webpob/calc');
      return mod.computeNodePower(build, nodeId);
    }
    return {
      nodeId,
      isAllocated: false,
      dpsDelta: 0,
      dpsDeltaPct: 0,
      lifeDelta: 0,
      esDelta: 0,
      ehpDelta: 0,
    };
  }
  const res = await sendRequest<Extract<CalcWorkerResponse, { type: 'NODE_POWER_RESULT' }>>({
    type: 'NODE_POWER',
    build,
    nodeId,
    locale,
  });
  return res.delta;
}

/**
 * Offloads batch NodePower heatmap scoring across candidate Notables/Keystones
 * into a dedicated background Web Worker so the passive tree canvas stays 60fps.
 */
export async function computeHeatmapInWorker(
  build: Build,
  candidateNodeIds: number[],
  locale?: Locale,
): Promise<{ items: NodePowerHeatItem[]; durationMs: number }> {
  if (typeof Worker === 'undefined') {
    return { items: [], durationMs: 0 };
  }
  const res = await sendRequest<Extract<CalcWorkerResponse, { type: 'HEATMAP_RESULT' }>>({
    type: 'HEATMAP',
    build,
    candidateNodeIds,
    locale,
  });
  return { items: res.items, durationMs: res.durationMs };
}

export async function rankSupportGemsInWorker(
  build: Build,
  groupId: string,
  limit = 8,
  locale?: Locale,
): Promise<RankedSupportRecommendation[]> {
  if (typeof Worker === 'undefined') {
    if (import.meta.env.MODE === 'test') {
      const mod = await import('@webpob/calc');
      return mod.rankSupportGemsForGroup(build, groupId, limit);
    }
    return [];
  }
  const res = await sendRequest<Extract<CalcWorkerResponse, { type: 'RANK_SUPPORTS_RESULT' }>>({
    type: 'RANK_SUPPORTS',
    build,
    groupId,
    limit,
    locale,
  });
  return res.items;
}

export async function rankUniqueUpgradesInWorker(
  build: Build,
  slot: EquipmentSlotId,
  sortBy: 'dps' | 'ehp' = 'dps',
  limit = 8,
  locale?: Locale,
): Promise<RankedUniqueUpgrade[]> {
  if (typeof Worker === 'undefined') {
    if (import.meta.env.MODE === 'test') {
      const mod = await import('@webpob/calc');
      return mod.rankUniqueUpgradesForSlot(build, slot, sortBy, limit);
    }
    return [];
  }
  const res = await sendRequest<Extract<CalcWorkerResponse, { type: 'RANK_UNIQUES_RESULT' }>>({
    type: 'RANK_UNIQUES',
    build,
    slot,
    sortBy,
    limit,
    locale,
  });
  return res.items;
}

export async function checkItemPasteInWorker(
  build: Build,
  globalLines: string[],
  locale?: Locale,
): Promise<{ parsedGlobalCount: number; output: CalcOutput }> {
  if (typeof Worker === 'undefined') {
    if (import.meta.env.MODE === 'test') {
      const mod = await import('@webpob/calc');
      const parsedGlobalCount = globalLines.filter(
        (line) => mod.parseModLine(line, 'Check').length > 0,
      ).length;
      return { parsedGlobalCount, output: mod.calculateBuild(build) };
    }
    return { parsedGlobalCount: globalLines.length, output: createEmptyCalcOutput(build) };
  }
  const res = await sendRequest<Extract<CalcWorkerResponse, { type: 'CHECK_ITEM_PASTE_RESULT' }>>({
    type: 'CHECK_ITEM_PASTE',
    build,
    globalLines,
    locale,
  });
  return { parsedGlobalCount: res.parsedGlobalCount, output: res.output };
}
