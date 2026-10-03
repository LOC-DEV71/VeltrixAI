const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { Project } = require('../dist/models/Project');
const { Workspace } = require('../dist/models/Workspace');
const { Content } = require('../dist/models/Content');
const { createProject, getProject, updateProject, deleteProject } = require('../dist/controllers/ProjectController');
const { Job } = require('../dist/models/Job');
const { getContents } = require('../dist/controllers/ContentController');
const { csrfProtection } = require('../dist/middlewares/csrfMiddleware');
const { requireAuth } = require('../dist/middlewares/authMiddleware');
const mongoose=require('mongoose');
const ent=require('../dist/services/EntitlementService');
const router = require('../dist/routes/projects').default;
afterEach(() => mock.restoreAll());
const id = '0123456789abcdef01234567';
const workspace = { _id: id, ownerId: 'user' };
const req = { user: { _id: 'user' }, params: { id }, query: {} };
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function setupCreation(result=workspace) {
const session={withTransaction:async fn=>fn(),endSession:async()=>{}};
mock.method(mongoose,'startSession',async()=>session);
mock.method(ent,'forOwner',async()=>({}));mock.method(ent,'reserveStorage',async()=>{});
mock.method(Workspace,'findOne',()=>({sort(){return this;},session:async()=>result}));
mock.method(Workspace,'create',async()=>[workspace]);
return mock.method(Project,'create',async rows=>rows.map(row=>({...row,_id:'project-new'})));
}
test('project routes require auth and POST also requires CSRF', () => {
  assert.equal(router.stack[0].handle, requireAuth);
  const post = router.stack.find(layer => layer.route?.methods.post).route;
  assert.equal(post.path, '/');
  assert.equal(post.stack[0].handle, csrfProtection);
  assert.equal(post.stack[1].handle, createProject);
  assert.equal(router.stack.find(layer => layer.route?.path === '/:id').route.stack[0].handle, getProject);
  for (const method of ['patch', 'delete']) {
    const route = router.stack.find(layer => layer.route?.methods[method]).route;
    assert.equal(route.stack[0].handle, csrfProtection);
  }
});

