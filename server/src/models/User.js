const { Schema, model } = require('mongoose');

const ROLES = ['superadmin', 'developer'];

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

module.exports = { User: model('User', userSchema), ROLES };
