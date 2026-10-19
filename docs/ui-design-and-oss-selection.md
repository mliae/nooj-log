# Nooj Log · 前后端 UI 设计与开源选型

> 文档日期：2026-10-18 ｜ 承接《EdgeOne Pages 免费托管方案》的架构结论：零服务器、内容即代码、Sveltia CMS 作 /admin 后台。
> 本文回答两个问题：前后端 UI 怎么设计；哪些开源项目可以直接用或借鉴。

---

## 1. 先厘清"前后端"在本项目中的含义

零服务器静态架构下，UI 分三层：

| 层 | 用户 | 形态 | 现状 |
|---|---|---|---|
| 前端 UI | 读者 | 博客站点（index / posts / post / projects / about） | 已建成，有完整设计系统 |
| 后端 UI | 作者 | `/admin` 内容管理后台（静态 SPA，非服务端页面） | 待建，推荐 Sveltia CMS |
| 接口体验 | 作者（无感） | 函数 API 的错误响应、OAuth 跳转、构建状态 | 待设计，最易被忽视 |

## 2. 前端 UI 设计要点（读者侧）

Nooj Log 已有设计系统（Editorial 杂志感 × 纸上终端）。后续迭代遵守五条原则：

1. **阅读即产品**：正文栏宽 680–720px、行高 1.75–1.8、段间距大于行距；代码块等宽 + 语言标签 + 一键复制（已实现）。
2. **「迹」母题一致**：点阵、虚线分隔、菱形结点只此一套语言；新增组件必须复用 `tokens.css` 变量，不引入第二套设计。
3. **性能即设计**：零框架零构建；图片 WebP + 懒加载；字体系统优先，Web 字体仅子集化用于标题。
4. **明暗双主题**：`data-theme` 切换 + `prefers-color-scheme`（已实现），新组件两套同时交付。
5. **移动优先**：375 / 768 / 1440 三档验证（已通过）。

### 可借鉴的开源项目（借模式，不搬代码）

| 开源项目 | 类型 | 值得借鉴 | 注意 |
|---|---|---|---|
| AstroPaper / Astro Erudite | 排版驱动主题 | 衬线大标题 + 等宽元信息的编辑感、归档/标签页结构——与本站定调最接近，重点参考 | 需按本站 token 重绘，勿直接套 |
| PaperMod（Hugo） | 极简博客主题 | 阅读优先的信息密度、无 JS 依赖的实现方式 | 技术栈不同，只借布局思路 |
| hexo-theme-Fluid | 中文博客主题 | 中文排版细节：标点悬挂、中英混排间距、暗色模式 | 功能偏重，按需取 |
| VitePress 默认主题 | 文档站 | TOC 交互、页内锚点、上下篇导航 | 偏文档感，博客场景需收敛 |
| Giscus | 评论组件 | GitHub Discussions 嵌入、跟随明暗主题 | 需公开仓库 + 开启 Discussions |
| Pagefind / FlexSearch | 静态搜索 | 免服务端全文搜索，可升级 posts.html 现有前端搜索 | 索引进构建流程，占构建时长 |
| medium-zoom / PhotoSwipe | 图片灯箱 | 文章图片点击放大 | 按需引入，控制体积 |
| LXGW 霞鹜文楷 / Noto Serif SC / JetBrains Mono | 开源字体 | 中文标题备选（文楷很有"纸上"气质）、等宽字体 | 体积大，子集化或仅标题用 |
| Lucide / Tabler Icons | 图标 | 统一线性风格 | 内联 SVG，勿引全量 |

## 3. 后端 UI 设计要点（作者侧 `/admin`）

七条原则：

1. **写作流优先**：打开即写——默认落在编辑器而非仪表盘；标题输入框自动聚焦；草稿自动保存（localStorage + Git 草稿分支）。
2. **视觉血缘一致**：直接复用前台 `tokens.css`（暖纸底、墨绿强调、衬线标题、等宽元信息）。后台应是"博客的一部分"，不像第三方工具。
3. **双栏编辑**：左 Markdown 源码（等宽）、右实时预览（读者视角渲染）；front matter（标题 / 日期 / 分类 / 标签 / 摘要 / 封面）全部表单化，不手写 YAML。
4. **状态可见**：顶栏常驻「草稿 / 已发布」状态、上次保存时间、字数；「保存草稿」与「发布」是两个明确动作。
5. **移动可用**：单手能发布——窄屏编辑器单栏 + 源码/预览 Tab 切换，保存发布按钮固定底栏。
6. **登录即 OAuth**：GitHub 登录（Edge Function 代理持有 client secret），无独立账号体系；登录态存 sessionStorage，不落盘。
7. **媒体管理**：拖拽上传 → 提示压缩为 WebP → 进仓库 `assets/` 或 Blob；上传失败给出明确原因（如超 25MB 红线）。

## 4. 后台 UI 的开源实现路线

### 路线一：Sveltia CMS（推荐，与托管方案一致）

- **是什么**：MIT 开源、纯浏览器端 Git CMS；`/admin` 一个 HTML + `config.yml` 即用，约 300–500KB。
- **设计特点**：双栏编辑 + 预览、表单化 front matter、移动友好、草稿分支 / PR 审核、媒体可存仓库或 S3 / R2 / Cloudinary 等。
- **限制**：beta 阶段（单维护者、无 LTS）；GitHub 后端必须有 OAuth 代理；无多人角色权限。
- **品牌化**：支持注入自定义 CSS——把前台 token 注入即可获得一致的视觉（见 `mockup-admin.svg` 布局）。

### 路线二：Decap CMS（备选）

