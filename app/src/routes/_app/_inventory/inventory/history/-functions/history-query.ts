/** 増減を符号付きで表示する。0 は期限別の内訳だけが変わった棚卸しで現れる。 */
export const formatDelta = (delta: number): string =>
    delta > 0 ? `+${delta}` : String(delta);
