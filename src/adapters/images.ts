import ipaddr from "ipaddr.js";
import { DecisionError } from "../application/errors";
import type { ImageData, ImageLoader } from "../ports/model";
export const imageError = () =>
  new DecisionError(
    400,
    "invalid_image",
    "Image is invalid, inaccessible, too large, or not publicly reachable.",
    "input",
  );
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export function publicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export function publicURL(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw imageError();
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port)) ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (ipaddr.isValid(hostname) && !publicAddress(hostname))
  )
    throw imageError();
  return url;
}
export function imageData(bytes: Uint8Array): ImageData {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw imageError();
  let media_type: ImageData["media_type"];
  const starts = (...values: number[]) =>
    values.every((v, i) => bytes[i] === v);
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) media_type = "image/png";
  else if (starts(255, 216, 255)) media_type = "image/jpeg";
  else if (new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/))
    media_type = "image/gif";
  else if (
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    media_type = "image/webp";
  else throw imageError();
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { media_type, data: btoa(binary) };
}
export abstract class BaseImageLoader implements ImageLoader {
  async load(value: string, signal: AbortSignal): Promise<ImageData> {
    signal.throwIfAborted();
    if (value.startsWith("data:")) {
      const match =
        /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
          value,
        );
      if (
        !match ||
        !match[2] ||
        match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
      )
        throw imageError();
      try {
        const result = imageData(
          Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0)),
        );
        if (result.media_type !== match[1]) throw imageError();
        return result;
      } catch {
        throw imageError();
      }
    }
    try {
      return await this.remote(publicURL(value), signal);
    } catch {
      signal.throwIfAborted();
      throw imageError();
    }
  }
  abstract remote(url: URL, signal: AbortSignal): Promise<ImageData>;
}
