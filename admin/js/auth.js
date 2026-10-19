/* ============================================================
   Nooj Log 后台 — 登录态

   沿用站点已有的零服务器 OAuth 代理（/api/oauth/auth → callback），
   弹窗拿 token 后 postMessage 回来；token 存 localStorage。
   本地调试可直接粘贴 Personal Access Token。
   ============================================================ */

const KEY = "nooj_token";
const USER_KEY = "nooj_user";

export function getToken() {
  return localStorage.getItem(KEY) || "";
}

export function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch (e) { return null; }
}

export function saveSession(token, user) {
  localStorage.setItem(KEY, token);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function logout() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(USER_KEY);
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
        let token = payload;
        try {
          const j = JSON.parse(payload);
          token = j.token || j.access_token || payload;
        } catch (err) { /* 兼容裸 token */ }
        finish(resolve, token);
      } else if (data.startsWith("authorization:github:error:")) {
        finish(reject, new Error(data.slice("authorization:github:error:".length) || "授权失败"));
      }
    };

    /* 兜底：popup 关闭后检查 sessionStorage（callback 的降级路径会写入） */
    const timer = setInterval(() => {
      if (popup.closed) {
        const fallback = sessionStorage.getItem("nooj-oauth-token");
        if (fallback) {
          sessionStorage.removeItem("nooj-oauth-token");
          let token = fallback;
          const i = fallback.lastIndexOf(":");
          try { token = JSON.parse(fallback.slice(i + 1)).token; } catch (e) { /* 忽略 */ }
          finish(resolve, token);
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

    /* 5 分钟超时 */
    setTimeout(() => finish(reject, new Error("登录超时，请重试")), 5 * 60 * 1000);
  });
}
