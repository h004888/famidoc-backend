import '../src/core/config/load-environment';
import { PrismaClient } from '@prisma/client';
import { hash, compare } from 'bcryptjs';

async function main() {
  const args = process.argv.slice(2);
  const identifier = args[0]?.trim();
  const newPassword = args[1]?.trim();

  if (!identifier || !newPassword) {
    console.log('\nSử dụng:');
    console.log('  npm run user:password <email|phone> <newPassword>\n');
    console.log('Ví dụ:');
    console.log(
      '  npm run user:password doctor@demo.famidoc.invalid "dee84f056e727e1676ace9e14b233c6e76a2af33"\n',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { phone: identifier }],
      },
    });

    if (!user) {
      console.error(
        `❌ Không tìm thấy người dùng với email hoặc số điện thoại: "${identifier}"`,
      );
      process.exit(1);
    }

    const passwordHash = await hash(newPassword, 12);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    const isMatch = await compare(newPassword, updated.passwordHash);

    console.log('✅ Đã cập nhật mật khẩu thành công!');
    console.log({
      id: updated.id,
      email: updated.email,
      phone: updated.phone,
      role: updated.role,
      status: updated.status,
      failedLoginAttempts: updated.failedLoginAttempts,
      lockedUntil: updated.lockedUntil,
      verificationPassed: isMatch,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('❌ Có lỗi xảy ra:', err);
  process.exit(1);
});
