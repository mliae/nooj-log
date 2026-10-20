# Nooj Log 后台（/admin）

自建的单页后台（原生 ES Modules，零框架、零构建）。打开 `/admin/` 用 GitHub 登录，
即可在浏览器里新增、修改、删除文章；保存 = 提交回 GitHub 仓库 → EdgeOne Pages 自动构建。**全程零服务器**。

> 旧的 Sveltia CMS 入口保留在 `/admin/classic/`，仅作应急备用。
> 注意：classic 直接编辑 `content` 字段，不会更新 `md`——两边都写过之后，以新后台的 `md` 为准。

## 数据模型

每篇文章是 `content/posts/<id>.json`：

| 字段 | 说明 |
|---|---|
| `id` | 文章标识，即文件名（小写字母/数字/连字符） |
| `title` / `cat` / `date` / `read` / `tags` / `excerpt` | 元信息，与前台一致 |
| `draft` | 草稿标记；存在且为 true 时，构建脚本不把它编入任何公开产物 |
| `md` | 编辑源（写作页读写的就是它） |
| `content` | 由 `md` 渲染出的 HTML，前台直接读 |

标签与分类**不设独立存储**：后台从所有文章实时聚合出标签云与分类计数，
「改标签 = 改某一篇的 tags」，这与静态站的内容即代码哲学一致。

## 目录结构

| 路径 | 作用 |
|---|---|
| `index.html` | 后台入口（含首屏骨架与主题初始化） |
| `app.css` | 后台样式（复用 `assets/css/tokens.css` 的设计令牌） |
| `js/api.js` | GitHub 数据层：Contents API 单文件读写 + Git Trees API 批量删除（一次 commit）|
| `js/auth.js` | 登录态：弹窗走 `/api/oauth/auth`，token 存 localStorage |
| `js/store.js` | 内存状态：一次列目录 + 并发读全文，搜索/筛选/排序全在内存做 |
| `js/app.js` | 外壳与 hash 路由（`#/posts`、`#/posts/new`、`#/posts/<id>`）|
| `js/views/posts.js` | 文章列表：搜索 / 分类 / 标签筛选 / 点表头排序 / 勾选批量删除 |
| `js/views/editor.js` | 写作页：Vditor 即时渲染 + 右侧元信息面板 |
| `app/vendor/vditor/` | Vditor 3.x 本地自托管（已裁剪：只留 lute、highlight.js、图标、中英文案）|
| `app/vendor/turndown/` | 老 HTML 文章 → Markdown 的一次性兜底转换 |
| `classic/` | 旧 Sveltia 后台（应急） |

## 功能

- **列表页**：标题/分类/标签/日期/阅读全列展示；关键词搜索；按分类、标签筛选；
  点表头按标题、分类、日期、阅读排序；勾选多行批量删除（一次 commit，不刷请求）
- **写作页**：Vditor 即时渲染（Markdown 所见即所得）、字数统计、全屏、双栏预览；
  右侧面板管分类、日期、阅读时长（可自动估算）、摘要（可从正文生成）、标签 chips、
  链接 id（中文标题自动生成日期随机 id）、草稿开关
- **图片**：编辑器里直接粘贴/拖拽/点上传，落到 `media/uploads/`，正文自动插入相对路径
- **保存**：`Ctrl/Cmd + S`；未保存离开会拦截确认；重命名 id 时旧文件会一并清理

## 本地调试

```
python -m http.server 8899
# 访问 http://127.0.0.1:8899/admin/
```

登录弹窗走线上 `/api/oauth/auth`，本地域名不在回调白名单里——
本地联调用登录页折叠面板「手动填入 Token」粘一个 Personal Access Token（仅存本机）。

回归脚本：`.tmp-shots/run.mjs`（Edge headless + fetch 打桩，不触碰真实仓库）。

## 常见问题

- **登录没反应**：`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` 未配置，或回调地址不是 `<域名>/api/oauth/callback`
- **提示域名不允许**：环境变量 `ALLOWED_DOMAINS` 需包含当前访问域名
- **保存后线上没变**：等约 1 分钟（构建 + CDN 刷新）；`content/*.json` 缓存 60 秒
- **API 限流**：读走 raw.githubusercontent（CDN、不占配额），写走 API（5000 次/小时），正常写作用不完

## 二期：项目 / 媒体 / 系统设置 / 密码登录

- **项目管理**（`#/projects`）：`content/projects.json` 单文件数组的完整 CRUD，
  上移/下移即前台展示顺序，「精选」对应前台「进行中」标记；弹窗表单编辑
- **媒体库**（`#/media`）：仓库 `media/uploads` 与 S3 图床两个来源统一网格，
  搜索、复制链接、打开、删除；支持拖拽与多选上传，上传后链接自动复制
- **系统设置**（`#/settings`）：账号与安全、图床、仓库、维护四个分区

### 密码登录（不使用 GitHub）

- 首次启用：GitHub 登录 → 设置 → 账号与安全 → 创建密码（需同时保存一个有
  Contents 写权限的 Token，服务端 AES-GCM 加密后存 `admin/.pat.json`）
- 之后在登录页选「密码登录」，服务端校验 `admin/.auth.json` 里的 PBKDF2 哈希，
  签发 7 天 HttpOnly 会话 Cookie；内容读写全部经 `/api/data` 代理，浏览器不经手 Token
- 修改密码随时在设置里做；轮换仓库 Token 也在同一页

### 图床（S3 兼容）

- 支持 Cloudflare R2、Backblaze B2、阿里云 OSS（S3 兼容端点）、MinIO 等
- 配置写入 `admin/storage.json`，Secret 加密落盘（密钥来自服务端环境变量
  `SESSION_SECRET`，缺省复用 OAuth 的 client secret）；也可完全用环境变量
  `S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY` 接管
- 上传走预签名 URL 浏览器直传，需要在存储后台为本站域名配置 CORS（允许 PUT/GET/HEAD）
- 启用后，写作页与媒体库的图片直传对象存储，不再写入 Git 仓库

### 服务端函数

| 路由 | 文件 | 作用 |
|---|---|---|
| `POST /api/auth` | `edge-functions/api/auth.js` | 密码登录 / 会话 / 改密 / 令牌管理 |
| `POST /api/data` | `edge-functions/api/data.js` | 密码登录时代理仓库读写（限 content/ 与 media/）|
| `POST /api/storage` | `edge-functions/api/storage.js` | 图床配置 + SigV4 预签名 / 列举 / 删除 |

回归脚本：`.tmp-shots/run2.mjs`（二期 UI + 打桩接口）。

## 三期：说说（碎片流）

- **后台 `#/notes`**：上方一条快速输入（自动增高、Ctrl/⌘+Enter 发布、粘贴或拖拽传图、
  标签空格/逗号分隔、可置顶），下方时间线卡片（置顶/编辑/复制链接/删除）
- **数据源**：`content/notes.json` 单文件数组，源即产物（前台直接读）
  - 未发出的内容只暂存在本机 localStorage（`nooj_note_draft`），不进仓库、不跨设备
  - 每条字段：`id`（时间戳）、`date`（YYYY-MM-DD HH:mm）、`text`、`tags?`、`images?`、`pinned?`
- **前台 `notes.html`**：按月分组的时间线（「迹」点线母题）、标签筛选 + 搜索、
  图片灯箱、`notes.html#<id>` 可分享单条；首页「最近说」展示最新 5 条
- 回归脚本：`.tmp-shots/run3.mjs`（前台 13 项 + 后台发布/编辑/置顶/删除 16 项）
