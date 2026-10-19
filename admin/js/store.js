/* ============================================================
   Nooj Log 后台 — 内存状态

   一次加载：列出 content/posts/ 目录 → 并发读取每篇 →
   在内存里完成搜索/筛选/排序（文章量级是几十篇，不需要服务端）
   ============================================================ */

import * as api from "./api.js";

/* 分类字典与前台 assets/js/content.js 保持一致 */
export const CATS = [
  { id: "dev", label: "开发折腾" },
  { id: "project", label: "项目展示" },
  { id: "life", label: "生活日常" }
];

export const catLabel = (id) => (CATS.find((c) => c.id === id) || {}).label || id || "未分类";

export const state = {
  user: null,
  posts: [],
  loading: false,
  loadedAt: 0,
  error: null,
  broken: 0
};

let inflight = null;

export async function loadPosts({ force = false } = {}) {
  if (inflight) return inflight;
  if (!force && state.posts.length && Date.now() - state.loadedAt < 30 * 1000) return state.posts;

  state.loading = true;
  state.error = null;
  inflight = (async () => {
    try {
      const files = (await api.listDir("content/posts")).filter((f) => f.name.endsWith(".json"));
      const results = await Promise.all(
        files.map(async (f) => {
          try {
            const { text, sha } = await api.readFile(f.path, f.sha);
            const post = JSON.parse(text);
            post._path = f.path;
            post._sha = sha;
            post._name = f.name;
            return post;
          } catch (e) {
            console.warn("读取失败", f.path, e);
            return null;
          }
        })
      );
      const ok = results.filter(Boolean);
      state.broken = results.length - ok.length;
      ok.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.id).localeCompare(String(b.id)));
      state.posts = ok;
      state.loadedAt = Date.now();
      return ok;
    } catch (e) {
      state.error = e;
      throw e;
    } finally {
      state.loading = false;
      inflight = null;
    }
  })();
  return inflight;
}

export function getPost(id) {
  return state.posts.find((p) => p.id === id) || null;
}

/* 标签统计：从文章聚合，不设独立存储 */
export function tagStats() {
  const map = new Map();
  for (const p of state.posts) {
    if (p.draft) continue;
    for (const t of p.tags || []) map.set(t, (map.get(t) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function catStats() {
  return CATS.map((c) => ({
    ...c,
    count: state.posts.filter((p) => p.cat === c.id && !p.draft).length
  }));
}

/* 只保留仓库里真正需要的字段 */
export function serialize(post) {
  const out = {};
  const order = ["id", "title", "cat", "date", "read", "tags", "excerpt", "draft", "md", "content"];
  for (const k of order) {
    if (post[k] === undefined || post[k] === null) continue;
    if (k === "draft" && !post.draft) continue;
    out[k] = post[k];
  }
  for (const k of Object.keys(post)) {
    if (k.startsWith("_") || out[k] !== undefined) continue;
    out[k] = post[k];
  }
  return out;
}
