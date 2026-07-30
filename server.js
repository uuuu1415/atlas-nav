import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import {
  hasDatabaseConfiguration,
  applySetupConfig,
  readSetupConfig,
  validateSetupInput,
  writeSetupConfig,
} from './lib/setup-config.js';

const app = express();
const execFileAsync = promisify(execFile);
let repo = null;
let databaseReady = false;
let setupState = 'unconfigured';
let setupToken =
  process.env.ATLAS_SETUP_TOKEN || crypto.randomBytes(24).toString('hex');
try {
  databaseReady = hasDatabaseConfiguration();
  if (databaseReady) applySetupConfig(readSetupConfig());
  setupState = databaseReady ? 'ready' : 'unconfigured';
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const root = process.cwd();
const port = Number(process.env.PORT || 3000);
const webUpdatesEnabled = process.env.ATLAS_ALLOW_WEB_UPDATE === '1';
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
const storageDir = path.resolve(root, process.env.STORAGE_PATH || './storage');
fs.mkdirSync(storageDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: storageDir,
    filename: (_, file, done) =>
      done(
        null,
        `${Date.now()}-${crypto.randomUUID()}${file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/jpeg' ? '.jpg' : file.mimetype === 'image/gif' ? '.gif' : '.webp'}`,
      ),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_, file, done) =>
    done(null, /^image\/(png|jpeg|gif|webp)$/.test(file.mimetype)),
});

app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/storage', express.static(storageDir, { maxAge: '7d' }));
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

app.use((req, res, next) => {
  if (
    databaseReady ||
    req.path === '/setup' ||
    req.path.startsWith('/api/setup') ||
    ['/styles.css', '/icon.svg', '/setup.js', '/favicon.ico'].includes(req.path)
  )
    return next();
  if (req.path.startsWith('/api/'))
    return res.status(503).json({ error: '请先完成数据库初始化。' });
  return res.redirect('/setup');
});
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));

app.get('/api/setup/status', (_, res) => res.json({ configured: databaseReady }));
app.post(
  '/api/setup/configure',
  asyncRoute(async (req, res) => {
    if (databaseReady || setupState !== 'unconfigured')
      return res.status(409).json({ error: '数据库正在配置或已经完成初始化。' });
    if (req.body.setupToken !== setupToken)
      return res.status(403).json({
        error: '初始化令牌无效，请查看安装器输出或服务器私有 .env。',
      });
    setupState = 'configuring';
    let config;
    try {
      config = validateSetupInput(req.body);
    } catch (error) {
      setupState = 'unconfigured';
      return res.status(400).json({ error: error.message });
    }
    const adminUsername = cleanText(req.body.adminUsername, 60) || 'admin';
    const adminPassword = String(req.body.adminPassword || '123456');
    if (adminPassword.length < 6) {
      setupState = 'unconfigured';
      return res.status(400).json({ error: '管理员密码至少需要 6 个字符。' });
    }
    config.ADMIN_USERNAME = adminUsername;
    config.ADMIN_PASSWORD = adminPassword;
    config.ADMIN_PASSWORD_HASH = await bcrypt.hash(adminPassword, 12);
    config.SESSION_SECRET = crypto.randomBytes(48).toString('base64url');
    try {
      applySetupConfig(config);
      secret = config.SESSION_SECRET;
      repo = await import('./lib/repositories.js').then((module) =>
        module.loadRepository(),
      );
      await bootstrap();
      const persistedConfig = { ...config };
      delete persistedConfig.ADMIN_PASSWORD;
      writeSetupConfig(persistedConfig);
      delete process.env.ADMIN_PASSWORD;
      delete process.env.ATLAS_SETUP_TOKEN;
      databaseReady = true;
      setupState = 'ready';
      setupToken = null;
      res.json({ ok: true, restartRequired: false });
    } catch (error) {
      try {
        await repo?.close?.();
      } catch {}
      repo = null;
      setupState = 'unconfigured';
      console.error('Database setup failed:', error.message);
      res.status(400).json({ error: '数据库连接失败，请检查配置后重试。' });
    }
  }),
);

