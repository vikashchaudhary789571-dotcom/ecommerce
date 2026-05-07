const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument, rgb, StandardFonts, PDFName, PDFArray, PDFHexString, PDFString, PDFRef } = require('pdf-lib');
const { PDFParse } = require('pdf-parse');
const hummus = require('hummus');

/**
 * Force PDF version in the raw PDF bytes
 * This is the ONLY reliable way to preserve exact PDF version
 */
function forcePdfVersion(pdfBytes, targetVersion) {
    try {
        // Convert to Buffer if needed
        const buffer = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
        
        // Find the PDF header position (should be at start)
        const headerStr = buffer.slice(0, 50).toString('latin1');
        const versionMatch = headerStr.match(/%PDF-(\d+\.\d+)/);
        
        if (!versionMatch) {
            console.warn('[forcePdfVersion] Could not find PDF version in header');
            return buffer;
        }
        
        const currentVersion = versionMatch[1];
        if (currentVersion === targetVersion) {
            console.log(`[forcePdfVersion] ✓ Version already correct: ${targetVersion}`);
            return buffer;
        }
        
        console.log(`[forcePdfVersion] 🔧 Forcing version: ${currentVersion} → ${targetVersion}`);
        
        // Create new header with target version
        const oldHeader = `%PDF-${currentVersion}`;
        const newHeader = `%PDF-${targetVersion}`;
        
        // Replace in buffer
        const headerIndex = buffer.indexOf(oldHeader);
        if (headerIndex !== -1) {
            const newBuffer = Buffer.from(buffer);
            Buffer.from(newHeader, 'latin1').copy(newBuffer, headerIndex);
            console.log(`[forcePdfVersion] ✓ Version forced to: ${targetVersion}`);
            return newBuffer;
        }
        
        console.warn('[forcePdfVersion] Could not replace version in header');
        return buffer;
    } catch (err) {
        console.error('[forcePdfVersion] Error:', err.message);
        return pdfBytes;
    }
}

/**
 * Decode a pdf-lib stream object's raw bytes.
 * Handles FlateDecode (zlib) compression which is used by most bank PDFs.
 */
function decodeStreamObj(streamObj) {
    if (!streamObj || !streamObj.contents) return null;
    const rawBuf = Buffer.from(streamObj.contents);
    try {
        const filterEntry = streamObj.dict ? streamObj.dict.get(PDFName.of('Filter')) : null;
        if (filterEntry && String(filterEntry).includes('FlateDecode')) {
            try { return zlib.inflateSync(rawBuf); } catch (_) {
                try { return zlib.inflateRawSync(rawBuf); } catch (__) {}
            }
        }
    } catch (_) {}
    return rawBuf;
}

/**
 * Extract PDF metadata including version, producer, creator
 */
function extractPdfMetadata(pdfDoc) {
    try {
        const metadata = {
            version: null,
            producer: null,
            creator: null,
            pdfVersion: null
        };

        // Get PDF version from catalog
        const catalog = pdfDoc.catalog;
        if (catalog && catalog.context) {
            const header = catalog.context.header;
            if (header) {
                metadata.pdfVersion = header.toString();
                // Extract version number (e.g., "1.4", "1.7")
                const versionMatch = header.toString().match(/PDF-(\d+\.\d+)/);
                if (versionMatch) metadata.version = versionMatch[1];
            }
        }

        // Get document info
        const info = pdfDoc.getInfoDict();
        if (info) {
            const producer = info.get(PDFName.of('Producer'));
            const creator = info.get(PDFName.of('Creator'));
            
            if (producer) {
                metadata.producer = producer.toString().replace(/[()]/g, '');
            }
            if (creator) {
                metadata.creator = creator.toString().replace(/[()]/g, '');
            }
        }

        console.log('[extractPdfMetadata] PDF Metadata:', metadata);
        return metadata;
    } catch (e) {
        console.warn('[extractPdfMetadata] Error:', e.message);
        return { version: null, producer: null, creator: null, pdfVersion: null };
    }
}

/**
 * Extract font information from a PDF page
 * Returns font names, types, and encoding used in the page
 */
