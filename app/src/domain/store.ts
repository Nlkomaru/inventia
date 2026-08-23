import { z } from "zod";
import { normalizeReceiptName } from "./receipt-match";

/** The identifier format used by stores. */
export const storeIdSchema = z.string().trim().min(1).max(128);

export const storeNameMaxLength = 200;

/** Names are normalized at the input boundary so uniqueness is predictable. */
export const storeNameSchema = z
    .string()
    .trim()
    .min(1, "店名は必須です")
    .max(storeNameMaxLength, "店名は200文字以内で入力してください");

export const storeUrlSchema = z.url().max(2048);

/**
 * ファビコンとして受け付ける形式。SVG は同一オリジンで配信すると
 * 保存型 XSS になるため受け付けない。
 */
export const storeFaviconContentTypes = [
    "image/png",
    "image/jpeg",
    "image/webp",
] as const;
export const storeFaviconContentTypeSchema = z.enum(storeFaviconContentTypes);

export type StoreFaviconContentType = z.infer<
    typeof storeFaviconContentTypeSchema
>;

export const storeFaviconContentTypeExtensions = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
} as const satisfies Record<StoreFaviconContentType, string>;

/** ファビコンの上限サイズ（1 MiB）。表示用の小さな画像しか置かせない。 */
export const storeFaviconMaxByteSize = 1_048_576;

export const storeCreateInputSchema = z
    .object({
        name: storeNameSchema,
        url: storeUrlSchema.nullable().optional().default(null),
    })
    .strict();

export const storeUpdateInputSchema = z
    .object({
        name: storeNameSchema.optional(),
        url: storeUrlSchema.nullable().optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
        message: "更新する項目を1つ以上指定してください",
    });

/** 店名の部分一致検索語。空文字は絞り込みなしとして扱う。 */
export const storeSearchSchema = z.string().trim().max(200);

// 未知のキーは拒否する。綴りを誤った絞り込みが黙って無視されると、
// 呼び出し側は絞り込み済みだと思ったまま全件を受け取ってしまう
export const storeListInputSchema = z
    .object({
        // 指定した文字列を店名に含む店舗だけに絞る（大文字小文字を区別しない部分一致）
        q: storeSearchSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        // cursor は q と店名を含み、日本語 1 文字が URI エンコードで 9 文字へ
        // 伸びる。どちらも最大長だと base64url 後に約 5,100 文字となるため、
        // 自分が発行した cursor を拒否しない上限にする
        cursor: z.string().trim().min(1).max(8192).optional(),
    })
    .strict();

export const storeCursorSchema = z
    .object({
        // 検索条件も cursor のスコープに含め、別の条件で作られた cursor を拒否する
        q: storeSearchSchema.nullable(),
        name: storeNameSchema,
        id: storeIdSchema,
    })
    .strict();

export const storeDtoSchema = z
    .object({
        id: storeIdSchema,
        name: storeNameSchema,
        url: z.url().nullable(),
        // ファビコンがあるときだけ /api/stores/{id}/favicon を返す。URL は保存しない
        faviconUrl: z.string().nullable(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict();

export const storeListOutputSchema = z
    .object({
        items: z.array(storeDtoSchema),
        nextCursor: z.string().nullable(),
    })
    .strict();

export const storeDeleteOutputSchema = z
    .object({ deleted: z.literal(true) })
    .strict();

export type StoreId = z.infer<typeof storeIdSchema>;
export type StoreCreateInput = z.infer<typeof storeCreateInputSchema>;
export type StoreUpdateInput = z.infer<typeof storeUpdateInputSchema>;
export type StoreListInput = z.infer<typeof storeListInputSchema>;
export type StoreCursor = z.infer<typeof storeCursorSchema>;
export type StoreDto = z.infer<typeof storeDtoSchema>;

/** ファビコンの配信パス。R2 のオブジェクトキーは公開しない。 */
export const storeFaviconPath = (id: string): string =>
    `/api/stores/${encodeURIComponent(id)}/favicon`;

// btoa は Latin-1 しか扱えないため、日本語の店名を含む cursor は
// 先に URI エンコードする
const toBase64Url = (value: string): string =>
    btoa(encodeURIComponent(value))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/u, "");

const fromBase64Url = (value: string): string => {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    return decodeURIComponent(
        atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)),
    );
};

