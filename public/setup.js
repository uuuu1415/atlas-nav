const form = document.querySelector('#setup-form');
const provider = document.querySelector('#provider');
const sqliteFields = document.querySelector('#sqlite-fields');
const relationalFields = document.querySelector('#relational-fields');
const mongodbFields = document.querySelector('#mongodb-fields');
const errorNote = document.querySelector('#setup-error');
const port = document.querySelector('#port');

function updateFields() {
  const selected = provider.value;
  sqliteFields.hidden = selected !== 'sqlite';
  relationalFields.hidden = !['postgresql', 'mysql'].includes(selected);
  mongodbFields.hidden = selected !== 'mongodb';
  port.value = selected === 'postgresql' ? 5432 : 3306;
}

provider.addEventListener('change', updateFields);
updateFields();
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorNote.hidden = true;
  const values = Object.fromEntries(new FormData(form));
  const payload = {
    ...values,
    database: values.database || values.mongoDatabase,
    adminUsername: values.adminUsername,
    adminPassword: values.adminPassword,
  };
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  button.textContent = '正在连接数据库…';
  try {
    const response = await fetch('/api/setup/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || '数据库配置失败。');
    window.location.href = '/';
  } catch (error) {
    errorNote.textContent = error.message;
    errorNote.hidden = false;
    button.disabled = false;
    button.textContent = '连接并完成初始化';
  }
});
