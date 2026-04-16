const COMBINING_MARKS_REGEX = /[\u0300-\u036f]/g;
const NON_WORD_REGEX = /[^a-z0-9\s]/g;
const MULTIPLE_SPACES_REGEX = /\s+/g;

export function normalizeCatalogText(value?: string | null): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS_REGEX, '')
    .toLowerCase()
    .replace(NON_WORD_REGEX, ' ')
    .replace(MULTIPLE_SPACES_REGEX, ' ')
    .trim();
}

export function buildTitleTokenSignature(value: string): string {
  return Array.from(new Set(normalizeCatalogText(value).split(' ').filter(Boolean)))
    .sort((left, right) => left.localeCompare(right))
    .join('|');
}

export function slugifyCatalogTitle(value: string): string {
  return normalizeCatalogText(value).replace(MULTIPLE_SPACES_REGEX, '-');
}
