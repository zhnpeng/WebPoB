import { describe, expect, it } from 'vitest';
import { buildToPobXml, xmlToBuild } from './pobCode.js';
import { formatItemToPobText, parseItemText } from './itemParser.js';

describe('Round 2 Codec Extensions: multi-part skills, Vaal globals, PoE 2 statSet & runes', () => {
  it('parses skillPartCalcs / skillPart, enableGlobal1 / enableGlobal2, and source on PoE 1 skills and round-trips losslessly', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="95" targetVersion="3_0" className="Marauder" ascendClassName="Juggernaut" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec title="Default" treeVersion="3_30" nodes="" /></Tree>
  <Skills activeSkillSet="1">
    <SkillSet id="1">
      <Skill enabled="true" slot="Body Armour" label="Main Skill" skillPart="2" skillPartCalcs="1" source="Item:1:Body Armour">
        <Gem nameSpec="Ice Nova of Frostbolts" level="21" quality="20" enabled="true" skillPartCalcs="2" enableGlobal1="true" enableGlobal2="false" />
        <Gem nameSpec="Cyclone" level="20" quality="0" enabled="true" skillPart="3" enableGlobal1="false" enableGlobal2="true" />
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1" /></Items>
  <Config activeConfigSet="1"><ConfigSet id="1" /></Config>
  <Notes></Notes>
</PathOfBuilding>`;

    const build = xmlToBuild(xml);
    expect(build.skills).toHaveLength(1);
    const group = build.skills[0]!;
    expect(group.skillPart).toBe(2);
    expect(group.source).toBe('Item:1:Body Armour');
    expect(group.gems).toHaveLength(2);

    const gem0 = group.gems[0]!;
    expect(gem0.skillPart).toBe(2);
    expect(gem0.enableGlobal1).toBe(true);
    expect(gem0.enableGlobal2).toBe(false);

    const gem1 = group.gems[1]!;
    expect(gem1.skillPart).toBe(3);
    expect(gem1.enableGlobal1).toBe(false);
    expect(gem1.enableGlobal2).toBe(true);

    // Round-trip through buildToPobXml -> xmlToBuild
    const exportedXml = buildToPobXml(build);
    expect(exportedXml).toContain('skillPart="2"');
    expect(exportedXml).toContain('enableGlobal1="true"');
    expect(exportedXml).toContain('enableGlobal2="false"');
    expect(exportedXml).toContain('enableGlobal1="false"');
    expect(exportedXml).toContain('enableGlobal2="true"');
    expect(exportedXml).toContain('source="Item:1:Body Armour"');

    const reimported = xmlToBuild(exportedXml);
    expect(reimported.skills[0]!.skillPart).toBe(2);
    expect(reimported.skills[0]!.source).toBe('Item:1:Body Armour');
    expect(reimported.skills[0]!.gems[0]!.skillPart).toBe(2);
    expect(reimported.skills[0]!.gems[0]!.enableGlobal1).toBe(true);
    expect(reimported.skills[0]!.gems[0]!.enableGlobal2).toBe(false);
    expect(reimported.skills[0]!.gems[1]!.skillPart).toBe(3);
    expect(reimported.skills[0]!.gems[1]!.enableGlobal1).toBe(false);
    expect(reimported.skills[0]!.gems[1]!.enableGlobal2).toBe(true);
  });

  it('parses PoE 2 statSetIndexCalcs / statSetIndex on both <Skill> and <Gem> and preserves them on round-trip', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="92" targetVersion="0_1" className="Huntress" ascendClassName="Amazon" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec title="Default" treeVersion="0_5" nodes="" /></Tree>
  <Skills activeSkillSet="1">
    <SkillSet id="1">
      <Skill enabled="true" label="Twister Setup" statSetIndex="2" statSetIndexCalcs="1" set1="true" set2="false">
        <Gem nameSpec="Spark" level="20" quality="20" enabled="true" statSetIndexCalcs="2" count="3" />
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1" /></Items>
  <Config activeConfigSet="1"><ConfigSet id="1" /></Config>
  <Notes></Notes>
</PathOfBuilding2>`;

    const build = xmlToBuild(xml);
    expect(build.game).toBe('poe2');
    const group = build.skills[0]!;
    expect(group.statSetIndex).toBe(2);
    expect(group.weaponSets).toEqual([1]);
    expect(group.gems[0]!.statSetIndex).toBe(2);
    expect(group.gems[0]!.count).toBe(3);

    const exportedXml = buildToPobXml(build);
    expect(exportedXml).toContain('statSetIndex="2"');
    const reimported = xmlToBuild(exportedXml);
    expect(reimported.skills[0]!.statSetIndex).toBe(2);
    expect(reimported.skills[0]!.gems[0]!.statSetIndex).toBe(2);
    expect(reimported.skills[0]!.gems[0]!.count).toBe(3);
  });

  it('parses Morior Invictus PoE 2 Sockets: S S S S S + 5 Rune lines preserving duplicates and clamping filledSocketCount', () => {
    const moriorText = `Rarity: UNIQUE
Morior Invictus
Grand Regalia
Quality: 20
Sockets: S S S S S
Rune: Perfect Mind Rune
Rune: Perfect Mind Rune
Rune: Perfect Mind Rune
Rune: Perfect Mind Rune
Rune: Greater Iron Rune
Implicits: 5
{rune}+35 to maximum Mana
{rune}+35 to maximum Mana
{rune}+35 to maximum Mana
{rune}+35 to maximum Mana
{rune}20% increased Armour, Evasion and Energy Shield
+10% to all Elemental Resistances per Socketed Soul Core or Rune
5% increased Attributes per Socketed Soul Core or Rune`;

    const item = parseItemText(moriorText, 'morior_1', 'poe2');
    expect(item).not.toBeNull();
    expect(item!.socketCount).toBe(5);
    expect(item!.runes).toEqual([
      'Perfect Mind Rune',
      'Perfect Mind Rune',
      'Perfect Mind Rune',
      'Perfect Mind Rune',
      'Greater Iron Rune',
    ]);
    expect(item!.runes).toHaveLength(5);
    expect(item!.filledSocketCount).toBe(5);

    // Round-trip formatting preserves Sockets & all 5 Rune lines
    const formatted = formatItemToPobText(item!);
    expect(formatted).toContain('Sockets: S S S S S');
    expect((formatted.match(/^Rune: Perfect Mind Rune$/gm) ?? []).length).toBe(4);
    expect(formatted).toContain('Rune: Greater Iron Rune');

    const reparsed = parseItemText(formatted, 'morior_2', 'poe2');
    expect(reparsed!.socketCount).toBe(5);
    expect(reparsed!.runes).toHaveLength(5);
    expect(reparsed!.filledSocketCount).toBe(5);
  });

  it('clamps filledSocketCount to socketCount when multi-line rune implicits exceed socket count', () => {
    const itemText = `Rarity: RARE
Test Regalia
Grand Regalia
Sockets: S S
Implicits: 4
{rune}+25 to maximum Mana
{rune}+10 to Intelligence
{rune}+25 to maximum Mana
{rune}+10 to Intelligence
+80 to maximum Life`;

    const item = parseItemText(itemText, 'clamped_1', 'poe2');
    expect(item).not.toBeNull();
    expect(item!.socketCount).toBe(2);
    expect(item!.filledSocketCount).toBe(2);
  });

  it('parses PoE 1 linked Sockets: R-G-B-W and jewellery Catalyst / CatalystQuality headers', () => {
    const ringText = `Rarity: RARE
Tempest Loop
Amethyst Ring
Catalyst: Fertile
CatalystQuality: 20
Sockets: R-G-B-W
Implicits: 1
+23% to Chaos Resistance
+75 to maximum Life`;

    const item = parseItemText(ringText, 'ring_1', 'poe1');
    expect(item).not.toBeNull();
    expect(item!.socketCount).toBe(4);
    expect(item!.filledSocketCount).toBe(0);
    expect(item!.catalyst).toBe('Fertile');
    expect(item!.catalystQuality).toBe(20);

    const formatted = formatItemToPobText(item!);
    expect(formatted).toContain('Catalyst: Fertile');
    expect(formatted).toContain('CatalystQuality: 20');
    const reparsed = parseItemText(formatted, 'ring_2', 'poe1');
    expect(reparsed!.catalyst).toBe('Fertile');
    expect(reparsed!.catalystQuality).toBe(20);
    expect(reparsed!.socketCount).toBe(4);
  });

  it('resolves default enemyLevel, enemyArmour & enemyEvasion per PoB 2 ConfigOptions.lua & PoB 1 CalcSetup.lua', () => {
    // 1. PoE 2 Pinnacle default (even when character level < 82) -> enemyLevel=82, armour=8063, evasion=1175
    const poe2Pinnacle = xmlToBuild(`<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="71" className="Druid" ascendClassName="Shaman" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec treeVersion="0_5" nodes="" /></Tree>
  <Config activeConfigSet="1"><ConfigSet id="1"></ConfigSet></Config>
</PathOfBuilding2>`);
    expect(poe2Pinnacle.config.enemyIsBoss).toBe('Pinnacle');
    expect(poe2Pinnacle.config.enemyLevel).toBe(82);
    expect(poe2Pinnacle.config.enemyArmour).toBe(8063);
    expect(poe2Pinnacle.config.enemyEvasion).toBe(1175);

    // 2. PoE 2 Normal enemy (lv77 character, no explicit enemyLevel) -> enemyLevel=77, 1.0x monster table (4053 / 853)
    const poe2NormalLv77 = xmlToBuild(`<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="77" className="Warrior" ascendClassName="Smith of Kitava" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec treeVersion="0_5" nodes="" /></Tree>
  <Config activeConfigSet="1"><ConfigSet id="1">
    <Input name="enemyIsBoss" string="None" />
  </ConfigSet></Config>
</PathOfBuilding2>`);
    expect(poe2NormalLv77.config.enemyLevel).toBe(77);
    expect(poe2NormalLv77.config.enemyArmour).toBe(4053);
    expect(poe2NormalLv77.config.enemyEvasion).toBe(853);

    // 3. PoE 2 Normal enemy (lv95 character -> capped at MaxEnemyLevel 85) -> 6355 / 996
    const poe2NormalLv95 = xmlToBuild(`<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="95" className="Ranger" ascendClassName="Deadeye" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec treeVersion="0_5" nodes="" /></Tree>
  <Config activeConfigSet="1"><ConfigSet id="1">
    <Input name="enemyIsBoss" string="None" />
  </ConfigSet></Config>
</PathOfBuilding2>`);
    expect(poe2NormalLv95.config.enemyLevel).toBe(85);
    expect(poe2NormalLv95.config.enemyArmour).toBe(6355);
    expect(poe2NormalLv95.config.enemyEvasion).toBe(996);

    // 4. PoE 2 explicit enemyLevel=64 Normal enemy -> exact 1.0x monster table (1906 / 648)
    const poe2NormalLv64 = xmlToBuild(`<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="71" className="Warrior" ascendClassName="Titan" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec treeVersion="0_5" nodes="" /></Tree>
  <Config activeConfigSet="1"><ConfigSet id="1">
    <Input name="enemyIsBoss" string="None" />
    <Input name="enemyLevel" number="64" />
  </ConfigSet></Config>
</PathOfBuilding2>`);
    expect(poe2NormalLv64.config.enemyLevel).toBe(64);
    expect(poe2NormalLv64.config.enemyArmour).toBe(1906);
    expect(poe2NormalLv64.config.enemyEvasion).toBe(648);

    // 5. PoE 2 Standard Boss (Guardian) explicit enemyLevel=80 -> exact 1.0x monster table (4803 / 905)
    const poe2BossLv80 = xmlToBuild(`<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="93" className="Huntress" ascendClassName="Ritualist" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec treeVersion="0_5" nodes="" /></Tree>
  <Config activeConfigSet="1"><ConfigSet id="1">
    <Input name="enemyIsBoss" string="Boss" />
    <Input name="enemyLevel" number="80" />
  </ConfigSet></Config>
</PathOfBuilding2>`);
    expect(poe2BossLv80.config.enemyLevel).toBe(80);
    expect(poe2BossLv80.config.enemyArmour).toBe(4803);
    expect(poe2BossLv80.config.enemyEvasion).toBe(905);

    // 6. PoE 1 low-level Normal enemy defaults to min(84, level); Pinnacle defaults to 84
    const poe1Normal = xmlToBuild(`<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="70" className="Witch" ascendClassName="Necromancer" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec treeVersion="3_30" nodes="" /></Tree>
  <Config activeConfigSet="1"><ConfigSet id="1">
    <Input name="enemyIsBoss" string="None" />
  </ConfigSet></Config>
</PathOfBuilding>`);
    expect(poe1Normal.config.enemyLevel).toBe(70);
  });

  it('skips removed PoE 2 v0.1 Cruel quest rewards while preserving Act 1-4 / Interlude quests and <AttributeOverride> cleanly', () => {
    const build = xmlToBuild(`<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="95" className="Monk" ascendClassName="Invoker" mainSocketGroup="1" />
  <Tree activeSpec="1">
    <Spec treeVersion="0_1" nodes="48773,58814,59538">
      <Overrides>
        <AttributeOverride dexNodes="48773" intNodes="58814" strNodes="59538" />
      </Overrides>
    </Spec>
  </Tree>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="questAct3CruelThe Venom Crypts" string="+5 to All Attributes" />
      <Input name="questAct3NormalThe Venom Crypts" string="25% increased Mana Regeneration Rate" />
      <Input name="questAct 4Halls Of The DeadNgamahu&apos;s Test" string="+5 to Strength" />
    </ConfigSet>
  </Config>
</PathOfBuilding2>`);
    expect(build.tree.attributeOverrides).toEqual({
      48773: 'dex',
      58814: 'int',
      59538: 'str',
    });
    expect(build.config.customMods).not.toContain('+5 to All Attributes');
    expect(build.config.customMods).toContain('25% increased Mana Regeneration Rate');
    expect(build.config.customMods).toContain('+5 to Strength');
  });

  it('decodes PoE 1 skillMineCount, guards skillStageCountCalcs, and normalizes numeric Stationary/Channelling/Self-Curse/Brands/Impale/Adrenaline config inputs', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="98" targetVersion="3_0" className="Shadow" ascendClassName="Trickster" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec title="Default" treeVersion="3_30" nodes="" /></Tree>
  <Skills activeSkillSet="1">
    <SkillSet id="1">
      <Skill enabled="true" slot="Body Armour" label="Main Mines">
        <Gem nameSpec="Ice Nova of Frostbolts" level="21" quality="0" enabled="true" skillMineCount="10" skillStageCountCalcs="8" />
        <Gem nameSpec="Cyclone" level="20" quality="20" enabled="true" />
      </Skill>
      <Skill enabled="true" slot="Helmet" label="Explicit Stage">
        <Gem nameSpec="Cyclone" level="20" quality="20" enabled="true" skillStageCount="5" />
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1" /></Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="conditionStationary" number="2" />
      <Input name="multiplierChannelling" number="3" />
      <Input name="ActiveBrands" number="5" />
      <Input name="conditionImpaledRecently" boolean="true" />
      <Input name="conditionAdrenaline" boolean="true" />
      <Input name="playerCursedWithConductivity" number="1" />
      <Input name="playerCursedWithDespair" number="1" />
      <Input name="playerCursedWithEnfeeble" boolean="true" />
    </ConfigSet>
  </Config>
  <Notes></Notes>
</PathOfBuilding>`;

    const build = xmlToBuild(xml);
    // skillMineCount on main skill gem populates activeMineCount & multiplierActiveMines
    expect(build.config.rawInputs?.activeMineCount).toBe(10);
    expect(build.config.rawInputs?.multiplierActiveMines).toBe(10);
    // PoE 1 MAIN mode ignores skillStageCountCalcs, but honors explicit skillStageCount
    expect(build.skills[0]!.gems[0]!.stageCount).toBeUndefined();
    expect(build.skills[1]!.gems[0]!.stageCount).toBe(5);
    // Numeric conditionStationary sets both boolean conditionStationary & multiplierStationarySeconds
    expect(build.config.rawInputs?.conditionStationary).toBe(true);
    expect(build.config.rawInputs?.multiplierStationarySeconds).toBe(2);
    // multiplierChannelling sets channellingTime & conditionChannelling
    expect(build.config.rawInputs?.channellingTime).toBe(3);
    expect(build.config.rawInputs?.conditionChannelling).toBe(true);
    // ActiveBrands -> multiplierActiveBrand
    expect(build.config.rawInputs?.multiplierActiveBrand).toBe(5);
    // Self-curses count -> multiplierCurseOnSelf & conditionCursed
    expect(build.config.rawInputs?.multiplierCurseOnSelf).toBe(3);
    expect(build.config.rawInputs?.conditionCursed).toBe(true);
    // ImpaledRecently & Adrenaline aliases
    expect(build.config.rawInputs?.conditionImpaledEnemyRecently).toBe(true);
    expect(build.config.rawInputs?.buffAdrenaline).toBe(true);
  });

  it('Wave 4O-B: aligns multi-loadout activeSpec / activeItemSet / ConfigSet, legacy direct Slots & Phrecia _alternate nodes', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build className="Duelist" ascendClassName="Aristocrat" level="100" mainSocketGroup="1" />
  <Tree activeSpec="2">
    <Spec title="Early" treeVersion="3_27_alternate" nodes="1,2748" />
    <Spec title="Endgame" treeVersion="3_27_alternate" nodes="1,2748,50743" />
  </Tree>
  <Skills activeSkillSet="1">
    <SkillSet id="1">
      <Skill enabled="true"><Gem nameSpec="Blade Flurry" level="20" quality="20" enabled="true" /></Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="2" useSecondWeaponSet="false">
    <Item id="1">Rarity: RARE\nTest Helm A\nHubris Circlet\n+50 to maximum Life</Item>
    <Item id="2">Rarity: RARE\nTest Helm B\nHubris Circlet\n+100 to maximum Life</Item>
    <ItemSet id="3" title="Entering Maps"><Slot name="Helmet" itemId="1" /></ItemSet>
    <ItemSet id="2" title="Mid Game"><Slot name="Helmet" itemId="2" /></ItemSet>
  </Items>
  <Config activeConfigSet="2">
    <ConfigSet id="3"><Input name="usePowerCharges" boolean="false" /></ConfigSet>
    <ConfigSet id="2"><Input name="usePowerCharges" boolean="true" /></ConfigSet>
  </Config>
  <Notes>Stray tag in notes should be ignored: &lt;ItemSet id="99"&gt;&lt;Slot name="Helmet" itemId="1"/&gt;&lt;/ItemSet&gt;</Notes>
</PathOfBuilding>`;

    const build = xmlToBuild(xml);
    expect(build.activeTreeSpecIndex).toBe(1);
    expect(build.tree.title).toBe('Endgame');
    expect(build.activeItemSetIndex).toBe(1);
    expect(build.equipped['Helmet']).toBe('imp_item_2');
    expect(build.config.usePowerCharges).toBe(true);
    // Phrecia 3_27_alternate Aristocrat nodes (2748 Illicit Gains + 50743 Private Tuition) hydrated into customMods
    expect(build.config.customMods).toContain('40% increased Strength');
    expect(build.config.customMods).toContain('40% increased Intelligence');

    // Legacy PoB XML without <ItemSet> wrappers still parses direct <Slot> children & useSecondWeaponSet
    const legacyXml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build className="Witch" level="90" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec title="Default" nodes="1" /></Tree>
  <Skills><Skill enabled="true"><Gem nameSpec="Arc" level="20" quality="0" enabled="true" /></Skill></Skills>
  <Items useSecondWeaponSet="true">
    <Item id="1">Rarity: RARE\nLegacy Wand\nOpal Wand\n+20 to Intelligence</Item>
    <Slot name="Weapon 1" itemId="1" />
  </Items>
  <Config />
</PathOfBuilding>`;
    const legacyBuild = xmlToBuild(legacyXml);
    expect(legacyBuild.equipped['Weapon 1']).toBe('imp_item_1');
    expect(legacyBuild.activeWeaponSet).toBe(2);

    // Phrecia 3_28_alternate Harbinger nodes hydrated into customMods
    const harbXml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build className="Witch" ascendClassName="Harbinger" level="95" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec title="Harb" treeVersion="3_28_alternate" nodes="1,39702,3702" /></Tree>
  <Skills><Skill enabled="true"><Gem nameSpec="Frost Blades" level="20" quality="0" enabled="true" /></Skill></Skills>
  <Items />
  <Config />
</PathOfBuilding>`;
    const harbBuild = xmlToBuild(harbXml);
    expect(harbBuild.config.customMods).toContain('Gain 20% of Maximum Mana as Extra Maximum Energy Shield');
    expect(harbBuild.config.customMods).toContain('55% increased Cooldown Recovery Rate');

    // Wave 4V: PoE 1 3.28+ <Skill imbuedSupport="..."> adds Level 1 Imbued Support gem to the skill group
    const imbuedXml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build className="Ranger" ascendClassName="Deadeye" level="95" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec title="Default" nodes="1" /></Tree>
  <Skills>
    <Skill enabled="true" slot="Body Armour" imbuedSupport="Spell Echo">
      <Gem nameSpec="Arc" level="20" quality="20" enabled="true" />
    </Skill>
  </Skills>
  <Items />
  <Config />
</PathOfBuilding>`;
    const imbuedBuild = xmlToBuild(imbuedXml);
    expect(imbuedBuild.skills[0]!.gems).toHaveLength(2);
    expect(imbuedBuild.skills[0]!.gems[1]!.gemId).toBe('poe1_sup_spell_echo');
    expect(imbuedBuild.skills[0]!.gems[1]!.level).toBe(1);
    expect(imbuedBuild.skills[0]!.gems[1]!.fromItem).toBe(true);

    // Wave 4W: PoE 1 <Skill groupCount="N"> propagates count to single-gem group & mercenary="true" tags source
    const groupCountMercXml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build className="Templar" ascendClassName="Guardian" level="95" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec title="Default" nodes="1" /></Tree>
  <Skills>
    <Skill enabled="true" groupCount="7" includeInFullDPS="true">
      <Gem nameSpec="Arc" level="20" quality="0" enabled="true" />
    </Skill>
    <Skill enabled="true" mercenary="true">
      <Gem nameSpec="Hatred" level="20" quality="0" enabled="true" />
    </Skill>
  </Skills>
  <Items />
  <Config />
</PathOfBuilding>`;
    const gcBuild = xmlToBuild(groupCountMercXml);
    expect(gcBuild.skills[0]!.gems[0]!.count).toBe(7);
    expect(gcBuild.skills[1]!.source).toBe('Mercenary');
  });
});
