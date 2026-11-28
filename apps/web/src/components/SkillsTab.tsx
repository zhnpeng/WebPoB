import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Copy, Gauge, Plus, Search, Sparkles, Star, Trash2, X, Zap } from 'lucide-react';
import type { EquipmentSlotId, GemDefinition, Locale, WeaponSetId } from '@webpob/core';
import { getGemsForGame, getRuleset } from '@webpob/data';
import type { RankedSupportRecommendation } from '@webpob/calc';
import { getSlotLabel, isChineseLocale, localizeStatLine, localizeText, t, uiText } from '@webpob/i18n';
import { useWebPobStore } from '../store/useWebPobStore';
import { searchGemsCatalog, type GemCategoryFilter } from '../utils/gemSearch';
import { calculateBatchInWorker, rankSupportGemsInWorker } from '../workers/calcWorkerClient';

const GEM_COLOR_BADGE: Record<string, string> = {
  red: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  green: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  blue: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  white: 'bg-zinc-200/20 text-zinc-100 border-zinc-400/40',
};

const FULL_DPS_SHARE_COLORS = [
  '#f59e0b',
  '#34d399',
  '#38bdf8',
  '#f472b6',
  '#a78bfa',
  '#fb923c',
  '#22d3ee',
  '#facc15',
] as const;

type GemPreset = '20/20' | '21/20' | 'q0';

