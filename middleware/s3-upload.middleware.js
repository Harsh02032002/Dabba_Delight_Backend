const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

// ─── S3 Client ──────────────────────────────────
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET || 'dabba-nation-uploads';

// ─── Multer memory storage (for S3 pipe) ────────
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

// ─── S3 Upload Helper ───────────────────────────
async function uploadToS3(file, folder = 'products') {
  const uniqueName = `${folder}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname)}`;
  
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: uniqueName,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: 'public-read',
  });

  await s3.send(command);
  
  // Return the public URL
  return `https://${BUCKET}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${uniqueName}`;
}

// ─── S3 Delete Helper ───────────────────────────
async function deleteFromS3(fileUrl) {
  try {
    if (!fileUrl || !fileUrl.includes('.amazonaws.com/')) return;
    const key = fileUrl.split('.amazonaws.com/')[1];
    if (!key) return;

    const command = new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    });
    await s3.send(command);
  } catch (err) {
    console.error('S3 delete error:', err.message);
  }
}

// ─── Middleware: Upload single file to S3 ───────
function s3Upload(fieldName = 'image', folder = 'products') {
  return [
    upload.single(fieldName),
    async (req, res, next) => {
      try {
        if (req.file) {
          req.file.s3Url = await uploadToS3(req.file, folder);
        }
        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}

// ─── Middleware: Upload multiple files to S3 ────
function s3UploadMultiple(fieldName = 'images', maxCount = 5, folder = 'products') {
  return [
    upload.array(fieldName, maxCount),
    async (req, res, next) => {
      try {
        if (req.files && req.files.length > 0) {
          const urls = await Promise.all(
            req.files.map(file => uploadToS3(file, folder))
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

module.exports = { upload, uploadToS3, deleteFromS3, s3Upload, s3UploadMultiple };
