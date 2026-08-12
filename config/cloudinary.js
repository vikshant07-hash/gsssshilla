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
// STORAGE FOR GALLERY - IMAGES & VIDEOS (NEW)
// ============================================================
const galleryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: process.env.CLOUDINARY_GALLERY_FOLDER || "school/gallery",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "mp4", "mov", "avi", "webm", "mkv"],
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const originalName = file.originalname.split(".")[0].replace(/\s+/g, "-").substring(0, 30);
      return `gallery-${originalName}-${uniqueSuffix}`;
    }
  }
});

// ============================================================
// STORAGE FOR DOWNLOADS
// ============================================================
const downloadStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: process.env.CLOUDINARY_DOWNLOAD_FOLDER || "school/downloads",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "pdf", "doc", "docx"],
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const originalName = file.originalname.split(".")[0].replace(/\s+/g, "-").substring(0, 30);
      return `download-${originalName}-${uniqueSuffix}`;
    }
  }
});

// ============================================================
// STORAGE FOR FACULTY PHOTOS
// ============================================================
const facultyStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: process.env.CLOUDINARY_FACULTY_FOLDER || "school/faculty",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      { width: 400, height: 400, crop: "thumb", gravity: "face" },
      { quality: "auto:good" }
    ],
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const originalName = file.originalname.split(".")[0].replace(/\s+/g, "-").substring(0, 30);
      return `faculty-${originalName}-${uniqueSuffix}`;
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
// MULTER UPLOAD: GALLERY (Images & Videos) - NEW
// ============================================================
const uploadGallery = multer({
  storage: galleryStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB for videos
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
      "video/mp4", "video/avi", "video/mpeg", "video/quicktime", "video/webm", "video/x-matroska"
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only images and video files are allowed for gallery!"), false);
    }
  }
});

// ============================================================
// MULTER UPLOAD: DOWNLOADS
// ============================================================
const uploadDownload = multer({
  storage: downloadStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, Word documents, and images are allowed!"), false);
    }
  }
});

// ============================================================
// MULTER UPLOAD: FACULTY PHOTOS
// ============================================================
const uploadFaculty = multer({
  storage: facultyStorage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only images (JPEG, PNG, WebP) are allowed!"), false);
    }
  }
});

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  cloudinary,
  uploadSlider,
  uploadRecent,
  uploadGallery,   // <-- ADD THIS
  uploadDownload,
  uploadFaculty
};
