// models/Relationship.js
const mongoose = require('mongoose');

const friendshipSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // pairHash giúp enforce unique không phụ thuộc thứ tự (A:B === B:A)
  pairHash: { type: String, required: true, unique: true, index: true },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'blocked'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// before validate/save, set pairHash as sorted ids
friendshipSchema.pre('validate', function(next) {
  try {
    const a = this.requester.toString();
    const b = this.recipient.toString();
    this.pairHash = [a, b].sort().join(':');
    this.updatedAt = new Date();
    next();
  } catch (err) { next(err); }
});

module.exports = mongoose.model('Relationship', friendshipSchema);
