/* ============================================================
   Nooj Log — 仓库数据代理（Edge Function）
   路由：POST /api/data

   用途：不使用 GitHub 账号登录时（密码登录），浏览器拿不到 PAT，
   由本函数带服务端令牌代为读写仓库。GitHub 登录态则直连 GitHub API，
   不经过这里。

   action: list | read | write | delete | batchDelete | upload
   白名单：content/**  media/**   （admin 配置由 /api/auth、/api/storage 负责）
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
function b64decode(s) {
  const bin = atob(String(s).replace(/\s/g, ""));
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(b);
}
function b64encode(str) {
  const bytes = enc(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
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

async function hmacKey(env) {
  const m = material(env);
  if (!m) return null;
  const k = await crypto.subtle.importKey("raw", enc(m), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return k;
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
  const key = await hmacKey(env);
  if (!key) return false;
  const expect = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc(body)));
  if (b64url(expect) !== sig) return false;
  try {
    const p = JSON.parse(new TextDecoder().decode(unb64url(body)));
    return !!(p && p.exp && p.exp > Date.now());
  } catch (e) {
    return false;
  }
}

/* 读取服务端令牌：env 优先，其次加密文件 */
async function readRepoJson(env, path) {
  const { owner, name, branch } = repoOf(env);
  const url = `${RAW}/${owner}/${name}/${branch}/${path}?t=${Date.now()}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const text = await res.text();
      if (!text.trim()) return null;
      return JSON.parse(text);
    }
  } catch (e) { /* 忽略 */ }
  return null;
}

async function unseal(env, box) {
  const m = material(env);
  if (!m) throw new Error("缺少服务端密钥材料");
  const base = await crypto.subtle.importKey("raw", enc(m), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc("nooj|pat|v1"), iterations: 60000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(box.iv) }, key, unb64url(box.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function serverToken(env) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  const box = await readRepoJson(env, "admin/.pat.json").catch(() => null);
  if (!box) return "";
  try { return (await unseal(env, box)).token || ""; } catch (e) { return ""; }
}

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

/* 只允许内容与媒体目录，挡住路径穿越 */
function safePath(p) {
  const s = String(p || "").replace(/^\/+/, "");
  if (!/^(content|media)\//.test(s)) return null;
  if (s.includes("..") || s.includes("\\")) return null;
  return s;
}

const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

export async function onRequestPost(context) {
  const req = context.request;
  const env = context.env || {};

  if (!(await hasSession(req, env))) return json({ error: "未登录或登录已过期" }, 401);

  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: "请求体不是合法 JSON" }, 400); }

  const token = await serverToken(env);
  if (!token) {
    return json({ error: "服务端未配置仓库令牌，密码登录无法读写内容。请在「系统设置 → 账号与安全」里保存 GitHub Token。", code: "no_token" }, 503);
  }

  const { owner, name, branch } = repoOf(env);
  const base = `/repos/${owner}/${name}`;

  try {
    if (body.action === "list") {
      const dir = safePath(body.dir);
      if (!dir) return json({ error: "目录不在允许范围内" }, 400);
      const r = await gh(`${base}/contents/${encPath(dir)}?ref=${branch}`, token);
      if (!r.ok) {
        if (r.status === 404) return json({ files: [] });
        return json({ error: (r.data && r.data.message) || "读取目录失败" }, r.status);
      }
      const files = (Array.isArray(r.data) ? r.data : [])
        .filter((f) => f.type === "file")
        .map((f) => ({ name: f.name, path: f.path, sha: f.sha, size: f.size }));
      return json({ files });
    }

    if (body.action === "read") {
      const path = safePath(body.path);
      if (!path) return json({ error: "路径不在允许范围内" }, 400);
      const r = await gh(`${base}/contents/${encPath(path)}?ref=${branch}`, token);
      if (!r.ok) return json({ error: (r.data && r.data.message) || "文件不存在" }, r.status);
      return json({ text: b64decode(r.data.content || ""), sha: r.data.sha });
    }

    if (body.action === "write") {
      const path = safePath(body.path);
      if (!path) return json({ error: "路径不在允许范围内" }, 400);
      const payload = {
        message: body.message || "content: 更新 " + path,
        branch,
        content: b64encode(String(body.text == null ? "" : body.text))
      };
      if (body.sha) payload.sha = body.sha;
      const r = await gh(`${base}/contents/${encPath(path)}`, token, { method: "PUT", body: payload });
      if (!r.ok) return json({ error: (r.data && r.data.message) || "写入失败" }, r.status);
      return json({ sha: r.data && r.data.content ? r.data.content.sha : null });
    }

    if (body.action === "delete") {
      const path = safePath(body.path);
      if (!path) return json({ error: "路径不在允许范围内" }, 400);
      let sha = body.sha;
      if (!sha) {
        const meta = await gh(`${base}/contents/${encPath(path)}?ref=${branch}`, token);
        if (!meta.ok) return json({ error: "文件不存在" }, 404);
        sha = meta.data.sha;
      }
      const r = await gh(`${base}/contents/${encPath(path)}`, token, {
        method: "DELETE",
        body: { message: body.message || "content: 删除 " + path, sha, branch }
      });
      if (!r.ok) return json({ error: (r.data && r.data.message) || "删除失败" }, r.status);
      return json({ ok: true });
    }

    if (body.action === "batchDelete") {
      const paths = (body.paths || []).map(safePath).filter(Boolean);
      if (!paths.length) return json({ error: "没有可删除的文件" }, 400);
      if (paths.length === 1) {
        const meta = await gh(`${base}/contents/${encPath(paths[0])}?ref=${branch}`, token);
        if (!meta.ok) return json({ error: "文件不存在" }, 404);
        const r = await gh(`${base}/contents/${encPath(paths[0])}`, token, {
          method: "DELETE",
          body: { message: body.message || "content: 删除", sha: meta.data.sha, branch }
        });
        return r.ok ? json({ ok: true }) : json({ error: "删除失败" }, r.status);
      }

      const ref = await gh(`${base}/git/ref/heads/${branch}`, token);
      if (!ref.ok) return json({ error: "读取分支失败" }, 500);
      const commitSha = ref.data.object.sha;
      const commit = await gh(`${base}/git/commits/${commitSha}`, token);
      if (!commit.ok) return json({ error: "读取提交失败" }, 500);

      const tree = await gh(`${base}/git/trees`, token, {
        method: "POST",
        body: {
          base_tree: commit.data.tree.sha,
          tree: paths.map((p) => ({ path: p, mode: "100644", type: "blob", sha: null }))
        }
      });
      if (!tree.ok) return json({ error: "构建新树失败" }, 500);

      const nc = await gh(`${base}/git/commits`, token, {
        method: "POST",
        body: { message: body.message || "content: 批量删除 " + paths.length + " 个文件", tree: tree.data.sha, parents: [commitSha] }
      });
      if (!nc.ok) return json({ error: "创建提交失败" }, 500);

      const up = await gh(`${base}/git/refs/heads/${branch}`, token, {
        method: "PATCH",
        body: { sha: nc.data.sha }
      });
      if (!up.ok) return json({ error: "更新分支失败" }, 500);
      return json({ ok: true });
    }

    if (body.action === "upload") {
      const path = safePath(body.path);
      if (!path) return json({ error: "路径不在允许范围内" }, 400);
      const r = await gh(`${base}/contents/${encPath(path)}`, token, {
        method: "PUT",
        body: { message: body.message || "media: 上传 " + path, content: String(body.base64 || ""), branch }
      });
      if (!r.ok) return json({ error: (r.data && r.data.message) || "上传失败" }, r.status);
      return json({ ok: true, path: "/" + path });
    }

    return json({ error: "未知操作：" + body.action }, 400);
  } catch (e) {
    return json({ error: (e && e.message) || "服务端错误" }, 500);
  }
}