function formatDps(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

const GEM_TAG_NOISE = new Set([
  'strength',
  'dexterity',
  'intelligence',
  'grants_active_skill',
  'support',
]);

function displayGemTags(tags: string[]): string[] {
  return tags.filter((tag) => !GEM_TAG_NOISE.has(tag.toLowerCase())).slice(0, 3);
}

interface GemSearchPickerProps {
  gemsCatalog: GemDefinition[];
  locale: Locale;
  globalQuery: string;
  hasActiveGem: boolean;
  onSelectGem: (gemId: string) => void;
}

function GemSearchPicker({
  gemsCatalog,
  locale,
  globalQuery,
  hasActiveGem,
  onSelectGem,
}: GemSearchPickerProps) {
  const [open, setOpen] = useState(false);
  const [localQuery, setLocalQuery] = useState('');
  const [category, setCategory] = useState<GemCategoryFilter>(hasActiveGem ? 'all' : 'active');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const effectiveQuery = localQuery.trim() ? localQuery : globalQuery;

  const result = useMemo(
    () =>
      searchGemsCatalog(gemsCatalog, effectiveQuery, {
        category,
        locale,
        limit: 80,
        preferActive: !hasActiveGem,
      }),
    [gemsCatalog, effectiveQuery, category, locale, hasActiveGem],
  );

  // If current category has 0 hits while the other category does have hits, keep tabs visible so user can click right away
  useEffect(() => {
    setHighlightIdx(0);
  }, [effectiveQuery, category, open]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const handlePick = (gem: GemDefinition) => {
    onSelectGem(gem.id);
    setLocalQuery('');
    // After adding the first active skill, switch default tab to 'all' so adding supports right after is 1-click
    if (gem.category === 'active' && category === 'active') {
      setCategory('all');
    }
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex-1 min-w-0">
      <div className="relative flex items-center">
        <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={localQuery}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setLocalQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              inputRef.current?.blur();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              if (!open) setOpen(true);
              setHighlightIdx((i) => Math.min(Math.max(0, result.items.length - 1), i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlightIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && open && result.items.length > 0) {
              e.preventDefault();
              const picked = result.items[highlightIdx] ?? result.items[0];
              if (picked) handlePick(picked);
            }
          }}
          placeholder={
            uiText(locale, '+ 搜索主动 / 辅助技能（中/英文/标签）...', '+ Search active / support gems (name / tag)...')
          }
          className="pob-input w-full min-w-0 rounded pl-8 pr-12 py-1.5 text-xs"
        />
        <div className="absolute right-1.5 flex items-center gap-0.5">
          {localQuery && (
            <button
              type="button"
              onClick={() => {
                setLocalQuery('');
                inputRef.current?.focus();
              }}
              aria-label={uiText(locale, '清空搜索', 'Clear search')}
              className="p-0.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen((v) => !v);
              if (!open) inputRef.current?.focus();
            }}
            aria-label={uiText(locale, '展开技能列表', 'Toggle gem list')}
            className="p-0.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-[#2c3550] bg-[#0b0e17] shadow-2xl overflow-hidden">
          {/* Category Filter Header */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 px-2 py-1.5 border-b border-[#1f2638] bg-[#101423]">
            <div className="flex items-center gap-1">
              {(
                [
                  {
                    id: 'all' as GemCategoryFilter,
                    label: uiText(locale, '全部', 'All'),
                    count: result.totalActive + result.totalSupport,
                  },
                  {
                    id: 'active' as GemCategoryFilter,
                    label: uiText(locale, '主动', 'Active'),
                    count: result.totalActive,
                  },
                  {
                    id: 'support' as GemCategoryFilter,
                    label: uiText(locale, '辅助', 'Support'),
                    count: result.totalSupport,
                  },
                ]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setCategory(tab.id)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                    category === tab.id
                      ? 'bg-amber-500/25 text-amber-200 border border-amber-500/50'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#192033] border border-transparent'
                  }`}
                >
                  {tab.label}
                  <span className="ml-1 text-[10px] font-mono opacity-75">{tab.count}</span>
                </button>
              ))}
            </div>
            {globalQuery.trim() && !localQuery.trim() && (
              <span className="text-[10px] text-amber-300/80 truncate max-w-[10rem]">
                {uiText(locale, `顶部过滤: ${globalQuery.trim()}`, `Filter: ${globalQuery.trim()}`)}
              </span>
            )}
          </div>

          {/* Results List */}
          <div className="max-h-64 overflow-y-auto divide-y divide-[#171c2b]">
            {result.items.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-zinc-400 space-y-1.5">
                <div>
                  {uiText(locale, '未找到匹配的技能宝石，可尝试中文名、英文名或标签（如 火焰 / 法术 / spell）', 'No matching gems found. Try EN/ZH name or tags (e.g. fire, spell).')}
                </div>
                {category !== 'all' && result.totalActive + result.totalSupport > 0 && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setCategory('all')}
                    className="text-amber-300 hover:underline text-[11px] cursor-pointer"
                  >
                    {uiText(locale, `在「全部」中查看 ${result.totalActive + result.totalSupport} 个结果`, `Show ${result.totalActive + result.totalSupport} matches in All`)}
                  </button>
                )}
              </div>
            ) : (
              result.items.map((gem, idx) => {
                const isHighlighted = idx === highlightIdx;
                const primaryName = localizeText(gem.name, locale);
                const secondaryName = isChineseLocale(locale) ? gem.name.en : gem.name.zh;
                const tags = displayGemTags(gem.tags);
                return (
                  <button
                    key={gem.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    onClick={() => handlePick(gem)}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs transition cursor-pointer ${
                      isHighlighted ? 'bg-[#1a2238] text-amber-100' : 'hover:bg-[#141a2b] text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold uppercase shrink-0 ${
                          GEM_COLOR_BADGE[gem.color] ?? GEM_COLOR_BADGE.white
                        }`}
                      >
                        {gem.category === 'active' ? (gem.isAuraOrBuff ? 'BUFF' : 'ACT') : 'SUP'}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {primaryName}
                          {secondaryName && secondaryName !== primaryName && (
                            <span className="ml-1.5 text-[10px] text-zinc-400 font-normal">
                              {secondaryName}
                            </span>
                          )}
                        </div>
                        {tags.length > 0 && (
                          <div className="text-[10px] text-zinc-500 font-mono truncate">
                            {tags.join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>
                    <Plus className="w-3.5 h-3.5 text-amber-300/70 shrink-0" />
                  </button>
                );
              })
            )}
          </div>

          {result.totalMatched > result.items.length && (
            <div className="px-2.5 py-1 border-t border-[#1f2638] bg-[#0e121f] text-[10px] text-zinc-400 text-center">
              {uiText(locale, `已显示前 ${result.items.length} / ${result.totalMatched} 颗，继续输入关键词快速定位`, `Showing top ${result.items.length} of ${result.totalMatched} gems — type to narrow down`)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SkillsTab() {
  const {
    locale,
    build,
    calc,
    treeRevision,
    setMainSkillGroup,
    addSkillGroup,
    removeSkillGroup,
    toggleSkillGroup,
    updateSkillGroup,
    addGemToGroup,
    removeGemFromGroup,
    updateGem,
    switchSkillSet,
    addSkillSet,
    deleteSkillSet,
  } = useWebPobStore();

  const skillSets =
    build.skillSets && build.skillSets.length > 0
      ? build.skillSets
      : [{ id: '1', title: 'Default', skills: build.skills, mainSkillGroupId: build.mainSkillGroupId }];
  const activeSkillSetIndex = Math.max(
    0,
    Math.min(skillSets.length - 1, build.activeSkillSetIndex ?? 0),
  );

  const [gemSearch, setGemSearch] = useState('');
  const [optimizerGroupId, setOptimizerGroupId] = useState<string | null>(null);
  void treeRevision;

  const [rankedSupports, setRankedSupports] = useState<RankedSupportRecommendation[]>([]);
  useEffect(() => {
    if (!optimizerGroupId) {
      setRankedSupports([]);
      return;
    }
    let cancelled = false;
    void rankSupportGemsInWorker(build, optimizerGroupId, 8, locale)
      .then((items) => {
        if (!cancelled) setRankedSupports(items);
      })
      .catch(() => {
        if (!cancelled) setRankedSupports([]);
      });
    return () => {
      cancelled = true;
    };
  }, [build, optimizerGroupId, locale]);

  const gemsCatalog = getGemsForGame(build.game);

  // Live standalone DPS per skill group (evaluates each group in background Web Worker)
  const [groupDps, setGroupDps] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    const batch: Array<{ key: string; build: typeof build }> = [];
    for (const group of build.skills) {
      if (!group.enabled) continue;
      const hasActive = group.gems.some((gi) => {
        if (!gi.enabled) return false;
        const def = gemsCatalog.find((g) => g.id === gi.gemId);
        return Boolean(def && def.category === 'active' && !def.isAuraOrBuff);
      });
      if (!hasActive) continue;
      batch.push({ key: group.id, build: { ...build, mainSkillGroupId: group.id } });
    }
    if (batch.length === 0) {
      setGroupDps(new Map());
      return;
    }
    let cancelled = false;
    void calculateBatchInWorker(batch, locale)
      .then((outputs) => {
        if (cancelled) return;
        const nextMap = new Map<string, number>();
        for (const [groupId, out] of Object.entries(outputs)) {
          nextMap.set(groupId, out.offence.totalDps);
        }
        setGroupDps(nextMap);
      })
      .catch(() => {
        if (!cancelled) setGroupDps(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [build, gemsCatalog, locale]);

  const fullDpsBreakdown = useMemo(() => {
    const fullDps = calc.offence.fullDps ?? 0;
    const breakdown = calc.offence.fullDpsBreakdown ?? [];
    if (fullDps <= 0 || breakdown.length === 0) return null;
    const rows = [...breakdown]
      .filter((row) => row.dps > 0)
      .sort((a, b) => b.dps - a.dps)
      .map((row, index) => ({
        ...row,
        sharePct: fullDps > 0 ? (row.dps / fullDps) * 100 : 0,
        color: FULL_DPS_SHARE_COLORS[index % FULL_DPS_SHARE_COLORS.length]!,
      }));
    if (rows.length === 0) return null;
    return { fullDps, rows };
  }, [calc]);

  const applyGemPreset = (groupId: string, preset: GemPreset) => {
    const target = build.skills.find((g) => g.id === groupId);
    if (!target) return;
    for (const gemInst of target.gems) {
      const def = gemsCatalog.find((g) => g.id === gemInst.gemId);
      const isActive = def?.category === 'active';
      if (preset === '20/20') {
        updateGem(groupId, gemInst.instanceId, { level: 20, quality: 20 });
      } else if (preset === '21/20') {
        updateGem(groupId, gemInst.instanceId, {
          level: isActive ? 21 : 20,
          quality: 20,
        });
      } else {
        updateGem(groupId, gemInst.instanceId, { quality: 0 });
      }
    }
  };

  const ruleset = getRuleset(build.game);
  const socketableSlots: EquipmentSlotId[] = ruleset.equipmentSlots.filter(
    (s) => !s.startsWith('Flask') && !s.startsWith('Charm') && !s.startsWith('Ring') && s !== 'Amulet' && s !== 'Belt',
  );

  const toggleWeaponSet = (groupId: string, current: WeaponSetId[] | undefined, ws: WeaponSetId) => {
    const list = current ?? [1, 2];
    const next = list.includes(ws) ? list.filter((x) => x !== ws) : [...list, ws];
    updateSkillGroup(groupId, { weaponSets: next.length > 0 ? next : [ws] });
  };

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-5 pb-32 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-amber-200">{t(locale, 'skills.title')}</h2>
          <span className="text-[11px] font-mono text-zinc-400">
            {gemsCatalog.length} {uiText(locale, '颗官方技能宝石', 'official gems')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Multi-SkillSet Switcher */}
          <div className="flex items-center gap-1 rounded bg-[#0c0f18] border border-[#262d42] px-2 py-1 text-xs">
            <span className="text-[10px] text-zinc-400">
              {uiText(locale, '技能方案:', 'Skill Set:')}
            </span>
            <select
              value={activeSkillSetIndex}
              onChange={(e) => switchSkillSet(Number(e.target.value))}
              className="pob-input rounded px-1.5 py-0.5 text-xs"
            >
              {skillSets.map((ss, idx) => (
                <option key={ss.id || idx} value={idx}>
                  {ss.title || `Set ${idx + 1}`}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                addSkillSet(
                  uiText(locale, `方案 ${skillSets.length + 1}`, `Set ${skillSets.length + 1}`),
                  true,
                )
              }
              title={uiText(locale, '克隆当前技能组为新方案', 'Clone current skills into new Skill Set')}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#181e2f] hover:bg-[#232b42] text-amber-200 border border-[#2b344d] text-[11px] cursor-pointer"
            >
              <Copy className="w-3 h-3" />
              <span>{uiText(locale, '克隆', 'Clone')}</span>
            </button>
            {skillSets.length > 1 && (
              <button
                type="button"
                onClick={() => deleteSkillSet(activeSkillSetIndex)}
                title={uiText(locale, '删除当前技能方案', 'Delete active Skill Set')}
                className="p-0.5 rounded text-zinc-400 hover:text-rose-400 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="relative w-full sm:w-auto">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={gemSearch}
              onChange={(e) => setGemSearch(e.target.value)}
              placeholder={uiText(locale, '全局预过滤宝石（中/英文/标签）...', 'Global gem filter (EN/ZH/tag)...')}
              className="pob-input rounded pl-8 pr-7 py-1 text-xs w-full sm:w-56"
            />
            {gemSearch && (
              <button
                type="button"
                onClick={() => setGemSearch('')}
                aria-label={uiText(locale, '清空全局过滤', 'Clear global filter')}
                className="p-0.5 text-zinc-400 hover:text-zinc-200 absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={addSkillGroup}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            {t(locale, 'skills.addGroup')}
          </button>
        </div>
      </div>

      {fullDpsBreakdown && (
        <div className="rounded-lg border border-emerald-500/30 bg-[#0b1310] px-3 py-2.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-200">
              <Gauge className="w-3.5 h-3.5 text-emerald-400" />
              {uiText(locale, '全技能总 DPS 贡献 (Full DPS Breakdown)', 'Full DPS Breakdown')}
              <span className="text-[10px] font-mono font-normal text-emerald-300/70">
                {fullDpsBreakdown.rows.length} {uiText(locale, '组', 'groups')}
              </span>
            </div>
            <span className="font-mono text-[11px] font-bold text-emerald-300">
              {formatDps(fullDpsBreakdown.fullDps)} <span className="text-[10px] font-normal text-emerald-300/70">Full DPS</span>
            </span>
          </div>
          {/* Stacked proportional share bar */}
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#0f1720] border border-[#1d2a26]">
            {fullDpsBreakdown.rows.map((row) => (
              <div
                key={`share-${row.groupId}`}
                style={{ width: `${Math.max(0.5, row.sharePct)}%`, backgroundColor: row.color }}
                title={`${row.label}: ${formatDps(row.dps)} DPS (${row.sharePct.toFixed(1)}%)`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {fullDpsBreakdown.rows.map((row) => (
              <div key={`legend-${row.groupId}`} className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-2 h-2 rounded-sm shrink-0"
                  style={{ backgroundColor: row.color }}
                />
                <span className="text-[11px] text-zinc-300 truncate max-w-[9rem]" title={row.label}>
                  {row.label}
                  {row.count > 1 && <span className="text-[10px] text-zinc-500"> ×{row.count}</span>}
                </span>
                <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                  {formatDps(row.dps)}
                </span>
                <span className="text-[10px] font-mono font-semibold shrink-0" style={{ color: row.color }}>
                  {row.sharePct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {build.skills.map((group) => {
          const isMain = group.id === build.mainSkillGroupId;
          return (
            <div
              key={group.id}
              className={`pob-panel rounded-lg p-4 space-y-3 ${
                isMain ? 'ring-1 ring-amber-500/60' : ''
              }`}
            >
              {/* Group Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#242a3c] pb-2.5">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={group.enabled}
                    onChange={() => toggleSkillGroup(group.id)}
                    className="accent-amber-500 w-4 h-4 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={group.label}
                    onChange={(e) => updateSkillGroup(group.id, { label: e.target.value })}
                    className="pob-input rounded px-2 py-1 text-xs font-semibold w-44"
                  />
                  {(() => {
                    const dps = groupDps.get(group.id);
                    if (dps === undefined) return null;
                    const fullDps = calc.offence.fullDps ?? 0;
                    const contrib = calc.offence.fullDpsBreakdown?.find(
                      (row) => row.groupId === group.id,
                    );
                    const contributingGroups = calc.offence.fullDpsBreakdown?.length ?? 0;
                    const share =
                      group.includeInFullDps &&
                      fullDps > 0 &&
                      contrib &&
                      contributingGroups > 1
                        ? (contrib.dps / fullDps) * 100
                        : null;
                    const tone = group.enabled
                      ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200'
                      : 'bg-zinc-800/40 border-zinc-700 text-zinc-400';
                    return (
                      <div
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-mono shrink-0 ${tone}`}
                        title={
                          uiText(locale, '该技能组独立计算的总 DPS', 'Standalone total DPS for this skill group')
                        }
                      >
                        <Zap className="w-3 h-3 opacity-80" />
                        <span className="font-bold">{formatDps(dps)}</span>
                        <span className="text-[9px] opacity-70">DPS</span>
                        {share !== null && (
                          <span className="ml-0.5 pl-1 border-l border-current/30 text-[10px] font-semibold text-amber-200">
                            {share.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="flex items-center gap-2">
                  {(() => {
                    const activeInGroup = group.gems
                      .filter((gi) => gi.enabled)
                      .map((gi) => ({ gi, def: gemsCatalog.find((g) => g.id === gi.gemId) }))
                      .filter((x) => x.def && x.def.category === 'active' && !x.def.isAuraOrBuff);
                    if (activeInGroup.length < 2) return null;
                    return (
                      <select
                        value={group.mainActiveSkillIndex ?? 1}
                        onChange={(e) =>
                          updateSkillGroup(group.id, { mainActiveSkillIndex: Number(e.target.value) || 1 })
                        }
                        title={uiText(locale, '选择本组主计算主动技能（如 CoC 法术）', 'Active skill to calculate (e.g. CoC spell)')}
                        className="pob-input rounded px-2 py-1 text-xs text-cyan-200 border-cyan-500/40"
                      >
                        {activeInGroup.map((item, idx) => (
                          <option key={item.gi.instanceId} value={idx + 1}>
                            #{idx + 1} {localizeText(item.def!.name, locale)}
                          </option>
                        ))}
                      </select>
                    );
                  })()}
                  {build.game === 'poe1' ? (
                    <select
                      value={group.slot ?? 'Body Armour'}
                      onChange={(e) =>
                        updateSkillGroup(group.id, { slot: e.target.value as EquipmentSlotId })
                      }
                      className="pob-input rounded px-2 py-1 text-xs"
                    >
                      {socketableSlots.map((s) => (
                        <option key={s} value={s}>
                          {getSlotLabel(locale, s)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-zinc-400">{t(locale, 'skills.weaponSets')}:</span>
                      {([1, 2] as const).map((ws) => {
                        const active = (group.weaponSets ?? [1, 2]).includes(ws);
                        return (
                          <button
                            key={ws}
                            type="button"
                            onClick={() => toggleWeaponSet(group.id, group.weaponSets, ws)}
                            className={`px-2 py-0.5 rounded font-semibold cursor-pointer ${
                              active
                                ? ws === 1
                                  ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40'
                                  : 'bg-fuchsia-500/25 text-fuchsia-200 border border-fuchsia-400/40'
                                : 'bg-[#0b0d14] text-zinc-500 border border-[#252b3d]'
                            }`}
                          >
                            {ws === 1 ? 'I' : 'II'}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      updateSkillGroup(group.id, { includeInFullDps: !group.includeInFullDps })
                    }
                    title={
                      uiText(locale, '计入全技能总 DPS（Full DPS，适合多图腾/召唤物/多技能并联）', 'Include this skill group in Full DPS aggregation')
                    }
                    className={`px-2 py-1 rounded text-xs cursor-pointer border transition ${
                      group.includeInFullDps
                        ? 'bg-emerald-500/25 text-emerald-200 border-emerald-400/50 font-semibold'
                        : 'bg-[#1a1f2e] text-zinc-400 hover:text-emerald-200 border-[#2a3147]'
                    }`}
                  >
                    {uiText(locale, '计入总DPS', 'Full DPS')}
                  </button>

                  <button
                    type="button"
                    onClick={() => setMainSkillGroup(group.id)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer ${
                      isMain
                        ? 'bg-amber-500/25 text-amber-200 border border-amber-500/50 font-semibold'
                        : 'bg-[#1a1f2e] text-zinc-300 hover:text-amber-200 border border-[#2a3147]'
                    }`}
                  >
                    <Star className="w-3 h-3" />
                    {isMain ? t(locale, 'skills.mainSkill') : t(locale, 'skills.setAsMain')}
                  </button>

                  {build.skills.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSkillGroup(group.id)}
                      className="p-1.5 rounded text-rose-400 hover:bg-rose-950/40 cursor-pointer"
                      title={t(locale, 'skills.removeGroup')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Gem Level / Quality Quick Presets */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-zinc-500 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  {uiText(locale, '快捷预设', 'Quick Presets')}
                </span>
                {(
                  [
                    { id: '20/20' as GemPreset, zh: '20/20', en: '20/20', tipZh: '全部宝石设为 20 级 20 品质', tipEn: 'All gems → Level 20 / Quality 20' },
                    { id: '21/20' as GemPreset, zh: '21/20 主技能', en: '21/20 Act', tipZh: '主动技能 21/20，辅助 20/20', tipEn: 'Active gems 21/20, supports 20/20' },
                    { id: 'q0' as GemPreset, zh: 'Q0', en: 'Q0', tipZh: '全部宝石品质归零', tipEn: 'Reset quality to 0 across group' },
                  ]
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={group.gems.length === 0}
                    onClick={() => applyGemPreset(group.id, preset.id)}
                    title={uiText(locale, preset.tipZh, preset.tipEn)}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      preset.id === '21/20'
                        ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border-amber-500/40'
                        : preset.id === 'q0'
                          ? 'bg-[#161c2b] hover:bg-[#1e263a] text-zinc-300 border-[#2a3147]'
                          : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border-emerald-500/40'
                    }`}
                  >
                    {uiText(locale, preset.zh, preset.en)}
                  </button>
                ))}
              </div>

              {/* Gems List */}
              <div className="space-y-1.5">
                {group.gems.map((gemInst) => {
                  const def = gemsCatalog.find((g) => g.id === gemInst.gemId);
                  if (!def) return null;
                  return (
                    <div
                      key={gemInst.instanceId}
                      className="flex items-center justify-between gap-2 rounded bg-[#0c0e15] border border-[#212738] px-2.5 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={gemInst.enabled}
                          onChange={(e) =>
                            updateGem(group.id, gemInst.instanceId, { enabled: e.target.checked })
                          }
                          className="accent-amber-500 cursor-pointer"
                        />
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase shrink-0 ${
                            GEM_COLOR_BADGE[def.color]
                          }`}
                        >
                          {def.category === 'active' ? (def.isAuraOrBuff ? 'BUFF' : 'ACT') : 'SUP'}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold text-zinc-100 truncate">
                            {localizeText(def.name, locale)}
                            {def.spiritReservation && (
                              <span className="ml-2 text-[10px] text-amber-300 font-mono">
                                {def.spiritReservation} Spirit
                              </span>
                            )}
                            {def.manaReservationPct && (
                              <span className="ml-2 text-[10px] text-blue-300 font-mono">
                                {def.manaReservationPct}% Mana
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-400 truncate">
                            {def.stats.map((s) => localizeStatLine(s, locale)).join(' · ')}
                          </div>
                          {displayGemTags(def.tags).length > 0 && (
                            <div className="flex flex-wrap items-center gap-1 mt-0.5">
                              {displayGemTags(def.tags).map((tag) => (
                                <span
                                  key={tag}
                                  className="px-1 py-0 rounded text-[9px] font-mono uppercase tracking-wide bg-[#161c2b]/80 text-zinc-400 border border-[#262d42]"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {def.category === 'active' && !def.isAuraOrBuff && (
                          <>
                            <label
                              className="text-[10px] text-emerald-400/90 font-mono"
                              title={uiText(locale, '同时生效数量（如 20 狂灵 / 4 图腾）', 'Active instance count for Full DPS')}
                            >
                              ×
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={99}
                              value={gemInst.count ?? 1}
                              onChange={(e) =>
                                updateGem(group.id, gemInst.instanceId, {
                                  count: Math.max(1, Math.min(99, Number(e.target.value) || 1)),
                                })
                              }
                              title={uiText(locale, '同时生效数量（Full DPS 乘数）', 'Active count multiplier')}
                              className="pob-input rounded w-11 px-1 py-0.5 text-center font-mono text-xs text-emerald-300"
                            />
                          </>
                        )}
                        <label className="text-[10px] text-zinc-400">{t(locale, 'skills.level')}</label>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={gemInst.level}
                          onChange={(e) =>
                            updateGem(group.id, gemInst.instanceId, {
                              level: Math.max(1, Math.min(30, Number(e.target.value) || 1)),
                            })
                          }
                          className="pob-input rounded w-12 px-1.5 py-0.5 text-center font-mono text-xs"
                        />
                        <label className="text-[10px] text-zinc-400">{t(locale, 'skills.quality')}</label>
                        <input
                          type="number"
                          min={0}
                          max={30}
                          value={gemInst.quality}
                          onChange={(e) =>
                            updateGem(group.id, gemInst.instanceId, {
                              quality: Math.max(0, Math.min(30, Number(e.target.value) || 0)),
                            })
                          }
                          className="pob-input rounded w-12 px-1.5 py-0.5 text-center font-mono text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => removeGemFromGroup(group.id, gemInst.instanceId)}
                          className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Searchable Add Gem Picker + Smart Support DPS Recommender */}
              <div className="pt-1 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <GemSearchPicker
                    gemsCatalog={gemsCatalog}
                    locale={locale}
                    globalQuery={gemSearch}
                    hasActiveGem={group.gems.some((gi) => {
                      const def = gemsCatalog.find((g) => g.id === gi.gemId);
                      return def?.category === 'active';
                    })}
                    onSelectGem={(gemId) => addGemToGroup(group.id, gemId)}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setOptimizerGroupId((cur) => (cur === group.id ? null : group.id))
                    }
                    className={`flex items-center justify-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold border shrink-0 cursor-pointer transition ${
                      optimizerGroupId === group.id
                        ? 'bg-emerald-500/25 border-emerald-400/60 text-emerald-200'
                        : 'bg-[#161c2b] hover:bg-[#1e263a] border-emerald-500/35 text-emerald-300'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {uiText(locale, '按 DPS 推荐辅助', 'Rank Supports')}
                  </button>
                </div>

                {optimizerGroupId === group.id && (
                  <div className="rounded bg-[#0a0d14] border border-emerald-500/35 p-2.5 space-y-1.5">
                    <div className="text-[11px] font-semibold text-emerald-300 flex items-center justify-between">
                      <span>
                        {uiText(locale, '实时模拟最高 DPS 辅助宝石推荐 (Lv.20)', 'Top Compatible Support Gems by Live DPS Gain (Lv.20)')}
                      </span>
                      <span className="text-[10px] text-zinc-400 font-mono">
                        Top {rankedSupports.length}
                      </span>
                    </div>
                    {rankedSupports.length === 0 ? (
                      <div className="text-[11px] text-zinc-500 py-1">
                        {uiText(locale, '未找到更高 DPS 增益的兼容辅助宝石（或此组仅含光环）', 'No compatible support gem with positive DPS gain found.')}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {rankedSupports.map((rec) => (
                          <button
                            key={rec.gem.id}
                            type="button"
                            onClick={() => addGemToGroup(group.id, rec.gem.id)}
                            className="flex items-center justify-between gap-2 rounded bg-[#111521] hover:bg-[#192033] border border-[#242c42] px-2 py-1.5 text-left text-xs cursor-pointer"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-zinc-100 truncate">
                                {localizeText(rec.gem.name, locale)}
                              </div>
                              <div className="text-[10px] text-zinc-400 truncate">
                                {rec.gem.stats.slice(0, 1).map((s) => localizeStatLine(s, locale)).join('')}
                              </div>
                            </div>
                            <span className="font-mono text-[11px] font-bold text-emerald-400 shrink-0">
                              +{rec.dpsDeltaPct.toFixed(1)}%
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
