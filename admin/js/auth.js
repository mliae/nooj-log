/* ============================================================
   Nooj Log 后台 — 登录态

   两种方式并存：
     github   弹窗走 OAuth 代理，token 存 localStorage（旧路径）
     password 密码提交到 /api/auth，服务端签发 HttpOnly Cookie
   ============================================================ */

import * as api from "./api.js";

const TOKEN_KEY = "nooj_token";
const USER_KEY = "nooj_user";
const MODE_KEY = "nooj_mode";

export function getMode() {
  const m = localStorage.getItem(MODE_KEY);
  if (m) return m;
  return localStorage.getItem(TOKEN_KEY) ? "github" : "";
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch (e) { return null; }
}

export function saveSession(token, user) {
  localStorage.setItem(MODE_KEY, "github");
  localStorage.setItem(TOKEN_KEY, token);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify({ ...user, mode: "github" }));
}

export function savePasswordSession(user) {
  localStorage.setItem(MODE_KEY, "password");
  localStorage.removeItem(TOKEN_KEY);
  localStorage.setItem(USER_KEY, JSON.stringify({ ...user, mode: "password" }));
}

export function logoutLocal() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(MODE_KEY);
}

export async function logout() {
  if (getMode() === "password") {
    try { await api.authLogout(); } catch (e) { /* 会话可能已过期 */ }
  }
  logoutLocal();
}

/* 启动时恢复会话：本地记录优先，其次试探服务端 Cookie */
export async function restore() {
  const mode = getMode();

  if (mode === "github") {
    const t = getToken();
    if (!t) return null;
    api.setMode("github");
    api.setToken(t);
    try {
      const u = await api.whoami();
      const user = { login: u.login, name: u.name, avatar: u.avatar_url, mode: "github" };
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      return user;
    } catch (e) {
      logoutLocal();
      return null;
    }
  }

  api.setMode("password");
  api.setToken("");
  try {
    const s = await api.authSession();
    savePasswordSession(s.user);
    return { ...s.user, mode: "password" };
  } catch (e) {
    if (mode === "password") logoutLocal();
    return null;
  }
}

/* 弹窗登录：返回 Promise<token> */
export function loginWithGitHub() {
  return new Promise((resolve, reject) => {
    const w = 640, hgt = 720;
    const left = Math.max(0, (screen.width - w) / 2);
    const top = Math.max(0, (screen.height - hgt) / 2);
    const popup = window.open(
      "/api/oauth/auth?provider=github&t=" + Date.now(),
      "nooj-oauth",
      `width=${w},height=${hgt},left=${left},top=${top},menubar=no,toolbar=no`
    );
    if (!popup) {
      reject(new Error("弹窗被浏览器拦截，请允许本页弹出窗口后重试"));
      return;
    }

    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(val);
    };

    const onMessage = (e) => {
      const data = typeof e.data === "string" ? e.data : "";
      if (!data.startsWith("authorization:github:")) return;
      if (data.startsWith("authorization:github:success:")) {
        const payload = data.slice("authorization:github:success:".length);
        let tk = payload;
        try {
          const j = JSON.parse(payload);
          tk = j.token || j.access_token || payload;
        } catch (err) { /* 兼容裸 token */ }
        finish(resolve, tk);
      } else if (data.startsWith("authorization:github:error:")) {
        finish(reject, new Error(data.slice("authorization:github:error:".length) || "授权失败"));
      }
    };

    const timer = setInterval(() => {
      if (popup.closed) {
        const fallback = sessionStorage.getItem("nooj-oauth-token");
        if (fallback) {
          sessionStorage.removeItem("nooj-oauth-token");
          let tk = fallback;
          const i = fallback.lastIndexOf(":");
          try { tk = JSON.parse(fallback.slice(i + 1)).token; } catch (e) { /* 忽略 */ }
          finish(resolve, tk);
        } else {
          finish(reject, new Error("登录未完成"));
        }
      }
    }, 600);

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
    window.addEventListener("message", onMessage);

    setTimeout(() => finish(reject, new Error("登录超时，请重试")), 5 * 60 * 1000);
  });
}

export async function loginWithPassword(password) {
  const r = await api.authLogin(password);
  savePasswordSession(r.user);
  api.setMode("password");
  api.setToken("");
  return r.user;
}
