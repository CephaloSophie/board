const { Schema, model } = require('mongoose');

// Images embedded in descriptions / comments. Stored in MongoDB (no extra
// infrastructure) and served from an unguessable public id so <img> tags work
// without an Authorization header.
const attachmentSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    publicId: { type: String, required: true, unique: true },
    uploader: { type: Schema.Types.ObjectId, ref: 'User' },
    taskId: { type: String },
    name: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true }
);

module.exports = { Attachment: model('Attachment', attachmentSchema) };
