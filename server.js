import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { repo } from './lib/repositories.js';

const app = express();
const root = process.cwd();
const port = Number(process.env.PORT || 3000);
const storageDir = path.resolve(root, process.env.STORAGE_PATH || './storage');
fs.mkdirSync(storageDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: storageDir,
    filename: (_, file, done) => done(null, `${Date.now()}-${crypto.randomUUID()}${file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/jpeg' ? '.jpg' : file.mimetype === 'image/gif' ? '.gif' : '.webp'}`)
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_, file, done) => done(null, /^image\/(png|jpeg|gif|webp)$/.test(file.mimetype))
});

app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/storage', express.static(storageDir, { maxAge: '7d' }));
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));

const secret = process.env.SESSION_SECRET || 'replace-this-in-env';
if (process.env.NODE_ENV === 'production' && ['replace-this-in-env', 'replace-with-a-long-random-secret'].includes(secret)) throw new Error('SESSION_SECRET must be set to a strong random value in production.');
function sign(value) { return crypto.createHmac('sha256', secret).update(value).digest('base64url'); }
function makeSession(username, days = 14) { const exp = Date.now() + 1000 * 60 * 60 * 24 * days; const raw = `${username}.${exp}`; return `${raw}.${sign(raw)}`; }
function session(req) {
  const token = req.cookies.atlas_session;
  if (!token) return null;
  const parts = token.split('.'); const signature = parts.pop(); const exp = parts.pop(); const username = parts.join('.'); const raw = `${username}.${exp}`;
  const expected = sign(raw);
  if (!signature || signature.length !== expected.length || !Number.isFinite(Number(exp)) || Number(exp) <= Date.now()) return null;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? username : null;
}
function requireAdmin(req, res, next) { const username = session(req); if (!username) return res.status(401).json({ error: '请先登录后台。' }); req.admin = username; next(); }
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
function cleanText(value, max = 180) { return String(value ?? '').trim().slice(0, max); }
function validURL(value) { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } }
function color(value) { return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#5271ff'; }
function bool(value) { return value === true || value === 'true' || value === 'on' || value === 1 || value === '1'; }
function designData(value) {
  const fallback = { paper: '#f3f5f9', ink: '#1b2440', muted: '#798198', line: '#dce1eb', card: '#ffffff', soft: '#e9edf5', accent: '#6577e6', radius: '14px', 'page-width': '1120px', 'section-gap': '44px' };
  const sizeKeys = new Set(['radius', 'page-width', 'section-gap']);
  try {
    const input = JSON.parse(String(value || '{}'));
    for (const [key, item] of Object.entries(input)) {
      const valid = sizeKeys.has(key) ? /^\d+(?:\.\d+)?(?:px|rem|%)$/.test(item) : /^#[0-9a-fA-F]{6}$/.test(item);
      if (key in fallback && valid) fallback[key] = item;
    }
  } catch { /* Fall back to safe design tokens. */ }
  return fallback;
}
function categoryData(body) { return { name: cleanText(body.name, 48), description: cleanText(body.description, 120), icon: cleanText(body.icon, 8) || '◌', color: color(body.color), visible: bool(body.visible) }; }
function linkData(body) {
  const url = validURL(cleanText(body.url, 1000));
  const category_id = Number(body.category_id);
  if (!url || !Number.isInteger(category_id)) return null;
  const icon_type = ['initial', 'url', 'upload'].includes(body.icon_type) ? body.icon_type : 'initial';
  const rawIcon = cleanText(body.icon_value, 1000);
  const icon_value = icon_type === 'url' ? (validURL(rawIcon) || '') : icon_type === 'upload' && rawIcon.startsWith('/storage/') ? rawIcon : '';
  return { category_id, name: cleanText(body.name, 60), url, description: cleanText(body.description, 150), aliases: cleanText(body.aliases, 250), icon_type, icon_value, color: color(body.color), pinned: bool(body.pinned), visible: bool(body.visible) };
}

function searchEngineData(body) {
  const name = cleanText(body.name, 30);
  const query_url = cleanText(body.query_url, 1000);
  if (!name || !query_url.includes('{query}') || !validURL(query_url.replace('{query}', 'test'))) return null;
  return { name, query_url, icon: cleanText(body.icon, 8) || '⌕', color: color(body.color), visible: bool(body.visible) };
}
function positiveId(value) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }
function reorderIds(body) { if (!Array.isArray(body?.ids)) return null; const ids = body.ids.map(positiveId); return ids.every(Boolean) && new Set(ids).size === ids.length ? ids : null; }

