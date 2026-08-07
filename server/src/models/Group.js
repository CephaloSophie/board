const { Schema, model } = require('mongoose');

// A user grouping used to scope things like poker voters. `kind` distinguishes
// a "group" (a named set of people) from a "tag" (a label) — both behave the
// same technically, the distinction is organizational for the UI.
const KINDS = ['group', 'tag'];

const groupSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: KINDS, default: 'group' },
    color: { type: String, default: '#6b78ea' },
    members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

groupSchema.index({ project: 1, kind: 1, name: 1 }, { unique: true });

module.exports = { Group: model('Group', groupSchema), GROUP_KINDS: KINDS };
