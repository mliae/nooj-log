# Nooj Log 后台（/admin）

基于 [Sveltia CMS](https://github.com/sveltia/sveltia-cms)（MIT）——打开 `/admin/` 即可在浏览器里新增、修改、删除文章与项目，保存即提交回 GitHub 仓库并触发 EdgeOne Pages 自动构建。**全程零服务器**。

## 快速开始

1. 完成根目录 `README.md` 的「阶段 2 · 接入 /admin 后台」（注册 GitHub OAuth App + 配置环境变量）
2. 修改本目录 `config.yml` 顶部的 `backend.repo` 与 `base_url`
3. push 后访问 `<你的域名>/admin/`，用 GitHub 账号登录

## 本目录文件

| 文件 | 作用 |
|---|---|
| `index.html` | 后台入口；CMS 资源本地自托管（国内稳定），失败自动回退 jsDelivr / unpkg |
| `config.yml` | 集合与字段定义；新增字段改这里 |
| `nooj-brand.css` | 品牌样式注入（覆盖 Sveltia 的 CSS 变量，与前台视觉血缘） |

## 常见问题

- **登录没反应 / 一直转圈**：`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` 未配置，或 OAuth App 的回调地址不是 `<域名>/api/oauth/callback`
- **提示域名不允许**：环境变量 `ALLOWED_DOMAINS` 未包含当前访问域名
- **保存后线上没变**：等约 1 分钟（构建 + CDN 刷新）；`content/*.json` 的 CDN 缓存设置为 60 秒
- **想加新字段**（如文章封面图）：改 `config.yml` 对应字段，同步改 `assets/js/home.js` / `post.js` 的渲染与 `content/posts.json`
- **图片上传**：进入仓库 `media/uploads/`，公开路径 `/media/uploads/…`；单张建议 ≤200KB（WebP 优先）

## 本地能做什么、不能做什么

- 能：`python -m http.server` 后访问 `/admin/` 查看界面与字段（只读缓存数据不完整属正常）
- 不能：本地完成 GitHub 登录（回调域名不匹配）——登录流程必须部署后验证