function extractPageFonts(pdfDoc, page) {
    try {
        const fonts = {};
        const resources = page.node.get(PDFName.of('Resources'));
        if (!resources) return fonts;

        const fontDict = resources.get(PDFName.of('Font'));
        if (!fontDict) return fonts;

        const fontNames = fontDict.keys();
        fontNames.forEach(fontKey => {
            const fontRef = fontDict.get(fontKey);
            const fontObj = pdfDoc.context.lookup(fontRef);
            
            if (fontObj) {
                const baseFont = fontObj.get(PDFName.of('BaseFont'));
                const subtype = fontObj.get(PDFName.of('Subtype'));
                const encoding = fontObj.get(PDFName.of('Encoding'));
                
                fonts[fontKey.toString()] = {
                    baseFont: baseFont ? baseFont.toString().replace(/\//g, '') : 'Unknown',
                    subtype: subtype ? subtype.toString().replace(/\//g, '') : 'Unknown',
                    encoding: encoding ? encoding.toString().replace(/\//g, '') : 'Unknown'
                };
            }
        });

        console.log(`[extractPageFonts] Page fonts:`, fonts);
        return fonts;
    } catch (e) {
        console.warn('[extractPageFonts] Error:', e.message);
        return {};
    }
}

/**
 * Extract the dominant text fill color from a PDF page's content stream.
 * Parses rg (RGB), g (grayscale), k (CMYK), and sc/scn operators.
 */
function extractPageTextColor(pdfDoc, page) {
    try {
        const contents = page.node.get(PDFName.of('Contents'));
        if (!contents) return null;

        const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
        const context = pdfDoc.context;
        let streamData = '';

        for (const ref of refs) {
            const streamObj = context.lookup(ref);
            const decoded = decodeStreamObj(streamObj);
            if (decoded) streamData += decoded.toString('latin1');
        }

        if (!streamData) return null;

        const rgbCounts = {};
        const grayCounts = {};
        const addRgb = (r, g, b) => {
            if (r > 0.95 && g > 0.95 && b > 0.95) return; // skip white
            const k = `${r.toFixed(4)},${g.toFixed(4)},${b.toFixed(4)}`;
            rgbCounts[k] = (rgbCounts[k] || 0) + 1;
        };
        const addGray = (v) => {
            if (v > 0.95) return; // skip white
            const k = `${v.toFixed(4)},${v.toFixed(4)},${v.toFixed(4)}`;
            grayCounts[k] = (grayCounts[k] || 0) + 1;
        };

        // rg — RGB fill: "R G B rg"
        for (const m of streamData.matchAll(/(-?[0-9.]+)\s+(-?[0-9.]+)\s+(-?[0-9.]+)\s+rg(?=[^a-zA-Z]|$)/g))
            addRgb(+m[1], +m[2], +m[3]);

        // g — grayscale fill: "V g" — kept SEPARATE to avoid table-border noise polluting RGB text colors
        for (const m of streamData.matchAll(/(?<![a-zA-Z])([0-9.]+)\s+g(?=[^a-zA-Z0-9]|$)/g))
            addGray(+m[1]);

        // k — CMYK fill
        for (const m of streamData.matchAll(/(-?[0-9.]+)\s+(-?[0-9.]+)\s+(-?[0-9.]+)\s+(-?[0-9.]+)\s+k(?=[^a-zA-Z]|$)/g)) {
            const c = +m[1], cy = +m[2], y = +m[3], bk = +m[4];
            addRgb((1-c)*(1-bk), (1-cy)*(1-bk), (1-y)*(1-bk));
        }

        // Pick winner: prefer most-frequent RGB color (ignores grayscale table-border noise).
        // Fall back to grayscale only when no RGB colors exist.
        const counts = Object.keys(rgbCounts).length > 0 ? rgbCounts : grayCounts;
        let bestKey = null, bestCount = 0;
        for (const [k, n] of Object.entries(counts)) {
            if (n > bestCount) { bestCount = n; bestKey = k; }
        }

        if (bestKey) {
            const [r, g, b] = bestKey.split(',').map(Number);
            console.log(`[editDirect] Backend extracted color: rgb(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)}) [${bestCount} uses]`);
            return { r, g, b };
        }
    } catch (e) {
        console.warn('[editDirect] Backend color extraction error:', e.message);
    }
    return null;
}

exports.uploadStatement = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    try {
        const filePath = path.join(__dirname, '../uploads', req.file.filename);
        const dataBuffer = fs.readFileSync(filePath);
        const { password } = req.body;

        console.log(`[uploadStatement] New upload: ${req.file.originalname}, Password provided: ${!!password}`);

        // Pass password directly to the parser. 
        // We no longer try to decrypt/re-save with pdf-lib here because it fails on many AES-256 PDFs.
        // The parser (pdf-parse) handles decryption much better during text extraction.
        const parser = new PDFParse({ 
            data: dataBuffer,
            password: password 
        });

        let textResult;
        try {
            textResult = await parser.getText();
        } catch (parseErr) {
            console.error('[uploadStatement] PDF parsing failed:', parseErr.message);
            
            // If it's a password error, return 401
            if (parseErr.name === 'PasswordException' || parseErr.message.includes('password') || parseErr.message.includes('encrypted')) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Incorrect password or PDF is encrypted. Please check the password.' 
                });
            }

            return res.status(500).json({ 
                success: false, 
                message: 'Failed to extract text from PDF. It might be corrupted or unsupported.' 
            });
        }
        
        const text = textResult.text;

        // --- SEARCHING BALANCES ---
        // Heuristic: Match 'Opening/Closing Balance' followed by anything until we find a number
        const obMatch = text.match(/Opening Balance[^\d]*?([\d,]+\.\d{2})/i);
        const cbMatch = text.match(/Closing Balance[^\d]*?([\d,]+\.\d{2})/i);

        let openingBalance = obMatch ? parseFloat(obMatch[1].replace(/,/g, '')) : null;
        let closingBalance = cbMatch ? parseFloat(cbMatch[1].replace(/,/g, '')) : null;

        // --- EXTRACTING TABLE ---
        const tableResult = await parser.getTable();
        const transactions = [];

        if (tableResult.pages && tableResult.pages.length > 0) {
            tableResult.pages.forEach((page) => {
                page.tables.forEach((table) => {
                    table.forEach(row => {
                        // Pattern for date (covers dd/mm/yyyy, dd-mm-yyyy, dd MMM yyyy)
                        const firstCol = row[0] ? String(row[0]).trim() : '';
                        if (/^\d{1,2}[\/\-\s][a-zA-Z0-9]{2,3}[\/\-\s]\d{2,4}/.test(firstCol)) {
                            let transactionDate = row[0];
                            let valueDate = row[1] || '';
                            let description = row[2] || '';
                            let reference = row[3] || '';
                            let debit = 0;
                            let credit = 0;
                            let balance = 0;

                            if (row.length >= 7) {
                                debit = parseFloat(String(row[4] || '').replace(/,/g, '')) || 0;
                                credit = parseFloat(String(row[5] || '').replace(/,/g, '')) || 0;
                                balance = parseFloat(String(row[6] || '').replace(/,/g, '')) || 0;
                            } else if (row.length >= 5) {
                                debit = parseFloat(String(row[row.length - 3] || '').replace(/,/g, '')) || 0;
                                credit = parseFloat(String(row[row.length - 2] || '').replace(/,/g, '')) || 0;
                                balance = parseFloat(String(row[row.length - 1] || '').replace(/,/g, '')) || 0;
                            }

                            transactions.push({
                                id: Math.random().toString(36).substr(2, 9),
                                date: transactionDate,
                                valueDate,
                                description,
                                reference,
                                debit,
                                credit,
                                balance
                            });
                        }
                    });
                });
            });
        }

        if (openingBalance === null && transactions.length > 0) {
            const first = transactions[0];
            openingBalance = (parseFloat(first.balance) || 0) - (parseFloat(first.credit) || 0) + (parseFloat(first.debit) || 0);
        } else if (openingBalance === null) {
            openingBalance = 0;
        }

        if (closingBalance === null && transactions.length > 0) {
            const last = transactions[transactions.length - 1];
            closingBalance = parseFloat(last.balance) || 0;
        } else if (closingBalance === null) {
            closingBalance = 0;
        }

        await parser.destroy();

        res.status(200).json({
            success: true,
            message: 'File processed. Table extracted.',
            file: {
                filename: req.file.filename,
                originalName: req.file.originalname,
                fileUrl: `${process.env.API_BASE_URL || 'https://ecommerce-2sdf.onrender.com'}/uploads/${req.file.filename}`
            },
            transactions: transactions,
            openingBalance,
            closingBalance
        });

    } catch (err) {
        console.error('Extraction Error:', err);
        res.status(500).json({ success: false, message: 'Failed to extract data: ' + err.message });
    }
};

