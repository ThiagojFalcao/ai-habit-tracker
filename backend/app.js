import express from "express";
import cors from "cors";
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

app.use(notFound);
app.use(errorHandler);

export default app;
