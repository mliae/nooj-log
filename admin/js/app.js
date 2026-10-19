/* ============================================================
   Nooj Log 后台 — 应用外壳与路由

   hash 路由（静态托管无服务端重写，hash 最稳）：
     #/posts            文章列表
     #/posts/new        写文章
     #/posts/<id>       编辑文章
   ============================================================ */

import { $, h, icon, toast, confirmDialog } from "./util.js";
import * as auth from "./auth.js";
import * as api from "./api.js";
import { state, loadPosts } from "./store.js";
import { renderPosts } from "./views/posts.js";
import { renderEditor } from "./views/editor.js";

const root = $("#root");

let guard = null; /* 当前视图的离开拦截器 */

const ctx = {
  state,
  reload: (opts) => loadPosts({ force: true, ...opts }),
  go: (hash) => { location.hash = hash; },
  /* 视图可注册「有未保存修改」拦截 */
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
function renderLogin(message) {
  root.innerHTML = "";
  root.append(
    h(
      "div",
      { class: "login" },
      h(
        "div",
        { class: "login__card" },
        h("div", { class: "login__mark", html: LOGO }),
        h("h1", { class: "login__title" }, "Nooj Log"),
        h("p", { class: "login__sub" }, "内容管理后台"),
        message ? h("p", { class: "login__err" }, message) : null,
        h(
          "button",
          {
            class: "btn btn--primary btn--lg",
            onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              btn.textContent = "正在跳转 GitHub…";
              try {
                const token = await auth.loginWithGitHub();
                await startSession(token);
              } catch (err) {
                btn.disabled = false;
                btn.textContent = "使用 GitHub 登录";
                toast(err.message || "登录失败", "error", 4000);
              }
            }
          },
          "使用 GitHub 登录"
        ),
        h(
          "details",
          { class: "login__dev" },
          h("summary", {}, "本地调试：手动填入 Token"),
          h(
            "div",
            { class: "login__devbody" },
            h("input", {
              class: "input",
              type: "password",
              placeholder: "ghp_… 或 github_pat_…",
              onkeydown: async (e) => {
                if (e.key !== "Enter") return;
                const v = e.currentTarget.value.trim();
                if (!v) return;
                await startSession(v);
              }
            }),
            h("p", { class: "hint" }, "仅写入本机 localStorage，用于本地联调。")
          )
        ),
        h(
          "p",
          { class: "login__foot" },
          h("a", { href: "/", target: "_blank", rel: "noopener" }, "← 返回站点")
        )
      )
    )
  );
}

const LOGO =
  '<svg viewBox="0 0 28 28" width="28" height="28"><path d="M8 19.5 L14 8.5 L20 19.5" fill="none" stroke="#FAF9F5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2.6 3.4"/><circle cx="8" cy="19.5" r="2.1" fill="#FAF9F5"/><circle cx="14" cy="8.5" r="2.1" fill="#FAF9F5"/><circle cx="20" cy="19.5" r="2.1" fill="#FAF9F5"/></svg>';

/* ---------- 会话 ---------- */
async function startSession(token) {
  api.setToken(token);
  let user = null;
  try {
    user = await api.whoami();
  } catch (e) {
    localStorage.removeItem("nooj_token");
    renderLogin("Token 无效或已过期：" + (e.message || ""));
    return;
  }
  auth.saveSession(token, { login: user.login, name: user.name, avatar: user.avatar_url });
  state.user = user;
  boot();
}

function onLogout() {
  auth.logout();
  location.hash = "";
  renderLogin();
}

/* ---------- 外壳 ---------- */
const NAV = [
  { id: "posts", href: "#/posts", label: "文章", icon: "edit" }
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
      h(
        "span",
        { class: "side__brandtext" },
        h("strong", {}, "Nooj Log"),
        h("em", {}, "内容管理")
      )
    ),
    nav,
    h(
      "div",
      { class: "side__foot" },
      h("a", { class: "side__link", href: "/", target: "_blank", rel: "noopener" }, "查看站点 ↗"),
      h(
        "button",
        {
          class: "side__link",
          onclick: () => applyTheme(currentTheme() === "dark" ? "light" : "dark")
        },
        currentTheme() === "dark" ? "浅色模式" : "深色模式"
      ),
      h(
        "div",
        { class: "side__user" },
        user.avatar ? h("img", { class: "avatar", src: user.avatar, alt: "" }) : h("span", { class: "avatar" }),
        h("span", { class: "side__username" }, user.login || user.name || "已登录"),
        h(
          "button",
          {
            class: "side__logout",
            title: "退出登录",
            onclick: async () => {
              if (await confirmDialog({ title: "退出登录？", body: "本机保存的访问令牌会被清除。", confirmText: "退出" })) onLogout();
            }
          },
          "退出"
        )
      )
    )
  );

  const topbar = h("header", { class: "topbar", id: "topbar" });
  const view = h("div", { class: "view", id: "view" });

  root.append(h("div", { class: "shell" }, side, h("main", { class: "main" }, topbar, view)));

  NAV.forEach((item) => {
    nav.append(
      h("a", { class: "nav__item", href: item.href, "data-nav": item.id },
        icon(item.icon, 15), h("span", {}, item.label))
    );
    return null;
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
    h(
      "div",
      { class: "topbar__left" },
      backHash
        ? h("button", { class: "icon-btn", title: "返回", onclick: () => { location.hash = backHash; } }, icon("back", 16))
        : null,
      h("h2", { class: "topbar__title" }, title)
    ),
    h("div", { class: "topbar__actions" }, ...actions)
  );
}

/* ---------- 路由 ---------- */
let lastHash = "#/posts";

async function route() {
  const hash = location.hash.replace(/^#/, "") || "/posts";

  /* 有未保存修改时先问一句；用户选择留下就把 hash 还原，不触发二次导航 */
  if (guard) {
    const ok = await guard();
    if (!ok) {
      history.replaceState(null, "", lastHash);
      return;
    }
    guard = null;
  }
  lastHash = location.hash || "#/posts";

  const parts = hash.split("/").filter(Boolean); /* ["posts"] | ["posts","new"] */
  const view = document.getElementById("view");
  if (!view) return;

  if (parts[0] !== "posts") {
    location.hash = "#/posts";
    return;
  }

  if (parts[1]) {
    paintNav("posts");
    const id = parts[1] === "new" ? null : decodeURIComponent(parts[1]);
    await renderEditor(view, { ...ctx, setTopbar }, id);
  } else {
    paintNav("posts");
    await renderPosts(view, { ...ctx, setTopbar, paintNav });
  }
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
  const token = auth.getToken();
  if (!token) {
    renderLogin();
    return;
  }
  api.setToken(token);
  state.user = auth.getUser();
  boot();
})();

/* 离开页面时提示未保存 */
window.addEventListener("beforeunload", (e) => {
  if (sessionStorage.getItem("nooj_dirty") === "1") {
    e.preventDefault();
    e.returnValue = "";
  }
});
