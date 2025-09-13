require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const admin = require('./firebaseAdmin');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const streamifier = require('streamifier');
const { generateToken } = require('./utils');
const { createRelationship,
        updateRelationship,
        getFriendsUser,
        getBlocksUser,
        getPendingRequests,
        deleteRelationship } = require('./controllers/relationship.controller')
const User = require('./models/User');
const Post = require('./models/post');
const Comment = require('./models/comment');
const Relationship = require('./models/relationships');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// connect mongoose
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error(err); process.exit(1); });

// init cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// middleware verify token
async function verifyToken(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
    const idToken = auth.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.firebaseUser = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}


// auth sync
app.post('/auth/sync', verifyToken, async (req, res) => {
  try {
    const { uid, email } = req.firebaseUser || {};
    const { fullName, profilePic } = req.body || {};
    let user = await User.findOne({ firebaseUid: uid });

    if (user) {
      let changed = false;
      if (fullName && fullName !== user.fullName) { user.fullName = fullName; changed = true; }
      if (profilePic && profilePic !== user.profilePic) { user.profilePic = profilePic; changed = true; }
      if (email && email !== user.email) { user.email = email; changed = true; }
      if (changed) { user.updatedAt = new Date(); await user.save(); }
      const jwtToken = generateToken(user._id, res);
      return res.json({ ok: true, user, token: jwtToken });
    }

    if (email) {
      user = await User.findOne({ email });
      if (user) {
        user.firebaseUid = uid;
        if (fullName) user.fullName = fullName;
        if (profilePic) user.profilePic = profilePic;
        user.updatedAt = new Date();
        await user.save();
        const jwtToken = generateToken(user._id, res);
        return res.json({ ok: true, user, token: jwtToken });
      }
    }

    const newUser = new User({
      firebaseUid: uid,
      email: email || '',
      fullName: fullName || '',
      profilePic: profilePic || '',
      socialMedia: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await newUser.save();
    const jwtToken = generateToken(newUser._id, res);
    return res.json({ ok: true, user: newUser, token: jwtToken });
  } catch (err) {
    if (err && err.code === 11000) return res.status(409).json({ error: 'Duplicate key', details: err.keyValue });
    return res.status(500).json({ error: 'Server error' });
  }
});

// get profile
app.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.firebaseUser.uid }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ ok: true, user });
  } catch {
    return res.status(500).json({ error: 'Server error' });
  }
});

// update profile
app.put('/me', verifyToken, async (req, res) => {
  try {
    const uid = req.firebaseUser.uid;
    const { fullName, profilePic, socialMedias } = req.body || {};
    const update = {};
    if (fullName) update.fullName = fullName;
    if (profilePic) update.profilePic = profilePic;
    if (Array.isArray(socialMedias)) update.socialMedias = socialMedias;
    update.updatedAt = new Date();

    const user = await User.findOneAndUpdate(
      { firebaseUid: uid },
      { $set: update },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const firebaseUpdate = {};
    if (fullName) firebaseUpdate.displayName = fullName;
    if (profilePic) firebaseUpdate.photoURL = profilePic;
    if (Object.keys(firebaseUpdate).length > 0) {
      await admin.auth().updateUser(uid, firebaseUpdate);
    }

    return res.json({ ok: true, user });
  } catch {
    return res.status(500).json({ error: 'Server error' });
  }
});

// update location
app.put('/me/location', verifyToken, async (req, res) => {
  try {
    const { latitude, longitude } = req.body || {};
    const user = await User.findOneAndUpdate(
      { firebaseUid: req.firebaseUser.uid },
      { location: { type: 'Point', coordinates: [longitude, latitude] } },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ ok: true, user });
  } catch {
    return res.status(500).json({ error: 'Server error' });
  }
});
// get nearby users
app.get('/users/nearby', verifyToken, async (req, res) => {
  try {
    const { latitude, longitude, distance } = req.query;
    const users = await User.find({
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [parseFloat(longitude), parseFloat(latitude)] },
          $maxDistance: parseFloat(distance)
        }
      }
    }).select('-firebaseUid -email -socialMedia -createdAt -updatedAt');
    res.json({ ok: true, users });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// get posts
