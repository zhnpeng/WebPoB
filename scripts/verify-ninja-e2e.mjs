#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(ROOT_DIR, 'fixtures/ninja');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '');
const BUILD_TIMEOUT_MS = Number(process.env.BUILD_TIMEOUT_MS || 20_000);

const VIEWPORTS = [
  { name: 'desktop', label: 'Desktop (1440x860)', width: 1440, height: 860, mobile: false },
  { name: 'mobile', label: 'Mobile (390x844)', width: 390, height: 844, mobile: true },
];

const REQUIRED_ZH_TABS = ['天赋树', '技能', '装备'];
const REQUIRED_ZH_TW_TABS = ['天賦樹', '技能', '裝備'];
const HAS_CJK_RE = /[\u4e00-\u9fff]/;
const BAD_TEXT_PATTERNS = [
  { name: 'NaN', re: /\bNaN\b/ },
  { name: 'undefined', re: /\bundefined\b/ },
  { name: '[object Object]', re: /\[object Object\]/ },
  { name: 'literal \\n escape', re: /\\n/ },
  { name: 'PoE 2 markup leak', re: /\[[^\]|]+\|[^\]]+\]/ },
  {
    name: 'raw i18n key',
    re: /\b(?:topbar|tree|stats|nav|sidebar|skills|items|calcs|config|import|notes)\.[a-zA-Z0-9_]+\b/,
  },
];

// Bilingual class/ascendancy lookup matching packages/data/src/classes.ts
const CLASS_ZH_MAP = {
  poe1: {
    Witch: '女巫',
    Elementalist: '元素使',
    Occultist: '秘术家',
    Necromancer: '死灵师',
    Ranger: '游侠',
    Deadeye: '锐眼',
    Pathfinder: '追猎者',
    Warden: '守望者',
    Duelist: '决斗者',
    Slayer: '处刑者',
    Gladiator: '卫士',
    Champion: '冠军',
    Marauder: '野蛮人',
    Juggernaut: '勇士',
    Berserker: '暴徒',
    Chieftain: '酋长',
    Templar: '圣堂武僧',
    Inquisitor: '判官',
    Hierophant: '圣宗',
    Guardian: '守护者',
    Shadow: '暗影刺客',
    Trickster: '欺诈师',
    Assassin: '刺客',
    Saboteur: '破坏者',
    Scion: '贵族',
    Ascendant: '升华使徒',
    Reliquarian: '圣物师',
    Luminary: '辉光使者',
  },
  poe2: {
    Sorceress: '魔巫',
    Stormweaver: '风暴编织者',
    Chronomancer: '时空法师',
    'Disciple of Varashta': '瓦拉什塔门徒',
    Monk: '武僧',
    Invoker: '祈求者',
    'Acolyte of Chayula': '夏乌拉侍僧',
    'Martial Artist': '武术家',
    Ranger: '游侠',
    Deadeye: '锐眼',
    Pathfinder: '追猎者',
    Warrior: '战士',
    Titan: '泰坦',
    Warbringer: '战争使者',
    'Smith of Kitava': '奇塔弗铁匠',
    Mercenary: '佣兵',
    Witchhunter: '猎巫人',
    'Gemling Legionnaire': '宝石军团',
    Tactician: '战术家',
    Witch: '女巫',
    Infernalist: '炼狱师',
    'Blood Mage': '血法师',
    Lich: '巫妖',
    'Abyssal Lich': '深渊巫妖',
    Huntress: '女猎手',
    Amazon: '亚马逊',
    Ritualist: '仪式师',
    'Spirit Walker': '灵魂行者',
    Druid: '德鲁伊',
    Oracle: '神谕者',
    Shaman: '萨满',
  },
};

