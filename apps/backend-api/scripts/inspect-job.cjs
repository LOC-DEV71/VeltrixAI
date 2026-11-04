const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const { Job } = require('../dist/models/Job');
  const jobs = await Job.find({ type: { $in: ['YOUTUBE_PUBLISH', 'AUTO_VIDEO', 'VIDEO_RENDER'] } })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  console.log('Recent jobs:');
  for (const j of jobs) {
    console.log(`- Job ${j._id} | Type: ${j.type} | Status: ${j.status} | Error: ${j.error || j.failedReason}`);
    if (j.error || j.failedReason) {
      console.log('  Error detail:', j.error, j.failedReason);
    }
  }

  const autoVideos = await mongoose.connection.collection('auto_videos').find({}).sort({ createdAt: -1 }).limit(3).toArray();
  console.log('\nRecent auto_videos:');
  for (const a of autoVideos) {
    console.log(`- AutoVideo ${a._id} | Status: ${a.status} | Step: ${a.step} | FailedStep: ${a.failedStep} | Error: ${a.error}`);
    console.log('  ActivityLog:', JSON.stringify(a.activityLog));
  }

  await mongoose.disconnect();
}
run().catch(console.error);

