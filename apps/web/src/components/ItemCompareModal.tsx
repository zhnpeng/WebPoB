import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Save,
  Shield,
  Sparkles,
  X,
} from 'lucide-react';
import type { EquipmentSlotId, Item, ItemRarity } from '@webpob/core';
import { listBaseItemsForGame } from '@webpob/data';
import { parseItemText } from '@webpob/codec';
import { resolveItemEffectiveStats } from '@webpob/calc/localItem';
import { getSlotLabel, localizeStatLine, uiText } from '@webpob/i18n';
import { useWebPobStore } from '../store/useWebPobStore';
import { calculateBuildInWorker } from '../workers/calcWorkerClient';

const RARITY_COLOR: Record<ItemRarity, string> = {
  NORMAL: 'text-zinc-200 border-zinc-600/50',
  MAGIC: 'text-blue-300 border-blue-500/40',
  RARE: 'text-yellow-200 border-yellow-500/40',
  UNIQUE: 'text-orange-400 border-orange-500/50',
};

const FALLBACK_BASE: Partial<Record<EquipmentSlotId, string>> = {
  'Weapon 1': 'Prophecy Wand',
  'Weapon 2': 'Prophecy Wand',
  'Weapon 1 Swap': 'Prophecy Wand',
  'Weapon 2 Swap': 'Prophecy Wand',
  Helmet: 'Hubris Circlet',
  'Body Armour': 'Vaal Regalia',
  Gloves: 'Fingerless Silk Gloves',
  Boots: 'Sorcerer Boots',
  Amulet: 'Onyx Amulet',
  'Ring 1': 'Gold Ring',
  'Ring 2': 'Gold Ring',
  Belt: 'Leather Belt',
  'Flask 1': 'Quicksilver Flask',
  'Flask 2': 'Quicksilver Flask',
  'Flask 3': 'Quicksilver Flask',
  'Flask 4': 'Quicksilver Flask',
  'Flask 5': 'Quicksilver Flask',
  'Charm 1': 'Sapphire Charm',
  'Charm 2': 'Sapphire Charm',
  'Charm 3': 'Sapphire Charm',
};

type SlotCategory = 'weapon' | 'armour' | 'accessory' | 'flask' | 'charm';

function getSlotCategory(slot: EquipmentSlotId): SlotCategory {
  if (slot.startsWith('Weapon')) return 'weapon';
  if (slot === 'Helmet' || slot === 'Body Armour' || slot === 'Gloves' || slot === 'Boots') {
    return 'armour';
  }
  if (slot.startsWith('Flask ')) return 'flask';
  if (slot.startsWith('Charm ')) return 'charm';
  return 'accessory';
}

interface Draft {
  id: string;
  name: string;
  baseName: string;
  rarity: ItemRarity;
  quality: number;
  implicits: string;
  explicits: string;
}

function newId(): string {
  return `compare_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function splitLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function fmt(value: number, digits = 0): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function signed(value: number, digits = 0): string {
  return `${value > 0 ? '+' : ''}${fmt(value, digits)}`;
}

function DeltaBadge({
  label,
  delta,
  pct,
  digits = 0,
  goodWhenPositive = true,
}: {
  label: string;
  delta: number;
  pct?: number;
  digits?: number;
  goodWhenPositive?: boolean;
}) {
  const changed = Math.abs(delta) > (digits > 0 ? 0.05 : 0.5);
  const good = goodWhenPositive ? delta >= 0 : delta <= 0;
  const tone = !changed
    ? 'text-zinc-500 border-zinc-700/70 bg-[#141824]'
    : good
      ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
      : 'text-rose-300 border-rose-500/40 bg-rose-500/10';
  return (
    <div className={`rounded border px-2.5 py-1.5 ${tone}`}>
      <div className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="font-mono text-sm font-semibold">
        {signed(delta, digits)}
        {pct !== undefined && Math.abs(pct) > 0.05 && (
          <span className="ml-1 text-[11px] font-normal opacity-90">({signed(pct, 1)}%)</span>
        )}
      </div>
    </div>
  );
}

function ResistanceBadge({
  label,
  delta,
  current,
}: {
  label: string;
  delta: number;
  current: number;
}) {
  if (Math.abs(delta) < 0.5) return null;
  const good = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-mono ${
        good
          ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
          : 'text-rose-300 border-rose-500/40 bg-rose-500/10'
      }`}
      title={`${current}%`}
    >
      {label} {signed(delta)}%
    </span>
  );
}

