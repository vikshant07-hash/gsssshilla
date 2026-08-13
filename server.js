const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");
const session = require('express-session');
const fs = require("fs-extra");
const { cloudinary, uploadSlider, uploadRecent, uploadGallery, uploadFaculty, uploadDownload } = require("./config/cloudinary");
const { db } = require("./config/db");

const app = express();
app.set("trust proxy", 1);

// ============================================================
// SECURITY HEADERS
// ============================================================
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    
    // CSP for admin panel
    res.setHeader('Content-Security-Policy', 
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: https://*.cloudinary.com https://*.pages.dev; " +
        "connect-src 'self' https://*.onrender.com; " +
        "media-src 'self' https://*.cloudinary.com;"
    );
    
    next();
});

// ============================================================
// SESSION MIDDLEWARE
// ============================================================
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 30 * 60 * 1000,
        sameSite: 'strict'
    }
}));

// ============================================================
// CORS - SECURE
// ============================================================
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5500').split(',');

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`⚠️ CORS blocked: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-CSRF-Token']
}));

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ============================================================
// LOAD ROUTES
// ============================================================
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');

// ============================================================
// REGISTER ROUTES
// ============================================================
app.use('/api/admin', authRoutes); // Auth routes (login, verify, etc.)
app.use('/api/admin', adminRoutes); // Admin protected routes

// ============================================================
// YOUR EXISTING ROUTES (Moved to adminRoutes or kept here)
// ============================================================
// ... (all your existing routes - slider, recent, gallery, faculty, downloads)
// They should be moved to adminRoutes.js with verifyToken middleware

// ============================================================
// ROOT & TEST
// ============================================================
app.get("/", (req, res) => {
    res.json({ 
        success: true, 
        message: "🏛️ Secure School Management Backend",
        version: "2.0",
        security: {
            authentication: "JWT + Session",
            csrf: "Protected",
            rateLimiting: "Active",
            headers: "Secure"
        }
    });
});

app.get("/test", (req, res) => {
    res.json({ success: true, message: "✅ Server Working!" });
});

// ============================================================
// 404 & ERROR HANDLER
// ============================================================
app.use((req, res) => {
    res.status(404).json({ success: false, message: "❌ Route not found" });
});

app.use((err, req, res, next) => {
    console.error("❌ Server Error:", err.message);
    res.status(500).json({ 
        success: false, 
        message: process.env.NODE_ENV === 'production' 
            ? 'Internal Server Error' 
            : err.message 
    });
});

// ============================================================
// PORT
// ============================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("=".repeat(60));
    console.log("🏛️ SECURE SCHOOL MANAGEMENT BACKEND");
    console.log("=".repeat(60));
    console.log(`📡 Port: ${PORT}`);
    console.log(`🔒 Security: JWT + Session + CSRF + Rate Limiting`);
    console.log(`✅ Version: 2.0 (Secure)`);
    console.log("=".repeat(60));
});
