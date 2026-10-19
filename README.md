# Nooj Log

> 代码与生活，皆有迹可循。
> 记录开发踩坑、项目实践，以及日常里所有折腾与细碎生活。

纯静态个人技术博客：零依赖、零构建、零追踪器。托管于 **EdgeOne Pages 免费版**（不限加速流量），配 **Sveltia CMS** 浏览器可视化后台（GitHub OAuth，零服务器）。

- 线上：<https://nooj.cn>
- 后台：<https://nooj.cn/admin/>（需配置，见下文）
- 订阅：`/rss.xml` · 站点地图：`/sitemap.xml`

---

## 目录结构

```
nooj-log/
├── index.html / posts.html / post.html / projects.html / about.html
├── admin/                      # Sveltia CMS 后台（可视化编辑）
│   ├── index.html              #   入口（本地自托管 CMS 资源 + CDN 兜底）
│   ├── config.yml              #   集合与字段定义（部署前改 repo/base_url）
│   └── nooj-brand.css          #   品牌样式注入（与前台视觉血缘）
├── content/                    # 内容唯一事实源（JSON）
│   ├── posts.json              #   全部文章
│   ├── projects.json           #   全部项目
│   └── site.json               #   站点设置（可选，预留）
├── edge-functions/api/oauth/   # GitHub OAuth 代理（Edge Functions，零服务器）
│   ├── auth.js                 #   /api/oauth/auth     跳转 GitHub 授权
│   ├── callback.js             #   /api/oauth/callback 换 token + 品牌过渡页
│   └── success.js              #   /api/oauth/success  兼容兜底
├── assets/
│   ├── css/  tokens / base / components   设计系统三层
│   ├── js/   content / main / home / posts / post / projects
│   ├── vendor/sveltia-cms.js   # CMS 本地副本（国内访问稳定）
│   └── data.js                 # file:// 本地预览回退数据（脚本生成，勿手改）
├── media/uploads/              # 后台上传的图片
├── scripts/gen-data.mjs        # content/*.json → data.js + sitemap.xml
├── docs/                       # 方案文档（托管额度、UI 设计选型）
├── edgeone.json                # EdgeOne Pages 项目配置（缓存/安全头）
├── robots.txt / sitemap.xml / rss.xml / favicon.svg
└── .gitignore
```

## 本地预览

```bash
# 方式一：任意静态服务器（推荐，走 content/*.json 真实数据）
python -m http.server 8901
# 打开 http://127.0.0.1:8901/

# 方式二：直接双击 index.html（file:// 协议）
# fetch 不可用，自动回退到 assets/js/data.js，内容一致
```

后台本地预览：先 `python -m http.server`，再访问 `/admin/`。
本地环境下 OAuth 回调域名不匹配，**GitHub 登录在本地不可用**——本地只验证界面与字段；
登录流程需部署后验证（见「阶段 2」）。

---

## 内容更新与发布流程

内容唯一事实源是 `content/*.json`，两条编辑路径汇入同一条发布管线：

```
本地编辑 content/*.json ──┐
                          ├─→ git push ──→ EdgeOne 自动构建 ──→ CDN 分发（全球）
/admin 后台保存 ───────────┘     （约 1 分钟生效）
```

### 路径 A：本地 / Git 工作流（日常推荐）

1. 编辑 `content/posts.json`（在 `posts` 数组里加一项）或 `content/projects.json`
2. 运行 `node scripts/gen-data.mjs`（同步 file:// 回退数据与 sitemap）
3. `git commit && git push` → 自动部署

### 路径 B：`/admin` 可视化后台（移动端/非技术场景兜底）

部署并配置 OAuth 后，浏览器打开 `/admin/`，GitHub 登录即可：
文章 / 项目的新增、修改、删除都走表单；保存即提交到仓库并触发构建。
**注意**：每次保存消耗 1 次构建配额（免费 500 次/月，个人绰绰有余）。

### 新增一篇文章的字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | URL 用 `post.html?id=xxx`，小写字母/数字/连字符，发布后勿改 |
| `title` | string | 标题 |
| `cat` | string | `dev` 开发折腾 / `project` 项目展示 / `life` 生活日常 |
| `date` | string | `YYYY-MM-DD`，列表按日期倒序自动排序 |
| `read` | number | 预计阅读分钟数 |
| `tags` | string[] | 标签数组 |
| `excerpt` | string | 摘要 |
| `content` | string | 正文，Markdown 与 HTML 标签可混排 |

---

## 部署（EdgeOne Pages 免费版，四阶段）

> 额度速览：不限加速流量与请求数；构建 500 次/月；单文件 ≤25MB、
> 文件数 ≤2 万、总量 ≤5GB；Edge Functions 300 万次/月。
> 完整讨论见 `docs/edgeone-free-hosting-plan.md`。

### 阶段 0 · CLI 直接部署（5 分钟验证）

```bash
npm install -g edgeone@latest        # CLI ≥ 1.2.30
export PAGES_SOURCE=skills
edgeone login --site china           # 或 --site global；按需选择站点
edgeone pages deploy -n nooj-log     # 首次创建项目
```

部署成功后 CLI 会输出 `EDGEONE_DEPLOY_URL`（含鉴权参数，**必须完整复制**）。
该链接用于快速验证；国内长期运营请继续阶段 1。

### 阶段 1 · GitHub 仓库 + 自动构建 + 绑定 nooj.cn

