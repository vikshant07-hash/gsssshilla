const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");

// ==================== IMPORT CONFIGS ====================
const { cloudinary } = require("./config/cloudinary");
const { uploadRecent } = require("./config/cloudinary");
const db = require("./config/db");

const app = express();
app.set("trust proxy", 1);

// ==================== CORS ====================
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
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ============================================================
// ==================== ROOT & TEST ROUTES ====================
// ============================================================

app.get("/", (req, res) => {
  res.json({ success: true, message: "🏛️ School Management Backend" });
});

app.get("/test", (req, res) => {
  res.json({ success: true, message: "✅ Server Working!" });
});

app.get("/db-test", (req, res) => {
  db.query("SELECT 1 as test, NOW() as time", (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, data: results[0] });
  });
});

// ============================================================
// ==================== ✅ RECENT ROUTES ====================
// ============================================================

// ✅ Load routes from file
try {
  const recentRoutes = require("./routes/recentRoutes");
  app.use("/recent", recentRoutes);
  console.log("✅ Recent Routes loaded from file");
} catch (error) {
  console.error("❌ Failed to load recent routes:", error.message);
}

// ============================================================
// ==================== 404 & ERROR ====================
// ============================================================

app.use((req, res) => {
  res.status(404).json({ success: false, message: "❌ Route not found", path: req.originalUrl });
});

app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(500).json({ success: false, message: err.message || "Internal Server Error" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("=".repeat(50));
  console.log("🏛️ SERVER STARTED");
  console.log("=".repeat(50));
  console.log(`📡 Port: ${PORT}`);
  console.log("=".repeat(50));
  console.log("✅ Routes:");
  console.log("  GET  /");
  console.log("  GET  /test");
  console.log("  GET  /recent/public");
  console.log("  GET  /recent/admin/all");
  console.log("  POST /recent/admin/add");
  console.log("  DELETE /recent/admin/delete/:id");
  console.log("=".repeat(50));
});
