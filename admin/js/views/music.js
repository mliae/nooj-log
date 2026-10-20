/* ============================================================
   Nooj Log 后台 — 音乐管理
   ------------------------------------------------------------
   对接中央音乐解析服务（music-api，Cloudflare Workers）：
     · 服务设置：API 地址 + 歌单标签 写入 content/music.json
       （前台悬浮播放器据此拉取 {api}/playlist.json?tag=）
     · 搜索入库：五平台聚合搜索 → 一键解析转存 R2
     · 中央曲库：勾选批量加入/移出博客歌单（标签即歌单）
   ApiKey 只存本机 localStorage，不进公开仓库。
   ============================================================ */

import { h, icon, toast } from "../util.js";
import * as api from "../api.js";
import * as auth from "../auth.js";

const LS_KEY = "nooj_music_key";
const DEFAULTS = { api: "https://music.jxe.me", tag: "blog" };
const SOURCES = [
  ["netease", "网易云"],
  ["qq", "QQ 音乐"],
  ["kugou", "酷狗"],
  ["kuwo", "酷我"],
  ["qishui", "汽水"]
];
const SOURCE_LABEL = Object.fromEntries(SOURCES);

export async function renderMusic(container, ctx) {
  container.innerHTML = "";
  const wrap = h("div", { class: "settings" });
  container.append(wrap);

  ctx.setTopbar("音乐", [
    h("button", { class: "btn btn--ghost", onclick: () => refreshAll() }, icon("refresh", 14), h("span", {}, "刷新"))
  ]);

  /* ---------- 状态 ---------- */
  let cfg = { ...DEFAULTS };
  let cfgSha = null;
  let key = localStorage.getItem(LS_KEY) || "";
  let library = [];        /* 中央曲库 TrackJson[] */
  let blogList = [];       /* 博客歌单 playlist.json */
  let checked = new Set();

  try {
    const { text, sha } = await api.readFile("content/music.json");
    const data = JSON.parse(text);
    cfg = { ...DEFAULTS, ...data };
    cfgSha = sha;
  } catch (e) { /* 首次使用：用默认值 */ }

  const apiBase = () => String(cfg.api || "").replace(/\/+$/, "");

  /* music-api 的 /api/* 没有 CORS，浏览器只能走同源代理 /api/music 转发 */
  async function musicReq(path, { method = "GET", body } = {}) {
    if (!apiBase()) throw new Error("请先填写音乐服务地址");
    if (!key) throw new Error("还没有填写 ApiKey：在 music-api 后台「Key 管理」创建一个，填到上面并保存");
    const headers = { "Content-Type": "application/json", "X-Api-Key": key };
    const token = auth.getToken && auth.getToken();
    if (auth.getMode() === "github" && token) headers.Authorization = "Bearer " + token;

    let res;
    try {
      res = await fetch("/api/music", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({ path, method, body })
      });
    } catch (e) {
      throw new Error("代理请求失败（网络异常）");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || res.status + " 请求失败");
      if (data && data.code === "no_music_api") err.hint = "刚改完服务地址的话，等几秒再刷新（代理读取的是仓库里的 content/music.json）";
      if (res.status === 401) err.hint = "鉴权失败：检查 ApiKey 是否启用；若是刚改完配置，等几秒重试";
      throw err;
    }
    if (data && typeof data.code === "number" && data.code !== 0) {
      throw new Error(data.message || "音乐服务返回错误");
    }
    return data && data.data !== undefined ? data.data : data;
  }

  /* ---------- 卡片骨架 ---------- */
  const setCard = h("section", { class: "card" });
  const searchCard = h("section", { class: "card" });
  const libCard = h("section", { class: "card" });

  wrap.append(
    h("p", { class: "settings__lead" },
      "对接你的中央音乐解析服务（music-api）。在这里搜索入库、挑选歌曲加入博客歌单，前台悬浮播放器会自动拉取最新歌单——加歌不需要重新构建站点。"),
    setCard, searchCard, libCard
  );

  /* ============================================================
     服务设置
     ============================================================ */
  const apiUrl = h("input", { class: "input input--mono", value: cfg.api, placeholder: "https://music.example.com" });
  const tagInput = h("input", { class: "input input--mono", value: cfg.tag, placeholder: "blog" });
  const keyInput = h("input", { class: "input input--mono", type: "password", value: "", placeholder: key ? "已保存到本机，留空则不修改" : "mk_…（搜索与入库需要）" });
  const probe = h("p", { class: "hint" });

  async function doSave() {
    const nextApi = apiUrl.value.trim().replace(/\/+$/, "");
    const nextTag = tagInput.value.trim() || "blog";
    if (!/^https?:\/\//.test(nextApi)) return toast("服务地址需以 http(s):// 开头", "error");
    if (keyInput.value.trim()) {
      key = keyInput.value.trim();
      localStorage.setItem(LS_KEY, key);
      keyInput.value = "";
      keyInput.placeholder = "已保存到本机，留空则不修改";
    }
    cfg = { api: nextApi, tag: nextTag };
    const btn = saveBtn;
    btn.disabled = true;
    try {
      const text = JSON.stringify({ ...cfg, updated: new Date().toISOString().slice(0, 10) }, null, 2) + "\n";
      cfgSha = await api.writeFile(
        "content/music.json", text,
        "music: 更新音乐服务配置", cfgSha || undefined
      );
      toast("已保存到暂存区，点右上「发布」后前台生效", "ok");
      await refreshBlogList();
    } catch (e) {
      toast(e.message || "保存失败", "error", 6000);
    } finally {
      btn.disabled = false;
    }
  }

  async function doTest() {
    probe.textContent = "正在连接…";
    probe.className = "hint";
    testBtn.disabled = true;
    try {
      const list = await fetch(apiBase() + "/playlist.json" + (cfg.tag ? "?tag=" + encodeURIComponent(cfg.tag) : ""))
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
      probe.textContent = "连接正常，博客歌单当前 " + (Array.isArray(list) ? list.length : 0) + " 首。";
      probe.className = "hint hint--ok";
    } catch (e) {
      probe.textContent = "连接失败：" + (e.message || "网络错误");
      probe.className = "hint hint--err";
    } finally {
      testBtn.disabled = false;
    }
  }

  const saveBtn = h("button", { class: "btn btn--primary", onclick: doSave }, icon("save", 14), h("span", {}, "保存配置"));
  const testBtn = h("button", { class: "btn btn--ghost", onclick: doTest }, "测试连接");

  setCard.append(
    h("header", { class: "card__head" },
      h("h3", { class: "card__title" }, "音乐服务"),
      h("p", { class: "card__sub" }, "指向你的 music-api 部署地址。歌单标签即曲库里的标签（歌单），打上该标签的歌曲会出现在博客播放器里。")),
    h("div", { class: "formgrid formgrid--3" },
      field("服务地址", apiUrl),
      field("博客歌单标签", tagInput),
      field("ApiKey（仅存本机）", keyInput)),
    probe,
    h("div", { class: "card__actions" }, testBtn, saveBtn),
    h("p", { class: "hint" },
      "ApiKey 保存在当前浏览器的 localStorage 里，不写入公开仓库；保存配置会把服务地址与标签写入 content/music.json 并触发站点重建。")
  );

  /* ============================================================
     搜索入库
     ============================================================ */
  const kwInput = h("input", {
    class: "input",
    placeholder: "歌名 / 歌手，回车搜索",
    onkeydown: (e) => { if (e.key === "Enter") doSearch(); }
  });
  const searchBtn = h("button", { class: "btn btn--primary", onclick: doSearch }, icon("search", 14), h("span", {}, "搜索"));
  const searchBox = h("div", { class: "music-search__box" });

  async function doSearch() {
    const kw = kwInput.value.trim();
    if (!kw) return;
    searchBtn.disabled = true;
    searchBox.innerHTML = '<p class="hint">正在搜索五平台…</p>';
    try {
      const data = await musicReq("/api/search?kw=" + encodeURIComponent(kw));
      paintSearch(data || {});
    } catch (e) {
      searchBox.innerHTML = "";
      searchBox.append(h("p", { class: "hint hint--err" }, e.hint ? e.message + " — " + e.hint : (e.message || "搜索失败")));
    } finally {
      searchBtn.disabled = false;
    }
  }

  function paintSearch(data) {
    searchBox.innerHTML = "";
    let any = false;
    for (const [src, label] of SOURCES) {
      const hits = (data[src] || []).slice(0, 8);
      if (!hits.length) continue;
      any = true;
      const rows = h("div", { class: "music-search__group" },
        h("p", { class: "music-search__grouptitle mono" }, label));
      for (const hit of hits) rows.append(searchRow(src, label, hit));
      searchBox.append(rows);
    }
    if (!any) searchBox.append(h("p", { class: "hint" }, "五个平台都没有搜到，换个关键词试试。"));
  }

  function searchRow(src, label, hit) {
    const title = hit.title || hit.name || "未知标题";
    const artist = hit.artist || hit.singer || "";
    const btn = h("button", { class: "btn btn--ghost btn--sm" }, "入库");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "入库中…";
      try {
        const r = await musicReq("/api/ingest", {
          method: "POST",
          body: {
            source: src,
            id: hit.id ?? hit.songId,
            title,
            artist,
            album: hit.album || "",
            cover: hit.cover || hit.pic || "",
            vip: !!hit.vip,
            duration: hit.duration || 0
          }
        });
        toast(r && r.duplicate ? "该歌曲已在曲库中" : "入库成功（音频/封面已转存）", "ok");
        btn.textContent = "已入库";
        await Promise.all([refreshLibrary(), refreshBlogList()]);
      } catch (e) {
        toast(e.hint ? e.message + " — " + e.hint : (e.message || "入库失败"), "error", 6000);
        btn.disabled = false;
        btn.textContent = "入库";
      }
    });
    return h("div", { class: "music-row" },
      h("div", { class: "music-row__main" },
        h("strong", {}, title),
        h("span", { class: "mono" }, artist + (hit.album ? " · " + hit.album : ""))),
      h("span", { class: "chip chip--dev music-row__src" }, label),
      btn);
  }

  searchCard.append(
    h("header", { class: "card__head" },
      h("h3", { class: "card__title" }, "搜索入库"),
      h("p", { class: "card__sub" }, "网易云 / QQ / 酷狗 / 酷我 / 汽水五平台聚合搜索；入库会把音频、封面、歌词转存到你的 R2，彻底摆脱源站限制。")),
    h("div", { class: "formrow" }, kwInput, searchBtn),
    searchBox
  );

  /* ============================================================
     中央曲库 → 博客歌单
     ============================================================ */
  const libBox = h("div", { class: "music-lib" });
  const libHead = h("div", { class: "music-lib__head" });
  const bulkBar = h("div", { class: "card__actions card__actions--wrap music-lib__bulk" });

  function renderBulk() {
    bulkBar.innerHTML = "";
    if (!checked.size) return;
    bulkBar.append(
      h("span", { class: "hint" }, "已选 " + checked.size + " 首"),
      h("button", { class: "btn btn--primary btn--sm", onclick: () => bulkTag(true) }, "加入博客歌单"),
      h("button", { class: "btn btn--ghost btn--sm", onclick: () => bulkTag(false) }, "移出博客歌单")
    );
  }

  async function bulkTag(add) {
    const ids = Array.from(checked);
    const btns = bulkBar.querySelectorAll("button");
    btns.forEach((b) => { b.disabled = true; });
    try {
      if (add) {
        await musicReq("/api/library/tag", { method: "POST", body: { ids, tag: cfg.tag } });
        toast("已把 " + ids.length + " 首加入「" + cfg.tag + "」", "ok");
      } else {
        await musicReq("/api/tags/unassign", { method: "POST", body: { name: cfg.tag, ids } });
        toast("已移出 " + ids.length + " 首", "ok");
      }
      checked.clear();
      await Promise.all([refreshLibrary(), refreshBlogList()]);
    } catch (e) {
      toast(e.hint ? e.message + " — " + e.hint : (e.message || "操作失败"), "error", 6000);
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  function libRow(t) {
    const inBlog = (t.tags || []).includes(cfg.tag);
    const cb = h("input", { type: "checkbox" });
    if (checked.has(t.id)) cb.checked = true;
    cb.addEventListener("change", () => {
      if (cb.checked) checked.add(t.id);
      else checked.delete(t.id);
      renderBulk();
    });
    const row = h("div", { class: "music-row" + (inBlog ? " is-inblog" : "") },
      h("label", { class: "music-row__check" }, cb),
      t.cover_url
        ? h("img", { class: "music-row__cover", src: t.cover_url, alt: "", loading: "lazy" })
        : h("span", { class: "music-row__cover music-row__cover--empty" }, "♪"),
      h("div", { class: "music-row__main" },
        h("strong", {}, t.title || "未知标题"),
        h("span", { class: "mono" }, (t.artist || "未知歌手") + (t.album ? " · " + t.album : ""))),
      h("span", { class: "mono music-row__src" }, t.source_label || ""),
      h("div", { class: "music-row__tags" },
        (t.tags || []).map((tag) => h("span", { class: "tag" }, "#" + tag))),
      inBlog ? h("span", { class: "music-row__badge" }, "博客歌单") : null
    );
    return row;
  }

  async function refreshLibrary() {
    if (!apiBase()) return;
    libBox.innerHTML = '<p class="hint">正在读取中央曲库…</p>';
    try {
      const data = await musicReq("/api/library");
      library = (data && data.list) || [];
      paintLibrary();
    } catch (e) {
      libBox.innerHTML = "";
      libBox.append(h("p", { class: "hint hint--err" },
        "曲库读取失败：" + (e.message || "") + (e.hint ? " — " + e.hint : "")));
    }
  }

  function paintLibrary() {
    libBox.innerHTML = "";
    if (!library.length) {
      libBox.append(h("p", { class: "hint" }, "曲库还是空的——先用上面的搜索入库几首。"));
      return;
    }
    for (const t of library) libBox.append(libRow(t));
  }

  async function refreshBlogList() {
    if (!apiBase()) return;
    try {
      const list = await fetch(apiBase() + "/playlist.json" + (cfg.tag ? "?tag=" + encodeURIComponent(cfg.tag) : ""))
        .then((r) => r.json());
      blogList = Array.isArray(list) ? list : [];
    } catch (e) { blogList = []; }
    paintLibHead();
  }

  function paintLibHead() {
    libHead.innerHTML = "";
    libHead.append(
      h("span", { class: "mono" },
        "中央曲库 " + library.length + " 首 · 博客歌单「" + cfg.tag + "」" + blogList.length + " 首"));
    if (blogList.length) {
      const names = blogList.slice(0, 6).map((s) => s.name).join(" / ") + (blogList.length > 6 ? " …" : "");
      libHead.append(h("p", { class: "hint" }, "当前歌单：" + names));
    }
  }

  libCard.append(
    h("header", { class: "card__head" },
      h("h3", { class: "card__title" }, "博客歌单"),
      h("p", { class: "card__sub" }, "勾选曲目批量加入 / 移出博客歌单，前台播放器即时生效，无需重新构建。")),
    libHead,
    bulkBar,
    libBox
  );

  function field(label, control) {
    return h("div", { class: "formfield" },
      h("label", { class: "formfield__label" }, label),
      control);
  }

  async function refreshAll() {
    await Promise.all([refreshLibrary(), refreshBlogList()]);
  }

  await refreshAll();
}
