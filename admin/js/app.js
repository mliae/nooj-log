/* ============================================================
   Nooj Log 后台 — 应用外壳与路由

   hash 路由（静态托管无服务端重写，hash 最稳）：
     #/posts            文章列表
     #/posts/new        写文章
     #/posts/<id>       编辑文章
     #/notes            说说（碎片流）
     #/projects         项目管理
     #/media            媒体库
     #/settings         系统设置
   ============================================================ */

import { $, h, icon, toast, confirmDialog } from "./util.js";
import * as auth from "./auth.js";
import * as api from "./api.js";
import { state, loadPosts } from "./store.js";
import { renderPosts } from "./views/posts.js";
import { renderEditor } from "./views/editor.js";
import { renderNotes } from "./views/notes.js";
import { renderProjects } from "./views/projects.js";
import { renderMedia } from "./views/media.js";
import { renderSettings } from "./views/settings.js";

const root = $("#root");

let guard = null; /* 当前视图的离开拦截器 */

const ctx = {
  state,
  reload: (opts) => loadPosts({ force: true, ...opts }),
  go: (hash) => { location.hash = hash; },
  setGuard: (fn) => { guard = fn; },
  onLogout
};

/* ---------- 主题 ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("nooj-theme", t);
}
function currentTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}

/* ---------- 登录页 ---------- */
let loginStatus = null;

function renderLogin(message) {
  root.innerHTML = "";

  const err = h("p", { class: "login__err" }, message || "");
  if (!message) err.style.display = "none";

  const passInput = h("input", {
    class: "input",
    type: "password",
    placeholder: "管理员密码",
    autocomplete: "current-password",
    onkeydown: (e) => { if (e.key === "Enter") doPassword(); }
  });

  const passBtn = h("button", { class: "btn btn--primary btn--lg", onclick: () => doPassword() }, "登录");

  function showError(msg) {
    err.textContent = msg;
    err.style.display = "";
  }

  async function doPassword() {
    const v = passInput.value;
    if (!v) { passInput.focus(); return; }
    passBtn.disabled = true;
    const old = passBtn.textContent;
    passBtn.textContent = "验证中…";
    try {
      const user = await auth.loginWithPassword(v);
      state.user = user;
      boot();
    } catch (e) {
      showError(e.message || "登录失败");
      passBtn.disabled = false;
      passBtn.textContent = old;
      passInput.select();
    }
  }

  const ghBtn = h("button", {
    class: "btn btn--ghost btn--lg",
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "正在跳转 GitHub…";
      try {
        const token = await auth.loginWithGitHub();
        await startGitHubSession(token);
      } catch (e2) {
        btn.disabled = false;
        btn.textContent = "使用 GitHub 登录";
        showError(e2.message || "登录失败");
      }
    }
  }, "使用 GitHub 登录");

  const pwPanel = h("div", { class: "login__panel" },
    h("div", { class: "login__field" }, passInput),
    passBtn,
    h("p", { class: "login__note" }, "还没有设置密码？先用 GitHub 登录，在「系统设置 → 账号与安全」里创建。")
  );

  const ghPanel = h("div", { class: "login__panel", style: "display:none" }, ghBtn,
    h("p", { class: "login__note" }, "使用仓库所有者的 GitHub 账号授权。首次配置密码也走这条路。")
  );

  const tabs = h("div", { class: "tabs tabs--login" },
    h("button", { class: "tabs__btn is-active", "data-tab": "password", onclick: () => pick("password") }, "密码登录"),
    h("button", { class: "tabs__btn", "data-tab": "github", onclick: () => pick("github") }, "GitHub")
  );

  function pick(name) {
    tabs.querySelectorAll(".tabs__btn").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === name));
    pwPanel.style.display = name === "password" ? "" : "none";
    ghPanel.style.display = name === "github" ? "" : "none";
  }

  root.append(
    h("div", { class: "login" },
      h("div", { class: "login__card" },
        h("div", { class: "login__mark", html: LOGO }),
        h("h1", { class: "login__title" }, "Nooj Log"),
        h("p", { class: "login__sub" }, "内容管理后台"),
        err,
        tabs,
        pwPanel,
        ghPanel,
        h("details", { class: "login__dev" },
          h("summary", {}, "本地调试：手动填入 Token"),
          h("div", { class: "login__devbody" },
            h("input", {
              class: "input", type: "password", placeholder: "ghp_… 或 github_pat_…",
              onkeydown: async (e) => {
                if (e.key !== "Enter") return;
                const v = e.currentTarget.value.trim();
                if (v) await startGitHubSession(v);
              }
            }),
            h("p", { class: "hint" }, "仅写入本机 localStorage，用于本地联调。")
          )
        ),
        h("p", { class: "login__foot" },
          h("a", { href: "/", target: "_blank", rel: "noopener" }, "← 返回站点"))
      )
    )
  );

  /* 拉一次服务端状态，决定默认展示哪个面板 */
  api.authStatus().then((s) => {
    loginStatus = s;
    if (!s.passwordReady) {
      passInput.disabled = true;
      passBtn.disabled = true;
      passBtn.textContent = "尚未设置密码";
      pwPanel.querySelector(".login__note").textContent = s.repoTokenReady
        ? "还没有创建管理员密码。请先用 GitHub 登录，在「系统设置 → 账号与安全」里设置。"
        : "还没有创建管理员密码。先用 GitHub 登录，并在设置里保存一个仓库 Token，之后就能脱离 GitHub 登录。";
      pick("github");
    } else {
      pwPanel.querySelector(".login__note").style.display = "none";
      passInput.focus();
    }
  }).catch(() => { /* status 失败不阻断 GitHub 登录 */ });
}

