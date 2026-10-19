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
