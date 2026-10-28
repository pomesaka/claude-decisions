import { test, expect } from "bun:test";
import {
  publicURL,
  publicAddress,
  BaseImageLoader,
  imageError,
} from "../src/adapters/images";
import { BunImageLoader } from "../src/adapters/bun-images";
import { png } from "./fixtures";
test.each([
  "127.0.0.1",
  "0.0.0.0",
  "10.0.0.1",
  "172.16.0.1",
  "192.168.1.1",
  "169.254.169.254",
  "100.100.100.200",
  "::1",
  "::",
  "::ffff:127.0.0.1",
  "fc00::1",
  "fe80::1",
  "224.1.1.1",
])("rejects private/reserved %s", (address) =>
  expect(publicAddress(address)).toBe(false),
);
test.each([
  "http://localhost/x",
  "http://a.local/x",
  "http://2130706433/x",
  "http://0x7f000001/x",
  "http://[::ffff:127.0.0.1]/x",
  "file:///etc/passwd",
  "https://user:password@example.com/x",
  "http://example.com:8080/x",
])("rejects unsafe URL %s", (url) => expect(() => publicURL(url)).toThrow());
test.each(["8.8.8.8", "2606:4700:4700::1111"])(
  "accepts public address %s",
  (address) => expect(publicAddress(address)).toBe(true),
);
test("loads and checks data image signature", async () => {
  const loader = new BunImageLoader();
  expect(
    (await loader.load(png, new AbortController().signal)).media_type,
  ).toBe("image/png");
  await expect(
    loader.load(
      "data:image/jpeg;base64," + png.split(",")[1],
      new AbortController().signal,
    ),
  ).rejects.toThrow();
});
test.each([
  "data:image/png;base64,invalid!",
  "data:image/png;base64,aGVsbG8=",
  "http://127.0.0.1/x",
])("rejects invalid image %s", async (url) => {
  await expect(
    new BunImageLoader().load(url, new AbortController().signal),
  ).rejects.toThrow();
});

test("HTTP connection pins IP while preserving Host", async () => {
  const { createServer } = await import("node:http");
  const { pinnedRead } = await import("../src/adapters/bun-images");
  let host: string | undefined;
  const server = createServer((req, res) => {
    host = req.headers.host;
    res.end("image");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No server port");
    const result = await pinnedRead(
      new URL(`http://does-not-resolve.invalid:${address.port}/x`),
      { address: "127.0.0.1", family: 4 },
      new AbortController().signal,
    );
    expect(host).toBe(`does-not-resolve.invalid:${address.port}`);
    expect("bytes" in result).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
test.each([
  "http://127.0.0.1/private",
  "http://169.254.169.254/latest",
  "http://[::1]/x",
])("rejects redirect to %s before connecting", async (location) => {
  let connections = 0;
  const loader = new BunImageLoader({
    async resolve() {
      return [{ address: "8.8.8.8", family: 4 }];
    },
    async read() {
      connections++;
      return { location };
    },
  });
  await expect(
    loader.load("https://public.example/x", new AbortController().signal),
  ).rejects.toThrow();
  expect(connections).toBe(1);
});
test("rejects mixed public/private DNS answers", async () => {
  let connected = false;
  const loader = new BunImageLoader({
    async resolve() {
      return [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ];
    },
    async read() {
      connected = true;
      return { bytes: new Uint8Array() };
    },
  });
  await expect(
    loader.load("https://public.example/x", new AbortController().signal),
  ).rejects.toThrow();
  expect(connected).toBe(false);
});
test("revalidates every redirect and bounds redirect count", async () => {
  let resolves = 0,
    connections = 0;
  const loader = new BunImageLoader({
    async resolve() {
      resolves++;
      return [{ address: "8.8.8.8", family: 4 }];
    },
    async read() {
      connections++;
      return { location: "/again" };
    },
  });
  await expect(
    loader.load("https://public.example/x", new AbortController().signal),
  ).rejects.toThrow();
  expect(connections).toBe(6);
  expect(resolves).toBe(6);
});
