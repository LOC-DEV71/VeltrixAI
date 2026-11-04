// UI-only fixtures; backend enforcement and real authenticated sockets have a separate integration suite.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require('../../web-client/node_modules/playwright');
const {Server}=require('../../backend-api/node_modules/socket.io');
const id='600000000000000000000001',ip='203.0.113.10',month=new Date().toISOString().slice(0,7),stamp=new Date().toISOString();
const account={_id:id,email:'member@example.invalid',displayName:'Thành viên kiểm thử',plan:'FREE',status:'ACTIVE'};
const denial={_id:'fixture-denial',ip,month,occurredAt:stamp,linkedCount:3,verifiedEmail:'fourth@example.invalid',kind:'LOGIN',reason:'FREE_IP_ACCOUNT_LIMIT',userId:id,account};
async function serve(dist){
  const server=http.createServer(async(req,res)=>{try{
    const name=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(dist,'.'+name);if(!file.startsWith(dist+path.sep))throw Error('Outside dist');
    const actual=await fs.stat(file).then(value=>value.isFile()?file:path.join(dist,'index.html')).catch(()=>path.join(dist,'index.html'));
    res.setHeader('Content-Type',actual.endsWith('.js')?'application/javascript':actual.endsWith('.css')?'text/css':actual.endsWith('.woff2')?'font/woff2':'text/html');res.end(await fs.readFile(actual));
  }catch{res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,origin:'http://127.0.0.1:'+server.address().port};
}
async function main(){
  const client=await serve(path.resolve(__dirname,'../../web-client/dist')),admin=await serve(path.resolve(__dirname,'../dist'));
  const sockets=new Server(admin.server,{path:'/socket.io'});sockets.of('/admin-billing');const namespace=sockets.of('/admin-security');
  let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/**',async route=>{
      const p=new URL(route.request().url()).pathname;let status=200,data;
      if(p.endsWith('/csrf'))data={csrfToken:'fixture-csrf'};
      else if(p.endsWith('/otp/request'))data={challengeId:'fixture-challenge'};
      else if(p.endsWith('/otp/verify')){status=403;data={error:{code:'FREE_IP_ACCOUNT_LIMIT'}};}
      else {status=401;data={error:{code:'UNAUTHORIZED'}};}
      await route.fulfill({status,json:status===200?{success:true,data}:{success:false,...data},headers:{'access-control-allow-origin':client.origin,'access-control-allow-credentials':'true'}});
    });
    await page.goto(client.origin+'/login');await page.getByPlaceholder('Email của bạn...').fill('fourth@example.invalid');await page.getByRole('button',{name:'Tiếp tục bằng Email',exact:true}).click();
    await page.getByPlaceholder('Nhập mã OTP...').fill('123456');await page.getByRole('button',{name:'Xác nhận',exact:true}).click();
    const notice=page.locator('.free-ip-notice');await notice.waitFor();
    assert.equal(await notice.locator('h2').innerText(),'Vi phạm chính sách sử dụng tài khoản Free');
    assert.match(await notice.innerText(),/Mạng bạn đang sử dụng đã đạt giới hạn 3 tài khoản Free/);
    assert.equal(await notice.getByRole('link',{name:'Liên hệ hỗ trợ'}).getAttribute('href'),process.env.TEST_SUPPORT_URL||'http://localhost:5175/');
    assert.equal(await notice.evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(255, 255, 255)');
    assert.equal(await page.getByText('Sai mã OTP',{exact:true}).count(),0);assert.equal(await page.getByText('fourth@example.invalid',{exact:true}).count(),0);
    await page.keyboard.press('Escape');await page.getByPlaceholder('Nhập mã OTP...').fill('654321');assert.ok(await notice.isVisible());
    // Advance a full minute in browser time: the notice has no timeout.
    await page.clock.install();await page.clock.fastForward(60000);assert.ok(await notice.isVisible());
    for(const width of [1440,820,390]){await page.setViewportSize({width,height:844});const box=await notice.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width&&box.y>=0);}
    await notice.getByRole('button',{name:'Đóng cảnh báo tài khoản Free'}).click();assert.equal(await notice.count(),0);
    await page.goto(client.origin+'/docs?section=help');assert.equal(await page.getByRole('link',{name:'Liên hệ hỗ trợ'}).getAttribute('href'),process.env.TEST_SUPPORT_URL||'http://localhost:5175/');
    await page.close();console.log('PASS client denial, env Support URL, persists through Escape/outside input/minute, X closes; three viewport widths');

    const adminPage=await browser.newPage({viewport:{width:1440,height:960}});adminPage.on('pageerror',e=>errors.push(e.message));let fail=false,seenFresh=false;const requests=[];
    await adminPage.route('**/api/**',async route=>{
      const url=new URL(route.request().url()),p=url.pathname,q=url.searchParams;requests.push(url);let data;
      if(p.endsWith('/auth/me'))data={email:'support@example.invalid',displayName:'Support',roleId:{name:'SUPPORT'},permissions:['users.read']};
      else if(p.endsWith('/ip-networks'))data={items:[{_id:'network',ip,month,accountIds:[id,id,id],suspicious:true,lastDeniedAt:stamp}],total:1,page:1,limit:10};
      else if(p.endsWith('/ip-history')){
        if(fail&&q.has('ip')){await route.fulfill({status:503,json:{success:false,error:{code:'INTERNAL_ERROR'}}});return;}
        const page=Number(q.get('page')||1);data={ip,month,linkedAccounts:[account],suspicious:true,items:q.has('ip')?[{...denial,_id:'history-'+page}]:(seenFresh?[fresh,denial]:[denial]),total:q.has('ip')?11:(seenFresh?2:1),limit:10,page};
      }else if(p.endsWith('/users/'+id))data={user:account,wallets:[],subscriptions:[],subscriptionsMeta:{page:1,total:0},recentJobs:[],ipNetworks:[{_id:'network',ip,month,suspicious:true}]};
      else if(p.endsWith('/users'))data={users:[account],total:1,limit:10,page:1};else data={items:[],total:0};
      await route.fulfill({json:{success:true,data}});
    });
    const fresh={...denial,_id:'fresh-denial',eventId:'fresh-denial'};
    await adminPage.goto(admin.origin+'/users?ip='+ip);await adminPage.getByRole('heading',{name:'Lịch sử từ chối trong tháng',exact:true}).waitFor();
    assert.equal(await adminPage.getByRole('button',{name:'Thông báo thanh toán',exact:true}).count(),0);await adminPage.getByRole('button',{name:'Cảnh báo tài khoản Free theo IP'}).waitFor();
    const supportWait=async()=>{for(let i=0;i<50&&!namespace.sockets.size;i++)await new Promise(resolve=>setTimeout(resolve,100));assert.ok(namespace.sockets.size);};await supportWait();
    seenFresh=true;namespace.emit('security:free-ip',fresh);namespace.emit('security:free-ip',fresh);
    await adminPage.locator('.ant-notification-notice').getByText('Nghi vấn spam tài khoản',{exact:true}).waitFor();assert.equal(await adminPage.locator('.ant-notification-notice').count(),1);
    const last=adminPage.locator('.users-stitch').getByRole('heading',{name:'Lịch sử từ chối trong tháng'}).locator('..');
    await Promise.all([adminPage.waitForResponse(response=>response.url().includes('ip-history')&&new URL(response.url()).searchParams.get('page')==='2'),last.locator('.ant-pagination-item-2').click()]);
    assert.ok(requests.some(url=>url.pathname.endsWith('/ip-history')&&url.searchParams.get('ip')===ip&&url.searchParams.get('page')==='2'));
    for(const width of [1440,820,390]){await adminPage.setViewportSize({width,height:960});assert.equal(await adminPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`Admin overflow at ${width}`);}
    await adminPage.setViewportSize({width:1440,height:960});fail=true;await adminPage.getByRole('button',{name:'Tra cứu',exact:true}).click();await adminPage.getByText('Không tải được dữ liệu IP',{exact:true}).waitFor();fail=false;await adminPage.getByRole('button',{name:'Thử lại',exact:true}).click();await adminPage.getByRole('heading',{name:'Lịch sử từ chối trong tháng',exact:true}).waitFor();
    await adminPage.reload();await adminPage.getByRole('heading',{name:'Lịch sử từ chối trong tháng',exact:true}).waitFor();await supportWait();namespace.emit('security:free-ip',fresh);
    await new Promise(resolve=>setTimeout(resolve,250));assert.equal(await adminPage.locator('.ant-notification-notice').count(),0,'Previously seen event does not notify again after reconnect/reload');
    await adminPage.getByRole('link',{name:new RegExp(account.displayName)}).first().click();await adminPage.locator('.stitch-user-drawer').getByText(account.email,{exact:true}).first().waitFor();
    assert.deepEqual(errors,[]);console.log('PASS admin IP history/search, account deep link, 10-row pagination, error retry, three widths and realtime retry/reload deduplication');
  }finally{await browser?.close();await new Promise(resolve=>sockets.close(resolve));await new Promise(resolve=>client.server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
