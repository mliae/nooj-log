/* ============================================================
   Nooj Log — 内容加载器（单一入口）
   优先级：
   1) fetch content/posts.json + content/projects.json（线上唯一事实源）
   2) 回退 window.NOOJ_DATA（assets/js/data.js，file:// 本地预览用）
   3) 两者皆败：toast 报错并返回空数据，页面不白屏

   所有页面脚本统一通过 NoojContent.load().then(...) 取数据，
   不再直接引用全局 POSTS / PROJECTS。
   ============================================================ */

(function () {
  "use strict";

  /* 分类元数据（与后台 admin/config.yml 的 select 选项保持一致） */
  var CATS = {
    dev:     { label: "开发折腾", cls: "dev" },
    project: { label: "项目展示", cls: "project" },
    life:    { label: "生活日常", cls: "life" }
  };

  var cached = null;

  function fromFallback() {
    var d = window.NOOJ_DATA || {};
    return { posts: d.posts || [], projects: d.projects || [] };
  }

  function fetchJson(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + " -> HTTP " + r.status);
      return r.json();
    });
  }

  function viaFetch() {
    /* file:// 协议下 fetch 必然失败，直接走回退，省一次报错 */
    if (location.protocol === "file:") return Promise.reject(new Error("file protocol"));
    return Promise.all([
      fetchJson("content/posts.json"),
      fetchJson("content/projects.json")
    ]).then(function (arr) {
      return { posts: (arr[0] && arr[0].posts) || [], projects: (arr[1] && arr[1].projects) || [] };
    });
  }

  function load() {
    if (cached) return cached;
    cached = viaFetch()
      .catch(function () {
        if (window.NOOJ_DATA) return fromFallback();
        throw new Error("content unavailable");
      })
      .catch(function (err) {
        if (window.NoojToast) {
          window.NoojToast.show("内容加载失败，请检查网络后刷新重试", "err");
        }
        console.error("[NoojContent]", err);
        return { posts: [], projects: [] };
      });
    return cached;
  }

  /* ---------- 工具函数（与原 data.js 保持一致） ---------- */
  function catLabel(cat) {
    return CATS[cat] ? CATS[cat].label : cat;
  }
  function catCls(cat) {
    return CATS[cat] ? CATS[cat].cls : "dev";
  }
  function getPost(posts, id) {
    for (var i = 0; i < posts.length; i++) if (posts[i].id === id) return posts[i];
    return null;
  }
  /* 相邻文章：prev 为更早一篇（上一页），next 为更新一篇（下一页） */
  function getNeighbors(posts, id) {
    var i = -1;
    posts.forEach(function (p, idx) { if (p.id === id) i = idx; });
    if (i < 0) return { prev: null, next: null };
    return {
      prev: i > 0 ? posts[i - 1] : null,
      next: i < posts.length - 1 ? posts[i + 1] : null
    };
  }
  function tagList(tags) {
    return tags.map(function (t) { return "#" + t; }).join(" ");
  }
  /* 列表统一按日期倒序（后台新建文章未必按序插入） */
  function sortPosts(posts) {
    return posts.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }

  window.NoojContent = {
    load: load,
    CATS: CATS,
    catLabel: catLabel,
    catCls: catCls,
    getPost: getPost,
    getNeighbors: getNeighbors,
    tagList: tagList,
    sortPosts: sortPosts
  };
})();