const LOGO =
  '<svg viewBox="0 0 28 28" width="28" height="28"><path d="M8 19.5 L14 8.5 L20 19.5" fill="none" stroke="#FAF9F5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2.6 3.4"/><circle cx="8" cy="19.5" r="2.1" fill="#FAF9F5"/><circle cx="14" cy="8.5" r="2.1" fill="#FAF9F5"/><circle cx="20" cy="19.5" r="2.1" fill="#FAF9F5"/></svg>';

/* ---------- 会话 ---------- */
async function startGitHubSession(token) {
  api.setMode("github");
  api.setToken(token);
  let user = null;
  try {
    user = await api.whoami();
  } catch (e) {
    localStorage.removeItem("nooj_token");
    renderLogin("Token 无效或已过期：" + (e.message || ""));
    return;
  }
  const shaped = { login: user.login, name: user.name, avatar: user.avatar_url, mode: "github" };
  auth.saveSession(token, shaped);
  state.user = shaped;
  boot();
}

function onLogout() {
  auth.logoutLocal();
  location.hash = "";
  renderLogin();
}

/* ---------- 外壳 ---------- */
const NAV = [
  { id: "posts", href: "#/posts", label: "文章", icon: "edit" },
  { id: "notes", href: "#/notes", label: "说说", icon: "note" },
  { id: "projects", href: "#/projects", label: "项目", icon: "grid" },
  { id: "media", href: "#/media", label: "媒体", icon: "image" },
  { id: "settings", href: "#/settings", label: "设置", icon: "gear" }
];

