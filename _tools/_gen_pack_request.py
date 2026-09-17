#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把两份「教学交付包」改写成「按需索取页」（保留原 URL）。

为什么这么做：
  交互页（含四关模拟台）是「体验」，越多人用越好 → 永久免费公开；
  交付包（学生手册 / 教师指南 / 现成作业 + 评分量规）是「产品」→ 改为邮件索取。

设计要点：
  · **保留原 URL** —— 不 404、不影响 sitemap、不断已有外链
  · **复用各页自己的 <style>** —— 两个分组主题色不同（执法橙 / 碳核查青绿），
    整段照搬才能保证新页与站内同族页面外观一致
  · **邮箱不明文出现在 HTML 里** —— 由 JS 用 data-u / data-d 拼接，
    挡掉绝大多数爬虫；<noscript> 给兜底说明
  · 幂等：重复运行结果一致

用法：python _gen_pack_request.py
"""
import io
import os
import re

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

PACKS = [
    {
        "path": "EnvLab-交互实验集/10-环境执法/CEMS执法检查-教学交付包.html",
        "title": "CEMS 执法检查 · 教学交付包 · EnvLab",
        "desc": "CEMS 执法检查教学交付包索取页：配套《CEMS 造假识别与执法检查》交互页，提供学生实操手册、"
                "教师指南与 3 个现成作业（各带 100 分制评分量规），通过邮件按需获取。",
        "badge": "EnvLab · 环境执法实训 · 教学交付件",
        "h1": "📦 CEMS 造假识别与执法检查 · 教学交付包",
        "sub": "配套《CEMS 造假识别与执法检查》交互页<br>学生手册 / 教师指南 / 现成作业 / 部署说明",
        "stats": [("1 份", "学生手册"), ("1 份", "教师指南"), ("3 个", "现成作业"), ("3 套", "评分量规")],
        "peer": ("CEMS造假识别与执法检查-交互版.html", "CEMS 造假识别与执法检查"),
        "peerTitle": "CEMS 造假识别与执法检查",
        "packName": "《CEMS 造假识别与执法检查》教学交付包",
        "mailSubject": "索取教学交付包：CEMS 执法检查",
        "footerNote": "CEMS 造假识别与执法检查 · 教学交付包",
        "sections": [
            ("00", "怎么用这份包", "三分钟看清：这份包给谁、怎么用", "教师"),
            ("01", "学生实操手册", "操作卡 · 判据速查表 · 易错清单", "学生"),
            ("02", "教师指南", "知识点—关卡映射 · 90 分钟课堂流程 · 3 个开放讨论题", "教师"),
            ("03", "现成作业", "3 个作业，各带 100 分制评分量规", "教师"),
            ("04", "部署与使用", "零安装 · 可离线 · 可嵌入课程平台", "教务 / 教师"),
            ("05", "红线与免责", "教学设定，不指向任何真实企业", "全体"),
        ],
        "freeNote": "四关模拟台（站房勘察 → 拆除伪装与管线复位 → 参数与备案核对 → 标准气体盲测）无需索取，直接打开即用。",
        "disclaimer": "本交付包为教学设定，不指向任何真实企业，不构成正式执法结论。",
    },
    {
        "path": "EnvLab-交互实验集/11-碳与碳市场/钢铁碳排放核查-教学交付包.html",
        "title": "钢铁碳排放核查 · 教学交付包 · EnvLab",
        "desc": "钢铁碳排放核查教学交付包索取页：配套《绿色大账本：钢铁企业碳排放核查与履约》交互页，"
                "提供学生实操手册、教师指南与 3 个现成作业（各带 100 分制评分量规），通过邮件按需获取。",
        "badge": "EnvLab · 碳核查实训 · 教学交付件",
        "h1": "📦 钢铁碳排放核查 · 教学交付包",
        "sub": "配套《绿色大账本：钢铁企业碳排放核查与履约》交互页<br>学生手册 / 教师指南 / 现成作业 / 部署说明",
        "stats": [("1 份", "学生手册"), ("1 份", "教师指南"), ("3 个", "现成作业"), ("3 套", "评分量规")],
        "peer": ("钢铁企业碳排放核查与履约-交互版.html", "绿色大账本 · 钢铁企业碳排放核查与履约"),
        "peerTitle": "绿色大账本：钢铁企业碳排放核查与履约",
        "packName": "《钢铁企业碳排放核查与履约》教学交付包",
        "mailSubject": "索取教学交付包：钢铁碳核查",
        "footerNote": "钢铁企业碳排放核查与履约 · 教学交付包",
        "sections": [
            ("00", "怎么用这份包", "三分钟看清：这份包给谁、怎么用", "教师"),
            ("01", "学生实操手册", "操作卡 · 核心公式与缺省值 · 易错清单", "学生"),
            ("02", "教师指南", "知识点—关卡映射 · 90 分钟课堂流程 · 3 个开放讨论题", "教师"),
            ("03", "现成作业", "3 个作业，各带 100 分制评分量规", "教师"),
            ("04", "部署与使用", "零安装 · 可离线 · 可嵌入课程平台", "教务 / 教师"),
            ("05", "红线与免责", "教学设定，不指向任何真实企业", "全体"),
        ],
        "freeNote": "四关模拟台（边界与源项识别 → 入厂煤发热量复核 → 台账三方凭证核对 → 配额清缴决策）无需索取，直接打开即用。",
        "disclaimer": "本交付包为教学设定，不指向任何真实企业，不构成正式核查结论。",
    },
]

TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>__TITLE__</title>
<meta name="description" content="__DESC__">
<link rel="canonical" href="https://song19850425.github.io/envlab-lab/__CANON__">
<style>
__STYLE__
</style>
</head>
<body>
<div id="sp"></div>

<section class="hr">
  <div class="hg"></div><div class="hgl"></div>
  <div class="hb">__BADGE__</div>
  <h1 class="h1">__H1__</h1>
  <div class="hs">__SUB__</div>
  <div class="hst">
__STATS__
  </div>
</section>

<section class="sec" id="s00">
  <div class="sn">00 · 分发说明</div>
  <div class="st">交互页免费开放，交付包按需索取</div>
  <div class="sd">配套交互页（含四关模拟台）<b>永久免费公开</b>，打开即用、可离线、可嵌入课程，不需要任何申请。本交付包是面向<b>教师与培训机构</b>的备课材料，包含现成作业与评分量规，不再公开分发。</div>
  <div class="note">为什么要分开：交互页解决「学生怎么练」，交付包解决「老师怎么教、怎么评」。前者越多人用越好；后者是备课成品，按需分发更合适。</div>
  <div class="note blue">__FREENOTE__<br><a href="__PEER__" style="color:#38bdf8;font-weight:600">→ 打开《__PEERTITLE__》交互页</a></div>
</section>

<section class="sec" id="s01">
  <div class="sn">01 · 交付内容</div>
  <div class="st">6 节，从怎么用到免责声明</div>
  <div class="sd">交付包为单文件网页，与配套交互页数值口径完全一致，可整目录下载离线使用。</div>
  <table class="tbl">
    <thead><tr><th style="width:56px">节</th><th>内容</th><th style="width:110px">给谁</th></tr></thead>
    <tbody>
__ROWS__
    </tbody>
  </table>
</section>

<section class="sec" id="s02">
  <div class="sn">02 · 获取方式</div>
  <div class="st">发一封邮件，说明三件事</div>
  <div class="sd">请在邮件里写明下面三项，方便直接给你合适的版本：</div>
  <div class="g3">
    <div class="ic"><div class="ii">🏫</div><div class="in">你的身份</div><div class="id">学校 / 机构名称，以及你是教师、教务还是培训机构。</div><span class="it">必填</span></div>
    <div class="ic"><div class="ii">📅</div><div class="in">使用场景</div><div class="id">课程名称、学生层次与大致人数、计划什么时候用。</div><span class="it">必填</span></div>
    <div class="ic"><div class="ii">📦</div><div class="in">需要哪一份</div><div class="id">本页对应的交付包，或其他配套交付包（可以都要）。</div><span class="it">必填</span></div>
  </div>
  <div style="margin-top:26px;text-align:center">
    <a id="mail" href="#mail"
       data-u="__MU__" data-d="__MD__"
       data-s="__MSUBJ__"
       data-b="__MBODY__"
       style="display:inline-block;padding:15px 38px;border-radius:10px;background:linear-gradient(90deg,__ACCENT__,__GLOW__);color:#0a0e17;font-size:15px;font-weight:800;text-decoration:none;letter-spacing:.5px">✉ 发送邮件索取</a>
    <div style="margin-top:14px;font-size:12.5px;color:#64748b">收件邮箱：<span id="mailText">（正在载入…）</span></div>
    <noscript><div class="note warnbox" style="margin-top:16px;text-align:left">本页需要开启 JavaScript 才能显示收件邮箱。也可以先<a href="__PEER__" style="color:#38bdf8">打开免费的交互页</a>，再从<a href="../index.html" style="color:#38bdf8">实验集总目录</a>找到入口。</div></noscript>
  </div>
</section>

<section class="sec" id="s03">
  <div class="sn">03 · 使用许可</div>
  <div class="st">可教学使用，不可再分发</div>
  <div class="sd">交付包可用于课堂教学、岗前培训与内部考核；可打印，可上传到校内 LMS 或课程平台。<b>请勿公开转载、二次分发或用于商业售卖。</b></div>
  <div class="note warnbox">如果所在机构需要多校区共享、或用于对外收费培训，请来信说明，可以单独授权。</div>
  <div class="note">__DISCLAIMER__</div>
</section>

<footer class="ft">
  <b>EnvLab 环境实训</b> · __FOOTER__
  <div class="nav">
    <a href="../index.html">实验集总目录</a>
    <a class="cur" href="__PEER__">配套交互页</a>
  </div>
</footer>

<a id="bk" href="../index.html" title="返回实验集总目录（Alt+Esc）"><span class="bk-a" aria-hidden="true">←</span><span class="bk-t">返回目录</span></a>
<script>(function(){var b=document.getElementById("bk");if(!b)return;var f=function(){var y=window.pageYOffset||document.documentElement.scrollTop;if(y>260)b.classList.add("on");else b.classList.remove("on")};if(typeof window.addEventListener==='function')window.addEventListener("scroll",f,{passive:true});f();if(typeof document.addEventListener==='function')document.addEventListener("keydown",function(e){if(e.key==="Escape"&&e.altKey)location.href=b.getAttribute("href")});})();</script>
<script>(function(){var sp=document.getElementById("sp");function f(){var h=document.documentElement.scrollHeight-window.innerHeight;var y=window.pageYOffset||document.documentElement.scrollTop;if(sp)sp.style.width=(h>0?(y/h*100):0)+"%"}if(typeof window.addEventListener==='function')window.addEventListener("scroll",f,{passive:true});f();})();</script>
<script>(function(){try{var io=new IntersectionObserver(function(es){for(var i=0;i<es.length;i++){if(es[i].isIntersecting)es[i].target.classList.add("visible")}},{threshold:0.12});var secs=document.querySelectorAll(".sec");for(var j=0;j<secs.length;j++){io.observe(secs[j])}}catch(e){var s2=document.querySelectorAll(".sec");for(var k=0;k<s2.length;k++){s2[k].classList.add("visible")}}})();</script>
<script>(function(){
  var a=document.getElementById("mail"); if(!a) return;
  var u=a.getAttribute("data-u"), d=a.getAttribute("data-d");
  if(!u||!d) return;
  var addr=u+"@"+d;
  a.href="mailto:"+addr
    +"?subject="+encodeURIComponent(a.getAttribute("data-s")||"")
    +"&body="+encodeURIComponent(a.getAttribute("data-b")||"");
  var t=document.getElementById("mailText"); if(t) t.textContent=addr;
})();</script>
</body>
</html>
"""


