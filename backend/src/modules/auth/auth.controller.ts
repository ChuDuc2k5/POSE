import { Body, Controller, Post, Req, UseGuards, Get } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { LoginDto, RegisterDto } from './auth.service.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  async getProfile(@Req() req: any) {
    return {
      success: true,
      data: req.user,
      message: null,
    };
  }
}
