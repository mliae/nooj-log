/* ============================================================
   Nooj Log 后台 — 音乐服务共享层
   ------------------------------------------------------------
   「音乐」管理页、文章编辑器、说说输入框共用：
     · 配置读写（content/music.json，走暂存分支）
     · /api/music 代理请求（带自动重试）
     · 搜索 / 入库 / 博客歌单
   ============================================================ */

import * as api from "./api.js";
import * as auth from "./auth.js";
import { today } from "./util.js";

export const DEFAULTS = { api: "https://music.jxe.me", tag: "blog", enabled: true };
const LS_KEY = "nooj_music_key";

let cfg = null;
let cfgSha = null;

export function getKey() { return localStorage.getItem(LS_KEY) || ""; }
export function setKey(k) {
  if (k) localStorage.setItem(LS_KEY, k);
  else localStorage.removeItem(LS_KEY);
}

export async function getConfig({ fresh = false } = {}) {
  if (cfg && !fresh) return cfg;
  try {
    const { text, sha } = await api.readFile("content/music.json");
    cfg = { ...DEFAULTS, ...JSON.parse(text) };
    cfgSha = sha;
  } catch (e) {
    cfg = { ...DEFAULTS };
    cfgSha = null;
  }
  return cfg;
}

export async function saveConfig(next) {
  const body = {
    api: String(next.api || "").replace(/\/+$/, ""),
    tag: next.tag || "blog",
    enabled: next.enabled !== false,
    updated: today()
  };
  const text = JSON.stringify(body, null, 2) + "\n";
  cfgSha = await api.writeFile("content/music.json", text, "music: 更新音乐服务配置", cfgSha || undefined);
  cfg = body;
  return cfg;
}

export function apiBase(c) {
  return String((c || cfg || {}).api || "").replace(/\/+$/, "");
}

/* ---------- /api/music 同源代理（自动重试） ---------- */
export async function musicReq(path, { method = "GET", body } = {}) {
  const conf = await getConfig();
  if (!apiBase(conf)) throw new Error("请先填写音乐服务地址");
  const key = getKey();
  if (!key) {
    const err = new Error("还没有填写 ApiKey：在 music-api 后台「Key 管理」创建一个，填到「音乐服务」里保存");
    err.code = "no_key";
    throw err;
  }
  const headers = { "Content-Type": "application/json", "X-Api-Key": key };
  const token = auth.getToken && auth.getToken();
  if (auth.getMode() === "github" && token) headers.Authorization = "Bearer " + token;

  let res = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 900 * attempt));
    try {
      res = await fetch("/api/music", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({ path, method, body })
      });
    } catch (e) {
      lastErr = e;
      res = null;
    }
  }
  if (!res) {
    const err = new Error("代理请求失败（网络异常，重试 2 次仍未成功）");
    err.hint = "边缘节点出站偶发抖动：稍等几秒再试一次；若反复出现，建议给 music-api 的 /api/* 开启 CORS 后改为浏览器直连";
    err.detail = lastErr && lastErr.message;
    throw err;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || res.status + " 请求失败");
    if (data && data.code === "no_music_api") err.hint = "刚改完服务地址的话，点「发布」并等构建完成再试";
    if (res.status === 401 && !(data && data.code)) err.hint = "鉴权失败：检查 ApiKey 是否正确、在 music-api 后台处于启用状态";
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  if (data && typeof data.code === "number" && data.code !== 0) {
    const err = new Error(data.message || "音乐服务返回错误");
    err.upstream = true;
    throw err;
  }
  return data && data.data !== undefined ? data.data : data;
}

/* ---------- 公开读取（浏览器直连 music-api，已开 CORS） ---------- */
export async function blogPlaylist(c) {
  const conf = c || (await getConfig());
  if (!apiBase(conf)) return [];
  try {
    const list = await fetch(apiBase(conf) + "/playlist.json" + (conf.tag ? "?tag=" + encodeURIComponent(conf.tag) : ""));
    if (!list.ok) return [];
    const data = await list.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

export async function fetchTrack(id, c) {
  const conf = c || (await getConfig());
  if (!apiBase(conf) || !id) return null;
  try {
    const r = await fetch(apiBase(conf) + "/track/" + encodeURIComponent(id));
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

/* ---------- 搜索 / 入库（走代理，需要 ApiKey） ---------- */
export async function search(kw) {
  return musicReq("/api/search?kw=" + encodeURIComponent(kw));
}

export async function ingest(hit) {
  return musicReq("/api/ingest", {
    method: "POST",
    body: {
      source: hit.source,
      id: hit.id ?? hit.songId,
      title: hit.title || hit.name || "未知标题",
      artist: hit.artist || hit.singer || "",
      album: hit.album || "",
      cover: hit.cover || hit.pic || "",
      vip: !!hit.vip,
      duration: hit.duration || 0
    }
  });
}

export async function library() {
  const data = await musicReq("/api/library");
  return (data && data.list) || [];
}

export async function assignTag(ids, tag) {
  return musicReq("/api/library/tag", { method: "POST", body: { ids, tag } });
}

export async function unassignTag(ids, tag) {
  return musicReq("/api/tags/unassign", { method: "POST", body: { name: tag, ids } });
}
