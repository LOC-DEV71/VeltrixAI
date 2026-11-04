// Loads every theme's fonts from the bundle (no network) before any frame is captured.
// All are OFL (Google Fonts) and cover Vietnamese. Variable fonts declare their weight range.
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';

const FILES: Array<[family: string, file: string, weight: string]> = [
  ['Be Vietnam Pro', 'BeVietnamPro-Medium.ttf', '500'],
  ['Be Vietnam Pro', 'BeVietnamPro-Bold.ttf', '700'],
  ['Be Vietnam Pro', 'BeVietnamPro-ExtraBold.ttf', '800'],
  ['Playfair Display', 'PlayfairDisplay.ttf', '400 900'],
  ['Lora', 'Lora.ttf', '400 700'],
  ['Montserrat', 'Montserrat.ttf', '100 900'],
  ['Space Grotesk', 'SpaceGrotesk.ttf', '300 700'],
  ['JetBrains Mono', 'JetBrainsMono.ttf', '100 800'],
  ['Nunito', 'Nunito.ttf', '200 1000'],
  ['Baloo 2', 'Baloo2.ttf', '400 800'],
];

/** Every Vietnamese diacritic form we must render. Used to warm the glyph cache. */
export const VIETNAMESE_SAMPLE = 'ĂÂĐÊÔƠƯăâđêôơư ÁÀẢÃẠẮẰẲẴẶẤẦẨẪẬÉÈẺẼẸẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌỐỒỔỖỘỚỜỞỠỢÚÙỦŨỤỨỪỬỮỰÝỲỶỸỴ áàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ';

let started = false;
export function loadFonts() {
  if (started || typeof document === 'undefined') return;
  started = true;
  const handle = delayRender('Loading theme fonts');
  Promise.all(FILES.map(async ([family, file, weight]) => {
    const face = new FontFace(family, `url(${staticFile(`fonts/${file}`)}) format('truetype')`, { weight, style: 'normal' });
    document.fonts.add(await face.load());
  }))
    .then(() => Promise.all(FILES.map(([family, , weight]) => document.fonts.load(`${weight.split(' ').pop()} 40px '${family}'`, VIETNAMESE_SAMPLE))))
    .then(() => continueRender(handle))
    // A video in a fallback font breaks the design system, so fail the render instead.
    .catch((error) => cancelRender(error));
}
