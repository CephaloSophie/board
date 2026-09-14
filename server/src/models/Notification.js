const { Schema, model } = require('mongoose');

const NOTIFICATION_TYPES = ['mention', 'assigned', 'comment', 'reply', 'reaction', 'status'];

// In-app notifications, fetched by the client once per page load (no push / polling).
const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    projectKey: { type: String, required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    taskId: { type: String },
    taskTitle: { type: String },
    commentId: { type: Schema.Types.ObjectId },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorLabel: { type: String },
    excerpt: { type: String },
    read: { type: Boolean, default: false },
    readAt: { type: Date },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
notificationSchema.index({ project: 1 });

module.exports = { Notification: model('Notification', notificationSchema), NOTIFICATION_TYPES };
