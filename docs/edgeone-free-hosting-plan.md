# Nooj Log · EdgeOne Pages 免费托管方案（零服务器）

> 文档日期：2026-10-18 ｜ 适用对象：nooj-log 静态博客（域名 nooj.cn）
> 额度数据来源：EdgeOne Pages 官方「限制与配额」与「定价」页面（2026-10-18 检索）。官方明确免费版**永久提供**，但配额在商业化后可能调整，请以控制台公告为准。

---

# 第一部分 · 可行性讨论

## 1. 总体结论

**完全可行，且是当前个人技术博客的最优零成本方案之一。** 三个核心判断：

1. **流量维度没有硬上限。** EdgeOne Pages 免费版不限安全加速流量、不限请求数，含 DDoS 防护与免费 SSL。个人博客的常规量级（数百至数万 PV/月）距离任何瓶颈都有三个数量级的余量，被突发刷量也不会中断、不产生费用。
2. **"不部署服务器"也能做内容后台管理。** 采用「内容即代码」的 Git 型 CMS（Sveltia CMS），管理后台本身是托管在站点上的一个静态页面；OAuth 鉴权由 EdgeOne Pages 自带的 Edge Functions 承担——整条链路没有一个需要你购买、运维、续费的服务器。
3. **真正的约束不在流量，而在构建次数、文件体积、函数配额。** 这三项都有明确数字和明确的超额表现，且对个人使用都有很大余量（详见 2.3）。

需要提前接受的两个非技术约束：① nooj.cn 若要覆盖中国大陆访客需完成 ICP 备案，否则只能走海外节点；② 免费版配额商业化后可能调整——本方案天然对冲了这一点：内容全部在 Git 仓库，无厂商锁定，最坏情况整体迁移只需改 DNS。

## 2. 问题一：免费托管能承受多少流量，超额会怎样

### 2.1 免费版官方配额（2026-10 查证）

| 类别 | 项 | 免费版额度 |
|---|---|---|
| 流量 | 安全加速流量 | **不限量** |
| 流量 | 安全加速请求数 | **不限量** |
| 安全 | DDoS 防护 / 免费 SSL | 包含 / 支持（200 个自定义域名） |
| 构建 | 构建次数 | 500 次/月 |
| 构建 | 并发构建 / 单次时长 / 算力 | 1 / ≤20 分钟 / 4 核 6GB |
| 项目 | 项目数 / 单文件 / 文件数 / 总存储 | 40 / 25MB / 20,000 / 5GB |
| 函数 | Edge Functions | 300 万次/月，CPU 300 万 ms/月 |
| 函数 | Cloud Functions | 100 万次/月，50 万 GB-s/月 |
| 存储 | KV / Blob | 各 1GB |
| 其他 | Agents/Sandbox 内存时长、内置模型 | 各 10 万 GB-s/月、50 万 token/月 |

官方定价页原话：免费版**永久提供**；"在推出收费版之前，即使超出免费版的用量限制也不会中断服务，平台会监控异常流量和滥用行为"；额度不足可提交工单申请提额。

### 2.2 流量量级测算

不计限意味着"能承受多少流量"要换个问法：**到什么量级你才会遇到别的墙？**

以本博客的页面体积估算（CSS/JS/字体/图片优化后约 0.3–1MB/次访问，取 1MB 上限保守估计）：

| 月访问量 | 月传输量（估算） | 免费版表现 |
|---|---|---|
| 1,000 PV | ≈ 1GB | 无感 |
| 10,000 PV | ≈ 10GB | 无感 |
| 100,000 PV | ≈ 100GB | 无感、不计费 |
| 1,000,000 PV | ≈ 1TB | 仍不计费、不中断 |

结论：个人博客常规量级距离"值得担心"有**三个数量级**余量；免费版自带基础 DDoS 防护，被扫描/刷量时站点不会先挂。真正会先撞到的墙，按个人博客使用频率排序是：

**构建次数 500/月 → 单文件 25MB → 文件总数 20,000 → 函数调用配额 → KV/Blob 1GB。**

### 2.3 达到限额或瓶颈时的具体表现

