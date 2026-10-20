/* ============================================================
   Nooj Log — 文章页预渲染
   ------------------------------------------------------------
   在构建期把一篇文章渲染成完整 HTML，产出 posts/<id>.html。
   这样访客打开文章只需要「一个 HTML 请求」，不必：
     HTML → 等 JS → 再 fetch posts.json → 再渲染
   首字节即为正文，无 JS 也能读。

   渲染规则与 assets/js/post.js 逐字对齐（class 名、结构、顺序），
   运行时脚本看到已渲染的内容就只做交互增强，不重复渲染。
   ============================================================ */

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------- 代码高亮（与 post.js 的 RE / 配色类名一致） ---------- */
const KEYWORDS = (
  "const let var function return if else for while break continue import from export default " +
  "class extends new async await try catch finally throw typeof instanceof this null undefined true false " +
  "def print self None True False and or not lambda with as in of " +
  "SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE"
).split(" ");

const KW = Object.create(null);
KEYWORDS.forEach((k) => { KW[k] = 1; });

const RE = new RegExp(
  "(\\/\\*[\\s\\S]*?\\*\\/)" +            // 块注释
  "|\\/\\/[^\\n]*" +                      // 行注释
  "|#(?![\\da-fA-F]{3,8}\\b)[^\\n]*" +    // # 注释（排除十六进制色值）
  '|"(?:[^"\\\\\\n]|\\\\.)*"' +           // 双引号字符串
  "|'(?:[^'\\\\\\n]|\\\\.)*'" +           // 单引号字符串
  "|`(?:[^`\\\\]|\\\\.)*`" +              // 模板字符串
  "|\\b(?:" + KEYWORDS.join("|") + ")\\b" +
  "|\\b\\d+(?:\\.\\d+)?\\b",              // 数字
  "g"
);

