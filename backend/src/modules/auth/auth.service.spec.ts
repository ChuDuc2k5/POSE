import { describe, expect, it } from 'vitest';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service.js';
import { UserRepository } from '../user/user.repository.js';

describe('AuthService', () => {
  it('logs in an existing user and returns a JWT', async () => {
    const repository = new UserRepository();
    const service = new AuthService(repository);
    const hash = await bcrypt.hash('Password123!', 10);

    await repository.create({
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
      password: hash,
      role: 'admin',
      language: 'vi',
    });

    const result = await service.login({ email: 'test@example.com', password: 'Password123!' });

    expect(result.success).toBe(true);
    expect(result.data.token).toBeTruthy();
    expect(result.data.user.email).toBe('test@example.com');
  });

  it('rejects invalid credentials', async () => {
    const repository = new UserRepository();
    const service = new AuthService(repository);

    const result = await service.login({ email: 'missing@example.com', password: 'bad' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid');
  });
});
