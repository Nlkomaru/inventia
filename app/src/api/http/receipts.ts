import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
    receiptApplyInputSchema,
    receiptApplyResultSchema,
    receiptDetailDtoSchema,
    receiptDtoSchema,
    receiptListDtoSchema,
    receiptListQuerySchema,
    receiptMaxByteSize,
} from "../../domain/receipt";
import {
    applyReceipt,
    deleteReceipt,
    getReceipt,
    listReceipts,
    parseReceipt,
    ReceiptServiceError,
    uploadReceipt,
} from "../../services/receiptService";
import type { ApiBindings } from "../bindings";

type ReceiptsContext = Context<ApiBindings>;

export const receiptsApp = new OpenAPIHono<ApiBindings>();

const receiptErrorSchema = z
    .object({
        error: z
            .object({
                code: z.string(),
                message: z.string(),
            })
            .strict(),
    })
    .strict();

const receiptIdParameter = z
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
const receiptUploadFormSchema = z
    .object({
        file: z.string().openapi({
            format: "binary",
            description:
                "レシート画像の本体。JPEG / PNG / WebP のいずれかで、10 MiB 以下。",
        }),
    })
    .strict();

const receiptDeleteOutputSchema = z
    .object({ deleted: z.literal(true) })
    .strict();

const responseContent = (schema: z.ZodType) => ({
    "application/json": { schema },
});

// エラー応答は利用者が対処できるコードを description に列挙する
const jsonError = (description: string) => ({
    description,
    content: responseContent(receiptErrorSchema),
});

const serverErrorResponses = {
    500: jsonError("The service could not complete the request."),
};

receiptsApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/",
    tags: ["Receipts"],
    summary: "Upload a receipt image",
    operationId: "uploadReceipt",
    description:
        "Uploads one receipt photo as multipart/form-data with the image in the file part and creates a receipt in status uploaded. Side effects: the image is stored in object storage and one receipt row is created; no inventory, price or purchase data changes. The accepted formats are decided from the part's content type, not from the file name: image/jpeg, image/png and image/webp, up to 10 MiB. The request body is rejected as soon as it exceeds that size, so an oversized upload is never read to the end. The stored image is never served back by this API and the object key is not part of any response. Run the parse endpoint next to extract the lines.",
    request: {
        body: {
            required: true,
            content: {
                "multipart/form-data": { schema: receiptUploadFormSchema },
            },
        },
    },
    responses: {
        201: {
            description:
                "The image was stored and the receipt was created in status uploaded. It has no lines yet.",
            content: responseContent(receiptDtoSchema),
        },
        400: jsonError(
            "RECEIPT_INVALID_INPUT: the body is not usable multipart/form-data, the file part is missing or is not a file, or the file is empty. Resend the image as the file part.",
        ),
        413: jsonError(
            "RECEIPT_TOO_LARGE: the image exceeds 10 MiB. Take the photo again at a lower resolution.",
        ),
        415: jsonError(
            "RECEIPT_UNSUPPORTED_MEDIA_TYPE: the request is not multipart/form-data, or the file part is not image/jpeg, image/png or image/webp. Convert the image and upload it again.",
        ),
        503: jsonError(
            "RECEIPT_STORAGE_ERROR: the image could not be stored. Retry later; nothing was created.",
        ),
        ...serverErrorResponses,
    },
});

receiptsApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/{id}/parse",
    tags: ["Receipts"],
    summary: "Extract and match the lines of a receipt",
    operationId: "parseReceipt",
    description:
        "Reads the stored image with the configured OpenRouter multimodal model and saves the extracted lines. Side effects: the stored image is sent to that third-party model, the receipt's existing lines are replaced by the extracted ones, the store name, purchase time, total price and model id are stored on the receipt, and every line that the user has not confirmed yet is re-matched against existing items. No inventory, price or purchase data changes; nothing reaches stock until the apply endpoint is called. Running it again on a receipt that was already parsed discards the previous lines together with their unconfirmed matches, which is why it is refused once an apply has started: replacing the lines would give them new ids and let already applied stock be counted a second time. An apply and a parse never interleave on one receipt: a parse is refused once an apply has started, and an apply is refused while a parse is running. Expiry dates are only extracted when printed on the receipt for that product or when the model can derive them from the product type; a stored line never carries a date that contradicts its expirySource, so a value labelled as printed really was read from the receipt. They remain suggestions that the confirmation screen must let the user edit or clear.",
    request: {
        params: z.object({ id: receiptIdParameter }),
    },
    responses: {
        200: {
            description:
                "The receipt with its lines and match candidates. Extraction failures are reported in this same body, not as an error response: the receipt then has status failed and errorMessage carries what the user can do about it (store an API key, retake the photo, retry later). A successful extraction leaves status parsed. Candidates are ranked suggestions only; a line is never confirmed by similarity alone.",
            content: responseContent(receiptDetailDtoSchema),
        },
        400: jsonError("RECEIPT_INVALID_INPUT: the receipt id is empty."),
        404: jsonError("RECEIPT_NOT_FOUND: the receipt does not exist."),
        409: jsonError(
            "RECEIPT_INVALID_STATE: the receipt already has a purchase, because an apply started or finished, so its lines back that purchase and cannot be replaced; or another parse or apply is running on it right now, in which case reload the receipt and retry.",
        ),
        ...serverErrorResponses,
    },
});

receiptsApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/",
    tags: ["Receipts"],
    summary: "List receipts",
    operationId: "listReceipts",
    description:
        "Lists uploaded receipts newest first with cursor pagination, optionally filtered by status. This endpoint only reads data. Each entry carries lineCount but not the lines themselves; read one receipt to get its lines and match candidates. The stored image is never returned. nextCursor is null on the last page; pass it back unchanged as cursor to continue.",
    request: { query: receiptListQuerySchema },
    responses: {
        200: {
            description: "A stable page of receipts, newest first.",
            content: responseContent(receiptListDtoSchema),
        },
        400: jsonError(
            "The request is invalid; correct the reported input. Codes: RECEIPT_INVALID_INPUT (status or limit is out of range), RECEIPT_INVALID_CURSOR (the cursor is unreadable; restart from the first page).",
        ),
        ...serverErrorResponses,
    },
});

receiptsApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/{id}",
    tags: ["Receipts"],
    summary: "Get a receipt with its lines and match candidates",
    operationId: "getReceipt",
    description:
        "Returns one receipt with every extracted line, the confirmed match when there is one, and the remaining candidates. This endpoint only reads data. Candidates are recomputed on read instead of being stored, so a line that is already confirmed returns an empty candidates array. suggestedExpiryDate is the confirmation screen's initial value: the printed expiry date when the receipt showed one, otherwise the estimated one, otherwise null; expirySource, expiryConfidence and expiryEstimateReason explain where it came from. linesTotalPrice is the sum of the line prices for comparison against the receipt's own totalPrice, and is null when any line has no readable price. The stored image is never returned.",
    request: {
        params: z.object({ id: receiptIdParameter }),
    },
    responses: {
        200: {
            description: "The receipt with its lines and match candidates.",
            content: responseContent(receiptDetailDtoSchema),
        },
        400: jsonError("RECEIPT_INVALID_INPUT: the receipt id is empty."),
        404: jsonError("RECEIPT_NOT_FOUND: the receipt does not exist."),
        ...serverErrorResponses,
    },
});

receiptsApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/{id}/apply",
    tags: ["Receipts"],
    summary: "Apply the confirmed lines of a receipt",
    operationId: "applyReceipt",
    description:
        "Applies the lines the user confirmed on the review screen. Side effects: one purchase is recorded for the receipt, stock is added for every confirmed line, items are created for lines marked create_item, price history rows are written for lines with a known price, the receipt wording is registered in the item alias dictionary, and the receipt moves to status applied with its purchase id. This is the only endpoint that changes stock; parsing and matching never do. Every line of the receipt must appear exactly once in lines, each with action add_to_item (itemId required), create_item (newItem required) or skip. quantity and price default to the extracted values. Omitting expiryDate uses the line's suggested expiry date, sending null adds the stock to the lot without an expiry date, and sending a date targets the lot for that date; a date is stored as midnight of that day in the application's local time zone (Asia/Tokyo), so it lands in the same lot as the same day entered on the receive screen. storeName is required when the receipt has no store name of its own and no purchase has been recorded for it yet. This is deliberately not one large transaction: object storage, stock, prices and the dictionary cannot share one atomic write, so each line is made idempotent on its own with the stock idempotency key `{idempotencyKey}:{lineId}`. The receipt itself is the idempotency scope: the first apply records one purchase for it and every later attempt reuses that purchase, together with the idempotencyKey and the purchase time it was created with. A retry therefore continues where a partial failure stopped instead of applying anything twice, even when the user corrected some lines, reloaded the page or sent a different idempotencyKey; each returned line reports replayed when its stock had already been applied. A line marked create_item reserves its item id on the line before creating the item, so a retry reuses that item instead of creating a second one with the same name. idempotencyKey is limited to 120 characters so the per-line key stays within the stock limit; an idempotencyKey that already belongs to another purchase is refused.",
    request: {
        params: z.object({ id: receiptIdParameter }),
        body: {
            required: true,
            content: responseContent(receiptApplyInputSchema),
        },
    },
    responses: {
        200: {
            description:
                "The receipt after the apply, together with the purchase id and the per-line outcome. replayed marks a line whose stock was already applied by an earlier attempt with the same idempotencyKey, so the same body is returned for a retry as for the first call. priceRecorded is false for a line whose amount per base unit cannot be derived; aliasRegistered is false when the receipt wording already belongs to another item.",
            content: responseContent(receiptApplyResultSchema),
        },
        400: jsonError(
            "RECEIPT_INVALID_INPUT: the body is not valid JSON, fails validation, does not cover every line of the receipt exactly once, or omits the store name for a receipt whose store could not be read.",
        ),
        404: jsonError(
            "The target does not exist. Codes: RECEIPT_NOT_FOUND, RECEIPT_ITEM_NOT_FOUND (a selected item no longer exists; pick another item).",
        ),
        409: jsonError(
            "The receipt cannot be applied in its current state. Codes: RECEIPT_INVALID_STATE (the receipt has not been parsed yet or has no lines), RECEIPT_APPLY_CONFLICT (the idempotencyKey already belongs to another purchase, another apply or parse is running on this receipt, or a line that was already applied is now pointed at a different item; reload the receipt before retrying).",
        ),
        ...serverErrorResponses,
    },
});

