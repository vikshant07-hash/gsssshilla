const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
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
// 🔧 AUTO RESOURCE TYPE DETECTION
// PDFs ke liye 'raw', baaki sab ke liye 'image'
// ============================================================
function getResourceType(file) {
  if (!file || !file.mimetype) return "image";
  const mt = file.mimetype.toLowerCase();
  // PDFs, docs, zips → raw
  if (
    mt === "application/pdf" ||
    mt.includes("word") ||
    mt.includes("excel") ||
    mt.includes("spreadsheet") ||
    mt.includes("powerpoint") ||
    mt.includes("presentation") ||
    mt === "text/plain" ||
    mt.includes("zip")
  ) {
    return "raw";
  }
  // Images, videos → image / video
  if (mt.startsWith("image/")) return "image";
  if (mt.startsWith("video/")) return "video";
  if (mt.startsWith("audio/")) return "video"; // Cloudinary audio video type me jaata hai
  // Default → raw (safe)
  return "raw";
}

// ============================================================
// 🏫 SCHOOL STORAGES
// ============================================================

// SLIDER
const sliderStorage = new CloudinaryStorage({
  cloudinary,
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

// RECENT UPDATES
const recentStorage = new CloudinaryStorage({
  cloudinary,
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

// GALLERY
const galleryStorage = new CloudinaryStorage({
  cloudinary,
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

// DOWNLOADS
const downloadStorage = new CloudinaryStorage({
  cloudinary,
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

// FACULTY
const facultyStorage = new CloudinaryStorage({
  cloudinary,
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
// ✅ STUDENT STORAGE — AUTO RESOURCE TYPE (PDF → raw, Images → image)
// ============================================================
const studentStorage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const originalName = file.originalname.split(".")[0].replace(/\s+/g, "-").substring(0, 30);
    const resourceType = getResourceType(file);
    const isPdf = file.mimetype === "application/pdf";

    return {
      folder: process.env.CLOUDINARY_STUDENT_FOLDER || "school/students",
      resource_type: resourceType,
      format: isPdf ? "pdf" : undefined,
      allowed_formats: resourceType === "raw"
        ? ["pdf"]
        : ["jpg", "jpeg", "png", "webp"],
      public_id: `${file.fieldname}-${originalName}-${uniqueSuffix}`
    };
  }
});

// ============================================================
// 💾 BACKUP STORAGE — Cloudinary me backup files (raw JSON)
// ============================================================
const backupStorage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    return {
      folder: process.env.CLOUDINARY_BACKUP_FOLDER || "school/backups",
      resource_type: "raw",
      format: "json",
      allowed_formats: ["json"],
      public_id: `backup-${uniqueSuffix}`
    };
  }
});

// ============================================================
// 🏫 SCHOOL MULTER UPLOADERS
// ============================================================
const uploadSlider = multer({
  storage: sliderStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only images allowed for slider"), false);
  }
});

const uploadRecent = multer({
  storage: recentStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
      "application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "audio/mpeg", "audio/wav", "audio/ogg",
      "video/mp4", "video/avi", "video/mpeg", "video/quicktime"
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("File type not allowed"), false);
  }
});

const uploadGallery = multer({
  storage: galleryStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
      "video/mp4", "video/avi", "video/mpeg", "video/quicktime", "video/webm", "video/x-matroska"
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only images/videos allowed for gallery"), false);
  }
});

const uploadDownload = multer({
  storage: downloadStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
      "application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only PDF, Word, images allowed"), false);
  }
});

const uploadFaculty = multer({
  storage: facultyStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only images allowed"), false);
  }
});

const uploadStudent = multer({
  storage: studentStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPG, PNG, WEBP, PDF allowed"), false);
  }
});

// ============================================================
// 📝 BLOG STORAGES (same Cloudinary, alag folders)
// ============================================================

const blogMakeId = (prefix, file) => {
  const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
  const originalName = file.originalname
    .split(".")[0].replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "")
    .substring(0, 30);
  return `${prefix}-${originalName}-${uniqueSuffix}`;
};

// BLOG COVER
const blogCoverStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "blog/covers",
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"],
    transformation: [
      { width: 1600, height: 900, crop: "fill", gravity: "auto" },
      { quality: "auto:good", fetch_format: "auto" }
    ],
    public_id: (req, file) => blogMakeId("cover", file)
  }
});

// BLOG CONTENT
const blogContentStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "blog/content",
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png", "webp", "gif", "svg"],
    transformation: [
      { width: 1400, crop: "limit" },
      { quality: "auto:good", fetch_format: "auto" }
    ],
    public_id: (req, file) => blogMakeId("content", file)
  }
});

