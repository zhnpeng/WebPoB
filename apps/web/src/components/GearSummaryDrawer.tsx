import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Gem,
  Package,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sword,
  X,
} from 'lucide-react';
import type { Build, EquipmentSlotId, Item, ItemRarity, Locale } from '@webpob/core';
import { getLocalizedUniqueName, getRuleset } from '@webpob/data';
import { resolveItemEffectiveStats } from '@webpob/calc/lite';
import { getSlotLabel, normalizeStatLineToEn, toTraditionalZh, uiText } from '@webpob/i18n';
import { useWebPobStore } from '../store/useWebPobStore';

const RARITY_TEXT: Record<ItemRarity, string> = {
  NORMAL: 'text-zinc-200',
  MAGIC: 'text-blue-300',
  RARE: 'text-yellow-200',
  UNIQUE: 'text-orange-400',
};

const CORE_SLOTS: EquipmentSlotId[] = [
  'Weapon 1',
  'Body Armour',
  'Helmet',
  'Gloves',
  'Boots',
  'Belt',
  'Amulet',
  'Ring 1',
  'Ring 2',
];

interface GearTotals {
  armour: number;
  evasion: number;
  energyShield: number;
  ward: number;
  life: number;
  mana: number;
  spirit: number;
  fireRes: number;
  coldRes: number;
  lightningRes: number;
  chaosRes: number;
  strength: number;
  dexterity: number;
  intelligence: number;
  movementSpeed: number;
  gemLevelLines: string[];
  itemCount: number;
  activeSlots: number;
}

const EMPTY_TOTALS: GearTotals = {
  armour: 0,
  evasion: 0,
  energyShield: 0,
  ward: 0,
  life: 0,
  mana: 0,
  spirit: 0,
  fireRes: 0,
  coldRes: 0,
  lightningRes: 0,
  chaosRes: 0,
  strength: 0,
  dexterity: 0,
  intelligence: 0,
  movementSpeed: 0,
  gemLevelLines: [],
  itemCount: 0,
  activeSlots: 0,
};

function isArmourPiece(item: Item): boolean {
  return Boolean(item.armourStats) && !item.weaponStats;
}

const ZH_ELEMENT: Record<string, string> = {
  火焰: 'Fire',
  冰冷: 'Cold',
  冰霜: 'Cold',
  闪电: 'Lightning',
  混沌: 'Chaos',
};

function normalizeGearLine(rawLine: string): string {
  const cleaned = rawLine
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
  if (!cleaned) return '';
  const en = normalizeStatLineToEn(cleaned);
  if (!/[\u4e00-\u9fff]/.test(en)) return en;

  const sign = (v: string | undefined) => {
    if (!v) return '+0';
    return v.startsWith('-') ? v : `+${v.replace(/^\+/, '')}`;
  };

  let m = en.match(/^结界\s*\+?(\d+)$/);
  if (m) return `+${m[1]} to Ward`;
  m = en.match(/^护甲\s*\+?(\d+)$/);
  if (m) return `+${m[1]} to Armour`;
  m = en.match(/^闪避值?\s*\+?(\d+)$/);
  if (m) return `+${m[1]} to Evasion Rating`;
  m = en.match(/^移动速度\s*\+?([+-]?\d+)%$/);
  if (m) return `${m[1]}% increased Movement Speed`;
  m = en.match(/^(?:全部|所有)元素抗性\s*\+?([+-]?\d+)%$/);
  if (m) return `${sign(m[1])}% to all Elemental Resistances`;
  m = en.match(/^\+?([+-]?\d+)%\s*(?:全部|所有)元素抗性$/);
  if (m) return `${sign(m[1])}% to all Elemental Resistances`;

  const dual = en.match(
    /^\+?([+-]?\d+)%\s*(火焰|冰冷|冰霜|闪电|混沌)(?:与|和|、|\/)?(火焰|冰冷|冰霜|闪电|混沌)抗性$/,
  );
  if (dual) {
    const a = ZH_ELEMENT[dual[2]!];
    const b = ZH_ELEMENT[dual[3]!];
    if (a && b) return `${sign(dual[1]!)}% to ${a} and ${b} Resistances`;
  }

  const single = en.match(/^(?:\+?([+-]?\d+)%\s*(火焰|冰冷|冰霜|闪电|混沌)抗性|(火焰|冰冷|冰霜|闪电|混沌)抗性\s*\+?([+-]?\d+)%)$/);
  if (single) {
    const meta = ZH_ELEMENT[single[2] ?? single[3] ?? ''];
    const value = single[1] ?? single[4];
    if (meta && value) return `${sign(value)}% to ${meta} Resistance`;
  }
  return en;
}

