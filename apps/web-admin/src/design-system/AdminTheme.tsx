import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { App, ConfigProvider, theme } from 'antd';
import viVN from 'antd/locale/vi_VN';
import './admin-system.css';

const ThemeContext = createContext({ dark: false, toggle: () => {} });
export const useAdminTheme = () => useContext(ThemeContext);
export function AdminTheme({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('veltrix-admin-theme') === 'dark'; } catch { return false; } });
  const toggle = () => setDark(value => { try { localStorage.setItem('veltrix-admin-theme', value ? 'light' : 'dark'); } catch { /* storage may be disabled */ } return !value; });
  return <ThemeContext.Provider value={{ dark, toggle }}><div className="admin-design-system" data-theme={dark ? 'dark' : 'light'}>
    <ConfigProvider locale={viVN} theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: {
      fontFamily: "'Be Vietnam Pro', system-ui, sans-serif", fontSize: 13, colorPrimary: '#4F46E5', colorInfo: '#4F46E5',
      colorSuccess: '#15803D', colorWarning: '#B45309', colorError: '#DC2626', colorText: dark ? '#E7EBF4' : '#172033',
      colorTextSecondary: dark ? '#9DAAC0' : '#64748B', colorBgLayout: dark ? '#101521' : '#F7F8FC',
      colorBgContainer: dark ? '#192131' : '#FFFFFF', colorBgElevated: dark ? '#192131' : '#FFFFFF',
      colorBorder: dark ? '#303C50' : '#E3E7EF', borderRadius: 12, controlHeight: 40, wireframe: false,
    }, components: {
      Table: { headerBg: dark ? '#202B3F' : '#F8FAFC', rowHoverBg: dark ? '#202B3F' : '#F7F8FC', cellPaddingBlock: 16, cellPaddingInline: 16 },
      Button: { fontWeight: 500, primaryShadow: 'none' }, Card: { headerHeight: 56, headerFontSize: 14 },
      Tabs: { horizontalItemGutter: 24 }, Modal: { titleFontSize: 18 }, Drawer: { footerPaddingBlock: 16 },
    } }}><App notification={{ placement: 'bottomRight', maxCount: 3 }} message={{ maxCount: 3 }}>{children}</App></ConfigProvider>
  </div></ThemeContext.Provider>;
}
