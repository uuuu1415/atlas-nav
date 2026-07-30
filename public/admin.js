const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const notice = document.querySelector('#notice');
const $ = (selector) => document.querySelector(selector);
let data;

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(body.error || '操作失败。');
  return body;
};
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const say = (message) => {
  notice.textContent = message;
  notice.classList.add('show');
  setTimeout(() => notice.classList.remove('show'), 2200);
};
const close = () => {
  modal.hidden = true;
};
const open = (content) => {
  modal.innerHTML = `<div class="modal-card">${content}</div>`;
  modal.hidden = false;
  modal.onclick = (event) => {
    if (event.target === modal) close();
  };
};

function login() {
  app.innerHTML =
    '<section class="login-card"><h1>进入后台</h1><p>使用 .env 中设置的管理员账号。</p><form id="login"><div class="field"><label>用户名</label><input name="username" autocomplete="username" required></div><div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password" required></div><button class="button" style="width:100%">登录管理工作台</button></form></section>';
  $('#login').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(event.target))),
      });
      await load();
    } catch (error) {
      say(error.message);
    }
  };
}

function record(item, type) {
  const sub =
    type === 'category'
      ? `${item.link_count} 个链接 · ${item.description || '无说明'}`
      : type === 'engine'
        ? item.query_url
        : `${item.category_name} · ${item.url}`;
  return `<div class="record ${item.visible ? '' : 'dim'}" draggable="true" data-id="${item.id}"><span class="drag">⠿</span>${type === 'engine' ? `<span class="engine-mark" style="--engine:${esc(item.color)}">${esc(item.icon)}</span>` : ''}<div class="record-info"><strong>${esc(item.name)} ${item.pinned ? '<span style="color:#e09052">●</span>' : ''}</strong><small>${esc(sub)} ${item.health_status && item.health_status !== 'unknown' ? ` · ${esc(item.health_status)}` : ''}</small></div><div class="record-actions"><button class="mini" data-edit="${type}:${item.id}">编辑</button><button class="mini" data-del="${type}:${item.id}">删除</button></div></div>`;
}

function drag(listId, endpoint) {
  const box = document.querySelector(`#${listId}`);
  let source;
  box.querySelectorAll('.record').forEach((element) => {
    element.ondragstart = () => {
      source = element;
    };
    element.ondragover = (event) => {
      event.preventDefault();
      const after = [...box.children].find(
        (child) =>
          event.clientY < child.getBoundingClientRect().top + child.offsetHeight / 2,
      );
      box.insertBefore(source, after || null);
    };
    element.ondragend = async () => {
      try {
        await api(`/api/admin/${endpoint}/reorder`, {
          method: 'POST',
          body: JSON.stringify({
            ids: [...box.querySelectorAll('.record')].map((item) =>
              Number(item.dataset.id),
            ),
          }),
        });
        await load();
      } catch (error) {
        say(error.message);
      }
    };
  });
}

function dashboard() {
  $('#logout').hidden = false;
  app.innerHTML = `<div class="toolbar"><div><h2>导航内容</h2><p class="hint">管理内容、搜索引擎与站点维护操作。</p></div><div class="toolbar-actions"><button class="button ghost" id="maintenance">维护工具</button><button class="button ghost" id="site-settings">站点设置</button></div></div><div class="admin-grid"><section class="panel"><div class="panel-head"><h3>分类</h3><button class="button" id="new-category">新建分类</button></div><div id="categories">${data.categories.map((item) => record(item, 'category')).join('')}</div></section><section class="panel"><div class="panel-head"><h3>链接</h3><button class="button" id="new-link">新建链接</button></div><div id="links">${data.links.map((item) => record(item, 'link')).join('')}</div></section></div><section class="panel engines-panel"><div class="panel-head"><h3>搜索引擎</h3><button class="button" id="new-engine">新建搜索引擎</button></div><div id="engines">${data.searchEngines.map((item) => record(item, 'engine')).join('')}</div></section>`;
  [
    ['categories', 'categories'],
    ['links', 'links'],
    ['engines', 'search-engines'],
  ].forEach(([id, endpoint]) => drag(id, endpoint));
  $('#new-category').onclick = () => categoryForm();
  $('#new-link').onclick = () => linkForm();
  $('#new-engine').onclick = () => engineForm();
  $('#site-settings').onclick = settingsForm;
  $('#maintenance').onclick = maintenance;
  document.querySelectorAll('[data-edit]').forEach(
    (button) =>
      (button.onclick = () => {
        const [type, id] = button.dataset.edit.split(':');
        const list =
          type === 'category'
            ? data.categories
            : type === 'link'
              ? data.links
              : data.searchEngines;
        ({ category: categoryForm, link: linkForm, engine: engineForm })[type](
          list.find((item) => item.id == id),
        );
      }),
  );
  document.querySelectorAll('[data-del]').forEach(
    (button) =>
      (button.onclick = async () => {
        const [type, id] = button.dataset.del.split(':');
        if (!confirm('确定删除吗？')) return;
        try {
          await api(
            `/api/admin/${type === 'category' ? 'categories' : type === 'link' ? 'links' : 'search-engines'}/${id}`,
            { method: 'DELETE' },
          );
          say('已删除。');
          await load();
        } catch (error) {
          say(error.message);
        }
      }),
  );
}

