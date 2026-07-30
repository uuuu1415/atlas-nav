import { $, escapeHTML, text } from './shared.js';

const state = {
  data: null,
  query: '',
  searchMode: 'local',
  language: localStorage.getItem('atlas-language') || 'zh-CN'
};

function linkMatches(link) {
  const searchable = `${link.name} ${link.description} ${link.aliases || ''} ${link.url}`.toLowerCase();
  return !state.query || searchable.includes(state.query);
}

function createLinkCard(link) {
  const fragment = $('#link-card').content.cloneNode(true);
  const anchor = fragment.querySelector('a');
  const icon = fragment.querySelector('.service-icon');

  anchor.href = link.url;
  anchor.addEventListener('click', () => recordRecentLink(link));
  anchor.querySelector('strong').textContent = link.name;
  anchor.querySelector('small').textContent = link.description || new URL(link.url).hostname;
  icon.style.setProperty('--accent', link.color || '#5271ff');

  if (link.icon_type === 'url' && link.icon_value) {
    const image = new Image();
    image.src = link.icon_value;
    image.alt = '';
    image.addEventListener('error', () => { icon.textContent = link.name[0].toUpperCase(); });
    icon.append(image);
  } else {
    icon.textContent = link.name[0].toUpperCase();
  }
  return fragment;
}

function recordRecentLink(link) {
  const existing = JSON.parse(localStorage.getItem('atlas-recent-links') || '[]').filter(item => item.id !== link.id);
  existing.unshift({ id: link.id });
  localStorage.setItem('atlas-recent-links', JSON.stringify(existing.slice(0, 6)));
}

function renderBrand(settings) {
  document.title = settings.site_title || 'Atlas';
  $('#footer-title').textContent = settings.site_title || 'Atlas';
  $('#brand-name').textContent = (settings.site_title || 'ATLAS').split(/[\/／]/)[0].toUpperCase();
  $('#brand-icon').textContent = settings.brand_icon || '•';
  $('#page-title').textContent = settings.page_title || '导航页';
  $('#footer-copy').textContent = settings.footer_text || text(state.language, 'footer');

  const logo = $('#site-logo');
  logo.src = settings.site_logo || '';
  logo.hidden = !settings.site_logo;
}

function applyDesignSettings(settings) {
  const root = document.documentElement;
  const design = settings.design || {};
  for (const [name, value] of Object.entries(design)) root.style.setProperty(`--${name}`, value);
  document.body.dataset.layout = localStorage.getItem('atlas-layout') || settings.layout || 'standard';
}

function renderSearchMenu() {
  const menu = $('#search-menu');
  const engines = state.data.searchEngines;
  menu.innerHTML = `<button data-search-mode="local"><span class="menu-dot"></span>${text(state.language, 'local')}</button>` + engines.map(engine =>
    `<button data-search-mode="${engine.id}"><span class="engine-mark" style="--engine:${escapeHTML(engine.color)}">${escapeHTML(engine.icon)}</span>${escapeHTML(engine.name)}</button>`
  ).join('');

  menu.querySelectorAll('[data-search-mode]').forEach(button => {
    button.addEventListener('click', () => {
      state.searchMode = button.dataset.searchMode === 'local' ? 'local' : Number(button.dataset.searchMode);
      state.query = '';
      $('#search').value = '';
      menu.hidden = true;
      render();
    });
  });
}

function renderSections(categories, pinned) {
  const isLocalSearch = state.searchMode === 'local';
  const allLinks = categories.flatMap(category => category.links);
  const recentIds = JSON.parse(localStorage.getItem('atlas-recent-links') || '[]').map(item => item.id);
  const recentLinks = recentIds.map(id => allLinks.find(link => link.id === id)).filter(Boolean);

  $('#recent-area').hidden = recentLinks.length === 0;
  $('#recent-title').textContent = text(state.language, 'recent');
  $('#recent').replaceChildren(...recentLinks.map(createLinkCard));

  const visiblePinned = (isLocalSearch ? pinned.filter(linkMatches) : pinned);
  $('#pinned-area').hidden = visiblePinned.length === 0;
  $('#pinned-title').textContent = text(state.language, 'pinned');
  $('#pinned').replaceChildren(...visiblePinned.map(createLinkCard));

  const catalog = $('#catalog');
  const categoryNav = $('#category-nav');
  catalog.replaceChildren();
  categoryNav.replaceChildren();
  let resultCount = 0;

  for (const category of categories) {
    const links = isLocalSearch ? category.links.filter(linkMatches) : category.links;
    if (!links.length) continue;
    resultCount += links.length;

    const navLink = document.createElement('a');
    navLink.href = `#category-${category.id}`;
    navLink.textContent = category.name;
    categoryNav.append(navLink);

    const section = document.createElement('section');
    section.className = 'category';
    section.id = `category-${category.id}`;
    section.innerHTML = `<div class="category-head"><div><span class="category-symbol" style="--accent:${escapeHTML(category.color)}">${escapeHTML(category.icon)}</span><h2>${escapeHTML(category.name)}</h2><p>${escapeHTML(category.description)}</p></div><span class="count">${String(links.length).padStart(2, '0')}</span></div><div class="link-grid"></div>`;
    section.querySelector('.link-grid').append(...links.map(createLinkCard));
    catalog.append(section);
  }
  return resultCount;
}

