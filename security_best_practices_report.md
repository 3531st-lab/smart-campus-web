# 安全最佳实践审计

## 摘要

本次针对原生 JavaScript 前端与 Node.js 服务端进行了定向审计。没有发现动态执行代码或任意来源 CORS。确认一项高风险生产配置：认证签名密钥缺失时会回退到公开固定值。另有若干 `innerHTML` 使用点，需要继续按数据来源逐项验证，不能仅凭 API 名称判定为可利用漏洞。

## 高风险

### SEC-001 生产认证密钥存在公开回退值（已修复）

- 位置：`server/index.js:36`、`server/index.js:44`、`server/index.js:45`。
- 证据：`process.env.AUTH_SECRET || "smart-campus-public-demo-v1"`。
- 影响：如果生产环境漏配 `AUTH_SECRET`，攻击者可以使用公开值伪造登录令牌。
- 修复：已在生产环境启动时强制校验 `AUTH_SECRET`，缺失或少于 32 字符立即失败；未单独配置短信密钥时，使用 HMAC 从认证密钥做用途隔离派生。本地开发仅保留明确标记的开发密钥。
- 缓解：部署平台同时配置独立的长随机密钥，并定期轮换。
- 误报说明：若所有生产环境始终正确配置随机密钥，则当前没有直接暴露，但代码仍会掩盖未来配置错误。

## 中风险

### SEC-002 错误消息直接进入 HTML（已修复）

- 位置：`public/app-v154.js:2972`、`public/app-v154.js:3209`，同步文件 `public/app.js` 对应位置。
- 证据：路由与文件转换错误的 `error.message` 曾直接拼接到 `innerHTML`。
- 影响：若上游错误文本包含攻击者可控 HTML，可能形成 DOM 注入。
- 修复：已在进入 HTML 模板前调用 `escapeHtml(error.message)`；新模块继续优先使用 `textContent`/DOM API。
- 缓解：现有服务端 CSP 禁止内联脚本和外部脚本，能降低利用面。
- 误报说明：未证明线上已有可利用输入链，但危险数据流已消除。

## 已验证基线

- CORS 仅允许本机、同源和显式 `CORS_ORIGINS`。
- CSP 使用 `script-src 'self'`，未启用 `unsafe-eval`。
- 已设置 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 与权限策略。
- 未发现 `eval`、`new Function` 或字符串事件处理器。
