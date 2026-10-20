#!/usr/bin/env node
/* ============================================================
   Nooj Log — 构建脚本
   数据流：
     content/posts/*.json      ← 每篇文章一个文件（CMS 后台管理，唯一事实源）
     content/projects.json     ← 项目（单文件）
     ↓ 本脚本聚合
     content/posts.json        ← 文章索引（只有元信息，不含正文；自动生成，勿手改）
     posts/<id>.html           ← 每篇文章直出的独立静态页（正文已在 HTML 里）
     assets/js/data.js         ← file:// 本地预览回退数据
     sitemap.xml / rss.xml     ← 搜索引擎收录与订阅

   为什么要直出：
     旧链路是 HTML → JS → fetch posts.json → 渲染，两次串行往返 + 一次
     JS 渲染才见到正文。直出后打开文章只是「一个 HTML 请求」，首字节即正文，
     断网/禁用 JS 也能读。

   触发方式：
     1) EdgeOne 构建时（edgeone.json 的 buildCommand）
     2) 本地手动：node scripts/gen-data.mjs
   ============================================================ */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderPostPage, esc } from "./render-post.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://i.ymao.me";

/* 分类元数据（与 assets/js/content.js、admin 后台保持一致） */
const CATS = {
  dev: { label: "开发折腾", cls: "dev" },
  project: { label: "项目展示", cls: "project" },
  life: { label: "生活日常", cls: "life" }
};
const catLabel = (c) => (CATS[c] ? CATS[c].label : c);
const catCls = (c) => (CATS[c] ? CATS[c].cls : "dev");

function readJson(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

/* ---------- 1) 聚合 content/posts/*.json → content/posts.json ---------- */
const postsDir = join(ROOT, "content/posts");
let posts = [];
let postIndex = [];

if (existsSync(postsDir)) {
  const files = readdirSync(postsDir).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    try {
      const p = JSON.parse(readFileSync(join(postsDir, f), "utf8"));
      /* 兼容两种写法：整篇对象，或被 { posts: [...] } 包裹 */
      const items = Array.isArray(p) ? p : p.posts ? p.posts : [p];
      items.forEach((it) => {
        if (!it || !it.id) return;
        /* 草稿只存在于后台，不进入任何公开产物 */
        if (it.draft) return;
        /* md 是后台的编辑源（写作页读取），前台只需要渲染好的 content，
           故此处剥离，避免公开产物白白多出一份正文。 */
        const pub = { ...it };
        delete pub.md;
        posts.push(pub);
      });
    } catch (e) {
      console.error("skip invalid post file: %s (%s)", f, e.message);
    }
  }
  /* 按日期倒序（同日按 id 稳定排序） */
  posts.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.id).localeCompare(String(b.id)));

  /* 索引只保留列表页要用的元信息。
     正文已经直出到 posts/<id>.html，索引里再存一份等于让访客
     每次打开列表都多下一份全文——这正是之前慢的一半原因。 */
  postIndex = posts.map((p) => ({
    id: p.id,
    title: p.title,
    cat: p.cat,
    date: p.date,
    read: p.read,
    tags: p.tags || [],
    excerpt: p.excerpt || ""
  }));

  writeFileSync(join(ROOT, "content/posts.json"), JSON.stringify({ posts: postIndex }, null, 2) + "\n", "utf8");
  console.log(
    "gen: content/posts.json  (%d posts from %d files, %s KB — 仅索引)",
    posts.length,
    files.length,
    (JSON.stringify({ posts: postIndex }).length / 1024).toFixed(1)
  );
} else {
  const legacy = readJson("content/posts.json");
  posts = (legacy && legacy.posts) || [];
  postIndex = posts;
  console.log("skip: content/posts/ 目录不存在，沿用现有 posts.json (%d posts)", posts.length);
}

const projects = readJson("content/projects.json");

/* ---------- 说说（碎片流，单文件数组） ----------
   源即产物：前台直接读 content/notes.json。
   这里只做两件事——滤掉标记为 draft 的条目（防手滑），
   以及给出 file:// 预览用的回退数据。 */
const notesRaw = readJson("content/notes.json");
const notes = ((notesRaw && notesRaw.notes) || [])
  .filter((n) => n && n.id && !n.draft)
  .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
if (notesRaw) console.log("gen: content/notes.json  (%d notes)", notes.length);

/* ---------- 2) 生成 assets/js/data.js（file:// 回退） ---------- */
if (posts.length && projects) {
  const banner =
    "/* ============================================================\n" +
    "   Nooj Log — 本地预览回退数据（由 scripts/gen-data.mjs 生成，请勿手改）\n" +
    "   线上以 content/*.json 为唯一事实源；仅当浏览器以 file:// 协议\n" +
    "   直接打开页面、fetch 不可用时，content.js 才会回退到本文件。\n" +
    "   ============================================================ */\n\n";
  const body =
    "window.NOOJ_DATA = {\n" +
    "  posts: " + JSON.stringify(postIndex, null, 2) + ",\n" +
    "  projects: " + JSON.stringify(projects.projects, null, 2) + ",\n" +
    "  notes: " + JSON.stringify(notes, null, 2) + "\n" +
    "};\n";
  writeFileSync(join(ROOT, "assets/js/data.js"), banner + body, "utf8");
  console.log("gen: assets/js/data.js  (posts: %d, projects: %d, notes: %d)", postIndex.length, projects.projects.length, notes.length);
} else {
  console.log("skip: 数据不足，未生成 data.js");
}

