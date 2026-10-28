import fs from 'node:fs';
import path from 'node:path';
const out = path.resolve('docs/focus-space-previews');
fs.mkdirSync(out, { recursive: true });
const pause = ms => new Promise(r => setTimeout(r, ms));
async function connect() {
  const target = await (await fetch('http://127.0.0.1:9223/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id) { const item = pending.get(msg.id); if (item) { clearTimeout(item.timeout); pending.delete(msg.id); msg.error ? item.reject(new Error(JSON.stringify(msg.error))) : item.resolve(msg.result); } }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id; const timeout = setTimeout(() => { pending.delete(next); reject(new Error(`Timeout ${method}`)); }, 30000);
    pending.set(next, { resolve, reject, timeout }); ws.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async expression => { for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await pause(300); } throw new Error(`Not ready: ${expression}\n${await evaluate('document.body.innerText.slice(-2000)')}`); };
  const click = label => evaluate(`(() => { const element = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}); if(!element) throw new Error('Missing button ${label}'); element.click(); return true; })()`);
  const fill = async (label, text) => { await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}); if(!el) throw new Error('Missing input'); el.focus(); el.select(); })()`); await send('Input.insertText', { text }); };
  const capture = async name => { const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(out, name), Buffer.from(result.data, 'base64')); };
  return { ws, send, evaluate, wait, click, fill, capture, errors, targetId: target.id };
}
function fixture(userId) {
  const user = { id: userId, email: 'preview@example.test', display_name: 'Lunaria', role: 'user', level: 2, xp: 420, coins: 100, gems: 5, avatar_theme: 'aqua', pet: 'dolphin', pet_name: 'Aqua', onboarded: true, daily_tasks_selected: true };
  const stats = { timezone: 'Asia/Bangkok', today_seconds: 4500, today_sessions: 3, week_seconds: 18000, month_seconds: 48600, seconds: 18000, completed: 12, started: 14, completion_rate: 12/14, rate_completed: 12, cancelled: 1, in_progress: 1, average_daily_seconds: 3600, daily_goal_minutes: 120, goal_progress: .625, current_streak: 5, longest_streak: 12, hours: [{ hour: 19, started: 5, completed: 4 }, { hour: 20, started: 7, completed: 6 }], days: [1800,2700,4500,0,4500,2700,1800].map((seconds,index)=>({date:`2026-10-${19+index}`,seconds,completed:seconds/900,started:seconds/900})) };
  return `(() => {
    if (!sessionStorage.getItem('preview-ready-${userId}')) { localStorage.removeItem('mirabi.pomodoro.v1:${userId}'); sessionStorage.setItem('preview-ready-${userId}', 'yes'); }
    sessionStorage.setItem('refmi.session.v1', JSON.stringify({ accessToken: 'local-ui-preview', refreshToken: 'local-ui-preview-refresh' }));
    const user = ${JSON.stringify(user)}; const stats = ${JSON.stringify(stats)};
    const prefs = { timezone:'Asia/Bangkok',daily_goal_minutes:120,focus_minutes:25,short_break_minutes:5,long_break_minutes:15,long_break_every:4 };
    const original = window.fetch.bind(window);
    window.fetch = async (url, init={}) => {
      const pathname = new URL(typeof url==='string'?url:url.url, location.href).pathname;
      if(!pathname.startsWith('/api/')) return original(url,init);
      let result = [];
      if(pathname==='/api/auth/me'||pathname==='/api/profile') result=user;
      if(pathname==='/api/dashboard') result={user,study:{total_minutes:75,today_sessions:3,daily_goal:3},daily_quests:[],scheduled_tasks:[],pet_walk:'rested'};
      if(pathname==='/api/study/pomodoro-settings') result=init.method==='PUT'?JSON.parse(init.body):prefs;
      if(pathname==='/api/study/pomodoro-statistics') result=stats;
      if(pathname==='/api/study/pomodoro-insights') result={sufficient_data:true,message:'Bạn đã hoàn thành 12 phiên trong tuần này. Các phiên 25 phút thường được hoàn thành vào buổi tối. Hãy giữ nhịp học vừa sức.',suggested_minutes:25};
      if(pathname==='/api/ai/study/tutor') result={answer:'1. Xác định ý chính của đoạn văn. 2. Ghi lại những dữ kiện quan trọng. 3. Ôn tập bằng cách tự giải thích lại.'};
      if(pathname.startsWith('/api/study/pomodoro/')) result={status:JSON.parse(init.body).event,statistics:stats,xp_awarded:0};
      return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
    };
  })();`;
}
const oldPages = await (await fetch('http://127.0.0.1:9223/json/list')).json();
for (const page of oldPages.filter(p=>p.type==='page' && p.url.startsWith('http://localhost:8081'))) await fetch(`http://127.0.0.1:9223/json/close/${page.id}`);
const results = [];
for (const device of [{ name: 'phone-preview', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }, { name: 'narrow', width: 320, height: 780 }]) {
  const c = await connect();
  try {
    await c.send('Page.enable'); await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: device.width, height: device.height, deviceScaleFactor: 1, mobile: device.name !== 'desktop' });
    await c.send('Emulation.setEmulatedMedia', { features: [{ name:'prefers-reduced-motion', value:'reduce' }] });
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: fixture(760000 + device.width) });
    await c.send('Page.navigate', { url: 'http://localhost:8081' });
    await c.wait(`!!document.querySelector('[role="tab"][aria-label="Học tập"]')`);
    await c.evaluate(`document.querySelector('[role="tab"][aria-label="Học tập"]').click()`);
    await c.wait(`!!document.querySelector('[data-testid="mirabi-focus-space"]')`);
    await c.wait(`document.body.innerText.includes('75 phút')`); await pause(500);
    await c.capture(`${device.name}-focus.png`);
    const dimensions = await c.evaluate(`({viewport:innerWidth,page:document.documentElement.scrollWidth,space:document.querySelector('[data-testid="mirabi-focus-space"]').getBoundingClientRect().toJSON(),timer:document.querySelector('[aria-label="Còn lại 25:00"]')?.getBoundingClientRect().toJSON()})`);
    if (device.name==='phone-preview' && dimensions.space.width > 430) throw new Error('App preview escaped phone layout');
    if (dimensions.page > device.width) throw new Error(`Horizontal overflow: ${JSON.stringify(dimensions)}`);
    const toolsVisible = await c.evaluate(`(() => {
      const tool = document.querySelector('[aria-label="Ghi chú học tập"]').getBoundingClientRect();
      const nav = document.querySelector('[role="tab"][aria-label="Học tập"]').getBoundingClientRect();
      return tool.top >= 0 && tool.bottom <= nav.top;
    })()`);
    if (!toolsVisible) throw new Error(`Study toolbar is below the visible app area: ${device.name}`);

      await c.click('AI tóm tắt'); await c.wait(`!!document.querySelector('[data-testid="focus-bottom-sheet"]')`); await pause(300);
      await c.capture(`${device.name}-tool-sheet.png`);
      await c.fill('Văn bản cần tóm tắt','Cây xanh dùng ánh sáng để tạo năng lượng.');
      await c.click('Tóm tắt nội dung');
      await c.wait(`document.body.innerText.includes('Xác định ý chính')`);
      await c.capture(`${device.name}-summary-result.png`);
      const sheetWidth = await c.evaluate(`document.querySelector('[data-testid="focus-bottom-sheet"]').getBoundingClientRect().width`);
      if(sheetWidth>device.width) throw new Error('Bottom sheet overflows');
      await c.click('Đóng công cụ');
      await c.click('Mở thống kê học tập'); await c.wait(`document.body.innerText.includes('Hành trình tập trung')`); await pause(250);
      await c.capture(`${device.name}-statistics.png`);
    results.push({device:device.name,dimensions,checks: {
      noHorizontalOverflow: true,
      toolbarVisibleWithoutScrolling: true,
      responsivePanel: true,
      summaryResultRendered: true, statisticsSheetRendered: true,
    },errors:c.errors});
    console.log(JSON.stringify({device:device.name,passed:true,errors:c.errors.length}));
  } finally { c.ws.close(); await fetch(`http://127.0.0.1:9223/json/close/${c.targetId}`); }
}
fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify(results,null,2));
