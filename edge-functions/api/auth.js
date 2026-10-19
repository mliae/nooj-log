/* ============================================================
   Nooj Log — 账号与会话（Edge Function）
   路由：POST /api/auth

   action:
     status    公开。返回「是否已初始化密码 / 是否可密码登录 / 是否已存仓库令牌」
     login     {password}          密码登录 → 签发 HttpOnly 会话 Cookie
     session   读取当前会话
     logout    清 Cookie
     setup     {password, pat}     仅 GitHub 登录态可调用；首次创建密码
     password  {current?, next}    修改密码（GitHub 登录态可跳过 current）
     pat       {pat}               更新服务端仓库令牌（需登录态）

   凭据落盘：
     admin/.auth.json  PBKDF2-SHA256 密码哈希（公开可读，但不可逆）
     admin/.pat.json   AES-GCM 加密的仓库令牌（密钥只存在于服务端环境变量）
   ============================================================ */

const RAW = "https://raw.githubusercontent.com";
const API = "https://api.github.com";

/* ---------- 基础工具 ---------- */
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

/* 服务端密钥材料：优先显式配置，其次复用已存在的 OAuth secret */
function material(env) {
  return env.SESSION_SECRET || env.GITHUB_CLIENT_SECRET || env.GITHUB_TOKEN || "";
}

const keyCache = new Map();

