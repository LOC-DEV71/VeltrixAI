import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { AdminRole } from '../models/AdminRole';
import { AdminAccount } from '../models/AdminAccount';
import { hashSecret } from '../utils/crypto';

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/creatorai').then(async () => {
  const role = await AdminRole.findOneAndUpdate(
    { name: 'OWNER' }, 
    { $setOnInsert: { permissions: ['*'], isSystem: true } }, 
    { upsert: true, new: true }
  );
  
  await AdminAccount.findOneAndUpdate(
    { email: 'admin@example.com' }, 
    { $setOnInsert: { passwordHash: hashSecret('Admin123!'), displayName: 'System Admin', roleId: role._id } }, 
    { upsert: true }
  );
  
  console.log('Admin account admin@example.com created with password Admin123!');
  process.exit(0);
});
