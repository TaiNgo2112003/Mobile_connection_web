//user.controller.
export const updateLocation = async (req, res) => {
    try {
        const { lattitude, longitude } = req.body || {};
        const userId = req.user._id;

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { location: { type: 'Point', coordinates: [longitude, lattitude] } },
            { new: true }
        );
        if (!updatedUser) {
            return res.status(404).json({ error: 'User not found' });
        }
        return res.json({ ok: true, user: updatedUser });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
};  
export const findNearbyUsers = async (req, res) => {
    try {
        const { lattitude, longitude, distance } = req.query;
        const users = await User.find({
            location: {
                $near:{
                    $geometry: { type: "Point", coordinates: [parseFloat(longitude), parseFloat(lattitude)] },
                    $maxDistance: parseFloat(distance)
                }
            }
        }).select('-firebaseUid -email -socialMedia -createdAt -updatedAt');
        res.json({ ok: true, users });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
};