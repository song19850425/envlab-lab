#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""补完「对外口径」文案清洗（幂等）。

背景：此前有一轮清洗做到约 1/4 停下，且那 6 个文件已被误提交（commit 8a44eb4）。
本脚本把剩下的一次性补完，替换风格与已提交的那 6 个文件保持一致。

清理项（全部是「对外可见的营销/内部口吻」，不改任何技术内容）：
  育人 / 叙事式教学 / 可转化素材 / SOP

只处理 _deploy_github（git 仓库 = 发布源）；同级的工作副本已漂移，不动。
用法：python _gen_clean_copy.py [--dry]
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

# (说明, 原文, 替换) —— 顺序即执行顺序，长句在前避免被短句截断
RULES = [
    ("主句（ASCII 引号）",
     '这正好是 EnvLab"育人"阶段能直接交付的产品',
     "非常适合作为上岗前的交互式培训材料"),
    ("主句（中文引号）",
     "这正是 EnvLab「育人」阶段能直接交付的产品",
     "非常适合作为上岗前的交互式培训材料"),
    ("尾句",
     "这类受控操作规程合集里有大量仪器，都是同样的可转化素材。",
     "这类受控操作规程合集里有大量仪器，都适合用同样的方式做成培训页。"),
    ("JQC-1 徽章（顺带修掉 ENVLA B 的空格错字）",
     '<div class="badge">ENVLA B · 育人 · 叙事式教学</div>',
     '<div class="badge">ENVLAB · 交互式操作培训</div>'),
    ("JQC-1 页脚",
     "EnvLab「育人」阶段交互培训",
     "交互式操作培训"),
    ("JQC-1 标题与描述",
     "浮游空气菌采样器 · 叙事式教学",
     "浮游空气菌采样器 · 交互式操作培训"),
    ("工具速查页里的引用",
     "EnvLab 叙事式教学页面",
     "EnvLab 交互演示页面"),
    ("行业缩写改中文（对外口径统一）",
     "SOP",
     "标准操作规程"),
]

# 清理后不应再出现的词
FORBIDDEN = ["育人", "叙事式教学", "可转化素材", "SOP"]


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
    counts = {r[0]: 0 for r in RULES}
    touched = set()
    for p in walk_html():
        s = io.open(p, encoding="utf-8", newline="").read()
        orig = s
        for label, old, new in RULES:
            n = s.count(old)
            if n:
                s = s.replace(old, new)
                counts[label] += n
        if s != orig:
            touched.add(os.path.relpath(p, ROOT).replace("\\", "/"))
            if not dry:
                io.open(p, "w", encoding="utf-8", newline="").write(s)

    print("替换统计：")
    for label, old, new in RULES:
        if counts[label]:
            print("  %-34s %3d 处" % (label, counts[label]))
    print("\n涉及页面：%d 个" % len(touched))

    # 复核：禁用词是否清零
    print("\n复核（应为 0）：")
    left = {}
    for p in walk_html():
        s = io.open(p, encoding="utf-8", errors="replace").read()
        for w in FORBIDDEN:
            if w in s:
                left.setdefault(w, []).append(os.path.relpath(p, ROOT).replace("\\", "/"))
    if not left:
        print("  ✓ 育人 / 叙事式教学 / 可转化素材 / SOP 全部清零")
    else:
        for w, ps in left.items():
            print("  ✗ 仍含「%s」：%d 个页面  e.g. %s" % (w, len(ps), ps[0]))
    if dry:
        print("\n（--dry 模式，未写盘）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
