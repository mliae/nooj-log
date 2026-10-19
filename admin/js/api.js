/* ============================================================
   Nooj Log 后台 — GitHub 数据层

   仓库即数据库：content/posts/*.json 为唯一事实源。
   读：raw.githubusercontent（按 blob sha 换 URL，天然免缓存失效）
   写：Contents API（单文件）/ Git Data API（批量删除，一次 commit）
   ============================================================ */

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

/* 仓库坐标：默认值，可在「设置」里改（存 localStorage） */
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
export function setToken(t) { token = t; }

/* ---------- 底层请求 ---------- */
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

/* UTF-8 → base64（分块避免超长调用栈） */
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
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
export async function whoami() {
  return req("/user");
}

/* ---------- 目录 ---------- */
export async function listDir(dir) {
  const { owner, repo, branch } = repoConf();
  const data = await req(`/repos/${owner}/${repo}/contents/${encPath(dir)}?ref=${branch}`);
  return (Array.isArray(data) ? data : []).filter((f) => f.type === "file");
}

/* ---------- 读单文件 ---------- */
export async function readFile(path, sha) {
  const { owner, repo, branch } = repoConf();
  /* 用 blob sha 当查询串：内容变 → URL 变，CDN 不可能返回旧内容 */
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

/* ---------- 写单文件 ---------- */
export async function writeFile(path, text, message, sha) {
  const { owner, repo, branch } = repoConf();
  const body = { message, content: b64encode(text), branch };
  if (sha) body.sha = sha;
  const data = await req(`/repos/${owner}/${repo}/contents/${encPath(path)}`, { method: "PUT", body });
  return data.content ? data.content.sha : null;
}

/* ---------- 删单文件 ---------- */
export async function deleteFile(path, message, sha) {
  const { owner, repo, branch } = repoConf();
  await req(`/repos/${owner}/${repo}/contents/${encPath(path)}`, {
    method: "DELETE",
    body: { message, sha, branch }
  });
}

/* ---------- 批量删除：一次 commit 搞定 ---------- */
export async function deleteFiles(paths, message) {
  if (!paths.length) return;
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

/* ---------- 媒体 ---------- */
export async function uploadMedia(file, dir = "media/uploads") {
  const { owner, repo, branch } = repoConf();
  const clean = file.name.replace(/[^\w.\-]+/g, "-").toLowerCase();
  const name = `${Date.now().toString(36)}-${clean}`;
  const path = `${dir}/${name}`;

  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));

  await req(`/repos/${owner}/${repo}/contents/${encPath(path)}`, {
    method: "PUT",
    body: { message: `media: 上传 ${file.name}`, content: btoa(bin), branch }
  });
  return "/" + path;
}
