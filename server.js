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
const router = require('express').Router();
const {
        createRelationship,
        updateRelationship,
        searchUsers,
        getIncomingPending,
        getOutgoingPending,
        getFriendsUser,
        unfriend 
      } = require('./controllers/relationship.controller')

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

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
const ensureSelfOrAdmin = (req, res) => {
  const paramUserId = req.params.userId;
  const callerId = req.user && req.user.id ? req.user.id.toString() : null;
  const isAdmin = req.user && req.user.isAdmin; 
  if (!paramUserId) return { ok: true };
  if (isAdmin) return { ok: true };
  if (paramUserId.toString() !== callerId) {
    return { ok: false, res: res.status(403).json({ message: 'Forbidden: không được phép truy cập dữ liệu của người khác' }) };
  }
  return { ok: true };
};
router.get(
  '/users/search',
  verifyToken,
  asyncHandler(async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ message: 'Query parameter "q" is required' });

    return await searchUsers(req, res);
  })
);

router.post(
  '/relationships',
  verifyToken,
  asyncHandler(async (req, res) => {
    const recipient = req.body.recipient;
    if (!recipient) return res.status(400).json({ message: 'Field "recipient" is required' });

    if (req.user && req.user.id && req.user.id.toString() === recipient.toString()) {
      return res.status(400).json({ message: 'Cannot send friend request to yourself' });
    }

    return await createRelationship(req, res);
  })
);


router.put(
  '/relationships/:relationshipId',
  verifyToken,
  asyncHandler(async (req, res) => {
    return await updateRelationship(req, res);
  })
);

router.get(
  '/relationships/incoming/:userId',
  verifyToken,
  asyncHandler(async (req, res) => {
    const check = ensureSelfOrAdmin(req, res);
    if (!check.ok) return;
    return await getIncomingPending(req, res);
  })
);


router.get(
  '/relationships/outgoing/:userId',
  verifyToken,
  asyncHandler(async (req, res) => {
    const check = ensureSelfOrAdmin(req, res);
    if (!check.ok) return;
    return await getOutgoingPending(req, res);
  })
);

router.get(
  '/relationships/pending/:userId',
  verifyToken,
  asyncHandler(async (req, res) => {
    const check = ensureSelfOrAdmin(req, res);
    if (!check.ok) return;

    const userId = req.params.userId;

    // lấy incoming
    const incoming = await Relationship.find({ recipient: userId, status: 'pending' })
      .populate('requester', 'fullName email profilePic')
      .populate('recipient', 'fullName email profilePic');

    // lấy outgoing
    const outgoing = await Relationship.find({ requester: userId, status: 'pending' })
      .populate('requester', 'fullName email profilePic')
      .populate('recipient', 'fullName email profilePic');

    return res.status(200).json({ incoming, outgoing });
  })
);



router.get(
  '/relationships/blocks/:userId',
  verifyToken,
  asyncHandler(async (req, res) => {
    const check = ensureSelfOrAdmin(req, res);
    if (!check.ok) return;

    const userId = req.params.userId;
    const blocks = await Relationship.find({
      $or: [{ requester: userId, status: 'blocked' }, { recipient: userId, status: 'blocked' }]
    }).populate('requester', 'fullName email profilePic').populate('recipient', 'fullName email profilePic');

    // map to other user
    const blockedUsers = blocks.map(b => {
      const other = b.requester._id.toString() === userId ? b.recipient : b.requester;
      return { _id: other._id, fullName: other.fullName, email: other.email, profilePic: other.profilePic };
    });

    return res.status(200).json(blockedUsers);
  })
);


router.delete(
  '/relationships/:otherUserId',
  verifyToken,
  asyncHandler(async (req, res) => {
    if (req.user && req.user.id && req.user.id.toString() === req.params.otherUserId?.toString()) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    return await unfriend(req, res);
  })
);
router.delete(
  '/relationships/id/:relationshipId',
  verifyToken,
  asyncHandler(async (req, res) => {
    const relId = req.params.relationshipId;
    if (!relId) return res.status(400).json({ message: 'relationshipId required' });

    const rel = await Relationship.findById(relId);
    if (!rel) return res.status(404).json({ message: 'Relationship not found' });

    const callerId = req.user && req.user.id ? req.user.id.toString() : null;
    const isAdmin = req.user && req.user.isAdmin;

    // chỉ requester, recipient hoặc admin được xóa
    if (!isAdmin && rel.requester.toString() !== callerId && rel.recipient.toString() !== callerId) {
      return res.status(403).json({ message: 'Forbidden: không có quyền xóa relationship này' });
    }

    await Relationship.findByIdAndDelete(relId);
    return res.status(200).json({ message: 'Relationship deleted' });
  })
);


// start server
module.exports = app;

