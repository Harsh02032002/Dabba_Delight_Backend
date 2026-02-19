import User from "./user.model.js";

// Simple error helper
const sendError = (res, status = 500, message = "Server error", err = null) => {
  console.error(message, err);
  res.status(status).json({ success: false, message, error: err?.message });
};

export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    if (!user) return sendError(res, 404, "User not found");
    res.json(user);
  } catch (err) {
    sendError(res, 500, "Profile fetch failed", err);
  }
};

export const updateProfile = async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.password; // don't allow direct password change here
    const updated = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
    }).select("-password");
    res.json(updated);
  } catch (err) {
    sendError(res, 400, "Profile update failed", err);
  }
};

export const uploadAvatar = async (req, res) => {
  try {
    if (!req.uploadedImageUrl) return res.status(400).json({ success: false, message: 'No image uploaded' });
    const user = await User.findById(req.user._id);
    user.avatar = req.uploadedImageUrl;
    await user.save();
    res.json({ success: true, avatar: user.avatar });
  } catch (err) {
    sendError(res, 500, 'Avatar upload failed', err);
  }
};

export const addToWishlist = async (req, res) => {
  try {
    const { productId } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return sendError(res, 404, 'User not found');
    if (!user.wishlist) user.wishlist = [];
    if (!user.wishlist.includes(productId)) user.wishlist.push(productId);
    await user.save();
    res.json({ success: true });
  } catch (err) {
    sendError(res, 400, 'Add to wishlist failed', err);
  }
};

export const getWishlist = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('wishlist');
    res.json(user?.wishlist || []);
  } catch (err) {
    sendError(res, 500, 'Get wishlist failed', err);
  }
};

export const removeFromWishlist = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(req.user._id);
    if (!user) return sendError(res, 404, 'User not found');
    user.wishlist = (user.wishlist || []).filter((p) => p.toString() !== id.toString());
    await user.save();
    res.json({ success: true });
  } catch (err) {
    sendError(res, 400, 'Remove wishlist failed', err);
  }
};

// Admin: list users
export const getUsers = async (req, res) => {
  try {
    if (req.user.role !== "admin") return sendError(res, 403, "Forbidden");
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    sendError(res, 500, "Users fetch failed", err);
  }
};

export const getUserById = async (req, res) => {
  try {
    if (req.user.role !== "admin") return sendError(res, 403, "Forbidden");
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return sendError(res, 404, "User not found");
    res.json(user);
  } catch (err) {
    sendError(res, 500, "User fetch failed", err);
  }
};

export const deleteUser = async (req, res) => {
  try {
    if (req.user.role !== "admin") return sendError(res, 403, "Forbidden");
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "Delete failed", err);
  }
};

export const updateRole = async (req, res) => {
  try {
    if (req.user.role !== "admin") return sendError(res, 403, "Forbidden");
    const { role } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select("-password");
    res.json(user);
  } catch (err) {
    sendError(res, 400, "Role update failed", err);
  }
};

export default {
  getProfile,
  updateProfile,
  getUsers,
  getUserById,
  deleteUser,
  updateRole,
};
