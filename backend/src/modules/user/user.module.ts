import { Module } from '@nestjs/common';
import { UserController } from './user.controller.js';
import { UserRepository } from './user.repository.js';
import { UserService } from './user.service.js';

@Module({
  controllers: [UserController],
  providers: [UserRepository, UserService],
  exports: [UserRepository],
})
export class UserModule {}
