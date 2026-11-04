const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  planStoryboard, sequenceProblems, repairSequence, fallbackStoryboard, sanitizeEmphasis, parseViNumber, extractArray, ICON_NAMES, MAX_ATTEMPTS,
} = require('../dist/services/VideoStoryboard');

const rendererSchema = () => import('../../../packages/video-renderer/src/schema.ts');

const inputs = [
  { narration: 'Nền văn minh cấp bảy mạnh đến mức nào?', imagePrompt: 'galaxy in deep space, cinematic --ar 9:16' },
  { narration: 'Cả Trái Đất nhận khoảng 174 nghìn tỷ oát từ Mặt Trời.', imagePrompt: 'sun and earth' },
  { narration: 'Có ba cấp: làm chủ hành tinh, làm chủ ngôi sao, làm chủ thiên hà.', imagePrompt: 'planet star galaxy' },
  { narration: 'Đăng ký kênh để xem tiếp nhé!', imagePrompt: 'subscribe button' },
];
const good = [
  { type: 'hook', title: 'Cấp 7 mạnh cỡ nào?', subtitle: '', icon: 'rocket', emphasis: ['cấp bảy', 'không có trong lời đọc'], data: {}, bg_keywords: ['galaxy', 'deep space'] },
  { type: 'stat', title: 'Năng lượng Mặt Trời', subtitle: '', icon: 'sun', emphasis: ['Mặt Trời'], data: { value: '174.000.000.000.000', unit: 'oát', percent: 0 }, bg_keywords: ['sun', 'solar flare'] },
  { type: 'list', title: 'Ba cấp đầu', subtitle: '', icon: 'layers', emphasis: [], data: { items: [{ text: 'Hành tinh', icon: 'Earth' }, { text: 'Ngôi sao', icon: 'star' }, { text: 'Thiên hà', icon: 'orbit' }] }, bg_keywords: ['planets'] },
  { type: 'cta', title: 'Theo dõi kênh', subtitle: '', icon: 'bell', emphasis: [], data: { action: 'subscribe' }, bg_keywords: ['night sky'] },
];

/** Fake provider returning queued answers and recording prompts. */
function provider(answers) {
  const prompts = [];
  return {
    prompts,
    identity: { kind: 'gemini', model: 'test' },
    async generate(request) {
      prompts.push(request);
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return { text: typeof next === 'string' ? next : JSON.stringify(next) };
    },
  };
}

test('icon whitelist matches the renderer', () => {
  const source = readFileSync(join(__dirname, '../../../packages/video-renderer/src/icons.tsx'), 'utf8');
  const map = source.slice(source.indexOf('const MAP = {'), source.indexOf('} satisfies'));
  const names = [...map.matchAll(/(?:'([\w-]+)'|([\w]+)):\s*L\./g)].map((m) => m[1] || m[2]);
  assert.deepEqual([...names].sort(), [...ICON_NAMES].sort());
});

