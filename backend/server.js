import "dotenv/config";
import app from "./app.js";
import { connectDb } from "./config/db.js";

const PORT = process.env.PORT || 8000;

await connectDb();
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