function accumulateModLine(totals: GearTotals, rawLine: string) {
  const line = normalizeGearLine(rawLine);
  if (!line) return;

  let m = line.match(/^\+(\d+) to maximum Life$/i);
  if (m) { totals.life += Number(m[1]); return; }
  m = line.match(/^\+(\d+) to maximum Mana$/i);
  if (m) { totals.mana += Number(m[1]); return; }
  m = line.match(/^\+(\d+) to Spirit$/i);
  if (m) { totals.spirit += Number(m[1]); return; }

  m = line.match(/^\+(\d+) to Armour$/i);
  if (m) { totals.armour += Number(m[1]); return; }
  m = line.match(/^\+(\d+) to Evasion Rating$/i);
  if (m) { totals.evasion += Number(m[1]); return; }
  m = line.match(/^\+(\d+) to maximum Energy Shield$/i);
  if (m) { totals.energyShield += Number(m[1]); return; }
  m = line.match(/^\+(\d+) to Ward$/i);
  if (m) { totals.ward += Number(m[1]); return; }

  m = line.match(/^\+(\d+) to (Strength|Dexterity|Intelligence)$/i);
  if (m) {
    const value = Number(m[1]);
    if (m[2] === 'Strength') totals.strength += value;
    else if (m[2] === 'Dexterity') totals.dexterity += value;
    else totals.intelligence += value;
    return;
  }
  m = line.match(/^\+(\d+) to all Attributes$/i);
  if (m) {
    const value = Number(m[1]);
    totals.strength += value;
    totals.dexterity += value;
    totals.intelligence += value;
    return;
  }

  m = line.match(/^([+-]?\d+)% to all Elemental Resistances$/i);
  if (m) {
    const value = Number(m[1]);
    totals.fireRes += value;
    totals.coldRes += value;
    totals.lightningRes += value;
    return;
  }
  m = line.match(/^([+-]?\d+)% to (Fire|Cold|Lightning|Chaos) Resistance$/i);
  if (m) {
    const value = Number(m[1]);
    if (m[2] === 'Fire') totals.fireRes += value;
    else if (m[2] === 'Cold') totals.coldRes += value;
    else if (m[2] === 'Lightning') totals.lightningRes += value;
    else totals.chaosRes += value;
    return;
  }
  m = line.match(/^([+-]?\d+)% to (Fire|Cold|Lightning|Chaos) and (Fire|Cold|Lightning|Chaos) Resistances$/i);
  if (m) {
    const value = Number(m[1]);
    for (const el of [m[2], m[3]]) {
      if (el === 'Fire') totals.fireRes += value;
      else if (el === 'Cold') totals.coldRes += value;
      else if (el === 'Lightning') totals.lightningRes += value;
      else totals.chaosRes += value;
    }
    return;
  }

  m = line.match(/^(\d+)% increased Movement Speed$/i);
  if (m) { totals.movementSpeed += Number(m[1]); return; }

  if (/^\+\d+ to Level of /i.test(line)) {
    totals.gemLevelLines.push(line);
  }
}

function getActiveEquippedEntries(build: Build): Array<{ slot: EquipmentSlotId; item: Item }> {
  const ruleset = getRuleset(build.game);
  const out: Array<{ slot: EquipmentSlotId; item: Item }> = [];
  for (const slot of ruleset.equipmentSlots) {
    if (build.game === 'poe2') {
      if (build.activeWeaponSet === 1 && (slot === 'Weapon 1 Swap' || slot === 'Weapon 2 Swap')) continue;
      if (build.activeWeaponSet === 2 && (slot === 'Weapon 1' || slot === 'Weapon 2')) {
        const hasSwap = Boolean(build.equipped['Weapon 1 Swap'] || build.equipped['Weapon 2 Swap']);
        if (hasSwap) continue;
      }
    }
    if (slot.startsWith('Flask ') && !build.activeFlaskSlots?.[slot]) continue;
    if (slot.startsWith('Charm ') && !build.activeFlaskSlots?.[slot]) continue;
    const itemId = build.equipped[slot];
    const item = itemId ? build.items[itemId] : undefined;
    if (item) out.push({ slot, item });
  }
  return out;
}

