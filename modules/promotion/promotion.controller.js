import Promotion from "./promotion.model.js";

// Get All Promotions
export const getPromotions = async (req, res) => {
  try {
    const promotions = await Promotion.find({ sellerId: req.user._id });
    res.json(promotions);
  } catch (err) {
    sendError(res, 500, "Promotions fetch failed", err);
  }
};

// Create Promotion
export const createPromotion = async (req, res) => {
  try {
    const promotion = await Promotion.create({
      ...req.body,
      sellerId: req.user._id,
    });
    res.status(201).json(promotion);
  } catch (err) {
    sendError(res, 400, "Promotion creation failed", err);
  }
};

// Toggle Active
export const togglePromotion = async (req, res) => {
  try {
    const promotion = await Promotion.findByIdAndUpdate(
      req.params.id,
      { isActive: req.body.isActive },
      { new: true },
    );
    res.json(promotion);
  } catch (err) {
    sendError(res, 400, "Toggle failed", err);
  }
};
