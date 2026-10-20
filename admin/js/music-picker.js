/* ============================================================
   Nooj Log 后台 — 选歌弹窗（文章编辑器 / 说说输入框共用）
   ------------------------------------------------------------
   两个标签页：
     · 博客歌单：浏览器直连 music-api 公开接口（不需要 ApiKey）
     · 搜索入库：走 /api/music 代理，入库后直接插入
   选中后回调 onPick({ id, name, artist })，id 形如 "t22"。
   ============================================================ */

import { h, icon, toast } from "./util.js";
import * as music from "./musicapi.js";

const SOURCES = [
  ["netease", "网易云"],
  ["qq", "QQ 音乐"],
  ["kugou", "酷狗"],
  ["kuwo", "酷我"],
  ["qishui", "汽水"]
];

export function openMusicPicker({ onPick }) {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.classList.remove("in");
    setTimeout(() => overlay.remove(), 180);
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };

  const pickBtn = h("button", { class: "btn btn--primary", onclick: () => close(false) }, "取消");

  const overlay = h(
    "div",
    { class: "overlay" },
    h(
      "div",
      { class: "dialog dialog--picker" },
      h("h3", { class: "dialog__title" }, "插入音乐"),
      h("p", { class: "dialog__body" }, "选一首插入正文，前台会渲染成内嵌播放卡片。"),
      (() => {
        const box = h("div", { class: "picker" });

        /* ---- 标签页 ---- */
        const tabList = h("div", { class: "tabs" });
        const pane1 = h("div", { class: "picker__pane" });
        const pane2 = h("div", { class: "picker__pane", style: "display:none" });
        box.append(tabList, pane1, pane2);

        function activate(name) {
          tabList.querySelectorAll(".tabs__btn").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === name));
          pane1.style.display = name === "list" ? "" : "none";
          pane2.style.display = name === "search" ? "" : "none";
        }
        tabList.append(
          h("button", { class: "tabs__btn is-active", "data-tab": "list", onclick: () => activate("list") }, "博客歌单"),
          h("button", { class: "tabs__btn", "data-tab": "search", onclick: () => activate("search") }, "搜索五平台")
        );

        /* ---- 歌单 ---- */
        pane1.append(h("p", { class: "hint" }, "正在读取博客歌单…"));
        music.blogPlaylist().then((list) => {
          pane1.innerHTML = "";
          if (!list.length) {
            pane1.append(h("p", { class: "hint" }, "博客歌单还是空的——先到「音乐」页把歌加进歌单，或切到搜索页。"));
            return;
          }
          const wrap = h("div", { class: "music-lib" });
          for (const s of list) {
            const row = h("div", { class: "music-row", role: "button", tabindex: "0" },
              s.pic
                ? h("img", { class: "music-row__cover", src: s.pic, alt: "", loading: "lazy" })
                : h("span", { class: "music-row__cover music-row__cover--empty" }, "♪"),
              h("div", { class: "music-row__main" },
                h("strong", {}, s.name || "未命名"),
                h("span", { class: "mono" }, s.artist || "未知歌手")));
            const pick = () => { onPick({ id: s.id, name: s.name, artist: s.artist }); close(); };
            row.addEventListener("click", pick);
            row.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(); });
            wrap.append(row);
          }
          pane1.append(wrap);
        }).catch(() => {
          pane1.innerHTML = "";
          pane1.append(h("p", { class: "hint hint--err" }, "歌单读取失败，请稍后再试。"));
        });

        /* ---- 搜索 ---- */
        const kw = h("input", { class: "input", placeholder: "歌名 / 歌手，回车搜索", onkeydown: (e) => { if (e.key === "Enter") doSearch(); } });
        const sBtn = h("button", { class: "btn btn--primary btn--sm", onclick: doSearch }, "搜索");
        const sBox = h("div", { class: "music-search__box" });
        pane2.append(h("p", { class: "hint" }, "搜索需已配置 ApiKey；「入库并插入」会先把歌转存进曲库。"),
          h("div", { class: "formrow" }, kw, sBtn), sBox);

        async function doSearch() {
          const k = kw.value.trim();
          if (!k) return;
          sBtn.disabled = true;
          sBox.innerHTML = '<p class="hint">正在搜索五平台…</p>';
          try {
            const data = (await music.search(k)) || {};
            sBox.innerHTML = "";
            let any = false;
            for (const [src, label] of SOURCES) {
              const hits = (data[src] || []).slice(0, 5);
              if (!hits.length) continue;
              any = true;
              const g = h("div", { class: "music-search__group" },
                h("p", { class: "music-search__grouptitle mono" }, label));
              for (const hit of hits) g.append(resultRow(src, hit));
              sBox.append(g);
            }
            if (!any) sBox.append(h("p", { class: "hint" }, "没有搜到，换个关键词。"));
          } catch (e) {
            sBox.innerHTML = "";
            sBox.append(h("p", { class: "hint hint--err" },
              (e.code === "no_key" ? e.message : (e.message || "搜索失败")) +
              (e.hint ? " — " + e.hint : "")));
          } finally {
            sBtn.disabled = false;
          }
        }

        function resultRow(src, hit) {
          const title = hit.title || hit.name || "未知标题";
          const artist = hit.artist || hit.singer || "";
          const btn = h("button", { class: "btn btn--primary btn--sm" }, "入库并插入");
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            btn.textContent = "入库中…";
            try {
              const r = await music.ingest({ ...hit, source: src });
              const id = r && r.id ? "t" + r.id : null;
              if (!id) throw new Error("入库返回异常");
              toast(r && r.duplicate ? "已在曲库中，直接插入" : "入库成功，已插入", "ok");
              onPick({ id, name: title, artist });
              close();
            } catch (e) {
              toast((e.message || "入库失败") + (e.hint ? " — " + e.hint : ""), "error", 6000);
              btn.disabled = false;
              btn.textContent = "入库并插入";
            }
          });
          return h("div", { class: "music-row" },
            h("div", { class: "music-row__main" },
              h("strong", {}, title),
              h("span", { class: "mono" }, artist)),
            h("span", { class: "chip chip--dev music-row__src" }, label),
            btn);
        }

        return box;
      })(),
      h("div", { class: "dialog__actions" }, pickBtn)
    )
  );

  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("in"));
}
