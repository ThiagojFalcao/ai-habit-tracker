import jwt from "jsonwebtoken";
import User from "../models/User.js";

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });

export const register = async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ message: "Name, email and a 6+ character password are required" });
  const exists = await User.findOne({ email: email.toLowerCase().trim() });
  if (exists) return res.status(400).json({ message: "Email already registered" });
  let user;
  try {
    user = await User.create({
      name,
      email,
      password,
      avatar: name.charAt(0).toUpperCase(),
    });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: "Email already registered" });
    throw err;
  }
  res.status(201).json({ user, token: signToken(user._id) });
};

export const login = async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: (email || "").toLowerCase().trim() });
  if (!user || !(await user.matchPassword(password || "")))
    return res.status(401).json({ message: "Invalid credentials" });
  res.json({ user, token: signToken(user._id) });
};

export const me = async (req, res) => res.json({ user: req.user });

export const updateProfile = async (req, res) => {
  const { name, morningMotivation } = req.body;
  if (name !== undefined) {
    req.user.name = name;
    req.user.avatar = name.charAt(0).toUpperCase();
  }
  if (morningMotivation !== undefined) req.user.morningMotivation = morningMotivation;
  await req.user.save();
  res.json({ user: req.user });
};
