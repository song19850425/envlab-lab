#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""给站内每个页面底部加上作者公众号二维码（幂等）。

插入位置：最后一个 </footer> **之后**，作为页脚的兄弟节点。

  为什么不插进页脚内部 —— 生成式页脚（_gen_footer_mail.py 形态 B）自带
  `opacity:.72`，二维码放进去会被整体冲淡，白底变灰、影响扫码。
  放到页脚外面才能保住白底黑块的全对比度。

  为什么插在 </footer> 之后而不是 </body> 之前 —— 页脚通常位于页面主容器
  （如 train.html 的 .wrap，max-width:820px 居中）内部，插在其后可以落在
  同一列里，与页脚视觉连续；插到 </body> 前则可能跑到容器外面。

配色：说明文字用 `color:inherit` 跟随页面主题 —— 站内有 67 个深色底页面
  （`body{background:#0a0e17;color:#e2e8f0}`），硬编码深色会看不见。
  二维码图片自身固定白底（`background:#fff`），在深色页上呈现为一张白色卡片。

相对路径：按每个页面所在目录深度现算（根目录 `assets/…`、一级 `../assets/…`、
  二级 `../../assets/…`），不写死，页面挪目录也不会失效。

跳过（与 _gen_footer_mail.py 保持一致）：
  · EnvLab-交互实验集/04-案例/黑灯采样-自动化无人采样仿真演示.html （html,body{height:100%;overflow:hidden}，加了会被裁掉）
  · 推广素材/竖版60秒-自动演示页.html                            （竖版演示页，不计入站点页面）

