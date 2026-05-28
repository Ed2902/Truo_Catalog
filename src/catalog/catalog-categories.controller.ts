import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SensitiveRateLimit } from '../common/decorators/sensitive-rate-limit.decorator';
import { CatalogCategoriesService } from './catalog-categories.service';
import { CreateCatalogCategoryDto } from './dto/create-catalog-category.dto';

@Controller('catalog/categories')
export class CatalogCategoriesController {
  constructor(
    private readonly catalogCategoriesService: CatalogCategoriesService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  createCategory(@Body() createCatalogCategoryDto: CreateCatalogCategoryDto) {
    return this.catalogCategoriesService.createCategory(createCatalogCategoryDto);
  }

  @Get()
  listCategoriesTree() {
    return this.catalogCategoriesService.listCategoriesTree();
  }
}
