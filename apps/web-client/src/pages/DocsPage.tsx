import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PlanCatalogue } from '../components/PlanCatalogue';
import {DeveloperIntegration} from '../components/DeveloperIntegration';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, FileText, FolderOpen, Layers, Mic, Search, Volume2, Wallet, Wrench, X } from 'lucide-react';
import { useSEO } from '../hooks/useSEO';

const guides = [
  {id:'developer',group:'Developer',title:'Tích hợp API TTS',icon:Volume2,path:'/account/settings',description:'Tạo giọng đọc từ ứng dụng của bạn bằng REST API và token riêng.',steps:['Mở Cài đặt tài khoản, tạo API token với quyền phù hợp và hạn dùng. Sao chép token ngay khi tạo.','Lưu token trong biến môi trường ở máy chủ của ứng dụng.','Lấy danh sách giọng, tạo tác vụ TTS rồi theo dõi trạng thái để tải WAV.'],notes:['API dùng cùng Credit và quyền gói với Workspace.','Chỉ xem và tải tác vụ của tài khoản sở hữu token. Có thể thu hồi token bất kỳ lúc nào trong Cài đặt.'],related:['tts','credits','help']},
  {
    id: 'start', group: 'Bắt đầu', title: 'Bắt đầu với Veltrix AI', icon: BookOpen,
    description: 'Hiểu cấu trúc ứng dụng và chọn luồng phù hợp với công việc của bạn.',
    steps: [
      'Đăng nhập để sử dụng Workspace và các công cụ sáng tạo.',
      'Nếu cần làm kịch bản video: tạo Dự án, viết kịch bản, rồi chuyển sang Chia cảnh & Tạo Audio.',
      'Nếu đã có văn bản và chỉ cần lời đọc: mở Text to Speech (TTS), chọn giọng và tạo audio.',
      'Mở Quản lý Giọng đọc để nghe các giọng hệ thống hoặc tạo giọng clone riêng nếu gói của bạn hỗ trợ.'
    ],
    notes: ['Mỗi dự án chứa nội dung và các phân cảnh của ý tưởng đó. TTS độc lập có lịch sử riêng, không bắt buộc tạo dự án.'],
    related: ['workspace', 'script', 'tts']
  },
  {
    id: 'workspace', group: 'Studio / Dự án', title: 'Quản lý Workspace', icon: FolderOpen, path: '/workspace',
    description: 'Tạo, mở, đổi tên và xóa dự án. Một tài khoản có thể làm việc với nhiều dự án.',
    steps: [
      'Bấm Tạo Dự án mới ở thanh bên, nhập tên và xác nhận. Hệ thống mở bản nháp của dự án trong Studio.',
      'Mở Quản lý Workspace để xem danh sách. Bấm một thẻ dự án để tiếp tục nội dung đã lưu.',
      'Bấm dấu ba chấm trên thẻ, chọn Đổi tên, nhập tên mới rồi bấm Lưu tên.',
      'Để xóa: chọn Xóa dự án và nhập chính xác tên đang hiển thị. Nút xác nhận chỉ bật khi tên khớp.'
    ],
    notes: ['Kiểm tra đúng dự án trước khi xác nhận xóa. Nếu một dự án chưa có nội dung, trang sẽ thông báo thay vì mở một kịch bản khác.'],
    related: ['script', 'scenes']
  },
  {
    id: 'script', group: 'Studio / Dự án', title: 'Studio Viết kịch bản', icon: FileText, path: '/content',
    description: 'Tạo kịch bản từ chủ đề, nền tảng, đối tượng người xem và tone giọng.',
    steps: [
      'Mở bản nháp từ dự án hoặc chọn Studio Viết kịch bản trên thanh bên.',
      'Nhập Chủ đề cụ thể. Chọn Nền tảng: TikTok, YouTube Shorts hoặc Reels.',
      'Mô tả Đối tượng người xem và chọn Tone giọng. Các thông tin này được gửi cùng chủ đề để AI viết kịch bản.',
      'Chọn thời lượng trong giới hạn gói đang dùng. Khi được bật, cấu hình nâng cao cho phép chọn số cảnh, cấu trúc AIDA/PAS/kể chuyện, CTA, định hướng sáng tạo và phong cách hình ảnh. Xem bảng quyền lợi hiện hành bên dưới.',
      'Bấm Viết nội dung bằng AI và chờ kết quả. Kịch bản gồm các phân cảnh với lời đọc và mô tả hình ảnh. Thời lượng là ước tính; tốc độ giọng đọc thực tế có thể khác.',
      'Đọc lại nội dung, bấm Lưu bản nháp khi cần, rồi chọn Chia cảnh & Tạo Audio để chỉnh lời đọc và tạo âm thanh.'
    ],
    notes: ['Nếu bắt đầu mà chưa có dự án, hệ thống tự tạo dự án từ tối đa 10 từ đầu của chủ đề.', 'Số cảnh theo kết quả AI, không cố định 4 cảnh. Nội dung do AI tạo cần được kiểm tra lại trước khi sử dụng.'],
    related: ['scenes', 'credits']
  },
  {
    id: 'scenes', group: 'Studio / Dự án', title: 'Chia cảnh & Tạo Audio', icon: Layers,
    description: 'Chỉnh lời đọc, chọn giọng và tạo WAV cho từng cảnh trong kịch bản đã mở.',
    steps: [
      'Từ một kịch bản đã tạo, bấm Chia cảnh & Tạo Audio. Trang này luôn gắn với nội dung đang mở.',
      'Chọn Giọng mặc định. Bấm Áp dụng giọng cho tất cả nếu muốn lưu cùng một giọng cho mọi cảnh.',
      'Ở từng cảnh, sửa Lời đọc và chọn giọng. Ô chọn hiển thị thẻ có avatar, thông tin giọng và audio nghe mẫu nếu có.',
      'Kiểm tra Credit dự kiến rồi bấm Tạo giọng đọc. Lời đọc và giọng được lưu trước khi tạo audio.',
      'Khi hoàn tất, nghe kết quả và tải WAV của cảnh. Nếu sửa lời đọc hoặc đổi giọng, tạo lại audio để khớp với nội dung mới.',
      'Sau khi tất cả các cảnh có audio khớp với nội dung đã lưu và không còn tác vụ đang chạy, bấm Xuất toàn bộ Audio để tải bản ghép.'
    ],
    notes: ['Bấm vào tên trên thẻ để chọn giọng. Bấm nghe mẫu chỉ phát mẫu, không đổi giọng đã chọn.', 'Prompt Hình ảnh và Prompt Video có thể sao chép để dùng với công cụ khác. Trang này không tự tạo hình ảnh hoặc video.'],
    related: ['voices', 'credits', 'help']
  },
  {
    id: 'tts', group: 'Công cụ tiện ích', title: 'Text to Speech (TTS)', icon: Volume2, path: '/tts',
    description: 'Chuyển văn bản có sẵn thành giọng nói mà không cần tạo kịch bản hay dự án.',
    steps: [
      'Mở Text to Speech (TTS) và nhập văn bản vào ô Nội dung. Thêm dấu câu để lời đọc ngắt nghỉ rõ hơn.',
      'Mở ô Giọng đọc. Nghe mẫu trên thẻ nếu có, rồi bấm vào tên giọng để chọn.',
      'Kiểm tra Credit dự kiến. Bấm Tạo giọng đọc một lần và theo dõi trạng thái xử lý.',
      'Trong Lịch sử tạo giọng, nghe audio đã hoàn tất hoặc tải file WAV về máy. Kết quả được lưu để mở lại sau.'
    ],
    notes: ['Audio nghe mẫu đã có sẵn khác với audio mới tạo từ văn bản của bạn. Nghe mẫu không phải là một yêu cầu tạo TTS mới.', 'Giọng clone sẵn sàng của bạn xuất hiện khi cấu hình gói cho phép sử dụng clone.'],
    related: ['voices', 'credits', 'help']
  },
  {
    id: 'voices', group: 'Công cụ tiện ích', title: 'Quản lý Giọng đọc', icon: Mic, path: '/voices',
    description: 'Nghe giọng hệ thống và quản lý các giọng nhân bản thuộc tài khoản của bạn.',
    steps: [
      'Trong Giọng hệ thống, xem avatar, tên, ngôn ngữ và giới tính. Dùng trình phát trên thẻ để nghe mẫu có sẵn.',
      'Khi gói được bật quyền clone, bấm Tạo giọng Clone mới và đặt tên dễ nhận biết.',
      'Chọn file WAV rõ tiếng, một người nói, đáp ứng thời lượng và dung lượng trong cấu hình hiện hành. Trình duyệt kiểm tra mẫu và chuyển sang PCM16 trước khi gửi.',
      'Xác nhận đồng ý nhân bản và xác nhận bạn sở hữu hoặc được phép sử dụng giọng nói đó. Sau đó bấm Tạo giọng của tôi.',
      'Chờ giọng chuyển từ Đang tạo giọng sang Sẵn sàng. Chọn giọng này ở TTS hoặc Chia cảnh để tạo lời đọc.',
      'Dùng Thu hồi để ngừng sử dụng giọng, hoặc Xóa để gỡ giọng. Mẫu âm thanh được dọn sau khi thu hồi hoặc xóa.'
    ],
    notes: ['Mẫu clone được lưu riêng, không có liên kết công khai. Chỉ tài khoản sở hữu được dùng và quản lý giọng đó.', 'Tạo giọng clone không có phí credit riêng; tạo lời đọc bằng giọng clone vẫn tính phí TTS. Giọng đã thu hồi không thể dùng để tạo audio mới.', 'Thu hồi giọng không xóa các lời đọc đã tạo trước đó.'],
    related: ['tts', 'scenes', 'help']
  },
  {
    id: 'credits', group: 'Tài khoản & Hỗ trợ', title: 'Cách tính Credit', icon: Wallet,
    description: 'Phân biệt phí tạo kịch bản, phí tạo lời đọc và credit đang được giữ cho tác vụ.',
    steps: [
      'Xem số dư ở cuối thanh bên trước khi tạo nội dung hoặc audio.',
      'Phí tạo kịch bản lấy từ cấu hình gói, hiển thị trên nút trong Studio và bảng quyền lợi hiện hành.',
      'TTS tính phí theo mỗi nhóm tối đa 100 ký tự, làm tròn lên; đơn giá lấy từ cấu hình gói. Khoảng trắng ở đầu và cuối văn bản được bỏ trước khi tính.',
      'Credit được giữ khi tác vụ TTS nhận xử lý và chốt khi thành công. Nếu tác vụ thất bại, phần credit đã giữ được giải phóng.',
      'Đọc Credit dự kiến trên màn hình trước khi xác nhận. Nghe mẫu giọng và tạo bản ghi giọng clone không có phí TTS.'
    ],
    notes: ['Tạo lại audio từ lời đọc là một lần tạo mới có phí. Việc nghe hoặc tải lại audio đã lưu không yêu cầu tạo lại.'],
    related: ['tts', 'scenes']
  },
  {
    id: 'help', group: 'Tài khoản & Hỗ trợ', title: 'Xử lý lỗi thường gặp', icon: Wrench,
    description: 'Kiểm tra theo triệu chứng và trạng thái tác vụ để tiếp tục làm việc.',
    steps: [
      'Không đăng nhập được hoặc phiên hết hạn: quay lại trang đăng nhập và thử lại. Nếu vẫn lỗi, ghi nhận thông báo hiển thị.',
      'Không chọn được giọng: đợi danh sách tải xong. Giọng clone chỉ dùng khi đã sẵn sàng và gói tài khoản hỗ trợ.',
      'Mẫu clone bị từ chối: đọc lỗi ngay trong hộp thoại; kiểm tra WAV, thời lượng 3–8 giây, kích thước tối đa 4 MB và hai ô xác nhận quyền sử dụng.',
      'Tác vụ đang xử lý lâu: kiểm tra trạng thái và lịch sử trước khi bấm tạo lại. Một yêu cầu mới có thể phát sinh phí mới.',
      'Audio không phát được: kiểm tra kết nối và phiên đăng nhập, rồi tải lại trang. Có thể thử tải WAV để kiểm tra file đã lưu.',
      'Tạo audio thất bại: xem thông báo trong lịch sử hoặc ở cảnh, đợi dịch vụ hoạt động lại rồi thử lại. Credit của tác vụ TTS thất bại được giải phóng.',
      'Cần báo lỗi: gửi tên trang, bước thao tác và thông báo lỗi. Không gửi mật khẩu, cookie, token hoặc mẫu giọng riêng tư.'
    ],
    notes: ['Nếu đang chờ dọn mẫu âm thanh, giọng đã thu hồi vẫn không dùng được để tạo audio mới.'],
    related: ['voices', 'credits']
  }
];
const groups = ['Bắt đầu', 'Studio / Dự án', 'Công cụ tiện ích', 'Tài khoản & Hỗ trợ', 'Developer'];
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