receiptsApp.openAPIRegistry.registerPath({
    method: "delete",
    path: "/{id}",
    tags: ["Receipts"],
    summary: "Delete a receipt",
    operationId: "deleteReceipt",
    description:
        "Deletes a receipt whose apply has not started. Side effects: the receipt row and its extracted lines are removed and the stored image is deleted. A receipt that already has a purchase is refused, whether the apply finished or stopped half way, because its lines are the record behind the stock, prices and items that apply produced; this endpoint never rolls those back, so deleting the receipt would leave them without a trace of where they came from.",
    request: {
        params: z.object({ id: receiptIdParameter }),
    },
    responses: {
        200: {
            description: "The receipt and its stored image were deleted.",
            content: responseContent(receiptDeleteOutputSchema),
        },
        400: jsonError("RECEIPT_INVALID_INPUT: the receipt id is empty."),
        404: jsonError("RECEIPT_NOT_FOUND: the receipt does not exist."),
        409: jsonError(
            "RECEIPT_INVALID_STATE: an apply already recorded a purchase for this receipt, so it is kept as the record behind that purchase and the stock it produced.",
        ),
        ...serverErrorResponses,
    },
});

const errorResponse = (c: ReceiptsContext, error: unknown): Response => {
    if (error instanceof ReceiptServiceError) {
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

const parseJson = async (c: ReceiptsContext): Promise<unknown> => {
    try {
        return await c.req.json();
    } catch {
        throw new ReceiptServiceError(
            "RECEIPT_INVALID_INPUT",
            "リクエスト本文は有効な JSON で指定してください。",
        );
    }
};

// multipart の外枠（boundary と各パートのヘッダー）の分だけ画像本体より大きくなる。
// 画像そのものの上限は service が byteLength で判定するため、ここでは外枠の余白を
// 足した値で本文の読み取りを打ち切る
const multipartEnvelopeMargin = 16 * 1024;
const maxRequestByteSize = receiptMaxByteSize + multipartEnvelopeMargin;

const tooLarge = (): ReceiptServiceError =>
    new ReceiptServiceError(
        "RECEIPT_TOO_LARGE",
        "画像サイズが 10 MiB を超えています。解像度を下げて撮り直してください。",
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

const readUploadedFile = async (c: ReceiptsContext): Promise<File> => {
    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
        throw new ReceiptServiceError(
            "RECEIPT_UNSUPPORTED_MEDIA_TYPE",
            "レシート画像は multipart/form-data の file パートで送信してください。",
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
        throw new ReceiptServiceError(
            "RECEIPT_INVALID_INPUT",
            "レシート画像が送信されていません。file パートに画像を添付してください。",
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
        throw new ReceiptServiceError(
            "RECEIPT_INVALID_INPUT",
            "レシート画像を読み取れませんでした。multipart/form-data の形式を確認して送り直してください。",
        );
    }
    const file = form.get("file");
    if (file === null) {
        throw new ReceiptServiceError(
            "RECEIPT_INVALID_INPUT",
            "file パートがありません。レシート画像を file という名前で添付してください。",
        );
    }
    if (!(file instanceof File)) {
        throw new ReceiptServiceError(
            "RECEIPT_INVALID_INPUT",
            "file パートがファイルではありません。レシート画像を file パートに添付してください。",
        );
    }
    if (file.size > receiptMaxByteSize) {
        throw tooLarge();
    }
    return file;
};

receiptsApp.post("/", async (c) => {
    try {
        const file = await readUploadedFile(c);
        return c.json(
            await uploadReceipt(c.env, {
                bytes: await file.arrayBuffer(),
                contentType: file.type,
            }),
            201,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

receiptsApp.get("/", async (c) => {
    try {
        return c.json(await listReceipts(c.env.DB, c.req.query()), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

receiptsApp.get("/:id", async (c) => {
    try {
        return c.json(await getReceipt(c.env.DB, c.req.param("id")), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

receiptsApp.post("/:id/parse", async (c) => {
    try {
        // 解析の失敗は status = 'failed' として 200 で返す契約であり、
        // ここでエラー応答へ写さない
        return c.json(await parseReceipt(c.env, c.req.param("id")), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

receiptsApp.post("/:id/apply", async (c) => {
    try {
        return c.json(
            await applyReceipt(c.env.DB, c.req.param("id"), await parseJson(c)),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

receiptsApp.delete("/:id", async (c) => {
    try {
        await deleteReceipt(c.env, c.req.param("id"));
        return c.json({ deleted: true }, 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

export default receiptsApp;
