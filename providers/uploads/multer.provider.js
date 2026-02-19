import fs from "fs";
import path from "path";

/**
 * Multer-based local upload provider
 * Saves file locally and returns FULL public URL
 */
export const uploadImage = async ({ file, req }) => {
  if (!file) return null;

  const uploadDir = path.join(process.cwd(), "uploads");

  // ensure uploads folder exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const safeName = file.originalname.replace(/\s+/g, "-");
  const filename = `${Date.now()}-${safeName}`;
  const filepath = path.join(uploadDir, filename);

  // save file buffer
  fs.writeFileSync(filepath, file.buffer);

  // FULL URL using protocol + host
  const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${filename}`;

  return imageUrl; // 👈 DB me yahi save hoga
};
