# 青萍 CGDN1 空气质量监测系统

> **零服务器成本**，将青萍 CGDN1 的 PM2.5 / PM10 / CO₂ / 温度 / 湿度数据实时推送并展示——完全运行在 Cloudflare 免费层，无需自建服务器。

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

<p align="center">
  <img
    src="https://github.com/user-attachments/assets/f7a35091-ba34-40a5-a66d-9bbaae5d4293"
    alt="青萍 CGDN1 仪表盘预览"
  />
</p>

---

## ✨ 特色功能

| 功能 | 说明 |
|------|------|
| 🌐 **零服务器** | 全栈运行在 Cloudflare Workers + KV + Pages，免费层足够 1 台设备 24 小时运行 |
| 🔐 **HMAC-SHA256 验签** | 严格验证青萍平台签名，防止伪造数据写入，支持重放攻击防护 |
| 📊 **实时仪表盘** | 深色玻璃态 UI，五项指标卡片 + 颜色编码等级 + 历史趋势折线图 |
| 🔔 **多渠道告警** | 超标自动推送：Server酱（微信）/ 钉钉机器人 / Bark（iOS） |
| ⏱️ **自动刷新** | 前端每 30 秒拉取最新数据，历史保留最近 24 小时（288 条） |
| 🔧 **可调阈值** | 告警阈值通过环境变量覆盖，无需改代码重部署 |

---

## ⚡ 快速部署（5 步）

```bash
# 1. 创建 KV 并把 id 填入 wrangler.toml
cd worker && npx wrangler kv:namespace create AIR_DATA

# 2. 部署 Worker，拿到 Worker URL
npx wrangler deploy

# 3. 配置青萍 App Secret（权限管理 → 权限申请页面获取）
npx wrangler secret put QINGPING_APP_SECRET

# 4. 把 Worker URL 填入 frontend/index.html 第一行 WORKER_URL，然后 push 到 GitHub
#    → Cloudflare Pages 连接 GitHub 仓库，输出目录填 frontend，自动部署

# 5. 青萍开发者平台 → 权限管理 → 数据推送设置 → 填写 Webhook 地址
#    https://你的Worker地址/webhook
```

> 首次部署约需 10 分钟。完成后等设备下次上报（默认 1 小时，可用 Open API 改为 10 分钟）即可看到数据。

---


## 目录