function computeGearTotals(build: Build): GearTotals {
  const totals: GearTotals = { ...EMPTY_TOTALS, gemLevelLines: [] };
  const entries = getActiveEquippedEntries(build);
  totals.itemCount = entries.length;
  totals.activeSlots = getRuleset(build.game).equipmentSlots.filter(
    (slot) => !(build.game === 'poe2' && (slot === 'Weapon 1 Swap' || slot === 'Weapon 2 Swap')),
  ).length;

  for (const { item } of entries) {
    if (isArmourPiece(item)) {
      const resolved = resolveItemEffectiveStats(item, build.game);
      totals.armour += resolved.armourStats?.armour ?? 0;
      totals.evasion += resolved.armourStats?.evasion ?? 0;
      totals.energyShield += resolved.armourStats?.energyShield ?? 0;
      totals.ward += resolved.armourStats?.ward ?? 0;
      for (const line of resolved.globalImplicits) accumulateModLine(totals, line);
      for (const line of resolved.globalExplicits) accumulateModLine(totals, line);
    } else {
      for (const line of item.implicits) accumulateModLine(totals, line);
      for (const line of item.explicits) accumulateModLine(totals, line);
    }
  }
  return totals;
}

function slotCategory(slot: EquipmentSlotId): 'weapon' | 'armour' | 'accessory' | 'flask' | 'charm' {
  if (slot.startsWith('Weapon')) return 'weapon';
  if (slot === 'Helmet' || slot === 'Body Armour' || slot === 'Gloves' || slot === 'Boots') return 'armour';
  if (slot.startsWith('Flask ')) return 'flask';
  if (slot.startsWith('Charm ')) return 'charm';
  return 'accessory';
}

type TradeFilterId =
  | 'life'
  | 'eleRes'
  | 'chaosRes'
  | 'energyShield'
  | 'armour'
  | 'movementSpeed'
  | 'gemLevels'
  | 'dps'
  | 'attackSpeed';

interface TradeFilterState {
  enabled: boolean;
  value: number;
}

const TRADE_FILTER_DEFAULTS: Record<TradeFilterId, number> = {
  life: 70,
  eleRes: 60,
  chaosRes: 20,
  energyShield: 150,
  armour: 500,
  movementSpeed: 25,
  gemLevels: 1,
  dps: 300,
  attackSpeed: 1.5,
};

const TRADE_FILTER_LABELS: Record<TradeFilterId, { en: string; zh: string; unit: string }> = {
  life: { en: 'Min Life', zh: '最低生命', unit: '' },
  eleRes: { en: 'Min Total Ele Res', zh: '最低总元素抗', unit: '%' },
  chaosRes: { en: 'Min Chaos Res', zh: '最低混沌抗', unit: '%' },
  energyShield: { en: 'Min Energy Shield', zh: '最低能量护盾', unit: '' },
  armour: { en: 'Min Armour', zh: '最低护甲', unit: '' },
  movementSpeed: { en: 'Min Movement Speed', zh: '最低移动速度', unit: '%' },
  gemLevels: { en: 'Min Gem Levels', zh: '最低技能等级', unit: '' },
  dps: { en: 'Min DPS', zh: '最低 DPS', unit: '' },
  attackSpeed: { en: 'Min Attack Speed', zh: '最低攻击速度', unit: '' },
};

const WEAPON_SLOTS: EquipmentSlotId[] = ['Weapon 1', 'Weapon 2', 'Weapon 1 Swap', 'Weapon 2 Swap'];
const ARMOUR_SLOTS: EquipmentSlotId[] = ['Helmet', 'Body Armour', 'Gloves', 'Boots'];
const ACCESSORY_SLOTS: EquipmentSlotId[] = ['Amulet', 'Ring 1', 'Ring 2', 'Belt'];

