const { Schema, model } = require('mongoose');

// One counter document per project, used to mint sequential human-readable
// task ids like "KB-155" without racing on the Task collection itself.
const counterSchema = new Schema({
  _id: { type: String, required: true }, // project key, e.g. "KB"
  seq: { type: Number, default: 0 },
});

const Counter = model('Counter', counterSchema);

async function nextTaskNumber(projectKey) {
  const doc = await Counter.findByIdAndUpdate(
    projectKey,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
}

module.exports = { Counter, nextTaskNumber };
