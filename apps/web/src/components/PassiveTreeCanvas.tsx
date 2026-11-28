import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ChevronRight,
  Copy,
  Crosshair,
  Gem,
  Flame,
  GitCompare,
  ListTree,
  Loader2,
  Maximize2,
  Plus,
  RotateCcw,
  Scan,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { NodePowerDelta, PassiveNode } from '@webpob/core';
import {
  findShortestPathToNode,
  getAllClusterNotables,
  getAscendancyStartNodeId,
  getClusterNotable,
  getTreeForGame,
  getUniquesForGame,
  instantiateUniqueItem,
  normalizeAscendancyTreeKey,
} from '@webpob/data';
import { isChineseLocale, localizeStatLine, localizeText, t, toSimplifiedZh, toTraditionalZh, uiText } from '@webpob/i18n';
import { computeNodePowerInWorker } from '../workers/calcWorkerClient';
import { useWebPobStore } from '../store/useWebPobStore';
import { computeHeatmapInWorker } from '../workers/calcWorkerClient';
import type { NodePowerHeatItem } from '../workers/calc.worker';
import {
  getCachedArtImage,
  loadAscendancyArtManifest,
  resolvePoe1SpriteRect,
  resolvePoe2AscBgMeta,
  resolvePoe2PortraitFile,
  type AscendancyArtManifest,
} from '../utils/ascendancyArt';

const SPATIAL_CELL_SIZE = 320;

function getNodeRadius(kind: PassiveNode['kind'], isFullOfficial: boolean): number {
  const scale = isFullOfficial ? 2.4 : 1;
  switch (kind) {
    case 'start':
      return 34 * scale;
    case 'keystone':
      return 30 * scale;
    case 'mastery':
      return 24 * scale;
    case 'jewel':
      return 22 * scale;
    case 'notable':
      return 21 * scale;
    default:
      return 13 * scale;
  }
}