// Official GGG Traditional Chinese (zh-TW) class & ascendancy names
const CLASS_ZH_TW_MAP = {
  poe1: {
    Witch: '女巫',
    Elementalist: '元素使',
    Occultist: '秘術家',
    Necromancer: '死靈師',
    Ranger: '遊俠',
    Deadeye: '銳眼',
    Pathfinder: '追獵者',
    Warden: '守林人',
    Duelist: '決鬥者',
    Slayer: '處刑者',
    Gladiator: '衛士',
    Champion: '冠軍',
    Marauder: '野蠻人',
    Juggernaut: '勇士',
    Berserker: '暴徒',
    Chieftain: '酋長',
    Templar: '聖堂武僧',
    Inquisitor: '判官',
    Hierophant: '聖宗',
    Guardian: '守護者',
    Shadow: '暗影刺客',
    Trickster: '詐欺師',
    Assassin: '刺客',
    Saboteur: '破壞者',
    Scion: '貴族',
    Ascendant: '昇華使徒',
    Reliquarian: '遺守使徒',
    Luminary: '輝耀使徒',
  },
  poe2: {
    Sorceress: '女術者',
    Stormweaver: '風暴編織者',
    Chronomancer: '時空幻術師',
    'Disciple of Varashta': '瓦拉什塔門徒',
    Monk: '僧侶',
    Invoker: '祈求者',
    'Acolyte of Chayula': '夏烏拉侍僧',
    'Martial Artist': '武術家',
    Ranger: '遊俠',
    Deadeye: '銳眼',
    Pathfinder: '追獵者',
    Warrior: '戰士',
    Titan: '泰坦',
    Warbringer: '戰爭使者',
    'Smith of Kitava': '奇塔弗工匠',
    Mercenary: '傭兵',
    Witchhunter: '女巫獵人',
    'Gemling Legionnaire': '古靈軍團',
    Tactician: '智勇軍師',
    Witch: '女巫',
    Infernalist: '獄火師',
    'Blood Mage': '血法師',
    Lich: '巫妖',
    'Abyssal Lich': '深淵妖巫',
    Huntress: '女獵人',
    Amazon: '亞馬遜',
    Ritualist: '儀式行者',
    'Spirit Walker': '魂靈行者',
    Druid: '德魯伊',
    Oracle: '天啟先知',
    Shaman: '狂徒薩滿',
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findChromeBinary() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    'Could not find Google Chrome / Chromium executable. Set CHROME_PATH=/path/to/chrome.',
  );
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function loadFixtures() {
  const files = [
    { game: 'poe1', filePath: path.join(FIXTURES_DIR, 'poe1-builds.json') },
    { game: 'poe2', filePath: path.join(FIXTURES_DIR, 'poe2-builds.json') },
  ];

  const allBuilds = [];
  for (const { game, filePath } of files) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing fixture file: ${filePath}`);
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (parsed.game !== game) {
      throw new Error(`Fixture ${filePath} has game="${parsed.game}", expected "${game}"`);
    }
    if (!Array.isArray(parsed.builds) || parsed.builds.length === 0) {
      throw new Error(`Fixture ${filePath} contains no builds`);
    }
    if (typeof parsed.collectedAt !== 'string' || parsed.collectedAt.trim().length === 0) {
      throw new Error(`Fixture ${filePath} is missing a valid collectedAt string`);
    }
    const seenIds = new Set();
    for (const entry of parsed.builds) {
      const requiredStrings = ['id', 'title', 'sourceUrl', 'className', 'ascendancyName', 'mainSkill', 'pobCode'];
      for (const field of requiredStrings) {
        if (typeof entry[field] !== 'string' || entry[field].trim().length === 0) {
          throw new Error(`Fixture ${filePath}: build ${entry.id ?? '<no id>'} has invalid "${field}"`);
        }
      }
      if (seenIds.has(entry.id)) {
        throw new Error(`Fixture ${filePath}: duplicate build id "${entry.id}"`);
      }
      seenIds.add(entry.id);
      if (!Number.isInteger(entry.level) || entry.level < 1 || entry.level > 100) {
        throw new Error(`Fixture ${filePath}: build ${entry.id} has invalid level ${entry.level}`);
      }
      const expected = entry.expected;
      if (!expected || typeof expected !== 'object') {
        throw new Error(`Fixture ${filePath}: build ${entry.id} is missing expected thresholds`);
      }
      for (const field of ['minAllocatedNodes', 'minItems', 'minSkills']) {
        if (!Number.isInteger(expected[field]) || expected[field] < 0) {
          throw new Error(
            `Fixture ${filePath}: build ${entry.id} expected.${field} must be a non-negative integer`,
          );
        }
      }
      for (const field of ['expectPositiveDps', 'expectPositiveEhp']) {
        if (typeof expected[field] !== 'boolean') {
          throw new Error(`Fixture ${filePath}: build ${entry.id} expected.${field} must be boolean`);
        }
      }
      allBuilds.push({
        ...entry,
        game,
        league: parsed.league || '',
      });
    }
  }

  // Also load live CN PoE 1 & PoE 2 share-link E2E cases (poe.ninja / maxroll.gg / WeGame)
  const cnLinksPath = path.join(FIXTURES_DIR, 'cn-share-links.json');
  if (process.env.SKIP_LIVE_CN_E2E !== '1' && fs.existsSync(cnLinksPath)) {
    const parsed = JSON.parse(fs.readFileSync(cnLinksPath, 'utf-8'));
    if (!Array.isArray(parsed.builds)) {
      throw new Error(`Fixture ${cnLinksPath} must contain a builds array`);
    }
    const seenIds = new Set(allBuilds.map((b) => b.id));
    for (const entry of parsed.builds) {
      for (const field of ['id', 'game', 'title', 'importUrl', 'className', 'ascendancyName']) {
        if (typeof entry[field] !== 'string' || entry[field].trim().length === 0) {
          throw new Error(`Fixture ${cnLinksPath}: build ${entry.id ?? '<no id>'} has invalid "${field}"`);
        }
      }
      if (entry.game !== 'poe1' && entry.game !== 'poe2') {
        throw new Error(`Fixture ${cnLinksPath}: build ${entry.id} has invalid game "${entry.game}"`);
      }
      if (seenIds.has(entry.id)) {
        throw new Error(`Fixture ${cnLinksPath}: duplicate build id "${entry.id}"`);
      }
      seenIds.add(entry.id);
      allBuilds.push({
        ...entry,
        league: 'CN',
      });
    }
  }

  return allBuilds;
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', (err) => reject(new Error(`CDP WebSocket error: ${err.message || err}`)), {
        once: true,
      });
      ws.addEventListener('message', (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) {
            rej(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
          } else {
            res(msg.result);
          }
          return;
        }
        if (msg.method) {
          const handlers = this.listeners.get(msg.method);
          if (handlers) {
            for (const handler of handlers) {
              handler(msg.params || {});
            }
          }
        }
      });
      ws.addEventListener('close', () => {
        for (const { reject: rej } of this.pending.values()) {
          rej(new Error('CDP WebSocket closed'));
        }
        this.pending.clear();
      });
    });
  }

  on(method, handler) {
    if (!this.listeners.has(method)) {
      this.listeners.set(method, new Set());
    }
    this.listeners.get(method).add(handler);
    return () => this.listeners.get(method)?.delete(handler);
  }

  send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Cannot send ${method}: CDP socket is not open`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      const desc =
        res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        'Unknown evaluation exception';
      throw new Error(`Runtime.evaluate exception: ${desc}`);
    }
    return res.result?.value;
  }

  close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}

