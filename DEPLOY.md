# 部署到互联网 · 手把手

目标：得到一个网址，别人点开就能用。

整个过程约 **15 分钟**，分 5 步。第 0 步我已经替你做完了，你从第 1 步开始。

---

## ⚠️ 先读这一段：国内访问的硬事实

这一点必须提前知道，否则你可能白忙一场。

部署到 Vercel 后会得到一条免费域名，长这样：

```
https://youtube-transcript-xxxx.vercel.app
```

**这条域名在中国大陆基本打不开**（DNS 污染 + 连接重置）。不是你的代码问题，是这类免费域名被整体屏蔽了。

所以：

| 你的情况 | 该怎么办 |
| --- | --- |
| 主要给国外的人用 | 免费域名就够，按本指南走完即可，零成本 |
| 主要给国内的人用 | **必须绑定自己的域名**（见第 5 步），否则大家点开是白屏 |
| 先上线看看效果 | 先走完第 1~4 步拿到网址，第 5 步等你想好了再做 |

你现在选的是「暂时不买域名」，那就先说清楚后果：**第 4 步拿到的网址，你自己（挂着代理时）能开，国内的朋友直接点开大概率是打不开的。** 想让他们也能用，就得走到第 5 步。

另外，部署操作本身（注册 Vercel、点按钮）如果网络不顺，挂上你的代理做即可。

---

## 全流程概览

```
第 1 步  GitHub 上建一个空仓库            约 2 分钟
第 2 步  把本地代码推上去                  约 3 分钟
第 3 步  Vercel 导入这个仓库，点部署       约 5 分钟
第 4 步  验证网址真的能用                  约 3 分钟
  └ 4.6 （推荐）上本机中继，解决风控拦截    约 10 分钟
第 5 步  （可选）绑定自己的域名            约 10 分钟 + 域名费用
```

> **提示**：如果你发现提取时经常报「YouTube 要求人机校验」（`POT_REQUIRED`），
> 那是云端出口 IP 被 YouTube 判为机房流量了。**4.6 本机中继**就是为这个问题做的，
> 做完之后云端成功率和你在电脑上本地跑一样。

---

## 第 0 步：代码已就绪（我已完成）

你不用做任何事，但可以了解一下我已经准备好的东西：

| 文件 | 作用 |
| --- | --- |
| `vercel.json` | 告诉 Vercel：静态文件在 `public/`，接口函数在 `api/`，单次执行上限 60 秒 |
| `api/*.js` | 三个无服务器接口：提取文稿 / 健康检查 / 代理配置（末尾这个在云端会被自动封禁） |
| `public/` | 网页本体（HTML / CSS / JS） |
| `lib/` | 取数核心，被 `api/` 里的函数共用 |
| `lib/relay.js` | 本机中继的转发逻辑，见 4.6 |
| `.gitignore` | 已排除 `config.json` —— 里面有你的本机代理地址和中继令牌，**绝不能上传** |
| `package.json` | 零依赖，Vercel 不需要执行 `npm install` |
| `start.bat` | 本地日常使用：本机模式，成功率 100% |
| `relay.bat` | 本机中继：把本机变成云端的出口，见 4.6 |

关键点：**这套代码同时支持本地运行和云端部署**，你不用维护两份。线上会自动识别云端环境，走环境变量配置。

---

## 第 1 步：在 GitHub 上创建一个空仓库

> **先确认一件事：你有 GitHub 账号吗？**
>
> - **有** → 直接往下走。
> - **没有** → 先花 2 分钟注册，打开 <https://github.com/signup>：填邮箱 → 设密码 → 取用户名（只能英文数字和连字符，会出现在你的网址里，比如 `zhangsan`）→ 收邮件填验证码。注册页面加载慢是正常的，挂上你的代理会更顺。
>
> 用户名请记好，第 2 步拼仓库地址要用。

1. 打开 <https://github.com/new>
2. 填写：
   - **Repository name**：`youtube-transcript`（或你喜欢的名字）
   - **Description**：随意，比如 `YouTube 视频文稿提取工具`
   - **Public / Private**：选 **Public**（开源，别人也能部署）
3. **下面三个勾选框全部不要勾**（Add a README / Add .gitignore / Choose a license）

   > 这一步很重要。本地已经有完整的代码和 README 了，勾了反而会造成两边文件冲突，推不上去。

4. 点 **Create repository**

创建完你会看到一个「Quick setup」页面，上面有一行仓库地址，形如：

```
https://github.com/baiqz/YTScript.git
```

**把这行地址记下来，第 2 步要用。**

---

## 第 2 步：把本地代码推上去

> **当前实际状态**（前置工作已替你做完）
>
> | 项目 | 状态 |
> | --- | --- |
> | 本地提交 | 已建好，`main` 分支，作者已设为 `baiq <99478891+baiqz@users.noreply.github.com>` |
> | 远程 `origin` | 已关联到 `https://github.com/baiqz/YTScript.git` |
> | 待你操作 | **只剩最后一条 `git push`** —— 它需要你在浏览器里点一次授权，别人代劳不了 |

### 2.1 推送（唯一需要你动手的步骤）

**推荐做法：双击这个脚本**

