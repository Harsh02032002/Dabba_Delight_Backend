import Inventory from "./inventory.model.js";
import Product from "../product/product.model.js";

// Get Inventory
export const getInventory = async (req, res) => {
  try {
    const inventory = await Inventory.find({ sellerId: req.user._id }).populate(
      "productId",
    );
    res.json(inventory);
  } catch (err) {
    sendError(res, 500, "Inventory fetch failed", err);
  }
};

// Update Stock
export const updateStock = async (req, res) => {
  try {
    const { productId, stock, expiryDate } = req.body;
    await Inventory.findOneAndUpdate(
      { productId, sellerId: req.user._id },
      { stock, expiryDate, lastUpdated: new Date() },
      { upsert: true },
    );
    await Product.findByIdAndUpdate(productId, { stock }); // Sync with product
    res.json({ success: true });
  } catch (err) {
    sendError(res, 400, "Stock update failed", err);
  }
};

// Get Expiry Alerts
export const getExpiryAlerts = async (req, res) => {
  try {
    const alerts = await Inventory.find({
      sellerId: req.user._id,
      expiryDate: {
        $lte: new Date(new Date().setDate(new Date().getDate() + 7)),
      },
    }); // Next 7 days
    res.json(alerts);
  } catch (err) {
    sendError(res, 500, "Expiry alerts failed", err);
  }
};
