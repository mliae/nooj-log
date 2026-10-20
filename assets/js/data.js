/* ============================================================
   Nooj Log — 本地预览回退数据（由 scripts/gen-data.mjs 生成，请勿手改）
   线上以 content/*.json 为唯一事实源；仅当浏览器以 file:// 协议
   直接打开页面、fetch 不可用时，content.js 才会回退到本文件。
   ============================================================ */

window.NOOJ_DATA = {
  posts: [
  {
    "id": "test-post",
    "title": "测试文章标题",
    "cat": "dev",
    "date": "2026-10-19",
    "read": 5,
    "tags": [
      "测试"
    ],
    "excerpt": "测试文章  测试文章标题"
  },
  {
    "id": "docker-timezone-ghost-bug",
    "title": "记一次由 Docker 时区引发的「幽灵 Bug」",
    "cat": "dev",
    "date": "2026-10-12",
    "read": 8,
    "tags": [
      "Docker",
      "踩坑",
      "Node.js"
    ],
    "excerpt": "定时任务在本地跑得好好的，一进容器就迟到八小时。排查到最后，发现问题不在代码，而在 /etc/localtime。"
  },
  {
    "id": "nooj-log-static-blog",
    "title": "从零搭建 Nooj Log：一个极简静态博客的诞生",
    "cat": "project",
    "date": "2026-10-05",
    "read": 10,
    "tags": [
      "博客",
      "静态站点",
      "工程实践"
    ],
    "excerpt": "为什么最终没有选任何框架——以及这个用 HTML + CSS + 一点点 JS 手写出来的博客，是如何兼顾清爽与体感的。"
  },
  {
    "id": "css-container-queries",
    "title": "CSS 容器查询实战：让卡片布局真正「响应式」",
    "cat": "dev",
    "date": "2026-09-26",
    "read": 9,
    "tags": [
      "CSS",
      "前端",
      "布局"
    ],
    "excerpt": "媒体查询关心的是视口，而组件关心的是自己的容器。一次文章卡片的布局改造，记录 container query 的正确用法。"
  },
  {
    "id": "cli-todo",
    "title": "cli-todo：300 行代码的终端待办工具",
    "cat": "project",
    "date": "2026-09-18",
    "read": 7,
    "tags": [
      "Node.js",
      "CLI",
      "小工具"
    ],
    "excerpt": "受够了图形待办软件的启动速度，用 Node.js 写了一个住在终端里的待办工具。"
  },
  {
    "id": "weekend-cycling",
    "title": "周末骑行 40 公里，和一杯好喝的手冲",
    "cat": "life",
    "date": "2026-09-13",
    "read": 5,
    "tags": [
      "生活",
      "骑行",
      "咖啡"
    ],
    "excerpt": "早起、沿江、逆风、回程顺风；以及回家后那杯参数刚刚好的手冲。"
  },
  {
    "id": "dark-mode-night",
    "title": "给博客加上深色模式的那个晚上",
    "cat": "dev",
    "date": "2026-08-30",
    "read": 6,
    "tags": [
      "CSS",
      "主题",
      "细节"
    ],
    "excerpt": "从 prefers-color-scheme 到手动切换，从 CSS 变量重构到消灭首屏闪白——一次完整的主题切换实践。"
  },
  {
    "id": "first-meal-after-moving",
    "title": "搬家后的第一顿饭",
    "cat": "life",
    "date": "2026-08-16",
    "read": 1,
    "tags": [
      "生活",
      "厨房",
      "记录"
    ],
    "excerpt": "新厨房的第一餐是一碗番茄鸡蛋面。窗外有夕阳，锅里有热气，这就够了。"
  }
],
  projects: [
  {
    "id": "nooj-log",
    "name": "Nooj Log",
    "tagline": "你正在看的这个博客",
    "desc": "零依赖、零构建的纯静态个人博客。HTML + CSS + 一点点 JS 手写而成，支持暗色模式、阅读进度、目录导航与 RSS 订阅，整站没有一个追踪器。",
    "tech": [
      "HTML",
      "CSS",
      "JavaScript"
    ],
    "featured": true
  },
  {
    "id": "cli-todo",
    "name": "cli-todo",
    "tagline": "住在终端里的待办工具",
    "desc": "300 行 Node.js 代码、零运行时依赖的命令行待办。支持标签、今日视图、管道友好的纯文本输出，一条 add 命令即可记录念头，不让思路断掉。",
    "tech": [
      "Node.js",
      "CLI",
      "npm"
    ],
    "featured": false
  },
  {
    "id": "pomofox",
    "name": "Pomofox",
    "tagline": "一只狐狸头像的番茄钟",
    "desc": "浏览器扩展形态的番茄钟，25/5 循环，标签页徽标实时显示剩余分钟。支持白噪音与每日专注统计，全部数据留在本地。",
    "tech": [
      "Chrome Extension",
      "WebExtensions",
      "SVG"
    ],
    "featured": false
  }
],
  notes: [
  {
    "id": "20261020-2210",
    "date": "2026-10-20 22:10",
    "text": "把后台的批量删除改成一次 commit 之后，删 8 篇文章从 8 秒变成 1 秒。\n慢的从来不是网络，是我自己多写的那一层。",
    "tags": [
      "折腾"
    ]
  },
  {
    "id": "20261019-2350",
    "date": "2026-10-19 23:50",
    "text": "深夜和一个时区 bug 缠了两个小时，最后发现是容器里没设 TZ。\n又一次验证：所有「玄学」问题，都是配置问题。",
    "tags": [
      "踩坑"
    ]
  },
  {
    "id": "20261017-0740",
    "date": "2026-10-17 07:40",
    "text": "早上六点半的河堤没有人，只有洒水车。骑到桥上停下来看了五分钟，回来写一天代码都不困。",
    "tags": [
      "骑行"
    ]
  },
  {
    "id": "20261012-2030",
    "date": "2026-10-12 20:30",
    "text": "搬家后的厨房终于有了烟火气。第一顿饭煮糊了，但很好吃。",
    "tags": [
      "生活"
    ]
  },
  {
    "id": "20261010-1130",
    "date": "2026-10-10 11:30",
    "text": "发现一件事：每天写一句，比每周写一千字容易坚持得多。\n所以有了这个页面。",
    "tags": [
      "写博客"
    ]
  },
  {
    "id": "20261008-1030",
    "date": "2026-10-08 10:30",
    "text": "这里放一些不成篇的碎念——一句话、一张图、一个念头。\n不追求完整，只求留下痕迹。",
    "tags": [
      "关于这里"
    ],
    "pinned": true
  }
]
};