async function launchHeadlessChrome(port, userDataDir) {
  const chromeBin = findChromeBinary();
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-sandbox',
    '--window-size=1440,860',
    'about:blank',
  ];

  const proc = spawn(chromeBin, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderrBuf = '';
  proc.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString('utf-8');
    if (stderrBuf.length > 4000) stderrBuf = stderrBuf.slice(-4000);
  });

  const versionUrl = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Chrome exited prematurely (code ${proc.exitCode}): ${stderrBuf.trim()}`);
    }
    try {
      const res = await fetch(versionUrl);
      if (res.ok) {
        return proc;
      }
    } catch {
      // Chrome still booting
    }
    await sleep(150);
  }
  proc.kill('SIGKILL');
  throw new Error(`Timed out waiting for Chrome DevTools on port ${port}: ${stderrBuf.trim()}`);
}

async function createPageTarget(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  if (!res.ok) {
    throw new Error(`Failed to open CDP page target: HTTP ${res.status}`);
  }
  return res.json();
}

async function closePageTarget(port, targetId) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`, { method: 'PUT' });
  } catch {
    // ignore cleanup failure
  }
}

function getExpectedZhNames(entry) {
  const mapRoot = entry.locale === 'zh-TW' ? CLASS_ZH_TW_MAP : CLASS_ZH_MAP;
  const table = mapRoot[entry.game] || {};
  const expectedClassZh = table[entry.className] || null;
  const expectedAscZh =
    entry.ascendancyName && entry.ascendancyName !== 'None'
      ? table[entry.ascendancyName] || null
      : null;
  return { expectedClassZh, expectedAscZh };
}

function inspectTextForLeaks(text, contextLabel) {
  const issues = [];
  for (const { name, re } of BAD_TEXT_PATTERNS) {
    const match = text.match(re);
    if (match) {
      issues.push(`${contextLabel}: found forbidden token "${match[0]}" (${name})`);
    }
  }
  return issues;
}

