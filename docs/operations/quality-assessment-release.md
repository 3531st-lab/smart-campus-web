# 综测核算发布与运维说明

## 发布范围

本次发布包含综测核算的五模块记录、规则版本快照、班级初审、学院复核、公示申诉、归档锁定、证明材料私有访问和 Excel 导出能力。

- 计分维度：德育、智育、体育、美育、劳育。
- 审核顺序：学生填报 -> 班级管理员初审 -> 学院管理员复核 -> 公示 -> 申诉处理 -> 归档。
- 提交限制：任何加分或扣分项目必须至少关联一份证明材料。
- 数据隔离：普通管理员导出的数据只包含其学校和学院范围；模板和演示文件不包含真实姓名、学号、手机号或材料。

## 首次发布或升级数据库

1. 在部署环境配置 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE` 和可选的 `MYSQL_SSL=true`。
2. 在项目根目录运行：

   ```bash
   npm run db:init
   ```

3. 命令会创建缺失表，并通过 `information_schema` 检查后逐项补充旧库缺少的列和索引。重复运行安全，不会删除学生、课表、预约、群聊或综测记录。
4. 确认输出包含 `Database ... is ready` 与 `Business stores are ready` 后，再部署应用。

该脚本同时兼容 TiDB Cloud 与 MySQL：不依赖 TiDB 不支持的 `ADD COLUMN IF NOT EXISTS` 语法。脚本只读取本机或部署平台注入的环境变量，绝不打印数据库密码。

## 上线前检查

```bash
npm run check
npm run db:init
```

完成后检查：

- 站点根路径 `GET /` 返回 200。
- 登录后的管理员可访问 `GET /api/admin/health`。
- 已登录用户可读取 `GET /api/quality/periods`。
- 管理员可下载 `GET /api/admin/quality/template`，并验证模板只有表头和说明，不含真实身份信息。
- 正常账号可访问 `GET /api/admin/quality/export`，导出范围与其学院权限一致。

未登录访问业务 API 返回 401 属于预期安全行为，不应当作为服务故障处理。

## Cloudflare Pages 与 Vercel 发布

本项目由 Cloudflare Pages 承载前端和 `/api/*` 代理，Vercel 运行 Node 服务端。Pages 环境变量需要配置：

- `API_ORIGIN=https://smart-campus-web-six.vercel.app`
- 可选：`API_PROXY_TIMEOUT_MS=20000`
- 如 Vercel 项目开启部署保护，再配置 `VERCEL_PROTECTION_BYPASS` 为对应保护绕过令牌。

推荐发布顺序：

```bash
git push origin main
npx wrangler pages deploy public --project-name zhihueixiaoyuan --branch main
```

Cloudflare Pages 会自动识别 `functions/api/[[path]].js` 并将 `/api/*` 转发至 `API_ORIGIN`。发布后至少验证首页、登录页、综测核算页、证明材料下载和 Excel 导出。

## 回滚

若本次综测工作流发布出现异常，优先采用可审计的回滚方式：

```bash
git revert 372862c
git push origin main
npx wrangler pages deploy public --project-name zhihueixiaoyuan --branch main
```

不要使用 `git reset --hard`。数据库迁移只做新增列、索引和表结构兼容，不会删除业务记录；代码回滚后保留的数据可以用于后续修复和审计。

## 日常巡检

- 每次规则调整须创建新规则版本，不覆盖已归档周期的规则快照。
- 每周检查逾期未处理的班级初审、学院复核和申诉事项。
- 定期检查对象存储中证明材料的访问控制，证明材料不得设置为公开桶。
- 发现导出范围异常、材料泄露或审核越权时，立即暂停相关账号权限并保留审计日志。
