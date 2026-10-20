/* ============================================================
   Nooj Log — 首页渲染
   hero 统计 / 分类计数 / 最新文章 / 精选项目
   数据经 NoojContent.load() 获取（content/*.json → file:// 回退）
   ============================================================ */

(function () {
  "use strict";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  window.NoojContent.load().then(function (D) {
    var POSTS = window.NoojContent.sortPosts(D.posts);
    var PROJECTS = D.projects;
    var catLabel = window.NoojContent.catLabel;
    var catCls = window.NoojContent.catCls;
    var tagList = window.NoojContent.tagList;

    /* ---------- hero 统计 ---------- */
    var stats = document.getElementById("hero-stats");
    if (stats) {
      var latest = POSTS[0];
      stats.innerHTML =
        '<div class="stat"><dt>' + POSTS.length + '</dt><dd>篇文章已记录</dd></div>' +
        '<div class="stat"><dt>' + PROJECTS.length + '</dt><dd>个项目在折腾</dd></div>' +
        '<div class="stat"><dt>' + (latest ? latest.date : "—") + '</dt><dd>最近更新</dd></div>';
    }

    /* ---------- 分类计数 ---------- */
    document.querySelectorAll("[data-count]").forEach(function (el) {
      var cat = el.getAttribute("data-count");
      var n = POSTS.filter(function (p) { return p.cat === cat; }).length;
      el.textContent = n + " 篇";
    });

    /* ---------- 文章卡片 ---------- */
    function postCard(p) {
      return '<article class="post-card reveal">' +
        '<div class="card-top">' +
          '<span class="chip chip-' + catCls(p.cat) + '">' + catLabel(p.cat) + '</span>' +
          '<time class="mono" datetime="' + p.date + '">' + p.date + '</time>' +
        '</div>' +
        '<h3><a href="posts/' + encodeURIComponent(p.id) + '.html">' + esc(p.title) + '</a></h3>' +
        '<p class="excerpt">' + esc(p.excerpt) + '</p>' +
        '<div class="card-meta mono">' +
          '<span>' + p.read + ' min read</span><span>·</span>' +
          '<span>' + tagList(p.tags) + '</span>' +
        '</div>' +
      '</article>';
    }

    var latestWrap = document.getElementById("latest-posts");
    if (latestWrap) {
      latestWrap.innerHTML = POSTS.slice(0, 3).map(postCard).join("");
      if (window.revealScan) window.revealScan(latestWrap);
    }

    /* ---------- 精选项目 ---------- */
    var projWrap = document.getElementById("featured-projects");
    if (projWrap) {
      /* 优先 featured，不足 2 个时用普通项目补位，保证首页区块饱满 */
      var featured = PROJECTS.filter(function (p) { return p.featured; });
      var rest = PROJECTS.filter(function (p) { return !p.featured; });
      var shown = featured.concat(rest).slice(0, 2);
      projWrap.innerHTML = shown.map(function (p, i) {
        var n = String(i + 1).padStart(2, "0");
        return '<article class="project-card reveal' + (p.featured ? " featured" : "") + '">' +
          '<header class="project-head">' +
            '<span class="p-index mono">' + n + ' /</span>' +
            '<h3>' + esc(p.name) + '</h3>' +
            (p.featured ? '<span class="chip chip-dev">进行中</span>' : "") +
          '</header>' +
          '<p class="project-tagline">' + esc(p.tagline) + '</p>' +
          '<p class="project-desc">' + esc(p.desc) + '</p>' +
          '<div class="project-foot">' +
            '<div class="tech-tags">' + p.tech.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join("") + '</div>' +
            '<div class="project-links">' +
              '<a href="projects.html">全部项目 <span class="arr">→</span></a>' +
            '</div>' +
          '</div>' +
        '</article>';
      }).join("");
      if (window.revealScan) window.revealScan(projWrap);
    }

    /* ---------- 最近说（碎片流最新 5 条） ---------- */
    var notesWrap = document.getElementById("latest-notes");
    if (notesWrap) {
      var NOTES = window.NoojContent.sortNotes(
        (D.notes || []).filter(function (n) { return n && n.id && !n.draft; })
      );
      if (!NOTES.length) {
        /* 还没有碎念时整块不出现，不留一个空抽屉 */
        var sec = notesWrap.closest(".section");
        if (sec) sec.remove();
      } else {
        notesWrap.innerHTML = NOTES.slice(0, 5).map(function (n) {
          var p = window.NoojContent.noteParts(n.date);
          var flat = String(n.text || "").replace(/\s*\n+\s*/g, " ").trim();
          return '<a class="note-mini reveal" href="notes.html#' + encodeURIComponent(n.id) + '">' +
            '<time class="mono" datetime="' + esc(String(n.date).replace(" ", "T")) + '">' +
              p.m + "-" + p.d + " " + p.hm + "</time>" +
            '<p>' + esc(flat) + "</p>" +
            '<span class="arr" aria-hidden="true">→</span>' +
          "</a>";
        }).join("");
        if (window.revealScan) window.revealScan(notesWrap);
      }
    }
  });
})();
