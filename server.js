const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");

// ==================== IMPORT CONFIGS ====================
const { cloudinary } = require("./config/cloudinary");
const db = require("./config/db");

const app = express();
app.set("trust proxy", 1);

// ==================== ROOT ROUTE ====================
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "🏫 School Management Backend is Running 🚀",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
});

// ==================== MIDDLEWARE ====================

// CORS Configuration
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:5500",
    "https://gsssshilla.magicalmathsquiz.workers.dev",
    "https://gsssshilla07.pages.dev",
    "https://school-frontend-6n6.pages.dev",
    "*"
  ],
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==================== STATIC FILES ====================
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ==================== CLOUDINARY TEST ====================
app.get("/cloudinary-test", async (req, res) => {
  try {
    const result = await cloudinary.api.ping();
    res.json({
      success: true,
      message: "✅ Cloudinary connected successfully",
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "❌ Cloudinary connection failed",
      error: error.message
    });
  }
});

// ==================== DATABASE TEST ====================
app.get("/db-test", (req, res) => {
  db.query("SELECT 1 as test, NOW() as time", (err, results) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "❌ Database connection failed",
        error: err.message
      });
    }
    res.json({
      success: true,
      message: "✅ Database connected successfully",
      data: results[0]
    });
  });
});

// ==================== HEALTH CHECK ====================
app.get("/health", async (req, res) => {
  try {
    const dbStatus = await new Promise((resolve) => {
      db.query("SELECT 1 as health", (err) => {
        resolve(err ? "unhealthy" : "healthy");
      });
    });

    let cloudinaryStatus = "disconnected";
    try {
      await cloudinary.api.ping();
      cloudinaryStatus = "connected";
    } catch (e) {
      cloudinaryStatus = "disconnected";
    }

    res.json({
      success: true,
      status: "OK",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        cloudinary: cloudinaryStatus,
        server: "running"
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "❌ Health check failed",
      error: error.message
    });
  }
});

// ============================================================
// ==================== RECENT ROUTES ====================
// ============================================================

app.use("/recent", require("./routes/recentRoutes"));

// ==================== 404 HANDLER ====================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "❌ Route not found",
    path: req.originalUrl
  });
});

// ==================== ERROR HANDLER ====================
app.use((err, req, res, next) => {
  console.error("❌ SERVER ERROR:", err);

  if (err.code === 'FILE_TOO_LARGE') {
    return res.status(413).json({
      success: false,
      message: 'File too large. Maximum size is 50MB'
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error"
  });
});

// ==================== PORT ====================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("=".repeat(50));
  console.log("🚀 SERVER STARTED SUCCESSFULLY");
  console.log("=".repeat(50));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`☁️ Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME || 'Not configured'}`);
  console.log(`🗄️ Database: ${process.env.DB_NAME || 'Not configured'}`);
  console.log("=".repeat(50));
  console.log("✅ Server is ready to accept requests");
  console.log("=".repeat(50));
});