```
E:\workbuddyspace1\push-to-github.bat
```

它会自动进入项目目录并执行推送，需要登录时会唤起浏览器。看到窗口里打出
`Exit code : 0` 就是成功了。

**如果你更喜欢手打命令**，打开终端执行：

```bash
cd /d E:\workbuddyspace1\youtube-transcript
git push -u origin main
```

推送成功后刷新 <https://github.com/baiqz/YTScript>，应该能看到 27 个文件。

### 2.2 首次推送时的登录方式

GitHub 早就不接受账号密码了，有两条路，**优先用第 1 条**：

**① 浏览器授权（推荐，免 Token）**
推送时 git 会自动弹出浏览器窗口，让你登录 GitHub 并点「Authorize」。点完就完事，不用手动造令牌。

**② 用 Personal Access Token（浏览器没弹出来时用）**

1. 打开 <https://github.com/settings/tokens> → **Generate new token (classic)**
2. Note 随便填，Expiration 选 90 天，勾选 **`repo`** 这一项
3. 生成后**立刻复制**那串 `ghp_...`（页面关掉就再也看不到）
4. 回到终端：用户名填 `baiqz`，**密码处粘贴那串 Token**

### 2.3 确认敏感文件没被推上去

```bash
cd /d E:\workbuddyspace1\youtube-transcript
git ls-files | findstr "config"
```

预期**只输出一行**：

```
config.example.json
```

这是示例文件，公开无妨。

**如果同时看到了 `config.json`，立刻停下**——那意味着你的本机代理地址被公开了。执行下面两行把它从仓库里摘掉：

```bash
git rm --cached config.json
git commit -m "移除本地配置"
git push
```

---

## 第 3 步：在 Vercel 导入并部署

1. 打开 <https://vercel.com/signup>，选 **Continue with GitHub** 注册/登录（用 GitHub 账号登录，后面才能读到你的仓库）
2. 登录后进入 <https://vercel.com/new>
3. 在 **Import Git Repository** 列表里找到刚推的 `youtube-transcript`，点 **Import**
   - 如果列表里没有，点 **Adjust GitHub App Permissions** 授权 Vercel 读取你的仓库
4. 进入配置页，**任何设置都不用改**：
   - **Framework Preset**：会自动识别成 `Other`
   - **Root Directory**：保持 `./`
   - **Build Command / Output Directory**：留空，`vercel.json` 里已经写好了
   - **Environment Variables**：暂时留空
5. 点 **Deploy**，等 30~60 秒

看到撒花动画（Congratulations）就成功了。页面上会给你一条网址，形如：

```
https://youtube-transcript-xxxx.vercel.app
```

**这就是你要的那条链接。**

---

## 第 4 步：验证真的能用

拿到网址后，按顺序检查这四项：

### 4.1 页面能打开

浏览器访问你的网址，应该看到和本地一样的界面（顶部徽章会变成「已部署」而不是「本地运行」）。

### 4.2 接口正常

访问 `你的网址/api/health`，应该返回一段 JSON，其中：

```json
{ "ok": true, "service": "ytscript", "mode": "public", ... }
```

`mode` 必须是 `public`。这代表已经切换到公开部署模式——访客无法修改服务器配置，错误信息也不会泄露内部实现。

### 4.3 真的能提取字幕

在页面上粘贴一个 YouTube 链接（比如 `https://www.youtube.com/watch?v=dQw4w9WgXcQ`），点提取。

**预期结果**：出现 60 条文稿、6 条字幕轨道、可切换翻译语言。

### 4.4 如果提取失败：先看错误码，别急着怀疑网络

页面上的报错来自服务端，**错误码能直接告诉你是哪一侧的问题**。接口返回里的 `code` 字段对照如下：

| code | HTTP | 含义 | 该做什么 |
| --- | --- | --- | --- |
| `BAD_URL` | 400 | 链接里没解析出 11 位视频 ID | **看报错里的位数提示**。YouTube 视频 ID 固定 11 位，少一位多一位都算不合法。这是最常见的原因 |
| `VIDEO_UNAVAILABLE` | 404 | 视频不存在 / 已删除 / 私享 / 地区或年龄限制 | **问题在视频本身，和网络无关**。换一个公开且能正常播放的视频 |
| `AGE_RESTRICTED` | 403 | 年龄限制视频，需登录观看 | 服务端无法代登录，换视频 |
| `NO_CAPTIONS` | 404 | 视频确实没有字幕（UP 主没传、也没开自动字幕） | 换有字幕的视频。注意：直播回放通常没有 |
| `POT_REQUIRED` | 502 | YouTube 对当前出口发起人机校验 | **重试无效**（实测连打 6 次全失败）。根治办法见 **4.6 本机中继**；临时应付就换个视频。详见 4.5 |
| `TIMEOUT` | 504 | 服务端访问 YouTube 超时 | 见下面常见问题第 1 条 |
| `FETCH_FAILED` | 502 | 所有客户端都没拿到任何响应 | 同上，属出口问题 |
| `RATE_LIMITED` | 429 | 单 IP 请求过快 | 等一会儿 |

