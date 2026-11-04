const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const theme = require('../dist/services/VideoTheme');

const fakeProvider = (text) => ({ identity: { kind: 'local' }, generate: async () => ({ text }) });

test('theme ids match the renderer schema', () => {
  const schema = readFileSync(join(__dirname, '../../../packages/video-renderer/src/schema.ts'), 'utf8');
  const ids = /THEME_IDS = \[([^\]]+)\]/.exec(schema)[1].match(/'([a-z]+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(ids, [...theme.THEME_IDS]);
});

test('keywords pick the theme from the topic; unknown topics never fall back to cosmic', () => {
  const cases = [
    ['Nếu Lenin chưa từng xuất hiện, liệu chủ nghĩa Marx có thay đổi số phận', 'documentary'],
    ['Nếu toàn bộ vũ trụ đột nhiên ngừng giãn nở', 'cosmic'],
    ['Vì sao lạm phát làm bạn nghèo đi dù lương tăng', 'finance'],
    ['AI sẽ thay thế lập trình viên trong 5 năm tới?', 'tech'],
    ['Cá mập đã sống sót qua 5 lần đại tuyệt chủng thế nào', 'nature'],
    ['3 thói quen nhỏ giúp bạn tự tin hơn mỗi ngày', 'pop'],
  ];
  for (const [topic, expected] of cases) assert.equal(theme.keywordTheme(topic).theme, expected, topic);
  // Lowercase "ai" is the Vietnamese "who", not artificial intelligence.
  assert.notEqual(theme.keywordTheme('Ai đã thắp lên ánh sáng đầu tiên?').theme, 'tech');
  const unknown = theme.keywordTheme('Một câu chuyện kỳ lạ');
  assert.deepEqual(unknown, { theme: 'pop', source: 'default' });
});

test('chooseTheme: user choice wins, valid LLM answer is used, invalid answer falls back to keywords', async () => {
  const input = { topic: 'Đế chế La Mã sụp đổ vì đâu', narrations: ['Năm 476, hoàng đế cuối cùng bị phế truất.'] };
  assert.deepEqual(await theme.chooseTheme(fakeProvider('{"theme":"cosmic"}'), { ...input, choice: 'finance' }), { theme: 'finance', source: 'user' });
  assert.deepEqual(await theme.chooseTheme(fakeProvider('{"theme":"documentary"}'), input), { theme: 'documentary', source: 'ai' });
  assert.deepEqual(await theme.chooseTheme(fakeProvider('{"theme":"retro"}'), input), { theme: 'documentary', source: 'keywords' });
  assert.deepEqual(await theme.chooseTheme(fakeProvider('không phải json'), input), { theme: 'documentary', source: 'keywords' });
  assert.deepEqual(await theme.chooseTheme(null, input), { theme: 'documentary', source: 'keywords' });
  // The old image style id means "auto".
  assert.equal(theme.themeChoice('veltrix'), 'auto');
});

test('seeds are stable per video and differ between videos', () => {
  assert.equal(theme.themeSeed('a'), theme.themeSeed('a'));
  assert.notEqual(theme.themeSeed('a'), theme.themeSeed('b'));
});
