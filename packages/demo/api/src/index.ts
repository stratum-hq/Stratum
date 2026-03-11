import express from "express";
import cors from "cors";
import { router } from "./routes.js";

console.warn("⚠️  Demo API running WITHOUT authentication. Do not expose to public networks.");

const app = express();
const PORT = process.env.DEMO_API_PORT || 3200;

app.use(cors());
app.use(express.json());
app.use("/api", router);

app.listen(PORT, () => {
  console.log(`Demo API running on http://localhost:${PORT}`);
});
