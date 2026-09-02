// middleware/multer.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const createUploadDirectories = () => {
    const dirs = [
        'uploads/profiles',
        'uploads/documents'
    ];

    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
};

createUploadDirectories();

// =============================================
// PROFILE IMAGE STORAGE
// =============================================
const profileStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/profiles/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, extension);
        cb(null, baseName + '-' + uniqueSuffix + extension);
    }
});

// =============================================
// DOCUMENT STORAGE
// =============================================
const documentStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/documents/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, extension);
        // Sanitize filename
        const sanitized = baseName.replace(/[^a-zA-Z0-9]/g, '_');
        cb(null, sanitized + '-' + uniqueSuffix + extension);
    }
});

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
        'application/octet-stream'
    ];
    
    if (allowedTypes.includes(file.mimetype) || file.mimetype.startsWith('text/')) {
        cb(null, true);
    } else {
        cb(new Error('Only PDF, Text, and ZIP files are allowed!'), false);
    }
};

// =============================================
// MULTER INSTANCES
// =============================================
const profileUpload = multer({
    storage: profileStorage,
    fileFilter: imageFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
        files: 1
    }
});

const documentUpload = multer({
    storage: documentStorage,
    fileFilter: documentFilter,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
        files: 1
    }
});

// =============================================
// UPLOAD MIDDLEWARES
// =============================================
const uploadUserProfile = profileUpload.single('profileImage');
const uploadDocument = documentUpload.single('file');

// =============================================
// ERROR HANDLER
// =============================================
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: `File too large. Maximum size is ${err.field === 'file' ? '50MB' : '5MB'}.`
            });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                error: `Unexpected field name. Use "${err.field === 'file' ? 'file' : 'profileImage'}".`
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
    upload: profileUpload
};