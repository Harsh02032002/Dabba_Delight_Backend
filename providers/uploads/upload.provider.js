/**
 * Upload Provider (ABSTRACTION LAYER)
 *
 * 👉 Abhi: multer.provider.js (local upload)
 * 👉 Future: s3 / cloudinary / firebase
 *
 * ❗ Controller / middleware / routes ko
 *    kabhi touch karne ki zarurat nahi padegi
 */

// CURRENT PROVIDER (LOCAL / MULTER)
export { uploadImage } from "./multer.provider.js";

/*
===========================
FUTURE SWITCH (EXAMPLES)
===========================

// Cloudinary
// export { uploadImage } from "./cloudinary.provider.js";

// AWS S3
// export { uploadImage } from "./s3.provider.js";

// Firebase
// export { uploadImage } from "./firebase.provider.js";

Bas upar wali line change karni hogi 👆
*/
