import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGoogleLogin } from '@react-oauth/google';
import toast from 'react-hot-toast';
import {isFreeIpDenied} from '../utils/freeIpPolicy';
import {allowedSupportReturn} from '../utils/supportLoginReturn';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [menuOpen] = useState(false);
  const { user, loading, loginOtp, verifyOtp, loginGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.state?.returnTo;
  const destination = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/workspace';
  const supportReturn = allowedSupportReturn(new URLSearchParams(location.search).get('supportReturnTo'));
  function finishLogin() {
    if (supportReturn) window.location.replace(supportReturn);
    else navigate(destination);
  }

  useEffect(() => {
    if (user && !loading && supportReturn) window.location.replace(supportReturn);
  }, [user, loading, supportReturn]);

  const handleSendOtp = async () => {
    if (!email) {
      toast.error('Vui lòng nhập email');
      return;
    }
    try {
      const id = await loginOtp(email, 'LOGIN');
      setChallengeId(id);
      toast.success('Mã OTP đã được gửi');
    } catch (e: any) {
      toast.error('Lỗi gửi OTP: ' + e.message);
    }
  };

  const handleVerify = async () => {
    if (!code) {
      toast.error('Vui lòng nhập mã OTP');
      return;
    }
    try {
      await verifyOtp(email, challengeId, code, 'LOGIN');
      toast.success('Đăng nhập thành công');
      finishLogin();
    } catch (e: any) {
      if (!isFreeIpDenied(e)) toast.error(e.message || 'Không thể xác thực mã OTP.');
    }
  };

  const loginWithGoogle = useGoogleLogin({
    onSuccess: async (credentialResponse) => {
      try {
        await loginGoogle(credentialResponse.access_token);
        toast.success('Đăng nhập Google thành công');
        finishLogin();
      } catch (e: any) {
        if (!isFreeIpDenied(e)) toast.error(e.message || 'Đăng nhập Google thất bại');
      }
    },
    onError: () => {
      toast.error('Đăng nhập Google thất bại');
    }
  });

  useEffect(() => {
    document.title = "Veltrix AI - Đăng nhập";
    if (menuOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        :root {
          --bg: #000000;
          --text: #ffffff;
          --text-dim: rgba(255,255,255,0.62);
          --text-dimmer: rgba(255,255,255,0.42);
          --line: rgba(255,255,255,0.14);
          --line-strong: rgba(255,255,255,0.26);
          --fill-ghost: rgba(255,255,255,0.05);
          --fill-solid: rgba(255,255,255,0.10);
          --gutter: clamp(20px, 5vw, 100px);
          --ease-premium: cubic-bezier(0.16, 1, 0.3, 1);
          --font-display: "Sora", "Helvetica Neue", Helvetica, Arial, sans-serif;
          --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
        }
        
        body { margin: 0; }
        
        .echoid-page {
          background-color: var(--bg);
          color: var(--text);
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        
        .hero {
          position: relative;
          width: 100%;
          height: 100vh;
          height: 100svh;
          min-height: 640px;
          overflow: hidden;
          display: grid;
          grid-template-rows: auto 1fr auto;
          isolation: isolate;
        }
        
        @media (max-height: 640px) {
          .hero { min-height: 100svh; }
        }
        
        .hero__media {
          position: absolute;
          inset: 0;
          z-index: -1;
          background-color: #000;
        }
        
        .hero__video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
        }
        
        .hero__scrim {
          position: absolute;
          inset: 0;
          z-index: 0;
          background: linear-gradient(to right, transparent 0%, transparent 45%, rgba(0,0,0,0.45) 72%, rgba(0,0,0,0.72) 100%),
                      linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 22%, transparent 78%, rgba(0,0,0,0.65) 100%);
        }
        
        @media (max-width: 720px) {
          .hero__scrim {
            background: linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.25) 30%, rgba(0,0,0,0.75) 100%);
          }
        }
        
        .nav {
          position: relative;
          z-index: 60;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 32px;
          padding: clamp(20px, 2.4vw, 34px) var(--gutter);
          padding-top: max(clamp(20px, 2.4vw, 34px), env(safe-area-inset-top, 0px));
        }
        
        .nav__logo {
          font-family: var(--font-display);
          font-weight: 200;
          font-size: clamp(20px, 1.75vw, 30px);
          letter-spacing: 0.16em;
          color: white;
          text-decoration: none;
          line-height: 1;
        }
        
        .nav__right {
          display: flex;
          align-items: center;
          gap: clamp(24px, 3.2vw, 62px);
        }
        
        .nav__links {
          display: flex;
          gap: clamp(20px, 2.8vw, 56px);
        }
        
        .nav__link {
          font-family: var(--font-mono);
          font-weight: 400;
          font-size: clamp(11px, 0.78vw, 14px);
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: white;
          text-decoration: none;
          transition: color 0.25s ease;
        }
        
        .nav__link:hover {
          color: var(--text-dim);
        }
        
        .btn--cta {
          font-family: var(--font-mono);
          font-weight: 400;
          font-size: clamp(11px, 0.78vw, 14px);
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: white;
          text-decoration: none;
          padding: clamp(12px,1vw,17px) clamp(20px,1.8vw,32px);
          border: 1px solid var(--line-strong);
          background: transparent;
          transition: background 0.25s ease, border-color 0.25s ease;
          cursor: pointer;
        }
        
        .btn--cta:hover {
          background: var(--fill-ghost);
          border-color: rgba(255,255,255,0.5);
        }
        
        .nav__hamburger {
          display: none;
          width: 44px;
          height: 44px;
          position: relative;
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 0;
          z-index: 70;
        }
        
        .nav__hamburger span {
          position: absolute;
          width: 22px;
          height: 1px;
          background: white;
          left: 50%;
          transform: translateX(-50%);
          transition: transform 0.45s var(--ease-premium), opacity 0.25s ease;
        }
        
        .nav__hamburger span:nth-child(1) { top: 16px; }
        .nav__hamburger span:nth-child(2) { top: 22px; }
        .nav__hamburger span:nth-child(3) { top: 28px; }
        
        .nav__hamburger[aria-expanded="true"] span:nth-child(1) {
          transform: translateX(-50%) rotate(45deg);
          top: 22px;
        }
        .nav__hamburger[aria-expanded="true"] span:nth-child(2) {
          opacity: 0;
          transform: translateX(-50%) scaleX(0);
        }
        .nav__hamburger[aria-expanded="true"] span:nth-child(3) {
          transform: translateX(-50%) rotate(-45deg);
          top: 22px;
        }
        
        @media (max-width: 900px) {
          .nav__links, .nav__cta { display: none; }
          .nav__hamburger { display: block; }
        }
        
        .mobile-menu {
          position: fixed;
          inset: 0;
          z-index: 50;
          background: rgba(4,4,6,0.94);
          backdrop-filter: blur(28px) saturate(140%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 32px;
          clip-path: circle(3% at calc(100% - 42px) 42px);
          opacity: 0;
          pointer-events: none;
          transition: clip-path 0.7s var(--ease-premium), opacity 0.45s ease;
        }
        
        .mobile-menu.is-open {
          clip-path: circle(150% at calc(100% - 42px) 42px);
          opacity: 1;
          pointer-events: auto;
        }
        
        .mobile-menu__link {
          font-family: var(--font-mono);
          font-weight: 400;
          font-size: clamp(20px, 5.5vw, 28px);
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: white;
          text-decoration: none;
          opacity: 0;
          transform: translateY(16px);
          transition: opacity 0.4s ease, transform 0.5s var(--ease-premium);
        }
        
        .mobile-menu.is-open .mobile-menu__link {
          opacity: 1;
          transform: translateY(0);
        }
        
        .mobile-menu__cta {
          letter-spacing: 0.22em;
          padding: 16px 40px;
          border: 1px solid var(--line-strong);
        }
        
        .hero__body {
          position: relative;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding: 0 var(--gutter);
          min-height: 0;
          overflow-y: auto;
        }
        
        @media (max-width: 720px) {
          .hero__body { justify-content: center; }
        }
        
        .panel {
          width: min(34vw, 620px);
          min-width: 380px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }
        
        @media (max-width: 1100px) {
          .panel { width: min(70vw, 520px); min-width: 0; }
        }
        
        @media (max-width: 720px) {
          .panel { width: 100%; }
        }
        
        .chip {
          font-family: var(--font-mono);
          font-weight: 400;
          font-size: clamp(11px, 0.72vw, 14px);
          letter-spacing: 0.2em;
          text-transform: uppercase;
          background: rgba(255,255,255,0.09);
          padding: clamp(9px,0.8vw,14px) clamp(14px,1.1vw,20px);
          line-height: 1;
          color: white;
        }
        
        .h1 {
          font-family: var(--font-display);
          font-weight: 200;
          font-size: clamp(38px, 4.3vw, 82px);
          letter-spacing: 0.03em;
          line-height: 0.95;
          margin-top: clamp(28px, 3vw, 52px);
          color: white;
          margin-bottom: 0;
        }
        
        @media (max-width: 380px) {
          .h1 { font-size: clamp(30px, 10.5vw, 44px); }
        }
        
        @media (max-height: 640px) {
          .h1 { font-size: clamp(25px, 4.9vw, 44px); }
        }
        
        .tagline {
          font-family: var(--font-mono);
          font-weight: 300;
          font-size: clamp(11px, 0.94vw, 17px);
          letter-spacing: 0.14em;
          color: var(--text-dim);
          margin-top: clamp(14px, 1.4vw, 24px);
          line-height: 1.4;
          text-transform: uppercase;
        }
        
        .form {
          margin-top: clamp(38px, 4.6vw, 82px);
          display: flex;
          flex-direction: column;
          gap: clamp(14px, 1.3vw, 22px);
          width: 100%;
        }
        
        .input {
          width: 100%;
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--line-strong);
          border-radius: 0;
          padding: 0 2px clamp(12px,1.1vw,18px);
          font-family: var(--font-display);
          font-weight: 300;
          font-size: clamp(16px,0.95vw,18px);
          color: white;
          outline: none;
          transition: border-color 0.25s ease;
        }
        
        .input::placeholder { color: var(--text-dim); }
        .input:focus { border-bottom-color: rgba(255,255,255,0.85); }
        .input:focus::placeholder { color: var(--text-dimmer); }
        
        .btn {
          width: 100%;
          border-radius: 0;
          border: none;
          padding: clamp(17px,1.6vw,27px) 20px;
          font-family: var(--font-mono);
          font-weight: 400;
          text-transform: uppercase;
          letter-spacing: 0.22em;
          font-size: clamp(11px,0.78vw,14px);
          cursor: pointer;
          transition: background 0.25s ease, color 0.25s ease;
        }
        
        .btn--ghost {
          background: var(--fill-ghost);
          color: var(--text-dimmer);
        }
        .btn--ghost:hover {
          background: rgba(255,255,255,0.09);
          color: white;
        }
        
        .btn--solid {
          background: var(--fill-solid);
          color: white;
        }
        .btn--solid:hover {
          background: rgba(255,255,255,0.17);
        }
        
        .referral {
          font-family: var(--font-mono);
          font-weight: 400;
          font-size: clamp(11px, 0.74vw, 14px);
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--text);
          margin-top: clamp(26px, 2.6vw, 46px);
          align-self: center;
          text-decoration: none;
          transition: color 0.25s ease;
        }
        .referral:hover {
          color: var(--text-dim);
          text-decoration: underline;
          text-underline-offset: 4px;
        }
        
        .footer {
          position: relative;
          z-index: 10;
          border-top: 1px solid var(--line);
          padding: clamp(18px,1.7vw,30px) var(--gutter);
          padding-bottom: max(clamp(18px,1.7vw,30px), env(safe-area-inset-bottom, 0px));
          text-align: center;
        }
        
        .footer__text {
          font-family: var(--font-display);
          font-weight: 300;
          font-size: clamp(12px,0.82vw,16px);
          color: var(--text-dim);
          line-height: 1.5;
          margin: 0;
        }
        
        @media (max-height: 640px) {
          .footer__text { font-size: 11px; }
        }
        
        .footer__link {
          color: white;
          text-decoration: underline;
          text-underline-offset: 3px;
          text-decoration-thickness: 1px;
          transition: color 0.25s ease;
        }
        .footer__link:hover { color: var(--text-dim); }
        
        .btn--google {
          width: 100%;
          border-radius: 0;
          border: none;
          padding: clamp(17px,1.6vw,27px) 20px;
          background: #ffffff;
          color: #3c4043;
          font-family: 'Roboto', 'Segoe UI', Tahoma, sans-serif;
          font-weight: 500;
          font-size: 15px;
          cursor: pointer;
          transition: background 0.25s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
        }
        .btn--google:hover {
          background: #f8f9fa;
        }
        
        *:focus-visible {
          outline: 1px solid rgba(255,255,255,0.7);
          outline-offset: 3px;
        }
        
        @media (prefers-reduced-motion: reduce) {
          .hero__video { display: none; }
          .hero__media {
            background-image: url('/loginpage.png');
            background-size: cover;
            background-position: center;
          }
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}} />
      <div className="echoid-page hero">
        <div className="hero__media">
          <video 
            className="hero__video" 
            autoPlay 
            muted 
            loop 
            playsInline 
            preload="auto" 
            poster="/loginpage.png"
          >
            <source src="/loginpage.mp4" type="video/mp4" />
          </video>
          <div className="hero__scrim"></div>
        </div>

        <nav className="nav">
          <a href="/" className="nav__logo">VELTRIX AI</a>
        </nav>

        <main className="hero__body">
          <div className="panel">
            <img src="/logo-icon.png" alt="Creator AI Icon" style={{ width: '70px', height: '70px', marginBottom: '28px' }} />
            <div className="chip">[ Đăng nhập ]</div>
            <h1 className="h1">CREATOR AI</h1>
            <p className="tagline">Trợ lý sáng tạo nội dung của bạn.</p>

            <form 
              className="form"  
              noValidate 
              onSubmit={(e) => {
                e.preventDefault();
                if (challengeId) handleVerify();
                else handleSendOtp();
              }}
            >
              <div>
                <label htmlFor="emailInput" className="sr-only" style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', borderWidth: 0 }}>Email</label>
                <input 
                  id="emailInput"
                  type={challengeId ? "text" : "email"}
                  className="input"
                  placeholder={challengeId ? "Nhập mã OTP..." : "Email của bạn..."}
                  value={challengeId ? code : email}
                  onChange={e => challengeId ? setCode(e.target.value) : setEmail(e.target.value)}
                />
              </div>

              {!challengeId ? (
                <>
                  <button type="submit" className="btn btn--ghost">Tiếp tục bằng Email</button>
                  <button type="button" className="btn--google" onClick={() => loginWithGoogle()}>
                    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="18px" height="18px" viewBox="0 0 48 48">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.7 17.74 9.5 24 9.5z"></path>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                      <path fill="none" d="M0 0h48v48H0z"></path>
                    </svg>
                    Đăng nhập bằng Google
                  </button>
                </>
              ) : (
                <button type="submit" className="btn btn--solid">Xác nhận</button>
              )}
            </form>
          </div>
        </main>


      </div>
    </>
  );
};