function renderShell() {
  root.innerHTML = "";
  const user = auth.getUser() || state.user || {};
  const nav = h("nav", { class: "nav" });

  const side = h(
    "aside",
    { class: "side" },
    h(
      "a",
      { class: "side__brand", href: "#/posts" },
      h("span", { class: "side__mark", html: LOGO }),
      h("span", { class: "side__brandtext" },
        h("strong", {}, "Nooj Log"),
        h("em", {}, "内容管理"))
    ),
    nav,
    h(
      "div",
      { class: "side__foot" },
      h("a", { class: "side__link", href: "/", target: "_blank", rel: "noopener" }, "查看站点 ↗"),
      h("button", {
        class: "side__link",
        onclick: () => applyTheme(currentTheme() === "dark" ? "light" : "dark")
      }, currentTheme() === "dark" ? "浅色模式" : "深色模式"),
      h("div", { class: "side__user" },
        user.avatar ? h("img", { class: "avatar", src: user.avatar, alt: "" }) : h("span", { class: "avatar" }),
        h("span", { class: "side__username" },
          (user.login || user.name || "已登录") + (user.mode === "password" ? " · 密码" : "")),
        h("button", {
          class: "side__logout",
          title: "退出登录",
          onclick: async () => {
            if (await confirmDialog({ title: "退出登录？", body: "会话将被清除，需要重新登录。", confirmText: "退出" })) onLogout();
          }
        }, "退出")
      )
    )
  );

  const topbar = h("header", { class: "topbar", id: "topbar" });
  const view = h("div", { class: "view", id: "view" });

  root.append(h("div", { class: "shell" }, side, h("main", { class: "main" }, topbar, view)));

  NAV.forEach((item) => {
    nav.append(h("a", { class: "nav__item", href: item.href, "data-nav": item.id },
      icon(item.icon, 15), h("span", {}, item.label)));
  });
}

function paintNav(active) {
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.nav === active);
  });
}

function setTopbar(title, actions = [], backHash) {
  const bar = document.getElementById("topbar");
  if (!bar) return;
  bar.innerHTML = "";
  bar.append(
    h("div", { class: "topbar__left" },
      backHash
        ? h("button", { class: "icon-btn", title: "返回", onclick: () => { location.hash = backHash; } }, icon("back", 16))
        : null,
      h("h2", { class: "topbar__title" }, title)),
    h("div", { class: "topbar__actions" }, ...actions)
  );
}

/* ---------- 路由 ---------- */
let lastHash = "#/posts";

async function route() {
  const hash = location.hash.replace(/^#/, "") || "/posts";

  if (guard) {
    const ok = await guard();
    if (!ok) {
      history.replaceState(null, "", lastHash);
      return;
    }
    guard = null;
  }
  lastHash = location.hash || "#/posts";

  const parts = hash.split("/").filter(Boolean);
  const view = document.getElementById("view");
  if (!view) return;

  const section = parts[0];
  if (!["posts", "notes", "projects", "media", "settings"].includes(section)) {
    location.hash = "#/posts";
    return;
  }

  paintNav(section);

  if (section === "posts") {
    if (parts[1]) {
      const id = parts[1] === "new" ? null : decodeURIComponent(parts[1]);
      await renderEditor(view, { ...ctx, setTopbar }, id);
    } else {
      await renderPosts(view, { ...ctx, setTopbar, paintNav });
    }
    return;
  }

  if (section === "notes") return renderNotes(view, { ...ctx, setTopbar });
  if (section === "projects") return renderProjects(view, { ...ctx, setTopbar });
  if (section === "media") return renderMedia(view, { ...ctx, setTopbar });
  if (section === "settings") return renderSettings(view, { ...ctx, setTopbar });
}

/* ---------- 启动 ---------- */
async function boot() {
  renderShell();
  try {
    await loadPosts();
  } catch (e) {
    toast(e.hint || e.message || "内容加载失败", "error", 5000);
  }
  window.addEventListener("hashchange", route);
  await route();
}

(async function start() {
  const user = await auth.restore();
  if (!user) {
    renderLogin();
    return;
  }
  state.user = user;
  boot();
})();

/* 离开页面时提示未保存 */
window.addEventListener("beforeunload", (e) => {
  if (sessionStorage.getItem("nooj_dirty") === "1") {
    e.preventDefault();
    e.returnValue = "";
  }
});