**关键区分点**：`VIDEO_UNAVAILABLE` / `NO_CAPTIONS` / `BAD_URL` 都是**视频侧**的问题，服务端网络是好的 —— 这时去配 `PROXY_URL` 是白费功夫。`POT_REQUIRED` 属**出口侧**，但它拦的是特定视频，不是整个出口（同一时刻别的视频能正常取）。

### 4.5 云端的能力边界（重要，实测结论）

**一句话**：云端不是「能访问 YouTube」和「不能访问 YouTube」的二选一，而是**按视频分级放行**。

实测数据（同一时间、同一云端出口、含缓存击穿对照）：

**样本一：12 个著名音乐/热门视频**

| 结果 | 数量 | 例 |
| --- | --- | --- |
| 成功 | 2 | `dQw4w9WgXcQ`（6 条轨道）、`_OBlgSz8sSM` |
| `POT_REQUIRED` | 7 | PSY Gangnam、Despacito、Bohemian Rhapsody、Adele Hello… |
| 被限流（自己探太密） | 3 | — |

**样本二：8 个真实中文知识类视频**（用 InnerTube 搜索取的 ID，比手写更可靠）

| 出口 | 结果 |
| --- | --- |
| 云端 | **0/8 成功，8 个全部 `POT_REQUIRED`** |
| 本机（住宅出口） | 3/8 成功（另外 5 个视频本身确实没有字幕，本机也照实报 `NO_CAPTIONS`） |

> 也就是说：**光看那几个能用的视频会产生错觉**。中文知识类内容是 8/8 全灭。
> 另外要注意——中文频道有相当大比例（本样本 5/8）压根没上传字幕、也没开自动字幕，
> 这类视频在任何出口上都取不到，属 `NO_CAPTIONS`，与出口无关。

**这不是随机抖动**，而是稳定的：

- 同一个失败视频，**连打 6 次，0 次成功**（PSY、Despacito 各 6 次）
- 同一个成功视频，**连打 6 次，6 次成功**（Me at the zoo）
- 加 `_cb=` 随机参数击穿边缘缓存后结果**完全一致** → 排除「看到的是缓存假象」
- 换成走本机住宅出口，**同一批视频全部成功**

**已经实测排除的四种解法**（别在这上面浪费时间）：

| 尝试 | 结果 |
| --- | --- |
| 重试 | ❌ 0/6，无用 |
| 换客户端 | ❌ 测了 9 种客户端配置，**只有 ANDROID / IOS / ANDROID_VR 能拿到轨道，而这 3 种已经在用**。TVHTML5_SIMPLY_EMBEDDED_PLAYER 已废弃；TVHTML5、WEB_EMBEDDED_PLAYER、ANDROID_CREATOR、MWEB、WEB 全部拿不到轨道 |
| 带 `visitorData` | ❌ 逐个客户端对照 19 组，结果**一模一样**，零影响 |
| 让浏览器直连 YouTube | ❌ `youtubei/v1/player` 带 `Origin` 头时 YouTube 直接返回 **403 且无 CORS 头**，此路不通（字幕轨下载接口虽有 CORS，但拿不到轨道列表） |

**原因**：YouTube 对数据中心 IP 的「高风控视频」要求 PO token（人机凭证）。生成 PO token 需要跑 YouTube 的 BotGuard 虚拟机，代价高且易失效，不适合放进无服务器函数。

**因此在云端要彻底解决，核心是「换出口」**。三条路，按推荐度排序：

| 方案 | 做法 | 代价 | 适合 |
| --- | --- | --- | --- |
| **① 本机中继**（推荐，本项目已支持） | 云端把请求转发回**你自己电脑**上跑的服务，用你家宽带的出口取数 | 电脑要开着；需跑 `relay.bat` | 自己用 / 小范围分享，**成功率＝本机 100%** |
| ② 配 `PROXY_URL` | Vercel → Settings → Environment Variables 填一个**公网可达**的住宅代理 | 要买能给你公网入口的住宅代理，通常不便宜 | 想彻底托管、不依赖自己电脑 |
| ③ 换托管位置 | 同一份代码部署到自有独立 IP 的小主机 | 要另买机器、自己运维 | 有现成主机的人 |

> ⚠️ 三个方案有个共同前提：**地址必须是公网可达的**。填 `127.0.0.1:xxxx` 一律无效 ——
> 云服务器访问不到你家电脑。这也是为什么方案 ① 需要一条隧道（见 4.6）。

**方案 ① 的完整操作步骤见 4.6**，那是本项目为这个场景专门做的功能。

日常自己在电脑上用，其实**根本不需要折腾云端**：双击 `start.bat` 走本机模式，**成功率 100%**，
云端只当分享入口。

自己复现一次很简单（把 `<你的域名>` 换成实际地址）：

```bash
curl -s "https://<你的域名>/api/transcript?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

看返回里的 `code`，对照上表。

> **踩过的坑**：早期版本无论什么原因失败都笼统提示「服务端暂时无法访问 YouTube」，
> 结果视频号错了也让人去查代理，白折腾。现已按上表分类。

### 4.6 方案 ①：本机中继（让云端借用你家宽带的出口）

**一句话原理**：云端函数不再自己访问 YouTube，而是把整条提取请求**原样转发回你自己电脑**上跑的那个服务，
由它用你家宽带的出口去取数，取到了再顺原路返回。

```
访客浏览器
   │  ① 打开网站、点提取
   ▼
