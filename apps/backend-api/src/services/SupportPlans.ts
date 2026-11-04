import mongoose from 'mongoose';
import {Plan, PlanRevision} from '../models/Plan';
import {PLAN_FIELDS} from './PlanSchema';

const normalize = (text:string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase();
export function supportNeedsPlans(question:string) {return /goi|plans?|pricing|credit|clone|nhan ban|quota|han muc|gioi han|tts|premium|plus|pro\b|free|gia\b/.test(normalize(question));}

// Same published head/revision selection as /api/plans, without user counts or admin history.
// No model-supplied query, arbitrary collection access, writes, or seed fallbacks.
export async function readSupportPlans(question:string, maxContextChars=6000) {
  if (!supportNeedsPlans(question)) return {status:'not-requested' as const, context:''};
  const unavailable = {status:'unavailable' as const,context:'PLANS LIVE KHÔNG ĐỌC ĐƯỢC. Không xác nhận giá/quota/quyền gói từ ví dụ hoặc seed. Hướng dẫn mở Bảng giá (/pricing) để kiểm tra khi kết nối lại.'};
  if (mongoose.connection.readyState !== 1) return unavailable;
  try {
    const heads = await Plan.find({archived:false}).select('_id tier revision').maxTimeMS(2000).lean();
    if (!heads.length || heads.length > 20) return unavailable;
    const records = await PlanRevision.find({$or:heads.map((head:any)=>({planId:head._id,revision:head.revision}))}).select('tier revision config').maxTimeMS(2000).lean();
    if (records.length !== heads.length) return unavailable;
    const query = normalize(question), detail = new Set<string>();
    if (/clone|nhan ban|mau giong/.test(query)) detail.add('clone');
    if (/tts|text to speech|doc|audio|wav/.test(query)) detail.add('tts');
    if (/content|noi dung|kich ban|studio/.test(query)) {detail.add('content'); detail.add('scenes');}
    if (/prompt|hinh anh|video/.test(query)) detail.add('prompts');
    if (/credit|so du|phi/.test(query)) detail.add('credits');
    if (/gia|thang|nam|mua|dang ky|thanh toan/.test(query)) detail.add('pricing');
    if (/dong thoi|rate|phut|hang doi/.test(query)) detail.add('limits');
    if (/du an|workspace|luu tru/.test(query)) {detail.add('storage'); detail.add('history');}
    const plans = records.filter((record:any)=>record.config.overview.active).sort((a:any,b:any)=>a.config.overview.displayOrder-b.config.overview.displayOrder).map((record:any)=>{
      const c=record.config;
      const config:Record<string,any>={
        pricing:{monthlyPrice:c.pricing.monthlyPrice,yearlyPrice:c.pricing.yearlyPrice,monthlyAvailable:c.pricing.monthlyAvailable,yearlyAvailable:c.pricing.yearlyAvailable},
        credits:{monthlyGrant:c.credits.monthlyGrant,ttsPer100Chars:c.credits.ttsPer100Chars,contentCost:c.credits.contentCost},
        features:{content:c.content.enabled,tts:c.tts.enabled,clone:c.clone.enabled,cloneMaxVoices:c.clone.maxVoices,premiumVoices:c.clone.premiumSystemVoices,advancedContent:c.content.advanced,creativeDirection:c.content.creativeDirection,scenes:c.scenes.enabled,imagePrompt:c.prompts.imageEnabled,videoPrompt:c.prompts.videoEnabled},
      };
      for (const section of detail) config[section]=Object.fromEntries(PLAN_FIELDS.filter(field=>field.section===section && !['description'].includes(field.key)).map(field=>[field.key,c[section][field.key]]));
      return {tier:record.tier,name:String(c.overview.name).slice(0,100),revision:record.revision,...config};
    });
    if (!plans.length) return unavailable;
    const omitted:string[]=[];
    const jsonLimit=Math.max(0,Math.min(5100,maxContextChars-900));
    // Keep every plan's price and feature flags. Drop complete optional sections rather
    // than cutting JSON, so large catalog questions cannot overflow the model context.
    for (const section of [...detail].reverse()) {
      if (JSON.stringify(plans).length <= jsonLimit) break;
      if (['pricing','credits'].includes(section)) continue;
      for (const plan of plans) delete (plan as any)[section];
      omitted.push(section);
    }
    if (JSON.stringify(plans).length > jsonLimit) return unavailable;
    return {status:'ready' as const,context:`[live-plans] Bảng giá & quyền lợi ĐANG CÔNG BỐ (/pricing), đọc database lúc ${new Date().toISOString()}. Ưu tiên các giá trị này hơn tài liệu tĩnh. Đây là danh mục chung, không phải gói/số dư cá nhân. Giá VND; enabled=false là không cho dùng; null là không giới hạn CHỈ khi tính năng enabled=true; null khi clone tắt là không áp dụng. maxReferenceSeconds/minReferenceSeconds là giây, maxFileBytes là bytes; ttsPer100Chars là Credit/100 ký tự làm tròn lên. features.clone là quyền TẠO giọng clone; không nhầm với giọng Premium. ${omitted.length ? 'Chưa cung cấp quota chi tiết các nhóm '+omitted.join(', ')+': không suy đoán quota thiếu; hướng dẫn xem Bảng giá.' : ''} JSON:\n${JSON.stringify(plans)}`};
  } catch {return unavailable;}
}
