const mongoose = require('mongoose');
require('dotenv').config();

const Product = require('./models/Product');
const Seller = require('./models/Seller');

const seedMenus = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    // Get 2 home chefs
    const homeChefs = await Seller.find({ type: 'home_chef' }).limit(2);
    // Get 2 restaurants
    const restaurants = await Seller.find({ type: 'restaurant' }).limit(2);

    if (homeChefs.length === 0 && restaurants.length === 0) {
      console.log('No sellers found. Please create sellers first.');
      process.exit();
    }

    const homeChefItems = [
      {
        name: 'Home Style Dal Tadka',
        description: 'Authentic yellow dal cooked with love and tempered with ghee.',
        sellingPrice: 120,
        costPrice: 80,
        category: 'Main Course',
        isVeg: true,
        preparationTime: 20,
        tags: ['dal', 'healthy', 'comfort food'],
        image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=600&auto=format&fit=crop'
      },
      {
        name: 'Maa ki Hath ki Roti (Set of 4)',
        description: 'Soft, fluffy whole wheat chapatis made fresh on the tawa.',
        sellingPrice: 40,
        costPrice: 20,
        category: 'Breads',
        isVeg: true,
        preparationTime: 15,
        tags: ['roti', 'chapati', 'bread'],
        image: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?q=80&w=600&auto=format&fit=crop'
      },
      {
        name: 'Homestyle Chicken Curry',
        description: 'Traditional slow-cooked chicken curry with aromatic spices.',
        sellingPrice: 250,
        costPrice: 150,
        category: 'Main Course',
        isVeg: false,
        preparationTime: 40,
        tags: ['chicken', 'spicy', 'curry'],
        image: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?q=80&w=600&auto=format&fit=crop'
      }
    ];

    const restaurantItems = [
      {
        name: 'Paneer Butter Masala',
        description: 'Rich and creamy curry made with paneer, spices, onions, tomatoes, cashews and butter.',
        sellingPrice: 280,
        costPrice: 180,
        category: 'Main Course',
        isVeg: true,
        preparationTime: 25,
        tags: ['paneer', 'curry', 'creamy'],
        image: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc0?q=80&w=600&auto=format&fit=crop'
      },
      {
        name: 'Chicken Biryani',
        description: 'Classic fragrant rice dish cooked with marinated chicken and aromatic spices.',
        sellingPrice: 320,
        costPrice: 220,
        category: 'Rice',
        isVeg: false,
        preparationTime: 35,
        tags: ['biryani', 'rice', 'chicken'],
        image: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=600&auto=format&fit=crop'
      },
      {
        name: 'Garlic Naan',
        description: 'Soft and chewy Indian flatbread topped with minced garlic and cilantro.',
        sellingPrice: 50,
        costPrice: 20,
        category: 'Breads',
        isVeg: true,
        preparationTime: 10,
        tags: ['naan', 'bread', 'garlic'],
        image: 'https://images.unsplash.com/photo-1606859191214-25f0a1c6a265?q=80&w=600&auto=format&fit=crop'
      }
    ];

    let itemsAdded = 0;

    for (const chef of homeChefs) {
      for (const item of homeChefItems) {
        await Product.create({ ...item, sellerId: chef._id });
        itemsAdded++;
      }
      console.log(`Added menu items for Home Chef: ${chef.businessName}`);
    }

    for (const restaurant of restaurants) {
      for (const item of restaurantItems) {
        await Product.create({ ...item, sellerId: restaurant._id });
        itemsAdded++;
      }
      console.log(`Added menu items for Restaurant: ${restaurant.businessName}`);
    }

    console.log(`Successfully added ${itemsAdded} menu items!`);
    process.exit();

  } catch (err) {
    console.error('Error seeding menus:', err);
    process.exit(1);
  }
};

seedMenus();
