import 'dotenv/config';
import { count, eq } from 'drizzle-orm';
import { db, adminUsers } from '../db/index.js';
import { hashPassword } from '../auth/jwt.js';
import { isOwnerAdminEmail } from '../services/admin-ownership.js';

interface ParsedArgs {
  email?: string;
  password?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--email') {
      args.email = argv[index + 1];
      index += 1;
    } else if (arg === '--password') {
      args.password = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

async function main(): Promise<void> {
  const { email, password } = parseArgs(process.argv.slice(2));

  if (!email || !password) {
    console.error('Usage: node dist/cli/create-admin.js --email <email> --password <password>');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const [{ value: adminCount }] = await db.select({ value: count() }).from(adminUsers);
  if (adminCount > 0) {
    console.error('An admin account already exists. Use invite flow for additional admins.');
    process.exit(1);
  }

  const [existing] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, email))
    .limit(1);

  if (existing) {
    console.error(`Admin user ${email} already exists.`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  await db.insert(adminUsers).values({ email, passwordHash, canDeleteAdminProfiles: isOwnerAdminEmail(email) });

  console.log(`Created initial admin user: ${email}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
