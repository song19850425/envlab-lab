#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""给站内每个页面底部加上作者邮箱（幂等）。

两种插入形态：
  A. 页面已有 </footer>  → 把邮箱行插进页脚内部（视觉上属于页脚）
  B. 页面没有 </footer>  → 在 </body> 前补一个自足页脚块（纯内联样式，不依赖页面 CSS）

防爬虫：邮箱不出现明文，由 JS 用 data-u / data-d 拼成 mailto；
<noscript> 里给一个「用户名 [at] 域名」的人读兜底。

跳过（整屏应用，加页脚会被裁掉或破坏画面）：
  · EnvLab-交互实验集/04-案例/黑灯采样-自动化无人采样仿真演示.html   （html,body{height:100%;overflow:hidden}）
  · 推广素材/竖版60秒-自动演示页.html                              （竖版演示页，且按约定不计入站点页面）

用法：python _gen_footer_mail.py [--dry]
"""
import io
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
# 脚本可能放在仓库同级目录，也可能放在仓库的 _tools/ 下 —— 两种位置都支持
ROOT = _HERE if os.path.isdir(os.path.join(_HERE, "EnvLab-交互实验集")) else os.path.dirname(_HERE)

# 邮箱从环境变量读取 —— 脚本会进公开仓库，不能把地址明文写在里面。
# 用法：ENVLAB_MAIL_USER=xxx ENVLAB_MAIL_DOMAIN=yyy python <本脚本>
MAIL_USER = os.environ.get("ENVLAB_MAIL_USER", "")
MAIL_DOMAIN = os.environ.get("ENVLAB_MAIL_DOMAIN", "")
if not MAIL_USER or not MAIL_DOMAIN:
    raise SystemExit(
        "缺少邮箱配置。请先设置环境变量：\n"
        "  ENVLAB_MAIL_USER   邮箱 @ 前面部分\n"
        "  ENVLAB_MAIL_DOMAIN 邮箱域名部分\n"
        "（例如 ENVLAB_MAIL_USER=someone ENVLAB_MAIL_DOMAIN=example.com）"
    )

SKIP = {
    "EnvLab-交互实验集/04-案例/黑灯采样-自动化无人采样仿真演示.html",
    "推广素材/竖版60秒-自动演示页.html",
}

# 已插入过的标记：幂等依据
MARK = 'class="elmail"'

LINE = ('<div style="margin-top:10px;font-size:12px;line-height:1.9">'
        '&#128231; 联系作者：<a class="elmail" href="#" data-u="%s" data-d="%s" '
        'style="color:inherit;text-decoration:underline">载入中…</a>'
        '<noscript><span>%s [at] %s</span></noscript></div>') % (MAIL_USER, MAIL_DOMAIN, MAIL_USER, MAIL_DOMAIN)

BLOCK = ('<footer style="text-align:center;padding:34px 20px;font-size:12px;line-height:1.9;'
         'opacity:.72;border-top:1px solid rgba(128,128,128,.25);margin-top:40px">'
         'EnvLab · 环境监测与污染控制交互实验<br>' + LINE + '</footer>')

SCRIPT = ('<script>(function(){var a=document.querySelectorAll("a.elmail");'
          'for(var i=0;i<a.length;i++){var u=a[i].getAttribute("data-u"),d=a[i].getAttribute("data-d");'
          'if(!u||!d)continue;var e=u+"@"+d;a[i].href="mailto:"+e;a[i].textContent=e;}})();</script>')


def walk_html():
    out = []
    for dp, dn, fn in os.walk(ROOT):
        parts = dp.replace("\\", "/").split("/")
        if ".git" in parts or "node_modules" in parts:
            continue
        for f in fn:
            if f.endswith(".html"):
                out.append(os.path.join(dp, f))
    return sorted(out)


def main():
    dry = "--dry" in sys.argv
    stats = {"A": 0, "B": 0, "skip": 0, "done": 0, "nodody": 0}
    touched = []
    for p in walk_html():
        rel = os.path.relpath(p, ROOT).replace("\\", "/")
        if rel in SKIP:
            stats["skip"] += 1
            continue
        s = io.open(p, encoding="utf-8", newline="").read()
        if MARK in s:
            stats["done"] += 1
            continue
        if "</body>" not in s:
            stats["nodody"] += 1
            print("  ⚠ 无 </body>，跳过：%s" % rel)
            continue
        nl = "\r\n" if "\r\n" in s else "\n"

        if "</footer>" in s:
            # A：插进最后一个页脚内部
            i = s.rfind("</footer>")
            indent = "  "
            s = s[:i] + indent + LINE.replace("\n", nl) + nl + s[i:]
            stats["A"] += 1
        else:
            # B：在 </body> 前补一个自足页脚
            i = s.rfind("</body>")
            s = s[:i] + BLOCK.replace("\n", nl) + nl + s[i:]
            stats["B"] += 1

        # 邮箱脚本统一挂在 </body> 前（只挂一次）
        j = s.rfind("</body>")
        s = s[:j] + SCRIPT.replace("\n", nl) + nl + s[j:]

        if not dry:
            io.open(p, "w", encoding="utf-8", newline="").write(s)
        touched.append(rel)

    print("\n形态 A（插进已有页脚）：%d 个" % stats["A"])
    print("形态 B（新建页脚块）：  %d 个" % stats["B"])
    print("已含邮箱（跳过）：      %d 个" % stats["done"])
    print("按规则跳过：            %d 个" % stats["skip"])
    if stats["nodody"]:
        print("无 </body> 跳过：       %d 个" % stats["nodody"])
    print("本次改动：              %d 个" % len(touched))
    if dry:
        print("\n（--dry 模式，未写盘）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
