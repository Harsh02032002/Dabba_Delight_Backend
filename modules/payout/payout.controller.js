import Payout from "./payout.model.js";

// Get Payouts
export const getPayouts = async (req, res) => {
  try {
    const payouts = await Payout.find({ sellerId: req.user._id }).sort({
      createdAt: -1,
    });
    res.json(payouts);
  } catch (err) {
    sendError(res, 500, "Payouts fetch failed", err);
  }
};

// Request Payout
export const requestPayout = async (req, res) => {
  try {
    const { amount, method } = req.body;
    const user = await User.findById(req.user._id);
    if (amount > user.earningsBalance) throw new Error("Insufficient balance");
    const payout = await Payout.create({
      sellerId: req.user._id,
      amount,
      method,
      status: "requested",
    });
    user.earningsBalance -= amount;
    await user.save();
    res.json(payout);
  } catch (err) {
    sendError(res, 400, "Payout request failed", err);
  }
};
