const { Schema, model } = require('mongoose');

// Agile team roles. `superadmin` is the platform owner; the others map to
// real Scrum/agile hats. Management actions (projects, taxonomies, teams)
// are allowed for MANAGER_ROLES; user administration stays superadmin-only.
const ROLES = [
  'superadmin',
  'project_manager',
  'product_owner',
  'scrum_master',
  'team_lead',
  'developer',
  'qa',
];

const MANAGER_ROLES = ['superadmin', 'project_manager', 'scrum_master', 'product_owner', 'team_lead'];

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    email: { type: String, trim: true, lowercase: true },
    displayName: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, default: 'developer' },
    color: { type: String, default: '#6b78ea' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    username: this.username,
    email: this.email,
    displayName: this.displayName,
    role: this.role,
    color: this.color,
    active: this.active,
    createdAt: this.createdAt,
  };
};

module.exports = { User: model('User', userSchema), ROLES, MANAGER_ROLES };
