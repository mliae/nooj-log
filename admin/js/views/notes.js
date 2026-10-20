/* ============================================================
   Nooj Log 后台 — 说说（碎片流）
   数据源：content/notes.json（单文件数组，时间倒序）
   交互：上方一条快速输入 → 下方时间线；写完即发布，不设草稿字段，
        未发出的内容暂存在本机 localStorage，换设备不带走。
   ============================================================ */

import { h, icon, iconBtn, toast, confirmDialog, emptyState, debounce } from "../util.js";
import * as api from "../api.js";
import { openMusicPicker } from "../music-picker.js";
import { marker } from "../song-mark.js";

const DRAFT_KEY = "nooj_note_draft";

export async function renderNotes(container, ctx) {
  container.innerHTML = "";

  let list = [];
  let sha = null;
  let editing = null; /* 正在编辑的 note.id，null 表示新建 */
  let images = [];
  let busy = false;

  /* ---------- 结构 ---------- */
  const ta = h("textarea", {
    class: "composer__input",
    rows: "3",
    placeholder: "此刻想说点什么？一句话也行。",
    "aria-label": "说说内容"
  });

  const tagIn = h("input", {
    class: "input composer__tag",
    placeholder: "标签（空格或逗号分隔）",
    "aria-label": "标签"
  });

  const pinChk = h("input", { type: "checkbox" });

  const countEl = h("span", { class: "composer__count mono" }, "0");

  const imgHost = h("div", { class: "composer__imgs" });

  const submitBtn = h("button", { class: "btn btn--primary", onclick: () => publish() },
    icon("check", 15), h("span", {}, "发布"));

  const cancelBtn = h("button", { class: "btn btn--ghost", style: "display:none", onclick: () => resetComposer() },
    "取消编辑");

  const fileIn = h("input", { type: "file", accept: "image/*", multiple: true, style: "display:none" });
  fileIn.addEventListener("change", () => {
    addFiles(Array.from(fileIn.files || []));
    fileIn.value = "";
  });

  const pickBtn = h("button", { class: "btn btn--ghost", onclick: () => fileIn.click() },
    icon("image", 15), h("span", {}, "图片"));

  const musicBtn = h("button", {
    class: "btn btn--ghost",
    title: "插入一首歌（前台渲染成可点播的卡片）",
    onclick: () => openMusicPicker({ onPick: (t) => insertMarker(marker(t)) })
  }, icon("music", 15), h("span", {}, "音乐"));

  const titleEl = h("span", { class: "composer__title" }, "说点什么");

  const composer = h("section", { class: "composer" },
    h("div", { class: "composer__head" },
      titleEl,
      h("span", { class: "composer__hint mono" }, "Ctrl / ⌘ + Enter 发布")),
    ta,
    imgHost,
    h("div", { class: "composer__bar" },
      tagIn,
      h("label", { class: "composer__check" },       pinChk, h("span", {}, "置顶")),
      pickBtn,
      musicBtn,
      countEl,
      submitBtn,
      cancelBtn,
      fileIn));

  const listHost = h("div", { class: "nlist" });

  container.append(composer, listHost);

  ctx.setTopbar("说说", [
    h("button", { class: "btn btn--ghost", onclick: () => load(true) }, icon("refresh", 15), h("span", {}, "刷新")),
    h("a", { class: "btn btn--ghost", href: "/notes.html", target: "_blank", rel: "noopener" },
      h("span", {}, "看前台"), icon("link", 15))
  ]);

  /* ---------- 输入体验 ---------- */
  function autoGrow() {
    ta.style.height = "auto";
    ta.style.height = Math.min(Math.max(ta.scrollHeight, 84), 420) + "px";
  }

  /* 在光标处插入音乐标记，前后留空行让前台单独成卡片 */
  function insertMarker(text) {
    const v = ta.value;
    const start = ta.selectionStart == null ? v.length : ta.selectionStart;
    const end = ta.selectionEnd == null ? v.length : ta.selectionEnd;
    const before = v.slice(0, start);
    const after = v.slice(end);
    const pre = !before ? "" : /\n\n$/.test(before) ? "" : /\n$/.test(before) ? "\n" : "\n\n";
    const post = !after ? "\n\n" : /^\n\n/.test(after) ? "" : /^\n/.test(after) ? "\n" : "\n\n";
    ta.value = before + pre + text + post + after;
    const pos = (before + pre + text).length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    ta.dispatchEvent(new Event("input")); /* 触发计数 / 自动增高 / 本地暂存 */
    toast("已插入音乐，可继续写点别的", "ok", 2400);
  }

  const stashDraft = debounce(() => {
    if (editing) return; /* 编辑已有内容不做本地暂存，避免串味 */
    try {
      const payload = { text: ta.value, tags: tagIn.value, images: images.slice(), pinned: pinChk.checked };
      if (!payload.text.trim() && !payload.images.length) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch (e) { /* 隐私模式下写不进去，忽略 */ }
  }, 400);

  ta.addEventListener("input", () => {
    autoGrow();
    countEl.textContent = String(ta.value.length);
    stashDraft();
  });

  ta.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      publish();
    }
  });

  /* 粘贴图片：截图后直接 Ctrl+V */
  ta.addEventListener("paste", (e) => {
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  });

  composer.addEventListener("dragover", (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
    e.preventDefault();
    composer.classList.add("is-over");
  });
  composer.addEventListener("dragleave", () => composer.classList.remove("is-over"));
  composer.addEventListener("drop", (e) => {
    if (!e.dataTransfer) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    e.preventDefault();
    composer.classList.remove("is-over");
    addFiles(files);
  });

  tagIn.addEventListener("input", () => stashDraft());

  /* ---------- 图片 ---------- */
  async function addFiles(files) {
    for (const f of files) {
      if (!/^image\//.test(f.type || "")) {
        toast(`${f.name} 不是图片`, "error");
        continue;
      }
      try {
        toast(`正在上传 ${f.name}…`, "info", 1400);
        const r = await api.uploadMedia(f);
        images.push(r.url);
        paintImages();
        stashDraft();
      } catch (e) {
        toast(e.hint || e.message || "图片上传失败", "error", 5000);
      }
    }
  }

  function paintImages() {
    imgHost.innerHTML = "";
    if (!images.length) return;
    images.forEach((src, i) => {
      imgHost.append(
        h("div", { class: "composer__thumb" },
          h("img", { src, alt: "", loading: "lazy" }),
          h("button", {
            class: "composer__thumbx",
            type: "button",
            title: "移除",
            onclick: () => { images.splice(i, 1); paintImages(); stashDraft(); }
          }, icon("close", 12)))
      );
    });
  }

  /* ---------- 发布 / 编辑 ---------- */
  async function publish() {
    if (busy) return;
    const text = ta.value.trim();
    if (!text && !images.length) {
      toast("写点什么，或者加张图", "error");
      ta.focus();
      return;
    }

    busy = true;
    submitBtn.disabled = true;
    submitBtn.lastChild.textContent = "提交中…";

    const tags = parseTags(tagIn.value);
    const pinned = pinChk.checked;

    try {
      if (editing) {
        const i = list.findIndex((n) => n.id === editing);
        if (i < 0) throw new Error("这条说说已经不存在了");
        list[i] = clean({ ...list[i], text, tags, images: images.slice(), pinned });
        await persist(`note: 更新 ${editing}`);
      } else {
        const stamp = nowStamp();
        const note = clean({ id: uniqueId(makeId(stamp), list), date: stamp, text, tags, images: images.slice(), pinned });
        list.unshift(note);
        await persist(`note: 发布 ${note.date}`);
      }
      resetComposer();
    } catch (e) {
      toast(e.hint || e.message || "发布失败", "error", 5000);
    } finally {
      busy = false;
      submitBtn.disabled = false;
      /* 编辑态被 reset 后 editing 已置空，这里按当前状态回填文案 */
      submitBtn.lastChild.textContent = editing ? "保存修改" : "发布";
    }
  }

  function startEdit(n) {
    editing = n.id;
    ta.value = n.text || "";
    tagIn.value = (n.tags || []).join(" ");
    pinChk.checked = !!n.pinned;
    images = (n.images || []).slice();
    paintImages();
    autoGrow();
    countEl.textContent = String(ta.value.length);

    titleEl.textContent = "编辑这条（" + n.date + "）";
    submitBtn.lastChild.textContent = "保存修改";
    cancelBtn.style.display = "";
    composer.classList.add("is-editing");
    window.scrollTo({ top: 0, behavior: "smooth" });
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function resetComposer() {
    editing = null;
    ta.value = "";
    tagIn.value = "";
    pinChk.checked = false;
    images = [];
    paintImages();
    autoGrow();
    countEl.textContent = "0";
    titleEl.textContent = "说点什么";
    submitBtn.lastChild.textContent = "发布";
    cancelBtn.style.display = "none";
    composer.classList.remove("is-editing");
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
  }

  /* ---------- 列表 ---------- */
  function paintList() {
    listHost.innerHTML = "";

    if (!list.length) {
      listHost.append(emptyState(
        "还没有说说",
        "碎念会按时间倒序出现在前台「说说」页，也会出现在首页「最近说」。",
        h("button", { class: "btn btn--primary", onclick: () => ta.focus() }, "写第一条")
      ));
      return;
    }

    const sorted = sortNotes(list);
    sorted.forEach((n) => {
      /* 列表预览里音乐标记显示成 ♪ 歌名；编辑时仍是原始标记 */
      const previewText = String(n.text || "").replace(
        /!song\(\s*[A-Za-z0-9_-]+\s*(?:\|([^|\n)]*)\|([^\n)]*))?\s*\)/g,
        (m, name, artist) => "♪ " + (name || artist || "音乐"));
      listHost.append(
        h("article", { class: "ncard" + (n.pinned ? " is-pinned" : "") + (editing === n.id ? " is-editing" : "") },
          h("div", { class: "ncard__bar" },
            h("time", { class: "ncard__time mono" }, n.date || "—"),
            n.pinned ? h("span", { class: "ncard__pin" }, "置顶") : null,
            h("span", { class: "ncard__acts" },
              iconBtn("pin", n.pinned ? "取消置顶" : "置顶", () => togglePin(n), n.pinned ? "is-on" : ""),
              iconBtn("link", "复制这条的链接", () => copyLink(n)),
              iconBtn("edit", "编辑", () => startEdit(n)),
              iconBtn("trash", "删除", () => removeNote(n), "icon-btn--danger"))),
          h("p", { class: "ncard__text" }, previewText),
          (n.images || []).length
            ? h("div", { class: "ncard__imgs" },
                ...n.images.map((src) => h("img", { src, alt: "", loading: "lazy" })))
            : null,
          (n.tags || []).length
            ? h("div", { class: "ncard__tags" },
                ...n.tags.map((t) => h("span", { class: "tag" }, "#" + t)))
            : null)
      );
    });
  }

  async function togglePin(n) {
    const i = list.findIndex((x) => x.id === n.id);
    if (i < 0) return;
    list[i] = { ...list[i], pinned: !list[i].pinned };
    if (!list[i].pinned) delete list[i].pinned;
    await persist(`note: ${list[i].pinned ? "置顶" : "取消置顶"} ${n.id}`);
  }

  async function removeNote(n) {
    const ok = await confirmDialog({
      title: "删除这条说说？",
      body: `「${shorten(n.text)}」会从前台消失，此操作不可撤销。`,
      confirmText: "删除",
      danger: true
    });
    if (!ok) return;
    list = list.filter((x) => x.id !== n.id);
    await persist(`note: 删除 ${n.id}`);
    if (editing === n.id) resetComposer();
  }

  async function copyLink(n) {
    const url = location.origin + "/notes.html#" + encodeURIComponent(n.id);
    try {
      await navigator.clipboard.writeText(url);
      toast("链接已复制", "ok");
    } catch (e) {
      toast(url, "info", 5000);
    }
  }

  /* ---------- 读写 ---------- */
  async function persist(message) {
    try {
      const next = sortNotes(list);
      sha = await api.writeNotes(next, sha, message);
      list = next;
      paintList();
      toast("已保存到暂存，点右上「发布」后上线", "ok", 3200);
    } catch (e) {
      toast(e.hint || e.message || "保存失败", "error", 5000);
      await load(false);
    }
  }

  async function load(spin) {
    try {
      if (spin) listHost.classList.add("is-busy");
      const r = await api.readNotes();
      list = r.list;
      sha = r.sha;
      paintList();
      if (spin) toast("已刷新", "ok");
    } catch (e) {
      listHost.innerHTML = "";
      listHost.append(emptyState("说说读取失败", e.hint || e.message || "请检查 content/notes.json"));
    } finally {
      listHost.classList.remove("is-busy");
    }
  }

  /* ---------- 启动：恢复本机暂存 ---------- */
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && (d.text || (d.images || []).length)) {
        ta.value = d.text || "";
        tagIn.value = d.tags || "";
        images = d.images || [];
        pinChk.checked = !!d.pinned;
        paintImages();
        countEl.textContent = String(ta.value.length);
        toast("已恢复上次未发出的草稿", "info", 3200);
      }
    }
  } catch (e) { /* ignore */ }

  autoGrow();
  await load(false);
}

/* ---------- 小工具 ---------- */
function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function makeId(stamp) {
  return stamp.replace(/[-: ]/g, "");
}

/* 同一分钟内发两条时，id 会撞车，这里补 -2 / -3 */
function uniqueId(base, arr) {
  let id = base;
  let i = 2;
  while (arr.some((n) => n.id === id)) id = `${base}-${i++}`;
  return id;
}

function parseTags(v) {
  return String(v || "").split(/[,，\s]+/).map((s) => s.trim().replace(/^#/, "")).filter(Boolean)
    .filter((t, i, arr) => arr.indexOf(t) === i);
}

function clean(n) {
  const out = { ...n };
  if (!out.tags || !out.tags.length) delete out.tags;
  if (!out.images || !out.images.length) delete out.images;
  if (!out.pinned) delete out.pinned;
  return out;
}

function sortNotes(arr) {
  return arr.slice().sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return String(b.date).localeCompare(String(a.date)) || String(a.id).localeCompare(String(b.id));
  });
}

function shorten(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > 28 ? t.slice(0, 28) + "…" : t || "(空)";
}