async function verifyBuildInViewport(port, entry, viewport) {
  const target = await createPageTarget(port);
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  const pageErrors = [];
  const consoleErrors = [];
  const issues = [];

  try {
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.mobile ? 2 : 1,
      mobile: viewport.mobile,
    });

    cdp.on('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails || {};
      const msg =
        details.exception?.description ||
        details.exception?.value ||
        details.text ||
        'Uncaught page exception';
      pageErrors.push(String(msg));
    });

    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        const text = (params.args || [])
          .map((arg) => arg.description ?? arg.value ?? arg.type)
          .join(' ');
        consoleErrors.push(text || 'console.error');
      }
    });

    cdp.on('Log.entryAdded', (params) => {
      if (params.entry?.level === 'error') {
        consoleErrors.push(params.entry.text || 'browser log error');
      }
    });

    const targetLocale = entry.locale === 'zh-TW' ? 'zh-TW' : 'zh-CN';
    const requiredTabs = targetLocale === 'zh-TW' ? REQUIRED_ZH_TW_TABS : REQUIRED_ZH_TABS;
    const toastPrefix = targetLocale === 'zh-TW' ? '已從分享連結載入：' : '已从分享链接加载：';
    const { expectedClassZh, expectedAscZh } = getExpectedZhNames(entry);
    const targetUrl = entry.importUrl
      ? entry.unencodedImport
        ? `${BASE_URL}/?lang=${targetLocale}&import=${entry.importUrl.trim()}`
        : `${BASE_URL}/?lang=${targetLocale}&import=${encodeURIComponent(entry.importUrl.trim())}`
      : `${BASE_URL}/?lang=${targetLocale}#pob=${entry.pobCode.trim()}`;

    await cdp.send('Page.navigate', { url: targetUrl });

    // Poll until React has mounted, switched locale, and finished importing the build
    const startedAt = Date.now();
    const timeoutMs = entry.importUrl ? Math.max(BUILD_TIMEOUT_MS, 30_000) : BUILD_TIMEOUT_MS;
    const deadline = startedAt + timeoutMs;
    let loadedSnapshot = null;

    while (Date.now() < deadline) {
      const snapshot = await cdp.evaluate(`(() => {
        const bodyText = document.body ? document.body.innerText || '' : '';
        const hasTabs = ${JSON.stringify(requiredTabs)}.every((t) => bodyText.includes(t));
        const hasToast = bodyText.includes(${JSON.stringify(toastPrefix)});
        const header = document.querySelector('header');
        const selects = header ? Array.from(header.querySelectorAll('select')) : [];
        const visibleSelects = selects.filter((el) => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && el.offsetParent !== null;
        });
        const selectedOptionTexts = visibleSelects.map((sel) => sel.options[sel.selectedIndex]?.text?.trim() || '');
        const mobileHeaderBtn = header ? header.querySelector('.md\\\\:hidden button') : null;
        const mobileHeaderText = mobileHeaderBtn ? (mobileHeaderBtn.textContent || '').trim() : '';
        const levelInput = header ? header.querySelector('input[type="number"]') : null;
        const levelVal = levelInput ? Number(levelInput.value) : null;
        return {
          readyState: document.readyState,
          lang: document.documentElement?.lang || '',
          hasTabs,
          hasToast,
          bodyText,
          selectedOptionTexts,
          mobileHeaderText,
          levelVal,
          scrollWidth: document.documentElement?.scrollWidth ?? 0,
          clientWidth: document.documentElement?.clientWidth ?? 0,
          bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
          innerWidth: window.innerWidth,
        };
      })()`);

      if (snapshot && snapshot.readyState === 'complete' && snapshot.hasTabs) {
        const matchesExpectedClass = viewport.mobile
          ? (expectedAscZh && snapshot.mobileHeaderText.includes(expectedAscZh)) ||
            (expectedClassZh && snapshot.mobileHeaderText.includes(expectedClassZh))
          : (!expectedClassZh || snapshot.selectedOptionTexts.includes(expectedClassZh)) &&
            (!expectedAscZh || snapshot.selectedOptionTexts.includes(expectedAscZh));

        // Prefer the explicit #pob import toast; fall back to class match only after 5s in case toast faded
        if (snapshot.hasToast || (Date.now() - startedAt >= 5000 && matchesExpectedClass)) {
          // Allow one short settle window for post-import calculations & rendering
          await sleep(300);
          loadedSnapshot = await cdp.evaluate(`(() => {
            const bodyText = document.body ? document.body.innerText || '' : '';
            const header = document.querySelector('header');
            const selects = header ? Array.from(header.querySelectorAll('select')) : [];
            const visibleSelects = selects.filter((el) => {
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && el.offsetParent !== null;
            });
            const selectedOptionTexts = visibleSelects.map((sel) => sel.options[sel.selectedIndex]?.text?.trim() || '');
            const mobileHeaderBtn = header ? header.querySelector('.md\\\\:hidden button') : null;
            const mobileHeaderText = mobileHeaderBtn ? (mobileHeaderBtn.textContent || '').trim() : '';
            const state = typeof window.__WEBPOB_STATE__ === 'function' ? window.__WEBPOB_STATE__() : null;
            const treeMetrics = window.__WEBPOB_TREE_METRICS__ || null;
            return {
              lang: document.documentElement?.lang || '',
              bodyText,
              selectedOptionTexts,
              mobileHeaderText,
              state,
              treeMetrics,
              scrollWidth: document.documentElement?.scrollWidth ?? 0,
              clientWidth: document.documentElement?.clientWidth ?? 0,
              bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
              innerWidth: window.innerWidth,
            };
          })()`);
          break;
        }
      }
      await sleep(150);
    }

    if (!loadedSnapshot) {
      issues.push(
        `Timed out (${timeoutMs}ms) waiting for build to load from ${entry.importUrl ? '?import URL' : '#pob URL'}`,
      );
      return { passed: false, issues, pageErrors, consoleErrors };
    }

    // 0. Document language should reflect the requested locale (zh-CN or zh-TW)
    if ((loadedSnapshot.lang || '').toLowerCase() !== targetLocale.toLowerCase()) {
      issues.push(`Expected document.lang to be ${targetLocale}, got "${loadedSnapshot.lang || ''}"`);
    }

    // 0b. Deep functional & numeric integrity assertions against live app state
    const appState = loadedSnapshot.state;
    if (!appState || !appState.build || !appState.calc) {
      issues.push('Live app state getter window.__WEBPOB_STATE__ returned null');
    } else {
      // Exact game mode check (catches PoE 2 -> PoE 1 mis-import regressions immediately!)
      if (appState.build.game !== entry.game) {
        issues.push(`Game mode mismatch: expected "${entry.game}", got "${appState.build.game}"`);
      }
      if (viewport.mobile) {
        const expectedBadge = entry.game === 'poe2' ? 'PoE2' : 'PoE1';
        if (!loadedSnapshot.mobileHeaderText.includes(expectedBadge)) {
          issues.push(`Mobile header badge expected "${expectedBadge}", got "${loadedSnapshot.mobileHeaderText}"`);
        }
      }
      // Exact class & ascendancy IDs
      if (entry.className && appState.build.classId.toLowerCase() !== entry.className.toLowerCase()) {
        issues.push(`Build classId mismatch: expected "${entry.className}", got "${appState.build.classId}"`);
      }
      if (
        entry.ascendancyName &&
        entry.ascendancyName !== 'None' &&
        appState.build.ascendancyId.toLowerCase() !== entry.ascendancyName.toLowerCase()
      ) {
        issues.push(
          `Build ascendancyId mismatch: expected "${entry.ascendancyName}", got "${appState.build.ascendancyId}"`,
        );
      }
      // Real build hydration thresholds (passives, equipped gear, skills)
      const exp = entry.expected || {};
      const minNodes = typeof exp.minAllocatedNodes === 'number' ? exp.minAllocatedNodes : 30;
      const minItems = typeof exp.minItems === 'number' ? exp.minItems : 4;
      const minSkills = typeof exp.minSkills === 'number' ? exp.minSkills : 1;
      if (appState.build.allocatedNodeCount < minNodes) {
        issues.push(
          `Allocated passive nodes too low: got ${appState.build.allocatedNodeCount}, expected >= ${minNodes}`,
        );
      }
      if (appState.build.itemCount < minItems) {
        issues.push(
          `Parsed item count too low: got ${appState.build.itemCount}, expected >= ${minItems}`,
        );
      }
      if (appState.build.equippedCount < 5) {
        issues.push(
          `Equipped item count too low: got ${appState.build.equippedCount}, expected >= 5`,
        );
      }
      if (appState.build.skillGroupCount < minSkills) {
        issues.push(
          `Skill group count too low: got ${appState.build.skillGroupCount}, expected >= ${minSkills}`,
        );
      }
      if (Array.isArray(exp.requireNodeIds)) {
        const nodeSet = new Set(appState.build.allocatedNodeIds || []);
        for (const reqId of exp.requireNodeIds) {
          if (!nodeSet.has(reqId)) {
            issues.push(`Expected required passive/ascendancy node #${reqId} to be allocated`);
          }
        }
      }
      // Numeric calculation sanity (DPS, EHP, Life/ES, Spirit)
      const effectiveDps = appState.calc.fullDps ?? appState.calc.totalDps;
      if (!Number.isFinite(effectiveDps) || (exp.expectPositiveDps !== false && effectiveDps <= 0)) {
        issues.push(`Expected positive finite DPS, got ${effectiveDps}`);
      }
      if (!Number.isFinite(appState.calc.effectiveHitPool) || (exp.expectPositiveEhp !== false && appState.calc.effectiveHitPool <= 0)) {
        issues.push(`Expected positive finite EHP, got ${appState.calc.effectiveHitPool}`);
      }
      if ((appState.calc.life ?? 0) <= 0 && (appState.calc.energyShield ?? 0) <= 0) {
        issues.push(`Expected Life > 0 or ES > 0, got life=${appState.calc.life}, es=${appState.calc.energyShield}`);
      }
      if (typeof exp.minSpirit === 'number') {
        if ((appState.calc.spirit ?? 0) < exp.minSpirit) {
          issues.push(`Expected Spirit >= ${exp.minSpirit}, got ${appState.calc.spirit}`);
        }
        if ((appState.calc.spiritUnreserved ?? -1) < 0) {
          issues.push(`Expected non-negative unreserved Spirit, got ${appState.calc.spiritUnreserved}`);
        }
      }
      if (exp.exactResists && typeof exp.exactResists === 'object') {
        const resMap = {
          fire: appState.calc.fireResist,
          cold: appState.calc.coldResist,
          lightning: appState.calc.lightningResist,
          chaos: appState.calc.chaosResist,
        };
        for (const [el, expectedVal] of Object.entries(exp.exactResists)) {
          if (typeof expectedVal === 'number' && resMap[el] !== expectedVal) {
            issues.push(`Expected ${el} resistance to be ${expectedVal}%, got ${resMap[el]}%`);
          }
        }
      }
      // PoE 2 ascendancy medallion projection drift guard: every ascendancy node must sit inside the center medallion (r <= 1550)
      if (entry.game === 'poe2' && entry.ascendancyName && entry.ascendancyName !== 'None') {
        const tm = loadedSnapshot.treeMetrics;
        if (!tm || tm.ascNodeCount <= 0) {
          issues.push(`Expected PoE 2 ascendancy nodes to render in medallion, got ascNodeCount=${tm?.ascNodeCount ?? 0}`);
        } else if (tm.ascMaxProjectedRadius > 1550) {
          issues.push(
            `PoE 2 ascendancy nodes drifted outside center medallion: maxRadius=${tm.ascMaxProjectedRadius} (expected <= 1550)`,
          );
        }
      }
    }

    // 1. Check required Chinese navigation tabs
    for (const tabLabel of requiredTabs) {
      if (!loadedSnapshot.bodyText.includes(tabLabel)) {
        issues.push(`Missing Chinese tab "${tabLabel}"`);
      }
    }

    // 2. Check Chinese class & ascendancy rendered cleanly
    if (viewport.mobile) {
      const mh = loadedSnapshot.mobileHeaderText;
      if (!HAS_CJK_RE.test(mh)) {
        issues.push(`Mobile header lacks Chinese class/ascendancy text ("${mh}")`);
      } else if (expectedAscZh && !mh.includes(expectedAscZh)) {
        issues.push(`Mobile header expected "${expectedAscZh}", got "${mh}"`);
      } else if (!expectedAscZh && expectedClassZh && !mh.includes(expectedClassZh)) {
        issues.push(`Mobile header expected "${expectedClassZh}", got "${mh}"`);
      }
    } else {
      const selected = loadedSnapshot.selectedOptionTexts;
      if (selected.length < 2) {
        issues.push(`Expected class & ascendancy <select> controls, found ${selected.length}`);
      } else {
        const [classText, ascText] = selected;
        if (!HAS_CJK_RE.test(classText || '')) {
          issues.push(`Desktop class label not Chinese ("${classText}")`);
        } else if (expectedClassZh && classText !== expectedClassZh) {
          issues.push(`Desktop class expected "${expectedClassZh}", got "${classText}"`);
        }
        if (expectedAscZh) {
          if (!HAS_CJK_RE.test(ascText || '')) {
            issues.push(`Desktop ascendancy label not Chinese ("${ascText}")`);
          } else if (ascText !== expectedAscZh) {
            issues.push(`Desktop ascendancy expected "${expectedAscZh}", got "${ascText}"`);
          }
        }
      }
    }

    // 3. Check for forbidden tokens in initial Tree view
    issues.push(...inspectTextForLeaks(loadedSnapshot.bodyText, 'Tree tab'));

    // 4. Mobile 390px horizontal overflow check
    if (viewport.mobile) {
      if (loadedSnapshot.scrollWidth > loadedSnapshot.clientWidth) {
        issues.push(
          `Horizontal overflow on ${viewport.width}px mobile: documentElement.scrollWidth (${loadedSnapshot.scrollWidth}) > clientWidth (${loadedSnapshot.clientWidth})`,
        );
      }
      if (loadedSnapshot.bodyScrollWidth > loadedSnapshot.innerWidth) {
        issues.push(
          `Horizontal overflow on ${viewport.width}px mobile: body.scrollWidth (${loadedSnapshot.bodyScrollWidth}) > innerWidth (${loadedSnapshot.innerWidth})`,
        );
      }
    }

    // 5. Switch to 技能 and 装备/裝備 tabs to verify rendered skills/items text quality in both viewports
    const tabsToCheck = targetLocale === 'zh-TW' ? ['技能', '裝備'] : ['技能', '装备'];
    for (const tabName of tabsToCheck) {
      const clicked = await cdp.evaluate(`(() => {
        const buttons = Array.from(document.querySelectorAll('nav button'));
        const btn = buttons.find((b) => (b.textContent || '').trim().includes(${JSON.stringify(tabName)}));
        if (!btn) return false;
        btn.click();
        return true;
      })()`);
      if (!clicked) {
        issues.push(`Could not click "${tabName}" nav tab`);
        continue;
      }
      const tabDeadline = Date.now() + 5000;
      let tabText = '';
      while (Date.now() < tabDeadline) {
        tabText = await cdp.evaluate(`document.body ? document.body.innerText || '' : ''`);
        if (!tabText.includes('加载面板中...') && !tabText.includes('載入面板中...')) break;
        await sleep(100);
      }
      await sleep(100);
      tabText = await cdp.evaluate(`document.body ? document.body.innerText || '' : ''`);
      issues.push(...inspectTextForLeaks(tabText, `${tabName} tab`));
      if (!tabText.includes(tabName)) {
        issues.push(`Tab "${tabName}" did not render ${viewport.mobile ? 'on mobile' : 'on desktop'}`);
      }
      if (viewport.mobile) {
        const overflow = await cdp.evaluate(`(() => ({
          scrollWidth: document.documentElement?.scrollWidth ?? 0,
          clientWidth: document.documentElement?.clientWidth ?? 0,
          bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
          innerWidth: window.innerWidth,
        }))()`);
        if (overflow.scrollWidth > overflow.clientWidth) {
          issues.push(
            `Horizontal overflow on mobile "${tabName}" tab: documentElement.scrollWidth (${overflow.scrollWidth}) > clientWidth (${overflow.clientWidth})`,
          );
        }
        if (overflow.bodyScrollWidth > overflow.innerWidth) {
          issues.push(
            `Horizontal overflow on mobile "${tabName}" tab: body.scrollWidth (${overflow.bodyScrollWidth}) > innerWidth (${overflow.innerWidth})`,
          );
        }
      }
    }

    // 6. Uncaught page errors & console errors (collected across initial load + tab navigation)
    for (const err of pageErrors) {
      issues.push(`Uncaught pageerror: ${err}`);
    }
    for (const err of consoleErrors) {
      issues.push(`Console error: ${err}`);
    }

    return {
      passed: issues.length === 0,
      issues,
      pageErrors,
      consoleErrors,
    };
  } finally {
    cdp.close();
    await closePageTarget(port, target.id);
  }
}

