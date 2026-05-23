"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const adapter_mariadb_1 = require("@prisma/adapter-mariadb");
const bcrypt = __importStar(require("bcryptjs"));
const adapter = new adapter_mariadb_1.PrismaMariaDb(process.env.DATABASE_URL);
const prisma = new client_1.PrismaClient({ adapter });
async function main() {
    const hashed = await bcrypt.hash('Baishuwan082508', 10);
    await prisma.user.upsert({
        where: { username: 'baishuwan' },
        update: {
            username: 'baishuwan',
            email: '2385362680@qq.com',
            passwordHash: hashed,
            role: client_1.Role.SUPER_ADMIN,
            status: client_1.UserStatus.ACTIVE,
            mustChangePassword: false,
            failedAttempts: 0,
            lockedUntil: null,
        },
        create: {
            username: 'baishuwan',
            email: '2385362680@qq.com',
            passwordHash: hashed,
            role: client_1.Role.SUPER_ADMIN,
            status: client_1.UserStatus.ACTIVE,
            mustChangePassword: false,
            failedAttempts: 0,
        },
    });
    await prisma.user.deleteMany({
        where: {
            username: 'admin',
            role: client_1.Role.ADMIN,
        },
    });
    console.log('[OK] 默认管理员已强制同步为: 2385362680@qq.com / Baishuwan082508');
}
main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=seed.js.map