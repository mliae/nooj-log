/* ============================================================
   Nooj Log — 全站悬浮音乐播放器
   ------------------------------------------------------------
   数据链路：
     content/music.json（后台「音乐」页维护）→ { api, tag }
     → GET {api}/playlist.json?tag=xxx 拉歌单（music-api 已开 CORS）
   未配置 / 曲库为空 / 接口不可达时静默退出，页面零残留。
   加载时机：window load 后再启动，不与首屏抢带宽。
   ============================================================ */
(function () {
  "use strict";

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

  var st = {
    list: [],
    index: 0,
    playing: false,
    expanded: false,
    panel: false,
    audio: null,
    tried: 0 /* 连续失败计数，防止死循环切歌 */
  };

  function start() { init(); }
  if (document.readyState === "complete") setTimeout(start, 400);
  else window.addEventListener("load", function () { setTimeout(start, 400); });

  async function init() {
    var cfg;
    try {
      var r = await fetch(BASE + "content/music.json");
      if (!r.ok) return;
      cfg = await r.json();
    } catch (e) { return; }
    if (!cfg || !cfg.api) return;
    if (cfg.enabled === false) return; /* 后台音乐开关：关 = 整站不挂播放器 */

    var api = String(cfg.api).replace(/\/+$/, "");
    var qs = cfg.tag ? "?tag=" + encodeURIComponent(cfg.tag) : "";
    var list;
    try {
      var r2 = await fetch(api + "/playlist.json" + qs);
      if (!r2.ok) return;
      list = await r2.json();
    } catch (e) { return; }
    if (!Array.isArray(list)) return;
    list = list.filter(function (s) { return s && s.url; });
    if (!list.length) return;

    st.list = list;
    st.index = 0;
    build(api);
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
    root = document.createElement("div");
    root.className = "music";
    root.innerHTML =
      '<button class="music-fab" type="button" aria-label="展开音乐播放器">' +
        '<span class="music-fab__note">' + SVG_NOTE + "</span>" +
        '<img class="music-fab__cover" alt="" hidden>' +
        '<span class="music-fab__eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
      "</button>" +
      '<div class="music-capsule" hidden role="region" aria-label="音乐播放器">' +
        '<img class="music-capsule__cover" alt="">' +
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
    playBtn.addEventListener("click", togglePlay);
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

    paintPanel();
    paintTrack();
    setPlaying(false);
  }

  /* ---------- 状态渲染 ---------- */
  function current() { return st.list[st.index] || {}; }

  function paintTrack() {
    var s = current();
    var t = esc(s.name || "未命名");
    var a = esc(s.artist || "未知歌手");
    capTitle.textContent = s.name || "未命名";
    capArtist.textContent = s.artist || "未知歌手";
    if (s.pic) {
      fabCover.src = s.pic; fabCover.hidden = false;
      capCover.src = s.pic; capCover.hidden = false;
    } else {
      fabCover.hidden = true; fab.removeAttribute("src");
      capCover.hidden = true; capCover.removeAttribute("src");
    }
    fab.title = t + " · " + a;
    var rows = panelList.querySelectorAll("li");
    rows.forEach(function (li, i) { li.classList.toggle("is-active", i === st.index); });
    var active = panelList.querySelector("li.is-active");
    if (active && st.panel) active.scrollIntoView({ block: "nearest" });
  }

  function paintProgress() {
    var a = st.audio;
    var ratio = a.duration ? a.currentTime / a.duration : 0;
    bar.style.width = (ratio * 100).toFixed(2) + "%";
    fab.title = current().name + " · " + fmt(a.currentTime) + " / " + fmt(a.duration);
  }

  function setPlaying(on) {
    st.playing = on;
    playBtn.innerHTML = on ? SVG_PAUSE : SVG_PLAY;
    root.classList.toggle("is-playing", on);
  }

  function setExpanded(on) {
    st.expanded = on;
    fab.hidden = on;
    capsule.hidden = !on;
    if (!on) togglePanel(false);
  }

  function togglePanel(on) {
    st.panel = on;
    panel.hidden = !on;
    if (on) {
      var active = panelList.querySelector("li.is-active");
      if (active) active.scrollIntoView({ block: "nearest" });
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
      paintTrack();
      play();
    });
  }

  /* ---------- 播放控制 ---------- */
  function play() {
    var s = current();
    if (!s.url) return;
    var abs = s.url;
    if (st.audio.src !== abs) {
      st.audio.src = abs;
      st.audio.play().catch(function () { setPlaying(false); });
    } else {
      st.audio.play().catch(function () { setPlaying(false); });
    }
  }

  function togglePlay() {
    if (!st.audio.src) { play(); return; }
    if (st.playing) st.audio.pause();
    else play();
  }

  function next(dir) {
    st.index = (st.index + dir + st.list.length) % st.list.length;
    paintTrack();
    play();
  }
})();