async function verifyFunctionalRegressions(port) {
  const checks = [];

  // Functional Check 1: poe.ninja character webpage URL MUST show actionable error and NEVER mis-import as PoE 1
  {
    const id = 'fn-poe-ninja-char-url-reject';
    const target = await createPageTarget(port);
    const cdp = new CdpClient(target.webSocketDebuggerUrl);
    const issues = [];
    const pageErrors = [];
    const consoleErrors = [];
    try {
      await cdp.connect();
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 860,
        deviceScaleFactor: 1,
        mobile: false,
      });
      cdp.on('Runtime.exceptionThrown', (p) => pageErrors.push(String(p.exceptionDetails?.text || 'exception')));
      cdp.on('Runtime.consoleAPICalled', (p) => {
        if (p.type === 'error') consoleErrors.push((p.args || []).map((a) => a.value ?? a.description).join(' '));
      });

      const badUrl = 'https://poe.ninja/poe2/builds/forbiddenrites/character/brazwv-1435/ArkkFR';
      await cdp.send('Page.navigate', {
        url: `${BASE_URL}/?lang=zh-CN&import=${encodeURIComponent(badUrl)}`,
      });
      const deadline = Date.now() + 12_000;
      let alertText = '';
      let bodyText = '';
      while (Date.now() < deadline) {
        const res = await cdp.evaluate(`(() => {
          const alertEl = document.querySelector('[role="alert"]');
          return {
            alertText: alertEl ? (alertEl.textContent || '').trim() : '',
            bodyText: document.body ? document.body.innerText || '' : '',
          };
        })()`);
        alertText = res.alertText;
        bodyText = res.bodyText;
        if (alertText) break;
        await sleep(150);
      }
      if (!alertText || !alertText.includes('Copy PoB code')) {
        issues.push(`Expected [role="alert"] explaining "Copy PoB code" for poe.ninja character URL, got "${alertText}"`);
      }
      if (bodyText.includes('已从分享链接加载')) {
        issues.push('Unexpected fake success toast "已从分享链接加载" shown for unsupported poe.ninja character URL');
      }

      // Also verify pasting the poe.ninja PoE 2 character URL inside Import tab while in PoE 2 mode stays in PoE 2!
      const pastedCheck = await cdp.evaluate(`(async () => {
        // Click PoE 2 switcher button in header
        const headerBtns = Array.from(document.querySelectorAll('header button'));
        const poe2Btn = headerBtns.find((b) => (b.textContent || '').includes('流放之路 2') || (b.textContent || '').includes('PoE 2'));
        if (poe2Btn) poe2Btn.click();
        await new Promise((r) => setTimeout(r, 400));
        // Switch to 导入 / 导出 tab
        const navBtns = Array.from(document.querySelectorAll('nav button'));
        const importTab = navBtns.find((b) => (b.textContent || '').includes('导入'));
        if (!importTab) return { ok: false, reason: 'missing import tab' };
        importTab.click();
        for (let i = 0; i < 30; i++) {
          const ta = document.querySelector('textarea:not([readonly])');
          if (ta) break;
          await new Promise((r) => setTimeout(r, 150));
        }
        const ta = document.querySelector('textarea:not([readonly])');
        if (!ta) return { ok: false, reason: 'missing import textarea' };
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, ${JSON.stringify(badUrl)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 100));
        const submitBtn = Array.from(document.querySelectorAll('main button')).find((b) =>
          (b.textContent || '').trim() === '导入 BD'
        );
        if (!submitBtn) return { ok: false, reason: 'missing import submit button' };
        submitBtn.click();
        await new Promise((r) => setTimeout(r, 400));
        const state = typeof window.__WEBPOB_STATE__ === 'function' ? window.__WEBPOB_STATE__() : null;
        const text = document.body ? document.body.innerText || '' : '';
        return {
          ok: true,
          game: state?.build?.game || null,
          hasErrorHint: text.includes('Copy PoB code'),
          hasFakeSuccess: text.includes('BD 导入成功'),
        };
      })()`);
      if (!pastedCheck.ok) {
        issues.push(`Import tab rejection check setup failed: ${pastedCheck.reason}`);
      } else {
        if (pastedCheck.game !== 'poe2') {
          issues.push(`Expected game to remain "poe2" after rejecting poe.ninja character URL, got "${pastedCheck.game}"`);
        }
        if (!pastedCheck.hasErrorHint) {
          issues.push('Import tab did not display actionable "Copy PoB code" error message');
        }
        if (pastedCheck.hasFakeSuccess) {
          issues.push('Import tab displayed fake "BD 导入成功" for poe.ninja character URL');
        }
      }
      for (const e of pageErrors) issues.push(`pageerror: ${e}`);
      for (const e of consoleErrors) issues.push(`console.error: ${e}`);
    } finally {
      cdp.close();
      await closePageTarget(port, target.id);
    }
    const passed = issues.length === 0;
    checks.push({
      game: 'poe2',
      id,
      title: 'Reject poe.ninja character page URL (no PoE 1 fallback)',
      className: 'Guard',
      ascendancyName: 'ImportValidation',
      durationMs: 0,
      desktop: { passed, issues, pageErrors, consoleErrors },
      mobile: { passed, issues: [], pageErrors: [], consoleErrors: [] },
    });
  }

  // Functional Check 2: Real Chinese Ctrl+C item paste MUST equip and visibly increase Life, ES, Armour, Res & DPS
  {
    const id = 'fn-item-paste-stat-effect-zh';
    const target = await createPageTarget(port);
    const cdp = new CdpClient(target.webSocketDebuggerUrl);
    const issues = [];
    const pageErrors = [];
    const consoleErrors = [];
    try {
      await cdp.connect();
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 860,
        deviceScaleFactor: 1,
        mobile: false,
      });
      cdp.on('Runtime.exceptionThrown', (p) => pageErrors.push(String(p.exceptionDetails?.text || 'exception')));
      cdp.on('Runtime.consoleAPICalled', (p) => {
        if (p.type === 'error') consoleErrors.push((p.args || []).map((a) => a.value ?? a.description).join(' '));
      });

      await cdp.send('Storage.clearDataForOrigin', {
        origin: BASE_URL,
        storageTypes: 'local_storage',
      });
      await cdp.send('Page.navigate', { url: `${BASE_URL}/?lang=zh-CN` });
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        const ready = await cdp.evaluate(`document.body && document.body.innerText.includes('装备') && typeof window.__WEBPOB_STATE__ === 'function'`);
        if (ready) break;
        await sleep(150);
      }

      const cnItemText = [
        '物品种类: 胸甲',
        '稀有度: 稀有',
        '苍穹 守护者',
        '符文冠军胸甲',
        '--------',
        '品质: +20% (augmented)',
        '护甲值: 850 (augmented)',
        '能量护盾: 520 (augmented)',
        '--------',
        '需求:',
        '等级: 78',
        '力量: 112',
        '智慧: 112',
        '--------',
        '+45 生命上限 (rune)',
        '--------',
        '+115 生命上限',
        '火焰和闪电抗性 +38%',
        '力量和智慧 +26',
        '该装备的护甲提高 85%',
        '法术伤害提高 48%',
        '获得相当于伤害 15% 的额外闪电伤害',
      ].join('\n');

      const result = await cdp.evaluate(`(async () => {
        const navBtns = Array.from(document.querySelectorAll('nav button'));
        const itemsBtn = navBtns.find((b) => (b.textContent || '').includes('装备'));
        if (!itemsBtn) return { ok: false, reason: 'missing items tab' };
        itemsBtn.click();
        for (let i = 0; i < 30; i++) {
          if (document.querySelector('textarea')) break;
          await new Promise((r) => setTimeout(r, 150));
        }
        // Unequip existing Body Armour first if present so we test a pure clean equip delta
        const slotCards = Array.from(document.querySelectorAll('main div.pob-panel'));
        const chestRow = slotCards.find((el) => {
          const label = el.querySelector('div.text-zinc-400');
          return label && (label.textContent || '').trim() === '胸甲';
        });
        const unequipBtn = chestRow ? chestRow.querySelector('button[title="卸下"]') : null;
        if (unequipBtn) {
          unequipBtn.click();
          await new Promise((r) => setTimeout(r, 150));
        }
        const before = window.__WEBPOB_STATE__();
        const ta = document.querySelector('textarea');
        if (!ta) return { ok: false, reason: 'missing paste textarea' };
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, ${JSON.stringify(cnItemText)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 100));
        const equipBtn = Array.from(document.querySelectorAll('main button')).find((b) =>
          (b.textContent || '').includes('解析并穿戴')
        );
        if (!equipBtn) return { ok: false, reason: 'missing parse-and-equip button' };
        equipBtn.click();
        await new Promise((r) => setTimeout(r, 300));
        const after = window.__WEBPOB_STATE__();
        const bodyText = document.body ? document.body.innerText || '' : '';
        return { ok: true, before, after, bodyText };
      })()`);

      if (!result.ok) {
        issues.push(`Item paste test setup failed: ${result.reason}`);
      } else {
        const b = result.before.calc;
        const a = result.after.calc;
        if (!(a.life > b.life + 100)) {
          issues.push(`Expected Life to increase by >100 after pasting CN chest, before=${b.life}, after=${a.life}`);
        }
        if (!(a.energyShield > b.energyShield + 400)) {
          issues.push(`Expected ES to increase by >400 after pasting CN chest, before=${b.energyShield}, after=${a.energyShield}`);
        }
        if (!(a.armour > b.armour + 500)) {
          issues.push(`Expected Armour to increase by >500 after pasting CN chest, before=${b.armour}, after=${a.armour}`);
        }
        if (!(a.totalDps > b.totalDps * 1.1)) {
          issues.push(`Expected Total DPS to increase by >10% after pasting CN chest, before=${b.totalDps}, after=${a.totalDps}`);
        }
        if (!result.bodyText.includes('词缀已生效')) {
          issues.push('Expected "词缀已生效" feedback banner after pasting CN item');
        }
      }
      for (const e of pageErrors) issues.push(`pageerror: ${e}`);
      for (const e of consoleErrors) issues.push(`console.error: ${e}`);
    } finally {
      cdp.close();
      await closePageTarget(port, target.id);
    }
    const passed = issues.length === 0;
    checks.push({
      game: 'poe1',
      id,
      title: 'CN Ctrl+C item paste equips & updates Life/ES/Armour/DPS',
      className: 'Items',
      ascendancyName: 'PasteCalcDelta',
      durationMs: 0,
      desktop: { passed, issues, pageErrors, consoleErrors },
      mobile: { passed, issues: [], pageErrors: [], consoleErrors: [] },
    });
  }

  return checks;
}

