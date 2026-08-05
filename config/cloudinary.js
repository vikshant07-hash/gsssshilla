const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

// ==================== CLOUDINARY CONFIG ====================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ==================== IMAGE STORAGE ====================
const imageStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "school/images",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "svg"],
    transformation: [
      { width: 1200, height: 800, crop: "limit" },
      { quality: "auto" },
      { fetch_format: "auto" }
    ],
    public_id: (req, file) => {
      // Unique filename generate करें
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const originalName = file.originalname.split(".")[0].replace(/\s+/g, "-");
      return `image-${originalName}-${uniqueSuffix}`;
    }
  }
});

// ==================== PDF/DOCUMENT STORAGE ====================
const pdfStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "school/documents",
    allowed_formats: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt"],
    resource_type: "raw",
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const originalName = file.originalname.split(".")[0].replace(/\s+/g, "-");
      return `document-${originalName}-${uniqueSuffix}`;
    }
  }
});

// ==================== NOTIFICATION STORAGE ====================
const notificationStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "school/notifications",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
    transformation: [
      { width: 800, height: 600, crop: "limit" },
      { quality: "auto" }
    ],
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      return `notification-${uniqueSuffix}`;
    }
  }
});

// ==================== GALLERY STORAGE ====================
const galleryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "school/gallery",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
    transformation: [
      { width: 1600, height: 1200, crop: "limit" },
      { quality: "auto" },
      { fetch_format: "auto" }
    ],
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      return `gallery-${uniqueSuffix}`;
    }
  }
});

// ==================== FACULTY STORAGE ====================
const facultyStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "school/faculty",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      { width: 400, height: 400, crop: "fill" },
      { quality: "auto" },
      { fetch_format: "auto" }
    ],
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      return `faculty-${uniqueSuffix}`;
    }
  }
});

// ==================== MULTER INSTANCES ====================
const uploadImage = multer({
  storage: imageStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
  }
});

const uploadPDF = multer({
  storage: pdfStorage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});

const uploadNotification = multer({
  storage: notificationStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

const uploadGallery = multer({
  storage: galleryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

const uploadFaculty = multer({
  storage: facultyStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

// ==================== DELETE FUNCTIONS ====================

// ✅ Image delete
const deleteFromCloudinary = async (publicId) => {
  try {
    if (!publicId) {
      throw new Error("Public ID is required");
    }
    const result = await cloudinary.uploader.destroy(publicId);
    console.log(`✅ Deleted from Cloudinary: ${publicId}`, result);
    return result;
  } catch (error) {
    console.error("❌ Error deleting from Cloudinary:", error);
    throw error;
  }
};

// ✅ PDF/Document delete (raw files)
const deleteRawFromCloudinary = async (publicId) => {
  try {
    if (!publicId) {
      throw new Error("Public ID is required");
    }
    const result = await cloudinary.api.delete_resources([publicId], {
      type: "upload",
      resource_type: "raw"
    });
    console.log(`✅ Deleted PDF from Cloudinary: ${publicId}`, result);
    return result;
  } catch (error) {
    console.error("❌ Error deleting PDF from Cloudinary:", error);
    throw error;
  }
};

// ✅ Multiple images delete
const deleteMultipleFromCloudinary = async (publicIds) => {
  try {
    if (!publicIds || publicIds.length === 0) {
      throw new Error("Public IDs are required");
    }
    const result = await cloudinary.api.delete_resources(publicIds, {
      type: "upload",
      resource_type: "image"
    });
    console.log(`✅ Deleted ${publicIds.length} images from Cloudinary`, result);
    return result;
  } catch (error) {
    console.error("❌ Error deleting multiple images from Cloudinary:", error);
    throw error;
  }
};

// ✅ Get image URL with transformations
const getOptimizedUrl = (publicId, options = {}) => {
  const { width, height, crop = "limit", quality = "auto", format = "auto" } = options;
  
  let url = cloudinary.url(publicId, {
    transformation: [
      { width, height, crop },
      { quality },
      { fetch_format: format }
    ]
  });
  
  return url;
};

// ✅ Get thumbnail URL
const getThumbnailUrl = (publicId, width = 200, height = 200) => {
  return cloudinary.url(publicId, {
    transformation: [
      { width, height, crop: "fill" },
      { quality: "auto" },
      { fetch_format: "auto" }
    ]
  });
};

module.exports = {
  cloudinary,
  uploadImage,
  uploadPDF,
  uploadNotification,
  uploadGallery,
  uploadFaculty,
  deleteFromCloudinary,
  deleteRawFromCloudinary,
  deleteMultipleFromCloudinary,
  getOptimizedUrl,
  getThumbnailUrl
};
