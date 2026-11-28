import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { hydrateCompactTree, registerTreeData, setLatestTreeVersion } from '@webpob/data';
import { normalizeStatLineToEn } from '@webpob/i18n';
import {
  cleanWeGameMarkup,
  extractWeGamePoe2ShareCode,
  isWeGamePoe2ShareUrl,
  parseWeGamePoe2Build,
  type WeGamePoe2Bundle,
} from './wegameImporter.js';
import { buildToPobXml, xmlToBuild } from './pobCode.js';

beforeAll(() => {
  const treePath = path.resolve(process.cwd(), 'apps/web/public/data/poe2-tree-0_5.json');
  if (fs.existsSync(treePath)) {
    const raw = JSON.parse(fs.readFileSync(treePath, 'utf8'));
    registerTreeData(hydrateCompactTree(raw));
    setLatestTreeVersion('poe2', '0_5');
  }
});

describe('wegameImporter URL & markup helpers', () => {
  it('extracts share hashes from WeGame PoE 2 helper URLs', () => {
    const code = 'ExampleShareCode1234567890_ABCDEF-xyz';
    expect(extractWeGamePoe2ShareCode(`https://www.wegame.com.cn/helper/poe2/#/share/${code}`)).toBe(code);
    expect(extractWeGamePoe2ShareCode(`https://wegame.com.cn/helper/poe2/#/share/${code}?from=test`)).toBe(code);
    expect(isWeGamePoe2ShareUrl(`https://www.wegame.com.cn/helper/poe2/#/share/${code}`)).toBe(true);
    expect(isWeGamePoe2ShareUrl('https://pobb.in/abc12345')).toBe(false);
    expect(extractWeGamePoe2ShareCode('https://example.test/share/short')).toBeNull();
  });

  it('strips PoE 2 inline keyword markup cleanly', () => {
    expect(cleanWeGameMarkup('[Resistances|闪电抗性] +37%')).toBe('闪电抗性 +37%');
    expect(cleanWeGameMarkup('[ShamanOnlyMods|羁绊]： +40 生命上限')).toBe('羁绊： +40 生命上限');
  });

  it('normalizes PoE 2 WeGame Chinese stat lines into canonical English mods', () => {
    expect(normalizeStatLineToEn('+45 生命上限')).toBe('+45 to maximum Life');
    expect(normalizeStatLineToEn('[ShamanOnlyMods|羁绊]： +40 生命上限')).toBe('Bonded: +40 to maximum Life');
    expect(normalizeStatLineToEn('[ShamanOnlyMods|羁绊]： +40 魔力上限')).toBe('Bonded: +40 to maximum Mana');
    expect(normalizeStatLineToEn('+297 点[Evasion|闪避]值')).toBe('+297 to Evasion Rating');
    expect(normalizeStatLineToEn('[Evasion|闪避]值提高 109%')).toBe('109% increased Evasion Rating');
    expect(normalizeStatLineToEn('[Resistances|闪电抗性] +37%')).toBe('+37% to Lightning Resistance');
    expect(normalizeStatLineToEn('所有[ElementalDamage|元素][Resistances|抗性] +16%')).toBe(
      '+16% to all Elemental Resistances',
    );
    expect(normalizeStatLineToEn('[CriticalDamageBonus|暴击伤害加成]提高 26%')).toBe(
      '+26% to Global Critical Strike Multiplier',
    );
    expect(normalizeStatLineToEn('该武器的[Attack|攻击]穿透 18% 的火焰抗性')).toBe(
      'Damage Penetrates 18% Fire Resistance',
    );
  });
});

