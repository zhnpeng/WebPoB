import { useEffect, useMemo, useState } from 'react';
import { GitCompare, ShieldCheck, TrendingUp, Zap } from 'lucide-react';
import { DAMAGE_TYPES, type Build, type CalcOutput, type DamageType } from '@webpob/core';
import { getSampleBuild } from '@webpob/data';
import { DAMAGE_TYPE_LABELS, localizeText, t, uiText } from '@webpob/i18n';
import { useWebPobStore } from '../store/useWebPobStore';
import { listSavedBuilds, type SavedBuildRecord } from '../storage/buildLibrary';
import { calculateBatchInWorker, calculateBuildInWorker } from '../workers/calcWorkerClient';

const DMG_COLOR: Record<string, string> = {
  Physical: 'text-zinc-200',
  Fire: 'text-orange-400',
  Cold: 'text-sky-300',
  Lightning: 'text-yellow-300',
  Chaos: 'text-purple-400',
};

const DMG_SEGMENT_COLOR: Record<string, string> = {
  Physical: 'bg-zinc-300',
  Fire: 'bg-orange-500',
  Cold: 'bg-sky-400',
  Lightning: 'bg-yellow-400',
  Chaos: 'bg-purple-500',
};

const DMG_PILL_COLOR: Record<string, string> = {
  Physical: 'bg-zinc-300/15 border-zinc-300/40 text-zinc-200',
  Fire: 'bg-orange-500/15 border-orange-500/40 text-orange-300',
  Cold: 'bg-sky-400/15 border-sky-400/40 text-sky-300',
  Lightning: 'bg-yellow-400/15 border-yellow-400/40 text-yellow-300',
  Chaos: 'bg-purple-500/15 border-purple-500/40 text-purple-300',
};

const DAMAGE_COMPOSITION_ORDER: DamageType[] = [
  'Physical',
  'Fire',
  'Cold',
  'Lightning',
  'Chaos',
];

