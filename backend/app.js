import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import habitRoutes from "./routes/habits.js";
import logRoutes from "./routes/logs.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: (origin, cb) => {
      const ok =
        !origin ||
        origin === process.env.CLIENT_URL ||
        /^http:\/\/localhost:\d+$/.test(origin);
      cb(null, ok);
    },
  })
);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/habits", habitRoutes);
app.use("/api/logs", logRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
