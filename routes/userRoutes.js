// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const passport = require('passport');
const jwt = require('jsonwebtoken');

const User = require('../models/UserSchema.js');
const Attempt = require('../models/AttemptSchema.js');
const checkAdmin = require('../middleware/checkAdmin.js');

const {
    uploadUserProfile,
    handleMulterError,
    uploadBufferToCloudinary,
    deleteFromCloudinary,
    extractPublicId,
} = require('../middleware/cloudinaryUpload.js');

const requireAuth = passport.authenticate('jwt', { session: false });

////////////////////////////// AUTH //////////////////////////////

// ==================== REGISTER ====================
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, phone } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email and password are required' });
        }
        if (String(password).length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long' });
        }

        const query = [{ email: String(email).toLowerCase() }];
        if (phone) query.push({ phone });

        const existingUser = await User.findOne({ $or: query });
        if (existingUser) {
            return res.status(400).json({ error: 'An account already exists with this email or phone' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = new User({
            Name: name,
            email,
            password: hashedPassword,
            phone,
            role: 'STUDENT',
        });
        await user.save();

        const token = jwt.sign(user.id, process.env.JWT_SECRET);
        const userResponse = user.toObject();
        delete userResponse.password;

        res.status(201).json({
            message: 'Registration successful',
            user: userResponse,
            token,
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error during registration' });
    }
});

// ==================== LOGIN ====================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await User.findOne({ email: String(email).toLowerCase(), isActive: true });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        if (user.isBlocked) return res.status(403).json({ error: 'Your account has been blocked' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign(user.id, process.env.JWT_SECRET);
        const userResponse = user.toObject();
        delete userResponse.password;

        res.json({ message: 'Login successful', token, user: userResponse });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

////////////////////////////// PROFILE //////////////////////////////

// ==================== GET MY PROFILE ====================
router.get('/profile', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password');
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE MY PROFILE ====================
router.put('/updateProfile', requireAuth, async (req, res) => {
    try {
        const { Name, phone } = req.body;
        const updateFields = {};
        if (Name) updateFields.Name = Name;
        if (phone) updateFields.phone = phone;

        const user = await User.findByIdAndUpdate(
            req.user._id,
            { $set: updateFields },
            { new: true, runValidators: true }
        ).select('-password');

        res.json({ message: 'Profile updated successfully', user });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== CHANGE PASSWORD ====================
router.put('/changePassword', requireAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new password are required' });
        }
        if (String(newPassword).length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters long' });
        }

        const user = await User.findById(req.user._id);
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect' });

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPLOAD PROFILE IMAGE (CLOUDINARY) ====================
router.post(
    '/uploadProfileImage',
    requireAuth,
    uploadUserProfile,
    handleMulterError,
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No image file uploaded' });
            }

            const user = await User.findById(req.user._id);
            if (!user) return res.status(404).json({ error: 'User not found' });

            // Delete old image from Cloudinary
            if (user.profileImagePublicId) {
                await deleteFromCloudinary(user.profileImagePublicId, 'image');
            }

            // Upload new image to Cloudinary
            const result = await uploadBufferToCloudinary(req.file.buffer, {
                folder: 'exam-app/profiles',
                resource_type: 'image',
                transformation: [
                    { width: 500, height: 500, crop: 'fill', gravity: 'face' },
                    { quality: 'auto', fetch_format: 'auto' },
                ],
            });

            user.profileImage = result.secure_url;
            user.profileImagePublicId = result.public_id;
            await user.save();

            res.json({
                message: 'Profile image updated successfully',
                profileImage: user.profileImage,
            });
        } catch (error) {
            console.error('Profile image upload error:', error);
            res.status(500).json({ error: 'Server error while uploading profile image' });
        }
    }
);

////////////////////////////// ADMIN - STUDENT MANAGEMENT //////////////////////////////

// ==================== LIST ALL STUDENTS ====================
router.get('/students', requireAuth, checkAdmin, async (req, res) => {
    try {
        const { search, status } = req.query;
        const filter = { role: 'STUDENT' };

        if (status === 'BLOCKED') filter.isBlocked = true;
        if (status === 'ACTIVE') filter.isBlocked = false;

        if (search) {
            const regex = new RegExp(String(search).trim(), 'i');
            filter.$or = [{ Name: regex }, { email: regex }];
        }

        const students = await User.find(filter).select('-password').sort({ createdAt: -1 });

        const counts = await Attempt.aggregate([
            { $group: { _id: '$student', attempts: { $sum: 1 } } },
        ]);
        const countMap = new Map(counts.map((c) => [String(c._id), c.attempts]));

        const data = students.map((student) => ({
            ...student.toObject(),
            attemptCount: countMap.get(String(student._id)) || 0,
        }));

        res.json({ count: data.length, students: data });
    } catch (error) {
        console.error('List students error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ONE STUDENT ====================
router.get('/students/:id', requireAuth, checkAdmin, async (req, res) => {
    try {
        const student = await User.findOne({ _id: req.params.id, role: 'STUDENT' }).select('-password');
        if (!student) return res.status(404).json({ error: 'Student not found' });

        const attempts = await Attempt.find({ student: student._id })
            .populate('exam', 'title subject examCode scheduledAt')
            .sort({ createdAt: -1 });

        res.json({ student, attempts });
    } catch (error) {
        console.error('Get student error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== BLOCK / UNBLOCK STUDENT ====================
router.put('/students/:id/block', requireAuth, checkAdmin, async (req, res) => {
    try {
        const student = await User.findOne({ _id: req.params.id, role: 'STUDENT' });
        if (!student) return res.status(404).json({ error: 'Student not found' });

        student.isBlocked =
            typeof req.body.isBlocked === 'boolean' ? req.body.isBlocked : !student.isBlocked;
        await student.save();

        res.json({
            message: student.isBlocked ? 'Student blocked' : 'Student unblocked',
            isBlocked: student.isBlocked,
        });
    } catch (error) {
        console.error('Block student error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DELETE STUDENT ====================
router.delete('/students/:id', requireAuth, checkAdmin, async (req, res) => {
    try {
        const student = await User.findOne({ _id: req.params.id, role: 'STUDENT' });
        if (!student) return res.status(404).json({ error: 'Student not found' });

        // Delete profile image from Cloudinary
        if (student.profileImagePublicId) {
            await deleteFromCloudinary(student.profileImagePublicId, 'image');
        }

        await Attempt.deleteMany({ student: student._id });
        await User.findByIdAndDelete(student._id);

        res.json({ message: 'Student deleted successfully' });
    } catch (error) {
        console.error('Delete student error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;