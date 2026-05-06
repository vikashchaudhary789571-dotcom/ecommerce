const express = require('express');
const router = express.Router();
const multer = require('multer');
const statementController = require('../controllers/statementController');

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

router.post('/upload', upload.single('file'), statementController.uploadStatement);
router.post('/regenerate', statementController.regeneratePdf);
router.post('/edit-direct', statementController.editDirect);
router.post('/save-file', statementController.saveStatement);
router.get('/download-file', statementController.downloadFile);
router.delete('/:id', statementController.deleteStatement);
router.get('/', statementController.getStatements);

module.exports = router;