/* ---------- 3) 直出每篇文章为独立静态页 posts/<id>.html ----------
   这是「打开文章要等一下」的根治办法：正文写进 HTML，访客只需一个请求。
   以 post.html 为模板，保证新旧页面结构、样式完全一致。 */
const tplPath = join(ROOT, "post.html");
if (posts.length && posts.some((p) => p.content) && existsSync(tplPath)) {
  const tpl = readFileSync(tplPath, "utf8");
  const outDir = join(ROOT, "posts");
  mkdirSync(outDir, { recursive: true });

  /* 清掉上一轮产物：文章改名或删除后不留下孤儿页 */
  for (const f of readdirSync(outDir)) {
    if (f.endsWith(".html")) unlinkSync(join(outDir, f));
  }

  let written = 0;
  posts.forEach((p, i) => {
    if (/[\/\\]/.test(p.id)) {
      console.warn("skip: 文章 id 含路径分隔符，无法生成页面 -> %s", p.id);
      return;
    }
    /* posts 已按日期倒序：i+1 是更早的一篇，i-1 是更新的一篇 */
    const page = renderPostPage(tpl, p, {
      site: SITE,
      catLabel,
      catCls,
      prev: posts[i + 1] || null,
      next: posts[i - 1] || null
    });
    writeFileSync(join(outDir, p.id + ".html"), page, "utf8");
    written++;
  });
  console.log("gen: posts/*.html  (%d pages, 正文直出)", written);
} else {
  console.log("skip: 缺少 post.html 模板或文章正文，未生成静态详情页");
}

/* ---------- 3) 生成 sitemap.xml ---------- */
if (posts.length) {
  /* 静态页的 lastmod 用最新文章的日期，避免每次构建都写成"今天"导致产物无谓抖动 */
  const today = postIndex[0] ? String(postIndex[0].date).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const staticPages = [
    { loc: SITE + "/", priority: "1.0" },
    { loc: SITE + "/posts.html", priority: "0.8" },
    { loc: SITE + "/notes.html", priority: "0.7" },
    { loc: SITE + "/projects.html", priority: "0.7" },
    { loc: SITE + "/about.html", priority: "0.6" }
  ];
  const postPages = postIndex.map((p) => ({
    loc: SITE + "/posts/" + encodeURIComponent(p.id) + ".html",
    lastmod: p.date,
    priority: "0.7"
  }));
  const all = staticPages.concat(postPages);
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    all.map((u) =>
      "  <url>\n" +
      "    <loc>" + u.loc + "</loc>\n" +
      "    <lastmod>" + (u.lastmod || today) + "</lastmod>\n" +
      "    <priority>" + u.priority + "</priority>\n" +
      "  </url>"
    ).join("\n") +
    "\n</urlset>\n";
  writeFileSync(join(ROOT, "sitemap.xml"), xml, "utf8");
  console.log("gen: sitemap.xml  (%d urls)", all.length);

  /* ---------- 5) 生成 rss.xml（原来是手写的，容易和文章脱节） ---------- */
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function rfc822(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
    if (!m) return new Date().toUTCString();
    /* 统一按北京时间上午 9 点发布，与旧 RSS 的习惯保持一致 */
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return DAYS[d.getUTCDay()] + ", " + m[3] + " " + MONTHS[+m[2] - 1] + " " + m[1] + " 09:00:00 +0800";
  }
  const items = postIndex.slice(0, 20).map((p) => {
    const url = SITE + "/posts/" + encodeURIComponent(p.id) + ".html";
    return (
      "    <item>\n" +
      "      <title>" + esc(p.title) + "</title>\n" +
      "      <link>" + esc(url) + "</link>\n" +
      '      <guid isPermaLink="true">' + esc(url) + "</guid>\n" +
      "      <pubDate>" + rfc822(p.date) + "</pubDate>\n" +
      "      <category>" + esc(catLabel(p.cat)) + "</category>\n" +
      "      <description>" + esc(p.excerpt) + "</description>\n" +
      "    </item>"
    );
  });
  const rss =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
    "  <channel>\n" +
    "    <title>Nooj Log</title>\n" +
    "    <link>" + SITE + "/</link>\n" +
    "    <description>代码与生活，皆有迹可循。记录开发踩坑、项目实践，以及日常里所有折腾与细碎生活。</description>\n" +
    "    <language>zh-CN</language>\n" +
    '    <atom:link href="' + SITE + '/rss.xml" rel="self" type="application/rss+xml"/>\n' +
    "    <lastBuildDate>" + rfc822(postIndex[0] && postIndex[0].date) + "</lastBuildDate>\n" +
    items.join("\n") +
    "\n  </channel>\n</rss>\n";
  writeFileSync(join(ROOT, "rss.xml"), rss, "utf8");
  console.log("gen: rss.xml  (%d items)", items.length);
}
