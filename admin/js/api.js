/* ============================================================
   Nooj Log 后台 — 数据层

   两种登录方式共用一套接口：
     github   浏览器持有 token，直连 GitHub API
     password 只有 HttpOnly Cookie，读写经 /api/data 代理
   仓库即数据库：content/posts/*.json 为唯一事实源。
   ============================================================ */

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

const DEFAULTS = { owner: "mliae", repo: "nooj-log", branch: "main" };

export function repoConf() {
  try {
    const saved = JSON.parse(localStorage.getItem("nooj_repo") || "{}");
    return { ...DEFAULTS, ...saved };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export function setRepoConf(conf) {
  localStorage.setItem("nooj_repo", JSON.stringify({ ...repoConf(), ...conf }));
}

let token = null;
let mode = "github";
export function setToken(t) { token = t; }
export function setMode(m) { mode = m; }
export function getMode() { return mode; }

/* ---------- 底层：GitHub 直连 ---------- */
async function req(path, { method = "GET", body } = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (token) headers.Authorization = "Bearer " + token;
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  });

  if (res.status === 204) return null;

  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }

  if (!res.ok) {
    const err = new Error((data && data.message) || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.data = data;
    if (res.status === 401) err.hint = "登录已失效，请重新登录";
    if (res.status === 403 && /rate limit/i.test(err.message)) {
      err.hint = "GitHub API 触发限流，请稍后再试";
    }
    throw err;
  }
  return data;
}

/* ---------- 底层：服务端代理 ---------- */
async function dataReq(payload) {
  const res = await fetch("/api/data", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `${res.status} 请求失败`);
    err.status = res.status;
    err.code = data && data.code;
    if (res.status === 401) err.hint = "登录已过期，请重新登录";
    throw err;
  }
  return data;
}