app.get('/setup', (_, res) => res.sendFile(path.join(root, 'public', 'setup.html')));

let secret = process.env.SESSION_SECRET || 'replace-this-in-env';
if (
  databaseReady &&
  process.env.NODE_ENV === 'production' &&
  ['replace-this-in-env', 'replace-with-a-long-random-secret'].includes(secret)
)
  throw new Error('SESSION_SECRET must be set to a strong random value in production.');
function sign(value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}
function makeSession(username, days = 14) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * days;
  const raw = `${username}.${exp}`;
  return `${raw}.${sign(raw)}`;
}
function session(req) {
  const token = req.cookies.atlas_session;
  if (!token) return null;
  const parts = token.split('.');
  const signature = parts.pop();
  const exp = parts.pop();
  const username = parts.join('.');
  const raw = `${username}.${exp}`;
  const expected = sign(raw);
  if (
    !signature ||
    signature.length !== expected.length ||
    !Number.isFinite(Number(exp)) ||
    Number(exp) <= Date.now()
  )
    return null;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ? username
    : null;
}
function requireAdmin(req, res, next) {
  const username = session(req);
  if (!username) return res.status(401).json({ error: '请先登录后台。' });
  req.admin = username;
  next();
}
function secureCookie(req) {
  return req.secure;
}
async function command(command, args) {
  return execFileAsync(command, args, {
    cwd: root,
    timeout: 120000,
    windowsHide: true,
  });
}
async function updateStatus(fetchRemote = true) {
  if (!webUpdatesEnabled || !fs.existsSync(path.join(root, '.git'))) {
    return { enabled: false, available: false };
  }
  if (fetchRemote) await command('git', ['fetch', '--quiet', 'origin', 'main']);
  const [{ stdout: count }, { stdout: status }] = await Promise.all([
    command('git', ['rev-list', '--count', 'HEAD..origin/main']),
    command('git', ['status', '--porcelain']),
  ]);
  return {
    enabled: true,
    available: Number(count.trim()) > 0,
    clean: status.trim() === '',
  };
}
function cleanText(value, max = 180) {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}
function validURL(value) {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
function color(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#5271ff';
}
function bool(value) {
  return (
    value === true || value === 'true' || value === 'on' || value === 1 || value === '1'
  );
}
function designData(value) {
  const fallback = {
    paper: '#f3f5f9',
    ink: '#1b2440',
    muted: '#798198',
    line: '#dce1eb',
    card: '#ffffff',
    soft: '#e9edf5',
    accent: '#6577e6',
    radius: '14px',
    'page-width': '1120px',
    'section-gap': '44px',
  };
  const sizeKeys = new Set(['radius', 'page-width', 'section-gap']);
  try {
    const input = JSON.parse(String(value || '{}'));
    for (const [key, item] of Object.entries(input)) {
      const valid = sizeKeys.has(key)
        ? /^\d+(?:\.\d+)?(?:px|rem|%)$/.test(item)
        : /^#[0-9a-fA-F]{6}$/.test(item);
      if (key in fallback && valid) fallback[key] = item;
    }
  } catch {
    /* Fall back to safe design tokens. */
  }
  return fallback;
}
function categoryData(body) {
  return {
    name: cleanText(body.name, 48),
    description: cleanText(body.description, 120),
    icon: cleanText(body.icon, 8) || '◌',
    color: color(body.color),
    visible: bool(body.visible),
  };
}
function linkData(body) {
  const url = validURL(cleanText(body.url, 1000));
  const category_id = Number(body.category_id);
  if (!url || !Number.isInteger(category_id)) return null;
  const icon_type = ['initial', 'url', 'upload'].includes(body.icon_type)
    ? body.icon_type
    : 'initial';
  const rawIcon = cleanText(body.icon_value, 1000);
  const icon_value =
    icon_type === 'url'
      ? validURL(rawIcon) || ''
      : icon_type === 'upload' && rawIcon.startsWith('/storage/')
        ? rawIcon
        : '';
  return {
    category_id,
    name: cleanText(body.name, 60),
    url,
    description: cleanText(body.description, 150),
    aliases: cleanText(body.aliases, 250),
    icon_type,
    icon_value,
    color: color(body.color),
    pinned: bool(body.pinned),
    visible: bool(body.visible),
  };
}

function searchEngineData(body) {
  const name = cleanText(body.name, 30);
  const query_url = cleanText(body.query_url, 1000);
  if (
    !name ||
    !query_url.includes('{query}') ||
    !validURL(query_url.replace('{query}', 'test'))
  )
    return null;
  return {
    name,
    query_url,
    icon: cleanText(body.icon, 8) || '⌕',
    color: color(body.color),
    visible: bool(body.visible),
  };
}
function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function reorderIds(body) {
  if (!Array.isArray(body?.ids)) return null;
  const ids = body.ids.map(positiveId);
  return ids.every(Boolean) && new Set(ids).size === ids.length ? ids : null;
}

function isPrivateIP(ip) {
  const normalized = ip.toLowerCase().split('%')[0];
  if (normalized.startsWith('::ffff:')) return isPrivateIP(normalized.slice(7));
  if (net.isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^(?:fe8|fe9|fea|feb)/.test(normalized)
  );
}
async function safeRemoteURL(value) {
  const url = validURL(value);
  if (!url) return null;
  const host = new URL(url).hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return null;
  try {
    const addresses = await dns.lookup(host, { all: true, verbatim: true });
    return addresses.length && addresses.every((entry) => !isPrivateIP(entry.address))
      ? url
      : null;
  } catch {
    return null;
  }
}
async function checkedFetch(value, options = {}) {
  let url = await safeRemoteURL(value);
  if (!url) throw new Error('Unsafe URL');
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetch(url, { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const next = response.headers.get('location');
    if (!next) return response;
    url = await safeRemoteURL(new URL(next, url).href);
    if (!url) throw new Error('Unsafe redirect');
  }
  throw new Error('Too many redirects');
}
function metadataFromHTML(html, url) {
  const take = (pattern) =>
    (html.match(pattern)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const title = take(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    take(
      /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)/i,
    ) ||
    take(
      /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)/i,
    );
  const icon = take(
    /<link[^>]+rel=["'][^"']*(?:icon)[^"']*["'][^>]+href=["']([^"']*)/i,
  );
  return {
    title,
    description,
    icon: icon ? new URL(icon, url).href : new URL('/favicon.ico', url).href,
  };
}

async function bootstrap() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const initialPassword = process.env.ADMIN_PASSWORD || 'change-this-before-running';
  if (
    process.env.NODE_ENV === 'production' &&
    initialPassword === 'change-this-before-running' &&
    !process.env.ADMIN_PASSWORD_HASH
  )
    throw new Error('ADMIN_PASSWORD must be changed before production startup.');
  const existingAdmin = await repo.findAdmin(username);
  if (!existingAdmin)
    await repo.createAdmin(
      username,
      process.env.ADMIN_PASSWORD_HASH || (await bcrypt.hash(initialPassword, 12)),
    );
  else if (process.env.ADMIN_PASSWORD_HASH)
    await repo.updateAdminPassword(username, process.env.ADMIN_PASSWORD_HASH);
  const settings = await repo.getSettings();
  const defaults = {
    site_title: 'Atlas / 个人工作台',
    page_title: '导航页',
    brand_icon: '•',
    layout: 'standard',
    site_logo: '',
    language: 'zh-CN',
    session_days: '14',
    default_search_engine: 'local',
    footer_text: '你的数字坐标',
    design_tokens: JSON.stringify(designData()),
  };
  for (const [key, value] of Object.entries(defaults))
    if (!settings[key]) await repo.setSetting(key, value);
  if (!(await repo.searchEngines(true)).length) {
    await repo.createSearchEngine({
      name: 'Bing',
      query_url: 'https://www.bing.com/search?q={query}',
      icon: 'b',
      color: '#1683d8',
      visible: true,
    });
    await repo.createSearchEngine({
      name: 'Google',
      query_url: 'https://www.google.com/search?q={query}',
      icon: 'G',
      color: '#4285f4',
      visible: true,
    });
    await repo.createSearchEngine({
      name: '百度',
      query_url: 'https://www.baidu.com/s?wd={query}',
      icon: '百',
      color: '#2932e1',
      visible: true,
    });
  }
  if ((await repo.categories(true)).length) return;
  const categories = [
    ['工作流', '每天都会打开的协作与组织工具', '↗', '#5a69e8'],
    ['创造力', '从灵感到成品的创作空间', '✦', '#df6d93'],
    ['开发栈', '构建、发布与记录工作的地方', '⌘', '#0e8c83'],
    ['知识库', '阅读、保存和长期思考', '◫', '#c98435'],
  ];
  for (const [name, description, icon, color] of categories)
    await repo.createCategory({
      name,
      description,
      icon,
      color,
      visible: true,
    });
  const [work, creative, dev, knowledge] = await repo.categories(true);
  for (const [category_id, name, url, description, color] of [
    [work.id, 'Gmail', 'https://mail.google.com/', '收件箱与日程邀请', '#e25347'],
    [work.id, 'Notion', 'https://www.notion.so/', '项目、笔记与资料', '#161616'],
    [creative.id, 'Claude', 'https://claude.ai/', '思考、写作与研究', '#d7794a'],
    [creative.id, 'Figma', 'https://www.figma.com/', '界面与协作设计', '#8a5cf6'],
    [dev.id, 'GitHub', 'https://github.com/', '代码、Issue 与发布', '#24292f'],
    [dev.id, 'Vercel', 'https://vercel.com/', '前端部署与预览', '#141414'],
    [knowledge.id, 'Readwise', 'https://readwise.io/', '高亮、回顾与阅读', '#1d836f'],
    [knowledge.id, 'YouTube', 'https://www.youtube.com/', '教程与深度内容', '#e44741'],
  ])
    await repo.createLink({
      category_id,
      name,
      url,
      description,
      color,
      icon_type: 'initial',
      icon_value: '',
      pinned: name === 'Claude' || name === 'GitHub',
      visible: true,
    });
}

