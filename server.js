const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const path = require("path"); // ✅ PATH जोड़ा

// ==================== CLOUDINARY CONFIG ====================
const { cloudinary } = require("./config/cloudinary"); // ✅ Cloudinary import

const app = express();
app.set("trust proxy", 1);

const verifyToken = require("./middleware/authMiddleware");
const recentRoutes = require("./routes/recentRoutes");

// ==================== ROOT ROUTE ====================
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "School Management Backend is Running 🚀",
    version: "1.0.0"
  });
});

// ==================== MIDDLEWARE ====================

// ✅ CORS - सभी origins के लिए
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
// ✅ Local uploads folder (backup के लिए)
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

// ✅ Images Route - Cloudinary के साथ
app.use("/images", require("./routes/images"));

// ✅ Notifications Route - Cloudinary के साथ
app.use("/notifications", require("./routes/notifications"));

// ✅ Downloads Route - Cloudinary के साथ
app.use("/downloads", require("./routes/downloads"));

// ✅ Recent Routes
app.use("/recent", recentRoutes);

// ✅ Gallery Routes
app.use("/api/gallery", require("./routes/galleryRoutes"));

// ✅ Faculty Routes
app.use("/faculty", require("./routes/facultyRoutes"));
app.use("/admin/faculty", require("./routes/adminFacultyRoutes"));

// ✅ Contact Routes
app.use("/contact", require("./routes/contactRoutes"));
app.use("/admin/contact", require("./routes/contactAdmin"));

// ✅ Auth Routes
app.use("/", require("./routes/auth"));

// ✅ Analytics Routes
app.use("/analytics", require("./routes/analytics"));

// ✅ Admin Routes
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

  // ✅ Multer Error Handling
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
  console.log(`✅ Cloudinary connected: ${process.env.CLOUDINARY_CLOUD_NAME}`);
});