Vercel 云端函数  ──② 转发提取请求──▶  公网隧道地址
   ▲                                      │
   │  ⑤ 把结果返回给访客                    ▼
   └──────────────────────────── 你电脑上的 server.js（--relay 模式）
                                          │  ③ 用你家宽带访问 YouTube
                                          ▼
                                       YouTube  ← ④ 拿到字幕轨道
```

**为什么能解决**：4.5 里已经证明，被拦的唯一变量是**出口 IP 的属性**。
Vercel 的共享机房 IP 会被判高风险，你家宽带的住宅 IP 不会 —— 本机实测成功率 100%。
中继没有「绕过」风控，它只是把出口换成了 YouTube 认可的那一个。

**代价**：电脑要开着、窗口不能关。适合自己用或小范围分享；不适合当成给陌生人的公开服务。

---

#### 准备：选一条隧道

隧道的作用是把 `http://127.0.0.1:8801` 变成一条公网地址，云端才够得着。
**这一步决定了你以后要不要反复回来改配置**，所以先选好：

| | **A. ngrok**（推荐） | **B. cloudflared** |
| --- | --- | --- |
| 要注册吗 | 要（免费，邮箱即可） | **不要** |
| 公网地址 | **永久固定**，配一次再也不管 | **每次重启都会变**，变了就得回 Vercel 改 |
| 免费额度 | 2 万请求/月、1GB 流量 | 无限（无账号隧道无可用性保证） |
| 代价 | 多花 5 分钟注册 | 每次重启 relay.bat 都要回 Vercel 改一次 |

**如果这台电脑会长期开着，选 A**（省事得多）。只是想先试试效果，选 B。

##### A. ngrok（地址永久固定）

1. 注册：<https://dashboard.ngrok.com/signup>（邮箱注册，免费计划就够）
2. 下载 Windows 版 <https://ngrok.com/download>，解压出 `ngrok.exe`，放进：
   ```
   E:\workbuddyspace1\youtube-transcript\
   ```
3. 在 ngrok 后台首页复制你的 **authtoken**，然后在本目录开个终端执行一次：
   ```bat
   ngrok.exe config add-authtoken 你的authtoken
   ```
4. 在 ngrok 后台 **Universal Gateway → Domains** 里能看到分配给你的**固定域名**
   （形如 `abc123xyz.ngrok-free.dev`）。它就是以后一直用的 `RELAY_URL`。

> 配好之后，`relay.bat` 会**自动优先选 ngrok**，你不用改任何脚本。

##### B. cloudflared（免注册，下载即用）

下载（Windows 64 位直链）：

```
https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
```

放进同一个目录：

```
E:\workbuddyspace1\youtube-transcript\
```

> **不用改名**，认 `cloudflared-windows-amd64.exe` 也认 `cloudflared.exe`，
> 放 `tools\` 子目录下同样可以。
> 如果 GitHub 打不开，在项目目录里用代理拉一次：
> ```
> curl -x http://127.0.0.1:33210 -L -o cloudflared.exe "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
> ```

不需要注册 Cloudflare 账号，也不需要域名 —— 用的是它的免费临时隧道。

> **两个文件都不会被提交到 Git**（`.gitignore` 已排除，cloudflared 有 50MB 左右）。

**两个都没放会怎样？** 不会出错：`relay.bat` 会打印出上面这两种获取方式让你选，
站点则自动退回云端直连（还能用，只是部分视频会被风控拦下）。

---

#### 操作：双击 relay.bat

双击：

```
E:\workbuddyspace1\youtube-transcript\relay.bat
```

窗口会依次走三个阶段。**你只需要看最后的配置块，照抄两个值。**

**阶段 1 · 打印令牌**

```
  Step 1 of 2 - your relay token

      RELAY_TOKEN = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> 首次运行时自动生成（32 位随机串），存在本地 `config.json` 里，
> **之后每次运行都是同一个值**，永不变。所以这个变量只需配一次。

**阶段 2 · 起本地服务 + 开隧道**

本地服务固定占用 **8801** 端口（中继模式不顺延端口）。
接着它会识别隧道程序并开始建连：

```
  隧道程序：ngrok  —— 地址永久固定，配一次以后不用再改
```

然后窗口会刷一段隧道程序自己的日志（`INF ...` 那些），**不用管**，属于正常输出。

**阶段 3 · 配置块（重点）**

隧道一建好，窗口会打出这样的块，**地址会自动复制到剪贴板**：

```
================================================================
  隧道已就绪 —— 把下面两个值填到部署平台
================================================================

  1) RELAY_URL
     https://xxxx.trycloudflare.com
     （已复制到剪贴板，直接 Ctrl+V 即可）

  2) RELAY_TOKEN
     xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

  位置：Vercel → 你的项目 → Settings → Environment Variables

  填完必须手动 Redeploy 一次 —— 环境变量改动不会自动生效，
  这是最容易漏掉的一步。
```

紧接着它会**从公网侧回打一次本机**做自检：

```
  ✓ 自检通过 —— 隧道确实把请求送到了本机。
    relayMode=true  relayTokenSet=true
```

