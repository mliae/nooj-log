/* ============================================================
   Nooj Log — 公共脚本
   主题切换 / 移动导航 / 头部滚动态 / 入场动画 / 回到顶部
   ============================================================ */

(function () {
  "use strict";

  var root = document.documentElement;

  /* ---------- 主题 ---------- */
  function currentTheme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function setTheme(theme, persist) {
    root.setAttribute("data-theme", theme);
    if (persist) {
      try { localStorage.setItem("nooj-theme", theme); } catch (e) {}
    }
    var btn = document.querySelector(".theme-toggle");
    if (btn) {
      btn.setAttribute("aria-label", theme === "dark" ? "切换到浅色模式" : "切换到深色模式");
      btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    }
    /* 通知订阅方（如 Giscus iframe）主题已变化 */
    document.dispatchEvent(new CustomEvent("nooj:theme", { detail: theme }));
  }

  setTheme(currentTheme(), false);

  document.addEventListener("click", function (e) {
    var toggle = e.target.closest ? e.target.closest(".theme-toggle") : null;
    if (toggle) {
      setTheme(currentTheme() === "dark" ? "light" : "dark", true);
    }
  });

  /* ---------- 移动端导航 ---------- */
  var navToggle = document.querySelector(".nav-toggle");
  if (navToggle) {
    navToggle.addEventListener("click", function () {
      var open = document.body.classList.toggle("nav-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
      navToggle.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
    });
  }
  document.addEventListener("click", function (e) {
    if (!document.body.classList.contains("nav-open")) return;
    if (e.target.closest(".site-nav a")) {
      document.body.classList.remove("nav-open");
      if (navToggle) navToggle.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && document.body.classList.contains("nav-open")) {
      document.body.classList.remove("nav-open");
      if (navToggle) navToggle.setAttribute("aria-expanded", "false");
    }
  });

  /* ---------- 头部滚动态 ---------- */
  var header = document.querySelector(".site-header");
  var backTop = document.querySelector(".back-top");
  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    if (header) header.classList.toggle("scrolled", y > 8);
    if (backTop) backTop.classList.toggle("visible", y > 600);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (backTop) {
    backTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  /* ---------- 入场动画（IntersectionObserver，只动 opacity/transform） ----------
     暴露 window.revealScan(root)：供各页面在动态注入 HTML 后调用，
     保证后插入的 .reveal 元素同样能被观察。
     另用视口探针元素检测 IO 回调是否真的触发；某些环境（无头渲染、
     内嵌 webview）中 IO 存在但不触发，此时直接显示全部，内容永不隐藏。 */
  var revealIO = null;
  var ioBroken = false;

  function observeReveals(root) {
    var els = (root || document).querySelectorAll(".reveal:not(.in)");
    if (!els.length) return;
    if (ioBroken || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    if (!revealIO) {
      revealIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            revealIO.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    }
    els.forEach(function (el) { revealIO.observe(el); });
  }
  window.revealScan = observeReveals;

  observeReveals(document);

  /* 滚动兜底：瞬间跳转（锚点、滚轮加速、End 键）时，已整体滚过
     视口的元素不会被 IO 触发，这里补扫一遍，保证内容永不隐藏。 */
  var sweepTicking = false;
  function sweepSkipped() {
    sweepTicking = false;
    var pending = document.querySelectorAll(".reveal:not(.in)");
    for (var i = 0; i < pending.length; i++) {
      if (pending[i].getBoundingClientRect().bottom <= 0) {
        pending[i].classList.add("in");
      }
    }
  }
  window.addEventListener("scroll", function () {
    if (!sweepTicking) {
      sweepTicking = true;
      requestAnimationFrame(sweepSkipped);
    }
  }, { passive: true });

  /* IO 自检：探针元素在视口内，若 600ms 内未收到回调则认为 IO 失效 */
  if ("IntersectionObserver" in window && document.querySelector(".reveal")) {
    var probe = document.createElement("div");
    probe.style.cssText = "position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none;";
    document.body.appendChild(probe);
    var probeFired = false;
    var probeIO = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) {
        probeFired = true;
        probeIO.disconnect();
        probe.remove();
      }
    });
    probeIO.observe(probe);
    setTimeout(function () {
      if (!probeFired) {
        ioBroken = true;
        probeIO.disconnect();
        probe.remove();
        if (revealIO) { revealIO.disconnect(); revealIO = null; }
        observeReveals(document);   /* 重新扫描，含动态注入的元素 */
      }
    }, 600);
  }

  /* ---------- 当前导航高亮 ---------- */
  var page = (location.pathname.split("/").pop() || "index.html").split("?")[0];
  document.querySelectorAll(".site-nav a").forEach(function (a) {
    var href = a.getAttribute("href");
    if (href === page) a.classList.add("active");
  });

  /* ---------- 轻提示（toast） ----------
     供各页面脚本使用：NoojToast.show("消息", "ok|err|info")
     替代 alert，错误文案中文化、可行动，失败不静默。 */
  var toastTimer = null;
  window.NoojToast = {
    show: function (msg, type) {
      var old = document.querySelector(".toast");
      if (old) old.remove();
      if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
      var el = document.createElement("div");
      el.className = "toast toast-" + (type || "info");
      el.setAttribute("role", "status");
      el.textContent = msg;
      document.body.appendChild(el);
      /* 强制 reflow 后加类，触发过渡动画 */
      void el.offsetWidth;
      el.classList.add("show");
      toastTimer = setTimeout(function () {
        el.classList.remove("show");
        setTimeout(function () { el.remove(); }, 300);
      }, 3600);
    }
  };

  /* ---------- 页脚年份 ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });
})();