async function hmacKey(env) {
  const m = material(env);
  if (!m) throw new Error("服务端缺少密钥材料：请配置 SESSION_SECRET");
  if (keyCache.has("h:" + m)) return keyCache.get("h:" + m);
  const k = await crypto.subtle.importKey("raw", enc(m), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  keyCache.set("h:" + m, k);
  return k;
}

async function aesKey(env, purpose) {
  const m = material(env);
  if (!m) throw new Error("服务端缺少密钥材料：请配置 SESSION_SECRET");
  const id = "a:" + purpose + ":" + m;
  if (keyCache.has(id)) return keyCache.get(id);
  const base = await crypto.subtle.importKey("raw", enc(m), "PBKDF2", false, ["deriveKey"]);
  const k = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc("nooj|" + purpose + "|v1"), iterations: 60000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  keyCache.set(id, k);
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
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64url(box.iv) },
    key,
    unb64url(box.data)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ---------- 仓库读写（用服务端令牌） ---------- */
async function gh(path, token, opts) {
  const res = await fetch(API + path, {
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
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  return { ok: res.ok, status: res.status, data };
}

/* 公开仓库优先走 raw（无需令牌）；token 由调用方显式传入，避免
   「没有令牌 → 去读令牌文件 → 又没有令牌」的递归。 */
async function readRepoJson(env, path, token) {
  const { owner, name, branch } = repoOf(env);
  const url = `${RAW}/${owner}/${name}/${branch}/${path}?t=${Date.now()}`;
  try {
    const res = await fetch(url, { cache: "no-store", headers: { "User-Agent": "nooj-log-admin" } });
    if (res.ok) return { data: JSON.parse(await res.text()), sha: null };
  } catch (e) { /* 回落 */ }

  if (!token) return { data: null, sha: null };
  const r = await gh(`/repos/${owner}/${name}/contents/${path}?ref=${branch}`, token);
  if (!r.ok) return { data: null, sha: null, status: r.status };
  return { data: JSON.parse(b64decode(r.data.content)), sha: r.data.sha };
}

function b64decode(s) {
  const bin = atob(String(s).replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function b64encode(str) {
  const bytes = enc(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function writeRepoJson(env, token, path, obj, message) {
  const { owner, name, branch } = repoOf(env);
  const cur = await gh(`/repos/${owner}/${name}/contents/${path}?ref=${branch}`, token);
  const body = {
    message,
    branch,
    content: b64encode(JSON.stringify(obj, null, 2) + "\n")
  };
  if (cur.ok && cur.data && cur.data.sha) body.sha = cur.data.sha;
  const r = await gh(`/repos/${owner}/${name}/contents/${path}`, token, { method: "PUT", body });
  if (!r.ok) throw new Error((r.data && r.data.message) || "写入仓库失败");
  return r.data;
}

/* ---------- 令牌 ---------- */
async function serverToken(env) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  try {
    const box = (await readRepoJson(env, "admin/.pat.json")).data;
    if (!box) return "";
    const obj = await unseal(env, "pat", box);
    return obj.token || "";
  } catch (e) {
    return "";
  }
}

/* ---------- 会话 ---------- */
const COOKIE = "nooj_sid";
const MAX_AGE = 7 * 24 * 3600;

function cookieOf(req, name) {
  const raw = req.headers.get("Cookie") || "";
  const m = new RegExp("(?:^|;\\s*)" + name + "=([^;]+)").exec(raw);
  return m ? decodeURIComponent(m[1]) : "";
}

async function signSession(env, payload) {
  const body = b64url(enc(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env), enc(body)));
  return body + "." + b64url(sig);
}

async function readSession(env, value) {
  if (!value || value.indexOf(".") < 0) return null;
  const [body, sig] = value.split(".");
  const expect = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env), enc(body)));
  if (b64url(expect) !== sig) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(unb64url(body))); } catch (e) { return null; }
  if (!payload || !payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

async function ghIdentity(req, env) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const { owner, name } = repoOf(env);
  const r = await gh(`/repos/${owner}/${name}`, token);
  if (!r.ok) return null;
  return {
    mode: "github",
    login: (r.data.owner && r.data.owner.login) || "github",
    name: (r.data.owner && r.data.owner.login) || "GitHub",
    canPush: !!(r.data.permissions && r.data.permissions.push),
    token
  };
}

async function currentUser(req, env) {
  const s = await readSession(env, cookieOf(req, COOKIE));
  if (s) return { mode: "password", login: s.u || "admin", name: "管理员" };
  const g = await ghIdentity(req, env);
  if (g) return g;
  return null;
}

/* ---------- 密码 ---------- */
const ITER = 310000;

async function pbkdf2(password, saltBytes, iterations) {
  const base = await crypto.subtle.importKey("raw", enc(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    base,
    256
  );
  return b64url(bits);
}

async function authFile(env) {
  const token = await serverToken(env).catch(() => "");
  const r = await readRepoJson(env, "admin/.auth.json", token);
  return r.data && r.data.hash ? r.data : null;
}

/* ---------- 主体 ---------- */
export async function onRequestPost(context) {
  const req = context.request;
  const env = context.env || {};
  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: "请求体不是合法 JSON" }, 400); }
  const action = body.action || "";

  try {
    /* -------- 公开：状态 -------- */
    if (action === "status") {
      const af = await authFile(env).catch(() => null);
      const token = await serverToken(env).catch(() => "");
      return json({
        passwordReady: !!af,
        githubReady: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
        repoTokenReady: !!token,
        username: af ? af.u || "admin" : "admin",
        updatedAt: af ? af.updatedAt || null : null
      });
    }

    /* -------- 登录 -------- */
    if (action === "login") {
      const password = String(body.password || "");
      if (!password) return json({ error: "请输入密码" }, 400);
      const af = await authFile(env);
      if (!af) return json({ error: "尚未初始化密码，请先用 GitHub 登录并在「系统设置」里创建", code: "not_initialized" }, 409);
      if (String(body.username || af.u || "admin") !== (af.u || "admin")) {
        return json({ error: "用户名或密码不正确" }, 401);
      }
      const hash = await pbkdf2(password, unb64url(af.salt), af.iter || ITER);
      if (hash !== af.hash) return json({ error: "用户名或密码不正确" }, 401);

      const token = await signSession(env, { u: af.u || "admin", m: "password", exp: Date.now() + MAX_AGE * 1000 });
      return json({ ok: true, user: { login: af.u || "admin", name: "管理员", mode: "password" } }, 200, {
        "Set-Cookie": `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`
      });
    }

    /* -------- 以下都需要登录态 -------- */
    const user = await currentUser(req, env);
    if (!user) return json({ error: "未登录或登录已过期" }, 401);

    if (action === "session") {
      return json({ ok: true, user: { login: user.login, name: user.name || user.login, mode: user.mode } });
    }

    if (action === "logout") {
      return json({ ok: true }, 200, {
        "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
      });
    }

    const token = await serverToken(env);
    const writable = user.mode === "password" || user.canPush;
    if (!writable) return json({ error: "当前账号没有仓库写权限" }, 403);

    /* GitHub 登录态才允许首次设置（防止陌生人抢占） */
    if (action === "setup") {
      if (user.mode !== "github") return json({ error: "首次设置密码请先用 GitHub 登录", code: "need_github" }, 403);
      const password = String(body.password || "");
      if (password.length < 8) return json({ error: "密码至少 8 位" }, 400);
      const existing = await authFile(env);
      if (existing) return json({ error: "密码已存在，请使用「修改密码」" }, 409);

      const pat = String(body.pat || "").trim();
      if (pat) {
        if (!token) {
          /* 第一次配置：没有可用令牌时，先验证传入的 PAT 再写入 */
          const check = await gh(`/repos/${repoOf(env).owner}/${repoOf(env).name}`, pat);
          if (!check.ok || !(check.data.permissions && check.data.permissions.push)) {
            return json({ error: "该 Token 无法读取仓库或没有写权限" }, 400);
          }
        }
        if (!token || token !== pat) {
          const box = await seal(env, "pat", { token: pat });
          await writeRepoJson(env, pat, "admin/.pat.json", box, "admin: 配置服务端仓库令牌");
        }
      } else if (!token) {
        return json({ error: "请填入具有 repo 写权限的 GitHub Token（密码登录需要服务端凭据）" }, 400);
      }

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const record = {
        v: 1,
        u: String(body.username || "admin"),
        alg: "PBKDF2-SHA256",
        iter: ITER,
        salt: b64url(salt),
        hash: await pbkdf2(password, salt, ITER),
        updatedAt: new Date().toISOString()
      };
      const wt = token || String(body.pat || "");
      await writeRepoJson(env, wt, "admin/.auth.json", record, "admin: 初始化管理员密码");
      return json({ ok: true });
    }

    if (action === "password") {
      const next = String(body.next || "");
      if (next.length < 8) return json({ error: "新密码至少 8 位" }, 400);
      const af = await authFile(env);
      if (!af) return json({ error: "尚未初始化密码" }, 409);
      if (user.mode === "password") {
        const cur = String(body.current || "");
        const hash = await pbkdf2(cur, unb64url(af.salt), af.iter || ITER);
        if (hash !== af.hash) return json({ error: "当前密码不正确" }, 401);
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const record = Object.assign({}, af, {
        iter: ITER,
        salt: b64url(salt),
        hash: await pbkdf2(next, salt, ITER),
        updatedAt: new Date().toISOString()
      });
      await writeRepoJson(env, token, "admin/.auth.json", record, "admin: 修改管理员密码");
      return json({ ok: true });
    }

    if (action === "pat") {
      const pat = String(body.pat || "").trim();
      if (!pat) return json({ error: "Token 不能为空" }, 400);
      const { owner, name } = repoOf(env);
      const check = await gh(`/repos/${owner}/${name}`, pat);
      if (!check.ok || !(check.data.permissions && check.data.permissions.push)) {
        return json({ error: "该 Token 无法读取仓库或没有写权限" }, 400);
      }
      const box = await seal(env, "pat", { token: pat });
      await writeRepoJson(env, pat, "admin/.pat.json", box, "admin: 更新服务端仓库令牌");
      return json({ ok: true });
    }

    return json({ error: "未知操作：" + action }, 400);
  } catch (e) {
    return json({ error: (e && e.message) || "服务端错误" }, 500);
  }
}
