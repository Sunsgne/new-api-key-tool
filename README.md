> 该项目需配合NewAPI才能正常使用：[https://github.com/Calcium-Ion/new-api](https://github.com/Calcium-Ion/new-api)

<div align="center">

<h1 align="center">New API Key Tool</h1>

NewAPI 令牌查询页

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FCalcium-Ion%2Fnew-api-key-tool&env=REACT_APP_SHOW_DETAIL&env=REACT_APP_SHOW_BALANCE&env=REACT_APP_BASE_URL&env=REACT_APP_SHOW_ICONGITHUB&project-name=new-api-key-tool&repository-name=new-api-key-tool)

</div>

![image](img.png)


### 使用方法

#### Vercel 部署
1. 准备好你的 [NewAPI项目](https://github.com/Calcium-Ion/new-api);
2. 点击右侧按钮开始部署：
   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FCalcium-Ion%2Fnew-api-key-tool&env=REACT_APP_SHOW_DETAIL&env=REACT_APP_SHOW_BALANCE&env=REACT_APP_BASE_URL&env=REACT_APP_SHOW_ICONGITHUB&project-name=new-api-key-tool&repository-name=new-api-key-tool)，直接使用 Github 账号登录即可，记得根据自己需求配置环境变量，环境变量如下： 

```   
REACT_APP_SHOW_BALANCE: 是否展示令牌信息，true 或 false
REACT_APP_SHOW_DETAIL: 是否展示调用详情，true 或 false
REACT_APP_BASE_URL: 你的NewAPI项目地址
REACT_APP_SHOW_ICONGITHUB: 是否展示Github图标，true 或 false
```

例如如下配置：
```
# 展示令牌信息
REACT_APP_SHOW_BALANCE=true

# 展示调用详情
REACT_APP_SHOW_DETAIL=true

# NewAPI的BaseURL（支持多个NewAPI站点聚合查询，键值对中的键为站点名称，值为站点的URL）
REACT_APP_BASE_URL={"server1": "https://example.newapi.ai", "server2": "https://example2.newapi.ai"}

# 展示GitHub图标
REACT_APP_SHOW_ICONGITHUB=true
```

3. 部署完毕后，即可开始使用；
4. （可选）[绑定自定义域名](https://vercel.com/docs/concepts/projects/domains/add-a-domain)：Vercel 分配的域名 DNS 在某些区域被污染了，绑定自定义域名即可直连。

#### Docker 部署
1. 克隆项目到本地:
```bash
git clone https://github.com/Calcium-Ion/new-api-key-tool.git
cd new-api-key-tool
```

2. 创建并配置环境变量文件:
```bash
# 复制.env.example文件为.env
cp .env.example .env
# 根据自己需求配置env文件中的环境变量
vim .env
```

3. 构建并运行 Docker 容器:
```bash
# 构建镜像（使用 node:22 + npmmirror 源，nginx 监听 8080）
docker build -t new-api-key-tool .

# 运行容器，将宿主机 8080 端口映射到容器 8080
docker run -d -p 8080:8080 --name new-api-key-tool new-api-key-tool
# 浏览器访问 http://localhost:8080
```

> 镜像构建时会读取项目根目录下的 `.env`（若不存在则自动回退到 `.env.example`，默认指向 `https://ai.xxturbo.com`）。
> 由于 `REACT_APP_*` 变量在 `npm run build` 时被打包进静态文件，修改站点地址后需重新构建镜像。

### 二次开发（仿 https://usage.wenwen-ai.com/ ）

本分支在原版令牌查询页的基础上，参照 [usage.wenwen-ai.com](https://usage.wenwen-ai.com/) 进行了二次开发，新增以下能力：

- **两种查询方式**：
  - **访问令牌（推荐）**：输入 NewAPI 个人设置中的「访问令牌（Access Token）」+「用户 ID」，调用 `/api/log/self` **按时间范围分页拉取全量调用日志**，并通过 `/api/token/` 展示账号下全部令牌的额度信息。
  - **令牌 Key（快速）**：输入一个或多个 `sk-` 令牌，调用 `/api/usage/token/` 与 `/api/log/token`。⚠️ 受 NewAPI 接口限制，该方式**每个令牌最多返回最近 1000 条记录，且服务端不支持按时间过滤**（页面会做客户端过滤并给出提示）。
- **日期范围筛选**：「开始/结束日期」区间选择，并提供 今天 / 昨天 / 本周 / 上周 / 本月 / 上月 快捷选择。
- **两种查询模式**：
  - 按日查询：将调用日志按「日期 + 模型 + 令牌」聚合，展示调用次数、提示/补全 Tokens、花费等汇总信息。
  - 按条查询：展示逐条调用明细（时间、模型、用时、提示/补全、花费、计费详情）。
- **模型筛选** + 「重置筛选」。
- **CSV 导出**：分别支持「令牌信息导出为 CSV 文件」与「调用详情导出为 CSV 文件」。

#### 为什么需要反向代理

NewAPI 中只有 `/api/usage/token/` 与 `/api/log/token` 两个接口开启了 CORS（可跨域），而它们**无法按时间过滤、且最多返回 1000 条**。
真正支持「时间范围 + 分页」的 `/api/log/self`（`GetUserLogs`）**没有开启 CORS**，浏览器跨域无法直接调用。

因此本项目通过**反向代理**把 `/api` 转发到上游 NewAPI 站点，让前端与接口同源，从而可正常调用 `/api/log/self` 拉取时间范围内的全量数据：

- 生产环境：`nginx.conf` 中的 `location /api/ { proxy_pass <上游站点>; }`。
- 开发环境：`src/setupProxy.js`（基于 `http-proxy-middleware`），代理目标取自 `REACT_APP_UPSTREAM`。

> 更换上游站点：开发改 `.env` 的 `REACT_APP_UPSTREAM`；生产改 `nginx.conf` 中的 `proxy_pass` 与 `Host`。

#### 环境变量

复制 `.env.example` 为 `.env`，根据需求配置：

```
# 展示调用详情
REACT_APP_SHOW_DETAIL=true

# 展示令牌信息
REACT_APP_SHOW_BALANCE=true

# 上游 NewAPI 站点地址（反向代理目标，使前端与接口同源）
REACT_APP_UPSTREAM=https://ai.xxturbo.com

# 是否显示 GitHub 图标
REACT_APP_SHOW_ICONGITHUB=false

# 站点标题（可选）
REACT_APP_TITLE=xxTurbo 令牌用量查询

# 计费汇率：$1 = ? tokens（可选，默认 500000）
REACT_APP_QUOTA_PER_UNIT=500000
```

#### 本地运行 Demo

```bash
# 1. 安装依赖
npm install

# 2. 准备环境变量（已内置指向 https://ai.xxturbo.com 的 .env.example）
cp .env.example .env

# 3. 启动开发服务器
npm start
# 浏览器访问 http://localhost:3000

# 或构建生产版本
npm run build
npx serve -s build
```
