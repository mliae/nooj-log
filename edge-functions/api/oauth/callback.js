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

/* ============================================================
   服务端会话 / 仓库令牌（算法必须与 api/auth.js 完全一致）
   ------------------------------------------------------------
   为什么在这里做：
     OAuth 刚换到 token，这一刻服务端是可信的，直接签发 HttpOnly
     会话，后续 /api/auth、/api/storage 就不必每次出站请求
     api.github.com 校验身份——EdgeOne 国内边缘到 GitHub 抖动频繁，
     那种校验会表现成「刚授权就说过期」。
   ============================================================ */
function encStr(s) { return new TextEncoder().encode(s); }

function b64urlOf(buf) {
  var a = new Uint8Array(buf);
  var bin = "";
  for (var i = 0; i < a.length; i += 0x8000) bin += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function keyMaterial(env) {
  return (env && (env.SESSION_SECRET || env.GITHUB_CLIENT_SECRET || env.GITHUB_TOKEN)) || "";
}

/* 与 auth.js signSession 一致：body = b64url(JSON)，签名对象是 body 字符串 */
async function mintSession(env, payload) {
  var m = keyMaterial(env);
  if (!m) return "";
  var key = await crypto.subtle.importKey("raw", encStr(m), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  var body = b64urlOf(encStr(JSON.stringify(payload)));
  var sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encStr(body)));
  return body + "." + b64urlOf(sig);
}

async function sealPat(env, token) {
  var m = keyMaterial(env);
  if (!m) return null;
  var base = await crypto.subtle.importKey("raw", encStr(m), "PBKDF2", false, ["deriveKey"]);
  var key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encStr("nooj|pat|v1"), iterations: 60000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
  );
  var iv = crypto.getRandomValues(new Uint8Array(12));
  var data = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, encStr(JSON.stringify({ token: token })));
  return { v: 1, iv: b64urlOf(iv), data: b64urlOf(data) };
}

/* 顺手把服务端仓库令牌配好（已存在则跳过）：密码登录、图床保存都靠它 */
async function ensureServerToken(env, token) {
  var owner = (env && env.GITHUB_REPO_OWNER) || "mliae";
  var name = (env && env.GITHUB_REPO_NAME) || "nooj-log";
  var branch = (env && env.GITHUB_BRANCH) || "main";
  var hdrs = {
    "Accept": "application/vnd.github+json",
    "Authorization": "Bearer " + token,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "nooj-log-oauth-proxy"
  };
  try {
    var cur = await fetch("https://api.github.com/repos/" + owner + "/" + name + "/contents/admin/.pat.json?ref=" + branch,
      { headers: hdrs, cache: "no-store" });
    if (cur.ok) return "exists";
    if (cur.status !== 404) return "skip:" + cur.status;
    var box = await sealPat(env, token);
    if (!box) return "skip:no_secret";
    var content = btoa(unescape(encodeURIComponent(JSON.stringify(box, null, 2) + "\n")));
    var put = await fetch("https://api.github.com/repos/" + owner + "/" + name + "/contents/admin/.pat.json", {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, hdrs),
      body: JSON.stringify({ message: "admin: 登录时自动配置服务端仓库令牌", branch: branch, content: content })
    });
    return put.ok ? "written" : "failed:" + put.status;
  } catch (e) {
    return "error";
  }
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
  /* Sveltia/Decap 期望的消息体是 JSON：authorization:github:success:{"token":...,"provider":...} */
  var okPayload = JSON.stringify({ token: token, provider: "github" });
  var okScript =
    "(function(){" +
    "  var msg='authorization:github:success:" + okPayload + "';" +
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

  /* 固化服务端登录态：之后台内调用不再需要出站校验 GitHub */
  var maxAge = 7 * 24 * 3600;
  var sid = "";
  try {
    sid = await mintSession(env, { u: "github", m: "github", exp: Date.now() + maxAge * 1000 });
  } catch (e) { sid = ""; }

  /* 顺手把服务端仓库令牌存好（已存在则跳过），密码登录与图床保存要用 */
  var patState = await ensureServerToken(env, token);

  var headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Nooj-Token": String(patState || "")
  });
  headers.append("Set-Cookie", clearCookie);
  if (sid) {
    headers.append("Set-Cookie",
      "nooj_sid=" + encodeURIComponent(sid) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge);
  }
  return new Response(okHtml, { status: 200, headers: headers });
}
