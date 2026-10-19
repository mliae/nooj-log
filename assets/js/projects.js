/* ============================================================
   Nooj Log — 项目展示页
   数据经 NoojContent.load() 获取
   ============================================================ */

(function () {
  "use strict";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  window.NoojContent.load().then(function (D) {
    var wrap = document.getElementById("project-list");
    if (!wrap) return;
    var PROJECTS = D.projects;

    wrap.innerHTML = PROJECTS.map(function (p, i) {
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
            (p.repo ? '<a href="' + esc(p.repo) + '" aria-label="' + esc(p.name) + ' 源码">源码 <span class="arr">↗</span></a>' : "") +
            (p.demo ? '<a href="' + esc(p.demo) + '" aria-label="' + esc(p.name) + ' 演示">演示 <span class="arr">↗</span></a>' : "") +
          '</div>' +
        '</div>' +
      '</article>';
    }).join("");
    if (window.revealScan) window.revealScan(wrap);
  });
})();
