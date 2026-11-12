import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import * as dotenv from 'dotenv';
dotenv.config();
const config = loadConfig();
const app = createApp(config);

app.listen(config.PORT, () => {
  console.log(`Medinory API listening on port ${config.PORT}`);
});