exports.saveTransactions = (req, res) => {
    const { transactions, filename } = req.body;
    console.log(`Saving ${transactions?.length} transactions for file ${filename}`);
    res.status(200).json({ success: true, message: 'Transactions saved successfully' });
};

exports.regeneratePdf = async (req, res) => {
    const { transactions, originalFile, password } = req.body;

    try {
        const urlParts = originalFile.split('/');
        const originalFilename = urlParts[urlParts.length - 1];
        const originalPath = path.join(__dirname, '../uploads', originalFilename);

        if (!fs.existsSync(originalPath)) throw new Error('Original file missing.');

        // ═══════════════════════════════════════════════════════════════════
        // CRITICAL: Extract original PDF version BEFORE loading
        // ═══════════════════════════════════════════════════════════════════
        const pdfBuffer = fs.readFileSync(originalPath);
        let originalPdfVersion = null;
        
        const pdfHeader = pdfBuffer.slice(0, 20).toString('latin1');
        const versionMatch = pdfHeader.match(/%PDF-(\d+\.\d+)/);
        if (versionMatch) {
            originalPdfVersion = versionMatch[1];
            console.log(`[regeneratePdf] 📋 Original PDF Version: ${originalPdfVersion}`);
        }

        // pdf-lib cannot decrypt AES-256 PDFs — always use ignoreEncryption
        const pdfDoc = await PDFDocument.load(pdfBuffer, { 
            ignoreEncryption: true,
            updateMetadata: false
        });
        
        // Extract and preserve metadata
        const originalMetadata = extractPdfMetadata(pdfDoc);
        
        // Strip encryption dictionary so the saved PDF is clean and can be re-loaded freely
        if (pdfDoc.context.trailerInfo.Encrypt) delete pdfDoc.context.trailerInfo.Encrypt;
        const pages = pdfDoc.getPages();
        const firstPage = pages[0];

        // ═══════════════════════════════════════════════════════════════════
        // CRITICAL: Detect and use original PDF's font
        // ═══════════════════════════════════════════════════════════════════
        const pageFonts = {};
        pages.forEach((page, idx) => {
            pageFonts[idx + 1] = extractPageFonts(pdfDoc, page);
        });
        
        let detectedFontName = null;
        for (const [pageIdx, fonts] of Object.entries(pageFonts)) {
            for (const [fontKey, fontInfo] of Object.entries(fonts)) {
                const baseFontLower = (fontInfo.baseFont || '').toLowerCase();
                if (baseFontLower.includes('arial')) {
                    detectedFontName = 'Arial';
                    break;
                } else if (baseFontLower.includes('helvetica')) {
                    detectedFontName = 'Helvetica';
                    break;
                } else if (baseFontLower.includes('times')) {
                    detectedFontName = 'Times-Roman';
                    break;
                } else if (baseFontLower.includes('courier')) {
                    detectedFontName = 'Courier';
                    break;
                }
            }
            if (detectedFontName) break;
        }
        
        let fontToEmbed = StandardFonts.Helvetica; // Default
        if (detectedFontName === 'Arial') {
            fontToEmbed = StandardFonts.Helvetica; // Arial equivalent
        } else if (detectedFontName === 'Times-Roman') {
            fontToEmbed = StandardFonts.TimesRoman;
        } else if (detectedFontName === 'Courier') {
            fontToEmbed = StandardFonts.Courier;
        }
        
        const font = await pdfDoc.embedFont(fontToEmbed);
        const boldFont = font; // Use same font to avoid adding Bold variant
        console.log(`[regeneratePdf] ✓ Using font: ${detectedFontName || 'Helvetica'} (StandardFont: ${fontToEmbed})`);
        console.log(`[regeneratePdf] ℹ pdf-lib will reuse font if already exists in PDF`);


        const formatCurrency = (val) => Number(val).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        // --- STEP 1: SUMMARY TOTALS ---
        const totals = transactions.reduce((acc, curr) => {
            acc.debit += Number(curr.debit) || 0;
            acc.credit += Number(curr.credit) || 0;
            return acc;
        }, { debit: 0, credit: 0 });

        const openingBalance = Number(transactions[0]?.balance) || 0;
        const closingBalance = Number(transactions[transactions.length - 1]?.balance) || 0;

        const summaryXEnd = 568;
        const summaryYBase = 715; 
        const summarySpacing = 16.5;

        const summaryValues = [
            formatCurrency(openingBalance),
            formatCurrency(totals.credit),
            formatCurrency(totals.debit),
            formatCurrency(closingBalance)
        ];

        summaryValues.forEach((text, i) => {
            const y = summaryYBase - (i * summarySpacing);
            const isBold = (i === 0 || i === 3);
            const currentFont = isBold ? boldFont : font;
            const textWidth = currentFont.widthOfTextAtSize(text, 8);

            firstPage.drawRectangle({
                x: 480,
                y: y - 2,
                width: 90,
                height: 10,
                color: rgb(1, 1, 1),
            });

            firstPage.drawText(text, {
                x: summaryXEnd - textWidth,
                y: y,
                size: 8,
                font: currentFont,
                color: rgb(0, 0, 0),
            });
        });

        // --- STEP 2: TABLE RE-RENDERING ---
        const tableYStart = 574;
        const rowHeight = 15.6;

        transactions.forEach((txn, i) => {
            const y = tableYStart - (i * rowHeight);

            firstPage.drawRectangle({ x: 420, y: y - 2, width: 55, height: 10, color: rgb(1, 1, 1) });
            firstPage.drawRectangle({ x: 478, y: y - 2, width: 55, height: 10, color: rgb(1, 1, 1) });
            firstPage.drawRectangle({ x: 535, y: y - 2, width: 55, height: 10, color: rgb(1, 1, 1) });

            const debitText = Number(txn.debit) > 0 ? formatCurrency(txn.debit) : '';
            const creditText = Number(txn.credit) > 0 ? formatCurrency(txn.credit) : '';
            const balanceText = formatCurrency(txn.balance);

            if (debitText) {
                const w = font.widthOfTextAtSize(debitText, 7);
                firstPage.drawText(debitText, { x: 472 - w, y, size: 7, font });
            }
            if (creditText) {
                const w = font.widthOfTextAtSize(creditText, 7);
                firstPage.drawText(creditText, { x: 530 - w, y, size: 7, font });
            }
            const bw = font.widthOfTextAtSize(balanceText, 7);
            firstPage.drawText(balanceText, { x: 588 - bw, y, size: 7, font });
        });

        const pdfBytes = await pdfDoc.save({
            useObjectStreams: false,
            addDefaultPage: false,
            updateFieldAppearances: false
        });
        
        const fileName = `regenerated_${Date.now()}_${originalFilename}`;
        const filePath = path.join(__dirname, '../downloads', fileName);

        // ═══════════════════════════════════════════════════════════════════
        // CRITICAL: Force PDF version before writing file
        // ═══════════════════════════════════════════════════════════════════
        let finalPdfBytes = pdfBytes;
        if (originalPdfVersion) {
            console.log(`[regeneratePdf] 🔧 Forcing version to: ${originalPdfVersion}`);
            finalPdfBytes = forcePdfVersion(pdfBytes, originalPdfVersion);
            
            // Verify
            const verifyHeader = finalPdfBytes.slice(0, 20).toString('latin1');
            const verifyMatch = verifyHeader.match(/%PDF-(\d+\.\d+)/);
            if (verifyMatch) {
                console.log(`[regeneratePdf] ✓ Final version verified: ${verifyMatch[1]}`);
            }
        }

        fs.writeFileSync(filePath, finalPdfBytes);
        console.log(`[regeneratePdf] ✓ PDF saved with version: ${originalPdfVersion || 'default'}`);

        res.status(200).json({
            success: true,
            fileUrl: `${process.env.API_BASE_URL || 'https://ecommerce-2sdf.onrender.com'}/downloads/${fileName}`,
            metadata: {
                version: originalPdfVersion,
                producer: originalMetadata.producer,
                creator: originalMetadata.creator,
                preserved: true
            }
        });
    } catch (err) {
        console.error('Regeneration Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.saveStatement = (req, res) => {
    res.status(200).json({ success: true, message: 'Statement saved' });
};

exports.getStatements = (req, res) => {
    res.status(200).json({ success: true, statements: [] });
};

exports.deleteStatement = (req, res) => {
    res.status(200).json({ success: true, message: 'Statement deleted' });
};

exports.downloadFile = (req, res) => {
    const { fileUrl } = req.query;
    try {
        const urlPath = new URL(fileUrl).pathname;
        const segments = urlPath.split('/');
        const fileName = segments[segments.length - 1];
        const isDownload = urlPath.includes('/downloads/');
        const baseDir = isDownload ? path.join(__dirname, '../downloads') : path.join(__dirname, '../uploads');
        const filePath = path.join(baseDir, fileName);

        if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
        res.download(filePath);
    } catch (err) {
        res.status(500).send('Error serving file');
    }
};

exports.editDirect = async (req, res) => {
    const { fileUrl, pdfData, changes, pageColors, password } = req.body;

    if (!fileUrl && !pdfData) {
        return res.status(400).json({ success: false, message: 'fileUrl or pdfData is required.' });
    }
    if (!Array.isArray(changes) || changes.length === 0) {
        return res.status(400).json({ success: false, message: 'No changes provided.' });
    }

    try {
        console.log(`[editDirect] ▶ Starting transformation with ${changes.length} changes. Password provided: ${!!password}`);
        
        let pdfBuffer;
        let originalFilename = 'statement.pdf';
        let originalPath = null; // Track original file path (null for base64)
        let originalFileSize = 0; // Track original file size
        
        // Option 1: PDF data sent as base64 (preferred for Render)
        if (pdfData) {
            console.log(`[editDirect] Using PDF data from request body (base64)`);
            try {
                // Remove data URL prefix if present
                const base64Data = pdfData.replace(/^data:application\/pdf;base64,/, '');
                pdfBuffer = Buffer.from(base64Data, 'base64');
                originalFileSize = pdfBuffer.length; // Store original size
                console.log(`[editDirect] ✓ PDF buffer created from base64 (${pdfBuffer.length} bytes)`);
            } catch (base64Err) {
                console.error(`[editDirect] ✗ Failed to decode base64:`, base64Err.message);
                return res.status(400).json({ success: false, message: 'Invalid PDF data' });
            }
        }
        // Option 2: File URL (fallback for local/existing files)
        else if (fileUrl) {
            console.log(`[editDirect] Using file URL: ${fileUrl}`);
            const urlPath = new URL(fileUrl).pathname;
            const segments = urlPath.split('/');
            originalFilename = segments[segments.length - 1];
            const isDownload = urlPath.includes('/downloads/');
            const baseDir = isDownload ? path.join(__dirname, '../downloads') : path.join(__dirname, '../uploads');
            originalPath = path.join(baseDir, originalFilename);

            console.log(`[editDirect] Original filename: ${originalFilename}`);
            console.log(`[editDirect] Is download: ${isDownload}`);
            console.log(`[editDirect] Base dir: ${baseDir}`);
            console.log(`[editDirect] Full path: ${originalPath}`);

            if (!fs.existsSync(originalPath)) {
                console.error(`[editDirect] ✗ File not found at: ${originalPath}`);
                
                // List files in uploads directory for debugging
                try {
                    const uploadsDir = path.join(__dirname, '../uploads');
                    const downloadDir = path.join(__dirname, '../downloads');
                    
                    console.log(`[editDirect] Checking uploads directory: ${uploadsDir}`);
                    if (fs.existsSync(uploadsDir)) {
                        const uploadFiles = fs.readdirSync(uploadsDir);
                        console.log(`[editDirect] Files in uploads (${uploadFiles.length}):`, uploadFiles.slice(0, 5));
                    } else {
                        console.log(`[editDirect] Uploads directory does not exist!`);
                    }
                    
                    console.log(`[editDirect] Checking downloads directory: ${downloadDir}`);
                    if (fs.existsSync(downloadDir)) {
                        const downloadFiles = fs.readdirSync(downloadDir);
                        console.log(`[editDirect] Files in downloads (${downloadFiles.length}):`, downloadFiles.slice(0, 5));
                    } else {
                        console.log(`[editDirect] Downloads directory does not exist!`);
                    }
                } catch (listErr) {
                    console.error(`[editDirect] Error listing directories:`, listErr.message);
                }
                
                return res.status(404).json({ success: false, message: 'File not found. Please re-upload the PDF.' });
            }

            console.log(`[editDirect] ✓ File exists at: ${originalPath}`);
            originalFileSize = fs.statSync(originalPath).size;
            console.log(`[editDirect] File size: ${originalFileSize} bytes`);
            
            pdfBuffer = fs.readFileSync(originalPath);
        }
        
        // pdf-lib cannot decrypt AES-256 PDFs — always use ignoreEncryption
        let pdfDoc;
        let originalPdfVersion = null;
        try {
            // ═══════════════════════════════════════════════════════════════════
            // CRITICAL: Extract PDF version from raw file BEFORE loading with pdf-lib
            // This ensures we get the EXACT original version (1.4, 1.5, 1.7, etc.)
            // ═══════════════════════════════════════════════════════════════════
            const pdfHeader = pdfBuffer.slice(0, 20).toString('latin1');
            const versionMatch = pdfHeader.match(/%PDF-(\d+\.\d+)/);
            if (versionMatch) {
                originalPdfVersion = versionMatch[1];
                console.log(`[editDirect] 📋 EXACT Original PDF Version from file: ${originalPdfVersion}`);
            }
            
            pdfDoc = await PDFDocument.load(pdfBuffer, { 
                ignoreEncryption: true,
                updateMetadata: false
            });
            console.log(`[editDirect] ✓ PDF loaded successfully (${pdfDoc.getPageCount()} pages)`);
        } catch (loadErr) {
            console.error(`[editDirect] ✗ Failed to load PDF:`, loadErr.message);
            throw new Error(`PDF loading failed: ${loadErr.message}`);
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // CRITICAL: Extract and preserve original PDF metadata and fonts
        // ═══════════════════════════════════════════════════════════════════
        const originalMetadata = extractPdfMetadata(pdfDoc);
        console.log(`[editDirect] 📋 Original PDF Version: ${originalMetadata.version || 'Unknown'}`);
        console.log(`[editDirect] 📋 Original Producer: ${originalMetadata.producer || 'Unknown'}`);
        console.log(`[editDirect] 📋 Original Creator: ${originalMetadata.creator || 'Unknown'}`);
        
        // Strip encryption dictionary so the saved PDF is clean and can be re-loaded freely
        if (pdfDoc.context.trailerInfo.Encrypt) {
            delete pdfDoc.context.trailerInfo.Encrypt;
            console.log(`[editDirect] ✓ Stripped encryption from PDF`);
        }
        
        const pages = pdfDoc.getPages();
        
        // Extract font information from all pages
        const pageFonts = {};
        pages.forEach((page, idx) => {
            pageFonts[idx + 1] = extractPageFonts(pdfDoc, page);
        });
        console.log(`[editDirect] 📝 Extracted fonts from ${Object.keys(pageFonts).length} pages`);
        
        // ═══════════════════════════════════════════════════════════════════
        // CRITICAL: Use existing fonts with pdf-lib standard methods
        // This is more reliable than raw PDF operations
        // ═══════════════════════════════════════════════════════════════════
        let font, boldFont;
        let detectedFontName = null;
        
        try {
            // Detect which font is already in the PDF
            for (const [pageIdx, fonts] of Object.entries(pageFonts)) {
                for (const [fontKey, fontInfo] of Object.entries(fonts)) {
                    const baseFontLower = (fontInfo.baseFont || '').toLowerCase();
                    
                    // Check for common fonts
                    if (baseFontLower.includes('arial') || baseFontLower.includes('helvetica')) {
                        detectedFontName = 'Helvetica';
                        break;
                    } else if (baseFontLower.includes('times')) {
                        detectedFontName = 'Times-Roman';
                        break;
                    } else if (baseFontLower.includes('courier')) {
                        detectedFontName = 'Courier';
                        break;
                    }
                }
                if (detectedFontName) break;
            }
            
            console.log(`[editDirect] ✓ Detected original font: ${detectedFontName || 'None'}`);
            
            // Use standard PDF fonts (these don't add extra font data)
            let fontToEmbed, boldFontToEmbed;
            
            if (detectedFontName === 'Helvetica') {
                fontToEmbed = StandardFonts.Helvetica;
                boldFontToEmbed = StandardFonts.HelveticaBold;
            } else if (detectedFontName === 'Times-Roman') {
                fontToEmbed = StandardFonts.TimesRoman;
                boldFontToEmbed = StandardFonts.TimesRomanBold;
            } else if (detectedFontName === 'Courier') {
                fontToEmbed = StandardFonts.Courier;
                boldFontToEmbed = StandardFonts.CourierBold;
            } else {
                // Default to Helvetica if no font detected
                fontToEmbed = StandardFonts.Helvetica;
                boldFontToEmbed = StandardFonts.HelveticaBold;
            }
            
            font = await pdfDoc.embedFont(fontToEmbed);
            boldFont = await pdfDoc.embedFont(boldFontToEmbed);
            console.log(`[editDirect] ✓ Using standard fonts: ${fontToEmbed} / ${boldFontToEmbed}`);
            
        } catch (fontErr) {
            console.error(`[editDirect] ✗ Font handling failed:`, fontErr.message);
            throw new Error(`Font handling failed: ${fontErr.message}`);
        }

        const pageTextColors = {};
        if (pageColors && typeof pageColors === 'object') {
            for (const [pageIdx, color] of Object.entries(pageColors)) {
                if (color) pageTextColors[pageIdx] = rgb(color.r, color.g, color.b);
            }
        }

        pages.forEach((page, idx) => {
            const key = String(idx + 1);
            if (!pageTextColors[key]) {
                const c = extractPageTextColor(pdfDoc, page);
                if (c) pageTextColors[key] = rgb(c.r, c.g, c.b);
            }
        });

        console.log(`[editDirect] ✓ Extracted text colors for ${Object.keys(pageTextColors).length} pages`);

        let appliedChanges = 0;
        changes.forEach((change, idx) => {
            const page = pages[change.pageIndex - 1];
            if (!page) {
                console.warn(`[editDirect] ⚠ Page ${change.pageIndex} not found (out of ${pages.length} pages)`);
                return;
            }

            try {
                const fontSize = Math.max(change.fontSize || 8, 5);
                const textStr = String(change.newText);
                const currentFont = change.isBold ? boldFont : font;
                const textWidth = currentFont.widthOfTextAtSize(textStr, fontSize);

                // Use exact position from frontend
                let drawX = change.x;
                
                if (change.isSummaryItem && change.minDrawX != null && drawX < change.minDrawX) {
                    drawX = change.minDrawX;
                }

                const textColor = pageTextColors[change.pageIndex] || rgb(0, 0, 0);
                
                // Calculate rectangle to cover the text area
                const rectPadding = 1;
                const finalRectX = drawX - rectPadding;
                const rectY = change.y - rectPadding;
                const finalRectWidth = textWidth + (rectPadding * 2);
                const rectHeight = fontSize + (rectPadding * 2);
                
                console.log(`[editDirect] 📦 Rectangle: x=${finalRectX.toFixed(2)}, y=${rectY.toFixed(2)}, w=${finalRectWidth.toFixed(2)}, h=${rectHeight.toFixed(2)}`);
                console.log(`[editDirect] 📝 Text: "${textStr}" at x=${drawX.toFixed(2)}, y=${change.y}, size=${fontSize.toFixed(2)}`);
                
                // Step 1: Draw white rectangle to mask old text
                page.drawRectangle({
                    x: finalRectX,
                    y: rectY,
                    width: finalRectWidth,
                    height: rectHeight,
                    color: rgb(1, 1, 1), // White
                    opacity: 1.0,
                    borderWidth: 0,
                });
                
                // Step 2: Draw new text
                page.drawText(textStr, {
                    x: drawX,
                    y: change.y,
                    size: fontSize,
                    font: currentFont,
                    color: textColor,
                    opacity: 1.0,
                });
                
                console.log(`[editDirect] ✅ Text drawn successfully using standard pdf-lib methods`);

                appliedChanges++;
            } catch (changeErr) {
                console.warn(`[editDirect] ⚠ Failed to apply change ${idx}:`, changeErr.message);
            }
        });

        console.log(`[editDirect] ✓ Applied ${appliedChanges} out of ${changes.length} changes`);

        // ═══════════════════════════════════════════════════════════════════
        // CRITICAL: Save PDF with minimal changes to preserve fonts
        // ═══════════════════════════════════════════════════════════════════
        let pdfBytes;
        try {
            // Save with pdf-lib using options that minimize font changes
            pdfBytes = await pdfDoc.save({ 
                useObjectStreams: false,        // Don't use object streams (better compatibility)
                addDefaultPage: false,          // Don't add extra pages
                updateFieldAppearances: false,  // Don't update form fields
            });
            
            console.log(`[editDirect] ✓ PDF saved (${pdfBytes.length} bytes)`);
            console.log(`[editDirect] 📊 Original size: ${originalFileSize} bytes`);
            console.log(`[editDirect] 📊 New size: ${pdfBytes.length} bytes`);
            
            const sizeIncrease = pdfBytes.length - originalFileSize;
            const percentIncrease = originalFileSize > 0 ? ((sizeIncrease / originalFileSize) * 100).toFixed(2) : '0.00';
            console.log(`[editDirect] 📊 Size change: ${sizeIncrease > 0 ? '+' : ''}${(sizeIncrease / 1024).toFixed(2)} KB (${percentIncrease}%)`);
            
        } catch (saveErr) {
            console.error(`[editDirect] ✗ PDF save failed:`, saveErr.message);
            throw new Error(`PDF save failed: ${saveErr.message}`);
        }

        const fileName = `transformed_${Date.now()}_${originalFilename}`;
        const filePath = path.join(__dirname, '../downloads', fileName);
        
        const downloadsDir = path.join(__dirname, '../downloads');
        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
            console.log(`[editDirect] ✓ Created downloads directory`);
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // CRITICAL: Force PDF version BEFORE writing to file
        // This is the ONLY way to guarantee version preservation
        // ═══════════════════════════════════════════════════════════════════
        let finalPdfBytes = pdfBytes;
        if (originalPdfVersion) {
            console.log(`[editDirect] 🔧 Applying final version fix: ${originalPdfVersion}`);
            finalPdfBytes = forcePdfVersion(pdfBytes, originalPdfVersion);
            
            // Verify the fix worked
            const verifyHeader = finalPdfBytes.slice(0, 20).toString('latin1');
            const verifyMatch = verifyHeader.match(/%PDF-(\d+\.\d+)/);
            if (verifyMatch) {
                console.log(`[editDirect] ✓ Final PDF version verified: ${verifyMatch[1]}`);
                if (verifyMatch[1] !== originalPdfVersion) {
                    console.error(`[editDirect] ❌ VERSION MISMATCH: Expected ${originalPdfVersion}, got ${verifyMatch[1]}`);
                }
            }
        }
        
        try {
            fs.writeFileSync(filePath, finalPdfBytes);
            console.log(`[editDirect] ✓ File written to: ${filePath}`);
            console.log(`[editDirect] ✓ File size: ${fs.statSync(filePath).size} bytes`);
        } catch (writeErr) {
            console.error(`[editDirect] ✗ File write failed:`, writeErr.message);
            throw new Error(`File write failed: ${writeErr.message}`);
        }

        const responseUrl = `${process.env.API_BASE_URL || 'https://ecommerce-2sdf.onrender.com'}/downloads/${fileName}`;
        console.log(`[editDirect] ✓ Transform complete! URL: ${responseUrl}`);

        res.status(200).json({
            success: true,
            message: 'Text edits applied successfully.',
            fileUrl: responseUrl,
            stats: {
                changesApplied: appliedChanges,
                totalChanges: changes.length,
                fileSize: pdfBytes.length,
                originalFileSize: originalFileSize,
                fileSizeKB: (pdfBytes.length / 1024).toFixed(2),
                originalFileSizeKB: (originalFileSize / 1024).toFixed(2),
                sizeIncreasePercent: originalFileSize > 0 ? (((pdfBytes.length - originalFileSize) / originalFileSize) * 100).toFixed(2) : '0.00'
            },
            metadata: {
                version: originalPdfVersion || originalMetadata.version,
                producer: originalMetadata.producer,
                creator: originalMetadata.creator,
                preserved: true,
                versionSource: originalPdfVersion ? 'file_header' : 'metadata'
            }
        });
    } catch (err) {
        console.error('[editDirect] ✗ TRANSFORMATION ERROR:', err.message);
        console.error('[editDirect] Stack:', err.stack);
        
        let userMessage = err.message;
        if (err.message.includes('encrypted') || err.message.includes('password')) {
            userMessage = `PDF encryption error: ${err.message}. Try re-uploading with the correct password.`;
        }
        
        res.status(500).json({ success: false, message: userMessage });
    }
};
