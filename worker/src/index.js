/**
 * 青萍 CGDN1 空气质量 Worker — v2
 *
 * 严格对照青萍 Open API 官方 Webhook 格式：
 *   body.signature  → HMAC-SHA256 签名验证
 *   body.payload.info.mac  → 设备 MAC
 *   body.payload.data[0]   → 传感器数据（每项为 {value: float}）
 *
 * CGDN1 上报字段（data[0] 内）：
 *   pm25 / pm10 / co2 / temperature / humidity / timestamp / battery
 *
 * 环境变量（通过 wrangler secret put 或 Dashboard 设置）：
 *   QINGPING_APP_SECRET  — 青萍开发者平台的 App Secret（用于验签）
 *   SERVERCHAN_KEY       — Server酱 key
 *   DINGTALK_WEBHOOK     — 钉钉机器人 Webhook URL
 *   BARK_KEY             — Bark iOS 推送 key
 *   ADMIN_SECRET         — 管理接口鉴权 secret
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ── HMAC-SHA256 验签（Web Crypto API）────────────────────────
async function verifySignature(sigObj, appSecret) {
  if (!appSecret) return true; // 未配置 secret 时跳过验签（开发阶段）
  if (!sigObj?.signature || !sigObj?.timestamp || !sigObj?.token) return false;

  const message = `${sigObj.timestamp}${sigObj.token}`;
  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  // 时间窗口检查（防止重放攻击，允许 ±5 分钟）
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - sigObj.timestamp);
  if (diff > 300) return false;

  return hex === sigObj.signature;
}

// ── 解析官方 Webhook payload ─────────────────────────────────
//
// 真实格式（来自青萍 Open API 文档）：
// {
//   "signature": { "signature": "...", "timestamp": 1594785322, "token": "..." },
//   "payload": {
//     "info":     { "mac": "582D344C046C", "product": { "id": 1101, "desc": "..." }, "name": "..." },
//     "metadata": { "data_type": "realtime" },
//     "data": [{
//       "timestamp":   { "value": 1594785339 },
//       "battery":     { "value": 65 },
//       "pm25":        { "value": 12 },
//       "pm10":        { "value": 18 },
//       "co2":         { "value": 650 },
//       "temperature": { "value": 24.5 },
//       "humidity":    { "value": 55.0 }
//     }]
//   }
// }
//
function parseOfficialPayload(body) {
  const pl = body?.payload;
  if (!pl) return null;

  // data 是数组，取最新一条
  const d = Array.isArray(pl.data) ? pl.data[pl.data.length - 1] : pl.data;
  if (!d) return null;

  return {
    // 传感器数据
    pm25: d.pm25?.value ?? null,
    pm10: d.pm10?.value ?? null,
    co2: d.co2?.value ?? null,
    temp: d.temperature?.value ?? null,
    humi: d.humidity?.value ?? null,

    // 元信息
    battery: d.battery?.value ?? null,
    deviceMac: pl.info?.mac ?? null,
    deviceName: pl.info?.name ?? null,
    productId: pl.info?.product?.id ?? null,
    dataType: pl.metadata?.data_type ?? 'realtime',

    // 设备原始时间戳（秒），若无则用当前时间
    deviceTs: d.timestamp?.value
      ? d.timestamp.value * 1000
      : Date.now(),
  };
}

// ── 格式 2：设备事件推送（body.payload.events）────────────────
// 从 events[0].data 中取传感器读数
function parseEventPayload(body) {
  const events = body?.payload?.events;
  if (!Array.isArray(events) || events.length === 0) return null;
  const d = events[0].data;
  const info = body.payload?.info;
  if (!d) return null;

  return {
    pm25: d.pm25?.value ?? null,
    pm10: d.pm10?.value ?? null,
    co2: d.co2?.value ?? null,
    temp: d.temperature?.value ?? null,
    humi: d.humidity?.value ?? null,
    battery: d.battery?.value ?? null,
    deviceMac: info?.mac ?? null,
    deviceName: info?.name ?? null,
    productId: info?.product?.id ?? null,
    dataType: 'event',
    deviceTs: d.timestamp?.value ? d.timestamp.value * 1000 : Date.now(),
    // 事件附加信息
    eventAlert: events[0].alert_config ?? null,
    eventStatus: events[0].status ?? null,
  };
}

// ── 告警阈值定义 ─────────────────────────────────────────────
const ALERT_DEFS = [
  { key: 'pm25', label: 'PM2.5', unit: 'µg/m³', envKey: 'PM25_THRESHOLD', defaultMax: 75 },
  { key: 'pm10', label: 'PM10', unit: 'µg/m³', envKey: 'PM10_THRESHOLD', defaultMax: 150 },
  { key: 'co2', label: 'CO₂', unit: 'ppm', envKey: 'CO2_THRESHOLD', defaultMax: 1500 },
  { key: 'temp', label: '温度', unit: '°C', envKey: 'TEMP_THRESHOLD', defaultMax: 32 },
];

// ── 推送报警 ─────────────────────────────────────────────────
async function sendAlert(record, env) {
  const warnings = [];
  for (const def of ALERT_DEFS) {
    const threshold = parseFloat(env[def.envKey] ?? def.defaultMax);
    if (record[def.key] != null && record[def.key] > threshold) {
      warnings.push(`${def.label} 超标：${record[def.key]} ${def.unit}`);
    }
  }
  if (!warnings.length) return;

  const title = '⚠️ 空气质量告警';
  const timeStr = new Date(record.ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const msg = warnings.join('\n');
  const fullMsg = `${msg}\n\n设备：${record.deviceName ?? record.deviceMac ?? '未知'}\n时间：${timeStr}`;

  // Server酱
  if (env.SERVERCHAN_KEY) {
    fetch(`https://sctapi.ftqq.com/${env.SERVERCHAN_KEY}.send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `title=${encodeURIComponent(title)}&desp=${encodeURIComponent(fullMsg)}`,
    }).catch(e => console.error('Server酱:', e.message));
  }

  // 钉钉
  if (env.DINGTALK_WEBHOOK) {
    fetch(env.DINGTALK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          title,
          text: `## ${title}\n${warnings.map(w => `- ${w}`).join('\n')}\n\n> 时间：${timeStr}`,
        },
      }),
    }).catch(e => console.error('钉钉:', e.message));
  }

  // Bark
  if (env.BARK_KEY) {
    const encoded = encodeURIComponent;
    fetch(`https://api.day.app/${env.BARK_KEY}/${encoded(title)}/${encoded(msg)}?sound=alarm&level=active`)
      .catch(e => console.error('Bark:', e.message));
  }
}

// ── 主路由 ───────────────────────────────────────────────────
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // ① 青萍 Webhook 接收（数据推送 + 事件推送统一入口）
    if (req.method === 'POST' && path === '/webhook') {
      let body;
      try { body = await req.json(); }
      catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }

      // 签名验证
      const valid = await verifySignature(body.signature, env.QINGPING_APP_SECRET);
      if (!valid) {
        console.warn('签名验证失败', JSON.stringify(body.signature));
        return jsonResponse({ error: 'Invalid signature' }, 401);
      }

      // 解析：优先数据推送，其次事件推送
      const parsed = parseOfficialPayload(body) ?? parseEventPayload(body);
      if (!parsed) {
        return jsonResponse({ error: 'Unrecognized payload', received: body }, 400);
      }

      const record = { ...parsed, ts: Date.now() };

      // 存最新值
      await env.AIR_DATA.put('latest', JSON.stringify(record));

      // 环形历史（默认 288 条 ≈ 5分钟/条 × 24h）
      const historyMax = parseInt(env.HISTORY_MAX ?? '288');
      const rawHist = await env.AIR_DATA.get('history');
      const history = rawHist ? JSON.parse(rawHist) : [];
      history.push(record);
      if (history.length > historyMax) history.splice(0, history.length - historyMax);
      await env.AIR_DATA.put('history', JSON.stringify(history));

      // 异步告警（不阻塞响应）
      ctx.waitUntil(sendAlert(record, env));

      return jsonResponse({ ok: true, ts: record.ts });
    }

    // ② 调试：写入模拟数据
    if (req.method === 'POST' && path === '/api/test') {
      const mock = {
        pm25: Math.round(Math.random() * 80),
        pm10: Math.round(Math.random() * 120),
        co2: Math.round(400 + Math.random() * 1200),
        temp: parseFloat((18 + Math.random() * 16).toFixed(1)),
        humi: parseFloat((30 + Math.random() * 50).toFixed(1)),
        battery: Math.round(40 + Math.random() * 60),
        deviceMac: 'TEST_DEVICE',
        deviceName: '青萍 CGDN1（模拟）',
        dataType: 'test',
        deviceTs: Date.now(),
        ts: Date.now(),
      };
      await env.AIR_DATA.put('latest', JSON.stringify(mock));
      const rawHist = await env.AIR_DATA.get('history');
      const history = rawHist ? JSON.parse(rawHist) : [];
      history.push(mock);
      if (history.length > 288) history.splice(0, history.length - 288);
      await env.AIR_DATA.put('history', JSON.stringify(history));
      return jsonResponse({ ok: true, data: mock });
    }

    // ③ 最新数据
    if (req.method === 'GET' && path === '/api/latest') {
      const data = await env.AIR_DATA.get('latest');
      return new Response(data ?? '{}', {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ④ 历史数据
    if (req.method === 'GET' && path === '/api/history') {
      const n = Math.min(parseInt(url.searchParams.get('n') ?? '48'), 288);
      const raw = await env.AIR_DATA.get('history');
      const all = raw ? JSON.parse(raw) : [];
      return jsonResponse(all.slice(-n));
    }

    // ⑤ 健康检查
    if (req.method === 'GET' && path === '/health') {
      return jsonResponse({ ok: true, time: new Date().toISOString(), device: 'Qingping CGDN1' });
    }

    // ⑥ 清空数据（需要 ?secret=xxx）
    if (req.method === 'DELETE' && path === '/api/history') {
      const secret = url.searchParams.get('secret');
      if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      await env.AIR_DATA.delete('history');
      await env.AIR_DATA.delete('latest');
      return jsonResponse({ ok: true, message: '数据已清空' });
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  },
};
