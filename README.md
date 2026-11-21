# BRAWL // LIVE — 2026 荒野乱斗全球总决赛

这是一个可运行的中文赛事看板，包含 **14 场双败淘汰赛**、小组赛结果、赛程表、晋级与淘汰判定、北京时间、移动端布局及管理员实时改分。

> **数据模式：** 启用 `FEED_PROVIDER=supercell` 后，服务器每 2 分钟读取 Supercell 官方赛事网页使用的公开 JSON，对本届总决赛 14 场淘汰赛自动同步盘比分。页面标注来源、最近核查时间、可能延迟数分钟及异常状态，不把抓取时间冒充比分更新时间。未配置时仍使用截至 2026-11-21 05:00 UTC 的历史快照；直接双击 HTML 也是快照预览。

## 官方赛事自动同步

已有 Render 服务：合并本次改动后，进入服务的 **Environment**，添加 `FEED_PROVIDER=supercell`、`FEED_INTERVAL_MS=120000`，移除旧的 `FEED_URL`、`FEED_TOKEN`，然后 **Save, rebuild, and deploy**。构建命令保持 `npm install`，启动命令保持 `npm start`，健康检查为 `/health`。`render.yaml` 已为新建 Blueprint 配好这两个变量；普通 Git 自动部署不会自动替已有服务添加环境变量。

Windows 本地运行：

```powershell
$env:FEED_PROVIDER="supercell"
$env:FEED_INTERVAL_MS="120000"
npm start
```

官方源无需 API Key；不要同时设置 `FEED_URL`。这是官方网页实际使用的公开请求，不是附有第三方服务保证的正式开发者 API；应持续遵守源站条款与访问要求，未公布数字配额，不能保证秒级更新。2 分钟是本项目的保守轮询间隔，不是源站承诺的额度。遇到 429/503 会遵守 `Retry-After` 并暂停请求。

- `https://event.supercell.com/brawlstars/v1/bracket`：盘比分、完赛标记及晋级关系。
- `https://event.supercell.com/brawlstars/v1/state`：当前赛事、场次与直播阶段。
- 固定本届 `eventId=6Yk1HZc0AIJdknCBGQZEI4`，赛事切换、维护、旧缓存、队伍/赛制不符时停止覆盖数据并显示异常。
- 官方编号 11—24 对应本网站 14 场淘汰赛；15—24 的双方顺序需反转，适配器同时核对晋级关系与队伍 ID。
- 未开赛的 0:0 不标进行中，总决赛预先领先 1 盘也不用于推断开赛；只有确认完赛才计算晋级。小组赛仍展示原有已核对快照。
- `/api/state` 的 `feedLastOk` 是成功核查时间，`feedChangedAt` 是本进程观察到后续赛况变化的时间；首次读取为 `null`。官方没有提供比分更新时间，`sourceUpdatedAt`、`updatedAt` 均为 `null`，不能拿响应头时间代替。
- 请求失败保留最后有效比分；超过最近成功核查的 6 分钟（默认轮询间隔的 3 倍）视为核查超时。页面会提示缓存可能过时，旧的进行中状态标为“上次进行中”。
- 官方模式关闭管理员改分，防止两种来源混写。要人工维护，设置 `FEED_PROVIDER=snapshot` 并重新部署。

上线验收：检查 `/health` 的 `feedProvider` 为 `supercell`、`feedLastOk` 非空、`feedError` 为 `null`、`feedStale` 为 `false`；再检查 `/api/state` 有 14 场比赛、队伍比分方向正确，页面显示官方来源和最近核查。`/health` 的 `ok=true` 只代表服务器能响应。

Render 免费服务无入站访问时可能休眠。官方直播间歇时，仍按本届赛事 ID 读取对阵和已确认赛果。GitHub Actions 在本届淘汰赛及赛后一天每约 5 分钟检查官方结果，比分有变化才写入 `official-results` 分支，也可从 Actions 手动运行。该分支保留完赛比赛，服务启动及后续刷新时会读取它。官方接口不可用时，页面显示已保存的赛果并标明状态；仓库归档暂不可用时仍可读取随版本内置的 `data/supercell-checkpoint.json`。归档和实时核查各有更新时间，归档可能因 GitHub 排程或源站缓存而延迟。

