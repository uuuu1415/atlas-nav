/**
 * Shared browser helpers for the public navigation page.
 * Keeping DOM and translation helpers here prevents repeated fragile one-liners.
 */
export const $ = (selector) => document.querySelector(selector);

export const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>'"]/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[char],
  );

export const translations = {
  'zh-CN': {
    local: '本站搜索',
    hint: '按 / 立即搜索 · ↵ 打开第一个结果',
    recent: '最近使用',
    pinned: '置顶入口',
    layout: '排布',
    manage: '管理',
    standard: '标准双列',
    compact: '紧凑排布',
    columns: '分栏排布',
    search: '搜索本站的工具与服务…',
    external: '输入关键词后按 ↵ 搜索',
    footer: '你的数字坐标',
  },
  en: {
    local: 'Site search',
    hint: 'Press / to search · ↵ to open first result',
    recent: 'Recent',
    pinned: 'Pinned',
    layout: 'Layout',
    manage: 'Manage',
    standard: 'Standard grid',
    compact: 'Compact',
    columns: 'Columns',
    search: 'Search your tools and services…',
    external: 'Type a query, then press ↵ to search',
    footer: 'Your digital coordinates',
  },
};

export const text = (language, key) =>
  translations[language]?.[key] ?? translations['zh-CN'][key] ?? key;
