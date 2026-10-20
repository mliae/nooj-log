/* ============================================================
   Nooj Log — 全站悬浮音乐播放器 + 正文内嵌音乐卡片
   ------------------------------------------------------------
   数据链路：
     content/music.json（后台「音乐」页维护）→ { api, tag, enabled }
     → GET {api}/playlist.json?tag=xxx 拉歌单（music-api 已开 CORS）
     → GET {api}/track/<id>            单曲信息（正文卡片播放时用）
   交互：
     桌面（hover 可用）  鼠标移入立即展开 / 移出立即收起
                         打开歌单后移出保持展开；关闭歌单且鼠标不在胶囊上才收起
     触屏（无 hover）    点圆球展开 / 点 ✕ 收起
     两种设备都支持      点封面播放暂停
   未配置 / 曲库为空 / 接口不可达时静默退出，页面零残留。
   ============================================================ */
(function () {
  "use strict";

  /* 软导航下本脚本可能被再次请求：只允许实例化一次，否则会出现两路声音 */
  if (window.__noojPlayer) return;
  window.__noojPlayer = true;

  var script = document.currentScript;
  if (!script) return;
  var BASE = script.src.replace(/assets\/js\/player\.js.*$/, "");

  /* ---------- 小工具 ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }
  function absUrl(u) {
    if (!u) return "";
    if (/^https?:/i.test(u)) return u;
    return st.api + (u.charAt(0) === "/" ? "" : "/") + u;
  }

  var hasHover = false;
  try {
    hasHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch (e) { /* 老浏览器当触屏处理 */ }

  var st = {
    api: "",
    list: [],
    index: 0,
    track: null,       /* 当前曲目（可能是正文卡片里点的、不在歌单里） */
    playing: false,
    expanded: false,
    panel: false,
    audio: null,
    built: false,
    tried: 0           /* 连续失败计数，防止死循环切歌 */
  };

  function start() { init(); }
  if (document.readyState === "complete") setTimeout(start, 400);
  else window.addEventListener("load", function () { setTimeout(start, 400); });

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* 国内到 Cloudflare 偶发抖动：带退避重试 */
  async function fetchJSON(url, tries) {
    var lastErr = null;
    for (var i = 0; i < tries; i++) {
      if (i) await sleep(600 * i * 2);
      try {
        var r = await fetch(url);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("fetch failed");
  }

  async function init() {
    var cfg;
    try {
      cfg = await fetchJSON(BASE + "content/music.json", 2);
    } catch (e) { return; }
    if (!cfg || !cfg.api) return;

    st.api = String(cfg.api).replace(/\/+$/, "");

    /* 后台音乐开关关掉 = 不挂悬浮播放器；正文卡片仍可点，点了才拉起来 */
    if (cfg.enabled !== false) {
      var qs = cfg.tag ? "?tag=" + encodeURIComponent(cfg.tag) : "";
      var list = null;
      try {
        list = await fetchJSON(st.api + "/playlist.json" + qs, 3);
      } catch (e) { list = null; }

      /* 拉取失败时回落到上次成功缓存的歌单（7 天内有效） */
      if (!Array.isArray(list) || !list.length) {
        try {
          var cached = JSON.parse(localStorage.getItem("nooj_playlist_cache") || "null");
          if (cached && cached.list && cached.list.length && Date.now() - cached.t < 7 * 864e5) {
            list = cached.list;
          }
        } catch (e) { /* 缓存坏了当没有 */ }
      } else {
        try { localStorage.setItem("nooj_playlist_cache", JSON.stringify({ t: Date.now(), list: list })); } catch (e) { /* 忽略 */ }
      }

      list = (list || []).filter(function (s) { return s && s.url; });
      if (list.length) {
        st.list = list;
        st.index = 0;
        st.track = list[0];
        build();
      }
    }

    wireCards();
  }

  /* ---------- UI ---------- */
  var root, fab, fabCover, capsule, capCover, capTitle, capArtist,
      playBtn, eq, bar, panel, panelList, panelCount;

  var SVG_PLAY = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4.5 2.8v10.4c0 .5.55.8.98.53l8.05-5.2a.63.63 0 0 0 0-1.06L5.48 2.27a.63.63 0 0 0-.98.53z"/></svg>';
  var SVG_PAUSE = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="3" y="2.5" width="3.4" height="11" rx="1"/><rect x="9.6" y="2.5" width="3.4" height="11" rx="1"/></svg>';
  var SVG_LIST = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><circle cx="2.4" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="2.4" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="2.4" cy="12" r=".9" fill="currentColor" stroke="none"/></svg>';
  var SVG_CLOSE = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>';
  var SVG_NOTE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18.5V6l11-2.5V16"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>';

  function build() {
    if (st.built) return;
    st.built = true;

    root = document.createElement("div");
    root.className = "music";
    root.innerHTML =
      '<button class="music-fab" type="button" aria-label="展开音乐播放器">' +
        '<span class="music-fab__note">' + SVG_NOTE + "</span>" +
        '<img class="music-fab__cover" alt="" hidden>' +
        '<span class="music-fab__eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
      "</button>" +
      '<div class="music-capsule" hidden role="region" aria-label="音乐播放器">' +
        '<img class="music-capsule__cover" alt="播放 / 暂停" title="播放 / 暂停">' +
        '<div class="music-capsule__meta">' +
          '<strong class="music-capsule__title"></strong>' +
          '<span class="music-capsule__artist mono"></span>' +
        "</div>" +
        '<span class="music-eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<button class="music-capsule__btn music-capsule__play" type="button" aria-label="播放 / 暂停"></button>' +
        '<button class="music-capsule__btn music-capsule__list" type="button" aria-label="歌单">' + SVG_LIST + "</button>" +
        '<button class="music-capsule__btn music-capsule__shrink" type="button" aria-label="收起">' + SVG_CLOSE + "</button>" +
        '<div class="music-capsule__track" title="拖动进度"><span class="music-capsule__bar"></span></div>' +
      "</div>" +
      '<div class="music-panel" hidden>' +
        '<header class="music-panel__head mono">歌单 / PLAYLIST <span class="music-panel__count"></span></header>' +
        '<ul class="music-panel__list"></ul>' +
      "</div>";
    document.body.appendChild(root);
    document.body.classList.add("has-music"); /* 让「回到顶部」让位 */

    fab = root.querySelector(".music-fab");
    fabCover = root.querySelector(".music-fab__cover");
    capsule = root.querySelector(".music-capsule");
    capCover = root.querySelector(".music-capsule__cover");
    capTitle = root.querySelector(".music-capsule__title");
    capArtist = root.querySelector(".music-capsule__artist");
    playBtn = root.querySelector(".music-capsule__play");
    eq = root.querySelector(".music-eq");
    bar = root.querySelector(".music-capsule__bar");
    panel = root.querySelector(".music-panel");
    panelList = root.querySelector(".music-panel__list");
    panelCount = root.querySelector(".music-panel__count");

    st.audio = new Audio();
    st.audio.preload = "none";
    st.audio.volume = 0.9;
    st.audio.addEventListener("timeupdate", paintProgress);
    st.audio.addEventListener("ended", function () { next(1); });
    st.audio.addEventListener("error", function () {
      if (!st.playing) return;
      st.tried++;
      if (st.tried < st.list.length) next(1);
    });
    st.audio.addEventListener("playing", function () { st.tried = 0; setPlaying(true); });
    st.audio.addEventListener("pause", function () { setPlaying(false); });

    fab.addEventListener("click", function () { setExpanded(true); });
    root.querySelector(".music-capsule__shrink").addEventListener("click", function (e) {
      e.stopPropagation();
      setExpanded(false);
      togglePanel(false);
    });
    playBtn.addEventListener("click", function (e) { e.stopPropagation(); togglePlay(); });
    capCover.addEventListener("click", function (e) { e.stopPropagation(); togglePlay(); });
    root.querySelector(".music-capsule__list").addEventListener("click", function (e) {
      e.stopPropagation();
      togglePanel(!st.panel);
    });

    var track = root.querySelector(".music-capsule__track");
    track.addEventListener("click", function (e) {
      e.stopPropagation();
      var rect = track.getBoundingClientRect();
      var ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      if (st.audio.duration) st.audio.currentTime = ratio * st.audio.duration;
    });

    /* 桌面：移入即展开，移出即收起（歌单打开时保持） */
    if (hasHover) {
      root.addEventListener("mouseenter", function () { if (!st.expanded) setExpanded(true); });
      root.addEventListener("mouseleave", function () { if (!st.panel) setExpanded(false); });
    }

    paintPanel();
    paintTrack();
    setPlaying(false);
  }

  /* ---------- 状态渲染 ---------- */
  function current() { return st.track || st.list[st.index] || {}; }

  function indexOfTrack(id) {
    for (var i = 0; i < st.list.length; i++) if (st.list[i].id === id) return i;
    return -1;
  }

  function paintTrack() {
    if (!st.built) return;
    var s = current();
    var t = esc(s.name || s.title || "未命名");
    var a = esc(s.artist || "未知歌手");
    capTitle.textContent = s.name || s.title || "未命名";
    capArtist.textContent = s.artist || "未知歌手";
    var pic = s.pic || s.cover || "";
    if (pic) {
      fabCover.src = pic; fabCover.hidden = false;
      capCover.src = pic; capCover.hidden = false;
    } else {
      fabCover.hidden = true; fabCover.removeAttribute("src");
      capCover.hidden = true; capCover.removeAttribute("src");
    }
    fab.title = t + " · " + a;
    var rows = panelList.querySelectorAll("li");
    rows.forEach(function (li, i) { li.classList.toggle("is-active", i === st.index); });
    var active = panelList.querySelector("li.is-active");
    if (active && st.panel) active.scrollIntoView({ block: "nearest" });
    paintCards();
  }

  function paintProgress() {
    var a = st.audio;
    if (!a) return;
    var ratio = a.duration ? a.currentTime / a.duration : 0;
    bar.style.width = (ratio * 100).toFixed(2) + "%";
    fab.title = current().name + " · " + fmt(a.currentTime) + " / " + fmt(a.duration);
  }

  function setPlaying(on) {
    st.playing = on;
    if (st.built) {
      playBtn.innerHTML = on ? SVG_PAUSE : SVG_PLAY;
      root.classList.toggle("is-playing", on);
    }
    paintCards();
  }

  function isHovered() {
    try { return !!(root && root.matches(":hover")); } catch (e) { return false; }
  }

  function setExpanded(on) {
    if (!st.built) return;
    st.expanded = on;
    fab.hidden = on;
    capsule.hidden = !on;
    if (!on) togglePanel(false);
  }

  function togglePanel(on) {
    if (!st.built) return;
    if (st.panel === on) { panel.hidden = !on; return; }
    st.panel = on;
    panel.hidden = !on;
    if (on) {
      var active = panelList.querySelector("li.is-active");
      if (active) active.scrollIntoView({ block: "nearest" });
    } else if (hasHover && !isHovered()) {
      /* 关掉歌单时鼠标已经不在胶囊上 → 自动收起 */
      setExpanded(false);
    }
  }

  function paintPanel() {
    panelCount.textContent = "· " + st.list.length + " 首";
    panelList.innerHTML = st.list.map(function (s, i) {
      return (
        '<li data-i="' + i + '">' +
          '<span class="music-panel__idx mono">' + (i + 1) + "</span>" +
          '<span class="music-panel__meta">' +
            '<strong>' + esc(s.name || "未命名") + "</strong>" +
            '<em class="mono">' + esc(s.artist || "未知歌手") + "</em>" +
          "</span>" +
          '<span class="music-panel__eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
        "</li>"
      );
    }).join("");
    panelList.addEventListener("click", function (e) {
      var li = e.target.closest("li");
      if (!li) return;
      var i = Number(li.dataset.i);
      if (i === st.index) { togglePlay(); return; }
      st.index = i;
      st.track = st.list[i];
      paintTrack();
      play();
    });
  }

  /* ---------- 播放控制 ---------- */
  function play() {
    var s = current();
    if (!s || !s.url) return;
    var abs = absUrl(s.url);
    if (st.audio.src !== abs) st.audio.src = abs;
    st.audio.play().catch(function () { setPlaying(false); });
  }

  function togglePlay() {
    if (!st.audio || !st.audio.src) { play(); return; }
    if (st.playing) st.audio.pause();
    else play();
  }

  function next(dir) {
    if (!st.list.length) { setPlaying(false); return; }
    st.index = (st.index + dir + st.list.length) % st.list.length;
    st.track = st.list[st.index];
    paintTrack();
    play();
  }

  /* ---------- 正文 / 说说里的音乐卡片 ---------- */
  var trackCache = {};
  var trackPending = {};

  function normTrack(d) {
    if (!d) return null;
    var o = d.data || d;
    var url = o.url || o.src || "";
    if (!url) return null;
    return {
      id: o.id || "",
      name: o.name || o.title || "",
      artist: o.artist || o.singer || "",
      url: url,
      pic: o.pic || o.cover || "",
      lrc: o.lrc || o.lyric || ""
    };
  }

  /* 拉单曲信息（带缓存 + 并发去重） */
  function trackInfo(id) {
    if (!id || !st.api) return Promise.resolve(null);
    if (trackCache[id] !== undefined) return Promise.resolve(trackCache[id]);
    if (trackPending[id]) return trackPending[id];
    var p = fetch(st.api + "/track/" + encodeURIComponent(id))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var t = normTrack(d);
        trackCache[id] = t;
        delete trackPending[id];
        return t;
      })
      .catch(function () { delete trackPending[id]; return null; });
    trackPending[id] = p;
    return p;
  }

  function cardCover(el, pic) {
    if (!pic) return;
    var cover = el.querySelector(".psong__cover");
    if (!cover || cover.querySelector("img")) return;
    cover.innerHTML = '<img src="' + esc(pic) + '" alt="" loading="lazy" decoding="async">';
  }

  function paintCards() {
    var cards = document.querySelectorAll(".psong[data-song]");
    var cur = current();
    var pic = cur.pic || cur.cover || "";
    for (var i = 0; i < cards.length; i++) {
      var on = !!cur.id && cur.id === cards[i].dataset.song;
      cards[i].classList.toggle("is-playing", on && st.playing);
      /* 不管是从歌单还是从别的卡片开始放的，同曲的卡片都把封面补上 */
      if (on && pic) cardCover(cards[i], pic);
    }
  }

  function wireCards() {
    var cards = document.querySelectorAll(".psong[data-song]");
    for (var i = 0; i < cards.length; i++) wireCard(cards[i]);
    paintCards();
  }

  function wireCard(el) {
    if (el.dataset.wired === "1") return;
    el.dataset.wired = "1";

    /* 预取：鼠标碰到就先拉，点下去可直接播（保住用户手势，避免被拦） */
    var prefetch = function () { trackInfo(el.dataset.song).then(function (t) { if (t) cardCover(el, t.pic); }); };
    el.addEventListener("pointerenter", prefetch);
    el.addEventListener("focusin", prefetch);

    el.addEventListener("click", function (e) {
      var hit = e.target.closest ? e.target.closest(".psong__btn, .psong__cover") : null;
      if (!hit) return;
      e.preventDefault();
      onCardClick(el);
    });
  }

  function onCardClick(el) {
    var id = el.dataset.song;
    if (!id || !st.api) return;

    var cur = current();
    if (cur.id === id && st.built) { togglePlay(); return; }

    /* 歌单里已有的直接用歌单数据，省一次 /track 请求 */
    var hit = st.list[indexOfTrack(id)];
    if (hit && hit.url) { startCardTrack(el, hit); return; }

    var cached = trackCache[id];
    if (cached) { startCardTrack(el, cached); return; }

    el.classList.add("is-loading");
    trackInfo(id).then(function (t) {
      el.classList.remove("is-loading");
      if (!t) { el.classList.add("is-missing"); return; }
      startCardTrack(el, t);
    });
  }

  function startCardTrack(el, t) {
    if (!st.built) build();          /* 歌单为空 / 播放器被关掉时，按需拉起 */
    st.track = {
      id: el.dataset.song,
      name: t.name || el.dataset.name || "未命名",
      artist: t.artist || el.dataset.artist || "",
      url: t.url,
      pic: t.pic
    };
    st.index = indexOfTrack(st.track.id);
    cardCover(el, t.pic);
    paintTrack();
    play();
    /* 触屏没有 hover：自动展开胶囊，让用户看到在放什么；桌面交给 hover */
    if (!hasHover) setExpanded(true);
  }

  /* 说说页面是动态渲染的：把扫描函数挂出去，渲染完调一次 */
  window.noojWireSongs = wireCards;

  /* 点空白处收起胶囊（触屏友好；桌面靠 hover 已经够了） */
  document.addEventListener("click", function (e) {
    if (!st.expanded || st.panel) return;
    if (root && root.contains(e.target)) return;
    if (e.target.closest && e.target.closest(".psong")) return;
    setExpanded(false);
  });
})();