用法：python _gen_footer_qr.py [--dry]
"""
import io
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))

# 站点仓库的标志文件。**不要用 `.git` 判别** —— 上级目录本身也是 git 仓库
# （remote 指向另一个项目），只看 .git 会把上级目录误判成站点仓库，
# 于是把整棵上级目录树都改了（踩过两次：第二次误改 1790 个文件）。
_SITE_MARKERS = ("sitemap.xml", "robots.txt", ".nojekyll", "EnvLab-交互实验集")


def _is_site_repo(d):
    return bool(d) and all(os.path.exists(os.path.join(d, m)) for m in _SITE_MARKERS)


def _find_repo(start):
    """脚本可能放在仓库根、仓库的 _tools/ 下、或仓库的同级目录。"""
    for c in (start,
              os.path.dirname(start),
              os.path.join(start, "_deploy_github"),
              os.path.join(os.path.dirname(start), "_deploy_github")):
        if _is_site_repo(c):
            return os.path.abspath(c)
    return None


ROOT = os.environ.get("ENVLAB_REPO", "").strip() or _find_repo(_HERE)
if not _is_site_repo(ROOT):
    raise SystemExit(
        "找不到站点仓库（需同时含 %s）。\n脚本位置：%s\n"
        "可用环境变量 ENVLAB_REPO 显式指定仓库根目录。" % ("、".join(_SITE_MARKERS), _HERE))
print("[repo] %s" % ROOT)

# 二维码图与公众号名。名字本身已是公开信息（同款二维码也在另一个站点公开），
# 不属于 _gen_footer_mail.py 里邮箱那种需要环境变量承载的敏感信息。
QR_SRC = "assets/wechat-qrcode.png"
QR_ACCOUNT = "小宋的环保笔记"
QR_ALT = "微信公众号「%s」二维码" % QR_ACCOUNT
QR_CAP = "微信公众号 · %s" % QR_ACCOUNT

if not os.path.exists(os.path.join(ROOT, QR_SRC)):
    raise SystemExit("找不到二维码图：%s（相对仓库根）" % QR_SRC)

SKIP = {
    "EnvLab-交互实验集/04-案例/黑灯采样-自动化无人采样仿真演示.html",
    "推广素材/竖版60秒-自动演示页.html",
}

# 已插入过的标记：幂等依据
MARK = 'class="elqr"'

# 展示尺寸。二维码原图 600×600，缩到 112px 仍然清晰；
# 点击可跳原图（<a target="_blank">）放大扫码，因此不需要额外的弹层脚本。
QR_PX = 112


def block(rel, nl):
    """rel：本页面到二维码图的相对路径。"""
    return (
        '<div class="elqr" style="margin:18px 0 0;text-align:center;font-size:12px;line-height:1.7">'
        '<a href="{rel}" target="_blank" rel="noopener" title="点击放大二维码" '
        'style="display:inline-block;color:inherit;text-decoration:none">'
        '<img src="{rel}" alt="{alt}" width="{px}" height="{px}" loading="lazy" decoding="async" '
        'style="display:block;width:{px}px;height:{px}px;margin:0 auto;padding:6px;background:#fff;'
        'border:1px solid rgba(128,128,128,.25);border-radius:8px;box-sizing:content-box">'
        '<span style="display:block;margin-top:7px;opacity:.85">{cap}</span>'
        '</a></div>'
    ).format(rel=rel, alt=QR_ALT, px=QR_PX, cap=QR_CAP).replace("\n", nl)


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


def rel_to_qr(page_abs):
    """页面到二维码图的相对路径，统一用 / 分隔。"""
    d = os.path.dirname(page_abs)
    r = os.path.relpath(os.path.join(ROOT, QR_SRC), d).replace("\\", "/")
    return r


def main():
    dry = "--dry" in sys.argv
    stats = {"after_footer": 0, "before_body": 0, "skip": 0, "done": 0, "nodody": 0}
    pending = []          # (绝对路径, 相对路径, 新内容) —— 全部校验通过后才统一写盘
    for p in walk_html():
        rel = os.path.relpath(p, ROOT).replace("\\", "/")
        if rel in SKIP:
            stats["skip"] += 1
            continue
        s = io.open(p, encoding="utf-8", newline="").read()
        if MARK in s:
            stats["done"] += 1
            continue

        nl = "\r\n" if "\r\n" in s else "\n"
        blk = block(rel_to_qr(p), nl)

        if "</footer>" in s:
            i = s.rfind("</footer>") + len("</footer>")
            s = s[:i] + nl + blk + s[i:]
            stats["after_footer"] += 1
        elif "</body>" in s:
            i = s.rfind("</body>")
            s = s[:i] + blk + nl + s[i:]
            stats["before_body"] += 1
        else:
            stats["nodody"] += 1
            print("  ⚠ 无 </footer> 也无 </body>，跳过：%s" % rel)
            continue

        # 结构自检：插入只能追加，不能破坏文档骨架。
        # 本项目踩过一次「锚点索引算错，把 <!DOCTYPE html> 拆成 <!DO + 卡片 + CTYPE html>」，
        # 而当时的自检全绿（只查标签配对，看不见 DOCTYPE 被截断）。所以这里硬性挡一道。
        # 大小写不敏感 —— 站内有页面写的是小写 <!doctype html>。
        _head = s.lstrip("\ufeff")[:24].lower()
        if not _head.startswith("<!doctype html>"):
            raise SystemExit("结构自检失败（%s）：开头不是完整 DOCTYPE，实际开头 %r\n"
                             "本次未写盘，站点保持原样。" % (rel, s[:40]))
        if not s.rstrip().lower().endswith("</html>"):
            raise SystemExit("结构自检失败（%s）：结尾不是 </html>，实际结尾 %r\n"
                             "本次未写盘，站点保持原样。" % (rel, s[-40:]))

        pending.append((p, rel, s))

    # 全部校验通过，才统一落盘（全有或全无）。
    # 不边算边写：否则中途报错会留下「前一半已注入、后一半没注入」的半成品站点。
    if not dry:
        for p, _rel, s in pending:
            io.open(p, "w", encoding="utf-8", newline="").write(s)
    touched = [rel for _p, rel, _s in pending]

    print("\n形态 A（插在 </footer> 之后）：%d 个" % stats["after_footer"])
    print("形态 B（插在 </body> 之前）：%d 个" % stats["before_body"])
    print("已含二维码（跳过）：      %d 个" % stats["done"])
    print("按规则跳过：              %d 个" % stats["skip"])
    if stats["nodody"]:
        print("无锚点跳过：              %d 个" % stats["nodody"])
    print("本次改动：                %d 个" % len(touched))
    if dry:
        print("\n（--dry 模式，未写盘）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
