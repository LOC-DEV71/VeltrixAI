// Verify the real admin UI using a temporary OWNER session; preview only, no plan changes.
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), assert = require('node:assert/strict');
require('../../../apps/backend-api/node_modules/dotenv').config({path:path.resolve(__dirname,'../../../apps/backend-api/.env'),quiet:true});
const mongoose=require('../../../apps/backend-api/node_modules/mongoose');const {AdminAccount}=require('../../../apps/backend-api/dist/models/AdminAccount');const {AdminSession}=require('../../../apps/backend-api/dist/models/AdminSession');const {AdminRole}=require('../../../apps/backend-api/dist/models/AdminRole');const {signAccessToken}=require('../../../apps/backend-api/dist/utils/jwt');let owner;
const origin=process.env.ADMIN_TEST_ORIGIN||'http://localhost:5174',apiOrigin=process.env.ADMIN_TEST_API_ORIGIN||'http://localhost:3001';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000});
  const password=require('crypto').randomUUID();
  const {hashSecret}=require('../../../apps/backend-api/dist/utils/crypto');
  const role=await AdminRole.findOne({name:'OWNER'});assert.ok(role,'Owner role must be seeded before acceptance test');owner=await AdminAccount.create({email:require('crypto').randomUUID()+'@example.invalid',displayName:'UI acceptance',passwordHash:hashSecret(password),roleId:role._id,status:'ACTIVE'});
  const login=await AdminSession.create({adminId:owner._id,tokenFamily:require('crypto').randomUUID(),refreshTokenHash:require('crypto').randomUUID(),expiresAt:new Date(Date.now()+600000)});
  const token=signAccessToken({sessionId:login._id});

  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'creatorai-clone-browser-'));
  let browser, socket, closeBrowser, exited;
  try {
  const probe=await fetch(apiOrigin+'/api/admin/auth/me',{headers:{Cookie:'adminAccessToken='+token}}); const probeBody=await probe.json(); assert.equal(probe.status,200,probeBody.error?.code||'Admin session authentication failed');
    browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    exited = new Promise(resolve => browser.once('exit', resolve));
    let port;
    for (let i = 0; i < 100; i++) { port = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => ''); if (port) break; await sleep(100); }
    assert.ok(port, 'Chrome startup failed');
    const [number, endpoint] = port.trim().split(/\r?\n/);
    socket = new WebSocket('ws://127.0.0.1:' + number + endpoint);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0; const pending = new Map();
    socket.onmessage = event => { const message = JSON.parse(event.data); const entry = pending.get(message.id); if (entry) { clearTimeout(entry.timer); pending.delete(message.id); if(message.error) entry.reject(new Error(entry.method + ': ' + message.error.message)); else entry.resolve(message.result); } };
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP_TIMEOUT_' + method)); }, 15000);
      pending.set(id, { resolve, reject, timer, method }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    closeBrowser = () => call('Browser.close');
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    await call('Page.enable', {}, sessionId);
    await call('Network.setCookie',{name:'adminAccessToken',value:token,url:origin,httpOnly:true,sameSite:'Lax'},sessionId);
    // Authenticate with the separate admin cookie used by the real backend.
    await call('Page.navigate', { url: origin+'/' }, sessionId);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      const state = await call('Runtime.evaluate', { returnByValue: true, expression: 'location.origin === '+JSON.stringify(origin)+' && location.pathname === "/" && document.readyState === "complete"' }, sessionId).catch(error => {
        if (/navigated|context.*destroyed/i.test(error.message)) return null;
        throw error;
      });
      if (state?.result?.value === true) { ready = true; break; } await sleep(100);
    }
    assert.ok(ready, 'Local frontend did not finish loading');
    await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const shot = async name => { const result = await call('Page.captureScreenshot', { format: 'png' }, sessionId); await fs.mkdir(path.resolve(__dirname, '../../../services/tts/.runtime'), { recursive: true }); await fs.writeFile(path.resolve(__dirname, '../../../services/tts/.runtime/admin-ui-' + name + '.png'), Buffer.from(result.data, 'base64')); };
    await sleep(1400); await shot('dashboard');
    await call('Runtime.evaluate',{expression:`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.includes('Gói & quyền lợi')).click()`},sessionId); await sleep(900); await shot('plans');
    const evaluation=await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<60&&!document.querySelectorAll('button').length;i++)await wait(100);
      for(let i=0;i<60&&!Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Quản lý');i++)await wait(100);
      const rows=document.querySelectorAll('tbody tr.ant-table-row').length;
      Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Quản lý').click();await wait(300);
      const tab=name=>Array.from(document.querySelectorAll('.plan-editor-nav button')).find(el=>el.textContent.includes(name));
      tab('Nội dung & AI').click();await wait(200);const cards=Array.from(document.querySelectorAll('.plan-config-section h3')).map(el=>el.querySelector('strong')?.textContent||el.textContent).filter(v=>['Viết nội dung','Tách phân cảnh','Tạo Prompt','Tạo lại','Lịch sử phiên bản','Dự án và Lưu trữ'].includes(v));
      tab('Giọng đọc (TTS)').click();await wait(200);Array.from(document.querySelectorAll('.setting')).find(el=>el.textContent.startsWith('Chuyển văn bản thành giọng nói (TTS)')).querySelector('button').click();await wait(100);
      Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Kiểm duyệt thay đổi')).click();for(let i=0;i<100&&!document.querySelector('.review-modal');i++)await wait(100);
      const modal=document.querySelector('.review-modal');const diff=modal?.textContent.includes('tts.enabled');const restrictive=modal?.textContent.includes('Giảm quyền lợi');const confirmBlocked=Array.from(modal?.querySelectorAll('button')||[]).find(b=>b.textContent.replace(/\\s/g,'')==='Xácnhận&ápdụng')?.disabled;
      return {rows,cards,diff,restrictive,confirmBlocked};
    })()`},sessionId);
    assert.equal(evaluation.exceptionDetails,undefined,'Browser interaction failed');const result=evaluation.result.value;
    assert.ok(result.rows>=1);assert.equal(result.cards.length,6);assert.equal(result.diff,true);assert.equal(result.restrictive,true);assert.equal(result.confirmBlocked,true);
    const planPath=await call('Runtime.evaluate',{returnByValue:true,expression:'location.pathname'},sessionId);assert.equal(planPath.result.value,'/plans');
    await shot('review');
    await call('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true},sessionId);await sleep(300);
    const mobile=await call('Runtime.evaluate',{returnByValue:true,expression:'document.documentElement.scrollWidth <= innerWidth'},sessionId);assert.equal(mobile.result.value,true);
    await shot('mobile-review');
    await call('Runtime.evaluate',{expression:`(async()=>{document.querySelector('.review-modal .ant-modal-close').click();await new Promise(r=>setTimeout(r,150));document.querySelector('.ant-drawer-close').click();})()`},sessionId);await sleep(250);
    const discardModal=await call('Runtime.evaluate',{returnByValue:true,expression:`document.querySelector('.ant-modal-confirm')?.textContent.includes('Hủy thay đổi chưa lưu?')`},sessionId);assert.equal(discardModal.result.value,true);
    await call('Runtime.evaluate',{expression:`document.querySelector('.ant-modal-confirm .ant-btn-default').click()`},sessionId);await sleep(250);
    const draftKept=await call('Runtime.evaluate',{returnByValue:true,expression:`!!document.querySelector('.plan-editor-layout')&&location.pathname==='/plans'`},sessionId);assert.equal(draftKept.result.value,true);
    await call('Runtime.evaluate',{expression:`Array.from(document.querySelectorAll('.setting')).find(el=>el.textContent.startsWith('Chuyển văn bản thành giọng nói (TTS)')).querySelector('button').click()`},sessionId);await sleep(250);
    await call('Runtime.evaluate',{expression:`document.querySelector('.ant-drawer-close').click()`},sessionId);await sleep(350);
    await call('Runtime.evaluate',{expression:`document.querySelector('[aria-label="Mở menu"]').click()`},sessionId);await sleep(250);
    const menu=await call('Runtime.evaluate',{returnByValue:true,expression:`document.querySelector('.admin-sidebar').classList.contains('is-open')`},sessionId);assert.equal(menu.result.value,true);
    await call('Runtime.evaluate',{expression:`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.includes('Người dùng')).click()`},sessionId);await sleep(700);await shot('mobile-users');
    const usersMobile=await call('Runtime.evaluate',{returnByValue:true,expression:'document.documentElement.scrollWidth <= innerWidth'},sessionId);assert.equal(usersMobile.result.value,true);
    await call('Runtime.evaluate',{expression:`document.querySelector('[aria-label="Mở menu"]').click();Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.includes('Thư viện giọng')).click()`},sessionId);await sleep(900);await shot('mobile-voices');
    const voiceMobile=await call('Runtime.evaluate',{returnByValue:true,expression:'document.documentElement.scrollWidth <= innerWidth'},sessionId);assert.equal(voiceMobile.result.value,true);
    const voicePath=await call('Runtime.evaluate',{returnByValue:true,expression:'location.pathname'},sessionId);assert.equal(voicePath.result.value,'/voices');
    await call('Page.reload',{},sessionId);await sleep(1400);
    const reloaded=await call('Runtime.evaluate',{returnByValue:true,expression:`location.pathname==='/voices'&&!!document.querySelector('.voices-admin')`},sessionId);assert.equal(reloaded.result.value,true);
    await call('Runtime.evaluate',{expression:'history.back()'},sessionId);await sleep(800);
    const back=await call('Runtime.evaluate',{returnByValue:true,expression:'location.pathname'},sessionId);assert.equal(back.result.value,'/users');
    await call('Runtime.evaluate',{expression:'history.forward()'},sessionId);await sleep(800);
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);await sleep(250);await shot('voices');
    const voiceCheck=await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,userGesture:true,expression:`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<50&&!document.querySelector('.voices-admin audio');i++)await wait(100);
      const rows=document.querySelectorAll('.voices-admin tbody tr.ant-table-row').length;const audio=document.querySelector('.voices-admin audio');if(!audio)throw Error('NO_PREVIEW');
      const response=await fetch(audio.src),bytes=new Uint8Array(await response.arrayBuffer());audio.load();for(let i=0;i<50&&!Number.isFinite(audio.duration);i++)await wait(100);
      const duration=audio.duration;await audio.play();await wait(200);const playable=!audio.paused&&audio.currentTime>0;audio.pause();
      Array.from(document.querySelectorAll('.voices-admin button')).find(b=>b.textContent==='Quản lý').click();await wait(300);
      const details=document.querySelector('.voice-edit-form')?.textContent.includes('Tên hiển thị');
      return {rows,details,previewMime:response.headers.get('content-type'),wav:String.fromCharCode(...bytes.slice(0,4))==='RIFF',duration,playable};
    })()`},sessionId);assert.equal(voiceCheck.exceptionDetails,undefined);const voices=voiceCheck.result.value;assert.ok(voices.rows>0);assert.equal(voices.details,true);assert.equal(voices.wav,true);assert.ok(voices.duration>0);assert.equal(voices.playable,true);
    await call('Runtime.evaluate',{expression:`document.querySelector('input[aria-label="Tag giọng đọc"]').focus()`},sessionId);
    await sleep(300);await call('Input.insertText',{text:'Router acceptance tag'},sessionId);await sleep(200);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sessionId);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sessionId);
    const {root}=await call('DOM.getDocument',{},sessionId);const fileNode=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'#voice-avatar-file'},sessionId);
    await call('DOM.setFileInputFiles',{nodeId:fileNode.nodeId,files:[path.resolve(__dirname,'../../../services/tts/.runtime/voice-avatar-upload-test.png')]},sessionId);await sleep(300);
    const avatarReview=await call('Runtime.evaluate',{returnByValue:true,expression:`(()=>{Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Xem thay đổi').click();return {fileChosen:document.querySelector('.voice-avatar-upload')?.textContent.includes('voice-avatar-upload-test.png'),tagEntered:document.querySelector('.voice-edit-form')?.textContent.includes('Router acceptance tag')};})()`},sessionId);assert.equal(avatarReview.result.value.fileChosen,true,"Avatar file selected");assert.equal(avatarReview.result.value.tagEntered,true,"Voice tag entered");await sleep(200);await shot('voice-avatar-tags-review');
    await call('Runtime.evaluate',{expression:`document.querySelector('.ant-modal-close').click();history.back()`},sessionId);await sleep(250);
    const blocked=await call('Runtime.evaluate',{returnByValue:true,expression:`location.pathname==='/voices'&&!!document.querySelector('.ant-modal-confirm')`},sessionId);assert.equal(blocked.result.value,true);
    await call('Runtime.evaluate',{expression:`document.querySelector('.ant-modal-confirm .ant-btn-default').click()`},sessionId);await sleep(250);
    const voiceDraftKept=await call('Runtime.evaluate',{returnByValue:true,expression:`location.pathname==='/voices'&&document.querySelector('.voice-avatar-upload')?.textContent.includes('voice-avatar-upload-test.png')`},sessionId);assert.equal(voiceDraftKept.result.value,true);
    await call('Runtime.evaluate',{expression:`document.querySelector('.nav-item[href="/users"]').click()`},sessionId);await sleep(200);
    await call('Runtime.evaluate',{expression:`document.querySelector('.ant-modal-confirm .ant-btn-primary').click()`},sessionId);await sleep(800);
    const proceeded=await call('Runtime.evaluate',{returnByValue:true,expression:'location.pathname'},sessionId);assert.equal(proceeded.result.value,'/users');
    await call('Network.deleteCookies',{name:'adminAccessToken',url:origin},sessionId);
    await call('Page.navigate',{url:origin+'/voices'},sessionId);await sleep(1000);
    const guarded=await call('Runtime.evaluate',{returnByValue:true,expression:`location.pathname==='/login'&&!!document.querySelector('#admin-email')`},sessionId);assert.equal(guarded.result.value,true);
    await call('Runtime.evaluate',{expression:`document.querySelector('#admin-email').focus()`},sessionId);
    await call('Input.insertText',{text:owner.email},sessionId);
    await call('Runtime.evaluate',{expression:`document.querySelector('#admin-password').focus()`},sessionId);
    await call('Input.insertText',{text:password},sessionId);
    await call('Runtime.evaluate',{expression:`document.querySelector('.login-form button[type="submit"]').click()`},sessionId);await sleep(1100);
    const returned=await call('Runtime.evaluate',{returnByValue:true,expression:`location.pathname==='/voices'&&!!document.querySelector('.voices-admin')`},sessionId);assert.equal(returned.result.value,true);
    await call('Runtime.evaluate',{expression:`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Tạo giọng hệ thống').click()`},sessionId);await sleep(250);
    const createForm=await call('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const form=document.querySelector('.system-voice-create-modal');return !!form?.querySelector('input[aria-label="Tên giọng hệ thống mới"]')&&!!form.querySelector('input[type=file][accept=".wav,audio/wav"]')&&form.querySelectorAll('input[type=checkbox]').length===4&&form.textContent.includes('Vị trí hiển thị');})()`},sessionId);assert.equal(createForm.result.value,true);
    const createDom=await call('DOM.getDocument',{},sessionId);const sampleNode=await call('DOM.querySelector',{nodeId:createDom.root.nodeId,selector:'.system-voice-create-modal input[type=file][accept=".wav,audio/wav"]'},sessionId);
    await call('DOM.setFileInputFiles',{nodeId:sampleNode.nodeId,files:[path.resolve(__dirname,'../../../services/tts/offline-output/clone/reference.wav')]},sessionId);await sleep(800);
    const consentBlocked=await call('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const form=document.querySelector('.system-voice-create-modal');return form.textContent.includes('reference.wav')&&Array.from(form.querySelectorAll('button')).find(b=>b.textContent==='Tạo giọng & audio mẫu')?.disabled;})()`},sessionId);assert.equal(consentBlocked.result.value,true);await shot('create-system-voice');
    await call('Runtime.evaluate',{expression:`document.querySelector('.system-voice-create-modal .ant-modal-close').click()`},sessionId);await sleep(200);
    await call('Runtime.evaluate',{expression:`document.querySelector('.ant-modal-confirm .ant-btn-primary').click()`},sessionId);await sleep(250);
    await call('Runtime.evaluate',{expression:`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Sắp xếp giọng').click()`},sessionId);await sleep(500);
    const orderedNames=await call('Runtime.evaluate',{returnByValue:true,expression:`Array.from(document.querySelectorAll('.voice-order-list li strong')).map(v=>v.textContent)`},sessionId);assert.ok(orderedNames.result.value.length>=2);
    await call('Runtime.evaluate',{expression:`document.querySelector('.voice-order-list li').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()}))`},sessionId);await sleep(100);
    await call('Runtime.evaluate',{expression:`document.querySelectorAll('.voice-order-list li')[1].dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:new DataTransfer()}))`},sessionId);await sleep(150);
    const movedNames=await call('Runtime.evaluate',{returnByValue:true,expression:`Array.from(document.querySelectorAll('.voice-order-list li strong')).map(v=>v.textContent)`},sessionId);assert.equal(movedNames.result.value[1],orderedNames.result.value[0]);assert.equal(movedNames.result.value[0],orderedNames.result.value[1]);await shot('voice-order-drag');
    await call('Runtime.evaluate',{expression:`document.querySelector('.voice-order-list').closest('.ant-modal-content').querySelector('.ant-modal-close').click()`},sessionId);await sleep(200);
    await call('Runtime.evaluate',{expression:`document.querySelector('.ant-modal-confirm .ant-btn-primary').click()`},sessionId);await sleep(250);
    let systemPreviewPlayable=null;
    const proofAudio=await fs.readFile(path.resolve(__dirname,'../../../services/tts/.runtime/admin-system-voice-preview-proof.wav')).catch(()=>null);
    if(proofAudio){const played=await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,userGesture:true,expression:`(async()=>{const audio=document.createElement('audio');audio.src=${JSON.stringify('data:audio/wav;base64,'+proofAudio.toString('base64'))};document.body.append(audio);await audio.play();await new Promise(r=>setTimeout(r,200));const result={duration:audio.duration,playable:!audio.paused&&audio.currentTime>0};audio.pause();audio.remove();return result;})()`},sessionId);assert.equal(played.exceptionDetails,undefined);assert.equal(played.result.value.playable,true);assert.ok(played.result.value.duration>0);systemPreviewPlayable=played.result.value;}
    await call('Page.navigate',{url:origin+'/missing-admin-page'},sessionId);await sleep(800);
    const notFound=await call('Runtime.evaluate',{returnByValue:true,expression:`document.body.textContent.includes('Không tìm thấy trang')`},sessionId);assert.equal(notFound.result.value,true);
    await call('Page.navigate',{url:'http://localhost:5173/pricing'},sessionId);await sleep(1400);
    const pricingCheck=await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<50&&document.querySelectorAll('#pricing article').length<4;i++)await wait(100);return {cards:document.querySelectorAll('#pricing article').length,text:document.querySelector('#pricing')?.textContent};})()`},sessionId);assert.equal(pricingCheck.result.value.cards,4);assert.ok(pricingCheck.result.value.text.includes('Basic Student'));assert.ok(pricingCheck.result.value.text.includes('250.000 credit'));assert.ok(pricingCheck.result.value.text.includes('5 phút'));await shot('pricing');
    await call('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true},sessionId);await sleep(250);const pricingMobile=await call('Runtime.evaluate',{returnByValue:true,expression:'document.documentElement.scrollWidth <= innerWidth'},sessionId);assert.equal(pricingMobile.result.value,true);await shot('mobile-pricing');
    console.log(JSON.stringify({passed:true,...result,voices,systemVoiceCreateForm:true,consentGuard:true,voiceOrderDrag:true,systemPreviewPlayable,pricingCards:4,mobileNoOverflow:true,routing:{reload:true,backForward:true,loginGuard:true,loginReturnsToPage:true,notFound:true,dirtyModalCancel:true,dirtyModalProceed:true}}));
  } finally {
    if(owner){await AdminSession.deleteMany({adminId:owner._id});await AdminAccount.deleteOne({_id:owner._id});}await mongoose.disconnect();
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
run().catch(error => { console.error(JSON.stringify({error:'ADMIN_BROWSER_CHECK_FAILED',type:error.name,message:error.message,location:error.stack?.split('\n').find(line=>line.includes('at run')),actual:error.actual,expected:error.expected})); process.exitCode = 1; });

