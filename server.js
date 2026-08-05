const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");

const { cloudinary } = require("./config/cloudinary");
const db = require("./config/db");

const app = express();
app.set("trust proxy", 1);

// ==================== ✅ COMPLETE CORS FIX ====================
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

// ✅ Handle preflight requests
app.options('*', cors());

// ==================== MIDDLEWARE ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==================== STATIC FILES ====================
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ==================== ROOT ====================
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "🏫 School Management Backend 🚀",
    timestamp: new Date().toISOString()
  });
});

// ==================== ✅ TEST ROUTES ====================
app.get("/test", (req, res) => {
  res.json({ success: true, message: "✅ TEST WORKING!" });
});

// ==================== ✅ DIRECT RECENT ROUTE (NO ROUTES FILE) ====================
app.get("/recent-public", (req, res) => {
  console.log("📡 /recent-public called");
  
  db.query("SELECT * FROM recent_updates ORDER BY created_at DESC LIMIT 20", (err, results) => {
    if (err) {
      console.error("❌ DB Error:", err);
      return res.status(500).json({ 
        success: false, 
        error: err.message,
        hint: "Table 'recent_updates' may not exist"
      });
    }
    console.log("✅ Data fetched:", results.length, "records");
    res.json({ success: true, data: results });
  });
});

app.get("/recent-admin-all", (req, res) => {
  console.log("📡 /recent-admin-all called");
  
  db.query("SELECT * FROM recent_updates ORDER BY created_at DESC", (err, results) => {
    if (err) {
      console.error("❌ DB Error:", err);
      return res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    }
    console.log("✅ Data fetched:", results.length, "records");
    res.json({ success: true, data: results });
  });
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

// ==================== 404 ====================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "❌ Route not found",
    path: req.originalUrl,
    availableRoutes: ["/", "/test", "/recent-public", "/recent-admin-all", "/db-test"]
  });
});

// ==================== ERROR HANDLER ====================
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error"
  });
});

// ==================== PORT ====================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("=".repeat(50));
  console.log("🚀 SERVER STARTED");
  console.log("=".repeat(50));
  console.log(`📡 Port: ${PORT}`);
  console.log("✅ CORS enabled");
  console.log("✅ Available routes:");
  console.log("  - GET /");
  console.log("  - GET /test");
  console.log("  - GET /recent-public");
  console.log("  - GET /recent-admin-all");
  console.log("  - GET /db-test");
  console.log("=".repeat(50));
});
