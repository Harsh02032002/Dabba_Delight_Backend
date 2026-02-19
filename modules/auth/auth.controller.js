import {
  registerUser,
  loginUser,
  getLoggedInUser,
  deleteOwnAccount,
} from "./auth.service.js";

export const register = async (req, res) => {
  try {
    const data = await registerUser(req.body);
    res.status(201).json({
      success: true,
      message: "Registered successfully",
      ...data,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const login = async (req, res) => {
  try {
    const data = await loginUser(req.body);
    res.json({
      success: true,
      ...data,
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: error.message,
    });
  }
};

export const getMe = async (req, res) => {
  try {
    const user = await getLoggedInUser(req.user.id);
    res.json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

export const deleteAccount = async (req, res) => {
  try {
    await deleteOwnAccount(req.user.id);
    res.status(200).json({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
