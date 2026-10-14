import { Body, Controller, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserService } from './user.service.js';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(AuthGuard('jwt'))
  @Patch('me/preferences')
  updatePreferences(@Req() request: any, @Body() body: { language?: string }) {
    if (body.language !== 'vi' && body.language !== 'en') {
      return { success: false, data: null, message: 'Language must be vi or en.' };
    }

    return this.userService.updatePreferences(request.user.id, body.language);
  }
}
