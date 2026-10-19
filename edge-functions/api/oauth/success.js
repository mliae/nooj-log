/* ============================================================
   Nooj Log — OAuth 成功过渡页（Edge Function）
   路由：GET /api/oauth/success?token=xxx

   说明：本项目的 callback 已直接渲染过渡页完成 postMessage，
   本路由是兼容兜底——某些第三方 OAuth 客户端会显式跳转
   /success?token=xxx，此时由本页完成同样的交付动作。
   ============================================================ */

export function onRequestGet(context) {
  var url = new URL(context.request.url);
  var token = (url.searchParams.get("token") || "").replace(/[^A-Za-z0-9_.\-]/g, "");

  if (!token) {
    return new Response("Missing token parameter", { status: 400 });
  }

  var script =
    "(function(){" +
    "  var payload='" + JSON.stringify({ token: token, provider: "github" }) + "';" +
    "  var msg='authorization:github:success:'+payload;" +
    "  try{" +
    "    if(window.opener){window.opener.postMessage(msg,'*');setTimeout(function(){window.close()},800);return}" +
    "  }catch(e){}" +
    "  try{sessionStorage.setItem('nooj-oauth-token',msg);location.replace('/admin/');return}catch(e){}" +
    "  document.querySelector('h1').textContent='授权成功';" +
    "  document.querySelector('p').textContent='请手动关闭本窗口，返回后台继续。';" +
    "})();";

  var html = "<!DOCTYPE html>\n" +
    "<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
    "<meta name=\"robots\" content=\"noindex, nofollow\">\n" +
    "<title>授权成功 — Nooj Log</title>\n" +
    "<style>\n" +
    "  body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FAF9F5;color:#26251F;" +
    "font-family:'PingFang SC','Microsoft YaHei',sans-serif;text-align:center}\n" +
    "  .mark{width:44px;height:44px;margin:0 auto 20px;border-radius:12px;background:#2F6B4F}\n" +
    "  p{font-size:.8125rem;color:#79766A;margin-top:10px}\n" +
    "</style>\n</head>\n<body>\n" +
    "  <div><div class=\"mark\"></div><h1>授权成功</h1><p>正在返回 Nooj Log 后台…</p></div>\n" +
    "  <script>" + script + "</script>\n" +
    "</body>\n</html>";

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}
