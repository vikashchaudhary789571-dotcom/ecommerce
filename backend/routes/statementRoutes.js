const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const statementController = require('../controllers/statementController');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('[Routes] Created uploads directory:', uploadsDir);
}

// Multer configuration for file uploads with absolute path
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        console.log('[Multer] Saving file to:', uploadsDir);
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const filename = Date.now() + '-' + file.originalname;
        console.log('[Multer] Generated filename:', filename);
        cb(null, filename);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    }
});

router.post('/upload', upload.single('file'), statementController.uploadStatement);
router.post('/regenerate', statementController.regeneratePdf);
router.post('/edit-direct', statementController.editDirect);
router.post('/save-file', statementController.saveStatement);
router.get('/download-file', statementController.downloadFile);
router.delete('/:id', statementController.deleteStatement);
router.get('/', statementController.getStatements);

module.exports = router;
