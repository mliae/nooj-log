/* ============================================================
   Nooj Log 后台 — 音乐标记（文章 / 说说共用）
   ------------------------------------------------------------
   语法：!song(t22|歌名|歌手)
     · 后台插入时写入 markdown 源（编辑源 md）
     · 保存时由 expandSongs() 展开成卡片 HTML 存进 content
     · 前台 player.js 扫 .psong[data-song] 接管播放（复用悬浮播放器）
   ============================================================ */

const SONG = /!song\(\s*([A-Za-z0-9_-]+)\s*(?:\|([^|\n)]*)\|([^\n)]*))?\s*\)/g;

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* 把选中的歌拼成 markdown 标记（| ) 换行会破坏语法，先洗掉） */
export function marker({ id, name, artist }) {
  const clean = (v) => String(v == null ? "" : v).replace(/[|\n)\r]/g, " ").replace(/\s+/g, " ").trim();
  return `!song(${id}|${clean(name) || "未命名"}|${clean(artist) || "未知歌手"})`;
}

/* 卡片结构必须与 assets/js/notes.js、assets/css/player.css 保持一致 */
export function songCard(id, name, artist) {
  name = name || "未命名";
  artist = artist || "未知歌手";
  return '<div class="psong" data-song="' + esc(id) + '" data-name="' + esc(name) + '" data-artist="' + esc(artist) + '">' +
    '<span class="psong__cover" aria-hidden="true">♪</span>' +
    '<span class="psong__meta"><strong>' + esc(name) + "</strong><em>" + esc(artist) + "</em></span>" +
    '<button class="psong__btn" type="button" aria-label="播放 ' + esc(name) + '"></button>' +
  "</div>";
}

/* md2html 之后把标记换成卡片 */
export function expandSongs(html) {
  if (!html || html.indexOf("!song(") === -1) return html;
  /* Vditor 会把单独一行的标记包成 <p>…</p>：整段替换，别把 div 塞进 p 里 */
  html = html.replace(/<p>\s*(!song\([^)\n]*\))\s*<\/p>/g, (m, mark) =>
    mark.replace(SONG, (_, id, name, artist) => songCard(id, name, artist)));
  /* 混在段落文字里的 */
  return html.replace(SONG, (_, id, name, artist) => songCard(id, name, artist));
}

/* 从 md 里抽出用到的曲目 id（后台列表提示用，可选） */
export function songIds(md) {
  const out = [];
  String(md || "").replace(SONG, (_, id) => { if (out.indexOf(id) < 0) out.push(id); return ""; });
  return out;
}
