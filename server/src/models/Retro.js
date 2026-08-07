const { Schema, model } = require('mongoose');

// A sticky note written by a participant during the Start/Stop/Continue phase.
const stickySchema = new Schema(
  {
    id: { type: String, required: true }, // client-generated uuid-ish
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    column: { type: String, enum: ['start', 'stop', 'continue'], required: true },
    text: { type: String, default: '', trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ratingSchema = new Schema(
  { user: { type: Schema.Types.ObjectId, ref: 'User' }, value: { type: Number } },
  { _id: false }
);

const voteSchema = new Schema(
  { user: { type: Schema.Types.ObjectId, ref: 'User' }, stickyId: { type: String }, points: { type: Number, default: 1 } },
  { _id: false }
);

const actionSchema = new Schema(
  {
    stickyId: { type: String },
    text: { type: String, trim: true },
    fromUser: { type: Schema.Types.ObjectId, ref: 'User' },
    score: { type: Number, default: 0 },
    done: { type: Boolean, default: false }, // was it applied? (reviewed next retro)
  },
  { _id: true }
);

// Phases of the ceremony, in order.
const PHASES = ['lobby', 'rating', 'ssc', 'voting', 'actions', 'closing', 'done'];

const retroSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    sprint: { type: String, required: true }, // sprint taxonomy key — a retro belongs to ONE sprint
    team: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
    title: { type: String, trim: true, default: '' },

    facilitator: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // animator (delegable)
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },

    phase: { type: String, enum: PHASES, default: 'lobby' },
    status: { type: String, enum: ['draft', 'running', 'done'], default: 'draft' },

    invited: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    absent: [{ type: Schema.Types.ObjectId, ref: 'User' }],

    ratingRevealed: { type: Boolean, default: false },
    ratings: { type: [ratingSchema], default: [] }, // past-sprint rating (1..5)

    stickies: { type: [stickySchema], default: [] },
    sscRevealed: { type: Boolean, default: false },
    // Order in which participants speak (random), and the current speaker index.
    speakerOrder: { type: [Schema.Types.ObjectId], default: [] },
    speakerIndex: { type: Number, default: 0 },
    // SSC writing timer.
    timerEndsAt: { type: Date, default: null },

    votesConfig: {
      perPerson: { type: Number, default: 4 },
      minPer: { type: Number, default: 1 },
      maxPer: { type: Number, default: 2 },
    },
    votes: { type: [voteSchema], default: [] },
    votesRevealed: { type: Boolean, default: false },

    actionItems: { type: [actionSchema], default: [] }, // selected proposals → next-sprint goals

    retroRatingRevealed: { type: Boolean, default: false },
    retroRatings: { type: [ratingSchema], default: [] }, // rate the retro itself
  },
  { timestamps: true }
);

module.exports = { Retro: model('Retro', retroSchema), RETRO_PHASES: PHASES };
