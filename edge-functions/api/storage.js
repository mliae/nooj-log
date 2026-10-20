/* ============================================================
   Nooj Log — 图床 / 对象存储（Edge Function）
   路由：POST /api/storage

   兼容任何 S3 协议存储：Cloudflare R2、Backblaze B2、MinIO、
   阿里云 OSS（S3 兼容端点）、七牛 Kodo（S3 兼容）等。

   action:
     get       读取配置（secret 只返回是否已设置）
     save      {config, secret?} 写入 admin/storage.json（需登录）
     test      列一个对象验证连通性
     presign   {filename, contentType} → 浏览器直传用的签名 URL
     list      {prefix?, max?} → 媒体库列表
     delete    {key} → 删除对象

   secret 用 AES-GCM 加密后落盘，密钥来自服务端环境变量，
   因此仓库里的 admin/storage.json 可以公开。
   ============================================================ */

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

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
function b64encode(str) {
  const bytes = enc(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(s) {
  const bin = atob(String(s).replace(/\s/g, ""));
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(b);
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

const cache = new Map();

async function hmacKey(env) {
  const m = material(env);
  if (!m) throw new Error("缺少服务端密钥材料");
  if (cache.has("h:" + m)) return cache.get("h:" + m);
  const k = await crypto.subtle.importKey("raw", enc(m), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  cache.set("h:" + m, k);
  return k;
}

async function aesKey(env, purpose) {
  const m = material(env);
  if (!m) throw new Error("缺少服务端密钥材料");
  const id = "a:" + purpose + ":" + m;
  if (cache.has(id)) return cache.get(id);
  const base = await crypto.subtle.importKey("raw", enc(m), "PBKDF2", false, ["deriveKey"]);
  const k = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc("nooj|" + purpose + "|v1"), iterations: 60000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  cache.set(id, k);
  return k;
}

async function seal(env, purpose, obj) {
  const key = await aesKey(env, purpose);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc(JSON.stringify(obj)));
  return { v: 1, iv: b64url(iv), data: b64url(data) };
}

async function unseal(env, purpose, box) {
  const key = await aesKey(env, purpose);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(box.iv) }, key, unb64url(box.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ---------- 会话 ---------- */
function cookieOf(req) {
  const raw = req.headers.get("Cookie") || "";
  const m = /(?:^|;\s*)nooj_sid=([^;]+)/.exec(raw);
  return m ? decodeURIComponent(m[1]) : "";
}

async function sessionOk(req, env) {
  const v = cookieOf(req);
  if (!v || v.indexOf(".") < 0) return false;
  const [body, sig] = v.split(".");
  const expect = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env), enc(body)));
  if (b64url(expect) !== sig) return false;
  try {
    const p = JSON.parse(new TextDecoder().decode(unb64url(body)));
    return !!(p && p.exp && p.exp > Date.now());
  } catch (e) {
    return false;
  }
}

async function gh(path, token, opts) {
  let res;
  try {
    res = await fetch(API + path, {
      method: (opts && opts.method) || "GET",
      headers: Object.assign(
        {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "nooj-log-admin"
        },
        token ? { Authorization: "Bearer " + token } : {},
        opts && opts.body ? { "Content-Type": "application/json" } : {}
      ),
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store"
    });
  } catch (e) {
    return { ok: false, status: 0, data: null, netError: String((e && e.message) || e) };
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  return { ok: res.ok, status: res.status, data };
}

/* isolate 内存缓存：配置读成功一次后就地驻留，之后的 presign/list/upload
   不再依赖每次出站 GitHub（边缘到 GitHub 抖动会让读配置偶发失败，
   表现为「测试连接正常，一上传却提示尚未配置图床」）。 */
let cfgCache = null;

function cacheCfg(cfg) {
  if (cfg && cfg.secretAccessKey) cfgCache = { cfg, at: Date.now() };
  return cfg;
}

async function ghIdentity(req, env) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const { owner, name } = repoOf(env);
  const r = await gh(`/repos/${owner}/${name}`, token);
  if (!r.ok) return null;
  return { mode: "github", token, canPush: !!(r.data.permissions && r.data.permissions.push) };
}

async function currentUser(req, env) {
  if (await sessionOk(req, env)) return { mode: "password", canPush: true };
  return ghIdentity(req, env);
}

/* ---------- 配置读写 ---------- */
async function serverToken(env) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  try {
    const { owner, name, branch } = repoOf(env);
    const res = await fetch(`${RAW}/${owner}/${name}/${branch}/admin/.pat.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return "";
    const box = await res.json();
    return (await unseal(env, "pat", box)).token || "";
  } catch (e) {
    return "";
  }
}

/* 对外可见的配置（去掉密钥本体，只留“是否已设置”） */
function publicCfg(c) {
  return {
    configured: true,
    source: c.source || "repo",
    enabled: !!c.enabled,
    provider: c.provider || "s3",
    endpoint: c.endpoint || "",
    region: c.region || "",
    bucket: c.bucket || "",
    accessKeyId: c.accessKeyId || "",
    publicBase: c.publicBase || "",
    prefix: c.prefix || "",
    forcePathStyle: c.forcePathStyle !== false,
    secretSet: !!(c.secretAccessKey || c.secret),
    updatedAt: c.updatedAt || null
  };
}

/* token 可选：给了就走 GitHub Contents API（写完立刻能读到），
   否则退回 raw CDN——刚保存完 raw 可能还是旧副本，表现为「保存后又变回默认」。

   返回值必须能区分三种情况，否则前端会把「读失败」当成「没配置」而静默
   把图片传进仓库：
     { cfg, missing:false }  读到了
     { cfg:null, missing:true }  确实还没有配置文件（404）
     { cfg:null, missing:false } 没读到（网络/鉴权问题），不可据此判定未配置 */
async function readConfig(env, token) {
  /* 环境变量优先：适合把密钥完全放在服务端 */
  if (env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    return {
      cfg: {
        enabled: true,
        provider: "env",
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION || "auto",
        bucket: env.S3_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        publicBase: env.S3_PUBLIC_BASE || "",
        prefix: env.S3_PREFIX || "",
        forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
        source: "env"
      },
      missing: false
    };
  }
  const { owner, name, branch } = repoOf(env);
  const finish = async (cfg) => {
    if (cfg && cfg.secret) {
      try {
        const s = await unseal(env, "s3", cfg.secret);
        cfg.secretAccessKey = s.secretAccessKey || "";
      } catch (e) { /* 密钥换过：视为未配置密钥，交给用户重填 */ }
    }
    cfg.source = "repo";
    return cfg;
  };

  if (token) {
    try {
      const r = await gh(`/repos/${owner}/${name}/contents/admin/storage.json?ref=${branch}`, token);
      if (r.ok && r.data && r.data.content) {
        return { cfg: await finish(JSON.parse(b64decode(r.data.content))), missing: false };
      }
      if (r.status === 404) return { cfg: null, missing: true };
    } catch (e) { /* 落到 raw */ }
  }

  try {
    const res = await fetch(`${RAW}/${owner}/${name}/${branch}/admin/storage.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.status === 404) return { cfg: null, missing: true };
    if (!res.ok) return { cfg: null, missing: false };
    return { cfg: await finish(await res.json()), missing: false };
  } catch (e) {
    return { cfg: null, missing: false };
  }
}

