/* ============================================================
   Nooj Log — 音乐服务代理（Edge Function）
   路由：POST /api/music

   为什么需要它：
     music-api 只对公开读取端点开了 CORS（/playlist.json /track /media），
     /api/* 既无 CORS 头也不处理 OPTIONS 预检，浏览器后台无法跨域直连。
     这里做同源转发，并把 ApiKey 留在请求头里（不落任何存储）。

   安全边界：
     · 仅管理员会话（nooj_sid Cookie）或 GitHub Bearer Token 可调用
     · 目标地址只取仓库里的 content/music.json（不可由请求方指定）
     · 路径白名单 /api/**，挡住路径穿越与任意主机转发
   ============================================================ */

const RAW = "https://raw.githubusercontent.com";
const GH_API = "https://api.github.com";

function enc(s) { return new TextEncoder().encode(s); }

function b64url(buf) {
  const a = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < a.length; i += 0x8000) bin += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign(
      { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      extra || {}
    )
  });
}

function repoOf(env) {
  return {
    owner: env.GITHUB_REPO_OWNER || "mliae",
    name: env.GITHUB_REPO_NAME || "nooj-log",
    branch: env.GITHUB_BRANCH || "main"
  };
}

function material(env) {
  return env.SESSION_SECRET || env.GITHUB_CLIENT_SECRET || env.GITHUB_TOKEN || "";
}

function cookieOf(req) {
  const raw = req.headers.get("Cookie") || "";
  const m = /(?:^|;\s*)nooj_sid=([^;]+)/.exec(raw);
  return m ? decodeURIComponent(m[1]) : "";
}

async function hasSession(req, env) {
  const v = cookieOf(req);
  if (!v || v.indexOf(".") < 0) return false;
  const [body, sig] = v.split(".");
  const m = material(env);
  if (!m) return false;
  const key = await crypto.subtle.importKey("raw", enc(m), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expect = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc(body)));
  if (b64url(expect) !== sig) return false;
  try {
    const p = JSON.parse(new TextDecoder().decode(unb64url(body)));
    return !!(p && p.exp && p.exp > Date.now());
  } catch (e) {
    return false;
  }
}

/* GitHub 登录态：浏览器持有 PAT，代为校验一次 */
async function hasGitHubToken(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") || "");
  if (!m) return false;
  try {
    const r = await fetch(GH_API + "/user", {
      headers: {
        Authorization: "Bearer " + m[1],
        Accept: "application/vnd.github+json",
        "User-Agent": "nooj-log-admin"
      }
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

/* 目标地址：环境变量优先，否则读仓库里的 content/music.json */
async function musicBase(env) {
  if (env.MUSIC_API_BASE) return String(env.MUSIC_API_BASE).replace(/\/+$/, "");
  const { owner, name, branch } = repoOf(env);
  try {
    const res = await fetch(`${RAW}/${owner}/${name}/${branch}/content/music.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return "";
    const data = await res.json();
    const api = String(data && data.api ? data.api : "");
    if (!/^https?:\/\//i.test(api)) return "";
    return api.replace(/\/+$/, "");
  } catch (e) {
    return "";
  }
}

/* 只放行 /api/**，禁穿越、禁协议与主机 */
function safePath(p) {
  const s = String(p || "").trim();
  if (!/^\/api\/[A-Za-z0-9\-._~/=%&?]*$/.test(s)) return null;
  if (s.includes("..")) return null;
  return s;
}

export async function onRequestPost(context) {
  const req = context.request;
  const env = context.env || {};

  if (!(await hasSession(req, env)) && !(await hasGitHubToken(req))) {
    return json({ error: "未登录或登录已过期" }, 401);
  }

  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: "请求体不是合法 JSON" }, 400); }

  const path = safePath(body.path);
  if (!path) return json({ error: "接口路径不在允许范围内" }, 400);

  const base = await musicBase(env);
  if (!base) {
    return json({ error: "还没有配置音乐服务地址。请先在上方「音乐服务」里保存配置。", code: "no_music_api" }, 503);
  }

  const method = String(body.method || "GET").toUpperCase() === "POST" ? "POST" : "GET";
  const apiKey = req.headers.get("X-Api-Key") || "";
  if (!apiKey) return json({ error: "缺少 ApiKey：请在「音乐服务」里填写并保存", code: "no_key" }, 401);

  const headers = { "X-Api-Key": apiKey };
  if (method === "POST") headers["Content-Type"] = "application/json";

  let upstream;
  try {
    upstream = await fetch(base + path, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(body.body || {}) : undefined,
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined
    });
  } catch (e) {
    return json({ error: "音乐服务不可达：" + ((e && e.message) || "网络错误") }, 502);
  }

  const text = await upstream.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }

  if (!data) {
    return json({ error: "音乐服务返回了非 JSON 响应（" + upstream.status + "）" }, 502);
  }
  return json(data, upstream.status);
}
