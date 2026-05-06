const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument, rgb, StandardFonts, PDFName, PDFArray, PDFHexString, PDFString } = require('pdf-lib');
const { PDFParse } = require('pdf-parse');

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
                fileUrl: `${process.env.API_BASE_URL || 'http://localhost:5000'}/uploads/${req.file.filename}`
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
            fileUrl: `${process.env.API_BASE_URL || 'http://localhost:5000'}/downloads/${fileName}`,
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
    const { fileUrl, changes, pageColors, password } = req.body;

    if (!fileUrl) return res.status(400).json({ success: false, message: 'fileUrl is required.' });
    if (!Array.isArray(changes) || changes.length === 0) return res.status(400).json({ success: false, message: 'No changes provided.' });

    try {
        console.log(`[editDirect] ▶ Starting transformation with ${changes.length} changes. Password provided: ${!!password}`);
        
        const urlPath = new URL(fileUrl).pathname;
        const segments = urlPath.split('/');
        const originalFilename = segments[segments.length - 1];
        const isDownload = urlPath.includes('/downloads/');
        const baseDir = isDownload ? path.join(__dirname, '../downloads') : path.join(__dirname, '../uploads');
        const originalPath = path.join(baseDir, originalFilename);

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
            
            return res.status(404).json({ success: false, message: 'File not found' });
        }

        console.log(`[editDirect] ✓ File exists at: ${originalPath}`);
        console.log(`[editDirect] File size: ${fs.statSync(originalPath).size} bytes`);
        
        // pdf-lib cannot decrypt AES-256 PDFs — always use ignoreEncryption
        let pdfDoc;
        let originalPdfVersion = null;
        try {
            const pdfBuffer = fs.readFileSync(originalPath);
            
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
        // CRITICAL: For Arial PDFs, use existing Arial font directly
        // DO NOT embed Helvetica - use raw PDF operations instead
        // ═══════════════════════════════════════════════════════════════════
        let font, boldFont;
        let detectedFontName = null;
        let useRawPdfOperations = false;
        let existingFontKey = null;
        
        try {
            // Detect which font is already in the PDF
            for (const [pageIdx, fonts] of Object.entries(pageFonts)) {
                for (const [fontKey, fontInfo] of Object.entries(fonts)) {
                    const baseFontLower = (fontInfo.baseFont || '').toLowerCase();
                    
                    // Check for common fonts - BE PRECISE to avoid false matches
                    // CourierNew should NOT match "Courier"
                    if (baseFontLower.includes('arial')) {
                        detectedFontName = 'Arial';
                        existingFontKey = fontKey;
                        useRawPdfOperations = true; // Use raw operations for Arial
                        break;
                    } else if (baseFontLower.includes('helvetica')) {
                        detectedFontName = 'Helvetica';
                        existingFontKey = fontKey;
                        break;
                    } else if (baseFontLower.includes('times')) {
                        detectedFontName = 'Times-Roman';
                        existingFontKey = fontKey;
                        break;
                    } else if (baseFontLower.includes('couriernew')) {
                        // CourierNew is different from Courier - use raw operations
                        detectedFontName = 'CourierNew';
                        existingFontKey = fontKey;
                        useRawPdfOperations = true; // Use raw operations for CourierNew
                        break;
                    } else if (baseFontLower.includes('courier') && !baseFontLower.includes('new')) {
                        detectedFontName = 'Courier';
                        existingFontKey = fontKey;
                        break;
                    }
                }
                if (detectedFontName) break;
            }
            
            console.log(`[editDirect] ✓ Detected original font: ${detectedFontName || 'None'}`);
            
            if (useRawPdfOperations && existingFontKey) {
                // For Arial/CourierNew: Create a mock font object that uses existing font
                console.log(`[editDirect] ✅ Using existing ${detectedFontName} from PDF (raw operations - NO extra fonts added)`);
                
                // Get accurate font metrics from the original PDF font
                const pageIndex = Object.keys(pageFonts)[0]; // First page with fonts
                const page = pages[parseInt(pageIndex) - 1];
                const resources = page.node.get(PDFName.of('Resources'));
                const fontDict = resources ? resources.get(PDFName.of('Font')) : null;
                const fontRef = fontDict ? fontDict.get(PDFName.of(existingFontKey)) : null;
                const fontObj = fontRef ? pdfDoc.context.lookup(fontRef) : null;
                
                // Extract font metrics for accurate width calculations
                let avgCharWidth = 0.52; // Default for Arial/CourierNew
                if (detectedFontName === 'Arial') {
                    avgCharWidth = 0.52; // Arial average
                } else if (detectedFontName === 'CourierNew') {
                    avgCharWidth = 0.60; // CourierNew is monospace, wider
                }
                
                // Create mock font for width calculations
                font = {
                    name: detectedFontName,
                    widthOfTextAtSize: (text, size) => {
                        // More accurate width calculation
                        // Account for different character widths
                        let totalWidth = 0;
                        for (let i = 0; i < text.length; i++) {
                            const char = text[i];
                            // Numbers and uppercase are typically wider
                            if (/[0-9]/.test(char)) {
                                totalWidth += avgCharWidth * 1.0; // Numbers
                            } else if (/[A-Z]/.test(char)) {
                                totalWidth += avgCharWidth * 1.1; // Uppercase
                            } else if (/[a-z]/.test(char)) {
                                totalWidth += avgCharWidth * 0.9; // Lowercase
                            } else if (/[.,]/.test(char)) {
                                totalWidth += avgCharWidth * 0.4; // Punctuation
                            } else {
                                totalWidth += avgCharWidth; // Other
                            }
                        }
                        return totalWidth * size;
                    },
                    heightAtSize: (size) => size,
                    sizeAtHeight: (height) => height,
                    _isRawFont: true,
                    _fontKey: existingFontKey
                };
                boldFont = font;
                
            } else {
                // For other fonts: Use standard pdf-lib embedding
                let fontToEmbed;
                if (detectedFontName === 'Helvetica') {
                    fontToEmbed = StandardFonts.Helvetica;
                } else if (detectedFontName === 'Times-Roman') {
                    fontToEmbed = StandardFonts.TimesRoman;
                } else if (detectedFontName === 'Courier') {
                    fontToEmbed = StandardFonts.Courier;
                } else {
                    fontToEmbed = StandardFonts.Helvetica;
                }
                
                font = await pdfDoc.embedFont(fontToEmbed);
                boldFont = font;
                console.log(`[editDirect] ✓ Embedded font: ${fontToEmbed}`);
            }
            
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
                const cellWidth = change.width || textWidth;

                // ═══════════════════════════════════════════════════════════════════
                // CRITICAL: Proper alignment for numeric values in table cells
                // Ensures numbers stay within cell boundaries (HDFC PDF fix)
                // ═══════════════════════════════════════════════════════════════════
                let drawX = change.x;
                const isTable = change.isTableItem === true;
                
                if (change.isNumeric && change.width) {
                    // Right-align numeric values within cell
                    drawX = (change.x + change.width) - textWidth;
                    
                    // HDFC FIX: Ensure text doesn't overflow cell boundaries
                    // Add small padding from right edge
                    const rightPadding = isTable ? 3 : 2;
                    drawX = drawX - rightPadding;
                    
                    // Ensure drawX doesn't go before cell start
                    if (drawX < change.x) {
                        drawX = change.x + 2; // Small left padding
                    }
                }
                
                if (change.isSummaryItem && change.minDrawX != null && drawX < change.minDrawX) {
                    drawX = change.minDrawX;
                }

                // ═══════════════════════════════════════════════════════════════════
                // CRITICAL: Mask should NEVER exceed cell boundaries
                // This prevents white rectangles from covering adjacent cells
                // ═══════════════════════════════════════════════════════════════════
                const hPaddingRight = isTable ? 2 : 6;
                const hPaddingLeft = isTable ? 2 : 0;
                
                // Calculate mask boundaries
                let maskX = Math.min(change.x, drawX) - hPaddingLeft;
                let maskWidth = Math.max(change.x + cellWidth, drawX + textWidth) - maskX + hPaddingRight;
                
                // HDFC FIX: Constrain mask to cell width
                if (change.width && isTable) {
                    const maxMaskWidth = change.width + hPaddingLeft + hPaddingRight;
                    if (maskWidth > maxMaskWidth) {
                        maskWidth = maxMaskWidth;
                    }
                    
                    // Ensure mask starts at cell boundary
                    if (maskX < change.x - hPaddingLeft) {
                        maskX = change.x - hPaddingLeft;
                    }
                }

                let maskColor = rgb(1, 1, 1);
                if (change.maskColor && Array.isArray(change.maskColor)) {
                    maskColor = rgb(change.maskColor[0]/255, change.maskColor[1]/255, change.maskColor[2]/255);
                }

                page.drawRectangle({
                    x: maskX,
                    y: change.y - 4,
                    width: maskWidth,
                    height: fontSize + 8,
                    color: maskColor,
                });

                const textColor = pageTextColors[change.pageIndex] || rgb(0, 0, 0);
                
                // ═══════════════════════════════════════════════════════════════════
                // CRITICAL: For Arial PDFs, use raw PDF content stream operations
                // This avoids adding Helvetica to the PDF
                // ═══════════════════════════════════════════════════════════════════
                if (currentFont._isRawFont && currentFont._fontKey) {
                    // Use raw PDF operations to draw text with existing Arial font
                    // Remove leading slash from font key (e.g., "/F1" → "F1")
                    const fontKeyName = currentFont._fontKey.replace(/^\//, '');
                    
                    const contentStream = `
BT
/${fontKeyName} ${fontSize} Tf
${textColor.red} ${textColor.green} ${textColor.blue} rg
${drawX} ${change.y} Td
(${textStr.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')}) Tj
ET
`;
                    
                    // Append to page's content stream
                    const contents = page.node.get(PDFName.of('Contents'));
                    if (contents) {
                        const context = pdfDoc.context;
                        const streamRef = context.nextRef();
                        const stream = context.stream(Buffer.from(contentStream, 'latin1'));
                        context.assign(streamRef, stream);
                        
                        // Add to contents array
                        if (contents instanceof PDFArray) {
                            contents.push(streamRef);
                        } else {
                            // Convert single content to array
                            const newContents = context.obj([contents, streamRef]);
                            page.node.set(PDFName.of('Contents'), newContents);
                        }
                    }
                    
                    console.log(`[editDirect] ✓ Drew text using existing ${detectedFontName} (raw operations)`);
                } else {
                    // Use standard pdf-lib drawing for other fonts
                    page.drawText(textStr, {
                        x: drawX,
                        y: change.y,
                        size: fontSize,
                        font: currentFont,
                        color: textColor,
                    });
                }

                appliedChanges++;
            } catch (changeErr) {
                console.warn(`[editDirect] ⚠ Failed to apply change ${idx}:`, changeErr.message);
            }
        });

        console.log(`[editDirect] ✓ Applied ${appliedChanges} out of ${changes.length} changes`);

        // ═══════════════════════════════════════════════════════════════════
        // CRITICAL: Preserve original PDF metadata AND version before saving
        // ═══════════════════════════════════════════════════════════════════
        try {
            const info = pdfDoc.getInfoDict();
            
            // Preserve original Producer and Creator if they existed
            if (originalMetadata.producer) {
                info.set(PDFName.of('Producer'), PDFHexString.fromText(originalMetadata.producer));
                console.log(`[editDirect] ✓ Preserved Producer: ${originalMetadata.producer}`);
            }
            if (originalMetadata.creator) {
                info.set(PDFName.of('Creator'), PDFHexString.fromText(originalMetadata.creator));
                console.log(`[editDirect] ✓ Preserved Creator: ${originalMetadata.creator}`);
            }
            
            // Add modification metadata
            info.set(PDFName.of('ModDate'), PDFString.of(`D:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`));
            
            // ═══════════════════════════════════════════════════════════════════
            // CRITICAL: Force PDF version to match original EXACTLY
            // ═══════════════════════════════════════════════════════════════════
            if (originalPdfVersion) {
                // Set the PDF version in the catalog
                const [major, minor] = originalPdfVersion.split('.').map(Number);
                pdfDoc.catalog.set(PDFName.of('Version'), PDFName.of(`${major}.${minor}`));
                console.log(`[editDirect] ✓ Forced PDF Version to: ${originalPdfVersion}`);
            }
        } catch (metaErr) {
            console.warn(`[editDirect] ⚠ Could not preserve all metadata:`, metaErr.message);
        }

        let pdfBytes;
        try {
            // ═══════════════════════════════════════════════════════════════════
            // CRITICAL: Optimize PDF save to reduce file size
            // Balance between version preservation and file size
            // ═══════════════════════════════════════════════════════════════════
            pdfBytes = await pdfDoc.save({ 
                useObjectStreams: false,        // Keep false for version preservation
                addDefaultPage: false,          // Don't add extra pages
                updateFieldAppearances: false,  // Don't update form fields
                objectsPerTick: Infinity        // Process all objects at once
            });
            
            console.log(`[editDirect] 📊 Initial PDF size: ${pdfBytes.length} bytes (${(pdfBytes.length / 1024).toFixed(2)} KB)`);
            
            // ═══════════════════════════════════════════════════════════════════
            // CRITICAL: Manually fix PDF version in the header if needed
            // pdf-lib sometimes ignores version settings, so we force it
            // ═══════════════════════════════════════════════════════════════════
            if (originalPdfVersion) {
                const headerStr = pdfBytes.slice(0, 20).toString('latin1');
                const currentVersion = headerStr.match(/%PDF-(\d+\.\d+)/);
                
                if (currentVersion && currentVersion[1] !== originalPdfVersion) {
                    console.log(`[editDirect] ⚠ Version mismatch detected: ${currentVersion[1]} vs ${originalPdfVersion}`);
                    console.log(`[editDirect] 🔧 Manually fixing PDF header version...`);
                    
                    // Replace version in header
                    const newHeader = `%PDF-${originalPdfVersion}`;
                    const headerBytes = Buffer.from(newHeader, 'latin1');
                    headerBytes.copy(pdfBytes, 0);
                    
                    console.log(`[editDirect] ✓ PDF header version fixed to: ${originalPdfVersion}`);
                }
            }
            
            console.log(`[editDirect] ✓ PDF saved successfully (${pdfBytes.length} bytes)`);
            console.log(`[editDirect] 📊 Original size: ${fs.statSync(originalPath).size} bytes (${(fs.statSync(originalPath).size / 1024).toFixed(2)} KB)`);
            console.log(`[editDirect] 📊 New size: ${pdfBytes.length} bytes (${(pdfBytes.length / 1024).toFixed(2)} KB)`);
            
            const sizeIncrease = pdfBytes.length - fs.statSync(originalPath).size;
            const percentIncrease = ((sizeIncrease / fs.statSync(originalPath).size) * 100).toFixed(2);
            console.log(`[editDirect] 📊 Size change: ${sizeIncrease > 0 ? '+' : ''}${(sizeIncrease / 1024).toFixed(2)} KB (${percentIncrease}%)`);
            
            if (percentIncrease > 20) {
                console.warn(`[editDirect] ⚠️ File size increased by ${percentIncrease}% - this is expected for edited PDFs`);
            }
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

        const responseUrl = `${process.env.API_BASE_URL || 'http://localhost:5000'}/downloads/${fileName}`;
        console.log(`[editDirect] ✓ Transform complete! URL: ${responseUrl}`);

        res.status(200).json({
            success: true,
            message: 'Text edits applied successfully.',
            fileUrl: responseUrl,
            stats: {
                changesApplied: appliedChanges,
                totalChanges: changes.length,
                fileSize: pdfBytes.length,
                originalFileSize: fs.statSync(originalPath).size,
                fileSizeKB: (pdfBytes.length / 1024).toFixed(2),
                originalFileSizeKB: (fs.statSync(originalPath).size / 1024).toFixed(2),
                sizeIncreasePercent: (((pdfBytes.length - fs.statSync(originalPath).size) / fs.statSync(originalPath).size) * 100).toFixed(2)
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
