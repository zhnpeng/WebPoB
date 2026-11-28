import { useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, Copy, Sparkles } from 'lucide-react';
import { analyzeBuildDiagnostics } from '@webpob/calc/diagnostics';
import { getClassesForGame } from '@webpob/data';
import { localizeText, t, uiText } from '@webpob/i18n';
import { useWebPobStore } from '../store/useWebPobStore';

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString();
}

function StatRow({
  label,
  value,
  valueClass = 'text-zinc-100',
  sub,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5 text-xs">
      <span className="text-zinc-400 truncate">{label}</span>
      <span className={`font-mono font-semibold tabular-nums whitespace-nowrap ${valueClass}`}>
        {value}
        {sub && <span className="text-[10px] text-zinc-500 font-normal ml-1">{sub}</span>}
      </span>
    </div>
  );
}

export function SidebarStats() {
  const { locale, build, calc, calcReady, setMainSkillGroup, setActiveTab, toggleFlaskActive } = useWebPobStore();
  const { offence, defence } = calc;
  const [diagOpen, setDiagOpen] = useState(true);
  const [copiedStats, setCopiedStats] = useState(false);
  const diagnostics = useMemo(
    () => (calcReady ? analyzeBuildDiagnostics(build, calc) : []),
    [build, calc, calcReady],
  );

  const manaReserved = Math.max(0, defence.mana - defence.manaUnreserved);
  const manaReservedPct =
    defence.mana > 0 ? Math.min(100, Math.round((manaReserved / defence.mana) * 100)) : 0;
  const manaOverReserved =
    defence.manaUnreserved < 0 || (defence.manaUnreserved <= 0 && manaReserved > 0);
  const spiritReserved = Math.max(0, defence.spirit - defence.spiritUnreserved);
  const spiritReservedPct =
    defence.spirit > 0 ? Math.min(100, Math.round((spiritReserved / defence.spirit) * 100)) : 0;

  const copyStatsSummary = async () => {
    const classes = getClassesForGame(build.game);
    const currentClass = classes.find((c) => c.id === build.classId) ?? classes[0];
    const ascendancy = currentClass?.ascendancies.find((a) => a.id === build.ascendancyId);
    const buildTitle = ascendancy ? localizeText(ascendancy.name, locale) : currentClass ? localizeText(currentClass.name, locale) : build.classId;
    const resLine = [defence.fireResist, defence.coldResist, defence.lightningResist, defence.chaosResist].join('/');
    const summary = `${buildTitle} ${localizeText(offence.mainSkillName, locale)} (Lv.${build.level}) | ${fmtNum(offence.totalDps)} DPS | ${fmtNum(defence.life)} Life / ${fmtNum(defence.energyShield)} ES | ${fmtNum(defence.effectiveHitPool)} EHP | ${resLine}% Res`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(summary);
      } else {
        const area = document.createElement('textarea');
        area.value = summary;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setCopiedStats(true);
      window.setTimeout(() => setCopiedStats(false), 1500);
    } catch {
      // Clipboard unavailable; leave the button state unchanged.
    }
  };

  const resColor = (val: number, max: number) =>
    val >= max ? 'text-emerald-400' : val >= 50 ? 'text-amber-300' : 'text-rose-400';

  return (
    <aside className="w-64 lg:w-72 shrink-0 border-r border-[#232838] bg-[#10131b] flex flex-col overflow-y-auto p-3 gap-3 select-none">
      {copiedStats && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 rounded-full bg-emerald-950/95 border border-emerald-400/60 px-3 py-1.5 text-xs font-semibold text-emerald-200 shadow-xl pointer-events-none">
          <Check className="w-3.5 h-3.5" />
          {uiText(locale, '战绩已复制到剪贴板', 'Build stats copied to clipboard')}
        </div>
      )}
      {/* Main Skill Picker */}
      <div className="pob-panel rounded-md p-2.5">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="text-[10px] uppercase tracking-wider text-amber-400/90 font-semibold">
            {t(locale, 'sidebar.mainSkill')}
          </div>
          <button
            type="button"
            onClick={() => void copyStatsSummary()}
            title={uiText(locale, '复制一行构筑战绩摘要', 'Copy one-line build stats summary')}
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer transition whitespace-nowrap ${
              copiedStats
                ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                : 'bg-[#0c0e15] border-[#2a3147] text-zinc-400 hover:text-amber-200 hover:border-amber-500/40'
            }`}
          >
            {copiedStats ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copiedStats
              ? uiText(locale, '已复制', 'Copied')
              : uiText(locale, '复制战绩', 'Copy Stats')}
          </button>
        </div>
        <select
          value={build.mainSkillGroupId}
          onChange={(e) => setMainSkillGroup(e.target.value)}
          className="pob-input w-full rounded px-2 py-1 text-xs font-medium mb-2"
        >
          {build.skills.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <div className="flex items-baseline justify-between border-t border-[#232838] pt-2">
          <span className="text-xs text-zinc-400">{t(locale, 'sidebar.totalDps')}</span>
          <span className="text-lg font-mono font-bold text-amber-300 tabular-nums">
            {fmtNum(offence.totalDps)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 text-[11px] text-zinc-400 mt-0.5">
          <span className="truncate">{localizeText(offence.mainSkillName, locale)}</span>
          {offence.mainSkillLevel !== undefined && (
            <span className="font-mono text-[10px] shrink-0 text-zinc-400">
              Lv.{offence.mainSkillLevel}
              {offence.mainSkillBaseLevel !== undefined &&
                offence.mainSkillLevel > offence.mainSkillBaseLevel && (
                  <span className="text-cyan-300 font-semibold ml-0.5">
                    (+{offence.mainSkillLevel - offence.mainSkillBaseLevel})
                  </span>
                )}
            </span>
          )}
        </div>
        {offence.fullDps !== undefined && offence.fullDps > 0 && (
          <div className="mt-2 pt-2 border-t border-emerald-500/30 space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-semibold text-emerald-300">
                {uiText(locale, '全技能合计 (Full DPS)', 'Full DPS')}
              </span>
              <span className="text-base font-mono font-bold text-emerald-300 tabular-nums">
                {fmtNum(offence.fullDps)}
              </span>
            </div>
            {offence.fullDpsBreakdown && offence.fullDpsBreakdown.length > 0 && (
              <div className="space-y-0.5">
                {offence.fullDpsBreakdown.map((item) => (
                  <div
                    key={item.groupId}
                    className="flex items-center justify-between gap-1 text-[10px] text-zinc-400"
                  >
                    <span className="truncate">
                      {item.count > 1 ? `${item.count}× ` : ''}
                      {localizeText(item.skillName, locale)}
                    </span>
                    <span className="font-mono text-emerald-200/90 shrink-0">
                      {fmtNum(item.dps)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Offence */}
      <div className="pob-panel rounded-md p-2.5">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold border-b border-[#232838] pb-1 mb-1.5">
          {t(locale, 'sidebar.offence')}
        </div>
        <StatRow label={t(locale, 'sidebar.hitDps')} value={fmtNum(offence.hitDps)} valueClass="text-amber-200" />
        {(offence.impaleDps ?? 0) > 0 && (
          <StatRow
            label={uiText(locale, '穿刺 DPS', 'Impale DPS')}
            value={fmtNum(offence.impaleDps!)}
            valueClass="text-amber-400"
          />
        )}
        {offence.igniteDps > 0 && (
          <StatRow label={t(locale, 'sidebar.igniteDps')} value={fmtNum(offence.igniteDps)} valueClass="text-orange-400" />
        )}
        {offence.bleedDps > 0 && (
          <StatRow label={t(locale, 'sidebar.bleedDps')} value={fmtNum(offence.bleedDps)} valueClass="text-rose-400" />
        )}
        {offence.poisonDps > 0 && (
          <StatRow label={uiText(locale, '中毒 DPS', 'Poison DPS')} value={fmtNum(offence.poisonDps)} valueClass="text-lime-400" />
        )}
        <StatRow label={t(locale, 'sidebar.averageHit')} value={fmtNum(offence.averageHit)} />
        <StatRow
          label={
            offence.triggerRate !== undefined
              ? uiText(locale, '触发频率 (CoC)', 'Trigger Rate (CoC)')
              : t(locale, 'sidebar.speed')
          }
          value={`${offence.speed.toFixed(2)} /s`}
          valueClass={offence.triggerRate !== undefined ? 'text-cyan-300' : 'text-zinc-100'}
        />
        <StatRow label={t(locale, 'sidebar.critChance')} value={`${offence.critChance.toFixed(1)}%`} valueClass="text-yellow-300" />
        <StatRow label={t(locale, 'sidebar.critMulti')} value={`${offence.critMultiplier}%`} valueClass="text-yellow-200" />
        <StatRow label={t(locale, 'sidebar.hitChance')} value={`${offence.hitChance}%`} />
        <StatRow label={t(locale, 'sidebar.manaCost')} value={`${offence.manaCost}`} sub={`(${offence.manaPerSecond}/s)`} />
      </div>

      {/* Defence */}
      <div className="pob-panel rounded-md p-2.5">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold border-b border-[#232838] pb-1 mb-1.5">
          {t(locale, 'sidebar.defence')}
        </div>
        <StatRow label={t(locale, 'sidebar.life')} value={fmtNum(defence.life)} valueClass="text-rose-400" sub={defence.lifeRegen > 0 ? `+${defence.lifeRegen}/s` : undefined} />
        {(defence.lifeLeechRate ?? 0) > 0 && (
          <StatRow
            label={uiText(locale, '生命偷取速率', 'Life Leech Rate')}
            value={`+${fmtNum(defence.lifeLeechRate!)} /s`}
            valueClass="text-rose-300"
          />
        )}
        <StatRow label={t(locale, 'sidebar.energyShield')} value={fmtNum(defence.energyShield)} valueClass="text-sky-400" />
        {(defence.esLeechRate ?? 0) > 0 && (
          <StatRow
            label={uiText(locale, '护盾偷取速率', 'ES Leech Rate')}
            value={`+${fmtNum(defence.esLeechRate!)} /s`}
            valueClass="text-sky-300"
          />
        )}
        {(defence.ward ?? 0) > 0 && (
          <StatRow
            label={uiText(locale, '结界 (Ward)', 'Ward')}
            value={fmtNum(defence.ward!)}
            valueClass="text-indigo-300"
          />
        )}
        <StatRow label={t(locale, 'sidebar.mana')} value={`${fmtNum(defence.manaUnreserved)} / ${fmtNum(defence.mana)}`} valueClass="text-blue-400" />
        <div className="space-y-0.5 pb-1">
          <div className={`h-1.5 w-full rounded-full overflow-hidden flex bg-[#0a0c12] ${manaOverReserved ? 'ring-1 ring-rose-500/70 animate-pulse' : ''}`}>
            <div className="h-full bg-blue-500" style={{ width: `${100 - manaReservedPct}%` }} />
            <div
              className={`h-full ${manaOverReserved ? 'bg-rose-500' : 'bg-amber-500'}`}
              style={{ width: `${manaReservedPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[9px] font-mono">
            <span className="text-blue-400">
              {uiText(locale, '可用', 'Free')} {fmtNum(defence.manaUnreserved)}
            </span>
            <span className={manaOverReserved ? 'text-rose-400 font-semibold' : 'text-amber-300'}>
              {uiText(locale, '保留', 'Reserved')} {manaReservedPct}%
            </span>
          </div>
        </div>
        {build.game === 'poe2' && (
          <>
            <StatRow
              label={t(locale, 'sidebar.spirit')}
              value={`${defence.spiritUnreserved} / ${defence.spirit}`}
              valueClass={defence.spiritUnreserved < 0 ? 'text-rose-400' : 'text-amber-300'}
            />
            <div className="space-y-0.5 pb-1">
              <div className={`h-1.5 w-full rounded-full overflow-hidden flex bg-[#0a0c12] ${defence.spiritUnreserved < 0 ? 'ring-1 ring-rose-500/70 animate-pulse' : ''}`}>
                <div className="h-full bg-amber-300" style={{ width: `${100 - spiritReservedPct}%` }} />
                <div
                  className={`h-full ${defence.spiritUnreserved < 0 ? 'bg-rose-500' : 'bg-amber-600'}`}
                  style={{ width: `${spiritReservedPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[9px] font-mono">
                <span className="text-amber-200">
                  {uiText(locale, '可用', 'Free')} {defence.spiritUnreserved}
                </span>
                <span className={defence.spiritUnreserved < 0 ? 'text-rose-400 font-semibold' : 'text-amber-300'}>
                  {uiText(locale, '保留', 'Reserved')} {spiritReservedPct}%
                </span>
              </div>
            </div>
          </>
        )}
        <StatRow label={t(locale, 'sidebar.armour')} value={fmtNum(defence.armour)} sub={`(${defence.physDamageReduction}% PDR)`} />
        <StatRow label={t(locale, 'sidebar.evasion')} value={fmtNum(defence.evasion)} sub={`(${defence.evadeChance}%)`} />
        <StatRow label={t(locale, 'sidebar.block')} value={`${defence.blockChance}% / ${defence.spellBlockChance}%`} />
        {build.game === 'poe1' && (
          <StatRow label={t(locale, 'sidebar.spellSuppress')} value={`${defence.spellSuppressionChance}%`} valueClass="text-emerald-300" />
        )}
        <StatRow label={t(locale, 'sidebar.moveSpeed')} value={`${defence.movementSpeedPct - 100 >= 0 ? '+' : ''}${defence.movementSpeedPct - 100}%`} />
        <div className="border-t border-[#232838] mt-1.5 pt-1.5">
          <StatRow label={t(locale, 'sidebar.ehp')} value={fmtNum(defence.effectiveHitPool)} valueClass="text-emerald-300" />
          <StatRow label={t(locale, 'sidebar.maxPhysHit')} value={fmtNum(defence.maxPhysHitTaken)} />
          <StatRow label={t(locale, 'sidebar.maxEleHit')} value={fmtNum(defence.maxEleHitTaken)} />
        </div>
      </div>

      {/* Resistances & Attributes */}
      <div className="pob-panel rounded-md p-2.5">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold border-b border-[#232838] pb-1 mb-1.5">
          {t(locale, 'sidebar.resistances')}
        </div>
        <StatRow
          label={t(locale, 'sidebar.fireRes')}
          value={`${defence.fireResist}%`}
          sub={`(${defence.fireResist + defence.fireResistOvercap}%)`}
          valueClass={resColor(defence.fireResist, defence.fireMaxResist)}
        />
        <StatRow
          label={t(locale, 'sidebar.coldRes')}
          value={`${defence.coldResist}%`}
          sub={`(${defence.coldResist + defence.coldResistOvercap}%)`}
          valueClass={resColor(defence.coldResist, defence.coldMaxResist)}
        />
        <StatRow
          label={t(locale, 'sidebar.lightningRes')}
          value={`${defence.lightningResist}%`}
          sub={`(${defence.lightningResist + defence.lightningResistOvercap}%)`}
          valueClass={resColor(defence.lightningResist, defence.lightningMaxResist)}
        />
        <StatRow
          label={t(locale, 'sidebar.chaosRes')}
          value={`${defence.chaosResist}%`}
          valueClass={defence.chaosResist >= 75 ? 'text-purple-300' : defence.chaosResist >= 0 ? 'text-zinc-200' : 'text-rose-400'}
        />

        <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold border-t border-[#232838] pt-2 mt-2 mb-1">
          {t(locale, 'sidebar.attributes')}
        </div>
        <div className="grid grid-cols-3 gap-1 text-center text-xs font-mono">
          <div className="rounded bg-[#0b0d14] border border-[#232838] py-1">
            <div className="text-[10px] text-rose-400">{t(locale, 'sidebar.str')}</div>
            <div className="font-bold text-zinc-100">{defence.str}</div>
          </div>
          <div className="rounded bg-[#0b0d14] border border-[#232838] py-1">
            <div className="text-[10px] text-emerald-400">{t(locale, 'sidebar.dex')}</div>
            <div className="font-bold text-zinc-100">{defence.dex}</div>
          </div>
          <div className="rounded bg-[#0b0d14] border border-[#232838] py-1">
            <div className="text-[10px] text-sky-400">{t(locale, 'sidebar.int')}</div>
            <div className="font-bold text-zinc-100">{defence.int}</div>
          </div>
        </div>
      </div>

      {/* Passive Points Summary */}
      <div className="pob-panel rounded-md p-2.5 text-xs flex items-center justify-between">
        <span className="text-zinc-400">{t(locale, 'sidebar.points')}</span>
        <span className="font-mono font-semibold text-amber-200">
          {calc.allocatedPoints}
          {(calc.ascendancyPoints ?? 0) > 0 && (
            <span className="text-[10px] text-amber-300/90 ml-1">
              +{calc.ascendancyPoints}/8
            </span>
          )}
          {build.game === 'poe2' && (
            <span className="text-[10px] text-zinc-400 ml-1">
              (I:{calc.weaponSet1Points} / II:{calc.weaponSet2Points})
            </span>
          )}
        </span>
      </div>

      {/* Smart Build Health Diagnostics */}
      <div
        className={`rounded-md border p-2.5 space-y-1.5 ${
          diagnostics.some((d) => d.severity === 'critical')
            ? 'border-rose-500/45 bg-rose-950/25'
            : diagnostics.length > 0
              ? 'border-amber-500/40 bg-amber-950/20'
              : 'border-emerald-500/35 bg-emerald-950/20'
        }`}
      >
        <button
          type="button"
          onClick={() => setDiagOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-1.5 text-[11px] font-semibold cursor-pointer"
        >
          <span
            className={`flex items-center gap-1.5 ${
              diagnostics.some((d) => d.severity === 'critical')
                ? 'text-rose-300'
                : diagnostics.length > 0
                  ? 'text-amber-300'
                  : 'text-emerald-300'
            }`}
          >
            {diagnostics.length > 0 ? (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            )}
            {uiText(locale, `构筑体检诊断 (${diagnostics.length})`, `Build Diagnostics (${diagnostics.length})`)}
          </span>
          {diagOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
          )}
        </button>

        {diagOpen && (
          diagnostics.length === 0 ? (
            <p className="text-[11px] text-emerald-200/80 leading-snug">
              {uiText(locale, '抗性、命中、保留与生命护盾状态良好！', 'Resists, hit chance, reservations, and hit pool look healthy!')}
            </p>
          ) : (
            <div className="space-y-1.5 pt-0.5">
              {diagnostics.map((d) => (
                <div
                  key={d.id}
                  className={`rounded px-2 py-1.5 border text-[11px] space-y-1 ${
                    d.severity === 'critical'
                      ? 'bg-rose-950/40 border-rose-500/35 text-rose-200'
                      : d.severity === 'warning'
                        ? 'bg-amber-950/35 border-amber-500/30 text-amber-200'
                        : 'bg-[#0e121c]/80 border-[#283046] text-zinc-300'
                  }`}
                >
                  <div className="font-semibold leading-snug">{localizeText(d.title, locale)}</div>
                  <p className="text-[10px] opacity-85 leading-snug">{localizeText(d.detail, locale)}</p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {d.quickAction === 'activate_flasks' && (
                      <button
                        type="button"
                        onClick={() => {
                          for (const slot of ['Flask 1', 'Flask 2', 'Flask 3', 'Flask 4', 'Flask 5'] as const) {
                            if (build.equipped[slot] && !build.activeFlaskSlots?.[slot]) {
                              toggleFlaskActive(slot);
                            }
                          }
                        }}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/40 text-[10px] text-emerald-200 cursor-pointer"
                      >
                        <Sparkles className="w-2.5 h-2.5" />
                        {uiText(locale, '一键开启药剂', 'Enable Flasks')}
                      </button>
                    )}
                    {d.actionTab && (
                      <button
                        type="button"
                        onClick={() => setActiveTab(d.actionTab!)}
                        className="px-1.5 py-0.5 rounded bg-[#1a2033] hover:bg-[#232b42] border border-[#323b56] text-[10px] text-amber-200 cursor-pointer"
                      >
                        {uiText(locale, d.actionTab === 'items'
                            ? '去装备页修复 →'
                            : d.actionTab === 'skills'
                              ? '去技能页调整 →'
                              : d.actionTab === 'tree'
                                ? '去天赋树优化 →'
                                : '去配置页 →', `Fix in ${d.actionTab} →`)}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </aside>
  );
}
