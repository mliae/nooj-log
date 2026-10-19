/* ============================================================
   Nooj Log — 文章详情页
   渲染 / 代码高亮 / 复制按钮 / 目录 / 阅读进度 / 上下篇 / Giscus 评论
   数据经 NoojContent.load() 获取
   ============================================================ */

(function () {
  "use strict";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  window.NoojContent.load().then(function (D) {
    var POSTS = window.NoojContent.sortPosts(D.posts);
    var catLabel = window.NoojContent.catLabel;
    var catCls = window.NoojContent.catCls;

    var headerEl = document.getElementById("post-header");
    var contentEl = document.getElementById("post-content");
    var tocEl = document.getElementById("toc-list");
    var tocWrap = document.getElementById("post-toc");
    var navEl = document.getElementById("post-nav");
    var noteEl = document.getElementById("post-note");
    var progressBar = document.getElementById("read-progress");

    var id = new URLSearchParams(location.search).get("id");
    var post = id ? window.NoojContent.getPost(POSTS, id) : null;

    /* ---------- 404 态 ---------- */
    if (!post) {
      document.title = "文章不存在 — Nooj Log";
      headerEl.innerHTML =
        '<a class="back-link" href="posts.html">← 返回文章列表</a>' +
        '<h1>这里还没有痕迹</h1>' +
        '<p class="post-lede">你要找的文章不存在，或者链接已经失效。也许它还在草稿箱里。</p>';
      contentEl.innerHTML = "";
      if (tocWrap) tocWrap.style.display = "none";
      navEl.innerHTML =
        '<a href="posts.html"><span class="nav-label">ARCHIVE</span><span class="nav-title">去文章归档逛逛 →</span></a>';
      if (noteEl) noteEl.innerHTML = "// 如果你认为这是一个错误，欢迎来信告诉我。";
      return;
    }

    document.title = post.title + " — Nooj Log";
    var metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", post.excerpt);

    /* ---------- 文章头 ---------- */
    headerEl.innerHTML =
      '<a class="back-link" href="posts.html">← 返回文章列表</a>' +
      '<span class="chip chip-' + catCls(post.cat) + '">' + catLabel(post.cat) + '</span>' +
      '<h1>' + esc(post.title) + '</h1>' +
      '<div class="post-meta mono">' +
        '<time datetime="' + post.date + '">' + post.date + '</time>' +
        '<span class="sep">/</span>' +
        '<span>' + post.read + ' min read</span>' +
        '<span class="sep">/</span>' +
        '<span class="tags">' + post.tags.map(function (t) { return '<span class="tag">#' + esc(t) + '</span>'; }).join("") + '</span>' +
      '</div>' +
      '<p class="post-lede">' + esc(post.excerpt) + '</p>';

    /* ---------- 正文 ---------- */
    contentEl.innerHTML = post.content;

    /* 标题加锚点 */
    var headings = contentEl.querySelectorAll("h2, h3");
    headings.forEach(function (h, i) {
      var hid = "sec-" + (i + 1);
      h.id = hid;
      var a = document.createElement("a");
      a.className = "anchor";
      a.href = "#" + hid;
      a.textContent = "#";
      a.setAttribute("aria-hidden", "true");
      h.appendChild(a);
    });

    /* ---------- 代码高亮 ---------- */
    var KEYWORDS = ("const let var function return if else for while break continue import from export default " +
      "class extends new async await try catch finally throw typeof instanceof this null undefined true false " +
      "def print self None True False and or not lambda with as in of " +
      "SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE").split(" ");
    var KW = {};
    KEYWORDS.forEach(function (k) { KW[k] = 1; });

    var RE = new RegExp(
      "(\\/\\*[\\s\\S]*?\\*\\/" +          // 块注释
      "|\\/\\/[^\\n]*" +                    // 行注释
      "|#(?![\\da-fA-F]{3,8}\\b)[^\\n]*" +  // # 注释（排除 CSS 十六进制色值）
      '|"(?:[^"\\\\\\n]|\\\\.)*"' +         // 双引号字符串
      "|'(?:[^'\\\\\\n]|\\\\.)*'" +         // 单引号字符串
      "|`(?:[^`\\\\]|\\\\.)*`" +            // 模板字符串
      "|\\b(?:" + KEYWORDS.join("|") + ")\\b" +
      "|\\b\\d+(?:\\.\\d+)?\\b)",            // 数字
      "g"
    );

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
      var raw = code.textContent;
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
      newCode.innerHTML = highlight(raw);
      newPre.appendChild(newCode);
      block.appendChild(head);
      block.appendChild(newPre);
      pre.parentNode.replaceChild(block, pre);

      btn.addEventListener("click", function () {
        function done() {
          btn.textContent = "已复制 ✓";
          btn.classList.add("copied");
          setTimeout(function () {
            btn.textContent = "复制";
            btn.classList.remove("copied");
          }, 1400);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(raw).then(done).catch(function () { fallback(); });
        } else {
          fallback();
        }
        function fallback() {
          var ta = document.createElement("textarea");
          ta.value = raw;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); done(); } catch (e) {}
          document.body.removeChild(ta);
        }
      });
    });

    /* ---------- 目录 ---------- */
    if (headings.length && tocEl) {
      var html = "";
      headings.forEach(function (h, i) {
        var hid = "sec-" + (i + 1);
        html += '<a class="' + (h.tagName === "H3" ? "lv3" : "lv2") + '" href="#' + hid + '">' +
          esc(h.textContent.replace(/#$/, "")) + "</a>";
      });
      tocEl.innerHTML = html;
    } else if (tocWrap) {
      tocWrap.style.display = "none";
    }

    /* ---------- 上下篇 ---------- */
    var nb = window.NoojContent.getNeighbors(POSTS, post.id);
    var prev = nb.prev || { title: "文章归档", id: "" };
    var next = nb.next || { title: "回到首页", id: "" };
    navEl.innerHTML =
      '<a href="' + (nb.prev ? "post.html?id=" + encodeURIComponent(nb.prev.id) : "posts.html") + '">' +
        '<span class="nav-label">' + (nb.prev ? "← 上一篇（更早）" : "← ARCHIVE") + "</span>" +
        '<span class="nav-title">' + esc(prev.title) + "</span>" +
      "</a>" +
      '<a class="next" href="' + (nb.next ? "post.html?id=" + encodeURIComponent(nb.next.id) : "index.html") + '">' +
        '<span class="nav-label">' + (nb.next ? "下一篇（更新）→" : "HOME →") + "</span>" +
        '<span class="nav-title">' + esc(next.title) + "</span>" +
      "</a>";

    /* ---------- 文末注脚 ---------- */
    if (noteEl) {
      noteEl.innerHTML =
        "<strong>本文写于 " + post.date + "</strong> · 归类于「" + catLabel(post.cat) + "」 · " +
        "如果这篇记录帮到了你，或者发现有说得不对的地方，欢迎来信聊聊 ——  <a href=\"about.html\">关于我 →</a>";
    }

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
      }, { passive: true });
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
      }, { passive: true });
      updateToc();
    }

    /* ---------- Giscus 评论（未配置时优雅降级） ----------
       配置方式（二选一）：
       a) 在任意页面脚本前定义 window.NOOJ_GISCUS = { repo, repoId, category, categoryId }
       b) 部署后从 content/site.json 读取（如已接入后台）
       未配置时不渲染评论区，只显示一句提示，绝不影响正文。 */
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

      /* 主题联动：通过 giscus 官方 postMessage 协议切换 iframe 主题 */
      document.addEventListener("nooj:theme", function (e) {
        var iframe = wrap.querySelector("iframe.giscus-frame");
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage(
            { giscus: { setConfig: { theme: e.detail === "dark" ? "dark" : "light" } } },
            "https://giscus.app"
          );
        }
      });
    })();
  });
})();