/** Cursors are opaque to clients while retaining the (name, id) key. */
export const encodeStoreCursor = (cursor: StoreCursor): string =>
    toBase64Url(JSON.stringify(storeCursorSchema.parse(cursor)));

/** Returns null rather than leaking malformed cursor errors to transport code. */
export const decodeStoreCursor = (cursor: string): StoreCursor | null => {
    try {
        const decoded = fromBase64Url(cursor);
        const parsed: unknown = JSON.parse(decoded);
        const result = storeCursorSchema.safeParse(parsed);
        return result.success ? result.data : null;
    } catch {
        return null;
    }
};

/**
 * 照合用に店名を均す。表記辞書と同じ規則（NFKC、小文字化、空白と記号の除去）を
 * わざと共有する。レシートの店名は半角カナや空白の有無が揺れるため、同じ揺れを
 * 同じ規則で吸収しないと品目と店舗で結果が食い違う。
 */
export const normalizeStoreName = (raw: string): string =>
    normalizeReceiptName(raw);

/**
 * 支店名を切り出すときに認める区切り。空白と開き括弧だけに限る。
 *
 * 中黒やハイフンを区切りに含めると、「ドン・キホーテ中目黒店」が「ドン」、
 * 「セブン-イレブン渋谷1丁目店」が「セブン」になる。屋号の中で使う記号は
 * 支店名の境界にならないため、区切りとして扱わない。
 *
 * 「店」の直前に 2 文字以上を求めるのは、「山田 商店」の「商店」のように
 * 屋号の一部を支店名として落とさないためである。
 */
const storeBranchSuffixPattern =
    /(?:\s+|[（(])(?<branch>[^\s（(）)]{2,}店)[）)]?$/u;

/**
 * 支店名ではなく業態を表す語。場所を指していないので支店名と見なさない。
 * 長さの条件だけでは「三越 百貨店」の「百貨店」を落としてしまう。
 *
 * 末尾一致で判定する。「モロゾフ 洋菓子専門店」のように業態語へ修飾が付く形も
 * 業態であり、完全一致だけだと修飾の分だけ取りこぼす。
 *
 * カタカナ・ひらがなの業態語は必ずここへ語として並べる。下の字の集合へカナを
 * 足す解決は取れない。「ベイタウン店」「ムサシ店」「ららぽーと店」のように支店名の
 * 側もカナで終わるため、カナを 1 文字で業態と見なすと落とすべき支店名が残る。
 * 「当」「真」「刷」「局」「屋」「鏡」「鳥」「石」「立」「本」も地名の末尾として
 * 普通に出るので、「弁当店」「写真店」「印刷店」「薬局店」「花屋店」のように
 * 語の形で持つ。
 *
 * 末尾一致なので「パン店」は「ジャパン店」という支店名にも当たってしまうが、
 * その誤りは落とさない側へ倒れる。落とさなければ店舗が 1 つ余分に増えるだけで
 * 店舗マスタから直せるのに対し、落とし過ぎは無関係の店を 1 行へ統合して後から
 * 分離できない。この非対称があるので、末尾一致の緩さは意図して許容する。
 *
 * 逆に、地名としても実在する語は業態に見えても並べない。「植木店」（熊本県植木）、
 * 「生地店」（黒部市生地）、「苗木店」（中津川市苗木）がこれにあたる。
 * 「タウン」「モール」「プラザ」「スクエア」「ランド」「パーク」「センター」
 * 「ストア」「マート」も施設や場所の名であって業態ではないため入れない。
 *
 * 2 文字の業態語（商店・書店・酒店・米店・本店 など）は storeBranchSuffixPattern の
 * 「店」の直前 2 文字以上という条件でそもそも一致しないため、ここには並べない。
 * 「本店」「支店」は末尾一致に入れてはいけない。入れると「紀伊國屋書店 新宿本店」や
 * 「コーナン 港北支店」という落とすべき支店名まで残ってしまう。
 */
