const { Schema, model } = require('mongoose');

// Role a member holds inside a team (independent from the account role).
const TEAM_ROLES = ['lead', 'developer', 'qa', 'po', 'sm', 'designer', 'stakeholder'];

const memberSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    teamRole: { type: String, enum: TEAM_ROLES, default: 'developer' },
    capacityPoints: { type: Number, default: 0 }, // per-sprint capacity for this member
  },
  { _id: false }
);

const teamSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, default: '#6b78ea' },
    description: { type: String, trim: true, default: '' },
    // Team-level capacity per sprint (story points). If 0, the app falls back
    // to summing members' individual capacities.
    capacityPoints: { type: Number, default: 0 },
    members: { type: [memberSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = { Team: model('Team', teamSchema), TEAM_ROLES };
