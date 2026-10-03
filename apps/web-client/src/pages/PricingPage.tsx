import {Link} from 'react-router-dom';
import {PlanCards} from '../components/PlanCards';
import {useSEO} from '../hooks/useSEO';

export function PricingPage(){
  const baseUrl = import.meta.env.VITE_APP_URL || 'https://veltrix.ai';

  useSEO({
    title: 'Bảng Giá - Veltrix AI',
    description: 'Bảng giá linh hoạt cho mọi nhu cầu sáng tạo với Veltrix AI. Trải nghiệm gói Free, gói Sinh viên, Plus và Pro với chi phí tối ưu, thanh toán qua VNPay.',
    canonical: `${baseUrl}/pricing`,
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebPage",
          "name": "Bảng Giá",
          "url": `${baseUrl}/pricing`
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
              "name": "Bảng Giá",
              "item": `${baseUrl}/pricing`
            }
          ]
        }
      ]
    }
  });
return <main className="min-h-screen bg-slate-50"><header className="bg-white border-b border-slate-100 flex justify-between items-center px-6 py-5"><Link to="/" className="flex items-center gap-2"><img src="/logo-full.png" alt="Veltrix AI" className="h-[50px]" /></Link><Link to="/workspace" className="text-sm text-indigo-600 font-medium">Mở không gian sáng tạo →</Link></header><PlanCards/></main>;}