> 看到 `✓ 自检通过` 就说明**隧道这一端完全没问题**，可以放心去填 Vercel 了。
> 若显示 `✗ 自检没通过`，说明地址拿到了但公网还够不着 ——
> 常见原因是边缘路由刚建立、需要再等十几秒，重新跑一次即可。

**然后去 Vercel 填两个变量**：<https://vercel.com> → 你的项目 → **Settings → Environment Variables**

| Key | Value |
| --- | --- |
| `RELAY_URL` | 上面那条地址（**结尾不要带 `/`**） |
| `RELAY_TOKEN` | 上面那串令牌 |

**最后一步 · 重新部署**

Vercel → **Deployments** → 最新那条 → 右侧 **⋯** → **Redeploy**。

> ⚠️ 环境变量改动**不会**自动生效，必须手动 Redeploy 一次。这是最容易漏掉的一步。

搞定。之后**只要这个窗口开着**，云端就会优先走你家出口。窗口一关，站点会自动退回云端直连
（还能用，但恢复到 4.5 描述的那种「部分视频被拦」的状态）。

---

#### 验证：三处对照，一眼看出通没通

| 在哪看 | 期望值 | 说明 |
| --- | --- | --- |
| 隧道地址 + `/api/health` | `"relayMode": true` | 证明本机服务真的起来了、隧道真的指向它。**如果这里不对，后面全是白搭** |
| 你的站点 + `/api/health` | `"relayConfigured": true` | 证明 Vercel 读到了 `RELAY_URL` + `RELAY_TOKEN` 两个变量 |
| 页面上提取一个 4.5 里被拦的中文视频 | 返回里 `"viaRelay": true` | 证明这次**真的走了中继**，不是云端直连蒙对的 |

也可以直接命令行验一次（把地址换成你的）：

```bash
curl -s "https://<你的域名>/api/transcript?url=https://www.youtube.com/watch?v=<之前被拦的视频ID>&force=1"
```

看返回 JSON 里的三个字段：`ok` 为 `true`、`viaRelay` 为 `true`、`code` 不再是 `POT_REQUIRED`。

---

#### 会失败吗？会自动降级，不会拖垮站点

这是刻意设计的：**中继是加分项，不是单点**。中继这一侧挂掉时，云端会自己退回直连继续干活，
并在返回里带一条 `warning` 说明原因。

| 情况 | 表现 |
| --- | --- |
| 电脑关机 / 窗口被关（含隧道一起没了） | 请求直接连不上 → 自动降级直连，返回里带 `warning` |
| 令牌填错 / 没填 | 本机端返回 `401 RELAY_UNAUTHORIZED` → 自动降级直连，`warning` 会提示去核对令牌 |
| `RELAY_URL` 还是上次那条旧隧道（域名已换） | 隧道地址已失效 → 自动降级，`warning` 提示「回源失败」，照着改 `RELAY_URL` |
| 隧道在、本机服务却停了 | 同上 → 自动降级，`warning` 提示「回源失败」 |
| 本机取数失败但**是网络问题**（代理关了 / 断网） | 自动降级直连 —— 云端出口和你家出口是两个 IP，直连真的可能成功 |
| 本机正常返回**内容级**结论（如 `NO_CAPTIONS` / `POT_REQUIRED`） | **原样透传**，不会再去直连撞一次 |
| 直连也失败 | 两条线索都给你：错误仍是直连的，但 `hint` 会追加上「中继为何没走通」 |

反过来说：**`warning` 里出现「已改走云端直连」这句话，就是中继没生效**，照着上面「验证」那张表逐项查。

> 注意看 `warning` 里的措辞 —— 它区分了「令牌不对」「隧道没连上」「回源失败」「地址 404」「网络不通」，
> 照着那半句话查就行，不用把每种可能都试一遍。
>
> 中继与直连都失败时，中继那条说明会被并进 `hint` 一起给出来。这是刻意的：
> 否则用户手上只剩「YouTube 又抽风了」这一种解释，实际原因却是中继断了。

> **中继这一跳不走出口代理。** 代理是用来访问被墙的 YouTube 的，而中继地址是隧道边缘
> （Cloudflare / ngrok 域名），本来就直连可达。把这一跳也塞进代理，等于给中继
> 凭空加一个依赖：**你一关代理客户端，中继链路就整个失效**，而隧道和本机服务其实都好好的。
> 所以转发请求强制直连，仅在直连遇到连接层错误且确实配了代理时，才用代理兜一次。
>
> 顺带一个诊断要点：**关掉代理不会让中继链路本身断掉，但会让本机取数变成网络级失败** ——
> 这时你会看到「已改走云端直连」，那不是中继坏了，是代理没开。

---

#### 几个必须知道的限制

**① 只有 cloudflared 的地址会变；换成 ngrok 就永久固定。**

| 隧道 | 地址行为 |
| --- | --- |
| **ngrok** | **永久固定**（形如 `abc123.ngrok-free.dev`），`RELAY_URL` 配一次就再也不用改 |
| cloudflared | `trycloudflare` 是**临时**隧道，**每次重启 `relay.bat` 都会分到新的随机域名**，变了就得回 Vercel 改 `RELAY_URL` 并 Redeploy |