const storeBusinessTypeSuffixes = [
    "百貨店",
    "専門店",
    "免税店",
    // 「菓子店」の直前は「子」だが、「王子店」という地名と衝突するため
    // 下の字の集合には入れられない。語として並べる
    "菓子店",
    "製菓店",
    // 「米」「花」「芸」も地名（久留米・立花・安芸）と衝突するため語で持つ
    "精米店",
    "生花店",
    "造花店",
    "園芸店",
    "手芸店",
    "民芸店",
    "陶芸店",
    "工芸店",
    // 直前 1 文字が地名の末尾としても実在する漢字の業態語。
    // 「当」（弁当）、「真」（写真）、「刷」（印刷）、「局」（薬局）、
    // 「屋」（名古屋）、「鏡」、「司」、「鳥」（白鳥）、「石」（白石）、
    // 「立」（足立）、「本」（熊本）、「処」を字の集合へ入れないための並び
    "弁当店",
    "写真店",
    "印刷店",
    "薬局店",
    "花屋店",
    "本屋店",
    "パン屋店",
    "八百屋店",
    "居酒屋店",
    "床屋店",
    "眼鏡店",
    "寿司店",
    "焼鳥店",
    // 「たこ焼き店」「お好み焼き店」「今川焼き店」をまとめて拾う
    "焼き店",
    "宝石店",
    "仕立店",
    "製本店",
    "甘味店",
    "甘味処店",
    "食事処店",
    "蕎麦店",
    "豆腐店",
    "製麺店",
    "米穀店",
    "燃料店",
    "模型店",
    "古着店",
    "金券店",
    "貴金属店",
    "宝飾店",
    "額縁店",
    "仏壇店",
    "種苗店",
    "骨董店",
    "看板店",
    "印鑑店",
    "新聞店",
    "電話店",
    "携帯店",
    "不動産店",
    "洗濯店",
    "洋裁店",
    "和裁店",
    "美容店",
    "理容店",
    "整体店",
    "珈琲店",
    // カタカナの業態語。1 文字では業態と判断できないため語で持つ
    "ケーキ店",
    "パン店",
    "ベーカリー店",
    "ラーメン店",
    "カレー店",
    "ピザ店",
    "パスタ店",
    "カフェ店",
    "コーヒー店",
    "レストラン店",
    "スイーツ店",
    "アイスクリーム店",
    "チョコレート店",
    "メガネ店",
    "カメラ店",
    "クリーニング店",
    "リサイクル店",
    "リフォーム店",
    "ペット店",
    "ドラッグ店",
    "レンタル店",
    "ゲーム店",
    "パソコン店",
    "スポーツ店",
    "タイヤ店",
    "バイク店",
    "インテリア店",
    "アクセサリー店",
    "ギフト店",
    "ホビー店",
    "ビデオ店",
    "ネイル店",
    "エステ店",
    "マッサージ店",
    "ブティック店",
    "オーディオ店",
    "タバコ店",
    // ひらがなの業態語
    "そば店",
    "うどん店",
    "すし店",
    "おにぎり店",
    "だんご店",
    "せんべい店",
    "おもちゃ店",
    "めがね店",
    "はんこ店",
    "たばこ店",
    "くすり店",
] as const;

