// Actual Support UI, real authenticated API on isolated Mongo, real Gemma vision.
// A transport failure is injected once to verify retry preserves the image/request ID.
const path=require('node:path'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),backend=path.join(root,'apps/backend-api'),runtime=path.join(root,'.runtime');
fs.mkdirSync(runtime,{recursive:true});require(path.join(backend,'node_modules/dotenv')).config({path:path.join(backend,'.env'),quiet:true});
const mongoose=require(path.join(backend,'node_modules/mongoose')),{MongoMemoryReplSet}=require(path.join(backend,'node_modules/mongodb-memory-server'));
const express=require(path.join(backend,'node_modules/express')),sharp=require(path.join(backend,'node_modules/sharp'));
const {chromium}=require(path.join(root,'apps/web-client/node_modules/playwright'));
const {User}=require(path.join(backend,'dist/models/User')),{Session}=require(path.join(backend,'dist/models/Session')),{AiImageAsset}=require(path.join(backend,'dist/models/AiImageAsset'));
const {signAccessToken}=require(path.join(backend,'dist/utils/jwt'));
(async()=>{
 let mongo,server,browser;
 try {
  process.env.NODE_ENV='test';
  const png=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#ffffff"/><rect x="20" y="20" width="600" height="320" rx="12" fill="#f7f8fc" stroke="#4f46e5" stroke-width="4"/><text x="60" y="95" font-family="Arial" font-size="44" fill="#172033">VELTRIX AI</text><text x="60" y="215" font-family="Arial" font-size="90" font-weight="bold" fill="#4f46e5">ERROR 403</text><text x="60" y="290" font-family="Arial" font-size="36" fill="#172033">REQUEST DENIED</text></svg>')).png().toBuffer();
  await fs.promises.writeFile(path.join(runtime,'support-image-fixture.png'),png);
  mongo=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(mongo.getUri());await Promise.all([User,Session,AiImageAsset].map(model=>model.init()));
  const user=await User.create({email:'vision-browser@example.invalid',displayName:'Khách kiểm thử ảnh',plan:'FREE'});
  const session=await Session.create({userId:user._id,tokenFamily:randomUUID(),refreshTokenHash:'image-fixture',expiresAt:new Date(Date.now()+3600000)});
  const app=express();app.use('/api/support',require(path.join(backend,'dist/routes/support')).default);
  server=await new Promise(resolve=>{const handle=app.listen(0,'127.0.0.1',()=>resolve(handle));});const api='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage(),errors=[],chatRequests=[];let failNext=true,uiFollowup=false;
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.__imageUrls={created:[],revoked:[]};const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=file=>{const url=create(file);window.__imageUrls.created.push(url);return url;};URL.revokeObjectURL=url=>{window.__imageUrls.revoked.push(url);return revoke(url);};});
  await context.addCookies([{name:'accessToken',value:signAccessToken({sessionId:session._id,userId:user._id}),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);
  await page.route('http://localhost:3001/api/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/support/chat')&&route.request().method()==='POST'){
    chatRequests.push(route.request().postDataJSON());
    if(failNext){failNext=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:{code:'SUPPORT_AI_UNAVAILABLE',message:'Lỗi kết nối mô phỏng để kiểm tra gửi lại.'}})});}
    // This later reply only exercises UI omission of historical image bytes, not vision.
    if(uiFollowup)return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,data:{answer:'Fixture follow-up.',memory:'Ảnh trước có lỗi 403.',sources:[],references:[],actions:[]}})});
   }
   const response=await route.fetch({url:api+url.pathname+url.search,timeout:115000});await route.fulfill({response});
  });
  await page.goto('http://localhost:5175/?chat=1');const textbox=page.getByRole('textbox',{name:'Câu hỏi cho AI'});await textbox.waitFor();
  const file=page.getByLabel('Chọn ảnh hỗ trợ');
  await file.setInputFiles({name:'too-large.png',mimeType:'image/png',buffer:Buffer.alloc(3*1024*1024+1)});await page.getByRole('alert').filter({hasText:'Ảnh tối đa 3 MB'}).waitFor();
  await file.setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not a valid image')});await page.getByRole('alert').filter({hasText:'Tệp ảnh bị lỗi'}).waitFor();
  await file.setInputFiles({name:'error403.png',mimeType:'image/png',buffer:png});await page.getByAltText('Ảnh chờ gửi').waitFor();assert.equal(chatRequests.length,0);
  assert.equal(await page.getByRole('button',{name:'Gửi câu hỏi',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'Bỏ ảnh đính kèm'}).click();assert.equal(await page.getByAltText('Ảnh chờ gửi').count(),0);
  await page.evaluate(async()=>navigator.clipboard.writeText('Nội dung dán bình thường'));await textbox.focus();await page.keyboard.press('Control+V');await page.waitForFunction(()=>document.querySelector('textarea').value==='Nội dung dán bình thường');await textbox.fill('');
  // Native browser clipboard, not a synthetic paste event: copied/cut images share this path.
  await page.evaluate(async base64=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));await navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([bytes],{type:'image/png'})})]);},png.toString('base64'));
  await textbox.focus();await page.keyboard.press('Control+V');await page.getByAltText('Ảnh chờ gửi').waitFor();assert.equal(chatRequests.length,0);
  await page.screenshot({path:path.join(runtime,'support-image-draft-1440.png')});
  await textbox.fill('Đọc chính xác mã lỗi lớn trong ảnh tôi gửi. Trả lời bằng tiếng Việt.');
  await page.getByRole('button',{name:'Gửi câu hỏi',exact:true}).click();await page.getByRole('button',{name:'Thử lại câu hỏi này'}).waitFor();
  assert.equal(chatRequests.length,1);assert.ok(chatRequests[0].imageBase64);assert.equal(await page.locator('.chat-sent-image img').count(),1);
  const answer=page.waitForResponse(response=>response.url().endsWith('/api/support/chat')&&response.request().method()==='POST',{timeout:105000});await page.getByRole('button',{name:'Thử lại câu hỏi này'}).click();
  const reply=await (await answer).json();assert.ok(reply.success,JSON.stringify(reply));assert.match(reply.data.answer,/403/);
  assert.equal(chatRequests.length,2);assert.deepEqual(chatRequests[0],chatRequests[1]);assert.equal(await AiImageAsset.countDocuments(),0);assert.deepEqual(reply.data.actions,[]);
  await page.locator('.chat-message.assistant').filter({hasText:'403'}).waitFor();console.log('PASS real local Gemma vision reads ERROR 403; native Ctrl+V, file selection, preview, validation, authenticated retry, no durable image asset');
  assert.equal(reply.data.imageObservation.status,'readable');assert.match(reply.data.imageObservation.visibleText.join(' '),/403/);
  await page.getByText('Nội dung đọc được trong ảnh',{exact:true}).click();assert.match(await page.locator('.chat-image-reading pre').innerText(),/403/);

  // Capture the actual Developer UI, rather than testing only a large-text poster.
  const developerPage=await browser.newPage({viewport:{width:1440,height:1000}});
  await developerPage.goto('http://localhost:5173/developer');await developerPage.getByRole('heading',{name:'Giọng đọc cho ứng dụng của bạn'}).waitFor();await developerPage.evaluate(()=>document.fonts.ready);
  const developerScreenshot=await developerPage.screenshot({path:path.join(runtime,'support-developer-real-source.png')});
  async function sendScreenshot(bytes,question,name){
   await file.setInputFiles({name,mimeType:'image/png',buffer:bytes});await page.getByAltText('Ảnh chờ gửi').waitFor();await textbox.fill(question);
   const received=page.waitForResponse(response=>response.url().endsWith('/api/support/chat')&&response.request().method()==='POST',{timeout:105000});await page.getByRole('button',{name:'Gửi câu hỏi',exact:true}).click();const result=await (await received).json();assert.ok(result.success,JSON.stringify(result));await page.locator('.chat-pending').waitFor({state:'hidden'});return result.data;
  }
  const developerReply=await sendScreenshot(developerScreenshot,'trang gì vậy','developer-real.png');
  await fs.promises.writeFile(path.join(runtime,'support-developer-reading.json'),JSON.stringify(developerReply,null,2));
  assert.match(developerReply.answer,/Developer/i);assert.match(developerReply.answer,/TTS|REST API|giọng đọc/i);assert.ok(!/Studio Viết|Chia cảnh|Chào bạn/i.test(developerReply.answer));
  assert.ok(developerReply.references.some(reference=>reference.path==='/developer'));assert.equal(developerReply.imageObservation.status,'readable');assert.match(developerReply.imageObservation.visibleText.join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d'),/Giong doc cho ung dung/i);
  console.log('PASS real Developer screenshot is read despite unrelated prior chat; answer and source match Developer');

  // A value appears ONLY in screenshot pixels, not in the question, docs or server.
  // Changing rendered example text is a vision probe; it does not create API data.
  const pixelOnlyCode='ZQ729V';
  await developerPage.locator('pre code').evaluate((code,value)=>{code.textContent=code.textContent.replace('Xin chào, đây là lời đọc của tôi.',value);},pixelOnlyCode);
  const codeScreenshot=await developerPage.locator('pre').screenshot({path:path.join(runtime,'support-developer-code-source.png')});
  const codeReply=await sendScreenshot(codeScreenshot,'Đọc đoạn code trong ảnh: liệt kê lệnh curl, đường dẫn API và giá trị trường text. Giữ đúng chữ và số thấy trong ảnh.','developer-code.png');
  await fs.promises.writeFile(path.join(runtime,'support-developer-code-reading.json'),JSON.stringify(codeReply,null,2));
  const reading=codeReply.answer+' '+codeReply.imageObservation.visibleText.join(' ');
  assert.ok(reading.includes(pixelOnlyCode));assert.match(reading,/\/tts\/jobs/);assert.match(reading,/\/voices/);assert.deepEqual(codeReply.actions,[]);
  assert.equal(await AiImageAsset.countDocuments(),0);assert.ok(chatRequests.every(request=>!request.messages.some(message=>Object.keys(message).includes('image'))));
  await page.screenshot({path:path.join(runtime,'support-developer-code-answer.png')});await developerPage.close();
  console.log('PASS actual rendered API code is read, including a value available only in image pixels');
  uiFollowup=true;await textbox.fill('Cảm ơn bạn');await page.getByRole('button',{name:'Gửi câu hỏi',exact:true}).click();await page.locator('.chat-message.assistant').filter({hasText:'Fixture follow-up.'}).waitFor();
  assert.equal(chatRequests.length,5);assert.equal(chatRequests[4].imageBase64,undefined);assert.ok(chatRequests[4].messages.every(message=>Object.keys(message).sort().join(',')==='content,role'));
  for(const width of [1440,820,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.locator('.chat-composer').evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:path.join(runtime,'support-image-'+width+'.png')});}
  await page.getByRole('button',{name:'Cuộc trò chuyện mới',exact:true}).click();await page.getByRole('button',{name:'Bắt đầu mới',exact:true}).click();
  assert.equal(await page.locator('.chat-sent-image img').count(),0);assert.ok(await page.evaluate(()=>window.__imageUrls.created.every(url=>window.__imageUrls.revoked.includes(url))));
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>localStorage.length),0);console.log('PASS historical image bytes are omitted; URLs released on clear; desktop/tablet/mobile without overflow or JS errors');
 } finally {await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await mongo?.stop();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
