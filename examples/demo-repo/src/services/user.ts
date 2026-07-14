// src/services/user.ts — DRIFT: imports PrismaClient directly (violates service-layer-pure)
import { PrismaClient } from '@prisma/client'; // ← VIOLATION — should use Repository interface

export class UserService {
  private db = new PrismaClient(); // ← should inject UserRepository instead

  async findById(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }
}