describe('parseWeGamePoe2Build', () => {
  it('converts a synthetic WeGame PoE 2 bundle into a complete WebPoB Build', () => {
    const bundle: WeGamePoe2Bundle = {
      shareCode: 'SyntheticShareCode0000000001',
      roleInfo: {
        role: {
          role_id: '100001',
          name: 'TestExile',
          level: 95,
          class_name: 'Stormweaver',
        },
      },
      roleProfile: {
        skills: [{ name: 'spark', total_dps: '123456' }],
      },
      talentTree: {
        talent_tree: {
          hashes: [1001, 1002, 1003],
          specialisations: {
            set1: [2001, 2002],
            set2: [3001, 3002],
          },
          quest_stats: ['+20 生命上限', '[Resistances|火焰抗性] +10%'],
        },
      },
      equipments: {
        equipments: [
          {
            id: 'aaaa111122223333',
            inventoryId: 'BodyArmour',
            frameType: 2,
            rarity: 'Rare',
            name: '测试护甲',
            baseType: '滑击背心',
            properties: [
              { name: '[Quality|品质]', values: [['+20%', 1]] },
              { name: '[Evasion|闪避值]', values: [['2400', 1]] },
            ],
            explicitMods: [
              { description: '+85 生命上限' },
              { description: '[Resistances|闪电抗性] +37%' },
            ],
            runeMods: ['[ShamanOnlyMods|羁绊]： +40 生命上限'],
          },
          {
            id: 'bbbb111122223333',
            inventoryId: 'Weapon',
            frameType: 2,
            rarity: 'Rare',
            name: '测试武器',
            baseType: '翱翔战矛',
            properties: [
              { name: '[Physical|物理]伤害', values: [['40-80', 1]] },
              { name: '[Critical|暴击]率', values: [['6.50%', 0]] },
              { name: '每秒攻击次数', values: [['2.10', 1]] },
            ],
            explicitMods: [{ description: '[Attack|攻击]速度提高 20%' }],
          },
          {
            id: 'cccc111122223333',
            inventoryId: 'Flask',
            frameType: 1,
            rarity: 'Magic',
            baseType: '融冰咒符',
            properties: [{ name: '咒符', values: [] }],
            implicitMods: [{ description: '陷入[Frozen|冻结]时自动使用' }],
          },
          {
            id: 'dddd111122223333',
            inventoryId: 'Flask',
            frameType: 3,
            rarity: 'Unique',
            baseType: '终极生命药剂',
            properties: [],
          },
        ],
      },
      skills: {
        skills: [
          {
            inventoryId: 'SkillSlots',
            baseType: 'Spark',
            properties: [
              { name: '等级', values: [['21', 1]] },
              { name: '品质', values: [['+20%', 1]] },
            ],
            socketedItems: [
              {
                baseType: 'Controlled Destruction II',
                properties: [{ name: '等级', values: [['20(最高等级)', 0]] }],
              },
            ],
          },
        ],
      },
      jewels: {
        jewel_data: JSON.stringify([
          {
            socket_id: 'PassiveJewel_4',
            socket_name: '珠宝插槽4',
            jewel: {
              id: 'eeee111122223333',
              display_name: '测试珠宝',
              name: '宝钻',
              rarity: 3,
              mod_descriptions: [{ type: 0, values: ['[Gain|获得]相当于伤害 10% 的额外[Cold|冰霜]伤害'] }],
            },
          },
        ]),
      },
    };

    const build = parseWeGamePoe2Build(bundle);
    expect(build.game).toBe('poe2');
    expect(build.level).toBe(95);
    expect(build.ascendancyId).toBe('Stormweaver');
    expect(build.tree.allocatedNodeIds).toEqual(expect.arrayContaining([1001, 1002, 1003]));
    expect(build.tree.weaponSet1NodeIds).toEqual([2001, 2002]);
    expect(build.tree.weaponSet2NodeIds).toEqual([3001, 3002]);

    const bodyId = build.equipped['Body Armour'];
    expect(bodyId).toBeDefined();
    expect(build.items[bodyId!]!.armourStats?.evasion).toBe(2400);
    expect(build.items[bodyId!]!.localStatsPrecomputed).toBe(true);
    expect(build.items[bodyId!]!.explicits).toContain('+85 to maximum Life');
    expect(build.items[bodyId!]!.implicits).toContain('Bonded: +40 to maximum Life');

    const wepId = build.equipped['Weapon 1'];
    expect(wepId).toBeDefined();
    expect(build.items[wepId!]!.weaponStats?.physicalMax).toBe(80);
    expect(build.items[wepId!]!.weaponStats?.attacksPerSecond).toBe(2.1);

    expect(build.equipped['Charm 1']).toBeDefined();
    expect(build.equipped['Flask 1']).toBeDefined();
    expect(build.skills.length).toBeGreaterThanOrEqual(1);
    expect(build.skills[0]!.gems[0]!.level).toBe(21);
    expect(build.skills[0]!.gems[0]!.quality).toBe(20);
    expect(build.notes).toContain('123,456');
    expect(build.notes).toContain('测试珠宝');
  });

  it('parses Sceptre native Spirit property, selects Weapon Set 2 when needed, and respects item-granted 0-Spirit auras', () => {
    const bundle: WeGamePoe2Bundle = {
      roleInfo: {
        role: { role_id: '20001', name: 'SpiritTester', level: 96, class_name: 'Spirit Walker' },
      },
      talentTree: {
        talent_tree: {
          hashes: [4367, 26294],
          quest_stats: [
            '+100 [Spirit|精魂]',
            '+20 生命上限',
            '生命上限提高 5%',
            '[Resistances|闪电抗性] +10%',
            '+5 [Strength|力量]',
            '魔力再生率提高 25%',
            '59 个[BrokenFace|毁面首领]',
          ],
        },
      },
      equipments: {
        equipments: [
          {
            id: 'amulet1',
            inventoryId: 'Amulet',
            frameType: 2,
            baseType: '翠玉项链',
            explicitMods: [{ description: '+33 [Spirit|精魂]' }],
          },
          {
            id: 'sceptre1',
            inventoryId: 'Offhand2',
            frameType: 3,
            name: '神圣之火',
            baseType: '圣地权杖',
            properties: [{ name: '[Spirit|精魂]', type: 25, values: [['115', 1]] }],
            runeMods: ['该装备[Spirit|精魂]提高 15%'],
          },
        ],
      },
      skills: {
        skills: [
          {
            inventoryId: null,
            baseType: 'Herald of Ice',
            properties: [{ name: '等级', values: [['19', 0]] }],
          },
          {
            inventoryId: 'SkillSlots',
            baseType: 'Archmage',
            properties: [
              { name: '等级', values: [['20', 0]] },
              { name: '保留', values: [['150 [Spirit|精魂]', 0]] },
            ],
          },
        ],
      },
    };

    const build = parseWeGamePoe2Build(bundle);
    const sceptreId = build.equipped['Weapon 2 Swap'];
    expect(sceptreId).toBeDefined();
    expect(build.items[sceptreId!]!.implicits).toContain('+115 to Spirit');
    expect(build.items[sceptreId!]!.implicits.some((l) => l.includes('提高 15%'))).toBe(false);
    expect(build.activeWeaponSet).toBe(2);
    expect(build.skills[0]!.gems[0]!.spiritReservationOverride).toBe(0);
    expect(build.skills[1]!.gems[0]!.spiritReservationOverride).toBe(150);
    expect(build.config.customMods).toContain('+5 to Strength');
    expect(build.config.customMods).toContain('25% increased Mana Regeneration Rate');
    // Fixed campaign baselines already in POE2_RULESET must NOT be double-counted in customMods
    expect(build.config.customMods).not.toContain('+20 to maximum Life');
    expect(build.config.customMods).not.toContain('5% increased maximum Life');
    expect(build.config.customMods).not.toContain('+10% to Lightning Resistance');
    expect(build.config.customMods).not.toContain('+100 to Spirit');
    expect(build.config.customMods).not.toContain('毁面首领');
  });

  it('parses skill_overrides, slot-safe uniques, anoints, Morior/Mageblood/Kalandra, Ward props, exact jewel sockets, and quest deltas', () => {
    const bundle: WeGamePoe2Bundle = {
      roleInfo: {
        role: { role_id: '30001', name: 'CnOracleTester', level: 97, class_name: 'Gemling Legionnaire' },
      },
      talentTree: {
        talent_tree: {
          hashes: [26196, 10001, 10002, 10003],
          skill_overrides: {
            '10001': { id: 'strength', name: '力量', grantedStrength: 5, stats: ['+5 [Strength|力量]'] },
            '10002': { id: 'dexterity', name: '敏捷', grantedDexterity: 5, stats: ['+5 [Dexterity|敏捷]'] },
            '10003': { id: 'intelligence', name: '智慧', grantedIntelligence: 5, stats: ['+5 [Intelligence|智慧]'] },
          },
          quest_stats: [
            '+70 [Spirit|精魂]',
            '+40 生命上限',
            '生命上限提高 10%',
            '[Resistances|火焰抗性] +15%',
          ],
        },
      },
      equipments: {
        equipments: [
          {
            id: 'belt_darkness',
            inventoryId: 'Belt',
            frameType: 3,
            rarity: 'Unique',
            name: '夜临',
            baseType: '精致腰带',
            explicitMods: [{ description: '镶嵌的增幅器物品效果提高 95%' }],
          },
          {
            id: 'body_morior',
            inventoryId: 'BodyArmour',
            frameType: 3,
            rarity: 'Unique',
            name: '无生之辱',
            baseType: '恢弘盛装',
            sockets: [{ group: 0 }, { group: 1 }, { group: 2 }, { group: 3 }, { group: 4 }],
            socketedItems: [
              { baseType: '狐狸雕像', explicitMods: ['镶嵌在该物品上的雕像获得其自身的绑定词缀的强化效果'] },
              { baseType: '符文', explicitMods: ['+10 生命上限'] },
              { baseType: '符文', explicitMods: ['+10 生命上限'] },
              { baseType: '符文', explicitMods: ['+10 生命上限'] },
              { baseType: '符文', explicitMods: ['+10 生命上限'] },
            ],
            properties: [{ name: '[Ward|符文结界]', type: 54, values: [['1722', 1]] }],
            explicitMods: [
              { description: '每个镶嵌的插槽全局[Armour|护甲]，[Evasion|闪避]与[EnergyShield|能量护盾]提高 11%' },
              { description: '每个镶嵌的插槽使[Spirit|精魂] +14' },
            ],
            runeMods: [
              '镶嵌在该物品上的[Idol|雕像]获得其自身的[ShamanOnlyMods|绑定]词缀的强化效果',
              '生命上限总降 45%',
            ],
          },
          {
            id: 'ring_kalandra',
            inventoryId: 'Ring',
            frameType: 3,
            rarity: 'Unique',
            name: '卡兰德之触',
            baseType: '戒指',
            explicitMods: [{ description: '映射另一枚戒指' }],
          },
          {
            id: 'ring_estra',
            inventoryId: 'Ring2',
            frameType: 3,
            rarity: 'Unique',
            name: '埃斯特拉的道路',
            baseType: '戒指',
            explicitMods: [
              { description: '每件有[Lightning|闪电][Resistances|抗性]词缀的[Equipped|装备物品]，使[Fire|火焰]与[Cold|冰霜][Resistances|抗性] +10%' },
            ],
            socketedItems: [
              {
                name: '嵌套蓝玉',
                baseType: '蓝玉',
                properties: [{ name: '珠宝', values: [] }],
                explicitMods: [{ description: '[EnergyShield|能量护盾]上限提高 20%' }],
              },
            ],
          },
          {
            id: 'amulet_anoint',
            inventoryId: 'Amulet',
            frameType: 2,
            rarity: 'Rare',
            name: '涂油项链',
            baseType: '失神项链',
            enchantMods: [
              { description: '配置 [DeliriumAnoint_Paragon|典范]' },
              { description: '配置 [evasion_and_energy_shield25|诡计面纱]' },
            ],
            explicitMods: [{ description: '你的抗性上限为 79%' }],
          },
        ],
      },
      jewels: {
        jewel_data: JSON.stringify([
          {
            socket_id: 'PassiveJewel_18',
            socket_name: '珠宝插槽18',
            jewel: {
              id: 'jewel_atd',
              display_name: '抗衡黑暗',
              name: '失落的宝钻',
              rarity: 3,
              mod_descriptions: [
                {
                  type: 0,
                  values: [
                    '范围内的核心天赋同时提供 +12 [Spirit|精魂]',
                    '范围内的核心天赋同时提供 [Strength|力量]提高 2%',
                    '将范围升级为极大型',
                  ],
                },
              ],
            },
          },
          {
            socket_id: 'PassiveJewel_30',
            socket_name: '珠宝插槽30',
            jewel: {
              id: 'jewel_extra',
              display_name: '额外翡翠',
              name: '翡翠',
              rarity: 2,
              mod_descriptions: [{ type: 0, values: ['[Evasion|闪避值]提高 20%'] }],
            },
          },
        ]),
      },
    };

    const build = parseWeGamePoe2Build(bundle);

    // 1. skill_overrides -> attributeOverrides
    expect(build.tree.attributeOverrides).toEqual({ 10001: 'str', 10002: 'dex', 10003: 'int' });

    // 2. Slot-safe unique lookup: Belt "夜临" MUST map to Darkness Enthroned, never Nightfall shield
    const belt = build.items[build.equipped.Belt!]!;
    expect(belt.name).toBe('Darkness Enthroned');
    expect(belt.baseName).toBe('Fine Belt');
    expect(belt.nameZh).toBe('夜临');
    expect(belt.armourStats?.blockChance).toBeUndefined();
    expect(belt.explicits).toContain('95% increased effect of Socketed Items');

    // 3. Morior Invictus sockets, Runic Ward property, Fox Idol Bonded unlock, and less maximum Life
    const body = build.items[build.equipped['Body Armour']!]!;
    expect(body.name).toBe('Morior Invictus');
    expect(body.filledSocketCount).toBe(5);
    expect(body.armourStats?.ward).toBe(1722);
    expect(body.armourStats?.armour).toBeUndefined();
    expect(body.explicits).toContain('11% increased Global Defences per Socket filled');
    expect(body.explicits).toContain('+14 to Spirit per Socket filled');
    expect(body.implicits).toContain('Idols socketed in this item gain the benefits of their Bonded modifiers');
    expect(body.implicits).toContain('45% less maximum Life');

    // 4. Kalandra's Touch + Estra's Path + equipment-socketed Jewel extraction
    const ring1 = build.items[build.equipped['Ring 1']!]!;
    expect(ring1.name).toBe("Kalandra's Touch");
    expect(ring1.explicits).toContain('Reflects your other Ring');
    const ring2 = build.items[build.equipped['Ring 2']!]!;
    expect(ring2.name).toBe("Estra's Path");
    expect(ring2.explicits).toContain(
      '+10% to Fire and Cold Resistances per Equipped Item with a Lightning Resistance Modifier',
    );
    expect(ring2.explicits).toContain('20% increased maximum Energy Shield');

    // 5. Anoint (DeliriumAnoint key + raw nodeId Chinese lookup) & max-res override
    const amulet = build.items[build.equipped.Amulet!]!;
    expect(amulet.implicits).toContain('Allocates Paragon');
    expect(amulet.implicits).toContain('Allocates Subterfuge Mask');
    expect(amulet.explicits).toContain('Your Maximum Resistances are 79%');

    // 6. Exact PassiveJewel_18 -> node 26196 + radius normalization + overflow jewel preservation
    const atdId = build.tree.socketedJewels?.[26196];
    expect(atdId).toBeDefined();
    const atd = build.items[atdId!]!;
    expect(atd.name).toBe('Against the Darkness');
    expect(atd.baseName).toBe('Time-Lost Diamond');
    expect(atd.explicits).toContain('Notable Passive Skills in Radius also grant +12 to Spirit');
    expect(atd.explicits).toContain('Notable Passive Skills in Radius also grant 2% increased Strength');
    expect(atd.explicits).toContain('Upgrades radius to Very Large');
    expect(build.config.customMods).toContain('20% increased Evasion Rating');

    // 7. Quest stat net deltas over PoE 2 campaign baselines
    expect(build.config.customMods).toContain('-30 to Spirit');
    expect(build.config.customMods).toContain('+20 to maximum Life');
    expect(build.config.customMods).toContain('5% increased maximum Life');
    expect(build.config.customMods).toContain('+5% to Fire Resistance');
  });

  it('normalizes PoE 2 Mageblood Legacies, signed max resists, and Atziri Disdain ES gain', () => {
    expect(normalizeStatLineToEn('[LegacyOfBismuth|灰岩] 继承')).toBe('Legacy of Bismuth');
    expect(
      normalizeStatLineToEn('你每拥有一个重复的[MagesLegacy|法师遗产]，所有[MagesLegacy|法师遗产]效果提高 41%'),
    ).toBe("All Mage's Legacies have 41% increased effect per duplicate Mage's Legacy you have");
    expect(normalizeStatLineToEn('-1% [MaximumResistances|元素抗性上限]')).toBe(
      '-1% to all maximum Elemental Resistances',
    );
    expect(normalizeStatLineToEn('+2%[MaximumResistances|闪电抗性上限]')).toBe(
      '+2% to maximum Lightning Resistance',
    );
    expect(normalizeStatLineToEn('获得等同生命上限 28% 的额外能量护盾')).toBe(
      'Gain 28% of Maximum Life as Extra Maximum Energy Shield',
    );
    expect(normalizeStatLineToEn('可以从暗影的起点配置天赋技能')).toBe(
      "Can Allocate Passive Skills from the Shadow's starting point",
    );
    expect(normalizeStatLineToEn('未连结至天赋树的技能，仍然可以在范围内配置')).toBe(
      'Passives in Radius can be Allocated without being connected to your tree',
    );
    expect(normalizeStatLineToEn('配置 2 个[SinisterJewelSockets|恶劣之][Jewel|珠宝]插槽')).toBe(
      'Allocates 2 Sinister Jewel sockets',
    );
  });

  it('exports valid PoB2 XML classId/ascendClassId, canonical CN rare/Runeforged bases, Ward, and Jewel Radius headers', () => {
    const bundle: WeGamePoe2Bundle = {
      roleInfo: {
        role: { role_id: '40001', name: 'Pob2ExportTester', level: 98, class_name: 'Gemling Legionnaire' },
      },
      talentTree: {
        talent_tree: {
          hashes: [26196, 61834, 32763],
        },
      },
      equipments: {
        equipments: [
          {
            id: 'helm_kamasa',
            inventoryId: 'Helm',
            frameType: 2,
            rarity: 'Rare',
            name: '测试头冠',
            baseType: '卡马萨冠冕',
            properties: [{ name: '[EnergyShield|能量护盾]', values: [['520', 1]] }],
          },
          {
            id: 'focus_tasalian',
            inventoryId: 'Offhand',
            frameType: 2,
            rarity: 'Rare',
            name: '测试法器',
            baseType: '塔萨里奥法器',
            properties: [{ name: '[EnergyShield|能量护盾]', values: [['356', 1]] }],
          },
          {
            id: 'gloves_runic',
            inventoryId: 'Gloves',
            frameType: 2,
            rarity: 'Rare',
            name: '符文手套',
            baseType: '符文海妖之鳞手套',
            properties: [{ name: '[Ward|符文结界]', type: 54, values: [['420', 1]] }],
          },
        ],
      },
      jewels: {
        jewel_data: JSON.stringify([
          {
            socket_id: 'PassiveJewel_18',
            jewel: {
              id: 'fn_ci',
              display_name: '无根之源',
              name: '宝钻',
              rarity: 3,
              mod_descriptions: [
                {
                  type: 0,
                  values: ['[passive_keystone_chaos_inoculation|异灵之体]范围内的天赋可以在\n未连结至天赋树的情况下配置'],
                },
              ],
            },
          },
          {
            socket_id: 'PassiveJewel_5',
            jewel: {
              id: 'cm_ring',
              display_name: '可控变形',
              name: '宝钻',
              rarity: 3,
              mod_descriptions: [
                {
                  type: 0,
                  values: [
                    '只影响巨大环形范围内的天赋',
                    '未连结至天赋树的技能，仍然可以在范围内配置',
                  ],
                },
              ],
            },
          },
          {
            socket_id: 'PassiveJewel_17',
            jewel: {
              id: 'sp_shadow',
              display_name: '人格分裂',
              name: '红玉',
              rarity: 3,
              mod_descriptions: [{ type: 0, values: ['可以从暗影的起点配置天赋技能'] }],
            },
          },
        ]),
      },
    };

    const build = parseWeGamePoe2Build(bundle);
    expect(build.items[build.equipped.Helmet!]!.baseName).toBe('Kamasan Tiara');
    expect(build.items[build.equipped['Weapon 2']!]!.baseName).toBe('Tasalian Focus');
    expect(build.items[build.equipped.Gloves!]!.baseName).toBe('Sirenscale Gloves');
    expect(build.items[build.tree.socketedJewels![26196]!]!.explicits).toContain(
      'Passives in radius of Chaos Inoculation can be Allocated without being connected to your tree',
    );
    expect(build.items[build.tree.socketedJewels![32763]!]!.explicits).toContain(
      "Can Allocate Passive Skills from the Shadow's starting point",
    );

    const xml = buildToPobXml(build);
    expect(xml).toContain('classId="4" ascendClassId="3" classInternalId="9" ascendancyInternalId="Mercenary3"');
    expect(xml).toContain('Ward: 420');
    expect(xml).toContain('Radius: Small');
    expect(xml).toContain('Radius: Variable');
  });

  it('exports PoE 2 Sceptre Spirit as a Spirit: <N> header instead of an implicit line (Wave 6J)', () => {
    const bundle: WeGamePoe2Bundle = {
      roleInfo: { role: { name: 'SceptreTest', level: 95, class_name: 'Infernalist' } },
      equipments: {
        equipments: [
          {
            id: 'sceptre_0001',
            inventoryId: 'Offhand',
            frameType: 3,
            rarity: 'Unique',
            name: '神圣之火',
            baseType: '圣地权杖',
            properties: [{ name: '[Spirit|精魂]', type: 25, values: [['164', 1]] }],
            explicitMods: [{ description: '在场范围提高 50%' }],
          },
        ],
      },
    };

    const build = parseWeGamePoe2Build(bundle);
    const sceptre = build.items[build.equipped['Weapon 2']!]!;
    expect(sceptre.baseName).toBe('Shrine Sceptre');
    expect(sceptre.implicits).toContain('+164 to Spirit');

    const xml = buildToPobXml(build);
    expect(xml).toContain('Spirit: 164');
    expect(xml).toContain('Implicits: 0');
    expect(xml).not.toContain('+164 to Spirit');

    // Lossless round-trip back through xmlToBuild / parseItemText
    const reparsed = xmlToBuild(xml);
    const reparsedSceptre = reparsed.items[reparsed.equipped['Weapon 2']!]!;
    expect(reparsedSceptre.implicits).toContain('+164 to Spirit');
  });
});
