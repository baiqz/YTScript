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
第 5 步  （可选）绑定自己的域名            约 10 分钟 + 域名费用
```

---

## 第 0 步：代码已就绪（我已完成）

你不用做任何事，但可以了解一下我已经准备好的东西：

| 文件 | 作用 |
| --- | --- |
| `vercel.json` | 告诉 Vercel：静态文件在 `public/`，接口函数在 `api/`，单次执行上限 60 秒 |
| `api/*.js` | 三个无服务器接口：提取文稿 / 健康检查 / 代理配置（末尾这个在云端会被自动封禁） |
| `public/` | 网页本体（HTML / CSS / JS） |
| `lib/` | 取数核心，被 `api/` 里的函数共用 |
| `.gitignore` | 已排除 `config.json` —— 里面有你的本机代理地址，**绝不能上传** |
| `package.json` | 零依赖，Vercel 不需要执行 `npm install` |

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
| `POT_REQUIRED` | 502 | YouTube 风控要求人机校验 | 等十几秒重试 |
| `TIMEOUT` | 504 | 服务端访问 YouTube 超时 | 这才是**真的**云端出口受阻，见下面常见问题第 1 条 |
| `FETCH_FAILED` | 502 | 所有客户端都没拿到任何响应 | 同上，属出口问题 |
| `RATE_LIMITED` | 429 | 单 IP 请求过快 | 等一会儿 |

**关键区分点**：`VIDEO_UNAVAILABLE` / `NO_CAPTIONS` / `BAD_URL` 都是**视频侧**的问题，服务端网络是好的 —— 这时去配 `PROXY_URL` 是白费功夫。只有 `TIMEOUT` 和 `FETCH_FAILED` 才是**出口侧**的问题。

自己复现一次很简单（把 `<你的域名>` 换成实际地址）：

```bash
curl -s "https://<你的域名>/api/transcript?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

看返回里的 `code`，对照上表。

> **踩过的坑**：早期版本无论什么原因失败都笼统提示「服务端暂时无法访问 YouTube」，
> 结果视频号错了也让人去查代理，白折腾。现已按上表分类。

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

配完再试。如果你没有可用的代理服务，也可以先在本地跑着用（双击 `start.bat`）。

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
| `PROXY_URL` | 空 | 出口代理。云端被风控时填这个 |
| `ACCESS_CODE` | 空 | 设置后需要口令才能访问 |
| `RATE_LIMIT_MAX` | 20 | 单 IP 每分钟最大请求数 |
| `CACHE_TTL_MS` | 21600000 | 结果缓存时长（6 小时） |
| `REQUEST_TIMEOUT_MS` | 25000 | 单次提取超时 |
| `TRANSLATE_TIMEOUT_MS` | 55000 | 含翻译的整体超时 |
| `PUBLIC_MODE` | 云端自动为 1 | 公开部署模式 |
| `ALLOW_PROXY_CONFIG` | 云端自动为 0 | 是否允许访客改出口代理，**公开部署务必保持 0** |

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
