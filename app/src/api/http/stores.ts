import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
    storeCreateInputSchema,
    storeDeleteOutputSchema,
    storeDtoSchema,
    storeFaviconMaxByteSize,
    storeListInputSchema,
    storeListOutputSchema,
    storeUpdateInputSchema,
} from "../../domain/store";
import {
    createStore,
    deleteStore,
    deleteStoreFavicon,
    getStore,
    getStoreFavicon,
    listStores,
    StoreServiceError,
    updateStore,
    uploadStoreFavicon,
} from "../../services/storeService";
import type { ApiBindings } from "../bindings";

type StoresContext = Context<ApiBindings>;

export const storesApp = new OpenAPIHono<ApiBindings>();

const storeErrorSchema = z
    .object({
        error: z
            .object({
                code: z.string(),
                message: z.string(),
            })
            .strict(),
    })
    .strict();

const storeIdParameter = z
    .string()
    .trim()
    .min(1)
    .max(128)
    .openapi({
        param: { name: "id", in: "path" },
        example: "019fecc7-da09-768f-b6e8-45904d46b277",
    });

// multipart のファイルパートは OpenAPI では binary 形式の文字列として表現する。
// domain のスキーマから取り出した field へ .openapi() を呼ぶと bundle 後に zod の
// 実体が分かれて実行時 TypeError になるため、ここで新しく組み立てる
const storeFaviconFormSchema = z
    .object({
        file: z.string().openapi({
            format: "binary",
            description:
                "店舗のファビコン画像。PNG / JPEG / WebP のいずれかで、1 MiB 以下。",
        }),
    })
    .strict();

// 画像応答は JSON ではないため、OpenAPI では binary 形式の文字列として表現する
const imageBinarySchema = z.string().openapi({ format: "binary" });

const responseContent = (schema: z.ZodType) => ({
    "application/json": { schema },
});

// エラー応答は利用者が対処できるコードを description に列挙する
const jsonError = (description: string) => ({
    description,
    content: responseContent(storeErrorSchema),
});

const serverErrorResponses = {
    500: jsonError("The service could not complete the request."),
};

storesApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/",
    tags: ["Stores"],
    summary: "List stores",
    operationId: "listStores",
    description:
        "Lists stores ordered by name then id with stable cursor pagination. This endpoint only reads data. q filters by name with a case-insensitive partial match; % and _ in q are matched literally. A cursor is only valid for the q it was made with. faviconUrl is the path of the favicon endpoint and is null while no image is stored; the object storage key is never part of any response.",
    request: { query: storeListInputSchema },
    responses: {
        200: {
            description: "A stable page of stores, ordered by name.",
            content: responseContent(storeListOutputSchema),
        },
        400: jsonError(
            "The request is invalid; correct the reported input. Codes: STORE_INVALID_INPUT (q, limit or cursor is out of range), STORE_INVALID_CURSOR (the cursor was made for a different q; restart from the first page).",
        ),
        ...serverErrorResponses,
    },
});

storesApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/",
    tags: ["Stores"],
    summary: "Create a store",
    operationId: "createStore",
    description:
        "Creates one store. Side effects: one store row is created; no price or inventory data changes. Names are unique across all stores, so a name that already exists is refused. The favicon is uploaded separately with the favicon endpoint once the store has an id.",
    request: {
        body: {
            required: true,
            content: responseContent(storeCreateInputSchema),
        },
    },
    responses: {
        201: {
            description: "The created store. It has no favicon yet.",
            content: responseContent(storeDtoSchema),
        },
        400: jsonError(
            "STORE_INVALID_INPUT: the body is not valid JSON, the name is empty or too long, or the url is not a valid URL.",
        ),
        409: jsonError(
            "STORE_NAME_CONFLICT: another store already uses this name. Pick a different name or edit the existing store.",
        ),
        ...serverErrorResponses,
    },
});

storesApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/{id}",
    tags: ["Stores"],
    summary: "Get a store",
    operationId: "getStore",
    description: "Returns one store. This endpoint only reads data.",
    request: { params: z.object({ id: storeIdParameter }) },
    responses: {
        200: {
            description: "The requested store.",
            content: responseContent(storeDtoSchema),
        },
        400: jsonError("STORE_INVALID_INPUT: the store id is empty."),
        404: jsonError("STORE_NOT_FOUND: the store does not exist."),
        ...serverErrorResponses,
    },
});

storesApp.openAPIRegistry.registerPath({
    method: "patch",
    path: "/{id}",
    tags: ["Stores"],
    summary: "Update a store",
    operationId: "updateStore",
    description:
        "Renames a store or changes its url. Side effects: the store row is updated; price records that already copied the old name into their source keep that copied value. At least one field must be sent. The favicon is not changed here; use the favicon endpoint.",
    request: {
        params: z.object({ id: storeIdParameter }),
        body: {
            required: true,
            content: responseContent(storeUpdateInputSchema),
        },
    },
    responses: {
        200: {
            description: "The updated store.",
            content: responseContent(storeDtoSchema),
        },
        400: jsonError(
            "STORE_INVALID_INPUT: the body is not valid JSON, contains no field to update, or the name or url is invalid.",
        ),
        404: jsonError("STORE_NOT_FOUND: the store does not exist."),
        409: jsonError(
            "STORE_NAME_CONFLICT: another store already uses this name.",
        ),
        ...serverErrorResponses,
    },
});

storesApp.openAPIRegistry.registerPath({
    method: "delete",
    path: "/{id}",
    tags: ["Stores"],
    summary: "Delete a store",
    operationId: "deleteStore",
    description:
        "Deletes a store that no price record refers to. Side effects: the store row and its stored favicon are removed. A store that price records still refer to is refused so their purchase history keeps pointing at a store that exists; move those price records to another store first.",
    request: { params: z.object({ id: storeIdParameter }) },
    responses: {
        200: {
            description: "The store and its stored favicon were deleted.",
            content: responseContent(storeDeleteOutputSchema),
        },
        400: jsonError("STORE_INVALID_INPUT: the store id is empty."),
        404: jsonError("STORE_NOT_FOUND: the store does not exist."),
        409: jsonError(
            "STORE_IN_USE: price records still refer to this store. Change their store before deleting it.",
        ),
        ...serverErrorResponses,
    },
});

storesApp.openAPIRegistry.registerPath({
    method: "put",
    path: "/{id}/favicon",
    tags: ["Stores"],
    summary: "Upload a store favicon",
    operationId: "uploadStoreFavicon",
    description:
        "Stores one favicon image for a store as multipart/form-data with the image in the file part, replacing the previous one. Side effects: the image is stored in object storage and the store row records its content type and size; no price or inventory data changes. The accepted formats are decided from the part's content type, not from the file name: image/png, image/jpeg and image/webp, up to 1 MiB. SVG is refused because it would run scripts when served from this origin. The request body is rejected as soon as it exceeds that size, so an oversized upload is never read to the end. The stored image is only served back by the favicon endpoint and the object key is not part of any response.",
    request: {
        params: z.object({ id: storeIdParameter }),
        body: {
            required: true,
            content: {
                "multipart/form-data": { schema: storeFaviconFormSchema },
            },
        },
    },
    responses: {
        200: {
            description:
                "The image was stored and the store now reports a faviconUrl.",
            content: responseContent(storeDtoSchema),
        },
        400: jsonError(
            "STORE_INVALID_INPUT: the body is not usable multipart/form-data, the file part is missing or is not a file, or the file is empty. Resend the image as the file part.",
        ),
        404: jsonError("STORE_NOT_FOUND: the store does not exist."),
        413: jsonError(
            "STORE_TOO_LARGE: the image exceeds 1 MiB. Pick a smaller image.",
        ),
        415: jsonError(
            "STORE_UNSUPPORTED_MEDIA_TYPE: the request is not multipart/form-data, or the file part is not image/png, image/jpeg or image/webp. Convert the image and upload it again.",
        ),
        503: jsonError(
            "STORE_STORAGE_ERROR: the image could not be stored. Retry later; the store is unchanged.",
        ),
        ...serverErrorResponses,
    },
});

storesApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/{id}/favicon",
    tags: ["Stores"],
    summary: "Get the stored store favicon",
    operationId: "getStoreFavicon",
    description:
        "Returns the stored favicon of one store as image bytes, with the content type it was uploaded with. This endpoint only reads data. It is the value of faviconUrl on the store and on price records, so lists can show the image without knowing the object storage key. The response is marked private and may be cached by the caller for an hour; the entity tag comes from object storage and a request whose If-None-Match matches it is answered with 304 without transferring the image again.",
    request: { params: z.object({ id: storeIdParameter }) },
    responses: {
        200: {
            description: "The stored image bytes.",
            content: {
                "image/png": { schema: imageBinarySchema },
                "image/jpeg": { schema: imageBinarySchema },
                "image/webp": { schema: imageBinarySchema },
            },
        },
        304: {
            description:
                "The caller already holds this image; If-None-Match matched the stored entity tag.",
        },
        400: jsonError("STORE_INVALID_INPUT: the store id is empty."),
        404: jsonError(
            "The image cannot be served. Codes: STORE_NOT_FOUND (the store does not exist), STORE_FAVICON_NOT_FOUND (the store has no favicon, or it is no longer stored; upload it again).",
        ),
        ...serverErrorResponses,
    },
});

storesApp.openAPIRegistry.registerPath({
    method: "delete",
    path: "/{id}/favicon",
    tags: ["Stores"],
    summary: "Delete the stored store favicon",
    operationId: "deleteStoreFavicon",
    description:
        "Removes the favicon of a store while keeping the store itself. Side effects: the stored image is deleted and the store's faviconUrl becomes null. Deleting a favicon that is not there succeeds and leaves the store unchanged.",
    request: { params: z.object({ id: storeIdParameter }) },
    responses: {
        200: {
            description: "The store without its favicon.",
            content: responseContent(storeDtoSchema),
        },
        400: jsonError("STORE_INVALID_INPUT: the store id is empty."),
        404: jsonError("STORE_NOT_FOUND: the store does not exist."),
        ...serverErrorResponses,
    },
});

const errorResponse = (c: StoresContext, error: unknown): Response => {
    if (error instanceof StoreServiceError) {
        return c.json(
            {
                error: {
                    code: error.code,
                    message: error.message,
                },
            },
            error.status,
        );
    }
    return c.json(
        {
            error: {
                code: "INTERNAL_ERROR",
                message: "内部エラーが発生しました。",
            },
        },
        500,
    );
};

const parseJson = async (c: StoresContext): Promise<unknown> => {
    try {
        return await c.req.json();
    } catch {
        throw new StoreServiceError(
            "STORE_INVALID_INPUT",
            "リクエスト本文は有効な JSON で指定してください。",
        );
    }
};

// multipart の外枠（boundary と各パートのヘッダー）の分だけ画像本体より大きくなる。
// 画像そのものの上限は service が byteLength で判定するため、ここでは外枠の余白を
// 足した値で本文の読み取りを打ち切る
const multipartEnvelopeMargin = 16 * 1024;
const maxRequestByteSize = storeFaviconMaxByteSize + multipartEnvelopeMargin;

const tooLarge = (): StoreServiceError =>
    new StoreServiceError(
        "STORE_TOO_LARGE",
        "画像サイズが 1 MiB を超えています。小さい画像を選び直してください。",
    );

/**
 * 本文全体をメモリへ読み込まずに上限で打ち切る。上限超過はストリームを error に
 * するため呼び出し側の formData() が失敗し、その理由を旗で区別する。
 */
const limitedBody = (
    body: ReadableStream<Uint8Array>,
    limit: number,
): { stream: ReadableStream<Uint8Array>; exceeded: () => boolean } => {
    let total = 0;
    let exceeded = false;
    const limiter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            total += chunk.byteLength;
            if (total > limit) {
                exceeded = true;
                controller.error(tooLarge());
                return;
            }
            controller.enqueue(chunk);
        },
    });
    return {
        stream: body.pipeThrough(limiter),
        exceeded: () => exceeded,
    };
};