> 所以如果你打算长期开着，**建议切到 ngrok**（准备那节有步骤）。
> `relay.bat` 会自动优先选 ngrok，切过去之后什么都不用改。
>
> 其他隧道（frp / localhost.run / 命名 Cloudflare 隧道）也都可以，
> 只要能把 `http://127.0.0.1:8801` 暴露成一个 https 地址 —— 本项目不依赖某一家。
> 但在换用它们之前，`relay.bat` 认不出来（它只自动识别这两家）。

**①b. ngrok 免费版的浏览器警告页不影响本工具。**

ngrok 免费版会在**浏览器打开的 HTML 页面**前插一个「你正在访问 ngrok 服务」的警告页。
本工具的转发请求是**程序发起**的 API 调用，本来就不受影响；
而且转发时已经带了 `ngrok-skip-browser-warning` 头，可以确保永不被拦。

**② 端口固定 8801，不会自动顺延。**

中继模式下端口被占用会**直接报错退出**，而不是悄悄换一个 —— 因为隧道指向的是固定端口，
悄悄换端口只会让中继连不上、报错点离现场很远。报错里会提示你换端口：
`node server.js --relay --port 8802`。

> 顺带一提：本机日常那份服务（`start.bat`，端口 8790）**可以同时开着**，两份互不干扰。

**③ 别双击第二次。**

已经开着的时候再双击 `relay.bat`，会因为 8801 被占用而报错退出。想重启就先把旧窗口 Ctrl+C 关掉。

**④ 隧道地址是公开的，务必配令牌。**

隧道一开，**任何拿到这个地址的人都能访问你的电脑上的服务**。所以中继模式做了三道收紧：

| 措施 | 效果 |
| --- | --- |
| 所有 `/api/*` 校验 `X-Relay-Token` | 没有正确令牌一律 `401 RELAY_UNAUTHORIZED` |
| `/api/proxy` 直接封禁 | 返回 `403 FORBIDDEN` —— 否则路人能把你的出口改成任意地址，等于送人一个 SSRF |
| 只留 `/api/health` 开放 | 内容不含敏感信息，且需要它来探活排障 |

令牌比较用的是**定长时间比较**，不是 `===`，避免被逐字节试探。

> 因此：**不要把隧道地址发给别人**。它是你家电脑的入口，令牌是那把钥匙。
> 需要给多人用，就走方案 ②（换出口）或第 5 步（绑域名），别直接分享隧道地址。

**⑤ 本机也有限流。**

访客 IP 会被转发过来（`X-Forwarded-For`），本机侧同样按 IP 限流，默认 **120 次/分钟**，
比云端公开模式的 20 次宽松。要调就设环境变量 `RATE_LIMIT_MAX`。

**⑥ 隧道会把「502 / 504」的响应体换掉 —— 代码里已经绕开了，但改了本机代码就必须重启。**

这是实测出来的坑，记在这里免得以后重新踩：

| 本机服务返回 | 经隧道后客户端实收 |
| --- | --- |
| 200 / 301 / 400 / 401 / 403 / 404 / 429 / **500 / 501 / 503** | 原样透传（JSON 完整） |
| **502 / 504** | **响应体被换成 Cloudflare 自己的错误页** |

而本工具的失败**恰好全落在 502/504**（`POT_REQUIRED` / `PLAYER_FAILED` → 502，`TIMEOUT` → 504），
所以曾经出现过这个现象：**明明是本机出口取不到字幕，页面上却显示一句英文的
"origin web server returned an invalid or incomplete response to Cloudflare"** ——
看到那句话会一路往「YouTube 风控」猜，其实风控提示在半路就被吞掉了。

现在的处理：中继这一端**不把 502/504 发出去**，改成 200 + 业务码（`ok:false` + `code`），
云端再按 `code` 还原成对外的状态码。同时云端遇到「不是本服务的报文」一律当隧道故障处理、
降级直连，绝不把 Cloudflare 的报错页转给用户。

> **推论：改完本机代码要重启 `relay.bat` 才生效。** 云端函数是每次请求重新加载的，
> 而本机这份服务是常驻进程 —— 只推代码不重启，跑的还是旧逻辑。
> 重启会让隧道地址变化，所以趁早切 ngrok（见上面①）最省事。

---

## 第 5 步（可选）：让国内朋友也能打开

走到这里，网址在国外可用、国内不可用。要让国内也能用，需要有自己的域名。

### 5.1 买一个域名

推荐去处（都支持支付宝/微信）：

| 平台 | 特点 |
| --- | --- |
| 腾讯云 / 阿里云 | 国内访问快、中文界面，`.top` `.xyz` 等首年常有几元的活动 |
| Cloudflare Registrar | 按成本价卖，不赚差价，但需外币卡 |
| Namesilo / Porkbun | 老牌注册商，价格透明 |

价格参考：`.com` 约 60~80 元/年。**不要**买 `.cn`——解析到境外服务器需要额外备案，很麻烦。

### 5.2 在 Vercel 里绑定

