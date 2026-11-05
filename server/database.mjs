import mongoose from 'mongoose';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

/** Connect to the configured MongoDB or start an explicitly enabled local demo database. */
export async function connectDatabase() {
  let local;
  let uri = process.env.MONGODB_URI;
  if (!uri) {
    if (process.env.NODE_ENV === 'production' || process.env.DEMO_MODE !== 'true')
      throw new Error('Set MONGODB_URI in .env. Automatic local demo requires DEMO_MODE=true.');
    const dbPath = path.resolve('.data/mongo');
    await mkdir(dbPath, { recursive: true });
    process.env.MONGOMS_DOWNLOAD_DIR ||= path.resolve('.data/mongodb-binaries');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    local = await MongoMemoryServer.create({
      binary: { version: '7.0.14' },
      instance: { dbPath, storageEngine: 'wiredTiger', dbName: 'ledgerly' },
    });
    uri = local.getUri('ledgerly');
    console.log('Local development MongoDB is running. Records persist in .data/mongo.');
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  return {
    local: Boolean(local),
    close:
      /* Disconnect MongoDB and stop the local demo process if this connection started it. */ async () => {
        await mongoose.disconnect();
        if (local) await local.stop({ doCleanup: false });
      },
  };
}
