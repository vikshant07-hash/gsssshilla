const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");

const { cloudinary } = require("./config/cloudinary");
const db = require("./config/db");

const app = express();
app.set("trust proxy", 1);

// ==================== ✅ CORS ====================
app.use(cors({
  origin: "*",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
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
// ==================== ✅ RECENT ROUTES (FROM FILE) ====================
// ============================================================

// ✅ YEH IMPORTANT HAI - /recent route register karein
try {
  const recentRoutes = require("./routes/recentRoutes");
  app.use("/recent", recentRoutes);
  console.log("✅ Recent Routes loaded successfully");
  console.log("  📌 Available routes:");
  console.log("     GET  /recent/public");
  console.log("     GET  /recent/admin/all");
  console.log("     POST /recent/admin/add");
  console.log("     PUT  /recent/admin/update/:id");
  console.log("     DELETE /recent/admin/delete/:id");
  console.log("     DELETE /recent/admin/bulk-delete");
} catch (error) {
  console.error("❌ Error loading recent routes:", error.message);
}

// ============================================================
// ==================== 404 HANDLER ====================
// ============================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "❌ Route not found",
    path: req.originalUrl,
    availableRoutes: [
      "/",
      "/test",
      "/recent-test",
      "/db-test",
      "/cloudinary-test",
      "/recent/public",
      "/recent/admin/all",
      "/recent/admin/add",
      "/recent/admin/delete/:id",
      "/recent/admin/bulk-delete"
    ]
  });
});

// ==================== ERROR HANDLER ====================
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(err.status || 500).json({
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
  console.log("✅ CORS enabled");
  console.log("✅ Recent routes loaded from file");
  console.log("=".repeat(50));
});
