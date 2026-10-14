import { Module } from '@nestjs/common';
import { AuthController, AuthCookieController } from './auth.controller.js';
@Module({ controllers: [AuthController, AuthCookieController] })
export class AuthModule {}
