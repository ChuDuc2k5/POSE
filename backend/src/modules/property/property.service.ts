import { Injectable, NotFoundException } from '@nestjs/common';
import { PropertyRepository } from './property.repository.js';

@Injectable()
export class PropertyService {
  constructor(private readonly propertyRepository: PropertyRepository) {}

  async getProperties(filters: any = {}) {
    const properties = await this.propertyRepository.search(filters);
    return {
      success: true,
      data: properties,
      message: null,
    };
  }

  async getPropertyById(id: string) {
    const property = await this.propertyRepository.findById(id);
    if (!property) {
      throw new NotFoundException('Property not found');
    }

    return {
      success: true,
      data: property,
      message: null,
    };
  }

  async searchProperties(filters: any) {
    const results = await this.propertyRepository.search(filters);
    return {
      success: true,
      data: results,
      message: null,
    };
  }
}
