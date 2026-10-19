/* ============================================================
   Nooj Log 后台 — 系统设置
   账号与安全 / 图床 / 仓库 / 维护
   ============================================================ */

import { h, icon, toast, confirmDialog } from "../util.js";
import * as api from "../api.js";
import * as auth from "../auth.js";

export async function renderSettings(container, ctx) {
  container.innerHTML = "";
  const wrap = h("div", { class: "settings" });
  container.append(wrap);

  ctx.setTopbar("系统设置", [
    h("a", { class: "btn btn--ghost", href: "/", target: "_blank", rel: "noopener" }, "查看站点 ↗")
  ]);

  let status = null;
  try { status = await api.authStatus(); } catch (e) { status = {}; }

  const accountCard = h("section", { class: "card" });
  const storageCard = h("section", { class: "card" });
  const repoCard = h("section", { class: "card" });
  const maintCard = h("section", { class: "card" });

  wrap.append(
    h("p", { class: "settings__lead" }, "后台的全部配置都在这里。改密码、接图床、换仓库，都不需要重新部署代码。"),
    accountCard, storageCard, repoCard, maintCard
  );

  /* ============================================================
     账号与安全
     ============================================================ */
  function paintAccount() {
    const mode = auth.getMode();
    accountCard.innerHTML = "";

    const rows = h("div", { class: "kv" },
      kv("当前登录方式", mode === "password" ? "密码（不使用 GitHub）" : "GitHub OAuth"),
      kv("管理员账号", status.username || "admin"),
      kv("密码状态", status.passwordReady ? "已设置" : "未设置"),
      kv("服务端仓库令牌", status.repoTokenReady ? "已配置" : "未配置（密码登录需要）"));

    accountCard.append(
      h("header", { class: "card__head" },
        h("h3", { class: "card__title" }, "账号与安全"),
        h("p", { class: "card__sub" }, "密码登录不经过 GitHub：服务端用仓库令牌读写内容，浏览器只持有 HttpOnly 会话。")),
      rows
    );

    /* 首次设置密码 */
    if (!status.passwordReady) {
      if (mode !== "github") {
        accountCard.append(h("p", { class: "hint" }, "请先用 GitHub 登录一次，才能创建管理员密码。"));
        return;
      }
      const pw = h("input", { class: "input", type: "password", placeholder: "新密码，至少 8 位", autocomplete: "new-password" });
      const pw2 = h("input", { class: "input", type: "password", placeholder: "再输入一次", autocomplete: "new-password" });
      const pat = h("input", { class: "input input--mono", type: "password", placeholder: "github_pat_…（可选，已配环境变量则留空）" });
      const btn = h("button", { class: "btn btn--primary", onclick: doSetup }, icon("lock", 15), h("span", {}, "创建密码"));

      async function doSetup() {
        if (pw.value.length < 8) return toast("密码至少 8 位", "error");
        if (pw.value !== pw2.value) return toast("两次输入的密码不一致", "error");
        btn.disabled = true;
        try {
          await api.authSetup(pw.value, pat.value.trim());
          toast("管理员密码已创建", "ok");
          status = await api.authStatus();
          paintAccount();
        } catch (e) {
          toast(e.message || "创建失败", "error", 6000);
        } finally {
          btn.disabled = false;
        }
      }

      accountCard.append(
        h("div", { class: "card__block" },
          h("h4", { class: "card__h4" }, "启用密码登录"),
          h("p", { class: "hint" }, "首次创建需要提供一个有 repo 写权限的 GitHub Token，服务端会加密保存（公开仓库也读不到明文）。之后就能完全脱离 GitHub 登录。"),
          h("div", { class: "formgrid" }, pw, pw2, pat),
          h("div", { class: "card__actions" }, btn))
      );
      return;
    }

    /* 修改密码 */
    const cur = h("input", { class: "input", type: "password", placeholder: "当前密码", autocomplete: "current-password" });
    const next = h("input", { class: "input", type: "password", placeholder: "新密码，至少 8 位", autocomplete: "new-password" });
    const next2 = h("input", { class: "input", type: "password", placeholder: "再输入一次", autocomplete: "new-password" });
    const chBtn = h("button", { class: "btn btn--primary", onclick: doChange }, h("span", {}, "修改密码"));

    if (mode !== "password") cur.style.display = "none";

    async function doChange() {
      if (next.value.length < 8) return toast("新密码至少 8 位", "error");
      if (next.value !== next2.value) return toast("两次输入的新密码不一致", "error");
      chBtn.disabled = true;
      try {
        await api.authChangePassword(mode === "password" ? cur.value : "", next.value);
        toast("密码已更新", "ok");
        cur.value = next.value = next2.value = "";
      } catch (e) {
        toast(e.message || "修改失败", "error", 6000);
      } finally {
        chBtn.disabled = false;
      }
    }

    const pat = h("input", { class: "input input--mono", type: "password", placeholder: "github_pat_…" });
    const patBtn = h("button", { class: "btn btn--ghost", onclick: async () => {
      if (!pat.value.trim()) return toast("请填入 Token", "error");
      patBtn.disabled = true;
      try {
        await api.authSavePat(pat.value.trim());
        pat.value = "";
        status = await api.authStatus();
        toast("仓库令牌已更新", "ok");
        paintAccount();
      } catch (e) {
        toast(e.message || "更新失败", "error", 6000);
      } finally {
        patBtn.disabled = false;
      }
    } }, "更新令牌");

    accountCard.append(
      h("div", { class: "card__block" },
        h("h4", { class: "card__h4" }, "修改密码"),
        h("p", { class: "hint" }, mode === "password"
          ? "需要验证当前密码。修改后当前会话继续有效。"
          : "当前是 GitHub 登录，修改密码无需验证旧密码。"),
        h("div", { class: "formgrid" }, cur, next, next2),
        h("div", { class: "card__actions" }, chBtn)),
      h("div", { class: "card__block" },
        h("h4", { class: "card__h4" }, "服务端仓库令牌"),
        h("p", { class: "hint" }, "密码登录时代替浏览器直接访问 GitHub。建议使用 Fine-grained Token，只授权本仓库的 Contents 读写。轮换后立即生效。"),
        h("div", { class: "formgrid formgrid--2" }, pat),
        h("div", { class: "card__actions" }, patBtn))
    );
  }

  /* ============================================================
     图床
     ============================================================ */
  async function paintStorage() {
    storageCard.innerHTML = "";
    storageCard.append(h("div", { class: "card__loading" }, "正在读取图床配置…"));

    let cfg = { configured: false };
    try { cfg = await api.storageGet(); } catch (e) { cfg = { configured: false, error: e.message }; }

    storageCard.innerHTML = "";
    storageCard.append(
      h("header", { class: "card__head" },
        h("h3", { class: "card__title" }, "图床与对象存储"),
        h("p", { class: "card__sub" }, "支持 Cloudflare R2、Backblaze B2、阿里云 OSS、七牛、MinIO 等所有 S3 兼容存储。启用后，写作页与媒体库的图片会直传对象存储。")),
      h("div", { class: "kv" },
        kv("当前状态", cfg.configured && cfg.enabled ? `已启用 · ${cfg.provider || "S3"}` : "未启用（使用仓库 media/uploads）"),
        kv("配置来源", cfg.source === "env" ? "服务端环境变量" : cfg.configured ? "admin/storage.json" : "—"))
    );

    const preset = h("select", { class: "select select--block", onchange: () => applyPreset() },
      h("option", { value: "r2", selected: (cfg.provider || "r2") === "r2" }, "Cloudflare R2（推荐，10GB 免费）"),
      h("option", { value: "b2", selected: cfg.provider === "b2" }, "Backblaze B2"),
      h("option", { value: "oss", selected: cfg.provider === "oss" }, "阿里云 OSS（S3 兼容）"),
      h("option", { value: "minio", selected: cfg.provider === "minio" }, "MinIO / 自建"),
      h("option", { value: "s3", selected: cfg.provider === "s3" }, "AWS S3 / 其他"));

    const endpoint = h("input", { class: "input input--mono", value: cfg.endpoint || "", placeholder: "https://<ACCOUNT_ID>.r2.cloudflarestorage.com" });
    const region = h("input", { class: "input input--mono", value: cfg.region || "auto", placeholder: "auto" });
    const bucket = h("input", { class: "input input--mono", value: cfg.bucket || "", placeholder: "nooj-media" });
    const ak = h("input", { class: "input input--mono", value: cfg.accessKeyId || "", placeholder: "Access Key ID" });
    const sk = h("input", { class: "input input--mono", type: "password", placeholder: cfg.secretSet ? "已保存，留空则不修改" : "Secret Access Key" });
    const pub = h("input", { class: "input input--mono", value: cfg.publicBase || "", placeholder: "https://img.example.com（公开访问域名）" });
    const prefix = h("input", { class: "input input--mono", value: cfg.prefix || "", placeholder: "blog/（可选）" });
    const pathStyle = h("input", { type: "checkbox", checked: cfg.forcePathStyle !== false });
    const enabled = h("input", { type: "checkbox", checked: !!cfg.enabled });

    const probe = h("p", { class: "hint" });

    function applyPreset() {
      const p = preset.value;
      if (p === "r2") {
        if (!endpoint.value || /backblaze|minio|amazonaws|aliyuncs/.test(endpoint.value)) endpoint.value = "https://<ACCOUNT_ID>.r2.cloudflarestorage.com";
        region.value = region.value && region.value !== "auto" && p !== "r2" ? region.value : "auto";
      } else if (p === "b2") {
        endpoint.value = "https://s3.us-west-004.backblazeb2.com";
        region.value = "us-west-004";
      } else if (p === "oss") {
        endpoint.value = "https://s3.oss-cn-hangzhou.aliyuncs.com";
        region.value = "oss-cn-hangzhou";
      } else if (p === "minio") {
        endpoint.value = "http://127.0.0.1:9000";
        region.value = "us-east-1";
      } else {
        endpoint.value = "https://s3.amazonaws.com";
        region.value = "us-east-1";
      }
    }

    const saveBtn = h("button", { class: "btn btn--primary", onclick: doSave }, icon("save", 15), h("span", {}, "保存配置"));
    const testBtn = h("button", { class: "btn btn--ghost", onclick: doTest }, "测试连接");

    function current() {
      return {
        enabled: enabled.checked,
        provider: preset.value,
        endpoint: endpoint.value.trim(),
        region: region.value.trim() || "auto",
        bucket: bucket.value.trim(),
        accessKeyId: ak.value.trim(),
        publicBase: pub.value.trim(),
        prefix: prefix.value.trim(),
        forcePathStyle: pathStyle.checked
      };
    }

    async function doSave() {
      saveBtn.disabled = true;
      saveBtn.querySelector("span").textContent = "保存中…";
      try {
        const r = await api.storageSave(current(), sk.value.trim());
        api.invalidateMediaTarget();
        if (r.probe === "failed") {
          toast(`配置已保存，但连接失败（${r.probeStatus}）：${r.probeMessage}`, "error", 8000);
        } else {
          toast("图床配置已保存，连接正常", "ok", 3000);
        }
        await paintStorage();
      } catch (e) {
        toast(e.message || "保存失败", "error", 7000);
      } finally {
        saveBtn.disabled = false;
        saveBtn.querySelector("span").textContent = "保存配置";
      }
    }

    async function doTest() {
      testBtn.disabled = true;
      probe.textContent = "正在连接…";
      try {
        const r = await api.storageTest();
        probe.textContent = r.ok ? "连接正常，桶可写可读。" : `连接失败（${r.status}）：${r.message}`;
        probe.className = r.ok ? "hint hint--ok" : "hint hint--err";
      } catch (e) {
        probe.textContent = e.message || "测试失败";
        probe.className = "hint hint--err";
      } finally {
        testBtn.disabled = false;
      }
    }

    storageCard.append(
      h("div", { class: "card__block" },
        h("div", { class: "formgrid formgrid--2" },
          field("服务商", preset),
          field("Bucket", bucket),
          field("Endpoint", endpoint),
          field("Region", region),
          field("Access Key ID", ak),
          field("Secret Access Key", sk),
          field("公开访问域名", pub),
          field("路径前缀", prefix)),
        h("div", { class: "formrow" },
          h("label", { class: "switch" }, pathStyle, h("span", {}, "Path-style 访问（R2 / MinIO 需要）")),
          h("label", { class: "switch" }, enabled, h("span", {}, "启用图床（上传走对象存储）"))),
        probe,
        h("div", { class: "card__actions" }, testBtn, saveBtn)),

      h("details", { class: "card__details" },
        h("summary", {}, "Cloudflare R2 怎么配（5 步）"),
        h("ol", { class: "steps" },
          h("li", {}, "R2 控制台创建一个桶，例如 nooj-media。"),
          h("li", {}, "桶的 Settings → Public access：开启 r2.dev 子域，或绑定自定义域名。把该地址填到「公开访问域名」。"),
          h("li", {}, "桶的 Settings → CORS：Allow origins 填本站域名，Allow methods 勾选 PUT、GET、HEAD，Allow headers 填 *。"),
          h("li", {}, "R2 → Manage API Tokens → 创建令牌，权限选 Object Read & Write，记下 Access Key ID 与 Secret。"),
          h("li", {}, "Endpoint 填 https://<账户ID>.r2.cloudflarestorage.com，Region 填 auto，保存后点「测试连接」。"))
      ),

      h("details", { class: "card__details" },
        h("summary", {}, "密钥存在哪里？"),
        h("p", { class: "hint" }, "Secret 用 AES-GCM 加密后写入仓库的 admin/storage.json，加密密钥来自服务端环境变量（SESSION_SECRET 或 GitHub OAuth 的 client secret），仓库里只有密文。也可以改用环境变量 S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY 完全放在服务端。"))
    );

    if (cfg.source === "env") {
      endpoint.disabled = region.disabled = bucket.disabled = ak.disabled = sk.disabled = saveBtn.disabled = true;
      probe.textContent = "当前由服务端环境变量接管，页面上的修改不会生效。";
    }
  }

  /* ============================================================
     仓库与维护
     ============================================================ */
  function paintRepo() {
    const conf = api.repoConf();
    const owner = h("input", { class: "input input--mono", value: conf.owner });
    const repo = h("input", { class: "input input--mono", value: conf.repo });
    const branch = h("input", { class: "input input--mono", value: conf.branch });

    repoCard.innerHTML = "";
    repoCard.append(
      h("header", { class: "card__head" },
        h("h3", { class: "card__title" }, "仓库与部署"),
        h("p", { class: "card__sub" }, "内容写入 GitHub 仓库，EdgeOne 检测到提交后自动构建。这里的设置只影响当前浏览器。")),
      h("div", { class: "formgrid formgrid--3" },
        field("Owner", owner), field("Repository", repo), field("Branch", branch)),
      h("div", { class: "card__actions" },
        h("button", { class: "btn btn--primary", onclick: () => {
          api.setRepoConf({ owner: owner.value.trim(), repo: repo.value.trim(), branch: branch.value.trim() });
          toast("已保存到本机", "ok");
        } }, "保存")),
      h("div", { class: "kv kv--tight" },
        kv("站点地址", "https://i.ymao.me"),
        kv("内容目录", "content/posts · content/projects.json"),
        kv("构建命令", "node scripts/gen-data.mjs"))
    );

    /* 服务端实际使用的仓库（环境变量可覆盖） */
    repoCard.append(h("p", { class: "hint" }, "服务端（Edge Function）默认同样指向该仓库；如通过环境变量 GITHUB_REPO_OWNER / GITHUB_REPO_NAME / GITHUB_BRANCH 覆盖，以环境变量为准。"));
  }

  function paintMaint() {
    const mode = auth.getMode();
    maintCard.innerHTML = "";
    maintCard.append(
      h("header", { class: "card__head" },
        h("h3", { class: "card__title" }, "维护"),
        h("p", { class: "card__sub" }, "一些一次性操作。")),
      h("div", { class: "card__actions card__actions--wrap" },
        h("button", { class: "btn btn--ghost", onclick: () => {
          localStorage.removeItem("nooj_repo");
          toast("已清除仓库缓存", "ok");
          paintRepo();
        } }, "清除本机仓库设置"),
        h("button", { class: "btn btn--ghost", onclick: () => {
          sessionStorage.clear();
          toast("本地缓存已清理", "ok");
        } }, "清理本地缓存"),
        h("button", { class: "btn btn--danger", onclick: async () => {
          if (!(await confirmDialog({ title: "退出登录？", body: "需要重新输入密码或授权 GitHub。", confirmText: "退出", danger: true }))) return;
          await auth.logout();
          location.hash = "";
          location.reload();
        } }, "退出登录")),
      h("div", { class: "kv kv--tight" },
        kv("当前会话", mode === "password" ? "密码登录（HttpOnly Cookie，7 天）" : "GitHub Token（localStorage）"),
        kv("后台版本", "Phase 2 · 项目 / 媒体 / 设置"))
    );
  }

  paintAccount();
  paintRepo();
  paintMaint();
  await paintStorage();
}

/* ---------- 小工具 ---------- */
function kv(k, v) {
  return h("div", { class: "kv__row" }, h("span", { class: "kv__k" }, k), h("span", { class: "kv__v" }, v));
}

function field(label, control) {
  return h("div", { class: "formfield" },
    h("label", { class: "formfield__label" }, label),
    control);
}
