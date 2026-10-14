import { Injectable } from '@nestjs/common';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: string;
  language: string;
  avatarUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

@Injectable()
export class UserRepository {
  private readonly users = new Map<string, UserRecord>();

  async findByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.toLowerCase();
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === normalized) {
        return user;
      }
    }
    return null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async create(input: Partial<UserRecord> & { email: string; name: string; password: string }): Promise<UserRecord> {
    const id = input.id ?? cryptoId();
    const user: UserRecord = {
      id,
      name: input.name,
      email: input.email,
      password: input.password,
      role: input.role ?? 'user',
      language: input.language ?? 'vi',
      avatarUrl: input.avatarUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.users.set(id, user);
    return user;
  }

  async update(id: string, changes: Partial<UserRecord>): Promise<UserRecord | null> {
    const current = this.users.get(id);
    if (!current) return null;

    const next = { ...current, ...changes, updatedAt: new Date().toISOString() };
    this.users.set(id, next);
    return next;
  }

  async list(): Promise<UserRecord[]> {
    return Array.from(this.users.values());
  }
}

function cryptoId(): string {
  return `user_${Math.random().toString(36).slice(2, 10)}`;
}