1. 把本目录 push 到 GitHub 仓库（如 `nooj-blog/nooj-log`）
2. EdgeOne 控制台 → Pages → 创建项目 → **连接 Git 仓库** → 选择仓库
   （`edgeone.json` 已预置构建设置，控制台会自动读取）
3. 构建部署配置保持默认（纯静态，无构建命令）；Node 版本 22.11.0
4. 项目设置 → 域名管理 → 绑定 `nooj.cn`
   - **中国大陆节点加速需 ICP 备案**；未备案可先用国际节点或默认域名
5. 之后每次 `git push` 自动构建发布，无需再跑 CLI

### 阶段 2 · 接入 `/admin` 后台（GitHub OAuth，零服务器）

**a. 注册 GitHub OAuth App**（Settings → Developer settings → OAuth Apps）

| 字段 | 值 |
|---|---|
| Homepage URL | `https://nooj.cn` |
| Authorization callback URL | `https://nooj.cn/api/oauth/callback` |

创建后复制 **Client ID**，点 **Generate a new client secret** 复制 **Secret**。

**b. 修改两处配置**

- `admin/config.yml`：`backend.repo` 改为你的 `owner/repo`；`backend.base_url` 与 `site_url` 改为 `https://nooj.cn`
- 提交并 push（触发一次部署）

**c. 配置函数环境变量**（secret 只进环境变量，绝不写进仓库）

```bash
edgeone pages env add GITHUB_CLIENT_ID       <你的 Client ID>
edgeone pages env add GITHUB_CLIENT_SECRET   <你的 Client Secret>
edgeone pages env add ALLOWED_DOMAINS        nooj.cn,www.nooj.cn
# 可选：公开仓库可收紧 scope
edgeone pages env add OAUTH_SCOPE            public_repo
```

**d. 验证**：打开 `https://nooj.cn/admin/` → GitHub 登录 → 应进入后台界面，
能看到「文章 / 项目」两个集合。保存一篇文章，约 1 分钟后线上生效。

> 故障速查：函数 404 → 确认 EdgeOne 控制台函数目录识别的是 `edge-functions`
> （旧版平台要求 `functions/`，把目录改名即可）；401/回调失败 →
> 检查 callback URL 与 `base_url` 完全一致、环境变量已保存、域名已备案且解析正常。

### 阶段 3 · 按需增强（评论 / 搜索）

- **Giscus 评论**：见下节，零服务器
- **搜索升级**：内容量超过 ~50 篇后可引入 Pagefind（构建期索引，仍免费额度内）

---

## 接入 Giscus 评论

评论区基于 GitHub Discussions，零服务器、免费。步骤：

1. 选一个 **公开仓库** 作为讨论载体（可用博客仓库本身或新建 `nooj-log/comments`）
2. 仓库 Settings → General → Discussions 勾选开启
3. 安装 [giscus app](https://github.com/apps/giscus) 授权该仓库
4. 打开 <https://giscus.app> 输入仓库名，页面会生成 `data-repo-id` / `data-category-id`
5. 在 `post.html` 的 `<script src="assets/js/post.js"></script>` 之前插入：

```html
<script>
  window.NOOJ_GISCUS = {
    repo: "nooj-blog/comments",
    repoId: "R_kgDOxxxxxx",
    category: "Announcements",
    categoryId: "DIC_kwDOxxxxxx",
    mapping: "pathname"
  };
</script>
```

未配置时评论区自动显示降级提示，不影响正文。主题切换已做联动（明/暗同步）。

---

## 免费额度最佳实践

| 资源 | 免费额度 | 本站用法与建议 |
|---|---|---|
| 加速流量 / 请求 | 不限量 | 个人博客量级余量极大；异常滥用才被监控 |
| 构建次数 | 500 次/月 | **攒批修改一次 push**；≈每天 16 次发布，个人用不完 |
| 单文件 / 总量 | 25MB / 2 万文件 / 5GB | 图片统一 WebP、单张 ≤200KB；视频大媒体外链对象存储 |
| Edge Functions | 300 万次/月 | OAuth 低频操作用；读接口已加 CDN 缓存摊薄 |
| KV / Blob | 各 1GB | 暂未使用；近况/计数类小数据可按需入 KV |

**安全约定**：
- `GITHUB_CLIENT_SECRET` 只存在于 Pages 函数环境变量，仓库里任何文件不出现
- `.edgeone/.token`（CLI 账号级 token）已加入 `.gitignore`，绝不提交
- `ALLOWED_DOMAINS` 限定后台登录来源域名，防 OAuth 代理被滥用
- 内容全在 Git，无厂商锁定——最坏情况迁往 GitHub Pages / Cloudflare Pages 只需改 DNS

---

## 设计系统速查

- **三层 CSS**：`tokens.css`（变量）/ `base.css`（重置排版）/ `components.css`（组件）
  新组件必须复用语义变量，禁止写死颜色
- **主题**：`html[data-theme]` 切换，键 `nooj-theme`；`<head>` 内联脚本防首屏闪白
- **动效**：只动 `opacity/transform`；`prefers-reduced-motion` 自动降级
- **「迹」母题**：点阵、虚线分隔、菱形结点、git 提交图——新组件沿用同一语言
- **入口动画**：`window.revealScan(root)` 供动态注入的 `.reveal` 元素补扫

## 相关文档

- `docs/edgeone-free-hosting-plan.md` — EdgeOne 免费托管可行性与详细方案
- `docs/ui-design-and-oss-selection.md` — 前后端 UI 设计与开源选型

## 许可

站点代码可自由取用。示例文章内容为占位，上线前请替换为你的真实记录。
