// routes/DocumentRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const path = require('path');

const Document = require('../models/DocumentSchema.js');
const checkAdmin = require('../middleware/checkAdmin.js');

const {
    uploadDocument,
    handleMulterError,
    uploadBufferToCloudinary,
    deleteFromCloudinary,
} = require('../middleware/cloudinaryUpload.js');

const requireAuth = passport.authenticate('jwt', { session: false });

// =============================================
// HELPER: choose cloudinary resource_type
// =============================================
const getResourceType = (docType) => {
    // PDFs / ZIPs / Text => 'raw' (keeps original bytes, downloadable)
    if (docType === 'pdf' || docType === 'zip' || docType === 'text') return 'raw';
    return 'raw';
};

// =============================================
// ADMIN ROUTES
// =============================================

// -------------------- GET ALL DOCUMENTS --------------------
router.get('/admin/documents', requireAuth, checkAdmin, async (req, res) => {
    try {
        const { search, type, category, tab, status } = req.query;
        const filter = {};

        if (type) filter.type = type.toLowerCase();
        if (category) filter.category = category.toLowerCase();
        if (tab) filter.tab = tab.toLowerCase();
        if (status === 'ACTIVE') filter.isActive = true;
        if (status === 'INACTIVE') filter.isActive = false;

        if (search) {
            const regex = new RegExp(String(search).trim(), 'i');
            filter.$or = [{ title: regex }, { description: regex }, { fileName: regex }];
        }

        // ✅ CHANGED: createdAt: -1 → createdAt: 1
        // Oldest document first, newest last
        const documents = await Document.find(filter)
            .populate('uploadedBy', 'Name email')
            .sort({ createdAt: 1 });

        res.json({ count: documents.length, documents });
    } catch (error) {
        console.error('Get documents error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});



// -------------------- GET SINGLE DOCUMENT --------------------
router.get('/admin/documents/:id', requireAuth, checkAdmin, async (req, res) => {
    try {
        const document = await Document.findById(req.params.id).populate('uploadedBy', 'Name email');
        if (!document) return res.status(404).json({ error: 'Document not found' });
        res.json({ document });
    } catch (error) {
        console.error('Get document error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- CREATE DOCUMENT --------------------
router.post(
    '/admin/documents',
    requireAuth,
    checkAdmin,
    uploadDocument,
    handleMulterError,
    async (req, res) => {
        try {
            const { title, description, type, category, tab, isLocked, lockCode, fileUrl } = req.body;

            if (!title || !type || !category || !tab) {
                return res.status(400).json({ error: 'Title, type, category, and tab are required' });
            }

            const validTypes = ['pdf', 'text', 'link', 'zip'];
            if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid document type' });

            const validCategories = ['free', 'complete', 'projects'];
            if (!validCategories.includes(category)) return res.status(400).json({ error: 'Invalid category' });

            const validTabs = ['app', 'agent', 'prompt'];
            if (!validTabs.includes(tab)) return res.status(400).json({ error: 'Invalid tab' });

            const isLockedBool = isLocked === 'true' || isLocked === true;
            if (isLockedBool) {
                if (!lockCode || String(lockCode).length !== 5 || !/^\d{5}$/.test(String(lockCode))) {
                    return res.status(400).json({ error: 'Lock code must be exactly 5 digits' });
                }
            }

            if (type === 'link') {
                if (!fileUrl) return res.status(400).json({ error: 'Link URL is required for link type' });
                try { new URL(fileUrl); } catch { return res.status(400).json({ error: 'Invalid URL format' }); }
            }

            if (type !== 'link' && !req.file) {
                return res.status(400).json({ error: `File upload is required for ${type} type` });
            }

            const documentData = {
                title: title.trim(),
                description: description ? description.trim() : '',
                type,
                category,
                tab,
                isLocked: isLockedBool,
                uploadedBy: req.user._id,
                isActive: true,
            };

            if (isLockedBool) documentData.lockCode = String(lockCode);

            if (type === 'link') {
                documentData.fileUrl = fileUrl.trim();
                documentData.fileName = fileUrl.trim();
            } else if (req.file) {
                const resourceType = getResourceType(type);
                const result = await uploadBufferToCloudinary(req.file.buffer, {
                    folder: 'exam-app/documents',
                    resource_type: resourceType,
                    public_id: `${Date.now()}-${req.file.originalname.replace(/\.[^/.]+$/, '')}`,
                    use_filename: true,
                    unique_filename: true,
                });

                documentData.fileName = req.file.originalname;
                documentData.fileUrl = result.secure_url;
                documentData.filePublicId = result.public_id;
                documentData.fileResourceType = resourceType;
            }

            const document = new Document(documentData);
            await document.save();

            const populatedDoc = await Document.findById(document._id).populate('uploadedBy', 'Name email');

            res.status(201).json({ message: 'Document created successfully', document: populatedDoc });
        } catch (error) {
            console.error('Create document error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// -------------------- UPDATE DOCUMENT --------------------
router.put(
    '/admin/documents/:id',
    requireAuth,
    checkAdmin,
    uploadDocument,
    handleMulterError,
    async (req, res) => {
        try {
            const document = await Document.findById(req.params.id);
            if (!document) return res.status(404).json({ error: 'Document not found' });

            const { title, description, type, category, tab, isLocked, lockCode, fileUrl } = req.body;

            if (title) document.title = title.trim();
            if (description !== undefined) document.description = description.trim();

            if (type) {
                const validTypes = ['pdf', 'text', 'link', 'zip'];
                if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid document type' });
                document.type = type;
            }
            if (category) {
                const validCategories = ['free', 'complete', 'projects'];
                if (!validCategories.includes(category)) return res.status(400).json({ error: 'Invalid category' });
                document.category = category;
            }
            if (tab) {
                const validTabs = ['app', 'agent', 'prompt'];
                if (!validTabs.includes(tab)) return res.status(400).json({ error: 'Invalid tab' });
                document.tab = tab;
            }

            if (isLocked !== undefined) {
                const isLockedBool = isLocked === 'true' || isLocked === true;
                document.isLocked = isLockedBool;
                if (isLockedBool && lockCode) {
                    if (String(lockCode).length !== 5 || !/^\d{5}$/.test(String(lockCode))) {
                        return res.status(400).json({ error: 'Lock code must be exactly 5 digits' });
                    }
                    document.lockCode = String(lockCode);
                } else if (!isLockedBool) {
                    document.lockCode = undefined;
                }
            }

            // Update link URL
            if (document.type === 'link' && fileUrl) {
                try { new URL(fileUrl); } catch { return res.status(400).json({ error: 'Invalid URL format' }); }
                document.fileUrl = fileUrl.trim();
                document.fileName = fileUrl.trim();
            }

            // Replace file with new Cloudinary upload
            if (req.file) {
                // delete old from cloudinary
                if (document.filePublicId) {
                    await deleteFromCloudinary(document.filePublicId, document.fileResourceType || 'raw');
                }

                const resourceType = getResourceType(document.type);
                const result = await uploadBufferToCloudinary(req.file.buffer, {
                    folder: 'exam-app/documents',
                    resource_type: resourceType,
                    public_id: `${Date.now()}-${req.file.originalname.replace(/\.[^/.]+$/, '')}`,
                    use_filename: true,
                    unique_filename: true,
                });

                document.fileName = req.file.originalname;
                document.fileUrl = result.secure_url;
                document.filePublicId = result.public_id;
                document.fileResourceType = resourceType;
            }

            await document.save();

            const populatedDoc = await Document.findById(document._id).populate('uploadedBy', 'Name email');
            res.json({ message: 'Document updated successfully', document: populatedDoc });
        } catch (error) {
            console.error('Update document error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// -------------------- DELETE DOCUMENT --------------------
router.delete('/admin/documents/:id', requireAuth, checkAdmin, async (req, res) => {
    try {
        const document = await Document.findById(req.params.id);
        if (!document) return res.status(404).json({ error: 'Document not found' });

        if (document.filePublicId) {
            await deleteFromCloudinary(document.filePublicId, document.fileResourceType || 'raw');
        }

        await Document.findByIdAndDelete(document._id);
        res.json({ message: 'Document deleted successfully' });
    } catch (error) {
        console.error('Delete document error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- TOGGLE LOCK STATUS --------------------
router.put('/admin/documents/:id/lock', requireAuth, checkAdmin, async (req, res) => {
    try {
        const { isLocked, lockCode } = req.body;
        const document = await Document.findById(req.params.id);
        if (!document) return res.status(404).json({ error: 'Document not found' });

        if (isLocked === true || isLocked === 'true') {
            if (!lockCode || String(lockCode).length !== 5 || !/^\d{5}$/.test(String(lockCode))) {
                return res.status(400).json({ error: 'Lock code must be exactly 5 digits' });
            }
            document.isLocked = true;
            document.lockCode = String(lockCode);
        } else {
            document.isLocked = false;
            document.lockCode = undefined;
        }

        await document.save();
        res.json({
            message: document.isLocked ? 'Document locked successfully' : 'Document unlocked successfully',
            isLocked: document.isLocked,
        });
    } catch (error) {
        console.error('Toggle lock error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- UPDATE LOCK CODE --------------------
router.put('/admin/documents/:id/lock-code', requireAuth, checkAdmin, async (req, res) => {
    try {
        const { lockCode } = req.body;
        if (!lockCode || String(lockCode).length !== 5 || !/^\d{5}$/.test(String(lockCode))) {
            return res.status(400).json({ error: 'Lock code must be exactly 5 digits' });
        }

        const document = await Document.findById(req.params.id);
        if (!document) return res.status(404).json({ error: 'Document not found' });
        if (!document.isLocked) return res.status(400).json({ error: 'Document is not locked' });

        document.lockCode = String(lockCode);
        await document.save();
        res.json({ message: 'Lock code updated successfully' });
    } catch (error) {
        console.error('Update lock code error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- GET STATS --------------------
router.get('/admin/stats', requireAuth, checkAdmin, async (req, res) => {
    try {
        const [
            totalDocuments, lockedCount, freeCount, completeCount, projectsCount,
            pdfCount, textCount, linkCount, zipCount,
            appCount, agentCount, promptCount,
        ] = await Promise.all([
            Document.countDocuments(),
            Document.countDocuments({ isLocked: true }),
            Document.countDocuments({ category: 'free' }),
            Document.countDocuments({ category: 'complete' }),
            Document.countDocuments({ category: 'projects' }),
            Document.countDocuments({ type: 'pdf' }),
            Document.countDocuments({ type: 'text' }),
            Document.countDocuments({ type: 'link' }),
            Document.countDocuments({ type: 'zip' }),
            Document.countDocuments({ tab: 'app' }),
            Document.countDocuments({ tab: 'agent' }),
            Document.countDocuments({ tab: 'prompt' }),
        ]);

        res.json({
            stats: {
                totalDocuments, lockedCount, freeCount, completeCount, projectsCount,
                pdfCount, textCount, linkCount, zipCount,
                appCount, agentCount, promptCount, totalDownloads: 0,
            },
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// =============================================
// STUDENT ROUTES
// =============================================

// -------------------- GET AVAILABLE DOCUMENTS --------------------
router.get('/student/documents', requireAuth, async (req, res) => {
    try {
        const { type, category, tab } = req.query;
        const filter = { isActive: true };
        if (type) filter.type = type.toLowerCase();
        if (category) filter.category = category.toLowerCase();
        if (tab) filter.tab = tab.toLowerCase();

        const documents = await Document.find(filter)
            .select('_id title description type fileName fileUrl isLocked category tab createdAt')
            .sort({ createdAt: 1 }); // ✅ Oldest first (sobar age add howa document sobar age)

        res.json({ count: documents.length, documents });
    } catch (error) {
        console.error('Get student documents error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


// -------------------- GET SINGLE DOCUMENT --------------------
router.get('/student/documents/:id', requireAuth, async (req, res) => {
    try {
        const document = await Document.findOne({ _id: req.params.id, isActive: true })
            .select('_id title description type fileName fileUrl isLocked category tab createdAt');
        if (!document) return res.status(404).json({ error: 'Document not found' });
        res.json({ document });
    } catch (error) {
        console.error('Get student document error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- UNLOCK DOCUMENT --------------------
router.post('/student/documents/:id/unlock', requireAuth, async (req, res) => {
    try {
        const { lockCode } = req.body;
        if (!lockCode) return res.status(400).json({ error: 'Lock code is required' });

        const document = await Document.findOne({ _id: req.params.id, isActive: true });
        if (!document) return res.status(404).json({ error: 'Document not found' });
        if (!document.isLocked) return res.status(400).json({ error: 'Document is not locked' });
        if (String(lockCode) !== String(document.lockCode)) {
            return res.status(401).json({ error: 'Invalid lock code' });
        }

        const docData = document.toObject();
        delete docData.lockCode;
        res.json({ message: 'Document unlocked successfully', document: docData });
    } catch (error) {
        console.error('Unlock document error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- DOWNLOAD DOCUMENT (Cloudinary) --------------------
router.get('/student/documents/:id/download', requireAuth, async (req, res) => {
    try {
        const document = await Document.findOne({ _id: req.params.id, isActive: true });
        if (!document) return res.status(404).json({ error: 'Document not found' });

        // Lock check
        if (document.isLocked) {
            const { lockCode } = req.query;
            if (!lockCode || String(lockCode) !== String(document.lockCode)) {
                return res.status(401).json({ error: 'Invalid or missing lock code' });
            }
        }

        // For link type, return URL only
        if (document.type === 'link') {
            return res.json({ type: 'link', url: document.fileUrl, message: 'Redirect to link' });
        }

        if (!document.fileUrl) {
            return res.status(404).json({ error: 'File URL not found' });
        }

        // Cloudinary secure URLs are already downloadable.
        // Return the URL so the client can download directly (recommended for large files).
        res.json({
            type: 'file',
            url: document.fileUrl,
            fileName: document.fileName || 'download',
            message: 'Use the URL to download the file',
        });
    } catch (error) {
        console.error('Download document error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- GET DOCUMENTS BY TAB --------------------
// -------------------- GET DOCUMENTS BY TAB --------------------
router.get('/student/documents/tab/:tab', requireAuth, async (req, res) => {
    try {
        const { tab } = req.params;
        const { category } = req.query;

        const validTabs = ['app', 'agent', 'prompt'];
        if (!validTabs.includes(tab)) return res.status(400).json({ error: 'Invalid tab' });

        const filter = { tab, isActive: true };
        if (category) {
            const validCategories = ['free', 'complete', 'projects'];
            if (!validCategories.includes(category)) {
                return res.status(400).json({ error: 'Invalid category' });
            }
            filter.category = category;
        }

        const documents = await Document.find(filter)
            .select('_id title description type fileName fileUrl isLocked category tab createdAt')
            .sort({ createdAt: 1 }); // ✅ FIXED: -1 → 1 (Oldest first)

        res.json({ count: documents.length, documents });
    } catch (error) {
        console.error('Get documents by tab error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;