1. Vercel 项目页 → **Settings** → **Domains**
2. 输入你的域名，点 **Add**
3. Vercel 会告诉你加什么 DNS 记录，通常是：

   | 类型 | 名称 | 值 |
   | --- | --- | --- |
   | A | `@` | `76.76.21.21` |
   | CNAME | `www` | `cname.vercel-dns.com` |

4. 回到你买域名的网站，找到「DNS 解析」，把上面两条加进去
5. 回 Vercel 点 **Refresh**，等生效（通常几分钟到半小时）

生效后，用你自己的域名访问就是通的，国内朋友也能正常打开。

> 注意：绑域名后 HTTPS 证书由 Vercel 自动签发，不用自己弄。

---

## 常见问题

### 1. 部署成功，但提取一直失败 / 报「服务端访问 YouTube 超时」

云端服务器出口 IP 可能被 YouTube 判为机房流量。解决办法是给 Vercel 配一个出口代理：

1. Vercel 项目页 → **Settings** → **Environment Variables**
2. 新增一条：
   - **Key**：`PROXY_URL`
   - **Value**：你的代理地址，形如 `http://用户名:密码@主机:端口`
3. 保存后到 **Deployments** 页面，对最新部署点 **Redeploy**

**这个地址必须是公网可达的**。填 `127.0.0.1:xxxx` 无效——云服务器访问不到你家电脑上的代理客户端。

配完再试。如果你没有可用的代理服务，也可以先在本地跑着用（双击 `start.bat`）。

### 1b. 报 `POT_REQUIRED`「YouTube 要求人机校验」，但别的视频又能提取

**这是预期内的，不是故障**。云端出口对部分「高风控视频」会被要求人机校验，重试无效。
完整实测数据与四种已排除的解法见 **4.5 云端的能力边界**。

处理方式三条，按推荐度排：

1. **上本机中继**（推荐，一劳永逸）—— 见 **4.6**，让云端借你家宽带的出口取数
2. **配 `PROXY_URL`** 换一个公网可达的住宅代理
3. **临时应付**：换一个视频，或自己在电脑上双击 `start.bat` 用本机模式（100% 成功）

### 1c. 页面上出现一句英文的 `...invalid or incomplete response to Cloudflare`

原文形如：

```
The origin web server returned an invalid or incomplete response to Cloudflare.
This typically indicates the origin is overloaded or misconfigured.
```

**这句不是 YouTube 说的，是 Cloudflare 说的，而且它掩盖了真实原因。**
它说明请求已经从云端到了隧道，但隧道回源这一环没给出有效响应。

按「中继那一段的 `warning` 措辞」对照处理：

| 页面/返回里的线索 | 含义 | 怎么办 |
| --- | --- | --- |
| 单词 `Cloudflare` 出现在**报错正文**里 | 本机那份服务是**旧代码**（改过了没重启） | 关掉 `relay.bat` 窗口重新双击。原理见 4.6 的限制⑥ |
| `warning` 说「回源失败」 | 隧道在，但本机服务没应答 | 确认 `relay.bat` 窗口还开着、没被 Ctrl+C |
| `warning` 说「网络不通」 | 本机服务活着，但它自己上不了 YouTube | **看你的代理客户端开着没** —— 代理一关，本机取数就全废 |
| `warning` 说「隧道没连上」 | 本机隧道进程掉了 | 重新双击 `relay.bat`，并把新地址填回 `RELAY_URL` |
| `warning` 说「地址返回 404」 | `RELAY_URL` 是上一次隧道的旧域名 | 更新 `RELAY_URL` 后 Redeploy |
| `warning` 说「令牌不匹配」 | 两处 `RELAY_TOKEN` 不一致 | 核对 Vercel 的 `RELAY_TOKEN` 与 `relay.bat` 打印的是否同一个 |

> 正常版本下，**报错正文里绝不该出现 `Cloudflare`**。我们的中文提示里可能会提到
> 「Cloudflare 隧道」这个词，但那是解释性文字，出现在 `warning` 里而不是报错正文。
>
> 排查顺序建议：**先看你本机的代理客户端是不是活着**（这是最常见的坑，
> 而且它会伪装成「YouTube 又不行了」），再去看 `relay.bat` 的窗口在不在。

### 2. 翻译一直超时

YouTube 的按需翻译要现场生成，实测要 **20~46 秒**，这是平台本身的延迟。

- 默认已把含翻译的预算设为 55 秒，正常情况下够用
- 如果还是超时，到 Vercel 项目 **Settings → Functions** 打开 **Fluid Compute**（免费计划也能开），函数时长上限会从 60 秒提到 300 秒
- 翻译失败不会影响原文——页面会返回原文字幕并给出一条黄色提示，等十几秒点重试即可

### 3. 提示「请求过于频繁」

服务对单个 IP 做了限流（默认 20 次/分钟），防止被刷爆导致 YouTube 封禁出口 IP。等一分钟即可。

想调整：在 Vercel 加环境变量 `RATE_LIMIT_MAX`，改成你想要的数值。

### 4. 想让服务只给特定的人用

在 Vercel 加环境变量 `ACCESS_CODE`，设一个口令。之后访问需要带上 `?code=你的口令`。

### 5. 想改了代码重新部署

改了本地代码后：

```bash
cd /d E:\workbuddyspace1\youtube-transcript
git add -A
git commit -m "说明这次改了什么"
git push
```

