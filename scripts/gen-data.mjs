#!/usr/bin/env node
/* ============================================================
   Nooj Log — 构建辅助脚本
   从 content/*.json（唯一事实源）生成：
   1) assets/js/data.js —— file:// 本地预览的回退数据
      （浏览器直接双击打开 HTML 时 fetch 不可用，此时回退到它；
        线上以 content/*.json 为准，本文件由脚本生成，请勿手改）
   2) sitemap.xml —— 供搜索引擎收录
   用法：node scripts/gen-data.mjs
   ============================================================ */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://nooj.cn";

function readJson(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

/* ---------- 1) 生成 assets/js/data.js ---------- */
const posts = readJson("content/posts.json");
const projects = readJson("content/projects.json");

if (posts && projects) {
  const banner =
    "/* ============================================================\n" +
    "   Nooj Log — 本地预览回退数据（由 scripts/gen-data.mjs 生成，请勿手改）\n" +
    "   线上以 content/*.json 为唯一事实源；仅当浏览器以 file:// 协议\n" +
    "   直接打开页面、fetch 不可用时，content.js 才会回退到本文件。\n" +
    "   ============================================================ */\n\n";
  const body =
    "window.NOOJ_DATA = {\n" +
    "  posts: " + JSON.stringify(posts.posts, null, 2) + ",\n" +
    "  projects: " + JSON.stringify(projects.projects, null, 2) + "\n" +
    "};\n";
  writeFileSync(join(ROOT, "assets/js/data.js"), banner + body, "utf8");
  console.log("gen: assets/js/data.js  (posts: %d, projects: %d)", posts.posts.length, projects.projects.length);
} else {
  console.log("skip: content/*.json 不存在，未生成 data.js");
}

/* ---------- 2) 生成 sitemap.xml ---------- */
if (posts) {
  const today = new Date().toISOString().slice(0, 10);
  const staticPages = [
    { loc: SITE + "/", priority: "1.0" },
    { loc: SITE + "/posts.html", priority: "0.8" },
    { loc: SITE + "/projects.html", priority: "0.7" },
    { loc: SITE + "/about.html", priority: "0.6" }
  ];
  const postPages = posts.posts.map(function (p) {
    return { loc: SITE + "/post.html?id=" + p.id, lastmod: p.date, priority: "0.7" };
  });
  const all = staticPages.concat(postPages);
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    all.map(function (u) {
      return "  <url>\n" +
        "    <loc>" + u.loc + "</loc>\n" +
        (u.lastmod ? "    <lastmod>" + u.lastmod + "</lastmod>\n" : "    <lastmod>" + today + "</lastmod>\n") +
        "    <priority>" + u.priority + "</priority>\n" +
        "  </url>";
    }).join("\n") +
    "\n</urlset>\n";
  writeFileSync(join(ROOT, "sitemap.xml"), xml, "utf8");
  console.log("gen: sitemap.xml  (%d urls)", all.length);
} else {
  console.log("skip: content/posts.json 不存在，未生成 sitemap.xml");
}
