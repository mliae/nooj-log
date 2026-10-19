/* ============================================================
   Nooj Log 后台 — 媒体库
   两个来源统一成一个网格：
     repo  media/uploads/*（随仓库部署）
     s3    Cloudflare R2 / B2 / MinIO 等（图床直传）
   ============================================================ */

import { h, icon, toast, confirmDialog, emptyState, debounce } from "../util.js";
import * as api from "../api.js";

const ui = { q: "", source: "" };

export async function renderMedia(container, ctx) {
  container.innerHTML = "";
  let repoFiles = [];
  let s3Files = [];
  let storage = { configured: false, enabled: false };
  let loading = true;

  const gridHost = h("div", { class: "list" });
  container.append(gridHost);

  const fileInput = h("input", {
    type: "file", accept: "image/*,video/*,application/pdf", multiple: true,
    style: "display:none",
    onchange: (e) => { upload(Array.from(e.currentTarget.files || [])); e.currentTarget.value = ""; }
  });

  ctx.setTopbar("媒体", [
    h("button", { class: "btn btn--ghost", onclick: () => load(true) }, icon("refresh", 15), h("span", {}, "刷新")),
    h("button", { class: "btn btn--primary", onclick: () => fileInput.click() }, icon("upload", 15), h("span", {}, "上传"))
  ]);

  container.append(fileInput);

  async function load(spin) {
    loading = true;
    if (spin) paint();
    try {
      storage = await api.mediaTarget({ fresh: true });
      const tasks = [api.listGitHubMedia().catch(() => [])];
      if (storage && storage.configured && storage.enabled) {
        tasks.push(api.storageList().catch((e) => ({ error: e })));
      }
      const [repo, s3] = await Promise.all(tasks);
      repoFiles = repo || [];
      if (s3 && s3.items) s3Files = s3.items;
      else if (s3 && s3.error) {
        s3Files = [];
        toast("图床列举失败：" + (s3.error.message || ""), "error", 5000);
      } else {
        s3Files = [];
      }
      if (spin) toast("已刷新", "ok");
    } catch (e) {
      toast(e.hint || e.message || "加载失败", "error", 5000);
    } finally {
      loading = false;
      paint();
    }
  }

  function items() {
    const repo = repoFiles.map((f) => ({
      id: "repo:" + f.path,
      source: "repo",
      name: f.name,
      path: f.path,
      sha: f.sha,
      size: f.size || 0,
      date: "",
      url: "/" + f.path
    }));
    const s3 = s3Files.map((f) => ({
      id: "s3:" + f.key,
      source: "s3",
      name: String(f.key).split("/").pop(),
      key: f.key,
      size: f.size || 0,
      date: f.modified || "",
      url: f.url
    }));
    let all = [...repo, ...s3];
    if (ui.source) all = all.filter((x) => x.source === ui.source);
    const q = ui.q.toLowerCase();
    if (q) all = all.filter((x) => (x.name + " " + (x.key || x.path || "")).toLowerCase().includes(q));
    all.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.name).localeCompare(String(a.name)));
    return all;
  }

  function paint() {
    gridHost.innerHTML = "";

    const total = repoFiles.length + s3Files.length;
    const bytes = [...repoFiles, ...s3Files].reduce((s, f) => s + (f.size || 0), 0);

    const search = h("input", {
      class: "input search__input", type: "search", placeholder: "搜索文件名…", value: ui.q,
      oninput: (e) => { const v = e.currentTarget.value.trim(); applySearch(v); }
    });
    const applySearch = debounce((v) => { ui.q = v; paint(); }, 160);

    const srcSel = h("select", {
      class: "select",
      onchange: (e) => { ui.source = e.currentTarget.value; paint(); }
    },
      h("option", { value: "" }, "全部来源"),
      h("option", { value: "repo", selected: ui.source === "repo" }, `仓库（${repoFiles.length}）`),
      h("option", { value: "s3", selected: ui.source === "s3" }, `图床（${s3Files.length}）`));

    const bar = h("div", { class: "toolbar" },
      h("div", { class: "search" }, icon("search", 15), search),
      srcSel,
      h("span", { class: "toolbar__meta" }, `共 ${total} 个 · ${fmtSize(bytes)}`));

    gridHost.append(bar);

    if (!storage.configured || !storage.enabled) {
      gridHost.append(
        h("div", { class: "banner" },
          h("div", { class: "banner__text" },
            h("strong", {}, "当前使用仓库存储"),
            h("span", {}, "图片会提交到 media/uploads 并随站点部署。接入 Cloudflare R2 等 S3 图床后，图片直传对象存储，不占仓库体积。")),
          h("a", { class: "btn btn--ghost btn--sm", href: "#/settings" }, "配置图床"))
      );
    } else {
      gridHost.append(
        h("div", { class: "banner banner--ok" },
          h("div", { class: "banner__text" },
            h("strong", {}, `图床已启用 · ${storage.provider || "S3"}`),
            h("span", {}, [storage.bucket, storage.publicBase].filter(Boolean).join(" · "))),
          h("a", { class: "btn btn--ghost btn--sm", href: "#/settings" }, "管理"))
      );
    }

    const drop = h("div", { class: "media__drop" },
      h("div", { class: "media__dropinner" },
        icon("upload", 20),
        h("p", {}, "把图片拖到这里，或点击右上角「上传」"),
        h("p", { class: "hint" }, storage.configured && storage.enabled
          ? "直传对象存储，不写入 Git 仓库"
          : "写入仓库 media/uploads，单张建议小于 800KB")));

    ["dragenter", "dragover"].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
    ["dragleave", "drop"].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
    drop.addEventListener("drop", (e) => {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (files.length) upload(files);
    });
    drop.addEventListener("click", () => fileInput.click());

    if (loading) {
      gridHost.append(h("div", { class: "media__grid" },
        ...Array.from({ length: 8 }, () => h("div", { class: "mcard mcard--skeleton" }))));
      return;
    }

    const list = items();
    if (!list.length) {
      gridHost.append(drop);
      gridHost.append(emptyState(
        ui.q || ui.source ? "没有匹配的媒体" : "媒体库是空的",
        ui.q || ui.source ? "换个关键词或来源试试。" : "上传第一张图片，写作页里也能直接粘贴上传。"));
      return;
    }

    const grid = h("div", { class: "media__grid" });
    for (const f of list) {
      grid.append(
        h("figure", { class: "mcard" },
          h("div", { class: "mcard__thumb" },
            isImage(f.name)
              ? h("img", { src: f.url, alt: f.name, loading: "lazy" })
              : h("span", { class: "mcard__ext" }, extOf(f.name).toUpperCase() || "FILE")),
          h("figcaption", { class: "mcard__meta" },
            h("div", { class: "mcard__name", title: f.key || f.path }, f.name),
            h("div", { class: "mcard__sub" },
              h("span", { class: "src src--" + f.source }, f.source === "s3" ? "图床" : "仓库"),
              h("span", {}, fmtSize(f.size)),
              f.date ? h("span", {}, fmtDate(f.date)) : null)),
          h("div", { class: "mcard__acts" },
            h("button", { class: "btn btn--ghost btn--sm", onclick: () => copy(f) }, icon("copy", 13), h("span", {}, "复制链接")),
            h("a", { class: "btn btn--ghost btn--sm", href: f.url, target: "_blank", rel: "noopener" }, icon("eye", 13), h("span", {}, "打开")),
            h("button", { class: "icon-btn icon-btn--danger", title: "删除", onclick: () => remove(f) }, icon("trash", 15))))
      );
    }

    gridHost.append(drop, grid);
  }

  async function copy(f) {
    const absolute = new URL(f.url, location.origin).href;
    try {
      await navigator.clipboard.writeText(absolute);
      toast("链接已复制", "ok", 1800);
    } catch (e) {
      window.prompt("复制这个链接：", absolute);
    }
  }

  async function remove(f) {
    const ok = await confirmDialog({
      title: "删除这个文件？",
      body: `${f.name}\n${f.source === "s3" ? "将从对象存储中删除" : "将从仓库 media/uploads 中删除"}，引用它的文章会出现空图。`,
      confirmText: "删除", danger: true
    });
    if (!ok) return;
    try {
      if (f.source === "s3") await api.storageDelete(f.key);
      else await api.deleteFiles([f.path], `media: 删除 ${f.name}`);
      toast("已删除", "ok");
      await load(false);
    } catch (e) {
      toast(e.hint || e.message || "删除失败", "error", 5000);
    }
  }

  async function upload(files) {
    const images = files.filter((f) => f.size > 0);
    if (!images.length) return;
    const totalMb = images.reduce((s, f) => s + f.size, 0) / 1048576;
    if (totalMb > 30) { toast("单次上传请控制在 30MB 内", "error"); return; }

    let ok = 0;
    for (const f of images) {
      try {
        toast(`正在上传 ${f.name}…`, "info", 1200);
        const r = await api.uploadMedia(f);
        if (r.source === "s3") api.invalidateMediaTarget();
        const url = new URL(r.url, location.origin).href;
        try { await navigator.clipboard.writeText(url); } catch (e) { /* 忽略 */ }
        ok++;
      } catch (e) {
        toast(`上传失败：${f.name} · ${e.hint || e.message || ""}`, "error", 6000);
      }
    }
    if (ok) {
      toast(`已上传 ${ok} 个文件，链接已复制`, "ok", 2600);
      await load(false);
    }
  }

  await load(false);
}

/* ---------- 格式化 ---------- */
function fmtSize(n) {
  if (!n) return "—";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(2) + " MB";
}
function fmtDate(v) {
  return String(v || "").slice(0, 10);
}
function isImage(name) {
  return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name || "");
}
function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? m[1] : "";
}
