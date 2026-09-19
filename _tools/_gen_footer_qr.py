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

点击行为：**页内弹层放大**，不是跳原图。
  旧版把二维码包在 `<a href="原图" target="_blank">` 里，点一下浏览器直接
  打开那张 PNG —— 用户反馈「不应该是点击弹出二维码、点空白处返回原页面吗」。
  现在改成：`<a>` 上挂 `data-elqr-zoom`，由随块注入的内联脚本接管 click
  （preventDefault），在 body 上懒建一个 fixed 遮罩弹层；点遮罩空白处、
  点右上角关闭按钮、按 Esc 三种方式都能回到原页面。
  `href` 与 `target="_blank"` 保留 —— 万一脚本没跑（禁用 JS / 脚本被拦），
  退化成旧行为（打开原图），而不是变成一个点不动的死链接。

  为什么用**内联**脚本而不是共用 js 文件 —— 站内 113 个页面全部自包含
  （外部脚本一律是「同目录」的，如 config.js / api.js），且支持双击 file://
  离线打开；再引一个全站共用文件会打破这个前提。

配色：说明文字用 `color:inherit` 跟随页面主题 —— 站内有 67 个深色底页面
  （`body{background:#0a0e17;color:#e2e8f0}`），硬编码深色会看不见。
  二维码图片自身固定白底（`background:#fff`），在深色页上呈现为一张白色卡片。
  弹层遮罩用深色半透明 + 白字，浅色页深色页都成立。

相对路径：按每个页面所在目录深度现算（根目录 `assets/…`、一级 `../assets/…`、
  二级 `../../assets/…`），不写死，页面挪目录也不会失效。

跳过（与 _gen_footer_mail.py 保持一致）：
  · EnvLab-交互实验集/04-案例/黑灯采样-自动化无人采样仿真演示.html （html,body{height:100%;overflow:hidden}，加了会被裁掉）
  · 推广素材/竖版60秒-自动演示页.html                            （竖版演示页，不计入站点页面）

