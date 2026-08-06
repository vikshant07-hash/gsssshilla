const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");
require("dotenv").config();

// ============================================================
// CLOUDINARY CONFIG
// ============================================================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

console.log("☁️ Cloudinary configured for:", process.env.CLOUDINARY_CLOUD_NAME);

// ============================================================
// STORAGE FOR SLIDER IMAGES
// ============================================================
const sliderStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: process.env.CLOUDINARY_SLIDER_FOLDER || "school/slider",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
    transformation: [
      { width: 1200, height: 600, crop: "limit" },
      { quality: "auto:good" }
    ],
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const originalName = file.originalname.split(".")[0].replace(/\s+/g, "-").substring(0, 30);
      return `slider-${originalName}-${uniqueSuffix}`;
    }
  }
});

// ============================================================
// STORAGE FOR RECENT UPDATES
// ============================================================
const recentStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: process.env.CLOUDINARY_RECENT_FOLDER || "school/recent_updates",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "pdf", "doc", "docx", "mp3", "wav", "mp4", "avi", "mov"],
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const originalName = file.originalname.split(".")[0].replace(/\s+/g, "-").substring(0, 30);
      return `update-${originalName}-${uniqueSuffix}`;
    }
  }
});

// ============================================================
// MULTER UPLOAD: SLIDER IMAGES
// ============================================================
const uploadSlider = multer({
  storage: sliderStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only images (JPEG, PNG, GIF, WebP) are allowed for slider!"), false);
    }
  }
});

// ============================================================
// MULTER UPLOAD: RECENT UPDATES
// ============================================================
const uploadRecent = multer({
  storage: recentStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "audio/mpeg", "audio/wav", "audio/ogg",
      "video/mp4", "video/avi", "video/mpeg", "video/quicktime"
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only images, PDFs, Word, Audio and Video files are allowed!"), false);
    }
  }
});

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  cloudinary,
  uploadSlider,
  uploadRecent
};