// BLOG AVATAR
const blogAvatarStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "blog/avatars",
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      { width: 400, height: 400, crop: "thumb", gravity: "face" },
      { quality: "auto:good", fetch_format: "auto" }
    ],
    public_id: (req, file) => blogMakeId("avatar", file)
  }
});

// BLOG FILE
const blogFileStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "blog/files",
    resource_type: "raw",
    allowed_formats: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "zip"],
    public_id: (req, file) => blogMakeId("file", file)
  }
});

// ============================================================
// 📝 BLOG MULTER UPLOADERS
// ============================================================
const uploadBlogCover = multer({
  storage: blogCoverStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
    if (ok.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only images allowed for cover"), false);
  }
});

const uploadBlogContent = multer({
  storage: blogContentStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
    if (ok.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only images allowed"), false);
  }
});

// ⚠️ IMPORTANT: Ye naam "uploadBlogAvatar" hai (routes.js isi naam se import karta hai)
const uploadBlogAvatar = multer({
  storage: blogAvatarStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (ok.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only images allowed for avatar"), false);
  }
});

const uploadBlogFile = multer({
  storage: blogFileStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = [
      "application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain", "application/zip", "application/x-zip-compressed"
    ];
    if (ok.includes(file.mimetype)) cb(null, true);
    else cb(new Error("File type not allowed"), false);
  }
});

// BLOG BASE64
const uploadBlogBase64 = async (base64String, folder = "blog/content") => {
  const result = await cloudinary.uploader.upload(base64String, {
    folder,
    resource_type: "image",
    transformation: [
      { width: 1400, crop: "limit" },
      { quality: "auto:good", fetch_format: "auto" }
    ]
  });
  return {
    url: result.secure_url,
    public_id: result.public_id,
    width: result.width,
    height: result.height,
    format: result.format
  };
};

// BLOG DELETE
const deleteBlogFromCloudinary = async (publicId, resourceType = "image") => {
  return await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
};

// ============================================================
// 💾 BACKUP HELPERS (Cloudinary-based)
// ============================================================

/**
 * Backup JSON string ko Cloudinary me upload kare
 * @param {string} jsonString - Backup data as JSON string
 * @param {string} type - "auto" | "manual" | "prebak"
 * @returns {Object} - { url, public_id, size, createdAt }
 */
async function uploadBackupToCloudinary(jsonString, type = "auto") {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `backup_${type}_${timestamp}`;

    // Buffer banake upload karo (raw resource type)
    const buffer = Buffer.from(jsonString, "utf8");
    const dataUri = `data:application/json;base64,${buffer.toString("base64")}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: process.env.CLOUDINARY_BACKUP_FOLDER || "school/backups",
      resource_type: "raw",
      public_id: filename,
      format: "json"
    });

    console.log(`✅ Backup uploaded to Cloudinary: ${result.public_id} (${result.bytes} bytes)`);

    return {
      url: result.secure_url,
      public_id: result.public_id,
      size: result.bytes,
      createdAt: new Date().toISOString(),
      type
    };
  } catch (err) {
    console.error("❌ Backup upload to Cloudinary failed:", err.message);
    throw err;
  }
}

/**
 * Cloudinary se backup download kare
 * @param {string} publicId - Cloudinary public_id
 * @returns {string} - JSON string
 */
async function downloadBackupFromCloudinary(publicId) {
  try {
    // Cloudinary ka private_download_url ya direct URL use karo
    const url = cloudinary.url(publicId, {
      resource_type: "raw",
      type: "upload",
      secure: true
    });

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download backup: ${response.status}`);
    }
    const text = await response.text();
    return text;
  } catch (err) {
    console.error("❌ Backup download from Cloudinary failed:", err.message);
    throw err;
  }
}

/**
 * Cloudinary se backup delete kare
 */
async function deleteBackupFromCloudinary(publicId) {
  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: "raw" });
    console.log(`✅ Backup deleted from Cloudinary: ${publicId}`);
    return result;
  } catch (err) {
    console.error("❌ Backup delete failed:", err.message);
    throw err;
  }
}

/**
 * Cloudinary se saari backups list kare
 * @param {number} maxResults - Maximum results
 */