function render() {
  const { settings, categories, pinned } = state.data;
  document.documentElement.lang = state.language;
  renderBrand(settings);
  applyDesignSettings(settings);

  $('#admin-label').textContent = text(state.language, 'manage');
  $('#layout-toggle').title = text(state.language, 'layout');
  $('#search').placeholder = state.searchMode === 'local' ? text(state.language, 'search') : text(state.language, 'external');
  document.querySelectorAll('#layout-menu [data-layout]').forEach(button => { button.textContent = text(state.language, button.dataset.layout); });

  const resultCount = renderSections(categories, pinned);
  const engine = state.data.searchEngines.find(item => item.id === state.searchMode);
  $('#search-mode-label').textContent = state.searchMode === 'local' ? text(state.language, 'local') : engine?.name || 'Search';
  $('#result-note').innerHTML = state.searchMode === 'local'
    ? (state.query ? `${resultCount} results · <b>↵</b>` : text(state.language, 'hint'))
    : `${text(state.language, 'external')} ${escapeHTML(engine?.name || '')}`;
  renderSearchMenu();
}

async function initialize() {
  const response = await fetch('/api/nav');
  if (!response.ok) throw new Error('Unable to load navigation data');
  state.data = await response.json();
  if (!localStorage.getItem('atlas-language')) state.language = state.data.settings.language || 'zh-CN';

  const defaultEngine = Number(state.data.settings.default_search_engine);
  if (state.data.settings.default_search_engine !== 'local' && state.data.searchEngines.some(engine => engine.id === defaultEngine)) state.searchMode = defaultEngine;
  render();
}

$('#search').addEventListener('input', event => {
  if (state.searchMode === 'local') {
    state.query = event.target.value.toLowerCase().trim();
    render();
  }
});
$('#search-mode').addEventListener('click', event => { event.stopPropagation(); $('#search-menu').hidden = !$('#search-menu').hidden; });
$('#lang-toggle').addEventListener('click', () => { state.language = state.language === 'zh-CN' ? 'en' : 'zh-CN'; localStorage.setItem('atlas-language', state.language); render(); });
$('#layout-toggle').addEventListener('click', event => { event.stopPropagation(); $('#layout-menu').hidden = !$('#layout-menu').hidden; });
document.querySelectorAll('#layout-menu [data-layout]').forEach(button => button.addEventListener('click', () => { localStorage.setItem('atlas-layout', button.dataset.layout); render(); }));
$('#theme').addEventListener('click', () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; localStorage.setItem('atlas-theme', next); });

document.addEventListener('click', () => { $('#search-menu').hidden = true; $('#layout-menu').hidden = true; });
document.addEventListener('keydown', event => {
  const input = $('#search');
  if (event.key === '/' && document.activeElement !== input) { event.preventDefault(); input.focus(); }
  if (event.key !== 'Enter' || document.activeElement !== input || !input.value.trim()) return;
  if (state.searchMode === 'local') document.querySelector('.link-card')?.click();
  else {
    const engine = state.data.searchEngines.find(item => item.id === state.searchMode);
    if (engine) window.open(engine.query_url.replace('{query}', encodeURIComponent(input.value.trim())), '_blank', 'noopener');
  }
});

const savedTheme = localStorage.getItem('atlas-theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$('#date-line').textContent = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
initialize().catch(error => { console.error(error); $('#catalog').innerHTML = '<p class="error-note">Unable to load navigation data. Please check the local server.</p>'; });
