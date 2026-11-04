// Preview storyboard covering all nine scene types (studio and self-check renders).
import type { StoryboardScene } from './schema';

const scene = (s: Partial<StoryboardScene> & Pick<StoryboardScene, 'type' | 'voice'>): StoryboardScene =>
  ({ title: '', subtitle: '', icon: 'sparkles', emphasis: [], words: [], data: {}, ...s }) as StoryboardScene;

export const SAMPLE_STORYBOARD: StoryboardScene[] = [
  scene({ type: 'hook', voice: 'Nền văn minh cấp bảy mạnh đến mức nào?', title: 'Nền văn minh cấp 7 mạnh đến mức nào?', icon: 'rocket', emphasis: ['cấp 7'],
    imagePrompt: 'A colossal Dyson swarm of glowing megastructures surrounding a blazing star, tiny spacecraft for scale, deep space nebula behind',
    videoPrompt: 'slow push in towards the star' }),
  scene({ type: 'icon_card', voice: 'Năm 1964, nhà thiên văn Kardashev đề xuất đo nền văn minh bằng năng lượng.', title: 'Thang đo Kardashev', subtitle: 'Đo trình độ văn minh bằng năng lượng mà nó khai thác được', icon: 'telescope', emphasis: ['Kardashev'],
    imagePrompt: 'A 1960s Soviet astronomer at a large radio telescope at night, star-filled sky, vintage observatory, film grain',
    videoPrompt: 'camera pans left across the observatory' }),
  scene({ type: 'stat', voice: 'Cả Trái Đất nhận khoảng 174 nghìn tỷ oát từ Mặt Trời.', title: 'Năng lượng Trái Đất nhận được', icon: 'sun', emphasis: ['Mặt Trời'], data: { value: 174e12, unit: 'oát mỗi giây', label: '', percent: 72, decimals: 0 },
    imagePrompt: 'Planet Earth seen from orbit at sunrise, sunlight streaming across the atmosphere, solar rays hitting the ocean',
    videoPrompt: 'camera tilts up from the Earth to the Sun' }),
  scene({ type: 'list', voice: 'Ba cấp đầu tiên: làm chủ hành tinh, làm chủ ngôi sao, làm chủ thiên hà.', title: 'Ba cấp đầu tiên', icon: 'layers', data: { items: [{ text: 'Làm chủ hành tinh', icon: 'earth' }, { text: 'Làm chủ ngôi sao', icon: 'sun' }, { text: 'Làm chủ thiên hà', icon: 'orbit' }] } }),
  scene({ type: 'compare', voice: 'So với cấp một, cấp ba mạnh hơn hàng chục tỷ lần.', title: 'Cấp 1 và cấp 3', emphasis: ['chục tỷ lần'], data: { left: { label: 'Cấp 1', value: '10¹⁶ W', icon: 'earth' }, right: { label: 'Cấp 3', value: '10³⁶ W', icon: 'orbit' }, winner: 'right' } }),
  scene({ type: 'scale', voice: 'Từ cấp không của chúng ta, leo lên tới cấp bảy, nơi họ điều khiển cả vũ trụ.', title: 'Thang Kardashev mở rộng', data: { levels: ['Cấp 0', 'Cấp 1', 'Cấp 2', 'Cấp 3', 'Cấp 4', 'Cấp 5', 'Cấp 7'], active: 6 } }),
  scene({ type: 'timeline', voice: 'Năm 1964 có thang ba cấp, năm 1973 Sagan thêm số thập phân, ngày nay đã có bảy cấp.', title: 'Thang đo thay đổi ra sao', data: { events: [{ time: '1964', text: 'Kardashev: 3 cấp' }, { time: '1973', text: 'Sagan thêm số lẻ' }, { time: 'Nay', text: 'Mở rộng 7 cấp' }] } }),
  scene({ type: 'quote', voice: 'Carl Sagan từng nói: chúng ta được tạo nên từ bụi sao.', emphasis: ['bụi sao'], data: { quote: 'Chúng ta được tạo nên từ bụi sao.', author: 'Carl Sagan' } }),
  scene({ type: 'cta', voice: 'Đăng ký kênh để khám phá thêm vũ trụ nhé!', title: 'Khám phá thêm vũ trụ', emphasis: ['vũ trụ'], data: { action: 'subscribe' } }),
];
