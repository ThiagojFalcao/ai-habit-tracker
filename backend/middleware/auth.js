import jwt from "jsonwebtoken";
import User from "../models/User.js";

const unauthorized = (res) => res.status(401).json({ message: "Not authorized" });

export const protect = async (req, res, next) => {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return unauthorized(res);

  let decoded;
  try {
    decoded = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.NotBeforeError) return unauthorized(res);
    return next(err);
  }

  let user;
  try {
    user = await User.findById(decoded.id);
  } catch (err) {
    return next(err);
  }
  if (!user) return unauthorized(res);

  req.user = user;
  next();
};
