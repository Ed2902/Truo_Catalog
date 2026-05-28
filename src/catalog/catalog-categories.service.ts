import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CatalogCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizePlainText } from '../common/utils/sanitize-text.util';
import { CreateCatalogCategoryDto } from './dto/create-catalog-category.dto';
import { slugifyCatalogTitle } from './utils/catalog-normalization.util';

const MAX_CATEGORY_LEVELS = 5;

type SerializedCategory = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  path: string;
  depth: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type CategoryTreeNode = SerializedCategory & {
  children: CategoryTreeNode[];
};

@Injectable()
export class CatalogCategoriesService {
  constructor(private readonly prismaService: PrismaService) {}

  async createCategory(createCatalogCategoryDto: CreateCatalogCategoryDto) {
    const sanitizedName = sanitizePlainText(createCatalogCategoryDto.name);

    if (!sanitizedName) {
      throw new BadRequestException('Category name is invalid');
    }

    const parent = createCatalogCategoryDto.parentId
      ? await this.prismaService.catalogCategory.findUnique({
          where: {
            id: createCatalogCategoryDto.parentId,
          },
        })
      : null;

    if (createCatalogCategoryDto.parentId && !parent) {
      throw new NotFoundException('Parent category not found');
    }

    if (parent && parent.depth >= MAX_CATEGORY_LEVELS - 1) {
      throw new BadRequestException(
        `Categories support a maximum depth of ${MAX_CATEGORY_LEVELS} levels`,
      );
    }

    const slugBase = slugifyCatalogTitle(sanitizedName);

    if (!slugBase) {
      throw new BadRequestException('Category name is invalid');
    }

    const siblingWithSlug = await this.prismaService.catalogCategory.findFirst({
      where: {
        parentId: parent?.id ?? null,
        slug: slugBase,
      },
      select: {
        id: true,
      },
    });

    if (siblingWithSlug) {
      throw new BadRequestException(
        'A category with the same slug already exists at this level',
      );
    }

    const category = await this.prismaService.catalogCategory.create({
      data: {
        name: sanitizedName,
        slug: slugBase,
        parentId: parent?.id ?? null,
        depth: parent ? parent.depth + 1 : 0,
        path: parent ? `${parent.path}/${slugBase}` : slugBase,
      },
    });

    return this.serializeCategoryNode(category);
  }

  async listCategoriesTree() {
    const categories = await this.prismaService.catalogCategory.findMany({
      where: {
        isActive: true,
      },
      orderBy: [{ depth: 'asc' }, { name: 'asc' }],
    });

    const categoryMap = new Map<string, CategoryTreeNode>();
    const roots: CategoryTreeNode[] = [];

    for (const category of categories) {
      categoryMap.set(category.id, {
        ...this.serializeCategoryNode(category),
        children: [],
      });
    }

    for (const category of categories) {
      const node = categoryMap.get(category.id);

      if (!node) {
        continue;
      }

      if (category.parentId) {
        const parent = categoryMap.get(category.parentId);

        if (parent) {
          parent.children.push(node);
          continue;
        }
      }

      roots.push(node);
    }

    return roots;
  }

  async getCategoryOrThrow(categoryId: string) {
    const category = await this.prismaService.catalogCategory.findUnique({
      where: {
        id: categoryId,
      },
    });

    if (!category || !category.isActive) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  private serializeCategoryNode(category: CatalogCategory): SerializedCategory {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      parentId: category.parentId,
      path: category.path,
      depth: category.depth,
      isActive: category.isActive,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }
}