| 触及项 | 达到后的表现 | 应对 |
|---|---|---|
| 流量 / 请求数 | 不设限；仅"异常流量和滥用行为"会被监控处置 | 正常使用无感；勿用于违规分发 |
| 构建 500 次/月 | 商业化前宽松，超限优先保障稳定；未来可能构建失败或排队 | 合并提交；工单提额 |
| 并发构建 = 1 | 连续 push 会排队，后者等前者完成 | 错峰提交；本地验证后再 push |
| 单文件 >25MB / 文件 >2 万 / 总量 >5GB | **部署失败**（硬失败，有明确报错） | 媒体先压缩；大文件外链 |
| Edge/Cloud Functions 超额 | 函数调用直接报错，**无超额付费缓冲** | 读接口加缓存头；降级为静态 |
| KV / Blob 满 1GB | 写入失败 | 控制体量；定期清理 |
| 默认域名（*.edgeone.cool） | 国内网络下可能 401 / 访问受限，不宜长期对外 | 绑定自有域名 |

### 2.4 小结

对 Nooj Log：**流量不是风险项**。需要主动管理的只有三件事——发布节奏（构建次数）、图片纪律（文件体积）、函数用量（只有做了动态功能才相关）。

## 3. 问题二：不部署服务器，能否实现内容后台管理

### 3.1 先厘清"无服务器"的边界

本方案中"不部署服务器"= 不买 VPS、不运维服务器进程、不管安全补丁和备份。所有后端能力由托管服务提供：EdgeOne Pages（静态托管 + Functions + KV/Blob）、GitHub（代码托管 + OAuth + API），以及可选的第三方托管服务（如 Giscus）。这符合"完全不使用服务器"的诉求。

### 3.2 四条可行思路

#### 思路 A：Git 型 CMS（内容即代码）—— 推荐

- **形态**：`/admin` 是一个纯静态 SPA（Sveltia CMS，MIT 协议，Decap CMS 的现代继任者，约 300–500KB），直接部署在你的站点里；编辑内容时通过 Git 平台 API 把 Markdown/JSON 提交回仓库，仓库一有提交就触发 EdgeOne 自动构建发布。
- **鉴权**：GitHub 后端不支持浏览器端 PKCE，必须有一个服务端完成 OAuth code→token 交换。这个"服务端"用 EdgeOne Pages 的 Edge Function 实现（在免费额度内），client secret 存函数环境变量。备选：Cloudflare Workers 免费档（同样是零服务器托管）。
- **限制（必须知情）**：
  1. 编辑器需要有 GitHub 账号并授权；
  2. 媒体文件默认进 Git 仓库，受 5GB / 2 万文件 / 单文件 25MB 约束——图片须先压缩（建议 WebP、单张 ≤200KB），量大后应外链到 Blob 或对象存储；
  3. 每次发布消耗 1 次构建（500/月对单人绰绰有余）；
  4. Sveltia 目前仍是 beta（单维护者、无 LTS、小版本可能含破坏性变更）——但内容在 Git 里，随时可换 CMS 或回退纯静态，锁定风险低；
  5. 没有多用户角色/权限体系（单人博客无感，多作者时是硬伤）；
  6. 内容量到数千篇时，后台列表加载会变慢。
- **优点**：内容 100% 在自己仓库（可迁移、可本地构建、无厂商锁定）；后台 UI 免费开源；与静态站天然契合；草稿/审核可走 Git 分支 + PR。

#### 思路 B：SaaS Headless CMS（托管内容 API）

- **形态**：内容存第三方 CMS，站点构建时（或运行时）通过 API 拉取。
- **免费档实况（2026-10 检索，以官网为准）**：
  - Sanity：免费档约 3–20 个编辑席、10K 文档、10GB 资产、约 10 万–100 万 API CDN 请求/月，**硬上限，超限拦截而非超额付费**；Growth 档 $15/席/月起；
  - Contentful：免费档 5–10 成员、25K 记录、10 万 API 调用/月；**2025 年 4 月起免费档仅限非商业用途**；下一档 $300/月是断崖；
  - Strapi Cloud Free：1 个项目、1GB；Storyblok：1 用户、10 万 API/月；Prismic：1 用户、400 万 API/月。
- **限制**：免费条款可被单方变更（Contentful 2025.4 案例）；国内访问延迟；厂商锁定带来导出/迁移成本；超出免费档要么付费要么功能中断。
- **适用**：多人协作、非技术编辑、需要开箱即用的资产管理与实时预览。对 Nooj Log 目前属于过度设计。

