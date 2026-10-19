/* ============================================================
   Nooj Log — GitHub OAuth 回调（Edge Function）
   路由：GET /api/oauth/callback?code=xxx&state=xxx

   职责：
   1) 校验 state 与 cookie 一致（防 CSRF）
   2) 用 code + client_secret 向 GitHub 换取 access_token
   3) 渲染品牌化过渡页：postMessage 把 token 交给 CMS 弹窗并关闭

   消息协议与 Sveltia/Decap CMS 兼容：
     成功 → "authorization:github:success:<token>"
     失败 → "authorization:github:error:<message>"
   ============================================================ */

function htmlPage(title, detail, script) {
  return "<!DOCTYPE html>\n" +
    "<html lang=\"zh-CN\" data-theme=\"light\">\n" +
    "<head>\n" +
    "<meta charset=\"UTF-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
    "<title>" + title + " — Nooj Log</title>\n" +
    "<meta name=\"robots\" content=\"noindex, nofollow\">\n" +
    "<style>\n" +
    "  :root { --bg:#FAF9F5; --ink:#26251F; --muted:#79766A; --accent:#2F6B4F; --line:#E4E0D2; }\n" +
    "  @media (prefers-color-scheme: dark) { :root { --bg:#171613; --ink:#F0EEE4; --muted:#A8A496; --accent:#45C08D; --line:#37342B; } }\n" +
    "  * { margin:0; padding:0; box-sizing:border-box; }\n" +
    "  body { min-height:100vh; display:flex; align-items:center; justify-content:center;\n" +
    "         background:var(--bg); color:var(--ink);\n" +
    "         font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif; }\n" +
    "  .card { text-align:center; padding:48px 40px; max-width:420px; }\n" +
    "  .mark { width:44px; height:44px; margin:0 auto 20px; border-radius:12px; background:var(--accent);\n" +
    "          display:flex; align-items:center; justify-content:center; }\n" +
    "  .mark svg { width:28px; height:28px; }\n" +
    "  h1 { font-size:1.125rem; font-weight:600; margin-bottom:10px; }\n" +
    "  p { font-size:.8125rem; color:var(--muted); line-height:1.7; }\n" +
    "  .dots { display:flex; gap:6px; justify-content:center; margin-top:22px; }\n" +
    "  .dots i { width:7px; height:7px; border-radius:50%; background:var(--accent); animation:p 1.2s ease-in-out infinite; }\n" +
    "  .dots i:nth-child(2){ animation-delay:.15s; } .dots i:nth-child(3){ animation-delay:.3s; }\n" +
    "  @keyframes p { 0%,100%{opacity:.25;transform:translateY(0)} 50%{opacity:1;transform:translateY(-4px)} }\n" +
    "</style>\n" +
    "</head>\n" +
    "<body>\n" +
    "  <div class=\"card\">\n" +
    "    <div class=\"mark\"><svg viewBox=\"0 0 28 28\"><path d=\"M8 19.5 L14 8.5 L20 19.5\" fill=\"none\" stroke=\"#FAF9F5\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-dasharray=\"2.6 3.4\"/><circle cx=\"8\" cy=\"19.5\" r=\"2.1\" fill=\"#FAF9F5\"/><circle cx=\"14\" cy=\"8.5\" r=\"2.1\" fill=\"#FAF9F5\"/><circle cx=\"20\" cy=\"19.5\" r=\"2.1\" fill=\"#FAF9F5\"/></svg></div>\n" +
    "    <h1>" + title + "</h1>\n" +
    "    <p>" + detail + "</p>\n" +
    "    <div class=\"dots\"><i></i><i></i><i></i></div>\n" +
    "  </div>\n" +
    (script ? "<script>" + script + "</script>\n" : "") +
    "</body>\n" +
    "</html>";
}