function form(title, fields, item, endpoint) {
  open(
    `<h2>${item.id ? '编辑' : '新建'}${title}</h2><form id="edit-form">${fields}<label class="check"><input name="visible" type="checkbox" ${item.visible ? 'checked' : ''}>显示</label><div class="modal-actions"><button type="button" class="button ghost" id="cancel">取消</button><button class="button">保存</button></div></form>`,
  );
  $('#cancel').onclick = close;
  $('#edit-form').onsubmit = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const payload = Object.fromEntries(formData);
    payload.visible = formData.has('visible');
    try {
      await api(`/api/admin/${endpoint}${item.id ? `/${item.id}` : ''}`, {
        method: item.id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      close();
      await load();
      say('已保存。');
    } catch (error) {
      say(error.message);
    }
  };
}

function categoryForm(
  item = { name: '', description: '', icon: '◌', color: '#5271ff', visible: 1 },
) {
  form(
    '分类',
    `<div class="two-col"><div class="field"><label>名称</label><input name="name" value="${esc(item.name)}" required></div><div class="field"><label>符号</label><input name="icon" value="${esc(item.icon)}"></div></div><div class="field"><label>说明</label><input name="description" value="${esc(item.description)}"></div><div class="field"><label>颜色</label><input type="color" name="color" value="${esc(item.color)}">`,
    item,
    'categories',
  );
}
function linkForm(
  item = {
    name: '',
    category_id: data.categories[0]?.id,
    url: '',
    description: '',
    aliases: '',
    icon_type: 'initial',
    icon_value: '',
    color: '#5271ff',
    pinned: 0,
    visible: 1,
  },
) {
  const options = data.categories
    .map(
      (category) =>
        `<option value="${category.id}" ${category.id == item.category_id ? 'selected' : ''}>${esc(category.name)}</option>`,
    )
    .join('');
  form(
    '链接',
    `<div class="two-col"><div class="field"><label>名称</label><input name="name" value="${esc(item.name)}" required></div><div class="field"><label>分类</label><select name="category_id">${options}</select></div></div><div class="field"><label>URL</label><input name="url" type="url" value="${esc(item.url)}" required></div><div class="field"><label>说明</label><input name="description" value="${esc(item.description)}"></div><div class="field"><label>搜索别名（以空格或逗号分隔）</label><input name="aliases" value="${esc(item.aliases)}"></div><div class="two-col"><div class="field"><label>图标方式</label><select name="icon_type"><option value="initial">名称首字母</option><option value="url" ${item.icon_type === 'url' ? 'selected' : ''}>图片 URL</option></select></div><div class="field"><label>颜色</label><input type="color" name="color" value="${esc(item.color)}"></div></div><div class="field"><label>图片 URL（可选）</label><input name="icon_value" value="${esc(item.icon_value || '')}"></div><button type="button" class="mini" id="metadata">自动读取网站信息</button><label class="check"><input name="pinned" type="checkbox" ${item.pinned ? 'checked' : ''}>置顶</label>`,
    item,
    'links',
  );
  $('#metadata').onclick = async () => {
    try {
      const metadata = await api('/api/admin/metadata', {
        method: 'POST',
        body: JSON.stringify({ url: $('[name=url]').value }),
      });
      if (!$('[name=name]').value) $('[name=name]').value = metadata.title;
      if (!$('[name=description]').value)
        $('[name=description]').value = metadata.description;
      $('[name=icon_type]').value = 'url';
      $('[name=icon_value]').value = metadata.icon;
      say('已读取网站信息。');
    } catch (error) {
      say(error.message);
    }
  };
}
function engineForm(
  item = {
    name: '',
    query_url: 'https://example.com/search?q={query}',
    icon: '⌕',
    color: '#5271ff',
    visible: 1,
  },
) {
  form(
    '搜索引擎',
    `<div class="two-col"><div class="field"><label>名称</label><input name="name" value="${esc(item.name)}" required></div><div class="field"><label>图标</label><input name="icon" value="${esc(item.icon)}"></div></div><div class="field"><label>URL 模板（必须含 {query}）</label><input name="query_url" value="${esc(item.query_url)}" required></div><div class="field"><label>颜色</label><input type="color" name="color" value="${esc(item.color)}">`,
    item,
    'search-engines',
  );
}

function settingsForm() {
  const settings = data.settings;
  const design = JSON.parse(settings.design_tokens || '{}');
  const token = (label, key, fallback, type = 'text') =>
    `<div class="field"><label>${label}</label><input ${type === 'color' ? 'type="color"' : ''} data-design="${key}" value="${esc(design[key] || fallback)}"></div>`;
  open(
    `<h2>站点与外观</h2><form id="settings-form"><div class="settings-group"><h3>内容</h3><div class="field"><label>站点名称</label><input name="site_title" value="${esc(settings.site_title)}"></div><div class="two-col"><div class="field"><label>首页标题</label><input name="page_title" value="${esc(settings.page_title)}"></div><div class="field"><label>文字图标</label><input name="brand_icon" value="${esc(settings.brand_icon)}"></div></div><div class="field"><label>页脚文案</label><input name="footer_text" value="${esc(settings.footer_text || '')}"></div><div class="field"><label>Logo 图片 URL</label><input name="site_logo" value="${esc(settings.site_logo || '')}"></div></div><div class="settings-group"><h3>布局与行为</h3><div class="two-col"><div class="field"><label>默认排布</label><select name="layout"><option value="standard">标准双列</option><option value="compact">紧凑排布</option><option value="columns">分栏排布</option></select></div><div class="field"><label>默认语言</label><select name="language"><option value="zh-CN">简体中文</option><option value="en">English</option></select></div></div><div class="two-col"><div class="field"><label>默认搜索引擎</label><select name="default_search_engine"><option value="local">本站搜索</option>${data.searchEngines.map((engine) => `<option value="${engine.id}">${esc(engine.name)}</option>`).join('')}</select></div><div class="field"><label>会话天数（1–90）</label><input name="session_days" type="number" min="1" max="90" value="${esc(settings.session_days || 14)}"></div></div></div><div class="settings-group"><h3>视觉令牌</h3><div class="settings-colors">${token('页面背景', 'paper', '#f3f5f9', 'color')}${token('正文文字', 'ink', '#1b2440', 'color')}${token('弱化文字', 'muted', '#798198', 'color')}${token('卡片背景', 'card', '#ffffff', 'color')}${token('描边', 'line', '#dce1eb', 'color')}${token('强调色', 'accent', '#6577e6', 'color')}</div><div class="two-col">${token('内容最大宽度', 'page-width', '1120px')}${token('区块间距', 'section-gap', '44px')}</div></div><div class="modal-actions"><button type="button" class="button ghost" id="cancel">取消</button><button type="submit" class="button" id="save-settings">保存全部设置</button></div></form>`,
  );
  const formElement = $('#settings-form');
  formElement.layout.value = settings.layout || 'standard';
  formElement.language.value = settings.language || 'zh-CN';
  formElement.default_search_engine.value = settings.default_search_engine || 'local';
  $('#cancel').onclick = close;
  formElement.onsubmit = async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(formElement));
    payload.design_tokens = JSON.stringify(
      Object.fromEntries(
        [...formElement.querySelectorAll('[data-design]')].map((input) => [
          input.dataset.design,
          input.value,
        ]),
      ),
    );
    const button = $('#save-settings');
    button.disabled = true;
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      close();
      await load();
      say('站点与视觉设置已保存。');
    } catch (error) {
      button.disabled = false;
      say(error.message);
    }
  };
}

