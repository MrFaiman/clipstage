import type { LayerJSON, VideoJSON } from "@videoflow/core";
import { z } from "zod";

export type ClipProject = VideoJSON;
// Persist a reference, never an expiring signed URL or a tab-local object URL.
export const CLIP_SOURCE = "clipstage:source";
export const MAX_PROJECT_BYTES = 1024 * 1024;

type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
// The bounded JSON walk validates nested values before the structural schema runs.
const jsonValue = z.custom<JsonValue>((value) => value !== undefined);
const time = z.number().finite().nonnegative();
const easing = z.enum(["step", "linear", "easeIn", "easeOut", "easeInOut"]);
const source = z
  .string()
  .max(8192)
  .refine((value) => {
    if (
      value === CLIP_SOURCE ||
      (value.startsWith("/") && !value.startsWith("//"))
    )
      return true;
    try {
      return ["https:", "http:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Media must use the original clip reference or a durable HTTP URL, not a local blob");
const layerSchema: z.ZodType<LayerJSON> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1).max(256),
      type: z.enum([
        "video",
        "audio",
        "image",
        "text",
        "captions",
        "shape",
        "group",
      ]),
      settings: z
        .object({
          enabled: z.boolean(),
          startTime: time,
          sourceDuration: time,
          sourceStart: time.optional(),
          mediaDuration: time.optional(),
          source: source.optional(),
        })
        .passthrough(),
      properties: z.record(z.unknown()),
      animations: z.array(
        z
          .object({
            property: z.string(),
            easing: easing.optional(),
            keyframes: z.array(
              z
                .object({ time, value: jsonValue, easing: easing.optional() })
                .passthrough(),
            ),
          })
          .passthrough(),
      ),
      children: z.array(layerSchema).optional(),
    })
    .passthrough(),
);
const projectShape = z
  .object({
    name: z.string().max(256),
    duration: time,
    width: z.number().int().positive().max(8192),
    height: z.number().int().positive().max(8192),
    fps: z.number().finite().positive().max(240),
    backgroundColor: z.string().max(256),
    layers: z.array(layerSchema),
    tracks: z
      .array(z.object({ name: z.string(), enabled: z.boolean() }).passthrough())
      .optional(),
  })
  .passthrough();

function boundedJson(value: unknown): boolean {
  const pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++count > 50000 || item.depth > 32) return false;
    const v = item.value;
    if (v === null || typeof v === "string" || typeof v === "boolean") continue;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return false;
      continue;
    }
    if (typeof v !== "object") return false;
    for (const child of Object.values(v))
      pending.push({ value: child, depth: item.depth + 1 });
  }
  return (
    new TextEncoder().encode(JSON.stringify(value)).length <= MAX_PROJECT_BYTES
  );
}

// Validate the portable model without stripping VideoFlow's extension fields (effects,
// transitions, group tracks, etc.). The renderer itself stays out of the API bundle.
export const videoProjectSchema = z.custom<VideoJSON>(
  (value) => boundedJson(value) && projectShape.safeParse(value).success,
  "Invalid VideoFlow project: use finite JSON, durable media URLs, and a document under 1 MiB",
);

export function firstVideoLayer(layers: LayerJSON[]): LayerJSON | undefined {
  for (const layer of layers) {
    if (layer.type === "video") return layer;
    const nested = layer.children && firstVideoLayer(layer.children);
    if (nested) return nested;
  }
  return undefined;
}
export function projectTrim(
  project: VideoJSON,
): { start: number; end: number } | null {
  const layer = firstVideoLayer(project.layers);
  if (!layer) return null;
  const start = layer.settings.sourceStart ?? 0;
  return { start, end: start + layer.settings.sourceDuration };
}
export function replaceProjectSource(
  project: VideoJSON,
  from: string,
  to: string,
): VideoJSON {
  function map(layers: LayerJSON[]): LayerJSON[] {
    return layers.map((layer) => ({
      ...layer,
      settings: {
        ...layer.settings,
        ...(layer.settings.source === from ? { source: to } : {}),
      },
      ...(layer.children ? { children: map(layer.children) } : {}),
    }));
  }
  return { ...project, layers: map(project.layers) };
}