app.get('/api/posts', verifyToken, async (req, res) => {
  try {
    const posts = await Post.find()
      .populate('userId', 'fullName profilePic')
      .populate({ path: 'comments', populate: { path: 'userId', select: 'fullName profilePic' } })
      .populate('reactions.userId', 'fullName profilePic');
    res.json(posts);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// react to post
app.post('/api/posts/:postId/react', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const { type } = req.body;
    const user = await User.findOne({ firebaseUid: req.firebaseUser.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const validTypes = ["like", "heart", "smile", "sad", "angry"];
    if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid reaction type' });

    post.reactions = post.reactions.filter(r => r.userId?.toString() !== user._id.toString());
    post.reactions.push({ userId: user._id, type });
    await post.save();
    res.json({ ok: true, post, message: `React '${type}' thành công!` });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// upload image
const upload = multer({ storage: multer.memoryStorage() });

app.post('/upload', verifyToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });

    // Dùng stream để upload buffer trực tiếp lên Cloudinary
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'social_media_profiles' },
      (error, result) => {
        if (error) {
          console.error(error);
          return res.status(500).json({ error: 'Upload error' });
        }
        return res.json({ ok: true, url: result.secure_url });
      }
    );

    streamifier.createReadStream(req.file.buffer).pipe(stream);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Upload error' });
  }
});


