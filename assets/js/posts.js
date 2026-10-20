/* ============================================================
   Nooj Log — 文章归档页
   分类筛选 / 关键词搜索 / URL ?cat= 深链 / 空态
   数据经 NoojContent.load() 获取
   ============================================================ */

(function () {
  "use strict";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  window.NoojContent.load().then(function (D) {
    var POSTS = window.NoojContent.sortPosts(D.posts);
    var catLabel = window.NoojContent.catLabel;
    var catCls = window.NoojContent.catCls;

    var list = document.getElementById("post-list");
    if (!list) return;

    var chipsWrap = document.getElementById("filter-chips");
    var searchInput = document.getElementById("search-input");
    var emptyState = document.getElementById("empty-state");
    var listMeta = document.getElementById("list-meta");
    var totalCount = document.getElementById("total-count");
    var resetBtn = document.getElementById("reset-filter");

    var state = { cat: "all", q: "" };

    /* ---------- 计数 ---------- */
    if (totalCount) totalCount.textContent = String(POSTS.length);
    document.querySelectorAll("[data-count]").forEach(function (el) {
      var cat = el.getAttribute("data-count");
      var n = cat === "all"
        ? POSTS.length
        : POSTS.filter(function (p) { return p.cat === cat; }).length;
      el.textContent = n;
    });

    /* ---------- 渲染 ---------- */
    function matches(p) {
      if (state.cat !== "all" && p.cat !== state.cat) return false;
      if (state.q) {
        var hay = (p.title + " " + p.excerpt + " " + p.tags.join(" ") + " " + catLabel(p.cat)).toLowerCase();
        if (hay.indexOf(state.q.toLowerCase()) < 0) return false;
      }
      return true;
    }

    function render() {
      var shown = POSTS.filter(matches);
      if (!shown.length) {
        list.innerHTML = "";
        listMeta.textContent = "";
        emptyState.classList.add("show");
        return;
      }
      emptyState.classList.remove("show");
      list.innerHTML = shown.map(function (p) {
        return '<li class="post-row">' +
          '<time class="mono" datetime="' + p.date + '">' + p.date + '</time>' +
          '<div class="row-main">' +
            '<h3><a href="posts/' + encodeURIComponent(p.id) + '.html">' + esc(p.title) + '</a></h3>' +
            '<p class="row-excerpt">' + esc(p.excerpt) + '</p>' +
            '<div class="row-tags">' +
              '<span class="chip chip-' + catCls(p.cat) + '">' + catLabel(p.cat) + '</span>' +
              p.tags.map(function (t) { return '<span class="tag">#' + esc(t) + '</span>'; }).join("") +
              '<span class="mono" style="color:var(--muted)">' + p.read + ' min read</span>' +
            '</div>' +
          '</div>' +
          '<span class="row-arr" aria-hidden="true">→</span>' +
        '</li>';
      }).join("");
      listMeta.textContent = "共 " + shown.length + " 篇 / 全部 " + POSTS.length + " 篇";
    }

    /* ---------- 交互 ---------- */
    chipsWrap.addEventListener("click", function (e) {
      var btn = e.target.closest(".filter-chip");
      if (!btn) return;
      state.cat = btn.getAttribute("data-cat");
      chipsWrap.querySelectorAll(".filter-chip").forEach(function (c) {
        c.classList.toggle("active", c === btn);
      });
      render();
    });

    searchInput.addEventListener("input", function () {
      state.q = searchInput.value.trim();
      render();
    });

    resetBtn.addEventListener("click", function () {
      state = { cat: "all", q: "" };
      searchInput.value = "";
      chipsWrap.querySelector('.filter-chip[data-cat="all"]').click();
    });

    /* ---------- URL 深链 ?cat=dev ---------- */
    var params = new URLSearchParams(location.search);
    var cat = params.get("cat");
    if (cat && window.NoojContent.CATS[cat]) {
      var target = chipsWrap.querySelector('.filter-chip[data-cat="' + cat + '"]');
      if (target) target.click();
    } else {
      render();
    }
  });
})();