1. [项目结构](#项目结构)
2. [部署步骤](#部署步骤)
3. [设置设备上报频率](#设置设备上报频率open-api)
4. [配置青萍 Webhook](#配置青萍-webhook)
5. [API 接口说明](#api-接口说明)
6. [Webhook 数据格式](#webhook-数据格式)
7. [告警推送配置](#告警推送配置)
8. [Cloudflare 免费配额用量](#cloudflare-免费配额用量)
9. [常见问题排查](#常见问题排查)

---

## 项目结构

```
qingping/
├── README.md
├── worker/
│   ├── wrangler.toml          ← Worker 配置（KV 绑定、阈值变量）
│   ├── package.json
│   └── src/
│       └── index.js           ← Worker 后端主逻辑
└── frontend/
    └── index.html             ← 单文件前端，部署到 Cloudflare Pages
```

---

## 部署步骤

### 前提条件

- Node.js 18+（用于运行 Wrangler）
- Cloudflare 账号（免费即可）
- 青萍开发者平台账号：[developer.qingping.co](https://developer.qingping.co)

### 第一步：安装 Wrangler 并登录

```bash
npm install -g wrangler
wrangler login
```

### 第二步：创建 KV 命名空间

```bash
cd worker
npx wrangler kv:namespace create AIR_DATA
```

把输出的 `id` 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "AIR_DATA"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"   # ← 替换为实际 ID
```

### 第三步：部署 Worker

```bash
cd worker
npm install
npx wrangler deploy
```

部署成功后获得 Worker 地址，例如：
```
https://air-quality-worker.xxx.workers.dev
```

可绑定自定义域名（如 `air-quality-worker.lucius7.dev`）：在 Cloudflare Dashboard → Workers → 当前 Worker → Settings → Domains & Routes 添加。

### 第四步：配置签名密钥和告警

在青萍开发者平台的**权限管理 → 权限申请**页面找到 App Secret，然后：

```bash
# 必填：青萍 App Secret（用于验证 Webhook 签名）
npx wrangler secret put QINGPING_APP_SECRET

# 可选：告警推送渠道（三选一或叠加）
npx wrangler secret put SERVERCHAN_KEY     # Server酱（微信）
npx wrangler secret put DINGTALK_WEBHOOK   # 钉钉群机器人 Webhook URL
npx wrangler secret put BARK_KEY           # Bark iOS 推送

# 可选：管理接口鉴权（用于 DELETE /api/history）
npx wrangler secret put ADMIN_SECRET
```

> ⚠️ **注意**：`QINGPING_APP_SECRET` 必须填写，否则 Webhook 会返回 401 拒绝青萍平台的推送。

### 第五步：修改前端 Worker 地址

打开 `frontend/index.html`，找到第一行配置并替换：

```js
const WORKER_URL = 'https://air-quality-worker.xxx.workers.dev'; // ← 改为你的 Worker 地址
```

### 第六步：部署前端到 Cloudflare Pages

1. 将整个 `qingping/` 目录推送到 GitHub
2. 在 Cloudflare Dashboard → Pages → 创建项目 → 连接 GitHub 仓库
3. 配置如下：
   - **框架预设**：无
   - **构建命令**：（留空）
   - **输出目录**：`frontend`
4. 保存部署，获得 Pages 地址（可绑定自定义域名）

---

## 设置设备上报频率（Open API）

> 青萍平台界面没有上报频率设置，需要通过 Open API 调用修改。

**默认上报间隔为 3600 秒（1 小时），建议改为 300 秒（5 分钟）。**

所需信息（在青萍平台**权限管理 → 权限申请**页面获取）：
- App Key（如 `6FO_ePOvg`）
- App Secret（如 `0ae7f78c...`）
- 设备 MAC（如 `CCB5D131CE1D`，在**私有化 → 下发私有配置**页面查看）

### PowerShell 一键执行

```powershell
# === 填入你的信息 ===
$appKey    = "你的AppKey"
$appSecret = "你的AppSecret"
$deviceMac = "你的设备MAC"
# ====================

# Step 1: 获取 OAuth Token（必须用 Basic Auth）
$authBase64 = [Convert]::ToBase64String(
  [System.Text.Encoding]::UTF8.GetBytes("${appKey}:${appSecret}")
)
$r = Invoke-RestMethod -Method POST `
  -Uri "https://oauth.cleargrass.com/oauth2/token" `
  -Headers @{ Authorization = "Basic $authBase64" } `
  -ContentType "application/x-www-form-urlencoded" `
  -Body "grant_type=client_credentials&scope=device_full_access"
$token = $r.access_token
Write-Host "✅ Token 获取成功"

# Step 2: 设置上报间隔（timestamp 必须是 13 位毫秒时间戳）
$body = @{
  mac              = @($deviceMac)
  report_interval  = 600   # 上报周期：秒（最小 60，当前设为 10 分钟）
  collect_interval = 60    # 采集周期：秒
  timestamp        = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
} | ConvertTo-Json

Invoke-RestMethod -Method PUT `
  -Uri "https://apis.cleargrass.com/v1/apis/devices/settings" `
  -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } `
  -Body $body

Write-Host "✅ 上报间隔已设为 5 分钟"
```

> **重要**：  
> - Token 请求必须在 Header 中使用 `Authorization: Basic Base64(AppKey:AppSecret)`，不能放在 Body 里  
> - `timestamp` 必须是 **13 位毫秒时间戳**，且在请求时间 20 秒内有效

---

## 配置青萍 Webhook

### 配置路径

青萍开发者平台 → **权限管理 → 数据推送设置 → Webhook 设置**

### 填写地址

| 类型 | 地址 |
|------|------|
| 设备数据接收地址 | `https://你的Worker地址/webhook` |
| 设备事件接收地址 | `https://你的Worker地址/webhook`（同一个接口同时处理） |

### 平台推送规则

- 响应时间：**3 秒内必须返回 200**
- 失败重试：5、15、30 分钟后各重试一次，共 3 次
- 熔断机制：超时率超 50% 触发熔断，暂停 10 分钟

---

## API 接口说明

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/webhook` | 接收青萍设备推送（含签名验证） |
| `GET`  | `/api/latest` | 获取最新一条数据 |
| `GET`  | `/api/history?n=48` | 获取最近 n 条历史（默认 48，最大 288） |
| `POST` | `/api/test` | 写入随机模拟数据（调试用） |
| `GET`  | `/health` | Worker 健康检查 |
| `DELETE` | `/api/history?secret=xxx` | 清空全部数据（需要 ADMIN_SECRET） |

---

## Webhook 数据格式

Worker 自动识别青萍官方格式，字段路径如下：

```
body
├── signature
│   ├── signature   HMAC-SHA256 签名（用 App Secret 验证）
│   ├── timestamp   Unix 时间戳（秒）
│   └── token       随机字符串
└── payload
    ├── info
    │   ├── mac     设备 MAC 地址
    │   └── name    设备名称
    ├── metadata
    │   └── data_type   "realtime" 或 "history"
    └── data[]          数组，取最后一条
        ├── pm25        { value: float }
        ├── pm10        { value: float }
        ├── co2         { value: float }
        ├── temperature { value: float }
        ├── humidity    { value: float }
        ├── battery     { value: float }
        └── timestamp   { value: int }  ← Unix 秒
```

### 签名验证逻辑

```
HMAC-SHA256( timestamp + token, AppSecret ) == signature
```

Worker 同时检查时间窗口（±5 分钟），防止重放攻击。未设置 `QINGPING_APP_SECRET` 时自动跳过验签（开发调试用）。

---

## 告警推送配置

### 默认告警阈值

| 指标 | 默认阈值 | 自定义环境变量 |
|------|---------|--------------|
| PM2.5 | > 75 µg/m³ | `PM25_THRESHOLD` |
| PM10  | > 150 µg/m³ | `PM10_THRESHOLD` |
| CO₂   | > 1500 ppm | `CO2_THRESHOLD` |
| 温度  | > 32 °C | `TEMP_THRESHOLD` |

在 `wrangler.toml` 的 `[vars]` 中修改，无需重新 deploy secrets。

### 推送渠道

| 渠道 | Secret 名称 | 说明 |
|------|------------|------|
| Server酱 | `SERVERCHAN_KEY` | 推送到微信，[sct.ftqq.com](https://sct.ftqq.com) 获取 |
| 钉钉机器人 | `DINGTALK_WEBHOOK` | 钉钉群机器人的完整 Webhook URL |
| Bark | `BARK_KEY` | iOS 原生推送，Bark App 内获取 key |

---

## Cloudflare 免费配额用量

> 假设：1 个前端标签页常开（30 秒自动刷新）；每次 Webhook 消耗 **2 次 KV 写入**（latest + history）

### 不同上报间隔对比

| 上报间隔 | 每天 Webhook | KV 写入/天 | 写入占比 | 最多可接入设备 | 历史数据覆盖（288条） |
|---------|------------|-----------|---------|-------------|------------------|
| 1 分钟  | 1,440 次   | 2,880 次  | 288% ❌ 超额 | 0 台        | 4.8 小时         |
| 5 分钟  | 288 次     | 576 次    | **57.6%** ⚠️ | 1 台        | 24 小时（1 天）  |
| **10 分钟** ← 当前 | **144 次** | **288 次** | **28.8%** ✅ | **3 台** | **48 小时（2 天）** |
| 15 分钟 | 96 次      | 192 次    | 19.2% ✅ | 5 台        | 3 天             |
| 30 分钟 | 48 次      | 96 次     | 9.6% ✅  | 10 台       | 6 天             |
| 60 分钟 | 24 次      | 48 次     | 4.8% ✅  | 20 台       | 12 天            |

> **KV 写入免费限额：1,000 次/天**  
> **最多可接入设备 = ⌊1,000 ÷ (KV写入/天/台)⌋**  
> 历史条数上限固定 288 条，间隔越长覆盖时间越久

### 当前配置（10 分钟）的一天用量

| 资源 | 每天用量 | 免费限额 | 使用率 |
|------|---------|---------|--------|
| Worker 请求 | ~3,024 次 | 100,000 次 | **3%** ✅ |
| KV 写入 | ~288 次 | 1,000 次 | **28.8%** ✅ |
| KV 读取 | ~3,024 次 | 100,000 次 | **3%** ✅ |
| KV 存储 | ~86 KB | 1 GB | **0.01%** ✅ |

> 10 分钟间隔是**精度与配额的最佳平衡点**：保留 2 天历史、支持最多 3 台设备，且 KV 写入有充足余量。

### 如何修改上报间隔

参考本文档 [设置设备上报频率](#设置设备上报频率open-api) 章节，修改脚本中的 `report_interval` 值即可：

```powershell
report_interval = 600   # 10 分钟
# report_interval = 300   # 5 分钟（精度更高，仅支持 1 台设备）
# report_interval = 900   # 15 分钟（可接 5 台设备）
```


---

## 常见问题排查

### Webhook 返回 401

`QINGPING_APP_SECRET` 与青萍平台的 App Secret 不匹配。

```bash
npx wrangler secret put QINGPING_APP_SECRET
# 输入青萍平台「权限管理 → 权限申请」页面显示的 App Secret
```

### 前端显示"数据获取失败"

检查 `frontend/index.html` 中的 `WORKER_URL` 是否与实际部署地址一致：

```js
const WORKER_URL = 'https://你的Worker地址';
```

修改后需要重新 push 触发 Pages 重新部署。

### 数据迟迟不更新

1. 用 `wrangler tail` 查看 Worker 实时日志，确认是否有请求进来
2. 检查设备是否连接 Wi-Fi 并绑定到青萍开发者账号
3. 用 API 确认上报间隔是否已改短：当前默认 1 小时，建议改为 5 分钟（见上方 Open API 部分）

### 本地调试

```bash
cd worker
npx wrangler dev

# 另开终端写入模拟数据
curl -X POST http://localhost:8787/api/test

# 查看最新数据
curl http://localhost:8787/api/latest
```

### 实时监控 Worker 日志

```bash
cd worker
npx wrangler tail
```

青萍每次推送时会输出 `POST /webhook 200 OK`，可以实时确认数据是否到达。