async function writeConfig(env, token, cfg) {
  const { owner, name, branch } = repoOf(env);
  const path = "admin/storage.json";
  const cur = await gh(`/repos/${owner}/${name}/contents/${path}?ref=${branch}`, token);
  const body = {
    message: "admin: 更新图床配置",
    branch,
    content: b64encode(JSON.stringify(cfg, null, 2) + "\n")
  };
  if (cur.ok && cur.data && cur.data.sha) body.sha = cur.data.sha;
  const r = await gh(`/repos/${owner}/${name}/contents/${path}`, token, { method: "PUT", body });
  if (!r.ok) throw new Error((r.data && r.data.message) || "写入配置失败");
}

/* ============================================================
   SigV4
   ============================================================ */
const HEX = "0123456789abcdef";
function hex(buf) {
  const a = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < a.length; i++) s += HEX[a[i] >> 4] + HEX[a[i] & 15];
  return s;
}
async function sha256hex(data) {
  const buf = typeof data === "string" ? enc(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", buf));
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc(data)));
}
async function signingKey(secret, date, region) {
  let k = await hmac(enc("AWS4" + secret), date);
  k = await hmac(k, region);
  k = await hmac(k, "s3");
  k = await hmac(k, "aws4_request");
  return k;
}

/* RFC3986：AWS 要求空格 %20、斜杠保留在路径层 */
function uriEncode(str, keepSlash) {
  let s = encodeURIComponent(String(str)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  if (keepSlash) s = s.replace(/%2F/g, "/");
  return s;
}

function stamp(d) {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, ""); /* 20260101T000000Z */
  return { amz: iso, date: iso.slice(0, 8) };
}

function target(cfg, key) {
  const base = String(cfg.endpoint || "").replace(/\/+$/, "");
  const u = new URL(base);
  const pathStyle = cfg.forcePathStyle !== false;
  const host = pathStyle ? u.host : `${cfg.bucket}.${u.host}`;
  const uri = pathStyle ? `/${cfg.bucket}/${uriEncode(key, true)}` : `/${uriEncode(key, true)}`;
  return { host, uri, origin: `${u.protocol}//${host}` };
}

