require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const morgan = require('morgan');

const authRoutes = require('./routes/authRoutes');
const statementRoutes = require('./routes/statementRoutes');

const app = express();
const port = process.env.PORT || 5000;

// Middleware - CORS Configuration
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'http://localhost:5173', 
            'http://localhost:5174',
            'http://localhost:3000',
            'https://ecommerce-2sdf.onrender.com'
        ];
        
        // Check if origin is in allowed list or is a Render URL
        if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.onrender.com')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    maxAge: 86400 // 24 hours
}));

// Handle preflight requests explicitly
app.options('*', cors());

app.use(express.json({ limit: process.env.UPLOAD_LIMIT || '100mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.UPLOAD_LIMIT || '100mb' }));
app.use(morgan('dev')); 

// Database Connection
if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => console.log('Connected to MongoDB safely.'))
        .catch(err => {
            console.error('MongoDB connection error. Please check your network or URI.');
            console.error(err.message);
        });
} else {
    console.log('No MONGO_URI found in .env. Running without database.');
}

// Ensure uploads and downloads directories exist
const uploadDir = path.resolve(process.cwd(), 'uploads');
const downloadDir = path.resolve(process.cwd(), 'downloads');
[uploadDir, downloadDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
    }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/statements', statementRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV || 'development'
    });
});

// Serve files as static - using absolute paths for production reliability
app.use('/uploads', express.static(uploadDir));
app.use('/downloads', express.static(downloadDir));

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
    const frontendBuildPath = path.join(__dirname, '../frontend/dist');
    
    // Serve static files from frontend build
    app.use(express.static(frontendBuildPath));
    
    // Handle React routing - send all non-API requests to index.html
    app.get('*', (req, res) => {
        res.sendFile(path.join(frontendBuildPath, 'index.html'));
    });
    
    console.log(`[Production] Serving frontend from: ${frontendBuildPath}`);
}

// Start server with robust error handling
const server = app.listen(port, () => {
    console.log(`Backend server ACTIVE at http://localhost:${port} (Port: ${port})`);
    console.log(`Backend API: http://localhost:${port}/api`);
    console.log(`File uploads available at: http://localhost:${port}/uploads`);
    console.log('Press Ctrl+C to stop the server.');
});

// Port conflict handling
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Error: Port ${port} is already in use by another application.`);
        process.exit(1);
    } else {
        console.error('An unexpected server error occurred:', err);
    }
});

// Global Error Handlers - To catch why it exits
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception thrown:', err);
    process.exit(1);
});
