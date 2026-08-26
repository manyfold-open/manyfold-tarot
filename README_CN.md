# 牌面 · Facing the Cards

[English](README.md) · 中文

一个跑在单个 Cloudflare Worker 上的 AI 塔罗站，由**你自己的** Manyfold agent 来解读。
一个问题，三张牌，一次解读。

**[线上站点](https://manyfold-tarot.galichlorian.workers.dev)** ·
[解读是怎么运作的](TAROT.md) ·
[改动时要守住的不变量](AGENTS.md)

```
 1 提问   →   2 接住   →   3 洗牌   →   4 抽牌   →   5 解读   →   6 收尾
 一个输入    先回应问题   牌自己洗完  从整副背面  三张牌作为   分享 ·
 一个按钮    此时还没有   服务端当场  里挑三张    一个牌阵，   再问一件事 ·
             任何牌      锁定三张    逐张翻开    八个段落     继续解读
```

所有权威判断都在服务端：三张牌在任何一张背面出现在屏幕上之前就已被 Worker 封定，浏览器
永远不选牌、不选正逆位，而写解读的 agent 在结构上也没有机会挑选自己要解读的是什么。
[TAROT.md](TAROT.md) 是详细版。

## 一个 Worker，两个面

部署之前先理解这一点，后面所有配置都是从它推出来的：

| 路径 | 给谁用 | 需要密码 |
| --- | --- | --- |
| `/` —— 占卜 | 拿到链接的任何人 | **否** |
| `/s/:token` —— 分享出去的解读快照 | 拿到链接的任何人 | **否** |
| `/settings` —— 运营控制台 | 你自己 | **是** |

占卜本身就是产品。它按设计对所有人开放，靠计量而不是靠锁来保护
（`src/worker/tarot/ratelimit.ts`）—— 总不能在一个访客被允许提问之前，先问他要运营密码。

控制台是另一面：连接 agent、断开、列出、和它聊天。那是你的 Manyfold 账号和你的 agent 预算，
所以它在密码后面，而且**占卜站上没有任何地方链接到它**。你只能自己在地址栏敲 URL 进去。
这是刻意的：一个为了占卜而来的人，不该看见一扇他打不开的门。

## 部署一份属于你自己的

你需要一个 Cloudflare 账号和一个 [Manyfold](https://manyfold.ai) agent。但不必先有 agent ——
站点自带 demo 解读者，在连任何 agent 之前就完全可用，所以可以先把 URL 跑通，再指向你的 agent。

### 1 · 先让它跑起来

<details open>
<summary><b>路径 A —— Deploy 按钮</b>（推荐）</summary>

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/manyfold-open/manyfold-tarot)

Cloudflare 会把这个仓库复制到你的 GitHub 账户下，按 `wrangler.jsonc` 里的声明创建 D1 数据库，
把属于你的 `database_id` 写进你的副本，并把仓库接入 **Workers Builds** —— 之后每次 push 到
`main` 都会自动构建（`npm run build`）并部署（`npx wrangler deploy`）。

> [!IMPORTANT]
> **点 Deploy 之前，先把 "Advanced settings" 展开一次。** 截至 2026 年 8 月，Cloudflare 控制台
> 在该区域折叠时不会初始化其中的隐藏字段（构建 API token、非生产分支部署命令），流程会在创建
> 仓库之后静默卡住且不报任何错。展开后字段会自动填好，部署即可正常完成。这是控制台侧的 bug，
> 本仓库无法修复。

</details>

<details>
<summary><b>路径 B —— 自己 fork 并接入 Workers Builds</b></summary>

```bash
git clone https://github.com/<你>/manyfold-tarot && cd manyfold-tarot
npm install
npx wrangler d1 create manyfold-app-db      # 把返回的 id 填进 wrangler.jsonc
```

`wrangler.jsonc` 里有两个字段属于本部署而不属于你：

- `d1_databases[0].database_id` —— **必须替换**成你刚创建的那个 id。不改的话，你的 Worker
  会去绑定一个不属于你的数据库，然后失败。
- `name` —— Worker 的名字，也就是你的 `*.workers.dev` 子域名。除非你想跟 Cloudflare 争
  `manyfold-tarot` 这个名字，否则请改掉。

然后 **Workers & Pages → Create → Connect to Git**，选择你的 fork，构建命令 `npm run build`，
部署命令 `npx wrangler deploy`，push 到 `main` 即可。

</details>

两条路径都没有迁移步骤。`src/worker/db.ts` 里的 schema 会在第一个请求时自动应用，本地和线上
都一样。

### 2 · 设置控制台密码

> [!IMPORTANT]
> **这一步要最先做 —— 不做的话，你打不开你自己的控制台。**

刚部署好的站点，控制台是**关闭**状态：没有默认密码，所以谁都打不开 —— 撞见这个网址的陌生人
打不开，发布这份代码的人也打不开。代价就是你自己也得先设一个才能进去。

```bash
npx wrangler secret put ADMIN_PASSWORD
```

如果你是用按钮部署的、本地没有代码，那就走控制台：**Workers & Pages → 你的 Worker →
Settings → Variables and Secrets → Add**，名字填 `ADMIN_PASSWORD`，勾上 **Secret**，保存 ——
然后去 **Deployments** 标签页确认新版本已经在承接流量。加变量会生成一个新版本，但不一定会自动
把它切上去。

在你设好之前，`/settings` 会直接把这件事写在页面上，而不是显示一个怎么填都进不去的输入框。

密码可以又短又好记。它只存在于 Cloudflare 的 secret 存储里，谁也读不回来（包括你自己），所以
它不需要"公开在仓库里的密码"才需要的那种长度。忘了就重设一个。

### 3 · 进控制台 —— 靠手动敲 URL

```
https://your-worker.your-subdomain.workers.dev/settings
```

没有任何地方链接到它。`/console` 也仍然可用，照顾那些收藏了模板原始地址的人。页面会要第 2 步
里那个密码，在输对之前它背后什么都不渲染 —— 没有标签栏，没有 agent 列表，Worker 那边也根本
不下发 agent 列表，所以 devtools 里也翻不出东西。密码存在 `sessionStorage`，关掉标签页就忘。

### 4 · 连上你的 agent

在 **Settings → Connect an agent** 里，弹窗会打开 Manyfold 的授权页。把你页面上显示的确认码和
授权页上的那个对一遍 —— 这一步比对是整个流程的防钓鱼校验，别跳过 —— 然后勾选要共享的 agents。

Bearer token 会以 AES-GCM 加密的形式存进你的 D1，永远不会到达浏览器。之后重新授权同一个 agent
会原地轮换它的 token。

### 5 · 确认解读的确实是你的 agent

最近一次连接的 agent 会立刻成为解读者 —— 不用重新部署，也不用配置。直接问站点现在是谁在说话：

```bash
curl https://your-worker.workers.dev/api/tarot/reader
# {"demo":false}   ← 你的 agent 在解读
# {"demo":true}    ← 还是内置的 demo 解读者
```

如果连了多个 agent，用 `TAROT_AGENT_ID` 指定其中一个。想暂时切回 demo 解读者，设
`TAROT_DEMO=1`。然后用一条命令，对着线上部署从头到尾跑一次完整的占卜：

```bash
npm run smoke -- https://your-worker.workers.dev
```

它会提问、洗牌、翻开三张牌、取回解读、生成分享链接，并且顺路检查控制台仍然是锁着的、占卜仍然
是开放的。

## 配置项

| 名称 | 类型 | 设置位置 | 作用 |
| --- | --- | --- | --- |
| `ADMIN_PASSWORD` | secret | Cloudflare | **控制台密码，也是唯一的一个。** 不设置则控制台完全打不开。见第 2 步。 |
| `CONFIG_ENCRYPTION_KEY` | secret | Cloudflare | ≥32 字符。加密 D1 中的设备码与 agent token。不设置则在首次使用时生成随机密钥并存进同一个数据库 —— 见[安全说明](#安全说明)。 |
| `TAROT_AGENT_ID` | var | `wrangler.jsonc` | 指定由哪个已连接的 agent 解读。默认取最近连接的那个。 |
| `TAROT_DEMO` | var | `wrangler.jsonc` | 设为 `1` 时强制使用内置 demo 解读者，即使已连接 agent。 |
| `MANYFOLD_API_BASE_URL` | var | `wrangler.jsonc` | Manyfold API 地址，默认 `https://api.manyfold.ai`。 |
| `ENVIRONMENT` | var | `wrangler.jsonc` | `production` 会强制 https-only，并拒绝私有/回环地址的 agent URL。 |

secret 永远不进仓库。`.dev.vars.example` 里对本地开发列了同一组变量 —— 复制成 `.dev.vars`
即可，该文件已被 git 忽略。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars    # 按需取消注释
npm run dev
```

一条命令跑起全部：Vite 以 HMR 服务 React 应用，Worker 跑在 workerd 里，并自动模拟一个本地 D1。

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（前端 + worker + 本地 D1） |
| `npm run check` | 类型检查、构建、`wrangler deploy --dry-run` |
| `npm test` | 208 个测试，含一次穿过真实 Worker 的完整占卜流程 |
| `npm run deploy` | 手动部署（通常交给 Workers Builds） |
| `npm run smoke -- <url>` | 对线上部署跑一次完整占卜 |

## 结构一览

```
浏览器（React SPA，dist/client）
   │  /api/*（run_worker_first）            其余请求 → 静态资源
   ▼
Hono 应用（src/worker/index.ts）
   │ ensureSchema → Origin 校验 → 管理密码门
   ├─ /api/tarot/*    src/worker/tarot/       公开：占卜、抽牌、分享
   ├─ /api/connect*   src/worker/connect.ts   Manyfold 设备码授权握手
   ├─ /api/agents*    src/worker/connect.ts   列表 / 验证 / 断开
   ▼
D1 —— 没有迁移，schema 在下一个请求时自己应用
Manyfold A2A（message/stream、tasks/get）  ← 每个 agent 独立 token，调用时解密
```

| 文件 | 用途 |
| --- | --- |
| `src/worker/admin.ts` | 谁能进控制台，以及为什么这里没有默认密码 |
| `src/worker/tarot/draw.ts` | 抽牌：CSPRNG、互不重复、服务端、只抽一次 |
| `src/worker/tarot/prompt.ts` | 提示词出、散文回，以及注入加固 |
| `src/worker/tarot/diviner.ts` | 适配层：你的 A2A agent，或内置 demo 解读者 |
| `src/app/tarot/` | 六个状态、牌阵、分享页 |
| `src/app/App.tsx` | 运营控制台 —— 聊天与设置两个标签页 |

这个塔罗站是从 [`manyfold-open/cloudflare-worker-starter`](https://github.com/manyfold-open/cloudflare-worker-starter)
长出来的，模板本身原封不动地还在里面：`/settings` 就是模板原来的控制台。如果你要的是不带塔罗
的模板，请直接去那个仓库拿，而不是从这里往外删东西。

[TAROT.md](TAROT.md) 讲设计决策 —— 牌从哪里来、解读者在结构上做不到哪些事、分享如何把一次解读
冻结成快照。[AGENTS.md](AGENTS.md) 列出改动时必须守住的不变量。

## 安全说明

- **控制台锁着，占卜不锁。** 除 `/api/health`、`/api/state` 和 `/api/tarot/*` 之外的所有路由都
  需要管理密码，通过 header 传输、常量时间比对。对没带密码的调用者，`/api/state` 只回答"需要
  密码"，不会泄露 agent 列表。
- **这里刻意没有默认密码。** 早先的版本随代码提交了一把默认锁（只提交加盐摘要），好让站点一部署
  出来就是锁着的。但在公开仓库里，那是一把只有生成它的人才有钥匙的锁 —— 每一个 fork 都继承了
  作者的后门，却拿不到那份便利。现在没设密码的部署是**关闭**的：对所有人一视同仁地关着，同时
  在页面上告诉运营者该设哪个 secret。整件事就在 `src/worker/admin.ts` 里。
- **凭证永远不经过浏览器。** 设备码是唯一能兑换 agent token 的东西，它加密存放在 D1 中且只能
  兑换一次；浏览器只拿到一个不透明的 `connectId`。agent token 以 AES-GCM 加密存储。
- **自动生成密钥这个取舍值得知道。** 不设 `CONFIG_ENCRYPTION_KEY` 时，加密密钥会在首次使用时
  生成，并存进它所保护的那同一个数据库。这能防住部分暴露（一行日志、一次单表查询），但防不住
  整库导出。设置这个 secret 即可消除该隐患，而一键部署两种情况下都能用。
- **公开路由按 session 和 IP 双重计量。** 所有可能消耗你 agent 额度的路径都有限流，因为这些
  路由必须保持开放。
- agent 的 RPC URL 会被校验（仅 https，生产环境拒绝私有/回环地址）；连通性检查用不计费的
  `tasks/get` 探测而非真实对话；所有错误信息在进入日志或浏览器之前都会剥掉任何形似 token 的
  内容。

## 许可证

[MIT](LICENSE)
