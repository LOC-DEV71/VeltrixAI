export class PlanError extends Error {
  constructor(public code: string, public status = 400, public fields: string[] = []) { super(code); }
}
export type PlanConfig = Record<string, Record<string, any>>;
export interface PlanField { key: string; section: string; label: string; type: 'boolean' | 'limit' | 'number' | 'text' | 'list'; unit?: string; nullable?: boolean; proOnly?: boolean; help: string; }
const field = (section: string, key: string, label: string, type: PlanField['type'], unit = '', nullable = false, proOnly = false): PlanField => ({ key, section, label, type, unit, nullable, proOnly, help: `${label}${unit ? ` (${unit})` : ''}. ${nullable ? 'Bỏ trống (Null) nghĩa là không giới hạn; nếu giới hạn thì phải là số nguyên dương. Giới hạn độ dài và dung lượng nhân bản giọng nói phải thiết lập null nếu tắt tính năng, và bắt buộc nếu bật.' : type === 'boolean' ? 'Chỉ áp dụng cho yêu cầu mới.' : 'Lưu phiên bản và kiểm duyệt; các công việc hiện tại vẫn giữ nguyên cài đặt cũ.'} ${section==='clone' && ['minReferenceSeconds','maxReferenceSeconds','maxFileBytes'].includes(key) ? 'Âm thanh mẫu phải phù hợp với engine: từ 3-8 giây và tối đa 4 MiB.' : section==='limits' && key.startsWith('concurrent') || section==='clone' && key==='concurrentJobs' ? 'Giới hạn số tác vụ chờ và đang chạy; các tác vụ đang đợi vẫn giữ nguyên snapshot.' : key==='queuePriority' ? 'Số nhỏ hơn được ưu tiên chạy trước; không vượt qua hạn mức hay giới hạn đồng thời.' : key==='monthlyGenerations' ? 'Tính mỗi lần tạo prompt hình ảnh hoặc video, bao gồm prompt tạo từ kịch bản.' : key==='monthlyChars' ? 'Tháng tính theo múi giờ UTC. Ký tự bị giữ bởi tác vụ đang chạy vẫn tính cho đến khi thành công hoặc bị hủy.' : key==='monthlyJobs' || key==='monthlyEnrollments' ? 'Đếm số tác vụ được tiếp nhận, kể cả tác vụ lỗi; làm mới vào mỗi tháng theo giờ UTC.' : ''}` });
export const PLAN_FIELDS: PlanField[] = [
  { ...field('overview','popular','Gắn nhãn Thường được dùng','boolean'), help: 'Hiển thị nhãn và cụm avatar minh họa trên thẻ gói ở client. Số người dùng được thống kê từ tài khoản đang hoạt động trong database; không nhập số liệu giả tại đây.' },
  field('overview','name','Tên gói','text'),field('overview','slug','Đường dẫn (Slug)','text'),field('overview','description','Mô tả','text'),field('overview','active','Kích hoạt','boolean'),field('overview','displayOrder','Thứ tự hiển thị','number'),field('overview','highlighted','Nổi bật','boolean'),
  field('pricing','monthlyPrice','Giá theo tháng','number','VND'),field('pricing','yearlyPrice','Giá theo năm','number','VND'),field('pricing','monthlyAvailable','Cho phép trả hàng tháng','boolean'),field('pricing','yearlyAvailable','Cho phép trả hàng năm','boolean'),
  field('credits','monthlyGrant','Tặng Credit mỗi tháng','number','credits'),field('credits','paidAllowed','Cho phép mua thêm Credit','boolean'),field('credits','expiresAfterDays','Thời hạn Credit','limit','ngày',true),field('credits','rolloverAllowed','Cho phép cộng dồn Credit sang tháng sau','boolean'),field('credits','maxRollover','Tối đa cộng dồn','limit','credits',true),field('credits','ttsPer100Chars','Phí TTS cho mỗi 100 ký tự','limit','credits'),field('credits','contentCost','Phí tạo nội dung','limit','credits'),
  field('content','enabled','Tạo nội dung AI','boolean'),field('content','maxInputChars','Đầu vào tối đa','limit','ký tự',true),field('content','maxOutputChars','Đầu ra tối đa','limit','ký tự',true),field('content','monthlyChars','Quota tạo nội dung hàng tháng','limit','ký tự/tháng',true),field('content','monthlyJobs','Số tác vụ nội dung mỗi tháng','limit','tác vụ/tháng',true),field('content','maxDurationSeconds','Thời lượng mục tiêu tối đa','limit','giây'),field('content','defaultDurationSeconds','Thời lượng mục tiêu mặc định','limit','giây'),field('content','advanced','Cấu trúc nâng cao và CTA','boolean'),field('content','creativeDirection','Creative brief và định hướng hình ảnh','boolean','',false,true),field('content','languages','Ngôn ngữ hỗ trợ','list'),field('content','modes','Chế độ hỗ trợ','list'),
  field('scenes','enabled','Tách phân cảnh','boolean'),field('scenes','maxScenes','Số phân cảnh tối đa mỗi lần tách','limit','cảnh'),field('scenes','maxNarrationChars','Lồng tiếng tối đa mỗi phân cảnh','limit','ký tự',true),
  field('prompts','imageEnabled','Tạo Prompt Hình ảnh','boolean'),field('prompts','videoEnabled','Tạo Prompt Video','boolean'),field('prompts','monthlyGenerations','Số lần tạo prompt hàng tháng','limit','lần/tháng',true),
  field('regeneration','enabled','Cho phép tạo lại (Regenerate)','boolean'),field('history','retention','Lưu trữ phiên bản','limit','bản lưu',true),
  field('storage','maxProjects','Dự án tối đa','limit','dự án',true),field('storage','maxWorkspaces','Workspace tối đa','limit','workspaces',true),field('storage','maxContents','Nội dung lưu tối đa','limit','nội dung',true),
  field('tts','enabled','Chuyển văn bản thành giọng nói (TTS)','boolean'),field('tts','maxTextChars','Văn bản tối đa mỗi tác vụ','limit','ký tự',true),field('tts','monthlyChars','Quota TTS hàng tháng','limit','ký tự/tháng',true),
  field('clone','enabled','Nhân bản giọng nói','boolean'),field('clone','maxVoices','Giọng nhân bản tối đa mỗi người dùng','limit','giọng',true),field('clone','monthlyEnrollments','Số lần tải mẫu giọng hàng tháng','limit','tệp/tháng',true),field('clone','minReferenceSeconds','Độ dài tối thiểu mẫu giọng','limit','giây',true),field('clone','maxReferenceSeconds','Độ dài tối đa mẫu giọng','limit','giây',true),field('clone','maxFileBytes','Dung lượng tối đa file mẫu','limit','bytes',true),field('clone','maxTextChars','Văn bản tối đa khi dùng giọng nhân bản','limit','ký tự',true),field('clone','monthlyChars','Quota nhân bản giọng hàng tháng','limit','ký tự/tháng',true),field('clone','monthlySeconds','Quota giây nhân bản hàng tháng','limit','giây/tháng',true),field('clone','concurrentJobs','Số tác vụ nhân bản đồng thời','limit','tác vụ',true),field('clone','premiumSystemVoices','Mở khóa giọng Premium','boolean'),
  field('limits','concurrentJobs','Số tác vụ đồng thời','limit','tác vụ',true),field('limits','concurrentAiJobs','Số tác vụ AI đồng thời','limit','tác vụ',true),field('limits','requestsPerMinute','Giới hạn Rate limit','limit','yêu cầu/phút',true),field('limits','queuePriority','Mức ưu tiên hàng đợi (càng thấp càng ưu tiên)','limit','mức'),
];
export function validatePlan(raw: unknown, tier: string): PlanConfig {
  if (!['FREE','BASIC_STUDENT','PLUS','PRO'].includes(tier) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PlanError('PLAN_INVALID');
  const input = raw as PlanConfig, result: PlanConfig = {}, invalid: string[] = [];
  for (const f of PLAN_FIELDS) {
    const value = f.section === 'overview' && f.key === 'popular' && input.overview?.popular === undefined ? false : input[f.section]?.[f.key], path = `${f.section}.${f.key}`;
    let valid = false;
    if (f.type === 'boolean') valid = typeof value === 'boolean';
    if (f.type === 'text') valid = typeof value === 'string' && value.length <= (f.key === 'description' ? 2000 : 100) && (f.key === 'description' || !!value.trim());
    if (f.type === 'list') valid = Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every(v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(v)) && new Set(value).size === value.length;
    if (f.type === 'number') valid = Number.isSafeInteger(value) && value >= 0;
    if (f.type === 'limit') valid = value === null ? !!f.nullable : Number.isSafeInteger(value) && value > 0;
    if (f.proOnly && tier !== 'PRO' && value !== false) valid = false;
    // Null means not applicable for disabled cloning, not an enabled unlimited entitlement.
    if (f.section === 'clone' && f.type === 'limit' && input.clone?.enabled === false) valid = value === null;
    if (!valid) invalid.push(path);
    (result[f.section] ||= {})[f.key] = typeof value === 'string' ? value.trim() : value;
  }
  for (const section of Object.keys(input)) {
    if(!PLAN_FIELDS.some(f=>f.section===section)||!input[section]||typeof input[section]!=='object'||Array.isArray(input[section]))invalid.push(section);
    for (const key of Object.keys(input[section] || {})) if (!PLAN_FIELDS.some(f => f.section === section && f.key === key)) invalid.push(`${section}.${key}`);
  }
  if (!/^[a-z][a-z0-9-]{1,49}$/.test(result.overview.slug)) invalid.push('overview.slug');
  if (result.content.defaultDurationSeconds > result.content.maxDurationSeconds) invalid.push('content.defaultDurationSeconds');
  if (result.clone.enabled && (result.clone.minReferenceSeconds === null || result.clone.maxReferenceSeconds === null || result.clone.maxFileBytes === null || result.clone.minReferenceSeconds > result.clone.maxReferenceSeconds || result.clone.minReferenceSeconds < 3 || result.clone.maxReferenceSeconds > 8 || result.clone.maxFileBytes > 4194304)) invalid.push('clone.reference');
  if (!result.credits.rolloverAllowed && result.credits.maxRollover !== null) invalid.push('credits.maxRollover');
  if (result.content.modes?.some((mode: string) => !['auto','aida','pas','storytelling'].includes(mode))) invalid.push('content.modes');
  if (invalid.length) throw new PlanError('PLAN_INVALID', 400, [...new Set(invalid)]);
  return result;
}
export function planDiff(before: PlanConfig | undefined, after: PlanConfig) {
  return PLAN_FIELDS.flatMap(f => {
    const a = before?.[f.section]?.[f.key], b = after[f.section][f.key];
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    const isCost=f.section==='credits'&&['ttsPer100Chars','contentCost'].includes(f.key);
    const restrictive = before && (typeof a === 'boolean' && a && !b || f.type === 'limit' && (a === null && b !== null || typeof a === 'number' && typeof b === 'number' && (isCost ? b > a : b < a)) || f.section==='pricing' && f.type==='number' && b>a || f.section==='credits' && f.key==='monthlyGrant' && b<a || f.type === 'list' && a.some((v: string) => !b.includes(v)));
    return [{ path: `${f.section}.${f.key}`, before: a ?? null, after: b, restrictive: !!restrictive }];
  });
}