function isPrivateIP(ip) {
  const normalized = ip.toLowerCase().split('%')[0];
  if (normalized.startsWith('::ffff:')) return isPrivateIP(normalized.slice(7));
  if (net.isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
  }
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^(?:fe8|fe9|fea|feb)/.test(normalized);
}
async function safeRemoteURL(value) {
  const url = validURL(value); if (!url) return null;
  const host = new URL(url).hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return null;
  try { const addresses = await dns.lookup(host, { all: true, verbatim: true }); return addresses.length && addresses.every(entry => !isPrivateIP(entry.address)) ? url : null; } catch { return null; }
}
async function checkedFetch(value, options = {}) {
  let url = await safeRemoteURL(value); if (!url) throw new Error('Unsafe URL');
  for (let hop = 0; hop < 4; hop++) { const response = await fetch(url, { ...options, redirect: 'manual' }); if (![301,302,303,307,308].includes(response.status)) return response; const next = response.headers.get('location'); if (!next) return response; url = await safeRemoteURL(new URL(next, url).href); if (!url) throw new Error('Unsafe redirect'); }
  throw new Error('Too many redirects');
}
function metadataFromHTML(html, url) {
  const take = pattern => (html.match(pattern)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const title = take(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = take(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)/i) || take(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)/i);
  const icon = take(/<link[^>]+rel=["'][^"']*(?:icon)[^"']*["'][^>]+href=["']([^"']*)/i);
  return { title, description, icon: icon ? new URL(icon, url).href : new URL('/favicon.ico', url).href };
}

async function bootstrap() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const initialPassword = process.env.ADMIN_PASSWORD || 'change-this-before-running';
  if (process.env.NODE_ENV === 'production' && initialPassword === 'change-this-before-running') throw new Error('ADMIN_PASSWORD must be changed before production startup.');
  if (!repo.findAdmin(username)) repo.createAdmin(username, await bcrypt.hash(initialPassword, 12));
  if (!repo.getSettings().site_title) repo.setSetting('site_title', 'Atlas / 个人工作台');
  if (!repo.getSettings().page_title) repo.setSetting('page_title', '导航页');
  if (!repo.getSettings().brand_icon) repo.setSetting('brand_icon', '•');
  if (!repo.getSettings().layout) repo.setSetting('layout', 'standard');
  if (!repo.getSettings().site_logo) repo.setSetting('site_logo', '');
  if (!repo.getSettings().language) repo.setSetting('language', 'zh-CN');
  if (!repo.getSettings().session_days) repo.setSetting('session_days', '14');
  if (!repo.getSettings().default_search_engine) repo.setSetting('default_search_engine', 'local');
  if (!repo.getSettings().footer_text) repo.setSetting('footer_text', '你的数字坐标');
  if (!repo.getSettings().design_tokens) repo.setSetting('design_tokens', JSON.stringify(designData()));
  if (!repo.searchEngines(true).length) {
    repo.createSearchEngine({ name: 'Bing', query_url: 'https://www.bing.com/search?q={query}', icon: 'b', color: '#1683d8', visible: true });
    repo.createSearchEngine({ name: 'Google', query_url: 'https://www.google.com/search?q={query}', icon: 'G', color: '#4285f4', visible: true });
    repo.createSearchEngine({ name: '百度', query_url: 'https://www.baidu.com/s?wd={query}', icon: '百', color: '#2932e1', visible: true });
  }
  if (repo.categories(true).length) return;
  const categories = [
    ['工作流', '每天都会打开的协作与组织工具', '↗', '#5a69e8'],
    ['创造力', '从灵感到成品的创作空间', '✦', '#df6d93'],
    ['开发栈', '构建、发布与记录工作的地方', '⌘', '#0e8c83'],
    ['知识库', '阅读、保存和长期思考', '◫', '#c98435']
  ].map(([name, description, icon, color]) => { repo.createCategory({ name, description, icon, color, visible: true }); return repo.categories(true).at(-1); });
  const [work, creative, dev, knowledge] = repo.categories(true);
  [
    [work.id, 'Gmail', 'https://mail.google.com/', '收件箱与日程邀请', '#e25347'],
    [work.id, 'Notion', 'https://www.notion.so/', '项目、笔记与资料', '#161616'],
    [creative.id, 'Claude', 'https://claude.ai/', '思考、写作与研究', '#d7794a'],
    [creative.id, 'Figma', 'https://www.figma.com/', '界面与协作设计', '#8a5cf6'],
    [dev.id, 'GitHub', 'https://github.com/', '代码、Issue 与发布', '#24292f'],
    [dev.id, 'Vercel', 'https://vercel.com/', '前端部署与预览', '#141414'],
    [knowledge.id, 'Readwise', 'https://readwise.io/', '高亮、回顾与阅读', '#1d836f'],
    [knowledge.id, 'YouTube', 'https://www.youtube.com/', '教程与深度内容', '#e44741']
  ].forEach(([category_id, name, url, description, color]) => repo.createLink({ category_id, name, url, description, color, icon_type: 'initial', icon_value: '', pinned: name === 'Claude' || name === 'GitHub', visible: true }));
}

