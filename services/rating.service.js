const Seller = require('../models/Seller');
const Product = require('../models/Product');
const Order = require('../models/Order');

class RatingService {
  // Calculate average rating for a seller
  static async calculateSellerRating(sellerId) {
    try {
      const orders = await Order.find({
        sellerId,
        rating: { $exists: true, $gt: 0 },
        status: 'delivered'
      }).select('rating');

      if (orders.length === 0) {
        await Seller.findByIdAndUpdate(sellerId, { rating: 0 });
        return 0;
      }

      const totalRating = orders.reduce((sum, order) => sum + order.rating, 0);
      const averageRating = totalRating / orders.length;

      await Seller.findByIdAndUpdate(sellerId, { 
        rating: parseFloat(averageRating.toFixed(1)) 
      });

      return parseFloat(averageRating.toFixed(1));
    } catch (error) {
      console.error('Error calculating seller rating:', error);
      throw error;
    }
  }

  // Calculate average rating for a product
  static async calculateProductRating(productId) {
    try {
      const orders = await Order.find({
        'items.menuItemId': productId,
        rating: { $exists: true, $gt: 0 },
        status: 'delivered'
      }).select('rating items');

      if (orders.length === 0) {
        await Product.findByIdAndUpdate(productId, { rating: 0 });
        return 0;
      }

      // Count how many times this product was ordered with ratings
      let totalRating = 0;
      let ratingCount = 0;

      orders.forEach(order => {
        const productItem = order.items.find(item => 
          item.menuItemId.toString() === productId.toString()
        );
        if (productItem) {
          totalRating += order.rating;
          ratingCount++;
        }
      });

      if (ratingCount === 0) {
        await Product.findByIdAndUpdate(productId, { rating: 0 });
        return 0;
      }

      const averageRating = totalRating / ratingCount;

      await Product.findByIdAndUpdate(productId, { 
        rating: parseFloat(averageRating.toFixed(1)) 
      });

      return parseFloat(averageRating.toFixed(1));
    } catch (error) {
      console.error('Error calculating product rating:', error);
      throw error;
    }
  }

  // Update rating for an order and recalculate seller/product ratings
  static async updateOrderRating(orderId, rating, review = '') {
    try {
      const order = await Order.findById(orderId).populate('sellerId');
      if (!order) {
        throw new Error('Order not found');
      }

      if (order.status !== 'delivered') {
        throw new Error('Order must be delivered to be rated');
      }

      // Update order rating
      order.rating = rating;
      order.review = review;
      await order.save();

      // Recalculate seller rating
      await this.calculateSellerRating(order.sellerId._id);

      // Recalculate ratings for all products in this order
      for (const item of order.items) {
        await this.calculateProductRating(item.menuItemId);
      }

      return order;
    } catch (error) {
      console.error('Error updating order rating:', error);
      throw error;
    }
  }

  // Get seller rating breakdown
  static async getSellerRatingBreakdown(sellerId) {
    try {
      const orders = await Order.find({
        sellerId,
        rating: { $exists: true, $gt: 0 },
        status: 'delivered'
      }).select('rating');

      const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      let totalRating = 0;

      orders.forEach(order => {
        const rating = Math.floor(order.rating);
        if (rating >= 1 && rating <= 5) {
          breakdown[rating]++;
          totalRating += order.rating;
        }
      });

      const totalOrders = orders.length;
      const averageRating = totalOrders > 0 ? totalRating / totalOrders : 0;

      return {
        averageRating: parseFloat(averageRating.toFixed(1)),
        totalOrders,
        breakdown
      };
    } catch (error) {
      console.error('Error getting seller rating breakdown:', error);
      throw error;
    }
  }
}

module.exports = RatingService;