/**
 * 「店」の直前 1 文字だけで業態と分かる、商品や役務の分類を表す字。
 *
 * 業態語は数が多く、列挙し切れない。列挙から漏れた業態語を支店名として落とすと
 * 無関係の店が 1 行へ統合され、後から分離できない。一方で地名を業態と見て
 * 落とさなかった場合は店舗が余分に増えるだけで、店舗マスタから直せる。
 * 取り返しの付く側へ倒すため、この集合は広めに取る。
 *
 * 逆に、地名の末尾として実在する字は入れない。入れると落とすべき支店名が残る。
 * 「屋」（名古屋店）、「本」（新宿本店）、「米」（久留米店）、「花」（立花店）、
 * 「門」（虎ノ門店）、「子」（王子店）、「芸」（安芸店）がこれにあたり、
 * これらを含む業態語は上の storeBusinessTypeSuffixes 側で拾う。
 *
 * カタカナ・ひらがなも同じ理由でこの集合には入れない。「ベイタウン店」「ムサシ店」の
 * ように支店名がカナで終わる形が実在するため、1 文字では業態と地名を分けられない。
 * カナの業態語（ケーキ店・パン店・そば店 など）はすべて語として上に並べてある。
 */
const storeBusinessTypeGoodsChars = new Set([
    "売", // 販売店・直売店・小売店・卸売店
    "販", // 量販店
    "品", // 化粧品店・食料品店・薬品店
    "物", // 金物店・乾物店・履物店
    "具", // 家具店・文具店・玩具店・寝具店
    "材", // 建材店・木材店
    "器", // 楽器店・陶器店・電器店
    "機", // 電機店・農機店
    "電", // 家電店
    "車", // 自転車店・自動車店・中古車店
    "計", // 時計店
    "理", // 代理店・料理店・修理店
    "装", // 洋装店・衣装店・内装店
    "貨", // 雑貨店・百貨店
    "菜", // 惣菜店・総菜店
    "肉", // 精肉店・食肉店・焼肉店
    "魚", // 鮮魚店
    "果", // 青果店
    "食", // 洋食店・和食店・軽食店
    "茶", // 喫茶店・製茶店
    "酒", // 地酒店・洋酒店
    "薬", // 漢方薬店
    "靴", // 婦人靴店
    "服", // 洋服店・紳士服店・婦人服店
    "書", // 古書店
    "髪", // 理髪店
    "営", // 直営店
]);

/**
 * 支店名ではなく業態を表す表記か。落とすかどうかの最後の関門になる。
 *
 * NFKC へ均してから照合する。レシートの印字には半角カナが普通に混ざるため、
 * 「ｹｰｷ店」を素通りさせると業態語の一覧が丸ごと効かず、無関係の店が 1 行へ
 * 統合される。正規化が広げるのは落とさない側だけで、地名の支店名（「ﾍﾞｲﾀｳﾝ店」）は
 * 均しても業態語に当たらないため、落とすべき表記は落ちたままになる。
 */
const isBusinessTypeBranch = (branch: string): boolean => {
    const normalized = branch.normalize("NFKC");
    return (
        storeBusinessTypeSuffixes.some((suffix) =>
            normalized.endsWith(suffix),
        ) ||
        // storeBranchSuffixPattern が「店」で終わる表記しか渡さないため、
        // 末尾から 2 文字目が「店」の直前にあたる
        storeBusinessTypeGoodsChars.has(normalized.slice(-2, -1))
    );
};

/**
 * 照合用にだけ支店名を落とす。「イオン 幕張店」は「イオン」になる。
 *
 * 同じチェーンが支店ごとに別の店舗として積み上がると、チェーンの価格履歴が
 * 行ごとに割れて比較できなくなる。ただし切る位置を誤ると別のチェーンの価格が
 * 混ざるため、区切りから確実に切り出せる表記だけを落とし、判断できない表記
 * （「富澤商店」「業務スーパー」「セブン-イレブン渋谷1丁目店」）はそのまま返す。
 * 落とした結果が 1 文字以下になる場合も、切る位置を誤ったと見て元の表記を返す。
 * 「ケーキ屋 洋菓子店」のように業態を表す語も、場所ではないので落とさない。
 */
