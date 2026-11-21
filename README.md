# BRAWL // LIVE — 2026 荒野乱斗全球总决赛

这是一个可运行的中文赛事看板，包含 **14 场双败淘汰赛**、小组赛结果、赛程表、晋级与淘汰判定、北京时间、移动端布局及管理员实时改分。

> **重要说明：** 本项目默认内置截至 2026-11-21 05:00 UTC 的「已核对快照」：小组赛出局队伍、**FUT Esports 2:3 NAVI** 与 **Bounty Hunters 0:3 HMBLE**。它**不是已经接入真实直播数据的成品**，页面会明确标出数据状态。真正自动更新比赛比分，必须提供一个有权使用的 JSON 赛事数据接口。项目**不会擅自抓取第三方网页**或把猜测当成直播比分。

## 一、立即查看网页

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

## 二、管理员录入比分（不需要额外接口）

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
3. 云平台通常自动提供 `PORT`；如需真实比分，设置 `FEED_URL` 和可选的 `FEED_TOKEN`。
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
