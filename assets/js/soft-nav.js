/* ============================================================
   Nooj Log — 软导航（Soft Navigation）
   ------------------------------------------------------------
   站点是多页静态站，每次跳转都会销毁当前 document，右下角的悬浮
   播放器（<audio>）随之销毁，于是切页必然断歌。这里拦截站内链接，
   用 fetch + DOMParser 只替换「页面区域」，把页眉、页脚、播放器、
   回到顶部留在原地 —— 播放器所在 document 不变，音乐自然连续。

   三条约定：
     1. KEEP 里的节点永不替换（播放器 / 页眉 / 页脚 / 回顶）
     2. 页面脚本重跑前，上一轮注册在 window、document 上的监听通过
        AbortSignal（window.noojSignal）统一解绑，避免叠加
     3. 脚本是否重跑按路径决定：main/player/soft-nav 只跑一次，
        data/content 是单例，其余页面脚本每次导航重跑

   任何异常（网络、非 HTML、无 <main>）都回退成原生跳转，
   保证最坏情况下站点行为与改造前完全一致。
   ============================================================ */

(function () {
  "use strict";

  if (window.__noojSoftNav) return;
  if (!window.fetch || !window.DOMParser || !window.history.pushState) return;
  window.__noojSoftNav = true;

  var KEEP = ".site-header, .site-footer, .back-top, .music";
  var SINGLETON = /\/assets\/js\/(data|content)\.js$/;
  var ONCE = /\/assets\/js\/(main|player|soft-nav)\.js$/;
  var TTL = 60000;
  var MAX_CACHE = 12;

  var busy = false;
  var cache = new Map();      /* key -> { at, promise } */
  var loaded = Object.create(null);  /* 已加载过的单例脚本路径 */
  var controller = new AbortController();
  window.noojSignal = controller.signal;

  /* ---------- 样式（内联注入，避免每页再加一个 link） ---------- */
  var style = document.createElement("style");
  style.textContent =
    ".sn-bar{position:fixed;top:0;left:0;height:2px;width:0;opacity:0;z-index:400;" +
      "background:var(--accent,#0C7A54);pointer-events:none;" +
      "transition:width .45s ease,opacity .25s ease}" +
    ".sn-bar.on{opacity:1}" +
    "#main:focus{outline:none}" +
    "@keyframes snIn{from{opacity:0}to{opacity:1}}" +
    ".sn-enter{animation:snIn .2s ease both}" +
    "@media (prefers-reduced-motion:reduce){.sn-enter{animation:none}}" +
    ".sn-busy{cursor:progress}";
  document.head.appendChild(style);

  /* ---------- 进度条 ---------- */
  var barEl = null;
  function showBar() {
    if (!barEl) {
      barEl = document.createElement("div");
      barEl.className = "sn-bar";
      document.body.appendChild(barEl);
    }
    barEl.style.transition = "none";
    barEl.style.width = "0";
    barEl.classList.add("on");
    void barEl.offsetWidth;
    barEl.style.transition = "width .45s ease,opacity .25s ease";
    barEl.style.width = "68%";
    document.documentElement.classList.add("sn-busy");
  }
  function hideBar() {
    if (!barEl) return;
    barEl.style.width = "100%";
    document.documentElement.classList.remove("sn-busy");
    setTimeout(function () {
      if (!barEl) return;
      barEl.classList.remove("on");
      barEl.style.width = "0";
    }, 240);
  }

  /* ---------- 链接判定 ---------- */
  function pageUrl(href) {
    var url;
    try { url = new URL(href, location.href); } catch (e) { return null; }
    if (url.origin !== location.origin) return null;
    if (!/^https?:$/.test(url.protocol)) return null;
    if (/\.(xml|json|txt|pdf|zip|gz|png|jpe?g|webp|gif|svg|ico|mp3|m4a|mp4|webm)$/i.test(url.pathname)) return null;
    return url;
  }

  function keyOf(url) {
    return url.pathname + url.search;
  }

  /* ---------- 取页面 ---------- */
  function fetchPage(href) {
    return fetch(href, { credentials: "same-origin" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      var ct = res.headers.get("content-type") || "";
      if (ct.indexOf("html") < 0) throw new Error("not html");
      return res.text();
    });
  }

  function getPage(url) {
    var key = keyOf(url);
    var hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.promise;

    var promise = fetchPage(url.href);
    cache.set(key, { at: Date.now(), promise: promise });
    promise.catch(function () { cache.delete(key); });

    if (cache.size > MAX_CACHE) {
      var oldest = null;
      cache.forEach(function (v, k) {
        if (!oldest || v.at < oldest.at) oldest = { k: k, at: v.at };
      });
      if (oldest) cache.delete(oldest.k);
    }
    return promise;
  }

  function prefetch(href) {
    var url = pageUrl(href);
    if (!url) return;
    var key = keyOf(url);
    if (cache.has(key)) return;
    getPage(url);
  }

  /* ---------- 脚本加载 ---------- */
  function loadScript(src) {
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = s.onerror = function () {
        s.remove();
        resolve();
      };
      document.body.appendChild(s);
    });
  }

  function runScripts(doc, url) {
    var inline = doc.querySelectorAll("script:not([src])");
    Array.prototype.forEach.call(inline, function (s) {
      var text = s.textContent || "";
      /* 文章页的 window.__POST__ 是构建期内联的元信息，必须重新灌入 */
      if (text.indexOf("__POST__") < 0) return;
      try {
        new Function(text)();
      } catch (e) {
        if (window.console) console.warn("[soft-nav] inline script failed", e);
      }
    });

    var plan = [];
    Array.prototype.forEach.call(doc.querySelectorAll("script[src]"), function (s) {
      var src = s.getAttribute("src");
      if (!src) return;
      var abs = new URL(src, url.href).href;
      var path = new URL(abs).pathname;
      if (ONCE.test(path)) return;
      if (SINGLETON.test(path)) {
        if (loaded[path]) return;
        loaded[path] = true;
      }
      plan.push(abs);
    });

    /* 串行执行：home.js 依赖 content.js，并行会拿到 undefined */
    return plan.reduce(function (p, src) {
      return p.then(function () { return loadScript(src); });
    }, Promise.resolve());
  }

  /* ---------- head 同步 ---------- */
  function syncHead(doc, url) {
    if (doc.title) document.title = doc.title;

    var nameOf = ["description", "robots", "theme-color"];
    nameOf.forEach(function (name) {
      var next = doc.querySelector('meta[name="' + name + '"]');
      var cur = document.querySelector('meta[name="' + name + '"]');
      if (next && cur) cur.setAttribute("content", next.getAttribute("content") || "");
    });

    Array.prototype.forEach.call(
      doc.querySelectorAll('meta[property^="og:"], meta[property^="article:"]'),
      function (next) {
        var prop = next.getAttribute("property");
        var cur = document.querySelector('meta[property="' + prop + '"]');
        if (cur) cur.setAttribute("content", next.getAttribute("content") || "");
        else document.head.appendChild(next.cloneNode(true));
      }
    );

    var canon = doc.querySelector('link[rel="canonical"]');
    var curCanon = document.querySelector('link[rel="canonical"]');
    if (canon) {
      if (!curCanon) {
        curCanon = canon.cloneNode(true);
        document.head.appendChild(curCanon);
      } else {
        curCanon.setAttribute("href", canon.getAttribute("href") || "");
      }
    } else if (curCanon) {
      curCanon.remove();
    }
  }

  /* ---------- 导航高亮 ---------- */
  function syncNav(pathname) {
    var page = pathname.split("/").pop() || "index.html";
    var links = document.querySelectorAll(".site-nav a");
    Array.prototype.forEach.call(links, function (a) {
      var href = (a.getAttribute("href") || "").split("?")[0].split("#")[0];
      a.classList.toggle("active", href === page);
    });
  }

  /* ---------- 锚点 ---------- */
  function scrollToHash(hash) {
    if (!hash) return;
    var id;
    try { id = decodeURIComponent(hash.slice(1)); } catch (e) { return; }
    var el = document.getElementById(id);
    if (!el) return;
    var header = document.querySelector(".site-header");
    var offset = (header ? header.offsetHeight : 0) + 16;
    var top = el.getBoundingClientRect().top + (window.scrollY || 0) - offset;
    window.scrollTo({ top: top, behavior: "smooth" });
  }

  /* ---------- 核心：替换页面区域 ---------- */
  function swap(html, url, opts) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var nextBody = doc.body;
    if (!nextBody || !doc.getElementById("main")) throw new Error("no main");

    /* 按页眉把新文档的节点分成「页眉前」「页眉后」两组，脚本与 KEEP 跳过 */
    var before = [];
    var after = [];
    var seenHeader = false;
    Array.prototype.forEach.call(nextBody.children, function (el) {
      if (el.tagName === "SCRIPT") return;
      if (el.matches(KEEP)) {
        if (el.matches(".site-header")) seenHeader = true;
        return;
      }
      (seenHeader ? after : before).push(el.cloneNode(true));
    });

    /* 解绑上一轮页面脚本注册的 window/document 监听 */
    controller.abort();
    controller = new AbortController();
    window.noojSignal = controller.signal;

    var body = document.body;
    var header = body.querySelector(".site-header");
    var footer = body.querySelector(".site-footer");
    if (!header || !footer) throw new Error("shell missing");

    Array.prototype.slice.call(body.children).forEach(function (el) {
      if (el.tagName === "SCRIPT" || el.matches(KEEP)) return;
      el.remove();
    });

    /* 先改 URL 再插节点：文章正文里的 ../media/xxx 才能按目标路径解析 */
    if (!opts.pop) history.pushState({ sn: 1, y: 0 }, "", url.href);

    before.forEach(function (el) { body.insertBefore(el, header); });
    after.forEach(function (el) { body.insertBefore(el, footer); });

    body.classList.remove("nav-open");
    /* 说说页灯箱会把 body 锁滚动，切页后必须复位 */
    body.style.overflow = "";
    var toggle = document.querySelector(".nav-toggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "打开菜单");
    }

    syncHead(doc, url);
    syncNav(url.pathname);

    /* 先滚回顶部再跑脚本：避免旧滚动位置干扰目录高亮、进度条取值 */
    window.scrollTo(0, opts.pop ? opts.y || 0 : 0);

    if (window.revealScan) window.revealScan(document);

    var main = document.getElementById("main");
    if (main) {
      main.setAttribute("tabindex", "-1");
      main.classList.add("sn-enter");
      setTimeout(function () { main.classList.remove("sn-enter"); }, 400);
    }

    return runScripts(doc, url).then(function () {
      if (url.hash) scrollToHash(url.hash);
      if (window.noojWireSongs) window.noojWireSongs();
      if (main) {
        try { main.focus({ preventScroll: true }); } catch (e) { /* 老浏览器忽略 */ }
      }
    });
  }

  /* ---------- 跳转 ---------- */
  function go(href, opts) {
    opts = opts || {};
    var url = new URL(href, location.href);
    if (busy) return;

    busy = true;
    var restoreY = opts.pop ? ((history.state && history.state.y) || 0) : 0;
    if (!opts.pop) {
      /* 记下当前页的滚动位置，供后退时恢复 */
      history.replaceState({ sn: 1, y: window.scrollY || 0 }, "", location.href);
    }
    showBar();

    getPage(url)
      .then(function (html) {
        return swap(html, url, { pop: !!opts.pop, y: restoreY });
      })
      .then(function () {
        busy = false;
        hideBar();
      })
      .catch(function (err) {
        if (window.console) console.warn("[soft-nav] fallback to full load", err);
        location.assign(url.href);
      });
  }

  /* ---------- 事件 ---------- */
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    var a = e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    if (a.target && a.target !== "_self") return;
    if (a.hasAttribute("download")) return;

    var url = pageUrl(a.getAttribute("href"));
    if (!url) return;

    /* 同页纯锚点交给浏览器 */
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    /* 点的就是当前地址：不产生重复历史项 */
    if (url.pathname === location.pathname && url.search === location.search) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    e.preventDefault();
    go(url.href);
  });

  document.addEventListener("pointerover", function (e) {
    var a = e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    prefetch(a.getAttribute("href"));
  }, { passive: true });

  window.addEventListener("popstate", function (e) {
    var st = e.state;
    if (!st || !st.sn) {
      /* 不是本站软导航产生的记录（例如从外站回来后按前进），交给浏览器 */
      return;
    }
    go(location.href, { pop: true });
  });

  /* 初始记录：让第一次后退也能拿到本页的滚动位置 */
  history.scrollRestoration = "manual";
  if (!history.state || !history.state.sn) {
    history.replaceState({ sn: 1, y: 0 }, "", location.href);
  }
})();
