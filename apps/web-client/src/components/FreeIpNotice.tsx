import {createPortal} from 'react-dom';
import {X, ShieldAlert} from 'lucide-react';
import './FreeIpNotice.css';
import {supportUrl} from '../utils/supportUrl';

export function FreeIpNotice({onClose}: {onClose: () => void}) {
  return createPortal(<aside className="free-ip-notice" role="alert" aria-labelledby="free-ip-notice-title">
    <ShieldAlert size={22} aria-hidden="true" />
    <div><h2 id="free-ip-notice-title">Vi phạm chính sách sử dụng tài khoản Free</h2>
      <p>Mạng bạn đang sử dụng đã đạt giới hạn 3 tài khoản Free trong khoảng thời gian áp dụng. Tài khoản này chưa thuộc danh sách được phép trên mạng đó, nên chúng tôi không thể cho phép đăng nhập từ mạng này. Nếu bạn cho rằng đây là nhầm lẫn, vui lòng liên hệ hỗ trợ.</p>
      {supportUrl && <a href={supportUrl} target="_blank" rel="noopener noreferrer">Liên hệ hỗ trợ</a>}
    </div><button type="button" onClick={onClose} aria-label="Đóng cảnh báo tài khoản Free"><X size={20} /></button>
  </aside>, document.body);
}