#### 思路 C：EdgeOne 函数 + KV/Blob 自建轻量后端

- **形态**：内容 JSON 存 KV/Blob，Cloud Functions 提供 REST API + 鉴权，自写管理页 SPA；或只把高频小数据（近况、计数器、评论）动态化。
- **额度**：KV/Blob 各 1GB、Cloud Functions 100 万次/月、Edge Functions 300 万次/月——个人博客富余。
- **限制**：函数无状态、默认 30 秒（可配至 120 秒）；动态内容的 CDN 缓存与更新一致性要自己设计（短 TTL 或构建后 purge）；鉴权、限流、反垃圾全自负；超函数配额即报错，无缓冲；后台 UI 工作量最大。
- **适用**：评论、点赞、表单、访问计数这类"小而动态"的功能。建议作为思路 A 的补充，不要一上来就自建全套 CMS。

#### 思路 D：本地/移动端编辑 + Git 工作流（无 Web 后台）

- **形态**：VS Code / Typora 本地写作 → git push → 自动部署；移动端用 Obsidian + Git 插件，或 GitHub 网页编辑器直接改。
- **限制**：需要本地环境；非技术撰稿人难上手；无富文本可视化编辑。
- **事实**：这是大量个人博主的终点方案——发布成本已经很低（一次 push ≈ 一次构建）。作为思路 A 之前的起步完全够用。

#### 周边功能的零服务器选型（顺带明确）

| 功能 | 推荐 | 说明 |
|---|---|---|
| 评论 | Giscus | 基于 GitHub Discussions，iframe 嵌入，免费无服务器；需公开仓库 + 开启 Discussions；评论者需 GitHub 账号 |
| 访问统计 | Microsoft Clarity / 百度统计 | 免费、无额度焦虑；EdgeOne 控制台另有基础流量观测 |
| 订阅 | 现有 RSS | 已生成 rss.xml，无需额外服务 |
| 表单/联系 | Edge Function + KV | 或第三方（Formspree 免费 50 条/月） |

### 3.3 对 Nooj Log 的推荐

单人博客、内容以文章+项目为主、已有 Git 工作流基础 → **思路 A（Sveltia CMS + EdgeOne Functions 做 OAuth）+ 思路 D 作为日常主力**。SaaS CMS 与自建后端留作未来多人协作或动态功能扩展时的选项。

## 4. 风险与非技术约束

1. **ICP 备案**：已备案域名才能享受中国大陆节点加速；不备案则仅海外节点，国内访客体验打折。nooj.cn 是 .cn 域名，建议尽早备案（或用全球站先跑起来）。
2. **免费额度政策变动**：官方承诺免费版永久提供，但配额"商业化后可能调整"。对冲方式 = 内容在 Git、无厂商锁定，最坏情况整体迁到 GitHub Pages / Cloudflare Pages 只需改 DNS。
3. **Sveltia beta 风险**：升级时锁定版本号；破坏性变更时随时可回退纯静态。
4. **默认域名对外分享受限**：正式运营必须绑定 nooj.cn。
5. **GitHub 连通性**：OAuth 代理函数尽量走全球节点；国内访客使用 Giscus 评论时，GitHub 登录可能不稳定（可接受，或后接自建评论）。

---

# 第二部分 · 详细方案

## 1. 目标架构

架构分两条链路，全部托管、零服务器：

- **读者链路**：访客 → EdgeOne CDN（全球/中国节点，不限流量）→ 静态页面。
- **作者链路**：`/admin`（Sveltia SPA）→ `/api/oauth`（Edge Function，持 client secret）→ GitHub API 提交内容 → 仓库提交触发自动构建 → 新版本覆盖上线。
- **数据分层**：文章/项目（低频变）走 Git + 静态构建；近况/计数/评论（高频小数据）可选 KV；媒体图片压缩后进 Git 或外链 Blob。

（架构图见下方示意图 1）

## 2. 内容模型改造（当前 data.js → 可 CMS 编辑）

当前内容集中在 `assets/js/data.js`。两个选项：

