import User from '../models/User.js'; 
import mongoose from 'mongoose';

/**
 * Tạo friend request
 * requester = req.user.id (người gửi)
 * recipient = body.recipient (id hoặc email tùy client)
 */
export const createRelationship = async (req, res) => {
  try {
    const requester = req.user.id; // giả sử auth middleware
    const { recipient } = req.body;

    if (!recipient) return res.status(400).json({ message: 'Recipient required' });
    if (requester === recipient) return res.status(400).json({ message: 'Cannot friend yourself' });

    // Check existing relationship both cách đã được xử lý bởi pairHash unique nhưng check trước để trả lỗi thân thiện
    const pairHash = [requester, recipient].sort().join(':');
    const existing = await Relationship.findOne({ pairHash });
    if (existing) {
      return res.status(400).json({ message: 'Relationship already exists', existing });
    }

    const relationship = new Relationship({
      requester,
      recipient,
      status: 'pending'
    });

    await relationship.save();
    // populate before return
    await relationship.populate('requester', 'fullName email profilePic').populate('recipient', 'fullName email profilePic').execPopulate?.();

    res.status(201).json(relationship);
  } catch (error) {
    // handle duplicate key race condition
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Relationship already exists (race)' });
    }
    res.status(500).json({ message: error.message });
  }
};

/**
 * Accept / Reject / Block
 * Only recipient can accept/reject a pending request
 */
export const updateRelationship = async (req, res) => {
  try {
    const { relationshipId } = req.params;
    const { status } = req.body; // expected 'accepted'|'rejected'|'blocked'
    const userId = req.user.id;

    const rel = await Relationship.findById(relationshipId);
    if (!rel) return res.status(404).json({ message: 'Relationship not found' });

    // only recipient can accept/reject when current status is pending
    if (rel.status === 'pending' && status === 'accepted') {
      if (rel.recipient.toString() !== userId) {
        return res.status(403).json({ message: 'Only recipient can accept the request' });
      }
    }

    rel.status = status;
    rel.updatedAt = new Date();
    await rel.save();

    await rel.populate('requester', 'fullName email profilePic').populate('recipient', 'fullName email profilePic').execPopulate?.();

    res.status(200).json(rel);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Search users by q (email or fullName)
 * Exclude self and optionally exclude users with existing relationships
 */
export const searchUsers = async (req, res) => {
  try {
    const userId = req.user.id;
    const q = req.query.q || '';
    if (!q) return res.status(400).json({ message: 'Query param q required' });
    const rels = await Relationship.find({
      $or: [{ requester: userId }, { recipient: userId }]
    });

    const relatedIds = new Set();
    rels.forEach(r => {
      const a = r.requester.toString();
      const b = r.recipient.toString();
      if (a !== userId) relatedIds.add(a);
      if (b !== userId) relatedIds.add(b);
    });

    const regex = new RegExp(q, 'i');
    const users = await User.find({
      _id: { $ne: userId, $nin: Array.from(relatedIds) },
      $or: [{ email: regex }, { fullName: regex }]
    }).select('fullName email profilePic');

    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get incoming pending (requests where user is recipient)
 */
export const getIncomingPending = async (req, res) => {
  try {
    const userId = req.params.userId;
    const incoming = await Relationship.find({ recipient: userId, status: 'pending' })
      .populate('requester', 'fullName email profilePic')
      .populate('recipient', 'fullName email profilePic');
    res.status(200).json(incoming);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get outgoing pending (requests where user is requester)
 */
export const getOutgoingPending = async (req, res) => {
  try {
    const userId = req.params.userId;
    const outgoing = await Relationship.find({ requester: userId, status: 'pending' })
      .populate('requester', 'fullName email profilePic')
      .populate('recipient', 'fullName email profilePic');
    res.status(200).json(outgoing);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get friends list (accepted) — trả về user objects
 */
export const getFriendsUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const friends = await Relationship.find({
      $or: [{ requester: userId, status: 'accepted' }, { recipient: userId, status: 'accepted' }]
    }).populate('requester', 'fullName email profilePic').populate('recipient', 'fullName email profilePic');

    // map to other user object (so client không cần biết ai là requester)
    const friendUsers = friends.map(f => {
      const other = f.requester._id.toString() === userId ? f.recipient : f.requester;
      return { _id: other._id, fullName: other.fullName, email: other.email, profilePic: other.profilePic };
    });

    res.status(200).json(friendUsers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Unfriend (delete relationship) — either party can call
 */
export const unfriend = async (req, res) => {
  try {
    const { userId } = req.user; // caller
    const { otherUserId } = req.params;

    const pairHash = [userId, otherUserId].sort().join(':');
    const rel = await Relationship.findOneAndDelete({ pairHash });
    if (!rel) return res.status(404).json({ message: 'Relationship not found' });

    res.status(200).json({ message: 'Unfriended' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export default {
  createRelationship,
  updateRelationship,
  searchUsers,
  getIncomingPending,
  getOutgoingPending,
  getFriendsUser,
  unfriend
};