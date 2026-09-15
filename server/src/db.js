const mongoose = require('mongoose');
const { mongoUri } = require('./config');

async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoUri);
  // Never print credentials embedded in the connection string.
  if (!process.env.KYDOS_QUIET) console.log(`[db] connected to ${mongoUri.replace(/\/\/[^@/]*@/, '//***@')}`);
  return mongoose.connection;
}

module.exports = { connectDb, mongoose };