function applicableFilters(slot: EquipmentSlotId): TradeFilterId[] {
  const list: TradeFilterId[] = ['life'];
  if (WEAPON_SLOTS.includes(slot)) {
    list.push('dps', 'attackSpeed', 'gemLevels');
  } else if (ARMOUR_SLOTS.includes(slot)) {
    list.push('eleRes', 'energyShield', 'armour', 'chaosRes');
    if (slot === 'Boots') list.push('movementSpeed');
  } else if (ACCESSORY_SLOTS.includes(slot)) {
    list.push('eleRes', 'chaosRes');
    if (slot === 'Amulet') list.push('gemLevels');
  } else {
    list.push('eleRes');
  }
  return list;
}

const TRADE_CATEGORY: Partial<Record<EquipmentSlotId, { poe1: string; poe2: string }>> = {
  Helmet: { poe1: 'armour.helmet', poe2: 'armour.helmet' },
  'Body Armour': { poe1: 'armour.chest', poe2: 'armour.chest' },
  Gloves: { poe1: 'armour.gloves', poe2: 'armour.gloves' },
  Boots: { poe1: 'armour.boots', poe2: 'armour.boots' },
  'Weapon 1': { poe1: 'weapon', poe2: 'weapon' },
  'Weapon 2': { poe1: 'weapon', poe2: 'weapon' },
  Amulet: { poe1: 'accessory.amulet', poe2: 'accessory.amulet' },
  'Ring 1': { poe1: 'accessory.ring', poe2: 'accessory.ring' },
  'Ring 2': { poe1: 'accessory.ring', poe2: 'accessory.ring' },
  Belt: { poe1: 'accessory.belt', poe2: 'accessory.belt' },
};

interface TradeStatRef {
  poe1?: string;
  poe2?: string;
}

const TRADE_STAT_IDS: Partial<Record<TradeFilterId, TradeStatRef>> = {
  life: { poe1: 'pseudo.pseudo_total_life', poe2: 'pseudo.pseudo_total_life' },
  eleRes: { poe1: 'pseudo.pseudo_total_elemental_resistance', poe2: 'pseudo.pseudo_total_elemental_resistance' },
  chaosRes: { poe1: 'pseudo.pseudo_total_chaos_resistance', poe2: 'pseudo.pseudo_total_chaos_resistance' },
  energyShield: { poe1: 'pseudo.pseudo_total_energy_shield', poe2: 'pseudo.pseudo_total_energy_shield' },
  movementSpeed: {
    poe1: 'pseudo.pseudo_increased_movement_speed',
    poe2: 'pseudo.pseudo_increased_movement_speed',
  },
  gemLevels: {
    poe1: 'pseudo.pseudo_total_additional_skill_gem_levels',
    poe2: 'explicit.stat_4283407333',
  },
};

interface TradeQueryPayload {
  query: {
    status: { option: 'online' };
    stats: Array<{ type: 'and'; filters: Array<{ id: string; value: { min: number }; disabled: boolean }> }>;
    filters: Record<string, unknown>;
  };
  sort: { price: 'asc' };
}

