import multer from "multer";
import { uploadImage } from "../providers/uploads/upload.provider.js";

const storage = multer.memoryStorage();
const upload = multer({ storage });

export const handleImageUpload = [
  upload.single("image"),
  async (req, res, next) => {
    if (!req.file) return next();

    try {
      const imageUrl = await uploadImage({
        file: req.file,
        req,
      });

      req.uploadedImageUrl = imageUrl;
      next();
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Image upload failed",
      });
    }
  },
];
