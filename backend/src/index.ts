import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { env, hasOpenAI } from './config/env.js';

const app = express();

// Middleware
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
  })
);

// Parse JSON bodies, but skip for multipart/form-data (file uploads)
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return next();
  }
  return express.json()(req, res, next);
});

// Routes
app.use(routes);

// Error handling (must be last)
app.use(errorHandler);

// Start server
app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
  console.log(`OpenAI integration: ${hasOpenAI ? 'enabled' : 'stub mode (no API key)'}`);
  console.log(`Storage directory: ${env.STORAGE_DIR}`);
});
