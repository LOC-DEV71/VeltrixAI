// Regression check against the configured DB. All fixture writes are rolled back.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { Scene } = require('../dist/models/Scene');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const projectId = new mongoose.Types.ObjectId();
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const scenes = await Scene.create([1, 2, 3].map(order => ({
      projectId, order, title: 'Transaction regression fixture', narration: 'Fixture',
      visualDescription: 'Fixture', imagePrompt: 'Fixture', videoPrompt: 'Fixture',
      estimatedDuration: 5, sourceContentRevision: 1,
    })), { session, ordered: true });
    assert.equal(scenes.length, 3);
    assert.deepEqual(scenes.map(scene => scene.order), [1, 2, 3]);
  } finally {
    if (session.inTransaction()) await session.abortTransaction();
    await session.endSession();
  }
  assert.equal(await Scene.countDocuments({ projectId }), 0);
  console.log('PASS: created 3 scenes in Mongo transaction; rollback verified, no fixtures remain.');
})().catch(error => { console.error('FAIL:', error.name); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
