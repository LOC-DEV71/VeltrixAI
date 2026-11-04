// HTTP protocol fixtures validate the adapter; these are NOT model acceptance tests.
const {test,afterEach,mock}=require('node:test');const assert=require('node:assert/strict');
const {getAiConfiguration,LocalContentProvider,AI_LIMITS}=require('../dist/providers/AiProvider');
const {normalizeAiImage}=require('../dist/services/AiImageAssets');const sharp=require('sharp');
afterEach(()=>mock.restoreAll());
const config=()=>getAiConfiguration({AI_PROVIDER:'local',AI_SERVICE_URL:'http://127.0.0.1:8091',AI_SERVICE_TOKEN:'x'.repeat(64)});
const request={instruction:'Viết tiếng Việt.',prompt:'Một ý tưởng ngắn.',schema:{type:'array',items:{type:'object'}},maxOutputTokens:256,timeoutMs:1000};
test('configuration requires explicit provider, private loopback and nonempty credentials',()=>{
 for(const env of [{AI_PROVIDER:'random'},{AI_PROVIDER:'gemini'},...['https://example.com','http://10.0.0.1:8091','http://127.0.0.1:8091/?key=secret','http://name:secret@localhost:8091'].map(url=>({AI_PROVIDER:'local',AI_SERVICE_URL:url,AI_SERVICE_TOKEN:'x'.repeat(64)}))])assert.throws(()=>getAiConfiguration(env),e=>e.code.startsWith('CONTENT_PROVIDER_'));
 assert.equal(config().kind,'local');
});
test('local schema, authenticated requests, token budgeting and owned bytes only',async()=>{
 const calls=[];mock.method(globalThis,'fetch',async(url,init)=>{const body=JSON.parse(init.body);calls.push({url,body,init});assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer '+'x'.repeat(64));return Response.json(url.endsWith('/apply-template')?{prompt:'applied'}:url.endsWith('/tokenize')?{tokens:[1,2,3]}:{choices:[{finish_reason:'stop',message:{content:'[]'}}],usage:{prompt_tokens:3,completion_tokens:2}});});
 const result=await new LocalContentProvider(config()).generate({...request,images:[{bytes:Buffer.from('fixture'),mime:'image/png'}]});
 assert.equal(result.text,'[]');assert.equal(calls.length,3);assert.match(calls[2].body.messages[1].content[1].image_url.url,/^data:image\/png;base64,/);assert.equal(calls[2].body.response_format.type,'json_schema');assert.deepEqual(calls[2].body.response_format.json_schema,{name:'veltrix_scenes',strict:true,schema:request.schema});assert.equal(calls[2].body.max_tokens,256);assert.equal(calls[2].body.reasoning_effort,'none');
});
test('timeout, auth, queue, OOM and invalid output are distinct with no Gemini fallback',async()=>{
 const {GoogleGenerativeAI}=require('@google/generative-ai');const paid=mock.method(GoogleGenerativeAI.prototype,'getGenerativeModel',()=>{throw Error('must not fallback')});
 for(const [status,text,code] of [[401,'denied','CONTENT_PROVIDER_AUTH_FAILED'],[429,'busy','CONTENT_QUEUE_FULL'],[500,'CUDA out of memory','CONTENT_PROVIDER_OUT_OF_MEMORY'],[503,'loading','CONTENT_PROVIDER_UNAVAILABLE'],[200,'broken','CONTENT_PROVIDER_INVALID_RESPONSE']]){
  mock.method(globalThis,'fetch',async()=>new Response(text,{status}));await assert.rejects(new LocalContentProvider(config()).generate(request),e=>e.code===code);mock.restoreAll();
 }
 mock.method(globalThis,'fetch',async()=>{await new Promise(r=>setTimeout(r,25));throw Error('network')});await assert.rejects(new LocalContentProvider(config()).generate({...request,timeoutMs:1}),e=>e.code==='CONTENT_PROVIDER_TIMEOUT');assert.equal(paid.mock.callCount(),0);
});
test('input, image count and context limits fail before inference',async()=>{
 await assert.rejects(new LocalContentProvider(config()).generate({...request,prompt:'x'.repeat(AI_LIMITS.inputChars+1)}),e=>e.code==='CONTENT_INPUT_LIMIT_EXCEEDED');
 await assert.rejects(new LocalContentProvider(config()).generate({...request,images:[1,2]}),e=>e.code==='CONTENT_IMAGE_INVALID');
 const calls=[];mock.method(globalThis,'fetch',async(url)=>{calls.push(url);return Response.json(url.endsWith('/apply-template')?{prompt:'applied'}:{tokens:Array(8190).fill(1)});});await assert.rejects(new LocalContentProvider(config()).generate(request),e=>e.code==='CONTENT_CONTEXT_LIMIT_EXCEEDED');assert.equal(calls.length,2);
});

test('Support can place the image before its question and reserve the full Gemma visual token budget',async()=>{
 const calls=[];
 mock.method(globalThis,'fetch',async(url,init)=>{const body=JSON.parse(init.body);calls.push(body);return Response.json(url.endsWith('/apply-template')?{prompt:'applied'}:url.endsWith('/tokenize')?{tokens:Array(5000).fill(1)}:{choices:[{finish_reason:'stop',message:{content:'[]'}}]});});
 await new LocalContentProvider(config()).generate({...request,maxOutputTokens:4096,imageFirst:true,temperature:0.2,images:[{bytes:Buffer.from('fixture'),mime:'image/png'}]});
 const final=calls.at(-1);assert.equal(final.messages[1].content[0].type,'image_url');assert.equal(final.messages[1].content.at(-1).text,request.prompt);assert.equal(final.temperature,0.2);assert.equal(final.max_tokens,8192-5000-1152-64);
});
test('PNG/JPEG/WebP decode fully, bounded dimensions, corrupt/SVG/URL denied',async()=>{
 for(const format of ['png','jpeg','webp']){const bytes=await sharp({create:{width:100,height:60,channels:3,background:'red'}})[format]().toBuffer();const result=await normalizeAiImage(bytes.toString('base64'));assert.equal(result.width,100);assert.equal(result.height,60);assert.equal((await sharp(result.bytes).metadata()).format,'png');}
 for(const input of ['https://host/image.png',Buffer.from('<svg/>').toString('base64'),Buffer.from([137,80,78,71]).toString('base64')])await assert.rejects(normalizeAiImage(input),e=>e.code==='CONTENT_IMAGE_INVALID');
 const oversized=await sharp({create:{width:4100,height:1,channels:3,background:'red'}}).png().toBuffer();await assert.rejects(normalizeAiImage(oversized.toString('base64')),e=>e.code==='CONTENT_IMAGE_INVALID');
});
