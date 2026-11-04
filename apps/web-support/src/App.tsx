import {useEffect, useRef, useState} from 'react';
import {ArrowDown, ArrowLeft, ArrowRight, AudioLines, BookOpen, Check, ChevronDown, ChevronRight, Code2, Copy, CreditCard, ExternalLink, FileText, Headphones, LifeBuoy, Menu, Search, ShieldCheck, Sparkles, X} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {articles, normalizeSearch} from './articles';
import type {Article, CategoryId} from './articles';
import {clientUrl, developerUrl, docsUrl, supportContactUrl} from './config';
import {SupportChat} from './SupportChat';
import {supportLoginUrl, useSupportSession} from './SupportSession';

const categories: {id: CategoryId; title: string; description: string; icon: LucideIcon; color: string}[] = [
  {id: 'start', title: 'Bắt đầu với Veltrix', description: 'Làm quen Workspace và quy trình sáng tạo.', icon: Sparkles, color: 'violet'},
  {id: 'content', title: 'Nội dung & kịch bản', description: 'Cấu hình nội dung, lời thoại và phân cảnh.', icon: FileText, color: 'blue'},
  {id: 'voice', title: 'Giọng đọc & Voice Clone', description: 'Tạo audio, nhân bản giọng và tải kết quả.', icon: AudioLines, color: 'cyan'},
  {id: 'billing', title: 'Gói cước & Credit', description: 'Số dư, thanh toán và quyền lợi tài khoản.', icon: CreditCard, color: 'amber'},
  {id: 'account', title: 'Tài khoản & bảo mật', description: 'Đăng nhập, bảo vệ và chính sách tài khoản.', icon: ShieldCheck, color: 'green'},
  {id: 'developer', title: 'Developer API', description: 'Tạo token và tích hợp TTS vào ứng dụng.', icon: Code2, color: 'indigo'},
];

const faqs = [
  {question: 'Tác vụ thất bại có bị trừ Credit không?', answer: 'Khi tác vụ thất bại và hệ thống thông báo Credit tạm giữ đã được giải phóng, khoản giữ được trả về số dư khả dụng. Kiểm tra lịch sử giao dịch và mã tác vụ để đối chiếu.', article: 'credit-holds'},
  {question: 'Tại sao tài khoản Free không đăng nhập được trên mạng của tôi?', answer: 'Mỗi IP được liên kết tối đa 3 tài khoản Free duy nhất trong tháng. Khi đã đủ 3 tài khoản, tài khoản Free mới không được đăng nhập từ IP đó. Tài khoản trong danh sách vẫn đăng nhập được; đây không phải lệnh khóa tài khoản.', article: 'free-ip-policy'},
  {question: 'Tôi cần chuẩn bị gì trước khi tạo giọng clone?', answer: 'Chuẩn bị mẫu WAV rõ tiếng, ít tạp âm, không có nhạc nền và xác nhận bạn có quyền sử dụng giọng. Kiểm tra giới hạn mẫu và quyền lợi của gói ngay trong form tạo giọng.', article: 'clone-voice'},
  {question: 'API trả về jobId, lấy file audio ở đâu?', answer: 'Tạo audio là tác vụ bất đồng bộ. Dùng jobId để kiểm tra trạng thái mỗi 3–5 giây. Khi COMPLETED, tải WAV qua endpoint audio với cùng Bearer token. Tài liệu Developer có mẫu tích hợp cho môi trường hiện tại.', article: 'developer-token'},
];

function currentArticleId() {
  return new URL(window.location.href).searchParams.get('article');
}