test('valid answer is accepted on the first try and normalized', async () => {
  const ai = provider([good]);
  const plan = await planStoryboard(ai, inputs);
  assert.equal(plan.attempts, 1);
  assert.equal(plan.usedAi, true);
  assert.equal(plan.repaired, false);
  assert.deepEqual(plan.scenes.map((s) => s.type), ['hook', 'stat', 'list', 'cta']);
  assert.equal(plan.scenes[1].data.value, 174e12); // Vietnamese grouping parsed
  assert.equal(plan.scenes[1].data.percent, undefined); // a model-filled 0% is treated as absent
  assert.equal(plan.scenes[2].data.items[0].icon, 'earth'); // icon names lower-cased
  assert.deepEqual(plan.scenes[0].emphasis, ['cấp bảy']); // phrases not in narration/title dropped
  assert.equal(plan.scenes[1].voice, inputs[1].narration);
  assert.deepEqual(plan.bgQueries, ['galaxy deep space', 'sun solar flare', 'planets', 'night sky']);
  // Narration is sent as JSON data, the schema constrains type and icon names.
  assert.match(ai.prompts[0].prompt, /"narration":"Nền văn minh/);
  assert.ok(ai.prompts[0].schema.items.properties.icon.enum.includes('rocket'));
});

test('invalid answer is retried with the zod errors in the prompt', async () => {
  const broken = good.map((s) => ({ ...s }));
  broken[1] = { ...broken[1], type: 'hook', data: {} }; // two hooks in a row
  broken[2] = { ...broken[2], icon: 'not-an-icon' };
  const ai = provider([`Đây là kết quả:\n${JSON.stringify(broken)}`, good]);
  const plan = await planStoryboard(ai, inputs);
  assert.equal(plan.attempts, 2);
  assert.equal(plan.repaired, false);
  assert.match(ai.prompts[1].prompt, /must not both be "hook"/);
  assert.match(ai.prompts[1].prompt, /scene 3 icon: unknown icon name/);
});

test('after the last retry, valid scenes are kept and the sequence is repaired', async () => {
  const bad = [good[1], { ...good[0] }, good[2], { ...good[2] }]; // stat first, hook in the middle, list twice
  const ai = provider([bad, bad, bad]);
  const plan = await planStoryboard(ai, inputs);
  assert.equal(plan.attempts, MAX_ATTEMPTS);
  assert.equal(plan.repaired, true);
  const types = plan.scenes.map((s) => s.type);
  assert.deepEqual(sequenceProblems(types), [], types.join(','));
  assert.equal(types[0], 'hook');
  assert.equal(types[3], 'cta');
});

test('no provider, errors or garbage fall back to heuristics that pick data-backed types', async () => {
  for (const ai of [null, provider([new Error('down'), new Error('down'), new Error('down')]), provider(['no json', '[{"x":1}]', '[]'])]) {
    const plan = await planStoryboard(ai, inputs);
    const types = plan.scenes.map((s) => s.type);
    assert.deepEqual(sequenceProblems(types), []);
    assert.equal(types[1], 'stat'); // narration has a number
    assert.equal(plan.scenes[1].data.value, 174e12);
    assert.equal(types[2], 'list'); // narration lists clauses
    assert.equal(plan.scenes[2].data.items.length, 3);
  }
});

test('every plan validates against the renderer schema', async () => {
  const { storyboardSceneSchema, sequenceProblems: rendererRules } = await rendererSchema();
  const variants = [null, provider([good]), provider([[good[2], good[2], good[0], good[1]], 'x', 'y'])];
  for (const ai of variants) {
    const plan = await planStoryboard(ai, inputs);
    for (const scene of plan.scenes) {
      const parsed = storyboardSceneSchema.safeParse({ ...scene, words: [] });
      assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
    }
    assert.deepEqual(rendererRules(plan.scenes.map((s) => s.type)), []);
  }
});

test('repair never leaves neighbours with the same type, even for long storyboards', () => {
  const long = Array.from({ length: 9 }, (_, i) => ({ narration: i % 2 ? `Có ${i + 2} triệu người, rất nhiều.` : `Ý số ${i}, ý phụ thứ hai, ý thứ ba.` }));
  const same = fallbackStoryboard(long).map((s) => ({ ...s, type: 'icon_card', data: {} }));
  const fixed = repairSequence(same, long);
  assert.deepEqual(sequenceProblems(fixed.scenes.map((s) => s.type)), []);
  assert.equal(fixed.changed, true);
});

test('helpers: emphasis, numbers, JSON extraction', () => {
  assert.deepEqual(sanitizeEmphasis(['Trái Đất', 'sao Hỏa', 'một hai ba bốn năm', '  Trái Đất  '], ['Trái Đất quay quanh Mặt Trời']), ['Trái Đất']);
  assert.equal(parseViNumber('1.234.567'), 1234567);
  assert.equal(parseViNumber('3,5'), 3.5);
  assert.equal(parseViNumber('1.234,5'), 1234.5);
  assert.equal(parseViNumber(42), 42);
  assert.equal(parseViNumber('abc'), null);
  assert.deepEqual(extractArray('```json\n[1,2]\n```'), [1, 2]);
  assert.equal(extractArray('{"a":1}'), null);
});
