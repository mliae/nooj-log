/* ============================================================
   Nooj Log 后台 — 通用工具
   零依赖：DOM 构建、日期、防抖、吐司、确认框
   ============================================================ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* 轻量 DOM 构建器：h("div", {class:"x"}, "文本", child) */
export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === "value") node.value = v;
      else if (k === "checked" || k === "disabled" || k === "selected") node[k] = !!v;
      else node.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ---------- 日期 ---------- */
export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fmtDate(v) {
  if (!v) return "—";
  return String(v).slice(0, 10);
}

export function relDate(v) {
  if (!v) return "—";
  const t = new Date(String(v).slice(0, 10) + "T00:00:00");
  const diff = Math.round((Date.now() - t.getTime()) / 86400000);
  if (Number.isNaN(diff)) return fmtDate(v);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff < 30) return diff + " 天前";
  if (diff < 365) return Math.floor(diff / 30) + " 个月前";
  return Math.floor(diff / 365) + " 年前";
}

/* ---------- 文本 ---------- */
export function plainText(html) {
  const d = document.createElement("div");
  d.innerHTML = html || "";
  return (d.textContent || "").replace(/\s+/g, " ").trim();
}

export function readTime(html) {
  const chars = plainText(html).length;
  return Math.max(1, Math.round(chars / 400));
}

const LATIN = "abcdefghijklmnopqrstuvwxyz0123456789";

/* 中文标题无法音译，退化为日期 + 拉丁词；拉丁词不足时用 note */
export function makeId(title) {
  const latin = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (latin.length >= 3) return latin;
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  let tail = "";
  for (let i = 0; i < 4; i++) tail += LATIN[Math.floor(Math.random() * LATIN.length)];
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${tail}`;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ---------- 吐司 ---------- */
let toastHost = null;

export function toast(message, type = "info", ms = 2600) {
  if (!toastHost) {
    toastHost = h("div", { class: "toast-host", role: "status", "aria-live": "polite" });
    document.body.append(toastHost);
  }
  const item = h("div", { class: "toast toast--" + type }, message);
  toastHost.append(item);
  requestAnimationFrame(() => item.classList.add("in"));
  setTimeout(() => {
    item.classList.remove("in");
    setTimeout(() => item.remove(), 240);
  }, ms);
}

/* ---------- 确认框 ---------- */
export function confirmDialog({ title, body, confirmText = "确定", cancelText = "取消", danger = false }) {
  return new Promise((resolve) => {
    const close = (v) => {
      overlay.classList.remove("in");
      setTimeout(() => overlay.remove(), 180);
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    const overlay = h(
      "div",
      { class: "overlay" },
      h(
        "div",
        { class: "dialog" },
        h("h3", { class: "dialog__title" }, title),
        body ? h("p", { class: "dialog__body" }, body) : null,
        h(
          "div",
          { class: "dialog__actions" },
          h("button", { class: "btn btn--ghost", onclick: () => close(false) }, cancelText),
          h(
            "button",
            { class: "btn " + (danger ? "btn--danger" : "btn--primary"), onclick: () => close(true) },
            confirmText
          )
        )
      )
    );
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.classList.add("in"));
  });
}

/* ---------- 空态 / 骨架 ---------- */
export function emptyState(title, desc, action) {
  return h(
    "div",
    { class: "empty" },
    h("div", { class: "empty__mark", "aria-hidden": "true" },
      '<svg viewBox="0 0 28 28"><path d="M8 19.5 L14 8.5 L20 19.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2.6 3.4"/><circle cx="8" cy="19.5" r="1.7" fill="currentColor"/><circle cx="14" cy="8.5" r="1.7" fill="currentColor"/><circle cx="20" cy="19.5" r="1.7" fill="currentColor"/></svg>'),
    h("p", { class: "empty__title" }, title),
    desc ? h("p", { class: "empty__desc" }, desc) : null,
    action || null
  );
}

export function icon(name, size = 16) {
  const paths = {
    plus: "M8 3v10M3 8h10",
    search: "M7 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11zM11.5 11.5 14 14",
    trash: "M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.6 8.2a1 1 0 0 0 1 .8h4.8a1 1 0 0 0 1-.8l.6-8.2",
    edit: "M11.5 2.5l2 2L6 12l-3 .8L3.8 10z",
    eye: "M1.5 8S3.6 3.5 8 3.5 14.5 8 14.5 8 12.4 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    back: "M10 3 5 8l5 5",
    check: "M2.5 8.5l3.5 3.5 7.5-8",
    close: "M3.5 3.5l9 9M12.5 3.5l-9 9",
    save: "M3 2.5h8l3 3v8h-11zM5.5 2.5v4h5v-4M5.5 13.5v-4h5v4",
    sun: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.2 3.2l1 1M11.8 11.8l1 1M12.8 3.2l-1 1M4.2 11.8l-1 1",
    moon: "M13 9.5A5.5 5.5 0 0 1 6.5 3 5.5 5.5 0 1 0 13 9.5z",
    logo: ""
  };
  const p = paths[name] || "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.4");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = `<path d="${p}"/>`;
  return svg;
}

export function iconBtn(name, label, onclick, cls = "") {
  return h("button", { class: "icon-btn " + cls, title: label, "aria-label": label, onclick }, icon(name, 15));
}
