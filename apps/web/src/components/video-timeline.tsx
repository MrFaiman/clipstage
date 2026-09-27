"use client";

import { useEffect, useState } from "react";
import VideoFlow, { type LayerJSON, type VideoJSON } from "@videoflow/core";
import { VideoEditor } from "@videoflow/react-video-editor";
import "@videoflow/react-video-editor/style.css";
import {
  CLIP_SOURCE,
  replaceProjectSource,
  type Clip,
} from "@clipstage/contracts";
import { message } from "@/lib/utils";

function probeSource(source: string, signal: AbortSignal) {
  return new Promise<{ duration: number; width: number; height: number }>(
    (resolve, reject) => {
      const video = document.createElement("video");
      let done = false;
      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        const metadata = {
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        };
        video.removeAttribute("src");
        video.load();
        if (error) reject(error);
        else resolve(metadata);
      };
      const abort = () => finish(new Error("Loading cancelled"));
      const timeout = setTimeout(
        () =>
          finish(
            new Error(
              "The source timed out. Reopen this clip to refresh its playback link.",
            ),
          ),
        15000,
      );
      video.onloadedmetadata = () => {
        if (
          !Number.isFinite(video.duration) ||
          video.duration <= 0 ||
          !video.videoWidth
        )
          finish(
            new Error(
              "This source has no playable video. Download the original and convert it to H.264/AAC MP4.",
            ),
          );
        else finish();
      };
      video.onerror = () =>
        finish(
          new Error(
            "This browser couldn't open the source. Download the original or reopen the clip to refresh its link.",
          ),
        );
      signal.addEventListener("abort", abort, { once: true });
      video.preload = "metadata";
      video.crossOrigin = "anonymous";
      video.src = source;
    },
  );
}

function fitSource(project: VideoJSON, source: string, duration: number) {
  function map(layers: LayerJSON[]): LayerJSON[] {
    return layers.map((layer) => {
      const children = layer.children && map(layer.children);
      if (layer.settings.source !== source)
        return children ? { ...layer, children } : layer;
      const start = layer.settings.sourceStart ?? 0;
      if (start + layer.settings.sourceDuration > duration + 0.1)
        throw new Error("The saved cut exceeds the playable source duration.");
      return {
        ...layer,
        settings: { ...layer.settings, mediaDuration: duration },
        ...(children ? { children } : {}),
      };
    });
  }
  return { ...project, layers: map(project.layers) };
}

export function VideoTimeline({
  clip,
  playback,
  onReady,
  onChange,
}: {
  clip: Clip;
  playback: string;
  onReady: (project: VideoJSON) => void;
  onChange: (project: VideoJSON) => void;
}) {
  // VideoEditor treats a new `video` reference as load/reset, not as a controlled value.
  // Keep this initial document stable; capture subsequent commits via onChange only.
  const [initialVideo, setInitialVideo] = useState<VideoJSON | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const media = await probeSource(playback, controller.signal);
      if (clip.project)
        return fitSource(
          replaceProjectSource(clip.project, CLIP_SOURCE, playback),
          playback,
          media.duration,
        );
      const start = clip.trim?.start ?? 0;
      const end = clip.trim?.end ?? media.duration;
      if (start >= end || end > media.duration + 0.1)
        throw new Error("The saved cut exceeds the playable source duration.");
      const flow = new VideoFlow({
        name: clip.title,
        width: media.width,
        height: media.height,
        fps: 30,
        autoDetectDurations: false,
        defaults: { fontFamily: "Arial" },
      });
      flow.addVideo(
        { fit: "contain" },
        {
          name: clip.title,
          source: playback,
          sourceStart: start,
          sourceDuration: end - start,
          mediaDuration: media.duration,
        },
        { waitFor: "finish" },
      );
      return flow.compile();
    }
    void load()
      .then((project) => {
        if (controller.signal.aborted) return;
        onReady(project);
        setInitialVideo(project);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(message(cause));
      });
    return () => controller.abort();
  }, [clip, playback, onReady]);

  return (
    <div className="video-timeline" aria-label="Video timeline editor">
      {initialVideo ? (
        <VideoEditor
          video={initialVideo}
          onChange={onChange}
          theme="light"
          branding={false}
        />
      ) : (
        <div className="video-message" role={error ? "alert" : "status"}>
          <h3>
            {error ? "Couldn't open the timeline." : "Preparing your timeline…"}
          </h3>
          <p>
            {error ??
              "Loading the source. The original recording stays untouched."}
          </p>
        </div>
      )}
    </div>
  );
}
