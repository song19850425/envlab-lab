# EnvLab 仪器操作培训系统 · 部署说明

把"学员培训记录存云端、多端共享、真实账号"落到生产环境，只需一台能跑 Node 的云主机。

## 一、目录结构
```
EnvLab-培训系统/
├── index.html            学员登录 / 注册主页
├── train.html            培训页（fetch 版，接入云端）
├── train-standalone.html 培训页（离线单文件版，无云端）
├── admin.html            培训记录台（管理员登录后可见）
├── api.js / config.js    前端云端接入层（云端优先，失败回退本机）
├── instruments/          各仪器配置 JSON（加一台仪器 = 丢一个 JSON）
├── sop-pages/            已做好的 SOP 交互培训页（学习阶段 iframe 调用）
└── server/               后端服务（Node 内置模块，零依赖）
    ├── index.js
    ├── package.json
    └── db.json           云端数据库（JSON 文件，自动生成）
```

## 二、本地试运行
```bash
cd EnvLab-培训系统
node server/index.js          # 默认端口 8899
# 或自定义端口： PORT=3000 node server/index.js
```
浏览器打开 http://localhost:8899/ 即可。后端会自动：
- 托管前端静态文件；
- 注入 `window.API_BASE="/api"`，前端因此走云端（真实账号 + 共享记录）；
- 把学员账号与培训记录写入 `server/db.json`。

## 三、部署到国内云主机（腾讯云轻量 / 阿里云 ECS）
目标：让手机、电脑、不同学员都访问**同一个地址**，记录共享在云端。

1. 把整个 `EnvLab-培训系统/` 目录上传到云主机（scp / 宝塔 / 云助手均可）。
2. 云主机安装 Node.js 18+（腾讯云镜像源可一键装）。
3. 运行（建议用 pm2 守护，或 nohup）：
   ```bash
   cd EnvLab-培训系统
   PORT=3000 node server/index.js
   # 推荐： npm i -g pm2 && pm2 start server/index.js --name envlab -- PORT=3000
   ```
4. 开放安全组 / 防火墙的 **3000** 端口（或反代到 Nginx 80/443）。
5. （可选，更稳）用 Nginx 反代 + 域名 + HTTPS：
   ```nginx
   server {
     listen 80; server_name train.你的域名.com;
     location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; }
   }
   ```
   域名需 ICP 备案（国内主机硬性要求）。

## 四、账号与权限
- **学员**：在首页登记（姓名 / 工号 / 机构）即注册；同工种号登录即同一账号。记录归属到该工号，多端共享。
- **管理员**（培训记录台）：姓名 `ENVLAB` / 工号 `001` / 部门 `001` / 手机 `001`。登录后可见全部学员与培训记录、可导出 CSV。

## 五、数据与安全
- 云端数据在 `server/db.json`（JSON 文件）。备份即复制该文件。
- 默认**学员账号无密码**（按工号识别，适合内网/受控环境）。若公网暴露，建议：
  - 必上 **HTTPS**；
  - 改 `server/index.js` 的 `SECRET` 环境变量（token 签名密钥）；
  - 给学员注册加密码或对接企业微信/钉钉鉴权（后端已留接口位置）。
- 生产建议设置环境变量：`ENVLAB_SECRET=一段随机串`、`PORT=3000`。

## 六、回退模式
未接入后端时（如 CloudStudio 静态托管），前端自动回退"本机浏览器(localStorage)"单设备模式，功能不受影响，仅记录不跨设备共享。所有页面均已做双模兼容。

## 七、验证接口
```bash
curl http://你的地址/api/health        # 应返回 {"ok":true,...}
```