用法：python _gen_footer_qr.py [--dry]
"""
import io
import os
import re
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

# 幂等依据：新版块带 data-elqr-zoom；旧版块只有 class="elqr"。
NEW_MARK = 'data-elqr-zoom'
OLD_MARK = 'class="elqr"'

# 已注入的弹层脚本。**单独识别、单独比对**，这样改脚本能全站覆盖，
# 不必因为「块已存在」而整页跳过。
SCRIPT_RE = re.compile(r"<script data-elqr-script>.*?</script>", re.S)

# 展示尺寸。二维码原图 600×600，缩到 112px 仍然清晰。
QR_PX = 112

# 弹层脚本。内联进每个页面，自带去重开关（window.__elqrZoom）。
# __ALT__ / __CAP__ 在 zoom_js() 里替换，避免 format 撞上 JS 的花括号。
ZOOM_JS = """<script data-elqr-script>(function(){
if(window.__elqrZoom)return;window.__elqrZoom=1;
var ALT="__ALT__",CAP="__CAP__",HINT="点击空白处或按 Esc 关闭";
var ov=null,prev=null;
function close(){
  var o=ov;if(!o)return;ov=null;
  o.style.opacity="0";
  setTimeout(function(){if(o.parentNode)o.parentNode.removeChild(o);},180);
  document.removeEventListener("keydown",onKey);
  if(prev&&prev.focus){try{prev.focus();}catch(e){}}
  prev=null;
}
function onKey(e){if(e.key==="Escape"||e.keyCode===27)close();}
function build(src){
  var o=document.createElement("div");
  o.setAttribute("role","dialog");
  o.setAttribute("aria-modal","true");
  o.setAttribute("aria-label","微信公众号二维码");
  o.style.cssText="position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:rgba(0,0,0,.78);cursor:zoom-out;opacity:0;transition:opacity .16s ease-out";
  var b=document.createElement("div");
  b.style.cssText="text-align:center;cursor:default";
  var im=document.createElement("img");
  im.src=src;im.alt=ALT;
  im.style.cssText="display:block;width:420px;max-width:92vw;height:auto;width:min(66vw,66vh);background:#fff;padding:16px;border-radius:14px;box-sizing:border-box;box-shadow:0 20px 60px rgba(0,0,0,.5)";
  var c=document.createElement("div");
  c.textContent=CAP;
  c.style.cssText="margin-top:16px;font-size:14px;line-height:1.7;color:#fff;opacity:.92";
  var h=document.createElement("div");
  h.textContent=HINT;
  h.style.cssText="margin-top:6px;font-size:12px;line-height:1.7;color:#fff;opacity:.72";
  var x=document.createElement("button");
  x.type="button";x.setAttribute("aria-label","关闭");x.innerHTML="&times;";
  x.style.cssText="position:fixed;top:18px;right:22px;width:42px;height:42px;padding:0;font-size:26px;line-height:1;color:#fff;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);border-radius:50%;cursor:pointer;font-family:inherit";
  b.appendChild(im);b.appendChild(c);b.appendChild(h);
  o.appendChild(b);o.appendChild(x);
  o.addEventListener("click",function(e){if(e.target===o||e.target===x)close();});
  document.body.appendChild(o);
  return o;
}
function open(src,trigger){
  prev=trigger||null;
  ov=ov||build(src);
  var im=ov.querySelector("img");
  if(im&&im.getAttribute("src")!==src)im.setAttribute("src",src);
  document.addEventListener("keydown",onKey);
  setTimeout(function(){if(ov)ov.style.opacity="1";},10);
  var btn=ov.querySelector("button");
  if(btn&&btn.focus){try{btn.focus();}catch(e){}}
}
document.addEventListener("click",function(e){
  var t=e.target;
  while(t&&t!==document){
    if(t.getAttribute&&t.getAttribute("data-elqr-zoom")!==null)break;
    t=t.parentNode;
  }
  if(!t||t===document||!t.getAttribute)return;
  e.preventDefault();
  open(t.getAttribute("href"),t);
});
})();</script>"""


def zoom_js():
    return ZOOM_JS.replace("__ALT__", QR_ALT).replace("__CAP__", QR_CAP)


def block(rel, nl):
    """rel：本页面到二维码图的相对路径。"""
    return (
        '<div class="elqr" style="margin:18px 0 0;text-align:center;font-size:12px;line-height:1.7">'
        '<a href="{rel}" target="_blank" rel="noopener" data-elqr-zoom title="点击放大二维码" '
        'style="display:inline-block;color:inherit;text-decoration:none;cursor:zoom-in">'
        '<img src="{rel}" alt="{alt}" width="{px}" height="{px}" loading="lazy" decoding="async" '
        'style="display:block;width:{px}px;height:{px}px;margin:0 auto;padding:6px;background:#fff;'
        'border:1px solid rgba(128,128,128,.25);border-radius:8px;box-sizing:content-box">'
        '<span style="display:block;margin-top:7px;opacity:.85">{cap}</span>'
        '</a></div>'
    ).format(rel=rel, alt=QR_ALT, px=QR_PX, cap=QR_CAP) + nl + zoom_js()


def legacy_block(rel):
    """旧版块（`<a target="_blank">` 直接跳原图）。用来精确识别、就地升级。"""
    return (
        '<div class="elqr" style="margin:18px 0 0;text-align:center;font-size:12px;line-height:1.7">'
        '<a href="{rel}" target="_blank" rel="noopener" title="点击放大二维码" '
        'style="display:inline-block;color:inherit;text-decoration:none">'
        '<img src="{rel}" alt="{alt}" width="{px}" height="{px}" loading="lazy" decoding="async" '
        'style="display:block;width:{px}px;height:{px}px;margin:0 auto;padding:6px;background:#fff;'
        'border:1px solid rgba(128,128,128,.25);border-radius:8px;box-sizing:content-box">'
        '<span style="display:block;margin-top:7px;opacity:.85">{cap}</span>'
        '</a></div>'
    ).format(rel=rel, alt=QR_ALT, px=QR_PX, cap=QR_CAP)


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
    stats = {"after_footer": 0, "before_body": 0, "skip": 0, "done": 0, "nodody": 0,
             "upgraded": 0, "script_updated": 0}
    pending = []          # (绝对路径, 相对路径, 新内容) —— 全部校验通过后才统一写盘
    for p in walk_html():
        rel = os.path.relpath(p, ROOT).replace("\\", "/")
        if rel in SKIP:
            stats["skip"] += 1
            continue
        s = io.open(p, encoding="utf-8", newline="").read()

        nl = "\r\n" if "\r\n" in s else "\n"

        changed = False

        if NEW_MARK in s:
            # 块已是最新；但**脚本可能过期** —— 单独比对内容，让它永远可覆盖。
            # 否则将来调一次弹层样式，就得手工改 113 个文件。
            m = SCRIPT_RE.search(s)
            if not m:
                raise SystemExit(
                    "自检失败（%s）：有 data-elqr-zoom 却没有 data-elqr-script，"
                    "说明这一页被手工改过。\n本次未写盘，站点保持原样。" % rel)
            if m.group(0) != zoom_js():
                s = s[:m.start()] + zoom_js() + s[m.end():]
                changed = True
                stats["script_updated"] += 1
        elif OLD_MARK in s:
            # 旧版块已注入过 → 就地升级，绝不能直接再插一块（会变成两个二维码）
            old = legacy_block(rel_to_qr(p))
            if old not in s:
                raise SystemExit(
                    "升级失败（%s）：页面里有 class=\"elqr\"，但旧版块与生成器预期的不一致。\n"
                    "说明它被手工改过 —— 脚本不做猜测。请先人工核对这一页，再重跑。\n"
                    "本次未写盘，站点保持原样。" % rel)
            s = s.replace(old, block(rel_to_qr(p), nl))
            changed = True
            stats["upgraded"] += 1
        elif "</footer>" in s:
            i = s.rfind("</footer>") + len("</footer>")
            s = s[:i] + nl + block(rel_to_qr(p), nl) + s[i:]
            changed = True
            stats["after_footer"] += 1
        elif "</body>" in s:
            i = s.rfind("</body>")
            s = s[:i] + block(rel_to_qr(p), nl) + nl + s[i:]
            changed = True
            stats["before_body"] += 1
        else:
            stats["nodody"] += 1
            print("  ⚠ 无 </footer> 也无 </body>，跳过：%s" % rel)
            continue

        if not changed:
            stats["done"] += 1
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
        # 弹层脚本必须真的跟着块一起进去了，否则「点击跳原图」的旧行为会复活
        if NEW_MARK not in s or "data-elqr-script" not in s:
            raise SystemExit("结构自检失败（%s）：注入后仍缺 data-elqr-zoom / data-elqr-script。\n"
                             "本次未写盘，站点保持原样。" % rel)
        # 一页只允许一个二维码块，重复注入会让页脚出现两张码
        if s.count('class="elqr"') != 1:
            raise SystemExit("结构自检失败（%s）：页内 class=\"elqr\" 出现 %d 次（应为 1）。\n"
                             "本次未写盘，站点保持原样。" % (rel, s.count('class="elqr"')))

        pending.append((p, rel, s))

    # 全部校验通过，才统一落盘（全有或全无）。
    # 不边算边写：否则中途报错会留下「前一半已注入、后一半没注入」的半成品站点。
    if not dry:
        for p, _rel, s in pending:
            io.open(p, "w", encoding="utf-8", newline="").write(s)
    touched = [rel for _p, rel, _s in pending]

    print("\n形态 A（插在 </footer> 之后）：%d 个" % stats["after_footer"])
    print("形态 B（插在 </body> 之前）：%d 个" % stats["before_body"])
    print("旧版升级为弹层：          %d 个" % stats["upgraded"])
    print("弹层脚本更新到最新版：    %d 个" % stats["script_updated"])
    print("已是新版（跳过）：        %d 个" % stats["done"])
    print("按规则跳过：              %d 个" % stats["skip"])
    if stats["nodody"]:
        print("无锚点跳过：              %d 个" % stats["nodody"])
    print("本次改动：                %d 个" % len(touched))
    if dry:
        print("\n（--dry 模式，未写盘）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
