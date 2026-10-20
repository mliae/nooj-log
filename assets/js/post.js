/* ============================================================
   Nooj Log — 文章页增强
   ------------------------------------------------------------
   正文、文章头、目录、上下篇都已在构建期直出到 posts/<id>.html
   （见 scripts/render-post.mjs），所以这里不再请求任何数据，
   只做必须在浏览器里完成的事：
     · 代码复制按钮
     · 目录滚动高亮
     · 阅读进度条
     · Giscus 评论挂载
   页面即使完全禁用 JS，正文依然可读。
   ============================================================ */

(function () {
  "use strict";

  var contentEl = document.getElementById("post-content");
  if (!contentEl) return;

  var tocEl = document.getElementById("toc-list");
  var tocWrap = document.getElementById("post-toc");
  var progressBar = document.getElementById("read-progress");
  var post = window.__POST__ || {};

  /* 构建期若因正文格式异常漏转了代码块，这里就地补一次（兜底，正常不走） */
  var KEYWORDS = ("const let var function return if else for while break continue import from export default " +
    "class extends new async await try catch finally throw typeof instanceof this null undefined true false " +
    "def print self None True False and or not lambda with as in of " +
    "SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE").split(" ");
  var KW = {};
  KEYWORDS.forEach(function (k) { KW[k] = 1; });

  var RE = new RegExp(
    "(\\/\\*[\\s\\S]*?\\*\\/" +
    "|\\/\\/[^\\n]*" +
    "|#(?![\\da-fA-F]{3,8}\\b)[^\\n]*" +
    '|"(?:[^"\\\\\\n]|\\\\.)*"' +
    "|'(?:[^'\\\\\\n]|\\\\.)*'" +
    "|`(?:[^`\\\\]|\\\\.)*`" +
    "|\\b(?:" + KEYWORDS.join("|") + ")\\b" +
    "|\\b\\d+(?:\\.\\d+)?\\b)",
    "g"
  );

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlight(raw) {
    var out = "";
    var last = 0;
    var m;
    RE.lastIndex = 0;
    while ((m = RE.exec(raw)) !== null) {
      out += esc(raw.slice(last, m.index));
      var t = m[0];
      var cls = "tok-num";
      if (t.indexOf("//") === 0 || t.indexOf("/*") === 0 || t.indexOf("#") === 0) cls = "tok-com";
      else if (t.charAt(0) === '"' || t.charAt(0) === "'" || t.charAt(0) === "`") cls = "tok-str";
      else if (/^\d/.test(t)) cls = "tok-num";
      else if (KW[t]) cls = "tok-kw";
      out += '<span class="' + cls + '">' + esc(t) + "</span>";
      last = m.index + t.length;
    }
    out += esc(raw.slice(last));
    return out;
  }

  contentEl.querySelectorAll("pre[data-lang]").forEach(function (pre) {
    var code = pre.querySelector("code");
    if (!code) return;
    var lang = pre.getAttribute("data-lang") || "code";
    var block = document.createElement("div");
    block.className = "code-block";
    var head = document.createElement("div");
    head.className = "code-head";
    head.innerHTML = "<span>" + esc(lang) + "</span>";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.textContent = "复制";
    head.appendChild(btn);
    var newPre = document.createElement("pre");
    var newCode = document.createElement("code");
    newCode.innerHTML = highlight(code.textContent);
    newPre.appendChild(newCode);
    block.appendChild(head);
    block.appendChild(newPre);
    pre.parentNode.replaceChild(block, pre);
  });

  /* ---------- 复制按钮：事件委托，覆盖构建期与运行时两种来源 ---------- */
  contentEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".copy-btn");
    if (!btn) return;
    var block = btn.closest(".code-block");
    var codeEl = block && block.querySelector("code");
    if (!codeEl) return;
    var raw = codeEl.textContent;

    function done() {
      btn.textContent = "已复制 ✓";
      btn.classList.add("copied");
      setTimeout(function () {
        btn.textContent = "复制";
        btn.classList.remove("copied");
      }, 1400);
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = raw;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (err) { /* 忽略 */ }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(raw).then(done, fallback);
    } else {
      fallback();
    }
  });

  var headings = contentEl.querySelectorAll("h2, h3");

  /* ---------- 阅读进度 ---------- */
  if (progressBar) {
    var article = document.querySelector(".post-article");
    var ticking = false;
    function update() {
      ticking = false;
      var rect = article.getBoundingClientRect();
      var total = rect.height - window.innerHeight;
      var passed = -rect.top;
      var pct = total > 0 ? Math.min(100, Math.max(0, (passed / total) * 100)) : (rect.top < 0 ? 100 : 0);
      progressBar.style.width = pct + "%";
    }
    window.addEventListener("scroll", function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
      /* 软导航时随 window.noojSignal 一起解绑，避免重复叠加 */
    }, { passive: true, signal: window.noojSignal });
    update();
  }

  /* ---------- 目录高亮 ---------- */
  if (tocEl && headings.length) {
    var links = tocEl.querySelectorAll("a");
    var tocTicking = false;
    function updateToc() {
      tocTicking = false;
      var current = headings[0];
      headings.forEach(function (h) {
        if (h.getBoundingClientRect().top < 140) current = h;
      });
      links.forEach(function (a) {
        a.classList.toggle("active", a.getAttribute("href") === "#" + current.id);
      });
    }
    window.addEventListener("scroll", function () {
      if (!tocTicking) {
        tocTicking = true;
        requestAnimationFrame(updateToc);
      }
    }, { passive: true, signal: window.noojSignal });
    updateToc();
  } else if (tocWrap && !headings.length) {
    tocWrap.style.display = "none";
  }

  /* ---------- Giscus 评论（未配置时优雅降级） ----------
     配置方式：在任意页面脚本前定义 window.NOOJ_GISCUS = { repo, repoId, category, categoryId } */
  (function mountGiscus() {
    var wrap = document.getElementById("giscus");
    if (!wrap) return;
    var cfg = window.NOOJ_GISCUS || {};
    if (!cfg.repo || !cfg.repoId || !cfg.categoryId) {
      wrap.innerHTML =
        '<div class="giscus-hint">' +
          '<p>评论区尚未启用。</p>' +
          '<p class="sub">按 README「接入 Giscus 评论」一节填入 repo 信息即可激活——基于 GitHub Discussions，零服务器。</p>' +
        '</div>';
      return;
    }
    var theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    var s = document.createElement("script");
    s.src = "https://giscus.app/client.js";
    s.setAttribute("data-repo", cfg.repo);
    s.setAttribute("data-repo-id", cfg.repoId);
    s.setAttribute("data-category", cfg.category || "Announcements");
    s.setAttribute("data-category-id", cfg.categoryId);
    s.setAttribute("data-mapping", cfg.mapping || "pathname");
    s.setAttribute("data-strict", "0");
    s.setAttribute("data-reactions-enabled", "1");
    s.setAttribute("data-emit-metadata", "0");
    s.setAttribute("data-input-position", "top");
    s.setAttribute("data-theme", theme);
    s.setAttribute("data-lang", "zh-CN");
    s.setAttribute("data-loading", "lazy");
    s.crossOrigin = "anonymous";
    s.async = true;
    wrap.appendChild(s);

    document.addEventListener("nooj:theme", function (e) {
      var iframe = wrap.querySelector("iframe.giscus-frame");
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage(
          { giscus: { setConfig: { theme: e.detail === "dark" ? "dark" : "light" } } },
          "https://giscus.app"
        );
      }
    }, { signal: window.noojSignal });
  })();
})();
