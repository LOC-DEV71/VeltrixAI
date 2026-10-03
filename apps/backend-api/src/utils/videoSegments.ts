export interface VideoSegment { order:number; startSeconds:number; durationSeconds:number; narration:string; prompt:string }
// Clip timing belongs to the backend, never to the model's claimed duration.
export function buildVideoSegments(narration:string,duration:number,basePrompt:string,provided?:Array<{prompt:string}>):VideoSegment[] {
  if(!basePrompt.trim() || !Number.isFinite(duration) || duration<=0)return [];
  const seconds=Math.round(duration*10)/10,count=Math.ceil(seconds/10),words=narration.trim().split(/\s+/u);
  return Array.from({length:count},(_,i)=>{
    const start=i*10,end=Math.min(seconds,start+10);
    const direction=i===0?'Introduce this narrated beat with a clear opening shot.':i===count-1?'Continue seamlessly from the previous clip and conclude this narrated beat.':'Continue seamlessly from the previous clip, progressing the action without repeating the opening.';
    const source=provided?.length ? provided[Math.min(provided.length-1,Math.floor(i*provided.length/count))]?.prompt?.trim() : undefined;
    const prompt=source ? (provided?.length===count ? source : `${source} ${direction}`) : `${basePrompt.trim()} ${direction}`;
    const suffix=`Clip ${i+1}/${count}, ${(end-start).toFixed(1)} seconds. Maintain the same characters, wardrobe, environment, lighting and visual style. No captions or on-screen text.`;
    return {order:i+1,startSeconds:start,durationSeconds:Math.round((end-start)*10)/10,narration:words.slice(Math.round(start/seconds*words.length),Math.round(end/seconds*words.length)).join(' '),prompt:prompt.endsWith(suffix)?prompt:`${prompt} ${suffix}`};
  });
}