- **选项 1（零改动，立即上线）**：保持 data.js 不变，发布走本地编辑 + git push，或 GitHub 网页编辑器。适合现在。
- **选项 2（接入 CMS）**：一次性把 POSTS/PROJECTS 拆为 `content/posts.json`、`content/projects.json`；页面改为构建时由脚本生成 data.js（或运行时 fetch）；新增：
  - `admin/index.html` + `admin/config.yml`（Sveltia，file collections 指向上述 JSON， media_folder 指向图片目录）；
  - `functions/oauth/`（Edge Function：`/api/oauth/login`、`/api/oauth/callback`，用 GitHub client id/secret 换 token，`ALLOWED_DOMAINS` 限定你的域名）；
  - `config.yml` 的 backend 增加 `base_url` 指向该函数域名；
  - GitHub OAuth App 的回调地址填 `https://nooj.cn/api/oauth/callback`；client secret 存 EdgeOne 控制台的函数环境变量，不进仓库。

改造收益：浏览器里可视化增删改文章、自动生成提交信息、草稿走分支 PR。代价：一次性迁移脚本 + 维护一个 beta 依赖。

## 3. 部署与域名配置

1. **代码入库**：nooj-log 推送到 GitHub 仓库（用 Giscus 评论则需公开仓库）。
2. **连接 EdgeOne Pages**：控制台创建项目 → 关联仓库 → 纯静态无构建命令（输出目录为根）；若采纳选项 2，构建命令设为 `node build.js`（生成 data.js）。
3. **域名**：绑定 nooj.cn，按指引配 CNAME；免费 SSL 自动签发；中国大陆加速需完成 ICP 备案。
4. **OAuth 应用**：GitHub → Settings → Developer settings → New OAuth App，回调地址填函数域名。
5. **预览验证**：`edgeone pages deploy -e preview` 或 PR 预览环境，验证后再合入门。CLI 部署技能已就绪（`edgeone pages deploy`，需 CLI ≥ 1.2.30）。

## 4. 内容更新与发布流程

两条路径汇入同一条发布管线：

- **路径 1（日常主力）**：本地改 `content/*.json`（或 data.js）→ git push → 自动构建 → 分钟级上线。一次批量修改只算 1 次构建。
- **路径 2（浏览器后台）**：`https://nooj.cn/admin` → GitHub 授权 → 可视化编辑 → 保存即生成 commit → 同上自动构建上线。草稿可存分支提 PR，审核后合并。
- **路径 3（动态小数据，可选）**：Cloud Function 写 KV（近况/计数），前端 fetch；文章主体仍走静态构建。
- **回滚**：git revert 后重新构建，历史版本天然可回退。
- **本地校验**：`python -m http.server` 起本地服务预览后再提交。

（发布流程图见下方示意图 2）

## 5. 免费额度内最佳实践

### 构建次数（500 次/月）
- 本地攒批修改、一次 push；不要每次保存都推。
- 仅改杂项时可在提交信息加跳过标记，或临时关闭自动构建。
- 500 次 ≈ 每天 16 次发布，个人用途不可能触顶。

### 文件与存储（25MB / 2 万文件 / 5GB）
- 图片统一转 WebP，单张 ≤200KB；>25MB 的媒体一律外链（Blob 或对象存储免费档）。
- 视频不要进仓库/部署包。
- 定期关注仓库体积（`git count-objects -vH`）。

### 函数（EF 300 万 / CF 100 万次每月）
- OAuth 代理这类低频操作用 Edge Functions；读接口一律带 `Cache-Control`，让 CDN 摊薄函数调用。
- 写接口（评论/表单）加简单频率限制与鉴权。
- 函数内不存状态；密钥只进环境变量。

### KV / Blob（各 1GB）
- KV 只放小 JSON（配置、近况、计数器）；文章正文不要进 KV。
- Blob 放压缩后的媒体；设清理策略。

### 监控与告警
- 控制台每周看一次构建次数、函数调用、带宽曲线。
- 构建失败配邮件或企业微信 Webhook 告警（可用 Edge Function 实现，零成本）。

### 安全
- client secret、token 只存函数环境变量/本地 .env，绝不提交；`.edgeone/.token` 加入 .gitignore。
- `/admin` 与 `/api` 限定 `ALLOWED_DOMAINS`；函数接口验签 + 限流。
- 仓库公开前扫一遍密钥。

### 迁移预案
- 内容全在 Git：任意时刻可迁 GitHub Pages / Cloudflare Pages / Vercel，改 CNAME 即完成。
- 定期打 tag；重大改版先在 preview 环境验证。

## 6. 分阶段实施路线