app.get('/api/nav', (_, res) => { const settings = repo.getSettings(); settings.design = designData(settings.design_tokens); res.set('Cache-Control', 'private, max-age=30'); res.json({ settings, searchEngines: repo.searchEngines(), categories: repo.categories().map(c => ({ ...c, links: repo.links(c.id) })), pinned: repo.links().filter(l => l.pinned) }); });
app.get('/api/admin/session', (req, res) => res.json({ authenticated: Boolean(session(req)), username: session(req) }));
app.post('/api/admin/login', async (req, res) => { const username = cleanText(req.body.username, 60); if (repo.recentLoginAttempts(username, Date.now() - 15 * 60 * 1000) >= 5) return res.status(429).json({ error: '尝试次数过多，请在 15 分钟后再试。' }); const admin = repo.findAdmin(username); if (!admin || !(await bcrypt.compare(String(req.body.password || ''), admin.password_hash))) { repo.recordLoginAttempt(username); return res.status(401).json({ error: '用户名或密码不正确。' }); } repo.clearLoginAttempts(username); const sessionDays = Math.min(Math.max(Number(repo.getSettings().session_days || 14), 1), 90); res.cookie('atlas_session', makeSession(username, sessionDays), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * sessionDays }); res.json({ ok: true }); });
app.post('/api/admin/logout', (_, res) => { res.clearCookie('atlas_session'); res.json({ ok: true }); });
app.get('/api/admin/data', requireAdmin, (_, res) => res.json({ settings: repo.getSettings(), categories: repo.categories(true), links: repo.links(null, true), searchEngines: repo.searchEngines(true) }));
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const layout = ['standard', 'compact', 'columns'].includes(req.body.layout) ? req.body.layout : 'standard';
  repo.setSetting('site_title', cleanText(req.body.site_title, 80) || 'Atlas / 个人工作台');
  repo.setSetting('page_title', cleanText(req.body.page_title, 40) || '导航页');
  repo.setSetting('brand_icon', cleanText(req.body.brand_icon, 8) || '•');
  repo.setSetting('layout', layout);
  const requestedLogo = cleanText(req.body.site_logo, 1000);
  repo.setSetting('site_logo', requestedLogo ? (validURL(requestedLogo) || '') : '');
  repo.setSetting('language', ['zh-CN', 'en'].includes(req.body.language) ? req.body.language : 'zh-CN');
  repo.setSetting('session_days', String(Math.min(Math.max(Number(req.body.session_days) || 14, 1), 90)));
  repo.setSetting('default_search_engine', cleanText(req.body.default_search_engine, 24) || 'local');
  repo.setSetting('footer_text', cleanText(req.body.footer_text, 120) || '你的数字坐标');
  repo.setSetting('design_tokens', JSON.stringify(designData(req.body.design_tokens)));
  res.json({ ok: true });
});
app.post('/api/admin/categories', requireAdmin, (req, res) => { const data = categoryData(req.body); if (!data.name) return res.status(400).json({ error: '请填写分类名称。' }); const r = repo.createCategory(data); res.json({ ok: true, id: r.lastInsertRowid }); });
app.put('/api/admin/categories/:id', requireAdmin, (req, res) => { const data = categoryData(req.body); if (!data.name) return res.status(400).json({ error: '请填写分类名称。' }); repo.updateCategory(Number(req.params.id), data); res.json({ ok: true }); });
app.delete('/api/admin/categories/:id', requireAdmin, (req, res) => { repo.deleteCategory(Number(req.params.id)); res.json({ ok: true }); });
app.post('/api/admin/categories/reorder', requireAdmin, (req, res) => { const ids = reorderIds(req.body); if (!ids) return res.status(400).json({ error: '排序数据无效。' }); repo.reorderCategories(ids); res.json({ ok: true }); });
app.post('/api/admin/links', requireAdmin, (req, res) => { const data = linkData(req.body); if (!data?.name) return res.status(400).json({ error: '请填写名称、有效链接并选择分类。' }); const r = repo.createLink(data); res.json({ ok: true, id: r.lastInsertRowid }); });
app.put('/api/admin/links/:id', requireAdmin, (req, res) => { const data = linkData(req.body); if (!data?.name) return res.status(400).json({ error: '请填写名称、有效链接并选择分类。' }); repo.updateLink(Number(req.params.id), data); res.json({ ok: true }); });
app.delete('/api/admin/links/:id', requireAdmin, (req, res) => { repo.deleteLink(Number(req.params.id)); res.json({ ok: true }); });
app.post('/api/admin/links/reorder', requireAdmin, (req, res) => { const ids = reorderIds(req.body); if (!ids) return res.status(400).json({ error: '排序数据无效。' }); repo.reorderLinks(ids); res.json({ ok: true }); });
app.post('/api/admin/search-engines', requireAdmin, (req, res) => { const data = searchEngineData(req.body); if (!data) return res.status(400).json({ error: '请填写名称和包含 {query} 的有效搜索 URL。' }); const r = repo.createSearchEngine(data); res.json({ ok: true, id: r.lastInsertRowid }); });
app.put('/api/admin/search-engines/:id', requireAdmin, (req, res) => { const data = searchEngineData(req.body); if (!data) return res.status(400).json({ error: '请填写名称和包含 {query} 的有效搜索 URL。' }); repo.updateSearchEngine(Number(req.params.id), data); res.json({ ok: true }); });
app.delete('/api/admin/search-engines/:id', requireAdmin, (req, res) => { repo.deleteSearchEngine(Number(req.params.id)); res.json({ ok: true }); });
app.post('/api/admin/search-engines/reorder', requireAdmin, (req, res) => { const ids = reorderIds(req.body); if (!ids) return res.status(400).json({ error: '排序数据无效。' }); repo.reorderSearchEngines(ids); res.json({ ok: true }); });
app.post('/api/admin/upload', requireAdmin, upload.single('icon'), (req, res) => { if (!req.file) return res.status(400).json({ error: '请选择 PNG、JPG、GIF 或 WebP 图片，且不超过 2 MB。' }); res.json({ url: `/storage/${req.file.filename}` }); });
app.get('/api/admin/export', requireAdmin, (_, res) => { res.setHeader('Content-Disposition', `attachment; filename="atlas-nav-backup-${new Date().toISOString().slice(0, 10)}.json"`); res.json({ version: 1, exportedAt: new Date().toISOString(), ...repo.exportData() }); });
app.post('/api/admin/import', requireAdmin, (req, res) => {
  const payload = req.body;
  if (!payload || !payload.settings || typeof payload.settings !== 'object' || !Array.isArray(payload.categories) || !Array.isArray(payload.links) || !Array.isArray(payload.searchEngines)) return res.status(400).json({ error: '备份文件格式无效或缺少必要字段。' });
  const categoryIds = new Set(payload.categories.map(item => positiveId(item.id)));
  const linkIds = new Set(payload.links.map(item => positiveId(item.id)));
  const engineIds = new Set(payload.searchEngines.map(item => positiveId(item.id)));
  const validCategories = categoryIds.size === payload.categories.length && !categoryIds.has(null) && payload.categories.every(item => categoryData(item).name);
  const validLinks = linkIds.size === payload.links.length && !linkIds.has(null) && payload.links.every(item => categoryIds.has(positiveId(item.category_id)) && linkData(item)?.name);
  const validEngines = engineIds.size === payload.searchEngines.length && !engineIds.has(null) && payload.searchEngines.every(item => searchEngineData(item));
  const importedLogo = cleanText(payload.settings.site_logo, 1000);
  if (!validCategories || !validLinks || !validEngines || (importedLogo && !validURL(importedLogo))) return res.status(400).json({ error: '备份文件格式无效或包含不安全数据。' });
  const importedSettings = {
    ...payload.settings,
    site_logo: importedLogo ? validURL(importedLogo) : '',
    layout: ['standard', 'compact', 'columns'].includes(payload.settings.layout) ? payload.settings.layout : 'standard',
    language: ['zh-CN', 'en'].includes(payload.settings.language) ? payload.settings.language : 'zh-CN',
    session_days: String(Math.min(Math.max(Number(payload.settings.session_days) || 14, 1), 90)),
    design_tokens: JSON.stringify(designData(payload.settings.design_tokens))
  };
  // Import only normalized values so valid-looking extra fields cannot bypass route validation.
  repo.importData({
    settings: importedSettings,
    categories: payload.categories.map(item => ({ ...item, ...categoryData(item) })),
    links: payload.links.map(item => ({ ...item, ...linkData(item) })),
    searchEngines: payload.searchEngines.map(item => ({ ...item, ...searchEngineData(item) }))
  });
  res.json({ ok: true });
});
app.post('/api/admin/password', requireAdmin, async (req, res) => { const current = String(req.body.current_password || ''); const next = String(req.body.new_password || ''); const admin = repo.findAdmin(req.admin); if (!admin || !(await bcrypt.compare(current, admin.password_hash))) return res.status(400).json({ error: '当前密码不正确。' }); if (next.length < 10) return res.status(400).json({ error: '新密码至少需要 10 个字符。' }); repo.updateAdminPassword(req.admin, await bcrypt.hash(next, 12)); res.json({ ok: true }); });
app.post('/api/admin/metadata', requireAdmin, asyncRoute(async (req, res) => { const requestedUrl = cleanText(req.body.url, 1000); try { const response = await checkedFetch(requestedUrl, { signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'Atlas-Nav metadata preview' } }); const html = (await response.text()).slice(0, 750000); res.json(metadataFromHTML(html, response.url)); } catch { res.status(400).json({ error: 'URL 无效、不可访问或不允许访问内网地址。' }); } }));
app.post('/api/admin/health-check', requireAdmin, asyncRoute(async (req, res) => { const links = req.body.id ? [repo.link(Number(req.body.id))].filter(Boolean) : repo.links(null, true); const results = []; for (const link of links.slice(0, 50)) { let status = 'error'; try { const response = await checkedFetch(link.url, { method: 'HEAD', signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'Atlas-Nav link checker' } }); status = response.ok ? 'ok' : `http-${response.status}`; } catch { status = 'error'; } try { repo.setLinkHealth(link.id, status); } catch { status = 'storage-error'; } results.push({ id: link.id, status }); } res.json({ ok: true, results }); }));
app.use((err, _, res, __) => { console.error('Request failed:', err); if (err instanceof multer.MulterError) return res.status(400).json({ error: '上传失败：文件不能超过 2 MB。' }); res.status(500).json({ error: '请求处理失败，请查看启动窗口中的错误信息。' }); });

await bootstrap();
app.listen(port, () => console.log(`Atlas Nav running at http://localhost:${port}`));