interface EdgeRecord {
  a: PassiveNode;
  b: PassiveNode;
  sameOrbitArc: boolean;
  cx?: number;
  cy?: number;
  r?: number;
  startAngle?: number;
  endAngle?: number;
  counterclockwise?: boolean;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function PassiveTreeCanvas() {
  const {
    locale,
    build,
    calc,
    dataLoading,
    treeRevision,
    treePaintMode,
    setTreePaintMode,
    togglePassiveNode,
    setMasteryEffect,
    socketJewel,
    resetPassiveTree,
    switchTreeSpec,
    addTreeSpec,
    deleteTreeSpec,
  } = useWebPobStore();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 0.08 });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIdx, setSearchIdx] = useState(0);
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
  const [masteryModalNodeId, setMasteryModalNodeId] = useState<number | null>(null);
  const [jewelModalNodeId, setJewelModalNodeId] = useState<number | null>(null);
  const [jewelModalTab, setJewelModalTab] = useState<'standard' | 'cluster' | 'timeless'>('standard');
  const [hoveredClusterNode, setHoveredClusterNode] = useState<{
    name: string;
    nameZh?: string;
    kind: 'small' | 'notable' | 'jewel';
    stats: string[];
    statsZh?: string[];
  } | null>(null);
  const [jewelSearch, setJewelSearch] = useState('');
  const [clusterSize, setClusterSize] = useState<'Large' | 'Medium' | 'Small'>('Large');
  const [clusterSmallGrant, setClusterSmallGrant] = useState('12% increased Lightning Damage');
  const [clusterEffectPct, setClusterEffectPct] = useState(0);
  const [clusterSelectedNotables, setClusterSelectedNotables] = useState<string[]>([
    'Storm Drinker',
    'Prismatic Heart',
  ]);
  const [clusterNotableSearch, setClusterNotableSearch] = useState('');
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapMap, setHeatmapMap] = useState<Map<number, NodePowerHeatItem>>(new Map());
  const [heatmapSort, setHeatmapSort] = useState<'dpsPerPoint' | 'dps' | 'ehpPerPoint' | 'ehp'>('dpsPerPoint');
  const [powerDrawerOpen, setPowerDrawerOpen] = useState(true);
  const [jumpDrawerOpen, setJumpDrawerOpen] = useState(false);
  const [jumpFilter, setJumpFilter] = useState<'keystone' | 'jewel' | 'allocated'>('keystone');
  const [jumpQuery, setJumpQuery] = useState('');
  const [allocatedDrawerOpen, setAllocatedDrawerOpen] = useState(false);
  const [allocatedCopied, setAllocatedCopied] = useState(false);
  const [highlightedNodeId, setHighlightedNodeId] = useState<number | null>(null);
  const [compareSpecIdx, setCompareSpecIdx] = useState<number | null>(null);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [artManifest, setArtManifest] = useState<AscendancyArtManifest | null>(null);
  const [artTick, setArtTick] = useState(0);
  const cameraAnimRef = useRef<number | null>(null);
  const prevAscRef = useRef<string>(build.ascendancyId);
  const lastAutoFrameKeyRef = useRef<string>('');

  useEffect(() => {
    let alive = true;
    void loadAscendancyArtManifest().then((m) => {
      if (alive && m) setArtManifest(m);
    });
    return () => {
      alive = false;
    };
  }, []);

  const treeSpecs = useMemo(
    () => (build.treeSpecs && build.treeSpecs.length > 0 ? build.treeSpecs : [build.tree]),
    [build.treeSpecs, build.tree],
  );
  const activeTreeSpecIdx = Math.max(0, Math.min(treeSpecs.length - 1, build.activeTreeSpecIndex ?? 0));

  const { diffAddedSet, diffRemovedSet } = useMemo(() => {
    const added = new Set<number>();
    const removed = new Set<number>();
    if (
      compareSpecIdx === null ||
      compareSpecIdx === activeTreeSpecIdx ||
      compareSpecIdx < 0 ||
      compareSpecIdx >= treeSpecs.length
    ) {
      return { diffAddedSet: added, diffRemovedSet: removed };
    }
    const baseSpec = treeSpecs[compareSpecIdx]!;
    const curSet = new Set<number>([
      ...build.tree.allocatedNodeIds,
      ...build.tree.weaponSet1NodeIds,
      ...build.tree.weaponSet2NodeIds,
    ]);
    const cmpSet = new Set<number>([
      ...baseSpec.allocatedNodeIds,
      ...baseSpec.weaponSet1NodeIds,
      ...baseSpec.weaponSet2NodeIds,
    ]);
    for (const id of curSet) {
      if (!cmpSet.has(id)) added.add(id);
    }
    for (const id of cmpSet) {
      if (!curSet.has(id)) removed.add(id);
    }
    return { diffAddedSet: added, diffRemovedSet: removed };
  }, [compareSpecIdx, activeTreeSpecIdx, treeSpecs, build.tree]);
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    camX: number;
    camY: number;
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    camX: 0,
    camY: 0,
  });

  // Re-evaluate whenever game switches or official full JSON finishes loading
  const tree = useMemo(() => {
    void treeRevision;
    return getTreeForGame(build.game, build.tree.treeVersion);
  }, [build.game, build.tree.treeVersion, treeRevision]);

  const isOfficialFull = Boolean(tree.isOfficialFull);

  const ascTreeKey = useMemo(
    () => normalizeAscendancyTreeKey(build.ascendancyId),
    [build.ascendancyId],
  );

  // In PoE 2, project the active Ascendancy sub-tree directly into the center (0, 0) medallion (matching in-game PoE 2!).
  // Derive the exact translation from live tree geometry: the ascendancy start hub anchors on the inner medallion rim
  // (radius 1332) along the character class's radial direction — pixel-accurate across all GGG patch versions (0.5.0 / 0.5.2+).
  const ascOffset = useMemo(() => {
    if (build.game !== 'poe2' || !isOfficialFull || !ascTreeKey) {
      return { dx: 0, dy: 0 };
    }
    const ascStartId = getAscendancyStartNodeId(tree, build.ascendancyId);
    const ascStart = ascStartId !== undefined ? tree.nodes[ascStartId] : undefined;
    const clsStartId = tree.classStartNodeIds[build.classId];
    const clsStart = clsStartId !== undefined ? tree.nodes[clsStartId] : undefined;
    if (ascStart && clsStart) {
      const cr = Math.hypot(clsStart.x, clsStart.y);
      if (cr > 1) {
        const MEDALLION_RIM_RADIUS = 1332;
        const targetX = (clsStart.x / cr) * MEDALLION_RIM_RADIUS;
        const targetY = (clsStart.y / cr) * MEDALLION_RIM_RADIUS;
        return { dx: targetX - ascStart.x, dy: targetY - ascStart.y };
      }
    }

    // Fallback: compute live ascendancy bounding-box center (only trust art manifest if within 2200 units of actual nodes)
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let count = 0;
    for (const n of Object.values(tree.nodes)) {
      if (n.ascendancyId && n.ascendancyId.toLowerCase() === ascTreeKey) {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
        count++;
      }
    }
    if (count === 0) return { dx: 0, dy: 0 };
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const bgMeta = resolvePoe2AscBgMeta(artManifest, build.ascendancyId);
    if (bgMeta && Math.hypot(cx - bgMeta.x, cy - bgMeta.y) < 2200) {
      return { dx: -bgMeta.x, dy: -bgMeta.y };
    }
    return { dx: -cx, dy: -cy };
  }, [build.game, build.classId, build.ascendancyId, isOfficialFull, ascTreeKey, artManifest, tree]);

  // Filter visible nodes: main passive tree + selected Ascendancy sub-tree (projected to center in PoE 2)
  const visibleNodes = useMemo(() => {
    const out: PassiveNode[] = [];
    const shiftAsc = ascOffset.dx !== 0 || ascOffset.dy !== 0;
    for (const n of Object.values(tree.nodes)) {
      if (!n.ascendancyId) {
        out.push(n);
      } else if (ascTreeKey && n.ascendancyId.toLowerCase() === ascTreeKey) {
        out.push(shiftAsc ? { ...n, x: n.x + ascOffset.dx, y: n.y + ascOffset.dy } : n);
      }
    }
    return out;
  }, [tree, ascTreeKey, ascOffset]);

  // Expose live projected ascendancy geometry metrics for browser E2E drift detection
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let ascNodeCount = 0;
    let ascMaxProjectedRadius = 0;
    for (const n of visibleNodes) {
      if (n.ascendancyId) {
        ascNodeCount++;
        const r = Math.hypot(n.x, n.y);
        if (r > ascMaxProjectedRadius) ascMaxProjectedRadius = r;
      }
    }
    (window as unknown as Record<string, unknown>).__WEBPOB_TREE_METRICS__ = {
      game: build.game,
      ascendancyId: build.ascendancyId,
      ascNodeCount,
      ascMaxProjectedRadius: Math.round(ascMaxProjectedRadius),
      ascOffset,
    };
  }, [build.game, build.ascendancyId, visibleNodes, ascOffset]);

  const visibleNodeMap = useMemo(() => {
    const map = new Map<number, PassiveNode>();
    for (const n of visibleNodes) map.set(n.id, n);
    return map;
  }, [visibleNodes]);

  const ascStartNodeId = useMemo(
    () => getAscendancyStartNodeId(tree, build.ascendancyId),
    [tree, build.ascendancyId],
  );

  const ascendancyCenter = useMemo(() => {
    if (build.game === 'poe2' && isOfficialFull) {
      const ascCount = ascTreeKey
        ? visibleNodes.filter((n) => n.ascendancyId && n.ascendancyId.toLowerCase() === ascTreeKey).length
        : 0;
      return { x: 0, y: 0, radius: 1355, count: ascCount };
    }
    if (!ascTreeKey) return null;
    const ascNodes = visibleNodes.filter(
      (n) => n.ascendancyId && n.ascendancyId.toLowerCase() === ascTreeKey,
    );
    if (ascNodes.length === 0) return null;
    let sumX = 0;
    let sumY = 0;
    for (const n of ascNodes) {
      sumX += n.x;
      sumY += n.y;
    }
    const cx = sumX / ascNodes.length;
    const cy = sumY / ascNodes.length;
    let maxDist = 300;
    for (const n of ascNodes) {
      const d = Math.hypot(n.x - cx, n.y - cy);
      if (d > maxDist) maxDist = d;
    }
    return { x: cx, y: cy, radius: maxDist + 180, count: ascNodes.length };
  }, [visibleNodes, build.game, isOfficialFull, ascTreeKey]);

  // Visual Cluster Jewel Sub-Graphs synthesized radially around every allocated Cluster Jewel socket
  const clusterSubGraphs = useMemo(() => {
    const graphs: Array<{
      parentSocket: PassiveNode;
      cx: number;
      cy: number;
      ringRadius: number;
      nodes: Array<{
        x: number;
        y: number;
        kind: 'small' | 'notable' | 'jewel';
        name: string;
        nameZh?: string;
        stats: string[];
        statsZh?: string[];
      }>;
    }> = [];
    const offset = isOfficialFull ? 600 : 115;
    const ringRadius = isOfficialFull ? 320 : 62;
    for (const [nodeIdStr, itemId] of Object.entries(build.tree.socketedJewels ?? {})) {
      const nodeId = Number(nodeIdStr);
      if (!build.tree.allocatedNodeIds.includes(nodeId)) continue;
      const parentSocket = tree.nodes[nodeId];
      const jewel = build.items[itemId];
      if (!parentSocket || !jewel || !jewel.baseName.toLowerCase().includes('cluster jewel')) continue;

      const allLines = [...jewel.implicits, ...jewel.explicits];
      let totalAdded = 8;
      let socketCount = 0;
      const smallGrants: string[] = [];
      const notableNames: string[] = [];
      for (const l of allLines) {
        let m = l.match(/^Adds (\d+) Passive Skills$/i);
        if (m) {
          totalAdded = Number(m[1]);
          continue;
        }
        m = l.match(/^(\d+) Added Passive Skills? (?:is|are) (?:a )?Jewel Sockets?$/i);
        if (m) {
          socketCount = Number(m[1]);
          continue;
        }
        m = l.match(/^1 Added Passive Skill is (.+)$/i);
        if (m) {
          notableNames.push(m[1]!.trim());
          continue;
        }
        m = l.match(/^Added Small Passive Skills (?:also )?grant:\s*(.+)$/i);
        if (m) {
          smallGrants.push(m[1]!.trim());
        }
      }

      const smallCount = Math.max(1, totalAdded - socketCount - notableNames.length);
      const outAngle = Math.atan2(parentSocket.y, parentSocket.x);
      const cx = parentSocket.x + Math.cos(outAngle) * offset;
      const cy = parentSocket.y + Math.sin(outAngle) * offset;

      // Order ring nodes cleanly: entrance small, alternating notables/sockets/smalls
      const specs: Array<{
        kind: 'small' | 'notable' | 'jewel';
        name: string;
        nameZh?: string;
        stats: string[];
        statsZh?: string[];
      }> = [];
      const totalSlots = Math.max(3, Math.min(12, totalAdded));
      const notablePositions = new Set<number>();
      const socketPositions = new Set<number>();
      for (let i = 0; i < notableNames.length; i++) {
        notablePositions.add(Math.round(((i + 1) * totalSlots) / (notableNames.length + 1)));
      }
      let placedSockets = 0;
      for (let pos = 1; pos < totalSlots && placedSockets < socketCount; pos++) {
        const idx = (pos * 2) % totalSlots;
        if (idx !== 0 && !notablePositions.has(idx) && !socketPositions.has(idx)) {
          socketPositions.add(idx);
          placedSockets++;
        }
      }

      let nIdx = 0;
      for (let i = 0; i < totalSlots; i++) {
        if (notablePositions.has(i) && nIdx < notableNames.length) {
          const nName = notableNames[nIdx++]!;
          const def = getClusterNotable(nName);
          specs.push({
            kind: 'notable',
            name: def?.en ?? nName,
            nameZh: def?.zh,
            stats: def?.st ?? [nName],
            statsZh: def?.sz,
          });
        } else if (socketPositions.has(i)) {
          specs.push({
            kind: 'jewel',
            name: 'Cluster Jewel Socket',
            nameZh: '星团子珠宝插槽',
            stats: ['Medium / Small Cluster Socket'],
          });
        } else {
          specs.push({
            kind: 'small',
            name: smallCount > 0 ? 'Cluster Small Passive' : 'Cluster Passive',
            nameZh: '星团小天赋',
            stats: smallGrants.length > 0 ? smallGrants : ['Cluster Small Passive'],
          });
        }
      }

      const startAngle = outAngle + Math.PI;
      const nodes = specs.map((sp, i) => {
        const ang = startAngle + (i / specs.length) * Math.PI * 2;
        return {
          ...sp,
          x: cx + Math.cos(ang) * ringRadius,
          y: cy + Math.sin(ang) * ringRadius,
        };
      });

      graphs.push({ parentSocket, cx, cy, ringRadius, nodes });
    }
    return graphs;
  }, [build.tree.socketedJewels, build.tree.allocatedNodeIds, build.items, tree.nodes, isOfficialFull]);

  // Build spatial hash grid for O(1) hover & click hit-testing across 4,500+ nodes
  const spatialGrid = useMemo(() => {
    const grid = new Map<string, PassiveNode[]>();
    for (const node of visibleNodes) {
      const cx = Math.floor(node.x / SPATIAL_CELL_SIZE);
      const cy = Math.floor(node.y / SPATIAL_CELL_SIZE);
      const key = `${cx},${cy}`;
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(node);
    }
    return grid;
  }, [visibleNodes]);

  // Precompute deduplicated edge list with orbit arc geometry & AABB for viewport culling
  const edgeList = useMemo(() => {
    const seen = new Set<string>();
    const edges: EdgeRecord[] = [];
    const groups = tree.groups ?? {};

    for (const a of visibleNodes) {
      for (const bId of a.adjacent) {
        const b = visibleNodeMap.get(bId);
        if (!b) continue;
        const key = a.id < bId ? `${a.id}-${bId}` : `${bId}-${a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        let sameOrbitArc = false;
        let cx: number | undefined;
        let cy: number | undefined;
        let r: number | undefined;
        let startAngle: number | undefined;
        let endAngle: number | undefined;
        let counterclockwise = false;

        if (
          a.group !== undefined &&
          a.group === b.group &&
          a.orbit !== undefined &&
          a.orbit > 0 &&
          a.orbit === b.orbit &&
          a.orbitRadius &&
          groups[a.group]
        ) {
          const g = groups[a.group]!;
          const isAscGroup = Boolean(a.ascendancyId && b.ascendancyId);
          cx = g.x + (isAscGroup ? ascOffset.dx : 0);
          cy = g.y + (isAscGroup ? ascOffset.dy : 0);
          r = a.orbitRadius;
          const angA = Math.atan2(a.y - cy, a.x - cx);
          const angB = Math.atan2(b.y - cy, b.x - cx);
          let diff = angB - angA;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          // Draw curved arc only if span is <= 180 deg
          if (Math.abs(diff) < Math.PI - 0.05) {
            sameOrbitArc = true;
            startAngle = angA;
            endAngle = angB;
            counterclockwise = diff < 0;
          }
        }

        const pad = r ? r : 0;
        edges.push({
          a,
          b,
          sameOrbitArc,
          cx,
          cy,
          r,
          startAngle,
          endAngle,
          counterclockwise,
          minX: sameOrbitArc && cx !== undefined ? cx - pad : Math.min(a.x, b.x),
          maxX: sameOrbitArc && cx !== undefined ? cx + pad : Math.max(a.x, b.x),
          minY: sameOrbitArc && cy !== undefined ? cy - pad : Math.min(a.y, b.y),
          maxY: sameOrbitArc && cy !== undefined ? cy + pad : Math.max(a.y, b.y),
        });
      }
    }
    return edges;
  }, [visibleNodes, visibleNodeMap, tree, ascOffset]);

  const sharedSet = useMemo(() => new Set(build.tree.allocatedNodeIds), [build.tree.allocatedNodeIds]);
  const set1Set = useMemo(() => new Set(build.tree.weaponSet1NodeIds), [build.tree.weaponSet1NodeIds]);
  const set2Set = useMemo(() => new Set(build.tree.weaponSet2NodeIds), [build.tree.weaponSet2NodeIds]);

  const centerOnBuild = useCallback(() => {
    const startId = tree.classStartNodeIds[build.classId];
    const focusIds =
      build.tree.allocatedNodeIds.length > 1
        ? build.tree.allocatedNodeIds
        : startId
          ? [startId]
          : [];

    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const id of focusIds) {
      const n = tree.nodes[id];
      if (n && !n.ascendancyId) {
        sumX += n.x;
        sumY += n.y;
        count++;
      }
    }

    const defaultZoom = isOfficialFull ? (build.game === 'poe2' ? 0.12 : 0.13) : 0.62;
    if (build.game === 'poe2' && isOfficialFull && count <= 1) {
      // Frame the iconic PoE 2 central Ascendancy portrait medallion & class starts ring
      setCamera({ x: 0, y: 0, zoom: 0.14 });
    } else if (count > 0) {
      const cx = sumX / count;
      const cy = sumY / count;
      setCamera({ x: -cx * defaultZoom, y: -cy * defaultZoom, zoom: defaultZoom });
    } else {
      setCamera({ x: 0, y: 0, zoom: defaultZoom });
    }
  }, [tree, build.classId, build.tree.allocatedNodeIds, build.game, isOfficialFull]);

  const fitWholeTree = useCallback(() => {
    const container = containerRef.current;
    const w = container?.clientWidth ?? 1000;
    const h = container?.clientHeight ?? 700;
    if (tree.bounds) {
      const spanX = Math.max(1000, tree.bounds.maxX - tree.bounds.minX);
      const spanY = Math.max(1000, tree.bounds.maxY - tree.bounds.minY);
      const zoom = Math.min(w / spanX, h / spanY) * 0.9;
      const midX = (tree.bounds.minX + tree.bounds.maxX) / 2;
      const midY = (tree.bounds.minY + tree.bounds.maxY) / 2;
      setCamera({ x: -midX * zoom, y: -midY * zoom, zoom });
    } else {
      setCamera({ x: 0, y: 0, zoom: 0.6 });
    }
  }, [tree]);

  // Smoothly animate { x, y, zoom } camera state to frame a target
  const animateCamera = useCallback(
    (target: { x: number; y: number; zoom: number }, durationMs = 380) => {
      if (cameraAnimRef.current !== null) {
        cancelAnimationFrame(cameraAnimRef.current);
        cameraAnimRef.current = null;
      }
      const start = { ...camera };
      const startTime = performance.now();
      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
      const tick = (now: number) => {
        const progress = Math.min(1, (now - startTime) / durationMs);
        const eased = easeOutCubic(progress);
        setCamera({
          x: start.x + (target.x - start.x) * eased,
          y: start.y + (target.y - start.y) * eased,
          zoom: start.zoom + (target.zoom - start.zoom) * eased,
        });
        if (progress < 1) {
          cameraAnimRef.current = requestAnimationFrame(tick);
        } else {
          cameraAnimRef.current = null;
        }
      };
      cameraAnimRef.current = requestAnimationFrame(tick);
    },
    [camera],
  );

  useEffect(() => {
    return () => {
      if (cameraAnimRef.current !== null) cancelAnimationFrame(cameraAnimRef.current);
    };
  }, []);

  const cancelCameraAnimation = useCallback(() => {
    if (cameraAnimRef.current !== null) {
      cancelAnimationFrame(cameraAnimRef.current);
      cameraAnimRef.current = null;
    }
  }, []);

  const panToNode = useCallback(
    (nodeId: number) => {
      const target = visibleNodeMap.get(nodeId) ?? tree.nodes[nodeId];
      if (!target) return;
      const targetZoom = isOfficialFull ? 0.28 : 1.1;
      animateCamera({
        x: -target.x * targetZoom,
        y: -target.y * targetZoom,
        zoom: targetZoom,
      });
      setHighlightedNodeId(nodeId);
      setHoveredNodeId(nodeId);
    },
    [visibleNodeMap, tree, isOfficialFull, animateCamera],
  );

  // Frame only the player's allocated passives (shared + PoE 2 weapon sets)
  const fitAllocated = useCallback(() => {
    const allocatedIds = new Set<number>([
      ...build.tree.allocatedNodeIds,
      ...(build.game === 'poe2'
        ? [...build.tree.weaponSet1NodeIds, ...build.tree.weaponSet2NodeIds]
        : []),
    ]);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let count = 0;
    for (const id of allocatedIds) {
      const node = visibleNodeMap.get(id) ?? tree.nodes[id];
      if (!node) continue;
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
      count++;
    }
    if (count === 0) {
      centerOnBuild();
      return;
    }
    const container = containerRef.current;
    const w = container?.clientWidth ?? 1000;
    const h = container?.clientHeight ?? 700;
    const padWorld = isOfficialFull ? 520 : 140;
    const spanX = Math.max(isOfficialFull ? 700 : 260, maxX - minX + padWorld * 2);
    const spanY = Math.max(isOfficialFull ? 700 : 260, maxY - minY + padWorld * 2);
    const minZoom = isOfficialFull ? 0.025 : 0.3;
    const maxZoom = isOfficialFull ? 0.75 : 2.2;
    const zoom = Math.max(minZoom, Math.min(maxZoom, Math.min(w / spanX, h / spanY)));
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    animateCamera({ x: -midX * zoom, y: -midY * zoom, zoom }, 420);
  }, [build.tree, build.game, visibleNodeMap, tree, isOfficialFull, centerOnBuild, animateCamera]);

  const focusAscendancy = useCallback(() => {
    if (!ascendancyCenter) return;
    const container = containerRef.current;
    const minDim = Math.min(container?.clientWidth ?? 900, container?.clientHeight ?? 700);
    const idealZoom = isOfficialFull
      ? Math.max(0.14, Math.min(0.28, (minDim * 0.72) / (ascendancyCenter.radius * 2)))
      : 0.9;
    animateCamera(
      {
        x: -ascendancyCenter.x * idealZoom,
        y: -ascendancyCenter.y * idealZoom,
        zoom: idealZoom,
      },
      380,
    );
  }, [ascendancyCenter, isOfficialFull, animateCamera]);

  // Auto-center whenever game, build, or official tree loads.
  // On mobile (< 768px), auto-frame all allocated passives so imported builds are immediately readable.
  const hasAllocatedNodes =
    build.tree.allocatedNodeIds.length > 1 ||
    (build.game === 'poe2' &&
      (build.tree.weaponSet1NodeIds.length > 0 || build.tree.weaponSet2NodeIds.length > 0));

  useEffect(() => {
    const frameKey = `${build.id}:${build.game}:${treeRevision}:${hasAllocatedNodes ? 'alloc' : 'empty'}`;
    if (lastAutoFrameKeyRef.current === frameKey) return;
    lastAutoFrameKeyRef.current = frameKey;

    const container = containerRef.current;
    const isMobileViewport = Boolean(
      (container && container.clientWidth > 0 && container.clientWidth < 768) ||
        (typeof window !== 'undefined' && window.innerWidth < 768),
    );
    if (isMobileViewport && hasAllocatedNodes) {
      const allocatedIds = new Set<number>([
        ...build.tree.allocatedNodeIds,
        ...(build.game === 'poe2'
          ? [...build.tree.weaponSet1NodeIds, ...build.tree.weaponSet2NodeIds]
          : []),
      ]);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let count = 0;
      for (const id of allocatedIds) {
        const node = visibleNodeMap.get(id) ?? tree.nodes[id];
        if (!node) continue;
        minX = Math.min(minX, node.x);
        maxX = Math.max(maxX, node.x);
        minY = Math.min(minY, node.y);
        maxY = Math.max(maxY, node.y);
        count++;
      }
      if (count > 0) {
        const w = container?.clientWidth || window.innerWidth || 390;
        const h = container?.clientHeight || Math.max(400, window.innerHeight - 100);
        const padWorld = isOfficialFull ? 640 : 160;
        const spanX = Math.max(isOfficialFull ? 700 : 260, maxX - minX + padWorld * 2);
        const spanY = Math.max(isOfficialFull ? 700 : 260, maxY - minY + padWorld * 2);
        const minZoom = isOfficialFull ? 0.025 : 0.3;
        const maxZoom = isOfficialFull ? 0.75 : 2.2;
        const zoom = Math.max(minZoom, Math.min(maxZoom, Math.min(w / spanX, h / spanY)));
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        setCamera({ x: -midX * zoom, y: -midY * zoom, zoom });
        return;
      }
    }
    centerOnBuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build.id, build.game, treeRevision, hasAllocatedNodes]);

  // Smoothly pan to the Ascendancy medallion whenever the user switches Ascendancy
  useEffect(() => {
    if (prevAscRef.current !== build.ascendancyId) {
      prevAscRef.current = build.ascendancyId;
      if (build.ascendancyId && ascendancyCenter) {
        focusAscendancy();
      }
    }
  }, [build.ascendancyId, ascendancyCenter, focusAscendancy]);

  // Background Web Worker batch Node Power Heatmap when enabled
  useEffect(() => {
    if (!heatmapEnabled) {
      setHeatmapMap(new Map());
      setHeatmapLoading(false);
      return;
    }
    let cancelled = false;
    setHeatmapLoading(true);

    // Pick unallocated Notable & Keystone nodes closest to currently allocated nodes (cap 300)
    const allocCoords: Array<{ x: number; y: number }> = [];
    for (const id of build.tree.allocatedNodeIds) {
      const n = tree.nodes[id];
      if (n) allocCoords.push({ x: n.x, y: n.y });
    }
    const candidates = visibleNodes
      .filter((n) => (n.kind === 'notable' || n.kind === 'keystone') && !sharedSet.has(n.id))
      .map((n) => {
        let minDist = Infinity;
        for (const c of allocCoords) {
          const d = Math.hypot(n.x - c.x, n.y - c.y);
          if (d < minDist) minDist = d;
        }
        return { id: n.id, dist: minDist };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 300)
      .map((c) => c.id);

    computeHeatmapInWorker(build, candidates)
      .then(({ items }) => {
        if (cancelled) return;
        const next = new Map<number, NodePowerHeatItem>();
        for (const it of items) next.set(it.nodeId, it);
        setHeatmapMap(next);
        setHeatmapLoading(false);
      })
      .catch(() => {
        if (!cancelled) setHeatmapLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [heatmapEnabled, build, tree, visibleNodes, sharedSet]);

  const matchedSearchList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const qSimp = toSimplifiedZh(q);
    const matches: PassiveNode[] = [];
    for (const node of visibleNodes) {
      const hay = [
        node.name.en,
        node.name.zh,
        node.name.zhTw ?? '',
        ...node.stats,
        ...(node.statsZh ?? []),
        ...(node.statsZhTw ?? []),
      ]
        .join(' ')
        .toLowerCase();
      if (hay.includes(q) || (qSimp !== q && hay.includes(qSimp))) {
        matches.push(node);
      }
    }
    return matches;
  }, [visibleNodes, searchQuery]);

  const matchedSearchIds = useMemo(
    () => new Set(matchedSearchList.map((n) => n.id)),
    [matchedSearchList],
  );

  const jumpToNodeId = useCallback(
    (nodeId: number) => {
      panToNode(nodeId);
    },
    [panToNode],
  );

  const allocatedTreeSet = useMemo(
    () =>
      new Set<number>([
        ...build.tree.allocatedNodeIds,
        ...build.tree.weaponSet1NodeIds,
        ...build.tree.weaponSet2NodeIds,
      ]),
    [build.tree.allocatedNodeIds, build.tree.weaponSet1NodeIds, build.tree.weaponSet2NodeIds],
  );

  const jumpDrawerNodes = useMemo(() => {
    const q = jumpQuery.trim().toLowerCase();
    const pool = visibleNodes.filter((node) => {
      if (jumpFilter === 'keystone') return node.kind === 'keystone';
      if (jumpFilter === 'jewel') return node.kind === 'jewel';
      return (
        (node.kind === 'notable' || node.kind === 'keystone') && allocatedTreeSet.has(node.id)
      );
    });
    const qSimp = toSimplifiedZh(q);
    const filtered = q
      ? pool.filter((node) => {
          const hay = [
            node.name.en,
            node.name.zh,
            node.name.zhTw ?? '',
            ...node.stats,
            ...(node.statsZh ?? []),
            ...(node.statsZhTw ?? []),
          ]
            .join(' ')
            .toLowerCase();
          return hay.includes(q) || (qSimp !== q && hay.includes(qSimp));
        })
      : pool;
    return filtered
      .slice()
      .sort((a, b) => {
        const aAlloc = allocatedTreeSet.has(a.id) ? 0 : 1;
        const bAlloc = allocatedTreeSet.has(b.id) ? 0 : 1;
        if (aAlloc !== bAlloc) return aAlloc - bAlloc;
        return localizeText(a.name, locale).localeCompare(localizeText(b.name, locale));
      })
      .slice(0, 120);
  }, [visibleNodes, jumpFilter, jumpQuery, allocatedTreeSet, locale]);

  const allocatedSummary = useMemo(() => {
    const allocatedNodes = [...allocatedTreeSet]
      .map((id) => tree.nodes[id])
      .filter((node): node is PassiveNode => Boolean(node));

    const keystones = allocatedNodes.filter((node) => node.kind === 'keystone');
    const ascendancyNotables = allocatedNodes.filter(
      (node) => node.kind === 'notable' && Boolean(node.ascendancyId),
    );
    const notables = allocatedNodes.filter(
      (node) => node.kind === 'notable' && !node.ascendancyId,
    );
    const jewelSockets = allocatedNodes.filter((node) => node.kind === 'jewel');
    const masteries = allocatedNodes.filter((node) => node.kind === 'mastery');
    const smallPassives = allocatedNodes.filter((node) => node.kind === 'small');

    const byName = (a: PassiveNode, b: PassiveNode) =>
      localizeText(a.name, locale).localeCompare(localizeText(b.name, locale));
    keystones.sort(byName);
    ascendancyNotables.sort(byName);
    notables.sort(byName);
    masteries.sort(byName);

    const modifierCounts = new Map<string, number>();
    const addLine = (line: string, alreadyLocalized = false) => {
      const localized = (
        alreadyLocalized && /[\u4e00-\u9fff]/.test(line) ? line : localizeStatLine(line, locale)
      ).trim();
      if (!localized) return;
      modifierCounts.set(localized, (modifierCounts.get(localized) ?? 0) + 1);
    };
    for (const node of allocatedNodes) {
      if (node.kind === 'mastery') {
        const chosen = build.tree.masteryEffects[node.id];
        if (chosen) {
          if (isChineseLocale(locale) && node.masteryEffects) {
            const matched = node.masteryEffects.find(
              (m) => m.stats.join('\n') === chosen || m.stats.includes(chosen),
            );
            const localizedList =
              locale === 'zh-TW'
                ? matched?.statsZhTw ?? matched?.statsZh?.map((s) => toTraditionalZh(s))
                : matched?.statsZh;
            if (localizedList && localizedList.length > 0) {
              for (const s of localizedList) addLine(s, true);
              continue;
            }
          }
          addLine(chosen);
        }
        continue;
      }
      if (locale === 'zh-TW' && node.statsZhTw && node.statsZhTw.length > 0) {
        for (const stat of node.statsZhTw) addLine(stat, true);
      } else if (locale === 'zh-TW' && node.statsZh && node.statsZh.length > 0) {
        for (const stat of node.statsZh) addLine(toTraditionalZh(stat), true);
      } else if (locale === 'zh-CN' && node.statsZh && node.statsZh.length > 0) {
        for (const stat of node.statsZh) addLine(stat, true);
      } else {
        for (const stat of node.stats) addLine(stat);
      }
    }
    const modifiers = [...modifierCounts.entries()]
      .map(([line, count]) => ({ line, count }))
      .sort((a, b) => b.count - a.count || a.line.localeCompare(b.line));

    return {
      allocatedNodes,
      keystones,
      ascendancyNotables,
      notables,
      jewelSockets,
      masteries,
      smallPassives,
      modifiers,
    };
  }, [allocatedTreeSet, tree.nodes, build.tree.masteryEffects, locale]);

  const copyAllocatedSummary = useCallback(async () => {
    const sections: string[] = [];
    if (allocatedSummary.keystones.length > 0) {
      sections.push(
        `${uiText(locale, '基石', 'Keystones')}:\n${allocatedSummary.keystones
          .map((node) => `- ${localizeText(node.name, locale)}`)
          .join('\n')}`,
      );
    }
    const notables = [...allocatedSummary.ascendancyNotables, ...allocatedSummary.notables];
    if (notables.length > 0) {
      sections.push(
        `${uiText(locale, '大点', 'Notables')}:\n${notables
          .map((node) => `- ${localizeText(node.name, locale)}`)
          .join('\n')}`,
      );
    }
    if (allocatedSummary.masteries.length > 0) {
      sections.push(
        `${uiText(locale, '专精', 'Masteries')}:\n${allocatedSummary.masteries
          .map((node) => {
            const chosen = build.tree.masteryEffects[node.id];
            return `- ${localizeText(node.name, locale)}${chosen ? `: ${localizeStatLine(chosen, locale)}` : ''}`;
          })
          .join('\n')}`,
      );
    }
    const text =
      sections.join('\n\n') ||
      (uiText(locale, '尚未分配任何天赋', 'No passives allocated yet'));
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setAllocatedCopied(true);
      window.setTimeout(() => setAllocatedCopied(false), 1500);
    } catch {
      // Clipboard unavailable; leave the button state unchanged.
    }
  }, [allocatedSummary, build.tree.masteryEffects, locale]);

  const topPowerNodes = useMemo(() => {
    if (!heatmapEnabled || heatmapMap.size === 0) return [];
    const items = [...heatmapMap.values()]
      .map((item) => ({ item, node: tree.nodes[item.nodeId] }))
      .filter((x): x is { item: NodePowerHeatItem; node: PassiveNode } => Boolean(x.node));
    items.sort((a, b) => {
      if (heatmapSort === 'dpsPerPoint') return b.item.dpsPerPoint - a.item.dpsPerPoint || b.item.dpsDeltaPct - a.item.dpsDeltaPct;
      if (heatmapSort === 'dps') return b.item.dpsDeltaPct - a.item.dpsDeltaPct;
      if (heatmapSort === 'ehpPerPoint') return b.item.ehpPerPoint - a.item.ehpPerPoint || b.item.ehpDeltaPct - a.item.ehpDeltaPct;
      return b.item.ehpDeltaPct - a.item.ehpDeltaPct;
    });
    return items.slice(0, 12);
  }, [heatmapEnabled, heatmapMap, heatmapSort, tree]);

  const jumpToSearchMatch = (nextIndex: number) => {
    if (matchedSearchList.length === 0) return;
    const idx = ((nextIndex % matchedSearchList.length) + matchedSearchList.length) % matchedSearchList.length;
    setSearchIdx(idx);
    const target = matchedSearchList[idx]!;
    const targetZoom = isOfficialFull ? 0.22 : 1.0;
    setCamera({ x: -target.x * targetZoom, y: -target.y * targetZoom, zoom: targetZoom });
  };

  // Preview shortest path for hovered unallocated node
  const previewPathSet = useMemo(() => {
    if (hoveredNodeId === null) return new Set<number>();
    const hovered = tree.nodes[hoveredNodeId];
    if (!hovered || hovered.kind === 'mastery') return new Set<number>();
    const baseAllocated =
      build.game === 'poe2' && treePaintMode === 'set1'
        ? new Set([...sharedSet, ...set1Set])
        : build.game === 'poe2' && treePaintMode === 'set2'
          ? new Set([...sharedSet, ...set2Set])
          : new Set(sharedSet);
    if (hovered.ascendancyId && ascStartNodeId) {
      baseAllocated.add(ascStartNodeId);
    }
    if (baseAllocated.has(hoveredNodeId)) return new Set<number>();
    return new Set(findShortestPathToNode(tree, baseAllocated, hoveredNodeId));
  }, [hoveredNodeId, build.game, treePaintMode, sharedSet, set1Set, set2Set, ascStartNodeId, tree]);

  // Live Node Power Delta calculation on hover (offloaded to calc.worker)
  const [hoveredPower, setHoveredPower] = useState<NodePowerDelta | null>(null);
  useEffect(() => {
    if (hoveredNodeId === null) {
      setHoveredPower(null);
      return;
    }
    const node = tree.nodes[hoveredNodeId];
    if (!node || node.kind === 'start' || node.kind === 'mastery') {
      setHoveredPower(null);
      return;
    }
    let cancelled = false;
    void computeNodePowerInWorker(build, hoveredNodeId, calc)
      .then((power) => {
        if (!cancelled) setHoveredPower(power);
      })
      .catch(() => {
        if (!cancelled) setHoveredPower(null);
      });
    return () => {
      cancelled = true;
    };
  }, [hoveredNodeId, tree, build, calc]);

  const hoverPathNodeCount = previewPathSet.size;
  const hoverEhpDeltaPct =
    hoveredPower && calc.defence.effectiveHitPool > 0
      ? (hoveredPower.ehpDelta / calc.defence.effectiveHitPool) * 100
      : 0;
  const hoverDpsPerPoint =
    hoveredPower && hoverPathNodeCount > 1 ? hoveredPower.dpsDeltaPct / hoverPathNodeCount : null;
  const hoverEhpPerPoint =
    hoveredPower && hoverPathNodeCount > 1 ? hoverEhpDeltaPct / hoverPathNodeCount : null;
  const isHighEfficiencyHover = hoverDpsPerPoint !== null && hoverDpsPerPoint >= 2;

  const screenToWorld = useCallback(
    (sx: number, sy: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return {
        x: (sx - cx - camera.x) / camera.zoom,
        y: (sy - cy - camera.y) / camera.zoom,
      };
    },
    [camera],
  );

  const exportTreePng = useCallback(() => {
    const srcCanvas = canvasRef.current;
    if (!srcCanvas || srcCanvas.width === 0 || srcCanvas.height === 0) return;
    const out = document.createElement('canvas');
    out.width = srcCanvas.width;
    out.height = srcCanvas.height;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(srcCanvas, 0, 0);

    // Subtle build header watermark overlay (HiDPI aware)
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.scale(dpr, dpr);
    const pad = 14;
    const boxW = Math.min(460, srcCanvas.width / dpr - pad * 2);
    ctx.fillStyle = 'rgba(11, 14, 22, 0.86)';
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(pad, pad, boxW, 52, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fde68a';
    ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
    ctx.fillText(`WebPoB · ${build.name}`, pad + 12, pad + 21, boxW - 24);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '11px ui-monospace, SFMono-Regular, monospace';
    const dps = Math.round(calc.offence.fullDps ?? calc.offence.totalDps).toLocaleString();
    ctx.fillText(
      `${build.game.toUpperCase()} Lv.${build.level} ${build.classId}${build.ascendancyId !== 'None' ? ` (${build.ascendancyId})` : ''} · ${calc.allocatedPoints} pts · DPS ${dps}`,
      pad + 12,
      pad + 40,
      boxW - 24,
    );
    ctx.restore();

    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    const safeName = build.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]+/g, '_').slice(0, 48) || 'tree';
    a.download = `WebPoB-Tree-${safeName}.png`;
    a.click();
  }, [build.name, build.game, build.level, build.classId, build.ascendancyId, calc]);

  // High-FPS Viewport-Culled Canvas Render
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Deep obsidian radial backdrop
    const grad = ctx.createRadialGradient(
      width / 2,
      height / 2,
      30,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.78,
    );
    grad.addColorStop(0, '#131826');
    grad.addColorStop(1, '#080a0f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    ctx.translate(width / 2 + camera.x, height / 2 + camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    // Compute visible world viewport bounds for frustum culling
    const padWorld = 300 / Math.max(0.02, camera.zoom);
    const viewMinX = (-width / 2 - camera.x) / camera.zoom - padWorld;
    const viewMaxX = (width / 2 - camera.x) / camera.zoom + padWorld;
    const viewMinY = (-height / 2 - camera.y) / camera.zoom - padWorld;
    const viewMaxY = (height / 2 - camera.y) / camera.zoom + padWorld;

    const invZoom = 1 / camera.zoom;
    const baseLineWidth = Math.max(isOfficialFull ? 10 : 2, 1.5 * invZoom);
    const activeLineWidth = Math.max(isOfficialFull ? 18 : 4, 3.2 * invZoom);

    // 0. Draw authentic Ascendancy / Class portrait medallion backdrop
    if (ascendancyCenter) {
      const bumpArt = () => setArtTick((n) => n + 1);
      ctx.save();

      if (build.game === 'poe2' && isOfficialFull) {
        const r = ascendancyCenter.radius;
        const portraitFile = resolvePoe2PortraitFile(artManifest, build.ascendancyId, build.classId);
        const portraitImg = portraitFile ? getCachedArtImage(`/data/${portraitFile}`, bumpArt) : null;
        const ringImg = artManifest?.poe2.ring
          ? getCachedArtImage(`/data/${artManifest.poe2.ring}`, bumpArt)
          : null;

        // Deep obsidian circular fill + official PoE 2 circular character portrait
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = '#090b12';
        ctx.fill();
        ctx.clip();

        if (portraitImg) {
          const pad = 16;
          ctx.drawImage(portraitImg, -(r + pad), -(r + pad), (r + pad) * 2, (r + pad) * 2);
          // Subtle inner vignette so passive nodes & golden arcs stay razor-sharp over fiery artwork
          const vig = ctx.createRadialGradient(0, 0, r * 0.28, 0, 0, r);
          vig.addColorStop(0, 'rgba(6, 8, 14, 0.06)');
          vig.addColorStop(0.72, 'rgba(6, 8, 14, 0.22)');
          vig.addColorStop(1, 'rgba(6, 8, 14, 0.58)');
          ctx.fillStyle = vig;
          ctx.fillRect(-r, -r, r * 2, r * 2);
        } else {
          const fallbackGrad = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, r);
          fallbackGrad.addColorStop(0, 'rgba(217, 155, 45, 0.16)');
          fallbackGrad.addColorStop(1, 'rgba(12, 15, 24, 0.85)');
          ctx.fillStyle = fallbackGrad;
          ctx.fillRect(-r, -r, r * 2, r * 2);
        }
        ctx.restore();

        // Official 6-clasp ornate gothic ring frame (aligned with the 6 class starts at radius ~1465)
        if (ringImg) {
          const ringHalf = 1805;
          ctx.drawImage(ringImg, -ringHalf, -ringHalf, ringHalf * 2, ringHalf * 2);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(229, 188, 114, 0.5)';
          ctx.lineWidth = Math.max(18, 2.2 * invZoom);
          ctx.stroke();
        }
      } else {
        // PoE 1: circular Ascendancy character portrait cropped from official ascendancy-3.webp sprite sheet
        const { x: cx, y: cy, radius: r } = ascendancyCenter;
        const rect = resolvePoe1SpriteRect(artManifest, build.ascendancyId);
        const sheetImg =
          rect && artManifest?.poe1.sheet
            ? getCachedArtImage(`/data/${artManifest.poe1.sheet}`, bumpArt)
            : null;

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = '#0b0e17';
        ctx.fill();
        ctx.clip();

        if (sheetImg && rect) {
          ctx.drawImage(sheetImg, rect.x, rect.y, rect.w, rect.h, cx - r, cy - r, r * 2, r * 2);
          const vig = ctx.createRadialGradient(cx, cy, r * 0.25, cx, cy, r);
          vig.addColorStop(0, 'rgba(8, 10, 16, 0.08)');
          vig.addColorStop(0.75, 'rgba(8, 10, 16, 0.28)');
          vig.addColorStop(1, 'rgba(8, 10, 16, 0.65)');
          ctx.fillStyle = vig;
          ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        } else {
          const fallbackGrad = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
          fallbackGrad.addColorStop(0, 'rgba(217, 155, 45, 0.16)');
          fallbackGrad.addColorStop(0.75, 'rgba(180, 120, 30, 0.08)');
          fallbackGrad.addColorStop(1, 'rgba(180, 120, 30, 0)');
          ctx.fillStyle = fallbackGrad;
          ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        }
        ctx.restore();

        // Ornamental double golden bezel around PoE 1 Ascendancy portrait
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(229, 188, 114, 0.55)';
        ctx.lineWidth = Math.max(isOfficialFull ? 18 : 2.5, 2.2 * invZoom);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, r + (isOfficialFull ? 28 : 5), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(180, 134, 62, 0.28)';
        ctx.lineWidth = Math.max(isOfficialFull ? 10 : 1.5, 1.2 * invZoom);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 1. Draw visible edges (inactive first, active/highlighted second for crisp layering)
    const activeEdges: Array<{ edge: EdgeRecord; color: string; dashed: boolean }> = [];
    const inactiveAscEdges: EdgeRecord[] = [];

    ctx.beginPath();
    ctx.strokeStyle = '#252c40';
    ctx.lineWidth = baseLineWidth;

    for (const edge of edgeList) {
      if (
        edge.maxX < viewMinX ||
        edge.minX > viewMaxX ||
        edge.maxY < viewMinY ||
        edge.minY > viewMaxY
      ) {
        continue;
      }

      const aId = edge.a.id;
      const bId = edge.b.id;
      const bothShared = sharedSet.has(aId) && sharedSet.has(bId);
      const isSet1Edge =
        build.game === 'poe2' &&
        (set1Set.has(aId) || set1Set.has(bId)) &&
        (sharedSet.has(aId) || set1Set.has(aId)) &&
        (sharedSet.has(bId) || set1Set.has(bId));
      const isSet2Edge =
        build.game === 'poe2' &&
        (set2Set.has(aId) || set2Set.has(bId)) &&
        (sharedSet.has(aId) || set2Set.has(aId)) &&
        (sharedSet.has(bId) || set2Set.has(bId));
      const isPreviewEdge =
        (previewPathSet.has(aId) || previewPathSet.has(bId)) &&
        (previewPathSet.has(aId) || sharedSet.has(aId) || set1Set.has(aId) || set2Set.has(aId)) &&
        (previewPathSet.has(bId) || sharedSet.has(bId) || set1Set.has(bId) || set2Set.has(bId));

      if (bothShared) {
        const isAscEdge = Boolean(edge.a.ascendancyId && edge.b.ascendancyId);
        activeEdges.push({ edge, color: isAscEdge ? '#fbbf24' : '#e8bc72', dashed: false });
        continue;
      }
      if (isSet1Edge) {
        const active = build.activeWeaponSet !== 2;
        activeEdges.push({
          edge,
          color: active ? '#22d3ee' : 'rgba(34, 211, 238, 0.32)',
          dashed: !active,
        });
        continue;
      }
      if (isSet2Edge) {
        const active = build.activeWeaponSet === 2;
        activeEdges.push({
          edge,
          color: active ? '#e879f9' : 'rgba(232, 121, 249, 0.32)',
          dashed: !active,
        });
        continue;
      }
      if (isPreviewEdge) {
        activeEdges.push({ edge, color: '#fbbf24', dashed: true });
        continue;
      }
      if (edge.a.ascendancyId && edge.b.ascendancyId) {
        inactiveAscEdges.push(edge);
        continue;
      }

      if (edge.sameOrbitArc && edge.cx !== undefined && edge.cy !== undefined && edge.r !== undefined) {
        ctx.moveTo(edge.a.x, edge.a.y);
        ctx.arc(edge.cx, edge.cy, edge.r, edge.startAngle!, edge.endAngle!, edge.counterclockwise);
      } else {
        ctx.moveTo(edge.a.x, edge.a.y);
        ctx.lineTo(edge.b.x, edge.b.y);
      }
    }
    ctx.stroke();

    // Draw inactive Ascendancy edges in muted antique bronze so allocated gold paths stand out clearly
    if (inactiveAscEdges.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(128, 114, 88, 0.38)';
      ctx.lineWidth = Math.max(baseLineWidth * 1.0, 1.4 * invZoom);
      for (const edge of inactiveAscEdges) {
        if (edge.sameOrbitArc && edge.cx !== undefined && edge.cy !== undefined && edge.r !== undefined) {
          ctx.moveTo(edge.a.x, edge.a.y);
          ctx.arc(edge.cx, edge.cy, edge.r, edge.startAngle!, edge.endAngle!, edge.counterclockwise);
        } else {
          ctx.moveTo(edge.a.x, edge.a.y);
          ctx.lineTo(edge.b.x, edge.b.y);
        }
      }
      ctx.stroke();
    }

    // Draw highlighted / allocated edges on top
    for (const { edge, color, dashed } of activeEdges) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = activeLineWidth;
      ctx.setLineDash(dashed ? [14 * invZoom * 0.5, 10 * invZoom * 0.5] : []);
      if (edge.sameOrbitArc && edge.cx !== undefined && edge.cy !== undefined && edge.r !== undefined) {
        ctx.arc(edge.cx, edge.cy, edge.r, edge.startAngle!, edge.endAngle!, edge.counterclockwise);
      } else {
        ctx.moveTo(edge.a.x, edge.a.y);
        ctx.lineTo(edge.b.x, edge.b.y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 2. Draw visible nodes with LOD
    const showKeystoneLabels = isOfficialFull ? camera.zoom >= 0.055 : true;
    const showNotableLabels = isOfficialFull ? camera.zoom >= 0.14 : true;
    const showSmallLabels = isOfficialFull ? camera.zoom >= 0.34 : camera.zoom >= 0.95;

    for (const node of visibleNodes) {
      if (
        node.x < viewMinX ||
        node.x > viewMaxX ||
        node.y < viewMinY ||
        node.y > viewMaxY
      ) {
        continue;
      }

      const r = getNodeRadius(node.kind, isOfficialFull);
      const isShared = sharedSet.has(node.id);
      const isSet1 = build.game === 'poe2' && set1Set.has(node.id);
      const isSet2 = build.game === 'poe2' && set2Set.has(node.id);
      const isMasteryChosen = node.kind === 'mastery' && Boolean(build.tree.masteryEffects[node.id]);
      const isPreview = previewPathSet.has(node.id);
      const isHovered = hoveredNodeId === node.id;
      const isSearchHit = matchedSearchIds.has(node.id);
      const isJumpHighlighted = highlightedNodeId === node.id;

      // Persistent cyan highlight ring for Quick-Jump Drawer selections
      if (isJumpHighlighted) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 24 * (isOfficialFull ? 2.2 : 0.85), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34, 211, 238, 0.2)';
        ctx.fill();
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = Math.max(6, 3 * invZoom);
        ctx.stroke();
        ctx.beginPath();
        ctx.setLineDash([8 * invZoom * 0.5, 7 * invZoom * 0.5]);
        ctx.arc(node.x, node.y, r + 36 * (isOfficialFull ? 2.4 : 0.95), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(103, 232, 249, 0.75)';
        ctx.lineWidth = Math.max(4, 1.8 * invZoom);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Spec Diff Overlay Rings (+ emerald added, - rose dashed removed)
      if (diffAddedSet.has(node.id)) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 15 * (isOfficialFull ? 2 : 0.7), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(52, 211, 153, 0.22)';
        ctx.fill();
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = Math.max(5, 2.4 * invZoom);
        ctx.stroke();
      } else if (diffRemovedSet.has(node.id)) {
        ctx.beginPath();
        ctx.setLineDash([10 * invZoom * 0.5, 8 * invZoom * 0.5]);
        ctx.arc(node.x, node.y, r + 15 * (isOfficialFull ? 2 : 0.7), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251, 113, 133, 0.16)';
        ctx.fill();
        ctx.strokeStyle = '#fb7185';
        ctx.lineWidth = Math.max(5, 2.2 * invZoom);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Search glow ring
      if (isSearchHit) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 14 * (isOfficialFull ? 2 : 0.7), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(250, 204, 21, 0.25)';
        ctx.fill();
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = Math.max(4, 2.2 * invZoom);
        ctx.stroke();
      } else if (heatmapEnabled) {
        const heat = heatmapMap.get(node.id);
        if (heat) {
          const dpsIntensity = Math.min(1, heat.dpsDeltaPct / 12);
          const ehpIntensity = Math.min(1, heat.ehpDeltaPct / 12);
          const isDpsDominant = heat.dpsDeltaPct >= heat.ehpDeltaPct;
          const alpha = Math.max(0.22, Math.max(dpsIntensity, ehpIntensity) * 0.72);
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 18 * (isOfficialFull ? 2.2 : 0.8), 0, Math.PI * 2);
          ctx.fillStyle = isDpsDominant
            ? `rgba(249, 115, 22, ${alpha * 0.45})`
            : `rgba(56, 189, 248, ${alpha * 0.45})`;
          ctx.fill();
          ctx.strokeStyle = isDpsDominant
            ? `rgba(251, 146, 60, ${alpha})`
            : `rgba(56, 189, 248, ${alpha})`;
          ctx.lineWidth = Math.max(5, 2.5 * invZoom);
          ctx.stroke();
        }
      }

      // Node shape
      ctx.beginPath();
      if (node.kind === 'jewel') {
        // Hexagonal jewel socket
        for (let i = 0; i < 6; i++) {
          const ang = (Math.PI / 3) * i - Math.PI / 6;
          const px = node.x + r * Math.cos(ang);
          const py = node.y + r * Math.sin(ang);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      } else {
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      }

      if (isShared || isMasteryChosen) {
        if (node.ascendancyId) {
          // Bright outer golden halo so allocated Ascendancy nodes stand out vividly over artwork
          ctx.save();
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 14 * (isOfficialFull ? 1.8 : 0.6), 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(251, 191, 36, 0.22)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.72)';
          ctx.lineWidth = Math.max(4, 1.8 * invZoom);
          ctx.stroke();
          ctx.restore();
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        }
        ctx.fillStyle =
          node.kind === 'keystone'
            ? '#7c2d12'
            : node.kind === 'mastery'
              ? '#1e3a5f'
              : node.kind === 'notable'
                ? '#5c4119'
                : '#3e3018';
        ctx.strokeStyle = isMasteryChosen ? '#38bdf8' : node.ascendancyId ? '#fcd34d' : '#f3cc82';
        ctx.lineWidth = Math.max(isOfficialFull ? 10 : 2.5, (node.ascendancyId ? 2.8 : 2.2) * invZoom);
      } else if (isSet1) {
        const active = build.activeWeaponSet !== 2;
        ctx.fillStyle = active ? '#0e3a4c' : 'rgba(14, 58, 76, 0.4)';
        ctx.strokeStyle = active ? '#22d3ee' : 'rgba(34, 211, 238, 0.35)';
        ctx.lineWidth = Math.max(isOfficialFull ? 10 : 2.5, (active ? 2.4 : 1.5) * invZoom);
      } else if (isSet2) {
        const active = build.activeWeaponSet === 2;
        ctx.fillStyle = active ? '#4a124f' : 'rgba(74, 18, 79, 0.4)';
        ctx.strokeStyle = active ? '#e879f9' : 'rgba(232, 121, 249, 0.35)';
        ctx.lineWidth = Math.max(isOfficialFull ? 10 : 2.5, (active ? 2.4 : 1.5) * invZoom);
      } else if (isPreview) {
        ctx.fillStyle = '#332812';
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = Math.max(isOfficialFull ? 9 : 2.5, 2 * invZoom);
      } else {
        ctx.fillStyle =
          node.kind === 'keystone'
            ? '#22182b'
            : node.kind === 'mastery'
              ? '#12192b'
              : node.kind === 'jewel'
                ? '#0f2220'
                : node.kind === 'notable'
                  ? '#1a2033'
                  : '#111520';
        ctx.strokeStyle = isHovered
          ? '#f3cc82'
          : node.kind === 'keystone'
            ? '#a3773c'
            : node.kind === 'notable'
              ? '#5c6687'
              : node.kind === 'jewel'
                ? '#2f7a71'
                : node.kind === 'mastery'
                  ? '#385780'
                  : '#323a52';
        ctx.lineWidth = Math.max(isOfficialFull ? 6 : 1.8, (isHovered ? 2.5 : 1.4) * invZoom);
      }

      ctx.fill();
      ctx.stroke();

      // Inner emblem for Keystone / Notable / Mastery / Start
      if (node.kind === 'keystone') {
        const d = r * 0.45;
        ctx.beginPath();
        ctx.moveTo(node.x, node.y - d);
        ctx.lineTo(node.x + d, node.y);
        ctx.lineTo(node.x, node.y + d);
        ctx.lineTo(node.x - d, node.y);
        ctx.closePath();
        ctx.fillStyle = isShared ? '#fbbf24' : '#9c7134';
        ctx.fill();
      } else if (node.kind === 'mastery') {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = isMasteryChosen ? '#38bdf8' : '#3a5d8a';
        ctx.fill();
      } else if (node.kind === 'jewel' && build.tree.socketedJewels?.[node.id]) {
        const d = r * 0.55;
        ctx.beginPath();
        ctx.moveTo(node.x, node.y - d);
        ctx.lineTo(node.x + d, node.y);
        ctx.lineTo(node.x, node.y + d);
        ctx.lineTo(node.x - d, node.y);
        ctx.closePath();
        ctx.fillStyle = '#34d399';
        ctx.fill();
      } else if (node.kind === 'notable' || node.kind === 'start') {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 0.38, 0, Math.PI * 2);
        ctx.fillStyle = isShared ? '#f3cc82' : isSet1 ? '#22d3ee' : isSet2 ? '#e879f9' : '#4a5575';
        ctx.fill();
      }

      // LOD Text Labels
      const shouldLabel =
        isHovered ||
        isJumpHighlighted ||
        isSearchHit ||
        (node.kind === 'start' && (isShared || !isOfficialFull || camera.zoom >= 0.085)) ||
        (node.kind === 'keystone' && showKeystoneLabels) ||
        (node.kind === 'notable' && showNotableLabels) ||
        (node.kind === 'small' && showSmallLabels);

      if (shouldLabel) {
        const fontPx = Math.round(
          (node.kind === 'keystone' || node.kind === 'start' ? 12.5 : 11) * invZoom,
        );
        ctx.font = `${node.kind === 'keystone' || node.kind === 'start' ? '700' : '600'} ${fontPx}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle =
          isShared || isSet1 || isSet2 || isHovered || isSearchHit || isJumpHighlighted
            ? '#fef3c7'
            : '#9ca7c2';
        ctx.fillText(localizeText(node.name, locale), node.x, node.y + r + 4 * invZoom);
      }
    }

    // 3. Draw Visual Cluster Jewel Sub-Graphs around allocated outer jewel sockets
    for (const sg of clusterSubGraphs) {
      if (
        sg.cx + sg.ringRadius * 1.6 < viewMinX ||
        sg.cx - sg.ringRadius * 1.6 > viewMaxX ||
        sg.cy + sg.ringRadius * 1.6 < viewMinY ||
        sg.cy - sg.ringRadius * 1.6 > viewMaxY
      ) {
        continue;
      }

      // Translucent golden-amber cluster disc backdrop
      ctx.save();
      const cGrad = ctx.createRadialGradient(sg.cx, sg.cy, sg.ringRadius * 0.1, sg.cx, sg.cy, sg.ringRadius * 1.35);
      cGrad.addColorStop(0, 'rgba(245, 158, 11, 0.16)');
      cGrad.addColorStop(0.75, 'rgba(217, 119, 6, 0.08)');
      cGrad.addColorStop(1, 'rgba(217, 119, 6, 0)');
      ctx.beginPath();
      ctx.arc(sg.cx, sg.cy, sg.ringRadius * 1.35, 0, Math.PI * 2);
      ctx.fillStyle = cGrad;
      ctx.fill();

      // Golden connector from parent socket to entrance node + full ring loop
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = activeLineWidth;
      if (sg.nodes.length > 0) {
        ctx.beginPath();
        ctx.moveTo(sg.parentSocket.x, sg.parentSocket.y);
        ctx.lineTo(sg.nodes[0]!.x, sg.nodes[0]!.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(sg.cx, sg.cy, sg.ringRadius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw sub-graph nodes & bilingual notable labels
      for (const cn of sg.nodes) {
        const cr = getNodeRadius(cn.kind, isOfficialFull);
        ctx.beginPath();
        if (cn.kind === 'jewel') {
          for (let i = 0; i < 6; i++) {
            const ang = (Math.PI / 3) * i - Math.PI / 6;
            const px = cn.x + cr * Math.cos(ang);
            const py = cn.y + cr * Math.sin(ang);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fillStyle = '#0f2b26';
          ctx.strokeStyle = '#34d399';
        } else if (cn.kind === 'notable') {
          ctx.arc(cn.x, cn.y, cr, 0, Math.PI * 2);
          ctx.fillStyle = '#6b4214';
          ctx.strokeStyle = '#fbbf24';
        } else {
          ctx.arc(cn.x, cn.y, cr, 0, Math.PI * 2);
          ctx.fillStyle = '#3d2c15';
          ctx.strokeStyle = '#f3cc82';
        }
        ctx.lineWidth = Math.max(isOfficialFull ? 10 : 2.2, 2 * invZoom);
        ctx.fill();
        ctx.stroke();

        if (cn.kind === 'notable') {
          ctx.beginPath();
          ctx.arc(cn.x, cn.y, cr * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = '#fde68a';
          ctx.fill();
          if (showNotableLabels || camera.zoom >= 0.09) {
            const fontPx = Math.round(11 * invZoom);
            ctx.font = `700 ${fontPx}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#fde68a';
            const label =
              locale === 'zh-TW' && cn.nameZh
                ? toTraditionalZh(cn.nameZh)
                : locale === 'zh-CN' && cn.nameZh
                  ? cn.nameZh
                  : cn.name;
            ctx.fillText(label, cn.x, cn.y + cr + 4 * invZoom);
          }
        }
      }
      ctx.restore();
    }

    ctx.restore();
  }, [
    camera,
    visibleNodes,
    edgeList,
    sharedSet,
    set1Set,
    set2Set,
    previewPathSet,
    hoveredNodeId,
    matchedSearchIds,
    build.game,
    build.classId,
    build.ascendancyId,
    build.activeWeaponSet,
    build.tree.masteryEffects,
    build.tree.socketedJewels,
    locale,
    isOfficialFull,
    ascendancyCenter,
    artManifest,
    artTick,
    clusterSubGraphs,
    heatmapEnabled,
    heatmapMap,
    diffAddedSet,
    diffRemovedSet,
    highlightedNodeId,
  ]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setCamera((c) => ({ ...c }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // O(1) spatial hash hit-test
  const hitTestNode = (sx: number, sy: number): number | null => {
    const world = screenToWorld(sx, sy);
    const gx = Math.floor(world.x / SPATIAL_CELL_SIZE);
    const gy = Math.floor(world.y / SPATIAL_CELL_SIZE);

    let bestId: number | null = null;
    let bestDistSq = Infinity;
    const extraPad = 10 / Math.max(0.03, camera.zoom);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = spatialGrid.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const node of bucket) {
          const hitR = getNodeRadius(node.kind, isOfficialFull) + extraPad;
          const distX = world.x - node.x;
          const distY = world.y - node.y;
          const dSq = distX * distX + distY * distY;
          if (dSq <= hitR * hitR && dSq < bestDistSq) {
            bestDistSq = dSq;
            bestId = node.id;
          }
        }
      }
    }
    return bestId;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    cancelCameraAnimation();
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      camX: camera.x,
      camY: camera.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setMousePos({ x: sx, y: sy });

    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        dragRef.current.moved = true;
      }
      setCamera((c) => ({ ...c, x: dragRef.current.camX + dx, y: dragRef.current.camY + dy }));
      return;
    }

    const hit = hitTestNode(sx, sy);
    setHoveredNodeId(hit);
    if (hit === null && clusterSubGraphs.length > 0) {
      const world = screenToWorld(sx, sy);
      const pad = 10 / Math.max(0.03, camera.zoom);
      let found: typeof hoveredClusterNode = null;
      for (const sg of clusterSubGraphs) {
        for (const cn of sg.nodes) {
          const hitR = getNodeRadius(cn.kind, isOfficialFull) + pad;
          const dx = world.x - cn.x;
          const dy = world.y - cn.y;
          if (dx * dx + dy * dy <= hitR * hitR) {
            found = {
              name: cn.name,
              nameZh: cn.nameZh,
              kind: cn.kind,
              stats: cn.stats,
              statsZh: cn.statsZh,
            };
            break;
          }
        }
        if (found) break;
      }
      setHoveredClusterNode(found);
    } else if (hoveredClusterNode !== null) {
      setHoveredClusterNode(null);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const wasDrag = dragRef.current.moved;
    dragRef.current.active = false;
    if (!wasDrag) {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickedId = hitTestNode(e.clientX - rect.left, e.clientY - rect.top);
      if (clickedId !== null) {
        const clickedNode = tree.nodes[clickedId];
        if (clickedNode?.kind === 'mastery' && clickedNode.masteryEffects?.length) {
          setMasteryModalNodeId(clickedId);
        } else if (clickedNode?.kind === 'jewel' && sharedSet.has(clickedId)) {
          setJewelModalNodeId(clickedId);
          setJewelSearch('');
        } else {
          togglePassiveNode(clickedId);
        }
      }
    }
  };

  const touchRef = useRef<{
    mode: 'none' | 'pan' | 'pinch';
    moved: boolean;
    startX: number;
    startY: number;
    camX: number;
    camY: number;
    pinchDist: number;
    pinchZoom: number;
    pinchMidX: number;
    pinchMidY: number;
  }>({
    mode: 'none',
    moved: false,
    startX: 0,
    startY: 0,
    camX: 0,
    camY: 0,
    pinchDist: 0,
    pinchZoom: 0.08,
    pinchMidX: 0,
    pinchMidY: 0,
  });

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    cancelCameraAnimation();
    if (e.touches.length === 1) {
      const t0 = e.touches[0]!;
      touchRef.current = {
        ...touchRef.current,
        mode: 'pan',
        moved: false,
        startX: t0.clientX,
        startY: t0.clientY,
        camX: camera.x,
        camY: camera.y,
      };
    } else if (e.touches.length === 2) {
      const t0 = e.touches[0]!;
      const t1 = e.touches[1]!;
      const rect = e.currentTarget.getBoundingClientRect();
      touchRef.current = {
        mode: 'pinch',
        moved: true,
        startX: 0,
        startY: 0,
        camX: camera.x,
        camY: camera.y,
        pinchDist: Math.max(1, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY)),
        pinchZoom: camera.zoom,
        pinchMidX: (t0.clientX + t1.clientX) / 2 - rect.left - rect.width / 2,
        pinchMidY: (t0.clientY + t1.clientY) / 2 - rect.top - rect.height / 2,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (touchRef.current.mode === 'pan' && e.touches.length === 1) {
      const t0 = e.touches[0]!;
      const dx = t0.clientX - touchRef.current.startX;
      const dy = t0.clientY - touchRef.current.startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        touchRef.current.moved = true;
      }
      setCamera((c) => ({ ...c, x: touchRef.current.camX + dx, y: touchRef.current.camY + dy }));
    } else if (touchRef.current.mode === 'pinch' && e.touches.length === 2) {
      const t0 = e.touches[0]!;
      const t1 = e.touches[1]!;
      const dist = Math.max(1, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));
      const scale = dist / touchRef.current.pinchDist;
      const minZ = isOfficialFull ? 0.025 : 0.3;
      const maxZ = isOfficialFull ? 0.75 : 2.2;
      const nextZoom = Math.min(maxZ, Math.max(minZ, touchRef.current.pinchZoom * scale));
      const ratio = nextZoom / touchRef.current.pinchZoom;
      setCamera({
        zoom: nextZoom,
        x: touchRef.current.pinchMidX - (touchRef.current.pinchMidX - touchRef.current.camX) * ratio,
        y: touchRef.current.pinchMidY - (touchRef.current.pinchMidY - touchRef.current.camY) * ratio,
      });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (touchRef.current.mode === 'pan' && !touchRef.current.moved && e.changedTouches.length > 0) {
      const t0 = e.changedTouches[0]!;
      const rect = e.currentTarget.getBoundingClientRect();
      const tappedId = hitTestNode(t0.clientX - rect.left, t0.clientY - rect.top);
      if (tappedId !== null) {
        const tappedNode = tree.nodes[tappedId];
        if (tappedNode?.kind === 'mastery' && tappedNode.masteryEffects?.length) {
          setMasteryModalNodeId(tappedId);
        } else if (tappedNode?.kind === 'jewel' && sharedSet.has(tappedId)) {
          setJewelModalNodeId(tappedId);
          setJewelSearch('');
        } else {
          togglePassiveNode(tappedId);
        }
      }
    }
    if (e.touches.length === 0) {
      touchRef.current.mode = 'none';
    }
  };

  // Cursor-centered smooth zoom
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    cancelCameraAnimation();
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left - rect.width / 2;
    const sy = e.clientY - rect.top - rect.height / 2;

    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const minZoom = isOfficialFull ? 0.025 : 0.3;
    const maxZoom = isOfficialFull ? 0.75 : 2.2;

    setCamera((c) => {
      const nextZoom = Math.max(minZoom, Math.min(maxZoom, c.zoom * factor));
      const ratio = nextZoom / c.zoom;
      return {
        zoom: nextZoom,
        x: sx - (sx - c.x) * ratio,
        y: sy - (sy - c.y) * ratio,
      };
    });
  };

  const hoveredNode = hoveredNodeId !== null ? tree.nodes[hoveredNodeId] : null;
  const masteryModalNode = masteryModalNodeId !== null ? tree.nodes[masteryModalNodeId] : null;

  const getDisplayStats = (node: PassiveNode): string[] => {
    if (locale === 'zh-TW') {
      if (node.statsZhTw && node.statsZhTw.length > 0) {
        return node.statsZhTw.map((s, i) =>
          /[\u4e00-\u9fff]/.test(s) ? s : localizeStatLine(node.stats[i] ?? s, locale),
        );
      }
      if (node.statsZh && node.statsZh.length > 0) {
        return node.statsZh.map((s) =>
          /[\u4e00-\u9fff]/.test(s) ? toTraditionalZh(s) : localizeStatLine(s, locale),
        );
      }
    }
    if (locale === 'zh-CN' && node.statsZh && node.statsZh.length > 0) {
      return node.statsZh.map((s) => (/[\u4e00-\u9fff]/.test(s) ? s : localizeStatLine(s, locale)));
    }
    return node.stats.map((s) => localizeStatLine(s, locale));
  };

  return (
    <div ref={containerRef} className="relative flex-1 w-full h-full overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          dragRef.current.active = false;
          setHoveredNodeId(null);
        }}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="w-full h-full block touch-none cursor-grab active:cursor-grabbing"
      />

      {/* Mobile Compact Top Overlay (< md) */}
      <div className="flex md:hidden flex-col gap-1.5 absolute top-2 left-2 right-2 z-20 pointer-events-none">
        <div className="flex items-center gap-1.5 pointer-events-auto">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') jumpToSearchMatch(searchIdx + 1);
              }}
              placeholder={t(locale, 'tree.searchPlaceholder')}
              className="pob-input rounded-md pl-8 pr-8 py-1.5 text-xs w-full shadow-lg"
            />
            {searchQuery.trim() && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-amber-300 font-mono">
                {matchedSearchList.length}
              </span>
            )}
          </div>
          {matchedSearchList.length > 0 && (
            <button
              type="button"
              onClick={() => jumpToSearchMatch(searchIdx + 1)}
              className="p-1.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 cursor-pointer shrink-0"
              title="Jump to next match"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={fitAllocated}
            title={uiText(locale, '框选已点天赋', 'Fit Allocated')}
            className="flex items-center gap-1 px-2 py-1.5 rounded bg-cyan-500/15 border border-cyan-500/45 text-xs font-semibold text-cyan-200 cursor-pointer shrink-0 whitespace-nowrap"
          >
            <Scan className="w-3.5 h-3.5" />
            <span>{uiText(locale, '框选', 'Fit')}</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileToolsOpen((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1.5 rounded border text-xs font-semibold cursor-pointer shrink-0 whitespace-nowrap transition ${
              mobileToolsOpen
                ? 'bg-amber-500/25 border-amber-400/50 text-amber-200'
                : 'bg-[#141824]/92 border-[#2a3147] text-zinc-200'
            }`}
            aria-expanded={mobileToolsOpen}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>{uiText(locale, '工具', 'Tools')}</span>
          </button>
        </div>

        {mobileToolsOpen && (
          <div className="pointer-events-auto rounded-lg bg-[#0e121c]/95 border border-[#2a3147] p-2.5 shadow-2xl space-y-2 text-xs">
            {build.game === 'poe2' && (
              <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-[#20263a]">
                <span className="text-[11px] text-zinc-400 shrink-0">{t(locale, 'tree.paintMode')}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setTreePaintMode('shared')}
                    className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${
                      treePaintMode === 'shared'
                        ? 'bg-amber-500/25 text-amber-200 border border-amber-500/40'
                        : 'text-zinc-400 bg-[#141824] border border-transparent'
                    }`}
                  >
                    {t(locale, 'tree.paintShared')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTreePaintMode('set1')}
                    className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${
                      treePaintMode === 'set1'
                        ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40'
                        : 'text-zinc-400 bg-[#141824] border border-transparent'
                    }`}
                  >
                    Set I
                  </button>
                  <button
                    type="button"
                    onClick={() => setTreePaintMode('set2')}
                    className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${
                      treePaintMode === 'set2'
                        ? 'bg-fuchsia-500/25 text-fuchsia-200 border border-fuchsia-400/40'
                        : 'text-zinc-400 bg-[#141824] border border-transparent'
                    }`}
                  >
                    Set II
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-1.5">
              {ascendancyCenter && (
                <button
                  type="button"
                  onClick={() => {
                    focusAscendancy();
                    setMobileToolsOpen(false);
                  }}
                  className="flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-200 cursor-pointer whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span>{uiText(locale, `升华 ${calc.ascendancyPoints ?? 0}/8`, `Asc ${calc.ascendancyPoints ?? 0}/8`)}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  centerOnBuild();
                  setMobileToolsOpen(false);
                }}
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-[#141824] border border-[#2a3147] text-zinc-200 cursor-pointer whitespace-nowrap"
              >
                <Crosshair className="w-3.5 h-3.5 shrink-0" />
                <span>{uiText(locale, '定位BD', 'Focus')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  fitWholeTree();
                  setMobileToolsOpen(false);
                }}
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-[#141824] border border-[#2a3147] text-zinc-200 cursor-pointer whitespace-nowrap"
              >
                <Maximize2 className="w-3.5 h-3.5 shrink-0" />
                <span>{uiText(locale, '全景', 'Fit All')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setHeatmapEnabled((v) => {
                    const next = !v;
                    if (next) {
                      setJumpDrawerOpen(false);
                      setAllocatedDrawerOpen(false);
                      setPowerDrawerOpen(true);
                    }
                    return next;
                  });
                  setMobileToolsOpen(false);
                }}
                className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded border cursor-pointer whitespace-nowrap ${
                  heatmapEnabled
                    ? 'bg-orange-500/25 border-orange-400/60 text-orange-200'
                    : 'bg-[#141824] border-[#2a3147] text-zinc-200'
                }`}
              >
                <Flame className="w-3.5 h-3.5 shrink-0" />
                <span>{uiText(locale, '热力图', 'Power')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setJumpDrawerOpen((open) => {
                    const next = !open;
                    if (next) {
                      setPowerDrawerOpen(false);
                      setAllocatedDrawerOpen(false);
                    }
                    return next;
                  });
                  setMobileToolsOpen(false);
                }}
                className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded border cursor-pointer whitespace-nowrap ${
                  jumpDrawerOpen
                    ? 'bg-cyan-500/25 border-cyan-400/60 text-cyan-200'
                    : 'bg-[#141824] border-[#2a3147] text-zinc-200'
                }`}
              >
                <Gem className="w-3.5 h-3.5 shrink-0" />
                <span>{uiText(locale, '基石/槽', 'Keystones')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setAllocatedDrawerOpen((open) => {
                    const next = !open;
                    if (next) {
                      setPowerDrawerOpen(false);
                      setJumpDrawerOpen(false);
                    }
                    return next;
                  });
                  setMobileToolsOpen(false);
                }}
                className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded border cursor-pointer whitespace-nowrap ${
                  allocatedDrawerOpen
                    ? 'bg-emerald-500/25 border-emerald-400/60 text-emerald-200'
                    : 'bg-[#141824] border-[#2a3147] text-zinc-200'
                }`}
              >
                <ListTree className="w-3.5 h-3.5 shrink-0" />
                <span>{uiText(locale, '已点总览', 'Allocated')}</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setCamera((c) => ({ ...c, zoom: Math.min(isOfficialFull ? 0.75 : 2.2, c.zoom * 1.25) }))
                }
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-[#141824] border border-[#2a3147] text-zinc-200 cursor-pointer whitespace-nowrap"
              >
                <ZoomIn className="w-3.5 h-3.5 shrink-0" />
                <span>{uiText(locale, '放大', 'Zoom +')}</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setCamera((c) => ({ ...c, zoom: Math.max(isOfficialFull ? 0.025 : 0.3, c.zoom * 0.8) }))
                }
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-[#141824] border border-[#2a3147] text-zinc-200 cursor-pointer whitespace-nowrap"
              >
                <ZoomOut className="w-3.5 h-3.5 shrink-0" />
                <span>{uiText(locale, '缩小', 'Zoom -')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  exportTreePng();
                  setMobileToolsOpen(false);
                }}
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-[#141824] border border-sky-500/35 text-sky-300 cursor-pointer whitespace-nowrap"
              >
                <Camera className="w-3.5 h-3.5 shrink-0" />
                <span>{uiText(locale, '导出PNG', 'PNG')}</span>
              </button>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-[#20263a]">
              <span className="text-[10px] font-mono text-zinc-500">
                {dataLoading
                  ? uiText(locale, '加载官方天赋树中...', 'Loading official tree...')
                  : `v${tree.version} · ${visibleNodes.length.toLocaleString()} nodes`}
              </span>
              <button
                type="button"
                onClick={() => {
                  resetPassiveTree();
                  setMobileToolsOpen(false);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#141824] border border-rose-500/30 text-[11px] text-rose-300 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                {t(locale, 'tree.resetTree')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Desktop Top Overlay Controls (md+) */}
      <div className="hidden md:flex absolute top-3 left-3 right-3 flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Bilingual Search with Jump-to-Match */}
        <div className="flex items-center gap-1.5 pointer-events-auto">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') jumpToSearchMatch(searchIdx + 1);
              }}
              placeholder={t(locale, 'tree.searchPlaceholder')}
              className="pob-input rounded-md pl-8 pr-12 py-1.5 text-xs w-64 shadow-lg"
            />
            {searchQuery.trim() && (
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-amber-300 font-mono">
                {matchedSearchList.length}
              </span>
            )}
          </div>
          {matchedSearchList.length > 0 && (
            <button
              type="button"
              onClick={() => jumpToSearchMatch(searchIdx + 1)}
              className="flex items-center gap-0.5 px-2 py-1.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs hover:bg-amber-500/30 cursor-pointer"
              title="Jump to next match"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          <span className="hidden sm:inline-block rounded bg-[#111521]/90 border border-[#252c40] px-2 py-1 text-[10px] font-mono text-zinc-400 whitespace-nowrap">
            {dataLoading ? (
              <span className="inline-flex items-center gap-1 text-amber-300">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading official tree...
              </span>
            ) : (
              <span>
                v{tree.version} · {visibleNodes.length.toLocaleString()} nodes
              </span>
            )}
          </span>
        </div>

        {/* PoE 2 Weapon Set Passive Paint Mode */}
        {build.game === 'poe2' && (
          <div className="pointer-events-auto flex items-center gap-1 rounded-md bg-[#11141e]/95 border border-[#2a3147] p-1 shadow-lg text-xs">
            <span className="text-[11px] text-zinc-400 px-1.5">{t(locale, 'tree.paintMode')}:</span>
            <button
              type="button"
              onClick={() => setTreePaintMode('shared')}
              className={`px-2 py-0.5 rounded cursor-pointer ${
                treePaintMode === 'shared'
                  ? 'bg-amber-500/25 text-amber-200 border border-amber-500/40'
                  : 'text-zinc-400'
              }`}
            >
              {t(locale, 'tree.paintShared')}
            </button>
            <button
              type="button"
              onClick={() => setTreePaintMode('set1')}
              className={`px-2 py-0.5 rounded cursor-pointer ${
                treePaintMode === 'set1'
                  ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40'
                  : 'text-zinc-400'
              }`}
            >
              {t(locale, 'tree.paintSet1')}
            </button>
            <button
              type="button"
              onClick={() => setTreePaintMode('set2')}
              className={`px-2 py-0.5 rounded cursor-pointer ${
                treePaintMode === 'set2'
                  ? 'bg-fuchsia-500/25 text-fuchsia-200 border border-fuchsia-400/40'
                  : 'text-zinc-400'
              }`}
            >
              {t(locale, 'tree.paintSet2')}
            </button>
          </div>
        )}

        {/* Zoom & Framing Controls */}
        <div className="pointer-events-auto flex items-center gap-1.5 max-w-full overflow-x-auto">
          <button
            type="button"
            onClick={() =>
              setCamera((c) => ({ ...c, zoom: Math.min(isOfficialFull ? 0.75 : 2.2, c.zoom * 1.25) }))
            }
            title={t(locale, 'tree.zoomIn')}
            className="p-1.5 rounded bg-[#141824]/90 border border-[#2a3147] text-zinc-300 hover:text-amber-200 cursor-pointer shrink-0"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() =>
              setCamera((c) => ({ ...c, zoom: Math.max(isOfficialFull ? 0.025 : 0.3, c.zoom * 0.8) }))
            }
            title={t(locale, 'tree.zoomOut')}
            className="p-1.5 rounded bg-[#141824]/90 border border-[#2a3147] text-zinc-300 hover:text-amber-200 cursor-pointer shrink-0"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={centerOnBuild}
            title="Center on Build"
            className="flex items-center gap-1 px-2 py-1.5 rounded bg-[#141824]/90 border border-[#2a3147] text-xs text-zinc-300 hover:text-amber-200 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Crosshair className="w-3.5 h-3.5" />
            {uiText(locale, '定位BD', 'Focus')}
          </button>
          {ascendancyCenter && (
            <button
              type="button"
              onClick={focusAscendancy}
              title={build.ascendancyId}
              className="flex items-center gap-1 px-2 py-1.5 rounded bg-amber-500/15 border border-amber-500/40 text-xs text-amber-200 hover:bg-amber-500/25 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {uiText(locale, `升华 (${calc.ascendancyPoints ?? 0}/8)`, `Asc (${calc.ascendancyPoints ?? 0}/8)`)}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if ((jumpDrawerOpen || allocatedDrawerOpen) && heatmapEnabled) {
                setJumpDrawerOpen(false);
                setAllocatedDrawerOpen(false);
                setPowerDrawerOpen(true);
                return;
              }
              setHeatmapEnabled((v) => {
                const next = !v;
                if (next) {
                  setJumpDrawerOpen(false);
                  setAllocatedDrawerOpen(false);
                }
                return next;
              });
            }}
            title={
              uiText(locale, '后台 Web Worker 计算高收益大点热力图（橙=DPS / 蓝=EHP）', 'Background Web Worker Node Power Heatmap (Orange=DPS / Blue=EHP)')
            }
            className={`flex items-center gap-1 px-2 py-1.5 rounded border text-xs cursor-pointer transition whitespace-nowrap shrink-0 ${
              heatmapEnabled
                ? 'bg-orange-500/25 border-orange-400/60 text-orange-200'
                : 'bg-[#141824]/90 border-[#2a3147] text-zinc-300 hover:text-orange-200'
            }`}
          >
            {heatmapLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Flame className="w-3.5 h-3.5" />
            )}
            {uiText(locale, '热力图', 'Power')}
          </button>
          <button
            type="button"
            onClick={() => {
              setJumpDrawerOpen((open) => {
                const next = !open;
                if (next) {
                  setPowerDrawerOpen(false);
                  setAllocatedDrawerOpen(false);
                }
                return next;
              });
            }}
            title={
              uiText(locale, '快速跳转基石、珠宝插槽与已点大点', 'Quick-jump to Keystones, Jewel Sockets & allocated Notables')
            }
            className={`flex items-center gap-1 px-2 py-1.5 rounded border text-xs cursor-pointer transition whitespace-nowrap shrink-0 ${
              jumpDrawerOpen
                ? 'bg-cyan-500/25 border-cyan-400/60 text-cyan-200'
                : 'bg-[#141824]/90 border-[#2a3147] text-zinc-300 hover:text-cyan-200'
            }`}
          >
            <Gem className="w-3.5 h-3.5" />
            {uiText(locale, '基石/插槽', 'Keystones')}
          </button>
          <button
            type="button"
            onClick={() => {
              setAllocatedDrawerOpen((open) => {
                const next = !open;
                if (next) {
                  setPowerDrawerOpen(false);
                  setJumpDrawerOpen(false);
                }
                return next;
              });
            }}
            title={
              uiText(locale, '查看已点天赋与聚合词缀总览', 'Allocated passives and aggregated modifiers overview')
            }
            className={`flex items-center gap-1 px-2 py-1.5 rounded border text-xs cursor-pointer transition whitespace-nowrap shrink-0 ${
              allocatedDrawerOpen
                ? 'bg-emerald-500/25 border-emerald-400/60 text-emerald-200'
                : 'bg-[#141824]/90 border-[#2a3147] text-zinc-300 hover:text-emerald-200'
            }`}
          >
            <ListTree className="w-3.5 h-3.5" />
            {uiText(locale, '已点总览', 'Allocated')}
          </button>
          <button
            type="button"
            onClick={fitAllocated}
            title={
              uiText(locale, '自动缩放并框选当前已点天赋（含 PoE 2 武器组）', 'Auto-center and zoom to frame all allocated passives (incl. PoE 2 weapon sets)')
            }
            className="flex items-center gap-1 px-2 py-1.5 rounded bg-cyan-500/15 border border-cyan-500/45 text-xs text-cyan-200 hover:bg-cyan-500/25 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Scan className="w-3.5 h-3.5" />
            {uiText(locale, '框选已点', 'Fit Allocated')}
          </button>
          <button
            type="button"
            onClick={fitWholeTree}
            title={t(locale, 'tree.resetView')}
            className="flex items-center gap-1 px-2 py-1.5 rounded bg-[#141824]/90 border border-[#2a3147] text-xs text-zinc-300 hover:text-amber-200 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            {uiText(locale, '全景', 'Fit All')}
          </button>
          <button
            type="button"
            onClick={exportTreePng}
            title={uiText(locale, '将当前天赋树画布导出为高清 PNG 图片', 'Export current Passive Tree canvas as PNG')}
            className="flex items-center gap-1 px-2 py-1.5 rounded bg-[#141824]/90 border border-sky-500/35 text-xs text-sky-300 hover:bg-sky-950/40 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Camera className="w-3.5 h-3.5" />
            {uiText(locale, '导出树图', 'PNG')}
          </button>
          <button
            type="button"
            onClick={resetPassiveTree}
            className="flex items-center gap-1 px-2 py-1.5 rounded bg-[#141824]/90 border border-rose-500/30 text-xs text-rose-300 hover:bg-rose-950/40 cursor-pointer whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t(locale, 'tree.resetTree')}
          </button>
        </div>
      </div>

      {/* Bottom Hint Bar */}
      <div className="hidden md:block absolute bottom-3 left-3 pointer-events-none rounded bg-[#0d1018]/85 border border-[#252b3d] px-3 py-1 text-[11px] text-zinc-400">
        {t(locale, 'tree.hint')}
      </div>

      {/* Bottom-Right Multi-Spec Tree Switcher & Visual Diff Bar */}
      <div className="absolute bottom-2 left-2 right-2 md:left-auto md:bottom-3 md:right-3 z-10 pointer-events-auto flex items-center gap-1.5 rounded-md bg-[#0e121c]/92 border border-[#2a3147] px-2 md:px-2.5 py-1.5 shadow-xl text-xs">
        <span className="hidden sm:inline text-[10px] uppercase tracking-wider text-zinc-400 font-semibold shrink-0">
          {uiText(locale, '天赋方案', 'Spec')}
        </span>
        <select
          value={activeTreeSpecIdx}
          onChange={(e) => switchTreeSpec(Number(e.target.value))}
          className="pob-input rounded px-1.5 md:px-2 py-0.5 text-xs min-w-0 flex-1 md:flex-none md:max-w-[140px]"
          aria-label={uiText(locale, '天赋方案', 'Tree Spec')}
        >
          {treeSpecs.map((spec, idx) => (
            <option key={`${spec.title}_${idx}`} value={idx}>
              {spec.title} ({Math.max(0, spec.allocatedNodeIds.length - 1)}p)
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() =>
            addTreeSpec(
              uiText(locale, `方案 ${treeSpecs.length + 1}`, `Spec ${treeSpecs.length + 1}`),
              true,
            )
          }
          title={uiText(locale, '复制当前天赋树为新方案', 'Clone active tree into a new Spec')}
          className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#161c2b] hover:bg-[#1e263a] border border-[#2e364f] text-[11px] text-amber-200 cursor-pointer shrink-0"
        >
          <Copy className="w-3 h-3" />
          {uiText(locale, '新方案', 'Clone')}
        </button>
        {treeSpecs.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => {
                deleteTreeSpec(activeTreeSpecIdx);
                setCompareSpecIdx(null);
              }}
              title={uiText(locale, '删除当前天赋方案', 'Delete active Tree Spec')}
              className="hidden sm:inline-block p-1 rounded text-zinc-400 hover:text-rose-400 border border-[#2e364f] cursor-pointer shrink-0"
            >
              <Trash2 className="w-3 h-3" />
            </button>
            <span className="h-4 w-px bg-[#2a3147] mx-0.5 shrink-0" />
            <GitCompare className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <select
              value={compareSpecIdx === null ? '' : String(compareSpecIdx)}
              onChange={(e) =>
                setCompareSpecIdx(e.target.value === '' ? null : Number(e.target.value))
              }
              className="pob-input rounded px-1.5 md:px-2 py-0.5 text-xs min-w-0 flex-1 md:flex-none max-w-[130px]"
              title={uiText(locale, '叠加高亮对比另一套天赋方案的增减节点', 'Highlight node diff against another Spec')}
            >
              <option value="">{uiText(locale, '对比差异: 关闭', 'Diff: Off')}</option>
              {treeSpecs.map((spec, idx) =>
                idx === activeTreeSpecIdx ? null : (
                  <option key={`cmp_${idx}`} value={idx}>
                    vs {spec.title}
                  </option>
                ),
              )}
            </select>
            {compareSpecIdx !== null && compareSpecIdx !== activeTreeSpecIdx && (
              <span className="font-mono text-[11px] flex items-center gap-1 pl-0.5 shrink-0">
                <span className="text-emerald-400 font-semibold">+{diffAddedSet.size}</span>
                <span className="text-rose-400 font-semibold">-{diffRemovedSet.size}</span>
              </span>
            )}
          </>
        )}
      </div>

      {/* Floating Top Power Nodes Efficiency Drawer (when Heatmap is active) */}
      {heatmapEnabled && !jumpDrawerOpen && !allocatedDrawerOpen && (
        <div className="absolute top-14 md:top-16 right-2 md:right-3 z-20 w-[calc(100%-1rem)] sm:w-72 max-h-[calc(100%-5.5rem)] flex flex-col rounded-lg bg-[#0e121c]/95 border border-orange-500/40 shadow-2xl overflow-hidden pointer-events-auto">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#252b3d] bg-[#131826]/90">
            <div className="flex items-center gap-1.5 text-xs font-bold text-orange-300">
              <Flame className="w-3.5 h-3.5" />
              {uiText(locale, '高收益天赋大点排行', 'Top Power Notables')}
              {heatmapLoading && <Loader2 className="w-3 h-3 animate-spin text-amber-300" />}
            </div>
            <button
              type="button"
              onClick={() => {
                setPowerDrawerOpen((v) => {
                  const next = !v;
                  if (next) {
                    setJumpDrawerOpen(false);
                    setAllocatedDrawerOpen(false);
                  }
                  return next;
                });
              }}
              className="text-[10px] text-zinc-400 hover:text-zinc-200 cursor-pointer px-1"
            >
              {powerDrawerOpen
                ? uiText(locale, '收起', 'Hide')
                : uiText(locale, '展开', 'Show')}
            </button>
          </div>
          {powerDrawerOpen && (
            <>
              <div className="grid grid-cols-4 gap-1 p-1.5 bg-[#0a0d14] border-b border-[#1e2436] text-[10px]">
                {(
                  [
                    ['dpsPerPoint', uiText(locale, 'DPS/点', 'DPS/Pt')],
                    ['dps', uiText(locale, '总 DPS', 'Total DPS')],
                    ['ehpPerPoint', uiText(locale, 'EHP/点', 'EHP/Pt')],
                    ['ehp', uiText(locale, '总 EHP', 'Total EHP')],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setHeatmapSort(mode)}
                    className={`py-1 rounded font-semibold cursor-pointer transition ${
                      heatmapSort === mode
                        ? mode.startsWith('dps')
                          ? 'bg-orange-500/25 text-orange-200 border border-orange-400/50'
                          : 'bg-sky-500/25 text-sky-200 border border-sky-400/50'
                        : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="overflow-y-auto divide-y divide-[#1b2030]">
                {heatmapLoading && topPowerNodes.length === 0 ? (
                  <div className="p-4 text-center text-[11px] text-zinc-400">
                    {uiText(locale, '后台 Web Worker 正在模拟 300 个周边大点...', 'Web Worker simulating 300 nearby notables...')}
                  </div>
                ) : topPowerNodes.length === 0 ? (
                  <div className="p-4 text-center text-[11px] text-zinc-500">
                    {uiText(locale, '未发现正收益大点', 'No positive power notables found.')}
                  </div>
                ) : (
                  topPowerNodes.map(({ item, node }, idx) => {
                    const isDpsMode = heatmapSort === 'dps' || heatmapSort === 'dpsPerPoint';
                    const primaryPct = isDpsMode ? item.dpsDeltaPct : item.ehpDeltaPct;
                    const perPt = isDpsMode ? item.dpsPerPoint : item.ehpPerPoint;
                    return (
                      <div
                        key={node.id}
                        className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 hover:bg-[#161c2c] transition"
                      >
                        <button
                          type="button"
                          onClick={() => jumpToNodeId(node.id)}
                          className="min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono text-zinc-500 w-4 shrink-0">
                              #{idx + 1}
                            </span>
                            <span className="text-xs font-semibold text-zinc-100 truncate">
                              {localizeText(node.name, locale)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 pl-5 mt-0.5 text-[10px] font-mono">
                            <span className={isDpsMode ? 'text-orange-300 font-semibold' : 'text-sky-300 font-semibold'}>
                              +{primaryPct.toFixed(1)}% {isDpsMode ? 'DPS' : 'EHP'}
                            </span>
                            <span className="text-zinc-400">
                              {item.pathCost} {uiText(locale, '点', 'pts')}
                            </span>
                            <span className="text-emerald-300">
                              (+{perPt.toFixed(1)}%/pt)
                            </span>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => togglePassiveNode(node.id)}
                          title={
                            uiText(locale, `一键沿最短路径分配 (${item.pathCost} 点)`, `Allocate shortest path (${item.pathCost} pts)`)
                          }
                          className="p-1 rounded bg-amber-500/15 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 shrink-0 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Floating Keystone / Jewel Socket / Allocated Notable Quick-Jump Drawer */}
      {jumpDrawerOpen && (
        <div className="absolute top-14 md:top-16 right-2 md:right-3 z-20 w-[calc(100%-1rem)] sm:w-80 max-h-[calc(100%-5.5rem)] flex flex-col rounded-lg bg-[#0e121c]/95 border border-cyan-500/40 shadow-2xl overflow-hidden pointer-events-auto">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#252b3d] bg-[#131826]/90">
            <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-300">
              <Gem className="w-3.5 h-3.5" />
              {uiText(locale, '基石 / 珠宝槽 快速跳转', 'Keystone & Socket Jump')}
              <span className="rounded bg-cyan-500/15 border border-cyan-500/30 px-1 text-[10px] font-mono text-cyan-200">
                {jumpDrawerNodes.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setJumpDrawerOpen(false)}
              className="text-zinc-400 hover:text-zinc-200 cursor-pointer p-0.5"
              title={uiText(locale, '关闭', 'Close')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-1.5 p-1.5 bg-[#0a0d14] border-b border-[#1e2436]">
            <div className="grid grid-cols-3 gap-1 text-[10px]">
              {(
                [
                  ['keystone', uiText(locale, '基石', 'Keystones')],
                  ['jewel', uiText(locale, '珠宝槽', 'Jewel Sockets')],
                  ['allocated', uiText(locale, '已点大点', 'Allocated Notables')],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setJumpFilter(mode)}
                  className={`py-1 px-1 rounded font-semibold cursor-pointer transition truncate ${
                    jumpFilter === mode
                      ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/50'
                      : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="w-3 h-3 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={jumpQuery}
                onChange={(e) => setJumpQuery(e.target.value)}
                placeholder={
                  uiText(locale, '搜索名称或词缀…', 'Search name or stats…')
                }
                className="pob-input rounded pl-7 pr-7 py-1 text-[11px] w-full"
              />
              {jumpQuery && (
                <button
                  type="button"
                  onClick={() => setJumpQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          <div className="overflow-y-auto divide-y divide-[#1b2030]">
            {jumpDrawerNodes.length === 0 ? (
              <div className="p-4 text-center text-[11px] text-zinc-500">
                {uiText(locale, '没有匹配的节点', 'No matching nodes.')}
              </div>
            ) : (
              jumpDrawerNodes.map((node) => {
                const allocated = allocatedTreeSet.has(node.id);
                const isHighlighted = highlightedNodeId === node.id;
                const rawFirstStat =
                  locale === 'zh-TW' && node.statsZhTw && node.statsZhTw.length > 0
                    ? node.statsZhTw[0]!
                    : locale === 'zh-TW' && node.statsZh && node.statsZh.length > 0
                      ? toTraditionalZh(node.statsZh[0]!)
                      : locale === 'zh-CN' && node.statsZh && node.statsZh.length > 0
                        ? node.statsZh[0]!
                        : node.stats[0];
                const firstStat = rawFirstStat
                  ? /[\u4e00-\u9fff]/.test(rawFirstStat) && isChineseLocale(locale)
                    ? rawFirstStat
                    : localizeStatLine(rawFirstStat, locale)
                  : uiText(locale, '未提供词缀', 'No stat text');
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => panToNode(node.id)}
                    className={`w-full text-left px-2.5 py-1.5 transition cursor-pointer ${
                      isHighlighted ? 'bg-cyan-500/15' : 'hover:bg-[#161c2c]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          allocated
                            ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
                            : 'bg-zinc-600'
                        }`}
                        title={
                          allocated
                            ? uiText(locale, '已点', 'Allocated')
                            : uiText(locale, '未点', 'Unallocated')
                        }
                      />
                      <span className="text-xs font-semibold text-zinc-100 truncate">
                        {localizeText(node.name, locale)}
                      </span>
                      {node.kind === 'jewel' && build.tree.socketedJewels?.[node.id] && (
                        <span className="text-[9px] px-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 shrink-0">
                          {uiText(locale, '已插', 'Socketed')}
                        </span>
                      )}
                    </div>
                    <div className="pl-3 mt-0.5 text-[10px] text-zinc-400 truncate font-mono">
                      {firstStat}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Floating Allocated Passives Summary Drawer */}
      {allocatedDrawerOpen && (
        <div className="absolute top-14 md:top-16 right-2 md:right-3 z-20 w-[calc(100%-1rem)] sm:w-80 max-h-[calc(100%-5.5rem)] flex flex-col rounded-lg bg-[#0e121c]/95 border border-emerald-500/40 shadow-2xl overflow-hidden pointer-events-auto">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#252b3d] bg-[#131826]/90">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
              <ListTree className="w-3.5 h-3.5" />
              {uiText(locale, '已点天赋总览', 'Allocated Passives')}
              <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-1 text-[10px] font-mono text-emerald-200">
                {allocatedSummary.allocatedNodes.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAllocatedDrawerOpen(false)}
              className="text-zinc-400 hover:text-zinc-200 cursor-pointer p-0.5"
              title={uiText(locale, '关闭', 'Close')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Summary counters */}
          <div className="grid grid-cols-3 gap-1 p-1.5 bg-[#0a0d14] border-b border-[#1e2436] text-center">
            {(
              [
                [uiText(locale, '基石', 'Keystones'), allocatedSummary.keystones.length, 'text-orange-300'],
                [uiText(locale, '升华大点', 'Asc Notables'), allocatedSummary.ascendancyNotables.length, 'text-amber-300'],
                [uiText(locale, '大点', 'Notables'), allocatedSummary.notables.length, 'text-sky-300'],
                [uiText(locale, '珠宝槽', 'Jewel Sockets'), allocatedSummary.jewelSockets.length, 'text-emerald-300'],
                [uiText(locale, '专精', 'Masteries'), allocatedSummary.masteries.length, 'text-violet-300'],
                [uiText(locale, '小点', 'Small Passives'), allocatedSummary.smallPassives.length, 'text-zinc-300'],
              ] as const
            ).map(([label, count, tone]) => (
              <div key={label} className="rounded bg-[#10141f] border border-[#1f2638] px-1 py-1">
                <div className={`font-mono font-bold text-xs ${tone}`}>{count}</div>
                <div className="text-[9px] text-zinc-500 leading-tight truncate">{label}</div>
              </div>
            ))}
          </div>

          <div className="overflow-y-auto divide-y divide-[#1b2030]">
            {(
              [
                [uiText(locale, '基石', 'Keystones'), allocatedSummary.keystones, 'text-orange-300'],
                [uiText(locale, '升华大点', 'Ascendancy Notables'), allocatedSummary.ascendancyNotables, 'text-amber-300'],
                [uiText(locale, '大点', 'Notables'), allocatedSummary.notables, 'text-sky-300'],
                [uiText(locale, '已点专精', 'Allocated Masteries'), allocatedSummary.masteries, 'text-violet-300'],
              ] as const
            ).map(([label, nodes, tone]) => (
              <div key={label} className="px-2 py-1.5 space-y-1">
                <div className={`text-[10px] font-semibold uppercase tracking-wider ${tone}`}>
                  {label} <span className="text-zinc-500 font-mono">({nodes.length})</span>
                </div>
                {nodes.length === 0 ? (
                  <div className="text-[10px] text-zinc-600 pl-1">
                    {uiText(locale, '无', 'None')}
                  </div>
                ) : (
                  nodes.map((node) => {
                    const isHighlighted = highlightedNodeId === node.id;
                    const masteryLine =
                      node.kind === 'mastery' ? build.tree.masteryEffects[node.id] : undefined;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => panToNode(node.id)}
                        className={`w-full text-left px-1.5 py-1 rounded transition cursor-pointer ${
                          isHighlighted ? 'bg-emerald-500/15' : 'hover:bg-[#161c2c]'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                          <span className="text-xs font-semibold text-zinc-100 truncate">
                            {localizeText(node.name, locale)}
                          </span>
                        </div>
                        {masteryLine && (
                          <div className="pl-3 mt-0.5 text-[10px] text-violet-200/80 truncate font-mono">
                            {localizeStatLine(masteryLine, locale)}
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            ))}

            {/* Aggregated Tree Modifiers */}
            <div className="px-2 py-1.5 space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                {uiText(locale, '天赋词缀汇总', 'Aggregated Tree Modifiers')}{' '}
                <span className="text-zinc-500 font-mono">({allocatedSummary.modifiers.length})</span>
              </div>
              {allocatedSummary.modifiers.length === 0 ? (
                <div className="text-[10px] text-zinc-600 pl-1">
                  {uiText(locale, '无', 'None')}
                </div>
              ) : (
                <div className="space-y-0.5 max-h-56 overflow-y-auto pr-0.5">
                  {allocatedSummary.modifiers.map((modifier) => (
                    <div
                      key={modifier.line}
                      className="flex items-start justify-between gap-1.5 rounded bg-[#0c0e15] border border-[#1f2436] px-1.5 py-0.5"
                    >
                      <span className="text-[10px] text-zinc-300 leading-snug">{modifier.line}</span>
                      {modifier.count > 1 && (
                        <span className="shrink-0 rounded bg-emerald-500/15 border border-emerald-500/35 px-1 text-[9px] font-mono font-semibold text-emerald-300">
                          ×{modifier.count}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="p-1.5 border-t border-[#1e2436] bg-[#0a0d14]">
            <button
              type="button"
              onClick={() => void copyAllocatedSummary()}
              className={`w-full inline-flex items-center justify-center gap-1.5 rounded border px-2 py-1 text-[11px] font-semibold cursor-pointer transition ${
                allocatedCopied
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                  : 'bg-[#161c2b] hover:bg-[#1e263a] border-[#2e364f] text-emerald-200'
              }`}
            >
              {allocatedCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {allocatedCopied
                ? uiText(locale, '已复制天赋清单', 'Tree summary copied')
                : uiText(locale, '复制天赋清单', 'Copy Tree Summary')}
            </button>
          </div>
        </div>
      )}

      {/* Jewel Socket Picker Modal */}
      {jewelModalNodeId !== null && (
        <div className="absolute inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
          <div className="pob-panel rounded-lg w-full max-w-xl p-4 space-y-3 shadow-2xl border-emerald-500/40 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#252b3d] pb-2">
              <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
                <Sparkles className="w-4 h-4" />
                {uiText(locale, `珠宝插槽 #${jewelModalNodeId}`, `Jewel Socket #${jewelModalNodeId}`)}
              </div>
              <button
                type="button"
                onClick={() => setJewelModalNodeId(null)}
                className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {build.game === 'poe1' && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setJewelModalTab('standard')}
                  className={`px-3 py-1 rounded border cursor-pointer ${
                    jewelModalTab === 'standard'
                      ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200 font-semibold'
                      : 'bg-[#121623] border-[#262d40] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {uiText(locale, '普通与传奇珠宝', 'Standard & Unique')}
                </button>
                <button
                  type="button"
                  onClick={() => setJewelModalTab('cluster')}
                  className={`px-3 py-1 rounded border cursor-pointer ${
                    jewelModalTab === 'cluster'
                      ? 'bg-amber-500/20 border-amber-400/60 text-amber-200 font-semibold'
                      : 'bg-[#121623] border-[#262d40] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {uiText(locale, '星团珠宝工坊 (308)', 'Cluster Jewel (308)')}
                </button>
                <button
                  type="button"
                  onClick={() => setJewelModalTab('timeless')}
                  className={`px-3 py-1 rounded border cursor-pointer ${
                    jewelModalTab === 'timeless'
                      ? 'bg-purple-500/20 border-purple-400/60 text-purple-200 font-semibold'
                      : 'bg-[#121623] border-[#262d40] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {uiText(locale, '永恒珠宝 (军团基石)', 'Timeless Jewels')}
                </button>
              </div>
            )}

            {build.tree.socketedJewels?.[jewelModalNodeId] &&
              build.items[build.tree.socketedJewels[jewelModalNodeId]!] && (
                <div className="rounded bg-emerald-950/25 border border-emerald-500/40 p-2.5 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-200">
                      {build.items[build.tree.socketedJewels[jewelModalNodeId]!]!.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => socketJewel(jewelModalNodeId, null)}
                      className="text-[11px] text-rose-300 hover:text-rose-200 cursor-pointer"
                    >
                      {uiText(locale, '取下珠宝', 'Unsocket')}
                    </button>
                  </div>
                  {[
                    ...build.items[build.tree.socketedJewels[jewelModalNodeId]!]!.implicits,
                    ...build.items[build.tree.socketedJewels[jewelModalNodeId]!]!.explicits,
                  ].map((l, i) => (
                    <div key={i} className="text-indigo-200/90">
                      • {localizeStatLine(l, locale)}
                    </div>
                  ))}
                </div>
              )}

            {jewelModalTab === 'timeless' && build.game === 'poe1' ? (
              <div className="space-y-2 text-xs">
                <div className="text-[11px] text-zinc-400">
                  {uiText(locale, '选择经典军团永恒珠宝与征服者核心基石（直接生效于当前计算）:', 'Choose an iconic Timeless Jewel & Conqueror Keystone (applies live to calculations):')}
                </div>
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {[
                    {
                      name: 'Glorious Vanity (Doryani)',
                      nameZh: '荣耀幻景 · 多里亚尼 (堕落之魂)',
                      desc: 'Corrupted Soul — Gain 15% of Maximum Life as Extra Maximum Energy Shield',
                      descZh: '堕落之魂 — 获得等同于最大生命 15% 的额外最大能量护盾',
                      explicits: ['Corrupted Soul'],
                    },
                    {
                      name: 'Glorious Vanity (Xibaqua)',
                      nameZh: '荣耀幻景 · 希巴夸 (血肉神圣)',
                      desc: 'Divine Flesh — +5% max Chaos Res, 50% Elemental Damage taken as Chaos',
                      descZh: '血肉神圣 — 混沌抗性上限 +5%，50% 元素承伤转为混沌伤害',
                      explicits: ['Divine Flesh'],
                    },
                    {
                      name: 'Militant Faith (Dominus)',
                      nameZh: '军团信仰 · 多米纳斯 (内在信念)',
                      desc: 'Inner Conviction — 3% more Spell Damage per Power Charge',
                      descZh: '内在信念 — 每个暴击球使法术伤害总增 3%',
                      explicits: ['Inner Conviction'],
                    },
                    {
                      name: 'Lethal Pride (Kaom)',
                      nameZh: '致命骄傲 · 卡鲁 (力量与双倍伤害)',
                      desc: '+20 Strength, 10% chance to deal Double Damage, 10% increased maximum Life',
                      descZh: '+20 力量、10% 几率造成双倍伤害、最大生命提高 10%',
                      explicits: [
                        '+20 to Strength',
                        '10% chance to deal Double Damage',
                        '10% increased maximum Life',
                      ],
                    },
                    {
                      name: 'Brutal Restraint (Balbala)',
                      nameZh: '残酷约束 · 巴尔巴拉 (敏捷与速度)',
                      desc: '+20 Dexterity, 8% increased Movement Speed, 12% increased Attack and Cast Speed',
                      descZh: '+20 敏捷、移动速度提高 8%、攻击与施法速度提高 12%',
                      explicits: [
                        '+20 to Dexterity',
                        '8% increased Movement Speed',
                        '12% increased Attack and Cast Speed',
                      ],
                    },
                  ].map((tj) => (
                    <button
                      key={tj.name}
                      type="button"
                      onClick={() => {
                        socketJewel(jewelModalNodeId, {
                          id: `timeless_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                          name: tj.name,
                          nameZh: tj.nameZh,
                          baseName: 'Timeless Jewel',
                          rarity: 'UNIQUE',
                          slotType: 'Any',
                          quality: 0,
                          implicits: [],
                          explicits: tj.explicits,
                        });
                        setJewelModalNodeId(null);
                      }}
                      className="w-full text-left rounded p-2.5 bg-[#110e1c] hover:bg-[#1a152c] border border-purple-500/35 cursor-pointer"
                    >
                      <div className="font-semibold text-purple-200">
                        {uiText(locale, tj.nameZh, tj.name)}
                      </div>
                      <div className="text-[11px] text-indigo-200/80 mt-0.5">
                        {uiText(locale, tj.descZh, tj.desc)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : jewelModalTab === 'cluster' && build.game === 'poe1' ? (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400">
                      {uiText(locale, '星团尺寸', 'Cluster Size')}
                    </span>
                    <select
                      value={clusterSize}
                      onChange={(e) => setClusterSize(e.target.value as 'Large' | 'Medium' | 'Small')}
                      className="pob-input w-full rounded px-2 py-1 text-xs"
                    >
                      <option value="Large">
                        {uiText(locale, '大型星团 (8天赋 / 2插槽)', 'Large (8 Passives, 2 Sockets)')}
                      </option>
                      <option value="Medium">
                        {uiText(locale, '中型星团 (4天赋 / 1插槽)', 'Medium (4 Passives, 1 Socket)')}
                      </option>
                      <option value="Small">
                        {uiText(locale, '小型星团 (2天赋)', 'Small (2 Passives)')}
                      </option>
                    </select>
                  </label>
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-[11px] text-zinc-400">
                      {uiText(locale, '小天赋基础附魔', 'Small Passive Enchant')}
                    </span>
                    <select
                      value={clusterSmallGrant}
                      onChange={(e) => setClusterSmallGrant(e.target.value)}
                      className="pob-input w-full rounded px-2 py-1 text-xs"
                    >
                      <option value="12% increased Lightning Damage">12% Lightning Damage (闪电伤害)</option>
                      <option value="12% increased Fire Damage">12% Fire Damage (火焰伤害)</option>
                      <option value="12% increased Cold Damage">12% Cold Damage (冰霜伤害)</option>
                      <option value="12% increased Physical Damage">12% Physical Damage (物理伤害)</option>
                      <option value="12% increased Chaos Damage">12% Chaos Damage (混沌伤害)</option>
                      <option value="10% increased Elemental Damage">10% Elemental Damage (元素伤害)</option>
                      <option value="10% increased Spell Damage">10% Spell Damage (法术伤害)</option>
                      <option value="10% increased Attack Damage">10% Attack Damage (攻击伤害)</option>
                      <option value="4% increased maximum Life">4% maximum Life (最大生命)</option>
                      <option value="6% increased maximum Energy Shield">6% maximum Energy Shield (能量护盾)</option>
                      <option value="15% increased Armour">15% Armour (护甲)</option>
                      <option value="15% increased Evasion Rating">15% Evasion Rating (闪避)</option>
                    </select>
                  </label>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-zinc-400">
                    {uiText(locale, '小天赋效果提高', 'Increased Small Passive Effect')}:
                  </span>
                  <div className="flex items-center gap-1">
                    {[0, 25, 35].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setClusterEffectPct(pct)}
                        className={`px-2 py-0.5 rounded border text-[11px] font-mono cursor-pointer ${
                          clusterEffectPct === pct
                            ? 'bg-amber-500/25 border-amber-400 text-amber-200'
                            : 'bg-[#121623] border-[#252c40] text-zinc-400'
                        }`}
                      >
                        +{pct}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* Selected Notables Chips */}
                <div className="space-y-1">
                  <div className="text-[11px] text-zinc-400">
                    {uiText(locale, `已选核心天赋 (${clusterSelectedNotables.length}/3):`, `Selected Cluster Notables (${clusterSelectedNotables.length}/3):`)}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {clusterSelectedNotables.map((name) => (
                      <span
                        key={name}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/50 text-amber-200 text-[11px]"
                      >
                        {name}
                        <button
                          type="button"
                          onClick={() =>
                            setClusterSelectedNotables((prev) => prev.filter((n) => n !== name))
                          }
                          className="text-amber-300/80 hover:text-rose-300 cursor-pointer"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Searchable 308 Official Cluster Notables */}
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={clusterNotableSearch}
                    onChange={(e) => setClusterNotableSearch(e.target.value)}
                    placeholder={
                      uiText(locale, '搜索 308 个官方星团核心天赋 (如 风暴痛饮 / 棱光之心 / Prismatic)...', 'Search 308 official Cluster Notables (e.g. Storm Drinker, Prismatic Heart)...')
                    }
                    className="pob-input w-full rounded px-2.5 py-1.5 text-xs"
                  />
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {getAllClusterNotables()
                      .filter((n) => {
                        const q = clusterNotableSearch.trim().toLowerCase();
                        if (!q) return true;
                        return `${n.en} ${n.zh ?? ''} ${n.zhTw ?? ''} ${n.st.join(' ')} ${(n.sz ?? []).join(' ')} ${(n.szTw ?? []).join(' ')}`
                          .toLowerCase()
                          .includes(q);
                      })
                      .slice(0, 30)
                      .map((n) => {
                        const picked = clusterSelectedNotables.includes(n.en);
                        return (
                          <button
                            key={n.en}
                            type="button"
                            onClick={() =>
                              setClusterSelectedNotables((prev) =>
                                prev.includes(n.en)
                                  ? prev.filter((x) => x !== n.en)
                                  : prev.length < 3
                                    ? [...prev, n.en]
                                    : prev,
                              )
                            }
                            className={`w-full text-left rounded px-2.5 py-1.5 border text-xs cursor-pointer ${
                              picked
                                ? 'bg-amber-500/20 border-amber-400/60'
                                : 'bg-[#0e111b] hover:bg-[#171c2b] border-[#252c40]'
                            }`}
                          >
                            <div className="font-semibold text-amber-200">
                              {locale === 'zh-TW' && (n.zhTw || n.zh)
                                ? `${n.zhTw || toTraditionalZh(n.zh!)} (${n.en})`
                                : locale === 'zh-CN' && n.zh
                                  ? `${n.zh} (${n.en})`
                                  : n.en}
                            </div>
                            <div className="text-[10px] text-indigo-200/80 truncate">
                              {(locale === 'zh-TW' && n.szTw
                                ? n.szTw
                                : locale === 'zh-TW' && n.sz
                                  ? n.sz.map((s) => toTraditionalZh(s))
                                  : locale === 'zh-CN' && n.sz
                                    ? n.sz
                                    : n.st
                              ).join(' · ')}
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const addedPassives = clusterSize === 'Large' ? 8 : clusterSize === 'Medium' ? 4 : 2;
                    const sockets = clusterSize === 'Large' ? 2 : clusterSize === 'Medium' ? 1 : 0;
                    const implicits = [
                      `Adds ${addedPassives} Passive Skills`,
                      ...(sockets > 0
                        ? [`${sockets} Added Passive Skill${sockets > 1 ? 's are Jewel Sockets' : ' is a Jewel Socket'}`]
                        : []),
                      `Added Small Passive Skills grant: ${clusterSmallGrant}`,
                    ];
                    const explicits = [
                      ...(clusterEffectPct > 0
                        ? [`Added Small Passive Skills have ${clusterEffectPct}% increased effect`]
                        : []),
                      ...clusterSelectedNotables.map((n) => `1 Added Passive Skill is ${n}`),
                    ];
                    socketJewel(jewelModalNodeId, {
                      id: `cluster_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                      name: `${clusterSize} Cluster (${clusterSelectedNotables.join(' + ') || 'Custom'})`,
                      nameZh: `${clusterSize === 'Large' ? '大型' : clusterSize === 'Medium' ? '中型' : '小型'}星团珠宝`,
                      baseName: `${clusterSize} Cluster Jewel`,
                      rarity: 'RARE',
                      slotType: 'Any',
                      quality: 0,
                      implicits,
                      explicits,
                    });
                    setJewelModalNodeId(null);
                  }}
                  className="w-full py-2 rounded font-semibold bg-amber-500/25 hover:bg-amber-500/35 text-amber-200 border border-amber-400/60 cursor-pointer"
                >
                  {uiText(locale, '制作并镶嵌此星团珠宝', 'Craft & Socket Cluster Jewel')}
                </button>
              </div>
            ) : (
              <>
                {/* Quick Rare Jewel Presets */}
                <div className="space-y-1">
                  <div className="text-[11px] text-zinc-400 font-semibold">
                    {uiText(locale, '快捷镶嵌稀有珠宝', 'Quick Rare Jewels')}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-xs">
                    {[
                      {
                        name: 'Cobalt Spell Jewel',
                        nameZh: '钴蓝法术珠宝',
                        baseName: 'Cobalt Jewel',
                        explicits: ['7% increased maximum Life', '14% increased Spell Damage', '+15% to Global Critical Strike Multiplier'],
                      },
                      {
                        name: 'Crimson Melee Jewel',
                        nameZh: '赤红近战珠宝',
                        baseName: 'Crimson Jewel',
                        explicits: ['7% increased maximum Life', '14% increased Melee Physical Damage', '6% increased Attack Speed'],
                      },
                      {
                        name: 'Viridian Crit ES Jewel',
                        nameZh: '翠绿护盾暴击珠宝',
                        baseName: 'Viridian Jewel',
                        explicits: ['8% increased maximum Energy Shield', '14% increased Elemental Damage', '+15% to Global Critical Strike Multiplier'],
                      },
                    ].map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => {
                          socketJewel(jewelModalNodeId, {
                            id: `jewel_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                            name: preset.name,
                            nameZh: preset.nameZh,
                            baseName: preset.baseName,
                            rarity: 'RARE',
                            slotType: 'Any',
                            quality: 0,
                            implicits: [],
                            explicits: preset.explicits,
                          });
                          setJewelModalNodeId(null);
                        }}
                        className="rounded p-2 text-left bg-[#121623] hover:bg-[#1a2033] border border-yellow-500/30 text-yellow-200 cursor-pointer"
                      >
                        <div className="font-semibold text-[11px]">
                          {uiText(locale, preset.nameZh, preset.name)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Official Unique Jewels Search */}
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={jewelSearch}
                    onChange={(e) => setJewelSearch(e.target.value)}
                    placeholder={uiText(locale, '搜索官方传奇珠宝 (如 守望之眼 / Watcher)...', 'Search official Unique Jewels...')}
                    className="pob-input w-full rounded px-2.5 py-1.5 text-xs"
                  />
                  <div className="max-h-44 overflow-y-auto space-y-1">
                    {getUniquesForGame(build.game)
                      .filter((u) => {
                        if (u.s !== 'Jewel') return false;
                        const q = jewelSearch.trim().toLowerCase();
                        if (!q) return true;
                        return `${u.en} ${u.zh ?? ''} ${u.zhTw ?? ''} ${u.e.join(' ')}`.toLowerCase().includes(q);
                      })
                      .slice(0, 25)
                      .map((u) => (
                        <button
                          key={u.en}
                          type="button"
                          onClick={() => {
                            socketJewel(jewelModalNodeId, instantiateUniqueItem(build.game, u, 0));
                            setJewelModalNodeId(null);
                          }}
                          className="w-full text-left rounded px-2.5 py-1.5 bg-[#0e111b] hover:bg-[#171c2b] border border-orange-500/25 text-xs cursor-pointer"
                        >
                          <div className="font-semibold text-orange-300">
                            {locale === 'zh-TW' && (u.zhTw || u.zh)
                              ? `${u.zhTw || toTraditionalZh(u.zh!)} (${u.en})`
                              : locale === 'zh-CN' && u.zh
                                ? `${u.zh} (${u.en})`
                                : u.en}
                          </div>
                          {u.e.length > 0 && (
                            <div className="text-[10px] text-indigo-200/80 truncate">
                              {u.e.slice(0, 2).map((l) => localizeStatLine(l, locale)).join(' · ')}
                            </div>
                          )}
                        </button>
                      ))}
                  </div>
                </div>
              </>
            )}

            <div className="flex justify-end pt-1 border-t border-[#252b3d]">
              <button
                type="button"
                onClick={() => {
                  const nid = jewelModalNodeId;
                  setJewelModalNodeId(null);
                  togglePassiveNode(nid);
                }}
                className="px-2.5 py-1 rounded text-xs text-rose-300 hover:bg-rose-950/40 border border-rose-500/35 cursor-pointer"
              >
                {uiText(locale, '取消点亮此插槽', 'Unallocate Socket Node')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mastery Picker Modal (PoE 1) */}
      {masteryModalNode && masteryModalNode.masteryEffects && (
        <div className="absolute inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
          <div className="pob-panel rounded-lg w-full max-w-lg p-4 space-y-3 shadow-2xl border-sky-500/40">
            <div className="flex items-center justify-between border-b border-[#252b3d] pb-2">
              <div className="flex items-center gap-2 text-sky-300 font-bold text-sm">
                <Sparkles className="w-4 h-4" />
                {localizeText(masteryModalNode.name, locale)}
              </div>
              <button
                type="button"
                onClick={() => setMasteryModalNodeId(null)}
                className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {masteryModalNode.masteryEffects.map((effect) => {
                const rawEn = effect.stats.join('\n');
                const isSelected = build.tree.masteryEffects[masteryModalNode.id] === rawEn;
                const display =
                  locale === 'zh-TW'
                    ? effect.statsZhTw ??
                      (effect.statsZh ? effect.statsZh.map((s) => toTraditionalZh(s)) : effect.stats.map((s) => localizeStatLine(s, locale)))
                    : locale === 'zh-CN' && effect.statsZh
                      ? effect.statsZh
                      : effect.stats;
                return (
                  <button
                    key={effect.id}
                    type="button"
                    onClick={() => {
                      setMasteryEffect(masteryModalNode.id, isSelected ? null : rawEn);
                      setMasteryModalNodeId(null);
                    }}
                    className={`w-full text-left rounded p-2.5 text-xs border transition cursor-pointer ${
                      isSelected
                        ? 'bg-sky-500/20 border-sky-400 text-sky-100'
                        : 'bg-[#0b0e15] border-[#23293a] text-zinc-200 hover:border-amber-500/40'
                    }`}
                  >
                    {display.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Hover Tooltip for Visual Cluster Jewel Sub-Graph Nodes */}
      {hoveredClusterNode && !hoveredNode && !masteryModalNode && jewelModalNodeId === null && (
        <div
          className="pointer-events-none absolute z-30 w-72 rounded-md border border-amber-400/55 bg-[#0e111a]/95 shadow-2xl p-3 text-xs backdrop-blur-sm"
          style={{
            left: Math.min(mousePos.x + 18, (containerRef.current?.clientWidth ?? 800) - 300),
            top: Math.min(mousePos.y + 18, (containerRef.current?.clientHeight ?? 600) - 180),
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-[#262d40] pb-1.5 mb-2">
            <div>
              <div className="font-bold text-amber-200 text-sm">
                {locale === 'zh-TW' && hoveredClusterNode.nameZh
                  ? toTraditionalZh(hoveredClusterNode.nameZh)
                  : locale === 'zh-CN' && hoveredClusterNode.nameZh
                    ? hoveredClusterNode.nameZh
                    : hoveredClusterNode.name}
              </div>
              {hoveredClusterNode.nameZh && (
                <div className="text-[10px] text-zinc-400">
                  {uiText(locale, hoveredClusterNode.name, hoveredClusterNode.nameZh)}
                </div>
              )}
            </div>
            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-400/40 shrink-0">
              Cluster {hoveredClusterNode.kind}
            </span>
          </div>
          <div className="space-y-1 text-sky-200/95">
            {(locale === 'zh-TW' && hoveredClusterNode.statsZh
              ? hoveredClusterNode.statsZh.map((s) => toTraditionalZh(s))
              : locale === 'zh-CN' && hoveredClusterNode.statsZh
                ? hoveredClusterNode.statsZh
                : hoveredClusterNode.stats.map((s) => localizeStatLine(s, locale))
            ).map((s, idx) => (
              <div key={idx}>• {s}</div>
            ))}
          </div>
        </div>
      )}

      {/* Rich Bilingual Hover Tooltip with Live Node Power Delta */}
      {hoveredNode && !masteryModalNode && (
        <div
          className="pointer-events-none absolute z-30 w-80 rounded-md border border-amber-500/45 bg-[#0e111a]/95 shadow-2xl p-3 text-xs backdrop-blur-sm"
          style={{
            left: Math.min(mousePos.x + 18, (containerRef.current?.clientWidth ?? 800) - 335),
            top: Math.min(mousePos.y + 18, (containerRef.current?.clientHeight ?? 600) - 240),
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-[#262d40] pb-1.5 mb-2">
            <div className="min-w-0">
              <div className="font-bold text-amber-200 text-sm truncate">
                {localizeText(hoveredNode.name, locale)}
              </div>
              {hoveredNode.name.zh !== hoveredNode.name.en && (
                <div className="text-[10px] text-zinc-400 truncate">
                  {uiText(locale, hoveredNode.name.en, hoveredNode.name.zh)}
                </div>
              )}
            </div>
            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
              {hoveredNode.kind}
            </span>
          </div>

          <div className="space-y-1 text-sky-200/95">
            {hoveredNode.kind === 'mastery' ? (
              <div className="text-sky-300">
                {build.tree.masteryEffects[hoveredNode.id]
                  ? localizeStatLine(build.tree.masteryEffects[hoveredNode.id]!, locale)
                  : uiText(locale, '点击选择专精词缀效果', 'Click to choose a Mastery effect')}
              </div>
            ) : hoveredNode.kind === 'jewel' && build.tree.socketedJewels?.[hoveredNode.id] ? (
              (() => {
                const j = build.items[build.tree.socketedJewels![hoveredNode.id]!];
                if (!j) return <div className="text-zinc-400 italic">Jewel Socket</div>;
                return (
                  <div className="space-y-0.5">
                    <div className="text-emerald-300 font-semibold">
                      {locale === 'zh-TW' && (j.nameZhTw || j.nameZh)
                        ? j.nameZhTw || toTraditionalZh(j.nameZh!)
                        : locale === 'zh-CN' && j.nameZh
                          ? j.nameZh
                          : j.name}
                    </div>
                    {j.explicits.map((line, idx) => (
                      <div key={idx} className="text-indigo-200">
                        • {localizeStatLine(line, locale)}
                      </div>
                    ))}
                  </div>
                );
              })()
            ) : hoveredNode.stats.length === 0 ? (
              <div className="text-zinc-400 italic">{t(locale, 'tree.start')}</div>
            ) : (
              getDisplayStats(hoveredNode).map((stat, idx) => (
                <div key={idx}>• {stat}</div>
              ))
            )}
          </div>

          {hoveredPower && (
            <div className="mt-2.5 pt-2 border-t border-[#262d40] space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
                  {t(locale, 'tree.nodePower')}{' '}
                  {hoverPathNodeCount > 1 && `(+${hoverPathNodeCount} pts)`}
                </div>
                {isHighEfficiencyHover && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/50 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-mono font-semibold text-emerald-300">
                    <Sparkles className="w-2.5 h-2.5" />
                    {uiText(locale, '高效', 'High Eff.')}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1 font-mono text-[11px]">
                <div className={hoveredPower.dpsDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  DPS: {hoveredPower.dpsDelta >= 0 ? '+' : ''}
                  {Math.round(hoveredPower.dpsDelta).toLocaleString()} (
                  {hoveredPower.dpsDeltaPct >= 0 ? '+' : ''}
                  {hoveredPower.dpsDeltaPct}%)
                </div>
                <div className={hoveredPower.lifeDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  Life: {hoveredPower.lifeDelta >= 0 ? '+' : ''}
                  {hoveredPower.lifeDelta}
                </div>
                <div className={hoveredPower.esDelta >= 0 ? 'text-sky-300' : 'text-rose-400'}>
                  ES: {hoveredPower.esDelta >= 0 ? '+' : ''}
                  {hoveredPower.esDelta}
                </div>
                <div className={hoveredPower.ehpDelta >= 0 ? 'text-emerald-300' : 'text-rose-400'}>
                  EHP: {hoveredPower.ehpDelta >= 0 ? '+' : ''}
                  {Math.round(hoveredPower.ehpDelta).toLocaleString()}
                </div>
              </div>
              {(hoverDpsPerPoint !== null || hoverEhpPerPoint !== null) && (
                <div className="space-y-0.5 rounded bg-[#0a0d14]/70 border border-[#252b3d] px-2 py-1 font-mono text-[10px]">
                  <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-sans font-semibold">
                    {uiText(locale, '每点收益效率', 'Per-Point Efficiency')}
                  </div>
                  {hoverDpsPerPoint !== null && (
                    <div
                      className={
                        isHighEfficiencyHover ? 'text-emerald-300 font-semibold' : 'text-zinc-300'
                      }
                    >
                      DPS {hoveredPower.dpsDeltaPct >= 0 ? '+' : ''}
                      {hoveredPower.dpsDeltaPct}%{' '}
                      <span className="text-zinc-400">
                        {uiText(locale, `(每点 ${hoverDpsPerPoint >= 0 ? '+' : ''}${hoverDpsPerPoint.toFixed(1)}%)`, `(${hoverDpsPerPoint >= 0 ? '+' : ''}${hoverDpsPerPoint.toFixed(1)}%/pt)`)}
                      </span>
                    </div>
                  )}
                  {hoverEhpPerPoint !== null && (
                    <div className="text-sky-300">
                      EHP {hoverEhpDeltaPct >= 0 ? '+' : ''}
                      {hoverEhpDeltaPct.toFixed(1)}%{' '}
                      <span className="text-zinc-400">
                        {uiText(locale, `(每点 ${hoverEhpPerPoint >= 0 ? '+' : ''}${hoverEhpPerPoint.toFixed(1)}%)`, `(${hoverEhpPerPoint >= 0 ? '+' : ''}${hoverEhpPerPoint.toFixed(1)}%/pt)`)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