function StatSummary({
  armourStats,
  weaponStats,
}: {
  armourStats?: { armour?: number; evasion?: number; energyShield?: number; ward?: number; blockChance?: number };
  weaponStats?: { physicalMin: number; physicalMax: number; attacksPerSecond: number; critChance: number };
}) {
  if (!armourStats && !weaponStats) {
    return (
      <div className="text-[11px] text-zinc-500 italic">—</div>
    );
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-zinc-300">
      {armourStats?.armour ? <span>Armour {fmt(armourStats.armour)}</span> : null}
      {armourStats?.evasion ? <span>Evasion {fmt(armourStats.evasion)}</span> : null}
      {armourStats?.energyShield ? (
        <span className="text-sky-300">ES {fmt(armourStats.energyShield)}</span>
      ) : null}
      {armourStats?.ward ? <span className="text-indigo-300">Ward {fmt(armourStats.ward)}</span> : null}
      {armourStats?.blockChance ? <span>Block {fmt(armourStats.blockChance)}%</span> : null}
      {weaponStats ? (
        <>
          <span>
            Phys {fmt(weaponStats.physicalMin)}–{fmt(weaponStats.physicalMax)}
          </span>
          <span>APS {fmt(weaponStats.attacksPerSecond, 2)}</span>
          <span>Crit {fmt(weaponStats.critChance, 2)}%</span>
        </>
      ) : null}
    </div>
  );
}

