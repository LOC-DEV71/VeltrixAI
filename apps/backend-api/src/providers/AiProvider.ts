import {GoogleGenerativeAI,type ResponseSchema} from '@google/generative-ai';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
export class AiProviderError extends Error {constructor(public readonly code:string,public readonly status=503){super(code);}}
export interface AiGenerationRequest {instruction:string;prompt:string;schema:Record<string,any>;maxOutputTokens:number;timeoutMs:number;images?:Array<{bytes:Buffer;mime:'image/png'|'image/jpeg'|'image/webp'}>;}
export interface AiGenerationResult {text:string;usage?:{inputTokens:number;outputTokens:number};}
export interface ContentAiProvider {readonly identity:{kind:'local'|'gemini';model:string};generate(request:AiGenerationRequest):Promise<AiGenerationResult>;}
export const AI_LIMITS=Object.freeze({inputChars:12000,imageBytes:3*1024*1024,imagePixels:4096*4096,imageCount:1,outputBytes:2*1024*1024,timeoutMs:180000,queuedJobs:10});
export type AiConfiguration=ReturnType<typeof getAiConfiguration>;
export function getAiConfiguration(env:NodeJS.ProcessEnv=process.env){
 const kind=env.AI_PROVIDER||'gemini';
 if(kind!=='local'&&kind!=='gemini')throw new AiProviderError('CONTENT_PROVIDER_CONFIG_INVALID');
 if(kind==='gemini'){if(!env.GEMINI_API_KEY)throw new AiProviderError('CONTENT_PROVIDER_NOT_CONFIGURED');return {kind,model:'gemini-3.5-flash-lite',apiKey:env.GEMINI_API_KEY,url:'',token:'',contextTokens:0,maxOutputTokens:65536} as const;}
 let saved:any={};
 if(!env.AI_SERVICE_URL&&!env.AI_SERVICE_TOKEN){try{saved=JSON.parse(readFileSync(resolve(__dirname,'../../../../services/ai/.runtime/connection.json'),'utf8'));}catch{throw new AiProviderError('CONTENT_PROVIDER_NOT_CONFIGURED');}}
 let url:URL;try{url=new URL(env.AI_SERVICE_URL||saved.url);}catch{throw new AiProviderError('CONTENT_PROVIDER_CONFIG_INVALID');}
 const token=env.AI_SERVICE_TOKEN||saved.token;
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||typeof token!=='string'||token.length<32)throw new AiProviderError('CONTENT_PROVIDER_CONFIG_INVALID');
 const contextTokens=Number(env.AI_CONTEXT_TOKENS||saved.contextTokens||8192),maxOutputTokens=Number(env.AI_MAX_OUTPUT_TOKENS||saved.maxOutputTokens||4096),model=env.AI_MODEL||saved.model||'veltrix-gemma-e4b';
 if(![4096,8192,16384].includes(contextTokens)||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<128||maxOutputTokens>contextTokens/2||typeof model!=='string'||!/^[a-zA-Z0-9_.:/-]{1,128}$/.test(model))throw new AiProviderError('CONTENT_PROVIDER_CONFIG_INVALID');
 return {kind,model,url:url.origin,token,apiKey:'',contextTokens,maxOutputTokens} as const;
}
export function sceneJsonSchema(schema:Record<string,any>):Record<string,any>{const result:Record<string,any>={...schema,type:String(schema.type).toLowerCase()};if(schema.items)result.items=sceneJsonSchema(schema.items);if(schema.properties)result.properties=Object.fromEntries(Object.entries(schema.properties).map(([k,v])=>[k,sceneJsonSchema(v as any)]));return result;}
function geminiSchema(schema:Record<string,any>):ResponseSchema{return sceneJsonSchema(schema) as ResponseSchema;}
function validate(request:AiGenerationRequest){if(!request.prompt||request.instruction.length+request.prompt.length>AI_LIMITS.inputChars||!Number.isSafeInteger(request.maxOutputTokens)||request.maxOutputTokens<1)throw new AiProviderError('CONTENT_INPUT_LIMIT_EXCEEDED',400);if((request.images?.length||0)>AI_LIMITS.imageCount||request.images?.some(i=>!['image/png','image/jpeg','image/webp'].includes(i.mime)||!Buffer.isBuffer(i.bytes)||i.bytes.length>AI_LIMITS.imageBytes))throw new AiProviderError('CONTENT_IMAGE_INVALID',400);}
export class GeminiContentProvider implements ContentAiProvider {
 readonly identity:ContentAiProvider['identity'];constructor(private config:AiConfiguration){this.identity={kind:'gemini',model:config.model};}
 async generate(request:AiGenerationRequest):Promise<AiGenerationResult>{
  validate(request);const model=new GoogleGenerativeAI(this.config.apiKey).getGenerativeModel({model:this.identity.model,systemInstruction:request.instruction,generationConfig:{responseMimeType:'application/json',responseSchema:geminiSchema(request.schema),maxOutputTokens:Math.min(request.maxOutputTokens,this.config.maxOutputTokens)}});
  try{const result=await model.generateContent(request.images?.length?[{text:request.prompt},...request.images.map(i=>({inlineData:{data:i.bytes.toString('base64'),mimeType:i.mime}}))]:request.prompt,{timeout:Math.min(request.timeoutMs,AI_LIMITS.timeoutMs)});const text=result.response.text();if(Buffer.byteLength(text)>AI_LIMITS.outputBytes)throw new AiProviderError('CONTENT_OUTPUT_LIMIT_EXCEEDED',400);return {text,usage:result.response.usageMetadata?{inputTokens:result.response.usageMetadata.promptTokenCount,outputTokens:result.response.usageMetadata.candidatesTokenCount}:undefined};}
  catch(error:any){if(error instanceof AiProviderError)throw error;throw new AiProviderError(error?.status===429?'CONTENT_PROVIDER_RATE_LIMITED':error?.name==='AbortError'||error?.name==='TimeoutError'?'CONTENT_PROVIDER_TIMEOUT':'CONTENT_PROVIDER_UNAVAILABLE');}
 }
}
let localInferenceActive=false;
export class LocalContentProvider implements ContentAiProvider {
 readonly identity:ContentAiProvider['identity'];constructor(private config:AiConfiguration){this.identity={kind:'local',model:config.model};}
 private async post(endpoint:string,body:unknown,signal:AbortSignal){
  try{const response=await fetch(this.config.url+endpoint,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+this.config.token,'Content-Type':'application/json'},body:JSON.stringify(body),signal});const chunks:Uint8Array[]=[];let total=0;for await(const chunk of response.body as any){total+=chunk.length;if(total>AI_LIMITS.outputBytes)throw new AiProviderError('CONTENT_OUTPUT_LIMIT_EXCEEDED',400);chunks.push(chunk);}const text=Buffer.concat(chunks).toString('utf8');if(!response.ok)throw new AiProviderError(response.status===401||response.status===403?'CONTENT_PROVIDER_AUTH_FAILED':response.status===429?'CONTENT_QUEUE_FULL':/out of memory|cuda.*alloc|bad_alloc/i.test(text)?'CONTENT_PROVIDER_OUT_OF_MEMORY':response.status===400&&/context|tokens/i.test(text)?'CONTENT_CONTEXT_LIMIT_EXCEEDED':'CONTENT_PROVIDER_UNAVAILABLE');try{return JSON.parse(text);}catch{throw new AiProviderError('CONTENT_PROVIDER_INVALID_RESPONSE');}}
  catch(error){if(error instanceof AiProviderError)throw error;throw new AiProviderError(signal.aborted?'CONTENT_PROVIDER_TIMEOUT':'CONTENT_PROVIDER_UNAVAILABLE');}
 }
 async generate(request:AiGenerationRequest):Promise<AiGenerationResult>{
  validate(request);if(localInferenceActive)throw new AiProviderError('CONTENT_QUEUE_FULL',429);localInferenceActive=true;
  try{const signal=AbortSignal.timeout(Math.min(request.timeoutMs,AI_LIMITS.timeoutMs));const messages=[{role:'system',content:request.instruction},{role:'user',content:request.prompt}];const applied=await this.post('/apply-template',{messages},signal);if(typeof applied.prompt!=='string')throw new AiProviderError('CONTENT_PROVIDER_INVALID_RESPONSE');const tokenized=await this.post('/tokenize',{content:applied.prompt,add_special:true},signal);if(!Array.isArray(tokenized.tokens))throw new AiProviderError('CONTENT_PROVIDER_INVALID_RESPONSE');const available=this.config.contextTokens-tokenized.tokens.length-(request.images?.length||0)*300-64,maxTokens=Math.min(request.maxOutputTokens,this.config.maxOutputTokens,available);if(maxTokens<128)throw new AiProviderError('CONTENT_CONTEXT_LIMIT_EXCEEDED',400);const content=request.images?.length?[{type:'text',text:request.prompt},...request.images.map(image=>({type:'image_url',image_url:{url:`data:${image.mime};base64,${image.bytes.toString('base64')}`}}))]:request.prompt;const result=await this.post('/v1/chat/completions',{model:this.identity.model,messages:[messages[0],{role:'user',content}],max_tokens:maxTokens,temperature:0.65,stream:false,reasoning_effort:'none',response_format:{type:'json_schema',json_schema:{name:'veltrix_scenes',strict:true,schema:request.schema}}},signal);if(result.choices?.[0]?.finish_reason==='length')throw new AiProviderError('CONTENT_OUTPUT_LIMIT_EXCEEDED',400);const text=result.choices?.[0]?.message?.content;if(typeof text!=='string'||!text.trim())throw new AiProviderError('CONTENT_PROVIDER_INVALID_RESPONSE');return {text,usage:result.usage?{inputTokens:result.usage.prompt_tokens,outputTokens:result.usage.completion_tokens}:undefined};}
  finally{localInferenceActive=false;}
 }
}
export function createContentAiProvider(configuration=getAiConfiguration()):ContentAiProvider{return configuration.kind==='local'?new LocalContentProvider(configuration):new GeminiContentProvider(configuration);}
export async function getAiHealth(){
 try{const config=getAiConfiguration();if(config.kind==='gemini')return {provider:'gemini',status:'CONFIGURED',probe:'NOT_PROBED'};const r=await fetch(config.url+'/health',{headers:{Authorization:'Bearer '+config.token},redirect:'error',signal:AbortSignal.timeout(2000)});await r.body?.cancel();return {provider:'local',status:r.ok?'READY':'UNAVAILABLE',probe:'HTTP_READINESS'};}
 catch(error){return {provider:process.env.AI_PROVIDER==='local'?'local':'gemini',status:error instanceof AiProviderError?'UNCONFIGURED':'UNAVAILABLE',probe:'HTTP_READINESS'};}
}
