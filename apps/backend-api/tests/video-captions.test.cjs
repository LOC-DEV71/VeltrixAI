const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitCaptionText, buildCaptions } = require('../dist/services/VideoCaptions');

test('splits by sentence, clause and into balanced chunks of at most 7 words', () => {
  const chunks = splitCaptionText('Điều gì sẽ xảy ra nếu Trái Đất ngừng quay? Ban ngày, ban đêm sẽ kéo dài sáu tháng liên tục không ngừng nghỉ.');
  assert.deepEqual(chunks, ['Điều gì sẽ xảy ra', 'nếu Trái Đất ngừng quay?', 'Ban ngày,', 'ban đêm sẽ kéo dài sáu', 'tháng liên tục không ngừng nghỉ.']);
  for (const c of chunks) assert.ok(c.split(' ').length <= 7);
  assert.deepEqual(splitCaptionText('một hai ba bốn năm sáu bảy tám'), ['một hai ba bốn', 'năm sáu bảy tám']);
  assert.deepEqual(splitCaptionText('một hai ba'), ['một hai ba']);
  assert.deepEqual(splitCaptionText('   '), []);
});

test('captions cover the whole scene contiguously, longer text gets more frames', () => {
  const narration = 'Ngắn. Câu này dài hơn rất nhiều so với câu trước đó.';
  const captions = buildCaptions(narration, 120);
  assert.equal(captions[0].startFrame, 0);
  assert.equal(captions[captions.length - 1].endFrame, 120);
  for (let i = 1; i < captions.length; i++) assert.equal(captions[i].startFrame, captions[i - 1].endFrame);
  const length = (c) => c.endFrame - c.startFrame;
  assert.ok(length(captions[0]) < length(captions[1]));
});

test('more chunks than frames never produces empty or overlapping captions', () => {
  const captions = buildCaptions('a. b. c. d. e.', 3);
  assert.ok(captions.length <= 3);
  for (const c of captions) assert.ok(c.endFrame > c.startFrame);
  assert.deepEqual(buildCaptions('', 30), []);
});