export function App() {
  const {user, logout} = useSupportSession();
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [articleId, setArticleId] = useState(currentArticleId);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryId | 'all'>('all');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notice, setNotice] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedArticle = articles.find(article => article.id === articleId);

  function navigateArticle(id: string | null) {
    const url = new URL(window.location.href);
    url.hash = '';
    if (id) url.searchParams.set('article', id);
    else url.searchParams.delete('article');
    window.history.pushState(null, '', url);
    setArticleId(id);
    setMobileMenu(false);
    window.scrollTo({top: 0, behavior: 'instant'});
  }

  function focusSearch() {
    setMobileMenu(false);
    if (articleId) navigateArticle(null);
    window.setTimeout(() => {searchRef.current?.focus(); searchRef.current?.scrollIntoView({block: 'center', behavior: 'smooth'});}, 0);
  }

  useEffect(() => {
    const onPopState = () => {setArticleId(currentArticleId()); window.scrollTo(0, 0);};
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const url = new URL(window.location.href);
        url.hash = '';
        if (url.searchParams.has('article')) {
          url.searchParams.delete('article');
          window.history.pushState(null, '', url);
          setArticleId(null);
        }
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (event.key === 'Escape') setMobileMenu(false);
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKey);
    return () => {window.removeEventListener('popstate', onPopState); window.removeEventListener('keydown', onKey);};
  }, []);

  useEffect(() => {
    document.title = `${selectedArticle?.title || 'Trung tâm trợ giúp'} · Veltrix AI`;
  }, [selectedArticle]);

  useEffect(() => {
    if (!mobileMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMobileMenu(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [mobileMenu]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function copyArticleLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setNotice('Đã sao chép liên kết hướng dẫn.');
    } catch {
      setNotice('Không thể sao chép. Bạn có thể sao chép địa chỉ trên thanh trình duyệt.');
    }
  }

  const words = normalizeSearch(query.trim()).split(/\s+/).filter(Boolean);
  const filteredArticles = articles.filter(article => {
    const categoryTitle = categories.find(item => item.id === article.category)?.title || '';
    const searchable = normalizeSearch(`${article.title} ${article.summary} ${categoryTitle} ${article.sections.map(section => `${section.title} ${section.text}`).join(' ')}`);
    return (category === 'all' || article.category === category) && words.every(word => searchable.includes(word));
  });
  const filtering = query.trim() || category !== 'all';
  const recommended = filtering ? filteredArticles : articles.filter(article => ['first-project', 'voice-download', 'credit-holds', 'free-ip-policy'].includes(article.id));

  function pickCategory(id: CategoryId | 'all') {
    setCategory(id);
    document.getElementById('guides')?.scrollIntoView({behavior: 'smooth', block: 'start'});
  }

  const externalLinks = {docs: docsUrl, developer: developerUrl, client: clientUrl};

  return <>
    <header className="site-header">
      <div className="header-inner">
        <button className="brand" onClick={() => {navigateArticle(null); setQuery(''); setCategory('all');}} aria-label="Veltrix AI · Trang chủ trợ giúp">
          <img className="brand-full-logo" src="/logo-full.png" width="62" height="62" alt="Veltrix AI" />
          <span className="brand-divider" /><span className="brand-section">Help Center</span>
        </button>
        <nav id="header-nav" className="header-nav" aria-label="Điều hướng chính">
          {docsUrl && <a href={docsUrl}>Tài liệu <ExternalLink size={13} /></a>}
          {developerUrl && <a href={developerUrl}>Developer</a>}
          {clientUrl && <a className="button button-dark button-small" href={clientUrl}>Về ứng dụng <ArrowUpRight /></a>}
        </nav>
        {user ? <span className="support-account" title={user.email}><span className="support-account-avatar">{(user.displayName || user.email).slice(0, 1).toUpperCase()}</span><span>{user.displayName || user.email}</span></span> : supportLoginUrl() && <a className="support-login" href={supportLoginUrl()!}>Đăng nhập</a>}
        <div className="quick-menu-wrap" ref={menuRef}>
          <button className="menu-button icon-button" onClick={() => setMobileMenu(value => !value)} aria-label={mobileMenu ? 'Đóng menu' : 'Mở menu'} aria-expanded={mobileMenu} aria-controls="quick-menu">{mobileMenu ? <X size={21} /> : <Menu size={21} />}</button>
          {mobileMenu && <nav id="quick-menu" className="quick-menu" aria-label="Menu nhanh">
            <span className="section-kicker">TRUNG TÂM TRỢ GIÚP</span>
            <button onClick={() => {navigateArticle(null); setQuery(''); setCategory('all');}}><LifeBuoy size={17} />Trang chủ trợ giúp</button>
            <button onClick={focusSearch}><Search size={17} />Tìm kiếm hướng dẫn<kbd>Ctrl / ⌘ K</kbd></button>
            <div className="quick-menu-divider" />
            {docsUrl && <a href={docsUrl}><BookOpen size={17} />Tài liệu<ExternalLink size={13} /></a>}
            {developerUrl && <a href={developerUrl}><Code2 size={17} />Developer<ExternalLink size={13} /></a>}
            {clientUrl && <a href={clientUrl}><ArrowRight size={17} />Về ứng dụng<ExternalLink size={13} /></a>}
            <div className="quick-menu-divider" />
            {user ? <><span className="quick-menu-account">{user.email}</span><button onClick={() => {setLogoutConfirm(true); setMobileMenu(false);}}>Đăng xuất tài khoản Creator</button></> : supportLoginUrl() && <a href={supportLoginUrl()!}>Đăng nhập bằng Creator<ArrowRight size={17} /></a>}
          </nav>}
        </div>
      </div>
    </header>

    {!articleId ? <main>
      <section className="hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-inner">
          <div className="eyebrow"><span className="eyebrow-dot" /> TRUNG TÂM TRỢ GIÚP VELTRIX</div>
          <h1>Sáng tạo dễ dàng hơn.<br /><span>Chúng tôi ở đây để giúp bạn.</span></h1>
          <p className="hero-description">Tìm câu trả lời, khám phá hướng dẫn và tiếp tục ý tưởng của bạn.</p>
          <div className="search-box">
            <Search size={22} aria-hidden="true" />
            <input ref={searchRef} value={query} onChange={event => {setQuery(event.target.value); setCategory('all');}} type="search" aria-label="Tìm kiếm hướng dẫn" placeholder="Bạn đang cần hỗ trợ điều gì?" autoComplete="off" />
            <kbd aria-hidden="true">⌘ / Ctrl K</kbd>
          </div>
          <div className="popular-searches"><span>Tìm kiếm phổ biến:</span>{[{label: 'Credit', query: 'Credit'}, {label: 'Giọng clone', query: 'clone'}, {label: 'API token', query: 'token'}].map(item => <button key={item.label} onClick={() => {setQuery(item.query); setCategory('all'); searchRef.current?.focus();}}>{item.label}</button>)}</div>
        </div>
      </section>

      <div className="content-container">
        <section className="topics-section" aria-labelledby="topics-title">
          <div className="section-heading"><div><span className="section-kicker">KHÁM PHÁ THEO CHỦ ĐỀ</span><h2 id="topics-title">Mọi thứ bạn cần, ở một nơi</h2></div><span className="section-note">Hướng dẫn dành cho nhà sáng tạo</span></div>
          <div className="category-grid">{categories.map(item => <button key={item.id} className={`category-card ${category === item.id ? 'selected' : ''}`} onClick={() => pickCategory(item.id)} aria-pressed={category === item.id}>
            <span className={`category-icon ${item.color}`}><item.icon size={23} strokeWidth={1.8} /></span>
            <h3>{item.title}</h3><p>{item.description}</p>
            <span className="category-footer">{articles.filter(article => article.category === item.id).length} bài hướng dẫn <ArrowRight size={17} /></span>
          </button>)}</div>
        </section>

        <section id="guides" className="guides-section" aria-labelledby="guides-title">
          <div className="section-heading"><div><span className="section-kicker">CÂU TRẢ LỜI THIẾT THỰC</span><h2 id="guides-title">{filtering ? 'Kết quả tìm kiếm' : 'Hướng dẫn hữu ích'}</h2></div><button className="text-button" onClick={() => {setQuery(''); pickCategory('all'); searchRef.current?.focus();}}>Tìm trong tất cả hướng dẫn <ArrowRight size={17} /></button></div>
          {filtering && <div className="filter-summary" role="status"><span>{filteredArticles.length} hướng dẫn{query.trim() && <> cho “{query.trim()}”</>}{category !== 'all' && <> trong {categories.find(item => item.id === category)?.title}</>}</span><button onClick={() => {setQuery(''); setCategory('all');}}>Xóa bộ lọc <X size={14} /></button></div>}
          {recommended.length ? <div className="guide-list">{recommended.map(article => <ArticleRow key={article.id} article={article} onOpen={() => navigateArticle(article.id)} />)}</div> : <div className="empty-state"><span className="empty-icon"><Search size={25} /></span><h3>Chưa tìm thấy hướng dẫn phù hợp</h3><p>Thử từ khóa ngắn hơn như “voice”, “Credit” hoặc “đăng nhập”.</p><button className="button button-outline" onClick={() => {setQuery(''); setCategory('all'); searchRef.current?.focus();}}>Xem hướng dẫn đề xuất <ArrowRight size={16} /></button></div>}
        </section>

        <section className="faq-section" aria-labelledby="faq-title">
          <div className="faq-intro"><span className="section-kicker">GIẢI ĐÁP NHANH</span><h2 id="faq-title">Bạn hỏi,<br />Veltrix giải đáp.</h2><p>Những câu hỏi thường gặp khi sáng tạo cùng AI.</p><div className="faq-mark" aria-hidden="true"><LifeBuoy size={40} strokeWidth={1.4} /></div></div>
          <div className="faq-list">{faqs.map(item => <details key={item.article}><summary>{item.question}<ChevronDown size={19} /></summary><div className="faq-answer"><p>{item.answer}</p><button className="text-button" onClick={() => navigateArticle(item.article)}>Xem hướng dẫn chi tiết <ArrowRight size={15} /></button></div></details>)}</div>
        </section>

        <SupportPanel />
      </div>
    </main> : selectedArticle ? <main className="article-container">
      <div className="article-breadcrumb"><button onClick={() => navigateArticle(null)}>Trung tâm trợ giúp</button><ChevronRight size={14} /><button onClick={() => {navigateArticle(null); setCategory(selectedArticle.category);}}>{categories.find(item => item.id === selectedArticle.category)?.title}</button></div>
      <div className="article-layout">
        <article className="article-body">
          <div className="article-label"><BookOpen size={16} /> HƯỚNG DẪN VELTRIX <span>· {selectedArticle.readMinutes} phút đọc</span></div>
          <h1>{selectedArticle.title}</h1><p className="article-summary">{selectedArticle.summary}</p>
          <div className="article-divider" />
          {selectedArticle.sections.map((section, index) => <section key={section.title} id={`section-${index}`} className="article-section"><h2>{section.title}</h2><p>{section.text}</p>{section.steps && <ol>{section.steps.map(step => <li key={step}>{step}</li>)}</ol>}</section>)}
          <div className="article-footer"><button className="button button-outline" onClick={copyArticleLink}><Copy size={16} /> Sao chép liên kết</button>{selectedArticle.relatedLink && externalLinks[selectedArticle.relatedLink] && <a className="button button-primary" href={externalLinks[selectedArticle.relatedLink]!}>{selectedArticle.relatedLink === 'developer' ? 'Mở tài liệu API' : selectedArticle.relatedLink === 'client' ? 'Về ứng dụng' : 'Mở tài liệu'}<ArrowRight size={16} /></a>}</div>
          <button className="back-link text-button" onClick={() => navigateArticle(null)}><ArrowLeft size={16} /> Quay lại trung tâm trợ giúp</button>
        </article>
        <aside className="article-aside"><div><span className="section-kicker">TRONG HƯỚNG DẪN NÀY</span><nav aria-label="Mục lục bài viết">{selectedArticle.sections.map((section, index) => <a key={section.title} href={`#section-${index}`}>{section.title}</a>)}</nav></div><div className="aside-help"><Headphones size={24} /><h3>Tiếp tục khám phá</h3><p>Tìm thêm hướng dẫn cho các bước tiếp theo.</p><button className="text-button" onClick={focusSearch}>Tìm câu trả lời <ArrowRight size={16} /></button></div></aside>
      </div>
      <section className="related-section"><h2>Có thể bạn cũng cần</h2><div className="guide-list">{articles.filter(article => article.id !== selectedArticle.id && article.category === selectedArticle.category).map(article => <ArticleRow key={article.id} article={article} onOpen={() => navigateArticle(article.id)} />)}{!articles.some(article => article.id !== selectedArticle.id && article.category === selectedArticle.category) && <ArticleRow article={articles[0]} onOpen={() => navigateArticle(articles[0].id)} />}</div></section>
    </main> : <main className="content-container missing-article"><div className="empty-state"><BookOpen size={32} /><h1>Không tìm thấy hướng dẫn</h1><p>Liên kết này không còn tồn tại hoặc mã hướng dẫn không đúng.</p><button className="button button-primary" onClick={() => navigateArticle(null)}>Về trung tâm trợ giúp <ArrowRight size={16} /></button></div></main>}

    <footer className="site-footer"><div className="footer-inner"><div className="footer-brand"><img src="/logo-icon.png" width="25" height="25" alt="" /><span>Veltrix AI</span><span className="footer-caption">Sáng tạo rõ ràng. Hỗ trợ dễ dàng.</span></div><div className="footer-links">{clientUrl && <a href={clientUrl}>Ứng dụng</a>}{docsUrl && <a href={docsUrl}>Tài liệu</a>}{developerUrl && <a href={developerUrl}>Developer</a>}<span>© {new Date().getFullYear()} Veltrix AI</span></div></div></footer>
    <SupportChat key={user?.id || 'guest'} onOpenArticle={navigateArticle} />
    {logoutConfirm && <div className="support-logout-confirm" role="alertdialog" aria-labelledby="logout-title"><h2 id="logout-title">Đăng xuất phiên dùng chung?</h2><p>Creator và Support đang dùng cùng phiên đăng nhập trên trình duyệt này.</p><div><button className="button button-outline" disabled={logoutBusy} onClick={() => setLogoutConfirm(false)}>Giữ đăng nhập</button><button className="button button-primary" disabled={logoutBusy} onClick={async () => {setLogoutBusy(true); try {await logout();} catch (error) {setNotice(error instanceof Error ? error.message : 'Chưa đăng xuất được. Vui lòng thử lại.');} finally {setLogoutBusy(false);}}}>{logoutBusy ? 'Đang đăng xuất…' : 'Đăng xuất'}</button></div></div>}
    {notice && <div className="toast" role="status"><Check size={17} /><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="Đóng thông báo"><X size={17} /></button></div>}
  </>;
}

function ArrowUpRight() {
  return <ArrowRight size={15} className="arrow-diagonal" />;
}

function ArticleRow({article, onOpen}: {article: Article; onOpen: () => void}) {
  const category = categories.find(item => item.id === article.category)!;
  return <button className="guide-row" onClick={onOpen}><span className={`guide-icon ${category.color}`}><category.icon size={21} strokeWidth={1.8} /></span><span className="guide-copy"><span className="guide-category">{category.title}</span><strong>{article.title}</strong><span className="guide-summary">{article.summary}</span></span><span className="read-time">{article.readMinutes} phút đọc</span><ChevronRight size={18} className="guide-arrow" /></button>;
}

function SupportPanel() {
  return <section className="support-panel" aria-labelledby="support-title"><div className="support-panel-icon"><Headphones size={29} strokeWidth={1.6} /></div><div className="support-panel-copy"><h2 id="support-title">Cần thêm một chút hướng dẫn?</h2><p>{supportContactUrl ? 'Gửi câu hỏi qua kênh hỗ trợ của Veltrix. Giữ lại mã tác vụ hoặc mã đơn để đối chiếu.' : 'Khám phá tài liệu chi tiết để tiếp tục công việc của bạn. Kênh tiếp nhận hỗ trợ trực tiếp hiện chưa được mở.'}</p></div><div className="support-panel-actions">{docsUrl && <a className="button button-primary" href={docsUrl}>Mở tài liệu <ArrowRight size={16} /></a>}{supportContactUrl && <a className="button button-outline" href={supportContactUrl}>Liên hệ hỗ trợ <ExternalLink size={15} /></a>}{!docsUrl && !supportContactUrl && <a className="button button-outline" href="#guides">Xem hướng dẫn <ArrowDown size={16} /></a>}</div></section>;
}
