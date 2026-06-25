import 'dotenv/config';
import { PrismaClient, Role, UserStatus } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import * as bcrypt from 'bcryptjs';

const adapter = new PrismaMariaDb(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main() {
  const hashed = await bcrypt.hash('Baishuwan082508', 10);

  await prisma.user.upsert({
    where: { username: 'baishuwan' },
    update: {
      username: 'baishuwan',
      email: '2385362680@qq.com',
      passwordHash: hashed,
      role: Role.ROOT,
      status: UserStatus.ACTIVE,
      mustChangePassword: false,
      failedAttempts: 0,
      lockedUntil: null,
    },
    create: {
      username: 'baishuwan',
      email: '2385362680@qq.com',
      passwordHash: hashed,
      role: Role.ROOT,
      status: UserStatus.ACTIVE,
      mustChangePassword: false,
      failedAttempts: 0,
    },
  });

  await prisma.user.deleteMany({
    where: {
      username: 'admin',
      role: Role.ADMIN,
    },
  });

  console.log('[OK] 默认管理员已强制同步为: 2385362680@qq.com / Baishuwan082508');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
