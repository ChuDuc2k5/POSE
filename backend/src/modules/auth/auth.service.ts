import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserRepository } from '../user/user.repository.js';

export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto {
  name: string;
  email: string;
  password: string;
  role?: string;
  language?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService?: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.userRepository.findByEmail(dto.email);
    if (!user || !user.password) {
      return { success: false, data: null, message: 'Invalid email or password.' };
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatches) {
      return { success: false, data: null, message: 'Invalid email or password.' };
    }

    const token = this.jwtService?.sign({ sub: user.id, email: user.email, role: user.role }) ?? 'demo-token';

    return {
      success: true,
      data: {
        token,
        user: this.toPublicUser(user),
      },
      message: null,
    };
  }

  async register(dto: RegisterDto) {
    const existing = await this.userRepository.findByEmail(dto.email);
    if (existing) {
      return { success: false, data: null, message: 'An account with this email already exists.' };
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.userRepository.create({
      name: dto.name,
      email: dto.email,
      password: passwordHash,
      role: dto.role ?? 'user',
      language: dto.language ?? 'vi',
    });

    const token = this.jwtService?.sign({ sub: user.id, email: user.email, role: user.role }) ?? 'demo-token';

    return {
      success: true,
      data: {
        token,
        user: this.toPublicUser(user),
      },
      message: null,
    };
  }

  async validateUser(userId: string) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Invalid session');
    }
    return this.toPublicUser(user);
  }

  private toPublicUser(user: any) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      language: user.language,
      avatarUrl: user.avatarUrl,
    };
  }
}