test('create an owned project transactionally and trim its name',async()=>{
const create=setupCreation();const res=response();await createProject({...req,body:{name:'  New idea  ',workspaceId:id,ownerId:'other'}},res);
assert.equal(res.statusCode,201);assert.deepEqual(create.mock.calls[0].arguments[0],[{name:'New idea',workspaceId:id}]);assert.equal(res.body.data._id,'project-new');
});
test('omitted workspace uses the owned workspace and allows repeated creation',async()=>{
const create=setupCreation();for(let i=0;i<4;i++){const res=response();await createProject({...req,body:{name:'Same name'}},res);assert.equal(res.statusCode,201);}assert.equal(create.mock.callCount(),4);
});
test('first project reserves both workspace and project storage',async()=>{
setupCreation(null);const res=response();await createProject({...req,body:{name:'First project'}},res);assert.equal(res.statusCode,201);
assert.deepEqual(ent.reserveStorage.mock.calls.map(call=>call.arguments[2]),['workspaces','projects']);
});
test('invalid names and workspace ids fail before database writes', async () => {
  const create = mock.method(Project, 'create', async () => { throw new Error('unexpected write'); });
  for (const body of [undefined, {}, { name: 12 }, { name: '  ' }, { name: 'a'.repeat(201) },
    { name: 'valid', workspaceId: '' }, { name: 'valid', workspaceId: null }, { name: 'valid', workspaceId: { $ne: null } }]) {
    const res = response();
    await createProject({ ...req, body }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(create.mock.callCount(), 0);
});

test('missing or foreign workspace is hidden with 404 and never creates a project',async()=>{
const create=setupCreation(null);const res=response();await createProject({...req,body:{name:'Name',workspaceId:id}},res);assert.equal(res.statusCode,404);assert.equal(create.mock.callCount(),0);
});
test('storage quota error is preserved by project creation',async()=>{
setupCreation();const {PlanError}=require('../dist/services/PlanService');ent.reserveStorage.mock.mockImplementation(async()=>{throw new PlanError('PLAN_LIMIT_EXCEEDED',403);});const res=response();await createProject({...req,body:{name:'Name'}},res);assert.equal(res.statusCode,403);assert.equal(res.body.error.code,'PLAN_LIMIT_EXCEEDED');
});
test('project detail returns owned project and blocks another owner', async () => {
  const project = { _id: id, workspaceId: id, name: 'Studio' };
  mock.method(Project, 'findById', async () => project);
  const findWorkspace = mock.method(Workspace, 'findById', async () => workspace);
  const owned = response();
  await getProject(req, owned);
  assert.deepEqual(owned.body, { success: true, data: project });
  findWorkspace.mock.mockImplementation(async () => ({ ...workspace, ownerId: 'other' }));
  const denied = response();
  await getProject(req, denied);
  assert.equal(denied.statusCode, 403);
});

test('project detail returns 400 for invalid id and 404 for missing project', async () => {
  const find = mock.method(Project, 'findById', async () => null);
  const invalid = response();
  await getProject({ ...req, params: { id: 'bad' } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(find.mock.callCount(), 0);
  const missing = response();
  await getProject(req, missing);
  assert.equal(missing.statusCode, 404);
});

test('project-scoped contents returns array and does not expose a foreign project', async () => {
  mock.method(Project, 'findById', async () => ({ workspaceId: id }));
  const findWorkspace = mock.method(Workspace, 'findById', async () => workspace);
  const find = mock.method(Content, 'find', async filter => { assert.deepEqual(filter, { projectId: id }); return []; });
  const owned = response();
  await getContents({ ...req, query: { projectId: id } }, owned);
  assert.deepEqual(owned.body, { success: true, data: [] });
  findWorkspace.mock.mockImplementation(async () => ({ ...workspace, ownerId: 'other' }));
  const denied = response();
  await getContents({ ...req, query: { projectId: id } }, denied);
  assert.equal(denied.statusCode, 403);
  assert.equal(find.mock.callCount(), 1);
});

test('malformed/structured projectId query returns 400, not database errors', async () => {
  for (const projectId of ['', 'bad', [id, id], { $ne: null }]) {
    const res = response();
    await getContents({ ...req, query: { projectId } }, res);
    assert.equal(res.statusCode, 400);
  }
});

test('database errors return generic 500 without internal exception details', async () => {
  setupCreation(); Workspace.findOne.mock.mockImplementation(()=>{throw new Error('secret db connection');});
  const res = response();
  await createProject({ ...req, body: { name: 'name', workspaceId: id } }, res);
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /secret db connection/);
});

function setupMutation(owner = 'user') {
  const project = { _id: id, workspaceId: id, name: 'Dự án vũ trụ' };
  mock.method(Project, 'findById', async () => project);
  mock.method(Workspace, 'findById', async () => ({ ...workspace, ownerId: owner }));
  const update = mock.method(Project, 'findOneAndUpdate', async () => project);
  mock.method(Job, 'exists', async () => null);
  return update;
}

test('rename trims name; foreign owners cannot rename or delete', async () => {
  const update = setupMutation();
  const renamed = response();
  await updateProject({ ...req, body: { name: '  New name  ' } }, renamed);
  assert.equal(renamed.statusCode, 200);
  assert.deepEqual(update.mock.calls[0].arguments[1], { $set: { name: 'New name' } });
  mock.method(Workspace, 'findById', async () => ({ ...workspace, ownerId: 'other' }));
  for (const [handler, body] of [[updateProject, { name: 'New' }], [deleteProject, { confirmName: 'Dự án vũ trụ' }]]) {
    const res = response();
    await handler({ ...req, body }, res);
    assert.equal(res.statusCode, 403);
  }
  assert.equal(update.mock.callCount(), 1);
});

test('delete requires exact confirmation, including case and spaces', async () => {
  const update = setupMutation();
  for (const confirmName of [undefined, '', 'dự án vũ trụ', 'Dự án vũ trụ ', 'wrong']) {
    const res = response();
    await deleteProject({ ...req, body: { confirmName } }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(update.mock.callCount(), 0);
  const res = response();
  await deleteProject({ ...req, body: { confirmName: 'Dự án vũ trụ' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(update.mock.calls[0].arguments[0], { _id: id, name: 'Dự án vũ trụ' });
  assert.ok(update.mock.calls[0].arguments[1].$set.deletedAt instanceof Date);
});

test('delete blocks active jobs and rejects confirmation invalidated by concurrent rename', async () => {
  const update = setupMutation();
  mock.method(Job, 'exists', async () => ({ _id: 'active' }));
  const busy = response();
  await deleteProject({ ...req, body: { confirmName: 'Dự án vũ trụ' } }, busy);
  assert.equal(busy.statusCode, 409);
  assert.equal(update.mock.callCount(), 0);
  mock.method(Job, 'exists', async () => null);
  update.mock.mockImplementation(async () => null);
  const changed = response();
  await deleteProject({ ...req, body: { confirmName: 'Dự án vũ trụ' } }, changed);
  assert.equal(changed.body.error.code, 'PROJECT_CHANGED');
});

test('deleted projects are filtered by actual Mongoose queries', async () => {
  mock.method(Project.collection, 'find', filter => {
    assert.equal(filter.deletedAt, null);
    return { toArray: async () => [] };
  });
  mock.method(Project.collection, 'findOne', async filter => {
    assert.equal(filter.deletedAt, null);
    return null;
  });
  assert.deepEqual(await Project.find({ workspaceId: id }), []);
  assert.equal(await Project.findById(id), null);
});
