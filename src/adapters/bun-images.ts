import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import {
  BaseImageLoader,
  publicURL,
  publicAddress,
  imageError,
  imageData,
  MAX_IMAGE_BYTES,
} from "./images";
import type { ImageData } from "../ports/model";
type Address = { address: string; family: number };
type ImageFetchResult = { location: string } | { bytes: Uint8Array };
export async function pinnedRead(
  url: URL,
  target: Address,
  signal: AbortSignal,
): Promise<ImageFetchResult> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    // Keep URL hostname for TLS/SNI and Host while pinning the validated TCP destination.
    const pinnedURL = new URL(url);
    pinnedURL.hostname =
      target.family === 6 ? `[${target.address}]` : target.address;
    const req = request(
      pinnedURL,
      {
        agent: false,
        signal,
        headers: { Host: url.host },
        servername: url.hostname.replace(/^\[|\]$/g, ""),
      },
      (res) => {
        if (
          res.statusCode &&
          [301, 302, 303, 307, 308].includes(res.statusCode)
        ) {
          const location = res.headers.location;
          res.destroy();
          if (location) resolve({ location });
          else reject(imageError());
          return;
        }
        if (
          res.statusCode !== 200 ||
          Number(res.headers["content-length"] ?? 0) > MAX_IMAGE_BYTES
        ) {
          res.destroy();
          reject(imageError());
          return;
        }
        const chunks: Uint8Array[] = [];
        let length = 0;
        res.on("data", (chunk: Uint8Array) => {
          length += chunk.length;
          if (length > MAX_IMAGE_BYTES) {
            res.destroy();
            reject(imageError());
          } else chunks.push(chunk);
        });
        res.on("error", () => reject(imageError()));
        res.on("end", () => {
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          resolve({ bytes });
        });
      },
    );
    req.on("error", () => reject(imageError()));
    req.end();
  });
}
interface ImageNetwork {
  resolve(hostname: string): Promise<Address[]>;
  read(
    url: URL,
    address: Address,
    signal: AbortSignal,
  ): Promise<ImageFetchResult>;
}
const defaultNetwork: ImageNetwork = {
  resolve: (hostname) => lookup(hostname, { all: true }),
  read: pinnedRead,
};
export class BunImageLoader extends BaseImageLoader {
  constructor(private network: ImageNetwork = defaultNetwork) {
    super();
  }
  async remote(initial: URL, signal: AbortSignal): Promise<ImageData> {
    let url = initial;
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    for (let redirects = 0; redirects <= 5; redirects++) {
      deadline.throwIfAborted();
      publicURL(url.href);
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const addresses = await this.network.resolve(hostname);
      if (
        !addresses.length ||
        addresses.some((item) => !publicAddress(item.address))
      )
        throw imageError();
      const target = addresses[0];
      if (!target) throw imageError();
      deadline.throwIfAborted();
      const result = await this.network.read(url, target, deadline);
      if ("bytes" in result) return imageData(result.bytes);
      url = publicURL(new URL(result.location, url).href);
    }
    throw imageError();
  }
}
