# 智慧校园网页版

这是根据安卓 App 功能说明书搭建的网页版初始框架。考虑到现有 App 使用 Java 和 Python，当前默认采用 **Python 后端 + Web 前端**：

- Web 单页应用：首页、实验室预约、申请进度、维修申报、通知、实验室守则、课表、食堂外卖、校外人员认证、我的。
- Python REST API 骨架：为后续安卓 Java App 与网页互通互联预留统一接口。
- 模拟数据层：便于先跑通页面与接口，后续可替换为数据库和真实 App 后端。

## 本地运行

```bash
python server_py/app.py
```

默认地址：

```text
http://localhost:5173
```

测试账号：

```text
手机号：13800000000
验证码：123456
```

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
