# 智慧校园网页版

这是智慧校园网页与 REST API 服务。

- Web 单页应用：首页、实验室预约、申请进度、维修申报、通知、实验室守则、课表、食堂外卖、校外人员认证、我的。
- Python REST API 骨架：为后续安卓 Java App 与网页互通互联预留统一接口。
- 模拟数据层：便于先跑通页面与接口，后续可替换为数据库和真实 App 后端。

## 本地运行

```bash
npm run dev
```

默认地址：

```text
http://localhost:5173
```

本地开发身份：

```text
学校：泰州学院
专业：数字经济
学号与手机号：配置在本地 `.env` 或 Vercel 环境变量中
```

点击“获取验证码”后，本地开发环境会在页面中显示动态验证码。

## 短信登录配置

生产环境请参考 `.env.example` 配置服务端密钥，并将 `SMS_PROVIDER` 改为 `aliyun`。随后填写阿里云短信的 AccessKey、审核通过的短信签名和模板编号。模板变量使用 `${code}`。

也可以将 `SMS_PROVIDER` 改为 `webhook`，此时短信网关会收到包含 `phone`、`code`、`templateId`、`expiresInMinutes` 和 `scene` 的 JSON 请求。

短信发送费用通常由平台短信账户承担，接收方通常免费，具体以运营商规则为准。

## 游客模式

登录页提供游客模式，用于免验证查看主要页面。游客身份只读，提交预约、订单和反馈等写入操作会被服务端拒绝。

## MySQL 学生身份库

1. 在 MySQL 中执行 `server/schema.sql`。
2. 创建专用数据库账户，并在 `.env` 中填写 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_PASSWORD` 和 `MYSQL_DATABASE`。
3. 使用管理员账号登录后，进入“学生身份库”页面进行单个录入或 Excel 批量导入。

Excel 首行支持：`姓名、学校、学院、专业、学号、手机号、状态、角色`。角色可填学生、老师或管理员。学校与学号重复时会更新原记录，停用账号无法获取登录验证码。

总管理员可以管理全部账号，并将学生或老师设为普通管理员或总管理员；普通管理员只能管理学生和老师。学生、老师和游客无法查看或访问学生身份库。当前登录的总管理员不能降级自己。

## 目录结构

```text
public/             Web 前端静态资源
server_py/          Python REST API 与静态文件服务
server/             Node 版原型服务，后续可删除或作为参考
docs/               接口契约与后续开发路线
```

## 后续接入安卓 App

安卓 App 与网页建议共用 `server_py/app.py` 暴露的 `/api/*` 接口，并使用同一套用户身份、预约、订单、通知数据。

- 接口草案见 [docs/api-contract.md](docs/api-contract.md)。
- 安卓 Java 调用示例见 [docs/android-java-client.md](docs/android-java-client.md)。

## Campus chat performance

- Group startup requests the latest message page by cursor and never uses SQL offset pagination.
- The browser keeps at most 220 active chat messages and renders at most 160 rows at once, while the database retains the complete audit history.
- Realtime chat remains optional: when `CHAT_REALTIME_URL` is unavailable, the client falls back to visibility-aware polling.
