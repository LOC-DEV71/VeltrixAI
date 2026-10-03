const mongoose = require('mongoose');
mongoose.connect('mongodb://127.0.0.1:27017/creatorai').then(async () => {
  const db = mongoose.connection.db;
  const result = await db.collection('users').updateOne(
    { email: '1945musictrending@gmail.com' },
    { $set: { plan: 'PRO' } }
  );
  console.log(result);
  mongoose.disconnect();
}).catch(console.error);
