# Atlas Nav：AI 测试、发布与 Linux 部署提示词

将下面整段提示词完整交给负责测试和发布的 AI。方括号内的内容由操作者按实际情况替换；不要把真实密码、`SESSION_SECRET`、`.env`、SQLite 数据库或 `storage/` 上传文件提交到 GitHub。

---

```text
你是资深全栈 QA、Node.js 发布工程师和安全审查者。请在当前 Atlas Nav 项目目录中完成一次“临时本地测试 → 修复发现的问题 → GitHub 公开发布 → Linux 从 GitHub 部署说明”的完整流程。不要跳过验证，不要声称测试成功而没有实际检查。

项目目标：Atlas Nav 是一个本地优先的个人导航站。技术栈为 Node.js 22.5+、Express、Node 内置 node:sqlite、SQLite。公开首页为 /，管理后台为 /admin。默认端口 3000。数据库和上传资源是私有数据，必须不进入 Git。

一、测试前规则

1. 先阅读 package.json、README.md、ARCHITECTURE.md、server.js、lib/sqlite.js、public/index.html、public/admin.html、public/js/、public/admin.js、public/styles.css、.gitignore 和 .env.example。
2. 不要把 .env、data/、storage/、node_modules/、日志、浏览器缓存或任何真实备份文件提交到 Git。
3. 不要删除用户已有的 .env、data/ 或 storage/。测试要使用隔离的临时目录或安全副本；若无法隔离，先导出或复制现有数据并明确告知用户。
4. 不要改弱管理员认证、会话 cookie、登录限流、外部 URL 的 DNS 私网校验或重定向复检。发现问题应修复或报告，而不是绕过。
5. 所有临时 Windows CMD/PowerShell/Bash 测试脚本必须在测试成功或失败后的 finally/cleanup 阶段删除自身，并清理临时测试文件。不要遗留测试启动脚本。
6. Node 的 node:sqlite 可能打印 ExperimentalWarning；这不是测试失败。真正的失败包括启动崩溃、未处理异常、HTTP 500、浏览器 Console 红色错误、数据丢失、认证绕过或预期功能不工作。

二、创建并运行临时本地测试程序

在项目根目录创建一个唯一命名的临时脚本，例如 _atlas_verify_temp.cmd（Windows）或 _atlas_verify_temp.sh（Linux）。脚本需做到：

- 检查 Node.js 版本是否 >= 22.5；若不满足，打印清楚错误并清理自身。
- 检查 npm 可用；首次运行仅在 node_modules 不存在时执行 npm install 或 npm ci。
- 绝不覆盖已有 .env。若 .env 不存在，从 .env.example 复制一份，并为测试设置临时强密码和随机 SESSION_SECRET；结束时仅删除脚本自己创建的临时 .env。
- 在启动前检测 3000 端口：如果被项目自身实例占用，优先复用它或提示操作者；不要强制杀死不明进程。必要时使用临时端口，例如 3100。
- 启动服务，捕获 stdout/stderr 到临时日志文件，等待健康可访问状态；超时应打印日志尾部。
- 通过 HTTP 检查首页、/api/nav、/admin 和未登录 /api/admin/data 的响应。停止服务，删除临时日志与临时脚本，并恢复环境。
- Windows CMD 脚本用 setlocal，并在任何 exit 前调用 :cleanup；最后使用 del "%~f0" 自删除。不能依赖用户手动删除。

三、功能测试清单

执行测试时，记录每一项的结果：通过、失败或因环境限制未验证；对失败项给出复现步骤、根因和修复。

A. 启动与基础
- npm install/npm ci 成功；node --check 检查 server.js、public/admin.js、public/js/shared.js、public/js/home.js。
- 服务启动后首页 / 返回 200，/api/nav 返回合法 JSON 且具有 settings、categories、pinned、searchEngines。
- /admin 返回 200；未登录请求 /api/admin/data 返回 401。
- 浏览器强制刷新后 Console 无红色错误；没有缺失静态资源 404，favicon、manifest、Service Worker 正常。

B. 管理员与安全
- 用 .env 中管理员账号密码能登录；错误密码返回 401。
- 连续五次错误密码后，第六次应限流；等待或使用隔离数据避免污染用户真实环境。
- 登出后管理 API 再次返回 401。
- 修改密码后，旧密码不可用，新密码可用。
- Cookie 必须是 HttpOnly，生产条件下 Secure；不要泄露密码哈希、SESSION_SECRET 或数据库内容到日志。

C. 内容管理
- 分类可创建、编辑、隐藏、删除和拖拽排序；分类删除对链接的行为符合现有设计。
- 链接可创建、编辑、隐藏、置顶、换分类、删除与排序；URL 只能接受 http/https。
- 链接别名能参与本站搜索；搜索无结果时页面保持稳定。
- 搜索引擎可创建、编辑、隐藏、删除、排序；URL 模板必须包含 {query}，选中后 Enter 会构造正确外部搜索 URL。
- 后台站点设置可保存：标题、页脚文案、Logo URL、默认布局、默认语言、默认搜索引擎、会话天数和视觉令牌。保存按钮必须给出成功/失败反馈。
- 视觉令牌只接受允许的颜色与尺寸；尝试非法值不应导致任意 CSS 注入或页面崩溃。

D. 首页体验
- 三种布局（standard、compact、columns）可切换且刷新后保留本机选择。
- 深浅主题、中文/English 切换正常；文本不得导致 body 或页面 DOM 被替换/清空。
- 分类导航锚点、置顶入口、最近访问链接、站内搜索、键盘 / 聚焦和 Enter 打开第一个结果正常。
- Logo URL 加载失败时首页仍可正常显示文字品牌。
- 手机宽度和桌面宽度下均不应横向溢出或出现不可操作按钮。

E. 维护功能
- 导出 JSON 备份后，验证格式不含管理员密码。
- 使用临时数据验证导入能恢复分类、链接、搜索引擎和设置；导入无效 JSON、危险 URL 或缺失字段应被拒绝，且不会半写入数据。
- 自动读取网站元数据只测试公开安全 URL；localhost、127.0.0.1、私有 IP、.local 域名和会重定向到私网的 URL 必须被拒绝。
- 健康检查在单个网站失败、超时和 HTTP 非 2xx 时不应让服务退出或使连接被重置；后台显示可理解状态。
- PWA/service worker：首次联网后缓存静态资源和 /api/nav；临时断网时仍能显示最近一次成功的导航数据。旧 service worker 缓存更新后不得引发 Response body is already used 或 stale script 错误。

四、代码质量审查

- 不允许恢复压缩的一行式大型前端脚本；公共首页应保持 public/js/shared.js 与 public/js/home.js 的模块分工。
- 检查函数命名、错误处理、重复逻辑、输入校验和注释。为安全边界、数据库迁移、不直观逻辑补充简短注释，不写无意义注释。
- 确认 README 对数据库能力的描述准确：当前真正可运行的是 SQLite；PostgreSQL/MySQL/MongoDB 仅为后续适配边界，不能宣传为已可直接切换。
- 修复低风险、明确的缺陷；对于会改变产品行为或数据结构的改动，先在报告中说明并请求确认。

五、GitHub 公开发布

在全部关键测试通过后才执行发布。若存在失败，先修复并回归测试；若无法修复，停止发布并说明原因。

1. 确保根目录具备 LICENSE（MIT）、README.md、CONTRIBUTING.md、SECURITY.md、ARCHITECTURE.md、.gitignore、.github/workflows/verify.yml。
2. 用户提供的截图应保存为 docs/screenshots/home.png 和 docs/screenshots/admin.png。若截图文件不在项目中，不要伪造图片；保留 README 路径并向用户索取文件或提示其手动放入。
3. 确认 git status 不包含 .env、data/、storage/、node_modules/、日志、临时脚本、临时数据库或测试输出。
4. 初始化 Git（如尚未初始化），默认分支使用 main。设置明确的首次提交信息，例如 feat: initial Atlas Nav release。
5. 检查 GitHub CLI 是否登录：gh auth status。若未登录，执行 gh auth login --web --git-protocol https 并等待用户完成授权。
6. 创建公开仓库，名称优先 atlas-nav；若名称已被当前账户占用，询问用户或使用用户提供的新名称。执行 gh repo create <repo-name> --public --source=. --remote=origin --push。
7. 推送后验证：git remote -v、git branch -vv、gh repo view --json nameWithOwner,url,visibility,defaultBranchRef；确认 main 已推送、仓库公开且工作流文件存在。
8. 输出仓库 URL、提交 SHA、测试摘要、未验证项和部署说明。不要自动创建 Release 或 tag，除非用户明确要求。

六、Linux 服务器从 GitHub 安装与运行

发布成功后，写入 README 或单独给出以下可执行部署说明。假设服务器为 Ubuntu/Debian、用户有 sudo 权限、仓库 URL 为 https://github.com/<OWNER>/<REPO>.git。不要使用 Docker。

安装系统依赖：

sudo apt update
sudo apt install -y curl git ca-certificates build-essential
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version

下载与配置：

sudo mkdir -p /opt/atlas-nav
sudo chown $USER:$USER /opt/atlas-nav
git clone https://github.com/<OWNER>/<REPO>.git /opt/atlas-nav
cd /opt/atlas-nav
cp .env.example .env
nano .env

在 .env 中至少设置：

NODE_ENV=production
PORT=3000
DB_PROVIDER=sqlite
SQLITE_PATH=./data/atlas-nav.db
ADMIN_USERNAME=你的管理员用户名
ADMIN_PASSWORD=强随机密码
SESSION_SECRET=长随机字符串

安装并运行：

npm ci
npm start

验证 http://服务器IP:3000 可以访问后，使用 systemd 守护：

sudo tee /etc/systemd/system/atlas-nav.service >/dev/null <<'EOF'
[Unit]
Description=Atlas Nav
After=network.target

[Service]
Type=simple
User=<LINUX_USER>
WorkingDirectory=/opt/atlas-nav
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now atlas-nav
sudo systemctl status atlas-nav --no-pager

使用 Nginx 反向代理与 HTTPS。先安装：

sudo apt install -y nginx certbot python3-certbot-nginx

为域名创建 /etc/nginx/sites-available/atlas-nav：

server {
    listen 80;
    server_name <YOUR_DOMAIN>;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

启用并签发证书：

sudo ln -s /etc/nginx/sites-available/atlas-nav /etc/nginx/sites-enabled/atlas-nav
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d <YOUR_DOMAIN>

更新流程：

cd /opt/atlas-nav
git pull --ff-only
npm ci
sudo systemctl restart atlas-nav

备份流程：停止服务前或低访问时，备份 data/ 和 storage/：

sudo systemctl stop atlas-nav
tar -czf atlas-nav-backup-$(date +%F).tar.gz /opt/atlas-nav/data /opt/atlas-nav/storage /opt/atlas-nav/.env
sudo systemctl start atlas-nav

最终报告使用简洁中文，包含：测试结果表、修复项、GitHub 仓库 URL、提交 SHA、Linux 部署命令、备份提醒，以及任何未完成风险。不要输出密码、密钥或 .env 内容。
```

---

## 使用建议

让其他 AI 在项目目录中执行这段提示前，先确保它拥有文件读写、终端和 GitHub CLI 权限。发布部分需要你在浏览器完成 GitHub 授权。截图需要你手动放入 `docs/screenshots/home.png` 和 `docs/screenshots/admin.png`；两张图正好对应 README 的首页和后台预览位。