// comment
app.post('/api/posts/:postId/comments', verifyToken, async (req, res) => {
  try {
    const { content } = req.body;
    const { postId } = req.params;
    const user = await User.findOne({ firebaseUid: req.firebaseUser.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!content) return res.status(400).json({ error: 'Missing content' });

    const newComment = new Comment({ postId, userId: user._id, content });
    await newComment.save();
    await Post.findByIdAndUpdate(postId, { $push: { comments: newComment._id } });
    res.status(201).json({ ok: true, comment: newComment, message: 'Comment thành công!' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// upload video helper
const uploadVideoToCloudinary = (fileBuffer) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream({ resource_type: "video" }, (err, result) => {
    if (err) reject(err);
    else resolve(result.secure_url);
  });
  streamifier.createReadStream(fileBuffer).pipe(stream);
});

// create post
app.post('/api/posts/create', verifyToken, multer().fields([{ name: 'video' }, { name: 'image' }]), async (req, res) => {
  try {
    const { title, content } = req.body;
    const user = await User.findOne({ firebaseUid: req.firebaseUser.uid });
    if (!user) return res.status(401).json({ error: "Bạn cần đăng nhập để đăng bài." });

    let mediaURL = null;
    if (req.body.image) {
      const uploadResponse = await cloudinary.uploader.upload(req.body.image, { resource_type: "auto" });
      mediaURL = uploadResponse.secure_url;
    }
    if (req.files && req.files.video) {
      mediaURL = await uploadVideoToCloudinary(req.files.video[0].buffer);
    }

    const newPost = new Post({ userId: user._id, title, content, media: mediaURL });
    await newPost.save();
    res.status(201).json(newPost);
  } catch {
    res.status(500).json({ error: "Lỗi server!" });
  }
});

//-----------------------------------------------------------Relationship routes-----------------------------------------------------------//
// search users

app.get('/api/users/search', verifyToken, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string' || !q.trim()) {
      return res.status(400).json({ error: 'Missing search query' });
    }
    const users = await User.find({
      $or: [
        { fullName: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ]
    }).select('fullName email profilePic');
    return res.json({ ok: true, users });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});


// create relationship
const mongoose = require('mongoose');

// POST /api/relationships
app.post('/api/relationships', verifyToken, async (req, res) => {
  try {
    // verifyToken phải gán req.userId (id của user đang login)
    const requester = req.userId;
    const { recipient } = req.body;

    if (!requester) {
      return res.status(401).json({ message: 'Unauthorized: missing requester' });
    }

    if (!recipient) {
      return res.status(400).json({ message: 'recipient is required' });
    }

    // validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(recipient)) {
      return res.status(400).json({ message: 'Invalid recipient id' });
    }

    // prevent sending request to self
    if (requester.toString() === recipient.toString()) {
      return res.status(400).json({ message: 'Cannot create relationship with yourself' });
    }

    // check existing relationship in either direction
    const existingRelationship = await Relationship.findOne({
      $or: [
        { requester, recipient },
        { requester: recipient, recipient: requester }
      ]
    });

    if (existingRelationship) {
      // nếu muốn, có thể trả 200 + existing relationship thay vì 400
      // hoặc trả 409 Conflict. Ở đây trả 200 với object hiện có để client biết trạng thái.
      const populated = await Relationship.findById(existingRelationship._id)
        .populate('requester', 'fullName email profilePic')
        .populate('recipient', 'fullName email profilePic');
      return res.status(200).json({ message: 'Relationship already exists', relationship: populated });
    }

    // tạo mới: requester lấy từ token để tránh client gán lộn
    const relationship = new Relationship({ requester, recipient, status: 'pending' });

    try {
      await relationship.save();
    } catch (saveErr) {
      // handle duplicate key (race condition)
      if (saveErr && saveErr.code === 11000) {
        const existing = await Relationship.findOne({
          $or: [
            { requester, recipient },
            { requester: recipient, recipient: requester }
          ]
        });
        const populated = existing
          ? await Relationship.findById(existing._id).populate('requester', 'fullName email profilePic').populate('recipient', 'fullName email profilePic')
          : null;
        return res.status(200).json({ message: 'Relationship already exists', relationship: populated });
      }
      throw saveErr;
    }

    // trả về relationship đã populate để client không phải fetch thêm
    const populated = await Relationship.findById(relationship._id)
      .populate('requester', 'fullName email profilePic')
      .populate('recipient', 'fullName email profilePic');

    res.status(201).json(populated);
  } catch (error) {
    console.error('Create relationship error:', error);
    res.status(500).json({ message: error.message });
  }
});


// update relationship
app.put('/api/relationships/:relationshipId', verifyToken, async (req, res) => {
  try {
    const { relationshipId } = req.params;
    console.log('PUT /api/relationships/:relationshipId called, params:', req.params, 'body:', req.body, 'req.userId:', req.userId);

    if (!mongoose.Types.ObjectId.isValid(relationshipId)) {
      return res.status(400).json({ message: 'Invalid relationshipId' });
    }

    const { status } = req.body;
    const relationship = await Relationship.findByIdAndUpdate(
      relationshipId,
      { status, updatedAt: new Date() },
      { new: true }
    );
    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }
    res.status(200).json(relationship);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});
// get friends
app.get('/api/relationships/friends/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const friends = await Relationship.find({
      $or: [
        { requester: userId, status: 'accepted' },
        { recipient: userId, status: 'accepted' }
      ]
    });
    const friendIds = friends.map(friend =>
      friend.requester.toString() === userId ? friend.recipient : friend.requester
    );
    res.status(200).json(friendIds);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// get blocks
app.get('/api/relationships/blocks/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const blocks = await Relationship.find({
      $or: [
        { requester: userId, status: 'blocked' },
        { recipient: userId, status: 'blocked' }
      ]
    });
    const blockedUserIds = blocks.map(block =>
      block.requester.toString() === userId ? block.recipient : block.requester
    );
    res.status(200).json(blockedUserIds);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// get pending requests
app.get('/api/relationships/requests/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const requests = await Relationship.find({
      $or: [
        { requester: userId, status: 'pending' },
        { recipient: userId, status: 'pending' }
      ]
    });
    const requestIds = requests.map(request =>
      request.requester.toString() === userId ? request.recipient : request.requester
    );
    res.status(200).json(requestIds);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// delete relationship
app.delete('/api/relationships/:relationshipId', verifyToken, async (req, res) => {
  try {
    const { relationshipId } = req.params;
    await Relationship.findByIdAndDelete(relationshipId);
    res.status(200).json({ message: 'Relationship deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// start server
module.exports = app;