export async function onRequestGet(context) {
  var req = context.request;
  var env = context.env;
  var url = new URL(req.url);
  var origin = url.origin;

  var code = url.searchParams.get("code");
  var state = url.searchParams.get("state");
  var errParam = url.searchParams.get("error") || url.searchParams.get("error_description");

  /* 清 state cookie（无论成败） */
  var clearCookie = "nooj-oauth-state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

  /* ---------- GitHub 侧拒绝授权 ---------- */
  if (!code) {
    var errHtml = htmlPage(
      "授权未完成",
      errParam ? String(errParam) : "你取消了 GitHub 授权，或授权链接已过期。请返回后台重新登录。",
      "(function(){try{window.opener&&window.opener.postMessage('authorization:github:error:" +
        String(errParam || "access_denied").replace(/'/g, "") + "','*')}catch(e){};setTimeout(function(){window.close()},1600)})();"
    );
    return new Response(errHtml, {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": clearCookie, "Cache-Control": "no-store" }
    });
  }

  /* ---------- state 校验（防 CSRF） ---------- */
  var cookies = req.headers.get("Cookie") || "";
  var m = /(?:^|;\s*)nooj-oauth-state=([^;]+)/.exec(cookies);
  var saved = m ? decodeURIComponent(m[1]) : "";
  if (!state || !saved || state !== saved) {
    var csrfHtml = htmlPage(
      "安全校验失败",
      "state 校验未通过（可能是登录态过期或跨站请求）。请返回后台重新发起登录。",
      "(function(){try{window.opener&&window.opener.postMessage('authorization:github:error:state_mismatch','*')}catch(e){};setTimeout(function(){window.close()},1600)})();"
    );
    return new Response(csrfHtml, {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": clearCookie, "Cache-Control": "no-store" }
    });
  }

  /* ---------- 换取 access_token ---------- */
  env = env || {};
  var clientId = env.GITHUB_CLIENT_ID;
  var clientSecret = env.GITHUB_CLIENT_SECRET;
  var redirectUri = origin + "/api/oauth/callback";

  var tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": "nooj-log-oauth-proxy"
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
      redirect_uri: redirectUri
    })
  });

  var tokenData = {};
  try { tokenData = await tokenRes.json(); } catch (e) { /* 保持空对象，走下方错误分支 */ }

  if (!tokenRes.ok || !tokenData.access_token) {
    var msg = tokenData.error_description || tokenData.error || ("HTTP " + tokenRes.status);
    var failHtml = htmlPage(
      "授权失败",
      "GitHub 换 token 失败：" + String(msg).replace(/[<>]/g, "") + "。请返回后台重试；持续失败请检查 OAuth App 配置。",
      "(function(){try{window.opener&&window.opener.postMessage('authorization:github:error:token_exchange_failed','*')}catch(e){};setTimeout(function(){window.close()},2000)})();"
    );
    return new Response(failHtml, {
      status: 502,
      headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": clearCookie, "Cache-Control": "no-store" }
    });
  }

  /* ---------- 成功：品牌化过渡页 + postMessage 交给 CMS ---------- */
  var token = String(tokenData.access_token).replace(/[^A-Za-z0-9_.\-]/g, "");
  var okScript =
    "(function(){" +
    "  var msg='authorization:github:success:" + token + "';" +
    "  function done(){setTimeout(function(){window.close()},800)}" +
    "  try{" +
    "    if(window.opener){window.opener.postMessage(msg,'*');done();return}" +
    "  }catch(e){}" +
    "  /* opener 丢失时（部分浏览器拦截弹窗关系）：写入 sessionStorage 供同源 CMS 页拾取 */" +
    "  try{sessionStorage.setItem('nooj-oauth-token',msg);location.replace('/admin/');return}catch(e){}" +
    "  document.querySelector('.dots').innerHTML='';" +
    "  document.querySelector('h1').textContent='授权成功';" +
    "  document.querySelector('p').textContent='此窗口无法自动关闭，请手动关闭并返回后台。';" +
    "})();";

  var okHtml = htmlPage("授权成功", "正在返回 Nooj Log 后台…", okScript);
  return new Response(okHtml, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": clearCookie, "Cache-Control": "no-store" }
  });
}