| 阶段 | 内容 | 风险 |
|---|---|---|
| 0（今天） | CLI 直接部署当前目录，默认域名验证 | 无 |
| 1 | GitHub 仓库 + 自动构建 + 绑定 nooj.cn（备案） | 无 |
| 2 | 内容文件化 + /admin + OAuth 函数（选项 2） | 低（preview 验证） |
| 3（按需） | Giscus 评论、KV 动态模块、访问统计 | 低 |

每一阶段独立可用、可随时停止，不影响线上。

## 7. 决策记录

- 选 EdgeOne Pages 而非 GitHub Pages：国内访问质量 + 不限流量 + 可放函数（OAuth 代理、未来的动态功能）。
- 选 Sveltia 而非 SaaS CMS：内容主权、零边际成本、单人维护够用。
- 选 Giscus 而非自建评论：零服务器、零维护。
- 保留纯静态构建为主：文章内容不需要数据库，静态 = 最快 + 最便宜 + 最抗刷量。

---

## 8. 实施落地状态（2026-10-18）

方案第二部分的全部内容已落地到代码，剩余仅需账号侧操作（登录 EdgeOne、注册 OAuth App、填环境变量）。现状如下：

| 方案项 | 状态 | 位置 / 说明 |
|---|---|---|
| 内容即代码：`content/*.json` | ✅ 已实施 | `content/posts.json`（7 篇）、`content/projects.json`（3 个）、`content/site.json`（预留） |
| 数据加载兼容层 | ✅ 已实施 | `assets/js/content.js`：fetch JSON 优先 → `file://` 回退 `assets/js/data.js` → toast 报错；回退数据由 `scripts/gen-data.mjs` 生成 |
| `/admin` 可视化后台 | ✅ 已实施 | `admin/`：Sveltia CMS 本地自托管（`assets/vendor/sveltia-cms.js`，2.5MB，国内免 CDN 依赖）+ CDN 双兜底 + 品牌启动层 + `nooj-brand.css` 视觉血缘 |
| OAuth 代理（零服务器） | ✅ 已实施 | `edge-functions/api/oauth/{auth,callback,success}.js`：state cookie 防 CSRF、ALLOWED_DOMAINS 白名单、品牌化过渡页 postMessage 交付 token、opener 丢失时 sessionStorage 兜底 |
| Giscus 评论 | ✅ 已实施 | `post.js` 挂载 + 明暗主题联动（postMessage）；未配置时降级提示，不渲染 |
| 部署配置 | ✅ 已实施 | `edgeone.json`（安全头 + HTML 不缓存 + assets 强缓存 + content 60s 缓存）、`robots.txt`、`sitemap.xml`（脚本生成）、`.gitignore`（.edgeone/.token 已排除） |
| 操作手册 | ✅ 已实施 | `README.md`：本地预览、两条发布路径、四阶段部署、OAuth 配置、Giscus 接入、额度最佳实践 |
| CDP 回归验证 | ✅ 已通过 | 12 组用例零页面错误：渲染/筛选/搜索/404/暗色/移动端/file:// 回退/toast/后台加载 |

### 仍需人工完成（账号侧，代码已就绪）

1. **阶段 0**：`npm i -g edgeone@latest` → `edgeone login` → `edgeone pages deploy -n nooj-log`
2. **阶段 1**：push GitHub → 控制台连仓库自动构建 → 绑定 nooj.cn（大陆加速需 ICP 备案）
3. **阶段 2**：注册 GitHub OAuth App（回调 `<域名>/api/oauth/callback`）→ 改 `admin/config.yml` 的 `repo`/`base_url` → `edgeone pages env add` 三变量 → 访问 `/admin/` 验证登录
4. **阶段 3**（可选）：按 README 接入 Giscus；内容超 50 篇后引入 Pagefind

### 实施中发现并修复的问题

- Sveltia CMS `date` widget 已废弃 → 改 `datetime` + `type: date`（配置错误会导致整个后台无法加载）
- 首页精选项目不足 2 个时不再补位 → 改 featured+普通拼接后截取
- 瞬间滚动（End 键/锚点）导致中间区块 reveal 不触发 → `main.js` 增加 scroll 兜底扫描（已滚过视口的直接显示）
- 后台品牌启动层遮挡 CMS 界面 → 改 MutationObserver 监听 `.app-shell` 出现即隐藏