function maintenance() {
  open(
    '<h2>维护工具</h2><p class="hint">导出备份不包含管理员密码与上传文件。</p><div class="modal-actions"><a class="button" href="/api/admin/export">导出 JSON 备份</a><button class="button ghost" id="health">检测全部链接</button><button class="button ghost" id="import">导入 JSON 备份</button><button class="button ghost" id="password">修改密码</button></div><div class="maintenance-update"><span id="update-status" class="hint">正在检查版本状态…</span><div class="modal-actions"><button class="button ghost" id="check-update">检查更新</button><button class="button" id="apply-update" hidden>更新</button></div></div><input id="import-file" type="file" accept="application/json" hidden>',
  );
  $('#health').onclick = async () => {
    try {
      await api('/api/admin/health-check', { method: 'POST', body: '{}' });
      close();
      await load();
      say('检查完成。');
    } catch (error) {
      say(error.message);
    }
  };
  $('#import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = async (event) => {
    try {
      if (!confirm('导入会覆盖当前全部内容，确定继续吗？')) return;
      await api('/api/admin/import', {
        method: 'POST',
        body: await event.target.files[0].text(),
      });
      close();
      await load();
      say('已导入备份。');
    } catch (error) {
      say(error.message);
    }
  };
  $('#password').onclick = passwordForm;

  const updateStatus = $('#update-status');
  const updateButton = $('#apply-update');
  const checkUpdate = async () => {
    updateStatus.textContent = '正在检查版本状态…';
    updateButton.hidden = true;
    try {
      const status = await api('/api/admin/update-status');
      if (!status.enabled) {
        updateStatus.textContent = '当前部署未启用网页更新。';
        return;
      }
      if (!status.clean) {
        updateStatus.textContent = '服务器有本地修改，已禁用自动更新。';
        return;
      }
      if (!status.available) {
        updateStatus.textContent = '当前已是最新版本。';
        return;
      }
      updateStatus.textContent = '发现远端更新，可以立即安装。';
      updateButton.hidden = false;
    } catch (error) {
      updateStatus.textContent = error.message;
    }
  };

  $('#check-update').onclick = checkUpdate;
  updateButton.onclick = async () => {
    if (!confirm('更新会安装新依赖并重启服务，确定继续吗？')) return;
    updateButton.disabled = true;
    updateStatus.textContent = '正在更新，服务即将重启…';
    try {
      const result = await api('/api/admin/update', { method: 'POST', body: '{}' });
      updateStatus.textContent = result.updated
        ? '更新完成，服务正在重启。'
        : '当前已是最新版本。';
    } catch (error) {
      updateButton.disabled = false;
      updateStatus.textContent = error.message;
    }
  };
  checkUpdate();
}
function passwordForm() {
  open(
    '<h2>修改管理员密码</h2><form id="password-form"><div class="field"><label>当前密码</label><input name="current_password" type="password" required></div><div class="field"><label>新密码（至少 10 个字符）</label><input name="new_password" type="password" minlength="10" required></div><button class="button">更新密码</button></form>',
  );
  $('#password-form').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/password', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(event.target))),
      });
      close();
      say('密码已更新。');
    } catch (error) {
      say(error.message);
    }
  };
}

async function load() {
  try {
    const status = await api('/api/admin/session');
    if (!status.authenticated) return login();
    data = await api('/api/admin/data');
    dashboard();
  } catch (error) {
    say(error.message);
    login();
  }
}
$('#logout').onclick = async (event) => {
  const button = event.currentTarget;
  await api('/api/admin/logout', { method: 'POST' });
  button.hidden = true;
  login();
};
load();
