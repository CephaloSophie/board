const { Schema, model } = require('mongoose');
const { ROLES } = require('./User');

// Per-project role assignment. When present it OVERRIDES the user's global
// account role *for that project* (superadmin always stays superadmin). This
// lets the same person be, say, a developer globally but Scrum Master on one
// project.
const projectMemberSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, required: true },
  },
  { timestamps: true }
);

projectMemberSchema.index({ project: 1, user: 1 }, { unique: true });

module.exports = { ProjectMember: model('ProjectMember', projectMemberSchema) };