function buildTradeQuery(
  game: 'poe1' | 'poe2',
  slot: EquipmentSlotId,
  filters: Record<TradeFilterId, TradeFilterState>,
): TradeQueryPayload {
  const statFilters: Array<{ id: string; value: { min: number }; disabled: boolean }> = [];
  const extraFilters: Record<string, unknown> = {};

  const applicable = applicableFilters(slot);
  for (const [id, state] of Object.entries(filters) as Array<[TradeFilterId, TradeFilterState]>) {
    if (!state.enabled || state.value <= 0) continue;
    if (!applicable.includes(id)) continue;
    if (id === 'armour' || id === 'dps' || id === 'attackSpeed') {
      const group = game === 'poe2' ? 'equipment_filters' : id === 'armour' ? 'armour_filters' : 'weapon_filters';
      const key = id === 'armour' ? 'ar' : id === 'attackSpeed' ? 'aps' : 'dps';
      const groupObj = (extraFilters[group] ?? { filters: {} }) as { filters: Record<string, unknown> };
      groupObj.filters[key] = { min: state.value };
      extraFilters[group] = groupObj;
      continue;
    }
    const statId = TRADE_STAT_IDS[id]?.[game];
    if (!statId) continue;
    statFilters.push({ id: statId, value: { min: state.value }, disabled: false });
  }

  const category = TRADE_CATEGORY[slot];
  if (category) {
    const typeFilters = (extraFilters.type_filters ?? { filters: {} }) as { filters: Record<string, unknown> };
    typeFilters.filters.category = { option: game === 'poe2' ? category.poe2 : category.poe1 };
    extraFilters.type_filters = typeFilters;
  }

  return {
    query: {
      status: { option: 'online' },
      stats: [{ type: 'and', filters: statFilters }],
      filters: extraFilters,
    },
    sort: { price: 'asc' },
  };
}

function tradeUrl(game: 'poe1' | 'poe2', realm: 'intl' | 'cn', payload: TradeQueryPayload): string {
  const encoded = encodeURIComponent(JSON.stringify(payload));
  if (game === 'poe2') {
    return `https://www.pathofexile.com/trade2/search/poe2/Standard?q=${encoded}`;
  }
  if (realm === 'cn') {
    return `https://poe.game.qq.com/trade/search/Standard?q=${encoded}`;
  }
  return `https://www.pathofexile.com/trade/search/Standard?q=${encoded}`;
}

function StatCell({
  label,
  value,
  tone = 'zinc',
  suffix = '',
}: {
  label: string;
  value: number;
  tone?: 'zinc' | 'amber' | 'sky' | 'emerald' | 'rose' | 'violet';
  suffix?: string;
}) {
  const toneClass: Record<string, string> = {
    zinc: 'text-zinc-200',
    amber: 'text-amber-300',
    sky: 'text-sky-300',
    emerald: 'text-emerald-300',
    rose: 'text-rose-300',
    violet: 'text-violet-300',
  };
  return (
    <div className="rounded border border-[#242b3d] bg-[#0b0e15] px-2 py-1.5 min-w-0">
      <div className="text-[10px] text-zinc-500 truncate">{label}</div>
      <div className={`font-mono text-sm font-semibold ${toneClass[tone] ?? toneClass.zinc}`}>
        {value.toLocaleString()}
        {suffix}
      </div>
    </div>
  );
}

function quickStatPill(item: Item, locale: Locale): string | null {
  if (item.weaponStats) {
    const dps = ((item.weaponStats.physicalMin + item.weaponStats.physicalMax) / 2) * item.weaponStats.attacksPerSecond;
    return `${Math.round(dps)} pDPS · ${item.weaponStats.attacksPerSecond.toFixed(2)} APS`;
  }
  if (item.armourStats) {
    const parts: string[] = [];
    if (item.armourStats.energyShield) parts.push(`ES ${item.armourStats.energyShield}`);
    if (item.armourStats.armour) parts.push(`AR ${item.armourStats.armour}`);
    if (item.armourStats.evasion) parts.push(`EV ${item.armourStats.evasion}`);
    if (item.armourStats.ward) parts.push(`${uiText(locale, '结界', 'Ward')} ${item.armourStats.ward}`);
    if (parts.length > 0) return parts.slice(0, 2).join(' · ');
  }
  const line = [...item.implicits, ...item.explicits]
    .map((l) => normalizeStatLineToEn(l))
    .find((l) => /maximum Life|Resistance|Attributes|maximum Mana|Spirit/i.test(l));
  return line ?? null;
}

