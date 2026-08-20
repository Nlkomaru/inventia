import type { CategoryDto } from "@/domain/category";
import { buildAncestry, buildAncestrySplat } from "@/lib/hierarchy";

/**
 * カテゴリーの URL は祖先を根から並べた `/categories/{祖先}/…/{対象}` の形にする。
 * 保管場所（`/locations/$`）と同じ形にして、階層のある マスタ の個別ページを
 * 画面ごとに違う URL 設計にしない。
 */
export const categoryDetailBasePath = "/categories";

/** 根から対象までの並び。対象が見つからない場合は空配列。 */
export const buildCategoryAncestry = (
    categories: readonly CategoryDto[],
    categoryId: string,
): CategoryDto[] => buildAncestry(categories, categoryId);

/** 祖先を含む正しい URL。対象が見つからない場合は一覧の URL。 */
export const buildCategoryDetailPath = (
    categories: readonly CategoryDto[],
    categoryId: string,
): string => {
    const splat = buildAncestrySplat(categories, categoryId);
    return splat === ""
        ? categoryDetailBasePath
        : `${categoryDetailBasePath}/${splat}`;
};

/** `/categories/$` の余りに渡す、祖先を含む id の並び。 */
export const buildCategorySplat = (
    categories: readonly CategoryDto[],
    categoryId: string,
): string => buildAncestrySplat(categories, categoryId);

/**
 * URL の余りを id の並びへ分解する。末尾が対象のカテゴリーで、手前は祖先の指定。
 * 空の区切りは無視するため、末尾の `/` があっても同じ結果になる。
 */
export const parseCategoryPathIds = (splat: string | undefined): string[] =>
    (splat ?? "")
        .split("/")
        .map((segment) => decodeURIComponent(segment).trim())
        .filter((segment) => segment.length > 0);

/** 直下の子だけを並び順で返す。 */
export const listCategoryChildren = (
    categories: readonly CategoryDto[],
    categoryId: string,
): CategoryDto[] =>
    categories
        .filter((category) => category.parentId === categoryId)
        .sort(
            (left, right) =>
                left.sortOrder - right.sortOrder ||
                left.name.localeCompare(right.name, "ja"),
        );
