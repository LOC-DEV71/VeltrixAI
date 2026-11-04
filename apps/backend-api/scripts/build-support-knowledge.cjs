// Read only the explicit product sources below. Never eval TSX, read .env, or crawl user data.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ts = require('typescript');
const backend = path.resolve(__dirname, '..'), root = path.resolve(backend, '../..');
const inputs = new Map();
function read(relative) { const text = fs.readFileSync(path.join(root, relative), 'utf8'); inputs.set(relative, crypto.createHash('sha256').update(text).digest('hex')); return text; }
function ast(relative) { return ts.createSourceFile(relative, read(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function literal(node) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal).filter(value => value !== undefined);
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).map(property => [property.name.text, literal(property.initializer)]).filter(([, value]) => value !== undefined));
  return undefined;
}
function declaration(tree, name) { let value; function walk(node) { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) value = literal(node.initializer); ts.forEachChild(node, walk); } walk(tree); if (value === undefined) throw Error('Unsupported product source: ' + name); return value; }
function visibleText(tree) { const texts = []; function walk(node) { if (ts.isJsxText(node)) { const text = node.text.replace(/\s+/g, ' ').trim(); if (text) texts.push(text); } else if (ts.isJsxAttribute(node) && ['label', 'title', 'placeholder', 'aria-label'].includes(node.name.getText(tree)) && node.initializer && ts.isStringLiteral(node.initializer)) texts.push(node.initializer.text); ts.forEachChild(node, walk); } walk(tree); return texts.join('\n'); }
const flows = JSON.parse(read('apps/backend-api/support/client-flows.json'));
const router = ast('apps/web-client/src/App.tsx'), actualRoutes = [];
function routes(node) { if (ts.isJsxAttribute(node) && node.name.getText(router) === 'path' && node.initializer && ts.isStringLiteral(node.initializer)) actualRoutes.push(node.initializer.text); ts.forEachChild(node, routes); } routes(router);
const expected = new Set(flows.routes.map(route => route.path));
if (actualRoutes.length !== expected.size || actualRoutes.some(route => !expected.has(route))) throw Error('SUPPORT_ROUTE_COVERAGE_CHANGED: audit the new/removed client routes in support/client-flows.json');
const documents = [];
function add(document) { if (!document.text?.trim() || !document.title || !document.id || !document.path.startsWith('/') || document.path.startsWith('//')) throw Error('Invalid support document'); documents.push(document); }
for (const route of flows.routes) add({ ...route, id: 'route-' + (route.path === '/' ? 'home' : route.path.slice(1).replaceAll('/', '-')), kind: 'workflow', origin: 'apps/backend-api/support/client-flows.json' });
for (const document of flows.documents) add({ ...document, kind: 'workflow', origin: 'apps/backend-api/support/client-flows.json' });
const docsFile = 'apps/web-client/src/pages/DocsPage.tsx';
for (const guide of declaration(ast(docsFile), 'guides')) add({ id: 'docs-' + guide.id, title: guide.title, path: '/docs?section=' + encodeURIComponent(guide.id), keywords: guide.group + ' ' + guide.id, text: [guide.description, ...guide.steps, ...guide.notes].join('\n'), kind: 'guide', origin: docsFile });
const policiesFile = 'apps/web-client/src/content/policies.json';
const policies = JSON.parse(read(policiesFile)), titles = declaration(ast('apps/web-client/src/pages/PoliciesPage.tsx'), 'titles');
add({ id: 'policy-overview', title: 'Tổng quan Chính sách & Điều khoản', path: '/chinh-sach-dieu-khoan', keywords: 'chính sách điều khoản phạm vi dịch vụ', text: policies.intro, kind: 'policy', origin: policiesFile });
for (const policy of policies.documents) for (const section of policy.sections) add({ id: `policy-${policy.id}-${section.number}`, title: `${titles[policy.id]} · ${section.title}`, path: `/chinh-sach-dieu-khoan?document=${encodeURIComponent(policy.id)}#policy-${section.number}`, keywords: titles[policy.id] + ' ' + policy.id, text: section.body.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email minh họa, chưa tiếp nhận hỗ trợ]'), kind: 'policy', origin: policiesFile });
const tourFile = 'apps/web-client/src/components/layout/WorkspaceTour.tsx';
for (const step of declaration(ast(tourFile), 'steps')) add({ id: 'tour-' + step.target.replaceAll('/', '-'), title: step.title, path: step.target.startsWith('/') ? step.target : '/docs?section=start', keywords: 'hướng dẫn nhanh tour ' + step.target, text: step.description, kind: 'guide', origin: tourFile });
const integrationFile = 'apps/web-client/src/components/DeveloperIntegration.tsx', integration = ast(integrationFile);
const endpointRows = [];
function endpoints(node) { if (ts.isArrayLiteralExpression(node)) { const rows = literal(node); if (rows.some(value => Array.isArray(value) && /^(GET|POST) \//.test(value[0] || ''))) endpointRows.push(...rows.map(row => row.join(' · '))); } ts.forEachChild(node, endpoints); } endpoints(integration);
add({ id: 'developer-integration', title: 'Developer API · endpoints, scopes & lỗi', path: '/developer', keywords: 'api rest endpoint scope bearer idempotency retry-after developer giới hạn', text: visibleText(integration) + '\n' + endpointRows.join('\n'), kind: 'guide', origin: integrationFile });
const apiDoc = 'docs/DEVELOPER_API.md';
add({ id: 'developer-contract', title: 'Developer API · contract tích hợp', path: '/docs?section=developer', keywords: 'api token bearer scopes hạn ngày key voices tts jobs wav credit limits developer', text: read(apiDoc), kind: 'guide', origin: apiDoc });
for (const [name, route, title] of [
  ['LandingPage', '/', 'Trang chủ · nội dung giao diện'], ['DeveloperPage', '/developer', 'Developer · hướng dẫn giao diện'], ['PricingPage', '/pricing', 'Bảng giá · điều hướng'],
  ['LoginPage', '/login', 'Đăng nhập · nút và hướng dẫn'], ['WorkspacePage', '/workspace', 'Workspace · thao tác dự án'],
  ['ContentEditorPage', '/content', 'Studio Viết kịch bản · cấu hình và thao tác'], ['ScenesPage', '/content/scenes', 'Chia cảnh & Tạo Audio · thao tác cảnh'],
  ['TTSPage', '/tts', 'TTS · tạo audio và lịch sử'], ['voices/VoicesPage', '/voices', 'Giọng đọc · thư viện'],
  ['AccountPage', '/account/profile', 'Tài khoản · hồ sơ, tùy chỉnh, cài đặt và thanh toán'],
]) { const relative = `apps/web-client/src/pages/${name}.tsx`; add({ id: 'page-' + name.toLowerCase().replaceAll('/', '-'), title, path: route, keywords: name, text: visibleText(ast(relative)), kind: 'page', origin: relative }); }
if (new Set(documents.map(document => document.id)).size !== documents.length) throw Error('Duplicate support knowledge ID');
const metadata = { schemaVersion: 1, revision: crypto.createHash('sha256').update(JSON.stringify([...inputs])).digest('hex'), routes: actualRoutes, policyUpdatedAt: policies.updatedAt, sources: Object.fromEntries(inputs) };
const output = '// Generated by scripts/build-support-knowledge.cjs. Edit product sources, then run npm run support:knowledge.\nexport interface SupportKnowledgeDocument {id:string;title:string;path:string;keywords:string;text:string;kind:string;origin:string;}\nexport const supportKnowledgeMetadata = ' + JSON.stringify(metadata, null, 2) + ';\nexport const supportKnowledgeDocuments: SupportKnowledgeDocument[] = ' + JSON.stringify(documents, null, 2) + ';\n';
const target = path.join(backend, 'src/support/clientKnowledge.generated.ts');
if (process.argv.includes('--check')) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== output) throw Error('SUPPORT_KNOWLEDGE_STALE: run npm run support:knowledge'); }
else { fs.mkdirSync(path.dirname(target), { recursive: true }); if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== output) fs.writeFileSync(target, output); }
console.log(`Support knowledge: ${actualRoutes.length} routes, ${documents.length} documents, revision ${metadata.revision.slice(0, 12)}`);