const readUploadedFile = async (c: StoresContext): Promise<File> => {
    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
        throw new StoreServiceError(
            "STORE_UNSUPPORTED_MEDIA_TYPE",
            "画像は multipart/form-data の file パートで送信してください。",
        );
    }
    // 宣言された長さが上限を超える要求は本文を読まずに拒否する
    const declaredLength = Number(c.req.header("content-length") ?? "");
    if (
        Number.isFinite(declaredLength) &&
        declaredLength > maxRequestByteSize
    ) {
        throw tooLarge();
    }
    const body = c.req.raw.body;
    if (!body) {
        throw new StoreServiceError(
            "STORE_INVALID_INPUT",
            "画像が送信されていません。file パートに画像を添付してください。",
        );
    }
    const limited = limitedBody(body, maxRequestByteSize);
    let form: FormData;
    try {
        // boundary を含む元の content-type をそのまま渡す（無いと解析できない）
        form = await new Response(limited.stream, {
            headers: { "content-type": contentType },
        }).formData();
    } catch {
        if (limited.exceeded()) {
            throw tooLarge();
        }
        throw new StoreServiceError(
            "STORE_INVALID_INPUT",
            "画像を読み取れませんでした。multipart/form-data の形式を確認して送り直してください。",
        );
    }
    const file = form.get("file");
    if (file === null) {
        throw new StoreServiceError(
            "STORE_INVALID_INPUT",
            "file パートがありません。画像を file という名前で添付してください。",
        );
    }
    if (!(file instanceof File)) {
        throw new StoreServiceError(
            "STORE_INVALID_INPUT",
            "file パートがファイルではありません。画像を file パートに添付してください。",
        );
    }
    if (file.size > storeFaviconMaxByteSize) {
        throw tooLarge();
    }
    return file;
};

storesApp.get("/", async (c) => {
    try {
        return c.json(await listStores(c.env.DB, c.req.query()), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

storesApp.post("/", async (c) => {
    try {
        return c.json(await createStore(c.env.DB, await parseJson(c)), 201);
    } catch (error) {
        return errorResponse(c, error);
    }
});

storesApp.get("/:id", async (c) => {
    try {
        return c.json(await getStore(c.env.DB, c.req.param("id")), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

storesApp.patch("/:id", async (c) => {
    try {
        return c.json(
            await updateStore(c.env.DB, c.req.param("id"), await parseJson(c)),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

storesApp.delete("/:id", async (c) => {
    try {
        await deleteStore(c.env, c.req.param("id"));
        return c.json({ deleted: true }, 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

storesApp.put("/:id/favicon", async (c) => {
    try {
        const file = await readUploadedFile(c);
        return c.json(
            await uploadStoreFavicon(c.env, c.req.param("id"), {
                bytes: await file.arrayBuffer(),
                contentType: file.type,
            }),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

storesApp.get("/:id/favicon", async (c) => {
    try {
        const image = await getStoreFavicon(c.env, c.req.param("id"));
        // R2 の ETag は引用符ごと返しているため、条件付き要求の値と直接比べられる
        if (c.req.header("if-none-match") === image.etag) {
            return new Response(null, {
                status: 304,
                headers: {
                    "cache-control": "private, max-age=3600",
                    etag: image.etag,
                },
            });
        }
        return new Response(image.body, {
            headers: {
                "content-type": image.contentType,
                "content-length": String(image.byteSize),
                // 保存時の content-type は multipart のパート宣言が根拠のため、
                // 画像を装った本文をブラウザが別の型として解釈しないようにする
                "x-content-type-options": "nosniff",
                // 画像は利用者ごとの private なデータなので共有キャッシュへ載せない
                "cache-control": "private, max-age=3600",
                etag: image.etag,
            },
        });
    } catch (error) {
        return errorResponse(c, error);
    }
});

storesApp.delete("/:id/favicon", async (c) => {
    try {
        return c.json(await deleteStoreFavicon(c.env, c.req.param("id")), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

export default storesApp;
