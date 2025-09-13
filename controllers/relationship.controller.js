import Relationship from '../models/relationships.js';

export const createRelationship = async (req, res) => {
    try {
        const { requester, recipient } = req.body;
        const existingRelationship = await Relationship.findOne({
            $or: [
                { requester, recipient },
                { requester: recipient, recipient: requester }
            ]
        });
        if (existingRelationship) {
            return res.status(400).json({ message: 'Relationship already exists' });
        }
        const relationship = new Relationship({ requester, recipient });
        await relationship.save();
        res.status(201).json(relationship);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

export const updateRelationship = async (req, res) => {
    try {
        const { relationshipId } = req.params;
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
        res.status(500).json({ message: error.message });
    }
}

export const getFriendsUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const friends = await Relationship.find({
            $or: [{ requester: userId, status: 'accepted' }, { recipient: userId, status: 'accepted' }]
        });
        const friendIds = friends.map(friend =>
            friend.requester.toString() === userId ? friend.recipient : friend.requester
        );
        res.status(200).json(friendIds);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

export const getBlocksUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const blocks = await Relationship.find({
            $or: [{ requester: userId, status: 'blocked' }, { recipient: userId, status: 'blocked' }]
        });
        const blockedUserIds = blocks.map(block =>
            block.requester.toString() === userId ? block.recipient : block.requester
        );
        res.status(200).json(blockedUserIds);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

export const getPendingRequests = async (req, res) => {
    try {
        const { userId } = req.params;
        const requests = await Relationship.find({
            $or: [{ requester: userId, status: 'pending' }, { recipient: userId, status: 'pending' }]
        });
        const requestIds = requests.map(request =>
            request.requester.toString() === userId ? request.recipient : request.requester
        );
        res.status(200).json(requestIds);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
export const deleteRelationship = async (req, res) => {
    try {
        const { relationshipId } = req.params;
        await Relationship.findByIdAndDelete(relationshipId);
        res.status(200).json({ message: 'Relationship deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

export default {
    createRelationship,
    updateRelationship,
    getFriendsUser,
    getBlocksUser,
    getPendingRequests,
    deleteRelationship
};