import {Link} from 'react-router-dom';
import {Code2, KeyRound, Mic, ArrowRight} from 'lucide-react';
import {DeveloperIntegration} from '../components/DeveloperIntegration';
import {useSEO} from '../hooks/useSEO';

export function DeveloperPage() {
  const baseUrl = import.meta.env.VITE_APP_URL || 'https://veltrix.ai';

  useSEO({
    title: 'Developer API - Veltrix AI',
    description: 'Tài liệu và API hướng dẫn dành cho nhà phát triển để tích hợp dịch vụ Text-to-Speech và Voice Clone của Veltrix AI vào ứng dụng của bạn.',
    canonical: `${baseUrl}/developer`,
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebPage",
          "name": "Developer API",
          "url": `${baseUrl}/developer`
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
              "name": "Developer API",
              "item": `${baseUrl}/developer`
            }
          ]
        }
      ]
    }
  });


  return <div className="min-h-screen bg-slate-50 text-slate-900"><header className="bg-white border-b px-6 py-5 flex flex-wrap gap-4 justify-between"><Link to="/" className="flex items-center gap-2"><img src="/logo-full.png" alt="Veltrix AI" className="h-[50px]" /></Link><nav className="flex gap-5 text-sm"><Link to="/docs?section=developer">Tài liệu API</Link><Link to="/account/settings">Quản lý token</Link></nav></header>
    <main className="max-w-5xl mx-auto px-6 py-16 space-y-12"><section className="max-w-3xl space-y-6"><p className="text-indigo-600 font-semibold flex items-center gap-2"><Code2 size={20}/>VELTRIX DEVELOPER</p><h1 className="text-4xl md:text-5xl font-bold leading-tight">Giọng đọc cho ứng dụng của bạn</h1><p className="text-lg text-slate-500 leading-8">Tích hợp TTS tiếng Việt qua REST API. Sử dụng giọng hệ thống hoặc giọng clone của tài khoản, theo dõi tác vụ và tải audio WAV.</p><Link to="/account/settings" className="inline-flex items-center gap-2 bg-indigo-600 text-white rounded-xl px-5 py-3">Tạo API token <ArrowRight size={18}/></Link></section>
    <section className="grid md:grid-cols-3 gap-5">{[{icon:KeyRound,title:'1. Tạo token',text:'Chọn quyền và hạn dùng trong Cài đặt tài khoản.'},{icon:Mic,title:'2. Chọn giọng',text:'Lấy danh sách giọng và kiểm tra quyền sử dụng của gói.'},{icon:Code2,title:'3. Tạo và tải audio',text:'Gửi văn bản, theo dõi tác vụ và tải WAV khi hoàn tất.'}].map(c=><div key={c.title} className="bg-white border rounded-2xl p-6"><c.icon className="text-indigo-600"/><h2 className="font-semibold mt-4">{c.title}</h2><p className="text-sm text-slate-500 mt-2 leading-6">{c.text}</p></div>)}</section>
    <div className="bg-white border rounded-2xl p-6 md:p-8"><DeveloperIntegration/></div></main></div>;
}
