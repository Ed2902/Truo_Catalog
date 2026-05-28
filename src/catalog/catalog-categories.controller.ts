import { Body, Controller, Get, Post } from '@nestjs/common';
import { CatalogCategoriesService } from './catalog-categories.service';
import { CreateCatalogCategoryDto } from './dto/create-catalog-category.dto';

@Controller('catalog/categories')
export class CatalogCategoriesController {
  constructor(
    private readonly catalogCategoriesService: CatalogCategoriesService,
  ) {}

  @Post()
  createCategory(@Body() createCatalogCategoryDto: CreateCatalogCategoryDto) {
    return this.catalogCategoriesService.createCategory(createCatalogCategoryDto);
  }

  @Get()
  listCategoriesTree() {
    return this.catalogCategoriesService.listCategoriesTree();
  }
}
