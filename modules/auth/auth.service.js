import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../user/user.model.js"; // sab roles ke liye yahi model

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

export const registerUser = async ({
  name,
  email,
  password,
  phone,
  businessName,
  address,
  role = "user",
}) => {
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new Error("Email already registered");
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const userData = {
    name,
    email,
    password: hashedPassword,
    role,
    phone,
  };

  if (role === "seller") {
    userData.businessName = businessName;
    userData.address = address;
  }

  const user = await User.create(userData);

  return {
    token: generateToken(user._id),
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
};

export const loginUser = async ({ email, password }) => {
  const user = await User.findOne({ email }).select("+password");
  if (!user) throw new Error("Invalid email or password");

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new Error("Invalid email or password");

  return {
    token: generateToken(user._id),
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
};

export const getLoggedInUser = async (userId) => {
  const user = await User.findById(userId).select("-password");
  if (!user) throw new Error("User not found");
  return user;
};

export const deleteOwnAccount = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");
  await User.findByIdAndDelete(userId);
  return true;
};