async function listBackupsFromCloudinary(maxResults = 50) {
  try {
    const result = await cloudinary.api.resources({
      type: "upload",
      resource_type: "raw",
      prefix: process.env.CLOUDINARY_BACKUP_FOLDER || "school/backups",
      max_results: maxResults
    });

    return (result.resources || []).map((r) => ({
      public_id: r.public_id,
      url: r.secure_url,
      size: r.bytes,
      createdAt: r.created_at,
      filename: r.public_id.split("/").pop()
    })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (err) {
    console.error("❌ Backup list from Cloudinary failed:", err.message);
    return [];
  }
}

// ============================================================
// 🔍 STUDENT FILE VERIFICATION HELPERS
// ============================================================

/**
 * Cloudinary me student file exist karti hai ya nahi check kare
 * @param {string} publicId - Student file public_id
 * @param {string} resourceType - "image" | "raw" | "auto"
 */
async function checkStudentFileExists(publicId, resourceType = "image") {
  try {
    const result = await cloudinary.api.resource(publicId, { resource_type: resourceType });
    return {
      exists: true,
      url: result.secure_url,
      public_id: result.public_id,
      bytes: result.bytes,
      resource_type: resourceType,
      format: result.format
    };
  } catch (err) {
    // Agar "image" me nahi mili, "raw" try karo
    if (resourceType !== "raw") {
      try {
        const result = await cloudinary.api.resource(publicId, { resource_type: "raw" });
        return {
          exists: true,
          url: result.secure_url,
          public_id: result.public_id,
          bytes: result.bytes,
          resource_type: "raw",
          format: result.format
        };
      } catch (e2) {
        return { exists: false, error: err.message };
      }
    }
    return { exists: false, error: err.message };
  }
}

/**
 * Cloudinary URL me se public_id + resource_type nikale
 * @param {string} url - Cloudinary URL
 */
function parseCloudinaryUrl(url) {
  try {
    const urlObj = new URL(url);
    const parts = urlObj.pathname.split("/").filter(Boolean);
    // Format: /{cloud}/{resource_type}/{type}/{version}/{public_id}.{ext}
    const uploadIdx = parts.indexOf("upload");
    if (uploadIdx <= 0) return null;

    const resourceType = parts[uploadIdx - 1]; // 'image' | 'raw' | 'video'
    const afterUpload = parts.slice(uploadIdx + 1);
    const withoutVersion = afterUpload[0] && /^v\d+$/.test(afterUpload[0])
      ? afterUpload.slice(1)
      : afterUpload;

    let publicId = withoutVersion.join("/");
    let format = null;

    // Remove extension for raw type (Cloudinary API expects without ext sometimes)
    const lastDot = publicId.lastIndexOf(".");
    if (lastDot > 0) {
      format = publicId.slice(lastDot + 1);
      // For raw type, keep extension in some cases
    }

    return {
      cloudName: parts[0],
      resourceType,
      publicId,
      format,
      fullPath: parts.join("/")
    };
  } catch (err) {
    return null;
  }
}

/**
 * Student PDF/image URL ko valid banaye — agar galat resource_type me hai to fix kare
 * @param {string} originalUrl - Original Cloudinary URL
 * @returns {string|null} - Working URL ya null agar file nahi mili
 */
async function resolveStudentFileUrl(originalUrl) {
  if (!originalUrl || !originalUrl.includes("res.cloudinary.com")) {
    return originalUrl;
  }

  const parsed = parseCloudinaryUrl(originalUrl);
  if (!parsed) return originalUrl;

  // Direct check — original URL fetch karo
  const tryFetch = (url) => new Promise((resolve) => {
    try {
      const https = require("https");
      const http = require("http");
      const client = url.startsWith("https") ? https : http;
      const req = client.get(url, (res) => {
        // Consume response
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(8000, () => { req.destroy(); resolve(false); });
    } catch (e) {
      resolve(false);
    }
  });

  // 1. Try original
  if (await tryFetch(originalUrl)) return originalUrl;

  // 2. Try swapping raw ⇄ image
  let altUrl = null;
  if (originalUrl.includes("/raw/upload/")) {
    altUrl = originalUrl.replace("/raw/upload/", "/image/upload/");
  } else if (originalUrl.includes("/image/upload/")) {
    altUrl = originalUrl.replace("/image/upload/", "/raw/upload/");
  }

  if (altUrl && await tryFetch(altUrl)) return altUrl;

  return null; // File nahi mili
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  cloudinary,

  // 🔧 Helpers
  getResourceType,

  // 🏫 School
  uploadSlider,
  uploadRecent,
  uploadGallery,
  uploadDownload,
  uploadFaculty,
  uploadStudent,

  // 📝 Blog
  uploadBlogCover,
  uploadBlogContent,
  uploadBlogAvatar,
  uploadBlogFile,
  uploadBlogBase64,
  deleteBlogFromCloudinary,

  // 💾 Backup
  uploadBackupToCloudinary,
  downloadBackupFromCloudinary,
  deleteBackupFromCloudinary,
  listBackupsFromCloudinary,
  backupStorage,

  // 🔍 Student file helpers
  checkStudentFileExists,
  parseCloudinaryUrl,
  resolveStudentFileUrl
};