export function CalcsTab() {
  const { locale, build, calc } = useWebPobStore();
  const { offence, defence } = calc;
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [savedBuilds, setSavedBuilds] = useState<SavedBuildRecord[]>([]);
  const [compareId, setCompareId] = useState<string>('sample_current_game');
  const [curveMode, setCurveMode] = useState<'gem' | 'char'>('gem');

  useEffect(() => {
    void listSavedBuilds().then(setSavedBuilds);
  }, [build.id]);

  const compareTargets = useMemo(() => {
    const sample = getSampleBuild(build.game);
    const list: Array<{ id: string; label: string; build: Build }> = [
      {
        id: 'sample_current_game',
        label:
          uiText(locale, `官方默认示例 (${sample.name})`, `Default Sample (${sample.name})`),
        build: sample,
      },
      ...savedBuilds.map((r) => ({
        id: r.id,
        label: `${r.name} (Lv.${r.level} ${r.classId})`,
        build: r.build,
      })),
    ];
    return list;
  }, [build.game, savedBuilds, locale]);

  const comparedTarget = compareTargets.find((c) => c.id === compareId) ?? compareTargets[0];
  const [comparedCalc, setComparedCalc] = useState<CalcOutput | null>(null);
  useEffect(() => {
    if (!comparedTarget) {
      setComparedCalc(null);
      return;
    }
    let cancelled = false;
    void calculateBuildInWorker(comparedTarget.build, locale)
      .then((res) => {
        if (!cancelled) setComparedCalc(res);
      })
      .catch(() => {
        if (!cancelled) setComparedCalc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [comparedTarget, locale]);

  // Live Quick Scenario What-If Analysis (Flasks, Charges, Pinnacle Boss, +2 Gem Level, Shock/Onslaught)
  const [scenarioOutputs, setScenarioOutputs] = useState<Record<string, CalcOutput>>({});
  const scenarioDefs = useMemo(() => {
    const allFlaskSlots = (['Flask 1', 'Flask 2', 'Flask 3', 'Flask 4', 'Flask 5'] as const).reduce(
      (acc, slot) => {
        if (build.equipped[slot]) acc[slot] = true;
        return acc;
      },
      {} as NonNullable<Build['activeFlaskSlots']>,
    );

    return [
      {
        id: 'plus2_gem',
        labelEn: '+2 to All Skill Gems (What-If)',
        labelZh: '假设所有技能宝石等级 +2',
        mutate: (b: Build): Build => ({
          ...b,
          config: {
            ...b.config,
            customMods: `${b.config.customMods ? `${b.config.customMods}\n` : ''}+2 to Level of all Skill Gems`,
          },
        }),
      },
      {
        id: 'pinnacle',
        labelEn: 'vs Pinnacle Boss (50% Ele / 30% Chaos Res)',
        labelZh: '对阵巅峰 Boss（高抗性）',
        mutate: (b: Build): Build => ({
          ...b,
          config: {
            ...b.config,
            enemyIsBoss: 'Pinnacle',
            enemyFireResist: 50,
            enemyColdResist: 50,
            enemyLightningResist: 50,
            enemyChaosResist: 30,
          },
        }),
      },
      {
        id: 'mapping',
        labelEn: 'vs Normal Mapping Mob (0% Resist)',
        labelZh: '对阵普通刷图怪物（0% 抗性）',
        mutate: (b: Build): Build => ({
          ...b,
          config: {
            ...b.config,
            enemyIsBoss: 'None',
            enemyFireResist: 0,
            enemyColdResist: 0,
            enemyLightningResist: 0,
            enemyChaosResist: 0,
            enemyArmour: 0,
          },
        }),
      },
      {
        id: 'no_charges',
        labelEn: 'Without Any Charges / Onslaught',
        labelZh: '无充能球与猛攻（裸状态）',
        mutate: (b: Build): Build => ({
          ...b,
          config: {
            ...b.config,
            usePowerCharges: false,
            useFrenzyCharges: false,
            useEnduranceCharges: false,
            onslaught: false,
          },
        }),
      },
      {
        id: 'full_buffs',
        labelEn: 'Full Charges (3/3/3) + Onslaught + 20% Shock',
        labelZh: '满三球 (3/3/3) + 猛攻 + 20% 感电',
        mutate: (b: Build): Build => ({
          ...b,
          config: {
            ...b.config,
            usePowerCharges: true,
            powerCharges: Math.max(3, b.config.powerCharges),
            useFrenzyCharges: true,
            frenzyCharges: Math.max(3, b.config.frenzyCharges),
            useEnduranceCharges: true,
            enduranceCharges: Math.max(3, b.config.enduranceCharges),
            onslaught: true,
            enemyShocked: true,
            shockValue: Math.max(20, b.config.shockValue),
          },
        }),
      },
      {
        id: 'all_flasks',
        labelEn: Object.keys(allFlaskSlots).length > 0 ? 'All Equipped Flasks Active' : 'No Equipped Flasks (Baseline)',
        labelZh: Object.keys(allFlaskSlots).length > 0 ? '全部已装备药剂开启' : '未装备药剂（基准）',
        mutate: (b: Build): Build => ({
          ...b,
          activeFlaskSlots: allFlaskSlots,
        }),
      },
    ];
  }, [build.equipped]);

  useEffect(() => {
    let cancelled = false;
    const batch = scenarioDefs.map((sc) => ({ key: sc.id, build: sc.mutate(build) }));
    void calculateBatchInWorker(batch, locale)
      .then((res) => {
        if (!cancelled) setScenarioOutputs(res);
      })
      .catch(() => {
        if (!cancelled) setScenarioOutputs({});
      });
    return () => {
      cancelled = true;
    };
  }, [build, scenarioDefs, locale]);

  const scenarioRows = useMemo(() => {
    const baseDps = calc.offence.fullDps ?? calc.offence.totalDps;
    const baseEhp = calc.defence.effectiveHitPool;
    return scenarioDefs.map((sc) => {
      const res = scenarioOutputs[sc.id] ?? calc;
      const nextDps = res.offence.fullDps ?? res.offence.totalDps;
      const nextEhp = res.defence.effectiveHitPool;
      const dpsDelta = nextDps - baseDps;
      const dpsPct = baseDps > 0 ? (dpsDelta / baseDps) * 100 : 0;
      const ehpDelta = nextEhp - baseEhp;
      const ehpPct = baseEhp > 0 ? (ehpDelta / baseEhp) * 100 : 0;
      return {
        id: sc.id,
        label: uiText(locale, sc.labelZh, sc.labelEn),
        nextDps,
        dpsPct,
        nextEhp,
        ehpPct,
      };
    });
  }, [scenarioDefs, scenarioOutputs, calc, locale]);

  // Live Character Level (60->100) & Main Gem Level (18->30) Progression Curve
  const [progressionOutputs, setProgressionOutputs] = useState<Record<string, CalcOutput>>({});
  useEffect(() => {
    let cancelled = false;
    const batch: Array<{ key: string; build: Build }> = [];
    if (curveMode === 'char') {
      for (const lv of [60, 70, 80, 90, 95, 100]) {
        batch.push({ key: `Lv.${lv}`, build: { ...build, level: lv } });
      }
    } else {
      const mainGroup = build.skills.find((g) => g.id === build.mainSkillGroupId) ?? build.skills[0];
      for (const glv of [18, 19, 20, 21, 23, 25, 28, 30]) {
        const mutated: Build = mainGroup
          ? {
              ...build,
              skills: build.skills.map((g) =>
                g.id === mainGroup.id
                  ? {
                      ...g,
                      gems: g.gems.map((gem, idx) => (idx === 0 ? { ...gem, level: glv } : gem)),
                    }
                  : g,
              ),
            }
          : build;
        batch.push({ key: `Gem ${glv}`, build: mutated });
      }
    }
    void calculateBatchInWorker(batch, locale)
      .then((res) => {
        if (!cancelled) setProgressionOutputs(res);
      })
      .catch(() => {
        if (!cancelled) setProgressionOutputs({});
      });
    return () => {
      cancelled = true;
    };
  }, [build, curveMode, locale]);

  const progressionRows = useMemo(() => {
    const baseDps = calc.offence.fullDps ?? calc.offence.totalDps;
    const baseEhp = calc.defence.effectiveHitPool;
    if (curveMode === 'char') {
      const levels = [60, 70, 80, 90, 95, 100];
      return levels.map((lv) => {
        const key = `Lv.${lv}`;
        const res = progressionOutputs[key] ?? calc;
        const dps = res.offence.fullDps ?? res.offence.totalDps;
        const pct = baseDps > 0 ? ((dps - baseDps) / baseDps) * 100 : 0;
        const ehp = res.defence.effectiveHitPool;
        return {
          key,
          isCurrent: build.level === lv,
          dps,
          dpsPct: pct,
          life: res.defence.life,
          es: res.defence.energyShield,
          ehp,
          ehpPct: baseEhp > 0 ? ((ehp - baseEhp) / baseEhp) * 100 : 0,
        };
      });
    }
    const gemLevels = [18, 19, 20, 21, 23, 25, 28, 30];
    const mainGroup = build.skills.find((g) => g.id === build.mainSkillGroupId) ?? build.skills[0];
    const curGemLv = calc.offence.mainSkillBaseLevel ?? mainGroup?.gems[0]?.level ?? 20;
    return gemLevels.map((glv) => {
      const key = `Gem ${glv}`;
      const res = progressionOutputs[key] ?? calc;
      const dps = res.offence.fullDps ?? res.offence.totalDps;
      const pct = baseDps > 0 ? ((dps - baseDps) / baseDps) * 100 : 0;
      const ehp = res.defence.effectiveHitPool;
      return {
        key,
        isCurrent: curGemLv === glv,
        dps,
        dpsPct: pct,
        life: res.defence.life,
        es: res.defence.energyShield,
        ehp,
        ehpPct: baseEhp > 0 ? ((ehp - baseEhp) / baseEhp) * 100 : 0,
      };
    });
  }, [build, calc, curveMode, progressionOutputs]);

  const maxProgressionDps = Math.max(1, ...progressionRows.map((r) => r.dps));
  const maxProgressionEhp = Math.max(1, ...progressionRows.map((r) => r.ehp));
  const progressionDpsValues = progressionRows.map((r) => r.dps);
  const isFlatDpsProgression =
    progressionDpsValues.length > 0 &&
    Math.max(...progressionDpsValues) - Math.min(...progressionDpsValues) < 1;

  const selectedRow = calc.breakdowns[selectedIdx] ?? calc.breakdowns[0];

  const damageComposition = useMemo(() => {
    const total = DAMAGE_COMPOSITION_ORDER.reduce(
      (sum, dt) => sum + calc.offence.damageByType[dt].average,
      0,
    );
    return {
      total,
      segments: DAMAGE_COMPOSITION_ORDER.map((dt) => ({
        type: dt,
        average: calc.offence.damageByType[dt].average,
        pct: total > 0 ? (calc.offence.damageByType[dt].average / total) * 100 : 0,
      })).filter((s) => s.average > 0),
    };
  }, [calc.offence.damageByType]);

  const damageLabel = (dt: string) =>
    locale === 'zh-TW'
      ? DAMAGE_TYPE_LABELS[dt]?.zhTw ?? dt
      : locale === 'zh-CN'
        ? DAMAGE_TYPE_LABELS[dt]?.zh ?? dt
        : DAMAGE_TYPE_LABELS[dt]?.en ?? dt;

  const hitPoolSegments = useMemo(() => {
    const pool = Math.max(1, defence.life + defence.energyShield + (defence.ward ?? 0));
    return [
      {
        key: 'life',
        label: uiText(locale, '生命', 'Life'),
        value: defence.life,
        pct: (defence.life / pool) * 100,
        bar: 'bg-rose-500',
        text: 'text-rose-300',
      },
      {
        key: 'es',
        label: uiText(locale, '能量护盾', 'Energy Shield'),
        value: defence.energyShield,
        pct: (defence.energyShield / pool) * 100,
        bar: 'bg-sky-400',
        text: 'text-sky-300',
      },
      ...((defence.ward ?? 0) > 0
        ? [
            {
              key: 'ward',
              label: uiText(locale, '结界', 'Ward'),
              value: defence.ward!,
              pct: (defence.ward! / pool) * 100,
              bar: 'bg-violet-400',
              text: 'text-violet-300',
            },
          ]
        : []),
    ];
  }, [defence.life, defence.energyShield, defence.ward, locale]);

  const mitigationMeters = useMemo(
    () => [
      {
        key: 'pdr',
        label: uiText(locale, '物理减伤', 'Phys Reduction'),
        display: `${defence.physDamageReduction.toFixed(1)}%`,
        pct: defence.physDamageReduction,
        bar: 'bg-gradient-to-r from-amber-600 to-amber-300',
      },
      {
        key: 'evade',
        label: uiText(locale, '闪避几率', 'Evade Chance'),
        display: `${defence.evadeChance.toFixed(1)}%`,
        pct: defence.evadeChance,
        bar: 'bg-gradient-to-r from-emerald-600 to-emerald-300',
      },
      {
        key: 'block',
        label: uiText(locale, '攻击格挡', 'Attack Block'),
        display: `${defence.blockChance.toFixed(1)}%`,
        pct: defence.blockChance,
        bar: 'bg-gradient-to-r from-cyan-600 to-cyan-300',
      },
      {
        key: 'spellBlock',
        label: uiText(locale, '法术格挡', 'Spell Block'),
        display: `${defence.spellBlockChance.toFixed(1)}%`,
        pct: defence.spellBlockChance,
        bar: 'bg-gradient-to-r from-sky-600 to-sky-300',
      },
      ...(build.game === 'poe1'
        ? [
            {
              key: 'suppress',
              label: uiText(locale, '法术压制', 'Spell Suppression'),
              display: `${defence.spellSuppressionChance.toFixed(1)}%`,
              pct: defence.spellSuppressionChance,
              bar: 'bg-gradient-to-r from-teal-600 to-teal-300',
            },
          ]
        : []),
    ],
    [defence, build.game, locale],
  );

  const resistancePills = useMemo(
    () =>
      (
        [
          ['Fire', uiText(locale, '火焰', 'Fire'), defence.fireResist, defence.fireMaxResist, defence.fireResistOvercap, 'bg-orange-500/15 border-orange-500/40 text-orange-300'],
          ['Cold', uiText(locale, '冰霜', 'Cold'), defence.coldResist, defence.coldMaxResist, defence.coldResistOvercap, 'bg-sky-400/15 border-sky-400/40 text-sky-300'],
          ['Lightning', uiText(locale, '闪电', 'Lightning'), defence.lightningResist, defence.lightningMaxResist, defence.lightningResistOvercap, 'bg-yellow-400/15 border-yellow-400/40 text-yellow-300'],
          ['Chaos', uiText(locale, '混沌', 'Chaos'), defence.chaosResist, defence.chaosMaxResist, defence.chaosResistOvercap, 'bg-purple-500/15 border-purple-500/40 text-purple-300'],
        ] as const
      ).map(([key, label, current, max, overcap, tone]) => ({
        key,
        label,
        current,
        max,
        overcap,
        tone,
        capped: current >= max,
        deficit: max - current,
      })),
    [defence, locale],
  );

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5">
      <div>
        <h2 className="text-base font-bold text-amber-200">{t(locale, 'calcs.title')}</h2>
        <p className="text-xs text-zinc-400 mt-0.5">{t(locale, 'calcs.subtitle')}</p>
      </div>

      {/* Main Skill Damage Table */}
      <div className="pob-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-amber-200 uppercase tracking-wider">
            {t(locale, 'calcs.damageBreakdown')} — {localizeText(calc.offence.mainSkillName, locale)}
            {calc.offence.mainSkillLevel !== undefined && (
              <span className="ml-2 font-mono text-[11px] font-normal text-cyan-300 normal-case">
                Lv.{calc.offence.mainSkillLevel}
                {calc.offence.mainSkillBaseLevel !== undefined &&
                  calc.offence.mainSkillLevel > calc.offence.mainSkillBaseLevel &&
                  ` (+${calc.offence.mainSkillLevel - calc.offence.mainSkillBaseLevel})`}
                {calc.offence.mainSkillQuality ? ` · Q${calc.offence.mainSkillQuality}%` : ''}
              </span>
            )}
          </h3>
          <span className="text-xs font-mono text-amber-300">
            Total DPS: {Math.round(calc.offence.totalDps).toLocaleString()}
          </span>
        </div>
        {/* Damage Type Composition Bar */}
        <div className="mb-3 space-y-1.5">
          <div className="h-2.5 rounded-full overflow-hidden flex bg-[#0a0c12]">
            {damageComposition.segments.map((segment) => (
              <div
                key={segment.type}
                className={`h-full transition-all ${DMG_SEGMENT_COLOR[segment.type]}`}
                style={{ width: `${segment.pct}%` }}
                title={`${damageLabel(segment.type)} ${segment.pct.toFixed(1)}%`}
              />
            ))}
            {damageComposition.segments.length === 0 && <div className="h-full w-full bg-[#1a2030]" />}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {damageComposition.segments.map((segment) => (
              <span
                key={segment.type}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono font-semibold ${DMG_PILL_COLOR[segment.type]}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${DMG_SEGMENT_COLOR[segment.type]}`} />
                {damageLabel(segment.type)} {segment.pct.toFixed(1)}%
              </span>
            ))}
            {damageComposition.segments.length === 0 && (
              <span className="text-[10px] text-zinc-500">
                {uiText(locale, '无伤害数据', 'No damage data')}
              </span>
            )}
            {damageComposition.segments.length > 0 && (
              <span className="ml-auto text-[10px] font-mono text-zinc-500">
                {uiText(locale, '平均击中', 'Avg Hit')}{' '}
                {Math.round(damageComposition.total).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="border-b border-[#242a3c] text-zinc-400">
              <th className="py-1.5">{t(locale, 'calcs.damageType')}</th>
              <th className="py-1.5 text-right">{t(locale, 'calcs.min')}</th>
              <th className="py-1.5 text-right">{t(locale, 'calcs.max')}</th>
              <th className="py-1.5 text-right">{t(locale, 'calcs.avg')}</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {DAMAGE_TYPES.map((dt) => {
              const range = calc.offence.damageByType[dt];
              const label =
                locale === 'zh-TW'
      ? DAMAGE_TYPE_LABELS[dt]?.zhTw ?? dt
      : locale === 'zh-CN'
        ? DAMAGE_TYPE_LABELS[dt]?.zh ?? dt
        : DAMAGE_TYPE_LABELS[dt]?.en ?? dt;
              return (
                <tr key={dt} className="border-b border-[#1c2130]">
                  <td className={`py-1.5 font-sans font-semibold ${DMG_COLOR[dt]}`}>{label}</td>
                  <td className="py-1.5 text-right text-zinc-300">{range.min.toLocaleString()}</td>
                  <td className="py-1.5 text-right text-zinc-300">{range.max.toLocaleString()}</td>
                  <td className="py-1.5 text-right font-bold text-zinc-100">{range.average.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Stat Breakdown Table + Source Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 pob-panel rounded-lg p-4">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-[#242a3c] text-zinc-400">
                <th className="py-1.5">{t(locale, 'calcs.stat')}</th>
                <th className="py-1.5 text-right">{t(locale, 'calcs.base')}</th>
                <th className="py-1.5 text-right">{t(locale, 'calcs.inc')}</th>
                <th className="py-1.5 text-right">{t(locale, 'calcs.more')}</th>
                <th className="py-1.5 text-right">{t(locale, 'calcs.total')}</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {calc.breakdowns.map((row, idx) => (
                <tr
                  key={row.label}
                  onClick={() => setSelectedIdx(idx)}
                  className={`border-b border-[#1b2030] cursor-pointer transition ${
                    idx === selectedIdx ? 'bg-amber-500/15' : 'hover:bg-[#191e2c]'
                  }`}
                >
                  <td className="py-2 font-sans font-medium text-zinc-200">
                    {uiText(locale, row.labelZh, row.label)}
                  </td>
                  <td className="py-2 text-right text-zinc-300">{Math.round(row.base).toLocaleString()}</td>
                  <td className="py-2 text-right text-sky-300">
                    {row.incPct >= 0 ? `+${Math.round(row.incPct)}%` : `${Math.round(row.incPct)}%`}
                  </td>
                  <td className="py-2 text-right text-amber-300">×{row.moreMultiplier.toFixed(2)}</td>
                  <td className="py-2 text-right font-bold text-emerald-300">
                    {Math.round(row.total).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Source Attribution Panel */}
        <div className="lg:col-span-5 pob-panel rounded-lg p-4">
          <h3 className="text-xs font-bold text-amber-200 border-b border-[#242a3c] pb-2 mb-2.5">
            {t(locale, 'calcs.sources')} —{' '}
            {selectedRow ? (uiText(locale, selectedRow.labelZh, selectedRow.label)) : ''}
          </h3>
          <div className="space-y-1 max-h-96 overflow-y-auto text-xs">
            {selectedRow?.sources.map((src, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-2 rounded bg-[#0c0e15] px-2.5 py-1.5 border border-[#1f2436]"
              >
                <span className="text-zinc-300 truncate">{src.source}</span>
                <span className="font-mono shrink-0">
                  <span className="text-[10px] px-1 py-0.5 rounded bg-[#1b2133] text-zinc-400 mr-1.5">
                    {src.type}
                  </span>
                  <span className="text-amber-200 font-semibold">
                    {typeof src.value === 'number'
                      ? src.type === 'BASE'
                        ? `+${src.value}`
                        : `${src.value}%`
                      : src.value}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Defence & Mitigation Overview Dashboard */}
      <div className="pob-panel rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#242a3c] pb-2">
          <h3 className="text-xs font-bold text-amber-200 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            {uiText(locale, '防御与减伤全景', 'Defence & Mitigation Overview')}
          </h3>
          <span className="text-[10px] font-mono text-emerald-300">
            {uiText(locale, '有效生命池', 'EHP')} {defence.effectiveHitPool.toLocaleString()}
          </span>
        </div>

        {/* Hit Pool Composition */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
            <span>{uiText(locale, '生命池构成', 'Hit Pool Composition')}</span>
            <span className="font-mono normal-case tracking-normal text-zinc-300">
              {hitPoolSegments
                .reduce((sum, segment) => sum + segment.value, 0)
                .toLocaleString()}
            </span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden flex bg-[#0a0c12]">
            {hitPoolSegments.map((segment) => (
              <div
                key={segment.key}
                className={`h-full transition-all ${segment.bar}`}
                style={{ width: `${segment.pct}%` }}
                title={`${segment.label} ${segment.value.toLocaleString()}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {hitPoolSegments.map((segment) => (
              <span
                key={segment.key}
                className="inline-flex items-center gap-1 rounded-full bg-[#0c0e15] border border-[#252b3d] px-2 py-0.5 text-[10px] font-mono"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${segment.bar}`} />
                <span className="text-zinc-400">{segment.label}</span>
                <span className={segment.text}>{segment.value.toLocaleString()}</span>
                <span className="text-zinc-500">({segment.pct.toFixed(0)}%)</span>
              </span>
            ))}
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/35 px-2 py-0.5 text-[10px] font-mono">
              <span className="text-zinc-400">EHP</span>
              <span className="text-emerald-300 font-semibold">
                {defence.effectiveHitPool.toLocaleString()}
              </span>
            </span>
          </div>
        </div>

        {/* Mitigation & Avoidance Meters */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#242a3c] pt-3">
          {mitigationMeters.map((meter) => (
            <div key={meter.key} className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-400 truncate">{meter.label}</span>
                <span className="font-mono font-semibold text-zinc-100 shrink-0">{meter.display}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-[#171c2b] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${meter.bar}`}
                  style={{ width: `${Math.max(2, Math.min(100, meter.pct))}%` }}
                />
              </div>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2 col-span-2">
            {(
              [
                [
                  uiText(locale, '最大物理承受', 'Max Phys Hit'),
                  defence.maxPhysHitTaken,
                  'text-amber-200',
                ],
                [
                  uiText(locale, '最大元素承受', 'Max Ele Hit'),
                  defence.maxEleHitTaken,
                  'text-sky-200',
                ],
              ] as const
            ).map(([label, value, tone]) => (
              <div
                key={label}
                className="rounded bg-[#0c0e15] border border-[#1f2436] px-2.5 py-1.5"
              >
                <div className="text-[10px] text-zinc-500">{label}</div>
                <div className={`font-mono font-bold text-sm ${tone}`}>{value.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Resistance Cap & Overcap Pills */}
        <div className="border-t border-[#242a3c] pt-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
            {uiText(locale, '抗性上限与溢出', 'Resistance Cap & Overcap')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {resistancePills.map((pill) => (
              <span
                key={pill.key}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono ${pill.tone}`}
              >
                <span className="font-semibold">{pill.label}</span>
                <span className="text-zinc-100">
                  {pill.current}/{pill.max}%
                </span>
                {pill.capped ? (
                  <span className="text-emerald-400">+{pill.overcap}%</span>
                ) : (
                  <span className="text-rose-400">-{pill.deficit}%</span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Level & Main Gem Progression Scaling Curve */}
      <div className="pob-panel rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#242a3c] pb-2">
          <h3 className="text-xs font-bold text-amber-200 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            {uiText(locale, '等级与主技能宝石成长曲线 (ROI 收益预测)', 'Level & Gem Progression Scaling Curve')}
          </h3>
          <div className="flex items-center gap-1 rounded bg-[#0a0c12] p-0.5 border border-[#252b3d] text-[11px]">
            <button
              type="button"
              onClick={() => setCurveMode('gem')}
              className={`px-2 py-0.5 rounded font-semibold cursor-pointer ${
                curveMode === 'gem'
                  ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {uiText(locale, '主技能宝石 Lv.18–30', 'Main Gem Lv.18–30')}
            </button>
            <button
              type="button"
              onClick={() => setCurveMode('char')}
              className={`px-2 py-0.5 rounded font-semibold cursor-pointer ${
                curveMode === 'char'
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {uiText(locale, '角色等级 Lv.60–100', 'Character Lv.60–100')}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          {progressionRows.map((row) => {
            const useEhpBar = curveMode === 'char' && isFlatDpsProgression;
            const barWidth = Math.max(
              4,
              Math.min(
                100,
                useEhpBar
                  ? (row.ehp / maxProgressionEhp) * 100
                  : (row.dps / maxProgressionDps) * 100,
              ),
            );
            return (
              <div
                key={row.key}
                className={`grid grid-cols-12 items-center gap-2 rounded px-2.5 py-1.5 text-xs font-mono ${
                  row.isCurrent
                    ? 'bg-amber-500/15 border border-amber-500/45'
                    : 'bg-[#0c0e15] border border-[#1d2233]'
                }`}
              >
                <div className="col-span-2 flex items-center gap-1.5 font-semibold text-zinc-200">
                  <span>{row.key}</span>
                  {row.isCurrent && (
                    <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/30 text-amber-200">
                      NOW
                    </span>
                  )}
                </div>
                <div className="col-span-3 sm:col-span-5">
                  <div className="h-2 w-full rounded-full bg-[#171c2b] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        useEhpBar
                          ? 'bg-gradient-to-r from-sky-600 to-cyan-300'
                          : row.isCurrent
                          ? 'bg-gradient-to-r from-amber-500 to-yellow-300'
                          : 'bg-gradient-to-r from-emerald-600 to-cyan-400'
                      }`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
                <div className="col-span-2 sm:col-span-2 text-right font-semibold text-zinc-100">
                  {Math.round(row.dps).toLocaleString()}
                </div>
                <div
                  className={`col-span-2 sm:col-span-1 text-right text-[10px] sm:text-[11px] ${
                    curveMode === 'char'
                      ? Math.abs(row.ehpPct) < 0.05
                        ? 'text-zinc-500'
                        : row.ehpPct > 0
                          ? 'text-sky-300'
                          : 'text-rose-400'
                      : Math.abs(row.dpsPct) < 0.05
                      ? 'text-zinc-500'
                      : row.dpsPct > 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                  }`}
                >
                  {curveMode === 'char' ? (
                    <>
                      ΔEHP {row.ehpPct > 0 ? '+' : ''}
                      {row.ehpPct.toFixed(1)}%
                    </>
                  ) : (
                    <>
                      {row.dpsPct > 0 ? '+' : ''}
                      {row.dpsPct.toFixed(1)}%
                    </>
                  )}
                </div>
                <div className="col-span-3 sm:col-span-2 text-right text-[10px] sm:text-[11px] text-sky-300">
                  {curveMode === 'char' ? (
                    <span className="text-zinc-400">
                      Life {row.life.toLocaleString()} · EHP {row.ehp.toLocaleString()}
                    </span>
                  ) : (
                    <>EHP {row.ehp.toLocaleString()}</>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick Combat Scenario & What-If Simulator */}
      <div className="pob-panel rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-[#242a3c] pb-2">
          <h3 className="text-xs font-bold text-amber-200 flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-amber-400" />
            {uiText(locale, '快速情景与假设收益模拟 (What-If)', 'Quick Combat Scenario & What-If Simulator')}
          </h3>
          <span className="text-[10px] text-zinc-400">
            {uiText(locale, '基于当前构筑实时重算', 'Simulated live from current build')}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {scenarioRows.map((row) => (
            <div
              key={row.id}
              className="rounded bg-[#0c0e15] border border-[#1f2436] px-3 py-2 flex flex-col justify-between gap-1.5"
            >
              <div className="text-xs text-zinc-200 font-medium">{row.label}</div>
              <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                <span
                  className={
                    Math.abs(row.dpsPct) < 0.05
                      ? 'text-zinc-500'
                      : row.dpsPct > 0
                        ? 'text-emerald-400 font-semibold'
                        : 'text-rose-400 font-semibold'
                  }
                >
                  DPS {row.dpsPct > 0 ? '+' : ''}
                  {row.dpsPct.toFixed(1)}%
                  <span className="text-[10px] text-zinc-400 font-normal ml-1">
                    ({Math.round(row.nextDps).toLocaleString()})
                  </span>
                </span>
                <span
                  className={
                    Math.abs(row.ehpPct) < 0.05
                      ? 'text-zinc-500'
                      : row.ehpPct > 0
                        ? 'text-sky-300 font-semibold'
                        : 'text-rose-400 font-semibold'
                  }
                >
                  EHP {row.ehpPct > 0 ? '+' : ''}
                  {row.ehpPct.toFixed(1)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Side-by-Side Build Compare (Current vs Saved Library / Baseline) */}
      {comparedCalc && comparedTarget && (
        <div className="pob-panel rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#242a3c] pb-2">
            <h3 className="text-xs font-bold text-amber-200 flex items-center gap-1.5">
              <GitCompare className="w-4 h-4 text-sky-400" />
              {uiText(locale, 'BD 属性对比 (当前构筑 vs 对比目标)', 'Build Compare (Current vs Target)')}
            </h3>
            <select
              value={comparedTarget.id}
              onChange={(e) => setCompareId(e.target.value)}
              className="pob-input rounded px-2.5 py-1 text-xs"
            >
              {compareTargets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-[#242a3c] text-zinc-400">
                  <th className="py-1.5">{uiText(locale, '核心指标', 'Metric')}</th>
                  <th className="py-1.5 text-right">{uiText(locale, '对比基准', 'Baseline')}</th>
                  <th className="py-1.5 text-right">{uiText(locale, '当前 BD', 'Current')}</th>
                  <th className="py-1.5 text-right">{uiText(locale, '差值 (Δ)', 'Delta (Δ)')}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {(
                  [
                    [uiText(locale, '总 DPS', 'Total DPS'), comparedCalc.offence.totalDps, calc.offence.totalDps, false],
                    [uiText(locale, '击中 DPS', 'Hit DPS'), comparedCalc.offence.hitDps, calc.offence.hitDps, false],
                    [uiText(locale, '攻击/施法速度', 'Speed (/s)'), comparedCalc.offence.speed, calc.offence.speed, true],
                    [uiText(locale, '暴击率 (%)', 'Crit Chance (%)'), comparedCalc.offence.critChance, calc.offence.critChance, true],
                    [uiText(locale, '最大生命', 'Maximum Life'), comparedCalc.defence.life, calc.defence.life, false],
                    [uiText(locale, '最大能量护盾', 'Energy Shield'), comparedCalc.defence.energyShield, calc.defence.energyShield, false],
                    [uiText(locale, '有效生命池 (EHP)', 'Effective Hit Pool'), comparedCalc.defence.effectiveHitPool, calc.defence.effectiveHitPool, false],
                    [uiText(locale, '护甲', 'Armour'), comparedCalc.defence.armour, calc.defence.armour, false],
                    [uiText(locale, '闪避值', 'Evasion'), comparedCalc.defence.evasion, calc.defence.evasion, false],
                    [uiText(locale, '物理最大承伤', 'Max Phys Hit'), comparedCalc.defence.maxPhysHitTaken, calc.defence.maxPhysHitTaken, false],
                    [uiText(locale, '元素最大承伤', 'Max Ele Hit'), comparedCalc.defence.maxEleHitTaken, calc.defence.maxEleHitTaken, false],
                  ] as Array<[string, number, number, boolean]>
                ).map(([label, baseVal, curVal, isFloat]) => {
                  const diff = curVal - baseVal;
                  const pct = baseVal > 0 ? (diff / baseVal) * 100 : curVal > 0 ? 100 : 0;
                  const fmt = (v: number) =>
                    isFloat ? v.toFixed(2) : Math.round(v).toLocaleString();
                  const color =
                    Math.abs(diff) < 0.01
                      ? 'text-zinc-500'
                      : diff > 0
                        ? 'text-emerald-400'
                        : 'text-rose-400';
                  return (
                    <tr key={label} className="border-b border-[#1b2030]">
                      <td className="py-1.5 font-sans text-zinc-200">{label}</td>
                      <td className="py-1.5 text-right text-zinc-400">{fmt(baseVal)}</td>
                      <td className="py-1.5 text-right font-semibold text-zinc-100">{fmt(curVal)}</td>
                      <td className={`py-1.5 text-right font-semibold ${color}`}>
                        {diff > 0 ? '+' : ''}
                        {fmt(diff)}
                        {Math.abs(diff) >= 0.01 && (
                          <span className="text-[10px] opacity-80 ml-1">
                            ({pct > 0 ? '+' : ''}
                            {pct.toFixed(1)}%)
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
