import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, CreditCard, Database, FileText, Info, Scale, Search, Shield, Sparkles, X } from 'lucide-react';
import content from '../content/policies.json';
import { PlanCatalogue } from '../components/PlanCatalogue';
import { useSEO } from '../hooks/useSEO';

const groups = [
  { title: 'Tài khoản & Dịch vụ', icon: Shield },
  { title: 'Gói & Thanh toán', icon: CreditCard },
  { title: 'AI & Creator', icon: Sparkles },
  { title: 'Nội dung & Bản quyền', icon: FileText },
  { title: 'Dữ liệu & Quyền riêng tư', icon: Database },
  { title: 'Pháp lý & Hỗ trợ', icon: Scale }
];
const titles: Record<string, string> = {
  terms: 'Điều khoản sử dụng', account: 'Tài khoản & Bảo mật', plans: 'Free, Plus & Pro', payments: 'Chính sách thanh toán',
  credits: 'Credit', 'credit-refunds': 'Hoàn Credit', refunds: 'Hoàn tiền', tax: 'Hóa đơn & Thuế',
  ai: 'Chính sách AI', scenes: 'Scene', 'image-prompts': 'Image Prompt', 'thumbnail-prompts': 'Thumbnail Prompt', 'video-prompts': 'Video Prompt',
  tts: 'Text to Speech', 'voice-clone': 'Voice Clone', 'user-content': 'Nội dung người dùng', output: 'Output của Veltrix',
  copyright: 'Bản quyền & Sở hữu trí tuệ', 'acceptable-use': 'Sử dụng chấp nhận được', privacy: 'Chính sách quyền riêng tư', cookies: 'Cookie',
  retention: 'Lưu trữ dữ liệu', deletion: 'Xóa tài khoản & dữ liệu', 'third-parties': 'Nhà cung cấp bên thứ ba',
  liability: 'Giới hạn trách nhiệm', complaints: 'Khiếu nại & Hỗ trợ', contact: 'Liên hệ pháp lý'
};
const documents = content.documents.map(document => ({ ...document, title: titles[document.id] }));
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => part.startsWith('**') ? <strong key={i} className="font-semibold text-slate-800">{part.slice(2, -2)}</strong> : part.startsWith('`') ? <code key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs break-words">{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>)}</>;
}
function PolicyText({ body }: { body: string }) {
  return <div className="space-y-4 text-sm sm:text-[15px] text-slate-600 leading-7">{body.split(/\n\s*\n/).map((block, index) => {
    const lines = block.trim().split('\n');
    if (!block.trim() || /^---$/.test(block.trim())) return null;
    if (lines[0].startsWith('## ')) return <h4 key={index} className="text-base font-semibold text-slate-900 pt-3"><Inline text={block.trim().replace(/^#{2,3}\s+/, '')} /></h4>;
    if (lines[0].startsWith('### ')) return <h5 key={index} className="font-semibold text-slate-800 pt-2"><Inline text={block.trim().slice(4)} /></h5>;
    if (lines.every(line => /^-\s/.test(line))) return <ul key={index} className="list-disc pl-5 space-y-1.5 marker:text-indigo-400">{lines.map((line, i) => <li key={i}><Inline text={line.slice(2)} /></li>)}</ul>;
    if (lines.every(line => /^>\s?/.test(line))) return <blockquote key={index} className="border-l-4 border-indigo-400 bg-indigo-50/60 rounded-r-lg px-4 py-3 text-indigo-900"><Inline text={lines.map(line => line.replace(/^>\s?/, '')).join(' ')} /></blockquote>;
    if (lines[0].startsWith('|') && lines.length > 2) {
      const rows = lines.filter(line => !/^\|[\s:|-]+\|$/.test(line)).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
      return <div key={index} className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-sm text-left"><caption className="sr-only">Ví dụ minh họa lịch sử Credit</caption><thead className="bg-slate-50"><tr>{rows[0].map((cell, i) => <th key={i} className="px-4 py-3 font-semibold"><Inline text={cell} /></th>)}</tr></thead><tbody>{rows.slice(1).map((row, i) => <tr key={i} className="border-t border-slate-100">{row.map((cell, j) => <td key={j} className="px-4 py-3"><Inline text={cell} /></td>)}</tr>)}</tbody></table></div>;
    }
    return <p key={index}><Inline text={lines.join(' ')} /></p>;
  })}</div>;
}

export const PoliciesPage = () => {
  const baseUrl = import.meta.env.VITE_APP_URL || 'https://veltrix.ai';

  useSEO({
    title: 'Chính Sách & Điều Khoản - Veltrix AI',
    description: 'Đọc chi tiết về điều khoản sử dụng, chính sách quyền riêng tư, và các quy định về dịch vụ, thanh toán, bản quyền của Veltrix AI.',
    canonical: `${baseUrl}/chinh-sach-dieu-khoan`,
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebPage",
          "name": "Chính Sách & Điều Khoản",
          "url": `${baseUrl}/chinh-sach-dieu-khoan`
        },
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            {
              "@type": "ListItem",
              "position": 1,
              "name": "Trang chủ",
              "item": `${baseUrl}/`
            },
            {
              "@type": "ListItem",
              "position": 2,
              "name": "Chính Sách",
              "item": `${baseUrl}/chinh-sach-dieu-khoan`
            }
          ]
        }
      ]
    }
  });

  const [params, setParams] = useSearchParams(); const [query, setQuery] = useState('');
  const active = documents.find(document => document.id === params.get('document'));
  const activeId = active?.id || 'overview'; const heading = useRef<HTMLHeadingElement>(null); const previous = useRef(activeId);
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
  const filtered = documents.filter(document => {
    const haystack = normalize([document.title, ...document.sections.flatMap(section => [section.title, section.body])].join(' '));
    return terms.every(term => haystack.includes(term));
  });
  const choose = (id: string) => { setQuery(''); setParams(id === 'overview' ? {} : { document: id }); };
  useEffect(() => {
    if (previous.current !== activeId) { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: 'start' }); previous.current = activeId; }
  }, [activeId]);
  const position = active ? documents.indexOf(active) : -1;
  return <div className="min-h-screen bg-[#F8FAFC] text-slate-800">
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200"><div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-3">
      <Link to="/" className="flex items-center gap-2.5 shrink-0"><img src="/logo-full.png" alt="Veltrix AI" className="h-[50px]" /></Link>
      <nav aria-label="Điều hướng chính" className="flex gap-4 text-sm font-medium"><Link to="/docs" className="text-slate-500 hover:text-indigo-600">Hướng dẫn</Link><Link to="/workspace" className="hidden sm:block text-indigo-600">Mở Workspace</Link></nav>
    </div></header>
    <main className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-10">
      <div className="mb-8 space-y-3"><p className="text-xs uppercase tracking-widest font-bold text-indigo-600">Veltrix AI</p><h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Trung tâm Chính sách & Điều khoản</h1><p className="max-w-3xl text-slate-500 leading-relaxed">Tài khoản, gói dịch vụ, Credit, sử dụng AI và quyền riêng tư. Chọn từng tài liệu để đọc các quy định áp dụng cho bạn.</p><div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500"><span>Cập nhật lần cuối: <time dateTime="2026-10-02">{content.updatedAt}</time></span><span>Có hiệu lực từ: <time dateTime="2026-10-02">{content.effectiveAt}</time></span></div></div>
      <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3 text-sm text-amber-900"><Info size={18} className="shrink-0 mt-0.5" /><p>Một số thông tin đang được hoàn thiện: Credit gói năm, thời hạn yêu cầu hoàn tiền, gia hạn mặc định và thông tin đơn vị vận hành. Email liên hệ hiện là địa chỉ minh họa, chưa phải kênh tiếp nhận yêu cầu.</p></div>
      <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-6 lg:gap-10 items-start">
        <aside className="lg:sticky lg:top-24 space-y-5">
          <div className="relative"><Search size={18} className="absolute left-3 top-3.5 text-slate-400" aria-hidden="true" /><input aria-label="Tìm kiếm chính sách" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm kiếm chính sách..." className="w-full bg-white rounded-xl border border-slate-200 pl-10 pr-10 py-3 text-sm focus:outline-2 focus:outline-indigo-500" />{query && <button onClick={() => setQuery('')} type="button" aria-label="Xóa tìm kiếm" className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-700"><X size={16} /></button>}</div>
          {query && <p role="status" className="text-xs text-slate-500">{filtered.length} tài liệu phù hợp</p>}
          <nav aria-label="Mục lục chính sách" className="space-y-5 lg:max-h-[calc(100dvh-200px)] lg:overflow-y-auto pr-1">
            {!query && <button onClick={() => choose('overview')} aria-current={!active ? 'page' : undefined} className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-left ${!active ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-white'}`}><BookOpen size={17} />Tổng quan chính sách</button>}
            {groups.map((group, number) => {
              const items = filtered.filter(document => document.group === number); const Icon = group.icon;
              return items.length > 0 && <div key={group.title}><h2 className="px-3 mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide font-bold text-slate-400"><Icon size={14} />{group.title}</h2><div className="space-y-1">{items.map(document => <button key={document.id} onClick={() => choose(document.id)} aria-current={activeId === document.id ? 'page' : undefined} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${activeId === document.id ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-white hover:text-indigo-600'}`}><span className="flex-1">{document.title}</span>{activeId === document.id && <ChevronRight size={14} />}</button>)}</div></div>;
            })}
          </nav>
        </aside>
        {filtered.length === 0 ? <section className="bg-white rounded-2xl border border-slate-200 p-10 text-center"><Search size={28} className="mx-auto mb-4 text-slate-300" /><h2 className="text-xl font-semibold mb-2">Không tìm thấy chính sách</h2><p className="text-sm text-slate-500 mb-5">Thử “credit”, “thanh toán” hoặc “dữ liệu”.</p><button onClick={() => setQuery('')} className="text-indigo-600 font-medium text-sm">Xem tất cả tài liệu</button></section> : <article className="min-w-0 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-9 space-y-8">
          <div className="border-b border-slate-100 pb-6 space-y-3"><p className="text-xs text-slate-500">Chính sách <span className="mx-1.5">/</span>{active ? groups[active.group].title : 'Tổng quan'}</p><h2 ref={heading} tabIndex={-1} className="text-2xl sm:text-3xl font-bold text-slate-900 scroll-mt-24 outline-none">{active?.title || 'Tổng quan chính sách'}</h2></div>
          {!active ? <>
            <PolicyText body={content.intro} />
            <section className="grid sm:grid-cols-2 gap-3" aria-label="Các nhóm chính sách">{groups.map((group, number) => { const Icon = group.icon; const items = documents.filter(document => document.group === number); return <button key={group.title} onClick={() => choose(items[0].id)} className="text-left p-5 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40"><Icon size={22} className="text-indigo-600 mb-3" /><span className="block text-sm font-semibold mb-1">{group.title}</span><span className="text-xs text-slate-500">{items.length} tài liệu</span></button>; })}</section>
            <div className="p-5 bg-indigo-50 rounded-xl text-sm text-indigo-900 leading-relaxed"><strong>Phạm vi sản phẩm:</strong> AI Content, Scene, TTS và prompt sáng tạo. Veltrix không trực tiếp tạo file hình ảnh hoặc render video. Chức năng và quyền lợi cụ thể phụ thuộc vào tính năng được cung cấp và gói đang sử dụng.</div>
          </> : <>
            {active.id === 'plans' && <p className="rounded-xl bg-indigo-50 p-4 text-sm text-indigo-900">Danh sách gói và quyền lợi hiện hành được đọc từ cấu hình bên dưới. Chính sách tự gia hạn mặc định chưa được công bố; nếu bật tự gia hạn, điều kiện phải hiển thị trước khi xác nhận thanh toán.</p>}
            {['credits', 'credit-refunds'].includes(active.id) && <p className="rounded-xl bg-indigo-50 p-4 text-sm text-indigo-900">Phí TTS tính theo mỗi nhóm 100 ký tự, làm tròn lên. Đơn giá, thời hạn và cộng dồn Credit theo phiên bản cấu hình của gói; yêu cầu đã tạo giữ nguyên giá. Các con số trong ví dụ dưới đây chỉ minh họa.</p>}
            {['plans', 'credits', 'credit-refunds'].includes(active.id) && <PlanCatalogue />}
            {active.id === 'contact' && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Email bên dưới chỉ để minh họa giao diện và chưa tiếp nhận thư hỗ trợ. Tên đơn vị vận hành và địa chỉ sẽ được bổ sung khi công bố.</p>}
            {active.sections.length > 1 && <nav aria-label="Trong tài liệu này" className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-500 mb-2">TRONG TÀI LIỆU NÀY</p><ul className="space-y-2">{active.sections.map(section => <li key={section.number}><a href={`#policy-${section.number}`} className="text-sm text-indigo-600 hover:underline">{section.title}</a></li>)}</ul></nav>}
            {active.sections.map(section => <section key={section.number} id={`policy-${section.number}`} className="scroll-mt-24 space-y-4"><h3 className="text-lg font-semibold text-slate-900">{section.title}</h3><PolicyText body={section.body} /></section>)}
          </>}
          <footer className="flex justify-between gap-4 border-t border-slate-100 pt-5 text-sm">{position >= 0 ? <button onClick={() => choose(position === 0 ? 'overview' : documents[position - 1].id)} className="flex items-center gap-2 text-slate-500 hover:text-indigo-600"><ArrowLeft size={15} className="shrink-0" />{position === 0 ? 'Tổng quan' : documents[position - 1].title}</button> : <span />}{position < documents.length - 1 && <button onClick={() => choose(documents[position + 1].id)} className="flex items-center gap-2 text-indigo-600 font-medium text-right">{documents[position + 1].title}<ArrowRight size={15} className="shrink-0" /></button>}</footer>
        </article>}
      </div>
      <footer className="mt-10 border-t border-slate-200 pt-6 flex flex-wrap justify-between gap-4 text-xs text-slate-500"><span>Veltrix AI · Chính sách & Điều khoản</span><Link to="/docs" className="hover:text-indigo-600">Đọc hướng dẫn sử dụng</Link></footer>
    </main>
  </div>;
};
