import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRepository } from './user.repository.js';

@Injectable()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  async updatePreferences(userId: string, language: 'vi' | 'en') {
    const user = await this.userRepository.update(userId, { language });
    if (!user) throw new NotFoundException('User not found');

    return {
      success: true,
      data: { language: user.language },
      message: null,
    };
  }
}