## 一、立即查看网页

顶部菜单切换对阵图、英雄数据、赛程和小组赛。对阵图下方的战队投票使用 `VOTE_DATABASE_URL` 连接 PostgreSQL，并为每个浏览器保留一张可改投或取消的匿名票。投票服务未配置时显示未开放状态。

「英雄数据」可按本届六种比赛模式查看出场率与盘胜率。出场率分母是所选模式中阵容完整的已完赛盘数，盘胜率分母是该英雄的队伍出场次数。双方都选同一英雄时，出场率计一盘，胜率计一胜一负。同队重复选人或阵容缺项的记录待修正后纳入。官方模式下，网站每 2 分钟通过 [Liquipedia MediaWiki API](https://liquipedia.net/api-terms-of-use) 核查。同步失败时保留最近可用统计，启动时可显示随版本发布的已核对快照。[统计数据](data/brawler-picks.json) 改编自 [Liquipedia 赛事资料](https://liquipedia.net/brawlstars/Brawl_Stars_World_Finals/2026)，采用 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)。

英雄英文名与编号来自 [BrawlAPI](https://brawlapi.com/)，简体中文名对照 [Brawlify 英雄列表](https://brawlify.com/zh-cn/brawlers)。头像素材由 [Brawlify CDN](https://github.com/Brawlify/CDN) 提供，版权归 Supercell，遵循 [Supercell 粉丝内容政策](https://supercell.com/en/fan-content-policy/)。

「战队」收录本届全球总决赛 12 支战队的参赛选手、教练和分析师。参赛名单对照 [Supercell 赛事公告](https://supercell.com/brawlstars/en/blog/esports/your-guide-to-the-biggest-brawl-stars-world-finals-ever-/)，人员资料改编自 [Liquipedia 赛事阵容](https://liquipedia.net/brawlstars/Brawl_Stars_World_Finals/2026#Participants)，采用 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)。队徽素材来自 [DraftMeta 总决赛参与队伍](https://draftmeta.com/games/brawl-stars/pros/world-finals-2026/event)，队徽权利归各自战队。

点击战队内的选手可展开履历和代表性成绩。年龄按 2026 年 11 月 20 日开赛当天计算，缺失的年龄显示「年龄未公开」。[选手资料](data/player-profiles.json) 改编自 [Liquipedia 总决赛参赛资料](https://liquipedia.net/brawlstars/Brawl_Stars_World_Finals/2026/Additional_Data_and_Statistics) 和各选手档案，采用 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)。

「选手表现」按本届已收录的系列赛 MVP 次数排序，可筛选战队。MVP 和英雄阵容共用一次 Liquipedia 核查，完赛比分提供战队系列赛胜负。公开阵容按战队记录选用英雄，个人常用英雄通过 [Brawlytics 赛季资料](https://brawlytics.pro/worlds#teams) 查看。

「逐局明细」使用 [Leafstats 的公开嵌入](https://www.leafstats.net/officials/?t=294550838753) 打开本届指定比赛，按 Set（地图）与 Game（小局）查看个人英雄、击杀、死亡、伤害与治疗。来源未收录的数据以其页面显示为准。

直接双击 `public/index.html` 可以查看静态快照和可交互双败淘汰赛对阵。浏览器无法连接本地 API 时会显示「离线预览」。

### 启动具有更新能力的服务器

确保安装 Node.js **20 或以上**，在项目文件夹中执行：

```bash
npm start
```

然后打开 `http://localhost:3000`。

- 浏览器每 **15 秒**向 `/api/state` 请求一次，页面无须手动刷新。
- 赛况一旦收到「已结束」状态，会自动计算获胜队伍和落败队伍，并填入胜者组、败者组下游位置。
- 管理员可以实时录入比分，所有访客自动收到更新。

## 二、管理员录入比分（快照模式）

启动时设置 `ADMIN_KEY`。Windows PowerShell：

```powershell
$env:ADMIN_KEY="自定义一串足够长的密钥"
npm start
```

macOS / Linux：

```bash
ADMIN_KEY='your-long-secret-key' npm start
```

打开 `http://localhost:3000/?admin=1`，录入密钥、选比赛、填比分，点击「保存并同步给所有访客」。

管理员更新将写入 `data/state.json`。**注意：** 某些免费云服务不保证本地磁盘永久保存，因此长期部署最好使用远端数据源或持久存储。

## 三、接入获授权的真实赛事 JSON 数据源

服务器支持一个由你运营或有权调用的 JSON 地址。格式如下：

```json
{
  "updatedAt": "2026-11-21T04:30:00Z",
  "matches": {
    "UQ1": { "status": "final", "score1": 2, "score2": 3 },
    "UQ2": { "status": "live", "score1": 1, "score2": 2 }
  }
}
```

`status` 必须是 `scheduled` / `live` / `final`，`score1` 与 `score2` 是比分（普通比赛 0—3；GF 总决赛 0—4）。`updatedAt` 必须是实际数据更新的 ISO 8601 时间戳。

- 可只传发生变更的场次，服务器保留其他已知比分。
- 所有场次 ID：`UQ1 UQ2 UQ3 UQ4 US1 US2 UF GF L1A L1B LQ1 LQ2 LS LF`。
- 普通比赛最终比分须有一方达到 3；GF 需达到 4。
- 当比赛已结束，下一场自动继承该场的胜者 / 败者。
- `FEED_URL` 需要 HTTPS；测试时允许本地 `http://localhost`。
- 可以为需要访问凭据的接口设置 `FEED_TOKEN`（以 Bearer 方式传递，且不会泄露至浏览器）。
- 上游失败时保留最后一次有效数据并显示异常，不展示虚假的比分。

Windows PowerShell 示例：

```powershell
$env:FEED_URL="https://你的可信赛事API地址/matches.json"
$env:FEED_TOKEN="可选接口令牌"
npm start
```

更新流：数据源 ➜ Node 服务器每 45 秒同步 ➜ 网站每 15 秒拉取 ➜ 比分与晋级路线刷新。频率可通过 `FEED_INTERVAL_MS` 配置，服务端最小间隔 15 秒。实际延迟受**上游更新频率和网络状态**影响，不保证秒级。

## 四、部署上线

**零基础操作请优先阅读项目根目录 `部署上线_零基础指南.md`。项目已添加 Render 一键蓝图 `render.yaml` 和健康检查路由 `/health`。**

项目无第三方依赖，可部署到能够运行 Node.js 的主机（如 Render / Railway / VPS）。

1. 将整个项目上传到代码仓库或云主机。
2. 使用 Node 20+；启动命令 `npm start`。
3. 云平台通常自动提供 `PORT`；官方同步设置 `FEED_PROVIDER=supercell`，自有 JSON 源则设置 `FEED_PROVIDER=json`、`FEED_URL` 和可选的 `FEED_TOKEN`。
4. 部署成功后，把平台给你的 HTTPS 网址分享给朋友即可。

> 只把 `index.html` 放在静态托管上**不能**让动态 `/api/state` 正常工作，除非另外部署兼容 API。**这个对话无法代替你的账户实际发布一个公网域名**。

## 五、数据核对与来源

- 官方比赛日期、赛制：<https://supercell.com/brawlstars/en/blog/esports/brawl-stars-world-finals-format/>
- 官方直播入口：<https://event.supercell.com/brawlstars/en/live>
- 对阵详情入口：<https://brawlytics.pro/worlds>
- 其他参考：<https://liquipedia.net/brawlstars/Brawl_Stars_World_Finals/2026>

2026-11-21 已核对的静态快照：小组赛有 4 支队伍出局（RED Canids、Team Heretics、Crazy Raccoon、NOVO Esports）；FUT Esports 2:3 NAVI；Bounty Hunters 0:3 HMBLE。**快照时间之后的赛果必须由实际数据源提供，不应从赛程推断。**

部分小组赛场次的**具体开赛时间未核对**，界面标注「时间未核对」，并非虚构时间。

此网站为独立的粉丝信息展示，不属于 Supercell 官方网站；数据/队名版权属于各权利人。