export const DocsPage = () => {
  const baseUrl = import.meta.env.VITE_APP_URL || 'https://veltrix.ai';

  useSEO({
    title: 'Tài liệu hướng dẫn & Hỗ trợ - Veltrix AI',
    description: 'Trung tâm hỗ trợ và tài liệu hướng dẫn sử dụng Veltrix AI. Tìm hiểu cách tạo kịch bản, chia cảnh, render TTS, voice clone và tích hợp API Developer.',
    canonical: `${baseUrl}/docs`,
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebPage",
          "name": "Tài liệu hướng dẫn & Hỗ trợ",
          "url": `${baseUrl}/docs`
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
              "name": "Tài liệu API",
              "item": `${baseUrl}/docs`
            }
          ]
        }
      ]
    }
  });

  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const article = useRef<HTMLHeadingElement>(null);
  const active = guides.find(guide => guide.id === params.get('section')) || guides.find(guide=>guide.id==='start')!;
  const previous = useRef(active.id);
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
  const filtered = guides.filter(guide => {
    const text = normalize([guide.title, guide.description, ...guide.steps, ...guide.notes].join(' '));
    return terms.every(term => text.includes(term));
  });
  const choose = (id: string) => { setQuery(''); setParams({ section: id }); };
  useEffect(() => {
    if (previous.current !== active.id) {
      article.current?.focus({ preventScroll: true });
      article.current?.scrollIntoView({ block: 'start' });
      previous.current = active.id;
    }
  }, [active.id]);
  const index = guides.indexOf(active);
  const Icon = active.icon;
  return <div className="min-h-screen bg-[#F8FAFC] text-slate-800">
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="max-w-7xl mx-auto h-16 px-4 sm:px-8 flex items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2.5 shrink-0"><img src="/logo-full.png" alt="Veltrix AI" className="h-[50px]" /></Link>
        <nav aria-label="Điều hướng chính" className="flex items-center gap-4 text-sm font-medium">
          <Link to="/" className="hidden sm:block text-slate-500 hover:text-indigo-600">Trang chủ</Link>
          <Link to="/workspace" className="rounded-lg bg-indigo-600 text-white px-3 sm:px-4 py-2 hover:bg-indigo-700">Mở Workspace</Link>
        </nav>
      </div>
    </header>
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-10">
      <div className="mb-8 space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Hướng dẫn sử dụng · Veltrix TTS</p>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Từ ý tưởng đến lời đọc</h1>
        <p className="text-slate-500 max-w-2xl leading-relaxed">Làm việc theo dự án, viết kịch bản, chia cảnh và tạo audio. Hướng dẫn được sắp xếp theo đúng các mục trong ứng dụng.</p>
      </div>
      <div className="grid lg:grid-cols-[260px_minmax(0,1fr)] gap-6 lg:gap-10 items-start">
        <aside className="lg:sticky lg:top-24 space-y-5">
          <div className="relative">
            <Search size={18} aria-hidden="true" className="absolute left-3 top-3.5 text-slate-400" />
            <input aria-label="Tìm kiếm hướng dẫn" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm kiếm hướng dẫn..." className="w-full bg-white rounded-xl border border-slate-200 pl-10 pr-10 py-3 text-sm focus:outline-2 focus:outline-indigo-500" />
            {query && <button type="button" aria-label="Xóa tìm kiếm" onClick={() => setQuery('')} className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-700"><X size={16} /></button>}
          </div>
          {query && <p role="status" className="text-xs text-slate-500">{filtered.length} hướng dẫn phù hợp</p>}
          <nav aria-label="Mục lục hướng dẫn" className="space-y-5 lg:max-h-[calc(100dvh-220px)] lg:overflow-y-auto pr-1">
            {groups.map(group => {
              const items = filtered.filter(guide => guide.group === group);
              return items.length > 0 && <div key={group}><h2 className="text-[11px] uppercase tracking-wider font-bold text-slate-400 px-3 mb-2">{group}</h2><div className="space-y-1">{items.map(guide => {
                const ItemIcon = guide.icon;
                return <button type="button" key={guide.id} aria-current={active.id === guide.id ? 'page' : undefined} onClick={() => choose(guide.id)} className={`w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${active.id === guide.id ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-white hover:text-indigo-600'}`}><ItemIcon size={17} aria-hidden="true" className="shrink-0" /><span className="flex-1">{guide.title}</span>{active.id === guide.id && <ChevronRight size={14} aria-hidden="true" />}</button>;
              })}</div></div>;
            })}
          </nav>
        </aside>
        {!filtered.length ? <div className="rounded-2xl bg-white border border-slate-200 p-8 sm:p-12 text-center"><Search size={28} className="mx-auto text-slate-300 mb-4" /><h2 className="text-xl font-semibold mb-2">Không tìm thấy hướng dẫn</h2><p className="text-sm text-slate-500 mb-5">Thử từ khóa ngắn hơn, ví dụ “giọng”, “credit” hoặc “dự án”.</p><button onClick={() => setQuery('')} className="text-indigo-600 font-medium text-sm">Xem tất cả hướng dẫn</button></div>
          : <article className="min-w-0 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-9 space-y-8">
            <div className="border-b border-slate-100 pb-6 space-y-3">
              <p className="text-xs font-medium text-slate-500">Hướng dẫn <span className="mx-1.5">/</span> {active.group}</p>
              <h2 ref={article} tabIndex={-1} className="scroll-mt-24 text-2xl sm:text-3xl font-bold text-slate-900 outline-none flex items-center gap-3"><Icon size={26} className="text-indigo-600 shrink-0" />{active.title}</h2>
              <p className="text-slate-600 text-sm sm:text-base leading-relaxed">{active.description}</p>
              {active.path && <Link to={active.path} className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:underline">Mở {active.title}<ArrowRight size={16} /></Link>}
            </div>
            {active.id === 'start' && <section aria-label="Quy trình sáng tạo" className="grid sm:grid-cols-3 gap-3">{[{ id: 'workspace', name: '1. Tạo dự án', text: 'Một ý tưởng, một không gian làm việc.' }, { id: 'script', name: '2. Viết kịch bản', text: 'Chủ đề, người xem và tone giọng.' }, { id: 'scenes', name: '3. Tạo audio', text: 'Chọn giọng, tạo WAV và xuất lời đọc.' }].map(step => <button key={step.id} onClick={() => choose(step.id)} className="text-left rounded-xl bg-indigo-50/60 border border-indigo-100 p-4 hover:bg-indigo-100/60"><span className="block text-sm font-semibold text-indigo-700">{step.name}</span><span className="block mt-2 text-xs leading-relaxed text-slate-600">{step.text}</span></button>)}</section>}
            <section><h3 className="font-semibold text-lg text-slate-900 mb-5">{active.id === 'help' ? 'Kiểm tra và xử lý' : 'Cách thực hiện'}</h3><ol className="space-y-5">{active.steps.map((step, number) => <li key={step} className="flex items-start gap-3 sm:gap-4"><span aria-hidden="true" className="flex items-center justify-center shrink-0 w-7 h-7 rounded-full bg-indigo-50 text-indigo-700 font-semibold text-xs">{number + 1}</span><p className="text-sm sm:text-[15px] text-slate-600 leading-7">{step}</p></li>)}</ol></section>
            {active.id === 'developer' && <DeveloperIntegration />}
            {['start','script','tts','voices','credits'].includes(active.id) && <PlanCatalogue />}
            <section className="rounded-xl border border-slate-200 bg-slate-50 p-5"><h3 className="text-sm font-semibold mb-3">Cần biết</h3><ul className="space-y-3">{active.notes.map(note => <li key={note} className="flex gap-2.5 text-sm leading-relaxed text-slate-600"><Check size={16} aria-hidden="true" className="shrink-0 mt-0.5 text-indigo-500" />{note}</li>)}</ul></section>
            <section><h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Hướng dẫn liên quan</h3><div className="flex flex-wrap gap-2">{active.related.map(id => { const guide = guides.find(item => item.id === id)!; return <button key={id} onClick={() => choose(id)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:text-indigo-600 hover:border-indigo-300">{guide.title}</button>; })}</div></section>
            <footer className="flex justify-between gap-4 border-t border-slate-100 pt-5 text-sm">{index > 0 ? <button onClick={() => choose(guides[index - 1].id)} className="flex items-center gap-2 text-slate-500 hover:text-indigo-600"><ArrowLeft size={15} />{guides[index - 1].title}</button> : <span />}{index < guides.length - 1 && <button onClick={() => choose(guides[index + 1].id)} className="flex items-center gap-2 text-indigo-600 font-medium text-right">{guides[index + 1].title}<ArrowRight size={15} className="shrink-0" /></button>}</footer>
          </article>}
      </div>
      <footer className="mt-10 pt-6 border-t border-slate-200 flex flex-wrap gap-4 justify-between text-xs text-slate-500"><span>Veltrix AI · Hướng dẫn sử dụng</span><Link to="/chinh-sach-dieu-khoan" className="hover:text-indigo-600">Chính sách & Điều khoản</Link></footer>
    </div>
  </div>;
};