export function GearSummaryDrawer({
  open,
  onClose,
  selectedSlot,
  onSelectSlot,
}: {
  open: boolean;
  onClose: () => void;
  selectedSlot: EquipmentSlotId;
  onSelectSlot: (slot: EquipmentSlotId) => void;
}) {
  const { locale, build } = useWebPobStore();
  const cn = locale !== 'en';
  const l = (zh: string, en: string) => uiText(locale, zh, en);

  const [tradeSlot, setTradeSlot] = useState<EquipmentSlotId>(selectedSlot);
  const [tradeOpen, setTradeOpen] = useState(true);
  const [filters, setFilters] = useState<Record<TradeFilterId, TradeFilterState>>(() => {
    const init = {} as Record<TradeFilterId, TradeFilterState>;
    for (const id of Object.keys(TRADE_FILTER_DEFAULTS) as TradeFilterId[]) {
      init[id] = { enabled: false, value: TRADE_FILTER_DEFAULTS[id] };
    }
    return init;
  });
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (open) setTradeSlot(selectedSlot);
  }, [open, selectedSlot]);

  const totals = useMemo(() => computeGearTotals(build), [build]);
  const ruleset = getRuleset(build.game);
  const activeSlot = tradeSlot;

  const applicable = applicableFilters(activeSlot);
  const payload = useMemo(() => buildTradeQuery(build.game, activeSlot, filters), [build.game, activeSlot, filters]);
  const urls = useMemo(
    () => ({
      intl: tradeUrl(build.game, 'intl', payload),
      cn: tradeUrl(build.game, 'cn', payload),
    }),
    [build.game, payload],
  );

  const selectedFilters = useMemo(
    () =>
      (Object.entries(filters) as Array<[TradeFilterId, TradeFilterState]>).filter(
        ([id, state]) => state.enabled && state.value > 0 && applicable.includes(id),
      ),
    [filters, applicable],
  );

  if (!open) return null;

  const missingCore = CORE_SLOTS.filter((slot) => !build.equipped[slot]);

  const copyUrl = async (url: string, key: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(key);
      setTimeout(() => setCopiedUrl((cur) => (cur === key ? null : cur)), 1500);
    } catch {
      // ignore clipboard failures
    }
  };

  const updateFilter = (id: TradeFilterId, patch: Partial<TradeFilterState>) => {
    setFilters((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/55" onClick={onClose}>
      <div
        className="bg-[#0f131e] border-l border-[#2a3147] w-full max-w-xl h-full flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#252b3d] bg-[#121622] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Package className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-bold text-amber-200 truncate">
                {l('装备汇总', 'Gear Totals')}
              </div>
              <div className="text-[11px] text-zinc-400">
                {l('仅统计当前已装备物品的纯贡献', 'Pure contribution of currently equipped items')}
                {' · '}
                <span className="font-mono text-emerald-300">
                  {totals.itemCount}/{totals.activeSlots}
                </span>
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

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Missing slot alerts */}
          {missingCore.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-200">
                <AlertTriangle className="w-3.5 h-3.5" />
                {l(`核心槽位空缺 (${missingCore.length})`, `Missing core slots (${missingCore.length})`)}
              </div>
              <div className="flex flex-wrap gap-1">
                {missingCore.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => onSelectSlot(slot)}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/40 cursor-pointer"
                  >
                    {getSlotLabel(locale, slot)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Defences */}
          <section className="rounded-lg border border-[#2a3147] bg-[#0b0e16] p-3 space-y-2">
            <h3 className="text-[11px] font-bold text-sky-300 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              {l('装备防御', 'Defences from Gear')}
            </h3>
            <div className="grid grid-cols-4 gap-1.5">
              <StatCell label={l('护甲', 'Armour')} value={totals.armour} tone="amber" />
              <StatCell label={l('闪避', 'Evasion')} value={totals.evasion} tone="emerald" />
              <StatCell label={l('能量护盾', 'Energy Shield')} value={totals.energyShield} tone="sky" />
              <StatCell label={l('结界', 'Ward')} value={totals.ward} tone="violet" />
            </div>
          </section>

          {/* Pools & Resistances */}
          <section className="rounded-lg border border-[#2a3147] bg-[#0b0e16] p-3 space-y-2">
            <h3 className="text-[11px] font-bold text-rose-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              {l('核心池 & 抗性', 'Core Pools & Resistances')}
            </h3>
            <div className="grid grid-cols-4 gap-1.5">
              <StatCell label={l('最大生命', 'Max Life')} value={totals.life} tone="rose" />
              <StatCell label={l('最大魔力', 'Max Mana')} value={totals.mana} tone="sky" />
              {build.game === 'poe2' && (
                <StatCell label={l('精魂', 'Spirit')} value={totals.spirit} tone="violet" />
              )}
              <StatCell label={l('移动速度', 'Move Speed')} value={totals.movementSpeed} tone="emerald" suffix="%" />
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <StatCell label={l('火焰抗', 'Fire Res')} value={totals.fireRes} tone="rose" suffix="%" />
              <StatCell label={l('冰霜抗', 'Cold Res')} value={totals.coldRes} tone="sky" suffix="%" />
              <StatCell label={l('闪电抗', 'Lightning Res')} value={totals.lightningRes} tone="amber" suffix="%" />
              <StatCell label={l('混沌抗', 'Chaos Res')} value={totals.chaosRes} tone="violet" suffix="%" />
            </div>
          </section>

          {/* Attributes & Gem Levels */}
          <section className="rounded-lg border border-[#2a3147] bg-[#0b0e16] p-3 space-y-2">
            <h3 className="text-[11px] font-bold text-emerald-300 flex items-center gap-1.5">
              <Gem className="w-3.5 h-3.5" />
              {l('属性 & 技能等级', 'Attributes & Gem Levels')}
            </h3>
            <div className="grid grid-cols-3 gap-1.5">
              <StatCell label={l('力量', 'Strength')} value={totals.strength} tone="rose" />
              <StatCell label={l('敏捷', 'Dexterity')} value={totals.dexterity} tone="emerald" />
              <StatCell label={l('智慧', 'Intelligence')} value={totals.intelligence} tone="sky" />
            </div>
            <div className="space-y-0.5">
              {totals.gemLevelLines.length === 0 ? (
                <div className="text-[11px] text-zinc-500 italic">
                  {l('装备未提供技能等级加成', 'No gem level modifiers from gear')}
                </div>
              ) : (
                totals.gemLevelLines.map((line, i) => (
                  <div key={`gl-${i}`} className="text-[11px] font-mono text-cyan-200">
                    {line}
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Per-slot quick table */}
          <section className="rounded-lg border border-[#2a3147] bg-[#0b0e16] p-3 space-y-1.5">
            <h3 className="text-[11px] font-bold text-amber-300 flex items-center gap-1.5">
              <Sword className="w-3.5 h-3.5" />
              {l('逐槽位概览', 'Per-Slot Overview')}
            </h3>
            <div className="space-y-1">
              {ruleset.equipmentSlots.map((slot) => {
                const itemId = build.equipped[slot];
                const item = itemId ? build.items[itemId] : undefined;
                const isMissingCore = !item && CORE_SLOTS.includes(slot);
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => {
                      onSelectSlot(slot);
                      setTradeSlot(slot);
                    }}
                    className={`w-full flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs border transition cursor-pointer ${
                      selectedSlot === slot
                        ? 'bg-[#191e2c] border-amber-500/60'
                        : isMissingCore
                          ? 'bg-amber-500/5 border-amber-500/25 hover:border-amber-500/45'
                          : 'bg-[#0c0e15] border-[#212738] hover:border-[#2f3850]'
                    }`}
                  >
                    <span className="text-[10px] text-zinc-400 shrink-0 w-20 truncate">
                      {getSlotLabel(locale, slot)}
                    </span>
                    <span className="flex-1 min-w-0 truncate">
                      {item ? (
                        <span className={`font-semibold ${RARITY_TEXT[item.rarity]}`}>
                          {locale === 'zh-TW'
                            ? item.nameZhTw || getLocalizedUniqueName(item.name, 'zh-TW', build.game, item.nameZh ? toTraditionalZh(item.nameZh) : undefined)
                            : cn && item.nameZh
                              ? item.nameZh
                              : item.name}
                        </span>
                      ) : (
                        <span className={isMissingCore ? 'text-amber-300/80 italic' : 'text-zinc-600 italic'}>
                          {isMissingCore ? l('空缺', 'Missing') : l('空槽位', 'Empty')}
                        </span>
                      )}
                    </span>
                    {item && (
                      <span className="text-[10px] font-mono text-zinc-400 shrink-0 max-w-[9rem] truncate">
                        {quickStatPill(item, locale)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Smart trade search builder */}
          <section className="rounded-lg border border-sky-500/35 bg-[#0a1119] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setTradeOpen((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] font-bold text-sky-200 cursor-pointer"
              >
                {tradeOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <SlidersHorizontal className="w-3.5 h-3.5" />
                {l('市集升级搜索', 'Trade Upgrade Search')}
              </button>
              <select
                value={tradeSlot}
                onChange={(e) => setTradeSlot(e.target.value as EquipmentSlotId)}
                className="pob-input rounded px-2 py-0.5 text-[11px]"
              >
                {ruleset.equipmentSlots.map((slot) => (
                  <option key={slot} value={slot}>
                    {getSlotLabel(locale, slot)}
                  </option>
                ))}
              </select>
            </div>

            {tradeOpen && (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {applicable.map((id) => {
                    const state = filters[id];
                    const meta = TRADE_FILTER_LABELS[id];
                    return (
                      <div
                        key={id}
                        className={`flex items-center gap-1.5 rounded border px-1.5 py-1 text-[11px] ${
                          state.enabled
                            ? 'bg-sky-500/10 border-sky-500/40'
                            : 'bg-[#0c0e15] border-[#212738]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={state.enabled}
                          onChange={(e) => updateFilter(id, { enabled: e.target.checked })}
                          className="accent-sky-400 w-3.5 h-3.5 cursor-pointer shrink-0"
                        />
                        <span className="flex-1 min-w-0 truncate text-zinc-300">
                          {cn ? meta.zh : meta.en}
                        </span>
                        <input
                          type="number"
                          min={0}
                          step={id === 'attackSpeed' ? 0.05 : 1}
                          value={state.value}
                          disabled={!state.enabled}
                          onChange={(e) => updateFilter(id, { value: Math.max(0, Number(e.target.value) || 0) })}
                          className="pob-input rounded w-16 px-1 py-0.5 text-center font-mono text-[11px] disabled:opacity-40"
                        />
                        {meta.unit && <span className="text-[10px] text-zinc-500">{meta.unit}</span>}
                      </div>
                    );
                  })}
                </div>

                {selectedFilters.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedFilters.map(([id, state]) => (
                      <span
                        key={`chip-${id}`}
                        className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-sky-500/15 text-sky-200 border border-sky-500/35"
                      >
                        {cn ? TRADE_FILTER_LABELS[id].zh : TRADE_FILTER_LABELS[id].en}
                        {' ≥ '}
                        {state.value}
                        {TRADE_FILTER_LABELS[id].unit}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {(build.game === 'poe1'
                    ? ([
                        ['intl', 'PoE 1 国际服', 'PoE 1 Intl', urls.intl],
                        ['cn', 'PoE 1 国服', 'PoE 1 Tencent CN', urls.cn],
                      ] as const)
                    : ([['intl', 'PoE 2 国际服', 'PoE 2 Intl', urls.intl]] as const)
                  ).map(([key, labelZh, labelEn, url]) => (
                    <div key={key} className="flex items-center gap-1">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 border border-sky-500/45"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {cn ? labelZh : labelEn}
                      </a>
                      <button
                        type="button"
                        onClick={() => void copyUrl(url, key)}
                        className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] bg-[#161c2b] hover:bg-[#1e263a] text-zinc-300 border border-[#2a3147] cursor-pointer"
                        title={cn ? '复制查询 URL' : 'Copy query URL'}
                      >
                        {copiedUrl === key ? (
                          <Check className="w-3 h-3 text-emerald-300" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        {copiedUrl === key ? (cn ? '已复制' : 'Copied') : cn ? '复制' : 'Copy'}
                      </button>
                    </div>
                  ))}
                </div>

                <details className="rounded border border-[#212738] bg-[#080b11] px-2 py-1.5">
                  <summary className="text-[10px] text-zinc-400 cursor-pointer">
                    {l('查看查询 JSON', 'View query JSON')}
                  </summary>
                  <pre className="mt-1.5 text-[10px] font-mono text-zinc-400 overflow-auto max-h-40 whitespace-pre-wrap break-all">
                    {JSON.stringify(payload, null, 2)}
                  </pre>
                </details>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
