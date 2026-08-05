const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ==================== RECENT UPDATES STORAGE ====================
const recentStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "school/recent_updates",
    resource_type: "auto", // Supports image, pdf, audio, video
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "pdf", "doc", "docx", "mp3", "wav", "mp4", "avi"],
    transformation: [
      { quality: "auto" },
      { fetch_format: "auto" }
    ],
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const originalName = file.originalname.split(".")[0].replace(/\s+/g, "-");
      return `update-${originalName}-${uniqueSuffix}`;
    }
  }
});

// ==================== MULTER INSTANCE ====================
const uploadRecent = multer({
  storage: recentStorage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB (for audio/video)
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "audio/mpeg", "audio/wav", "audio/ogg",
      "video/mp4", "video/avi", "video/mpeg"
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only images, PDFs, Word, Audio and Video files are allowed!"), false);
    }
  }
});

// ==================== DELETE FUNCTION ====================
const deleteFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    console.error("Error deleting from Cloudinary:", error);
    throw error;
  }
};

module.exports = {
  cloudinary,
  uploadRecent,
  deleteFromCloudinary
};
