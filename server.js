const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");

// ==================== CONFIGS ====================
const { cloudinary } = require("./config/cloudinary");
const db = require("./config/db");

const app = express();
app.set("trust proxy", 1);

// ==================== ✅ CORS - COMPLETE FIX ====================
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
    version: "2.0.0",
    timestamp: new Date().toISOString()
  });
});

// ==================== TEST ROUTES ====================
app.get("/test", (req, res) => {
  res.json({ success: true, message: "✅ TEST ROUTE WORKING!" });
});

app.get("/recent-test", (req, res) => {
  res.json({ success: true, message: "✅ RECENT-TEST WORKING!" });
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

// ============================================================
// ==================== RECENT ROUTES ====================
// ============================================================

try {
  const recentRoutes = require("./routes/recentRoutes");
  app.use("/recent", recentRoutes);
  console.log("✅ Recent Routes loaded successfully");
} catch (error) {
  console.error("❌ Error loading recent routes:", error.message);
  
  // ✅ FALLBACK ROUTES - Direct in server.js
  const router = express.Router();
  
  router.get("/public", (req, res) => {
    db.query("SELECT * FROM recent_updates ORDER BY created_at DESC LIMIT 20", (err, results) => {
      if (err) {
        return res.status(500).json({ 
          success: false, 
          error: err.message,
          note: "Table may not exist. Please create recent_updates table."
        });
      }
      res.json({ success: true, data: results, note: "Fallback route" });
    });
  });
  
  router.get("/admin/all", (req, res) => {
    db.query("SELECT * FROM recent_updates ORDER BY created_at DESC", (err, results) => {
      if (err) {
        return res.status(500).json({ 
          success: false, 
          error: err.message,
          note: "Table may not exist. Please create recent_updates table."
        });
      }
      res.json({ success: true, data: results, note: "Fallback route" });
    });
  });
  
  router.get("/admin/stats", (req, res) => {
    db.query("SELECT COUNT(*) as total FROM recent_updates", (err, results) => {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ 
        success: true, 
        data: { 
          total: results,
          new: [{ new: 0 }],
          old: [{ old: 0 }],
          withFile: [{ withFile: 0 }]
        }
      });
    });
  });
  
  app.use("/recent", router);
  console.log("✅ Fallback recent routes registered");
}

// ==================== 404 ====================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "❌ Route not found",
    path: req.originalUrl
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
  console.log("🚀 SERVER v2.0.0 STARTED");
  console.log("=".repeat(50));
  console.log(`📡 Port: ${PORT}`);
  console.log("=".repeat(50));
  console.log("✅ CORS enabled for all origins");
  console.log("✅ Available routes:");
  console.log("  - GET /");
  console.log("  - GET /test");
  console.log("  - GET /recent-test");
  console.log("  - GET /recent/public");
  console.log("  - GET /recent/admin/all");
  console.log("=".repeat(50));
});
