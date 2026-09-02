const checkStudent = (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (req.user.role !== 'STUDENT') {
            return res.status(403).json({ error: 'Access denied. Student account required.' });
        }
        if (req.user.isBlocked) {
            return res.status(403).json({ error: 'Your account has been blocked' });
        }
        next();
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = checkStudent;
