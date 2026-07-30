#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${ATLAS_REPO_URL:-https://github.com/uuuu1415/atlas-nav.git}"
APP_DIR="${ATLAS_APP_DIR:-/opt/atlas-nav}"
APP_USER="${ATLAS_USER:-atlasnav}"
APP_PORT="${ATLAS_PORT:-3000}"
SERVICE_NAME="atlas-nav"

log() { printf '[atlas-nav] %s\n' "$*"; }
fail() { printf '[atlas-nav] ERROR: %s\n' "$*" >&2; exit 1; }

[[ "${EUID}" -eq 0 ]] || fail '请使用 sudo 或 root 运行此脚本。'
[[ -r /etc/os-release ]] || fail '无法识别操作系统。'
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == 'ubuntu' || "${ID:-}" == 'debian' || "${ID_LIKE:-}" == *debian* ]] || fail '此脚本只支持 Ubuntu/Debian。'

if [[ -t 0 ]]; then
  TTY=/dev/tty
else
  [[ -r /dev/tty ]] || fail '需要交互终端输入管理员密码，请直接在服务器终端运行。'
  TTY=/dev/tty
fi

if [[ -z "${ATLAS_APP_DIR+x}" ]]; then
  read -r -p "安装位置 [${APP_DIR}]: " requested_app_dir <"${TTY}"
  APP_DIR="${requested_app_dir:-${APP_DIR}}"
fi
[[ "${APP_DIR}" == /* ]] || fail '安装位置必须是绝对路径，例如 /opt/atlas-nav。'

if [[ -z "${ATLAS_PORT+x}" ]]; then
  read -r -p "服务端口 [${APP_PORT}]: " requested_port <"${TTY}"
  APP_PORT="${requested_port:-${APP_PORT}}"
fi
[[ "${APP_PORT}" =~ ^[0-9]+$ ]] || fail '服务端口必须是 1 到 65535 之间的数字。'
(( APP_PORT >= 1 && APP_PORT <= 65535 )) || fail '服务端口必须是 1 到 65535 之间的数字。'
if command -v ss >/dev/null 2>&1 && ss -ltn "sport = :${APP_PORT}" | tail -n +2 | grep -q .; then
  fail "服务端口 ${APP_PORT} 已被占用，请选择其他端口。"
fi

export DEBIAN_FRONTEND=noninteractive
log '安装系统依赖。'
apt-get update
apt-get install -y curl git ca-certificates build-essential openssl

if ! command -v node >/dev/null 2>&1 || ! node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major >= 22 && (major > 22 || minor >= 5) ? 0 : 1)"; then
  log '安装 Node.js 24。'
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

command -v node >/dev/null 2>&1 || fail 'Node.js 安装失败。'
node -e "const [major, minor] = process.versions.node.split('.').map(Number); if (!(major >= 22 && (major > 22 || minor >= 5))) process.exit(1)" || fail 'Node.js 版本低于 22.5。'
command -v npm >/dev/null 2>&1 || fail 'npm 不可用。'

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  log "创建系统用户 ${APP_USER}。"
  useradd --system --home-dir "${APP_DIR}" --no-create-home --shell /usr/sbin/nologin "${APP_USER}"
fi

if [[ -e "${APP_DIR}/.git" ]]; then
  log '发现已有 Git 工作区，执行 fast-forward 更新。'
  git -C "${APP_DIR}" pull --ff-only
elif [[ -e "${APP_DIR}" && -n "$(find "${APP_DIR}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
  fail "${APP_DIR} 已存在且不是空目录，未覆盖任何文件。"
else
  log "克隆 ${REPO_URL}。"
  mkdir -p "${APP_DIR}"
  git clone --filter=blob:none --sparse --branch main --single-branch "${REPO_URL}" "${APP_DIR}"
fi

# The server does not need screenshots, tests, or repository documentation.
# Keep the deployment checkout small while retaining the Git remote for updates.
git -C "${APP_DIR}" sparse-checkout set --no-cone \
  /server.js \
  /package.json \
  /package-lock.json \
  /.env.example \
  /lib/ \
  /public/ \
  /deploy/

install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}/data" "${APP_DIR}/storage"

if [[ ! -f "${APP_DIR}/.env" ]]; then
  log '创建生产环境配置。'
  admin_username="${ATLAS_ADMIN_USERNAME:-}"
  admin_password="${ATLAS_ADMIN_PASSWORD:-}"
  if [[ -z "${admin_username}" ]]; then
    read -r -p '后台管理员用户名 [admin]: ' admin_username <"${TTY}"
    admin_username="${admin_username:-admin}"
  fi
  if [[ -z "${admin_password}" ]]; then
    read -r -s -p '后台管理员密码 [123456]: ' admin_password <"${TTY}"
    printf '\n' >"${TTY}"
    admin_password="${admin_password:-123456}"
  fi
  if [[ "${#admin_password}" -lt 10 ]]; then
    printf '警告：当前密码少于 10 个字符，仅适合首次初始化，请登录后台后立即修改。\n' >"${TTY}"
  fi
  session_secret="$(node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))")"
  umask 077
  printf '%s\n' \
    'NODE_ENV=production' \
    "PORT=${APP_PORT}" \
    'DB_PROVIDER=sqlite' \
    'SQLITE_PATH=./data/atlas-nav.db' \
    "ADMIN_USERNAME=${admin_username}" \
    "ADMIN_PASSWORD=${admin_password}" \
    "SESSION_SECRET=${session_secret}" >"${APP_DIR}/.env"
  unset admin_password session_secret
else
  log '保留已有 .env，不覆盖现有生产配置。'
fi

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
chmod 600 "${APP_DIR}/.env"

log '安装 Node.js 依赖。'
runuser -u "${APP_USER}" -- env HOME="${APP_DIR}" npm --prefix "${APP_DIR}" ci --omit=dev

log '写入 systemd 服务。'
cat >"/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Atlas Nav
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
EnvironmentFile=${APP_DIR}/.env
ExecStart=$(command -v npm) start
Restart=always
RestartSec=5
UMask=027

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"
sleep 2
systemctl is-active --quiet "${SERVICE_NAME}" || { systemctl status "${SERVICE_NAME}" --no-pager; fail 'Atlas Nav 服务启动失败。'; }

port="$(sed -n 's/^PORT=//p' "${APP_DIR}/.env" | head -n 1)"
port="${port:-3000}"
curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${port}/" >/dev/null || { journalctl -u "${SERVICE_NAME}" -n 40 --no-pager; fail '健康检查失败。'; }

log '部署完成。'
printf '首页: http://服务器IP:%s/\n' "${port}"
printf '后台: http://服务器IP:%s/admin\n' "${port}"
printf '状态: sudo systemctl status %s --no-pager\n' "${SERVICE_NAME}"
printf '日志: sudo journalctl -u %s -f\n' "${SERVICE_NAME}"
