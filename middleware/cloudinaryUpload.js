const multer = require('multer');
const cloudinary = require('../config/cloudinary');

// =============================================
// USE MEMORY STORAGE (no disk writes)
// =============================================
const storage = multer.memoryStorage();

// =============================================
// FILE FILTERS
// =============================================
const imageFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'), false);
    }
};

const documentFilter = (req, file, cb) => {
    const allowedTypes = [
        'application/pdf',
        'text/plain',
        'application/zip',
        'application/x-zip-compressed',
        'application/octet-stream',
    ];

    if (allowedTypes.includes(file.mimetype) || file.mimetype.startsWith('text/')) {
        cb(null, true);
    } else {
        cb(new Error('Only PDF, Text, and ZIP files are allowed!'), false);
    }
};

// =============================================
// MULTER INSTANCES (memory only)
// =============================================
const profileUpload = multer({
    storage,
    fileFilter: imageFilter,
    limits: { fileSize: 5 * 1024 * 1024, files: 1 }, // 5MB
});

const documentUpload = multer({
    storage,
    fileFilter: documentFilter,
    limits: { fileSize: 50 * 1024 * 1024, files: 1 }, // 50MB
});

// =============================================
// MULTER MIDDLEWARES
// =============================================
const uploadUserProfile = profileUpload.single('profileImage');
const uploadDocument = documentUpload.single('file');

// =============================================
// HELPER: UPLOAD BUFFER TO CLOUDINARY
// =============================================
const uploadBufferToCloudinary = (buffer, options = {}) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
            if (error) return reject(error);
            resolve(result);
        });
        stream.end(buffer);
    });
};

// =============================================
// HELPER: DELETE FROM CLOUDINARY
// =============================================
const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
    if (!publicId) return false;
    try {
        const result = await cloudinary.uploader.destroy(publicId, {
            resource_type: resourceType,
            invalidate: true,
        });
        return result.result === 'ok';
    } catch (error) {
        console.error('Cloudinary delete error:', error);
        return false;
    }
};

// =============================================
// HELPER: EXTRACT PUBLIC_ID FROM URL
// =============================================
const extractPublicId = (url) => {
    if (!url) return null;
    try {
        // Example: https://res.cloudinary.com/demo/image/upload/v1234/folder/file.jpg
        const parts = url.split('/upload/');
        if (parts.length < 2) return null;
        const afterUpload = parts[1]; // v1234/folder/file.jpg
        const withoutVersion = afterUpload.replace(/^v\d+\//, ''); // folder/file.jpg
        const publicId = withoutVersion.replace(/\.[^/.]+$/, ''); // folder/file
        return publicId;
    } catch {
        return null;
    }
};

// =============================================
// ERROR HANDLER
// =============================================
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: `File too large. Maximum size is ${err.field === 'file' ? '50MB' : '5MB'}.`,
            });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                error: `Unexpected field name. Use "${err.field === 'file' ? 'file' : 'profileImage'}".`,
            });
        }
        return res.status(400).json({ success: false, error: err.message });
    } else if (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
    next();
};

module.exports = {
    uploadUserProfile,
    uploadDocument,
    handleMulterError,
    uploadBufferToCloudinary,
    deleteFromCloudinary,
    extractPublicId,
};