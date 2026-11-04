import {supportKnowledgeDocuments, supportKnowledgeMetadata} from '../support/clientKnowledge.generated';
export {supportKnowledgeDocuments, supportKnowledgeMetadata};
export type SupportReference = {id: string; title: string; path: string};
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
const stopWords = new Set('toi ban minh cua la co cac nhung thi va voi ve cho duoc muon can lam sao the nao gi mot nhieu it xin hay nhe a de tai trong tren khong dang dung nao nay do'.split(' '));
const terms = (text: string) => [...new Set(normalize(text).match(/[a-z0-9_]+/g) || [])].filter(term => term.length > 1 && !stopWords.has(term));
const aliases: [RegExp, string][] = [
  [/studio|kich ban|content/, 'studio content kich ban chu de canh'], [/developer|api|token|tich hop/, 'developer api token bearer'],
  [/clone|nhan ban/, 'clone nhan ban giong'], [/thanh toan|billing|mua goi|chuyen goi/, 'billing thanh toan goi'],
  [/dieu khoan|chinh sach/, 'dieu khoan chinh sach'], [/hoan tien|refund/, 'hoan tien refunds'],
  [/doi ten|xoa du an/, 'workspace du an'], [/tts|audio|wav/, 'tts audio wav'],
];
function split(text: string, max = 1000) {
  const pieces: string[] = [];
  let remaining = text.trim();
  while (remaining.length > max) {let end = remaining.lastIndexOf('\n', max); if (end < max / 2) end = remaining.lastIndexOf(' ', max); if (end < max / 2) end = max; pieces.push(remaining.slice(0, end)); remaining = remaining.slice(end).trim();}
  if (remaining) pieces.push(remaining);
  return pieces;
}
const chunks = supportKnowledgeDocuments.flatMap(document => split(document.text).map((text, index) => ({document, text, index, words:new Set(terms(text)), titleWords:new Set(terms(document.title + ' ' + document.keywords))})));
const frequencies = new Map<string, number>();
for (const chunk of chunks) for (const term of chunk.words) frequencies.set(term, (frequencies.get(term) || 0) + 1);

// Local, deterministic retrieval. Bounded context avoids sending the entire client into a small model.
export function retrieveSupportKnowledge(question: string, previousQuestion = '', maxChars = 3800) {
  const query = normalize(question), expanded = question + ' ' + aliases.filter(([pattern]) => pattern.test(query)).map(([,value]) => value).join(' ');
  const current = terms(expanded), previous = terms(previousQuestion);
  const ranked = chunks.map(chunk => {
    let score = 0;
    for (const term of current) {const weight = Math.log(1 + chunks.length / (frequencies.get(term) || 1)); if (chunk.words.has(term)) score += weight; if (chunk.titleWords.has(term)) score += 2 * weight;}
    for (const term of previous) if (chunk.words.has(term)) score += .12;
    if (query.includes(normalize(chunk.document.path)) && chunk.document.path !== '/') score += 10;
    return {...chunk, score};
  }).filter(chunk => chunk.score > 0).sort((a,b) => b.score - a.score || a.index - b.index);
  const selected: typeof ranked = [], counts = new Map<string, number>();
  let context = '';
  for (const chunk of ranked) {
    if ((counts.get(chunk.document.id) || 0) >= 2) continue;
    const entry = `\n[${chunk.document.id}] ${chunk.document.title} (${chunk.document.path})\n${chunk.text}\n`;
    if (context.length + entry.length > maxChars) continue;
    context += entry; selected.push(chunk); counts.set(chunk.document.id, (counts.get(chunk.document.id) || 0) + 1);
    if (selected.length >= 4) break;
  }
  return {context, references:[...new Map(selected.map(({document}) => [document.id, {id:document.id, title:document.title, path:document.path}])).values()]};
}

// With an unidentified screenshot, prior chat topics must not select the page.
// A compact map of real routes lets vision identify the page before using docs.
export function retrieveSupportImageKnowledge(question: string, maxChars: number) {
  let context = '';
  const references: SupportReference[] = [];
  // OCR can consume much of the context. Keep matching routes first rather
  // than dropping a page solely because it was later in the router file.
  const current=new Set(terms(question));
  const routeScore=(document:typeof supportKnowledgeDocuments[number])=>terms(document.title+' '+document.path).reduce((score,word)=>score+(current.has(word)?1:0),0);
  const routes=supportKnowledgeDocuments.filter(document=>document.id.startsWith('route-')).sort((a,b)=>routeScore(b)-routeScore(a));
  for (const document of routes) {
    const entry = `\n[${document.id}] ${document.title} (${document.path})\n`;
    if (context.length + entry.length > Math.min(1800,maxChars)) continue;
    context += entry;
    references.push({id:document.id,title:document.title,path:document.path});
  }
  const filler = new Set('anh hinh chup trang vay day cai nay trong doc xem noi gi giup toi ban hay cho la co the nao dung dung'.split(' '));
  const specificQuestion = normalize(question).split(/\s+/).filter(word => !filler.has(word.replace(/[^a-z0-9]/g,''))).join(' ');
  const detail = retrieveSupportKnowledge(specificQuestion,'',Math.max(0,maxChars-context.length));
  return {context:context+detail.context,references:[...new Map([...references,...detail.references].map(reference => [reference.id,reference])).values()]};
}
