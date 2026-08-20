import type { LocationDto } from "@/domain/location";

/**
 * 保管場所の URL は祖先を根から並べた `/locations/{祖先}/…/{対象}` の形にする。
 * 場所は階層に意味があるため、URL だけを見てどこの棚かが分かるようにする。
 */
export const locationDetailBasePath = "/locations";

/** 根から対象までの並び。対象が見つからない場合は空配列。 */
export const buildLocationAncestry = (
    locations: readonly LocationDto[],
    locationId: string,
): LocationDto[] => {
    const byId = new Map(locations.map((location) => [location.id, location]));
    const ancestry: LocationDto[] = [];
    const seen = new Set<string>();
    let current = byId.get(locationId);
    while (current) {
        // 親子が循環していても止まる。壊れたデータで画面を固めない
        if (seen.has(current.id)) {
            break;
        }
        seen.add(current.id);
        ancestry.unshift(current);
        current =
            current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return ancestry;
};

/** 祖先を含む正しい URL。対象が見つからない場合は一覧の URL。 */
export const buildLocationDetailPath = (
    locations: readonly LocationDto[],
    locationId: string,
): string => {
    const ancestry = buildLocationAncestry(locations, locationId);
    if (ancestry.length === 0) {
        return locationDetailBasePath;
    }
    return `${locationDetailBasePath}/${ancestry
        .map((location) => encodeURIComponent(location.id))
        .join("/")}`;
};

/**
 * URL の余りを id の並びへ分解する。末尾が対象の場所で、手前は祖先の指定。
 * 空の区切りは無視するため、末尾の `/` があっても同じ結果になる。
 */
export const parseLocationPathIds = (splat: string | undefined): string[] =>
    (splat ?? "")
        .split("/")
        .map((segment) => decodeURIComponent(segment).trim())
        .filter((segment) => segment.length > 0);

/** 直下の子だけを並び順で返す。 */
export const listLocationChildren = (
    locations: readonly LocationDto[],
    locationId: string,
): LocationDto[] =>
    locations
        .filter((location) => location.parentId === locationId)
        .sort(
            (left, right) =>
                left.sortOrder - right.sortOrder ||
                left.name.localeCompare(right.name, "ja"),
        );
