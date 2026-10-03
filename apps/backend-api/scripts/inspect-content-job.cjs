// Read-only diagnostics: never prints environment values or request credentials.
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const contentId = process.argv[2];
if (!mongoose.isObjectIdOrHexString(contentId)) throw new Error('Invalid content id');
function safeReason(value) {
  let reason = String(value ?? '');
  for (const [key, secret] of Object.entries(process.env)) {
    if (/KEY|SECRET|TOKEN|PASSWORD|URI/.test(key) && secret && secret.length > 4) reason = reason.split(secret).join('[REDACTED]');
  }
  return reason.replace(/https?:\/\/\S+/g, '[URL REDACTED]').slice(0, 600);
}
(async () => {
  console.log(JSON.stringify({ geminiConfigured: Boolean(process.env.GEMINI_API_KEY), mongoConfigured: Boolean(process.env.MONGODB_URI) }));
  if (!process.env.MONGODB_URI) return;
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const jobs = await mongoose.connection.collection('jobs').find({
    'payload.contentId': { $in: [contentId, new mongoose.Types.ObjectId(contentId)] },
  }, { projection: { status: 1, error: 1, createdAt: 1, updatedAt: 1, reservationId: 1 } }).sort({ createdAt: -1 }).limit(5).toArray();
  console.log(JSON.stringify(jobs.map(job => ({ id: String(job._id), status: job.status, reason: safeReason(job.error), createdAt: job.createdAt, updatedAt: job.updatedAt, hasReservation: Boolean(job.reservationId) }))));
})().catch(error => { console.log(JSON.stringify({ diagnosticError: error.name, reason: safeReason(error.message) })); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
