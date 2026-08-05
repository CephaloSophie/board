const mongoose = require('mongoose');
const { mongoUri } = require('./config');

async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoUri);
  console.log(`[db] connected to ${mongoUri}`);
  return mongoose.connection;
}

module.exports = { connectDb, mongoose };
