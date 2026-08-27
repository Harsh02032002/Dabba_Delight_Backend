const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

// ─── Cloudinary Setup ───────────────────────────
// Run: npm install cloudinary
let cloudinary;
try {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'placeholder_cloud_name',
    api_key: process.env.CLOUDINARY_API_KEY || 'placeholder_api_key',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'placeholder_api_secret',
  });
} catch (e) {
  console.warn('⚠️ Cloudinary package not installed. Run: npm install cloudinary');
}

// ─── Multer memory storage (buffers file before upload) ─
const memoryStorage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp|pdf/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) cb(null, true);
  else cb(new Error('Only image and PDF files are allowed'));
};

const upload = multer({
  storage: memoryStorage,
  fileFilter,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
});

// ─── Cloudinary Upload Helper ───────────────────
async function uploadToS3(file, folder = 'products') {
  return uploadToCloudinary(file, folder);
}

async function uploadToCloudinary(file, folder = 'products') {
  if (!cloudinary) throw new Error('Cloudinary not installed. Run: npm install cloudinary');

  return new Promise((resolve, reject) => {
    const uniqueId = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const publicId = `${folder}/${uniqueId}`;

    const isPdf = file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf';

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: uniqueId,
        resource_type: isPdf ? 'raw' : 'image',
        ...(isPdf ? {} : { transformation: [{ quality: 'auto', fetch_format: 'auto' }] }),
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );

    const readable = new Readable();
    readable.push(file.buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
}

// ─── Cloudinary Delete Helper ───────────────────
async function deleteFromS3(fileUrl) {
  return deleteFromCloudinary(fileUrl);
}

async function deleteFromCloudinary(fileUrl) {
  try {
    if (!cloudinary) return;
    if (!fileUrl || !fileUrl.includes('cloudinary.com')) return;

    // Extract public_id from Cloudinary URL
    const parts = fileUrl.split('/');
    const uploadIndex = parts.indexOf('upload');
    if (uploadIndex === -1) return;

    // Skip version segment (v1234567890)
    let startIdx = uploadIndex + 1;
    if (parts[startIdx] && parts[startIdx].startsWith('v')) startIdx++;

    const publicIdWithExt = parts.slice(startIdx).join('/');
    const publicId = publicIdWithExt.replace(/\.[^.]+$/, ''); // remove extension

    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error('Cloudinary delete error:', err.message);
  }
}

// ─── Middleware: Upload single file to Cloudinary ─
function s3Upload(fieldName = 'image', folder = 'products') {
  return [
    upload.single(fieldName),
    async (req, res, next) => {
      try {
        if (req.file) {
          req.file.s3Url = await uploadToCloudinary(req.file, folder);
        }
        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}

// ─── Middleware: Upload multiple files to Cloudinary ─
function s3UploadMultiple(fieldName = 'images', maxCount = 5, folder = 'products') {
  return [
    upload.array(fieldName, maxCount),
    async (req, res, next) => {
      try {
        if (req.files && req.files.length > 0) {
          const urls = await Promise.all(
            req.files.map(file => uploadToCloudinary(file, folder))
          );
          req.files.forEach((file, i) => { file.s3Url = urls[i]; });
          req.s3Urls = urls;
        }
        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}

module.exports = { upload, uploadToS3, uploadToCloudinary, deleteFromS3, deleteFromCloudinary, s3Upload, s3UploadMultiple };