function padRight(str, width) {
  const s = String(str);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function printSummaryTable(results) {
  const headers = ['Game', 'Build ID', 'Class / Ascendancy', 'Desktop', 'Mobile', 'Status'];
  const rows = results.map((r) => [
    r.game.toUpperCase(),
    r.id,
    r.ascendancyName && r.ascendancyName !== 'None'
      ? `${r.className}/${r.ascendancyName}`
      : r.className,
    r.desktop.passed ? 'PASS' : `FAIL (${r.desktop.issues.length})`,
    r.mobile.passed ? 'PASS' : `FAIL (${r.mobile.issues.length})`,
    r.desktop.passed && r.mobile.passed ? 'PASS' : 'FAIL',
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => String(row[i]).length)),
  );
  const sep = widths.map((w) => '-'.repeat(w + 2)).join('+');
  const formatRow = (row) => row.map((cell, i) => ` ${padRight(cell, widths[i])} `).join('|');

  console.log('\n' + sep);
  console.log(formatRow(headers));
  console.log(sep);
  for (const row of rows) {
    console.log(formatRow(row));
  }
  console.log(sep);

  const failed = results.filter((r) => !r.desktop.passed || !r.mobile.passed);
  const passed = results.length - failed.length;
  console.log(
    `\nE2E Summary: ${passed}/${results.length} builds passed across Desktop (1440x860) & Mobile (390x844).`,
  );

  if (failed.length > 0) {
    console.log('\nFailure Details:');
    for (const r of failed) {
      console.log(`\n- [${r.game}] ${r.id} (${r.title})`);
      for (const issue of r.desktop.issues) {
        console.log(`    [desktop] ${issue}`);
      }
      for (const issue of r.mobile.issues) {
        console.log(`    [mobile]  ${issue}`);
      }
    }
  }
}

