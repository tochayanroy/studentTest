// routes/DocumentRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const Document = require('../models/DocumentSchema.js');
const User = require('../models/UserSchema.js');
const passport = require('passport');
const checkAdmin = require('../middleware/checkAdmin.js');
const { uploadDocument, handleMulterError } = require('../middleware/multer.js');

const requireAuth = passport.authenticate('jwt', { session: false });

// =============================================
// HELPER FUNCTIONS
// =============================================

const deleteFile = (filePath) => {
    if (!filePath) return false;
    
    try {
        const filename = path.basename(filePath);
        const fullPath = path.join(__dirname, '../uploads/documents/', filename);
        
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error deleting document file:', error);
        return false;
    }
};

const getFileSize = (filePath) => {
    try {
        const fullPath = path.join(__dirname, '../uploads/documents/', filePath);
        const stats = fs.statSync(fullPath);
        return stats.size;
    } catch {
        return 0;
    }
};

const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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
            filter.$or = [
                { title: regex },
                { description: regex },
                { fileName: regex }
            ];
        }

        const documents = await Document.find(filter)
            .populate('uploadedBy', 'Name email')
            .sort({ createdAt: -1 });

        // Get download counts from a separate collection or compute
        // For now, we'll add a mock downloadCount or you can track in a separate collection

        res.json({
            count: documents.length,
            documents
        });
    } catch (error) {
        console.error('Get documents error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- GET SINGLE DOCUMENT --------------------
router.get('/admin/documents/:id', requireAuth, checkAdmin, async (req, res) => {
    try {
        const document = await Document.findById(req.params.id)
            .populate('uploadedBy', 'Name email');

        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        res.json({ document });
    } catch (error) {
        console.error('Get document error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- CREATE DOCUMENT --------------------
router.post('/admin/documents', requireAuth, checkAdmin, uploadDocument, handleMulterError, async (req, res) => {
    try {
        const { 
            title, 
            description, 
            type, 
            category, 
            tab, 
            isLocked, 
            lockCode,
            fileUrl 
        } = req.body;

        // Validation
        if (!title || !type || !category || !tab) {
            if (req.file) deleteFile(req.file.filename);
            return res.status(400).json({ error: 'Title, type, category, and tab are required' });
        }

        // Validate type
        const validTypes = ['pdf', 'text', 'link', 'zip'];
        if (!validTypes.includes(type)) {
            if (req.file) deleteFile(req.file.filename);
            return res.status(400).json({ error: 'Invalid document type' });
        }

        // Validate category
        const validCategories = ['free', 'complete', 'projects'];
        if (!validCategories.includes(category)) {
            if (req.file) deleteFile(req.file.filename);
            return res.status(400).json({ error: 'Invalid category' });
        }

        // Validate tab
        const validTabs = ['app', 'agent', 'prompt'];
        if (!validTabs.includes(tab)) {
            if (req.file) deleteFile(req.file.filename);
            return res.status(400).json({ error: 'Invalid tab' });
        }

        // Validate lock code
        const isLockedBool = isLocked === 'true' || isLocked === true;
        if (isLockedBool) {
            if (!lockCode || String(lockCode).length !== 5) {
                if (req.file) deleteFile(req.file.filename);
                return res.status(400).json({ error: 'Lock code must be exactly 5 digits' });
            }
            if (!/^\d{5}$/.test(String(lockCode))) {
                if (req.file) deleteFile(req.file.filename);
                return res.status(400).json({ error: 'Lock code must contain only digits' });
            }
        }

        // For link type, validate URL
        if (type === 'link') {
            if (!fileUrl) {
                if (req.file) deleteFile(req.file.filename);
                return res.status(400).json({ error: 'Link URL is required for link type' });
            }
            // Basic URL validation
            try {
                new URL(fileUrl);
            } catch {
                if (req.file) deleteFile(req.file.filename);
                return res.status(400).json({ error: 'Invalid URL format' });
            }
        }

        // For non-link types, validate file upload
        if (type !== 'link' && !req.file) {
            return res.status(400).json({ error: `File upload is required for ${type} type` });
        }

        // Build document data
        const documentData = {
            title: title.trim(),
            description: description ? description.trim() : '',
            type,
            category,
            tab,
            isLocked: isLockedBool,
            uploadedBy: req.user._id,
            isActive: true
        };

        if (isLockedBool) {
            documentData.lockCode = String(lockCode);
        }

        if (type === 'link') {
            documentData.fileUrl = fileUrl.trim();
            documentData.fileName = fileUrl.trim(); // Use URL as filename for display
        } else if (req.file) {
            documentData.fileName = req.file.filename;
            documentData.fileUrl = `/uploads/documents/${req.file.filename}`;
        }

        const document = new Document(documentData);
        await document.save();

        const populatedDoc = await Document.findById(document._id)
            .populate('uploadedBy', 'Name email');

        res.status(201).json({
            message: 'Document created successfully',
            document: populatedDoc
        });
    } catch (error) {
        if (req.file) deleteFile(req.file.filename);
        console.error('Create document error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- UPDATE DOCUMENT --------------------
router.put('/admin/documents/:id', requireAuth, checkAdmin, uploadDocument, handleMulterError, async (req, res) => {
    try {
        const document = await Document.findById(req.params.id);
        if (!document) {
            if (req.file) deleteFile(req.file.filename);
            return res.status(404).json({ error: 'Document not found' });
        }

        const { 
            title, 
            description, 
            type, 
            category, 
            tab, 
            isLocked, 
            lockCode,
            fileUrl 
        } = req.body;

        // Validation
        if (title) document.title = title.trim();
        if (description !== undefined) document.description = description.trim();

        if (type) {
            const validTypes = ['pdf', 'text', 'link', 'zip'];
            if (!validTypes.includes(type)) {
                if (req.file) deleteFile(req.file.filename);
                return res.status(400).json({ error: 'Invalid document type' });
            }
            document.type = type;
        }

        if (category) {
            const validCategories = ['free', 'complete', 'projects'];
            if (!validCategories.includes(category)) {
                if (req.file) deleteFile(req.file.filename);
                return res.status(400).json({ error: 'Invalid category' });
            }
            document.category = category;
        }

        if (tab) {
            const validTabs = ['app', 'agent', 'prompt'];
            if (!validTabs.includes(tab)) {
                if (req.file) deleteFile(req.file.filename);
                return res.status(400).json({ error: 'Invalid tab' });
            }
            document.tab = tab;
        }

        // Handle lock status
        const isLockedBool = isLocked === 'true' || isLocked === true;
        if (isLockedBool !== undefined) {
            document.isLocked = isLockedBool;
            if (isLockedBool) {
                if (lockCode) {
                    if (String(lockCode).length !== 5) {
                        if (req.file) deleteFile(req.file.filename);
                        return res.status(400).json({ error: 'Lock code must be exactly 5 digits' });
                    }
                    if (!/^\d{5}$/.test(String(lockCode))) {
                        if (req.file) deleteFile(req.file.filename);
                        return res.status(400).json({ error: 'Lock code must contain only digits' });
                    }
                    document.lockCode = String(lockCode);
                }
            } else {
                document.lockCode = undefined;
            }
        } else if (lockCode && document.isLocked) {
            if (String(lockCode).length !== 5) {
                if (req.file) deleteFile(req.file.filename);
                return res.status(400).json({ error: 'Lock code must be exactly 5 digits' });
            }
            if (!/^\d{5}$/.test(String(lockCode))) {
                if (req.file) deleteFile(req.file.filename);
                return res.status(400).json({ error: 'Lock code must contain only digits' });
            }
            document.lockCode = String(lockCode);
        }

        // Handle file/link update
        if (document.type === 'link' && fileUrl) {
            try {
                new URL(fileUrl);
                document.fileUrl = fileUrl.trim();
                document.fileName = fileUrl.trim();
            } catch {
                if (req.file) deleteFile(req.file.filename);
                return res.status(400).json({ error: 'Invalid URL format' });
            }
        }

        // Handle file upload
        if (req.file) {
            // Delete old file
            if (document.fileName) {
                deleteFile(document.fileName);
            }
            document.fileName = req.file.filename;
            document.fileUrl = `/uploads/documents/${req.file.filename}`;
        }

        await document.save();

        const populatedDoc = await Document.findById(document._id)
            .populate('uploadedBy', 'Name email');

        res.json({
            message: 'Document updated successfully',
            document: populatedDoc
        });
    } catch (error) {
        if (req.file) deleteFile(req.file.filename);
        console.error('Update document error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- DELETE DOCUMENT --------------------
router.delete('/admin/documents/:id', requireAuth, checkAdmin, async (req, res) => {
    try {
        const document = await Document.findById(req.params.id);
        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        // Delete file if exists
        if (document.fileName) {
            deleteFile(document.fileName);
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
        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        if (isLocked === true || isLocked === 'true') {
            if (!lockCode || String(lockCode).length !== 5) {
                return res.status(400).json({ error: 'Lock code must be exactly 5 digits' });
            }
            if (!/^\d{5}$/.test(String(lockCode))) {
                return res.status(400).json({ error: 'Lock code must contain only digits' });
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
            isLocked: document.isLocked
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

        if (!lockCode || String(lockCode).length !== 5) {
            return res.status(400).json({ error: 'Lock code must be exactly 5 digits' });
        }
        if (!/^\d{5}$/.test(String(lockCode))) {
            return res.status(400).json({ error: 'Lock code must contain only digits' });
        }

        const document = await Document.findById(req.params.id);
        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        if (!document.isLocked) {
            return res.status(400).json({ error: 'Document is not locked' });
        }

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
        const totalDocuments = await Document.countDocuments();
        const lockedCount = await Document.countDocuments({ isLocked: true });
        const freeCount = await Document.countDocuments({ category: 'free' });
        const completeCount = await Document.countDocuments({ category: 'complete' });
        const projectsCount = await Document.countDocuments({ category: 'projects' });

        // Get counts by type
        const pdfCount = await Document.countDocuments({ type: 'pdf' });
        const textCount = await Document.countDocuments({ type: 'text' });
        const linkCount = await Document.countDocuments({ type: 'link' });
        const zipCount = await Document.countDocuments({ type: 'zip' });

        // Get counts by tab
        const appCount = await Document.countDocuments({ tab: 'app' });
        const agentCount = await Document.countDocuments({ tab: 'agent' });
        const promptCount = await Document.countDocuments({ tab: 'prompt' });

        res.json({
            stats: {
                totalDocuments,
                lockedCount,
                freeCount,
                completeCount,
                projectsCount,
                pdfCount,
                textCount,
                linkCount,
                zipCount,
                appCount,
                agentCount,
                promptCount,
                totalDownloads: 0 // You can add download tracking later
            }
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// =============================================
// STUDENT ROUTES
// =============================================

// -------------------- GET AVAILABLE DOCUMENTS FOR STUDENT --------------------
router.get('/student/documents', requireAuth, async (req, res) => {
    try {
        const { type, category, tab } = req.query;

        const filter = { isActive: true };

        if (type) filter.type = type.toLowerCase();
        if (category) filter.category = category.toLowerCase();
        if (tab) filter.tab = tab.toLowerCase();

        // Students can only see non-locked documents or locked ones they have access to
        // For the list, we show all but mark locked ones as locked
        // The actual file will require unlocking

        const documents = await Document.find(filter)
            .select('_id title description type fileName fileUrl isLocked category tab createdAt')
            .sort({ createdAt: -1 });

        res.json({
            count: documents.length,
            documents
        });
    } catch (error) {
        console.error('Get student documents error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- GET SINGLE DOCUMENT FOR STUDENT --------------------
router.get('/student/documents/:id', requireAuth, async (req, res) => {
    try {
        const document = await Document.findOne({ _id: req.params.id, isActive: true })
            .select('_id title description type fileName fileUrl isLocked category tab createdAt');

        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        res.json({ document });
    } catch (error) {
        console.error('Get student document error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- UNLOCK AND GET DOCUMENT --------------------
router.post('/student/documents/:id/unlock', requireAuth, async (req, res) => {
    try {
        const { lockCode } = req.body;

        if (!lockCode) {
            return res.status(400).json({ error: 'Lock code is required' });
        }

        const document = await Document.findOne({ _id: req.params.id, isActive: true });
        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        if (!document.isLocked) {
            return res.status(400).json({ error: 'Document is not locked' });
        }

        if (String(lockCode) !== String(document.lockCode)) {
            return res.status(401).json({ error: 'Invalid lock code' });
        }

        // Return the document with access granted
        const docData = document.toObject();
        delete docData.lockCode; // Remove sensitive data

        res.json({
            message: 'Document unlocked successfully',
            document: docData
        });
    } catch (error) {
        console.error('Unlock document error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- DOWNLOAD DOCUMENT --------------------
router.get('/student/documents/:id/download', requireAuth, async (req, res) => {
    try {
        const document = await Document.findOne({ _id: req.params.id, isActive: true });
        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        // Check if document is locked
        if (document.isLocked) {
            // Require lock code for download
            const { lockCode } = req.query;
            if (!lockCode || String(lockCode) !== String(document.lockCode)) {
                return res.status(401).json({ error: 'Invalid or missing lock code' });
            }
        }

        // For link type, redirect to the URL
        if (document.type === 'link') {
            return res.json({ 
                type: 'link', 
                url: document.fileUrl,
                message: 'Redirect to link'
            });
        }

        // For file types, check if file exists
        if (!document.fileName) {
            return res.status(404).json({ error: 'File not found' });
        }

        const filePath = path.join(__dirname, '../uploads/documents/', document.fileName);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on server' });
        }

        // Log download (you can implement download tracking here)

        // Stream the file
        res.download(filePath, document.fileName || 'download', (err) => {
            if (err) {
                console.error('Download error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error downloading file' });
                }
            }
        });
    } catch (error) {
        console.error('Download document error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- GET DOCUMENTS BY CATEGORY/TAB --------------------
router.get('/student/documents/tab/:tab', requireAuth, async (req, res) => {
    try {
        const { tab } = req.params;
        const { category } = req.query;

        const validTabs = ['app', 'agent', 'prompt'];
        if (!validTabs.includes(tab)) {
            return res.status(400).json({ error: 'Invalid tab' });
        }

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
            .sort({ createdAt: -1 });

        res.json({
            count: documents.length,
            documents
        });
    } catch (error) {
        console.error('Get documents by tab error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// =============================================
// EXPORT
// =============================================

module.exports = router;