async function authReq(payload) {
  const res = await fetch("/api/auth", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `${res.status} 请求失败`);
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

async function storageReq(payload) {
  const headers = { "Content-Type": "application/json" };
  if (mode === "github" && token) headers.Authorization = "Bearer " + token;
  const res = await fetch("/api/storage", {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `${res.status} 请求失败`);
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

/* UTF-8 ↔ base64 */
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

/* ---------- 账号 ---------- */
export function authStatus() { return authReq({ action: "status" }); }
export function authSession() { return authReq({ action: "session" }); }
export function authLogin(password, username) {
  return authReq({ action: "login", password, username });
}
export function authLogout() { return authReq({ action: "logout" }); }
export function authSetup(password, pat, username) {
  return authReq({ action: "setup", password, pat, username });
}
export function authChangePassword(current, next) {
  return authReq({ action: "password", current, next });
}
export function authSavePat(pat) { return authReq({ action: "pat", pat }); }

export async function whoami() {
  if (mode === "password") {
    const s = await authSession();
    return { login: s.user.login, name: s.user.name, mode: "password" };
  }
  return req("/user");
}

/* ---------- 目录 / 文件 ---------- */
export async function listDir(dir) {
  if (mode === "password") {
    const r = await dataReq({ action: "list", dir });
    return r.files || [];
  }
  const { owner, repo, branch } = repoConf();
  const data = await req(`/repos/${owner}/${repo}/contents/${encPath(dir)}?ref=${branch}`);
  return (Array.isArray(data) ? data : [])
    .filter((f) => f.type === "file")
    .map((f) => ({ name: f.name, path: f.path, sha: f.sha, size: f.size }));
}

export async function readFile(path, sha) {
  if (mode === "password") {
    const r = await dataReq({ action: "read", path });
    return { text: r.text, sha: r.sha };
  }
  const { owner, repo, branch } = repoConf();
  if (sha) {
    try {
      const res = await fetch(`${RAW}/${owner}/${repo}/${branch}/${encPath(path)}?v=${sha.slice(0, 10)}`, {
        cache: "force-cache"
      });
      if (res.ok) return { text: await res.text(), sha };
    } catch (e) { /* 落到 API 分支 */ }
  }
  const data = await req(`/repos/${owner}/${repo}/contents/${encPath(path)}?ref=${branch}`);
  return { text: b64decode(data.content), sha: data.sha };
}

export async function writeFile(path, text, message, sha) {
  if (mode === "password") {
    const r = await dataReq({ action: "write", path, text, message, sha });
    return r.sha;
  }
  const { owner, repo, branch } = repoConf();
  const body = { message, content: b64encode(text), branch };
  if (sha) body.sha = sha;
  const data = await req(`/repos/${owner}/${repo}/contents/${encPath(path)}`, { method: "PUT", body });
  return data.content ? data.content.sha : null;
}

export async function deleteFile(path, message, sha) {
  if (mode === "password") {
    await dataReq({ action: "delete", path, message, sha });
    return;
  }
  const { owner, repo, branch } = repoConf();
  await req(`/repos/${owner}/${repo}/contents/${encPath(path)}`, {
    method: "DELETE",
    body: { message, sha, branch }
  });
}

export async function deleteFiles(paths, message) {
  if (!paths.length) return;
  if (mode === "password") {
    await dataReq({ action: "batchDelete", paths, message });
    return;
  }
  if (paths.length === 1) {
    const { sha } = await readFileMeta(paths[0]);
    return deleteFile(paths[0], message, sha);
  }
  const { owner, repo, branch } = repoConf();

  const ref = await req(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  const commitSha = ref.object.sha;
  const commit = await req(`/repos/${owner}/${repo}/git/commits/${commitSha}`);

  const tree = await req(`/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: {
      base_tree: commit.tree.sha,
      tree: paths.map((p) => ({ path: p, mode: "100644", type: "blob", sha: null }))
    }
  });

  const newCommit = await req(`/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: { message, tree: tree.sha, parents: [commitSha] }
  });

  await req(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: { sha: newCommit.sha }
  });
}

async function readFileMeta(path) {
  const { owner, repo, branch } = repoConf();
  const data = await req(`/repos/${owner}/${repo}/contents/${encPath(path)}?ref=${branch}`);
  return { sha: data.sha };
}

/* ---------- 项目（单文件数组） ---------- */
export async function readProjects() {
  const { text, sha } = await readFile("content/projects.json");
  const data = JSON.parse(text);
  return { list: Array.isArray(data.projects) ? data.projects : [], sha };
}

export async function writeProjects(list, sha, message) {
  const text = JSON.stringify({ projects: list }, null, 2) + "\n";
  return writeFile("content/projects.json", text, message || "project: 更新项目列表", sha);
}

/* ---------- 说说（单文件数组，一次读写） ---------- */
export async function readNotes() {
  try {
    const { text, sha } = await readFile("content/notes.json");
    const data = JSON.parse(text);
    return { list: Array.isArray(data.notes) ? data.notes : [], sha };
  } catch (e) {
    /* 首次使用还没有这个文件：从空列表起步 */
    if (e.status === 404) return { list: [], sha: null };
    throw e;
  }
}

export async function writeNotes(list, sha, message) {
  const text = JSON.stringify({ notes: list }, null, 2) + "\n";
  return writeFile("content/notes.json", text, message || "note: 更新说说", sha);
}

/* ---------- 媒体 ---------- */
export async function listGitHubMedia(dir = "media/uploads") {
  try {
    return await listDir(dir);
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

export function storageGet() { return storageReq({ action: "get" }); }
export function storageSave(config, secret) { return storageReq({ action: "save", config, secret }); }
export function storageTest() { return storageReq({ action: "test" }); }
export function storageList(prefix) { return storageReq({ action: "list", prefix }); }
export function storageDelete(key) { return storageReq({ action: "delete", key }); }

let storageCache = null;
export async function mediaTarget({ fresh = false } = {}) {
  if (!fresh && storageCache) return storageCache;
  try {
    const s = await storageGet();
    storageCache = s;
  } catch (e) {
    storageCache = { configured: false, enabled: false };
  }
  return storageCache;
}

export function invalidateMediaTarget() { storageCache = null; }

/* 直传 S3/R2（签名 URL），失败时抛出可读错误 */
async function uploadToStorage(file) {
  const r = await storageReq({
    action: "presign",
    filename: file.name,
    contentType: file.type || "application/octet-stream"
  });
  const res = await fetch(r.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`对象存储拒绝上传（${res.status}）${detail ? "：" + detail.slice(0, 160) : ""}`);
    err.hint = "多为桶未允许跨域（CORS）：请在存储后台为本站域名添加 PUT 允许规则";
    throw err;
  }
  return { url: r.publicUrl, key: r.key, source: "s3" };
}

/* 统一上传入口：配了图床走图床，否则回落到仓库 */
export async function uploadMedia(file, dir = "media/uploads") {
  const target = await mediaTarget();
  if (target && target.configured && target.enabled) {
    return uploadToStorage(file);
  }

  const clean = (file.name || "image.png").replace(/[^\w.\-]+/g, "-").toLowerCase();
  const name = `${Date.now().toString(36)}-${clean}`;
  const path = `${dir}/${name}`;
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));

  if (mode === "password") {
    await dataReq({ action: "upload", path, base64: btoa(bin), message: `media: 上传 ${file.name}` });
  } else {
    const { owner, repo, branch } = repoConf();
    await req(`/repos/${owner}/${repo}/contents/${encPath(path)}`, {
      method: "PUT",
      body: { message: `media: 上传 ${file.name}`, content: btoa(bin), branch }
    });
  }
  return { url: "/" + path, source: "repo" };
}