async function main() {
  if (typeof WebSocket !== 'function' || typeof fetch !== 'function') {
    throw new Error('Node 22+ with built-in WebSocket and fetch is required.');
  }

  const builds = loadFixtures();
  console.log(`Loaded ${builds.length} poe.ninja builds from ${FIXTURES_DIR}`);
  console.log(`Target WebPoB server: ${BASE_URL}`);

  // Verify target server is reachable before spawning Chrome
  try {
    const res = await fetch(BASE_URL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    throw new Error(
      `WebPoB server at ${BASE_URL} is not reachable (${err instanceof Error ? err.message : err}). Start the server or pass BASE_URL=...`,
    );
  }

  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webpob-ninja-e2e-'));
  const chromeProc = await launchHeadlessChrome(port, userDataDir);

  const cleanup = () => {
    try {
      if (chromeProc && chromeProc.exitCode === null) {
        chromeProc.kill('SIGKILL');
      }
    } catch {
      // ignore
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      // ignore
    }
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  try {
    const jsonOutArgIdx = process.argv.indexOf('--json-out');
    const jsonOutPath =
      jsonOutArgIdx >= 0 && process.argv[jsonOutArgIdx + 1]
        ? process.argv[jsonOutArgIdx + 1]
        : process.env.JSON_OUT || '';
    const startedAt = Date.now();
    const results = [];
    for (let i = 0; i < builds.length; i++) {
      const entry = builds[i];
      const buildStart = Date.now();
      console.log(
        `[${i + 1}/${builds.length}] Testing [${entry.game}] ${entry.id} (${entry.className}/${entry.ascendancyName || 'None'})...`,
      );
      const desktop = await verifyBuildInViewport(port, entry, VIEWPORTS[0]);
      const mobile = await verifyBuildInViewport(port, entry, VIEWPORTS[1]);
      results.push({
        game: entry.game,
        id: entry.id,
        title: entry.title,
        className: entry.className,
        ascendancyName: entry.ascendancyName,
        durationMs: Date.now() - buildStart,
        desktop,
        mobile,
      });
    }

    const fnStart = Date.now();
    console.log('\nRunning interactive functional E2E checks (poe.ninja character URL guard + CN Ctrl+C item paste stat delta)...');
    const functionalResults = await verifyFunctionalRegressions(port);
    for (const fr of functionalResults) {
      fr.durationMs = Math.round((Date.now() - fnStart) / Math.max(1, functionalResults.length));
      results.push(fr);
    }

    printSummaryTable(results);
    const passedCount = results.filter((r) => r.desktop.passed && r.mobile.passed).length;
    const anyFailed = passedCount !== results.length;
    if (jsonOutPath) {
      fs.mkdirSync(path.dirname(path.resolve(jsonOutPath)), { recursive: true });
      fs.writeFileSync(
        path.resolve(jsonOutPath),
        JSON.stringify(
          {
            targetUrl: BASE_URL,
            ranAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            passedCount,
            totalCount: results.length,
            ok: !anyFailed,
            builds: results.map((r) => ({
              game: r.game,
              id: r.id,
              title: r.title,
              className: r.className,
              ascendancyName: r.ascendancyName,
              durationMs: r.durationMs,
              desktopPassed: r.desktop.passed,
              mobilePassed: r.mobile.passed,
              status: r.desktop.passed && r.mobile.passed ? 'PASS' : 'FAIL',
              desktopIssues: r.desktop.issues,
              mobileIssues: r.mobile.issues,
            })),
          },
          null,
          2,
        ),
        'utf8',
      );
    }
    process.exitCode = anyFailed ? 1 : 0;
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error(`\n[verify-ninja-e2e] ERROR: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
