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
// STORAGE FOR GALLERY - IMAGES & VIDEOS
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
// STORAGE FOR STUDENT DOCUMENTS  🆕
// ============================================================

const studentStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const originalName = file.originalname.split(".")[0].replace(/\s+/g, "-").substring(0, 30);

    return {
      folder: process.env.CLOUDINARY_STUDENT_FOLDER || "school/students",
      resource_type: "auto",   // ✅ Ye change karo (pehle "raw" tha)
      allowed_formats: ["jpg", "jpeg", "png", "webp", "pdf"],
      public_id: `${file.fieldname}-${originalName}-${uniqueSuffix}`
    };
  }
});
// ============================================================
// MULTER UPLOAD: SLIDER IMAGES
// ============================================================
const uploadSlider = multer({
  storage: sliderStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only images (JPEG, PNG, GIF, WebP) are allowed for slider!"), false);
  }
});

// ============================================================
// MULTER UPLOAD: RECENT UPDATES
// ============================================================
const uploadRecent = multer({
  storage: recentStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "audio/mpeg", "audio/wav", "audio/ogg",
      "video/mp4", "video/avi", "video/mpeg", "video/quicktime"
    ];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only images, PDFs, Word, Audio and Video files are allowed!"), false);
  }
});

// ============================================================
// MULTER UPLOAD: GALLERY
// ============================================================
const uploadGallery = multer({
  storage: galleryStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
      "video/mp4", "video/avi", "video/mpeg", "video/quicktime", "video/webm", "video/x-matroska"
    ];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only images and video files are allowed for gallery!"), false);
  }
});

// ============================================================
// MULTER UPLOAD: DOWNLOADS
// ============================================================
const uploadDownload = multer({
  storage: downloadStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only PDF, Word documents, and images are allowed!"), false);
  }
});

// ============================================================
// MULTER UPLOAD: FACULTY PHOTOS
// ============================================================
const uploadFaculty = multer({
  storage: facultyStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only images (JPEG, PNG, WebP) are allowed!"), false);
  }
});

// ============================================================
// MULTER UPLOAD: STUDENT DOCUMENTS  🆕
// ============================================================
const uploadStudent = multer({
  storage: studentStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg", "image/jpg", "image/png", "image/webp",
      "application/pdf"
    ];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPG, PNG, WEBP, PDF allowed for student documents!"), false);
  }
});


// ============================================================
// 🆕 BLOG STORAGES (Same Cloudinary, alag folders)
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
  cloudinary: cloudinary,
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
  cloudinary: cloudinary,
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
  cloudinary: cloudinary,
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
  cloudinary: cloudinary,
  params: {
    folder: "blog/files",
    resource_type: "raw",
    allowed_formats: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "zip"],
    public_id: (req, file) => blogMakeId("file", file)
  }
});

// MULTER UPLOADERS
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

// BASE64 UPLOAD
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

// DELETE
const deleteBlogFromCloudinary = async (publicId, resourceType = "image") => {
  return await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
};


  



// ============================================================
// UPDATED EXPORTS (purane + naye sab)
// ============================================================
module.exports = {
  cloudinary,
  // Existing (school project ke liye)
  uploadSlider,
  uploadRecent,
  uploadGallery,
  uploadDownload,
  uploadFaculty,
  uploadStudent,
  // 🆕 Blog
  uploadBlogCover,
  uploadBlogContent,
  uploadAvatar,
  uploadBlogFile,
  uploadBase64,
  deleteFromCloudinary
};

