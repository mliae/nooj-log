/* ============================================================
   Nooj Log — GitHub OAuth 授权入口（Edge Function）
   路由：GET /api/oauth/auth

   Sveltia CMS 的 GitHub 后端不支持浏览器端 PKCE，必须由服务端
   完成 OAuth 换 token。本函数（连同 callback/success）即
   「零服务器」的 OAuth 代理，client secret 只存在于函数环境变量。

   流程：CMS 弹出本地址 → 校验来源域名 → 生成 state 存 cookie
        → 302 跳转 GitHub 授权页
   ============================================================ */

/* ---------- 工具 ---------- */
function b64urlEncode(buf) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomState() {
  var bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return b64urlEncode(bytes);
}

function allowedDomains(env) {
  var raw = (env && env.ALLOWED_DOMAINS || "").trim();
  if (!raw) return null; /* 未配置则放行（首次部署友好） */
  return raw.split(",").map(function (d) { return d.trim().toLowerCase(); }).filter(Boolean);
}

function hostAllowed(host, list) {
  if (!list) return true;
  host = host.toLowerCase();
  return list.some(function (rule) {
    if (rule.indexOf("*.") === 0) {
      var suffix = rule.slice(1); /* ".example.com" */
      return host !== suffix.slice(1) && host.endsWith(suffix);
    }
    return host === rule;
  });
}

/* ---------- Handler ---------- */
export function onRequestGet(context) {
  var req = context.request;
  var env = context.env;
  var url = new URL(req.url);
  var origin = url.origin;

  /* 1) 来源域名白名单（防本代理被他人站点滥用） */
  var referer = req.headers.get("Referer") || req.headers.get("Origin") || "";
  var refHost = referer ? new URL(referer).host : "";
  if (refHost && !hostAllowed(refHost, allowedDomains(env))) {
    return new Response("Forbidden: site domain not allowed", { status: 403 });
  }

  /* 2) 凭据检查（缺配置时给出可读错误，而非裸 500） */
  var clientId = env && env.GITHUB_CLIENT_ID;
  if (!clientId || !env.GITHUB_CLIENT_SECRET) {
    return new Response(
      "OAuth proxy not configured: set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET " +
      "as environment variables of this Pages project (edgeone pages env add …).",
      { status: 500 }
    );
  }

  /* 3) state = origin + nonce，存 HttpOnly cookie（10 分钟有效，防 CSRF） */
  var state = randomState();
  var payload = b64urlEncode(
    new TextEncoder().encode(JSON.stringify({ origin: origin, nonce: state }))
  );
  var cookie =
    "nooj-oauth-state=" + encodeURIComponent(payload) +
    "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600";

  /* 4) 跳转 GitHub 授权页
       scope 说明：公开仓库用 public_repo 即可；私有仓库必须用 repo。
       与 GitHub OAuth App 注册的 Authorization callback URL 保持一致。 */
  var redirectUri = origin + "/api/oauth/callback";
  var scope = (env.OAUTH_SCOPE || "repo").trim();
  var authorize =
    "https://github.com/login/oauth/authorize" +
    "?client_id=" + encodeURIComponent(clientId) +
    "&redirect_uri=" + encodeURIComponent(redirectUri) +
    "&scope=" + encodeURIComponent(scope) +
    "&state=" + encodeURIComponent(payload);

  return new Response(null, {
    status: 302,
    headers: {
      "Location": authorize,
      "Set-Cookie": cookie,
      "Cache-Control": "no-store"
    }
  });
}
