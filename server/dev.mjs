import 'dotenv/config';
import { createServer } from 'vite';

if (process.env.NODE_ENV === 'production') throw new Error('Use npm start for production.');
const web = await createServer({ server: { host: '127.0.0.1', proxy: { '/api': `http://127.0.0.1:${process.env.PORT || 4000}` } } });
try {
  await web.listen();
  // Keep the API origin check aligned when Vite selects a different available port.
  process.env.APP_ORIGIN = web.resolvedUrls.local[0].replace(/\/$/, '');
  await import('./index.mjs');
  web.printUrls();
} catch (error) {
  await web.close();
  console.error('Nemo could not start:', error.name === 'MongoServerSelectionError' || error.name === 'MongooseServerSelectionError' ? 'Check your MongoDB connection and server availability.' : error.message);
  process.exit(1);
}
