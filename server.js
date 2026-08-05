const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");

// ==================== CONFIGS ====================
const { cloudinary } = require("./config/cloudinary");
const db = require("./config/db");

const app = express();
app.set("trust proxy", 1);

// ==================== MIDDLEWARE ====================
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ==================== STATIC FILES ====================
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ==================== ✅ VERSION CHECK ====================
// Ye route server version batayega - agar ye chal gaya toh naya code deploy hua
app.get("/version", (req, res) => {
  res.json({
    success: true,
    version: "2.0.0",
    message: "✅ NEW CODE DEPLOYED! Server.js updated.",
    deployTime: new Date().toISOString(),
    routes: ["/", "/test", "/recent-test", "/simple-public", "/db-test", "/cloudinary-test", "/health"]
  });
});

// ==================== ROOT ====================
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "🏫 School Management Backend 🚀",
    version: "2.0.0",
    timestamp: new Date().toISOString()
  });
});

// ==================== ✅ TEST ROUTES (Guaranteed Working) ====================
app.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "✅ TEST ROUTE WORKING!",
    timestamp: new Date().toISOString()
  });
});

app.get("/recent-test", (req, res) => {
  res.json({
    success: true,
    message: "✅ RECENT-TEST ROUTE WORKING!",
    timestamp: new Date().toISOString()
  });
});

app.get("/simple-public", (req, res) => {
  db.query("SELECT * FROM recent_updates ORDER BY created_at DESC LIMIT 10", (err, results) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "❌ Database error",
        error: err.message
      });
    }
    res.json({
      success: true,
      data: results,
      note: "Direct query from server.js"
    });
  });
});

// ==================== DB TEST ====================
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

// ==================== RECENT ROUTES (FILE) ====================
try {
  const fs = require("fs");
  const routesPath = path.join(__dirname, "routes", "recentRoutes.js");

  if (fs.existsSync(routesPath)) {
    const recentRoutes = require("./routes/recentRoutes");
    app.use("/recent", recentRoutes);
    console.log("✅ Recent Routes loaded from file");
  } else {
    console.warn("⚠️ routes/recentRoutes.js not found");
    const router = express.Router();
    router.get("/", (req, res) => {
      res.json({ success: true, message: "Recent route fallback" });
    });
    router.get("/public", (req, res) => {
      db.query("SELECT * FROM recent_updates ORDER BY created_at DESC LIMIT 20", (err, results) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: results });
      });
    });
    app.use("/recent", router);
  }
} catch (error) {
  console.error("❌ Error loading recent routes:", error.message);
}

// ==================== 404 ====================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "❌ Route not found",
    path: req.originalUrl,
    hint: "Try /test, /recent-test, or /version to verify new code is deployed"
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
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log("=".repeat(50));
  console.log("✅ VERIFIED WORKING ROUTES:");
  console.log("  - GET /");
  console.log("  - GET /version");
  console.log("  - GET /test");
  console.log("  - GET /recent-test");
  console.log("=".repeat(50));
});
