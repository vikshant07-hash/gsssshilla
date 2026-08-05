const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const path = require("path");

// ==================== CLOUDINARY CONFIG ====================
const { cloudinary } = require("./config/cloudinary");

const app = express();
app.set("trust proxy", 1);

const verifyToken = require("./middleware/authMiddleware");

// ==================== ROOT ROUTE ====================
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "School Management Backend is Running 🚀",
    version: "1.0.0"
  });
});

// ==================== MIDDLEWARE ====================

// ✅ CORS
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:5500",
    "https://gsssshilla.magicalmathsquiz.workers.dev",
    "https://gsssshilla07.pages.dev",
    "https://school-frontend-6n6.pages.dev"
  ],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==================== STATIC FILES ====================
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ==================== SMTP TEST ====================
app.get("/smtp-test", async (req, res) => {
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      auth: {
        user: process.env.BREVO_EMAIL,
        pass: process.env.BREVO_SMTP_KEY
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000
    });

    console.log("Checking SMTP...");
    await transporter.verify();
    console.log("SMTP VERIFIED");
    res.send("SMTP OK");

  } catch (err) {
    console.log("SMTP ERROR:", err);
    res.send("SMTP ERROR: " + err.message);
  }
});

// ==================== CLOUDINARY TEST ====================
app.get("/cloudinary-test", async (req, res) => {
  try {
    const result = await cloudinary.api.ping();
    res.json({
      success: true,
      message: "Cloudinary connected successfully ✅",
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Cloudinary connection failed ❌",
      error: error.message
    });
  }
});

// ==================== ROUTES ====================

// ✅ सभी routes को require() के साथ use करें
app.use("/images", require("./routes/images"));
app.use("/notifications", require("./routes/notifications"));
app.use("/downloads", require("./routes/downloads"));

// ✅ RECENT ROUTES - इसे ठीक करें
app.use("/recent", require("./routes/recentRoutes"));  // ← यहाँ ठीक किया

app.use("/api/gallery", require("./routes/galleryRoutes"));
app.use("/faculty", require("./routes/facultyRoutes"));
app.use("/admin/faculty", require("./routes/adminFacultyRoutes"));
app.use("/contact", require("./routes/contactRoutes"));
app.use("/admin/contact", require("./routes/contactAdmin"));
app.use("/", require("./routes/auth"));
app.use("/analytics", require("./routes/analytics"));
app.use("/api/admin", require("./routes/adminRoutes"));

// ==================== HEALTH CHECK ====================
app.get("/test", (req, res) => {
  res.send("TEST OK");
});

// ==================== 404 HANDLER ====================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found"
  });
});

// ==================== ERROR HANDLER ====================
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);

  if (err.code === 'FILE_TOO_LARGE') {
    return res.status(413).json({
      success: false,
      message: 'File too large. Maximum size is 10MB'
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
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME}`);
});
