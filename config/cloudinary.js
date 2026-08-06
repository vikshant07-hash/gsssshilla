const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const recentStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "school/recent_updates",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "pdf", "doc", "docx", "mp3", "wav", "mp4", "avi"],
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const originalName = file.originalname.split(".")[0].replace(/\s+/g, "-");
      return `update-${originalName}-${uniqueSuffix}`;
    }
  }
});

const uploadRecent = multer({
  storage: recentStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
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

module.exports = { cloudinary, uploadRecent };
