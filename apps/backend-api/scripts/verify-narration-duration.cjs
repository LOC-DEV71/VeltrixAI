// Read-only provider verification: no user jobs, content writes or wallet charges.
const path=require('node:path'),fs=require('node:fs/promises'),mongoose=require('mongoose');
require('dotenv').config({path:path.join(__dirname,'../.env'),quiet:true});
const {GoogleGenerativeAI}=require('@google/generative-ai');
const {getPlanSnapshot}=require('../dist/services/PlanService');
const {resolveContentOptions}=require('../dist/services/ContentCapabilities');
const {SCENE_RESPONSE_SCHEMA,buildPlanInstruction,buildAdvancedPrompt,parseGeneratedScenes,validateSceneOptions,sceneOptionsFeedback}=require('../dist/services/ContentGeneration');
const {narrationUnits}=require('../dist/utils/narrationTiming');
const {buildVideoSegments}=require('../dist/utils/videoSegments');
const {validateOutput}=require('../dist/services/EntitlementService');
(async()=>{
 await mongoose.connect(process.env.MONGODB_URI);
 const ai=new GoogleGenerativeAI(process.env.GEMINI_API_KEY),checks=[];
 for(const [tier,seconds,count] of [['PLUS',120,5],['PLUS',300,12],['PRO',600,20]]){
  if(process.argv[2] && Number(process.argv[2])!==seconds)continue;
  const snapshot=await getPlanSnapshot(tier),options=resolveContentOptions({durationSeconds:seconds,sceneCount:count},snapshot);
  const model=ai.getGenerativeModel({model:'gemini-3.1-flash-lite',systemInstruction:buildPlanInstruction(options),generationConfig:{responseMimeType:'application/json',responseSchema:{...SCENE_RESPONSE_SCHEMA,minItems:options.minScenes,maxItems:options.maxScenes},maxOutputTokens:options.maxTokens}});
  const prompt=buildAdvancedPrompt({topic:'Tình yêu là gì? Những biểu hiện thực tế của tình yêu trong cuộc sống.',platform:'youtube',audience:'Người Việt trẻ tuổi, muốn hiểu cách xây dựng mối quan hệ lành mạnh',tone:'Gần gũi, chân thành, có ví dụ thực tế'},options);
  let scenes,passed=false,code;
  for(let attempt=1;attempt<=2;attempt++){
   const result=await model.generateContent(prompt+(attempt===2?'\n'+sceneOptionsFeedback(scenes,options):''),{timeout:150000});
   try{scenes=parseGeneratedScenes(result.response.text());validateSceneOptions(scenes,options);validateOutput(snapshot,scenes);passed=true;code=undefined;}catch(error){code=error.code||(/^[A-Z_]+$/.test(error.message)?error.message:'VALIDATION_FAILED');}
   const proof={requestedSeconds:seconds,attempt,passed,code,scenes:scenes?.length,spokenUnits:scenes?.reduce((n,s)=>n+narrationUnits(s.narration),0),estimatedSeconds:scenes?.reduce((n,s)=>n+narrationUnits(s.narration)/options.speechUnitsPerSecond,0)};
   proof.videoClips=scenes?.map(s=>{const clips=buildVideoSegments(s.narration,narrationUnits(s.narration)/options.speechUnitsPerSecond,s.videoPrompt,s.videoSegments);return {seconds:s.estimatedDuration,clips:clips.length,aiPrompts:s.videoSegments?.length||0,durations:clips.map(c=>c.durationSeconds)};});
   checks.push(proof);console.log(JSON.stringify(proof));
   await fs.writeFile(path.resolve(__dirname,'../../../services/tts/.runtime/narration-duration-check'+(process.argv[2]?'-'+process.argv[2]:'')+'.json'),JSON.stringify(checks,null,2));
   if(passed)break;
  }
  if(!passed)process.exitCode=1;
 }
})().catch(error=>{console.error(JSON.stringify({code:'PROVIDER_CHECK_FAILED',status:error.status||null}));process.exitCode=1;}).finally(()=>mongoose.disconnect());