function canonicalQuery(params) {
  return Object.keys(params)
    .map((k) => [uriEncode(k), uriEncode(params[k])])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/* 浏览器直传：查询串签名，payload 用 UNSIGNED-PAYLOAD */
async function presignPut(cfg, key, expires) {
  const { host, uri } = target(cfg, key);
  const t = stamp(new Date());
  const region = cfg.region || "auto";
  const scope = `${t.date}/${region}/s3/aws4_request`;
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`,
    "X-Amz-Date": t.amz,
    "X-Amz-Expires": String(expires || 900),
    "X-Amz-SignedHeaders": "host"
  };
  const query = canonicalQuery(params);
  const canonicalRequest = ["PUT", uri, query, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", t.amz, scope, await sha256hex(canonicalRequest)].join("\n");
  const sig = hex(await hmac(await signingKey(cfg.secretAccessKey, t.date, region), stringToSign));
  return `${target(cfg, key).origin}${uri}?${query}&X-Amz-Signature=${sig}`;
}

/* 服务端请求：头签名 */
async function s3Fetch(cfg, method, { key = "", query = {}, body = "" }) {
  const { host, uri, origin } = target(cfg, key);
  const t = stamp(new Date());
  const region = cfg.region || "auto";
  const scope = `${t.date}/${region}/s3/aws4_request`;
  const payloadHash = await sha256hex(body || "");

  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": t.amz
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((k) => `${k}:${headers[k]}\n`).join("");
  const q = canonicalQuery(query);
  const canonicalRequest = [method, uri, q, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", t.amz, scope, await sha256hex(canonicalRequest)].join("\n");
  const sig = hex(await hmac(await signingKey(cfg.secretAccessKey, t.date, region), stringToSign));

  const url = `${origin}${uri}${q ? "?" + q : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": t.amz
    },
    body: body || undefined,
    cache: "no-store"
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

/* 公开访问域名必须带协议：用户常只填 nooj.example.com，
   拼出来的地址会被浏览器当成本站相对路径（i.ymao.me/nooj.example.com/…）。 */
function pubBase(cfg) {
  let b = String(cfg.publicBase || "").trim().replace(/\/+$/, "");
  if (!b) return "";
  if (!/^https?:\/\//i.test(b)) b = "https://" + b;
  return b;
}

function publicUrl(cfg, key) {
  const base = pubBase(cfg);
  if (base) return base + "/" + uriEncode(key, true);
  const t = target(cfg, key);
  return t.origin + t.uri;
}

function cleanName(name) {
  return String(name || "file")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-80) || "file";
}

const EXT = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp",
  "image/avif": ".avif", "image/svg+xml": ".svg", "video/mp4": ".mp4", "application/pdf": ".pdf"
};

/* ============================================================
   主体
   ============================================================ */
export async function onRequestPost(context) {
  const req = context.request;
  const env = context.env || {};
  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: "请求体不是合法 JSON" }, 400); }
  const action = body.action || "";
  const user = await currentUser(req, env);
  if (!user) return json({ error: "未登录或登录已过期" }, 401);

  try {
    /* 读配置优先用令牌走 API（写完立刻一致），密码登录没有 Bearer 时退回服务端令牌 */
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const token = bearer || (await serverToken(env));
    const rc = await readConfig(env, token);
    let cfg = rc.cfg;
    /* GitHub 抖动导致本次没读到时，退回 isolate 缓存，保证上传/列举不中断 */
    if (cfg) cacheCfg(cfg);
    else if (cfgCache) cfg = cfgCache.cfg;
    /* 既没读到、也不是“确实没有配置文件”：不能当成未配置，否则前端会静默传进仓库 */
    const blind = !cfg && !rc.missing;

    if (action === "get") {
      if (!cfg) {
        if (blind) {
          return json({
            error: "暂时读不到图床配置（边缘到 GitHub 抖动），请稍等重试",
            code: "cfg_unavailable"
          }, 503);
        }
        return json({ configured: false, enabled: false, source: null });
      }
      return json(publicCfg(cfg));
    }

    if (action === "save") {
      if (!user.canPush) return json({ error: "没有仓库写权限" }, 403);
      /* 服务端令牌优先；刚登录还没同步过来时，回落到浏览器持有的 OAuth 令牌
         （能否写入由实际 PUT 自证，不额外放权） */
      if (!token) {
        return json({
          error: "服务端未配置仓库令牌：请用 GitHub 重新登录一次（会自动配置），或在「账号与安全」填入 GitHub Token",
          code: "no_token"
        }, 503);
      }

      const c = body.config || {};
      if (!c.endpoint || !c.bucket || !c.accessKeyId) {
        return json({ error: "Endpoint / Bucket / Access Key 不能为空" }, 400);
      }
      let secretBox = cfg && cfg.source === "repo" ? cfg.secret : null;
      const secret = String(body.secret || "");
      if (secret) secretBox = await seal(env, "s3", { secretAccessKey: secret });
      if (!secretBox) return json({ error: "请填写 Secret Access Key" }, 400);

      const next = {
        v: 1,
        enabled: !!c.enabled,
        provider: c.provider || "s3",
        endpoint: String(c.endpoint).trim(),
        region: String(c.region || "auto").trim(),
        bucket: String(c.bucket).trim(),
        accessKeyId: String(c.accessKeyId).trim(),
        secret: secretBox,
        publicBase: pubBase({ publicBase: c.publicBase }),
        prefix: String(c.prefix || "").trim(),
        forcePathStyle: c.forcePathStyle !== false,
        updatedAt: new Date().toISOString()
      };
      try {
        await writeConfig(env, token, next);
      } catch (e) {
        return json({ error: "写入仓库失败：" + (e.message || "令牌可能没有写权限") }, 400);
      }

      /* 连通性检查与缓存都必须带「解密后的明文密钥」：
         next 里只有加密盒 secret，s3Fetch 用 secretAccessKey 签名，
         漏了它就会永远 SignatureDoesNotMatch（配置其实是对的）。 */
      const plainCfg = { ...next, secretAccessKey: secret || (cfg && cfg.secretAccessKey) || "" };
      cacheCfg(plainCfg);

      /* 立刻做一次连通性检查，失败不阻断保存，但如实回报 */
      const probe = await s3Fetch(plainCfg, "GET", { query: { "list-type": "2", "max-keys": "1" } });
      return json({
        ok: true,
        probe: probe.ok ? "ok" : "failed",
        probeStatus: probe.status,
        probeMessage: probe.ok ? "" : probe.text.slice(0, 300),
        /* 直接回带新配置：前端据此回填，不再依赖 raw CDN 的同步延迟 */
        config: publicCfg(plainCfg)
      });
    }

    if (!cfg || !cfg.secretAccessKey) {
      if (blind) {
        return json({
          error: "暂时读不到图床配置（边缘到 GitHub 抖动），请稍等几秒重试",
          code: "cfg_unavailable"
        }, 503);
      }
      return json({ error: "尚未配置图床", code: "no_storage" }, 409);
    }

    if (action === "test") {
      const r = await s3Fetch(cfg, "GET", { query: { "list-type": "2", "max-keys": "1" } });
      return json({ ok: r.ok, status: r.status, message: r.ok ? "连接正常" : r.text.slice(0, 400) });
    }

    if (action === "presign") {
      const name = cleanName(body.filename);
      const type = body.contentType || "";
      const ext = /\.[a-z0-9]+$/.test(name) ? "" : (EXT[type] || "");
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
      const rand = Math.random().toString(36).slice(2, 8);
      const key = `${cfg.prefix || ""}${day}/${rand}-${name}${ext}`;
      const url = await presignPut(cfg, key, 900);
      return json({ ok: true, key, uploadUrl: url, publicUrl: publicUrl(cfg, key), method: "PUT", contentType: type });
    }

    if (action === "list") {
      const prefix = String(body.prefix == null ? cfg.prefix || "" : body.prefix);
      const max = Math.min(Number(body.max) || 200, 1000);
      const q = { "list-type": "2", "max-keys": String(max) };
      if (prefix) q.prefix = prefix;
      const r = await s3Fetch(cfg, "GET", { query: q });
      if (!r.ok) return json({ error: "列举对象失败", status: r.status, detail: r.text.slice(0, 300) }, 502);

      const items = [];
      const re = /<Contents>([\s\S]*?)<\/Contents>/g;
      let m;
      while ((m = re.exec(r.text))) {
        const block = m[1];
        const key = (/<Key>([\s\S]*?)<\/Key>/.exec(block) || [])[1] || "";
        const size = Number((/<Size>(\d+)<\/Size>/.exec(block) || [])[1] || 0);
        const mod = (/<LastModified>([\s\S]*?)<\/LastModified>/.exec(block) || [])[1] || "";
        if (!key) continue;
        const decodedKey = key.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
        items.push({ key: decodedKey, size, modified: mod, url: publicUrl(cfg, decodedKey) });
      }
      items.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
      return json({ ok: true, items, publicBase: cfg.publicBase || "" });
    }

    if (action === "delete") {
      const key = String(body.key || "");
      if (!key) return json({ error: "缺少 key" }, 400);
      const r = await s3Fetch(cfg, "DELETE", { key });
      if (!r.ok) return json({ error: "删除失败", status: r.status, detail: r.text.slice(0, 300) }, 502);
      return json({ ok: true });
    }

    return json({ error: "未知操作：" + action }, 400);
  } catch (e) {
    return json({ error: (e && e.message) || "服务端错误" }, 500);
  }
}