def read(path):
    with io.open(path, encoding="utf-8", newline="") as f:
        return f.read()


def extract_style(html):
    m = re.search(r"<style>(.*?)</style>", html, re.S)
    if not m:
        raise SystemExit("源文件里找不到 <style> 块")
    return m.group(1).strip("\n")


def extract_accent(style):
    a = re.search(r"--accent:(#[0-9a-fA-F]{3,8})", style)
    g = re.search(r"--glow:(#[0-9a-fA-F]{3,8})", style)
    return (a.group(1) if a else "#f97316"), (g.group(1) if g else "#fb923c")


def build(pack, src_html):
    style = extract_style(src_html)
    accent, glow = extract_accent(style)

    stats = "\n".join(
        '    <div><span class="n">%s</span><span class="l">%s</span></div>' % (n, l)
        for n, l in pack["stats"])
    rows = "\n".join(
        "      <tr><td><b>%s</b></td><td>%s<br><span style=\"color:#64748b\">%s</span></td><td>%s</td></tr>"
        % (no, name, sub, who) for no, name, sub, who in pack["sections"])

    body = "\n".join([
        "",
        "您好，我想索取%s。" % pack["packName"],
        "",
        "身份（学校 / 机构）：",
        "使用场景（课程名称、学生层次、人数、计划时间）：",
        "需要哪一份：",
        "",
        "谢谢。",
    ])

    out = TEMPLATE
    for k, v in [
        ("__STYLE__", style),
        ("__TITLE__", pack["title"]),
        ("__DESC__", pack["desc"]),
        ("__CANON__", pack["path"].replace("\\", "/")),
        ("__BADGE__", pack["badge"]),
        ("__H1__", pack["h1"]),
        ("__SUB__", pack["sub"]),
        ("__STATS__", stats),
        ("__ROWS__", rows),
        ("__PEER__", pack["peer"][0]),
        ("__PEERTITLE__", pack["peerTitle"]),
        ("__FREENOTE__", pack["freeNote"]),
        ("__DISCLAIMER__", pack["disclaimer"]),
        ("__FOOTER__", pack["footerNote"]),
        ("__MU__", MAIL_USER),
        ("__MD__", MAIL_DOMAIN),
        ("__MSUBJ__", pack["mailSubject"]),
        ("__MBODY__", body.replace("\n", "&#10;")),
        ("__ACCENT__", accent),
        ("__GLOW__", glow),
    ]:
        out = out.replace(k, v)

    left = re.findall(r"__[A-Z_]+__", out)
    if left:
        raise SystemExit("模板占位符未替换完：%s" % set(left))
    return out, accent, glow


def main():
    total = 0
    for pack in PACKS:
        p = os.path.join(ROOT, pack["path"].replace("/", os.sep))
        if not os.path.exists(p):
            raise SystemExit("文件不存在：" + p)
        src = read(p)
        before = len(src.encode("utf-8"))
        html, accent, glow = build(pack, src)
        with io.open(p, "w", encoding="utf-8", newline="\n") as f:
            f.write(html)
        after = len(html.encode("utf-8"))
        total += 1
        # 自查：邮箱不得明文出现
        assert (MAIL_USER + "@" + MAIL_DOMAIN) not in html, "邮箱明文出现在 HTML 里：" + pack["path"]
        assert "data-u=" in html and "data-d=" in html, "缺 JS 拼接所需的 data 属性"
        print("✓ %s" % pack["path"])
        print("   %d → %d 字节 | 主题色 %s / %s | 邮箱已改为 JS 拼接" % (before, after, accent, glow))
    print("\n共改写 %d 个页面（原 URL 保留，内容由「交付包」改为「索取页」）" % total)


if __name__ == "__main__":
    main()
