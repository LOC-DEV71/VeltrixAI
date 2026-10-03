import type {PlanConfig} from './PlanSchema';
const copy:Record<string,{headline:string;description:string}>={
 FREE:{headline:'Bắt đầu sáng tạo cùng AI',description:'Dành cho bạn muốn trải nghiệm quy trình từ ý tưởng đến kịch bản và lời đọc, ngay trong một không gian dễ sử dụng.'},
 BASIC_STUDENT:{headline:'Đồng hành cùng việc học và sáng tạo',description:'Dành cho học sinh, sinh viên và người mới làm nội dung muốn sử dụng Veltrix thường xuyên với ngân sách hợp lý.'},
 PLUS:{headline:'Biến ý tưởng thành nội dung mỗi ngày',description:'Dành cho creator làm nội dung thường xuyên, cần một quy trình linh hoạt để phát triển kịch bản, phân cảnh và giọng đọc riêng.'},
 PRO:{headline:'Không gian sáng tạo chuyên sâu',description:'Dành cho creator có nhu cầu sản xuất cao, muốn phát triển những nội dung dài và kiểm soát nhiều hơn định hướng sáng tạo.'},
};
export function defaultPlanDescription(tier:string){return copy[tier]?.description||'Lựa chọn phù hợp cho quy trình sáng tạo nội dung của bạn.';}
export function planPresentation(tier:string,c:PlanConfig){
 const number=(n:number|null)=>n===null?'không giới hạn':Number(n).toLocaleString('vi-VN');
 const duration=(n:number)=>n%60===0?`${n/60} phút`:`${n} giây`;
 const features:Array<{icon:string;text:string}>=[];
 features.push({icon:'credits',text:`${number(c.credits.monthlyGrant)} credit mỗi tháng`});
 if(c.content.enabled)features.push({icon:'content',text:`Chọn thời lượng kịch bản đến ${duration(c.content.maxDurationSeconds)}`});
 if(c.scenes.enabled)features.push({icon:'scenes',text:`Chia kịch bản thành tối đa ${number(c.scenes.maxScenes)} cảnh`});
 if(c.content.enabled&&c.content.advanced){const modes=(c.content.modes||[]).filter((v:string)=>v!=='auto').map((v:string)=>({aida:'AIDA',pas:'PAS',storytelling:'kể chuyện'}[v]||v));features.push({icon:'sparkles',text:`Tùy chỉnh ${modes.length?`cấu trúc ${modes.join(', ')} và `:''}lời kêu gọi hành động`});}
 if(c.content.enabled&&c.content.creativeDirection)features.push({icon:'sparkles',text:'Định hướng sáng tạo và phong cách hình ảnh riêng'});
 if(c.tts.enabled)features.push({icon:'voice',text:`Chuyển văn bản thành giọng nói, ${number(c.tts.maxTextChars)} ký tự mỗi tác vụ`});
 if(c.prompts.imageEnabled||c.prompts.videoEnabled)features.push({icon:'video',text:`Tạo prompt ${[c.prompts.imageEnabled?'hình ảnh':null,c.prompts.videoEnabled?'video theo từng đoạn':null].filter(Boolean).join(' và ')}`});
 if(c.clone.enabled)features.push({icon:'clone',text:`Nhân bản giọng riêng: ${number(c.clone.maxVoices)} giọng mỗi tài khoản`});
 if(c.clone.premiumSystemVoices)features.push({icon:'voice',text:'Sử dụng giọng hệ thống Premium theo quyền của gói'});
 if(c.content.enabled&&c.regeneration.enabled)features.push({icon:'history',text:'Tạo lại nội dung AI và chỉnh sửa kịch bản'});
 if(c.credits.rolloverAllowed)features.push({icon:'credits',text:`Cộng dồn credit ${c.credits.maxRollover===null?'không giới hạn':`đến ${number(c.credits.maxRollover)}`}`});
 features.push({icon:'projects',text:c.storage.maxProjects===null?'Quản lý nhiều dự án, không giới hạn số dự án':`Quản lý tối đa ${number(c.storage.maxProjects)} dự án`});
 return {headline:copy[tier]?.headline||c.overview.name,description:c.overview.description||defaultPlanDescription(tier),features};
}
