const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildVideoSegments}=require('../dist/utils/videoSegments');
for(const [seconds,expected] of [[20,[10,10]],[25,[10,10,5]],[7,[7]],[20.1,[10,10,.1]]])test(`video clips cover ${seconds} seconds without gaps`,()=>{
 const text=Array.from({length:100},(_,i)=>'word'+i).join(' '),clips=buildVideoSegments(text,seconds,'A cinematic continuous shot.');
 assert.deepEqual(clips.map(s=>s.durationSeconds),expected);assert.equal(clips.map(s=>s.narration).filter(Boolean).join(' '),text);assert.equal(clips[0].startSeconds,0);assert.ok(new Set(clips.map(s=>s.prompt)).size===clips.length);
 for(let i=1;i<clips.length;i++)assert.equal(clips[i].startSeconds,clips[i-1].startSeconds+clips[i-1].durationSeconds);
});
test('use distinct AI prompts and keep timing server-controlled',()=>{const clips=buildVideoSegments('opening then ending',20,'Base',[{prompt:'Close-up of the character.'},{prompt:'Camera follows the character walking away.'}]);assert.match(clips[0].prompt,/Close-up/);assert.match(clips[1].prompt,/walking away/);assert.deepEqual(clips.map(s=>s.durationSeconds),[10,10]);});
test('disabled video prompts produce no clips and malformed clip counts fall back safely',()=>{assert.deepEqual(buildVideoSegments('words',20,''),[]);assert.equal(buildVideoSegments('words',20,'Base',[{prompt:'Wrong count'}]).length,2);});
test('timing corrections preserve the AI visual beats rather than dropping them',()=>{const clips=buildVideoSegments('words',25,'Base',[{prompt:'Opening close-up.'},{prompt:'Character walks out.'}]);assert.equal(clips.length,3);assert.match(clips[0].prompt,/Opening close-up/);assert.match(clips[2].prompt,/Character walks out/);assert.notEqual(clips[0].prompt,clips[1].prompt);});
test('video segments persist in MongoDB and loading them does not duplicate prompt instructions',async()=>{
 const mongoose=require('mongoose'),{MongoMemoryServer}=require('mongodb-memory-server'),{Scene}=require('../dist/models/Scene');const db=await MongoMemoryServer.create();
 try{await mongoose.connect(db.getUri());const videoSegments=buildVideoSegments('opening then ending',25,'A continuous cinematic shot.');const scene=await Scene.create({projectId:new mongoose.Types.ObjectId(),order:1,title:'Scene',narration:'opening then ending',visualDescription:'Scene',estimatedDuration:25,sourceContentRevision:1,videoPrompt:'A continuous cinematic shot.',videoSegments});const stored=await Scene.findById(scene._id).lean();assert.deepEqual(stored.videoSegments,videoSegments);assert.deepEqual(buildVideoSegments(stored.narration,25,stored.videoPrompt,stored.videoSegments),videoSegments);}finally{await mongoose.disconnect();await db.stop();}
});
