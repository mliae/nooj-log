/* ============================================================
   Nooj Log — 说说（碎片流）
   数据：content/notes.json（单文件数组，后台 #/notes 维护）
   呈现：按月分组的时间线，左侧虚线 + 节点呼应全站「迹」母题
   ============================================================ */

(function () {
  "use strict";

  var timeline = document.getElementById("notes-timeline");
  var filterHost = document.getElementById("note-filters");
  var metaEl = document.getElementById("notes-meta");
  var emptyEl = document.getElementById("notes-empty");
  var searchInput = document.getElementById("note-search");
  var lightbox = document.getElementById("note-lightbox");
  if (!timeline) return;

  var ALL = [];
  var tag = new URLSearchParams(location.search).get("tag") || "";
  var q = "";

  /* ---------- 小工具 ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* 音乐标记：!song(t22|歌名|歌手)  与后台插入、文章正文用的是同一套语法 */
  var SONG_RE = /!song\(\s*([A-Za-z0-9_-]+)\s*(?:\|([^|\n)]*)\|([^\n)]*))?\s*\)/g;
  var PH = "\u0001";

  function songCard(id, name, artist) {
    name = name || "未命名";
    artist = artist || "未知歌手";
    return '<div class="psong" data-song="' + esc(id) + '" data-name="' + esc(name) + '" data-artist="' + esc(artist) + '">' +
      '<span class="psong__cover" aria-hidden="true">♪</span>' +
      '<span class="psong__meta"><strong>' + esc(name) + "</strong><em>" + esc(artist) + "</em></span>" +
      '<button class="psong__btn" type="button" aria-label="播放 ' + esc(name) + '"></button>' +
    "</div>";
  }

  /* 纯文本 → 安全 HTML：音乐标记 → 转义 → 反引号内联代码 → 链接 → 段落 */
  function richText(text) {
    var html = esc(text);
    var cards = [];
    html = html.replace(SONG_RE, function (m, id, name, artist) {
      cards.push(songCard(id, name, artist));
      return PH + (cards.length - 1) + PH;
    });
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    html = html.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, function (url) {
      return '<a href="' + url + '" target="_blank" rel="noopener">' + url + "</a>";
    });

    function unph(block) {
      return block.replace(new RegExp(PH + "(\\d+)" + PH, "g"), function (m, i) {
        return cards[Number(i)] || "";
      });
    }

    var blocks = html.split(/\n{2,}/).filter(function (s) { return s.trim(); });
    if (!blocks.length) return "";
    return blocks.map(function (b) {
      /* 整段只有一个标记 → 直接出卡片，不要套 <p> */
      var only = b.trim();
      if (new RegExp("^" + PH + "\\d+" + PH + "$").test(only)) return unph(only);
      return "<p>" + unph(b.replace(/\n/g, "<br>")) + "</p>";
    }).join("");
  }

  function tagCounts(list) {
    var map = {};
    list.forEach(function (n) {
      (n.tags || []).forEach(function (t) { map[t] = (map[t] || 0) + 1; });
    });
    return Object.keys(map).sort(function (a, b) { return map[b] - map[a] || a.localeCompare(b); })
      .map(function (t) { return { name: t, count: map[t] }; });
  }

  /* ---------- 筛选条 ---------- */
  function paintFilters() {
    if (!filterHost) return;
    var all = ALL.length;
    var chips = [{ name: "", label: "全部", count: all }].concat(
      tagCounts(ALL).map(function (t) { return { name: t.name, label: "#" + t.name, count: t.count }; })
    );
    filterHost.innerHTML = chips.map(function (c) {
      return '<button class="filter-chip' + (c.name === tag ? " active" : "") + '" data-tag="' + esc(c.name) + '">' +
        esc(c.label) + '<span class="n">' + c.count + "</span></button>";
    }).join("");
  }

  filterHost && filterHost.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-tag]");
    if (!btn) return;
    tag = btn.getAttribute("data-tag");
    /* 同步地址栏，方便直接分享某个标签 */
    var url = new URL(location.href);
    if (tag) url.searchParams.set("tag", tag); else url.searchParams.delete("tag");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    paintFilters();
    paint();
  });

  /* ---------- 搜索 ---------- */
  var timer = null;
  searchInput && searchInput.addEventListener("input", function (e) {
    var v = e.currentTarget.value.trim().toLowerCase();
    clearTimeout(timer);
    timer = setTimeout(function () { q = v; paint(); }, 160);
  });

  /* ---------- 筛选后的数据 ---------- */
  function visible() {
    return ALL.filter(function (n) {
      if (tag && (n.tags || []).indexOf(tag) < 0) return false;
      if (!q) return true;
      var hay = (n.text || "") + " " + (n.tags || []).join(" ");
      return hay.toLowerCase().indexOf(q) >= 0;
    });
  }

  /* ---------- 渲染 ---------- */
  function noteHtml(n) {
    var p = window.NoojContent.noteParts(n.date);
    var imgs = (n.images || []).filter(Boolean);
    var tags = (n.tags || []).map(function (t) {
      return '<button class="tag tag--btn" data-jump="' + esc(t) + '">#' + esc(t) + "</button>";
    }).join("");

    return '<li class="note reveal" id="' + esc(n.id) + '">' +
      '<span class="note__dot" aria-hidden="true"></span>' +
      '<article class="note__body">' +
        '<div class="note__meta mono">' +
          '<time datetime="' + esc(String(n.date).replace(" ", "T")) + '">' +
            esc(p.d) + " 日 " + esc(p.hm) + "</time>" +
          (n.pinned ? '<span class="note__pin">置顶</span>' : "") +
        "</div>" +
        '<div class="note__text">' + richText(n.text) + "</div>" +
        (imgs.length
          ? '<div class="note__imgs' + (imgs.length === 1 ? " is-single" : "") + '">' +
            imgs.map(function (src) {
              return '<button class="note__img" type="button" data-full="' + esc(src) + '">' +
                '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async"></button>';
            }).join("") +
            "</div>"
          : "") +
        (tags ? '<div class="note__tags">' + tags + "</div>" : "") +
      "</article>" +
    "</li>";
  }

  function paint() {
    var list = visible();

    if (!list.length) {
      timeline.innerHTML = "";
      if (metaEl) metaEl.textContent = "";
      if (emptyEl) {
        emptyEl.classList.add("show");
        emptyEl.querySelector("p").textContent = ALL.length
          ? "没有匹配的碎念，换个词试试。"
          : "这个抽屉还是空的。";
      }
      return;
    }
    emptyEl && emptyEl.classList.remove("show");

    /* 按月分组；置顶条目已经在排序里靠前，落在哪个组就排在组首 */
    var groups = [];
    var cur = null;
    list.forEach(function (n) {
      var p = window.NoojContent.noteParts(n.date);
      var key = p.y + "-" + p.m;
      if (!cur || cur.key !== key) {
        cur = { key: key, y: p.y, m: p.m, items: [] };
        groups.push(cur);
      }
      cur.items.push(n);
    });

    timeline.innerHTML = groups.map(function (g) {
      return '<section class="note-group">' +
        '<h2 class="note-group__head mono">' + g.y + " · " + g.m +
          '<span class="note-group__n">' + g.items.length + " 条</span></h2>" +
        '<ol class="note-list">' + g.items.map(noteHtml).join("") + "</ol>" +
      "</section>";
    }).join("");

    if (metaEl) {
      metaEl.textContent = "共 " + ALL.length + " 条" +
        (tag ? " · 标签 #" + tag : "") +
        (q ? ' · 搜索「' + q + '」' : "") +
        (list.length !== ALL.length ? " · 命中 " + list.length : "");
    }

    if (window.revealScan) window.revealScan(timeline);
    if (window.noojWireSongs) window.noojWireSongs(); /* 音乐卡片接线 */
    jumpToHash();
  }

  /* ---------- 标签跳转 ---------- */
  timeline.addEventListener("click", function (e) {
    var t = e.target.closest("[data-jump]");
    if (t) {
      tag = t.getAttribute("data-jump");
      q = "";
      if (searchInput) searchInput.value = "";
      paintFilters();
      paint();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    var img = e.target.closest("[data-full]");
    if (img) openLightbox(img.getAttribute("data-full"));
  });

  /* ---------- 图片灯箱 ---------- */
  function openLightbox(src) {
    if (!lightbox) return;
    lightbox.querySelector("img").src = src;
    lightbox.hidden = false;
    requestAnimationFrame(function () { lightbox.classList.add("in"); });
    document.body.style.overflow = "hidden";
  }
  function closeLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightbox.classList.remove("in");
    document.body.style.overflow = "";
    setTimeout(function () { lightbox.hidden = true; lightbox.querySelector("img").src = ""; }, 180);
  }
  lightbox && lightbox.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeLightbox();
  });

  /* ---------- 锚点定位（分享单条说说） ---------- */
  function jumpToHash() {
    var id = location.hash.replace(/^#/, "");
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.add("is-target");
    el.classList.add("in");
    setTimeout(function () {
      var top = el.getBoundingClientRect().top + window.scrollY - 96;
      window.scrollTo({ top: top, behavior: "smooth" });
    }, 80);
  }
  window.addEventListener("hashchange", jumpToHash);

  /* ---------- 启动 ---------- */
  window.NoojContent.load().then(function (D) {
    ALL = window.NoojContent.sortNotes((D.notes || []).filter(function (n) { return n && n.id && !n.draft; }));
    paintFilters();
    paint();
  });
})();
