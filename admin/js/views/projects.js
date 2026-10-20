/* ============================================================
   Nooj Log 后台 — 项目管理
   数据源：content/projects.json（单文件数组，顺序即前台展示顺序）
   ============================================================ */

import { h, icon, iconBtn, toast, confirmDialog, emptyState } from "../util.js";
import * as api from "../api.js";

export async function renderProjects(container, ctx) {
  container.innerHTML = "";
  let list = [];
  let sha = null;

  const host = h("div", { class: "list" });
  container.append(host);

  ctx.setTopbar("项目", [
    h("button", { class: "btn btn--ghost", onclick: () => load(true) }, icon("refresh", 15), h("span", {}, "刷新")),
    h("button", { class: "btn btn--primary", onclick: () => openForm(null) }, icon("plus", 15), h("span", {}, "新建项目"))
  ]);

  async function load(spin) {
    try {
      if (spin) host.classList.add("is-busy");
      const r = await api.readProjects();
      list = r.list;
      sha = r.sha;
      paint();
      if (spin) toast("已刷新", "ok");
    } catch (e) {
      host.innerHTML = "";
      host.append(emptyState("项目数据读取失败", e.hint || e.message || "请检查 content/projects.json"));
    } finally {
      host.classList.remove("is-busy");
    }
  }

  function paint() {
    host.innerHTML = "";

    if (!list.length) {
      host.append(emptyState("还没有项目", "项目卡片会按这里的顺序出现在前台项目页。",
        h("button", { class: "btn btn--primary", onclick: () => openForm(null) }, "新建第一个项目")));
      return;
    }

    const body = h("tbody");
    list.forEach((p, i) => {
      body.append(
        h("tr", {},
          h("td", { class: "td td--order" }, h("span", { class: "mono muted" }, String(i + 1).padStart(2, "0"))),
          h("td", { class: "td td--title" },
            h("span", { class: "rowtitle" }, p.name || "(未命名)"),
            h("span", { class: "rowsub" }, p.tagline || p.desc || "")),
          h("td", { class: "td td--tech" },
            h("span", { class: "taglist" }, ...(p.tech || []).slice(0, 4).map((t) => h("span", { class: "tag" }, t)))),
          h("td", { class: "td td--links" },
            p.repo ? h("a", { class: "minilink", href: p.repo, target: "_blank", rel: "noopener" }, "源码") : null,
            p.demo ? h("a", { class: "minilink", href: p.demo, target: "_blank", rel: "noopener" }, "演示") : null,
            !p.repo && !p.demo ? h("span", { class: "muted" }, "—") : null),
          h("td", { class: "td td--flag" },
            h("button", {
              class: "chip " + (p.featured ? "chip--project" : "chip--muted"),
              title: "切换精选（前台显示「进行中」标记）",
              onclick: () => toggleFeatured(i)
            }, p.featured ? "精选" : "普通")),
          h("td", { class: "td td--act" },
            iconBtn("up", "上移", () => move(i, -1)),
            iconBtn("down", "下移", () => move(i, 1)),
            iconBtn("edit", "编辑", () => openForm(i)),
            iconBtn("trash", "删除", () => remove(i), "icon-btn--danger"))
        )
      );
    });

    host.append(
      h("div", { class: "tablewrap" },
        h("table", { class: "table table--projects" },
          h("thead", {},
            h("tr", {},
              h("th", { class: "th th--order" }, "#"),
              h("th", { class: "th" }, "项目"),
              h("th", { class: "th th--tech" }, "技术栈"),
              h("th", { class: "th th--links" }, "链接"),
              h("th", { class: "th th--flag" }, "标记"),
              h("th", { class: "th th--act" }, ""))),
          body)),
      h("div", { class: "listfoot" },
        h("span", { class: "listfoot__info" }, `共 ${list.length} 个项目 · 顺序即前台顺序`),
        h("span", { class: "muted" }, "改动先进暂存区，点右上「发布」后上线"))
    );
  }

  async function persist(message) {
    try {
      sha = await api.writeProjects(list, sha, message);
      toast("已保存到暂存，点右上「发布」后上线", "ok", 3200);
      paint();
    } catch (e) {
      toast(e.hint || e.message || "保存失败", "error", 5000);
      await load(false);
    }
  }

  async function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const [item] = list.splice(i, 1);
    list.splice(j, 0, item);
    paint();
    await persist(`project: 调整顺序 ${item.name || item.id}`);
  }

  async function toggleFeatured(i) {
    list[i].featured = !list[i].featured;
    paint();
    await persist(`project: 标记 ${list[i].name || list[i].id}`);
  }

  async function remove(i) {
    const p = list[i];
    const ok = await confirmDialog({
      title: "删除这个项目？",
      body: `「${p.name || p.id}」会从前台项目页移除，此操作不可撤销。`,
      confirmText: "删除",
      danger: true
    });
    if (!ok) return;
    list.splice(i, 1);
    paint();
    await persist(`project: 删除 ${p.name || p.id}`);
  }

  /* ---------- 编辑弹窗 ---------- */
  function openForm(index) {
    const isNew = index == null;
    const src = isNew ? { id: "", name: "", tagline: "", desc: "", tech: [], featured: false, repo: "", demo: "" } : list[index];
    const draft = JSON.parse(JSON.stringify(src));

    const nameIn = input(draft.name, "例如 Pomofox");
    const idIn = input(draft.id, "pomofox（小写字母/数字/连字符）", "input--mono");
    const tagIn = input(draft.tagline, "一句话说明它是什么");
    const descTa = h("textarea", { class: "input textarea", rows: "4", placeholder: "两三句话说清动机与做法" });
    descTa.value = draft.desc || "";
    const techIn = input((draft.tech || []).join(", "), "Node.js, CLI, npm");
    const repoIn = input(draft.repo || "", "https://github.com/…");
    const demoIn = input(draft.demo || "", "https://…");
    const featuredIn = h("input", { type: "checkbox", checked: !!draft.featured });

    if (isNew) {
      nameIn.addEventListener("input", () => {
        if (idIn.dataset.touched === "1") return;
        idIn.value = slug(nameIn.value);
      });
      idIn.addEventListener("input", () => { idIn.dataset.touched = "1"; });
    }

    const errLine = h("p", { class: "formerr" });

    const overlay = h("div", { class: "overlay overlay--wide" },
      h("div", { class: "dialog dialog--form" },
        h("div", { class: "dialog__head" },
          h("h3", { class: "dialog__title" }, isNew ? "新建项目" : "编辑项目"),
          h("button", { class: "icon-btn", onclick: () => close() }, icon("close", 16))),
        h("div", { class: "formgrid" },
          field("名称", nameIn),
          field("标识 id", idIn, "用于内部识别，改 id 不影响前台链接"),
          field("一句话", tagIn),
          field("技术栈", techIn, "英文逗号分隔，前台渲染为标签"),
          field("源码", repoIn),
          field("演示", demoIn),
          field("简介", descTa, "支持多行纯文本"),
          field("精选", h("label", { class: "switch" }, featuredIn, h("span", {}, "在项目页加「进行中」标记")))),
        errLine,
        h("div", { class: "dialog__actions" },
          h("button", { class: "btn btn--ghost", onclick: () => close() }, "取消"),
          h("button", { class: "btn btn--primary", onclick: doSave }, icon("save", 15), h("span", {}, "保存"))))
    );

    function close() {
      overlay.classList.remove("in");
      setTimeout(() => overlay.remove(), 180);
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    async function doSave() {
      const name = nameIn.value.trim();
      const id = idIn.value.trim() || slug(name);
      if (!name) { errLine.textContent = "名称不能为空"; nameIn.focus(); return; }
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) { errLine.textContent = "id 只能包含小写字母、数字与连字符"; idIn.focus(); return; }
      if (list.some((p, i) => p.id === id && i !== index)) { errLine.textContent = "id 与现有项目重复"; idIn.focus(); return; }

      const p = {
        id,
        name,
        tagline: tagIn.value.trim(),
        desc: descTa.value.trim(),
        tech: techIn.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        featured: featuredIn.checked || undefined,
        repo: repoIn.value.trim() || undefined,
        demo: demoIn.value.trim() || undefined
      };
      Object.keys(p).forEach((k) => p[k] === undefined && delete p[k]);

      if (isNew) list.push(p);
      else list[index] = p;

      close();
      paint();
      await persist(`${isNew ? "project: 新建" : "project: 更新"} ${name}`);
    }

    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.classList.add("in"));
    setTimeout(() => (isNew ? nameIn : tagIn).focus(), 60);
  }

  await load(false);
}

/* ---------- 小工具 ---------- */
function input(value, placeholder, cls = "") {
  return h("input", { class: "input " + cls, value: value || "", placeholder: placeholder || "" });
}

function field(label, control, hint) {
  return h("div", { class: "formfield" },
    h("label", { class: "formfield__label" }, label),
    control,
    hint ? h("p", { class: "hint" }, hint) : null);
}

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