function highlight(raw) {
  let out = "";
  let last = 0;
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(raw)) !== null) {
    out += esc(raw.slice(last, m.index));
    const t = m[0];
    let cls = "tok-num";
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

/* HTML 实体反转义：用于把 <code> 里的文本取回原文再高亮 */
function unesc(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/* ---------- 正文加工 ----------
   返回 { html, headings }，headings 用于生成目录与运行时高亮。 */
export function processBody(raw) {
  let html = String(raw || "");

  /* 1) 代码块：<pre data-lang="x"><code>…</code></pre>
        → 带语言标签与复制按钮的 .code-block，并在构建期完成高亮 */
  html = html.replace(
    /<pre([^>]*?)data-lang="([^"]*)"([^>]*)>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g,
    (_full, _a, lang, _b, code) => {
      const text = unesc(code).replace(/\n+$/, "");
      return (
        '<div class="code-block">' +
          '<div class="code-head"><span>' + esc(lang || "code") + "</span>" +
          '<button class="copy-btn" type="button">复制</button></div>' +
          "<pre><code>" + highlight(text) + "</code></pre>" +
        "</div>"
      );
    }
  );

  /* 2) 标题锚点：h2/h3 依次编号 sec-1、sec-2…（与运行时一致的编号方式） */
  const headings = [];
  html = html.replace(/<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/g, (_full, lv, attrs, inner) => {
    const id = "sec-" + (headings.length + 1);
    const text = inner.replace(/<[^>]+>/g, "").replace(/#$/, "").trim();
    headings.push({ level: Number(lv), id, text });
    const cleanAttrs = (attrs || "").replace(/\sid="[^"]*"/, "");
    return (
      "<h" + lv + cleanAttrs + ' id="' + id + '">' + inner +
      '<a class="anchor" href="#' + id + '" aria-hidden="true">#</a>' +
      "</h" + lv + ">"
    );
  });

  /* 3) 图片：补懒加载与异步解码（跳过已声明过的） */
  html = html.replace(/<img\b([^>]*)>/g, (full, attrs) => {
    let a = attrs;
    if (!/\bloading=/.test(a)) a += ' loading="lazy"';
    if (!/\bdecoding=/.test(a)) a += ' decoding="async"';
    return "<img" + a + ">";
  });

  /* 4) 站内旧链接（post.html?id=xxx）就地换成静态地址 */
  html = html.replace(/(href=["'])post\.html\?id=([^"']+)\1/g, (_m, q, id) => {
    return q + "/posts/" + decodeURIComponent(id) + ".html" + q;
  });
  /* 相对地址纠正：正文里的 /posts/ 是站根绝对路径，在 posts/ 目录下仍然可用 */

  return { html, headings };
}

/* ---------- 目录 ---------- */
function renderToc(headings) {
  return headings
    .map((h) =>
      '<a class="' + (h.level === 3 ? "lv3" : "lv2") + '" href="#' + h.id + '">' + esc(h.text) + "</a>"
    )
    .join("");
}

/* ---------- 文章头 ---------- */
function renderHeader(post, up, catLabel, catCls) {
  return (
    '<a class="back-link" href="' + up + 'posts.html">← 返回文章列表</a>' +
    '<span class="chip chip-' + catCls(post.cat) + '">' + catLabel(post.cat) + "</span>" +
    "<h1>" + esc(post.title) + "</h1>" +
    '<div class="post-meta mono">' +
      '<time datetime="' + esc(post.date) + '">' + esc(post.date) + "</time>" +
      '<span class="sep">/</span>' +
      "<span>" + esc(post.read) + " min read</span>" +
      '<span class="sep">/</span>' +
      '<span class="tags">' +
        (post.tags || []).map((t) => '<span class="tag">#' + esc(t) + "</span>").join("") +
      "</span>" +
    "</div>" +
    '<p class="post-lede">' + esc(post.excerpt) + "</p>"
  );
}

/* ---------- 上下篇 ---------- */
function renderNav(prev, next, up) {
  const left = prev
    ? '<a href="' + up + "posts/" + encodeURIComponent(prev.id) + '.html">' +
        '<span class="nav-label">← 上一篇（更早）</span>' +
        '<span class="nav-title">' + esc(prev.title) + "</span></a>"
    : '<a href="' + up + 'posts.html">' +
        '<span class="nav-label">← ARCHIVE</span>' +
        '<span class="nav-title">文章归档</span></a>';
  const right = next
    ? '<a class="next" href="' + up + "posts/" + encodeURIComponent(next.id) + '.html">' +
        '<span class="nav-label">下一篇（更新）→</span>' +
        '<span class="nav-title">' + esc(next.title) + "</span></a>"
    : '<a class="next" href="' + up + 'index.html">' +
        '<span class="nav-label">HOME →</span>' +
        '<span class="nav-title">回到首页</span></a>';
  return left + right;
}

/* ---------- 主函数 ----------
   tpl   : post.html 的模板文本
   post  : 单篇文章（含 content）
   ctx   : { site, prev, next, catLabel, catCls }
   返回完整的 HTML 字符串（路径已按 posts/ 层级修正）。 */
export function renderPostPage(tpl, post, ctx) {
  const up = "../";
  const abs = ctx.site + "/posts/" + encodeURIComponent(post.id) + ".html";
  const { html: body, headings } = processBody(post.content);

  /* 1) 先把模板里所有相对路径改成上一级（正文与片段随后注入，自带 ../） */
  let page = tpl.replace(
    /(href|src)="(?!https?:|\/\/|#|\/|mailto:)([^"]*)"/g,
    (_m, attr, path) => attr + '="' + up + path + '"'
  );

  /* 1.5) 剥掉模板里的旧链接跳转脚本与 noindex（那是给 post.html 用的） */
  page = page.replace(/\s*<!-- legacy-redirect:[\s\S]*?<\/script>/, "");
  page = page.replace(/\s*<meta name="robots" content="noindex[^"]*">/, "");

  /* 2) head 元信息 */
  page = page.replace(/<title>[\s\S]*?<\/title>/, "<title>" + esc(post.title) + " — Nooj Log</title>");
  page = page.replace(
    /<meta name="description" content="[^"]*">/,
    '<meta name="description" content="' + esc(post.excerpt) + '">'
  );
  page = page.replace(
    /<meta property="og:title" content="[^"]*">/,
    '<meta property="og:title" content="' + esc(post.title) + '">'
  );
  page = page.replace(
    /<meta property="og:description" content="[^"]*">/,
    '<meta property="og:description" content="' + esc(post.excerpt) + '">'
  );
  page = page.replace(
    /<meta property="og:url" content="[^"]*">/,
    '<meta property="og:url" content="' + esc(abs) + '">\n' +
    '  <meta property="article:published_time" content="' + esc(post.date) + '">\n' +
    '  <link rel="canonical" href="' + esc(abs) + '">'
  );

  /* 3) 文章头 */
  page = page.replace(
    /<header class="post-header" id="post-header"><\/header>/,
    '<header class="post-header" id="post-header">' +
      renderHeader(post, up, ctx.catLabel, ctx.catCls) +
    "</header>"
  );

  /* 4) 正文 */
  page = page.replace(
    /<div class="post-content" id="post-content"><\/div>/,
    '<div class="post-content" id="post-content">' + body + "</div>"
  );

  /* 5) 目录（无标题则整块隐藏） */
  if (headings.length) {
    page = page.replace(
      /<nav class="toc-list" id="toc-list"><\/nav>/,
      '<nav class="toc-list" id="toc-list">' + renderToc(headings) + "</nav>"
    );
  } else {
    page = page.replace(/<aside class="post-toc"([^>]*)>/, '<aside class="post-toc"$1 style="display:none">');
  }

  /* 6) 上下篇 */
  page = page.replace(
    /<nav class="post-nav" id="post-nav"([^>]*)><\/nav>/,
    '<nav class="post-nav" id="post-nav"$1>' + renderNav(ctx.prev, ctx.next, up) + "</nav>"
  );

  /* 7) 文末注脚 */
  page = page.replace(
    /<p class="post-note" id="post-note"><\/p>/,
    '<p class="post-note" id="post-note">' +
      "<strong>本文写于 " + esc(post.date) + "</strong> · 归类于「" + esc(ctx.catLabel(post.cat)) + "」 · " +
      '如果这篇记录帮到了你，或者发现有说得不对的地方，欢迎来信聊聊 ——  <a href="' + up + 'about.html">关于我 →</a>' +
    "</p>"
  );

  /* 8) 去掉 file:// 回退数据与内容加载器（预渲染页两者都不需要），
        并在 post.js 之前注入精简的元信息 */
  page = page.replace(/\s*<script src="\.\.\/assets\/js\/data\.js"><\/script>/, "");
  page = page.replace(/\s*<script src="\.\.\/assets\/js\/content\.js"><\/script>/, "");
  page = page.replace(
    /(\s*)<script src="\.\.\/assets\/js\/post\.js"><\/script>/,
    "\n  <script>window.__POST__ = " +
      JSON.stringify({
        id: post.id,
        title: post.title,
        cat: post.cat,
        date: post.date,
        read: post.read,
        tags: post.tags || [],
        excerpt: post.excerpt
      }) +
      ";</script>\n  <script src=\"../assets/js/post.js\"></script>"
  );

  return page;
}
