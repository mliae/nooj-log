/* ============================================================
   Nooj Log — 音乐服务代理（Edge Function）
   路由：POST /api/music

   为什么需要它：
     music-api 只对公开读取端点开了 CORS（/playlist.json /track /media），
     /api/* 既无 CORS 头也不处理 OPTIONS 预检，浏览器后台无法跨域直连。
     这里做同源转发，ApiKey 留在请求头里（不落任何存储）。

   为什么不做出站鉴权：
     EdgeOne 国内边缘节点出站访问 GitHub（api.github.com /
     raw.githubusercontent.com）不稳定，任何服务端 GitHub 往返都可能挂到
     超时，浏览器端表现为「网络异常」。因此本函数：
     · 不向 GitHub 出站——配置从自己站点的 CDN 读 /content/music.json
     · 软校验来源：浏览器同源 POST 自带 Origin/Referer，存在则必须同源
     · 转发面被压到最小：目标主机固定为配置里的音乐服务，路径白名单 /api/**，
       且必须携带调用方自己的 ApiKey（无 key 时上游会 401，无越权面）
   ============================================================ */

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

/* 只放行 /api/**，禁穿越、禁协议与主机 */
function safePath(p) {
  const s = String(p || "").trim();
  if (!/^\/api\/[A-Za-z0-9\-._~/=%&?]*$/.test(s)) return null;
  if (s.includes("..")) return null;
  return s;
}

/* 目标地址：环境变量优先，否则读自己站点 CDN 上的 content/music.json */
async function musicBase(env, self) {
  if (env.MUSIC_API_BASE) return String(env.MUSIC_API_BASE).replace(/\/+$/, "");
  try {
    const res = await fetch(self + "/content/music.json?t=" + Date.now(), {
      cache: "no-store",
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
    });
    if (!res.ok) return "";
    const data = await res.json();
    const api = String(data && data.api ? data.api : "");
    if (!/^https?:\/\//i.test(api)) return "";
    return api.replace(/\/+$/, "");
  } catch (e) {
    return "";
  }
}

export async function onRequestPost(context) {
  const req = context.request;
  const env = context.env || {};
  const self = new URL(req.url).origin;

  /* 软校验来源：浏览器同源 POST 会带 Origin/Referer；带且不同源则拒绝 */
  const src = req.headers.get("Origin") || req.headers.get("Referer") || "";
  if (src && src.indexOf(self) !== 0) {
    return json({ error: "来源不允许" }, 403);
  }

  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: "请求体不是合法 JSON" }, 400); }

  const path = safePath(body.path);
  if (!path) return json({ error: "接口路径不在允许范围内" }, 400);

  const apiKey = req.headers.get("X-Api-Key") || "";
  if (!apiKey) return json({ error: "缺少 ApiKey：请在「音乐服务」里填写并保存", code: "no_key" }, 401);

  const base = await musicBase(env, self);
  if (!base) {
    return json({ error: "读不到音乐服务配置（content/music.json）。刚保存的话请等站点重建完成后再试。", code: "no_music_api" }, 503);
  }

  const method = String(body.method || "GET").toUpperCase() === "POST" ? "POST" : "GET";
  const headers = { "X-Api-Key": apiKey };
  if (method === "POST") headers["Content-Type"] = "application/json";

  let upstream = null;
  let lastNetErr = null;
  /* 边缘出站偶发抖动：失败自动重试一次 */
  for (let attempt = 0; attempt < 2 && !upstream; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 800));
    try {
      upstream = await fetch(base + path, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body.body || {}) : undefined,
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined
      });
    } catch (e) {
      lastNetErr = e;
      upstream = null;
    }
  }
  if (!upstream) {
    return json({ error: "音乐服务不可达（已重试）：" + ((lastNetErr && lastNetErr.message) || "网络错误") }, 502);
  }

  const text = await upstream.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }

  if (!data) {
    return json({ error: "音乐服务返回了非 JSON 响应（" + upstream.status + "）" }, 502);
  }
  return json(data, upstream.status);
}