Vercel 会检测到推送，**自动重新部署**，不用再去点按钮。

### 6. 想下线

Vercel 项目页 → **Settings** → 拉到底 → **Delete Project**。网址立刻失效。

### 7. 部署时报错（Build Failed）

按报错关键词对照处理，改完 commit + push 即可自动重新部署：

| 报错关键词 | 原因与处理 |
| --- | --- |
| `maxDuration` 超出限制 | 你的项目没启用 Fluid Compute，上限是 60 秒。把 `vercel.json` 的 `maxDuration` 改成 `10` |
| `memory` 无法设置 | 项目已启用 Fluid Compute，此时不允许在这里配内存。删掉 `vercel.json` 里的 `memory` 字段（本项目配置里已经移除） |
| `No Output Directory named "public"` | `public/` 没推上去。执行 `git ls-files public/`，应该看到 3 个文件（`index.html`、`styles.css`、`app.js`） |

### 8. 页面报 500 · FUNCTION_INVOCATION_FAILED

**现象**：部署成功，但打开网址是 Vercel 的英文错误页
（`This page is temporarily unavailable / A function needed by this page failed`）。
关键特征：**连不存在的路径（如 `/nope`）也返回 500 而不是 404**。

**根因**：项目根目录的 `server.js` 是**本地启动器**（常驻 HTTP 服务），
Vercel 会把它当成 Serverless 函数入口，生成一个「兜底函数」接管所有非静态路由。
它没有 `(req, res)` 处理器，一被调用就崩 —— 连 `/api/health` 都走不到。

容易误判的地方：**静态文件优先级高于函数**，所以 `/app.js`、`/index.html`
这类能正常返回 200，看起来像「只有首页坏了」，实际是所有动态路由全崩。

**修复**（本项目已处理，重搭时务必保留这三项）：

| 文件 | 改法 |
| --- | --- |
| `.vercelignore` | 加入 `server.js` —— 云端用不到本地启动器 |
| `package.json` | 删掉 `"main": "server.js"` —— 消除函数入口线索 |
| `vercel.json` | 显式声明 `"framework": null`，并加 `rewrites` 让 `/` 指向 `/index.html` |

排查这类问题的通用手法：**拿一个必然不存在的路径去请求**。
正常站点返回 404，若返回 500 或别的错误页，就说明有兜底路由在截胡。

### 9. 页面上出现「本地运行」字样

说明前端没读到云端标识。访问 `你的网址/api/health` 看看 `mode` 是不是 `public`——若不是，多半是部署的还是旧代码，重新 push 一次即可。

---

## 环境变量速查表

都是可选的，按需在 Vercel 的 **Settings → Environment Variables** 里添加：

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `RELAY_URL` | 空 | **本机中继地址**，如 `https://xxx.trycloudflare.com`。与 `RELAY_TOKEN` 配套使用，详见 4.6。这是解决 `POT_REQUIRED` 的推荐方案 |
| `RELAY_TOKEN` | 空 | 中继令牌。运行 `relay.bat` 时会打印出来，抄进这里即可。**两个都填才会启用中继** |
| `RELAY_TIMEOUT_MS` | 50000 | 转发到中继的超时上限（毫秒）。中继超时后会自动降级为云端直连 |
| `PROXY_URL` | 空 | 出口代理。方案 ② 用，需公网可达 |
| `ACCESS_CODE` | 空 | 设置后需要口令才能访问 |
| `RATE_LIMIT_MAX` | 20 | 单 IP 每分钟最大请求数 |
| `CACHE_TTL_MS` | 21600000 | 结果缓存时长（6 小时） |
| `REQUEST_TIMEOUT_MS` | 25000 | 单次提取超时 |
| `TRANSLATE_TIMEOUT_MS` | 55000 | 含翻译的整体超时 |
| `PUBLIC_MODE` | 云端自动为 1 | 公开部署模式 |
| `ALLOW_PROXY_CONFIG` | 云端自动为 0 | 是否允许访客改出口代理，**公开部署务必保持 0** |
| `RELAY_MODE` | 本机自动开启 | 本机侧是否以中继模式运行。`relay.bat` 已自动带 `--relay`，无需手填 |

---

## 上线后你需要知道的事

**免费额度**：Vercel 免费计划每月 100 GB 流量、100 万次函数调用，个人分享完全够用。字幕结果有 6 小时 CDN 缓存，重复请求不会打到函数上。

**用途限制**：Vercel 免费计划官方限定**非商业用途**。自己用、免费分享没问题；如果要在上面挂广告或收费，需要升级到 Pro。

**安全和隐私**：服务不收集任何用户数据，也不存访问日志。但请注意——这是**公开服务**，任何拿到网址的人都能用。

**出口 IP 风险**：云服务器的 IP 是共享的，如果被大量滥用，可能被 YouTube 临时限流。限流机制就是为了降低这个风险。

---

## 出问题了怎么办

把这两样东西发给我，我能直接定位：

1. 页面上显示的完整错误提示（或浏览器里 `/api/health` 的返回内容）
2. Vercel 项目页 → **Deployments** → 点最新那条 → **Functions** 标签页里的日志
