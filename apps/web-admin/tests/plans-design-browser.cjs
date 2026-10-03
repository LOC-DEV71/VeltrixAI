// UI acceptance with isolated API fixtures. No production/user configuration is written.
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), assert = require('node:assert/strict');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'creatorai-clone-browser-'));
  let browser, socket, closeBrowser, exited;
  try {
    browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    exited = new Promise(resolve => browser.once('exit', resolve));
    let port;
    for (let i = 0; i < 100; i++) { port = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => ''); if (port) break; await sleep(100); }
    assert.ok(port, 'Chrome startup failed');
    const [number, endpoint] = port.trim().split(/\r?\n/);
    socket = new WebSocket('ws://127.0.0.1:' + number + endpoint);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0; const pending = new Map();
    socket.onmessage = event => { const message = JSON.parse(event.data); const entry = pending.get(message.id); if (entry) { clearTimeout(entry.timer); pending.delete(message.id); if (message.error) entry.reject(new Error(entry.method + ': ' + message.error.message)); else entry.resolve(message.result); } };
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP_TIMEOUT_' + method)); }, 15000);
      pending.set(id, { resolve, reject, timer, method }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    closeBrowser = () => call('Browser.close');
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    await call('Page.enable', {}, sessionId);

    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},sessionId);assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result.value;};

    const {PLAN_FIELDS}=require('../../../apps/backend-api/dist/services/PlanSchema');
    const {seedConfig}=require('../../../apps/backend-api/dist/services/PlanService');
    const fixture=['FREE','BASIC_STUDENT','PLUS','PRO'].map((tier,i)=>({tier,revision:i+2,config:seedConfig(tier),updatedAt:'2026-10-0'+(i+1)+'T07:20:00Z'}));
    fixture[2].config.overview.popular=true;fixture[1].config.overview.active=false;
    fixture.forEach((p,i)=>{p.config.pricing.monthlyAvailable=true;p.config.pricing.yearlyAvailable=i>0;p.config.pricing.monthlyPrice=i*99000;p.config.pricing.yearlyPrice=i*990000;});
    await call('Page.addScriptToEvaluateOnNewDocument',{source:`
      window.fixturePlans=${JSON.stringify(fixture)};window.fixtureFields=${JSON.stringify(PLAN_FIELDS)};window.fixtureErrors=[];window.fixtureWrites=[];window.fixtureMode='normal';window.fixtureReadonly=false;
      window.addEventListener('error',e=>fixtureErrors.push(e.message));window.addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));
      window.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);const method=options.method||'GET';let data={},status=200;
        if(url.pathname==='/api/admin/auth/me')data={displayName:'Admin kiểm thử',email:'test@example.invalid',roleId:{name:fixtureReadonly?'VIEWER':'OWNER'},permissions:fixtureReadonly?['plans.read']:['*']};
        else if(url.pathname==='/api/admin/auth/csrf')data={csrfToken:'fixture-csrf'};
        else if(url.pathname==='/api/admin/billing/orders')data={items:[],total:0};
        else if(url.pathname==='/api/admin/plans/schema')data={fields:fixtureFields,tiers:['FREE','BASIC_STUDENT','PLUS','PRO']};
        else if(url.pathname==='/api/admin/plans'){await new Promise(r=>setTimeout(r,100));if(fixtureMode==='error')return new Response(JSON.stringify({error:{code:'PLAN_CONFIGURATION_UNAVAILABLE'}}),{status:503,headers:{'Content-Type':'application/json'}});data=fixtureMode==='empty'?[]:fixturePlans;}
        else if(url.pathname.endsWith('/history'))data={items:[{revision:3,action:'SAVE',changedBy:'Admin fixture',changedAt:'2026-10-04T07:20:00Z',reason:'Kiểm thử giao diện'}],total:1,page:1,limit:10};
        else if(url.pathname.endsWith('/preview')){const body=JSON.parse(options.body);const tier=url.pathname.split('/')[4];const plan=fixturePlans.find(p=>p.tier===tier);let config=body.config;if(body.action==='ARCHIVE'){config=structuredClone(plan.config);config.overview.active=false;}if(body.action==='ROLLBACK'){config=structuredClone(plan.config);config.credits.monthlyGrant=1000;}
          const diff=fixtureFields.flatMap(f=>{const before=plan.config[f.section][f.key],after=config[f.section][f.key];return JSON.stringify(before)===JSON.stringify(after)?[]:[{path:f.section+'.'+f.key,before,after,restrictive:typeof before==='boolean'&&before&&!after||typeof before==='number'&&typeof after==='number'&&after<before}];});data={diff,restrictive:diff.some(d=>d.restrictive),revision:plan.revision};fixtureWrites.push({path:url.pathname,method,body,csrf:options.headers?.['x-csrf-token']});}
        else if(method==='PUT'||method==='POST'){const body=JSON.parse(options.body);fixtureWrites.push({path:url.pathname,method,body,csrf:options.headers?.['x-csrf-token']});if(fixtureMode==='conflict')return new Response(JSON.stringify({error:{code:'PLAN_REVISION_CONFLICT'}}),{status:409,headers:{'Content-Type':'application/json'}});const plan=fixturePlans.find(p=>url.pathname.includes('/'+p.tier));if(body.config)plan.config=body.config;plan.revision++;data=plan;}
        else {status=404;data=null;}
        return new Response(JSON.stringify({success:status===200,data}),{status,headers:{'Content-Type':'application/json'}});
      };
    `},sessionId);
    await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1050,deviceScaleFactor:1,mobile:false},sessionId);
    await call('Page.navigate',{url:'http://localhost:5174/plans'},sessionId);await sleep(1400);
    const shot=async name=>{const image=await call('Page.captureScreenshot',{format:'png'},sessionId);const target=path.resolve(__dirname,'../../../.artifacts');await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'plans-design-'+name+'.png'),Buffer.from(image.data,'base64'));};
    const click=async expression=>{await evaluate(expression+'.click()');await sleep(250);};
    const button=text=>`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)}))`;
    let state=await evaluate(`({rows:document.querySelectorAll('.plans-stitch tbody tr.ant-table-row').length,text:document.querySelector('.plans-stitch').innerText,font:getComputedStyle(document.querySelector('.plans-stitch')).fontFamily,errors:fixtureErrors})`);
    assert.equal(state.rows,4);assert.ok(state.text.includes('75% khả dụng'));assert.ok(!state.text.includes('66.7%'));assert.ok(!state.text.includes('Enterprise'));assert.ok(state.font.includes('Be Vietnam Pro'));assert.deepEqual(state.errors,[]);await shot('list-desktop');
    await click(`document.querySelector('.plan-status-filter button[aria-pressed="false"]')`);assert.equal(await evaluate(`document.querySelectorAll('.plans-stitch tbody tr.ant-table-row').length`),3);
    await click(`document.querySelector('.plan-status-filter button')`);
    await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Tìm gói"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Pro');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(250);assert.equal(await evaluate(`document.querySelectorAll('.plans-stitch tbody tr.ant-table-row').length`),1);
    await click(button('Quản lý'));assert.equal(await evaluate(`document.querySelector('.plan-editor-heading').innerText.includes('PRO')`),true);
    await click(button('6. Nhân bản giọng'));await shot('clone-desktop');
    await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Giọng nhân bản tối đa mỗi người dùng"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'6');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await sleep(300);
    assert.ok((await evaluate(`document.querySelector('.plan-editor-heading').innerText`)).includes('thay đổi chưa lưu'));
    await click(button('4. Nội dung & AI'));assert.equal(await evaluate(`document.querySelectorAll('.plan-config-section').length`),6);await shot('content-desktop');
    await click(`document.querySelector('button[aria-label="Cho phép tạo lại (Regenerate)"]')`);
    await click(button('Kiểm duyệt thay đổi'));await sleep(400);await shot('review-desktop');
    state=await evaluate(`({text:document.querySelector('.review-modal').innerText,drawer:document.querySelectorAll('.stitch-plan-drawer').length,blocked:Array.from(document.querySelector('.review-modal').querySelectorAll('button')).find(b=>b.textContent.includes('Xác nhận & áp dụng')).disabled})`);
    assert.equal(state.drawer,0);assert.equal(state.blocked,true);assert.ok(state.text.includes('clone.maxVoices'));assert.ok(state.text.includes('regeneration.enabled'));assert.ok(state.text.includes('Giảm quyền lợi'));
    for(const width of [1280,768,390]){await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<700},sessionId);await sleep(250);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Review overflow '+width);await shot('review-'+width);}
    await click(button('Quay lại chỉnh sửa'));await sleep(250);assert.equal(await evaluate(`!!document.querySelector('.stitch-plan-drawer')`),true);
    await click(`document.querySelector('.ant-drawer-close')`);assert.ok((await evaluate(`document.querySelector('.ant-modal-confirm').innerText`)).includes('Hủy thay đổi chưa lưu'));
    await click(`document.querySelector('.ant-modal-confirm .ant-btn-default')`);assert.equal(await evaluate(`!!document.querySelector('.stitch-plan-drawer')`),true);
    await click(button('Kiểm duyệt thay đổi'));await sleep(250);
    await evaluate(`(()=>{const input=document.querySelector('#plan-change-reason');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Điều chỉnh hạn mức kiểm thử');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.plan-review-confirm input').click();})()`);await sleep(250);
    await click(button('Xác nhận & áp dụng'));await sleep(400);
    state=await evaluate(`fixtureWrites.filter(r=>r.method==='PUT')`);assert.equal(state.length,1);assert.equal(state[0].body.expectedRevision,5);assert.equal(state[0].body.confirmed,true);assert.equal(state[0].csrf,'fixture-csrf');assert.equal(state[0].body.config.clone.maxVoices,6);assert.equal(state[0].body.config.regeneration.enabled,false);
    assert.equal(await evaluate(`!!document.querySelector('.stitch-plan-drawer')`),false);
    for(const width of [1280,768,390]){await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<700},sessionId);await sleep(250);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'List overflow '+width);await shot('list-'+width);await click(button('Quản lý'));await click(button('6. Nhân bản giọng'));assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Editor overflow '+width);await shot('clone-'+width);await click(`document.querySelector('.ant-drawer-close')`);}
    await click(button('Quản lý'));
    for(const [label,names] of [['1. Tổng quan',['overview']],['2. Giá cả',['pricing']],['3. Credit',['credits']],['4. Nội dung & AI',['content','scenes','prompts','regeneration','history','storage']],['5. Giọng đọc (TTS)',['tts']],['6. Nhân bản giọng',['clone']],['7. Giới hạn',['limits']]]){await click(button(label));assert.equal(await evaluate(`document.querySelectorAll('.plan-field').length`),PLAN_FIELDS.filter(f=>names.includes(f.section)).length,label+' fields missing');}
    await click(button('8. Lịch sử cập nhật'));assert.equal(await evaluate(`document.querySelectorAll('.plan-config-section tbody tr.ant-table-row').length`),1);
    await click(button('Khôi phục bản trước'));assert.ok((await evaluate(`document.querySelector('.review-modal').innerText`)).includes('Xác nhận khôi phục phiên bản'));await click(button('Quay lại chỉnh sửa'));
    await click(button('Lưu trữ gói'));assert.ok((await evaluate(`document.querySelector('.review-modal').innerText`)).includes('Xác nhận lưu trữ gói'));await click(button('Quay lại chỉnh sửa'));
    await click(button('1. Tổng quan'));await evaluate(`(()=>{const input=document.querySelector('#plan-overview-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Pro kiểm thử');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(200);await click(button('Kiểm duyệt thay đổi'));
    await evaluate(`(()=>{window.fixtureMode='conflict';const input=document.querySelector('#plan-change-reason');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Kiểm tra xung đột phiên bản');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(200);await click(button('Xác nhận & áp dụng'));await sleep(250);assert.ok((await evaluate('document.body.innerText')).includes('quản trị viên khác cập nhật'));assert.equal(await evaluate(`!!document.querySelector('.review-modal')`),true);await click(button('Quay lại chỉnh sửa'));await click(`document.querySelector('.ant-drawer-close')`);await click(`document.querySelector('.ant-modal-confirm .ant-btn-primary')`);
    await evaluate(`window.fixtureMode='error'`);await click(button('Làm mới'));await sleep(300);assert.ok((await evaluate('document.body.innerText')).includes('Không thể tải cấu hình gói'));await evaluate(`window.fixtureMode='normal'`);await click(button('Thử lại'));await sleep(300);assert.equal(await evaluate(`document.querySelectorAll('.plans-stitch tbody tr.ant-table-row').length`),1);
    await evaluate(`window.fixtureMode='empty'`);await click(button('Làm mới'));await sleep(300);assert.ok((await evaluate('document.body.innerText')).includes('Không có gói phù hợp'));assert.deepEqual(await evaluate('fixtureErrors'),[]);
    // Verify read-only access in a new document without creating any real admin session.
    await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.fixtureReadonly=true;`},sessionId);await call('Page.reload',{},sessionId);await sleep(1400);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('.plans-stitch button')).some(b=>b.textContent.includes('Thêm gói'))`),false);await click(button('Xem gói'));await click(button('6. Nhân bản giọng'));assert.equal(await evaluate(`Array.from(document.querySelectorAll('.plan-field input,.plan-field button[role="switch"]')).every(input=>input.disabled)`),true);assert.equal(await evaluate(`document.body.innerText.includes('Kiểm duyệt thay đổi')`),false);assert.deepEqual(await evaluate('fixtureErrors'),[]);
    console.log('PLANS_DESIGN_OK: all schema fields, dynamic metrics/filters, clone/content edits, non-overlapping review, reason/confirmation/CSRF/revision save, rollback/archive preview, conflict preserves draft, unsaved guard, readonly, error retry, empty, desktop/tablet/mobile');
  } finally {
    if (closeBrowser) await closeBrowser().catch(() => {});
    socket?.close();
    if (browser && !browser.killed && browser.exitCode === null) await Promise.race([exited, sleep(3000)]);
    if (browser?.exitCode === null) browser.kill();
    // Delete only the unique, owned test profile inside the system temp directory.
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('creatorai-clone-browser-'));
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }).catch(() => {});
  }
}
run().catch(error => { console.error('PLANS_DESIGN_FAILED: ' + error.message); process.exitCode = 1; });
