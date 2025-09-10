const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    content: { type: String, required: false },
    media: { type: String, required: false },
    reactions: [
        {
          userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          type: { type: String, enum: ["like", "heart", "smile", "sad", "angry"] }
        }
      ],
    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
    shares: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', postSchema);
module.exports = Post;