export const stripStoreBranchSuffix = (name: string): string => {
    const trimmed = name.trim();
    const match = storeBranchSuffixPattern.exec(trimmed);
    const branch = match?.groups?.branch;
    if (!match || !branch || isBusinessTypeBranch(branch)) {
        return trimmed;
    }
    const head = trimmed.slice(0, match.index).trim();
    return head.length >= 2 ? head : trimmed;
};

/**
 * 類似検索で「同じ店舗」と見なす cosine 類似度の下限。
 *
 * 支店をまとめるのは stripStoreBranchSuffix の決まった規則の仕事で、埋め込みは
 * その代わりにならない。同じチェーンの別支店（「富澤商店 ミッドランドスクエア店」と
 * 「富澤商店 名古屋店」）は埋め込みが非常に近くなるため、しきい値を下げると、
 * 規則が落とさなかった表記まで黙って別の店舗へ吸い込まれ、価格の帰属が壊れる。
 * どこを落としたか説明できない統合はしないので、意図的に高くしている。
 */
export const storeVectorMatchThreshold = 0.95;

// 店名の一括照合。1 件ずつ検索させると呼び出し回数がレシートの枚数や候補表記の
// 数に比例するため、複数の表記をまとめて受ける。
// cursor を持たない: 入力ごとに 1 件の結果を返す形で、続きの概念がない
export const storeNameMatchNamesMax = 10;
export const storeNameMatchCandidateLimitMax = 5;

export const storeNameMatchInputSchema = z
    .object({
        names: z
            .array(z.string().trim().min(1).max(storeNameMaxLength))
            .min(1)
            .max(storeNameMatchNamesMax),
        candidateLimit: z.coerce
            .number()
            .int()
            .min(0)
            .max(storeNameMatchCandidateLimitMax)
            .default(storeNameMatchCandidateLimitMax),
    })
    .strict();

export const storeNameMatchCandidateSchema = z
    .object({
        storeId: z.string().min(1),
        name: z.string().min(1),
        // 候補の由来。similarity は表記の bigram、vector は店名の意味検索。
        // 尺度が違うため、source を見ずに score を比較させない
        source: z.enum(["similarity", "vector"]),
        // similarity は 0-100 の整数、vector は cosine 類似度（0-1）
        score: z.number(),
    })
    .strict();

export const storeNameMatchResultSchema = z
    .object({
        // 問い合わせた表記そのまま。呼び出し側が入力と突き合わせられるようにする
        query: z.string(),
        // 照合キーへ正規化した表記。空になる表記はどの店舗とも一致しない
        normalizedQuery: z.string(),
        storeId: z.string().nullable(),
        // 確定したときの登録名。呼び出し側はこれをそのまま店名として使い直す
        name: z.string().nullable(),
        method: z.enum(["exact", "normalized"]).nullable(),
        // 類似度も意味検索も確定させないため、確定した表記では空配列になる
        candidates: z.array(storeNameMatchCandidateSchema),
    })
    .strict();

export const storeNameMatchOutputSchema = z
    .object({
        results: z.array(storeNameMatchResultSchema),
        // 照合の母集合が上限で切れたかどうか。true のときは一致しない表記が
        // 「存在しない」ことの根拠にならない
        poolTruncated: z.boolean(),
        // 意味検索を実行できたか。false のとき candidates に vector 由来は入らない
        vectorSearchAvailable: z.boolean(),
    })
    .strict();

export type StoreNameMatchInput = z.infer<typeof storeNameMatchInputSchema>;
export type StoreNameMatchCandidate = z.infer<
    typeof storeNameMatchCandidateSchema
>;
export type StoreNameMatchResult = z.infer<typeof storeNameMatchResultSchema>;
export type StoreNameMatchOutput = z.infer<typeof storeNameMatchOutputSchema>;
