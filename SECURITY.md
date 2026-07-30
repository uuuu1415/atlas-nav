# Security Policy

## Reporting a vulnerability

请不要在公开 Issue 中披露安全漏洞，特别是管理员认证、会话、外部 URL 抓取、文件上传、导入导出和数据库相关问题。

在项目发布后，请通过仓库维护者配置的私密联系方式报告，并提供复现步骤、受影响版本、影响说明和（如有）修复建议。维护者会确认收到报告，评估影响，并在修复后协调披露。

## Deployment notes

生产环境必须使用 HTTPS，并设置 `NODE_ENV=production`、高强度 `ADMIN_PASSWORD` 和随机 `SESSION_SECRET`。不要把 `.env`、SQLite 数据库、上传目录或 JSON 备份提交到 Git。外部元数据抓取与链接检查会拒绝常见内网地址，但仍建议仅向受信任管理员开放后台。
