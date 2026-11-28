import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KeywordFlag,
  ModFlag,
  type Build,
  type CompiledGemMod,
  type Mod,
} from '@webpob/core';
import {
  findGemByName,
  getGemById,
  getGemsForGame,
  POE1_GEMS,
  POE2_GEMS,
  resolveGemFromPobRef,
  setRegisteredGems,
} from './gems.js';
import {
  registerGemsData,
  type CompactGemsPayload,
} from './treeLoader.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DATA_DIR = path.resolve(currentDir, '../../../apps/web/public/data');

interface CodecModule {
  xmlToBuild: (xml: string) => Build;
}

async function loadXmlToBuild(): Promise<(xml: string) => Build> {
  const codec = await vi.importActual<CodecModule>('@webpob/codec');
  return codec.xmlToBuild;
}

describe('Structured Gem SkillStatMap Contract, Hydrator & Transfigured Gem Lookup', () => {
  const initialPoe1Gems = getGemsForGame('poe1');
  const initialPoe2Gems = getGemsForGame('poe2');

  afterEach(() => {
    setRegisteredGems('poe1', initialPoe1Gems);
    setRegisteredGems('poe2', initialPoe2Gems);
  });

  it('hydrates cmods, sdata, stypes, reqTypes, addTypes, excTypes, altIds, mb, and per-level ls entries', () => {
    const sampleMod: Mod = {
      name: 'Damage',
      type: 'MORE',
      value: 35,
      flags: ModFlag.Attack,
      keywordFlags: KeywordFlag.Physical,
      source: 'Gem:HeavyStrikeTrarthus',
      target: 'skill',
    };
    expect(sampleMod.target).toBe('skill');

    const payload: CompactGemsPayload = {
      game: 'poe1',
      count: 4,
      gems: [
        {
          id: 'poe1_heavystrike_trarthus',
          altIds: ['HeavyStrikeTrarthus', 'HeavyStrikeAltY'],
          en: 'Heavy Strike of Trarthus',
          zh: '重击（塔图斯）',
          cat: 'active',
          color: 'red',
          tags: ['Attack', 'Melee', 'Strike', 'Physical'],
          stypes: ['Attack', 'Melee', 'MeleeSingleTarget', 'Multistrikeable'],
          am: 315,
          de: 315,
          asm: 0.85,
          mc: 10,
          st: ['20% chance to deal Double Damage'],
          cmods: [
            {
              n: 'DoubleDamageChance',
              t: 'BASE',
              v: 20,
              f: ModFlag.Attack | ModFlag.Melee,
              k: KeywordFlag.Attack,
              tg: 'skill',
              tags: [{ type: 'Condition', var: 'UsingTwoHandedWeapon' }],
            },
            {
              n: 'EnemyStunThreshold',
              t: 'INC',
              v: -25,
              tg: 'enemy',
            },
            {
              n: 'CannotBeEvaded',
              t: 'FLAG',
              v: false,
            },
            {
              n: 'AdditionalProjectiles',
              t: 'BASE',
              v: 0,
            },
          ],
          sdata: {
            attackSpeedMultiplier: 0.85,
            cooldown: 0,
            knockbackChance: 25,
          },
          ls: {
            '1': {
              am: 180,
              de: 180,
              mc: 6,
              cmods: [{ n: 'DoubleDamageChance', t: 'BASE', v: 12, tg: 'skill' }],
              sdata: { knockbackChance: 15 },
            },
            '20': {
              am: 315,
              de: 315,
              mc: 10,
              cmods: [
                {
                  n: 'DoubleDamageChance',
                  t: 'BASE',
                  v: 20,
                  f: ModFlag.Attack,
                  k: KeywordFlag.Hit,
                  tg: 'skill',
                },
              ],
              sdata: { knockbackChance: 25 },
            },
          },
        },
        {
          id: 'poe1_sup_custom_echo',
          altIds: ['SupportCustomEcho'],
          en: 'Custom Echo Support',
          zh: '自定义回响（辅）',
          cat: 'support',
          color: 'blue',
          tags: ['Support', 'Spell'],
          reqTypes: ['Spell', 'Damage', 'AND', 'Triggered', 'NOT'],
          addTypes: ['Repeatable'],
          excTypes: ['Channelling', 'Vaal', 'OR'],
          st: ['50% more Cast Speed', '10% less Damage'],
          cmods: [
            { n: 'Speed', t: 'MORE', v: 50, f: ModFlag.Cast, tg: 'skill' },
            { n: 'Damage', t: 'MORE', v: -10, tg: 'skill' },
            { n: 'ManaCost', t: 'MORE', v: 50, tg: 'player' },
          ],
          sdata: { repeatCount: 1 },
          ls: {
            '20': {
              cmods: [{ n: 'Speed', t: 'MORE', v: 54, f: ModFlag.Cast, tg: 'skill' }],
              sdata: { repeatCount: 1, manaMultiplier: 150 },
            },
          },
        },
        {
          id: 'poe1_summon_skeletons',
          altIds: ['SummonSkeletons'],
          en: 'Summon Skeletons',
          zh: '召唤魔侍',
          cat: 'active',
          color: 'blue',
          tags: ['Spell', 'Minion', 'Duration'],
          stypes: ['Spell', 'Minion', 'SummonsTotem', 'Duration'],
          ct: 0.5,
          mc: 20,
          mb: {
            pMin: 190,
            pMax: 285,
            aps: 1.25,
            cc: 5,
            cm: 130,
            moreAps: 15,
            ele: { Cold: [45, 70], Lightning: [10, 95] },
            limitStat: 'ActiveSkeletonLimit',
            baseLimit: 7,
          },
          cmods: [
            { n: 'ActiveSkeletonLimit', t: 'BASE', v: 7, tg: 'player' },
            { n: 'Damage', t: 'MORE', v: 50, tg: 'minion' },
          ],
          sdata: { minionLevel: 70 },
        },
        {
          // Curated gem enrichment: Summon Raging Spirit merges structured fields + mb extensions
          id: 'poe1_summonragingspirit',
          altIds: ['SummonRagingSpirit', 'Metadata/Items/Gems/SkillGemSummonRagingSpirit'],
          en: 'Summon Raging Spirit',
          zh: '召唤愤怒狂灵',
          cat: 'active',
          color: 'blue',
          tags: ['Spell', 'Minion', 'Fire', 'Duration'],
          stypes: ['Spell', 'Minion', 'Duration'],
          cmods: [{ n: 'ActiveRagingSpiritLimit', t: 'BASE', v: 20, tg: 'player' }],
          sdata: { activeSkillLimit: 20 },
          mb: {
            pMin: 158,
            pMax: 237,
            aps: 1.754,
            cc: 5,
            cm: 130,
            moreAps: 40,
            ele: { Fire: [25, 45] },
            limitStat: 'ActiveRagingSpiritLimit',
            baseLimit: 20,
          },
          ls: {
            '20': {
              cmods: [{ n: 'MinionDamage', t: 'MORE', v: 38, tg: 'minion' }],
              sdata: { minionLevel: 70 },
            },
          },
        },
      ],
    };

    registerGemsData('poe1', payload);

    // 1. Active gem hydration
    const hsTrarthus = getGemById('poe1', 'poe1_heavystrike_trarthus');
    expect(hsTrarthus).toBeDefined();
    expect(hsTrarthus!.altIds).toEqual(['HeavyStrikeTrarthus', 'HeavyStrikeAltY']);
    expect(hsTrarthus!.skillTypes).toEqual(['Attack', 'Melee', 'MeleeSingleTarget', 'Multistrikeable']);
    expect(hsTrarthus!.compiledMods).toEqual<CompiledGemMod[]>([
      {
        name: 'DoubleDamageChance',
        type: 'BASE',
        value: 20,
        flags: ModFlag.Attack | ModFlag.Melee,
        keywordFlags: KeywordFlag.Attack,
        target: 'skill',
        tags: [{ type: 'Condition', var: 'UsingTwoHandedWeapon' }],
      },
      {
        name: 'EnemyStunThreshold',
        type: 'INC',
        value: -25,
        flags: 0,
        keywordFlags: 0,
        target: 'enemy',
      },
      {
        name: 'CannotBeEvaded',
        type: 'FLAG',
        value: false,
        flags: 0,
        keywordFlags: 0,
      },
      {
        name: 'AdditionalProjectiles',
        type: 'BASE',
        value: 0,
        flags: 0,
        keywordFlags: 0,
      },
    ]);
    expect(hsTrarthus!.skillData).toEqual({
      attackSpeedMultiplier: 0.85,
      cooldown: 0,
      knockbackChance: 25,
    });
    expect(hsTrarthus!.levelScaling?.[1]).toEqual({
      attackDamageMultiplierPct: 180,
      damageEffectivenessPct: 180,
      manaCost: 6,
      compiledMods: [
        {
          name: 'DoubleDamageChance',
          type: 'BASE',
          value: 12,
          flags: 0,
          keywordFlags: 0,
          target: 'skill',
        },
      ],
      skillData: { knockbackChance: 15 },
    });
    expect(hsTrarthus!.levelScaling?.[20]?.compiledMods?.[0]).toEqual({
      name: 'DoubleDamageChance',
      type: 'BASE',
      value: 20,
      flags: ModFlag.Attack,
      keywordFlags: KeywordFlag.Hit,
      target: 'skill',
    });
    expect(hsTrarthus!.levelScaling?.[20]?.skillData).toEqual({ knockbackChance: 25 });

    // 2. Support gem RPN type expressions + cmods/sdata hydration
    const customEcho = getGemById('poe1', 'SupportCustomEcho');
    expect(customEcho).toBeDefined();
    expect(customEcho!.id).toBe('poe1_sup_custom_echo');
    expect(customEcho!.requireSkillTypes).toEqual(['Spell', 'Damage', 'AND', 'Triggered', 'NOT']);
    expect(customEcho!.addSkillTypes).toEqual(['Repeatable']);
    expect(customEcho!.excludeSkillTypes).toEqual(['Channelling', 'Vaal', 'OR']);
    expect(customEcho!.compiledMods).toHaveLength(3);
    expect(customEcho!.compiledMods![2]).toEqual({
      name: 'ManaCost',
      type: 'MORE',
      value: 50,
      flags: 0,
      keywordFlags: 0,
      target: 'player',
    });
    expect(customEcho!.skillData).toEqual({ repeatCount: 1 });
    expect(customEcho!.levelScaling?.[20]?.skillData).toEqual({
      repeatCount: 1,
      manaMultiplier: 150,
    });
    expect(customEcho!.levelScaling?.[20]?.compiledMods).toEqual([
      {
        name: 'Speed',
        type: 'MORE',
        value: 54,
        flags: ModFlag.Cast,
        keywordFlags: 0,
        target: 'skill',
      },
    ]);

    // 3. Synthesized Minion gem mb hydration
    const skeletons = getGemById('poe1', 'SummonSkeletons');
    expect(skeletons).toBeDefined();
    expect(skeletons!.minionBase).toEqual({
      physicalMin: 190,
      physicalMax: 285,
      attacksPerSecond: 1.25,
      critChance: 5,
      critMultiplier: 130,
      moreAttackSpeedPct: 15,
      elementalDamage: { Cold: [45, 70], Lightning: [10, 95] },
      limitStat: 'ActiveSkeletonLimit',
      baseLimit: 7,
    });
    expect(skeletons!.compiledMods?.[1]?.target).toBe('minion');

    // 4. Curated gem enrichment preserves canonical ID while hydrating structured fields & altIds
    const srs = getGemById('poe1', 'poe1_summon_raging_spirit');
    expect(srs).toBeDefined();
    expect(getGemById('poe1', 'poe1_summonragingspirit')?.id).toBe('poe1_summon_raging_spirit');
    expect(getGemById('poe1', 'SummonRagingSpirit')?.id).toBe('poe1_summon_raging_spirit');
    expect(srs!.skillTypes).toEqual(['Spell', 'Minion', 'Duration']);
    expect(srs!.skillData).toEqual({ activeSkillLimit: 20 });
    expect(srs!.minionBase).toEqual({
      physicalMin: 158,
      physicalMax: 237,
      attacksPerSecond: 1.754,
      critChance: 5,
      critMultiplier: 130,
      moreAttackSpeedPct: 40,
      elementalDamage: { Fire: [25, 45] },
      limitStat: 'ActiveRagingSpiritLimit',
      baseLimit: 20,
    });
    expect(srs!.levelScaling?.[20]?.compiledMods?.[0]?.target).toBe('minion');
  });

  it('indexes gems by id, case-insensitive altIds, exact EN/ZH names, and without-support fallback', () => {
    const payload: CompactGemsPayload = {
      game: 'poe1',
      count: 5,
      gems: [
        {
          id: 'poe1_heavystrike',
          altIds: ['HeavyStrike', 'Metadata/Items/Gems/SkillGemHeavyStrike'],
          en: 'Heavy Strike',
          zh: '重击',
          cat: 'active',
          color: 'red',
          tags: ['Attack', 'Melee'],
        },
        {
          id: 'poe1_heavystrike_trarthus',
          altIds: ['HeavyStrikeTrarthus', 'HeavyStrikeAltY'],
          en: 'Heavy Strike of Trarthus',
          zh: '重击（塔图斯）',
          cat: 'active',
          color: 'red',
          tags: ['Attack', 'Melee'],
        },
        {
          id: 'poe1_blight_atrophy',
          altIds: ['BlightAltY'],
          en: 'Blight of Atrophy',
          zh: '枯萎（萎缩）',
          cat: 'active',
          color: 'blue',
          tags: ['Spell', 'Chaos'],
        },
        {
          id: 'poe1_barrage',
          altIds: ['Barrage'],
          en: 'Barrage',
          zh: '弹幕',
          cat: 'active',
          color: 'green',
          tags: ['Attack', 'Projectile'],
        },
        {
          id: 'poe1_supportbarrage',
          altIds: ['SupportBarrage'],
          en: 'Barrage Support',
          zh: '弹幕（辅）',
          cat: 'support',
          color: 'green',
          tags: ['Support', 'Attack', 'Projectile'],
        },
      ],
    };

    registerGemsData('poe1', payload);

    // ID & case-insensitive altIds lookup
    expect(getGemById('poe1', 'poe1_heavystrike_trarthus')?.name.en).toBe('Heavy Strike of Trarthus');
    expect(getGemById('poe1', 'HeavyStrikeTrarthus')?.id).toBe('poe1_heavystrike_trarthus');
    expect(getGemById('poe1', 'heavystriketrarthus')?.id).toBe('poe1_heavystrike_trarthus');
    expect(getGemById('poe1', 'blightalty')?.id).toBe('poe1_blight_atrophy');
    expect(getGemById('poe1', 'Metadata/Items/Gems/SkillGemHeavyStrike')?.id).toBe('poe1_heavystrike');

    // Exact EN/ZH name & " Support" suffix fallback
    expect(findGemByName('poe1', 'Heavy Strike of Trarthus')?.id).toBe('poe1_heavystrike_trarthus');
    expect(findGemByName('poe1', 'heavy strike of trarthus')?.id).toBe('poe1_heavystrike_trarthus');
    expect(findGemByName('poe1', '重击（塔图斯）')?.id).toBe('poe1_heavystrike_trarthus');
    expect(findGemByName('poe1', '电弧')?.id).toBe('poe1_arc');
    expect(findGemByName('poe1', 'Spell Echo')?.id).toBe('poe1_sup_spell_echo');
    expect(findGemByName('poe1', 'Spell Echo Support')?.id).toBe('poe1_sup_spell_echo');

    // Active "Barrage" and Support "Barrage Support" both coexist and resolve accurately
    expect(findGemByName('poe1', 'Barrage')?.id).toBe('poe1_barrage');
    expect(findGemByName('poe1', 'Barrage Support')?.id).toBe('poe1_supportbarrage');
    expect(getGemById('poe1', 'SupportBarrage')?.id).toBe('poe1_supportbarrage');
  });

  it('resolves Transfigured Gem XML with base gemId to the transfigured gem rather than base Heavy Strike', async () => {
    const payload: CompactGemsPayload = {
      game: 'poe1',
      count: 5,
      gems: [
        {
          id: 'poe1_heavystrike',
          altIds: ['HeavyStrike', 'Metadata/Items/Gems/SkillGemHeavyStrike'],
          en: 'Heavy Strike',
          zh: '重击',
          cat: 'active',
          color: 'red',
          tags: ['Attack', 'Melee', 'Physical'],
          am: 250,
        },
        {
          id: 'poe1_heavystrike_trarthus',
          altIds: ['HeavyStrikeTrarthus', 'HeavyStrikeAltY'],
          en: 'Heavy Strike of Trarthus',
          zh: '重击（塔图斯）',
          cat: 'active',
          color: 'red',
          tags: ['Attack', 'Melee', 'Physical'],
          am: 315,
        },
        {
          id: 'poe1_blight',
          altIds: ['Blight', 'Metadata/Items/Gems/SkillGemBlight'],
          en: 'Blight',
          zh: '枯萎',
          cat: 'active',
          color: 'blue',
          tags: ['Spell', 'Chaos', 'Area'],
        },
        {
          id: 'poe1_blight_atrophy',
          altIds: ['BlightAltY'],
          en: 'Blight of Atrophy',
          zh: '枯萎（萎缩）',
          cat: 'active',
          color: 'blue',
          tags: ['Spell', 'Chaos', 'Area'],
        },
        {
          id: 'poe1_exsanguinate',
          altIds: ['Exsanguinate', 'Metadata/Items/Gems/SkillGemExsanguinate'],
          en: 'Exsanguinate',
          zh: '赤炼魔光',
          cat: 'active',
          color: 'red',
          tags: ['Spell', 'Physical'],
        },
        {
          // Deliberately omit altIds to verify exact nameSpec still beats base gemId!
          id: 'poe1_exsanguinate_transmission',
          en: 'Exsanguinate of Transmission',
          zh: '传导之赤炼魔光',
          cat: 'active',
          color: 'red',
          tags: ['Spell', 'Physical'],
        },
      ],
    };
    registerGemsData('poe1', payload);

    // 1. Direct resolveGemFromPobRef checks
    expect(
      resolveGemFromPobRef('poe1', {
        skillId: 'HeavyStrikeTrarthus',
        variantId: 'HeavyStrikeTrarthus',
        gemId: 'Metadata/Items/Gems/SkillGemHeavyStrike',
        nameSpec: 'Heavy Strike of Trarthus',
      })?.id,
    ).toBe('poe1_heavystrike_trarthus');

    // Even when skillId/variantId are unrecognized, exact nameSpec STILL beats base gemId
    expect(
      resolveGemFromPobRef('poe1', {
        skillId: 'UnknownFutureAlias',
        variantId: 'UnknownFutureAlias',
        gemId: 'Metadata/Items/Gems/SkillGemExsanguinate',
        nameSpec: 'Exsanguinate of Transmission',
      })?.id,
    ).toBe('poe1_exsanguinate_transmission');

    // Even with empty nameSpec, skillId/variantId resolves BlightAltY instead of base Blight gemId
    expect(
      resolveGemFromPobRef('poe1', {
        skillId: 'BlightAltY',
        variantId: 'BlightAltY',
        gemId: 'Metadata/Items/Gems/SkillGemBlight',
        nameSpec: '',
      })?.id,
    ).toBe('poe1_blight_atrophy');

    // Fallback to base gemId works cleanly when no more specific skillId/variantId/nameSpec matches
    expect(
      resolveGemFromPobRef('poe1', {
        gemId: 'Metadata/Items/Gems/SkillGemHeavyStrike',
      })?.id,
    ).toBe('poe1_heavystrike');

    // 2. End-to-end XML decoding via @webpob/codec xmlToBuild
    const xmlToBuild = await loadXmlToBuild();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="95" className="Marauder" ascendClassName="Juggernaut" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec treeVersion="3_30" nodes="47175" /></Tree>
  <Skills activeSkillSet="1">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" label="Transfigured Main">
        <Gem skillId="HeavyStrikeTrarthus" variantId="HeavyStrikeTrarthus" gemId="Metadata/Items/Gems/SkillGemHeavyStrike" nameSpec="Heavy Strike of Trarthus" level="20" quality="20" enabled="true" />
        <Gem skillId="UnknownExsangAlias" variantId="UnknownExsangAlias" gemId="Metadata/Items/Gems/SkillGemExsanguinate" nameSpec="Exsanguinate of Transmission" level="21" quality="20" enabled="true" />
        <Gem skillId="BlightAltY" variantId="BlightAltY" gemId="Metadata/Items/Gems/SkillGemBlight" nameSpec="" level="20" quality="0" enabled="true" />
        <Gem gemId="Metadata/Items/Gems/SkillGemHeavyStrike" level="20" quality="0" enabled="true" />
      </Skill>
    </SkillSet>
  </Skills>
</PathOfBuilding>`;

    const build = xmlToBuild(xml);
    expect(build.skills).toHaveLength(1);
    const resolvedIds = build.skills[0]!.gems.map((g) => g.gemId);
    expect(resolvedIds).toEqual([
      'poe1_heavystrike_trarthus',
      'poe1_exsanguinate_transmission',
      'poe1_blight_atrophy',
      'poe1_heavystrike',
    ]);
  });

  it('resolves PoE 2 variant gems and real poe1-gems.json transfigured Heavy Strike of Trarthus XML', async () => {
    // PoE 2 variant support gem whose legacy gemId points to MartialTempoTwo
    registerGemsData('poe2', {
      game: 'poe2',
      count: 2,
      gems: [
        {
          id: 'poe2_sup_martial_tempo_legacy',
          altIds: ['Metadata/Items/Gems/SupportGemMartialTempoTwo'],
          en: 'Legacy Martial Tempo II',
          zh: '旧版武术节拍 II',
          cat: 'support',
          color: 'green',
          tags: ['Support', 'Attack'],
        },
        {
          id: 'poe2_rapidattackssupporttwo',
          altIds: ['SupportRapidAttacksPlayerTwo', 'RapidAttacksSupportTwo'],
          en: 'Rapid Attacks II',
          zh: '疾速攻击 II',
          cat: 'support',
          color: 'green',
          tags: ['Support', 'Attack'],
          reqTypes: ['Attack'],
          cmods: [{ n: 'Speed', t: 'MORE', v: 25, f: ModFlag.Attack, tg: 'skill' }],
        },
      ],
    });

    const xmlToBuild = await loadXmlToBuild();
    const poe2Xml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="92" className="Warrior" ascendClassName="Titan" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec treeVersion="0_5" nodes="1" /></Tree>
  <Skills activeSkillSet="1">
    <SkillSet id="1">
      <Skill enabled="true" label="PoE2 Variant">
        <Gem gemId="Metadata/Items/Gems/SupportGemMartialTempoTwo" nameSpec="Rapid Attacks II" skillId="SupportRapidAttacksPlayerTwo" variantId="RapidAttacksSupportTwo" level="1" quality="0" enabled="true" />
      </Skill>
    </SkillSet>
  </Skills>
</PathOfBuilding2>`;

    const poe2Build = xmlToBuild(poe2Xml);
    expect(poe2Build.skills[0]!.gems[0]!.gemId).toBe('poe2_rapidattackssupporttwo');

    // Real poe1-gems.json payload + real poe.ninja Heavy Strike of Trarthus XML
    const realPoe1Gems = JSON.parse(
      fs.readFileSync(path.join(PUBLIC_DATA_DIR, 'poe1-gems.json'), 'utf8'),
    ) as CompactGemsPayload;
    registerGemsData('poe1', realPoe1Gems);

    const realPoe1Xml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="100" className="Marauder" ascendClassName="Juggernaut" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec treeVersion="3_30" nodes="47175" /></Tree>
  <Skills activeSkillSet="1">
    <SkillSet id="1">
      <Skill enabled="true" label="Heavy Strike Trarthus">
        <Gem gemId="Metadata/Items/Gems/SkillGemHeavyStrike" variantId="HeavyStrikeAltY" skillId="HeavyStrikeAltY" nameSpec="Heavy Strike of Trarthus" level="20" quality="20" enabled="true" />
        <Gem gemId="Metadata/Items/Gems/SupportGemBarrage" variantId="SupportBarrage" skillId="SupportBarrage" nameSpec="Barrage" level="20" quality="0" enabled="true" />
      </Skill>
    </SkillSet>
  </Skills>
</PathOfBuilding>`;

    const realBuild = xmlToBuild(realPoe1Xml);
    expect(realBuild.skills[0]!.gems.map((g) => g.gemId)).toEqual([
      'poe1_heavystrikealty',
      'poe1_supportbarrage',
    ]);

    // Sanity check curated defaults remain clean when restored
    setRegisteredGems('poe1', POE1_GEMS);
    setRegisteredGems('poe2', POE2_GEMS);
    expect(getGemById('poe1', 'poe1_arc')?.name.en).toBe('Arc');
    expect(getGemById('poe2', 'poe2_spark')?.name.en).toBe('Spark');
  });

  it('remaps PoE 2 legacy v0.1/v0.2 support gems to canonical poe2-gems.json entries without obsolete MORE hijacking', () => {
    const realPoe2Gems = JSON.parse(
      fs.readFileSync(path.join(PUBLIC_DATA_DIR, 'poe2-gems.json'), 'utf8'),
    ) as CompactGemsPayload;
    registerGemsData('poe2', realPoe2Gems);

    try {
      const martialTempo = resolveGemFromPobRef('poe2', {
        gemId: 'Metadata/Items/Gems/SupportGemMartialTempo',
        nameSpec: 'Martial Tempo',
        skillId: 'SupportFasterAttackPlayer',
      });
      expect(martialTempo?.id).toBe('poe2_rapidattackssupport');
      expect(martialTempo?.name.en).toBe('Rapid Attacks I');
      expect(martialTempo?.compiledMods?.some((m) => m.name === 'Speed' && m.type === 'INC' && m.value === 15)).toBe(true);
      expect(martialTempo?.compiledMods?.some((m) => m.name === 'Speed' && m.type === 'MORE')).toBe(false);

      const arcaneTempo = resolveGemFromPobRef('poe2', {
        gemId: 'Metadata/Items/Gems/SupportGemArcaneTempo',
        nameSpec: 'Arcane Tempo',
        skillId: 'SupportFasterCastPlayer',
      });
      expect(arcaneTempo?.id).toBe('poe2_rapidcastingsupport');
      expect(arcaneTempo?.name.en).toBe('Rapid Casting I');
      expect(arcaneTempo?.compiledMods?.some((m) => m.name === 'Speed' && m.type === 'INC' && m.value === 15)).toBe(true);

      const primalArmament = resolveGemFromPobRef('poe2', {
        gemId: 'Metadata/Items/Gems/SupportGemPrimalArmament',
        nameSpec: 'Primal Armament',
      });
      expect(primalArmament?.id).toBe('poe2_elementalarmamentsupport');
      expect(primalArmament?.name.en).toBe('Elemental Armament I');
      expect(primalArmament?.compiledMods?.some((m) => m.name === 'ElementalDamage' && m.type === 'MORE' && m.value === 20)).toBe(true);

      const concEffect = resolveGemFromPobRef('poe2', {
        gemId: 'Metadata/Items/Gems/SupportGemConcentratedEffect',
        nameSpec: 'Concentrated Effect',
      });
      expect(concEffect?.id).toBe('poe2_concentratedareasupport');

      const scattershot = resolveGemFromPobRef('poe2', {
        gemId: 'Metadata/Items/Gems/SupportGemScattershot',
        nameSpec: 'Scattershot',
      });
      expect(scattershot?.id).toBe('poe2_multishotsupport');

      const precision = resolveGemFromPobRef('poe2', { nameSpec: 'Precision' });
      expect(precision?.id).toBe('poe2_heightenedaccuracysupport');

      const inspiration = resolveGemFromPobRef('poe2', { nameSpec: 'Inspiration' });
      expect(inspiration?.id).toBe('poe2_efficiencysupport');

      const magnified = resolveGemFromPobRef('poe2', { nameSpec: 'Magnified Effect' });
      expect(magnified?.id).toBe('poe2_magnifiedareasupport');

      const spellTotem = resolveGemFromPobRef('poe2', {
        skillId: 'SupportMetaTotemSpellTotemPlayer',
        nameSpec: 'Spell Totem',
      });
      expect(spellTotem?.id).toBe('poe2_metaspelltotem');

      // Sample build backward compatibility for poe2_sup_* IDs
      expect(getGemById('poe2', 'poe2_sup_arcane_tempo')?.id).toBe('poe2_rapidcastingsupport');
      expect(getGemById('poe2', 'poe2_sup_lightning_infusion')?.id).toBe('poe2_addedlightningdamagesupport');
    } finally {
      setRegisteredGems('poe2', POE2_GEMS);
    }
  });
});
