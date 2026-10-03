import mongoose from 'mongoose';
import { User } from '../models/User';
import { AdminAccount } from '../models/AdminAccount';
import { AdminRole } from '../models/AdminRole';
import { hashSecret } from '../utils/crypto';

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/creatorai');

  console.log('Migrating admin users...');

  // Create default roles if not exist
  const ownerRole = await AdminRole.findOneAndUpdate(
    { name: 'OWNER' },
    { $setOnInsert: { permissions: ['*'], isSystem: true } },
    { upsert: true, new: true }
  );

  const adminRole = await AdminRole.findOneAndUpdate(
    { name: 'ADMIN' },
    { $setOnInsert: { 
        permissions: [
          'users.read', 'users.update', 'users.ban', 
          'plans.read', 'plans.update', 
          'credits.read', 'credits.adjust', 
          'voices.read', 'voices.revoke', 
          'jobs.read', 'jobs.retry', 'jobs.cancel', 
          'settings.read', 'settings.update'
        ], 
        isSystem: true 
    } },
    { upsert: true, new: true }
  );

  const supportRole = await AdminRole.findOneAndUpdate(
    { name: 'SUPPORT' },
    { $setOnInsert: { permissions: ['users.read', 'jobs.read', 'voices.read'], isSystem: true } },
    { upsert: true, new: true }
  );

  const roleMap: Record<string, mongoose.Types.ObjectId> = {
    'OWNER': ownerRole._id as mongoose.Types.ObjectId,
    'ADMIN': adminRole._id as mongoose.Types.ObjectId,
    'SUPPORT': supportRole._id as mongoose.Types.ObjectId,
  };
  
  const legacyAdmins = await User.collection.find({ roles: { $exists: true, $ne: [] } }).toArray();

  console.log(`Found ${legacyAdmins.length} legacy admins.`);

  for (const legacy of legacyAdmins) {
    if (legacy.roles && legacy.roles.length > 0) {
      let targetRoleName = 'SUPPORT';
      if (legacy.roles.includes('OWNER')) targetRoleName = 'OWNER';
      else if (legacy.roles.includes('ADMIN')) targetRoleName = 'ADMIN';

      const roleId = roleMap[targetRoleName];
      
      const existing = await AdminAccount.findOne({ email: legacy.email });
      if (!existing) {
        await AdminAccount.create({
          email: legacy.email,
          passwordHash: hashSecret('Admin123!'),
          displayName: legacy.displayName,
          roleId: roleId,
          status: legacy.status
        });
        console.log(`Created admin account for ${legacy.email} with role ${targetRoleName}. Default password: Admin123!`);
      }
      
      // Unset roles on client user
      await User.collection.updateOne(
        { _id: legacy._id },
        { $unset: { roles: 1 } }
      );
    }
  }

  console.log('Migration complete.');
  process.exit(0);
}

migrate().catch(console.error);
