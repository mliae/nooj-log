/* ============================================================
   Nooj Log 后台 — 写作页
   左：正文（Vditor 即时渲染）   右：元信息面板
   存储：md 为编辑源，content 为构建产物（由 md 渲染，前台直接读）
   ============================================================ */

import { h, icon, iconBtn, toast, confirmDialog, today, makeId, readTime, plainText, debounce } from "../util.js";
import { state, CATS, catLabel, serialize } from "../store.js";
import * as api from "../api.js";

const VENDOR = "/admin/app/vendor/vditor";

let vditor = null;

export async function renderEditor(container, ctx, id) {
  const isNew = !id;
  const post = isNew ? blankPost() : state.posts.find((p) => p.id === id);

  if (!post) {
    container.innerHTML = "";
    container.append(
      h("div", { class: "empty" },
        h("p", { class: "empty__title" }, "找不到这篇文章"),
        h("p", { class: "empty__desc" }, "它可能刚被删除，或文件名与 id 不一致。"),
        h("button", { class: "btn btn--ghost", onclick: () => { location.hash = "#/posts"; } }, "返回列表"))
    );
    ctx.setTopbar("编辑文章", [], "#/posts");
    return;
  }

  const snapshot = JSON.stringify(serialize(post));
  let dirty = false;

  const markDirty = () => {
    if (dirty) return;
    dirty = true;
    sessionStorage.setItem("nooj_dirty", "1");
    saveBtn.classList.add("is-dirty");
  };
  const clearDirty = () => {
    dirty = false;
    sessionStorage.removeItem("nooj_dirty");
    saveBtn.classList.remove("is-dirty");
  };

  /* ---------- 顶部 ---------- */
  const saveBtn = h("button", { class: "btn btn--primary", onclick: () => save(false) },
    icon("save", 15), h("span", {}, "保存"));
  const actions = [
    h("button", { class: "btn btn--ghost", onclick: () => preview() }, icon("eye", 15), h("span", {}, "预览")),
    saveBtn
  ];
  ctx.setTopbar(isNew ? "写文章" : "编辑文章", actions, "#/posts");

  /* ---------- 结构 ---------- */
  container.innerHTML = "";
  const titleInput = h("input", {
    class: "titleinput",
    type: "text",
    placeholder: "标题",
    value: post.title || "",
    oninput: () => {
      markDirty();
      if (!idTouched && isNew) {
        idInput.value = makeId(titleInput.value);
        idInput.dataset.auto = "1";
      }
      syncExcerptHint();
    }
  });

  const vdHost = h("div", { class: "vditor-host", id: "vditor-host" });
  const main = h("div", { class: "editor__main" }, titleInput, vdHost);
  const side = h("aside", { class: "editor__side" });

  container.append(h("div", { class: "editor" }, main, side));

  /* ---------- 元信息面板 ---------- */
  const catSel = h("select", {
    class: "select select--block",
    onchange: () => { post.cat = catSel.value; markDirty(); }
  }, ...CATS.map((c) => h("option", { value: c.id, selected: post.cat === c.id }, c.label)));

  const dateInput = h("input", {
    class: "input", type: "date", value: post.date || today(),
    onchange: () => { post.date = dateInput.value; markDirty(); }
  });

  const readInput = h("input", {
    class: "input", type: "number", min: "1", step: "1", value: post.read || 1,
    oninput: () => { post.read = Number(readInput.value) || 1; markDirty(); }
  });

  const idInput = h("input", {
    class: "input input--mono",
    value: post.id || "",
    placeholder: "my-post-slug",
    oninput: () => {
      idInput.dataset.auto = "0";
      idTouched = true;
      markDirty();
      validateId();
    }
  });
  let idTouched = !isNew;

  const excerptTa = h("textarea", {
    class: "input textarea", rows: "3", placeholder: "列表页与 SEO 描述，留空则自动截取正文",
    oninput: () => { post.excerpt = excerptTa.value; markDirty(); }
  });
  excerptTa.value = post.excerpt || "";

  const draftToggle = h("input", {
    type: "checkbox", checked: !!post.draft,
    onchange: () => { post.draft = draftToggle.checked; markDirty(); }
  });

  /* 标签 chips */
  const tagsValue = new Set(post.tags || []);
  const tagBox = h("div", { class: "tagbox" });
  const tagInput = h("input", {
    class: "tagbox__input", placeholder: "输入后回车",
    onkeydown: (e) => {
      const v = e.currentTarget.value.trim().replace(/^#/, "");
      if ((e.key === "Enter" || e.key === ",") && v) {
        e.preventDefault();
        tagsValue.add(v);
        e.currentTarget.value = "";
        paintTags();
        markDirty();
      } else if (e.key === "Backspace" && !e.currentTarget.value && tagsValue.size) {
        const last = Array.from(tagsValue).pop();
        tagsValue.delete(last);
        paintTags();
        markDirty();
      }
    },
    onblur: (e) => {
      const v = e.currentTarget.value.trim().replace(/^#/, "");
      if (v) { tagsValue.add(v); e.currentTarget.value = ""; paintTags(); markDirty(); }
    }
  });

  function paintTags() {
    tagBox.innerHTML = "";
    for (const t of tagsValue) {
      tagBox.append(
        h("span", { class: "tag tag--edit" }, "#" + t,
          h("button", {
            class: "tag__x", title: "移除", "aria-label": "移除标签",
            onclick: () => { tagsValue.delete(t); paintTags(); markDirty(); }
          }, "×"))
      );
    }
    tagBox.append(tagInput);
    post.tags = Array.from(tagsValue);
    syncSnapshotHint();
  }

  const excerptHint = h("p", { class: "hint" });

  side.append(
    section("发布", [
      row("分类", catSel),
      row("日期", dateInput),
      row("阅读", h("div", { class: "inline" }, readInput,
        h("button", { class: "btn btn--ghost btn--sm", onclick: autoRead }, "自动"))),
      row("状态", h("label", { class: "switch" }, draftToggle, h("span", {}, "草稿（不在前台显示）")))
    ]),
    section("摘要", [excerptTa,
      h("div", { class: "inlinerow" },
        h("button", { class: "btn btn--ghost btn--sm", onclick: fillExcerpt }, "从正文生成"),
        h("button", { class: "btn btn--ghost btn--sm", onclick: () => { excerptTa.value = ""; post.excerpt = ""; markDirty(); } }, "清空"))
    ]),
    section("标签", [tagBox, h("p", { class: "hint" }, "标签由文章聚合而成，不单独存储；改这里即改这篇的标签。")]),
    section("链接", [h("div", { class: "pathfield" },
      h("span", { class: "pathfield__pre" }, "content/posts/"),
      idInput,
      h("span", { class: "pathfield__suf" }, ".json")
    ), excerptHint]),
    h("div", { class: "side__danger" },
      isNew ? null : h("button", { class: "btn btn--danger btn--sm", onclick: removePost }, icon("trash", 14), h("span", {}, "删除这篇")))
  );

  /* ---------- 编辑器 ---------- */
  initVditor(post);
  paintTags();
  syncExcerptHint();

  /* ---------- 逻辑 ---------- */
  function autoRead() {
    const md = vditor ? vditor.getValue() : post.md || "";
    const guess = readTime(plainText(md.replace(/[#*`>_\-]/g, " ")));
    readInput.value = guess;
    post.read = guess;
    markDirty();
  }

  function fillExcerpt() {
    const md = vditor ? vditor.getValue() : post.md || "";
    const text = plainText(md.replace(/^#{1,6}\s+/gm, "").replace(/[`*_>#-]/g, " "));
    excerptTa.value = text.slice(0, 90).trim();
    post.excerpt = excerptTa.value;
    markDirty();
    syncExcerptHint();
  }

  function syncExcerptHint() {
    const len = (excerptTa.value || "").length;
    excerptHint.textContent = len ? `链接将写入 content/posts/${(idInput.value || "…")}.json` : "";
    if (len > 140) excerptHint.textContent = "摘要偏长（建议 90 字内），会挤占列表卡片空间。";
  }

  function syncSnapshotHint() { /* 预留：字符数等提示位 */ }

  function validateId() {
    const v = idInput.value.trim();
    const ok = /^[a-z0-9][a-z0-9-]*$/.test(v);
    idInput.classList.toggle("is-invalid", !ok);
    excerptHint.textContent = ok ? `链接将写入 content/posts/${v}.json` : "id 只能包含小写字母、数字与连字符";
    return ok;
  }

  async function preview() {
    const md = vditor ? vditor.getValue() : post.md || "";
    const html = await window.Vditor.md2html(md, { hljs: { enable: true, style: "github" }, math: { enable: false } });
    const overlay = h("div", { class: "overlay overlay--wide" },
      h("div", { class: "dialog dialog--preview" },
        h("div", { class: "preview__head" },
          h("span", { class: "preview__title" }, post.title || "未命名"),
          h("button", { class: "icon-btn", onclick: () => overlay.remove() }, icon("close", 16))
        ),
        h("article", { class: "preview__body vditor-reset", html })
      ));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.classList.add("in"));
  }

  async function save(thenBack) {
    if (!validateId()) { toast("请先修正文章 id", "error"); return; }
    if (!titleInput.value.trim()) { toast("标题不能为空", "error"); titleInput.focus(); return; }

    const md = vditor ? vditor.getValue() : post.md || "";
    saveBtn.disabled = true;
    saveBtn.querySelector("span").textContent = "保存中…";

    try {
      const html = await window.Vditor.md2html(md, { hljs: { enable: true, style: "github" }, math: { enable: false } });

      const next = {
        id: idInput.value.trim(),
        title: titleInput.value.trim(),
        cat: catSel.value,
        date: dateInput.value || today(),
        read: Number(readInput.value) || 1,
        tags: Array.from(tagsValue),
        excerpt: excerptTa.value.trim() || plainText(md).slice(0, 90),
        draft: draftToggle.checked || undefined,
        md,
        content: html,
        _path: post._path,
        _sha: post._sha
      };

      const newPath = `content/posts/${next.id}.json`;
      const text = JSON.stringify(serialize(next), null, 2) + "\n";
      const msg = `${isNew ? "post: 新建" : "post: 更新"}《${next.title}》`;

      const sha = post._path === newPath ? post._sha : null;
      await api.writeFile(newPath, text, msg, sha);
      if (post._path && post._path !== newPath) {
        await api.deleteFiles([post._path], `post: 重命名 ${post._path} → ${newPath}`);
      }

      clearDirty();
      toast("已保存到暂存，点右上「发布」后上线", "ok", 3600);
      await ctx.reload();
      if (thenBack) location.hash = "#/posts";
      else {
        const fresh = state.posts.find((p) => p.id === next.id);
        if (fresh) { post._sha = fresh._sha; post._path = fresh._path; }
      }
    } catch (e) {
      toast(e.hint || e.message || "保存失败", "error", 6000);
    } finally {
      saveBtn.disabled = false;
      saveBtn.querySelector("span").textContent = "保存";
    }
  }

  async function removePost() {
    const ok = await confirmDialog({
      title: "删除这篇文章？",
      body: `《${post.title || post.id}》将从仓库移除，并触发站点重建。`,
      confirmText: "删除", danger: true
    });
    if (!ok) return;
    try {
      await api.deleteFiles([post._path], `post: 删除《${post.title || post.id}》`);
      clearDirty();
      await ctx.reload();
      toast("已删除", "ok");
      location.hash = "#/posts";
    } catch (e) {
      toast(e.hint || e.message || "删除失败", "error", 5000);
    }
  }

  /* 键盘：Cmd/Ctrl + S */
  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save(false);
    }
  };
  document.addEventListener("keydown", onKey);

  /* 离开拦截 */
  ctx.setGuard(async () => {
    if (!dirty) { document.removeEventListener("keydown", onKey); return true; }
    const leave = await confirmDialog({
      title: "有未保存的修改",
      body: "离开后这些修改会丢失。",
      confirmText: "放弃修改并离开",
      cancelText: "继续编辑",
      danger: true
    });
    if (leave) {
      clearDirty();
      document.removeEventListener("keydown", onKey);
    }
    return leave;
  });

  /* 清理上一次实例 */
  function initVditor(p) {
    if (vditor) { try { vditor.destroy(); } catch (e) {} vditor = null; }

    const md = p.md != null ? p.md : htmlToMd(p.content || "");
    const dark = document.documentElement.getAttribute("data-theme") === "dark";

    vditor = new window.Vditor(vdHost, {
      cdn: VENDOR,
      lang: "zh_CN",
      mode: "ir",
      theme: dark ? "dark" : "classic",
      height: "100%",
      minHeight: 360,
      value: md,
      placeholder: "开始写…  支持 Markdown、代码块、图片拖拽",
      cache: { enable: false },
      counter: { enable: true, type: "markdown" },
      toolbar: [
        "headings", "bold", "italic", "strike", "|",
        "list", "ordered-list", "check", "|",
        "quote", "line", "code", "inline-code", "link", "table", "|",
        "upload", "undo", "redo", "|", "edit-mode", "preview", "fullscreen"
      ],
      preview: {
        hljs: { enable: true, style: "github", lineNumber: false },
        math: { enable: false },
        theme: { current: dark ? "dark" : "light", path: VENDOR + "/dist/css/content-theme" },
        markdown: { toc: true, mark: false }
      },
      upload: {
        accept: "image/*",
        handler: async (files) => {
          for (const f of files) {
            try {
              toast(`正在上传 ${f.name}…`, "info", 1500);
              const r = await api.uploadMedia(f);
              const url = r.url;
              const name = f.name.replace(/\.[^.]+$/, "");
              vditor.insertValue(`\n![${name}](${url})\n`);
              markDirty();
            } catch (e) {
              toast("上传失败：" + (e.message || ""), "error", 5000);
            }
          }
        }
      },
      input: () => markDirty()
    });
  }
}

/* ---------- 小工具 ---------- */
function section(title, children) {
  return h("section", { class: "panel" },
    h("h3", { class: "panel__title" }, title),
    ...children
  );
}

function row(label, control) {
  return h("div", { class: "field" },
    h("span", { class: "field__label" }, label),
    h("div", { class: "field__control" }, control)
  );
}

function blankPost() {
  return {
    id: makeId(""),
    title: "",
    cat: "dev",
    date: today(),
    read: 1,
    tags: [],
    excerpt: "",
    md: "",
    content: ""
  };
}

/* 老文章只有 HTML：用本地 turndown 转一次（新文章都带 md） */
function htmlToMd(html) {
  if (!html) return "";
  if (!window.TurndownService) return html;
  const td = new window.TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
    hr: "---"
  });
  td.addRule("preLang", {
    filter: "pre",
    replacement: (content, node) => {
      const code = node.querySelector("code");
      const text = (code ? code.textContent : node.textContent).replace(/\n+$/, "");
      const lang = node.getAttribute("data-lang") || "";
      return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
    }
  });
  return td.turndown(html).replace(/\n{3,}/g, "\n\n").trim();
}
