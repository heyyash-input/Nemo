import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { connectDatabase } from './database.mjs';
import { initializePolicy } from './seed.mjs';
import { User } from './models.mjs';
import { passwordInput } from './signup.mjs';

const email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
const password = passwordInput.parse(process.env.ADMIN_PASSWORD);
if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI before creating the initial administrator.');
const database = await connectDatabase();
try {
  await User.init();
  if (await User.exists({ role: 'admin' })) throw new Error('An administrator already exists. Use the Users screen to manage accounts.');
  await initializePolicy();
  await User.create({ name: 'Administrator', email, passwordHash: await bcrypt.hash(password, 12), role: 'admin', department: 'Operations' });
  console.log('Administrator created. Sign in and add managers, employees, and finance users.');
} finally { await database.close(); }
