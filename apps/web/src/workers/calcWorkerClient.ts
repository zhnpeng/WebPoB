import type { Build, CalcOutput, NodePowerDelta } from '@webpob/core';
import type {
  CalcWorkerRequest,
  CalcWorkerResponse,
  NodePowerHeatItem,
} from './calc.worker';

interface PendingCall {
  resolve: (res: CalcWorkerResponse) => void;
  reject: (err: Error) => void;
}

let sharedWorker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingCall>();

function getCalcWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('./calc.worker.ts', import.meta.url), {
      type: 'module',
    });
    sharedWorker.onmessage = (ev: MessageEvent<CalcWorkerResponse>) => {
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
    sharedWorker.onerror = (ev) => {
      const err = new Error(ev.message || 'Calc worker error');
      for (const [, entry] of pending) {
        entry.reject(err);
      }
      pending.clear();
      sharedWorker?.terminate();
      sharedWorker = null;
    };
  }
  return sharedWorker;
}

export async function calculateBuildInWorker(build: Build): Promise<CalcOutput> {
  const worker = getCalcWorker();
  if (!worker) {
    const mod = await import('@webpob/calc');
    return mod.calculateBuild(build);
  }
  const requestId = nextRequestId++;
  const res = await new Promise<CalcWorkerResponse>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    const req: CalcWorkerRequest = { type: 'CALCULATE', requestId, build };
    worker.postMessage(req);
  });
  if (res.type === 'CALCULATE_RESULT') {
    return res.calc;
  }
  throw new Error(`Unexpected calc worker response: ${res.type}`);
}

export async function computeNodePowerInWorker(
  build: Build,
  nodeId: number,
  baseline: CalcOutput,
): Promise<NodePowerDelta> {
  const worker = getCalcWorker();
  if (!worker) {
    const mod = await import('@webpob/calc');
    return mod.computeNodePower(build, nodeId, baseline);
  }
  const requestId = nextRequestId++;
  const res = await new Promise<CalcWorkerResponse>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    const req: CalcWorkerRequest = { type: 'NODE_POWER', requestId, build, nodeId, baseline };
    worker.postMessage(req);
  });
  if (res.type === 'NODE_POWER_RESULT') {
    return res.power;
  }
  throw new Error(`Unexpected calc worker response: ${res.type}`);
}

/**
 * Offloads batch NodePower heatmap scoring across candidate Notables/Keystones
 * into a dedicated background Web Worker so the passive tree canvas stays 60fps.
 */
export async function computeHeatmapInWorker(
  build: Build,
  candidateNodeIds: number[],
): Promise<{ items: NodePowerHeatItem[]; durationMs: number }> {
  const worker = getCalcWorker();
  if (!worker) {
    return { items: [], durationMs: 0 };
  }
  const requestId = nextRequestId++;
  const res = await new Promise<CalcWorkerResponse>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    const req: CalcWorkerRequest = {
      type: 'HEATMAP',
      requestId,
      build,
      candidateNodeIds,
    };
    worker.postMessage(req);
  });
  if (res.type === 'HEATMAP_RESULT') {
    return { items: res.items, durationMs: res.durationMs };
  }
  throw new Error(`Unexpected calc worker response: ${res.type}`);
}
