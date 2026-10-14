import { Controller, Get, Param, Query } from '@nestjs/common';
import { PropertyService } from './property.service.js';

@Controller('properties')
export class PropertyController {
  constructor(private readonly propertyService: PropertyService) {}

  @Get()
  async getProperties(@Query() query: any) {
    return this.propertyService.getProperties(query);
  }

  @Get(':id')
  async getPropertyById(@Param('id') id: string) {
    return this.propertyService.getPropertyById(id);
  }
}
