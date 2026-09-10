// 前端 API 基地址配置
// - 空字符串 "" 表示无后端：前端自动回退到本机浏览器(localStorage) 单设备模式
// - 后端同源托管时由后端自动注入 window.API_BASE="/api"（见 server/index.js 注入占位符 <!--API_BASE-->）
// - 也可临时用 ?api=https://你的后端地址 覆盖（便于跨域测试，后端已开 CORS）
window.API_BASE = window.API_BASE || "";
