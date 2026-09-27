import { describe, expect, test } from "bun:test";
import {
  CLIP_SOURCE,
  firstVideoLayer,
  projectTrim,
  replaceProjectSource,
  videoProjectSchema,
  type ClipProject,
} from "./video-project";
import { updateClipSchema } from "./index";

const project: ClipProject = {
  name: "Saved timeline",
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 5,
  backgroundColor: "#000",
  tracks: [
    { name: "Source", enabled: true },
    { name: "Titles", enabled: true },
  ],
  layers: [
    {
      id: "source",
      type: "video",
      settings: {
        enabled: true,
        startTime: 20,
        sourceStart: 2,
        sourceDuration: 5,
        mediaDuration: 12,
        speed: 2,
        source: CLIP_SOURCE,
      },
      properties: { fit: "contain" },
      animations: [],
      track: 0,
    },
    {
      id: "title",
      type: "text",
      settings: { enabled: true, startTime: 0, sourceDuration: 5 },
      properties: { text: "Keep the reaction", fontSize: 6 },
      animations: [
        {
          property: "opacity",
          keyframes: [
            { time: 0, value: 0 },
            { time: 1, value: 1 },
          ],
        },
      ],
      track: 1,
      effects: [{ effect: "vignette", params: { strength: 0.5 } }],
    },
  ],
};
describe("VideoFlow persistence", () => {
  test("preserves the complete project, tracks, effects and keyframes", () => {
    expect(videoProjectSchema.parse(project)).toEqual(project);
    expect(updateClipSchema.parse({ version: 1, project }).project).toEqual(
      project,
    );
    expect(
      updateClipSchema.parse({ version: 1, project: null }).project,
    ).toBeNull();
  });
  test("legacy trim uses source seconds, not timeline placement or playback speed", () => {
    expect(projectTrim(project)).toEqual({ start: 2, end: 7 });
    expect(
      projectTrim({ ...project, layers: [project.layers[1]!] }),
    ).toBeNull();
  });
  test("rebinds every original source, including copies in groups, without changing edits", () => {
    const grouped: ClipProject = {
      ...project,
      layers: [
        {
          id: "group",
          type: "group",
          settings: { enabled: true, startTime: 0, sourceDuration: 10 },
          properties: {},
          animations: [],
          children: project.layers,
        },
      ],
    };
    const hydrated = replaceProjectSource(
      grouped,
      CLIP_SOURCE,
      "https://storage.test/fresh-signed-url",
    );
    expect(firstVideoLayer(hydrated.layers)?.settings.source).toBe(
      "https://storage.test/fresh-signed-url",
    );
    expect(projectTrim(hydrated)).toEqual({ start: 2, end: 7 });
    expect(
      replaceProjectSource(
        hydrated,
        "https://storage.test/fresh-signed-url",
        CLIP_SOURCE,
      ),
    ).toEqual(grouped);
    expect(firstVideoLayer(grouped.layers)?.settings.source).toBe(CLIP_SOURCE);
  });
  test("rejects malformed models, unsafe numeric values and oversized documents", () => {
    expect(videoProjectSchema.safeParse({ layers: [] }).success).toBe(false);
    expect(
      videoProjectSchema.safeParse({ ...project, fps: Infinity }).success,
    ).toBe(false);
    expect(
      videoProjectSchema.safeParse({
        ...project,
        layers: [
          {
            ...project.layers[0],
            settings: { ...project.layers[0]!.settings, sourceStart: -2 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      videoProjectSchema.safeParse({
        ...project,
        name: "x".repeat(1024 * 1024),
      }).success,
    ).toBe(false);
  });
  test.each([
    "blob:http://localhost/temporary",
    "javascript:alert(1)",
    "file:///tmp/video.mp4",
  ])("doesn't persist unusable or unsafe source %s", (source) => {
    const input = replaceProjectSource(project, CLIP_SOURCE, source);
    expect(videoProjectSchema.safeParse(input).success).toBe(false);
  });
});
