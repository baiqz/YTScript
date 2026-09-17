# YT Script · YouTube 视频文稿提取工具

一个模仿 [youtubetotranscript.com](https://youtubetotranscript.com) 的本地网页应用：粘贴 YouTube 链接，
一键提取完整字幕文稿，支持多语言轨道、翻译、时间戳跳转与多格式导出。

**零外部依赖** —— 只用 Node.js 内置模块，不需要 `npm install`，不需要联网注册任何账号。

![首页](docs/preview-home.png)

![提取结果](docs/preview-result.png)

---

## 快速开始

**双击 `start.bat`** 就行。

脚本会自动找到 Node、启动本地服务、把浏览器打开到 <http://127.0.0.1:8790>。
端口被占用时会自动顺延到 8791、8792 …；如果本应用已经在跑，则直接把页面调出来，不会报错。

需要 Node.js 18 或更高版本（没装的话去 <https://nodejs.org> 下一个即可）。

### 手动启动

```bat
node server.js

node server.js --port 8791                     :: 换个端口
node server.js --proxy http://127.0.0.1:7890   :: 指定代理
node server.js --no-open                       :: 不自动开浏览器
```

---

## 功能

| 能力 | 说明 |
| --- | --- |
| 链接解析 | 支持 `watch?v=` / `youtu.be` / `shorts` / `live` / `embed`，也可直接填 11 位视频 ID |
| 多语言轨道 | 列出视频全部字幕轨道，人工字幕与自动字幕分别标注 |
| 翻译 | 调用 YouTube 官方翻译轨道，支持 100+ 目标语言 |
| 播放联动 | 内嵌播放器与文稿双向联动，点击整行跳转，播放时自动高亮当前行 |
| 视图与检索 | 逐句 / 段落两种视图，关键词检索与高亮，时间戳开关 |
| 导出 | 纯文本、带时间戳文本、TXT、SRT、WebVTT、JSON |
| 历史记录 | 最近 12 条提取记录存于浏览器 localStorage |
| 网络自适应 | 直连 / 环境变量代理 / 常见本地端口自动探测择优，并记忆可用通路 |

---

## 网络说明

YouTube 在中国大陆无法直接访问。程序启动时会按下列顺序自动探测可用通路，并**并行**测试后选出可用的一条：

1. `config.json` 中上次验证成功的代理（程序自动写入）
2. 环境变量 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`
3. 常见本地代理端口：`7890, 7891, 7897, 7898, 10808, 10809, 1080, 1081, 8118, 8889, 20171`
4. 直连

如果都不可用，可任选一种方式手动指定：

- 命令行：`node server.js --proxy http://127.0.0.1:7890`
- 网页右上角「网络状态」→ 填写代理地址 → 保存并测试

> 部分受限环境会禁用 `reg.exe`，因此程序不读取 Windows 注册表中的系统代理，
> 改用「常见端口探测 + 手动配置 + 配置持久化」的组合方案。

---

## 取数原理

实测结论（2026-09）：

| 客户端 | player 接口 | 字幕是否可直接下载 |
| --- | --- | --- |
| `ANDROID` 20.10.38 | ✅ 正常 | ✅ 可下载（**主通道**） |
| `IOS` 20.10.4 | ✅ 正常 | ✅ 可下载（备用） |
| `ANDROID_VR` 1.60.19 | 部分视频 `LOGIN_REQUIRED` | ✅ 可下载（备用） |
| `MWEB` / `WEB` | 常返回 `UNPLAYABLE` | ❌ 需 POT 令牌，返回 0 字节 |
| `TVHTML5_SIMPLY_EMBEDDED_PLAYER` | ❌ 已停止支持 | ❌ |
| 视频落地页 HTML | ✅ `ytInitialPlayerResponse` | ❌ 同上，仅作元数据兜底 |

因此流程是：

1. 依次尝试 `ANDROID → IOS → ANDROID_VR`，取第一个「运行状态正常且含有字幕轨道」的结果；
2. 用该客户端对应的 User-Agent 下载 `api/timedtext` 轨道（`fmt=json3`，失败回退 XML 解析）；
3. 元数据缺失时用落地页 HTML 或 oEmbed 补全。

**翻译（tlang）注意事项**：YouTube 对「按需生成译文」限流较严，常返回 `429`；
且同一语言存在多个等价代码（`zh-Hans` / `zh-CN`），命中已生成的代码才能立即返回。
程序内置了「语言别名 + 指数退避重试」，并在翻译失败时不写缓存，方便直接重试。

---

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/transcript` | 提取文稿，参数 `url`（必填）、`lang`、`tlang`、`force` |
| GET | `/api/health` | 运行状态与通路信息；`?probe=1` 时真实探测一次 YouTube |
| POST | `/api/proxy` | 运行时切换代理，body `{"proxy": "http://..."}` |
| GET | `/api/ping` | 探测一次 YouTube 连通性 |

```bash
curl "http://127.0.0.1:8790/api/transcript?url=https://youtu.be/dQw4w9WgXcQ&tlang=zh-Hans"
```

错误码：`BAD_URL`(400)、`NO_CAPTIONS`(404)、`TRACK_EMPTY`(429/502)、`PLAYER_FAILED`(502)、
`POT_REQUIRED`(502)、`RATE_LIMITED`(429)、`TIMEOUT`(504)。

---

## 可调环境变量（都是可选的）

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `RELAY_URL` | 空 | **本机中继地址**，如 `https://xxx.trycloudflare.com`。让云端借用你本机的出口访问 YouTube，根治机房 IP 被风控的问题，见下文「本机中继」 |
| `RELAY_TOKEN` | 空 | 中继令牌，与 `RELAY_URL` 配套。运行 `relay.bat` 时会打印出来 |
| `RELAY_TIMEOUT_MS` | `50000` | 转发到中继的超时上限，超时后自动降级为云端直连 |
| `RELAY_MODE` | 本机自动开启 | 本机侧是否以中继模式运行（`relay.bat` 已自动带 `--relay`） |
| `PROXY_URL` | 空 | 出口代理，如 `http://user:pass@host:port`，优先级高于 `config.json` |
| `PUBLIC_MODE` | 云端自动为 `1`，本地 `0` | 公开部署模式：启用防护、封禁危险接口、不泄露内部细节 |
| `ACCESS_CODE` | 空 | 设置后需 `?code=xxx` 或 `X-Access-Code` 头才能访问 |
| `ALLOW_PROXY_CONFIG` | 公开模式为 `0` | 是否允许访客改服务器出口代理，**公开部署务必保持 0** |
| `RATE_LIMIT_MAX` | 公开 `20` / 本地 `120` | 单 IP 时间窗内最大请求数 |
| `REQUEST_TIMEOUT_MS` | `25000` | 首次提取（不含翻译）超时上限 |
| `TRANSLATE_TIMEOUT_MS` | `55000` | 含翻译时的整体超时上限（YouTube 按需翻译实测 20~46 秒） |
| `CACHE_TTL_MS` | `21600000` | 结果缓存时长（6 小时） |
| `INSECURE_TLS` | `0` | `1` 跳过 TLS 证书校验（仅在中间人代理场景需要） |

---

## 本机中继：让云端借用你家宽带的出口

**要解决的问题**：部署到 Vercel 这类平台后，出口是**共享的机房 IP**，YouTube 会对它判定为高风险，
要求人机凭证（PO token），于是很多视频报 `POT_REQUIRED`。实测中文知识类视频**云端 0/8 全被拦**，
而同一批视频在**你本机（住宅出口）3/8 成功**（另 5 个视频本身就没字幕）。

换客户端、带 `visitorData`、重试都已实测无效 —— 唯一变量就是出口 IP 的属性。

**做法**：云端函数不再自己访问 YouTube，而是把请求转发回**你自己电脑**上跑的服务：

```
访客 → Vercel 函数 → 公网隧道 → 你电脑的 server.js（--relay 模式）→ YouTube
```

**三步**：

1. 把 `cloudflared.exe` 放进项目目录（下载地址见 `DEPLOY.md` 4.6）
2. 双击 **`relay.bat`**，它会打印一个 `RELAY_TOKEN`，并开出一条 `https://xxx.trycloudflare.com` 隧道
3. 把这两个值填到部署平台的 `RELAY_TOKEN` / `RELAY_URL` 环境变量，然后 **Redeploy**

之后只要那个窗口开着，云端就走你家出口。窗口关了会自动退回云端直连（站点不会挂）。

**安全边界**（中继模式的端口是公网可达的，因此收紧）：

| 措施 | 效果 |
| --- | --- |
| 所有 `/api/*` 校验 `X-Relay-Token` | 无正确令牌返回 `401 RELAY_UNAUTHORIZED` |
| `/api/proxy` 直接封禁 | 返回 `403 FORBIDDEN`，防止路人把出口改成任意地址（SSRF） |
| 令牌用定长时间比较 | 不用 `===`，避免被逐字节试探 |
| 仅 `/api/health` 开放 | 不含敏感信息，供探活排障 |

**完整操作步骤、验证方法、故障排查见 [`DEPLOY.md` 4.6](DEPLOY.md)。**

---

## 目录结构

```
youtube-transcript/
├─ server.js              本地服务（静态资源 + API 路由）
├─ start.bat              Windows 一键启动（本机模式）
├─ relay.bat              Windows 一键启动（本机中继模式，端口 8801）
├─ vercel.json            云端部署配置
├─ DEPLOY.md              部署到互联网的完整步骤
├─ config.json            运行期自动生成，记录可用的代理地址与中继令牌（已被 .gitignore 排除）
├─ config.example.json    配置文件示例
├─ api/                   接口处理器（本地服务与云端函数共用）
│  ├─ transcript.js       文稿提取
│  ├─ health.js           状态检查
│  └─ proxy.js            代理切换（云端与中继模式下自动封禁）
├─ lib/
│  ├─ http-client.js      零依赖 HTTP 客户端（CONNECT 隧道 / 解压 / 通路择优）
│  ├─ youtube.js          取数与字幕解析核心
│  ├─ relay.js            本机中继：把提取请求转发回本机出口
│  ├─ guard.js            限流 / 超时护栏 / 定长时间比较
│  ├─ api-respond.js      统一响应与错误封装
│  ├─ util.js             通用工具
│  ├─ url.js              视频 ID 解析
│  ├─ languages.js        YouTube 翻译目标语言表
│  └─ config.js           配置层
├─ docs/                  预览截图
└─ public/
   ├─ index.html
   ├─ styles.css
   └─ app.js
```

---

## 已知限制

- **`start.bat` 与 `relay.bat` 必须保持「纯 ASCII + CRLF 换行」**。cmd.exe 解析 LF 换行的批处理会错乱
  （多行 `for` / `if` 块被拆散）；文件里混入中文等多字节字符时，解析器还会把中文拆开当成命令执行。
  `.gitattributes` 已用 `*.bat text eol=crlf` 锁住换行符，**改动这些文件时不要写中文注释**，
  用户可见的中文提示一律由 Node 端输出（Node 写 UTF-8，脚本已把控制台切到 65001）。
  另注意：这两个脚本都**不要用 `for /f` 去捕获带引号的绝对路径命令输出** —— cmd 会剥掉外层引号，
  路径含空格时报 `'C:\Program' is not recognized`（`relay.bat` 改用临时文件 + `set /p` 绕开）。
- **中继模式下端口固定为 8801，不会自动顺延**。隧道指向固定端口，悄悄换端口只会让中继连不上、
  报错点离现场很远，因此宁可当场退出并提示换端口。本机日常那份服务（端口 8790）可与它同时运行。
- 视频本身没有字幕（未上传且未开启自动字幕）时无法提取，接口会返回 `NO_CAPTIONS`。
- 翻译与字幕接口存在频率限制，连续批量提取时可能返回 `429`，稍等重试即可。
  翻译不成功时接口仍返回 `200` + 原文字幕，并在 `warning` 字段说明原因。
- 脚本与样式都是纯前端逻辑，无需构建步骤；但改动 `public/` 下的文件后记得刷新页面（服务已禁用缓存）。
- 内嵌播放器依赖浏览器可访问 YouTube；仅文稿提取不受影响。
- 一次处理一个视频，暂不支持批量队列。

## 合规

仅供个人学习与研究使用。请遵守 YouTube 服务条款，文稿版权归原作者所有。

## 许可

[MIT](LICENSE)
