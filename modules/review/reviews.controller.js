import Review from "./review.model.js";

// Get Reviews
export const getReviews = async (req, res) => {
  try {
    const reviews = await Review.find({ sellerId: req.user._id }).sort({
      createdAt: -1,
    });
    res.json(reviews);
  } catch (err) {
    sendError(res, 500, "Reviews fetch failed", err);
  }
};

// Reply to Review
export const replyToReview = async (req, res) => {
  try {
    const { message } = req.body;
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      {
        $push: { replies: { from: "seller", message, createdAt: new Date() } },
      },
      { new: true },
    );
    res.json(review);
  } catch (err) {
    sendError(res, 400, "Reply failed", err);
  }
};
