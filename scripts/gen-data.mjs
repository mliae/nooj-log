#!/usr/bin/env node
/* ============================================================
   Nooj Log — 构建脚本
   数据流：
     content/posts/*.json      ← 每篇文章一个文件（CMS 后台管理，唯一事实源）
     content/projects.json     ← 项目（单文件）
     ↓ 本脚本聚合
     content/posts.json        ← 文章聚合产物（前台读取；自动生成，勿手改）
     assets/js/data.js         ← file:// 本地预览回退数据
     sitemap.xml               ← 搜索引擎收录

   触发方式：
     1) EdgeOne 构建时（edgeone.json 的 buildCommand）
     2) 本地手动：node scripts/gen-data.mjs
   ============================================================ */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://i.ymao.me";

function readJson(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

/* ---------- 1) 聚合 content/posts/*.json → content/posts.json ---------- */
const postsDir = join(ROOT, "content/posts");
let posts = [];

if (existsSync(postsDir)) {
  const files = readdirSync(postsDir).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    try {
      const p = JSON.parse(readFileSync(join(postsDir, f), "utf8"));
      /* 兼容两种写法：整篇对象，或被 { posts: [...] } 包裹 */
      const items = Array.isArray(p) ? p : p.posts ? p.posts : [p];
      items.forEach((it) => {
        if (it && it.id) posts.push(it);
      });
    } catch (e) {
      console.error("skip invalid post file: %s (%s)", f, e.message);
    }
  }
  /* 按日期倒序（同日按 id 稳定排序） */
  posts.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.id).localeCompare(String(b.id)));
  writeFileSync(join(ROOT, "content/posts.json"), JSON.stringify({ posts }, null, 2) + "\n", "utf8");
  console.log("gen: content/posts.json  (%d posts from %d files)", posts.length, files.length);
} else {
  const legacy = readJson("content/posts.json");
  posts = (legacy && legacy.posts) || [];
  console.log("skip: content/posts/ 目录不存在，沿用现有 posts.json (%d posts)", posts.length);
}

const projects = readJson("content/projects.json");

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
    "  posts: " + JSON.stringify(posts, null, 2) + ",\n" +
    "  projects: " + JSON.stringify(projects.projects, null, 2) + "\n" +
    "};\n";
  writeFileSync(join(ROOT, "assets/js/data.js"), banner + body, "utf8");
  console.log("gen: assets/js/data.js  (posts: %d, projects: %d)", posts.length, projects.projects.length);
} else {
  console.log("skip: 数据不足，未生成 data.js");
}

/* ---------- 3) 生成 sitemap.xml ---------- */
if (posts.length) {
  const today = new Date().toISOString().slice(0, 10);
  const staticPages = [
    { loc: SITE + "/", priority: "1.0" },
    { loc: SITE + "/posts.html", priority: "0.8" },
    { loc: SITE + "/projects.html", priority: "0.7" },
    { loc: SITE + "/about.html", priority: "0.6" }
  ];
  const postPages = posts.map((p) => ({
    loc: SITE + "/post.html?id=" + p.id,
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
}