- 兼容同一套 `config.yml`，文档与生态更老更多；但维护放缓、包体大（约 2MB）、同样需要 OAuth 代理。仅当 Sveltia 出问题时平移。

### 路线三：自建轻量后台（UI 完全自主，工作量最大）

编辑器组件开源选型：

| 组件 | 许可 | 特点 | 适合 |
|---|---|---|---|
| ByteMD | MIT | 字节开源，Svelte，轻量，插件化，有浏览器直引版 | 本站无构建栈，首选 |
| Vditor | MIT | 国产，功能全（大纲 / 多主题 / 脑图） | 想要开箱丰富的编辑器 |
| Cherry Markdown | Apache-2.0 | 腾讯开源，中文文档全，进阶功能多 | 后续要图表 / 协作 |
| Toast UI Editor | MIT | 双栏联动成熟稳定 | 稳健保守选择 |
| EasyMDE | MIT | 最轻量 | 只要纯 Markdown |
| tiptap / Editor.js | MIT | 块编辑 / 富文本 | 完全不想写 Markdown 时 |

若要做完整的列表 / CRUD 管理台（单人博客通常不需要）：Soybean Admin（naive-ui）、vue-element-admin、react-admin、refine 可作为交互模式参考。

OAuth 代理参考实现：`sveltia-cms-auth`（Cloudflare Worker 版）——移植为 EdgeOne Edge Function 约 150 行。

**建议**：单人博客直接路线一；只有出现明确瓶颈（如自动存 KV、图片批量管理、自定义发布流）再走路线三，且优先基于 ByteMD / Vditor 自建。

## 5. 后端"看不见的 UI"：接口与状态设计

- **OAuth 过渡态**：`/api/oauth/login` → GitHub → `/callback` 的等待页做成品牌化过渡页（墨绿 + 「正在授权…」），不要裸跳转或 404。
- **API 错误响应**：统一 `{ code, message }`，文案中文化、可行动（如「GitHub 授权已过期，请重新登录」而非 `401 Unauthorized`）。
- **限额与超时提示**：后台检测到 429 / 5xx 时 toast「服务繁忙，请稍后重试」，绝不静默失败。
- **构建状态回显**：保存后轮询部署状态，展示「构建中 → 已上线」；失败时给控制台日志链接。

## 6. 一致性约束（建议写入项目规范）

1. 任何新页面 / 组件必须使用 `assets/css/tokens.css` 变量，禁止硬编码颜色与字号。
2. 字体只允许三族：衬线（标题）/ 系统黑体（正文）/ 等宽（元信息、代码）。
3. 图标统一 Lucide 线性风格，24px 网格、1.5px 描边。
4. 明暗两主题同时交付，正文对比度 ≥ 4.5:1。
5. 动效只动 `opacity` / `transform`，时长 ≤ 300ms，尊重 `prefers-reduced-motion`。
6. 后台 UI 上线前过一遍移动端（375px）验收。

## 7. 许可与合规注意

- 优先 MIT / Apache-2.0；BSD / ISC 亦可；GPL 组件谨慎（博客场景尽量避免）。
- 引用主题 / 组件保留版权声明；字体遵守 SIL OFL。
- Sveltia / Decap 的内容始终在自己 Git 仓库，无厂商锁定——这是选它们而非 SaaS CMS 的核心原因。

## 8. 实施顺序建议

1. 前台先做两个低风险增强：Pagefind 搜索替换现有前端过滤、文章图片 medium-zoom（均可选，不影响主流程）。
2. 后台按托管方案阶段 2 部署 Sveltia，注入品牌 CSS，先用默认流程跑通「登录 → 编辑 → 发布」。
3. 收集两周真实使用中的痛点，再决定是否需要路线三自建。

---

## 9. 实施落地状态（2026-10-18）

前后端 UI 设计已按本文档落地：

| 设计项 | 落地位置 |
|---|---|
| 后台「写作流优先」布局 | `admin/index.html` + `admin/config.yml`（Sveltia CMS）：登录态进后台即见「文章 / 项目」集合，表单化 front matter（ID/标题/分类 select/日期/阅读时长/标签/摘要/markdown 正文），源码与预览双栏编辑器 |
| 前台视觉血缘注入后台 | `admin/nooj-brand.css`：覆盖 Sveltia CSS 变量（`--primary-color` 墨绿 `#2F6B4F` / 暗色 `#45C08D`、三族字体、聚焦环），后台跟随前台同一 `nooj-theme` 主题记忆 |
| 品牌启动层与失败兜底 | `admin/index.html`：点线「迹」logo + LOADING CMS… 动效；CMS 资源失败时显示品牌化降级指引（引导本地编辑 content/*.json），绝不裸奔浏览器报错 |
| OAuth 过渡页品牌化 | `edge-functions/api/oauth/callback.js`：授权成功/失败/CSRF 三种过渡页全部内联品牌样式（纸白/墨绿/点线 logo），postMessage 交付 token |
| 接口错误中文化 | `assets/js/main.js` 的 `NoojToast`（替代 alert）+ `content.js` 加载失败提示；OAuth 各类失败的过渡页文案 |
| 构建状态回显 | `admin/README.md` 与 `README.md` 明示「保存 → 提交 → 约 1 分钟生效」心智；CDN 对 `content/*.json` 设 60s 缓存保证发布后快速可见 |
| 编辑器选型（自建路线预留） | ByteMD / Vditor / Cherry Markdown 对比见第 5 节；当前直接采用 Sveltia（其内置编辑器即 rich markdown），自建路线作为未来瓶颈备选 |
| 前台 UI 原则 | 未改动，仍按第 1 节五原则执行；新增评论区沿用「迹」分隔语言（`components.css` 的 `.giscus-section`） |