export function ItemCompareModal({
  open,
  slot,
  initialItem,
  onClose,
}: {
  open: boolean;
  slot: EquipmentSlotId;
  initialItem?: Item | null;
  onClose: () => void;
}) {
  const { locale, build, calc, addItem } = useWebPobStore();
  const cn = locale !== 'en';
  const l = (zh: string, en: string) => uiText(locale, zh, en);

  const [draft, setDraft] = useState<Draft>(() => ({
    id: newId(),
    name: 'New Item',
    baseName: '',
    rarity: 'RARE',
    quality: 20,
    implicits: '',
    explicits: '',
  }));
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  const allBases = useMemo(() => listBaseItemsForGame(build.game), [build.game]);

  useEffect(() => {
    if (!open) return;
    const equippedId = build.equipped[slot];
    const source = initialItem ?? (equippedId ? build.items[equippedId] : undefined);
    if (source) {
      setDraft({
        id: newId(),
        name: source.name,
        baseName: source.baseName,
        rarity: source.rarity,
        quality: source.quality,
        implicits: source.implicits.join('\n'),
        explicits: source.explicits.join('\n'),
      });
    } else {
      const category = getSlotCategory(slot);
      const base =
        category === 'weapon'
          ? allBases.find((b) => b.entry.weapon)?.name
          : category === 'armour'
            ? allBases.find((b) => b.entry.armour)?.name
            : undefined;
      setDraft({
        id: newId(),
        name: l('新装备草案', 'New Item Draft'),
        baseName: FALLBACK_BASE[slot] ?? base ?? '',
        rarity: 'RARE',
        quality: 20,
        implicits: '',
        explicits: '',
      });
    }
    setPasteOpen(false);
    setPasteText('');
    setPasteError(null);
    // Reset only when the modal is opened for a slot / item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slot, initialItem?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const equippedItem = useMemo(() => {
    const id = build.equipped[slot];
    return id ? build.items[id] : undefined;
  }, [build.equipped, build.items, slot]);

  const equippedResolved = useMemo(
    () => (equippedItem ? resolveItemEffectiveStats(equippedItem, build.game) : undefined),
    [equippedItem, build.game],
  );

  const baseEntry = useMemo(
    () => allBases.find((b) => b.name === draft.baseName)?.entry,
    [allBases, draft.baseName],
  );

  const candidate = useMemo<Item>(
    () => ({
      id: draft.id,
      name: draft.name,
      baseName: draft.baseName,
      rarity: draft.rarity,
      slotType: slot,
      quality: draft.quality,
      weaponStats: baseEntry?.weapon,
      armourStats: baseEntry?.armour,
      implicits: splitLines(draft.implicits),
      explicits: splitLines(draft.explicits),
      localStatsPrecomputed: false,
    }),
    [draft, baseEntry, slot],
  );

  const candidateResolved = useMemo(
    () => resolveItemEffectiveStats(candidate, build.game),
    [candidate, build.game],
  );

  const [simulation, setSimulation] = useState<{
    dpsDelta: number;
    dpsPct: number;
    lifeDelta: number;
    esDelta: number;
    ehpDelta: number;
    ehpPct: number;
    resistDelta: { fire: number; cold: number; lightning: number; chaos: number };
    nextResist: { fire: number; cold: number; lightning: number; chaos: number };
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setSimulation(null);
      return;
    }
    let cancelled = false;
    const simBuild = {
      ...build,
      items: { ...build.items, [candidate.id]: candidate },
      equipped: { ...build.equipped, [slot]: candidate.id },
    };
    void calculateBuildInWorker(simBuild, locale)
      .then((next) => {
        if (cancelled) return;
        const baseDps = calc.offence.fullDps ?? calc.offence.totalDps;
        const nextDps = next.offence.fullDps ?? next.offence.totalDps;
        const baseEhp = Math.max(0, calc.defence.effectiveHitPool);
        const nextEhp = next.defence.effectiveHitPool;
        setSimulation({
          dpsDelta: nextDps - baseDps,
          dpsPct: baseDps > 0 ? ((nextDps - baseDps) / baseDps) * 100 : 0,
          lifeDelta: next.defence.life - calc.defence.life,
          esDelta: next.defence.energyShield - calc.defence.energyShield,
          ehpDelta: nextEhp - baseEhp,
          ehpPct: baseEhp > 0 ? ((nextEhp - baseEhp) / baseEhp) * 100 : 0,
          resistDelta: {
            fire: next.defence.fireResist - calc.defence.fireResist,
            cold: next.defence.coldResist - calc.defence.coldResist,
            lightning: next.defence.lightningResist - calc.defence.lightningResist,
            chaos: next.defence.chaosResist - calc.defence.chaosResist,
          },
          nextResist: {
            fire: next.defence.fireResist,
            cold: next.defence.coldResist,
            lightning: next.defence.lightningResist,
            chaos: next.defence.chaosResist,
          },
        });
      })
      .catch(() => {
        if (!cancelled) setSimulation(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, build, candidate, slot, calc, locale]);

  if (!open) return null;

  const handlePasteImport = () => {
    const parsed = parseItemText(pasteText, undefined, build.game);
    if (!parsed) {
      setPasteError(l('无法解析装备文本，请检查格式。', 'Could not parse item text. Check the format.'));
      return;
    }
    setDraft({
      id: newId(),
      name: parsed.name,
      baseName: parsed.baseName,
      rarity: parsed.rarity,
      quality: parsed.quality,
      implicits: parsed.implicits.join('\n'),
      explicits: parsed.explicits.join('\n'),
    });
    setPasteError(null);
    setPasteText('');
    setPasteOpen(false);
  };

  const displayItemName = (item: Item) => (cn && item.nameZh ? item.nameZh : item.name);
  const displayBaseName = (item: Item) => (cn && item.baseNameZh ? item.baseNameZh : item.baseName);

  const rarityLabel: Record<ItemRarity, string> = {
    NORMAL: l('普通', 'Normal'),
    MAGIC: l('魔法', 'Magic'),
    RARE: l('稀有', 'Rare'),
    UNIQUE: l('传奇', 'Unique'),
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-3"
      onClick={onClose}
    >
      <div
        className="bg-[#0f131e] border border-[#2a3147] rounded-lg w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#252b3d] bg-[#121622] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ArrowLeftRight className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-bold text-amber-200 truncate">
                {l('装备对比与快速编辑', 'Item Compare & Quick Edit')}
              </div>
              <div className="text-[11px] text-zinc-400">
                {getSlotLabel(locale, slot)} · {build.game.toUpperCase()}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-[#1c2233] cursor-pointer"
            title={l('关闭', 'Close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Live Simulation Diff Banner */}
        <div className="px-4 py-2.5 border-b border-[#252b3d] bg-[#0b0e16]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-zinc-400 mr-1 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              {l('实时模拟差异', 'Live Simulation Delta')}
            </span>
            {simulation ? (
              <>
                <DeltaBadge
                  label={l('总 DPS', 'Total DPS')}
                  delta={simulation.dpsDelta}
                  pct={simulation.dpsPct}
                />
                <DeltaBadge label={l('生命', 'Life')} delta={simulation.lifeDelta} />
                <DeltaBadge label={l('能量护盾', 'Energy Shield')} delta={simulation.esDelta} />
                <DeltaBadge
                  label={l('有效生命池', 'EHP')}
                  delta={simulation.ehpDelta}
                  pct={simulation.ehpPct}
                />
                <div className="flex flex-wrap items-center gap-1 ml-auto">
                  <ResistanceBadge
                    label={l('火', 'Fire')}
                    delta={simulation.resistDelta.fire}
                    current={simulation.nextResist.fire}
                  />
                  <ResistanceBadge
                    label={l('冰', 'Cold')}
                    delta={simulation.resistDelta.cold}
                    current={simulation.nextResist.cold}
                  />
                  <ResistanceBadge
                    label={l('电', 'Light')}
                    delta={simulation.resistDelta.lightning}
                    current={simulation.nextResist.lightning}
                  />
                  <ResistanceBadge
                    label={l('混', 'Chaos')}
                    delta={simulation.resistDelta.chaos}
                    current={simulation.nextResist.chaos}
                  />
                </div>
              </>
            ) : (
              <span className="text-[11px] text-zinc-500">—</span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Currently Equipped */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
              <Shield className="w-3.5 h-3.5 text-zinc-400" />
              {l('当前已装备', 'Currently Equipped')}
            </div>
            {equippedItem ? (
              <div
                className={`rounded border p-3 bg-[#0b0d14] space-y-2 ${RARITY_COLOR[equippedItem.rarity]}`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold truncate">{displayItemName(equippedItem)}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-current/40 uppercase">
                      {rarityLabel[equippedItem.rarity]}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-400">{displayBaseName(equippedItem)}</div>
                  <div className="text-[11px] font-mono text-zinc-400">
                    {l('品质', 'Quality')} {equippedItem.quality}%
                  </div>
                </div>
                <div className="border-t border-[#232838] pt-2">
                  <StatSummary
                    armourStats={equippedResolved?.armourStats}
                    weaponStats={equippedResolved?.weaponStats}
                  />
                </div>
                {equippedItem.implicits.length > 0 && (
                  <div className="border-t border-[#232838] pt-2 space-y-0.5 text-xs text-sky-300">
                    {equippedItem.implicits.map((line, i) => (
                      <div key={i}>{localizeStatLine(line, locale)}</div>
                    ))}
                  </div>
                )}
                {equippedItem.explicits.length > 0 && (
                  <div className="border-t border-[#232838] pt-2 space-y-0.5 text-xs text-indigo-200">
                    {equippedItem.explicits.map((line, i) => (
                      <div key={i}>{localizeStatLine(line, locale)}</div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded border border-dashed border-[#2a3147] bg-[#0b0d14] p-6 text-center">
                <Shield className="w-8 h-8 mx-auto text-zinc-600 mb-2" />
                <div className="text-sm font-semibold text-zinc-400">
                  {l('空槽位', 'Empty Slot')}
                </div>
                <div className="text-[11px] text-zinc-500 mt-1">
                  {l('该槽位当前没有装备。', 'Nothing is equipped in this slot.')}
                </div>
              </div>
            )}
          </div>

          {/* Right: Candidate Editor */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                {l('候选装备 (可编辑)', 'Candidate Item (Editable)')}
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-current/40 uppercase text-yellow-200">
                {rarityLabel[draft.rarity]}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setPasteOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#151a28] hover:bg-[#1b2233] border border-[#2a3147] text-[11px] text-sky-200 cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <ClipboardPaste className="w-3.5 h-3.5" />
                {l('粘贴游戏内 Ctrl+C 文本替换候选装备', 'Paste Ctrl+C Item Text')}
              </span>
              {pasteOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            {pasteOpen && (
              <div className="space-y-2 rounded border border-[#2a3147] bg-[#0b0e16] p-2.5">
                <textarea
                  rows={4}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={l(
                    '在此粘贴游戏内 / 市集装备文本（中文或英文均可）...',
                    'Paste in-game or trade item text here (English or Chinese)...',
                  )}
                  className="pob-input w-full rounded p-2 text-[11px] font-mono"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-rose-400">{pasteError ?? ''}</span>
                  <button
                    type="button"
                    onClick={handlePasteImport}
                    disabled={!pasteText.trim()}
                    className="px-2.5 py-1 rounded text-[11px] font-semibold bg-sky-500/20 hover:bg-sky-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-sky-200 border border-sky-500/40 cursor-pointer"
                  >
                    {l('解析并替换', 'Parse & Replace')}
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="sm:col-span-2 space-y-1">
                <span className="text-[10px] uppercase tracking-wide text-zinc-400">
                  {l('名称', 'Name')}
                </span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  className="pob-input w-full rounded px-2 py-1.5 text-xs"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-wide text-zinc-400">
                  {l('品质', 'Quality')} (0–30)
                </span>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={draft.quality}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      quality: Math.max(0, Math.min(30, Number(e.target.value) || 0)),
                    }))
                  }
                  className="pob-input w-full rounded px-2 py-1.5 text-xs font-mono"
                />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-zinc-400">
                {l('基底', 'Base Type')}
              </span>
              <div className="px-2 py-1.5 rounded bg-[#0b0e16] border border-[#232838] text-xs text-zinc-300 font-mono truncate">
                {draft.baseName || '—'}
              </div>
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-sky-300">
                {l('固定词缀 (每行一条)', 'Implicits (one per line)')}
              </span>
              <textarea
                rows={2}
                value={draft.implicits}
                onChange={(e) => setDraft((d) => ({ ...d, implicits: e.target.value }))}
                className="pob-input w-full rounded p-2 text-xs font-mono text-sky-200"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-indigo-300">
                {l('随机词缀 (每行一条，支持中英文)', 'Explicits (one per line, EN or ZH)')}
              </span>
              <textarea
                rows={6}
                value={draft.explicits}
                onChange={(e) => setDraft((d) => ({ ...d, explicits: e.target.value }))}
                className="pob-input w-full rounded p-2 text-xs font-mono text-indigo-200"
              />
            </label>

            <div className="rounded border border-[#232838] bg-[#0b0d14] p-2.5 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wide text-zinc-400">
                {l('候选装备预览', 'Candidate Preview')}
              </div>
              <StatSummary
                armourStats={candidateResolved.armourStats}
                weaponStats={candidateResolved.weaponStats}
              />
              {splitLines(draft.implicits).length > 0 && (
                <div className="border-t border-[#232838] pt-1.5 space-y-0.5 text-[11px] text-sky-300">
                  {splitLines(draft.implicits).map((line, i) => (
                    <div key={i}>{localizeStatLine(line, locale)}</div>
                  ))}
                </div>
              )}
              <div className="border-t border-[#232838] pt-1.5 space-y-0.5 text-[11px] text-indigo-200">
                {splitLines(draft.explicits).length > 0 ? (
                  splitLines(draft.explicits).map((line, i) => (
                    <div key={i}>{localizeStatLine(line, locale)}</div>
                  ))
                ) : (
                  <div className="text-zinc-500 italic">
                    {l('暂无随机词缀', 'No explicit modifiers')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-[#252b3d] bg-[#121622] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs bg-[#1b2030] hover:bg-[#252c40] text-zinc-200 border border-[#2e364d] cursor-pointer"
          >
            {l('取消', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => {
              addItem({ ...candidate, name: draft.name.trim() || candidate.name }, slot);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-amber-500/25 hover:bg-amber-500/35 text-amber-200 border border-amber-500/50 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            {l('保存并装备', 'Save & Equip')}
          </button>
        </div>
      </div>
    </div>
  );
}
