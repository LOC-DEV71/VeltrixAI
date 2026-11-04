const {test}=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const {readSupportImageText,redactSupportOcr}=require('../dist/services/SupportOcr');

test('real local OCR reads code values from light and dark pixels, with bounded results',async()=>{
 for(const dark of [false,true]){
  const marker='SKU72942';
  const background=dark?'#0b1020':'#ffffff',foreground=dark?'#ffffff':'#172033';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="260"><rect width="1000" height="260" fill="${background}"/><g fill="${foreground}" font-family="Arial" font-size="42"><text x="30" y="65">Veltrix Developer</text><text x="30" y="135">GET /voices?page=1</text><text x="30" y="210">text: ${marker}</text></g></svg>`;
  const image=await sharp(Buffer.from(svg)).png().toBuffer();
  const result=await readSupportImageText(image);
  assert.equal(result.status,'ready');assert.ok(result.confidence>=60,JSON.stringify(result));
  assert.ok(result.text.includes(marker),result.text);assert.match(result.text,/\/voices/);assert.ok(result.text.length<=2800);
 }
});

test('OCR fails safely for invalid bytes, without exposing decoder/library diagnostics',async()=>{
 const result=await readSupportImageText(Buffer.from('not an image'));
 assert.deepEqual(result,{status:'unavailable',text:'',confidence:0});
});

test('OCR masks credentials in header, form and JSON text while preserving example placeholders',()=>{
 const result=redactSupportOcr('Authorization: Bearer abcdefghijklmnopqrstuvwxyz\nAuthorization: Bearer $TOKEN\nAuthorization: Bearer YOUR_API_KEY\n"api_key":"real-secret-value"\npassword = private-password\nOTP: 123456\nGET /tts/jobs');
 assert.ok(!result.includes('abcdefghijklmnopqrstuvwxyz'));assert.ok(!result.includes('real-secret-value'));assert.ok(!result.includes('private-password'));assert.ok(!result.includes('123456'));
 assert.match(result,/Bearer \$TOKEN/);assert.match(result,/Bearer YOUR_API_KEY/);assert.match(result,/GET \/tts\/jobs/);
 assert.equal(redactSupportOcr('x'.repeat(3000)).length,2800);
});
