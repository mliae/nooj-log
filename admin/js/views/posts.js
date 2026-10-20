/* ============================================================
   Nooj Log 后台 — 文章列表
   Typecho 式信息密度：一行看全，勾选批删，点表头排序
   ============================================================ */

import { $, h, $$, icon, iconBtn, toast, confirmDialog, emptyState, fmtDate, relDate, debounce, plainText } from "../util.js";
import { state, CATS, catLabel, tagStats, loadPosts } from "../store.js";
import * as api from "../api.js";

const PAGE_SIZE = 20;

/* 视图内状态：不写进 URL，刷新即重置（Typecho 也是这样） */
const ui = {
  q: "",
  cat: "",
  tag: "",
  sort: "date",
  dir: "desc",
  page: 1,
  selected: new Set(),
  busy: false
};

export async function renderPosts(container, ctx) {
  container.innerHTML = "";

  const topActions = [
    h("button", { class: "btn btn--ghost", onclick: () => refresh(ctx) }, "刷新"),
    h("button", { class: "btn btn--primary", onclick: () => { location.hash = "#/posts/new"; } },
      icon("plus", 15), h("span", {}, "写文章"))
  ];
  ctx.setTopbar("文章", topActions);

  const listHost = h("div", { class: "list" });
  container.append(listHost);

  /* 事件对象在防抖回调里 currentTarget 已失效，先取值再延迟 */
  const applySearch = debounce((v) => { ui.q = v; ui.page = 1; paint(); }, 160);

  const searchInput = h("input", {
    class: "input search__input",
    type: "search",
    placeholder: "搜索标题、摘要、标签…",
    value: ui.q,
    oninput: (e) => applySearch(e.currentTarget.value.trim())
  });

  const catSel = h("select", {
    class: "select",
    onchange: (e) => { ui.cat = e.currentTarget.value; ui.page = 1; paint(); }
  },
    h("option", { value: "" }, "全部分类"),
    ...CATS.map((c) => h("option", { value: c.id, selected: ui.cat === c.id }, c.label))
  );

  const tagSel = h("select", {
    class: "select",
    onchange: (e) => { ui.tag = e.currentTarget.value; ui.page = 1; paint(); }
  }, h("option", { value: "" }, "全部标签"));

  function fillTags() {
    const tags = tagStats();
    tagSel.innerHTML = "";
    tagSel.append(h("option", { value: "" }, "全部标签"));
    for (const t of tags) tagSel.append(h("option", { value: t.name, selected: ui.tag === t.name }, `${t.name}（${t.count}）`));
  }

  const bar = h("div", { class: "toolbar" },
    h("div", { class: "search" }, icon("search", 15), searchInput),
    catSel,
    tagSel
  );

  const bulkHost = h("div", { class: "bulkhost" });
  const tableHost = h("div", { class: "tablewrap" });
  const foot = h("div", { class: "listfoot" });

  listHost.append(bar, bulkHost, tableHost, foot);

  /* ---------- 数据派生 ---------- */
  function filtered() {
    const q = ui.q.toLowerCase();
    let rows = state.posts.filter((p) => {
      if (ui.cat && p.cat !== ui.cat) return false;
      if (ui.tag && !(p.tags || []).includes(ui.tag)) return false;
      if (!q) return true;
      const hay = [p.title, p.excerpt, p.id, (p.tags || []).join(" ")].join(" ").toLowerCase();
      return hay.includes(q);
    });
    const dir = ui.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let x, y;
      if (ui.sort === "title") { x = String(a.title || ""); y = String(b.title || ""); return x.localeCompare(y, "zh") * dir; }
      if (ui.sort === "read") { x = Number(a.read) || 0; y = Number(b.read) || 0; return (x - y) * dir; }
      if (ui.sort === "cat") { x = catLabel(a.cat); y = catLabel(b.cat); return x.localeCompare(y, "zh") * dir; }
      x = String(a.date || ""); y = String(b.date || "");
      return x.localeCompare(y) * dir;
    });
    return rows;
  }

  /* ---------- 表头 ---------- */
  function th(label, key, cls = "") {
    const active = ui.sort === key;
    return h("th", {
      class: `th ${cls} ${active ? "is-sort" : ""}`,
      onclick: () => {
        if (ui.sort === key) ui.dir = ui.dir === "asc" ? "desc" : "asc";
        else { ui.sort = key; ui.dir = key === "title" || key === "cat" ? "asc" : "desc"; }
        paint();
      }
    }, h("span", {}, label), active ? h("i", { class: "sortmark" }, ui.dir === "asc" ? "↑" : "↓") : null);
  }

  /* ---------- 批量条 ---------- */
  function bulkBar(rowsOnPage) {
    if (!ui.selected.size) return null;
    const n = ui.selected.size;
    return h("div", { class: "bulk" },
      h("span", { class: "bulk__count" }, `已选 ${n} 篇`),
      h("button", {
        class: "btn btn--ghost btn--sm",
        onclick: () => { ui.selected.clear(); paint(); }
      }, "取消选择"),
      h("button", {
        class: "btn btn--danger btn--sm",
        onclick: () => removeSelected(ctx)
      }, icon("trash", 14), h("span", {}, "删除所选"))
    );
  }

  /* ---------- 主渲染 ---------- */
  function paint() {
    fillTags();
    const rows = filtered();
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (ui.page > totalPages) ui.page = totalPages;
    const start = (ui.page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    tableHost.innerHTML = "";
    bulkHost.innerHTML = "";

    if (!state.posts.length) {
      tableHost.append(emptyState("还没有文章", "写下第一篇，保存进暂存区，点右上「发布」后上线。",
        h("button", { class: "btn btn--primary", onclick: () => { location.hash = "#/posts/new"; } }, "写第一篇")));
      foot.innerHTML = "";
      return;
    }

    if (!rows.length) {
      tableHost.append(emptyState("没有匹配的文章", "换个关键词，或清空筛选条件。",
        h("button", { class: "btn btn--ghost", onclick: () => {
          ui.q = ""; ui.cat = ""; ui.tag = ""; ui.page = 1;
          searchInput.value = ""; catSel.value = ""; paint();
        } }, "清空筛选")));
      foot.innerHTML = "";
      return;
    }

    const allChecked = pageRows.length > 0 && pageRows.every((p) => ui.selected.has(p.id));

    const head = h("thead", {},
      h("tr", {},
        h("th", { class: "th th--check" },
          h("input", {
            type: "checkbox", checked: allChecked, "aria-label": "全选本页",
            onchange: (e) => {
              const on = e.currentTarget.checked;
              pageRows.forEach((p) => on ? ui.selected.add(p.id) : ui.selected.delete(p.id));
              paint();
            }
          })),
        th("标题", "title"),
        th("分类", "cat", "th--cat"),
        h("th", { class: "th th--tags" }, "标签"),
        th("日期", "date", "th--date"),
        th("阅读", "read", "th--read"),
        h("th", { class: "th th--act" }, "")
      )
    );

    const body = h("tbody");
    for (const p of pageRows) {
      const checked = ui.selected.has(p.id);
      body.append(
        h("tr", { class: checked ? "is-selected" : "" },
          h("td", { class: "td td--check" },
            h("input", {
              type: "checkbox", checked, "aria-label": "选择",
              onchange: (e) => {
                if (e.currentTarget.checked) ui.selected.add(p.id); else ui.selected.delete(p.id);
                paint();
              }
            })),
          h("td", { class: "td td--title" },
            h("a", { class: "rowtitle", href: `#/posts/${encodeURIComponent(p.id)}` },
              p.title || "(无标题)",
              p.draft ? h("span", { class: "badge badge--draft" }, "草稿") : null
            ),
            h("span", { class: "rowsub" }, truncate(p.excerpt || plainText(p.content), 46))
          ),
          h("td", { class: "td td--cat" },
            h("span", { class: `chip chip--${p.cat || "dev"}` }, catLabel(p.cat))),
          h("td", { class: "td td--tags" },
            h("span", { class: "taglist" }, ...(p.tags || []).slice(0, 3).map((t) =>
              h("button", {
                class: "tag", title: "按此标签筛选",
                onclick: () => { ui.tag = t; ui.page = 1; paint(); }
              }, "#" + t))),
            (p.tags || []).length > 3 ? h("span", { class: "muted" }, "+" + ((p.tags || []).length - 3)) : null
          ),
          h("td", { class: "td td--date" },
            h("span", { title: fmtDate(p.date) }, relDate(p.date))),
          h("td", { class: "td td--read" }, (p.read || "—") + (p.read ? " 分钟" : "")),
          h("td", { class: "td td--act" },
            iconBtn("edit", "编辑", () => { location.hash = `#/posts/${encodeURIComponent(p.id)}`; }),
            iconBtn("eye", "前台查看", () => window.open(`/post.html?id=${encodeURIComponent(p.id)}`, "_blank")),
            iconBtn("trash", "删除", () => removeOne(p, ctx), "icon-btn--danger")
          )
        )
      );
    }

    tableHost.append(h("table", { class: "table" }, head, body));

    const bb = bulkBar(pageRows);
    if (bb) bulkHost.append(bb);

    /* 分页 */
    foot.innerHTML = "";
    foot.append(
      h("span", { class: "listfoot__info" },
        `共 ${rows.length} 篇` + (state.broken ? `（${state.broken} 个文件解析失败）` : "")),
      h("div", { class: "pager" },
        h("button", {
          class: "pager__btn", disabled: ui.page <= 1, onclick: () => { ui.page--; paint(); }
        }, "上一页"),
        h("span", { class: "pager__now" }, `${ui.page} / ${totalPages}`),
        h("button", {
          class: "pager__btn", disabled: ui.page >= totalPages, onclick: () => { ui.page++; paint(); }
        }, "下一页")
      )
    );
  }

  /* ---------- 动作 ---------- */
  async function removeOne(post, ctx2) {
    const ok = await confirmDialog({
      title: "删除这篇文章？",
      body: `《${post.title || post.id}》将从仓库删除，并触发站点重建。此操作不可撤销。`,
      confirmText: "删除",
      danger: true
    });
    if (!ok) return;
    try {
      ui.busy = true;
      setBusy(true);
      await api.deleteFiles([post._path], `post: 删除《${post.title || post.id}》`);
      ui.selected.delete(post.id);
      await ctx2.reload();
      toast("已删除", "ok");
      paint();
    } catch (e) {
      toast(e.hint || e.message || "删除失败", "error", 5000);
    } finally {
      ui.busy = false;
      setBusy(false);
    }
  }

  async function removeSelected() {
    const ids = Array.from(ui.selected);
    const items = state.posts.filter((p) => ids.includes(p.id));
    const ok = await confirmDialog({
      title: `删除选中的 ${items.length} 篇文章？`,
      body: "将以一次提交删除这些文件，并触发站点重建。此操作不可撤销。",
      confirmText: "全部删除",
      danger: true
    });
    if (!ok) return;
    try {
      setBusy(true);
      await api.deleteFiles(items.map((p) => p._path), `post: 批量删除 ${items.length} 篇`);
      ui.selected.clear();
      await ctx.reload();
      toast(`已删除 ${items.length} 篇`, "ok");
      paint();
    } catch (e) {
      toast(e.hint || e.message || "批量删除失败", "error", 5000);
    } finally {
      setBusy(false);
    }
  }

  async function refresh(ctx2) {
    try {
      setBusy(true);
      await ctx2.reload();
      paint();
      toast("已刷新", "ok");
    } catch (e) {
      toast(e.hint || e.message || "刷新失败", "error");
    } finally { setBusy(false); }
  }

  function setBusy(on) {
    container.classList.toggle("is-busy", on);
  }

  paint();
}

function truncate(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}
