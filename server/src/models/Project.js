const { Schema, model } = require('mongoose');

const projectSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    vendor: { type: String, trim: true },
    description: { type: String, trim: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User' },
    currentVersion: { type: String, trim: true, default: '0.1.0' },
    complexityScale: { type: String, default: 'Fibonacci (points de story) : 1, 2, 3, 5, 8, 13' },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = { Project: model('Project', projectSchema) };
