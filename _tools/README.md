# _tools —— 站点生成器

这里放的是**用来生成 / 维护本站页面**的脚本，不是站点内容本身。
它们会被 GitHub Pages 一起发布（仓库启用了 `.nojekyll`），但不参与页面导航，也不计入站点页面数。

## 脚本

| 脚本 | 作用 | 典型用法 |
|---|---|---|
| `_gen_pack_request.py` | 把两份「教学交付包」改写成「按需索取页」（保留原 URL） | `ENVLAB_MAIL_USER=xxx ENVLAB_MAIL_DOMAIN=yyy python _tools/_gen_pack_request.py` |
| `_gen_footer_mail.py` | 给站内每个页面底部加联系邮箱（两种插入形态，自动判断） | `ENVLAB_MAIL_USER=xxx ENVLAB_MAIL_DOMAIN=yyy python _tools/_gen_footer_mail.py` |
| `_gen_footer_qr.py` | 给站内每个页面底部加公众号二维码（插在 `</footer>` 之后） | `python _tools/_gen_footer_qr.py` |
| `_gen_clean_copy.py` | 对外口径文案清洗（禁用词：育人 / 叙事式教学 / 可转化素材 / SOP） | `python _tools/_gen_clean_copy.py` |

四个脚本都是**幂等**的，重复运行结果一致。都支持 `--dry` 先看统计不写盘。

## 关于页脚二维码

`_gen_footer_qr.py` 把二维码块插在**最后一个 `</footer>` 之后**（作为页脚的兄弟节点），不是插进页脚内部 —— 原因是
`_gen_footer_mail.py` 形态 B 生成的页脚带 `opacity:.72`，二维码放进去会被整体冲淡，白底变灰、影响扫码。
放在页脚外面才能保住白底黑块的全对比度。

说明文字用 `color:inherit` 跟随页面主题：站内有 67 个深色底页面（`body{background:#0a0e17;color:#e2e8f0}`），
硬编码深色会看不见。二维码图片自身固定白底，在深色页上呈现为一张白色卡片。

相对路径按每个页面所在目录深度**现算**（根目录 `assets/…`、一级 `../assets/…`、二级 `../../assets/…`），
页面挪目录也不会失效。实测 113 个页面全部命中正确深度。

### 点击行为：页内弹层，不是跳原图

早期版本把二维码包在 `<a href="原图" target="_blank">` 里，点一下浏览器直接打开那张 PNG。
现在 `<a>` 上挂 `data-elqr-zoom`，由随块注入的**内联脚本**接管 click（`preventDefault`），
在 `body` 上懒建一个 `position:fixed` 遮罩层；**点遮罩空白处 / 点右上角关闭按钮 / 按 Esc** 三种方式关闭。

- `href` 与 `target="_blank"` **保留**：万一脚本没跑（禁用 JS、脚本被拦），退化成旧行为（打开原图），
  而不是变成一个点不动的死链接。
- 用**内联**脚本而非共用 js 文件：站内 113 个页面全部自包含（外部脚本一律是同目录的，
  如 `config.js` / `api.js`），且支持双击 `file://` 离线打开，再引一个全站共用文件会打破这个前提。
- 脚本有去重开关（`window.__elqrZoom`），重复注入不会重复绑定。

### 升级旧页面

页面里已有 `class="elqr"` 但没有 `data-elqr-zoom` 时，脚本会**精确重建旧块并就地替换**
（绝不直接再插一块，否则页脚会出现两张码）；若旧块与生成器预期的不一致（被手工改过），
脚本直接报错退出、不写盘，不做猜测。

弹层脚本用正则**单独识别、单独比对**：块已存在但脚本内容不是最新版时会被覆盖，
所以调弹层样式只需改生成器再重跑，不必手工动 113 个文件。

## 关于邮箱

`_gen_pack_request.py` 与 `_gen_footer_mail.py` 需要邮箱配置，**从环境变量读取**，不写在脚本里：

```bash
ENVLAB_MAIL_USER=someone ENVLAB_MAIL_DOMAIN=example.com python _tools/_gen_footer_mail.py
```

缺配置时会直接报错并给出提示，不会静默生成一个空邮箱。

页面上也不出现明文地址 —— 用 `data-u` / `data-d` 两个属性承载，由一小段 JS 拼成 `mailto:`，
`<noscript>` 里给「用户名 [at] 域名」的人读兜底。

## 路径约定

`_gen_footer_mail.py`、`_gen_footer_qr.py` 与 `_gen_pack_request.py` 里的 `ROOT` 指向本仓库根目录（脚本所在目录的上一级）。
若把脚本移到别处，需要同步改 `ROOT`。

三个脚本都用同一套仓库判别（同时含 `sitemap.xml`、`robots.txt`、`.nojekyll`、`EnvLab-交互实验集` 才算站点仓库）。
**不要改成用 `.git` 判别** —— 上级目录本身也是 git 仓库（remote 指向另一个项目），
只看 `.git` 会把上级目录误判成站点仓库，从而改掉整棵上级目录树（踩过两次，第二次误改 1790 个文件）。
