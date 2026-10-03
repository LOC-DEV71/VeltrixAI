import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import cookieParser from 'cookie-parser';

import { User } from '../src/models/User';
import { Session } from '../src/models/Session';
import { Workspace } from '../src/models/Workspace';
import { Project } from '../src/models/Project';
import { Content } from '../src/models/Content';
import projectsRoutes from '../src/routes/projects';
import contentsRoutes from '../src/routes/contents';
import { signAccessToken } from '../src/utils/jwt';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/projects', projectsRoutes);
app.use('/api/contents', contentsRoutes);

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(c => c.deleteMany({})));
});

describe('CRUD API (Projects & Contents)', () => {
  it('GET /api/projects - should return 401 without token', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(401);
  });

  it('GET /api/projects - should return projects for valid user', async () => {
    const user = await User.create({ email: 'test@test.com', displayName: 'Test User' });
    const session = await Session.create({
      userId: user._id,
      tokenFamily: 'fam1',
      refreshTokenHash: 'hash',
      expiresAt: new Date(Date.now() + 100000)
    });
    const token = signAccessToken({ sessionId: session._id, userId: user._id });

    const workspace = await Workspace.create({ ownerId: user._id, name: 'Workspace 1' });
    const project = await Project.create({ workspaceId: workspace._id, name: 'Project 1' });

    const res = await request(app)
      .get('/api/projects')
      .set('Cookie', [`accessToken=${token}`]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0]._id).toBe(project._id.toString());
  });

  it('POST /api/contents - should create content and check access control', async () => {
    // User 1
    const user1 = await User.create({ email: 'user1@test.com', displayName: 'User 1' });
    const session1 = await Session.create({
      userId: user1._id,
      tokenFamily: 'fam1',
      refreshTokenHash: 'hash',
      expiresAt: new Date(Date.now() + 100000)
    });
    const token1 = signAccessToken({ sessionId: session1._id, userId: user1._id });

    // User 2
    const user2 = await User.create({ email: 'user2@test.com', displayName: 'User 2' });
    const session2 = await Session.create({
      userId: user2._id,
      tokenFamily: 'fam2',
      refreshTokenHash: 'hash2',
      expiresAt: new Date(Date.now() + 100000)
    });
    const token2 = signAccessToken({ sessionId: session2._id, userId: user2._id });

    const workspace1 = await Workspace.create({ ownerId: user1._id, name: 'Workspace 1' });
    const project1 = await Project.create({ workspaceId: workspace1._id, name: 'Project 1' });

    // User 2 tries to create content in User 1's project -> 403
    const resForbidden = await request(app)
      .post('/api/contents')
      .set('Cookie', [`accessToken=${token2}`])
      .send({ projectId: project1._id, rawText: 'Hello' });

    expect(resForbidden.status).toBe(403);

    // User 1 creates content -> 201
    const resCreate = await request(app)
      .post('/api/contents')
      .set('Cookie', [`accessToken=${token1}`])
      .send({ projectId: project1._id, rawText: 'Hello' });

    expect(resCreate.status).toBe(201);
    expect(resCreate.body.data.rawText).toBe('Hello');
    
    // User 1 gets content -> 200
    const contentId = resCreate.body.data._id;
    const resGet = await request(app)
      .get(`/api/contents/${contentId}`)
      .set('Cookie', [`accessToken=${token1}`]);
      
    expect(resGet.status).toBe(200);
    expect(resGet.body.data.rawText).toBe('Hello');
    
    // User 1 updates content -> 200
    const resUpdate = await request(app)
      .put(`/api/contents/${contentId}`)
      .set('Cookie', [`accessToken=${token1}`])
      .send({ rawText: 'World' });
      
    expect(resUpdate.status).toBe(200);
    expect(resUpdate.body.data.rawText).toBe('World');
    expect(resUpdate.body.data.revision).toBe(1);
  });
});
