import Cart from "./cart.model.js";

export const addToCart = async (req, res) => {
  const { productId, quantity } = req.body;
  const userId = req.user.id;

  let cart = await Cart.findOne({ userId });
  if (!cart) cart = new Cart({ userId, items: [] });

  cart.items.push({ productId, quantity });
  await cart.save();

  res.json({ success: true, message: "Added to cart" });
};
