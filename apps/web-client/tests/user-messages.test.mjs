import {test} from 'node:test';
import assert from 'node:assert/strict';
import {errorMessage} from '../src/utils/userMessages.ts';
test('Cloudinary job failure codes display specific Vietnamese messages',()=>{
  for(const code of ['CLOUDINARY_DELIVERY_TIMEOUT','CLOUDINARY_DELIVERY_FAILED','CLOUDINARY_DELIVERY_DENIED','CLOUDINARY_AUDIO_NOT_FOUND']) {
    const message=errorMessage(code);assert.ok(message.includes('Cloudinary'));assert.ok(!message.includes('Không thực hiện được yêu cầu'));
    assert.equal(errorMessage({code}),message);
  }
});
