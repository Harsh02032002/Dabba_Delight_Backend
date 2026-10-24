const mongoose = require('mongoose');
const { Cart } = require('../models/Others');

const MAX_LINES = 50;
const MAX_QTY_PER_ITEM = 50;

// Same shape for web and app: products are populated so each client can rebuild its own cart items.
// Deleted products drop out (Product's find hook hides them from populate).
const serializeCart = async (cart) => {
  if (!cart) return { sellerId: null, sellerName: null, sellerType: null, items: [], updatedAt: null };
  await cart.populate([
    { path: 'items.menuItemId' },
    { path: 'sellerId', select: 'businessName type logo' },
  ]);
  const items = cart.items
    .filter((i) => i.menuItemId)
    .map((i) => ({ menuItem: i.menuItemId.toObject(), quantity: i.quantity, selectedSize: i.selectedSize || null }));
  const seller = items.length ? cart.sellerId : null;
  return {
    sellerId: seller?._id || null,
    sellerName: seller?.businessName || null,
    sellerType: seller?.type || null,
    items,
    updatedAt: cart.updatedAt,
  };
};

// GET /api/user/cart
exports.getCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user._id });
    res.json({ success: true, data: await serializeCart(cart) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/user/cart — replaces the whole cart. Body: { sellerId, items: [{ menuItemId, quantity, selectedSize? }] }
exports.saveCart = async (req, res) => {
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (rawItems.length > MAX_LINES) {
      return res.status(400).json({ success: false, message: `A cart can have at most ${MAX_LINES} different items` });
    }

    const merged = new Map();
    for (const raw of rawItems) {
      const menuItemId = String(raw?.menuItemId || '');
      const quantity = Number(raw?.quantity);
      if (!mongoose.Types.ObjectId.isValid(menuItemId) || !Number.isInteger(quantity) || quantity < 1) continue;
      const selectedSize = raw?.selectedSize === 'half' || raw?.selectedSize === 'full' ? raw.selectedSize : null;
      const key = `${menuItemId}:${selectedSize || ''}`;
      const prev = merged.get(key);
      merged.set(key, { menuItemId, selectedSize, quantity: Math.min(MAX_QTY_PER_ITEM, (prev?.quantity || 0) + quantity) });
    }
    const items = [...merged.values()];

    const rawSeller = String(req.body?.sellerId || '');
    const sellerId = items.length && mongoose.Types.ObjectId.isValid(rawSeller) ? rawSeller : null;

    const cart = await Cart.findOneAndUpdate(
      { userId: req.user._id },
      { $set: { sellerId, items } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    res.json({ success: true, data: await serializeCart(cart) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