app.get(
  '/api/nav',
  asyncRoute(async (_, res) => {
    const settings = await repo.getSettings();
    settings.design = designData(settings.design_tokens);
    const categories = await repo.categories();
    res.set('Cache-Control', 'private, max-age=30');
    res.json({
      settings,
      searchEngines: await repo.searchEngines(),
      categories: await Promise.all(
        categories.map(async (c) => ({ ...c, links: await repo.links(c.id) })),
      ),
      pinned: (await repo.links()).filter((l) => l.pinned),
    });
  }),
);
app.get('/api/admin/session', (req, res) =>
  res.json({ authenticated: Boolean(session(req)), username: session(req) }),
);
app.post(
  '/api/admin/login',
  asyncRoute(async (req, res) => {
    const username = cleanText(req.body.username, 60);
    if ((await repo.recentLoginAttempts(username, Date.now() - 15 * 60 * 1000)) >= 5)
      return res.status(429).json({ error: '尝试次数过多，请在 15 分钟后再试。' });
    const admin = await repo.findAdmin(username);
    if (
      !admin ||
      !(await bcrypt.compare(String(req.body.password || ''), admin.password_hash))
    ) {
      await repo.recordLoginAttempt(username);
      return res.status(401).json({ error: '用户名或密码不正确。' });
    }
    await repo.clearLoginAttempts(username);
    const sessionDays = Math.min(
      Math.max(Number((await repo.getSettings()).session_days || 14), 1),
      90,
    );
    res.cookie('atlas_session', makeSession(username, sessionDays), {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookie(req),
      maxAge: 1000 * 60 * 60 * 24 * sessionDays,
    });
    res.json({ ok: true });
  }),
);
app.post('/api/admin/logout', (_, res) => {
  res.clearCookie('atlas_session');
  res.json({ ok: true });
});
app.get(
  '/api/admin/update-status',
  requireAdmin,
  asyncRoute(async (_, res) => {
    try {
      res.json(await updateStatus());
    } catch {
      res.status(502).json({ error: '无法检查远端更新，请检查服务器 Git 连接。' });
    }
  }),
);
app.post(
  '/api/admin/update',
  requireAdmin,
  asyncRoute(async (_, res) => {
    const status = await updateStatus();
    if (!status.enabled)
      return res.status(403).json({ error: '当前部署未启用网页更新。' });
    if (!status.clean)
      return res
        .status(409)
        .json({ error: '服务器工作区有未提交修改，已拒绝自动更新。' });
    if (!status.available) return res.json({ ok: true, updated: false });
    await command('git', ['pull', '--ff-only', 'origin', 'main']);
    await command(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
      'ci',
      '--omit=dev',
    ]);
    res.json({ ok: true, updated: true, restartRequired: true });
    setTimeout(() => process.exit(0), 500).unref();
  }),
);
app.get(
  '/api/admin/data',
  requireAdmin,
  asyncRoute(async (_, res) =>
    res.json({
      settings: await repo.getSettings(),
      categories: await repo.categories(true),
      links: await repo.links(null, true),
      searchEngines: await repo.searchEngines(true),
    }),
  ),
);
app.put(
  '/api/admin/settings',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const layout = ['standard', 'compact', 'columns'].includes(req.body.layout)
      ? req.body.layout
      : 'standard';
    await repo.setSetting(
      'site_title',
      cleanText(req.body.site_title, 80) || 'Atlas / 个人工作台',
    );
    await repo.setSetting('page_title', cleanText(req.body.page_title, 40) || '导航页');
    await repo.setSetting('brand_icon', cleanText(req.body.brand_icon, 8) || '•');
    await repo.setSetting('layout', layout);
    const requestedLogo = cleanText(req.body.site_logo, 1000);
    await repo.setSetting(
      'site_logo',
      requestedLogo ? validURL(requestedLogo) || '' : '',
    );
    await repo.setSetting(
      'language',
      ['zh-CN', 'en'].includes(req.body.language) ? req.body.language : 'zh-CN',
    );
    await repo.setSetting(
      'session_days',
      String(Math.min(Math.max(Number(req.body.session_days) || 14, 1), 90)),
    );
    await repo.setSetting(
      'default_search_engine',
      cleanText(req.body.default_search_engine, 24) || 'local',
    );
    await repo.setSetting(
      'footer_text',
      cleanText(req.body.footer_text, 120) || '你的数字坐标',
    );
    await repo.setSetting(
      'design_tokens',
      JSON.stringify(designData(req.body.design_tokens)),
    );
    res.json({ ok: true });
  }),
);
app.post(
  '/api/admin/categories',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const data = categoryData(req.body);
    if (!data.name) return res.status(400).json({ error: '请填写分类名称。' });
    const r = await repo.createCategory(data);
    res.json({ ok: true, id: r.lastInsertRowid });
  }),
);
app.put(
  '/api/admin/categories/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const data = categoryData(req.body);
    if (!data.name) return res.status(400).json({ error: '请填写分类名称。' });
    await repo.updateCategory(Number(req.params.id), data);
    res.json({ ok: true });
  }),
);
app.delete(
  '/api/admin/categories/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    await repo.deleteCategory(Number(req.params.id));
    res.json({ ok: true });
  }),
);
app.post(
  '/api/admin/categories/reorder',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const ids = reorderIds(req.body);
    if (!ids) return res.status(400).json({ error: '排序数据无效。' });
    await repo.reorderCategories(ids);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/admin/links',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const data = linkData(req.body);
    if (!data?.name)
      return res.status(400).json({ error: '请填写名称、有效链接并选择分类。' });
    const r = await repo.createLink(data);
    res.json({ ok: true, id: r.lastInsertRowid });
  }),
);
app.put(
  '/api/admin/links/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const data = linkData(req.body);
    if (!data?.name)
      return res.status(400).json({ error: '请填写名称、有效链接并选择分类。' });
    await repo.updateLink(Number(req.params.id), data);
    res.json({ ok: true });
  }),
);
app.delete(
  '/api/admin/links/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    await repo.deleteLink(Number(req.params.id));
    res.json({ ok: true });
  }),
);
app.post(
  '/api/admin/links/reorder',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const ids = reorderIds(req.body);
    if (!ids) return res.status(400).json({ error: '排序数据无效。' });
    await repo.reorderLinks(ids);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/admin/search-engines',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const data = searchEngineData(req.body);
    if (!data)
      return res
        .status(400)
        .json({ error: '请填写名称和包含 {query} 的有效搜索 URL。' });
    const r = await repo.createSearchEngine(data);
    res.json({ ok: true, id: r.lastInsertRowid });
  }),
);
app.put(
  '/api/admin/search-engines/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const data = searchEngineData(req.body);
    if (!data)
      return res
        .status(400)
        .json({ error: '请填写名称和包含 {query} 的有效搜索 URL。' });
    await repo.updateSearchEngine(Number(req.params.id), data);
    res.json({ ok: true });
  }),
);
app.delete(
  '/api/admin/search-engines/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    await repo.deleteSearchEngine(Number(req.params.id));
    res.json({ ok: true });
  }),
);
app.post(
  '/api/admin/search-engines/reorder',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const ids = reorderIds(req.body);
    if (!ids) return res.status(400).json({ error: '排序数据无效。' });
    await repo.reorderSearchEngines(ids);
    res.json({ ok: true });
  }),
);
app.post('/api/admin/upload', requireAdmin, upload.single('icon'), (req, res) => {
  if (!req.file)
    return res
      .status(400)
      .json({ error: '请选择 PNG、JPG、GIF 或 WebP 图片，且不超过 2 MB。' });
  res.json({ url: `/storage/${req.file.filename}` });
});
app.get(
  '/api/admin/export',
  requireAdmin,
  asyncRoute(async (_, res) => {
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="atlas-nav-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      ...(await repo.exportData()),
    });
  }),
);
app.post(
  '/api/admin/import',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const payload = req.body;
    if (
      !payload ||
      !payload.settings ||
      typeof payload.settings !== 'object' ||
      !Array.isArray(payload.categories) ||
      !Array.isArray(payload.links) ||
      !Array.isArray(payload.searchEngines)
    )
      return res.status(400).json({ error: '备份文件格式无效或缺少必要字段。' });
    const categoryIds = new Set(payload.categories.map((item) => positiveId(item.id)));
    const linkIds = new Set(payload.links.map((item) => positiveId(item.id)));
    const engineIds = new Set(payload.searchEngines.map((item) => positiveId(item.id)));
    const validCategories =
      categoryIds.size === payload.categories.length &&
      !categoryIds.has(null) &&
      payload.categories.every((item) => categoryData(item).name);
    const validLinks =
      linkIds.size === payload.links.length &&
      !linkIds.has(null) &&
      payload.links.every(
        (item) => categoryIds.has(positiveId(item.category_id)) && linkData(item)?.name,
      );
    const validEngines =
      engineIds.size === payload.searchEngines.length &&
      !engineIds.has(null) &&
      payload.searchEngines.every((item) => searchEngineData(item));
    const importedLogo = cleanText(payload.settings.site_logo, 1000);
    if (
      !validCategories ||
      !validLinks ||
      !validEngines ||
      (importedLogo && !validURL(importedLogo))
    )
      return res.status(400).json({ error: '备份文件格式无效或包含不安全数据。' });
    const importedSettings = {
      ...payload.settings,
      site_logo: importedLogo ? validURL(importedLogo) : '',
      layout: ['standard', 'compact', 'columns'].includes(payload.settings.layout)
        ? payload.settings.layout
        : 'standard',
      language: ['zh-CN', 'en'].includes(payload.settings.language)
        ? payload.settings.language
        : 'zh-CN',
      session_days: String(
        Math.min(Math.max(Number(payload.settings.session_days) || 14, 1), 90),
      ),
      design_tokens: JSON.stringify(designData(payload.settings.design_tokens)),
    };
    // Import only normalized values so valid-looking extra fields cannot bypass route validation.
    await repo.importData({
      settings: importedSettings,
      categories: payload.categories.map((item) => ({
        ...item,
        ...categoryData(item),
      })),
      links: payload.links.map((item) => ({ ...item, ...linkData(item) })),
      searchEngines: payload.searchEngines.map((item) => ({
        ...item,
        ...searchEngineData(item),
      })),
    });
    res.json({ ok: true });
  }),
);
app.post(
  '/api/admin/password',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const current = String(req.body.current_password || '');
    const next = String(req.body.new_password || '');
    const admin = await repo.findAdmin(req.admin);
    if (!admin || !(await bcrypt.compare(current, admin.password_hash)))
      return res.status(400).json({ error: '当前密码不正确。' });
    if (next.length < 10)
      return res.status(400).json({ error: '新密码至少需要 10 个字符。' });
    await repo.updateAdminPassword(req.admin, await bcrypt.hash(next, 12));
    res.json({ ok: true });
  }),
);
app.post(
  '/api/admin/metadata',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const requestedUrl = cleanText(req.body.url, 1000);
    try {
      const response = await checkedFetch(requestedUrl, {
        signal: AbortSignal.timeout(7000),
        headers: { 'User-Agent': 'Atlas-Nav metadata preview' },
      });
      const html = (await response.text()).slice(0, 750000);
      res.json(metadataFromHTML(html, response.url));
    } catch {
      res.status(400).json({ error: 'URL 无效、不可访问或不允许访问内网地址。' });
    }
  }),
);
app.post(
  '/api/admin/health-check',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const links = req.body.id
      ? [await repo.link(Number(req.body.id))].filter(Boolean)
      : await repo.links(null, true);
    const results = [];
    for (const link of links.slice(0, 50)) {
      let status = 'error';
      try {
        const response = await checkedFetch(link.url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(7000),
          headers: { 'User-Agent': 'Atlas-Nav link checker' },
        });
        status = response.ok ? 'ok' : `http-${response.status}`;
      } catch {
        status = 'error';
      }
      try {
        await repo.setLinkHealth(link.id, status);
      } catch {
        status = 'storage-error';
      }
      results.push({ id: link.id, status });
    }
    res.json({ ok: true, results });
  }),
);
app.use((err, _, res, __) => {
  console.error('Request failed:', err);
  if (err instanceof multer.MulterError)
    return res.status(400).json({ error: '上传失败：文件不能超过 2 MB。' });
  res.status(500).json({ error: '请求处理失败，请查看启动窗口中的错误信息。' });
});

if (databaseReady) {
  repo = await import('./lib/repositories.js').then((module) =>
    module.loadRepository(),
  );
  await bootstrap();
}
if (!databaseReady) console.log(`Atlas Nav setup token: ${setupToken}`);
app.listen(port, () => console.log(`Atlas Nav running at http://localhost:${port}`));
