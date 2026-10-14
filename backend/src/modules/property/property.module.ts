import { Module } from '@nestjs/common';
import { PropertyController } from './property.controller.js';
import { PropertyService } from './property.service.js';
import { PropertyRepository } from './property.repository.js';

@Module({
  controllers: [PropertyController],
  providers: [PropertyService, PropertyRepository],
  exports: [PropertyService, PropertyRepository],
})
export class PropertyModule {}
