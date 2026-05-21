const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, 'config.env') });

const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.ATLAS_URI ||
  process.env['ATLAS URI'];
const DB_NAME = process.env.DB_NAME || 'anonymous_chat';

function redactMongoUri(uri) {
  if (!uri) {
    return null;
  }

  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//***:***@');
}

async function main() {
  if (!MONGODB_URI) {
    console.error('Missing MongoDB connection string. Set MONGODB_URI in .env or config.env.');
    process.exitCode = 1;
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      dbName: DB_NAME,
      serverSelectionTimeoutMS: 10000,
    });

    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log(`Connected to "${DB_NAME}" using ${redactMongoUri(MONGODB_URI)}`);
    console.log(
      `Collections: ${
        collections.length > 0
          ? collections.map((collection) => collection.name).join(', ')
          : '(none yet)'
      }`
    );
  } catch (error) {
    console.error('MongoDB connectivity check failed.');
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
