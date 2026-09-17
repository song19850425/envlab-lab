# _tools —— 站点生成器

这里放的是**用来生成 / 维护本站页面**的脚本，不是站点内容本身。
它们会被 GitHub Pages 一起发布（仓库启用了 `.nojekyll`），但不参与页面导航，也不计入站点页面数。

## 脚本

| 脚本 | 作用 | 典型用法 |
|---|---|---|
| `_gen_pack_request.py` | 把两份「教学交付包」改写成「按需索取页」（保留原 URL） | `ENVLAB_MAIL_USER=xxx ENVLAB_MAIL_DOMAIN=yyy python _tools/_gen_pack_request.py` |
| `_gen_footer_mail.py` | 给站内每个页面底部加联系邮箱（两种插入形态，自动判断） | `ENVLAB_MAIL_USER=xxx ENVLAB_MAIL_DOMAIN=yyy python _tools/_gen_footer_mail.py` |
| `_gen_clean_copy.py` | 对外口径文案清洗（禁用词：育人 / 叙事式教学 / 可转化素材 / SOP） | `python _tools/_gen_clean_copy.py` |

三个脚本都是**幂等**的，重复运行结果一致。

## 关于邮箱

`_gen_pack_request.py` 与 `_gen_footer_mail.py` 需要邮箱配置，**从环境变量读取**，不写在脚本里：

```bash
ENVLAB_MAIL_USER=someone ENVLAB_MAIL_DOMAIN=example.com python _tools/_gen_footer_mail.py
```

缺配置时会直接报错并给出提示，不会静默生成一个空邮箱。

页面上也不出现明文地址 —— 用 `data-u` / `data-d` 两个属性承载，由一小段 JS 拼成 `mailto:`，
`<noscript>` 里给「用户名 [at] 域名」的人读兜底。

## 路径约定

`_gen_footer_mail.py` 与 `_gen_pack_request.py` 里的 `ROOT` 指向本仓库根目录（脚本所在目录的上一级）。
若把脚本移到别处，需要同步改 `ROOT`。
